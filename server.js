require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const lobbies = {};

const TMDB_TOKEN = process.env.TMDB_READ_TOKEN;
const TMDB_HEADERS = {
  Authorization: `Bearer ${TMDB_TOKEN}`,
  accept: 'application/json'
};

const generateLobbyId = () => Math.random().toString(36).substring(2, 6).toUpperCase();

let cachedPosters = [];

async function fetchBackgroundPosters() {
  try {
    const res1 = await fetch(`https://api.themoviedb.org/3/movie/popular?language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
    const data1 = await res1.json();
    const res2 = await fetch(`https://api.themoviedb.org/3/movie/top_rated?language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
    const data2 = await res2.json();
    
    const combined = [...(data1.results || []), ...(data2.results || [])];
    cachedPosters = combined
      .filter(m => m.poster_path)
      .map(m => `https://image.tmdb.org/t/p/w200${m.poster_path}`); // w200 is sufficient for background
      
    // Shuffle the array to make it random mix of old and new
    cachedPosters.sort(() => 0.5 - Math.random());
  } catch (err) {
    console.error("Failed to fetch posters:", err);
  }
}

fetchBackgroundPosters();

class GameRoom {
  constructor(id, io) {
    this.id = id;
    this.io = io;
    this.players = [];
    this.status = 'waiting'; // waiting, playing, finished
    this.currentTurnIndex = 0;
    this.chain = []; // { player, movie: {title, year, cast} }
    this.usedMovies = new Set();
    
    this.timerMultiplier = 0;
    this.timeRemaining = 60;
    this.initialTime = 60;
    this.timerInterval = null;
    this.isValidating = false; // Prevents spamming submits
    this.hardcoreMode = false;
    this.previousSharedActors = [];
    this.allowTvShows = false;
  }

  addPlayer(socket, name) {
    if (this.status !== 'waiting') return false;
    
    const isHost = this.players.length === 0;

    this.players.push({
      id: socket.id,
      name,
      isHost,
      isAlive: true,
      connected: true,
      score: 0,
      wins: 0
    });
    this.broadcastState();
    return true;
  }

  removePlayer(socketId) {
    const player = this.players.find(p => p.id === socketId);
    if (player) {
      player.isAlive = false;
      player.connected = false;
      
      const wasHost = player.isHost;

      if (this.status === 'waiting') {
        this.players = this.players.filter(p => p.id !== socketId);
        
        if (wasHost && this.players.length > 0) {
            this.players[0].isHost = true;
        }
      }
      if (this.status === 'playing') {
        this.checkWinCondition();
        if (this.status === 'playing' && this.players[this.currentTurnIndex]?.id === socketId) {
          this.nextTurn();
        }
      }
      this.broadcastState();
    }
  }

  startGame() {
    if (this.players.length < 2) {
      this.io.to(this.id).emit('error', "Need at least 2 players!");
      return;
    }
    this.status = 'playing';
    this.chain = [];
    this.usedMovies.clear();
    this.timerMultiplier = 0;
    this.previousSharedActors = [];
    this.players.forEach(p => {
        p.isAlive = true;
        p.score = 0;
    });
    this.currentTurnIndex = Math.floor(Math.random() * this.players.length);
    this.isValidating = false;
    
    this.resetTimer();
    this.broadcastState();
  }

  async submitMovie(socketId, movieName) {
    if (this.status !== 'playing' || this.isValidating) return;
    const player = this.players.find(p => p.id === socketId);
    
    if (!player || !player.isAlive || this.players[this.currentTurnIndex].id !== socketId) {
      return;
    }

    this.isValidating = true;

    try {
      // 1. Search TMDB — use multi-search if TV shows are enabled
      const searchType = this.allowTvShows ? 'multi' : 'movie';
      const searchRes = await fetch(`https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(movieName)}&include_adult=false&language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
      const searchData = await searchRes.json();
      
      // Filter out 'person' results from multi-search, only keep movie/tv
      const results = (searchData.results || []).filter(r => r.media_type !== 'person');

      if (results.length === 0) {
        this.eliminateCurrentPlayer("Title not found!");
        return;
      }

      // Check top 5 results for a match to help with ambiguity
      const topCandidates = results.slice(0, 5);

      // 2. Fetch casts concurrently (branch by media_type for TV vs Movie)
      const candidateMovies = await Promise.all(topCandidates.map(async (c) => {
        try {
            const mediaType = c.media_type || 'movie';
            const title = mediaType === 'tv' ? c.name : c.title;
            const date = mediaType === 'tv' ? c.first_air_date : c.release_date;
            const credRes = await fetch(`https://api.themoviedb.org/3/${mediaType}/${c.id}/credits?language=en-US`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
            const credData = await credRes.json();
            return {
                title,
                year: date ? date.split('-')[0] : 'Unknown',
                cast: (credData.cast || []).slice(0, 30).map(actor => actor.name),
                poster: c.poster_path ? `https://image.tmdb.org/t/p/w92${c.poster_path}` : null,
                mediaType
            };
        } catch(e) {
            const mediaType = c.media_type || 'movie';
            return { title: c.media_type === 'tv' ? c.name : c.title, year: 'Unknown', cast: [], poster: null, mediaType };
        }
      }));

      // In case they disconnected or time ran out during the API hits, quietly abort
      if (this.status !== 'playing' || this.players[this.currentTurnIndex].id !== socketId) {
          return;
      }

      let validMatch = null;
      let failReason = "Invalid movie connection.";
      const lastMovie = this.chain.length > 0 ? this.chain[this.chain.length - 1].movie : null;

      for (let i = 0; i < candidateMovies.length; i++) {
          const candidate = candidateMovies[i];
          
          if (this.usedMovies.has(candidate.title.toLowerCase())) {
              if (i === 0) failReason = "Movie already used!";
              continue;
          }

          if (!lastMovie) {
              validMatch = candidate;
              break;
          } else {
              const sharedActors = candidate.cast.filter(actor => 
                  lastMovie.cast.some(lastActor => lastActor.toLowerCase() === actor.toLowerCase())
              );

              if (sharedActors.length > 0) {
                  if (this.hardcoreMode && this.previousSharedActors.length > 0) {
                      const newSharedActors = sharedActors.filter(actor => 
                          !this.previousSharedActors.some(pActor => pActor.toLowerCase() === actor.toLowerCase())
                      );
                      
                      if (newSharedActors.length === 0) {
                          failReason = "Hardcore Mode: You cannot reuse the exact same connecting actor from the previous turn!";
                          continue;
                      }
                      
                      this.previousSharedActors = newSharedActors;
                  } else {
                      this.previousSharedActors = sharedActors;
                  }

                  validMatch = candidate;
                  break;
              }
          }
      }

      if (!validMatch) {
        this.eliminateCurrentPlayer(failReason);
        return;
      }

      // Valid play
      this.usedMovies.add(validMatch.title.toLowerCase());
      this.chain.push({
        playerId: player.id,
        playerName: player.name,
        movie: validMatch
      });
      player.score += 100;

      this.timerMultiplier++;
      this.nextTurn();

    } catch (err) {
      console.error("TMDB API Error:", err);
      this.eliminateCurrentPlayer("API Error or Timeout!");
    } finally {
      this.isValidating = false;
    }
  }

  eliminateCurrentPlayer(reason) {
    const player = this.players[this.currentTurnIndex];
    if (player) {
      player.isAlive = false;
      this.io.to(this.id).emit('notification', `${player.name} eliminated: ${reason}`);
    }

    this.checkWinCondition();
    if (this.status === 'playing') {
      this.nextTurn();
    }
  }

  nextTurn() {
    this.checkWinCondition();
    if (this.status !== 'playing') return;

    let iterations = 0;
    do {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % this.players.length;
      iterations++;
    } while (!this.players[this.currentTurnIndex].isAlive && iterations < this.players.length);

    this.resetTimer();
    this.broadcastState();
  }

  resetTimer() {
    clearInterval(this.timerInterval);
    const reduction = Math.floor(this.timerMultiplier / 2) * 5;
    this.timeRemaining = Math.max(10, this.initialTime - reduction);
    this.io.to(this.id).emit('tick', this.timeRemaining);

    this.timerInterval = setInterval(() => {
      // Don't count down if we are waiting for API
      if (this.isValidating) return;

      this.timeRemaining--;
      this.io.to(this.id).emit('tick', this.timeRemaining);

      if (this.timeRemaining <= 0) {
        clearInterval(this.timerInterval);
        this.eliminateCurrentPlayer("Time's up!");
      }
    }, 1000);
  }

  checkWinCondition() {
    const alivePlayers = this.players.filter(p => p.isAlive);
    if (alivePlayers.length === 1 && this.players.length > 1) {
      this.status = 'finished';
      clearInterval(this.timerInterval);
      
      const winner = alivePlayers[0];
      winner.wins += 1;

      this.io.to(this.id).emit('notification', `${winner.name} wins!`);
      this.broadcastState();

      setTimeout(() => {
        if (this.status === 'finished') {
          this.status = 'waiting';
          this.players = this.players.filter(p => p.connected);
          if (this.players.length > 0 && !this.players.some(p => p.isHost)) {
              this.players[0].isHost = true;
          }
          this.broadcastState();
        }
      }, 7000);
    } else if (alivePlayers.length === 0) {
        this.status = 'finished';
        clearInterval(this.timerInterval);
        this.broadcastState();

        setTimeout(() => {
          if (this.status === 'finished') {
            this.status = 'waiting';
            this.players = this.players.filter(p => p.connected);
            if (this.players.length > 0 && !this.players.some(p => p.isHost)) {
                this.players[0].isHost = true;
            }
            this.broadcastState();
          }
        }, 7000);
    }
  }

  broadcastState() {
    const state = {
      id: this.id,
      status: this.status,
      players: this.players,
      currentTurnIndex: this.currentTurnIndex,
      chain: this.chain,
      timeRemaining: this.timeRemaining,
      hardcoreMode: this.hardcoreMode,
      allowTvShows: this.allowTvShows
    };
    this.io.to(this.id).emit('stateUpdate', state);
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  if (cachedPosters.length > 0) {
    socket.emit('posters', cachedPosters);
  }

  socket.on('autocompleteSearch', async ({ query, lobbyId }) => {
    try {
      const room = lobbies[lobbyId];
      const allowTv = room ? room.allowTvShows : false;
      const searchType = allowTv ? 'multi' : 'movie';
      const res = await fetch(`https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      const results = (data.results || [])
        .filter(m => m.media_type !== 'person')
        .slice(0, 5)
        .map(m => ({
          title: m.media_type === 'tv' ? m.name : (m.title || m.name),
          year: (m.media_type === 'tv' ? m.first_air_date : m.release_date)?.split('-')[0] || '????',
          poster: m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : null,
          mediaType: m.media_type || 'movie'
        }));
      socket.emit('autocompleteResults', results);
    } catch (e) {
      console.error('Autocomplete Error:', e);
    }
  });

  socket.on('sendChat', ({ lobbyId, msg }) => {
    const room = lobbies[lobbyId];
    if (room) {
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
         io.to(lobbyId).emit('receiveChat', { playerName: player.name, msg });
      }
    }
  });

  socket.on('joinLobby', ({ name, lobbyId }) => {
    let id = (lobbyId || '').trim().toUpperCase() || generateLobbyId();
    if (!lobbies[id]) {
      lobbies[id] = new GameRoom(id, io);
    }
    const room = lobbies[id];
    
    if (room.status !== 'waiting') {
      socket.emit('error', 'Lobby is already playing or full.');
      return;
    }

    socket.join(id);
    if (room.addPlayer(socket, name)) {
      socket.emit('joined', { lobbyId: id, playerId: socket.id });
    }
  });

  socket.on('leaveLobby', () => {
    for (const key in lobbies) {
      lobbies[key].removePlayer(socket.id);
      socket.leave(key);
      if (lobbies[key].players.length === 0) {
        clearInterval(lobbies[key].timerInterval);
        delete lobbies[key];
      }
    }
  });

  socket.on('startLobby', (lobbyId) => {
    const room = lobbies[lobbyId];
    if (room) {
      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isHost) {
        room.startGame();
      }
    }
  });

  socket.on('toggleHardcore', ({ lobbyId, state }) => {
    const room = lobbies[lobbyId];
    if (room && room.status === 'waiting') {
      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isHost) {
        room.hardcoreMode = !!state;
        room.broadcastState();
      }
    }
  });

  socket.on('toggleTvShows', ({ lobbyId, state }) => {
    const room = lobbies[lobbyId];
    if (room && room.status === 'waiting') {
      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isHost) {
        room.allowTvShows = !!state;
        room.broadcastState();
      }
    }
  });

  socket.on('submitMovie', async ({ lobbyId, movie }) => {
    const room = lobbies[lobbyId];
    if (room && movie.trim().length > 0) {
      await room.submitMovie(socket.id, movie.trim());
    }
  });

  socket.on('sendReaction', ({ lobbyId, emoji }) => {
    if (lobbies[lobbyId]) {
      io.to(lobbyId).emit('receiveReaction', { emoji, playerId: socket.id });
    }
  });

  socket.on('disconnect', () => {
    for (const key in lobbies) {
      lobbies[key].removePlayer(socket.id);
      if (lobbies[key].players.length === 0) {
        clearInterval(lobbies[key].timerInterval);
        delete lobbies[key];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
