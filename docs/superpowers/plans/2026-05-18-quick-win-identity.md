# Phase 7.4 — Quick-Win Identity Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three independent, additive, zero-regression "identity" micro-features on the hardened 7.3 system: authored theme copy, a physical last-5-seconds timer state, and a daily reset-countdown + device-local streak.

**Architecture:** Three isolated units, each a pure deps-free seam + thin glue (the 7.2/7.3 project convention): (1) re-voice the 11 `THEMES` `label`/`description` string literals only — `id`/`match`/exports byte-identical, so the filter mechanic is provably unchanged; (2) a pure `timerSeverity()` function driving an additive `timer-panic` class that is a *strict subset* of the existing `timer-critical`; (3) pure `formatResetCountdown()` + `computeDailyStreak()` (monotonic `puzzleNumber` key, UTC-midnight reset) appended additively to the daily modal with a self-clearing interval. No new socket event, no server logic/scoring/validation change, no persistence/accounts, no `stableId` echo. New CSS is additive into `06-states-anim.css`. Spec: `docs/superpowers/specs/2026-05-18-quick-win-identity-design.md`.

**Tech Stack:** Vanilla ES-module client (no build), Node CommonJS server, Jest 30 + jest-environment-jsdom, CSS partials (six load-bearing files). Worktree `C:\mm-phase7-4`, branch `phase7-4-quick-win-identity`, off `origin/main` `602ad74`.

---

## File Structure

| File | Task | Responsibility / change |
|---|---|---|
| `server/systems/themesSystem.js` | 0 | Re-voice the 11 `THEMES[*].label` + `description` string literals only. `id`/`match`/exports untouched. |
| `server/systems/themesSystem.test.js` | 0 | **Append** one new `describe` block (the authored-copy contract + a behavioural re-affirmation). Existing 9 tests byte-identical. |
| `public/js/ui/timer-panic.js` | 1 | **New.** Pure `timerSeverity(secondsRemaining) → 'normal'|'critical'|'panic'`. Zero imports. |
| `public/js/socketClient.js` | 1 | Add `timerSeverity` to the existing `./ui.js` import; 3 additive `timer-panic` class-toggle lines beside the existing `timer-critical` toggles. |
| `public/js/ui/daily-ritual.js` | 2 | **New.** Pure `formatResetCountdown(now)` + `computeDailyStreak(puzzleNumber, prev)` + defensive `readDailyStreak()`/`writeDailyStreak()` localStorage wrapper. Zero imports. |
| `public/js/ui/ui-panels.js` | 2 | Direct-sibling import of `daily-ritual.js`; module-scoped interval id; thin additive block appended in `renderDailyResult` (zero edits to existing nodes). |
| `public/js/ui.js` | 1, 2 | Barrel: `export * from './ui/timer-panic.js';` (Task 1) and `export * from './ui/daily-ritual.js';` (Task 2). |
| `public/css/06-states-anim.css` | 1, 2 | Additive: `#timer-bar.timer-panic` + `@keyframes timerPanic` after `:797` (Task 1); `.daily-ritual`/`.daily-streak`/`.daily-countdown` after `:249` (Task 2). No existing rule edited. |
| `client-tests/timer-panic.test.js` | 1 | **New.** Pure unit tests for `timerSeverity`. |
| `client-tests/daily-ritual.test.js` | 2 | **New.** Pure unit tests + a jsdom `renderDailyResult` additive-render assertion. |

Tasks are a linear chain (0 → 1 → 2). Logically independent, but Tasks 1 & 2 both append to `public/js/ui.js` and `public/css/06-states-anim.css`, so they are sequenced to avoid stale-line edits (each implementer reads current file state before editing). subagent-driven-development builds sequentially regardless.

---

### Task 0: Theme-Packs-With-Taste — authored theme copy

**Goal:** Replace all 11 `THEMES[*].label` and `THEMES[*].description` strings with an authored "movie-night program" voice, leaving every `id` and every `match` function byte-identical (provably zero filter-behaviour change).

**Files:**
- Modify: `server/systems/themesSystem.js:44-115` (the 11 `label`/`description` literals only)
- Modify (append only): `server/systems/themesSystem.test.js` (new `describe` block at end; existing tests untouched)

**Acceptance Criteria:**
- [ ] Every `THEMES` entry's `label` and `description` is the exact authored string in the table below; emoji retained.
- [ ] `id`, `match`, `_yearInRange`, `isValidTheme`, `matchesTheme`, `clientShape`, `listThemes`, `module.exports` are byte-identical to before (only the 22 string literals change).
- [ ] The pre-existing 9 tests in `themesSystem.test.js` remain byte-identical and pass (they are the behavioural zero-regression guard).
- [ ] A new appended `describe` asserts the exact new `label`/`description` per id via `clientShape`, that `listThemes()` order is unchanged (`any` first, then the 10 canonical ids in declaration order), and re-affirms `matchesTheme`/`isValidTheme` behaviour for representative ids.
- [ ] WHY comment on the change (one block comment above `THEMES` explaining the 7.4 re-voice + that ids/match are deliberately untouched).

**Verify:** `cd C:/mm-phase7-4 && npx jest server/systems/themesSystem.test.js` → all green (existing 9 + new describe). Then `cd C:/mm-phase7-4 && npx jest` → full suite green (additive over the 7.3 50/370 baseline).

**Authored copy table (the exact strings — no placeholders):**

| id | new `label` | new `description` |
|---|---|---|
| `any` | `🎬 Open Screening` | `Anything goes — every movie and show in the catalogue is eligible.` |
| `horror` | `🎃 After Dark` | `The midnight horror block — only scary movies connect.` |
| `comedy` | `😂 Comedy Night` | `Bring the laughs — only comedies count.` |
| `action` | `💥 Blockbuster Night` | `Big, loud, explosive — only action movies count.` |
| `scifi` | `🚀 Future Features` | `Speculative cinema only — science fiction counts.` |
| `romance` | `💘 Date Night` | `Hearts on screen — only romance counts.` |
| `animation` | `🎨 Animation Showcase` | `Hand-drawn to pixel-perfect — only animated films count.` |
| `decade_1980s` | `📺 The ’80s Retro Reel` | `Neon and VHS — only films released 1980–1989.` |
| `decade_1990s` | `💿 The ’90s Rewind` | `The CD-era canon — only films released 1990–1999.` |
| `decade_2000s` | `📀 The 2000s Marathon` | `The DVD-shelf era — only films released 2000–2009.` |
| `decade_2010s` | `📱 The 2010s Binge` | `The streaming dawn — only films released 2010–2019.` |

