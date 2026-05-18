# Red Carpet Lobby (Phase 7.5, Core Makeover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the primary waiting room (`#waiting-room`) into a theatrical "Red Carpet" premiere — marquee room code, *now-casting* copy, mode poster, animated Player Entrance Cards with a device-local deterministic per-player accent, a presentational Host-Director panel, and a "🎬 Roll Camera" host start — purely additive, zero server/behaviour change, team mode byte-identical.

**Architecture:** A new pure, zero-import module `public/js/ui/red-carpet.js` (arrival diff, per-player card model, Roll-Camera gating, marquee segmentation) is unit-pinned first, then wired as **thin glue** into the existing single `renderLobby` entry point, with additive structural wrappers in `index.html` and an append-only Red-Carpet CSS section. This is the validated 7.2/7.3/7.4 pure-seam discipline: pure tested core + thin glue + barrel export + additive CSS + jsdom tests + WHY comments + zero pre-existing-test regression.

**Tech Stack:** Vanilla ES-module client (no build), Jest 30 + jest-environment-jsdom, the existing `client-tests/fixtures.js` jsdom harness, the `public/js/ui.js` barrel.

**Spec:** `docs/superpowers/specs/2026-05-18-red-carpet-lobby-design.md` (committed `f80a802`). Worktree `C:\mm-phase7-5`, branch `phase7-5-red-carpet-lobby` off `origin/main 5380167`, node_modules junctioned to `C:\moviematch-git\node_modules`.

**Binding constraints (every task):** vanilla JS no-build; client-only; NO server/socket/scoring/validation/theme-mechanic/accounts/persistence change; never echo `stableId` (accent key = `name + ':' + socket-id` only); Host-Director presentational only (NO rule/preset/kit mechanic — 6c dedup); team mode byte-identical; compositor-only animation (transform/opacity), no new intervals/timers; reduced-motion auto-covered by the existing global `06-states-anim.css` block; every code change ships a WHY comment; the pre-existing suites (esp. `client-tests/render-lobby.test.js`, `socket-handlers.test.js`, `showScreen.test.js`, `modal-factory.test.js`, `name-prompts.test.js`, all `server/**`) stay **byte-identical and green** (the behavioural zero-regression guard — do NOT edit them). A parallel Codex agent shares this repo → verify `git -C C:/mm-phase7-5 branch --show-current` == `phase7-5-red-carpet-lobby` before EVERY commit. Out-of-scope findings → `spawn_task`, never widen 7.5. Full `npx jest` stays green, additive over the 52/395 post-7.4 baseline.

---

### Task 0: Pure `red-carpet.js` seam + unit suite

**Goal:** A new pure, zero-import `public/js/ui/red-carpet.js` exporting `diffArrivals`, `playerCardModel`, `rollCameraLabel`, `marqueeSegments`, `ACCENT_EMOJI`, fully unit-pinned (deterministic, defensive, the `stableId` security sentinel, the byte-identical Roll-Camera truth-table). No barrel, no glue yet.

**Files:**
- Create: `C:\mm-phase7-5\public\js\ui\red-carpet.js`
- Create (test): `C:\mm-phase7-5\client-tests\red-carpet.test.js`

**Acceptance Criteria:**
- [ ] `red-carpet.js` has zero imports; all functions pure (no DOM/socket/window/localStorage); WHY comments throughout.
- [ ] `diffArrivals(seenIds, players)` → `{entering, seen}` per spec §3.1 (seen = current roster; never mutates inputs; tolerates Set/array/null and missing-id).
- [ ] `playerCardModel(player,{myPlayerId})` deterministic; `accentHue` int 0–359 via the pinned djb2; `accentEmoji` ∈ exported frozen 12-set; `label` mirrors the exact `(You)`/`👑`/`• N 🏆` semantics; **identical output with vs without a `stableId` key on the input** (security sentinel).
- [ ] `rollCameraLabel({amIHost,playerCount,mode})` `disabled`/`variant` truth-table byte-identical to the pre-7.5 start gating; only the text re-voiced.
- [ ] `marqueeSegments(code)` → per-char array; `''`/non-string → `[]`.
- [ ] New `client-tests/red-carpet.test.js` green; full `npx jest` green, additive, zero pre-existing regression.

**Verify:** `cd C:/mm-phase7-5 && npx jest client-tests/red-carpet.test.js` → all green; then `cd C:/mm-phase7-5 && npx jest` → all green (52/395 baseline + the new suite, zero pre-existing failures).

**Steps:**

- [ ] **Step 1: Write the failing test** — create `C:\mm-phase7-5\client-tests\red-carpet.test.js`:

