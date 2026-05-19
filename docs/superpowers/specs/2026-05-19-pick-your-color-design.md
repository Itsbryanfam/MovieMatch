# Phase 7.5.3 — Pick-Your-Own-Color (Theater Lobby) — Design Spec

**Status:** APPROVED at the design gate (2026-05-19). Awaiting user spec-review gate.

**Worktree / branch:** `C:\mm-phase7-5-3` / `phase7-5-3-pick-your-color`, off `origin/main = ed6f041` (post-7.5.2-merge). Parallel Codex agent shares the repo → branch-verify (`git -C C:/mm-phase7-5-3 branch --show-current == phase7-5-3-pick-your-color`) before EVERY commit.

---

## §0. Naming

The committed Phase-7 decision-record reserves **7.6** for "Chain Premiere Recap + Share Cards 2.0". This is the seat-color **picker**, the direct continuation of the 7.5.1 collision-fix → 7.5.2 Theater-Lobby seat-color thread, so it is **Phase 7.5.3** (the lobby-color lineage), NOT 7.6. This avoids a numbering collision in specs/memory/roadmap.

## §1. Locked decisions (binding — pinned at the design gate)

1. **Claim-only / free-swatch mutual exclusion.** A player may claim any palette hue that is not currently another player's *effective hue*. Taken swatches render disabled. No swap, no expanded palette. At a full 8/8 table every hue is an effective hue → nothing is claimable; this is the accepted tradeoff (picking is meaningful only when seats are open). 7.5.1 already made colors collision-free; this picker is **preference/expression, not a bug-fix**.
2. **Lazy fallback (no auto-claim on join).** `colorHue` is *absent* until the player explicitly picks. A player who never opens the picker renders **byte-identical to 7.5.2** (`SEAT_HUES[slot]`). The mutex reasons over *effective hue* = explicit `colorHue` if validly set, else `SEAT_HUES[slot]`.
3. **Server-authoritative palette validation via a `server/constants.js` mirror.** `SEAT_HUES` is duplicated as a frozen server constant (the server is CommonJS and cannot import the client ES module). This mirrors the established `setTheme` precedent ("validated against the whitelist so a malicious client can't set garbage"). A test in BOTH the server and the client seam suites pins the exact literal so drift is caught on either side.
4. **`.is-you` indigo override yields to an explicit pick.** Today `.seat.is-you` hard-overrides the chair velvet to fixed indigo, so the local player never sees their own hue — fatal for a picker. The velvet/arm/cushion/piping override block is scoped to `.seat.is-you:not(.has-picked)`; an un-picked "you" stays indigo (**zero regression**). The `.seat.is-you .seat-svg-wrap` halo glow is a *you-identity* cue (not chair color) and is **kept verbatim**.
5. **Scope = waiting-state Theater lobby only.** Team mode is out (the `renderTeamScreen` early-return path is byte-identical — no chairs, no picker). No scoring / gameLogic / validation / theme-mechanic / persistence-schema (beyond the additive `colorHue` field) / accounts / socket-protocol-shape change. Client stays vanilla no-build; server stays CommonJS.

## §2. Background & framing

Post-7.5.1, `red-carpet.js` exports `SEAT_HUES = Object.freeze([350, 25, 45, 140, 188, 220, 270, 312])` and `playerCardModel(player,{myPlayerId,slot})` returns `accentHue = SEAT_HUES[((slot%8)+8)%8]` — a collision-free per-seat hue with **zero identity** (no `stableId`, no per-identity hash). 7.5.2 renders each player as a `<li class="seat occupied">` velvet chair recolored purely via the inherited `--avatar-hue` custom property; `.seat.is-you` overrides to fixed indigo. `MAX_PLAYERS_PER_LOBBY = 8` (`server/constants.js`) and `SEAT_HUES.length = 8` → a perfect bijection: every player in a full lobby already has a distinct, well-separated hue.

The user's original ask (from the live-site 7.5.1 feedback) was an interactive picker. Since 7.5.1 already fixed the *collision*, 7.5.3 is purely about letting a player **express a preference** by claiming a different free seat-hue.

## §3. Contract

### §3.1 Data model (additive, one field)

