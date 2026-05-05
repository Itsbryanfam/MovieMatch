const gameLogic = require('./gameLogic');
const redisUtils = require('./redisUtils');

// Mock fetch for TMDB calls
global.fetch = jest.fn();

// getOrFetchCredits now uses a stampede lock (NX SET on a `:fetching` companion
// key) and releases it via DEL in the finally block, so the mock needs both
// SET (for the lock and the cache write) and DEL (for the lock release).
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
};

describe('MovieMatch Validation Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Core validation function tests
  test('valid connection - shared actor found', () => {
    const lastNodeCast = ['Tom Hanks'];
    const candidateCast = ['Tom Hanks', 'Meg Ryan'];
    const result = gameLogic.validateConnection(lastNodeCast, candidateCast, false, []);
    expect(result.valid).toBe(true);
    expect(result.matchedActors).toContain('Tom Hanks');
  });

  test('invalid connection - no shared actor', () => {
    const lastNodeCast = ['Tom Hanks'];
    const candidateCast = ['Leonardo DiCaprio', 'Kate Winslet'];
    const result = gameLogic.validateConnection(lastNodeCast, candidateCast, false, []);
    expect(result.valid).toBe(false);
  });

  test('hardcore mode rejects previously used connecting actor', () => {
    const lastNodeCast = ['Tom Hanks'];
    const candidateCast = ['Tom Hanks', 'Meg Ryan'];
    const previousShared = ['Tom Hanks'];
    const result = gameLogic.validateConnection(lastNodeCast, candidateCast, true, previousShared);
    expect(result.valid).toBe(false);
  });

  // M1: Hardcore mode is now CUMULATIVE — `previousSharedActors` carries
  // every connector used so far in the chain (not just the immediately
  // previous turn). The pre-M1 implementation only blocked the last turn's
  // connector, so a chain could ping-pong between two actors indefinitely
  // (Pitt → Clooney → Pitt → Clooney → ...). These tests pin the new
  // cumulative behavior so a regression that re-introduces overwriting
  // (instead of unioning) trips here.
  test('M1: hardcore mode rejects an actor used several turns ago', () => {
    // Brad Pitt connected on turn 1; turns 2–4 used different actors; on
    // turn 5 the player tries Pitt again. Pre-M1 this passed because
    // previousSharedActors had been overwritten by the last turn's connector.
    // Post-M1 the cumulative set still contains Pitt → connection rejected.
    const lastNodeCast = [{ id: 287, name: 'Brad Pitt' }];
    const candidateCast = [{ id: 287, name: 'Brad Pitt' }];
    const previousShared = [
      { id: 287, name: 'Brad Pitt' },     // used on an earlier turn
      { id: 4724, name: 'George Clooney' }, // used last turn
      { id: 1245, name: 'Scarlett Johansson' },
    ];
    const result = gameLogic.validateConnection(lastNodeCast, candidateCast, true, previousShared);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/already connected|chain/i);
  });

  test('hardcore mode accepts new connecting actor', () => {
    const lastNodeCast = ['Tom Hanks'];
    const candidateCast = ['Tom Hanks', 'Meg Ryan'];
    const previousShared = ['Meg Ryan'];
    const result = gameLogic.validateConnection(lastNodeCast, candidateCast, true, previousShared);
    expect(result.valid).toBe(true);
  });

  test('used movie deduplication by TMDB ID', () => {
    const usedMovies = ['movie:123', 'tv:456'];
    expect(usedMovies.includes('movie:123')).toBe(true);
    expect(usedMovies.includes('movie:999')).toBe(false);
  });

  // TV endpoint test — calls redisUtils.getOrFetchCredits directly
  test('TV shows correctly call aggregate_credits endpoint', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cast: [{ name: 'Actor' }] })
    });

    await redisUtils.getOrFetchCredits(mockRedis, 123, 'tv', {});
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tv/123/aggregate_credits'),
      expect.any(Object)
    );
  });

  // -----------------------------------------------------------------------
  // H4 — id-aware actor matching
  // -----------------------------------------------------------------------
  // These tests pin the post-H4 behaviour. validateConnection accepts both
  // legacy bare-string casts and current {id, name} object casts, and prefers
  // id-equality when both sides have an id (so two actors named the same
  // don't silently collide and false-match an invalid connection).

  test('H4: object-shape casts validate via id-equality', () => {
    // Both casts in the new {id, name} shape — id 287 = Brad Pitt.
    const lastNodeCast = [{ id: 287, name: 'Brad Pitt' }];
    const candidateCast = [{ id: 287, name: 'Brad Pitt' }, { id: 4724, name: 'George Clooney' }];
    const result = gameLogic.validateConnection(lastNodeCast, candidateCast, false, []);
    expect(result.valid).toBe(true);
    expect(result.matchedActors).toContain('Brad Pitt');
    // The new matchedActorObjects field carries ids for downstream callers
    // (commitPlay uses it to populate previousSharedActors with id-aware
    // entries so the next turn's hardcore check is precise).
    expect(result.matchedActorObjects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 287, name: 'Brad Pitt' })])
    );
  });

  test('H4: same name + different id is NOT a valid connection', () => {
    // Two actors who happen to share a name but are separate people in TMDB.
    // Pre-H4, this would have silently matched (string compare on names). With
    // id-aware matching, the connection is correctly rejected.
    const lastNodeCast = [{ id: 1001, name: 'John Smith' }];
    const candidateCast = [{ id: 9999, name: 'John Smith' }];
    const result = gameLogic.validateConnection(lastNodeCast, candidateCast, false, []);
    expect(result.valid).toBe(false);
  });

  test('H4: heterogeneous shapes fall back to case-insensitive name match', () => {
    // Mixed-shape casts can occur during the deploy transition: a chain
    // entry serialized before H4 (legacy strings) being validated against a
    // freshly-fetched candidate (objects). Name-fallback keeps in-flight
    // games working without an artificial drain.
    const lastNodeCast = ['Tom Hanks']; // legacy string
    const candidateCast = [{ id: 31, name: 'Tom Hanks' }];
    const result = gameLogic.validateConnection(lastNodeCast, candidateCast, false, []);
    expect(result.valid).toBe(true);
    expect(result.matchedActors).toContain('Tom Hanks');
  });

  test('H4: hardcore mode uses ids when both connector and previous have them', () => {
    // The same actor-name appearing twice in `previousSharedActors` and
    // candidate cast must be detected as the same person via id, not just
    // name. This is the case that Hardcore mode under-delivered on pre-H4.
    const lastNodeCast = [{ id: 287, name: 'Brad Pitt' }];
    const candidateCast = [{ id: 287, name: 'Brad Pitt' }];
    const previousShared = [{ id: 287, name: 'Brad Pitt' }];
    const result = gameLogic.validateConnection(lastNodeCast, candidateCast, true, previousShared);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Hardcore Mode/);
  });

  test('H4: cache key bumped to v2 (id-bearing payload schema)', async () => {
    // Pin the cache key shape so an unintentional revert to v1 (which
    // stored only {name}) trips the test rather than silently degrading
    // matching to name-only. Pre-H4 used `credits:movie:123`.
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cast: [{ id: 31, name: 'Tom Hanks' }] })
    });

    await redisUtils.getOrFetchCredits(mockRedis, 999, 'movie', {});

    // Three set() calls happen in the credits path: NX-acquire of the lock
    // (`...:fetching`), and the cache write itself. Find the cache write —
    // it's the one whose value is JSON, not the literal '1' lock marker.
    const setCalls = mockRedis.set.mock.calls;
    const cacheWrite = setCalls.find(([k]) => k === 'credits:v2:movie:999');
    expect(cacheWrite).toBeDefined();
    // The cached payload must include `id` per cast member — the whole
    // point of the v2 bump.
    const writtenPayload = JSON.parse(cacheWrite[1]);
    expect(writtenPayload.cast[0]).toEqual({ id: 31, name: 'Tom Hanks' });
  });
});
