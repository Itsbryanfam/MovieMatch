# Phase 6b + 6c (Bundled) — Achievements/Titles + Constrained Custom Rule Kits: Design Spec

**Date:** 2026-05-21
**Status:** Approved (brainstorming) — proceeding to implementation plan
**Phase:** **6b + 6c bundled** — the two remaining DOs of the Phase 6 growth
initiative (decision record: `docs/superpowers/specs/2026-05-17-learning-breakdown-design.md`
§1). 6a (Post-Game Learning Breakdown) shipped via PR #23. The user has elected
to ship 6b and 6c **together as one phase** (one spec → one plan → one
subagent-driven build → one PR), because they are mechanically independent but
share surfaces (lobby settings, modals, CSS) and the same zero-import seam
pattern.

---

## 1. Provenance & Decision Record

From the Phase 6 portfolio triage (`2026-05-17-learning-breakdown-design.md` §1):

- **6b — Achievements + Titles (P1):** *"Pure derivation over `statsSystem`
  anonymous stats; cheap identity loop, no new persistence/accounts."*
- **6c — Custom Rule Kits (P0, constrained):** *"Presets over the existing
  `themesSystem` (genre/decade filters) + mode rules. Data-heavy presets
  (awards/franchise) stay out — no such data exists."*

The original §1 framed the three DOs as one retention loop —
*lose → learn why → earn a title → set a themed rule kit and replay*. 6a built
the "learn why" rung. This phase builds the "earn a title" and "set a rule kit"
rungs. **Per user direction (2026-05-21), the loop is emotional, not a content
gate: 6b and 6c are mechanically independent — all rule kits are available to
everyone immediately; achievements are pure positive feedback, never a lock.**
This is consistent with the project's barrier-lowering ethos (accounts/friends
were dropped in Phase 5; Playable Hero was built in 7.9 to ease first play).

### Brainstorming decisions (this session)

1. **6b "Title" = wall + equippable.** A private **Titles wall** lists every
   catalog achievement (earned + locked); the player may **equip one** earned
   title, which is **visible to other players** on their lobby seat chip and on
   the end-of-game card.
2. **6c = inline chip row, ~6 kits.** A `.rule-kit-chips` strip (extending the
   existing `.mode-chips` pattern) in the standard lobby; one click batch-applies
   theme + mode + toggles. Team-lobby kit chips are **out of scope** for v1.
3. **6b ↔ 6c independent.** 6c never reads 6b state.
4. **Approach A — thin server, read-side seams.** Two pure zero-import seams;
   client derives the wall from the existing `myStats` snapshot; equip + kit
   apply are small server events that reuse existing validation; no game-over /
   submit hot-path changes.

---

## 2. Goal & Motivation

A knowledge game's strongest retention levers are **mastery** (6a shipped it) and
**identity** — players come back to a game that reflects who they are and what
they like. 6b gives the player a visible identity earned purely from how they
already play (no grind mechanic, no new data collected). 6c lets a host express
taste in one click — "tonight is Date Night / After Dark / a Hardcore Sprint" —
turning the existing scattered theme + mode + toggle controls into a single
expressive choice.

Both are cheap because the substrate already exists: `statsSystem` already tracks
every stat an achievement needs, and `themesSystem` + the lobby mode/toggle
plumbing already implement every rule a kit composes. This phase adds **read-side
derivation** and **preset composition** — no new game rules, no new persistence
model, no new accounts.

**Non-goals:** redesigning the lobby or stats UI; live "achievement unlocked!"
toasts during play (deferred — the wall is computed on demand); free-form
user-authored kits; awards/franchise themes (no such data); ranked/seasonal
progression; any change to bot logic, scoring, validation, or the daily.

---

## 3. Scope

### In scope — 6b (Achievements + Titles)

- A pure zero-import seam **`public/js/ui/achievements.js`**: the achievement
  **catalog** (13 entries, §6 Catalog A) + **`deriveEarned(stats)`** returning
  the set/array of earned achievement IDs. Pure over a `getStats()`-shaped
  object; missing fields default to 0; never throws. Dual-consumable
  (Node `require` + browser `<script>`), mirroring `hero-puzzle.js`.
- A small server module **`server/systems/titlesSystem.js`** that persists the
  player's **equipped title** at a **sibling Redis key `title:{stableId}`**
  (STRING, 90-day TTL — same anonymous stableId model, mirroring the existing
  `stats:connectors:{stableId}` sibling). Exports `getEquippedTitle(pubClient,
  stableId)` and `setEquippedTitle(pubClient, stableId, titleId, earnedSet)`,
  the latter persisting **only if `titleId ∈ earnedSet`** (defense at the
  persistence boundary).
