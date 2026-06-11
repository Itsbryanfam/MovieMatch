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

// ============================================================================
// T8a audit fix — spin exhaustion DECLINES the mutation (no unlocked save)
// ============================================================================
// WHY: the pre-fix bounded spin loop set acquired=false on exhaustion but then
// PROCEEDED into the try and ran getLobby→mutator→saveLobby ANYWAY (the finally
// only RELEASED when acquired). That is a real lost-update race, NOT a benign
// best-effort skip: several mutators await Redis INSIDE the critical section
// (joinLobby reads wins/title data), so under slow Redis a legitimate section
// can exceed the spin budget; a second concurrent writer then fell through,
// read the PRE-lock room, and saved a full blob with NO mutex held — clobbering
// the committed write withLobbyLock exists to protect. The fix: on TRUE
// exhaustion, DECLINE (return null, the existing "lobby unavailable" signal)
// WITHOUT calling getLobby/mutator/saveLobby. These tests pin that invariant.
describe('T8a — spin exhaustion declines the mutation (never saves unlocked)', () => {
  // A fake whose lock SET never succeeds (NX always reports the key held) —
  // models permanent contention so the spin budget is genuinely exhausted.
  // SPIN_INTERVAL_MS is forced to ~0 below so this stays deterministic and
  // fast (no real multi-second sleeps) while still exercising every attempt.
  function makeContendedRedis() {
    const store = new Map();
    const tick = () => new Promise(r => setImmediate(r));
    const fake = {
      store,
      lockSets: 0, // how many times we tried to SET the mutex key
      async get(key) { await tick(); return store.has(key) ? store.get(key) : null; },
      async set(key, _val) {
        await tick();
        // The lobby mutex key: pretend a holder is permanently parked on it
        // so NX never returns 'OK'. Any OTHER key (the lobby blob via saveLobby)
        // would set normally — but the whole point is saveLobby must never run.
        if (key.startsWith('lock:lobbymut:')) {
          fake.lockSets++;
          return null; // NX conflict forever → exhaustion
        }
        store.set(key, _val);
        return 'OK';
      },
      async setEx(key, _ttl, val) { await tick(); store.set(key, val); return 'OK'; },
      async del(key) { await tick(); store.delete(key); return 1; },
      async eval(_s, { keys, arguments: args }) {
        await tick();
        if (store.get(keys[0]) === args[0]) { store.delete(keys[0]); return 1; }
        return 0;
      },
    };
    return fake;
  }

  // Force a near-zero spin interval so the full attempt budget runs in
  // milliseconds — we exercise REAL exhaustion without a real ~5s wait.
  const prevInterval = process.env.LOBBY_MUTEX_SPIN_INTERVAL_MS;
  beforeAll(() => { process.env.LOBBY_MUTEX_SPIN_INTERVAL_MS = '0'; });
  afterAll(() => {
    if (prevInterval === undefined) delete process.env.LOBBY_MUTEX_SPIN_INTERVAL_MS;
    else process.env.LOBBY_MUTEX_SPIN_INTERVAL_MS = prevInterval;
  });

  test('under permanent contention: returns null, mutator never runs, NO save', async () => {
    const pub = makeContendedRedis();
    // Seed a real lobby blob so we can prove the unlocked code path WOULD have
    // found a room to clobber — the decline must skip it regardless.
    await redisUtils.saveLobby(pub, 'L1', { id: 'L1', n: 1 });
    // Spy on get/eval so we can assert the declined path touches NEITHER the
    // lobby read (getLobby) nor a release (eval) — only the lock SET attempts.
    jest.spyOn(pub, 'get');
    jest.spyOn(pub, 'eval');
    const fn = jest.fn();

    const result = await redisUtils.withLobbyLock(pub, 'L1', fn);

    // Declined: the existing "lobby unavailable" null signal callers handle.
    expect(result).toBeNull();
    // The mutator never ran — no read-modify-write was attempted.
    expect(fn).not.toHaveBeenCalled();
    // getLobby (a pub.get on lobby:L1) was NEVER issued on the decline path.
    expect(pub.get).not.toHaveBeenCalled();
    // No release eval either (we never acquired, so there's nothing to free).
    expect(pub.eval).not.toHaveBeenCalled();
    // The seeded blob is untouched — the exact lost-update the fix prevents.
    expect(JSON.parse(pub.store.get('lobby:L1')).n).toBe(1);
  });

  test('the spin budget exceeds the lock TTL (waits long enough to outlast a crashed holder)', async () => {
    // The invariant behind picking the budget: a crashed holder's lock self-
    // frees at LOBBY_MUTEX_TTL_MS, so total spin wait must comfortably exceed
    // that TTL or we'd give up before the dead lock could ever expire. Assert
    // the exported constants encode budget > TTL (deterministic; no sleeping).
    expect(typeof redisUtils.LOBBY_MUTEX_SPIN_ATTEMPTS).toBe('number');
    expect(typeof redisUtils.LOBBY_MUTEX_SPIN_INTERVAL_MS).toBe('number');
    expect(typeof redisUtils.LOBBY_MUTEX_TTL_MS).toBe('number');
    const budget = redisUtils.LOBBY_MUTEX_SPIN_ATTEMPTS * redisUtils.LOBBY_MUTEX_SPIN_INTERVAL_MS;
    expect(budget).toBeGreaterThan(redisUtils.LOBBY_MUTEX_TTL_MS);
  });

  test('a late-releasing holder is still acquired (does not give up early)', async () => {
    // Drive the contended fake but let the holder "release" after a handful of
    // attempts: NX returns null the first few SETs, then 'OK'. The loop must
    // keep spinning through to that release and then mutate+save normally.
    const store = new Map();
    const tick = () => new Promise(r => setImmediate(r));
    let lockAttempts = 0;
    const pub = {
      store,
      async get(key) { await tick(); return store.has(key) ? store.get(key) : null; },
      async set(key, val) {
        await tick();
        if (key.startsWith('lock:lobbymut:')) {
          lockAttempts++;
          // Holder lingers for 5 attempts, then frees the lock.
          if (lockAttempts <= 5) return null;
          store.set(key, val);
          return 'OK';
        }
        store.set(key, val);
        return 'OK';
      },
      async setEx(key, _ttl, val) { await tick(); store.set(key, val); return 'OK'; },
      async del(key) { await tick(); store.delete(key); return 1; },
      async eval(_s, { keys, arguments: args }) {
        await tick();
        if (store.get(keys[0]) === args[0]) { store.delete(keys[0]); return 1; }
        return 0;
      },
    };
    await redisUtils.saveLobby(pub, 'L2', { id: 'L2', n: 0 });

    const room = await redisUtils.withLobbyLock(pub, 'L2', (r) => { r.n = 9; });

    // It waited past the contended attempts and committed normally.
    expect(room.n).toBe(9);
    expect(JSON.parse(store.get('lobby:L2')).n).toBe(9);
    expect(lockAttempts).toBeGreaterThan(5);
  });
});

