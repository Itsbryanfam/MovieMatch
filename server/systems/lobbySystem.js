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
// Player hard-cap constant (single source of truth — see server/constants.js).
const { MAX_PLAYERS_PER_LOBBY, SEAT_HUES } = require('../constants');
// Phase 5a: bot factory + in-process bot-timer cleanup (lobbySystem→botSystem
// is a plain acyclic top-level require — botSystem only top-level-requires
// fs/path — so no lazy-require / cycle concern here).
const botSystem = require('./botSystem');

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
  // M4: createdAt + chatCount + lastChainLength power the "vibe" tag and
  // last-game stat shown on each public lobby card. createdAt is set
  // once per lobby (NX-create wins); the rest are mutated as the lobby
  // lives. Initialized to safe defaults so older serialized state from
  // before this deploy reads as 0/null without crashing.
  // L1: theme defaults to 'any' (no filter). When set to a real theme,
  // matchSystem filters candidates before validation.
  const initialRoom = {
    id, status: 'waiting', players: [], spectators: [], currentTurnIndex: 0, chain: [],
    usedMovies: [], hardcoreMode: false, previousSharedActors: [],
    allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
    isValidating: false, gameMode: 'classic',
    createdAt: Date.now(),
    chatCount: 0,
    lastChainLength: null,
    theme: 'any',
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

  // Audit finding #4: the NX-create above only prevents double-CREATION.
  // A second player joining the SAME id still did getLobby→push→saveLobby
  // and the two saves raced — one player silently dropped from the array
  // (Codex's headline lost-update example). Do the whole
  // read→decide→append→save inside the per-lobby lock so concurrent joins
  // compose. getPlayerWins (one GET) runs inside the lock; the section is
  // still far shorter than the submit lock's TMDB round-trips.
  let outcome = 'unavailable'; // 'player' | 'spectator' | 'full' | 'unavailable'
  const room = await redisUtils.withLobbyLock(pubClient, id, async (r) => {
    // Spectator path: game already in progress — join as a watcher.
    if (r.status !== 'waiting') {
      if (!r.spectators) r.spectators = [];
      const wins = await redisUtils.getPlayerWins(pubClient, stableId);
      r.spectators.push({ id: socket.id, name, stableId, connected: true, wins });
      outcome = 'spectator';
      return;
    }
    // Player hard cap (MAX_PLAYERS_PER_LOBBY). A brand-new lobby has 0
    // players, so this never wrongly rejects the creator — the old
    // !isNewLobby guard was just an optimization for that always-false case.
    if (r.players.length >= MAX_PLAYERS_PER_LOBBY) { outcome = 'full'; return false; }
    const isHost = r.players.length === 0;
    const teamId = r.players.length % 2;
    const wins = await redisUtils.getPlayerWins(pubClient, stableId);
    // Phase 6b — resolve the joiner's equipped title to a label so every seat
    // can render it. Best-effort read inside the existing lock section (mirrors
    // the getPlayerWins await above); null when unset/unknown → no title shown.
    const titlesSystem = require('./titlesSystem');
    const achievements = require('../achievements');
    const _equippedId = await titlesSystem.getEquippedTitle(pubClient, stableId);
    const titleLabel = _equippedId ? achievements.titleLabel(_equippedId) : null;
    r.players.push({
      id: socket.id, name, isHost, isAlive: true, connected: true,
      score: 0, wins, teamId, stableId, titleLabel,
    });
    outcome = 'player';
  }, { seedRoom: isNewLobby ? initialRoom : undefined });

  if (!room || outcome === 'unavailable') {
    // Lost the NX race and the key expired before the lock read it.
    // Extremely rare; bail rather than silently retry.
    return socket.emit('error', 'Lobby unavailable — please try again.');
  }
  if (outcome === 'full') {
    // Interpolate the constant so the user-facing copy can never drift
    // from the enforced cap. Renders identically: "Lobby is full (8 player maximum)."
    return socket.emit('error', `Lobby is full (${MAX_PLAYERS_PER_LOBBY} player maximum).`);
  }

  // Side-effects AFTER the lock — none of these touch lobby state, so they
  // must not extend the critical section.
  await redisUtils.setSocketLobby(pubClient, socket.id, id);
  if (isNewLobby) await redisUtils.addToActiveLobbies(pubClient, id);
  socket.join(id);

  if (outcome === 'spectator') {
    socket.emit('joined', { lobbyId: id, playerId: socket.id, isSpectator: true });
  } else {
    socket.emit('joined', { lobbyId: id, playerId: socket.id });
    // H6: Telemetry — only on the first join (the one that created the
    // lobby). A new lobby is always 'waiting', so this is unreachable on
    // the spectator path by construction.
    if (isNewLobby) {
      telemetry.track(pubClient, 'lobby_created', {
        mode: room.gameMode,
        isPublic: !!room.isPublic,
      });
    }
  }

  const cached = posterCache.getPosters();
  if (cached.length > 0) socket.emit('posters', cached);

  gameLogic.broadcastState(io, id, room);
}

