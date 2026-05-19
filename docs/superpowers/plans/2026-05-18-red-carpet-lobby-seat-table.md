# Red Carpet Lobby "Seat-Table" Redesign — Implementation Plan (Phase 7.5.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 7.5 accent-colour collision and the 7-player vertical overflow by giving each player a distinct seat-palette colour and re-laying the waiting room as a Director left-sidebar + responsive seat-tile grid (mobile-stacked) — strictly client-only, additive, zero-regression.

**Architecture:** Pure-seam discipline (7.2–7.5). The ONLY logic change is in the pure zero-import `red-carpet.js` (a frozen `SEAT_HUES` palette + a slot-indexed `playerCardModel`). `ui-render.js` gains a one-line slot-threading glue. `index.html` gains exactly ONE additive `.lobby-stage` wrapper. `02-hero-lobby.css` reworks **only its own 7.5 section** (lines ≥729) + appends a new Seat-Table layout subsection — no pre-7.5 rule edited. The sacrosanct zero-regression guards (`render-lobby.test.js`, `red-carpet-render.test.js`) stay UNEDITED & byte-green.

**Tech Stack:** Vanilla ES-module client (no build), Jest 30 + jest-environment-jsdom, plain CSS partials (load order load-bearing). Worktree `C:\mm-phase7-5-1`, branch `phase7-5-1-seat-table-redesign`, off post-#31 `origin/main 9165761` (node_modules junctioned).

**Binding spec:** `docs/superpowers/specs/2026-05-18-red-carpet-lobby-seat-table-design.md` (committed `da131df`). §8 guardrails + §10 acceptance are the spec-compliance bar.

**Cross-cutting rules (every task):**
- Verify `git -C C:/mm-phase7-5-1 branch --show-current` == `phase7-5-1-seat-table-redesign` **before every commit** (a parallel Codex agent shares the repo).
- Every code change ships a WHY comment.
- Client-only: NO server/socket/scoring/validation/theme-mechanic/Redis/persistence/accounts change. Accent never derived from `stableId`. Team-mode render path byte-identical.
- Per-task `verifyCommand` PLUS the full `cd C:/mm-phase7-5-1 && npx jest` must stay green & **additive** over the post-#31 baseline (**54 suites / 426 tests**); zero pre-existing-suite regression. `render-lobby.test.js` / `red-carpet-render.test.js` / socket-handlers / showScreen / modal-factory / name-prompts / all `server/**` stay **byte-identical** (do NOT edit them).
- Out-of-scope findings → `spawn_task` chip, never widen 7.5.1.
- Tasks are linear: **Task 0 → Task 1 (blockedBy 0) → Task 2 (blockedBy 1)** (shared files).

---

### Task 0: Pure `red-carpet.js` — `SEAT_HUES` slot palette + slot-indexed `playerCardModel` + updated unit suite

**Goal:** Replace the collision-prone hash-hue with a frozen 8-entry seat palette indexed by the player's slot; everything else byte-identical; the model's own unit suite tracks the new contract via TDD.

