# Phase 7.3 — Design-System Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the three ad-hoc, inline-styled name overlays (`showNamePrompt`, `showJoinPrompt`, `showDailyNamePrompt`) into one shared, tested modal factory built on the `.modal-overlay`/`.modal-card` design system, with byte-for-byte zero visual/behaviour change, plus three verified CSS-hygiene fixes.

**Architecture:** A new pure `public/js/ui/modal.js` exports a generic `createPromptModal(config) → {overlay, close}`. A new pure `public/js/ui/name-prompts.js` exports three deps-injected config builders (`buildNamePromptConfig`, `buildJoinPromptConfig`, `buildDailyPromptConfig`) — the project's established "extract a pure unit-testable seam; app.js is thin glue" pattern (see `client-tests/daily-name-prompt.test.js:13-15`). `app.js`/`ui-panels.js` become one-line wrappers. A `.modal-*--prompt` compact modifier in `04-modals.css` reproduces the legacy pixels exactly (no entrance animation, 340px, 2rem, z-index 1000, no backdrop blur). Self-elim CSS hygiene lands in `06-states-anim.css`.

**Tech Stack:** Vanilla ES modules (no build; browser-native, babel-jest for tests), Jest 30 + jest-environment-jsdom, CommonJS project root. No new dependencies. Client-only — no `server.js`/socket/dependency change.

**Worktree/branch:** isolated worktree `C:/mm-phase7-3`, branch `phase7-3-design-system-hardening`, off `origin/main 57e4599`, `node_modules` junctioned. A parallel Codex agent shares this repo → **every commit step MUST first verify `git -C C:/mm-phase7-3 branch --show-current` == `phase7-3-design-system-hardening`**. Run tests with `npx jest` (full suite) or `npx jest client-tests/<file>` from `C:/mm-phase7-3`.

**Spec:** `docs/superpowers/specs/2026-05-17-design-system-hardening-design.md` (commit `8f44bec`).

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `public/js/ui/modal.js` | **Create** | Pure, app-agnostic `createPromptModal(config)` factory. No app/socket imports. `textContent`-only. Emits `.modal-overlay/.modal-card` + `--prompt` modifier + per-element prompt classes; owns lifecycle, backdrop, Enter, focus, invalid cue. |
| `public/js/ui/name-prompts.js` | **Create** | Pure deps-injected config builders for the 3 prompts: `buildNamePromptConfig`, `buildJoinPromptConfig`, `buildDailyPromptConfig`. Imports only `./modal.js` is NOT needed (builders return data); no app/socket imports. |
| `public/js/ui.js` | **Modify** | Barrel — re-export `./ui/modal.js` and `./ui/name-prompts.js`. |
| `public/js/app.js` | **Modify** (`290-417`) | `showNamePrompt`/`showJoinPrompt` become one-line wrappers: assemble a `deps` object from closure + `createPromptModal(buildXConfig(...))`. Delete ~14 cssText assignments. |
| `public/js/ui/ui-panels.js` | **Modify** (`429-517`) | `showDailyNamePrompt` body becomes `createPromptModal(buildDailyPromptConfig(...))`; exported signature/contract/class-names byte-for-byte. Update the `429-446` comment to "MI-02 done". Delete ~10 cssText assignments. |
| `public/css/04-modals.css` | **Modify** (append after the modal block, ~`:233`) | `.modal-overlay--prompt`/`.modal-card--prompt` + `.modal-prompt-*` element classes reproducing the exact legacy pixels. |
| `public/css/06-states-anim.css` | **Modify** | Delete orphaned `.self-elim-could` (`:1082-1093`); add `.self-elim-outs*`/`.self-elim-bridge` styling; add single-child `.self-elim-grid` centering. |
| `client-tests/modal-factory.test.js` | **Create** | Unit tests for `createPromptModal` (structure, backdrop, Enter, focus timing, invalid cue, XSS). |
| `client-tests/name-prompts.test.js` | **Create** | Unit tests for the 3 builders (config shape + `onSubmit` side-effect order with mock deps) + a factory+builder integration sanity check. |
| `client-tests/self-elim-hygiene.test.js` | **Create** | DOM-contract guard: `.self-elim-could` never emitted; the 7.1 `.self-elim-outs*`/`-bridge` ARE emitted; timeout card = single `.self-elim-col` (the `:only-child` target). |

**No changes to:** `server.js`, any socket event, any dependency, the six `<link>` partial order in `index.html`, the pre-declared modals, any dynamic `.style.*` write, or any existing test file.

---

## Legacy reference (verbatim — the source of truth for pixel parity)

The three prompts today (read at `57e4599`). The factory + `--prompt` CSS must reproduce these byte-for-byte.

**Shared cssText constants:**
- overlay: `display:flex;align-items:center;justify-content:center;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:1000;`
- card: `background:var(--surface,#18181b);border-radius:1rem;padding:2rem;max-width:340px;width:90%;text-align:center;border:1px solid rgba(255,255,255,0.08);`
- title (with subtitle — name/daily): `margin:0 0 0.25rem;font-size:1.25rem;color:var(--text,#f8fafc);`
- title (no subtitle — join): `margin:0 0 1.5rem;font-size:1.25rem;color:var(--text,#f8fafc);`
- subtitle: `margin:0 0 1.5rem;color:var(--text-muted,#94a3b8);font-size:0.9rem;`
- label (join only): `display:block;text-align:left;font-size:0.8rem;font-weight:600;color:var(--text-muted,#94a3b8);margin-bottom:0.35rem;letter-spacing:0.03em;`
- input base: `width:100%;padding:0.75rem 1rem;border-radius:0.5rem;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text,#f8fafc);font-size:1rem;box-sizing:border-box;margin-bottom:1rem;outline:none;font-family:inherit;` — join code field appends `margin-bottom:1.5rem;text-transform:uppercase;` (overrides the 1rem)
- primary btn: `width:100%;padding:0.75rem;border-radius:0.5rem;border:none;background:var(--accent,#818cf8);color:white;font-size:1rem;font-weight:600;cursor:pointer;font-family:inherit;` — when a secondary follows (join/daily) it also has `margin-bottom:0.75rem;`
- secondary btn: `width:100%;padding:0.75rem;border-radius:0.5rem;border:1px solid rgba(255,255,255,0.1);background:transparent;color:var(--text-muted,#94a3b8);font-size:0.9rem;cursor:pointer;font-family:inherit;`
- empty-name invalid cue (dynamic — preserved, NOT migrated): `input.style.borderColor = '#f87171'; input.focus();` keep modal open.

**Per-prompt behaviour:**
- `showNamePrompt(roomCode)` — title `Join Game`, subtitle `Room <roomCode>`, 1 input (placeholder `Enter your name`, maxLength 24), primary `Join Game`, NO secondary, NO backdrop-close, focus `setTimeout(100)`. Submit: `name=input.value.trim()`; empty→cue+return; `localStorage.setItem('mm_playerName',name)`; `if(playerNameInput) playerNameInput.value=name`; `overlay.remove()`; `showScreen('lobby')`; `socket.emit('joinLobby',{name,lobbyId:roomCode,stableId:getStableId()})`; `window.history.replaceState({},'',window.location.pathname)`.
- `showJoinPrompt()` — title `Join a Room`, NO subtitle, field 1 label `Your Name` input (placeholder `Enter your name`, value `localStorage.getItem('mm_playerName')||''`, maxLength 24, bottom-margin 1rem), field 2 label `Room Code` input (placeholder `Leave blank to create new`, maxLength 6, uppercase, bottom-margin 1.5rem), primary `Join Game`, secondary `Back`, backdrop-close ON, focus `setTimeout(100)` on (name prefilled ? code : name). Submit: `name=name.trim()`, `code=code.trim().toUpperCase()`; empty name→cue(name)+return; `localStorage.setItem`; `playerNameInput.value=name`; `overlay.remove()`; `prepareAudio()`; `showScreen('lobby')`; `socket.emit('joinLobby',{name,lobbyId:code,stableId:getStableId()})`. `Back`→close. name Enter→focus code; code Enter→submit.
- `showDailyNamePrompt({prefill='',onConfirm}={})` — overlay class `daily-name-overlay`, title `🗓️ Daily Challenge`, subtitle `Pick a name to track your score on the daily leaderboard.`, 1 input (placeholder `Enter your name`, value `prefill||''`, maxLength 24), primary `Start Daily Challenge` (class `daily-name-go`), secondary `Maybe later` (class `daily-name-cancel`), backdrop-close ON, focus **immediate** (no setTimeout). Submit: `name=input.value.trim()`; empty→cue+return; `close()`; `if(onConfirm) onConfirm(name)`. Exported; `client-tests/daily-name-prompt.test.js` is its untouched contract guard.

