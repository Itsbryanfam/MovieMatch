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
  });

  afterEach(() => {
    require('../server/gameLogic').clearTurnTimeout('L1');
  });
});
