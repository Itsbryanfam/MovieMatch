# Phase 1 — Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed live-site `stableId` leak and harden the admin endpoints, server-side only, with no client change and no Redis migration.

**Architecture:** Three independent, TDD'd changes. (1) Drop `stableId` from the daily-leaderboard payload at its single source. (2) A standalone `validateAdminSecret` module wired into a fatal boot check. (3) A standalone `adminLimiter` module mounted by path prefix ahead of the admin routes.

**Tech Stack:** Node.js, Express 5, `express-rate-limit` (already a dependency), Jest + `supertest` (already a devDependency).

**Spec:** `docs/superpowers/specs/2026-05-16-security-hardening-design.md`

---

## Deviations from spec (with rationale)

The spec described `validateAdminSecret` and `adminLimiter` as living "in `server.js`". This plan extracts each into a tiny dedicated module (`server/validateAdminSecret.js`, `server/adminLimiter.js`) that `server.js` requires. **Reason:** `server.js` calls `startApp()` on load — it connects Redis, binds a port, and `process.exit(1)`s on a missing TMDB token. It cannot be `require()`d from a Jest test without those side effects, so the spec's stated goal ("Phase 1 ships with its own unit/integration tests") is unachievable with the logic inlined. The modules are ~6–10 lines each, behavior-identical to the inline version, and strictly less risky than the Router refactor the spec explicitly rejected. This is a HOW refinement, not a scope change. The spec's Files-touched table has a note pointing here.

## File structure

| File | Responsibility |
|---|---|
| `server/systems/dailySystem.js` (modify) | `getDailyLeaderboard` stops placing `stableId` on returned rows |
| `server/validateAdminSecret.js` (create) | Pure boot guard: returns error string or null for a given secret |
| `server/adminLimiter.js` (create) | Configured strict `express-rate-limit` middleware for `/api/admin` |
| `server.js` (modify) | Require + wire both modules (fatal check; path-prefixed limiter) |
| `.env.example` (modify) | Document `ADMIN_SECRET` (required, 32-char min) |
| `server/systems/dailySystem.test.js` (modify) | Regression: leaderboard payload has no `stableId` |
| `server/admin-secret.test.js` (create) | Unit tests for `validateAdminSecret` |
| `server/admin-ratelimit.test.js` (create) | Integration test: 6th admin hit → 429 |

---

### Task 1: Stop leaking stableId from the daily leaderboard

**Goal:** `getDailyLeaderboard` returns only `{ chainLength, name }` per row; `stableId` never reaches any client.

**Files:**
- Modify: `server/systems/dailySystem.js` (the `return entries.map(...)` in `getDailyLeaderboard`, ~lines 258-262)
- Test: `server/systems/dailySystem.test.js` (append a new `describe` block)

**Acceptance Criteria:**
- [ ] Every row returned by `getDailyLeaderboard` has exactly `chainLength` and `name`, and `'stableId' in row === false`
- [ ] Names are still correctly joined from attempt records; ordering (by score, desc) unchanged
- [ ] Full existing suite still green (182 baseline + the new test)

**Verify:** `npx jest server/systems/dailySystem.test.js -t "getDailyLeaderboard"` → PASS; then `npx jest --silent` → all suites PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — append to `server/systems/dailySystem.test.js`:

```js
describe('dailySystem.getDailyLeaderboard', () => {
  test('returns name + chainLength only — never echoes stableId to clients', async () => {
    // stableId is the system's sole bearer credential (gates requestMyStats
    // and daily-lobby rejoin). It is the ZSET member used internally to join
    // to attempt records, but it must never appear in the client-bound row.
    const mockPubClient = {
      zRangeWithScores: jest.fn().mockResolvedValue([
        { value: 'p_alice', score: 12 },
        { value: 'p_bob', score: 7 },
      ]),
      // Key-addressed mock (order-independent) matching the real attempt-key
      // format asserted elsewhere in this file ('daily:attempt:<date>:<id>').
      get: jest.fn((key) => {
        if (key === 'daily:attempt:2026-05-04:p_alice') return Promise.resolve(JSON.stringify({ name: 'Alice', status: 'done', chainLength: 12 }));
        if (key === 'daily:attempt:2026-05-04:p_bob') return Promise.resolve(JSON.stringify({ name: 'Bob', status: 'done', chainLength: 7 }));
        return Promise.resolve(null);
      }),
    };

    const lb = await dailySystem.getDailyLeaderboard(mockPubClient, '2026-05-04', 20);

    expect(lb).toEqual([
      { chainLength: 12, name: 'Alice' },
      { chainLength: 7, name: 'Bob' },
    ]);
    lb.forEach((row) => {
      expect('stableId' in row).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest server/systems/dailySystem.test.js -t "never echoes stableId"`
