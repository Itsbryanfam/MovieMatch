// R1 — quitGame + grace-timer non-current-turn branches did an unlocked
// getLobby -> mutate -> saveLobby, so two concurrent non-current-turn
// departures on one lobby could clobber each other (one death lost). This
// pins that both compose through withLobbyLock.
const redisUtils = require('../server/redisUtils');
const lobbySystem = require('../server/systems/lobbySystem');

// Same minimal in-memory Redis double shape as lobby-lock.test.js: a tiny
// artificial await in get/set lets two "concurrent" callers interleave.
function makeFakeRedis() {
  const store = new Map();
  const tick = () => new Promise(r => setImmediate(r));

  // Minimal multi() chain stub — supports the methods called by
  // recordPlayerWinAtomic (incrBy, expire, zIncrBy, set) and telemetry.track
  // (zAdd, zRemRangeByScore, sAdd). All mutations are no-ops here since
  // these tests only need to verify the lobby player state, not win stats.
  const noop = () => chain;
  const chain = {
    incrBy: noop, expire: noop, zIncrBy: noop,
    set: noop, zAdd: noop, zRemRangeByScore: noop, sAdd: noop,
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
    async eval(_s, { keys, arguments: args }) {
      await tick();
      const k = keys[0];
      if (store.get(k) === args[0]) { store.delete(k); return 1; }
      return 0;
    },
    // multi() returns a command-chain builder; exec() resolves the batch.
    multi() { return chain; },
  };
}

function buildPlayingRoom() {
  // currentTurnIndex = 0 → players[1] and players[2] are NON-current; their
  // quits exercise the locked else-branch. players[0] stays current.
  return {
    id: 'L1', status: 'playing', currentTurnIndex: 0,
    chain: [], spectators: [],
    players: [
      { id: 's0', name: 'Cur',  isAlive: true, connected: true, stableId: 'k0' },
      { id: 's1', name: 'NonA', isAlive: true, connected: true, stableId: 'k1' },
      { id: 's2', name: 'NonB', isAlive: true, connected: true, stableId: 'k2' },
    ],
  };
}

describe('R1 — non-current-turn quit/grace mutate through withLobbyLock', () => {
  test('two concurrent non-current-turn quits both persist (no lost update)', async () => {
    const pub = makeFakeRedis();
    await redisUtils.saveLobby(pub, 'L1', buildPlayingRoom());

    const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    const ctx = { io, pubClient: pub };

    await Promise.all([
      lobbySystem.quitGame(ctx, { id: 's1' }, 'L1'),
      lobbySystem.quitGame(ctx, { id: 's2' }, 'L1'),
    ]);

    const final = await redisUtils.getLobby(pub, 'L1');
    const byId = Object.fromEntries(final.players.map(p => [p.id, p.isAlive]));
    expect(byId.s1).toBe(false);
    expect(byId.s2).toBe(false);
    expect(byId.s0).toBe(true); // current player untouched
  });

  test('quitting an already-dead non-current player does not throw / no resurrection', async () => {
    const pub = makeFakeRedis();
    const room = buildPlayingRoom();
    room.players[1].isAlive = false; // s1 already dead
    await redisUtils.saveLobby(pub, 'L1', room);
    const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

    await lobbySystem.quitGame({ io, pubClient: pub }, { id: 's1' }, 'L1');

    const final = await redisUtils.getLobby(pub, 'L1');
    expect(final.players.find(p => p.id === 's1').isAlive).toBe(false);
    // C1 regression guard: a no-op quit on an already-dead player must NOT
    // emit a spurious "quit" notification or broadcast (withLobbyLock
    // returns the room even when the mutator declines to persist).
    // `io.to(lobbyId).emit(...)` routes through `io.emit` because
    // `io.to` is mocked to return `this` (the same `io` object), so
    // `io.emit` not being called proves no notification or broadcastState
    // fired on this path.
    expect(io.emit).not.toHaveBeenCalled();
  });

  afterEach(() => {
    require('../server/gameLogic').clearTurnTimeout('L1');
    // NOTE (Phase 2 R3): the win path in test 1 (two concurrent quits kill
    // both non-current players, leaving one survivor) may arm a
    // scheduleGameReset timer; Task 5 (Jest clean-exit) owns sweeping any
    // residual open handle. scheduleGameReset is not exported from
    // gameLogic.js, so no simple clear call exists here.
  });
});

