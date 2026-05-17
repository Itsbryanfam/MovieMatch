# Phase 2 — Robustness + CI Hardening (Design Spec)

**Date:** 2026-05-17
**Status:** Approved design, pending written-spec review
**Scope:** Sub-project 2 of 5 from the 2026-05-16 full-codebase review. Server-side + tooling only. No client changes, no Redis schema/data migration. Sequenced after Phase 1 (security) because the site is live (moviematch.it.com) and these are correctness-under-concurrency / regression-prevention gaps, not new features.

This spec covers ONLY Phase 2. Phases 3–5 (maintainability refactor, content/polish, growth) get their own spec → plan → build cycles.

Per the project's standing convention, every code change in this phase ships with explanatory inline comments (the WHY), consistent with Phase 1.

---

## Problem statement

The 2026-05-16 review plus direct code verification on 2026-05-17 surfaced seven hardening gaps in three families:

### Concurrency / restart robustness

1. **R1 — Two unguarded read-modify-write branches.** The live game loop serializes lobby mutations through `redisUtils.withLobbyLock` (per-lobby Redis mutex, re-reads state *inside* the lock — see `server/redisUtils.js:254-308`). Two branches bypass it:
   - `quitGame` non-current-turn `else` (`server/systems/lobbySystem.js:633-642`): unlocked `getLobby` at line 606 → `player.isAlive = false` → `saveLobby` → `checkWinCondition` → `getLobby` → `broadcastState`.
   - Grace-timer non-current-turn `else` inside `handleDisconnect`'s `setTimeout` (`server/systems/lobbySystem.js:735-741`): unlocked `getLobby` at line 725 → `livePlayer.isAlive = false` → `saveLobby` → `checkWinCondition` → `getLobby` → `broadcastState`.

   Both are classic lost-update races: a concurrent `submitMovie`/`quitGame`/grace-expiry on the same lobby can interleave between the read and the `saveLobby`, and the later write silently clobbers the earlier one (e.g. a player marked dead gets resurrected, or a chain advance is lost). The current-turn branches of both paths delegate to the canonical `gameLogic.eliminateCurrentPlayer` and are explicitly out of scope (the original review scoped the defect to the `else` branches; the canonical path is the same one the lock-guarded watchdog uses).

2. **R2 — Turn watchdog re-armed only at boot.** Turn watchdogs live in an in-process `Map` (`server/gameLogic.js:9`); game state lives in Redis and survives restarts, the timers do not. `recoverActiveTurns` re-arms watchdogs for all in-flight lobbies, but it runs exactly once, at boot (`server.js:337-339`). Under horizontal scaling, or after a single-instance crash/deploy mid-game with no subsequent boot, a playing lobby can sit in Redis with an expired `turnExpiresAt` and **no process scheduled to act on it** — a soft-lock identical in family to the boot-recovery case the review already fixed, just on the steady-state axis instead of the boot axis.

3. **R3 — Jest "worker failed to exit gracefully".** Pre-existing, flagged in the original review. The suite passes but Jest reports a worker that will not exit, indicating a leaked open handle (timer, Redis client, or un-closed supertest server). It is noise today, but it masks future real leaks and blocks reliable CI exit-code semantics — and Phase 2's R2 *adds* a new periodic timer, which would worsen this if not handled deliberately. R2 and R3 are therefore coupled.

### Regression-prevention safety net

4. **CI1 — No CI exists.** There is no `.github/` directory, no automated test gate. Render auto-deploys from `main` on every push, so a regression reaches production with zero automated checks.

5. **CI2 — Coverage is low and the core action is untested.** Reported coverage ≈49% statements / 39% branches. The central game action — a valid movie submission extending the chain and advancing the turn — is **untested on the success path**: `submitMovie` (`server/systems/matchSystem.js:121`) → `commitPlay` (`server/systems/matchSystem.js:473`, called at line 270). There is no coverage floor, so coverage can silently regress further.

### Phase 1 carryover (mapped here by the Phase 1 completion note)

6. **M2 — `validateAdminSecret` checks length only.** `server/validateAdminSecret.js` accepts any string ≥32 chars, so `'a'.repeat(32)` — zero entropy — boots successfully. The guard's stated purpose (resist brute force) is not met for trivially weak long secrets.

