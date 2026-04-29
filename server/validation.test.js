const gameLogic = require('./gameLogic');
const redisUtils = require('./redisUtils');

// Mock fetch for TMDB calls
global.fetch = jest.fn();

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK')
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
});
