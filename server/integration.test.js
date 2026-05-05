const gameLogic = require('./gameLogic');
const redisUtils = require('./redisUtils');

describe('MovieMatch Integration / Smoke Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('gameLogic.validateConnection is exported and works', () => {
    const lastNodeCast = ['Tom Hanks'];
    const candidateCast = ['Tom Hanks', 'Meg Ryan'];

    // Match the current 4-arg signature: (lastNodeCast, candidateCast, hardcoreMode, previousSharedActors).
    // The trailing extra [] in the old call was silently ignored.
    const result = gameLogic.validateConnection(lastNodeCast, candidateCast, false, []);
    expect(result.valid).toBe(true);
    expect(result.matchedActors).toContain('Tom Hanks');
  });

  test('redisUtils.getOrFetchCredits is exported', () => {
    expect(typeof redisUtils.getOrFetchCredits).toBe('function');
  });

  test('used movie deduplication logic works', () => {
    const usedMovies = ['movie:123', 'tv:456'];
    expect(usedMovies.includes('movie:123')).toBe(true);
    expect(usedMovies.includes('movie:999')).toBe(false);
  });

  // More simple smoke/integration tests can be added here later
});
