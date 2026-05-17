# Phase 5b — Local Fallback Movie DB: Design Spec

**Date:** 2026-05-17
**Status:** Approved (brainstorming) — proceeding to implementation plan
**Phase:** 5b of the post-2026-05-16-review remediation, and the **FINAL** sub-phase.
Phase 5 ("growth") was re-scoped during brainstorming into **5a bot opponents →
5b local fallback movie DB**; accounts/friends/history (L4) was dropped by
design (barrier-to-entry vs. the growth goal). Phases 1–5a are merged to `main`
(`origin/main` = `4e1372b`, includes Phase 5a PR #18 + the submit-pipeline
robustness fix PR #19). **Completing 5b closes the entire 5-phase remediation.**

---

## 1. Goal & Motivation

TMDB is a **single point of failure on the hot path**. Today, a TMDB outage (or
timeout, or non-OK response) on an **uncached** title does not degrade
gracefully — it **eliminates the active player mid-game** (and now bots too).

Verified failure mechanics on current `main`:

- **Resolve fails first.** `resolveCandidates` (`server/systems/matchSystem.js`)
  is step 1 of the submit pipeline. Its direct-ID path does
  `fetch(${TMDB}/{type}/{id})` for details; its fuzzy path does
  `fetch(${TMDB}/search/{type}?query=)`. If TMDB is down, that fetch
  throws/`!ok` **before credits are ever reached**, propagating to
  `submitMovie`'s (and `submitBotMove`'s) catch →
  `gameLogic.eliminateCurrentPlayer(..., "API Error or Timeout!")`.
- **Credits also fail.** `getOrFetchCredits` (`server/redisUtils.js:126-192`,
  the cast-graph lookup that validates every move) throws `TMDB credits failed`
  on `!ok`/timeout. `enrichWithCredits`' per-candidate catch turns that into an
  empty cast → `validateChainConnection` → `"Invalid movie connection."` →
  elimination.
- **What already survives:** cached titles (the `credits:v2:*` Redis cache,
  7-day TTL) keep working through an outage; `autocompleteSearch` failure only
  degrades (no suggestions); poster failure is cosmetic (`posterCache`).

**Conclusion (the key design insight):** a *credits-only* fallback is
**insufficient** — the resolve-step fetch fails first. Preventing
outage-elimination requires a genuine **local movie DB** providing, for a
curated set of well-known movies: **details (id→title/year), title→id
resolution, and cast** — so both the resolve step and the credits step can fall
back. This is exactly what backlog item L9 ("local fallback movie DB") names.

**Goal:** during a TMDB outage, a submit of a *common* movie (the bundled set) —
whether picked from autocomplete, typed by a human, or chosen by a bot — is
**resolved and validated from local data instead of eliminating the player**.
Out-of-set movies during an outage keep today's exact behavior (unchanged).

---

## 2. Scope

### In scope
- **`data/fallbackMovies.json`** — committed curated dataset; per entry
  `{ id, title, year, mediaType:"movie", cast:[{id,name}] }`, `cast` capped at
  the top ~20 billed.
- **`scripts/build-fallback-movies.js`** — new committed **one-time** generator
  (`npm run build:fallback-movies`), structurally mirroring the Phase 4
  `scripts/build-daily-movies.js` precedent.
- **`server/systems/fallbackMovies.js`** — read-once-cached loader.
- **Failure-only fallback branches** in `resolveCandidates`
  (`server/systems/matchSystem.js`) — direct-ID by id, fuzzy by title — and in
  `getOrFetchCredits` (`server/redisUtils.js`) — cast by id.
- Tests + a `package.json` `build:fallback-movies` script.
- WHY-comments on every change (project convention).

### Out of scope (explicit)
- **Poster fallback** — already degrades gracefully (`posterCache`); cosmetic.
- **TV-show fallback** — the curated set is movies-only (the daily pool and bots
  are movies-only); TV stays live-TMDB-only. Noted future, not now.
- **Changing elimination semantics** for an out-of-set movie during an outage —
  that is a game-design change, not resilience. Uncovered + TMDB-down keeps
  **today's exact behavior** (eliminate).
- **Live / automatic refresh** of the dataset — manual `npm run` regeneration,
  exactly like the daily pool.
- Accounts/friends/history (dropped earlier); anything Phase-5a.

---

## 3. Current Architecture (grounding)

Verified on `main` `4e1372b`. The plan must re-confirm exact line numbers.

- **Submit pipeline** (`matchSystem.js`): `submitMovie` →
  `resolveCandidates(room, movie, tmdbId, mediaType, TMDB_HEADERS)` (step 1) →
  `enrichWithCredits` → `validateChainConnection` → `commitPlay` → `nextTurn`.
  `submitBotMove` reuses the same pipeline (always direct-ID).
- **`resolveCandidates`** (private, exported for bots): direct path =
  `_validatedDirectLookup` → `fetch(${TMDB_API_BASE}/{type}/{id}?language=en-US)`
  → `{ id, media_type, name, title, release_date, first_air_date, poster_path }`.
  Fuzzy path = `fetch(${TMDB_API_BASE}/search/{movie|multi}?query=)` →
  filter non-person → theme filter (`themesSystem.matchesTheme`) → `levenshtein`
  sort → top 5. `levenshtein` is a private fn in matchSystem.js.