```js
/**
 * @jest-environment jsdom
 */
// Phase 7.5 — Red Carpet Lobby pure seams. WHY: the arrival diff, the
// device-local per-player accent, and the re-voiced Roll-Camera gating must
// be pure + unit-pinned (deterministic, defensive, NO stableId) BEFORE any
// glue wires them into renderLobby. jsdom docblock = client-tests dir
// convention; this module is pure so no DOM is touched.
import {
  diffArrivals,
  playerCardModel,
  rollCameraLabel,
  marqueeSegments,
  ACCENT_EMOJI,
} from '../public/js/ui/red-carpet.js';

describe('diffArrivals', () => {
  test('empty seen → everyone entering; seen = current roster', () => {
    const r = diffArrivals(new Set(), [{ id: 'a' }, { id: 'b' }]);
    expect(r.entering).toEqual(['a', 'b']);
    expect(r.seen).toEqual(['a', 'b']);
  });
  test('idempotent: roster already seen → nobody entering', () => {
    const r = diffArrivals(new Set(['a', 'b']), [{ id: 'a' }, { id: 'b' }]);
    expect(r.entering).toEqual([]);
    expect(r.seen).toEqual(['a', 'b']);
  });
  test('only the newly added id is entering', () => {
    const r = diffArrivals(new Set(['a']), [{ id: 'a' }, { id: 'c' }]);
    expect(r.entering).toEqual(['c']);
    expect(r.seen).toEqual(['a', 'c']);
  });
  test('departed id pruned from seen (bounded)', () => {
    const r = diffArrivals(new Set(['a', 'b']), [{ id: 'a' }]);
    expect(r.seen).toEqual(['a']);
    expect(r.entering).toEqual([]);
  });
  test('leave→rejoin (new socket id) re-animates', () => {
    expect(diffArrivals(new Set(['a']), [{ id: 'a2' }]).entering).toEqual(['a2']);
  });
  test('tolerates array seenIds / non-array players / missing id', () => {
    expect(diffArrivals(['a'], [{ id: 'a' }, { id: 'b' }]).entering).toEqual(['b']);
    expect(diffArrivals(null, null)).toEqual({ entering: [], seen: [] });
    expect(diffArrivals(new Set(), [{ id: 'a' }, {}, { id: null }, { id: 'b' }]).seen)
      .toEqual(['a', 'b']);
  });
  test('does not mutate inputs (purity)', () => {
    const seen = new Set(['a']);
    const players = [{ id: 'a' }, { id: 'b' }];
    diffArrivals(seen, players);
    expect([...seen]).toEqual(['a']);
    expect(players).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});

describe('playerCardModel', () => {
  test('deterministic: same name+id → identical model across calls', () => {
    const p = { id: 's1', name: 'Ada', isHost: false, wins: 0 };
    expect(playerCardModel(p, { myPlayerId: 'x' }))
      .toEqual(playerCardModel(p, { myPlayerId: 'x' }));
  });
  test('accentHue int 0..359; accentEmoji ∈ exported frozen 12-set', () => {
    const m = playerCardModel({ id: 's1', name: 'Ada' }, {});
    expect(Number.isInteger(m.accentHue)).toBe(true);
    expect(m.accentHue).toBeGreaterThanOrEqual(0);
    expect(m.accentHue).toBeLessThanOrEqual(359);
    expect(ACCENT_EMOJI).toHaveLength(12);
    expect(Object.isFrozen(ACCENT_EMOJI)).toBe(true);
    expect(ACCENT_EMOJI).toContain(m.accentEmoji);
  });
  test('different identity → different accent (hue or emoji differs)', () => {
    const a = playerCardModel({ id: 's1', name: 'Ada' }, {});
    const b = playerCardModel({ id: 's2', name: 'Bo' }, {});
    expect(a.accentHue !== b.accentHue || a.accentEmoji !== b.accentEmoji).toBe(true);
  });
  test('label mirrors the exact (You)/👑/• N 🏆 matrix', () => {
    expect(playerCardModel({ id: 'h', name: 'Host', isHost: true }, { myPlayerId: 'h' }).label)
      .toBe('Host (You) 👑');
    expect(playerCardModel({ id: 'g', name: 'Guest' }, { myPlayerId: 'h' }).label).toBe('Guest');
    expect(playerCardModel({ id: 'w', name: 'Pro', wins: 3 }, {}).label).toBe('Pro • 3 🏆');
  });
  test('isYou/isHost/isBot/wins derivation', () => {
    expect(playerCardModel({ id: 'me', name: 'Me', isHost: true, isBot: false, wins: 2 },
      { myPlayerId: 'me' })).toMatchObject({ isYou: true, isHost: true, isBot: false, wins: 2, name: 'Me' });
    expect(playerCardModel({ id: 'b', name: 'B', isBot: true, wins: -4 }, {}))
      .toMatchObject({ isBot: true, wins: 0 });
  });
  test('SECURITY sentinel: a stableId on the input never affects the model', () => {
    const base = { id: 's1', name: 'Ada', isHost: true, wins: 1 };
    const withStable = { ...base, stableId: 'p_SECRET_LEAK' };
    expect(playerCardModel(withStable, { myPlayerId: 'x' }))
      .toEqual(playerCardModel(base, { myPlayerId: 'x' }));
  });
  test('defensive: missing name/id/null does not throw', () => {
    expect(() => playerCardModel({}, {})).not.toThrow();
    expect(() => playerCardModel(null, null)).not.toThrow();
    expect(playerCardModel({}, {}).name).toBe('');
  });
});

describe('rollCameraLabel — gating (disabled/variant exact, copy re-voiced)', () => {
  test('classic <2 players → Waiting for the cast (disabled)', () => {
    expect(rollCameraLabel({ amIHost: true, playerCount: 1, mode: 'classic' }))
      .toEqual({ text: 'Waiting for the cast…', disabled: true, variant: 'waiting-cast' });
  });
  test('classic 2 players host → Roll Camera (enabled)', () => {
    expect(rollCameraLabel({ amIHost: true, playerCount: 2, mode: 'classic' }))
      .toEqual({ text: '🎬 Roll Camera', disabled: false, variant: 'ready' });
  });
  test('classic 2 players non-host → Waiting for the director (disabled)', () => {
    expect(rollCameraLabel({ amIHost: false, playerCount: 2, mode: 'classic' }))
      .toEqual({ text: 'Waiting for the director…', disabled: true, variant: 'waiting-host' });
  });
  test('solo 1 player host → Roll Camera (enabled)', () => {
    expect(rollCameraLabel({ amIHost: true, playerCount: 1, mode: 'solo' }))
      .toEqual({ text: '🎬 Roll Camera', disabled: false, variant: 'ready' });
  });
  test('solo 1 player non-host → Waiting for the director', () => {
    expect(rollCameraLabel({ amIHost: false, playerCount: 1, mode: 'solo' }))
      .toEqual({ text: 'Waiting for the director…', disabled: true, variant: 'waiting-host' });
  });
  test('defensive: non-finite/absent playerCount → waiting-cast disabled', () => {
    expect(rollCameraLabel({ amIHost: true, mode: 'classic' }).variant).toBe('waiting-cast');
    expect(rollCameraLabel({}).disabled).toBe(true);
  });
});

describe('marqueeSegments', () => {
  test('splits a code into per-char cells', () => {
    expect(marqueeSegments('AB12')).toEqual(['A', 'B', '1', '2']);
  });
  test('empty / non-string → []', () => {
    expect(marqueeSegments('')).toEqual([]);
    expect(marqueeSegments(null)).toEqual([]);
    expect(marqueeSegments(42)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/mm-phase7-5 && npx jest client-tests/red-carpet.test.js`
Expected: FAIL — `Cannot find module '../public/js/ui/red-carpet.js'` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation** — create `C:\mm-phase7-5\public\js\ui\red-carpet.js`:

```js
// ui/red-carpet.js — pure Red Carpet Lobby seams. Phase 7.5 (Red Carpet
// Lobby). WHY: 7.5 turns the waiting room into a theatrical pre-show. The
// only real logic — which players are *newly arriving* (so the entrance
// animation fires once, not on every idempotent renderLobby re-run), a
// device-local deterministic per-player accent, and the re-voiced
// Roll-Camera start gating — is isolated here as pure, zero-import,
// unit-testable functions (7.2/7.3/7.4 pure-seam discipline); renderLobby
// stays thin glue. Nothing here touches the DOM, the socket, the server,
// localStorage, or any persistent id — the accent key is the room-scoped
// name+socket-id ONLY, so NO stableId is ever involved (the Phase-1 daily-
// leaderboard leak fix is structurally preserved).

// WHY a frozen single-Unicode-scalar film-emoji set: each entry is ONE
// scalar (no variation-selector / ZWJ / skin-tone sequence) so length,
// indexing and cross-platform rendering are predictable. Tests pin
// length/membership/determinism; the specific glyph at a specific index is
// deliberately NOT asserted (cosmetic — over-pinning makes the suite
// brittle, the 7.4 review lesson). Exported so the test can assert
// membership/frozenness without re-hardcoding glyphs.
export const ACCENT_EMOJI = Object.freeze([
  '🎬', '🍿', '🌟', '🎭', '🎪', '🎨', '🚀', '👽', '🦄', '🐉', '🎸', '🦸',
]);

/**
 * Pure arrival diff. Given the ids already shown this page session and the
 * current player list, returns which ids are NEW (play the entrance
 * animation) and the new acknowledged roster.
 *
 * WHY `seen` = the CURRENT roster (not an ever-growing union): socket ids
 * rotate per connection, so a leave→rejoin yields a NEW id and SHOULD
 * legitimately re-animate; pinning `seen` to the present roster also keeps
 * the set bounded. A still-present-but-disconnected player keeps the same
 * id (disconnect grace keeps them in `players`) so they are NOT re-animated.
 * Pure: never mutates the inputs.
 */
export function diffArrivals(seenIds, players) {
  const seenSet = seenIds instanceof Set
    ? seenIds
    : new Set(Array.isArray(seenIds) ? seenIds : []);
  const list = Array.isArray(players) ? players : [];
  const entering = [];
  const seen = [];
  for (const p of list) {
    if (!p || p.id === undefined || p.id === null) continue;
    const id = p.id;
    seen.push(id);
    if (!seenSet.has(id)) entering.push(id);
  }
  return { entering, seen };
}

// WHY djb2: a tiny, well-known, well-distributed string hash. Pinned
// EXACTLY so the per-player accent is deterministic and reproducible (tests
// assert stability/range; a reviewer can reproduce it). 32-bit via |0,
// read unsigned via >>> 0.
function _djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h) + str.charCodeAt(i)) | 0; // h * 33 + c, kept 32-bit
  }
  return h >>> 0;
}

/**
 * Pure per-player card model for the Red Carpet entrance card.
 *
 * The accent key is `name + ':' + id` where `id` is the ROOM-SCOPED socket
 * id (rotates per connection — already the client render identity key).
 * This function MUST NOT read any persistent id: stableId is stripped
 * server-side (gameLogic.js toClientState, the Phase-1 leak fix) and is
 * structurally absent here — passing an object that happens to carry a
 * stableId must not change the output (sentinel-tested).
 *
 * `label` mirrors the EXACT pre-7.5 ui-render.js suffix semantics
 * (name, ' (You)', ' 👑', ' • N 🏆') so the card's textual identity line is
 * behaviour-equivalent to today (zero copy regression); the emoji/accent
 * are an additive visual layer on top.
 */
export function playerCardModel(player, opts) {
  const p = player || {};
  const myPlayerId = opts && opts.myPlayerId;
  const name = String(p.name == null ? '' : p.name);
  const id = String(p.id == null ? '' : p.id);
  const isHost = !!p.isHost;
  // WHY exact `===` mirror of pre-7.5 ui-render.js:63 (not a != null guard):
  // behaviour-identical label for every real (id, myPlayerId) pair.
  const isYou = p.id === myPlayerId;
  const isBot = !!p.isBot;
  const wins = (Number.isFinite(p.wins) && p.wins > 0) ? p.wins : 0;

  const hash = _djb2(name + ':' + id);
  const accentHue = hash % 360;
  const accentEmoji = ACCENT_EMOJI[hash % ACCENT_EMOJI.length];

  let label = name;
  if (isYou) label += ' (You)';
  if (isHost) label += ' 👑';
  if (wins > 0) label += ` • ${wins} 🏆`;

  return { name, isHost, isYou, isBot, wins, accentHue, accentEmoji, label };
}

/**
 * Pure Roll-Camera start-button model. Owns the start-gating truth-table.
 *
 * WHY identical gating, re-voiced copy only: the button is enabled IFF
 * (canStart && amIHost), with canStart = solo ? players>=1 : players>=2 —
 * byte-identical to the pre-7.5 ui-render.js logic. ONLY the text changes
 * (the 7.5 premiere voice) + a variant hook for the Task-2 CSS. This makes
 * the behaviour change provably nil (same discipline as 7.4 Task 0's
 * themesSystem copy re-voice with a behavioural-contract guard).
 */
export function rollCameraLabel(args) {
  const a = args || {};
  const amIHost = !!a.amIHost;
  const mode = a.mode || 'classic';
  const playerCount = Number.isFinite(a.playerCount) ? a.playerCount : 0;
  const canStart = mode === 'solo' ? playerCount >= 1 : playerCount >= 2;

  if (canStart && amIHost) {
    return { text: '🎬 Roll Camera', disabled: false, variant: 'ready' };
  }
  if (canStart && !amIHost) {
    return { text: 'Waiting for the director…', disabled: true, variant: 'waiting-host' };
  }
  return { text: 'Waiting for the cast…', disabled: true, variant: 'waiting-cast' };
}

/**
 * Split a room code into single-character marquee cells. Pure; non-string
 * or empty → []. WHY a tested primitive even though the Task-1 glue renders
 * the marquee via CSS on the wrapper (keeping the cross-module-shared
 * `lobbyCodeDisplay.innerText` contract byte-identical for zero socket-
 * handler regression): this keeps the seam complete + symmetrical and the
 * empty/garbage cases unit-pinned for any per-cell treatment.
 */
export function marqueeSegments(code) {
  if (typeof code !== 'string' || code.length === 0) return [];
  return code.split('');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/mm-phase7-5 && npx jest client-tests/red-carpet.test.js`
Expected: PASS — all `describe` blocks green.

- [ ] **Step 5: Run the full suite (zero pre-existing regression)**

Run: `cd C:/mm-phase7-5 && npx jest`
Expected: all green; the new `red-carpet.test.js` suite added; the 52/395 post-7.4 baseline suites all still pass (additive).

- [ ] **Step 6: Branch-verify and commit**

```bash
cd C:/mm-phase7-5 && B=$(git branch --show-current) && [ "$B" = "phase7-5-red-carpet-lobby" ] && git add public/js/ui/red-carpet.js client-tests/red-carpet.test.js && git commit -m "Phase 7.5 (0): pure Red Carpet seams — diffArrivals / playerCardModel / rollCameraLabel / marqueeSegments + unit suite

Pure zero-import module: arrival diff (entrance-once), deterministic
device-local per-player accent (djb2 over name+socket-id, NEVER stableId
— sentinel-tested), Roll-Camera gating byte-identical to pre-7.5 (copy
re-voiced only), marquee segmentation. No barrel/glue yet.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1: Barrel export + `renderLobby` glue + `index.html` wrappers + jsdom render test

**Goal:** Wire the pure seam into the lobby: barrel-export `red-carpet.js`, rewrite the `renderLobby` player-row build into Red Carpet entrance cards (animation only on diffed arrivals), re-voice the Start button to Roll-Camera, group the host controls into a presentational Director panel, add the marquee + premiere copy in `index.html` (all existing ids preserved), migrate the bounded `#waiting-room` inline styles, and pin it all with a new jsdom render test — keeping `render-lobby.test.js` and every other pre-existing suite byte-identically green.

