# Phase 7.6 — Chain Premiere Recap + Share Cards 2.0: Design Spec

**Date:** 2026-05-19
**Status:** Approved at the design gate (brainstorming) — proceeding to writing-plans after the spec-review gate.
**Phase:** **7.6** (signature; effort L) of the committed Phase 7 UI/UX Elevation decision-record (`docs/superpowers/specs/2026-05-17-phase7-uiux-elevation-design.md` §2.7.6). One sub-phase = one spec → plan → subagent build → PR.
**Branch / worktree:** `phase7-6-chain-premiere-recap` in isolated worktree `C:\mm-phase7-6`, off `origin/main` `ed6f041` (post-7.5.2-merge). **Not** stacked on PR #34 (7.5.3, open) — 7.6 is a different feature area (post-game, not lobby). `node_modules` junctioned to `C:\moviematch-git\node_modules` (shared, 359 entries) so jest resolves. A parallel Codex agent shares the repo → branch-verify `git -C C:/mm-phase7-6 branch --show-current == phase7-6-chain-premiere-recap` before **every** commit.

---

## 0. Naming & provenance

This is **7.6**, not 7.7+. Decision-record §2.7.6: *"cinematic end-sequence (posters slide, actor links flip, elimination beats, winner billing) + collectible share artifacts (poster card, emoji grid, 'I survived N links'). Subsumes Pass2 #4/#5; Pass1 RS-01/RS-02. **Reuse:** build the chain-choreography engine once here; 7.9 Post-Game Trailer reuses it."* Effort **L**, signature, with the §3.4 perf-budget + §3.3 real-boot guardrails binding.

Scope was decomposed at the design gate (the validated 7.4/7.5 pattern — 7.4: 5 items → 3; 7.5: deferred QR/team-parity) to **Approach A**: the reusable choreography engine + the cinematic end-sequence + a **focused, additive** Share Cards 2.0. The poster-card-studio / multi-artifact switcher / per-variant download / audio-beyond-`playSfx` / elimination-fidelity-beyond-real-state are **explicitly deferred** (§12) so the signature surface is built **once**, perf-safe, on a bounded reviewable slice — not gold-plated large on a vanilla no-build mobile stack.

---

## 1. Locked decisions (binding on the plan, implementers, reviewers, holistic)

1. **The chain-choreography engine is a pure, deterministic, zero-import seam** — the validated `red-carpet.js` pattern: a pure function produces a **storyboard** (ordered timed beats) from finished game state; it owns **no DOM, no timers, no `Date.now()`, no randomness**. It is unit-tested in its **own new additive suite** (the 7.5.1/7.5.2/7.5.3 seam-suite precedent — legitimately new, not a guard rewrite). 7.9 Post-Game Trailer reuses the storyboard producer **unchanged** — this is the build-once mandate and the load-bearing architectural invariant.

2. **The recap plays in a dedicated additive overlay** (`#recap-overlay`, mirroring the existing `#share-modal` `.modal-overlay` system) — **not** by mutating the live chain board or the static `.game-over-banner`. The live board + the banner stay untouched, which is the cleanest zero-regression story and maps directly to how 7.9 will reuse the player.

3. **`showGameOverBanner()`'s terminal DOM is byte-identical to today** — same structure, same ids (`#share-results-btn`, `#play-again-btn`), same winner-branch text, same `chainDisplay` append + idempotence guard. The recap is a purely additive layer that **settles into** that unchanged end-state. This is the §4/§5 hinge.

4. **Lazy / fail-soft, no fabrication.** Beats are emitted **only** from fields the finished state actually carries. Elimination beats are best-effort: emitted only if a real per-link elimination marker exists in state; if absent, simply **not emitted** (intro→links→bridges→finale still works) — never fabricated, mirroring the 7.1 best-effort/fail-closed discipline. The exact state field(s) are pinned during writing-plans from a fresh read of the finished-state shape at the branch base.

5. **Zero identity / stableId-safe.** Storyboard, emoji grid, and the "survived N links" line use **`playerName` / `state.winner.name` / integer counts only** — never `stableId`, socket id, or any identifier. A sentinel test pins this (the `red-carpet.js` no-stableId precedent + the Phase-1 daily-leaderboard security fix).

6. **Daily mode → recap overlay suppressed.** The Daily-result modal (`renderDailyResult`, fired one-shot from `socketClient.js` on the `justFinished` edge, already carrying `chain` + its own "▶ Replay") remains the sole end-of-game surface in Daily. Two competing end modals is a real UX + contract risk. Recorded decision.