Expected: FAIL — received rows include a `stableId` key, so the `toEqual` and the `'stableId' in row` assertion fail.

- [ ] **Step 3: Make the change** — in `server/systems/dailySystem.js`, the current `getDailyLeaderboard` return is:

```js
    return entries.map((e, i) => ({
      stableId: e.value,
      chainLength: Math.floor(e.score),
      name: (records[i] && records[i].name) || 'Anonymous',
    }));
```

Replace that return statement with:

```js
    // SECURITY (Phase 1): stableId is the only bearer credential in the
    // system — it gates requestMyStats and daily-lobby rejoin auth. e.value
    // is still used INTERNALLY above (entries.map(e => getDailyAttempt(...,
    // e.value, ...))) to join each ZSET member to its attempt record, but it
    // must never cross the wire. Echoing it here let any client call
    // requestDailyLeaderboard and harvest every top-N player's secret. Rank
    // is positional (client derives it from array index), so return only
    // the display fields.
    return entries.map((e, i) => ({
      chainLength: Math.floor(e.score),
      name: (records[i] && records[i].name) || 'Anonymous',
    }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest server/systems/dailySystem.test.js -t "never echoes stableId"`
Expected: PASS

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npx jest --silent`
Expected: all suites PASS (existing 182 + 1 new). If any daily/integration test asserted on `stableId` in a leaderboard row, it surfaces here — none do (verified: the only leaderboard-row consumers are the two emit sites and the client renderer, which reads `name`/`chainLength` only).

- [ ] **Step 6: Commit**

```bash
git add server/systems/dailySystem.js server/systems/dailySystem.test.js
git commit -m "$(cat <<'EOF'
Stop echoing stableId in daily leaderboard payload (Phase 1)

stableId is the system's only bearer credential (gates requestMyStats
and daily-lobby rejoin). getDailyLeaderboard echoed it to any client
calling requestDailyLeaderboard, letting an attacker harvest every
top-N player's secret. Return name + chainLength only; rank is
positional client-side. No client change, no Redis migration.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Fail-fast on missing/weak ADMIN_SECRET

**Goal:** A missing or <32-char `ADMIN_SECRET` refuses to boot with a fatal log; the rule is unit-tested and documented in `.env.example`.

**Files:**
- Create: `server/validateAdminSecret.js`
- Create: `server/admin-secret.test.js`
- Modify: `server.js` (require the module + add the fatal check next to the TMDB check, after line 242)
- Modify: `.env.example` (append the documented `ADMIN_SECRET` line)

**Acceptance Criteria:**
- [ ] `validateAdminSecret` returns an error string for: `undefined`, `''`, a non-string, and a 31-char string; returns `null` for a 32-char string
- [ ] `server.js` calls `logger.fatal` + `process.exit(1)` when the check fails, mirroring the TMDB guard
- [ ] `.env.example` documents `ADMIN_SECRET` as required, 32-char minimum
- [ ] Full suite green

