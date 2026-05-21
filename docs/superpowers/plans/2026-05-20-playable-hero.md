# Playable Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pre-7.7 static `.hero-demo` block on the landing page with a playable one-move puzzle rendered in the live Constellation Board aesthetic, lowering the first-touch barrier and funneling into existing CTAs.

**Architecture:** Single pure zero-import seam (`public/js/ui/hero-puzzle.js`) with a bundled fallback puzzle bank + selection + outcome classification; thin driver (`public/js/ui/hero-puzzle-controller.js`) wiring DOM + autocomplete + socket; small server module (`server/heroPuzzle.js`) holding a curated puzzle bank + validator; 3 new pre-room socket events (`heroPuzzleRequest`, `heroActorSearch`, `heroGuessSubmit`). The hero reuses the existing `.filmstrip` / `.reel-node` / `.reel-bridge` CSS classes from `03-game.css` for visual parity with live gameplay — no edits to those rules.

**Tech Stack:** Vanilla JS ES modules (no bundler), Socket.IO, Express, Jest + jsdom, existing TMDB integration (matchSystem.js patterns), Pino logger.

---

## File Structure

### Client (3 new, 4 modified)

| File | Status | Purpose |
|---|---|---|
| `public/js/ui/hero-puzzle.js` | **Create** | Pure zero-import seam: bundled bank + `pickBundledPuzzle` + `classifyOutcome` |
| `public/js/ui/hero-puzzle-controller.js` | **Create** | Thin driver: `mountHeroPuzzle(socket)`, DOM + autocomplete + socket wiring |
| `client-tests/hero-puzzle.test.js` | **Create** | 7 unit tests for the pure seam |
| `client-tests/hero-puzzle-controller.test.js` | **Create** | 6 integration tests for the driver |
| `public/js/ui.js` | **Modify** | Barrel re-export of `./ui/hero-puzzle.js` |
| `public/js/app.js` | **Modify** | Import + call `mountHeroPuzzle(socket)` on init |
| `public/index.html` | **Modify** | Replace `.hero-demo` block (lines ~154–186) with new mount markup |
| `public/css/02-hero-lobby.css` | **Modify** | Append-only Phase 7.9 section (~50 LOC) |

### Server (2 new, 1 modified)

| File | Status | Purpose |
|---|---|---|
| `server/heroPuzzle.js` | **Create** | Curated puzzle bank + `pickRandomPuzzle` + `toClientPuzzle` + `validateGuess` + `searchPersonForHero` |
| `server/hero-puzzle.test.js` | **Create** | 4 unit tests for the validators |
| `server/socketHandlers.js` | **Modify** | Append 3 new `on(...)` listeners |

### Acceptance summary

- Suite goes from **570 → ~587 green** (+17 net; +7 T0 + +10 T1; T2 is CSS-only).
- Sacrosanct test suites stay byte-identical: `render-chain.test.js`, `render-lobby.test.js`, `render-team-screen.test.js`, `red-carpet*.test.js`, `chain-recap.test.js`, `turn-motion.test.js`, `render-qr.test.js`, all `server/**` tests.
- Existing `.reel-node` / `.reel-bridge` / `.filmstrip` CSS in `03-game.css` untouched.
- `public/css/02-hero-lobby.css` diff is insertions only, zero deletions.
- `public/index.html` diff confined to the `.hero-demo` block (lines ~154–186).
- `server/socketHandlers.js` diff is additive listeners only; existing handlers byte-identical.
- No new HTTP routes. No service worker edits. No new color tokens.

---

## Task 0: Pure Seam + Bundled Bank + 7 Unit Tests

**Goal:** Ship `public/js/ui/hero-puzzle.js` with a bundled fallback puzzle bank, two pure exported functions, and full unit-test coverage. No DOM, no socket, no integration yet.

**Files:**
- Create: `public/js/ui/hero-puzzle.js` (~85 LOC)
- Create: `client-tests/hero-puzzle.test.js` (~140 LOC, 7 tests)
- Modify: `public/js/ui.js` (single new `export * from` line)

**Acceptance Criteria:**
- [ ] `BUNDLED_PUZZLES` exported as a frozen array with 3 entries; each entry has `pairId` (unique string), `movieA`, `movieB`, `validActorTmdbIds` (non-empty number[]), `revealActor` (`{ tmdbId, name }`).
- [ ] `pickBundledPuzzle({ seen })` honors `seen`; never returns `undefined` on the non-empty bank; falls back to the full bank when all ids are in `seen`.
- [ ] `classifyOutcome(puzzle, { actorTmdbId, actorName })`:
  - returns `{ kind: 'correct', revealActor }` when `actorTmdbId` ∈ `puzzle.validActorTmdbIds`
  - returns `{ kind: 'incorrect', revealActor, guessedName }` when `actorTmdbId` is present but not in `validActorTmdbIds`
  - returns `{ kind: 'invalid' }` when `puzzle` is null/undefined OR `actorTmdbId` is missing/null
- [ ] No `import` in `hero-puzzle.js` (grep verified).
- [ ] No `document`, `window`, `Date.now`, `setTimeout`, `setInterval` in `hero-puzzle.js` (grep verified).
- [ ] `public/js/ui.js` adds exactly one line: `export * from './ui/hero-puzzle.js';`.
- [ ] Pre-existing **570 tests stay green** → **577 total**.

**Verify:** `npx jest client-tests/hero-puzzle.test.js --verbose && npm test --silent` → 7 green, suite 577 total.

**Steps:**

- [ ] **Step 1: Write the failing tests for the pure seam**

Create `client-tests/hero-puzzle.test.js`:

```javascript
/**
 * @jest-environment jsdom
 */
// Phase 7.9 — Playable Hero pure seam unit tests. WHY: the seam owns the
// bundled puzzle bank, selection logic, and guess-outcome classification.
// Pure functions, no DOM, no socket — full coverage at this layer keeps
// the driver tests focused on wiring.
import {
  BUNDLED_PUZZLES,
  pickBundledPuzzle,
  classifyOutcome,
} from '../public/js/ui.js';

describe('BUNDLED_PUZZLES', () => {
  test('exports a non-empty array of well-formed puzzles', () => {
    expect(Array.isArray(BUNDLED_PUZZLES)).toBe(true);
    expect(BUNDLED_PUZZLES.length).toBeGreaterThanOrEqual(1);
    expect(BUNDLED_PUZZLES.length).toBeLessThanOrEqual(3);

    for (const p of BUNDLED_PUZZLES) {
      expect(typeof p.pairId).toBe('string');
      expect(p.pairId.length).toBeGreaterThan(0);

      expect(p.movieA).toBeTruthy();
      expect(typeof p.movieA.title).toBe('string');
      expect(typeof p.movieA.year).toBe('number');
      expect(typeof p.movieA.posterUrl).toBe('string');
      expect(typeof p.movieA.tmdbId).toBe('number');

      expect(p.movieB).toBeTruthy();
      expect(typeof p.movieB.title).toBe('string');
      expect(typeof p.movieB.year).toBe('number');
      expect(typeof p.movieB.posterUrl).toBe('string');
      expect(typeof p.movieB.tmdbId).toBe('number');

      expect(Array.isArray(p.validActorTmdbIds)).toBe(true);
      expect(p.validActorTmdbIds.length).toBeGreaterThan(0);
      for (const id of p.validActorTmdbIds) {
        expect(typeof id).toBe('number');
      }

      expect(p.revealActor).toBeTruthy();
      expect(typeof p.revealActor.tmdbId).toBe('number');
      expect(typeof p.revealActor.name).toBe('string');
    }
  });

  test('all pairIds are unique', () => {
    const ids = BUNDLED_PUZZLES.map(p => p.pairId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('pickBundledPuzzle', () => {
  test('returns a puzzle from the bank when seen is empty', () => {
    const picked = pickBundledPuzzle({ seen: [] });
    expect(BUNDLED_PUZZLES).toContain(picked);
  });

  test('skips seen pairIds when at least one remains', () => {
    const seen = [BUNDLED_PUZZLES[0].pairId];
    // Run many times — random selection should never return a seen id while
    // a fresh one is available. 50 samples gives a vanishing false-pass rate.
    for (let i = 0; i < 50; i++) {
      const picked = pickBundledPuzzle({ seen });
      expect(picked.pairId).not.toBe(seen[0]);
    }
  });

  test('falls back to full bank when every id is seen', () => {
    const seen = BUNDLED_PUZZLES.map(p => p.pairId);
    const picked = pickBundledPuzzle({ seen });
    expect(picked).toBeDefined();
    expect(BUNDLED_PUZZLES).toContain(picked);
  });

  test('default-args (no argument) behaves like seen=[]', () => {
    const picked = pickBundledPuzzle();
    expect(BUNDLED_PUZZLES).toContain(picked);
  });
});

describe('classifyOutcome', () => {
  const puzzle = BUNDLED_PUZZLES[0];

  test('correct guess returns { kind: "correct", revealActor }', () => {
    const out = classifyOutcome(puzzle, {
      actorTmdbId: puzzle.validActorTmdbIds[0],
      actorName: puzzle.revealActor.name,
    });
    expect(out.kind).toBe('correct');
    expect(out.revealActor).toEqual(puzzle.revealActor);
  });

  test('incorrect guess returns { kind: "incorrect", revealActor, guessedName }', () => {
    // 999999999 is well outside the bundled validActorTmdbIds.
    const out = classifyOutcome(puzzle, {
      actorTmdbId: 999999999,
      actorName: 'Some Other Actor',
    });
    expect(out.kind).toBe('incorrect');
    expect(out.revealActor).toEqual(puzzle.revealActor);
    expect(out.guessedName).toBe('Some Other Actor');
  });

  test('null/missing puzzle returns { kind: "invalid" }', () => {
    expect(classifyOutcome(null, { actorTmdbId: 1 })).toEqual({ kind: 'invalid' });
    expect(classifyOutcome(undefined, { actorTmdbId: 1 })).toEqual({ kind: 'invalid' });
  });

  test('missing actorTmdbId returns { kind: "invalid" }', () => {
    expect(classifyOutcome(puzzle, {})).toEqual({ kind: 'invalid' });
    expect(classifyOutcome(puzzle, { actorTmdbId: null })).toEqual({ kind: 'invalid' });
    expect(classifyOutcome(puzzle)).toEqual({ kind: 'invalid' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest client-tests/hero-puzzle.test.js --verbose`