(Note: the decade names use the typographic right-single-quote `’` (U+2019), not an ASCII apostrophe, so no JS string escaping is needed and it reads correctly in the `<option>`. The file is already UTF-8 — emoji are present today.)

**Steps:**

- [ ] **Step 1: Write the failing test (append a new describe at the END of `server/systems/themesSystem.test.js`)**

Append (do not modify the existing 9 tests):

```javascript

// ============================================================================
// Phase 7.4 — authored "movie-night program" copy contract.
// WHY: 7.4 re-voices every theme label/description. This pins the EXACT new
// copy AND re-affirms the behavioural contract is byte-identical (ids + match
// fns + ordering unchanged) — the copy change must not perturb the filter.
// ============================================================================
describe('themesSystem — Phase 7.4 authored copy', () => {
  const EXPECTED = {
    any: { label: '🎬 Open Screening', description: 'Anything goes — every movie and show in the catalogue is eligible.' },
    horror: { label: '🎃 After Dark', description: 'The midnight horror block — only scary movies connect.' },
    comedy: { label: '😂 Comedy Night', description: 'Bring the laughs — only comedies count.' },
    action: { label: '💥 Blockbuster Night', description: 'Big, loud, explosive — only action movies count.' },
    scifi: { label: '🚀 Future Features', description: 'Speculative cinema only — science fiction counts.' },
    romance: { label: '💘 Date Night', description: 'Hearts on screen — only romance counts.' },
    animation: { label: '🎨 Animation Showcase', description: 'Hand-drawn to pixel-perfect — only animated films count.' },
    decade_1980s: { label: '📺 The ’80s Retro Reel', description: 'Neon and VHS — only films released 1980–1989.' },
    decade_1990s: { label: '💿 The ’90s Rewind', description: 'The CD-era canon — only films released 1990–1999.' },
    decade_2000s: { label: '📀 The 2000s Marathon', description: 'The DVD-shelf era — only films released 2000–2009.' },
    decade_2010s: { label: '📱 The 2010s Binge', description: 'The streaming dawn — only films released 2010–2019.' },
  };

  test('clientShape returns the exact authored label + description per id', () => {
    Object.keys(EXPECTED).forEach((id) => {
      const shaped = themesSystem.clientShape(id);
      expect(shaped).toEqual({ id, label: EXPECTED[id].label, description: EXPECTED[id].description });
    });
  });

  test('listThemes order is unchanged: "any" first, then the 10 canonical ids in declaration order', () => {
    const ids = themesSystem.listThemes().map((t) => t.id);
    expect(ids).toEqual([
      'any', 'horror', 'comedy', 'action', 'scifi', 'romance', 'animation',
      'decade_1980s', 'decade_1990s', 'decade_2000s', 'decade_2010s',
    ]);
  });

  test('behavioural contract re-affirmed: copy change did not perturb match/validation', () => {
    // A representative slice of the existing behavioural guard — the filter
    // depends on id + match(), never on label/description.
    expect(themesSystem.matchesTheme('horror', { genre_ids: [27] })).toBe(true);
    expect(themesSystem.matchesTheme('horror', { genre_ids: [35] })).toBe(false);
    expect(themesSystem.matchesTheme('decade_1990s', { release_date: '1995-01-01' })).toBe(true);
    expect(themesSystem.matchesTheme('any', null)).toBe(true);
    expect(themesSystem.isValidTheme('scifi')).toBe(true);
    expect(themesSystem.isValidTheme('does_not_exist')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/mm-phase7-4 && npx jest server/systems/themesSystem.test.js`
Expected: the new `describe` FAILS on the `clientShape` / copy assertions (current labels are `🎬 Any (no theme)` etc.); the existing 9 tests still PASS.

- [ ] **Step 3: Re-voice the 11 label/description pairs in `server/systems/themesSystem.js`**

Replace the block comment above `const THEMES = {` (lines ~36-40) and edit only the `label`/`description` of each entry. The exact resulting `THEMES` table:

```javascript
// Theme definitions. Each entry has an id (used on the wire, never changed),
// label (client-display), description (picker tooltip), and a `match`
// function called per TMDB candidate.
//
// Phase 7.4 (Theme-Packs-With-Taste): the label/description strings are
// re-voiced into authored "movie-night program" copy. WHY: a settings-style
// dropdown ("Only horror movies count.") doesn't feel like picking tonight's
// screening. Only these two display strings change per entry — `id` and
// `match` are deliberately byte-identical so the filter mechanic is provably
// unchanged (the existing themesSystem.test.js behavioural suite is the
// zero-regression guard). This is presentation only and does NOT introduce
// any preset/kit bundling — that mechanic is 6c (separate spec); see the
// 7.4 spec §4 dedup boundary.
const THEMES = {
  // No-op theme — explicitly listed so the picker can offer the no-filter
  // option alongside the real themes. No filter is applied.
  any: {
    id: 'any',
    label: '🎬 Open Screening',
    description: 'Anything goes — every movie and show in the catalogue is eligible.',
    match: () => true,
  },

  // Genre themes
  horror: {
    id: 'horror',
    label: '🎃 After Dark',
    description: 'The midnight horror block — only scary movies connect.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_HORROR),
  },
  comedy: {
    id: 'comedy',
    label: '😂 Comedy Night',
    description: 'Bring the laughs — only comedies count.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_COMEDY),
  },
  action: {
    id: 'action',
    label: '💥 Blockbuster Night',
    description: 'Big, loud, explosive — only action movies count.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_ACTION),
  },
  scifi: {
    id: 'scifi',
    label: '🚀 Future Features',
    description: 'Speculative cinema only — science fiction counts.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_SCIFI),
  },
  romance: {
    id: 'romance',
    label: '💘 Date Night',
    description: 'Hearts on screen — only romance counts.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_ROMANCE),
  },
  animation: {
    id: 'animation',
    label: '🎨 Animation Showcase',
    description: 'Hand-drawn to pixel-perfect — only animated films count.',
    match: (r) => Array.isArray(r && r.genre_ids) && r.genre_ids.includes(GENRE_ANIMATION),
  },

  // Decade themes — pulled from release_date string ('YYYY-MM-DD').
  // Tolerates missing/malformed dates by failing the match (rather than
  // accidentally letting an undated film slip through).
  decade_1980s: {
    id: 'decade_1980s',
    label: '📺 The ’80s Retro Reel',
    description: 'Neon and VHS — only films released 1980–1989.',
    match: (r) => _yearInRange(r, 1980, 1989),
  },
  decade_1990s: {
    id: 'decade_1990s',
    label: '💿 The ’90s Rewind',
    description: 'The CD-era canon — only films released 1990–1999.',
    match: (r) => _yearInRange(r, 1990, 1999),
  },
  decade_2000s: {
    id: 'decade_2000s',
    label: '📀 The 2000s Marathon',
    description: 'The DVD-shelf era — only films released 2000–2009.',
    match: (r) => _yearInRange(r, 2000, 2009),
  },
  decade_2010s: {
    id: 'decade_2010s',
    label: '📱 The 2010s Binge',
    description: 'The streaming dawn — only films released 2010–2019.',
    match: (r) => _yearInRange(r, 2010, 2019),
  },
};
```