// ============================================================================
// T7c audit fix — isValidLobbyId chokepoint guard on getLobby / withLobbyLock
// ============================================================================
// WHY: T1f's `/^[A-Z0-9_-]{1,32}$/` guard only protected the joinLobby handler.
// Every OTHER lobbyId-taking handler (setGameMode, selectRuleKit, kickPlayer,
// quitGame, sendChat, …) forwarded the RAW client lobbyId straight into
// withLobbyLock — which does `SET lock:lobbymut:<id> NX PX` BEFORE any
// existence check — and/or getLobby (a large-key GET). An attacker could mint
// arbitrary multi-KB lock/GET keys per call. The fix validates at the single
// chokepoint so a malformed id no-ops WITHOUT touching Redis at all: no lock
// SET, no GET. These tests pin (1) the charset, (2) the zero-Redis-call no-op
// on both functions, (3) that the underscore-bearing DAILY id still passes
// (the regex was widened from the T1f form to admit it — see source comment).

describe('T7c — isValidLobbyId chokepoint (defense-in-depth)', () => {
  test('isValidLobbyId is exported and judges the lobby-id charset', () => {
    expect(typeof redisUtils.isValidLobbyId).toBe('function');
    // Legit shapes: generated 6-char code (uppercase alnum, no hyphen) and the
    // DAILY id whose stableId segment carries the client `p_` underscore.
    expect(redisUtils.isValidLobbyId('ABC234')).toBe(true);
    expect(redisUtils.isValidLobbyId('DAILY-P_AB12CD34EF-20260609')).toBe(true);
    // Rejected: empty, over-32, non-string, and conforming-charset violations.
    expect(redisUtils.isValidLobbyId('')).toBe(false);
    expect(redisUtils.isValidLobbyId('A'.repeat(33))).toBe(false);
    expect(redisUtils.isValidLobbyId('has space')).toBe(false);
    expect(redisUtils.isValidLobbyId('lower!case')).toBe(false);
    expect(redisUtils.isValidLobbyId(12345)).toBe(false);
    expect(redisUtils.isValidLobbyId(null)).toBe(false);
    expect(redisUtils.isValidLobbyId(undefined)).toBe(false);
  });

  test('withLobbyLock no-ops on a malformed id — NO lock key SET, mutator never runs', async () => {
    const pub = makeFakeRedis();
    jest.spyOn(pub, 'set');
    jest.spyOn(pub, 'get');
    const fn = jest.fn();
    // 40-KB junk id: the exact free-Redis-key-inflation case the guard closes.
    const result = await redisUtils.withLobbyLock(pub, 'x'.repeat(40000), fn);
    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    // The whole point: no lock SET and no GET — Redis was never touched, so no
    // attacker-controlled lock:lobbymut:<huge> key was ever created.
    expect(pub.set).not.toHaveBeenCalled();
    expect(pub.get).not.toHaveBeenCalled();
    expect(pub.store.size).toBe(0);
  });

  test('getLobby no-ops on a malformed id — NO GET issued', async () => {
    const pub = makeFakeRedis();
    jest.spyOn(pub, 'get');
    const result = await redisUtils.getLobby(pub, 'bad id with spaces');
    expect(result).toBeNull();
    expect(pub.get).not.toHaveBeenCalled();
  });

  test('a valid DAILY id (underscore in the stableId segment) still works end-to-end', async () => {
    // Regression lock for the regex WIDENING: the real daily lobby id is
    // `DAILY-<P_…>-<yyyymmdd>` (client stableId is `p_`+base36, uppercased),
    // so the chokepoint MUST admit `_`. If a future tightening drops it, this
    // breaks instead of silently bricking every daily run's lock+read.
    const pub = makeFakeRedis();
    const dailyId = 'DAILY-P_AB12CD34EF-20260609';
    await redisUtils.saveLobby(pub, dailyId, { id: dailyId, n: 0 });
    const room = await redisUtils.withLobbyLock(pub, dailyId, (r) => { r.n = 7; });
    expect(room.n).toBe(7);
    expect((await redisUtils.getLobby(pub, dailyId)).n).toBe(7);
  });
});
