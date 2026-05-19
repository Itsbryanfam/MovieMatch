# Phase 7.5.1 — Red Carpet Lobby "Seat Table" Redesign (Design Spec)

> Status: APPROVED (design gate passed 2026-05-18). Follow-on refinement of Phase 7.5
> (Red Carpet Lobby), prompted by live-site user feedback + a hand-drawn mockup.
> This spec is the binding spec-compliance bar for reviewers (§8 guardrails + §10
> acceptance criteria).

## §0 — Context & provenance

Phase 7.5 shipped the Red Carpet lobby: PR #30 (core, merge commit `3da4cf1`) + PR
#31 (eyeball polish, merge commit `9165761`), both MERGED+live; post-#31 reconcile
DONE. `origin/main = 9165761`. The user, testing the deployed site
(moviematch.it.com), reported two defects and invited a layout redesign with a
rough mockup. This is a **client-only, additive** refinement built on the same
pure-seam pipeline validated across 7.1–7.5.

- Base: `origin/main 9165761` (contains #30 + #31 — correct base, zero overlap risk).
- Isolated worktree `C:/mm-phase7-5-1`, branch `phase7-5-1-seat-table-redesign`
  (node_modules junctioned to `C:/moviematch-git/node_modules`). A parallel Codex
  agent shares the repo → verify branch before every commit.

## §1 — Problems (from live user feedback)

- **§1.1 Accent-color collision (bug).** `red-carpet.js playerCardModel` derives
  `accentHue = djb2(name + ':' + socketId) % 360`. Distinct identities collide
  (observed: "Bot Kurosawa" and "Bot Coppola" rendered the same color). The
  per-player identity cue is defeated whenever two hues land close/equal.
- **§1.2 Vertical overflow (bug).** The lobby is one narrow centered modal stacking
  room-code → players list → Director panel. At 7 players (8 incl. host) it grows
  so tall the "Add Bot" button is pushed off / clipped and unreachable.
- **§1.3 Redesign invitation.** User: a Director/selectors **left sidebar** + a
  **responsive grid of richer player "seat" tiles** (host always first), so the
  lobby reads like a theatre table rather than a tall list.

## §2 — Goals / Non-goals

**Goals.** (a) 8 guaranteed-distinct player seat colors, client-only,
deterministic, collision-free for the real max roster. (b) Director left sidebar +
responsive seat-tile grid on desktop; everything **stacked** on mobile ≤767px so
Add Bot is always reachable. (c) Richer per-player tile. (d) Strictly additive,
vanilla no-build, zero-regression. (e) Every code change ships a WHY comment.

**Non-goals (deferred, recorded — §9).** Interactive pick-your-own-color
(server-synced, mutually exclusive) — its own next sub-phase. Team-screen
Seat-Table parity — deferred for a later same-style pass (user wants it eventually).
QR scan-to-join — still deferred. **Empty placeholder seats are intentionally NOT
rendered** (would break the zero-regression `<li>`-count guard and add JS — YAGNI).

## §3 — The contract changes

### §3.1 Pure seam — `public/js/ui/red-carpet.js` (the only logic change)

- **New frozen export `SEAT_HUES`** — exactly 8 integer hues in `[0, 359]`,
  hand-tuned to be perceptually well-separated and **pairwise-distinct**. Concrete
  palette: `[350, 25, 45, 140, 188, 220, 270, 312]` (red / orange / gold / green /
  cyan / blue / violet / magenta). Per the 7.5 `ACCENT_EMOJI` lesson, tests pin
  **length = 8, all integers in [0,359], pairwise-distinct, frozen, deterministic**
  — NOT the specific value at a specific index (over-pinning is brittle).
- **`playerCardModel(player, opts)` gains `opts.slot`** — the player's 0-based
  index in the rendered roster. `accentHue = SEAT_HUES[((slot % 8) + 8) % 8]`
  (defensive double-modulo: a non-finite or negative `slot` still yields a valid
  in-range index, never `undefined`/throw). The server caps a lobby at 8 (host +
  7), so for every real roster the 8 slots map to 8 distinct hues. Document the
  modulo as defensive (the >8 case is unreachable in production but must not crash).
- **Everything else byte-identical to 7.5**: `name / isHost / isYou / isBot /
  wins / label` unchanged; `accentEmoji` UNCHANGED (still
  `ACCENT_EMOJI[djb2(name+':'+id) % 12]` — emoji repetition is not a defect, the
  user flagged color only; changing it is needless churn/risk — YAGNI).
- **Security invariant preserved & strengthened.** Color now reads **zero
  identity** (slot only); emoji still uses `name + ':' + socketId` ONLY — **never
  `stableId`** (the Phase-1 daily-leaderboard leak fix). The model must be
  byte-identical with vs without a `stableId` key on the player object (the 7.5
  sentinel test is retained).
- `diffArrivals`, `rollCameraLabel`, `marqueeSegments` — **UNCHANGED**.

### §3.2 Thin glue — `public/js/ui/ui-render.js`

`renderLobby` already iterates `gameState.players`. Pass the index as the slot:
`gameState.players.forEach((p, i) => { const card = playerCardModel(p, {
myPlayerId, slot: i }); … })`. The server orders the host first (the
zero-regression guard asserts `items[0]` is the host), so the host is **seat 0** —
a stable first color. No other JS change: `--card-accent` is still set inline from
`card.accentHue`; the `.is-entering` diff (page-session `_seenPlayerIds` /
`_lastLobbyId`) is unchanged; the `.btn-kick` condition + `kickPlayer`/`removeBot`
emit are byte-identical; the **team-mode early-return path is UNTOUCHED**.

### §3.3 Additive structure — `public/index.html`

Add exactly ONE additive wrapper, `.lobby-stage`, enclosing the existing
`.players-list-container` (the `<ul id="lobby-players">`) and the existing
`.director-panel`. ALL existing ids preserved. The `.panel-header` (marquee /
`#lobby-code-display` / `.waiting-public-toggle` from 7.5 + #31) stays exactly as
it is, above `.lobby-stage`. `#team-screen` is **untouched**. This mirrors the
additive-wrapper move 7.5 used for `.marquee` / `.director-panel`.

### §3.4 Layout — `public/css/02-hero-lobby.css` (rework 7.5's OWN section only)

The 7.5 "Red Carpet" appended section is 7.5's own; this redesign **reworks that
section** (and adds new rules). **No pre-7.5 rule may be edited, reordered, or
removed** (verify via diff: only lines within the 7.5 Red Carpet section + new
appended rules change).

- `.lobby-stage` — desktop `display:flex; gap; align-items:flex-start`.
  `.director-panel` becomes a left sidebar (`flex:0 0 ~16rem`, clamped);
  `.players-list-container` takes the rest (`flex:1; min-width:0`).
- `#lobby-players` — `display:grid; grid-template-columns: repeat(auto-fill,
  minmax(<tile-min>, 1fr)); gap;` list-reset (no bullet/inherited padding). Tiles
  wrap responsively (~2×4 columns at full desktop width).
- `.entrance-card` (the `<li>`) — restyled as a vertical **seat tile**: padding,
  the seat accent from `hsl(var(--card-accent), …)` as a border/edge + a faint
  accent-tinted background, a prominent `.entrance-card__emoji`, the
  `.entrance-card__name` (carries `(You)` / 👑 / `• N 🏆` already in the label),
  the `.bot-badge` (kept non-shrinking/`nowrap` per the #31 fix intent), the
  `.btn-kick` ✕ positioned in a corner. Long names wrap (`overflow-wrap`).
- **Panel width.** On desktop the lobby panel (`#waiting-room` / `.panel
  .lobby-panel`) widens to fit sidebar + grid (scoped override). **7.5 C1/DS-01
  lesson is binding:** before finalizing exact CSS the plan MUST audit ALL six CSS
  partials' `@media`/overrides for `.panel` / `.lobby-panel` / `#waiting-room` /
  `.setting-toggle` / `.modal-card` interactions (esp. `05-responsive.css`) — a
  class-based width is `@media`-sensitive where the old centered modal was not.
- **Mobile ≤767px.** `.lobby-stage{flex-direction:column}` → the tile grid (1–2
  columns, smaller `minmax`/`1fr`) on top, the `.director-panel` stacked **below**
  it; the panel returns to mobile width and **must not clip** (content flows / the
  panel or page scrolls) so **Add Bot is always reachable** — this is the fix for
  §1.2. Confirm the lobby `.panel` imposes no `max-height`/`overflow:hidden` that
  clips (the 7.3 `.modal-card{max-height:90dvh;overflow-y:auto}` is modal-scoped,
  not the lobby panel).
- **Animation.** Reuse the existing 7.5/#31 `cardEntrance` on tiles unchanged —
  opacity/transform ONLY (compositor-safe; the vanilla perf budget), auto-zeroed by
  the existing global `prefers-reduced-motion` block in `06-states-anim.css` (NO
  per-rule reduced-motion handling). No new intervals/timers.

## §4 — Zero-regression boundary (the binding proof)

- **UNEDITED & byte-green** (the sacrosanct guard): `client-tests/render-lobby.test.js`
  (`<ul id="lobby-players">`, ONE `<li>` per player, **count == player count — NO
  placeholder seats**, `items[0]` = host with name + 👑, `items[1]` = guest,
  `.btn-kick` on non-host/non-self, `kickPlayer` emit) AND
  `client-tests/red-carpet-render.test.js` (`.entrance-card`, non-empty
  `--card-accent`, non-empty `.entrance-card__emoji`, `.is-entering` diff,
  `.director-panel` present, `#start-btn.roll-camera`, no `stableId` substring in
  `#waiting-room`, team early-return) AND `socket-handlers` / `showScreen` /
  `modal-factory` / `name-prompts` AND all `server/**`.
- **UPDATED via TDD** (7.5's OWN unit suite — legitimately tracks the model
  contract change; this is NOT the guard): `client-tests/red-carpet.test.js` —
  the hash-hue assertions are replaced by slot-palette ones (slot → `SEAT_HUES`;
  8 slots → 8 distinct `accentHue`; determinism; defensive non-finite/negative
  slot; `name/isHost/isYou/isBot/wins/accentEmoji/label` still byte-identical; the
  stableId sentinel still green) + `SEAT_HUES` assertions (length 8 / integers
  0–359 / pairwise-distinct / frozen).
- **NEW additive suite** `client-tests/red-carpet-seat-table.test.js` (jsdom):
  an 8-player render yields **8 distinct `--card-accent` values** (directly pins
  the §1.1 fix); the additive `.lobby-stage` wrapper is present and contains both
  `.players-list-container` and `.director-panel`; team-mode renders no
  `.lobby-stage`/entrance cards (early-return intact).
- Full `npx jest` green & **additive** over the post-#31 baseline (54 suites / 426
  tests); coverage ratchet holds; **zero pre-existing-suite regression**.

> jsdom never lays out or boots a browser — visual/responsive/reduced-motion checks
> (no color collision at 8, Add Bot reachable at 7, desktop sidebar+grid, mobile
> stack, reduced-motion legibility) are explicitly **user-side**.

## §5 — Decomposition (3 linear TDD tasks; shared files → ordered, blockedBy chain)

- **T0 — pure `red-carpet.js`.** Add frozen `SEAT_HUES`; `playerCardModel` takes
  `opts.slot` → palette hue (defensive modulo); rewrite/extend
  `red-carpet.test.js` for the new contract (distinctness/determinism/defensive/
  stableId-sentinel/label-byte-identical). No glue. Verify: `red-carpet.test.js`
  green; full `npx jest` green & additive.
- **T1 — glue + structure + new test.** `ui-render.js` passes `slot:i`;
  `index.html` gains the additive `.lobby-stage` wrapper; new
  `red-carpet-seat-table.test.js`. `render-lobby.test.js` +
  `red-carpet-render.test.js` UNEDITED & green. Verify: both new/updated suites +
  the two guards green; full `npx jest` green & additive.
- **T2 — CSS Seat Table.** `.lobby-stage` flex + sidebar; `#lobby-players` grid;
  `.entrance-card` tile; desktop panel widen; mobile ≤767px stack (Add Bot
  reachable, no clip); cardEntrance reused; NO pre-7.5 rule edited (diff-verified).
  Verify: full `npx jest` green & additive; user-side visual eyeball flagged.

## §6 — Edge cases / error handling

Non-finite or negative `slot` → defensive double-modulo yields a valid hue (never
throws). >8 players unreachable (server caps at 8) but the modulo degrades
gracefully (documented). 0/1 players → grid still valid. Team-mode → early return,
no `.lobby-stage`/tiles built. Reduced-motion → global block zeroes the animation;
tiles fully legible static. Very long names → tile wraps (`overflow-wrap`, as 7.5).

## §7 — Constraints (binding)

Vanilla JS, no build. **CLIENT-ONLY**: no server / socket-event / scoring /
validation / theme-mechanic / Redis / persistence / accounts change (host stays
server-enforced via `player.isHost`; theme stays server-authoritative). Accent
**never** derived from `stableId` (color is now zero-identity — strictly safer).
Team-mode render path **byte-identical** (early-return untouched). Compositor-safe
animation only + reduced-motion via the existing global block; no new
intervals/timers. Pure-seam + barrel + DAG discipline (`red-carpet.js` zero-import
pure; `ui-render.js` thin glue via the direct sibling import; `ui.js` barrel
already re-exports `red-carpet.js` — no barrel change, no import cycle). Every code
change ships a WHY comment. Isolated worktree off `origin/main 9165761`;
branch-verify before every commit. Out-of-scope findings → `spawn_task` chip, never
widen this scope. PR-merge / push-to-main / Render-deploy is classifier-gated →
hand the PR to the user.

## §8 — Guardrails (per-item spec-compliance bar for reviewers)

- **G1 client-only.** The diff touches ONLY `red-carpet.js`, the `ui-render.js`
  glue line, the `index.html` `#waiting-room` additive wrapper, the 7.5-OWN
  `02-hero-lobby.css` section, and the three test files. No server/socket/scoring/
  persistence/theme-mechanic change.
- **G2 no stableId.** Color slot-only; emoji `name+':'+id` only; the model is
  byte-identical with vs without a `stableId` key (sentinel green); no `stableId`
  substring anywhere in `#waiting-room`.
- **G3 zero-regression.** `render-lobby.test.js` + `red-carpet-render.test.js` +
  socket-handlers/showScreen/modal-factory/name-prompts + `server/**` UNEDITED &
  byte-green; `#lobby-players li` count == player count (no placeholder seats).
- **G4 team-mode byte-identical.** No `.lobby-stage`/tiles built in team mode;
  team render path + suites unchanged & green.
- **G5 perf/motion.** `cardEntrance` opacity/transform ONLY; reduced-motion via
  the existing global `06-states-anim.css` block (no per-rule handling); no new
  timers/intervals.
- **G6 no pre-7.5 CSS touched.** Only 7.5's OWN Red Carpet section is reworked +
  new rules appended; `git diff` shows no pre-7.5 rule edited/reordered/removed.
- **G7 seam/barrel/DAG.** `red-carpet.js` pure & zero-import; `ui-render.js` thin
  glue via direct sibling import; `ui.js` barrel unchanged; no import cycle.
- **G8 additive ratchet.** Full `npx jest` green & additive over the post-#31
  54/426 baseline; coverage holds; zero pre-existing-suite regression.

## §9 — Deferrals (recorded, do not widen 7.5.1)

- **Interactive pick-your-own-color** (server-synced, mutually exclusive): the
  **next** sub-phase. It deliberately lifts the client-only guardrail (new
  per-player `color` in room state, a `selectColor` socket event, server-enforced
  mutual exclusion, picker UI) — analogous to the Couch-Mode → Phase-8 carve-out.
  Its own brainstorm → spec → plan → build. The 7.5.1 slot palette is its default.
- **Team-screen Seat-Table parity** — deferred for a future same-style pass (the
  user explicitly wants it eventually); out of scope here to keep the team
  early-return byte-identical.
- **QR scan-to-join** — still deferred (carried from 7.5 §9).
- **Empty placeholder seats** — intentionally never rendered (zero-regression +
  YAGNI).

## §10 — Acceptance criteria (binding; mapped to tasks)

1. `SEAT_HUES` exported & frozen; length 8; every entry an integer in [0,359];
   pairwise-distinct; deterministic. (T0)
2. `playerCardModel(player, {myPlayerId, slot})` → `accentHue =
   SEAT_HUES[safe(slot)]`; 8 distinct slots → 8 distinct hues; defensive for
   non-finite/negative slot; `name/isHost/isYou/isBot/wins/accentEmoji/label`
   byte-identical to 7.5; stableId sentinel green (color zero-identity). (T0)
3. `ui-render.js` passes `slot` = render index (host = seat 0); `--card-accent`
   set; `.is-entering` diff unchanged; `.btn-kick` condition/emit byte-identical;
   team early-return untouched. (T1)
4. `index.html`: additive `.lobby-stage` wrapping `.players-list-container` +
   `.director-panel`; all ids preserved; `#team-screen` untouched. (T1)
5. CSS: desktop Director left sidebar + `#lobby-players` responsive tile grid;
   mobile ≤767px stacked (grid then Director) with Add Bot reachable and no
   clipping; `.entrance-card` a richer tile with the distinct seat color;
   `cardEntrance` reused (compositor-safe; reduced-motion via global block); NO
   pre-7.5 rule edited (diff-verified). (T2)
6. `render-lobby.test.js` + `red-carpet-render.test.js` UNEDITED & green;
   `red-carpet.test.js` updated (slot contract) green; new
   `red-carpet-seat-table.test.js` green (8 distinct accents + `.lobby-stage`
   present + team no-build); full `npx jest` green & additive over the post-#31
   baseline; zero pre-existing-suite regression. (T0–T2)
7. User-side (non-blocking; jsdom never lays out): no two players share a color at
   8 players; Add Bot reachable at 7 players; desktop sidebar+grid; mobile stack;
   reduced-motion legible.

## §11 — Pipeline & sequencing

Base `origin/main 9165761` (post-#30 + #31; reconcile DONE). Worktree
`C:/mm-phase7-5-1` / branch `phase7-5-1-seat-table-redesign` (junctioned). Native
Task tools unavailable → TodoWrite + a hand-authored co-located
`.md.tasks.json` (status synced + committed per task, mirroring 7.5).
Subagent-driven: per-task two-stage review (spec-compliance THEN code-quality, real
fix-loops) + a final opus whole-branch holistic. Branch-verify
(`git -C C:/mm-phase7-5-1 branch --show-current == phase7-5-1-seat-table-redesign`)
before EVERY commit (parallel Codex agent shares the repo). The spec + plan ride to
origin via the PR. PR-merge / push-to-main / Render-deploy is classifier-gated →
hand the PR to the user. Post-merge reconcile mirrors 7.1–7.5 (junction unlink
LINK-ONLY via PowerShell .NET `(Get-Item).Delete()` + Unix `rmdir` for the emptied
parent — NOT `cmd /c rmdir`; the PowerShell tool guards top-level-path
`Remove-Item`). Real-boot/in-browser eyeball is user-side.
