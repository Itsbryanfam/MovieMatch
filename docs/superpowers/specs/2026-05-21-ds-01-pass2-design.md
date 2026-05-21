# Phase 7.10 — DS-01 Pass 2: Design Spec

**Date:** 2026-05-21
**Status:** Approved (brainstorming, Approach A — mechanical migration into existing patterns) — proceeding to writing-plans.
**Phase:** **7.10** — epilogue cleanup pass under Phase 7 UI/UX Elevation. Closes the explicitly-recorded "DS-01 pass 2" backlog deferred from Phase 7.3 (`docs/superpowers/specs/2026-05-17-design-system-hardening-design.md` §7).

This is an **implementation design spec** (decision record + decomposition), consumed by writing-plans next. One sub-phase = one spec → plan → subagent-build → PR.

---

## 0. Goal

Close the explicitly-recorded "DS-01 pass 2" follow-up: migrate the remaining static-inline-style debt (13 `style="..."` attrs in `index.html` + 13 `.style.cssText` writes across the leaderboard renderer / public-lobby join button / two empty-hint sites) into the ordered CSS partials, and delete the post-7.9 `.demo-item` orphan (the inline `<style>` block at `index.html:79-82` plus the 5 matching dead rules in `02-hero-lobby.css:131-143`).

**Hard constraint (inherited from 7.3 §0 / decision-record §3):** **zero-behaviour-change refactor.** The migration must be byte-for-byte visually and behaviourally identical on every surface that renders today. The six-partial CSS cascade order is load-bearing and is not reordered. The one *intentional* delta is the dead-code excision in item D (`.demo-item` rules + matching inline `<style>` block) — verified to have zero JS and zero markup consumers, so the deletion is provably visually inert.

---

## 1. Provenance

- **Source:** Phase 7.3 spec §7 explicitly recorded a "DS-01 pass 2" follow-up so 7.3 stayed bounded/M-effort and provably zero-behaviour. The deferred list is verbatim: *"bulk static HTML `style=` attributes in `index.html` (demo `<img>`, margin one-offs, the `theme-select` inline styling, initial `display:none` states), the leaderboard-render `.style.cssText` block (`app.js:662-701`), the `socketClient.js`/`app.js` empty-hint `innerHTML` inline styles, and the `index.html:76-79` inline `<style>` block."* Line numbers from 2026-05-17 have shifted (Phase 7.4–7.9 churn); this spec verifies against current code at `origin/main 7ad0857`.
- **Lineage:** mirrors the discipline of 7.3 (the original DS-01) — zero-behaviour-change CSS hygiene refactor, append-only migration into ordered partials, sacrosanct suites stay byte-identical, ratchet on green test count.
- **No competing source.** This is closeout work, not a new audit. The widest-scope option (raw-hex / off-token color audit across all partials) was considered during brainstorming and explicitly deferred — it would widen scope into a true design-system pass, better-suited as its own phase if needed.
- **Branch:** `phase7-10-ds01-pass2` off `origin/main 7ad0857` (post-7.9 merge). No isolated worktree this phase — no parallel-agent concerns.
- **Suite baseline:** 592 green (post-7.9). Target after T2: ~610 green (+18 net new tests).

---

## 2. Inventory (verified against `origin/main 7ad0857`)

### 2.1 Item A — `index.html` static `style="..."` attributes (13)