// ---------------------------------------------------------------------------
// RECONNECTION
// ---------------------------------------------------------------------------

async function rejoinLobby(ctx, socket, { lobbyId, playerId, stableId }) {
  const { io, pubClient } = ctx;

  // T1 audit fix T1e: this was an unlocked getLobby → mutate → saveLobby, so
  // a locked write committed in that window (a submit advancing the turn,
  // another player's disconnect) was silently clobbered by the rejoin's
  // full-blob save. Mutate INSIDE the per-lobby mutex; emits and socket
  // bookkeeping run OUTSIDE it on the room the lock returns (the R1
  // pattern). failMsg/oldSocketId are closure-captured because they are
  // computed on the FRESH in-lock room, which only exists inside the mutator.
  let failMsg = null;
  let oldSocketId = null;

  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    // stableId is the only identity field that is NOT broadcast in player lists
    // (broadcastState strips it). The rejoin caller must prove they know it,
    // otherwise anyone who sees a victim's socket.id could hijack the slot.
    // Checked inside the mutator (not pre-lock) to preserve the original
    // failure precedence: lobby-gone wins over missing-identity.
    if (typeof stableId !== 'string' || stableId.length === 0) {
      failMsg = 'Missing identity';
      return false; // decline — a failed rejoin must not rewrite the blob
    }

    // Two paths:
    //   1) Same socket id (transient reconnect on the same tab) — still require stableId match
    //   2) New socket id (page refresh) — only allow if the player is currently disconnected
    const player = r.players.find(p => p.id === playerId && p.stableId === stableId)
      || r.players.find(p => p.stableId === stableId && !p.connected);

    if (!player) {
      failMsg = 'Player not found in lobby';
      return false; // decline — same no-write semantics as the old early return
    }

    // Clear grace period timer so the player isn't eliminated after
    // reconnecting. In-process + idempotent, so safe inside the mutator —
    // and it must key off the OLD socket id, readable only pre-reassign.
    const graceKey = `${lobbyId}:${player.id}`;
    if (graceTimers.has(graceKey)) {
      clearTimeout(graceTimers.get(graceKey));
      graceTimers.delete(graceKey);
    }

    oldSocketId = player.id;
    player.id = socket.id;
    player.connected = true;
    // Implicit non-false return → withLobbyLock persists this mutation.
  });

  // Null room = lobby vanished — the same emit the old unlocked getLobby
  // null-check produced, just sourced from the lock helper now.
  if (!room) {
    socket.emit('rejoinFailed', 'Lobby no longer exists');
    return;
  }
  if (failMsg) {
    socket.emit('rejoinFailed', failMsg);
    return;
  }

  await redisUtils.setSocketLobby(pubClient, socket.id, lobbyId);
  if (oldSocketId !== socket.id) {
    await redisUtils.deleteSocketLobby(pubClient, oldSocketId);
  }

  // Audit finding #2: if THIS player is the current turn holder and the
  // game is live, re-arm the server watchdog. handleDisconnect cleared it
  // when they dropped (so it couldn't double-eliminate with the grace
  // timer); without re-arming here, a player who disconnects and reconnects
  // within the 15s grace would resume their turn with no server backstop —
  // the same soft-lock this finding is about. armTurnTimeout self-clears
  // any stale handle, so this is safe even if one somehow survived.
  if (room.status === 'playing' && room.players[room.currentTurnIndex]?.id === socket.id) {
    gameLogic.armTurnTimeout(io, pubClient, lobbyId, room);
  }

  socket.join(lobbyId);
  // SECURITY (audit finding #1): emit the client-safe projection, NOT the
  // raw Redis room. The raw object carries every player's stableId (the
  // rejoin bearer secret) plus the raw spectator list; sending it let any
  // participant harvest all stableIds and then take over any slot — host
  // included. toClientState is the same shape broadcastState uses, so the
  // client (which already consumes that shape on every stateUpdate) needs
  // no changes.
  socket.emit('rejoinSuccess', { lobbyId, playerId: socket.id, state: gameLogic.toClientState(room) });
  gameLogic.broadcastState(io, lobbyId, room);
}

// ---------------------------------------------------------------------------
// LOBBY CONFIGURATION (host-only settings)
// ---------------------------------------------------------------------------

