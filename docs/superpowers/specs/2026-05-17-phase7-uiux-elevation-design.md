# Phase 7 — UI/UX Elevation: Design Spec (Decision Record & Decomposition)

**Date:** 2026-05-17
**Status:** Approved (brainstorming) — proceeding to per-sub-phase design; **7.1 Elimination Aftercare** is brainstormed next in its own design cycle.
**Phase:** **7** — a post-remediation, post-6 **growth initiative** sourced from **two Codex passes**, distinct from and sequenced *after* (a) the 5-phase post-2026-05-16-review remediation (Phases 1–5b, all shipped + live) and (b) the Phase 6 growth bundle (6a shipped + live; **6b Achievements/Titles** and **6c Custom Rule Kits** specced in `docs/superpowers/specs/2026-05-17-learning-breakdown-design.md` §1, pending build). Phase 7 does **not** renumber, block, or overlap 6b/6c — see §3 dedup.

This document is a **decision record + decomposition**, not an implementation spec. Phase 7 spans 9 sub-phases; the validated workflow is strictly **one phase = one spec → plan → subagent build → PR**, so each sub-phase gets its own design→spec→plan→build cycle. See §1 for the verdict over every Codex item and §2 for the sub-phase definitions.

---

## 0. Provenance

- **Codex Pass 1 (audit):** 21 grounded findings with `file:line` refs + a prioritized roadmap; incremental "fix/strengthen what exists." Previously triaged into draft sub-phases 7a–7g.
- **Codex Pass 2 (research/vision):** competitor-pattern study (Jackbox, AirConsole, Gartic Phone, Framed/Flickle, Letterboxd, MUBI/A24, Active Theory, et al.); 15 concepts + 4 "bigger swings"; thesis = *MovieMatch should stop feeling like "a trivia web app with rooms" and feel like a live movie-night ritual.*
- **Reconciliation principle:** **Pass 2 is largely the north-star realization of Pass 1's clusters, not a competing list.** One verdict per item; keep Pass 1's dependency spine; re-aim each sub-phase at its Pass-2 vision; carve the one true big swing (Couch Mode) to a separate Phase 8.

---

## 1. Portfolio Triage & Decomposition (decision record)

### Reality checks (already shipped — not re-litigated)

- **HL-01 (hero Daily CTA dead-end) is DONE.** Fixed via PR #24 (`28e7c9f`), merged → `origin/main d2cbaff` → Render `dep-d8571fe…` **live** 2026-05-18T01:52Z. The socket-free seam `showDailyNamePrompt` (`ui-panels.js`) + thin `app.js` glue is in prod. In-browser eyeball is user-side.
- **Phase 6a `couldHavePlayed` substrate is in prod.** 7.1 Elimination Aftercare extends this existing self-elimination surface — it does not invent a new pathfinding path.
- **6b/6c are already specced** (Phase 6 doc §1). Pass 2's spectator-identity/streaks overlap **6b**; Pass 2's "Theme Packs With Taste / named programs" overlap **6c**. Phase 7 **coordinates with / defers to** 6b/6c on those surfaces — it does **not** build a parallel identity or rule-kit system.

### Verdict over all Codex items

| Source item (Pass 1 finding / Pass 2 concept) | Verdict | Home / grounded reason |
|---|---|---|
| HL-01 hero Daily dead-end | **DONE** | PR #24, live in prod. |
| MI-01 cinematic-notification overload; CG-03 search/validation feedback | **DO** | **7.2** — enabling feedback infra; later phases need a non-cinematic channel. |
| DS-01 inline-style debt; MI-02 ad-hoc overlays bypass modal system | **DO** | **7.3** — zero-behavior-change hardening; unlocks clean signature work. |
| Pass2 #8 Elimination Aftercare (+ Pass1 elimination/learning cluster) | **DO — FIRST** | **7.1** — extends shipped 6a `couldHavePlayed`; infra-independent; highest leverage. |
| Pass2 #10 Theme Packs-With-Taste, #11 Panic Timer, #14 Host Director controls, #9 Player Entrance Cards; LM-04 copy half; CG-01 quick parts | **DO** | **7.4** — quick-win identity bundle on the hardened system. |
| Pass2 #1 Red Carpet Lobby (= Pass1 LM-01/02/03/05 "Party Room Director") | **DO** | **7.5** — first signature surface. |
| Pass2 #4 Chain Premiere Recap, #5 Share Cards 2.0 (= Pass1 RS-01/RS-02) | **DO** | **7.6** — build the chain-choreography engine once; reused by 7.9. |
| Pass2 #3 Movie Constellation Board, #12 The Save Moment; Pass1 CG-02/CG-04/MT-01; MO-01 mobile context | **DO** | **7.7** — core game-feel; real-boot+browser gate; perf budget. |
| Pass2 #7 Audience Mode (= Pass1 SP-01) | **DO** | **7.8** — device-local/room-scoped; identity coordinates with 6b. |
| Pass2 #6 Daily Festival Pass, #13 Wrapped-per-game, big-swing #4 Post-Game Trailer (= Pass1 RS-03/RS-04) | **DO** | **7.9** — device-local; daily-LB `stableId` security; Trailer reuses 7.6 engine. |
| Pass2 #15 Playable Hero | **DO — net-new bet** | Paired with 7.5 (hero redesign; needs hardened system); its own brainstorm gate. Acquisition counterpart to HL-01. |
| Pass2 #2 Couch Mode / big-swing #3 Second-Screen Party Mode | **PHASE 8** | New socket roles (host-screen↔phone-controller), session model, layout system — a different product mode; breaks Phase 7's zero-scope-creep discipline. Own initiative/spec later. |
| Pass2 big-swing #1 "Festival Edition", #2 "The Chain Is the Interface" | **DROP as discrete items** | Umbrella *visions* = the sum of 7.5+7.6+7.9 and of 7.7 respectively. Kept only as north-star naming. |
| Pass1 LM-04 "enforce true 2v2" | **DEFER** | Gameplay/balance change (server/matchSystem), out of UI/UX scope; needs its own product decision. Copy-alignment half rides in 7.4. |
| Pass1 CP-01 global copy/voice rewrite | **DISTRIBUTE** | Voice guide = a small artifact; string rewrites fold into the sub-phase that owns each surface (a global string-churn PR would collide with every visual phase). |

