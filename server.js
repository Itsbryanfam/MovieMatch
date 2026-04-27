require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const app = express();
const server = http.createServer(app);

const TMDB_TOKEN = process.env.TMDB_READ_TOKEN;
const TMDB_HEADERS = { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' };
const generateLobbyId = () => Math.random().toString(36).substring(2, 6).toUpperCase();

app.use(express.static('public'));

const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
const subClient = pubClient.duplicate();

let io; // Will be initialized

let cachedPosters = [];
async function fetchBackgroundPosters() {
  try {
    const res1 = await fetch(`https://api.themoviedb.org/3/movie/popular?language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
    const data1 = await res1.json();
    const res2 = await fetch(`https://api.themoviedb.org/3/movie/top_rated?language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
    const data2 = await res2.json();
    
    const combined = [...(data1.results || []), ...(data2.results || [])];
    cachedPosters = combined.filter(m => m.poster_path).map(m => `https://image.tmdb.org/t/p/w200${m.poster_path}`);
    cachedPosters.sort(() => 0.5 - Math.random());
  } catch (err) {}
}
fetchBackgroundPosters();

// --- STATE MANAGEMENT ---
async function getLobby(id) {
  const data = await pubClient.get(`lobby:${id}`);
  return data ? JSON.parse(data) : null;
}
async function saveLobby(id, state) {
  await pubClient.setEx(`lobby:${id}`, 7200, JSON.stringify(state));
}
async function deleteLobby(id) {
  await pubClient.del(`lobby:${id}`);
}
async function getAllLobbies() {
  const keys = await pubClient.keys('lobby:*');
  const lobbies = [];
  for (const key of keys) {
    const data = await pubClient.get(key);
    if(data) lobbies.push(JSON.parse(data));
  }
  return lobbies;
}

const socketLobbyMap = new Map();

function broadcastState(id, state) {
  const clientState = {
    ...state,
    chain: state.chain.map(item => ({
       playerId: item.playerId,
       playerName: item.playerName,
       movie: item.movie
    }))
  };
  io.to(id).emit('stateUpdate', clientState);
}

// --- PURE GAME LOGIC ---
async function eliminateCurrentPlayer(id, state, reason) {
  const player = state.players[state.currentTurnIndex];
  if (player) {
    player.isAlive = false;
    io.to(id).emit('notification', `${player.name} eliminated: ${reason}`);
  }
  await checkWinCondition(id, state);
  if (state.status === 'playing') {
    await nextTurn(id, state);
  }
}

async function nextTurn(id, state) {
  await checkWinCondition(id, state);
  if (state.status !== 'playing') return;

  let iterations = 0;
  do {
    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.players.length;
    iterations++;
  } while (!state.players[state.currentTurnIndex].isAlive && iterations < state.players.length);

  resetTimer(state);
  await saveLobby(id, state);
  broadcastState(id, state);
}

function resetTimer(state) {
  const reduction = Math.floor(state.timerMultiplier / 2) * 5;
  const timeRemaining = Math.max(10, 60 - reduction);
  state.turnExpiresAt = Date.now() + (timeRemaining * 1000);
}

async function checkWinCondition(id, state) {
  const alivePlayers = state.players.filter(p => p.isAlive);
  if (alivePlayers.length === 1 && state.players.length > 1) {
    state.status = 'finished';
    state.turnExpiresAt = null;
    
    const winner = alivePlayers[0];
    winner.wins += 1;

    io.to(id).emit('notification', `${winner.name} wins!`);
    await saveLobby(id, state);
    broadcastState(id, state);

    setTimeout(async () => {
      const liveState = await getLobby(id);
      if (liveState && liveState.status === 'finished') {
        liveState.status = 'waiting';
        liveState.players = liveState.players.filter(p => p.connected);
        if (liveState.players.length > 0 && !liveState.players.some(p => p.isHost)) liveState.players[0].isHost = true;
        await saveLobby(id, liveState);
        broadcastState(id, liveState);
      }
    }, 7000);
  } else if (alivePlayers.length === 0) {
      state.status = 'finished';
      state.turnExpiresAt = null;
      await saveLobby(id, state);
      broadcastState(id, state);

      setTimeout(async () => {
        const liveState = await getLobby(id);
        if (liveState && liveState.status === 'finished') {
          liveState.status = 'waiting';
          liveState.players = liveState.players.filter(p => p.connected);
          if (liveState.players.length > 0 && !liveState.players.some(p => p.isHost)) liveState.players[0].isHost = true;
          await saveLobby(id, liveState);
          broadcastState(id, liveState);
        }
      }, 7000);
  }
}

async function startGame(id, state) {
  if (state.players.length < 2) {
    io.to(id).emit('error', "Need at least 2 players!");
    return;
  }
  state.status = 'playing';
  state.chain = [];
  state.usedMovies = [];
  state.timerMultiplier = 0;
  state.previousSharedActors = [];
  state.players.forEach(p => {
      p.isAlive = true;
      p.score = 0;
  });
  state.currentTurnIndex = Math.floor(Math.random() * state.players.length);
  state.isValidating = false;
  
  resetTimer(state);
  await saveLobby(id, state);
  broadcastState(id, state);
}

// --- INITIALIZE SERVER ---
async function startApp() {
  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    console.log('Redis connected');
  } catch (err) {
    console.error("FAIL", err);
  }

  io = new Server(server, { adapter: createAdapter(pubClient, subClient) });

  io.on('connection', (socket) => {
    if (cachedPosters.length > 0) socket.emit('posters', cachedPosters);

    // AUTOCOMPLETE (LRU CACHED)
    socket.on('autocompleteSearch', async ({ query, lobbyId }) => {
      try {
        const room = await getLobby(lobbyId);
        const allowTv = room ? room.allowTvShows : false;
        const searchType = allowTv ? 'multi' : 'movie';
        const cacheKey = `TMDB_SEARCH:${searchType}:${query.toLowerCase()}`;
        
        const cached = await pubClient.get(cacheKey);
        if(cached) return socket.emit('autocompleteResults', JSON.parse(cached));
        
        const res = await fetch(`https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(2000) });
        const data = await res.json();
        const results = (data.results || []).filter(m => m.media_type !== 'person').slice(0, 5).map(m => ({
            title: m.media_type === 'tv' ? m.name : (m.title || m.name),
            year: (m.media_type === 'tv' ? m.first_air_date : m.release_date)?.split('-')[0] || '????',
            poster: m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : null,
            mediaType: m.media_type || 'movie'
        }));
        await pubClient.setEx(cacheKey, 86400, JSON.stringify(results));
        socket.emit('autocompleteResults', results);
      } catch (e) { }
    });

    socket.on('joinLobby', async ({ name, lobbyId }) => {
      let id = (lobbyId || '').trim().toUpperCase() || generateLobbyId();
      let room = await getLobby(id);
      
      if (!room) {
        room = {
          id, status: 'waiting', players: [], currentTurnIndex: 0, chain: [],
          usedMovies: [], hardcoreMode: false, previousSharedActors: [], 
          allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null, isValidating: false
        };
      }
      if (room.status !== 'waiting') return socket.emit('error', 'Lobby is already playing or full.');

      const isHost = room.players.length === 0;
      room.players.push({
        id: socket.id, name, isHost, isAlive: true, connected: true, score: 0, wins: 0
      });
      socketLobbyMap.set(socket.id, id);
      await saveLobby(id, room);
      socket.join(id);
      socket.emit('joined', { lobbyId: id, playerId: socket.id });
      broadcastState(id, room);
    });

    socket.on('requestPublicLobbies', async () => {
      const all = await getAllLobbies();
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
        const room = await getLobby(lobbyId);
        if (room && room.players.find(p => p.id === socket.id)?.isHost) {
            await startGame(lobbyId, room);
        }
    });

    socket.on('togglePublic', async ({lobbyId, state}) => {
        const room = await getLobby(lobbyId);
        if (room && room.status === 'waiting' && room.players.find(p => p.id === socket.id)?.isHost) {
            room.isPublic = !!state; await saveLobby(lobbyId, room); broadcastState(lobbyId, room);
        }
    });
    
    socket.on('toggleHardcore', async ({lobbyId, state}) => {
        const room = await getLobby(lobbyId);
        if (room && room.status === 'waiting' && room.players.find(p => p.id === socket.id)?.isHost) {
            room.hardcoreMode = !!state; await saveLobby(lobbyId, room); broadcastState(lobbyId, room);
        }
    });

    socket.on('toggleTvShows', async ({lobbyId, state}) => {
        const room = await getLobby(lobbyId);
        if (room && room.status === 'waiting' && room.players.find(p => p.id === socket.id)?.isHost) {
            room.allowTvShows = !!state; await saveLobby(lobbyId, room); broadcastState(lobbyId, room);
        }
    });

    socket.on('sendChat', async ({ lobbyId, msg }) => {
        const room = await getLobby(lobbyId);
        if (room) {
          const player = room.players.find(p => p.id === socket.id);
          if (player) io.to(lobbyId).emit('receiveChat', { playerName: player.name, msg });
        }
    });

    socket.on('sendReaction', async ({ lobbyId, emoji }) => {
        const room = await getLobby(lobbyId);
        if (room) io.to(lobbyId).emit('receiveReaction', { emoji, playerId: socket.id });
    });

    // --- TIMEOUT FORCE TURN ---
    socket.on('forceNextTurn', async (lobbyId) => {
        const room = await getLobby(lobbyId);
        if (!room || room.status !== 'playing' || room.isValidating) return;
        
        // Only if it's actually expired! Add 1 sec buffer for sync delays
        if (room.turnExpiresAt && Date.now() > (room.turnExpiresAt + 1000)) {
            await eliminateCurrentPlayer(lobbyId, room, "Time's up!");
        }
    });

    socket.on('submitMovie', async ({ lobbyId, movie }) => {
        let room = await getLobby(lobbyId);
        if (!room || room.status !== 'playing' || room.isValidating || movie.trim().length === 0) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isAlive || room.players[room.currentTurnIndex].id !== socket.id) return;
        
        room.isValidating = true; 
        await saveLobby(lobbyId, room);

        try {
            const searchType = room.allowTvShows ? 'multi' : 'movie';
            const searchRes = await fetch(`https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(movie)}&include_adult=false&language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
            const searchData = await searchRes.json();
            const results = (searchData.results || []).filter(r => r.media_type !== 'person');

            if (results.length === 0) {
                // Must fetch lobby again to modify because of async wait
                room = await getLobby(lobbyId);
                room.isValidating = false;
                await saveLobby(lobbyId, room);
                await eliminateCurrentPlayer(lobbyId, room, "Title not found!");
                return;
            }

            const topCandidates = results.slice(0, 5);
            const candidateMovies = await Promise.all(topCandidates.map(async (c) => {
              try {
                  const mediaType = c.media_type || 'movie';
                  const title = mediaType === 'tv' ? c.name : c.title;
                  const date = mediaType === 'tv' ? c.first_air_date : c.release_date;
                  let endpoint = `https://api.themoviedb.org/3/movie/${c.id}/credits`;
                  if (mediaType === 'tv') endpoint = `https://api.themoviedb.org/3/tv/${c.id}/aggregate_credits`;
                  
                  const credRes = await fetch(`${endpoint}?language=en-US`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
                  const credData = await credRes.json();
                  return { title, year: date ? date.split('-')[0] : 'Unknown', cast: (credData.cast || []).map(actor => actor.name), poster: c.poster_path ? `https://image.tmdb.org/t/p/w92${c.poster_path}` : null, mediaType };
              } catch(e) { return { title: c.name || c.title, year: 'Unknown', cast: [], poster: null, mediaType: c.media_type || 'movie'}; }
            }));

            room = await getLobby(lobbyId);
            if (room.status !== 'playing' || room.players[room.currentTurnIndex].id !== socket.id) {
                room.isValidating = false; await saveLobby(lobbyId, room); return;
            }

            let validMatch = null;
            let matchedActors = [];
            let failReason = "Invalid movie connection.";
            const lastNode = room.chain.length > 0 ? room.chain[room.chain.length - 1] : null;
            const lastNodeCast = lastNode ? (lastNode.fullCast || lastNode.movie.cast) : [];

            for (let i = 0; i < candidateMovies.length; i++) {
                const candidate = candidateMovies[i];
                if (room.usedMovies.includes(candidate.title.toLowerCase())) { if(i===0) failReason = "Movie already used!"; continue; }
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
                room.isValidating = false; await saveLobby(lobbyId, room);
                await eliminateCurrentPlayer(lobbyId, room, failReason); return;
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
            room.usedMovies.push(validMatch.title.toLowerCase());
            room.chain.push({ playerId: player.id, playerName: player.name, movie: validMatch, fullCast: fullCastList });
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if(pIndex > -1) room.players[pIndex].score += 100;

            room.timerMultiplier++;
            room.isValidating = false;
            await nextTurn(lobbyId, room);
        } catch (err) {
            room = await getLobby(lobbyId);
            room.isValidating = false; await saveLobby(lobbyId, room);
            await eliminateCurrentPlayer(lobbyId, room, "API Error or Timeout!");
        }
    });

    async function handleDisconnect(socketId) {
        const lobbyId = socketLobbyMap.get(socketId);
        if (!lobbyId) return;
        socketLobbyMap.delete(socketId);
        
        const room = await getLobby(lobbyId);
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
          await saveLobby(lobbyId, room);

          if (room.players.length === 0) {
              await deleteLobby(lobbyId); return;
          }

          if (room.status === 'playing') {
            await checkWinCondition(lobbyId, room);
            const liveRoom = await getLobby(lobbyId);
            if (liveRoom && liveRoom.status === 'playing' && liveRoom.players[liveRoom.currentTurnIndex]?.id === socketId) {
              await nextTurn(lobbyId, liveRoom);
            }
          }
          
          const finalRoom = await getLobby(lobbyId);
          if(finalRoom) broadcastState(lobbyId, finalRoom);
        }
    }

    socket.on('disconnect', () => handleDisconnect(socket.id));
    socket.on('leaveLobby', async () => {
        socket.leave(socketLobbyMap.get(socket.id));
        await handleDisconnect(socket.id);
    });
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => { console.log(`Server listening on port ${PORT}`); });
}

startApp();