7. **M3 — `adminLimiter` uses an in-process store.** `server/adminLimiter.js` uses `express-rate-limit`'s default in-memory store. Across N instances the real brute-force ceiling on `ADMIN_SECRET` is `5 × N` attempts / 15 min, not 5, and it resets to 0 on every deploy. **Decision (approved): fix with a Redis-backed shared store.**

## Goals

- Every lobby state mutation in the quit and grace-expiry paths is serialized through `withLobbyLock` (no lost updates).
- A playing lobby can never sit indefinitely with an expired turn and no watchdog, regardless of restarts or instance count, in steady state (not just at boot).
- `jest` (and `jest --coverage`) exits cleanly with no leaked-handle warning, including after R2's new timer.
- Every push and PR to `main` runs the full suite automatically; coverage cannot regress below a locked floor.
- The core `submitMovie`→`commitPlay` success path has a regression test.
- `ADMIN_SECRET` must clear a minimum-entropy bar, not just a length bar, to boot.
- The admin rate limit is a true global `5 / 15 min / IP` ceiling across all instances and across deploys.
- Zero user-visible behavior change. Zero Redis schema/data migration. No client files touched.

## Non-goals (explicitly out of scope for Phase 2)

- Refactoring `ui.js`/`style.css`, the `showScreen()` helper, or server `constants.js` (Phase 3).
- Daily-list expansion, manifest icons, service worker, `.gitignore` coverage (Phase 4).
- Accounts/friends, bots, local fallback movie DB (Phase 5).
- Re-architecting watchdogs onto a Redis-native scheduler/queue. R2 is a periodic in-process safety sweep that closes the soft-lock window using the existing idempotent, lock-guarded `armTurnTimeout`; a full distributed scheduler is a larger effort not justified at current scale.
- Locking the current-turn branches of `quitGame`/grace-expiry (they delegate to the canonical `eliminateCurrentPlayer`; out of scope per the original review).
- Raising coverage to an aspirational target. The threshold is a *ratchet floor* (approved): measure current coverage, set the threshold at/just below it, let the new happy-path test raise the locked-in floor. Future phases can ratchet upward.

---

## Verification done during design (against current code)

- `withLobbyLock(pubClient, id, mutator, opts)` (`server/redisUtils.js:273`) acquires a per-lobby mutex, **re-reads the lobby inside the lock**, runs `await mutator(room)` (mutate in place), persists unless the mutator returns exactly `false`, and **returns the (possibly mutated) room or null**. Existing callers (`lobbySystem.js:233/252/266/280/300/522`) follow the pattern: mutate inside, broadcast outside using the returned room. R1 will follow that exact pattern.
- `armTurnTimeout(io, pubClient, id, state)` (`server/gameLogic.js:42`) clears any existing watchdog for the lobby before arming, takes the submit lock in its handler, and re-checks expiry on fresh state — so it is idempotent and safe to call from multiple instances; only one wins the submit lock, the rest no-op on fresh state.
- `hasActiveTurnTimeout(id)` (`server/gameLogic.js:28`) is already exported. **Critical correctness constraint for R2:** the periodic sweep MUST arm only lobbies where `!hasActiveTurnTimeout(id)`. Calling `armTurnTimeout` unconditionally every interval would *clear and re-arm a healthy in-flight timer on every tick*, so a turn whose timer is shorter than the sweep interval would never expire — the sweep must never touch a lobby this instance is already watching.
- `recoverActiveTurns(io, pubClient)` (`server/gameLogic.js:298`) arms unconditionally — correct at boot (the Map is empty) but wrong semantics for a periodic sweep. R2 adds a *separate* function rather than overloading this one, so boot semantics ("re-arm everything, fresh process") and steady-state semantics ("arm only the unwatched") stay distinct and independently testable.
- `express-rate-limit` is already at `^8.4.1` and `redis` at `^5.12.1`; `pubClient` (node-redis v5) is available in `server.js` where `adminLimiter` is mounted. `adminLimiter` is currently a side-effect-free module with no Redis access, so M3 requires a small factory refactor (below) to inject the client while preserving Phase 1's unit-testability rationale.

---

## Design

### R1 — Route the two non-current-turn branches through `withLobbyLock`

