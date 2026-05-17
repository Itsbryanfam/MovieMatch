# Phase 3 — Maintainability Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break the two god-files (`ui.js` 1734 ln, `style.css` 3553 ln) into focused modules, centralise screen-switching behind one helper, and de-duplicate the server player-cap — with provably **zero behaviour and zero visual change**.

**Architecture:** Four sequential, independently-revertable workstreams ordered lowest-risk-first: (1) `server/constants.js` literal→named [server-Jest-covered → instant proof]; (2) `ui.js` → barrel re-exporting 6 domain modules [proven by the existing `client-tests/` jsdom suite staying green]; (3) `style.css` → 6 ordered partials whose concatenation is byte-identical to the original; (4) `showScreen()` helper [the only logic change, done last] pinned by a new `client-tests/` jsdom spec.

**Tech Stack:** Node CommonJS server (`"type":"commonjs"`); ES-module browser client loaded via one `<script type="module" src="js/app.js">`; Jest 30 two-project config (`server` = node env, `client` = jsdom + babel-jest); no bundler, no build step.

**Source spec:** `docs/superpowers/specs/2026-05-17-maintainability-refactor-design.md`

---

## Process (applies to every task — bake into each implementer prompt)

- **Branch:** all implementation commits on `phase3-maintainability` (a plain feature branch off `main`, **NOT** a worktree). This plan + its `.tasks.json` are committed to `main` first, then the branch is cut.
- **Comments:** every changed/added line gets a WHY-comment (per `memory/feedback_code_comments.md`) — explain intent/invariant, not the obvious.
- **Per-task review:** after the implementer finishes, run an **independent spec-compliance review**, THEN an **independent code-quality review** (separate subagents, as in Phases 1–2). Fix loop until both pass. Only then mark the task `completed` in `.tasks.json` and bump `lastUpdated`. Final whole-branch holistic review before the PR.
- **Never stage `coverage/`** (untracked; Phase 4 item). Stage explicit paths only.
- **No new dependency**, no `package.json` script changes, no build pipeline.
- **Test commands:** `npm test` runs both Jest projects. Server-only: `npm test -- --selectProjects server`. Client-only: `npm test -- --selectProjects client`. Coverage gate: `npm test -- --coverage --runInBand` must keep stmts 63 / branches 52 / funcs 62 / lines 69 (`collectCoverageFrom` is `server/**` only).

---

### Task 1: `server/constants.js` — de-duplicate the player cap

**Goal:** Replace the duplicated literal `8` (max players per lobby) with a single named constant; existing server tests prove losslessness.

**Files:**
- Create: `server/constants.js`
- Modify: `server/systems/lobbySystem.js` (require + lines 98–101, 118, 570)
- Modify: `server/gameLogic.js` (require + lines 344–345)

**Acceptance Criteria:**
- [ ] `server/constants.js` exports `MAX_PLAYERS_PER_LOBBY = 8`.
- [ ] All four real cap sites use the constant; the full-lobby error string is byte-identical (`"Lobby is full (8 player maximum)."`).
- [ ] The unrelated `8`s are **untouched**: `socketHandlers.js:32` `submitMovie limit:8`, `:48/:51` typing limit, `:357` `emoji.length > 8`, `matchSystem.js:25/:325` comments.
- [ ] `npm test` fully green; `--coverage` still meets the ratchet floor.

**Verify:** `npm test -- --selectProjects server` → all suites pass; then `grep -nE "players\.length (>=|<) 8|\(8 player" server/systems/lobbySystem.js server/gameLogic.js` → **no matches** (all replaced).

**Steps:**

- [ ] **Step 1: Create `server/constants.js`**

```javascript
// server/constants.js
//
// Shared server-side constants. WHY: values duplicated across modules
// drift when one site is changed and the others are missed (the
// 2026-05-16 review flagged the 8-player cap living in two files with
// only a hand-written "same value used here" comment to keep them in
// sync). One source of truth removes that whole bug class.
//
// Scope (YAGNI): ONLY values genuinely duplicated across 2+ source
// files with identical meaning belong here. Timer values were reviewed
// and deliberately left out — they are either single-file named consts
// (RECONNECT_GRACE_MS in lobbySystem, TMDB/MUTEX in redisUtils) or the
// same number with *different* meaning (speed-turn 15000 vs grace
// 15000), which must NOT be collapsed.

// Hard maximum players in a single lobby. Enforced at join time
// (lobbySystem.joinLobby), used to size spectator promotion
// (gameLogic.promoteSpectators) and to filter the public-lobby list.
const MAX_PLAYERS_PER_LOBBY = 8;

module.exports = { MAX_PLAYERS_PER_LOBBY };
```

