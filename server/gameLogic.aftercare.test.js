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

  // I1: when _computeCouldHavePlayed resolves null the event is still emitted
  // but the `outs` key must be absent (not set to null) — guards null-spread bugs.
  test('_computeCouldHavePlayed returns null → youWereEliminated still emitted, outs key absent', async () => {
    jest.spyOn(matchSystem, '_computeCouldHavePlayed').mockResolvedValue(null);
    const { io, emits } = mkIo();
    await gameLogic.eliminateCurrentPlayer(io, {}, 'L1', baseState(), 'Turn timed out');
    const yw = emits.find(e => e.ev === 'youWereEliminated');
    expect(yw).toBeTruthy();
    expect(yw.payload.timedOut).toBe(true);
    expect(yw.payload).not.toHaveProperty('outs');
  });

  // M1a: bot (stableId null) → gating skips _computeCouldHavePlayed entirely.
  test('bot (stableId null, timeout reason) → NO youWereEliminated, spy not called', async () => {
    const spy = jest.spyOn(matchSystem, '_computeCouldHavePlayed').mockResolvedValue([{ title: 'X', year: '2', viaActor: 'Y' }]);
    const { io, emits } = mkIo();
    const st = baseState({ players: [{ id: 'b', name: 'Bot', stableId: null, connected: true, isAlive: true }] });
    await gameLogic.eliminateCurrentPlayer(io, {}, 'L1', st, 'Turn timed out');
    expect(emits.find(e => e.ev === 'youWereEliminated')).toBeFalsy();
    expect(spy).not.toHaveBeenCalled();
  });

  // M1b: human but non-timeout reason → gating skips _computeCouldHavePlayed entirely.
  test('human non-timeout reason → NO youWereEliminated, spy not called', async () => {
    const spy = jest.spyOn(matchSystem, '_computeCouldHavePlayed').mockResolvedValue([{ title: 'X', year: '2', viaActor: 'Y' }]);
    const { io, emits } = mkIo();
    await gameLogic.eliminateCurrentPlayer(io, {}, 'L1', baseState(), 'Too many invalid title attempts');
    expect(emits.find(e => e.ev === 'youWereEliminated')).toBeFalsy();
    expect(spy).not.toHaveBeenCalled();
  });

  // M1c: human disconnected at timeout → gating skips _computeCouldHavePlayed entirely.
  test('human disconnected (timeout reason) → NO youWereEliminated, spy not called', async () => {
    const spy = jest.spyOn(matchSystem, '_computeCouldHavePlayed').mockResolvedValue([{ title: 'X', year: '2', viaActor: 'Y' }]);
    const { io, emits } = mkIo();
    const st = baseState({ players: [{ id: 's', name: 'A', stableId: 'p', connected: false, isAlive: true }] });
    await gameLogic.eliminateCurrentPlayer(io, {}, 'L1', st, 'Turn timed out');
    expect(emits.find(e => e.ev === 'youWereEliminated')).toBeFalsy();
    expect(spy).not.toHaveBeenCalled();
  });
});