- **`enrichWithCredits`**: per-candidate `getOrFetchCredits`; its own
  `try/catch` returns `{cast:[]}` on error (→ no-connection → eliminate).
- **`getOrFetchCredits`** (`redisUtils.js:126-192`): Redis cache-hit fast path;
  NX stampede lock; on miss fetches `${TMDB}/{type}/{id}/credits` (or tv
  `aggregate_credits`); `!ok` → drain body → **throw**; success → strip to
  `{cast:[{id,name}]}` → `pubClient.set(..., {EX:604800})` (7-day) → return.
- **Precedent — `scripts/build-daily-movies.js`**: committed one-time generator;
  `require('dotenv').config()`; `process.env.TMDB_READ_TOKEN`; headers
  `{Authorization:'Bearer …', accept:'application/json'}`; sources ids from
  `/movie/top_rated` then `/movie/popular`; unions existing entries; sorts by id
  (byte-stable); writes `JSON.stringify(list,null,2)+'\n'`; exits non-zero if it
  can't reach target. `npm run build:daily-movies`. Runtime never runs it;
  `dailySystem` does a static `readFileSync` with a missing-file fallback.
- `data/dailyMovies.json` = 553 `{id,title,year,mediaType:"movie"}` (no cast).

---

## 4. Architecture

Four units, each with one responsibility:

**(a) `data/fallbackMovies.json`** — committed dataset. Curated set =
the union of the existing 553 `dailyMovies.json` ids (already valid, popular,
by-construction) **extended** via TMDB `top_rated`/`popular` to a target of
**~1000** movies. Each entry: `{ id, title, year, mediaType:"movie",
cast:[{id,name}] }`, `cast` = top ~20 billed (validation only needs
shared-actor detection; `commitPlay` already trims displayed cast to 30).
Estimated size ~1–1.5 MB committed JSON — static, gzips well, loaded once.

**(b) `scripts/build-fallback-movies.js`** — new committed one-time generator,
structurally identical to `build-daily-movies.js`: same `dotenv` +
`TMDB_READ_TOKEN` + headers; sources the id set (union of current
`dailyMovies.json` ids + `top_rated`/`popular` pages until ~1000 unique); for
each id fetches `/movie/{id}` (title/year) and `/movie/{id}/credits` (cast,
sliced to top ~20, stripped to `{id,name}` — the exact shape
`getOrFetchCredits` returns); sorts by id (byte-stable); writes
`JSON.stringify(list,null,2)+'\n'`; exits non-zero if it can't reach target.
`npm run build:fallback-movies`. Runtime never runs it.

**(c) `server/systems/fallbackMovies.js`** — read-once-cached loader (mirrors
`dailySystem`'s static read posture): on first use, `readFileSync` + parse;
missing/corrupt/non-array → empty structures (never throws, never blocks boot).
Exposes:
- `getFallbackById(id)` → the entry `{id,title,year,mediaType,cast}` or `null`.
- `allFallback()` → the array (so the fuzzy-search fallback can run its own
  `levenshtein` over titles, reusing matchSystem's existing helper rather than
  exporting it; keeps title-matching co-located with the existing fuzzy logic).

**(d) Failure-only fallback branches:**
- **`resolveCandidates`** (matchSystem.js): wrap the direct-ID details fetch and
  the fuzzy search fetch. On throw/`!ok`: direct → `getFallbackById(tmdbId)`;
  fuzzy → `levenshtein`-rank `allFallback()` titles (apply the same
  `themesSystem.matchesTheme` filter the live path applies, for consistency),
  take top ~5. Synthesize candidate objects in the **same shape** the live path
  produces (`{ id, media_type:'movie', title, release_date:`${year}-01-01`,
  poster_path:null }`) so downstream code is shape-agnostic.
- **`getOrFetchCredits`** (redisUtils.js): on `!ok`/timeout, **before throwing**,
  `getFallbackById(tmdbId)`; if present return `{cast: entry.cast}`. **Do NOT
  write the fallback into the Redis 7-day cache** (so once TMDB recovers the
  next miss re-fetches and caches fresh, full credits — never a week of
  trimmed/stale fallback). If absent → throw exactly as today.

A movie in the dataset therefore survives an outage end-to-end: resolve yields
its id+title, credits yields its cast, `validateChainConnection` works → no
elimination.

---

## 5. Safety Invariants (the load-bearing guarantees)

1. **Failure-only.** The fallback is consulted **exclusively** in the
   TMDB-failure branches. The Redis cache-hit path and the successful-fetch
   path in `getOrFetchCredits`, and the successful-fetch paths in
   `resolveCandidates`, are **byte-unchanged**. (Provable via `git diff`:
   additions are new catch/`!ok` branches only.)
2. **Healthy TMDB always wins.** When TMDB responds, live data is used; the
   fallback can never make a healthy game wrong or stale.
3. **Zero game-rule change.** A movie *not* in the dataset during an outage
   keeps today's exact behavior (eliminate — "API Error or Timeout!" /
   "Invalid movie connection"). No "softer no-penalty" path. Behavior is
   identical to today whenever TMDB is healthy OR the movie is uncovered.