- [ ] **Step 2: Run the suite to capture the green baseline**

Run: `npm test -- --selectProjects server`
Expected: PASS (this is the pre-change baseline; the refactor must keep it identical).

- [ ] **Step 3: `server/systems/lobbySystem.js` — add the require**

Find the existing require block near the top (it already has `const redisUtils = require('../redisUtils');` etc.). Add, alongside them:

```javascript
// Player hard-cap constant (single source of truth — see server/constants.js).
const { MAX_PLAYERS_PER_LOBBY } = require('../constants');
```

- [ ] **Step 4: `server/systems/lobbySystem.js` — substitute the three sites**

Lines 98–101 currently:
```javascript
    // 8-player hard cap. (A brand-new lobby has 0 players, so this never
    // wrongly rejects the creator — the old !isNewLobby guard was just an
    // optimization for that always-false case.)
    if (r.players.length >= 8) { outcome = 'full'; return false; }
```
Replace with:
```javascript
    // Player hard cap (MAX_PLAYERS_PER_LOBBY). A brand-new lobby has 0
    // players, so this never wrongly rejects the creator — the old
    // !isNewLobby guard was just an optimization for that always-false case.
    if (r.players.length >= MAX_PLAYERS_PER_LOBBY) { outcome = 'full'; return false; }
```

Line 118 currently:
```javascript
    return socket.emit('error', 'Lobby is full (8 player maximum).');
```
Replace with (template literal keeps the message byte-identical when the cap is 8):
```javascript
    // Interpolate the constant so the user-facing copy can never drift
    // from the enforced cap. Renders identically: "Lobby is full (8 player maximum)."
    return socket.emit('error', `Lobby is full (${MAX_PLAYERS_PER_LOBBY} player maximum).`);
```

Line 570 currently:
```javascript
  const publicList = all.filter(r => r.status === 'waiting' && r.isPublic && r.players.length < 8).map(room => {
```
Replace with:
```javascript
  // Only surface lobbies with a free slot (same cap as joinLobby).
  const publicList = all.filter(r => r.status === 'waiting' && r.isPublic && r.players.length < MAX_PLAYERS_PER_LOBBY).map(room => {
```

- [ ] **Step 5: `server/gameLogic.js` — add the require**

Alongside the existing top requires (`const redisUtils = require('./redisUtils');` …) add:
```javascript
// Player hard-cap constant (single source of truth — see server/constants.js).
const { MAX_PLAYERS_PER_LOBBY } = require('./constants');
```

- [ ] **Step 6: `server/gameLogic.js` — substitute lines 344–345**

Currently:
```javascript
  // 8-player hard cap defined in joinLobby; same value used here.
  const slotsAvailable = 8 - state.players.length;
```
Replace with:
```javascript
  // Same hard cap enforced in lobbySystem.joinLobby — now a shared
  // constant so the two can no longer silently disagree.
  const slotsAvailable = MAX_PLAYERS_PER_LOBBY - state.players.length;
```

- [ ] **Step 7: Verify losslessness**

