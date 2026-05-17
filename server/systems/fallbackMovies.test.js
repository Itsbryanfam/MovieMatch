// ============================================================================
// fallbackMovies.test.js — Phase 5b read-once loader.
// ============================================================================
const path = require('path');

describe('fallbackMovies loader', () => {
  afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

  test('getFallbackById returns the entry by id (number-coerced), null if absent', () => {
    jest.isolateModules(() => {
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
      jest.doMock('fs', () => ({ readFileSync: () => { throw new Error('ENOENT'); } }));
      const fb = require('./fallbackMovies');
      expect(fb.getFallbackById(11)).toBeNull();
      expect(fb.allFallback()).toEqual([]);
    });
  });

  test('non-array JSON → empty', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({ readFileSync: () => JSON.stringify({ not: 'an array' }) }));
      const fb = require('./fallbackMovies');
      expect(fb.allFallback()).toEqual([]);
      expect(fb.getFallbackById(1)).toBeNull();
    });
  });

  test('read happens once (cached) across many calls', () => {
    jest.isolateModules(() => {
      const readFileSync = jest.fn(() => JSON.stringify([{ id: 5, title: 'X', year: 2000, mediaType: 'movie', cast: [{ id: 1, name: 'A' }] }]));
      jest.doMock('fs', () => ({ readFileSync }));
      const fb = require('./fallbackMovies');
      fb.getFallbackById(5); fb.getFallbackById(5); fb.allFallback();
      expect(readFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