async function setGameMode(ctx, socket, { lobbyId, mode }) {
  const { io, pubClient } = ctx;
  const validModes = ['classic', 'team', 'solo', 'speed'];
  if (!validModes.includes(mode)) return;
  // Audit finding #4: do the read-check-mutate-save under the per-lobby
  // lock so a simultaneous join / other settings change can't clobber it.
  // The mutator returns false (→ no save, no broadcast) for the not-waiting
  // / not-host cases, exactly matching the old early-return behavior.
  let changed = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') return false;
    if (!r.players.find(p => p.id === socket.id)?.isHost) return false;
    r.gameMode = mode;
    changed = true;
  });
  if (changed && room) gameLogic.broadcastState(io, lobbyId, room);
}

// Phase 6c — apply a named rule kit. Composes the SAME field-writes as
// setTheme/setGameMode/toggleSetting under ONE lock with the SAME host-only +
// waiting-state guards, and validates every field against the existing
// whitelists (so a kit can never set an illegal theme/mode). One broadcast.
async function selectRuleKit(ctx, socket, { lobbyId, kitId }) {
  const { io, pubClient } = ctx;
  const ruleKits = require('../ruleKits');
  const themesSystem = require('./themesSystem');
  const kit = ruleKits.getKit(kitId);
  if (!kit) return; // unknown kit → no-op (no lock taken)
  const validModes = ['classic', 'team', 'solo', 'speed'];
  if (!themesSystem.isValidTheme(kit.theme)) return; // defensive (catalog test guards this)
  if (!validModes.includes(kit.mode)) return;
  let changed = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') return false;
    if (!r.players.find(p => p.id === socket.id)?.isHost) return false;
    r.theme = kit.theme;
    r.gameMode = kit.mode;
    r.hardcoreMode = !!kit.hardcore;
    r.allowTvShows = !!kit.tvShows;
    changed = true;
  });
  if (changed && room) gameLogic.broadcastState(io, lobbyId, room);
}

// L1: Host-only setter for the lobby theme. Validated against the
// themesSystem whitelist so a malicious client can't set an arbitrary
// string (which would degrade safely via matchesTheme's fallback, but
// would also clutter the room state with junk).
async function setTheme(ctx, socket, { lobbyId, theme }) {
  const { io, pubClient } = ctx;
  const themesSystem = require('./themesSystem');
  if (!themesSystem.isValidTheme(theme)) return;
  // Audit finding #4: serialized read-modify-write (see setGameMode).
  let changed = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') return false;
    if (!r.players.find(p => p.id === socket.id)?.isHost) return false;
    r.theme = theme;
    changed = true;
  });
  if (changed && room) gameLogic.broadcastState(io, lobbyId, room);
}

// Phase 6b — equip a title. Re-derives the earned set server-side (defense at
// the persistence boundary), persists via titlesSystem, and — if the player is
// currently seated in a room — updates their in-room titleLabel and re-broadcasts
// so every seat reflects the change live. Fail-closed: any miss/error leaves
// state unchanged and never throws.
async function setEquippedTitle(ctx, socket, { stableId, titleId }) {
  const { io, pubClient } = ctx;
  const statsSystem = require('./statsSystem');
  const achievements = require('../achievements');
  const titlesSystem = require('./titlesSystem');

  // Unknown title id → no-op (defense; the client only offers catalog ids).
  if (!achievements.titleLabel(titleId)) return;

  // Re-derive THIS player's earned set from their own anonymous stats.
  const stats = await statsSystem.getStats(pubClient, stableId);
  const earned = achievements.deriveEarned(stats);
  if (!earned.includes(titleId)) return; // not earned → refuse

  await titlesSystem.setEquippedTitle(pubClient, stableId, titleId, earned);

  // Live-reflect on the player's seat if they're in a room right now.
  const lobbyId = await redisUtils.getSocketLobby(pubClient, socket.id);
  if (!lobbyId) return;
  const label = achievements.titleLabel(titleId);
  let changed = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    const p = r.players.find(pl => pl.id === socket.id);
    if (!p) return false;
    p.titleLabel = label;
    changed = true;
  });
  if (changed && room) gameLogic.broadcastState(io, lobbyId, room);
}

async function assignTeam(ctx, socket, { lobbyId, teamId }) {
  const { io, pubClient } = ctx;
  if (teamId !== 0 && teamId !== 1) return;
  // Audit finding #4: serialized read-modify-write (see setGameMode).
  let changed = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') return false;
    const player = r.players.find(p => p.id === socket.id);
    if (!player) return false;
    player.teamId = teamId;
    changed = true;
  });
  if (changed && room) gameLogic.broadcastState(io, lobbyId, room);
}