Run: `npm test -- --selectProjects server`
Expected: PASS, identical suite result to Step 2 (these paths are covered by `lobby-lock.test.js`, `integration.test.js`, `batch2.test.js`, `socket.integration.test.js`).
Run: `npm test -- --coverage --runInBand`
Expected: thresholds still met.
Run: `grep -nE "players\.length (>=|<) 8|\(8 player" server/systems/lobbySystem.js server/gameLogic.js`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add server/constants.js server/systems/lobbySystem.js server/gameLogic.js
git commit -m "Phase 3 (C): extract MAX_PLAYERS_PER_LOBBY to server/constants.js"
```

---

### Task 2: split `public/js/ui.js` into a barrel + 6 domain modules

**Goal:** Move `ui.js`'s sections into focused ES modules under `public/js/ui/`; rewrite `ui.js` as a re-export-only barrel so every importer is byte-unchanged. Proven lossless by the existing `client-tests/` jsdom suite (which imports `./ui.js`) staying 100% green with **zero test edits**.

**Files:**
- Create: `public/js/ui/ui-dom.js`, `public/js/ui/ui-render.js`, `public/js/ui/ui-notifications.js`, `public/js/ui/ui-autocomplete.js`, `public/js/ui/ui-sharecard.js`, `public/js/ui/ui-panels.js`
- Rewrite: `public/js/ui.js` (→ barrel)
- **Do NOT edit:** `public/js/app.js`, `public/js/socketClient.js`, any `client-tests/*` file

**Module boundary map** (verbatim moves; line numbers are current `main:public/js/ui.js`; cut at the symbol boundary, never mid-symbol — keep each symbol's existing comments):

| Module | Symbols (source lines) |
|---|---|
| `ui/ui-dom.js` | header note; `MODE_DESCRIPTIONS` (8); the full `export let` DOM-ref block (16–29); `initUIElements` (32–104) |
| `ui/ui-render.js` | `renderLobby` (105), `renderTeamScreen` (205), `renderGame` (246), `renderPlayerSidebar` (257), `attachPosterFallback` (327), `renderChainItems` (338), `_renderSpectatorPredictionBar` (452), `_hideSpectatorPredictionBar` (474), `_renderActiveThemeBadge` (484), `renderTurnControls` (500–637); plus `resetMobileTab` (1657), `showGameOverBanner` (1671–1734) |
| `ui/ui-notifications.js` | `notificationTimeout` (638), `showNotification` (639), `showEliminationFlash` (653), `showSelfEliminationScreen` (671), `showWinFlash` (777), `showConfetti` (794); ghost block `ghostAttemptTimer`/`showGhostAttempt`/`clearGhostAttempt` (840–891); plus `showToast` (1625–1633) |
| `ui/ui-autocomplete.js` | `renderAutocompleteResults` (892), `closeMobileAc` (985–992) |
| `ui/ui-sharecard.js` | `generateShareCard` (993), `truncate` (1148), `roundRect` (1153), `scoreChainEntry` (1167), `selectChainEntries` (1198–1216); plus `openShareModal` (1634), `buildTextRecap` (1644–1656) |
| `ui/ui-panels.js` | replay block `MAX_REPLAY_ENTRIES`/`REPLAY_STEP_MS`/`playChainReplay`/`_buildReplayEntry` (1230–1337); stats `MODE_LABELS`/`renderMyStats` (1347–1476); daily `renderDailyResult` (1485–1624) |

**Acceptance Criteria:**
- [ ] Every symbol `export`ed by pre-refactor `ui.js` is still importable from `public/js/ui.js`.
- [ ] `public/js/ui.js` contains only re-export statements + a header comment.
- [ ] `app.js`, `socketClient.js`, and all `client-tests/*` are unmodified (`git diff --stat` shows none of them).
- [ ] Existing `client-tests/` jsdom suite passes 100%, unchanged.
- [ ] No new dependency; all new imports are relative ESM.

**Verify:**
1. `diff <(git show main:public/js/ui.js | grep -oE '^export (const|let|function|class) [A-Za-z_]+|^export \{' ) <(grep -oE 'export (const|let|function|class) [A-Za-z_]+|export \{|export \* from' public/js/ui.js)` → every old exported name is re-exported (manual superset check; document the comparison in task notes).
2. `npm test -- --selectProjects client` → all of `ghost-attempt`, `poster-fallback`, `render-chain`, `render-lobby`, `socket-handlers`, `tutorial-trigger` PASS.
3. `git diff --stat main -- public/js/app.js public/js/socketClient.js client-tests/` → empty.
4. Browser smoke (dev server): hero → lobby → start game → submit a movie → open share card → open My Stats → open Daily result. All render identically.

**Steps:**

- [ ] **Step 1: Baseline the client suite**

Run: `npm test -- --selectProjects client`
Expected: PASS (this exact result must hold after the split).

- [ ] **Step 2: Create the 6 modules by moving sections verbatim**

For each row of the boundary map: create the file, paste the listed symbols **verbatim including their existing comments**, and add a one-line top-of-file WHY-comment, e.g. for `ui-dom.js`:
```javascript
// ui/ui-dom.js — cached DOM element references + initUIElements().
// WHY: every other ui-* module imports these live bindings from here,
// so the screen/element refs have exactly one owner (initUIElements
// assigns them once; ES-module live bindings propagate the assignment).
```
Each module `export`s the same names the symbols had in the monolith (they were already `export`ed — keep the `export` keyword on each moved declaration).

- [ ] **Step 3: Wire intra-module imports**

Any symbol that references a symbol now in a sibling module must `import` it. The dependency rule:
- `ui-dom.js` imports nothing from siblings (it is the base).
- Every other module that touches a DOM ref (`gameScreen`, `chainDisplay`, …) or `MODE_DESCRIPTIONS` adds at top: `import { <names used> } from './ui-dom.js';` (live bindings — values are valid after `initUIElements()` runs, exactly as before).
- Cross-feature calls (e.g. `ui-render.js` calling `showNotification`, or `ui-panels.js` calling `playChainReplay` from within the same module) — import from the owning module by its map row. Resolve each undefined reference the JS engine/test would hit; the client suite (Step 5) is the catch-all.
- WHY-comment each new `import` line stating which feature needs it.

- [ ] **Step 4: Rewrite `public/js/ui.js` as the barrel**

Replace the entire file with only:
```javascript
// ui.js — barrel. WHY: ui.js grew to 1734 lines; it is now split into
// focused public/js/ui/* modules. This barrel re-exports every prior
// symbol so existing importers (app.js, socketClient.js, client-tests/*)
// keep `import { … } from './ui.js'` working byte-for-byte — the split
// is a pure internal reorganisation with zero consumer changes.
export * from './ui/ui-dom.js';
export * from './ui/ui-render.js';
export * from './ui/ui-notifications.js';
export * from './ui/ui-autocomplete.js';
export * from './ui/ui-sharecard.js';
export * from './ui/ui-panels.js';
```
If the superset check (Verify #1) reveals any name collision across modules (none expected — all symbols are uniquely named today), replace the colliding `export *` with explicit `export { a, b } from './ui/...';` lines covering exactly the old export set.

- [ ] **Step 5: Verify losslessness**

Run Verify #1, #2, #3 above. All must pass with zero edits to consumers/tests. If a client test fails, the wiring in Step 3 is incomplete — fix the missing import; do **not** edit the test.

- [ ] **Step 6: Browser smoke** (Verify #4) — record the flow walked.

- [ ] **Step 7: Commit**

```bash
git add public/js/ui.js public/js/ui/
git commit -m "Phase 3 (A): split ui.js into ui/* modules behind a re-export barrel"
```

---

### Task 3: split `public/style.css` into 6 ordered partials

**Goal:** Cut `style.css` into 6 partials whose concatenation in `<link>` order is **byte-identical** to the original; load them in original cascade order from `index.html`.

**Files:**
- Create: `public/css/01-base.css` … `public/css/06-states-anim.css`
- Modify: `public/index.html` (the single `<link rel="stylesheet" href="style.css?v=1.3">`, ~line 61)
- Delete: `public/style.css` (only after the byte-identity gate passes)

**Cut rule:** split **only at top-level section-banner comment boundaries** (`/* ===…` / `/* ---…` at column 0, on a blank-line boundary). Never split inside a rule, `@media`, or `@keyframes` block. Content is moved **verbatim** — no reformatting, no whitespace changes. Partition into 6 contiguous spans (logical grouping, in original order):

1. `01-base.css` — `:root` tokens + reset + base `body`/`.screen` + poster-carousel background (file start → just before the hero/lobby copy sections)
2. `02-hero-lobby.css` — hero copy/demo, lobby panels, public lobbies, lobby settings, team headers
3. `03-game.css` — game layout, chain/connector/node, input area, autocomplete, chat
4. `04-modals.css` — notifications, modal overlay base, how-to-play, credits, game-over, share-card
5. `05-responsive.css` — the consolidated responsive/override bulk (the large `@media` section block)
6. `06-states-anim.css` — elimination/result/confetti/tutorial + all trailing `@keyframes`/hover-state blocks → file end

Exact cut lines are chosen by the implementer against the live file at the nearest banner boundary to each split; **the byte-identity gate (below) is the real specification** — any mis-cut fails it.

**Acceptance Criteria:**
- [ ] 6 partials exist; concatenated in order 01→06 they are byte-identical to pre-refactor `public/style.css`.
- [ ] `index.html` references exactly those 6, in order, each cache-busted (`?v=1.4`); the old single `<link>` is gone; `style.css` is deleted.
- [ ] No other `index.html` change.
- [ ] Each partial has a top-of-file WHY-comment naming the section it owns (added **after** the byte-identity gate is captured against the raw split — see Step 3).

**Verify:**
- `git show main:public/style.css > /tmp/style-orig.css && cat public/css/01-base.css public/css/02-hero-lobby.css public/css/03-game.css public/css/04-modals.css public/css/05-responsive.css public/css/06-states-anim.css > /tmp/style-concat.css && diff /tmp/style-orig.css /tmp/style-concat.css` → **empty output** (record it in task notes).
- Browser smoke at 1440px and 390px widths: hero, lobby (join/private/public), game board, a modal, an elimination state — visually identical to pre-refactor.

**Steps:**

- [ ] **Step 1: Snapshot original**

```bash
git show main:public/style.css > /tmp/style-orig.css
wc -c /tmp/style-orig.css   # note the byte count
```

- [ ] **Step 2: Cut into 6 partials (verbatim, no edits yet)**

Identify the 5 split points at banner boundaries matching the 6-span partition above. Write each span to its `public/css/0N-*.css` file with **no content changes whatsoever**.

- [ ] **Step 3: Gate — byte identity (pre-comment)**

```bash
cat public/css/01-base.css public/css/02-hero-lobby.css public/css/03-game.css public/css/04-modals.css public/css/05-responsive.css public/css/06-states-anim.css > /tmp/style-concat.css
diff /tmp/style-orig.css /tmp/style-concat.css && echo "BYTE-IDENTICAL OK"
```
Expected: `BYTE-IDENTICAL OK`. If `diff` is non-empty, a cut landed mid-block or whitespace changed — fix the cut and re-run. **Do not proceed until this passes.**

- [ ] **Step 4: Add the per-file WHY header comment**

Prepend one comment line to each partial, e.g.:
```css
/* 03-game.css — game board layout, chain/connector/node, input area, autocomplete, chat. Part 3/6 of the split style.css; load order is load-bearing (cascade). */
```
(CSS comments are inert; this does not affect rendering. The byte-identity gate in Step 3 is the lossless proof; these headers are an intentional, reviewed addition on top.)

- [ ] **Step 5: Update `index.html`**

Replace the single line (~61):
```html
  <link rel="stylesheet" href="style.css?v=1.3">
