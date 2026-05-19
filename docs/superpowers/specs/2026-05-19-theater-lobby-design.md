# Phase 7.5.2 — Theater Lobby (Design Spec)

> Status: APPROVED (design gate passed 2026-05-19). Third lobby-redesign
> iteration (7.5 Red Carpet → 7.5.1 Seat-Table → **7.5.2 Theater**),
> implementing the user-commissioned "Theater Lobby" design handoff. This spec
> is the binding spec-compliance bar for reviewers (§8 guardrails + §10
> acceptance criteria).

## §0 — Context & provenance

The user commissioned a lobby redesign from Claude Design and dropped a handoff
at `C:\Users\corte\Downloads\MovieMatch\design_handoff_lobby`:

- `README.md` — **the authoritative, high-fidelity design spec** (target markup,
  seat DOM, the full chair SVG ~5KB, per-seat CSS-variable system, entrance
  keyframes, responsive breakpoints, "Set the scene" Director panel). Pixel-match
  intended.
- `Lobby Redesign.html` — a React+Babel prototype. **Reference-only, DO NOT
  SHIP.** The codebase is vanilla JS, no build step. The full CSS to lift lives
  inside its `<style>` block.
- `tweaks-panel.jsx` — prototype tooling. **Do not ship.**

This redesign **fully supersedes** the just-merged 7.5 (Red Carpet, PR #30/#31)
and 7.5.1 (Seat-Table, PR #32) lobby. `origin/main = 59e9f7f` (post-#32; reconcile
DONE). Isolated worktree `C:\mm-phase7-5-2`, branch `phase7-5-2-theater-lobby`,
off `origin/main 59e9f7f` (node_modules junctioned). A parallel Codex agent
shares the repo → branch-verify before every commit.

**Naming:** the handoff self-labels "PHASE 8 — THEATER LOBBY" (Claude Design's
own numbering). In this project Phase 8 is reserved for Couch Mode
(decision-record). This is **Phase 7.5.2**, a Phase-7 lobby sub-phase.

## §1 — The four locked reconciliation decisions (binding)

Resolved at the design gate (all the recommended option):

1. **Full replace + delete dead CSS.** The theater layout fully supersedes
   7.5/7.5.1. As part of this work, the now-dead 7.5 "Red Carpet" and 7.5.1
   "Seat-Table" **appended lobby sections** in `02-hero-lobby.css` are
   **explicitly DELETED** (no inert dead CSS). Pre-7.5 base rules and all
   non-lobby rules are untouched. New theater rules are appended in their place.
2. **Rewrite the lobby guards + pin behaviour.** `render-lobby.test.js`,
   `red-carpet-render.test.js`, **and `red-carpet-seat-table.test.js`** (the
   7.5.1 jsdom suite the handoff README did not know about — it asserts the now-
   deleted `.lobby-stage`/`.entrance-card` structure) are legitimately rewritten
   to the new `.seat` contract. The "li-count == player-count" invariant
   (bedrock since 7.1) is intentionally retired (now always 8 `<li>`s). The
   regression-safety model shifts to §4 + §5.
3. **Chair color = `SEAT_HUES[slot]`.** The seat's `--avatar-hue` is fed the
   7.5.1 collision-free seat-slot palette — NOT the prototype's per-identity
   hash hue (which is exactly the collision bug #32 fixed). `.is-you` still
   overrides to fixed indigo per the README.
4. **Theater Lobby is the work now** (client-only; pick-your-color and 7.6
   remain deferred — §9).

## §2 — Goals / Non-goals

**Goals.** Pixel-match the handoff README: cinema "screen" header (room code
moves top-left, no marquee), a `.theater` column of **8 SVG velvet-chair
seats** (2 rows of 4; first N occupied, rest empty `SEAT 0X` slots), a
nameplate-drop / person-sit / spotlight-pulse entrance for newly-seated
players, a restructured "Set the scene" Director column. Client-only, vanilla,
no build. Every code change ships a WHY comment. No new color values
(01-base.css tokens only); JetBrains Mono added for mono labels.

**Non-goals (out of scope; untouched).** `socketHandlers.js`, `gameLogic.js`,
any socket protocol/event; the hero screen, team screen, in-game board, modals;
theme/hardcore/tv-shows **behavior**; the bot-add **flow** logic (chrome
restyled only). Deferred & recorded (§9): interactive pick-your-own-color,
7.6, team-screen theater parity, QR.

## §3 — The contract

### §3.1 Pure seam — `public/js/ui/red-carpet.js` — UNCHANGED (zero production edit)

A deliberate, elegant outcome: 7.5.1's seam is exactly the theater's substrate.
`playerCardModel(player, {myPlayerId, slot})` already returns
`{name,isHost,isYou,isBot,wins,accentHue,accentEmoji,label}`, and post-7.5.1
`accentHue === SEAT_HUES[((slot%8)+8)%8]` — so decision #3 is satisfied **for
free**: the seat sets `--avatar-hue: <accentHue>`. `diffArrivals(seenIds,
players)` + the existing module-scoped `_seenPlayerIds` / `_lastLobbyId`
page-session machinery in `ui-render.js` **is** the README's "track entering
across renders" requirement — reuse it; do NOT add a parallel mechanism.
`rollCameraLabel` continues to own `#start-btn` text/disabled/variant.

`red-carpet.js` receives **zero production change**. `client-tests/red-carpet.test.js`
(the pure unit suite) therefore stays **byte-identical & green** — a strong
continuity proof through a structural redesign.

### §3.2 `public/js/ui/ui-render.js` — `renderLobby` DOM-builder rewrite

The team-mode early-return at the top of `renderLobby` is **byte-identical
UNTOUCHED** (`if (mode === 'team') { showScreen('team');
renderTeamScreen(...); return; }`) — team mode never builds the theater. The
lobby-id-keyed seen-set reset (`_seenPlayerIds`/`_lastLobbyId`), the
`diffArrivals` call, and the `lobbyCodeDisplay.innerText = gameState.id` write
are preserved (the room code still displays — it just moves to the header
top-left via markup/CSS, same `#lobby-code-display` id + write).

Replace the players-`forEach` (which today builds `<li class="entrance-card">`)
with a builder that renders **exactly 8** `<li class="seat" data-slot="i">`
into `#lobby-players` (which gains `class="seats-grid"` but keeps its id):

- **Occupied** (`i < players.length`): per the README "Seat DOM" — `.nameplate`
  (`.crown` if `card.isHost`, the name = `card.label` semantics, `.you-pill`
  if `card.isYou`, `.bot-pill` if `card.isBot` — mutually exclusive with
  you-pill), `.seat-person > .avatar-emoji` (= `card.accentEmoji`),
  `.seat-svg-wrap` (`.seat-spotlight`, the chair `<svg>`, and a `.seat-kick`
  button **omitted on your own seat**). `<li>` carries
  `style="--avatar-hue:<card.accentHue>"`, `class` adds `occupied`, `is-you`
  iff `card.isYou`, `entering` iff the id is newly-arrived per `diffArrivals`,
  `data-player-id=<p.id>`.
- **Empty** (`i >= players.length`): `<li class="seat" data-slot="i">` with a
  `.seat-num` "SEAT 0X" + `.seat-svg-wrap`(`.seat-spotlight` + chair `<svg>`).
- **Kick**: `.seat-kick` click emits the **byte-identical** payload — bots →
  `removeBot {lobbyId, targetId}`, humans → `kickPlayer {lobbyId, targetId}` —
  same condition (`amIHost && p.id !== myPlayerId`), same socket. Only the
  trigger element class changes (`.btn-kick` → `.seat-kick`).
- **Entering**: a seat gets `entering` iff its id is in the `diffArrivals`
  `entering` set; a `setTimeout(...1400ms)` keyed by player id removes the
  class so idempotent re-renders don't re-trigger (mirrors the existing
  page-session discipline; reduced-motion is handled globally — §3.4).
- **Status line**: update `#seated-count` (= `players.length`) and
  `#seated-hint` (`Waiting for more cast…` if `players.length < 2`, else
  `Ready when the Director rolls camera.`).
- **Add-Bot row + `#start-btn`**: the existing host-only Add-Bot row management
  (`prevBotRow` teardown, `startBtn.parentNode` insert) and the
  `rollCameraLabel`-driven `#start-btn` (text/disabled/variant) are preserved
  behaviourally; only their surrounding markup/classes restyle (`.ref-cta`).
  `#start-btn` keeps its id + `.btn-primary`.

### §3.3 `public/index.html` — `#waiting-room` restructure

Replace the inner markup of `<div id="waiting-room" class="panel hidden
lobby-panel">` with the README "DOM Structure" target verbatim (`.lobby-head`
→ `.lobby-body` → `.theater` + `.director-shell.dir-refined`). **Every existing
id preserved** (`#lobby-code-display`, `#public-room-toggle`, `#mode-selector`,
`#mode-chip-classic..speed`, `#mode-description`, `#theme-select`,
`#hardcore-toggle`, `#tv-shows-toggle`, `#start-btn`, `#lobby-players`,
`#lobby-settings`). The `#lobby-settings` ledger rows are `<label>`s wrapping
the **real, visually-hidden** `<input type=checkbox>` (`position:absolute;
opacity:0`) so the existing socketClient change-handlers fire unchanged. NEW
ids introduced: `#theater-status`, `#seated-count`, `#seated-hint` (verify they
are not already used elsewhere — they are not). `#team-screen` (sibling after
`#waiting-room`) is **untouched**. JetBrains Mono appended to the existing
Google-Fonts `<link>` (`&family=JetBrains+Mono:wght@500;600;700`).

### §3.4 `public/css/02-hero-lobby.css` — delete dead + append Theater

**Delete** the now-dead lobby-specific appended sections: the 7.5 "PHASE 7.5 —
RED CARPET LOBBY" section and the 7.5.1 "PHASE 7.5.1 — SEAT-TABLE LAYOUT"
section (the `.marquee*`, `.entrance-card*`, `.lobby-stage*`, the reworked
`#lobby-players li.entrance-card` tile rules, `#waiting-room.lobby-panel`
widen, `.director-panel*`/`.theme-select`/`.waiting-public-toggle`/`.roll-camera*`
that the new DOM no longer emits). **Do NOT** touch pre-7.5 base rules
(`.lobby-panel`@~230, `#lobby-players`/`#lobby-players li`@~569-582,
`.setting-toggle`@~671, `.bot-badge`@~696, `.btn`/`.btn-primary`, etc.) or any
non-lobby rule — the theater markup still relies on `.lobby-panel`,
`.btn`/`.btn-primary`, `.mode-chip`, `.accent-text`, the screen system.

**Append** the Theater section (lift from the prototype `<style>`: `lobby
panel`, `header row`, `main grid`, `THEATER`, and **only** the `.dir-refined`
Director block — the `.dir-console`/`.dir-slate` exploration variants are
dropped). Tokens only — **no new color values** (anywhere the prototype uses
indigo/amber, source `var(--accent-primary)`/`var(--accent-warm)`; the chair
velvet/arm/cushion come from the per-seat `--avatar-hue` HSL system in the
README). Responsive breakpoints (≥1000 / <1000 / <640) verbatim.

**Reduced motion:** rely on the **existing global block in
`06-states-anim.css`** (project convention — it neutralizes all
animation-duration). Do **NOT** add the README's per-rule
`@media (prefers-reduced-motion)` guard (double-handling). The entrance
keyframes (`nameplate-drop`/`person-sit`/`spotlight-pulse`) are appended in the
Theater section; their baseline `.nameplate`/`.seat-person` state MUST be
`opacity:1` (README "Critical" note) so a missed animation still shows the
player.

**Chair SVG:** each `.seat` embeds its **own** full inline `<svg>` including
its **own `<defs>`** (the 4 gradients). The duplicated `id="seat-*"` across 8
SVGs is **intentional and REQUIRED — do NOT consolidate to a single shared
`<defs>`**: the gradient `<stop stop-color="var(--velvet-light)">` resolves the
custom property against the *gradient element's* inherited computed style, so a
shared defs would render every chair identically and break the per-seat
`--avatar-hue` recolor. Per-fragment duplicated ids resolve correctly (browsers
match `url(#seat-backG)` to the nearest same-fragment `<defs>`). A reviewer
must NOT flag the duplicate ids as a defect.

## §4 — Behavioural-equivalence contract (decision #2, binding)

The lobby DOM changes structurally; **behaviour must not**. The rewritten
tests MUST re-pin, and reviewers MUST verify, every item below as
byte-identical / behaviourally unchanged vs `59e9f7f`:

- **Socket:** kick → `removeBot`(bot)/`kickPlayer`(human) with exactly
  `{ lobbyId: gameState.id, targetId: p.id }`; no socket emit/handler added,
  removed, or renamed; `socketHandlers.js` + all `server/**` byte-identical.
- **Host:** server-driven `player.isHost`; crown shown on host seat; kick
  rendered only when `amIHost && p.id !== myPlayerId`; non-host sees zero kick
  controls.
- **Settings:** `#theme-select` / `#hardcore-toggle` / `#tv-shows-toggle` are
  the same real inputs with the same ids (now inside a wrapping `<label>`); the
  socketClient change-handlers fire unchanged. `#mode-selector` + the four
  `#mode-chip-*` ids unchanged. `#start-btn` keeps id + `.btn-primary`; its
  enabled/disabled/text driven by the **unchanged** `rollCameraLabel`.
- **Team mode:** `renderLobby`'s team early-return is byte-identical; team mode
  builds **zero** theater DOM.
- **Room code:** `#lobby-code-display` keeps its id and the
  `lobbyCodeDisplay.innerText` write; only its position (header top-left) and
  styling change.

## §5 — Zero-regression boundary (the proof, redefined)

- **Rewritten** (legitimately, to the `.seat` contract — decision #2):
  `client-tests/render-lobby.test.js`, `client-tests/red-carpet-render.test.js`,
  `client-tests/red-carpet-seat-table.test.js`. The rewrites assert the NEW
  structure (8 `.seat`, occupied/empty, `.seat-kick`, nameplate/crown/you/bot,
  `--avatar-hue` distinct across 8 = SEAT_HUES, `#seated-count`) **and** re-pin
  the §4 behaviour (kick payload, host/you/bot, theme/mode ids, `#start-btn`
  gating, team early-return builds nothing).
- **Byte-identical & green (unedited):** `client-tests/red-carpet.test.js` (the
  pure unit suite — the seam is unchanged), `socket-handlers`, `showScreen`,
  `modal-factory`, `name-prompts`, and all `server/**`. This is the standing
  proof that nothing outside the lobby DOM moved.
- Full `cd C:/mm-phase7-5-2 && npx jest` green. Net test/suite count changes
  only within the three rewritten lobby suites (not "additive over a baseline"
  this time — a structural redesign legitimately re-pins the lobby tests; the
  ratchet applies to the unedited suites, which must not regress).
- jsdom never lays out or boots a browser → the pixel-fidelity / responsive /
  animation / reduced-motion correctness is the **user-side eyeball**.

## §6 — Decomposition (3 linear TDD tasks; shared files → ordered, blockedBy)

- **Task 0 — `index.html` `#waiting-room` restructure + JetBrains Mono.** The
  static theater skeleton per README target markup (all ids preserved, ledger
  hidden-checkbox labels, `#theater-status`/`#seated-count`/`#seated-hint`,
  per-seat inline SVG template), font link. Verify: index.html parses; every
  required id present; `#team-screen` untouched. (jsdom asserts structure/ids.)
- **Task 1 — `renderLobby` DOM rewrite + rewritten render tests.** §3.2
  builder; reuse `playerCardModel`/`SEAT_HUES`(via accentHue)/`diffArrivals`/
  `_seenPlayerIds`/`_lastLobbyId`; `.seat-kick` byte-identical emit; team
  early-return untouched. Rewrite `render-lobby.test.js` +
  `red-carpet-render.test.js` + `red-carpet-seat-table.test.js` to the `.seat`
  contract + the §4 behavioural pins. `red-carpet.test.js` UNEDITED & green.
  Verify: rewritten suites + the unedited suites all green.
- **Task 2 — CSS delete-dead + append Theater.** Remove the 7.5/7.5.1 lobby
  appended sections; append the Theater section (tokens-only, `.dir-refined`
  only, responsive verbatim, reduced-motion via the global block). No pre-7.5
  base rule or non-lobby rule edited. Verify: full `npx jest` green;
  visual/responsive/reduced-motion eyeball flagged user-side.

## §7 — Constraints (binding)

Vanilla JS, no build. **CLIENT-ONLY:** no server / socket-event / scoring /
validation / theme-mechanic / Redis / persistence / accounts change (host
server-enforced; theme server-authoritative). Chair color from `SEAT_HUES[slot]`
(never per-identity → no collision; never `stableId`). Team-mode render path
byte-identical (early-return untouched). Compositor-safe animation only;
reduced-motion via the existing global `06-states-anim.css` block (no per-rule
handling); the README's "no new timers beyond the entering-cleanup" honored.
Pure-seam/barrel/DAG: `red-carpet.js` unchanged & still barrel-exported;
`ui-render.js` consumes it via the existing direct sibling import; no import
cycle. No new color values (01-base.css tokens only). Every code change ships a
WHY comment. Isolated worktree off `59e9f7f`; branch-verify before every
commit. Out-of-scope findings → `spawn_task`, never widen 7.5.2. PR-merge /
push-to-main / Render-deploy is classifier-gated → hand the PR to the user.

## §8 — Guardrails (per-item spec-compliance bar for reviewers)

- **G1 client-only.** Diff touches ONLY `index.html`, `ui-render.js`,
  `02-hero-lobby.css`, and the 3 rewritten test files. No server/socket/scoring/
  persistence/gameLogic change; `red-carpet.js` unchanged.
- **G2 no collision / no stableId.** Chair `--avatar-hue` = `card.accentHue`
  (= `SEAT_HUES[slot]`); 8 seats → 8 distinct hues; never per-identity hash;
  no `stableId` anywhere in `#waiting-room`.
- **G3 behavioural equivalence (§4).** Kick emit payload, host detection,
  theme/hardcore/tv wiring, mode-chip ids, `#start-btn` gating, room-code
  write — all byte-identical/behaviourally unchanged and re-pinned by the
  rewritten tests.
- **G4 zero-regression of the unedited suites.** `red-carpet.test.js` +
  socket-handlers/showScreen/modal-factory/name-prompts + `server/**`
  BYTE-IDENTICAL & green; full `npx jest` green.
- **G5 team-mode byte-identical.** `renderLobby` team early-return untouched;
  zero theater DOM in team mode.
- **G6 CSS hygiene.** Only the 7.5/7.5.1 lobby appended sections deleted +
  Theater appended; NO pre-7.5 base rule or non-lobby rule edited/reordered;
  no new color values; reduced-motion via the global block (no per-rule);
  per-seat duplicated SVG `<defs>` ids intentional (NOT a defect).
- **G7 ids/markup.** Every pre-existing id preserved; ledger hidden-checkbox
  pattern keeps change-handlers firing; `#team-screen` untouched; JetBrains
  Mono added to the existing link only.
- **G8 fidelity.** Pixel-match the handoff README (the binding visual source);
  `.dir-console`/`.dir-slate` dropped; tokens-only.

## §9 — Deferrals (recorded; do not widen 7.5.2)

Interactive pick-your-own-color (server-touching, own brainstorm). 7.6 Chain
Premiere Recap + Share Cards 2.0. Team-screen theater parity. QR scan-to-join.
The prototype's Tweaks panel / React+Babel (reference-only, never shipped).

## §10 — Acceptance criteria (binding; mapped to tasks)

1. `index.html` `#waiting-room` = README target markup; ALL existing ids
   preserved; ledger rows wrap real hidden checkboxes; new
   `#theater-status`/`#seated-count`/`#seated-hint`; `#team-screen` untouched;
   JetBrains Mono on the existing font link. (T0)
2. `renderLobby` renders exactly 8 `<li class="seat">` (N occupied + rest
   empty) reusing `playerCardModel`/`accentHue`(=SEAT_HUES[slot])/`diffArrivals`;
   `.seat-kick` emits the byte-identical kick payload, omitted on own seat;
   `.is-you`/`.entering`(1400ms); `#seated-count`/`#seated-hint` correct;
   team early-return UNTOUCHED. (T1)
3. `render-lobby.test.js` + `red-carpet-render.test.js` +
   `red-carpet-seat-table.test.js` rewritten to the `.seat` contract + §4
   behavioural pins, green; `red-carpet.test.js` UNEDITED & green;
   socket-handlers/showScreen/modal-factory/name-prompts + `server/**`
   BYTE-IDENTICAL & green; full `npx jest` green. (T1)
4. `02-hero-lobby.css`: 7.5/7.5.1 lobby appended sections deleted; Theater
   section appended (tokens-only, `.dir-refined` only, responsive verbatim,
   reduced-motion via global block); per-seat duplicated SVG defs; NO pre-7.5/
   non-lobby rule edited. (T2)
5. Chair color collision-free (8 distinct seat hues); `.is-you` indigo
   override; no `stableId` in `#waiting-room`. (T1/T2)
6. User-side eyeball (non-blocking; jsdom never lays out): pixel-match the
   handoff (screen header, 8 chairs incl. empty, nameplate-drop/person-sit/
   spotlight entrance, Director "Set the scene" ledger), responsive
   ≥1000/<1000/<640, OS reduced-motion legible, team-mode waiting screen
   unchanged.

## §11 — Pipeline & sequencing

Base `origin/main 59e9f7f`. Worktree `C:\mm-phase7-5-2` / branch
`phase7-5-2-theater-lobby` (junctioned). Native Task tools unavailable →
TodoWrite + a hand-authored co-located `.md.tasks.json` (status synced +
committed per task). Subagent-driven: per-task two-stage review (spec then
quality, real fix-loops) + a final opus whole-branch holistic. Branch-verify
(`git -C C:/mm-phase7-5-2 branch --show-current == phase7-5-2-theater-lobby`)
before EVERY commit. Spec + plan ride to origin via the PR. PR-merge /
push-to-main / Render-deploy classifier-gated → hand the PR to the user.
Post-merge reconcile mirrors 7.1–7.5.1 (ff local main, junction unlink
LINK-ONLY via PowerShell .NET `(Get-Item).Delete()` + Unix `rmdir` for the
emptied parent — NOT `cmd /c rmdir`; PowerShell tool guards top-level
`Remove-Item`). Real-boot/in-browser eyeball is user-side.