---

## Task 0: The modal factory (`public/js/ui/modal.js`)

**Goal:** A pure, app-agnostic `createPromptModal(config) → {overlay, close}` that emits the modal-system markup and owns all generic behaviour (backdrop, Enter, focus timing, invalid cue, lifecycle).

**Files:**
- Create: `public/js/ui/modal.js`
- Modify: `public/js/ui.js` (barrel)
- Test: `client-tests/modal-factory.test.js`

**Acceptance Criteria:**
- [ ] `createPromptModal` builds `div.modal-overlay.modal-overlay--prompt > div.modal-card.modal-card--prompt` and appends to `document.body`.
- [ ] Optional `overlayClass` is added additively (overlay keeps `modal-overlay modal-overlay--prompt` plus the extra class).
- [ ] Title `textContent` set; `--solo` title class iff no subtitle; subtitle `<p>` only when provided.
- [ ] Each field: `<label>` only when `field.label` set; input gets `--gap-lg` iff `gap:'1.5rem'`, `--upper` iff `uppercase`; `value`/`maxLength`/`placeholder` applied; `autocomplete=off`.
- [ ] Primary button: `--stacked` iff a `secondary` exists; custom `className` added; `textContent` set. Secondary built only when configured.
- [ ] `primary.onSubmit(values, {invalid, close})` called on primary click and on Enter in the last field; `invalid(idx)` sets that input's `style.borderColor='#f87171'` + focuses it + leaves the modal open.
- [ ] Enter in a non-last field focuses the next field; Enter in the last field submits.
- [ ] `closeOnBackdrop:true` → clicking the overlay (`e.target===overlay`) closes; clicking the card does not. `false` → overlay click never closes.
- [ ] `focusDelayMs:0` focuses synchronously; `>0` focuses after that many ms; `focusIndex` selects the field.
- [ ] All text via `textContent` (XSS-safe — a `<script>`/`<img onerror>` title produces no element).
- [ ] Returns `{overlay, close}`.
- [ ] `public/js/ui.js` re-exports `./ui/modal.js`.
- [ ] Every code change carries a WHY comment.

**Verify:** `npx jest client-tests/modal-factory.test.js` → all pass. Then `npx jest` → full suite green (≥ 47 suites / 342 tests; new suite additive).

**Steps:**

- [ ] **Step 1: Write the failing test** — create `client-tests/modal-factory.test.js`:

```js
/**
 * @jest-environment jsdom
 */
// Phase 7.3 MI-02: createPromptModal is the single generic factory the 3
// name overlays delegate to. These tests pin its structural + behavioural
// contract so the prompt wrappers (Task 1/2) are correct by construction.
const { loadIndexHtml } = require('./fixtures');
import { createPromptModal } from '../public/js/ui.js';

function baseConfig(over = {}) {
  return {
    title: 'T',
    fields: [{ placeholder: 'name', maxLength: 24, gap: '1rem' }],
    primary: { label: 'Go', onSubmit: jest.fn() },
    closeOnBackdrop: false,
    focusDelayMs: 0,
    ...over,
  };
}

describe('createPromptModal — Phase 7.3 modal factory', () => {
  beforeEach(() => { loadIndexHtml(); try { localStorage.clear(); } catch {} });
  afterEach(() => { document.body.innerHTML = ''; jest.useRealTimers(); });

  test('builds modal-system markup and appends to body', () => {
    createPromptModal(baseConfig());
    const overlay = document.querySelector('.modal-overlay.modal-overlay--prompt');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('.modal-card.modal-card--prompt')).not.toBeNull();
    expect(overlay.parentNode).toBe(document.body);
  });

  test('overlayClass is additive', () => {
    createPromptModal(baseConfig({ overlayClass: 'daily-name-overlay' }));
    const overlay = document.querySelector('.daily-name-overlay');
    expect(overlay.classList.contains('modal-overlay')).toBe(true);
    expect(overlay.classList.contains('modal-overlay--prompt')).toBe(true);
  });

  test('title --solo only when no subtitle; subtitle rendered when present', () => {
    createPromptModal(baseConfig());
    expect(document.querySelector('.modal-prompt-title--solo')).not.toBeNull();
    expect(document.querySelector('.modal-prompt-subtitle')).toBeNull();
    document.body.innerHTML = '';
    createPromptModal(baseConfig({ subtitle: 'S' }));
    expect(document.querySelector('.modal-prompt-title--solo')).toBeNull();
    expect(document.querySelector('.modal-prompt-subtitle').textContent).toBe('S');
  });

  test('field flags: label, --gap-lg, --upper', () => {
    createPromptModal(baseConfig({
      fields: [
        { label: 'Your Name', placeholder: 'n', maxLength: 24, gap: '1rem' },
        { label: 'Room Code', placeholder: 'c', maxLength: 6, gap: '1.5rem', uppercase: true },
      ],
    }));
    const labels = [...document.querySelectorAll('.modal-prompt-label')].map(l => l.textContent);
    expect(labels).toEqual(['Your Name', 'Room Code']);
    const inputs = document.querySelectorAll('.modal-prompt-input');
    expect(inputs[0].classList.contains('modal-prompt-input--gap-lg')).toBe(false);
    expect(inputs[1].classList.contains('modal-prompt-input--gap-lg')).toBe(true);
    expect(inputs[1].classList.contains('modal-prompt-input--upper')).toBe(true);
    expect(inputs[1].maxLength).toBe(6);
  });

  test('primary --stacked iff secondary; custom classNames applied', () => {
    createPromptModal(baseConfig());
    expect(document.querySelector('.modal-prompt-btn--stacked')).toBeNull();
    document.body.innerHTML = '';
    createPromptModal(baseConfig({
      primary: { label: 'Go', className: 'daily-name-go', onSubmit: jest.fn() },
      secondary: { label: 'Back', className: 'daily-name-cancel', onClick: jest.fn() },
    }));
    expect(document.querySelector('.modal-prompt-btn--primary.modal-prompt-btn--stacked')).not.toBeNull();
    expect(document.querySelector('.daily-name-go')).not.toBeNull();
    expect(document.querySelector('.daily-name-cancel')).not.toBeNull();
  });

  test('primary click invokes onSubmit with values + helpers; invalid() flags + keeps open', () => {
    const onSubmit = jest.fn((vals, { invalid }) => invalid(0));
    createPromptModal(baseConfig({ primary: { label: 'Go', onSubmit } }));
    const input = document.querySelector('.modal-prompt-input');
    input.value = 'x';
    document.querySelector('.modal-prompt-btn--primary').click();
    expect(onSubmit).toHaveBeenCalledWith(['x'], expect.objectContaining({
      invalid: expect.any(Function), close: expect.any(Function),
    }));
    expect(input.style.borderColor).toBe('rgb(248, 113, 113)'); // #f87171
    expect(document.querySelector('.modal-overlay')).not.toBeNull(); // still open
  });

  test('close() removes the overlay; secondary.onClick gets {close}', () => {
    const onClick = jest.fn(({ close }) => close());
    const { overlay, close } = createPromptModal(baseConfig({
      secondary: { label: 'Back', onClick },
    }));
    expect(typeof close).toBe('function');
    document.querySelector('.modal-prompt-btn--secondary').click();
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ close: expect.any(Function) }));
    expect(overlay.isConnected).toBe(false);
  });

  test('closeOnBackdrop gate', () => {
    createPromptModal(baseConfig({ closeOnBackdrop: false }));
    document.querySelector('.modal-overlay').click();
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    document.body.innerHTML = '';
    createPromptModal(baseConfig({ closeOnBackdrop: true }));
    const ov = document.querySelector('.modal-overlay');
    ov.querySelector('.modal-card').click();          // inside → stays
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    ov.click();                                       // backdrop → closes
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  test('Enter advances focus then submits on last field', () => {
    const onSubmit = jest.fn();
    createPromptModal(baseConfig({
      fields: [
        { placeholder: 'n', maxLength: 24, gap: '1rem' },
        { placeholder: 'c', maxLength: 6, gap: '1.5rem' },
      ],
      primary: { label: 'Go', onSubmit },
    }));
    const [f0, f1] = document.querySelectorAll('.modal-prompt-input');
    f0.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
    expect(document.activeElement).toBe(f1);
    expect(onSubmit).not.toHaveBeenCalled();
    f1.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('focusDelayMs:0 focuses synchronously; >0 waits; focusIndex selects', () => {
    jest.useFakeTimers();
    createPromptModal(baseConfig({
      fields: [
        { placeholder: 'n', maxLength: 24, gap: '1rem' },
        { placeholder: 'c', maxLength: 6, gap: '1.5rem' },
      ],
      focusDelayMs: 100, focusIndex: 1,
    }));
    const f1 = document.querySelectorAll('.modal-prompt-input')[1];
    expect(document.activeElement).not.toBe(f1);
    jest.advanceTimersByTime(100);
    expect(document.activeElement).toBe(f1);
  });

  test('XSS: crafted title is inert text', () => {
    createPromptModal(baseConfig({ title: '<img src=x onerror=alert(1)>' }));
    const t = document.querySelector('.modal-prompt-title');
    expect(t.querySelector('img')).toBeNull();
    expect(t.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx jest client-tests/modal-factory.test.js`
