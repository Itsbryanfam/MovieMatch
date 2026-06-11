// ============================================================================
// game-reset-lock.test.js — T4b audit fix (2026-06-09)
// ============================================================================
// Two regressions, one commit:
//   (1) STALE TIMER: scheduleGameReset's setTimeout was anonymous and never
//       cleared, so game N's +25s reset could fire into game N+1's recap after
//       a quick host restart. Now each lobby has at most one reset timer (a map
//       entry); scheduling/clearing replaces it, and the callback re-verifies
//       the finishedAt generation token before resetting.
//   (2) UNLOCKED RMW: the finished→waiting read-modify-write ran outside any
//       lock, so a concurrent lobbymut write landing in the reset window was
//       clobbered by the reset's full-blob save. The RMW now runs inside
//       withLobbyLock with a fresh re-read + finishedAt re-verify.
// ============================================================================
const redisUtils = require('../server/redisUtils');
const gameLogic = require('../server/gameLogic');

// Minimal in-memory Redis double (same shape as quit-grace-lock.test.js) — a
// tiny artificial await in get/set lets "concurrent" callers interleave, and
// the multi() chain stub no-ops the win-record writes these tests don't assert.
function makeFakeRedis() {
  const store = new Map();
  const tick = () => new Promise(r => setImmediate(r));
  const noop = () => chain;
  const chain = {
    incrBy: noop, expire: noop, zIncrBy: noop, hIncrBy: noop, hSet: noop,
    set: noop, zAdd: noop, zRemRangeByScore: noop, sAdd: noop, multi: noop,
    async exec() { return []; },
  };
  return {
    store,
    async get(key) { await tick(); return store.has(key) ? store.get(key) : null; },
    async set(key, val, opts = {}) {
      await tick();
      if (opts.NX && store.has(key)) return null;
      store.set(key, val); return 'OK';
    },
    async setEx(key, _ttl, val) { await tick(); store.set(key, val); return 'OK'; },
    async del(key) { await tick(); store.delete(key); return 1; },
    async hGet() { await tick(); return null; },
    async hSet() { await tick(); return 1; },
    async eval(_s, { keys, arguments: args }) {
      await tick();
      const k = keys[0];
      if (store.get(k) === args[0]) { store.delete(k); return 1; }
      return 0;
    },
    multi() { return chain; },
  };
}

// A finished single-player (solo) room so checkWinCondition resolves quickly
// through checkSoloWin (no global-leaderboard writes that need richer mocks).
function buildAliveSoloRoom(finishedAtSeed) {
  return {
    id: 'L1', status: 'playing', gameMode: 'solo', currentTurnIndex: 0,
    chain: [{ movie: { title: 'Seed' } }, { movie: { title: 'A' } }],
    usedMovies: [], spectators: [],
    // dead solo player → checkSoloWin finishes the game immediately.
    players: [{ id: 's0', name: 'Solo', isAlive: false, connected: true, stableId: 'k0', score: 0 }],
    _seed: finishedAtSeed,
  };
}

const io = () => ({ to: jest.fn().mockReturnThis(), emit: jest.fn() });

// Fake ONLY setTimeout/clearTimeout so we can fire the 25s reset deterministically;
// keep setImmediate/queueMicrotask/nextTick REAL so the fake-redis tick() awaits
// (and the reset callback's awaited lock/save) still resolve under fake clock.
function enableResetTimerFakes() {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick'] });
}
// Run pending setTimeout callbacks, then drain enough real microtask/immediate
// turns for the reset callback's awaited Redis round-trips to complete.
async function fireResetAndDrain() {
  jest.runOnlyPendingTimers();
  for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r));
}

afterEach(() => {
  jest.useRealTimers();
  gameLogic.clearTurnTimeout('L1');
  gameLogic.clearGameResetTimeout('L1');
  jest.restoreAllMocks();
});

