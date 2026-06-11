// ============================================================================
// fallbackMovies.test.js — Phase 5b read-once loader.
// ============================================================================
// T5d ESLint: removed `const path = require('path')` — it was required but
// never used in this suite (behavior-neutral dead-require removal).

// T4e: the loader now logs via a lazily-required pino instance on the
// degraded paths (small/empty/corrupt loads). Real pino writes through fs, but
// these tests mock `fs` with only readFileSync — so stub pino to a no-op
// logger in every isolated module to keep the fs mock minimal.
function stubPino() {
  jest.doMock('pino', () => () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
}

describe('fallbackMovies loader', () => {
  afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

  test('getFallbackById returns the entry by id (number-coerced), null if absent', () => {
    jest.isolateModules(() => {
      stubPino();
      jest.doMock('fs', () => ({
        readFileSync: () => JSON.stringify([
          { id: 11, title: 'Star Wars', year: 1977, mediaType: 'movie', cast: [{ id: 2, name: 'Mark Hamill' }] },
        ]),
      }));
      const fb = require('./fallbackMovies');
      expect(fb.getFallbackById(11)).toMatchObject({ id: 11, title: 'Star Wars' });
      expect(fb.getFallbackById('11')).toMatchObject({ id: 11 }); // string coerced
      expect(fb.getFallbackById(999)).toBeNull();
      expect(fb.allFallback()).toHaveLength(1);
    });
  });

  test('missing/corrupt file → empty (no throw, no exit)', () => {
    jest.isolateModules(() => {
      stubPino();
      jest.doMock('fs', () => ({ readFileSync: () => { throw new Error('ENOENT'); } }));
      const fb = require('./fallbackMovies');
      expect(fb.getFallbackById(11)).toBeNull();
      expect(fb.allFallback()).toEqual([]);
    });
  });

  test('non-array JSON → empty', () => {
    jest.isolateModules(() => {
      stubPino();
      jest.doMock('fs', () => ({ readFileSync: () => JSON.stringify({ not: 'an array' }) }));
      const fb = require('./fallbackMovies');
      expect(fb.allFallback()).toEqual([]);
      expect(fb.getFallbackById(1)).toBeNull();
    });
  });

  test('read happens once (cached) across many calls', () => {
    jest.isolateModules(() => {
      stubPino();
      const readFileSync = jest.fn(() => JSON.stringify([{ id: 5, title: 'X', year: 2000, mediaType: 'movie', cast: [{ id: 1, name: 'A' }] }]));
      jest.doMock('fs', () => ({ readFileSync }));
      const fb = require('./fallbackMovies');
      fb.getFallbackById(5); fb.getFallbackById(5); fb.allFallback();
      expect(readFileSync).toHaveBeenCalledTimes(1);
    });
  });

  // T4e audit fix: a corrupt/missing fallback file used to silently degrade to
  // an EMPTY DB with no operator signal — worst possible failure for the layer
  // that prevents wrongful eliminations during a TMDB outage. These pin the
  // loud-failure contract: log error/warn, return empty, never throw.
  describe('T4e — loud failure on corrupt/empty load', () => {
    // Build a fake pino so we can assert error/warn fired. _getLogger lazily
    // require('pino')()s, so doMock('pino') intercepts the instance it builds.
    function mockPino() {
      const error = jest.fn();
      const warn = jest.fn();
      jest.doMock('pino', () => () => ({ error, warn, info: jest.fn() }));
      return { error, warn };
    }

    test('malformed JSON → error logged, empty array returned, no throw', () => {
      jest.isolateModules(() => {
        const { error } = mockPino();
        jest.doMock('fs', () => ({ readFileSync: () => '{not valid json' }));
        const fb = require('./fallbackMovies');
        expect(() => fb.allFallback()).not.toThrow();
        expect(fb.allFallback()).toEqual([]);
        expect(error).toHaveBeenCalledTimes(1);
        // The message must name the degraded resilience, not a generic blurb.
        expect(error.mock.calls[0][1]).toMatch(/resilience degraded/i);
      });
    });

    test('missing file (read throws) → error logged loudly, still boots empty', () => {
      jest.isolateModules(() => {
        const { error } = mockPino();
        jest.doMock('fs', () => ({ readFileSync: () => { throw new Error('ENOENT'); } }));
        const fb = require('./fallbackMovies');
        expect(fb.allFallback()).toEqual([]);
        expect(error).toHaveBeenCalledTimes(1);
      });
    });

    test('non-array JSON → error logged (shape wrong), empty array returned', () => {
      jest.isolateModules(() => {
        const { error } = mockPino();
        jest.doMock('fs', () => ({ readFileSync: () => JSON.stringify({ not: 'an array' }) }));
        const fb = require('./fallbackMovies');
        expect(fb.allFallback()).toEqual([]);
        expect(error).toHaveBeenCalledTimes(1);
      });
    });

    test('suspiciously low (truncated) but valid array → warn logged, entries still usable', () => {
      jest.isolateModules(() => {
        const { warn } = mockPino();
        // A valid array of 3 entries — parses fine (catch never fires) but is
        // far below the healthy floor, the exact truncated-file shape the
        // catch can't catch.
        jest.doMock('fs', () => ({
          readFileSync: () => JSON.stringify([
            { id: 1, title: 'A', year: 2000, mediaType: 'movie', cast: [{ id: 1, name: 'X' }] },
            { id: 2, title: 'B', year: 2001, mediaType: 'movie', cast: [{ id: 2, name: 'Y' }] },
            { id: 3, title: 'C', year: 2002, mediaType: 'movie', cast: [{ id: 3, name: 'Z' }] },
          ]),
        }));
        const fb = require('./fallbackMovies');
        // The few entries still load and are queryable (we boot degraded, not broken).
        expect(fb.getFallbackById(2)).toMatchObject({ id: 2, title: 'B' });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatchObject({ loaded: 3 });
      });
    });

    test('healthy-sized array does NOT warn', () => {
      jest.isolateModules(() => {
        const { warn, error } = mockPino();
        // 250 well-formed entries — above the 200 floor, so neither logs fire.
        const big = Array.from({ length: 250 }, (_, i) => ({
          id: i + 1, title: 'M' + i, year: 2000, mediaType: 'movie', cast: [{ id: i, name: 'A' }],
        }));
        jest.doMock('fs', () => ({ readFileSync: () => JSON.stringify(big) }));
        const fb = require('./fallbackMovies');
        expect(fb.allFallback()).toHaveLength(250);
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
      });
    });
  });
});
