# Phase 7.8c — QR Scan-to-Join Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the lobby's existing `?room=CODE` invite URL as a scannable SVG QR in `.lobby-head` of both `#waiting-room` and `#team-screen` panels, so mobile players join by camera-scan instead of typing.

**Architecture:** Vendor a tiny pure-JS QR encoder (`qrcode-generator` v1.4.4, MIT, ~10kb) at `public/js/lib/qrcode.js`. New `public/js/ui/ui-qr.js` wrapper exports `renderQR(mountEl, joinUrl)` + `clearQR(mountEl)`. Called from `renderLobby()` (ui-render.js:155) and `renderTeamScreen()` (ui-render.js:396) with the lobby's join URL. Memoization via `mountEl.dataset.qrUrl` skips redundant re-encoding on every render. URL format consolidated into `makeJoinUrl(code)` helper exported from `app.js` (pure refactor of inline duplications at L122 and L395).

**Tech Stack:** Vanilla JS (no build). Vendored qrcode-generator v1.4.4. Jest + jsdom for tests. CSS-only responsive (`@media`). Service worker untouched.

**Spec:** [docs/superpowers/specs/2026-05-20-qr-scan-to-join-design.md](../specs/2026-05-20-qr-scan-to-join-design.md) (committed @ `9a508d4`).

**Branch:** `phase7-8c-qr-scan-to-join` (off `origin/main` @ `d1c5e9d`).

**Baseline tests:** 561 green. **Target:** 570 green (+9 new; zero pre-existing tests edited).

---

## File Structure

**Created (3 new files):**
- `public/js/lib/qrcode.js` — vendored qrcode-generator v1.4.4 verbatim (~10kb)
- `public/js/ui/ui-qr.js` — thin module: `renderQR`, `clearQR` (~35 LOC)
- `client-tests/render-qr.test.js` — unit + integration tests (~140 LOC, 8 tests total: 7 unit + 1 classic integration)

**Modified (6 files):**
- `public/index.html` — add `<script src="/js/lib/qrcode.js"></script>` near L806 (before the module script); add `<div class="lobby-qr">…</div>` inside `#waiting-room`'s `.lobby-head` (between `.head-title` and `.public-toggle`, around L260); add same div inside `#team-screen`'s `.lobby-head` (around L388)
- `public/js/app.js` — export `makeJoinUrl(code)`; replace inline `window.location.origin + '?room=' + code` at L122 + L395
- `public/js/ui/ui-render.js` — import `renderQR` + `makeJoinUrl`; call from `renderLobby()` (~L155) and `renderTeamScreen()` (~L396)
- `client-tests/fixtures.js` — add `loadVendoredQrLib()` helper + export
- `client-tests/render-team-screen.test.js` — add ONE integration test for `#team-screen-qr` (additive only; existing 12 tests untouched)
- `public/css/02-hero-lobby.css` — append `.lobby-qr` section (T2)

---

## Task 0: Vendor lib + `ui-qr.js` module + unit tests

**Goal:** Land the QR encoder + pure wrapper with full unit test coverage. No DOM integration yet — tests synthesize mount elements via `document.createElement`.

**Files:**
- Create: `public/js/lib/qrcode.js`
- Create: `public/js/ui/ui-qr.js`
- Create: `client-tests/render-qr.test.js`
- Modify: `client-tests/fixtures.js`

**Acceptance Criteria:**
- [ ] `public/js/lib/qrcode.js` exists, sourced from qrcode-generator@1.4.4 npm package, unmodified
- [ ] `loadVendoredQrLib()` in fixtures.js makes `window.qrcode` a function in jsdom
- [ ] `renderQR(el, url)` mounts an `<svg>` inside `el`
- [ ] `el.dataset.qrUrl` equals the encoded URL after render
- [ ] Calling `renderQR(el, sameUrl)` twice does NOT replace the SVG node (memo path proven by node identity)
- [ ] Calling `renderQR(el, differentUrl)` DOES replace the SVG node
- [ ] `clearQR(el)` empties the element and removes `dataset.qrUrl`
- [ ] `renderQR` is a silent no-op when `window.qrcode` is missing (delete + assert no throw + no DOM change)
- [ ] Encoded SVG has a `viewBox` attribute and non-empty inner content (deterministic sanity)
- [ ] 7 unit tests in `render-qr.test.js`, all green
- [ ] Pre-existing 561 tests still green → suite 568 total

