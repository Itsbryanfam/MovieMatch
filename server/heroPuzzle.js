// ============================================================================
// HERO PUZZLE — Phase 7.9 Playable Hero server module
// ============================================================================
// Pre-room socket flow. No lobby state, no game state, no Redis. Used by
// the hero landing page to serve a one-move chain puzzle to first-time
// visitors before they commit to joining a room.
//
// Exports:
//   - HERO_PUZZLE_BANK    — curated puzzle bank (server-authoritative)
//   - pickRandomPuzzle()  — random pick for the heroPuzzleRequest handler
//   - toClientPuzzle()    — strip the answer set before wire transmission
//   - validateGuess()     — authoritative correct/incorrect classification
//   - searchPersonForHero(query, TMDB_HEADERS) — TMDB /search/person passthrough
//
// NOTE: matchSystem.autocompleteSearch CANNOT be reused here — it requires
// an existing lobby + socket-in-lobby membership (matchSystem.js:93-95).
// Hero is pre-room. The TMDB /search/person endpoint is parallel to the
// /search/movie + /search/tv calls in matchSystem.js:99.
// ============================================================================

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w200';
const TMDB_FETCH_TIMEOUT_MS = 5000;

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
// secret per spec §3.3. Keep revealActor (the single canonical name)
// in the wire payload so the client's "Show me" path (spec §4.6) can
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
async function searchPersonForHero(query, TMDB_HEADERS) {
  if (typeof query !== 'string' || query.length === 0) return [];
  const res = await fetch(
    `${TMDB_API_BASE}/search/person?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`,
    { headers: TMDB_HEADERS, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const results = data.results || [];
  return results.slice(0, 5).map(r => ({
    tmdbId: r.id,
    name: r.name,
    profilePath: r.profile_path ? `${TMDB_POSTER_BASE}${r.profile_path}` : null,
    knownFor: (r.known_for || [])
      .slice(0, 2)
      .map(k => k.title || k.name || '')
      .filter(Boolean),
  }));
}

module.exports = {
  HERO_PUZZLE_BANK,
  pickRandomPuzzle,
  toClientPuzzle,
  validateGuess,
  searchPersonForHero,
};
