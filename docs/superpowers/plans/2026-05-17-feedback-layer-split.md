# Phase 7.2 Feedback-layer Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a client-side feedback router (`toast` + `gameEvent`) over the existing notification primitives, plus a CG-03 submission pill, so non-dramatic feedback stops borrowing the cinematic overlay (MI-01) and the player's submitted title stays visible during validation.

**Architecture:** A new thin module `public/js/ui/feedback.js` imports the existing primitives from `ui-notifications.js` (one-way dependency; primitives unchanged in behaviour) and exposes `toast(message,{variant})`, `gameEvent(kind,{msg,selfElimActive})`, and a `submissionPill` state machine. The `ui.js` barrel re-exports it. `socketClient.js` and `app.js` route their existing feedback calls through it. The **only** intended behaviour change: room-wide `kind:'info'` notifications render as a toast instead of the 3 s centre overlay. No server change, no new socket event, no `innerHTML`.

**Tech Stack:** Vanilla ES modules (no build), Socket.io client, Jest + jsdom (`client-tests/`), CSS partials (cascade order load-bearing).

---

## Grounded facts (verified against the worktree @ `582dd3d`)

- `showToast(msg)` — `public/js/ui/ui-notifications.js:307-314`. Reuses an existing `.copy-toast` element, `textContent`, `.visible` for 2500 ms. Existing callers pass a plain string only: `socketClient.js:320,326` (solo streak/objective), `:622,625,629` (predictionResult), `:663` (submissionRejected).
- `showNotification(msg)` — `ui-notifications.js:11-23` (centre `#notification-overlay`, 3000 ms + 300 ms exit). Uses live `notificationOverlay`/`notificationText` bindings from `ui-dom.js`, set by `initUIElements()`.
- The `notification` dispatcher — `socketClient.js:492-537`. Normalises `payload` → `{msg, kind}`, backward-compat infers kind from text, calls `if (!selfElimActive) showNotification(msg)` for **all** kinds, then branches: `elimination` → `playFail(); vibrate([200,100,200]); showEliminationFlash(); (!selfElimActive) overlay.add('notification--elimination'); .board shake`; `win` → remove `.elimination-flash`; `playSfx('win'); vibrate([60,80,60,80,60]); showWinFlash(); showConfetti()`; `info`/unknown → text overlay only.
- `selfElimActive` — closure `let` in `initSocket()` at `socketClient.js:40`; set true for 3200 ms on the alive→dead transition (`:272`). Not exported — must be passed into `gameEvent`.
- `submissionRejected` handler — `socketClient.js:653-698`: `showToast((message||"Couldn't find that title.")+tail)`, re-enables `#movie-input`/`#submit-btn`, restores `originalInput`, sets `#hint-text`, `vibrate(40)`.
- `predictionResult` handler — `socketClient.js:617-631`: `showToast` with success/fail/summary text.
- `stateUpdate` handler — `socketClient.js:258-486`. Fires on every state broadcast (chat, reactions, joins, turns). `youWereEliminated` is buffered (`:558-560`) and consumed here on alive→dead.
- `autocompleteResults` — `socketClient.js:704`: `socket.on('autocompleteResults', renderAutocompleteResults)`.
- `submitMovie()` — `app.js:548-563`: trims `movieInput.value`, emits `submitMovie`, clears+disables input, sets `#hint-text` to `'Validating connection...'`. The input handler `app.js:584-600` debounces `autocompleteSearch` (400 ms) when `query.length >= 2`; resets the container when `< 2`.
- `ui.js` barrel — re-exports `./ui/ui-notifications.js` etc. (line 8). Does **not** yet export a `feedback.js`.
- `socketClient.js` imports UI symbols via the destructured `import { … } from './ui.js'` block at `:11-22`. `app.js` likewise imports UI symbols from `./ui.js` (verify the exact block while editing — add `submissionPill` there).
- Test harness: `client-tests/fixtures.js` `loadIndexHtml()` writes the **real** `public/index.html` markup into jsdom (scripts stripped). Pure-UI tests: `loadIndexHtml()` + import from `../public/js/ui.js` + `afterEach(() => { document.body.innerHTML=''; })` (see `client-tests/self-elim-aftercare.test.js`). Socket tests: `jest.mock('../public/js/state.js', …)`, fake socket with a handlers `Map` + `.trigger()`, `window.io = jest.fn(() => fakeSocket)`, `beforeEach`: `loadIndexHtml(); initUIElements(); fakeSocket=createFakeSocket(); initSocket(); state.__setSocket(fakeSocket);` (see `client-tests/socket-handlers.test.js`).
- **No existing test asserts the `notification` dispatcher, `submissionRejected` toast, or `predictionResult` toast.** Migration of old assertions is therefore **N/A**; the full `client-tests/` run is the regression gate.
- Base `.copy-toast` CSS is in `04-modals.css:467-490` (**must NOT be edited**). `06-states-anim.css:1010` is a mobile media-query override only. New CSS goes only into `06-states-anim.css` (it loads last — `index.html:73` — so additive variant/pill rules cascade correctly).
- `.peer-typing` / `.peer-typing.visible` — `06-states-anim.css:452-468` — the pattern to mirror for `.submission-pill`.
- **7.3-deferred, DO NOT TOUCH:** the malformed `\*` comment at `06-states-anim.css:1082`, the orphaned `.self-elim-could` rule at `:1085`, and the unstyled `.self-elim-outs*`/`.self-elim-bridge` classes.

