// ============================================================================
// HERO PUZZLE — Phase 7.9 Playable Hero server module
// ============================================================================
// Pre-room socket flow. No lobby state, no game state. Redis appears ONLY as
// the optional search-result cache in searchPersonForHero (T3d audit fix) —
// puzzle bank/validation remain pure in-memory. Used by the hero landing
// page to serve a one-move chain puzzle to first-time visitors before they
// commit to joining a room.
//
// Exports:
//   - HERO_PUZZLE_BANK    — curated puzzle bank (server-authoritative)
//   - pickRandomPuzzle()  — random pick for the heroPuzzleRequest handler
//   - toClientPuzzle()    — strip the answer set before wire transmission
//   - validateGuess()     — authoritative correct/incorrect classification
//   - searchPersonForHero(query, TMDB_HEADERS, pubClient?) — TMDB
//     /search/person passthrough with an optional 6h Redis result cache
//
// NOTE: matchSystem.autocompleteSearch CANNOT be reused here — it requires
// an existing lobby + socket-in-lobby membership (matchSystem.js:93-95).
// Hero is pre-room. The TMDB /search/person endpoint is parallel to the
// /search/movie + /search/tv calls in matchSystem.js:99.
// ============================================================================

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w200';
// T4c audit fix: shared 5s TMDB fetch ceiling (was duplicated across four
// modules). constants.js is a leaf module — no require cycle.
const { TMDB_FETCH_TIMEOUT_MS } = require('./constants');

// T3d audit fix (P2): hero search cache controls.
// Version segment in the key — bump on payload-shape change so old entries
// can never be read under a new schema (same rationale + history pattern as
// CREDITS_CACHE_VERSION in redisUtils.js): v1 — [{ tmdbId, name,
// profilePath, knownFor }] (the exact client-facing shape).
const HERO_SEARCH_CACHE_VERSION = 'v1';
// 6 hours: actor search results drift on the order of weeks (new credits,
// new headshots) — far slower than this TTL — while autocomplete traffic
// for popular prefixes repeats within minutes. Long enough to absorb the
// repeat traffic, short enough that nobody notices staleness.
const HERO_SEARCH_CACHE_TTL_SEC = 6 * 60 * 60;

// T3d: lazy-memoized module logger for degraded-path warnings — identical
// pattern + rationale to redisUtils._getLogger: pino is only instantiated
// the first time a degraded log actually fires, so requiring this module
// stays side-effect-free for unit tests; memoized so repeated flaps reuse
// one instance (stable pid correlation in prod logs).
let _logger = null;
function _getLogger() {
  if (!_logger) _logger = require('pino')();
  return _logger;
}

