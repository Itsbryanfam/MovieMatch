# Theater Lobby — Implementation Plan (Phase 7.5.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the merged 7.5/7.5.1 `#waiting-room` lobby with the Claude-Design "Theater Lobby" (cinema screen + 8 SVG velvet-chair seats incl. empty + nameplate/person/spotlight entrance + "Set the scene" Director ledger), pixel-matching the handoff, strictly client-only.

**Architecture:** The 7.5.1 pure seam is reused **unchanged** — `playerCardModel(player,{myPlayerId,slot})` already returns `{name,isHost,isYou,isBot,label,accentEmoji,accentHue}` and `accentHue === SEAT_HUES[slot]` (collision-free), and `diffArrivals` + the existing `_seenPlayerIds`/`_lastLobbyId` page-session machinery is the entrance-tracking. So `red-carpet.js` gets ZERO production change (and `red-carpet.test.js` stays byte-identical & green). The redesign is concentrated in: `index.html` `#waiting-room` markup, the `renderLobby` seat-DOM builder, the 3 rewritten lobby test suites, and a delete-dead-then-append swap in `02-hero-lobby.css`.

**Tech Stack:** Vanilla ES-module client (no build), Jest 30 + jest-environment-jsdom, plain CSS partials (load order load-bearing). Worktree `C:\mm-phase7-5-2`, branch `phase7-5-2-theater-lobby`, off `origin/main 59e9f7f` (node_modules junctioned).

**Binding spec:** `docs/superpowers/specs/2026-05-19-theater-lobby-design.md` (`61d66a8`). §4 behavioural-equivalence + §8 guardrails + §10 acceptance are the bar.

**Authoritative design source (travels with every implementer dispatch — implementers do NOT read this plan file; they get the task text + these handoff paths):**
- `C:\Users\corte\Downloads\MovieMatch\design_handoff_lobby\README.md` — target `#waiting-room` markup, per-seat seat DOM (occupied/empty), the **verbatim ~5KB chair SVG**, the per-seat CSS-variable velvet block, the 3 entrance `@keyframes` + hookup, responsive table, the `.dir-refined` Director notes.
- `C:\Users\corte\Downloads\MovieMatch\design_handoff_lobby\Lobby Redesign.html` — the React+Babel prototype; its `<style>` block is the **verbatim CSS source** for the Theater section (lift the `lobby panel` / `header row` / `main grid` / `THEATER` / `.dir-refined` rules). **Reference-only, never ported.** `tweaks-panel.jsx` + the React/Babel scaffolding are never shipped.

