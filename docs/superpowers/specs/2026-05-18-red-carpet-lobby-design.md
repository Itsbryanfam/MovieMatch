# Phase 7.5 — Red Carpet Lobby (Core Makeover): Design Spec

**Date:** 2026-05-18
**Status:** Approved (brainstorming) — proceeding to writing-plans.
**Phase:** **7.5** — first **signature** sub-phase of Phase 7 UI/UX Elevation, executed after 7.1–7.4 all merged + live (`origin/main 5380167`). Source of truth: the committed decision-record `docs/superpowers/specs/2026-05-17-phase7-uiux-elevation-design.md` §2.7.5 + the 7.4 re-homing decision (Player Entrance Cards #9 + the heavier Host-Director panel #14 were deferred out of 7.4's tight bundle into 7.5 so the lobby showcase is built once).

This is an **implementation design spec** (one spec → plan → subagent-build → PR). It is deliberately precise about the pure-function contracts and the zero-regression boundary so writing-plans can produce no-placeholder tasks.

---

## 0. Provenance & one-paragraph thesis

Decision-record §2.7.5 "Red Carpet Lobby" = the theatrical pre-show: marquee room code, *now-casting* framing, animated player arrivals, mode poster, host start as "Roll Camera." It subsumes Pass2 #1 and Pass1 LM-01/LM-02/LM-03/LM-05 ("Party Room Director"). The paired net-new **Playable Hero** keeps its **own** separate brainstorm gate (explicitly NOT in 7.5 — decision-record §2.7.5 + §1). The thesis (Phase 7 north star): the waiting room must stop reading like a form and start reading like a premiere about to begin — without touching a single server mechanic.

---

## 1. Goal & scope

**Goal:** Re-skin the primary waiting room (`#waiting-room`, the classic/solo/speed pre-game screen) into a "Red Carpet" premiere: a marquee room code, *now-casting* copy, a mode "poster," animated **Player Entrance Cards** with a device-local deterministic per-player accent, the host's existing controls grouped into one presentational **Director panel**, and the host Start button re-voiced as **"🎬 Roll Camera."** Purely presentational + additive; **zero server change, zero gameplay/behaviour change, team mode byte-identical.**

### 1.1 In scope (the approved "Core makeover")

1. **Marquee room code + *now-casting* framing** — `#lobby-code-display` presented theatrically; the static "Waiting for players…" line re-voiced as premiere copy.
2. **Mode poster** — the existing 4-mode selector (`#mode-selector`, `MODE_DESCRIPTIONS`) re-framed visually as a feature poster. Mode selection stays server-authoritative and wired exactly as today.
3. **"Roll Camera" host start** — `#start-btn` text/enabled-state from a pure `rollCameraLabel()` whose enable/disable truth-table is **byte-identical** to the current `ui-render.js:138-152` gating; only the copy is re-voiced.
4. **Player Entrance Cards** — each player rendered as a card that plays an entrance animation **only on actual arrival** (not on every idempotent re-render), with a **device-local, room-scoped, deterministic** per-player accent (hue + emoji) derived from `name + ':' + socket-id`. **No accounts, no persistence, no new wire field, never `stableId`.**
5. **Host-Director panel (presentational only)** — the existing host-only controls (mode chips, theme select, hardcore/tv-shows/public toggles, kick, add-bot, start) grouped under one labelled "Director" container. DOM re-parenting + re-skin only; **every control, condition, and `socket.emit` byte-identical**. **No new rule/preset/kit mechanic** (6c Custom Rule Kits owns that — see §4).
6. **Bounded DS-01 cleanup** — migrate to the new Red-Carpet classes **only** the inline styles inside the surface 7.5 rewrites (`#waiting-room` + the player-row builder): `ui-render.js:59` player `<li>` `cssText`, `ui-render.js:103` lobby-settings `display`, `ui-render.js:139` start-btn `display`, and the `index.html` inline `style=` on the rewritten waiting-room nodes (`#lobby-settings :280`, `#theme-select :286`, the public-toggle wrapper :246, `#start-btn :299`). Nothing outside `#waiting-room` is touched (see §9).

### 1.2 Out of scope / deferred (recorded, not forgotten — see §9)

- **QR scan-to-join** — deferred (no-build dependency + invite-URL surface). Recorded for a later pass / 7.9.
- **Team-screen (`renderTeamScreen` / `#team-screen`) Red Carpet parity** — deferred; team mode renders **byte-identical** to today.
- **Blanket DS-01 long-tail** — only the rewritten `#waiting-room` region is migrated (§9).
- **Playable Hero** — its own brainstorm gate, not 7.5.
- Any server/gameplay change, new socket event, scoring/validation/theme-mechanic change, accounts, persistence.

---

## 2. Architecture & approach

**Chosen: Approach A — rebuild-in-place + a pure `red-carpet.js` seam + thin `renderLobby` glue.**

`renderLobby(gameState, myPlayerId)` (`ui-render.js:30-185`) is the single lobby render entry point, called on **every** `stateUpdate(status==='waiting')` and on rejoin; it already clears and rebuilds the player list each call (idempotent contract). The only genuine logic in 7.5 — *which players are newly arriving* (so the entrance animation fires once, not on every settings toggle), the *deterministic per-player accent*, and the *Roll-Camera gating copy* — is isolated into a new **pure, zero-import, unit-tested** module. `renderLobby` stays thin glue. This is the exact validated 7.2/7.3/7.4 pattern (pure seam + thin glue + barrel export + additive CSS + jsdom tests + WHY comments + zero behaviour regression).

**Rejected alternatives:**

- **Approach B — rewrite `renderLobby` wholesale into a new module.** `renderLobby` also drives mode-chip active/disabled state, the team-mode early return, the theme picker rebuild, the toggles, kick, the bot-row teardown/inject. Replacing it wholesale endangers the zero-regression + "team mode byte-identical" guarantees on the *first* signature PR. Rejected (contradicts the additive-respect-seams discipline that carried 7.1–7.4).
- **Approach C — CSS-only re-skin (no JS seam).** Cannot deliver "animate only on real arrival" (every re-render would replay the animation) nor keep the Roll-Camera gating provably correct. Under-delivers the approved scope. Its discipline (favour CSS, keep JS minimal) is folded into A.

---

## 3. Component design

### 3.1 New pure module — `public/js/ui/red-carpet.js` (zero imports)

All four exports are pure (no DOM, no socket, no `window`, no imports), deterministic, and defensive against malformed input. WHY comments required.

#### `diffArrivals(seenIds, players) → { entering: string[], seen: string[] }`

- **Inputs:** `seenIds` = iterable of previously-acknowledged player ids (the glue holds a `Set`; the function must also tolerate an array, `null`, or `undefined` → treat as empty). `players` = array of client-shaped player objects `{ id, ... }` (tolerate non-array / missing `id` → skip that entry).
- **Returns:** `entering` = the ids present in `players` whose id is **not** in `seenIds`, in `players` order. `seen` = the ids of **every** player currently in `players` (the new acknowledged roster).
- **Purity:** must NOT mutate `seenIds` or `players`. The glue does `_seenPlayerIds = new Set(result.seen)` after each call.
- **WHY this contract:** `seen` is pinned to the *current roster* (not an ever-growing union) so the set stays bounded and a leave→rejoin (which yields a new socket id) correctly re-animates as a genuine new arrival. A still-present-but-disconnected player keeps the same id (disconnect grace keeps them in `players`) so they are NOT re-animated.

#### `playerCardModel(player, opts) → { name, isHost, isYou, isBot, wins, accentHue, accentEmoji, label }`

- **Inputs:** `player` = client-shaped `{ id, name, isHost, isBot, wins }`. `opts` = `{ myPlayerId }`.
- **accent key (security-critical):** `String(player.name) + ':' + String(player.id)`. `player.id` is the **room-scoped socket id** (rotates per connection; already the client render identity key). **The function MUST NOT read `stableId` or any persistent identifier even if present on the passed object** — §5 + the sentinel test enforce this.
- **Hash (pinned for determinism — djb2):**
  ```
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = (((h << 5) + h) + key.charCodeAt(i)) | 0;
  const u = h >>> 0;            // unsigned 32-bit
  accentHue   = u % 360;        // integer degrees, 0..359
  accentEmoji = ACCENT_EMOJI[u % ACCENT_EMOJI.length];
  ```
- **`ACCENT_EMOJI`:** a module-level `Object.freeze`d array of exactly **12** single-Unicode-scalar, film-themed emoji (no variation-selector / ZWJ / skin-tone sequences, to avoid length/render pitfalls). The exact glyph set is an implementation detail the plan pins; tests assert *membership + length + determinism*, never a specific glyph at a specific index (avoids brittle magic-value tests — the 7.4 review lesson).
- **Derived fields:** `name` = `String(player.name ?? '')` (rendered via `textContent` only by the glue). `isHost = !!player.isHost`. `isYou = player.id === opts?.myPlayerId`. `isBot = !!player.isBot`. `wins = (Number.isFinite(player.wins) && player.wins > 0) ? player.wins : 0`.
- **`label`** (zero-copy-regression mirror of current `ui-render.js:62-66`): base `name`, then ` (You)` if `isYou`, ` 👑` if `isHost`, ` • {wins} 🏆` if `wins > 0`. This keeps the card's textual identity line behaviour-equivalent to today; the emoji/accent are an additive visual layer on top.
- **Determinism:** identical `(name, id)` → identical model on every call (tested).

#### `rollCameraLabel({ amIHost, playerCount, mode }) → { text, disabled, variant }`

- **Owns the start-gating truth-table** (computed identically to today): `canStart = mode === 'solo' ? playerCount >= 1 : playerCount >= 2`.
- **`disabled` is byte-identical to current behaviour:** the button is enabled (clickable) **iff `canStart && amIHost`** — exactly the current `ui-render.js:138-152` enable/disable logic. Only the **text** is re-voiced.
- **Truth-table (binding — text re-voiced, disabled/variant exact):**

  | Condition | `text` | `disabled` | `variant` |
  |---|---|---|---|
  | `canStart && amIHost` | `🎬 Roll Camera` | `false` | `ready` |
  | `canStart && !amIHost` | `Waiting for the director…` | `true` | `waiting-host` |
  | `!canStart` (any host state) | `Waiting for the cast…` | `true` | `waiting-cast` |

- Pure; defensive (`playerCount` non-finite → treat as 0 → `!canStart`).

#### `marqueeSegments(code) → string[]`

- Splits a room-code string into an array of single-character cells for marquee styling. Non-string / empty → `[]`. Trivial but pure + tested (keeps the glue declarative).

### 3.2 Glue — `public/js/ui/ui-render.js` `renderLobby` (modify, additive)

- Add a module-scoped `let _seenPlayerIds = new Set();` (page-session lifetime; on full reload everyone "arrives" once = correct first paint — documented in a WHY comment).
- In `renderLobby`, after the existing team-mode early return (untouched) and `gameState.players` is known:
  - `const { entering, seen } = diffArrivals(_seenPlayerIds, gameState.players); _seenPlayerIds = new Set(seen);`
  - Build each player row as an **entrance card**: keep the `<li>` element and the `#lobby-players` container id (so `ui-dom.js` refs + every existing test resolve), add class `entrance-card` (+ `is-you`/`is-host`/`is-bot`), set `--card-accent` custom property + an emoji chip + the name (`textContent`) + the `label` suffix semantics, and add `is-entering` **iff `entering.includes(p.id)`**. The kick button is preserved **exactly** (same `amIHost && p.id !== myPlayerId` condition, same `.btn-kick` / `✕` / `removeBot|kickPlayer` emit).
  - Replace the inline `li.style.cssText` (`:59`) with the new classes; replace the `lobbySettings.style.display`/`startBtn.style.display` writes (`:103`/`:139`) with class toggles owned by the new CSS.
  - Marquee: present `#lobby-code-display` via the new marquee classes (keep the span id).
  - Roll-Camera: `#start-btn` keeps its id + click→`startLobby` emit; `.textContent`, `.disabled`, and a `roll-camera roll-camera--{variant}` class come from `rollCameraLabel({ amIHost, playerCount, mode })`. Behaviour (when a start is actually allowed) is byte-identical.
- **The existing `render-lobby.test.js` / `socket-handlers.test.js` / `showScreen.test.js` are the byte-identical zero-regression guard — they are NOT edited.** The new structure MUST keep every existing assertion's target intact (host `👑` discoverable, `.btn-kick` `✕` + same emit, player name present, container `#lobby-players`). New structure (cards, emoji, `.is-entering`) is asserted only by new tests. (Same discipline as 7.4 Task 0: existing tests untouched + green = the proof; new tests pin new copy/structure.)

### 3.3 Markup — `public/index.html` (modify, additive)

- Additive structural wrappers/classes around existing `#waiting-room` nodes; **every existing `id` preserved** (`#lobby-code-display`, `#lobby-players`, `#mode-selector`, `#lobby-settings`, `#theme-select`, `#start-btn`, `#public-room-toggle`, etc.) so `ui-dom.js` bindings and all existing tests keep resolving.
- Add a `.marquee` wrapper around the room-code display; a `.director-panel` wrapper + a `.director-panel__header` ("Director") around the host-controls cluster (mode-selector + lobby-settings + start; the JS-injected add-bot row continues to `insertAdjacentElement` after `#start-btn` and is visually inside the panel).
- Re-voice the static `<p>Waiting for players…</p>` to premiere copy.
- Remove the inline `style=` attributes only on the rewritten waiting-room nodes (`#lobby-settings`, `#theme-select`, the public-toggle wrapper, `#start-btn`) — their visibility/layout is now class-driven. **Bounded DS-01: confined to `#waiting-room`.**

### 3.4 Styles — `public/css/02-hero-lobby.css` (modify, append-only)

- One appended Red-Carpet section: `.marquee` / `.marquee__cell`, `.entrance-card` (+ `.is-you`/`.is-host`/`.is-bot`/`.is-entering`), the emoji chip, `.director-panel` (+ `__header`), the mode-poster treatment, `.roll-camera` (+ `--ready`/`--waiting-host`/`--waiting-cast`), and `@keyframes cardEntrance`.
- `@keyframes cardEntrance` uses **transform + opacity only** (compositor-safe — the vanilla perf budget). No `width`/layout animation.
- Accent applied as `hsl(var(--card-accent) 70% 60%)` from the card's `--card-accent: {accentHue}` inline custom property (the only per-element inline value — a dynamic data value, not style debt, exactly the modal.js precedent).
- Uses `01-base.css` tokens (`--bg-elevated`, `--radius-*`, `--shadow-*`, `--accent-*`, `--text-*`). **No existing rule edited** (append-only; the legacy `#lobby-players li` rule may remain as a harmless fallback or be superseded by `.entrance-card` — additive, removable cleanly).
- **Reduced motion:** the existing global block (`06-states-anim.css:1020-1033`) already zeroes all `animation-duration`/`-iteration`/`transition-duration` on `*` — `cardEntrance` is auto-neutralised; the card renders **fully legible static** (accent, emoji, name, crown, wins). No per-rule reduced-motion handling needed (documented project convention); informational state never depends on motion.

### 3.5 Barrel — `public/js/ui.js` (modify, +1 line)

- `export * from './ui/red-carpet.js';` with a WHY comment (Phase 7.5). Importers (`ui-render.js`, tests) consume via the `./ui.js` barrel — no direct cross-module import cycle (7.3 DAG discipline). `ui-render.js` already lives behind the barrel; it imports the pure module via a **direct sibling import** `./red-carpet.js` (no barrel cycle), mirroring the 7.4 `ui-panels.js → ./daily-ritual.js` precedent.

---

## 4. 6c dedup boundary (binding)

6c Custom Rule Kits (specced in `2026-05-17-learning-breakdown-design.md` §1, pending build) owns any **rule/preset/kit mechanic**. 7.5's "Host-Director panel" is **presentational only**: it groups and re-skins the controls that **already exist** (mode, theme, hardcore, tv-shows, public, kick, add-bot, start). It introduces **no preset, no saved kit, no new host power, no new control, and no new socket event**. Theme-Packs copy (shipped in 7.4) is already presentation-only. If during build a reviewer sees anything resembling a rule-kit/preset mechanic, that is out-of-scope creep → `spawn_task` chip, never widen 7.5.

---

## 5. Data flow & security (binding)

- **Server unchanged.** No new socket event, no payload change, no server logic. `stateUpdate(waiting)` → `socketClient` → `renderLobby(state, myPlayerId)` (unchanged call site) → glue → pure fns → DOM. Theme/mode/toggle/kick/add-bot/start emits **byte-identical** (the Director panel only re-parents the same controls).
- **`stableId` never enters the lobby UI.** It is already destructured out of every client-bound player by `toClientState` (`gameLogic.js:111`) — this was the Phase-1 historical leak, test-pinned. `playerCardModel`'s accent key is structurally `name + ':' + socket-id` only; the function is forbidden from reading any persistent id. A **sentinel test** passes a player object that *includes* a `stableId` field and asserts the model output is byte-identical to the same object *without* it (the accent must not change), and a jsdom test asserts no `stableId` substring appears anywhere in `#waiting-room` after render.
- **Device-local / room-scoped only.** The per-player accent is derived per render from room-scoped data; nothing is persisted, no `localStorage`, no account. (Distinct from 7.4's daily streak which legitimately uses `localStorage`; 7.5 stores nothing.)

---

## 6. Edge cases / error handling

- **Re-render storm** (settings toggled rapidly): once an id is in `seen`, `diffArrivals` returns it not-entering → no animation replay. Tested.
- **Leave → rejoin:** rejoin yields a new socket id → treated as a genuine new arrival (re-animates). Correct & documented.
- **Disconnected-but-present** (`connected:false`, disconnect grace): same id stays in `players` → stays in `seen` → not re-animated. Correct.
- **Full page reload:** `_seenPlayerIds` resets → everyone "arrives" once = the correct first-paint premiere. Documented WHY.
- **Bots:** have `id`+`name` → get cards + deterministic accent; add-bot/remove-bot wiring unchanged.
- **Long names / many players:** card grid wraps/scrolls within the existing `.lobby-panel` width via CSS only; no JS.
- **Accent collision** (two players hash to same hue/emoji): purely cosmetic, acceptable; 360 hues × 12 emoji makes exact collision rare; not a correctness concern.
- **Malformed input:** every pure fn defends (non-array players, missing id/name, non-finite wins/playerCount) and never throws.
- **Reduced motion:** card fully legible static (no information conveyed by motion alone).

---

## 7. Testing strategy

TDD, jsdom for the glue, jest. Additive over the **52/395** post-7.4 baseline; coverage ratchet holds; **zero pre-existing-suite regression**.

- **`client-tests/red-carpet.test.js` (new)** — pure-fn contracts:
  - `diffArrivals`: empty seen → all entering; second call same roster → none entering (idempotent); add id → only it entering; removed id pruned from `seen`; leave→rejoin (new id) → entering; non-array / missing-id defensive; input not mutated (purity).
  - `playerCardModel`: determinism (same name+id → identical model across calls); `accentHue` integer 0–359; `accentEmoji` ∈ frozen 12-set; `label` exactly mirrors the `(You)`/`👑`/`• N 🏆` matrix; `isYou`/`isHost`/`isBot`/`wins` derivation; **security sentinel** — output byte-identical with vs without a `stableId` key on the input.
  - `rollCameraLabel`: the full §3.1 truth-table (solo/classic × player counts × host) — `disabled`/`variant` exact, `text` = the re-voiced strings.
  - `marqueeSegments`: normal code → per-char array; `''`/non-string → `[]`.
- **`client-tests/red-carpet-render.test.js` (new, jsdom)** — glue, mirroring `render-lobby.test.js` conventions (`loadIndexHtml()`+`initUIElements()`, mock `state.js`, import from `../public/js/ui.js`):
  - two successive `renderLobby` calls, same roster → first marks new ids `.is-entering`, second has **zero** `.is-entering`.
  - adding a 3rd player on the 2nd call → only that card `.is-entering`.
  - host crown still discoverable; `.btn-kick` still present + emits the same event; player name present; `#lobby-players` container intact.
  - Director panel contains the still-functional theme select + toggles (change still emits `setTheme` etc.).
  - **no `stableId` substring anywhere in `#waiting-room` innerHTML** after render.
  - team-mode state still routes to the untouched team screen (parity guard).
- **Pre-existing suites stay byte-identical and green** — especially `render-lobby.test.js`, `socket-handlers.test.js`, `showScreen.test.js`, `modal-factory.test.js`, `name-prompts.test.js`, and all server suites (this is the behavioural zero-regression proof, exactly the 7.4 discipline).
- **Per-task verify:** the relevant `npx jest <suite>`; then the full `npx jest` green.

---

## 8. Binding guardrails (restate, from decision-record §3 + 7.5-specific)

1. **No accounts / device-local / room-scoped.** 7.5 persists nothing (no `localStorage`); accent is per-render from room-scoped data.
2. **Daily-LB / identity security.** Never echo `stableId`; accent key is `name + socket-id` only; sentinel + jsdom no-`stableId` tests.
3. **Real-boot + in-browser gate.** 7.5 touches the lobby render path → real-boot/in-browser eyeball is **user-side** (jsdom never lays out or boots a browser): the marquee, the entrance animation on desktop + mobile + with OS reduced-motion, the Director panel layout, the Roll-Camera states. "Merged" ≠ "deployed."
4. **Perf budget.** `cardEntrance` is transform/opacity only (compositor-safe); no new timers/intervals; no layout-animating properties; honour the existing global `prefers-reduced-motion` block.
5. **6c dedup.** Host-Director is presentational only — no rule/preset/kit mechanic (§4).
6. **Pipeline & branch safety.** Spec→plan→subagent-build→PR in the isolated worktree `C:\mm-phase7-5` (branch `phase7-5-red-carpet-lobby` off `origin/main 5380167`); a parallel Codex agent shares the repo → verify `git -C C:/mm-phase7-5 branch --show-current == phase7-5-red-carpet-lobby` before **every** commit; native Task tools unavailable → TodoWrite + hand-authored co-located `.tasks.json` (status synced+committed per task); per-task two-stage review (spec-compliance then code-quality) + final opus whole-branch holistic; PR-merge / push-to-main / Render deploy is classifier-gated and handed to the user.
7. **WHY comments** on every code change.
8. **Scope discipline.** Out-of-scope findings → `spawn_task` chip, never widen 7.5. Existing lobby/server tests stay byte-identical (the zero-regression guard).

---

## 9. Explicitly out of scope / deferred

- **QR scan-to-join** — deferred. Rationale: a QR encoder is a no-build vendored dependency + an invite-URL-construction surface; isolatable; better homed with the share/Festival work (7.9) or a dedicated follow-up. Recorded so it is not forgotten.
- **Team-screen Red Carpet parity** (`renderTeamScreen` / `#team-screen`) — deferred; team mode renders **byte-identical**. A later pass brings team mode to parity.
- **Blanket DS-01 long-tail** — only inline styles inside the rewritten `#waiting-room` region are migrated. Explicitly untouched (still DS-01 "pass 2" backlog): `socketClient.js:191` (public-lobby browse card button), leaderboard-render `.style.cssText` (`app.js`), my-stats/daily-result empty-state inline styles (`ui-panels.js`), bulk `index.html` static `style=` outside `#waiting-room`, the `index.html` inline `<style>`. Dynamic `.style.*` (display/width/transform/the per-card `--card-accent` data value) is **not debt** — permanently excluded.
- **Playable Hero** — its own brainstorm gate (decision-record §1/§2.7.5).
- Any server/gameplay/socket/scoring/validation/theme-mechanic/accounts/persistence change.

---

## 10. Acceptance criteria (PR-level)

- [ ] New pure `public/js/ui/red-carpet.js` exports `diffArrivals`, `playerCardModel`, `rollCameraLabel`, `marqueeSegments` exactly per §3.1; zero imports; deterministic; defensive; WHY comments.
- [ ] Barrel `public/js/ui.js` re-exports it (+WHY); `ui-render.js` imports it via a direct sibling import (no barrel cycle).
- [ ] `renderLobby` glue: page-session `_seenPlayerIds`; entrance cards with `.is-entering` only on diffed arrivals; marquee + mode-poster + Director-panel + Roll-Camera re-skin; the inline styles in §1.1(6) migrated to classes; team-mode early-return path untouched; WHY comments.
- [ ] `index.html`: additive wrappers, **all existing ids preserved**, premiere copy, bounded inline-style removal confined to `#waiting-room`.
- [ ] `02-hero-lobby.css`: appended Red-Carpet section + `@keyframes cardEntrance` (transform/opacity only); no existing rule edited; tokens reused; reduced-motion auto-covered.
- [ ] `rollCameraLabel` `disabled`/`variant` truth-table byte-identical to current start-gating; only copy re-voiced.
- [ ] Security: accent key is `name + ':' + socket-id` only; sentinel test (model identical with/without `stableId`) + jsdom no-`stableId`-in-`#waiting-room` test green.
- [ ] New `red-carpet.test.js` + `red-carpet-render.test.js` green; **all pre-existing suites byte-identical and green** (esp. `render-lobby`, `socket-handlers`, `showScreen`); full `npx jest` green, additive over 52/395, ratchet held, zero pre-existing regression.
- [ ] Server: zero change. Team mode: byte-identical. No new socket event / scoring / validation / theme-mechanic / accounts / persistence.
- [ ] Real-boot/in-browser eyeball flagged user-side (jsdom can't lay out/boot a browser).
