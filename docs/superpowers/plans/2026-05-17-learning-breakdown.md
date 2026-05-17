# Phase 6a — Post-Game Learning Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing H3 `youWereEliminated` surface with one read-side "a movie you could have played", reusing the merged Phase 5a bot pathfinder, so an eliminated player sees what *would* have worked.

**Architecture:** A best-effort, time-boxed, fail-closed server helper in `matchSystem.js` calls `botSystem.generateBotMove` (read-only) against the room at the H3 emit point, resolves the returned id to `{title, year}` via the existing `resolveCandidates` direct-ID path, and adds an optional `couldHavePlayed` field to the existing private payload. The client's existing detailed self-elimination card additively renders that field when present. Zero new events; zero change to bot/validation/scoring logic; absent field ⇒ byte-identical current behavior.

**Tech Stack:** Node.js, Socket.io, Jest 30 (two projects: `server` = node/CJS, `client` = jsdom/babel-ESM), Redis-backed TMDB cache.

**Spec:** `docs/superpowers/specs/2026-05-17-learning-breakdown-design.md`

---

## Implementation Notes (read before Task 0)

**Ordering / bounded-delay honesty.** At the H3 site in `submitMovie`
(`server/systems/matchSystem.js`), the private `socket.emit('youWereEliminated')`
(currently ~line 257) runs *before* `gameLogic.eliminateCurrentPlayer(...)`
(~line 274), which is what emits the room-wide `notification`. Computing the
suggestion synchronously before the emit therefore delays the room-wide
elimination by **at most `COULD_HAVE_PLAYED_TIMEOUT_MS`** in the worst case
(TMDB cache miss). This is bounded and fail-closed, and the common path is a
cache **hit** (the suggestion reuses exactly the person-filmography + movie
-details entries the Phase 5a bot cache is built around → typically tens of ms).
The spec's "never delays the room" is the *intent*; this plan implements it as
"bounded, small, fail-closed, no new event" — the faithful realization. Do not
add a second event or move the compute after elimination (both were explicitly
rejected in the spec).

**No `via`.** `generateBotMove` returns only `{ tmdbId, mediaType }` — it does
not expose which shared actor it used. Deriving `via` would require either a
`botSystem` signature change (out of scope per spec §3) or an extra credits
fetch + intersection on the elimination path (extra cost, against the
"best-effort/minimal" intent). The spec makes `via` explicitly optional
("only if obtainable read-only without modifying botSystem"). **Decision: omit
`via`.** Payload shape is `couldHavePlayed: { title, year }`. The movie alone is
the value.

**Why a synthetic profile + constant rng.** `generateBotMove(room, profile,
deps)` early-returns `null` when `rng() < profile.whiff` (botSystem.js:143). For
a *suggestion* we never want a blank, so pass `profile.whiff = 0` (`0 < 0` is
false ⇒ never whiffs) and `rng = () => 0` (deterministic: `_shuffled` becomes a
no-op and `topN[Math.floor(0*len)]` = the highest-popularity candidate ⇒ a
stable, sensible "best" suggestion and reproducible tests). This is a plain
object literal passed by the consumer — **no `botSystem` change**.

---

## Task 0: Server — `couldHavePlayed` payload enrichment

**Goal:** `submitMovie`'s H3 invalid-connection branch attaches an optional, best-effort, fail-closed `couldHavePlayed: { title, year }` to the existing `youWereEliminated` payload.

**Files:**
- Modify: `server/systems/matchSystem.js` (add module constants + `_computeCouldHavePlayed` helper near `resolveCandidates` ~line 358; call it at the H3 emit ~lines 249-269)
- Test: `server/systems/matchSystem.test.js` (extend the existing `describe('matchSystem.submitMovie — youWereEliminated payload (H3)')` block, ends ~line 363)

**Acceptance Criteria:**
- [ ] When `generateBotMove` yields a move and it resolves to a title, the `youWereEliminated` payload includes `couldHavePlayed: { title, year }`.
- [ ] When `generateBotMove` returns `null`, throws, or the resolve yields no candidate, the payload is emitted **without** `couldHavePlayed` and every pre-existing H3 assertion still passes.
- [ ] When the computation exceeds `COULD_HAVE_PLAYED_TIMEOUT_MS`, the field is omitted (fail-closed) and elimination still proceeds.
- [ ] No change to bot move logic, difficulty tables, validation, scoring, or any non-H3 elimination path.
- [ ] Every new/changed line carries a WHY comment (project convention).

