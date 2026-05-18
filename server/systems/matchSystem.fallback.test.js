// ============================================================================
// matchSystem.fallback.test.js — Phase 5b: resolveCandidates falls back to the
// local DB when TMDB resolve (details/search) fails.
// ============================================================================
const matchSystem = require('./matchSystem');
const fallbackMovies = require('./fallbackMovies');

global.fetch = jest.fn();
const H = { Authorization: 'Bearer t', accept: 'application/json' };
const room = (over = {}) => ({ allowTvShows: false, theme: 'any', ...over });

beforeEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

test('direct-ID fetch throws + id in fallback → local candidate (live shape)', async () => {
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue({ id: 27205, title: 'Inception', year: 2010, mediaType: 'movie', cast: [{ id: 1, name: 'L' }] });
  global.fetch.mockRejectedValue(new Error('ETIMEDOUT'));
  const out = await matchSystem.resolveCandidates(room(), null, 27205, 'movie', H);
  expect(out).toEqual([{ id: 27205, media_type: 'movie', name: 'Inception', title: 'Inception', release_date: '2010-01-01', first_air_date: undefined, poster_path: null }]);
});

test('direct-ID non-OK + id NOT in fallback → empty (existing eliminate path)', async () => {
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue(null);
  global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
  const out = await matchSystem.resolveCandidates(room(), null, 999999, 'movie', H);
  expect(out).toEqual([]);
});

test('fuzzy search throws + title in fallback → levenshtein-ranked local candidate', async () => {
  jest.spyOn(fallbackMovies, 'allFallback').mockReturnValue([
    { id: 1, title: 'The Matrix', year: 1999, mediaType: 'movie', cast: [{ id: 1, name: 'K' }] },
    { id: 2, title: 'Matrix Reloaded', year: 2003, mediaType: 'movie', cast: [{ id: 1, name: 'K' }] },
  ]);
  global.fetch.mockRejectedValue(new Error('ETIMEDOUT'));
  const out = await matchSystem.resolveCandidates(room(), 'the matrix', null, null, H);
  expect(out[0]).toMatchObject({ id: 1, title: 'The Matrix', media_type: 'movie', release_date: '1999-01-01' });
});

test('fuzzy fallback does NOT mutate the loader cached array (map-before-sort)', async () => {
  const cached = [
    { id: 1, title: 'Zzz Last Alphabetically', year: 1999, mediaType: 'movie', cast: [{ id: 1, name: 'K' }] },
    { id: 2, title: 'Aaa First Alphabetically', year: 2003, mediaType: 'movie', cast: [{ id: 1, name: 'K' }] },
  ];
  jest.spyOn(fallbackMovies, 'allFallback').mockReturnValue(cached);
  global.fetch.mockRejectedValue(new Error('ETIMEDOUT'));
  await matchSystem.resolveCandidates(room(), 'aaa first', null, null, H);
  // The loader returns its cache by reference — the fallback must map to a new
  // array before sorting, so the original order is preserved here.
  expect(cached.map(e => e.id)).toEqual([1, 2]);
});

test('healthy direct path unchanged (fallback never consulted)', async () => {
  const spy = jest.spyOn(fallbackMovies, 'getFallbackById');
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 5, title: 'Live', release_date: '2020-05-01', poster_path: '/p.jpg' }) });
  const out = await matchSystem.resolveCandidates(room(), null, 5, 'movie', H);
  expect(out[0]).toMatchObject({ id: 5, title: 'Live', poster_path: '/p.jpg' });
  expect(spy).not.toHaveBeenCalled();
});
