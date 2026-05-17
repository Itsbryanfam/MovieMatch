# MovieMatch Phase 4 — Content & Polish (Design Spec)

**Date:** 2026-05-17
**Phase:** 4 of 5 (post-2026-05-16 full-codebase-review remediation)
**Status:** Approved design — ready for implementation planning
**Branch strategy:** spec + plan + `.tasks.json` commit to `main` first; implementation on feature branch `phase4-content-polish` (NOT a worktree), branched off current `main` (which already contains Phases 1+2+3 + boot hotfix + #14 follow-ups, all deployed & verified `live`).

---

## Goal

Ship the 5 "content & polish" items from the 2026-05-16 review as one branch. Each is an **independent, low-risk change**. The site is live and real-time (Socket.io); apply the same provable-safety discipline used in Phase 3 — no behaviour regressions, and the two visually/operationally sensitive items (service worker, `.btn`) carry explicit zero-regression invariants.

## Scope (exactly these 5; nothing else)

1. `.gitignore` `coverage/`
2. Daily movie list 50 → ~500 titles
3. PWA manifest `icons`
4. Service worker
5. `.btn` base CSS class

Ordered below by ascending risk so the riskiest land last and isolated.

---

## Task 1 — gitignore `coverage/`

**Current:** `.gitignore` contains exactly `node_modules`, `.env`, `.DS_Store`. Jest writes `coverage/` (currently untracked working-tree clutter).

**Change:** Append `coverage/` to `.gitignore`.

**Safety / invariant:**
- Precondition check (must be in the plan): `git ls-files coverage/` returns empty — confirm nothing under `coverage/` is already tracked before ignoring. (It is untracked; this has been deliberately maintained since Phase 2.)
- Never `git add coverage/` at any point in this phase.

**Files:** `.gitignore` (modify).

**Verification:** `git status --porcelain` no longer lists `coverage/`; `git check-ignore coverage/` succeeds. No test (pure repo hygiene).

---

## Task 2 — Daily movie list 50 → ~500

**Current:** `data/dailyMovies.json` is a 50-element array of `{ id, title, year, mediaType }`. `server/systems/dailySystem.js` `_loadMovieList()` (≈line 41) reads it once at boot via `fs.readFileSync`; `pickDailyMovie()` selects `list[_hashDate(date) % list.length]`. **`id` is a real TMDB id** — the daily seed is fed into `gameLogic.validateConnection` + the TMDB credits cache, so an invalid id silently yields a broken, unsolvable daily puzzle on a deterministic calendar date.

**Change — generate, do not hand-write:**
- Add a committed one-time generator `scripts/build-daily-movies.js` (Node, repo-local, not wired into boot or `package.json` scripts beyond an optional `npm run build:daily-movies`).
  - Reads the **same TMDB API credentials the server already uses** — the plan MUST pin the exact env var name and request style by reading the existing TMDB fetch in `server/gameLogic.js` (do not invent a new env var).
  - Pulls TMDB top-rated (and, if needed to reach the target, popular) movies, paginated, until ≥ 500 unique entries are collected.
  - Maps each TMDB result → `{ id, title, year, mediaType: "movie" }` where `year` is the 4-digit year parsed from `release_date` (skip entries with no parseable year or empty title).
  - **Unions with the existing 50 curated entries** (dedupe by `id`) so the current hand-picked favorites remain guaranteed-present.
  - Writes pretty-printed JSON (2-space, trailing newline) to `data/dailyMovies.json`, sorted deterministically (e.g., by id ascending) so re-runs produce stable diffs.
- The implementer runs the generator once; the regenerated `data/dailyMovies.json` is committed. **Runtime code path is unchanged** (still a static `readFileSync`). `mediaType` is `"movie"` for all generated entries (TV is out of scope here).
- Update the now-stale comments: `dailySystem.js` `_loadMovieList()` "(<10KB)" size note, and the `dailySystem.test.js` "(the curated list is ~50 entries…)" comment in the distinctness test.

**Safety / invariant — ids valid by construction:** every generated id comes directly from a TMDB API response, so it is a real TMDB id with cast data. No hallucinated ids.

**Files:**
- Create: `scripts/build-daily-movies.js`
- Modify (regenerated output): `data/dailyMovies.json`
- Modify (stale comment): `server/systems/dailySystem.js`
- Modify (stale comment): `server/systems/dailySystem.test.js`
- Create test: `server/systems/dailyMovies.data.test.js`

**Tests / verification:**
- New `dailyMovies.data.test.js` structural-integrity test (no network): file parses; is an array of length ≥ 450; every entry has `typeof id === 'number'` (positive integer), non-empty string `title`, integer `year` in a sane range (e.g. 1900 ≤ year ≤ currentYear+1), `mediaType` ∈ {`movie`,`tv`}; **no duplicate ids**; the original 50 curated ids are all still present (subset assertion).
- Existing `dailySystem.test.js` determinism + distinctness tests must stay green unchanged (larger N only strengthens the distinctness check; no test asserts list length or specific titles).
- `npm test` green; coverage ratchet floors held.

---

## Task 3 — PWA manifest icons

**Current:** `public/manifest.json` has no `icons` key (no installable app icon). Only image asset is `public/og-image.png` (1200×630 OG card — wrong shape for an icon). `index.html` links the manifest but has no `icon`/`apple-touch-icon`.

**Change (SVG-only — the approved call):**
- Create `public/icon.svg`: a simple, self-contained brand mark (no external refs/fonts) — dark `#09090b` background (matches `theme_color`) with the app's accent color foreground (the plan MUST read the exact accent hex from the `:root` custom properties in `public/css/01-base.css`; do not guess). A square viewBox, legible at small sizes, safe-area-friendly for `maskable`.
- `manifest.json`: add
  ```json
  "icons": [
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
  ```
- `index.html`: add next to the existing `<link rel="manifest">` —
  `<link rel="icon" href="/icon.svg" type="image/svg+xml">` and
  `<link rel="apple-touch-icon" href="/icon.svg">`.

**Known limitation (explicitly accepted, documented as a follow-up, NOT done here):** iOS "Add to Home Screen" renders best from a PNG `apple-touch-icon`; SVG-only gives weaker iOS icon fidelity. Fixing the review item's actual gap (Android/desktop installability) does not require PNGs; a generated PNG set + `sharp` is deliberately out of scope (YAGNI for a polish phase).

**Files:** create `public/icon.svg`; modify `public/manifest.json`, `public/index.html`; create test `server/manifest.data.test.js`.

**Tests / verification:** `server/manifest.data.test.js` (plain node, mirrors Task 2's `dailyMovies.data.test.js` pattern — no jsdom needed): `manifest.json` parses; `icons` is a non-empty array; every entry has a string `src` and `type`; at least one entry references `/icon.svg`; and `public/icon.svg` exists and is non-empty. Manual: manifest passes a PWA validator; icon renders on an Android install prompt. `npm test` green.

---

## Task 4 — Service worker (highest blast radius)

**Current:** none. This is the first SW on a live real-time site — a misconfigured SW can persistently serve stale HTML/JS/CSS and is hard to recover from.

**Change — deliberately conservative:**
- Create `public/sw.js` (classic service worker).
- Routing rules (a request is handled by exactly one):
  - **Hard bypass** (do not call `respondWith`; let it hit network normally): any of — `request.method !== 'GET'`; cross-origin (`new URL(request.url).origin !== self.location.origin`); path starts with `/socket.io`; WebSocket upgrade. This guarantees the SW never touches gameplay/transport or TMDB image/font CDNs.
  - **Navigations** (`request.mode === 'navigate'`): **network-first**, fall back to the cached shell only when the network fails (offline). Never serve a stale document while online → deploys are picked up immediately.
  - **Same-origin static GET** (css/js/svg/png/manifest): **network-first with cache fallback** (cache updated on each successful fetch). Safest "first SW" posture — offline resilience without post-deploy staleness.
- Cache name is versioned (e.g. `mm-cache-v1`). `activate` deletes all caches not matching the current version. **No `skipWaiting()`** (never hot-swap assets under a live player); `clients.claim()` in `activate` is permitted (only adopts currently-uncontrolled clients).
- `install` may pre-cache a minimal shell (`/`, `/index.html`) so first offline load works; keep the precache list tiny and explicit.
- Register in `public/js/app.js`, guarded by `if ('serviceWorker' in navigator)`, after load, with a `.catch` that logs and does nothing (registration failure must never break the app).
- **Testability:** the routing decision must be a pure function in a standalone file `public/sw-routing.js` exposing e.g. `swDecision({ method, url, mode, origin })` → `'bypass' | 'network-first'`. `sw.js` loads it via `importScripts('/sw-routing.js')`; the `client-tests/` jsdom suite `require`s the same file directly. Single source of truth — no duplicated logic.

**Safety / invariants:**
- SW never intercepts `/socket.io`, websockets, non-GET, or cross-origin.
- No `skipWaiting` → no mid-game asset swap.
- Network-first for documents → a future bad deploy cannot get "stuck" behind a stale cached shell while the user is online.
- Registration failure is swallowed.

**Files:** create `public/sw.js`, `public/sw-routing.js`; modify `public/js/app.js`; create `client-tests/sw-routing.test.js`.

**Tests / verification:** `sw-routing.test.js` exhaustively covers the decision table: socket.io path → bypass; POST → bypass; cross-origin (TMDB image host, Google Fonts) → bypass; navigate → network-first; same-origin `.css`/`.js`/`.svg` GET → network-first. `npm test` green; coverage floors held. Manual: load site, confirm SW registers, app works online; DevTools offline → shell still loads; gameplay (socket) unaffected with SW active.

---

## Task 5 — `.btn` base CSS class (zero-visual-change)

**Current:** button styling is spread across all 6 `public/css/` partials: `.btn-primary` (`02-hero-lobby.css:513`), `.btn-secondary` (`:539`), `.btn-icon` (`03-game.css:306`), `.nav-link-btn` (`04-modals.css:129`), `.btn-join-team` (`02:400`), `.reaction-btn` (`04:77`), `.mode-chip` (`02:266`), `.spec-pred-btn` (`06:715`), `.modal-close` (`04:192`), plus responsive (`05`) and hover/state (`06`) overrides. There is no shared base.

**Change — additive base only (the approved call):**
- Add a single `.btn` rule in `public/css/01-base.css` (earliest partial, so any variant in a later partial can still override it; specificity of existing single-class variant selectors equals `.btn`, and source order puts variants after → variants win on any shared property, so the cascade is preserved).
- `.btn` carries **only safely-shared, non-conflicting declarations** — declarations that are either already identical across every existing variant (so adding them to a shared base changes nothing) or are inert/visual-no-op additions. Candidate set (final set decided per-variant audit by the reviewer): `box-sizing: border-box`, `cursor: pointer`, `font: inherit` / `font-family: inherit` (only if already effectively inherited), `-webkit-tap-highlight-color: transparent`, a `:focus-visible` ring consistent with existing focus styling, `appearance: none` for `<button>` reset only if it does not alter any current rendering, disabled affordance only if identical to existing. **No `padding`, `color`, `background`, `border`, `border-radius`, `font-size` is moved into `.btn`** — those differ per variant and must remain on the variants untouched.
- **Additive, not subtractive:** do NOT delete any declaration from any existing variant rule. Variants are left byte-identical; `.btn` only adds a shared baseline. This makes zero-visual-change provable: existing variant rules are unchanged and still win every property they set; `.btn` only contributes properties no variant overrides (and that were already uniform or are visual no-ops).
- Apply `class="btn <existing-variant>"` to every button: in `index.html` (all `<button>` / button-styled elements) **and** every button created in JS — the plan MUST enumerate JS-built buttons by reading `public/js/ui/*.js` (e.g. `ui-panels.js` replay entries, `ui-render.js` dynamic player/lobby lists, `ui-notifications.js`, share-card actions) so none is missed.

**Safety / invariant — provable zero visual change:**
- Variant rule blocks are unchanged (diff shows only added `btn` tokens in markup + one new `.btn` block).
- Every property `.btn` sets is either (a) already set identically by every button's variant/inherited chain, or (b) a documented visual no-op. The per-task code-quality review performs a per-variant declaration audit (Phase-3 model); the final opus holistic review re-verifies no rendered button changed.
- Existing `client-tests/` suite stays green unchanged.

**Files:** modify `public/css/01-base.css`, `public/index.html`, and the JS modules under `public/js/ui/` that construct buttons.

**Tests / verification:** existing `client-tests/` green unchanged; reviewer per-variant declaration audit; manual visual smoke of hero/lobby/game/modals/team/daily screens (buttons pixel-unchanged); final holistic review. `npm test` green; coverage floors held.

---

## Out of scope (do NOT do in Phase 4)

- PNG icon set / `sharp` / icon-generation build step (iOS PNG fidelity is a noted follow-up).
- Full lossless extraction of per-variant button declarations into `.btn` (only the additive base).
- Any change to daily-game behaviour, the seed algorithm, TV-show seeds, or the leaderboard.
- SW offline page UX, push, background sync, precaching beyond the minimal shell.
- Any unrelated refactor surfaced while working — flag via the session `spawn_task` chip; do not expand scope (Phase 3 precedent).

## Process (validated pipeline — feedback_phase_execution_workflow.md)

- Pipeline: this spec → `writing-plans` (plan + co-located hand-authored `.tasks.json`, both committed to `main` first) → `subagent-driven-development` (fresh implementer per task; per-task INDEPENDENT spec-compliance review THEN INDEPENDENT code-quality review; fix-loop until both pass; sync `.tasks.json` status) → final whole-branch **opus holistic review** → `finishing-a-development-branch` (push `phase4-content-polish`, `gh pr create` base `main`).
- Native Task tools unavailable → TodoWrite in-session + hand-authored `.tasks.json`.
- Every changed line carries a WHY comment (feedback_code_comments.md).
- `coverage/` is never staged.
- The PR-merge / push-to-`main` / Render production deploy is classifier-gated and **handed to the user** (feedback_deploy_authorization.md) — do not merge. Tasks 2 & 4 touch boot-adjacent / new-runtime-asset code, so after the user merges, real-boot + SW behaviour must be verified on the live Render deploy (not just the green suite); "merged" ≠ "deployed".
- Suggested task order: 1 (gitignore) → 2 (daily list) → 3 (icons) → 4 (service worker) → 5 (`.btn`).