**Files:**
- Modify: `C:\mm-phase7-5\public\js\ui.js` (barrel, +1 line after the Phase-7.4 daily-ritual line)
- Modify: `C:\mm-phase7-5\public\js\ui\ui-render.js` (direct sibling import; module-scoped `_seenPlayerIds`; the `renderLobby` player-row + settings-display + start-gating blocks)
- Modify: `C:\mm-phase7-5\public\index.html` (`#waiting-room` ~242-300: marquee wrapper, premiere copy, Director-panel wrapper, bounded inline-style removal — all ids preserved; `#team-screen` and everything else untouched)
- Create (test): `C:\mm-phase7-5\client-tests\red-carpet-render.test.js`

**Acceptance Criteria:**
- [ ] `ui.js` re-exports `./ui/red-carpet.js` (+WHY); `ui-render.js` imports it via a **direct sibling** `./red-carpet.js` (no `../ui.js` barrel cycle — 7.3 DAG; mirrors 7.4 `ui-panels.js → ./daily-ritual.js`).
- [ ] `renderLobby`: module-scoped page-session `_seenPlayerIds`; each row is an `<li class="entrance-card …">` inside `#lobby-players` with `--card-accent`, an emoji chip, the exact `label`, and `.is-entering` **only** for diffed arrivals; the `.bot-badge` and `.btn-kick` (condition + emit) are byte-identical; the inline `li.style.cssText`, `lobbySettings.style.display`, `startBtn.style.display` writes are removed (bounded DS-01) and the now-dead `lobbySettings` `ui-dom.js` import is dropped; team-mode early return untouched; WHY comments on every change.
- [ ] Start button driven by `rollCameraLabel` (`.roll-camera` + `roll-camera--{variant}` classes, text, disabled) — enable/disable byte-identical to pre-7.5.
- [ ] `index.html`: `.marquee`/`.marquee__title` wrapper around the room-code `<h2>`; premiere `<p>` copy; `.director-panel` + `.director-panel__header` wrapping the existing mode-selector + lobby-settings + start-btn; `.theme-select` + `.waiting-public-toggle` classes replacing those inline styles; `style="display:none;"` removed from `#lobby-settings` and `#start-btn`. **Every existing `id` preserved.** `#team-screen` untouched.
- [ ] New `client-tests/red-carpet-render.test.js` green; `client-tests/render-lobby.test.js` and all other pre-existing suites **byte-identical and green**; full `npx jest` green, additive, zero pre-existing regression.

**Verify:** `cd C:/mm-phase7-5 && npx jest client-tests/red-carpet-render.test.js client-tests/render-lobby.test.js` → all green; then `cd C:/mm-phase7-5 && npx jest` → all green (additive over 52/395, zero pre-existing failures).

**Steps:**

- [ ] **Step 1: Write the failing test** — create `C:\mm-phase7-5\client-tests\red-carpet-render.test.js`:

```js
/**
 * @jest-environment jsdom
 */
// Phase 7.5 — Red Carpet glue (renderLobby). WHY: prove the entrance
// animation fires ONCE per real arrival (never on the idempotent re-render
// every settings toggle / stateUpdate triggers), the host-crown / kick /
// Director controls are byte-identically preserved, NO stableId reaches
// #waiting-room, and the team path is untouched.
const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
const mockEmit = jest.fn();
jest.mock('../public/js/state.js', () => ({
  getSocket: () => ({ emit: mockEmit }),
  getCurrentLobbyId: () => 'TEST01',
}));
import { initUIElements, renderLobby } from '../public/js/ui.js';

describe('renderLobby — Red Carpet entrance cards', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('first render: every player .is-entering; cards carry accent + emoji', () => {
    renderLobby(makeWaitingState(), 'host_id');
    const cards = document.querySelectorAll('#lobby-players li.entrance-card');
    expect(cards.length).toBe(2);
    cards.forEach(c => {
      expect(c.classList.contains('is-entering')).toBe(true);
      expect(c.style.getPropertyValue('--card-accent')).not.toBe('');
      expect(c.querySelector('.entrance-card__emoji').textContent).not.toBe('');
    });
  });

  test('re-render with the SAME roster → zero .is-entering (no replay)', () => {
    const state = makeWaitingState();
    renderLobby(state, 'host_id');
    renderLobby(state, 'host_id'); // e.g. a settings toggle re-render
    expect(document.querySelectorAll('#lobby-players li.is-entering').length).toBe(0);
  });

  test('only a newly-joined player animates on the next render', () => {
    const s1 = makeWaitingState();
    renderLobby(s1, 'host_id');
    const s2 = makeWaitingState({
      players: [...s1.players, makePlayer({ id: 'new_id', name: 'Newcomer' })],
    });
    renderLobby(s2, 'host_id');
    const entering = [...document.querySelectorAll('#lobby-players li.is-entering')];
    expect(entering.length).toBe(1);
    expect(entering[0].textContent).toContain('Newcomer');
  });

  test('host crown + kick wiring preserved byte-identically (zero-regression)', () => {
    renderLobby(makeWaitingState(), 'host_id');
    const items = document.querySelectorAll('#lobby-players li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Host');
    expect(items[0].textContent).toContain('👑');
    expect(items[0].querySelector('.btn-kick')).toBeNull();
    const kick = items[1].querySelector('.btn-kick');
    expect(kick).not.toBeNull();
    kick.click();
    expect(mockEmit).toHaveBeenCalledWith('kickPlayer', { lobbyId: 'TEST01', targetId: 'guest_id' });
  });

  test('Director panel present; Roll-Camera gating byte-identical', () => {
    renderLobby(makeWaitingState(), 'host_id'); // host, 2 players, classic
    expect(document.querySelector('.director-panel')).not.toBeNull();
    const start = document.getElementById('start-btn');
    expect(start.classList.contains('roll-camera')).toBe(true);
    expect(start.disabled).toBe(false);
    expect(start.textContent).toContain('Roll Camera');
    renderLobby(makeWaitingState(), 'guest_id'); // non-host → disabled
    expect(document.getElementById('start-btn').disabled).toBe(true);
  });

  test('SECURITY: no stableId substring anywhere in #waiting-room', () => {
    const state = makeWaitingState();
    state.players.forEach(p => { p.stableId = 'p_LEAK_' + p.id; });
    renderLobby(state, 'host_id');
    expect(document.getElementById('waiting-room').innerHTML).not.toContain('p_LEAK_');
  });

  test('team mode: no entrance cards built (team early-return untouched)', () => {
    renderLobby(makeWaitingState({ gameMode: 'team' }), 'host_id');
    expect(document.querySelectorAll('#lobby-players li.entrance-card').length).toBe(0);
    expect(document.querySelectorAll('#team-red-list li, #team-blue-list li').length)
      .toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/mm-phase7-5 && npx jest client-tests/red-carpet-render.test.js`