**Verify:**
```
npx jest client-tests/render-qr.test.js --verbose
```
→ 7 passing.

```
npm test --silent
```
→ 568 green (561 + 7).

**Steps:**

- [ ] **Step 1: Vendor `qrcode-generator` v1.4.4 to `public/js/lib/qrcode.js`**

  Download the unminified source from npm CDN so vendor inspection is trivial:
  ```
  mkdir -p public/js/lib
  curl -fLo public/js/lib/qrcode.js https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js
  ```

  Verify size + first lines:
  ```
  ls -lh public/js/lib/qrcode.js     # expect ~10kb
  head -3 public/js/lib/qrcode.js    # expect UMD wrapper header
  ```

  **Do not edit the vendored file.** If for any reason the file is missing or corrupted, halt and request the file from the user.

- [ ] **Step 2: Add `loadVendoredQrLib()` helper to `client-tests/fixtures.js`**

  Open `client-tests/fixtures.js`. After the existing `loadIndexHtml()` function (currently ending at L30), add:

  ```js
  // Phase 7.8c — load the vendored qrcode-generator into the jsdom global so
  // tests can exercise the real encoder path. The vendored UMD assigns
  // `var qrcode = ...` at top level; in a browser that becomes window.qrcode.
  // In jsdom we use indirect eval (0, eval) to evaluate in global scope so
  // the var lands on the jsdom window instead of inside a local function frame.
  function loadVendoredQrLib() {
    // Idempotent: skip if already loaded by a prior test in the same worker.
    if (typeof window.qrcode === 'function') return;
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'lib', 'qrcode.js'),
      'utf8'
    );
    // Indirect-eval form: (0, eval) breaks the local-scope binding so the
    // script evaluates in the global scope (= jsdom window). Top-level
    // `var qrcode` in the vendored file becomes window.qrcode.
    (0, eval)(src);
  }
  ```

  Update the `module.exports` block at the bottom of fixtures.js to include the new helper:
  ```js
  module.exports = {
    loadIndexHtml,
    makePlayer,
    makeWaitingState,
    loadVendoredQrLib,   // Phase 7.8c — vendored QR encoder loader
  };
  ```

  (The exact existing exports may differ slightly — keep them all and add `loadVendoredQrLib` to the list.)