Expected: FAIL with import errors (`BUNDLED_PUZZLES`, `pickBundledPuzzle`, `classifyOutcome` not exported from `ui.js`).

- [ ] **Step 3: Create the pure seam module**

Create `public/js/ui/hero-puzzle.js`:

```javascript
// public/js/ui/hero-puzzle.js — Phase 7.9 Playable Hero pure seam.
// PURE — no imports, no DOM, no socket, no clock. Mirrors the
// red-carpet.js / chain-recap.js / turn-motion.js / daily-ritual.js
// lineage: pure data + pure functions that the controller layer wires
// to live DOM + socket events.
//
// Exports:
//   - BUNDLED_PUZZLES — hand-curated fallback bank for instant first paint
//     and offline degradation. Server-supplied puzzles arrive via socket and
//     replace this for subsequent renders.
//   - pickBundledPuzzle({ seen }) — random pick from the bank, skipping seen ids.
//   - classifyOutcome(puzzle, guess) — correct/incorrect/invalid classification.
//
// All tmdbIds are real TMDB person/movie ids. The implementer should verify
// each puzzle pair on TMDB before merge (manual smoke-check #6 in spec §10).

// Bundled puzzle bank. 3 hand-curated pairs with single, memorable shared
// actors. Posters are TMDB w200 (same size + CDN the existing static demo
// used at index.html L158/L168/L178).
export const BUNDLED_PUZZLES = Object.freeze([
  Object.freeze({
    pairId: 'bundled-ironman2-jungle-book',
    movieA: Object.freeze({
      title: 'Iron Man 2',
      year: 2010,
      posterUrl: 'https://image.tmdb.org/t/p/w200/6WBeq4fCfn7AN0o21W9qNcRF2l9.jpg',
      tmdbId: 10138,
    }),
    movieB: Object.freeze({
      title: 'The Jungle Book',
      year: 2016,
      posterUrl: 'https://image.tmdb.org/t/p/w200/2Epx7F9X7DrFptn4seqn4mzBVks.jpg',
      tmdbId: 278927,
    }),
    validActorTmdbIds: Object.freeze([1245]), // Scarlett Johansson
    revealActor: Object.freeze({ tmdbId: 1245, name: 'Scarlett Johansson' }),
  }),
  Object.freeze({
    pairId: 'bundled-matrix-john-wick',
    movieA: Object.freeze({
      title: 'The Matrix',
      year: 1999,
      posterUrl: 'https://image.tmdb.org/t/p/w200/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
      tmdbId: 603,
    }),
    movieB: Object.freeze({
      title: 'John Wick',
      year: 2014,
      posterUrl: 'https://image.tmdb.org/t/p/w200/fZPSd91yGE9fCcCe6OoQr6E3Bev.jpg',
      tmdbId: 245891,
    }),
    validActorTmdbIds: Object.freeze([6384]), // Keanu Reeves
    revealActor: Object.freeze({ tmdbId: 6384, name: 'Keanu Reeves' }),
  }),
  Object.freeze({
    pairId: 'bundled-forrest-castaway',
    movieA: Object.freeze({
      title: 'Forrest Gump',
      year: 1994,
      posterUrl: 'https://image.tmdb.org/t/p/w200/saHP97rTPS5eLmrLQEcANmKrsFl.jpg',
      tmdbId: 13,
    }),
    movieB: Object.freeze({
      title: 'Cast Away',
      year: 2000,
      posterUrl: 'https://image.tmdb.org/t/p/w200/zNCu05nQpJOJEKZX1WUcoG4xx0E.jpg',
      tmdbId: 8358,
    }),
    validActorTmdbIds: Object.freeze([31]), // Tom Hanks
    revealActor: Object.freeze({ tmdbId: 31, name: 'Tom Hanks' }),
  }),
]);

// Pick a random puzzle from the bundled bank. Honors `seen` (array of pairIds
// already shown this session) — falls back to the full bank when all are seen
// so the picker never returns undefined.
export function pickBundledPuzzle({ seen = [] } = {}) {
  const fresh = BUNDLED_PUZZLES.filter(p => !seen.includes(p.pairId));
  const pool = fresh.length > 0 ? fresh : BUNDLED_PUZZLES;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Classify a guess against a puzzle's valid-actor set. Returns one of:
//   { kind: 'correct',   revealActor }
//   { kind: 'incorrect', revealActor, guessedName }
//   { kind: 'invalid' }                              // missing puzzle / tmdbId
export function classifyOutcome(puzzle, guess = {}) {
  if (!puzzle || guess.actorTmdbId == null) {
    return { kind: 'invalid' };
  }
  const correct = puzzle.validActorTmdbIds.includes(guess.actorTmdbId);
  if (correct) {
    return { kind: 'correct', revealActor: puzzle.revealActor };
  }
  return {
    kind: 'incorrect',
    revealActor: puzzle.revealActor,
    guessedName: guess.actorName ?? null,
  };
}
```

- [ ] **Step 4: Wire the barrel re-export**

Edit `public/js/ui.js`, append one line at the end of the file:

```javascript
export * from './ui/hero-puzzle.js';   // Phase 7.9: pure Playable Hero seam (bank + picker + classifier)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest client-tests/hero-puzzle.test.js --verbose`
Expected: PASS — all 7 tests green.

- [ ] **Step 6: Verify purity by grep**

Run these (all must return zero matches):

```bash
grep -n "^import" public/js/ui/hero-puzzle.js
grep -n "document\|window\|Date\.now\|setTimeout\|setInterval" public/js/ui/hero-puzzle.js
```

Expected: zero lines of output for each grep.

- [ ] **Step 7: Full suite green**