A new optional per-player field **`colorHue`** on the Redis room player object: an integer that is a member of `SEAT_HUES`, or **absent**. It is a value from a frozen 8-entry palette → carries **zero identity**; the Phase-1 no-`stableId`-leak invariant is structurally preserved (it is NOT derived from any persistent id).

**Effective hue** of the player at room-array index `i` (server `r.players[i]` / client `gameState.players[i]`, same order):

```
effectiveHue(i) = Number.isInteger(p.colorHue) && SEAT_HUES.includes(p.colorHue)
                  ? p.colorHue
                  : SEAT_HUES[((i % 8) + 8) % 8]
```

Worked examples (claim-only consequence):
- 4 players, no picks → effective hues `{SEAT_HUES[0..3]}`; **free = `{SEAT_HUES[4..7]}`** (the four empty-seat hues are claimable).
- 8 players, no picks → effective hues `{SEAT_HUES[0..7]}` = the whole palette; **free = ∅** (nothing claimable — accepted §1.1 tradeoff).
- Player at slot 2 picks `SEAT_HUES[5]` → their effective hue becomes `SEAT_HUES[5]`; `SEAT_HUES[2]` is now free for a claim by anyone whose effective hue isn't already `SEAT_HUES[2]`.

**Accepted known behavior (NOT a 7.5.3 defect):** claim-only guarantees no collision *at claim time*. A subsequent **leave** re-indexes the room array, so an un-picked player's slot fallback can shift into equality with a pinned explicit pick until someone re-picks. This is inherent to lazy-fallback and is exactly the same "fallback hues re-settle when the roster changes" behavior 7.5.2 already exhibits for pure slot hues (picked hues are pinned; only floating fallbacks move). It is low-stakes (a waiting-room chair tint, re-resolvable by any claim) and explicitly in scope as accepted — implementers/reviewers must NOT treat it as a missing requirement or add roster-change re-balancing (YAGNI; would widen the server seam).

### §3.2 Server — `lobbySystem.selectColor` (modeled exactly on `assignTeam`)

`server/constants.js`: add `SEAT_HUES = Object.freeze([350, 25, 45, 140, 188, 220, 270, 312])` with a WHY comment that it **MUST mirror** `public/js/ui/red-carpet.js` (§1.3).

`server/systems/lobbySystem.js`: add (and export in `module.exports`):

