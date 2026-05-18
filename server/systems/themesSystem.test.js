// ============================================================================
// themesSystem.test.js — Coverage for the L1 themed-lobby filter system.
// ============================================================================
// What this pins:
//   - Each genre theme matches/rejects based on TMDB genre_ids.
//   - Decade themes parse release_date (and first_air_date for TV) and
//     accept the inclusive decade range.
//   - Unknown / null / 'any' themes pass everything through (degrade to
//     no-filter rather than reject everything).
//   - isValidTheme guards the wire input — only known ids accepted.
// ============================================================================

const themesSystem = require('./themesSystem');

describe('themesSystem.matchesTheme — genres', () => {
  // TMDB genre IDs used by the tests (must stay in sync with the THEMES
  // table in themesSystem.js — pinning the literals here makes a future
  // change to a genre id surface as a test failure that flags the change.
  const ID_HORROR = 27;
  const ID_COMEDY = 35;

  test('horror theme accepts horror genres, rejects others', () => {
    expect(themesSystem.matchesTheme('horror', { genre_ids: [ID_HORROR, 53] })).toBe(true);
    expect(themesSystem.matchesTheme('horror', { genre_ids: [ID_COMEDY] })).toBe(false);
    // Multiple genres including horror still matches — TMDB often tags
    // films with several genres, so any-overlap is the right semantics.
    expect(themesSystem.matchesTheme('horror', { genre_ids: [18, 27, 53] })).toBe(true);
  });

  test('comedy theme rejects when genre_ids is missing or empty', () => {
    // Defensive — a candidate with no genre_ids array shouldn't crash
    // the filter. It just doesn't match any genre theme.
    expect(themesSystem.matchesTheme('comedy', {})).toBe(false);
    expect(themesSystem.matchesTheme('comedy', { genre_ids: [] })).toBe(false);
    expect(themesSystem.matchesTheme('comedy', { genre_ids: null })).toBe(false);
  });
});

describe('themesSystem.matchesTheme — decades', () => {
  test('decade_1980s accepts 1980-1989 inclusive', () => {
    expect(themesSystem.matchesTheme('decade_1980s', { release_date: '1979-12-31' })).toBe(false);
    expect(themesSystem.matchesTheme('decade_1980s', { release_date: '1980-01-01' })).toBe(true);
    expect(themesSystem.matchesTheme('decade_1980s', { release_date: '1985-06-15' })).toBe(true);
    expect(themesSystem.matchesTheme('decade_1980s', { release_date: '1989-12-31' })).toBe(true);
    expect(themesSystem.matchesTheme('decade_1980s', { release_date: '1990-01-01' })).toBe(false);
  });

  test('decade themes accept first_air_date for TV results', () => {
    // The autocomplete-multi search returns a mix of movies + TV. TV
    // results have first_air_date, not release_date. The same decade
    // theme should work for both so a 90s sitcom counts in a 90s lobby.
    expect(themesSystem.matchesTheme('decade_1990s', { first_air_date: '1995-09-22' })).toBe(true);
    expect(themesSystem.matchesTheme('decade_2010s', { first_air_date: '2018-03-04' })).toBe(true);
  });

  test('malformed dates fail the match without throwing', () => {
    // Defensive — TMDB sometimes returns release_date as an empty string
    // for upcoming or obscure films. The filter must not crash and must
    // not false-positive (an undated film shouldn't slip through any
    // decade theme just because the parser returned NaN).
    expect(() => themesSystem.matchesTheme('decade_2000s', { release_date: '' })).not.toThrow();
    expect(themesSystem.matchesTheme('decade_2000s', { release_date: '' })).toBe(false);
    expect(themesSystem.matchesTheme('decade_2000s', { release_date: 'garbage' })).toBe(false);
    expect(themesSystem.matchesTheme('decade_2000s', {})).toBe(false);
  });
});

describe('themesSystem.matchesTheme — fallback semantics', () => {
  test('"any" theme passes everything through', () => {
    // Sanity — the no-filter case must literally accept everything,
    // including malformed candidates. Used in the "no theme set"
    // initial-lobby state.
    expect(themesSystem.matchesTheme('any', { genre_ids: [27] })).toBe(true);
    expect(themesSystem.matchesTheme('any', {})).toBe(true);
    expect(themesSystem.matchesTheme('any', null)).toBe(true);
  });

  test('null / undefined themeId is treated as "any"', () => {
    // Older serialized lobbies (created before L1) have no `theme` field.
    // Server reads `room.theme` which is undefined, then passes that to
    // matchesTheme. We must treat that as no-filter, not reject everything.
    expect(themesSystem.matchesTheme(null, { genre_ids: [27] })).toBe(true);
    expect(themesSystem.matchesTheme(undefined, { genre_ids: [27] })).toBe(true);
  });

  test('unknown themeId degrades to "no filter" rather than rejecting all', () => {
    // Defense-in-depth: if a future bug lets a typo'd theme id reach the
    // filter, the game stays playable rather than rejecting every
    // submission. Players would see "weird, my horror movies aren't
    // filtered" rather than "the game is broken."
    expect(themesSystem.matchesTheme('this_theme_does_not_exist', { genre_ids: [27] })).toBe(true);
  });
});

