// ============================================================================
// botSystem.js — Phase 5a: bot opponents (cold-start fix)
// ============================================================================
// Owns: difficulty profiles, bot-player creation, move GENERATION (TMDB
// person-filmography pathfinding), and turn SCHEDULING. The concurrency-
// critical COMMIT is delegated to matchSystem.submitBotMove so the submit
// lock orchestration stays in one reviewed place. A bot is a normal
// room.players[] entry with isBot:true and no socket.
// ============================================================================

// Only fs and path are safe to top-level require: all other modules
// (matchSystem, redisUtils, gameLogic, pino) are lazy-required INSIDE
// functions to avoid circular dependency at module load time.
const fs = require('fs');
const path = require('path');

// TMDB auth headers from the process-global token — same construction as
// server.js:265 and scripts/build-daily-movies.js:20. WHY here: the bot
// scheduler is hooked into gameLogic.armTurnTimeout, which has no
// ctx.TMDB_HEADERS in scope. Deriving from env keeps the hook signature
// minimal and matches how the one-time daily-movies generator authenticates.
function _tmdbHeaders() {
  return { Authorization: `Bearer ${process.env.TMDB_READ_TOKEN}`, accept: 'application/json' };
}

// Lazy-memoized root logger. WHY lazy: pino must NOT be top-level required
// (cycle-safety — botSystem top-level requires only fs+path). WHY memoized:
// scheduleBotMove's timer fires on every bot turn; a fresh pino instance per
// fire is wasteful and loses stable pid/instance correlation.
let _logger = null;
function _getLogger() {
  if (!_logger) _logger = require('pino')();
  return _logger;
}

// Difficulty = a named parameter set the move generator reads. NOT branching
// code paths — just a profile object. WHY each knob:
//   whiff          — per-turn probability the bot "blanks" even when a move
//                    exists. THE beatability lever. INVARIANT: 0 < whiff < 1
//                    for every profile (incl. hard) so no difficulty is ever
//                    an unbeatable perfect-recall bot. Monotonic e>n>h.
//   delayMin/MaxMs — "thinking" delay window; realistic pacing, kept under
//                    the turn timer so a non-whiff move lands in time.
//   popularityFloor— TMDB movie popularity a pick must clear; higher = more
//                    mainstream/recognizable (easier human follow).
//   retryCap       — how many actor/candidate attempts before whiffing;
//                    bounded so the bot never loops to a perfect move.
// Starting values are tuning targets validated by the manual playtest gate.
const BOT_DIFFICULTIES = {
  easy:   { whiff: 0.45, delayMinMs: 4000, delayMaxMs: 9000, popularityFloor: 20, retryCap: 1 },
  normal: { whiff: 0.25, delayMinMs: 3000, delayMaxMs: 7000, popularityFloor: 10, retryCap: 2 },
  hard:   { whiff: 0.09, delayMinMs: 2000, delayMaxMs: 5000, popularityFloor: 4,  retryCap: 3 },
};

// Themed names so a bot is always visibly a bot (paired with a UI "BOT"
// badge). 8 names ≥ the 8-player cap, so a lobby can never exhaust them.
const BOT_NAMES = [
  'Bot Bogart', 'Bot Kubrick', 'Bot Hitchcock', 'Bot Kurosawa',
  'Bot Coppola', 'Bot Spielberg', 'Bot Scorsese', 'Bot Tarantino',
];