```js
// Phase 7.5.3: a player claims a free seat-hue. NON-host self-mutation
// (you only ever recolor yourself — no host check, exactly like assignTeam).
// Claim-only: rejected if the hue is any OTHER player's effective hue
// (explicit colorHue, else SEAT_HUES[their slot]). Server-authoritative
// palette validation (setTheme precedent). RMW under withLobbyLock so a
// concurrent join/settings change can't clobber the write (finding #4).
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

`server/socketHandlers.js`: ONE new wiring block, behind the existing shared host/lifecycle limiter (same cadence class as `assignTeam`); nothing else in the file changes:

```js
on('selectColor', async (data) => {
  if (await lobbyConfigLimited()) return;
  await lobbySystem.selectColor(ctx, socket, data || {});
});
```

`server/gameLogic.js` `toClientState`: **BYTE-IDENTICAL, ZERO edit.** It is `players: state.players.map(({ stableId, ...rest }) => rest)`, so `colorHue` flows to the client automatically via `...rest`. (A test pins: a broadcast carries `colorHue` and never `stableId`.)

### §3.3 Client seam — `public/js/ui/red-carpet.js` `playerCardModel`

`accentHue` becomes prefer-`colorHue`-else-slot (pure, additive, zero-identity, no `stableId`):

```js
const rawSlot = Number.isInteger(opts && opts.slot) ? opts.slot : 0;
const slotHue =
  SEAT_HUES[((rawSlot % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length];
// Phase 7.5.3: an explicitly-picked, in-palette colorHue overrides the
// slot default; anything else (absent / non-int / off-palette) falls back
// to the 7.5.1 collision-free slot hue → un-picked players byte-identical.
const accentHue =
  (Number.isInteger(p.colorHue) && SEAT_HUES.includes(p.colorHue))
    ? p.colorHue
    : slotHue;
```

The returned model gains a boolean **`hasPickedColor`** = `Number.isInteger(p.colorHue) && SEAT_HUES.includes(p.colorHue)` (drives the `.has-picked` class). `accentEmoji` and all other fields are UNCHANGED.

### §3.4 Client render — `public/js/ui/ui-render.js` `renderLobby`

On the local player's OWN occupied seat only (`card.isYou`), append a `.seat-swatches` strip of 8 `<button class="swatch">` (one per `SEAT_HUES[i]`, `i = 0..7`), built with `createElement` + the file's existing no-`innerHTML`-for-anything-dynamic discipline:

- The set of taken hues = every *other* player's effective hue (compute from `gameState.players` exactly as §3.1, excluding the local player's own index).
- A swatch whose hue ∈ taken set OR == the player's own current effective hue → `disabled` + `.is-taken` (current-own → `.is-selected`, not clickable-to-reselect).
- A free swatch click → `getSocket().emit('selectColor', { lobbyId: gameState.id, hue })` (mirrors the existing `.seat-kick` emit discipline; no optimistic local mutation — the next `stateUpdate` is the source of truth).
- Each swatch carries `--avatar-hue: <hue>` inline so its dot color is the same derived `hsl(var(--avatar-hue),…)` family as the chairs (no new color values).
- The occupied `<li>` gets class `has-picked` iff `card.hasPickedColor` (drives §3.5 `.is-you:not(.has-picked)`).

Empty seats, the `.seat-kick` condition + emit payload, the entrance/`entering` machinery, `#seated-count`/`#seated-hint`, the Add-Bot row, `rollCameraLabel`/`#start-btn`, `lobbyCodeDisplay`, the team-mode early-return, and `renderTeamScreen` are all **byte-identical to 7.5.2** (§4).

### §3.5 CSS — `public/css/02-hero-lobby.css`

- **Scope the indigo override (the ONLY edit to existing lines):** `\.seat.is-you {` (the velvet/arm/cushion/piping block, currently lines ~1145–1155) becomes `\.seat.is-you:not(.has-picked) {`. Specificity goes (0,2,0)→(0,3,0); still later than and overrides `.seat.occupied` (0,2,0) when un-picked; when `.has-picked` is present the selector fails to match so `.seat.occupied`’s `--avatar-hue`-derived velvet (the picked hue) applies. **`.seat.is-you .seat-svg-wrap` (the halo glow, ~1158–1160) is NOT touched** (you-identity cue, §1.4).
- **Append-only PHASE 7.5.3 section** (established 7.5/7.5.1/7.5.2 EOF-append convention; no pre-7.5 or non-lobby rule touched): `.seat-swatches` (flex strip, positioned within the local seat), `.swatch` (round dot, color from `hsl(var(--avatar-hue),…)` derived — verbatim family, **no new color values**), `.swatch.is-selected` (ring on the player's current hue), `.swatch.is-taken`/`.swatch[disabled]` (dimmed, `cursor:not-allowed`), focus-visible ring for keyboard a11y. Reduced-motion handled by the EXISTING global `06-states-anim.css` block — NO per-rule `@media(prefers-reduced-motion)` (the 7.5.2 double-handling lesson).

## §4. Behavioural-equivalence contract (must stay byte-identical, re-pinned by tests)

- `gameLogic.toClientState` function body, `broadcastState`, all `server/**` except the new `selectColor` + the `server/constants.js` `SEAT_HUES` add + the one `socketHandlers` `on('selectColor')` block.
- The `.seat-kick` removeBot/kickPlayer emit `{lobbyId:gameState.id,targetId:p.id}` + condition `amIHost && p.id!==myPlayerId` (omitted on own seat).
- Host detection (`.crown`/`is-host`), theme/hardcore/tv wiring + `.ledger-row.on` mirror, mode-chip ids, `#start-btn` `rollCameraLabel` gating, `lobbyCodeDisplay.innerText`, `#seated-count`/`#seated-hint`, the 1400 ms `entering` strip.
- The team-mode render path (`renderLobby` early-return + `renderTeamScreen`) — zero picker/`colorHue` DOM in team mode.
- An un-picked player's chair hue == `SEAT_HUES[slot]` (exactly 7.5.2).
- `socket-handlers`/`showScreen`/`modal-factory`/`name-prompts` suites & sources.

## §5. Zero-regression boundary (the ratchet — redefined as in 7.5.2 §5)

This is a feature addition, not a structural rewrite, so most surfaces stay byte-identical:

- **Byte-identical & green (ratchet):** every file/suite in §4. Diffs vs `ed6f041` for `gameLogic.js` `toClientState` body, `server/socketHandlers.js` (except the one added block), the team path, `socket-handlers`/`showScreen`/`modal-factory`/`name-prompts`, and all unrelated `server/**` MUST be empty.
- **Legitimately updated:** `client-tests/red-carpet.test.js` (the seam's OWN unit suite — extended for the `colorHue` prefer + `hasPickedColor` contract; same legitimacy as the 7.5.1 precedent). `client-tests/render-lobby.test.js`, `client-tests/red-carpet-render.test.js`, `client-tests/red-carpet-seat-table.test.js` extended for the `.seat-swatches` strip + `.has-picked` + the `selectColor` emit + the `.is-you:not(.has-picked)` reconciliation.
- **New tests:** a `lobbySystem.selectColor` server suite (claim a free hue; reject a taken effective hue incl. an un-picked player's slot-fallback; reject off-palette/non-int; reject when `status!=='waiting'`; reject a non-member socket; hue freed when the holder leaves; RMW-under-lock); a `server/constants.js` `SEAT_HUES` literal pin (mirrors the client); a `toClientState` pin (carries `colorHue`, never `stableId`).
- Full `cd C:/mm-phase7-5-3 && npx jest` ends green; suite count rises by the new suites only.

## §6. Task decomposition (3 INDEPENDENT-but-LINEAR TDD tasks; each its own commit)

- **Task 0 — server mutex (blockedBy none).** `server/constants.js` `SEAT_HUES` add; `lobbySystem.selectColor` + `module.exports`; `socketHandlers` `on('selectColor')` wiring; NEW `server/…selectColor` test suite + `constants` `SEAT_HUES` pin + the `toClientState` colorHue/no-stableId pin. `toClientState` body, `socketHandlers` (except the block), other `server/**` byte-identical. Verify: `cd C:/mm-phase7-5-3 && npx jest server` green + the new suite green; full `npx jest` still green (client unaffected — picker not wired yet).
- **Task 1 — client seam (blockedBy [0]).** `red-carpet.js` `playerCardModel` prefer-`colorHue` + `hasPickedColor`; rewrite/extend `client-tests/red-carpet.test.js` to the new model contract (TDD red→green). `ui-render.js`/CSS untouched. Verify: `cd C:/mm-phase7-5-3 && npx jest client-tests/red-carpet.test.js` green; full `npx jest` green; `git diff` of `ui-render.js`/`02-hero-lobby.css` vs `ed6f041` EMPTY.
- **Task 2 — client render + CSS (blockedBy [1]).** `ui-render.js` `.seat-swatches` strip + `selectColor` emit + `.has-picked`; `02-hero-lobby.css` scope `.seat.is-you`→`.seat.is-you:not(.has-picked)` + append-only PHASE 7.5.3 section; extend `render-lobby.test.js`/`red-carpet-render.test.js`/`red-carpet-seat-table.test.js`. Verify: those suites + full `cd C:/mm-phase7-5-3 && npx jest` green; `git diff` confined to the scoped `.is-you` line + the EOF append (no other ≤ pre-7.5.3 CSS hunk); `red-carpet.js`/`server/**` (except Task-0 files) byte-identical. Visual/responsive/reduced-motion + a real two-client claim/disable/reject eyeball flagged user-side (jsdom never lays out / runs a socket).

Ordering: Task 0 → Task 1 `blockedBy [0]` → Task 2 `blockedBy [1]`.

## §7. Binding constraints

Client-only vanilla ES-module no-build (Task 1/2) + Node CommonJS + Socket.io + Redis-TTL room state (Task 0). NO accounts; `colorHue` device-agnostic, room-scoped, frozen-palette → zero identity, never echoes/derives a `stableId` (Phase-1 invariant strictly preserved). Real-boot + in-browser/two-client verification is user-side (jsdom can't lay out or run a live socket). Every code change ships a WHY comment. Isolated worktree; branch-verify before every commit. PR-merge / push-main / Render-deploy is classifier-gated → hand the PR to the user; feature-branch push + `gh pr create` are pre-authorized.

## §8. Guardrails (per-task review bar)

- **G1** `colorHue` is only ever a member of `SEAT_HUES` or absent; never derived from `stableId`/name/socket-id/any persistent id; `toClientState` still strips `stableId`; a test proves a broadcast carries `colorHue` and not `stableId`.
- **G2** `selectColor` is server-authoritative: off-palette / non-int / taken-effective-hue / `status!=='waiting'` / non-member → silent decline (no broadcast), exactly like `assignTeam`/`setTheme`. RMW strictly under `withLobbyLock`.
- **G3** Lazy fallback: a player who never picks renders byte-identical to 7.5.2 (`SEAT_HUES[slot]`); `playerCardModel` stays pure & zero-identity; `red-carpet.js` exports unchanged except the additive prefer-logic + `hasPickedColor`.
- **G4** Team-mode render path byte-identical; zero picker/`colorHue` DOM in team mode; `renderTeamScreen` untouched.
- **G5** `.is-you` reconciliation: ONLY the velvet/arm/cushion/piping `.seat.is-you` block is scoped to `:not(.has-picked)`; the `.seat-svg-wrap` glow is verbatim; un-picked "you" is pixel-identical to 7.5.2; CSS is append-only otherwise; no new color values; no per-rule reduced-motion.
- **G6** `server/constants.js` `SEAT_HUES` exactly equals the `red-carpet.js` literal; pinned by tests on both sides.
- **G7** `socketHandlers.js` diff vs `ed6f041` = exactly the one `on('selectColor')` block; rate-limited via the existing shared host/lifecycle bucket; no new bucket unless justified.
- **G8** The §4/§5 byte-identical set is provably empty-diff; full `npx jest` green; new suites are additive.

## §9. Data flow / lifecycle

Click free swatch → `emit('selectColor',{lobbyId,hue})` → rate-gate → `lobbySystem.selectColor` validates + RMW under `withLobbyLock` → `broadcastState` → `toClientState` (spreads `colorHue`) → every client's `stateUpdate` → `renderLobby` → `playerCardModel` prefers `colorHue` → `--avatar-hue` recolors the chair + `.has-picked` lifts the `.is-you` indigo for the picker. Lifecycle: `colorHue` lives on the Redis room player object (room TTL); freed automatically when the player is filtered out of `r.players` on leave/kick; survives refresh/reconnect for free because `rejoinLobby` preserves the player object and only swaps `socket.id`. No new persistence keys, no schema migration (additive optional field; older serialized rooms simply lack it → lazy fallback).

## §10. Acceptance criteria

1. A player clicks a free swatch on their own seat → all clients recolor that chair to the chosen hue within one `stateUpdate`; the picker sees their own pick (indigo override lifted).
2. Taken hues (incl. un-picked players' slot fallbacks) render disabled; clicking one is a no-op; a raced/forged taken/off-palette/non-waiting/non-member claim is server-declined and the next `stateUpdate` re-paints truth.
3. A player who never opens the picker is byte-identical to 7.5.2 everywhere (chair, emoji bubble, spotlight, indigo "you").
4. Leaving frees the hue; refresh/reconnect preserves it; team mode shows no picker and is byte-identical.
5. `colorHue` never co-travels with `stableId`; `server/constants.js` `SEAT_HUES` == client literal (both pinned).
6. §4/§5 byte-identical set diffs empty vs `ed6f041`; full `cd C:/mm-phase7-5-3 && npx jest` green; new suites additive.

## §11. Pipeline

writing-plans (no-placeholder 3-task plan + co-located `.md.tasks.json`) → subagent-driven-development (per-task two-stage review: spec-compliance THEN code-quality, real fix-loops; `.tasks.json` status synced + committed per task) → final opus whole-branch holistic → finishing-a-development-branch (Option 2: feature-branch push + `gh pr create --base main`, hand the PR to the user; PR-merge/Render-deploy classifier-gated). Post-merge reconcile owed (mirror 7.1–7.5.2): ff local main → merge commit; `C:\mm-phase7-5-3\node_modules` junction unlink link-only via PowerShell .NET `(Get-Item …).Delete()`; verify shared `C:\moviematch-git\node_modules` 359; worktree remove + prune; `git branch -d phase7-5-3-pick-your-color`; flip memory. Each commit branch-verified.