// Phase 7.5.3 (Pick-Your-Own-Colour): a player claims a free seat-hue.
// NON-host self-mutation — you only ever recolour yourself, so (exactly
// like assignTeam) there is NO host check. Claim-only: rejected if the
// requested hue is any OTHER player's EFFECTIVE hue (their explicit
// colorHue, else SEAT_HUES[their room-array slot]). Server-authoritative
// palette validation (the setTheme whitelist precedent). RMW strictly
// under withLobbyLock so a concurrent join/settings change can't clobber
// the write (audit finding #4, mirrors every sibling mutator). colorHue
// is a frozen-palette integer → ZERO identity (never stableId/name/id);
// toClientState ships it via ...rest with no projection change.
async function selectColor(ctx, socket, { lobbyId, hue }) {
  const { io, pubClient } = ctx;
  if (!Number.isInteger(hue) || !SEAT_HUES.includes(hue)) return;
  let changed = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') return false;
    const meIdx = r.players.findIndex(p => p.id === socket.id);
    if (meIdx === -1) return false;
    const taken = r.players.some((p, i) => {
      if (i === meIdx) return false; // own seat — skip (not a blocker; `some` reads false as "continue")
      const eff = (Number.isInteger(p.colorHue) && SEAT_HUES.includes(p.colorHue))
        ? p.colorHue
        : SEAT_HUES[((i % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length];
      return eff === hue;
    });
    if (taken) return false;
    r.players[meIdx].colorHue = hue;
    changed = true;
  });
  if (changed && room) gameLogic.broadcastState(io, lobbyId, room);
}

async function toggleSetting(ctx, socket, { lobbyId, state: enabled }, field) {
  const { io, pubClient } = ctx;
  // Audit finding #4: serialized read-modify-write (see setGameMode).
  let changed = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') return false;
    if (!r.players.find(p => p.id === socket.id)?.isHost) return false;
    r[field] = !!enabled;
    changed = true;
  });
  if (changed && room) gameLogic.broadcastState(io, lobbyId, room);
}

// ---------------------------------------------------------------------------
// KICK PLAYER (host-only, waiting state)
// ---------------------------------------------------------------------------

async function kickPlayer(ctx, socket, { lobbyId, targetId }) {
  const { io, pubClient } = ctx;
  if (targetId === socket.id) return; // can't kick yourself
  // Audit finding #4: removing a player from the array is a read-modify-
  // write; under the lock so a concurrent join/settings change can't
  // resurrect the kicked player by saving a stale snapshot on top.
  let kicked = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') return false;
    if (!r.players.find(p => p.id === socket.id)?.isHost) return false;
    if (!r.players.find(p => p.id === targetId)) return false;
    r.players = r.players.filter(p => p.id !== targetId);
    kicked = true;
  });
  if (!kicked || !room) return;

  // Socket-side effects happen AFTER the lock is released — they don't
  // touch lobby state and shouldn't extend the critical section.
  await redisUtils.deleteSocketLobby(pubClient, targetId);
  const targetSocket = io.sockets.sockets.get(targetId);
  if (targetSocket) {
    targetSocket.emit('kicked', 'You were removed from the lobby.');
    targetSocket.leave(lobbyId);
  }
  gameLogic.broadcastState(io, lobbyId, room);
}

// Phase 5a: host adds an AI opponent to a WAITING classic/speed lobby. RMW
// under withLobbyLock (mirrors kickPlayer's finding-#4 reasoning — a stale
// snapshot save must not resurrect/lose a bot). Gated to classic/speed: team
// needs balanced bot assignment and solo/daily are single-player by design
// (out of scope this phase).
async function addBot(ctx, socket, { lobbyId, difficulty }) {
  const { io, pubClient } = ctx;
  let added = false;
  let rejection = null;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') { rejection = 'Bots can only be added before the game starts.'; return false; }
    if (!r.players.find(p => p.id === socket.id)?.isHost) { rejection = 'Only the host can add bots.'; return false; }
    if (r.gameMode !== 'classic' && r.gameMode !== 'speed') { rejection = 'Bots are only available in Classic and Speed modes.'; return false; }
    if (r.players.length >= MAX_PLAYERS_PER_LOBBY) { rejection = `Lobby is full (${MAX_PLAYERS_PER_LOBBY} player maximum).`; return false; }
    r.players.push(botSystem.createBot(r.players, difficulty));
    added = true;
  });
  if (rejection) return socket.emit('error', rejection);
  if (added && room) gameLogic.broadcastState(io, lobbyId, room);
}

// Phase 5a: host removes a bot pre-game (the bot analogue of kickPlayer;
// bots have no socket, so the socket-teardown steps kickPlayer runs (deleteSocketLobby / targetSocket.leave / 'kicked' emit) are intentionally skipped).
async function removeBot(ctx, socket, { lobbyId, targetId }) {
  const { io, pubClient } = ctx;
  let removed = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') return false;
    if (!r.players.find(p => p.id === socket.id)?.isHost) return false;
    const target = r.players.find(p => p.id === targetId);
    if (!target || !target.isBot) return false; // never remove a human via this path
    r.players = r.players.filter(p => p.id !== targetId);
    removed = true;
  });
  if (removed && room) gameLogic.broadcastState(io, lobbyId, room);
}

