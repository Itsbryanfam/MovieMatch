# Phase 7.5.3 — Pick-Your-Own-Color (Theater Lobby) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player in the Theater waiting room click a swatch on their own seat to claim any seat-hue no other player currently holds — server-authoritative, mutually exclusive, room-scoped, zero-identity.

**Architecture:** One new `assignTeam`-shaped non-host self-mutation `lobbySystem.selectColor` under `withLobbyLock` (claim-only against every *other* player's *effective hue* = explicit `colorHue` else `SEAT_HUES[slot]`); an additive optional per-player `colorHue` field that rides the existing `toClientState` spread (zero projection edit, zero-identity); the pure client seam `playerCardModel` prefers `colorHue` else the 7.5.1 slot hue (+ a `hasPickedColor` boolean); `renderLobby` adds a `.seat-swatches` strip on the local player's own occupied seat; the `.seat.is-you` indigo override is scoped to `:not(.has-picked)` so the picker sees their own choice while an un-picked "you" stays byte-identical to 7.5.2.

**Tech Stack:** Node CommonJS + Socket.io + Redis-TTL room state (server); vanilla ES-module no-build client; Jest 30 + jest-environment-jsdom. Worktree `C:\mm-phase7-5-3`, branch `phase7-5-3-pick-your-color`, off `origin/main ed6f041`. Spec: `docs/superpowers/specs/2026-05-19-pick-your-color-design.md` (`f8ea43c`).

---

## Conventions for every task

- **Branch-verify before EVERY commit:** `git -C C:/mm-phase7-5-3 branch --show-current` MUST print `phase7-5-3-pick-your-color`; abort the commit otherwise (a parallel Codex agent shares the repo).
- **Every code change ships a WHY comment** (project standing directive).
- **Verify command** runs from the worktree: `cd C:/mm-phase7-5-3 && npx jest …` (node_modules is junctioned to the shared real install). Full `cd C:/mm-phase7-5-3 && npx jest` MUST end green at every task.
- **TDD:** write the test, watch it fail for the right reason, minimal implementation, watch it pass, then commit.
- After each task's own commit, sync `docs/superpowers/plans/2026-05-19-pick-your-color.md.tasks.json` (`status: completed`, bump `lastUpdated`) as **its own follow-up commit** (mirrors 7.5.2).
- **Out-of-scope findings → `spawn_task` chip, never widen 7.5.3.**

## File Structure (locked decomposition)

| File | Task | Responsibility |
|---|---|---|
| `server/constants.js` | 0 | + `SEAT_HUES` frozen palette mirror (server-authoritative validation source) |
| `server/systems/lobbySystem.js` | 0 | + `selectColor` (claim-only RMW under `withLobbyLock`) + export |
| `server/socketHandlers.js` | 0 | + one `on('selectColor')` block behind the existing shared limiter |
| `server/systems/lobbySystem.selectcolor.test.js` | 0 | NEW — `selectColor` mutex truth + `constants.SEAT_HUES` literal pin |
| `server/gameLogic.colorhue.test.js` | 0 | NEW — `toClientState` carries `colorHue`, never `stableId` |
| `public/js/ui/red-carpet.js` | 1 | `playerCardModel` prefer-`colorHue`-else-slot + `hasPickedColor` |
| `client-tests/red-carpet.test.js` | 1 | seam's OWN suite — extend for the new model contract + exact-literal `SEAT_HUES` pin |
| `public/js/ui/ui-render.js` | 2 | `.seat-swatches` strip on `card.isYou` seat + `selectColor` emit + `.has-picked` |
| `public/css/02-hero-lobby.css` | 2 | scope ONE `.seat.is-you` block to `:not(.has-picked)` + append-only PHASE 7.5.3 section |
| `client-tests/render-lobby.test.js` | 2 | extend — swatch contract + `.has-picked` + `selectColor` emit |
| `client-tests/red-carpet-render.test.js` | 2 | extend — swatch present on own seat / absent on others & team |
| `client-tests/red-carpet-seat-table.test.js` | 2 | extend — a picked hue stays distinct end-to-end |

`server/gameLogic.js` `toClientState` is **BYTE-IDENTICAL, ZERO edit** — `players: state.players.map(({ stableId, ...rest }) => rest)` (L111) already carries `colorHue` via `...rest`.

---

### Task 0: Server colour mutex (`selectColor`)

**Goal:** A server-authoritative `selectColor` lets a player claim a free palette hue; the room player object gains an additive `colorHue`; `toClientState` is proven to carry it and never `stableId`.

**Files:**
- Modify: `server/constants.js` (L19-21 — add `SEAT_HUES` + export)
- Modify: `server/systems/lobbySystem.js` (add `selectColor` after `assignTeam` which ends at L282; add to `module.exports` L853-871)
- Modify: `server/socketHandlers.js` (add one `on('selectColor')` block after the `assignTeam` wiring at L209-212)
- Create: `server/systems/lobbySystem.selectcolor.test.js`
- Create: `server/gameLogic.colorhue.test.js`

**Acceptance Criteria:**
- [ ] `require('../constants').SEAT_HUES` deep-equals `[350,25,45,140,188,220,270,312]`, is frozen, length 8.
- [ ] `selectColor` sets `colorHue` for a free in-palette hue in a waiting lobby and broadcasts; declines (no broadcast, no mutation) for: off-palette / non-int hue; a hue equal to another player's effective hue (incl. an un-picked player's slot fallback); `status!=='waiting'`; a socket not in `r.players`.
- [ ] A claimed hue is freed when the holder leaves (player filtered out → effective hue reverts to slot fallback).
- [ ] `toClientState` output players carry `colorHue` and never carry `stableId`.
- [ ] `server/socketHandlers.js` diff vs `ed6f041` is exactly the one added `on('selectColor')` block; `server/gameLogic.js` diff is EMPTY; all other `server/**` byte-identical & green.