**Verify:** `npx jest server --runInBand -t "youWereEliminated"` → all tests in the H3 describe pass (existing + new).

**Steps:**

- [ ] **Step 1: Write the failing tests** — append these tests inside the existing H3 `describe` in `server/systems/matchSystem.test.js` (immediately before its closing `});` at ~line 363). They reuse the existing `beforeEach` mocks (`ctx`, `mockSocket`, `redisUtils`, etc.). Add `const botSystem = require('./botSystem');` at the top of the file if not already required (check the existing requires; the H3 file already requires `matchSystem`, `redisUtils`, `gameLogic`).

```javascript
  // ----- Phase 6a: couldHavePlayed suggestion -----------------------------
  // Shared helper: build the same Inception room the existing H3 test uses,
  // plus a fetch mock that branches by URL so the player's failed guess
  // (36557) and the bot-suggested movie (99999) resolve independently.
  function makeInceptionRoom() {
    return {
      id: 'TEST', status: 'playing',
      players: [
        { id: 'sock-1', name: 'Tester', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1' },
        { id: 'sock-other', name: 'Other', isHost: false, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, stableId: 's2' },
      ],
      spectators: [],
      chain: [{
        playerId: 'sock-other', playerName: 'Other',
        movie: { id: 27205, title: 'Inception', year: '2010',
          cast: [{ id: 6193, name: 'Leonardo DiCaprio' }, { id: 24045, name: 'Joseph Gordon-Levitt' }],
          mediaType: 'movie' },
        matchedActors: [],
      }],
      usedMovies: ['movie:27205'], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0,
      turnExpiresAt: Date.now() + 60000, isValidating: false, gameMode: 'classic',
      currentTurnIndex: 0, currentTurnRetries: 0,
    };
  }
  function fetchByUrl() {
    // resolveCandidates does GET ${BASE}/movie/{id}?... — branch on the id.
    return jest.fn(async (url) => {
      if (String(url).includes('/movie/36557')) {
        return { ok: true, json: async () => ({ id: 36557, title: 'Casino Royale', release_date: '2006-11-14', poster_path: null }) };
      }
      if (String(url).includes('/movie/99999')) {
        return { ok: true, json: async () => ({ id: 99999, title: 'The Dark Knight', release_date: '2008-07-18', poster_path: null }) };
      }
      return { ok: true, json: async () => ({}) };
    });
  }

  test('payload includes couldHavePlayed when the bot pathfinder finds a move', async () => {
    const room = makeInceptionRoom();
    redisUtils.getLobby.mockResolvedValue(room);
    redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 8784, name: 'Daniel Craig' }, { id: 1283, name: 'Helen Mirren' }] });
    global.fetch = fetchByUrl();
    // Spy the merged Phase 5a pathfinder — read-side reuse, mocked to a move.
    jest.spyOn(botSystem, 'generateBotMove').mockResolvedValue({ tmdbId: 99999, mediaType: 'movie' });

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'Casino Royale', tmdbId: 36557, mediaType: 'movie' });

    const payload = mockSocket.emit.mock.calls.find(([e]) => e === 'youWereEliminated')[1];
    expect(payload.couldHavePlayed).toEqual({ title: 'The Dark Knight', year: '2008' });
    // Existing H3 fields still intact (purely additive).
    expect(payload.yourGuess.title).toBe('Casino Royale');
    expect(payload.lastChainEntry.title).toBe('Inception');
    botSystem.generateBotMove.mockRestore();
  });

  test('payload omits couldHavePlayed when the pathfinder returns null', async () => {
    const room = makeInceptionRoom();
    redisUtils.getLobby.mockResolvedValue(room);
    redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 8784, name: 'Daniel Craig' }] });
    global.fetch = fetchByUrl();
    jest.spyOn(botSystem, 'generateBotMove').mockResolvedValue(null);

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'Casino Royale', tmdbId: 36557, mediaType: 'movie' });

    const payload = mockSocket.emit.mock.calls.find(([e]) => e === 'youWereEliminated')[1];
    expect(payload.couldHavePlayed).toBeUndefined();
    expect(payload.yourGuess.title).toBe('Casino Royale'); // existing behavior unaffected
    botSystem.generateBotMove.mockRestore();
  });

  test('payload omits couldHavePlayed when the pathfinder throws (fail-closed)', async () => {
    const room = makeInceptionRoom();
    redisUtils.getLobby.mockResolvedValue(room);
    redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 8784, name: 'Daniel Craig' }] });
    global.fetch = fetchByUrl();
    jest.spyOn(botSystem, 'generateBotMove').mockRejectedValue(new Error('TMDB down'));

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'Casino Royale', tmdbId: 36557, mediaType: 'movie' });

    const elim = mockSocket.emit.mock.calls.find(([e]) => e === 'youWereEliminated');
    expect(elim).toBeDefined();                       // still emitted
    expect(elim[1].couldHavePlayed).toBeUndefined();  // just no suggestion
    expect(typeof elim[1].reason).toBe('string');     // existing assertions hold
    botSystem.generateBotMove.mockRestore();
  });

  test('payload omits couldHavePlayed when the suggestion id will not resolve', async () => {
    const room = makeInceptionRoom();
    redisUtils.getLobby.mockResolvedValue(room);
    redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 8784, name: 'Daniel Craig' }] });
    global.fetch = fetchByUrl();
    // 12321 is not handled by fetchByUrl → resolveCandidates returns [] → omit.
    jest.spyOn(botSystem, 'generateBotMove').mockResolvedValue({ tmdbId: 12321, mediaType: 'movie' });

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'Casino Royale', tmdbId: 36557, mediaType: 'movie' });

    const payload = mockSocket.emit.mock.calls.find(([e]) => e === 'youWereEliminated')[1];
    expect(payload.couldHavePlayed).toBeUndefined();
    botSystem.generateBotMove.mockRestore();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest server --runInBand -t "couldHavePlayed"`
