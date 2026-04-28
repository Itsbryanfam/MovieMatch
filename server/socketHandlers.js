const redisUtils = require('./redisUtils');
const gameLogic = require('./gameLogic');
const pino = require('pino');
const logger = pino();


function escapeHtml(unsafe) {
  if (!unsafe || typeof unsafe !== 'string') return unsafe;
  return unsafe.replace(/[<>&"']/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;','\'':'&#39;'})[m]);
}

async function generateLobbyId(pubClient) {
  let id;
  do {
    id = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (await pubClient.exists(`lobby:${id}`));
  return id;
}

function setupSocketHandlers(io, pubClient, cachedPosters, TMDB_HEADERS) {
  io.on('connection', (socket) => {
    if (cachedPosters && cachedPosters.length > 0) socket.emit('posters', cachedPosters);

    // AUTOCOMPLETE (LRU CACHED)
    socket.on('autocompleteSearch', async ({ query, lobbyId }) => {
      try {
        const room = await redisUtils.getLobby(pubClient, lobbyId);
        const allowTv = room ? room.allowTvShows : false;
        const searchType = allowTv ? 'multi' : 'movie';
        const cacheKey = `TMDB_SEARCH:${searchType}:${query.toLowerCase()}`;
        
        const cached = await pubClient.get(cacheKey);
        if(cached) return socket.emit('autocompleteResults', JSON.parse(cached));
        
        const res = await fetch(`https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(2000) });
        const data = await res.json();
        const results = (data.results || []).filter(m => m.media_type !== 'person').slice(0, 5).map(m => ({
            id: m.id,
            title: m.media_type === 'tv' ? m.name : (m.title || m.name),
            year: (m.media_type === 'tv' ? m.first_air_date : m.release_date)?.split('-')[0] || '????',
            poster: m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : null,
            mediaType: m.media_type || 'movie'
        }));
        await pubClient.setEx(cacheKey, 86400, JSON.stringify(results));
        socket.emit('autocompleteResults', results);
      } catch (e) {
        logger.error(e, 'Autocomplete search failed');
      }
    });

    socket.on('joinLobby', async ({ name, lobbyId }) => {
      name = escapeHtml(name);
      let id = (lobbyId || '').trim().toUpperCase() || await generateLobbyId(pubClient);
      let room = await redisUtils.getLobby(pubClient, id);
      
      const isNewLobby = !room;
      if (isNewLobby) {
        room = {
          id, status: 'waiting', players: [], currentTurnIndex: 0, chain: [],
          usedMovies: [], hardcoreMode: false, previousSharedActors: [], 
          allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
          isValidating: false, gameMode: 'classic'
        };
      }
      if (room.status !== 'waiting') return socket.emit('error', 'Lobby is already playing or full.');

      const isHost = room.players.length === 0;
      const teamId = room.players.length % 2;
      room.players.push({
        id: socket.id, name, isHost, isAlive: true, connected: true, score: 0, wins: 0, teamId
      });
      const existingWins = await redisUtils.getPlayerWins(pubClient, socket.id);
      room.players[room.players.length - 1].wins = existingWins;

      await redisUtils.setSocketLobby(pubClient, socket.id, id);
      if (isNewLobby) await redisUtils.addToActiveLobbies(pubClient, id);

      await redisUtils.saveLobby(pubClient, id, room);
      socket.join(id);
      socket.emit('joined', { lobbyId: id, playerId: socket.id });
      gameLogic.broadcastState(io, id, room);
    });

    socket.on('setGameMode', async ({ lobbyId, mode }) => {
      const validModes = ['classic', 'team', 'solo', 'speed'];
      if (!validModes.includes(mode)) return;
      const room = await redisUtils.getLobby(pubClient, lobbyId);
      if (!room || room.status !== 'waiting') return;
      if (!room.players.find(p => p.id === socket.id)?.isHost) return;
      room.gameMode = mode;
      await redisUtils.saveLobby(pubClient, lobbyId, room);
      gameLogic.broadcastState(io, lobbyId, room);
    });

    socket.on('assignTeam', async ({ lobbyId, teamId }) => {
      if (teamId !== 0 && teamId !== 1) return;
      const room = await redisUtils.getLobby(pubClient, lobbyId);
      if (!room || room.status !== 'waiting') return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      player.teamId = teamId;
      await redisUtils.saveLobby(pubClient, lobbyId, room);
      gameLogic.broadcastState(io, lobbyId, room);
    });

    socket.on('requestPublicLobbies', async () => {
      const all = await redisUtils.getAllLobbies(pubClient);
      const publicList = all.filter(r => r.status === 'waiting' && r.isPublic && r.players.length < 8).map(room => {
        const host = room.players.find(p => p.isHost);
        return {
          id: room.id, hostName: host ? host.name : 'Unknown', playerCount: room.players.length,
          hardcoreMode: room.hardcoreMode, allowTvShows: room.allowTvShows
        };
      });
      socket.emit('publicLobbiesList', publicList);
    });

    socket.on('startLobby', async (lobbyId) => {
        const room = await redisUtils.getLobby(pubClient, lobbyId);
        if (room && room.players.find(p => p.id === socket.id)?.isHost) {
            await gameLogic.startGame(io, pubClient, lobbyId, room);
        }
    });

    socket.on('restartLobby', async (lobbyId) => {
        const room = await redisUtils.getLobby(pubClient, lobbyId);
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player?.isHost) return;
        if (room.status !== 'finished') return;
        
        room.status = 'waiting';
        room.chain = [];
        room.usedMovies = [];
        room.winner = null;
        room.timerMultiplier = 0;
        room.previousSharedActors = [];
        room.players.forEach(p => { p.isAlive = true; p.score = 0; });
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        gameLogic.broadcastState(io, lobbyId, room);
    });

    socket.on('togglePublic', async ({lobbyId, state}) => {
        const room = await redisUtils.getLobby(pubClient, lobbyId);
        if (room && room.status === 'waiting' && room.players.find(p => p.id === socket.id)?.isHost) {
            room.isPublic = !!state; 
            await redisUtils.saveLobby(pubClient, lobbyId, room); 
            gameLogic.broadcastState(io, lobbyId, room);
        }
    });
    
    socket.on('toggleHardcore', async ({lobbyId, state}) => {
        const room = await redisUtils.getLobby(pubClient, lobbyId);
        if (room && room.status === 'waiting' && room.players.find(p => p.id === socket.id)?.isHost) {
            room.hardcoreMode = !!state; 
            await redisUtils.saveLobby(pubClient, lobbyId, room); 
            gameLogic.broadcastState(io, lobbyId, room);
        }
    });

    socket.on('toggleTvShows', async ({lobbyId, state}) => {
        const room = await redisUtils.getLobby(pubClient, lobbyId);
        if (room && room.status === 'waiting' && room.players.find(p => p.id === socket.id)?.isHost) {
            room.allowTvShows = !!state; 
            await redisUtils.saveLobby(pubClient, lobbyId, room); 
            gameLogic.broadcastState(io, lobbyId, room);
        }
    });

    socket.on('sendChat', async ({ lobbyId, msg }) => {
        msg = escapeHtml(msg);
        const room = await redisUtils.getLobby(pubClient, lobbyId);
        if (room) {
          const player = room.players.find(p => p.id === socket.id);
          if (player) io.to(lobbyId).emit('receiveChat', { playerName: player.name, msg });
        }
    });

    socket.on('sendReaction', async ({ lobbyId, emoji }) => {
        const room = await redisUtils.getLobby(pubClient, lobbyId);
        if (room) io.to(lobbyId).emit('receiveReaction', { emoji, playerId: socket.id });
    });

    socket.on('forceNextTurn', async (lobbyId) => {
        let room = await redisUtils.getLobby(pubClient, lobbyId);
        if (!room || room.status !== 'playing' || room.isValidating) return;
        if (!room.turnExpiresAt) return;
        
        const now = Date.now();
        if (now >= room.turnExpiresAt) {
            await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Time's up!");
        } else {
            const delay = (room.turnExpiresAt - now) + 500; 
            if (delay > 0 && delay < 65000) {
                setTimeout(async () => {
                    const freshRoom = await redisUtils.getLobby(pubClient, lobbyId);
                    if (!freshRoom || freshRoom.status !== 'playing' || freshRoom.isValidating) return;
                    if (freshRoom.turnExpiresAt === room.turnExpiresAt && Date.now() >= freshRoom.turnExpiresAt) {
                        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, freshRoom, "Time's up!");
                    }
                }, delay);
            }
        }
    });

    socket.on('submitMovie', async ({ lobbyId, movie, tmdbId, mediaType }) => {
        let room = await redisUtils.getLobby(pubClient, lobbyId);
        if (!room || room.status !== 'playing' || room.isValidating || (!movie && !tmdbId)) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isAlive || room.players[room.currentTurnIndex].id !== socket.id) return;
        
        room.isValidating = true; 
        await redisUtils.saveLobby(pubClient, lobbyId, room);

        function levenshtein(a, b) {
            const matrix = [];
            for (let i = 0; i <= b.length; i++) matrix[i] = [i];
            for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
            for (let i = 1; i <= b.length; i++) {
                for (let j = 1; j <= a.length; j++) {
                    if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
                    else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
                }
            }
            return matrix[b.length][a.length];
        }

        try {
            let topCandidates = [];
            
            if (tmdbId && mediaType) {
                const lookupUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?language=en-US`;
                const detailsRes = await fetch(lookupUrl, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
                const detailsData = await detailsRes.json();
                if (detailsData && detailsData.id) {
                    topCandidates = [{
                        id: detailsData.id,
                        media_type: mediaType,
                        name: detailsData.name,
                        title: detailsData.title || detailsData.name,
                        release_date: detailsData.release_date,
                        first_air_date: detailsData.first_air_date,
                        poster_path: detailsData.poster_path
                    }];
                }
            }
            
            if (topCandidates.length === 0 && movie) {
                const searchType = room.allowTvShows ? 'multi' : 'movie';
                const searchRes = await fetch(`https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(movie)}&include_adult=false&language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
                const searchData = await searchRes.json();
                let results = (searchData.results || []).filter(r => r.media_type !== 'person');
                
                results.sort((a, b) => {
                    const titleA = (a.media_type === 'tv' ? a.name : a.title || a.name || '').toLowerCase();
                    const titleB = (b.media_type === 'tv' ? b.name : b.title || b.name || '').toLowerCase();
                    const target = movie.toLowerCase();
                    return levenshtein(titleA, target) - levenshtein(titleB, target);
                });
                
                topCandidates = results.slice(0, 5);
            }

            if (topCandidates.length === 0) {
                room = await redisUtils.getLobby(pubClient, lobbyId);
                room.isValidating = false;
                await redisUtils.saveLobby(pubClient, lobbyId, room);
                await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Title not found!");
                return;
            }
            const candidateMovies = await Promise.all(topCandidates.map(async (c) => {
              try {
                  const mediaType = c.media_type || 'movie';
                  const title = mediaType === 'tv' ? c.name : c.title;
                  const date = mediaType === 'tv' ? c.first_air_date : c.release_date;
                  let endpoint = `https://api.themoviedb.org/3/movie/${c.id}/credits`;
                  if (mediaType === 'tv') endpoint = `https://api.themoviedb.org/3/tv/${c.id}/aggregate_credits`;
                  
                  const credRes = await fetch(`${endpoint}?language=en-US`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
                  const credData = await credRes.json();
                  return { id: c.id, title, year: date ? date.split('-')[0] : 'Unknown', cast: (credData.cast || []).map(actor => actor.name), poster: c.poster_path ? `https://image.tmdb.org/t/p/w92${c.poster_path}` : null, mediaType: mediaType };
              } catch(e) { return { id: c.id, title: c.name || c.title, year: 'Unknown', cast: [], poster: null, mediaType: c.media_type || 'movie'}; }
            }));

            room = await redisUtils.getLobby(pubClient, lobbyId);
            if (room.status !== 'playing' || room.players[room.currentTurnIndex].id !== socket.id) {
                room.isValidating = false; 
                await redisUtils.saveLobby(pubClient, lobbyId, room); 
                return;
            }

            let validMatch = null;
            let matchedActors = [];
            let failReason = "Invalid movie connection.";
            const lastNode = room.chain.length > 0 ? room.chain[room.chain.length - 1] : null;
            const lastNodeCast = lastNode ? (lastNode.fullCast || lastNode.movie.cast) : [];

            for (let i = 0; i < candidateMovies.length; i++) {
                const candidate = candidateMovies[i];
                const uniqueKey = `${candidate.mediaType}:${candidate.id}`;
                if (room.usedMovies.includes(uniqueKey)) { if(i===0) failReason = "Movie already used!"; continue; }
                if (!lastNode) { validMatch = candidate; break; } 
                else {
                    const sharedActors = candidate.cast.filter(actor => lastNodeCast.some(lastActor => lastActor.toLowerCase() === actor.toLowerCase()));
                    if (sharedActors.length > 0) {
                        if (room.hardcoreMode && room.previousSharedActors.length > 0) {
                            const newSharedActors = sharedActors.filter(actor => !room.previousSharedActors.some(pActor => pActor.toLowerCase() === actor.toLowerCase()));
                            if (newSharedActors.length === 0) { failReason = "Hardcore Mode: You cannot reuse the exact same connecting actor from the previous turn!"; continue; }
                            room.previousSharedActors = newSharedActors;
                            matchedActors = newSharedActors;
                        } else {
                            room.previousSharedActors = sharedActors;
                            matchedActors = sharedActors;
                        }
                        validMatch = candidate; break;
                    }
                }
            }

            if (!validMatch) {
                room.isValidating = false; 
                await redisUtils.saveLobby(pubClient, lobbyId, room);
                await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, failReason); 
                return;
            }

            const fullCastList = validMatch.cast;
            let displayCast = fullCastList.slice(0, 30);
            matchedActors.forEach(actor => {
               if(!displayCast.some(d => d.toLowerCase() === actor.toLowerCase())) {
                   displayCast.push(actor);
               }
               if (room.chain.length > 0) {
                   const prevNode = room.chain[room.chain.length - 1];
                   if (!prevNode.movie.cast.some(d => d.toLowerCase() === actor.toLowerCase())) {
                       prevNode.movie.cast.push(actor);
                   }
               }
            });
            validMatch.cast = displayCast;

            // Valid play
            const uniqueMatchKey = `${validMatch.mediaType}:${validMatch.id}`;
            room.usedMovies.push(uniqueMatchKey);
            room.chain.push({ playerId: player.id, playerName: player.name, movie: validMatch, fullCast: fullCastList, matchedActors });
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if(pIndex > -1) room.players[pIndex].score += 100;

            room.timerMultiplier++;
            room.isValidating = false;
            await gameLogic.nextTurn(io, pubClient, lobbyId, room);
        } catch (err) {
            room = await redisUtils.getLobby(pubClient, lobbyId);
            room.isValidating = false; 
            await redisUtils.saveLobby(pubClient, lobbyId, room);
            await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "API Error or Timeout!");
        }
    });


        // === HANDLE DISCONNECT (correctly placed at the end of connection handler) ===
        async function handleDisconnect(socketId) {
          const lobbyId = await redisUtils.getSocketLobby(pubClient, socketId);
          if (!lobbyId) return;
          await redisUtils.deleteSocketLobby(pubClient, socketId);
          
          const room = await redisUtils.getLobby(pubClient, lobbyId);
          if (!room) return;

          const player = room.players.find(p => p.id === socketId);
          if (player) {
            player.isAlive = false;
            player.connected = false;
            const wasHost = player.isHost;

            if (room.status === 'waiting') {
              room.players = room.players.filter(p => p.id !== socketId);
              if (wasHost && room.players.length > 0) room.players[0].isHost = true;
            }
            await redisUtils.saveLobby(pubClient, lobbyId, room);

            if (room.players.length === 0) {
              await redisUtils.deleteLobby(pubClient, lobbyId);
              return;
            }

            if (room.status === 'playing') {
              await gameLogic.checkWinCondition(io, pubClient, lobbyId, room);
              const liveRoom = await redisUtils.getLobby(pubClient, lobbyId);
              if (liveRoom && liveRoom.status === 'playing' && liveRoom.players[liveRoom.currentTurnIndex]?.id === socketId) {
                await gameLogic.nextTurn(io, pubClient, lobbyId, liveRoom);
              }
            }
            
            const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
            if(finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
          }
        }

        socket.on('disconnect', () => handleDisconnect(socket.id));
        
        socket.on('leaveLobby', async () => {
            const lobbyId = await redisUtils.getSocketLobby(pubClient, socket.id);
            if (lobbyId) socket.leave(lobbyId);
            await handleDisconnect(socket.id);
        });
      });
}

module.exports = { setupSocketHandlers };
