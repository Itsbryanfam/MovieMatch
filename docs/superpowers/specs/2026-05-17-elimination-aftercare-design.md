# Phase 7.1 — Elimination Aftercare: Design Spec

**Date:** 2026-05-17
**Status:** Approved (brainstorming) — proceeding to writing-plans.
**Phase:** **7.1** — the first slice of **Phase 7 (UI/UX Elevation)**, decomposed in `docs/superpowers/specs/2026-05-17-phase7-uiux-elevation-design.md` §2. Sequenced first because it is the one quick win that is infra-independent (extends an already-shipped surface) and builds on the live Phase 6a substrate. Source: Codex Pass 2 #8 ("post-fail coaching") + Pass 1 elimination/learning cluster.

---

## 1. Context & provenance

**Already shipped + live (Phase 6a, PR #23):** on an *invalid-connection* self-elimination, the server runs `_computeCouldHavePlayed` ([server/systems/matchSystem.js:409](server/systems/matchSystem.js:409)) — one deterministic, time-boxed (`COULD_HAVE_PLAYED_TIMEOUT_MS`), fail-closed bot pathfind via `botSystem.generateBotMove` using `SUGGESTION_BOT_PROFILE` ([matchSystem.js:36](server/systems/matchSystem.js:36)) — resolves it to `{title, year}`, and rides it on the existing private `youWereEliminated` emit ([matchSystem.js:282](server/systems/matchSystem.js:282)). The client card ([public/js/ui/ui-notifications.js:43](public/js/ui/ui-notifications.js:43)) renders one line *"You could have played: {title}"* (`.self-elim-could`, lines 125–130) plus a generic hint.

**The two elimination notification paths (verified):**
1. **Invalid-connection (no shared cast):** `matchSystem.js` privately `socket.emit('youWereEliminated', {...})` with `yourGuess`, `lastChainEntry`, `reason`, optional `couldHavePlayed`. → client `showSelfEliminationScreen(details)` detailed card.
2. **`eliminateCurrentPlayer`** ([server/gameLogic.js:175](server/gameLogic.js:175)) — used for timeout (`"Turn timed out"`, gameLogic.js:61), too-many-typos (matchSystem.js:217), bot-no-move, quit, disconnect. Emits only a **room-wide** `notification` (gameLogic.js:192). The timed-out player gets **no detailed card** today — just the legacy 💀 flash.

**Gap:** the goal is *2–3 "outs" + the shared-actor bridge for each + a "one bridge away" framing*, on **both** the invalid-connection and the timeout elimination (the most common failure). Today the server returns one suggestion, no bridging actor, and nothing at all on timeout.

## 2. Goal & non-goals

**Goal:** turn elimination into learning — show up to 3 valid titles the player *could* have played, each annotated with the actor that bridges it to the last chain entry, framed as "you were one bridge away," on both human-learnable failure modes (no-shared-cast submit, froze-on-clock).

**Non-goals:** no new socket event; no scoring/validation/rule change; no persistence or accounts; no aftercare for bot / quit / disconnect / too-many-typo eliminations; no change to the legacy flash for detail-less eliminations.

## 3. Design

### 3.1 Server — read-side "outs" enumerator (reusable seam)
Add an exported, fail-closed, read-side helper to `botSystem` — `enumerateConnectingMoves(room, deps, { limit })` — returning up to `limit` `{ tmdbId, mediaType, viaActor }`, where `viaActor` is the actor shared with the last chain entry that bridges that candidate. It reuses the **exact** actor→filmography pathfinding `generateBotMove` already performs (extract the shared inner walk; no connection rule duplicated), with permissive params (`whiff:0`, low `popularityFloor`, bounded `retryCap`) and a deterministic order (most-popular first). `deps` mirrors `generateBotMove`'s (`pubClient, headers, rng, getOrFetchPersonCredits, dailySeed`).

### 3.2 Server — `_computeCouldHavePlayed` → multi-out wrapper
Rework `_computeCouldHavePlayed` into a thin wrapper: call `enumerateConnectingMoves` (limit 3), resolve each `tmdbId → {title,year}` via the existing `resolveCandidates` direct-ID path (as it does today), attach `viaActor`, dedupe by title → return `outs: [{title, year, viaActor}]` (≤3) or `null`. The **entire batch** stays within `COULD_HAVE_PLAYED_TIMEOUT_MS` (same race/`.unref()`/`clearTimeout` discipline already in the function); partial results (1–2) are valid; any miss/error/timeout → `null`.

### 3.3 Server — two trigger sites + exclusions
- **Invalid-connection** ([matchSystem.js:281–296](server/systems/matchSystem.js:281)): replace the single `couldHavePlayed` field with `outs`; `...(outs ? { outs } : {})`. `yourGuess`/`lastChainEntry`/`reason` unchanged.
- **Timeout** (`eliminateCurrentPlayer`, after the team-mode early return, inside the non-team `if (player)` block, after `player.isAlive=false` + the room notification, **before** `checkWinCondition`/`nextTurn`): gate on `_categorizeReason(reason) === 'timeout'` **AND** `player.stableId` (excludes bots, whose `stableId` is `null`) **AND** `player.connected`. Then `await` the bounded outs computation and `io.to(player.id).emit('youWereEliminated', { lastChainEntry, reason, timedOut:true, outs })` — **no `yourGuess`**. Bounded latency is added to the timeout path only and is fail-closed (no outs ⇒ omit ⇒ client shows the needed-only variant). Reuse the existing `_categorizeReason` ([gameLogic.js:247](server/gameLogic.js:247)) for the gate — do not re-derive.
- **Excluded:** bot / quit / disconnect / `"Too many invalid title attempts"` → unchanged (no aftercare).

### 3.4 Client — extend `showSelfEliminationScreen`
- **Outs block** (when `details.outs?.length`): an accessible "You had outs" list; each row `{title} ({year}) — via {actor}` via `createElement`/`textContent` only; plus a framing line **"You were one bridge away."** It replaces the generic hint when outs exist; the generic hint remains the no-outs fallback. Replaces the 6a `.self-elim-could` single-line block (lines 125–130, 154–155).
- **Timeout variant** (`details.timedOut === true`): head copy "Time's up — you froze"; render only the "Needed a connection to" column (`lastChainEntry`) + the outs block. No "You played" column (there is no `yourGuess`).
- **Invalid variant:** unchanged 2-column grid (`Needed` / `You played`) with the outs block appended beneath.
- Preserved invariants: no `innerHTML`; optional/additive (no `outs` and no `timedOut` ⇒ structurally identical to today's 6a card; the detail-less legacy 💀 flash path at lines 47–60 is untouched); dismiss button + Escape + focus parity.

### 3.5 Payload contract (`youWereEliminated`)
| Field | Invalid-connection | Timeout |
|---|---|---|
| `reason` | yes | yes |
| `lastChainEntry` | yes | yes |
| `yourGuess` | yes | **absent** |
| `timedOut` | absent | `true` |
| `outs?` | `[{title,year,viaActor}]` ≤3 or omitted | same |

No new event name. Single shared client renderer.

## 4. Test plan (TDD — red→green per task)

**Server:**
- `enumerateConnectingMoves`: returns ≤`limit` results each with a `viaActor` that genuinely co-stars in the last chain entry; dedupes; deterministic order; fail-closed (timeout/error/no-path → `[]`).
- `_computeCouldHavePlayed` wrapper: maps enumerator → `outs:[{title,year,viaActor}]` ≤3; `null` on empty/error; whole-batch stays within the timeout (race honored).
- Invalid path: `youWereEliminated` carries `outs` (not `couldHavePlayed`); omitted when `null`.
- Timeout path: private `youWereEliminated` with `timedOut:true` + no `yourGuess`, emitted **only** for a human, non-team, connected, timeout elimination; **not** emitted for bot / quit / disconnect / typo-cap; never delays `nextTurn` beyond the bound.
- Existing 6a/H3 tests asserting `couldHavePlayed`/`.self-elim-could` are updated to the `outs` shape (this is the deliberate payload change; the "absent ⇒ unchanged" guarantee still holds for the no-suggestion case).

**Client (`client-tests/`, jsdom):**
- Outs block renders ≤3 rows each `… — via {actor}`, with the framing line, when `details.outs` present.
- Timeout variant: head copy + needed-only column + outs block; **no** "You played" column.
- Absent `outs`/`timedOut` ⇒ card structurally identical to the current 6a detailed card; detail-less ⇒ legacy flash unchanged.
- XSS posture: a crafted title/actor is rendered as text (no HTML execution).

Full suite + coverage ratchet must stay green.

## 5. Guardrails & gates
- No new socket event; no scoring/validation/rule change; fail-closed & time-boxed (elimination never blocked beyond the existing `COULD_HAVE_PLAYED_TIMEOUT_MS`).
- No persistence/accounts; device-local N/A.
- **Real-boot + in-browser gate:** touches `submitMovie` + `eliminateCurrentPlayer` (timeout/turn-loop) + render path. Suite mocks Redis and never boots; after merge confirm Render `live` (read-only Render MCP) and flag the in-browser eyeball (both card variants) as user-side. "Merged" ≠ "deployed."
- Pipeline: isolated git worktree off the **then-current** `origin/main` (parallel Codex agent shares the repo — verify branch before every commit); native Task tools unavailable → TodoWrite + hand-authored co-located `.tasks.json`; per-task two-stage review (spec-compliance then code-quality) + final most-capable-model holistic review; PR-merge / push-to-main / Render deploy classifier-gated, handed to the user.
- Every code change ships explanatory WHY comments.
- Out-of-scope findings during build/review → session spawn_task chip, never widen 7.1's scope.

## 6. Files touched (anticipated)
- `server/systems/botSystem.js` — new exported `enumerateConnectingMoves` (+ extract the shared pathfinding inner walk; `generateBotMove` refactored to reuse it, behaviour-preserving).
- `server/systems/matchSystem.js` — `_computeCouldHavePlayed` → multi-out wrapper; invalid-path emit `couldHavePlayed` → `outs`.
- `server/gameLogic.js` — timeout-only private `youWereEliminated` emit inside `eliminateCurrentPlayer`.
- `public/js/ui/ui-notifications.js` — outs block + timeout variant in `showSelfEliminationScreen`.
- Tests: `server/systems/botSystem*.test.js`, `server/systems/matchSystem*.test.js`, `server/*gameLogic*`/turn-timeout tests, `client-tests/*self-elim*` (new/updated).

## 7. Acceptance criteria
- [ ] Invalid-connection elimination shows ≤3 outs each with a correct bridging actor + "one bridge away" framing.
- [ ] Timeout elimination shows the timeout-variant card (needed column + outs, no guess column) for a human non-team player; bots/quit/disconnect/typo-cap show no aftercare.
- [ ] No-path / TMDB-miss / timeout ⇒ graceful: invalid card degrades to the pre-7.1 layout, timeout degrades to needed-only; elimination is never blocked beyond the existing bound.
- [ ] No new socket event; no scoring/validation change; no `innerHTML`.
- [ ] Full suite + coverage ratchet green; real-boot + browser eyeball flagged user-side.

## 8. Out of scope (explicit)
Bot/quit/disconnect/typo-cap aftercare; ranking/explaining *why* these are the best outs; any persistence of "missed outs"; timeout-card redesign beyond the variant described; the legacy detail-less flash.