- A socket event **`setEquippedTitle({ stableId, titleId })`**: the handler
  fetches that stableId's stats (existing `getStats`), runs the seam's
  `deriveEarned`, and calls `titlesSystem.setEquippedTitle` with the earned set;
  if the player is currently in a room, it updates their in-room player object's
  `equippedTitle` and broadcasts one `stateUpdate`.
- **Equipped-title display:** the player's `equippedTitle` is read **once at
  lobby join** (one Redis GET, best-effort) and cached on the in-room player
  object, so broadcasts carry it with **no per-broadcast Redis read**. Client
  renders it on the lobby **seat chip** and the **end-of-game card** when
  present; absent/null → nothing rendered (graceful, mirrors 6a's optional-field
  discipline).
- **`myStats` response enrichment:** the existing `requestMyStats` handler's
  `myStats` response is **additively** enriched with the player's current
  `equippedTitle` (read via `titlesSystem.getEquippedTitle`; **`statsSystem.getStats`
  stays unchanged** — the handler spreads the stats object and adds the field).
  This lets the wall mark the active selection and survive a refresh without a
  new event. (Additive field; the plan confirms no sacrosanct test asserts an
  exact `myStats` object equality.)
- **Titles wall (client):** opened from a button near the existing `myStats`
  surface; emits the **existing** `requestMyStats(stableId)` (no new fetch
  event), runs `deriveEarned`, renders all 13 rows (earned = lit + equippable;
  locked = dimmed + unlock condition), and marks the row matching the response's
  `equippedTitle` as **Equipped**. A "✦ New" flag per row via a localStorage
  `seenTitles` diff (purely client-side; no server involvement).
- New test files only (§8). WHY-comments on every changed line.

### In scope — 6c (Constrained Custom Rule Kits)

- A pure zero-import seam **`public/js/ui/ruleKits.js`**: the kit **catalog**
  (6 entries, §6 Catalog B) mapping `kitId → { label, icon, theme, mode,
  hardcore, tvShows }`. Dual-consumable.
- A socket event **`selectRuleKit({ lobbyId, kitId })`**: the handler acquires
  the room lock **once**, enforces the **same** host-only + waiting-state guards
  as the existing setters, looks up the kit in the **same** `ruleKits` seam,
  **validates each field** (`isValidTheme(kit.theme)`; `mode ∈
  ['classic','team','solo','speed']`; toggles coerced boolean), sets
  `room.theme` + `room.gameMode` + `room.hardcoreMode` + `room.allowTvShows`,
  and broadcasts **one** `stateUpdate`.
- **Rule-kit chips (client):** a `.rule-kit-chips` strip in the standard lobby
  settings; each chip click emits `selectRuleKit({ lobbyId, kitId })`. The
  existing `stateUpdate` handler already re-renders the theme dropdown, mode
  chips, and toggles — so the kit's resulting selections appear in the existing
  controls with **no special client apply logic**.
- New test files only (§8). WHY-comments on every changed line.

### Out of scope (explicit)

- Live in-play "achievement unlocked!" toasts (deferred; the wall is on-demand).
- Equipping more than one title; title rarity tiers; title-based matchmaking.
- 6c kits in the **team** lobby surface (team already has full manual controls;
  follow-up only if wanted).
- Free-form user-authored/saved kits; awards/franchise/collection themes.
- Any change to `statsSystem.js` source (it stays **byte-identical** — see §4),
  to bot logic, scoring, validation, the daily, or the submit/game-over paths.
- New accounts, login, or any non-anonymous persistence. Equipped title reuses
  the existing anonymous `stableId` keyspace with the same 90-day TTL.
- Persisting/sharing achievement state server-side beyond the single equipped
  title (the wall is derived live from stats; nothing else is stored).

---

## 4. Current Architecture (grounding)

Verified against the codebase on 2026-05-21 (`main` @ `b16a4f7`). The plan must
re-confirm exact line numbers by reading the code; the contracts below are what
matters.