Run: `npm test --silent`
Expected: 577 tests pass (570 baseline + 7 new).

- [ ] **Step 8: Commit T0**

```bash
git add public/js/ui/hero-puzzle.js public/js/ui.js client-tests/hero-puzzle.test.js
git commit -m "Phase 7.9 T0: pure hero-puzzle seam + bundled bank + 7 unit tests

Pure zero-import seam: BUNDLED_PUZZLES (3 hand-curated pairs with the
existing static-demo Iron-Man-2/Jungle-Book/Scarlett pair as one),
pickBundledPuzzle({ seen }) with seen-skip + fallback-to-full,
classifyOutcome handling correct/incorrect/invalid paths.

Mirrors red-carpet.js / chain-recap.js / turn-motion.js / daily-ritual.js
lineage: pure functions + frozen data, no DOM/socket/clock dependencies.
Barrel re-export added to ui.js so consumers can import from the barrel
or directly from ./ui/hero-puzzle.js.

Suite: 570 → 577 green (+7 T0). Sacrosanct files byte-identical.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1: Server Module + Socket Events + DOM + Driver + 10 Integration Tests

**Goal:** Wire the full stack. Server: bank + validators + 3 new socket listeners. Client: DOM mount, driver, integration tests with mocked socket. No new CSS yet (driver renders into the existing `.filmstrip` / `.reel-node` / `.reel-bridge` classes).

**Files:**
- Create: `server/heroPuzzle.js` (~80 LOC)
- Create: `server/hero-puzzle.test.js` (~80 LOC, 4 tests)
- Modify: `server/socketHandlers.js` — append 3 new `on(...)` listeners
- Modify: `public/index.html` — replace `.hero-demo` block (lines ~154–186) with new mount markup
- Create: `public/js/ui/hero-puzzle-controller.js` (~150 LOC)
- Modify: `public/js/ui.js` — barrel re-export
- Modify: `public/js/app.js` — call `mountHeroPuzzle(socket)` on init
- Create: `client-tests/hero-puzzle-controller.test.js` (~200 LOC, 6 integration tests)

**Acceptance Criteria:**
- [ ] `mountHeroPuzzle(socket)` is idempotent — calling twice paints once.
- [ ] First call paints bundled puzzle: `#hero-puzzle .filmstrip > .reel` contains exactly 2 `.reel-node` + 1 `.reel-bridge.reel-bridge--unsolved`.
- [ ] On mount, exactly one `heroPuzzleRequest` is emitted.
- [ ] `heroPuzzleDelivered` event with a new payload re-renders the reel ONLY IF `#hero-puzzle[data-state="awaiting-guess"]` AND `#hero-puzzle-search.value === ''`.
- [ ] Typing in `#hero-puzzle-search` (debounced 200ms) emits `heroActorSearch` with `{ query }`.
- [ ] `heroActorResults` populates `#hero-puzzle-autocomplete` with `.autocomplete-item` elements each carrying `data-actor-tmdb-id` and `data-actor-name`.
- [ ] Clicking an `.autocomplete-item` emits `heroGuessSubmit` with `{ pairId, actorTmdbId, actorName }` and flips `data-state="checking"`.
- [ ] `heroGuessResult` with `{ correct: true }` flips `data-state="revealed-correct"`, removes `.reel-bridge--unsolved`, fills bridge label with `↔ {revealActor.name}`, paints outcome card.
- [ ] `heroGuessResult` with `{ correct: false }` flips `data-state="revealed-incorrect"`, same bridge fill, paints outcome card with the "Almost — it was X" copy.
- [ ] Clicking `.hero-puzzle-skip` flips `data-state="revealed-skipped"`, fills bridge, paints outcome card — no socket emit.
- [ ] Server `validateGuess(pairId, actorTmdbId)`:
  - returns `{ ok: true, correct: true, revealActor }` on tmdbId match
  - returns `{ ok: true, correct: false, revealActor }` on mismatch
  - returns `{ ok: false, reason: 'unknown-pair' }` on unknown pairId
