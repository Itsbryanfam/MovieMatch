const gameLogic = require('./gameLogic');
const matchSystem = require('./systems/matchSystem');

// Mock redisUtils so gameLogic internals (saveLobby, etc.) don't need a live
// Redis connection — same pattern used in turn-watchdog.test.js.
jest.mock('./redisUtils');

function mkIo() {
  const emits = [];
  const io = { to: (id) => ({ emit: (ev, payload) => emits.push({ id, ev, payload }) }) };
  return { io, emits };
}
function baseState(extra) {
  return Object.assign({
    gameMode: 'classic', status: 'playing', currentTurnIndex: 0,
    chain: [{ movie: { id: 9, title: 'Heat', year: 1995, cast: [{ name: 'Al' }] } }],
    players: [{ id: 'sock1', name: 'Ann', stableId: 'p1', connected: true, isAlive: true }],
  }, extra);
}

describe('eliminateCurrentPlayer — timeout aftercare', () => {
  afterEach(() => jest.restoreAllMocks());

  test('human non-team connected timeout → private youWereEliminated, timedOut, no yourGuess', async () => {
    jest.spyOn(matchSystem, '_computeCouldHavePlayed').mockResolvedValue([{ title: 'Speed', year: '1994', viaActor: 'Al' }]);
    const { io, emits } = mkIo();
    await gameLogic.eliminateCurrentPlayer(io, {}, 'L1', baseState(), 'Turn timed out');
    const yw = emits.find(e => e.ev === 'youWereEliminated');
    expect(yw).toBeTruthy();
    expect(yw.id).toBe('sock1');
    expect(yw.payload.timedOut).toBe(true);
    expect(yw.payload.yourGuess).toBeUndefined();
    expect(yw.payload.outs).toEqual([{ title: 'Speed', year: '1994', viaActor: 'Al' }]);
  });

  test('bot / non-timeout reason / disconnected → NO youWereEliminated', async () => {
    const spy = jest.spyOn(matchSystem, '_computeCouldHavePlayed').mockResolvedValue([{ title: 'X', year: '2', viaActor: 'Y' }]);
    for (const st of [
      baseState({ players: [{ id: 'b', name: 'Bot', stableId: null, connected: true, isAlive: true }] }),
      baseState(), // reason below is non-timeout
      baseState({ players: [{ id: 's', name: 'A', stableId: 'p', connected: false, isAlive: true }] }),
    ]) {
      const { io, emits } = mkIo();
      const reason = st.players[0].stableId === null ? 'Turn timed out'
                   : st.players[0].connected ? "Too many invalid title attempts"
                   : 'Turn timed out';
      await gameLogic.eliminateCurrentPlayer(io, {}, 'L1', st, reason);
      expect(emits.find(e => e.ev === 'youWereEliminated')).toBeFalsy();
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
