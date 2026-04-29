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
const posterCache = require('./posterCache');
const redisUtils = require('./redisUtils');
const pino = require('pino');
const logger = pino();

// ---------------------------------------------------------------------------
// RATE LIMIT WINDOWS (per-socket, Redis-backed)
// ---------------------------------------------------------------------------

const RATE_LIMITS = {
  joinLobby:    { limit: 5,  windowMs: 60000 },
  autocomplete: { limit: 20, windowMs: 10000 },
  submitMovie:  { limit: 8,  windowMs: 10000 },
  forceNextTurn:{ limit: 2,  windowMs: 5000  },
  chat:         { limit: 5,  windowMs: 5000  },
  reaction:     { limit: 10, windowMs: 5000  },
};

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

  // Per-socket rate limiter (Redis-backed, atomic pipeline).
  // Returns true if the socket has exceeded the limit and the action should be dropped.
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

  // Finds the player or spectator for a socket in a room.
  // Used to verify participation before broadcasting social events.
  function getParticipantInRoom(room, socketId) {
    const player = room.players.find(p => p.id === socketId);
    const spectator = !player && (room.spectators || []).find(s => s.id === socketId);
    return player || spectator || null;
  }

  // =========================================================================
  // CONNECTION
  // =========================================================================

  io.on('connection', (socket) => {

    // Send cached posters on connect so the background renders immediately
    const cached = posterCache.getPosters();
    if (cached.length > 0) socket.emit('posters', cached);

    // Global error boundary — wraps every handler registered below so an
    // unhandled rejection in any async handler doesn't crash the process.
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
      const cached = posterCache.getPosters();
      if (cached.length > 0) socket.emit('posters', cached);
    });

    // -----------------------------------------------------------------------
    // LOBBY SYSTEM — join, leave, settings, lifecycle
    // -----------------------------------------------------------------------

    socket.on('joinLobby', async ({ name, lobbyId, stableId }) => {
      if (await rateLimit(socket.id, 'joinLobby', RATE_LIMITS.joinLobby.limit, RATE_LIMITS.joinLobby.windowMs)) return;
      name = clampString(name, 24);
      if (!name || !name.trim()) return socket.emit('error', 'Name cannot be empty.');
      // stableId is a client-generated persistent ID that survives socket reconnects.
      // Fall back to socket.id if the client doesn't supply one.
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
      if (await rateLimit(socket.id, 'autocomplete', RATE_LIMITS.autocomplete.limit, RATE_LIMITS.autocomplete.windowMs)) return;
      await matchSystem.autocompleteSearch(ctx, socket, { query, lobbyId });
    });

    socket.on('submitMovie', async (data) => {
      if (typeof data.movie === 'string' && data.movie.length > 200) return;
      if (await rateLimit(socket.id, 'submitMovie', RATE_LIMITS.submitMovie.limit, RATE_LIMITS.submitMovie.windowMs)) return;
      await matchSystem.submitMovie(ctx, socket, data);
    });

    socket.on('forceNextTurn', async (lobbyId) => {
      if (await rateLimit(socket.id, 'forceNextTurn', RATE_LIMITS.forceNextTurn.limit, RATE_LIMITS.forceNextTurn.windowMs)) return;
      await matchSystem.forceNextTurn(ctx, socket, lobbyId);
    });

    // -----------------------------------------------------------------------
    // SOCIAL — chat and reactions
    // -----------------------------------------------------------------------

    socket.on('sendChat', async ({ lobbyId, msg }) => {
      msg = clampString(msg, 240);
      if (!msg || !msg.trim()) return;
      if (await rateLimit(socket.id, 'chat', RATE_LIMITS.chat.limit, RATE_LIMITS.chat.windowMs)) return;
      const room = await redisUtils.getLobby(pubClient, lobbyId);
      if (!room) return;
      const sender = getParticipantInRoom(room, socket.id);
      if (!sender) return;
      const isSpectator = !room.players.find(p => p.id === socket.id);
      io.to(lobbyId).emit('receiveChat', { playerName: sender.name, msg, isSpectator });
    });

    socket.on('sendReaction', async ({ lobbyId, emoji }) => {
      if (typeof emoji !== 'string' || emoji.length > 8) return;
      if (await rateLimit(socket.id, 'reaction', RATE_LIMITS.reaction.limit, RATE_LIMITS.reaction.windowMs)) return;
      const room = await redisUtils.getLobby(pubClient, lobbyId);
      if (!room) return;
      if (!getParticipantInRoom(room, socket.id)) return;
      io.to(lobbyId).emit('receiveReaction', { emoji, playerId: socket.id });
    });

    // -----------------------------------------------------------------------
    // DISCONNECT / LEAVE
    // -----------------------------------------------------------------------

    socket.on('disconnect', () => lobbySystem.handleDisconnect(ctx, socket.id));

    socket.on('leaveLobby', async () => {
      const lobbyId = await redisUtils.getSocketLobby(pubClient, socket.id);
      if (lobbyId) socket.leave(lobbyId);
      await lobbySystem.handleDisconnect(ctx, socket.id);
    });
  });
}

module.exports = { setupSocketHandlers, clampString };