**Files:**
- Modify: `public/js/ui/red-carpet.js` (add `SEAT_HUES`; `playerCardModel` reads `opts.slot`)
- Modify: `client-tests/red-carpet.test.js` (7.5's OWN unit suite — legitimately tracks the model contract change; NOT the sacrosanct guard)

**Acceptance Criteria:**
- [ ] `SEAT_HUES` exported & `Object.isFrozen`; length 8; every entry `Number.isInteger` in `[0,359]`; pairwise-distinct.
- [ ] `playerCardModel(player, {myPlayerId, slot})` → `accentHue = SEAT_HUES[((slot%8)+8)%8]`; slots 0..7 → 8 distinct hues; defensive for non-finite/negative/non-integer/absent slot (never throws, always in-range).
- [ ] Colour reads ZERO identity: two different identities at the same slot get the SAME `accentHue`; a `stableId` on the input never changes any field (sentinel).
- [ ] `name/isHost/isYou/isBot/wins/accentEmoji/label` byte-identical to 7.5; `accentEmoji` still `ACCENT_EMOJI[djb2(name+':'+id)%12]`; `diffArrivals/rollCameraLabel/marqueeSegments` unchanged.
- [ ] `npx jest client-tests/red-carpet.test.js` green; full `npx jest` green & additive (zero pre-existing-suite regression).

**Verify:** `cd C:/mm-phase7-5-1 && npx jest client-tests/red-carpet.test.js` → all green; then `cd C:/mm-phase7-5-1 && npx jest` → all green, 0 pre-existing regressions.

**Steps:**

- [ ] **Step 1: Rewrite the `playerCardModel` describe block + add a `SEAT_HUES` describe block (failing test first).**

Replace the ENTIRE `client-tests/red-carpet.test.js` file with the following (the `diffArrivals`, `rollCameraLabel`, `marqueeSegments` blocks are byte-identical to current; only the import line, the `playerCardModel` block, and a new `SEAT_HUES` block change):

```js
/**
 * @jest-environment jsdom
 */
// Phase 7.5 — Red Carpet Lobby pure seams. WHY: the arrival diff, the
// device-local per-player accent, and the re-voiced Roll-Camera gating must
// be pure + unit-pinned (deterministic, defensive, NO stableId) BEFORE any
// glue wires them into renderLobby. jsdom docblock = client-tests dir
// convention; this module is pure so no DOM is touched.
// Phase 7.5.1 (Seat-Table): the accent COLOUR contract changed from a djb2
// hash hue to a frozen SEAT_HUES palette indexed by the player's seat slot
// (fixes the live collision where two identities shared a colour). This is
// 7.5's OWN unit suite legitimately tracking the model contract change — it
// is NOT the sacrosanct render-lobby.test.js zero-regression guard.
import {
  diffArrivals,
  playerCardModel,
  rollCameraLabel,
  marqueeSegments,
  ACCENT_EMOJI,
  SEAT_HUES,
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
  test('id guard: defined non-null id (0 or empty string) is a valid id (not skipped)', () => {
    expect(diffArrivals(new Set(), [{ id: 0 }, { id: 'b' }]).seen).toEqual([0, 'b']);
  });
  test('does not mutate inputs (purity)', () => {
    const seen = new Set(['a']);
    const players = [{ id: 'a' }, { id: 'b' }];
    diffArrivals(seen, players);
    expect([...seen]).toEqual(['a']);
    expect(players).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});

describe('SEAT_HUES (Phase 7.5.1 seat palette)', () => {
  test('frozen array of exactly 8 integer hues in [0,359]', () => {
    expect(Array.isArray(SEAT_HUES)).toBe(true);
    expect(SEAT_HUES).toHaveLength(8);
    expect(Object.isFrozen(SEAT_HUES)).toBe(true);
    SEAT_HUES.forEach(h => {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(359);
    });
  });
  test('all 8 hues are pairwise-distinct (no collision possible for a full lobby)', () => {
    expect(new Set(SEAT_HUES).size).toBe(8);
  });
});

describe('playerCardModel', () => {
  test('deterministic: same input + same slot → identical model across calls', () => {
    const p = { id: 's1', name: 'Ada', isHost: false, wins: 0 };
    expect(playerCardModel(p, { myPlayerId: 'x', slot: 3 }))
      .toEqual(playerCardModel(p, { myPlayerId: 'x', slot: 3 }));
  });
  test('accentHue is the seat palette entry; integer 0..359; emoji ∈ frozen 12-set', () => {
    const m = playerCardModel({ id: 's1', name: 'Ada' }, { slot: 2 });
    expect(m.accentHue).toBe(SEAT_HUES[2]);
    expect(Number.isInteger(m.accentHue)).toBe(true);
    expect(m.accentHue).toBeGreaterThanOrEqual(0);
    expect(m.accentHue).toBeLessThanOrEqual(359);
    expect(ACCENT_EMOJI).toHaveLength(12);
    expect(Object.isFrozen(ACCENT_EMOJI)).toBe(true);
    expect(ACCENT_EMOJI).toContain(m.accentEmoji);
  });
  test('slots 0..7 → the 8 distinct palette hues (collision-free for a full lobby)', () => {
    const hues = [0, 1, 2, 3, 4, 5, 6, 7].map(
      slot => playerCardModel({ id: 's' + slot, name: 'N' + slot }, { slot }).accentHue
    );
    expect(hues).toEqual([...SEAT_HUES]);
    expect(new Set(hues).size).toBe(8);
  });
  test('colour reads ZERO identity: different identities at the SAME slot → SAME hue', () => {
    // WHY: this is the anti-collision guarantee. The 7.5 bug was identity-derived
    // hues colliding; the colour now depends ONLY on the seat slot.
    const a = playerCardModel({ id: 'aaa', name: 'Kurosawa' }, { slot: 4 });
    const b = playerCardModel({ id: 'bbb', name: 'Coppola' }, { slot: 4 });
    expect(a.accentHue).toBe(b.accentHue);
    expect(a.accentHue).toBe(SEAT_HUES[4]);
  });
  test('defensive slot: non-finite / negative / non-integer / absent → valid in-range hue, never throws', () => {
    const base = { id: 's1', name: 'Ada' };
    expect(playerCardModel(base, {}).accentHue).toBe(SEAT_HUES[0]);              // absent
    expect(playerCardModel(base, { slot: undefined }).accentHue).toBe(SEAT_HUES[0]);
    expect(playerCardModel(base, { slot: -1 }).accentHue).toBe(SEAT_HUES[7]);    // negative wraps
    expect(playerCardModel(base, { slot: 8 }).accentHue).toBe(SEAT_HUES[0]);     // >7 wraps (unreachable in prod)
    expect(playerCardModel(base, { slot: 2.5 }).accentHue).toBe(SEAT_HUES[0]);   // non-integer → 0
    expect(playerCardModel(base, { slot: NaN }).accentHue).toBe(SEAT_HUES[0]);
    expect(() => playerCardModel(base, { slot: Infinity })).not.toThrow();
    expect(SEAT_HUES).toContain(playerCardModel(base, { slot: Infinity }).accentHue);
  });
  test('emoji UNCHANGED: deterministic by name+id, independent of slot', () => {
    const s0 = playerCardModel({ id: 's1', name: 'Ada' }, { slot: 0 });
    const s5 = playerCardModel({ id: 's1', name: 'Ada' }, { slot: 5 });
    expect(s0.accentEmoji).toBe(s5.accentEmoji);          // slot does not affect emoji
    expect(ACCENT_EMOJI).toContain(s0.accentEmoji);
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
    expect(playerCardModel(withStable, { myPlayerId: 'x', slot: 1 }))
      .toEqual(playerCardModel(base, { myPlayerId: 'x', slot: 1 }));
  });
  test('defensive: missing name/id/null does not throw', () => {
    expect(() => playerCardModel({}, {})).not.toThrow();
    expect(() => playerCardModel(null, null)).not.toThrow();
    expect(playerCardModel({}, {}).name).toBe('');
  });
  test('label: wins badge only for a positive finite count (defensive)', () => {
    expect(playerCardModel({ id: 'a', name: 'A', wins: 0 }, {}).label).toBe('A');
    expect(playerCardModel({ id: 'b', name: 'B', wins: -4 }, {}).label).toBe('B');
    expect(playerCardModel({ id: 'c', name: 'C', wins: NaN }, {}).label).toBe('C');
    expect(playerCardModel({ id: 'd', name: 'D', wins: Infinity }, {}).label).toBe('D');
    expect(playerCardModel({ id: 'e', name: 'E', wins: 3 }, {}).label).toBe('E • 3 🏆');
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

- [ ] **Step 2: Run the suite to verify it FAILS.**

Run: `cd C:/mm-phase7-5-1 && npx jest client-tests/red-carpet.test.js`
Expected: FAIL — `SEAT_HUES` is `undefined` (not exported) so the `SEAT_HUES` block and the slot tests fail (e.g. "expected 8, received undefined / Object.isFrozen(undefined)"), and `accentHue` is still the hash hue so `m.accentHue` ≠ `SEAT_HUES[2]`.

- [ ] **Step 3: Implement the `red-carpet.js` changes.**

Edit `public/js/ui/red-carpet.js` — **(a)** add the `SEAT_HUES` export immediately after the `ACCENT_EMOJI` block (after the closing `]);` on the current line 22, before the blank line and the `diffArrivals` JSDoc):

```js
// Phase 7.5.1 (Seat-Table redesign): the per-player accent COLOUR is no
// longer a djb2-hash hue. The 7.5 hash%360 collided for distinct identities
// (two bots rendered the same colour on the live site). It is now a SEAT
// slot index into this frozen 8-entry palette, so for any real lobby (the
// server caps it at 8 = host + 7) every player gets a guaranteed-distinct,
// well-separated hue. WHY hues only (not full colours): the existing
// .entrance-card CSS already wraps the value as `hsl(var(--card-accent),
// 60%, 60%)`, so keeping the contract a bare hue integer is the minimal,
// lowest-risk change. The 8 values are perceptually spread around the wheel;
// tests pin length/range/distinctness/frozenness/determinism, NOT the
// specific hue at a specific index (the 7.5 ACCENT_EMOJI over-pinning
// lesson). Colour now reads ZERO identity — a strict strengthening of the
// no-stableId invariant.
export const SEAT_HUES = Object.freeze([350, 25, 45, 140, 188, 220, 270, 312]);
```

**(b)** In `playerCardModel`, replace the three lines that currently compute the hash-driven accent:

```js
  const hash = _djb2(name + ':' + id);
  const accentHue = hash % 360;
  const accentEmoji = ACCENT_EMOJI[hash % ACCENT_EMOJI.length];
