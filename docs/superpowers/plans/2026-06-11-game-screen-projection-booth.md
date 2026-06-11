# Game Screen "Projection Booth" Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the in-game screen (`#game-screen`) into "The Projection Booth" — one committed cinematic concept — evolving (not replacing) the Constellation chain board, on MovieMatch's existing indigo brand.

**Architecture:** CSS-first redesign against a frozen DOM/ID contract. The bulk lands in `public/css/03-game.css` (+ tokens in `01-base.css`, motion in `06-states-anim.css`, responsive in `05-responsive.css`). Four small, additive, test-covered JS touches: "Up Next" bench state, a reaction-payload fix, a chat lobby drawer, and a cue-dot mirror of the existing timer state. No server changes.

**Tech Stack:** Vanilla ES modules, plain CSS (no framework), Socket.IO client, Jest (jsdom project for `client-tests/`, node project for `server/`), Google Fonts.

**Design source of truth:**
- Spec: `docs/superpowers/specs/2026-06-11-game-screen-projection-booth-design.md`
- Approved visual reference (working HTML/CSS to port from): `docs/superpowers/plans/2026-06-11-game-screen-projection-booth.reference.html`

**Standing constraints (all tasks):**
- NEVER edit/stage `server/ruleKits.test.js` or `server/my-stats-enrichment.test.js` (in-flight 6c.1 — they fail 4 tests by design; that baseline is expected).
- Every code change carries a WHY-comment.
- Stage explicit paths only — never `git add -A`.
- Branch is `game-screen-projection-booth` (already cut off `main`). Do not push/PR/deploy without the user (Render deploy is classifier-gated).
- The DOM/ID contract in spec §8 must survive. CSS load order across `public/css/*.css` is load-bearing — append, don't reorder.
- Coverage ratchet measures `public/js/` (floors 63/52/50/66) — JS touches must keep thresholds; that's what the new `client-tests/` specs are for.

---

## File Structure

| File | Responsibility | Change type |
|---|---|---|
| `public/index.html` | Add Saira Condensed to the existing fonts `<link>`; add cue-dot element, chat-drawer container + toggle, `data-reaction` attrs on reaction buttons | Modify (additive markup) |
| `public/css/01-base.css` | New tokens: `--font-display`, 5-step type scale, `--beam`/`--beam-glow`/`--cue-hot` aliases, booth grain/vignette helpers | Modify (append) |
| `public/css/03-game.css` | The booth: beam/gate/seam/billing, bench, splice console, cue dot, ticket-stub reactions, chat drawer, suggestions float | Modify (append/restyle) |
| `public/css/05-responsive.css` | Mobile stack, tab relabel, splice-seam horizontal fallback | Modify (append) |
| `public/css/06-states-anim.css` | Motion curves + booth animations + reduced-motion extensions | Modify (append) |
| `public/js/ui/ui-render.js` | `renderPlayerSidebar`: "Up Next" + box-office status labels; cue-dot class mirror | Modify |
| `public/js/app.js` | Reaction payload via `data-reaction`; chat-drawer toggle + unread wiring | Modify |
| `public/js/ui/ui-autocomplete.js` | Route desktop suggestions to the floating dropdown | Modify |
| `client-tests/booth-bench.test.js` | Tests for "Up Next"/status logic | Create |
| `client-tests/booth-reactions.test.js` | Tests reaction emits `data-reaction` payload | Create |
| `client-tests/booth-chat-drawer.test.js` | Tests drawer toggle + unread counter | Create |

Each task below is independently committable and leaves the screen in a coherent state.

---

### Task 0: Foundation — fonts, tokens, booth surfaces (CSS-only)

**Goal:** Land the design system (display font, type scale, semantic tokens) and reskin the screen's surfaces to booth-dark, with no structural/JS change. After this the screen looks darker/quieter and the frost is gone, but layout is unchanged.

**Files:**
- Modify: `public/index.html` (the Google Fonts `<link>` at ~L68)
- Modify: `public/css/01-base.css` (append tokens after `:root` block, ~L65)
- Modify: `public/css/03-game.css` (`.feed-container` ~L80, `.layout-grid`/`.sidebar` surfaces)

