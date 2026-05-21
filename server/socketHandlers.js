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
  // M3: Typing-indicator pings. Client debounces to ~once per 1.5s while
  // actively typing, so 8 events in a 5s window covers a continuous
  // burst with comfortable headroom while still rejecting any kind of
  // event-flood pattern.
  typing: { limit: 8, windowMs: 5000 },
  // L3: Spectator predictions — one vote per turn, but a spectator might
  // change their mind once before settling. Capping at 3 in 30s lets the
  // intent ("vote yes, then change to no, then back") through while still
  // rejecting any kind of automated tally manipulation.
  spectatorPredict: { limit: 3, windowMs: 30000 },
  // Audit finding #5: events that previously had NO limiter. The README
  // claimed "rate limiting on all events" — these close that gap.
  //   rejoinLobby      — legit on flaky networks / refresh, but unthrottled
  //                       it makes the finding-#1 leak/takeover surface
  //                       loopable; 10/10s tolerates real reconnects.
  //   publicLobbies    — each call fans into sMembers(activeLobbies)+mGet of
  //                       every active lobby; the cheapest amplification
  //                       lever in the app. 12/10s covers browser refreshes.
  //   lobbyConfig      — shared bucket for all host settings + start/restart
  //                       lifecycle events. Generous (30/10s) so a host
  //                       clicking through options is never blocked, but a
  //                       toggle-flood across any mix of them is still capped.
  //   requestPosters   — pure cache read, but still a free socket round-trip.
  rejoinLobby:   { limit: 10, windowMs: 10000 },
  publicLobbies: { limit: 12, windowMs: 10000 },
  lobbyConfig:   { limit: 30, windowMs: 10000 },
  requestPosters:{ limit: 10, windowMs: 10000 },
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

    // L1: Send the theme list once per connection so the lobby's theme
    // picker can populate without a round-trip when the player enters
    // the lobby screen. ~600 bytes, sent once. Same pattern as posters.
    try {
      const themesSystem = require('./systems/themesSystem');
      socket.emit('themesList', themesSystem.listThemes());
    } catch {
      // No themes available is degenerate — client falls back to a
      // single "Any" entry it hardcodes.
    }

    // Every handler below registers via safeOn instead of socket.on directly.
    // safeOn wraps the handler in a try/catch so an unhandled rejection can't
    // crash the process. This replaces an earlier monkey-patch on socket.on,
    // which only protected handlers registered AFTER the patch — a footgun
    // for any future contributor adding handlers above the patch line.
    const on = (event, handler) => safeOn(socket, event, handler, logger);

    // -----------------------------------------------------------------------
    // POSTERS
    // -----------------------------------------------------------------------

    on('requestPosters', async () => {
      // Audit finding #5: previously unthrottled. Cheap (cache read) but
      // still a free server round-trip a client could spin on.
      if (await rateLimit(socket.id, 'requestPosters', RATE_LIMITS.requestPosters.limit, RATE_LIMITS.requestPosters.windowMs)) return;
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

    // Audit finding #5: lobbyConfig is a shared per-socket bucket for the
    // rejoin + all host settings + start/restart lifecycle events. One
    // helper keeps the gate uniform so no handler can silently ship
    // unthrottled again.
    const lobbyConfigLimited = async () =>
      rateLimit(socket.id, 'lobbyConfig', RATE_LIMITS.lobbyConfig.limit, RATE_LIMITS.lobbyConfig.windowMs);

    on('rejoinLobby', async (data) => {
      // Dedicated bucket (not lobbyConfig): reconnects have a different
      // legitimate cadence, and this is the loop guard for finding #1.
      if (await rateLimit(socket.id, 'rejoinLobby', RATE_LIMITS.rejoinLobby.limit, RATE_LIMITS.rejoinLobby.windowMs)) return;
      await lobbySystem.rejoinLobby(ctx, socket, data);
    });

    on('setGameMode', async (data) => {
      if (await lobbyConfigLimited()) return;
      await lobbySystem.setGameMode(ctx, socket, data);
    });

    on('setTheme', async (data) => {
      // L1: Host-only setter; lobbySystem validates the theme id against
      // the whitelist so a buggy/malicious client can't write garbage.
      if (await lobbyConfigLimited()) return;
      await lobbySystem.setTheme(ctx, socket, data);
    });

    on('assignTeam', async (data) => {
      if (await lobbyConfigLimited()) return;
      await lobbySystem.assignTeam(ctx, socket, data);
    });

    on('selectColor', async (data) => {
      // Phase 7.5.3: non-host self-mutation, same cadence class as
      // assignTeam → reuse the shared host/lifecycle limiter (no new
      // bucket — G7). data||{} guard mirrors addBot.
      if (await lobbyConfigLimited()) return;
      await lobbySystem.selectColor(ctx, socket, data || {});
    });

    on('togglePublic', async (data) => {
      if (await lobbyConfigLimited()) return;
      await lobbySystem.toggleSetting(ctx, socket, data, 'isPublic');
    });

    on('toggleHardcore', async (data) => {
      if (await lobbyConfigLimited()) return;
      await lobbySystem.toggleSetting(ctx, socket, data, 'hardcoreMode');
    });

    on('toggleTvShows', async (data) => {
      if (await lobbyConfigLimited()) return;
      await lobbySystem.toggleSetting(ctx, socket, data, 'allowTvShows');
    });

    on('startLobby', async (lobbyId) => {
      if (await lobbyConfigLimited()) return;
      await lobbySystem.startLobby(ctx, socket, lobbyId);
    });

    on('restartLobby', async (lobbyId) => {
      if (await lobbyConfigLimited()) return;
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

    // -----------------------------------------------------------------------
    // PERSONAL STATS (H5) — request the caller's own lifetime stats.
    // Auth model: stableId IS the auth — it's a 16-byte random value the
    // client generated on first visit and persisted to localStorage. Only
    // the owner has it, and we don't gate access by socket.id (which would
    // miss the use case of viewing stats from the hero screen pre-lobby).
    // The ratelimit is shared with dailyLeaderboard since both are simple
    // reads gated by the same kind of player intent.
    // -----------------------------------------------------------------------

    on('requestMyStats', async (stableId) => {
      if (await rateLimit(socket.id, 'dailyLeaderboard', RATE_LIMITS.dailyLeaderboard.limit, RATE_LIMITS.dailyLeaderboard.windowMs)) return;
      if (typeof stableId !== 'string' || stableId.length === 0 || stableId.length > 64) return;
      const statsSystem = require('./systems/statsSystem');
      const stats = await statsSystem.getStats(pubClient, stableId);
      socket.emit('myStats', stats);
    });

    on('requestPublicLobbies', async () => {
      // Audit finding #5: this fans into sMembers(activeLobbies) + mGet of
      // every active lobby — the cheapest Redis amplification lever in the
      // app, so it must be throttled.
      if (await rateLimit(socket.id, 'publicLobbies', RATE_LIMITS.publicLobbies.limit, RATE_LIMITS.publicLobbies.windowMs)) return;
      await lobbySystem.requestPublicLobbies(ctx, socket);
    });

    on('kickPlayer', async (data) => {
      if (await rateLimit(socket.id, 'kickPlayer', RATE_LIMITS.kickPlayer.limit, RATE_LIMITS.kickPlayer.windowMs)) return;
      await lobbySystem.kickPlayer(ctx, socket, data);
    });

    on('addBot', async (data) => {
      // Phase 5a: pre-game host action — reuse the lobbyConfig bucket (the
      // shared host-settings/lifecycle limiter) so add-spam is throttled.
      if (await lobbyConfigLimited()) return;
      await lobbySystem.addBot(ctx, socket, data || {});
    });

    on('removeBot', async (data) => {
      // Phase 5a: mirror addBot — same lobbyConfig bucket throttles remove-spam.
      if (await lobbyConfigLimited()) return;
      await lobbySystem.removeBot(ctx, socket, data || {});
    });

    // -----------------------------------------------------------------------
    // PHASE 7.9 — PLAYABLE HERO (pre-room; no lobby state, no game state)
    // -----------------------------------------------------------------------
    // The hero landing page lets a first-time visitor try one move of the
    // chain mechanic before joining a room. These handlers CANNOT route
    // through matchSystem.autocompleteSearch (matchSystem.js:93-95 requires
    // an existing lobby + socket-in-lobby membership). Hero is pre-room.

    const heroPuzzle = require('./heroPuzzle');

    on('heroPuzzleRequest', async () => {
      // Lazy: client emits once on hero mount. No payload validation needed —
      // the request itself carries no data. Server picks random + strips the
      // multi-actor answer set before emitting back (revealActor stays for
      // the client's local Show Me path).
      const puzzle = heroPuzzle.pickRandomPuzzle();
      socket.emit('heroPuzzleDelivered', heroPuzzle.toClientPuzzle(puzzle));
    });

    on('heroActorSearch', async ({ query }) => {
      // Dedicated channel — does NOT share the autocomplete rate-limit bucket
      // with live-game autocompleteSearch (different surface, different bucket
      // name so a malicious hero spam doesn't deny live-game players).
      if (typeof query !== 'string' || query.length === 0 || query.length > 100) return;
      if (await rateLimit(socket.id, 'heroActorSearch', RATE_LIMITS.autocomplete.limit, RATE_LIMITS.autocomplete.windowMs)) return;
      const results = await heroPuzzle.searchPersonForHero(query, TMDB_HEADERS);
      socket.emit('heroActorResults', { query, results });
    });

    on('heroGuessSubmit', async ({ pairId, actorTmdbId, actorName }) => {
      // Server-authoritative validation against the puzzle bank. Bad inputs
      // (missing pairId, non-numeric tmdbId, oversize actorName) drop silently —
      // the client falls back to its cached bundled outcome on timeout.
      if (typeof pairId !== 'string' || pairId.length === 0 || pairId.length > 100) return;
      if (typeof actorTmdbId !== 'number' || !Number.isInteger(actorTmdbId)) return;
      if (typeof actorName !== 'string' || actorName.length > 200) actorName = '';
      if (await rateLimit(socket.id, 'heroGuessSubmit', RATE_LIMITS.submitMovie.limit, RATE_LIMITS.submitMovie.windowMs)) return;
      const result = heroPuzzle.validateGuess(pairId, actorTmdbId);
      if (!result.ok) {
        // Unknown pairId — wire returns a defensive null reveal so the client
        // can show a generic outcome rather than hanging.
        socket.emit('heroGuessResult', { pairId, correct: false, revealActor: null });
        return;
      }
      socket.emit('heroGuessResult', {
        pairId,
        correct: result.correct,
        revealActor: result.revealActor,
      });
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
      // M4: bump the per-lobby chat counter so the public-lobby browser can
      // render a "chatty / casual / quiet" vibe tag. Audit finding #4: do
      // the increment under the per-lobby lock so two chats in the same
      // window don't both read the same count and lose one (the vibe tag
      // would under-report). Still fire-and-forget — a Redis blip on the
      // counter must not affect the chat broadcast above.
      redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
        r.chatCount = (r.chatCount | 0) + 1;
      }).catch(() => {});
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
    // SPECTATOR PREDICTIONS (L3) — spectators vote will-they-get-it on
    // each turn. Vote totals broadcast via the standard stateUpdate (so
    // every spectator sees the running tally without an extra round-trip)
    // and the play-resolution path emits a one-shot `predictionResult`
    // with accuracy data after each turn settles.
    // -----------------------------------------------------------------------

    on('spectatorPredict', async ({ lobbyId, prediction }) => {
      if (await rateLimit(socket.id, 'spectatorPredict', RATE_LIMITS.spectatorPredict.limit, RATE_LIMITS.spectatorPredict.windowMs)) return;
      if (prediction !== 'yes' && prediction !== 'no') return;
      // Audit finding #4: the predictions map is a read-modify-write on the
      // lobby blob — concurrent votes from different spectators would lose
      // entries (the tally would under-count). Serialize under the lock.
      // The mutator returns false (no save/broadcast) for the not-playing /
      // not-a-spectator cases, matching the old early-returns.
      let voted = false;
      const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
        if (r.status !== 'playing') return false;
        // Spectator-only — players can't vote on their own table since they
        // know what they're going to play. Keeps the tally meaningful.
        const isPlayer = r.players.some(p => p.id === socket.id);
        const isSpectator = !isPlayer && (r.spectators || []).some(s => s.id === socket.id);
        if (!isSpectator) return false;
        // Allow vote-changing within the rate limit — overwrite the prior
        // vote rather than reject. Spectators reading the tally evolve their
        // confidence through the turn and shouldn't be locked to a first guess.
        if (!r.spectatorPredictions || typeof r.spectatorPredictions !== 'object') {
          r.spectatorPredictions = {};
        }
        r.spectatorPredictions[socket.id] = prediction;
        voted = true;
      });
      if (voted && room) gameLogic.broadcastState(io, lobbyId, room);
    });

    // -----------------------------------------------------------------------
    // TYPING INDICATOR (M3) — only the active player's typing is broadcast.
    // We DO NOT broadcast the typed text — only the fact that they're typing,
    // plus the player's display name so other clients can render "X is
    // typing…". Anything more would leak strategy (autocompletion suggests
    // movies the typer is considering) and isn't necessary for the
    // presence cue this feature exists to deliver.
    // -----------------------------------------------------------------------

    on('typing', async (lobbyId) => {
      if (await rateLimit(socket.id, 'typing', RATE_LIMITS.typing.limit, RATE_LIMITS.typing.windowMs)) return;
      const room = await redisUtils.getLobby(pubClient, lobbyId);
      if (!room || room.status !== 'playing') return;
      // Only the active player's typing is announced — broadcasting other
      // players' input would clutter the UI with multiple "is typing"
      // lines that aren't actionable. The active player is the only one
      // whose typing has stakes for everyone else's anticipation.
      const activePlayer = room.players[room.currentTurnIndex];
      if (!activePlayer || activePlayer.id !== socket.id) return;
      // socket.to(lobbyId) emits to everyone in the room EXCEPT the sender,
      // so the typer doesn't see their own indicator (which would be noise).
      socket.to(lobbyId).emit('peerTyping', { playerName: activePlayer.name });
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
