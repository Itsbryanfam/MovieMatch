# Phase 7.1 — Elimination Aftercare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn elimination into learning — show up to 3 valid "outs" (each annotated with the actor that bridges it to the last chain entry) on both the invalid-connection and the timeout elimination, framed as "you were one bridge away."

**Architecture:** A fail-closed read-side enumerator in `botSystem` reuses the exact pathfinding `generateBotMove` already does (extracted to a shared per-actor ranking helper, behaviour-preserving). `matchSystem._computeCouldHavePlayed` becomes a multi-out wrapper feeding the existing private `youWereEliminated` emit; a second, timeout-only emit is added in `gameLogic.eliminateCurrentPlayer`. The client `showSelfEliminationScreen` gains an outs block and a timeout variant. No new socket event; no scoring/validation change; fail-closed and time-boxed.

**Tech Stack:** Node, vanilla ES modules, jest (server project + jsdom client project), Socket.io, Redis-cached TMDB.

**Spec:** `docs/superpowers/specs/2026-05-17-elimination-aftercare-design.md`

**Execution context:** subagent-driven-development creates an isolated git worktree off the **then-current** `origin/main` (a parallel Codex agent shares this repo — verify branch before every commit). Native Task tools are unavailable in this environment: track via TodoWrite + the co-located `.tasks.json`. Per-task two-stage review (spec-compliance then code-quality) + a final most-capable-model whole-branch holistic review. Every code change ships a WHY comment. Commands assume the worktree root as cwd with `node_modules` available; run `npx jest …`.

---

### Task 0: botSystem read-side enumerator seam (`enumerateConnectingMoves`)

**Goal:** Extract the per-actor candidate ranking shared by `generateBotMove` into a pure helper, then add a fail-closed exported `enumerateConnectingMoves` that returns up to `limit` connecting moves each with the bridging actor — without changing `generateBotMove`'s observable behaviour.

**Files:**
- Modify: `server/systems/botSystem.js` (`generateBotMove` body lines ~180-191; add `_rankConnectingCandidates` + `enumerateConnectingMoves`; extend `module.exports` line 319)
- Test: `server/systems/botSystem.enumerate.test.js` (new — isolated like `botSystem.schedule.test.js` so its mocks don't leak into `botSystem.test.js`)

**Acceptance Criteria:**
- [ ] `enumerateConnectingMoves(room, deps, { limit })` returns ≤ `limit` objects `{ tmdbId, mediaType:'movie', viaActor:{ id, name } }`; each `viaActor` is an actor present in the last chain entry's cast.
- [ ] Results are deduped by `tmdbId`; order is deterministic when `rng: () => 0`.
- [ ] Fail-closed: empty chain, no credits, all-actor TMDB errors, or any throw → `[]` (never throws).
- [ ] `generateBotMove` behaviour is unchanged: the full existing `botSystem.test.js` / `botSystem.schedule.test.js` / `matchSystem.botmove.test.js` / `lobbySystem.botlifecycle.test.js` suites stay green.

**Verify:** `npx jest server/systems/botSystem.enumerate.test.js server/systems/botSystem.test.js server/systems/botSystem.schedule.test.js server/systems/matchSystem.botmove.test.js server/systems/lobbySystem.botlifecycle.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `server/systems/botSystem.enumerate.test.js`:

```js
// Phase 7.1: read-side enumerator. Own file (hoisted jest.mock isolation —
// mirrors botSystem.schedule.test.js) so credit mocks never leak into the
// difficulty/move-gen tests in botSystem.test.js.
const botSystem = require('./botSystem');

// last chain entry casts Alice (id1) and Bob (id2). Alice also stars in
// movies 10/11; Bob in 12. rng:()=>0 makes _shuffled + any pick deterministic.
function room() {
  return {
    chain: [{ movie: { id: 99, cast: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] } }],
    usedMovies: [],
    previousSharedActors: [],
    hardcoreMode: false,
  };
}
const profile = { whiff: 0, popularityFloor: 4, retryCap: 3 };
function deps(creditsById) {
  return {
    pubClient: {}, headers: {}, rng: () => 0, dailySeed: [],
    getOrFetchPersonCredits: async (_pc, id) => creditsById[id] || { movies: [] },
  };
}

