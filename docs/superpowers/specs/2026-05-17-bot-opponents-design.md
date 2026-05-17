# Phase 5a — Bot Opponents: Design Spec

**Date:** 2026-05-17
**Status:** Approved (brainstorming) — proceeding to implementation plan
**Phase:** 5a of the post-2026-05-16-review remediation. Phase 5 ("growth") was
re-scoped during brainstorming into **5a bot opponents → 5b local fallback movie
DB**. Accounts/friends/history (L4) was **dropped by design**: mandatory accounts
are a barrier to entry that works against the growth goal, and introducing an
auth system + durable datastore where neither exists today is the riskiest
possible change for a final remediation phase on a live site. Completing 5a + 5b
closes the 5-phase remediation.

---

## 1. Goal & Motivation

A solo visitor, or a lobby that never fills, currently has **nothing to do** —
the competitive last-player-standing game needs ≥2 humans, so a single visitor
who can't find an opponent bounces. This is the cold-start problem and it is a
direct, friction-free **acquisition** loss.

**Goal:** A host can add AI ("bot") players to a lobby so the real competitive
elimination game is playable immediately, with **selectable difficulty** and a
**balance design that guarantees the bot is always beatable and fun** — never an
unbeatable perfect-recall opponent.

Non-goal: replacing human multiplayer or the existing solo/daily modes. Bots
*augment* a lobby; they do not change how humans play.

---

## 2. Scope

### In scope
- A new `server/systems/botSystem.js`: bot player factory/lifecycle, move
  generator, internal submit driver, turn-hook scheduling.
- Host-initiated "Add Bot" / "Remove Bot" (pre-game only), with a per-bot
  Easy/Normal/Hard difficulty selector (default Normal).
- A new cached TMDB person-filmography lookup (mirrors the existing credits
  cache pattern).
- Socketless-player hardening of existing per-socket targeted emits.
- Lobby lifecycle rule: last human leaving cleans up the lobby (no bot-only
  ghost games).
- Bots in **regular multiplayer and hardcore** modes.
- Automated tests (unit + turn-loop integration + difficulty-table invariants)
  and an explicit manual playtest acceptance gate.
- WHY-comments on every code change (project convention).

### Out of scope (explicit)
- Accounts / friends / game-history (dropped — see Status above).
- Phase 5b (local fallback movie DB) — separate spec/plan/build cycle.
- Bots in the **daily challenge** (daily stays a personal solo challenge;
  daily lobby IDs embed a truncated `stableId` — left untouched).
- Bot chat / personality / banter.
- ML or LLM move selection (pure heuristic over TMDB filmographies).
- Auto-matchmaking / auto-filling *public* lobbies without host action.
- Adding bots mid-game (pre-game only, mirroring that humans don't join
  mid-game either).
- The L8 Redis turn-timer rework (separate robustness backlog item, not growth).
- More than 3 difficulty presets, or runtime-tunable difficulty UI beyond the
  3-way selector.

---

## 3. Current Architecture (grounding)

Verified against the codebase on 2026-05-17. The implementation plan must
re-confirm exact line numbers by reading the code; functions/files below are the
integration contract.

- **A turn:** human emits `submitMovie` → `socketHandlers.js` handler →
  `matchSystem.submitMovie`. Turn ownership is checked positionally:
  `room.players[room.currentTurnIndex].id === socket.id`.
- **Submit pipeline:** `acquireSubmitLock` (Redis-backed, cross-instance) →
  `resolveCandidates` (TMDB search/details) → `enrichWithCredits` →
  `validateChainConnection` → `commitPlay` (pushes `room.chain`, +100 score,
  records `room.usedMovies`) → `gameLogic.nextTurn`.
- **`nextTurn`** (`gameLogic.js`): runs `checkWinCondition`, advances
  `currentTurnIndex = (i+1) % players.length` skipping `!isAlive` players,
  `resetTimer`, `armTurnTimeout`, `broadcastState`. Turn-skip checks **only**
  `isAlive` — a bot in `players[]` takes turns automatically; nothing advances
  *for* it, so it needs an explicit move driver hooked at its turn.
- **Move validity:** `gameLogic.validateConnection` — movie A connects to B iff
  their `cast` arrays share an actor (`_sameActor`: TMDB id-equality preferred,
  else case-insensitive name). Hardcore additionally excludes cumulative
  previously-used connectors via `room.previousSharedActors`. Cast comes solely
  from `getOrFetchCredits`.
