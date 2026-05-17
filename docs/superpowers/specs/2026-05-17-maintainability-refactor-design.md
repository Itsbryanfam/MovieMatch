# Phase 3 — Maintainability Refactor (design spec)

- **Date:** 2026-05-17
- **Status:** Approved (design gate passed; CSS strategy = ordered partials)
- **Phase:** 3 of 5 in the post-2026-05-16-review remediation (1 = security/PR #11, 2 = robustness+CI/PR #12, **3 = maintainability**, 4 = content/polish, 5 = growth)
- **Source:** `memory/project_full_review_2026-05-16.md` backlog item — "`ui.js` (1734) / `style.css` (3553) split seams; player-cap `8` duplicated across files"
- **Site:** live (moviematch.it.com), auto-deploys from `main` on merge

## 1. Goal & non-goals

**Goal:** Reduce maintenance load by breaking the two god-files into focused modules, centralising one duplicated screen-switching pattern behind a helper, and removing a duplicated server constant — with **zero behaviour change and zero visual change**.

**Non-goals (YAGNI / explicitly deferred):**
- No behaviour, visual, layout, copy, or timing changes of any kind.
- No new runtime dependency, no bundler, no build pipeline, no CSS-in-JS, no transpile step.
- No per-screen CSS *reordering* (cascade is interleaved — reordering risks regressions no test can catch).
- Do **not** absorb single-use magic numbers into `constants.js` — only values duplicated across 2+ files.
- Do **not** touch Phase 4 items: `.btn` base class, `.gitignore` for `coverage/`, daily-movie-list expansion, manifest icons, service worker.
- Do **not** rewrite call-site side-effects (focus/scroll/form-reset) — only the visibility lines they sit next to.

## 2. Guiding principle — provable losslessness

There is a **jsdom client test suite** (`client-tests/`, 6 specs — several importing `public/js/ui.js` directly) **plus** the server suite, and **no build pipeline** (`package.json` scripts = `test` only; the client tests run via the already-configured `client` Jest project — jsdom + babel-jest, all devDeps present). "Zero behaviour change" must be *verifiable by construction*, and the existing suites are the primary regression net:

| Workstream | Lossless mechanism | Verification (implementer MUST run) |
|---|---|---|
| A — `ui.js` split | **Barrel re-export**: `ui.js` becomes a re-export-only barrel; every consumer `import { … } from './ui.js'` is unchanged | Existing `client-tests/` jsdom specs that import `./ui.js` stay green (primary proof); exported-symbol set of new `ui.js` ⊇ old (git diff of `export` names); browser smoke |
| B — `style.css` split | **Ordered partials**: concatenation of partials in `<link>` order is **byte-identical** to current `style.css` | `cat <partials in order> | diff - <original>` produces empty output |
| C — `server/constants.js` | Pure literal→named substitution, **identical values** | Existing server Jest tests stay green (these code paths are covered); CI green |
| D — `showScreen()` | The **only** logic change; consolidates duplicated DOM toggling | New `client-tests/` jsdom spec (no new dependency — harness exists) pins behaviour; browser smoke |

## 3. Workstream A — split `public/js/ui.js` (1734 lines)

### 3.1 Current state
`ui.js` is a single ES module; every symbol is `export`ed. It is imported via `import { … } from './ui.js'` by exactly two runtime consumers — `public/js/app.js:29` and `public/js/socketClient.js:21` — and additionally by jsdom specs in `client-tests/` (`render-chain`, `render-lobby`, `ghost-attempt`, `poster-fallback`). Sections are already delimited by `// ====` banner comments. Mutable DOM-reference bindings (`export let lobbyScreen, …`, lines ~16-29) are populated inside `initUIElements()`.

### 3.2 Target structure
Create `public/js/ui/` with 6 cohesive modules; rewrite `ui.js` as a **barrel that only re-exports**. Approximate seams (final cut points resolved against the live file at implementation time — cut only at banner/function boundaries, never mid-symbol):

| New module | Contents (approx. source lines) | Approx. size |
|---|---|---|
| `public/js/ui/ui-dom.js` | `MODE_DESCRIPTIONS`; all `export let` DOM refs; `initUIElements()` (1–104) | ~104 |
| `public/js/ui/ui-render.js` | `renderLobby`, `renderTeamScreen`, `renderGame`, `renderPlayerSidebar`, `attachPosterFallback`, `renderChainItems`, `_renderSpectatorPredictionBar`, `_hideSpectatorPredictionBar`, `_renderActiveThemeBadge`, `renderTurnControls` (105–637); plus `resetMobileTab`, `showGameOverBanner` (1657–1734) | ~600 |
| `public/js/ui/ui-notifications.js` | `showNotification`, `showEliminationFlash`, `showSelfEliminationScreen`, `showWinFlash`, `showConfetti`, `showGhostAttempt`, `clearGhostAttempt` (638–891); plus `showToast` (1625–1633) | ~270 |
| `public/js/ui/ui-autocomplete.js` | `renderAutocompleteResults`, `closeMobileAc` (892–992) | ~100 |
| `public/js/ui/ui-sharecard.js` | `generateShareCard`, `truncate`, `roundRect`, `scoreChainEntry`, `selectChainEntries` (993–1216); plus `openShareModal`, `buildTextRecap` (1634–1656) | ~280 |
| `public/js/ui/ui-panels.js` | replay (`MAX_REPLAY_ENTRIES`, `REPLAY_STEP_MS`, `playChainReplay`, `_buildReplayEntry`), stats (`MODE_LABELS`, `renderMyStats`), daily (`renderDailyResult`) (1217–1624) | ~400 |

`public/js/ui.js` becomes only: `export * from './ui/ui-dom.js';` … one line per module. (Use explicit named re-exports if any symbol-name collision is found across modules; none expected.)

### 3.3 Critical invariant — ES-module live bindings
The DOM refs are mutable (`export let`), assigned in `initUIElements()`. Modules that consume a ref (e.g. `ui-render.js` using `gameScreen`) **must `import` it from `ui-dom.js`**, not redeclare it. ES-module live bindings + re-export preserve the post-`initUIElements()` value through the barrel, so consumers and sibling modules all observe the assigned element. This is the mechanism that makes the split lossless; the implementer must wire internal imports accordingly.

### 3.4 Acceptance
- **The existing `client-tests/` jsdom suite stays 100% green with zero edits to any client test file** — the strongest losslessness proof for every `ui.js` function those specs cover (`render-chain`, `render-lobby`, `ghost-attempt`, `poster-fallback`, `socket-handlers`, `tutorial-trigger`).
- Old vs new exported-symbol set: every name `export`ed by pre-refactor `ui.js` is still importable from `ui.js`. Verify: `git show main:public/js/ui.js | grep -oE 'export (const|let|function|class|\*|\{)[^=({]*'` set ⊆ post-refactor barrel re-exports.
- No runtime consumer (`app.js:29`, `socketClient.js:21`) is edited.
- No new dependency; modules use only relative ESM imports.
- Browser smoke: hero → lobby → game → share-card → stats → daily flow renders identically.
- Every moved block keeps its existing comments; new files get a top-of-file WHY-comment explaining the module's responsibility (per `memory/feedback_code_comments.md`).

## 4. Workstream B — split `public/style.css` (3553 lines) into ordered partials

### 4.1 Approach
Cut the file into ~6 partials **at top-level section-comment / blank-line boundaries only** (never mid-rule, never reorder). Content is moved **verbatim**. Load them via ordered `<link rel="stylesheet">` tags in `public/index.html`, in the **exact original source order**. Place partials in `public/css/`.

### 4.2 Intended partitions (logical grouping; exact byte cut points finalised at implementation against the live file)
1. `css/01-base.css` — `:root` tokens + reset + base `body`/`.screen` (~1–208)
2. `css/02-hero-lobby.css` — hero copy/demo, lobby panels, public lobbies, settings, team headers (~209–879)
3. `css/03-game.css` — game layout, chain/connector/node, input area, autocomplete, chat (~880–1366)
4. `css/04-modals-overlays.css` — notifications, modal overlay, how-to-play, credits, game-over, share-card (~1367–1896)
5. `css/05-responsive.css` — the consolidated responsive/override bulk (~1897–2474)
6. `css/06-states-anim.css` — elimination/result/confetti/tutorial/keyframes/hover bulk (~2475–3553)

### 4.3 Invariant
`cat css/01-base.css css/02-hero-lobby.css css/03-game.css css/04-modals-overlays.css css/05-responsive.css css/06-states-anim.css | diff - <pre-refactor public/style.css>` → **empty**. This is a required, recorded check.

### 4.4 index.html change & cache-busting
- `public/index.html` line ~61 currently: `<link rel="stylesheet" href="style.css?v=1.3">`.
- Replace with the 6 `<link>` tags in order, each cache-busted at a bumped version (e.g. `?v=1.4`). Delete the old `style.css` only after the diff invariant passes (or keep it unreferenced and remove in the same commit — implementer's call, but the served set must be exactly the 6 partials).
- No other HTML change.

### 4.5 Acceptance
- The byte-identical concat invariant (4.3) passes and the command/output is recorded in the task notes.
- `index.html` references exactly the 6 partials, in original cascade order, all cache-busted.
- Browser smoke at desktop + mobile widths: visually identical to pre-refactor (spot-check hero, lobby, game board, a modal, an elimination state).
- Each partial gets a top-of-file WHY-comment naming the section range it owns.

## 5. Workstream C — `server/constants.js`

### 5.1 Extract (duplicated across 2+ non-test files only)
- `MAX_PLAYERS_PER_LOBBY = 8` — used at `server/systems/lobbySystem.js:101` (`r.players.length >= 8`), `:118` (user-facing "8 player maximum" message — keep message text identical, interpolate the constant), and `server/gameLogic.js:345` (`8 - state.players.length`; comment at :344 already notes the duplication).
- Cross-file timer values the structural map flagged as duplicated — extract **only** those that genuinely appear in 2+ source files with the same meaning (e.g. reconnect-grace 15000 / speed 15000, daily 60000). The plan phase will pin the exact final list against the live code; if a value turns out single-use, leave it (YAGNI). `MAX_PLAYERS_PER_LOBBY` is the mandatory one; timers are included only where duplication is real.

### 5.2 Module & imports (CommonJS — `package.json` `"type": "commonjs"`)
- New file `server/constants.js`, `module.exports = { … }`.
- Import paths: from `server/gameLogic.js` & `server/socketHandlers.js` → `require('./constants')`; from `server/systems/lobbySystem.js` (and other `server/systems/*`) → `require('../constants')`.
- The user-facing full-lobby error string must remain byte-identical (build it from the constant via template literal).

### 5.3 Acceptance
- `npm test` fully green, both Jest projects (these server paths are covered — instant losslessness proof).
- `npm test -- --coverage --runInBand` still meets the `jest.config.js` ratchet floor (stmts 63 / branches 52 / funcs 62 / lines 69; `collectCoverageFrom` is server-only, so client moves do not affect it).
- No literal `8` player-cap, grep-clean in the touched source files (replaced by the constant).
- WHY-comment on `constants.js` and at each substitution site.

## 6. Workstream D — `showScreen()` helper (the only logic change)

### 6.1 Screen taxonomy & mechanism (from structural map)
- **Top-level screens**, toggled via `.active` class (`.screen{display:none}` → `.screen.active{display:flex}`, style.css ~177–188): `hero` (`heroScreen`/#hero-screen), `lobby` (`lobbyScreen`/#lobby-screen), `game` (`gameScreen`/#game-screen).
- **Nested panels**, toggled via `.hidden`: `waiting` (`waitingRoom`), `team` (`teamScreen`), `join` (`joinPanel`), `private` (`privatePanel`), `public` (`publicPanel`).
- The current code mixes these two patterns inconsistently across ~30 call sites in `app.js`, `socketClient.js`, `ui.js`.

### 6.2 Helper
- Lives in `public/js/ui/ui-dom.js` (owns the refs), re-exported via the `ui.js` barrel; consumers import `showScreen` from `./ui.js` / `../js/ui.js`.
- Signature: `showScreen(name, opts = {})` where `name ∈ {hero,lobby,game,waiting,team,join,private,public}`.
- Behaviour: applies the **correct class for that screen's tier** (`.active` for top-level — adding to target, removing from the other two; `.hidden` for nested — showing target, hiding its siblings within the same group). Encodes the canonical transition each screen needs (e.g. `game` ⇒ game `.active`, hero/lobby not `.active`; `waiting` ⇒ within lobby, `.hidden` off waiting, on team/join/private/public as today).
- **Testable:** visibility logic uses only `classList.add/remove` on the screen refs. Covered by a new spec in the existing `client` Jest project (`client-tests/showScreen.test.js`, jsdom env — already configured, **no new dependency**): build the screen containers in the jsdom DOM, call `initUIElements()` then `showScreen(name)`, assert the resulting `class` state on each container.

### 6.3 Call-site migration policy
- Replace **only the pure visibility-toggle lines** at each site with a single `showScreen(name)` call.
- Where a site also does side-effects (focus, scroll, form/tab reset), **keep those lines unchanged** immediately adjacent to the `showScreen()` call.
- Sub-panel-only transitions (e.g. join↔private↔public) also route through `showScreen` (names `join/private/public`) so all screen toggling has one owner.
- If any site's toggle is *not* expressible as a canonical transition without behaviour change, leave it as-is and add a `// NOTE:` comment — correctness over coverage.

### 6.4 Acceptance
- `client-tests/showScreen.test.js` (jsdom `client` project; matches `testMatch: client-tests/**/*.test.js`) asserts each `name` produces exactly the expected `.active`/`.hidden` state on the right containers and leaves the others untouched.
- `npm test` green — both `server` and `client` projects, new test included; CI green.
- Browser smoke: every migrated transition (hero↔lobby↔game, waiting/team, join/private/public, disconnect→hero, rejoin paths) behaves identically, including the preserved side-effects.
- WHY-comments on the helper and at each migrated call site.

## 7. Build sequencing & process

Subagent-driven, **sequential** tasks (per `memory/feedback_phase_execution_workflow.md`), lowest-risk first:

1. **C — `server/constants.js`** (test-covered → immediate green-test proof of losslessness).
2. **A — `ui.js` barrel split** (provably lossless; no consumer edits).
3. **B — `style.css` ordered partials** (concat===original proof).
4. **D — `showScreen()` + unit test** (only logic change; done last on a clean tree).

Process (matches Phases 1–2):
- Feature branch `phase3-maintainability` off `main` (**not** a worktree). Planning docs (this spec, the plan, the `.tasks.json`) commit to `main` locally first, then `git checkout -b phase3-maintainability` for all implementation commits.
- Native Task tools unavailable → TodoWrite for in-session tracking + hand-authored `docs/superpowers/plans/2026-05-17-maintainability-refactor.md.tasks.json`, status synced per task.
- Per task: implementer subagent gets full task text + exact code; then **independent spec-compliance review, then independent code-quality review**; fix loop; statuses advance only after both pass. Final whole-branch holistic review before PR.
- Every change ships WHY-comments (`memory/feedback_code_comments.md`).
- Model tiering: cheap for mechanical single/dual-file moves (C), standard for multi-file/judgment (A, B, D), most-capable for the final holistic review.
- Finishing: push feature branch + `gh pr create` (allowed). The PR-merge / push-to-`main` / Render prod deploy is classifier-gated and **handed to the user** (`memory/feedback_deploy_authorization.md`). `coverage/` is never staged (Phase 4).
- Optional pre-flight: confirm the Phase 2 Render deploy booted clean via the Render MCP (read-only) before starting the build — non-blocking.

## 8. Global acceptance gates
- `npm test` (both `server` and `client` Jest projects) fully green at every task boundary, with **zero edits to existing test files**; `--coverage` (server-only `collectCoverageFrom`) meets the ratchet floor; `.github/workflows/ci.yml` green on the PR.
- ui.js barrel: exported-symbol superset check passes; no consumer edited.
- style.css: byte-identical concat invariant recorded.
- constants.js: zero remaining duplicated player-cap literal.
- showScreen: unit test green; browser smoke of all transitions identical.
- No new dependency in `package.json`; no build step added.

## 9. Risks & rollback
- **CSS cascade regression** — mitigated by the byte-identical concat invariant (a wrong split fails the diff); each partial independently revertable by restoring `style.css` + the single `<link>`.
- **ui.js live-binding miswire** — mitigated by §3.3 invariant + the existing `client-tests/` jsdom suite (which imports `./ui.js` and exercises render paths) + browser smoke; revert = restore monolithic `ui.js`.
- **showScreen behaviour drift** — the only real-logic risk; mitigated by unit test + conservative call-site policy (§6.3) + browser smoke; revert = restore inline toggles.
- Each workstream is an independent, individually-revertable commit set; failure in one does not block the others.