// ---------------------------------------------------------------------------
// GAME LIFECYCLE
// ---------------------------------------------------------------------------

async function startLobby(ctx, socket, lobbyId) {
  const { io, pubClient } = ctx;
  const room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room) return;
  // SECURITY (audit finding #3): only the host may start, and ONLY from the
  // waiting room. Without the status gate a stray/duplicate startLobby (or a
  // malicious client that took the host slot) re-runs startGame on a live or
  // finished match, wiping chain/usedMovies, reviving the dead, and zeroing
  // scores. Mirrors the room.status checks every other host-only mutator
  // (setGameMode/kickPlayer/restartLobby) already enforces.
  //
  // T2c-ii (audit P1-3): these snapshot checks are now only the cheap
  // fast-reject — two concurrent clicks both pass them (both reads see
  // 'waiting'). The AUTHORITATIVE gate re-runs on FRESH state inside
  // startGame's withLobbyLock mutator: status via startGame itself, the
  // host seat via verifyFresh below — so the race loser declines instead of
  // double-firing game_started telemetry/recordGamePlayed and re-running
  // the whole game setup.
  if (room.status !== 'waiting') return;
  if (!room.players.find(p => p.id === socket.id)?.isHost) return;
  await gameLogic.startGame(io, pubClient, lobbyId, room, {
    // Re-verify the clicking socket still holds the host seat on the
    // in-lock fresh room (host migration can land in the gate window).
    verifyFresh: (fresh) => !!fresh.players.find(p => p.id === socket.id)?.isHost,
  });
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
    // broken daily run. Audit finding #7: the attempt was NX-claimed BEFORE
    // this fetch, so without a rollback a transient TMDB blip would lock the
    // player out of today's puzzle entirely. Release the in-progress claim
    // (compare-and-delete: only if still in_progress AND the same attempt we
    // just created) so a retry can start cleanly once TMDB recovers.
    await dailySystem.releaseInProgressAttempt(
      pubClient, stableId, date, claim.attempt && claim.attempt.startedAt
    );
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
  // T4a audit fix: register the daily lobby in the activeLobbies set and arm
  // its first-turn watchdog — joinLobby does both for regular lobbies, but
  // this bespoke daily-bootstrap path skipped them entirely. WHY it matters:
  // boot-recovery (recoverActiveTurns) and the 30s sweep (sweepMissingTurnWatchdogs)
  // BOTH iterate the activeLobbies set, so an unregistered daily run is invisible
  // to them — a deploy mid-run strands the attempt 'in_progress' with no server
  // watchdog, locking the player out of today's puzzle until the next UTC day.
  // addToActiveLobbies makes the lobby recoverable; armTurnTimeout gives the
  // opening (post-seed) turn the same server backstop every other game gets.
  // deleteLobby already sRem's the id from activeLobbies on cleanup, so this
  // adds no leak. Both are post-save, matching joinLobby/startGame ordering.
  await redisUtils.addToActiveLobbies(pubClient, lobbyId);
  gameLogic.armTurnTimeout(io, pubClient, lobbyId, room);
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
  // Audit finding #4: serialized so a late join / disconnect landing during
  // the reset can't be lost (or resurrect cleared game state).
  let restarted = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (!r.players.find(p => p.id === socket.id)?.isHost) return false;
    if (r.status !== 'finished') return false;
    r.status = 'waiting';
    r.chain = [];
    r.usedMovies = [];
    r.winner = null;
    r.timerMultiplier = 0;
    r.previousSharedActors = [];
    r.players.forEach(p => { p.isAlive = true; p.score = 0; });
    gameLogic.promoteSpectators(r);
    restarted = true;
  });
  if (restarted && room) gameLogic.broadcastState(io, lobbyId, room);
}

// ---------------------------------------------------------------------------
// PUBLIC LOBBY BROWSER
// ---------------------------------------------------------------------------

// M4: Bucket free-form host-win counts into stable skill labels. Visible
// on every public lobby card so a brand-new player can avoid joining a
// veteran's room (and vice versa). Numbers are intentionally generous
// at the low end so a player isn't labeled "Vet" after a single hot
// streak — the top tier is meant to flag "this person plays a lot."
function _skillBracketForWins(wins) {
  if (wins >= 10) return { label: 'Vet', icon: '🏆' };
  if (wins >= 3)  return { label: 'Casual', icon: '🎯' };
  return { label: 'New', icon: '🌱' };
}