```
with, in this exact order:
```html
  <!-- style.css was split into ordered partials (Phase 3). Order is the
       original cascade order and is load-bearing — do not reorder. -->
  <link rel="stylesheet" href="css/01-base.css?v=1.4">
  <link rel="stylesheet" href="css/02-hero-lobby.css?v=1.4">
  <link rel="stylesheet" href="css/03-game.css?v=1.4">
  <link rel="stylesheet" href="css/04-modals.css?v=1.4">
  <link rel="stylesheet" href="css/05-responsive.css?v=1.4">
  <link rel="stylesheet" href="css/06-states-anim.css?v=1.4">
```

- [ ] **Step 6: Delete the old file**

```bash
git rm public/style.css
```

- [ ] **Step 7: Browser smoke** (Verify) — walk the listed screens at both widths; record result.

- [ ] **Step 8: Commit**

```bash
git add public/css/ public/index.html
git commit -m "Phase 3 (B): split style.css into 6 ordered partials (byte-identical)"
```

---

### Task 4: `showScreen()` helper + call-site migration (the only logic change)

**Goal:** Add one canonical `showScreen(name)` that centralises the duplicated `.active`/`.hidden` screen toggling; migrate the unambiguous call sites; pin behaviour with a new jsdom spec. TDD: spec first.

**Files:**
- Modify: `public/js/ui/ui-dom.js` (add `showScreen`; re-exported automatically by the Task-2 barrel)
- Create: `client-tests/showScreen.test.js`
- Modify: `public/js/app.js`, `public/js/socketClient.js`, `public/js/ui/ui-render.js` (call-site migration)

**Canonical model & safety invariant:** Top-level screens (`heroScreen`/`lobbyScreen`/`gameScreen`) are mutually exclusive (`.screen{display:none}`, `.screen.active{display:flex}`, full-screen — never two active). The three lobby entry panels (`joinPanel`/`privatePanel`/`publicPanel`) are mutually exclusive. Therefore a helper that **normalises all members of a group** is behaviour-identical to the prior code that toggled a subset: removing `.active`/`.hidden` from an element that doesn't have it is a no-op, and no prior site kept two group members visible. This invariant is what makes the migration zero-behaviour-change; it is verified by the new spec + the existing `client-tests/socket-handlers.test.js` (which exercises `socketClient.js`) + browser smoke.

**Acceptance Criteria:**
- [ ] `showScreen(name)` exists in `ui-dom.js`, importable from `./ui.js` (barrel) and `./ui-dom.js`.
- [ ] `client-tests/showScreen.test.js` asserts each `name` yields exactly the expected group state and no other element changes; passes.
- [ ] Migrated sites use `showScreen(...)`; bespoke side-effects (focus/scroll/extra panel resets) are **kept adjacent**, unchanged.
- [ ] **Excluded (not visibility):** `ui.js`(now `ui-render.js`) `gameScreen.classList.toggle('solo-mode-ui',…)` / `toggle('speed-mode',…)` — leave untouched.
- [ ] Lone/branchy sites `app.js:233`, `socketClient.js:766`, `socketClient.js:787`: migrate **only** if the surrounding block is a clean canonical transition; otherwise leave as-is with a `// NOTE: not migrated — <reason>` comment.
- [ ] Full `npm test` green (both projects), zero edits to existing test files; `--coverage` floor held.