**File:** `server/systems/lobbySystem.js`.

`quitGame` (lines 603-643): the non-current-turn `else` (633-642) becomes:

```js
} else {
  // Audit Phase 2 R1: serialize this read-modify-write through the
  // per-lobby mutex. Previously this branch did an unlocked getLobby (606)
  // → mutate → saveLobby, so a concurrent submit/quit/grace-expiry could
  // interleave and clobber the write (lost update — a dead player could
  // be resurrected, or a chain advance lost). Mutate INSIDE the lock;
  // broadcast OUTSIDE it using the room the lock returns (the same
  // pattern every other withLobbyLock caller in this file uses).
  const updated = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    const lp = r.players.find(p => p.id === socket.id);
    if (!lp || !lp.isAlive) return false; // nothing to change → don't persist
    lp.isAlive = false;
  });
  if (updated) {
    io.to(lobbyId).emit('notification', { msg: `${player.name} quit the game.`, kind: 'info' });
    await gameLogic.checkWinCondition(io, pubClient, lobbyId, updated);
    const finalRoom = await redisUtils.getLobby(pubClient, lobbyId);
    if (finalRoom) gameLogic.broadcastState(io, lobbyId, finalRoom);
  }
}
```

The grace-timer non-current-turn `else` inside `handleDisconnect`'s `setTimeout` (735-741) is restructured identically: the `livePlayer.isAlive = false` + `saveLobby` becomes the lock mutator (re-finding the player on the fresh in-lock room by `stableId`/`id`, mirroring the existing line 729 lookup), and `checkWinCondition`/`broadcastState` run outside on the returned room. The current-turn branches of both paths are unchanged.

**Rationale for mutate-in / broadcast-out:** `checkWinCondition` and `broadcastState` read state and emit; keeping them outside the mutex matches every existing caller, avoids holding the mutex across socket I/O, and avoids any re-entrancy concern (the mutator stays a pure in-place field flip). `withLobbyLock` returning `false` from the mutator is the established "decided not to change anything, don't persist" signal (`redisUtils.js:260-261`).

**Considered alternative (rejected):** widen the lock to also cover `checkWinCondition`. Rejected — no existing caller does this, it holds the mutex across emits, and `checkWinCondition` already operates correctly post-lock everywhere else.

### R2 — Periodic watchdog re-arm sweep

**File:** `server/gameLogic.js` — add a new exported function:

```js
// Phase 2 R2: steady-state companion to recoverActiveTurns. Watchdogs are
// in-process; recoverActiveTurns only re-arms at boot, so a mid-game
// crash/deploy/scale event on another instance can leave a playing lobby
// in Redis with an expired turn and no process watching it. This sweep
// (run on an interval, every instance) arms a watchdog for any playing
// lobby THIS instance is not already watching. It MUST gate on
// !hasActiveTurnTimeout(id): re-arming a healthy in-flight timer every
// tick would reset it forever and turns would never expire. Safe across
// instances because armTurnTimeout is idempotent + submit-lock-guarded +
// re-reads fresh state — only one instance's watchdog ever eliminates.
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

**File:** `server.js` — alongside the existing boot recovery (`server.js:337-339`) and the existing `setInterval` patterns (`server.js:313`, `317-320`), add:

```js
// Phase 2 R2: periodic safety sweep (see sweepMissingTurnWatchdogs).
// .unref() so this timer never by itself keeps the process (or a Jest
// worker) alive — consistent with Phase 2 R3's open-handle cleanup.
const turnSweepInterval = setInterval(() => {
  gameLogic.sweepMissingTurnWatchdogs(io, pubClient)
    .then(n => { if (n > 0) logger.info(`Turn-watchdog sweep armed ${n} unwatched lobbies`); })
    .catch(err => logger.error(err, 'Periodic turn-watchdog sweep failed'));
}, TURN_SWEEP_INTERVAL_MS);
turnSweepInterval.unref();
```

`TURN_SWEEP_INTERVAL_MS` is a named constant (30000). 30s bounds worst-case soft-lock latency to one sweep cycle while keeping `getAllLobbies` load negligible. The interval handle is kept in scope so a future graceful-shutdown path (and tests) can `clearInterval` it; `.unref()` guarantees it never blocks process/worker exit on its own.

**Considered alternative (rejected):** reuse `recoverActiveTurns` on the interval. Rejected — its unconditional arm is correct only when the Map is empty (boot); on a populated Map it would reset healthy timers every tick (the correctness landmine above). Distinct function = distinct, testable semantics.

### R3 — Eliminate the leaked-handle warning

**Diagnosis (not pre-judged):** run `npx jest --detectOpenHandles --runInBand` and read the reported handle(s). Likely candidates, in order: the `server.js` module-scope `setInterval`s (poster refresh `server.js:313`, leaderboard prune `server.js:317`) if any test imports `server.js`; the pino logger; supertest HTTP servers not `.close()`d; Redis doubles/clients not `.quit()`d in `afterAll`.

**Fix shape (exact fix follows the diagnosis, but the acceptance bar is fixed):**
- Production interval timers that exist only as periodic best-effort sweeps get `.unref()` (they must never hold the process open; losing one tick on shutdown is harmless). This includes R2's new interval by construction.
- Test-created resources (supertest servers, Redis doubles/fakes) get torn down in `afterAll`/`afterEach`.
- The bar: `npx jest` and `npx jest --coverage` both complete with **no** "worker failed to exit gracefully" / open-handle warning, and the suite stays green.

No production behavior changes from `.unref()` — an unref'd interval still fires for the entire life of a running server; it only stops being a reason the process refuses to exit.

### CI1 — GitHub Actions

**File (new):** `.github/workflows/ci.yml`.

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
      matrix:
        node-version: [18, 20]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm test -- --coverage --runInBand
```

