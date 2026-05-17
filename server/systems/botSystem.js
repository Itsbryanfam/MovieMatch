// ============================================================================
// botSystem.js — Phase 5a: bot opponents (cold-start fix)
// ============================================================================
// Owns: difficulty profiles, bot-player creation, move GENERATION (TMDB
// person-filmography pathfinding), and turn SCHEDULING. The concurrency-
// critical COMMIT is delegated to matchSystem.submitBotMove so the submit
// lock orchestration stays in one reviewed place. A bot is a normal
// room.players[] entry with isBot:true and no socket.
// ============================================================================

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
  if (a && b && a.id != null && b.id != null) return a.id === b.id;
  if (!a || !b || !a.name || !b.name) return false;
  return a.name.toLowerCase() === b.name.toLowerCase();
}

/**
 * Decide the bot's move. Returns { tmdbId, mediaType:'movie' } or null.
 * null means "no move" — the caller (scheduleBotMove) turns that into a
 * graceful elimination via the existing engine path. Validity is by
 * construction (the chosen actor is in both the last film and the pick), so
 * the existing submit pipeline will accept it; we still pre-filter
 * used/hardcore so we don't propose a move the engine would reject.
 *
 * deps = { pubClient, headers, rng, getOrFetchPersonCredits, dailySeed }
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
    const candidates = (credits.movies || []).filter(m =>
      m.id !== lastMovieId &&
      !used.has(`movie:${m.id}`) &&
      (m.popularity || 0) >= profile.popularityFloor
    );
    if (candidates.length === 0) continue;
    // Prefer recognizable films: sort by popularity desc, then rng-pick from
    // the top slice so it's not robotically always the single most-popular.
    candidates.sort((x, y) => (y.popularity || 0) - (x.popularity || 0));
    const topN = candidates.slice(0, Math.min(5, candidates.length));
    const pick = topN[Math.floor(rng() * topN.length)];
    return { tmdbId: pick.id, mediaType: 'movie' };
  }
  return null;
}

module.exports = { BOT_DIFFICULTIES, BOT_NAMES, createBot, generateBotMove };
