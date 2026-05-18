# Phase 7.2 — Feedback-layer Split: Design Spec

**Date:** 2026-05-17
**Status:** Approved (brainstorming) — proceeding to writing-plans.
**Phase:** **7.2** — the second slice of **Phase 7 (UI/UX Elevation)**, decomposed in `docs/superpowers/specs/2026-05-17-phase7-uiux-elevation-design.md` §2. Sequenced second (first infra slice) because several later phases need a non-cinematic feedback channel. Source: Codex Pass 1 **MI-01** (cinematic-notification overload) + **CG-03** (search/validation feedback erases submission intent).

---

## 1. Context & provenance (grounded, file:line)

- **One generic text overlay:** `#notification-overlay` → `showNotification()` ([public/js/ui/ui-notifications.js:11](public/js/ui/ui-notifications.js:11)) — a 3 s centred takeover used for room-wide info.
- **Genuine cinematic beats (legit, stay):** `showSelfEliminationScreen` ([ui-notifications.js:43](public/js/ui/ui-notifications.js:43), Phase 7.1), `showWinFlash` ([:192](public/js/ui/ui-notifications.js:192)), `showConfetti` ([:209](public/js/ui/ui-notifications.js:209)), `showEliminationFlash` ([:25](public/js/ui/ui-notifications.js:25)).
- **A toast primitive already exists:** `.copy-toast` / `showToast()` ([ui-notifications.js:307](public/js/ui/ui-notifications.js:307); CSS `public/css/06-states-anim.css:1010`) — used today for copy confirmations + prediction results.
- **A modal system already exists:** `.modal-overlay` / `.modal-card` (`public/css/04-modals.css:150`), used by share / how-to / credits / leaderboard / my-stats / daily-result.
- **Room-wide event:** `'notification'` `{ msg, kind: 'elimination'|'win'|'info' }` (`server/gameLogic.js:165,192,511,629`). Client branch-on-`kind` dispatcher: `socketClient.js:492–537` → `showNotification`/`showEliminationFlash`/`showWinFlash`/`showConfetti`; the `selfElimActive` suppression guard at `socketClient.js:507` prevents text-overlay overlap with the 7.1 self-elim screen.
- **Private events:** `youWereEliminated` (`server/gameLogic.js:223`; `server/systems/matchSystem.js:256–272`) buffered as `pendingEliminationDetails`, consumed on `stateUpdate` (`socketClient.js:258–298`, `:287` → `showSelfEliminationScreen`). `submissionRejected` `{ reason, message, retriesLeft, originalInput }` (`matchSystem.js:195`) private → `socketClient.js:653–703` re-enables input, restores typed text, shows `.copy-toast`. `attemptFailed` (`matchSystem.js:250`) room-wide → `showGhostAttempt`. `predictionResult` → `showToast`.
- **CG-03 today:** submit flow (`public/js/app.js:548–563`) emits `submitMovie`, **clears + disables** the input and sets the hint to a static "Validating connection…"; the typed title vanishes for the whole TMDB round-trip and is only restored on `submissionRejected`. The debounced typeahead (`app.js:596–619` → `autocompleteResults`) shows no in-flight indicator.
- **7.3-owned, do not touch:** the three ad-hoc inline-styled name overlays `showNamePrompt` (`app.js:289–340`), `showJoinPrompt` (`app.js:342–437`), `showDailyNamePrompt` (`ui-panels.js:447–517`) — Phase 7.3 / MI-02 consolidates these.
- **CSS partial load order** (`public/index.html:68–73`): `01-base` → `02-hero-lobby` → `03-game` → `04-modals` → `05-responsive` → `06-states-anim`. `06-states-anim.css` owns all notification/state-animation CSS; `04-modals.css` owns the modal system. **All new 7.2 CSS goes only in `06-states-anim.css`.**
- **Recorded 7.3 CSS deferrals — leave inert:** `.self-elim-outs*`/`.self-elim-bridge` (rendered at `ui-notifications.js:132–151`, no CSS yet) and the orphaned `.self-elim-could` rule (`06-states-anim.css:1085`).

## 2. Goal & non-goals

**Goal:** introduce a small **client-side feedback router** that splits the conflated cinematic notification into well-defined channels so non-dramatic feedback stops borrowing the cinematic surface (MI-01), and keep the player's submission intent visible during validation (CG-03). This is **enabling infra** — later sub-phases (7.4 copy, 7.5/7.6 flows) get a stable calm-feedback API instead of re-hitting this wall.

