// ============================================================================
// LOBBY SYSTEM — Lobby lifecycle: create, join, leave, configure, restart
// ============================================================================
// Pure system functions. No socket event binding, no rate limiting.
// Each function receives a context object { io, pubClient, logger }
// and operates on lobby data through redisUtils.
// ============================================================================

const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');
const posterCache = require('../posterCache');
const telemetry = require('../telemetry');
const dailySystem = require('./dailySystem');

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w92';
const TMDB_FETCH_TIMEOUT_MS = 5000;

// Unambiguous charset for lobby codes (Crockford base32 — no 0/O, 1/I/L)
const LOBBY_CHARS = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

// In-memory grace period timers — same pattern as activeTurnTimeouts in gameLogic.
// Not Redis-backed: a pod restart during the 15s window would eliminate the player,
// which is acceptable (the 15s is a best-effort courtesy, not a guarantee).
const graceTimers = new Map();
const RECONNECT_GRACE_MS = 15000;

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

  // Uppercase normalization — generated IDs are uppercase, so a lowercase invite link still works.
  let id = (lobbyId || '').trim().toUpperCase() || await generateLobbyId(pubClient);

  // Build the initial state in memory. We'll only persist it if the
  // atomic NX-create wins; otherwise we use the canonical existing state.
  const initialRoom = {
    id, status: 'waiting', players: [], spectators: [], currentTurnIndex: 0, chain: [],
    usedMovies: [], hardcoreMode: false, previousSharedActors: [],
    allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
    isValidating: false, gameMode: 'classic'
  };

  // Atomic create-or-noop: SET NX returns 'OK' if we created the key,
  // null if it already exists. Without this, two players hitting joinLobby
  // simultaneously could both see a null room, both create their own version,
  // and one player's join would be silently overwritten by the other's
  // saveLobby. EX 7200 = 2-hour idle expiry, matching saveLobby's default.
  const wonCreateRace = await pubClient.set(
    `lobby:${id}`,
    JSON.stringify(initialRoom),
    { NX: true, EX: 7200 }
  );
  const isNewLobby = wonCreateRace === 'OK';

  // If we just created the lobby, use our in-memory copy directly — no point
  // re-fetching what we just wrote. If another caller won the race, fetch
  // their canonical state.
  let room = isNewLobby ? initialRoom : await redisUtils.getLobby(pubClient, id);
  if (!room) {
    // The key existed during NX (we lost the race) but expired before we
    // could re-fetch. Extremely rare; bail rather than silently retry.
    return socket.emit('error', 'Lobby unavailable — please try again.');
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

    const cached = posterCache.getPosters();
    if (cached.length > 0) socket.emit('posters', cached);

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

  // H6: Telemetry — only fires on the first join (which created the lobby),
  // not on subsequent joins to an existing lobby. The `mode` field is the
  // initial mode at creation time; if the host changes it later we'll see
  // the change reflected in the `game_started` event.
  if (isNewLobby) {
    telemetry.track(pubClient, 'lobby_created', {
      mode: room.gameMode,
      isPublic: !!room.isPublic,
    });
  }

  const playerPosters = posterCache.getPosters();
  if (playerPosters.length > 0) socket.emit('posters', playerPosters);

  gameLogic.broadcastState(io, id, room);
}

// ---------------------------------------------------------------------------
// RECONNECTION
// ---------------------------------------------------------------------------

async function rejoinLobby(ctx, socket, { lobbyId, playerId, stableId }) {
  const { io, pubClient } = ctx;

  const room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room) {
    socket.emit('rejoinFailed', 'Lobby no longer exists');
    return;
  }

  // stableId is the only identity field that is NOT broadcast in player lists
  // (broadcastState strips it). The rejoin caller must prove they know it,
  // otherwise anyone who sees a victim's socket.id could hijack the slot.
  if (typeof stableId !== 'string' || stableId.length === 0) {
    socket.emit('rejoinFailed', 'Missing identity');
    return;
  }

  // Two paths:
  //   1) Same socket id (transient reconnect on the same tab) — still require stableId match
  //   2) New socket id (page refresh) — only allow if the player is currently disconnected
  const player = room.players.find(p => p.id === playerId && p.stableId === stableId)
    || room.players.find(p => p.stableId === stableId && !p.connected);

  if (!player) {
    socket.emit('rejoinFailed', 'Player not found in lobby');
    return;
  }

  // Clear grace period timer so the player isn't eliminated after reconnecting
  const graceKey = `${lobbyId}:${player.id}`;
  if (graceTimers.has(graceKey)) {
    clearTimeout(graceTimers.get(graceKey));
    graceTimers.delete(graceKey);
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

async function toggleSetting(ctx, socket, { lobbyId, state: enabled }, field) {
  const { io, pubClient } = ctx;
  const room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room || room.status !== 'waiting') return;
  if (!room.players.find(p => p.id === socket.id)?.isHost) return;
  room[field] = !!enabled;
  await redisUtils.saveLobby(pubClient, lobbyId, room);
  gameLogic.broadcastState(io, lobbyId, room);
}