**Verify:** `npm test` → all pass incl. new `showScreen.test.js`; `git diff --stat main -- client-tests/` shows only `showScreen.test.js` added; browser smoke of every migrated transition (logo→hero, hero→lobby ×4 entry points, lobby↔private↔public↔join, →game start, endGame→lobby, team↔waiting, rejoin/returnedToLobby paths) behaves identically.

**Steps:**

- [ ] **Step 1: Write the failing spec** — `client-tests/showScreen.test.js`

```javascript
// client-tests/showScreen.test.js
// WHY: showScreen() is the one behaviour-logic change in Phase 3. This
// spec pins the canonical group-normalisation contract so the call-site
// migration is provably equivalent to the prior ad-hoc toggling.
import { initUIElements, showScreen } from '../public/js/ui.js';

function setDom() {
  document.body.innerHTML = `
    <div id="hero-screen" class="screen active"></div>
    <div id="lobby-screen" class="screen"></div>
    <div id="game-screen" class="screen"></div>
    <div id="join-panel"></div>
    <div id="private-panel" class="hidden"></div>
    <div id="public-panel" class="hidden"></div>
    <div id="waiting-room" class="hidden"></div>
    <div id="team-screen" class="hidden"></div>`;
  initUIElements();
}
const cls = id => document.getElementById(id).className.trim();

beforeEach(setDom);

test('top-level: showScreen("game") activates only game', () => {
  showScreen('game');
  expect(cls('game-screen')).toBe('screen active');
  expect(cls('hero-screen')).toBe('screen');
  expect(cls('lobby-screen')).toBe('screen');
});

test('top-level: showScreen("lobby") activates only lobby', () => {
  showScreen('lobby');
  expect(cls('lobby-screen')).toBe('screen active');
  expect(cls('hero-screen')).toBe('screen');
  expect(cls('game-screen')).toBe('screen');
});

test('entry panels: showScreen("private") shows only private', () => {
  showScreen('private');
  expect(cls('private-panel')).toBe('');
  expect(cls('join-panel')).toBe('hidden');
  expect(cls('public-panel')).toBe('hidden');
});

test('entry panels: showScreen("join") shows only join', () => {
  showScreen('private');
  showScreen('join');
  expect(cls('join-panel')).toBe('');
  expect(cls('private-panel')).toBe('hidden');
  expect(cls('public-panel')).toBe('hidden');
});

test('sub-screens: showScreen("team") then "waiting") swap', () => {
  showScreen('team');
  expect(cls('team-screen')).toBe('');
  expect(cls('waiting-room')).toBe('hidden');
  showScreen('waiting');
  expect(cls('waiting-room')).toBe('');
  expect(cls('team-screen')).toBe('hidden');
});

test('top-level toggle does not touch entry panels', () => {
  showScreen('lobby');
  expect(cls('join-panel')).toBe('');        // untouched
  expect(cls('private-panel')).toBe('hidden');
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npm test -- --selectProjects client -t showScreen`
Expected: FAIL (`showScreen` is not exported yet).