// T1 audit (2026-06-09), fix T1c: the CURRENT-turn quit branch was the lone
// eliminateCurrentPlayer call site holding NO submit lock (watchdog,
// forceNextTurn, and the bot-whiff path all take it), and it passed the
// UNLOCKED snapshot read at the top of quitGame. eliminateCurrentPlayer
// mutates state, advances the turn, and saves — doing that on a stale
// snapshot races an in-flight submit (double-eliminate / clobbered chain
// advance). These pin the forceNextTurn-mirroring contract: acquire submit
// lock → fresh in-lock re-read → re-verify → eliminate fresh → release.
describe('T1c — current-turn quit eliminates under the submit lock', () => {
  const gameLogic = require('../server/gameLogic');
  let pub, io, ctx, elim, acquire, release;

  beforeEach(async () => {
    pub = makeFakeRedis();
    await redisUtils.saveLobby(pub, 'L1', buildPlayingRoom());
    io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    ctx = { io, pubClient: pub };
    // Stub eliminate: these tests pin quitGame's lock ORCHESTRATION, not the
    // whole elimination pipeline (gameLogic.test.js owns that).
    elim = jest.spyOn(gameLogic, 'eliminateCurrentPlayer').mockResolvedValue(undefined);
    acquire = jest.spyOn(redisUtils, 'acquireSubmitLock');
    release = jest.spyOn(redisUtils, 'releaseSubmitLock').mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Spies patch the SHARED module objects lobbySystem holds — restore so
    // the R1 describe above keeps exercising the real implementations.
    jest.restoreAllMocks();
    gameLogic.clearTurnTimeout('L1');
  });

  test('acquires the lock, re-reads, and passes the FRESH room to eliminate', async () => {
    // Simulate a concurrent commit landing between quitGame's unlocked
    // pre-read and its lock grant: at acquire time, stamp a marker onto the
    // PERSISTED room. Only a post-lock re-read can see the marker — the
    // pre-lock snapshot (the pre-fix bug) cannot.
    acquire.mockImplementation(async (p, id) => {
      const live = await redisUtils.getLobby(p, id);
      live.freshMarker = true;
      await redisUtils.saveLobby(p, id, live);
      return 'tok-1';
    });

    await lobbySystem.quitGame(ctx, { id: 's0' }, 'L1'); // s0 holds the turn

    expect(acquire).toHaveBeenCalledWith(pub, 'L1');
    expect(elim).toHaveBeenCalledTimes(1);
    // 4th arg is the room — it must be the in-lock read, not the stale snapshot.
    expect(elim.mock.calls[0][3].freshMarker).toBe(true);
    expect(elim.mock.calls[0][4]).toBe('Quit'); // reason string preserved
    expect(release).toHaveBeenCalledWith(pub, 'L1', 'tok-1');
  });

  test('lock is released even when eliminate throws', async () => {
    acquire.mockResolvedValue('tok-2');
    elim.mockRejectedValue(new Error('eliminate boom'));

    // quitGame propagates (forceNextTurn does the same; safeOn catches in
    // prod) — what matters is the finally still released the lock, or the
    // lobby would freeze for the 30s lock TTL after any eliminate fault.
    await expect(lobbySystem.quitGame(ctx, { id: 's0' }, 'L1'))
      .rejects.toThrow('eliminate boom');
    expect(release).toHaveBeenCalledWith(pub, 'L1', 'tok-2');
  });

  test('no lock acquired → no eliminate (someone else is advancing the turn)', async () => {
    acquire.mockResolvedValue(null);

    await lobbySystem.quitGame(ctx, { id: 's0' }, 'L1');

    expect(elim).not.toHaveBeenCalled();
    // Nothing acquired → nothing released (token-guarded by construction).
    expect(release).not.toHaveBeenCalled();
  });

  test('fresh re-read shows the turn moved on → no eliminate (stale-quit race)', async () => {
    // The exact race the lock exists for: while the quit was in flight, the
    // previous lock holder advanced the turn to s1. Eliminating "the current
    // player" off the stale snapshot would now kill the WRONG player.
    acquire.mockImplementation(async (p, id) => {
      const live = await redisUtils.getLobby(p, id);
      live.currentTurnIndex = 1;
      await redisUtils.saveLobby(p, id, live);
      return 'tok-3';
    });

    await lobbySystem.quitGame(ctx, { id: 's0' }, 'L1');

    expect(elim).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(pub, 'L1', 'tok-3'); // still released
  });
});
