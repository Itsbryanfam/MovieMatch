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
  kickPlayer:   { limit: 5,  windowMs: 10000 },
  // M7: quit-game is destructive but not spammable — a single click ends the
  // player's run, so two events in a 5s window is plenty (covers a stuck-key
  // double-fire while still rejecting any kind of automated abuse pattern).
  quitGame:     { limit: 2,  windowMs: 5000  },
  // H2: Daily Challenge entry point. Same pattern — generous enough for
  // double-clicks, tight enough that a misbehaving client can't pound the
  // TMDB seed-fetch path. The atomic NX claim inside dailySystem is the
  // real correctness guard; this is just throttling.
  dailyChallenge: { limit: 5, windowMs: 30000 },
  dailyLeaderboard: { limit: 10, windowMs: 10000 },
};

// ---------------------------------------------------------------------------
// INPUT HELPERS
// ---------------------------------------------------------------------------

function clampString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen);
}

// safeOn wraps every async handler in a try/catch so an unhandled rejection
// in any one handler can't crash the process. Replaces an earlier socket.on
// monkey-patch — by being explicit at each call site, no future contributor
// can accidentally bypass the safety net by registering before the patch ran.
function safeOn(socket, event, handler, logger) {
  socket.on(event, async (...args) => {
    try {
      await handler(...args);
    } catch (err) {
      logger.error(err, `Socket handler error in '${event}'`);
    }
  });
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

    // Every handler below registers via safeOn instead of socket.on directly.
    // safeOn wraps the handler in a try/catch so an unhandled rejection can't
    // crash the process. This replaces an earlier monkey-patch on socket.on,
    // which only protected handlers registered AFTER the patch — a footgun
    // for any future contributor adding handlers above the patch line.
    const on = (event, handler) => safeOn(socket, event, handler, logger);

    // -----------------------------------------------------------------------
    // POSTERS
    // -----------------------------------------------------------------------

    on('requestPosters', () => {
      const cached = posterCache.getPosters();
      if (cached.length > 0) socket.emit('posters', cached);
    });

    // -----------------------------------------------------------------------
    // LOBBY SYSTEM — join, leave, settings, lifecycle
    // -----------------------------------------------------------------------

    on('joinLobby', async ({ name, lobbyId, stableId }) => {
      if (await rateLimit(socket.id, 'joinLobby', RATE_LIMITS.joinLobby.limit, RATE_LIMITS.joinLobby.windowMs)) return;
      name = clampString(name, 24);
      if (!name || !name.trim()) return socket.emit('error', 'Name cannot be empty.');
      // stableId is a client-generated persistent ID that survives socket reconnects.
      // Fall back to socket.id if the client doesn't supply one.
      stableId = (typeof stableId === 'string' && stableId.length > 0 && stableId.length <= 64) ? stableId : socket.id;
      await lobbySystem.joinLobby(ctx, socket, { name, lobbyId, stableId });
    });

    on('rejoinLobby', async (data) => {
      await lobbySystem.rejoinLobby(ctx, socket, data);
    });

    on('setGameMode', async (data) => {
      await lobbySystem.setGameMode(ctx, socket, data);
    });

    on('assignTeam', async (data) => {
      await lobbySystem.assignTeam(ctx, socket, data);
    });

    on('togglePublic', async (data) => {
      await lobbySystem.toggleSetting(ctx, socket, data, 'isPublic');
    });

    on('toggleHardcore', async (data) => {
      await lobbySystem.toggleSetting(ctx, socket, data, 'hardcoreMode');
    });

    on('toggleTvShows', async (data) => {
      await lobbySystem.toggleSetting(ctx, socket, data, 'allowTvShows');
    });

    on('startLobby', async (lobbyId) => {
      await lobbySystem.startLobby(ctx, socket, lobbyId);
    });

    on('restartLobby', async (lobbyId) => {
      await lobbySystem.restartLobby(ctx, socket, lobbyId);
    });

    on('quitGame', async (lobbyId) => {
      // M7: Server-authoritative — the client only sends a request; the
      // lobbySystem decides whether to eliminate the current turn or just
      // mark the quitter dead based on whose turn it is.
      if (await rateLimit(socket.id, 'quitGame', RATE_LIMITS.quitGame.limit, RATE_LIMITS.quitGame.windowMs)) return;
      await lobbySystem.quitGame(ctx, socket, lobbyId);
    });

    // -----------------------------------------------------------------------
    // DAILY CHALLENGE (H2) — single-player, async, one attempt per UTC day
    // -----------------------------------------------------------------------

    on('startDailyChallenge', async ({ name, stableId }) => {
      if (await rateLimit(socket.id, 'dailyChallenge', RATE_LIMITS.dailyChallenge.limit, RATE_LIMITS.dailyChallenge.windowMs)) return;
      // Defensive name sanitization same as joinLobby — keeps the daily
      // attempt record's display name within bounds. stableId validation
      // is done inside startDailyChallenge (it's the auth signal for the
      // attempt-NX claim).
      const cleanName = clampString(name, 24);
      await lobbySystem.startDailyChallenge(ctx, socket, { name: cleanName, stableId });
    });

    on('requestDailyLeaderboard', async (date) => {
      if (await rateLimit(socket.id, 'dailyLeaderboard', RATE_LIMITS.dailyLeaderboard.limit, RATE_LIMITS.dailyLeaderboard.windowMs)) return;
      // Lazy require to keep the existing top-of-file imports stable; this
      // module is only used by this one handler so a top-level require would
      // be slightly out of place.
      const dailySystem = require('./systems/dailySystem');
      const safeDate = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
        ? date
        : dailySystem.getTodayDate();
      const leaderboard = await dailySystem.getDailyLeaderboard(pubClient, safeDate, 20);
      const puzzleNumber = dailySystem.getPuzzleNumber(safeDate);
      socket.emit('dailyLeaderboard', { date: safeDate, puzzleNumber, leaderboard });
    });

    on('requestPublicLobbies', async () => {
      await lobbySystem.requestPublicLobbies(ctx, socket);
    });

    on('kickPlayer', async (data) => {
      if (await rateLimit(socket.id, 'kickPlayer', RATE_LIMITS.kickPlayer.limit, RATE_LIMITS.kickPlayer.windowMs)) return;
      await lobbySystem.kickPlayer(ctx, socket, data);
    });

    // -----------------------------------------------------------------------
    // MATCH SYSTEM — autocomplete, movie submission, turn forcing
    // -----------------------------------------------------------------------

    on('autocompleteSearch', async ({ query, lobbyId }) => {
      if (typeof query !== 'string' || query.length === 0 || query.length > 100) return;
      if (await rateLimit(socket.id, 'autocomplete', RATE_LIMITS.autocomplete.limit, RATE_LIMITS.autocomplete.windowMs)) return;
      await matchSystem.autocompleteSearch(ctx, socket, { query, lobbyId });
    });

    on('submitMovie', async (data) => {
      // Defensive: if data is missing or movie is unexpectedly long, drop the call.
      // The error boundary would catch any crash here, but checking explicitly
      // avoids a noisy log entry for malformed input.
      if (!data) return;
      if (typeof data.movie === 'string' && data.movie.length > 200) return;
      if (await rateLimit(socket.id, 'submitMovie', RATE_LIMITS.submitMovie.limit, RATE_LIMITS.submitMovie.windowMs)) return;
      await matchSystem.submitMovie(ctx, socket, data);
    });

    on('forceNextTurn', async (lobbyId) => {
      if (await rateLimit(socket.id, 'forceNextTurn', RATE_LIMITS.forceNextTurn.limit, RATE_LIMITS.forceNextTurn.windowMs)) return;
      await matchSystem.forceNextTurn(ctx, socket, lobbyId);
    });

    // -----------------------------------------------------------------------
    // SOCIAL — chat and reactions
    // -----------------------------------------------------------------------

    on('sendChat', async ({ lobbyId, msg }) => {
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

    on('sendReaction', async ({ lobbyId, emoji }) => {
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

    on('disconnect', () => lobbySystem.handleDisconnect(ctx, socket.id));

    on('leaveLobby', async () => {
      const lobbyId = await redisUtils.getSocketLobby(pubClient, socket.id);
      if (lobbyId) socket.leave(lobbyId);
      await lobbySystem.handleDisconnect(ctx, socket.id);
    });
  });
}

module.exports = { setupSocketHandlers, clampString };