| # | Line | Element | Inline value |
|---|------|---------|--------------|
| 1 | :186 | `<div class="input-group-vertical">` (in `.lobby-discover-section`) | `margin-bottom: 1.5rem;` |
| 2 | :209 | `<button id="join-btn" class="btn btn-primary">` | `margin-bottom:0.75rem;` |
| 3 | :225 | `<div class="empty-hint">` (lobbies loading text) | `text-align:center; padding: 2rem; color: var(--text-muted); font-style:italic;` |
| 4 | :465 | `<button id="team-start-btn" class="btn btn-primary ref-cta">` | `display:none;` |
| 5 | :482 | `<span id="chat-badge">` (mobile-tab badge) | `display:none;` |
| 6 | :692 | `<div>` (replay-tutorial wrapper) | `display:flex; justify-content:center; margin-top:1rem;` |
| 7 | :694 | `<button id="replay-tutorial-btn" class="btn btn-secondary">` | `padding:0.5rem 1.2rem;` |
| 8 | :752 | `<div id="leaderboard-list">` | `max-height:400px;overflow-y:auto;margin-top:1rem;` |
| 9 | :766 | `<div id="my-stats-body">` | `max-height:60vh;overflow-y:auto;margin-top:1rem;` |
| 10 | :784 | `<div id="daily-result-body">` | `max-height:60vh;overflow-y:auto;margin-top:1rem;` |
| 11 | :785 | `<div class="daily-result-actions">` | `display:flex; gap:0.6rem; justify-content:center; margin-top:1rem;` |
| 12 | :787 | `<button id="daily-result-share-btn" class="btn btn-primary">` | `padding:0.55rem 1.2rem;` |
| 13 | :788 | `<button id="daily-result-close-btn" class="btn btn-secondary">` | `padding:0.55rem 1.2rem;` |

### 2.2 Item B — Leaderboard `.style.cssText` block (`app.js:614-650`, 7 writes)

```js
loadingDiv.style.cssText = 'text-align:center;padding:2rem;color:var(--text-muted);';                              // :614
emptyDiv.style.cssText   = 'text-align:center;padding:2rem;color:var(--text-muted);font-style:italic;';            // :624
row.style.cssText        = 'display:flex;align-items:center;padding:0.75rem 1rem;border-bottom:1px solid rgba(255,255,255,0.06);'; // :631
rank.style.cssText       = 'width:2.5rem;font-size:1.1rem;text-align:center;flex-shrink:0;';                        // :633
name.style.cssText       = 'flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';     // :636
wins.style.cssText       = 'color:var(--text-muted,#94a3b8);font-size:0.9rem;flex-shrink:0;margin-left:0.5rem;';   // :639
errorDiv.style.cssText   = 'text-align:center;padding:2rem;color:var(--text-muted);';                              // :650
```

Note: the `wins` cssText carries an `#94a3b8` fallback that never resolves (`var(--text-muted)` is always defined in `01-base.css:21`) — dead fallback, dropped during migration.

### 2.3 Item C — Empty-hint `.style.cssText` writes (3)

```js
joinButton.style.cssText = 'padding: 0.5rem 1rem; width: auto;';                                  // socketClient.js:193 — .join-public-btn
empty.style.cssText      = 'text-align:center; padding:2rem; color:var(--text-muted); font-style:italic;'; // ui-panels.js:190 — stats empty-state .empty-hint
empty.style.cssText      = 'text-align:center; padding:1rem; color:var(--text-muted);';            // ui-panels.js:396 — daily-lb empty-state .empty-hint
```

The two `.empty-hint` writes are mostly redundant: the existing `.empty-hint` rule at `03-game.css:357-363` already provides `padding/color/font-size/text-align/font-style`. The inline writes' only effective deltas are the padding overrides (2rem and 1rem vs the default 1.25rem) — preserved byte-identically via new `.empty-hint--lg` / `.empty-hint--sm` modifier classes.

### 2.4 Item D — `.demo-item` orphan (inline `<style>` block + 5 matching CSS rules)

`index.html:79-82`:
```html
<style>
  /* Prevent flicker for hero demo */
  .hero-demo .demo-item { opacity: 0; transform: translateY(-40px); }
</style>
```

`02-hero-lobby.css:131-143` (5 rules):
```css
.hero-demo .demo-item {
  opacity: 0;
  transform: translateY(-40px);
  transition: opacity 0.6s ease-out, transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.hero-demo.animate-demo .demo-item {
  opacity: 1;
  transform: translateY(0);
}

.hero-demo.animate-demo .demo-item-1 { animation-delay: 0.2s; }
.hero-demo.animate-demo .demo-item-2 { animation-delay: 0.8s; }
.hero-demo.animate-demo .demo-item-3 { animation-delay: 1.4s; }
```

**Verified orphan status** (grep against full repo at `7ad0857`):
- `.demo-item` selector: zero JS consumers, zero markup consumers. (Phase 7.9 replaced the entire `.hero-demo` block with `#hero-puzzle`; the `.demo-item-1/-2/-3` children are gone.)
- `.animate-demo` class: zero JS additions (no `classList.add('animate-demo')` anywhere); only appears in the 4 CSS rules above. Co-orphan.

