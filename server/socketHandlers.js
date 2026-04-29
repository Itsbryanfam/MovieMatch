const redisUtils = require('./redisUtils');
const gameLogic = require('./gameLogic');
const pino = require('pino');
const logger = pino();
// Use the shared map from gameLogic so timeouts can be cancelled on disconnect
const { activeTurnTimeouts } = gameLogic;



function clampString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen);
}

const LOBBY_CHARS = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

async function generateLobbyId(pubClient) {
  let id;
  do {
    id = '';
    for (let i = 0; i < 6; i++) {
      id += LOBBY_CHARS[Math.floor(Math.random() * LOBBY_CHARS.length)];
    }
  } while (await pubClient.exists(`lobby:${id}`));
  return id;
}

function setupSocketHandlers(io, pubClient, TMDB_HEADERS) {
  // Simple per-socket rate limiter (Redis-backed)
  async function rateLimit(socketId, action, limit = 10, windowMs = 10000) {
    const key = `ratelimit:${action}:${socketId}`;
    const ttlSec = Math.ceil(windowMs / 1000);
    const results = await pubClient.multi()
      .incr(key)
      .expire(key, ttlSec)
      .exec();
    const count = results[0];
    return count > limit;
  }

  io.on('connection', (socket) => {
    // Immediately send cached posters to any new client
    if (global.cachedPosters && global.cachedPosters.length > 0) {
      socket.emit('posters', global.cachedPosters);
    }

    // Global error boundary — wraps every handler registered below.
    // Handlers that already have their own try/catch (submitMovie, handleDisconnect)
    // get a harmless extra layer that never fires.
    const _origOn = socket.on.bind(socket);
    socket.on = function(event, handler) {
      return _origOn(event, async (...args) => {
        try {
          await handler(...args);
        } catch (err) {
          logger.error(err, `Socket handler error in '${event}'`);
        }
      });
    };

    socket.on('requestPosters', () => {
      if (global.cachedPosters && global.cachedPosters.length > 0) {
        socket.emit('posters', global.cachedPosters);
      }
    });

    // AUTOCOMPLETE (LRU CACHED)
    socket.on('autocompleteSearch', async ({ query, lobbyId }) => {
          if (typeof query !== 'string' || query.length === 0 || query.length > 100) return;
          if (await rateLimit(socket.id, 'autocomplete', 20, 10000)) return;
          const room = await redisUtils.getLobby(pubClient, lobbyId);
          if (!room) return;
          if (!room.players.find(p => p.id === socket.id)) return;

          const searchType = room.allowTvShows ? 'multi' : 'movie';
          const searchRes = await fetch(`https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`, { 
            headers: TMDB_HEADERS, 
            signal: AbortSignal.timeout(5000) 
          });

          const searchData = await searchRes.json();
          let results = (searchData.results || []).filter(r => r.media_type !== 'person');

          // Ensure each result has id, title, year, poster, and mediaType
          results = results.slice(0, 5).map(r => ({
            id: r.id,
            title: r.title || r.name || 'Unknown Title',
            year: (r.release_date || r.first_air_date || '').split('-')[0] || 'Unknown',
            poster: r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : null,
            mediaType: r.media_type || (r.title ? 'movie' : 'tv'),
            media_type: r.media_type || (r.title ? 'movie' : 'tv')  // keep both for safety
          }));

          socket.emit('autocompleteResults', results);
        });

    socket.on('joinLobby', async ({ name, lobbyId, stableId }) => {
      if (await rateLimit(socket.id, 'joinLobby', 5, 60000)) return;
      name = clampString(name, 24);
      if (!name || !name.trim()) return socket.emit('error', 'Name cannot be empty.');
      stableId = (typeof stableId === 'string' && stableId.length > 0 && stableId.length <= 64) ? stableId : socket.id;
      let id = (lobbyId || '').trim().toUpperCase() || await generateLobbyId(pubClient);
      let room = await redisUtils.getLobby(pubClient, id);
      
      const isNewLobby = !room;
      if (isNewLobby) {
        room = {
          id, status: 'waiting', players: [], spectators: [], currentTurnIndex: 0, chain: [],
          usedMovies: [], hardcoreMode: false, previousSharedActors: [], 
          allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
          isValidating: false, gameMode: 'classic'
        };
      }
      // Spectator path: join as watcher if game is in progress
      if (room.status !== 'waiting') {
        if (!room.spectators) room.spectators = [];
        const existingWins = await redisUtils.getPlayerWins(pubClient, stableId);
        room.spectators.push({ id: socket.id, name, stableId, connected: true, wins: existingWins });

        await redisUtils.setSocketLobby(pubClient, socket.id, id);
        await redisUtils.saveLobby(pubClient, id, room);
        socket.join(id);
        socket.emit('joined', { lobbyId: id, playerId: socket.id, isSpectator: true });

        if (global.cachedPosters && global.cachedPosters.length > 0) {
          socket.emit('posters', global.cachedPosters);
        }

        gameLogic.broadcastState(io, id, room);
        return;
      }

      if (!isNewLobby && room.players.length >= 8) {
        return socket.emit('error', 'Lobby is full (8 player maximum).');
      }

      const isHost = room.players.length === 0;
      const teamId = room.players.length % 2;
      room.players.push({
        id: socket.id, name, isHost, isAlive: true, connected: true, score: 0, wins: 0, teamId, stableId
      });
      const existingWins = await redisUtils.getPlayerWins(pubClient, stableId);
      room.players[room.players.length - 1].wins = existingWins;

      await redisUtils.setSocketLobby(pubClient, socket.id, id);
      if (isNewLobby) await redisUtils.addToActiveLobbies(pubClient, id);

      await redisUtils.saveLobby(pubClient, id, room);
      socket.join(id);
      socket.emit('joined', { lobbyId: id, playerId: socket.id });

      // Send background posters to the new player
      if (global.cachedPosters && global.cachedPosters.length > 0) {
        socket.emit('posters', global.cachedPosters);
      }

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
        gameLogic.promoteSpectators(room);
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
        msg = clampString(msg, 240);
        if (!msg || !msg.trim()) return;
        if (await rateLimit(socket.id, 'chat', 5, 5000)) return;
        const room = await redisUtils.getLobby(pubClient, lobbyId);
        if (room) {
          const player = room.players.find(p => p.id === socket.id);
          const spectator = !player && (room.spectators || []).find(s => s.id === socket.id);
          const sender = player || spectator;
          if (sender) io.to(lobbyId).emit('receiveChat', { playerName: sender.name, msg, isSpectator: !!spectator });
        }
    });

    socket.on('sendReaction', async ({ lobbyId, emoji }) => {
        if (typeof emoji !== 'string' || emoji.length > 8) return;
        if (await rateLimit(socket.id, 'reaction', 10, 5000)) return;
        const room = await redisUtils.getLobby(pubClient, lobbyId);
        if (!room) return;
        const isParticipant = room.players.find(p => p.id === socket.id) || (room.spectators || []).find(s => s.id === socket.id);
        if (!isParticipant) return;
        io.to(lobbyId).emit('receiveReaction', { emoji, playerId: socket.id });
    });

    socket.on('forceNextTurn', async (lobbyId) => {
        // Add strict rate limiting: max 2 requests per 5 seconds
        if (await rateLimit(socket.id, 'forceNextTurn', 2, 5000)) return; 
        
        let room = await redisUtils.getLobby(pubClient, lobbyId);
        if (!room || room.status !== 'playing' || room.isValidating) return;

        if (!room.players.find(p => p.id === socket.id)) return;
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

    socket.on('rejoinLobby', async ({ lobbyId, playerId }) => {
          const room = await redisUtils.getLobby(pubClient, lobbyId);
          if (!room) {
            socket.emit('rejoinFailed', 'Lobby no longer exists');
            return;
          }

          const player = room.players.find(p => p.id === playerId);
          if (!player) {
            socket.emit('rejoinFailed', 'Player not found in lobby');
            return;
          }

          // Update player.id to the NEW socket id so future handlers can find them
          const oldSocketId = player.id;
          player.id = socket.id;
          player.connected = true;
          // Do NOT force isAlive = true if they were already eliminated

          await redisUtils.saveLobby(pubClient, lobbyId, room);

          // Update Redis socket→lobby mapping for the new socket id
          await redisUtils.setSocketLobby(pubClient, socket.id, lobbyId);
          // Clean up the old mapping if it still exists
          if (oldSocketId !== socket.id) {
            await redisUtils.deleteSocketLobby(pubClient, oldSocketId);
          }

          socket.join(lobbyId);

          socket.emit('rejoinSuccess', {
            lobbyId,
            playerId: socket.id,
            state: room
          });

          gameLogic.broadcastState(io, lobbyId, room);
        });

    socket.on('submitMovie', async ({ lobbyId, movie, tmdbId, mediaType }) => {
        if (typeof movie === 'string' && movie.length > 200) return;
        let room = await redisUtils.getLobby(pubClient, lobbyId);
        if (!room || room.status !== 'playing' || room.isValidating || (!movie && !tmdbId)) return;
        
        if (await rateLimit(socket.id, 'submitMovie', 8, 10000)) {
          return; // silently drop spam
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isAlive || room.players[room.currentTurnIndex].id !== socket.id) return;
        
        // Atomic Redis lock prevents concurrent submits for this lobby.
        // NX = only set if key doesn't exist. EX 30 = auto-expire after 30s (safety net).
        const lockAcquired = await redisUtils.acquireSubmitLock(pubClient, lobbyId);
        if (!lockAcquired) return;

        try {
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

                  // Use cached credits (this was the main performance/rate-limit issue)
                  const credData = await redisUtils.getOrFetchCredits(pubClient, c.id, mediaType, TMDB_HEADERS);

                  return { 
                    id: c.id, 
                    title, 
                    year: date ? date.split('-')[0] : 'Unknown', 
                    cast: (credData.cast || []).map(actor => actor.name), 
                    poster: c.poster_path ? `https://image.tmdb.org/t/p/w92${c.poster_path}` : null, 
                    mediaType: mediaType 
                  };
              } catch(e) { 
                  logger.error(e, 'Credits fetch error');
                  return { id: c.id, title: c.name || c.title, year: 'Unknown', cast: [], poster: null, mediaType: c.media_type || 'movie'}; 
              }
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

                if (room.usedMovies.includes(uniqueKey)) { 
                  if(i===0) failReason = "Movie already used!"; 
                  continue; 
                }
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
            // Strip massive TMDB payload to prevent Redis bloat
            const lightweightMovie = {
                id: validMatch.id,
                title: validMatch.title,
                poster: validMatch.poster,
                year: validMatch.year,
                cast: validMatch.cast,
                mediaType: validMatch.mediaType
            };
            room.chain.push({ playerId: player.id, playerName: player.name, movie: lightweightMovie, matchedActors });
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
        } finally {
            await redisUtils.releaseSubmitLock(pubClient, lobbyId).catch(() => {});
        }
    });


// === HANDLE DISCONNECT / LEAVE (final improved version) ===
        async function handleDisconnect(socketId) {
          try {
            const lobbyId = await redisUtils.getSocketLobby(pubClient, socketId);
            if (!lobbyId) return;

            // Always leave the Socket.io room (explicit cleanup)
            const socket = io.sockets.sockets.get(socketId);
            if (socket) socket.leave(lobbyId);

            await redisUtils.deleteSocketLobby(pubClient, socketId);

            const room = await redisUtils.getLobby(pubClient, lobbyId);
            if (!room) return;

            const player = room.players.find(p => p.id === socketId);
            if (!player) {
              // Check if they were a spectator
              if (room.spectators) {
                room.spectators = room.spectators.filter(s => s.id !== socketId);
                await redisUtils.saveLobby(pubClient, lobbyId, room);
                gameLogic.broadcastState(io, lobbyId, room);
              }
              return;
            }

            // === TIMEOUT CLEANUP ===
            if (activeTurnTimeouts.has(lobbyId)) {
              clearTimeout(activeTurnTimeouts.get(lobbyId));
              activeTurnTimeouts.delete(lobbyId);
            }

            player.isAlive = false;
            player.connected = false;

            const wasHost = player.isHost;

            if (room.status === 'waiting') {
              room.players = room.players.filter(p => p.id !== socketId);
              if (wasHost && room.players.length > 0) {
                room.players[0].isHost = true;
              }
            }

            await redisUtils.saveLobby(pubClient, lobbyId, room);

            if (room.players.length === 0) {
              await redisUtils.deleteLobby(pubClient, lobbyId);
              return;
            }

            if (room.status === 'playing') {
              const isCurrentTurnPlayer = room.players[room.currentTurnIndex]?.id === socketId;

              if (isCurrentTurnPlayer) {
                // Only eliminate if it was actually their turn
                await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Player disconnected");
              } else {
                // Non-current player disconnected → just mark them dead and check win condition
                await gameLogic.checkWinCondition(io, pubClient, lobbyId, room);
                const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
                if (finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
              }
            } else {
              const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
              if (finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
            }
          } catch (err) {
            logger.error(err, `handleDisconnect error for socket ${socketId}`);
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

module.exports = { setupSocketHandlers, clampString };
