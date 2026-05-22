// server/rule-kit-select.test.js — Phase 6c. Pins the kit-apply guards
// (host-only, waiting-only), the atomic four-field write from a real kit, the
// single broadcast, and the unknown-kit no-op.
jest.mock('./redisUtils');
jest.mock('./gameLogic');
const redisUtils = require('./redisUtils');
const gameLogic = require('./gameLogic');
const lobbySystem = require('./systems/lobbySystem');

function lockReturning(room) {
  redisUtils.withLobbyLock.mockImplementation(async (_pub, _id, fn) => {
    const res = await fn(room);
    return res === false ? null : room;
  });
}

describe('lobbySystem.selectRuleKit', () => {
  beforeEach(() => jest.clearAllMocks());

  test('host in waiting applies all four fields from the kit and broadcasts once', async () => {
    const room = { status: 'waiting', players: [{ id: 's1', isHost: true }], theme: 'any', gameMode: 'classic', hardcoreMode: false, allowTvShows: false };
    lockReturning(room);
    await lobbySystem.selectRuleKit({ io: {}, pubClient: {} }, { id: 's1' }, { lobbyId: 'L', kitId: 'hardcore_sprint' });
    expect(room.theme).toBe('any');
    expect(room.gameMode).toBe('speed');
    expect(room.hardcoreMode).toBe(true);
    expect(room.allowTvShows).toBe(false);
    expect(gameLogic.broadcastState).toHaveBeenCalledTimes(1);
  });

  test('applies a themed kit (date_night → romance/classic)', async () => {
    const room = { status: 'waiting', players: [{ id: 's1', isHost: true }], theme: 'any', gameMode: 'classic', hardcoreMode: true, allowTvShows: true };
    lockReturning(room);
    await lobbySystem.selectRuleKit({ io: {}, pubClient: {} }, { id: 's1' }, { lobbyId: 'L', kitId: 'date_night' });
    expect(room).toMatchObject({ theme: 'romance', gameMode: 'classic', hardcoreMode: false, allowTvShows: false });
  });

  test('non-host is rejected (no broadcast)', async () => {
    const room = { status: 'waiting', players: [{ id: 's1', isHost: false }], theme: 'any', gameMode: 'classic', hardcoreMode: false, allowTvShows: false };
    lockReturning(room);
    await lobbySystem.selectRuleKit({ io: {}, pubClient: {} }, { id: 's1' }, { lobbyId: 'L', kitId: 'date_night' });
    expect(room.theme).toBe('any');
    expect(gameLogic.broadcastState).not.toHaveBeenCalled();
  });

  test('non-waiting room is rejected', async () => {
    const room = { status: 'playing', players: [{ id: 's1', isHost: true }], theme: 'any', gameMode: 'classic', hardcoreMode: false, allowTvShows: false };
    lockReturning(room);
    await lobbySystem.selectRuleKit({ io: {}, pubClient: {} }, { id: 's1' }, { lobbyId: 'L', kitId: 'date_night' });
    expect(gameLogic.broadcastState).not.toHaveBeenCalled();
  });

  test('unknown kit id is a no-op (no lock, no broadcast)', async () => {
    await lobbySystem.selectRuleKit({ io: {}, pubClient: {} }, { id: 's1' }, { lobbyId: 'L', kitId: 'nope' });
    expect(redisUtils.withLobbyLock).not.toHaveBeenCalled();
    expect(gameLogic.broadcastState).not.toHaveBeenCalled();
  });
});