// ---------------------------------------------------------------------------
// KICK PLAYER (host-only, waiting state)
// ---------------------------------------------------------------------------

async function kickPlayer(ctx, socket, { lobbyId, targetId }) {
  const { io, pubClient } = ctx;
  const room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room || room.status !== 'waiting') return;
  if (!room.players.find(p => p.id === socket.id)?.isHost) return;
  if (targetId === socket.id) return; // can't kick yourself

  const target = room.players.find(p => p.id === targetId);
  if (!target) return;

  room.players = room.players.filter(p => p.id !== targetId);
  await redisUtils.saveLobby(pubClient, lobbyId, room);
  await redisUtils.deleteSocketLobby(pubClient, targetId);

  const targetSocket = io.sockets.sockets.get(targetId);
  if (targetSocket) {
    targetSocket.emit('kicked', 'You were removed from the lobby.');
    targetSocket.leave(lobbyId);
  }

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

// ---------------------------------------------------------------------------
// DAILY CHALLENGE (H2)
// ---------------------------------------------------------------------------
// Creates an ephemeral single-player lobby pre-populated with today's seed
// movie as chain[0], then routes the player into the standard playing flow.
// The lobby ID is deterministic per (player, date) so two parallel clicks
// from the same player produce the same lobby (the second hit short-
// circuits via the existing rejoin path) — and players who refresh mid-
// run land back on their lobby via sessionStorage like in regular play.