### Decomposition & sequencing rationale

User-selected strategy = **infra-first** (not Codex's literal "signature-trio-first"): the most-visible, most-permanent surfaces must not be built on the inline-style/notification debt Pass 1 flagged — that is exactly the small-scale mess just resolved for HL-01, and rebuilding it large-scale on showcase surfaces is the dominant rework risk.

**Exception — why 7.1 front-runs the infra:** Elimination Aftercare extends an *already-shipped* surface (6a `couldHavePlayed` on the self-elimination screen), is additive and infra-independent (it does **not** touch the debt-laden visual showcase surfaces 7.3 cleans), and delivers visible "ritual" value immediately while proving the Phase 7 pipeline. It is the one quick-win safe to do before the hardening.

---

## 2. Sub-phase definitions

Each is an independent spec→plan→subagent-build→PR cycle. Effort is rough (S/M/L).

### 7.1 — Elimination Aftercare *(FIRST; effort S/M)*
- **Goal:** when a player is eliminated, turn failure into learning: on the existing self-elimination surface, show "you had outs" — 2–3 valid titles that *would* have connected, the shared-actor bridge for each, and a playful "you were one bridge away" framing.
- **Subsumes:** Pass2 #8; Pass1 elimination/learning cluster.
- **Builds on:** shipped Phase 6a `couldHavePlayed` enrichment + `showSelfEliminationScreen` (`ui-notifications.js`). Reuse the read-side bot pathfinding already merged (Phase 5a `botSystem.generateBotMove`), best-effort/time-boxed/fail-closed — no new event, no scoring/validation change.
- **Gate:** touches the `submitMovie`→elimination render path → real-boot + in-browser eyeball.
- **Out of scope:** new server events, multi-suggestion ranking beyond ~3, any persistence.

### 7.2 — Feedback-layer split *(enabling infra; effort M)*
- **Goal:** split the single full-screen cinematic notification into three channels — transient **toasts** (form/validation errors), **game-event overlays** (eliminations/wins), **modal result states** — and add a search "Checking: <title>" / "Searching…" pill so submission intent isn't erased.
- **Subsumes:** MI-01, CG-03.
- **Why infra:** several later phases (7.4 copy, 7.5/7.6 flows) need a non-cinematic feedback channel.

### 7.3 — Design-system hardening *(enabling infra; effort M)*
- **Goal:** migrate live inline styles into the ordered CSS partials (preserving the load-bearing cascade order); consolidate the three ad-hoc overlays (`showNamePrompt`, `showJoinPrompt`, `showDailyNamePrompt`) into one shared `.modal-overlay`/`.modal-card` system / small modal factory.
- **Subsumes:** DS-01, MI-02.
- **Constraint:** zero-behaviour-change refactor; migrate in small visual passes; the six-partial cascade order is load-bearing.

### 7.4 — Quick-win identity bundle *(effort M)*
- **Goal:** cheap "ritual" payoff on the hardened system: Theme-Packs-With-Taste (rename functional filters → authored programs; **coordinate with 6c**, do not duplicate), Panic Mode Timer (physical last-5-seconds), Host Director controls, Daily reset-countdown/streak copy, Player Entrance Cards.
- **Subsumes:** Pass2 #10/#11/#14/#9; LM-04 copy half; CG-01 quick parts; CP-01 strings for these surfaces.

### 7.5 — Red Carpet Lobby *(signature; effort M/L)*
- **Goal:** theatrical pre-show — marquee room code, QR, animated player arrivals, mode poster, "now casting" copy, host start as "Roll Camera."
- **Subsumes:** Pass2 #1; Pass1 LM-01/LM-02/LM-03/LM-05 ("Party Room Director").
- **Paired net-new:** **Playable Hero** (interactive one-move chain landing) — its own brainstorm gate; scheduled with/after 7.5 since both are first-touch and need the hardened system.

### 7.6 — Chain Premiere Recap + Share Cards 2.0 *(signature; effort L)*
- **Goal:** cinematic end-sequence (posters slide, actor links flip, elimination beats, winner billing) + collectible share artifacts (poster card, emoji grid, "I survived N links").
- **Subsumes:** Pass2 #4/#5; Pass1 RS-01/RS-02.
- **Reuse:** build the **chain-choreography engine** once here; 7.9 Post-Game Trailer reuses it.

### 7.7 — Constellation Board + Save Moment + motion timeline *(core game-feel; effort L)*
- **Goal:** render the chain as connected poster nodes with actor bridges (current node glows; eliminated players leave "burned" stamps); clutch-save juice for fast valid answers; one reusable per-turn motion timeline (handoff→think→submit→reveal→impact).
- **Subsumes:** Pass2 #3/#12; Pass1 CG-02/CG-04/MT-01; **resolves MO-01** (the compact turn treatment becomes the mobile sticky strip).
- **Gate:** submitMovie/render path → real-boot + in-browser; **explicit perf budget** (vanilla no-build, mobile), honor existing `prefers-reduced-motion`.

### 7.8 — Audience Mode *(expansion; effort M)*
- **Goal:** spectators get a job — predict survive/fail, guess the linking actor, "clutch save" award; surfaced as subtle crowd-heat, not chat spam.
- **Subsumes:** Pass2 #7; Pass1 SP-01.
- **Guardrail:** device-local + room-scoped only; **identity/streak coordinates with 6b Achievements** — no parallel identity system.

### 7.9 — Daily Festival Pass + Wrapped + Post-Game Trailer *(expansion; effort M/L)*
- **Goal:** local-storage daily streak card with themed "programs," reset countdown, personal best, practice archive that doesn't affect streak; per-game "Wrapped" (most-used actor, longest bridge, MVP save); Post-Game Trailer (CSS/JS choreography from real match data — no AI video).
- **Subsumes:** Pass2 #6/#13, big-swing #4; Pass1 RS-03/RS-04.
- **Guardrails:** device-local, no login; Daily share/leaderboard must **not** echo `stableId` (Phase 1 security fix); Trailer reuses the 7.6 engine.

---

## 3. Cross-cutting guardrails (binding on every sub-phase)

1. **No accounts.** All identity, streak, Wrapped, player-card, spectator state is **device-local (localStorage) + room-scoped**. No auth, no durable server datastore (Redis is all-TTL). Mandatory accounts were dropped by design as a growth barrier.
2. **Daily-leaderboard security.** The daily leaderboard previously leaked `stableId` (Phase 1 fix). 7.9 / any Daily-touching work must not re-echo identifiers.
3. **Real-boot + in-browser gate.** The suite mocks Redis and nothing exercises a real boot or browser. Any sub-phase touching `server.js`/boot/deps or the submitMovie/render path: state real-boot verification is outstanding, confirm Render `live` (read-only Render MCP) post-merge, and flag the in-browser eyeball as user-side. "Merged" ≠ "deployed."
4. **Perf budget.** 7.6/7.7/7.9 are heavy DOM/CSS choreography on a vanilla no-build stack; treat mobile perf as an explicit budget and honor the existing `prefers-reduced-motion` path.
5. **6b/6c dedup.** Theme Packs (7.4) coordinates with 6c Custom Rule Kits; Audience identity (7.8) coordinates with 6b Achievements. Do not build parallel systems.
6. **Pipeline & branch safety.** Each sub-phase: own spec→plan→subagent-build→PR; branch off the **then-current** `origin/main` in an **isolated git worktree** (a parallel Codex agent shares this repo — verify branch before every commit, never history-rewrite a shared branch); native Task tools unavailable → TodoWrite + hand-authored co-located `.tasks.json`; per-task two-stage review (spec-compliance then code-quality) + final most-capable-model holistic review; PR-merge / push-to-main / Render deploy is classifier-gated and handed to the user.
7. **Comments.** Every code change ships explanatory WHY comments.
8. **Scope discipline.** Out-of-scope findings during reviews → session spawn_task chip, never expand a sub-phase's scope.

---

## 4. Sequencing & next step

**Order:** 7.1 → 7.2 → 7.3 → 7.4 → 7.5 (+ Playable Hero) → 7.6 → 7.7 → 7.8 → 7.9. **Phase 8** (Couch Mode / Second-Screen) is a separate later initiative.

**Immediate next step:** brainstorm **7.1 Elimination Aftercare** in its own normal design cycle → its own spec → writing-plans → subagent-driven build → PR.

---

## 5. Explicitly out of scope / deferred

- **Couch Mode / Second-Screen Party Mode** → Phase 8 (own initiative + spec/brainstorm).
- **LM-04 "enforce true 2v2"** gameplay/balance change → deferred product decision.
- **Big-swing umbrella visions** ("Festival Edition," "Chain Is the Interface") as discrete deliverables → they are the emergent sum of the sub-phases, not separate work.
- Any **accounts/auth/durable-server-identity** mechanic → permanently out (growth-barrier decision).