describe('themesSystem.isValidTheme + listThemes', () => {
  test('isValidTheme accepts known ids and rejects everything else', () => {
    expect(themesSystem.isValidTheme('any')).toBe(true);
    expect(themesSystem.isValidTheme('horror')).toBe(true);
    expect(themesSystem.isValidTheme('decade_1990s')).toBe(true);
    expect(themesSystem.isValidTheme('does_not_exist')).toBe(false);
    expect(themesSystem.isValidTheme(null)).toBe(false);
    expect(themesSystem.isValidTheme(123)).toBe(false);
    // Defensive against prototype-pollution-style probes — `__proto__`
    // and similar shouldn't accidentally match via hasOwn checks.
    expect(themesSystem.isValidTheme('__proto__')).toBe(false);
    expect(themesSystem.isValidTheme('toString')).toBe(false);
  });

  test('listThemes returns one entry per defined theme, in stable order', () => {
    const list = themesSystem.listThemes();
    // 'any' is always first — it's the no-filter option and reads as
    // the natural default in the picker UI.
    expect(list[0].id).toBe('any');
    // Every entry has the client-shape (no test fn leaked).
    list.forEach(t => {
      expect(typeof t.id).toBe('string');
      expect(typeof t.label).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.test).toBeUndefined();
    });
    // At least the documented genres + decades are present — guard
    // against an accidental delete by listing the canonical ids here.
    const ids = list.map(t => t.id);
    ['horror', 'comedy', 'action', 'scifi', 'romance', 'animation',
     'decade_1980s', 'decade_1990s', 'decade_2000s', 'decade_2010s']
      .forEach(id => expect(ids).toContain(id));
  });
});

// ============================================================================
// Phase 7.4 — authored "movie-night program" copy contract.
// WHY: 7.4 re-voices every theme label/description. This pins the EXACT new
// copy AND re-affirms the behavioural contract is byte-identical (ids + match
// fns + ordering unchanged) — the copy change must not perturb the filter.
// ============================================================================
describe('themesSystem — Phase 7.4 authored copy', () => {
  const EXPECTED = {
    any: { label: '🎬 Open Screening', description: 'Anything goes — every movie and show in the catalogue is eligible.' },
    horror: { label: '🎃 After Dark', description: 'The midnight horror block — only scary movies connect.' },
    comedy: { label: '😂 Comedy Night', description: 'Bring the laughs — only comedies count.' },
    action: { label: '💥 Blockbuster Night', description: 'Big, loud, explosive — only action movies count.' },
    scifi: { label: '🚀 Future Features', description: 'Speculative cinema only — science fiction counts.' },
    romance: { label: '💘 Date Night', description: 'Hearts on screen — only romance counts.' },
    animation: { label: '🎨 Animation Showcase', description: 'Hand-drawn to pixel-perfect — only animated films count.' },
    decade_1980s: { label: '📺 The ’80s Retro Reel', description: 'Neon and VHS — only films released 1980–1989.' },
    decade_1990s: { label: '💿 The ’90s Rewind', description: 'The CD-era canon — only films released 1990–1999.' },
    decade_2000s: { label: '📀 The 2000s Marathon', description: 'The DVD-shelf era — only films released 2000–2009.' },
    decade_2010s: { label: '📱 The 2010s Binge', description: 'The streaming dawn — only films released 2010–2019.' },
  };

  test('clientShape returns the exact authored label + description per id', () => {
    Object.keys(EXPECTED).forEach((id) => {
      const shaped = themesSystem.clientShape(id);
      expect(shaped).toEqual({ id, label: EXPECTED[id].label, description: EXPECTED[id].description });
    });
  });

  test('listThemes order is unchanged: "any" first, then the 10 canonical ids in declaration order', () => {
    const ids = themesSystem.listThemes().map((t) => t.id);
    expect(ids).toEqual([
      'any', 'horror', 'comedy', 'action', 'scifi', 'romance', 'animation',
      'decade_1980s', 'decade_1990s', 'decade_2000s', 'decade_2010s',
    ]);
  });

  test('behavioural contract re-affirmed: copy change did not perturb match/validation', () => {
    expect(themesSystem.matchesTheme('horror', { genre_ids: [27] })).toBe(true);
    expect(themesSystem.matchesTheme('horror', { genre_ids: [35] })).toBe(false);
    expect(themesSystem.matchesTheme('decade_1990s', { release_date: '1995-01-01' })).toBe(true);
    expect(themesSystem.matchesTheme('any', null)).toBe(true);
    expect(themesSystem.isValidTheme('scifi')).toBe(true);
    expect(themesSystem.isValidTheme('does_not_exist')).toBe(false);
  });
});
