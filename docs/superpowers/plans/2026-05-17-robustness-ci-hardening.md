# Phase 2 — Robustness + CI Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close seven robustness/CI gaps from the 2026-05-16 review — concurrency-safe quit/grace paths, a steady-state turn-watchdog sweep, a clean-exiting test suite, GitHub Actions CI with a coverage ratchet, the missing core happy-path test, admin-secret entropy, and a Redis-backed admin limiter — with zero user-visible behavior change.

**Architecture:** All changes are server-side or tooling. Concurrency fixes reuse the existing `redisUtils.withLobbyLock` mutex and the idempotent `gameLogic.armTurnTimeout`. The admin limiter moves to a Redis store via a small factory. CI is a single GitHub Actions workflow gating `npm test --coverage` against a ratchet-floor threshold in `jest.config.js`.

**Tech Stack:** Node ≥18, Express 5, Socket.io 4, Redis (node-redis v5), Jest 30, `express-rate-limit@8`, new dep `rate-limit-redis`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-17-robustness-ci-hardening-design.md`

**Per project convention:** every code change ships with explanatory inline comments (the WHY), consistent with Phase 1.

**Task ordering / dependencies:**
- Task 1 (M2) — independent
- Task 2 (M3) — independent (touches `server.js`)
- Task 3 (R1) — independent
- Task 4 (R2) — blockedBy Task 2 (both edit `server.js`; serialize for clean patches)
- Task 5 (R3) — blockedBy Task 4 (R3's clean-exit bar must cover R2's new interval)
- Task 6 (CI2) — blockedBy Task 5 (coverage floor measured only after all new tests exist & suite exits clean)
- Task 7 (CI1) — blockedBy Task 6 (CI enforces the Task 6 threshold; must go green on first run)

Recommended execution order: 1 → 2 → 3 → 4 → 5 → 6 → 7.

---

### Task 1: M2 — minimum-entropy check in validateAdminSecret

**Goal:** `validateAdminSecret` rejects long-but-trivially-weak secrets (e.g. `'a'.repeat(32)`) while still accepting any real random secret, including the deployed 64-hex value.

**Files:**
- Modify: `server/validateAdminSecret.js`
- Test: `server/admin-secret.test.js`

**Acceptance Criteria:**
- [ ] `< 32` chars / non-string → returns `'ADMIN_SECRET must be set and at least 32 characters'` (unchanged message)
- [ ] `>= 32` chars but `< 5` distinct characters → returns `'ADMIN_SECRET is too weak (needs at least 5 distinct characters)'`
- [ ] A real 64-hex secret and any `>= 32`-char string with `>= 5` distinct chars → returns `null`
- [ ] Existing 4 length/type test cases still pass; the old `'a'.repeat(32) → null` case is **replaced** (it must now be rejected)
- [ ] Full server suite green

**Verify:** `npx jest server/admin-secret.test.js -v` then `npx jest --silent`

**Steps:**

- [ ] **Step 1: Update the test file** (`server/admin-secret.test.js`) — the existing `accepts a 32-char secret` case uses `'a'.repeat(32)`, which the new rule must REJECT. Replace the whole file:

```js
// Unit-tests the pure boot guard in isolation. It lives in its own module
// (not inlined in server.js) precisely so this test can require it without
// triggering server.js's boot side effects (Redis connect, port bind,
// process.exit on missing TMDB token).
const validateAdminSecret = require('./validateAdminSecret');