**Verify:** `cd C:/mm-phase7-5-3 && npx jest server` → green incl. the 2 new suites; then `cd C:/mm-phase7-5-3 && npx jest` → full green (client untouched — no-`colorHue` fixtures unaffected).

**Steps:**

- [ ] **Step 1: Write the failing server tests**

Create `server/systems/lobbySystem.selectcolor.test.js` (harness mirrors `lobbySystem.botlifecycle.test.js` verbatim):

```js
// ============================================================================
// lobbySystem.selectcolor.test.js — Phase 7.5.3 pick-your-own-colour mutex
// ============================================================================
// WHY: selectColor is the first non-host self-mutation that enforces a
// claim-only palette mutex. These pins are the server-authoritative truth
// (the client only offers free swatches; the server is the arbiter).
const lobbySystem = require('./lobbySystem');
const redisUtils = require('../redisUtils');
const { SEAT_HUES } = require('../constants');
jest.mock('../redisUtils');

const HOST = 'sock-host';
const GUEST = 'sock-guest';
function lobby(over = {}) {
  return {
    id: 'L', status: 'waiting', gameMode: 'classic', isPublic: false,
    players: [
      { id: HOST, name: 'Host', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 'h' },
      { id: GUEST, name: 'Guest', isHost: false, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, stableId: 'g' },
    ],
    spectators: [], chain: [], usedMovies: [], ...over,
  };
}
let io, ctx, broadcast;
beforeEach(() => {
  jest.clearAllMocks();
  io = { to: jest.fn().mockReturnThis(), emit: jest.fn(), sockets: { sockets: new Map() } };
  ctx = { io, pubClient: {}, logger: { error: jest.fn() } };
  redisUtils.withLobbyLock.mockImplementation(async (_p, _id, fn) => {
    const r = global.__room; await fn(r); return r;
  });
  // selectColor broadcasts via gameLogic.broadcastState — spy it so we can
  // assert "committed → broadcast" vs "declined → no broadcast" without a
  // real io fan-out.
  broadcast = jest.spyOn(require('../gameLogic'), 'broadcastState').mockImplementation(() => {});
});
afterEach(() => broadcast.mockRestore());

describe('constants.SEAT_HUES (server mirror of red-carpet.js:39)', () => {
  test('exact frozen literal — pinned both sides so an edit fails CI', () => {
    expect([...SEAT_HUES]).toEqual([350, 25, 45, 140, 188, 220, 270, 312]);
    expect(Object.isFrozen(SEAT_HUES)).toBe(true);
    expect(SEAT_HUES).toHaveLength(8);
  });
});

describe('selectColor — claim-only mutex', () => {
  test('claims a FREE in-palette hue + broadcasts', async () => {
    global.__room = lobby();
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players.find(p => p.id === GUEST).colorHue).toBe(SEAT_HUES[5]);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  test('declines a hue that is another player’s EXPLICIT colorHue (no mutate, no broadcast)', async () => {
    global.__room = lobby();
    global.__room.players[0].colorHue = SEAT_HUES[5]; // host already holds it
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players[1].colorHue).toBeUndefined();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('declines a hue that equals an UN-PICKED player’s slot fallback', async () => {
    // Guest is index 1 → fallback SEAT_HUES[1]. Host (index 0, un-picked)
    // has effective hue SEAT_HUES[0]; guest must not claim SEAT_HUES[0].
    global.__room = lobby();
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[0] });
    expect(global.__room.players[1].colorHue).toBeUndefined();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('declines off-palette and non-integer hues', async () => {
    global.__room = lobby();
    for (const bad of [37, 999, -1, 1.5, '350', null, undefined, NaN]) {
      await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: bad });
    }
    expect(global.__room.players[1].colorHue).toBeUndefined();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('declines when status !== waiting', async () => {
    global.__room = lobby({ status: 'playing' });
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players[1].colorHue).toBeUndefined();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('declines a socket that is not a player in the room', async () => {
    global.__room = lobby();
    await lobbySystem.selectColor(ctx, { id: 'sock-stranger', emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players.some(p => p.colorHue !== undefined)).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('re-claiming after the holder leaves succeeds (hue freed on leave)', async () => {
    global.__room = lobby();
    global.__room.players[0].colorHue = SEAT_HUES[5];
    // Host leaves → array becomes [Guest] (index 0). Guest may now claim
    // SEAT_HUES[5] (no other player holds it).
    global.__room.players = [global.__room.players[1]];
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players[0].colorHue).toBe(SEAT_HUES[5]);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  test('a player may keep their own current hue path open (own index excluded from taken)', async () => {
    // Guest already picked SEAT_HUES[5]; re-selecting the same is a no-op
    // claim (not blocked by self) and still commits/broadcasts idempotently.
    global.__room = lobby();
    global.__room.players[1].colorHue = SEAT_HUES[5];
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players[1].colorHue).toBe(SEAT_HUES[5]);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });
});
```

Create `server/gameLogic.colorhue.test.js`:

```js
// ============================================================================
// gameLogic.colorhue.test.js — Phase 7.5.3 toClientState carries colorHue,
// never stableId (G1). WHY a dedicated file: keeps server/gameLogic.test.js
// BYTE-IDENTICAL (the §5 ratchet) while pinning the additive-field invariant.
// toClientState is pure — no redis/socket needed.
// ============================================================================
const { toClientState } = require('./gameLogic');

test('toClientState carries colorHue on each player and strips stableId', () => {
  const room = {
    id: 'R', status: 'waiting', players: [
      { id: 'a', name: 'A', isHost: true, stableId: 'p_SECRET_A', colorHue: 350 },
      { id: 'b', name: 'B', stableId: 'p_SECRET_B' }, // un-picked → no colorHue
    ],
    spectators: [], chain: [],
  };
  const cs = toClientState(room);
  expect(cs.players[0].colorHue).toBe(350);
  expect('colorHue' in cs.players[1]).toBe(false);
  cs.players.forEach(p => expect('stableId' in p).toBe(false));
  expect(JSON.stringify(cs)).not.toContain('p_SECRET');
});
```

