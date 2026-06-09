// ============================================================================
// fallbackMovies.integration.test.js — Phase 5b: a full TMDB outage must NOT
// eliminate a player submitting a covered movie (the whole point of L9).
// ============================================================================
const matchSystem = require('./matchSystem');
const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');
const fallbackMovies = require('./fallbackMovies');
const botSystem = require('./botSystem');

jest.mock('../redisUtils');
global.fetch = jest.fn();

function buildRoom(over = {}) {
  return {
    id: 'TEST', status: 'playing', isValidating: false, gameMode: 'classic',
    players: [
      { id: 's1', name: 'H', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 'h' },
      { id: 'bot_1', name: 'Bot', isHost: false, isBot: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, difficulty: 'normal', stableId: null },
    ],
    spectators: [],
    chain: [{ playerId: 's1', playerName: 'H', movie: { id: 1, title: 'First', year: '2000', cast: [{ id: 42, name: 'Shared' }], mediaType: 'movie' }, matchedActors: [] }],
    usedMovies: ['movie:1'], hardcoreMode: false, previousSharedActors: [],
    allowTvShows: false, theme: 'any', isPublic: false, timerMultiplier: 0,
    turnExpiresAt: Date.now() + 60000, currentTurnIndex: 0, currentTurnRetries: 0, ...over,
  };
}
let mockIo, ctx, mockSocket;
beforeEach(() => {
  jest.clearAllMocks(); jest.restoreAllMocks();
  mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
  mockSocket = { id: 's1', emit: jest.fn() };
  ctx = { io: mockIo, pubClient: {}, TMDB_HEADERS: { Authorization: 'Bearer t', accept: 'application/json' }, logger: { error: jest.fn() } };
  redisUtils.acquireSubmitLock.mockResolvedValue('tok');
  redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
  redisUtils.saveLobby.mockResolvedValue(undefined);
  // T2 (audit P1-3): the submit pipeline's commits (validation flag, strike
  // counter, success commit, eliminate tail) now go through withLobbyLock.
  // Faithful contract mock against this file's getLobby/saveLobby mocks —
  // the in-lock "fresh" read returns the same static room object the tests
  // assert on, so commits stay visible.
  redisUtils.withLobbyLock.mockImplementation(async (pub, id, fn, opts = {}) => {
    const r = (await redisUtils.getLobby(pub, id)) || opts.seedRoom || null;
    if (!r) return null;
    const res = await fn(r);
    if (res !== false) await redisUtils.saveLobby(pub, id, r);
    return r;
  });
  // Cache miss + lock claim so getOrFetchCredits runs its fetch (which fails)
  // then hits the Phase 5b fallback. getOrFetchCredits is the REAL impl.
  redisUtils.getOrFetchCredits.mockImplementation((...a) => jest.requireActual('../redisUtils').getOrFetchCredits(...a));
  global.fetch.mockRejectedValue(new Error('TMDB DOWN')); // full outage
});
afterEach(() => {
  // submitMovie→nextTurn arms BOTH the turn watchdog and (room has a bot)
  // botSystem's scheduleBotMove timer — clear both so no setTimeout leaks
  // past the Jest worker (same hygiene pattern as botSystem.schedule.test.js).
  gameLogic.clearTurnTimeout('TEST');
  botSystem.clearBotTimeout('TEST');
});

test('covered connecting movie survives a full TMDB outage (not eliminated)', async () => {
  const room = buildRoom();
  redisUtils.getLobby.mockResolvedValue(room);
  // Covered movie #2 shares actor 42 with the chain's last node.
  jest.spyOn(fallbackMovies, 'getFallbackById').mockImplementation(id =>
    id === 2 ? { id: 2, title: 'Second', year: 2005, mediaType: 'movie', cast: [{ id: 42, name: 'Shared' }] } : null);
  // pubClient cache-miss shim so the real getOrFetchCredits reaches its fetch.
  ctx.pubClient = { get: async () => null, set: async () => 'OK', del: async () => 1 };

  await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', tmdbId: 2, mediaType: 'movie' });

  expect(room.chain.length).toBe(2);
  expect(room.players.find(p => p.id === 's1').isAlive).toBe(true);
});

test('uncovered movie during the same outage still eliminates (unchanged)', async () => {
  // WHY currentTurnRetries: 3 (= MAX_TITLE_NOT_FOUND_RETRIES): submitMovie's
  // H1 retry budget lets the player retry up to 3 times before eliminating.
  // With topCandidates === [] (TMDB down + no fallback), the first attempt
  // increments the counter and emits 'submissionRejected' rather than
  // eliminating. Pre-exhausting the budget to MAX (3) means the NEXT attempt
  // (retriesUsed=4, retriesLeft=-1 < 0) triggers immediate elimination —
  // which is exactly "today's behavior, unchanged" for an uncovered movie.
  // This is a test-harness wiring adjustment; the assertion (isAlive===false)
  // is the exact assertion from the plan, unweakened.
  const room = buildRoom({ currentTurnRetries: 3 });
  redisUtils.getLobby.mockResolvedValue(room);
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue(null); // not covered
  ctx.pubClient = { get: async () => null, set: async () => 'OK', del: async () => 1 };

  await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', tmdbId: 424242, mediaType: 'movie' });

  expect(room.players.find(p => p.id === 's1').isAlive).toBe(false);
});

test('covered bot move survives the outage (direct-ID, connecting)', async () => {
  // currentTurnIndex 1 = bot_1 (players[1]); submitBotMove gates on
  // room.players[room.currentTurnIndex].id === botId, so the bot must be the
  // active player for its move to be accepted.
  const room = buildRoom({ currentTurnIndex: 1 });
  redisUtils.getLobby.mockResolvedValue(room);
  jest.spyOn(fallbackMovies, 'getFallbackById').mockImplementation(id =>
    id === 2 ? { id: 2, title: 'Second', year: 2005, mediaType: 'movie', cast: [{ id: 42, name: 'Shared' }] } : null);
  ctx.pubClient = { get: async () => null, set: async () => 'OK', del: async () => 1 };

  await matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 2, mediaType: 'movie' });

  expect(room.chain.length).toBe(2);
  expect(room.players.find(p => p.id === 'bot_1').isAlive).toBe(true);
});

test('covered typed-title movie survives the outage via the fuzzy fallback', async () => {
  // The other resolveCandidates branch: no tmdbId, a typed `movie` string →
  // TMDB /search fetch rejects → Task 3's fuzzy fallback ranks the local DB
  // by levenshtein. End-to-end proof (the direct-ID tests above don't cover
  // the fuzzy branch through the full submit→enrich→validate→commit pipeline).
  const room = buildRoom();
  redisUtils.getLobby.mockResolvedValue(room);
  // allFallback() feeds the fuzzy ranking; getFallbackById feeds the real
  // getOrFetchCredits credits-fallback for the chosen candidate's id. Both
  // must agree on id 2 (title fuzzily matches 'Second', cast shares actor 42
  // with chain node 0 so the connection validates).
  const covered = { id: 2, title: 'Second', year: 2005, mediaType: 'movie', cast: [{ id: 42, name: 'Shared' }] };
  jest.spyOn(fallbackMovies, 'allFallback').mockReturnValue([covered]);
  jest.spyOn(fallbackMovies, 'getFallbackById').mockImplementation(id => (id === 2 ? covered : null));
  ctx.pubClient = { get: async () => null, set: async () => 'OK', del: async () => 1 };

  await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'Second' });

  expect(room.chain.length).toBe(2);
  expect(room.players.find(p => p.id === 's1').isAlive).toBe(true);
});
