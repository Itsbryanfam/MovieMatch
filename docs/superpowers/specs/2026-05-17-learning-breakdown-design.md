# Phase 5b — Post-Game Learning Breakdown: Design Spec

**Date:** 2026-05-17
**Status:** Approved (brainstorming) — proceeding to implementation plan
**Phase:** First slice of a post-remediation **growth bundle** sourced from a
Codex idea pass. See §1 for the portfolio triage (the decision record for *all*
12 proposed ideas) and the bundle decomposition.

---

## 1. Portfolio Triage & Decomposition (decision record)

Codex proposed 12 features. Each was checked against the **actual** codebase on
2026-05-17 (not Codex's assumptions). Two reality checks reshaped the list:

- **Codex's #1 "Bot Quickplay" was already ~5/6 built and is now fully shipped.**
  Phase 5a bots merged via PR #18 (all 7 tasks incl. the Add-Bot client UI) +
  follow-up PR #19; `origin/main` HEAD `4e1372b`. Nothing to do.
- **Codex's #3 "local movie connection graph" (a P0) is dropped as YAGNI.** Its
  stated justifications — faster bots, stable dailies, lower TMDB dependency —
  are *already solved*: bots run on Redis-cached TMDB person-filmography
  (`credits:v2:*` / `personcredits:v1:*`, 7-day TTL), the Daily is deterministic
  with 553 committed entries, and credits/search are cache-backed. It is a large
  new data subsystem for problems the existing cache layer already mitigates.

**Verdict on all 12:**

| Codex idea | Verdict | Grounded reason |
|---|---|---|
| Bot Quickplay (P0) | **DONE** | Shipped: Phase 5a PR #18 + #19, in `main`. |
| Post-Game Learning Breakdown (P0) | **DO — this spec (5b)** | Today only a cast comparison exists (H3). The mastery lever ("what *would* have worked") is missing and cheap — reuse merged bot pathfinding read-side. |
| Achievements + Titles (P1) | **DO — 5c** | Pure derivation over `statsSystem` anonymous stats; cheap identity loop, no new persistence/accounts. |
| Custom Rule Kits (P0, constrained) | **DO — 5d** | Presets over the existing `themesSystem` (7 genre/decade filters) + mode rules. Data-heavy presets (awards/franchise) stay out — no such data exists. |
| Local connection graph (P0) | **DROP** | Premises already solved by Redis cache + deterministic daily. |
| Movie Atlas / Discovery Book (P2) | **DROP** | Niche; conceptually couples to the dropped graph. |
| Ranked Duel / Season Ladder (P0) | **DEFER** | Whole new subsystem (MMR/queue/seasons); needs a player base; sequence after the on-ramp proves out. |
| Shareable Challenge Links (P1) | **DEFER** | Strong viral upside; extends the existing canvas share card — own later phase. |
| Weekly Events & Streaks (P1) | **DEFER** | Cleanly extends Daily + soloObjectives; additive content loop, second-tier. |
| Opt-In Power-Up Mode (P1) | **DEFER** | Many balance-heavy mechanics; big and risky, not foundational. |
| Audience Mode 2.0 (P1) | **DEFER** | Modifier-voting depends on Power-Up Mode; coupled to a deferred item. |
| Streamer/Party Controls (P2) | **DEFER** | Incremental hosting polish; do opportunistically, not as a headline. |

**Decomposition.** The three DOs form one coherent retention loop —
*lose → learn why → earn a title → set a themed rule kit and replay* — but four
features is far too large for one spec, and this project's validated workflow is
strictly **one phase = one spec → plan → subagent build → PR**. So the bundle is
sequenced into independent sub-phases, each its own spec/plan/build cycle:

- **5b — Post-Game Learning Breakdown** (this spec; highest retention depth, and
  it directly compounds the just-shipped bots: practice only improves you if
  losing teaches you something).
- **5c — Achievements + Titles** (cleanest; pure read-side derivation over
  existing stats).
- **5d — Constrained Custom Rule Kits** (party identity over existing themes).

This is a new growth initiative, distinct from the original 5-phase
post-2026-05-16-review remediation (Phases 1–4 shipped; remediation Phase 5 =
5a bots, shipped; the remediation's planned "5b local fallback movie DB" was
dropped — see reality check above, premises already solved).

---

## 2. Goal & Motivation

The competitive game is a knowledge game, and the strongest retention loop in a
knowledge game is **mastery**: a player who understands *why* they lost and sees
*what would have worked* comes back to do better. This compounds the just-shipped
bots — practicing against a bot only improves a player if losing is instructive.

Today, on an invalid-connection elimination, the eliminated player already gets a
private full-screen card with a **side-by-side cast comparison** ("your movie's
cast" vs "the movie you tried to connect to" — so they can see the two share no
actor). This is the **H3** learning surface (shipped 2026-05-04).

What it does **not** show is the actionable part: **a real movie that *would*
have connected.** "These two casts don't overlap" tells you that you were wrong;
it doesn't show you what right looked like.

**Goal:** Extend the existing H3 `youWereEliminated` surface with **one valid
move the player could have made** from the last chain movie — computed read-side
by reusing the merged Phase 5a bot pathfinding — rendered beneath the existing
cast comparison.

**Non-goal:** redesigning the elimination screen, adding stats/recap widgets, or
changing how anyone else experiences an elimination.

---

## 3. Scope

### In scope
- Extend the **existing** private `youWereEliminated` payload (emitted at
  `matchSystem.js:~257` on the invalid-connection path) with an optional
  `couldHavePlayed: { title, year, via? }`. `title` + `year` are the core
  value; `via` (the shared actor name linking it to the last chain entry) is
  included **only if obtainable read-only without modifying `botSystem`**,
  otherwise omitted — the suggestion is still useful as just a movie.
- Compute it **read-side** by calling the merged, exported
  `botSystem.generateBotMove(room, profile, deps)` against the room's state at
  elimination (the last chain entry is exactly the connection target the human
  failed), then resolving the returned `{ tmdbId, mediaType }` to a display
  `{ title, year }` via the **existing** cached title/credits resolution path.
- Extend the **existing** detailed `showSelfEliminationScreen(details)` card
  (`public/js/ui/ui-notifications.js:~43`) to render that one suggestion below
  the existing `self-elim-grid` cast comparison **when present**.
- Best-effort + time-boxed + failure-swallowed (see §6).
- Extend the existing H3 test coverage (`matchSystem.test.js` H3 `describe`) and
  add a client render assertion.
- WHY-comments on every code change (project convention).

### Out of scope (explicit)
- Any change to the **broadcast** `notification {kind:'elimination'}` /
  `attemptFailed` events that everyone else receives.
- The breakdown on **timeout / disconnect / quit** eliminations — those have no
  failed guess to learn from; they keep the existing generic screen
  (`details`-absent legacy path), unchanged.
- More than **one** suggestion; an alternate-move tree; ranking suggestions.
- A "strongest connector in the chain" stat or any chain-map/recap widget — a
  chain replay (`playChainReplay`) and a share card (`ui-sharecard.js`) already
  exist elsewhere and are **not** duplicated here.
- Persisting, storing, or sharing breakdowns; any new Redis key or datastore.
- Any change to bot move logic, difficulty tables, validation, or scoring
  (`generateBotMove` is consumed strictly read-only).
- 5c (Achievements/Titles) and 5d (Custom Rule Kits) — separate specs/plans.

---

## 4. Current Architecture (grounding)

Verified against the codebase on 2026-05-17. The implementation plan must
re-confirm exact line numbers by reading the code; the contract below is what
matters.

- **Invalid-connection elimination (H3 server):** in `matchSystem.js` (~:257),
  when a submitted movie shares no cast with the last chain entry, the server
  emits, **to the failing socket only**, `socket.emit('youWereEliminated', {
  yourGuess: { title, year, cast: [≤10 names] }, lastChainEntry: { title,
  cast: [names] }, reason })`. Everyone else gets the room-wide
  `notification {kind:'elimination'}` (and `attemptFailed`) — unchanged here.
- **Eliminated-player screen (H3 client):** `socketClient.js` buffers the
  payload as `pendingEliminationDetails`; events arrive in the order
  `youWereEliminated → notification → stateUpdate`, and the buffered details are
  consumed when the `stateUpdate` alive→dead transition is detected, calling
  `showSelfEliminationScreen(details)`. `selfElimActive` suppresses the generic
  overlay for ~3 s so the screen owns the stage.
- **The screen renderer:** `ui-notifications.js:~43`
  `showSelfEliminationScreen(details)`. If `details`/`lastChainEntry`/`yourGuess`
  are absent → brief legacy flash (timeout/disconnect/quit path). Otherwise →
  detailed `self-elim-card` with a two-column `self-elim-grid` cast comparison +
  `reason` subtitle + close button. **The UI already degrades gracefully when
  fields are absent** — the basis for making the new field optional.
- **Bot pathfinding (reused read-side):** `botSystem.generateBotMove(room,
  profile, deps)` (`botSystem.js:138`, exported at `:319`). Returns a chosen
  `{ tmdbId, mediaType }` or `null`. It reads the last enriched chain movie's
  cast, picks a shared actor, reads that actor's **cached** filmography, and
  filters out `room.usedMovies` and (hardcore) excluded connectors — so any move
  it returns is **valid under the room's actual mode by construction**. `profile`
  is a `BOT_DIFFICULTIES` entry; `deps` carries an injectable RNG.
- **Title resolution:** the existing submit pipeline already resolves a tmdbId to
  title/year via the cached credits/details path (`getOrFetchCredits` /
  `resolveCandidates` in `matchSystem.js`); the suggestion reuses this — no new
  TMDB call type.

---

## 5. Core Problem & Chosen Approach

The only hard part is "what is *a* movie that would have connected from the last
chain entry?" — which is exactly the problem Phase 5a already solved for bots.

**Approaches considered:**

- **A — Reuse `generateBotMove` read-side at elimination (CHOSEN).** At the H3
  emit site, before emitting, call `generateBotMove` against the *current room*
  (its last chain entry is the failed connection target) with a fixed permissive
  profile and a deterministic RNG (so tests are stable and we don't want
  whiffing here — we want it to *find* a move). Resolve the returned id to
  `{ title, year }` via the existing cached path; include the shared actor as
  `via`. Valid by construction; reuses merged, already-tested machinery; one new
  optional payload field; zero new game rules or TMDB call types. Automatically
  honors hardcore exclusion / used-movies because `generateBotMove` reads room
  state (a free correctness win, not extra scope).
- **B — Precompute a valid continuation each turn during normal play.** Rejected:
  adds work to the hot submit path for a feature only used on elimination; new
  per-room state; YAGNI.
- **C — Brute-force the popular pool at elimination until one validates.**
  Rejected: the same wasted-fetch / rate-limit problem the Phase 5a spec already
  rejected for bots; slow; frequently finds nothing.

**Decision: Approach A** — minimal new surface, full reuse of the rules engine
and the Phase 5a pathfinder, clean isolation.

---

## 6. Error Handling, Performance & UX Bounding

The new computation must **never** degrade the existing elimination experience.

- **Best-effort:** the suggestion is wrapped so any error (`generateBotMove`
  throws, returns `null`, title resolution fails) results in the field being
  **omitted** — the existing payload and screen render exactly as today (the
  legacy-graceful UI proves this is safe).
- **Time-boxed:** the suggestion computation is bounded by a short timeout
  (exact value chosen in the plan; small — a few hundred ms). On timeout →
  omit. Filmography is Redis-cached so the common (cache-hit) case is fast; a
  cache-miss simply yields no suggestion rather than stalling.
- **No room-wide stall:** only the **private** `youWereEliminated` emit is
  affected. Everyone else's broadcast `notification`/`attemptFailed` is emitted
  on its existing path, unblocked. The client only shows the screen on the
  `stateUpdate` alive→dead transition (one round-trip *after* `youWereEliminated`
  per the documented event ordering), so a sub-second delay on the private emit
  is masked and never delays the room.
- **Socketless safety:** unaffected — a bot is never the *recipient* of
  `youWereEliminated` (bots have no socket; the emit is `socket.emit` to the
  failing human only). No socketless-guard work needed.

---

## 7. Components & Data Flow

1. **Server (`matchSystem.js`, at the existing H3 emit ~:257):** before the
   existing `socket.emit('youWereEliminated', …)`, run a best-effort, time-boxed
   helper: `generateBotMove(room, <permissive profile>, { rng: <deterministic> })`
   → if a move is returned, resolve `{ tmdbId, mediaType }` → `{ title, year }`
   via the existing cached resolver, and capture the shared actor name as `via`
   **only if it falls out read-only** (no `botSystem` signature change).
   Add `couldHavePlayed: { title, year, via? }` to the existing payload object.
   On any miss/error/timeout, emit the existing payload unchanged (no field).
2. **Wire (unchanged event):** still the one private `youWereEliminated` event;
   only an optional extra field. No new event, no client buffering changes
   (`pendingEliminationDetails` carries it through as-is).
3. **Client (`ui-notifications.js`, detailed path of
   `showSelfEliminationScreen`):** after building the `self-elim-grid`, if
   `details.couldHavePlayed` is present, append one additive block — e.g.
   *"You could have played **{title} ({year})**"*, appending *" — connected
   via {via}"* only when `via` is present. When `couldHavePlayed` is absent,
   the card is byte-for-byte today's card.

Each unit is independently understandable and testable: the server helper is a
pure-ish best-effort enricher over room state; the client change is an additive
conditional render; neither alters existing behavior when the field is absent.

---

## 8. Testing Strategy

Automated (TMDB/bot mocked per existing `matchSystem.test.js` H3 patterns):

1. **Payload — suggestion present:** invalid-connection elimination where a
   valid continuation exists (mock `generateBotMove` → a known id; mock the
   resolver → known title/year) ⇒ `youWereEliminated.couldHavePlayed` has the
   expected `{ title, year }` (and `via` when the read-only path yields it);
   **all existing H3 assertions still pass** (the new field is purely additive
   to the existing payload).
2. **Payload — graceful omission:** `generateBotMove` returns `null` /
   throws / exceeds the time box ⇒ payload emitted **without**
   `couldHavePlayed`; existing fields and the broadcast `notification` are
   unaffected; nothing throws.
3. **No regression on non-H3 eliminations:** timeout/disconnect/quit path emits
   no `youWereEliminated` (unchanged) and triggers no suggestion computation.
4. **Client render:** `showSelfEliminationScreen` with `couldHavePlayed`
   present renders the suggestion block; absent → the existing detailed card is
   unchanged; the legacy no-`details` flash path is untouched.

Suite stays green; coverage ratchet floors hold. Because the suite mocks
Redis/TMDB and nothing here exercises a real boot or real browser, real-boot
verification and an in-browser eyeball of the elimination card are **outstanding
until the user merges and Render is checked** (per the validated workflow); this
touches the `matchSystem` submit/elim path so that gate explicitly applies.

---

## 9. Files (approximate — the plan pins exact line targets)

**Modify**
- `server/systems/matchSystem.js` — at the existing `youWereEliminated` emit:
  best-effort, time-boxed `couldHavePlayed` enrichment via read-only
  `botSystem.generateBotMove` + the existing cached title resolver; add the
  optional field; omit on any miss/error/timeout.
- `public/js/ui/ui-notifications.js` — in the detailed
  `showSelfEliminationScreen` path, additively render the `couldHavePlayed`
  block when present.
- `server/systems/matchSystem.test.js` — extend the H3 `describe` with the
  present / gracefully-omitted cases above; assert existing H3 assertions still
  hold.
- Client test for `showSelfEliminationScreen` (same location as the existing
  self-elim render test) — present vs absent vs legacy paths.
- `public/css/` — only if needed, a small **additive** rule for the suggestion
  block (Phase 4 additive-only CSS discipline; no existing rule modified).

The shared-actor (`via`) source, the exact permissive profile/RNG passed to
`generateBotMove`, the title-resolver entry point, and the timeout value are
decisions for the implementation plan after reading current code.

---

## 10. Process Notes

Ships via the validated pipeline used for Phases 1–5a: **spec → writing-plans →
subagent-driven-development → finishing-a-development-branch**.

- This spec is committed to `main` locally. The plan + co-located
  `.md.tasks.json` will likewise be committed to `main`, then a **feature branch
  `phase5b-learning-breakdown` off `main`** (not a worktree, not stacked on any
  other branch) for all implementation commits.
- Native Task tools are unavailable here → TodoWrite for in-session tracking +
  hand-authored co-located `.md.tasks.json`; a task is `completed` only after
  **both** its per-task reviews pass.
- Per task: dispatch the implementer with the full task text + exact code; then
  an **independent spec-compliance review**, then an **independent code-quality
  review**; fix-loop until both pass. Final **opus whole-branch holistic
  review** before finishing.
- WHY-comments on every changed line.
- Out-of-scope findings surfaced during reviews → spawn a task chip; do **not**
  expand this phase's scope (5c/5d are already specced out as separate phases).
- `coverage/` stays untracked (never `git add`).
- Finishing: push the feature branch + `gh pr create` (base `main`). The
  PR-merge / push-to-main / Render production deploy is classifier-gated and
  **handed to the user** — not performed here. After merge, verify the Render
  deploy is `live` (read-only) and eyeball the elimination card in-browser.
