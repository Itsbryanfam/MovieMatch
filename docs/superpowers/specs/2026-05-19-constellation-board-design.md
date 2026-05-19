# Phase 7.7 — Constellation Board + Save Moment + Per-Turn Motion Timeline: Design Spec

**Date:** 2026-05-19
**Status:** Approved at the design gate (brainstorming) — proceeding to writing-plans after the spec-review gate.
**Phase:** **7.7** (core game-feel; effort L) of the committed Phase 7 UI/UX Elevation decision-record (`docs/superpowers/specs/2026-05-17-phase7-uiux-elevation-design.md` §2.7.7). One sub-phase = one spec → plan → subagent build → PR.
**Branch / worktree:** `phase7-7-constellation-board` in isolated worktree `C:\mm-phase7-7`, off `origin/main` `20f4c95` (post-7.6.3/PR-#38-merge — everything through 7.6.3 merged + reconciled). `node_modules` junctioned to `C:\moviematch-git\node_modules` (shared, 359 entries) so jest resolves. A parallel Codex agent shares the repo → branch-verify `git -C C:/mm-phase7-7 branch --show-current == phase7-7-constellation-board` before **every** commit.

---

## 0. Naming & provenance

This is **7.7**. Decision-record §2.7.7: *"render the chain as connected poster nodes with actor bridges (current node glows; eliminated players leave 'burned' stamps); clutch-save juice for fast valid answers; one reusable per-turn motion timeline (handoff→think→submit→reveal→impact). Subsumes Pass2 #3/#12; Pass1 CG-02/CG-04/MT-01; resolves MO-01 (the compact turn treatment becomes the mobile sticky strip). Gate: submitMovie/render path → real-boot + in-browser; explicit perf budget (vanilla no-build, mobile), honor existing `prefers-reduced-motion`."* Effort **L**, core game-feel, with the §3.3 real-boot + §3.4 perf-budget guardrails binding.

Scope was set at the design gate (visual companion, validated 7.4/7.5/7.6 decomposition pattern). The locked shape: a **horizontal filmstrip** in-game chain (length-aware reel + hero now-playing + full-name full-cast panel), a **clutch-only Save Moment**, and **one reusable pure per-turn motion timeline**. The spectator/Audience board view (7.8), any post-game recap surface (7.6, shipped), Daily-specific treatment, and any server/cast-trim change are **explicitly deferred** (§11) so the signature in-game surface is built **once**, perf-safe, on a bounded reviewable slice.

---

## 1. Locked decisions (binding on the plan, implementers, reviewers, holistic)

1. **Layout = horizontal filmstrip, length-aware.** The in-game chain renders as a left→right film reel of poster nodes joined by labeled actor-bridge connectors; the newest movie is a larger, glowing **hero "now-playing"** frame at the leading (right) edge. The reel is a **centered** flex row when its content fits the board (no lopsided void at short chain lengths, including the 1-movie opening, which reads as a centered "feature presentation"); it **switches to fill + horizontal scroll** when content width exceeds the board, with the newest node pinned at the right edge and older nodes fading off the left. Decision-record §2.7.7 "connected poster nodes with actor bridges; current node glows."

2. **Cast = full names, all members, prominent, ungated.** The now-playing movie's cast renders as a **prominent full-width panel below the reel**: **every** cast member the chain entry carries (server-trimmed to the top ~30, billing order — `matchSystem.js` `validMatch.cast.slice(0, 30)`), **full names, never abbreviated**, all visible at once — **no auto-scroll, no manual-scroll, no expand/“show more” gate, no first-name abbreviation**. This is behaviour-identical to today's card cast (same data, same prominence) and is the §4 hinge: the cast is the per-turn actionable element (the next player scans it to pick a link), so abbreviating or gating it is a real gameplay regression and is forbidden. On mobile the same full-name cast wraps full-width exactly as today (the page scrolls; the cast itself does not).

3. **Save Moment = clutch only.** A **pure predicate** decides a "clutch save": a *valid* answer that lands while the turn timer is inside the **existing `timer-panic.js` panic window**. Treatment: a **focused** accent burst on the just-landed hero node + a brief "CLUTCH SAVE" word-mark near the timer + reuse of the existing `playSuccess()` SFX (no new asset). It is **not** screen-wide, no confetti, ≤ ~900ms, and **never fires outside the panic window** (rarity is the point — no juice fatigue, consistent with the refined Theater language). Decision-record §2.7.7 "clutch-save juice for fast valid answers"; Pass2 #12.

4. **One reusable pure per-turn motion timeline.** A pure, deterministic, zero-import producer returns the ordered per-turn phase schedule (`handoff → think → submit → reveal → impact`) as plain timed data; the thin DOM driver consumes it. The producer owns **no DOM, no timers, no `Date.now()`, no randomness** — the validated `red-carpet.js` / `chain-recap.js` seam. It is the load-bearing reuse invariant ("one reusable per-turn motion timeline", decision-record §2.7.7).

5. **Best-effort burned stamp, no fabrication.** An eliminated player's node gets a charred "burned" stamp **only if** the finished/live state actually carries a per-link elimination marker; if absent, no stamp is drawn (the reel still renders fully). Never fabricated — the exact state field is pinned in writing-plans from a fresh read of the chain-entry shape at the branch base, mirroring the 7.6 §1.4 / 7.1 best-effort/fail-closed discipline.

6. **Zero identity / stableId-safe.** The filmstrip, the bridge labels, the cast panel, the clutch treatment, and the motion timeline use **`playerName` / display strings / integer counts only** — never `stableId`, socket id, or any identifier. A sentinel test pins this (the `red-carpet.js` no-stableId precedent + the Phase-1 daily-leaderboard security fix). The pre-7.7 chain render already carries zero identity; this is strictly preserved.

7. **`showGameOverBanner()` + the `renderGame` game-over branch are byte-identical to today.** 7.7 transforms only the `renderChainItems` body. `renderChainItems` (now the filmstrip) renders the chain in **all** states exactly as today (it is called from `renderGame` regardless of status); `showGameOverBanner` **independently and additively** appends its terminal `.game-over-banner` into `chainDisplay` at game-over and is byte-identical (its ids/text/branching/idempotence guard, and the 7.6 `#recap-overlay`, are **untouched** — the banner DOM is not part of the filmstrip; the filmstrip neither suppresses nor alters it).

8. **Client-only.** Zero `server/**`, zero `gameLogic`, zero socket-protocol/event change. No new socket event. No `innerHTML` for dynamic/user-derived content (DOM APIs / `textContent` only — the established XSS discipline). The server cast-trim (top 30) is consumed as-is, never changed.

9. **Zero-regression posture = transform + behavioural-equivalence (the 7.5.2 Theater-Lobby playbook).** `renderChainItems` is **deliberately rewritten** into the filmstrip; its dedicated guard suite `client-tests/render-chain.test.js` is **legitimately rewritten** to pin the NEW contract, protected by an explicit §4 behavioural-equivalence assertion list + the §5 **redefined** ratchet (every *other* guard suite + all `server/**` byte-identical). This is exactly how 7.5.2 replaced the lobby (full-replace + guard suite rewritten + §4 equivalence + §5 redefined + opus-holistic GO).

10. **Perf budget (§3.4) is binding:** compositor-only `transform`/`opacity` animation via classes; the reel scrolls via **CSS** (scroll / scroll-snap), never a JS rAF loop; at most the now-playing node + one bridge animate at once (history is static); the existing global `@media (prefers-reduced-motion: reduce)` block in `06-states-anim.css` neutralizes all of it — **no new per-rule `@media`**, **no new colour values** beyond the existing palette + the verbatim brand accent already used by `.theater .screen`; the per-turn timeline schedule is `setTimeout`-chained (the proven leak-safe `ui-panels.js` handle pattern); reduced-motion / unreadable `matchMedia` short-circuits the timeline to the instant settled end-state (belt-and-suspenders: CSS zeroes the animation, JS skips the wait).

---

## 2. Current baseline (the "1.0" — what exists at `20f4c95`)

- **In-game chain = `renderChainItems(gameState, myPlayerId)`** — `public/js/ui/ui-render.js` ~L618–727. Builds, per chain entry, a `.chain-item` (`.shared-highlight` for index>0): a `.chain-poster` `<img>` (TMDB URL, with `attachPosterFallback(img, 'chain-poster')` → designed placeholder) or a `.chain-poster.placeholder`; then `.chain-content` → `.player-name` (`item.playerName`), `.movie-title` (`title` + `.year` span `(year)`), `.movie-cast` (`"Cast: "` + the full cast list; an actor that also appears in the *previous* node's cast is wrapped in `<strong>` — id-precise when both sides carry `{id,name}`, else case-insensitive name). Appended **incrementally** (`for index = currentDisplayedCount … chain.length`); empty-board hint when `chain.length === 0 && status === 'playing'`; full clear when the chain shrank/reset; stale `.game-over-banner`/`.empty-*-hint` removed when `status === 'playing'`; `chainDisplay.scrollTop = chainDisplay.scrollHeight` at the end; `playSuccess()` when the newest entry is another player's. Called from `renderGame(gameState, myPlayerId, isSpectator)` (~L532) → `renderChainItems(...)` (~L538); the game-over branch (~L843–848) calls `showGameOverBanner` (7.6 domain — **untouched by 7.7**).
- **Chain entry shape (client, live):** `{ playerName, playerId, movie: { title, year, poster (https://image.tmdb.org/… or absent), mediaType, cast: [ {id,name} | "name" , … ] }, matchedActors: [ <connecting actor>, … ] }`. Cast is server-trimmed to the **top ~30 in billing order** (`server/systems/matchSystem.js` ~L726 `const displayCast = validMatch.cast.slice(0, 30)`); a *separate* surface (self-elim comparison card) uses `topCastNames` → `slice(0,10)` — **not** the chain, not in 7.7's scope. `matchedActors[0]` is the actor linking this movie to the previous one.
- **Turn timer panic seam = `public/js/ui/timer-panic.js`** — owns the low-time "panic" state the clutch predicate keys off. Exact exported surface re-pinned in writing-plans from a fresh read at the branch base.
- **Reusable leak-safe beat primitive** — `public/js/ui/ui-panels.js` ~L88–95: a recursive `setTimeout(tick, stepMs)` staggered reveal with a stored cancellable handle (`playSfx('success')`, initial `setTimeout(tick, 200)`). The per-turn motion driver reuses this scheduling pattern.
- **CSS partials:** `03-game.css` owns `.chain-item`/chain board / `#chain-display`; `04-modals.css` owns overlay/modal structure; `06-states-anim.css` owns animation `@keyframes`/classes **and** the **existing global `@media (prefers-reduced-motion: reduce)`** block (exact line re-pinned in writing-plans from a fresh read — the 7.6/7.5.2 precedent placed appended keyframes here so that block neutralizes them). Exact current line ranges are re-pinned during writing-plans from a fresh read at the branch base.
- **Guard suites at the base:** `client-tests/render-chain.test.js` (pins the `.chain-item` DOM — the suite that 7.7 **legitimately rewrites**, §1.9), plus `socket-handlers.test.js`, `showScreen.test.js`, `render-lobby.test.js`, `red-carpet*.test.js`, `chain-recap.test.js`, `recap-player.test.js`, and all `server/**` suites (**byte-identical & green** through 7.7). Base suite at `20f4c95` = **61 suites / 500 tests** (post-7.6.3/#38; the `level:50` lines in passing server suites are the pre-existing intentional redis-down fixtures, unchanged).

---

## 3. The contract / architecture

### 3.1 The per-turn motion timeline schema (the reuse interface — frozen)

`buildTurnTimeline(input)` → an ordered `Array<Phase>`. Each `Phase` is a pure plain-data descriptor:

```
Phase = {
  name:  'handoff' | 'think' | 'submit' | 'reveal' | 'impact',
  index: <integer>,        // phase ordinal (0-based)
  atMs:  <integer>,        // deterministic start offset from turn-choreography start
  durMs: <integer>,        // deterministic duration ('think' carries the live turn length supplied by the caller; all others are frozen constants)
  meta:  { … }             // phase-specific, plain data only (e.g. { clutch: <bool> } on 'impact'); never DOM, never identity
}
```

- `handoff` — prior node settles into the reel; reel re-centers/scrolls; turn passes. ~400ms (frozen).
- `think` — active player's input is highlighted; the live timer runs; **no board motion** (don't distract the scanner). `durMs` = the live turn length passed in by the caller (the only non-frozen value; the producer stays pure — it does not read a clock, the caller supplies the number).
- `submit` — answer sent → input enters pending. ~250ms (frozen).
- `reveal` — the validated movie's poster rises into the now-playing hero; the bridge draws from the prior node with the linking-actor label. ~600ms (frozen).
- `impact` — the node "locks in"; the cast panel populates; `meta.clutch` is `true` iff the caller passed a clutch-save signal (the burst fires in this phase). ~500ms (frozen).

Timing is deterministic: `atMs` is the running sum of prior `durMs`; every `durMs` except `think` is a frozen per-phase constant (no clock, no RNG). Total non-`think` choreography ≈ **1.75s** per turn by construction (it is every turn, not a one-off — deliberately tight). Pure ⇒ fully unit-testable.

### 3.2 `public/js/ui/turn-motion.js` (NEW — pure, zero-import; the cohesive engine)

Single cohesive engine, exporting **both**:
- `buildTurnTimeline(input)` → the §3.1 schema (deterministic, zero-import; the `think` duration is supplied by the caller, never read from a clock).
- `isClutchSave(input)` → a pure boolean predicate: `true` iff the move was a *valid* answer AND the time remaining at submission was within the panic window (both supplied by the caller as plain numbers/booleans — the predicate reads no DOM, no timer, no clock). Frozen panic-window semantics mirror `timer-panic.js`'s existing threshold (the constant is pinned in writing-plans from a fresh read so the predicate and the live panic UI agree; if `timer-panic.js` already exports a usable threshold the predicate consumes it rather than duplicating the literal).

Both are "turn dynamics," consumed together by one thin DOM driver, tested together — the one-pure-engine-per-sub-phase precedent (`red-carpet.js` bundles `diffArrivals`/`playerCardModel`/`rollCameraLabel`/`marqueeSegments`; `chain-recap.js` bundles `buildRecapStoryboard`/`selectChainEntries`/`scoreChainEntry`). It imports nothing and owns no DOM/timers/clock/RNG. Unit-tested in its **own new additive suite** (the 7.5.1/7.5.2/7.5.3/7.6 seam-suite precedent — legitimately new, not a guard rewrite).

### 3.3 The filmstrip render (transform of `renderChainItems`, thin DOM driver)

`renderChainItems` is rewritten to build the filmstrip instead of the vertical card list. It remains a **DOM driver, not a second pure engine** — the reel is declarative flex/scroll from `gameState.chain` (precisely why the horizontal filmstrip was chosen over a computed-position radial layout); it consumes chain data + (during a live turn transition) the §3.2 timeline. Structure:

- A **reel**: one node per chain entry, left→right, joined by labeled actor-bridge connectors (`matchedActors[0]` of the *later* entry — this carries the semantics today's `<strong>` shared-actor bolding carried). Older nodes recede/dim; the newest is the larger glowing **hero "now-playing"** frame. The reel is a centered flex row that flips to fill + CSS horizontal scroll when content exceeds the board, newest pinned right (§1.1). Poster `<img>` keeps `attachPosterFallback`; off-screen reel posters gain `loading="lazy"` (additive perf, no behaviour change).
- A **now-playing cast panel** (full-width, below the reel): the latest movie's title/year, a "linked via &lt;actor&gt;" line (the prior bridge's actor), and the **full, full-name, ungated** cast (§1.2). The old per-card "Cast: …" + bold-shared-actor semantics map to: cast panel (full cast) + the bridge label + the "linked via" line.
- A **burned stamp** overlay on a node whose entry carries the best-effort elimination marker (§1.5); absent ⇒ no stamp.
- Incremental-append behaviour is preserved in spirit: a new chain entry adds one reel node + promotes it to the hero; the empty/opening state is the centered single hero (or the empty-board hint when `chain.length === 0 && status === 'playing'`); the stale `.game-over-banner`/`.empty-*-hint` cleanup when `status === 'playing'` is preserved; chain-shrink/reset still clears; `playSuccess()` still plays when the newest entry is another player's (subsumed by the clutch/impact treatment but never lost). At game-over the filmstrip still renders the chain exactly as in the playing state (behaviour-equivalent, §4); `showGameOverBanner` independently appends its **untouched** terminal banner into `chainDisplay` as today (§1.7) — the filmstrip neither suppresses nor alters it.

The driver consumes the §3.2 timeline for the per-turn choreography and applies the clutch treatment when `isClutchSave(...)` is true; under reduced-motion / unreadable `matchMedia` it renders the settled end-state immediately (no timers) — the `recap-player.js` precedent. The timeline tick uses the leak-safe `ui-panels.js` `setTimeout`-chain handle pattern (single stored cancellable handle).

**Real-boot/browser gate:** jsdom cannot lay out the reel, run the `setTimeout` cinematic meaningfully, honor a live turn timer, or evaluate `matchMedia` — the in-browser eyeball (reel composition at chain lengths 1 / few / many, hero now-playing, full-name cast legibility at ~30, clutch under a real panic timer, reduced-motion settled legibility, mobile sticky strip, long-chain scroll) is **user-side** and flagged in §9/§10.

### 3.3.1 Clutch Save wiring (additive, off the existing panic seam)

On a *valid* submission, the driver computes `isClutchSave(...)` from the time-remaining the existing timer/panic state already tracks (no new timer, no new socket event, no new server field). When true, the `impact` phase carries `meta.clutch = true` and the driver adds the focused burst class to the just-landed hero node + shows the brief "CLUTCH SAVE" word-mark near the timer + the existing `playSuccess()` SFX. The exact panic-time source and submission hook are pinned in writing-plans from a fresh read; the binding constraint: **the clutch treatment is purely additive, fires only inside the existing panic window on a valid answer, never alters the chain/turn/score, and the board is behaviour-equivalent to 1.0 whenever it does not fire.**

### 3.4 Mobile sticky strip (resolves MO-01)

On mobile the reel is the **compact turn treatment**: a CSS scroll-snap horizontal rail (the recent tail + the hero now-playing on screen, swipe back for history) pinned above the input — **no JS scrolling**. The full-name cast panel wraps full-width below it exactly as today's mobile card (the page scrolls; the cast does not; **no expand gate** — §1.2). This is the decision-record §2.7.7 "the compact turn treatment becomes the mobile sticky strip" / MO-01 resolution. Exact breakpoints reuse the existing responsive partials' breakpoints (re-pinned in writing-plans); no new `@media` feature query is introduced for motion (the global reduced-motion block is reused, §1.10).

---

## 4. Behavioural-equivalence statement

For any live (`status === 'playing'`) chain state, the filmstrip is **behaviour-equivalent** to the 1.0 vertical card list on every gameplay-load-bearing axis:

1. **Every** chain entry is rendered, in chain order.
2. The **linking actor** between consecutive entries is surfaced (the labeled bridge + the now-playing "linked via" line) — the information today's `<strong>` shared-actor bolding conveyed.
3. The current/latest movie is the now-playing hero (the entry today's append+scroll made the visible bottom).
4. The now-playing movie's **full cast, full names, every member** (the server top-~30) is shown, ungated — identical data and prominence to today's `.movie-cast`.
5. An eliminated player's node shows the burned stamp **iff** state carries the marker (best-effort, never fabricated) — strictly additive over 1.0 (1.0 shows nothing here).
6. Zero `stableId`/identity in the DOM (as today).
7. `playSuccess()` audio on another player's new entry is preserved (folded into the impact/clutch treatment).
8. The empty-board hint (`chain.length === 0 && status === 'playing'`), the stale-banner/hint cleanup when `status === 'playing'`, chain-shrink/reset clearing, and the game-over `showGameOverBanner` append are all unchanged; Daily mode is unchanged (no Daily-specific filmstrip treatment — §11).

The clutch burst, the per-turn choreography, the hero scaling, and the reel layout are **additive presentation** over that equivalent information; under reduced-motion / skipped animation the board settles immediately to the same information with no motion. No gameplay-load-bearing behaviour is removed, gated, or altered.

---

## 5. Zero-regression ratchet (§5 redefined for a deliberate in-game TRANSFORM)

**Byte-identical (the proof surface), vs `20f4c95`:**
- All `server/**`, `gameLogic`, socket protocol — **byte-identical** (client-only sub-phase; no new event; server cast-trim consumed as-is).
- `public/js/ui/ui-render.js` `showGameOverBanner` + the `renderGame` game-over branch + the 7.6 `#recap-overlay` wiring + `renderLobby`/team paths — **byte-identical** (the only `ui-render.js` change is the `renderChainItems` body transform + the additive clutch/timeline seam it calls; everything else in the file untouched and reviewed).
- `client-tests/socket-handlers.test.js`, `showScreen.test.js`, `render-lobby.test.js`, `red-carpet*.test.js`, `chain-recap.test.js`, `recap-player.test.js`, all `server/**` suites — **byte-identical & green**.
- The 7.6 `chain-recap.js` / `recap-player.js` / share-card surfaces — untouched.

**Legitimately rewritten (the deliberate transform — the 7.5.2 precedent, NOT a silent guard edit):**
- `client-tests/render-chain.test.js` — rewritten to pin the **new filmstrip contract**, gated by an explicit, enumerated §4 behavioural-equivalence assertion block (every axis 4.1–4.8 asserted). This is the only rewritten guard suite and it is justified, enumerated, and reviewed exactly as 7.5.2's three lobby suites were.

**Legitimately new / additive (not a guard rewrite):**
- New: `public/js/ui/turn-motion.js` + `client-tests/turn-motion.test.js`.
- Additive: append-only filmstrip CSS (structural → `03-game.css`'s own appended block; `@keyframes`/animation classes → `06-states-anim.css` so the existing global reduced-motion block neutralizes them — **no new `@media`, no new colour value, no pre-existing rule edited**); the additive clutch/timeline seam call inside the rewritten `renderChainItems`; any additive `index.html` hook (only if a fresh read in writing-plans shows the filmstrip needs a new static skeleton node — preferred: pure createElement in the driver, no markup change).

Full `cd C:/mm-phase7-7 && npx jest` green at every task boundary. Suite delta over the `20f4c95` 61/500 baseline: **+1** new suite (`turn-motion.test.js`); `render-chain.test.js` rewritten in place (its test count may change — the legitimate §1.9 exception); every other suite byte-identical & green.

---

## 6. Decomposition — 3 linear TDD tasks (finalized in writing-plans)

- **Task 0 — pure engine.** `public/js/ui/turn-motion.js` (`buildTurnTimeline` + `isClutchSave`) + `client-tests/turn-motion.test.js` (phase order/determinism, frozen-constant timings, `think` caller-supplied duration, `atMs` running-sum, `isClutchSave` boundary cases incl. invalid-move = false / outside-panic = false / valid-in-panic = true, reduced-motion-collapse contract, **zero-identity sentinel**). No DOM. `server/**` untouched. Verify: `cd C:/mm-phase7-7 && npx jest client-tests/turn-motion.test.js` green → then full `npx jest` green.
- **Task 1 — filmstrip render + behavioural-equivalence guard rewrite** (blockedBy 0). Rewrite `renderChainItems` into the reel + hero now-playing + full-name full-cast panel + best-effort burned stamp + length-aware center/scroll; append-only filmstrip CSS (`03-game.css` structural + `06-states-anim.css` keyframes); rewrite `client-tests/render-chain.test.js` to the new contract with the enumerated §4 assertion block. `showGameOverBanner`/game-over branch/lobby/team/7.6 surfaces byte-identical; `socket-handlers`/`showScreen`/`render-lobby`/`red-carpet*`/`chain-recap`/`recap-player`/`server/**` byte-identical & green. Verify: full `npx jest` green + the diff-gate (only `renderChainItems`'s body changed in `ui-render.js`; CSS append-only; no new `@media`/colour; index.html unchanged unless the pinned additive skeleton is required).
- **Task 2 — per-turn choreography + Clutch Save + mobile sticky strip** (blockedBy 1). Wire the §3.2 timeline into the filmstrip driver (leak-safe `setTimeout`-chain handle; reduced-motion/unreadable-`matchMedia` → instant settled end-state), the `isClutchSave` burst off the existing panic seam (§3.3.1), and the mobile scroll-snap sticky strip (§3.4); append-only motion CSS in `06-states-anim.css` (compositor-only, neutralized by the existing global reduced-motion block). Extend `render-chain.test.js`/`turn-motion.test.js` for the wired contract (one-shot per turn, clutch-only-in-panic, reduced-motion short-circuit, leak-safe cancel). `server/**` + all non-rewritten guards byte-identical & green. Verify: full `npx jest` green + the diff-gate (additive seam + append-only CSS only).

Each task: TDD red→green, every code change ships a WHY comment, branch-verify before every commit, then spec-compliance review (sonnet) → real fix-loop → code-quality review (sonnet) → real fix-loop → mark complete + sync `.tasks.json` (own follow-up commit). Then final **opus** whole-branch holistic = GO bar (every §4/§5 byte-identical surface provably empty-diff; the `render-chain.test.js` rewrite justified + §4 block enumerated; G1–G8 evidenced; engine reuse-seam pure; full suite green; §9 met) → finishing-a-development-branch Option 2.

---

## 7. Cross-cutting guardrails (decision-record §3, restated as binding here)

No accounts (filmstrip/clutch/timeline device-local, room-scoped, display-name only). Daily-leaderboard `stableId` security preserved (§1.6 sentinel). Real-boot + in-browser gate (§3.3 — submitMovie/render path; user-side eyeball flagged §9/§10). Perf budget (§3.4 / §1.10). 6b/6c untouched. Pipeline & branch safety (§ branch line; isolated worktree; parallel Codex agent → branch-verify before every commit; per-task two-stage review + opus holistic; PR-merge/push-main/Render-deploy classifier-gated → handed to the user). Every code change ships a WHY comment. Out-of-scope review findings → `spawn_task` chip, never widen 7.7.

---

## 8. Guardrails G1–G8 (each must be evidenced by the opus holistic)

- **G1** — `turn-motion.js` is pure & zero-import; `buildTurnTimeline` deterministic (no DOM/timers/clock/RNG; `think` duration caller-supplied), produces the §3.1 schema, reuse-stable; `isClutchSave` is a pure boundary-correct predicate. Its own suite proves it.
- **G2** — Zero identity: filmstrip/bridges/cast/clutch/timeline never carry `stableId`/socket-id/any identifier; sentinel test green; Phase-1 daily security intact.
- **G3** — §4 behavioural-equivalence holds: every chain entry rendered in order, linking actor surfaced, now-playing = latest, **full-name full cast ungated**, burned stamp best-effort-only, `playSuccess` preserved, empty/reset/game-over unchanged; the `render-chain.test.js` rewrite enumerates every §4 axis.
- **G4** — Client-only: `server/**`, `gameLogic`, socket protocol byte-identical; no new socket event; `showGameOverBanner`/game-over branch/7.6 surfaces/lobby/team paths byte-identical.
- **G5** — CSS append-only: no pre-existing rule edited; structural in `03-game.css`'s own block, animation in `06-states-anim.css`; **no new `@media`** (the existing global reduced-motion block neutralizes); **no new colour value** (existing palette + the verbatim brand accent already used by `.theater .screen`); compositor-only transform/opacity.
- **G6** — Length-aware layout: centered when it fits (no void at chain length 1 / few), fills + CSS-scroll when it overflows (newest pinned right); no JS scroll loop.
- **G7** — Clutch is additive & rare: fires only on a valid answer inside the existing panic window, focused (not screen-wide), ≤ ~900ms, never alters chain/turn/score; board behaviour-equivalent to 1.0 when it does not fire; one-shot per turn; leak-safe cancellable timeline handle.
- **G8** — Perf budget: compositor-only; reel CSS-scroll; ≤ now-playing + one bridge animating; `loading="lazy"` off-screen posters; reduced-motion / no-`matchMedia` short-circuits to instant settled end-state; full `npx jest` green at every task boundary.

---

## 9. Acceptance criteria (the binding bar — §10 of the gate)

1. `buildTurnTimeline` returns the §3.1 ordered phase schedule, deterministic, zero-import/pure, `think` caller-supplied, frozen non-`think` constants, `atMs` running-sum; `isClutchSave` pure & boundary-correct (invalid→false, valid-outside-panic→false, valid-in-panic→true); zero-identity (sentinel green).
2. The filmstrip renders the live chain as the length-aware reel + glowing hero now-playing + full-width **full-name, all-member, ungated** cast panel + labeled actor bridges + best-effort burned stamp; centered when it fits, fills + CSS-scroll when it overflows (newest pinned right); the 1-movie opening reads as a centered feature presentation (no void).
3. §4 behavioural-equivalence holds on every axis 4.1–4.8; `render-chain.test.js` is rewritten to the new contract with the enumerated §4 assertion block; `showGameOverBanner`/game-over branch/7.6 surfaces/lobby/team/`socket-handlers`/`showScreen`/`server/**` byte-identical & green.
4. The per-turn timeline drives the choreography one-shot per turn via a single leak-safe cancellable `setTimeout`-chain; the Clutch Save burst fires only on a valid answer inside the existing panic window (focused, ≤ ~900ms, existing `playSuccess()` SFX, never screen-wide, never alters chain/turn/score).
5. Reduced-motion / unreadable `matchMedia` → the board renders the instant settled end-state (no timers, legible); the existing global reduced-motion block neutralizes all animation; **no new `@media`/colour**; CSS append-only; `index.html` unchanged unless the pinned additive skeleton is required.
6. Mobile = the compact scroll-snap sticky strip (recent tail + hero) + full-width full-name cast wrap (no expand gate); resolves MO-01.
7. Full `cd C:/mm-phase7-7 && npx jest` green (over the `20f4c95` 61/500 baseline; +1 `turn-motion.test.js`; `render-chain.test.js` legitimately rewritten; every other suite byte-identical); G1–G8 evidenced; opus holistic = GO.
8. **User-side (non-blocking, flagged — jsdom can't lay out the reel / run timers / matchMedia / a live turn timer / a socket):** the reel composition at chain length 1 / few / many on desktop + mobile; the hero now-playing; the full-name cast legibility at ~30 members; the Clutch Save under a real panic timer; reduced-motion settled legibility (static, readable, no blank wait); the mobile sticky strip + scroll-snap; long-chain horizontal scroll with newest pinned; that game-over still shows the unchanged `showGameOverBanner`/7.6 recap and Daily is unchanged.

---

## 10. Pipeline

spec (this doc) → writing-plans (3 linear TDD tasks, co-located `.md.tasks.json`) → subagent-driven-development (per-task implementer sonnet, TDD red→green, WHY comments, branch-verify before every commit; spec-compliance review sonnet + real fix-loop; code-quality review sonnet + real fix-loop; mark complete + sync `.tasks.json` as its own commit) → final **opus** whole-branch holistic (the §4/§5 ratchet + the justified `render-chain.test.js` rewrite + G1–G8 + §9 acceptance + full `npx jest` green is the GO bar; NO-GO → real fix-loop + opus re-review until GO) → finishing-a-development-branch **Option 2** (feature-branch push + `gh pr create --base main`; PR-merge / push-to-main / Render-deploy is classifier-gated → handed to the user; worktree `C:\mm-phase7-7` PRESERVED until the user merges; post-merge reconcile owed, mirroring 7.1–7.6.3 — ff local main → merge commit, `C:\mm-phase7-7\node_modules` junction unlink **LINK-ONLY** via PowerShell .NET `(Get-Item -LiteralPath … -Force).Delete()` NOT `cmd /c rmdir`, verify shared `node_modules` 359, `git worktree remove` + prune, `git branch -d phase7-7-constellation-board`, flip project memory; the destructive tail awaits the user's explicit in-session merge confirmation, never git-state inference).

---

## 11. Explicitly out of scope / deferred (recorded — never widen 7.7)

- **Spectator / Audience view of the filmstrip** → that is **7.8** (Audience Mode); the 7.7 board is the player-facing live chain only.
- **Any post-game recap / share surface** → that is **7.6** (Chain Premiere Recap + Share Cards, shipped). 7.7 keeps `showGameOverBanner` + `#recap-overlay` byte-identical and adds nothing to the end-of-game.
- **Daily-mode-specific filmstrip treatment** → out; Daily renders the same live filmstrip with no special-casing (Daily end-of-game remains the unchanged Daily-result modal).
- **Any `server/**` / `gameLogic` / socket / scoring / persistence / cast-trim change** → permanently out of 7.7 (client-only sub-phase; the server top-~30 cast trim is consumed as-is).
- **Radial / true star-map constellation layout** → considered and rejected at the design gate (arbitrary positioning + mobile cramping + heaviest perf on a vanilla no-build stack); the horizontal filmstrip is the locked layout.
- **Combo/streak meters, speed-only or two-tier Save Moments** → considered and rejected at the design gate; clutch-only is the locked trigger (rarity = the point; combo/streak would collide with the 6b/7.8 identity-coordination guardrail).
- **Elimination-marker fidelity beyond what state already carries** → best-effort only (§1.5); richer elimination cinematics → review-time `spawn_task` / a later sub-phase, never widened here.
