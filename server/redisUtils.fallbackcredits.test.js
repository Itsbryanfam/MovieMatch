// ============================================================================
// redisUtils.fallbackcredits.test.js — Phase 5b: getOrFetchCredits falls back
// to the local DB on TMDB failure WITHOUT poisoning the Redis cache.
// ============================================================================
const redisUtils = require('./redisUtils');
const fallbackMovies = require('./systems/fallbackMovies');

global.fetch = jest.fn();

function pub() {
  const store = new Map();
  return {
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async () => 1),
    _store: store,
  };
}
const H = { Authorization: 'Bearer t', accept: 'application/json' };
beforeEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

test('non-OK TMDB + movie in fallback → returns local cast, does NOT cache', async () => {
  const p = pub();
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue({ id: 7, cast: [{ id: 1, name: 'A' }] });
  global.fetch.mockResolvedValue({ ok: false, status: 503, arrayBuffer: async () => {} });
  const res = await redisUtils.getOrFetchCredits(p, 7, 'movie', H);
  expect(res).toEqual({ cast: [{ id: 1, name: 'A' }] });
  // No cache poisoning: the credits cache key must NOT have been written.
  const wrote = p.set.mock.calls.some(c => String(c[0]).startsWith('credits:'));
  expect(wrote).toBe(false);
});

test('network throw + movie in fallback → returns local cast (no rethrow)', async () => {
  const p = pub();
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue({ id: 7, cast: [{ id: 9, name: 'B' }] });
  global.fetch.mockRejectedValue(new Error('ETIMEDOUT'));
  await expect(redisUtils.getOrFetchCredits(p, 7, 'movie', H)).resolves.toEqual({ cast: [{ id: 9, name: 'B' }] });
});

test('TMDB failure + NOT in fallback → throws as today', async () => {
  const p = pub();
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue(null);
  global.fetch.mockResolvedValue({ ok: false, status: 500, arrayBuffer: async () => {} });
  await expect(redisUtils.getOrFetchCredits(p, 7, 'movie', H)).rejects.toThrow(/TMDB credits failed: 500/);
});

test('tv mediaType never uses the (movies-only) fallback', async () => {
  const p = pub();
  const spy = jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue({ id: 7, cast: [{ id: 1, name: 'A' }] });
  global.fetch.mockResolvedValue({ ok: false, status: 503, arrayBuffer: async () => {} });
  await expect(redisUtils.getOrFetchCredits(p, 7, 'tv', H)).rejects.toThrow(/TMDB credits failed/);
  expect(spy).not.toHaveBeenCalled();
});

test('healthy fetch path unchanged: still strips + caches with 7-day EX', async () => {
  const p = pub();
  const spy = jest.spyOn(fallbackMovies, 'getFallbackById');
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ cast: [{ id: 3, name: 'C', extra: 'x' }] }) });
  const res = await redisUtils.getOrFetchCredits(p, 7, 'movie', H);
  expect(res).toEqual({ cast: [{ id: 3, name: 'C' }] });
  const setCall = p.set.mock.calls.find(c => String(c[0]).startsWith('credits:'));
  expect(setCall[2]).toEqual({ EX: 604800 });
  expect(spy).not.toHaveBeenCalled(); // fallback never consulted on the healthy path
});
