# Phase 7.8c — QR Scan-to-Join Design Spec

**Status:** Spec — pending plan-writing
**Branch:** `phase7-8c-qr-scan-to-join` (off `origin/main` @ `d1c5e9d`)
**Baseline tests:** 561 green
**Target:** 570 green (+9 new; zero pre-existing tests edited)

---

## §0 — Context

After 7.8b (Team Theater Lobby parity, [PR #45](https://github.com/Itsbryanfam/MovieMatch/pull/45)) and the `.lobby-panel` 380px-clamp hot-fix ([PR #46](https://github.com/Itsbryanfam/MovieMatch/pull/46)), both lobby panels (classic `#waiting-room` and team `#team-screen`) share the same wide-shell envelope and `.lobby-head` flex layout. The next item on the 3-item roadmap is mobile scan-to-join: render the lobby's invite URL as a scannable QR code so phone players can join by pointing their camera at the desktop host's screen instead of typing the 6-letter room code.

**The deep-link infrastructure already exists.** `app.js:365-381` (`checkUrlParams()`) parses `?room=CODE` from `window.location.search` on page load and joins the lobby automatically. Existing invite paths at L122 (game-screen invite button) and L395 (click-to-copy on room code) already build `window.location.origin + '?room=' + code`. **7.8c is purely "render that existing URL as a QR image."** No server work, no new socket events, no new URL format.

---

## §1 — Locked Decisions (from brainstorm)

1. **Placement:** Always-visible compact tile (~140×140 px) in `.lobby-head`, opposite the room code. Both lobbies. `.lobby-head` is already `display: flex; justify-content: space-between` ([02-hero-lobby.css:768](public/css/02-hero-lobby.css)) — the QR slots in on the right with no extra wrapper.
2. **Library:** Vendor `qrcode-generator` v1.4.4 (MIT, kazuhikoarase, ~5kb minified, zero deps). Bundled as `public/js/lib/qrcode.js` and loaded via a plain blocking `<script>` tag. Avoids 3rd-party API privacy/reliability cost. PWA-friendly.
3. **Architecture:** New `public/js/ui/ui-qr.js` module exports `renderQR(mountEl, joinUrl)` and `clearQR(mountEl)`. Called from `renderLobby()` and `renderTeamScreen()` in `ui-render.js`. Internal memo via `mountEl.dataset.qrUrl` skips re-encoding on every render*Lobby() call.
4. **URL format:** `window.location.origin + '?room=' + code` — verbatim match for the existing invite-link builder. Consolidated into a `makeJoinUrl(code)` helper exported from `app.js` (pure refactor; eliminates two inline duplications at L122 and L395).
5. **Mobile behavior:** QR hidden on viewport <640px via CSS. Phones ARE the scanner — they don't need to see what they're scanning.

---

## §2 — Goals & Non-Goals

**Goals**
- Mobile players join an open lobby by scanning the host's screen instead of typing.
- One render path serves both classic and team lobbies — zero divergence.
- Zero new network deps; zero server work; zero socket changes.

**Non-goals**
- Per-lobby chrome (team-red QR with red border, team-blue with blue) — visual unification beats mode-flavor.
- QR-only join flows (in-camera widget, etc.). The `?room=` deep-link is sufficient.
- Sharing/exporting the QR (download, share-sheet, copy as image).
- Logo overlay or custom QR styling beyond plain encode-and-paint.
- Mid-game QR display — `#game-invite-btn` already covers in-game invites.

---

## §3 — Contract

### §3.1 — Vendored library
- `public/js/lib/qrcode.js` — committed verbatim from `qrcode-generator` v1.4.4 (MIT). **Zero edits to the vendored source.**
- Loaded via `<script src="/js/lib/qrcode.js"></script>` in `index.html` `<head>`, before the existing module script.
- Exposes `window.qrcode` global constructor.

### §3.2 — `ui-qr.js` module

```js
// public/js/ui/ui-qr.js
// Phase 7.8c — thin wrapper around the vendored qrcode-generator lib.
// Pure: takes a DOM element and a URL, paints an SVG QR inside the element.
// No game-state, socket, or lobby-semantics coupling.

export function renderQR(mountEl, joinUrl) {
  // Silent no-op if vendored lib failed to load (offline cold-start, etc.).
  if (typeof window.qrcode !== 'function') return;
  // Memo: same URL already mounted → skip the encode work.
  if (mountEl.dataset.qrUrl === joinUrl) return;

  const qr = window.qrcode(0, 'M');          // typeNumber=auto, ECC level M (~15%)
  qr.addData(joinUrl);
  qr.make();
  // createSvgTag returns an HTML string — viewBox-scaled SVG with one <path>.
  mountEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
  mountEl.dataset.qrUrl = joinUrl;
}

export function clearQR(mountEl) {
  mountEl.textContent = '';
  delete mountEl.dataset.qrUrl;
}
```

### §3.3 — DOM additions to `index.html`

Inside `#waiting-room`'s `.lobby-head` (alongside the existing `.head-title` element):
```html
<div class="lobby-qr" id="waiting-room-qr">
  <div class="lobby-qr-svg" data-mount="qr"></div>
  <div class="lobby-qr-caption">Scan to join</div>
</div>
```

Inside `#team-screen`'s `.lobby-head` (mirror):
```html
<div class="lobby-qr" id="team-screen-qr">
  <div class="lobby-qr-svg" data-mount="qr"></div>
  <div class="lobby-qr-caption">Scan to join</div>
</div>
```

The outer `.lobby-qr` is a static wrapper (CSS sizing + caption); the inner `.lobby-qr-svg` is the mount target for `renderQR()`.

### §3.4 — `ui-render.js` wiring

```js
import { renderQR } from './ui-qr.js';
import { makeJoinUrl } from '../app.js';

// inside renderLobby() — after seat-build, before idle/ready states
const qrMount = document.querySelector('#waiting-room-qr .lobby-qr-svg');
if (qrMount && state.id) renderQR(qrMount, makeJoinUrl(state.id));

// inside renderTeamScreen() — same shape
const qrMount = document.querySelector('#team-screen-qr .lobby-qr-svg');
if (qrMount && state.id) renderQR(qrMount, makeJoinUrl(state.id));
```

### §3.5 — `app.js` `makeJoinUrl` extraction (pure refactor)

```js
// public/js/app.js — near the top, exported
export function makeJoinUrl(code) {
  return window.location.origin + '?room=' + code;
}
```

Existing inline duplications at L122 and L395 replaced with `makeJoinUrl(code)`. **Output is byte-identical.** This refactor exists so `ui-render.js` and `app.js` share one definition; not a behavior change.

### §3.6 — CSS append (`02-hero-lobby.css`)

New section appended (zero edits to existing rules):

```css
/* ╔══════════════════════════════════════════════════════════════╗
   ║  === Phase 7.8c — QR Scan-to-Join ===                        ║
   ║  Compact QR tile in .lobby-head, opposite the room code.     ║
   ║  Both lobbies use the same selectors — single source of      ║
   ║  truth, zero divergence between classic and team modes.      ║
   ╚══════════════════════════════════════════════════════════════╝ */
.lobby-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: #ffffff;                /* QR codes need light-on-dark contrast. */
  border-radius: var(--radius-md);
  width: 140px;
  flex-shrink: 0;
}
.lobby-qr-svg { width: 120px; height: 120px; }
.lobby-qr-svg svg { display: block; width: 100%; height: 100%; }
.lobby-qr-caption {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--bg-base);              /* Dark text on the white tile. */
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
@media (max-width: 999px) {
  .lobby-qr { width: 110px; }
  .lobby-qr-svg { width: 92px; height: 92px; }
}
@media (max-width: 639px) {
  /* Phones ARE the scanner; they don't need to see the QR. Hiding also
     frees up cramped header space at small viewports. */
  .lobby-qr { display: none; }
}
```

No new color tokens. `--radius-md` and `--bg-base` are existing tokens.

---

## §4 — Behavioural Equivalence

Everything below is preserved verbatim:

- `?room=CODE` deep-link flow in `checkUrlParams()` ([app.js:365-381](public/js/app.js)) — untouched.
- Click-to-copy on room code — untouched; still calls `navigator.clipboard.writeText(url)`. Adopts `makeJoinUrl()` internally but output is byte-identical.
- Game-screen `#game-invite-btn` — adopts `makeJoinUrl()`; same URL output.
- `.lobby-head` flex layout — already `justify-content: space-between`. The QR is content for the previously-empty right side; flexbox already left room.
- All existing socket events, lobby render contracts, seat DOM — unchanged.

---

## §5 — Regression Safety

**Sacrosanct tests — must stay byte-identical and green:**
- `client-tests/render-lobby.test.js`
- `client-tests/red-carpet-seat-table.test.js`
- `client-tests/red-carpet.test.js`
- `client-tests/red-carpet-render.test.js`
- `client-tests/seat-builder.test.js`
- `client-tests/render-team-screen.test.js` (all 12 existing tests; T1 may **add** one integration test for the team QR — additive only, no edits to existing tests)

**Why these stay green:** The QR DOM is added to `.lobby-head`, not inside `.seats-grid` or `.theater`. No existing test queries the new QR DOM. The new `<script>` tag in `index.html` `<head>` doesn't affect existing test fixture loading (fixtures strip module scripts, not classic `<script src>` tags — and the vendored lib is benign even if loaded).

**Append-only discipline:** `02-hero-lobby.css` changes are insertions only. `git diff --stat public/css/02-hero-lobby.css` must show insertions > 0, deletions == 0.

---

## §6 — Implementation Phases (3 linear TDD tasks)

### T0 — Vendor lib + `ui-qr.js` module + unit tests

**Files:**
- Create: `public/js/lib/qrcode.js` (vendored qrcode-generator v1.4.4 verbatim)
- Create: `public/js/ui/ui-qr.js` (~30 LOC)
- Create: `client-tests/render-qr.test.js` (~7 unit tests)
- Modify: `client-tests/fixtures.js` (add `loadVendoredQrLib()` helper — loads the vendored lib into the jsdom global so tests exercise the real encoder)

**TDD:** All 7 tests written first (red), then implementation (green).

**Acceptance:**
- `renderQR` mounts an `<svg>` inside the target element
- `dataset.qrUrl` is set after mount
- Memo: calling `renderQR` twice with same URL doesn't re-render (SVG identity preserved via the dataset guard)
- New URL replaces old
- `clearQR` empties + removes dataset
- Silent no-op when `window.qrcode` is missing (deleted before test → no throw, no DOM change)
- Encoded SVG has expected dimensions for a known short URL (deterministic sanity check)

**Verify:** `npx jest client-tests/render-qr.test.js --verbose` → all green. Suite total: 568 green (561 + 7).
**Note:** T0 tests are pure-unit only — they synthesize mount elements via `document.createElement`. Integration tests against the real lobby DOM (`#waiting-room-qr`, `#team-screen-qr`) land in T1 after the HTML divs exist.

### T1 — DOM additions + render wiring + makeJoinUrl extraction

**Files:**
- Modify: `public/index.html` (add `<script>` tag + 2 `.lobby-qr` divs in `.lobby-head`)
- Modify: `public/js/app.js` (export `makeJoinUrl`, replace inline duplications at L122 + L395)
- Modify: `public/js/ui/ui-render.js` (import + call `renderQR` in both `renderLobby` and `renderTeamScreen`)
- Modify: `client-tests/render-team-screen.test.js` (add 1 integration test for `#team-screen-qr`)
- Modify: `client-tests/render-qr.test.js` (add 1 integration test for `#waiting-room-qr`)

**Acceptance:**
- `renderLobby(state, mySocketId)` populates `#waiting-room-qr .lobby-qr-svg` with an SVG when `state.id` is present
- `renderTeamScreen(state, mySocketId)` populates `#team-screen-qr .lobby-qr-svg` with an SVG when `state.id` is present
- `makeJoinUrl(code)` is the single source of truth for invite URL format
- All sacrosanct tests stay byte-identical and green
- Suite total: 570 green (561 + 9)

**Verify:** `npm test --silent` → 570 green. `git diff client-tests/render-lobby.test.js` etc. → no edits to sacrosanct tests.

### T2 — CSS append (`.lobby-qr` + responsive)

**Files:**
- Modify: `public/css/02-hero-lobby.css` (append the §3.6 block; ~40 LOC under a banner comment)

**Acceptance:**
- Section banner identifies it as Phase 7.8c
- All selectors live (no dead rules)
- No new color tokens
- `git diff --stat` shows insertions > 0, deletions == 0
- Suite still 570 green (CSS append doesn't change DOM tests)

**Verify:** `npm test --silent && git diff --stat public/css/02-hero-lobby.css` → green; insertions only.

---

## §7 — Review Gates

Per the established Phase 7 pipeline:
- **Per-task:** spec-compliance review THEN code-quality review (two-stage, sequential).
- **Whole-branch:** opus holistic review after T2 lands.
- **User-gated:** PR open → user merge → Render deploy → user verify in-browser. Phone-scan smoke is **required** before merge (jsdom can't lay out CSS and definitely can't operate a camera).

---

## §8 — Binding Guardrails

1. Vendored `qrcode.js` committed verbatim; zero edits to its source.
2. No new 3rd-party network requests after merge. Verify in Network panel post-deploy.
3. Sacrosanct tests stay byte-identical and green.
4. CSS append-only (`git diff --stat 02-hero-lobby.css` shows zero deletions).
5. `ui-qr.js` is pure: takes `(mountEl, urlString)`, paints SVG. No socket, no game-state, no lobby semantics.
6. No SW edits (network-first SW handles new files on first fetch).
7. Memo cache (`dataset.qrUrl`) prevents redundant re-encoding on every render*Lobby() call.
8. `makeJoinUrl()` is the SINGLE source of truth for invite URL format after T1.
9. QR is visual-only — no click handlers. Click-to-copy on room code text already covers the "copy the link" path.
10. `renderQR()` produces zero console output. Silent fallback when lib missing — already handled by the `typeof` guard.

---

## §9 — Deferred (out of scope for 7.8c)

- Per-lobby QR chrome (red border for team-red side, etc.) — visual unification beats mode flavor.
- Custom branding (MovieMatch logo overlay on QR center cell) — would need a custom renderer; pure encode-and-paint is sufficient.
- Mid-game QR — `#game-invite-btn` covers in-game invites already.
- Download/share/copy-as-image of the QR — not requested; out of scope.
- QR for daily challenge / leaderboard share — different surface, different URL semantics, defer.
- A `~/.qrcache/` server-side QR endpoint — keep all rendering client-side per §1.2.

---

## §10 — Acceptance

A merge candidate must satisfy ALL of:
1. All 561 existing tests stay green; ≥9 new tests green → 570 total.
2. Classic lobby `#waiting-room` shows a 140×140 QR right of the room code in `.lobby-head` on desktop.
3. Team lobby `#team-screen` shows the same 140×140 QR in the same position.
4. **Manual phone-scan smoke (pre-merge required):** Scanning the QR with a phone camera opens MovieMatch and pre-fills the room code (i.e., the `?room=CODE` deep-link path works end-to-end).
5. QR hides on viewport <640px (resize browser to verify).
6. Zero new 3rd-party network requests on lobby load (Network panel inspection).
7. `git diff --stat public/css/02-hero-lobby.css` shows insertions > 0, deletions == 0.
8. No SW edits required.
9. All §8 guardrails honored with evidence cited in the PR body.

---

## §11 — Lessons Applied from 7.8b

The **380px-clamp regression** (PR #46 hot-fix after PR #45 merged): T1 placed `.lobby-panel` on `#team-screen` and the test suite passed because jsdom doesn't compute CSS layout — but the page was unusable. Lesson: **jsdom tests prove DOM shape; manual in-browser verification proves layout.**

For 7.8c:
- §10.4 (manual phone-scan smoke) is an explicit **pre-merge required** gate, not optional.
- The CSS in §3.6 uses straightforward flexbox additions inside `.lobby-head` (already proven layout in classic + team) — no novel containment patterns to surprise jsdom.
- Both lobbies share the same `.lobby-head` flex shape — one CSS rule serves both; **reduces divergence risk by design**, not just by review.
- The vendored lib avoids the "unstated dependency" trap by being entirely local — no 3rd party URL semantics to guess at.