Expected: FAIL — no `.entrance-card` / `.director-panel` / `.roll-camera` produced (glue not wired yet); assertions fail.

- [ ] **Step 3a: Barrel export** — in `C:\mm-phase7-5\public\js\ui.js`, add one line immediately after the Phase-7.4 daily-ritual export (current line 13):

Find:
```js
export * from './ui/daily-ritual.js';   // Phase 7.4: pure daily-ritual seams (countdown + streak)
```
Replace with:
```js
export * from './ui/daily-ritual.js';   // Phase 7.4: pure daily-ritual seams (countdown + streak)
export * from './ui/red-carpet.js';   // Phase 7.5: pure Red Carpet seams (arrival diff / card model / Roll-Camera gating / marquee)
```

- [ ] **Step 3b: Direct sibling import** — in `C:\mm-phase7-5\public\js\ui\ui-render.js`, add the import immediately after the existing `clearGhostAttempt` import (current line 28):

Find:
```js
import { clearGhostAttempt } from './ui-notifications.js';
```
Replace with:
```js
import { clearGhostAttempt } from './ui-notifications.js';
// Phase 7.5: pure Red Carpet seams. Direct sibling import (NOT via the
// ./ui.js barrel) — ui-render.js is itself re-exported by that barrel, so a
// barrel import here would be a cycle (7.3 DAG discipline; mirrors the 7.4
// ui-panels.js → ./daily-ritual.js precedent).
import { diffArrivals, playerCardModel, rollCameraLabel } from './red-carpet.js';

// Phase 7.5 Red Carpet: page-session set of player ids whose entrance card
// has already been shown, so the entrance animation plays ONCE per real
// arrival (renderLobby re-runs on EVERY stateUpdate/rejoin — idempotent).
// Module-scoped, NOT persisted, NO stableId: a full page reload resets it,
// which is the correct first-paint behaviour (everyone "arrives" once).
let _seenPlayerIds = new Set();
```

- [ ] **Step 3c: Rewrite the player-row build** — in `C:\mm-phase7-5\public\js\ui\ui-render.js`, replace the block from `lobbyCodeDisplay.innerText = gameState.id || '';` through the closing `});` of the `gameState.players.forEach` (current lines 55-101) with:

```js
  lobbyCodeDisplay.innerText = gameState.id || '';

  // Phase 7.5 Red Carpet: which players are *newly arriving* this page
  // session? diffArrivals is pure; the seen-set is page-session module
  // state (NOT persisted) so the entrance animation fires once on a real
  // join — never replayed on the idempotent re-render every settings
  // toggle / stateUpdate triggers.
  const { entering, seen } = diffArrivals(_seenPlayerIds, gameState.players);
  _seenPlayerIds = new Set(seen);

  lobbyPlayersList.innerHTML = '';
  gameState.players.forEach(p => {
    // Phase 7.5: the row is now a Red Carpet "entrance card". The <li> +
    // #lobby-players container + the textual label + the .bot-badge + the
    // .btn-kick (same condition, same emit) are PRESERVED byte-for-byte so
    // the existing render-lobby.test.js zero-regression guard stays green;
    // the accent/emoji/animation are an ADDITIVE visual layer. The old
    // inline li.style.cssText is removed — flex/align/justify now lives in
    // the additive .entrance-card CSS (bounded DS-01, confined to the row
    // we rewrite here).
    const card = playerCardModel(p, { myPlayerId });
    const li = document.createElement('li');
    li.className = 'entrance-card'
      + (card.isYou ? ' is-you' : '')
      + (card.isHost ? ' is-host' : '')
      + (card.isBot ? ' is-bot' : '')
      + (entering.includes(p.id) ? ' is-entering' : '');
    // WHY a CSS custom property (not a style rule): --card-accent is a
    // per-player DATA value (the deterministic hue), not style debt — the
    // same pattern modal.js uses; the .entrance-card rule consumes it via
    // hsl(var(--card-accent) ...). Room-scoped (name+socket-id), NO stableId.
    li.style.setProperty('--card-accent', String(card.accentHue));

    const emoji = document.createElement('span');
    emoji.className = 'entrance-card__emoji';
    emoji.setAttribute('aria-hidden', 'true'); // decorative — name carries identity
    emoji.textContent = card.accentEmoji;
    li.appendChild(emoji);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'entrance-card__name';
    nameSpan.textContent = card.label; // EXACT prior label semantics
    li.appendChild(nameSpan);

    // Phase 5a (preserved verbatim): a bot is always visibly a bot — name +
    // a BOT badge with difficulty. Separate span so the additive .bot-badge
    // CSS styles it without touching player-row rules.
    if (p.isBot) {
      const badge = document.createElement('span');
      badge.className = 'bot-badge';
      const diff = p.difficulty || 'normal';
      badge.textContent = `BOT · ${diff.charAt(0).toUpperCase()}${diff.slice(1)}`;
      li.appendChild(badge);
    }

    if (amIHost && p.id !== myPlayerId) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'btn-kick';
      kickBtn.title = 'Remove from lobby';
      kickBtn.textContent = '✕';
      kickBtn.addEventListener('click', () => {
        // Phase 5a (preserved verbatim): bots → removeBot, humans →
        // kickPlayer. Same ✕ affordance, same emit payload.
        if (p.isBot) {
          getSocket().emit('removeBot', { lobbyId: gameState.id, targetId: p.id });
        } else {
          getSocket().emit('kickPlayer', { lobbyId: gameState.id, targetId: p.id });
        }
      });
      li.appendChild(kickBtn);
    }

    lobbyPlayersList.appendChild(li);
  });
```

- [ ] **Step 3d: Remove the bounded inline settings-display write + its now-dead import**

First, verify `lobbySettings` is written nowhere else (use the **Grep tool**, not bash grep — this env mangles bash text tools): Grep `lobbySettings` in `public/js` → expect exactly TWO hits, both in `ui-render.js` (the import-list line 16 and the `lobbySettings.style.display = 'flex';` line 103). If any OTHER writer exists, STOP and report — do not widen scope.