// M4: Compute the chat-vibe tag from chat-count and lobby age. Default
// to "Quiet" for very young lobbies so a brand-new lobby with zero chat
// (because nobody's joined yet) doesn't read as "silent" — it just hasn't
// had time. After ~3 minutes of activity the rate becomes meaningful.
function _vibeTag(chatCount, createdAt) {
  const ageMs = Math.max(1, Date.now() - (createdAt || Date.now()));
  const ageMin = ageMs / 60000;
  if (ageMin < 1.5) return null; // too new to call — render as "no tag"
  const ratePerMin = (chatCount || 0) / ageMin;
  if (ratePerMin >= 0.6) return { label: 'Chatty', icon: '🗣️' };
  if (ratePerMin >= 0.15) return { label: 'Casual chat', icon: '💬' };
  return { label: 'Quiet', icon: '🔇' };
}

async function requestPublicLobbies(ctx, socket) {
  const { pubClient } = ctx;
  const all = await redisUtils.getAllLobbies(pubClient);
  // Only surface lobbies with a free slot (same cap as joinLobby).
  const publicList = all.filter(r => r.status === 'waiting' && r.isPublic && r.players.length < MAX_PLAYERS_PER_LOBBY).map(room => {
    const host = room.players.find(p => p.isHost);
    const hostWins = host ? (host.wins | 0) : 0;
    const skill = _skillBracketForWins(hostWins);
    const vibe = _vibeTag(room.chatCount, room.createdAt);
    return {
      id: room.id,
      hostName: host ? host.name : 'Unknown',
      playerCount: room.players.length,
      hardcoreMode: room.hardcoreMode,
      allowTvShows: room.allowTvShows,
      // M4 enrichment fields. All are best-effort — older lobbies (created
      // before the deploy that added these) will read as null/0/default,
      // which the client renderer tolerates by hiding the line entirely.
      hostWins,
      skill,
      vibe,
      lastChainLength: typeof room.lastChainLength === 'number' ? room.lastChainLength : null,
      gameMode: room.gameMode || 'classic',
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
    // T1 audit fix T1c: this branch was the lone eliminateCurrentPlayer call
    // site holding NO submit lock (watchdog, forceNextTurn, and bot-whiff all
    // take it) and it passed the UNLOCKED snapshot from the top of quitGame.
    // eliminateCurrentPlayer mutates state, advances the turn, and saves —
    // doing that on a stale snapshot races an in-flight submit (double
    // elimination, or a committed chain advance silently clobbered). Mirror
    // forceNextTurn exactly: lock → fresh in-lock re-read → re-verify →
    // eliminate the FRESH room → token-guarded release.
    const lockToken = await redisUtils.acquireSubmitLock(pubClient, lobbyId);
    // No lock = a submit/forceNextTurn/watchdog already holds it and is
    // advancing this very turn itself — quitting now is a no-op, not an
    // error (the player can simply quit again once that resolves).
    if (!lockToken) return;
    try {
      // Every check below must re-run against state the previous lock holder
      // finished writing — our pre-lock snapshot only chose the branch.
      const fresh = await redisUtils.getLobby(pubClient, lobbyId);
      if (!fresh || fresh.status !== 'playing') return;
      const freshPlayer = fresh.players.find(p => p.id === socket.id);
      // Already eliminated while we waited (e.g. the watchdog beat us) —
      // eliminating again would advance the turn twice.
      if (!freshPlayer || !freshPlayer.isAlive) return;
      // Turn moved on while the quit was in flight: "current player" is now
      // someone ELSE — eliminating them off our stale view kills the wrong
      // player, the exact race this lock exists to prevent.
      if (fresh.players[fresh.currentTurnIndex]?.id !== socket.id) return;
      await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, fresh, 'Quit');
    } finally {
      // Token-guarded by construction (returned above when acquire failed).
      // .catch mirrors forceNextTurn: a failed release self-heals via the
      // lock's 30s TTL and must never mask an eliminate error.
      await redisUtils.releaseSubmitLock(pubClient, lobbyId, lockToken).catch(() => {});
    }
  } else {
    // R1: previously this did an unlocked getLobby (top of quitGame) ->
    // mutate -> saveLobby, so a concurrent submit/quit/grace-expiry on the
    // same lobby could interleave and clobber the write (a dead player
    // resurrected, or a chain advance lost). Mutate INSIDE the per-lobby
    // mutex; broadcast OUTSIDE it on the room the lock returns — the exact
    // pattern every other withLobbyLock caller in this file uses. `changed`
    // is the side-channel commit signal: withLobbyLock returns the room
    // whenever the lobby exists (null only if it's gone), so we cannot use
    // the returned room to tell "mutator committed" from "mutator declined"
    // (already-dead/absent player) — without this we'd emit a spurious
    // "X quit" + broadcast on an unmodified room.
    let changed = false;
    const updated = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
      const lp = r.players.find(p => p.id === socket.id);
      if (!lp || !lp.isAlive) return false;
      lp.isAlive = false;
      changed = true;
    });
    if (changed && updated) {
      // Name from the fresh in-lock room (changed === true guarantees the
      // player is present on `updated`), not the pre-lock snapshot.
      const quitter = updated.players.find(p => p.id === socket.id);
      // 'info' kind = no shake/sound effects — quitting isn't a strategic
      // failure to celebrate or mourn, just a player departing.
      io.to(lobbyId).emit('notification', { msg: `${quitter.name} quit the game.`, kind: 'info' });
      await gameLogic.checkWinCondition(io, pubClient, lobbyId, updated);
      const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
      if (finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
    }
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

    // T1 audit fix T1e: this function did an unlocked getLobby → mutate →
    // saveLobby — and disconnects are the single most frequent event on the
    // site, so a concurrent locked write (join, submit commit, settings
    // change) committing in that window was silently clobbered by the
    // full-blob save. Mutate INSIDE the per-lobby mutex; io/timer
    // side-effects run OUTSIDE it on the room the lock returns (the R1
    // pattern). The closure flags below carry decisions computed on the
    // FRESH in-lock room out to those side-effects.
    let isSpectatorPath = false;     // socket wasn't a player → spectator handling
    let spectatorsTouched = false;   // spectator array existed → save + broadcast (old behavior even when the filter no-ops)
    let disconnectedPlayer = null;   // fresh player object for the grace/notification block
    let shouldClearWatchdog = false; // watchdog decision from fresh status/turn
    let shouldTearDown = false;      // no connected humans left → delete lobby

    const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
      const player = r.players.find(p => p.id === socketId);
      if (!player) {
        isSpectatorPath = true;
        // No spectator array → nothing to mutate; decline the save (false),
        // exactly like the old early-return-without-save.
        if (!r.spectators) return false;
        r.spectators = r.spectators.filter(s => s.id !== socketId);
        spectatorsTouched = true;
        return; // persist the (possibly no-op) filter — old behavior saved here too
      }

      // Audit finding #2: only clear the turn watchdog if the disconnecting
      // socket is the CURRENT turn holder. Clearing it unconditionally (the
      // old behavior) meant a bystander dropping their connection wiped the
      // active player's only server-side timer, leaving that turn advanceable
      // solely by the active client's forceNextTurn — a soft-lock lever.
      // When the current player is the one leaving we DO clear it: the 15s
      // grace timer below owns their elimination, and a live watchdog would
      // double-eliminate. (The grace→eliminate→nextTurn path re-arms for the
      // next player; rejoinLobby re-arms if they return within grace.)
      // T1e: the DECISION is computed here on locked-fresh state; the
      // clearTurnTimeout call itself is an in-process side-effect and runs
      // after the lock releases (R1: io/timer work stays outside the mutex).
      shouldClearWatchdog =
        r.status !== 'playing' ||
        r.players[r.currentTurnIndex]?.id === socketId;

      // In playing state we use a grace period — keep the player alive while they try to reconnect.
      // In all other states, mark them dead immediately.
      player.connected = false;
      if (r.status !== 'playing') {
        player.isAlive = false;
      }

      const wasHost = player.isHost;

      if (r.status === 'waiting') {
        r.players = r.players.filter(p => p.id !== socketId);
        // Phase 5a: a bot must NEVER become host (host = settings/start
        // authority). Promote the first remaining HUMAN; if only bots remain,
        // leave no host — the no-human cleanup below will tear the lobby down.
        if (wasHost) {
          const nextHuman = r.players.find(p => !p.isBot);
          if (nextHuman) nextHuman.isHost = true;
        }
      }

      // Captured for the post-lock grace-timer/notification block, which
      // needs the FRESH player's name/stableId (not a stale snapshot's).
      disconnectedPlayer = player;

      // Phase 5a: generalize "no players" to "no connected humans". In WAITING
      // state a bots-only lobby can never start and would ghost forever (bots
      // never fire 'disconnect' and never empty room.players). In PLAYING state
      // a bots-only remnant is also unrecoverable — no human can re-enter a game
      // mid-play — so we tear down immediately (below, outside the lock), BEFORE
      // the grace-timer block, intentionally giving the last human no 15s
      // reconnect window (bots can't run the game forward for a reconnect
      // anyway). Decided here on the fresh post-mutation player list.
      const connectedHumans = r.players.filter(p => !p.isBot && p.connected);
      shouldTearDown = r.players.length === 0 || connectedHumans.length === 0;
    });

    // Lobby vanished between the socket mapping and the lock — same early
    // return as the old unlocked getLobby null-check.
    if (!room) return;

    if (isSpectatorPath) {
      if (spectatorsTouched) gameLogic.broadcastState(io, lobbyId, room);
      return;
    }

    if (shouldClearWatchdog) {
      gameLogic.clearTurnTimeout(lobbyId);
    }

    if (shouldTearDown) {
      gameLogic.clearTurnTimeout(lobbyId);
      // Clear the in-process bot-move timer too so a pending bot fire can't
      // act against a torn-down lobby. Top-level botSystem ref (acyclic).
      botSystem.clearBotTimeout(lobbyId);
      await redisUtils.deleteLobby(pubClient, lobbyId);
      return;
    }

    // From here down everything is read-only side-effects on the room the
    // lock returned (already persisted above) — alias the captured fresh
    // player under the name the grace-timer block has always used.
    const player = disconnectedPlayer;

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
            // T2c-i (audit P1-3): this was the LAST eliminateCurrentPlayer
            // call site holding NO submit lock — the same class of gap T1c
            // closed for quitGame's current-turn branch — and it passed the
            // UNLOCKED liveRoom read above. Mirror quitGame/forceNextTurn
            // exactly: acquire the pipeline lock → fresh in-lock re-read →
            // re-verify → eliminate the FRESH room → token-guarded release.
            const lockToken = await redisUtils.acquireSubmitLock(pubClient, lobbyId);
            // No lock = a submit/forceNextTurn/watchdog is mid-flight and
            // will resolve this very turn itself. If the player really is
            // gone, the armed turn watchdog eliminates them on the next
            // expiry — skipping here is a no-op, not a leak.
            if (!lockToken) return;
            try {
              // Every check below re-runs against state the previous lock
              // holder finished writing — the pre-lock read only chose the
              // branch.
              const fresh = await redisUtils.getLobby(pubClient, lobbyId);
              if (!fresh || fresh.status !== 'playing') return;
              // Same dual lookup that produced livePlayer (stableId first,
              // so a page-refresh rejoin that changed socket ids matches).
              const freshPlayer = fresh.players.find(p => p.stableId === player.stableId || p.id === socketId);
              // Rejoined (connected flipped true) or already eliminated
              // while we waited — the grace kill must cancel, not double-fire.
              if (!freshPlayer || freshPlayer.connected || !freshPlayer.isAlive) return;
              // Turn moved on: "the current player" is now someone ELSE —
              // eliminating off our stale view would kill the wrong player.
              if (fresh.players[fresh.currentTurnIndex]?.id !== freshPlayer.id) return;
              // extraVerify re-checks "still disconnected" AGAIN on the
              // lobbymut-fresh room inside eliminateCurrentPlayer's commit
              // (T2a) — a rejoin landing between this submit-locked check
              // and that commit still cancels the kill.
              await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, fresh, 'Disconnected', {
                extraVerify: (f, v) => !v.connected,
              });
            } finally {
              // Token-guarded by construction (returned above when acquire
              // failed). .catch mirrors quitGame/forceNextTurn: a failed
              // release self-heals via the lock's 30s TTL and must never
              // mask an eliminate error.
              await redisUtils.releaseSubmitLock(pubClient, lobbyId, lockToken).catch(() => {});
            }
          } else {
            // R1: same lost-update race as quitGame's else branch — the
            // getLobby above this block is unlocked. Re-find the player on
            // the FRESH in-lock room (by stableId, falling back to socketId,
            // mirroring the lookup that produced livePlayer) and mutate
            // inside the mutex; broadcast outside on the returned room.
            // `changed` side-channel: see the quitGame else branch — the
            // returned room can't distinguish commit from a declined no-op.
            let changed = false;
            const updated = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
              const lp = r.players.find(p => p.stableId === player.stableId || p.id === socketId);
              if (!lp || !lp.isAlive) return false;
              lp.isAlive = false;
              changed = true;
            });
            if (changed && updated) {
              await gameLogic.checkWinCondition(io, pubClient, lobbyId, updated);
              const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
              if (finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
            }
          }
        } catch (err) {
          logger.error(err, 'Grace period elimination error');
        }
      }, RECONNECT_GRACE_MS);

      graceTimers.set(graceKey, graceTimeoutId);
    } else {
      // T1e: broadcast the room the lock returned — it IS the state the
      // mutator just persisted. The old extra getLobby here predates the
      // lock and would only re-open a read-after-write race for no benefit.
      gameLogic.broadcastState(io, lobbyId, room);
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
  addBot,
  removeBot,
  setGameMode,
  selectRuleKit,
  setTheme,
  setEquippedTitle,
  assignTeam,
  selectColor,
  toggleSetting,
  startLobby,
  restartLobby,
  requestPublicLobbies,
  quitGame,
  startDailyChallenge,
  finalizeDailyOnGameEnd,
  handleDisconnect,
};
