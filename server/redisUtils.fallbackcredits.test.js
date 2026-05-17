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
  // No cache poisoning: assert the credits-PAYLOAD write (opts {EX:604800})
  // never happened. The NX stampede-lock set (key `${cacheKey}:fetching`,
  // opts {NX:true,EX:10}) legitimately occurs and is NOT poisoning — it is
  // distinguished here by the EX:604800 cache-TTL option, not a key prefix.
  const cacheWrote = p.set.mock.calls.some(c => c[2] && c[2].EX === 604800);
  expect(cacheWrote).toBe(false);
  // Concurrency-critical: the NX stampede lock MUST be released even on the
  // fallback return (it returns inside the try, so finally still runs del).
  // A leaked lock would stall every concurrent submit for this title for 10s
  // during an outage — assert it, don't just trust code inspection.
  expect(p.del).toHaveBeenCalledTimes(1);
  expect(p.del.mock.calls[0][0]).toMatch(/:fetching$/);
});

test('network throw + movie in fallback → returns local cast (no rethrow)', async () => {
  const p = pub();
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue({ id: 7, cast: [{ id: 9, name: 'B' }] });
  global.fetch.mockRejectedValue(new Error('ETIMEDOUT'));
  await expect(redisUtils.getOrFetchCredits(p, 7, 'movie', H)).resolves.toEqual({ cast: [{ id: 9, name: 'B' }] });
  // Same lock-release invariant on the catch (network-throw) fallback path.
  expect(p.del).toHaveBeenCalledTimes(1);
  expect(p.del.mock.calls[0][0]).toMatch(/:fetching$/);
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
  // Find the credits-payload write by its 7-day TTL option (NOT a key prefix —
  // the stampede-lock set also writes a credits:*:fetching key).
  const setCall = p.set.mock.calls.find(c => c[2] && c[2].EX === 604800);
  expect(setCall).toBeDefined();
  expect(setCall[2]).toEqual({ EX: 604800 });
  expect(spy).not.toHaveBeenCalled(); // fallback never consulted on the healthy path
});