- [ ] **Step 3: Implement `showScreen` in `public/js/ui/ui-dom.js`**

Append (after the DOM-ref declarations / `initUIElements`):
```javascript
// Canonical screen controller. WHY: screen visibility was toggled
// ad-hoc at ~22 sites across app.js/socketClient.js/ui-render.js with
// two inconsistent mechanisms (.active for top-level screens, .hidden
// for lobby sub-panels) — the 2026-05-16 review flagged the drift risk.
// Contract: normalise exactly ONE group (top-level screens, OR the
// entry-panel trio, OR the waiting/team pair). It performs NO
// opportunistic cross-group resets — callers keep any extra
// side-effects (focus/scroll/other panel resets) as adjacent lines, so
// behaviour is unchanged. Group members are mutually exclusive, so
// normalising the whole group == the prior subset toggles (removing a
// class an element lacks is a no-op). Null-guarded per element to
// mirror the existing `if (el)` call-site guards.
function _toggle(el, cls, on) {
  if (!el) return;                 // some refs absent on some pages
  el.classList[on ? 'add' : 'remove'](cls);
}

export function showScreen(name) {
  switch (name) {
    case 'hero':
    case 'lobby':
    case 'game':
      _toggle(heroScreen, 'active', name === 'hero');
      _toggle(lobbyScreen, 'active', name === 'lobby');
      _toggle(gameScreen, 'active', name === 'game');
      return;
    case 'join':
    case 'private':
    case 'public':
      _toggle(joinPanel, 'hidden', name !== 'join');
      _toggle(privatePanel, 'hidden', name !== 'private');
      _toggle(publicPanel, 'hidden', name !== 'public');
      return;
    case 'waiting':
      _toggle(waitingRoom, 'hidden', false);
      _toggle(teamScreen, 'hidden', true);
      return;
    case 'team':
      _toggle(teamScreen, 'hidden', false);
      _toggle(waitingRoom, 'hidden', true);
      return;
    default:
      // Programming error — fail visibly in console, no-op at runtime.
      console.warn('showScreen: unknown screen name:', name);
  }
}
```