// Smallest free positive integer N such that `bot_N` is not already an id in
// the lobby. WHY not a timestamp/random: tests need determinism and a small
// stable id reads well in logs; collisions across remove/re-add are avoided
// by scanning existing ids rather than using a monotonic counter (which would
// drift if a bot is removed then another added).
function _nextBotIndex(existingPlayers) {
  const used = new Set(
    (existingPlayers || [])
      .map(p => /^bot_(\d+)$/.exec(p && p.id))
      .filter(Boolean)
      .map(m => Number(m[1]))
  );
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

function createBot(existingPlayers, difficulty) {
  const players = existingPlayers || [];
  // Invalid/missing difficulty falls back to normal so a buggy client can
  // never inject an unknown profile (move generator would read undefined).
  const diff = BOT_DIFFICULTIES[difficulty] ? difficulty : 'normal';
  const n = _nextBotIndex(players);
  // Pick a themed name not already taken in this lobby; cycle with a numeric
  // suffix if (improbably) all 8 base names are in use.
  const taken = new Set(players.map(p => p && p.name));
  // n is 1-indexed (bot_1, bot_2…) but BOT_NAMES is 0-indexed — hence (n-1).
  let name = BOT_NAMES[(n - 1) % BOT_NAMES.length];
  if (taken.has(name)) name = `${name} ${n}`;
  return {
    id: `bot_${n}`,
    name,
    isHost: false,        // a bot is NEVER host (host = settings/start authority)
    isBot: true,          // discriminator used everywhere (lifecycle, hooks, UI)
    isAlive: true,
    connected: true,      // keeps existing connected-filters treating it as present
    score: 0,
    wins: 0,
    teamId: players.length % 2, // mirrors human join parity (lobbySystem L105)
    difficulty: diff,
    stableId: null,       // no identity → auto-excluded from all stats writes
  };
}

// Deterministic shuffle driven by the injected rng so tests can force an
// order. Fisher–Yates; rng() ∈ [0,1).
function _shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Same person-equality rule the engine uses (gameLogic._sameActor): prefer
// id-equality, fall back to lowercase name. Local copy keeps botSystem from
// depending on a gameLogic internal (it isn't exported).
function _sameActor(a, b) {
  // != null (loose) intentionally covers BOTH null and undefined — raw cast
  // data may carry either when TMDB omits a person id.
  if (a && b && a.id != null && b.id != null) return a.id === b.id;
  if (!a || !b || !a.name || !b.name) return false;
  return a.name.toLowerCase() === b.name.toLowerCase();
}

// Phase 7.1: the per-actor "credits → ranked connecting candidates" step,
// extracted verbatim from generateBotMove so the read-side enumerator can
// reuse the SAME validity/popularity/sort rule (no rule duplicated). Pure:
// no TMDB, no rng. Returns candidates sorted by popularity desc.
function _rankConnectingCandidates(credits, lastMovieId, used, popularityFloor) {
  const candidates = ((credits && credits.movies) || []).filter(m =>
    m.id !== lastMovieId &&
    !used.has(`movie:${m.id}`) &&
    (m.popularity || 0) >= popularityFloor
  );
  candidates.sort((x, y) => (y.popularity || 0) - (x.popularity || 0));
  return candidates;
}

/**
 * Decide the bot's move. Returns { tmdbId, mediaType:'movie' } or null.
 * null means "no move" — the caller (scheduleBotMove) turns that into a
 * graceful elimination via the existing engine path. Validity is by
 * construction (the chosen actor is in both the last film and the pick), so
 * the existing submit pipeline will accept it; we still pre-filter
 * used/hardcore so we don't propose a move the engine would reject.
 *
 * deps = { pubClient, headers, rng: () => number in [0,1), getOrFetchPersonCredits, dailySeed }
 */
async function generateBotMove(room, profile, deps) {
  const { pubClient, headers, rng, getOrFetchPersonCredits, dailySeed } = deps;

  // Primary beatability lever: a deliberate per-turn blank. Checked before
  // any TMDB work so a whiff is cheap and the bot is genuinely beatable.
  if (rng() < profile.whiff) return null;

  const chain = room.chain || [];
  // First move: no connection constraint (the engine accepts any first
  // movie). Reuse the curated daily pool — valid, popular by construction,
  // zero new data. Empty pool → null (caller eliminates; never fabricate).
  if (chain.length === 0) {
    const seed = dailySeed || [];
    if (seed.length === 0) return null;
    const pick = seed[Math.floor(rng() * seed.length)];
    return { tmdbId: pick.id, mediaType: 'movie' };
  }

  const lastNode = chain[chain.length - 1];
  const lastMovieId = lastNode && lastNode.movie ? lastNode.movie.id : null;
  const lastCast = (lastNode && lastNode.movie && lastNode.movie.cast) || [];
  const used = new Set(room.usedMovies || []);
  const prevConnectors = room.previousSharedActors || [];

  // Only actors with a TMDB id are queryable (person-credits needs an id);
  // in hardcore, an actor already used as a connector anywhere in the chain
  // is locked out, so picking via them would be rejected — skip up front.
  let actors = lastCast.filter(a => a && a.id != null);
  if (room.hardcoreMode) {
    actors = actors.filter(a => !prevConnectors.some(p => _sameActor(p, a)));
  }
  actors = _shuffled(actors, rng).slice(0, Math.max(1, profile.retryCap));

  for (const actor of actors) {
    let credits;
    try {
      credits = await getOrFetchPersonCredits(pubClient, actor.id, headers);
    } catch (e) {
      // TMDB blip on this actor — try the next one rather than whiff the
      // whole turn (graceful degradation; 5b's fallback DB will harden this).
      continue;
    }
    const candidates = _rankConnectingCandidates(credits, lastMovieId, used, profile.popularityFloor);
    if (candidates.length === 0) continue;
    // Prefer recognizable films: rng-pick from the top slice so it's not
    // robotically always the single most-popular (unchanged from pre-7.1).
    const topN = candidates.slice(0, Math.min(5, candidates.length));
    const pick = topN[Math.floor(rng() * topN.length)];
    return { tmdbId: pick.id, mediaType: 'movie' };
  }
  return null;
}

/**
 * Phase 7.1 read-side: enumerate up to `limit` distinct connecting moves for
 * the CURRENT chain, each tagged with the actor that bridges it to the last
 * entry. Reuses generateBotMove's exact actor-selection + candidate rule (via
 * _rankConnectingCandidates) — NO connection rule duplicated, NO whiff, NO
 * first-move seeding (the only caller, _computeCouldHavePlayed, always has
 * chain.length >= 1). Contract: NEVER throws; returns [] on empty chain / no
 * credits / errors. deps mirror generateBotMove's.
 */
async function enumerateConnectingMoves(room, deps, { limit = 3 } = {}) {
  try {
    const { pubClient, headers, rng, getOrFetchPersonCredits } = deps;
    const chain = (room && room.chain) || [];
    if (chain.length === 0) return [];
    const lastNode = chain[chain.length - 1];
    const lastMovieId = lastNode && lastNode.movie ? lastNode.movie.id : null;
    const lastCast = (lastNode && lastNode.movie && lastNode.movie.cast) || [];
    const used = new Set(room.usedMovies || []);
    const prevConnectors = room.previousSharedActors || [];

    let actors = lastCast.filter(a => a && a.id != null);
    if (room.hardcoreMode) {
      actors = actors.filter(a => !prevConnectors.some(p => _sameActor(p, a)));
    }
    // Deterministic when rng:()=>0 (the suggestion caller passes that), but
    // honour an injected rng for parity with generateBotMove's actor order.
    actors = _shuffled(actors, rng);

    const out = [];
    const seen = new Set();
    for (const actor of actors) {
      if (out.length >= limit) break;
      let credits;
      try {
        credits = await getOrFetchPersonCredits(pubClient, actor.id, headers);
      } catch (e) {
        continue; // TMDB blip on this actor — best-effort, try the next
      }
      const ranked = _rankConnectingCandidates(credits, lastMovieId, used, deps.popularityFloor != null ? deps.popularityFloor : 0);
      for (const m of ranked) {
        if (out.length >= limit) break;
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({ tmdbId: m.id, mediaType: 'movie', viaActor: { id: actor.id, name: actor.name } });
      }
    }
    return out;
  } catch (e) {
    return []; // best-effort: a missing suggestion must never break elimination
  }
}

// In-process bot-move timers, keyed by lobbyId — the bot analogue of
// gameLogic.activeTurnTimeouts. In-process (setTimeout handles aren't
// serializable). Cross-instance double-fire is harmless: submitBotMove and
// the whiff-eliminate both take the Redis submit lock, so only one wins; the
// loser no-ops on the fresh-state re-check (same soft-lock family the turn
// sweep solves).
const activeBotTimeouts = new Map();

function clearBotTimeout(lobbyId) {
  if (activeBotTimeouts.has(lobbyId)) {
    clearTimeout(activeBotTimeouts.get(lobbyId));
    activeBotTimeouts.delete(lobbyId);
  }
}

// First-move seed pool = the curated daily list (valid, popular by
// construction). Read once and cached; a missing/corrupt file degrades to an
// empty pool (bot whiffs its FIRST move only — never crashes boot). Same
// tolerance posture as dailySystem's fallback.
let _dailySeedCache = null;
function _loadDailySeed() {
  if (_dailySeedCache) return _dailySeedCache;
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'dailyMovies.json'), 'utf8');
    const arr = JSON.parse(raw);
    _dailySeedCache = Array.isArray(arr) ? arr : [];
  } catch (e) {
    _dailySeedCache = [];
  }
  return _dailySeedCache;
}

