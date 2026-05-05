// ============================================================================
// THEMES (L1) — optional lobby-wide filter that restricts candidate movies
// to a category (genre or decade).
// ============================================================================
// Why
//   A repeated session of MovieMatch tends to converge on the same well-cast
//   films (Marvel, Tom Cruise, etc.) because their actors are the easiest
//   bridges. Themes break that loop by forcing the chain into a corner of
//   the catalog the player wouldn't naturally reach for.
//
// Scope (v1)
//   Genre + decade themes only. Both filter from data already on TMDB
//   search results (genre_ids array + release_date) — no extra API calls
//   required. Franchise / collection themes ("Marvel Cinematic Universe")
//   would need keyword IDs or collection lookups; deferred to a later
//   iteration once we know themes are popular enough to justify the cost.
//
// Filter contract
//   matchesTheme(themeId, tmdbResult) returns true iff the candidate
//   passes the theme rule. Used at two call sites:
//     - autocompleteSearch — drop suggestions that don't match
//     - resolveCandidates  — drop candidates so the validator never
//       even considers an off-theme submission
// ============================================================================

// TMDB genre IDs are stable across the API — pinned here so we don't have
// to call /genre/movie/list at startup just to look up the constants.
// Source: https://developer.themoviedb.org/reference/genre-movie-list
const GENRE_HORROR    = 27;
const GENRE_COMEDY    = 35;
const GENRE_ACTION    = 28;
const GENRE_SCIFI     = 878;
const GENRE_ROMANCE   = 10749;
const GENRE_ANIMATION = 16;

// Theme definitions. Each entry has an id (used on the wire), label
// (client-display), description (for the picker tooltip), and a `match`
// function called per TMDB candidate. The match function reads only
// fields TMDB always returns on /search/movie results, so callers don't
// need to enrich candidates before applying the filter.
const THEMES = {
  // No-op theme — explicitly listed so the picker can offer "Any genre"
  // alongside the real themes. No filter is applied.
  any: {
    id: 'any',
    label: '🎬 Any (no theme)',
    description: 'Any movie or TV show is fair game.',
    match: () => true,
  },

  // Genre themes
  horror: {
    id: 'horror',
    label: '🎃 Horror',
    description: 'Only horror movies count.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_HORROR),
  },
  comedy: {
    id: 'comedy',
    label: '😂 Comedy',
    description: 'Only comedies count.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_COMEDY),
  },
  action: {
    id: 'action',
    label: '💥 Action',
    description: 'Only action movies count.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_ACTION),
  },
  scifi: {
    id: 'scifi',
    label: '🚀 Sci-Fi',
    description: 'Only science fiction counts.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_SCIFI),
  },
  romance: {
    id: 'romance',
    label: '💘 Romance',
    description: 'Only romance counts.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_ROMANCE),
  },
  animation: {
    id: 'animation',
    label: '🎨 Animation',
    description: 'Only animated films count.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_ANIMATION),
  },

  // Decade themes — pulled from release_date string ('YYYY-MM-DD').
  // Tolerates missing/malformed dates by failing the match (rather than
  // accidentally letting an undated film slip through).
  decade_1980s: {
    id: 'decade_1980s',
    label: '📺 1980s',
    description: 'Only movies released in the 1980s.',
    match: (r) => _yearInRange(r, 1980, 1989),
  },
  decade_1990s: {
    id: 'decade_1990s',
    label: '💿 1990s',
    description: 'Only movies released in the 1990s.',
    match: (r) => _yearInRange(r, 1990, 1999),
  },
  decade_2000s: {
    id: 'decade_2000s',
    label: '📀 2000s',
    description: 'Only movies released in the 2000s.',
    match: (r) => _yearInRange(r, 2000, 2009),
  },
  decade_2010s: {
    id: 'decade_2010s',
    label: '📱 2010s',
    description: 'Only movies released in the 2010s.',
    match: (r) => _yearInRange(r, 2010, 2019),
  },
};

function _yearInRange(r, min, max) {
  // TMDB returns release_date for movies and first_air_date for TV. We
  // accept either so the same theme works regardless of the search
  // type the lobby is using.
  const date = r && (r.release_date || r.first_air_date);
  if (typeof date !== 'string' || date.length < 4) return false;
  const y = parseInt(date.slice(0, 4), 10);
  return Number.isFinite(y) && y >= min && y <= max;
}

// True iff the theme exists. Used by socket-handler validation so a
// malicious or buggy client can't set an arbitrary string theme.
function isValidTheme(themeId) {
  return typeof themeId === 'string' && Object.prototype.hasOwnProperty.call(THEMES, themeId);
}

// Apply the theme's match() to a candidate. Unknown / null / 'any'
// themes pass everything through — equivalent to no filter.
function matchesTheme(themeId, tmdbResult) {
  if (!themeId || themeId === 'any') return true;
  const theme = THEMES[themeId];
  if (!theme) return true; // unknown theme = degrade safely to "no filter"
  return theme.match(tmdbResult);
}

// Strip a theme down to the client-display shape (no functions). The
// match() callback isn't serializable and the client doesn't need it
// (server is authoritative on theme filtering).
function clientShape(themeId) {
  const t = THEMES[themeId];
  if (!t) return null;
  return { id: t.id, label: t.label, description: t.description };
}

// Enumerate all themes for the picker UI. Stable ordering matters —
// without a deterministic order the picker would re-arrange itself
// across deploys. JS Object.keys preserves insertion order so the
// declaration order above is the display order.
function listThemes() {
  return Object.keys(THEMES).map(clientShape);
}

module.exports = {
  THEMES,
  isValidTheme,
  matchesTheme,
  clientShape,
  listThemes,
};
