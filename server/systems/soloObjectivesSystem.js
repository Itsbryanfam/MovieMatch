// ============================================================================
// SOLO OBJECTIVES (M5) — per-game one-shot challenges that give Solo mode
// a reason to exist beyond "Classic with one player."
// ============================================================================
// Design
//   - At Solo game start, pick a random objective from OBJECTIVES.
//   - Send the objective metadata to the client so it can display the
//     prompt above the input area.
//   - On each successful play, check whether the matched movie satisfies
//     the objective. The first hit awards a flat bonus and marks the
//     objective complete (subsequent matching plays don't double-award).
//
// Why era-based only (for now)
//   - Year is already available on every TMDB candidate (release_date
//     parsed at enrichWithCredits time). No extra API calls or cache
//     pressure. Genre/demographic objectives need a separate /movie/{id}
//     fetch per submission, doubling TMDB load.
//   - This is a v1; richer objective categories can layer on later by
//     adding entries with their own `test` function.
//
// Validation contract
//   Each objective's `test(movie)` receives the same lightweight movie
//   object that gets stored on the chain — { id, title, year (string),
//   poster, cast, mediaType }. Returns true on hit, false otherwise.
// ============================================================================

// Per-game flat bonus on the first time the objective is satisfied. A
// one-shot bonus (rather than per-hit) keeps the score arithmetic simple
// and makes the objective feel like a goal to reach, not a repeated grind.
const OBJECTIVE_BONUS_POINTS = 5;

const OBJECTIVES = [
  {
    id: 'pre_1990',
    label: '🎞️ Old-school',
    description: 'Connect with a movie from before 1990 (+5 bonus)',
    test: (movie) => {
      const y = parseInt(movie && movie.year, 10);
      return Number.isFinite(y) && y > 0 && y < 1990;
    },
  },
  {
    id: 'classic_era',
    label: '🎩 Hollywood classic',
    description: 'Connect with a movie from before 1970 (+5 bonus)',
    test: (movie) => {
      const y = parseInt(movie && movie.year, 10);
      return Number.isFinite(y) && y > 0 && y < 1970;
    },
  },
  {
    id: 'eighties',
    label: '📼 The 80s',
    description: 'Connect with a movie from the 1980s (+5 bonus)',
    test: (movie) => {
      const y = parseInt(movie && movie.year, 10);
      return Number.isFinite(y) && y >= 1980 && y <= 1989;
    },
  },
  {
    id: 'nineties',
    label: '💿 The 90s',
    description: 'Connect with a movie from the 1990s (+5 bonus)',
    test: (movie) => {
      const y = parseInt(movie && movie.year, 10);
      return Number.isFinite(y) && y >= 1990 && y <= 1999;
    },
  },
  {
    id: 'aughts',
    label: '📀 The 2000s',
    description: 'Connect with a movie from the 2000s (+5 bonus)',
    test: (movie) => {
      const y = parseInt(movie && movie.year, 10);
      return Number.isFinite(y) && y >= 2000 && y <= 2009;
    },
  },
  {
    id: 'recent',
    label: '✨ Recent release',
    description: 'Connect with a movie from 2015 or later (+5 bonus)',
    test: (movie) => {
      const y = parseInt(movie && movie.year, 10);
      return Number.isFinite(y) && y >= 2015;
    },
  },
];

// Pick a random objective. Used by gameLogic.startGame in solo mode.
// Returns the full descriptor (metadata + test fn) — the test is server-
// only; only the metadata is broadcast to the client.
function pickObjective() {
  const idx = Math.floor(Math.random() * OBJECTIVES.length);
  return OBJECTIVES[idx];
}

// Lookup-by-id used by the play-validation site so we don't have to
// thread the test fn through state. The test fn isn't serializable so it
// can't live on the room object — only the id does.
function getObjectiveById(id) {
  return OBJECTIVES.find(o => o.id === id) || null;
}

// Strip a full objective down to the client-safe shape. The test
// function isn't serializable and would be lost on Redis round-trip
// anyway, but stripping explicitly here keeps the broadcast contract
// transparent — the client knows it gets {id, label, description}.
function clientShape(objective) {
  if (!objective) return null;
  return {
    id: objective.id,
    label: objective.label,
    description: objective.description,
  };
}

module.exports = {
  pickObjective,
  getObjectiveById,
  clientShape,
  OBJECTIVE_BONUS_POINTS,
  OBJECTIVES, // exported for tests
};
