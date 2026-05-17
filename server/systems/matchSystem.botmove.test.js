// ============================================================================
// matchSystem.botmove.test.js — Phase 5a submitBotMove (socketless commit)
// ============================================================================
const matchSystem = require('./matchSystem');
const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');

jest.mock('../redisUtils');
global.fetch = jest.fn();

function buildRoom(over = {}) {
  return {
    id: 'TEST', status: 'playing', isValidating: false, gameMode: 'classic',
    players: [
      { id: 'sock-1', name: 'Human', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1' },
      { id: 'bot_1', name: 'Bot Bogart', isHost: false, isBot: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, difficulty: 'normal', stableId: null },
    ],
    spectators: [], chain: [{ playerId: 'sock-1', playerName: 'Human', movie: { id: 1, title: 'First', year: '2000', cast: [{ id: 42, name: 'Shared' }], mediaType: 'movie' }, matchedActors: [] }],
    usedMovies: ['movie:1'], hardcoreMode: false, previousSharedActors: [],
    allowTvShows: false, isPublic: false, timerMultiplier: 0,
    turnExpiresAt: Date.now() + 60000, currentTurnIndex: 1, currentTurnRetries: 0,
    ...over,
  };
}
let mockIo, ctx, logger;
beforeEach(() => {
  jest.clearAllMocks();
  mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
  logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
  ctx = { io: mockIo, pubClient: {}, TMDB_HEADERS: { Authorization: 'Bearer test', accept: 'application/json' }, logger };
  redisUtils.acquireSubmitLock.mockResolvedValue('token-bot');
  redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
  redisUtils.saveLobby.mockResolvedValue(undefined);
});
afterEach(() => gameLogic.clearTurnTimeout('TEST'));

test('connecting bot move grows chain, scores bot, advances turn', async () => {
  const room = buildRoom();
  redisUtils.getLobby.mockResolvedValue(room);
  // resolveCandidates direct-ID path → details fetch; then getOrFetchCredits.
  global.fetch.mockResolvedValueOnce({ json: async () => ({ id: 2, title: 'Second', release_date: '2005-01-01' }) });
  redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 42, name: 'Shared' }, { id: 7, name: 'Other' }] });

  await matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 2, mediaType: 'movie' });

  expect(room.chain).toHaveLength(2);
  expect(room.chain[1].playerId).toBe('bot_1');
  expect(room.usedMovies).toContain('movie:2');
  expect(room.players.find(p => p.id === 'bot_1').score).toBe(100);
});

test('non-connecting bot move eliminates the bot (no throw, no socket emit)', async () => {
  const room = buildRoom();
  redisUtils.getLobby.mockResolvedValue(room);
  global.fetch.mockResolvedValueOnce({ json: async () => ({ id: 99, title: 'Unrelated', release_date: '2010-01-01' }) });
  redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 999, name: 'Nobody In Common' }] });

  await expect(matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 99, mediaType: 'movie' })).resolves.not.toThrow();
  expect(room.players.find(p => p.id === 'bot_1').isAlive).toBe(false);
});

test('no-op when it is not the bot\'s turn', async () => {
  const room = buildRoom({ currentTurnIndex: 0 }); // human's turn
  redisUtils.getLobby.mockResolvedValue(room);
  await matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 2, mediaType: 'movie' });
  expect(room.chain).toHaveLength(1);
  expect(redisUtils.acquireSubmitLock).not.toHaveBeenCalled();
});

test('exports the reusable pipeline helpers', () => {
  for (const fn of ['resolveCandidates', 'enrichWithCredits', 'validateChainConnection', 'commitPlay', 'submitBotMove']) {
    expect(typeof matchSystem[fn]).toBe('function');
  }
});

test('success path releases the submit lock exactly once', async () => {
  const room = buildRoom();
  redisUtils.getLobby.mockResolvedValue(room);
  global.fetch.mockResolvedValueOnce({ json: async () => ({ id: 2, title: 'Second', release_date: '2005-01-01' }) });
  redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 42, name: 'Shared' }] });
  await matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 2, mediaType: 'movie' });
  // A leaked lock would freeze the lobby for every future move — assert release.
  expect(redisUtils.releaseSubmitLock).toHaveBeenCalledTimes(1);
  expect(redisUtils.releaseSubmitLock).toHaveBeenCalledWith(ctx.pubClient, 'TEST', 'token-bot');
});