async function startDailyChallenge(ctx, socket, { name, stableId }) {
  const { io, pubClient, TMDB_HEADERS } = ctx;

  if (typeof stableId !== 'string' || stableId.length === 0) {
    return socket.emit('error', 'Daily Challenge requires a stable identity.');
  }
  const playerName = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 24) : 'Player';

  const date = dailySystem.getTodayDate();
  const puzzleNumber = dailySystem.getPuzzleNumber(date);

  // Atomic claim — one attempt per stableId per UTC day. NX ensures two
  // concurrent clicks (double-tap) can't both create a fresh attempt.
  const claim = await dailySystem.claimDailyAttempt(pubClient, stableId, playerName, date);
  if (!claim) {
    return socket.emit('error', 'Could not start Daily Challenge — please try again.');
  }

  // Already played today: just send the result + leaderboard so the client
  // can show the "you already played, here's your score" view. We do NOT
  // create a new lobby in this case — the previous run's chain is captured
  // in the attempt record (chainLength only; the full chain is ephemeral
  // on the lobby and gets cleaned up after the game ends).
  if (!claim.created) {
    const leaderboard = await dailySystem.getDailyLeaderboard(pubClient, date, 10);
    return socket.emit('dailyAlreadyPlayed', {
      date,
      puzzleNumber,
      attempt: claim.attempt,
      leaderboard,
    });
  }

  // Fresh attempt — bootstrap the lobby with the seed movie as chain[0].
  // Fetch the seed's cast (cached for 7 days via getOrFetchCredits) AND
  // the movie details (for poster + canonical title/year). Two TMDB calls
  // total per player per day — most days hit cache after the first claim.
  let seedMovie;
  try {
    const credits = await redisUtils.getOrFetchCredits(pubClient, claim.seed.id, claim.seed.mediaType, TMDB_HEADERS);
    // We also want the poster path. The credits cache doesn't carry that,
    // so a separate /movie/{id} call. AbortSignal timeout matches the rest
    // of the codebase so a TMDB stall can't freeze the player on the
    // hero screen indefinitely.
    const detailsRes = await fetch(
      `${TMDB_API_BASE}/${claim.seed.mediaType}/${claim.seed.id}?language=en-US`,
      { headers: TMDB_HEADERS, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) }
    );
    const details = await detailsRes.json();
    const posterPath = details.poster_path;
    seedMovie = {
      id: claim.seed.id,
      title: details.title || details.name || claim.seed.title,
      year: String(claim.seed.year || (details.release_date || '').split('-')[0] || ''),
      poster: posterPath ? `${TMDB_POSTER_BASE}${posterPath}` : null,
      cast: (credits.cast || []).map(a => typeof a === 'string' ? { id: null, name: a } : a),
      mediaType: claim.seed.mediaType,
    };
  } catch {
    // TMDB unreachable on the bootstrap call — bail rather than start a
    // broken daily run. The attempt key was claimed via NX, so leave it as
    // in_progress (it'll auto-expire) and let the player retry tomorrow or
    // contact support. Note: NOT idempotent if TMDB recovers in the next
    // few hours — they'd be locked out of today's puzzle.
    return socket.emit('error', "Couldn't reach the movie database. Please try again later.");
  }

  // Lobby ID encodes the player + date so a refresh re-lands on the same
  // run. Truncating the stableId keeps the ID short enough for sessionStorage
  // and URL params if we ever expose it.
  const lobbyId = `DAILY-${stableId.slice(0, 12)}-${date.replace(/-/g, '')}`.toUpperCase().slice(0, 32);

  // Build the lobby. Single-player, daily mode, chain pre-populated with
  // the seed movie (and seed marked as used so it can't be re-played).
  // teamId 0 by convention — never matters in solo modes but the field is
  // expected by various player iterations.
  const room = {
    id: lobbyId,
    status: 'playing',
    players: [{
      id: socket.id,
      name: playerName,
      isHost: true,
      isAlive: true,
      connected: true,
      score: 0,
      wins: 0,
      teamId: 0,
      stableId,
    }],
    spectators: [],
    chain: [{
      // playerId 'daily_seed' is a sentinel — no real player owns the seed;
      // the client renders it as "Today's puzzle" rather than someone's
      // name. The existing chain renderer uses playerName for display.
      playerId: 'daily_seed',
      playerName: `🎬 Daily #${puzzleNumber}`,
      movie: seedMovie,
      matchedActors: [],
    }],
    usedMovies: [`${seedMovie.mediaType}:${seedMovie.id}`],
    hardcoreMode: false,
    previousSharedActors: [],
    allowTvShows: false,
    isPublic: false,
    timerMultiplier: 0,
    turnExpiresAt: null,
    isValidating: false,
    gameMode: 'daily',
    currentTurnIndex: 0,
    currentTurnRetries: 0,
    // Daily-specific metadata so client and server can read puzzle context
    // without recomputing dates everywhere.
    dailyDate: date,
    dailyPuzzleNumber: puzzleNumber,
  };

  // Set the timer for the player's first move (post-seed). Reuses the
  // resetTimer helper, which special-cases gameMode='daily' to a flat 60s.
  gameLogic.resetTimer(room);

  await redisUtils.saveLobby(pubClient, lobbyId, room);
  await redisUtils.setSocketLobby(pubClient, socket.id, lobbyId);
  socket.join(lobbyId);

  // 'joined' tells the client it's in a lobby and can transition screens.
  // We add `isDaily: true` so the client knows to render daily-specific UI
  // (no invite button, daily header instead of room code, etc.).
  socket.emit('joined', { lobbyId, playerId: socket.id, isDaily: true });

  // Push the initial state so the client renders the seed chain entry and
  // turn indicator without a separate request.
  gameLogic.broadcastState(io, lobbyId, room);

  // H6: Telemetry — fired on each fresh claim, NOT on the already-played
  // path. Lets us measure daily DAU and check-in rate over time.
  telemetry.track(pubClient, 'daily_played', {
    date,
    puzzleNumber,
    seedId: seedMovie.id,
  });
}