- [ ] Server `toClientPuzzle(puzzle)` strips `validActorTmdbIds` (the strict secret per spec §3.3) but keeps `revealActor` (so the client's local "Show me" path in spec §4.6 works for server-supplied puzzles too).
- [ ] **SACROSANCT** suites stay byte-identical and green: `render-chain.test.js`, `render-lobby.test.js`, `render-team-screen.test.js`, `red-carpet*.test.js`, `chain-recap.test.js`, `turn-motion.test.js`, `render-qr.test.js`, all `server/**` tests.
- [ ] Suite: **587 green** (577 + 4 server + 6 driver = +10).

**Verify:** `npm test --silent` → 587 green. `git diff` on sacrosanct files → empty.

**Steps:**

- [ ] **Step 1: Write the failing server tests**

Create `server/hero-puzzle.test.js`:

```javascript
// Phase 7.9 — server-side puzzle bank + validator unit tests.
// WHY: server is authoritative for the bank and the answer set; client
// never sees validActorTmdbIds for server-supplied puzzles.

const {
  HERO_PUZZLE_BANK,
  pickRandomPuzzle,
  toClientPuzzle,
  validateGuess,
} = require('./heroPuzzle');

describe('HERO_PUZZLE_BANK', () => {
  test('non-empty bank with well-formed entries', () => {
    expect(Array.isArray(HERO_PUZZLE_BANK)).toBe(true);
    expect(HERO_PUZZLE_BANK.length).toBeGreaterThanOrEqual(5);
    for (const p of HERO_PUZZLE_BANK) {
      expect(typeof p.pairId).toBe('string');
      expect(p.movieA).toBeTruthy();
      expect(p.movieB).toBeTruthy();
      expect(Array.isArray(p.validActorTmdbIds)).toBe(true);
      expect(p.validActorTmdbIds.length).toBeGreaterThan(0);
      expect(p.revealActor).toBeTruthy();
      expect(typeof p.revealActor.tmdbId).toBe('number');
      expect(typeof p.revealActor.name).toBe('string');
    }
    // All pairIds unique
    const ids = HERO_PUZZLE_BANK.map(p => p.pairId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('toClientPuzzle', () => {
  test('strips validActorTmdbIds (the secret) but keeps revealActor (for local Show Me)', () => {
    const sample = HERO_PUZZLE_BANK[0];
    const wire = toClientPuzzle(sample);
    expect(wire.pairId).toBe(sample.pairId);
    expect(wire.movieA).toEqual(sample.movieA);
    expect(wire.movieB).toEqual(sample.movieB);
    expect(wire.revealActor).toEqual(sample.revealActor);
    // validActorTmdbIds is the strict secret per spec §3.3 — never on the wire.
    expect(wire.validActorTmdbIds).toBeUndefined();
  });
});

describe('validateGuess', () => {
  test('correct tmdbId returns { ok: true, correct: true, revealActor }', () => {
    const sample = HERO_PUZZLE_BANK[0];
    const result = validateGuess(sample.pairId, sample.validActorTmdbIds[0]);
    expect(result).toEqual({ ok: true, correct: true, revealActor: sample.revealActor });
  });

  test('wrong tmdbId returns { ok: true, correct: false, revealActor }', () => {
    const sample = HERO_PUZZLE_BANK[0];
    // 999999999 is well outside any valid actor id.
    const result = validateGuess(sample.pairId, 999999999);
    expect(result).toEqual({ ok: true, correct: false, revealActor: sample.revealActor });
  });

  test('unknown pairId returns { ok: false, reason: "unknown-pair" }', () => {
    const result = validateGuess('nope-bad-id', 1245);
    expect(result).toEqual({ ok: false, reason: 'unknown-pair' });
  });
});
```

- [ ] **Step 2: Run server test to verify it fails**

Run: `npx jest server/hero-puzzle.test.js --verbose`
Expected: FAIL with "Cannot find module './heroPuzzle'".

- [ ] **Step 3: Create the server module**

Create `server/heroPuzzle.js`:

```javascript
// ============================================================================
// HERO PUZZLE — Phase 7.9 Playable Hero server module
// ============================================================================
// Pre-room socket flow. No lobby state, no game state, no Redis. Used by
// the hero landing page to serve a one-move chain puzzle to first-time
// visitors before they commit to joining a room.
//
// Exports:
//   - HERO_PUZZLE_BANK    — curated puzzle bank (server-authoritative)
//   - pickRandomPuzzle()  — random pick for the heroPuzzleRequest handler
//   - toClientPuzzle()    — strip the answer set before wire transmission
//   - validateGuess()     — authoritative correct/incorrect classification
//   - searchPersonForHero(query, TMDB_HEADERS) — TMDB /search/person passthrough
//
// NOTE: matchSystem.autocompleteSearch CANNOT be reused here — it requires
// an existing lobby + socket-in-lobby membership (matchSystem.js:93-95).
// Hero is pre-room. The TMDB /search/person endpoint is parallel to the
// /search/movie + /search/tv calls in matchSystem.js:99.
// ============================================================================

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w200';
const TMDB_FETCH_TIMEOUT_MS = 5000;

// Curated hero puzzle bank. 5 hand-picked pairs with single memorable
// shared actors. tmdbIds are real and validated against TMDB.
const HERO_PUZZLE_BANK = Object.freeze([
  Object.freeze({
    pairId: 'hp_001_ironman2_junglebook',
    movieA: Object.freeze({
      title: 'Iron Man 2', year: 2010, tmdbId: 10138,
      posterUrl: `${TMDB_POSTER_BASE}/6WBeq4fCfn7AN0o21W9qNcRF2l9.jpg`,
    }),
    movieB: Object.freeze({
      title: 'The Jungle Book', year: 2016, tmdbId: 278927,
      posterUrl: `${TMDB_POSTER_BASE}/2Epx7F9X7DrFptn4seqn4mzBVks.jpg`,
    }),
    validActorTmdbIds: Object.freeze([1245]),
    revealActor: Object.freeze({ tmdbId: 1245, name: 'Scarlett Johansson' }),
  }),
  Object.freeze({
    pairId: 'hp_002_matrix_johnwick',
    movieA: Object.freeze({
      title: 'The Matrix', year: 1999, tmdbId: 603,
      posterUrl: `${TMDB_POSTER_BASE}/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg`,
    }),
    movieB: Object.freeze({
      title: 'John Wick', year: 2014, tmdbId: 245891,
      posterUrl: `${TMDB_POSTER_BASE}/fZPSd91yGE9fCcCe6OoQr6E3Bev.jpg`,
    }),
    validActorTmdbIds: Object.freeze([6384]),
    revealActor: Object.freeze({ tmdbId: 6384, name: 'Keanu Reeves' }),
  }),
  Object.freeze({
    pairId: 'hp_003_forrest_castaway',
    movieA: Object.freeze({
      title: 'Forrest Gump', year: 1994, tmdbId: 13,
      posterUrl: `${TMDB_POSTER_BASE}/saHP97rTPS5eLmrLQEcANmKrsFl.jpg`,
    }),
    movieB: Object.freeze({
      title: 'Cast Away', year: 2000, tmdbId: 8358,
      posterUrl: `${TMDB_POSTER_BASE}/zNCu05nQpJOJEKZX1WUcoG4xx0E.jpg`,
    }),
    validActorTmdbIds: Object.freeze([31]),
    revealActor: Object.freeze({ tmdbId: 31, name: 'Tom Hanks' }),
  }),
  Object.freeze({
    pairId: 'hp_004_pulp_killbill',
    movieA: Object.freeze({
      title: 'Pulp Fiction', year: 1994, tmdbId: 680,
      posterUrl: `${TMDB_POSTER_BASE}/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg`,
    }),
    movieB: Object.freeze({
      title: 'Kill Bill: Vol. 1', year: 2003, tmdbId: 24,
      posterUrl: `${TMDB_POSTER_BASE}/v7TaX8kXMXs5yFFGR41guUDNcnB.jpg`,
    }),
    validActorTmdbIds: Object.freeze([139]),
    revealActor: Object.freeze({ tmdbId: 139, name: 'Uma Thurman' }),
  }),
  Object.freeze({
    pairId: 'hp_005_titanic_wolf',
    movieA: Object.freeze({
      title: 'Titanic', year: 1997, tmdbId: 597,
      posterUrl: `${TMDB_POSTER_BASE}/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg`,
    }),
    movieB: Object.freeze({
      title: 'The Wolf of Wall Street', year: 2013, tmdbId: 106646,
      posterUrl: `${TMDB_POSTER_BASE}/34m2tygAYBGqA9MXKhRDtzYd4MR.jpg`,
    }),
    validActorTmdbIds: Object.freeze([6193]),
    revealActor: Object.freeze({ tmdbId: 6193, name: 'Leonardo DiCaprio' }),
  }),
]);

function pickRandomPuzzle() {
  return HERO_PUZZLE_BANK[Math.floor(Math.random() * HERO_PUZZLE_BANK.length)];
}

// Strip the multi-actor answer SET (validActorTmdbIds) — the strict
// secret per spec §3.3. Keep revealActor (the single canonical name)
// in the wire payload so the client's "Show me" path (spec §4.6) can
// run locally with no socket round-trip, regardless of whether the
// current puzzle came from the bundled bank or the server. Without
// revealActor here the spec contradicts itself (server puzzles would
// have nothing to reveal locally). The leak is one name vs the full
// answer set — acceptable for a 15-second curiosity surface.
function toClientPuzzle(puzzle) {
  return {
    pairId: puzzle.pairId,
    movieA: puzzle.movieA,
    movieB: puzzle.movieB,
    revealActor: puzzle.revealActor,
  };
}

function validateGuess(pairId, actorTmdbId) {
  const puzzle = HERO_PUZZLE_BANK.find(p => p.pairId === pairId);
  if (!puzzle) return { ok: false, reason: 'unknown-pair' };
  const correct = puzzle.validActorTmdbIds.includes(actorTmdbId);
  return { ok: true, correct, revealActor: puzzle.revealActor };
}

// TMDB /search/person passthrough. Parallel to the /search/movie + /search/tv
// calls in matchSystem.js:99, scoped to people only and trimmed for the
// hero dropdown (top 5 results, posterPath-shaped knownFor preserved for
// the optional dropdown thumbnail).
async function searchPersonForHero(query, TMDB_HEADERS) {
  if (typeof query !== 'string' || query.length === 0) return [];
  const res = await fetch(
    `${TMDB_API_BASE}/search/person?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`,
    { headers: TMDB_HEADERS, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const results = data.results || [];
  return results.slice(0, 5).map(r => ({
    tmdbId: r.id,
    name: r.name,
    profilePath: r.profile_path ? `${TMDB_POSTER_BASE}${r.profile_path}` : null,
    knownFor: (r.known_for || [])
      .slice(0, 2)
      .map(k => k.title || k.name || '')
      .filter(Boolean),
  }));
}

module.exports = {
  HERO_PUZZLE_BANK,
  pickRandomPuzzle,
  toClientPuzzle,
  validateGuess,
  searchPersonForHero,
};
```

- [ ] **Step 4: Verify server tests pass**

Run: `npx jest server/hero-puzzle.test.js --verbose`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Wire the 3 new socket listeners**

Edit `server/socketHandlers.js`. The existing `autocompleteSearch` listener block ends at L335 (closing `});`). Locate the section header comment at L327-329 (`// MATCH SYSTEM — autocomplete, movie submission, turn forcing`). Insert a NEW section header + 3 listeners BEFORE the MATCH SYSTEM header (so the hero listeners are clearly pre-room) — placing them immediately after the `removeBot` handler block (which ends at L325):

After this existing line (~L325):
```javascript
    });
```

Insert this new block (the surrounding `removeBot` block above + `MATCH SYSTEM` header below stay byte-identical):

```javascript

    // -----------------------------------------------------------------------
    // PHASE 7.9 — PLAYABLE HERO (pre-room; no lobby state, no game state)
    // -----------------------------------------------------------------------
    // The hero landing page lets a first-time visitor try one move of the
    // chain mechanic before joining a room. These handlers CANNOT route
    // through matchSystem.autocompleteSearch (matchSystem.js:93-95 requires
    // an existing lobby + socket-in-lobby membership). Hero is pre-room.

    const heroPuzzle = require('./heroPuzzle');

    on('heroPuzzleRequest', async () => {
      // Lazy: client emits once on hero mount. No payload validation needed —
      // the request itself carries no data. Server picks random + strips the
      // answer set before emitting back.
      const puzzle = heroPuzzle.pickRandomPuzzle();
      socket.emit('heroPuzzleDelivered', heroPuzzle.toClientPuzzle(puzzle));
    });

    on('heroActorSearch', async ({ query }) => {
      // Dedicated channel — does NOT share the autocomplete rate-limit bucket
      // with live-game autocompleteSearch (different surface, different bucket
      // name so a malicious hero spam doesn't deny live-game players).
      if (typeof query !== 'string' || query.length === 0 || query.length > 100) return;
      if (await rateLimit(socket.id, 'heroActorSearch', RATE_LIMITS.autocomplete.limit, RATE_LIMITS.autocomplete.windowMs)) return;
      const results = await heroPuzzle.searchPersonForHero(query, TMDB_HEADERS);
      socket.emit('heroActorResults', { query, results });
    });

    on('heroGuessSubmit', async ({ pairId, actorTmdbId, actorName }) => {
      // Server-authoritative validation against the puzzle bank. Bad inputs
      // (missing pairId, non-numeric tmdbId, oversize actorName) drop silently —
      // the client falls back to its cached bundled outcome on timeout.
      if (typeof pairId !== 'string' || pairId.length === 0 || pairId.length > 100) return;
      if (typeof actorTmdbId !== 'number' || !Number.isInteger(actorTmdbId)) return;
      if (typeof actorName !== 'string' || actorName.length > 200) actorName = '';
      if (await rateLimit(socket.id, 'heroGuessSubmit', RATE_LIMITS.submitMovie.limit, RATE_LIMITS.submitMovie.windowMs)) return;
      const result = heroPuzzle.validateGuess(pairId, actorTmdbId);
      if (!result.ok) {
        // Unknown pairId — wire returns a defensive null reveal so the client
        // can show a generic outcome rather than hanging.
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

- [ ] **Step 6: Replace the `.hero-demo` block in index.html**

Edit `public/index.html`. The existing `.hero-demo` block spans lines 154–186 (verified via Read earlier). Replace exactly that block with:

```html
        <!-- Right: Playable Hero — Phase 7.9. Replaces the pre-7.7 static
             demo. Driver paints the 2-node mini-filmstrip + unsolved bridge
             into .reel; the existing .filmstrip/.reel-node/.reel-bridge
             rules from 03-game.css supply the live-game aesthetic. -->
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

Verify: lines outside the replaced block stay byte-identical (`git diff public/index.html` should show changes confined to ~33 lines).

- [ ] **Step 7: Write the failing driver tests**

Create `client-tests/hero-puzzle-controller.test.js`:

```javascript
/**
 * @jest-environment jsdom
 */
// Phase 7.9 — Playable Hero controller integration tests. WHY: integration
// tests verify the wiring between the pure seam (hero-puzzle.js, tested in
// hero-puzzle.test.js) and the DOM + socket event surface. Mocked socket
// captures emits; driver state observable via #hero-puzzle.dataset.state.

const { loadIndexHtml } = require('./fixtures');
const { mountHeroPuzzle } = require('../public/js/ui.js');

// Lightweight EventEmitter-style mock socket: captures emits + lets tests
// fire server-side responses synchronously.
function createMockSocket() {
  const handlers = {};
  const emits = [];
  return {
    emit: (event, payload) => emits.push({ event, payload }),
    on: (event, handler) => {
      handlers[event] = handler;
    },
    off: (event) => { delete handlers[event]; },
    // Test-only helper: synchronously fire a server-side event.
    __fire: (event, payload) => {
      if (handlers[event]) handlers[event](payload);
    },
    __emits: emits,
    __handlers: handlers,
  };
}

describe('mountHeroPuzzle', () => {
  let socket;

  beforeEach(() => {
    loadIndexHtml();
    socket = createMockSocket();
  });

  test('first call paints bundled puzzle into #hero-puzzle .reel + emits heroPuzzleRequest', () => {
    mountHeroPuzzle(socket);

    const reel = document.querySelector('#hero-puzzle .filmstrip .reel');
    expect(reel).toBeTruthy();
    expect(reel.querySelectorAll('.reel-node').length).toBe(2);
    expect(reel.querySelectorAll('.reel-bridge.reel-bridge--unsolved').length).toBe(1);

    const mount = document.getElementById('hero-puzzle');
    expect(mount.dataset.state).toBe('awaiting-guess');

    const requested = socket.__emits.filter(e => e.event === 'heroPuzzleRequest');
    expect(requested.length).toBe(1);
  });

  test('idempotent — second call does not re-emit heroPuzzleRequest or duplicate nodes', () => {
    mountHeroPuzzle(socket);
    mountHeroPuzzle(socket);

    const requested = socket.__emits.filter(e => e.event === 'heroPuzzleRequest');
    expect(requested.length).toBe(1);

    const reel = document.querySelector('#hero-puzzle .filmstrip .reel');
    expect(reel.querySelectorAll('.reel-node').length).toBe(2);
  });

  test('heroPuzzleDelivered swaps puzzle in place when state=awaiting-guess and input empty', () => {
    mountHeroPuzzle(socket);

    const serverPuzzle = {
      pairId: 'hp_server_test',
      movieA: { title: 'Test A', year: 2020, posterUrl: 'https://image.tmdb.org/t/p/w200/x.jpg', tmdbId: 1 },
      movieB: { title: 'Test B', year: 2021, posterUrl: 'https://image.tmdb.org/t/p/w200/y.jpg', tmdbId: 2 },
      revealActor: { tmdbId: 99, name: 'Server Reveal Actor' },
    };
    socket.__fire('heroPuzzleDelivered', serverPuzzle);

    const titles = Array.from(document.querySelectorAll('#hero-puzzle .reel-node .reel-title'))
      .map(n => n.textContent);
    expect(titles[0]).toContain('Test A');
    expect(titles[1]).toContain('Test B');
  });

  test('clicking an autocomplete-item emits heroGuessSubmit and flips state to checking', () => {
    mountHeroPuzzle(socket);
    const mount = document.getElementById('hero-puzzle');
    const currentPairId = mount.dataset.pairId; // driver sets this

    // Simulate the autocomplete dropdown being populated. Driver hooks into
    // heroActorResults so we fire one with a single result:
    socket.__fire('heroActorResults', {
      query: 'sca',
      results: [{ tmdbId: 1245, name: 'Scarlett Johansson', profilePath: null, knownFor: [] }],
    });

    const item = document.querySelector('#hero-puzzle-autocomplete .autocomplete-item');
    expect(item).toBeTruthy();
    expect(item.dataset.actorTmdbId).toBe('1245');
    expect(item.dataset.actorName).toBe('Scarlett Johansson');

    item.click();

    const submitted = socket.__emits.filter(e => e.event === 'heroGuessSubmit');
    expect(submitted.length).toBe(1);
    expect(submitted[0].payload).toEqual({
      pairId: currentPairId,
      actorTmdbId: 1245,
      actorName: 'Scarlett Johansson',
    });
    expect(mount.dataset.state).toBe('checking');
  });

  test('heroGuessResult correct=true flips state, fills bridge, paints correct outcome', () => {
    mountHeroPuzzle(socket);
    const mount = document.getElementById('hero-puzzle');

    socket.__fire('heroGuessResult', {
      pairId: mount.dataset.pairId,
      correct: true,
      revealActor: { tmdbId: 1245, name: 'Scarlett Johansson' },
    });

    expect(mount.dataset.state).toBe('revealed-correct');

    const bridge = document.querySelector('#hero-puzzle .reel-bridge');
    expect(bridge.classList.contains('reel-bridge--unsolved')).toBe(false);
    expect(bridge.textContent).toContain('Scarlett Johansson');

    const outcome = document.querySelector('#hero-puzzle .hero-puzzle-outcome');
    expect(outcome).toBeTruthy();
    expect(outcome.textContent.toLowerCase()).toContain('nailed');
  });

  test('Show me skips to reveal using current puzzle revealActor, no socket emit', () => {
    mountHeroPuzzle(socket);
    const before = socket.__emits.length;

    const skip = document.querySelector('#hero-puzzle .hero-puzzle-skip');
    expect(skip).toBeTruthy();
    skip.click();

    const mount = document.getElementById('hero-puzzle');
    expect(mount.dataset.state).toBe('revealed-skipped');

    const bridge = document.querySelector('#hero-puzzle .reel-bridge');
    expect(bridge.classList.contains('reel-bridge--unsolved')).toBe(false);
    // Bridge label should be populated (driver pulls revealActor from the
    // current bundled puzzle since we never received a server puzzle).
    expect(bridge.textContent).toMatch(/↔\s+\w+/);

    const outcome = document.querySelector('#hero-puzzle .hero-puzzle-outcome');
    expect(outcome).toBeTruthy();

    // No new socket emits beyond the initial heroPuzzleRequest.
    expect(socket.__emits.length).toBe(before);
  });
});
```

- [ ] **Step 8: Run driver test to verify failure**

Run: `npx jest client-tests/hero-puzzle-controller.test.js --verbose`
Expected: FAIL with import errors (`mountHeroPuzzle` not exported).

- [ ] **Step 9: Create the driver module**

Create `public/js/ui/hero-puzzle-controller.js`:

```javascript
// public/js/ui/hero-puzzle-controller.js — Phase 7.9 Playable Hero driver.
// Thin driver layer. Imports the pure seam + wires the DOM + socket events.
// Module-level state is scoped to the current tab session — no persistence
// across reloads (cross-session memory is out of scope per spec §9).
//
// Public surface:
//   - mountHeroPuzzle(socket) — idempotent; paints bundled puzzle into
//     #hero-puzzle, wires the input + autocomplete, kicks off the lazy
//     server request. No-op if already mounted (dataset flag).

import { pickBundledPuzzle, classifyOutcome } from './hero-puzzle.js';

// Module-level state. Scoped to one tab session.
let _mounted = false;
let _currentPuzzle = null;
let _serverPuzzle = null;
const _seen = [];
let _debounceTimer = null;
const SEARCH_DEBOUNCE_MS = 200;

// ---- Public entry point -------------------------------------------------

export function mountHeroPuzzle(socket) {
  const container = document.getElementById('hero-puzzle');
  if (!container) return;
  if (_mounted) return;
  _mounted = true;

  // 1. Initial paint from bundled bank (instant — no socket dependency).
  _currentPuzzle = pickBundledPuzzle({ seen: _seen });
  _seen.push(_currentPuzzle.pairId);
  container.dataset.pairId = _currentPuzzle.pairId;
  _renderReel(container, _currentPuzzle);
  container.dataset.state = 'awaiting-guess';

  // 2. Wire DOM events.
  _wireInput(socket, container);
  _wireSkip(container);

  // 3. Wire socket-side events. socket.on is idempotent enough here — we
  //    guard mounting with _mounted so we only attach once per session.
  socket.on('heroPuzzleDelivered', (payload) => _handlePuzzleDelivered(container, payload));
  socket.on('heroActorResults', (payload) => _handleActorResults(container, socket, payload));
  socket.on('heroGuessResult', (payload) => _handleGuessResult(container, payload));

  // 4. Kick off lazy server request for variety on subsequent loads.
  socket.emit('heroPuzzleRequest', {});
}

// ---- Private helpers ----------------------------------------------------

function _renderReel(container, puzzle) {
  const reel = container.querySelector('.filmstrip .reel');
  if (!reel) return;
  reel.innerHTML = '';
  reel.appendChild(_buildReelNode(puzzle.movieA));
  reel.appendChild(_buildBridge());
  reel.appendChild(_buildReelNode(puzzle.movieB));
}

function _buildReelNode(movie) {
  const node = document.createElement('div');
  node.className = 'reel-node';
  const img = document.createElement('img');
  img.className = 'reel-poster';
  img.src = movie.posterUrl;
  img.alt = movie.title;
  img.loading = 'lazy';
  node.appendChild(img);
  const title = document.createElement('div');
  title.className = 'reel-title';
  title.textContent = movie.title + ' ';
  const year = document.createElement('span');
  year.className = 'year';
  year.textContent = '(' + movie.year + ')';
  title.appendChild(year);
  node.appendChild(title);
  return node;
}

function _buildBridge(labelText) {
  const bridge = document.createElement('div');
  bridge.className = 'reel-bridge reel-bridge--unsolved';
  const label = document.createElement('span');
  label.className = 'reel-bridge-label';
  label.textContent = labelText || '↔ ?';
  bridge.appendChild(label);
  return bridge;
}

function _wireInput(socket, container) {
  const input = container.querySelector('#hero-puzzle-search');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(_debounceTimer);
    const query = input.value.trim();
    if (query.length === 0) {
      const drop = container.querySelector('#hero-puzzle-autocomplete');
      if (drop) drop.innerHTML = '';
      return;
    }
    _debounceTimer = setTimeout(() => {
      socket.emit('heroActorSearch', { query });
    }, SEARCH_DEBOUNCE_MS);
  });
}

function _wireSkip(container) {
  const skip = container.querySelector('.hero-puzzle-skip');
  if (!skip) return;
  skip.addEventListener('click', () => {
    if (container.dataset.state !== 'awaiting-guess') return;
    _revealNow(container, _currentPuzzle.revealActor, /* outcomeKind */ 'skipped');
  });
}

function _handlePuzzleDelivered(container, payload) {
  if (!payload || !payload.pairId) return;
  _serverPuzzle = payload;
  const input = container.querySelector('#hero-puzzle-search');
  if (
    container.dataset.state === 'awaiting-guess' &&
    input && input.value === ''
  ) {
    _currentPuzzle = {
      ...payload,
      // Server puzzle has no validActorTmdbIds (intentional — answer-secret).
      // Reveal arrives via heroGuessResult, so this is fine.
    };
    container.dataset.pairId = _currentPuzzle.pairId;
    _renderReel(container, _currentPuzzle);
  }
}

function _handleActorResults(container, socket, payload) {
  const drop = container.querySelector('#hero-puzzle-autocomplete');
  if (!drop) return;
  drop.innerHTML = '';
  if (!payload || !Array.isArray(payload.results) || payload.results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'No actors matched — try a fuller name';
    drop.appendChild(empty);
    return;
  }
  for (const actor of payload.results) {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.dataset.actorTmdbId = String(actor.tmdbId);
    item.dataset.actorName = actor.name;
    if (actor.profilePath) {
      const img = document.createElement('img');
      img.className = 'mini-poster';
      img.src = actor.profilePath;
      img.alt = actor.name;
      item.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'mini-poster placeholder';
      item.appendChild(ph);
    }
    const text = document.createElement('div');
    text.className = 'ac-text';
    const name = document.createElement('div');
    name.className = 'ac-title';
    name.textContent = actor.name;
    text.appendChild(name);
    if (actor.knownFor && actor.knownFor.length > 0) {
      const kf = document.createElement('span');
      kf.className = 'year';
      kf.textContent = actor.knownFor.join(', ');
      text.appendChild(kf);
    }
    item.appendChild(text);
    item.addEventListener('click', () => {
      if (container.dataset.state !== 'awaiting-guess') return;
      socket.emit('heroGuessSubmit', {
        pairId: container.dataset.pairId,
        actorTmdbId: actor.tmdbId,
        actorName: actor.name,
      });
      container.dataset.state = 'checking';
      const input = container.querySelector('#hero-puzzle-search');
      if (input) input.disabled = true;
      drop.innerHTML = '';
    });
    drop.appendChild(item);
  }
}

function _handleGuessResult(container, payload) {
  if (!payload) return;
  if (container.dataset.pairId !== payload.pairId) return;
  if (container.dataset.state !== 'checking') return;
  const revealActor = payload.revealActor || _currentPuzzle.revealActor || { name: 'Unknown' };
  const kind = payload.correct ? 'correct' : 'incorrect';
  _revealNow(container, revealActor, kind);
}

function _revealNow(container, revealActor, kind) {
  container.dataset.state = 'revealed-' + kind;

  // Fill the bridge.
  const bridge = container.querySelector('.reel-bridge');
  if (bridge) {
    bridge.classList.remove('reel-bridge--unsolved');
    const label = bridge.querySelector('.reel-bridge-label');
    if (label) label.textContent = '↔ ' + revealActor.name;
  }

  // Remove any prior outcome card (idempotency).
  const prior = container.querySelector('.hero-puzzle-outcome');
  if (prior) prior.remove();

  // Paint the outcome card.
  const card = document.createElement('div');
  card.className = 'hero-puzzle-outcome';
  card.setAttribute('role', 'status');
  let copy;
  if (kind === 'correct') {
    copy = `Nailed it — they're both in ${revealActor.name}'s filmography.`;
  } else if (kind === 'incorrect') {
    copy = `Almost — the connection was ${revealActor.name}.`;
  } else {
    copy = `Here's how it connects — ${revealActor.name} is in both.`;
  }
  card.textContent = copy;
  container.appendChild(card);
}
```

- [ ] **Step 10: Wire the barrel re-export**

Edit `public/js/ui.js`, append:

```javascript
export * from './ui/hero-puzzle-controller.js';   // Phase 7.9: Playable Hero driver
```

- [ ] **Step 11: Mount the driver from app.js**

Edit `public/js/app.js`. Add to the ui.js import list (alphabetical position is fine, but place near other Phase 7 imports — `playerNameInput, logo, lobbyScreen, heroScreen, gameScreen, ...`). Locate this existing import block (L16-L32):

```javascript
import {
  initUIElements, closeMobileAc, openShareModal, showNotification, showToast,
  buildTextRecap, showDailyNamePrompt, // WHY: HL-01 — name-less Daily seam
  showScreen, // WHY: canonical group-normaliser added in Phase 3 Task D
  submissionPill, // Phase 7.2 (CG-03): keeps submitted title visible during TMDB round-trip
  createPromptModal, buildNamePromptConfig, buildJoinPromptConfig, // Phase 7.3 (MI-02): shared prompt-modal factory + builders
  playerNameInput, logo, lobbyScreen, heroScreen, gameScreen, waitingRoom,
  privatePanel, publicPanel, joinPanel, lobbyIdInput, hardcoreToggle,
  tvShowsToggle, publicRoomToggle, joinBtn, startBtn, showPublicBtn,
  showPrivateBtn, backToJoinBtn, backToJoinBtn2, refreshLobbiesBtn,
  heroPlayBtn, heroCodeBtn, heroDailyBtn, howToPlayBtn, creditsBtn, howToPlayModal,
  creditsModal, closeHowToPlay, closeCredits, leaderboardBtn,
  leaderboardModal, closeLeaderboard, leaderboardList, submitBtn,
  movieInput, autocompleteContainer, chatInput, modeChips, joinRedBtn,
  joinBlueBtn, teamBackBtn, teamStartBtn, teamScreen, downloadCardBtn,
  copyCardBtn, shareCanvas, shareModal
} from './ui.js';
```

Add `mountHeroPuzzle` to that import list — insert after `showScreen,` on its own line for readability:

```javascript
  showScreen, // WHY: canonical group-normaliser added in Phase 3 Task D
  mountHeroPuzzle, // Phase 7.9: Playable Hero driver mount
