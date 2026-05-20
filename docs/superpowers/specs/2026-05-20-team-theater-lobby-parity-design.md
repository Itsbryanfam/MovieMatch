# Phase 7.8b — Team Theater Lobby Parity (Design Spec)

> Status: APPROVED (design gate passed 2026-05-20). Brings the team-mode lobby
> (`#team-screen`) to visual + structural parity with the classic Theater
> Lobby (`#waiting-room`) shipped in 7.5.2/7.5.3. This spec is the binding
> spec-compliance bar for reviewers (§8 guardrails + §10 acceptance criteria).

## §0 — Context & provenance

During 7.5/7.5.1/7.5.2/7.5.3 the lobby was redesigned three times (Red Carpet
→ Seat-Table → Theater → Pick-Your-Color). The team-mode lobby
(`#team-screen`) was deliberately held byte-identical through every iteration
("`#team-screen` untouched" — explicit in 7.5.2 spec §2 Non-goals, and
recorded in the 7.5.1 spec as "team-screen Seat-Table parity deferred"). The
user has now requested team-mode parity as the next sub-phase of Phase 7.

The current team-screen is plain: a thin `.panel-header` with `<h2>🤝 Team
Battle</h2>`, two `.team-column` divs with `<li class="team-player-chip">`
chips, two `.btn-join-team` buttons, Start Match + Back. No cinema-screen
header, no seat-style chairs, no host crown badge, no entrance animation, no
Director panel — the surface looks abandoned next to the new Theater Lobby.

The classic Theater Lobby (`#waiting-room`) is the established reference: a
`.lobby-head` with the room code, a `.lobby-body` two-column layout
(`.theater` seats grid on the left + `.director-shell` House Rules ledger
on the right), and a shared SEAT_HUES palette driving distinct per-seat hues.
This sub-phase mirrors that structure into the team-screen with team-flavored
adjustments locked in §1.

