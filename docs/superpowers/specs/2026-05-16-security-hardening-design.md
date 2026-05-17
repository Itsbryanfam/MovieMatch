# Phase 1 — Security Hardening (Design Spec)

**Date:** 2026-05-16
**Status:** Approved design, pending written-spec review
**Scope:** Sub-project 1 of 5 from the 2026-05-16 full-codebase review. Standalone, server-side only, no Redis migration, no data loss. Sequenced first because the site is live (moviematch.it.com) and finding #1 is a confirmed confidentiality leak affecting real users.

This spec covers ONLY Phase 1. Phases 2–5 (robustness+CI, refactor, content/polish, growth) get their own spec → plan → build cycles.

---

## Problem statement

The 2026-05-16 review surfaced three security issues, one confirmed end-to-end:

1. **Confirmed leak — `stableId` echoed to clients.** `getDailyLeaderboard` returns `{ stableId, chainLength, name }` per row (`server/systems/dailySystem.js:258-262`). That value reaches the browser via two paths:
   - `requestDailyLeaderboard` handler → `socket.emit('dailyLeaderboard', { ... leaderboard })` (`server/socketHandlers.js:270-272`)
   - "already played today" → `socket.emit('dailyAlreadyPlayed', { ... leaderboard })` (`server/systems/lobbySystem.js:373-378`)

   `stableId` is the *only* credential in the system: `requestMyStats` accepts any `stableId` and returns that player's lifetime stats (`server/socketHandlers.js:285-290`), and daily-lobby rejoin auth is keyed on it (`server/systems/lobbySystem.js:172-173`). So any visitor can call `requestDailyLeaderboard`, harvest the top-N players' `stableId`s, then read their stats / forge their daily identity. The handler comment "stableId IS the auth" (`server/socketHandlers.js:277`) is contradicted by the leaderboard handing those secrets out.

2. **No startup validation of `ADMIN_SECRET`.** TMDB token has a fatal boot check (`server.js`, near the TMDB validation); `ADMIN_SECRET` has none. `safeEqual` fails closed if it's unset (`server.js:51-57`), so this is not a live bypass, but a missing/short secret deploys silently, and `.env.example` does not list `ADMIN_SECRET` at all even though the README documents it as required.

3. **Admin endpoints rely only on the global limiter.** `/api/admin/*` (`server.js:106+`) sit behind the global `120 req/min/IP` limiter (`server.js:97-102`) — no dedicated throttle. `flush-credits` and `prune-leaderboard` are destructive; a weak secret is brute-forceable at 120 guesses/min/IP.

## Goals

- No raw `stableId` ever crosses the wire to any client.
- Missing/weak `ADMIN_SECRET` fails loudly at startup, not silently in prod.
- Admin endpoints have brute-force-resistant rate limiting independent of the global limiter.
- Zero user-visible behavior change. Zero Redis schema/data migration.

## Non-goals (explicitly out of scope for Phase 1)

- Replacing the `stableId`-as-bearer-token identity model with server-issued sessions/cookies (this is the deeper fix for finding C4 in the review; it is a Phase 5 design topic, not a hardening patch).
- Any change to `requestMyStats` semantics beyond what falls out of #1 (it stops being exploitable once stableIds aren't harvestable, which is sufficient for Phase 1).
- `.env.example` already lacks `ADMIN_SECRET`; we add it. Other env hygiene is out of scope.
- CI / tests-as-a-gate (that is Phase 2). Phase 1 ships with its own unit/integration tests but does not stand up GitHub Actions.

---

## Verification of the client path (done during design)

The client daily-leaderboard renderer (`public/js/ui.js:1575-1591`, inside `renderDailyResult`) reads only `entry.name` and `entry.chainLength`. It does **not** read `entry.stableId` and has **no "your row" highlight**. The client emits `requestDailyLeaderboard` with only a `date` argument (`public/js/socketClient.js:429`) — it never sends its own `stableId`.

**Consequence:** removing `stableId` from the server payload is a pure no-op for the client. No client edit, no `isYou`/`you` object, no behavior change. This is strictly *less* work and *less* risk than the originally approved design, which had speculated a one-line client touch. Scope only shrank.

`toClientState` (`server/gameLogic.js:95-99`) already strips `stableId` from broadcast player/spectator state — the security review confirmed the daily leaderboard is the *sole* client-facing exception. No other emit path is in scope.

---

## Design

### Change 1 — Stop returning `stableId` from `getDailyLeaderboard`

**File:** `server/systems/dailySystem.js`, function `getDailyLeaderboard` (lines ~246-266).

The returned row object changes from `{ stableId, chainLength, name }` to `{ chainLength, name }`. The `rank` is positional (the client already derives medal/rank from array index at `ui.js:1580`), so no `rank` field is added — keep the payload minimal and the client untouched.

`stableId` (`e.value` from the ZSET) is still used *internally within the function* to look up each player's name via `getDailyAttempt` (`dailySystem.js:255-257`); it is simply not placed on the returned object.

No server-internal caller consumes `stableId` from this function's return (verified: the only callers are the two emit sites in `socketHandlers.js` and `lobbySystem.js`, neither of which reads `stableId` post-call). Both client-facing paths are fixed by this single change.