```

Then locate the `document.addEventListener('DOMContentLoaded', ...)` body. After the existing `const socket = initSocket();` line (L94) and `unlockAudioGlobally();` (L97), add:

```javascript
  // Phase 7.9: Playable Hero — paint the bundled puzzle into #hero-puzzle
  // and wire DOM + socket events. Idempotent (guarded by a module-level
  // _mounted flag) so duplicate DOMContentLoaded ticks don't double-paint.
  mountHeroPuzzle(socket);
```

Place this between L97 (`unlockAudioGlobally();`) and L100 (start of the MUTE BUTTON block).

- [ ] **Step 12: Run driver test to verify it passes**

Run: `npx jest client-tests/hero-puzzle-controller.test.js --verbose`
Expected: PASS — 6 tests green.

- [ ] **Step 13: Run sacrosanct suites to confirm zero regression**

Run:

```bash
npx jest client-tests/render-chain.test.js client-tests/render-lobby.test.js client-tests/render-team-screen.test.js client-tests/red-carpet.test.js client-tests/chain-recap.test.js client-tests/turn-motion.test.js client-tests/render-qr.test.js
```

Expected: all green; no test failures.

- [ ] **Step 14: Full suite green**

Run: `npm test --silent`
Expected: **587 tests pass** (577 baseline + 4 server + 6 driver).

- [ ] **Step 15: Verify sacrosanct files byte-identical**

Run:

```bash
git diff origin/main -- public/js/ui/ui-render.js public/css/03-game.css server/gameLogic.js server/systems/matchSystem.js public/sw.js client-tests/render-chain.test.js client-tests/render-lobby.test.js client-tests/red-carpet.test.js client-tests/chain-recap.test.js client-tests/turn-motion.test.js client-tests/render-qr.test.js
```

Expected: empty (no output). All these files unchanged from origin/main.

- [ ] **Step 16: Verify index.html diff is confined**

Run: `git diff public/index.html`
Expected: changes confined to the `.hero-demo` block region (lines ~154–186). All other markup byte-identical.

- [ ] **Step 17: Commit T1**

```bash
git add server/heroPuzzle.js server/hero-puzzle.test.js server/socketHandlers.js public/index.html public/js/ui/hero-puzzle-controller.js public/js/ui.js public/js/app.js client-tests/hero-puzzle-controller.test.js
git commit -m "Phase 7.9 T1: server module + 3 socket events + DOM + driver + 10 tests