Node 18 + 20 matrix matches `engines.node >=18`. `--coverage` makes CI enforce CI2's threshold; `--runInBand` keeps Redis-double/timer behavior deterministic in the CI container and makes the R3 clean-exit guarantee meaningful as a gate. No secrets needed — the suite uses Redis doubles/mocks, not a live Redis/TMDB.

### CI2 — Core happy-path test + coverage ratchet

**File:** `server/systems/matchSystem.test.js` (extend, or a focused new `server/match-commitplay.test.js` if the existing file's harness doesn't fit) — add a success-path test: current player submits a valid movie that shares an actor with the chain head; assert the chain extends by one, the turn advances to the next alive player, state is persisted, and the success broadcast fires. This exercises `submitMovie` (`matchSystem.js:121`) → `commitPlay` (`matchSystem.js:473`).

**File:** `jest.config.js` — add a `coverageThreshold` to **both** projects' shared config (the file uses the `projects` array; the threshold is applied at the top level so `jest --coverage` enforces it across the suite). The exact numbers are set empirically: run `npx jest --coverage` after the happy-path test lands, read the achieved global statements/branches/functions/lines, and set each threshold 1–2 points below the achieved value (a floor that blocks regression without being flaky against minor run-to-run variance). The spec fixes the *method*; the plan records the measured numbers.

### M2 — Minimum-entropy check in `validateAdminSecret`

**File:** `server/validateAdminSecret.js`.

Rule: still require `typeof secret === 'string'` and `secret.length >= 32`, **and additionally** require at least **5 distinct characters**. Rationale: a cryptographically random 32+ char secret (including all-hex, e.g. the deployed 64-hex value) has well over 5 distinct characters with overwhelming probability, so there are no false positives on real secrets; meanwhile `'a'.repeat(32)`, `'ab' * 16`, and similar trivially weak long strings are rejected. Distinct-character-count is chosen over regex character-class rules because it has no false positives on a pure-hex random secret (a class rule like "must contain a symbol" would reject the already-deployed valid secret — unacceptable).