**Acceptance Criteria:**
- [ ] Saira Condensed loads (visible in Network tab; `--font-display` resolves).
- [ ] `--beam`, `--beam-glow`, `--cue-hot`, and the 5 `--t*` scale tokens exist and resolve.
- [ ] `.feed-container` no longer uses `backdrop-filter` (frost removed); surface is opaque graded charcoal.
- [ ] A film-grain + vignette overlay is present on the board, subtle (≤6% grain).
- [ ] `npm test` shows the same pass/fail baseline as before (only the 4 known 6c.1 failures).

**Verify:** `npm test -- --runInBand` → same baseline (4 known fails, no new fails). Visual: open the game screen, board is opaque + grained, no frost.

**Steps:**

- [ ] **Step 1: Add the display font.** In `public/index.html`, change the existing fonts link (currently `family=Plus+Jakarta+Sans:...&family=JetBrains+Mono:...`) to append Saira Condensed — one tag, no new `<link>`:

```html
<!-- Booth redesign: Saira Condensed is the condensed-grotesque billing-block
     voice (movie-title / one-sheet typography). Appended to the existing
     request so it stays a single font fetch. -->
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&family=Saira+Condensed:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Add tokens** to `public/css/01-base.css`, appended after the `:root{…}` block (do not edit existing tokens):

```css
/* === Booth redesign tokens (additive) ===
   WHY: the game-screen "Projection Booth" redesign needs a display face, a
   strict type scale (kills ~19 ad-hoc sizes), and SEMANTIC aliases so the
   accent reads as "projector light" not "indigo default". Aliases point at
   existing brand values — no new palette. */
:root{
  --font-display: 'Saira Condensed', 'Plus Jakarta Sans', sans-serif;
  /* 1.2 modular scale off 16px */
  --t-1: 12.8px; --t0: 16px; --t1: 19.2px; --t2: 23px; --t3: 33px; --t-display: 46px;
  /* projector light = the brand indigo, used surgically */
  --beam: var(--accent-primary);
  --beam-glow: rgba(129,140,248,.55);
  --cue-hot: var(--status-warning);   /* amber, only at <5s */
  /* booth surface edge for film-cell mattes */
  --booth-edge: #1f1f26;
}
```

- [ ] **Step 3: Reskin the board surface** in `public/css/03-game.css`. Replace the `.feed-container` frost (the `backdrop-filter`/`-webkit-backdrop-filter` lines and the translucent slate `background`) with opaque graded charcoal + grain/vignette. Port the grain/vignette overlay verbatim from the reference file's `.booth::before`/`.booth::after` rules (the SVG-turbulence data-URI grain at `opacity:.05; mix-blend-mode:overlay` + the radial vignette). Apply them to `.feed-container` (and add `position:relative` if needed for the overlay pseudo-elements). Keep `min-height`, `overflow-y`, `border-radius`, padding.

```css
/* WHY (booth): frosted glass fails the research "no glassmorphism" rule and
   hurts legibility on a timed screen. Opaque graded charcoal + a faint film
   grain and projector vignette give the board the booth's physicality. */