**Three-channel taxonomy, two of which 7.2 builds:** the target end-state is three distinct feedback concepts — transient **toasts**, dramatic **game-event overlays**, persistent **modal result states**. Grounded in the code, the modal channel **already exists independently** as `.modal-overlay`/`.modal-card` (`04-modals.css`) and **no current call site mis-routes a result state through the cinematic notification** — so 7.2's router builds only the two channels with mis-routed traffic to rescue (`toast`, `gameEvent`) plus the CG-03 pill. A `modalResult` wrapper with zero 7.2 callers would be speculative dead code (YAGNI); it is deferred to the first later phase with a concrete programmatic-modal need (7.6 Premiere Recap / 7.9 Wrapped own the rich post-game result work).

**Non-goals:** no new socket event; **no server change**; no scoring/validation/rule change; no restyle of elimination/win/self-elim visuals (7.1 just shipped; feel is owned by 7.4/7.7); no touching the three name prompts (7.3/MI-02); no new modal infrastructure (reuse the existing `.modal-overlay`); no sweep of the recorded 7.3-deferred CSS; no persistence/accounts.

## 3. Design (Approach B — full router + the one bounded reclassification)

### 3.1 `public/js/ui/feedback.js` — the channel router (new module)
A thin **policy** layer that imports the existing primitives from `ui-notifications.js` (the primitives stay where they are — zero churn to just-shipped 7.1 code). Exports exactly two functions:

- `toast(message, { variant = 'info' } = {})` — `variant ∈ {'info','error','success'}`. Transient, non-blocking, auto-dismissing. Generalises the existing `showToast`; variant styling is additive CSS in `06-states-anim.css`.
- `gameEvent(kind, payload)` — the dramatic channel. Wraps `showNotification`/`showEliminationFlash`/`showWinFlash`/`showConfetti` with the **exact** branching `socketClient.js:492–537` performs today, including the `selfElimActive` suppression. Behaviour-preserving by construction.

**Not exported (deliberate):** a `modalResult` wrapper. The modal-result channel is the pre-existing `.modal-overlay`/`.modal-card` system; nothing in 7.2 mis-routes to it, so a router wrapper would be unused. The first later phase that needs programmatic modal results (7.6/7.9) adds it then, with a real caller.

### 3.2 CG-03 submission pill
A persistent inline pill in the input-area:
- On submit: show `Checking: "<title>"` so the player's intent stays visible (replaces the cleared box + static "Validating connection…" hint).
- Debounced typeahead in flight: a lighter `Searching…` state.
- Resolution: **success** → pill clears; **`submissionRejected`** → pill clears, typed text restored from `originalInput`, `toast(message, { variant:'error' })` (the existing 3-retry semantics and `retriesLeft` copy are unchanged); **elimination** (`youWereEliminated`) → pill cleared, the existing 7.1 self-elim path is untouched.
- The pill is `aria-live="polite"` and rendered with `textContent` only (no `innerHTML`).

### 3.3 Call-site migration (bounded; behaviour-preserving except §3.4)
- `socketClient.js:492–537` `notification` dispatcher → `gameEvent(kind, …)` for `elimination`/`win`; `kind:'info'` → `toast(msg, { variant:'info' })` (**the §3.4 delta**).
- `socketClient.js:653–703` `submissionRejected` → pill clear + `toast(message, { variant:'error' })` (replaces the direct `.copy-toast` call; identical user-visible outcome).
- `app.js:548–563` submit → set pill `Checking`.
- `app.js` typeahead path → set/clear pill `Searching…`.
- `predictionResult` (`socketClient.js:617–631`) + copy confirmations → `toast` (already toast-shaped; just consolidated through the router).
- **Unchanged (routed, not redesigned):** self-elim screen, `attemptFailed` ghost cards, win flash, confetti, elimination flash.

### 3.4 The single deliberate behaviour delta (the MI-01 fix)
Room-wide `kind:'info'` notifications move from the 3 s `#notification-overlay` centre takeover to a transient toast. **Everything else** — elimination/win/self-elim/confetti/ghost-card visuals — is preserved byte-for-byte. This is the only intended user-visible change.

### 3.5 Channel taxonomy

| Channel | Use | Backing primitive | Blocking | A11y |
|---|---|---|---|---|
| `toast` | form/validation errors, `kind:'info'`, copy/prediction confirmations | generalised `showToast`/`.copy-toast` | no (auto-dismiss) | `aria-live="polite"` |
| `gameEvent` | eliminations, wins (the legit drama) | `showNotification`/`*Flash`/confetti (unchanged) | overlay timing as today | unchanged |
| modal result | result states that must persist until dismissed | **pre-existing** `.modal-overlay`/`.modal-card` — *not re-wrapped in 7.2* (no mis-routed caller) | yes (explicit dismiss) | existing modal focus mgmt |
| CG-03 pill | submission "Checking: <title>" / typeahead "Searching…" | new inline element, input-area | no | `aria-live="polite"` |

