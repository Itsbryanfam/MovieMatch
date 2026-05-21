# Phase 7.9 — Playable Hero (design spec)

**Status:** design approved, awaiting implementation plan
**Date:** 2026-05-20
**Branch:** `phase7-9-playable-hero` (off `origin/main` @ `17a79b2`, post-7.8c)
**Baseline suite:** 570 green
**Target suite:** ~587 green (+17 net, zero pre-existing tests edited)

---

## §0 — Context

Phase 7.7 promoted the in-game chain from a stack of `.chain-item` cards to a horizontal Constellation Board filmstrip (`.filmstrip` → `.reel` → `.reel-node` posters + `.reel-bridge` labeled-actor connectors + `.now-playing` accent on the latest node). Phase 7.8c added scan-to-join QR codes to the host lobby panels. Both phases lowered friction — visual clarity and join-barrier respectively.

Phase 7.9 lowers the **first-touch barrier**: a landing-page visitor who has never played MovieMatch should be able to **try one turn of the core chain mechanic** before committing to a room. Today the hero shows a static animated demo (Iron Man → Iron Man 2 → Jungle Book with Scarlett Johansson highlighted) using the **pre-7.7 `.chain-item` aesthetic** — a visual mismatch with what the live game actually looks like.

Phase 7.9 replaces that static demo with a **playable one-move puzzle** rendered in the **live Constellation Board aesthetic** (mini 2-node filmstrip with one unsolved bridge), driven by a new pure zero-import seam + thin driver + small server module. Visitor types an actor name → autocomplete returns candidates → pick one → server validates → reveal + funnel into the existing CTAs.

This phase serves as the first-touch funnel into Daily / Play Now / room-code. The QR scan-to-join from 7.8c lowered the *join* barrier; Playable Hero lowers the *try* barrier — same growth arc, complementary surfaces.

---

## §1 — Locked decisions (from brainstorm)

1. **Scope:** one-move puzzle — 2 movies displayed, one shared-actor guess. No mini-chains, no multi-link play, no retry loops.
2. **Data source:** live autocomplete (new dedicated `heroActorSearch` socket event) + new server-side validation events. Server is authoritative for puzzle bank and answer validation; the client never sees `validActorTmdbIds` for server-supplied puzzles.
3. **Placement:** replaces the existing `.hero-demo` block in `public/index.html` (lines ~154–186) **in place**. Hero headline, feature-pill row, and CTAs above/below stay byte-identical.
4. **Outcome flow:** one-shot, reveal-always. Pre-guess "Show me" affordance permitted. No retry-until-correct; no hint bank.
5. **Cold-start:** bundled fallback puzzle pair(s) ship inside the seam module for instant first paint (zero socket dependency for the first interaction). Server-supplied puzzle arrives via a lazy socket request and is used on subsequent renders / refreshes — never swapped mid-engagement.
6. **Architecture:** single pure seam (`hero-puzzle.js`) + thin driver (`hero-puzzle-controller.js`) + small server module (`server/heroPuzzle.js`). Mirrors red-carpet.js / chain-recap.js / turn-motion.js / daily-ritual.js lineage exactly. **3 linear TDD tasks** — pure seam → server+DOM+driver+integration → CSS append.
7. **Aesthetic:** mirror the live Constellation Board filmstrip — render as a 2-node mini-filmstrip using the **existing** `.filmstrip` / `.reel` / `.reel-node` / `.reel-bridge` classes from `03-game.css`. The unsolved bridge gets a new minimal modifier (`.reel-bridge--unsolved`); no edits to existing reel-* rules. Cast panel deferred — no spoilers before reveal; reveal-only cast surfacing is **out of scope** for 7.9 (deferred).

---

## §2 — Goals and non-goals

### Goals

- A first-time visitor can complete one interactive chain-puzzle turn on the hero in **~15 seconds**, zero room-join required.
- The hero puzzle **looks like the real game** — same filmstrip aesthetic, same reel-node + bridge primitives. Visitors get an accurate preview of the gameplay surface.
- Outcome funnels visibly toward the existing CTAs (`#hero-play-btn`, `#hero-daily-btn`, `#hero-code-btn`).
- The feature is **resilient to socket conditions** — bundled fallback ensures playability before the socket connects, offline, or on flaky networks.
- Net pre-existing test surface remains byte-identical (sacrosanct guard tests). New surface area adds ~17 net tests.

### Non-goals