## Scope guards (binding)

- **No server change, no new socket event, no `innerHTML`.** Client-only.
- The **only** behaviour delta: `kind:'info'` → toast (not centre overlay). Elimination/win/self-elim/confetti/ghost-card byte-for-byte preserved.
- **Do NOT migrate** `socket.on('error', …)` (`socketClient.js:101`) — outside the spec's bounded list; scope discipline.
- **Do NOT** reroute the solo-streak `showToast` calls (`socketClient.js:320,326`) — already toast-shaped, not mis-routed; minimal diff. `showToast` stays exported and functional.
- `feedback.js` imports only from `./ui-notifications.js` (one-way; no cycle). Never import `socketClient.js`/`app.js` into it.
- Every code change ships a WHY comment. Out-of-scope findings → `spawn_task` chip, never widen scope.
- Branch safety: a parallel Codex agent shares this repo — every commit step verifies `git branch --show-current` is `phase7-2-feedback-layer-split` first.

---

### Task 0: `feedback.js` router — `toast` + `gameEvent`; generalise `showToast`

**Goal:** Create the feedback router exposing `toast` (variant-aware) and `gameEvent` (behaviour-preserving wrapper of the dramatic primitives), generalise `showToast` to accept a `variant`, and re-export the module from the `ui.js` barrel. No call-site wiring yet (no app behaviour change).

**Files:**
- Modify: `public/js/ui/ui-notifications.js:307-314` (`showToast`)
- Create: `public/js/ui/feedback.js`
- Modify: `public/js/ui.js:8` (barrel — add the re-export)
- Test: `client-tests/feedback-router.test.js`

**Acceptance Criteria:**
- [ ] `showToast(msg)` (no opts) behaves exactly as before plus adds class `copy-toast--info`; `showToast(msg,{variant:'error'})` adds `copy-toast--error`; variant class never leaks across reused-element calls.
- [ ] `feedback.toast` delegates to `showToast`; `feedback.gameEvent('elimination',{msg,selfElimActive:false})` shows the centre overlay (text=msg, class `notification--elimination`) **and** an `.elimination-flash`; with `selfElimActive:true` the overlay is suppressed but `.elimination-flash` still appears.
- [ ] `gameEvent('win',{msg,selfElimActive:false})` removes any existing `.elimination-flash`, shows `.win-flash`.
- [ ] `import { toast, gameEvent } from '../public/js/ui.js'` resolves (barrel re-export works).
- [ ] Full `client-tests/` suite green (generalised `showToast` broke no existing caller/test).

**Verify:** `npx jest client-tests/feedback-router.test.js client-tests/` → all green.

**Steps:**

- [ ] **Step 1: Write the failing test** — `client-tests/feedback-router.test.js`

```js
/**
 * @jest-environment jsdom
 */
const { loadIndexHtml } = require('./fixtures');
// initUIElements binds the live notificationOverlay/notificationText refs that
// showNotification (called inside gameEvent) depends on. Pure-UI harness — no socket.
import { initUIElements } from '../public/js/ui.js';
import { toast, gameEvent } from '../public/js/ui.js';
import { showToast } from '../public/js/ui.js';

describe('feedback router — toast + gameEvent', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); });
  afterEach(() => { document.body.innerHTML = ''; });

  test('showToast default adds copy-toast--info, stays behaviour-compatible', () => {
    showToast('hello');
    const t = document.querySelector('.copy-toast');
    expect(t).not.toBeNull();
    expect(t.textContent).toBe('hello');
    expect(t.classList.contains('copy-toast')).toBe(true);
    expect(t.classList.contains('copy-toast--info')).toBe(true);
    expect(t.classList.contains('visible')).toBe(true);
  });

  test('toast(error) reuses the element and swaps the variant class (no leak)', () => {
    toast('first', { variant: 'error' });
    let t = document.querySelector('.copy-toast');
    expect(t.classList.contains('copy-toast--error')).toBe(true);
    toast('second', { variant: 'success' });
    t = document.querySelector('.copy-toast');
    expect(t.textContent).toBe('second');
    expect(t.classList.contains('copy-toast--success')).toBe(true);
    expect(t.classList.contains('copy-toast--error')).toBe(false); // no stale variant
  });

  test('gameEvent(elimination) shows overlay + flash when not self-eliminated', () => {
    gameEvent('elimination', { msg: 'Alice was eliminated', selfElimActive: false });
    const overlay = document.getElementById('notification-overlay');
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(overlay.classList.contains('notification--elimination')).toBe(true);
    expect(document.getElementById('notification-text').innerText).toBe('Alice was eliminated');
    expect(document.querySelector('.elimination-flash')).not.toBeNull();
  });

  test('gameEvent(elimination) suppresses overlay but still flashes when selfElimActive', () => {
    const overlay = document.getElementById('notification-overlay');
    overlay.classList.add('hidden');
    gameEvent('elimination', { msg: 'You were eliminated', selfElimActive: true });
    expect(overlay.classList.contains('hidden')).toBe(true);
    expect(overlay.classList.contains('notification--elimination')).toBe(false);
    expect(document.querySelector('.elimination-flash')).not.toBeNull(); // flash NOT gated
  });

  test('gameEvent(win) clears prior elimination flash and shows win flash', () => {
    const stale = document.createElement('div');
    stale.className = 'elimination-flash';
    document.body.appendChild(stale);
    gameEvent('win', { msg: 'Bob wins!', selfElimActive: false });
    expect(document.querySelector('.elimination-flash')).toBeNull();
    expect(document.querySelector('.win-flash')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest client-tests/feedback-router.test.js`
