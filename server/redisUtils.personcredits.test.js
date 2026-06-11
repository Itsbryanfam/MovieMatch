// ============================================================================
// redisUtils.personcredits.test.js — getOrFetchPersonCredits (Phase 5a bots)
// ============================================================================
// WHY: the bot move generator depends on this cache behaving exactly like
// getOrFetchCredits (cache-first, stampede-locked, stripped payload, 7d TTL).
// A regression here would either hammer TMDB on every bot turn or feed the
// generator malformed filmographies.
// ============================================================================
const redisUtils = require('./redisUtils');

global.fetch = jest.fn();

function mockPubClient() {
  const store = new Map();
  return {
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async (k) => { store.delete(k); return 1; }),
    _store: store,
  };
}
const HEADERS = { Authorization: 'Bearer test', accept: 'application/json' };

beforeEach(() => { jest.clearAllMocks(); });

test('fetches, strips, and caches on miss (7-day TTL)', async () => {
  const pub = mockPubClient();
  // NX lock claim returns OK (no other fetcher), cache miss first.
  // T5d ESLint: third mock arg (set options) is unused here — _-prefixed.
  pub.set.mockImplementation(async (k, v, _opts) => { pub._store.set(k, v); return 'OK'; });
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      cast: [
        { id: 1, title: 'Alpha', release_date: '1999-05-01', popularity: 42.5 },
        { id: 2, title: 'Beta', release_date: '', popularity: 3.1 },
        { id: null, title: 'NoId', release_date: '2000-01-01', popularity: 9 }, // skipped
        { id: 3, release_date: '2001-01-01', popularity: 9 }, // no title → skipped
      ],
    }),
  });
  const res = await redisUtils.getOrFetchPersonCredits(pub, 555, HEADERS);
  expect(res).toEqual({ movies: [
    { id: 1, title: 'Alpha', year: '1999', popularity: 42.5 },
    { id: 2, title: 'Beta', year: '', popularity: 3.1 },
  ]});
  expect(global.fetch).toHaveBeenCalledWith(
    'https://api.themoviedb.org/3/person/555/movie_credits?language=en-US',
    expect.objectContaining({ headers: HEADERS })
  );
  // Cached under the versioned key with a 7-day EX.
  const setCall = pub.set.mock.calls.find(c => c[0] === 'personcredits:v1:555');
  expect(setCall[2]).toEqual({ EX: 604800 });
});

test('returns cached value without fetching on hit', async () => {
  const pub = mockPubClient();
  pub._store.set('personcredits:v1:7', JSON.stringify({ movies: [{ id: 9, title: 'C', year: '2010', popularity: 1 }] }));
  const res = await redisUtils.getOrFetchPersonCredits(pub, 7, HEADERS);
  expect(res).toEqual({ movies: [{ id: 9, title: 'C', year: '2010', popularity: 1 }] });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('throws on non-ok TMDB response (after draining body)', async () => {
  const pub = mockPubClient();
  const arrayBuffer = jest.fn(async () => {});
  global.fetch.mockResolvedValue({ ok: false, status: 503, arrayBuffer });
  await expect(redisUtils.getOrFetchPersonCredits(pub, 8, HEADERS)).rejects.toThrow(/TMDB person credits failed: 503/);
  expect(arrayBuffer).toHaveBeenCalled();
});

// T4i audit fix (2026-06-09): mirrors the getOrFetchCredits T1d-ext fix
// (commit 7ebeaa5). The post-success 7-day cache write-back sat in a try with
// NO isolating catch, so a Redis flap on that single SET rejected the bot's
// filmography lookup despite a SUCCESSFUL TMDB fetch — the bot would whiff its
// turn over a transient blip unrelated to the fetch. Pinned contract: once
// TMDB has answered, a Redis-only write-back failure must never change the
// return value (log and continue with the credits already in hand).
// T7d audit fix (2026-06-09): read-path symmetry. T4i isolated only the
// WRITE-back. The initial cache `get`, its `JSON.parse`, the stampede-lock
// `set`, and the retry `get` were still bare — the same asymmetry T1d fixed
// for getOrFetchCredits (commit 09cf70f). Blast radius is benign (only
// botSystem calls this; a flap → the bot whiffs its turn, never a human
// elimination) but a corrupt cached entry used to throw SyntaxError and the
// bad entry persisted to its TTL. Pinned contract: any cache read/parse error
// degrades to a MISS and proceeds to the TMDB fetch — never throws.
test('T7d: initial cache GET rejects → fetch still attempted, real credits returned', async () => {
  const pub = mockPubClient();
  // The first read (cache lookup) flaps; the lock-set + any retry succeed.
  pub.get.mockRejectedValueOnce(new Error('Socket closed unexpectedly'));
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ cast: [{ id: 1, title: 'Alpha', release_date: '1999-05-01', popularity: 42.5 }] }),
  });

  // Pre-fix this REJECTED with the Redis error instead of degrading to a miss.
  await expect(redisUtils.getOrFetchPersonCredits(pub, 555, HEADERS))
    .resolves.toEqual({ movies: [{ id: 1, title: 'Alpha', year: '1999', popularity: 42.5 }] });
  // The fetch was reached despite the read flap (the whole point of degrade-to-miss).
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('T7d: corrupt cached JSON is a MISS — no throw, fetch self-heals the entry', async () => {
  const pub = mockPubClient();
  // Torn write / manual poke: a non-JSON blob sits in the cache.
  pub._store.set('personcredits:v1:555', '{ not valid json');
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ cast: [{ id: 1, title: 'Alpha', release_date: '1999-05-01', popularity: 42.5 }] }),
  });

  // Pre-fix the JSON.parse threw SyntaxError out of the function.
  await expect(redisUtils.getOrFetchPersonCredits(pub, 555, HEADERS))
    .resolves.toEqual({ movies: [{ id: 1, title: 'Alpha', year: '1999', popularity: 42.5 }] });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  // The fresh write-back replaced the corrupt blob (self-heal).
  expect(JSON.parse(pub._store.get('personcredits:v1:555')))
    .toEqual({ movies: [{ id: 1, title: 'Alpha', year: '1999', popularity: 42.5 }] });
});

test('T4i: write-back SET rejects after successful fetch → real credits still returned, no throw', async () => {
  const pub = mockPubClient();
  pub.set.mockImplementation(async (k, v, opts) => {
    // Only the credits-PAYLOAD write flaps — identified by its EX:604800 cache
    // TTL (the NX stampede lock uses EX:10, so this isolates the write-back
    // failure mode from the lock-acquire path).
    if (opts && opts.EX === 604800) throw new Error('Socket closed unexpectedly');
    pub._store.set(k, v);
    return 'OK';
  });
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ cast: [{ id: 1, title: 'Alpha', release_date: '1999-05-01', popularity: 42.5 }] }),
  });

  // Pre-fix this REJECTED with the Redis error despite TMDB having succeeded.
  await expect(redisUtils.getOrFetchPersonCredits(pub, 555, HEADERS))
    .resolves.toEqual({ movies: [{ id: 1, title: 'Alpha', year: '1999', popularity: 42.5 }] });
  // Lock-release invariant survives the flap: finally still dels the :fetching
  // lock so a concurrent bot turn isn't stalled for the 10s lock TTL.
  expect(pub.del).toHaveBeenCalledTimes(1);
  expect(pub.del.mock.calls[0][0]).toMatch(/:fetching$/);
});