Expected: 4 FAIL — `expect(payload.couldHavePlayed).toEqual(...)` fails because the field does not exist yet (the other three assert `toBeUndefined`/existing fields and may pass trivially; the "includes couldHavePlayed" test must fail).

- [ ] **Step 3: Add module constants** — in `server/systems/matchSystem.js`, near the other top-level constants (e.g. just below the existing `TMDB_*` constants used by `resolveCandidates`), add:

```javascript
// Phase 6a — Post-Game Learning Breakdown.
// Upper bound on the best-effort "a move you could have played" computation.
// On a TMDB cache HIT (the common case — same person-filmography/details the
// Phase 5a bot cache holds) this completes in tens of ms; the bound only
// trips on a cache MISS, where we omit the suggestion rather than stall the
// elimination. Fail-closed: the H3 card already renders fine without it.
const COULD_HAVE_PLAYED_TIMEOUT_MS = 1200;
// A non-difficulty "always finds a move" profile for the SUGGESTION use of
// generateBotMove. whiff:0 ⇒ `rng() < 0` is never true ⇒ it never blanks.
// Plain literal consumed read-only by generateBotMove — no botSystem change.
const SUGGESTION_BOT_PROFILE = { whiff: 0, popularityFloor: 4, retryCap: 3 };
```

- [ ] **Step 4: Add the helper** — in `server/systems/matchSystem.js`, immediately above `async function resolveCandidates` (~line 359), add:

```javascript
// Phase 6a: compute one valid "you could have played X" suggestion for the
// eliminated player, reusing the merged Phase 5a bot pathfinder READ-ONLY.
// Contract: NEVER throws, NEVER returns partial data, and never blocks the
// caller beyond COULD_HAVE_PLAYED_TIMEOUT_MS. Any miss/error/timeout → null
// (the H3 card degrades gracefully — see ui-notifications legacy path).
// botSystem is lazy-required here because botSystem already lazy-requires
// matchSystem (cycle-safe, mirrors botSystem.js:275).
async function _computeCouldHavePlayed(room, pubClient, headers) {
  try {
    const work = (async () => {
      const botSystem = require('./botSystem');
      // rng:()=>0 ⇒ deterministic pick of the most-popular candidate; with
      // SUGGESTION_BOT_PROFILE.whiff===0 the pathfinder never blanks.
      const move = await botSystem.generateBotMove(room, SUGGESTION_BOT_PROFILE, {
        pubClient,
        headers,
        rng: () => 0,
        getOrFetchPersonCredits: redisUtils.getOrFetchPersonCredits,
        dailySeed: [], // unused on a non-empty chain (always true at the H3 site)
      });
      if (!move || move.tmdbId == null) return null;
      // Resolve id → title/year via the SAME direct-ID path submitBotMove
      // uses (cached). movie arg is null ⇒ no fuzzy search.
      const cands = await resolveCandidates(room, null, move.tmdbId, move.mediaType, headers);
      const top = cands && cands[0];
      if (!top || !top.id) return null;
      const title = top.title || top.name;
      if (!title) return null;
      const year = (`${top.release_date || top.first_air_date || ''}`).split('-')[0] || '';
      return { title, year };
    })();
    // Fail-closed time box: the loser of the race is null.
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), COULD_HAVE_PLAYED_TIMEOUT_MS));
    return await Promise.race([work, timeout]);
  } catch (e) {
    return null; // best-effort: a missing suggestion must never break elimination
  }
}
```

- [ ] **Step 5: Wire it into the H3 emit** — in `server/systems/matchSystem.js`, replace the existing `socket.emit('youWereEliminated', { ... })` block (currently lines ~257-269, inside `if (triedCandidate && lastChainEntry) {`) with:

```javascript
          // Phase 6a: best-effort, fail-closed "what would have worked".
          // Awaited before the private emit so it rides the existing single
          // youWereEliminated event (spec: no new event). Bounded by
          // COULD_HAVE_PLAYED_TIMEOUT_MS; see Implementation Notes re: the
          // worst-case bounded delay to the room-wide elimination below.
          const couldHavePlayed = await _computeCouldHavePlayed(room, pubClient, TMDB_HEADERS);
          socket.emit('youWereEliminated', {
            yourGuess: {
              title: triedCandidate.title,
              year: triedCandidate.year,
              cast: namesOnly(triedCandidate.cast),
            },
            lastChainEntry: {
              title: lastChainEntry.movie.title,
              year: lastChainEntry.movie.year,
              cast: namesOnly(lastChainEntry.movie.cast),
            },
            reason: result.reason,
            // Additive + optional: omitted entirely on miss/error/timeout so
            // the client (and every existing H3 assertion) sees no change.
            ...(couldHavePlayed ? { couldHavePlayed } : {}),
          });
```