Expected: FAIL — `toast`/`gameEvent` not exported (cannot find / undefined), `copy-toast--info` assertion fails.

- [ ] **Step 3: Generalise `showToast`** — `public/js/ui/ui-notifications.js`, replace lines 307-314:

```js
// Phase 7.2 (MI-01): showToast gains an optional variant so the feedback
// router can colour validation errors / successes differently from neutral
// info, WITHOUT changing the call shape for existing string-only callers
// (default 'info' = today's neutral look). `toast.className = 'copy-toast'`
// already wipes any prior variant/visible class on the reused element, so
// re-adding the variant below can never leak across consecutive toasts.
export function showToast(msg, { variant = 'info' } = {}) {
  const toast = document.querySelector('.copy-toast') || document.createElement('div');
  toast.className = 'copy-toast';
  toast.classList.add('copy-toast--' + variant);
  toast.textContent = msg;
  if (!toast.parentElement) document.body.appendChild(toast);
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}
```

- [ ] **Step 4: Create the router** — `public/js/ui/feedback.js`:

```js
// ui/feedback.js — Phase 7.2 feedback-layer split.
// WHY: a thin POLICY layer over the existing ui-notifications primitives so
// non-dramatic feedback stops borrowing the cinematic centre overlay (MI-01)
// and later phases have a stable calm-feedback API. One-way dependency
// (feedback -> ui-notifications); never import socketClient/app here.
import {
  showNotification, showEliminationFlash, showWinFlash, showConfetti, showToast,
} from './ui-notifications.js';

// Transient, non-blocking channel. Delegates to the (now variant-aware)
// showToast primitive so there is exactly one toast implementation.
export function toast(message, opts) {
  return showToast(message, opts);
}

// Dramatic channel. Replicates EXACTLY the visual branching socketClient's
// notification handler did (showNotification gated by selfElimActive, the
// elimination overlay class + board shake, the win flash/confetti), so
// routing eliminations/wins through here is behaviour-preserving. Audio/
// haptics (playFail/playSfx/vibrate) stay in the socket handler — they are
// network-layer side effects, not UI-feedback DOM, and keeping them out of
// this module avoids pulling utils.js audio deps into the UI layer.
export function gameEvent(kind, { msg = '', selfElimActive = false } = {}) {
  if (!selfElimActive) showNotification(msg);

  if (kind === 'elimination') {
    showEliminationFlash();
    if (!selfElimActive) {
      const overlay = document.getElementById('notification-overlay');
      if (overlay) overlay.classList.add('notification--elimination');
    }
    const board = document.querySelector('.board');
    if (board) {
      board.classList.add('shake');
      setTimeout(() => board.classList.remove('shake'), 750);
    }
  } else if (kind === 'win') {
    // Win supersedes any in-flight elimination flash from the same losing turn.
    document.querySelectorAll('.elimination-flash').forEach((el) => el.remove());
    showWinFlash();
    showConfetti();
  }
  // kind 'info'/unknown: showNotification above already handled the text.
  // (In 7.2 the socket handler routes 'info' to toast() instead and never
  // calls gameEvent for it — this branch stays for any direct caller.)
}
```

- [ ] **Step 5: Re-export from the barrel** — `public/js/ui.js`, add after line 8 (`export * from './ui/ui-notifications.js';`):

```js
export * from './ui/feedback.js';   // Phase 7.2: feedback router (toast/gameEvent/submissionPill)
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest client-tests/feedback-router.test.js`
Expected: PASS (5/5).

