// ============================================================================
// SOCKET HANDLERS — Thin event router
// ============================================================================
// This file is the TRANSPORT layer. It handles:
//   - Socket event binding
//   - Rate limiting (per-socket Redis-backed)
//   - Input validation and sanitization
//   - Error boundaries
//   - Social events (chat, reactions — too thin for a dedicated system)
//
// All game logic is delegated to systems:
//   - lobbySystem  → lobby lifecycle, join, leave, settings
//   - matchSystem  → TMDB search, movie validation, chain building
//   - gameLogic    → win conditions, timers, state transitions
// ============================================================================

const gameLogic = require('./gameLogic');
const lobbySystem = require('./systems/lobbySystem');
const matchSystem = require('./systems/matchSystem');
const pino = require('pino');
const logger = pino();

// ---------------------------------------------------------------------------
// INPUT HELPERS
// ---------------------------------------------------------------------------

function clampString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// MAIN SETUP
// ---------------------------------------------------------------------------

function setupSocketHandlers(io, pubClient, TMDB_HEADERS) {

  // Shared context passed to all system functions
  const ctx = { io, pubClient, TMDB_HEADERS, logger };

  // Per-socket rate limiter (Redis-backed, atomic pipeline)
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

  // =========================================================================
  // CONNECTION
  // =========================================================================

  io.on('connection', (socket) => {

    // Send cached posters on connect
    if (global.cachedPosters && global.cachedPosters.length > 0) {
      socket.emit('posters', global.cachedPosters);
    }

    // Global error boundary — wraps every handler registered below
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

    // -----------------------------------------------------------------------
    // POSTERS
    // -----------------------------------------------------------------------

    socket.on('requestPosters', () => {
      if (global.cachedPosters && global.cachedPosters.length > 0) {
        socket.emit('posters', global.cachedPosters);
      }
    });

    // -----------------------------------------------------------------------
    // LOBBY SYSTEM — join, leave, settings, lifecycle
    // -----------------------------------------------------------------------

    socket.on('joinLobby', async ({ name, lobbyId, stableId }) => {
      if (await rateLimit(socket.id, 'joinLobby', 5, 60000)) return;
      name = clampString(name, 24);
      if (!name || !name.trim()) return socket.emit('error', 'Name cannot be empty.');
      stableId = (typeof stableId === 'string' && stableId.length > 0 && stableId.length <= 64) ? stableId : socket.id;
      await lobbySystem.joinLobby(ctx, socket, { name, lobbyId, stableId });
    });

    socket.on('rejoinLobby', async (data) => {
      await lobbySystem.rejoinLobby(ctx, socket, data);
    });

    socket.on('setGameMode', async (data) => {
      await lobbySystem.setGameMode(ctx, socket, data);
    });

    socket.on('assignTeam', async (data) => {
      await lobbySystem.assignTeam(ctx, socket, data);
    });

    socket.on('togglePublic', async (data) => {
      await lobbySystem.toggleSetting(ctx, socket, data, 'isPublic');
    });

    socket.on('toggleHardcore', async (data) => {
      await lobbySystem.toggleSetting(ctx, socket, data, 'hardcoreMode');
    });

    socket.on('toggleTvShows', async (data) => {
      await lobbySystem.toggleSetting(ctx, socket, data, 'allowTvShows');
    });

    socket.on('startLobby', async (lobbyId) => {
      await lobbySystem.startLobby(ctx, socket, lobbyId);
    });

    socket.on('restartLobby', async (lobbyId) => {
      await lobbySystem.restartLobby(ctx, socket, lobbyId);
    });

    socket.on('requestPublicLobbies', async () => {
      await lobbySystem.requestPublicLobbies(ctx, socket);
    });

    // -----------------------------------------------------------------------
    // MATCH SYSTEM — autocomplete, movie submission, turn forcing
    // -----------------------------------------------------------------------

    socket.on('autocompleteSearch', async ({ query, lobbyId }) => {
      if (typeof query !== 'string' || query.length === 0 || query.length > 100) return;
      if (await rateLimit(socket.id, 'autocomplete', 20, 10000)) return;
      await matchSystem.autocompleteSearch(ctx, socket, { query, lobbyId });
    });

    socket.on('submitMovie', async (data) => {
      if (typeof data.movie === 'string' && data.movie.length > 200) return;
      if (await rateLimit(socket.id, 'submitMovie', 8, 10000)) return;
      await matchSystem.submitMovie(ctx, socket, data);
    });

    socket.on('forceNextTurn', async (lobbyId) => {
      if (await rateLimit(socket.id, 'forceNextTurn', 2, 5000)) return;
      await matchSystem.forceNextTurn(ctx, socket, lobbyId);
    });

    // -----------------------------------------------------------------------
    // SOCIAL — chat and reactions (inline — too thin for a system)
    // -----------------------------------------------------------------------

    socket.on('sendChat', async ({ lobbyId, msg }) => {
      msg = clampString(msg, 240);
      if (!msg || !msg.trim()) return;
      if (await rateLimit(socket.id, 'chat', 5, 5000)) return;
      const redisUtils = require('./redisUtils');
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
      const redisUtils = require('./redisUtils');
      const room = await redisUtils.getLobby(pubClient, lobbyId);
      if (!room) return;
      const isParticipant = room.players.find(p => p.id === socket.id) || (room.spectators || []).find(s => s.id === socket.id);
      if (!isParticipant) return;
      io.to(lobbyId).emit('receiveReaction', { emoji, playerId: socket.id });
    });

    // -----------------------------------------------------------------------
    // DISCONNECT / LEAVE
    // -----------------------------------------------------------------------

    socket.on('disconnect', () => lobbySystem.handleDisconnect(ctx, socket.id));

    socket.on('leaveLobby', async () => {
      const redisUtils = require('./redisUtils');
      const lobbyId = await redisUtils.getSocketLobby(pubClient, socket.id);
      if (lobbyId) socket.leave(lobbyId);
      await lobbySystem.handleDisconnect(ctx, socket.id);
    });
  });
}

module.exports = { setupSocketHandlers, clampString };
