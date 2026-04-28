const gameLogic = require('./gameLogic');
const redisUtils = require('./redisUtils');

jest.mock('./redisUtils');
jest.useFakeTimers();

describe('gameLogic tests', () => {
  let mockIo;
  let mockPubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn()
    };
    mockPubClient = {};
  });

  test('resetTimer sets turnExpiresAt for speed mode', () => {
    const state = { gameMode: 'speed', turnExpiresAt: null };
    gameLogic.resetTimer(state);
    expect(state.turnExpiresAt).toBeGreaterThan(Date.now());
    expect(state.turnExpiresAt).toBeLessThanOrEqual(Date.now() + 15000);
  });

  test('resetTimer sets turnExpiresAt for classic mode', () => {
    const state = { gameMode: 'classic', timerMultiplier: 0, turnExpiresAt: null };
    gameLogic.resetTimer(state);
    expect(state.turnExpiresAt).toBeGreaterThan(Date.now());
  });

  test('startGame sets initial state correctly', async () => {
    const state = {
      gameMode: 'classic',
      players: [
        { id: '1', isAlive: false, score: 100 },
        { id: '2', isAlive: false, score: 100 }
      ],
      status: 'waiting'
    };

    await gameLogic.startGame(mockIo, mockPubClient, 'LOBBY1', state);

    expect(state.status).toBe('playing');
    expect(state.chain).toEqual([]);
    expect(state.usedMovies).toEqual([]);
    expect(state.players[0].isAlive).toBe(true);
    expect(state.players[0].score).toBe(0);
    expect(redisUtils.saveLobby).toHaveBeenCalledWith(mockPubClient, 'LOBBY1', state);
  });

  test('checkWinCondition finishes game when one player left in classic mode', async () => {
    const state = {
      gameMode: 'classic',
      players: [
        { id: '1', name: 'Player 1', isAlive: true, wins: 0, score: 100 },
        { id: '2', name: 'Player 2', isAlive: false, wins: 0, score: 50 }
      ],
      chain: [],
      status: 'playing',
      winner: null
    };

    await gameLogic.checkWinCondition(mockIo, mockPubClient, 'LOBBY1', state);

    expect(state.status).toBe('finished');
    expect(state.winner).toEqual({ name: 'Player 1', score: 100, id: '1' });
    expect(state.players[0].wins).toBe(1);
    expect(redisUtils.saveLobby).toHaveBeenCalledWith(mockPubClient, 'LOBBY1', state);
    expect(mockIo.to).toHaveBeenCalledWith('LOBBY1');
    expect(mockIo.emit).toHaveBeenCalledWith('notification', 'Player 1 wins!');
  });
});