- [ ] **Step 7: Run the full client suite (regression gate for generalised showToast)**

Run: `npx jest client-tests/`
Expected: PASS — all suites green (no existing caller/test asserted an exact `className === 'copy-toast'` string).

- [ ] **Step 8: Verify branch, then commit**

```bash
git -C C:/mm-phase7-2 branch --show-current   # must print: phase7-2-feedback-layer-split
git -C C:/mm-phase7-2 add public/js/ui/feedback.js public/js/ui/ui-notifications.js public/js/ui.js client-tests/feedback-router.test.js
git -C C:/mm-phase7-2 commit -m "Phase 7.2 (0): feedback router — toast + gameEvent; variant-aware showToast"
```

---

### Task 1: CG-03 submission pill — `submissionPill` API + `#submission-pill` element + CSS

**Goal:** Add a `submissionPill` state machine to `feedback.js`, a static `#submission-pill` element in the input-area, and minimal real CSS, so the player's submitted title can stay visible during validation. No socket/app wiring yet.

**Files:**
- Modify: `public/js/ui/feedback.js` (append the `submissionPill` API)
- Modify: `public/index.html` (add `#submission-pill` after `#hint-text`, line 400)
- Modify: `public/css/06-states-anim.css` (append pill + toast-variant rules at end of file)
- Test: `client-tests/submission-pill.test.js`

**Acceptance Criteria:**
- [ ] `submissionPill.checking('Heat')` → `#submission-pill` is `.visible`, `textContent === 'Checking: "Heat"'`.
- [ ] `submissionPill.searching()` does **not** overwrite a pill currently in `checking` mode.
- [ ] `submissionPill.clear()` hides + empties; `submissionPill.clear('searching')` is a no-op while in `checking` mode.
- [ ] A crafted title is rendered as text (no `img` element created — no `innerHTML`).
- [ ] CSS: base `.copy-toast` in `04-modals.css` is unedited; new rules live only in `06-states-anim.css`; the 7.3-deferred lines (`:1082`, `:1085`, `.self-elim-outs*`) are untouched.

**Verify:** `npx jest client-tests/submission-pill.test.js client-tests/` → all green.

**Steps:**

- [ ] **Step 1: Write the failing test** — `client-tests/submission-pill.test.js`

```js
/**
 * @jest-environment jsdom
 */
const { loadIndexHtml } = require('./fixtures');
import { submissionPill } from '../public/js/ui.js';

describe('submissionPill — CG-03 state machine', () => {
  beforeEach(() => { loadIndexHtml(); });
  // Module-level _pillMode persists across tests in this file — reset it.
  afterEach(() => { submissionPill.clear(); document.body.innerHTML = ''; });

  test('checking shows the submitted title', () => {
    submissionPill.checking('Heat');
    const el = document.getElementById('submission-pill');
    expect(el.classList.contains('visible')).toBe(true);
    expect(el.textContent).toBe('Checking: "Heat"');
  });

  test('searching does not stomp a checking pill', () => {
    submissionPill.checking('Heat');
    submissionPill.searching();
    expect(document.getElementById('submission-pill').textContent).toBe('Checking: "Heat"');
  });

  test('searching shows the searching state when not checking', () => {
    submissionPill.searching();
    const el = document.getElementById('submission-pill');
    expect(el.textContent).toBe('Searching…');
    expect(el.classList.contains('visible')).toBe(true);
  });

  test('clear() empties and hides', () => {
    submissionPill.checking('Heat');
    submissionPill.clear();
    const el = document.getElementById('submission-pill');
    expect(el.classList.contains('visible')).toBe(false);
    expect(el.textContent).toBe('');
  });

  test("clear('searching') is a no-op while checking", () => {
    submissionPill.checking('Heat');
    submissionPill.clear('searching');
    expect(document.getElementById('submission-pill').textContent).toBe('Checking: "Heat"');
  });

  test('XSS: crafted title rendered as text', () => {
    submissionPill.checking('<img src=x onerror=alert(1)>');
    const el = document.getElementById('submission-pill');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest client-tests/submission-pill.test.js`
Expected: FAIL — `submissionPill` undefined; `#submission-pill` element absent.

- [ ] **Step 3: Append the `submissionPill` API** — end of `public/js/ui/feedback.js`:

