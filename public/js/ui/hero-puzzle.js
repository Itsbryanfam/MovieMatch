// public/js/ui/hero-puzzle.js — Phase 7.9 Playable Hero pure seam.
// PURE — no imports, no DOM, no socket, no clock. Mirrors the
// red-carpet.js / chain-recap.js / turn-motion.js / daily-ritual.js
// lineage: pure data + pure functions that the controller layer wires
// to live DOM + socket events.
//
// Exports:
//   - BUNDLED_PUZZLES — hand-curated fallback bank for instant first paint
//     and offline degradation. Server-supplied puzzles arrive via socket and
//     replace this for subsequent renders.
//   - pickBundledPuzzle({ seen }) — random pick from the bank, skipping seen ids.
//   - classifyOutcome(puzzle, guess) — correct/incorrect/invalid classification.
//
// All tmdbIds are real TMDB person/movie ids. The implementer should verify
// each puzzle pair on TMDB before merge (manual smoke-check #6 in spec §10).

// Bundled puzzle bank. 3 hand-curated pairs with single, memorable shared
// actors. Posters are TMDB w200 (same size + CDN the existing static demo
// used at index.html L158/L168/L178).
export const BUNDLED_PUZZLES = Object.freeze([
  Object.freeze({
    pairId: 'bundled-ironman2-jungle-book',
    movieA: Object.freeze({
      title: 'Iron Man 2',
      year: 2010,
      posterUrl: 'https://image.tmdb.org/t/p/w200/6WBeq4fCfn7AN0o21W9qNcRF2l9.jpg',
      tmdbId: 10138,
    }),
    movieB: Object.freeze({
      title: 'The Jungle Book',
      year: 2016,
      posterUrl: 'https://image.tmdb.org/t/p/w200/2Epx7F9X7DrFptn4seqn4mzBVks.jpg',
      tmdbId: 278927,
    }),
    validActorTmdbIds: Object.freeze([1245]), // Scarlett Johansson
    revealActor: Object.freeze({ tmdbId: 1245, name: 'Scarlett Johansson' }),
  }),
  Object.freeze({
    pairId: 'bundled-matrix-john-wick',
    movieA: Object.freeze({
      title: 'The Matrix',
      year: 1999,
      posterUrl: 'https://image.tmdb.org/t/p/w200/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
      tmdbId: 603,
    }),
    movieB: Object.freeze({
      title: 'John Wick',
      year: 2014,
      posterUrl: 'https://image.tmdb.org/t/p/w200/fZPSd91yGE9fCcCe6OoQr6E3Bev.jpg',
      tmdbId: 245891,
    }),
    validActorTmdbIds: Object.freeze([6384]), // Keanu Reeves
    revealActor: Object.freeze({ tmdbId: 6384, name: 'Keanu Reeves' }),
  }),
  Object.freeze({
    pairId: 'bundled-forrest-castaway',
    movieA: Object.freeze({
      title: 'Forrest Gump',
      year: 1994,
      posterUrl: 'https://image.tmdb.org/t/p/w200/saHP97rTPS5eLmrLQEcANmKrsFl.jpg',
      tmdbId: 13,
    }),
    movieB: Object.freeze({
      title: 'Cast Away',
      year: 2000,
      posterUrl: 'https://image.tmdb.org/t/p/w200/zNCu05nQpJOJEKZX1WUcoG4xx0E.jpg',
      tmdbId: 8358,
    }),
    validActorTmdbIds: Object.freeze([31]), // Tom Hanks
    revealActor: Object.freeze({ tmdbId: 31, name: 'Tom Hanks' }),
  }),
]);

// Pick a random puzzle from the bundled bank. Honors `seen` (array of pairIds
// already shown this session) — falls back to the full bank when all are seen
// so the picker never returns undefined.
export function pickBundledPuzzle({ seen = [] } = {}) {
  const fresh = BUNDLED_PUZZLES.filter(p => !seen.includes(p.pairId));
  const pool = fresh.length > 0 ? fresh : BUNDLED_PUZZLES;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Classify a guess against a puzzle's valid-actor set. Returns one of:
//   { kind: 'correct',   revealActor }
//   { kind: 'incorrect', revealActor, guessedName }
//   { kind: 'invalid' }                              // missing puzzle / tmdbId
export function classifyOutcome(puzzle, guess = {}) {
  if (!puzzle || guess.actorTmdbId == null) {
    return { kind: 'invalid' };
  }
  const correct = puzzle.validActorTmdbIds.includes(guess.actorTmdbId);
  if (correct) {
    return { kind: 'correct', revealActor: puzzle.revealActor };
  }
  return {
    kind: 'incorrect',
    revealActor: puzzle.revealActor,
    guessedName: guess.actorName ?? null,
  };
}