/**
 * Schedule the current bot's move. Called from gameLogic.armTurnTimeout (the
 * single point a turn becomes active). No-op unless the current player is a
 * bot. The fired timer RE-READS fresh lobby state and no-ops unless it's
 * still that bot's turn — same defensive posture as the turn watchdog, so a
 * stale fire after a disconnect/turn-change is harmless (this is why we don't
 * need every clearTurnTimeout call site to also clear bot timers).
 * `opts.rng` is injectable for deterministic tests.
 */
function scheduleBotMove(io, pubClient, lobbyId, state, opts = {}) {
  const cur = state.players && state.players[state.currentTurnIndex];
  if (!cur || !cur.isBot) return;
  clearBotTimeout(lobbyId); // never stack two bot timers for one lobby

  const rng = opts.rng || Math.random;
  const profile = BOT_DIFFICULTIES[cur.difficulty] || BOT_DIFFICULTIES.normal;
  // Uniform delay within the profile window. Kept under the turn timer so a
  // non-whiff move lands in time; Easy's wide window + 0.45 whiff are what
  // make it self-destruct (no special-case code — the existing watchdog
  // eliminates a bot that somehow runs out the clock).
  const delay = Math.floor(profile.delayMinMs + rng() * (profile.delayMaxMs - profile.delayMinMs));

  const botId = cur.id;
  const timer = setTimeout(async () => {
    activeBotTimeouts.delete(lobbyId);
    try {
      // Re-read fresh — the turn may have advanced (human reconnect, sweep,
      // elimination) while we waited. Mirror the watchdog's re-check.
      const live = await pubClient_getLobby(pubClient, lobbyId);
      if (!live || live.status !== 'playing' || live.isValidating) return;
      const liveCur = live.players[live.currentTurnIndex];
      if (!liveCur || liveCur.id !== botId || !liveCur.isAlive) return;

      // Headers: env-derived by default (armTurnTimeout has no ctx headers);
      // opts.headers lets tests inject without touching process.env.
      const headers = opts.headers || _tmdbHeaders();
      // Call via module.exports so jest.spyOn(botSystem,'generateBotMove')
      // can intercept in tests — spyOn patches the exports property, not the
      // closed-over local binding.
      const move = await module.exports.generateBotMove(live, profile, {
        pubClient,
        headers,
        rng,
        getOrFetchPersonCredits: require('../redisUtils').getOrFetchPersonCredits,
        dailySeed: _loadDailySeed(),
      });

      const matchSystem = require('./matchSystem'); // lazy: cycle-safe
      if (move) {
        await matchSystem.submitBotMove(
          { io, pubClient, TMDB_HEADERS: headers, logger: _getLogger() },
          lobbyId, botId, move
        );
        return;
      }
      // Whiff: eliminate gracefully UNDER the submit lock so it can't race a
      // real submit/forceNextTurn (identical guard to the turn watchdog).
      const redisUtils = require('../redisUtils');
      const gameLogic = require('../gameLogic');
      const token = await redisUtils.acquireSubmitLock(pubClient, lobbyId);
      if (!token) return; // a submit is in flight; it will advance the turn
      try {
        const r2 = await redisUtils.getLobby(pubClient, lobbyId);
        // !isValidating mirrors submitMovie/submitBotMove's lock discipline:
        // if a submit is mid-commit for this turn, do NOT race it with a
        // whiff-elimination.
        if (!r2 || r2.status !== 'playing' || r2.isValidating) return;
        const c2 = r2.players[r2.currentTurnIndex];
        if (!c2 || c2.id !== botId || !c2.isAlive) return;
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, r2, "Bot couldn't find a move");
      } finally {
        await redisUtils.releaseSubmitLock(pubClient, lobbyId, token).catch(() => {});
      }
    } catch (e) {
      // A bot-turn failure must never crash the process or the lobby — the
      // turn watchdog is still armed and will eliminate the bot on timeout.
      _getLogger().error(e, 'scheduleBotMove fire failed');
    }
  }, delay);
  // .unref() so a pending bot timer never by itself pins a Jest worker / Node
  // process past shutdown (same rationale as scheduleGameReset's .unref()).
  if (typeof timer.unref === 'function') timer.unref();
  activeBotTimeouts.set(lobbyId, timer);
}

// Tiny indirection so the fresh-read above is mockable without pulling the
// whole redisUtils mock surface into scheduling tests.
function pubClient_getLobby(pubClient, lobbyId) {
  return require('../redisUtils').getLobby(pubClient, lobbyId);
}

module.exports = { BOT_DIFFICULTIES, BOT_NAMES, createBot, generateBotMove, enumerateConnectingMoves, _tmdbHeaders, scheduleBotMove, clearBotTimeout };