**Considered alternative (rejected):** strip `stableId` at each of the two emit boundaries instead of in `getDailyLeaderboard`. Rejected: two chokepoints instead of one, easier to miss a future third caller, and the function genuinely has no reason to expose the secret. Single-source fix is simpler and safer.

### Change 2 — Fail-fast on missing/weak `ADMIN_SECRET`

**File:** `server.js`, at startup alongside the existing TMDB token validation.

Add a small pure guard so the logic is unit-testable without invoking `process.exit`:

```js
// Reject startup if the admin secret is missing or too weak to resist
// brute force. 32 chars is the documented minimum (see .env.example).
// Pure function so it can be unit-tested without spawning a process.
function validateAdminSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    return 'ADMIN_SECRET must be set and at least 32 characters';
  }
  return null; // null = valid
}
```

At boot: `const adminErr = validateAdminSecret(process.env.ADMIN_SECRET); if (adminErr) { logger.fatal(adminErr); process.exit(1); }` — placed next to the TMDB check so both required-secret failures behave identically.

**File:** `.env.example` — add:
```
# Required. Min 32 chars. Gates /api/admin/* endpoints.
ADMIN_SECRET=replace_with_a_long_random_string_min_32_chars
```

### Change 3 — Dedicated admin rate limiter

**File:** `server.js`.

Add a second `express-rate-limit` instance, stricter than the global one, applied by path prefix *before* the admin route definitions so it covers all current and future `/api/admin/*` routes without restructuring handlers into a Router:

```js
// Strict, separate from the global 120/min limiter. Admin auth failures
// count toward this budget on purpose — that is the brute-force ceiling.
// 5 attempts / 15 min / IP. trust proxy is already set (server.js:61) so
// req.ip is the real client IP behind the PaaS proxy.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/admin', adminLimiter);
```

Placed after the global `app.use(limiter)` and after `express.static`, before the first `app.post('/api/admin/...')`.

**Considered alternative (rejected):** restructure the three admin routes onto an `express.Router()` with the limiter as router middleware. Rejected for Phase 1: more churn/risk than a path-prefixed `app.use` for identical effect. The Router refactor can ride along with Phase 3 if desired.

---

## Test plan

All tests live with the existing Jest suite (no new infra — that is Phase 2).

1. **`dailySystem` unit test** (`server/systems/dailySystem.test.js`): seed a leaderboard ZSET + attempt records, call `getDailyLeaderboard`, assert each returned row has `name` and `chainLength` and that `'stableId' in row === false` for every row. This is the regression guard for the confirmed leak.
2. **`validateAdminSecret` unit test** (new small test, or appended to an existing server test): `undefined` → error; `''` → error; 31-char string → error; 32-char string → `null`; non-string → error.
3. **Admin limiter integration test** (`server/socket.integration.test.js` or a small new HTTP test using the existing `supertest` dep): fire 5 requests to `/api/admin/redis-stats` with a bad secret → all `403`; the 6th within the window → `429`. Asserts the limiter counts auth failures (the brute-force ceiling) and is independent of the 120/min global limiter.

Manual check (documented, not automated — `process.exit` is impractical to unit test): start the server with `ADMIN_SECRET` unset and with a short value; confirm it logs fatal and exits non-zero.

## Acceptance criteria

- [ ] `getDailyLeaderboard` return rows contain no `stableId` key; both `dailyLeaderboard` and `dailyAlreadyPlayed` emitted payloads verified leak-free.
- [ ] Client daily result modal still renders names + chain lengths identically (no regression — manual check, since client code is untouched this is a sanity confirmation).
- [ ] Server exits non-zero with a fatal log when `ADMIN_SECRET` is missing or < 32 chars; boots normally with a valid one.
- [ ] `.env.example` documents `ADMIN_SECRET` with the 32-char minimum.
- [ ] 6th admin request in a 15-min window from one IP returns `429`; legitimate single admin calls are unaffected.
- [ ] Full existing test suite still passes (182 baseline) plus the 3 new tests.

## Risks & rollback

- **Risk:** a deployment currently running without a 32-char `ADMIN_SECRET` will refuse to boot after this ships. **Mitigation:** this is the intended behavior; call it out in the Phase 1 completion note so the operator (the user) sets the env var before deploy. Rollback is a single revert commit (all changes are additive/localized).
- **Risk:** the admin limiter could lock the operator out during legitimate debugging. **Mitigation:** 5/15min is generous for human admin use; documented in the limiter comment. Tunable via the `max` constant.
- No data migration, so no data-loss risk.

## Files touched (Phase 1)

| File | Change |
|---|---|
| `server/systems/dailySystem.js` | Drop `stableId` from `getDailyLeaderboard` return rows |
| `server.js` | Add `validateAdminSecret` guard + fatal boot check; add `adminLimiter` + `app.use('/api/admin', ...)` |
| `.env.example` | Add documented `ADMIN_SECRET` line |
| `server/systems/dailySystem.test.js` | Add no-`stableId`-in-payload regression test |
| `server/socket.integration.test.js` (or new) | Add admin limiter 429 test |
| (test for `validateAdminSecret`) | New small unit test |

No client files. No Redis keys. No dependency changes (`express-rate-limit` already in `package.json`).