Expected: FAIL — `createPromptModal is not a function` / not exported.

- [ ] **Step 3: Create `public/js/ui/modal.js`**

```js
// public/js/ui/modal.js
//
// WHY (Phase 7.3 MI-02 + DS-01): showNamePrompt / showJoinPrompt /
// showDailyNamePrompt were three near-identical overlays built imperatively
// with ~28 hardcoded `.style.cssText` assignments that bypassed the
// .modal-overlay/.modal-card design system (the DS-01 inline-style debt and
// the MI-02 ad-hoc-overlay debt are the same code). This is the single,
// pure, app-agnostic factory they now delegate to. It emits the design
// system's classes plus a pixel-parity `--prompt` compact modifier
// (04-modals.css) so consolidation is a strict zero-behaviour-change
// refactor. No app/socket imports. textContent-only — preserves the
// originals' XSS posture (titles/labels are static, but the discipline is
// kept). The empty-required `borderColor` cue is a *dynamic* state write
// (behaviour, not static debt) and is intentionally preserved here.

export function createPromptModal(config) {
  const {
    overlayClass,
    title,
    subtitle,
    fields = [],
    primary,
    secondary,
    closeOnBackdrop = false,
    focusDelayMs = 0,
    focusIndex = 0,
  } = config;

  const overlay = document.createElement('div');
  // .modal-overlay = the design-system backdrop; --prompt = the compact,
  // no-entrance-animation modifier reproducing the legacy prompt pixels.
  overlay.className = 'modal-overlay modal-overlay--prompt';
  if (overlayClass) overlay.classList.add(overlayClass); // additive — keeps test hooks

  const card = document.createElement('div');
  card.className = 'modal-card modal-card--prompt';

  const titleEl = document.createElement('h2');
  // No-subtitle prompts (showJoinPrompt) used a larger title bottom-margin;
  // the --solo modifier carries that exact spacing instead of cssText.
  titleEl.className = subtitle
    ? 'modal-prompt-title'
    : 'modal-prompt-title modal-prompt-title--solo';
  titleEl.textContent = title;
  card.appendChild(titleEl);

  if (subtitle) {
    const subEl = document.createElement('p');
    subEl.className = 'modal-prompt-subtitle';
    subEl.textContent = subtitle;
    card.appendChild(subEl);
  }

  const inputEls = fields.map((f) => {
    if (f.label) {
      const labelEl = document.createElement('label');
      labelEl.className = 'modal-prompt-label';
      labelEl.textContent = f.label;
      card.appendChild(labelEl);
    }
    const input = document.createElement('input');
    input.type = f.type || 'text';
    input.placeholder = f.placeholder || '';
    input.autocomplete = 'off';
    if (typeof f.maxLength === 'number') input.maxLength = f.maxLength;
    if (f.value) input.value = f.value;
    // gap = the exact per-field bottom margin from the legacy cssText:
    // '1rem' is the base; '1.5rem' (join code field) gets --gap-lg.
    input.className = f.gap === '1.5rem'
      ? 'modal-prompt-input modal-prompt-input--gap-lg'
      : 'modal-prompt-input';
    if (f.uppercase) input.classList.add('modal-prompt-input--upper');
    card.appendChild(input);
    return input;
  });

  const primaryBtn = document.createElement('button');
  primaryBtn.type = 'button';
  // Legacy: the primary button only had a bottom margin when a secondary
  // button followed it (single-button prompts had none) — --stacked is
  // that exact conditional spacing.
  primaryBtn.className = secondary
    ? 'modal-prompt-btn modal-prompt-btn--primary modal-prompt-btn--stacked'
    : 'modal-prompt-btn modal-prompt-btn--primary';
  if (primary.className) primaryBtn.classList.add(primary.className);
  primaryBtn.textContent = primary.label;
  card.appendChild(primaryBtn);

  let secondaryBtn = null;
  if (secondary) {
    secondaryBtn = document.createElement('button');
    secondaryBtn.type = 'button';
    secondaryBtn.className = 'modal-prompt-btn modal-prompt-btn--secondary';
    if (secondary.className) secondaryBtn.classList.add(secondary.className);
    secondaryBtn.textContent = secondary.label;
    card.appendChild(secondaryBtn);
  }

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }

  function submit() {
    // invalid(idx): the legacy red-border cue. It is a dynamic .style write
    // (per-keystroke state feedback) — NOT static inline-style debt — so it
    // stays in JS, byte-for-byte with the originals (#f87171 + focus, keep
    // the modal open). close: lets the caller dismiss after a valid submit.
    primary.onSubmit(inputEls.map((i) => i.value), {
      invalid(idx = 0) {
        const el = inputEls[idx];
        if (el) { el.style.borderColor = '#f87171'; el.focus(); }
      },
      close,
    });
  }

  primaryBtn.addEventListener('click', submit);
  if (secondaryBtn) {
    secondaryBtn.addEventListener('click', () => secondary.onClick({ close }));
  }
  if (closeOnBackdrop) {
    // Only a click on the backdrop itself (not bubbled from the card)
    // closes — exactly the legacy `if (e.target === overlay)` guard.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  // Enter: multi-field prompts advance focus field-by-field; the last
  // field submits (exact legacy showJoinPrompt behaviour; single-field
  // prompts therefore submit immediately).
  inputEls.forEach((input, idx) => {
    input.addEventListener('keypress', (e) => {
      if (e.key !== 'Enter') return;
      if (idx < inputEls.length - 1) inputEls[idx + 1].focus();
      else submit();
    });
  });

  // Focus timing is behavioural: showDailyNamePrompt focuses synchronously
  // (it has no entrance transition — the whole reason for the --prompt
  // modifier is "no animation"); the app.js prompts deferred 100ms so the
  // (now removed) animation/layout could settle. Preserve both exactly.
  const focusTarget = inputEls[focusIndex] || inputEls[0];
  if (focusTarget) {
    if (focusDelayMs > 0) setTimeout(() => focusTarget.focus(), focusDelayMs);
    else focusTarget.focus();
  }

  return { overlay, close };
}
```

- [ ] **Step 4: Add the barrel export** — in `public/js/ui.js`, after line 9 (`export * from './ui/feedback.js';`), add:

```js
export * from './ui/modal.js';        // Phase 7.3: shared prompt-modal factory (MI-02)
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx jest client-tests/modal-factory.test.js`
Expected: PASS (all tests).

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `npx jest`
Expected: all suites green; total ≥ 48 suites / ≥ 354 tests (7.2 baseline 47/342 + this additive suite). No existing test modified.

- [ ] **Step 7: Verify branch, then commit**