```js
// CG-03 submission pill. WHY: today submitMovie() clears + disables the input
// and shows a static "Validating connection..." hint, so the player's typed
// title vanishes for the whole TMDB round-trip. This keeps the intent visible.
// A small explicit mode guard prevents a debounced "Searching…" from stomping
// a "Checking:" pill the player just produced by pressing Enter, and lets a
// late autocomplete response clear ONLY the searching state. textContent only
// (titles are user/TMDB input) — preserves the file's no-innerHTML posture.
let _pillMode = null; // null | 'checking' | 'searching'
function _pillEl() { return document.getElementById('submission-pill'); }

export const submissionPill = {
  checking(title) {
    const el = _pillEl();
    if (!el) return;
    _pillMode = 'checking';
    el.textContent = `Checking: "${title}"`;
    el.classList.add('visible');
  },
  searching() {
    const el = _pillEl();
    if (!el) return;
    if (_pillMode === 'checking') return; // never override a submitted-title pill
    _pillMode = 'searching';
    el.textContent = 'Searching…';
    el.classList.add('visible');
  },
  clear(onlyMode) {
    const el = _pillEl();
    if (!el) return;
    if (onlyMode && _pillMode !== onlyMode) return; // scoped clear (e.g. stale ac result)
    _pillMode = null;
    el.textContent = '';
    el.classList.remove('visible');
  },
};
```

- [ ] **Step 4: Add the pill element** — `public/index.html`, immediately after line 400 (`<p id="hint-text" class="hint-text">Waiting...</p>`):

```html
            <!-- Phase 7.2 (CG-03): submission pill. Mirrors #peer-typing-indicator
                 (hidden until .visible, aria-live polite). socketClient/app.js
                 toggle it so the submitted title stays visible during TMDB
                 validation instead of the input going blank. -->
            <p id="submission-pill" class="submission-pill" role="status" aria-live="polite"></p>
```

- [ ] **Step 5: Append the CSS** — end of `public/css/06-states-anim.css` (append only; do NOT edit `04-modals.css`; do NOT touch lines 1082/1085):

```css

/* =============================================
   Phase 7.2 (CG-03) SUBMISSION PILL
   Mirrors .peer-typing (06-states-anim.css:452) — deliberately subtle so it
   sits quietly under the input without competing with the timer/chain.
   ============================================= */
.submission-pill {
  display: none;
  font-size: 0.78rem;
  color: var(--text-muted);
  font-style: italic;
  margin: 0.25rem 0 0;
  opacity: 0;
  transition: opacity 180ms ease-in;
}
.submission-pill.visible {
  display: block;
  opacity: 1;
}

/* =============================================
   Phase 7.2 (MI-01) TOAST VARIANTS
   Additive ONLY. Base .copy-toast lives in 04-modals.css:467 and is
   unchanged; 06-states-anim.css loads after it (index.html:73) so these
   accents cascade correctly. 'info' has no rule on purpose — neutral =
   today's look (no empty ruleset). Hex fallbacks so it works even if the
   CSS var is absent.
   ============================================= */
.copy-toast--error { border-left: 3px solid var(--timer-red, #f43f5e); }
.copy-toast--success { border-left: 3px solid var(--timer-green, #34d399); }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest client-tests/submission-pill.test.js`
Expected: PASS (6/6).

- [ ] **Step 7: Full client suite (regression gate)**

Run: `npx jest client-tests/`
Expected: PASS — all green (new HTML element + CSS are additive; no existing test asserts their absence).

- [ ] **Step 8: Verify branch, then commit**

```bash
git -C C:/mm-phase7-2 branch --show-current   # must print: phase7-2-feedback-layer-split
git -C C:/mm-phase7-2 add public/js/ui/feedback.js public/index.html public/css/06-states-anim.css client-tests/submission-pill.test.js
git -C C:/mm-phase7-2 commit -m "Phase 7.2 (1): CG-03 submission pill — API + element + CSS"
```

---

### Task 2: Wire `socketClient.js` + `app.js` through the router (integration + the MI-01 delta + pill resolution)

**Goal:** Route the live event flow through `feedback.js`: the `notification` dispatcher (info→toast = the one delta; elim/win→gameEvent, audio/haptics retained), `submissionRejected`→error toast + pill clear, `predictionResult`→variant toast; set the pill on submit/typeahead in `app.js`; clear it on resolution.

**Files:**
- Modify: `public/js/socketClient.js` (import block `:11-22`; `notification` `:492-537`; `submissionRejected` `:653-698`; `predictionResult` `:617-631`; `stateUpdate` top `:258`; `autocompleteResults` `:704`)
- Modify: `public/js/app.js` (ui.js import block; `submitMovie` `:548-563`; input handler `:584-600`)
- Test: `client-tests/feedback-wiring.test.js`

**Acceptance Criteria:**
- [ ] `notification` `kind:'info'` → a `.copy-toast.copy-toast--info` appears and `#notification-overlay` stays hidden (the MI-01 delta).
- [ ] `notification` `kind:'elimination'` → `#notification-overlay` shows with `notification--elimination` + an `.elimination-flash` (gameEvent path, behaviour-preserving).
- [ ] `submissionRejected` → `.copy-toast.copy-toast--error` with the message+tail; `#movie-input` re-enabled with `originalInput` restored; `#submission-pill` not `.visible`.
- [ ] A pre-set `submissionPill.checking()` is cleared by the next `stateUpdate`; `submissionPill.searching()` is cleared by `autocompleteResults`, but a `checking` pill is **not** cleared by `autocompleteResults`.
- [ ] `app.js` `submitMovie()` calls `submissionPill.checking(movie)` (replacing the static `'Validating connection...'` hint write); the typeahead path calls `submissionPill.searching()` / `submissionPill.clear('searching')`.
- [ ] Full suite green: `npx jest client-tests/ server/` + coverage ratchet holds.