(Do not change `namesOnly`, the surrounding `if`, or the lines after `}` — `room.isValidating = false; saveLobby; eliminateCurrentPlayer`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest server --runInBand -t "youWereEliminated"`
Expected: PASS — the original H3 test plus all 4 new `couldHavePlayed` tests green.

- [ ] **Step 7: Run the full server project + coverage gate**

Run: `npx jest --runInBand`
Expected: PASS — both projects green, `coverageThreshold` floors (statements 63 / branches 52 / functions 62 / lines 69) still met.

- [ ] **Step 8: Commit**

```bash
git add server/systems/matchSystem.js server/systems/matchSystem.test.js
git commit -m "Phase 6a (0): couldHavePlayed enrichment on H3 youWereEliminated"
```

---

## Task 1: Client — render the suggestion + style + test

**Goal:** The detailed self-elimination card additively renders the `couldHavePlayed` movie beneath the cast comparison; absent ⇒ card byte-identical to today.

**Files:**
- Modify: `public/js/ui/ui-notifications.js` (detailed path of `showSelfEliminationScreen`, ~lines 113-141)
- Modify: `public/css/06-states-anim.css` (append one additive `.self-elim-could` rule; no existing selector touched)
- Test: `client-tests/learning-breakdown.test.js` (new)

**Acceptance Criteria:**
- [ ] `details.couldHavePlayed.title` present ⇒ a `.self-elim-could` element renders with the title (and `(year)` when year is non-empty).
- [ ] `couldHavePlayed` absent but `lastChainEntry`+`yourGuess` present ⇒ detailed card renders with **no** `.self-elim-could` (existing behavior unchanged).
- [ ] Legacy path (`showSelfEliminationScreen(undefined)`) ⇒ no `.self-elim-could`, simple flash unchanged.
- [ ] CSS change is purely additive (Phase 4 discipline: no existing rule modified).
- [ ] WHY comments on changed lines.

**Verify:** `npx jest client --runInBand -t "learning breakdown"` → all 3 tests pass.

**Steps:**

- [ ] **Step 1: Write the failing test** — create `client-tests/learning-breakdown.test.js`:

```javascript
/**
 * @jest-environment jsdom
 */

// Phase 6a: the detailed self-elimination card must additively surface the
// server-computed "you could have played X" suggestion, and must be
// byte-unchanged when the server omits it (miss/error/timeout) or on the
// legacy no-details flash.
import { showSelfEliminationScreen } from '../public/js/ui/ui-notifications.js';

const DETAILS = {
  reason: 'Invalid movie connection.',
  lastChainEntry: { title: 'Inception', year: '2010', cast: ['Leonardo DiCaprio'] },
  yourGuess: { title: 'Casino Royale', year: '2006', cast: ['Daniel Craig'] },
};

describe('learning breakdown — couldHavePlayed in self-elimination screen', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  test('renders the suggestion when couldHavePlayed is present', () => {
    showSelfEliminationScreen({ ...DETAILS, couldHavePlayed: { title: 'The Dark Knight', year: '2008' } });
    const could = document.querySelector('.self-elim-could');
    expect(could).not.toBeNull();
    expect(could.textContent).toContain('The Dark Knight');
    expect(could.textContent).toContain('2008');
    // Existing comparison grid still rendered.
    expect(document.querySelector('.self-elim-grid')).not.toBeNull();
  });

  test('omits the suggestion when couldHavePlayed is absent (unchanged card)', () => {
    showSelfEliminationScreen({ ...DETAILS });
    expect(document.querySelector('.self-elim-could')).toBeNull();
    expect(document.querySelector('.self-elim-card')).not.toBeNull();
    expect(document.querySelector('.self-elim-grid')).not.toBeNull();
  });

  test('legacy no-details flash has no suggestion block', () => {
    showSelfEliminationScreen(undefined);
    expect(document.querySelector('.self-elim-could')).toBeNull();
    const screen = document.querySelector('.self-elim-screen');
    expect(screen).not.toBeNull();
    expect(screen.classList.contains('self-elim-screen--detailed')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest client --runInBand -t "learning breakdown"`
Expected: FAIL — first test fails (`.self-elim-could` is null; not rendered yet).

- [ ] **Step 3: Render the suggestion block** — in `public/js/ui/ui-notifications.js`, in the detailed path, directly **after** the two `grid.appendChild(buildColumn(...))` lines (currently 114-115) and **before** `// Hint line` (currently 117), insert:

```javascript
  // Phase 6a: when the server computed a move that WOULD have connected,
  // surface it beneath the comparison — turns "you were wrong" into "here's
  // what right looked like". Optional + additive: absent ⇒ this block (and
  // the .self-elim-could node) simply does not exist, so the card is
  // byte-identical to the pre-6a card. textContent (not innerHTML) keeps the
  // file's no-innerHTML XSS posture; titles are TMDB-sourced but we stay
  // consistent with the rest of this renderer.
  let couldEl = null;
  if (details.couldHavePlayed && details.couldHavePlayed.title) {
    couldEl = document.createElement('div');
    couldEl.className = 'self-elim-could';
    const y = details.couldHavePlayed.year;
    couldEl.textContent = `You could have played: ${details.couldHavePlayed.title}${y ? ` (${y})` : ''}`;
  }
```

Then in the append sequence (currently lines 137-141), add the `couldEl`
append between `card.appendChild(grid);` and `card.appendChild(hint);`:

```javascript
  card.appendChild(head);
  card.appendChild(grid);
  // Phase 6a: only present when the server supplied a suggestion (above).
  if (couldEl) card.appendChild(couldEl);
  card.appendChild(hint);
  card.appendChild(close);
  el.appendChild(card);
```

(Leave `head`, `grid`, `hint`, `close`, focus, and the legacy path untouched.)

- [ ] **Step 4: Add the additive style** — append to the END of `public/css/06-states-anim.css` (do not modify any existing rule — Phase 4 additive-only discipline):

```css
/* Phase 6a: the "you could have played X" line on the detailed
   self-elimination card. Additive only — no existing self-elim rule is
   modified. Sits between the cast comparison grid and the generic hint. */
.self-elim-could {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: rgba(52, 211, 153, 0.12);
  color: #34d399;
  font-weight: 600;
  text-align: center;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest client --runInBand -t "learning breakdown"`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Run the full suite + coverage gate**

Run: `npx jest --runInBand`
Expected: PASS — both projects green; coverage floors still met.

- [ ] **Step 7: Commit**

```bash
git add public/js/ui/ui-notifications.js public/css/06-states-anim.css client-tests/learning-breakdown.test.js
git commit -m "Phase 6a (1): render couldHavePlayed on the self-elimination card"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-05-17-learning-breakdown-design.md`):
- §3 in-scope: optional `couldHavePlayed:{title,year,via?}` on `youWereEliminated` → Task 0 (via omitted per Implementation Notes — spec explicitly permits). ✓
- §3 read-side via `generateBotMove` + existing cached resolver → Task 0 `_computeCouldHavePlayed`. ✓
- §3 client renders beneath `self-elim-grid` when present → Task 1. ✓
- §3 best-effort/time-boxed/fail-closed → Task 0 helper (try/catch + `Promise.race` timeout). ✓
- §6 only the private emit is affected; no new event → Task 0 (single existing event; bounded-delay nuance disclosed in Implementation Notes, not hidden). ✓
- §8 tests: present / null / throws / unresolved + client present/absent/legacy → Task 0 (4) + Task 1 (3). ✓
- §3 out-of-scope (no bot/validation/scoring change, no new event, no persistence) → honored; `SUGGESTION_BOT_PROFILE` is a consumer-side literal, `botSystem` only read. ✓
- §8 "no regression on non-H3 eliminations" → covered: the helper is only called inside the `if (triedCandidate && lastChainEntry)` H3 branch; timeout/disconnect/quit paths never reach it (no test needed beyond the untouched existing suite, which Step 7 runs).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type/name consistency:** `couldHavePlayed: { title, year }` identical in Task 0 helper, Task 0 payload, Task 0 tests, Task 1 render, Task 1 tests. `_computeCouldHavePlayed`, `SUGGESTION_BOT_PROFILE`, `COULD_HAVE_PLAYED_TIMEOUT_MS` used consistently. `.self-elim-could` class identical in JS, CSS, tests. ✓

No gaps found.

---

## Process Notes

Per the validated pipeline (Phases 1–5a) — see
`docs/superpowers/specs/2026-05-17-learning-breakdown-design.md` §10:

- This plan + co-located `2026-05-17-learning-breakdown.md.tasks.json` are
  committed to `main` locally, then a feature branch
  **`phase6a-learning-breakdown` off `main`** (not a worktree, not stacked —
  in particular NOT on the parallel `phase5b-fallback-movie-db` branch).
- Native Task tools unavailable → TodoWrite in-session + the hand-authored
  `.md.tasks.json`; a task flips to `completed` only after BOTH its per-task
  reviews pass.
- Per task: implementer (full task text + exact code) → independent
  spec-compliance review → independent code-quality review → fix-loop →
  commit → sync `.tasks.json`. Final opus whole-branch holistic review.
- WHY-comments on every changed line. `coverage/` stays untracked.
- This touches the `submitMovie` submit/elim path → real-boot verification is
  OUTSTANDING until the user merges and Render is checked (read-only) + an
  in-browser eyeball of the elimination card. Flag in the PR body.
- Finishing: push the feature branch + `gh pr create` (base `main`). PR-merge
  / push-to-main / Render deploy is classifier-gated and handed to the user.
- Out-of-scope findings during reviews → session spawn_task chip, never scope
  creep (6b/6c are separate phases; remediation 5b is the parallel track's).
