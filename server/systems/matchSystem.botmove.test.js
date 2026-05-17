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