**`origin/main = 49acf56`** (post-#44, Phase 7.7 polish loop closed). Isolated
worktree, branch off origin/main, node_modules junctioned, branch-verify before
every commit — the Phase-7 sub-phase discipline.

## §1 — The four locked design decisions (binding)

Resolved at the design gate (each via AskUserQuestion):

1. **Single team color per side (no per-seat hue).** Every red-team seat
   uses `--team-red`; every blue-team seat uses `--team-blue`. The classic
   lobby's per-seat SEAT_HUES palette and pick-your-color affordance do
   **NOT** apply in team mode — team identity supersedes per-player color
   identity. Trade-off: the per-player color delight from 7.5.1+7.5.3 is
   intentionally dropped in team mode.
2. **Full Director panel mirror.** The team-screen carries the SAME Director
   shell as the classic lobby — House Rules ledger (theme/hardcore/TV) + Roll
   Camera CTA (here labeled "Start Match"). Host can edit rules without
   clicking Back to the mode-select. Resolves the long-standing wart that
   team-mode hosts had to leave the team-screen to change rules.
3. **3-column wide layout: Red seats | Blue seats | Director.** At ≥1000px
   the two team columns sit side-by-side (rivals in adjacent theaters) with
   the Director shell on the right. Closest visual parity with classic's
   theater-left/director-right shape. Stacks vertically below 1000px (red →
   blue → director).
4. **Shared seat-rendering seam (Approach A).** Extract a pure `seatModel`
   + a single impure `buildSeatNode` DOM builder. `renderLobby` (classic)
   AND `renderTeamScreen` (team) call the same builder. Classic stays
   byte-identical (the existing tests are the regression proof); team mode
   gets the unified seat node with `team` instead of `accentHue`.

## §2 — Goals / Non-goals

**Goals.** Team-screen reads as the same cinema-Lobby aesthetic as the
classic Theater Lobby. A team-mode host can: pick a side, see all rivals on
both teams as seat-style chairs, edit House Rules without leaving the screen,
add a bot (auto-balanced to the smaller team), and start the match when
both teams have ≥1 player. Mobile stacks cleanly. Client-only, vanilla, no
build. Every code change ships a WHY comment.

**Non-goals (out of scope; untouched).** Server-side socket protocol/events
(`assignTeam`, `addBot`, `updateLobbySettings` payloads byte-identical); the
hero screen, in-game board, modals; theme/hardcore/TV-shows **behavior**;
the bot auto-balance **logic** (server-side, unchanged). Deferred & recorded
(§9): QR scan-to-join, Public Room toggle on team-screen, per-team bot
selection UI, per-player color picking inside a team, DS-01 pass 2 dead-CSS
sweep of the now-superseded `.team-columns`/`.team-player-list`/
`.team-player-chip` rules.

## §3 — The contract

### §3.1 Pure seam — `public/js/ui/red-carpet.js` — additive

Add a new pure export `seatModel(player, opts)` that unifies the per-seat
model for both modes. Returns:

```
{
  name, isHost, isYou, isBot, wins,         // existing playerCardModel fields
  label,                                    // existing label format
  accentEmoji,                              // unchanged, name+':'+id hash
  accentHue,                                // ONLY when opts.mode === 'classic'
  team,                                     // ONLY when opts.mode === 'team' ('red'|'blue')
  hasPickedColor                            // ONLY when opts.mode === 'classic'
}
```

Driven by `opts`:
- `opts.mode === 'classic'` → uses `opts.slot` → `SEAT_HUES[slot]` (or the
  picked `colorHue` override), no `team` key.
- `opts.mode === 'team'` → uses `opts.team: 'red'|'blue'`, no `accentHue`,
  no swatches, no pick.

The existing `playerCardModel(player, opts)` is rewritten as a thin wrapper
that calls `seatModel(player, {...opts, mode: 'classic'})`. Byte-identical
output for all real (player, slot) pairs — proved by the `playerCardModel`
unit tests in `red-carpet.test.js` staying green.

**Zero-stableId discipline preserved.** `seatModel` reads no persistent
identifier; passing a player with `stableId` does not change the output
(sentinel-tested, mirrors the existing `red-carpet.test.js` discipline). The
Phase-1 daily-leaderboard leak fix is structurally preserved.

### §3.2 New impure module — `public/js/ui/ui-seat.js` (~80–100 lines)

Single source of truth for seat DOM. Exports `buildSeatNode(model, callbacks)`
producing the `<li>` element. Same DOM shape as today's renderLobby inline
builder (the regression proof). Branches on `model.team`:
- If `model.team` present → `<li class="seat occupied team-<color>" ...>`,
  CSS var `--seat-team-color: var(--team-<color>)` set on the `<li>`, no
  `.seat-swatches` strip, no `--avatar-hue`.
- Else (classic) → `<li class="seat occupied [is-you] [has-picked]" ...>`,
  `--avatar-hue: <model.accentHue>` set on the `<li>`, `.seat-swatches`
  built when `is-you`.

Callbacks: `{ onKick(targetId), onRemoveBot(targetId), onPickHue(hue) }`.
Host-only `.seat-kick` button attached when callback provided AND seat is
not the local viewer. Bot kicks emit `removeBot` (existing payload),
human kicks emit `kickPlayer` (existing payload).

### §3.3 DOM — `public/index.html` — `#team-screen` body rewrite

Replace the body of `#team-screen` (panel ID + `.lobby-panel` preserved for
socketClient compat; preserve `#team-lobby-code`, `#team-red-list`,
`#team-blue-list`, `#join-red-btn`, `#join-blue-btn`, `#team-start-btn`,
`#team-back-btn` so existing handlers don't need rewiring):

- `<div class="lobby-head">` — `<h2>Room: <span id="team-lobby-code"
  class="accent-text code">` + sub-copy "Pick your side — the rivals are
  taking the stage."
- `<div class="lobby-body team-lobby-body">` — 3-column grid:
  - `<section class="theater team-theater team-red">` — `.stage` w/
    `.screen` (eyebrow "Red Team" / headline "🔴 Take the floor"),
    `.seats-wrap` w/ `<ul id="team-red-list" class="seats-grid team-seats"
    data-layout="team">`, `<button id="join-red-btn">◀ Join Red</button>`.
  - `<section class="theater team-theater team-blue">` — same shape for blue.
  - `<aside class="director-shell dir-refined">` — `.ref-header` (eyebrow
    "Director" / title "Set the scene" / step "Team Battle"); `.ledger`
    `#lobby-settings-team` with the three team-suffixed controls
    (`#theme-select-team`, `#hardcore-toggle-team`, `#tv-shows-toggle-team`);
    Roll-Camera CTA `<button id="team-start-btn">🎬 Start Match</button>`;
    `<div class="add-bot-row" id="add-bot-row-team">`; secondary
    `<button id="team-back-btn">← Back to mode</button>`; `<p class="team-hint"
    id="team-hint">`.

All controls preserve their existing socket-emit semantics — see §3.4 for
the change-handler wiring.

### §3.4 Change-handler binding — `public/js/socketClient.js`

The team-suffixed ledger controls duplicate the classic IDs' purpose, so
they need to fire the same `updateLobbySettings` emit. The existing
`addEventListener('change', …)` blocks are extended to register on BOTH
controls. Concrete pattern for each of the three ledger controls:

```js
['theme-select', 'theme-select-team'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', (e) => {
    socket.emit('updateLobbySettings', {
      themeKey: e.target.value, lobbyId: getCurrentLobbyId()
    });
  });
});
```

No new socket event; payload shape and event name unchanged. Server tests
stay green.

### §3.5 Render flow — `public/js/ui/ui-render.js`

**`renderLobby` (classic):** the inline seat-building block is replaced with
a per-slot loop that calls `buildSeatNode(seatModel(player, {mode:'classic',
slot, myPlayerId}), { onKick, onRemoveBot, onPickHue })`. Output is
byte-identical to today's `renderLobby` for every (state, viewer) pair the
existing tests exercise (the regression proof).

**`renderTeamScreen` (team):** full rewrite. Mirrors `renderLobby` shape:
1. Arrival diff (`diffArrivals` reused) gated to the current lobby id
   (`_lastTeamLobbyId` module state, mirrors the classic `_lastLobbyId`).
2. `teamLobbyCode.innerText = gameState.id` (unchanged contract).
3. For each team `t ∈ {0:'red', 1:'blue'}`: filter players by `teamId`, build
   `seatModel(player, {mode:'team', team:teamName, myPlayerId})`, append
   `buildSeatNode(...)` into the team's `<ul>`. No empty placeholder seats —
   the variable-team-size case must not break the existing `red-carpet-seat-
   table.test.js` L55-60 contract ("`#team-red-list li`+`#team-blue-list li` > 0").
4. Join buttons disabled-state, hint text, Start Match visibility — existing
   logic preserved verbatim.
5. Ledger sync: mirror gameState.themeKey/hardcoreMode/allowTvShows onto the
   `-team`-suffixed controls + `.ledger-row.on` class.
6. Add-Bot row: the existing inline Add-Bot DOM in `renderLobby` (the
   `botRow.className = 'add-bot-row'` block + difficulty select +
   `addBot` emit) is extracted into a shared helper `buildAddBotRow(host,
   lobbyId)` in `ui-render.js` (the lightest extraction — no new file).
   `renderLobby` and `renderTeamScreen` both call it; the team-mode
   call passes the team-screen container `#add-bot-row-team`. Existing
   socket emit + payload unchanged.

### §3.6 CSS — `public/css/02-hero-lobby.css` — append-only

New section under a clear `Phase 7.8b — Team Theater Lobby` banner. New
rules:
- `.team-lobby-body { display: grid; grid-template-columns: 1fr 1fr 1.1fr;
  gap: 1rem; }`
- `.team-theater` — slightly tighter padding than the single-team `.theater`.
- `.team-theater.team-red .screen` / `.team-theater.team-blue .screen` —
  tinted cinema-screen overlay using `--team-red` / `--team-blue` family
  tokens.
- `.team-theater .seat.team-red` / `.seat.team-blue` — new
  higher-specificity rules that override (not edit) the existing
  `.seat .seat-svg-wrap` / `.nameplate` / `.seat-spotlight` color
  properties for team seats only. Implemented by setting a new CSS
  variable `--seat-team-color: var(--team-red)` (or `--team-blue`) on the
  `<li>` in `buildSeatNode` when `model.team` is present, and writing
  selectors like `.team-theater .seat.team-red .seat-svg-wrap path[fill] {
  fill: var(--seat-team-color) }` (illustrative — exact CSS properties
  to override are enumerated during T2). Classic seats are unaffected —
  the `.team-red`/`.team-blue` class is absent, so the new rules don't
  match. Append-only-correct.
- Mobile: `@media (max-width: 999px)` stacks the three columns into one
  (red → blue → director). `@media (max-width: 639px)` tightens seat sizes
  the same way the classic lobby's `<640px` rule does.

The pre-existing `.theater`, `.screen`, `.seats-wrap`, `.seats-grid`,
`.seat`, `.nameplate`, `.crown`, `.you-pill`, `.bot-pill`, `.seat-svg-wrap`,
`.seat-spotlight`, `.seat-kick` rules ARE NOT EDITED. They already apply
correctly to the team seats because the team `<ul>`s carry `class="seats-grid"`
and the team seats carry `class="seat occupied team-<color>"`.

No new color values. Reused tokens: `--team-red`, `--team-blue`,
`--team-red-bg`, `--team-blue-bg`, `--team-red-border`, `--team-blue-border`
(all already in `01-base.css`). Cinema-screen accent uses the same
`rgba(129,140,248,…)` accent the classic lobby uses for screen glow.

The today-dead rules (`.team-columns`, `.team-column`, `.team-player-list`,
`.team-player-chip`, `.btn-join-team`, `.team-hint`) are NOT deleted in this
phase — DS-01 pass 2 sweeps them. Append-only discipline preserved.

## §4 — Behavioural equivalence (what stays byte-identical)

1. **Socket protocol.** `assignTeam`, `addBot`, `updateLobbySettings`,
   `kickPlayer`, `removeBot`, `selectColor` — event names + payload shapes
   unchanged. Verified by all server suites staying green (regression proof).
2. **Classic-lobby seat DOM.** `renderLobby` post-refactor produces the same
   `<li class="seat ...">` DOM for every (state, viewer) pair the existing
   `render-lobby.test.js` (11 tests) and `red-carpet-seat-table.test.js`
   (5 tests) exercise. **The existing tests are the binding regression
   proof — no edits.**
3. **`playerCardModel` output.** Rewriting `playerCardModel` as a thin
   wrapper around `seatModel({...opts, mode:'classic'})` is byte-identical
   for every real (player, opts) pair. Verified by the existing
   `red-carpet.test.js` tests staying green.
4. **Team-mode early-return contract.** `renderLobby` still early-returns
   when `gameState.gameMode === 'team'`; `#lobby-players` remains empty
   of seats in team mode. The L55-60 test in `red-carpet-seat-table.test.js`
   stays green.
5. **`assignTeam` join handlers.** `#join-red-btn` / `#join-blue-btn` click
   handlers in `app.js` (L389-392) untouched — they fire `assignTeam` with
   the same payload as today.

## §5 — Regression-safety model (test contract)

**Pinned-green guards (sacrosanct, unedited):**
- `client-tests/render-lobby.test.js` (all 11 tests)
- `client-tests/red-carpet-seat-table.test.js` (all 5 tests, including the
  team-mode early-return assertion)
- `client-tests/red-carpet.test.js` (pure-seam unit tests for
  `playerCardModel`/`diffArrivals`/`rollCameraLabel`/`marqueeSegments`)
- `client-tests/red-carpet-render.test.js`
- All `server/**` suites

**New tests (the design's own pin):**
- `client-tests/seat-builder.test.js` — pure-seam tests for `seatModel` +
  `buildSeatNode`:
  - `seatModel({mode:'classic', slot})` returns `accentHue === SEAT_HUES[slot]`,
    no `team` key.
  - `seatModel({mode:'team', team:'red'})` returns `team === 'red'`, no
    `accentHue`, no `hasPickedColor`.
  - `playerCardModel(p, opts)` ≡ `seatModel(p, {...opts, mode:'classic'})`
    output-equal (wrapper-equivalence sentinel).
  - Zero-stableId sentinel: passing `{...player, stableId:'X'}` does not
    change the output.
  - `buildSeatNode(classicModel, ...)` produces `.seat` w/ `--avatar-hue`,
    optional `.seat-swatches` when `is-you`.
  - `buildSeatNode(teamModel, ...)` produces `.seat.team-red`/`.seat.team-blue`,
    NO `.seat-swatches`, NO `--avatar-hue`, `--seat-team-color` set to the
    team token.
- `client-tests/render-team-screen.test.js` — team-mode render contract:
  - 2-red-vs-3-blue → `#team-red-list` has 2 `<li.seat.team-red>`,
    `#team-blue-list` has 3 `<li.seat.team-blue>`.
  - Host (in team mode) sees `.seat-kick` on each non-self seat across both
    teams.
  - Non-host sees zero `.seat-kick`.
  - Host-with-wins nameplate (in team mode) → single `.crown`, no
    `(You)`/`👑` in the name text (mirrors 7.6.1 contract).
  - Cinema-screen headers present on both teams (eyebrow + headline + tint).
  - Join buttons disabled-state tracks `myTeamId`.
  - Start Match visibility tracks `teamsReady` truth-table.
  - Ledger rows mirror gameState.hardcoreMode/allowTvShows onto
    `.ledger-row.on` for the team-suffixed controls.
  - Re-rendering with the SAME roster doesn't re-apply `.is-entering`
    (arrival-diff continuity).
- `client-tests/socket-handlers.test.js` extensions — assert that change
  events on `#hardcore-toggle-team`, `#tv-shows-toggle-team`, and
  `#theme-select-team` emit `updateLobbySettings` with the same payload as
  the classic controls.

**Expected suite growth:** ~12–15 new tests; total goes from 536 → ~548–551.
Zero pre-existing tests edited.

## §6 — Implementation phases (linear TDD tasks)

**Task 0 — Pure seam.** Add `seatModel` to `red-carpet.js`. Rewrite
`playerCardModel` as a thin wrapper. Write `seat-builder.test.js` for the
pure-seam contracts (no DOM). RED → GREEN.

**Task 1 — DOM builder + render rewrite.** Add `public/js/ui/ui-seat.js`
exporting `buildSeatNode`. Rewrite `renderLobby` seat-building to call it.
Rewrite `renderTeamScreen` end-to-end. Update `index.html` `#team-screen`
body per §3.3. Add team-suffixed change-handler registrations in
`socketClient.js` per §3.4. Write `render-team-screen.test.js` + extend
`socket-handlers.test.js`. RED → GREEN. Existing `render-lobby.test.js` and
`red-carpet-seat-table.test.js` byte-identical and green (regression proof).

**Task 2 — CSS.** Append the new `Phase 7.8b — Team Theater Lobby` section
to `02-hero-lobby.css` per §3.6. Verify mobile stacks correctly via media-
query rule presence (jsdom can't lay out, so the rule presence + selector
shape is the proof; in-browser eyeball owed). Existing 02-hero-lobby.css
rules byte-identical.

Each task is reviewed twice — spec-compliance then code-quality — with real
fix-loops. Final whole-branch holistic review (opus) before PR.

## §7 — Per-task review gates

For each of T0 / T1 / T2:
1. **Spec-compliance review** against this spec's §3/§4/§5/§8 — 0
   Critical/Important findings to GO.
2. **Code-quality review** for clarity, naming, comment WHYs, perf, a11y —
   0 Critical/Important to GO.

After all three tasks pass both per-task gates:
3. **Whole-branch holistic review (opus)** against §8 guardrails + §10
   acceptance, with per-guardrail evidence — 0 Critical/Important to GO.

## §8 — Guardrails (binding)

1. **Client-only.** No socket-event additions or server-state changes.
   `assignTeam`/`addBot`/`updateLobbySettings` payloads byte-identical.
   Server suites stay green.
2. **No new colors.** Reuse `--team-red`/`--team-blue` family tokens
   (existing) and the established cinema-screen accent.
3. **No stableId exposure.** `seatModel` reads no persistent identifier.
   Sentinel-tested.
4. **Sacrosanct guard tests byte-identical.** `render-lobby.test.js`,
   `red-carpet-seat-table.test.js`, `red-carpet.test.js`,
   `red-carpet-render.test.js`, all server suites — unedited.
5. **Reduced-motion neutralised.** No new motion property bypasses the
   global `@media (prefers-reduced-motion: reduce)` block. The entrance
   animation reuses the existing `.is-entering` class + keyframes already
   in `02-hero-lobby.css`.
6. **Vanilla no-build perf budget.** No new dependencies. Entrance animation
   stays compositor-only (transform + opacity).
7. **Append-only CSS.** No edits to pre-existing rules in
   `02-hero-lobby.css`. New rules under the `Phase 7.8b` banner. Dead rules
   from the pre-7.8b team-screen stay in the file for DS-01 pass 2.
8. **Bot team auto-assignment unchanged.** Host's Add Bot still emits
   `{ lobbyId, difficulty }` only; server balances.
9. **DOM id preservation.** `#team-screen`, `#team-lobby-code`,
   `#team-red-list`, `#team-blue-list`, `#join-red-btn`, `#join-blue-btn`,
   `#team-start-btn`, `#team-back-btn` all preserved.
10. **`playerCardModel` byte-identical wrapper.** The rewritten
    `playerCardModel` is output-equal to the pre-refactor implementation for
    every real (player, opts) pair. Sentinel-tested.

## §9 — Deferred / future work (recorded)

- **QR scan-to-join (Phase 7.8c).** Net-new on top of either lobby — does
  not block parity.
- **Public Room toggle on team-screen.** Today's team mode cannot be made
  public. Out of parity scope (a feature add, not parity).
- **Per-team bot selection UI** ("Add Red Bot" / "Add Blue Bot"). Server
  already auto-balances; UI doesn't need it.
- **Per-player color picking inside a team.** Traded for team identity in §1.
- **DS-01 pass 2 dead-CSS sweep** of `.team-columns`/`.team-player-list`/
  `.team-player-chip`/`.btn-join-team`/`.team-hint`/`.chip-host` after this
  phase ships.

## §10 — Acceptance criteria (the "done" bar)

1. A team-mode lobby renders the `.lobby-head` cinema-style header + 3-column
   `.lobby-body` + Director shell at ≥1000px.
2. A 2-red-vs-3-blue roster renders 5 seat-style chairs (2 red + 3 blue) with
   crown / you-pill / team-color treatments correct.
3. Mobile (<1000px) stacks vertically with red → blue → director order.
   <640px tightens seat sizes.
4. House Rules ledger in team mode is editable by host, and changes propagate
   via `updateLobbySettings` (validated by the new socket-handler tests).
5. Host can Add Bot from team-screen; the bot auto-balances to the smaller
   team (existing server logic, unchanged).
6. Join Red / Join Blue / Start Match / Back to mode buttons fire the SAME
   socket emits as today (regression proof via `socket-handlers.test.js`
   continuity).
7. Suite count grows by ~12–15 tests (seat-builder + render-team-screen +
   socket-handlers extensions). All green. Zero pre-existing tests edited.
8. Full suite green; `npm test` exits 0.
9. PR-merge / push-main / Render-deploy stays classifier-gated → handed to
   user for the in-browser eyeball.

## §11 — Lessons applied (from prior Phase-7 sub-phases)

- **Pure seam + thin renderer** — established in 7.5/7.5.1/7.5.2/7.5.3/7.7;
  proven to keep tests stable across redesigns. Adopted: `seatModel`
  (pure) + `buildSeatNode` (impure DOM), same shape as `red-carpet.js`
  + `renderLobby` glue.
- **Append-only CSS + dead rules deferred to DS-01 pass 2** — established
  in 7.5.2 (dead .entrance-card rules deferred). Adopted: dead .team-columns
  rules stay for DS-01 pass 2.
- **Byte-identical wrapper for migrated seams** — established by 7.5.2's
  `playerCardModel` unchanged proof. Adopted: `playerCardModel` as a thin
  `seatModel` wrapper, sentinel-tested for equivalence.
- **Phase-1 stableId leak fix structurally preserved** — `seatModel` reads
  no persistent identifier; sentinel-tested.
- **Per-control change-handler registration on multiple ids** — the
  established codebase pattern (mode-chips, swatches). Adopted: ledger
  controls register on both classic + `-team` ids.
- **No mobile-only override re-broken** — established by 7.3 C1 (mobile
  modal-card regression from a media-query override). Adopted: the new
  `.team-lobby-body` rule does NOT touch any pre-existing media query; new
  `@media` blocks scoped to the new selectors only.
