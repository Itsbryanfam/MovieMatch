// ============================================================================
// LOBBY SYSTEM — Lobby lifecycle: create, join, leave, configure, restart
// ============================================================================
// Pure system functions. No socket event binding, no rate limiting.
// Each function receives a context object { io, pubClient, logger }
// and operates on lobby data through redisUtils.
// ============================================================================

const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');

// Unambiguous charset for lobby codes (Crockford base32 — no 0/O, 1/I/L)
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

// ---------------------------------------------------------------------------
// JOIN / SPECTATE
// ---------------------------------------------------------------------------

async function joinLobby(ctx, socket, { name, lobbyId, stableId }) {
  const { io, pubClient } = ctx;

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

  if (global.cachedPosters && global.cachedPosters.length > 0) {
    socket.emit('posters', global.cachedPosters);
  }

  gameLogic.broadcastState(io, id, room);
}

// ---------------------------------------------------------------------------
// RECONNECTION
// ---------------------------------------------------------------------------

async function rejoinLobby(ctx, socket, { lobbyId, playerId }) {
  const { io, pubClient } = ctx;

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

  const oldSocketId = player.id;
  player.id = socket.id;
  player.connected = true;

  await redisUtils.saveLobby(pubClient, lobbyId, room);
  await redisUtils.setSocketLobby(pubClient, socket.id, lobbyId);
  if (oldSocketId !== socket.id) {
    await redisUtils.deleteSocketLobby(pubClient, oldSocketId);
  }

  socket.join(lobbyId);
  socket.emit('rejoinSuccess', { lobbyId, playerId: socket.id, state: room });
  gameLogic.broadcastState(io, lobbyId, room);
}

// ---------------------------------------------------------------------------
// LOBBY CONFIGURATION (host-only settings)
// ---------------------------------------------------------------------------

async function setGameMode(ctx, socket, { lobbyId, mode }) {
  const { io, pubClient } = ctx;
  const validModes = ['classic', 'team', 'solo', 'speed'];
  if (!validModes.includes(mode)) return;
  const room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room || room.status !== 'waiting') return;
  if (!room.players.find(p => p.id === socket.id)?.isHost) return;
  room.gameMode = mode;
  await redisUtils.saveLobby(pubClient, lobbyId, room);
  gameLogic.broadcastState(io, lobbyId, room);
}

async function assignTeam(ctx, socket, { lobbyId, teamId }) {
  const { io, pubClient } = ctx;
  if (teamId !== 0 && teamId !== 1) return;
  const room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room || room.status !== 'waiting') return;
  const player = room.players.find(p => p.id === socket.id);
  if (!player) return;
  player.teamId = teamId;
  await redisUtils.saveLobby(pubClient, lobbyId, room);
  gameLogic.broadcastState(io, lobbyId, room);
}

async function toggleSetting(ctx, socket, { lobbyId, state }, field) {
  const { io, pubClient } = ctx;
  const room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room || room.status !== 'waiting') return;
  if (!room.players.find(p => p.id === socket.id)?.isHost) return;
  room[field] = !!state;
  await redisUtils.saveLobby(pubClient, lobbyId, room);
  gameLogic.broadcastState(io, lobbyId, room);
}

// ---------------------------------------------------------------------------
// GAME LIFECYCLE
// ---------------------------------------------------------------------------

async function startLobby(ctx, socket, lobbyId) {
  const { io, pubClient } = ctx;
  const room = await redisUtils.getLobby(pubClient, lobbyId);
  if (room && room.players.find(p => p.id === socket.id)?.isHost) {
    await gameLogic.startGame(io, pubClient, lobbyId, room);
  }
}

async function restartLobby(ctx, socket, lobbyId) {
  const { io, pubClient } = ctx;
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
}

// ---------------------------------------------------------------------------
// PUBLIC LOBBY BROWSER
// ---------------------------------------------------------------------------

async function requestPublicLobbies(ctx, socket) {
  const { pubClient } = ctx;
  const all = await redisUtils.getAllLobbies(pubClient);
  const publicList = all.filter(r => r.status === 'waiting' && r.isPublic && r.players.length < 8).map(room => {
    const host = room.players.find(p => p.isHost);
    return {
      id: room.id, hostName: host ? host.name : 'Unknown', playerCount: room.players.length,
      hardcoreMode: room.hardcoreMode, allowTvShows: room.allowTvShows
    };
  });
  socket.emit('publicLobbiesList', publicList);
}

// ---------------------------------------------------------------------------
// DISCONNECT / LEAVE
// ---------------------------------------------------------------------------

async function handleDisconnect(ctx, socketId) {
  const { io, pubClient, logger } = ctx;
  const { activeTurnTimeouts } = gameLogic;

  try {
    const lobbyId = await redisUtils.getSocketLobby(pubClient, socketId);
    if (!lobbyId) return;

    const socket = io.sockets.sockets.get(socketId);
    if (socket) socket.leave(lobbyId);

    await redisUtils.deleteSocketLobby(pubClient, socketId);

    const room = await redisUtils.getLobby(pubClient, lobbyId);
    if (!room) return;

    const player = room.players.find(p => p.id === socketId);
    if (!player) {
      if (room.spectators) {
        room.spectators = room.spectators.filter(s => s.id !== socketId);
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        gameLogic.broadcastState(io, lobbyId, room);
      }
      return;
    }

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
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Player disconnected");
      } else {
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

module.exports = {
  generateLobbyId,
  joinLobby,
  rejoinLobby,
  setGameMode,
  assignTeam,
  toggleSetting,
  startLobby,
  restartLobby,
  requestPublicLobbies,
  handleDisconnect,
};