7. **Client-only.** Zero `server/**`, zero `gameLogic`, zero socket-protocol/event change. No new socket event. No `innerHTML` for dynamic/user-derived content (DOM APIs only — the established XSS discipline).

8. **Perf budget (§3.4) is binding:** compositor-only `transform`/`opacity` animation via classes, auto-neutralized by the **existing** global `@media (prefers-reduced-motion: reduce)` block in `06-states-anim.css:413` — **no new per-rule `@media`**, no new colour values beyond the existing palette/derive families; `setTimeout`-chained schedule (the proven `ui-panels.js` replay pattern, leak-safe stored handle); beat count capped by reusing `selectChainEntries()`; total sequence ≤ ~13s; **Skip always available**; reduced-motion/no-`matchMedia` short-circuits to the instant settled end-state (belt-and-suspenders: CSS zeroes the animation, JS skips the wait).

---

## 2. Current baseline (the "1.0" — what exists at `ed6f041`)

- **End-game recap = `showGameOverBanner(state, myPlayerId)`** — `public/js/ui/ui-render.js` L865–930. Builds a *static* `.game-over-banner` (`.game-over-title` winner line + `.game-over-subtitle` subline + `.game-over-actions` → `#share-results-btn` "🎬 Share Results" always, `#play-again-btn` "↩ Play Again" host-only), appended into `chainDisplay`, then `chainDisplay.scrollTop = scrollHeight`. Winner branching: solo-complete / solo-over / team-win / winner / no-winner ("🎬 Game Over!"). Called from `renderGame` L843–848: `else { inputArea.classList.add('disabled-area'); turnIndicator.innerText = 'Game Over'; if (!chainDisplay.querySelector('.game-over-banner')) showGameOverBanner(gameState, myPlayerId); }` — render-idempotent (appended once).
- **One-shot finished edge** — `public/js/ui/socketClient.js`: `else if (state.status === 'finished')` (L436) → `renderGame(...)` (L439); `const justFinished = prevState?.status === 'playing' && state.status === 'finished';` (L446). The Daily block L447–499 already uses this edge one-shot (snapshots `state.chain.slice()`, polls the leaderboard, calls `renderDailyResult({…, chain})`).
- **Share 1.0 = `public/js/ui/ui-sharecard.js`** (pure, 255 lines): `generateShareCard(state)` (static 600×720 canvas — header, curated chain list, winner billing, site-url footer), `scoreChainEntry(item,i,chain)` (L183), `selectChainEntries(chain)` (L214, MAX=7 highlight curation + `skipped` count), `buildTextRecap(state)` (L243, plaintext), `openShareModal(gameState)` (L233, `document.fonts.ready` → draw → unhide `#share-modal`), `truncate`, `roundRect`. Display-names only — **already stableId-safe**.
- **Share modal markup** — `public/index.html` L548–563: `#share-modal.modal-overlay.hidden` → `.modal-card.share-modal-card` → `#close-share-modal` → `.modal-title`/`.modal-subtitle` → `.share-canvas-wrapper`>`#share-canvas.share-canvas-preview` → `.share-modal-actions` (`#download-card-btn`, `#copy-card-btn`).
- **Reusable beat primitive** — `public/js/ui/ui-panels.js` L88–95: a `tick`-based staggered reveal (`setTimeout(tick, stepMs)`, `playSfx('success')`, initial `setTimeout(tick, 200)`) of `_buildReplayEntry(item,i,all)` nodes (L101–154: poster via `attachPosterFallback` designed-placeholder fallback + player name + title/year + `↔ via <actor>` connector for index>0). Consumed by the Daily-result modal "▶ Replay".
- **Chain entry shape (client, at finish):** `{ playerName, movie:{ title, year, poster (https://image.tmdb.org/… or absent), mediaType, cast:[…] }, matchedActors:[<connecting actor>, …] }`. `state.winner` shape (per `showGameOverBanner`/sharecard): `{ name, score, chainLength, isSolo, isTeamWin, players:[names], isDaily, date, puzzleNumber }` (fields present per mode). Posters carry real TMDB URLs → the cinematic "posters slide" is feasible from existing data.
- **No dedicated existing unit suite** references sharecard / `showGameOverBanner` / game-over-banner / recap (verified by grep over `client-tests/`). The zero-regression proof for those is therefore **source byte-identical (`showGameOverBanner` terminal DOM, `ui-sharecard.js` existing exports' behaviour) + the broad suite green**, plus the new additive seam suites — not a kept-green dedicated guard. `client-tests/render-chain.test.js`, `socket-handlers.test.js`, `showScreen.test.js`, the lobby suites, and all `server/**` stay byte-identical & green. Exact line ranges are re-pinned from a fresh read at the branch base during writing-plans.

---

## 3. The contract / architecture

### 3.1 The storyboard beat schema (the reuse interface — frozen)

`buildRecapStoryboard(state)` → an ordered `Array<Beat>`. Each `Beat` is a pure plain-data descriptor:

```
Beat = {
  type:    'intro' | 'link' | 'bridge' | 'skipped' | 'elimination' | 'finale',
  index:   <integer>,            // beat ordinal (0-based)
  atMs:    <integer>,            // deterministic start offset from sequence start
  durMs:   <integer>,            // deterministic on-screen duration
  payload: { … }                 // type-specific, see below
}
```

- `intro` — `payload: { title, chainCount }` (e.g. "Chain of N connections"; `chainCount = state.chain.length`).
- `link` — one per **curated** chain entry (the `selectChainEntries()` subset, §3.2). `payload: { idx, playerName, title, year, poster|null, isSeed: idx===0 }`.
- `bridge` — between consecutive curated links where the later entry has a connecting actor (idx>0, `matchedActors[0]` present). `payload: { actor }`.
- `skipped` — its own beat type, emitted at most once (only if the chain was curated down, i.e. `selectChainEntries().skipped > 0`): a single "+N more connections" beat. `payload: { skipped }`.
- `elimination` — best-effort (§1.4): only if real state carries a per-link knockout marker. `payload: { playerName }`. Omitted entirely if no reliable field exists.
- `finale` — `payload` computed by the **exact same branching as `showGameOverBanner`** (solo-complete / solo-over / team-win / winner / no-winner): `{ kind, winnerLine, subLine }`, so the settled end-state text is behaviour-equivalent to the 1.0 banner.

Timing is deterministic: `atMs`/`durMs` derived from beat ordinal × frozen per-type duration constants (no clock, no RNG); total ≤ ~13s by construction because the link count is bounded by `selectChainEntries()` (MAX 7 highlights + first + last + a single "+N more"). Pure ⇒ fully unit-testable.

### 3.2 `public/js/ui/chain-recap.js` (NEW — pure, zero-import)

Exports `buildRecapStoryboard(state)` (and any small pure helpers it needs). **DRY:** it imports nothing; the curation reuses the **same algorithm** as `selectChainEntries()`/`scoreChainEntry()`. To keep `chain-recap.js` zero-import (the `red-carpet.js` purity invariant) **and** DRY, `selectChainEntries`/`scoreChainEntry` are *moved verbatim* into `chain-recap.js` and **re-exported from `ui-sharecard.js`** (so `ui-sharecard.js`'s public surface is byte-stable for its existing importers — it imports them back and re-exports under the same names). The plan pins this move as a behaviour-preserving relocation with a parity test (the relocated functions produce identical output for the existing fixtures). *(If the plan's fresh read shows a cleaner DRY boundary, it may instead keep the functions in `ui-sharecard.js` and have `chain-recap.js` receive the curated entries via its caller — decided in writing-plans; either way zero-import purity of the engine and byte-stable sharecard exports are non-negotiable.)*

### 3.3 `public/js/ui/recap-player.js` (NEW — thin DOM driver)

`playRecap(state, mountEl, { onDone, prefersReducedMotion } = {})`:
- Calls `buildRecapStoryboard(state)`; if `prefersReducedMotion` (caller passes `window.matchMedia('(prefers-reduced-motion: reduce)').matches`) or the storyboard has no animated beats → render the **settled end-state immediately** and `onDone()` — no timers.
- Otherwise schedules beats via a single recursive `setTimeout(tick, …)` chain (the `ui-panels.js` pattern), storing the handle so it is cancellable; renders each beat into `#recap-overlay` with **compositor-only** `transform`/`opacity` classes; posters use `attachPosterFallback` (existing designed placeholder).
- **Skip** control → cancel the timer, render the settled end-state, `onDone()`. **Replay** control → re-run from beat 0.
- The settled end-state is purely the overlay's terminal frame; it does **not** alter the underlying `.game-over-banner` (which `showGameOverBanner` already rendered, unchanged).
- **Real-boot/browser gate:** jsdom cannot lay out, run the rAF/`setTimeout` cinematic meaningfully, or evaluate `matchMedia` — the in-browser eyeball (motion fidelity, mobile, reduced-motion legibility, Skip/Replay, Daily non-double) is user-side and flagged in §10.

### 3.3.1 Wiring (one-shot, additive)

`showGameOverBanner()` stays byte-identical (§1.3). The recap is kicked off **once** on the `playing→finished` edge, gated by Daily-suppression (§1.6) and a played-flag so stateUpdate re-fires never replay — mirroring the existing Daily one-shot. The exact insertion point (in the `socketClient.js` finished/`justFinished` block, or a thin `ui-render.js` seam invoked from it) and the played-flag mechanism are pinned in writing-plans from a fresh read; the binding constraint is: **fires exactly once per finished transition, never in Daily, never on re-render, and `showGameOverBanner`'s output is unchanged whether or not the recap plays.**

### 3.4 Share Cards 2.0 — focused, additive (`ui-sharecard.js`)

Additive only — existing `generateShareCard`/`buildTextRecap`/`openShareModal`/`truncate`/`roundRect` behaviour byte-stable for the no-2.0 path; the existing `#share-modal` markup, the Share button, the modal wiring **unchanged**:
1. `buildEmojiGrid(state)` (NEW pure export) → a compact spoiler-free strip, one emoji per curated link encoding the signal `scoreChainEntry()` already computes (normal / high-score "spicy" / final), **no titles, no identifiers** (Framed/Wordle-style — shareable without spoiling). Appended to `buildTextRecap`'s output **and** drawn as a strip on the existing canvas (reusing `generateShareCard`'s existing `COLORS` palette — **no new canvas colour value**; the emoji glyphs themselves carry the colour).
2. "I survived N links" personal line (NEW pure helper) → derived from finished state (chain length reached / the player's own contribution count), **display-name + integer only**. Added to the canvas + text recap.
3. Single canvas, single modal — **no** variant switcher, **no** per-variant download (deferred §12).

---

## 4. Behavioural-equivalence statement

For any finished game, with the recap **skipped or under reduced-motion**, the user-visible end state is **behaviour-equivalent to the 1.0**: the same `.game-over-banner` (same ids, same winner-branch text, same actions, same `chainDisplay` placement/scroll) is present, and the share modal/card/text for the no-2.0 fields is byte-equivalent. The recap adds an **additive, skippable, reduced-motion-safe** overlay layer and the emoji-grid/survived-line are **additive** blocks. No existing end-of-game behaviour is removed or altered. Daily mode is byte-identical to 1.0 (recap suppressed).

---

## 5. Zero-regression ratchet (§5 redefined for a feature ADDITION over a baseline)

**Byte-identical / behaviour-equivalent (the proof surface), vs `ed6f041`:**
- `public/js/ui/ui-render.js` `showGameOverBanner` terminal DOM + `renderGame`'s game-over branch — byte-identical (the only allowed `ui-render.js` change, if any, is the additive one-shot seam call in §3.3.1, isolated and reviewed; the lobby render path / `renderLobby` / team path / `renderTeamScreen` untouched).
- `public/js/ui/ui-sharecard.js` existing exports' behaviour (existing-fixture parity test green; the §3.2 relocation is behaviour-preserving and parity-pinned).
- All `server/**`, `gameLogic`, socket protocol — **byte-identical** (client-only sub-phase; no new event).
- `client-tests/render-chain.test.js`, `socket-handlers.test.js`, `showScreen.test.js`, the lobby suites (`red-carpet*.test.js`, `render-lobby.test.js`), all `server/**` suites — byte-identical & **green**.
- `socket-handlers` / `showScreen` / `modal-factory` / `name-prompts` paths — byte-identical.

**Legitimately new / additive (not a guard rewrite):**
- New: `public/js/ui/chain-recap.js` + `client-tests/chain-recap.test.js`; `public/js/ui/recap-player.js` + `client-tests/recap-player.test.js`; new `ui-sharecard` 2.0 tests (emoji grid + survived-line + stableId-safe sentinel + relocation parity).
- Additive: `#recap-overlay` skeleton in `index.html` (sibling of `#share-modal`, after L564); append-only recap CSS (structural → `04-modals.css` mirroring `.modal-overlay`/`.share-modal-card`; keyframes/animation classes → `06-states-anim.css` so the existing `:413` global reduced-motion block neutralizes them — **no new `@media`, no new colour values, no pre-existing rule edited**); the additive one-shot seam call (§3.3.1).

Full `cd C:/mm-phase7-6 && npx jest` green at every task boundary (additive over 7.5.2's 55/437 baseline at `ed6f041`; 7.5.3's +2/+22 rides PR #34 separately and is **not** in this branch's base).

---

## 6. Decomposition — 3 linear TDD tasks (finalized in writing-plans)

- **Task 0 — pure engine.** `chain-recap.js` `buildRecapStoryboard` + the §3.2 DRY relocation (with `ui-sharecard.js` re-export shim, byte-stable public surface) + `client-tests/chain-recap.test.js` (beat schema/order, deterministic timing, `selectChainEntries` cap reuse, `finale`==`showGameOverBanner`-branch parity, elimination best-effort/omitted-when-absent, **zero-identity sentinel**, relocation parity). No DOM. `server/**` untouched. Verify: `cd C:/mm-phase7-6 && npx jest client-tests/chain-recap.test.js` green → then full `npx jest` green.
- **Task 1 — driver + overlay + wiring** (blockedBy 0). `recap-player.js` `playRecap` + `#recap-overlay` skeleton in `index.html` (additive sibling) + append-only recap CSS (`04-modals.css` structural + `06-states-anim.css` keyframes) + the §3.3.1 one-shot wiring (Daily-suppressed, played-flag, never on re-render) + `client-tests/recap-player.test.js` (mount, Skip→settled end-state, reduced-motion short-circuit, one-shot guard, Daily-suppression, poster fallback). `showGameOverBanner` terminal DOM byte-identical; `render-chain`/`socket-handlers`/`showScreen` byte-identical & green. Verify: full `npx jest` green + the diff-gate (only the additive seam call in `ui-render.js`/`socketClient.js`; CSS append-only; index.html additive sibling).
- **Task 2 — focused Share 2.0** (blockedBy 1). `buildEmojiGrid` + survived-line additive in `ui-sharecard.js` (canvas + text), existing exports byte-stable, modal/button wiring unchanged + extended sharecard tests. Verify: full `npx jest` green + the diff-gate (sharecard additive-only; `#share-modal` markup unchanged).

Each task: TDD red→green, every code change ships a WHY comment, branch-verify before every commit, then spec-compliance review → real fix-loop → code-quality review → real fix-loop → mark complete + sync `.tasks.json` (own follow-up commit). Then final opus whole-branch holistic = GO bar (every §4/§5 byte-identical surface provably empty-diff; G1–G8 evidenced; client/engine reuse-seam clean; full suite green; §10 met) → finishing-a-development-branch Option 2.

---

## 7. Cross-cutting guardrails (decision-record §3, restated as binding here)

No accounts (recap/share device-local, room-scoped, display-name only). Daily-leaderboard `stableId` security preserved (§1.5 sentinel). Real-boot + in-browser gate (§3.3 — render path post-finish; user-side eyeball flagged §10). Perf budget (§3.4). 6b/6c untouched. Pipeline & branch safety (§ branch line; isolated worktree; parallel Codex agent; per-task two-stage review + opus holistic; PR-merge/push-main/Render-deploy classifier-gated → handed to the user). Every code change ships a WHY comment. Out-of-scope review findings → `spawn_task` chip, never widen 7.6.

---

## 8. Guardrails G1–G8 (each must be evidenced by the opus holistic)

- **G1** — `chain-recap.js` is pure & zero-import; `buildRecapStoryboard` deterministic (no DOM/timers/clock/RNG); produces the §3.1 schema; 7.9-reusable. Its suite proves it.
- **G2** — Zero identity: storyboard/emoji-grid/survived-line never carry `stableId`/socket-id/any identifier; sentinel test green; Phase-1 daily security intact.
- **G3** — `showGameOverBanner` terminal DOM (ids/text/branching/placement/scroll) byte-identical vs `ed6f041`; behaviour-equivalence (§4) holds skipped/reduced-motion.
- **G4** — Client-only: `server/**`, `gameLogic`, socket protocol byte-identical; no new socket event; lobby/team render paths untouched.
- **G5** — CSS append-only: no pre-existing rule edited; structural in `04-modals.css`, animation in `06-states-anim.css`; **no new `@media`** (the existing `:413` global reduced-motion block neutralizes); no new colour values; compositor-only transform/opacity.
- **G6** — Daily-mode recap suppressed (the Daily-result modal is the sole Daily end surface); proven by test.
- **G7** — One-shot: recap fires exactly once per `playing→finished`, never on stateUpdate re-fire, leak-safe cancellable timer; `ui-sharecard.js` existing exports byte-stable (relocation parity green).
- **G8** — Perf budget: beat count `selectChainEntries`-capped, total ≤ ~13s, Skip always available, reduced-motion/no-`matchMedia` short-circuits to instant end-state; full `npx jest` green at every task boundary.

---

## 9. Acceptance criteria (the binding bar — §10 of the gate)

1. `buildRecapStoryboard(state)` returns the §3.1 ordered beat schema, deterministic, zero-import/pure, `selectChainEntries`-capped, `finale` parity with `showGameOverBanner` branching, elimination omitted when state lacks the marker, zero-identity (sentinel green).
2. `playRecap` plays in `#recap-overlay` (additive sibling); Skip & Replay work; reduced-motion / no-`matchMedia` → instant settled end-state; one-shot per finished edge; Daily-suppressed; poster fallback via `attachPosterFallback`; leak-safe.
3. `showGameOverBanner` terminal DOM byte-identical; behaviour-equivalence (§4) holds; `render-chain`/`socket-handlers`/`showScreen`/lobby suites/`server/**` byte-identical & green.
4. Share 2.0: `buildEmojiGrid` (spoiler-free, no titles/identifiers) + "survived N links" (display-name+int) additive on canvas + text recap; existing sharecard exports byte-stable; `#share-modal` markup + Share button + modal wiring unchanged.
5. CSS append-only, no new `@media`/colours, compositor-only, existing global reduced-motion block neutralizes; index.html change is the additive `#recap-overlay` sibling only.
6. Full `cd C:/mm-phase7-6 && npx jest` green (additive over the `ed6f041` 55/437 baseline); G1–G8 evidenced; opus holistic = GO.
7. **User-side (non-blocking, flagged — jsdom can't lay out / run timers / matchMedia):** the cinematic sequence on desktop + mobile; reduced-motion legibility (static, readable, no blank wait); Skip/Replay; that Daily mode shows the Daily modal and **no** recap overlay (no double); the emoji grid + survived-line render correctly in the share modal and copy/text export.

---

## 10. Pipeline

spec (this doc) → writing-plans (3 linear TDD tasks, co-located `.md.tasks.json`) → subagent-driven-development (per-task implementer sonnet, TDD red→green, WHY comments, branch-verify before every commit; spec-compliance review sonnet + real fix-loop; code-quality review sonnet + real fix-loop; mark complete + sync `.tasks.json` as its own commit) → final **opus** whole-branch holistic (the §4/§5 byte-identical ratchet + G1–G8 + §9 acceptance + full `npx jest` green is the GO bar; NO-GO → real fix-loop + opus re-review until GO) → finishing-a-development-branch **Option 2** (feature-branch push + `gh pr create --base main`; PR-merge / push-to-main / Render-deploy is classifier-gated → handed to the user; worktree PRESERVED until the user merges; post-merge reconcile owed, mirroring 7.1–7.5.2 — ff local main → merge commit, `C:\mm-phase7-6\node_modules` junction unlink LINK-ONLY via PowerShell .NET `(Get-Item -LiteralPath … -Force).Delete()` NOT `cmd /c rmdir`, verify shared `node_modules` 359, `git worktree remove` + prune, `git branch -d phase7-6-chain-premiere-recap`, flip project memory).

---

## 11. Explicitly out of scope / deferred (recorded — never widen 7.6)

- **Poster-card-studio / multi-artifact share switcher / per-variant download** → 7.9-adjacent; the single existing canvas + the additive emoji-grid/survived-line is the focused 2.0.
- **Post-Game Trailer** (the longer choreographed share-video-ish piece) → that is **7.9**, which **reuses** this engine's storyboard — explicitly out here.
- **Audio beyond the existing `playSfx('success')`** → out (perf/scope).
- **Elimination-beat fidelity beyond what finished state already carries** → best-effort only (§1.4); richer elimination cinematics → 7.9-adjacent / review-time `spawn_task`.
- **Any `server/**` / socket / gameLogic / scoring / persistence change** → permanently out of 7.6 (client-only sub-phase).
- **Team-screen / spectator recap parity** → not in 7.6 (mirrors the 7.5 team-parity deferral); recorded.