**Do not touch** anything below `};` (the `_yearInRange`, `isValidTheme`, `matchesTheme`, `clientShape`, `listThemes`, `module.exports`) and **do not touch** the `GENRE_*` constants above.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/mm-phase7-4 && npx jest server/systems/themesSystem.test.js`
Expected: PASS — all 9 existing tests + the 3 new ones green.

- [ ] **Step 5: Run the full suite**

Run: `cd C:/mm-phase7-4 && npx jest`
Expected: green; total grows additively over the 7.3 baseline (50 suites / 370 tests). No existing test edited.

- [ ] **Step 6: Verify branch, then commit**

```bash
cd C:/mm-phase7-4 && B=$(git branch --show-current) && [ "$B" = "phase7-4-quick-win-identity" ] && git add server/systems/themesSystem.js server/systems/themesSystem.test.js && git commit -m "Phase 7.4 (0): Theme-Packs-With-Taste — authored theme copy (id/match byte-identical)"
```

```json:metadata
{"files": ["server/systems/themesSystem.js", "server/systems/themesSystem.test.js"], "verifyCommand": "cd C:/mm-phase7-4 && npx jest server/systems/themesSystem.test.js", "acceptanceCriteria": ["all 11 label+description = exact authored table; emoji retained", "id/match/_yearInRange/isValidTheme/matchesTheme/clientShape/listThemes/exports byte-identical", "pre-existing 9 themesSystem tests byte-identical and green (behavioural zero-regression guard)", "new appended describe pins the exact new copy + listThemes order + re-affirms match/validation", "WHY comment explaining the 7.4 re-voice + ids/match deliberately untouched + 6c-dedup (presentation only)", "full npx jest suite green, additive over 50/370"]}
```

---

### Task 1: Panic Mode Timer — pure severity seam + strict-subset class

**Goal:** Add a physical "panic" treatment for the final 5 seconds of a turn via a pure `timerSeverity()` function and an additive `timer-panic` class that is a strict subset of the existing `timer-critical` (never set unless critical is set; never outlives it). Existing colour/width/sfx logic unchanged.

**Files:**
- Create: `public/js/ui/timer-panic.js`
- Modify: `public/js/ui.js` (barrel — one `export *` line)
- Modify: `public/js/socketClient.js:11-23` (add `timerSeverity` to the `./ui.js` import) and the timer interval (3 additive class-toggle lines)
- Modify: `public/css/06-states-anim.css` (additive rule + keyframe after line 797)
- Create: `client-tests/timer-panic.test.js`

**Acceptance Criteria:**
- [ ] `timerSeverity(s)` returns `'panic'` for `s <= 5`, `'critical'` for `5 < s <= 10`, `'normal'` for `s > 10`; non-finite / negative / non-number inputs degrade to `'panic'` only when a real `≤5` number, otherwise the safest correct band (see test) — concretely: `Number.isFinite` guard, negatives treated as `0` (→ `'panic'`), `NaN`/`undefined` → `'normal'` (no spurious panic when state is unknown).
- [ ] `timer-panic` is added on `#timer-bar` **iff** `timerSeverity(tr) === 'panic'`, only inside the existing `tr <= 10` (critical) branch, and removed in **every** place `timer-critical` is removed (the `tr > 10` else branch **and** the interval-clear guard) — it can never outlive `timer-critical`.
- [ ] No change to width math, severity colours, the tick sfx gate, or the `timer-critical` behaviour (the 3 edits are purely additive lines).
- [ ] `06-states-anim.css` gains an additive `#timer-bar.timer-panic { … }` + `@keyframes timerPanic` (compositor-only: `transform`/`opacity`/`box-shadow`, **no** `width`/layout), placed immediately after the existing `#timer-bar.timer-critical` rule; legible without motion (the existing global `prefers-reduced-motion` block zeroes the duration); composes over `.speed-mode #timer-bar`'s `!important` background (panic does not set `background`).
- [ ] Barrel re-exports `timer-panic.js`.
- [ ] WHY comments on every change.

**Verify:** `cd C:/mm-phase7-4 && npx jest client-tests/timer-panic.test.js` → green. Then `cd C:/mm-phase7-4 && npx jest` → full suite green.

**Steps:**

- [ ] **Step 1: Write the failing test — `client-tests/timer-panic.test.js`**

```javascript
/**
 * @jest-environment jsdom
 */
// Phase 7.4 — pure timerSeverity seam. WHY: the panic decision must be a
// pure, unit-testable function (mirrors 7.2 submissionPill / 7.3 modal
// factory) so socketClient.js stays thin glue and the boundaries are pinned.
import { timerSeverity } from '../public/js/ui.js';

describe('timerSeverity', () => {
  test('panic band: secondsRemaining <= 5', () => {
    expect(timerSeverity(5)).toBe('panic');
    expect(timerSeverity(4)).toBe('panic');
    expect(timerSeverity(1)).toBe('panic');
    expect(timerSeverity(0)).toBe('panic');
  });

  test('critical band: 5 < secondsRemaining <= 10', () => {
    expect(timerSeverity(6)).toBe('critical');
    expect(timerSeverity(10)).toBe('critical');
    expect(timerSeverity(5.0001)).toBe('critical');
  });

  test('normal band: secondsRemaining > 10', () => {
    expect(timerSeverity(11)).toBe('normal');
    expect(timerSeverity(30)).toBe('normal');
    expect(timerSeverity(999)).toBe('normal');
  });

  test('negative remaining is clamped to 0 → panic (clock overran)', () => {
    expect(timerSeverity(-1)).toBe('panic');
    expect(timerSeverity(-999)).toBe('panic');
  });

  test('non-finite / non-number inputs degrade to normal (unknown ≠ panic)', () => {
    expect(timerSeverity(NaN)).toBe('normal');
    expect(timerSeverity(undefined)).toBe('normal');
    expect(timerSeverity(null)).toBe('normal');
    expect(timerSeverity(Infinity)).toBe('normal');
    expect(timerSeverity('5')).toBe('normal');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/mm-phase7-4 && npx jest client-tests/timer-panic.test.js`