- **Credits cache:** `getOrFetchCredits` (`redisUtils.js`) caches at
  `credits:v2:{mediaType}:{tmdbId}`, 7-day TTL, with an NX stampede lock
  `{key}:fetching`.
- **Turn timer / recovery:** `armTurnTimeout` (per-lobby in-process watchdog,
  submit-lock-guarded, fires ~4000 ms past `turnTime`), steady-state
  `sweepMissingTurnWatchdogs` (~every 30 s), boot `recoverActiveTurns`.
- **Identity:** players carry a client-generated `stableId`;
  `gameLogic.toClientState` strips `stableId` from broadcasts. Bots need no
  `stableId` and no socket.
- **Player cap:** max 8 players (constant duplicated across ~3 files per the
  2026-05-16 review) — `addBot` must respect the *same* cap.
- **Cleanup:** lobby teardown keys on `players.length === 0`; that never
  triggers if only bots remain → an explicit last-human rule is required.

---

## 4. The Core Problem & Chosen Approach

A bot's hard problem is **finding a valid move**: a movie sharing a cast member
with the last chain movie, not already used, and (hardcore) not via an excluded
connector.

**Approaches considered:**

- **A — TMDB person-filmography pathfinding (CHOSEN).** From the last movie's
  already-enriched cast, pick a shared-actor candidate, fetch *that actor's*
  filmography via a new cached `/person/{id}/movie_credits` lookup, filter to
  unused / non-excluded / sufficiently-popular titles, pick one, then push it
  through the **existing** resolve→enrich→validate→commit→nextTurn pipeline.
  Valid *by construction* (the chosen actor is in both films). Reuses every
  existing game rule; the bot only *proposes* a movie, the engine validates and
  commits. One new TMDB call type, mitigated by the existing 7-day Redis cache
  pattern and later by 5b's fallback DB.
- **B — Curated local connection graph.** Bundle a movie+cast dataset / adjacency
  graph; pathfind offline. Rejected: large new data artifact, bot trapped in a
  fixed universe (constantly "stuck" when a human plays anything outside it),
  duplicates the connection concept outside the engine.
- **C — Brute-force the existing popular pool.** Repeatedly pick from the pool
  and validate until something connects. Rejected: many wasted credit-fetches
  per turn (slow, rate-limit risk), frequently finds nothing, feels dumb.

**Decision: Approach A** — the only option giving reliably-valid, natural moves
with minimal new surface, full reuse of the rules engine, and clean composition
with 5b.

---

## 5. Components (`server/systems/botSystem.js`)

A bot is a normal `room.players[]` entry with **no socket**:
`{ id: 'bot_<n>', name, isBot: true, isAlive: true, score: 0, difficulty,
... }` (shape otherwise mirrors a human player entry so existing player-iteration
code treats it uniformly).

1. **Factory & lifecycle** — create a bot with a recognizable themed name and a
   non-deceptive `BOT` label; remove a bot (host, pre-game). Names are distinct
   per lobby.
2. **Move generator — `generateBotMove(room, profile, rng)`** — pure-as-possible:
   reads the last enriched chain movie's cast, selects a shared-actor candidate,
   reads that actor's cached filmography, filters out `room.usedMovies` and
   (hardcore) excluded connectors, applies the profile's popularity floor, and
   returns a chosen movie descriptor or `null` (no move found / whiffed). Takes
   an **injected RNG** so whiff/selection are deterministically testable.
3. **Internal submit driver — `submitBotMove(room, ...)`** — mirrors
   `submitMovie` minus the socket-identity gate: takes `acquireSubmitLock`, then
   calls the *existing* resolve/enrich/validate/commit functions and
   `gameLogic.nextTurn`. No game rules are reimplemented; a bot proposal that
   somehow fails validation is retried up to the profile's retry cap, then the
   bot whiffs (graceful elimination, below).
4. **Turn hook** — when `nextTurn` lands on a player with `isBot === true`,
   schedule `submitBotMove` after a randomized "thinking" delay drawn from the
   profile's delay window. The delay distribution is bounded so a Normal/Hard
   bot is unlikely to self-time-out, but an Easy bot often does (by design).

---

## 6. Difficulty Levels

Selected per-bot when the host adds it (default **Normal**). Difficulty is a
**named parameter set** read by the move generator — *no branching code paths*,
just one `BOT_DIFFICULTIES` table:

| Knob | Easy | Normal | Hard |
|---|---|---|---|
| **Whiff %** (per-turn blank chance, even when a move exists) | ~45% | ~25% | ~8–10% |
| **Delay window** | long, swingy (often self-times-out) | comfortable, occasionally tight | tight, rarely self-times-out |
| **Popularity floor** (pick recognizability) | high — very mainstream, easy human follow | medium | low — plays deep cuts; tougher follow / can "poison" hardcore chains |
| **Retry cap** before whiffing | 1 | 2 | 3 |

**Core invariant (the answer to "is it just the best player ever?"): every
profile's whiff probability is strictly `> 0` and `< 1`, including Hard.** No
difficulty can ever produce an unbeatable perfect-recall bot. This is a spec
invariant **and** a unit test: for every profile `0 < whiff < 1`, plus monotonic
ordering `whiffEasy > whiffNormal > whiffHard`.

Starting numbers above are **tuning targets** to validate in the playtest gate
(§10), not final guarantees; they live in code so re-tuning is a one-line change.

---

## 7. Balance & Fun

A naive bot with filmography access would be literally unbeatable (perfect,
instant recall ⇒ never times out, never blanks, never repeats ⇒ wins every
last-player-standing game by attrition). Fun therefore comes from *deliberate
handicaps*:

- **Whiff rate** is the primary beatability lever: a configured probability of
  "blanking" each turn even when a valid move exists; on a whiff the bot does
  not submit and is eliminated like any timed-out human.
- **Realistic delay** that occasionally runs long enough to actually cost the
  turn — so the clock genuinely matters against the bot.
