# Phase 7.4 — Quick-Win Identity Bundle: Design Spec

**Date:** 2026-05-18
**Status:** Approved (brainstorming) — proceeding to implementation plan
**Phase:** **7.4** — fourth sub-phase of the Phase 7 UI/UX Elevation growth
initiative, sequenced after **7.1 Elimination Aftercare** + **7.2 Feedback-layer
Split** + **7.3 Design-System Hardening** (all merged + live; `origin/main`
`602ad74`). This is the "quick-win identity bundle" defined in the Phase 7
decision-record (`docs/superpowers/specs/2026-05-17-phase7-uiux-elevation-design.md`
§2). It does **not** renumber, block, or overlap 6b/6c — see §4 dedup.

---

## 0. Provenance & scope decomposition (decision record)

The Phase 7 decision-record §2 lists **five** candidate items for 7.4:
Theme-Packs-With-Taste, Panic Mode Timer, Host Director controls, Daily
reset-countdown/streak copy, Player Entrance Cards (subsuming Pass 2 #10/#11/#14/#9
+ LM-04's copy half + CG-01 quick parts + CP-01 strings for these surfaces).

**Two of the five collide with 7.5 Red Carpet Lobby** and are deliberately
**re-homed to 7.5**, not built here:

- **Player Entrance Cards (Pass 2 #9)** — "animated player arrivals" is
  explicitly part of 7.5 Red Carpet Lobby's goal (decision-record §2 7.5:
  "theatrical pre-show — … animated player arrivals …"). Building it in 7.4
  would build the lobby showcase twice and on a pre-7.5 treatment — exactly the
  rework-on-debt risk the infra-first sequencing exists to prevent.
- **Host Director controls (Pass 2 #14), heavy form** — a consolidated host
  control surface is "Party Room Director" work (7.5 subsumes Pass 1
  LM-01/02/03/05). The trivial copy-alignment of the *existing* scattered
  host affordances folds into 7.5's lobby copy pass, not a throwaway 7.4
  version.

This cut was presented at the brainstorming design-approval gate and the
**tight 3-item scope was approved**. 7.4 therefore delivers **three
independent, additive, non-overlapping identity micro-features** on the
now-hardened 7.3 system:

1. **Theme-Packs-With-Taste** — authored voice over the *existing* theme filters.
2. **Panic Mode Timer** — physical last-5-seconds juice on the *existing*
   critical-timer state.
3. **Daily ritual** — reset countdown + device-local streak on the *existing*
   daily result modal.

LM-04's "enforce true 2v2" gameplay change stays deferred (decision-record §5).
7.4's CP-01 copy contribution is the **theme re-voicing** (substantial authored
copy across 11 themes) plus the **new additive daily ritual labels**
(countdown/streak). It deliberately makes **no edits to existing rendered
strings** elsewhere (the timer and daily-modal existing copy stay byte-identical
— see §3.3) so the zero-regression contract guard holds; CP-01 is distributed
per the decision-record, not a global string PR.

---

## 1. Goal & Motivation

Phase 7's thesis is that MovieMatch should feel like a *live movie-night
ritual*, not "a trivia web app with rooms." 7.1–7.3 delivered the substrate
(learning aftercare, a non-cinematic feedback layer, a hardened modal/CSS
system). 7.4 spends that substrate on three cheap, high-visibility "ritual"
touches that add character without new infrastructure, new socket events, new
persistence, or accounts:

- **Theme filters today read like a settings dropdown** (`🎬 Any (no theme)`,
  `🎃 Horror`, "Only horror movies count."). Re-voicing them as authored
  "programs" makes choosing a theme feel like picking tonight's screening.
- **The endgame of a turn is the tensest moment** and currently the last 5
  seconds look identical to the last 10. A physical "panic" treatment makes the
  clutch moment *felt*.
- **The Daily is a ritual with no ritual cues** — no "come back at reset"
  countdown, no streak. Two *additive* elements — a live reset countdown + a
  device-local streak — turn a one-shot puzzle into a daily habit loop, with
  zero server/account cost and **no edit to the existing daily copy/DOM**.

**Non-goal:** redesigning any of these surfaces, adding stats/recap widgets,
changing game rules/scoring/validation, or building any bundling/preset
mechanic (that is 6c — see §4).

---

## 2. Current Architecture (grounding)

Verified against the codebase at `602ad74` on 2026-05-18. The implementation
plan re-confirms exact line numbers by reading the code; the **contracts**
below are what matter.

### 2.1 Theme filters (server-authoritative, client-rendered)
- `server/systems/themesSystem.js` — `THEMES` is an ordered map; each entry is
  `{ id, label, description, match(fn) }`. 11 entries: `any`, `horror`,
  `comedy`, `action`, `scifi`, `romance`, `animation`, `decade_1980s`,
  `decade_1990s`, `decade_2000s`, `decade_2010s`.
- `clientShape(themeId)` → `{ id, label, description }` (no `match` — the server
  is authoritative on filtering). `listThemes()` maps `Object.keys(THEMES)` in
  declaration order (declaration order = display order, deliberately stable).
- `isValidTheme(id)` (hasOwnProperty on `THEMES`) and `matchesTheme(id, r)`
  (calls `THEMES[id].match`) are the **behavioural contract**: they depend on
  `id` and `match`, **not** on `label`/`description`.
- Client: `public/js/ui/ui-render.js:~110-127` builds the `#theme-select`
  `<option>`s with `opt.textContent = t.label` and `opt.title = t.description`,
  rebuilt only when the id-set changes; `themeSel.disabled = !amIHost`. The
  client renders the server strings verbatim — it has no theme copy of its own.

**Implication:** re-voicing themes = editing only the `label` and `description`
string literals in `THEMES`. `id`, `match`, `clientShape` shape, `listThemes`
ordering, `isValidTheme`, `matchesTheme`, and the client render code are
**untouched** → zero filter-behaviour change by construction.

### 2.2 Per-turn timer (client interval, existing severity bands)
- `public/js/socketClient.js:~360-413` — on turn change, a 250 ms interval sets
  `#timer-bar` width from remaining ms and applies severity:
  - `tr <= 10` → `style.backgroundColor = var(--timer-red)` + `classList.add('timer-critical')` + tick sfx;
  - `10 < tr <= 30` → yellow; else green; class removed above 10 s and on
    interval clear (`:~371`, `:~397`).
- `public/css/01-base.css:54-56` — `--timer-green/yellow/red` (alias
  `--status-success/warning/danger`).
- `public/css/06-states-anim.css:795` — `#timer-bar.timer-critical { animation:
  timerBlink 0.7s ease-in-out infinite; }` (the existing ≤10 s blink).
- `public/css/06-states-anim.css:~972` — a **global**
  `@media (prefers-reduced-motion: reduce)` block zeroing
  `animation-duration` for `*` (comment §:970 explicitly says timer pulses are
  expected to be neutralised this way). A new keyframe is therefore
  reduced-motion-safe **automatically**, by the same established pattern as
  `timerBlink`.
- `public/css/02-hero-lobby.css:454` — `.speed-mode #timer-bar { background:
  var(--status-warning) !important; }` (a known interaction the plan must keep
  legible, see §3.2).

**Implication:** "Panic Mode" is a *more intense sub-state of the existing
critical band*, gated at `tr <= 5`, expressed as one additional class
(`timer-panic`) toggled right beside the existing `timer-critical` toggle, plus
one additive keyframe rule. No change to width math, severity colours, sfx, or
the ≤10 s critical behaviour.

### 2.3 Daily result modal (client render; UTC-midnight reset; monotonic #)
- `public/js/ui/ui-panels.js:294` `renderDailyResult(data)` renders
  `#daily-result-modal` (`#daily-result-title`, `#daily-result-subtitle`,
  `#daily-result-body`, share/close btns). `data` carries `alreadyPlayed`,
  `puzzleNumber`, `date`, `chainLength`, `chain[]`, `leaderboard[]`
  (entries `{ name, chainLength }`).
- **Phase-1 security holds:** leaderboard rows render `entry.name` only; no
  `stableId` is present in the render data or echoed. The streak/countdown
  added here are device-local and never sent to the server.
- Reset cadence: `server/systems/dailySystem.js:69` `getTodayDate(now)` derives
  `YYYY-MM-DD` from **UTC** (`getUTCFullYear/Month/Date`); inline comment:
  "rotate to the new puzzle at the same moment globally." Reset boundary =
  **next UTC 00:00:00**.
- `dailySystem.js:88` `getPuzzleNumber(date)` =
  `Math.max(1, _dayDiff(LAUNCH_DATE_UTC, date))` — strictly **monotonic, +1
  per UTC day**. Already delivered to the client as `data.puzzleNumber`.

**Implication:** the reset countdown is pure client clock math to the next UTC
midnight (no server data needed). The streak key is `puzzleNumber` itself
(server-authoritative, monotonic, timezone-proof): consecutive days ⇔
`puzzleNumber` differs by exactly 1 — no date parsing or local-timezone
ambiguity.

### 2.4 Project conventions (7.2/7.3 precedent)
- Pure, dependency-injected, unit-testable seams; thin glue at the call site
  (`modal.js`/`name-prompts.js`/`feedback.js` precedent). New behaviour lives in
  a pure module under `public/js/ui/`, barrel-exported from `public/js/ui.js`.
- Jest 30 + jsdom; client tests `client-tests/*.test.js` with the
  `/** @jest-environment jsdom */` pragma, `loadIndexHtml()` fixture, importing
  from the `../public/js/ui.js` barrel.
- Additive-only CSS into the ordered partials; the six-partial cascade order is
  load-bearing; no existing rule edited.
- Every code change ships a WHY comment.

---

## 3. Component designs

Each component is an isolated, additive unit with an existing seam; no shared
state between the three; each independently testable. These map to three
independent plan tasks.

### 3.1 Theme-Packs-With-Taste *(server string content; effort S)*

**What:** Replace each `THEMES[*].label` and `THEMES[*].description` with an
authored, characterful "program" voice — names that read like a screening
("🎃 Horror" → an authored program name) and one-line descriptions with taste,
**while keeping every `id` and every `match` function byte-identical.**

**Approach (chosen): edit only the two string fields in the `THEMES` table.**
- Alternatives rejected: (A) a client-side label map — rejected: splits the
  source of truth, the client currently has *no* theme copy and adding a parallel
  table is exactly the kind of duplication 7.3 just removed; (B) a new
  "programs" abstraction over themes — rejected: that **is** 6c's preset
  mechanic; building it here violates the §4 dedup boundary and YAGNI.
- The authored strings are a content decision finalised in the plan (a small
  curated table — name + description per existing theme id, voice consistent
  with the Phase 7 "movie-night ritual" thesis; emoji retained as a lightweight
  visual anchor since the client renders `label` directly into `<option>`).
- `decade_*` themes get program-flavoured names ("the '80s" → an authored
  retro-night name) without changing the decade ranges (the `match` fns and
  thus the actual filter are untouched).

**Guarantee:** because `id`/`match`/`clientShape` shape/`listThemes`
ordering/`isValidTheme`/`matchesTheme` are untouched, the *filter mechanic* is
provably unchanged; only displayed copy changes. This is the zero-behaviour
analogue of 7.3's refactor: the test asserts the new strings *and* that the
behavioural contract (validation + match for every id) is unchanged.

### 3.2 Panic Mode Timer *(client + additive CSS; effort S/M)*

**What:** In the final 5 seconds of a turn, escalate the existing red
`timer-critical` bar into a physical "panic" treatment (a stronger, faster
pulse — transform/opacity/box-shadow only, never width/layout) so the clutch
moment is felt.

**Approach (chosen): a pure severity function + one additive class + one
additive keyframe.**
- New pure module `public/js/ui/timer-panic.js` exporting
  `timerSeverity(secondsRemaining) → 'normal' | 'critical' | 'panic'`
  (`<=5` → `'panic'`, `<=10` → `'critical'`, else `'normal'`). Pure, no DOM,
  unit-tested in isolation (mirrors 7.2's `submissionPill` / 7.3's modal-factory
  pure-seam discipline). Barrel-exported from `ui.js`.
- `socketClient.js`: at the existing severity branch, also derive
  `timerSeverity(tr)` and toggle `timer-panic` on `#timer-bar` as a **strict
  subset of `timer-critical`** — panic implies critical (at `tr<=5` both classes
  are on), and `timer-panic` is added/removed at exactly the points
  `timer-critical` is, so it can **never outlive `timer-critical`** (added with
  it at the panic threshold; removed in *every* place `timer-critical` is
  removed — the `tr>10` branch and the interval-clear guard). The existing
  colour/width/sfx logic is unchanged — this is purely an *additional* class
  toggle driven by the pure function, mirroring `timer-critical`'s exact
  lifecycle.
- `public/css/06-states-anim.css`: an additive `#timer-bar.timer-panic { … }`
  rule with a new `@keyframes timerPanic` (faster period than `timerBlink`,
  amplified via `transform: scale()` / `box-shadow`, **no width**). Placed
  beside the existing `.timer-critical` rule (:795). Reduced-motion is honoured
  automatically by the existing global `prefers-reduced-motion` duration-zeroing
  block (same as `timerBlink`); the panic state must remain *legible without
  motion* (the red colour + a static intensified box-shadow carry the meaning
  when the animation is neutralised) — verified as a CSS requirement, not new JS.
- Speed-mode interaction (`.speed-mode #timer-bar` forces a warning background
  with `!important`): the panic treatment uses box-shadow/transform (not
  `background`), so it composes over speed-mode without fighting the
  `!important`. The plan confirms legibility in speed mode.
- Perf budget: animation restricted to compositor-friendly properties
  (transform/opacity/box-shadow), 250 ms tick cadence unchanged, no new
  timers/intervals, no layout-triggering properties.
- Alternative rejected: a JS-driven shake (rAF/inline transforms) — rejected:
  more code on the hot timer path, harder to make reduced-motion-safe, and the
  existing CSS-keyframe + global reduced-motion pattern already solves it.

### 3.3 Daily ritual: reset countdown + device-local streak *(client + additive CSS; effort M)*

**What:** On the daily result modal, add **two new additive elements**: (a) a
live "Resets in `Xh Ym`" countdown to the next UTC midnight and (b) a
device-local streak indicator ("Day `N` 🔥") that counts consecutive daily
plays. **No existing copy or DOM is edited** — the existing title, subtitle
(both the `alreadyPlayed` and post-game variants), score, replay, and
leaderboard render byte-for-byte as today; the two elements are appended. (The
"Resets in …" line *supersedes the informational value* of the existing static
"come back tomorrow" subtitle tail without modifying that string.)

**Approach (chosen): a pure `public/js/ui/daily-ritual.js` seam + thin glue in
`renderDailyResult`.**
- `daily-ritual.js` (pure, barrel-exported) exports:
  - `formatResetCountdown(now = new Date()) → string` — ms from `now` to the
    next UTC `00:00:00`, formatted `Xh Ym` (and `Ym` / `<1m` near the boundary).
    Pure function of the clock; unit-tested with injected `now`.
  - `computeDailyStreak(puzzleNumber, prev) → { streak, next }` where
    `prev`/`next` is the persisted shape `{ lastPuzzleNumber, streak }`:
    - `puzzleNumber === prev.lastPuzzleNumber` → unchanged streak (idempotent:
      re-opening the modal, or the "already played today" path, never
      double-counts);
    - `puzzleNumber === prev.lastPuzzleNumber + 1` → `streak = prev.streak + 1`;
    - otherwise (gap, first-ever, missing/corrupt `prev`) → `streak = 1`.
    Pure; the localStorage read/write is a thin separate wrapper
    (`readStreak()`/`writeStreak()`, key e.g. `mm:dailyStreak`, defensive
    JSON parse → treat any malformed value as "no prior streak"). The pure
    decision function is what the unit tests exercise.
- `renderDailyResult` (thin glue): **append** (do not modify existing nodes) a
  countdown element and a streak badge; call `computeDailyStreak` with the
  persisted value and persist `next`. A single `setInterval` (cleared on modal
  close, mirroring the existing close-button wiring) refreshes only the
  countdown element's text (no re-render of the modal body, no touch to existing
  nodes). Streak is computed once per open (idempotent), not on a timer.