- [ ] **Step 3: Write the failing unit tests in `client-tests/render-qr.test.js`**

  Create the new file with all 7 unit tests:

  ```js
  /**
   * @jest-environment jsdom
   */
  // Phase 7.8c — pure-unit tests for ui-qr.js. Tests synthesize their own
  // mount elements via document.createElement. Real-lobby-DOM integration
  // tests land in T1 after the lobby-qr <div>s exist in index.html.

  const { loadVendoredQrLib } = require('./fixtures');
  import { renderQR, clearQR } from '../public/js/ui/ui-qr.js';

  beforeAll(() => {
    // Make window.qrcode available in jsdom — matches what the production
    // <script src="/js/lib/qrcode.js"> does on a real page load.
    loadVendoredQrLib();
  });

  describe('renderQR / clearQR — pure unit', () => {

    test('renderQR mounts an SVG inside the target element', () => {
      const el = document.createElement('div');
      renderQR(el, 'https://example.com?room=ABCDEF');
      // The vendored encoder emits a single <svg> with QR cells inside.
      expect(el.querySelector('svg')).not.toBeNull();
    });

    test('renderQR sets dataset.qrUrl to the encoded URL', () => {
      const el = document.createElement('div');
      renderQR(el, 'https://example.com?room=TEST01');
      expect(el.dataset.qrUrl).toBe('https://example.com?room=TEST01');
    });

    test('renderQR with same URL twice does NOT replace the SVG node', () => {
      const el = document.createElement('div');
      renderQR(el, 'https://example.com?room=SAME01');
      const firstSvg = el.querySelector('svg');
      renderQR(el, 'https://example.com?room=SAME01');
      const secondSvg = el.querySelector('svg');
      // Memo path: same URL → renderQR returns early → SVG node identity
      // is preserved. If memo breaks, innerHTML is reassigned and a new
      // SVG node would be created (different identity → test fails).
      expect(secondSvg).toBe(firstSvg);
    });

    test('renderQR with a different URL replaces the SVG node', () => {
      const el = document.createElement('div');
      renderQR(el, 'https://example.com?room=FIRST');
      const firstSvg = el.querySelector('svg');
      renderQR(el, 'https://example.com?room=SECOND');
      const secondSvg = el.querySelector('svg');
      // Different URL → memo doesn't hit → re-encode → new SVG node.
      expect(secondSvg).not.toBe(firstSvg);
      expect(el.dataset.qrUrl).toBe('https://example.com?room=SECOND');
    });

    test('clearQR empties the element and removes dataset.qrUrl', () => {
      const el = document.createElement('div');
      renderQR(el, 'https://example.com?room=CLEAR');
      expect(el.children.length).toBeGreaterThan(0);
      clearQR(el);
      expect(el.children.length).toBe(0);
      expect(el.dataset.qrUrl).toBeUndefined();
    });

    test('renderQR is a silent no-op when window.qrcode is missing', () => {
      // Save + delete so we can restore for any subsequent tests in the file.
      const saved = window.qrcode;
      delete window.qrcode;
      const el = document.createElement('div');
      // Must not throw, must not mount any DOM, must not set the dataset.
      expect(() => renderQR(el, 'https://example.com?room=X')).not.toThrow();
      expect(el.children.length).toBe(0);
      expect(el.dataset.qrUrl).toBeUndefined();
      window.qrcode = saved;
    });

    test('encoded SVG has a viewBox attribute and non-empty content', () => {
      const el = document.createElement('div');
      renderQR(el, 'https://example.com?room=SANITY');
      const svg = el.querySelector('svg');
      expect(svg).not.toBeNull();
      // viewBox is set by createSvgTag — looks like "0 0 N N" for a square QR.
      // We don't pin exact dimensions (lib version may shift cell count) —
      // only that the attribute exists and has 4 space-separated values.
      const viewBox = svg.getAttribute('viewBox');
      expect(viewBox).toBeTruthy();
      expect(viewBox.split(' ').length).toBe(4);
      // The svg must have rendered cells, not just be empty.
      expect(svg.innerHTML.length).toBeGreaterThan(0);
    });

  });
  ```

