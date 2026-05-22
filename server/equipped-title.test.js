// server/equipped-title.test.js — Phase 6b. Pins the equip flow's defense
// (re-derive earned set; refuse unearned) and the live in-room re-broadcast.
jest.mock('./systems/statsSystem');
jest.mock('./systems/titlesSystem');
jest.mock('./redisUtils');
jest.mock('./gameLogic');

const statsSystem = require('./systems/statsSystem');
const titlesSystem = require('./systems/titlesSystem');
const redisUtils = require('./redisUtils');
const gameLogic = require('./gameLogic');
const lobbySystem = require('./systems/lobbySystem');

describe('lobbySystem.setEquippedTitle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    statsSystem.getStats.mockResolvedValue({ gamesPlayed: 30, wins: 1, longestChain: 25, totalPlays: 0, byMode: {}, favoriteConnector: null });
    titlesSystem.setEquippedTitle.mockResolvedValue(undefined);
  });

  test('refuses an unknown title id (no persist, no broadcast)', async () => {
    const ctx = { io: {}, pubClient: {} };
    await lobbySystem.setEquippedTitle(ctx, { id: 's1' }, { stableId: 'p1', titleId: 'not_a_real_id' });
    expect(titlesSystem.setEquippedTitle).not.toHaveBeenCalled();
    expect(gameLogic.broadcastState).not.toHaveBeenCalled();
  });

  test('refuses an unearned (known) title id', async () => {
    // longestChain 25 earns chain_master, but NOT regular (needs 50 games).
    statsSystem.getStats.mockResolvedValue({ gamesPlayed: 5, wins: 0, longestChain: 25, totalPlays: 0, byMode: {}, favoriteConnector: null });
    const ctx = { io: {}, pubClient: {} };
    await lobbySystem.setEquippedTitle(ctx, { id: 's1' }, { stableId: 'p1', titleId: 'regular' });
    expect(titlesSystem.setEquippedTitle).not.toHaveBeenCalled();
  });

  test('persists an earned title and live-updates the seat when in a room', async () => {
    redisUtils.getSocketLobby.mockResolvedValue('LOB1');
    const room = { players: [{ id: 's1', name: 'A' }] };
    redisUtils.withLobbyLock.mockImplementation(async (_pub, _id, fn) => { await fn(room); return room; });
    const ctx = { io: {}, pubClient: {} };
    await lobbySystem.setEquippedTitle(ctx, { id: 's1' }, { stableId: 'p1', titleId: 'chain_master' });
    expect(titlesSystem.setEquippedTitle).toHaveBeenCalledWith({}, 'p1', 'chain_master', expect.arrayContaining(['chain_master']));
    expect(room.players[0].titleLabel).toBe('Chain Master');
    expect(gameLogic.broadcastState).toHaveBeenCalledTimes(1);
  });

  test('persists but does NOT broadcast when the player is not in a room', async () => {
    redisUtils.getSocketLobby.mockResolvedValue(null);
    const ctx = { io: {}, pubClient: {} };
    await lobbySystem.setEquippedTitle(ctx, { id: 's1' }, { stableId: 'p1', titleId: 'chain_master' });
    expect(titlesSystem.setEquippedTitle).toHaveBeenCalled();
    expect(gameLogic.broadcastState).not.toHaveBeenCalled();
  });
});