- Multi-link mini-chains, hint banks, retry loops, score tracking.
- Telemetry / analytics for puzzle attempts.
- Replacing or competing with Daily / Quick Play.
- A `.now-playing` accent on either of the two hero-puzzle movies (the pair is simultaneous, not last-played — reserve `.now-playing` for live game semantics).
- Showing the full cast panel before the reveal (would spoil the answer). Post-reveal cast surfacing is **deferred** to a later iteration.
- New `@media` queries that affect non-hero rules.
- New color tokens.
- New HTTP routes / REST endpoints. All new behavior on the existing socket layer.
- Service worker changes (network-first picks up new files on demand).
- Cross-session memory of seen puzzles (localStorage). Module-level `_seen` is scoped to the current tab session only.
- Server-side rotation / daily-seeded hero puzzles. Server picks randomly from a small curated bank per request.

---

## §3 — Contract

### 3.1 — Client files

#### Create

**`public/js/ui/hero-puzzle.js`** — pure zero-import seam (~80 LOC).

```js
// PURE — no imports, no DOM, no socket, no clock.
// Bundled fallback puzzles for instant first-paint playability.
export const BUNDLED_PUZZLES = [
  {
    pairId: 'bundled-ironman2-jungle-book',
    movieA: {
      title: 'Iron Man 2',
      year: 2010,
      posterUrl: 'https://image.tmdb.org/t/p/w200/6WBeq4fCfn7AN0o21W9qNcRF2l9.jpg',
      tmdbId: 10138,
    },
    movieB: {
      title: 'The Jungle Book',
      year: 2016,
      posterUrl: 'https://image.tmdb.org/t/p/w200/2Epx7F9X7DrFptn4seqn4mzBVks.jpg',
      tmdbId: 278927,
    },
    validActorTmdbIds: [1245], // Scarlett Johansson
    revealActor: { tmdbId: 1245, name: 'Scarlett Johansson' },
  },
  // 1–2 more hand-curated pairs
];

export function pickBundledPuzzle({ seen = [] } = {}) {
  const fresh = BUNDLED_PUZZLES.filter(p => !seen.includes(p.pairId));
  const pool = fresh.length > 0 ? fresh : BUNDLED_PUZZLES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function classifyOutcome(puzzle, guess = {}) {
  if (!puzzle || guess.actorTmdbId == null) {
    return { kind: 'invalid' };
  }
  const correct = puzzle.validActorTmdbIds.includes(guess.actorTmdbId);
  return correct
    ? { kind: 'correct', revealActor: puzzle.revealActor }
    : {
        kind: 'incorrect',
        revealActor: puzzle.revealActor,
        guessedName: guess.actorName ?? null,
      };
}
```

**Contract guarantees:**
- Zero imports (verified by grep).
- No `document`, `window`, `Date.now`, `setTimeout`, `setInterval` (verified by grep).
- All exports are pure functions or frozen-shape data.
- `pickBundledPuzzle` never returns `undefined` on a non-empty bank.
- `classifyOutcome` handles all paths: correct, incorrect, invalid (null puzzle, missing tmdbId).

**`public/js/ui/hero-puzzle-controller.js`** — thin driver (~120 LOC).

Exports:
- `mountHeroPuzzle(socket)` — idempotent; mounts the bundled puzzle into `#hero-puzzle`, wires the input + autocomplete, kicks off the lazy server request. If already mounted (DOM already painted), no-op.

Module-level state:
- `_serverPuzzle` — cached `heroPuzzleDelivered` payload, used on next render after the visitor commits to bundled.
- `_currentPuzzle` — currently-displayed puzzle (bundled on first paint, server on subsequent if available).
- `_seen` — array of seen pairIds this session.

Imports (allowed):
- `pickBundledPuzzle`, `classifyOutcome` from `./hero-puzzle.js`.
- The existing autocomplete rendering helper, if isolatable, OR an inline minimal dropdown painter for the hero-specific UI.

Imports (forbidden — would create circular dependencies):
- `app.js`, `socketClient.js`, anything that imports back into `ui-render.js`.

**`client-tests/hero-puzzle.test.js`** — ~7 unit tests for the pure seam (see §6.1).

**`client-tests/hero-puzzle-controller.test.js`** — ~6 integration tests for the driver with mocked socket (see §6.2).

#### Modify

**`public/index.html`** — replace the `.hero-demo` block (lines ~154–186) with the new mount markup. Lines outside this block stay byte-identical.