- [ ] **Step 2: Run the new tests — verify they FAIL for the right reason**

Run: `cd C:/mm-phase7-5-3 && npx jest server/systems/lobbySystem.selectcolor.test.js server/gameLogic.colorhue.test.js`
Expected: `selectcolor` FAILs (`lobbySystem.selectColor is not a function` + `constants` `SEAT_HUES` undefined); `gameLogic.colorhue` PASSES already (the spread keeps `colorHue`, strips `stableId`) — that is the byte-identical-`toClientState` proof and is acceptable as a guard that stays green from the start. (If `gameLogic.colorhue` somehow fails, STOP — `toClientState` must not be edited.)

- [ ] **Step 3: Implement — `server/constants.js`**

Replace L19-21 (currently `const MAX_PLAYERS_PER_LOBBY = 8;` … `module.exports = { MAX_PLAYERS_PER_LOBBY };`) with:

```js
const MAX_PLAYERS_PER_LOBBY = 8;

// Phase 7.5.3 (Pick-Your-Own-Colour): the frozen seat-hue palette. WHY a
// server mirror: the server is CommonJS and cannot import the client ES
// module public/js/ui/red-carpet.js (line 39) where SEAT_HUES is the
// authoritative client copy. selectColor validates the requested hue
// against THIS list server-side — the setTheme whitelist precedent (a
// malicious client must not set an off-palette chair colour). This array
// MUST stay byte-identical to red-carpet.js:39; a test pins the exact
// literal on BOTH sides so an edit to either fails CI.
const SEAT_HUES = Object.freeze([350, 25, 45, 140, 188, 220, 270, 312]);

module.exports = { MAX_PLAYERS_PER_LOBBY, SEAT_HUES };
```

- [ ] **Step 4: Implement — `server/systems/lobbySystem.js` `selectColor`**

Insert this function immediately AFTER `assignTeam` (which ends with its closing `}` at L282, before `async function toggleSetting`):

```js
// Phase 7.5.3 (Pick-Your-Own-Colour): a player claims a free seat-hue.
// NON-host self-mutation — you only ever recolour yourself, so (exactly
// like assignTeam) there is NO host check. Claim-only: rejected if the
// requested hue is any OTHER player's EFFECTIVE hue (their explicit
// colorHue, else SEAT_HUES[their room-array slot]). Server-authoritative
// palette validation (the setTheme whitelist precedent). RMW strictly
// under withLobbyLock so a concurrent join/settings change can't clobber
// the write (audit finding #4, mirrors every sibling mutator). colorHue
// is a frozen-palette integer → ZERO identity (never stableId/name/id);
// toClientState ships it via ...rest with no projection change.
async function selectColor(ctx, socket, { lobbyId, hue }) {
  const { io, pubClient } = ctx;
  const { SEAT_HUES } = require('../constants');
  if (!Number.isInteger(hue) || !SEAT_HUES.includes(hue)) return;
  let changed = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') return false;
    const meIdx = r.players.findIndex(p => p.id === socket.id);
    if (meIdx === -1) return false;
    const taken = r.players.some((p, i) => {
      if (i === meIdx) return false; // not blocked by my own current hue
      const eff = (Number.isInteger(p.colorHue) && SEAT_HUES.includes(p.colorHue))
        ? p.colorHue
        : SEAT_HUES[((i % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length];
      return eff === hue;
    });
    if (taken) return false;
    r.players[meIdx].colorHue = hue;
    changed = true;
  });
  if (changed && room) gameLogic.broadcastState(io, lobbyId, room);
}
```

Add `selectColor,` to `module.exports` (the object L853-871) — insert it on its own line after `assignTeam,` so the diff is minimal:

```js
  assignTeam,
  selectColor,
  toggleSetting,
```

- [ ] **Step 5: Implement — `server/socketHandlers.js` wiring**

Immediately AFTER the `assignTeam` wiring block (L209-212, which ends `});`), insert:

```js
    on('selectColor', async (data) => {
      // Phase 7.5.3: non-host self-mutation, same cadence class as
      // assignTeam → reuse the shared host/lifecycle limiter (no new
      // bucket — G7). data||{} guard mirrors addBot.
      if (await lobbyConfigLimited()) return;
      await lobbySystem.selectColor(ctx, socket, data || {});
    });
```

- [ ] **Step 6: Run the tests — verify GREEN**

Run: `cd C:/mm-phase7-5-3 && npx jest server`
Expected: PASS — `lobbySystem.selectcolor.test.js` (all cases) + `gameLogic.colorhue.test.js` green; every pre-existing server suite still green.

- [ ] **Step 7: Verify the byte-identical ratchet, then full suite**

Run:
```
git -C C:/mm-phase7-5-3 diff --stat ed6f041 -- server/gameLogic.js
git -C C:/mm-phase7-5-3 diff ed6f041 -- server/socketHandlers.js
cd C:/mm-phase7-5-3 && npx jest
```
Expected: `server/gameLogic.js` diff EMPTY; `server/socketHandlers.js` diff = exactly the one added `on('selectColor')` block; full `npx jest` GREEN (client untouched — no-`colorHue` fixtures render exactly as 7.5.2).

- [ ] **Step 8: Commit (branch-verified)**