Then in `C:\mm-phase7-5\public\js\ui\ui-render.js`, remove the now-dead import symbol. Find:
```js
  lobbyCodeDisplay, lobbyPlayersList, lobbySettings,
```
Replace with:
```js
  lobbyCodeDisplay, lobbyPlayersList,
```

And replace the line (current line 103):
```js
  lobbySettings.style.display = 'flex';
```
with:
```js
  // Phase 7.5 (bounded DS-01): the inline `lobbySettings.style.display =
  // 'flex'` write + the index.html style="display:none;" are removed (and
  // the now-unused `lobbySettings` ui-dom import dropped above) — the
  // existing `.lobby-settings` rule (02-hero-lobby.css) is already
  // `display:flex`, and the block only needs to be hidden while its
  // ancestor #waiting-room is `.hidden` (the screen system handles that,
  // and #waiting-room ships with class="hidden" so there is no FOUC). Net
  // rendered result is identical; one less inline-style write + one less
  // dead import.
```

- [ ] **Step 3e: Roll-Camera the start button** — in `C:\mm-phase7-5\public\js\ui\ui-render.js`, replace the start-gating block (current lines 138-152, from `const canStart = ...` through the closing `}` of the `else { ... }`):

```js
  const canStart = mode === 'solo' ? gameState.players.length >= 1 : gameState.players.length >= 2;
  startBtn.style.display = 'block'; // Always keep the button in the layout

  if (canStart) {
    if (amIHost) {
      startBtn.innerText = 'Start Match';
      startBtn.disabled = false;
    } else {
      startBtn.innerText = 'Waiting for host...';
      startBtn.disabled = true;
    }
  } else {
    startBtn.innerText = 'Waiting for players...';
    startBtn.disabled = true;
  }
```
with:
```js
  // Phase 7.5 Red Carpet: the Start button becomes "Roll Camera". The
  // ENABLE/DISABLE truth-table is byte-identical to the pre-7.5 logic
  // (rollCameraLabel computes canStart = solo ? >=1 : >=2 and enables only
  // when canStart && amIHost) — ONLY the copy is re-voiced + a variant class
  // for the Task-2 CSS. The old inline startBtn.style.display='block' write
  // + the index.html style="display:none;" are removed (bounded DS-01); the
  // additive .roll-camera rule restores the exact block layout.
  const roll = rollCameraLabel({
    amIHost,
    playerCount: gameState.players.length,
    mode,
  });
  startBtn.classList.add('roll-camera');
  startBtn.classList.remove('roll-camera--ready', 'roll-camera--waiting-host', 'roll-camera--waiting-cast');
  startBtn.classList.add('roll-camera--' + roll.variant);
  startBtn.innerText = roll.text;
  startBtn.disabled = roll.disabled;
```

- [ ] **Step 3f: `index.html` — marquee + premiere copy + migrated public-toggle** — in `C:\mm-phase7-5\public\index.html`, replace the `#waiting-room` panel-header (current lines 243-250):

```html
        <div class="panel-header">
          <h2>Room: <span id="lobby-code-display" class="accent-text"></span></h2>
          <p>Waiting for players...</p>
          <label class="setting-toggle" style="position:absolute; top:0; right:0;" title="List this room on the Public Matchmaking viewer">
            <input type="checkbox" id="public-room-toggle" disabled>
            <span>Public Room</span>
          </label>
        </div>
```
with:
```html
        <div class="panel-header">
          <!-- Phase 7.5 Red Carpet: marquee treatment is CSS on this
               wrapper; #lobby-code-display keeps its id + .accent-text so
               the socketClient 'joined' handler's innerText write is
               byte-identical (zero cross-module regression). -->
          <div class="marquee">
            <h2 class="marquee__title">Room: <span id="lobby-code-display" class="accent-text"></span></h2>
          </div>
          <p>The cast is arriving — take your seats.</p>
          <!-- Phase 7.5 (bounded DS-01): the absolute-position inline style
               moves verbatim to .waiting-public-toggle (same element, no
               competing rule → identical computed position). -->
          <label class="setting-toggle waiting-public-toggle" title="List this room on the Public Matchmaking viewer">
            <input type="checkbox" id="public-room-toggle" disabled>
            <span>Public Room</span>
          </label>
        </div>
```

- [ ] **Step 3g: `index.html` — Director panel wrapper + bounded inline-style removal** — in `C:\mm-phase7-5\public\index.html`, replace the block from the `<!-- MODE SELECTOR -->` comment through the `#start-btn` button (current lines 255-299):