```html
<div class="hero-demo hero-puzzle-mount"
     id="hero-puzzle"
     data-state="awaiting-guess"
     aria-label="Try a turn — name the actor connecting these two">
  <div class="hero-puzzle-prompt">Who connects these two?</div>
  <div class="filmstrip">
    <div class="reel">
      <!-- Driver paints: .reel-node × 2 + .reel-bridge.reel-bridge--unsolved -->
    </div>
  </div>
  <div class="hero-puzzle-input">
    <input id="hero-puzzle-search" type="text"
           placeholder="Name an actor in both…" autocomplete="off">
    <div class="autocomplete-results" id="hero-puzzle-autocomplete"></div>
  </div>
  <button class="hero-puzzle-skip" type="button">Show me</button>
</div>
```

Notes:
- `.hero-demo` class retained so existing hero-body grid placement still works.
- `id="hero-puzzle"` for JS targeting; `data-state` drives CSS state-based visibility.
- `aria-label` describes the interactive intent.

**`public/js/ui.js`** — barrel re-export for `hero-puzzle.js` exports (so future consumers can pull from the barrel; the driver itself imports directly from `./hero-puzzle.js`).

**`public/js/app.js`** — single addition: on hero-screen activation, call `mountHeroPuzzle(socket)` (idempotent).

**`public/css/02-hero-lobby.css`** — append-only "Phase 7.9 — Playable Hero" section at end (~50 LOC). Zero edits to pre-existing rules.

### 3.2 — Server files

#### Create

**`server/heroPuzzle.js`** — small bank + validators (~50 LOC).

```js
const HERO_PUZZLE_BANK = [
  // 5–10 hand-curated pairs. Each entry has the same shape as bundled.
  {
    pairId: 'hp_001',
    movieA: { title: '…', year: …, posterUrl: '…', tmdbId: … },
    movieB: { title: '…', year: …, posterUrl: '…', tmdbId: … },
    validActorTmdbIds: [/* one or more */],
    revealActor: { tmdbId: …, name: '…' },
  },
  // …
];

function pickRandomPuzzle() {
  return HERO_PUZZLE_BANK[Math.floor(Math.random() * HERO_PUZZLE_BANK.length)];
}

function toClientPuzzle(puzzle) {
  // Strip validActorTmdbIds before sending to client.
  return {
    pairId: puzzle.pairId,
    movieA: puzzle.movieA,
    movieB: puzzle.movieB,
  };
}

function validateGuess(pairId, actorTmdbId) {
  const puzzle = HERO_PUZZLE_BANK.find(p => p.pairId === pairId);
  if (!puzzle) return { ok: false, reason: 'unknown-pair' };
  const correct = puzzle.validActorTmdbIds.includes(actorTmdbId);
  return { ok: true, correct, revealActor: puzzle.revealActor };
}

module.exports = {
  HERO_PUZZLE_BANK,
  pickRandomPuzzle,
  toClientPuzzle,
  validateGuess,
};
```

**`server/hero-puzzle.test.js`** — ~4 unit tests (see §6.3).

#### Modify

**`server/socketHandlers.js`** — append 3 new listeners. Existing handlers byte-identical. (Confirmed filename: `server/socketHandlers.js`; existing `autocompleteSearch` listener at L331 routes to `server/systems/matchSystem.js:autocompleteSearch` which requires a lobby — the hero handlers must NOT route through that path because the visitor has no lobby. Hero handlers either call a thin new actor-search helper alongside `matchSystem.autocompleteSearch` or live in a small dedicated module.)

```js
// Phase 7.9 — Playable Hero socket events. Pre-room; no game-state access.
socket.on('heroPuzzleRequest', () => {
  const puzzle = pickRandomPuzzle();
  socket.emit('heroPuzzleDelivered', toClientPuzzle(puzzle));
});

socket.on('heroActorSearch', async ({ query }) => {
  // Hero-specific TMDB person-search call. Cannot route through
  // matchSystem.autocompleteSearch — that path requires a lobby AND
  // socket-in-lobby membership (matchSystem.js:93-95). Hero is pre-room.
  // TMDB endpoint: `${TMDB_API_BASE}/search/person?query=...`
  // (parallel to the existing /search/movie + /search/tv calls in
  // matchSystem.js:99). Implementer choice: add a `searchPersonForHero(query)`
  // helper alongside `autocompleteSearch` in matchSystem.js, OR put it in a
  // small dedicated module. Contract is what matters.
  const results = await searchTmdbPeopleForHero(query);
  socket.emit('heroActorResults', { query, results });
});

socket.on('heroGuessSubmit', ({ pairId, actorTmdbId, actorName }) => {
  const result = validateGuess(pairId, actorTmdbId);
  if (!result.ok) {
    socket.emit('heroGuessResult', { pairId, correct: false, revealActor: null });
    return;
  }
  socket.emit('heroGuessResult', {
    pairId,
    correct: result.correct,
    revealActor: result.revealActor,
  });
});
```

