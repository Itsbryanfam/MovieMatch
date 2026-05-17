// ============================================================================
// botSystem.schedule.test.js — Phase 5a scheduleBotMove (own file: hoisted
// jest.mock('../redisUtils') + spyOn(generateBotMove) must not leak into the
// real difficulty/move-gen tests in botSystem.test.js).
// ============================================================================
const botSystem = require('./botSystem');
const matchSystem = require('./matchSystem');
const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');
jest.mock('../redisUtils');

describe('scheduleBotMove', () => {
  jest.useFakeTimers();

  const mkIo = () => ({ to: jest.fn().mockReturnThis(), emit: jest.fn() });
  function room(over = {}) {
    return {
      id: 'L1', status: 'playing', isValidating: false, gameMode: 'classic',
      players: [
        { id: 'sock-1', name: 'H', isAlive: true },
        { id: 'bot_1', name: 'Bot Bogart', isBot: true, isAlive: true, difficulty: 'normal' },
      ],
      currentTurnIndex: 1, chain: [], usedMovies: [], previousSharedActors: [], hardcoreMode: false,
      ...over,
    };
  }
  afterEach(() => { botSystem.clearBotTimeout('L1'); jest.clearAllMocks(); });

  test('non-bot current turn → no timer scheduled', () => {
    const r = room({ currentTurnIndex: 0 });
    botSystem.scheduleBotMove(mkIo(), {}, 'L1', r);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('bot turn schedules a move that calls submitBotMove with a generated pick', async () => {
    const io = mkIo();
    const r = room();
    redisUtils.getLobby.mockResolvedValue(r);
    jest.spyOn(botSystem, 'generateBotMove').mockResolvedValue({ tmdbId: 5, mediaType: 'movie' });
    const spy = jest.spyOn(matchSystem, 'submitBotMove').mockResolvedValue(undefined);
    botSystem.scheduleBotMove(io, {}, 'L1', r, { rng: () => 0 }); // delay = delayMinMs
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(3000 + 5);
    expect(spy).toHaveBeenCalledWith(expect.anything(), 'L1', 'bot_1', { tmdbId: 5, mediaType: 'movie' });
  });

  test('whiff (generateBotMove → null) gracefully eliminates under the lock', async () => {
    const io = mkIo();
    const r = room();
    redisUtils.getLobby.mockResolvedValue(r);
    redisUtils.acquireSubmitLock.mockResolvedValue('tok');
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.saveLobby.mockResolvedValue(undefined);
    jest.spyOn(botSystem, 'generateBotMove').mockResolvedValue(null);
    const elim = jest.spyOn(gameLogic, 'eliminateCurrentPlayer').mockResolvedValue(undefined);
    botSystem.scheduleBotMove(io, {}, 'L1', r, { rng: () => 0 });
    await jest.advanceTimersByTimeAsync(3000 + 5);
    expect(elim).toHaveBeenCalledWith(io, expect.anything(), 'L1', r, "Bot couldn't find a move");
  });

  test('stale fire is a safe no-op when the turn has moved on', async () => {
    const io = mkIo();
    const scheduled = room();
    botSystem.scheduleBotMove(io, {}, 'L1', scheduled, { rng: () => 0 });
    // By the time it fires the live room is on the human's turn.
    redisUtils.getLobby.mockResolvedValue(room({ currentTurnIndex: 0 }));
    const spy = jest.spyOn(matchSystem, 'submitBotMove').mockResolvedValue(undefined);
    await jest.advanceTimersByTimeAsync(3000 + 5);
    expect(spy).not.toHaveBeenCalled();
  });
});