- **Stats (read substrate for 6b):** `server/systems/statsSystem.js`.
  `getStats(pubClient, stableId)` (`:159`) returns a fully-defaulted shape:
  `{ gamesPlayed, wins, longestChain, totalPlays, byMode.{classic,team,solo,speed,daily}.{played,won,longestChain}, favoriteConnector: {name,count}|null, lastUpdatedMs }`
  (`_emptyStats` `:172`). Data lives in HASH `stats:{stableId}` + sibling HASH
  `stats:connectors:{stableId}`, 90-day TTL. **`_reconstruct` (`:193-221`) keeps
  only numeric fields** (`parseInt`; non-finite → `continue`, `:198-199`) — so a
  string `equippedTitle` stored on `stats:{stableId}` would be **silently
  dropped**. Combined with `statsSystem.test.js` being **sacrosanct**, this is
  why the equipped title persists in a **sibling key**, not a new HASH field.
- **Stats client roundtrip:** client emits `requestMyStats(stableId)` →
  `socketHandlers.js` (~:297-302) responds with `myStats` (the `getStats`
  payload). Client consumer is a placeholder at `public/js/socketClient.js`
  (~:644). **No achievements/titles UI exists today — green field on display.**
- **Themes (rule substrate for 6c):** `server/systems/themesSystem.js`.
  `THEMES` (`:49-124`) = `any` + 6 genres (`horror, comedy, action, scifi,
  romance, animation`) + 4 decades (`decade_1980s/1990s/2000s/2010s`).
  `isValidTheme(themeId)` (`:138`) guards against arbitrary strings.
  `listThemes()`/`clientShape()` already feed the theme picker.
- **Lobby rule plumbing (for 6c):** `server/systems/lobbySystem.js`. Room state
  defaults (~:64-73): `gameMode: 'classic'`, `theme: 'any'`,
  `hardcoreMode: false`, `allowTvShows: false`. Setters under RMW-lock,
  host-only, waiting-state-only: `setTheme` (~:250-267), `setGameMode`
  (~:232-248, `validModes = ['classic','team','solo','speed']`), and the generic
  `toggleSetting(ctx, socket, {lobbyId, state}, field)` (~:316-327) used by
  `toggleHardcore('hardcoreMode')` and `toggleTvShows('allowTvShows')`. **6c's
  `selectRuleKit` composes these same field writes under one lock — no new rule
  pipeline.**
- **Lobby client emitters:** `public/js/app.js` — `setGameMode` (~:439),
  `toggleHardcore` (~:74), `toggleTvShows` (~:81), `setTheme` (~:64-67). Mode UI
  uses the `.mode-chip` / `.mode-chips` pattern in
  `public/css/02-hero-lobby.css`.
- **Zero-import seam lineage:** `public/js/ui/hero-puzzle.js` and
  `public/js/ui/red-carpet.js` are pure, dual-consumable seams (browser
  `<script>` + Node `require`, proven by `server/hero-puzzle.test.js` requiring
  the same file). **6b/6c seams live in `public/js/ui/` and follow this idiom.**
- **CSS:** BEM-ish (single-`-` element, `--` modifier) still in force. Files:
  `01-base.css` (tokens/reset), `02-hero-lobby.css` (hero + lobby + mode chips +
  seats), `03-game.css` (board), `04-modals.css` (overlays/modals),
  `05-responsive.css`, `06-states-anim.css`.

---

## 5. Chosen Approach & Alternatives

**Chosen: A — thin server, read-side seams** (see §1 decision 4). The two hard
questions are "which achievements has this player earned?" and "what rule state
does a named kit mean?" — both answered by **pure functions over data that
already exists** (`deriveEarned` over `getStats`; a static kit→fields map). The
server's only new work is one validated equip write and one validated kit-apply
write; the client renders from the existing `myStats` payload and the two seams.

**Alternatives considered:**

- **B — server-driven unlock toasts.** Server computes achievement deltas at
  game-over and emits live `achievementUnlocked` toasts. Rejected for v1: it
  touches the sacrosanct game-over path, adds a new event and a larger server
  test surface, and duplicates the catalog server-side (the client still needs
  it for the wall) — a lot of risk for a cosmetic "just unlocked!" flourish that
  can be added additively later.
- **C — fully client-only.** Equipped title in localStorage only; kits applied
  by firing the existing toggle events in sequence. Rejected: a localStorage
  title is **not visible to other players** (breaks decision 1), and sequencing
  N toggle emits is racy and produces N broadcasts/flicker. The single
  `selectRuleKit` event (one lock, one broadcast) and the single `title:`
  sibling key are both cleaner and strictly necessary for the chosen shapes.