**Verify:** `npx jest server/admin-secret.test.js -v` → PASS; then `npx jest --silent` → all PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — create `server/admin-secret.test.js`:

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

  test('rejects a 31-char secret (just under the floor)', () => {
    expect(validateAdminSecret('a'.repeat(31))).toMatch(/at least 32/);
  });

  test('accepts a 32-char secret', () => {
    expect(validateAdminSecret('a'.repeat(32))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest server/admin-secret.test.js`
Expected: FAIL — `Cannot find module './validateAdminSecret'`.

- [ ] **Step 3: Create the module** — create `server/validateAdminSecret.js`:

```js
// Boot-time guard for the admin secret. Pure and standalone (NOT inlined in
// server.js) so it is unit-testable without importing server.js, which has
// boot side effects: Redis connect, port bind, and process.exit(1) on a
// missing TMDB token. Returns an error string when the secret is unusable,
// or null when acceptable. 32-char minimum is the documented floor in
// .env.example — shorter secrets are brute-forceable even behind the
// dedicated admin rate limiter.
function validateAdminSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    return 'ADMIN_SECRET must be set and at least 32 characters';
  }
  return null; // null = acceptable
}

module.exports = validateAdminSecret;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest server/admin-secret.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the fatal check into `server.js`** — the current TMDB guard reads:

```js
const TMDB_TOKEN = process.env.TMDB_READ_TOKEN;
if (!TMDB_TOKEN) {
  logger.fatal('TMDB_READ_TOKEN environment variable is required. Set it in your .env file.');
  process.exit(1);
}
const TMDB_HEADERS = { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' };
```

Immediately AFTER the closing `}` of the TMDB `if` block and before the `const TMDB_HEADERS = ...` line, insert:

```js
// ADMIN_SECRET fail-fast — parity with the TMDB guard above. safeEqual
// already fails closed when the secret is missing, but a missing/weak
// secret should refuse to boot LOUDLY rather than silently shipping
// unreachable (or brute-forceable) destructive admin endpoints.
const validateAdminSecret = require('./server/validateAdminSecret');
const adminSecretErr = validateAdminSecret(process.env.ADMIN_SECRET);
if (adminSecretErr) {
  logger.fatal(adminSecretErr + '. Set it in your .env file.');
  process.exit(1);
}
```

- [ ] **Step 6: Document it in `.env.example`** — the file currently is:

```
TMDB_READ_TOKEN=your_tmdb_read_token_here
REDIS_URL=redis://127.0.0.1:6379
FRONTEND_URL=http://localhost:3000
```

Replace the entire file contents with:

```
TMDB_READ_TOKEN=your_tmdb_read_token_here
REDIS_URL=redis://127.0.0.1:6379
FRONTEND_URL=http://localhost:3000
# Required. Minimum 32 characters. Gates all /api/admin/* endpoints; the
# server refuses to boot if this is missing or shorter than 32 characters.
ADMIN_SECRET=replace_with_a_long_random_string_at_least_32_chars
```

- [ ] **Step 7: Run the full suite**

Run: `npx jest --silent`
Expected: all suites PASS (no test imports `server.js`, so the new boot check does not affect the suite).

- [ ] **Step 8: Commit**

```bash
git add server/validateAdminSecret.js server/admin-secret.test.js server.js .env.example
git commit -m "$(cat <<'EOF'
Fail-fast on missing/weak ADMIN_SECRET (Phase 1)

A missing or <32-char ADMIN_SECRET previously deployed silently
(endpoints fail closed but no loud signal) and is brute-forceable if
short. Add a unit-tested pure guard wired into a fatal boot check,
mirroring the TMDB token guard, and document the requirement in
.env.example. Extracted to its own module so it is testable without
server.js boot side effects.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Dedicated admin rate limiter

**Goal:** `/api/admin/*` is protected by a strict per-IP limiter (5 / 15 min) independent of the global limiter; a 6th in-window request returns 429.

**Files:**
- Create: `server/adminLimiter.js`
- Create: `server/admin-ratelimit.test.js`
- Modify: `server.js` (require the module + `app.use('/api/admin', adminLimiter)` between `app.use(express.static('public'));` at line 104 and the first admin route `app.post('/api/admin/flush-credits', ...)` at line 106)

**Acceptance Criteria:**
- [ ] 5 sequential requests to a stubbed `/api/admin/*` route succeed (return their normal status); the 6th in the same window returns `429`
- [ ] Auth-failing requests still consume the budget (the brute-force ceiling)
- [ ] `server.js` registers the limiter by path prefix BEFORE any admin route
- [ ] Full suite green

**Verify:** `npx jest server/admin-ratelimit.test.js -v` → PASS; then `npx jest --silent` → all PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — create `server/admin-ratelimit.test.js`:

```js
const express = require('express');
const request = require('supertest');
// Require the REAL exported limiter and wire it exactly like server.js does,
// so this test guards the actual configured behavior without booting
// server.js (which has Redis/port/process.exit side effects).
const adminLimiter = require('./adminLimiter');

function makeApp() {
  const app = express();
  app.set('trust proxy', 1); // matches server.js:61
  app.use('/api/admin', adminLimiter);
  // Stub admin route that 403s like the real handlers do on bad auth, so
  // the test also proves auth FAILURES consume the limiter budget — that is
  // the intended brute-force ceiling on ADMIN_SECRET.
  app.post('/api/admin/redis-stats', (req, res) => res.status(403).json({ error: 'Forbidden' }));
  return app;
}

describe('adminLimiter', () => {
  test('allows 5 admin requests then 429s the 6th in-window', async () => {
    const agent = request(makeApp());
    for (let i = 0; i < 5; i++) {
      const res = await agent.post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
      // Budget consumed but not yet limited — still hits the (403) handler.
      expect(res.status).toBe(403);
    }
    const sixth = await agent.post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
    expect(sixth.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest server/admin-ratelimit.test.js`
Expected: FAIL — `Cannot find module './adminLimiter'`.

- [ ] **Step 3: Create the module** — create `server/adminLimiter.js`:

```js
const rateLimit = require('express-rate-limit');

// Strict limiter for /api/admin/*, separate from and stricter than the
// global 120/min limiter in server.js. Admin auth FAILURES count toward
// this budget on purpose — that is the brute-force ceiling on ADMIN_SECRET.
// 5 requests / 15 min / IP is generous for legitimate human admin use
// (flush-credits / prune-leaderboard are rare manual actions). trust proxy
// is set in server.js so req.ip is the real client IP behind the PaaS
// proxy. Exported as its own module so the behavior is unit-testable
// without booting server.js (Redis/port/process.exit side effects).
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = adminLimiter;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest server/admin-ratelimit.test.js`
Expected: PASS — 5×403 then 429.

- [ ] **Step 5: Wire into `server.js`** — the current sequence is:

```js
app.use(express.static('public'));

app.post('/api/admin/flush-credits', async (req, res) => {
```

Insert between those two lines (after `app.use(express.static('public'));`, before `app.post('/api/admin/flush-credits'`):

```js

// Strict admin-only rate limiter (5 / 15min / IP), layered on top of the
// global limiter. Path-prefixed so it covers every current and future
// /api/admin/* route without restructuring the handlers. MUST be registered
// before the admin route definitions — Express runs middleware in order.
const adminLimiter = require('./server/adminLimiter');
app.use('/api/admin', adminLimiter);
```

- [ ] **Step 6: Run the full suite**

Run: `npx jest --silent`
Expected: all suites PASS (existing 182 + Task 1 + Task 2 + Task 3 tests).

- [ ] **Step 7: Commit**

```bash
git add server/adminLimiter.js server/admin-ratelimit.test.js server.js
git commit -m "$(cat <<'EOF'
Add dedicated strict admin rate limiter (Phase 1)

/api/admin/* relied only on the global 120/min limiter — too loose to
resist brute-forcing the admin secret on destructive endpoints
(flush-credits, prune-leaderboard). Add a path-prefixed 5/15min/IP
limiter registered ahead of the admin routes. Auth failures count
toward the budget on purpose. Own module so behavior is unit-testable
without server.js boot side effects.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Post-implementation

- [ ] **Manual boot check (documented, not automated — `process.exit` is impractical to unit test):**
  - `ADMIN_SECRET= npm start` (unset) → server logs fatal and exits non-zero.
  - `ADMIN_SECRET=short npm start` → same.
  - `ADMIN_SECRET=<32+ char value> npm start` → boots normally.
- [ ] **Operational note for the live deploy:** `moviematch.it.com` must have a ≥32-char `ADMIN_SECRET` set in its environment BEFORE this ships, or the next deploy will refuse to boot. This is the intended fail-loud behavior. Flag this in the Phase 1 completion summary.
- [ ] Phase 1 done. Phases 2–5 (robustness+CI, refactor, content/polish, growth) are separate spec → plan → build cycles.

## Self-review (completed by plan author)

- **Spec coverage:** Change 1 → Task 1. Change 2 → Task 2 (+ `.env.example`). Change 3 → Task 3. All three test-plan items mapped (dailySystem payload test = Task 1 Step 1; `validateAdminSecret` unit test = Task 2; admin limiter 429 test = Task 3). Non-goals respected (no identity-model change, no CI). No spec requirement left without a task.
- **Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code/edit step contains the full literal content and the exact before/after.
- **Type/name consistency:** `validateAdminSecret` (function + module `server/validateAdminSecret.js`, test requires `./validateAdminSecret`) consistent across Task 2. `adminLimiter` (module `server/adminLimiter.js`, test requires `./adminLimiter`, server.js requires `./server/adminLimiter`) consistent across Task 3. Leaderboard row shape `{ chainLength, name }` consistent between the Task 1 change and its test assertion.