```bash
git -C C:/mm-phase7-5-3 branch --show-current   # MUST be phase7-5-3-pick-your-color
git -C C:/mm-phase7-5-3 add server/constants.js server/systems/lobbySystem.js server/socketHandlers.js server/systems/lobbySystem.selectcolor.test.js server/gameLogic.colorhue.test.js
git -C C:/mm-phase7-5-3 commit -m "Phase 7.5.3 Task 0: server selectColor claim-only mutex + colorHue"
```

```json:metadata
{"files": ["server/constants.js", "server/systems/lobbySystem.js", "server/socketHandlers.js", "server/systems/lobbySystem.selectcolor.test.js", "server/gameLogic.colorhue.test.js"], "verifyCommand": "cd C:/mm-phase7-5-3 && npx jest server", "acceptanceCriteria": ["constants.SEAT_HUES === frozen [350,25,45,140,188,220,270,312] (len 8)", "selectColor claims a free in-palette hue + broadcasts; declines off-palette/non-int, taken (explicit OR un-picked slot fallback), status!=='waiting', non-member; hue freed on leave; RMW under withLobbyLock", "toClientState carries colorHue, never stableId (gameLogic.js byte-identical)", "socketHandlers.js diff = exactly one on('selectColor') block; other server/** byte-identical; full npx jest green"]}
```

---

### Task 1: Client seam — `playerCardModel` prefers `colorHue`

**Goal:** The pure seam returns the picked hue when validly set (else the 7.5.1 slot hue) and exposes `hasPickedColor`; un-picked players stay byte-identical to 7.5.2.

**Blocked by:** Task 0.

**Files:**
- Modify: `public/js/ui/red-carpet.js` (`playerCardModel` body L130-145)
- Modify: `client-tests/red-carpet.test.js` (extend the `playerCardModel` describe; add exact-literal `SEAT_HUES` pin)

**Acceptance Criteria:**
- [ ] `playerCardModel(p,{slot})` with no `colorHue` → `accentHue === SEAT_HUES[slot]`, `hasPickedColor === false` (byte-identical to 7.5.2; all existing seam cases still green).
- [ ] With a valid in-palette `p.colorHue` → `accentHue === p.colorHue`, `hasPickedColor === true`.
- [ ] Off-palette / non-integer / absent `colorHue` → fallback to slot hue, `hasPickedColor === false`.
- [ ] `SEAT_HUES` deep-equals the exact literal `[350,25,45,140,188,220,270,312]` (the both-sides pin, G6).
- [ ] The SECURITY sentinel still holds; `red-carpet.js` exports unchanged (still pure, zero-import).
- [ ] `git diff ed6f041 -- public/js/ui/ui-render.js public/css/02-hero-lobby.css` EMPTY; full `npx jest` green (the 3 lobby suites unaffected — additive field).

**Verify:** `cd C:/mm-phase7-5-3 && npx jest client-tests/red-carpet.test.js` → green; then `cd C:/mm-phase7-5-3 && npx jest` → full green.

**Steps:**

- [ ] **Step 1: Write the failing seam tests**

Append this `describe` block to `client-tests/red-carpet.test.js` (after the existing `playerCardModel` describe ends at L157, before `describe('rollCameraLabel`):

```js
describe('SEAT_HUES — exact literal pin (must match server/constants.js)', () => {
  test('the frozen palette is byte-identical to the server mirror', () => {
    // WHY exact values (the 7.5.1 suite only pinned len/distinct/range):
    // Phase 7.5.3 added server/constants.js SEAT_HUES for server-side
    // validation. Pinning the SAME literal on BOTH sides makes any drift
    // (a one-side edit) fail CI — they cannot cross-import (ESM vs CJS).
    expect([...SEAT_HUES]).toEqual([350, 25, 45, 140, 188, 220, 270, 312]);
  });
});

describe('playerCardModel — Phase 7.5.3 colorHue prefer/fallback', () => {
  test('no colorHue → slot hue + hasPickedColor false (byte-identical to 7.5.2)', () => {
    const m = playerCardModel({ id: 's1', name: 'Ada' }, { slot: 3 });
    expect(m.accentHue).toBe(SEAT_HUES[3]);
    expect(m.hasPickedColor).toBe(false);
  });
  test('valid in-palette colorHue overrides the slot hue', () => {
    const m = playerCardModel({ id: 's1', name: 'Ada', colorHue: SEAT_HUES[6] }, { slot: 2 });
    expect(m.accentHue).toBe(SEAT_HUES[6]);
    expect(m.hasPickedColor).toBe(true);
  });
  test('off-palette / non-int / null colorHue → slot fallback, not picked', () => {
    for (const bad of [37, 999, -1, 2.5, '350', null, undefined, NaN]) {
      const m = playerCardModel({ id: 's1', name: 'Ada', colorHue: bad }, { slot: 1 });
      expect(m.accentHue).toBe(SEAT_HUES[1]);
      expect(m.hasPickedColor).toBe(false);
    }
  });
  test('a picked colorHue still carries ZERO identity (sentinel: stableId irrelevant)', () => {
    const base = { id: 's1', name: 'Ada', colorHue: SEAT_HUES[4] };
    expect(playerCardModel({ ...base, stableId: 'p_LEAK' }, { slot: 0 }))
      .toEqual(playerCardModel(base, { slot: 0 }));
  });
});
```

- [ ] **Step 2: Run — verify FAIL for the right reason**

Run: `cd C:/mm-phase7-5-3 && npx jest client-tests/red-carpet.test.js`
Expected: the new `colorHue` cases FAIL (`m.hasPickedColor` is `undefined`; `accentHue` ignores `colorHue`). All pre-existing cases still PASS (no `colorHue` in their fixtures). The exact-literal `SEAT_HUES` pin PASSES immediately (values already correct) — acceptable; it is a drift guard.

- [ ] **Step 3: Implement — `public/js/ui/red-carpet.js`**