4. **Immutable snapshot.** The dataset is point-in-time facts that don't change
   (a released film's title/year/cast are fixed). Regenerable and byte-stable
   like `dailyMovies.json`; staleness risk is negligible (unlike "popular",
   which churns — but the fallback is only ever consulted on failure).
5. **No boot risk.** The loader is lazy/guarded (missing/corrupt file → empty →
   the fallback simply never matches → exact current behavior). The generator
   is dev-only and never runs at boot.

---

## 6. Error Handling

- Generator: missing `TMDB_READ_TOKEN` → print + `process.exit(1)` (mirrors
  `build-daily-movies.js`); can't reach target after retries → exit non-zero
  (don't write a short file). TMDB page error → warn + continue (best-effort).
- Loader: any read/parse failure → empty map/array, logged once, never throws.
- Runtime fallback miss (TMDB down + id/title not in dataset) → the existing
  throw/eliminate path, unchanged.
- The fallback path performs **no network and no Redis write** — it is pure
  in-memory lookup, so it cannot itself fail or stall the submit lock.

---

## 7. Testing Strategy

Automated (Jest; server project mocks `redisUtils`/`global.fetch` per existing
patterns):

1. **Data-file structural test** (`server/systems/fallbackMovies.data.test.js`,
   no network): file parses, ≥ a floor count of entries, every entry has
   `{id,title,year,mediaType:'movie'}` and a non-empty `cast` of `{id,name}`,
   no duplicate ids, all 553 daily ids present.
2. **Loader unit tests:** `getFallbackById` hit/miss; `allFallback` shape;
   missing/corrupt file → empty (no throw).
3. **`getOrFetchCredits` fallback branch:** TMDB `!ok` + id in dataset → returns
   `{cast}` from local data AND does **not** call `pubClient.set` (no cache
   poisoning); TMDB `!ok` + id absent → throws as today; healthy fetch →
   unchanged (still caches, fallback never consulted).
4. **`resolveCandidates` fallback branches:** direct-ID fetch throws + id in
   dataset → returns the synthesized candidate; fuzzy fetch throws + title in
   dataset → returns `levenshtein`-ranked local candidate(s); fetch throws +
   not in dataset → empty (→ existing eliminate); healthy fetch → unchanged.
5. **Integration:** simulated TMDB outage — submit of a covered movie does
   **not** eliminate (chain grows); submit of an uncovered movie still
   eliminates (behavior unchanged); bot move (direct-ID, covered) survives.

Full `npm test` stays green; coverage ratchet floors hold.

**Manual / outstanding (suite mocks Redis/TMDB; no real boot or real outage):**
after the user merges, confirm the Render deploy is `live`, and a real
TMDB-failure simulation (e.g., temporarily bad token / blocked host in a
non-prod check) shows a covered-movie submit surviving. Flagged in the PR body.

---

## 8. Files (approximate — the plan pins exact line targets)

**Create:** `data/fallbackMovies.json`, `scripts/build-fallback-movies.js`,
`server/systems/fallbackMovies.js`, `server/systems/fallbackMovies.data.test.js`,
`server/systems/fallbackMovies.test.js` (loader),
`server/systems/matchSystem.fallback.test.js` (resolve branches),
`server/redisUtils.fallbackcredits.test.js` (credits branch).
**Modify:** `server/systems/matchSystem.js` (resolveCandidates fallback
branches), `server/redisUtils.js` (`getOrFetchCredits` fallback branch),
`package.json` (`build:fallback-movies` script).

Exact insertion points and the loader interface are decisions for the plan
after reading current code.

---

## 9. Process Notes

Ships via the validated pipeline (Phases 1–5a): **spec → writing-plans →
subagent-driven-development → finishing-a-development-branch**.

- Spec committed to `main` locally (this doc). Plan + co-located
  `.md.tasks.json` likewise committed to `main`, then a **feature branch
  `phase5b-fallback-movie-db` off current `main`** (`4e1372b`) — not a worktree,
  not stacked. **PR #19 is already merged**, so there is **no overlap concern**;
  `resolveCandidates` and `getOrFetchCredits` are untouched by #18/#19's
  changes.
- Native Task tools unavailable → TodoWrite + hand-authored `.md.tasks.json`;
  a task is `completed` only after **both** per-task reviews pass.
- Per task: implementer with full task text + exact code → independent
  spec-compliance review → independent code-quality review → fix-loop → commit
  → sync `.tasks.json`. WHY-comments on every changed line.
- Out-of-scope findings → session spawn_task chip, not scope creep.
- `coverage/` stays untracked.
- Final **opus whole-branch holistic review**, then push + `gh pr create`
  (base `main`). The PR-merge / push-to-main / Render deploy is
  classifier-gated and **handed to the user**. PR body flags the outstanding
  real-boot + TMDB-outage-simulation verification.
- This is the **last** phase: once 5b is merged + deployed + verified, the
  full 5-phase post-2026-05-16 remediation is complete.