**Cross-cutting rules (every task):**
- Verify `git -C C:/mm-phase7-5-2 branch --show-current` == `phase7-5-2-theater-lobby` **before every commit** (a parallel Codex agent shares the repo).
- Every code change ships a WHY comment.
- **Client-only:** NO server/socket-event/scoring/validation/theme-mechanic/gameLogic/persistence change. `red-carpet.js` UNCHANGED. `socketHandlers.js` / all `server/**` UNCHANGED.
- §4 **behavioural-equivalence** (binding): the kick emit payload (`removeBot`/`kickPlayer` `{lobbyId:gameState.id,targetId:p.id}`, condition `amIHost && p.id!==myPlayerId`), host detection, `#theme-select`/`#hardcore-toggle`/`#tv-shows-toggle` wiring, `#mode-selector`+`#mode-chip-*` ids, `#start-btn` `rollCameraLabel` gating, and the `lobbyCodeDisplay.innerText` write are behaviourally byte-identical and re-pinned by the rewritten tests. The `renderLobby` team-mode early-return and `renderTeamScreen` are byte-identical UNTOUCHED (team mode builds zero theater DOM).
- **Zero-regression (redefined per spec §5):** this is NOT "additive over a baseline" — the 3 lobby DOM suites are legitimately rewritten. The ratchet applies to the UNEDITED suites: `client-tests/red-carpet.test.js` (pure seam unchanged) + `socket-handlers`/`showScreen`/`modal-factory`/`name-prompts` + all `server/**` MUST stay BYTE-IDENTICAL & green. Full `cd C:/mm-phase7-5-2 && npx jest` ends green.
- Out-of-scope findings → `spawn_task` chip, never widen 7.5.2.
- Tasks are linear: **Task 0 → Task 1 (blockedBy 0) → Task 2 (blockedBy 1)**. (Task 1's test rewrites use `loadIndexHtml()` which reads the Task-0 markup; Task 2 CSS is last.)

---

### Task 0: `index.html` `#waiting-room` restructure + JetBrains Mono

**Goal:** Replace the `#waiting-room` inner markup with the handoff theater skeleton (all existing ids preserved) and add JetBrains Mono to the existing Google-Fonts link.

**Files:**
- Modify: `public/index.html` (line 65 font link; lines 243–344 = inner of `#waiting-room`)

**Acceptance Criteria:**
- [ ] Line 65 font `<link>` requests `&family=JetBrains+Mono:wght@500;600;700` appended before `&display=swap`; `Plus+Jakarta+Sans` request unchanged; still one `<link>`.
- [ ] `#waiting-room` (the `<div id="waiting-room" class="panel hidden lobby-panel">` at line 242, closing `</div>` at the matching end) inner markup = the handoff README "DOM Structure" target verbatim: `.lobby-head` (room code top-left in `<h2>Room: <span id="lobby-code-display" class="accent-text code">`, sub-`<p>`, the Public-Room `<label class="setting-toggle public-toggle">` keeping `#public-room-toggle`), `.lobby-body` → `.theater` (`.stage`>`.screen`(eyebrow/headline/sub)+`.light-cone`, `.seats-wrap`>`<ul id="lobby-players" class="seats-grid" data-layout="two-rows">`(empty — JS fills)+`.theater-floor`, `.theater-status#theater-status`>`<b id="seated-count">0</b> of 8 seated`+`<span id="seated-hint">`) + `.director-shell.dir-refined` (`.ref-header`, the EXISTING `#mode-selector`+4 `#mode-chip-*`+`#mode-description` verbatim, the "House Rules" `.ledger#lobby-settings` where each `.ledger-row` is a `<label>` wrapping the REAL `#theme-select`/`#hardcore-toggle`/`#tv-shows-toggle` (the two checkboxes visually-hidden via a `.ledger-checkbox` class + `.toggle-pill` span), `#start-btn` keeping `class="btn btn-primary"` + `ref-cta`).
- [ ] EVERY pre-existing id present exactly once: `lobby-code-display`, `public-room-toggle`, `mode-selector`, `mode-chip-classic`, `mode-chip-team`, `mode-chip-solo`, `mode-chip-speed`, `mode-description`, `theme-select`, `hardcore-toggle`, `tv-shows-toggle`, `start-btn`, `lobby-players`, `lobby-settings`. NEW ids `theater-status`, `seated-count`, `seated-hint` present and not duplicated elsewhere in the file.
- [ ] `#team-screen` (the `<div id="team-screen" …>` immediately after `#waiting-room`) and everything outside `#waiting-room` byte-identical.
- [ ] `npx jest` — the UNEDITED non-lobby suites stay green; the lobby DOM suites will FAIL here (they still assert `.entrance-card` — Task 1 rewrites them; this is expected at Task 0).

**Verify:** `cd C:/mm-phase7-5-2 && node -e "const h=require('fs').readFileSync('public/index.html','utf8'); ['lobby-code-display','public-room-toggle','mode-selector','mode-chip-classic','mode-chip-team','mode-chip-solo','mode-chip-speed','mode-description','theme-select','hardcore-toggle','tv-shows-toggle','start-btn','lobby-players','lobby-settings','theater-status','seated-count','seated-hint','team-screen'].forEach(id=>{const n=(h.match(new RegExp('id=\"'+id+'\"','g'))||[]).length; if(n!==1) throw new Error(id+' count='+n);}); if(!h.includes('JetBrains+Mono')) throw new Error('no JetBrains Mono'); console.log('IDS_OK');"` → prints `IDS_OK`. Then `cd C:/mm-phase7-5-2 && npx jest client-tests/red-carpet.test.js server` → green (UNEDITED suites unaffected by markup).

**Steps:**

- [ ] **Step 1: Add JetBrains Mono to the font link.** In `public/index.html` replace exactly:

```html
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

with:

```html
  <!-- Phase 7.5.2 (Theater Lobby): JetBrains Mono added for the theater's
       mono section labels / seat numbers / step indicators. Appended to the
       EXISTING Plus Jakarta Sans request — same single <link> tag. -->
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Replace the `#waiting-room` inner markup.** Replace the exact block from line 243 `<div class="panel-header">` through line 344 `</div><!-- /.lobby-stage (Phase 7.5.1) -->` (inclusive) — i.e. everything between `<div id="waiting-room" class="panel hidden lobby-panel">` (line 242, KEEP) and its closing `</div>` (line 345, KEEP) — with the handoff README §"DOM Structure (target markup for #waiting-room)" verbatim, with these REQUIRED concrete bindings (no placeholders):

  - The whole block is preceded by a WHY comment: `<!-- Phase 7.5.2 Theater Lobby: full #waiting-room restructure per the Claude-Design handoff. Every pre-existing id preserved (socketClient/ui-render/ui-dom query them by id); the House-Rules ledger rows wrap the REAL hidden #theme-select/#hardcore-toggle/#tv-shows-toggle so existing change-handlers fire unchanged; renderLobby fills the 8 #lobby-players seats; #team-screen untouched. -->`
  - Use the README target markup EXACTLY for `.lobby-head` / `.lobby-body` / `.theater` / `.director-shell.dir-refined`. The `#lobby-settings` ledger: each toggle row is `<label class="ledger-row" data-toggle="hardcore"><div><div class="lr-name">Hardcore</div><div class="lr-desc">No actor reuse anywhere in chain</div></div><span class="toggle-pill"></span><input type="checkbox" id="hardcore-toggle" class="ledger-checkbox" disabled></label>` (and the analogous `tv-shows` row + the Theme `<select id="theme-select" class="theme-select" disabled>` row). The real inputs keep their ids and `disabled` attribute (renderLobby toggles `.disabled` and `.checked` on them by id, unchanged).
  - `#start-btn` is `<button id="start-btn" class="btn btn-primary ref-cta">🎬 Roll Camera</button>` followed by `<div class="add-bot-row" id="add-bot-row"></div>` (renderLobby's add-bot management uses `startBtn.parentNode`/`insertAdjacentElement` — keeping `#start-btn` + an adjacent flow position preserves it; do NOT pre-populate the add-bot-row, renderLobby builds it).
  - The 8 seats are NOT in static markup — `<ul id="lobby-players" class="seats-grid" data-layout="two-rows"></ul>` is empty; renderLobby (Task 1) fills it.
  - The chair SVG is NOT placed in static index.html (it is built per-seat by renderLobby in Task 1 from the `SEAT_CHAIR_SVG` constant). Do NOT add a shared `<svg><defs>` — per spec §3.4 a shared defs breaks the per-seat `var(--avatar-hue)` recolor; each seat gets its own full inline SVG (Task 1).

- [ ] **Step 3: Verify ids + font.** Run the Verify command above → `IDS_OK`; then `cd C:/mm-phase7-5-2 && npx jest client-tests/red-carpet.test.js server` → all green (the pure seam + server suites are unaffected by markup).

- [ ] **Step 4: Branch-verify then commit.**

```bash
cd C:/mm-phase7-5-2 && test "$(git branch --show-current)" = "phase7-5-2-theater-lobby" && git add public/index.html && git commit -m "Phase 7.5.2 (0): #waiting-room theater restructure + JetBrains Mono

Replace the 7.5/7.5.1 lobby markup with the handoff theater skeleton
(.lobby-head / .lobby-body theater + director-shell.dir-refined). Every
pre-existing id preserved; House-Rules ledger wraps the real hidden
theme/hardcore/tv inputs; #lobby-players is the empty seats-grid (renderLobby
fills 8 seats in Task 1); #team-screen untouched. JetBrains Mono appended to
the existing Google-Fonts link. Lobby DOM test suites intentionally red until
Task 1 rewrites them; pure-seam + server suites stay green.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

If the branch-verify fails, STOP and report BLOCKED.

---

### Task 1: `renderLobby` seat-DOM builder + rewritten lobby test suites

**Goal:** Rebuild the `#lobby-players` DOM as 8 theater seats reusing the unchanged 7.5.1 seam; rewrite the 3 lobby DOM suites to the `.seat` contract + the §4 behavioural pins; keep `red-carpet.test.js` + server suites byte-identical & green.

**Files:**
- Modify: `public/js/ui/ui-render.js` (replace ONLY lines 97–168 — the player-`forEach` that builds `.entrance-card`; everything before 97 and from 169 onward byte-identical)
- Modify (rewrite): `client-tests/render-lobby.test.js`, `client-tests/red-carpet-render.test.js`, `client-tests/red-carpet-seat-table.test.js`
- UNCHANGED (must stay byte-identical & green): `client-tests/red-carpet.test.js`, `public/js/ui/red-carpet.js`, `client-tests/fixtures.js`

**Acceptance Criteria:**
- [ ] `renderLobby` renders exactly 8 `<li class="seat">` into `#lobby-players`: first `players.length` `occupied` (with `is-you`/`is-host`/`is-bot`/`entering` modifier classes as applicable, `style="--avatar-hue:<card.accentHue>"`, `data-player-id`), the rest `empty` (`data-slot`, `.seat-num` "SEAT 0X"). Occupied = README seat DOM (`.nameplate` w/ `.crown` if host + name `card.label` + `.you-pill` if isYou XOR `.bot-pill` if isBot; `.seat-person>.avatar-emoji`=`card.accentEmoji`; `.seat-svg-wrap`>`.seat-spotlight`+verbatim chair `<svg>`+`.seat-kick` button OMITTED on own seat). Empty = `.seat-num`+`.seat-svg-wrap`(`.seat-spotlight`+chair `<svg>`).
- [ ] `--avatar-hue` = `card.accentHue` (= `SEAT_HUES[slot]`): 8 seats → 8 distinct values; host (players[0]) = `SEAT_HUES[0]`; never per-identity hash; no `stableId` anywhere in `#waiting-room`.
- [ ] `.seat-kick` click emits BYTE-IDENTICAL: bots `removeBot`, humans `kickPlayer`, payload `{lobbyId:gameState.id,targetId:p.id}`, condition `amIHost && p.id!==myPlayerId`, omitted on own seat.
- [ ] `.entering` set only for ids in the `diffArrivals` `entering` set (idempotent re-render → none); a `setTimeout(...,1400)` keyed by player id removes `.entering`.
- [ ] `#seated-count`.textContent = `players.length`; `#seated-hint`.textContent = `Waiting for more cast…` if `players.length<2` else `Ready when the Director rolls camera.`
- [ ] Lines 1–96 and 169–end of `ui-render.js` byte-identical (team early-return, `lobbyCodeDisplay.innerText`, `_seenPlayerIds`/`_lastLobbyId`, `diffArrivals`, theme/hardcore/tv, `rollCameraLabel`/`#start-btn`, add-bot row, `renderTeamScreen` all UNTOUCHED).
- [ ] The 3 rewritten suites green; `red-carpet.test.js` + socket-handlers/showScreen/modal-factory/name-prompts + `server/**` BYTE-IDENTICAL & green; full `npx jest` green.

**Verify:** `cd C:/mm-phase7-5-2 && npx jest client-tests/render-lobby.test.js client-tests/red-carpet-render.test.js client-tests/red-carpet-seat-table.test.js client-tests/red-carpet.test.js` → all green; then `cd C:/mm-phase7-5-2 && npx jest` → all green; then `git -C C:/mm-phase7-5-2 diff --stat HEAD -- client-tests/red-carpet.test.js client-tests/fixtures.js public/js/ui/red-carpet.js` → EMPTY (those byte-identical).

**Steps:**

- [ ] **Step 1: Rewrite the 3 lobby test suites to the `.seat` contract (failing first).** Replace each file's contents:

`client-tests/render-lobby.test.js` — keep the docblock/mock/imports; rewrite the describe body so it asserts the theater contract + the §4 kick behaviour:

```js
/**
 * @jest-environment jsdom
 */
// Phase 7.5.2 — renderLobby theater seats. The kick control is the host's
// only way to remove a stuck player; mis-rendering it would lock players out
// or expose it to non-hosts. Pins the §4 behavioural-equivalence kick
// contract on the NEW .seat-kick element (was .btn-kick pre-7.5.2).
const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
const mockEmit = jest.fn();
jest.mock('../public/js/state.js', () => ({
  getSocket: () => ({ emit: mockEmit }),
  getCurrentLobbyId: () => 'TEST01',
}));
import { initUIElements, renderLobby } from '../public/js/ui.js';

describe('renderLobby — theater seats + kick wiring', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('always renders exactly 8 seats; first N occupied carry name + host crown', () => {
    renderLobby(makeWaitingState(), 'host_id'); // 2 players
    const seats = document.querySelectorAll('#lobby-players li.seat');
    expect(seats.length).toBe(8);
    const occ = document.querySelectorAll('#lobby-players li.seat.occupied');
    expect(occ.length).toBe(2);
    expect(occ[0].textContent).toContain('Host');
    expect(occ[0].textContent).toContain('♛');
    expect(occ[1].textContent).toContain('Guest');
    expect(document.querySelectorAll('#lobby-players li.seat:not(.occupied)').length).toBe(6);
  });

  test('host sees one .seat-kick (on the guest, not on self)', () => {
    renderLobby(makeWaitingState(), 'host_id');
    expect(document.querySelectorAll('#lobby-players .seat-kick').length).toBe(1);
    const occ = document.querySelectorAll('#lobby-players li.seat.occupied');
    expect(occ[0].querySelector('.seat-kick')).toBeNull();   // host's own seat
    expect(occ[1].querySelector('.seat-kick')).not.toBeNull();
  });

  test('non-host sees zero .seat-kick', () => {
    renderLobby(makeWaitingState(), 'guest_id');
    expect(document.querySelectorAll('#lobby-players .seat-kick').length).toBe(0);
  });

  test('clicking .seat-kick emits kickPlayer with the byte-identical payload', () => {
    renderLobby(makeWaitingState(), 'host_id');
    document.querySelector('#lobby-players .seat-kick').click();
    expect(mockEmit).toHaveBeenCalledWith('kickPlayer', {
      lobbyId: 'TEST01', targetId: 'guest_id',
    });
  });

  test('bot kick emits removeBot with the byte-identical payload', () => {
    const state = makeWaitingState({ players: [
      makePlayer({ id: 'host_id', name: 'Host', isHost: true }),
      makePlayer({ id: 'bot_id', name: 'Bot Bogart', isBot: true }),
    ]});
    renderLobby(state, 'host_id');
    document.querySelector('#lobby-players li.seat.occupied:nth-child(2) .seat-kick').click();
    expect(mockEmit).toHaveBeenCalledWith('removeBot', {
      lobbyId: 'TEST01', targetId: 'bot_id',
    });
  });

  test('#seated-count / #seated-hint reflect roster size', () => {
    renderLobby(makeWaitingState(), 'host_id'); // 2 players
    expect(document.getElementById('seated-count').textContent).toBe('2');
    expect(document.getElementById('seated-hint').textContent)
      .toBe('Ready when the Director rolls camera.');
    renderLobby(makeWaitingState({ players: [ makePlayer({ id: 'host_id', name: 'Host', isHost: true }) ] }), 'host_id');
    expect(document.getElementById('seated-count').textContent).toBe('1');
    expect(document.getElementById('seated-hint').textContent).toBe('Waiting for more cast…');
  });
});
```

`client-tests/red-carpet-render.test.js`:

```js
/**
 * @jest-environment jsdom
 */
// Phase 7.5.2 — Theater seats glue. Proves the entrance fires ONCE per real
// arrival (idempotent re-render replays nothing), host crown / kick / Director
// gating preserved (§4), NO stableId reaches #waiting-room, team path
// untouched. The pure seam (red-carpet.js) is unchanged — only the seat DOM.
const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
const mockEmit = jest.fn();
jest.mock('../public/js/state.js', () => ({
  getSocket: () => ({ emit: mockEmit }),
  getCurrentLobbyId: () => 'TEST01',
}));
import { initUIElements, renderLobby } from '../public/js/ui.js';

describe('renderLobby — theater entrance + preserved behaviour', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('first render: occupied seats .entering with --avatar-hue + emoji', () => {
    renderLobby(makeWaitingState({ id: 'RC1' }), 'host_id');
    const occ = document.querySelectorAll('#lobby-players li.seat.occupied');
    expect(occ.length).toBe(2);
    occ.forEach(s => {
      expect(s.classList.contains('entering')).toBe(true);
      expect(s.style.getPropertyValue('--avatar-hue')).not.toBe('');
      expect(s.querySelector('.avatar-emoji').textContent).not.toBe('');
    });
  });

  test('re-render with the SAME roster → zero .entering (no replay)', () => {
    const state = makeWaitingState({ id: 'RC2' });
    renderLobby(state, 'host_id');
    renderLobby(state, 'host_id');
    expect(document.querySelectorAll('#lobby-players li.seat.entering').length).toBe(0);
  });

  test('only a newly-joined player animates on the next render', () => {
    const s1 = makeWaitingState({ id: 'RC3' });
    renderLobby(s1, 'host_id');
    const s2 = makeWaitingState({ id: 'RC3', players: [...s1.players, makePlayer({ id: 'new_id', name: 'Newcomer' })] });
    renderLobby(s2, 'host_id');
    const entering = [...document.querySelectorAll('#lobby-players li.seat.entering')];
    expect(entering.length).toBe(1);
    expect(entering[0].textContent).toContain('Newcomer');
  });

  test('host crown + kick wiring preserved (§4)', () => {
    renderLobby(makeWaitingState({ id: 'RC4' }), 'host_id');
    const occ = document.querySelectorAll('#lobby-players li.seat.occupied');
    expect(occ[0].textContent).toContain('Host');
    expect(occ[0].textContent).toContain('♛');
    expect(occ[0].querySelector('.seat-kick')).toBeNull();
    const kick = occ[1].querySelector('.seat-kick');
    expect(kick).not.toBeNull();
    kick.click();
    expect(mockEmit).toHaveBeenCalledWith('kickPlayer', { lobbyId: 'RC4', targetId: 'guest_id' });
  });

  test('Director controls + Roll-Camera gating byte-identical (§4)', () => {
    renderLobby(makeWaitingState({ id: 'RC5' }), 'host_id');
    expect(document.getElementById('mode-selector')).not.toBeNull();
    expect(document.querySelector('.director-shell')).not.toBeNull();
    const start = document.getElementById('start-btn');
    expect(start.classList.contains('roll-camera')).toBe(true);
    expect(start.disabled).toBe(false);
    expect(start.textContent).toContain('Roll Camera');
    renderLobby(makeWaitingState({ id: 'RC5' }), 'guest_id');
    expect(document.getElementById('start-btn').disabled).toBe(true);
  });

  test('SECURITY: no stableId substring anywhere in #waiting-room', () => {
    const state = makeWaitingState({ id: 'RC6' });
    state.players.forEach(p => { p.stableId = 'p_LEAK_' + p.id; });
    renderLobby(state, 'host_id');
    expect(document.getElementById('waiting-room').innerHTML).not.toContain('p_LEAK_');
  });

  test('team mode: no seats built (team early-return untouched)', () => {
    renderLobby(makeWaitingState({ gameMode: 'team', id: 'RC7' }), 'host_id');
    expect(document.querySelectorAll('#lobby-players li.seat').length).toBe(0);
    expect(document.querySelectorAll('#team-red-list li, #team-blue-list li').length)
      .toBeGreaterThan(0);
  });
});
```

`client-tests/red-carpet-seat-table.test.js` — retarget the still-meaningful collision/host-seat pins to the theater `--avatar-hue`/`.seat`:

```js
/**
 * @jest-environment jsdom
 */
// Phase 7.5.2 — theater seat colour contract. Proves the 7.5.1 collision fix
// still holds end-to-end in the theater DOM: a full 8-player lobby yields 8
// DISTINCT --avatar-hue values (= SEAT_HUES, fed by the UNCHANGED seam), the
// host is seat 0 = SEAT_HUES[0], and team mode builds no seats.
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

describe('renderLobby — theater seat colour', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('full 8-player lobby → 8 DISTINCT --avatar-hue (collision-free)', () => {
    renderLobby(makeWaitingState({ id: 'ST1', players: eightPlayers() }), 'p0');
    const hues = [...document.querySelectorAll('#lobby-players li.seat.occupied')]
      .map(li => li.style.getPropertyValue('--avatar-hue'));
    expect(hues).toHaveLength(8);
    expect(new Set(hues).size).toBe(8);
  });

  test('host is seat 0 → --avatar-hue == SEAT_HUES[0]', () => {
    renderLobby(makeWaitingState({ id: 'ST2', players: eightPlayers() }), 'p0');
    const first = document.querySelector('#lobby-players li.seat.occupied');
    expect(first.textContent).toContain('Host');
    expect(first.style.getPropertyValue('--avatar-hue')).toBe(String(SEAT_HUES[0]));
  });

  test('exactly 8 <li.seat>; 2-player roster → 2 occupied + 6 empty', () => {
    renderLobby(makeWaitingState({ id: 'ST3' }), 'host_id');
    expect(document.querySelectorAll('#lobby-players li.seat').length).toBe(8);
    expect(document.querySelectorAll('#lobby-players li.seat.occupied').length).toBe(2);
    const empties = document.querySelectorAll('#lobby-players li.seat:not(.occupied)');
    expect(empties.length).toBe(6);
    expect(empties[0].querySelector('.seat-num')).not.toBeNull();
  });

  test('team mode: early-return untouched — no seats built', () => {
    renderLobby(makeWaitingState({ gameMode: 'team', id: 'ST4' }), 'host_id');
    expect(document.querySelectorAll('#lobby-players li.seat').length).toBe(0);
    expect(document.querySelectorAll('#team-red-list li, #team-blue-list li').length)
      .toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the 3 suites — verify they FAIL** (current `renderLobby` still builds `.entrance-card`, no `.seat`/`.avatar-emoji`/`#seated-count`):

Run: `cd C:/mm-phase7-5-2 && npx jest client-tests/render-lobby.test.js client-tests/red-carpet-render.test.js client-tests/red-carpet-seat-table.test.js`
Expected: FAIL (no `li.seat`, no `.seat-kick`, `#seated-count` null, etc.).

- [ ] **Step 3: Rewrite the `renderLobby` seat-builder.** In `public/js/ui/ui-render.js` replace EXACTLY lines 97–168 (the block from `  lobbyPlayersList.innerHTML = '';` through the closing `  });` of the players `forEach` — i.e. the current `.entrance-card` builder) with the following. **Do NOT touch anything before line 97 or from line 169 (`// Phase 7.5 (bounded DS-01): the inline lobbySettings.style.display…`) onward** — `_seenPlayerIds`/`_lastLobbyId`/team-early-return/`lobbyCodeDisplay`/`diffArrivals`/`enteringSet`/theme/hardcore/tv/`rollCameraLabel`/`#start-btn`/add-bot/`renderTeamScreen` stay byte-identical:

```js
  lobbyPlayersList.innerHTML = '';
  // Phase 7.5.2 (Theater Lobby): the lobby is now a theater of 8 velvet
  // chairs. ALWAYS render exactly 8 <li class="seat"> — the first
  // players.length OCCUPIED, the rest EMPTY slots — so the house fills up
  // visibly. Pure-seam REUSED UNCHANGED: playerCardModel gives name/host/you/
  // bot/label/emoji, and card.accentHue IS SEAT_HUES[slot] (the 7.5.1
  // collision-free palette) → fed to --avatar-hue (NEVER a per-identity hash,
  // NEVER stableId). The .seat-kick condition + emit payload are byte-
  // identical to the pre-7.5.2 .btn-kick (§4). Each seat embeds its OWN
  // inline chair SVG incl. its own <defs> — a shared <defs> would break the
  // per-seat var(--avatar-hue) recolor (the gradient stop var() resolves
  // against the gradient element's computed style), so the duplicated ids
  // across 8 SVGs are REQUIRED, not a defect. The SVG string is a constant
  // (no user data) so a single innerHTML on the static wrapper is safe; all
  // player-controlled text (name/emoji) goes through textContent only.
  const SEATS = 8;
  for (let slot = 0; slot < SEATS; slot++) {
    const p = gameState.players[slot];
    const li = document.createElement('li');

    if (!p) {
      // Empty seat slot.
      li.className = 'seat';
      li.dataset.slot = String(slot);
      const num = document.createElement('div');
      num.className = 'seat-num';
      num.textContent = 'SEAT ' + String(slot + 1).padStart(2, '0');
      li.appendChild(num);
      const wrap = document.createElement('div');
      wrap.className = 'seat-svg-wrap';
      const spot = document.createElement('div');
      spot.className = 'seat-spotlight';
      wrap.appendChild(spot);
      wrap.insertAdjacentHTML('beforeend', SEAT_CHAIR_SVG); // constant, no user data
      li.appendChild(wrap);
      lobbyPlayersList.appendChild(li);
      continue;
    }

    const card = playerCardModel(p, { myPlayerId, slot });
    const isEntering = enteringSet.has(p.id);
    li.className = 'seat occupied'
      + (card.isYou ? ' is-you' : '')
      + (card.isHost ? ' is-host' : '')
      + (card.isBot ? ' is-bot' : '')
      + (isEntering ? ' entering' : '');
    li.dataset.playerId = String(p.id);
    // WHY a CSS custom property: --avatar-hue is the per-seat DATA value (the
    // collision-free SEAT_HUES slot hue). The .seat.occupied rule recolors the
    // chair velvet/arm/cushion from it. Room-scoped slot index, NO stableId.
    li.style.setProperty('--avatar-hue', String(card.accentHue));

    const plate = document.createElement('div');
    plate.className = 'nameplate';
    if (card.isHost) {
      const crown = document.createElement('span');
      crown.className = 'crown';
      crown.title = 'Host';
      crown.textContent = '♛';
      plate.appendChild(crown);
    }
    const nameSpan = document.createElement('span');
    nameSpan.textContent = card.label; // EXACT prior label semantics (You)/wins
    plate.appendChild(nameSpan);
    if (card.isYou) {
      const youPill = document.createElement('span');
      youPill.className = 'you-pill';
      youPill.textContent = 'YOU';
      plate.appendChild(youPill);
    } else if (card.isBot) {
      // mutually exclusive with you-pill per the handoff
      const botPill = document.createElement('span');
      botPill.className = 'bot-pill';
      botPill.textContent = 'BOT';
      plate.appendChild(botPill);
    }
    li.appendChild(plate);

    const person = document.createElement('div');
    person.className = 'seat-person';
    const av = document.createElement('div');
    av.className = 'avatar-emoji';
    av.setAttribute('aria-hidden', 'true'); // decorative; name carries identity
    av.textContent = card.accentEmoji;
    person.appendChild(av);
    li.appendChild(person);

    const wrap = document.createElement('div');
    wrap.className = 'seat-svg-wrap';
    const spot = document.createElement('div');
    spot.className = 'seat-spotlight';
    wrap.appendChild(spot);
    wrap.insertAdjacentHTML('beforeend', SEAT_CHAIR_SVG); // constant, no user data

    if (amIHost && p.id !== myPlayerId) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'seat-kick';
      kickBtn.title = 'Kick';
      kickBtn.dataset.kickId = String(p.id);
      kickBtn.textContent = '✕';
      kickBtn.addEventListener('click', () => {
        // §4 byte-identical: bots → removeBot, humans → kickPlayer, same
        // payload + condition as the pre-7.5.2 .btn-kick.
        if (p.isBot) {
          getSocket().emit('removeBot', { lobbyId: gameState.id, targetId: p.id });
        } else {
          getSocket().emit('kickPlayer', { lobbyId: gameState.id, targetId: p.id });
        }
      });
      wrap.appendChild(kickBtn);
    }
    li.appendChild(wrap);

    if (isEntering) {
      // README entrance: add `entering`, strip after 1400ms keyed by id so an
      // idempotent re-render never re-triggers (diffArrivals already only
      // returns truly-new ids in `entering`; this just clears the one-shot
      // class). Reduced-motion is handled by the global 06-states-anim.css
      // block — the seat is fully legible at its end-state regardless.
      const id = p.id;
      setTimeout(() => {
        const el = lobbyPlayersList.querySelector('li.seat[data-player-id="' + id + '"]');
        if (el) el.classList.remove('entering');
      }, 1400);
    }
    lobbyPlayersList.appendChild(li);
  }

  // Theater status line.
  const seatedCount = document.getElementById('seated-count');
  if (seatedCount) seatedCount.textContent = String(gameState.players.length);
  const seatedHint = document.getElementById('seated-hint');
  if (seatedHint) {
    seatedHint.textContent = gameState.players.length < 2
      ? 'Waiting for more cast…'
      : 'Ready when the Director rolls camera.';
  }
```

- [ ] **Step 4: Add the `SEAT_CHAIR_SVG` module constant.** In `public/js/ui/ui-render.js`, immediately after the `let _lastLobbyId = null;` line (currently line 46, before `export function renderLobby`), add the verbatim chair SVG from the handoff README §"Chair SVG (verbatim from prototype)" as a template-literal constant, preceded by a WHY comment:

```js
// Phase 7.5.2 (Theater Lobby): the velvet chair, verbatim from the design
// handoff. Identical markup for every seat — recolored per-seat purely via
// the inherited `--avatar-hue` custom property (see .seat.occupied CSS). It
// MUST carry its OWN <defs>: the gradient <stop stop-color:var(--velvet-*)>
// resolves the custom property against the gradient element's own computed
// style, so a single shared <defs> would render every chair identically.
// Constant string, zero user data — safe to inject via insertAdjacentHTML.
const SEAT_CHAIR_SVG = `<svg class="seat-svg" viewBox="0 0 150 120" aria-hidden="true">… (the exact ~5KB SVG block from design_handoff_lobby/README.md §"Chair SVG", reproduced byte-for-byte, including its <defs> with #seat-backG / #seat-armG / #seat-cushG / #seat-velvetSheen) …</svg>`;
```

(Implementer: copy the SVG **verbatim** from `C:\Users\corte\Downloads\MovieMatch\design_handoff_lobby\README.md` §"Chair SVG" — the full block from `<svg class="seat-svg" viewBox="0 0 150 120" aria-hidden="true">` through `</svg>`. Do not abbreviate, restyle, or de-duplicate the `<defs>`.)

- [ ] **Step 5: Run the 3 rewritten suites + the unedited continuity suites — verify PASS.**

Run: `cd C:/mm-phase7-5-2 && npx jest client-tests/render-lobby.test.js client-tests/red-carpet-render.test.js client-tests/red-carpet-seat-table.test.js client-tests/red-carpet.test.js`
Expected: all green (`red-carpet.test.js` green & UNEDITED — the pure seam never changed). Then `git -C C:/mm-phase7-5-2 diff --stat HEAD -- client-tests/red-carpet.test.js client-tests/fixtures.js public/js/ui/red-carpet.js` → EMPTY.

- [ ] **Step 6: Full suite — green; unedited suites byte-identical.**

Run: `cd C:/mm-phase7-5-2 && npx jest`
Expected: all suites green. socket-handlers/showScreen/modal-factory/name-prompts + `server/**` unchanged & green (`git diff` shows no edits to them).

- [ ] **Step 7: Branch-verify then commit.**

```bash
cd C:/mm-phase7-5-2 && test "$(git branch --show-current)" = "phase7-5-2-theater-lobby" && git add public/js/ui/ui-render.js client-tests/render-lobby.test.js client-tests/red-carpet-render.test.js client-tests/red-carpet-seat-table.test.js && git commit -m "Phase 7.5.2 (1): renderLobby theater seat-builder + rewritten lobby suites

renderLobby now builds exactly 8 <li.seat> (N occupied + rest empty) reusing
the UNCHANGED 7.5.1 seam (playerCardModel; card.accentHue == SEAT_HUES[slot]
→ --avatar-hue, collision-free; diffArrivals + _seenPlayerIds for entering +
a 1400ms id-keyed strip). .seat-kick emits the byte-identical removeBot/
kickPlayer payload (§4); #seated-count/#seated-hint wired; per-seat own-defs
chair SVG. Team early-return + everything <line97 / >=line169 byte-identical.
The 3 lobby DOM suites rewritten to the .seat contract + §4 pins;
red-carpet.test.js / fixtures.js / red-carpet.js UNEDITED & green.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

If the branch-verify fails, STOP and report BLOCKED. If a pre-commit hook fails, fix and create a NEW commit (never --amend, never --no-verify).

---

### Task 2: `02-hero-lobby.css` — delete dead 7.5/7.5.1 lobby CSS + append the Theater section

**Goal:** Remove the now-dead 7.5 Red Carpet + 7.5.1 Seat-Table appended sections and append the verbatim Theater CSS (with the 4 pinned adaptations); no pre-7.5 / non-lobby rule touched.

**Files:**
- Modify: `public/css/02-hero-lobby.css` (delete lines **729–980** inclusive; append the Theater section after the current line 728)

**Acceptance Criteria:**
- [ ] Lines 729–980 (the `/* PHASE 7.5 — RED CARPET LOBBY */` section AND the `/* PHASE 7.5.1 — SEAT-TABLE LAYOUT */` section — `.marquee*`, `.entrance-card*`, `@keyframes cardEntrance`, `.lobby-stage*`, `#waiting-room.lobby-panel` widen, `.director-panel*`, `.theme-select`, `.waiting-public-toggle`, `.roll-camera*`, the seat-table grid) are DELETED.
- [ ] Lines 1–728 (pre-7.5: incl. `.lobby-panel`@~230, `#lobby-players`/`#lobby-players li`@~569-582, `.setting-toggle`@~671, `.bot-badge`@~696, `.bot-thinking`@722-727, `.btn`/`.btn-primary`/`.accent-text`/`.mode-chip`/screen-system rules) byte-identical — NOT edited/reordered. NO non-lobby rule touched.
- [ ] A new `/* PHASE 7.5.2 — THEATER LOBBY (APPEND-ONLY; supersedes the deleted 7.5/7.5.1 lobby sections) */` section appended at EOF, lifted **verbatim** from `design_handoff_lobby/Lobby Redesign.html` `<style>` sections (`/* ─── lobby panel ─── */`, `/* ── header row ── */`, `/* ── main grid ── */`, the `╔ THEATER ╗` block, and the `.dir-refined` block ONLY) + the README per-seat `--avatar-hue` velvet block + the 3 `@keyframes` (`nameplate-drop`/`person-sit`/`spotlight-pulse`) + the 3 `.seat.occupied.entering …` hookup rules + the responsive `@media` blocks (≥1000 / <1000 / <640), with the **4 pinned adaptations**:
  1. **No new color values** — anywhere the prototype uses a literal indigo (`#818cf8`/`rgba(129,140,248,*)`) or amber (`#f59e0b`), keep it ONLY if it already resolves from a token; otherwise map to `var(--accent-primary)`/`var(--accent-warm)`. The chair velvet/arm/cushion stay the README HSL-from-`--avatar-hue` formulas (those are derived, not new brand colors — keep verbatim).
  2. **`--avatar-hue` is JS-set** (Task 1) — the `.seat.occupied{--velvet-light:hsl(var(--avatar-hue,240),…)…}` + `.seat.is-you{…}` blocks are lifted verbatim from the README §"Per-seat CSS variables".
  3. **Reduced-motion via the existing global block** — do NOT include the README's per-rule `@media (prefers-reduced-motion: reduce){…}` guard (the global `06-states-anim.css` block already neutralizes all animation; per-rule would be double-handling). Baseline `.nameplate`/`.seat-person` `opacity:1` (README "Critical" note) IS kept.
  4. **Drop `.dir-console` and `.dir-slate`** entirely (exploration variants — only `.dir-refined` ships).
- [ ] `git -C C:/mm-phase7-5-2 diff public/css/02-hero-lobby.css` shows ONLY: a contiguous deletion at 729–980 and a new appended block — no hunk modifies a line ≤728.
- [ ] Full `cd C:/mm-phase7-5-2 && npx jest` green (CSS-only; no test change). Visual/responsive/reduced-motion fidelity is the user-side eyeball (jsdom never lays out).

**Verify:** `cd C:/mm-phase7-5-2 && npx jest` → all green; `git -C C:/mm-phase7-5-2 diff public/css/02-hero-lobby.css` → deletion confined to 729–980 + an EOF append, zero hunks ≤728; `node -e "const c=require('fs').readFileSync('public/css/02-hero-lobby.css','utf8'); if(c.includes('.entrance-card')||c.includes('.lobby-stage')||c.includes('cardEntrance')||c.includes('.dir-console')||c.includes('.dir-slate')) throw new Error('dead/forbidden rule present'); if(!c.includes('.seat-svg')||!c.includes('nameplate-drop')) throw new Error('theater CSS missing'); console.log('CSS_OK')"` → `CSS_OK`.

**Steps:**

- [ ] **Step 1: Delete the dead 7.5/7.5.1 lobby sections.** In `public/css/02-hero-lobby.css` delete lines **729 through 980 inclusive** (from the `/* =============================================` opening the `PHASE 7.5 — RED CARPET LOBBY` banner, through the final `}` on line 980 that closes the 7.5.1 `@media (min-width: 768px)` block). Line 727 (`}` closing `.bot-thinking`) + line 728 (blank) become the new EOF before the append. Confirm line 728 is the last retained line and nothing ≤728 changed.

- [ ] **Step 2: Append the Theater section.** Append at EOF a section beginning with:

```css

/* =============================================
   PHASE 7.5.2 — THEATER LOBBY (APPEND-ONLY)
   Supersedes the deleted 7.5 Red Carpet + 7.5.1 Seat-Table lobby sections.
   Lifted verbatim from design_handoff_lobby/Lobby Redesign.html <style>
   (lobby panel / header row / main grid / THEATER / .dir-refined ONLY) +
   the README per-seat --avatar-hue velvet block + the 3 entrance @keyframes
   + hookup + responsive @media. Adaptations (binding, spec §3.4):
   no new color values (prototype indigo/amber → var(--accent-primary)/
   var(--accent-warm); chair HSL-from-(--avatar-hue) kept verbatim);
   --avatar-hue is JS-set per seat; reduced-motion via the EXISTING global
   06-states-anim.css block (NO per-rule prefers-reduced-motion here);
   .dir-console/.dir-slate dropped. Pre-7.5 (≤line 728) untouched.
   ============================================= */
```

…followed by the lifted + adapted rules per the §"Acceptance Criteria" item above (lobby panel/header/main grid/THEATER/seats/`.seat`/`.nameplate`/`.seat-person`/`.avatar-emoji`/`.seat-svg-wrap`/`.seat-spotlight`/`.seat-num`/`.seat-kick`/`.crown`/`.you-pill`/`.bot-pill`/`.theater-status`/`.screen`/`.light-cone`/`.stage`; the `.seat`+`.seat.occupied`+`.seat.is-you` `--velvet-*` block verbatim from README; `.dir-refined` Director block; `@keyframes nameplate-drop`/`person-sit`/`spotlight-pulse` + the `.seat.occupied.entering .nameplate|.seat-person|.seat-spotlight` hookup verbatim; the `.public-toggle` rule [the README's restyled Public-Room toggle modifier]; the responsive `@media` blocks ≥1000/<1000/<640 verbatim). Implementer reads the prototype `<style>` + README in the handoff folder for the exact declarations; apply ONLY the 4 adaptations.

- [ ] **Step 3: Verify append-only / no pre-7.5 touched + suite green.**

Run the Verify command. Confirm: `git diff` deletion confined to 729–980 + the EOF append (no hunk ≤728); `CSS_OK`; full `npx jest` green; the `git diff --stat` shows ONLY `public/css/02-hero-lobby.css`.

- [ ] **Step 4: Branch-verify then commit.**

```bash
cd C:/mm-phase7-5-2 && test "$(git branch --show-current)" = "phase7-5-2-theater-lobby" && git add public/css/02-hero-lobby.css && git commit -m "Phase 7.5.2 (2): delete dead 7.5/7.5.1 lobby CSS + append Theater section

Removed the now-dead PHASE 7.5 Red Carpet + PHASE 7.5.1 Seat-Table appended
sections (lines 729-980 — .entrance-card/.lobby-stage/cardEntrance/etc the
new DOM no longer emits); appended the Theater section lifted verbatim from
the handoff prototype <style> + README (per-seat --avatar-hue velvet, the
nameplate-drop/person-sit/spotlight-pulse keyframes, .dir-refined, responsive)
with the 4 pinned adaptations: tokens-only/no new colors, JS-set --avatar-hue,
reduced-motion via the existing global block (no per-rule), .dir-console/
.dir-slate dropped. NO pre-7.5 (≤728) or non-lobby rule edited. Visual/
responsive/reduced-motion fidelity is the user-side eyeball.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

If the branch-verify fails, STOP and report BLOCKED.

**User-side eyeball (non-blocking; jsdom never lays out or boots a browser):** pixel-match the handoff — the cinema screen header (room code top-left), 8 velvet chairs (N occupied + empty `SEAT 0X`), the nameplate-drop / person-sit / spotlight entrance on a newly-seated player, the "Set the scene" Director ledger with toggle-pills, distinct per-seat chair colors with no two alike, `.is-you` indigo chair; responsive ≥1000 (two-col) / <1000 (stacked) / <640 (tight); OS reduced-motion legible; team-mode waiting screen unchanged.

---

## Self-Review

**Spec coverage (spec §10):** (1) markup restructure + ids + ledger hidden-checkbox + new status ids + JetBrains Mono → Task 0. (2) 8-seat builder reusing seam, `--avatar-hue`=accentHue, `.seat-kick` byte-identical, entering/1400ms, seated-count/hint, team untouched → Task 1. (3) 3 suites rewritten + `red-carpet.test.js`/server byte-identical+green → Task 1 Steps 1/5/6. (4) delete 729–980 + append Theater (4 adaptations), no pre-7.5/non-lobby edit → Task 2. (5) collision-free 8 distinct hues + `.is-you` + no stableId → Task 1 (tests) + Task 2 (CSS). (6) user-side eyeball → Task 2 footer. §4 behavioural-equivalence → Task 1 ACs + the rewritten render-lobby/red-carpet-render pins. All covered.

**Placeholder scan:** The only "lift verbatim from the handoff" instructions (the 5KB chair SVG in Task 1 Step 4; the Theater CSS in Task 2 Step 2) cite an exact committed-adjacent source file + section + the 4 precise adaptations + a `CSS_OK`/ids verify — this is an exact, actionable instruction for a design-handoff implementation (the implementer is dispatched WITH the handoff files), not a "TBD". Every codebase-side change (font link, the line-243–344 markup boundary, the line-97–168 renderLobby boundary, the full seat-builder JS, the 3 full rewritten test files, the 729–980 delete range) is concrete and complete. No "TODO/handle-edge-cases/similar-to" patterns.

**Type/identifier consistency:** `SEAT_CHAIR_SVG` (const, Task 1 Step 4) ↔ used in Step 3 builder. `playerCardModel`/`SEAT_HUES`/`diffArrivals`/`enteringSet`/`_seenPlayerIds` names match the unchanged seam + the read source. `.seat`/`.seat.occupied`/`.seat-kick`/`.avatar-emoji`/`.nameplate`/`.crown`/`.you-pill`/`.bot-pill`/`.seat-svg-wrap`/`.seat-spotlight`/`.seat-num`/`#seated-count`/`#seated-hint`/`--avatar-hue`/`.director-shell`/`.dir-refined`/`.ledger`/`.toggle-pill`/`.ref-cta` consistent across Task 0 markup, Task 1 builder + tests, Task 2 CSS. `♛` crown glyph consistent (markup test ↔ builder). Kick payload `{lobbyId:gameState.id,targetId:p.id}` + `'TEST01'`/`'RC4'`/`'guest_id'`/`'bot_id'` consistent between the builder and the rewritten tests. No drift.
