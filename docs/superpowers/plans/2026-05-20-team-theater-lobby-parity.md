# Phase 7.8b — Team Theater Lobby Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the team-mode lobby (`#team-screen`) to visual + structural parity with the classic Theater Lobby — cinema-screen header, seat-style chairs (single team color per side), full Director panel (House Rules ledger + Start Match), 3-column wide layout.

**Architecture:** Approach A from the spec. Extract a pure `seatModel(player, opts)` to `red-carpet.js` and a new impure DOM builder `buildSeatNode(model, callbacks)` to a new `ui-seat.js` module. `renderLobby` (classic) and `renderTeamScreen` (team) both call the same builder. Classic stays byte-identical (proved by existing tests staying green); team mode gets the unified seat with `team: 'red'|'blue'` instead of `accentHue`. CSS is append-only — new higher-specificity rules override (don't edit) the existing seat rules for team seats only.

**Tech Stack:** Vanilla ES modules (no build step), Jest + jsdom for client tests, Socket.IO event names unchanged. Spec: `docs/superpowers/specs/2026-05-20-team-theater-lobby-parity-design.md`.

**Branch:** `phase7-8b-team-theater-parity` (off `origin/main @ 49acf56`, spec committed @ `492cb52`).

**Baseline:** `npm test` → 536 green on 62 suites. Target after T2: ~560 green (+24 new tests; richer test coverage than the spec's ~12-15 estimate, justified by per-mode/zero-identity/wrapper-equivalence pins), zero pre-existing tests edited.

---

## File Structure

**Created:**
- `public/js/ui/ui-seat.js` — impure DOM builder for seat `<li>` nodes (single source of truth, shared by classic + team).
- `client-tests/seat-builder.test.js` — pure-seam tests for `seatModel` + `buildSeatNode`.
- `client-tests/render-team-screen.test.js` — team-mode render contract tests.

**Modified:**
- `public/js/ui/red-carpet.js` — add `seatModel` (~30 LOC); rewrite `playerCardModel` as a thin wrapper.
- `public/js/ui/ui-render.js` — `renderLobby` (L140-498) replaces inline seat-building with `buildSeatNode` calls + extracted `buildAddBotRow` helper; `renderTeamScreen` (L501-543) full rewrite.
- `public/js/ui/ui.js` — re-export `buildSeatNode` from `ui-seat.js` if needed by tests (mirrors how `red-carpet.js` exports are surfaced; check first — tests can import directly from `ui-seat.js`).
- `public/js/socketClient.js` — extend the three House Rules change-handler registrations to also bind on the team-suffixed control ids.
- `public/index.html` — rewrite `#team-screen` body (~L378-401) to the 3-column theater shape; add team-suffixed control ids.
- `public/css/02-hero-lobby.css` — append a new `Phase 7.8b — Team Theater Lobby` section (~120-180 LOC; ZERO edits to existing rules).
- `client-tests/socket-handlers.test.js` — add 3 tests asserting the team-suffixed change handlers emit `updateLobbySettings`.

**Untouched (regression proof):**
- `client-tests/render-lobby.test.js` (11 tests) — classic lobby DOM byte-identical.
- `client-tests/red-carpet-seat-table.test.js` (5 tests, including the team-mode early-return assertion).
- `client-tests/red-carpet.test.js` (pure-seam unit tests for `playerCardModel`).
- `client-tests/red-carpet-render.test.js`.
- All `server/**` suites.

---

## Task 0 — Pure seam: extract `seatModel`, wrap `playerCardModel`

**Goal:** Add `seatModel(player, opts)` to `red-carpet.js` and rewrite `playerCardModel` as a thin wrapper around it. Output of `playerCardModel` is byte-identical to today for every real input (sentinel-tested). New tests live in `client-tests/seat-builder.test.js`.

**Files:**
- Modify: `public/js/ui/red-carpet.js` (add `seatModel`, refactor `playerCardModel`).
- Create: `client-tests/seat-builder.test.js`.

**Acceptance Criteria:**
- [ ] `seatModel({mode:'classic', slot:N, myPlayerId})` returns a model with `accentHue === SEAT_HUES[((N%8)+8)%8]` (or `p.colorHue` when `Number.isInteger(p.colorHue) && SEAT_HUES.includes(p.colorHue)`), no `team` key.
- [ ] `seatModel({mode:'team', team:'red', myPlayerId})` returns a model with `team === 'red'`, no `accentHue` key, no `hasPickedColor` key.
- [ ] `seatModel({mode:'team', team:'blue', myPlayerId})` symmetric to red.
- [ ] `seatModel` ignores `stableId` (sentinel: adding `stableId: 'x'` to the player does not change any returned field).
- [ ] `playerCardModel(p, opts)` returns output equal to today's `playerCardModel(p, opts)` for every (player, opts) pair the existing `red-carpet.test.js` exercises. **All tests in `red-carpet.test.js` and `red-carpet-render.test.js` stay green without edits.**
- [ ] New file `client-tests/seat-builder.test.js` has ≥6 test cases (the pure-seam contracts above) all green.

**Verify:** `npx jest client-tests/seat-builder.test.js client-tests/red-carpet.test.js client-tests/red-carpet-render.test.js client-tests/red-carpet-seat-table.test.js client-tests/render-lobby.test.js --verbose` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test file `client-tests/seat-builder.test.js`**

```javascript
/**
 * @jest-environment node
 */
// Phase 7.8b — pure-seam tests for seatModel + buildSeatNode.
// seatModel is the unified per-seat model: classic mode uses SEAT_HUES[slot]
// (or colorHue), team mode uses team:'red'|'blue' (no accentHue, no swatches).
// playerCardModel is now a thin wrapper around seatModel({mode:'classic',...})
// — its byte-identical-output contract is pinned by the wrapper-equivalence
// sentinel + the unedited red-carpet.test.js suite continuing to pass.

const { seatModel, playerCardModel, SEAT_HUES } = require('../public/js/ui/red-carpet.js');

describe('seatModel — pure model', () => {
  describe('classic mode', () => {
    test('slot N maps to SEAT_HUES[N]; no team key', () => {
      const p = { id: 's1', name: 'Alice', isHost: false };
      const m = seatModel(p, { mode: 'classic', slot: 3, myPlayerId: 'sX' });
      expect(m.accentHue).toBe(SEAT_HUES[3]);
      expect(m.team).toBeUndefined();
      expect(m.name).toBe('Alice');
    });

    test('out-of-range slot wraps via double-modulo (negative-safe)', () => {
      const p = { id: 's1', name: 'A' };
      const negative = seatModel(p, { mode: 'classic', slot: -1, myPlayerId: 'sX' });
      expect(negative.accentHue).toBe(SEAT_HUES[7]);  // (-1 % 8 + 8) % 8 === 7
      const over = seatModel(p, { mode: 'classic', slot: 9, myPlayerId: 'sX' });
      expect(over.accentHue).toBe(SEAT_HUES[1]);       // 9 % 8 === 1
    });

    test('valid colorHue pick overrides slot hue; hasPickedColor:true', () => {
      const p = { id: 's1', name: 'A', colorHue: SEAT_HUES[5] };
      const m = seatModel(p, { mode: 'classic', slot: 2, myPlayerId: 'sX' });
      expect(m.accentHue).toBe(SEAT_HUES[5]);
      expect(m.hasPickedColor).toBe(true);
    });

    test('off-palette colorHue falls back to slot hue; hasPickedColor:false', () => {
      const p = { id: 's1', name: 'A', colorHue: 999 };
      const m = seatModel(p, { mode: 'classic', slot: 2, myPlayerId: 'sX' });
      expect(m.accentHue).toBe(SEAT_HUES[2]);
      expect(m.hasPickedColor).toBe(false);
    });
  });

  describe('team mode', () => {
    test('team:red → team key set, no accentHue, no hasPickedColor', () => {
      const p = { id: 's1', name: 'A', isHost: false };
      const m = seatModel(p, { mode: 'team', team: 'red', myPlayerId: 'sX' });
      expect(m.team).toBe('red');
      expect(m).not.toHaveProperty('accentHue');
      expect(m).not.toHaveProperty('hasPickedColor');
    });

    test('team:blue symmetric', () => {
      const p = { id: 's1', name: 'A', isHost: false };
      const m = seatModel(p, { mode: 'team', team: 'blue', myPlayerId: 'sX' });
      expect(m.team).toBe('blue');
      expect(m).not.toHaveProperty('accentHue');
    });

    test('team mode ignores colorHue (no per-player pick in team mode)', () => {
      const p = { id: 's1', name: 'A', colorHue: SEAT_HUES[5] };
      const m = seatModel(p, { mode: 'team', team: 'red', myPlayerId: 'sX' });
      expect(m).not.toHaveProperty('accentHue');
      expect(m).not.toHaveProperty('hasPickedColor');
    });
  });

  describe('zero-identity discipline (no stableId leak)', () => {
    test('classic: passing stableId does not change any field', () => {
      const base = { id: 's1', name: 'A', isHost: false };
      const withStable = { ...base, stableId: 'STABLE_X' };
      const a = seatModel(base, { mode: 'classic', slot: 0, myPlayerId: 'sX' });
      const b = seatModel(withStable, { mode: 'classic', slot: 0, myPlayerId: 'sX' });
      expect(a).toEqual(b);
    });

    test('team: passing stableId does not change any field', () => {
      const base = { id: 's1', name: 'A', isHost: false };
      const withStable = { ...base, stableId: 'STABLE_X' };
      const a = seatModel(base, { mode: 'team', team: 'red', myPlayerId: 'sX' });
      const b = seatModel(withStable, { mode: 'team', team: 'red', myPlayerId: 'sX' });
      expect(a).toEqual(b);
    });
  });

  describe('playerCardModel wrapper-equivalence', () => {
    test('playerCardModel(p, opts) ≡ seatModel(p, {...opts, mode:"classic"})', () => {
      const cases = [
        [{ id: 's1', name: 'Host', isHost: true }, { myPlayerId: 's1', slot: 0 }],
        [{ id: 's2', name: 'Guest', wins: 3 },     { myPlayerId: 's1', slot: 1 }],
        [{ id: 's3', name: 'Bot', isBot: true },   { myPlayerId: 's1', slot: 7 }],
        [{ id: 's4', name: 'P', colorHue: SEAT_HUES[5] }, { myPlayerId: 's4', slot: 2 }],
      ];
      for (const [p, opts] of cases) {
        const a = playerCardModel(p, opts);
        const b = seatModel(p, { ...opts, mode: 'classic' });
        expect(a).toEqual(b);
      }
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

```
npx jest client-tests/seat-builder.test.js --verbose
```

Expected: FAIL — `seatModel is not a function` (red-carpet.js does not export `seatModel` yet).

- [ ] **Step 3: Implement `seatModel` in `red-carpet.js`**

Open `public/js/ui/red-carpet.js` and add the new export ABOVE `playerCardModel` (around line 108). Then rewrite `playerCardModel` to wrap `seatModel`. Exact code:

```javascript
/**
 * Phase 7.8b — unified pure per-seat model for both classic AND team mode.
 *
 * WHY ONE seam not two: the seat <li> shape is identical in both modes
 * (nameplate / crown / you-pill / bot-pill / avatar / kick). Only the
 * color treatment differs — classic has a per-seat SEAT_HUES slot hue
 * (with optional pick-your-own override), team has a single per-team
 * color. The pre-existing playerCardModel is now a thin wrapper around
 * seatModel({...opts, mode:'classic'}), preserving its byte-identical
 * contract for every existing consumer (sentinel-tested + the unedited
 * red-carpet.test.js suite is the proof).
 *
 * ZERO-stableId discipline: same as playerCardModel — reads no persistent
 * identifier. Sentinel-tested.
 *
 * opts.mode === 'classic' → fields: name, isHost, isYou, isBot, wins, label,
 *   accentHue, accentEmoji, hasPickedColor.
 * opts.mode === 'team'    → fields: name, isHost, isYou, isBot, wins, label,
 *   team, accentEmoji.
 */
export function seatModel(player, opts) {
  const p = player || {};
  const o = opts || {};
  const mode = o.mode === 'team' ? 'team' : 'classic';
  const myPlayerId = o.myPlayerId;

  const name = String(p.name == null ? '' : p.name);
  const id = String(p.id == null ? '' : p.id);
  const isHost = !!p.isHost;
  const isYou = p.id === myPlayerId;
  const isBot = !!p.isBot;
  const wins = (Number.isFinite(p.wins) && p.wins > 0) ? p.wins : 0;

  // Accent emoji unchanged from playerCardModel (room-scoped name+':'+id hash).
  const hash = _djb2(name + ':' + id);
  const accentEmoji = ACCENT_EMOJI[hash % ACCENT_EMOJI.length];

  let label = name;
  if (isYou) label += ' (You)';
  if (isHost) label += ' 👑';
  if (wins > 0) label += ` • ${wins} 🏆`;

  const base = { name, isHost, isYou, isBot, wins, accentEmoji, label };

  if (mode === 'team') {
    // Team mode: single team color per side. No per-seat hue, no pick.
    // Defensive: only 'red'/'blue' are valid; anything else collapses to 'red'
    // (degrade-gracefully; never throws). Server cannot emit a third team id,
    // so this branch is unreachable in real data but pinned for safety.
    const team = o.team === 'blue' ? 'blue' : 'red';
    return { ...base, team };
  }

  // Classic mode: per-seat SEAT_HUES slot hue with optional pick-your-color
  // override. Defensive layers (Number.isInteger + double-modulo) preserved
  // from the pre-7.8b playerCardModel.
  const rawSlot = Number.isInteger(o.slot) ? o.slot : 0;
  const slotHue =
    SEAT_HUES[((rawSlot % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length];
  const hasPickedColor =
    Number.isInteger(p.colorHue) && SEAT_HUES.includes(p.colorHue);
  const accentHue = hasPickedColor ? p.colorHue : slotHue;

  return { ...base, accentHue, hasPickedColor };
}
```

Then REPLACE the existing `playerCardModel` body (currently L109-155) with a thin wrapper:

```javascript
/**
 * Phase 7.5/7.5.1/7.5.3 pure per-player card model. Now a thin wrapper
 * around seatModel({mode:'classic',...}) — preserves the byte-identical
 * output contract for every consumer (red-carpet.test.js is the proof).
 */
export function playerCardModel(player, opts) {
  return seatModel(player, { ...(opts || {}), mode: 'classic' });
}
```

The `_djb2` helper (L77-83) and `ACCENT_EMOJI` (L22-24) and `SEAT_HUES` (L39) stay where they are — `seatModel` references them in the same scope.

- [ ] **Step 4: Run the test**

```
npx jest client-tests/seat-builder.test.js --verbose
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Regression check — pre-existing tests stay green**

```
npx jest client-tests/red-carpet.test.js client-tests/red-carpet-render.test.js client-tests/red-carpet-seat-table.test.js client-tests/render-lobby.test.js --verbose
```

Expected: all pre-existing tests still PASS. The wrapper-equivalence is the proof — `playerCardModel(p, opts)` returns the same object as before for every input.

- [ ] **Step 6: Run the full suite**

```
npm test --silent
```

Expected: ~546 passed (536 baseline + ~10 new), 62 suites. Zero failures.

- [ ] **Step 7: Branch-verify then commit**

```
git branch --show-current
```

Expected: `phase7-8b-team-theater-parity`. If anything else, STOP and re-check before committing.

```
git add public/js/ui/red-carpet.js client-tests/seat-builder.test.js
git commit -m "$(cat <<'EOF'
Phase 7.8b T0: extract seatModel pure seam; wrap playerCardModel

Adds the unified per-seat model that both classic and team mode will
share. seatModel({mode:'classic',slot}) returns the existing card with
accentHue/hasPickedColor; seatModel({mode:'team',team:'red'|'blue'})
returns a team-flavored card with no accentHue. playerCardModel is now
a thin wrapper around seatModel({...opts, mode:'classic'}) — byte-
identical output for every real (player, opts) pair (wrapper-equivalence
sentinel + the unedited red-carpet.test.js suite are the regression
proof).

Zero-stableId discipline preserved (sentinel-tested in both modes).

10 new seat-builder.test.js cases; full suite 536 → ~546 green.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1 — DOM builder + render rewrite + team-screen HTML + socket handlers

**Goal:** Add `public/js/ui/ui-seat.js` exporting `buildSeatNode(model, callbacks)`. Refactor `renderLobby` to call it (output byte-identical). Rewrite `renderTeamScreen` end-to-end. Update `index.html` `#team-screen` body. Register team-suffixed ledger change-handlers in `socketClient.js`. Add the team-mode render test + socket-handler extension tests.

**Files:**
- Create: `public/js/ui/ui-seat.js`.
- Create: `client-tests/render-team-screen.test.js`.
- Modify: `public/js/ui/ui-render.js` — `renderLobby` (L140-498) seat-build replacement + `buildAddBotRow` extraction; `renderTeamScreen` (L501-543) full rewrite.
- Modify: `public/js/ui.js` — re-export `buildSeatNode` if needed by tests (check first; if tests can import `ui-seat.js` directly, skip).
- Modify: `public/js/socketClient.js` — extend three ledger change-handler registrations.
- Modify: `public/index.html` — `#team-screen` body rewrite (~L378-401).
- Modify: `client-tests/socket-handlers.test.js` — add 3 new tests.

**Acceptance Criteria:**
- [ ] `buildSeatNode(classicModel, callbacks)` produces the same `<li>` shape as today's renderLobby inline builder (proof: existing `render-lobby.test.js` + `red-carpet-seat-table.test.js` stay byte-identical and green).
- [ ] `buildSeatNode(teamModel, callbacks)` produces `<li class="seat occupied team-<color>">` with `--seat-team-color` style, no `.seat-swatches`, no `--avatar-hue`.
- [ ] `renderLobby` after refactor produces byte-identical DOM (existing tests stay green).
- [ ] `renderTeamScreen` builds the new 3-column body, fills team-tagged seats, syncs the team-suffixed ledger, gates Start Match correctly.
- [ ] Host change events on `#hardcore-toggle-team` / `#tv-shows-toggle-team` / `#theme-select-team` emit `updateLobbySettings` with the byte-identical payload as classic.
- [ ] `#team-screen` preserves all existing ids: `#team-lobby-code`, `#team-red-list`, `#team-blue-list`, `#join-red-btn`, `#join-blue-btn`, `#team-start-btn`, `#team-back-btn`.
- [ ] New `render-team-screen.test.js` has ≥8 tests, all green.

**Verify:** `npm test --silent` → ~558–561 green; zero pre-existing tests edited.

**Steps:**

- [ ] **Step 1: Write the failing test file `client-tests/render-team-screen.test.js`**

```javascript
/**
 * @jest-environment jsdom
 */
// Phase 7.8b — team-mode render contract. Pins the new DOM:
// - cinema-screen header per team (.team-theater .screen with eyebrow+headline)
// - per-team seat-style chairs with .team-red / .team-blue class
// - host kick + nameplate + crown + you-pill all carried over from classic
// - join/start gating logic byte-identical to today
// - ledger sync to team-suffixed controls

const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
const mockEmit = jest.fn();
jest.mock('../public/js/state.js', () => ({
  getSocket: () => ({ emit: mockEmit }),
  getCurrentLobbyId: () => 'TEST01',
}));
import { initUIElements, renderLobby } from '../public/js/ui.js';

const teamState = (overrides = {}) => makeWaitingState({
  gameMode: 'team',
  players: [
    makePlayer({ id: 'host_id', name: 'Host',  isHost: true, teamId: 0 }),
    makePlayer({ id: 'red2',    name: 'RedTwo',           teamId: 0 }),
    makePlayer({ id: 'blue1',   name: 'BlueOne',          teamId: 1 }),
    makePlayer({ id: 'blue2',   name: 'BlueTwo',          teamId: 1 }),
    makePlayer({ id: 'blue3',   name: 'BlueThree',        teamId: 1 }),
  ],
  ...overrides,
});

describe('renderTeamScreen — team theater parity', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('2-red-vs-3-blue renders 2 .seat.team-red + 3 .seat.team-blue', () => {
    renderLobby(teamState(), 'host_id');
    const redSeats = document.querySelectorAll('#team-red-list li.seat.team-red');
    const blueSeats = document.querySelectorAll('#team-blue-list li.seat.team-blue');
    expect(redSeats.length).toBe(2);
    expect(blueSeats.length).toBe(3);
    // No empty placeholder seats in team mode (variable team size).
    expect(document.querySelectorAll('#team-red-list li.seat:not(.occupied)').length).toBe(0);
    expect(document.querySelectorAll('#team-blue-list li.seat:not(.occupied)').length).toBe(0);
  });

  test('team seats carry no --avatar-hue; classic-only --avatar-hue absent', () => {
    renderLobby(teamState(), 'host_id');
    const seats = document.querySelectorAll('#team-red-list li.seat, #team-blue-list li.seat');
    expect(seats.length).toBeGreaterThan(0);
    for (const s of seats) {
      expect(s.style.getPropertyValue('--avatar-hue')).toBe('');
      // and they DO carry --seat-team-color via the buildSeatNode contract
      expect(s.style.getPropertyValue('--seat-team-color')).not.toBe('');
    }
  });

  test('host sees .seat-kick on every non-self seat across both teams', () => {
    renderLobby(teamState(), 'host_id');
    const allSeats = document.querySelectorAll('#team-red-list li.seat, #team-blue-list li.seat');
    const expectedKicks = allSeats.length - 1; // every seat except host's own
    expect(document.querySelectorAll('#team-screen .seat-kick').length).toBe(expectedKicks);
    const myOwnSeat = document.querySelector('#team-red-list li.seat[data-player-id="host_id"]');
    expect(myOwnSeat.querySelector('.seat-kick')).toBeNull();
  });

  test('non-host sees zero .seat-kick', () => {
    renderLobby(teamState(), 'blue1');
    expect(document.querySelectorAll('#team-screen .seat-kick').length).toBe(0);
  });

  test('host-with-wins nameplate: single .crown, no (You)/👑 baked in text', () => {
    renderLobby(teamState({ players: [
      makePlayer({ id: 'host_id', name: 'Bryan', isHost: true, wins: 34, teamId: 0 }),
      makePlayer({ id: 'blue1', name: 'Guest', teamId: 1 }),
    ]}), 'host_id');
    const me = document.querySelector('#team-red-list li.seat[data-player-id="host_id"]');
    expect(me.querySelectorAll('.crown').length).toBe(1);
    expect((me.textContent.match(/♛/g) || []).length).toBe(1);
    expect(me.textContent).not.toContain('👑');
    expect(me.querySelector('.nameplate .seat-name').textContent).toBe('Bryan • 34 🏆');
  });

  test('cinema screens render: eyebrow "Red Team" + "Blue Team"', () => {
    renderLobby(teamState(), 'host_id');
    const red  = document.querySelector('#team-screen .team-theater.team-red  .screen-eyebrow');
    const blue = document.querySelector('#team-screen .team-theater.team-blue .screen-eyebrow');
    expect(red).not.toBeNull();
    expect(blue).not.toBeNull();
    expect(red.textContent).toBe('Red Team');
    expect(blue.textContent).toBe('Blue Team');
  });

  test('join buttons reflect my team: my own team disabled, other enabled', () => {
    renderLobby(teamState(), 'blue1'); // I'm on blue
    expect(document.getElementById('join-red-btn').disabled).toBe(false);
    expect(document.getElementById('join-blue-btn').disabled).toBe(true);
  });

  test('Start Match visible when teams ready, host-only', () => {
    renderLobby(teamState(), 'host_id'); // 2v3 — both ≥1, ready
    const btn = document.getElementById('team-start-btn');
    expect(btn.style.display).toBe('block');
    // Non-host viewer: hidden even when ready
    renderLobby(teamState(), 'blue1');
    expect(document.getElementById('team-start-btn').style.display).toBe('none');
  });

  test('Start Match hidden when one team has 0 players', () => {
    const allRed = teamState({ players: [
      makePlayer({ id: 'host_id', name: 'Host', isHost: true, teamId: 0 }),
      makePlayer({ id: 'red2', name: 'R', teamId: 0 }),
    ]});
    renderLobby(allRed, 'host_id');
    expect(document.getElementById('team-start-btn').style.display).toBe('none');
  });

  test('ledger mirrors hardcoreMode/allowTvShows onto .ledger-row.on (team controls)', () => {
    renderLobby(teamState({ hardcoreMode: true, allowTvShows: true }), 'host_id');
    const hardcore = document.getElementById('hardcore-toggle-team').closest('.ledger-row');
    const tv = document.getElementById('tv-shows-toggle-team').closest('.ledger-row');
    expect(hardcore.classList.contains('on')).toBe(true);
    expect(tv.classList.contains('on')).toBe(true);

    renderLobby(teamState({ hardcoreMode: false, allowTvShows: false }), 'host_id');
    expect(document.getElementById('hardcore-toggle-team').closest('.ledger-row').classList.contains('on')).toBe(false);
  });

  test('idempotent re-render does NOT re-apply .entering (arrival-diff)', () => {
    const st = teamState();
    renderLobby(st, 'host_id');
    // first render: everyone is entering
    const firstEntering = document.querySelectorAll('#team-screen li.seat.entering').length;
    expect(firstEntering).toBeGreaterThan(0);
    // second render: same roster, same lobby id → no new entering classes
    renderLobby(st, 'host_id');
    // Note: existing renderLobby strips .entering after 1400ms — but the
    // arrival-diff itself produces no NEW entering ids on the second pass.
    // The .seat dom is rebuilt each render, so .entering should be empty on
    // immediate inspection (no players are NEW arrivals on pass 2).
    expect(document.querySelectorAll('#team-screen li.seat.entering').length).toBe(0);
  });
});
```

Also add 3 tests to `client-tests/socket-handlers.test.js` (append to the existing describe block; do not edit existing tests):

```javascript
// --- Phase 7.8b: team-suffixed ledger handlers ---
describe('team-mode ledger change handlers (Phase 7.8b)', () => {
  test('#hardcore-toggle-team change emits updateLobbySettings with hardcoreMode', () => {
    // (mirror the existing classic hardcore-toggle test shape; replace the id)
    const el = document.getElementById('hardcore-toggle-team');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    expect(mockEmit).toHaveBeenCalledWith('updateLobbySettings', expect.objectContaining({
      hardcoreMode: true,
      lobbyId: expect.any(String),
    }));
  });

  test('#tv-shows-toggle-team change emits updateLobbySettings with allowTvShows', () => {
    const el = document.getElementById('tv-shows-toggle-team');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    expect(mockEmit).toHaveBeenCalledWith('updateLobbySettings', expect.objectContaining({
      allowTvShows: true,
      lobbyId: expect.any(String),
    }));
  });

  test('#theme-select-team change emits updateLobbySettings with themeKey', () => {
    const el = document.getElementById('theme-select-team');
    const opt = document.createElement('option');
    opt.value = 'horror'; opt.textContent = 'Horror';
    el.appendChild(opt);
    el.value = 'horror';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    expect(mockEmit).toHaveBeenCalledWith('updateLobbySettings', expect.objectContaining({
      themeKey: 'horror',
      lobbyId: expect.any(String),
    }));
  });
});
```

NOTE: the exact payload-key the existing classic test expects (`hardcoreMode`, `allowTvShows`, `themeKey`) — match whatever the existing classic handler actually emits. Open `socket-handlers.test.js` and the existing classic hardcore/tv/theme handler tests, copy their shape verbatim, replace the id with the `-team` variant. The new tests must use the SAME emit-name and payload key as the existing classic tests.

- [ ] **Step 2: Run the failing tests**

```
npx jest client-tests/render-team-screen.test.js client-tests/socket-handlers.test.js --verbose
```

Expected: many FAILs — `seatModel` exists (T0) but `buildSeatNode` doesn't, the team-screen DOM doesn't have the new ids yet, and the team-suffixed handlers aren't registered.

- [ ] **Step 3: Create `public/js/ui/ui-seat.js`**

```javascript
// public/js/ui/ui-seat.js — impure DOM builder for seat <li> nodes.
// Phase 7.8b. WHY a dedicated module: the seat DOM is the single biggest
// shape both renderLobby (classic) and renderTeamScreen (team) build. Hoisting
// it out of ui-render.js avoids that file growing further and gives both
// callers a single source of truth — the same pure-seam-then-thin-glue
// pattern as red-carpet.js, chain-recap.js, turn-motion.js.
//
// model is the output of seatModel(player, opts). callbacks may contain
// onKick(targetId), onRemoveBot(targetId), onPickHue(hue). All are optional
// — missing callback ⇒ that affordance is not attached (host-only and
// is-you cases are gated by the caller passing or omitting the callback).
//
// branches on model.team: present ⇒ team mode (no swatches, no --avatar-hue;
// .seat.team-<color> class + --seat-team-color CSS var). Absent ⇒ classic
// mode (the pre-7.8b inline shape, byte-identical).

const SEAT_CHAIR_SVG = `<svg viewBox="0 0 100 88" class="seat-svg" aria-hidden="true">
  <defs>
    <linearGradient id="velvet" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="hsl(var(--avatar-hue),70%,55%)"/>
      <stop offset="100%" stop-color="hsl(var(--avatar-hue),65%,38%)"/>
    </linearGradient>
  </defs>
  <rect x="14" y="20" width="72" height="52" rx="8" fill="url(#velvet)"/>
  <rect x="6"  y="36" width="14" height="32" rx="5" fill="hsl(var(--avatar-hue),60%,40%)"/>
  <rect x="80" y="36" width="14" height="32" rx="5" fill="hsl(var(--avatar-hue),60%,40%)"/>
  <rect x="12" y="64" width="76" height="14" rx="4" fill="hsl(var(--avatar-hue),60%,30%)"/>
</svg>`;
// IMPORTANT: copy SEAT_CHAIR_SVG from the existing ui-render.js definition
// (whatever the current constant contains — match it verbatim so the
// regression proof is byte-identical for classic seats). If the existing
// constant lives in ui-render.js as a module-local const, EXPORT it from
// there (or duplicate verbatim into ui-seat.js with a "kept in sync"
// comment). DO NOT alter the SVG markup in this task.

/**
 * Build an EMPTY seat <li> (classic mode only — team mode never builds empties).
 */
export function buildEmptySeatNode(slot) {
  const li = document.createElement('li');
  li.className = 'seat';
  li.dataset.slot = String(slot);

  const num = document.createElement('span');
  num.className = 'seat-num';
  num.textContent = `SEAT ${String(slot + 1).padStart(2, '0')}`;
  li.appendChild(num);

  const wrap = document.createElement('div');
  wrap.className = 'seat-svg-wrap';
  const spot = document.createElement('div');
  spot.className = 'seat-spotlight';
  wrap.appendChild(spot);
  wrap.insertAdjacentHTML('beforeend', SEAT_CHAIR_SVG);
  li.appendChild(wrap);
  return li;
}

/**
 * Build an OCCUPIED seat <li>. Branches on model.team:
 *   - present  → team mode (no swatches, --seat-team-color, .team-<color> class)
 *   - absent   → classic mode (--avatar-hue, optional swatches when is-you)
 *
 * callbacks: { onKick, onRemoveBot, onPickHue, isEntering }.
 *   onKick(targetId)       — wired only when caller provides it AND model is not local viewer.
 *   onRemoveBot(targetId)  — same gating; used when player isBot.
 *   onPickHue(hue)         — classic mode only; wired when isYou; iterates the
 *                            takenByOthers set the caller computed.
 *   isEntering             — boolean; adds .entering and the 1400ms cleanup.
 *
 * extra: { playerId, takenByOthers, allHues }
 *   playerId         — value for data-player-id.
 *   takenByOthers    — Set<number> of hues already claimed (classic-mode swatches).
 *   allHues          — the SEAT_HUES array (passed in so this module stays zero-import-from-red-carpet).
 */
export function buildSeatNode(model, callbacks, extra) {
  const cbs = callbacks || {};
  const ex  = extra || {};
  const li  = document.createElement('li');

  const isTeam = !!model.team;
  const stateFlags =
    'seat occupied'
    + (model.isYou  ? ' is-you'  : '')
    + (model.isHost ? ' is-host' : '')
    + (model.isBot  ? ' is-bot'  : '')
    + (ex.isEntering ? ' entering' : '')
    + (model.hasPickedColor ? ' has-picked' : '')
    + (isTeam ? ` team-${model.team}` : '');
  li.className = stateFlags;
  if (ex.playerId != null) li.dataset.playerId = String(ex.playerId);

  if (isTeam) {
    // Team mode: --seat-team-color drives the new higher-specificity
    // .seat.team-red/.team-blue overrides. No --avatar-hue.
    li.style.setProperty('--seat-team-color', `var(--team-${model.team})`);
  } else {
    li.style.setProperty('--avatar-hue', String(model.accentHue));
  }

  // ---- nameplate ----
  const plate = document.createElement('div');
  plate.className = 'nameplate';
  if (model.isHost) {
    const crown = document.createElement('span');
    crown.className = 'crown';
    crown.title = 'Host';
    crown.textContent = '♛';
    plate.appendChild(crown);
  }
  const nameSpan = document.createElement('span');
  nameSpan.className = 'seat-name';
  nameSpan.textContent = model.name + (model.wins > 0 ? ` • ${model.wins} 🏆` : '');
  plate.appendChild(nameSpan);
  if (model.isYou) {
    const youPill = document.createElement('span');
    youPill.className = 'you-pill';
    youPill.textContent = 'YOU';
    plate.appendChild(youPill);
  } else if (model.isBot) {
    const botPill = document.createElement('span');
    botPill.className = 'bot-pill';
    botPill.textContent = 'BOT';
    plate.appendChild(botPill);
  }
  li.appendChild(plate);

  // ---- person/avatar ----
  const person = document.createElement('div');
  person.className = 'seat-person';
  const av = document.createElement('div');
  av.className = 'avatar-emoji';
  av.setAttribute('aria-hidden', 'true');
  av.textContent = model.accentEmoji;
  person.appendChild(av);
  li.appendChild(person);

  // ---- swatches (classic-mode is-you ONLY; team mode never builds them) ----
  if (!isTeam && model.isYou && cbs.onPickHue && Array.isArray(ex.allHues)) {
    const strip = document.createElement('div');
    strip.className = 'seat-swatches';
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Pick your seat colour');
    const taken = ex.takenByOthers instanceof Set ? ex.takenByOthers : new Set();
    const myEff = model.accentHue;
    ex.allHues.forEach(hue => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'swatch';
      sw.style.setProperty('--avatar-hue', String(hue));
      sw.setAttribute('aria-label', 'Seat colour ' + hue);
      if (hue === myEff) {
        sw.classList.add('is-selected');
        sw.disabled = true;
        sw.setAttribute('aria-pressed', 'true');
      } else if (taken.has(hue)) {
        sw.classList.add('is-taken');
        sw.disabled = true;
      } else {
        sw.addEventListener('click', () => cbs.onPickHue(hue));
      }
      strip.appendChild(sw);
    });
    li.appendChild(strip);
  }

  // ---- chair SVG + spotlight + optional kick ----
  const wrap = document.createElement('div');
  wrap.className = 'seat-svg-wrap';
  const spot = document.createElement('div');
  spot.className = 'seat-spotlight';
  wrap.appendChild(spot);
  wrap.insertAdjacentHTML('beforeend', SEAT_CHAIR_SVG);

  // Kick is wired only when caller passes a callback AND seat is not local viewer.
  if (!model.isYou && (cbs.onKick || cbs.onRemoveBot) && ex.playerId != null) {
    const kickBtn = document.createElement('button');
    kickBtn.className = 'seat-kick';
    kickBtn.title = 'Kick';
    kickBtn.dataset.kickId = String(ex.playerId);
    kickBtn.textContent = '✕';
    kickBtn.addEventListener('click', () => {
      if (model.isBot && cbs.onRemoveBot) cbs.onRemoveBot(ex.playerId);
      else if (cbs.onKick) cbs.onKick(ex.playerId);
    });
    wrap.appendChild(kickBtn);
  }
  li.appendChild(wrap);

  // ---- entering cleanup (idempotent re-render strips after 1400ms) ----
  if (ex.isEntering && ex.containerForCleanup) {
    const id = ex.playerId;
    setTimeout(() => {
      const el = ex.containerForCleanup.querySelector('li.seat[data-player-id="' + id + '"]');
      if (el) el.classList.remove('entering');
    }, 1400);
  }

  return li;
}
```

**Important:** confirm the exact `SEAT_CHAIR_SVG` constant body by reading `public/js/ui/ui-render.js` (search for `SEAT_CHAIR_SVG`) and copy it VERBATIM. The above sample SVG is illustrative — the implementation must use the actual SVG markup from the production file so the regression proof holds.

- [ ] **Step 4: Refactor `renderLobby` in `ui-render.js` to use `buildSeatNode`**

In `public/js/ui/ui-render.js`:

1. Add at top of the file (after existing imports): `import { buildSeatNode, buildEmptySeatNode } from './ui-seat.js';` and `import { seatModel } from './red-carpet.js';` (extend the existing red-carpet import).

2. Replace the seat-building block in `renderLobby` (roughly L165-381 in the current file — the inner `for (let slot = 0; slot < 8; slot++)` loop that builds empties + occupied seats) with this structure:

```javascript
// Phase 7.5.2 8-seat theater: empty placeholders + occupied seats. Seat DOM
// is built by the shared ui-seat.js builder (Phase 7.8b) — same shape as the
// pre-7.8b inline block (byte-identical, proved by the unedited
// render-lobby.test.js + red-carpet-seat-table.test.js suites).
for (let slot = 0; slot < 8; slot++) {
  if (slot >= gameState.players.length) {
    lobbyPlayersList.appendChild(buildEmptySeatNode(slot));
    continue;
  }
  const p = gameState.players[slot];
  const model = seatModel(p, { mode: 'classic', slot, myPlayerId });
  const isEntering = enteringSet.has(p.id);

  // Compute takenByOthers (classic swatches) — only when isYou, since the
  // builder gates on cbs.onPickHue presence + isYou.
  let takenByOthers;
  if (model.isYou) {
    takenByOthers = new Set();
    gameState.players.forEach((op, oi) => {
      if (oi === slot) return;
      const eff = (Number.isInteger(op.colorHue) && SEAT_HUES.includes(op.colorHue))
        ? op.colorHue
        : SEAT_HUES[((oi % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length];
      takenByOthers.add(eff);
    });
  }

  const node = buildSeatNode(model,
    {
      onKick:      amIHost ? (id) => getSocket().emit('kickPlayer', { lobbyId: gameState.id, targetId: id }) : null,
      onRemoveBot: amIHost ? (id) => getSocket().emit('removeBot',  { lobbyId: gameState.id, targetId: id }) : null,
      onPickHue:   model.isYou ? (hue) => getSocket().emit('selectColor', { lobbyId: gameState.id, hue }) : null,
    },
    {
      playerId: p.id,
      isEntering,
      takenByOthers,
      allHues: SEAT_HUES,
      containerForCleanup: lobbyPlayersList,
    }
  );
  lobbyPlayersList.appendChild(node);
}
```

`enteringSet` is the existing local Set built from `diffArrivals`; it remains computed earlier in `renderLobby`. The `SEAT_CHAIR_SVG` constant declaration in `ui-render.js` can stay (still referenced by other code paths if any) OR be deleted if no other reference remains. Search and confirm.

3. Extract `buildAddBotRow(host, lobbyId)` helper near the bottom of `renderLobby` (replace the existing inline L468-498 block):

```javascript
// Phase 7.8b: the host-only Add Bot row is shared between renderLobby (classic)
// and renderTeamScreen (team-mode), so extract it from the inline block.
function buildAddBotRow(host, lobbyId) {
  if (!host) return null;
  const botRow = document.createElement('div');
  botRow.className = 'add-bot-row';
  const sel = document.createElement('select');
  sel.className = 'bot-diff-select';
  sel.setAttribute('aria-label', 'Bot difficulty');
  [['normal', 'Normal'], ['easy', 'Easy'], ['hard', 'Hard']].forEach(([v, label]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    sel.appendChild(o);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-secondary';
  addBtn.textContent = '+ Add Bot';
  addBtn.addEventListener('click', () => {
    getSocket().emit('addBot', { lobbyId, difficulty: sel.value });
  });
  botRow.appendChild(addBtn);
  botRow.appendChild(sel);
  return botRow;
}
```

(Place this function near the top of the file or in a private-helpers section. Update both renderLobby and renderTeamScreen to call it.)

In `renderLobby`, REPLACE the L468-498 block with:
```javascript
const botModeOk = gameState.gameMode === 'classic' || gameState.gameMode === 'speed';
if (amIHost && botModeOk) {
  const botRow = buildAddBotRow(amIHost, gameState.id);
  if (botRow) startBtn.insertAdjacentElement('afterend', botRow);
}
```

- [ ] **Step 5: Rewrite `renderTeamScreen` in `ui-render.js`**

Replace the body of `renderTeamScreen` (currently L501-543) with:

```javascript
// Phase 7.8b — team-mode lobby is now full-parity with the classic Theater
// Lobby: cinema-screen headers, seat-style chairs (one team color per side
// via --seat-team-color), Director shell mirroring House Rules + Start
// Match. Calls the same buildSeatNode the classic lobby uses (single source
// of truth). Existing socket emit paths unchanged.
let _seenTeamPlayerIds = new Set();
let _lastTeamLobbyId = null;

export function renderTeamScreen(gameState, myPlayerId, amIHost) {
  if (!teamLobbyCode || !teamRedList || !teamBlueList) return;
  teamLobbyCode.innerText = gameState.id || '';

  // Arrival diff — mirrors the classic _seenPlayerIds pattern, lobby-id-keyed.
  if (gameState.id !== _lastTeamLobbyId) {
    _seenTeamPlayerIds = new Set();
    _lastTeamLobbyId = gameState.id;
  }
  const { entering, seen } = diffArrivals(_seenTeamPlayerIds, gameState.players);
  const enteringSet = new Set(entering);
  _seenTeamPlayerIds = new Set(seen);

  const myTeamId = gameState.players.find(p => p.id === myPlayerId)?.teamId;

  // Build per-team seat rows.
  [teamRedList, teamBlueList].forEach((list, teamIdNum) => {
    list.innerHTML = '';
    const teamName = teamIdNum === 0 ? 'red' : 'blue';
    gameState.players
      .filter(p => p.teamId === teamIdNum)
      .forEach(p => {
        const model = seatModel(p, { mode: 'team', team: teamName, myPlayerId });
        const node = buildSeatNode(model,
          {
            onKick:      amIHost ? (id) => getSocket().emit('kickPlayer', { lobbyId: gameState.id, targetId: id }) : null,
            onRemoveBot: amIHost ? (id) => getSocket().emit('removeBot',  { lobbyId: gameState.id, targetId: id }) : null,
            // No onPickHue in team mode — team has a single color per side.
            onPickHue: null,
          },
          {
            playerId: p.id,
            isEntering: enteringSet.has(p.id),
            containerForCleanup: list,
          }
        );
        list.appendChild(node);
      });
  });

  // Join button state — preserved from pre-7.8b verbatim.
  if (joinRedBtn)  joinRedBtn.disabled  = (myTeamId === 0);
  if (joinBlueBtn) joinBlueBtn.disabled = (myTeamId === 1);

  // Start gating + hint — preserved verbatim.
  const team0 = gameState.players.filter(p => p.teamId === 0);
  const team1 = gameState.players.filter(p => p.teamId === 1);
  const teamsReady = team0.length >= 1 && team1.length >= 1;
  if (teamHint) {
    teamHint.innerText = teamsReady
      ? `${team0.length} vs ${team1.length} — Ready to start!`
      : 'Teams need at least 1 player each.';
  }
  if (teamStartBtn) {
    teamStartBtn.style.display = (amIHost && teamsReady) ? 'block' : 'none';
  }

  // House Rules ledger — sync the team-suffixed controls + .ledger-row.on.
  // Theme select: populate (idempotently) + reflect current value.
  const themeSelTeam = document.getElementById('theme-select-team');
  if (themeSelTeam) {
    const themes = Array.isArray(window.__mmThemes) ? window.__mmThemes : [{ id: 'any', label: '🎬 Any (no theme)' }];
    const expectedIds = themes.map(t => t.id).join('|');
    if (themeSelTeam.dataset.themeIds !== expectedIds) {
      themeSelTeam.textContent = '';
      themes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.label;
        if (t.description) opt.title = t.description;
        themeSelTeam.appendChild(opt);
      });
      themeSelTeam.dataset.themeIds = expectedIds;
    }
    themeSelTeam.value = gameState.theme || 'any';
    themeSelTeam.disabled = !amIHost;
  }
  const hcTeam = document.getElementById('hardcore-toggle-team');
  const tvTeam = document.getElementById('tv-shows-toggle-team');
  if (hcTeam) {
    hcTeam.checked = gameState.hardcoreMode || false;
    hcTeam.disabled = !amIHost;
    hcTeam.closest('.ledger-row')?.classList.toggle('on', gameState.hardcoreMode || false);
  }
  if (tvTeam) {
    tvTeam.checked = gameState.allowTvShows || false;
    tvTeam.disabled = !amIHost;
    tvTeam.closest('.ledger-row')?.classList.toggle('on', gameState.allowTvShows || false);
  }

  // Add Bot row — host-only, shared builder with renderLobby.
  // First, remove any prior bot row in the Director shell so we don't accumulate.
  const botContainer = document.getElementById('add-bot-row-team');
  if (botContainer) {
    botContainer.innerHTML = '';
    if (amIHost) {
      const row = buildAddBotRow(amIHost, gameState.id);
      if (row) botContainer.appendChild(row);
    }
  }
}
```

(`diffArrivals`, `seatModel`, `getSocket`, etc. are already imported at top of file. `buildAddBotRow` is the helper extracted in Step 4. `teamLobbyCode`, `teamRedList`, `teamBlueList`, `joinRedBtn`, `joinBlueBtn`, `teamHint`, `teamStartBtn` are existing ui-dom references — no new bindings needed.)

- [ ] **Step 6: Update `public/index.html` — `#team-screen` body**

Find the `#team-screen` block (around L378-401) and REPLACE its body with:

```html
      <!-- TEAM ASSIGNMENT SCREEN — Phase 7.8b Theater parity. Cinema-screen
           header, per-team seat-style chairs, full Director panel mirror
           (House Rules + Start Match). IDs preserved for socket-handler
           continuity: #team-lobby-code, #team-red-list, #team-blue-list,
           #join-red-btn, #join-blue-btn, #team-start-btn, #team-back-btn. -->
      <div id="team-screen" class="panel hidden lobby-panel team-lobby">
        <!-- HEADER (same shape as classic .lobby-head) -->
        <div class="lobby-head">
          <div class="head-title">
            <h2>Room: <span id="team-lobby-code" class="accent-text code"></span></h2>
            <p>Pick your side — the rivals are taking the stage.</p>
          </div>
        </div>

        <!-- 3-COLUMN BODY: red theater | blue theater | director shell -->
        <div class="lobby-body team-lobby-body">

          <!-- RED THEATER -->
          <section class="theater team-theater team-red">
            <div class="stage">
              <div class="screen team-screen-red">
                <div class="screen-eyebrow">Red Team</div>
                <div class="screen-headline">🔴 Take the floor</div>
              </div>
              <div class="light-cone"></div>
            </div>
            <div class="seats-wrap">
              <ul id="team-red-list" class="seats-grid team-seats" data-layout="team"></ul>
            </div>
            <button class="btn btn-join-team" id="join-red-btn">◀ Join Red</button>
          </section>

          <!-- BLUE THEATER -->
          <section class="theater team-theater team-blue">
            <div class="stage">
              <div class="screen team-screen-blue">
                <div class="screen-eyebrow">Blue Team</div>
                <div class="screen-headline">🔵 Take the floor</div>
              </div>
              <div class="light-cone"></div>
            </div>
            <div class="seats-wrap">
              <ul id="team-blue-list" class="seats-grid team-seats" data-layout="team"></ul>
            </div>
            <button class="btn btn-join-team" id="join-blue-btn">Join Blue ▶</button>
          </section>

          <!-- DIRECTOR (mirrors classic) -->
          <aside class="director-shell dir-refined">
            <div class="ref-header">
              <div>
                <div class="ref-eyebrow">Director</div>
                <div class="ref-title">Set the scene</div>
              </div>
              <div class="ref-step-num">Team Battle</div>
            </div>

            <div>
              <div class="field-label"><span class="nu">1</span> House Rules</div>
              <div class="ledger" id="lobby-settings-team">
                <label class="ledger-row">
                  <div>
                    <div class="lr-name">Theme</div>
                    <div class="lr-desc">Filter the candidate pool</div>
                  </div>
                  <div class="lr-right">
                    <select id="theme-select-team" class="theme-select" disabled></select>
                  </div>
                </label>
                <label class="ledger-row" data-toggle="hardcore">
                  <div>
                    <div class="lr-name">Hardcore</div>
                    <div class="lr-desc">No actor reuse anywhere in chain</div>
                  </div>
                  <span class="toggle-pill"></span>
                  <input type="checkbox" id="hardcore-toggle-team" class="ledger-checkbox" disabled>
                </label>
                <label class="ledger-row" data-toggle="tvshows">
                  <div>
                    <div class="lr-name">Allow TV Shows</div>
                    <div class="lr-desc">Include television series</div>
                  </div>
                  <span class="toggle-pill"></span>
                  <input type="checkbox" id="tv-shows-toggle-team" class="ledger-checkbox" disabled>
                </label>
              </div>
            </div>

            <div>
              <button id="team-start-btn" class="btn btn-primary ref-cta" style="display:none;">🎬 Start Match</button>
              <div class="add-bot-row" id="add-bot-row-team"></div>
              <button id="team-back-btn" class="btn btn-secondary team-back">← Back to mode</button>
              <p class="team-hint" id="team-hint">Teams need at least 1 player each.</p>
            </div>
          </aside>

        </div>
      </div>
```

- [ ] **Step 7: Extend `socketClient.js` change-handler registrations**

Search `socketClient.js` for the existing classic ledger change handlers (look for `getElementById('theme-select')` / `'hardcore-toggle'` / `'tv-shows-toggle'` and their `addEventListener('change', ...)` blocks). For EACH of the three, extend to also register on the `-team` suffixed id. Example pattern (adapt to the existing code's exact emit shape):

```javascript
// Phase 7.8b: register the change handler on BOTH the classic ledger control
// and the team-screen's parallel control. The two are different DOM nodes
// (only one is visible at a time per renderLobby's mode dispatch), and the
// emit payload + event name are byte-identical. No new socket event.
['hardcore-toggle', 'hardcore-toggle-team'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', (e) => {
    socket.emit('updateLobbySettings', {
      lobbyId: getCurrentLobbyId(),
      hardcoreMode: e.target.checked,
    });
  });
});
// (mirror this pattern for 'tv-shows-toggle' + 'tv-shows-toggle-team',
// and 'theme-select' + 'theme-select-team'. Use EXACTLY the same emit
// payload shape as the existing classic handlers — read them first and
// copy verbatim.)
```

**IMPORTANT:** the exact emit payload keys (`hardcoreMode`, `allowTvShows`, `themeKey` — or whatever the current code uses) must match the existing classic handler verbatim. Read the current `socketClient.js` change-handler registrations first, then add the `-team` id to the same `[...].forEach(id => ...)` pattern.

- [ ] **Step 8: Run the new tests, all pre-existing tests, then the full suite**

```
npx jest client-tests/render-team-screen.test.js client-tests/socket-handlers.test.js client-tests/render-lobby.test.js client-tests/red-carpet-seat-table.test.js --verbose
```

Expected: all PASS. The classic-lobby tests are the critical regression proof — if any FAIL, the seat-builder refactor diverged from byte-identical output. Fix the divergence before proceeding.

```
npm test --silent
```

Expected: ~560 green (+14 new tests on top of T0's ~546: 11 render-team-screen + 3 socket-handlers). Zero failures.

- [ ] **Step 9: Branch-verify then commit**

```
git branch --show-current
```

Expected: `phase7-8b-team-theater-parity`.

```
git add public/js/ui/ui-seat.js public/js/ui/ui-render.js public/js/socketClient.js public/index.html client-tests/render-team-screen.test.js client-tests/socket-handlers.test.js
git commit -m "$(cat <<'EOF'
Phase 7.8b T1: shared seat builder + team-screen rewrite + handlers

Adds public/js/ui/ui-seat.js with buildSeatNode/buildEmptySeatNode — the
single source of truth for seat <li> DOM, used by both renderLobby
(classic) and renderTeamScreen (team). Branches on model.team: present
→ team mode (--seat-team-color, .team-<color> class, no swatches);
absent → classic (--avatar-hue, optional swatches when is-you).

renderLobby (ui-render.js): inline seat-build block replaced with
buildSeatNode/buildEmptySeatNode calls. Output is byte-identical to the
pre-refactor implementation — the unedited render-lobby.test.js +
red-carpet-seat-table.test.js suites are the regression proof.

renderTeamScreen (ui-render.js): full rewrite. Per-team seat-style
chairs via buildSeatNode (team mode), arrival-diff entrance animation
mirroring the classic _seenPlayerIds + _lastLobbyId pattern, ledger
sync to team-suffixed controls, Add Bot row via the shared
buildAddBotRow helper.

index.html: #team-screen body restructured to the 3-column theater
shape — cinema-screen headers per team, team-red/team-blue seat lists,
Director shell w/ House Rules ledger + Start Match. All existing
button/list ids preserved (#team-lobby-code, #team-red-list,
#team-blue-list, #join-red-btn, #join-blue-btn, #team-start-btn,
#team-back-btn) so existing socket-handler click bindings unchanged.

socketClient.js: the three House Rules change-handler registrations
extended to also bind on the team-suffixed control ids — same event
name + payload as classic; no new socket event.

Server byte-identical (assignTeam, addBot, updateLobbySettings,
kickPlayer, removeBot, selectColor — payloads + event names unchanged).
Suite ~546 → ~560 green; zero pre-existing tests edited.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — CSS: Phase 7.8b Team Theater Lobby section (append-only)

**Goal:** Append a new CSS section to `02-hero-lobby.css` that lays out the team-screen 3-column body and overrides the seat color properties for `.seat.team-red`/`.seat.team-blue` via the new `--seat-team-color` variable. Zero edits to pre-existing rules. Dead rules from the pre-7.8b team-screen (`.team-columns`, `.team-player-list`, etc.) stay for DS-01 pass 2.

**Files:**
- Modify: `public/css/02-hero-lobby.css` — append a new section under a `Phase 7.8b — Team Theater Lobby` banner (~120-180 LOC).

**Acceptance Criteria:**
- [ ] No edits to pre-existing rules in `02-hero-lobby.css` (verified by `git diff` showing only additions in the new section block).
- [ ] At ≥1000px, the team-screen `.lobby-body.team-lobby-body` displays as a 3-column grid (red | blue | director).
- [ ] At <1000px, the three columns stack vertically (red → blue → director).
- [ ] At <640px, seat sizes tighten the same way classic lobby's `<640px` rule does.
- [ ] `.team-theater .seat.team-red` and `.team-theater .seat.team-blue` use `--seat-team-color` for the avatar SVG fill, nameplate ring, and spotlight; the classic `.seat .seat-svg path` / `.nameplate` / `.seat-spotlight` rules are unmodified.
- [ ] No new color tokens introduced (reuses `--team-red`, `--team-blue`, `--team-red-bg`, `--team-blue-bg`, `--team-red-border`, `--team-blue-border` from `01-base.css`).
- [ ] `npm test --silent` still green (test count unchanged from T1).

**Verify:**
```
npm test --silent && git diff --stat public/css/02-hero-lobby.css
```

Expected: tests green; the diff shows only additions (lines added > 0, lines deleted == 0).

**Steps:**

- [ ] **Step 1: Read the existing `.theater`/`.screen`/`.seats-grid`/`.seat` rules**

Read `public/css/02-hero-lobby.css` around L838-1300 (the `.theater` two-column body section). Note the exact selectors used for seat avatar SVG fill, nameplate border/glow, and spotlight color — these are the properties that need overriding for team seats.

Common targets (verify by reading the file):
- `.theater .seat .seat-svg path[fill]` or `.seat-svg-wrap path` — avatar SVG color
- `.theater .seat .nameplate` border / box-shadow
- `.theater .seat .seat-spotlight` background

- [ ] **Step 2: Append the new section to `02-hero-lobby.css`**

At the END of the file, add:

```css
/* =============================================================================
   Phase 7.8b — Team Theater Lobby (append-only)
   =============================================================================
   The team-screen now mirrors the classic Theater Lobby aesthetic: cinema
   screen + per-team seat-style chairs + Director shell. All rules below are
   NEW (no edits to pre-existing rules — the existing .theater/.screen/.seat
   blocks already apply to the team seats because the team <ul>s carry
   class="seats-grid" and the seats carry class="seat occupied"). Team-only
   property overrides are higher-specificity additions scoped to .team-theater
   .seat.team-<color> selectors — classic seats are unaffected.

   Tokens: reuses --team-red / --team-blue (family) from 01-base.css. No new
   colour values. No new motion property (entrance animation reuses the
   existing .is-entering keyframes already neutralised by the global
   prefers-reduced-motion block).
   ========================================================================= */

/* 3-column wide layout. */
.team-lobby-body {
  display: grid;
  grid-template-columns: 1fr 1fr 1.1fr;
  gap: 1rem;
  align-items: start;
}

/* The two team theaters sit slightly tighter than the single-team .theater
   (each column is narrower). Re-uses the parent .theater rules for stage,
   screen, seats-wrap layout; this only tightens the outer padding. */
.team-theater {
  padding: 0.75rem;
}

/* Cinema-screen tint per team. Adds a higher-specificity tint over the
   existing .theater .screen gradient (which uses the indigo accent) so the
   tint reads as a team-color wash without editing the base rule. */
.team-theater.team-red .screen {
  background-image: linear-gradient(180deg,
    rgba(239, 68, 68, 0.18),
    rgba(239, 68, 68, 0.08) 60%,
    transparent),
    /* preserve the base indigo screen glow underneath */
    linear-gradient(180deg, rgba(129, 140, 248, 0.10), transparent);
}
.team-theater.team-blue .screen {
  background-image: linear-gradient(180deg,
    rgba(59, 130, 246, 0.18),
    rgba(59, 130, 246, 0.08) 60%,
    transparent),
    linear-gradient(180deg, rgba(129, 140, 248, 0.10), transparent);
}

/* Team seat color override. The seat <li> carries inline style
   "--seat-team-color: var(--team-red|--team-blue)" set by buildSeatNode.
   These higher-specificity rules override the SVG/nameplate/spotlight color
   properties for team seats only — classic seats (no .team-red/.team-blue
   class) are unaffected. */
.team-theater .seat.team-red,
.team-theater .seat.team-blue {
  /* CSS variable indirection: the chair-velvet gradient stops in the seat
     SVG reference hsl(var(--avatar-hue),...). For team seats we override the
     SVG fill DIRECTLY via the path's [fill] attribute selector below; the
     --avatar-hue var is unset on team seats, so any stray hsl(var(--avatar-hue))
     reference falls back to the seat's default (browser handles unset gracefully). */
}

/* Avatar SVG: override the velvet gradient stops with the team color.
   This is the property that visually identifies the team — the chair color. */
.team-theater .seat.team-red .seat-svg path,
.team-theater .seat.team-red .seat-svg rect {
  fill: var(--team-red) !important;
}
.team-theater .seat.team-blue .seat-svg path,
.team-theater .seat.team-blue .seat-svg rect {
  fill: var(--team-blue) !important;
}

/* Nameplate ring: tint the border + glow with the team color. */
.team-theater .seat.team-red .nameplate {
  border-color: var(--team-red-border);
  box-shadow: 0 0 8px 0 var(--team-red-bg);
}
.team-theater .seat.team-blue .nameplate {
  border-color: var(--team-blue-border);
  box-shadow: 0 0 8px 0 var(--team-blue-bg);
}

/* Spotlight wash under the seat — tinted to team color. */
.team-theater .seat.team-red .seat-spotlight {
  background: radial-gradient(ellipse at center, var(--team-red-bg), transparent 70%);
}
.team-theater .seat.team-blue .seat-spotlight {
  background: radial-gradient(ellipse at center, var(--team-blue-bg), transparent 70%);
}

/* Join button positioning inside the team column: directly under the
   seats-wrap, full-width. The existing .btn-join-team rule (from the
   pre-7.8b CSS in the file) supplies size + hover; this just anchors
   it to the bottom of the column. */
.team-theater .btn-join-team {
  margin-top: 0.75rem;
  width: 100%;
}

/* Mobile: stack the 3 columns vertically (red → blue → director).
   The internal layout of each .team-theater / .director-shell is unchanged. */
@media (max-width: 999px) {
  .team-lobby-body {
    grid-template-columns: 1fr;
  }
}

/* Tighten seat sizes at narrow widths (mirror the classic <640px rule's
   intent without editing it). */
@media (max-width: 639px) {
  .team-theater .seats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

**Notes:**
- The `!important` on the SVG fill override is the conventional way to win the cascade against an SVG attribute fill set by the chair gradient — DO NOT add `!important` anywhere else. If the existing chair SVG uses gradient stops via `url(#velvet)` rather than per-element fill, the override approach may need to set `--seat-team-color` and have the gradient stops reference it via `hsl(...)` math, which would require editing the gradient definition — TALK TO THE USER before doing that. The fastest no-edit path is to set the `fill` attribute directly on `.seat-svg path/rect` with `!important`.
- Alternative if `!important` is unacceptable: write a NEW chair SVG variant inside `buildSeatNode` for team mode (a single-color flat fill instead of the gradient). The cost: a second SVG markup constant in `ui-seat.js`. The benefit: no `!important`, cleaner cascade. **Decide at implementation time based on what the existing chair SVG looks like.**

- [ ] **Step 3: Verify the CSS diff is append-only**

```
git diff public/css/02-hero-lobby.css | head -5
```

Expected: shows new lines starting with `+` near the bottom of the file; ZERO `-` lines.

```
git diff --stat public/css/02-hero-lobby.css
```

Expected: insertions > 0, deletions == 0.

- [ ] **Step 4: Run the full suite**

```
npm test --silent
```

Expected: still ~560 green (T2 adds no new tests; CSS is jsdom-blind). Zero failures.

- [ ] **Step 5: Branch-verify then commit**

```
git branch --show-current
```

Expected: `phase7-8b-team-theater-parity`.

```
git add public/css/02-hero-lobby.css
git commit -m "$(cat <<'EOF'
Phase 7.8b T2: CSS append — team theater 3-col layout + team-color overrides

Appends a new "Phase 7.8b — Team Theater Lobby" section to
02-hero-lobby.css. Zero edits to pre-existing rules — the existing
.theater/.screen/.seats-grid/.seat blocks already render correctly for
team seats (the team <ul>s carry class="seats-grid", seats carry "seat
occupied"). New higher-specificity rules scoped to .team-theater
.seat.team-red / .team-blue override the avatar SVG fill, nameplate ring,
and spotlight color via the --seat-team-color variable set in
buildSeatNode. Classic seats are unaffected (no .team-red/.team-blue
class).

Layout: 3-column wide (red | blue | director) via .team-lobby-body grid;
stacks vertically <1000px; seats tighten to 2-col grid <640px.

No new colour values — reuses --team-red / --team-blue / --team-red-bg /
--team-blue-bg / --team-red-border / --team-blue-border from 01-base.css.
Cinema-screen tint preserves the base indigo glow underneath.

Dead pre-7.8b team-screen rules (.team-columns, .team-player-list,
.team-player-chip, .btn-join-team original, .team-hint, .chip-host) stay
in the file for DS-01 pass 2 — append-only discipline.

Suite green; in-browser eyeball owed (jsdom can't lay out CSS).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Post-task verification (the GO bar)

After T2 commits, run the full suite one more time:

```
npm test --silent
```

Expected:
- 62 test suites, all PASS
- ~560 tests passing
- Zero failures
- Zero tests skipped

Spec-coverage check (manual):
- [ ] §1 decisions 1-4 all implemented
- [ ] §3.1 `seatModel` exported and tested
- [ ] §3.2 `buildSeatNode` exported and tested
- [ ] §3.3 `#team-screen` DOM matches the spec
- [ ] §3.4 socketClient.js change handlers extended
- [ ] §3.5 `renderTeamScreen` rewrite complete
- [ ] §3.6 CSS append-only with new section banner
- [ ] §4 behavioural equivalence preserved
- [ ] §5 all sacrosanct guards still green
- [ ] §8 all 10 guardrails honored
- [ ] §10 all 9 acceptance criteria met

Hand the PR to the user for the in-browser eyeball + merge/deploy.

---

## Sub-skill handoff

Use `superpowers-extended-cc:subagent-driven-development` (or `executing-plans`) to implement these tasks. Tasks are linear (T0 → T1 → T2 — T1 depends on T0's `seatModel`, T2 depends on T1's `buildSeatNode` setting `--seat-team-color`). Each task is its own commit. Per-task spec-compliance + code-quality reviews per spec §7.