- **Recognizable picks**: filter the actor's filmography toward well-known
  titles (TMDB `popularity` / `vote_count` ≥ the profile's floor). An
  encyclopedia that always plays the obscurest valid film feels unfair and
  strands the next human.
- **No hidden information**: the bot uses only the public chain everyone sees
  (there is nothing private to peek at — stated explicitly so future changes
  preserve it).
- **Bounded retries**: never loops until it finds a perfect move.

---

## 8. Socketless Hardening & Multi-Instance Safety

**Targeted-emit guards.** Every *per-socket targeted* emit must no-op safely for
a socketless/bot recipient (room-wide broadcasts are already safe). At minimum:
`youWereEliminated`, `submissionRejected`, the `kickPlayer` socket lookup, and
`peerTyping`. A bot never needs to *receive* anything.

**Multi-instance.** The bot move timer is in-process, like the existing turn
watchdog. Reuse the existing pattern rather than inventing coordination: the bot
submit goes through `acquireSubmitLock` (Redis-backed, cross-instance) and the
steady-state turn sweep. If two instances race a bot move, one wins the lock and
the other no-ops (turn already advanced / not the bot's turn). This is the same
soft-lock family the sweep already solves; no new cross-instance primitive.

---

## 9. Lifecycle & Error Handling

- **Bot can't move / whiffs / TMDB unavailable:** the bot is eliminated
  **gracefully via the existing turn-timeout/eliminate path** — the game keeps
  progressing, the outcome is fair (a stuck human is eliminated too), nothing
  crashes or stalls.
- **Last human *disconnects* from a bot-containing lobby:** the lobby is cleaned
  up (no bot-only game running to nobody). Triggered off the human-disconnect
  path, replacing reliance on `players.length === 0`. ("Disconnect" =
  socket drop / leave, distinct from in-game elimination below.)
- **Last human *eliminated* but still connected (bots still alive):** the game
  **continues to a winner via the existing engine** (bots play on); the
  eliminated human spectates the room-wide result broadcast like any eliminated
  player. No early-end special case — chosen for engine reuse and because the
  human still gets a resolved outcome. Cleanup only happens on *disconnect*, not
  on elimination.
- **Win/lose "just works":** bots are players with `isAlive`, so
  `checkWinCondition` already resolves 1-human-vs-bots, human-eliminated-first,
  and bot-vs-bot-to-a-winner with no new win logic.
- **Add Bot validation:** host-only, pre-game only, rejected if it would exceed
  the 8-player cap or if the game has started; difficulty value validated
  against the known set (default Normal on missing/invalid).

---

## 10. Testing Strategy

Automated (`server/systems/botSystem.test.js`, TMDB mocked per existing
`matchSystem.test.js` patterns):

1. **Difficulty-table invariants:** all three profiles present; for each
   `0 < whiff < 1`; monotonic `easy > normal > hard`.
2. **Move generation (parametrized by profile, seeded RNG):** returns a valid,
   unused, non-excluded, popularity-floor-respecting pick when one exists;
   returns `null` on forced whiff and when no move exists; honors hardcore
   connector exclusion.
3. **Turn-loop integration:** lobby with 1 human + 1 bot — human submits, bot
   auto-moves via the internal driver; assert `room.chain` grew, score +100,
   `usedMovies` updated, `broadcastState` emitted, **no crash on the socketless
   bot**, and the bot-elimination path does not throw on a missing socket.
4. **Lifecycle:** last human disconnects from a bot-containing lobby → lobby
   cleaned up.
5. **Edge:** forced bot whiff → graceful elimination, game continues, next
   `isAlive` player gets the turn.

Suite stays green; coverage ratchet floors hold.

**Manual playtest acceptance gate (required — "fun" is not unit-testable).**
Before the phase is considered done, a human-vs-bot playtest in **regular and
hardcore** confirms: Easy bots frequently eliminate themselves; Normal is a fair
fight; Hard is punishing but a human can still win (no profile is unbeatable);
pacing feels human, not instant; picks are recognizable; no crashes. Because the
suite mocks Redis/TMDB and nothing here exercises a real boot or real browser,
real-boot + this playtest verification are **outstanding until the user merges
and Render is checked** (per the validated workflow).

---

## 11. Files (approximate — the plan pins exact line targets)

**Create**
- `server/systems/botSystem.js` — factory/lifecycle, `generateBotMove`,
  `submitBotMove`, turn-hook scheduling, `BOT_DIFFICULTIES`.
- `server/systems/botSystem.test.js` — the automated suite above.

**Modify**
- `server/redisUtils.js` — add `getOrFetchPersonCredits(personId)` mirroring
  `getOrFetchCredits` (key `personcredits:v1:{id}`, 7-day TTL, NX stampede lock).
- `server/systems/lobbySystem.js` — `addBot` / `removeBot` (host, pre-game,
  cap-checked); last-human cleanup rule.
- `server/socketHandlers.js` — `addBot` / `removeBot` socket events (host-gated);
  guard the targeted emits in §8.
- `server/gameLogic.js` — in `nextTurn`, when the new current player `isBot`,
  invoke the bot turn-hook (schedule `submitBotMove`).
- `server/systems/matchSystem.js` — expose / reuse the internal resolve-enrich-
  validate-commit core for `submitBotMove` without duplicating rules.
- `public/js/` (lobby + player-list modules) — host "Add Bot" control with a
  3-way difficulty selector; render bots with a `BOT · <Difficulty>` label; a
  lightweight "thinking…" affordance on a bot's turn (reuse the existing
  peer/typing indicator).
- `public/css/` — only if needed, a small **additive** `.bot-badge` rule
  (Phase 4 additive-only CSS discipline; no existing rule modified).

Exact insertion points, the shared-core extraction boundary in
`matchSystem.js`, and the 8-player-cap constant source are decisions for the
implementation plan after reading current code.

---

## 12. Process Notes

Ships via the validated pipeline used for Phases 1–4: **spec → writing-plans →
subagent-driven-development → finishing-a-development-branch**.

- Spec committed to `main` locally (this document). The plan +
  `.md.tasks.json` will likewise be committed to `main`, then a **feature
  branch `phase5a-bot-opponents` off `main`** (not a worktree, not stacked on
  any other branch) for all implementation commits.
- Native Task tools are unavailable here → TodoWrite for in-session tracking +
  hand-authored co-located `.md.tasks.json`; a task is marked `completed` only
  after **both** its per-task reviews pass.
- Per task: dispatch implementer with full task text + exact code; then an
  **independent spec-compliance review**, then an **independent code-quality
  review**; fix-loop until both pass. Final **opus whole-branch holistic
  review** before finishing.
- WHY-comments on every changed line.
- Out-of-scope findings surfaced during reviews → spawn a task chip, do **not**
  expand this phase's scope.
- `coverage/` stays untracked (never `git add`).
- Finishing: push the feature branch + `gh pr create` (base `main`). The
  PR-merge / push-to-main / Render production deploy is classifier-gated and
  **handed to the user** — not performed here. After merge, verify the Render
  deploy is `live` (read-only) and complete the manual playtest gate (§10).