- Streak counts on **any** daily result view for that puzzle (post-game *or*
  "already played today") — both mean "this device engaged with today's
  daily." This is intentional and documented; with no accounts the streak is
  inherently per-device (guardrail #1).
- **Security/guardrails:** streak + countdown are localStorage/clock only,
  never sent to the server, never added to the leaderboard payload; no
  `stableId` involvement (Phase-1 fix preserved). Device-local + room-scoped by
  construction (guardrail #2).
- Alternatives rejected: (A) server-side streak — rejected: needs durable
  per-identity storage = accounts; violates guardrail #1 (Redis is all-TTL, no
  accounts). (B) date-string streak key — rejected: `puzzleNumber` is already
  monotonic + server-authoritative, avoiding all local-timezone/ISO parsing
  ambiguity (the very reason the server keys the daily by UTC).

---

## 4. 6b/6c dedup boundary (binding)

- **6c Custom Rule Kits** (specced in
  `docs/superpowers/specs/2026-05-17-learning-breakdown-design.md` §1, pending
  build) = a **mechanic**: selectable *presets that bundle the existing
  `themesSystem` theme + mode rules* into named kits.
- **7.4 Theme-Packs-With-Taste** = **presentation only**: re-voicing the
  *existing single-select theme list's* `label`/`description` strings. It adds
  **no** bundling, **no** multi-setting preset, **no** kit selection surface,
  **no** new theme ids. The existing single `#theme-select` and its wire
  contract are unchanged.
- This keeps the two non-overlapping: 7.4 owns the *voice* of the existing
  themes; 6c (later, separate spec/plan/PR) owns the *bundling mechanic*. Should
  6c later re-author the same strings, it supersedes — there is no parallel
  system to reconcile. Decision-record guardrail #5 honoured.

---

## 5. Testing strategy

TDD per the validated pipeline; suite stays green; coverage ratchet floors
hold. Timer/daily tests are purely additive (no existing timer/daily test
edited — they are the zero-regression contract guard); the only existing tests
that may change are theme *display-string* assertions, updated to the new
authored copy as the intended deliverable (§6 Guard).

1. **Theme-Packs (`server/systems/themesSystem` test surface):**
   - `listThemes()` / `clientShape(id)` return the **new authored**
     `label`/`description` for representative ids.
   - **Behavioural-contract guard:** for *every* theme id, `isValidTheme(id)`
     is `true`, unknown ids still `false`, and `matchesTheme(id, sample)` returns
     the same result as before the re-skin (ids + `match` fns unchanged) — the
     zero-filter-change proof.
   - Client render: a jsdom assertion that `#theme-select` options carry the new
     `label` text / `title` description (additive to existing lobby-render
     coverage).
2. **Panic timer (`client-tests/timer-panic.test.js`, new):**
   - `timerSeverity`: `6/10 → 'critical'`, `5/1/0 → 'panic'`, `11/30/999 →
     'normal'`, boundary exactness at 5 and 10, non-finite/negative inputs
     degrade safely.
   - (Class-toggle wiring in `socketClient.js` is exercised behaviourally; the
     pure function carries the unit assertions, mirroring 7.2/7.3.)
3. **Daily ritual (`client-tests/daily-ritual.test.js`, new):**
   - `formatResetCountdown(now)` with injected `now` at several UTC offsets
     (just after midnight, ~1 min to midnight, mid-day) → expected `Xh Ym` /
     `Ym` / sub-minute formatting; never negative.
   - `computeDailyStreak`: first-ever (no prev) → 1; same puzzle again →
     unchanged; consecutive (+1) → increment; gap (≥+2 or earlier) → reset to 1;
     malformed `prev` → treated as no prior (→ 1). Idempotency: calling twice
     with the same `puzzleNumber` yields the same streak.
   - jsdom render: `renderDailyResult` shows the countdown line + streak badge
     for both `alreadyPlayed:true` and a post-game payload, does **not** echo
     `stableId`, and the existing score/leaderboard render is unchanged
     (regression guard).

Because the suite mocks Redis/TMDB and never boots a real server or browser,
real-boot/in-browser verification of all three surfaces is **outstanding and
user-side** (decision-record guardrail #3). Theme strings touch the server data
table (no boot/dep change) but are visual; the timer and daily changes touch the
submit/render path — the in-browser eyeball gate explicitly applies.

---

## 6. Files (approximate — the plan pins exact line targets)

**Modify**
- `server/systems/themesSystem.js` — re-voice `label`/`description` for all 11
  `THEMES` entries; `id`/`match`/exports untouched.
- `public/js/socketClient.js` — at the existing timer-severity branch, derive
  `timerSeverity(tr)` and toggle the additive `timer-panic` class (added beside
  `timer-critical`, removed in the same two places).
- `public/js/ui/ui-panels.js` — `renderDailyResult`: thin additive countdown
  line + streak badge + minute-tick interval cleared on close.
- `public/js/ui.js` — barrel re-export of the two new modules.
- `public/css/06-states-anim.css` — additive `#timer-bar.timer-panic` +
  `@keyframes timerPanic`; additive daily countdown/streak rules (placed in the
  partial that already owns the daily-result styles — plan pins it; additive
  only).

**Create**
- `public/js/ui/timer-panic.js` — pure `timerSeverity`.
- `public/js/ui/daily-ritual.js` — pure `formatResetCountdown` +
  `computeDailyStreak` + thin localStorage wrapper.
- `client-tests/timer-panic.test.js`, `client-tests/daily-ritual.test.js`,
  and theme-reskin assertions in the existing themes test location.

**Guard:** existing **timer** and **daily** tests stay **byte-identical and
green** (those changes are purely additive — zero-regression contract). For
**themes**, the *behavioural/structural* assertions (validation, `match`,
`clientShape` shape, `listThemes` ordering) stay green unmodified; any existing
assertion that pins the *old display strings* is updated to the new authored
copy as the **intended TDD deliverable** (a copy change *is* the spec here — the
assertion encodes the copy contract; it is not a regression).

---

## 7. Cross-cutting guardrails (binding — restated from decision-record §3)

1. **No accounts.** Streak is `localStorage` + room-scoped; no auth, no durable
   server datastore.
2. **Daily-leaderboard security.** No `stableId` echoed; the streak/countdown
   are device-local and never enter any server payload.
3. **Real-boot + in-browser gate.** All three surfaces' visual correctness is
   user-side; "merged" ≠ "deployed"; confirm Render `live` (read-only) post-merge.
4. **Perf budget.** Panic animation is compositor-only (transform/opacity/
   box-shadow), no new intervals on the timer path; the daily countdown uses one
   minute-cadence interval cleared on close. `prefers-reduced-motion` honoured
   via the existing global block.
5. **6b/6c dedup.** §4 — Theme Packs is presentational only; no preset/kit
   mechanic.
6. **Pipeline & branch safety.** Own spec→plan→subagent-build→PR; isolated
   worktree off the then-current `origin/main` (`602ad74`); a parallel Codex
   agent shares this repo → verify branch before every commit, never
   history-rewrite a shared branch; native Task tools unavailable → TodoWrite +
   hand-authored co-located `.tasks.json`; per-task two-stage review
   (spec-compliance then code-quality) + final most-capable-model holistic;
   PR-merge / push-to-main / Render deploy is classifier-gated and handed to the
   user.
7. **Comments.** Every code change ships an explanatory WHY comment.
8. **Scope discipline.** Out-of-scope findings during reviews → `spawn_task`
   chip, never widen 7.4's scope (Player Entrance Cards / Host Director panel
   belong to 7.5; never absorb them here).

---

## 8. Explicitly out of scope / deferred

- **Player Entrance Cards** + **consolidated Host Director controls** → **7.5
  Red Carpet Lobby** (own spec/plan/PR). Not built or stubbed here.
- Any **bundling / preset / "named program kit" mechanic** → **6c Custom Rule
  Kits** (separate spec). 7.4 is presentation-only on the existing single theme
  select.
- **LM-04 "enforce true 2v2"** gameplay/balance change → deferred product
  decision (decision-record §5).
- Any new socket event, server logic/scoring/validation change, new Redis key,
  persistence, or account mechanic.
- Redesign of the theme picker, timer, or daily modal layout/structure (this is
  additive copy + one additive timer state + two additive daily blocks only).

---

## 9. Process notes

Ships via the validated pipeline (Phases 1–7.3): **spec → writing-plans →
subagent-driven-development → finishing-a-development-branch**.

- This spec is committed on the **feature branch
  `phase7-4-quick-win-identity`** in the **isolated worktree `C:\mm-phase7-4`**
  (off `602ad74`, `node_modules` junctioned to the shared install). The plan +
  co-located `.md.tasks.json` are committed on the same branch. Local `main`
  stays clean; the spec/plan/build all ride to `origin` via the PR. A parallel
  Codex agent shares this repo → `git -C C:/mm-phase7-4 branch --show-current`
  is verified `== phase7-4-quick-win-identity` before **every** commit.
- Three independent plan tasks (Theme Packs / Panic Timer / Daily ritual), each
  TDD, each with an independent spec-compliance review then code-quality review
  and real fix-loops; a final opus whole-branch holistic review before
  finishing.
- WHY-comments on every changed line; `coverage/` never staged.
- Finishing: push the feature branch + `gh pr create` (base `main`,
  `origin/main` = `602ad74`). PR-merge / push-to-main / Render deploy is
  classifier-gated and **handed to the user**. Post-merge: the owed reconcile
  mirrors 7.1/7.2/7.3 (ff local main, unlink the `node_modules` junction with
  `cmd /c rmdir`, `git worktree remove` + prune, delete the merged branch,
  update memory).