.feed-container{
  background: radial-gradient(120% 80% at 50% 16%, #15151f 0%, var(--bg-base) 56%, #060608 100%);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  /* grain + vignette overlays ported from the reference .booth pseudo-elements */
}
/* .feed-container::before { …grain… }  .feed-container::after { …vignette… } */
```

- [ ] **Step 4: Verify baseline.** Run: `npm test -- --runInBand` → Expected: same 4 known failures (6c.1), zero new failures. Open the app, confirm the board is opaque + grained, no frost, layout unchanged.

- [ ] **Step 5: Commit.**

```bash
git add public/index.html public/css/01-base.css public/css/03-game.css
git commit -m "Booth Task 0: design tokens, display font, opaque graded board surface"
```

---

### Task 1: The Beam — gate frame, sprocket strip, splice seam, billing block (CSS, evolve Constellation)

**Goal:** Transform the existing `.filmstrip`/`.reel`/`.reel-node`/`.reel-bridge`/`.now-cast` into film running through a projector gate: sprocket perfs, an enlarged sharp gate frame for the now-playing poster, the connecting actor typeset on the splice seam, and the cast as a one-sheet billing block.

**Files:**
- Modify: `public/css/03-game.css` (the Phase 7.7 Constellation block, ~L506–760)

**Acceptance Criteria:**
- [ ] `.reel` reads as a filmstrip (sprocket perfs top/bottom); keeps center-when-fits / scroll-when-overflows.
- [ ] `.reel-node.now-playing` is a large sharp gate frame with the indigo border + glow (reuse existing tokens) and a film-cell matte.
- [ ] `.reel-bridge` (connecting actor) is set as a splice-seam credit between posters, in `--font-display` caps.
- [ ] `.now-cast`/`.now-cast-list` render as a billing block: title in `--t-display` caps, cast as a credit stack, connecting actor as lead.
- [ ] Survives a 26-char title and a 9-name cast without breaking layout.
- [ ] Shipped `.reel-node.burned` / `.reel-node-ghost` / `.reel-bridge-broken` states still render (evolved, not removed).

**Verify:** `npm test -- --runInBand` → render-chain.test.js + ghost-attempt.test.js still pass. Visual: play to a 3+ movie chain; confirm gate/seam/billing against the reference file's "LIVE" moment.

**Steps:**

- [ ] **Step 1:** Port the beam styling from the reference file (`.strip`, `.perfwrap` perfs, `.cell`, `.gate`, `.seam`/`.splice`/`.tape`, `.billing`/`.title`/`.cast`) onto the live selectors, mapping:
  - reference `.gate img` → live `.reel-node.now-playing .reel-poster` (keep its existing `border:2px solid var(--accent-primary)` + glow; enlarge width, add the black matte + perf wrap).
  - reference `.cell img` → live `.reel-poster` (non-now-playing).
  - reference `.seam .splice` → live `.reel-bridge` (the connecting-actor text).
  - reference `.billing` → live `.now-cast`; `.title` → `.now-cast-title`; `.cast`/`.lead` → `.now-cast-list`/`.cast-name`.
  Each ported rule gets a WHY-comment naming the booth role.

- [ ] **Step 2:** Add the sprocket perfs as pseudo-elements on `.reel` (or a wrapper), using the reference `.perfwrap::before/::after` repeating-linear-gradient. Ensure they don't clip the existing clutch/burned effects (keep the existing `overflow-y: clip; overflow-clip-margin: 3rem`).

- [ ] **Step 3:** Evolve the failure vocabulary: keep `.reel-node.burned`, `.reel-node-ghost`, `.reel-bridge-broken` rules; add the booth "torn seam" treatment (red dashed tape on `.reel-bridge-broken`, per reference `.seam.torn`). Do not delete the existing rules.

- [ ] **Step 4: Verify.** Run: `npm test -- --runInBand` → render-chain + ghost-attempt suites green. Visual: a live chain matches the reference LIVE moment; a failed submit shows the torn-seam ghost.

- [ ] **Step 5: Commit.**

```bash
git add public/css/03-game.css
git commit -m "Booth Task 1: gate frame, sprocket strip, splice seam, billing block"
```

---

### Task 2: The Bench — operator frames, "Up Next" + box-office status (CSS + JS, TDD)

**Goal:** Restyle the player roster as a bench of film-frame operators with box-office status labels, and add an "Up Next" marker (the next alive player) computed in `renderPlayerSidebar`.

**Files:**
- Modify: `public/js/ui/ui-render.js` (`renderPlayerSidebar`, ~L613–685)
- Modify: `public/css/03-game.css` (`.sidebar`, `.sidebar-players`, `.sidebar-players li`, `.active-turn`, `.eliminated`)
- Create: `client-tests/booth-bench.test.js`

**Acceptance Criteria:**
- [ ] The active player row carries `active-turn` (label "On Screen"); the next ALIVE player after the active index carries a new `up-next` class (label "Up Next"); eliminated rows carry `eliminated` (label "Walked Out").
- [ ] "Up Next" skips eliminated players and wraps around the player array; with only one alive player, no row gets `up-next`.
- [ ] Classic/team/solo branches all still render; team headers preserved.
- [ ] Rows render as film-frame chips per the reference `.op`/`.frame` styling.

**Verify:** `npx jest client-tests/booth-bench.test.js` → PASS. `npm test -- --runInBand` → no new failures.

**Steps:**

- [ ] **Step 1: Write the failing test** at `client-tests/booth-bench.test.js`:

```js
/** @jest-environment jsdom */
// WHY: the booth bench adds an "Up Next" affordance. nextAliveIndex is pure
// logic (skip eliminated, wrap around) and must be unit-tested independently
// of the DOM render so the marker is provably correct in edge cases.
import { nextAliveIndex } from '../public/js/ui/ui-render.js';

describe('nextAliveIndex (booth bench "Up Next")', () => {
  const P = alive => ({ isAlive: alive });
  test('returns the next alive player after current', () => {
    const players = [P(true), P(true), P(true)];
    expect(nextAliveIndex(players, 0)).toBe(1);
  });
  test('skips eliminated players', () => {
    const players = [P(true), P(false), P(true)];
    expect(nextAliveIndex(players, 0)).toBe(2);
  });
  test('wraps around the array', () => {
    const players = [P(true), P(true)];
    expect(nextAliveIndex(players, 1)).toBe(0);
  });
  test('returns -1 when current is the only one alive', () => {
    const players = [P(false), P(true), P(false)];
    expect(nextAliveIndex(players, 1)).toBe(-1);
  });
  test('returns -1 for empty / single player', () => {
    expect(nextAliveIndex([], 0)).toBe(-1);
    expect(nextAliveIndex([P(true)], 0)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run, expect fail.** Run: `npx jest client-tests/booth-bench.test.js` → FAIL ("nextAliveIndex is not a function").

- [ ] **Step 3: Implement.** In `public/js/ui/ui-render.js`, add and export the pure helper, then use it in `renderPlayerSidebar` to add the `up-next` class on the classic branch:

```js
// WHY (booth bench): the "Up Next" marker needs the next ALIVE seat after the
// active one, skipping eliminated players and wrapping the array. Pure +
// exported so it's unit-tested (client-tests/booth-bench.test.js).
export function nextAliveIndex(players, currentIndex) {
  if (!Array.isArray(players) || players.length < 2) return -1;
  for (let step = 1; step < players.length; step++) {
    const i = (currentIndex + step) % players.length;
    if (players[i] && players[i].isAlive) return i;
  }
  return -1;
}
```

In the classic branch of `renderPlayerSidebar` (the `gameState.players.forEach((p, index) => …)` block), compute `const upNext = nextAliveIndex(gameState.players, gameState.currentTurnIndex);` before the loop, and inside add: `if (index === upNext) li.classList.add('up-next');`. (Leave team/solo branches as-is.)

- [ ] **Step 4: Run, expect pass.** Run: `npx jest client-tests/booth-bench.test.js` → PASS.

- [ ] **Step 5: Style the bench** in `public/css/03-game.css`: port `.bench`/`.op`/`.frame`/status-label styling from the reference onto `.sidebar`/`.sidebar-players li`/`.active-turn`(`On Screen`)/`.up-next`(`Up Next`)/`.eliminated`(`Walked Out`). Status labels are CSS `::after` content keyed on the class (so no extra markup), e.g. `.sidebar-players li.active-turn::after{content:'On Screen';…}`. WHY-comment each.

- [ ] **Step 6: Verify + commit.** Run: `npm test -- --runInBand` → no new fails.

```bash
git add public/js/ui/ui-render.js public/css/03-game.css client-tests/booth-bench.test.js
git commit -m "Booth Task 2: operator bench, Up Next marker (TDD), box-office status labels"
```

---

### Task 3: Splice Console + Cue Dot + suggestions float (CSS + JS, TDD)

**Goal:** Restyle `#input-area` as the splice console (Roll It key), express the timer as a cue dot at the cue edge driven by the existing severity signal, and float search suggestions over the console on desktop.

**Files:**
- Modify: `public/index.html` (add a cue-dot element inside `#input-area`'s header/right)
- Modify: `public/js/socketClient.js` (the `#timer-bar` handler ~L437–482 — mirror severity to the cue dot)
- Modify: `public/js/ui/ui-autocomplete.js` (route desktop suggestions to the floating dropdown)
- Modify: `public/css/03-game.css` (`.input-area`, `.input-row`, `#submit-btn`, cue dot, floating `.mobile-ac-dropdown` un-hidden on desktop, `#autocomplete-container`)

**Acceptance Criteria:**
- [ ] `#input-area` reads as the console; `#submit-btn` reads as a "Roll It" key (keeps its id + aria-label + SVG fallback).
- [ ] A cue-dot element reflects timer state: at rest a faint indigo ring; at `timer-critical`/`timer-panic` it goes amber (`--cue-hot`) and pulses. Driven by the SAME class signal `socketClient` already sets on `#timer-bar` — `#timer-bar` and `#time-text` remain intact (no removal of the numeric, screen-reader-safe cue).
- [ ] Typing shows suggestions in a floating dropdown anchored over the console on desktop (reusing the existing `#mobile-ac-dropdown` mechanism); the retired right-rail panel is no longer required.
- [ ] Out-of-turn disabled behavior preserved (`.input-area.disabled-area .input-row` still dims/locks).

**Verify:** `npx jest client-tests/submission-pill.test.js client-tests/socket-handlers.test.js` → PASS (no regression). `npm test -- --runInBand` → no new fails. Visual: timer ≤5s → amber pulsing dot; typing → floating suggestions.

**Steps:**

- [ ] **Step 1: Add the cue-dot element** in `public/index.html` inside `.input-header-right` (sibling to `#time-text`), additive:

```html
<!-- Booth cue dot: the reel-change "cigarette burn". Mirrors the timer
     severity socketClient already computes; #time-text stays as the numeric,
     screen-reader-safe cue (color is not the only signal). -->
<span id="cue-dot" class="cue-dot" aria-hidden="true"></span>
```

- [ ] **Step 2: Mirror severity in the existing timer handler.** In `public/js/socketClient.js`, where it already toggles `timerBar.classList.add('timer-critical')` / `timer-panic` / removes them (~L461–482), add alongside (same blocks) cue-dot class toggles so a single source drives both:

```js
// WHY (booth): the cue dot is the visible countdown; reuse the timer's
// existing severity branches so there is ONE source of truth (no second timer).
const cueDot = document.getElementById('cue-dot');
if (cueDot) {
  cueDot.classList.toggle('cue-hot', timerSeverity(tr) === 'panic' || /* critical */ percentage <= 20);
}
```

(Place the `cueDot` toggle inside the existing `if (timerBar) {…}` block, mirroring the exact thresholds already used for `timer-critical`/`timer-panic` so behavior is identical to the bar.)

- [ ] **Step 3: Style** in `public/css/03-game.css`: `.cue-dot` (faint indigo ring) and `.cue-dot.cue-hot` (amber fill + `@keyframes burn` pulse — port from reference `.cuedot`/`.cue.hot`). Restyle `.input-area` → console, `#submit-btn` → Roll It key (port reference `.roll`; keep the existing icon SVG, add a text label span). WHY-comment each.

- [ ] **Step 4: Float suggestions on desktop.** In `public/js/ui/ui-autocomplete.js`, the renderers already populate `mobileAcDropdown`; remove the mobile-only gating so the floating dropdown is the primary suggestions surface, and in CSS position `.mobile-ac-dropdown` absolutely over the console (un-hide the `display:none` from `03-game.css:239` at desktop widths). Keep `#autocomplete-container` rendering as a harmless fallback (no layout cost once the right rail is gone). WHY-comment the gating change.

- [ ] **Step 5: Verify + commit.** Run: `npx jest client-tests/submission-pill.test.js client-tests/socket-handlers.test.js` then `npm test -- --runInBand`.

```bash
git add public/index.html public/js/socketClient.js public/js/ui/ui-autocomplete.js public/css/03-game.css
git commit -m "Booth Task 3: splice console, cue-dot timer mirror, floating suggestions"
```

---

### Task 4: Lobby drawer (chat) + ticket-stub reactions (CSS + JS, TDD)

**Goal:** Move chat into a collapsible "lobby" drawer toggled from the bench with an unread badge, and replace the emoji reaction quartet with booth-native ticket stubs (fixing the `innerText` payload coupling).

**Files:**
- Modify: `public/index.html` (wrap chat in a drawer + toggle button; add `data-reaction` to `.reaction-btn`s)
- Modify: `public/js/app.js` (reaction emit via `data-reaction` ~L683–688; drawer toggle + unread wiring ~L856)
- Modify: `public/css/03-game.css` (`.right-panel`→drawer, `.reaction-btn`→stub)
- Create: `client-tests/booth-reactions.test.js`, `client-tests/booth-chat-drawer.test.js`

**Acceptance Criteria:**
- [ ] Clicking a reaction emits `sendReaction` with the button's `data-reaction` value (decoupled from visible text), so relabeling buttons to stubs doesn't change the wire payload contract.
- [ ] Chat lives in a drawer: a bench toggle opens/closes it; when closed, incoming messages increment an unread badge; opening clears it. `#chat-messages`/`#chat-input`/`#chat-send-btn` preserved.
- [ ] Reaction buttons render as die-cut ticket stubs (perforation motif), keeping their aria-labels.

**Verify:** `npx jest client-tests/booth-reactions.test.js client-tests/booth-chat-drawer.test.js` → PASS. `npm test -- --runInBand` → no new fails.

**Steps:**

- [ ] **Step 1: Failing tests.**

`client-tests/booth-reactions.test.js`:
```js
/** @jest-environment jsdom */
// WHY: ticket-stub labels change visible text, so the reaction payload must be
// decoupled from innerText. This pins the wire contract: emit data-reaction.
import { reactionPayload } from '../public/js/app.js';
test('reaction payload comes from data-reaction, not text', () => {
  const btn = document.createElement('button');
  btn.dataset.reaction = '🔥';
  btn.textContent = 'Bravo';
  expect(reactionPayload(btn)).toBe('🔥');
});
test('falls back to textContent when data-reaction absent', () => {
  const btn = document.createElement('button');
  btn.textContent = '👀';
  expect(reactionPayload(btn)).toBe('👀');
});
```

`client-tests/booth-chat-drawer.test.js`:
```js
/** @jest-environment jsdom */
// WHY: the drawer's unread counter is pure state logic — increments only while
// closed, resets on open. Unit-tested so the badge can't drift.
import { ChatDrawerState } from '../public/js/app.js';
test('unread increments only while closed', () => {
  const s = new ChatDrawerState();           // starts closed
  s.onMessage(); s.onMessage();
  expect(s.unread).toBe(2);
  s.open();
  expect(s.unread).toBe(0);
  s.onMessage();                              // open → no unread
  expect(s.unread).toBe(0);
  s.close(); s.onMessage();
  expect(s.unread).toBe(1);
});
```

- [ ] **Step 2: Run, expect fail.** `npx jest client-tests/booth-reactions.test.js client-tests/booth-chat-drawer.test.js` → FAIL (exports missing).

- [ ] **Step 3: Implement** in `public/js/app.js`:

```js
// WHY (booth reactions): decouple the wire payload from the button's visible
// label so ticket-stub text ("Bravo") can replace the emoji glyph without
// changing what peers receive. Exported for unit test.
export function reactionPayload(btn) {
  return (btn && btn.dataset && btn.dataset.reaction) || (btn && btn.textContent) || '';
}

// WHY (booth lobby drawer): unread count is closed-only state; reset on open.
// A tiny class keeps the rule testable and the DOM wiring thin.
export class ChatDrawerState {
  constructor() { this.isOpen = false; this.unread = 0; }
  open()  { this.isOpen = true;  this.unread = 0; }
  close() { this.isOpen = false; }
  onMessage() { if (!this.isOpen) this.unread += 1; }
}
```

Then change the reaction click (`~L688`) from `emoji: btn.innerText` to `emoji: reactionPayload(btn)`, and wire a `ChatDrawerState` instance to the new drawer toggle button + the chat-message handler (increment via `onMessage()`, render `unread` into the badge, clear on `open()`).

- [ ] **Step 4: Run, expect pass.** `npx jest client-tests/booth-reactions.test.js client-tests/booth-chat-drawer.test.js` → PASS.

- [ ] **Step 5: Markup + CSS.** In `index.html`: add `data-reaction="🔥"` etc. to each `.reaction-btn`; wrap the chat half (`#chat-messages`+input) in a `.lobby-drawer` with a bench toggle button (`#lobby-toggle`, reuse `#chat-badge` for unread). In `03-game.css`: style the drawer (off-canvas + open state) and port the reference `.stub` ticket styling onto `.reaction-btn`. WHY-comment each.

- [ ] **Step 6: Verify + commit.** `npm test -- --runInBand`.

```bash
git add public/index.html public/js/app.js public/css/03-game.css client-tests/booth-reactions.test.js client-tests/booth-chat-drawer.test.js
git commit -m "Booth Task 4: chat lobby drawer + unread (TDD), ticket-stub reactions (TDD)"
```

---

### Task 5: Motion system + reduced-motion (CSS)

**Goal:** Add the named-curve motion system and the booth's choreographed beats (accepted splice, turn handoff, failed-splice recoil, cue-dot burn, match win), with a first-class reduced-motion path.

**Files:**
- Modify: `public/css/06-states-anim.css` (append curves, keyframes, and extend the existing global reduced-motion block)
- Modify: `public/css/03-game.css` (only to add transition hooks referencing the new curves where needed)

**Acceptance Criteria:**
- [ ] Curves defined once as tokens: `--ease-gate: cubic-bezier(0.16,1,0.3,1)` (reuse the codebase's existing curve), `--ease-snap`, `--ease-in`; durations 120/200/320ms used consistently.
- [ ] Accepted splice: new node advances in (~220ms `--ease-gate`) + seam fades up (110ms) + soft indigo flare on the gate (~180ms). Reuses the existing `choreographTurn`/clutch hooks.
- [ ] Turn handoff: the active-turn glow travels along the bench rather than cross-fading in place.
- [ ] Failed splice: strip recoil (3-oscillation, 300–360ms `--ease-in`) + torn-seam stamp; no positive screen-shake.
- [ ] Cue-dot burn pulse accelerates as time empties (ties to `.cue-hot`).
- [ ] `prefers-reduced-motion`: every translate/scale/recoil swapped for opacity cross-fades that preserve the info + cue color (extends the existing reduced-motion block at ~`06-states-anim.css:1020`, not a new bypass).

**Verify:** `npx jest client-tests/turn-motion.test.js client-tests/timer-panic.test.js` → PASS. `npm test -- --runInBand` → no new fails. Visual: accept/fail/handoff beats; then toggle OS reduced-motion and confirm info is preserved with no transforms.

**Steps:**

- [ ] **Step 1:** Append the curve tokens + keyframes (`@keyframes burn`, splice-advance, seam-fade, gate-flare, bench-travel, strip-recoil) to `06-states-anim.css`, porting timings from spec §7 and the reference `@keyframes burn`. WHY-comment each beat with its frequency-ladder rationale.

- [ ] **Step 2:** Hook the beats to live classes/events: the `.reel-node` enter animation (accepted splice), `.active-turn` transition (handoff), `.reel-node-ghost`/`.reel-bridge-broken` (failed recoil — extend, don't replace the shipped ghost animation), `.cue-dot.cue-hot` (burn).

- [ ] **Step 3:** Extend the existing global reduced-motion block: for each new animation, add the reduced-motion fallback (opacity/instant) in the SAME block, preserving information + the amber cue color. Do not duplicate or bypass it.

- [ ] **Step 4: Verify + commit.** Run the motion suites + full suite.

```bash
git add public/css/06-states-anim.css public/css/03-game.css
git commit -m "Booth Task 5: motion curves, choreographed beats, reduced-motion path"
```

---

### Task 6: Responsive/mobile + 10-case validation pass (CSS + final QA)

**Goal:** Make the booth stack cleanly on mobile, relabel the tab bar, give the splice seam a horizontal fallback, and validate against the full hostile-content matrix.

**Files:**
- Modify: `public/css/05-responsive.css` (append booth mobile rules)
- Modify: `public/index.html` (tab labels only — keep `data-tab` values)

**Acceptance Criteria:**
- [ ] Mobile: beam on top; bench + chat reachable via the existing `.mobile-tabs` (labels e.g. Gate / Booth / Lobby; `data-tab` values unchanged so JS still works).
- [ ] Splice seam falls back to a horizontal credit at ≤767px (legible, no overflow).
- [ ] All 10 spec §12 cases pass: 5-player bench · 26-char title · 9-name cast wrap · empty gate · broken splice · team mode · solo mode · mobile stack · reduced-motion · spectator view.

**Verify:** `npm test -- --runInBand --coverage` → no new fails AND `public/js/` coverage ≥ floors (63/52/50/66). Manual: walk the 10-case matrix on desktop + a ~380px viewport.

**Steps:**

- [ ] **Step 1:** Append mobile rules to `05-responsive.css` (booth stack, seam horizontal fallback) reusing the existing 767px breakpoint. WHY-comment.

- [ ] **Step 2:** Relabel `.mobile-tabs` button text in `index.html` (keep each `data-tab` attribute value). WHY-comment.

- [ ] **Step 3: Validate the matrix.** Manually drive each of the 10 cases; capture any breakage as a fix in the relevant file before committing. Confirm coverage gate.

- [ ] **Step 4: Commit.**

```bash
git add public/css/05-responsive.css public/index.html
git commit -m "Booth Task 6: responsive booth stack, tab relabel, 10-case validation"
```

---

## Self-Review

**Spec coverage:** §4 layout → T0/T6; §5 tokens/type/color → T0; §6.1 beam → T1; §6.2 bench → T2; §6.3 console → T3; §6.4 cue dot → T3; §6.5 reactions → T4; §6.6 chat drawer → T4; §6.7 header → light, folded into T0 surface pass (no structural change needed — noted); §6.8 failure states → T1/T5; §7 motion → T5; §8 DOM contract → enforced per-task; §9 mobile → T6; §10 a11y → T2 labels / T3 numeric cue / T5 reduced-motion; §12 validation → T6. **Gap check:** §6.7 header has no dedicated task — intentional (light CSS touch within T0); flagged here so it isn't lost. No other gaps.

**Placeholder scan:** No "TBD"/"handle edge cases"/"write tests for the above" — every JS task ships real test + impl code; CSS tasks point at the committed reference file with explicit selector maps + acceptance criteria.

**Type/name consistency:** `nextAliveIndex(players, currentIndex)`, `reactionPayload(btn)`, `ChatDrawerState{open/close/onMessage/unread/isOpen}`, `#cue-dot`/`.cue-hot`, `--beam`/`--beam-glow`/`--cue-hot`, `--t-1…--t-display`, `--ease-gate/--ease-snap/--ease-in` — used consistently across tasks.

---

## Notes for the executor
- Land tasks in order (0→6); each is its own commit and leaves a coherent screen.
- The reference HTML is the visual ground truth for CSS fidelity; the spec is the design law for rationale and constraints.
- After all tasks: full `npm test -- --coverage --runInBand` green (minus the 4 known 6c.1 fails), then hand the branch to the user for PR/deploy (classifier-gated).