The inline `<style>` block at `index.html:79-82` is the original §7-listed "inline `<style>` block" (line numbers shifted by 3 since 7.3 was specced). The matching dead CSS rules are the *natural co-deletion* — keeping them while removing the inline `<style>` block would leave a dangling rule set with no consumers.

---

## 3. Architecture

**Pattern:** zero-behaviour-change CSS hygiene refactor — mirrors 7.3 / 7.5–7.9 discipline. Three linear TDD tasks, each producing a coherent committable diff with a sacrosanct-suite-byte-identical guarantee.

**File boundaries:**
- New CSS rules land in the partial that owns the surface: `02-hero-lobby.css` (lobby surfaces — `.join-public-btn`, `#join-btn`, contextual `.input-group-vertical`), `03-game.css` (game / empty-hint family — `.leaderboard-*`, `.empty-hint--lg/--sm`), `04-modals.css` (modal contents — modal-body scroll, daily-result buttons, replay-tutorial row).
- Cascade order load-bearing: the six `<link>` partial order in `index.html:71-76` is **not** reordered.
- Append-only to each touched partial. Single exception: the explicit dead-code excision in item D (5 dead rules in `02-hero-lobby.css:131-143`) — flagged in the spec, plan, and PR body as the one intentional deletion.

**Three linear TDD tasks:**

- **T0 — Leaderboard renderer migration** (`03-game.css` append + `app.js:614-650` rewrite + new test file).
- **T1 — Empty-hint cleanup** (`02-hero-lobby.css` append for `.join-public-btn` + `socketClient.js:193` and `ui-panels.js:190`/`:396` cleanup + new test file).
- **T2 — `index.html` migration + `.demo-item` orphan deletion** (`04-modals.css` append + `02-hero-lobby.css` deletion + `index.html` migration + new test file).

Each task is independently committable, independently reviewable (two-stage spec then code-quality), and verifiable by a green suite.

**Naming convention** follows existing codebase (BEM-ish single-`-` for elements, `--` for modifiers, no utility classes):
- `.leaderboard-row` / `.leaderboard-rank` / `.leaderboard-name` / `.leaderboard-wins`
- `.empty-hint--lg` / `.empty-hint--sm`
- `.join-public-btn`
- `.replay-tutorial-row`

ID-based selectors are used where the element has a unique `id` and a unique style (e.g., `#leaderboard-list`, `#join-btn`, `#replay-tutorial-btn`, `#daily-result-share-btn`, `#daily-result-close-btn`). Where an element class already exists but has no rule yet (e.g., `.daily-result-actions`), that class is the natural home for the rule. The combined-selector shape (e.g., `#my-stats-body, #daily-result-body { ... }`) is used where two elements have byte-identical styles.

---

## 4. Per-item Migration Map

### 4.1 Item A — `index.html` static `style="..."` attrs