**Verify:** `npx jest client-tests/feedback-wiring.test.js client-tests/ server/` → all green.

**Steps:**

- [ ] **Step 1: Write the failing test** — `client-tests/feedback-wiring.test.js`

```js
/**
 * @jest-environment jsdom
 */
// Verifies the feedback router is wired into the live socket flow: the MI-01
// delta (info -> toast, not overlay), elimination still uses the overlay path,
// submissionRejected uses the error toast + clears the pill, and the pill
// resolution wiring (stateUpdate / autocompleteResults) behaves correctly.
const { loadIndexHtml, makePlayingState, makeChainItem } = require('./fixtures');

jest.mock('../public/js/state.js', () => {
  const internals = {
    socket: null, lobbyId: 'TEST01', playerId: 'host_id',
    isSpectator: false, isDaily: false, gameState: null,
    turnInterval: null, lastTickSound: 0,
  };
  return {
    __setSocket: (s) => { internals.socket = s; },
    __setMyPlayerId: (id) => { internals.playerId = id; },
    getSocket: () => internals.socket,
    setSocket: (s) => { internals.socket = s; },
    getCurrentLobbyId: () => internals.lobbyId,
    getMyPlayerId: () => internals.playerId,
    getGameState: () => internals.gameState,
    getIsSpectator: () => internals.isSpectator,
    getIsDaily: () => internals.isDaily,
    getTurnInterval: () => internals.turnInterval,
    getLastTickSound: () => internals.lastTickSound,
    setTurnInterval: (v) => { internals.turnInterval = v; },
    setLastTickSound: (v) => { internals.lastTickSound = v; },
    clearTurnTimer: () => { if (internals.turnInterval) clearInterval(internals.turnInterval); internals.turnInterval = null; },
    onJoined: jest.fn(), onStateUpdate: jest.fn((s) => { internals.gameState = s; return null; }),
    onRejoined: jest.fn(), resetSession: jest.fn(),
  };
});

import * as state from '../public/js/state.js';
import { initUIElements, submissionPill } from '../public/js/ui.js';
import { initSocket } from '../public/js/socketClient.js';

function createFakeSocket() {
  const handlers = new Map();
  return {
    handlers, id: 'sock_self',
    on(e, h) { handlers.set(e, h); },
    emit: jest.fn(),
    trigger(e, p) { const h = handlers.get(e); if (!h) throw new Error('no handler ' + e); return h(p); },
  };
}
let fakeSocket;
window.io = jest.fn(() => fakeSocket);

describe('feedback wiring — dispatcher delta + pill resolution', () => {
  beforeEach(() => {
    loadIndexHtml();
    initUIElements();
    fakeSocket = createFakeSocket();
    state.__setMyPlayerId('host_id');
    initSocket();
    state.__setSocket(fakeSocket);
  });
  afterEach(() => { submissionPill.clear(); document.body.innerHTML = ''; });

  test("MI-01 delta: kind:'info' renders a toast, NOT the centre overlay", () => {
    fakeSocket.trigger('notification', { msg: 'Game starting soon', kind: 'info' });
    const toast = document.querySelector('.copy-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe('Game starting soon');
    expect(toast.classList.contains('copy-toast--info')).toBe(true);
    const overlay = document.getElementById('notification-overlay');
    expect(overlay.classList.contains('hidden')).toBe(true); // overlay NOT used
  });

  test("kind:'elimination' still uses the overlay + flash (behaviour-preserving)", () => {
    fakeSocket.trigger('notification', { msg: 'Alice was eliminated', kind: 'elimination' });
    const overlay = document.getElementById('notification-overlay');
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(overlay.classList.contains('notification--elimination')).toBe(true);
    expect(document.querySelector('.elimination-flash')).not.toBeNull();
  });

  test('submissionRejected: error toast + input restored + pill cleared', () => {
    submissionPill.checking('Heat'); // simulate the in-flight submit pill
    fakeSocket.trigger('submissionRejected', {
      message: "Couldn't find that title.", retriesLeft: 2, originalInput: 'Heaat',
    });
    const toast = document.querySelector('.copy-toast');
    expect(toast.classList.contains('copy-toast--error')).toBe(true);
    expect(toast.textContent).toContain("Couldn't find that title.");
    const input = document.getElementById('movie-input');
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('Heaat');
    expect(document.getElementById('submission-pill').classList.contains('visible')).toBe(false);
  });

  test('stateUpdate clears an in-flight checking pill', () => {
    submissionPill.checking('Heat');
    fakeSocket.trigger('stateUpdate', makePlayingState({ currentTurnIndex: 0, chain: [makeChainItem()] }));
    expect(document.getElementById('submission-pill').classList.contains('visible')).toBe(false);
  });

  test('autocompleteResults clears searching pill but NOT a checking pill', () => {
    submissionPill.searching();
    fakeSocket.trigger('autocompleteResults', []);
    expect(document.getElementById('submission-pill').classList.contains('visible')).toBe(false);

    submissionPill.checking('Heat');
    fakeSocket.trigger('autocompleteResults', []);
    expect(document.getElementById('submission-pill').textContent).toBe('Checking: "Heat"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest client-tests/feedback-wiring.test.js`
