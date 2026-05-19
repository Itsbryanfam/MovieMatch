# Phase 7.7 — Constellation Board + Save Moment + Per-Turn Motion Timeline: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-game vertical chain card list with a horizontal "Constellation" filmstrip (length-aware reel + glowing now-playing hero + full-name, all-member, ungated cast panel + labeled actor bridges + best-effort burned stamp), add a clutch-only Save Moment, and add one reusable pure per-turn motion timeline — all client-only, behaviour-equivalent, zero server regression.

**Architecture:** One new pure zero-import seam `public/js/ui/turn-motion.js` (`buildTurnTimeline` + `isClutchSave`) — the validated `red-carpet.js`/`chain-recap.js` pattern (no DOM/timers/clock/RNG, fully unit-tested). `renderChainItems` in `public/js/ui/ui-render.js` is transformed into the filmstrip DOM driver that consumes the engine; the per-turn choreography uses a single leak-safe `setTimeout`-chain handle mirroring `recap-player.js`. `socketClient.js` calls one new additive ui export to flag a clutch on the `playing` edge (no signature change to `renderGame`, no socket/protocol change). CSS is append-only to 7.7's own blocks in `03-game.css` (structural) + `06-states-anim.css` (motion, neutralized by the **existing** global `prefers-reduced-motion` `*` block at L1020 — no new motion `@media`).

**Tech Stack:** Vanilla ES-module no-build client; Jest 30 two-project config (client = jsdom, `client-tests/setup.js` setup); CommonJS `require` in tests; isolated git worktree `C:\mm-phase7-7` on branch `phase7-7-constellation-board` off `origin/main` `20f4c95`, `node_modules` junctioned to the shared `C:\moviematch-git\node_modules` (359). A parallel Codex agent shares the repo → **branch-verify `git -C C:/mm-phase7-7 branch --show-current == phase7-7-constellation-board` before EVERY commit.**

**Task tracking:** Native Task tools are unavailable → the validated MovieMatch substitution: `TodoWrite` for in-session tracking + the hand-authored co-located `docs/superpowers/plans/2026-05-19-constellation-board.md.tasks.json`. After each task is spec-clean AND quality-clean, set its `.tasks.json` status to `"completed"` + bump `lastUpdated` and commit that sync as its OWN follow-up commit.

**Spec:** `docs/superpowers/specs/2026-05-19-constellation-board-design.md` (committed `bd8b3fc`). Read it; every locked decision §1.1–§1.10, the §3.1 Phase schema, §4 behavioural-equivalence axes 4.1–4.8, and §5 the redefined ratchet are binding.

---

## File Structure (decomposition locked here)