| # | Line | Inline value | Migration |
|---|------|--------------|-----------|
| 1 | :186 | `margin-bottom: 1.5rem;` on `.input-group-vertical` (inside `.lobby-discover-section`) | New rule in `02-hero-lobby.css`: `.lobby-discover-section .input-group-vertical { margin-bottom: 1.5rem; }` (contextual — does not affect other `.input-group-vertical` callers; verified via grep — only one other usage and it does not need this margin). |
| 2 | :209 | `margin-bottom:0.75rem;` on `#join-btn` | New rule in `02-hero-lobby.css`: `#join-btn { margin-bottom: 0.75rem; }` |
| 3 | :225 | full inline on `.empty-hint` (lobbies loading) | DELETE inline (4 of 5 props already covered by existing `.empty-hint` rule). Add `class="empty-hint empty-hint--lg"` to preserve the 2rem padding override via the new `.empty-hint--lg` modifier. |
| 4 | :465 | `display:none;` on `#team-start-btn` | Add `class="...hidden"` (existing `.hidden` rule at `02-hero-lobby.css:564`). |
| 5 | :482 | `display:none;` on `#chat-badge` | Add `class="...hidden"` |
| 6 | :692 | inline flex+center+margin on replay-tutorial wrapper `<div>` | Add `class="replay-tutorial-row"` + new rule in `04-modals.css`: `.replay-tutorial-row { display: flex; justify-content: center; margin-top: 1rem; }` |
| 7 | :694 | `padding:0.5rem 1.2rem;` on `#replay-tutorial-btn` | New rule in `04-modals.css`: `#replay-tutorial-btn { padding: 0.5rem 1.2rem; }` |
| 8 | :752 | full inline on `#leaderboard-list` | New rule in `04-modals.css`: `#leaderboard-list { max-height: 400px; overflow-y: auto; margin-top: 1rem; }` |
| 9-10 | :766, :784 | identical inline on `#my-stats-body` / `#daily-result-body` | New combined-selector rule in `04-modals.css`: `#my-stats-body, #daily-result-body { max-height: 60vh; overflow-y: auto; margin-top: 1rem; }` |
| 11 | :785 | full inline on `.daily-result-actions` | New rule in `04-modals.css`: `.daily-result-actions { display: flex; gap: 0.6rem; justify-content: center; margin-top: 1rem; }` (existing class already on the element — just gains its first CSS rule). |
| 12-13 | :787, :788 | identical `padding:0.55rem 1.2rem;` on `#daily-result-share-btn` / `#daily-result-close-btn` | New combined-selector rule in `04-modals.css`: `#daily-result-share-btn, #daily-result-close-btn { padding: 0.55rem 1.2rem; }` |