```bash
cd C:/mm-phase7-3 && [ "$(git branch --show-current)" = "phase7-3-design-system-hardening" ] && \
git add public/js/ui/modal.js public/js/ui.js client-tests/modal-factory.test.js && \
git -c core.safecrlf=false commit -m "Phase 7.3 (0): pure createPromptModal factory + tests (MI-02)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1: Per-prompt config builders (`public/js/ui/name-prompts.js`)

**Goal:** Three pure, deps-injected builders returning the exact config for each prompt; their `onSubmit` closures fire the legacy side-effects in the exact order. This is the unit-testable seam (app.js stays thin glue).

**Files:**
- Create: `public/js/ui/name-prompts.js`
- Modify: `public/js/ui.js` (barrel)
- Test: `client-tests/name-prompts.test.js`

**Acceptance Criteria:**
- [ ] `buildNamePromptConfig({ roomCode, deps })` → title `Join Game`, subtitle `Room <roomCode>`, 1 field (maxLength 24, gap `1rem`, placeholder `Enter your name`, no label), primary `Join Game`, no secondary, `closeOnBackdrop:false`, `focusDelayMs:100`.
- [ ] `buildJoinPromptConfig({ deps })` → title `Join a Room`, no subtitle, field0 label `Your Name` value `deps.localStorage.getItem('mm_playerName')||''` maxLength 24 gap `1rem`, field1 label `Room Code` placeholder `Leave blank to create new` maxLength 6 uppercase gap `1.5rem`, primary `Join Game`, secondary `Back`, `closeOnBackdrop:true`, `focusDelayMs:100`, `focusIndex` 1 iff name prefilled else 0.
- [ ] `buildDailyPromptConfig({ prefill, onConfirm })` → `overlayClass:'daily-name-overlay'`, title `🗓️ Daily Challenge`, subtitle the leaderboard line, 1 field (value `prefill||''`, maxLength 24), primary `Start Daily Challenge` className `daily-name-go`, secondary `Maybe later` className `daily-name-cancel`, `closeOnBackdrop:true`, `focusDelayMs:0`.
- [ ] `name`/`join` `onSubmit`: trims; empty name → `invalid(0)` and return (no side-effects, no close); else, in order: `localStorage.setItem('mm_playerName',name)` → `deps.getPlayerNameInput()` set value → `close()` → (`join` only: `deps.prepareAudio()`) → `deps.showScreen('lobby')` → `deps.socket.emit('joinLobby',{name,lobbyId,stableId:deps.getStableId()})` → (`name` only: `deps.history.replaceState({},'',deps.getPathname())`). `join` uppercases the code via `.trim().toUpperCase()`.
- [ ] `daily` `onSubmit`: trims; empty → `invalid(0)` + return; else `close()` then `onConfirm(name)` (socket-free).
- [ ] Builders are pure (no module-level app/DOM access); only `deps`/args.
- [ ] `public/js/ui.js` re-exports `./ui/name-prompts.js`.
- [ ] WHY comments on every change.

**Verify:** `npx jest client-tests/name-prompts.test.js` → pass. `npx jest` → full suite green; `client-tests/daily-name-prompt.test.js` still passes **unmodified** once Task 2 wires the daily wrapper (Task 1 alone does not change `showDailyNamePrompt`).

**Steps:**

- [ ] **Step 1: Write the failing test** — create `client-tests/name-prompts.test.js`:

```js
/**
 * @jest-environment jsdom
 */
// Phase 7.3 MI-02: the 3 prompt config builders are the unit-testable seam
// (project convention — see daily-name-prompt.test.js:13-15). We pin the
// config shape AND the exact side-effect order of each onSubmit with mock
// deps, so the app.js/ui-panels.js wrappers (Task 2) are correct by
// construction without booting app.js's socket-heavy DOMContentLoaded.
const { loadIndexHtml } = require('./fixtures');
import {
  buildNamePromptConfig, buildJoinPromptConfig, buildDailyPromptConfig,
  createPromptModal,
} from '../public/js/ui.js';

function mkDeps(over = {}) {
  const calls = [];
  const store = new Map();
  const pn = { value: '' };
  return {
    calls, pn,
    deps: {
      socket: { emit: (...a) => calls.push(['emit', ...a]) },
      showScreen: (s) => calls.push(['showScreen', s]),
      getStableId: () => 'SID',
      getPlayerNameInput: () => pn,
      prepareAudio: () => calls.push(['prepareAudio']),
      getPathname: () => '/p',
      history: { replaceState: (...a) => calls.push(['replaceState', ...a]) },
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, v); calls.push(['setItem', k, v]); },
      },
      ...over,
    },
  };
}

