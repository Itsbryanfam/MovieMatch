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

// T1 audit (2026-06-09), fix T1d: the initial cache GET, its JSON.parse, and
// the NX stampede-lock SET ran OUTSIDE the try that owns the TMDB-fetch +
// Phase-5b-fallback path. node-redis v4 rejects in-flight commands on a
// socket flap, so a blip there propagated to matchSystem's enrichWithCredits
// catch → `cast: []` → zero shared actors → player eliminated "Invalid movie
// connection" on a CORRECT move. These pin the degraded contract: ANY Redis
// error (or corrupt cached JSON) on the read/lock path = cache-miss
// semantics, falling through to the fetch path and its existing fallback.
test('T1d: cache GET rejects (Redis flap) → degrades to miss, real credits still returned', async () => {
  const p = pub();
  p.get.mockRejectedValue(new Error('Socket closed unexpectedly'));
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ cast: [{ id: 3, name: 'C' }] }) });

  // Pre-fix this REJECTED with the Redis error → caller answered cast:[] →
  // unfair elimination. Post-fix the flap reads as a miss and TMDB answers.
  await expect(redisUtils.getOrFetchCredits(p, 7, 'movie', H))
    .resolves.toEqual({ cast: [{ id: 3, name: 'C' }] });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('T1d: corrupt cached JSON → treated as a miss (refetch), not a throw', async () => {
  const p = pub();
  // Torn write / manual poke: the key exists but is not valid JSON.
  p._store.set('credits:v2:movie:7', '{not-json');
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ cast: [{ id: 4, name: 'D' }] }) });

  await expect(redisUtils.getOrFetchCredits(p, 7, 'movie', H))
    .resolves.toEqual({ cast: [{ id: 4, name: 'D' }] });
  // The fresh fetch result must be written back, self-healing the corrupt key.
  const cacheWrite = p.set.mock.calls.find(c => c[2] && c[2].EX === 604800);
  expect(cacheWrite).toBeDefined();
});

test('T1d: stampede-lock SET rejects → protection forfeited, fetch proceeds, no phantom release', async () => {
  const p = pub();
  p.set.mockImplementation(async (k, v) => {
    // Only the NX lock write flaps; the store stays usable otherwise so the
    // test isolates the lock-acquire failure mode.
    if (k.endsWith(':fetching')) throw new Error('Socket closed unexpectedly');
    p._store.set(k, v);
    return 'OK';
  });
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ cast: [{ id: 5, name: 'E' }] }) });

  await expect(redisUtils.getOrFetchCredits(p, 7, 'movie', H))
    .resolves.toEqual({ cast: [{ id: 5, name: 'E' }] });
  // Degraded mode skips the wait-and-retry of the legit-contention path
  // (that retry would just hit the flapping Redis again): exactly ONE get —
  // the initial cache probe — then straight to TMDB.
  expect(p.get).toHaveBeenCalledTimes(1);
  // We never held the lock, so the finally must not try to release it.
  expect(p.del).not.toHaveBeenCalled();
});

// T1 audit (2026-06-09), fix T1d-ext: completes T1d's boundary work on the
// POST-fetch side. After a SUCCESSFUL TMDB fetch, the 7-day cache write-back
// still ran inside the try whose catch is fallback-or-rethrow — so a Redis
// flap on that single SET threw away credits we were already HOLDING, and
// for titles outside the local fallback DB the rethrow reached matchSystem's
// enrichWithCredits catch → cast: [] → player eliminated on a CORRECT move.
// Contract pinned here: once TMDB has answered, Redis-only bookkeeping
// failures must never change the return value.
test('T1d-ext: write-back SET rejects after successful fetch → real credits still returned', async () => {
  const p = pub();
  // Title NOT in the local fallback DB — the exact case where the pre-fix
  // catch re-threw instead of returning the credits already in hand.
  const fb = jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue(null);
  p.set.mockImplementation(async (k, v, opts) => {
    // Only the credits-PAYLOAD write flaps — identified by its EX:604800
    // cache TTL (same discriminator the other tests in this file use). The
    // NX stampede lock (EX:10) stays healthy so this isolates the write-back
    // failure mode from the lock-acquire flap covered by the T1d test above.
    if (opts && opts.EX === 604800) throw new Error('Socket closed unexpectedly');
    p._store.set(k, v);
    return 'OK';
  });
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ cast: [{ id: 6, name: 'F' }] }) });

  // Pre-fix this REJECTED (catch → fallback miss → rethrow) despite TMDB
  // having succeeded. Post-fix the flap is logged and the credits returned.
  await expect(redisUtils.getOrFetchCredits(p, 7, 'movie', H))
    .resolves.toEqual({ cast: [{ id: 6, name: 'F' }] });
  // We HOLD real credits — the fallback DB must not even be consulted
  // (pre-fix the catch DID consult it on this path before re-throwing).
  expect(fb).not.toHaveBeenCalled();
  // Lock-release invariant survives the flap: finally still dels :fetching.
  expect(p.del).toHaveBeenCalledTimes(1);
  expect(p.del.mock.calls[0][0]).toMatch(/:fetching$/);
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