test('isValidating is reset to false after a completed bot submit', async () => {
  const room = buildRoom();
  redisUtils.getLobby.mockResolvedValue(room);
  global.fetch.mockResolvedValueOnce({ json: async () => ({ id: 2, title: 'Second', release_date: '2005-01-01' }) });
  redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 42, name: 'Shared' }] });
  await matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 2, mediaType: 'movie' });
  // A branch that sets isValidating but forgets to clear it would soft-lock the lobby.
  expect(room.isValidating).toBe(false);
});

test('a mid-pipeline Redis throw eliminates the bot and still releases the lock', async () => {
  // Force the inner-catch path by making the post-enrich getLobby re-read
  // (inside the inner try) throw. enrichWithCredits completes successfully
  // first, then getLobby throws, landing in submitBotMove's inner catch →
  // bot eliminated + isValidating cleared + lock released via outer finally.
  const room = buildRoom();
  redisUtils.getLobby
    .mockResolvedValueOnce(room)                              // pre-lock check
    .mockResolvedValueOnce(room)                              // post-lock check (inside outer try)
    .mockRejectedValueOnce(new Error('redis mid-pipeline'))  // post-enrich re-read (inner try) → throws to inner catch
    .mockResolvedValue(room);                                 // inner-catch re-read for cleanup
  global.fetch.mockResolvedValueOnce({ json: async () => ({ id: 2, title: 'Second', release_date: '2005-01-01' }) });
  redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 42, name: 'Shared' }] });
  await expect(matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 2, mediaType: 'movie' })).resolves.not.toThrow();
  expect(room.players.find(p => p.id === 'bot_1').isAlive).toBe(false);
  expect(redisUtils.releaseSubmitLock).toHaveBeenCalledTimes(1);
  expect(room.isValidating).toBe(false);
});

// ============================================================================
// Phase 5a follow-up — the same two latent gaps submitMovie has, mirrored here
// (fixed together for consistency):
//   Gap 1: re-derive botPlayer from the FRESH post-enrich room (not the stale
//          pre-enrich object).
//   Gap 2: inner-catch getLobby re-read must be null-guarded (the existing
//          inner-catch test above returns a valid room; this one returns
//          NULL, which is the case that throws before the fix).
// ============================================================================
test('Gap 1: attemptFailed uses the botPlayer from the freshly re-read room', async () => {
  const pre = buildRoom();
  pre.players[1].name = 'StaleBot';
  // Post-enrich re-read returns a DISTINCT room whose bot was renamed during
  // the async enrich window; chain unchanged so the pick fails to connect.
  const fresh = JSON.parse(JSON.stringify(pre));
  fresh.players[1].name = 'FreshBot';

  redisUtils.getLobby
    .mockResolvedValueOnce(pre)    // L645 pre-lock
    .mockResolvedValueOnce(pre)    // L654 post-lock
    .mockResolvedValueOnce(fresh); // L678 post-enrich
  global.fetch.mockResolvedValueOnce({ json: async () => ({ id: 99, title: 'Guess', release_date: '2010-01-01' }) });
  redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 999, name: 'Nobody In Common' }] });

  await matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 99, mediaType: 'movie' });

  const attemptFailed = mockIo.emit.mock.calls.find(([e]) => e === 'attemptFailed');
  expect(attemptFailed).toBeDefined();
  expect(attemptFailed[1].playerName).toBe('FreshBot');
});

test('Gap 2: inner catch tolerates getLobby returning NULL at cleanup (resolves, lock released)', async () => {
  const room = buildRoom();
  redisUtils.getLobby
    .mockResolvedValueOnce(room)                                  // L645 pre-lock
    .mockResolvedValueOnce(room)                                  // L654 post-lock
    .mockRejectedValueOnce(new Error('redis blip mid-pipeline'))  // L678 post-enrich → throws into inner catch
    .mockResolvedValueOnce(null);                                 // L715 catch re-read → NULL
  global.fetch.mockResolvedValueOnce({ json: async () => ({ id: 99, title: 'G', release_date: '2010-01-01' }) });

  await expect(
    matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 99, mediaType: 'movie' })
  ).resolves.toBeUndefined();
  expect(redisUtils.releaseSubmitLock).toHaveBeenCalledTimes(1);
});