- [ ] **Step 4: Run jest to confirm the tests fail (TDD red)**

  ```
  npx jest client-tests/render-qr.test.js
  ```
  Expected: 7 failures. Errors should reference `renderQR` / `clearQR` being undefined (module file doesn't exist yet).

- [ ] **Step 5: Write `public/js/ui/ui-qr.js`**

  Create the new module with the full implementation:

  ```js
  // public/js/ui/ui-qr.js
  // Phase 7.8c — thin wrapper around the vendored qrcode-generator lib.
  // Pure: takes a DOM element and a URL string, paints an SVG QR inside.
  // No game-state, socket, or lobby-semantics coupling.

  // Renders the QR. Memoized via mountEl.dataset.qrUrl — if the URL matches
  // the last-rendered URL on this mount node, the encode is skipped.
  // Silent no-op when window.qrcode is missing (vendored lib failed to load,
  // e.g. offline PWA cold-start). The room code text is the existing fallback.
  export function renderQR(mountEl, joinUrl) {
    if (typeof window.qrcode !== 'function') return;
    if (mountEl.dataset.qrUrl === joinUrl) return;

    // qrcode(typeNumber, errorCorrectionLevel):
    // - typeNumber=0 → lib chooses the smallest QR symbol that fits the data
    // - 'M'          → ~15% damage tolerance; standard camera-scan default
    const qr = window.qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();
    // createSvgTag returns an HTML string like <svg viewBox="..."><rect/>...</svg>.
    // cellSize=4 / margin=0: outer .lobby-qr-svg CSS sizes the result via viewBox
    // so the inline dimensions here don't matter.
    mountEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
    mountEl.dataset.qrUrl = joinUrl;
  }

  // Empties the mount element and clears the memo cache key. Currently
  // unused by render*Lobby() — kept for symmetry with renderQR and for
  // future lobby-exit cleanup if it ever becomes necessary.
  export function clearQR(mountEl) {
    mountEl.textContent = '';
    delete mountEl.dataset.qrUrl;
  }
  ```

- [ ] **Step 6: Run jest — confirm green**

  ```
  npx jest client-tests/render-qr.test.js --verbose
  ```
  Expected: 7 passing.

- [ ] **Step 7: Run the full suite**

  ```
  npm test --silent
  ```
  Expected: 568 green (561 baseline + 7 new). Pre-existing tests unchanged.

- [ ] **Step 8: Commit Task 0**

  ```
  git add public/js/lib/qrcode.js public/js/ui/ui-qr.js client-tests/render-qr.test.js client-tests/fixtures.js
  git commit -m "Phase 7.8c T0: vendor qrcode-generator + ui-qr module + 7 unit tests"
  ```

---

## Task 1: DOM additions + `makeJoinUrl` extraction + render wiring + integration tests

**Goal:** Wire the QR encoder into `renderLobby()` and `renderTeamScreen()`, add the `.lobby-qr` mount divs to both lobby panels' `.lobby-head`, extract the `makeJoinUrl()` helper, and prove integration with 2 new tests.

**Files:**
- Modify: `public/index.html` (3 inserts: 1 `<script>` tag + 2 `.lobby-qr` divs)
- Modify: `public/js/app.js` (export `makeJoinUrl`; replace L122 + L395 inline duplications)
- Modify: `public/js/ui/ui-render.js` (import; call from `renderLobby` ~L155 and `renderTeamScreen` ~L396)
- Modify: `client-tests/render-team-screen.test.js` (add 1 integration test, additive)
- Modify: `client-tests/render-qr.test.js` (add 1 integration test for `#waiting-room-qr`)

**Acceptance Criteria:**
- [ ] `<script src="/js/lib/qrcode.js"></script>` present in `index.html` immediately BEFORE the existing module script (around L806)
- [ ] `#waiting-room .lobby-head` contains `<div class="lobby-qr" id="waiting-room-qr">…</div>` BETWEEN `.head-title` and `.public-toggle`
- [ ] `#team-screen .lobby-head` contains `<div class="lobby-qr" id="team-screen-qr">…</div>` as the 2nd child of `.lobby-head`
- [ ] `app.js` exports `makeJoinUrl(code)`; L122 + L395 inline `window.location.origin + '?room=' + code` replaced with `makeJoinUrl(code)`; output byte-identical
- [ ] `ui-render.js` imports `renderQR` from `./ui-qr.js` and `makeJoinUrl` from `../app.js`
- [ ] `renderLobby(state, mySocketId)` calls `renderQR(qrMount, makeJoinUrl(state.id))` when `state.id` is present and `qrMount` (`#waiting-room-qr .lobby-qr-svg`) exists
- [ ] `renderTeamScreen()` mirrors the call against `#team-screen-qr .lobby-qr-svg`
- [ ] 1 new integration test in `render-team-screen.test.js` asserts SVG mounts in `#team-screen-qr` when team mode renders
- [ ] 1 new integration test in `render-qr.test.js` asserts SVG mounts in `#waiting-room-qr` when classic mode renders
- [ ] **Sacrosanct tests stay byte-identical and green:** `render-lobby.test.js`, `red-carpet.test.js`, `red-carpet-render.test.js`, `red-carpet-seat-table.test.js`, `seat-builder.test.js`, and all 12 existing tests in `render-team-screen.test.js`
- [ ] Suite: 570 green (561 + 9)

**Verify:**
```
npm test --silent
```
→ 570 green.

```
git diff client-tests/render-lobby.test.js client-tests/red-carpet.test.js client-tests/red-carpet-render.test.js client-tests/red-carpet-seat-table.test.js client-tests/seat-builder.test.js
```
→ no output (sacrosanct tests unedited).

**Steps:**

- [ ] **Step 1: Write the 2 failing integration tests first (TDD red)**

  In `client-tests/render-qr.test.js`, append a new describe block AFTER the existing `describe('renderQR / clearQR — pure unit')`:

  ```js
  // ─── Integration test for #waiting-room-qr (T1) ───
  // Lives in render-qr.test.js (not render-lobby.test.js, which is sacrosanct).
  describe('renderLobby — classic lobby QR integration', () => {
    const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
    const mockEmit = jest.fn();
    jest.mock('../public/js/state.js', () => ({
      getSocket: () => ({ emit: mockEmit }),
      getCurrentLobbyId: () => 'TEST01',
    }));
    // Re-import via the ui.js barrel — same shape as render-lobby.test.js.
    const { initUIElements, renderLobby } = require('../public/js/ui.js');

    beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

    test('renderLobby paints SVG into #waiting-room-qr .lobby-qr-svg', () => {
      const state = makeWaitingState({
        id: 'ABCDEF',
        gameMode: 'classic',
        players: [
          makePlayer({ id: 'host_id', name: 'Host', isHost: true }),
        ],
      });
      renderLobby(state, 'host_id');
      const mount = document.querySelector('#waiting-room-qr .lobby-qr-svg');
      expect(mount).not.toBeNull();
      const svg = mount.querySelector('svg');
      expect(svg).not.toBeNull();
      // dataset.qrUrl must encode the lobby code via makeJoinUrl. The
      // jsdom default origin is http://localhost so we expect the URL to
      // contain '?room=ABCDEF'.
      expect(mount.dataset.qrUrl).toMatch(/\?room=ABCDEF$/);
    });
  });
  ```

  In `client-tests/render-team-screen.test.js`, append a new test INSIDE the existing `describe('renderTeamScreen — team theater parity')` block, BEFORE the closing `});` at the end of the file. **DO NOT edit any existing test:**

  ```js
    // Phase 7.8c — team-mode QR integration. Mirrors the classic test in
    // render-qr.test.js; pinned in this file too so the team contract
    // explicitly covers the QR mount.
    test('renderLobby paints SVG into #team-screen-qr .lobby-qr-svg in team mode', () => {
      const state = teamState({ id: 'XYZ987' });
      renderLobby(state, 'host_id');
      const mount = document.querySelector('#team-screen-qr .lobby-qr-svg');
      expect(mount).not.toBeNull();
      const svg = mount.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(mount.dataset.qrUrl).toMatch(/\?room=XYZ987$/);
    });
  ```

  Run the tests to confirm they fail:
  ```
  npx jest client-tests/render-qr.test.js client-tests/render-team-screen.test.js
  ```
  Expected: 2 new failures (no #waiting-room-qr / #team-screen-qr elements; renderLobby doesn't call renderQR yet).

- [ ] **Step 2: Add the `<script>` tag for the vendored lib to `index.html`**

  Open `public/index.html`. Find the existing module script at L806:
  ```html
  <script type="module" src="js/app.js"></script>
  ```

  Insert the vendored lib script IMMEDIATELY BEFORE it:
  ```html
  <!-- Phase 7.8c — vendored qrcode-generator (MIT). Loaded as a classic
       (non-module) script BEFORE the module script so window.qrcode is
       defined before ui-qr.js calls it. Tiny (~10kb), no defer needed. -->
  <script src="/js/lib/qrcode.js"></script>
  <script type="module" src="js/app.js"></script>
  ```

- [ ] **Step 3: Add the `.lobby-qr` div to `#waiting-room .lobby-head` (classic)**

  Find the existing `.lobby-head` block in `#waiting-room`. Current shape:
  ```html
  <div class="lobby-head">
    <div class="head-title">
      <h2>Room: <span id="lobby-code-display" class="accent-text code"></span></h2>
      <p>The cast is arriving — take your seats.</p>
    </div>
    <label class="setting-toggle public-toggle" title="List this room on the Public Matchmaking viewer">
      <input type="checkbox" id="public-room-toggle" disabled>
      <span>Public Room</span>
    </label>
  </div>
  ```

  Insert the QR div BETWEEN `.head-title` and the `.public-toggle` label. The new shape:
  ```html
  <div class="lobby-head">
    <div class="head-title">
      <h2>Room: <span id="lobby-code-display" class="accent-text code"></span></h2>
      <p>The cast is arriving — take your seats.</p>
    </div>
    <!-- Phase 7.8c — QR scan-to-join. ui-render.js paints the SVG into
         .lobby-qr-svg whenever renderLobby() fires with a state.id. -->
    <div class="lobby-qr" id="waiting-room-qr">
      <div class="lobby-qr-svg" data-mount="qr"></div>
      <div class="lobby-qr-caption">Scan to join</div>
    </div>
    <label class="setting-toggle public-toggle" title="List this room on the Public Matchmaking viewer">
      <input type="checkbox" id="public-room-toggle" disabled>
      <span>Public Room</span>
    </label>
  </div>
  ```

- [ ] **Step 4: Add the `.lobby-qr` div to `#team-screen .lobby-head` (team)**

  Find the existing `.lobby-head` block in `#team-screen` (around L384). Current shape:
  ```html
  <div class="lobby-head">
    <div class="head-title">
      <h2>Room: <span id="team-lobby-code" class="accent-text code"></span></h2>
      <p>Pick your side — the rivals are taking the stage.</p>
    </div>
  </div>
  ```

  Add the QR div as the 2nd child of `.lobby-head`. The new shape:
  ```html
  <div class="lobby-head">
    <div class="head-title">
      <h2>Room: <span id="team-lobby-code" class="accent-text code"></span></h2>
      <p>Pick your side — the rivals are taking the stage.</p>
    </div>
    <!-- Phase 7.8c — QR scan-to-join. ui-render.js paints the SVG into
         .lobby-qr-svg whenever renderTeamScreen() fires with a state.id. -->
    <div class="lobby-qr" id="team-screen-qr">
      <div class="lobby-qr-svg" data-mount="qr"></div>
      <div class="lobby-qr-caption">Scan to join</div>
    </div>
  </div>
  ```

- [ ] **Step 5: Export `makeJoinUrl()` from `app.js` and replace inline duplications**

  Open `public/js/app.js`. Near the top of the file (after the imports, before the IIFE/DOMContentLoaded block — around line 80 or wherever fits the file's organization), add the exported helper:

  ```js
  // Phase 7.8c — single source of truth for the invite-link URL format.
  // Used by:
  //   - the in-game invite button (was inline at L122)
  //   - the click-to-copy on the room code (was inline at L395)
  //   - ui-render.js for the new QR codes
  // Output is byte-identical to the prior inline construction.
  export function makeJoinUrl(code) {
    return window.location.origin + '?room=' + code;
  }
  ```

  Then replace the two inline occurrences:

  At L122 (in `gameInviteBtn` click handler):
  ```js
  // BEFORE:
  const url = window.location.origin + '?room=' + code;
  // AFTER:
  const url = makeJoinUrl(code);
  ```

  At L395 (in `setupCodeCopy`):
  ```js
  // BEFORE:
  const url = window.location.origin + '?room=' + code;
  // AFTER:
  const url = makeJoinUrl(code);
  ```

- [ ] **Step 6: Wire `renderQR` into `ui-render.js`**

  Open `public/js/ui/ui-render.js`. At the top of the file, add the imports next to the other UI-module imports (around L40, after the `red-carpet.js` import):

  ```js
  // Phase 7.8c — QR scan-to-join. renderQR is the thin wrapper around the
  // vendored qrcode-generator; makeJoinUrl is the single source of truth for
  // invite-URL format (extracted from app.js inline duplications).
  import { renderQR } from './ui-qr.js';
  import { makeJoinUrl } from '../app.js';
  ```

  Inside `renderLobby(gameState, myPlayerId)` (starts at L155), add the QR render call. Place it at the END of the function, after all existing seat/ledger/state work:

  ```js
  // Phase 7.8c — paint the lobby QR if its mount node exists and we have a
  // lobby code. The memo inside renderQR skips re-encoding on every render*
  // call, so this is cheap to invoke unconditionally.
  const classicQrMount = document.querySelector('#waiting-room-qr .lobby-qr-svg');
  if (classicQrMount && gameState.id) {
    renderQR(classicQrMount, makeJoinUrl(gameState.id));
  }
  ```

  Inside `renderTeamScreen(gameState, myPlayerId, amIHost)` (starts at L396), add the mirror call at the END of the function:

  ```js
  // Phase 7.8c — paint the team-screen QR. Same mount-pattern as classic.
  const teamQrMount = document.querySelector('#team-screen-qr .lobby-qr-svg');
  if (teamQrMount && gameState.id) {
    renderQR(teamQrMount, makeJoinUrl(gameState.id));
  }
  ```

- [ ] **Step 7: Run jest — confirm green**

  ```
  npm test --silent
  ```
  Expected: 570 passing (561 baseline + 7 T0 + 2 T1).

  If sacrosanct tests fail, STOP and read the diff carefully — something in steps 2-6 broke a guard.

- [ ] **Step 8: Verify sacrosanct tests unedited**

  ```
  git diff client-tests/render-lobby.test.js client-tests/red-carpet.test.js client-tests/red-carpet-render.test.js client-tests/red-carpet-seat-table.test.js client-tests/seat-builder.test.js
  ```
  Expected: empty output (no diffs in those files).

  Also verify that `render-team-screen.test.js` only had ONE test APPENDED — the existing 12 tests must be byte-identical:
  ```
  git diff client-tests/render-team-screen.test.js | grep '^-' | grep -v '^---'
  ```
  Expected: empty output (only insertions; the `-` lines are headers, not real diff removals).

- [ ] **Step 9: Commit Task 1**

  ```
  git add public/index.html public/js/app.js public/js/ui/ui-render.js client-tests/render-qr.test.js client-tests/render-team-screen.test.js
  git commit -m "Phase 7.8c T1: DOM + makeJoinUrl extraction + render wiring + 2 integration tests"
  ```

---

## Task 2: CSS append — `.lobby-qr` + responsive

**Goal:** Visual styling for the QR tile. Append-only — zero edits to pre-existing rules.

**Files:**
- Modify: `public/css/02-hero-lobby.css` (append new section at the END of the file)

**Acceptance Criteria:**
- [ ] New "Phase 7.8c — QR Scan-to-Join" section appended with a banner comment
- [ ] `.lobby-qr` rule has `width: 140px`, white background, flex column layout
- [ ] `.lobby-qr-svg` and `.lobby-qr-caption` rules present
- [ ] `@media (max-width: 999px)` shrinks `.lobby-qr` to 110px
- [ ] `@media (max-width: 639px)` sets `.lobby-qr { display: none }`
- [ ] **No edits to pre-existing rules** (`git diff --stat` shows insertions only, zero deletions)
- [ ] No new color tokens (`--radius-md` and `--bg-base` are existing tokens)
- [ ] Suite stays at 570 green (CSS append doesn't break DOM tests)

**Verify:**
```
npm test --silent && git diff --stat public/css/02-hero-lobby.css
```
Expected: 570 green; insertions > 0, deletions == 0.

**Steps:**

- [ ] **Step 1: Append the Phase 7.8c CSS section to `02-hero-lobby.css`**

  Append the following block to the END of `public/css/02-hero-lobby.css` (after the existing Phase 7.8b section that ends around L1816):

  ```css

  /* ╔══════════════════════════════════════════════════════════════╗
     ║  === Phase 7.8c — QR Scan-to-Join ===                        ║
     ║  Appended (append-only per spec §8.4). Zero deletions.       ║
     ║  Implements:                                                  ║
     ║    (a) Compact 140×140 white QR tile in .lobby-head, right    ║
     ║        of the room code. Same selectors serve classic and    ║
     ║        team lobbies — zero divergence, one rule set.         ║
     ║    (b) Tablet shrink to 110px; mobile hide (<640px).         ║
     ║  No new color tokens; --radius-md and --bg-base are existing.║
     ╚══════════════════════════════════════════════════════════════╝ */

  /* ── (a) Compact QR tile ── */
  /* WHY white background: QR readers require light-on-dark contrast for
     reliable scanning. Hard-coded #ffffff because there is no existing
     "panel white" token — and we don't want to invent one for a single
     localized use. The white tile reads as a print-style sticker against
     the dark lobby panel, which is visually consistent with how QR codes
     are normally seen (posters, stickers, business cards). */
  .lobby-qr {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px;
    background: #ffffff;
    border-radius: var(--radius-md);
    width: 140px;
    flex-shrink: 0;                    /* Don't squeeze when flex sibling is wide */
  }

  /* ui-qr.js paints an inline <svg> into .lobby-qr-svg. The viewBox handles
     scaling — we just set a CSS width/height and the SVG fills it crisply. */
  .lobby-qr-svg { width: 120px; height: 120px; }
  .lobby-qr-svg svg { display: block; width: 100%; height: 100%; }

  /* WHY dark caption text: the parent .lobby-qr tile is white, so the
     dark page-bg color (--bg-base) reads as a high-contrast label.
     The all-caps + letter-spacing matches the .ref-eyebrow / screen-eyebrow
     typographic system used elsewhere in the lobby. */
  .lobby-qr-caption {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--bg-base);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  /* ── (b) Responsive ── */
  /* Tablet: shrink to 110px so the lobby-head doesn't dominate at narrower
     viewports. The QR still encodes the same data — viewBox scaling handles
     the resize at zero visual cost. */
  @media (max-width: 999px) {
    .lobby-qr { width: 110px; }
    .lobby-qr-svg { width: 92px; height: 92px; }
  }

  /* Mobile: hide entirely. Phones ARE the scanner — they don't need to see
     what they're scanning, and hiding frees up cramped header space. The
     room code text remains visible and tappable (click-to-copy preserved). */
  @media (max-width: 639px) {
    .lobby-qr { display: none; }
  }
  ```

- [ ] **Step 2: Run jest — verify suite still green**

  ```
  npm test --silent
  ```
  Expected: 570 green (CSS append doesn't change any test's DOM expectations).

- [ ] **Step 3: Verify append-only discipline**

  ```
  git diff --stat public/css/02-hero-lobby.css
  ```
  Expected: `1 file changed, NN insertions(+)` — NO `deletions(-)` line.

  If there are deletions, something in Step 1 accidentally overwrote existing CSS. STOP, restore from `git restore` and re-apply as pure insert.

- [ ] **Step 4: Commit Task 2**

  ```
  git add public/css/02-hero-lobby.css
  git commit -m "Phase 7.8c T2: CSS append — .lobby-qr tile + responsive (zero deletions)"
  ```

---

## Post-Implementation (User-Side)

After all three tasks land, the standard Phase 7 pipeline applies:

1. **Holistic review** — opus whole-branch sanity check before opening the PR.
2. **PR open** — branch `phase7-8c-qr-scan-to-join` → main. PR body summarizes the 3 task commits + acceptance evidence + manual smoke checklist.
3. **User-side gated work:**
   - Review PR.
   - Merge to main.
   - Render deploys.
   - **Pre-merge required:** Manual phone-scan smoke (per spec §10.4). Open the deployed URL on desktop, create a lobby in both classic and team mode, scan each QR with a phone camera, verify the room code pre-fills and the lobby joins. jsdom cannot verify this.
4. **Post-merge reconcile** — once user signals merge, run `git checkout main && git pull --ff-only && git branch -d phase7-8c-qr-scan-to-join`.

---

## Risk & Rollback Notes

- **Risk: Vendored lib path collision.** If `public/js/lib/` already contains other vendored files (current state: directory does not exist), check for naming overlaps before T0 step 1.
- **Risk: jsdom indirect-eval fails to expose `window.qrcode`.** If `loadVendoredQrLib()` doesn't make `window.qrcode` a function (T0 tests would fail with `qrcode is not a function`), fall back to injecting the script into the jsdom DOM via `document.createElement('script')` + `script.textContent = src` + `document.head.appendChild(script)`. Surface this as `NEEDS_CONTEXT` to the dispatcher if neither path works.
- **Risk: app.js `makeJoinUrl` import in ui-render.js creates a circular dep.** The ui.js barrel re-exports ui-render, but app.js imports the barrel; if importing `makeJoinUrl` from `../app.js` introduces a cycle, extract `makeJoinUrl` to a new file `public/js/url-helpers.js` and import from there instead. Surface as a structural decision before changing the file layout.
- **Rollback:** Each task is its own commit; revert per-task with `git revert <sha>`. T2 is the safest to revert (CSS only). T1 reverts the wiring. T0 reverts the vendor + module — leaves no traces.

---

## Acceptance — Whole Branch

Before opening PR:
- [ ] 570 green via `npm test --silent`
- [ ] Sacrosanct tests untouched (verify via `git diff` of those files vs origin/main)
- [ ] `git diff --stat public/css/02-hero-lobby.css` shows insertions only
- [ ] No SW edits (`git diff public/sw.js public/sw-routing.js` → empty)
- [ ] Vendored `qrcode.js` verbatim from npm; no edits
- [ ] All 10 §8 guardrails honored (spec §8)
- [ ] Manual phone-scan smoke ready for user verification post-merge