**Subtotal:** 13 inline `style="..."` attrs removed. New CSS rules added: 3 to `02-hero-lobby.css` (incl. contextual #1), 7 to `04-modals.css`. Two `class="...hidden"` additions in `index.html`. One `class="replay-tutorial-row"` addition.

### 4.2 Item B — Leaderboard renderer (`app.js:614-650`)

**Append to `03-game.css`** (near the existing `.empty-hint` family at `:357-363`):

```css
/* Phase 7.10 — DS-01 pass 2: leaderboard row components.
   Extracted from app.js:614-650 cssText writes. Same pixel values
   verbatim; the dead #94a3b8 fallback (var(--text-muted) always
   resolves from 01-base.css:21) is dropped. */
.empty-hint--lg { padding: 2rem; }
.empty-hint--sm { padding: 1rem; }

.leaderboard-row {
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.leaderboard-rank {
  width: 2.5rem;
  font-size: 1.1rem;
  text-align: center;
  flex-shrink: 0;
}
.leaderboard-name {
  flex: 1;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.leaderboard-wins {
  color: var(--text-muted);
  font-size: 0.9rem;
  flex-shrink: 0;
  margin-left: 0.5rem;
}
```

**Rewrite `app.js:614-650`** — swap each `.style.cssText` for `className`:

| Before | After |
|--------|-------|
| `loadingDiv.style.cssText = 'text-align:center;padding:2rem;color:var(--text-muted);';` | `loadingDiv.className = 'empty-hint empty-hint--lg';` |
| `emptyDiv.style.cssText = '...padding:2rem...font-style:italic;';` | `emptyDiv.className = 'empty-hint empty-hint--lg';` |
| `row.style.cssText = '...';` | `row.className = 'leaderboard-row';` |
| `rank.style.cssText = '...';` | `rank.className = 'leaderboard-rank';` |
| `name.style.cssText = '...';` | `name.className = 'leaderboard-name';` |
| `wins.style.cssText = '...';` | `wins.className = 'leaderboard-wins';` |
| `errorDiv.style.cssText = '...';` | `errorDiv.className = 'empty-hint empty-hint--lg';` |

`loadingDiv` already has `className = 'empty-hint';` set at `:613` — the migration consolidates to `'empty-hint empty-hint--lg'` (drops the redundant duplicate assignment if any).

The `loadingDiv.textContent = 'Loading...'` / `emptyDiv.textContent = 'No wins recorded yet. Play a game!'` / `errorDiv.textContent = 'Failed to load leaderboard.'` are unchanged.

### 4.3 Item C — Empty-hint cleanup (3 sites)

| Site | Migration |
|------|-----------|
| `socketClient.js:193` `joinButton.style.cssText = 'padding: 0.5rem 1rem; width: auto;';` | DELETE inline. Add new rule in `02-hero-lobby.css`: `.join-public-btn { padding: 0.5rem 1rem; width: auto; }` (existing class already on the element at `:192`). |
| `ui-panels.js:190` `empty.style.cssText = '...padding:2rem...font-style:italic;';` | Swap for `empty.className = 'empty-hint empty-hint--lg';` (modifier preserves the 2rem padding override; existing `.empty-hint` rule provides the other 4 props). |
| `ui-panels.js:396` `empty.style.cssText = '...padding:1rem...';` | Swap for `empty.className = 'empty-hint empty-hint--sm';` (modifier preserves the 1rem padding override). |

Note: `ui-panels.js:190` and `:396` already set `empty.className = 'empty-hint';` *before* the cssText write — the migration consolidates to `'empty-hint empty-hint--lg'` / `'empty-hint empty-hint--sm'` (eliminates the redundant double-assignment).

### 4.4 Item D — `.demo-item` orphan deletion (6 artifacts)

Delete in entirety:
1. `public/index.html:79-82` — the inline `<style>` block
2. `public/css/02-hero-lobby.css:131-143` — five rules:
   - `.hero-demo .demo-item { ... }`
   - `.hero-demo.animate-demo .demo-item { ... }`
   - `.hero-demo.animate-demo .demo-item-1 { animation-delay: 0.2s; }`
   - `.hero-demo.animate-demo .demo-item-2 { animation-delay: 0.8s; }`
   - `.hero-demo.animate-demo .demo-item-3 { animation-delay: 1.4s; }`

**Verified zero-consumer evidence** (grep against `7ad0857`):
- `grep -rn 'demo-item' public/js` → 0 matches
- `grep -rn 'animate-demo' public/js` → 0 matches
- `grep -n 'demo-item' public/index.html` → 1 match (only the inline `<style>` block being deleted)
- `grep -n 'animate-demo' public/index.html` → 0 matches

The deletion is provably visually inert (no DOM element ever had/has the `.demo-item` or `.animate-demo` class to be styled by these rules).

---

## 5. Scope Boundaries

### 5.1 In scope (Recommended slice — user-approved)

- The four backlog items from original DS-01 spec §7 (A: 13 `index.html` `style="..."` attrs; B: 7 leaderboard `.style.cssText`; C: 3 empty-hint `.style.cssText`; D: inline `<style>` block at `index.html:79-82`).
- Bonus: the 5 dead `.demo-item` rules at `02-hero-lobby.css:131-143` (matching co-orphans of D).
- 3 new test files (~18 net new tests, suite 592 → 610).
- ~15 new CSS rules (3-4 in `02-hero-lobby.css`, 6 in `03-game.css`, 7 in `04-modals.css`) — all *append-only* to those partials except the explicit dead-code deletions in D.

### 5.2 Permanently excluded (not debt — behaviour, not static presentation)

- The 31 dynamic `.style.*` writes across 6 files (`socketClient.js`, `app.js`, `modal.js`, `ui-panels.js`, `ui-render.js`, `ui-notifications.js`) — `style.display` show/hide toggles, computed `transform`/`opacity`, progress widths, the empty-field `borderColor` validation cue. These are *behaviour/state*, not static presentation debt. Migrating any of them would either change behaviour or be impossible.

### 5.3 Deferred (better as its own phase if needed)

- Raw-hex / off-token color audit across all CSS partials and JS inline writes. Brainstormed and explicitly chosen over (the user picked the Recommended scope, not the Widest scope). If this matters later, spec it as its own pass.
- Pure-seam extraction of the leaderboard renderer (`renderLeaderboard(data, container)` in the red-carpet.js / chain-recap.js / hero-puzzle.js lineage). The renderer is small enough that the inline-style migration is sufficient — seam extraction would widen scope.
- Any visual change to already-correct UI surfaces. The constraint is verbatim zero-behaviour-change preservation; modifier classes (`.empty-hint--lg/--sm`) guarantee byte-identical padding for the 3 override sites.

### 5.4 Out-of-scope findings during build

If something is noticed mid-build that's not in scope, use `mcp__ccd_session__spawn_task` to chip it (per the established 7.x pattern). Never widen this phase.

---

## 6. Test Strategy (TDD)

**Three new test files** (one per task) — each task lands its failing test first, then makes it pass.

### 6.1 T0 — `client-tests/leaderboard-render.test.js` (~7 tests, jsdom)

```js
/** @jest-environment jsdom */
// Phase 7.10 — DS-01 pass 2: pin the leaderboard renderer's class
// contract so cssText migration is the only path to green.

const { loadIndexHtml } = require('./helpers/fixtures');

describe('loadLeaderboard renderer (post DS-01 pass 2)', () => {
  beforeEach(() => {
    loadIndexHtml();
    // ... module reset, fetch stub
  });

  test('loading state renders empty-hint empty-hint--lg div', /* ... */);
  test('empty response renders empty-hint empty-hint--lg div with no-wins copy', /* ... */);
  test('non-empty response renders one .leaderboard-row per entry', /* ... */);
  test('each row has .leaderboard-rank / .leaderboard-name / .leaderboard-wins children', /* ... */);
  test('rank cell shows 🥇/🥈/🥉 for top-3, #N for index >=3', /* ... */);
  test('fetch error renders empty-hint empty-hint--lg error div', /* ... */);
  test('no rendered element has a `style` attribute (cssText fully removed)', /* ... */);
});
```

### 6.2 T1 — `client-tests/empty-hint-migration.test.js` (~5 tests)

```js
// Phase 7.10 — DS-01 pass 2: pin the 3 empty-hint cssText sites'
// post-migration class+rule contract.

const fs = require('fs');
const path = require('path');

describe('empty-hint migration', () => {
  test('socketClient.js join button has .join-public-btn class, no inline style', /* ... */);
  test('.join-public-btn rule exists in 02-hero-lobby.css', /* ... */);
  test('ui-panels.js stats-empty has empty-hint empty-hint--lg, no inline style', /* ... */);
  test('ui-panels.js daily-lb-empty has empty-hint empty-hint--sm, no inline style', /* ... */);
  test('.empty-hint--lg and .empty-hint--sm rules exist in 03-game.css', /* ... */);
});
```

### 6.3 T2 — `client-tests/index-inline-styles.test.js` (~6 tests, fs-based)

```js
// Phase 7.10 — DS-01 pass 2: pin post-migration state of index.html
// inline styles + .demo-item orphan deletion.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const css  = fs.readFileSync(path.join(__dirname, '../public/css/02-hero-lobby.css'), 'utf8');

describe('index.html post-migration', () => {
  test('no style="..." attribute remains on any element', () => {
    expect((html.match(/style="[^"]*"/g) || []).length).toBe(0);
  });
  test('#team-start-btn includes class "hidden"', /* ... */);
  test('#chat-badge includes class "hidden"', /* ... */);
  test('#leaderboard-list / #my-stats-body / #daily-result-body have no inline style', /* ... */);
  test('<head> contains no inline <style> block (only <link> and <script>)', /* ... */);
  test('.demo-item selector is fully absent from 02-hero-lobby.css', () => {
    expect(css).not.toMatch(/\.demo-item/);
  });
});
```

### 6.4 Suite math

| | Tests | Suites |
|---|------|--------|
| Baseline (post-7.9) | 592 | varies |
| T0 adds | +7 | +1 (`leaderboard-render.test.js`) |
| T1 adds | +5 | +1 (`empty-hint-migration.test.js`) |
| T2 adds | +6 | +1 (`index-inline-styles.test.js`) |
| **Target** | **610** | **+3** |

Zero pre-existing tests edited. Suite must hold or rise.

### 6.5 Sacrosanct suites (byte-identical guarantee)

The following test files **must show zero diff** against `origin/main 7ad0857` after the full pass:

- Phase 7.3 protected: `daily-name-prompt.test.js`, `modal-factory.test.js`, `name-prompts.test.js`, `self-elim-aftercare.test.js`, `learning-breakdown.test.js`
- Phase 7.5–7.9 seam tests: `red-carpet.test.js`, `seat-model.test.js`, `chain-recap.test.js`, `recap-player.test.js`, `sharecard.test.js`, `turn-motion.test.js`, `hero-puzzle.test.js`, `hero-puzzle-controller.test.js`
- Other guard suites: `render-chain.test.js`, `render-lobby.test.js`, `poster-fallback.test.js`, `ghost-attempt.test.js`
- All `server/**.test.js`

Verification: `git diff --stat origin/main -- client-tests/ server/` must show zero entries for any of the above files.

### 6.6 Manual real-boot verification (required pre-merge — jsdom can't lay out)

Open in a real browser (desktop + mobile viewport):

- **Leaderboard modal:** rows render with correct spacing, colors, border-bottoms — visually byte-identical to pre-migration.
- **My Stats modal with no plays:** empty hint displays at the right padding (2rem via `.empty-hint--lg`).
- **Daily Result modal with no entries:** daily-lb empty hint displays at the right padding (1rem via `.empty-hint--sm`).
- **Public lobby list:** join button keeps its padding and `width: auto;`.
- **Landing page hero:** Playable Hero (7.9) still works identically — the `.demo-item` deletion should not affect it; verifying it doesn't.
- **Daily Result modal:** buttons keep their `0.55rem 1.2rem` padding; actions row keeps centered with `0.6rem` gap.
- **How-to-Play modal → Replay tutorial:** button keeps its `0.5rem 1.2rem` padding; row keeps centered layout.
- **Initial page load:** `#team-start-btn` and `#chat-badge` not visible (verifying `.hidden` class kicks in identically to `style="display:none"`).
- **OS reduced-motion:** existing reduced-motion behaviour unchanged (no new motion introduced).

---

## 7. Zero-Behaviour-Change Guard

### 7.1 The verifiability story

Three concentric guards:

1. **Sacrosanct suites byte-identical** — `git diff` against `origin/main 7ad0857` for the §6.5 file list must show zero entries. Proves the touched-code's contract surfaces are unchanged.
2. **Modifier classes preserve byte-identical pixels** for the 3 padding-override sites (Items A#3, C#2, C#3 use `.empty-hint--lg`/`--sm` which set `padding: 2rem` / `padding: 1rem` exactly).
3. **Manual eyeball gate** — §6.6 list confirms visual byte-identity on every touched surface (mandatory pre-merge per the established 7.x lesson — jsdom never lays out).

### 7.2 The one intentional delta

The dead `#94a3b8` fallback in `.leaderboard-wins` color is dropped during migration. `var(--text-muted)` is always defined in `01-base.css:21`; the fallback never resolves at runtime. The rendered color is identical pre- and post-migration. Called out in the PR body as the one intentional dead-fallback removal.

### 7.3 The dead-code excision (Item D)

The 5 `.demo-item` rules + the inline `<style>` block are deleted. Verified zero JS/markup consumers via grep (§2.4). The deletion is provably visually inert because no DOM element ever had/has the `.demo-item` or `.animate-demo` class.

---

## 8. Binding Guardrails (10)

1. **Cascade order load-bearing.** The six `<link>` partial order in `index.html:71-76` is NOT reordered. New rules land in their natural home partial (lobby → `02-hero-lobby.css`, game/empty-hint family → `03-game.css`, modal → `04-modals.css`).
2. **Sacrosanct files byte-identical** (verified post-build via `git diff`): all files listed in §6.5.
3. **Append-only CSS** to the three touched partials. Single exception: the explicit dead-code excision in Item D (`02-hero-lobby.css:131-143` 5 rules) — flagged in the spec, plan, PR body. Inline `<style>` block at `index.html:79-82` also deleted.
4. **No new color tokens.** All new rules use existing `--text-muted` / `--text-main` / `--accent-primary` etc. The `#94a3b8` fallback is *dropped* (dead fallback), not replaced with a different value.
5. **No new `@media` queries.** Modifier classes handle the pixel-preservation work; the dead `.demo-item` rules had no `@media` (verified).
6. **No new animations.** N/A — none introduced. The deleted `.demo-item` animations had no consumers (verified).
7. **`prefers-reduced-motion` honoured.** N/A — no new motion. Existing reduced-motion behaviour unchanged.
8. **Every code change carries a WHY comment** — per the user's persistent memory feedback (`feedback_code_comments`).
9. **Real-boot / in-browser gate.** Touches modal/leaderboard/public-lobby/landing/how-to-play surfaces; jsdom can't lay out → §6.6 real-boot eyeball is required pre-merge. "Merged" ≠ "deployed."
10. **Branch safety.** Branch `phase7-10-ds01-pass2` off `origin/main 7ad0857`; no worktree; `git branch --show-current` verified before every commit; no history-rewrite; commits never skip hooks.

---

## 9. Acceptance Criteria

- [ ] `index.html` has zero `style="..."` attributes on any element (regex assertion test passes).
- [ ] `#team-start-btn` and `#chat-badge` have `class="...hidden"` (no inline `display:none`).
- [ ] `#leaderboard-list` / `#my-stats-body` / `#daily-result-body` / `#daily-result-share-btn` / `#daily-result-close-btn` / `#replay-tutorial-btn` / `#join-btn` have no inline `style` attribute.
- [ ] `.daily-result-actions` and `.replay-tutorial-row` classes have CSS rules in `04-modals.css`.
- [ ] `.input-group-vertical` contextual rule in `02-hero-lobby.css` provides the 1.5rem bottom margin only inside `.lobby-discover-section`.
- [ ] `.leaderboard-row` / `.leaderboard-rank` / `.leaderboard-name` / `.leaderboard-wins` rules in `03-game.css`; `.empty-hint--lg` / `.empty-hint--sm` modifiers in `03-game.css`.
- [ ] `app.js:614-650` leaderboard renderer uses `className` assignments only (zero `.style.cssText` in the function).
- [ ] `.join-public-btn` rule in `02-hero-lobby.css`; `socketClient.js:193` `joinButton` has no inline style.
- [ ] `ui-panels.js:190` stats-empty has `className = 'empty-hint empty-hint--lg'` and no inline style.
- [ ] `ui-panels.js:396` daily-lb-empty has `className = 'empty-hint empty-hint--sm'` and no inline style.
- [ ] `index.html:79-82` inline `<style>` block deleted (head contains no inline `<style>`).
- [ ] `02-hero-lobby.css:131-143` 5 `.demo-item` rules deleted (`.demo-item` selector absent from the file).
- [ ] Existing suite + new tests green (`npm test --silent`) → 610 total.
- [ ] All §6.5 sacrosanct files show zero `git diff` against `origin/main 7ad0857`.
- [ ] Every code change carries a WHY comment.

---

## 10. Lessons Applied (from prior 7.x phases)

- **Plan must list necessary-collateral test updates AND barrel re-exports** (7.6/7.7 reinforced lesson): T0/T1/T2 plans explicitly enumerate every test file modified (none should require collateral update because new tests live in new files, but the plan will state this explicitly).
- **Fix the buggy plan-test, NEVER the protected path** (7.5.3/7.6/7.7 reinforced lesson): if an implementer subagent finds a plan-test that's wrong, fix the plan-test, never weaken or edit a sacrosanct suite.
- **Post-PR reconcile's destructive tail needs explicit in-session user merge confirmation** (7.6 reinforced lesson, hardened across 7.6.1/7.6.2/7.6.3/7.7/7.8/7.9): the controller waits for user explicit "Yes, merged" before `git push origin --delete` / `git branch -d`.
- **PR-merge / push-to-main / Render deploy is classifier-gated → handed to the user** (`feedback_deploy_authorization`): the PR opens; the merge is the user's call.
- **Every code change ships a WHY comment** (`feedback_code_comments`): not what, why — including dead-code-deletion blocks which carry a 1-line "Phase 7.10 DS-01 pass 2: dead .demo-item infrastructure — verified zero consumers post-7.9 .hero-demo replacement" header comment in the diff context.
- **gh pr view --json state BEFORE any post-merge follow-up commit** (7.5 lesson): once PR opens, do not push additional commits without checking merge state first.

---

## 11. Next Step

Invoke **writing-plans** to decompose this spec into TDD tasks (co-located `2026-05-21-ds-01-pass2.md` plan + `.md.tasks.json` in `docs/superpowers/plans/`), then subagent-driven build on `phase7-10-ds01-pass2`, then PR handed to the user for merge/deploy.

**Target deliverable:** PR opened, suite 592 → 610 green, all 10 §8 guardrails verifiably PASS with file:line evidence per opus holistic review, dead-code deletion in Item D is the only intentional delta, every sacrosanct file byte-identical via `git diff`.