**Why the sibling key (not a HASH field):** §4 shows `_reconstruct` drops
non-numeric fields and `statsSystem.test.js` is sacrosanct. A sibling
`title:{stableId}` STRING with the same TTL keeps `statsSystem.js` byte-identical,
isolates the equipped-title concern in its own testable unit (`titlesSystem.js`),
and mirrors the existing `stats:connectors:{stableId}` sibling precedent.

---

## 6. Catalogs

### Catalog A — Achievements (13)

Each is a pure threshold predicate over the `getStats()` shape. The **Title**
column is the equippable display string for that achievement.

| ID | Title | Earned when |
|----|-------|-------------|
| `first_steps` | First Steps | `gamesPlayed >= 1` |
| `getting_hang` | Getting the Hang of It | `gamesPlayed >= 10` |
| `regular` | Regular | `gamesPlayed >= 50` |
| `first_win` | First Win | `wins >= 1` |
| `on_a_roll` | On a Roll | `wins >= 10` |
| `chain_builder` | Chain Builder | `longestChain >= 10` |
| `chain_master` | Chain Master | `longestChain >= 25` |
| `well_connected` | Well Connected | `totalPlays >= 100` |
| `team_player` | Team Player | `byMode.team.won >= 1` |
| `speed_demon` | Speed Demon | `byMode.speed.won >= 1` |
| `solo_artist` | Solo Artist | `byMode.solo.won >= 1` |
| `daily_devotee` | Daily Devotee | `byMode.daily.played >= 7` |
| `signature_connector` | Signature Connector | `favoriteConnector && favoriteConnector.count >= 5` |

Each catalog entry shape: `{ id, title, description, icon?, predicate(stats) }`.
`deriveEarned(stats)` runs every `predicate` against a defensively-defaulted copy
of `stats` and returns the array of earned `id`s. The `description` doubles as
the locked-row unlock hint (e.g. "Win 10 games").

### Catalog B — Rule Kits (6)

Each maps onto **real** theme ids (§4 `themesSystem`), modes
(`['classic','team','solo','speed']`), and the two boolean toggles. Kit labels
intentionally echo the existing theme labels where they overlap (the `romance`
theme's label is "Date Night", `horror`'s is "After Dark"), which reads
naturally because a kit is a superset of a theme.

| ID | Label | theme | mode | hardcore | tvShows |
|----|-------|-------|------|----------|---------|
| `date_night` | 💘 Date Night | `romance` | `classic` | `false` | `false` |
| `after_dark` | 🎃 After Dark | `horror` | `classic` | `false` | `false` |
| `hardcore_sprint` | 🔥 Hardcore Sprint | `any` | `speed` | `true` | `false` |
| `decade_drift` | 📼 Decade Drift | `decade_1990s` | `classic` | `false` | `false` |
| `saturday_cartoons` | 🎨 Saturday Cartoons | `animation` | `classic` | `false` | `true` |
| `classic_open` | 🎬 Classic Open | `any` | `classic` | `false` | `false` |

`classic_open` doubles as the "reset to defaults" kit. Catalog ordering is the
display order (deterministic, like `themesSystem.listThemes`).

---

## 7. Components & Data Flow

Each unit is independently understandable and testable.

### 6b

1. **Seam `achievements.js` (pure):** `{ ACHIEVEMENTS: [...13], deriveEarned(stats) }`.
   No I/O. Browser global + `module.exports` dual-export.
2. **`titlesSystem.js` (server):** `getEquippedTitle(pubClient, stableId)` →
   string|null (best-effort; errors → null). `setEquippedTitle(pubClient,
   stableId, titleId, earnedSet)` → writes `title:{stableId}` with 90-day TTL
   **only if `titleId ∈ earnedSet`**; unknown/unearned → no-op. Both swallow
   Redis errors (stats-system discipline).
3. **`setEquippedTitle` socket handler:** validate `titleId` is a known catalog
   id → `getStats(stableId)` → `deriveEarned` → `titlesSystem.setEquippedTitle`.
   If the sender is in a room, update `player.equippedTitle` in memory and
   broadcast one `stateUpdate`. Always fail-closed (any error → no persistence,
   no throw).
4. **Join-time attach:** at the existing lobby-join assembly, best-effort
   `getEquippedTitle` once → store on the in-room player object. (One GET per
   join, off the per-move hot path.)
5. **Broadcast carry:** the player object's `equippedTitle` rides existing
   `stateUpdate` / end-card payloads additively. Absent → omitted.