```html
        <!-- MODE SELECTOR -->
        <div id="mode-selector" class="mode-selector">
          <p class="mode-selector-label">Game Mode</p>
          <div class="mode-chips">
            <!-- Phase 4: .btn additive base (cursor:pointer already on mode-chip); zero visual change. -->
            <button class="btn mode-chip active" data-mode="classic" id="mode-chip-classic">
              <span class="mode-chip-icon">⚔️</span>
              <span class="mode-chip-name">Classic</span>
            </button>
            <button class="btn mode-chip" data-mode="team" id="mode-chip-team">
              <span class="mode-chip-icon">🤝</span>
              <span class="mode-chip-name">Team</span>
            </button>
            <button class="btn mode-chip" data-mode="solo" id="mode-chip-solo">
              <span class="mode-chip-icon">🎯</span>
              <span class="mode-chip-name">Solo</span>
            </button>
            <button class="btn mode-chip" data-mode="speed" id="mode-chip-speed">
              <span class="mode-chip-icon">⚡</span>
              <span class="mode-chip-name">Speed</span>
            </button>
          </div>
          <p class="mode-description" id="mode-description">Last player standing wins. Timer shrinks each round.</p>
        </div>

        <div class="lobby-settings" id="lobby-settings" style="display:none;">
          <!-- L1: Theme picker. Host-only — disabled for guests via JS in
               renderLobby. The select is built dynamically from the server's
               theme list to stay in sync with the source of truth. -->
          <label class="setting-toggle">
            <span>Theme <small style="opacity:0.7;">(Filter the candidate pool)</small></span>
            <select id="theme-select" disabled style="margin-left:auto; padding:0.3rem 0.5rem; background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,255,255,0.12); border-radius:6px; font-size:0.85rem;"></select>
          </label>
          <label class="setting-toggle">
            <input type="checkbox" id="hardcore-toggle" disabled>
            <span>Hardcore Mode <small style="opacity:0.7;">(No actor reuse anywhere in chain)</small></span>
          </label>
          <label class="setting-toggle">
            <input type="checkbox" id="tv-shows-toggle" disabled>
            <span>Allow TV Shows <small style="opacity:0.7;">(Include television series)</small></span>
          </label>
        </div>

        <!-- Phase 4: .btn additive base (cursor:pointer already on btn-primary); zero visual change. -->
        <button id="start-btn" class="btn btn-primary" style="display:none;">Start Match</button>
```
with:
```html
        <!-- Phase 7.5 Red Carpet: the host's EXISTING controls grouped into
             one presentational "Director" panel. PRESENTATIONAL ONLY — every
             control id, condition and socket.emit is byte-identical; NO new
             rule/preset/kit mechanic (6c Custom Rule Kits owns that).
             Everyone sees the panel; controls stay disabled for non-hosts
             via the unchanged renderLobby JS (zero behaviour change). -->
        <div class="director-panel">
          <p class="director-panel__header">🎬 Director</p>

          <!-- MODE SELECTOR -->
          <div id="mode-selector" class="mode-selector">
            <p class="mode-selector-label">Game Mode</p>
            <div class="mode-chips">
              <!-- Phase 4: .btn additive base (cursor:pointer already on mode-chip); zero visual change. -->
              <button class="btn mode-chip active" data-mode="classic" id="mode-chip-classic">
                <span class="mode-chip-icon">⚔️</span>
                <span class="mode-chip-name">Classic</span>
              </button>
              <button class="btn mode-chip" data-mode="team" id="mode-chip-team">
                <span class="mode-chip-icon">🤝</span>
                <span class="mode-chip-name">Team</span>
              </button>
              <button class="btn mode-chip" data-mode="solo" id="mode-chip-solo">
                <span class="mode-chip-icon">🎯</span>
                <span class="mode-chip-name">Solo</span>
              </button>
              <button class="btn mode-chip" data-mode="speed" id="mode-chip-speed">
                <span class="mode-chip-icon">⚡</span>
                <span class="mode-chip-name">Speed</span>
              </button>
            </div>
            <p class="mode-description" id="mode-description">Last player standing wins. Timer shrinks each round.</p>
          </div>

          <!-- Phase 7.5 (bounded DS-01): style="display:none;" removed — the
               .lobby-settings rule is already display:flex and the block is
               hidden with its #waiting-room ancestor by the screen system. -->
          <div class="lobby-settings" id="lobby-settings">
            <!-- L1: Theme picker. Host-only — disabled for guests via JS in
                 renderLobby. The select is built dynamically from the
                 server's theme list to stay in sync with the source of
                 truth. -->
            <label class="setting-toggle">
              <span>Theme <small style="opacity:0.7;">(Filter the candidate pool)</small></span>
              <!-- Phase 7.5 (bounded DS-01): the heavy inline style moves
                   verbatim to .theme-select (same element, no competing rule
                   → identical computed style). -->
              <select id="theme-select" class="theme-select" disabled></select>
            </label>
            <label class="setting-toggle">
              <input type="checkbox" id="hardcore-toggle" disabled>
              <span>Hardcore Mode <small style="opacity:0.7;">(No actor reuse anywhere in chain)</small></span>
            </label>
            <label class="setting-toggle">
              <input type="checkbox" id="tv-shows-toggle" disabled>
              <span>Allow TV Shows <small style="opacity:0.7;">(Include television series)</small></span>
            </label>
          </div>

          <!-- Phase 4: .btn additive base. Phase 7.5 (bounded DS-01):
               style="display:none;" removed — the additive .roll-camera rule
               restores display:block; renderLobby drives text/disabled via
               the pure rollCameraLabel. -->
          <button id="start-btn" class="btn btn-primary">Start Match</button>
        </div>
```

- [ ] **Step 4: Run the new test + the zero-regression guard**

Run: `cd C:/mm-phase7-5 && npx jest client-tests/red-carpet-render.test.js client-tests/render-lobby.test.js`
Expected: PASS — both suites green (`render-lobby.test.js` unchanged and still passing proves zero behavioural regression).

- [ ] **Step 5: Run the full suite (zero pre-existing regression)**

Run: `cd C:/mm-phase7-5 && npx jest`
Expected: all green; `red-carpet.test.js` + `red-carpet-render.test.js` added; every 52/395 pre-existing suite still passes (esp. `socket-handlers`, `showScreen`, `modal-factory`, `name-prompts`, all `server/**`).

- [ ] **Step 6: Branch-verify and commit**

```bash
cd C:/mm-phase7-5 && B=$(git branch --show-current) && [ "$B" = "phase7-5-red-carpet-lobby" ] && git add public/js/ui.js public/js/ui/ui-render.js public/index.html client-tests/red-carpet-render.test.js && git commit -m "Phase 7.5 (1): renderLobby Red Carpet glue + barrel + index.html wrappers

Barrel-export red-carpet.js; thin renderLobby glue (entrance cards,
animation only on diffed arrivals via page-session _seenPlayerIds;
Roll-Camera gating byte-identical, copy re-voiced; bounded DS-01 inline
removal). index.html: marquee wrapper, premiere copy, presentational
Director panel, .theme-select/.waiting-public-toggle classes — all ids
preserved, #team-screen untouched. render-lobby.test.js byte-identical
and still green = zero-regression proof.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Append-only Red Carpet CSS section

**Goal:** Append the Red-Carpet styles to `public/css/02-hero-lobby.css` — marquee, entrance card + states + `@keyframes cardEntrance` (transform/opacity only), Director panel, the migrated `.theme-select`/`.waiting-public-toggle`, and the `.roll-camera` variants — append-only (no existing rule edited), token-driven, reduced-motion auto-covered by the existing global block.

**Files:**
- Modify: `C:\mm-phase7-5\public\css\02-hero-lobby.css` (append a new section at EOF — current last content line is 728 `.bot-thinking`)

**Acceptance Criteria:**
- [ ] Section appended at EOF; **no existing rule above is edited, reordered, or removed** (`git diff` shows only additions after the current `.bot-thinking` block).
- [ ] `@keyframes cardEntrance` animates **only** `opacity` + `transform` (compositor-safe; no width/layout/colour).
- [ ] `.theme-select` reproduces the removed inline declarations; `.waiting-public-toggle` reproduces `position:absolute;top:0;right:0;`; `.roll-camera` sets `display:block` (restores the removed inline/JS display).
- [ ] Uses `01-base.css` tokens where they apply; no per-rule `prefers-reduced-motion` (the global `06-states-anim.css` block auto-covers it).
- [ ] Full `npx jest` still green (CSS is not unit-tested; this confirms nothing else broke). The visual / reduced-motion eyeball is user-side (jsdom never lays out).

**Verify:** `cd C:/mm-phase7-5 && npx jest` → all green (additive over 52/395, zero regressions). Visual + reduced-motion verification is user-side (flagged, not blocking).

**Steps:**

- [ ] **Step 1: Append the Red Carpet section** — at the END of `C:\mm-phase7-5\public\css\02-hero-lobby.css` (after the current final `.bot-thinking { … }` rule at lines 722-727 and the trailing blank line 728-729), append:

```css
/* =============================================
   PHASE 7.5 — RED CARPET LOBBY (APPEND-ONLY)
   WHY append-only: no rule above is edited or reordered — the six-partial
   cascade is load-bearing. Every selector here is NEW; classic lobbies
   render byte-identically except where renderLobby now adds these classes.
   cardEntrance is transform/opacity ONLY (compositor-safe — the vanilla
   perf budget) and is auto-neutralised by the existing global
   prefers-reduced-motion block in 06-states-anim.css (no per-rule handling
   needed; the card is fully legible with zero motion).
   ============================================= */

