// server/achievements.test.js — Phase 6b. Pins the catalog shape + the pure
// deriveEarned threshold semantics (earned AT the threshold, not below) and
// the partial/empty-stats safety the equip + wall paths both rely on.
const achievements = require('./achievements');
const { ACHIEVEMENTS, deriveEarned, titleLabel, clientCatalog } = achievements;

// Minimal getStats()-shaped object with everything zeroed; tests override.
function makeStats(overrides = {}) {
  const byModeDefaults = {
    classic: { played: 0, won: 0, longestChain: 0 },
    team:    { played: 0, won: 0, longestChain: 0 },
    solo:    { played: 0, won: 0, longestChain: 0 },
    speed:   { played: 0, won: 0, longestChain: 0 },
    daily:   { played: 0, won: 0, longestChain: 0 },
  };
  return {
    gamesPlayed: 0, wins: 0, longestChain: 0, totalPlays: 0,
    byMode: byModeDefaults, favoriteConnector: null, lastUpdatedMs: null,
    ...overrides,
  };
}

describe('ACHIEVEMENTS catalog', () => {
  test('has 13 well-formed, unique-id entries', () => {
    expect(Array.isArray(ACHIEVEMENTS)).toBe(true);
    expect(ACHIEVEMENTS.length).toBe(13);
    for (const a of ACHIEVEMENTS) {
      expect(typeof a.id).toBe('string');
      expect(typeof a.title).toBe('string');
      expect(typeof a.description).toBe('string');
      expect(typeof a.statPath).toBe('string');
      expect(typeof a.threshold).toBe('number');
      expect(a.threshold).toBeGreaterThan(0); // guard: a 0 threshold would make an achievement always-earned
    }
    const ids = ACHIEVEMENTS.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('deriveEarned — threshold semantics', () => {
  test('empty/undefined stats earn nothing and never throw', () => {
    expect(deriveEarned(undefined)).toEqual([]);
    expect(deriveEarned({})).toEqual([]);
    expect(deriveEarned(makeStats())).toEqual([]);
  });

  test('earns AT the threshold, not one below (flat fields)', () => {
    expect(deriveEarned(makeStats({ gamesPlayed: 0 }))).not.toContain('first_steps');
    expect(deriveEarned(makeStats({ gamesPlayed: 1 }))).toContain('first_steps');
    expect(deriveEarned(makeStats({ gamesPlayed: 9 }))).not.toContain('getting_hang');
    expect(deriveEarned(makeStats({ gamesPlayed: 10 }))).toContain('getting_hang');
    expect(deriveEarned(makeStats({ gamesPlayed: 49 }))).not.toContain('regular');
    expect(deriveEarned(makeStats({ gamesPlayed: 50 }))).toContain('regular');
    expect(deriveEarned(makeStats({ wins: 1 }))).toContain('first_win');
    expect(deriveEarned(makeStats({ wins: 10 }))).toContain('on_a_roll');
    expect(deriveEarned(makeStats({ longestChain: 9 }))).not.toContain('chain_builder');
    expect(deriveEarned(makeStats({ longestChain: 10 }))).toContain('chain_builder');
    expect(deriveEarned(makeStats({ longestChain: 25 }))).toContain('chain_master');
    expect(deriveEarned(makeStats({ totalPlays: 100 }))).toContain('well_connected');
  });

  test('earns nested byMode fields', () => {
    const team = makeStats({ byMode: { ...makeStats().byMode, team: { played: 1, won: 1, longestChain: 0 } } });
    expect(deriveEarned(team)).toContain('team_player');
    const speed = makeStats({ byMode: { ...makeStats().byMode, speed: { played: 1, won: 1, longestChain: 0 } } });
    expect(deriveEarned(speed)).toContain('speed_demon');
    const solo = makeStats({ byMode: { ...makeStats().byMode, solo: { played: 1, won: 1, longestChain: 0 } } });
    expect(deriveEarned(solo)).toContain('solo_artist');
    const daily = makeStats({ byMode: { ...makeStats().byMode, daily: { played: 7, won: 0, longestChain: 0 } } });
    expect(deriveEarned(daily)).toContain('daily_devotee');
    const dailyShort = makeStats({ byMode: { ...makeStats().byMode, daily: { played: 6, won: 0, longestChain: 0 } } });
    expect(deriveEarned(dailyShort)).not.toContain('daily_devotee');
  });

  test('signature_connector reads favoriteConnector.count and is null-safe', () => {
    expect(deriveEarned(makeStats({ favoriteConnector: null }))).not.toContain('signature_connector');
    expect(deriveEarned(makeStats({ favoriteConnector: { name: 'X', count: 4 } }))).not.toContain('signature_connector');
    expect(deriveEarned(makeStats({ favoriteConnector: { name: 'X', count: 5 } }))).toContain('signature_connector');
  });
});

describe('titleLabel + clientCatalog', () => {
  test('titleLabel resolves known ids and returns null otherwise', () => {
    expect(titleLabel('chain_master')).toBe('Chain Master');
    expect(titleLabel('nope')).toBeNull();
    expect(titleLabel(undefined)).toBeNull();
  });

  test('clientCatalog strips statPath/threshold, keeps id/title/description', () => {
    const cat = clientCatalog();
    expect(cat.length).toBe(13);
    for (const row of cat) {
      expect(Object.keys(row).sort()).toEqual(['description', 'id', 'title']);
    }
  });
});