describe('enumerateConnectingMoves', () => {
  test('returns up to limit moves, each tagged with the bridging actor', async () => {
    const credits = {
      1: { movies: [{ id: 10, popularity: 90 }, { id: 11, popularity: 50 }] },
      2: { movies: [{ id: 12, popularity: 80 }] },
    };
    const out = await botSystem.enumerateConnectingMoves(room(), deps(credits), { limit: 3 });
    expect(out).toHaveLength(3);
    expect(out.map(o => o.tmdbId).sort()).toEqual([10, 11, 12]);
    const viaFor = id => out.find(o => o.tmdbId === id).viaActor.name;
    expect(viaFor(10)).toBe('Alice');
    expect(viaFor(12)).toBe('Bob');
    out.forEach(o => expect(o.mediaType).toBe('movie'));
  });

  test('dedupes a movie reachable via two actors and respects limit', async () => {
    const credits = {
      1: { movies: [{ id: 10, popularity: 90 }] },
      2: { movies: [{ id: 10, popularity: 90 }, { id: 12, popularity: 70 }] },
    };
    const out = await botSystem.enumerateConnectingMoves(room(), deps(credits), { limit: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].tmdbId).toBe(10);
  });

  test('fail-closed: no chain / no credits / all errors → []', async () => {
    await expect(botSystem.enumerateConnectingMoves({ chain: [] }, deps({}), { limit: 3 })).resolves.toEqual([]);
    await expect(botSystem.enumerateConnectingMoves(room(), deps({}), { limit: 3 })).resolves.toEqual([]);
    const throwing = { ...deps({}), getOrFetchPersonCredits: async () => { throw new Error('tmdb'); } };
    await expect(botSystem.enumerateConnectingMoves(room(), throwing, { limit: 3 })).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest server/systems/botSystem.enumerate.test.js`
Expected: FAIL — `botSystem.enumerateConnectingMoves is not a function`.

- [ ] **Step 3: Extract the shared per-actor ranking helper (behaviour-preserving)**

In `server/systems/botSystem.js`, add this helper just above `generateBotMove` (after `_sameActor`, ~line 127). It is the exact filter+sort currently inline at lines 180-189:

```js
// Phase 7.1: the per-actor "credits → ranked connecting candidates" step,
// extracted verbatim from generateBotMove so the read-side enumerator can
// reuse the SAME validity/popularity/sort rule (no rule duplicated). Pure:
// no TMDB, no rng. Returns candidates sorted by popularity desc.
function _rankConnectingCandidates(credits, lastMovieId, used, popularityFloor) {
  const candidates = ((credits && credits.movies) || []).filter(m =>
    m.id !== lastMovieId &&
    !used.has(`movie:${m.id}`) &&
    (m.popularity || 0) >= popularityFloor
  );
  candidates.sort((x, y) => (y.popularity || 0) - (x.popularity || 0));
  return candidates;
}
```

Now replace the inline block in `generateBotMove` (current lines 180-191):

```js
    const candidates = (credits.movies || []).filter(m =>
      m.id !== lastMovieId &&
      !used.has(`movie:${m.id}`) &&
      (m.popularity || 0) >= profile.popularityFloor
    );
    if (candidates.length === 0) continue;
    // Prefer recognizable films: sort by popularity desc, then rng-pick from
    // the top slice so it's not robotically always the single most-popular.
    candidates.sort((x, y) => (y.popularity || 0) - (x.popularity || 0));
    const topN = candidates.slice(0, Math.min(5, candidates.length));
    const pick = topN[Math.floor(rng() * topN.length)];
    return { tmdbId: pick.id, mediaType: 'movie' };
```

with (identical behaviour — same filter, same sort, same top-5 rng pick):

```js
    const candidates = _rankConnectingCandidates(credits, lastMovieId, used, profile.popularityFloor);
    if (candidates.length === 0) continue;
    // Prefer recognizable films: rng-pick from the top slice so it's not
    // robotically always the single most-popular (unchanged from pre-7.1).
    const topN = candidates.slice(0, Math.min(5, candidates.length));
    const pick = topN[Math.floor(rng() * topN.length)];
    return { tmdbId: pick.id, mediaType: 'movie' };
```

- [ ] **Step 4: Add `enumerateConnectingMoves`**

Add after `generateBotMove` (after line 194), reusing the same actor-selection rule as `generateBotMove` (lines 156-169) and the new helper:

```js
/**
 * Phase 7.1 read-side: enumerate up to `limit` distinct connecting moves for
 * the CURRENT chain, each tagged with the actor that bridges it to the last
 * entry. Reuses generateBotMove's exact actor-selection + candidate rule (via
 * _rankConnectingCandidates) — NO connection rule duplicated, NO whiff, NO
 * first-move seeding (the only caller, _computeCouldHavePlayed, always has
 * chain.length >= 1). Contract: NEVER throws; returns [] on empty chain / no
 * credits / errors. deps mirror generateBotMove's.
 */
async function enumerateConnectingMoves(room, deps, { limit = 3 } = {}) {
  try {
    const { pubClient, headers, rng, getOrFetchPersonCredits } = deps;
    const chain = (room && room.chain) || [];
    if (chain.length === 0) return [];
    const lastNode = chain[chain.length - 1];
    const lastMovieId = lastNode && lastNode.movie ? lastNode.movie.id : null;
    const lastCast = (lastNode && lastNode.movie && lastNode.movie.cast) || [];
    const used = new Set(room.usedMovies || []);
    const prevConnectors = room.previousSharedActors || [];

    let actors = lastCast.filter(a => a && a.id != null);
    if (room.hardcoreMode) {
      actors = actors.filter(a => !prevConnectors.some(p => _sameActor(p, a)));
    }
    // Deterministic when rng:()=>0 (the suggestion caller passes that), but
    // honour an injected rng for parity with generateBotMove's actor order.
    actors = _shuffled(actors, rng);

    const out = [];
    const seen = new Set();
    for (const actor of actors) {
      if (out.length >= limit) break;
      let credits;
      try {
        credits = await getOrFetchPersonCredits(pubClient, actor.id, headers);
      } catch (e) {
        continue; // TMDB blip on this actor — best-effort, try the next
      }
      const ranked = _rankConnectingCandidates(credits, lastMovieId, used, deps.popularityFloor != null ? deps.popularityFloor : 0);
      for (const m of ranked) {
        if (out.length >= limit) break;
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({ tmdbId: m.id, mediaType: 'movie', viaActor: { id: actor.id, name: actor.name } });
      }
    }
    return out;
  } catch (e) {
    return []; // best-effort: a missing suggestion must never break elimination
  }
}
```

Update `module.exports` (line 319) to add `enumerateConnectingMoves` **and** `_tmdbHeaders` (the latter is the existing env-derived headers helper at lines 22-24 — already used by the bot path for the "no ctx headers" case; Task 2's timeout aftercare runs in `eliminateCurrentPlayer`, which likewise has no ctx headers, and must reuse this exact builder rather than invent a second env read):

```js
module.exports = { BOT_DIFFICULTIES, BOT_NAMES, createBot, generateBotMove, enumerateConnectingMoves, _tmdbHeaders, scheduleBotMove, clearBotTimeout };
```

- [ ] **Step 5: Run tests to verify green (new + regression)**

Run: `npx jest server/systems/botSystem.enumerate.test.js server/systems/botSystem.test.js server/systems/botSystem.schedule.test.js server/systems/matchSystem.botmove.test.js server/systems/lobbySystem.botlifecycle.test.js`
Expected: PASS, all suites. (Regression suites prove the `generateBotMove` extraction is behaviour-preserving.)

- [ ] **Step 6: Commit**

```bash
git add server/systems/botSystem.js server/systems/botSystem.enumerate.test.js
git commit -m "Phase 7.1 (0): botSystem enumerateConnectingMoves read-side seam

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1: matchSystem multi-out wrapper + invalid-connection emit

**Goal:** Rework `_computeCouldHavePlayed` to return up to 3 `{title,year,viaActor}` outs via `enumerateConnectingMoves`, keeping the existing timeout/fail-closed discipline, and emit `outs` (not `couldHavePlayed`) on the invalid-connection `youWereEliminated`.

**Files:**
- Modify: `server/systems/matchSystem.js` (`_computeCouldHavePlayed` lines 409-459; invalid emit lines ~281-296; export the function + a `topCastNames` helper; `module.exports`)
- Test: `server/systems/matchSystem.aftercare.test.js` (new); update any existing `couldHavePlayed` assertions in `server/systems/matchSystem*.test.js` / `server/integration.test.js`

**Acceptance Criteria:**
- [ ] `_computeCouldHavePlayed(room, pubClient, headers)` returns `[{title,year,viaActor}]` (≤3, deduped by title) or `null`; whole batch resolves within `COULD_HAVE_PLAYED_TIMEOUT_MS` (race/`.unref()`/`clearTimeout` discipline preserved); any miss/error/timeout → `null`.
- [ ] Invalid-connection `youWereEliminated` carries `outs` when non-empty, omits the key entirely otherwise; `yourGuess`/`lastChainEntry`/`reason` unchanged.
- [ ] `_computeCouldHavePlayed` and `topCastNames` are exported for reuse by `gameLogic` (Task 2).
- [ ] Pre-7.1 `couldHavePlayed` assertions migrated to the `outs` shape; full `matchSystem`/`integration` suites green.

**Verify:** `npx jest server/systems/matchSystem.aftercare.test.js server/systems/matchSystem.test.js server/integration.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `server/systems/matchSystem.aftercare.test.js`:

```js
const matchSystem = require('./matchSystem');
const botSystem = require('./botSystem');

describe('_computeCouldHavePlayed → outs', () => {
  const room = { chain: [{ movie: { id: 99, cast: [] } }] };
  afterEach(() => jest.restoreAllMocks());

  test('maps enumerator results to ≤3 deduped {title,year,viaActor}', async () => {
    jest.spyOn(botSystem, 'enumerateConnectingMoves').mockResolvedValue([
      { tmdbId: 10, mediaType: 'movie', viaActor: { id: 1, name: 'Alice' } },
      { tmdbId: 12, mediaType: 'movie', viaActor: { id: 2, name: 'Bob' } },
    ]);
    jest.spyOn(matchSystem, 'resolveCandidates').mockImplementation(async (_r, _m, id) =>
      id === 10 ? [{ id: 10, title: 'Heat', release_date: '1995-12-15' }]
                : [{ id: 12, title: 'Speed', release_date: '1994-06-10' }]);
    const outs = await matchSystem._computeCouldHavePlayed(room, {}, {});
    expect(outs).toEqual([
      { title: 'Heat', year: '1995', viaActor: 'Alice' },
      { title: 'Speed', year: '1994', viaActor: 'Bob' },
    ]);
  });

  test('no enumerator results → null', async () => {
    jest.spyOn(botSystem, 'enumerateConnectingMoves').mockResolvedValue([]);
    await expect(matchSystem._computeCouldHavePlayed(room, {}, {})).resolves.toBeNull();
  });

  test('enumerator throwing is swallowed → null (never breaks elimination)', async () => {
    jest.spyOn(botSystem, 'enumerateConnectingMoves').mockRejectedValue(new Error('x'));
    await expect(matchSystem._computeCouldHavePlayed(room, {}, {})).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest server/systems/matchSystem.aftercare.test.js`
Expected: FAIL — `_computeCouldHavePlayed` not exported / returns old `{title,year}` single-object shape.

- [ ] **Step 3: Rework `_computeCouldHavePlayed` (matchSystem.js lines 409-459)**

Replace the body of `_computeCouldHavePlayed` so the `work` promise enumerates and maps; keep the existing timeout race / `handle`/`.unref()`/`work.catch(()=>{})`/`finally clearTimeout` / outer `try/catch → null` exactly as-is. New `work`:

```js
    const work = (async () => {
      const botSystem = require('./botSystem');
      const moves = await botSystem.enumerateConnectingMoves(room, {
        pubClient,
        headers,
        rng: () => 0, // deterministic most-popular-first
        getOrFetchPersonCredits: redisUtils.getOrFetchPersonCredits,
        popularityFloor: SUGGESTION_BOT_PROFILE.popularityFloor,
        dailySeed: [],
      }, { limit: 3 });
      if (!moves || moves.length === 0) return null;
      const outs = [];
      const seenTitles = new Set();
      for (const mv of moves) {
        const cands = await resolveCandidates(room, null, mv.tmdbId, mv.mediaType, headers);
        const top = cands && cands[0];
        if (!top || !top.id) continue;
        const title = top.title || top.name;
        if (!title || seenTitles.has(title)) continue;
        seenTitles.add(title);
        const year = (`${top.release_date || top.first_air_date || ''}`).split('-')[0] || '';
        outs.push({ title, year, viaActor: (mv.viaActor && mv.viaActor.name) || '' });
        if (outs.length >= 3) break;
      }
      return outs.length ? outs : null;
    })();
```

Add a shared cast-trim helper near the existing `namesOnly` usage and export it + `_computeCouldHavePlayed` + `resolveCandidates`. At the bottom `module.exports`, add:

```js
// Top-10 cast names — the wire shape both elimination paths send so the
// self-elim card renders identically (extracted so gameLogic's timeout
// emit doesn't re-implement it).
function topCastNames(cast) {
  return (cast || []).slice(0, 10).map(a => typeof a === 'string' ? a : (a && a.name) || '');
}
```
and ensure `module.exports` includes `_computeCouldHavePlayed`, `resolveCandidates`, `topCastNames` (resolveCandidates must be exported for the test's spy and gameLogic; if `namesOnly` exists inline at the emit site, replace it with `topCastNames`).

- [ ] **Step 4: Swap the invalid-connection emit (matchSystem.js ~281-296)**

Replace:

```js
          const couldHavePlayed = await _computeCouldHavePlayed(room, pubClient, TMDB_HEADERS);
```
…and the spread `...(couldHavePlayed ? { couldHavePlayed } : {})` with:

```js
          const outs = await _computeCouldHavePlayed(room, pubClient, TMDB_HEADERS);
```
```js
            ...(outs && outs.length ? { outs } : {}),
```
Leave `yourGuess`, `lastChainEntry` (use `topCastNames(...)` in place of the local `namesOnly`), and `reason` unchanged.

- [ ] **Step 5: Migrate pre-7.1 assertions**

Run `npx jest server/systems/matchSystem.test.js server/integration.test.js`; for every failure asserting `couldHavePlayed`, change the expectation to the `outs` array shape (`expect.arrayContaining([expect.objectContaining({ title, viaActor })])`) and assert the key is **omitted** (not `couldHavePlayed`) when no suggestion.

- [ ] **Step 6: Run tests to verify green**

Run: `npx jest server/systems/matchSystem.aftercare.test.js server/systems/matchSystem.test.js server/integration.test.js`
Expected: PASS, all.

- [ ] **Step 7: Commit**

```bash
git add server/systems/matchSystem.js server/systems/matchSystem.aftercare.test.js server/systems/matchSystem.test.js server/integration.test.js
git commit -m "Phase 7.1 (1): multi-out wrapper + invalid-connection outs emit

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: gameLogic timeout-only private `youWereEliminated`

**Goal:** On a human, non-team, connected player's *timeout* elimination, privately emit `youWereEliminated` with `timedOut:true` + `outs` (no `yourGuess`), bounded and fail-closed, without affecting any other `eliminateCurrentPlayer` caller.

**Files:**
- Modify: `server/gameLogic.js` (`eliminateCurrentPlayer` lines 175-206 — insert between the room notification/telemetry block ~201 and `checkWinCondition` line 202)
- Test: `server/gameLogic.aftercare.test.js` (new)

**Acceptance Criteria:**
- [ ] Timeout elimination of a human (`player.stableId` truthy), non-team, `player.connected` player emits a private `io.to(player.id).emit('youWereEliminated', { lastChainEntry, reason, timedOut:true, outs? })` with **no `yourGuess`**.
- [ ] NOT emitted for: bots (`stableId` null), quit/disconnect reasons, `"Too many invalid title attempts"`, or team mode.
- [ ] `outs` omitted when `_computeCouldHavePlayed` → null; elimination/`nextTurn` never blocked beyond `COULD_HAVE_PLAYED_TIMEOUT_MS`.
- [ ] Existing timeout/turn-watchdog/elimination tests stay green.

**Verify:** `npx jest server/gameLogic.aftercare.test.js server/turn-watchdog.test.js server/turn-sweep.test.js server/integration.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `server/gameLogic.aftercare.test.js`:

```js
const gameLogic = require('./gameLogic');
const matchSystem = require('./systems/matchSystem');

function mkIo() {
  const emits = [];
  const io = { to: (id) => ({ emit: (ev, payload) => emits.push({ id, ev, payload }) }) };
  return { io, emits };
}
function baseState(extra) {
  return Object.assign({
    gameMode: 'classic', status: 'playing', currentTurnIndex: 0,
    chain: [{ movie: { id: 9, title: 'Heat', year: 1995, cast: [{ name: 'Al' }] } }],
    players: [{ id: 'sock1', name: 'Ann', stableId: 'p1', connected: true, isAlive: true }],
  }, extra);
}

describe('eliminateCurrentPlayer — timeout aftercare', () => {
  afterEach(() => jest.restoreAllMocks());

  test('human non-team connected timeout → private youWereEliminated, timedOut, no yourGuess', async () => {
    jest.spyOn(matchSystem, '_computeCouldHavePlayed').mockResolvedValue([{ title: 'Speed', year: '1994', viaActor: 'Al' }]);
    const { io, emits } = mkIo();
    await gameLogic.eliminateCurrentPlayer(io, {}, 'L1', baseState(), 'Turn timed out');
    const yw = emits.find(e => e.ev === 'youWereEliminated');
    expect(yw).toBeTruthy();
    expect(yw.id).toBe('sock1');
    expect(yw.payload.timedOut).toBe(true);
    expect(yw.payload.yourGuess).toBeUndefined();
    expect(yw.payload.outs).toEqual([{ title: 'Speed', year: '1994', viaActor: 'Al' }]);
  });

  test('bot / non-timeout reason / disconnected → NO youWereEliminated', async () => {
    const spy = jest.spyOn(matchSystem, '_computeCouldHavePlayed').mockResolvedValue([{ title: 'X', year: '2', viaActor: 'Y' }]);
    for (const st of [
      baseState({ players: [{ id: 'b', name: 'Bot', stableId: null, connected: true, isAlive: true }] }),
      baseState(), // reason below is non-timeout
      baseState({ players: [{ id: 's', name: 'A', stableId: 'p', connected: false, isAlive: true }] }),
    ]) {
      const { io, emits } = mkIo();
      const reason = st.players[0].stableId === null ? 'Turn timed out'
                   : st.players[0].connected ? "Too many invalid title attempts"
                   : 'Turn timed out';
      await gameLogic.eliminateCurrentPlayer(io, {}, 'L1', st, reason);
      expect(emits.find(e => e.ev === 'youWereEliminated')).toBeFalsy();
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest server/gameLogic.aftercare.test.js`
Expected: FAIL — no `youWereEliminated` emitted from `eliminateCurrentPlayer`.

- [ ] **Step 3: Insert the timeout-only emit**

In `server/gameLogic.js`, inside `eliminateCurrentPlayer`, immediately after the `if (player) { … telemetry.track(…) }` block and **before** `await checkWinCondition(...)` (line 202), add:

```js
  // Phase 7.1: timeout aftercare. The invalid-connection path already sends a
  // private youWereEliminated (matchSystem); the timeout/freeze path only had
  // a room-wide notification. Give a HUMAN (stableId — bots are null), non-team
  // (team eliminations returned above), still-connected player who ran out the
  // clock the same learning card. Bounded + fail-closed: a missing suggestion
  // or a slow TMDB must never delay nextTurn beyond _computeCouldHavePlayed's
  // own timeout, and must never throw out of the elimination path.
  if (player && player.stableId && player.connected && _categorizeReason(reason) === 'timeout') {
    try {
      const ms = require('./systems/matchSystem'); // lazy: cycle-safe (ms → gameLogic edge already exists)
      const botSystem = require('./systems/botSystem');
      const last = (state.chain || [])[(state.chain || []).length - 1];
      if (last && last.movie) {
        // eliminateCurrentPlayer has no ctx TMDB headers (same as the bot
        // turn hook). Reuse botSystem._tmdbHeaders() — the exact env-derived
        // builder the no-ctx bot path already uses — not a second env read.
        const outs = await ms._computeCouldHavePlayed(state, pubClient, botSystem._tmdbHeaders());
        io.to(player.id).emit('youWereEliminated', {
          lastChainEntry: {
            title: last.movie.title,
            year: last.movie.year,
            cast: ms.topCastNames(last.movie.cast),
          },
          reason,
          timedOut: true,
          ...(outs && outs.length ? { outs } : {}),
        });
      }
    } catch (e) {
      // Aftercare is best-effort — never let it break the elimination path.
      logger.error(e, 'timeout aftercare failed');
    }
  }
```

Note: `gameLogic.js` already requires `logger`; confirm `_categorizeReason` is in scope (it is — defined at gameLogic.js:247, same module). The lazy `require('./systems/matchSystem')` / `require('./systems/botSystem')` inside the function is the established cycle-safe pattern (matchSystem→gameLogic is the existing edge; do not add a top-level require).

- [ ] **Step 4: Run tests to verify green**

Run: `npx jest server/gameLogic.aftercare.test.js server/turn-watchdog.test.js server/turn-sweep.test.js server/integration.test.js`
Expected: PASS, all.

- [ ] **Step 5: Commit**

```bash
git add server/gameLogic.js server/gameLogic.aftercare.test.js
git commit -m "Phase 7.1 (2): timeout-only private youWereEliminated aftercare

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: client — outs block + timeout variant in `showSelfEliminationScreen`

**Goal:** Render up to 3 outs (`{title} ({year}) — via {actor}`) + a "You were one bridge away." line, and a timeout variant (needed-only column, no "You played"), preserving the no-`innerHTML` posture and the legacy flash.

**Files:**
- Modify: `public/js/ui/ui-notifications.js` (`showSelfEliminationScreen` lines 43-164: detailed-path guard line 48; `.self-elim-could` block lines 124-130 & 154-155; hint lines 132-136)
- Test: `client-tests/self-elim-aftercare.test.js` (new); update any existing `self-elim-could`/`couldHavePlayed` assertions in `client-tests/`

**Acceptance Criteria:**
- [ ] `details.outs` (≤3) renders a `.self-elim-outs` list, each row text `"{title} ({year}) — via {actor}"`, plus a `.self-elim-bridge` line "You were one bridge away."; replaces the generic hint when present.
- [ ] `details.timedOut` takes the detailed path even with no `yourGuess`: head copy "Time's up — you froze", only the "Needed a connection to" column, plus the outs block; no "You played" column.
- [ ] Invalid path unchanged (2-column grid + outs beneath). No-`outs`+no-`timedOut` ⇒ structurally identical to the pre-7.1 6a detailed card; truly detail-less ⇒ legacy 3s flash unchanged.
- [ ] Titles/actor names render as text (no HTML execution).

**Verify:** `npx jest client-tests/self-elim-aftercare.test.js client-tests/` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `client-tests/self-elim-aftercare.test.js`:

```js
/**
 * @jest-environment jsdom
 */
const { loadIndexHtml } = require('./fixtures');
import { showSelfEliminationScreen } from '../public/js/ui.js';

const lastEntry = { title: 'Heat', year: 1995, cast: ['Al Pacino', 'Robert De Niro'] };

describe('showSelfEliminationScreen — 7.1 aftercare', () => {
  beforeEach(() => { loadIndexHtml(); });

  test('invalid path: outs list with via-actor + bridge line, no generic hint', () => {
    showSelfEliminationScreen({
      reason: 'No shared cast', lastChainEntry: lastEntry,
      yourGuess: { title: 'Cats', year: 2019, cast: ['x'] },
      outs: [{ title: 'Speed', year: '1994', viaActor: 'Keanu Reeves' },
             { title: 'Point Break', year: '1991', viaActor: 'Keanu Reeves' }],
    });
    const rows = [...document.querySelectorAll('.self-elim-outs-row')].map(r => r.textContent);
    expect(rows).toEqual(['Speed (1994) — via Keanu Reeves', 'Point Break (1991) — via Keanu Reeves']);
    expect(document.querySelector('.self-elim-bridge').textContent).toMatch(/one bridge away/i);
    expect(document.querySelector('.self-elim-hint')).toBeNull();
    expect(document.querySelector('.self-elim-col--played')).not.toBeNull();
  });

  test('timeout variant: detailed card, needed-only, no "You played"', () => {
    showSelfEliminationScreen({ reason: 'Turn timed out', lastChainEntry: lastEntry, timedOut: true,
      outs: [{ title: 'Speed', year: '1994', viaActor: 'Keanu Reeves' }] });
    expect(document.querySelector('.self-elim-screen--detailed')).not.toBeNull();
    expect(document.querySelector('.self-elim-col--needed')).not.toBeNull();
    expect(document.querySelector('.self-elim-col--played')).toBeNull();
    expect(document.querySelector('.self-elim-title').textContent).toMatch(/time/i);
  });

  test('no outs + no timedOut ⇒ pre-7.1 detailed card (generic hint, no outs block)', () => {
    showSelfEliminationScreen({ reason: 'No shared cast', lastChainEntry: lastEntry,
      yourGuess: { title: 'Cats', year: 2019, cast: ['x'] } });
    expect(document.querySelector('.self-elim-outs')).toBeNull();
    expect(document.querySelector('.self-elim-hint')).not.toBeNull();
  });

  test('detail-less ⇒ legacy flash (auto-removing, no card)', () => {
    showSelfEliminationScreen();
    expect(document.querySelector('.self-elim-card')).toBeNull();
    expect(document.querySelector('.self-elim-screen')).not.toBeNull();
  });

  test('XSS: crafted title rendered as text', () => {
    showSelfEliminationScreen({ reason: 'r', lastChainEntry: lastEntry, timedOut: true,
      outs: [{ title: '<img src=x onerror=alert(1)>', year: '2', viaActor: 'Z' }] });
    const row = document.querySelector('.self-elim-outs-row');
    expect(row.querySelector('img')).toBeNull();
    expect(row.textContent).toContain('<img');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest client-tests/self-elim-aftercare.test.js`
Expected: FAIL — no `.self-elim-outs`/`.self-elim-bridge`; timeout payload (no `yourGuess`) currently hits the legacy flash branch.

- [ ] **Step 3: Update the detailed-path guard (line 48)**

Replace:

```js
  if (!details || !details.lastChainEntry || !details.yourGuess) {
```
with (timeout payloads have `lastChainEntry` + `timedOut` but no `yourGuess`):

```js
  // 7.1: a timeout payload has lastChainEntry + timedOut but no yourGuess —
  // it must take the detailed path, not the legacy flash.
  if (!details || !details.lastChainEntry || (!details.yourGuess && !details.timedOut)) {
```

- [ ] **Step 4: Timeout-aware head + conditional "You played" column**

Where `sub.textContent` is set (line 80) and the two columns are appended (lines 114-115), make the head copy timeout-aware and skip the played column when timed out:

```js
  title.textContent = details.timedOut ? "Time's up — you froze" : "You've Been Eliminated";
  sub.textContent = details.reason || (details.timedOut ? 'You ran out of time' : 'Invalid connection');
```
```js
  grid.appendChild(buildColumn('Needed a connection to', details.lastChainEntry, 'self-elim-col--needed'));
  // 7.1: no guess on a timeout — render only the needed column.
  if (!details.timedOut && details.yourGuess) {
    grid.appendChild(buildColumn('You played', details.yourGuess, 'self-elim-col--played'));
  }
```

- [ ] **Step 5: Replace the `.self-elim-could` block with the outs block**

Replace the 6a block (lines 124-130) and its append (lines 154-155) with an outs builder. Replace lines 124-130:

```js
  let outsEl = null;
  if (Array.isArray(details.outs) && details.outs.length) {
    outsEl = document.createElement('div');
    outsEl.className = 'self-elim-outs';
    const lbl = document.createElement('div');
    lbl.className = 'self-elim-outs-label';
    lbl.textContent = 'You had outs:';
    outsEl.appendChild(lbl);
    details.outs.slice(0, 3).forEach(o => {
      const row = document.createElement('div');
      row.className = 'self-elim-outs-row';
      const y = o && o.year ? ` (${o.year})` : '';
      const via = o && o.viaActor ? ` — via ${o.viaActor}` : '';
      // textContent only — titles/actors are TMDB-sourced; no innerHTML.
      row.textContent = `${(o && o.title) || 'Unknown'}${y}${via}`;
      outsEl.appendChild(row);
    });
    const bridge = document.createElement('div');
    bridge.className = 'self-elim-bridge';
    bridge.textContent = 'You were one bridge away.';
    outsEl.appendChild(bridge);
  }
```

Then change the hint so it only shows when there are NO outs (replace lines 132-136):

```js
  // Generic hint is the no-outs fallback only — when we have concrete outs the
  // bridge line above carries the lesson.
  let hint = null;
  if (!outsEl) {
    hint = document.createElement('div');
    hint.className = 'self-elim-hint';
    hint.textContent = 'No actor appears in both casts above. Look for shared names next time.';
  }
```

And update the append section (replace lines 152-158, the `card.appendChild` sequence) to use the new nodes:

```js
  card.appendChild(head);
  card.appendChild(grid);
  if (outsEl) card.appendChild(outsEl);
  if (hint) card.appendChild(hint);
  card.appendChild(close);
  el.appendChild(card);
```

- [ ] **Step 6: Run tests to verify green**

Run: `npx jest client-tests/self-elim-aftercare.test.js client-tests/`
Expected: PASS. Migrate any other `client-tests/` file asserting `.self-elim-could`/`couldHavePlayed` to the `.self-elim-outs` shape; re-run until the whole `client-tests/` project is green.

- [ ] **Step 7: Commit**

```bash
git add public/js/ui/ui-notifications.js client-tests/self-elim-aftercare.test.js client-tests/
git commit -m "Phase 7.1 (3): self-elim outs block + timeout variant

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Final verification (after Task 3, before PR)

- [ ] Full suite green: `npx jest` → all suites/tests pass (expect +4 suites / new tests vs the pre-7.1 baseline; no pre-existing suite regressed).
- [ ] Coverage ratchet holds: `npx jest --coverage` → no threshold-violation lines.
- [ ] Module-load cycle sanity: `node -e "require('./server/gameLogic'); require('./server/systems/matchSystem'); require('./server/systems/botSystem'); console.log('load ok')"` → `load ok`.
- [ ] **Real-boot + in-browser gate (flag to user, do not self-claim):** the suite mocks Redis and never boots; after the user merges, confirm Render `live` (read-only Render MCP) and request the in-browser eyeball of BOTH card variants (invalid: outs list + bridge line; timeout: "Time's up" head, needed-only column, outs). "Merged" ≠ "deployed."
- [ ] Per-task two-stage review (spec-compliance then code-quality) done for each task; final most-capable-model whole-branch holistic review done; any out-of-scope finding → spawn_task chip, not scope creep.

## Optional polish (NOT in scope — spawn_task if worth it)
CSS styling for `.self-elim-outs`/`.self-elim-bridge` beyond inherited card styles is deferred to 7.3 design-system hardening; this task ships them functional and readable using existing card typography.