/* Marquee room code — theatrical "now showing" header. CSS-only treatment
   on the index.html wrapper; #lobby-code-display keeps its id + innerText
   (zero socketClient regression). */
.marquee {
  text-align: center;
  margin-bottom: 0.5rem;
}
.marquee__title {
  font-size: 1.35rem;
  font-weight: 700;
}
.marquee__title #lobby-code-display {
  display: inline-block;
  letter-spacing: 0.26em;
  padding-left: 0.26em; /* balance trailing letter-spacing so it stays centred */
  color: var(--accent-primary);
  text-shadow: var(--shadow-glow);
}

/* Player Entrance Card. The row is still <li> inside #lobby-players (the
   existing #lobby-players li base rule still applies — padding/bg/border/
   radius/margin/font); these ADD the red-carpet layer. --card-accent is
   the per-player hue (a data value the glue sets inline, not style debt). */
#lobby-players li.entrance-card {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  /* Quiet per-player identity cue from the deterministic hue; the token bg
     from the base rule is unchanged so contrast/legibility is preserved. */
  border-left: 3px solid hsl(var(--card-accent, 240), 60%, 60%);
}
.entrance-card__emoji {
  font-size: 1.1rem;
  line-height: 1;
  flex: 0 0 auto;
}
.entrance-card__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere; /* long names wrap inside the fixed-width panel */
}
.entrance-card.is-you {
  border-left-color: var(--accent-primary);
}
.entrance-card.is-entering {
  /* Under the global prefers-reduced-motion block animation-duration is
     forced to ~0 so the card simply appears at its natural end-state —
     fully legible, zero motion. `both` keeps the from-state only while the
     (near-instant under RM) animation runs. */
  animation: cardEntrance 0.34s ease-out both;
}
@keyframes cardEntrance {
  from { opacity: 0; transform: translateY(8px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

/* Director panel — presentational grouping of the EXISTING host controls.
   No new mechanic (6c dedup). Everyone sees it; controls stay disabled for
   non-hosts via the unchanged renderLobby JS. */
.director-panel {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-base);
  padding: 1rem;
  margin-top: 1rem;
}
.director-panel__header {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent-primary);
  margin-bottom: 0.75rem;
}
/* The mode-selector inside the panel no longer needs its own top divider —
   the panel border supplies separation. Additive override scoped to the
   panel; the base .mode-selector rule is untouched for any other context. */
.director-panel .mode-selector {
  border-top: none;
  padding-top: 0;
  margin-top: 0;
}

/* Theme select — migrated VERBATIM from the index.html inline style
   (bounded DS-01; same element, no competing rule → identical computed
   style). --radius-sm == 6px (exact match to the old literal). */
.theme-select {
  margin-left: auto;
  padding: 0.3rem 0.5rem;
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
}

/* Public-room toggle — migrated VERBATIM from the index.html inline style
   (same element, no competing rule → identical computed position). */
.waiting-public-toggle {
  position: absolute;
  top: 0;
  right: 0;
}

/* Roll Camera — the re-voiced Start button. WHY display:block here: the
   pre-7.5 code forced startBtn.style.display='block'; that inline write +
   the index.html style="display:none" were removed (bounded DS-01) so this
   additive rule restores the EXACT block layout. .btn-primary still
   supplies all colour/sizing; this only adds the cinematic variant cue. */
.roll-camera {
  display: block;
}
.roll-camera--ready {
  box-shadow: var(--shadow-glow-strong);
}
.roll-camera--waiting-host,
.roll-camera--waiting-cast {
  box-shadow: none;
}
```

- [ ] **Step 2: Verify append-only (no existing rule touched)**

Run: `cd C:/mm-phase7-5 && git diff --numstat public/css/02-hero-lobby.css`
Expected: a single line `<N>\t0\tpublic/css/02-hero-lobby.css` — the **second column (deletions) is `0`**, proving the change is purely additive (no existing rule edited/reordered/removed). If deletions > 0, STOP and report.

- [ ] **Step 3: Run the full suite (zero regression)**

Run: `cd C:/mm-phase7-5 && npx jest`
Expected: all green; additive over 52/395; zero pre-existing failures.

- [ ] **Step 4: Branch-verify and commit**

```bash
cd C:/mm-phase7-5 && B=$(git branch --show-current) && [ "$B" = "phase7-5-red-carpet-lobby" ] && git add public/css/02-hero-lobby.css && git commit -m "Phase 7.5 (2): append-only Red Carpet CSS (marquee / entrance card / Director panel / Roll-Camera)

Appended at EOF — no existing rule edited or reordered (cascade is
load-bearing). @keyframes cardEntrance is transform/opacity only
(compositor-safe perf budget; auto-neutralised by the existing global
prefers-reduced-motion block). .theme-select / .waiting-public-toggle /
.roll-camera reproduce the removed inline styles verbatim (bounded DS-01,
identical computed style/layout). Visual + reduced-motion eyeball is
user-side (jsdom never lays out).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Post-implementation

After all 3 tasks: per-task two-stage review (spec-compliance THEN code-quality) with real fix-loops, then a final opus whole-branch holistic. When GO → `superpowers-extended-cc:finishing-a-development-branch` (push the branch + `gh pr create --base main`; PR-merge / push-to-main / Render deploy is classifier-gated and handed to the user; preserve the worktree per Option 2 until merge; post-merge reconcile mirrors 7.1–7.4). Real-boot/in-browser eyeball is user-side: the marquee, the entrance animation on desktop + mobile + with OS reduced-motion, the Director-panel layout, the Roll-Camera states.

**Out of scope / deferred (recorded — do NOT widen 7.5):** QR scan-to-join; team-screen (`renderTeamScreen`/`#team-screen`) Red Carpet parity (team mode renders byte-identical); blanket DS-01 long-tail (only `#waiting-room`-rewritten inline styles migrated — `socketClient.js:191`, leaderboard/my-stats/daily-result inline styles, bulk `index.html` static `style=`, the inline `<style>` remain DS-01 "pass 2"); Playable Hero (own brainstorm gate). Findings here → `spawn_task`, never widen scope.
