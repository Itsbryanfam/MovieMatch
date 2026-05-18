// ============================================================================
// fallbackMovies.data.test.js — Phase 5b: pins data/fallbackMovies.json shape.
// ============================================================================
// WHY: the fallback DB is only consulted during a TMDB outage, so a shape
// regression would be invisible until prod is already degraded. This no-network
// test fails CI immediately if the committed dataset drifts.
// ============================================================================
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(
  path.join(__dirname, '..', '..', 'data', 'fallbackMovies.json'), 'utf8'
);
const data = JSON.parse(raw);
const daily = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'dailyMovies.json'), 'utf8')
);

describe('data/fallbackMovies.json — structural integrity', () => {
  test('is committed in the generator byte-stable format (2-space indent + trailing newline)', () => {
    // WHY: the generator writes JSON.stringify(out,null,2)+'\n'; pinning this
    // keeps re-runs git-clean and catches a commit produced by a different
    // serializer (which would silently bloat diffs / break the contract).
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.startsWith('[\n  {')).toBe(true);
  });

  test('is a sizable array', () => {
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(900);
  });

  test('every entry is a well-formed movie record', () => {
    for (const e of data) {
      expect(Number.isInteger(e.id)).toBe(true);
      expect(typeof e.title).toBe('string');
      expect(e.title.length).toBeGreaterThan(0);
      expect(Number.isInteger(e.year)).toBe(true);
      expect(e.mediaType).toBe('movie');
    }
  });

  test('every entry has a non-empty, capped cast of {id,name}', () => {
    for (const e of data) {
      expect(Array.isArray(e.cast)).toBe(true);
      expect(e.cast.length).toBeGreaterThan(0);
      expect(e.cast.length).toBeLessThanOrEqual(20);
      for (const a of e.cast) {
        expect(Number.isInteger(a.id)).toBe(true);
        expect(typeof a.name).toBe('string');
        expect(a.name.length).toBeGreaterThan(0);
      }
    }
  });

  test('has no duplicate ids and is sorted by id', () => {
    const ids = data.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sorted = [...ids].sort((x, y) => x - y);
    expect(ids).toEqual(sorted);
  });

  test('covers essentially every daily-pool id (only cast-less TMDB entries may be absent)', () => {
    // WHY: the fallback is cast-based. A daily entry TMDB has ZERO cast for
    // (a few animated shorts — Piper/Kitbull/Flow/"Far from the Tree") cannot
    // be in a cast-based fallback — and such a movie can't validate a chain
    // connection whether TMDB is up or down, so its absence is CORRECT, not a
    // coverage gap. Assert near-total coverage with a small tolerance rather
    // than the impossible "all". A real coverage regression (dozens missing)
    // still trips this; the handful of cast-less daily entries do not.
    const have = new Set(data.map(e => e.id));
    const missing = daily.map(d => d.id).filter(id => !have.has(id));
    expect(missing.length).toBeLessThanOrEqual(8);
  });
});