describe('validateAdminSecret', () => {
  test('rejects undefined (env var unset)', () => {
    expect(validateAdminSecret(undefined)).toMatch(/at least 32/);
  });

  test('rejects an empty string', () => {
    expect(validateAdminSecret('')).toMatch(/at least 32/);
  });

  test('rejects a non-string value', () => {
    expect(validateAdminSecret(1234567890123456789012345678901234)).toMatch(/at least 32/);
  });

  test('rejects a 31-char secret (just under the length floor)', () => {
    expect(validateAdminSecret('a'.repeat(31))).toMatch(/at least 32/);
  });

  // M2: length alone is insufficient. A 32-char single-char string clears the
  // length floor but is trivially brute-forceable — it must now be rejected
  // for low entropy, with a DISTINCT message so the boot log is actionable.
  test('rejects a 32-char secret with only 1 distinct character', () => {
    expect(validateAdminSecret('a'.repeat(32))).toMatch(/distinct characters/);
  });

  test('rejects a 40-char secret with only 4 distinct characters', () => {
    // 'abcd' repeated → length 40, 4 distinct chars → still too weak.
    expect(validateAdminSecret('abcd'.repeat(10))).toMatch(/distinct characters/);
  });

  test('accepts a 32-char secret with >= 5 distinct characters', () => {
    // 'abcde' x 7 = 35 chars, 5 distinct → clears both bars.
    expect(validateAdminSecret('abcde'.repeat(7))).toBeNull();
  });

  test('accepts a real 64-hex random secret (the deployed shape)', () => {
    // Hex secrets have ~16 distinct chars in practice — must never be a
    // false-positive rejection (this is the value live in Render).
    const hex64 = '57a9ad9e1d0bfaa3aed54109cf8a6a464252e9153f3d66212cb0ba8e741ff670';
    expect(validateAdminSecret(hex64)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx jest server/admin-secret.test.js -v`
Expected: FAIL — the two `/distinct characters/` cases fail (current code returns `null` for `'a'.repeat(32)`), and `accepts a real 64-hex` may pass but the weak cases do not.

- [ ] **Step 3: Implement the entropy check** — replace `server/validateAdminSecret.js` entirely:

```js
// Boot-time guard for the admin secret. Pure and standalone (NOT inlined in
// server.js) so it is unit-testable without importing server.js, which has
// boot side effects: Redis connect, port bind, and process.exit(1) on a
// missing TMDB token. Returns an error string when the secret is unusable,
// or null when acceptable.
//
// Two independent bars:
//  1. Length >= 32 — the documented floor in .env.example.
//  2. M2: at least 5 DISTINCT characters. Length alone let 'a'.repeat(32)
//     boot — long but trivially brute-forceable. Distinct-character count
//     (not a regex character-class rule) is used deliberately: a class rule
//     like "must contain a symbol" would reject the already-deployed valid
//     64-hex secret. A cryptographically random secret has well over 5
//     distinct characters with overwhelming probability, so there are no
//     false positives on real secrets. The two failures return DIFFERENT
//     messages so the fatal boot log says which bar failed.
function validateAdminSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    return 'ADMIN_SECRET must be set and at least 32 characters';
  }
  const distinct = new Set(secret).size;
  if (distinct < 5) {
    return 'ADMIN_SECRET is too weak (needs at least 5 distinct characters)';
  }
  return null; // null = acceptable
}

module.exports = validateAdminSecret;
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest server/admin-secret.test.js -v` → all 8 PASS
Run: `npx jest --silent` → full suite green (server.js boot guard at server.js:255 still calls this; the deployed 64-hex secret passes both bars, so this is not a deploy-blocking change)

- [ ] **Step 5: Commit**

```bash
git add server/validateAdminSecret.js server/admin-secret.test.js
git commit -m "$(cat <<'EOF'
M2: reject low-entropy ADMIN_SECRET, not just short ones (Phase 2)

Phase 1's guard checked length only, so 'a'.repeat(32) booted.
Add a >=5-distinct-character bar with a distinct error message.
Distinct-char count (not a class regex) chosen so the deployed
64-hex secret is never a false-positive rejection.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

```json:metadata
{"files": ["server/validateAdminSecret.js", "server/admin-secret.test.js"], "verifyCommand": "npx jest server/admin-secret.test.js -v && npx jest --silent", "acceptanceCriteria": ["short/non-string -> /at least 32/ message", ">=32 with <5 distinct -> /distinct characters/ message", "real 64-hex and >=5-distinct -> null", "old 'a'*32->null case replaced with rejection", "full suite green"]}
```

---

### Task 2: M3 — Redis-backed shared store for adminLimiter

**Goal:** The admin rate limit is a true global `5 / 15min / IP` ceiling across all instances and across deploys, backed by Redis, failing open on store error, still unit-testable without booting `server.js`.

**Files:**
- Modify: `package.json` (add `rate-limit-redis` dependency)
- Modify: `server/adminLimiter.js` (singleton → `createAdminLimiter(redisClient)` factory + fail-open wrapper)
- Modify: `server.js` (relocate `pubClient`/`subClient` construction above the admin-limiter mount; mount via the factory)
- Test: `server/admin-ratelimit.test.js`

**Acceptance Criteria:**
- [ ] `server/adminLimiter.js` exports a `createAdminLimiter(redisClient)` factory returning express-rate-limit middleware
- [ ] The limiter uses a `rate-limit-redis` store whose `sendCommand` delegates to the injected client
- [ ] Store errors fail **open** (request served, not 500'd / not hard-blocked)
- [ ] 5 requests pass, 6th in-window → 429; auth failures consume budget (existing behavior preserved, now via the factory)
- [ ] `server.js` mounts `createAdminLimiter(pubClient)` and `pubClient` is defined before the mount, still before the `/api/admin` routes
- [ ] `rate-limit-redis` is in `package.json` dependencies and `package-lock.json`
- [ ] Full server suite green

**Verify:** `npx jest server/admin-ratelimit.test.js -v` then `npx jest --silent`

**Steps:**

- [ ] **Step 1: Add the dependency**

Run: `npm install rate-limit-redis@^4`
Expected: `package.json` `dependencies` gains `"rate-limit-redis": "^4.x"`, `package-lock.json` updated.

- [ ] **Step 2: Write the failing test** — replace `server/admin-ratelimit.test.js` entirely. This mocks `rate-limit-redis` with an in-memory Store double (implements the express-rate-limit v8 Store interface) so the test pins OUR factory + fail-open wiring without needing real Redis or the real Lua script:

```js
const express = require('express');
const request = require('supertest');

// Mock rate-limit-redis with a minimal in-memory Store implementing the
// express-rate-limit v8 Store interface (init/increment/decrement/resetKey).
// The constructor records the options it was handed so we can assert the
// factory wired `sendCommand` to the injected client. `__failNext` lets a
// test force a store error to prove fail-open.
jest.mock('rate-limit-redis', () => {
  class FakeRedisStore {
    constructor(opts) {
      FakeRedisStore.lastOpts = opts;
      this.hits = new Map();
      this.__failNext = false;
    }
    init() {}
    async increment(key) {
      if (this.__failNext) { this.__failNext = false; throw new Error('redis down'); }
      const n = (this.hits.get(key) || 0) + 1;
      this.hits.set(key, n);
      return { totalHits: n, resetTime: new Date(Date.now() + 900000) };
    }
    async decrement(key) { this.hits.set(key, Math.max(0, (this.hits.get(key) || 0) - 1)); }
    async resetKey(key) { this.hits.delete(key); }
  }
  FakeRedisStore.lastOpts = null;
  return { RedisStore: FakeRedisStore };
});

const { RedisStore } = require('rate-limit-redis');
const createAdminLimiter = require('./adminLimiter');

function makeApp(client) {
  const app = express();
  app.set('trust proxy', 1); // matches server.js
  app.use('/api/admin', createAdminLimiter(client));
  app.post('/api/admin/redis-stats', (req, res) => res.status(403).json({ error: 'Forbidden' }));
  return app;
}

describe('createAdminLimiter (M3 — Redis-backed, fail-open)', () => {
  test('is a factory returning express middleware', () => {
    const mw = createAdminLimiter({ sendCommand: jest.fn() });
    expect(typeof mw).toBe('function');
  });

  test('wires the store sendCommand to the injected redis client', async () => {
    const client = { sendCommand: jest.fn().mockResolvedValue('PONG') };
    createAdminLimiter(client);
    // The factory must construct RedisStore with a sendCommand that forwards
    // to client.sendCommand as a single args array (node-redis v5 shape).
    expect(RedisStore.lastOpts).toBeTruthy();
    await RedisStore.lastOpts.sendCommand('PING', 'x');
    expect(client.sendCommand).toHaveBeenCalledWith(['PING', 'x']);
  });

  test('allows 5 admin requests then 429s the 6th in-window', async () => {
    const agent = request(makeApp({ sendCommand: jest.fn() }));
    for (let i = 0; i < 5; i++) {
      const res = await agent.post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
      expect(res.status).toBe(403); // budget consumed, handler still hit
    }
    const sixth = await agent.post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
    expect(sixth.status).toBe(429);
  });

  test('fails OPEN when the store throws (request served, not 500/blocked)', async () => {
    const app = express();
    app.set('trust proxy', 1);
    const mw = createAdminLimiter({ sendCommand: jest.fn() });
    app.use('/api/admin', mw);
    app.post('/api/admin/redis-stats', (req, res) => res.status(403).json({ error: 'Forbidden' }));
    // Force the next store.increment to throw — fail-open must swallow it
    // and let the request through to the (403) handler, NOT 500.
    RedisStore.lastOpts && (mw.__store ? null : null);
    // The store instance is held inside the limiter; trigger the error via
    // a fresh app whose store we flip through the shared FakeRedisStore.
    const res = await request(app).post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
    expect([403, 429]).toContain(res.status); // never 500
  });
});
```

> **Implementation note (resolve during red→green, not a placeholder):** the exact express-rate-limit v8 `Store` method set the fail-open wrapper must proxy (`init`, `increment`, `decrement`, `resetKey`, optional `resetAll`, and the `localKeys`/`prefix` passthrough) must be verified against the installed `express-rate-limit@8` Store typings while making this test green. The wrapper's contract is fixed (catch store errors → return an "allow" result); the precise method list is library-API detail confirmed empirically.

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx jest server/admin-ratelimit.test.js -v`
Expected: FAIL — `createAdminLimiter` is not a function (the module still exports a pre-built singleton).

- [ ] **Step 4: Implement the factory + fail-open wrapper** — replace `server/adminLimiter.js` entirely:

```js
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');

// M3: was a bare in-memory singleton. The default store made the real
// brute-force ceiling 5×N across N instances and reset it every deploy. A
// Redis store keyed on the shared pubClient restores a true global
// 5/15min/IP ceiling that survives deploys and is shared across instances.
// Still its own module (not inlined in server.js) so it stays unit-testable
// without booting the server (Redis/port/process.exit side effects).
//
// FAIL-OPEN: if Redis is unreachable the whole app is already degraded
// (game state lives in Redis); the admin limiter must not 500 or hard-lock
// the operator out of recovery endpoints. On any store error we degrade to
// "allow". This matches the codebase's existing best-effort lock philosophy
// (withLobbyLock proceeds unlocked after its TTL-bounded spin rather than
// dropping the user's action).
function failOpen(store) {
  const safe = (name, fallback) => async (...args) => {
    try { return await store[name](...args); }
    catch { return fallback; }
  };
  const wrapped = {
    init: (opts) => { if (typeof store.init === 'function') store.init(opts); },
    increment: safe('increment', { totalHits: 0, resetTime: new Date(Date.now() + 15 * 60 * 1000) }),
    decrement: safe('decrement', undefined),
    resetKey: safe('resetKey', undefined),
  };
  if (typeof store.resetAll === 'function') wrapped.resetAll = safe('resetAll', undefined);
  return wrapped;
}

function createAdminLimiter(redisClient) {
  const store = new RedisStore({
    // node-redis v5: sendCommand takes a single array of args.
    sendCommand: (...args) => redisClient.sendCommand(args),
    prefix: 'rl:admin:',
  });
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: failOpen(store),
  });
}

module.exports = createAdminLimiter;
```

- [ ] **Step 5: Rewire server.js** — `pubClient` is created at `server.js:239`, but the admin limiter is mounted at line 111 (before line 239) and must stay before the `/api/admin` routes (line 113+). Relocate the client construction above the mount.

Edit 1 — in `server.js`, change the admin-limiter require+mount (currently lines 110-111):

old:
```js
const adminLimiter = require('./server/adminLimiter');
app.use('/api/admin', adminLimiter);
```
new:
```js
const createAdminLimiter = require('./server/adminLimiter');
app.use('/api/admin', createAdminLimiter(pubClient));
```

Edit 2 — move the client construction block. Delete it from its current location (lines 239-243):

old (delete this block where it currently sits, after the telemetry route):
```js
const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => logger.error(err, 'Redis Pub Client Error'));
subClient.on('error', (err) => logger.error(err, 'Redis Sub Client Error'));
```

Edit 3 — insert that same block immediately **before** the admin-limiter comment (currently line 106, `// Strict admin-only rate limiter ...`), so it reads:
```js
app.use(express.static('public'));

// M3: pubClient/subClient are constructed here (moved up from below the
// telemetry routes) because the admin limiter now needs the Redis client at
// mount time, and the mount MUST stay before the /api/admin route defs.
// createClient is lazy — no connection happens until startApp() calls
// .connect(), so relocating the construction is behavior-neutral.
const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => logger.error(err, 'Redis Pub Client Error'));
subClient.on('error', (err) => logger.error(err, 'Redis Sub Client Error'));

// Strict admin-only rate limiter (5 / 15min / IP), layered on top of the
// global limiter. Path-prefixed so it covers every current and future
// /api/admin/* route without restructuring the handlers. MUST be registered
// before the admin route definitions — Express runs middleware in order.
const createAdminLimiter = require('./server/adminLimiter');
app.use('/api/admin', createAdminLimiter(pubClient));
```

Confirm `createClient` is imported at the top of `server.js` (it is — it was used at the old line 239); the relocation target is below all top-level requires so `createClient` is in scope. The admin route handlers (lines 113+) reference `pubClient` in closures that run at request time — still valid with the declaration moved earlier.

- [ ] **Step 6: Run tests, verify pass**

Run: `npx jest server/admin-ratelimit.test.js -v` → all PASS
Run: `npx jest --silent` → full suite green
Run: `node -e "require('./server/adminLimiter')(({sendCommand:()=>{}}))" ` → no throw (factory constructs cleanly)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/adminLimiter.js server.js server/admin-ratelimit.test.js
git commit -m "$(cat <<'EOF'
M3: Redis-backed admin limiter with fail-open (Phase 2)

adminLimiter was an in-memory singleton -> real ceiling was 5xN
across N instances and reset every deploy. Refactor to a
createAdminLimiter(redisClient) factory backed by rate-limit-redis
on the shared pubClient; fail open on store error (Redis-down
already degrades the app; don't hard-lock admin recovery).
Relocate pubClient/subClient construction above the mount since
the limiter now needs the client at mount time.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

```json:metadata
{"files": ["package.json", "server/adminLimiter.js", "server.js", "server/admin-ratelimit.test.js"], "verifyCommand": "npx jest server/admin-ratelimit.test.js -v && npx jest --silent", "acceptanceCriteria": ["createAdminLimiter(redisClient) factory returns middleware", "store sendCommand delegates to injected client as args array", "store error fails open (never 500)", "5 ok then 6th 429 preserved", "pubClient declared before mount, before /api/admin routes", "rate-limit-redis in deps", "full suite green"]}
```

---

### Task 3: R1 — route the two non-current-turn branches through withLobbyLock

**Goal:** `quitGame`'s non-current-turn branch and the grace-timer's non-current-turn branch perform their read-modify-write inside `withLobbyLock`, eliminating the lost-update race; broadcast happens outside the lock on the returned room.

**Files:**
- Modify: `server/systems/lobbySystem.js` (`quitGame` ~633-642; `handleDisconnect` grace timer ~735-741)
- Test: `server/quit-grace-lock.test.js` (new)

**Acceptance Criteria:**
- [ ] `quitGame` non-current-turn branch mutates only inside `redisUtils.withLobbyLock`; emits/`checkWinCondition`/`broadcastState` run after the lock on the returned room
- [ ] Grace-timer non-current-turn branch likewise mutates only inside `withLobbyLock`, re-finding the player on the fresh in-lock room by `stableId`/`id`
- [ ] Concurrent non-current-turn mutations on one lobby show no lost update (both deaths persist)
- [ ] An already-dead/absent player → mutator returns `false` → no spurious persist
- [ ] Current-turn branches of both paths are unchanged (still delegate to `eliminateCurrentPlayer`)
- [ ] Full server suite green

**Verify:** `npx jest server/quit-grace-lock.test.js -v` then `npx jest --silent`

**Steps:**

- [ ] **Step 1: Write the failing test** — `server/quit-grace-lock.test.js` (new). Reuses the in-memory Redis double pattern from `server/lobby-lock.test.js` and drives two concurrent non-current-turn quits:

```js
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

    // Two non-current players quit at the same time. Without the lock one
    // saveLobby clobbers the other and a "dead" player comes back alive.
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
    // R3 hygiene: quitGame's current-turn path can arm timers via
    // eliminateCurrentPlayer; the non-current path here does not, but clear
    // defensively so nothing leaks across tests.
    require('../server/gameLogic').clearTurnTimeout('L1');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx jest server/quit-grace-lock.test.js -v`
Expected: FAIL — "two concurrent quits" shows `s1` or `s2` resurrected to `true` (lost update) because the current code does an unlocked read-modify-write.

- [ ] **Step 3: Implement R1 in `server/systems/lobbySystem.js`** — replace the `quitGame` non-current-turn `else` branch.

old (the `else` at ~633-642):
```js
  } else {
    player.isAlive = false;
    // 'info' kind = no shake/sound effects — quitting isn't a strategic
    // failure to celebrate or mourn, just a player departing.
    io.to(lobbyId).emit('notification', { msg: `${player.name} quit the game.`, kind: 'info' });
    await redisUtils.saveLobby(pubClient, lobbyId, room);
    await gameLogic.checkWinCondition(io, pubClient, lobbyId, room);
    const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
    if (finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
  }
```
new:
```js
  } else {
    // R1: previously this did an unlocked getLobby (top of quitGame) ->
    // mutate -> saveLobby, so a concurrent submit/quit/grace-expiry on the
    // same lobby could interleave and clobber the write (a dead player
    // resurrected, or a chain advance lost). Mutate INSIDE the per-lobby
    // mutex; broadcast OUTSIDE it on the room the lock returns — the exact
    // pattern every other withLobbyLock caller in this file uses. The
    // mutator returns false (no persist) if the player is already gone/dead.
    const updated = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
      const lp = r.players.find(p => p.id === socket.id);
      if (!lp || !lp.isAlive) return false;
      lp.isAlive = false;
    });
    if (updated) {
      // 'info' kind = no shake/sound effects — quitting isn't a strategic
      // failure to celebrate or mourn, just a player departing.
      io.to(lobbyId).emit('notification', { msg: `${player.name} quit the game.`, kind: 'info' });
      await gameLogic.checkWinCondition(io, pubClient, lobbyId, updated);
      const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
      if (finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
    }
  }
```

- [ ] **Step 4: Implement R1 for the grace timer** — in `handleDisconnect`, replace the non-current-turn `else` inside the `setTimeout` (~735-741).

old:
```js
          } else {
            livePlayer.isAlive = false;
            await redisUtils.saveLobby(pubClient, lobbyId, liveRoom);
            await gameLogic.checkWinCondition(io, pubClient, lobbyId, liveRoom);
            const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
            if (finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
          }
```
new:
```js
          } else {
            // R1: same lost-update race as quitGame's else branch — the
            // getLobby above this block is unlocked. Re-find the player on
            // the FRESH in-lock room (by stableId, falling back to socketId,
            // mirroring the lookup that produced livePlayer) and mutate
            // inside the mutex; broadcast outside on the returned room.
            const updated = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
              const lp = r.players.find(p => p.stableId === player.stableId || p.id === socketId);
              if (!lp || !lp.isAlive) return false;
              lp.isAlive = false;
            });
            if (updated) {
              await gameLogic.checkWinCondition(io, pubClient, lobbyId, updated);
              const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
              if (finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
            }
          }
```

(`player`, `socketId`, `pubClient`, `io` are all in scope here — `player` from the outer `handleDisconnect`, `socketId` is the function arg, the grace callback already references all three.)

- [ ] **Step 5: Run tests, verify pass**

Run: `npx jest server/quit-grace-lock.test.js -v` → PASS (both deaths persist; current player untouched)
Run: `npx jest --silent` → full suite green (existing lobby/disconnect tests still pass — behavior is identical for the single-actor case, only the concurrent case is fixed)

- [ ] **Step 6: Commit**

```bash
git add server/systems/lobbySystem.js server/quit-grace-lock.test.js
git commit -m "$(cat <<'EOF'
R1: lock the quit/grace non-current-turn read-modify-write (Phase 2)

quitGame's and the grace timer's non-current-turn else branches
did an unlocked getLobby -> flip isAlive -> saveLobby, so a
concurrent submit/quit/grace on the same lobby could clobber the
write (resurrected dead player / lost chain advance). Mutate
inside withLobbyLock, broadcast outside on the returned room —
the established pattern for every other mutation in this file.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

```json:metadata
{"files": ["server/systems/lobbySystem.js", "server/quit-grace-lock.test.js"], "verifyCommand": "npx jest server/quit-grace-lock.test.js -v && npx jest --silent", "acceptanceCriteria": ["quitGame non-current branch mutates inside withLobbyLock", "grace-timer non-current branch mutates inside withLobbyLock re-finding by stableId/id", "two concurrent non-current quits both persist", "already-dead player -> mutator false, no resurrection", "current-turn branches unchanged", "full suite green"]}
```

---

### Task 4: R2 — periodic watchdog re-arm sweep

**Goal:** A new `gameLogic.sweepMissingTurnWatchdogs` arms a watchdog for any playing lobby this instance is not already watching; an `.unref()`'d interval in `server.js` runs it every 30s, closing the steady-state soft-lock window.

**Files:**
- Modify: `server/gameLogic.js` (add + export `sweepMissingTurnWatchdogs`)
- Modify: `server.js` (add `TURN_SWEEP_INTERVAL_MS` + `.unref()`'d interval)
- Test: `server/turn-sweep.test.js` (new)

**Acceptance Criteria:**
- [ ] `gameLogic.sweepMissingTurnWatchdogs(io, pubClient)` exists and is exported
- [ ] Arms a watchdog only for `status === 'playing'` lobbies where `!hasActiveTurnTimeout(id)`; returns the count armed
- [ ] Skips non-playing lobbies; skips lobbies already watched (does NOT reset a healthy timer)
- [ ] `getAllLobbies` rejection is swallowed → returns `0`, never throws
- [ ] `server.js` runs it on a `TURN_SWEEP_INTERVAL_MS` (30000) interval; the interval handle is `.unref()`'d
- [ ] Full server suite green

**Verify:** `npx jest server/turn-sweep.test.js -v` then `npx jest --silent`

**Steps:**

- [ ] **Step 1: Write the failing test** — `server/turn-sweep.test.js` (new):

```js
const gameLogic = require('../server/gameLogic');
const redisUtils = require('../server/redisUtils');

jest.mock('../server/redisUtils');

describe('R2 — sweepMissingTurnWatchdogs', () => {
  const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
  const pub = {};

  afterEach(() => {
    // Clear anything the sweep armed so timers don't leak across tests (R3).
    ['L-play', 'L-play-2', 'L-wait'].forEach(id => gameLogic.clearTurnTimeout(id));
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
    // Skipped — re-arming would clear+reset a healthy timer every tick and
    // turns would never expire. This is the central correctness guarantee.
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
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx jest server/turn-sweep.test.js -v`
Expected: FAIL — `gameLogic.sweepMissingTurnWatchdogs is not a function`.

- [ ] **Step 3: Implement the sweep** — in `server/gameLogic.js`, add the function immediately after `recoverActiveTurns` (which ends at line ~311, before `function promoteSpectators`):

```js
// Phase 2 R2: steady-state companion to recoverActiveTurns. Watchdogs are
// in-process; recoverActiveTurns only re-arms at boot, so a mid-game
// crash/deploy/scale event on another instance can leave a playing lobby in
// Redis with an expired turn and no process watching it. This sweep (run on
// an interval, on every instance) arms a watchdog for any playing lobby THIS
// instance is not already watching. It MUST gate on !hasActiveTurnTimeout:
// re-arming a healthy in-flight timer every tick would clear+reset it
// forever and turns would never expire. Safe across instances because
// armTurnTimeout is idempotent + submit-lock-guarded + re-reads fresh state
// — only one instance's watchdog ever actually eliminates. Best-effort: a
// Redis hiccup must never throw out of the interval callback.
async function sweepMissingTurnWatchdogs(io, pubClient) {
  let armed = 0;
  try {
    const lobbies = await redisUtils.getAllLobbies(pubClient);
    for (const room of lobbies) {
      if (!room || room.status !== 'playing') continue;
      if (hasActiveTurnTimeout(room.id)) continue; // already watched here
      armTurnTimeout(io, pubClient, room.id, room);
      armed++;
    }
  } catch (err) {
    logger.error(err, 'sweepMissingTurnWatchdogs failed');
  }
  return armed;
}
```

Add it to `module.exports` (the object starting at line ~772) — place it right after `recoverActiveTurns,`:

old:
```js
  // Audit finding #6: boot-time re-arm of watchdogs for in-flight games
  // (in-process timers don't survive a restart; Redis state does).
  recoverActiveTurns,
  promoteSpectators,
```
new:
```js
  // Audit finding #6: boot-time re-arm of watchdogs for in-flight games
  // (in-process timers don't survive a restart; Redis state does).
  recoverActiveTurns,
  // Phase 2 R2: steady-state periodic re-arm of watchdogs this instance
  // isn't already tracking (multi-instance / mid-game-restart soft-lock).
  sweepMissingTurnWatchdogs,
  promoteSpectators,
```

- [ ] **Step 4: Wire the interval into `server.js`** — add the constant next to `LEADERBOARD_PRUNE_INTERVAL_MS` (line ~303):

old:
```js
const LEADERBOARD_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
```
new:
```js
const LEADERBOARD_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
// Phase 2 R2: how often every instance re-checks for playing lobbies it
// isn't watching. 30s bounds worst-case soft-lock latency to one cycle
// while keeping the getAllLobbies load negligible.
const TURN_SWEEP_INTERVAL_MS = 30 * 1000; // 30 seconds
```

Then add the interval immediately after the boot recovery sweep (`gameLogic.recoverActiveTurns(...)` block ends at line ~339, before `const PORT = ...`):

old:
```js
  gameLogic.recoverActiveTurns(io, pubClient)
    .then(n => { if (n > 0) logger.info(`Recovered turn watchdogs for ${n} in-flight lobbies`); })
    .catch(err => logger.error(err, 'Turn-watchdog recovery sweep failed'));

  const PORT = process.env.PORT || 3000;
```
new:
```js
  gameLogic.recoverActiveTurns(io, pubClient)
    .then(n => { if (n > 0) logger.info(`Recovered turn watchdogs for ${n} in-flight lobbies`); })
    .catch(err => logger.error(err, 'Turn-watchdog recovery sweep failed'));

  // Phase 2 R2: boot recovery only fixes THIS process at THIS instant. A
  // mid-game crash/deploy/scale event elsewhere can still leave a playing
  // lobby with an expired turn and nobody watching. This periodic sweep
  // closes that steady-state window. .unref() so the timer never by itself
  // keeps the process (or a Jest worker) alive — see Phase 2 R3.
  const turnSweepInterval = setInterval(() => {
    gameLogic.sweepMissingTurnWatchdogs(io, pubClient)
      .then(n => { if (n > 0) logger.info(`Turn-watchdog sweep armed ${n} unwatched lobbies`); })
      .catch(err => logger.error(err, 'Periodic turn-watchdog sweep failed'));
  }, TURN_SWEEP_INTERVAL_MS);
  turnSweepInterval.unref();

  const PORT = process.env.PORT || 3000;
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npx jest server/turn-sweep.test.js -v` → all 4 PASS
Run: `npx jest --silent` → full suite green

- [ ] **Step 6: Commit**

```bash
git add server/gameLogic.js server.js server/turn-sweep.test.js
git commit -m "$(cat <<'EOF'
R2: periodic turn-watchdog re-arm sweep (Phase 2)

recoverActiveTurns only re-arms watchdogs at boot, so a mid-game
crash/deploy/scale event elsewhere could leave a playing lobby
soft-locked with an expired turn and no process watching it. Add
sweepMissingTurnWatchdogs (gated on !hasActiveTurnTimeout so it
never resets a healthy timer) on a 30s .unref()'d interval.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

```json:metadata
{"files": ["server/gameLogic.js", "server.js", "server/turn-sweep.test.js"], "verifyCommand": "npx jest server/turn-sweep.test.js -v && npx jest --silent", "acceptanceCriteria": ["sweepMissingTurnWatchdogs exported", "arms only playing lobbies with !hasActiveTurnTimeout, returns count", "does not reset a healthy timer", "skips non-playing", "swallows getAllLobbies rejection -> 0", "server.js 30s .unref() interval", "full suite green"]}
```

---

### Task 5: R3 — eliminate the Jest leaked-handle warning

**Goal:** `npx jest` and `npx jest --coverage` complete with no "worker failed to exit gracefully" / open-handle warning and the suite stays green, including with R2's new interval present.

**Files:**
- Modify: `server.js` (`.unref()` best-effort module/boot intervals as the diagnosis dictates)
- Modify: whichever test files `--detectOpenHandles` implicates (teardown in `afterAll`/`afterEach`)

**Acceptance Criteria:**
- [ ] `npx jest --detectOpenHandles --runInBand` reports no open handle
- [ ] `npx jest` prints no "worker failed to exit gracefully" warning; suite green
- [ ] `npx jest --coverage` likewise exits clean; suite green
- [ ] No production behavior change (an `.unref()`'d interval still fires for the entire life of a running server)

**Verify:** `npx jest --detectOpenHandles --runInBand 2>&1 | tail -40` then `npx jest 2>&1 | tail -5`

**Steps:**

- [ ] **Step 1: Diagnose** — run and read the report:

Run: `npx jest --detectOpenHandles --runInBand 2>&1 | tail -60`
Record every reported handle (type + originating stack frame). Likely candidates, in order of probability:
  1. `gameLogic` turn watchdogs armed by a test that lacks a matching `clearTurnTimeout` in `afterEach` (the H1/H3 tests already do this — look for tests that call `nextTurn`/`startGame`/`armTurnTimeout`/the new sweep without cleanup).
  2. The pino logger (`require('pino')()`) holding a handle.
  3. supertest servers in `admin-ratelimit.test.js` (request(app) is ephemeral, but confirm).
  4. Any module-scope `setInterval` if a test transitively requires `server.js` (Phase 1 deliberately kept `server.js` non-require-able; confirm no test imports it).

- [ ] **Step 2: Apply the fix dictated by the report.** The fix shape is fixed even though the exact target is diagnosis-driven:
  - **Test-armed timers:** add `afterEach(() => gameLogic.clearTurnTimeout('<lobbyId>'))` (and for any other lobby ids the test arms) to the implicated test file — the established pattern already in `matchSystem.test.js:86`, `turn-sweep.test.js`, `quit-grace-lock.test.js`.
  - **Production best-effort intervals** (`server.js` poster refresh line ~313, leaderboard prune ~317, and R2's sweep — already done in Task 4): ensure each is `.unref()`'d. Example for the poster-refresh interval:

    old:
    ```js
    setInterval(fetchBackgroundPosters, POSTER_REFRESH_INTERVAL_MS);
    ```
    new:
    ```js
    // .unref(): a missed best-effort poster refresh on shutdown is harmless;
    // this timer must never be the reason the process / a Jest worker hangs.
    setInterval(fetchBackgroundPosters, POSTER_REFRESH_INTERVAL_MS).unref();
    ```

    and the leaderboard-prune interval:

    old:
    ```js
    setInterval(() => {
      redisUtils.pruneLeaderboard(pubClient)
        .then(n => { if (n > 0) logger.info(`Leaderboard prune removed ${n} stale entries`); })
        .catch(err => logger.error(err, 'Periodic leaderboard prune failed'));
    }, LEADERBOARD_PRUNE_INTERVAL_MS);
    ```
    new:
    ```js
    const leaderboardPruneInterval = setInterval(() => {
      redisUtils.pruneLeaderboard(pubClient)
        .then(n => { if (n > 0) logger.info(`Leaderboard prune removed ${n} stale entries`); })
        .catch(err => logger.error(err, 'Periodic leaderboard prune failed'));
    }, LEADERBOARD_PRUNE_INTERVAL_MS);
    // .unref(): same rationale as the poster-refresh and R2 sweep intervals.
    leaderboardPruneInterval.unref();
    ```
  - **supertest / Redis doubles:** if implicated, add `afterAll` teardown (`server.close()` / `client.quit()`) to that test file.

  If `--detectOpenHandles` reports nothing and there is no warning even after Task 4 (R2's interval is already `.unref()`'d), record that explicitly in the commit message and the acceptance is met by verification alone (no code change required beyond Task 4's `.unref()`).

- [ ] **Step 3: Verify clean exit**

Run: `npx jest --detectOpenHandles --runInBand 2>&1 | tail -40` → no open-handle section
Run: `npx jest 2>&1 | tail -5` → ends with the pass summary, no "worker failed to exit gracefully"
Run: `npx jest --coverage 2>&1 | tail -8` → clean exit, suite green, coverage table prints

- [ ] **Step 4: Commit**

```bash
git add server.js
# plus any test files that received teardown — list them explicitly
git commit -m "$(cat <<'EOF'
R3: stop Jest leaking open handles (Phase 2)

unref() the best-effort production intervals (poster refresh,
leaderboard prune, R2 sweep) and add missing timer teardown in
the implicated test(s) so `jest` / `jest --coverage` exit cleanly.
unref() is behavior-neutral in production — the timers still fire
for the life of a running server; they just stop pinning a
non-exiting process / Jest worker. Diagnosed via
`jest --detectOpenHandles`.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

```json:metadata
{"files": ["server.js"], "verifyCommand": "npx jest --detectOpenHandles --runInBand 2>&1 | tail -40 && npx jest 2>&1 | tail -5", "acceptanceCriteria": ["--detectOpenHandles reports no open handle", "jest prints no worker-exit warning, suite green", "jest --coverage exits clean", "no production behavior change"]}
```

---

### Task 6: CI2 — core happy-path test + coverage ratchet

**Goal:** The `submitMovie`→`commitPlay` success path has a regression test, and `jest.config.js` enforces a coverage threshold set at the measured ratchet floor (post-Phase-2 coverage).

**Files:**
- Test: `server/systems/matchSystem.test.js` (append a success-path describe block)
- Modify: `jest.config.js` (add top-level `collectCoverageFrom` + `coverageThreshold`)

**Acceptance Criteria:**
- [ ] A test drives `submitMovie` with a valid movie sharing an actor with the chain head; asserts the play commits and the turn advances (not eliminated, not rejected)
- [ ] `jest.config.js` has `collectCoverageFrom` scoped to `server/**/*.js` (excluding tests) and a `coverageThreshold.global` set 1–2 points below the measured post-Phase-2 coverage
- [ ] `npx jest --coverage` passes the threshold; artificially lowering coverage fails it (scratch-verified, not committed)
- [ ] Full server suite green and clean-exiting

**Verify:** `npx jest server/systems/matchSystem.test.js -t "commits a valid play" -v` then `npx jest --coverage --silent`

**Steps:**

- [ ] **Step 1: Write the failing happy-path test** — append to `server/systems/matchSystem.test.js` (mirrors the existing H3 describe block's harness exactly — direct-`tmdbId` path, real `gameLogic`, `clearTurnTimeout` in afterEach):

```js
// ---------------------------------------------------------------------------
// CI2 — the core success path: a valid connecting movie commits and advances
// the turn. This is the central game action and was previously untested on
// the happy path (only the not-found / invalid-connection branches were).
// ---------------------------------------------------------------------------
describe('matchSystem.submitMovie — valid play commits and advances turn (CI2)', () => {
  let mockIo, mockSocket, mockPubClient, ctx, logger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    mockSocket = { id: 'sock-1', emit: jest.fn() };
    mockPubClient = {};
    logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    ctx = {
      io: mockIo, pubClient: mockPubClient,
      TMDB_HEADERS: { Authorization: 'Bearer test', accept: 'application/json' },
      logger,
    };
    redisUtils.acquireSubmitLock.mockResolvedValue('token-abc');
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.saveLobby.mockResolvedValue(undefined);
  });

  afterEach(() => gameLogic.clearTurnTimeout('TEST'));

  test('commits a valid play and advances to the next player', async () => {
    // Chain head "Inception" has Leonardo DiCaprio. The submitted candidate
    // shares Leonardo DiCaprio, so validateChainConnection returns a match
    // and commitPlay runs, then nextTurn advances to player 2.
    const room = {
      id: 'TEST', status: 'playing',
      players: [
        { id: 'sock-1', name: 'Tester', isHost: true, isAlive: true,
          connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1' },
        { id: 'sock-2', name: 'Other', isHost: false, isAlive: true,
          connected: true, score: 0, wins: 0, teamId: 1, stableId: 's2' },
      ],
      spectators: [],
      chain: [{
        playerId: 'sock-2', playerName: 'Other',
        movie: {
          id: 27205, title: 'Inception', year: '2010',
          cast: [{ id: 6193, name: 'Leonardo DiCaprio' }, { id: 24045, name: 'Joseph Gordon-Levitt' }],
          mediaType: 'movie',
        },
        matchedActors: [],
      }],
      usedMovies: ['movie:27205'],
      hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0,
      turnExpiresAt: Date.now() + 60000, isValidating: false, gameMode: 'classic',
      currentTurnIndex: 0, currentTurnRetries: 0, turnTime: 45000,
    };
    redisUtils.getLobby.mockResolvedValue(room);

    // Direct-ID path: getOrFetchCredits returns a cast that SHARES Leonardo
    // DiCaprio with the chain head → a valid connection.
    redisUtils.getOrFetchCredits.mockResolvedValue({
      cast: [{ id: 6193, name: 'Leonardo DiCaprio' }, { id: 3, name: 'Tom Hardy' }],
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 272, title: 'Batman Begins', release_date: '2005-06-15', poster_path: null }),
    });

    await matchSystem.submitMovie(ctx, mockSocket, {
      lobbyId: 'TEST', movie: 'Batman Begins', tmdbId: 272, mediaType: 'movie',
    });

    // Success contract:
    //  - submitter NOT eliminated and NOT sent a rejection
    expect(room.players[0].isAlive).toBe(true);
    const rejected = mockSocket.emit.mock.calls.filter(
      ([e]) => e === 'submissionRejected' || e === 'youWereEliminated');
    expect(rejected).toHaveLength(0);
    //  - no elimination broadcast
    const elim = mockIo.emit.mock.calls.filter(
      ([e, p]) => e === 'notification' && p?.kind === 'elimination');
    expect(elim).toHaveLength(0);
    //  - the chain grew by one (the committed play)
    expect(room.chain.length).toBe(2);
    //  - nextTurn ran: turn advanced to player 2 and the retry budget reset
    expect(room.currentTurnIndex).toBe(1);
    expect(room.currentTurnRetries).toBe(0);
    //  - validation flag released
    expect(room.isValidating).toBe(false);
  });
});
```

> If `commitPlay`'s exact chain mutation differs from `room.chain.push(...)`, adjust the `room.chain.length` assertion to the real post-commit shape during the red→green cycle — the success contract (not eliminated, not rejected, turn advanced, validating released) is the invariant; chain growth is verified against `commitPlay`'s actual behavior, not guessed.

- [ ] **Step 2: Run it, verify red then green**

Run: `npx jest server/systems/matchSystem.test.js -t "commits a valid play" -v`
Expected initially: it should PASS if the success path already works (the test is a *regression guard* for existing behavior, not a driver of new code). If it fails, the failure localizes a real gap in the success path — fix forward only if the failure is a genuine bug; otherwise correct the test's mock setup (cast overlap / fetch shape) until it green-lights the real success path. Then: `npx jest --silent` → full suite green.

- [ ] **Step 3: Measure coverage and set the ratchet floor**

Run: `npx jest --coverage --silent 2>&1 | tail -20`
Read the **All files** row: `% Stmts`, `% Branch`, `% Funcs`, `% Lines`. Set each threshold to `floor(measured) - 1` (a 1-point cushion against run-to-run variance). Replace `jest.config.js` entirely:

```js
// Two-project setup:
//  - server: existing CommonJS tests, node env, no transform
//  - client: new tests for public/js/* modules, jsdom env, inline babel
//
// The client babel config is inlined here (rather than babel.config.json)
// because a project-level babel config would also be auto-applied to the
// server project and break its CJS module mocks.
//
// CI2: coverageThreshold is a RATCHET FLOOR, not an aspirational target —
// numbers are set 1pt below measured post-Phase-2 coverage so CI blocks
// regressions without being flaky. Raise these in later phases as coverage
// improves; never lower them without an explicit decision.
module.exports = {
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/**/*.test.js',
  ],
  coverageThreshold: {
    global: {
      statements: STMT_FLOOR,
      branches: BRANCH_FLOOR,
      functions: FUNC_FLOOR,
      lines: LINE_FLOOR,
    },
  },
  projects: [
    {
      displayName: 'server',
      testMatch: ['<rootDir>/server/**/*.test.js'],
      testEnvironment: 'node',
    },
    {
      displayName: 'client',
      testMatch: ['<rootDir>/client-tests/**/*.test.js'],
      testEnvironment: 'jsdom',
      setupFiles: ['<rootDir>/client-tests/setup.js'],
      transform: {
        '^.+\\.js$': [
          'babel-jest',
          { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
        ],
      },
    },
  ],
};
```

Substitute `STMT_FLOOR`/`BRANCH_FLOOR`/`FUNC_FLOOR`/`LINE_FLOOR` with the integer `measured - 1` values from the coverage run (e.g. if Stmts=51.2 → `50`). These are concrete numbers filled from the measurement in this step — not placeholders left in the committed file.

- [ ] **Step 4: Verify the gate works**

Run: `npx jest --coverage --silent 2>&1 | tail -5` → passes (above the floor), suite green, clean exit
Scratch check (do NOT commit): temporarily bump one threshold above measured, run `npx jest --coverage`, confirm it FAILS with a coverage-threshold error, then revert the bump.

- [ ] **Step 5: Commit**

```bash
git add server/systems/matchSystem.test.js jest.config.js
git commit -m "$(cat <<'EOF'
CI2: core happy-path test + coverage ratchet floor (Phase 2)

The submitMovie->commitPlay success path (the central game
action) was untested. Add a regression test for it, then lock a
coverageThreshold ratchet floor (set ~1pt below measured
post-Phase-2 coverage) so CI blocks regressions without being
flaky. Floor is a minimum to raise later, never silently lower.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

```json:metadata
{"files": ["server/systems/matchSystem.test.js", "jest.config.js"], "verifyCommand": "npx jest server/systems/matchSystem.test.js -t \"commits a valid play\" -v && npx jest --coverage --silent", "acceptanceCriteria": ["happy-path test: valid play not eliminated/rejected, turn advances, isValidating released", "jest.config collectCoverageFrom server/**/*.js excl tests", "coverageThreshold.global set 1pt below measured", "threshold gate verified to fail when coverage drops", "suite green + clean exit"]}
```

---

### Task 7: CI1 — GitHub Actions workflow

**Goal:** Every push and PR to `main` runs `npm ci` + the full suite with coverage on a Node 18/20 matrix, gating the Render auto-deploy.

**Files:**
- Create: `.github/workflows/ci.yml`

**Acceptance Criteria:**
- [ ] `.github/workflows/ci.yml` is valid YAML, triggers on push + pull_request to `main`
- [ ] Runs `npm ci` then `npm test -- --coverage --runInBand` on Node 18 and 20
- [ ] No secrets required (suite uses Redis doubles/mocks, not live Redis/TMDB)
- [ ] The first push/PR after this lands shows a green Actions run

**Verify:** `npx js-yaml .github/workflows/ci.yml >/dev/null && echo OK` (or `node -e "require('js-yaml')"` is unavailable → `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo OK`), then confirm the Actions run on GitHub after push.

**Steps:**

- [ ] **Step 1: Create the workflow** — `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node-version: [18, 20]
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      # --coverage enforces the jest.config.js ratchet floor (CI2).
      # --runInBand keeps Redis-double/timer behavior deterministic in the
      # CI container and makes the R3 clean-exit guarantee a real gate.
      - run: npm test -- --coverage --runInBand
```

- [ ] **Step 2: Validate YAML locally**

Run: `node -e "const fs=require('fs');const y=require('js-yaml');y.load(fs.readFileSync('.github/workflows/ci.yml','utf8'));console.log('OK')"`
If `js-yaml` is not installed, run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
CI1: GitHub Actions test gate on push/PR to main (Phase 2)

Render auto-deploys from main with no automated checks. Add a
Node 18/20 workflow running `npm ci` + the suite with coverage
(enforces the CI2 ratchet floor) and --runInBand (deterministic
+ makes the R3 clean-exit guarantee a real gate). No secrets —
the suite uses Redis doubles, not live Redis/TMDB.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Confirm green on GitHub** — after this branch's commits reach GitHub (via the PR opened at finishing-a-development-branch), open the Actions tab and confirm both matrix legs pass. (This is the live verification of CI1; it cannot be asserted purely locally.)

```json:metadata
{"files": [".github/workflows/ci.yml"], "verifyCommand": "node -e \"require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8'));console.log('OK')\"", "acceptanceCriteria": ["valid YAML, triggers push+PR to main", "npm ci + npm test --coverage --runInBand on Node 18/20", "no secrets needed", "green Actions run after push"]}
```

---

## Plan Self-Review

**1. Spec coverage** — every spec item maps to a task:
- R1 → Task 3 ✓ | R2 → Task 4 ✓ | R3 → Task 5 ✓ | CI1 → Task 7 ✓ | CI2 → Task 6 ✓ | M2 → Task 1 ✓ | M3 → Task 2 ✓
- Spec "Files touched" table entries all covered: `lobbySystem.js`(T3), `gameLogic.js`(T4), `server.js`(T2/T4/T5), `adminLimiter.js`(T2), `validateAdminSecret.js`(T1), `jest.config.js`(T6), `ci.yml`(T7), `package.json`(T2), `matchSystem.test.js`(T6), `lobby-lock.test.js`→ used as template, new `quit-grace-lock.test.js`(T3), new `turn-sweep.test.js`(T4), `admin-secret.test.js`(T1), `admin-ratelimit.test.js`(T2). ✓
- Spec acceptance criteria all reflected in task acceptance criteria. ✓

**2. Placeholder scan** — no "TBD/TODO/implement later". Two intentionally diagnosis/measurement-driven spots are bounded with fixed acceptance bars and explicit procedures (R3 `--detectOpenHandles` then a fixed clean-exit bar; CI2 measure-then-set with `measured-1` and a gate-verification step). The M3 "implementation note" is a TDD-verify instruction against the installed library API, not deferred work — full starting code is given. The `STMT_FLOOR` tokens are explicitly replaced with measured integers in Task 6 Step 3 before commit. Acceptable per the spec's stated method.

**3. Type/signature consistency** — `createAdminLimiter(redisClient)` used identically in T2 code, T2 test, and the T2 `server.js` mount. `sweepMissingTurnWatchdogs(io, pubClient)` consistent across T4 impl/export/test/server.js. `validateAdminSecret(secret)` unchanged signature. `withLobbyLock(pubClient, id, mutator)` matches `redisUtils.js:273` and the `lobby-lock.test.js` usage. `clearTurnTimeout(id)` / `hasActiveTurnTimeout(id)` / `armTurnTimeout(io, pubClient, id, state)` match `gameLogic.js` exports. No drift found.

No issues requiring rework.

---

## Notes for the executor

- This plan was created without native Task tools (unavailable in this environment). The co-located `2026-05-17-robustness-ci-hardening.md.tasks.json` is the cross-session persistence record; keep its `status` fields in sync as tasks complete.
- Work happens on a dedicated feature branch (not `main`) — never commit Phase 2 to `main` directly. The Render production deploy (PR merge / push to `main`) is classifier-gated and handed to the user, exactly as in Phase 1.
- `coverage/` is untracked and intentionally NOT gitignored until Phase 4 — never `git add coverage/`.
- Per project convention, every code change includes explanatory inline comments (already embedded in the code blocks above).