describe('T4b — game-reset timer is tracked + replace-on-schedule', () => {
  test('scheduling a new reset clears the prior timer (no stale double-fire)', async () => {
    enableResetTimerFakes();
    const pub = makeFakeRedis();
    const room = buildAliveSoloRoom();
    await redisUtils.saveLobby(pub, 'L1', room);

    // Finish game N → schedules reset N (and stamps finishedAt = tN).
    await gameLogic.checkWinCondition(io(), pub, 'L1', room);
    const finishedAtN = (await redisUtils.getLobby(pub, 'L1')).finishedAt;
    expect(finishedAtN).toBeGreaterThan(0);

    // Advance the FAKE clock (without firing the 25s reset) so the second
    // finish stamps a distinct finishedAt — the cross-game generation token.
    jest.setSystemTime(Date.now() + 5);

    // Simulate a quick host restart-then-finish: the lobby is finished AGAIN
    // with a NEW generation token, scheduling reset N+1 which must clear N.
    const room2 = await redisUtils.getLobby(pub, 'L1');
    room2.status = 'playing';
    room2.players[0].isAlive = false;
    await redisUtils.saveLobby(pub, 'L1', room2);
    await gameLogic.checkWinCondition(io(), pub, 'L1', room2);
    const finishedAtN1 = (await redisUtils.getLobby(pub, 'L1')).finishedAt;
    expect(finishedAtN1).not.toBe(finishedAtN);

    // Fire all pending timers. Only ONE reset should run (the prior was cleared
    // on the second schedule), and it resets the CURRENT finished game cleanly.
    await fireResetAndDrain();

    const finalRoom = await redisUtils.getLobby(pub, 'L1');
    // The (single) reset succeeded: room is back to waiting, token consumed.
    expect(finalRoom.status).toBe('waiting');
    expect(finalRoom.finishedAt).toBe(null);
  });

  test('clearGameResetTimeout cancels a pending reset (lobby teardown path)', async () => {
    enableResetTimerFakes();
    const pub = makeFakeRedis();
    const room = buildAliveSoloRoom();
    await redisUtils.saveLobby(pub, 'L1', room);
    await gameLogic.checkWinCondition(io(), pub, 'L1', room);

    // Teardown clears the pending reset before it can fire.
    gameLogic.clearGameResetTimeout('L1');
    await fireResetAndDrain();

    // Reset never ran — the room is still 'finished'.
    const finalRoom = await redisUtils.getLobby(pub, 'L1');
    expect(finalRoom.status).toBe('finished');
  });
});

describe('T4b — reset RMW commits under lobbymut (no clobber)', () => {
  test('a concurrent lobbymut write is NOT clobbered by the reset commit', async () => {
    enableResetTimerFakes();
    const pub = makeFakeRedis();
    const room = buildAliveSoloRoom();
    await redisUtils.saveLobby(pub, 'L1', room);
    await gameLogic.checkWinCondition(io(), pub, 'L1', room);

    // Land a concurrent lobbymut write WHILE the reset timer is pending: stamp
    // a marker field via the same withLobbyLock helper the reset uses. Because
    // the reset re-reads fresh INSIDE the lock, its save must preserve marker.
    await redisUtils.withLobbyLock(pub, 'L1', (r) => { r.concurrentMarker = 'kept'; });

    await fireResetAndDrain();

    const finalRoom = await redisUtils.getLobby(pub, 'L1');
    expect(finalRoom.status).toBe('waiting');         // reset still applied
    expect(finalRoom.concurrentMarker).toBe('kept');  // and didn't clobber the concurrent write
  });

  test('reset DECLINES when the finishedAt generation no longer matches', async () => {
    enableResetTimerFakes();
    const pub = makeFakeRedis();
    const room = buildAliveSoloRoom();
    await redisUtils.saveLobby(pub, 'L1', room);
    await gameLogic.checkWinCondition(io(), pub, 'L1', room);

    // Simulate game N+1 finishing in the reset window: bump finishedAt to a
    // NEW token directly in Redis. The pending (game-N) reset must re-verify
    // the token, see the mismatch, and DECLINE — leaving the newer finished
    // game untouched (no premature flip to 'waiting').
    const live = await redisUtils.getLobby(pub, 'L1');
    live.finishedAt = (live.finishedAt || 0) + 9999;
    live.status = 'finished';
    await redisUtils.saveLobby(pub, 'L1', live);
    const newToken = live.finishedAt;

    await fireResetAndDrain();

    const finalRoom = await redisUtils.getLobby(pub, 'L1');
    // Declined: still finished, token unchanged (the stale reset did NOT win).
    expect(finalRoom.status).toBe('finished');
    expect(finalRoom.finishedAt).toBe(newToken);
  });
});