Expected: FAIL — info still uses overlay; submissionRejected toast has no `copy-toast--error`; pill not cleared by stateUpdate/autocompleteResults.

- [ ] **Step 3: Extend the socketClient ui.js import** — `public/js/socketClient.js`, in the `import { … } from './ui.js'` block (`:11-22`), add `toast, gameEvent, submissionPill,` (e.g. on the `showToast,` line):

```js
  showGhostAttempt, showToast, renderDailyResult, renderMyStats, showConfetti,
  toast, gameEvent, submissionPill, // Phase 7.2: feedback router
```

- [ ] **Step 4: Rework the `notification` handler** — `public/js/socketClient.js`, replace the body from line 507 (`if (!selfElimActive) showNotification(msg);`) through line 537 (end of the handler, the `// kind === 'info'…` comment line) with:

```js
    // Phase 7.2: route through the feedback layer. Audio/haptics stay here
    // (network-layer side effects, not UI-feedback DOM). gameEvent replicates
    // the exact prior overlay/flash/confetti behaviour for elim/win, so those
    // are behaviour-preserving. The ONE deliberate delta: kind:'info' no
    // longer takes over the centre overlay — it goes to the calm toast
    // channel (MI-01). Eliminations/wins keep the overlay via gameEvent.
    if (kind === 'elimination') {
      playFail();
      vibrate([200, 100, 200]); // attention-grabbing pattern on elimination
      gameEvent('elimination', { msg, selfElimActive });
    } else if (kind === 'win') {
      // M2: single melodic arpeggio + celebration haptics (unchanged).
      playSfx('win');
      vibrate([60, 80, 60, 80, 60]);
      gameEvent('win', { msg, selfElimActive });
    } else {
      toast(msg, { variant: 'info' });
    }
  });
```

(The old `if (!selfElimActive) showNotification(msg);` standalone line is deleted — its behaviour now lives inside `gameEvent` for elim/win, and is intentionally replaced by `toast` for info. This is the MI-01 delta.)

- [ ] **Step 5: Route `submissionRejected` to the error toast + clear the pill** — `public/js/socketClient.js`, in the `submissionRejected` handler replace `showToast((message || "Couldn't find that title.") + tail);` (≈ line 663) with:

```js
    // Phase 7.2: validation errors use the error-variant toast channel; the
    // in-flight "Checking:" pill is resolved (the restored input + this toast
    // now carry the feedback). All other behaviour below is unchanged.
    toast((message || "Couldn't find that title.") + tail, { variant: 'error' });
    submissionPill.clear();
```

- [ ] **Step 6: Route `predictionResult` to variant toasts** — `public/js/socketClient.js`, replace the three `showToast(...)` calls in the `predictionResult` handler (`:617-631`) so the body reads:

```js
  socket.on('predictionResult', ({ outcome, correct, total, perVoter }) => {
    if (!total) return; // no votes this turn — nothing to surface
    const myVoteCorrect = perVoter && perVoter[socket.id];
    const overall = `${correct} of ${total} called it`;
    // Phase 7.2: consolidate through the toast channel with a status variant
    // (still a toast, same text/timing — purely additive colour accent).
    if (myVoteCorrect === true) {
      toast(`✅ You called it! (${overall})`, { variant: 'success' });
      playSfx('success');
    } else if (myVoteCorrect === false) {
      toast(`❌ Wrong call (${overall})`, { variant: 'error' });
      playSfx('fail');
    } else {
      toast(`🔮 ${overall}`, { variant: 'info' });
    }
  });
```

- [ ] **Step 7: Clear the pill on state resolution** — `public/js/socketClient.js`, at the very top of the `stateUpdate` handler body (immediately after `socket.on('stateUpdate', (state) => {`, before `const prevState = …` at line 259):

```js
    // Phase 7.2 (CG-03): any state broadcast means the in-flight submit
    // resolved (accepted move, or eliminate-then-update). Idempotent — a
    // no-op when no pill is showing; safe on the frequent stateUpdate fire.
    submissionPill.clear();
```