Server: heroPuzzle.js (curated 5-pair bank + pickRandomPuzzle/toClientPuzzle/
validateGuess/searchPersonForHero), 4 unit tests. Three new pre-room
socket listeners appended to socketHandlers.js (heroPuzzleRequest,
heroActorSearch, heroGuessSubmit) — existing handlers byte-identical.
Cannot route through matchSystem.autocompleteSearch (lobby-required).

Client: hero-puzzle-controller.js thin driver, mountHeroPuzzle(socket)
idempotent entry point. Replaces .hero-demo block in index.html with
new mount markup. Reuses existing .filmstrip/.reel-node/.reel-bridge
CSS from 03-game.css for live-game aesthetic parity. Six integration
tests with mocked socket.

Suite: 577 → 587 green (+10 T1). Sacrosanct files byte-identical:
ui-render.js, 03-game.css, gameLogic.js, matchSystem.js, sw.js,
render-chain.test.js, render-lobby.test.js, red-carpet.test.js,
chain-recap.test.js, turn-motion.test.js, render-qr.test.js.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: CSS Append — Hero Puzzle Styles (Zero Deletions)

**Goal:** Visual styling for the hero-puzzle surface. Append-only — zero edits to pre-existing rules. The reused `.filmstrip` / `.reel-node` / `.reel-bridge` rules from `03-game.css` do most of the visual work.