In `playerCardModel`, replace the two lines currently at L130-132:

```js
  const rawSlot = Number.isInteger(opts && opts.slot) ? opts.slot : 0;
  const accentHue =
    SEAT_HUES[((rawSlot % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length];
```

with:

```js
  const rawSlot = Number.isInteger(opts && opts.slot) ? opts.slot : 0;
  const slotHue =
    SEAT_HUES[((rawSlot % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length];
  // Phase 7.5.3 (Pick-Your-Own-Colour): an explicitly-claimed, in-palette
  // colorHue overrides the slot default so the player SEES their own
  // choice. Anything else (absent / non-int / off-palette) falls back to
  // the 7.5.1 collision-free slot hue → a player who never picks is
  // byte-identical to 7.5.2. ZERO identity: colorHue is a frozen-palette
  // integer, NEVER derived from stableId/name/socket-id (sentinel-tested).
  const hasPickedColor =
    Number.isInteger(p.colorHue) && SEAT_HUES.includes(p.colorHue);
  const accentHue = hasPickedColor ? p.colorHue : slotHue;
```

Then change the return statement (currently L145) from:

```js
  return { name, isHost, isYou, isBot, wins, accentHue, accentEmoji, label };
```

to:

```js
  return { name, isHost, isYou, isBot, wins, accentHue, accentEmoji, label, hasPickedColor };
```

- [ ] **Step 4: Run — verify GREEN**

Run: `cd C:/mm-phase7-5-3 && npx jest client-tests/red-carpet.test.js`
Expected: PASS — all new `colorHue`/`hasPickedColor` cases + every pre-existing seam case green.

- [ ] **Step 5: Verify the ratchet + full suite**

Run:
```
git -C C:/mm-phase7-5-3 diff --stat ed6f041 -- public/js/ui/ui-render.js public/css/02-hero-lobby.css
cd C:/mm-phase7-5-3 && npx jest
```
Expected: `ui-render.js` + `02-hero-lobby.css` diff EMPTY; full `npx jest` GREEN — `render-lobby.test.js` / `red-carpet-render.test.js` / `red-carpet-seat-table.test.js` UNAFFECTED (no `colorHue` in their fixtures → `accentHue` unchanged, the new `hasPickedColor` field ignored by their assertions).

- [ ] **Step 6: Commit (branch-verified)**

```bash
git -C C:/mm-phase7-5-3 branch --show-current   # MUST be phase7-5-3-pick-your-color
git -C C:/mm-phase7-5-3 add public/js/ui/red-carpet.js client-tests/red-carpet.test.js
git -C C:/mm-phase7-5-3 commit -m "Phase 7.5.3 Task 1: playerCardModel prefers colorHue + hasPickedColor"
```

```json:metadata
{"files": ["public/js/ui/red-carpet.js", "client-tests/red-carpet.test.js"], "verifyCommand": "cd C:/mm-phase7-5-3 && npx jest client-tests/red-carpet.test.js", "acceptanceCriteria": ["no colorHue → accentHue==SEAT_HUES[slot], hasPickedColor false (byte-identical 7.5.2)", "valid in-palette colorHue → accentHue==colorHue, hasPickedColor true; off-palette/non-int/absent → slot fallback, not picked", "SEAT_HUES deep-equals [350,25,45,140,188,220,270,312] (both-sides pin); SECURITY sentinel holds; red-carpet.js still pure zero-import", "ui-render.js & 02-hero-lobby.css diff vs ed6f041 EMPTY; full npx jest green (3 lobby suites unaffected)"]}
```

---

### Task 2: Client render + CSS — the swatch strip

**Goal:** The local player's own occupied seat shows a `.seat-swatches` strip; clicking a free swatch emits `selectColor`; a picked seat carries `.has-picked` and the `.seat.is-you` indigo override yields so the picker sees their own colour.

**Blocked by:** Task 1.

**Files:**
- Modify: `public/js/ui/ui-render.js` (import L33; `li.className` L216-220; insert swatch builder after the `.seat-person` append at L260)
- Modify: `public/css/02-hero-lobby.css` (scope L1145 selector; append PHASE 7.5.3 section after L1621)
- Modify: `client-tests/render-lobby.test.js`, `client-tests/red-carpet-render.test.js`, `client-tests/red-carpet-seat-table.test.js` (extend)

**Acceptance Criteria:**
- [ ] The local player's OWN occupied seat has one `.seat-swatches` with exactly 8 `.swatch` buttons; non-you occupied seats and empty seats have none; team mode builds none.
- [ ] The swatch whose hue == the player's own effective hue is `.is-selected` + `disabled`; every other player's effective hue is `.is-taken` + `disabled`; the rest are enabled.
- [ ] Clicking an enabled swatch emits `selectColor` with `{ lobbyId: gameState.id, hue }` (mirrors the `.seat-kick` payload discipline); disabled swatches emit nothing.
- [ ] An occupied seat with a valid `colorHue` carries `.has-picked`; its `--avatar-hue` equals the picked hue (indigo override lifted for the local player).
- [ ] `02-hero-lobby.css` diff vs `ed6f041` = exactly the one scoped `.seat.is-you:not(.has-picked)` selector edit + the EOF PHASE 7.5.3 append; no other ≤ pre-7.5.3 hunk; `.seat.is-you .seat-svg-wrap` verbatim.
- [ ] `red-carpet.js` + all `server/**` (except Task-0 files) + the team path byte-identical; full `npx jest` green.

**Verify:** `cd C:/mm-phase7-5-3 && npx jest` → full green; plus the `git diff` review below. Visual/responsive/reduced-motion + a real two-client claim/disable/reject eyeball is flagged user-side (jsdom never lays out or runs a socket).

**Steps:**

- [ ] **Step 1: Write the failing render tests**