// Called by gameLogic.checkSoloWin when a daily run ends, so the player's
// final chain length is recorded on the leaderboard and the attempt is
// flipped to 'done'. Lives here (not in gameLogic) to keep the daily-
// specific Redis schema isolated from generic game logic.
async function finalizeDailyOnGameEnd(pubClient, room) {
  if (!room || room.gameMode !== 'daily' || !room.dailyDate) return;
  const player = room.players && room.players[0];
  if (!player || !player.stableId) return;
  // chainLength excludes the seed entry — the seed was supplied, not
  // earned, so a player who couldn't connect on move 1 scores 0, a
  // player with one valid play scores 1, etc.
  const earnedLength = Math.max(0, (room.chain || []).length - 1);
  await dailySystem.finalizeDailyAttempt(
    pubClient,
    player.stableId,
    player.name,
    earnedLength,
    room.dailyDate
  );
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
// QUIT GAME (M7) — graceful in-game leave with no grace period
// ---------------------------------------------------------------------------
// Pre-M7 the only way to leave a game in progress was to disconnect, which
// triggered the 15-second reconnection grace timer in handleDisconnect.
// During those 15 seconds the rest of the table sat watching a frozen turn
// before finally resuming. M7 lets a player explicitly forfeit so the room
// snaps to the next turn without the courtesy delay.

async function quitGame(ctx, socket, lobbyId) {
  const { io, pubClient } = ctx;

  const room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room) return;
  // Only meaningful while the game is actually playing — in waiting/finished
  // states the player should use leaveLobby (which removes them entirely).
  if (room.status !== 'playing') return;

  const player = room.players.find(p => p.id === socket.id);
  if (!player || !player.isAlive) return;

  // Two cases, mirroring handleDisconnect's grace-timer expiry:
  //   1) It's the quitter's turn — eliminate cleanly via the canonical path
  //      so the timer is cleared, win condition is re-checked, and the next
  //      player gets a fresh turn timer.
  //   2) It's someone else's turn — mark dead, re-check win condition, and
  //      broadcast. Don't disturb the active player's timer.
  const isCurrentTurn = room.players[room.currentTurnIndex]?.id === socket.id;
  // H6: Telemetry — fired once per quit, regardless of whose turn it was.
  // Useful for understanding mid-game churn ("how often do people quit?").
  // Tracked separately from `eliminated` so we can distinguish strategic
  // losses from voluntary exits in funnel analysis.
  telemetry.track(pubClient, 'quit_game', {
    mode: room.gameMode,
    chainLength: (room.chain || []).length,
    onOwnTurn: isCurrentTurn,
  });
  if (isCurrentTurn) {
    await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, 'Quit');
  } else {
    player.isAlive = false;
    // 'info' kind = no shake/sound effects — quitting isn't a strategic
    // failure to celebrate or mourn, just a player departing.
    io.to(lobbyId).emit('notification', { msg: `${player.name} quit the game.`, kind: 'info' });
    await redisUtils.saveLobby(pubClient, lobbyId, room);
    await gameLogic.checkWinCondition(io, pubClient, lobbyId, room);
    const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
    if (finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
  }
}

// ---------------------------------------------------------------------------
// DISCONNECT / LEAVE
// ---------------------------------------------------------------------------

async function handleDisconnect(ctx, socketId) {
  const { io, pubClient, logger } = ctx;

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

    // Stop the turn timer so a disconnecting player doesn't trigger a double-elimination
    gameLogic.clearTurnTimeout(lobbyId);

    // In playing state we use a grace period — keep the player alive while they try to reconnect.
    // In all other states, mark them dead immediately.
    player.connected = false;
    if (room.status !== 'playing') {
      player.isAlive = false;
    }

    const wasHost = player.isHost;

    if (room.status === 'waiting') {
      room.players = room.players.filter(p => p.id !== socketId);
      // Promote the next player in join order — no fairness logic needed here
      // since the host role is just for settings/start permissions.
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
      // Broadcast immediately so others see the player as disconnected
      gameLogic.broadcastState(io, lobbyId, room);
      // 'info' kind: no sound/shake effects on the client, just the text overlay.
      io.to(lobbyId).emit('notification', { msg: `${player.name} disconnected — waiting 15s...`, kind: 'info' });

      const graceKey = `${lobbyId}:${socketId}`;
      const graceTimeoutId = setTimeout(async () => {
        graceTimers.delete(graceKey);
        try {
          const liveRoom = await redisUtils.getLobby(pubClient, lobbyId);
          if (!liveRoom || liveRoom.status !== 'playing') return;

          // Find player by stableId (covers page-refresh rejoins that changed socket.id)
          const livePlayer = liveRoom.players.find(p => p.stableId === player.stableId || p.id === socketId);
          if (!livePlayer || livePlayer.connected) return; // already reconnected

          const isCurrentTurn = liveRoom.players[liveRoom.currentTurnIndex]?.id === livePlayer.id;
          if (isCurrentTurn) {
            await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, liveRoom, 'Disconnected');
          } else {
            livePlayer.isAlive = false;
            await redisUtils.saveLobby(pubClient, lobbyId, liveRoom);
            await gameLogic.checkWinCondition(io, pubClient, lobbyId, liveRoom);
            const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
            if (finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
          }
        } catch (err) {
          logger.error(err, 'Grace period elimination error');
        }
      }, RECONNECT_GRACE_MS);

      graceTimers.set(graceKey, graceTimeoutId);
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
  kickPlayer,
  setGameMode,
  assignTeam,
  toggleSetting,
  startLobby,
  restartLobby,
  requestPublicLobbies,
  quitGame,
  startDailyChallenge,
  finalizeDailyOnGameEnd,
  handleDisconnect,
};