describe('buildNamePromptConfig', () => {
  test('shape', () => {
    const { deps } = mkDeps();
    const c = buildNamePromptConfig({ roomCode: 'WXYZ', deps });
    expect(c.title).toBe('Join Game');
    expect(c.subtitle).toBe('Room WXYZ');
    expect(c.fields).toHaveLength(1);
    expect(c.fields[0]).toMatchObject({ maxLength: 24, gap: '1rem' });
    expect(c.fields[0].label).toBeUndefined();
    expect(c.secondary).toBeUndefined();
    expect(c.closeOnBackdrop).toBe(false);
    expect(c.focusDelayMs).toBe(100);
  });

  test('onSubmit side-effects fire in legacy order', () => {
    const { deps, calls, pn } = mkDeps();
    const c = buildNamePromptConfig({ roomCode: 'WXYZ', deps });
    const close = jest.fn();
    c.primary.onSubmit(['  Ada  '], { invalid: jest.fn(), close });
    expect(pn.value).toBe('Ada');
    expect(close).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      ['setItem', 'mm_playerName', 'Ada'],
      ['showScreen', 'lobby'],
      ['emit', 'joinLobby', { name: 'Ada', lobbyId: 'WXYZ', stableId: 'SID' }],
      ['replaceState', {}, '', '/p'],
    ]);
  });

  test('blank name → invalid(0), no side-effects, no close', () => {
    const { deps, calls } = mkDeps();
    const c = buildNamePromptConfig({ roomCode: 'WXYZ', deps });
    const invalid = jest.fn(); const close = jest.fn();
    c.primary.onSubmit(['   '], { invalid, close });
    expect(invalid).toHaveBeenCalledWith(0);
    expect(close).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('buildJoinPromptConfig', () => {
  test('shape + focusIndex by prefill', () => {
    const empty = mkDeps();
    const c0 = buildJoinPromptConfig({ deps: empty.deps });
    expect(c0.title).toBe('Join a Room');
    expect(c0.subtitle).toBeUndefined();
    expect(c0.fields).toHaveLength(2);
    expect(c0.fields[0]).toMatchObject({ label: 'Your Name', maxLength: 24, gap: '1rem', value: '' });
    expect(c0.fields[1]).toMatchObject({ label: 'Room Code', maxLength: 6, gap: '1.5rem', uppercase: true });
    expect(c0.secondary.label).toBe('Back');
    expect(c0.closeOnBackdrop).toBe(true);
    expect(c0.focusDelayMs).toBe(100);
    expect(c0.focusIndex).toBe(0);

    const pre = mkDeps();
    pre.deps.localStorage.setItem('mm_playerName', 'Bo');
    const c1 = buildJoinPromptConfig({ deps: pre.deps });
    expect(c1.fields[0].value).toBe('Bo');
    expect(c1.focusIndex).toBe(1);
  });

  test('onSubmit uppercases code, fires legacy order incl. prepareAudio', () => {
    const { deps, calls, pn } = mkDeps();
    const c = buildJoinPromptConfig({ deps });
    const close = jest.fn();
    c.primary.onSubmit(['Ada', ' rm12 '], { invalid: jest.fn(), close });
    expect(pn.value).toBe('Ada');
    expect(close).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      ['setItem', 'mm_playerName', 'Ada'],
      ['prepareAudio'],
      ['showScreen', 'lobby'],
      ['emit', 'joinLobby', { name: 'Ada', lobbyId: 'RM12', stableId: 'SID' }],
    ]);
  });

  test('Back secondary closes', () => {
    const { deps } = mkDeps();
    const c = buildJoinPromptConfig({ deps });
    const close = jest.fn();
    c.secondary.onClick({ close });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('blank name → invalid(0) only', () => {
    const { deps, calls } = mkDeps();
    const c = buildJoinPromptConfig({ deps });
    const invalid = jest.fn(); const close = jest.fn();
    c.primary.onSubmit(['  ', 'RM'], { invalid, close });
    expect(invalid).toHaveBeenCalledWith(0);
    expect(close).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('buildDailyPromptConfig', () => {
  test('shape', () => {
    const c = buildDailyPromptConfig({ prefill: 'Grace', onConfirm: jest.fn() });
    expect(c.overlayClass).toBe('daily-name-overlay');
    expect(c.title).toBe('🗓️ Daily Challenge');
    expect(c.subtitle).toMatch(/daily leaderboard/i);
    expect(c.fields[0].value).toBe('Grace');
    expect(c.primary).toMatchObject({ label: 'Start Daily Challenge', className: 'daily-name-go' });
    expect(c.secondary).toMatchObject({ label: 'Maybe later', className: 'daily-name-cancel' });
    expect(c.closeOnBackdrop).toBe(true);
    expect(c.focusDelayMs).toBe(0);
  });

  test('onSubmit: trims, closes, then onConfirm(name); blank does nothing', () => {
    const onConfirm = jest.fn();
    const c = buildDailyPromptConfig({ prefill: '', onConfirm });
    const close = jest.fn();
    c.primary.onSubmit(['  Ada  '], { invalid: jest.fn(), close });
    expect(close).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Ada');

    const inv = jest.fn(); const close2 = jest.fn(); onConfirm.mockClear();
    c.primary.onSubmit(['   '], { invalid: inv, close: close2 });
    expect(inv).toHaveBeenCalledWith(0);
    expect(close2).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('factory + builder integration (daily contract sanity)', () => {
  beforeEach(() => { loadIndexHtml(); try { localStorage.clear(); } catch {} });
  afterEach(() => { document.body.innerHTML = ''; });

  test('createPromptModal(buildDailyPromptConfig) satisfies the daily DOM contract', () => {
    const onConfirm = jest.fn();
    createPromptModal(buildDailyPromptConfig({ prefill: '', onConfirm }));
    const overlay = document.querySelector('.daily-name-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('input')).not.toBeNull();
    expect(overlay.querySelector('.daily-name-go')).not.toBeNull();
    overlay.querySelector('input').value = '  Ada  ';
    overlay.querySelector('.daily-name-go').click();
    expect(onConfirm).toHaveBeenCalledWith('Ada');
    expect(document.querySelector('.daily-name-overlay')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx jest client-tests/name-prompts.test.js`
Expected: FAIL — builders not exported.

- [ ] **Step 3: Create `public/js/ui/name-prompts.js`**

```js
// public/js/ui/name-prompts.js
//
// WHY (Phase 7.3 MI-02): the 3 name overlays' app-specific config — titles,
// fields, and the exact submit side-effect chains — extracted as PURE,
// deps-injected builders. This is the project's established seam pattern
// (daily-name-prompt.test.js:13-15): app.js's socket-heavy DOMContentLoaded
// is not unit-testable, so the testable logic is pulled into a pure module
// and app.js becomes thin glue. The builders return plain config consumed
// by createPromptModal; they never touch sockets/DOM directly (deps are
// injected) so their side-effect order is pinned by unit tests, which is
// what guarantees the zero-behaviour-change refactor.

// showNamePrompt — invite-link join (room code known, name unknown).
// Legacy order preserved EXACTLY: setItem → playerNameInput → overlay.remove
// (close) → showScreen → emit joinLobby → history.replaceState.
export function buildNamePromptConfig({ roomCode, deps }) {
  return {
    title: 'Join Game',
    subtitle: 'Room ' + roomCode,
    fields: [{ placeholder: 'Enter your name', maxLength: 24, gap: '1rem' }],
    primary: {
      label: 'Join Game',
      onSubmit([rawName], { invalid, close }) {
        const name = rawName.trim();
        if (!name) { invalid(0); return; } // legacy: cue + keep open, no effects
        deps.localStorage.setItem('mm_playerName', name);
        const pn = deps.getPlayerNameInput();
        if (pn) pn.value = name;
        close(); // == legacy overlay.remove()
        deps.showScreen('lobby');
        deps.socket.emit('joinLobby', {
          name, lobbyId: roomCode, stableId: deps.getStableId(),
        });
        deps.history.replaceState({}, '', deps.getPathname());
      },
    },
    closeOnBackdrop: false, // legacy showNamePrompt had NO backdrop escape
    focusDelayMs: 100,
  };
}

// showJoinPrompt — manual join (name + optional room code).
export function buildJoinPromptConfig({ deps }) {
  const prefill = deps.localStorage.getItem('mm_playerName') || '';
  return {
    title: 'Join a Room', // no subtitle → factory applies --solo title spacing
    fields: [
      { label: 'Your Name', placeholder: 'Enter your name', value: prefill, maxLength: 24, gap: '1rem' },
      { label: 'Room Code', placeholder: 'Leave blank to create new', maxLength: 6, uppercase: true, gap: '1.5rem' },
    ],
    primary: {
      label: 'Join Game',
      onSubmit([rawName, rawCode], { invalid, close }) {
        const name = rawName.trim();
        const code = rawCode.trim().toUpperCase(); // legacy uppercased the code
        if (!name) { invalid(0); return; }
        deps.localStorage.setItem('mm_playerName', name);
        const pn = deps.getPlayerNameInput();
        if (pn) pn.value = name;
        close();
        deps.prepareAudio(); // legacy: prepareAudio BEFORE showScreen/emit
        deps.showScreen('lobby');
        deps.socket.emit('joinLobby', {
          name, lobbyId: code, stableId: deps.getStableId(),
        });
      },
    },
    secondary: { label: 'Back', onClick({ close }) { close(); } },
    closeOnBackdrop: true,
    focusDelayMs: 100,
    // legacy: focus the code field if the name was prefilled, else the name.
    focusIndex: prefill ? 1 : 0,
  };
}

// showDailyNamePrompt — HL-01 socket-free seam: caller owns the emit via
// onConfirm. Class names are a test contract (daily-name-prompt.test.js).
export function buildDailyPromptConfig({ prefill = '', onConfirm } = {}) {
  return {
    overlayClass: 'daily-name-overlay',
    title: '🗓️ Daily Challenge',
    subtitle: 'Pick a name to track your score on the daily leaderboard.',
    fields: [{ placeholder: 'Enter your name', value: prefill || '', maxLength: 24, gap: '1rem' }],
    primary: {
      label: 'Start Daily Challenge',
      className: 'daily-name-go',
      onSubmit([rawName], { invalid, close }) {
        const name = rawName.trim();
        if (!name) { invalid(0); return; }
        close();
        if (onConfirm) onConfirm(name); // socket-free — caller emits
      },
    },
    secondary: { label: 'Maybe later', className: 'daily-name-cancel', onClick({ close }) { close(); } },
    closeOnBackdrop: true,
    focusDelayMs: 0, // no entrance transition → focus synchronously
  };
}
```

- [ ] **Step 4: Add the barrel export** — in `public/js/ui.js`, after the `./ui/modal.js` line added in Task 0, add:

```js
export * from './ui/name-prompts.js'; // Phase 7.3: per-prompt config builders (MI-02)
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx jest client-tests/name-prompts.test.js`
Expected: PASS (all).

- [ ] **Step 6: Full suite**

Run: `npx jest`
Expected: green; additive. `daily-name-prompt.test.js` still passes (unchanged — `showDailyNamePrompt` not yet rewired; that's Task 2).

- [ ] **Step 7: Verify branch, then commit**

```bash
cd C:/mm-phase7-3 && [ "$(git branch --show-current)" = "phase7-3-design-system-hardening" ] && \
git add public/js/ui/name-prompts.js public/js/ui.js client-tests/name-prompts.test.js && \
git -c core.safecrlf=false commit -m "Phase 7.3 (1): pure per-prompt config builders + tests (MI-02)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Cutover — wire the 3 wrappers + pixel-parity CSS, delete the cssText

**Goal:** Replace the three prompt bodies with one-line factory calls and add the `.modal-*--prompt` CSS that reproduces the legacy pixels exactly — shipped together so there is no broken intermediate (prompts never render unstyled). Zero visual/behaviour change; the existing `daily-name-prompt.test.js` is the untouched contract guard.

**Files:**
- Modify: `public/js/app.js:284-417` (`showNamePrompt`, `showJoinPrompt`, and the `heroCodeBtn`/`checkUrlParams` call sites stay identical)
- Modify: `public/js/ui/ui-panels.js:429-517` (`showDailyNamePrompt` body + the WHY comment block)
- Modify: `public/css/04-modals.css` (append after the modal-system block, ~`:233`)
- Guard test (unmodified): `client-tests/daily-name-prompt.test.js`

**Acceptance Criteria:**
- [ ] `showNamePrompt(roomCode)` body == build a `deps` object from the app.js closure + `createPromptModal(buildNamePromptConfig({ roomCode, deps }))`. All legacy cssText removed.
- [ ] `showJoinPrompt()` body == `createPromptModal(buildJoinPromptConfig({ deps }))`. All legacy cssText removed.
- [ ] `showDailyNamePrompt({prefill='',onConfirm}={})` body == `return createPromptModal(buildDailyPromptConfig({ prefill, onConfirm }));` — exported signature, socket-free contract, and `daily-name-overlay`/`daily-name-go`/`daily-name-cancel` class names byte-for-byte preserved. cssText removed. The `429-446` comment updated to state MI-02 is now done (no longer "deferred").
- [ ] `deps` wires real closure refs: `socket`, `showScreen`, `getStableId`, `getPlayerNameInput:()=>playerNameInput`, `prepareAudio`, `getPathname:()=>window.location.pathname`, `history:window.history`, `localStorage:window.localStorage`.
- [ ] `.modal-overlay--prompt`/`.modal-card--prompt` + `.modal-prompt-*` rules in `04-modals.css` reproduce the legacy pixels exactly (table below); they neutralise every `.modal-overlay`/`.modal-card` property that differs (animation, padding, max-width, z-index, backdrop-filter, box-shadow, position).
- [ ] `client-tests/daily-name-prompt.test.js` passes **without any edit**.
- [ ] Full suite green; the six `<link>` order in `index.html` unchanged; no `server.js`/socket/dependency change; no dynamic `.style.*` migrated.
- [ ] WHY comments on every change.

**Verify:** `npx jest client-tests/daily-name-prompt.test.js` → pass (unmodified). `npx jest` → full suite green. Manual/in-browser pixel + behaviour eyeball is **user-side** (jsdom has no layout; this touches the invite-join/Daily render path).

**Pixel-parity table (every new declaration ↔ the legacy cssText it reproduces):**

| Selector | Declarations |
|---|---|
| `.modal-overlay--prompt` | `z-index:1000; padding:0; backdrop-filter:none; -webkit-backdrop-filter:none; animation:none;` (overrides design-system z-200/1.5rem/blur/fadeIn; flex-centering + `rgba(0,0,0,.75)` + fixed/inset inherited from `.modal-overlay` — identical to legacy) |
| `.modal-card--prompt` | `background:var(--surface,#18181b); border:1px solid rgba(255,255,255,0.08); border-radius:1rem; padding:2rem; max-width:340px; width:90%; text-align:center; box-shadow:none; position:static; animation:none;` |
| `.modal-prompt-title` | `margin:0 0 0.25rem; font-size:1.25rem; color:var(--text,#f8fafc);` |
| `.modal-prompt-title--solo` | `margin:0 0 1.5rem;` (join — no subtitle) |
| `.modal-prompt-subtitle` | `margin:0 0 1.5rem; color:var(--text-muted,#94a3b8); font-size:0.9rem;` |
| `.modal-prompt-label` | `display:block; text-align:left; font-size:0.8rem; font-weight:600; color:var(--text-muted,#94a3b8); margin-bottom:0.35rem; letter-spacing:0.03em;` |
| `.modal-prompt-input` | `width:100%; padding:0.75rem 1rem; border-radius:0.5rem; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.05); color:var(--text,#f8fafc); font-size:1rem; box-sizing:border-box; margin-bottom:1rem; outline:none; font-family:inherit;` |
| `.modal-prompt-input--gap-lg` | `margin-bottom:1.5rem;` |
| `.modal-prompt-input--upper` | `text-transform:uppercase;` |
| `.modal-prompt-btn` | `width:100%; padding:0.75rem; border-radius:0.5rem; cursor:pointer; font-family:inherit;` |
| `.modal-prompt-btn--primary` | `border:none; background:var(--accent,#818cf8); color:#fff; font-size:1rem; font-weight:600;` |
| `.modal-prompt-btn--stacked` | `margin-bottom:0.75rem;` |
| `.modal-prompt-btn--secondary` | `border:1px solid rgba(255,255,255,0.1); background:transparent; color:var(--text-muted,#94a3b8); font-size:0.9rem;` |

**Steps:**

- [ ] **Step 1: Confirm the guard is green BEFORE refactor**

Run: `npx jest client-tests/daily-name-prompt.test.js`
Expected: PASS (5 tests). This is the contract guard; it must stay green through the refactor with **zero edits** to the test file. (No new failing test is written for this task: the new behaviour was already test-driven in Tasks 0–1; Task 2 is a pure wiring cutover whose correctness is proven by the Task 0/1 suites + this unmodified guard staying green — the project's validated refactor-under-existing-tests discipline, same precedent as the 7.2 app.js wiring.)

- [ ] **Step 2: Append the pixel-parity CSS to `public/css/04-modals.css`**

Find the end of the modal-system block (after `.modal-section-title { … }`, ~`:233`, before `/* HOW TO PLAY */`). Insert:

```css
/* =============================================================
   Phase 7.3 (MI-02 / DS-01) PROMPT MODAL — compact modifier
   The 3 name overlays (showNamePrompt/showJoinPrompt/
   showDailyNamePrompt) were built with ~28 hardcoded .style.cssText
   assignments that bypassed this modal system. They now use
   createPromptModal, which emits .modal-overlay/.modal-card PLUS this
   --prompt modifier. WHY a modifier (not the bare modal classes): the
   legacy prompts are visually different from the big modals (340px vs
   min(640px,90vw), 2rem vs 2.5rem, z-1000 vs z-200, NO entrance
   animation, NO backdrop blur) and showDailyNamePrompt depends on the
   absence of a transition (it focuses synchronously). This block
   reproduces the legacy pixels byte-for-byte so MI-02/DS-01 is a strict
   zero-behaviour-change refactor. Visual unification with the big modals
   is deliberately deferred to a later visual phase. Lives in
   04-modals.css (the modal-system home) — the six-partial cascade order
   is unchanged.
   ============================================================= */
.modal-overlay--prompt {
  /* legacy overlay: z-index:1000; no padding; no blur; no animation */
  z-index: 1000;
  padding: 0;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  animation: none;
}
.modal-card--prompt {
  /* legacy card cssText, verbatim */
  background: var(--surface, #18181b);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 1rem;
  padding: 2rem;
  max-width: 340px;
  width: 90%;
  text-align: center;
  box-shadow: none;
  position: static;
  animation: none;
}
.modal-prompt-title {
  margin: 0 0 0.25rem;
  font-size: 1.25rem;
  color: var(--text, #f8fafc);
}
/* join had no subtitle → larger title bottom-margin */
.modal-prompt-title--solo { margin: 0 0 1.5rem; }
.modal-prompt-subtitle {
  margin: 0 0 1.5rem;
  color: var(--text-muted, #94a3b8);
  font-size: 0.9rem;
}
.modal-prompt-label {
  display: block;
  text-align: left;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted, #94a3b8);
  margin-bottom: 0.35rem;
  letter-spacing: 0.03em;
}
.modal-prompt-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text, #f8fafc);
  font-size: 1rem;
  box-sizing: border-box;
  margin-bottom: 1rem;
  outline: none;
  font-family: inherit;
}
.modal-prompt-input--gap-lg { margin-bottom: 1.5rem; }
.modal-prompt-input--upper { text-transform: uppercase; }
.modal-prompt-btn {
  width: 100%;
  padding: 0.75rem;
  border-radius: 0.5rem;
  cursor: pointer;
  font-family: inherit;
}
.modal-prompt-btn--primary {
  border: none;
  background: var(--accent, #818cf8);
  color: #fff;
  font-size: 1rem;
  font-weight: 600;
}
/* primary gets a bottom margin only when a secondary button follows */
.modal-prompt-btn--stacked { margin-bottom: 0.75rem; }
.modal-prompt-btn--secondary {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: var(--text-muted, #94a3b8);
  font-size: 0.9rem;
}
```

- [ ] **Step 3a: Add the barrel imports to `public/js/app.js`**

`app.js` already imports the ui barrel as a multi-line destructure (`app.js:16-31`, `import { … } from './ui.js';`). Add the three new names to it. Exact edit — change this line (`app.js:20`):

```js
  submissionPill, // Phase 7.2 (CG-03): keeps submitted title visible during TMDB round-trip
```

to:

```js
  submissionPill, // Phase 7.2 (CG-03): keeps submitted title visible during TMDB round-trip
  createPromptModal, buildNamePromptConfig, buildJoinPromptConfig, // Phase 7.3 (MI-02): shared prompt-modal factory + builders
```

(`./ui.js` re-exports `modal.js` + `name-prompts.js` from Tasks 0–1; app.js is a leaf consumer → no import cycle.)

- [ ] **Step 3b: Rewrite `showNamePrompt` + `showJoinPrompt` in `public/js/app.js`**

Replace the entire body of both functions (`app.js:290-417`, from `function showNamePrompt(roomCode) {` through the closing `}` of `showJoinPrompt` — but NOT the surrounding section comment `286-289` nor the `419+` URL-params block) with exactly:

```js
  // Phase 7.3 (MI-02): these were two ~60-line overlays built with
  // hardcoded .style.cssText. They are now thin glue over the shared
  // createPromptModal factory + pure config builders (public/js/ui/
  // modal.js, name-prompts.js). Behaviour/pixels are byte-for-byte
  // preserved by the builders + the .modal-*--prompt CSS; this file just
  // injects the app-level deps the builders need — those stay here so the
  // builders remain pure and unit-tested. `socket` is the closure const
  // from `const socket = initSocket()` (app.js:47); `showScreen` /
  // `playerNameInput` are ui-barrel imports; `getStableId` / `prepareAudio`
  // are utils.js imports — all in scope here, exactly as the legacy bodies
  // referenced them.
  const promptDeps = {
    socket,
    showScreen,
    getStableId,
    prepareAudio,
    getPlayerNameInput: () => playerNameInput,
    getPathname: () => window.location.pathname,
    history: window.history,
    localStorage: window.localStorage,
  };

  function showNamePrompt(roomCode) {
    createPromptModal(buildNamePromptConfig({ roomCode, deps: promptDeps }));
  }

  function showJoinPrompt() {
    createPromptModal(buildJoinPromptConfig({ deps: promptDeps }));
  }
```

Do NOT change the call sites (`heroCodeBtn?.addEventListener('click', () => showJoinPrompt());` at `:284`; `showNamePrompt(code);` in `checkUrlParams` at `:437`). Both `showNamePrompt`/`showJoinPrompt` are defined inside the `DOMContentLoaded` callback (after `const socket = initSocket();` at `:47`), and are only *invoked* from event handlers / `checkUrlParams()` that run after init, so `const promptDeps` placed immediately above `showNamePrompt` is in scope and defined before any invocation.

- [ ] **Step 4a: Add the sibling imports to `public/js/ui/ui-panels.js`**

`ui-panels.js` has a top-of-file import group ending at `:14` (`import { attachPosterFallback } from './ui-dom.js';`). Add two lines immediately after `:14`:

```js
// Phase 7.3 (MI-02): the daily prompt is now the shared modal factory.
// Direct sibling imports (not the ./ui.js barrel) keep a one-way DAG —
// modal.js imports nothing, name-prompts.js imports nothing — so there is
// no barrel cycle (same discipline as 7.2's feedback.js).
import { createPromptModal } from './modal.js';
import { buildDailyPromptConfig } from './name-prompts.js';
```

- [ ] **Step 4b: Rewrite `showDailyNamePrompt` + its comment in `public/js/ui/ui-panels.js`**

Replace the comment block `429-446` and the function body `447-517` with exactly:

```js
// =========================================================================
// DAILY NAME PROMPT (HL-01)
// =========================================================================
// WHY: the hero "Today's Daily Challenge" CTA used to read its name from
// #player-name — an input that only exists on the (hidden) lobby screen.
// A first-time visitor (no saved name) therefore got a full-screen "enter
// a name first" notification plus a focus() on an off-screen field: a
// dead-end on a primary entry point. This inline prompt lets a name-less
// player start the Daily in place. It is intentionally socket-free: the
// caller owns the `startDailyChallenge` emit (pure, unit-testable seam —
// daily-name-prompt.test.js). Phase 7.3 (MI-02): the overlay markup is now
// the shared createPromptModal factory (this used to be ~70 lines of
// hardcoded .style.cssText that deliberately mirrored showNamePrompt/
// showJoinPrompt to avoid a third divergent look — that divergence is now
// resolved; all three share one factory + the .modal-*--prompt CSS, with
// the daily-name-* class names preserved as the test contract).
export function showDailyNamePrompt({ prefill = '', onConfirm } = {}) {
  return createPromptModal(buildDailyPromptConfig({ prefill, onConfirm }));
}
```

The exported name and signature `showDailyNamePrompt({ prefill = '', onConfirm } = {})` are byte-for-byte unchanged, so `client-tests/daily-name-prompt.test.js`'s `import { showDailyNamePrompt } from '../public/js/ui.js';` keeps working with zero test edits.

- [ ] **Step 5: Delete confirmation** — grep the three sites to prove no `.style.cssText` / hardcoded overlay style remains:

Run: `npx jest` first (green), then verify via review that `app.js` and `ui-panels.js` no longer contain the legacy `overlay.style.cssText`/`card.style.cssText`/`btn.style.cssText` lines for these prompts (the only remaining `.style` on these paths is the dynamic `borderColor` cue, which now lives in `modal.js`).

- [ ] **Step 6: Run the guard + full suite, verify green**

Run: `npx jest client-tests/daily-name-prompt.test.js` → PASS (unmodified).
Run: `npx jest` → all suites green; ≥ 48 suites / ≥ 354 tests. No existing test edited.

- [ ] **Step 7: Verify branch, then commit**

```bash
cd C:/mm-phase7-3 && [ "$(git branch --show-current)" = "phase7-3-design-system-hardening" ] && \
git add public/js/app.js public/js/ui/ui-panels.js public/css/04-modals.css && \
git -c core.safecrlf=false commit -m "Phase 7.3 (2): consolidate 3 name overlays onto createPromptModal + pixel-parity CSS (MI-02/DS-01)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Self-elim CSS hygiene (`public/css/06-states-anim.css`)

**Goal:** Delete the orphaned `.self-elim-could` rule, style the currently-unstyled 7.1 `.self-elim-outs*`/`.self-elim-bridge` classes, and fix the single-child `.self-elim-grid` timeout asymmetry — guarded by a DOM-contract test pinning why each edit is safe/correct.

**Files:**
- Modify: `public/css/06-states-anim.css` (delete `:1082-1093`; add outs styling; add single-child grid rule)
- Test: `client-tests/self-elim-hygiene.test.js` (Create)

**Acceptance Criteria:**
- [ ] Orphaned `.self-elim-could` rule + its comment block (`06-states-anim.css:1082-1093`) deleted; no other rule touched.
- [ ] `.self-elim-outs`, `.self-elim-outs-label`, `.self-elim-outs-row`, `.self-elim-bridge` have rules consistent with the existing self-elim palette (the green `rgba(52,211,153,…)`/`#34d399` "you had outs" accent the deleted `.self-elim-could` used); legible; no new motion (honours `prefers-reduced-motion` by adding none).
- [ ] Single-child `.self-elim-grid` (timeout card — only `.self-elim-col--needed`) is centered, not left-aligned; the two-column case and the `@media (max-width:540px){.self-elim-grid{grid-template-columns:1fr}}` (`:110-112`) are unchanged.
- [ ] No JS change. `client-tests/self-elim-hygiene.test.js` passes; `self-elim-aftercare.test.js` + `learning-breakdown.test.js` pass **unmodified**.
- [ ] WHY comments on every change.

**Verify:** `npx jest client-tests/self-elim-hygiene.test.js client-tests/self-elim-aftercare.test.js client-tests/learning-breakdown.test.js` → pass. `npx jest` → full suite green. CSS pixel correctness (the one intentional bounded visual delta + the grid centering) is **user-side** in-browser (jsdom has no layout engine).

**Steps:**

- [ ] **Step 1: Write the failing test** — create `client-tests/self-elim-hygiene.test.js`:

```js
/**
 * @jest-environment jsdom
 */
// Phase 7.3 CSS hygiene guard. CSS has no jsdom-observable layout, so this
// test pins the DOM *contract* the CSS edits rely on:
//  - .self-elim-could is never emitted (verified orphan → safe to delete)
//  - the 7.1 .self-elim-outs*/-bridge classes ARE emitted (correct style targets)
//  - the timeout card renders exactly ONE .self-elim-col (the :only-child
//    centering target — the asymmetry case)
// It is written first and must pass; it provides lasting regression value
// (fails if a future change reintroduces .self-elim-could or stops emitting
// the outs classes). Visual correctness is verified in-browser (user-side).
const { loadIndexHtml } = require('./fixtures');
import { showSelfEliminationScreen } from '../public/js/ui.js';

const lastEntry = { title: 'Heat', year: 1995, cast: ['Al Pacino', 'Robert De Niro'] };

describe('Phase 7.3 self-elim CSS hygiene — DOM contract', () => {
  beforeEach(() => { loadIndexHtml(); });
  afterEach(() => { document.body.innerHTML = ''; });

  test('orphaned .self-elim-could is never emitted (safe to delete the rule)', () => {
    showSelfEliminationScreen({
      reason: 'No shared cast', lastChainEntry: lastEntry,
      yourGuess: { title: 'Cats', year: 2019, cast: ['x'] },
      outs: [{ title: 'Speed', year: '1994', viaActor: 'Keanu Reeves' }],
    });
    expect(document.querySelector('.self-elim-could')).toBeNull();
  });

  test('the 7.1 outs classes ARE emitted (correct style targets)', () => {
    showSelfEliminationScreen({
      reason: 'No shared cast', lastChainEntry: lastEntry,
      yourGuess: { title: 'Cats', year: 2019, cast: ['x'] },
      outs: [{ title: 'Speed', year: '1994', viaActor: 'Keanu Reeves' }],
    });
    expect(document.querySelector('.self-elim-outs')).not.toBeNull();
    expect(document.querySelector('.self-elim-outs-label')).not.toBeNull();
    expect(document.querySelector('.self-elim-outs-row')).not.toBeNull();
    expect(document.querySelector('.self-elim-bridge')).not.toBeNull();
  });

  test('timeout card renders a single .self-elim-col (the :only-child target)', () => {
    showSelfEliminationScreen({ reason: 'Turn timed out', lastChainEntry: lastEntry, timedOut: true });
    const cols = document.querySelectorAll('.self-elim-grid > .self-elim-col');
    expect(cols.length).toBe(1);
    expect(document.querySelector('.self-elim-col--played')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify status**

Run: `npx jest client-tests/self-elim-hygiene.test.js`
Expected: PASS on the current code (it characterises the existing contract — the orphan is already never emitted, the outs classes are already emitted, the timeout card is already single-col). This is a guard/characterization test (CSS has no unit-observable behaviour); it locks the contract the CSS edits depend on and provides regression value. Proceed to the CSS edits; the test must remain green after them.

- [ ] **Step 3: Delete the orphaned rule** — in `public/css/06-states-anim.css`, delete lines `1082-1093` exactly (the `/* Phase 6a: the "you could have played X" line … */` comment block AND the `.self-elim-could { … }` rule). Verified orphan: the client emits `self-elim-outs*`/`self-elim-bridge` (`ui-notifications.js:134-149`), never `self-elim-could` — 7.1's markup superseded it. Leave the surrounding rules (`@media (hover:none)` block above, the Phase 7.2 submission-pill block below) untouched.

- [ ] **Step 4: Add the outs styling + single-child grid fix** — in `public/css/06-states-anim.css`, append a new block at EOF (after the Phase 7.2 toast-variant block, `:1124`):

```css
/* =============================================================
   Phase 7.3 (CSS hygiene) — self-elim "you had outs" block
   WHY: 7.1 emits .self-elim-outs/-label/-row + .self-elim-bridge
   (ui-notifications.js:134-149) but no rule was ever added, so the
   most actionable line on the card ("You had outs… you were one
   bridge away") rendered as unstyled body text. This finishes 7.1's
   own deferred styling — additive on currently-unstyled elements,
   not a change to already-correct UI. Palette matches the green
   "could have played" accent the (now-deleted) .self-elim-could rule
   used, so the card reads consistently. No animation — the detailed
   card is read material and prefers-reduced-motion must stay a no-op
   here (we add no motion to honour it).
   ============================================================= */
.self-elim-outs {
  margin-top: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  background: rgba(52, 211, 153, 0.10);
  border: 1px solid rgba(52, 211, 153, 0.25);
  text-align: left;
}
.self-elim-outs-label {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #34d399;
  margin-bottom: 0.35rem;
}
.self-elim-outs-row {
  font-size: 0.9rem;
  color: var(--text-main, #f8fafc);
  padding: 0.15rem 0;
}
.self-elim-bridge {
  margin-top: 0.4rem;
  font-size: 0.85rem;
  font-weight: 600;
  font-style: italic;
  color: #34d399;
  text-align: center;
}

/* =============================================================
   Phase 7.3 (CSS hygiene) — single-column self-elim grid
   WHY: .self-elim-grid is `1fr 1fr`, but the timeout card adds only
   the "Needed a connection to" column (ui-notifications.js:122 adds
   "You played" only `if (!timedOut && yourGuess)`). One child in a
   2-col track renders left-aligned with an empty right half — a
   visible asymmetry. Pure-CSS fix: when the grid has a single column
   child, let it span the full track so it's centered. Two-column
   case and the @media max-width:540px 1fr collapse are untouched.
   :only-child is universally supported (no :has() dependency).
   ============================================================= */
.self-elim-col:only-child { grid-column: 1 / -1; }
```

- [ ] **Step 5: Run the guard + siblings + full suite**

Run: `npx jest client-tests/self-elim-hygiene.test.js client-tests/self-elim-aftercare.test.js client-tests/learning-breakdown.test.js`
Expected: all PASS (siblings unmodified).
Run: `npx jest`
Expected: full suite green; ≥ 49 suites / ≥ 357 tests.

- [ ] **Step 6: Verify branch, then commit**

```bash
cd C:/mm-phase7-3 && [ "$(git branch --show-current)" = "phase7-3-design-system-hardening" ] && \
git add public/css/06-states-anim.css client-tests/self-elim-hygiene.test.js && \
git -c core.safecrlf=false commit -m "Phase 7.3 (3): self-elim CSS hygiene — drop orphan, style 7.1 outs, fix grid asymmetry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Post-task: persistence sync (per task, after each commit)

Native Task tools are unavailable in this project — the co-located `docs/superpowers/plans/2026-05-17-design-system-hardening.md.tasks.json` is hand-authored. After each task's review passes and its commit lands, set that task's `"status":"completed"`, bump `"lastUpdated"`, and commit the sync (`Phase 7.3: sync task-persistence — Task N complete`), verifying the branch first. This keeps cross-session resume correct (same discipline validated in 7.1/7.2).

## Final review

After all 4 tasks: dispatch a final most-capable-model (opus) whole-branch holistic review (zero Critical/Important to ship; Minors may be accepted by design with rationale). Then invoke **superpowers-extended-cc:finishing-a-development-branch**: push the branch + `gh pr create` (base `main`, `origin/main`=`57e4599`) are allowed; PR-merge / push-to-main / Render deploy is classifier-gated and **handed to the user**. The PR also carries the spec (`8f44bec`) + this plan/tasks. Worktree preserved until the user merges; post-merge reconcile mirrors 7.1/7.2 (ff local main, `cmd /c rmdir` the node_modules junction, `git worktree remove`, delete branch, correct + update memory — including dropping the stale "malformed `\*` comment" 7.3-deferral note). Real-boot/in-browser eyeball (invite-join + Daily render path + the prompt pixels + the self-elim outs styling) is **user-side**.

---

## Self-Review (against the spec)

**Spec coverage:** §0 MI-02 → Tasks 0–2. §0 DS-01 slice (prompt cssText) → Task 2 deletes all ~28. §1.3/§5 CSS hygiene (orphan delete / style 7.1 classes / grid fix) → Task 3; dropped items (malformed comment, `.copy-toast--info`) correctly absent. §2 architecture (pure `modal.js`, pure `name-prompts.js` seam, barrel, thin wrappers, CSS in 04-modals.css) → Tasks 0–2 File Structure. §3 factory contract → Task 0 `createPromptModal` signature/behaviour. §4 per-prompt mapping → Task 1 builders (exact side-effect order, `daily-name-*` hooks, focusIndex). §6 testing (existing suite untouched as guard; new factory + builder tests; CSS contract test) → Tasks 0/1/3 tests + the unmodified `daily-name-prompt.test.js` guard in Task 2. §7 boundaries (dynamic `.style` excluded — the `borderColor` cue stays in JS; DS-01 long tail deferred) → stated in Task 0 comment + Task 2. §8 guardrails (branch-verify before every commit, WHY comments, no server/socket/dep change, cascade order, real-boot user-side) → every commit step + Final review. §9 acceptance criteria → distributed across task Acceptance Criteria.

**Placeholder scan:** No TBD/TODO/"similar to"/vague-error-handling. Every code step shows complete code; every CSS value is concrete and traced to legacy cssText; every test is full.

**Type/name consistency:** `createPromptModal`, `buildNamePromptConfig`, `buildJoinPromptConfig`, `buildDailyPromptConfig`, config keys (`overlayClass`,`title`,`subtitle`,`fields[].{label,placeholder,value,maxLength,uppercase,gap}`,`primary.{label,className,onSubmit}`,`secondary.{label,className,onClick}`,`closeOnBackdrop`,`focusDelayMs`,`focusIndex`), the `{invalid, close}` submit helpers, and `deps.{socket,showScreen,getStableId,prepareAudio,getPlayerNameInput,getPathname,history,localStorage}` are used identically across Tasks 0/1/2 and their tests. CSS class names (`modal-overlay--prompt`,`modal-card--prompt`,`modal-prompt-title[--solo]`,`modal-prompt-subtitle`,`modal-prompt-label`,`modal-prompt-input[--gap-lg|--upper]`,`modal-prompt-btn[--primary|--secondary|--stacked]`) match between the factory (Task 0) and the parity CSS (Task 2). No drift found.