6. **Client wall:** button → `requestMyStats` → on `myStats` (now carrying the
   current `equippedTitle`), `deriveEarned` → render 13 rows, marking the
   currently-equipped row as **Equipped**; equip click → `setEquippedTitle({
   stableId, titleId })` and **optimistically** re-mark the clicked row
   (equip is deterministic — the wall only offers earned titles and the server
   only rejects unearned ones — so no server echo/round-trip is needed); "✦ New"
   via localStorage `seenTitles` diff.
7. **Client title render:** seat chip + end-card show `player.equippedTitle`'s
   display title when present (look up the title string from the catalog by id).

### 6c

1. **Seam `ruleKits.js` (pure):** `{ RULE_KITS: [...6], getKit(kitId) }`.
2. **`selectRuleKit` socket handler:** one lock → host + waiting guards →
   `getKit(kitId)` (unknown → no-op) → validate fields (`isValidTheme`, mode
   whitelist, boolean coercion) → set the four room fields → one broadcast.
3. **Client chips:** render `RULE_KITS` as `.rule-kit-chips`; click →
   `selectRuleKit({ lobbyId, kitId })`. No client apply logic; the resulting
   `stateUpdate` re-renders existing controls.

---

## 8. Error Handling, Performance & UX Bounding

All new behavior is **fail-closed / graceful** and never degrades existing flows.

- `deriveEarned` — pure; every field defaulted to 0 / null-safe; never throws on
  partial or empty stats.
- `setEquippedTitle` (server) — unknown/unearned title → silent no-op; Redis
  error → swallowed; never throws to the socket layer. The client only ever
  offers earned titles, so rejection is pure defense-in-depth.