## 4. Test plan (TDD — red→green per task)

**Client (`client-tests/`, jsdom):**
- `feedback.toast`: renders message + variant class, auto-dismisses, deterministic replace/stack behaviour.
- `feedback.gameEvent`: each `kind` invokes the same primitive the legacy dispatcher did (assert behaviour-preserving, incl. `selfElimActive` suppression).
- CG-03 pill state machine: submit → `Checking:"x"` visible & intent preserved; success → cleared; `submissionRejected` → cleared + text restored + error toast + `retriesLeft` copy unchanged; typeahead → `Searching…`; elimination → pill cleared and the 7.1 self-elim path still fires.
- Migrated dispatcher tests: `elimination`/`win` assert an **identical** visual outcome; `kind:'info'` asserts a toast **and** asserts the centre overlay is not used (the §3.4 delta).
- XSS posture: a crafted title in the pill / toast is rendered as text (no HTML execution).

Full suite + coverage ratchet must stay green.

## 5. Guardrails & gates
- Client-only; no new socket event; no server/scoring/validation change. Reuse the existing toast + modal primitives; new CSS only in `06-states-anim.css`; do not touch the name prompts or the 7.3-deferred CSS.
- **Real-boot + in-browser gate:** touches the `submitMovie` → render path (client side only — no `server.js`/boot/deps change, so no server-boot risk). Suite mocks Redis and never boots a browser; after merge confirm Render `live` (read-only Render MCP) and flag the in-browser eyeball (toast vs overlay; the `Checking:`/`Searching…` pill across success/reject/eliminate) as **user-side**. "Merged" ≠ "deployed."
- No persistence/accounts; device-local N/A.
- Pipeline: isolated git worktree off the **then-current** `origin/main` (582dd3d; a parallel Codex agent shares the repo — verify branch before every commit, never history-rewrite the shared branch); native Task tools unavailable → TodoWrite + hand-authored co-located `.tasks.json`; per-task two-stage review (spec-compliance then code-quality) + final most-capable-model holistic review; PR-merge / push-to-main / Render deploy classifier-gated, handed to the user.
- Every code change ships explanatory WHY comments.
- Out-of-scope findings during build/review → session `spawn_task` chip, never widen 7.2's scope.

## 6. Files touched (anticipated)
- **Create** `public/js/ui/feedback.js` — the three-channel router.
- `public/js/ui/ui-notifications.js` — generalise `showToast` into a variant-aware toast primitive (additive; existing callers preserved).
- `public/js/socketClient.js` — route the `notification` dispatcher, `submissionRejected`, `predictionResult` through `feedback.js`; wire pill resolution.
- `public/js/app.js` — submit + typeahead drive the CG-03 pill.
- `public/index.html` — the inline pill element in the input-area (minimal markup).
- `public/css/06-states-anim.css` — toast variant + pill styles (this partial only).
- `public/js/ui.js` barrel — export `feedback.js` if the barrel pattern requires it (mirrors 7.1's `showSelfEliminationScreen` via the `ui.js` barrel).
- Tests: `client-tests/feedback-router.test.js` (new), `client-tests/submission-pill.test.js` (new), and migration of the dispatcher/info-overlay assertions in existing `client-tests/*`.

## 7. Acceptance criteria
- [ ] `feedback.js` exposes `toast`/`gameEvent` (and only those); `gameEvent` is behaviour-preserving for elimination/win/self-elim/confetti.
- [ ] The modal-result taxonomy is the pre-existing `.modal-overlay` system, left untouched and not re-wrapped (documented, not built).
- [ ] `kind:'info'` notifications render as a toast, not the centre overlay (MI-01).
- [ ] On submit the typed title stays visible as `Checking: "<title>"`; resolves correctly on success / rejection / elimination; retry semantics + `retriesLeft` copy unchanged (CG-03).
- [ ] Typeahead in flight shows `Searching…`.
- [ ] No new socket event, no server change, no scoring/validation change, no `innerHTML`.
- [ ] The three name prompts and the 7.3-deferred CSS are untouched.
- [ ] Full suite + coverage ratchet green; real-boot / in-browser eyeball flagged user-side.

## 8. Out of scope (explicit)
Name-prompt consolidation (7.3 / MI-02); inline-style migration (7.3 / DS-01); elimination/win/self-elim restyle (7.1 shipped; feel owned by 7.4/7.7); the recorded 7.3 CSS deferrals; any server / socket-event / persistence change; modal-infrastructure changes; a `modalResult` router wrapper (no 7.2 caller — YAGNI; the first later phase with a concrete programmatic-modal need, e.g. 7.6/7.9, adds it then); re-tuning which game events are "dramatic" beyond the single `kind:'info'` reclassification.