- [ ] **Step 4: Run — confirm green**

Run: `npm test -- --selectProjects client -t showScreen`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Migrate the unambiguous call sites**

Replace each block's visibility lines with one `showScreen()` call; **keep every non-visibility line** (the `if (x) x.focus()`, scroll, form/tab resets, and any extra panel reset) exactly where it was. Each migration table row — current lines → replacement:

`public/js/app.js` — first add `showScreen` to the existing `import { … } from './ui.js';` (the barrel re-exports it via `ui-dom.js`); WHY-comment not needed on an import-list addition.
- 151–153 (`gameScreen -active; lobbyScreen -active; heroScreen +active`) → `showScreen('hero');` — **keep** 154–157 (`waitingRoom +hidden`, panel resets) as-is below it.
- 187–188 → `showScreen('private');`
- 193–194 → `showScreen('public');`
- 199–200 → `showScreen('join');`
- 204–205 → `showScreen('join');`
- 222–223 (guarded private+hidden / join-hidden) → `showScreen('join');`
- 264–265, 311–312, 382–383, 420–421 (each `heroScreen -active; lobbyScreen +active`) → `showScreen('lobby');`
- 481–482 (`teamScreen +hidden; waitingRoom -hidden`) → `showScreen('waiting');`
- **233** (lone `if (privatePanel) privatePanel.classList.add('hidden');`): read ±10 lines. If it sits within a transition that overall equals a canonical one, fold into that `showScreen()` call; else leave as-is + `// NOTE: not migrated — lone partial toggle, no canonical equivalent.`