Expected: FAIL — `timerSeverity` is not exported (module does not exist yet).

- [ ] **Step 3a: Create `public/js/ui/timer-panic.js`**

```javascript
// ui/timer-panic.js — pure per-turn timer severity. Phase 7.4 (Panic Timer).
// WHY: socketClient.js already drives the timer bar (width + red/yellow/green
// + ≤10s `timer-critical`). 7.4 adds a physical "panic" treatment for the
// final 5s. The threshold decision is extracted into this pure, zero-import,
// unit-testable function (the 7.2/7.3 pure-seam discipline) so the wiring in
// socketClient.js stays a thin, additive class toggle and the band boundaries
// are pinned by tests rather than buried in an interval callback.

/**
 * Map seconds-remaining to a severity band.
 *   <= 5  → 'panic'    (the physical last-5s state; strict subset of critical)
 *   <= 10 → 'critical'  (the existing red/blink band)
 *   else  → 'normal'
 * Defensive: a finite negative reading means the clock overran — treat as 0
 * (still panic). A non-finite / non-number reading means the remaining time
 * is unknown; we must NOT flash panic on unknown state, so degrade to
 * 'normal' (the caller's existing guards handle the not-playing case).
 */
export function timerSeverity(secondsRemaining) {
  if (typeof secondsRemaining !== 'number' || !Number.isFinite(secondsRemaining)) {
    return 'normal';
  }
  const s = secondsRemaining < 0 ? 0 : secondsRemaining;
  if (s <= 5) return 'panic';
  if (s <= 10) return 'critical';
  return 'normal';
}
```

- [ ] **Step 3b: Add the barrel re-export to `public/js/ui.js`**

Insert after the `name-prompts.js` line (currently line 11), matching the existing 3-space-before-`//` comment style:

```javascript
export * from './ui/timer-panic.js';   // Phase 7.4: pure timer-severity seam (Panic Timer)
```

- [ ] **Step 3c: Add `timerSeverity` to the `socketClient.js` `./ui.js` import**

In `public/js/socketClient.js`, the existing import block is lines 11-23. Add `timerSeverity` by inserting a new line immediately after the Phase 7.2 line (line 17 `  toast, gameEvent, submissionPill, // Phase 7.2: feedback router`):

```javascript
  timerSeverity, // Phase 7.4: pure timer-severity seam (Panic Timer)
```

(Result: the destructured `import { … } from './ui.js';` now also pulls `timerSeverity`.)

- [ ] **Step 3d: Wire the 3 additive `timer-panic` toggles in `socketClient.js`**

The timer interval is around lines 360-413. Make exactly these 3 additive edits (do not restructure the existing logic):

**Edit 1 — the interval-clear guard.** Find:

```javascript
          if (!gs || !gs.turnExpiresAt || gs.status !== 'playing') {
            clearInterval(interval);
            setTurnInterval(null);
            if (timerBar) timerBar.classList.remove('timer-critical');
            return;
          }
```

Replace with (add the panic-removal line):

```javascript
          if (!gs || !gs.turnExpiresAt || gs.status !== 'playing') {
            clearInterval(interval);
            setTurnInterval(null);
            if (timerBar) timerBar.classList.remove('timer-critical');
            // Phase 7.4: panic is a strict subset of critical — clear it
            // wherever critical is cleared so it can never outlive critical.
            if (timerBar) timerBar.classList.remove('timer-panic');
            return;
          }
```

**Edit 2 — the `tr <= 10` (critical) branch.** Find:

```javascript
            if (tr <= 10) {
              timerBar.style.backgroundColor = 'var(--timer-red)';
              timerBar.classList.add('timer-critical');
```

Replace with (add the panic toggle right after the critical add):

```javascript
            if (tr <= 10) {
              timerBar.style.backgroundColor = 'var(--timer-red)';
              timerBar.classList.add('timer-critical');
              // Phase 7.4: physical last-5s. toggle (not add) using the pure
              // seam so 6–10s correctly CLEARS panic while still inside the
              // critical band — panic ⊂ critical, decided in one place.
              timerBar.classList.toggle('timer-panic', timerSeverity(tr) === 'panic');
```

**Edit 3 — the `else` (tr > 10) branch.** Find:

```javascript
            } else {
              timerBar.classList.remove('timer-critical');
```

Replace with (add the panic removal):

```javascript
            } else {
              timerBar.classList.remove('timer-critical');
              // Phase 7.4: tr>10 → neither critical nor panic.
              timerBar.classList.remove('timer-panic');
```

- [ ] **Step 3e: Add the additive CSS to `public/css/06-states-anim.css`**

Immediately **after** the existing rule (lines 795-797):

```css
#timer-bar.timer-critical {
  animation: timerBlink 0.7s ease-in-out infinite;
}
```

append:

```css

/* Phase 7.4 (Panic Timer) — the final 5s escalate the red critical bar into a
   physical "panic" pulse. WHY: the last 5s currently look identical to the
   last 10; this makes the clutch moment felt. Compositor-only (transform +
   box-shadow, NEVER width — width is set inline per 250ms tick and must not
   be fought). It is layered ON TOP of .timer-critical (panic ⊂ critical) and
   does NOT set `background`, so it composes cleanly over the
   `.speed-mode #timer-bar { background: … !important }` rule. The faster
   period than timerBlink reads as urgency. prefers-reduced-motion is honoured
   automatically by the global block lower in this file (it zeroes
   animation-duration for *) — and the state stays legible without motion via
   the static intensified box-shadow below. */