- [ ] **Step 8: Scope the autocomplete pill clear** — `public/js/socketClient.js`, replace line 704 `socket.on('autocompleteResults', renderAutocompleteResults);` with:

```js
  // Phase 7.2 (CG-03): a returned search clears the "Searching…" pill, but
  // ONLY if still in searching mode — a debounced result that lands after
  // the player pressed Enter must not wipe the "Checking:" pill.
  socket.on('autocompleteResults', (payload) => {
    submissionPill.clear('searching');
    renderAutocompleteResults(payload);
  });
```

- [ ] **Step 9: Set the pill in `app.js` `submitMovie()`** — `public/js/app.js`. First add `submissionPill` to the `import { … } from './ui.js'` block (locate it near the top of `app.js`; add the name to the destructured list). Then in `submitMovie()` (`:548-563`) replace line 562 `if (hintText) hintText.innerText = 'Validating connection...';` with:

```js
    // Phase 7.2 (CG-03): the pill replaces the static "Validating
    // connection..." hint so the player's submitted title stays visible
    // through the TMDB round-trip instead of facing a blank input.
    submissionPill.checking(movie);
```

- [ ] **Step 10: Drive the searching pill from the typeahead** — `public/js/app.js`, in the `movieInput` `input` handler (`:584-600`): in the `if (query.length < 2) { … }` early-return block (after `closeMobileAc();`, before `return;`) add:

```js
      submissionPill.clear('searching'); // left the typeahead — drop the searching pill
```

and inside the debounce `setTimeout` (right before `socket.emit('autocompleteSearch', …)`):

```js
      submissionPill.searching();
```

- [ ] **Step 11: Run the wiring test to verify it passes**

Run: `npx jest client-tests/feedback-wiring.test.js`
Expected: PASS (5/5).

- [ ] **Step 12: Full suite + coverage ratchet**

Run: `npx jest client-tests/ server/`
Expected: PASS — every suite green; coverage ratchet holds (whole-suite gate; server is unaffected but the ratchet is project-wide).

- [ ] **Step 13: Verify module load (no cycle / no syntax error)**

Run: `node -e "import('./public/js/ui/feedback.js').then(()=>console.log('load ok')).catch(e=>{console.error(e);process.exit(1)})"`
(run from `C:/mm-phase7-2`) Expected: `load ok`.

- [ ] **Step 14: Verify branch, then commit**

```bash
git -C C:/mm-phase7-2 branch --show-current   # must print: phase7-2-feedback-layer-split
git -C C:/mm-phase7-2 add public/js/socketClient.js public/js/app.js client-tests/feedback-wiring.test.js
git -C C:/mm-phase7-2 commit -m "Phase 7.2 (2): wire socketClient/app through the feedback router (MI-01 delta + CG-03 pill)"
```

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-05-17-feedback-layer-split-design.md`):
- §3.1 `feedback.js` `toast`+`gameEvent` (no `modalResult`) → Task 0. ✅
- §3.2 CG-03 pill (Checking/Searching, resolves on success/reject/eliminate, retry+`retriesLeft` unchanged) → Task 1 (API) + Task 2 (wiring; submissionRejected retains the existing `retriesLeft` tail/hint/restore code untouched). ✅
- §3.3 call-site migration (dispatcher, submissionRejected, predictionResult; unchanged: self-elim/ghost/winflash/confetti) → Task 2. ✅
- §3.4 single delta `kind:'info'`→toast → Task 2 Step 4 + pinned by `feedback-wiring.test.js`. ✅
- §3.5 taxonomy: toast/gameEvent built; modal-result NOT re-wrapped → no task (documented decision). ✅
- §4 test plan (router channels, gameEvent behaviour-preserving incl. selfElimActive, pill state machine, dispatcher delta, XSS) → covered across the three test files. ✅
- §5 guardrails (client-only, no new event, reuse primitives, CSS only in 06, don't touch name prompts / 7.3 CSS) → enforced by scope-guards section + step-level file lists. ✅
- §6 files touched → Tasks 0–2 match exactly (note: `ui.js` barrel is modified in Task 0 as anticipated). ✅
- §7 acceptance criteria → mapped onto per-task Acceptance Criteria. ✅
- §8 out of scope (`error` handler, solo-streak toasts, modalResult) → explicit in scope-guards. ✅

**2. Placeholder scan:** No TBD/TODO/"similar to"/"add error handling". Every code step shows complete code. Verify commands are exact. ✅

**3. Type consistency:** `showToast(msg, { variant })`, `toast(message, opts)` (delegates), `gameEvent(kind, { msg, selfElimActive })`, `submissionPill.checking(title)/.searching()/.clear(onlyMode)` — names/signatures identical across Tasks 0→1→2 and all three test files. The `submissionPill` import path is `../public/js/ui.js` (barrel) everywhere. ✅

No gaps found.