Append to `client-tests/render-lobby.test.js` inside the existing `describe('renderLobby — theater seats + kick wiring', …)` (after the last test, before the closing `});` at L91):

```js
  test('local player’s own seat shows an 8-swatch strip; others/empty/none', () => {
    renderLobby(makeWaitingState(), 'host_id'); // host = players[0] = me
    const occ = document.querySelectorAll('#lobby-players li.seat.occupied');
    const myStrip = occ[0].querySelector('.seat-swatches');
    expect(myStrip).not.toBeNull();
    expect(myStrip.querySelectorAll('.swatch').length).toBe(8);
    expect(occ[1].querySelector('.seat-swatches')).toBeNull();           // guest
    expect(document.querySelector('#lobby-players li.seat:not(.occupied) .seat-swatches')).toBeNull();
  });

  test('own effective hue swatch is .is-selected+disabled; another player’s is .is-taken+disabled', () => {
    renderLobby(makeWaitingState(), 'host_id');
    const strip = document.querySelector('#lobby-players li.seat.occupied .seat-swatches');
    const sel = strip.querySelectorAll('.swatch.is-selected');
    expect(sel.length).toBe(1);
    expect(sel[0].disabled).toBe(true);
    const taken = strip.querySelectorAll('.swatch.is-taken');
    expect(taken.length).toBe(1);                  // guest's slot fallback
    expect(taken[0].disabled).toBe(true);
    expect(strip.querySelectorAll('.swatch:not([disabled])').length).toBe(6);
  });

  test('clicking a FREE swatch emits selectColor {lobbyId:gameState.id, hue}', () => {
    const { SEAT_HUES } = require('../public/js/ui/red-carpet.js');
    renderLobby(makeWaitingState(), 'host_id');
    const free = document.querySelector('#lobby-players li.seat.occupied .seat-swatches .swatch:not([disabled])');
    free.click();
    const [evt, payload] = mockEmit.mock.calls[mockEmit.mock.calls.length - 1];
    expect(evt).toBe('selectColor');
    expect(payload.lobbyId).toBe('TEST01');
    expect(SEAT_HUES).toContain(payload.hue);
  });

  test('a picked colorHue → .has-picked + --avatar-hue is the picked hue', () => {
    const { SEAT_HUES } = require('../public/js/ui/red-carpet.js');
    const st = makeWaitingState({ players: [
      makePlayer({ id: 'host_id', name: 'Host', isHost: true, colorHue: SEAT_HUES[5] }),
      makePlayer({ id: 'guest_id', name: 'Guest' }),
    ]});
    renderLobby(st, 'host_id');
    const me = document.querySelector('#lobby-players li.seat.occupied');
    expect(me.classList.contains('has-picked')).toBe(true);
    expect(me.style.getPropertyValue('--avatar-hue')).toBe(String(SEAT_HUES[5]));
    expect(me.querySelector('.swatch.is-selected').style.getPropertyValue('--avatar-hue'))
      .toBe(String(SEAT_HUES[5]));
  });
```

Append to `client-tests/red-carpet-render.test.js` inside its `describe` (after the team-mode test, before the closing `});` at L88):

```js
  test('swatch strip only on the local player’s own seat; never in team mode', () => {
    renderLobby(makeWaitingState({ id: 'RC8' }), 'host_id');
    const occ = document.querySelectorAll('#lobby-players li.seat.occupied');
    expect(occ[0].querySelector('.seat-swatches')).not.toBeNull();
    expect(occ[1].querySelector('.seat-swatches')).toBeNull();
    renderLobby(makeWaitingState({ gameMode: 'team', id: 'RC9' }), 'host_id');
    expect(document.querySelectorAll('.seat-swatches').length).toBe(0);
  });
```

Append to `client-tests/red-carpet-seat-table.test.js` inside its `describe` (after the team-mode test, before the closing `});` at L61):

```js
  test('a picked hue stays distinct end-to-end (claim overrides the slot hue)', () => {
    const players = eightPlayers();
    players[7] = makePlayer({ id: 'p7', name: 'Bot Scott', isBot: true, colorHue: SEAT_HUES[0] === SEAT_HUES[7] ? SEAT_HUES[1] : SEAT_HUES[0] });
    // p7 claimed seat-0's hue; p0 (host, un-picked) keeps SEAT_HUES[0].
    // The picked seat must render the CLAIMED hue, not its slot-7 hue.
    renderLobby(makeWaitingState({ id: 'STP', players }), 'p0');
    const seats = [...document.querySelectorAll('#lobby-players li.seat.occupied')];
    expect(seats[7].style.getPropertyValue('--avatar-hue')).toBe(String(SEAT_HUES[0]));
    expect(seats[7].classList.contains('has-picked')).toBe(true);
  });
```

- [ ] **Step 2: Run — verify FAIL for the right reason**

