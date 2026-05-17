const gameLogic = require('../server/gameLogic');
const redisUtils = require('../server/redisUtils');

jest.mock('../server/redisUtils');

describe('R2 — sweepMissingTurnWatchdogs', () => {
  const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
  const pub = {};

  afterEach(() => {
    ['L-play', 'L-wait'].forEach(id => gameLogic.clearTurnTimeout(id));
    jest.clearAllMocks();
  });

  test('arms a watchdog for a playing lobby with no active timeout', async () => {
    redisUtils.getAllLobbies.mockResolvedValue([
      { id: 'L-play', status: 'playing', players: [{ id: 'p', isAlive: true }],
        currentTurnIndex: 0, turnTime: 45000, turnExpiresAt: Date.now() + 45000 },
    ]);
    expect(gameLogic.hasActiveTurnTimeout('L-play')).toBe(false);
    const armed = await gameLogic.sweepMissingTurnWatchdogs(io, pub);
    expect(armed).toBe(1);
    expect(gameLogic.hasActiveTurnTimeout('L-play')).toBe(true);
  });

  test('does NOT re-arm a lobby that already has an active watchdog', async () => {
    const room = { id: 'L-play', status: 'playing', players: [{ id: 'p', isAlive: true }],
      currentTurnIndex: 0, turnTime: 45000, turnExpiresAt: Date.now() + 45000 };
    gameLogic.armTurnTimeout(io, pub, 'L-play', room); // pre-armed (healthy)
    expect(gameLogic.hasActiveTurnTimeout('L-play')).toBe(true);

    redisUtils.getAllLobbies.mockResolvedValue([room]);
    const armed = await gameLogic.sweepMissingTurnWatchdogs(io, pub);
    // `armed === 0` is the actual guard proof: if the !hasActiveTurnTimeout
    // gate were removed, armTurnTimeout would run (clearTurnTimeout + re-arm)
    // and armed would be 1. hasActiveTurnTimeout staying true confirms the
    // healthy timer was not cleared.
    expect(armed).toBe(0);
    expect(gameLogic.hasActiveTurnTimeout('L-play')).toBe(true);
  });

  test('skips non-playing lobbies', async () => {
    redisUtils.getAllLobbies.mockResolvedValue([
      { id: 'L-wait', status: 'waiting', players: [] },
    ]);
    const armed = await gameLogic.sweepMissingTurnWatchdogs(io, pub);
    expect(armed).toBe(0);
    expect(gameLogic.hasActiveTurnTimeout('L-wait')).toBe(false);
  });

  test('swallows a getAllLobbies rejection and returns 0', async () => {
    redisUtils.getAllLobbies.mockRejectedValue(new Error('redis down'));
    await expect(gameLogic.sweepMissingTurnWatchdogs(io, pub)).resolves.toBe(0);
  });
});