```

with:

```js
  // Phase 7.5.1: the accent COLOUR is the player's seat-slot hue (distinct
  // per seat — fixes the 7.5 hash-collision where two identities shared a
  // colour). `slot` is the 0-based render index (renderLobby passes it; host
  // = players[0] = seat 0 → a stable first colour). The double-modulo is
  // DEFENSIVE: a non-finite / negative / non-integer / absent slot still
  // yields a valid in-range index (never undefined, never throws). >7 is
  // unreachable (server caps the lobby at 8) but degrades gracefully.
  const rawSlot = Number.isInteger(opts && opts.slot) ? opts.slot : 0;
  const accentHue =
    SEAT_HUES[((rawSlot % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length];
  // The emoji is UNCHANGED 7.5 behaviour: a secondary cue still derived from
  // the room-scoped name+':'+socket-id ONLY (NEVER stableId). The user
  // flagged colour only; re-indexing the emoji would be needless churn/risk
  // (YAGNI) and emoji repetition is not a defect.
  const hash = _djb2(name + ':' + id);
  const accentEmoji = ACCENT_EMOJI[hash % ACCENT_EMOJI.length];
```

(The `return { name, isHost, isYou, isBot, wins, accentHue, accentEmoji, label };` line is unchanged. `opts` is already safely read via `const myPlayerId = opts && opts.myPlayerId;` so `opts && opts.slot` is undefined-safe.)

- [ ] **Step 4: Run the suite to verify it PASSES.**

Run: `cd C:/mm-phase7-5-1 && npx jest client-tests/red-carpet.test.js`
Expected: PASS (all `diffArrivals`, `SEAT_HUES`, `playerCardModel`, `rollCameraLabel`, `marqueeSegments` tests green).

- [ ] **Step 5: Run the full suite — green & additive.**

Run: `cd C:/mm-phase7-5-1 && npx jest`
Expected: all suites pass; total tests ≥ 426 (the `red-carpet.test.js` count grew, suite count unchanged at this task); `render-lobby.test.js` / `red-carpet-render.test.js` / socket-handlers / showScreen / modal-factory / name-prompts / `server/**` byte-identical and green; zero pre-existing-suite regression.

- [ ] **Step 6: Branch-verify then commit.**

```bash
cd C:/mm-phase7-5-1 && test "$(git branch --show-current)" = "phase7-5-1-seat-table-redesign" && git add public/js/ui/red-carpet.js client-tests/red-carpet.test.js && git commit -m "Phase 7.5.1 (0): SEAT_HUES slot palette — distinct per-player colour

playerCardModel accentHue now indexes a frozen 8-entry SEAT_HUES palette
by the player's seat slot instead of djb2(name+id)%360 (which collided —
e.g. two bots rendered the same colour on the live site). Colour now reads
ZERO identity (strict strengthening of the no-stableId invariant); emoji
unchanged. Defensive double-modulo. 7.5's OWN unit suite updated for the
new model contract; sacrosanct guards untouched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1: Glue (`ui-render.js` slot) + additive `.lobby-stage` wrapper (`index.html`) + new jsdom suite

**Goal:** Thread the seat slot from `renderLobby` into the model, add the ONE structural wrapper, and pin the colour-fix + structure with a new jsdom suite — the sacrosanct guards stay UNEDITED & green.

**Files:**
- Modify: `public/js/ui/ui-render.js` (the `gameState.players.forEach` call — thread `slot`)
- Modify: `public/index.html` (add ONE `.lobby-stage` wrapper around the existing `.players-list-container` + `.director-panel`)
- Create: `client-tests/red-carpet-seat-table.test.js`

**Acceptance Criteria:**
- [ ] `renderLobby` passes `slot` = the 0-based render index to `playerCardModel` (host = players[0] = seat 0).
- [ ] `index.html`: a single `<div class="lobby-stage">` wraps the existing `.players-list-container` and `.director-panel`; ALL existing ids preserved; `.panel-header` stays above it; `#team-screen` untouched.
- [ ] New `client-tests/red-carpet-seat-table.test.js`: 8-player render → 8 DISTINCT `--card-accent` values; host tile `--card-accent` == `String(SEAT_HUES[0])`; `.lobby-stage` present and contains both `.players-list-container` and `.director-panel`; team-mode → zero `#lobby-players li.entrance-card`.
- [ ] `render-lobby.test.js` + `red-carpet-render.test.js` UNEDITED & byte-green; full `npx jest` green & additive (suite count +1, zero pre-existing regression).

**Verify:** `cd C:/mm-phase7-5-1 && npx jest client-tests/red-carpet-seat-table.test.js client-tests/red-carpet-render.test.js client-tests/render-lobby.test.js` → all green; then `cd C:/mm-phase7-5-1 && npx jest` → all green & additive.

**Steps:**

- [ ] **Step 1: Write the new jsdom suite (failing test first).**

Create `client-tests/red-carpet-seat-table.test.js`:

```js
/**
 * @jest-environment jsdom
 */
// Phase 7.5.1 — Seat-Table redesign glue. WHY: prove (a) the live colour
// collision is fixed — a full 8-player lobby yields 8 DISTINCT --card-accent
// values, host = seat 0 = SEAT_HUES[0]; (b) the ONE additive .lobby-stage
// wrapper exists and contains both the players list and the Director panel
// (the desktop sidebar/grid + mobile stack is pure CSS, jsdom can't lay out);
// (c) team-mode still early-returns (no entrance cards / no .lobby-stage build).
const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
const mockEmit = jest.fn();
jest.mock('../public/js/state.js', () => ({
  getSocket: () => ({ emit: mockEmit }),
  getCurrentLobbyId: () => 'TEST01',
}));
import { initUIElements, renderLobby } from '../public/js/ui.js';
import { SEAT_HUES } from '../public/js/ui/red-carpet.js';

const eightPlayers = () => ([
  makePlayer({ id: 'p0', name: 'Host', isHost: true }),
  makePlayer({ id: 'p1', name: 'Bot Bogart', isBot: true }),
  makePlayer({ id: 'p2', name: 'Bot Kurosawa', isBot: true }),
  makePlayer({ id: 'p3', name: 'Bot Coppola', isBot: true }),
  makePlayer({ id: 'p4', name: 'Bot Spielberg', isBot: true }),
  makePlayer({ id: 'p5', name: 'Bot Kubrick', isBot: true }),
  makePlayer({ id: 'p6', name: 'Bot Nolan', isBot: true }),
  makePlayer({ id: 'p7', name: 'Bot Scott', isBot: true }),
]);

describe('renderLobby — Seat-Table redesign', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('full 8-player lobby → 8 DISTINCT --card-accent values (collision fixed)', () => {
    renderLobby(makeWaitingState({ id: 'ST1', players: eightPlayers() }), 'p0');
    const accents = [...document.querySelectorAll('#lobby-players li.entrance-card')]
      .map(li => li.style.getPropertyValue('--card-accent'));
    expect(accents).toHaveLength(8);
    expect(new Set(accents).size).toBe(8);            // no two players share a colour
  });

  test('host is seat 0 → host tile --card-accent == SEAT_HUES[0]', () => {
    renderLobby(makeWaitingState({ id: 'ST2', players: eightPlayers() }), 'p0');
    const first = document.querySelector('#lobby-players li.entrance-card');
    expect(first.textContent).toContain('Host');
    expect(first.style.getPropertyValue('--card-accent')).toBe(String(SEAT_HUES[0]));
  });

  test('ONE additive .lobby-stage wraps the players list AND the Director panel', () => {
    renderLobby(makeWaitingState({ id: 'ST3' }), 'host_id');
    const stage = document.querySelector('#waiting-room .lobby-stage');
    expect(stage).not.toBeNull();
    expect(stage.querySelector('.players-list-container #lobby-players')).not.toBeNull();
    expect(stage.querySelector('.director-panel')).not.toBeNull();
    // #team-screen is a sibling screen, never inside .lobby-stage
    expect(document.querySelector('.lobby-stage #team-screen')).toBeNull();
  });

  test('team mode: early-return untouched — no entrance cards / no stage build', () => {
    renderLobby(makeWaitingState({ gameMode: 'team', id: 'ST4' }), 'host_id');
    expect(document.querySelectorAll('#lobby-players li.entrance-card').length).toBe(0);
    expect(document.querySelectorAll('#team-red-list li, #team-blue-list li').length)
      .toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it FAILS.**

Run: `cd C:/mm-phase7-5-1 && npx jest client-tests/red-carpet-seat-table.test.js`
Expected: FAIL — `.lobby-stage` does not exist yet (`stage` is `null`), and without slot threading the 8 accents are the hash hues (not guaranteed 8-distinct, host ≠ `SEAT_HUES[0]`).

- [ ] **Step 3a: Thread the seat slot in `ui-render.js`.**

In `public/js/ui/ui-render.js`, replace this exact block:

```js
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
```

with:

```js
  lobbyPlayersList.innerHTML = '';
  // Phase 7.5.1 (Seat-Table redesign): thread the 0-based render index as
  // the player's SEAT slot → playerCardModel maps it to a distinct SEAT_HUES
  // colour (fixes the 7.5 hash-collision where two identities shared a hue).
  // The server orders the host first (render-lobby.test.js pins items[0] =
  // host) so the host is seat 0 — a stable first colour. Pure-seam: the
  // ONLY glue change is threading `slot`; the <li>/container/label/.bot-badge
  // /.btn-kick (same condition + emit) stay byte-identical so the sacrosanct
  // render-lobby.test.js guard stays green.
  gameState.players.forEach((p, slot) => {
    // Phase 7.5: the row is now a Red Carpet "entrance card". The <li> +
    // #lobby-players container + the textual label + the .bot-badge + the
    // .btn-kick (same condition, same emit) are PRESERVED byte-for-byte so
    // the existing render-lobby.test.js zero-regression guard stays green;
    // the accent/emoji/animation are an ADDITIVE visual layer. The old
    // inline li.style.cssText is removed — flex/align/justify now lives in
    // the additive .entrance-card CSS (bounded DS-01, confined to the row
    // we rewrite here).
    const card = playerCardModel(p, { myPlayerId, slot });
```

- [ ] **Step 3b: Add the ONE additive `.lobby-stage` wrapper in `index.html`.**

In `public/index.html`, **Edit 1** — replace this exact block (the `.panel-header` close + the players-list-container):

```html
        </div>
        <div class="players-list-container">
          <ul id="lobby-players"></ul>
        </div>
```

with:

```html
        </div>
        <!-- Phase 7.5.1 (Seat-Table redesign): ONE additive structural
             wrapper. On desktop (≥768px) .lobby-stage is a flex row →
             Director becomes a left sidebar and the players list a
             responsive seat-tile grid; ≤767px it is block flow → grid then
             Director below (the panel is already max-width:100% + the screen
             scrolls at ≤767, so Add Bot is reachable). Purely structural:
             every existing id/element inside is unchanged, #team-screen is
             untouched, and render-lobby.test.js (queries by id, not
             ancestry) stays byte-green. -->
        <div class="lobby-stage">
        <div class="players-list-container">
          <ul id="lobby-players"></ul>
        </div>
```

**Edit 2** — replace this exact block (the `.director-panel` close + the `#waiting-room` close, anchored by the unique TEAM ASSIGNMENT comment):

```html
        </div>
      </div>

      <!-- TEAM ASSIGNMENT SCREEN -->
```

with:

```html
        </div>
        </div><!-- /.lobby-stage (Phase 7.5.1) -->
      </div>

      <!-- TEAM ASSIGNMENT SCREEN -->
```

(The first `</div>` closes `.director-panel`; the added `</div><!-- /.lobby-stage -->` closes the new wrapper; the `      </div>` closes `#waiting-room`. Indentation is cosmetic — HTML nesting is correct.)

- [ ] **Step 4: Run the new suite + the two sacrosanct guards — verify PASS & byte-green.**

Run: `cd C:/mm-phase7-5-1 && npx jest client-tests/red-carpet-seat-table.test.js client-tests/red-carpet-render.test.js client-tests/render-lobby.test.js`
Expected: all green. `red-carpet-render.test.js` and `render-lobby.test.js` are UNEDITED (confirm with `git -C C:/mm-phase7-5-1 status --porcelain` — they must NOT appear as modified).

- [ ] **Step 5: Full suite — green & additive.**

Run: `cd C:/mm-phase7-5-1 && npx jest`
Expected: all green; suite count = baseline + 1 (the new `red-carpet-seat-table.test.js`); zero pre-existing-suite regression.

- [ ] **Step 6: Branch-verify then commit.**

```bash
cd C:/mm-phase7-5-1 && test "$(git branch --show-current)" = "phase7-5-1-seat-table-redesign" && git add public/js/ui/ui-render.js public/index.html client-tests/red-carpet-seat-table.test.js && git commit -m "Phase 7.5.1 (1): slot glue + additive .lobby-stage wrapper + jsdom suite

renderLobby threads the 0-based render index as the seat slot (host =
seat 0). index.html gains ONE additive .lobby-stage wrapper around the
existing players list + Director panel (all ids preserved, #team-screen
untouched). New red-carpet-seat-table.test.js pins 8 distinct accents +
host=SEAT_HUES[0] + the wrapper + team early-return. render-lobby.test.js
and red-carpet-render.test.js UNEDITED & byte-green (zero-regression proof).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: CSS Seat-Table layout — Director sidebar + responsive tile grid + mobile stack

**Goal:** Rework 7.5's OWN entrance-card rules into seat tiles and append the `.lobby-stage` layout (desktop sidebar+grid, mobile stack, panel widen) — NO pre-7.5 rule edited; reduced-motion/animation reused.

**Files:**
- Modify: `public/css/02-hero-lobby.css` (rework 7.5's own rules at lines 765–777; append a new Seat-Table subsection at EOF after line ~893)

**Acceptance Criteria:**
- [ ] Desktop ≥768px: `.lobby-stage` is a flex row — `.director-panel` is a left sidebar (`flex:0 0 15rem`), `.players-list-container` flexes; `#lobby-players` is a `repeat(auto-fill,minmax(140px,1fr))` grid; `#waiting-room.lobby-panel` `max-width:920px`.
- [ ] Mobile ≤767px: `.lobby-stage` is block flow (grid then Director below); panel stays `max-width:100%` (existing ≤767 rule) and the screen scrolls (existing `#lobby-screen{overflow-y:auto}`) → Add Bot reachable.
- [ ] `.entrance-card` is a vertical seat tile with the distinct seat colour (left edge + faint tint); `.btn-kick` is a corner ✕; `.bot-badge` non-shrink/nowrap retained; `cardEntrance` + its `@keyframes` reused **unchanged** (compositor-safe; reduced-motion auto-covered by the existing global `06-states-anim.css` block — no per-rule handling).
- [ ] NO pre-7.5 rule edited/reordered/removed: `git -C C:/mm-phase7-5-1 diff public/css/02-hero-lobby.css` shows changes ONLY within the 7.5 section (lines ≥729) and EOF additions — no hunk touches a line ≤728.
- [ ] Full `npx jest` green & additive (CSS-only; no test changes). Visual/responsive/reduced-motion eyeball flagged user-side (jsdom never lays out).

**Verify:** `cd C:/mm-phase7-5-1 && npx jest` → all green & additive; `git -C C:/mm-phase7-5-1 diff public/css/02-hero-lobby.css` → every changed hunk is at line ≥729 (no pre-7.5 rule touched).

**Steps:**

- [ ] **Step 1: Rework the two 7.5-OWN entrance-card rules into tile form.**

In `public/css/02-hero-lobby.css`, replace this exact 7.5-own block (currently lines 765–777):

```css
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
```

with (rework of 7.5's OWN rules — pre-7.5 `#lobby-players li` base at line 574 is NOT touched and still supplies padding/border/radius/margin/font):

```css
/* Phase 7.5.1 (Seat-Table redesign): the entrance-card is now a vertical
   SEAT TILE in a grid (was a flex ROW in a list). Reworking 7.5's OWN rule
   only — the pre-7.5 `#lobby-players li` base (padding/border/radius/margin/
   font) is untouched. The distinct SEAT_HUES colour now drives a 4px left
   edge + a faint same-hue tint over the token bg (contrast preserved). */
#lobby-players li.entrance-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  position: relative;            /* anchor the corner kick ✕ */
  border-left: 4px solid hsl(var(--card-accent, 240), 60%, 60%);
  background:
    linear-gradient(hsla(var(--card-accent, 240), 60%, 60%, 0.10),
                    hsla(var(--card-accent, 240), 60%, 60%, 0.10)),
    var(--bg-elevated);
}
.entrance-card__emoji {
  font-size: 1.6rem;             /* prominent on a tile (was inline-ish 1.1) */
  line-height: 1;
  flex: 0 0 auto;
}
```

- [ ] **Step 2: Append the Seat-Table layout subsection at EOF.**

Append the following at the END of `public/css/02-hero-lobby.css` (after the current last line ~893, the `#start-btn.roll-camera--waiting-*` block — i.e. after the 7.5 section, still within "7.5's own additive territory", no pre-7.5 rule touched):

```css

/* =============================================
   PHASE 7.5.1 — SEAT-TABLE LAYOUT (APPEND-ONLY)
   WHY append-only here too: no pre-7.5 rule (≤ line 728, the .bot-thinking
   boundary) is edited/reordered/removed. This adds the Director-sidebar +
   responsive seat-tile-grid layout around the existing #waiting-room
   structure. The animation (cardEntrance) + the global prefers-reduced-
   motion neutralisation in 06-states-anim.css are reused UNCHANGED
   (compositor-safe; no new keyframes, no new timers).
   Cascade audit (binding 7.5 C1/DS-01 lesson — all six partials checked):
   .lobby-panel base = 02-hero-lobby.css:230 (max-width:380px); responsive
   overrides are .lobby-panel{max-width:420px}@max-1023 (05-responsive:31)
   and .lobby-panel{max-width:100%}@max-767 (05-responsive:86); #lobby-screen
   {overflow-y:auto}@max-767 (05-responsive:94) already lets the stacked
   mobile lobby scroll (Add Bot reachable). The 02-hero @max-900/@max-480
   blocks are hero-only (no lobby selector). So: the desktop widen below is
   id-anchored (#waiting-room.lobby-panel = 1,1,0) inside @min-768 — it beats
   every .lobby-panel (0,1,0) rule for ≥768 and NEVER collides with the ≤767
   max-width:100% (different media). 768px is the exact complement of the
   codebase's 767px mobile boundary. 15rem(240px) sidebar matches the
   codebase's recurring 240px side-panel metric. ============================ */

/* Default (all widths, mobile-first): the lobby is a vertical stack — the
   seat-tile grid, then the Director panel below it. The grid is responsive
   via auto-fill (≈1–2 columns on a phone-width panel). */
.lobby-stage { display: block; }
.lobby-stage #lobby-players {
  /* .lobby-stage #lobby-players (0,1,1) > base #lobby-players (0,1,0) — the
     pre-7.5 base rule (list-style:none) is NOT edited; this only adds the
     grid + overrides its margin-bottom. */
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.6rem;
  margin-bottom: 1rem;
}
/* Kick ✕ becomes a corner control on the tile (the pre-7.5 .btn-kick base
   in 06-states-anim.css is NOT edited; .entrance-card .btn-kick = 0,2,0 just
   adds positioning over it; flex-shrink:0 from the #31 fix is preserved). */
.entrance-card .btn-kick {
  flex-shrink: 0;
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
}
/* The BOT badge sits under the name on a tile; keep the #31 no-shrink/nowrap
   intent so "BOT · Normal" never wraps. */
.entrance-card .bot-badge { align-self: flex-start; }

/* Desktop ≥768px: Director becomes a LEFT SIDEBAR, the players list the
   grid to its right, and the lobby panel widens to fit both. */
@media (min-width: 768px) {
  #waiting-room.lobby-panel { max-width: 920px; }
  .lobby-stage {
    display: flex;
    gap: 1.25rem;
    align-items: flex-start;
  }
  .lobby-stage .director-panel {
    flex: 0 0 15rem;             /* fixed left sidebar (240px) */
    margin-top: 0;               /* override 7.5's own .director-panel{margin-top:1rem} in row context */
  }
  .lobby-stage .players-list-container {
    flex: 1 1 auto;
    min-width: 0;                /* allow the grid to shrink within the flex row */
  }
  .lobby-stage #lobby-players { margin-bottom: 0; }
}
```

- [ ] **Step 3: Verify append-only / no pre-7.5 rule touched.**

Run: `git -C C:/mm-phase7-5-1 diff public/css/02-hero-lobby.css`
Expected: every changed/added hunk is at line ≥729 (the Step-1 rework is at 765–777; Step-2 is pure EOF append). Confirm NO hunk modifies any line ≤728 (the pre-7.5 `.bot-thinking` boundary). Also run `git -C C:/mm-phase7-5-1 diff --numstat public/css/02-hero-lobby.css` and sanity-check the deletions are only the two reworked 7.5-own rules.

- [ ] **Step 4: Full suite — green & additive (CSS-only).**

Run: `cd C:/mm-phase7-5-1 && npx jest`
Expected: all suites green; total = post-Task-1 (no test changes in Task 2); zero pre-existing-suite regression. (jsdom never lays out — the visual/responsive/reduced-motion correctness is the user-side eyeball, flagged below.)

- [ ] **Step 5: Branch-verify then commit.**

```bash
cd C:/mm-phase7-5-1 && test "$(git branch --show-current)" = "phase7-5-1-seat-table-redesign" && git add public/css/02-hero-lobby.css && git commit -m "Phase 7.5.1 (2): Seat-Table CSS — Director sidebar + tile grid + mobile stack

Rework 7.5's OWN entrance-card rules into vertical seat tiles (distinct
SEAT_HUES edge + tint); append a Seat-Table layout subsection: .lobby-stage
flexes on ≥768px (Director left sidebar 15rem + auto-fill tile grid,
id-anchored #waiting-room.lobby-panel widened to 920px), block-stacks ≤767px
(panel already 100% + screen scrolls → Add Bot reachable). cardEntrance +
the global reduced-motion block reused unchanged. NO pre-7.5 rule edited
(diff confined to lines ≥729). Visual/responsive eyeball is user-side.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

**User-side eyeball (non-blocking; jsdom never lays out or boots a browser):** no two players share a colour at a full 8-player lobby; Add Bot reachable at 7 players; desktop = Director left sidebar + ~4-wide seat-tile grid; mobile ≤767px = grid then Director stacked, scrollable; entrance animation still reads (and is legible static with OS reduced-motion on); team-mode waiting screen unchanged.

---

## Self-Review

**Spec coverage (spec §10):** (1) `SEAT_HUES` frozen/8/int/distinct → Task 0 Step 1 `SEAT_HUES` block + Step 3a. (2) slot model + defensive + byte-identical + sentinel → Task 0. (3) glue passes slot, host=seat 0 → Task 1 Step 3a. (4) additive `.lobby-stage`, ids preserved, `#team-screen` untouched → Task 1 Step 3b + test. (5) desktop sidebar+grid / mobile stack / tile / reduced-motion / no pre-7.5 edit → Task 2. (6) guards UNEDITED & green, new suite, full additive → Tasks 0–2 verify steps. (7) user-side eyeball → flagged at Task 2. All covered.

**Placeholder scan:** none — every SEAT_HUES value, breakpoint (768px), panel width (920px), sidebar (15rem), grid (`minmax(140px,1fr)`), gap (1.25rem/0.6rem), and every old/new code block is concrete; the C1/DS-01 audit values are pinned from the actual cascade.

**Type/identifier consistency:** `SEAT_HUES` (export name) consistent across Task 0 impl/tests and Task 1 import; `opts.slot` ↔ `playerCardModel(p,{myPlayerId,slot})` ↔ `forEach((p,slot)=>...)`; `.lobby-stage` class consistent across index.html (Task 1) and CSS (Task 2); `--card-accent` unchanged contract consumed by the reworked tile rule. No drift.

**Scope:** single feature, 3 linear tasks, each its own commit + independently verifiable; no decomposition needed.