#timer-bar.timer-panic {
  animation: timerPanic 0.32s ease-in-out infinite;
  box-shadow: 0 0 10px 2px var(--timer-red, #f43f5e);
}
@keyframes timerPanic {
  0%, 100% { transform: scaleY(1); box-shadow: 0 0 8px 1px var(--timer-red, #f43f5e); }
  50%      { transform: scaleY(1.18); box-shadow: 0 0 16px 5px var(--timer-red, #f43f5e); }
}
```

(Rationale: `transform: scaleY` + `box-shadow` are compositor-friendly and never touch the inline `width`. The base rule carries a non-animated `box-shadow` so under `prefers-reduced-motion` — where `animation-duration` is forced to ~0 by the existing global `*` block — the bar still shows an intensified static glow, i.e. legible without motion.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/mm-phase7-4 && npx jest client-tests/timer-panic.test.js`
Expected: PASS (all 5 describes/tests green).

- [ ] **Step 5: Run the full suite**

Run: `cd C:/mm-phase7-4 && npx jest`
Expected: green; +1 suite (`timer-panic.test.js`) over the post-Task-0 total. No existing test edited.

- [ ] **Step 6: Verify branch, then commit**

```bash
cd C:/mm-phase7-4 && B=$(git branch --show-current) && [ "$B" = "phase7-4-quick-win-identity" ] && git add public/js/ui/timer-panic.js public/js/ui.js public/js/socketClient.js public/css/06-states-anim.css client-tests/timer-panic.test.js && git commit -m "Phase 7.4 (1): Panic Mode Timer — pure timerSeverity + strict-subset timer-panic class + additive CSS"
```

```json:metadata
{"files": ["public/js/ui/timer-panic.js", "public/js/ui.js", "public/js/socketClient.js", "public/css/06-states-anim.css", "client-tests/timer-panic.test.js"], "verifyCommand": "cd C:/mm-phase7-4 && npx jest client-tests/timer-panic.test.js", "acceptanceCriteria": ["timerSeverity: <=5 panic, 5<x<=10 critical, >10 normal; negative→panic(clamp 0); NaN/undefined/null/Infinity/string→normal", "timer-panic added iff timerSeverity(tr)==='panic' inside the existing tr<=10 branch via classList.toggle", "timer-panic removed in BOTH places timer-critical is removed (else branch + interval-clear guard) — never outlives critical", "no change to width math / severity colours / tick sfx gate / timer-critical behaviour (3 additive lines + 1 import)", "06-states-anim.css additive #timer-bar.timer-panic + @keyframes timerPanic after :797; transform/box-shadow only, no width; static box-shadow keeps it legible under the existing global prefers-reduced-motion block; no background so composes over .speed-mode !important", "barrel re-exports timer-panic.js", "WHY comments on every change", "full npx jest suite green, additive"]}
```

---

### Task 2: Daily ritual — reset countdown + device-local streak

**Goal:** Append two new elements to the daily result modal — a live "Resets in `Xh Ym`" countdown to the next UTC midnight and a device-local "Day `N` 🔥" streak — via pure functions + thin glue, touching zero existing nodes, with a self-clearing interval that cannot leak across any close path.

**Files:**
- Create: `public/js/ui/daily-ritual.js`
- Modify: `public/js/ui.js` (barrel — one `export *` line)
- Modify: `public/js/ui/ui-panels.js` (direct-sibling import; module-scoped interval id; additive block in `renderDailyResult`)
- Modify: `public/css/06-states-anim.css` (additive rules after line 249)
- Create: `client-tests/daily-ritual.test.js`

**Acceptance Criteria:**
- [ ] `formatResetCountdown(now = new Date())` returns ms-to-next-UTC-00:00:00 formatted as `"Xh Ym"` when ≥1h, `"Ym"` when <1h and ≥1m, `"<1m"` when <1m; never negative; never a day component (next UTC midnight is always <24h away).
- [ ] `computeDailyStreak(puzzleNumber, prev)` returns `{ streak, next }` where `next` is `{ lastPuzzleNumber, streak }`: `puzzleNumber === prev.lastPuzzleNumber` → streak unchanged (idempotent); `=== prev.lastPuzzleNumber + 1` → `prev.streak + 1`; otherwise / missing / corrupt `prev` / non-integer `puzzleNumber` → `streak = 1`.
- [ ] `readDailyStreak()` / `writeDailyStreak(next)` use `localStorage` key `mm:dailyStreak`, defensively (any throw / malformed JSON / wrong shape → treated as no prior streak; write swallows quota/security errors).
- [ ] `renderDailyResult` **appends** a single `.daily-ritual` block (streak badge + countdown) as the last child of `#daily-result-body`; **no existing node** (title, subtitle, score, replay, leaderboard) is modified or reordered; no `stableId` is read or rendered.
- [ ] Exactly one countdown interval can ever be live: a module-scoped id is hard-cleared at the top of `renderDailyResult`, and the interval self-clears the first tick it observes `#daily-result-modal` has the `hidden` class (covers Done button, the ✕ global handler, and any programmatic `.hidden`).
- [ ] Barrel re-exports `daily-ritual.js`; the import into `ui-panels.js` is a direct sibling import (no barrel cycle), matching the 7.3 DAG discipline.
- [ ] WHY comments on every change.

**Verify:** `cd C:/mm-phase7-4 && npx jest client-tests/daily-ritual.test.js` → green. Then `cd C:/mm-phase7-4 && npx jest` → full suite green.

**Steps:**

- [ ] **Step 1: Write the failing test — `client-tests/daily-ritual.test.js`**

```javascript
/**
 * @jest-environment jsdom
 */
// Phase 7.4 — daily ritual pure seams + additive render. WHY: streak/countdown
// must be pure + unit-testable (no accounts, device-local), and the modal
// change must be provably additive (existing nodes untouched, no stableId).
const { loadIndexHtml } = require('./fixtures');
import {
  formatResetCountdown,
  computeDailyStreak,
  readDailyStreak,
  writeDailyStreak,
  renderDailyResult,
} from '../public/js/ui.js';

describe('formatResetCountdown', () => {
  // now is injected; reset boundary = next UTC 00:00:00.
  test('≥1h → "Xh Ym"', () => {
    // 2026-05-18T20:30:00Z → 3h 30m to next UTC midnight
    const now = new Date('2026-05-18T20:30:00Z');
    expect(formatResetCountdown(now)).toBe('3h 30m');
  });
  test('<1h and ≥1m → "Ym"', () => {
    const now = new Date('2026-05-18T23:18:00Z'); // 42m left
    expect(formatResetCountdown(now)).toBe('42m');
  });
  test('<1m → "<1m"', () => {
    const now = new Date('2026-05-18T23:59:30Z'); // 30s left
    expect(formatResetCountdown(now)).toBe('<1m');
  });
  test('exactly at midnight → next full day, never negative', () => {
    const now = new Date('2026-05-18T00:00:00Z'); // 24h to NEXT midnight
    expect(formatResetCountdown(now)).toBe('23h 59m');
  });
  test('one minute before midnight', () => {
    const now = new Date('2026-05-18T23:00:00Z');
    expect(formatResetCountdown(now)).toBe('1h 0m');
  });
});

describe('computeDailyStreak', () => {
  test('no prior (null/undefined) → streak 1', () => {
    expect(computeDailyStreak(42, null)).toEqual({ streak: 1, next: { lastPuzzleNumber: 42, streak: 1 } });
    expect(computeDailyStreak(42, undefined)).toEqual({ streak: 1, next: { lastPuzzleNumber: 42, streak: 1 } });
  });
  test('same puzzle again → unchanged (idempotent)', () => {
    const prev = { lastPuzzleNumber: 42, streak: 7 };
    expect(computeDailyStreak(42, prev)).toEqual({ streak: 7, next: { lastPuzzleNumber: 42, streak: 7 } });
    // idempotency: applying twice yields the same result
    const once = computeDailyStreak(42, prev).next;
    expect(computeDailyStreak(42, once)).toEqual({ streak: 7, next: { lastPuzzleNumber: 42, streak: 7 } });
  });
  test('consecutive (+1) → increment', () => {
    expect(computeDailyStreak(43, { lastPuzzleNumber: 42, streak: 7 }))
      .toEqual({ streak: 8, next: { lastPuzzleNumber: 43, streak: 8 } });
  });
  test('gap (≥+2 or earlier) → reset to 1', () => {
    expect(computeDailyStreak(45, { lastPuzzleNumber: 42, streak: 7 }))
      .toEqual({ streak: 1, next: { lastPuzzleNumber: 45, streak: 1 } });
    expect(computeDailyStreak(40, { lastPuzzleNumber: 42, streak: 7 }))
      .toEqual({ streak: 1, next: { lastPuzzleNumber: 40, streak: 1 } });
  });
  test('corrupt prev shape → treated as no prior', () => {
    expect(computeDailyStreak(42, { junk: true }).streak).toBe(1);
    expect(computeDailyStreak(42, 'nonsense').streak).toBe(1);
    expect(computeDailyStreak(42, { lastPuzzleNumber: 'x', streak: 'y' }).streak).toBe(1);
  });
  test('non-integer puzzleNumber → streak 1 (defensive)', () => {
    expect(computeDailyStreak(NaN, { lastPuzzleNumber: 1, streak: 5 }).streak).toBe(1);
    expect(computeDailyStreak(undefined, { lastPuzzleNumber: 1, streak: 5 }).streak).toBe(1);
  });
});

describe('readDailyStreak / writeDailyStreak', () => {
  beforeEach(() => window.localStorage.clear());
  test('round-trips a valid value', () => {
    writeDailyStreak({ lastPuzzleNumber: 9, streak: 3 });
    expect(readDailyStreak()).toEqual({ lastPuzzleNumber: 9, streak: 3 });
  });
  test('missing key → null', () => {
    expect(readDailyStreak()).toBeNull();
  });
  test('malformed JSON → null (no throw)', () => {
    window.localStorage.setItem('mm:dailyStreak', '{not json');
    expect(() => readDailyStreak()).not.toThrow();
    expect(readDailyStreak()).toBeNull();
  });
  test('wrong shape → null', () => {
    window.localStorage.setItem('mm:dailyStreak', JSON.stringify({ foo: 1 }));
    expect(readDailyStreak()).toBeNull();
  });
});

describe('renderDailyResult — additive ritual block', () => {
  beforeEach(() => {
    loadIndexHtml();
    window.localStorage.clear();
  });

  test('appends streak + countdown without touching existing nodes; no stableId', () => {
    renderDailyResult({
      puzzleNumber: 12,
      date: '2026-05-18',
      chainLength: 5,
      leaderboard: [{ name: 'Alice', chainLength: 9 }],
      stableId: 'SECRET_STABLE_ID', // must NOT be echoed anywhere
    });
    const body = document.getElementById('daily-result-body');
    // Existing nodes still present + correct (regression guard).
    expect(body.querySelector('.daily-score-num').textContent).toBe('5');
    expect(body.querySelector('.daily-lb-name').textContent).toBe('Alice');
    // New additive block present, as the LAST child of body.
    const ritual = body.querySelector('.daily-ritual');
    expect(ritual).not.toBeNull();
    expect(body.lastElementChild).toBe(ritual);
    expect(ritual.querySelector('.daily-streak').textContent).toBe('Day 1 🔥');
    expect(ritual.querySelector('.daily-countdown').textContent).toMatch(/^Resets in /);
    // Phase-1 security: stableId never rendered.
    expect(document.getElementById('daily-result-modal').innerHTML).not.toContain('SECRET_STABLE_ID');
  });

  test('alreadyPlayed path also gets the ritual block; streak is idempotent on re-open', () => {
    const data = { alreadyPlayed: true, puzzleNumber: 12, date: '2026-05-18', chainLength: 0, leaderboard: [] };
    renderDailyResult(data);
    expect(document.querySelector('.daily-streak').textContent).toBe('Day 1 🔥');
    // Re-open same puzzle → streak unchanged (idempotent), no interval stacking.
    renderDailyResult(data);
    expect(document.querySelectorAll('.daily-ritual').length).toBe(1);
    expect(document.querySelector('.daily-streak').textContent).toBe('Day 1 🔥');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/mm-phase7-4 && npx jest client-tests/daily-ritual.test.js`
Expected: FAIL — `formatResetCountdown` / `computeDailyStreak` / `readDailyStreak` / `writeDailyStreak` are not exported (module does not exist); the `.daily-ritual` assertions fail.

- [ ] **Step 3a: Create `public/js/ui/daily-ritual.js`**

```javascript
// ui/daily-ritual.js — pure daily-ritual seams. Phase 7.4 (Daily ritual).
// WHY: the Daily is a habit loop with no habit cues. 7.4 adds a live
// reset countdown + a device-local streak. Per the no-accounts guardrail the
// streak is localStorage-only and the streak key is the server-authoritative
// MONOTONIC puzzleNumber (consecutive days ⇔ +1) — this sidesteps all local
// timezone/ISO ambiguity (the server keys the Daily by UTC for the same
// reason). These are pure, zero-import, unit-testable functions (7.2/7.3
// pure-seam discipline); ui-panels.js stays thin glue. Nothing here is sent
// to the server and no stableId is involved (Phase-1 security preserved).

const STREAK_KEY = 'mm:dailyStreak';

/**
 * Time from `now` to the next UTC 00:00:00, formatted:
 *   ≥1h → "Xh Ym"   ·   <1h & ≥1m → "Ym"   ·   <1m → "<1m"
 * Never negative; never a day component (next UTC midnight is always <24h).
 */
export function formatResetCountdown(now = new Date()) {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0,
  ));
  let ms = next.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m`;
  return '<1m';
}

function _validPrev(prev) {
  return prev
    && typeof prev === 'object'
    && Number.isInteger(prev.lastPuzzleNumber)
    && Number.isInteger(prev.streak)
    && prev.streak >= 1;
}

/**
 * Pure streak transition. `prev`/`next` shape: { lastPuzzleNumber, streak }.
 *   puzzleNumber === prev.lastPuzzleNumber     → unchanged (idempotent)
 *   puzzleNumber === prev.lastPuzzleNumber + 1 → prev.streak + 1
 *   otherwise / no-or-corrupt prev / bad input → 1
 */
export function computeDailyStreak(puzzleNumber, prev) {
  if (!Number.isInteger(puzzleNumber)) {
    // Unknown puzzle number — don't fabricate a streak; the caller still
    // shows "Day 1" rather than crashing.
    return { streak: 1, next: { lastPuzzleNumber: -1, streak: 1 } };
  }
  if (!_validPrev(prev)) {
    return { streak: 1, next: { lastPuzzleNumber: puzzleNumber, streak: 1 } };
  }
  if (puzzleNumber === prev.lastPuzzleNumber) {
    return { streak: prev.streak, next: { lastPuzzleNumber: puzzleNumber, streak: prev.streak } };
  }
  if (puzzleNumber === prev.lastPuzzleNumber + 1) {
    const streak = prev.streak + 1;
    return { streak, next: { lastPuzzleNumber: puzzleNumber, streak } };
  }
  return { streak: 1, next: { lastPuzzleNumber: puzzleNumber, streak: 1 } };
}

/** Read the persisted streak, or null. Any error / malformed value → null. */
export function readDailyStreak() {
  try {
    const raw = window.localStorage.getItem(STREAK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return _validPrev(parsed) ? parsed : null;
  } catch (_e) {
    // localStorage may throw (privacy mode / disabled) or JSON may be junk.
    // The streak is a nicety — never let it break the modal.
    return null;
  }
}

/** Persist the streak. Swallows quota/security errors (best-effort). */
export function writeDailyStreak(next) {
  try {
    window.localStorage.setItem(STREAK_KEY, JSON.stringify(next));
  } catch (_e) {
    // Best-effort only — a failed write just means no streak next time.
  }
}
```

- [ ] **Step 3b: Add the barrel re-export to `public/js/ui.js`**

Insert after the `timer-panic.js` line added in Task 1 (keep the same comment style):

```javascript
export * from './ui/daily-ritual.js';   // Phase 7.4: pure daily-ritual seams (countdown + streak)
```

- [ ] **Step 3c: Import `daily-ritual.js` into `ui-panels.js` + add the module-scoped interval id**

In `public/js/ui/ui-panels.js`, after the existing Phase 7.3 direct-sibling imports (currently lines 19-20: `import { createPromptModal } from './modal.js';` / `import { buildDailyPromptConfig } from './name-prompts.js';`), add:

```javascript
// Phase 7.4 (Daily ritual): direct sibling import — daily-ritual.js imports
// nothing, so this keeps the one-way module DAG (no ./ui.js barrel cycle),
// the same discipline as the 7.3 modal imports above.
import { formatResetCountdown, computeDailyStreak, readDailyStreak, writeDailyStreak } from './daily-ritual.js';

// Phase 7.4: the single live daily-reset countdown interval id (see
// renderDailyResult). Module-scoped so a re-open can hard-clear any prior
// one — bounding the app to at most ONE such interval, ever.
let _dailyCountdownTimer = null;
```

- [ ] **Step 3d: Add the additive ritual block in `renderDailyResult` (`ui-panels.js`)**

Two edits inside `renderDailyResult` (do not modify any existing node-building code):

**Edit A — hard-clear any prior interval at the top.** Find the early-guard line:

```javascript
  if (!titleEl || !subEl || !bodyEl || !shareBtn) return;
```

Insert immediately after it:

```javascript

  // Phase 7.4: a previous open may have left the countdown interval running
  // (e.g. closed via the ✕ global handler). Hard-clear it here so re-opening
  // never stacks intervals — at most one is ever live.
  clearInterval(_dailyCountdownTimer);
  _dailyCountdownTimer = null;
```

**Edit B — append the ritual block just before the modal is shown.** Find the final line of the function:

```javascript
  modal.classList.remove('hidden');
}
```

Replace with:

```javascript
  // Phase 7.4 (Daily ritual): append a single additive block (device-local
  // streak + live reset countdown) as the LAST child of the rebuilt body.
  // WHY append + rebuilt-body: bodyEl.textContent was cleared at the top of
  // this function and fully rebuilt, so adding one trailing child touches no
  // existing node and is idempotent across re-opens. No stableId is read;
  // nothing here is sent to the server (Phase-1 security + no-accounts).
  const ritual = document.createElement('div');
  ritual.className = 'daily-ritual';

  const prevStreak = readDailyStreak();
  const { streak, next } = computeDailyStreak(puzzleNumber, prevStreak);
  writeDailyStreak(next);

  const streakEl = document.createElement('div');
  streakEl.className = 'daily-streak';
  streakEl.textContent = `Day ${streak} 🔥`;

  const countdownEl = document.createElement('div');
  countdownEl.className = 'daily-countdown';
  countdownEl.textContent = `Resets in ${formatResetCountdown()}`;

  ritual.appendChild(streakEl);
  ritual.appendChild(countdownEl);
  bodyEl.appendChild(ritual);

  // Phase 7.4: keep the countdown live (minute cadence — h/m granularity
  // never needs faster). Self-clearing: the first tick that observes the
  // modal hidden clears itself, so EVERY close path (Done button, the ✕
  // global .modal-close handler, any programmatic .hidden) stops it without
  // touching that global handler. Combined with the top-of-render hard-clear
  // this bounds the app to ≤1 live interval, ever.
  _dailyCountdownTimer = setInterval(() => {
    if (modal.classList.contains('hidden')) {
      clearInterval(_dailyCountdownTimer);
      _dailyCountdownTimer = null;
      return;
    }
    countdownEl.textContent = `Resets in ${formatResetCountdown()}`;
  }, 60000);

  modal.classList.remove('hidden');
}
```

- [ ] **Step 3e: Add the additive CSS to `public/css/06-states-anim.css`**

Find the end of the daily leaderboard block — the `.daily-lb-len { … }` rule ends at line ~249, immediately before:

```css
/* =============================================
   H5: MY STATS MODAL
```

Insert this additive block **between** `.daily-lb-len { … }` and the `H5: MY STATS MODAL` comment:

```css

/* Phase 7.4 (Daily ritual) — additive only; no existing rule touched. The
   streak badge + reset countdown sit at the foot of the result body. Static
   styling only (no animation) so prefers-reduced-motion needs no special
   case here. */
.daily-ritual {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 1rem;
  padding: 0.6rem 0.9rem;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.10), rgba(217, 119, 6, 0.05));
  border: 1px solid rgba(245, 158, 11, 0.22);
}
.daily-streak {
  font-weight: 800;
  color: #fbbf24;
  font-size: 1rem;
}
.daily-countdown {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/mm-phase7-4 && npx jest client-tests/daily-ritual.test.js`
Expected: PASS (all describes green, incl. the additive-render + idempotent-reopen guards).

- [ ] **Step 5: Run the full suite**

Run: `cd C:/mm-phase7-4 && npx jest`
Expected: green; +1 suite (`daily-ritual.test.js`). No existing test edited; `client-tests/daily-name-prompt.test.js` and all others still green.

- [ ] **Step 6: Verify branch, then commit**

```bash
cd C:/mm-phase7-4 && B=$(git branch --show-current) && [ "$B" = "phase7-4-quick-win-identity" ] && git add public/js/ui/daily-ritual.js public/js/ui.js public/js/ui/ui-panels.js public/css/06-states-anim.css client-tests/daily-ritual.test.js && git commit -m "Phase 7.4 (2): Daily ritual — pure reset-countdown + device-local streak, appended additively"
```

```json:metadata
{"files": ["public/js/ui/daily-ritual.js", "public/js/ui.js", "public/js/ui/ui-panels.js", "public/css/06-states-anim.css", "client-tests/daily-ritual.test.js"], "verifyCommand": "cd C:/mm-phase7-4 && npx jest client-tests/daily-ritual.test.js", "acceptanceCriteria": ["formatResetCountdown: ms to next UTC 00:00:00 → 'Xh Ym' (≥1h) / 'Ym' (<1h≥1m) / '<1m'; never negative; never a day component", "computeDailyStreak: ==prev→unchanged(idempotent), ==prev+1→increment, else/missing/corrupt/non-integer→1; returns {streak,next}", "readDailyStreak/writeDailyStreak: key mm:dailyStreak; any throw/malformed/wrong-shape→null; write swallows errors", "renderDailyResult appends one .daily-ritual block as last child of #daily-result-body; existing title/subtitle/score/replay/leaderboard nodes unmodified; no stableId rendered", "≤1 live interval ever: module-scoped id hard-cleared at top of render + interval self-clears when modal hidden (covers Done, ✕ global handler, programmatic .hidden)", "barrel re-exports daily-ritual.js; ui-panels.js uses a direct sibling import (no barrel cycle)", "additive CSS after the daily-lb block; no existing rule edited", "WHY comments on every change", "full npx jest suite green, daily-name-prompt + all others still green"]}
```

---

## Plan Self-Review

**1. Spec coverage** (against `2026-05-18-quick-win-identity-design.md`):
- §3.1 Theme-Packs (re-voice label/description, id/match byte-identical, behavioural guard, 6c-dedup presentation-only) → **Task 0** ✓ (exact copy table provided; existing test = behavioural guard).
- §3.2 Panic Timer (pure `timerSeverity`, strict-subset `timer-panic`, removed everywhere critical is, additive keyframe transform/box-shadow-only, reduced-motion via existing global block, composes over speed-mode `!important`) → **Task 1** ✓.
- §3.3 Daily ritual (pure `formatResetCountdown` + `computeDailyStreak` + defensive localStorage, additive append, self-clearing interval, monotonic `puzzleNumber` key, no `stableId`, device-local) → **Task 2** ✓.
- §5 Testing (new additive tests; theme behavioural guard = the untouched existing 9; daily/timer have no prior client test so additive) → covered in each task ✓.
- §7 guardrails (no socket/server/scoring/persistence/account change; perf compositor-only + one minute interval; reduced-motion; WHY comments; branch-verify; classifier-gated finish) → embedded in tasks + commit steps ✓.
- §4 6c-dedup (presentation only, no kit mechanic) → Task 0 WHY comment + acceptance ✓.
- §8 out-of-scope (Player Entrance Cards / Host Director → 7.5; no preset mechanic) → not built; no task touches the lobby player list or host controls ✓.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to"/prose-only steps. Every code step has complete code incl. the exact authored theme strings, full pure functions, exact find/replace blocks with surrounding context, exact CSS. ✓

**3. Type/identifier consistency:** `timerSeverity` (Task 1: defined in `timer-panic.js`, imported in `socketClient.js`, asserted in test) — consistent. `formatResetCountdown` / `computeDailyStreak` / `readDailyStreak` / `writeDailyStreak` (Task 2: defined in `daily-ritual.js`, imported in `ui-panels.js`, asserted in test) — consistent. Persisted shape `{ lastPuzzleNumber, streak }` consistent across `computeDailyStreak` / `_validPrev` / read/write / tests. Barrel lines added in Task 1 then Task 2 (Task 2 references "the line added in Task 1" — linear order enforced). Class names `daily-ritual`/`daily-streak`/`daily-countdown`/`timer-panic` consistent between JS, CSS, and tests. ✓

No issues found requiring a task change.

---

## Process Notes

- Linear task chain **0 → 1 → 2** (Tasks 1 & 2 share `public/js/ui.js` + `public/css/06-states-anim.css`; sequencing avoids stale-line edits — implementers re-read current file state before editing).
- Each task: subagent-built with the FULL task text + exact code (implementers do **not** read this plan file); then an independent spec-compliance review, then an independent code-quality review, with real fix-loops; a final opus whole-branch holistic review before finishing.
- Native Task tools unavailable → TodoWrite in-session + the co-located `.md.tasks.json` (status synced + committed per task).
- Branch safety: a parallel Codex agent shares this repo → `git -C C:/mm-phase7-4 branch --show-current` is verified `== phase7-4-quick-win-identity` before **every** commit (baked into each Task's Step 6).
- WHY comments on every changed line; `coverage/` never staged.
- Finishing: push the branch + `gh pr create` (base `main`, `origin/main` = `602ad74`). PR-merge / push-to-main / Render deploy is classifier-gated and handed to the user. Real-boot / in-browser eyeball (theme picker copy, the panic pulse on desktop + mobile + with `prefers-reduced-motion`, the daily countdown/streak) is user-side — jsdom never lays out or boots a browser.