Run: `cd C:/mm-phase7-5-3 && npx jest client-tests/render-lobby.test.js client-tests/red-carpet-render.test.js client-tests/red-carpet-seat-table.test.js`
Expected: the new swatch/`.has-picked`/`selectColor` cases FAIL (`.seat-swatches` is `null`, `.has-picked` absent); all pre-existing cases in these suites still PASS (the swatch builder isn't there yet; `card.hasPickedColor` from Task 1 exists but unused).

- [ ] **Step 3: Implement — `public/js/ui/ui-render.js`**

(3a) Extend the red-carpet import at L33 (currently `import { diffArrivals, playerCardModel, rollCameraLabel } from './red-carpet.js';`) to:

```js
// SEAT_HUES added Phase 7.5.3: renderLobby mirrors the claim-only mutex
// client-side (compute every OTHER player's effective hue) so taken
// swatches render disabled — the server is still the arbiter.
import { diffArrivals, playerCardModel, rollCameraLabel, SEAT_HUES } from './red-carpet.js';
```

(3b) The occupied-seat `li.className` (L216-220) currently ends:

```js
      + (isEntering ? ' entering' : '');
```

Append the `has-picked` class (WHY comment above the block-final line):

```js
      + (isEntering ? ' entering' : '')
      // Phase 7.5.3: .has-picked lifts the .seat.is-you fixed-indigo
      // override (CSS scoped to :not(.has-picked)) so the local picker
      // SEES their own claimed hue; un-picked "you" stays 7.5.2-indigo.
      + (card.hasPickedColor ? ' has-picked' : '');
```

(3c) Insert the swatch builder immediately AFTER `li.appendChild(person);` (L260) and BEFORE the `const wrap = document.createElement('div'); wrap.className = 'seat-svg-wrap';` line (L262):

```js
    // Phase 7.5.3 (Pick-Your-Own-Colour): the local player's OWN occupied
    // seat gets a swatch strip to claim a free palette hue. Claim-only:
    // a hue that is another player's EFFECTIVE hue (their explicit
    // colorHue, else SEAT_HUES[their slot]) renders disabled; the player's
    // own current effective hue is .is-selected (not re-claimable). A free
    // click emits the server-authoritative selectColor — NO optimistic
    // local mutation; the next stateUpdate is the source of truth (mirrors
    // the .seat-kick emit discipline). Built with createElement (no
    // innerHTML for anything dynamic — file convention).
    if (card.isYou) {
      const takenByOthers = new Set();
      gameState.players.forEach((op, oi) => {
        if (oi === slot) return; // never blocked by my own current hue
        const eff = (Number.isInteger(op.colorHue) && SEAT_HUES.includes(op.colorHue))
          ? op.colorHue
          : SEAT_HUES[((oi % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length];
        takenByOthers.add(eff);
      });
      const myEff = card.accentHue; // already prefer-colorHue-else-slot
      const strip = document.createElement('div');
      strip.className = 'seat-swatches';
      strip.setAttribute('role', 'group');
      strip.setAttribute('aria-label', 'Pick your seat colour');
      SEAT_HUES.forEach(hue => {
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'swatch';
        // Dot colour is the same hsl(var(--avatar-hue),…) derived family
        // as the chairs — no new colour values (spec §3.5).
        sw.style.setProperty('--avatar-hue', String(hue));
        sw.setAttribute('aria-label', 'Seat colour ' + hue);
        if (hue === myEff) {
          sw.classList.add('is-selected');
          sw.disabled = true;            // already mine — not re-claimable
          sw.setAttribute('aria-pressed', 'true');
        } else if (takenByOthers.has(hue)) {
          sw.classList.add('is-taken');
          sw.disabled = true;            // claim-only: another player holds it
        } else {
          sw.addEventListener('click', () => {
            getSocket().emit('selectColor', { lobbyId: gameState.id, hue });
          });
        }
        strip.appendChild(sw);
      });
      li.appendChild(strip);
    }
```

- [ ] **Step 4: Implement — `public/css/02-hero-lobby.css`**

(4a) The ONLY existing-line edit — L1145 currently `.seat.is-you {` becomes (the WHY comment block at L1142-1144 stays; only the selector line changes):

```css
/* .is-you: a fixed indigo for the local player's seat WHEN they have not
   explicitly picked a colour. Phase 7.5.3 scopes this to :not(.has-picked)
   so a player who claims a hue SEES their own choice (the .seat.occupied
   --avatar-hue-derived velvet then applies); an un-picked "you" is
   byte-identical to 7.5.2. The .seat-svg-wrap glow below is the
   you-identity halo (NOT chair colour) and is deliberately left verbatim. */
.seat.is-you:not(.has-picked) {
```

(`.seat.is-you .seat-svg-wrap { … }` at L1158-1160 is **NOT touched**.)

(4b) Append at EOF (after L1621), an append-only section:

```css

/* ╔══════════════════════════════════════════════════════════╗
   ║  PHASE 7.5.3 — PICK-YOUR-OWN-COLOUR SWATCH STRIP          ║
   ║  Appended (7.5/7.5.1/7.5.2 EOF-append convention). No     ║
   ║  pre-7.5.3 rule edited except scoping ONE .seat.is-you    ║
   ║  selector to :not(.has-picked). NO new colour values —    ║
   ║  swatch dots reuse the hsl(var(--avatar-hue),…) family.   ║
   ║  Reduced-motion: the EXISTING global 06-states-anim.css   ║
   ║  block neutralises transitions — NO per-rule @media here. ║
   ╚══════════════════════════════════════════════════════════╝ */
.seat-swatches {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  z-index: 6;
  padding: 4px 6px;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 999px;
}
.seat-swatches .swatch {
  appearance: none;
  cursor: pointer;
  width: 16px;
  height: 16px;
  padding: 0;
  border-radius: 50%;
  /* dot fill derived from the per-swatch --avatar-hue — same family as the
     chair velvet, NOT a new brand colour. */
  background: hsl(var(--avatar-hue, 240), 60%, 55%);
  border: 2px solid rgba(255,255,255,0.22);
  transition: transform .15s, box-shadow .15s, opacity .15s;
}
.seat-swatches .swatch:hover:not([disabled]) {
  transform: scale(1.18);
}
.seat-swatches .swatch:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
.seat-swatches .swatch.is-selected {
  box-shadow: 0 0 0 2px var(--bg-base), 0 0 0 4px hsl(var(--avatar-hue, 240), 70%, 60%);
  cursor: default;
}
.seat-swatches .swatch.is-taken,
.seat-swatches .swatch[disabled] {
  opacity: 0.32;
  cursor: not-allowed;
}
.seat-swatches .swatch.is-selected {
  opacity: 1;            /* selected is disabled-but-not-dimmed (it's mine) */
}
```

- [ ] **Step 5: Run — verify GREEN (targeted, then full)**

Run: `cd C:/mm-phase7-5-3 && npx jest client-tests/render-lobby.test.js client-tests/red-carpet-render.test.js client-tests/red-carpet-seat-table.test.js`
Expected: PASS — all new swatch/`.has-picked`/`selectColor` cases + every pre-existing case in these suites green.

Then full: `cd C:/mm-phase7-5-3 && npx jest` → all suites green.

- [ ] **Step 6: Verify the CSS-confinement + byte-identical ratchet**

Run:
```
git -C C:/mm-phase7-5-3 diff ed6f041 -- public/css/02-hero-lobby.css
git -C C:/mm-phase7-5-3 diff --stat ed6f041 -- public/js/ui/red-carpet.js server/gameLogic.js
```
Expected: the CSS diff shows EXACTLY (a) the one selector line `.seat.is-you {` → `.seat.is-you:not(.has-picked) {` plus its expanded WHY-comment block, and (b) the contiguous EOF PHASE 7.5.3 append — NO other hunk at any line ≤ 1621 except that one selector/comment edit; `red-carpet.js` and `server/gameLogic.js` diff EMPTY (Task-1/Task-0 already covered; nothing re-touched here).

- [ ] **Step 7: Commit (branch-verified)**

```bash
git -C C:/mm-phase7-5-3 branch --show-current   # MUST be phase7-5-3-pick-your-color
git -C C:/mm-phase7-5-3 add public/js/ui/ui-render.js public/css/02-hero-lobby.css client-tests/render-lobby.test.js client-tests/red-carpet-render.test.js client-tests/red-carpet-seat-table.test.js
git -C C:/mm-phase7-5-3 commit -m "Phase 7.5.3 Task 2: seat swatch strip + .is-you:not(.has-picked) reconciliation"
```

```json:metadata
{"files": ["public/js/ui/ui-render.js", "public/css/02-hero-lobby.css", "client-tests/render-lobby.test.js", "client-tests/red-carpet-render.test.js", "client-tests/red-carpet-seat-table.test.js"], "verifyCommand": "cd C:/mm-phase7-5-3 && npx jest", "acceptanceCriteria": ["local player's OWN occupied seat = one .seat-swatches with 8 .swatch; non-you/empty/team = none", "own effective-hue swatch .is-selected+disabled; every other player's effective hue .is-taken+disabled; rest enabled", "free-swatch click emits selectColor {lobbyId:gameState.id,hue}; disabled emit nothing", "valid colorHue → li.has-picked + --avatar-hue == picked hue (indigo override lifted)", "02-hero-lobby.css diff = one scoped .is-you:not(.has-picked) selector + EOF PHASE 7.5.3 append only; .seat-svg-wrap verbatim; red-carpet.js/server-except-Task0/team path byte-identical; full npx jest green"]}
```

---

## Self-Review (run before finalizing — checklist, not a subagent)

**1. Spec coverage:**
- §1.1 claim-only → Task 0 `selectColor` `taken` check + Task 2 disabled swatches ✓
- §1.2 lazy fallback → Task 1 prefer/fallback; un-picked byte-identical asserted T1 Step 5 ✓
- §1.3 server palette mirror → Task 0 `constants.SEAT_HUES` + both-sides literal pin (T0 + T1) ✓
- §1.4 `.is-you:not(.has-picked)` + glow verbatim → Task 2 Step 4a ✓
- §1.5 waiting-only / team-out → `selectColor` `status!=='waiting'`; swatch under `card.isYou` only, team early-return untouched (T2 red-carpet-render team test) ✓
- §3.1 effectiveHue formula identical in T0 server `taken`, T2 client `takenByOthers` ✓; accepted post-leave re-settle → NOT re-balanced (no roster-change code anywhere) ✓
- §4/§5 ratchet → explicit `git diff` gates in T0 S7, T1 S5, T2 S6 ✓
- §8 G1–G8 → G1 gameLogic.colorhue test; G2 selectColor decline cases; G3 T1 byte-identical; G4 team tests; G5 T2 S6 diff; G6 both-sides literal pin; G7 socketHandlers one-block + shared bucket; G8 full npx jest green ✓
- §10 acceptance → mapped across the three tasks' Acceptance Criteria ✓

**2. Placeholder scan:** every code step contains complete code; no TBD/TODO/"similar to"; exact paths + line anchors + exact commands & expected output. ✓

**3. Type consistency:** `colorHue` (number|absent), `hasPickedColor` (bool), `selectColor`/`{lobbyId,hue}`, `.seat-swatches`/`.swatch`/`.is-selected`/`.is-taken`/`.has-picked`, `SEAT_HUES` — names identical in Tasks 0/1/2 and matching the spec. The effectiveHue double-modulo wrap is byte-identical in server `selectColor`, client `playerCardModel` (`slotHue`), and `renderLobby` (`takenByOthers`). ✓

No gaps found.

## Pipeline (post-plan)

subagent-driven-development (per-task two-stage review: spec-compliance THEN code-quality, real fix-loops; `.tasks.json` status synced + committed per task) → final opus whole-branch holistic → finishing-a-development-branch Option 2 (feature-branch push + `gh pr create --base main`, hand the PR to the user; PR-merge/Render-deploy classifier-gated). **Owed post-merge reconcile** (mirror 7.1–7.5.2): ff local main → merge commit; `C:\mm-phase7-5-3\node_modules` junction unlink link-only via PowerShell .NET `(Get-Item …).Delete()`; verify shared `C:\moviematch-git\node_modules` 359; `git worktree remove` + prune; `git branch -d phase7-5-3-pick-your-color`; flip memory. Every commit branch-verified; out-of-scope findings → `spawn_task`, never widen 7.5.3.
