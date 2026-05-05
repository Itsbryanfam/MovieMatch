// ============================================================================
// soloObjectivesSystem.test.js — Coverage for the M5 era-based objectives.
// ============================================================================
// What this pins:
//   - Each objective's `test(movie)` returns true exactly when the
//     candidate's year falls in the documented range.
//   - pickObjective always returns a valid descriptor (id present,
//     test function callable).
//   - Defensive year parsing — string years, missing years, garbage —
//     never throws and never false-positives.
// ============================================================================

const soloObjectives = require('./soloObjectivesSystem');

describe('soloObjectivesSystem.OBJECTIVES — era-based tests', () => {
  // Build a minimal movie shape the test() functions can read. The real
  // commitPlay path passes the full lightweight movie object, but only
  // the year field matters for these objectives.
  function movieFromYear(year) {
    return { id: 1, title: 'X', year: String(year), cast: [], mediaType: 'movie' };
  }

  function objectiveById(id) {
    return soloObjectives.OBJECTIVES.find(o => o.id === id);
  }

  test('pre_1990 accepts 1989 and earlier, rejects 1990+', () => {
    const obj = objectiveById('pre_1990');
    expect(obj.test(movieFromYear(1989))).toBe(true);
    expect(obj.test(movieFromYear(1975))).toBe(true);
    expect(obj.test(movieFromYear(1990))).toBe(false);
    expect(obj.test(movieFromYear(2024))).toBe(false);
  });

  test('classic_era accepts pre-1970 only', () => {
    const obj = objectiveById('classic_era');
    expect(obj.test(movieFromYear(1942))).toBe(true);
    expect(obj.test(movieFromYear(1969))).toBe(true);
    expect(obj.test(movieFromYear(1970))).toBe(false);
    expect(obj.test(movieFromYear(1971))).toBe(false);
  });

  test('eighties accepts 1980-1989 inclusive', () => {
    const obj = objectiveById('eighties');
    expect(obj.test(movieFromYear(1979))).toBe(false);
    expect(obj.test(movieFromYear(1980))).toBe(true);
    expect(obj.test(movieFromYear(1985))).toBe(true);
    expect(obj.test(movieFromYear(1989))).toBe(true);
    expect(obj.test(movieFromYear(1990))).toBe(false);
  });

  test('nineties accepts 1990-1999 inclusive', () => {
    const obj = objectiveById('nineties');
    expect(obj.test(movieFromYear(1990))).toBe(true);
    expect(obj.test(movieFromYear(1999))).toBe(true);
    expect(obj.test(movieFromYear(2000))).toBe(false);
  });

  test('aughts accepts 2000-2009 inclusive', () => {
    const obj = objectiveById('aughts');
    expect(obj.test(movieFromYear(2000))).toBe(true);
    expect(obj.test(movieFromYear(2009))).toBe(true);
    expect(obj.test(movieFromYear(2010))).toBe(false);
  });

  test('recent accepts 2015 and later', () => {
    const obj = objectiveById('recent');
    expect(obj.test(movieFromYear(2014))).toBe(false);
    expect(obj.test(movieFromYear(2015))).toBe(true);
    expect(obj.test(movieFromYear(2024))).toBe(true);
  });

  test('garbage / missing year never crashes and never matches', () => {
    // Defensive — an obscure film without a release_date returns
    // year='Unknown' from enrichWithCredits. The test() functions must
    // tolerate this without false-positives or thrown errors.
    soloObjectives.OBJECTIVES.forEach(obj => {
      expect(obj.test({ year: 'Unknown' })).toBe(false);
      expect(obj.test({ year: '' })).toBe(false);
      expect(obj.test({ year: null })).toBe(false);
      expect(obj.test({})).toBe(false);
      expect(obj.test(null)).toBe(false);
    });
  });
});

describe('soloObjectivesSystem.pickObjective + getObjectiveById', () => {
  test('pickObjective returns a complete descriptor every time', () => {
    // Run the picker many times to make sure no entry is mis-shaped.
    // If a future objective is added without a test fn or label, this
    // would catch it within a few iterations.
    for (let i = 0; i < 50; i++) {
      const obj = soloObjectives.pickObjective();
      expect(typeof obj.id).toBe('string');
      expect(typeof obj.label).toBe('string');
      expect(typeof obj.description).toBe('string');
      expect(typeof obj.test).toBe('function');
    }
  });

  test('getObjectiveById round-trips the picked objective', () => {
    // The play-validation site stores only the id on the room (functions
    // aren't Redis-safe) and re-looks up the test fn via this helper. If
    // a picked id ever didn't round-trip, objective hits would silently
    // never fire.
    const picked = soloObjectives.pickObjective();
    const looked = soloObjectives.getObjectiveById(picked.id);
    expect(looked).toBeTruthy();
    expect(looked.id).toBe(picked.id);
    expect(typeof looked.test).toBe('function');
  });

  test('getObjectiveById returns null for unknown id (defensive)', () => {
    // A serialized state from before this objective's id existed would
    // pass an unknown id at lookup time. The lookup returning null is
    // what allows commitPlay to skip the objective check cleanly.
    expect(soloObjectives.getObjectiveById('does_not_exist')).toBe(null);
    expect(soloObjectives.getObjectiveById(undefined)).toBe(null);
  });
});

describe('soloObjectivesSystem.clientShape', () => {
  test('strips the test function and keeps display fields', () => {
    // The client only needs the metadata. Sending the test fn would
    // (a) not survive JSON serialization across the wire and (b) leak
    // server logic into client-visible state. clientShape is the
    // contract guard.
    const picked = soloObjectives.pickObjective();
    const shaped = soloObjectives.clientShape(picked);
    expect(shaped.id).toBe(picked.id);
    expect(shaped.label).toBe(picked.label);
    expect(shaped.description).toBe(picked.description);
    expect(shaped.test).toBeUndefined();
  });

  test('null / undefined input returns null without crashing', () => {
    expect(soloObjectives.clientShape(null)).toBe(null);
    expect(soloObjectives.clientShape(undefined)).toBe(null);
  });
});