`public/js/ui/ui-render.js` (formerly ui.js 116–122, inside `renderLobby`'s team-mode branch — both `renderLobby` and `renderTeamScreen` live in `ui-render.js` per Task 2)
- 116–117 (`waitingRoom +hidden; teamScreen -hidden`) → `showScreen('team');`
- 121–122 (`teamScreen +hidden; waitingRoom -hidden`) → `showScreen('waiting');`
- `gameScreen.classList.toggle('solo-mode-ui', …)` / `toggle('speed-mode', …)` (was 248–249) → **leave untouched** (mode styling, not visibility).
- Add `import { showScreen } from './ui-dom.js';` at top (WHY-comment it).

`public/js/socketClient.js` (import `showScreen` from `./ui.js` — barrel — alongside its existing ui imports)
- 301–302 (`lobbyScreen -active; gameScreen +active`) → `showScreen('game');`
- 406–407 (`gameScreen -active; lobbyScreen +active`) → `showScreen('lobby');`
- 795–796 (`lobbyScreen -active; gameScreen +active`) → `showScreen('game');`
- 800–801 (`gameScreen -active; lobbyScreen +active`) → `showScreen('lobby');` ; 802 (`waitingRoom -hidden`) → `showScreen('waiting');` (two calls, in that order)
- 819–821 (`heroScreen +active; lobbyScreen -active; gameScreen -active`) → `showScreen('hero');`
- 833–835 (`gameScreen -active; lobbyScreen -active; heroScreen +active`) → `showScreen('hero');` — **keep** 836 (`waitingRoom +hidden`) as-is below.
- 74–84 (branchy `joined` handler, `*El` refs): read the full handler. The common prefix 74–77 (hide join/private/public, hero -active) + the spectator branch (lobby -active, game +active) ≡ `showScreen('game')`; the player branch (waiting -hidden, lobby +active) ≡ `showScreen('lobby'); showScreen('waiting');`. Apply per branch; keep the join/private/public hides if any are *not* covered by a canonical call (the entry-panel trio is covered by neither 'game' nor 'lobby'/'waiting' — so keep lines 74–76 as adjacent side-effects). WHY-comment the branch mapping.
- **766** (lone `if (heroScreen) heroScreen.classList.remove('active');`) and **787** (same): read ±10 lines. Migrate only if the block is a clean canonical transition; else leave + `// NOTE: not migrated — <reason>`.

- [ ] **Step 6: Full regression**

Run: `npm test`
Expected: every server + client suite green, including `showScreen.test.js` and the **unmodified** `socket-handlers.test.js` (the strongest proof the socketClient migration is behaviour-preserving).
Run: `npm test -- --coverage --runInBand` → floor held.
Run: `git diff --stat main -- client-tests/` → only `client-tests/showScreen.test.js` (added); no other test file touched.

- [ ] **Step 7: Browser smoke** (Verify) — walk every migrated transition listed; confirm identical behaviour incl. preserved focus/scroll side-effects. Record the walk.

- [ ] **Step 8: Commit**

```bash
git add public/js/ui/ui-dom.js public/js/ui/ui-render.js public/js/app.js public/js/socketClient.js client-tests/showScreen.test.js
git commit -m "Phase 3 (D): add showScreen() helper + migrate screen-switch call sites"
```

---

## Finishing

After all 4 tasks pass both reviews and the final holistic review:
- Push `phase3-maintainability`; `gh pr create` (base `main`) with a summary covering the 4 workstreams + the losslessness evidence (client suite green, byte-identity diff, server suite green).
- The PR-merge / push-to-`main` / Render prod deploy is **classifier-gated and handed to the user** (`memory/feedback_deploy_authorization.md`) — do not merge.
- Update `memory/project_phase3_*` + `MEMORY.md` index per the phase-execution workflow.
- Optional non-blocking pre-flight before starting: confirm the Phase 2 Render deploy booted clean via the Render MCP (read-only).

## Self-review note

Spec coverage: §3 ui.js→Task 2; §4 style.css→Task 3; §5 constants→Task 1; §6 showScreen→Task 4; §7 sequencing→task order C,A,B,D + Process block; §8 global gates→per-task Verify + Process; §9 risks→losslessness gates in each task. No placeholders: all code shown; the only deliberately implementer-resolved values are CSS cut lines (gated by byte-identity diff) and the 3 enumerated lone/branchy call sites (gated by the explicit migrate-or-NOTE policy + the unchanged `socket-handlers.test.js`). Type/name consistency: `showScreen`, `_toggle`, `MAX_PLAYERS_PER_LOBBY` used identically across tasks; barrel re-export keeps all `ui.js` symbol names stable.