// T3d: one normalization for the cache key — lowercase + trim + collapse
// internal whitespace runs. 'Tom Hanks', ' tom   hanks ' and 'TOM HANKS'
// are the same TMDB search; without this each cosmetic variant would be a
// separate miss and a separate hit on the shared token.
function normalizeHeroQuery(query) {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Curated hero puzzle bank. 5 hand-picked pairs with single memorable
// shared actors. tmdbIds are real and validated against TMDB.
const HERO_PUZZLE_BANK = Object.freeze([
  Object.freeze({
    pairId: 'hp_001_ironman2_junglebook',
    movieA: Object.freeze({
      title: 'Iron Man 2', year: 2010, tmdbId: 10138,
      posterUrl: `${TMDB_POSTER_BASE}/6WBeq4fCfn7AN0o21W9qNcRF2l9.jpg`,
    }),
    movieB: Object.freeze({
      title: 'The Jungle Book', year: 2016, tmdbId: 278927,
      posterUrl: `${TMDB_POSTER_BASE}/2Epx7F9X7DrFptn4seqn4mzBVks.jpg`,
    }),
    validActorTmdbIds: Object.freeze([1245]),
    revealActor: Object.freeze({ tmdbId: 1245, name: 'Scarlett Johansson' }),
  }),
  Object.freeze({
    pairId: 'hp_002_matrix_johnwick',
    movieA: Object.freeze({
      title: 'The Matrix', year: 1999, tmdbId: 603,
      posterUrl: `${TMDB_POSTER_BASE}/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg`,
    }),
    movieB: Object.freeze({
      title: 'John Wick', year: 2014, tmdbId: 245891,
      posterUrl: `${TMDB_POSTER_BASE}/fZPSd91yGE9fCcCe6OoQr6E3Bev.jpg`,
    }),
    validActorTmdbIds: Object.freeze([6384]),
    revealActor: Object.freeze({ tmdbId: 6384, name: 'Keanu Reeves' }),
  }),
  Object.freeze({
    pairId: 'hp_003_forrest_castaway',
    movieA: Object.freeze({
      title: 'Forrest Gump', year: 1994, tmdbId: 13,
      posterUrl: `${TMDB_POSTER_BASE}/saHP97rTPS5eLmrLQEcANmKrsFl.jpg`,
    }),
    movieB: Object.freeze({
      title: 'Cast Away', year: 2000, tmdbId: 8358,
      posterUrl: `${TMDB_POSTER_BASE}/zNCu05nQpJOJEKZX1WUcoG4xx0E.jpg`,
    }),
    validActorTmdbIds: Object.freeze([31]),
    revealActor: Object.freeze({ tmdbId: 31, name: 'Tom Hanks' }),
  }),
  Object.freeze({
    pairId: 'hp_004_pulp_killbill',
    movieA: Object.freeze({
      title: 'Pulp Fiction', year: 1994, tmdbId: 680,
      posterUrl: `${TMDB_POSTER_BASE}/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg`,
    }),
    movieB: Object.freeze({
      title: 'Kill Bill: Vol. 1', year: 2003, tmdbId: 24,
      posterUrl: `${TMDB_POSTER_BASE}/v7TaX8kXMXs5yFFGR41guUDNcnB.jpg`,
    }),
    validActorTmdbIds: Object.freeze([139]),
    revealActor: Object.freeze({ tmdbId: 139, name: 'Uma Thurman' }),
  }),
  Object.freeze({
    pairId: 'hp_005_titanic_wolf',
    movieA: Object.freeze({
      title: 'Titanic', year: 1997, tmdbId: 597,
      posterUrl: `${TMDB_POSTER_BASE}/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg`,
    }),
    movieB: Object.freeze({
      title: 'The Wolf of Wall Street', year: 2013, tmdbId: 106646,
      posterUrl: `${TMDB_POSTER_BASE}/34m2tygAYBGqA9MXKhRDtzYd4MR.jpg`,
    }),
    validActorTmdbIds: Object.freeze([6193]),
    revealActor: Object.freeze({ tmdbId: 6193, name: 'Leonardo DiCaprio' }),
  }),
]);

function pickRandomPuzzle() {
  return HERO_PUZZLE_BANK[Math.floor(Math.random() * HERO_PUZZLE_BANK.length)];
}

// Strip the multi-actor answer SET (validActorTmdbIds) — the strict
// secret (multi-actor answer set). Keep revealActor (the single canonical name)
// in the wire payload so the client's "Show me" path (the local Show Me path) can
// run locally with no socket round-trip, regardless of whether the
// current puzzle came from the bundled bank or the server. Without
// revealActor here the spec contradicts itself (server puzzles would
// have nothing to reveal locally). The leak is one name vs the full
// answer set — acceptable for a 15-second curiosity surface.
function toClientPuzzle(puzzle) {
  return {
    pairId: puzzle.pairId,
    movieA: puzzle.movieA,
    movieB: puzzle.movieB,
    revealActor: puzzle.revealActor,
  };
}

function validateGuess(pairId, actorTmdbId) {
  const puzzle = HERO_PUZZLE_BANK.find(p => p.pairId === pairId);
  if (!puzzle) return { ok: false, reason: 'unknown-pair' };
  const correct = puzzle.validActorTmdbIds.includes(actorTmdbId);
  return { ok: true, correct, revealActor: puzzle.revealActor };
}

// TMDB /search/person passthrough. Parallel to the /search/movie + /search/tv
// calls in matchSystem.js:99, scoped to people only and trimmed for the
// hero dropdown (top 5 results, posterPath-shaped knownFor preserved for
// the optional dropdown thumbnail).
//
// T3d audit fix (P2): optional 6h Redis result cache, modeled on
// redisUtils.getOrFetchCredits' read/write discipline (T1d/T1d-ext —
// commits 09cf70f/7ebeaa5): cache errors degrade to MISS, the write-back is
// isolated so a flap can't discard results TMDB already returned. The cache
// stores the CLIENT-FACING shape below, so a hit does ZERO TMDB work and
// zero re-mapping. pubClient is OPTIONAL (trailing param) so the function
// stays backward-compatible and pure-fetch when no Redis client is wired.
// No NX stampede lock (unlike getOrFetchCredits): autocomplete queries are
// interactive — a 250ms lock-wait would be felt in the dropdown, and the
// worst case without it is one duplicate person-search, not a wrong answer.
async function searchPersonForHero(query, TMDB_HEADERS, pubClient = null) {
  if (typeof query !== 'string' || query.length === 0) return [];
  // T3d: normalized key so cosmetic variants ('Tom Hanks' / ' tom  hanks ')
  // share one entry. Computed up front — read and write-back must agree.
  const cacheKey = `herosearch:${HERO_SEARCH_CACHE_VERSION}:${normalizeHeroQuery(query)}`;

  if (pubClient) {
    // T3d (T1d discipline): the read is wrapped so a node-redis flap —
    // which rejects in-flight commands — means "miss", never "search
    // broken". TMDB below is the actual source of truth.
    let cached = null;
    try {
      cached = await pubClient.get(cacheKey);
    } catch {
      cached = null; // flap = miss; fall through to the fetch
    }
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Corrupt entry (torn write / manual poke) is a miss, not a fatal —
        // the fresh write-back below self-heals the key.
      }
    }
  }

  const res = await fetch(
    `${TMDB_API_BASE}/search/person?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`,
    { headers: TMDB_HEADERS, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) }
  );
  // Upstream errors are NEVER cached — pinning a transient TMDB blip into a
  // 6h outage for that query would be worse than no cache at all.
  if (!res.ok) return [];
  const data = await res.json();
  const results = data.results || [];
  const clientResults = results.slice(0, 5).map(r => ({
    tmdbId: r.id,
    name: r.name,
    profilePath: r.profile_path ? `${TMDB_POSTER_BASE}${r.profile_path}` : null,
    knownFor: (r.known_for || [])
      .slice(0, 2)
      .map(k => k.title || k.name || '')
      .filter(Boolean),
  }));

  if (pubClient) {
    // T3d (T1d-ext discipline): the write-back runs AFTER TMDB answered —
    // at this point clientResults is a valid answer we hold. Isolated
    // try/catch: a Redis flap on this SET logs and continues; the price of
    // a lost write-back is one future re-fetch, never a dropped response.
    // (Empty result sets ARE cached — a 200 with no matches is a real
    // answer, and common misspellings repeat just like hits do.)
    try {
      await pubClient.set(cacheKey, JSON.stringify(clientResults), { EX: HERO_SEARCH_CACHE_TTL_SEC });
    } catch (cacheErr) {
      _getLogger().warn(cacheErr, 'hero search cache write-back failed — returning fetched results uncached');
    }
  }

  return clientResults;
}

module.exports = {
  HERO_PUZZLE_BANK,
  pickRandomPuzzle,
  toClientPuzzle,
  validateGuess,
  searchPersonForHero,
};
