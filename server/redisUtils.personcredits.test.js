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
  pub.set.mockImplementation(async (k, v, opts) => { pub._store.set(k, v); return 'OK'; });
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