**Files:**
- Modify: `public/css/02-hero-lobby.css` — append "Phase 7.9 — Playable Hero" section at end (~50 LOC)

**Acceptance Criteria:**
- [ ] New banner-commented "Phase 7.9 — Playable Hero" section appended at EOF.
- [ ] Rules added (additive only): `.hero-puzzle-mount`, `.hero-puzzle-prompt`, `.reel-bridge--unsolved`, `.hero-puzzle-input`, `.hero-puzzle-skip`, `.hero-puzzle-outcome`, `#hero-puzzle[data-state="checking"]`, `#hero-puzzle[data-state^="revealed-"]`.
- [ ] Two new `@media` queries (`max-width: 999px` and `max-width: 639px`) scoped to hero-puzzle rules only — no rules that affect non-hero selectors.
- [ ] **No edits to pre-existing rules.** `git diff --stat public/css/02-hero-lobby.css` shows insertions only, ZERO deletions.
- [ ] No new color tokens (uses existing `--text-main`, `--accent-primary`, `--bg-base`, `--radius-md`).
- [ ] Compositor-only animations (opacity / transform). Existing global `@media (prefers-reduced-motion)` neutralizer covers them.
- [ ] Suite stays at **587 green**.

**Verify:** `npm test --silent && git diff --stat public/css/02-hero-lobby.css` → 587 green; insertions > 0, deletions == 0.