- Equipped-title broadcast — `equippedTitle` absent/null → nothing rendered on
  seat chip or end-card (mirrors 6a's optional-field discipline).
- **No hot-path cost:** equipped title is read **once at join** and cached;
  broadcasts do **no** extra Redis reads. The submit and game-over paths are
  **untouched**.
- `selectRuleKit` — unknown `kitId` → no-op; non-host / non-waiting → rejected by
  the inherited guards; any illegal field value → rejected by the whitelist
  check (a malicious client cannot set an invalid theme/mode via a kit). One lock
  acquisition, one broadcast (no flicker).
- **No new accounts / no new persistence model:** one new anonymous sibling key
  with the existing 90-day TTL; nothing else stored server-side for 6b/6c.

## 9. Testing Strategy

Automated; mocks per existing patterns (`statsSystem.test.js` style for Redis
mocks). **All 67 sacrosanct `*.test.js` files stay byte-identical — new tests go
in NEW files only.**

- `server/systems/achievements.test.js` *(new)* — `deriveEarned` predicate
  table: each of the 13 at **just-below** vs **just-at** its threshold; empty /
  partial stats safety (no throw, nothing spuriously earned); catalog integrity
  (13 unique ids, each has `title`/`description`/`predicate`).
- `server/systems/ruleKits.test.js` *(new)* — catalog integrity: every kit's
  `theme` passes `isValidTheme`, `mode ∈` the valid-modes set, `hardcore`/
  `tvShows` are booleans, ids unique, `classic_open` equals all-defaults.
- `server/systems/titlesSystem.test.js` *(new)* — `setEquippedTitle` persists
  to `title:{stableId}` with the 90-day TTL **only when earned**; no-ops when
  unearned/unknown; swallows Redis errors; `getEquippedTitle` returns the stored
  value / null / null-on-error.
- `server/rule-kit-select.test.js` *(new)* — `selectRuleKit` handler: host-only,
  waiting-only, applies all four fields from a kit, single broadcast,
  unknown-kit no-op, illegal-field defense (if a kit were malformed).
- `server/equipped-title.test.js` *(new)* — `setEquippedTitle` socket handler:
  earned → persists + (in-room) broadcasts; unearned → no persist; attaches
  `equippedTitle` to the broadcast player object; and the `myStats` response is
  enriched with the current `equippedTitle` while `getStats` output is unchanged.
- `client-tests/achievements-wall.test.js` *(new, jsdom)* — renders 13 rows
  (earned lit/equippable vs locked dimmed); equip click emits
  `setEquippedTitle`; "✦ New" diff logic against a mocked `localStorage`.
- `client-tests/rule-kit-chips.test.js` *(new, jsdom)* — renders 6 chips; click
  emits `selectRuleKit({ kitId })` with the right id.
- `client-tests/equipped-title-render.test.js` *(new, jsdom)* — seat chip +
  end-card render the title string when `equippedTitle` present; render nothing
  when absent (no regression to the existing card).

**Suite target:** 619 → ~650+ green (≈30+ net new tests; the plan firms the
exact count per task). Coverage ratchet floors hold. Because the suite mocks
Redis/TMDB and exercises no real boot or real browser, **real-boot verification
and an in-browser eyeball** (the Titles wall + a kit chip applying live + an
equipped title showing on a seat) are **outstanding until the user merges and
Render is checked** — this touches the lobby join/broadcast path, so that gate
applies.

## 10. Files (approximate — the plan pins exact line targets)

**Create**
- `public/js/ui/achievements.js` — pure seam: 13-achievement catalog +
  `deriveEarned(stats)`.
- `public/js/ui/ruleKits.js` — pure seam: 6-kit catalog + `getKit(kitId)`.
- `server/systems/titlesSystem.js` — equipped-title persistence at
  `title:{stableId}` (get/set, set validates membership).
- The 8 new test files listed in §9.

**Modify**
- `server/socketHandlers.js` — register `setEquippedTitle` + `selectRuleKit`
  handlers (and wire `selectRuleKit` to the lobby handler).
- `server/systems/lobbySystem.js` — `selectRuleKit` (compose the four field
  writes under one lock, reusing the existing guard pattern) + join-time
  `getEquippedTitle` attach to the player object + carry `equippedTitle` in the
  broadcast player shape.
- `public/index.html` — `<script>` tags for the two new seams; the Titles-wall
  button + modal container; the `.rule-kit-chips` container in lobby settings.
- `public/js/socketClient.js` and/or `public/js/ui/*` — Titles-wall render +
  equip wiring; rule-kit chip render + click emit; equipped-title render on seat
  chip + end-card.
- `public/css/02-hero-lobby.css` and/or `04-modals.css` — **append-only**
  additive rules: `.rule-kit-chips`/`.rule-kit-chip`(+modifiers), `.achievement-*`
  wall rows, and a small equipped-title badge style. **Zero deletions, zero
  edits to existing rules** (Phase 4 additive-CSS discipline).

**Untouched (byte-identical):** `server/systems/statsSystem.js`,
`server/systems/themesSystem.js`, and all 67 existing `*.test.js` files.

## 11. Task Decomposition (preview — the plan finalizes)

Bundle is larger than the usual 3-task phase; ~6 linear TDD tasks:

- **T0** — `achievements.js` seam (catalog + `deriveEarned`) + unit tests (pure).
- **T1** — `ruleKits.js` seam (catalog + `getKit`) + catalog-integrity tests
  (pure). *Independent of T0; the plan may merge T0+T1 if both stay small.*
- **T2** — 6b server: `titlesSystem.js` + `setEquippedTitle` handler + join-time
  attach + broadcast carry + the two server test files.
- **T3** — 6b client: Titles-wall modal + equip UI + seat/end-card title render +
  the two client test files.
- **T4** — 6c: `selectRuleKit` server handler + `.rule-kit-chips` client UI +
  the two kit test files + index.html wiring.
- **T5** — CSS append: `.achievement-*` + `.rule-kit-chips` + title badge (zero
  deletions).

Each task is independently verifiable, gets its own commit, and is `completed`
only after **both** its per-task reviews (spec-compliance, then code-quality)
pass.

## 12. Process Notes

Ships via the validated pipeline (Phases 1–7.10): **spec → writing-plans →
subagent-driven-development → finishing-a-development-branch.**

- This spec is committed to `main` locally. The plan + co-located
  `.md.tasks.json` are committed to `main`, then a **feature branch
  `phase6-bc-bundle` off the then-current `origin/main`** (not a worktree, not
  stacked on any other branch) for all implementation commits.
- Native Task tools are available (used through Phase 7.10) — used for in-session
  tracking alongside the co-located `.md.tasks.json`. A task is `completed` only
  after **both** per-task reviews pass.
- Per task: dispatch the implementer with the full task text + exact code; then
  an **independent spec-compliance review**, then an **independent code-quality
  review**; fix-loop until both pass. Final **opus whole-branch holistic review**
  before finishing.
- WHY-comments on every changed line (project convention).
- Out-of-scope findings during reviews → spawn a task chip; do **not** expand
  this phase's scope.
- `coverage/` stays untracked (never `git add`).
- Finishing: push the feature branch + `gh pr create` (base `main`). The
  PR-merge / push-to-main / Render production deploy is **classifier-gated and
  handed to the user** — not performed here. After merge, verify the Render
  deploy is `live` (read-only) and eyeball the Titles wall, a kit chip applying
  live, and an equipped title on a seat in-browser.