Two distinct return messages so the boot log is actionable:
- `< 32` or non-string → `'ADMIN_SECRET must be set and at least 32 characters'` (unchanged — preserves the existing 5 tests' expectations for the length cases).
- `>= 32` but `< 5` distinct chars → `'ADMIN_SECRET is too weak (needs at least 5 distinct characters)'`.

`null` on pass (unchanged contract). Update `server/admin-secret.test.js`: keep the 5 existing length/type cases, add cases — `'a'.repeat(40)` → weak error; a real 64-hex sample → `null`; a 32-char string with exactly 4 distinct chars → weak error; with 5 → `null`.

### M3 — Redis-backed shared store for `adminLimiter`

**Dependency:** add `rate-limit-redis` (peer of the already-present `express-rate-limit@^8`).

**File:** `server/adminLimiter.js` — refactor from a pre-built singleton into a factory so the Redis client can be injected while keeping the Phase 1 unit-testability rationale (no `server.js` boot side effects in tests):

```js
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');

// Phase 2 M3: factory (was a bare singleton). The in-memory default store
// made the real ceiling 5×N across N instances and reset every deploy. A
// Redis store keyed on the shared pubClient restores a true global
// 5/15min/IP ceiling that survives deploys. Still its own module (not
// inlined in server.js) so it stays unit-testable without booting the
// server. Fail-open on store error: if Redis is unreachable the whole app
// is already degraded (game state is in Redis); the limiter must not hard-
// lock the operator out of admin recovery. This matches the codebase's
// existing best-effort lock philosophy (withLobbyLock proceeds unlocked
// after its TTL-bounded spin rather than dropping the action).
function createAdminLimiter(redisClient) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
      prefix: 'rl:admin:',
    }),
  });
}
module.exports = createAdminLimiter;
```

**File:** `server.js` — change the mount from `app.use('/api/admin', adminLimiter)` to `app.use('/api/admin', createAdminLimiter(pubClient))`, placed exactly where the current mount is (between `express.static` and the first `/api/admin` route — unchanged ordering).

**File:** `server/admin-ratelimit.test.js` — update to construct the limiter via the factory with a Redis double exposing `sendCommand`; preserve the existing assertion (5 requests pass, 6th in-window → 429; auth failures consume budget). Add: a store-error injection asserts fail-open (request still served, not hard-denied).

**Considered alternatives (rejected):** (B) defer M3 — leaves a live, deploy-resetting brute-force weakness on the only credential in the system; rejected by the approved decision. (C) lower `max` — punishes legitimate single-instance admin use and still drifts with instance count; not a real fix.

---

## Test plan

All tests run in the existing Jest suite (`server` project, node env). TDD per item, consistent with Phase 1.

1. **R1 — lock serialization.** Using the existing in-memory Redis double pattern from `server/lobby-lock.test.js`: drive two concurrent non-current-turn quits (and a quit racing a grace-expiry) on one lobby; assert no lost update (both deaths persist; no resurrection) and that the mutator returning `false` (already-dead/absent player) does not persist.
2. **R2 — sweep semantics.** `sweepMissingTurnWatchdogs` arms a watchdog for a playing lobby with no active timeout; **does not** re-arm (does not call `clearTurnTimeout`/reset) a lobby where `hasActiveTurnTimeout` is true; skips non-playing lobbies; a Redis error in `getAllLobbies` is swallowed and returns `0`.
3. **R3 — clean exit.** `npx jest --detectOpenHandles` reports no open handle; `npx jest` and `npx jest --coverage` print no "worker failed to exit gracefully"; suite green.
4. **CI1 — workflow.** `ci.yml` is valid YAML; lints/parses; jobs install + run the suite with coverage on the 18/20 matrix. (Verified by the first PR's Actions run.)
5. **CI2 — happy path + threshold.** New test: valid submission extends chain by 1, advances turn, persists, broadcasts success. `jest --coverage` meets the committed `coverageThreshold`; lowering coverage below it fails the run (verified by a scratch check, not committed).
6. **M2 — entropy.** The 5 existing length/type cases still pass with the unchanged message; `'a'.repeat(40)` and a 4-distinct-char 32-string → weak-secret message; a real 64-hex sample and a ≥5-distinct 32-string → `null`.
7. **M3 — shared store + fail-open.** 5 pass / 6th 429 with the Redis double; auth failures consume budget; injected store error → request still served (fail-open), not hard-denied.

Manual check (documented, not automated, same rationale as Phase 1's `process.exit`): boot locally with the real `ADMIN_SECRET`; confirm clean boot and that the periodic sweep logs only when it arms something.

## Acceptance criteria

- [ ] `quitGame` and grace-timer non-current-turn branches mutate only inside `withLobbyLock`; broadcast outside on the returned room; concurrent-mutation test shows no lost update.
- [ ] `sweepMissingTurnWatchdogs` exists, is interval-driven from `server.js`, arms only `!hasActiveTurnTimeout` playing lobbies, never resets a healthy timer; the interval is `.unref()`'d.
- [ ] `npx jest` and `npx jest --coverage` exit with no leaked-handle / worker-exit warning; suite green.
- [ ] `.github/workflows/ci.yml` runs `npm ci` + the suite with coverage on push/PR to `main` (Node 18 + 20).
- [ ] `submitMovie`→`commitPlay` success path has a regression test; `jest.config.js` has a `coverageThreshold` set at the measured ratchet floor and CI enforces it.
- [ ] `validateAdminSecret` rejects `<32`, non-string, and `>=32` with `<5` distinct chars; accepts a real random secret; messages distinguish the two failure reasons.
- [ ] `adminLimiter` is a `createAdminLimiter(redisClient)` factory backed by a Redis store on the shared `pubClient`; global 5/15min ceiling; fails open on store error; existing limiter behavior preserved.
- [ ] Full existing suite still passes plus all new tests; zero client files changed; no Redis data migration.

## Risks & rollback

- **Risk:** R1's mutator scope is too narrow/wide and changes elimination/win semantics. **Mitigation:** mutator is a pure in-place `isAlive` flip mirroring the exact pre-existing field write; `checkWinCondition`/`broadcastState` run post-lock exactly as before; covered by the concurrency test. Rollback: revert the two branch edits (localized).
- **Risk:** R2 interval adds load or, if the `!hasActiveTurnTimeout` gate is wrong, disables turn timeouts. **Mitigation:** the gate is the explicit central acceptance criterion with a dedicated test; 30s interval over `getAllLobbies` is negligible; `.unref()`'d. Rollback: remove the `setInterval` block (the new function is inert if uncalled).
- **Risk:** CI2 threshold set too high → CI red on unrelated PRs. **Mitigation:** ratchet floor method — threshold is set *below* measured, empirically. Tunable in one file.
- **Risk:** M3 — a Redis outage interacts with the limiter. **Mitigation:** explicit fail-open decision (documented in code), consistent with existing best-effort lock philosophy; Redis-down already degrades the whole app independently of this.
- **Risk:** M2 false-positive rejects a valid deployed secret on next boot. **Mitigation:** distinct-character-count rule is provably satisfied by the already-deployed 64-hex secret; an explicit test asserts a real hex sample passes.
- No data migration, no client changes → no data-loss or UX-regression risk.

## Files touched (Phase 2)

| File | Change |
|---|---|
| `server/systems/lobbySystem.js` | R1: route `quitGame` + grace-timer non-current-turn branches through `withLobbyLock` |
| `server/gameLogic.js` | R2: add exported `sweepMissingTurnWatchdogs` |
| `server.js` | R2: add `.unref()`'d periodic sweep `setInterval` + `TURN_SWEEP_INTERVAL_MS`; M3: mount via `createAdminLimiter(pubClient)`; R3: `.unref()` best-effort intervals as diagnosis dictates |
| `server/adminLimiter.js` | M3: refactor to `createAdminLimiter(redisClient)` factory with `rate-limit-redis` store |
| `server/validateAdminSecret.js` | M2: add ≥5-distinct-character check + second message |
| `jest.config.js` | CI2: add `coverageThreshold` (ratchet floor) |
| `.github/workflows/ci.yml` | **New** — CI workflow (Node 18/20, `npm ci`, suite + coverage) |
| `package.json` | M3: add `rate-limit-redis` dependency |
| `server/systems/matchSystem.test.js` (or new `server/match-commitplay.test.js`) | CI2: `submitMovie`→`commitPlay` success-path test |
| `server/lobby-lock.test.js` (or new `server/quit-grace-lock.test.js`) | R1: concurrent non-current-turn mutation / lost-update test |
| `server/turn-sweep.test.js` | **New** — R2 sweep semantics test |
| `server/admin-secret.test.js` | M2: add entropy cases |
| `server/admin-ratelimit.test.js` | M3: factory + Redis double + fail-open case |

No client files. No Redis schema/keys changed (M3 adds `rl:admin:*` rate-limit keys, which are ephemeral counters, not game data). One new dependency (`rate-limit-redis`).