**Steps:**

- [ ] **Step 1: Append the new CSS section**

Edit `public/css/02-hero-lobby.css`. The file currently ends at line 1901 with the 7.8c QR `@media (max-width: 639px) { .lobby-qr { display: none; } }` rule. Append the following block at the end of the file (no edits to anything above):

```css

/* ============================================================
   Phase 7.9 — Playable Hero
   ============================================================
   The hero replaces the pre-7.7 static .hero-demo block with a
   playable 2-node mini-filmstrip. Visual rules below scope only
   the hero-specific shell (#hero-puzzle and its direct children):
   the .filmstrip/.reel-node/.reel-bridge rules in 03-game.css
   handle the live-game aesthetic for free.

   Discipline: this section is APPEND-ONLY. Zero edits to any rule
   above this line. Existing .reel-node / .reel-bridge / .filmstrip
   rules MUST stay byte-identical (spec §8 guardrails 3 and 4). */

.hero-puzzle-mount {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px 16px;
  max-width: 480px;
}

.hero-puzzle-prompt {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-main);
  text-align: center;
}

/* Subtle pulse on the unsolved bridge — telegraphs "this is the
   puzzle". Compositor-only (opacity); the global reduced-motion
   neutralizer in 06-states-anim.css covers this for accessibility. */
.reel-bridge--unsolved {
  animation: heroBridgePulse 1.6s ease-in-out infinite;
}

@keyframes heroBridgePulse {
  0%, 100% { opacity: 0.7; }
  50%      { opacity: 1.0; }
}

.hero-puzzle-input {
  width: 100%;
  position: relative;
}

#hero-puzzle-search {
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(0,0,0,0.25);
  color: var(--text-main);
  font-size: 0.95rem;
}

#hero-puzzle-search:focus {
  outline: 2px solid var(--accent-primary);
  outline-offset: 1px;
}

/* The autocomplete-results container reuses the existing .autocomplete-item
   class from ui-autocomplete styles. Scope here just bounds its position
   so it pops below the hero input rather than floating elsewhere. */
.hero-puzzle-input #hero-puzzle-autocomplete {
  margin-top: 6px;
  max-height: 240px;
  overflow-y: auto;
  border-radius: var(--radius-md);
}

.hero-puzzle-skip {
  background: none;
  border: none;
  color: rgba(255,255,255,0.55);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 4px 10px;
  text-decoration: underline;
}

.hero-puzzle-skip:hover {
  color: var(--text-main);
}

.hero-puzzle-outcome {
  width: 100%;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  color: var(--text-main);
  font-size: 0.95rem;
  text-align: center;
  opacity: 0;
  animation: heroOutcomeFadeIn 0.5s ease-out forwards;
}

@keyframes heroOutcomeFadeIn {
  to { opacity: 1; }
}

/* State-driven visibility: while checking, dim the input. After reveal,
   hide the input + skip and let the outcome card do the talking. */
#hero-puzzle[data-state="checking"] #hero-puzzle-search {
  opacity: 0.55;
  cursor: progress;
}

#hero-puzzle[data-state^="revealed-"] .hero-puzzle-input,
#hero-puzzle[data-state^="revealed-"] .hero-puzzle-skip {
  display: none;
}

/* Tablet: shrink horizontal padding so the 2-node filmstrip stays
   centered without crowding. The .reel-node rules in 03-game.css
   already scale at this breakpoint, so we only adjust the shell. */
@media (max-width: 999px) {
  .hero-puzzle-mount {
    padding: 16px 12px;
    gap: 12px;
  }
  .hero-puzzle-prompt {
    font-size: 1.0rem;
  }
}

/* Mobile: compact further; keep the filmstrip horizontal so the
   "two movies connected" semantics survive the smaller viewport. */
@media (max-width: 639px) {
  .hero-puzzle-mount {
    padding: 12px 8px;
    gap: 10px;
    max-width: 100%;
  }
  .hero-puzzle-prompt {
    font-size: 0.95rem;
  }
}
```

- [ ] **Step 2: Verify insertions only, zero deletions**

Run: `git diff --stat public/css/02-hero-lobby.css`

Expected output shape:
```
 public/css/02-hero-lobby.css | NN +
 1 file changed, NN insertions(+)
```

Where `NN` is the number of lines added. The key check: NO `-` symbol after the `+` (zero deletions).

- [ ] **Step 3: Full suite still green**

Run: `npm test --silent`
Expected: **587 tests pass** — CSS changes don't affect any client tests (jsdom doesn't compute layout).

- [ ] **Step 4: Verify no edits to pre-existing rules**

Run: `git diff public/css/02-hero-lobby.css | grep "^-" | grep -v "^---"`

Expected: empty (no lines start with `-` other than the diff header).

- [ ] **Step 5: Verify 03-game.css stays byte-identical**

Run: `git diff origin/main -- public/css/03-game.css`

Expected: empty (no output). The live-game reel-* CSS rules are unchanged.

- [ ] **Step 6: Commit T2**

```bash
git add public/css/02-hero-lobby.css
git commit -m "Phase 7.9 T2: CSS append — Playable Hero shell styles (zero deletions)

Append-only Phase 7.9 section at EOF of 02-hero-lobby.css. New rules:
.hero-puzzle-mount (flex column shell), .hero-puzzle-prompt (heading),
.reel-bridge--unsolved (compositor-only pulse), .hero-puzzle-input
(input + dropdown wrapper with scoped focus ring), #hero-puzzle-search,
.hero-puzzle-skip (ghost-text skip button), .hero-puzzle-outcome
(reveal card with opacity fade-in), [data-state=checking] + [data-state
^=revealed-] state-driven visibility, plus @max-width 999px/639px
tablet + mobile scaling.

Zero edits to any pre-existing rule. Existing .filmstrip/.reel-node/
.reel-bridge rules in 03-game.css supply the live-game aesthetic for
the mini-filmstrip — we reuse them, never redefine them. No new color
tokens. Compositor-only animations (opacity, no transform-layout); the
existing global prefers-reduced-motion neutralizer at 06-states-anim.css
covers accessibility.

Suite: stays at 587 green (CSS-only, no test surface change).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review Summary

After T2 lands, run these final checks before opening the PR:

```bash
# Suite size
npm test --silent  # expect: 587 tests passing

# Sacrosanct files byte-identical vs origin/main
git diff origin/main -- public/js/ui/ui-render.js public/css/03-game.css server/gameLogic.js server/systems/matchSystem.js public/sw.js client-tests/render-chain.test.js client-tests/render-lobby.test.js client-tests/render-team-screen.test.js client-tests/red-carpet.test.js client-tests/chain-recap.test.js client-tests/turn-motion.test.js client-tests/render-qr.test.js
# expect: empty

# CSS append-only
git diff --stat public/css/02-hero-lobby.css
# expect: insertions only, no `-` count

# Hero-puzzle.js purity
grep -nE "^import|document|window|Date\.now|setTimeout|setInterval" public/js/ui/hero-puzzle.js
# expect: empty

# Server handler ordering (additive only)
git diff server/socketHandlers.js | grep "^-" | grep -v "^---" | grep -v "^$"
# expect: empty (no removed lines)
```

If all checks pass, you're ready to open the PR. The PR description should include the 10-item manual smoke checklist from spec §10 (jsdom can't operate a real socket / TMDB / mobile viewport — those checks require a deployed branch and a real browser).
