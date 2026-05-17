// dailyMovies.data.test.js — structural integrity of the curated daily pool.
// WHY: dailyMovies.json is the deterministic seed source for the Daily
// Challenge; pickDailyMovie does list[hash(date) % list.length], so a
// malformed entry (non-numeric id, missing year) silently produces a
// broken/unsolvable puzzle on a specific calendar date. This test pins the
// shape WITHOUT network so a bad regeneration fails CI, not players. It
// asserts nothing about ordering of dates→movies (that is dailySystem's job).
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'dailyMovies.json');

// The 50 originally-curated ids. WHY: the generator unions TMDB top-rated
// with these so long-standing hand-picked favorites are never dropped; pin
// them so a regeneration that forgets the union trips here.
const CORE_IDS = [278,680,13,155,27205,603,550,238,769,597,120,11,105,329,8587,862,12,24428,744,361743,289,601,578,424,857,274,98,1422,949,807,115,6977,7345,37799,313369,244786,76341,546554,496243,419430,120467,376867,194662,314365,281957,1726,272,671,22,1124];

describe('data/dailyMovies.json — structural integrity', () => {
  const raw = fs.readFileSync(FILE, 'utf8');
  const list = JSON.parse(raw);

  test('is a non-empty array of >= 450 entries', () => {
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(450);
  });

  test('every entry has a valid id/title/year/mediaType', () => {
    const thisYear = new Date().getFullYear();
    for (const m of list) {
      expect(Number.isInteger(m.id)).toBe(true);
      expect(m.id).toBeGreaterThan(0);
      expect(typeof m.title).toBe('string');
      expect(m.title.length).toBeGreaterThan(0);
      expect(Number.isInteger(m.year)).toBe(true);
      expect(m.year).toBeGreaterThanOrEqual(1900);
      expect(m.year).toBeLessThanOrEqual(thisYear + 1);
      expect(['movie', 'tv']).toContain(m.mediaType);
    }
  });

  test('has no duplicate ids', () => {
    const ids = list.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('still contains every originally-curated id', () => {
    const ids = new Set(list.map((m) => m.id));
    for (const id of CORE_IDS) expect(ids.has(id)).toBe(true);
  });
});
