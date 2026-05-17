// ============================================================================
// lobby-lock.test.js — Audit finding #4: lobby mutations are full-blob
// read-modify-write on a single Redis key with no concurrency control, so
// two events that land in the same get→mutate→set window silently drop one
// of the two updates (e.g. two players joining the same lobby at once —
// only one ends up in the players array).
// ============================================================================
// withLobbyLock is the fix: a per-lobby mutex (SET NX PX + Lua
// compare-and-delete, the same primitive the submit lock already uses) that
// serializes the read-modify-write so concurrent mutators compose instead
// of clobbering. These tests pin: (1) lost-update is actually prevented
// under contention, (2) a mutator returning false suppresses the save,
// (3) the lock is always released so the next writer isn't deadlocked.
// ============================================================================

const redisUtils = require('./redisUtils');

// Minimal in-memory Redis double with just the surface withLobbyLock +
// getLobby/saveLobby touch: get, set (NX/PX honored), setEx, del, eval
// (the compare-and-delete release script). A tiny artificial await in
// get/set lets two "concurrent" callers interleave deterministically.
function makeFakeRedis() {
  const store = new Map();
  const tick = () => new Promise(r => setImmediate(r));
  return {
    store,
    async get(key) { await tick(); return store.has(key) ? store.get(key) : null; },
    async set(key, val, opts = {}) {
      await tick();
      if (opts.NX && store.has(key)) return null;
      store.set(key, val);
      return 'OK';
    },
    async setEx(key, _ttl, val) { await tick(); store.set(key, val); return 'OK'; },
    async del(key) { await tick(); store.delete(key); return 1; },
    async eval(_script, { keys, arguments: args }) {
      // Mirrors SUBMIT_LOCK_RELEASE_SCRIPT: delete only if value matches.
      await tick();
      const k = keys[0];
      if (store.get(k) === args[0]) { store.delete(k); return 1; }
      return 0;
    },
  };
}

describe('audit #4 — withLobbyLock serializes lobby read-modify-write', () => {
  test('exists as a redisUtils export', () => {
    expect(typeof redisUtils.withLobbyLock).toBe('function');
  });

  test('two concurrent joins both survive (no lost update)', async () => {
    const pub = makeFakeRedis();
    await redisUtils.saveLobby(pub, 'L1', { id: 'L1', players: [] });

    // Both callers run "load → push myself → save" at the same time. Without
    // the lock they both read players:[] and the second save wipes the first
    // player. With it, the mutations compose: final players length === 2.
    const join = (name) => redisUtils.withLobbyLock(pub, 'L1', (room) => {
      room.players.push({ name });
    });

    await Promise.all([join('Alice'), join('Bob')]);

    const final = await redisUtils.getLobby(pub, 'L1');
    expect(final.players.map(p => p.name).sort()).toEqual(['Alice', 'Bob']);
  });

  test('returning false from the mutator suppresses the save', async () => {
    const pub = makeFakeRedis();
    await redisUtils.saveLobby(pub, 'L2', { id: 'L2', n: 1 });

    await redisUtils.withLobbyLock(pub, 'L2', (room) => {
      room.n = 999;
      return false; // e.g. "caller wasn't the host" — don't persist
    });

    const final = await redisUtils.getLobby(pub, 'L2');
    expect(final.n).toBe(1);
  });

  test('lock is released even if the mutator throws (no deadlock)', async () => {
    const pub = makeFakeRedis();
    await redisUtils.saveLobby(pub, 'L3', { id: 'L3', n: 0 });

    await expect(
      redisUtils.withLobbyLock(pub, 'L3', () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    // A subsequent mutation must still be able to take the lock and persist.
    await redisUtils.withLobbyLock(pub, 'L3', (room) => { room.n = 42; });
    const final = await redisUtils.getLobby(pub, 'L3');
    expect(final.n).toBe(42);
  });

  test('no-op (returns null) when the lobby does not exist', async () => {
    const pub = makeFakeRedis();
    const fn = jest.fn();
    const result = await redisUtils.withLobbyLock(pub, 'GONE', fn);
    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });
});