Note: the exact server-side TMDB person-search helper is implementation detail; if a clean reusable function exists, reuse; otherwise add a thin wrapper alongside `heroPuzzle.js`. **No new HTTP routes.**

### 3.3 — Socket protocol (3 new events)

| Client → Server | Payload | Server → Client | Payload |
|---|---|---|---|
| `heroPuzzleRequest` | `{}` | `heroPuzzleDelivered` | `{ pairId, movieA: { title, year, posterUrl, tmdbId }, movieB: {…} }` |
| `heroActorSearch` | `{ query: string }` | `heroActorResults` | `{ query, results: [{ tmdbId, name, profilePath?, knownFor? }] }` |
| `heroGuessSubmit` | `{ pairId, actorTmdbId, actorName }` | `heroGuessResult` | `{ pairId, correct: boolean, revealActor: { tmdbId, name } \| null }` |

**`validActorTmdbIds` is NEVER echoed to the client for server-supplied puzzles.** (Bundled puzzles ship with `validActorTmdbIds` baked in for offline-fallback validation — acceptable because they're hand-curated demo content, not the canonical bank.)

### 3.4 — DOM additions

Replaces the `.hero-demo` block in `index.html`. See §3.1 for the markup template. Driver paints:

```html
<div class="reel">
  <div class="reel-node">
    <img class="reel-poster" src="{movieA.posterUrl}" alt="{movieA.title}">
    <div class="reel-title">{movieA.title} <span class="year">({movieA.year})</span></div>
  </div>
  <div class="reel-bridge reel-bridge--unsolved">
    <span class="reel-bridge-label">↔ ?</span>
  </div>
  <div class="reel-node">
    <img class="reel-poster" src="{movieB.posterUrl}" alt="{movieB.title}">
    <div class="reel-title">{movieB.title} <span class="year">({movieB.year})</span></div>
  </div>
</div>
```

On reveal, `.reel-bridge--unsolved` is removed and the label becomes `↔ {revealActor.name}`.

### 3.5 — CSS additions

`public/css/02-hero-lobby.css`, appended at end. Banner:

```css
/* ============================================================
   Phase 7.9 — Playable Hero
   ============================================================ */
```

New rules (additive only):
- `.hero-puzzle-mount` — flex column layout, gap, padding, max-width caps for desktop/tablet.
- `.hero-puzzle-prompt` — heading style (no new color tokens).
- `.reel-bridge--unsolved` — subtle pulse opacity 0.7 ↔ 1.0 over 1.6 s, `↔ ?` styling.
- `.hero-puzzle-input` — wrapper for input + dropdown.
- `.hero-puzzle-skip` — small ghost-text button below the filmstrip.
- `.hero-puzzle-outcome` — reveal card (border-radius, padding, opacity fade-in, soft CTA pointer glow).
- `[data-state="checking"]` — input disabled visual.
- `[data-state^="revealed-"]` — hide input + skip; show outcome card; remove pulse on bridge.
- `@media (max-width: 999px)` — scaled-down filmstrip nodes + prompt size.
- `@media (max-width: 639px)` — mobile compaction (nodes shrink further; bridge label stays readable).

**Reused classes (zero CSS additions for these):**
- `.filmstrip` / `.reel` / `.reel-node` / `.reel-poster` / `.reel-title` / `.reel-bridge` — all already defined in `03-game.css` from Phase 7.7. The hero just mounts elements with those classes.

**No edits to existing rules. Zero deletions. No new color tokens. No new `@media` queries that affect non-hero rules.**

---

## §4 — Data flow lifecycle

### 4.1 — First paint (T = 0 ms)

- `index.html` parses; `app.js` calls `mountHeroPuzzle(socket)` as soon as `#hero-screen.active` is observable.
- Driver: `_currentPuzzle = pickBundledPuzzle({ seen: _seen })`.
- Driver renders the `.reel` content into `#hero-puzzle .filmstrip > .reel`.
- `data-state="awaiting-guess"`. Visitor can interact immediately.

### 4.2 — Background socket warmup (T ≈ 50–500 ms)

- Driver emits `heroPuzzleRequest` once on mount.
- Server picks random puzzle, emits `heroPuzzleDelivered` with `toClientPuzzle(...)` (no `validActorTmdbIds`).
- Driver stores in `_serverPuzzle`. Checks:
  - `container.dataset.state === 'awaiting-guess'` AND
  - `#hero-puzzle-search` value is empty (visitor hasn't typed yet)
- If both true → swap `_currentPuzzle = _serverPuzzle` and re-render the `.reel` content in place. Otherwise, server puzzle is cached for next render (e.g., on refresh).
- If socket never connects (offline / dropped): bundled puzzle remains; everything still works.

### 4.3 — Visitor types in the input (T ≈ 5–15 s)

- `input` event → 200 ms debounce → `socket.emit('heroActorSearch', { query })`.
- Server returns `heroActorResults` with up to N actor records.
- Driver paints results into `#hero-puzzle-autocomplete` (dropdown items are `<button>`s for keyboard accessibility).
- Empty or no-match queries: dropdown shows "No actors matched — try a fuller name". No socket emit for empty queries (post-debounce).
- **Offline path:** if socket disconnected, dropdown shows a tiny built-in candidate list — 3–4 names from the bundled puzzle's `revealActor` + plausible decoys. Visitor can still complete the interaction.

### 4.4 — Visitor picks a result (T ≈ 15 s)

- Click on dropdown item → driver reads `tmdbId` + `name` from the item's dataset → `socket.emit('heroGuessSubmit', { pairId, actorTmdbId, actorName })`.
- UI enters `data-state="checking"` (input disabled, brief bridge pulse).
- **Offline path:** skip socket; call `classifyOutcome(_currentPuzzle, { actorTmdbId, actorName })` directly. Only works for bundled puzzles (which have `validActorTmdbIds`). If the current puzzle is server-supplied AND we're offline, the driver falls back to its cached bundled puzzle for the reveal (graceful degradation).

### 4.5 — Reveal (T ≈ 15.2 s)

- `heroGuessResult` arrives → driver flips `data-state` to `revealed-correct` or `revealed-incorrect`.
- `.reel-bridge--unsolved` modifier removed; bridge label becomes `↔ {revealActor.name}`.
- Outcome card appears below the filmstrip with:
  - **Correct:** "Nailed it — they're both in {revealActor.name}'s filmography." + a "Play the real game →" pointer that adds a soft accent-color glow to `#hero-play-btn` (no DOM movement, compositor-only).
  - **Incorrect:** "Almost — {guessedName} wasn't in both. The connection was {revealActor.name}." + same pointer.
- Input + Skip button hidden.

### 4.6 — "Show me" short-circuit

- Click "Show me" → driver calls local `revealNow()` using `_currentPuzzle.revealActor`.
- `data-state="revealed-skipped"`. Bridge fills in. Outcome card: "Here's how it connects — {revealActor.name} is in both." + CTA pointer.
- No socket round-trip.

### 4.7 — Refresh / re-mount

- `mountHeroPuzzle(socket)` is idempotent. If called on an already-painted `#hero-puzzle`, it no-ops.
- On a fresh page load, `_seen` resets (module-level, not persisted). Bundled picker honors the (empty) seen list.
- Server is re-requested on every fresh load → new random server puzzle.

### 4.8 — Edge / error handling

| Scenario | Behavior |
|---|---|
| Socket never connects | Bundled puzzle + offline-friendly dropdown + offline reveal. Full interaction works. |
| `heroPuzzleDelivered` times out | No-op; bundled puzzle remains. |
| `heroActorSearch` returns empty | Dropdown shows "No actors matched" message. |
| `heroGuessResult` times out (~3 s) | Driver falls back to `classifyOutcome` against bundled `validActorTmdbIds` (works if current puzzle is bundled). If current is server-supplied, show "Connection wobbled — try again" with a single retry button. |
| Visitor presses Enter on empty input | No-op (submit only fires on dropdown item click). |
| Visitor opens hero a second time mid-session | Existing puzzle state persists. (Multi-play / "try another" affordance deferred — see §9.) |
| Server `validateGuess` returns `{ ok: false, reason: 'unknown-pair' }` | Driver treats as incorrect with `revealActor: null`; outcome card shows generic copy. (Defensive — should only happen if client/server bank versions drift.) |

---

## §5 — Behavioural equivalence and regression safety

### 5.1 — Namespace separation

The hero puzzle uses fully separate identifiers from the live game:

| Surface | Hero puzzle | Live game |
|---|---|---|
| DOM mount | `#hero-puzzle` | `#chain-display`, `#movie-input` |
| Input ID | `#hero-puzzle-search` | `#movie-input` |
| Autocomplete container | `#hero-puzzle-autocomplete` | (existing in-game dropdown) |
| Socket events | `heroPuzzleRequest`, `heroActorSearch`, `heroGuessSubmit` | `autocompleteSearch`, `submitMovie`, `attemptFailed` |
| CSS classes (new) | `.hero-puzzle-mount`, `.hero-puzzle-prompt`, `.hero-puzzle-input`, `.hero-puzzle-skip`, `.hero-puzzle-outcome`, `.reel-bridge--unsolved` | (none — live game uses the existing `.filmstrip` / `.reel-node` / `.reel-bridge`) |
| CSS classes (read-only reused) | `.filmstrip`, `.reel`, `.reel-node`, `.reel-poster`, `.reel-title`, `.reel-bridge` | Same — but defined in `03-game.css`; we don't redefine them |
| Server module | `server/heroPuzzle.js` | `server/gameLogic.js`, etc. |

### 5.2 — Byte-identical surfaces (zero-regression proof)

The following stay byte-identical and green; verified by `git diff` after build:

- `public/js/ui/ui-render.js` (specifically `renderChainItems` and the live filmstrip construction at lines ~690+)
- `public/css/03-game.css` (all live-game reel-* rules)
- `server/gameLogic.js`, `server/systems/matchSystem.js` (all live game logic — note the actual path is `server/systems/matchSystem.js`)
- The existing `autocompleteSearch` / `submitMovie` / `attemptFailed` socket handlers in `server/socketHandlers.js` (only NEW handlers are appended; existing ones are not edited)
- Hero headline + feature-pill row + CTA group + fine-print line in `index.html` (lines outside ~154–186)
- Service worker `public/sw.js`

### 5.3 — Sacrosanct test suites

These suites MUST stay byte-identical and green:

- `client-tests/render-chain.test.js`
- `client-tests/render-lobby.test.js`
- `client-tests/render-team-screen.test.js`
- `client-tests/red-carpet*.test.js`
- `client-tests/chain-recap.test.js`
- `client-tests/turn-motion.test.js`
- `client-tests/render-qr.test.js`
- All `server/**` test files

Verified by `git diff` showing empty for each + full suite green.

---

## §6 — TDD task breakdown

Three linear tasks. Each is committable, reviewable, and lands one cohesive layer.

### 6.1 — Task 0: pure seam + bundled bank + ~7 unit tests

**Goal:** Ship `public/js/ui/hero-puzzle.js` with full unit-test coverage. No DOM, no socket, no integration.

**Files:**
- Create: `public/js/ui/hero-puzzle.js` (~80 LOC)
- Create: `client-tests/hero-puzzle.test.js` (~7 tests)
- Modify: `public/js/ui.js` (barrel re-export)

**Acceptance:**
- `BUNDLED_PUZZLES` has 1–3 valid entries with all required fields.
- `pickBundledPuzzle({ seen })` honors `seen`; never returns `undefined` on non-empty bank; falls back to full pool when all seen.
- `classifyOutcome` returns:
  - `{ kind: 'correct', revealActor }` on `actorTmdbId` ∈ `validActorTmdbIds`
  - `{ kind: 'incorrect', revealActor, guessedName }` on mismatch
  - `{ kind: 'invalid' }` on null/undefined puzzle or missing `actorTmdbId`
- Pure: grep confirms no `import` (except possibly JSON), no `document`, no `window`, no `Date.now`, no `setTimeout`.
- Pre-existing **570 tests stay green** → ~577 total.

**Verify:** `npx jest client-tests/hero-puzzle.test.js --verbose && npm test --silent`

### 6.2 — Task 1: server module + socket events + DOM + driver + ~10 integration tests

**Goal:** Wire the full stack. No CSS yet (driver renders into the existing `.filmstrip` / `.reel-node` / `.reel-bridge` classes; structure works, visuals will land in T2).

**Files:**
- Create: `server/heroPuzzle.js` (~50 LOC)
- Create: `server/hero-puzzle.test.js` (~4 tests)
- Modify: `server/socketHandlers.js` (or equivalent) — append 3 listeners
- Modify: `public/index.html` — replace `.hero-demo` block (lines ~154–186) with mount markup. All other markup byte-identical.
- Create: `public/js/ui/hero-puzzle-controller.js` (~120 LOC)
- Modify: `public/js/app.js` — call `mountHeroPuzzle(socket)` on hero-screen activation
- Create: `client-tests/hero-puzzle-controller.test.js` (~6 integration tests)

**Acceptance:**
- `mountHeroPuzzle(socket)` is idempotent; paints bundled puzzle on first call into `#hero-puzzle .filmstrip > .reel` as `.reel-node × 2 + .reel-bridge.reel-bridge--unsolved`.
- `heroPuzzleRequest` emitted once on mount.
- `heroPuzzleDelivered` swaps puzzle in place ONLY IFF `data-state === 'awaiting-guess'` AND input is empty.
- Clicking a dropdown item emits `heroGuessSubmit` with `{ pairId, actorTmdbId, actorName }`.
- `heroGuessResult` flips `data-state` to `revealed-correct` / `revealed-incorrect`; bridge fills in with `revealActor.name`; outcome card appears.
- "Show me" button skips to reveal without socket round-trip.
- Offline path: `classifyOutcome` against bundled puzzle when socket is disconnected; reveal still works.
- Server `validateGuess` returns correct on tmdbId match, incorrect on mismatch, `{ ok: false, reason: 'unknown-pair' }` on bad pairId.
- Server `toClientPuzzle` strips `validActorTmdbIds`.
- **SACROSANCT** suites stay byte-identical and green (see §5.3).
- Suite: ~577 + 10 = **~587 green**.

**Verify:** `npm test --silent` → ~587 green. `git diff` on sacrosanct files → empty. `git diff public/index.html` → confined to the `.hero-demo` block.

### 6.3 — Task 2: CSS append (zero deletions)

**Goal:** Visual styling. Append-only; zero edits to pre-existing rules.

**Files:**
- Modify: `public/css/02-hero-lobby.css` — append "Phase 7.9 — Playable Hero" banner section (~50 LOC)

**Acceptance:**
- All new rules confined to the appended section.
- Rules added (additive only): `.hero-puzzle-mount`, `.hero-puzzle-prompt`, `.reel-bridge--unsolved`, `.hero-puzzle-input`, `.hero-puzzle-skip`, `.hero-puzzle-outcome`, `[data-state="checking"]`, `[data-state^="revealed-"]`.
- Two new `@media` queries (`max-width: 999px` and `max-width: 639px`) scoped to hero-puzzle rules only.
- **No edits to pre-existing rules** — `git diff --stat public/css/02-hero-lobby.css` shows insertions only, ZERO deletions.
- No new color tokens (uses existing `--text-main`, `--accent-primary`, `--bg-base`, `--radius-md`).
- Compositor-only animations (transform / opacity); existing global `prefers-reduced-motion` neutralizer covers the new animations.
- Suite stays **~587 green**.

**Verify:** `npm test --silent && git diff --stat public/css/02-hero-lobby.css` → 587 green; insertions > 0, deletions == 0.

### 6.4 — Test count summary

| Phase | Suite size | Delta |
|---|---|---|
| Baseline (post-7.8c) | 570 | — |
| After T0 | ~577 | +7 (pure seam) |
| After T1 | ~587 | +4 server + +6 driver integration |
| After T2 | ~587 | 0 (CSS-only) |

---

## §7 — Review gates

Each task goes through the standard two-stage review per the established Phase 7 pipeline:

1. **Implementer subagent** builds the task, runs tests, self-reviews, commits.
2. **Spec compliance reviewer subagent** checks against this spec's acceptance criteria + §8 guardrails for the task's scope. Loop until ✅.
3. **Code quality reviewer subagent** checks for style, readability, dead code, missing tests. Loop until ✅.
4. **Whole-branch opus holistic review** after all three tasks complete — validates the full §8 guardrails list with evidence.

Final pre-PR step: full suite green + manual smoke check on a deployed branch (since jsdom can't operate the real socket / TMDB search). Smoke checklist included in the PR description.

---

## §8 — Binding guardrails

Ten guardrails that MUST hold at PR time. Each is verifiable.

1. **Live `autocompleteSearch` socket handler byte-identical.** Verified by `git diff` on the server file — only additive handlers, no edit to the existing one.
2. **Live `submitMovie` / chain validation flow byte-identical.** Same `git diff` check.
3. **`renderChainItems` and live filmstrip construction in `ui-render.js` untouched.** `git diff public/js/ui/ui-render.js` → empty (or scoped only to imports if a barrel re-export is centralized).
4. **Existing `.reel-node` / `.reel-bridge` / `.filmstrip` / `.now-playing` CSS rules in `03-game.css` untouched.** `git diff --stat public/css/03-game.css` → zero changes.
5. **`public/css/02-hero-lobby.css` is append-only.** `git diff --stat` → insertions only, zero deletions.
6. **`public/index.html` diff confined to the `.hero-demo` block.** Lines outside ~154–186 byte-identical.
7. **`hero-puzzle.js` is pure zero-import.** No `import` (except possibly JSON), no `document`, no `window`, no `Date.now`, no `setTimeout`. Verified by grep.
8. **No new HTTP routes.** All new behavior on the socket layer. Verified by `git diff` showing no Express route additions.
9. **Sacrosanct test suites byte-identical and green** (see §5.3 list). Verified by `git diff` empty for each + full suite green.
10. **No new color tokens, no new `@media` queries affecting non-hero rules, compositor-only animations.** Verified by inspecting the `02-hero-lobby.css` diff.

---

## §9 — Deferred

Out of scope for 7.9, to consider in later iterations:

- **Post-reveal cast panel** — show the full TMDB cast of one of the two movies after reveal, mirroring the live-game cast-panel UX. Adds value as a teaching moment but doubles the visual footprint and CSS scope.
- **"Try another" affordance** — let visitors play a second puzzle without refreshing. Trivial to add but pulls the experience away from one-shot simplicity.
- **Cross-session memory (localStorage)** — track seen pairIds across page loads so returning visitors don't see the same bundled puzzle twice.
- **Telemetry** — count attempts, success rate, dropdown-pick distribution. Useful for tuning the bank but adds an analytics dependency.
- **Daily-rotated hero puzzle** — instead of random per request, server seeds a daily hero puzzle that's the same for all visitors that day. Symmetry with Daily Challenge.
- **A11y enhancement: keyboard-only puzzle completion** — current design relies on click for dropdown picks; add Tab/Arrow navigation + Enter to pick.
- **Cleanup of stale local/remote branches** — the Phase 7 build has accumulated ~25 stale branches; a separate hygiene task.

---

## §10 — Acceptance criteria for the phase

7.9 ships when:

1. All 3 tasks (T0, T1, T2) merged into `phase7-9-playable-hero` with each task's per-task spec-compliance and code-quality reviews ✅.
2. Whole-branch opus holistic review = GO with §8 guardrails 1–10 evidenced.
3. Full suite ~587 green; sacrosanct test diffs empty.
4. Manual smoke check (required pre-merge gate, since jsdom can't run a real socket / TMDB):
   - First paint shows the playable bundled puzzle in the live Constellation Board aesthetic (2 reel-nodes + unsolved bridge with `↔ ?`).
   - Headline, feature pills, and CTAs above/below the puzzle are byte-identical to today's hero.
   - Typing in the input shows TMDB actor results in the dropdown.
   - Picking a correct actor → reveal-correct outcome card + soft glow on `#hero-play-btn`.
   - Picking a wrong actor → reveal-incorrect outcome card with the right answer disclosed.
   - "Show me" reveals the answer without guessing.
   - On a flaky / offline connection, the bundled puzzle still works end-to-end via the offline dropdown candidates.
   - Mobile (`max-width: 639px`) compaction is legible.
   - OS reduced-motion: bridge pulse is neutralized; reveal is instant; no animation jitter.
   - Live game (join a room, play a chain) is byte-identical — same filmstrip, same autocomplete, same chain validation.
5. PR opened, reviewed, and merged by the user (the explicit merge confirmation in-session is required before the post-merge reconcile is run).

---

## §11 — Lessons applied

From the 7.5–7.8c run:

- **Plan must list barrel re-exports and any necessary-collateral guard updates.** This spec calls out `public/js/ui.js` re-export explicitly in §3.1 and §6 (Task 1's "Files" lists `ui.js` modification).
- **Plan must list jsdom-shim / setup files if touched.** This spec uses only standard jsdom features for the controller tests — no `setup.js` shim additions anticipated. If T1 implementation discovers a need (e.g., `requestAnimationFrame` shim), it's an additive append-only change documented at the time and surfaced in the spec-compliance review.
- **Fix the buggy plan-test, NEVER the protected path.** If T1 integration tests reveal a buggy assertion in the spec (e.g., a `textContent === '...'` against a multi-child element), the fix goes in the test, not the production code.
- **Pre-room socket handlers MUST be game-state-safe.** `heroPuzzle.js` server module has no access to lobby / game state — it only consults the in-memory bank. Verified at implementation time.
- **Bundled fallback is for resilience, not "always client-side."** The user explicitly chose live autocomplete + server validation. The bundled fallback exists to make the surface playable before the socket connects and to support offline degradation; it is NOT the primary path.
- **Live game CSS rules are sacrosanct.** Reusing `.filmstrip` / `.reel-node` / `.reel-bridge` means READING those rules, not redefining them. T2 CSS append touches only hero-puzzle-specific selectors.
- **Destructive worktree-remove / branch-delete after PR merge requires explicit user confirmation in-session — never git-state inference.** Applies post-merge as in 7.6 / 7.6.2 / 7.7 / 7.8c.
- **Manual smoke check is the pre-merge gate** for surfaces that jsdom can't exercise (real socket, real TMDB search, real visual layout, real mobile breakpoints). Spelled out in §10.4.

---

End of spec.