| File | Task | Responsibility |
|---|---|---|
| `public/js/ui/turn-motion.js` | T0 | **NEW.** Pure zero-import engine: `buildTurnTimeline` (§3.1 schema) + `isClutchSave` (predicate). No DOM/timers/clock/RNG. |
| `public/js/ui.js` | T0 | **MODIFY (append 1 line).** Barrel re-export `export * from './ui/turn-motion.js'` (the 7.6 lesson — consumers/tests resolve the seam via the barrel). |
| `client-tests/turn-motion.test.js` | T0 | **NEW.** Pure-engine unit suite (direct `require`, node-pure; +1 fs-source barrel-wiring assertion + 1 boundary-agreement vs `timer-panic.js`). |
| `public/js/ui/ui-render.js` | T1, T2 | **MODIFY (only the `renderChainItems` body + 1 new additive export + the choreography helper it calls).** Everything else byte-identical (`showGameOverBanner`, `renderGame` game-over branch, `renderLobby`/team paths). |
| `public/css/03-game.css` | T1, T2 | **MODIFY (append-only at EOF, 7.7's own block).** Filmstrip structural CSS + the one layout `@media (max-width: 767px)` mobile sticky-strip (existing codebase breakpoint; NOT a motion `@media`). No pre-existing rule edited. |
| `public/css/06-states-anim.css` | T2 | **MODIFY (append-only at EOF, 7.7's own block).** Compositor-only `@keyframes`/transition classes — neutralized by the existing global `*` reduced-motion block (L1020). No new `prefers-reduced-motion` `@media`, no new colour. |
| `public/js/socketClient.js` | T2 | **MODIFY (1 additive block).** On the `playing` edge, compute the clutch boolean from `prevState` + the existing timer and call the new additive ui export. No signature/protocol/socket-event change. |
| `client-tests/render-chain.test.js` | T1, T2 | **REWRITE (the §1.9 legitimate guard rewrite, the 7.5.2 precedent).** Pins the NEW filmstrip contract with an enumerated §4 axes 4.1–4.8 assertion block. |

**Untouched & byte-identical (the §5 proof surface):** all `server/**`, `gameLogic`, socket protocol; `showGameOverBanner` + `renderGame`'s game-over branch + `renderLobby`/team paths + the 7.6 `#recap-overlay` wiring in `socketClient.js`; `client-tests/socket-handlers.test.js`, `showScreen.test.js`, `render-lobby.test.js`, `red-carpet*.test.js`, `chain-recap.test.js`, `recap-player.test.js`; `public/index.html` (`#chain-display` L425 is the unchanged mount — the filmstrip is built into it by `createElement`, **no markup change**); `client-tests/setup.js` (the driver receives `reducedMotion` computed at the call site — it never calls `matchMedia` itself, the `recap-player.js` precedent — so **no `matchMedia` stub is needed**; this file was evaluated per the 7.6 lesson and is correctly out of scope).

---

### Task 0: Pure per-turn motion engine (`turn-motion.js`)

**Goal:** A pure, deterministic, zero-import `turn-motion.js` exporting `buildTurnTimeline` (the §3.1 Phase schedule) and `isClutchSave` (the panic-window predicate), barrel-wired, fully unit-tested.

**Files:**
- Create: `public/js/ui/turn-motion.js`
- Modify: `public/js/ui.js:19` (append one barrel line after L18)
- Test: `client-tests/turn-motion.test.js`

**Acceptance Criteria:**
- [ ] `buildTurnTimeline` returns ordered `handoff→think→submit→reveal→impact`, indices 0..4, `atMs` = running sum of prior `durMs`, non-`think` `durMs` frozen (400/250/600/500), `think.durMs` = caller `thinkMs` (omitted/non-finite/≤0 → 0), `impact.meta.clutch` = `!!input.clutch`.
- [ ] `isClutchSave` is pure & boundary-correct: `valid!==true → false`; non-finite/missing `secondsRemaining → false`; `valid && clampedSeconds ≤ 5 → true`; `valid && seconds 6 → false`; negative seconds clamp to 0 (→ true).
- [ ] Zero-import (no `import`/`require` in the source); deterministic (no `Date`/`Math.random`/DOM/timers); zero-identity (inputs are numbers/booleans only).
- [ ] `public/js/ui.js` re-exports the module; `isClutchSave` agrees with `timer-panic.js` `timerSeverity`'s `'panic'` band at the 4/5/6s boundary.

**Verify:** `cd C:/mm-phase7-7 && npx jest client-tests/turn-motion.test.js` → all pass; then `cd C:/mm-phase7-7 && npx jest` → full suite green (baseline 61 suites/500 tests → 62/≈510, additive).

**Steps:**

- [ ] **Step 1: Write the failing test** — `client-tests/turn-motion.test.js`:

```js
// client-tests/turn-motion.test.js — Phase 7.7 Task 0
// WHY: turn-motion.js is the pure zero-import seam (red-carpet.js/chain-recap.js
// pattern) the filmstrip DOM driver consumes. This suite pins the §3.1 Phase
// schema (order/determinism/frozen timings/atMs running-sum/caller-supplied
// think), the isClutchSave boundary, the zero-identity invariant, the barrel
// wiring (the 7.6 lesson — consumers resolve it via ./ui.js), and that the
// clutch boundary stays in agreement with timer-panic.js's 'panic' band.
const fs = require('fs');
const path = require('path');
const { buildTurnTimeline, isClutchSave } = require('../public/js/ui/turn-motion.js');
const { timerSeverity } = require('../public/js/ui/timer-panic.js');

const NAMES = ['handoff', 'think', 'submit', 'reveal', 'impact'];

describe('buildTurnTimeline — §3.1 schema', () => {
  test('ordered handoff→think→submit→reveal→impact with 0-based indices', () => {
    const tl = buildTurnTimeline({ thinkMs: 60000 });
    expect(tl.map(p => p.name)).toEqual(NAMES);
    expect(tl.map(p => p.index)).toEqual([0, 1, 2, 3, 4]);
  });

  test('non-think durations are frozen constants (400/250/600/500)', () => {
    const tl = buildTurnTimeline({ thinkMs: 1234 });
    const byName = Object.fromEntries(tl.map(p => [p.name, p.durMs]));
    expect(byName.handoff).toBe(400);
    expect(byName.submit).toBe(250);
    expect(byName.reveal).toBe(600);
    expect(byName.impact).toBe(500);
  });

  test('think.durMs is the caller-supplied thinkMs (floored)', () => {
    expect(buildTurnTimeline({ thinkMs: 60000 })[1].durMs).toBe(60000);
    expect(buildTurnTimeline({ thinkMs: 1500.9 })[1].durMs).toBe(1500);
  });

  test('omitted / non-finite / non-positive thinkMs → 0 (producer is clock-free)', () => {
    expect(buildTurnTimeline()[1].durMs).toBe(0);
    expect(buildTurnTimeline({})[1].durMs).toBe(0);
    expect(buildTurnTimeline({ thinkMs: NaN })[1].durMs).toBe(0);
    expect(buildTurnTimeline({ thinkMs: -5 })[1].durMs).toBe(0);
    expect(buildTurnTimeline({ thinkMs: 'x' })[1].durMs).toBe(0);
  });

  test('atMs is the running sum of prior durMs', () => {
    const tl = buildTurnTimeline({ thinkMs: 1000 });
    expect(tl.map(p => p.atMs)).toEqual([0, 400, 1400, 1650, 2250]);
  });

  test('deterministic — same input ⇒ deep-equal output', () => {
    expect(buildTurnTimeline({ thinkMs: 5000, clutch: true }))
      .toEqual(buildTurnTimeline({ thinkMs: 5000, clutch: true }));
  });

  test('impact.meta.clutch reflects input.clutch (default false)', () => {
    expect(buildTurnTimeline({ thinkMs: 1 })[4].meta.clutch).toBe(false);
    expect(buildTurnTimeline({ thinkMs: 1, clutch: true })[4].meta.clutch).toBe(true);
    expect(buildTurnTimeline({ thinkMs: 1, clutch: 'truthy' })[4].meta.clutch).toBe(true);
  });

  test('zero-identity sentinel — no identifier can appear in the schedule', () => {
    const json = JSON.stringify(buildTurnTimeline({ thinkMs: 42, clutch: true }));
    expect(json).not.toMatch(/stableId|socket|playerId|_id/i);
    expect(json).not.toContain('undefined');
  });
});

describe('isClutchSave — predicate', () => {
  test('invalid move is never a clutch save', () => {
    expect(isClutchSave({ valid: false, secondsRemaining: 1 })).toBe(false);
    expect(isClutchSave({ secondsRemaining: 1 })).toBe(false);
    expect(isClutchSave()).toBe(false);
  });
  test('valid move outside the panic window is not a clutch save', () => {
    expect(isClutchSave({ valid: true, secondsRemaining: 6 })).toBe(false);
    expect(isClutchSave({ valid: true, secondsRemaining: 10 })).toBe(false);
  });
  test('valid move inside the panic window IS a clutch save', () => {
    expect(isClutchSave({ valid: true, secondsRemaining: 5 })).toBe(true);
    expect(isClutchSave({ valid: true, secondsRemaining: 3 })).toBe(true);
    expect(isClutchSave({ valid: true, secondsRemaining: 0 })).toBe(true);
    expect(isClutchSave({ valid: true, secondsRemaining: -2 })).toBe(true); // overran clock clamps to 0
  });
  test('non-finite secondsRemaining → false (unknown state never flashes clutch)', () => {
    expect(isClutchSave({ valid: true, secondsRemaining: NaN })).toBe(false);
    expect(isClutchSave({ valid: true, secondsRemaining: 'x' })).toBe(false);
    expect(isClutchSave({ valid: true })).toBe(false);
  });
});

describe('integration invariants', () => {
  test('barrel wiring — public/js/ui.js re-exports turn-motion (the 7.6 lesson)', () => {
    // Source assertion (not an import) so this pure suite never loads the
    // DOM-heavy barrel; pins that consumers/other tests resolve the seam.
    const barrel = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');
    expect(barrel).toContain("export * from './ui/turn-motion.js'");
  });

  test('clutch boundary stays in agreement with timer-panic.js panic band', () => {
    // timerSeverity: <=5 'panic'. isClutchSave must mirror that exact boundary
    // (CLUTCH_PANIC_MAX_SECONDS is a frozen local const to keep turn-motion.js
    // zero-import; THIS test is the anti-drift guarantee).
    for (const s of [0, 3, 5]) {
      expect(timerSeverity(s)).toBe('panic');
      expect(isClutchSave({ valid: true, secondsRemaining: s })).toBe(true);
    }
    expect(timerSeverity(6)).not.toBe('panic');
    expect(isClutchSave({ valid: true, secondsRemaining: 6 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/mm-phase7-7 && npx jest client-tests/turn-motion.test.js`
Expected: FAIL — `Cannot find module '../public/js/ui/turn-motion.js'`.

- [ ] **Step 3: Write the minimal implementation** — create `public/js/ui/turn-motion.js`:

```js
// public/js/ui/turn-motion.js — Phase 7.7 pure per-turn motion timeline +
// clutch-save predicate.
// WHY: this is the single, reusable, ZERO-IMPORT pure seam (the red-carpet.js /
// chain-recap.js pattern). It owns NO DOM, NO timers, NO clock, NO randomness,
// so it is fully unit-testable; the filmstrip DOM driver in ui-render.js
// consumes it. buildTurnTimeline + isClutchSave are bundled here because both
// are "turn dynamics" always used together by that one driver — the
// one-pure-engine-per-sub-phase precedent (red-carpet.js bundles diffArrivals/
// playerCardModel/…; chain-recap.js bundles buildRecapStoryboard/…).

// Frozen per-phase durations (ms). 'think' is intentionally NOT here — its
// duration is the live turn length, supplied by the caller, so this producer
// never reads a clock. WHY these values: the non-think choreography must be
// tight (it runs EVERY turn, not once) — 400+250+600+500 = 1750ms ≈ spec
// §3.1's ~1.75s budget.
const PHASE_DURATIONS = Object.freeze({ handoff: 400, submit: 250, reveal: 600, impact: 500 });

// WHY a frozen local constant (not an import): turn-motion.js is a ZERO-IMPORT
// pure seam (the red-carpet.js invariant the spec §3.2 states verbatim). This
// mirrors timer-panic.js timerSeverity()'s `<= 5` 'panic' band — the single
// conceptual source. turn-motion.test.js imports timerSeverity and asserts
// isClutchSave agrees at the 4/5/6s boundary, so the two can never drift.
const CLUTCH_PANIC_MAX_SECONDS = 5;

/**
 * Build the deterministic per-turn motion timeline.
 * @param {{ thinkMs?: number, clutch?: boolean }} [input]
 *   thinkMs — the live turn length (caller-supplied; the ONLY non-frozen
 *             duration). Omitted/non-finite/≤0 → 0 (producer never reads a clock).
 *   clutch  — whether this turn ended in a clutch save (drives impact.meta).
 * @returns {Array<{name:string,index:number,atMs:number,durMs:number,meta:object}>}
 *   ordered handoff→think→submit→reveal→impact; atMs = running sum of prior durMs.
 */
export function buildTurnTimeline(input = {}) {
  const raw = input && input.thinkMs;
  const thinkMs = (typeof raw === 'number' && Number.isFinite(raw) && raw > 0)
    ? Math.floor(raw) : 0;
  const clutch = !!(input && input.clutch);
  const spec = [
    ['handoff', PHASE_DURATIONS.handoff, {}],
    ['think', thinkMs, {}],
    ['submit', PHASE_DURATIONS.submit, {}],
    ['reveal', PHASE_DURATIONS.reveal, {}],
    ['impact', PHASE_DURATIONS.impact, { clutch }],
  ];
  let at = 0;
  return spec.map(([name, durMs, meta], index) => {
    const phase = { name, index, atMs: at, durMs, meta };
    at += durMs;
    return phase;
  });
}

/**
 * Pure clutch-save predicate. A "clutch save" = a VALID answer that landed
 * while the turn timer was inside the panic window (mirrors timer-panic.js
 * timerSeverity's 'panic' band, ≤5s). Reads no DOM/timer/clock — the caller
 * supplies plain values.
 * @param {{ valid?: boolean, secondsRemaining?: number }} [input]
 * @returns {boolean}
 */
export function isClutchSave(input = {}) {
  if (!input || input.valid !== true) return false;
  const s = input.secondsRemaining;
  if (typeof s !== 'number' || !Number.isFinite(s)) return false;
  const clamped = s < 0 ? 0 : s;
  return clamped <= CLUTCH_PANIC_MAX_SECONDS;
}
```

- [ ] **Step 4: Wire the barrel** — `public/js/ui.js`, append after L18 (the last `export *`, `recap-player.js`):

```js
export * from './ui/turn-motion.js';   // Phase 7.7: pure per-turn motion timeline + clutch-save predicate
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd C:/mm-phase7-7 && npx jest client-tests/turn-motion.test.js`
Expected: PASS (all describe blocks green).

- [ ] **Step 6: Run the full suite (zero-regression gate)**

Run: `cd C:/mm-phase7-7 && npx jest`
Expected: PASS — 62 suites / ≈510 tests (the 61/500 baseline + the new `turn-motion.test.js`; every pre-existing suite byte-identical & green; `level:50` lines are the pre-existing redis-down fixtures).

- [ ] **Step 7: Branch-verify, then commit**

```bash
B=$(git -C C:/mm-phase7-7 branch --show-current); [ "$B" = "phase7-7-constellation-board" ] && git -C C:/mm-phase7-7 add public/js/ui/turn-motion.js public/js/ui.js client-tests/turn-motion.test.js && git -C C:/mm-phase7-7 commit -m "feat(7.7 T0): pure turn-motion engine (buildTurnTimeline + isClutchSave) + barrel"
```

---

### Task 1: Filmstrip render + the behavioural-equivalence guard rewrite

**Goal:** Transform `renderChainItems` into the length-aware filmstrip (reel of poster nodes + labeled actor bridges + glowing now-playing hero + full-width full-name all-member ungated cast panel + best-effort burned stamp), append the structural CSS, and rewrite `client-tests/render-chain.test.js` to pin the new contract with the enumerated §4 axes. Settled/static render only — the per-turn choreography is Task 2.

**Files:**
- Modify: `public/js/ui/ui-render.js` — replace the `renderChainItems` body (currently L618–727); nothing else in the file changes.
- Modify: `public/css/03-game.css` — append 7.7's structural block at EOF (after L488).
- Rewrite: `client-tests/render-chain.test.js`.

**Acceptance Criteria:**
- [ ] §4.1 every chain entry → a `.reel-node` in chain order; §4.2 linking actor on `.reel-bridge` + `.now-cast-link` "linked via"; §4.3 last entry = `.reel-node.now-playing`; §4.4 `.now-cast-list` has every cast member, **full names**, no abbreviation, no expand/“+N more” control; §4.5 `.reel-burned-stamp` only when `entry.eliminated===true` (absent on normal data — no fabrication); §4.6 zero `stableId`/identity in `#chain-display`; §4.8 empty-board hint preserved, stale `.game-over-banner` cleanup when playing preserved, **`showGameOverBanner`'s appended banner is NOT clobbered** by a subsequent `renderChainItems`.
- [ ] `showGameOverBanner`, `renderGame`'s game-over branch, `renderLobby`/team paths unchanged (diff shows only the `renderChainItems` body).
- [ ] 03-game.css change is append-only at EOF (no pre-existing rule edited); no new colour value (existing tokens + the verbatim brand accent `rgba(129,140,248,…)`); the only `@media` is the existing-breakpoint layout `max-width:767px` (not a motion `@media`).
- [ ] `index.html` unchanged; all non-rewritten guard suites + `server/**` byte-identical & green.

**Verify:** `cd C:/mm-phase7-7 && npx jest` → full green; `git -C C:/mm-phase7-7 diff --stat 20f4c95 -- public/js/ui/ui-render.js` → only `renderChainItems` lines; `git -C C:/mm-phase7-7 diff 20f4c95 -- public/index.html` → empty.

**Steps:**

- [ ] **Step 1: Rewrite the failing test** — replace the entire contents of `client-tests/render-chain.test.js` with:

```js
/**
 * @jest-environment jsdom
 */
// client-tests/render-chain.test.js — Phase 7.7 (REWRITTEN — the §1.9/§5
// legitimate guard rewrite, the 7.5.2 Theater-Lobby precedent).
// WHY: renderChainItems is deliberately transformed from the vertical
// .chain-item card list into the horizontal Constellation filmstrip. This
// suite pins the NEW contract and EVERY spec §4 behavioural-equivalence axis
// (4.1–4.8) so the transform provably preserves all gameplay-load-bearing
// behaviour. jsdom never lays out / has no matchMedia → renderChainItems
// computes reducedMotion at the call site and paints the SETTLED end-state
// (no timers) here; the motion fidelity is the user-side eyeball (spec §9.8).
import { initUIElements, renderGame } from '../public/js/ui.js';
const { loadIndexHtml, makePlayingState, makeChainItem, makePlayer } = require('./fixtures');

const display = () => document.getElementById('chain-display');

beforeEach(() => { loadIndexHtml(); initUIElements(); });

describe('filmstrip — §4 behavioural-equivalence', () => {
  test('§4.8 empty-board hint shown when chain empty & playing', () => {
    renderGame(makePlayingState({ chain: [] }), 'host_id', false);
    expect(display().querySelector('.empty-board-hint')).not.toBeNull();
    expect(display().querySelector('.filmstrip')).toBeNull();
  });

  test('§4.8 first move → hint removed, filmstrip appears', () => {
    renderGame(makePlayingState({ chain: [] }), 'host_id', false);
    renderGame(makePlayingState({ chain: [makeChainItem()] }), 'host_id', false);
    expect(display().querySelector('.empty-board-hint')).toBeNull();
    expect(display().querySelector('.filmstrip .reel .reel-node')).not.toBeNull();
  });

  test('§4.1 every chain entry → a reel node, in chain order', () => {
    const chain = [
      makeChainItem({ movie: { title: 'Iron Man', year: 2008, cast: ['Robert Downey Jr.'], poster: '' } }),
      makeChainItem({ movie: { title: 'Sherlock Holmes', year: 2009, cast: ['Robert Downey Jr.'], poster: '' }, matchedActors: ['Robert Downey Jr.'] }),
      makeChainItem({ movie: { title: 'Tropic Thunder', year: 2008, cast: ['Robert Downey Jr.'], poster: '' }, matchedActors: ['Robert Downey Jr.'] }),
    ];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    const titles = [...display().querySelectorAll('.reel-node .reel-title')].map(n => n.textContent);
    expect(titles).toEqual(['Iron Man (2008)', 'Sherlock Holmes (2009)', 'Tropic Thunder (2008)']);
  });

  test('§4.2 linking actor surfaced as a bridge label + the now-cast "linked via"', () => {
    const chain = [
      makeChainItem({ movie: { title: 'A', year: 2001, cast: ['Tom Hanks'], poster: '' } }),
      makeChainItem({ movie: { title: 'B', year: 2002, cast: ['Tom Hanks'], poster: '' }, matchedActors: ['Tom Hanks'] }),
    ];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    const bridges = [...display().querySelectorAll('.reel-bridge')].map(n => n.textContent);
    expect(bridges).toEqual(['↔ Tom Hanks']); // one bridge, before the 2nd node
    expect(display().querySelector('.now-cast-link').textContent).toContain('linked via Tom Hanks');
  });

  test('§4.3 the last entry is the now-playing hero', () => {
    const chain = [
      makeChainItem({ movie: { title: 'First', year: 2000, cast: ['X'], poster: '' } }),
      makeChainItem({ movie: { title: 'Latest', year: 2020, cast: ['X'], poster: '' }, matchedActors: ['X'] }),
    ];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    const nodes = [...display().querySelectorAll('.reel-node')];
    expect(nodes[nodes.length - 1].classList.contains('now-playing')).toBe(true);
    expect(nodes[0].classList.contains('now-playing')).toBe(false);
    expect(display().querySelector('.now-cast-title').textContent).toBe('Latest (2020)');
  });

  test('§4.4 cast panel shows EVERY member, FULL names, ungated (no abbrev, no expand)', () => {
    const cast = [
      'Christian Bale', 'Heath Ledger', 'Aaron Eckhart', 'Michael Caine',
      'Maggie Gyllenhaal', 'Gary Oldman', 'Morgan Freeman', 'Monique Gabriela Curnen',
      'Ron Dean', 'Cillian Murphy', 'Chin Han', 'Nestor Carbonell',
    ];
    const chain = [makeChainItem({ movie: { title: 'The Dark Knight', year: 2008, cast, poster: '' } })];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    const names = [...display().querySelectorAll('.now-cast-list .cast-name')].map(n => n.textContent);
    expect(names).toEqual(cast); // all 12, full names, in billing order
    // ungated: no expand/"show all"/"+N more" control anywhere in the panel
    expect(display().querySelector('.now-cast').textContent).not.toMatch(/show all|\+\s*\d+\s*more/i);
    // no first-name abbreviation leaked in
    expect(display().querySelector('.now-cast-list').textContent).not.toMatch(/\b[A-Z]\.\s/);
  });

  test('§4.4 cast tolerates {id,name} objects and legacy bare strings', () => {
    const chain = [makeChainItem({ movie: { title: 'M', year: 2009, poster: '', cast: [
      { id: 1, name: 'Sam Worthington' }, 'Zoe Saldana', { id: 3, name: 'Sigourney Weaver' },
    ] } })];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    expect([...display().querySelectorAll('.cast-name')].map(n => n.textContent))
      .toEqual(['Sam Worthington', 'Zoe Saldana', 'Sigourney Weaver']);
  });

  test('§4.5 burned stamp absent on normal data; present iff entry.eliminated===true', () => {
    const normal = [makeChainItem(), makeChainItem({ matchedActors: ['x'] })];
    renderGame(makePlayingState({ chain: normal }), 'host_id', false);
    expect(display().querySelector('.reel-burned-stamp')).toBeNull(); // no fabrication
    expect(display().querySelector('.reel-node.burned')).toBeNull();

    loadIndexHtml(); initUIElements();
    const withElim = [
      { ...makeChainItem(), eliminated: true },
      makeChainItem({ matchedActors: ['x'] }),
    ];
    renderGame(makePlayingState({ chain: withElim }), 'host_id', false);
    expect(display().querySelectorAll('.reel-node.burned').length).toBe(1);
    expect(display().querySelector('.reel-burned-stamp').textContent).toBe('OUT');
  });

  test('§4.6 zero stableId / identity in the rendered filmstrip DOM', () => {
    const players = [
      makePlayer({ id: 'sock_AAA', stableId: 'stable_SECRET_1', name: 'Ann', isHost: true }),
      makePlayer({ id: 'sock_BBB', stableId: 'stable_SECRET_2', name: 'Bo' }),
    ];
    const chain = [
      makeChainItem({ playerName: 'Ann', playerId: 'sock_AAA', movie: { title: 'A', year: 2001, cast: ['Q'], poster: '' } }),
      makeChainItem({ playerName: 'Bo', playerId: 'sock_BBB', movie: { title: 'B', year: 2002, cast: ['Q'], poster: '' }, matchedActors: ['Q'] }),
    ];
    renderGame(makePlayingState({ players, chain }), 'sock_AAA', false);
    const html = display().innerHTML;
    expect(html).not.toContain('stable_SECRET_1');
    expect(html).not.toContain('stable_SECRET_2');
    expect(html).not.toContain('sock_AAA');
    expect(html).not.toContain('sock_BBB');
  });

  test('§4.8 a subsequent render does NOT clobber showGameOverBanner', () => {
    // game-over: renderGame runs renderChainItems (filmstrip) AND the
    // game-over branch appends .game-over-banner into #chain-display.
    // A later stateUpdate re-render must keep BOTH (filmstrip never wipes
    // #chain-display.innerHTML — it rebuilds only its .filmstrip child).
    const chain = [makeChainItem({ movie: { title: 'Fin', year: 2021, cast: ['Z'], poster: '' } })];
    const finished = { ...makePlayingState({ chain }), status: 'finished', winner: { name: 'Host', score: 3 } };
    renderGame(finished, 'host_id', false);
    // simulate showGameOverBanner having appended its banner
    const banner = document.createElement('div');
    banner.className = 'game-over-banner';
    banner.textContent = '🏆 Host wins!';
    display().appendChild(banner);
    // a re-fired stateUpdate re-renders the same finished state
    renderGame(finished, 'host_id', false);
    expect(display().querySelector('.game-over-banner')).not.toBeNull();
    expect(display().querySelector('.game-over-banner').textContent).toBe('🏆 Host wins!');
    expect(display().querySelector('.filmstrip .reel-node')).not.toBeNull();
  });

  test('§4.8 chain reset (shrink to empty) clears the filmstrip', () => {
    renderGame(makePlayingState({ chain: [makeChainItem(), makeChainItem({ matchedActors: ['x'] })] }), 'host_id', false);
    expect(display().querySelector('.filmstrip')).not.toBeNull();
    renderGame(makePlayingState({ chain: [] }), 'host_id', false);
    expect(display().querySelector('.filmstrip')).toBeNull();
    expect(display().querySelector('.empty-board-hint')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/mm-phase7-7 && npx jest client-tests/render-chain.test.js`
Expected: FAIL — the new `.filmstrip`/`.reel-node`/`.now-cast-*` selectors don't exist (the old `renderChainItems` builds `.chain-item`).

- [ ] **Step 3: Transform `renderChainItems`** — in `public/js/ui/ui-render.js`, replace the **entire function body** of `renderChainItems` (currently L618–727, from `function renderChainItems(gameState, myPlayerId) {` through its closing `}`) with exactly:

```js
// Phase 7.7: the chain is the horizontal Constellation filmstrip — a reel of
// poster nodes + labeled actor bridges + a glowing now-playing hero + a
// full-width, full-name, ALL-member, ungated cast panel. WHY a deterministic
// full rebuild of a .filmstrip CHILD of #chain-display (NOT #chain-display
// .innerHTML): showGameOverBanner independently appendChild()s its
// .game-over-banner into #chain-display at game-over — rebuilding only the
// .filmstrip child leaves that banner sibling byte-identical and never
// clobbered (spec §1.7 / §4.8). Task 1 paints the SETTLED end-state on every
// render; Task 2 layers the per-turn motion timeline + Clutch Save on top
// without removing any behaviour here.
function renderChainItems(gameState, myPlayerId) {
  const displayEl = chainDisplay;
  const chain = gameState.chain;

  // pre-first-move: the empty-board hint (preserved verbatim from the 1.0,
  // built with createElement so it never relies on innerHTML for the path
  // the §4.8 test pins).
  if (chain.length === 0 && gameState.status === 'playing') {
    displayEl.querySelector('.filmstrip')?.remove();
    if (!displayEl.querySelector('.empty-board-hint')) {
      const hint = document.createElement('div');
      hint.className = 'empty-board-hint';
      const icon = document.createElement('span');
      icon.className = 'empty-board-icon';
      icon.textContent = '🎬';
      const title = document.createElement('span');
      title.className = 'empty-board-title';
      title.textContent = 'The board is empty';
      const sub = document.createElement('span');
      sub.className = 'empty-board-sub';
      sub.textContent = 'Waiting for the first move...';
      hint.appendChild(icon);
      hint.appendChild(title);
      hint.appendChild(sub);
      displayEl.appendChild(hint);
    }
    return;
  }

  // hard reset (chain cleared / new game) — drop the filmstrip + any hint
  // (the 1.0 L626-630 intent: nothing to show).
  if (chain.length === 0) {
    displayEl.querySelectorAll('.filmstrip, .empty-board-hint').forEach(n => n.remove());
    return;
  }

  // a (re)started game has a chain again → clear stale end-of-game artifacts
  // (preserved verbatim from the 1.0 L632-637).
  if (gameState.status === 'playing') {
    displayEl.querySelector('.game-over-banner')?.remove();
    displayEl.querySelector('.empty-hint')?.remove();
    displayEl.querySelector('.empty-board-hint')?.remove();
  }

  // .filmstrip is the rebuilt child; its dataset.count carries the
  // previously-rendered chain length so the "new entry only" side effects
  // (clearGhostAttempt + playSuccess) fire exactly when the 1.0 fired them
  // — NOT on every idempotent stateUpdate re-render.
  let film = displayEl.querySelector('.filmstrip');
  const prevCount = film ? Number(film.dataset.count || 0) : 0;
  const grew = chain.length > prevCount;

  if (grew) {
    // a new chain entry arrived → the prior ghost attempt is stale
    // (preserved from the 1.0 L645-648).
    clearGhostAttempt();
  }

  if (film) {
    while (film.firstChild) film.removeChild(film.firstChild);
  } else {
    film = document.createElement('div');
    film.className = 'filmstrip';
    // FIRST child so showGameOverBanner's appendChild()'d banner renders
    // AFTER the reel — exactly as the 1.0 banner rendered after the chain.
    displayEl.insertBefore(film, displayEl.firstChild);
  }
  film.dataset.count = String(chain.length);

  const reel = document.createElement('div');
  reel.className = 'reel';
  const lastIdx = chain.length - 1;

  for (let index = 0; index < chain.length; index++) {
    const item = chain[index];

    // bridge BEFORE this node (index>0): the actor linking it to the
    // previous movie — the semantics the 1.0 bold-shared-actor carried.
    if (index > 0) {
      const linkActor = (item.matchedActors || [])[0];
      const bridge = document.createElement('div');
      bridge.className = 'reel-bridge';
      bridge.textContent = linkActor ? `↔ ${linkActor}` : '↔';
      reel.appendChild(bridge);
    }

    const node = document.createElement('div');
    node.className = 'reel-node';
    if (index === lastIdx) node.classList.add('now-playing');
    // Best-effort burned stamp (spec §1.5): the live chain entry shape
    // carries NO per-link elimination marker today, so this NEVER fires on
    // real data — defensive + NO fabrication. Tested both ways (§4.5).
    const eliminated = !!(item && item.eliminated === true);
    if (eliminated) node.classList.add('burned');

    if (item.movie.poster && item.movie.poster.startsWith('https://image.tmdb.org/')) {
      const img = document.createElement('img');
      img.src = item.movie.poster;
      img.alt = 'Poster';
      img.className = 'reel-poster';
      // WHY: off-screen reel posters defer-load — additive perf, no
      // behaviour change (spec §1.10).
      img.loading = 'lazy';
      attachPosterFallback(img, 'reel-poster');
      node.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'reel-poster placeholder';
      node.appendChild(ph);
    }

    const who = document.createElement('div');
    who.className = 'reel-who';
    who.textContent = item.playerName;
    node.appendChild(who);

    const title = document.createElement('div');
    title.className = 'reel-title';
    title.textContent = `${item.movie.title} (${item.movie.year})`;
    node.appendChild(title);

    if (eliminated) {
      const stamp = document.createElement('div');
      stamp.className = 'reel-burned-stamp';
      stamp.textContent = 'OUT';
      node.appendChild(stamp);
    }

    reel.appendChild(node);
  }
  film.appendChild(reel);

  // The now-playing cast panel — full-width, FULL names, EVERY member,
  // ungated (spec §1.2 — identical data to the 1.0 .movie-cast; the §4 hinge).
  const nowItem = chain[lastIdx];
  const panel = document.createElement('div');
  panel.className = 'now-cast';

  const head = document.createElement('div');
  head.className = 'now-cast-head';
  const link = document.createElement('span');
  link.className = 'now-cast-link';
  const linkedVia = (nowItem.matchedActors || [])[0];
  link.textContent = (lastIdx > 0 && linkedVia)
    ? `${nowItem.playerName} linked via ${linkedVia}`
    : `${nowItem.playerName} · the chain starts here`;
  head.appendChild(link);
  const ttl = document.createElement('div');
  ttl.className = 'now-cast-title';
  ttl.textContent = `${nowItem.movie.title} (${nowItem.movie.year})`;
  head.appendChild(ttl);
  panel.appendChild(head);

  const list = document.createElement('div');
  list.className = 'now-cast-list';
  const castList = nowItem.movie.cast || [];
  let emitted = 0;
  castList.forEach((actor) => {
    // tolerate {id,name} or legacy bare string (verbatim from the 1.0
    // L692-697); FULL name, never abbreviated (spec §1.2).
    const actorName = typeof actor === 'string' ? actor : (actor && actor.name) || '';
    if (!actorName) return;
    if (emitted > 0) list.appendChild(document.createTextNode(' · '));
    const span = document.createElement('span');
    span.className = 'cast-name';
    span.textContent = actorName;
    list.appendChild(span);
    emitted++;
  });
  panel.appendChild(list);
  film.appendChild(panel);

  // Newest pinned right — the horizontal analog of the 1.0
  // `chainDisplay.scrollTop = scrollHeight`. A ONE-TIME scroll-position set,
  // NOT a rAF loop (spec §1.10). No-op under jsdom (no layout) — harmless.
  film.scrollLeft = film.scrollWidth;

  // A new entry by another player still chimes (preserved from the 1.0
  // L722-724) — gated on growth so idempotent re-renders never spam it.
  if (grew && nowItem && nowItem.playerId !== myPlayerId) {
    playSuccess();
  }
}
```

- [ ] **Step 4: Append the structural CSS** — append at the END of `public/css/03-game.css` (after L488), 7.7's own block (append-only; no pre-existing rule edited; existing tokens + the verbatim brand accent only; the single `@media` is the existing-codebase 767px layout breakpoint, not a motion query):

```css

/* =============================================================
   PHASE 7.7 — CONSTELLATION FILMSTRIP (append-only, structural)
   WHY: the in-game chain is now a horizontal reel + glowing
   now-playing hero + full-width full-name cast panel (spec §1.1/
   §1.2/§3.3). Append-only — the legacy .chain-item rules above
   are now inert (renderChainItems no longer emits .chain-item)
   and are left untouched (spec §5 = append-only, no pre-existing
   rule edited; a later DS-pass can prune the dead rules). No new
   colour value — existing tokens + the verbatim brand accent
   rgba(129,140,248,…) the lobby .theater .screen already uses.
   The reel CENTERS when it fits and FILLS+SCROLLS when it
   overflows via the margin:auto flex trick (no JS layout). The
   ONLY @media here is the existing-codebase 767px LAYOUT
   breakpoint for the mobile sticky strip — NOT a motion @media
   (motion lives in 06-states-anim.css, neutralized by the
   existing global reduced-motion * block at L1020).
   ============================================================= */
.filmstrip {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  overflow-x: auto;
  scrollbar-width: thin;
}
.filmstrip .reel {
  display: flex;
  align-items: flex-end;
  gap: 0;
  margin: 0 auto; /* centers when narrower than .filmstrip; collapses → left+scroll when wider */
  width: max-content;
  max-width: 100%;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.reel-node {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  position: relative;
  opacity: 0.82;
  transition: opacity 0.3s ease;
}
.reel-node.now-playing { opacity: 1; }
.reel-poster {
  width: 64px;
  aspect-ratio: 2/3;
  object-fit: cover;
  border-radius: var(--radius-xs);
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
}
.reel-node.now-playing .reel-poster {
  width: 104px;
  border: 2px solid var(--accent-primary);
  box-shadow: 0 0 24px rgba(129, 140, 248, 0.55);
}
.reel-poster.placeholder {
  display: flex;
}
.reel-who {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-top: 0.4rem;
}
.reel-node.now-playing .reel-who { color: var(--accent-primary); font-weight: 700; }
.reel-title {
  font-size: 0.72rem;
  color: var(--text-muted);
  max-width: 96px;
  margin-top: 0.15rem;
}
.reel-node.now-playing .reel-title { color: var(--text-main); font-size: 0.8rem; max-width: 120px; }
.reel-bridge {
  flex-shrink: 0;
  align-self: center;
  font-size: 0.66rem;
  color: var(--accent-primary);
  letter-spacing: 0.02em;
  padding: 0 0.5rem;
  white-space: nowrap;
}
.reel-node.burned { opacity: 0.6; }
.reel-node.burned .reel-poster {
  filter: grayscale(0.7) brightness(0.7);
  border: 1px solid var(--accent-warm);
}
.reel-burned-stamp {
  position: absolute;
  top: 28%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-12deg);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--accent-warm);
  border: 1.5px solid var(--accent-warm);
  border-radius: var(--radius-xs);
  padding: 0.05rem 0.3rem;
  pointer-events: none;
}
.now-cast { width: 100%; }
.now-cast-head { margin-bottom: 0.5rem; }
.now-cast-link {
  display: block;
  font-size: 0.78rem;
  color: var(--accent-primary);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.now-cast-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-main);
  margin-top: 0.15rem;
}
.now-cast-list {
  font-size: 0.92rem;
  line-height: 1.7;
  color: var(--text-muted);
}
.now-cast-list .cast-name { color: var(--text-main); }

/* Mobile sticky strip (spec §3.4 / MO-01) — the reel becomes a compact
   scroll-snap rail; the full-name cast still wraps full-width below it (no
   expand gate). Reuses the EXISTING 767px codebase breakpoint (layout, not
   motion). */
@media (max-width: 767px) {
  .filmstrip .reel {
    width: 100%;
    margin: 0;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    justify-content: flex-start;
  }
  .reel-node { scroll-snap-align: end; }
  .reel-poster { width: 48px; }
  .reel-node.now-playing .reel-poster { width: 76px; }
  .now-cast-title { font-size: 1rem; }
}
```

- [ ] **Step 5: Run the rewritten test to verify it passes**

Run: `cd C:/mm-phase7-7 && npx jest client-tests/render-chain.test.js`
Expected: PASS (every §4 axis green).

- [ ] **Step 6: Full suite + diff gate**

Run: `cd C:/mm-phase7-7 && npx jest`
Expected: PASS — 62 suites / ≈515 tests; `chain-recap.test.js`, `recap-player.test.js`, `render-lobby.test.js`, `red-carpet*.test.js`, `socket-handlers.test.js`, `showScreen.test.js`, all `server/**` byte-identical & green.
Run: `git -C C:/mm-phase7-7 diff 20f4c95 -- public/index.html` → expected: EMPTY (no markup change).
Run: `git -C C:/mm-phase7-7 diff 20f4c95 -- public/js/ui/ui-render.js` → expected: ONLY the `renderChainItems` body region changed (manually confirm `showGameOverBanner`, `renderGame`, `renderLobby`, team paths are untouched).

- [ ] **Step 7: Branch-verify, then commit**

```bash
B=$(git -C C:/mm-phase7-7 branch --show-current); [ "$B" = "phase7-7-constellation-board" ] && git -C C:/mm-phase7-7 add public/js/ui/ui-render.js public/css/03-game.css client-tests/render-chain.test.js && git -C C:/mm-phase7-7 commit -m "feat(7.7 T1): Constellation filmstrip render + §4 behavioural-equivalence guard rewrite"
```

---

### Task 2: Per-turn choreography + Clutch Save + mobile wiring

**Goal:** Drive the now-playing node's per-turn choreography via `buildTurnTimeline` (single leak-safe `setTimeout`-chain handle, reduced-motion → instant settled), fire the Clutch Save burst when `isClutchSave` is true (off the existing timer/panic state, no socket/protocol change), append the compositor-only motion CSS (neutralized by the existing global reduced-motion `*` block — no new motion `@media`), and extend the guard suite for the wired contract.

**Files:**
- Modify: `public/js/ui/ui-render.js` — add one additive export `markClutchSave()` + the leak-safe choreography helper called inside `renderChainItems`.
- Modify: `public/js/socketClient.js` — one additive block on the `playing` edge computing the clutch and calling `markClutchSave()`.
- Modify: `public/css/06-states-anim.css` — append 7.7's motion block at EOF (after L1238).
- Modify: `client-tests/render-chain.test.js` — add the wired-contract tests (one-shot, clutch class, reduced-motion settled, leak-safe cancel).

**Acceptance Criteria:**
- [ ] On a new entry under `reducedMotion` (incl. jsdom — no `matchMedia`) the filmstrip paints the settled end-state immediately, **no timers**; the §4 axes still hold.
- [ ] When `markClutchSave()` was called before the render, the now-playing node carries `.clutch` + a `.clutch-flash` child once, for that render only (flag consumed/cleared); never otherwise.
- [ ] Animated path (explicit `reducedMotion=false`) schedules via a single module-level cancellable `setTimeout` handle; `cancelTurnMotion()` clears it (leak-safe — `jest.getTimerCount()` returns 0 after cancel + rAF drain), mirroring `recap-player.js`.
- [ ] `socketClient.js` change is one additive block: no signature change to `renderGame`, no new socket event, no protocol change; the 7.6 recap one-shot + Daily blocks byte-identical.
- [ ] 06-states-anim.css append-only at EOF; compositor-only `transform`/`opacity`; **no new `@media`** (the existing global `*` reduced-motion block at L1020 neutralizes it); no new colour.

**Verify:** `cd C:/mm-phase7-7 && npx jest` → full green; `git -C C:/mm-phase7-7 diff 20f4c95 -- public/js/socketClient.js` → only the additive clutch block; `git -C C:/mm-phase7-7 diff 20f4c95 -- public/css/06-states-anim.css` → only the appended 7.7 block.

**Steps:**

- [ ] **Step 1: Add the failing wired-contract tests** — append these `describe` blocks to `client-tests/render-chain.test.js` (after the existing `describe`):

```js
import { markClutchSave } from '../public/js/ui.js';

describe('filmstrip — Task 2 wired contract', () => {
  test('jsdom (no matchMedia) → settled end-state, no pending timers', () => {
    jest.useFakeTimers();
    const chain = [makeChainItem({ movie: { title: 'Solo', year: 2018, cast: ['A'], poster: '' } })];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    // reducedMotion is computed at the call site; jsdom has no matchMedia →
    // treated as reduced → instant settled, zero scheduled timers.
    expect(jest.getTimerCount()).toBe(0);
    expect(display().querySelector('.reel-node.now-playing .reel-title').textContent).toBe('Solo (2018)');
    jest.useRealTimers();
  });

  test('clutch flag → now-playing node gets .clutch + one .clutch-flash, for that render only', () => {
    const base = makePlayingState({ chain: [makeChainItem(), makeChainItem({ matchedActors: ['x'] })] });
    markClutchSave();
    renderGame(base, 'host_id', false);
    const hero = display().querySelector('.reel-node.now-playing');
    expect(hero.classList.contains('clutch')).toBe(true);
    expect(hero.querySelectorAll('.clutch-flash').length).toBe(1);
    // flag consumed: a subsequent render WITHOUT markClutchSave() → no clutch
    renderGame(base, 'host_id', false);
    expect(display().querySelector('.reel-node.now-playing').classList.contains('clutch')).toBe(false);
  });

  test('no clutch flag → never any .clutch / .clutch-flash', () => {
    renderGame(makePlayingState({ chain: [makeChainItem()] }), 'host_id', false);
    expect(display().querySelector('.clutch')).toBeNull();
    expect(display().querySelector('.clutch-flash')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd C:/mm-phase7-7 && npx jest client-tests/render-chain.test.js`
Expected: FAIL — `markClutchSave` is not exported; `.clutch`/`.clutch-flash` not produced.

- [ ] **Step 3: Add the additive export + choreography helper** — in `public/js/ui/ui-render.js`, add near the top of the module (after the imports, before `renderGame`) the module-level clutch flag + leak-safe handle + the new exports:

```js
// Phase 7.7: Clutch Save + per-turn motion timeline driver state. WHY a
// module-level flag (not a renderGame signature change): socketClient.js
// detects the clutch on the playing edge and calls markClutchSave() right
// before the renderGame it already invokes — additive, mirrors how 7.6 added
// playRecap as a new ui export called from socketClient (no signature/
// protocol change). The single cancellable handle is the leak-safe
// recap-player.js pattern (_recapTimer/cancelRecap).
import { buildTurnTimeline } from './turn-motion.js';
let _clutchPending = false;
let _turnMotionTimer = null;

export function markClutchSave() { _clutchPending = true; }
export function cancelTurnMotion() {
  if (_turnMotionTimer) { clearTimeout(_turnMotionTimer); _turnMotionTimer = null; }
}

// Drive the now-playing node's per-turn choreography. reducedMotion (incl.
// jsdom: no matchMedia) → instant settled (no timers), the recap-player.js
// accessibility-safe precedent. Animated → a single cancellable setTimeout
// chain over buildTurnTimeline()'s schedule. The clutch burst is purely
// additive presentation — the settled DOM is behaviour-equivalent either way.
function choreographTurn(heroNode, gameState, clutch) {
  if (!heroNode) return;
  if (clutch) {
    heroNode.classList.add('clutch');
    const flash = document.createElement('div');
    flash.className = 'clutch-flash';
    flash.textContent = 'CLUTCH SAVE';
    heroNode.appendChild(flash);
  }
  const reduced = (typeof window === 'undefined') || !window.matchMedia ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { heroNode.classList.add('settled'); return; }

  const thinkMs = (gameState && typeof gameState.turnDurationMs === 'number')
    ? gameState.turnDurationMs : 0;
  const timeline = buildTurnTimeline({ thinkMs, clutch });
  cancelTurnMotion();
  // We animate only the compositor-cheap reveal→impact tail (handoff/think
  // are the prior turn / the live timer — not board motion, spec §3.1).
  const tail = timeline.filter(p => p.name === 'reveal' || p.name === 'impact');
  let i = 0;
  const tick = () => {
    if (i >= tail.length) { _turnMotionTimer = null; return; }
    const phase = tail[i];
    heroNode.classList.add(`phase-${phase.name}`);
    i++;
    _turnMotionTimer = setTimeout(tick, phase.durMs);
  };
  _turnMotionTimer = setTimeout(tick, 0);
}
```

- [ ] **Step 4: Call the helper from `renderChainItems`** — in the `renderChainItems` body written in Task 1, replace the final `playSuccess()` block:

```js
  // A new entry by another player still chimes (preserved from the 1.0
  // L722-724) — gated on growth so idempotent re-renders never spam it.
  if (grew && nowItem && nowItem.playerId !== myPlayerId) {
    playSuccess();
  }
```

with:

```js
  // A new entry by another player still chimes (preserved from the 1.0
  // L722-724) — gated on growth so idempotent re-renders never spam it.
  if (grew && nowItem && nowItem.playerId !== myPlayerId) {
    playSuccess();
  }

  // Phase 7.7: consume the one-shot clutch flag (set by socketClient on the
  // playing edge) and drive the per-turn choreography on the hero node. The
  // flag is consumed every render so it can never replay on an idempotent
  // stateUpdate re-fire (the 7.6 one-shot discipline).
  const clutch = _clutchPending;
  _clutchPending = false;
  if (grew) {
    choreographTurn(reel.querySelector('.reel-node.now-playing'), gameState, clutch);
  }
```

- [ ] **Step 5: Wire the clutch detection in `socketClient.js`** — in `public/js/socketClient.js`, add `markClutchSave` to the existing `./ui.js` import group (the line that currently imports `renderGame`/`playRecap`), and add this additive block in the `playing` branch immediately **before** the existing `renderGame(state, getMyPlayerId(), getIsSpectator());` call (the one at ~L316):

```js
      // Phase 7.7: Clutch Save — a VALID answer I just played while my turn
      // timer was inside the panic window (spec §3.3.1). Purely additive,
      // zero socket/protocol change: the chain only grows on a valid move,
      // so a new last entry whose playerId is mine + it WAS my turn in
      // prevState ⇒ valid:true; secondsRemaining is derived from the turn I
      // just played (prevState.turnExpiresAt) using the SAME ceil()-of-ms
      // the live timer bar uses, and isClutchSave mirrors timer-panic.js's
      // ≤5s 'panic' band. markClutchSave() is consumed by the very next
      // renderGame → renderChainItems (one-shot — never replays).
      const prevChainLen = prevState?.chain?.length || 0;
      const newLast = state.chain && state.chain[state.chain.length - 1];
      const iJustPlayed = state.chain.length > prevChainLen &&
        newLast && newLast.playerId === getMyPlayerId();
      if (iJustPlayed && wasMyTurn && prevState?.turnExpiresAt) {
        const secsLeft = Math.max(0, Math.ceil((prevState.turnExpiresAt - Date.now()) / 1000));
        if (isClutchSave({ valid: true, secondsRemaining: secsLeft })) markClutchSave();
      }
```

Also add `isClutchSave` and `markClutchSave` to the existing barrel import (the `import { … } from './ui.js'` block at L11–20, e.g. append to the line with `timerSeverity`): change
```js
  timerSeverity, // Phase 7.4: pure timer-severity seam (Panic Timer)
```
to
```js
  timerSeverity, // Phase 7.4: pure timer-severity seam (Panic Timer)
  isClutchSave, markClutchSave, // Phase 7.7: clutch-save predicate + one-shot flag
```

- [ ] **Step 6: Append the motion CSS** — append at the END of `public/css/06-states-anim.css` (after L1238), mirroring the 7.6.2 house block exactly:

```css

/* =============================================================
   PHASE 7.7 — CONSTELLATION per-turn motion + CLUTCH SAVE
   (append-only) WHY: compositor-only (transform + opacity) so it
   is GPU-cheap on the vanilla no-build mobile stack and the
   EXISTING global prefers-reduced-motion handling (the * block
   above — "animation-duration:0.01ms / transition-duration:
   0.01ms") neutralizes it with NO new @media. choreographTurn()
   in ui-render.js ALSO JS-short-circuits to the instant settled
   end-state under reduced-motion / no matchMedia (belt-and-
   suspenders, spec §1.10/§3.3). No new colour — the verbatim
   brand accent rgba(129,140,248,…) the lobby .theater .screen
   already uses.
   ============================================================= */
.reel-node.now-playing.phase-reveal .reel-poster {
  animation: reelRevealRise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes reelRevealRise {
  from { opacity: 0; transform: translateY(14px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.reel-node.now-playing.phase-impact .reel-poster {
  animation: reelImpactLock 0.5s ease-out both;
}
@keyframes reelImpactLock {
  0%   { transform: scale(1.06); }
  100% { transform: scale(1); }
}
.reel-node.clutch .reel-poster {
  box-shadow: 0 0 34px rgba(129, 140, 248, 0.85);
}
.clutch-flash {
  position: absolute;
  top: -1.4rem;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  color: var(--accent-primary);
  text-shadow: 0 0 12px rgba(129, 140, 248, 0.6);
  white-space: nowrap;
  pointer-events: none;
  animation: clutchFlash 0.9s ease-out both;
}
@keyframes clutchFlash {
  0%   { opacity: 0; transform: translateX(-50%) translateY(6px) scale(0.9); }
  20%  { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  80%  { opacity: 1; }
  100% { opacity: 0; }
}
```

- [ ] **Step 7: Run the tests + diff gate**

Run: `cd C:/mm-phase7-7 && npx jest`
Expected: PASS — 62 suites / ≈518 tests; `chain-recap.test.js`/`recap-player.test.js`/`render-lobby.test.js`/`red-carpet*.test.js`/`socket-handlers.test.js`/`showScreen.test.js`/all `server/**` byte-identical & green.
Run: `git -C C:/mm-phase7-7 diff 20f4c95 -- public/js/socketClient.js` → expected: ONLY the additive clutch block + the 2-symbol import addition.
Run: `git -C C:/mm-phase7-7 diff 20f4c95 -- public/css/06-states-anim.css` → expected: ONLY the appended 7.7 block (no pre-existing rule edited, no new `@media`).

- [ ] **Step 8: Branch-verify, then commit**

```bash
B=$(git -C C:/mm-phase7-7 branch --show-current); [ "$B" = "phase7-7-constellation-board" ] && git -C C:/mm-phase7-7 add public/js/ui/ui-render.js public/js/socketClient.js public/css/06-states-anim.css client-tests/render-chain.test.js && git -C C:/mm-phase7-7 commit -m "feat(7.7 T2): per-turn motion timeline + Clutch Save wiring + mobile strip"
```

---

## Self-Review

**1. Spec coverage:** §1.1 length-aware reel + hero → T1 (`.filmstrip .reel` margin:auto centering + scroll + `.now-playing`) + CSS. §1.2 full-name/all-member/ungated cast → T1 `.now-cast-list` + §4.4 tests (asserts no abbrev, no expand). §1.3 clutch-only Save → T2 `isClutchSave` + the panic-derived `secsLeft`. §1.4/§3.1/§3.2 pure engine → T0. §1.5 best-effort burned stamp → T1 `entry.eliminated===true` + §4.5 both-ways test. §1.6 zero-identity → T0 sentinel + T1 §4.6. §1.7 showGameOverBanner byte-identical → T1 (.filmstrip child rebuild, banner sibling preserved) + §4.8 test. §1.8 client-only → no `server/**`/protocol touched. §1.9/§5 transform + guard rewrite → T1 render-chain.test.js rewrite w/ enumerated §4. §1.10 perf budget → compositor-only CSS + existing global reduced-motion `*` block + caller-computed reducedMotion + `loading="lazy"` + one-time `scrollLeft`. §3.3.1 clutch wiring → T2 socketClient additive block. §3.4 mobile strip → T1 `@media(max-width:767px)` layout block. §4.1–4.8 → enumerated render-chain.test.js. All covered, no gaps.

**2. Placeholder scan:** No "TBD"/"TODO"/"handle edge cases"/"similar to". Every code step has complete code. The §1.5 elimination field is honestly pinned ("the live chain entry shape carries NO per-link marker today → never fires on real data, tested both ways") — a real decision, not a placeholder.

**3. Type consistency:** `buildTurnTimeline(input)` → `{name,index,atMs,durMs,meta}` (T0 def, T2 consumes `.name`/`.durMs`). `isClutchSave({valid,secondsRemaining})` (T0 def, T2 calls with exactly those keys). `markClutchSave()`/`cancelTurnMotion()` (T2 ui-render def; `markClutchSave` imported in socketClient + render-chain.test.js). `.filmstrip`/`.reel`/`.reel-node`/`.reel-bridge`/`.reel-poster`/`.reel-who`/`.reel-title`/`.reel-burned-stamp`/`.now-playing`/`.burned`/`.now-cast`/`.now-cast-link`/`.now-cast-title`/`.now-cast-list`/`.cast-name`/`.clutch`/`.clutch-flash`/`.phase-reveal`/`.phase-impact` — consistent across T1 JS, T1/T2 CSS, and the tests. `film.dataset.count` written + read consistently. No drift.

The plan is complete and internally consistent.
