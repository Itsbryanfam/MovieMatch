# Bot Opponents (Phase 5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host add beatable, fun AI opponents (Easy/Normal/Hard) to a waiting lobby so a solo visitor or under-filled lobby can play the real competitive elimination game immediately.

**Architecture:** A new `server/systems/botSystem.js` owns bot creation, move *generation* (TMDB person-filmography pathfinding via a new cached `getOrFetchPersonCredits`), and turn *scheduling*. The concurrency-critical commit reuses the existing `matchSystem` pipeline via a new socket-gate-free `submitBotMove` co-located with `submitMovie`. `gameLogic.armTurnTimeout` (the single point every turn becomes active) gets a lazy-required bot hook — mirroring the existing lazy-require cycle-break at `gameLogic.js:528-533`. Bots are normal `room.players[]` entries with `isBot:true` and no socket; existing room-wide broadcasts and the id-based `commitPlay`/`eliminateCurrentPlayer` already handle them.

**Tech Stack:** Node CommonJS, Socket.IO, Redis (node-redis `pubClient`), Jest 30 (server project = node env; `jest.mock('../redisUtils')` + `global.fetch = jest.fn()` pattern from `server/systems/matchSystem.test.js`), TMDB REST.

**Process (validated Phases 1–4 — see memory/feedback_phase_execution_workflow.md):** spec `f5fc5d2` already committed to local `main`. After this plan + `.tasks.json` are committed to local `main`, create branch `phase5a-bot-opponents` off `main` (NOT a worktree, NOT stacked). Native Task tools unavailable → TodoWrite + hand-sync the co-located `.md.tasks.json` (`status:"completed"` + bump `lastUpdated` only after BOTH per-task reviews pass). Per task: implementer (full task text + exact code) → independent spec-compliance review → independent code-quality review → fix-loop until both pass → commit → sync `.tasks.json`. **Every changed line carries a WHY-comment** (memory/feedback_code_comments.md). `coverage/` stays untracked (never `git add`). After all 7 tasks: final opus whole-branch holistic review, then finishing-a-development-branch (push + `gh pr create` base `main`). **PR-merge / push-to-main / Render deploy is classifier-gated and handed to the user — do NOT merge/deploy.** The suite mocks Redis/TMDB and exercises no real boot or browser: **real-boot verification + the required manual human-vs-bot playtest (regular + hardcore; Easy self-destructs often, Normal fair, Hard tough-but-beatable, NO profile unbeatable) are OUTSTANDING until the user merges and Render is checked.** Out-of-scope findings during reviews → session spawn_task chip, do NOT widen scope.

**Model tiering:** Task 0,1 = cheap (mechanical, ≤2 files). Task 2,3,4,5,6 = standard (integration/judgment). Final holistic = opus.

---

## Verified Integration Facts (current `main` @ ac11837 — re-confirm if code moved)

- **8-player cap:** `MAX_PLAYERS_PER_LOBBY` exported from `server/constants.js:19`. `require('../constants')` from `server/systems/*`, `require('./constants')` from `server/`.
- **Submit pipeline** (`server/systems/matchSystem.js`): `submitMovie` (L121); socket-gate at L127-128 + L141-142; `acquireSubmitLock` L134; private helpers `resolveCandidates` (L341), `enrichWithCredits` (L397), `validateChainConnection` (L435), `commitPlay` (L473); `commitPlay` scores by id: `room.players.findIndex(p => p.id === socketId)` L554; `module.exports` L628-632.
- **Credits cache pattern to mirror:** `getOrFetchCredits` `server/redisUtils.js:126-192` — key `credits:v2:{mediaType}:{tmdbId}`, NX stampede lock `${cacheKey}:fetching` `{NX:true,EX:10}`, 7-day TTL `{EX:604800}`, `TMDB_FETCH_TIMEOUT_MS` constant in-file, `AbortSignal.timeout`. `acquireSubmitLock`/`releaseSubmitLock` L204+.
- **Turn loop** (`server/gameLogic.js`): `armTurnTimeout` (L44-72) is THE single point a turn becomes active (called by `nextTurn` L280, `startGame` L732, rejoin, `recoverActiveTurns` L306, `sweepMissingTurnWatchdogs` L333); in-process `activeTurnTimeouts` Map L11; `clearTurnTimeout` L19. `nextTurn` L251-284. `startGame` L623-736 (classic/speed start at **random** index L700 → a bot can be first). `eliminateCurrentPlayer` L161-192 emits **only** room-wide `io.to(id)` (no per-socket emit → eliminating a bot is already crash-safe); calls `checkWinCondition` then `nextTurn`. `validateConnection` exported L764-805. **Lazy-require cycle-break precedent:** `gameLogic.js:528-533` does `const lobbySystem = require('./systems/lobbySystem')` inside a function with a WHY comment — mirror this exactly for the bot hook. `module.exports` L807-836.
- **Win conditions:** `checkClassicWin` `gameLogic.js:563` (`alivePlayers.length===1 && players.length>1` → winner) and `checkSoloWin` L478 work with bots automatically (bots are players with `isAlive`).
- **Socket handlers** (`server/socketHandlers.js`): `ctx = { io, pubClient, TMDB_HEADERS, logger }` L106; `on = (event,h)=>safeOn(...)` L155; `lobbyConfigLimited()` L187-188 (host-config rate bucket); `submitMovie` handler L316-324. `peerTyping`/`submissionRejected`/`youWereEliminated` are submitter-relative — a bot never triggers them.
- **Lobby** (`server/systems/lobbySystem.js`): player object shape L107-110 `{id,name,isHost,isAlive:true,connected:true,score:0,wins,teamId,stableId}`; `kickPlayer` L304-321 (host+waiting gated; already null-checks `if (targetSocket)` L317); `handleDisconnect` L675-739 — host-reassign `room.players[0].isHost=true` L729-731 (would wrongly crown a bot), bot-only ghost gap `if (room.players.length === 0)` L736 (never true with bots present). `withLobbyLock(pubClient, lobbyId, mutatorFn)` is the RMW primitive.
- **Stats safety:** every stats write is guarded by `if (player.stableId)` / `.filter(p => p.stableId)` (e.g. `matchSystem.js:287`, `gameLogic.js:722-724`). Bots get `stableId:null` → automatically excluded from all stats/leaderboard. No extra guards needed.
- **Daily seed pool:** `data/dailyMovies.json` = 553 entries `{id,title,year,mediaType:"movie"}` (Phase 4) — reuse as the bot's first-move pool (valid, popular by construction).
- **Client:** `public/js/ui/ui-render.js` `renderLobby(gameState, myPlayerId)` L30; `amIHost` L31; player list `gameState.players.forEach(p => {...})` L50; host-crown `if (p.isHost) label += ' 👑'` L57; host kick button L63-70 (`getSocket().emit('kickPlayer', { lobbyId: gameState.id, targetId: p.id })`); start-button area ~L119. `getSocket()` imported (see L8 comment). CSS lobby partial: `public/css/02-hero-lobby.css` (append additively only — Phase 4 discipline).
- **Test pattern** (`server/systems/matchSystem.test.js:15-87`): `jest.mock('../redisUtils')`; `global.fetch = jest.fn()`; `mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() }`; `ctx={io,pubClient,TMDB_HEADERS,logger}`; `redisUtils.acquireSubmitLock.mockResolvedValue('token-abc')`; `afterEach(() => gameLogic.clearTurnTimeout('TEST'))`.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `server/redisUtils.js` (modify) | + `getOrFetchPersonCredits` (cached person-filmography), export it | 0 |
| `server/redisUtils.personcredits.test.js` (create) | cache hit/miss/stampede/strip/timeout for the new util | 0 |
| `server/systems/botSystem.js` (create) | `BOT_DIFFICULTIES`, `createBot`, `generateBotMove`, `scheduleBotMove`, `clearBotTimeout`, `activeBotTimeouts` | 1,2,4 |
| `server/systems/botSystem.test.js` (create) | difficulty invariants, move-gen, scheduling/socketless/whiff | 1,2,4 |
| `server/systems/matchSystem.js` (modify) | export 4 helpers; + `submitBotMove` (socket-gate-free commit) | 3 |
| `server/systems/matchSystem.botmove.test.js` (create) | submitBotMove turn-loop integration (1 human + 1 bot) | 3 |
| `server/gameLogic.js` (modify) | lazy-required bot hook at end of `armTurnTimeout` | 4 |
| `server/systems/lobbySystem.js` (modify) | `addBot`/`removeBot`; handleDisconnect host-skip-bot + no-human cleanup | 5 |
| `server/socketHandlers.js` (modify) | `on('addBot')` / `on('removeBot')` (host-config bucket) | 5 |
| `server/systems/lobbySystem.botlifecycle.test.js` (create) | addBot/removeBot validation + ghost-lobby cleanup + host reassignment | 5 |
| `public/js/ui/ui-render.js` (modify) | Add-Bot control + difficulty select + `BOT · <Diff>` label + remove-bot btn + bot-turn "thinking…" | 6 |
| `public/css/02-hero-lobby.css` (modify) | additive `.bot-badge` rule (no existing rule changed) | 6 |

Sequential dependency chain: **0 → 1 → 2 → 3 → 4 → 5 → 6**.

---

### Task 0: Cached TMDB person-filmography lookup (`getOrFetchPersonCredits`)

**Goal:** Add a Redis-cached `getOrFetchPersonCredits(pubClient, personId, headers)` to `server/redisUtils.js`, mirroring `getOrFetchCredits`, returning a person's movie filmography stripped to `{ movies: [{ id, title, year, popularity }] }`.

**Files:**
- Modify: `server/redisUtils.js` (add function after `getOrFetchCredits` which ends L192; add to `module.exports`)
- Test: `server/redisUtils.personcredits.test.js` (create)

**Acceptance Criteria:**
- [ ] `personcredits:v1:{personId}` cache key; NX stampede lock `${cacheKey}:fetching` `{NX:true,EX:10}`; 7-day TTL `{EX:604800}`
- [ ] TMDB `GET https://api.themoviedb.org/3/person/{personId}/movie_credits?language=en-US` with `AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS)`
- [ ] On `!response.ok`: drains body, throws (mirrors `getOrFetchCredits`)
- [ ] Strips to `{ movies: [{ id, title, year, popularity }] }` — `year` = `release_date.split('-')[0]` or `''`; skips entries without `id` or `title`
- [ ] Cache-hit fast path; stampede 250ms-wait-retry path; exported from `module.exports`
- [ ] `npx jest server/redisUtils.personcredits.test.js` PASS; `npm test` green; coverage floors hold

**Verify:** `npx jest server/redisUtils.personcredits.test.js` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — create `server/redisUtils.personcredits.test.js`:

```js
// ============================================================================
// redisUtils.personcredits.test.js — getOrFetchPersonCredits (Phase 5a bots)
// ============================================================================
// WHY: the bot move generator depends on this cache behaving exactly like
// getOrFetchCredits (cache-first, stampede-locked, stripped payload, 7d TTL).
// A regression here would either hammer TMDB on every bot turn or feed the
// generator malformed filmographies.
// ============================================================================
const redisUtils = require('./redisUtils');

global.fetch = jest.fn();

function mockPubClient() {
  const store = new Map();
  return {
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async (k) => { store.delete(k); return 1; }),
    _store: store,
  };
}
const HEADERS = { Authorization: 'Bearer test', accept: 'application/json' };

beforeEach(() => { jest.clearAllMocks(); });

test('fetches, strips, and caches on miss (7-day TTL)', async () => {
  const pub = mockPubClient();
  // NX lock claim returns OK (no other fetcher), cache miss first.
  pub.set.mockImplementation(async (k, v, opts) => { pub._store.set(k, v); return 'OK'; });
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      cast: [
        { id: 1, title: 'Alpha', release_date: '1999-05-01', popularity: 42.5 },
        { id: 2, title: 'Beta', release_date: '', popularity: 3.1 },
        { id: null, title: 'NoId', release_date: '2000-01-01', popularity: 9 }, // skipped
        { id: 3, release_date: '2001-01-01', popularity: 9 }, // no title → skipped
      ],
    }),
  });
  const res = await redisUtils.getOrFetchPersonCredits(pub, 555, HEADERS);
  expect(res).toEqual({ movies: [
    { id: 1, title: 'Alpha', year: '1999', popularity: 42.5 },
    { id: 2, title: 'Beta', year: '', popularity: 3.1 },
  ]});
  expect(global.fetch).toHaveBeenCalledWith(
    'https://api.themoviedb.org/3/person/555/movie_credits?language=en-US',
    expect.objectContaining({ headers: HEADERS })
  );
  // Cached under the versioned key with a 7-day EX.
  const setCall = pub.set.mock.calls.find(c => c[0] === 'personcredits:v1:555');
  expect(setCall[2]).toEqual({ EX: 604800 });
});

test('returns cached value without fetching on hit', async () => {
  const pub = mockPubClient();
  pub._store.set('personcredits:v1:7', JSON.stringify({ movies: [{ id: 9, title: 'C', year: '2010', popularity: 1 }] }));
  const res = await redisUtils.getOrFetchPersonCredits(pub, 7, HEADERS);
  expect(res).toEqual({ movies: [{ id: 9, title: 'C', year: '2010', popularity: 1 }] });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('throws on non-ok TMDB response (after draining body)', async () => {
  const pub = mockPubClient();
  const arrayBuffer = jest.fn(async () => {});
  global.fetch.mockResolvedValue({ ok: false, status: 503, arrayBuffer });
  await expect(redisUtils.getOrFetchPersonCredits(pub, 8, HEADERS)).rejects.toThrow(/TMDB person credits failed: 503/);
  expect(arrayBuffer).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest server/redisUtils.personcredits.test.js`
Expected: FAIL — `redisUtils.getOrFetchPersonCredits is not a function`

- [ ] **Step 3: Implement** — in `server/redisUtils.js`, immediately AFTER `getOrFetchCredits` (which ends at L192, the `}` closing the function) and BEFORE the `SUBMIT_LOCK_RELEASE_SCRIPT` comment (L194), insert:

```js
// PERSON-CREDITS CACHE VERSION — bump on payload-shape change (same rationale
// as CREDITS_CACHE_VERSION). v1 — { movies: [{ id, title, year, popularity }] }.
const PERSON_CREDITS_CACHE_VERSION = 'v1';

/**
 * Phase 5a (bots): get a person's movie filmography from Redis cache or
 * fetch+cache from TMDB for 7 days. Structurally identical to
 * getOrFetchCredits (cache-first, NX stampede lock, drained-body throw on
 * non-ok) so the bot move generator can rely on the same guarantees the
 * submit pipeline already trusts. WHY a dedicated key/version: the payload
 * shape (movie list, not cast list) differs from credits, so sharing a key
 * would cross-contaminate two different schemas.
 */
async function getOrFetchPersonCredits(pubClient, personId, headers) {
  const cacheKey = `personcredits:${PERSON_CREDITS_CACHE_VERSION}:${personId}`;
  // 10s lock expiry > the 5s TMDB timeout so the lock can't outlive a stuck
  // fetch — same invariant as getOrFetchCredits.
  const lockKey = `${cacheKey}:fetching`;

  const cached = await pubClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // NX claim: only one worker fetches an uncached person; the rest wait+retry
  // the cache. Without it, a busy bot turn could fan out duplicate TMDB calls.
  const gotLock = await pubClient.set(lockKey, '1', { NX: true, EX: 10 });
  if (!gotLock) {
    await new Promise(r => setTimeout(r, 250));
    const retry = await pubClient.get(cacheKey);
    if (retry) return JSON.parse(retry);
    // Fall through and fetch ourselves rather than hang the bot's turn.
  }

  try {
    const url = `https://api.themoviedb.org/3/person/${personId}/movie_credits?language=en-US`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      // Drain the body so the connection returns to the pool before we throw
      // (identical to getOrFetchCredits' non-ok handling).
      await response.arrayBuffer();
      throw new Error(`TMDB person credits failed: ${response.status}`);
    }
    const raw = await response.json();
    // Strip to the minimum the bot needs: a movie id (to submit by direct
    // ID), a title (display/debug), a year (tie-break/recency), and
    // popularity (the difficulty popularity-floor lever). Skip malformed
    // entries (obscure people occasionally have id-less credit rows).
    const stripped = {
      movies: (raw.cast || [])
        .filter(m => m && m.id != null && m.title)
        .map(m => ({
          id: m.id,
          title: m.title,
          year: (m.release_date || '').split('-')[0] || '',
          popularity: typeof m.popularity === 'number' ? m.popularity : 0,
        })),
    };
    await pubClient.set(cacheKey, JSON.stringify(stripped), { EX: 604800 }); // 7 days
    return stripped;
  } finally {
    if (gotLock) await pubClient.del(lockKey).catch(() => {});
  }
}
```

Then add `getOrFetchPersonCredits` to `module.exports` (the existing export object near the end of `server/redisUtils.js`; add the key alongside `getOrFetchCredits`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest server/redisUtils.personcredits.test.js` → Expected: PASS (3 tests)
Run: `npm test` → Expected: all green, coverage floors hold

- [ ] **Step 5: Commit**

```bash
git add server/redisUtils.js server/redisUtils.personcredits.test.js
git commit -m "Phase 5a (0): cached TMDB person-filmography lookup (getOrFetchPersonCredits)"
```

---

### Task 1: `BOT_DIFFICULTIES` table + `createBot` factory

**Goal:** Create `server/systems/botSystem.js` with the difficulty parameter table (strict `0<whiff<1`, monotonic) and a `createBot` factory producing a socketless `room.players[]` entry.

**Files:**
- Create: `server/systems/botSystem.js`
- Test: `server/systems/botSystem.test.js` (create — difficulty + factory only this task)

**Acceptance Criteria:**
- [ ] `BOT_DIFFICULTIES` has exactly `easy`,`normal`,`hard`, each `{ whiff, delayMinMs, delayMaxMs, popularityFloor, retryCap }`
- [ ] For every profile `0 < whiff < 1`; `easy.whiff > normal.whiff > hard.whiff`; each `delayMinMs < delayMaxMs`; `retryCap >= 1` integer
- [ ] `createBot(existingPlayers, difficulty)` → `{ id, name, isBot:true, isAlive:true, connected:true, score:0, wins:0, teamId, difficulty, stableId:null }`; `id` unique vs `existingPlayers` (`bot_` + smallest free positive int among existing `bot_<n>` ids); `name` a distinct themed name; invalid/missing `difficulty` → `'normal'`; `teamId = existingPlayers.length % 2` (mirrors join L105)
- [ ] `npx jest server/systems/botSystem.test.js` PASS; `npm test` green; coverage floors hold

**Verify:** `npx jest server/systems/botSystem.test.js` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — create `server/systems/botSystem.test.js`:

```js
// ============================================================================
// botSystem.test.js — Phase 5a bot opponents
// ============================================================================
const botSystem = require('./botSystem');

describe('BOT_DIFFICULTIES invariants', () => {
  const profiles = botSystem.BOT_DIFFICULTIES;

  test('has exactly easy/normal/hard', () => {
    expect(Object.keys(profiles).sort()).toEqual(['easy', 'hard', 'normal']);
  });

  test('every profile has a strictly-beatable whiff (0 < whiff < 1)', () => {
    // WHY: this is THE "bot is never unbeatable" invariant from the spec.
    for (const [name, p] of Object.entries(profiles)) {
      expect(p.whiff).toBeGreaterThan(0);
      expect(p.whiff).toBeLessThan(1);
    }
  });

  test('whiff is monotonic easy > normal > hard', () => {
    expect(profiles.easy.whiff).toBeGreaterThan(profiles.normal.whiff);
    expect(profiles.normal.whiff).toBeGreaterThan(profiles.hard.whiff);
  });

  test('each profile has a valid delay window and retry cap', () => {
    for (const p of Object.values(profiles)) {
      expect(p.delayMinMs).toBeLessThan(p.delayMaxMs);
      expect(Number.isInteger(p.retryCap)).toBe(true);
      expect(p.retryCap).toBeGreaterThanOrEqual(1);
      expect(typeof p.popularityFloor).toBe('number');
    }
  });
});

describe('createBot', () => {
  test('produces a socketless player entry with stableId null', () => {
    const bot = botSystem.createBot([], 'hard');
    expect(bot).toMatchObject({
      isBot: true, isAlive: true, connected: true, score: 0, wins: 0,
      difficulty: 'hard', stableId: null, teamId: 0,
    });
    expect(bot.id).toMatch(/^bot_\d+$/);
    expect(typeof bot.name).toBe('string');
    expect(bot.name.length).toBeGreaterThan(0);
    expect(bot.isHost).toBeFalsy();
  });

  test('defaults invalid/missing difficulty to normal', () => {
    expect(botSystem.createBot([], 'banana').difficulty).toBe('normal');
    expect(botSystem.createBot([], undefined).difficulty).toBe('normal');
  });

  test('id and name are unique vs existing players/bots', () => {
    const existing = [
      { id: 'sock-1', name: 'Human', isBot: false },
      botSystem.createBot([], 'easy'), // bot_1
    ];
    const b2 = botSystem.createBot(existing, 'normal');
    expect(b2.id).toBe('bot_2');
    expect(existing.map(p => p.name)).not.toContain(b2.name);
  });

  test('teamId mirrors join order parity', () => {
    expect(botSystem.createBot([{ id: 'a' }], 'easy').teamId).toBe(1);
    expect(botSystem.createBot([{ id: 'a' }, { id: 'b' }], 'easy').teamId).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest server/systems/botSystem.test.js`
Expected: FAIL — `Cannot find module './botSystem'`

- [ ] **Step 3: Implement** — create `server/systems/botSystem.js`:

```js
// ============================================================================
// botSystem.js — Phase 5a: bot opponents (cold-start fix)
// ============================================================================
// Owns: difficulty profiles, bot-player creation, move GENERATION (TMDB
// person-filmography pathfinding), and turn SCHEDULING. The concurrency-
// critical COMMIT is delegated to matchSystem.submitBotMove so the submit
// lock orchestration stays in one reviewed place. A bot is a normal
// room.players[] entry with isBot:true and no socket.
// ============================================================================

// Difficulty = a named parameter set the move generator reads. NOT branching
// code paths — just a profile object. WHY each knob:
//   whiff          — per-turn probability the bot "blanks" even when a move
//                    exists. THE beatability lever. INVARIANT: 0 < whiff < 1
//                    for every profile (incl. hard) so no difficulty is ever
//                    an unbeatable perfect-recall bot. Monotonic e>n>h.
//   delayMin/MaxMs — "thinking" delay window; realistic pacing, kept under
//                    the turn timer so a non-whiff move lands in time.
//   popularityFloor— TMDB movie popularity a pick must clear; higher = more
//                    mainstream/recognizable (easier human follow).
//   retryCap       — how many actor/candidate attempts before whiffing;
//                    bounded so the bot never loops to a perfect move.
// Starting values are tuning targets validated by the manual playtest gate.
const BOT_DIFFICULTIES = {
  easy:   { whiff: 0.45, delayMinMs: 4000, delayMaxMs: 9000, popularityFloor: 20, retryCap: 1 },
  normal: { whiff: 0.25, delayMinMs: 3000, delayMaxMs: 7000, popularityFloor: 10, retryCap: 2 },
  hard:   { whiff: 0.09, delayMinMs: 2000, delayMaxMs: 5000, popularityFloor: 4,  retryCap: 3 },
};

// Themed names so a bot is always visibly a bot (paired with a UI "BOT"
// badge). 8 names ≥ the 8-player cap, so a lobby can never exhaust them.
const BOT_NAMES = [
  'Bot Bogart', 'Bot Kubrick', 'Bot Hitchcock', 'Bot Kurosawa',
  'Bot Coppola', 'Bot Spielberg', 'Bot Scorsese', 'Bot Tarantino',
];

// Smallest free positive integer N such that `bot_N` is not already an id in
// the lobby. WHY not a timestamp/random: tests need determinism and a small
// stable id reads well in logs; collisions across remove/re-add are avoided
// by scanning existing ids rather than using a monotonic counter (which would
// drift if a bot is removed then another added).
function _nextBotIndex(existingPlayers) {
  const used = new Set(
    (existingPlayers || [])
      .map(p => /^bot_(\d+)$/.exec(p && p.id))
      .filter(Boolean)
      .map(m => Number(m[1]))
  );
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

function createBot(existingPlayers, difficulty) {
  const players = existingPlayers || [];
  // Invalid/missing difficulty falls back to normal so a buggy client can
  // never inject an unknown profile (move generator would read undefined).
  const diff = BOT_DIFFICULTIES[difficulty] ? difficulty : 'normal';
  const n = _nextBotIndex(players);
  // Pick a themed name not already taken in this lobby; cycle with a numeric
  // suffix if (improbably) all 8 base names are in use.
  const taken = new Set(players.map(p => p && p.name));
  let name = BOT_NAMES[(n - 1) % BOT_NAMES.length];
  if (taken.has(name)) name = `${name} ${n}`;
  return {
    id: `bot_${n}`,
    name,
    isHost: false,        // a bot is NEVER host (host = settings/start authority)
    isBot: true,          // discriminator used everywhere (lifecycle, hooks, UI)
    isAlive: true,
    connected: true,      // keeps existing connected-filters treating it as present
    score: 0,
    wins: 0,
    teamId: players.length % 2, // mirrors human join parity (lobbySystem L105)
    difficulty: diff,
    stableId: null,       // no identity → auto-excluded from all stats writes
  };
}

module.exports = { BOT_DIFFICULTIES, BOT_NAMES, createBot };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest server/systems/botSystem.test.js` → Expected: PASS
Run: `npm test` → Expected: all green, coverage floors hold

- [ ] **Step 5: Commit**

```bash
git add server/systems/botSystem.js server/systems/botSystem.test.js
git commit -m "Phase 5a (1): BOT_DIFFICULTIES table (0<whiff<1 invariant) + createBot factory"
```

---

### Task 2: `generateBotMove` (TMDB person-filmography pathfinding, injectable RNG)

**Goal:** Add `generateBotMove(room, profile, deps)` to `botSystem.js`: deterministic-with-injected-RNG selection of a valid, unused, popularity-floored, hardcore-honoring movie (or `null` on whiff / no move / first-move-seed-empty).

**Files:**
- Modify: `server/systems/botSystem.js` (add `generateBotMove` + export)
- Modify: `server/systems/botSystem.test.js` (add `describe('generateBotMove')`)

**Acceptance Criteria:**
- [ ] Signature `generateBotMove(room, profile, deps)` where `deps = { pubClient, headers, rng, getOrFetchPersonCredits, dailySeed }`; `rng()` ∈ [0,1)
- [ ] `rng() < profile.whiff` → returns `null` (deliberate whiff) BEFORE any TMDB call
- [ ] Empty chain (bot first move) → `{ tmdbId, mediaType:'movie' }` from a random `deps.dailySeed` entry; empty seed → `null`
- [ ] Non-empty chain → reads `room.chain[last].movie.cast`, iterates actors **with an `id`** (up to `profile.retryCap` actors), fetches `getOrFetchPersonCredits`, filters: not in `room.usedMovies` as `movie:{id}`, `popularity >= profile.popularityFloor`, `id !== lastMovieId`; hardcore → skips actors already in `room.previousSharedActors`; returns first qualifying `{ tmdbId, mediaType:'movie' }`
- [ ] No qualifying move within `retryCap` → `null`; a `getOrFetchPersonCredits` throw is swallowed (try next actor), exhaustion → `null`
- [ ] `npx jest server/systems/botSystem.test.js` PASS; `npm test` green; coverage floors hold

**Verify:** `npx jest server/systems/botSystem.test.js` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — append to `server/systems/botSystem.test.js`:

```js
describe('generateBotMove', () => {
  const profile = { whiff: 0.25, delayMinMs: 1, delayMaxMs: 2, popularityFloor: 10, retryCap: 2 };
  const baseDeps = (over = {}) => ({
    pubClient: {},
    headers: {},
    rng: () => 0.99, // > whiff → never a deliberate whiff unless overridden
    getOrFetchPersonCredits: jest.fn(),
    dailySeed: [{ id: 100, title: 'Seed', year: '2020', mediaType: 'movie' }],
    ...over,
  });

  test('returns null on a deliberate whiff (rng < whiff) without any TMDB call', async () => {
    const deps = baseDeps({ rng: () => 0.01 });
    const room = { chain: [{ movie: { cast: [{ id: 1, name: 'A' }] } }], usedMovies: [], previousSharedActors: [], hardcoreMode: false };
    expect(await botSystem.generateBotMove(room, profile, deps)).toBeNull();
    expect(deps.getOrFetchPersonCredits).not.toHaveBeenCalled();
  });

  test('first move (empty chain) picks from dailySeed', async () => {
    const deps = baseDeps();
    const room = { chain: [], usedMovies: [], previousSharedActors: [], hardcoreMode: false };
    expect(await botSystem.generateBotMove(room, profile, deps)).toEqual({ tmdbId: 100, mediaType: 'movie' });
  });

  test('empty dailySeed on first move → null', async () => {
    const deps = baseDeps({ dailySeed: [] });
    const room = { chain: [], usedMovies: [], previousSharedActors: [], hardcoreMode: false };
    expect(await botSystem.generateBotMove(room, profile, deps)).toBeNull();
  });

  test('picks an unused, popularity-floored film via a cast actor', async () => {
    const deps = baseDeps();
    deps.getOrFetchPersonCredits.mockResolvedValue({ movies: [
      { id: 7, title: 'TooObscure', year: '1990', popularity: 2 },   // below floor
      { id: 8, title: 'Used', year: '1991', popularity: 50 },         // used
      { id: 9, title: 'Good', year: '1992', popularity: 30 },         // ✓
    ]});
    const room = {
      chain: [{ movie: { id: 1, cast: [{ id: 42, name: 'Actor' }] } }],
      usedMovies: ['movie:1', 'movie:8'], previousSharedActors: [], hardcoreMode: false,
    };
    expect(await botSystem.generateBotMove(room, profile, deps)).toEqual({ tmdbId: 9, mediaType: 'movie' });
    expect(deps.getOrFetchPersonCredits).toHaveBeenCalledWith(deps.pubClient, 42, deps.headers);
  });

  test('hardcore: skips actors already in previousSharedActors', async () => {
    const deps = baseDeps();
    deps.getOrFetchPersonCredits.mockResolvedValue({ movies: [{ id: 9, title: 'G', year: '1', popularity: 99 }] });
    const room = {
      chain: [{ movie: { id: 1, cast: [{ id: 42, name: 'Used' }, { id: 43, name: 'Fresh' }] } }],
      usedMovies: ['movie:1'], previousSharedActors: [{ id: 42, name: 'Used' }], hardcoreMode: true,
    };
    await botSystem.generateBotMove(room, profile, deps);
    // Actor 42 is locked → only actor 43 is queried.
    expect(deps.getOrFetchPersonCredits).toHaveBeenCalledWith(deps.pubClient, 43, deps.headers);
    expect(deps.getOrFetchPersonCredits).not.toHaveBeenCalledWith(deps.pubClient, 42, deps.headers);
  });

  test('returns null when no actor yields a qualifying film within retryCap', async () => {
    const deps = baseDeps();
    deps.getOrFetchPersonCredits.mockResolvedValue({ movies: [{ id: 8, title: 'Used', year: '1', popularity: 99 }] });
    const room = {
      chain: [{ movie: { id: 1, cast: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }] } }],
      usedMovies: ['movie:1', 'movie:8'], previousSharedActors: [], hardcoreMode: false,
    };
    expect(await botSystem.generateBotMove(room, profile, deps)).toBeNull();
  });

  test('swallows a getOrFetchPersonCredits throw and tries the next actor', async () => {
    const deps = baseDeps();
    deps.getOrFetchPersonCredits
      .mockRejectedValueOnce(new Error('TMDB down'))
      .mockResolvedValueOnce({ movies: [{ id: 9, title: 'G', year: '1', popularity: 99 }] });
    const room = {
      chain: [{ movie: { id: 1, cast: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] } }],
      usedMovies: ['movie:1'], previousSharedActors: [], hardcoreMode: false,
    };
    expect(await botSystem.generateBotMove(room, profile, deps)).toEqual({ tmdbId: 9, mediaType: 'movie' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest server/systems/botSystem.test.js`
Expected: FAIL — `botSystem.generateBotMove is not a function`

- [ ] **Step 3: Implement** — in `server/systems/botSystem.js`, add before `module.exports` and add `generateBotMove` to exports:

```js
// Deterministic shuffle driven by the injected rng so tests can force an
// order. Fisher–Yates; rng() ∈ [0,1).
function _shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Same person-equality rule the engine uses (gameLogic._sameActor): prefer
// id-equality, fall back to lowercase name. Local copy keeps botSystem from
// depending on a gameLogic internal (it isn't exported).
function _sameActor(a, b) {
  if (a && b && a.id != null && b.id != null) return a.id === b.id;
  if (!a || !b || !a.name || !b.name) return false;
  return a.name.toLowerCase() === b.name.toLowerCase();
}

/**
 * Decide the bot's move. Returns { tmdbId, mediaType:'movie' } or null.
 * null means "no move" — the caller (scheduleBotMove) turns that into a
 * graceful elimination via the existing engine path. Validity is by
 * construction (the chosen actor is in both the last film and the pick), so
 * the existing submit pipeline will accept it; we still pre-filter
 * used/hardcore so we don't propose a move the engine would reject.
 *
 * deps = { pubClient, headers, rng, getOrFetchPersonCredits, dailySeed }
 */
async function generateBotMove(room, profile, deps) {
  const { pubClient, headers, rng, getOrFetchPersonCredits, dailySeed } = deps;

  // Primary beatability lever: a deliberate per-turn blank. Checked before
  // any TMDB work so a whiff is cheap and the bot is genuinely beatable.
  if (rng() < profile.whiff) return null;

  const chain = room.chain || [];
  // First move: no connection constraint (the engine accepts any first
  // movie). Reuse the curated daily pool — valid, popular by construction,
  // zero new data. Empty pool → null (caller eliminates; never fabricate).
  if (chain.length === 0) {
    const seed = dailySeed || [];
    if (seed.length === 0) return null;
    const pick = seed[Math.floor(rng() * seed.length)];
    return { tmdbId: pick.id, mediaType: 'movie' };
  }

  const lastNode = chain[chain.length - 1];
  const lastMovieId = lastNode && lastNode.movie ? lastNode.movie.id : null;
  const lastCast = (lastNode && lastNode.movie && lastNode.movie.cast) || [];
  const used = new Set(room.usedMovies || []);
  const prevConnectors = room.previousSharedActors || [];

  // Only actors with a TMDB id are queryable (person-credits needs an id);
  // in hardcore, an actor already used as a connector anywhere in the chain
  // is locked out, so picking via them would be rejected — skip up front.
  let actors = lastCast.filter(a => a && a.id != null);
  if (room.hardcoreMode) {
    actors = actors.filter(a => !prevConnectors.some(p => _sameActor(p, a)));
  }
  actors = _shuffled(actors, rng).slice(0, Math.max(1, profile.retryCap));

  for (const actor of actors) {
    let credits;
    try {
      credits = await getOrFetchPersonCredits(pubClient, actor.id, headers);
    } catch (e) {
      // TMDB blip on this actor — try the next one rather than whiff the
      // whole turn (graceful degradation; 5b's fallback DB will harden this).
      continue;
    }
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
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest server/systems/botSystem.test.js` → Expected: PASS
Run: `npm test` → Expected: all green, coverage floors hold

- [ ] **Step 5: Commit**

```bash
git add server/systems/botSystem.js server/systems/botSystem.test.js
git commit -m "Phase 5a (2): generateBotMove — person-filmography pathfinding (injectable RNG)"
```

---

### Task 3: `submitBotMove` — socket-gate-free commit reusing the matchSystem pipeline

**Goal:** Export `resolveCandidates`/`enrichWithCredits`/`validateChainConnection`/`commitPlay` from `matchSystem.js` and add a co-located `submitBotMove(ctx, lobbyId, botId, chosenMove)` that runs the identical lock→resolve→enrich→validate→commit→nextTurn pipeline, identifying the player by `botId`, with no socket emits, and graceful elimination on miss.

**Files:**
- Modify: `server/systems/matchSystem.js` (add `submitBotMove` after `forceNextTurn` L626; extend `module.exports` L628-632)
- Test: `server/systems/matchSystem.botmove.test.js` (create)

**Acceptance Criteria:**
- [ ] `module.exports` adds `resolveCandidates, enrichWithCredits, validateChainConnection, commitPlay, submitBotMove`
- [ ] `submitBotMove(ctx, lobbyId, botId, { tmdbId, mediaType })`: pre-lock reject if not playing / isValidating / bot not current turn / bot not alive; `acquireSubmitLock`; re-read; sets/clears `isValidating`; `resolveCandidates(room, null, tmdbId, mediaType, TMDB_HEADERS)` (direct-ID path); `enrichWithCredits`; `validateChainConnection`; on no candidates OR no match OR thrown error → `gameLogic.eliminateCurrentPlayer(io,pubClient,lobbyId,room,"Bot couldn't find a move")` (room-wide only, no socket emit); on match → `commitPlay(room, botId, botPlayer, match, matchedActors, matchedActorObjects)`, `gameLogic.settlePredictions(io,lobbyId,room,'yes')`, `gameLogic.nextTurn`; releases lock in `finally`
- [ ] No `socket.emit`, no `submissionRejected`/`youWereEliminated`, no typo-retry budget anywhere in `submitBotMove`
- [ ] Integration: 1 human + 1 bot room — `submitBotMove` with a connecting movie grows `room.chain` by 1, bot `score += 100`, `usedMovies` gains `movie:{id}`, `nextTurn` advances; with a non-connecting movie → `eliminateCurrentPlayer` path, no throw on the socketless bot
- [ ] `npx jest server/systems/matchSystem.botmove.test.js` PASS; `npm test` green; coverage floors hold

**Verify:** `npx jest server/systems/matchSystem.botmove.test.js` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — create `server/systems/matchSystem.botmove.test.js`:

```js
// ============================================================================
// matchSystem.botmove.test.js — Phase 5a submitBotMove (socketless commit)
// ============================================================================
const matchSystem = require('./matchSystem');
const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');

jest.mock('../redisUtils');
global.fetch = jest.fn();

function buildRoom(over = {}) {
  return {
    id: 'TEST', status: 'playing', isValidating: false, gameMode: 'classic',
    players: [
      { id: 'sock-1', name: 'Human', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1' },
      { id: 'bot_1', name: 'Bot Bogart', isHost: false, isBot: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, difficulty: 'normal', stableId: null },
    ],
    spectators: [], chain: [{ playerId: 'sock-1', playerName: 'Human', movie: { id: 1, title: 'First', year: '2000', cast: [{ id: 42, name: 'Shared' }], mediaType: 'movie' }, matchedActors: [] }],
    usedMovies: ['movie:1'], hardcoreMode: false, previousSharedActors: [],
    allowTvShows: false, isPublic: false, timerMultiplier: 0,
    turnExpiresAt: Date.now() + 60000, currentTurnIndex: 1, currentTurnRetries: 0,
    ...over,
  };
}
let mockIo, ctx, logger;
beforeEach(() => {
  jest.clearAllMocks();
  mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
  logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
  ctx = { io: mockIo, pubClient: {}, TMDB_HEADERS: { Authorization: 'Bearer test', accept: 'application/json' }, logger };
  redisUtils.acquireSubmitLock.mockResolvedValue('token-bot');
  redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
  redisUtils.saveLobby.mockResolvedValue(undefined);
});
afterEach(() => gameLogic.clearTurnTimeout('TEST'));

test('connecting bot move grows chain, scores bot, advances turn', async () => {
  const room = buildRoom();
  redisUtils.getLobby.mockResolvedValue(room);
  // resolveCandidates direct-ID path → details fetch; then getOrFetchCredits.
  global.fetch.mockResolvedValueOnce({ json: async () => ({ id: 2, title: 'Second', release_date: '2005-01-01' }) });
  redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 42, name: 'Shared' }, { id: 7, name: 'Other' }] });

  await matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 2, mediaType: 'movie' });

  expect(room.chain).toHaveLength(2);
  expect(room.chain[1].playerId).toBe('bot_1');
  expect(room.usedMovies).toContain('movie:2');
  expect(room.players.find(p => p.id === 'bot_1').score).toBe(100);
});

test('non-connecting bot move eliminates the bot (no throw, no socket emit)', async () => {
  const room = buildRoom();
  redisUtils.getLobby.mockResolvedValue(room);
  global.fetch.mockResolvedValueOnce({ json: async () => ({ id: 99, title: 'Unrelated', release_date: '2010-01-01' }) });
  redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 999, name: 'Nobody In Common' }] });

  await expect(matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 99, mediaType: 'movie' })).resolves.not.toThrow();
  expect(room.players.find(p => p.id === 'bot_1').isAlive).toBe(false);
});

test('no-op when it is not the bot’s turn', async () => {
  const room = buildRoom({ currentTurnIndex: 0 }); // human's turn
  redisUtils.getLobby.mockResolvedValue(room);
  await matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 2, mediaType: 'movie' });
  expect(room.chain).toHaveLength(1);
  expect(redisUtils.acquireSubmitLock).not.toHaveBeenCalled();
});

test('exports the reusable pipeline helpers', () => {
  for (const fn of ['resolveCandidates', 'enrichWithCredits', 'validateChainConnection', 'commitPlay', 'submitBotMove']) {
    expect(typeof matchSystem[fn]).toBe('function');
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest server/systems/matchSystem.botmove.test.js`
Expected: FAIL — `matchSystem.submitBotMove is not a function`

- [ ] **Step 3: Implement** — in `server/systems/matchSystem.js`:

(3a) Replace the `module.exports` block at L628-632:

```js
module.exports = {
  autocompleteSearch,
  submitMovie,
  forceNextTurn,
  // Phase 5a: the bot commit reuses the EXACT same pipeline as submitMovie.
  // Exported so submitBotMove (and only it) can drive them without a socket.
  resolveCandidates,
  enrichWithCredits,
  validateChainConnection,
  commitPlay,
  submitBotMove,
};
```

(3b) Insert `submitBotMove` immediately AFTER `forceNextTurn` (which ends L626) and BEFORE `module.exports`:

```js
// ---------------------------------------------------------------------------
// SUBMIT BOT MOVE (Phase 5a) — the socket-free twin of submitMovie
// ---------------------------------------------------------------------------
// A bot has no socket, so it cannot reuse submitMovie (which gates on
// socket.id and emits private rejection payloads to the submitting socket).
// This runs the IDENTICAL lock→resolve→enrich→validate→commit→nextTurn
// pipeline, but: identifies the player by botId, never emits to a socket,
// skips the human typo-retry budget (the bot submits a concrete TMDB id),
// and on ANY miss/error gracefully eliminates the bot via the existing
// engine path (room-wide notification only — eliminateCurrentPlayer does no
// per-socket emit, so a socketless bot is safe). Kept here, beside
// submitMovie, so the submit-lock orchestration lives in one reviewed place.
async function submitBotMove(ctx, lobbyId, botId, chosenMove) {
  const { io, pubClient, TMDB_HEADERS, logger } = ctx;
  const { tmdbId, mediaType } = chosenMove || {};

  // Pre-lock quick reject (mirror submitMovie L124-128 but by botId).
  let room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room || room.status !== 'playing' || room.isValidating || tmdbId == null) return;
  const pre = room.players.find(p => p.id === botId);
  if (!pre || !pre.isAlive || room.players[room.currentTurnIndex].id !== botId) return;

  const lockToken = await redisUtils.acquireSubmitLock(pubClient, lobbyId);
  if (!lockToken) return;

  try {
    room = await redisUtils.getLobby(pubClient, lobbyId);
    if (!room || room.status !== 'playing' || room.isValidating) return;
    const botPlayer = room.players.find(p => p.id === botId);
    if (!botPlayer || !botPlayer.isAlive || room.players[room.currentTurnIndex].id !== botId) return;

    room.isValidating = true;
    await redisUtils.saveLobby(pubClient, lobbyId, room);

    try {
      // movie arg is null — the bot always submits a concrete TMDB id, so
      // resolveCandidates takes its validated direct-ID branch (no fuzzy
      // search, no typo budget). _validatedDirectLookup still whitelists it.
      const topCandidates = await resolveCandidates(room, null, tmdbId, mediaType, TMDB_HEADERS);
      if (topCandidates.length === 0) {
        // Couldn't resolve the bot's own pick (rare: TMDB blip). Treat like a
        // human who ran out of moves — graceful, fair, game continues.
        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Bot couldn't find a move");
        return;
      }

      const candidateMovies = await enrichWithCredits(topCandidates, pubClient, TMDB_HEADERS, logger);

      room = await redisUtils.getLobby(pubClient, lobbyId);
      if (room.status !== 'playing' || room.players[room.currentTurnIndex].id !== botId) {
        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        return;
      }

      const result = validateChainConnection(room, candidateMovies);
      if (!result.match) {
        // A correctly-generated move connects by construction; reaching here
        // means a stale/edge pick. Broadcast the failed attempt (room-wide,
        // bot-safe) then eliminate the bot — no private socket payload.
        const triedTitle = candidateMovies[0]?.title || 'Unknown';
        io.to(lobbyId).emit('attemptFailed', { playerName: botPlayer.name, movieTitle: triedTitle, reason: result.reason });
        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, result.reason);
        return;
      }

      // Identical commit path to submitMovie. commitPlay scores by id
      // (room.players.findIndex(p => p.id === botId)) so the bot id works.
      commitPlay(room, botId, botPlayer, result.match, result.matchedActors, result.matchedActorObjects);
      // Spectator-prediction settle ('yes' = play succeeded), same as submitMovie.
      gameLogic.settlePredictions(io, lobbyId, room, 'yes');
      room.isValidating = false;
      await gameLogic.nextTurn(io, pubClient, lobbyId, room);
    } catch (err) {
      // Same shape as submitMovie's catch: clear the flag, then eliminate
      // (room-wide reason only). No socket to notify.
      room = await redisUtils.getLobby(pubClient, lobbyId);
      room.isValidating = false;
      await redisUtils.saveLobby(pubClient, lobbyId, room);
      await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Bot couldn't find a move");
    }
  } finally {
    await redisUtils.releaseSubmitLock(pubClient, lobbyId, lockToken).catch(() => {});
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest server/systems/matchSystem.botmove.test.js` → Expected: PASS (4 tests)
Run: `npx jest server/systems/matchSystem.test.js` → Expected: PASS (unchanged — submitMovie untouched)
Run: `npm test` → Expected: all green, coverage floors hold

- [ ] **Step 5: Commit**

```bash
git add server/systems/matchSystem.js server/systems/matchSystem.botmove.test.js
git commit -m "Phase 5a (3): submitBotMove — socket-free commit reusing the submitMovie pipeline"
```

---

### Task 4: Bot turn-hook — `scheduleBotMove`/`clearBotTimeout` + lazy-required hook in `armTurnTimeout`

**Goal:** Add bot turn scheduling to `botSystem.js` (own in-process timer map, defensive fresh re-read on fire, whiff→graceful-eliminate under the submit lock) and hook it into `gameLogic.armTurnTimeout` via a lazy `require` (mirroring `gameLogic.js:528-533`), so every turn that lands on a bot drives a move.

**Files:**
- Modify: `server/systems/botSystem.js` (add `activeBotTimeouts`, `clearBotTimeout`, `scheduleBotMove`, `_loadDailySeed`, `_tmdbHeaders`; extend exports)
- Modify: `server/gameLogic.js` (lazy-required hook at end of `armTurnTimeout`, after `activeTurnTimeouts.set(id, timeoutId);` L71)
- Test: `server/systems/botSystem.schedule.test.js` (create — kept SEPARATE from `botSystem.test.js` so its hoisted `jest.mock('../redisUtils')` and `jest.spyOn(botSystem,'generateBotMove')` cannot contaminate the Task 1/2 difficulty/move-gen tests in `botSystem.test.js`)

**Acceptance Criteria:**
- [ ] `scheduleBotMove(io, pubClient, lobbyId, state)`: if current player not `isBot` → no-op; else clears any prior bot timer for `lobbyId`, sets a `setTimeout` (delay = `rng`-uniform in `[profile.delayMinMs, profile.delayMaxMs]`) stored in module `activeBotTimeouts` Map; the `.unref()`-ed timer's callback **re-reads fresh lobby** and no-ops unless still `playing` && current player is that same bot && `!isValidating`; then `generateBotMove`; non-null → `matchSystem.submitBotMove`; null (whiff) → acquire submit lock, re-verify bot's turn, `gameLogic.eliminateCurrentPlayer(...,"Bot couldn't find a move")`, release lock
- [ ] `clearBotTimeout(lobbyId)` clears+deletes the map entry; exported
- [ ] `gameLogic.armTurnTimeout` end: `require('./systems/botSystem').scheduleBotMove(io, pubClient, id, state)` guarded so a non-bot turn is unaffected; wrapped so a bot-hook throw can never break watchdog arming; WHY-comment referencing the L528-533 lazy-require precedent
- [ ] Timer uses `.unref()` (consistent with `scheduleGameReset` L400) so Jest workers exit; tests use fake timers / injected rng
- [ ] **TMDB auth:** `armTurnTimeout` has no `ctx.TMDB_HEADERS` in scope, so `scheduleBotMove` derives headers from `process.env.TMDB_READ_TOKEN` via a `_tmdbHeaders()` helper (same construction as `server.js:265` / `scripts/build-daily-movies.js:20`); `opts.headers` may override for tests. These headers feed BOTH `generateBotMove`'s `deps.headers` AND the `ctx.TMDB_HEADERS` passed to `submitBotMove`
- [ ] `npx jest server/systems/botSystem.schedule.test.js` PASS; `botSystem.test.js` (Task 1/2) still PASS unchanged; `npm test` green incl. unchanged `matchSystem.test.js`/`turn-watchdog.test.js`; coverage floors hold

**Verify:** `npx jest server/systems/botSystem.schedule.test.js server/systems/botSystem.test.js server/turn-watchdog.test.js` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — create `server/systems/botSystem.schedule.test.js` (standalone file — `jest.mock` is hoisted module-wide, so isolating it here protects the Task 1/2 tests):

```js
// ============================================================================
// botSystem.schedule.test.js — Phase 5a scheduleBotMove (own file: hoisted
// jest.mock('../redisUtils') + spyOn(generateBotMove) must not leak into the
// real difficulty/move-gen tests in botSystem.test.js).
// ============================================================================
const botSystem = require('./botSystem');
const matchSystem = require('./matchSystem');
const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');
jest.mock('../redisUtils');

describe('scheduleBotMove', () => {
  jest.useFakeTimers();

  const mkIo = () => ({ to: jest.fn().mockReturnThis(), emit: jest.fn() });
  function room(over = {}) {
    return {
      id: 'L1', status: 'playing', isValidating: false, gameMode: 'classic',
      players: [
        { id: 'sock-1', name: 'H', isAlive: true },
        { id: 'bot_1', name: 'Bot Bogart', isBot: true, isAlive: true, difficulty: 'normal' },
      ],
      currentTurnIndex: 1, chain: [], usedMovies: [], previousSharedActors: [], hardcoreMode: false,
      ...over,
    };
  }
  afterEach(() => { botSystem.clearBotTimeout('L1'); jest.clearAllMocks(); });

  test('non-bot current turn → no timer scheduled', () => {
    const r = room({ currentTurnIndex: 0 });
    botSystem.scheduleBotMove(mkIo(), {}, 'L1', r);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('bot turn schedules a move that calls submitBotMove with a generated pick', async () => {
    const io = mkIo();
    const r = room();
    redisUtils.getLobby.mockResolvedValue(r);
    jest.spyOn(botSystem, 'generateBotMove').mockResolvedValue({ tmdbId: 5, mediaType: 'movie' });
    const spy = jest.spyOn(matchSystem, 'submitBotMove').mockResolvedValue(undefined);
    botSystem.scheduleBotMove(io, {}, 'L1', r, { rng: () => 0 }); // delay = delayMinMs
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(3000 + 5);
    expect(spy).toHaveBeenCalledWith(expect.anything(), 'L1', 'bot_1', { tmdbId: 5, mediaType: 'movie' });
  });

  test('whiff (generateBotMove → null) gracefully eliminates under the lock', async () => {
    const io = mkIo();
    const r = room();
    redisUtils.getLobby.mockResolvedValue(r);
    redisUtils.acquireSubmitLock.mockResolvedValue('tok');
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.saveLobby.mockResolvedValue(undefined);
    jest.spyOn(botSystem, 'generateBotMove').mockResolvedValue(null);
    const gameLogic = require('../gameLogic');
    const elim = jest.spyOn(gameLogic, 'eliminateCurrentPlayer').mockResolvedValue(undefined);
    botSystem.scheduleBotMove(io, {}, 'L1', r, { rng: () => 0 });
    await jest.advanceTimersByTimeAsync(3000 + 5);
    expect(elim).toHaveBeenCalledWith(io, expect.anything(), 'L1', r, "Bot couldn't find a move");
  });

  test('stale fire is a safe no-op when the turn has moved on', async () => {
    const io = mkIo();
    const scheduled = room();
    botSystem.scheduleBotMove(io, {}, 'L1', scheduled, { rng: () => 0 });
    // By the time it fires the live room is on the human's turn.
    redisUtils.getLobby.mockResolvedValue(room({ currentTurnIndex: 0 }));
    const spy = jest.spyOn(matchSystem, 'submitBotMove').mockResolvedValue(undefined);
    await jest.advanceTimersByTimeAsync(3000 + 5);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest server/systems/botSystem.schedule.test.js`
Expected: FAIL — `botSystem.scheduleBotMove is not a function`

- [ ] **Step 3a: Implement botSystem additions** — in `server/systems/botSystem.js`, add (and export `scheduleBotMove`, `clearBotTimeout`):

```js
const fs = require('fs');
const path = require('path');

// TMDB auth headers from the process-global token — same construction as
// server.js:265 and scripts/build-daily-movies.js:20. WHY here: the bot
// scheduler is hooked into gameLogic.armTurnTimeout, which has no
// ctx.TMDB_HEADERS in scope. Deriving from env keeps the hook signature
// minimal and matches how the one-time daily-movies generator authenticates.
function _tmdbHeaders() {
  return { Authorization: `Bearer ${process.env.TMDB_READ_TOKEN}`, accept: 'application/json' };
}

// In-process bot-move timers, keyed by lobbyId — the bot analogue of
// gameLogic.activeTurnTimeouts. In-process (setTimeout handles aren't
// serializable). Cross-instance double-fire is harmless: submitBotMove and
// the whiff-eliminate both take the Redis submit lock, so only one wins; the
// loser no-ops on the fresh-state re-check (same soft-lock family the turn
// sweep solves).
const activeBotTimeouts = new Map();

function clearBotTimeout(lobbyId) {
  if (activeBotTimeouts.has(lobbyId)) {
    clearTimeout(activeBotTimeouts.get(lobbyId));
    activeBotTimeouts.delete(lobbyId);
  }
}

// First-move seed pool = the curated daily list (valid, popular by
// construction). Read once and cached; a missing/corrupt file degrades to an
// empty pool (bot whiffs its FIRST move only — never crashes boot). Same
// tolerance posture as dailySystem's fallback.
let _dailySeedCache = null;
function _loadDailySeed() {
  if (_dailySeedCache) return _dailySeedCache;
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'dailyMovies.json'), 'utf8');
    const arr = JSON.parse(raw);
    _dailySeedCache = Array.isArray(arr) ? arr : [];
  } catch (e) {
    _dailySeedCache = [];
  }
  return _dailySeedCache;
}

/**
 * Schedule the current bot's move. Called from gameLogic.armTurnTimeout (the
 * single point a turn becomes active). No-op unless the current player is a
 * bot. The fired timer RE-READS fresh lobby state and no-ops unless it's
 * still that bot's turn — same defensive posture as the turn watchdog, so a
 * stale fire after a disconnect/turn-change is harmless (this is why we don't
 * need every clearTurnTimeout call site to also clear bot timers).
 * `opts.rng` is injectable for deterministic tests.
 */
function scheduleBotMove(io, pubClient, lobbyId, state, opts = {}) {
  const cur = state.players && state.players[state.currentTurnIndex];
  if (!cur || !cur.isBot) return;
  clearBotTimeout(lobbyId); // never stack two bot timers for one lobby

  const rng = opts.rng || Math.random;
  const profile = BOT_DIFFICULTIES[cur.difficulty] || BOT_DIFFICULTIES.normal;
  // Uniform delay within the profile window. Kept under the turn timer so a
  // non-whiff move lands in time; Easy's wide window + 0.45 whiff are what
  // make it self-destruct (no special-case code — the existing watchdog
  // eliminates a bot that somehow runs out the clock).
  const delay = Math.floor(profile.delayMinMs + rng() * (profile.delayMaxMs - profile.delayMinMs));

  const botId = cur.id;
  const timer = setTimeout(async () => {
    activeBotTimeouts.delete(lobbyId);
    try {
      // Re-read fresh — the turn may have advanced (human reconnect, sweep,
      // elimination) while we waited. Mirror the watchdog's re-check.
      const live = await pubClient_getLobby(pubClient, lobbyId);
      if (!live || live.status !== 'playing' || live.isValidating) return;
      const liveCur = live.players[live.currentTurnIndex];
      if (!liveCur || liveCur.id !== botId || !liveCur.isAlive) return;

      // Headers: env-derived by default (armTurnTimeout has no ctx headers);
      // opts.headers lets tests inject without touching process.env.
      const headers = opts.headers || _tmdbHeaders();
      const move = await generateBotMove(live, profile, {
        pubClient,
        headers,
        rng,
        getOrFetchPersonCredits: require('../redisUtils').getOrFetchPersonCredits,
        dailySeed: _loadDailySeed(),
      });

      const matchSystem = require('./matchSystem'); // lazy: cycle-safe
      if (move) {
        await matchSystem.submitBotMove(
          { io, pubClient, TMDB_HEADERS: headers, logger: require('pino')() },
          lobbyId, botId, move
        );
        return;
      }
      // Whiff: eliminate gracefully UNDER the submit lock so it can't race a
      // real submit/forceNextTurn (identical guard to the turn watchdog).
      const redisUtils = require('../redisUtils');
      const gameLogic = require('../gameLogic');
      const token = await redisUtils.acquireSubmitLock(pubClient, lobbyId);
      if (!token) return; // a submit is in flight; it will advance the turn
      try {
        const r2 = await redisUtils.getLobby(pubClient, lobbyId);
        if (!r2 || r2.status !== 'playing') return;
        const c2 = r2.players[r2.currentTurnIndex];
        if (!c2 || c2.id !== botId || !c2.isAlive) return;
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, r2, "Bot couldn't find a move");
      } finally {
        await redisUtils.releaseSubmitLock(pubClient, lobbyId, token).catch(() => {});
      }
    } catch (e) {
      // A bot-turn failure must never crash the process or the lobby — the
      // turn watchdog is still armed and will eliminate the bot on timeout.
      require('pino')().error(e, 'scheduleBotMove fire failed');
    }
  }, delay);
  // .unref() so a pending bot timer never by itself pins a Jest worker / Node
  // process past shutdown (same rationale as scheduleGameReset's .unref()).
  if (typeof timer.unref === 'function') timer.unref();
  activeBotTimeouts.set(lobbyId, timer);
}

// Tiny indirection so the fresh-read above is mockable without pulling the
// whole redisUtils mock surface into scheduling tests.
function pubClient_getLobby(pubClient, lobbyId) {
  return require('../redisUtils').getLobby(pubClient, lobbyId);
}
```

Update `module.exports` to: `{ BOT_DIFFICULTIES, BOT_NAMES, createBot, generateBotMove, scheduleBotMove, clearBotTimeout }`.

- [ ] **Step 3b: Implement gameLogic hook** — in `server/gameLogic.js`, at the END of `armTurnTimeout`, immediately AFTER `activeTurnTimeouts.set(id, timeoutId);` (L71) and before the closing `}` (L72), insert:

```js
  // Phase 5a: armTurnTimeout is the single point a turn becomes active
  // (nextTurn / startGame / rejoin / recovery sweeps all route here), so it
  // is the one DRY place to drive a bot's move when the turn lands on one.
  // Lazy require — gameLogic ⇄ botSystem ⇄ matchSystem would be a load-time
  // cycle; deferring the require to call time resolves it (identical pattern
  // and rationale to the lobbySystem lazy-require at the checkSoloWin hook
  // ~L528-533). Wrapped so a bot-scheduling fault can never break the
  // watchdog that was just armed above.
  try {
    require('./systems/botSystem').scheduleBotMove(io, pubClient, id, state);
  } catch (e) {
    logger.error(e, 'bot move scheduling hook failed');
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest server/systems/botSystem.schedule.test.js server/systems/botSystem.test.js server/turn-watchdog.test.js server/systems/matchSystem.test.js` → Expected: PASS (Task 1/2 tests, watchdog + submitMovie behavior all unchanged)
Run: `npm test` → Expected: all green, coverage floors hold

- [ ] **Step 5: Commit**

```bash
git add server/systems/botSystem.js server/gameLogic.js server/systems/botSystem.schedule.test.js
git commit -m "Phase 5a (4): bot turn-hook — scheduleBotMove + lazy-required armTurnTimeout hook"
```

---

### Task 5: `addBot`/`removeBot` + socket events + lifecycle hardening

**Goal:** Host can add/remove bots in a waiting classic/speed lobby (cap-enforced); a disconnecting host is never replaced by a bot; a lobby with no connected humans (only bots) is cleaned up instead of becoming a ghost.

**Files:**
- Modify: `server/systems/lobbySystem.js` (add `addBot`, `removeBot`; fix `handleDisconnect` host-reassign L729-731 + no-human cleanup around L736; extend `module.exports`)
- Modify: `server/socketHandlers.js` (add `on('addBot')` / `on('removeBot')` using `lobbyConfigLimited`)
- Test: `server/systems/lobbySystem.botlifecycle.test.js` (create)

**Acceptance Criteria:**
- [ ] `addBot(ctx, socket, { lobbyId, difficulty })` under `withLobbyLock`: requires `r.status==='waiting'`, caller `isHost`, `r.gameMode` ∈ {`classic`,`speed`} (reject `team`/`solo`/`daily`), `r.players.length < MAX_PLAYERS_PER_LOBBY`; pushes `botSystem.createBot(r.players, difficulty)`; broadcasts; emits `socket.emit('error', …)` on each reject reason
- [ ] `removeBot(ctx, socket, { lobbyId, targetId })` under `withLobbyLock`: requires waiting + caller `isHost` + target exists and `isBot`; filters it out; broadcasts
- [ ] `handleDisconnect`: waiting-state host reassignment picks the first **non-bot** player (`room.players.find(p => !p.isBot)`), not `room.players[0]`; if no non-bot remains, no human host is set
- [ ] `handleDisconnect`: lobby is deleted (and `gameLogic.clearTurnTimeout` + `botSystem.clearBotTimeout` called) when **no connected non-bot players remain**, generalizing the `room.players.length === 0` check (L736) so a bots-only remnant can't ghost; elimination of a still-connected human does NOT trigger this (only the disconnect path)
- [ ] `module.exports` adds `addBot`, `removeBot`; socket handlers wired with the `lobbyConfigLimited` bucket
- [ ] `npx jest server/systems/lobbySystem.botlifecycle.test.js` PASS; `npm test` green incl. unchanged disconnect tests; coverage floors hold

**Verify:** `npx jest server/systems/lobbySystem.botlifecycle.test.js` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — create `server/systems/lobbySystem.botlifecycle.test.js`:

```js
// ============================================================================
// lobbySystem.botlifecycle.test.js — Phase 5a addBot/removeBot + cleanup
// ============================================================================
const lobbySystem = require('./lobbySystem');
const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');
jest.mock('../redisUtils');

const HOST = 'sock-host';
function lobby(over = {}) {
  return {
    id: 'L', status: 'waiting', gameMode: 'classic', isPublic: false,
    players: [{ id: HOST, name: 'Host', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 'h' }],
    spectators: [], chain: [], usedMovies: [], ...over,
  };
}
let io, ctx;
beforeEach(() => {
  jest.clearAllMocks();
  io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
  ctx = { io, pubClient: {}, TMDB_HEADERS: {}, logger: { error: jest.fn() } };
  // withLobbyLock(pub, id, fn) → runs fn(room), returns room (mirror real contract).
  redisUtils.withLobbyLock.mockImplementation(async (_p, _id, fn) => {
    const r = global.__room; const out = await fn(r); return out === false ? r : r;
  });
  redisUtils.getLobby.mockImplementation(async () => global.__room);
  redisUtils.deleteLobby.mockResolvedValue(undefined);
  redisUtils.saveLobby.mockResolvedValue(undefined);
  redisUtils.getSocketLobby.mockResolvedValue('L');
  redisUtils.deleteSocketLobby.mockResolvedValue(undefined);
});

test('addBot appends a bot for the host in a waiting classic lobby', async () => {
  global.__room = lobby();
  const socket = { id: HOST, emit: jest.fn() };
  await lobbySystem.addBot(ctx, socket, { lobbyId: 'L', difficulty: 'hard' });
  const bot = global.__room.players.find(p => p.isBot);
  expect(bot).toMatchObject({ isBot: true, difficulty: 'hard' });
});

test('addBot rejected for non-host / non-waiting / non-classic / full', async () => {
  const socket = { id: HOST, emit: jest.fn() };
  global.__room = lobby({ players: [{ id: HOST, isHost: false }] });
  await lobbySystem.addBot(ctx, socket, { lobbyId: 'L' });
  expect(global.__room.players.some(p => p.isBot)).toBe(false);

  global.__room = lobby({ gameMode: 'team' });
  await lobbySystem.addBot(ctx, { id: HOST, emit: jest.fn() }, { lobbyId: 'L' });
  expect(global.__room.players.some(p => p.isBot)).toBe(false);
});

test('removeBot drops a bot by id for the host', async () => {
  global.__room = lobby();
  global.__room.players.push({ id: 'bot_1', name: 'Bot Bogart', isBot: true });
  await lobbySystem.removeBot(ctx, { id: HOST, emit: jest.fn() }, { lobbyId: 'L', targetId: 'bot_1' });
  expect(global.__room.players.some(p => p.id === 'bot_1')).toBe(false);
});

test('disconnecting host is replaced by a HUMAN, never a bot', async () => {
  global.__room = lobby({ players: [
    { id: HOST, name: 'Host', isHost: true, connected: true, stableId: 'h' },
    { id: 'bot_1', name: 'Bot', isBot: true, connected: true },
    { id: 'sock-2', name: 'Human2', isHost: false, connected: true, stableId: 'u2' },
  ]});
  await lobbySystem.handleDisconnect(ctx, HOST);
  const host = global.__room.players.find(p => p.isHost);
  expect(host.id).toBe('sock-2');
  expect(host.isBot).toBeFalsy();
});

test('lobby with only bots left after the last human disconnects is deleted', async () => {
  global.__room = lobby({ players: [
    { id: HOST, name: 'Host', isHost: true, connected: true, stableId: 'h' },
    { id: 'bot_1', name: 'Bot', isBot: true, connected: true },
  ]});
  const clearTurn = jest.spyOn(gameLogic, 'clearTurnTimeout');
  await lobbySystem.handleDisconnect(ctx, HOST);
  expect(redisUtils.deleteLobby).toHaveBeenCalledWith(ctx.pubClient, 'L');
  expect(clearTurn).toHaveBeenCalledWith('L');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest server/systems/lobbySystem.botlifecycle.test.js`
Expected: FAIL — `lobbySystem.addBot is not a function`

- [ ] **Step 3a: Implement `addBot`/`removeBot`** — in `server/systems/lobbySystem.js`, add near `kickPlayer` (after it ends L322). Reuse the existing top-of-file `const { MAX_PLAYERS_PER_LOBBY } = require('../constants');` (L15) and add `const botSystem = require('./botSystem');` to the top requires:

```js
// Phase 5a: host adds an AI opponent to a WAITING classic/speed lobby. RMW
// under withLobbyLock (mirrors kickPlayer's finding-#4 reasoning — a stale
// snapshot save must not resurrect/lose a bot). Gated to classic/speed: team
// needs balanced bot assignment and solo/daily are single-player by design
// (out of scope this phase).
async function addBot(ctx, socket, { lobbyId, difficulty }) {
  const { io, pubClient } = ctx;
  let added = false;
  let rejection = null;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') { rejection = 'Bots can only be added before the game starts.'; return false; }
    if (!r.players.find(p => p.id === socket.id)?.isHost) { rejection = 'Only the host can add bots.'; return false; }
    if (r.gameMode !== 'classic' && r.gameMode !== 'speed') { rejection = 'Bots are only available in Classic and Speed modes.'; return false; }
    if (r.players.length >= MAX_PLAYERS_PER_LOBBY) { rejection = `Lobby is full (${MAX_PLAYERS_PER_LOBBY} player maximum).`; return false; }
    r.players.push(botSystem.createBot(r.players, difficulty));
    added = true;
  });
  if (rejection) return socket.emit('error', rejection);
  if (added && room) gameLogic.broadcastState(io, lobbyId, room);
}

// Phase 5a: host removes a bot pre-game (the bot analogue of kickPlayer;
// no socket side-effects since a bot has no socket).
async function removeBot(ctx, socket, { lobbyId, targetId }) {
  const { io, pubClient } = ctx;
  let removed = false;
  const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
    if (r.status !== 'waiting') return false;
    if (!r.players.find(p => p.id === socket.id)?.isHost) return false;
    const target = r.players.find(p => p.id === targetId);
    if (!target || !target.isBot) return false; // never remove a human via this path
    r.players = r.players.filter(p => p.id !== targetId);
    removed = true;
  });
  if (removed && room) gameLogic.broadcastState(io, lobbyId, room);
}
```

Add `addBot, removeBot` to `lobbySystem`'s `module.exports`.

- [ ] **Step 3b: Fix host-reassign + ghost cleanup in `handleDisconnect`** — in `server/systems/lobbySystem.js`:

Replace the waiting-state host-reassignment (currently L729-731):

```js
      if (wasHost && room.players.length > 0) {
        room.players[0].isHost = true;
      }
```

with:

```js
      // Phase 5a: a bot must NEVER become host (host = settings/start
      // authority). Promote the first remaining HUMAN; if only bots remain,
      // leave no host — the no-human cleanup below will tear the lobby down.
      if (wasHost) {
        const nextHuman = room.players.find(p => !p.isBot);
        if (nextHuman) nextHuman.isHost = true;
      }
```

Replace the empty-lobby cleanup (currently L736-739):

```js
    if (room.players.length === 0) {
      await redisUtils.deleteLobby(pubClient, lobbyId);
      return;
    }
```

with:

```js
    // Phase 5a: generalize "no players" to "no connected humans". A lobby
    // whose only remaining members are bots can never be played to/by anyone
    // and would otherwise ghost forever (bots never fire 'disconnect' and
    // never empty room.players). Tear it down and clear BOTH in-process
    // timers so a stale watchdog/bot-move can't fire against a dead lobby.
    const connectedHumans = room.players.filter(p => !p.isBot && p.connected);
    if (room.players.length === 0 || connectedHumans.length === 0) {
      gameLogic.clearTurnTimeout(lobbyId);
      // Clear the in-process bot-move timer too so a pending bot fire can't
      // act against a torn-down lobby. Uses the top-level `botSystem` ref
      // added in Step 3a (lobbySystem→botSystem is a plain acyclic top-level
      // require — botSystem only top-level-requires fs/path — so no lazy
      // require / cycle concern here).
      botSystem.clearBotTimeout(lobbyId);
      await redisUtils.deleteLobby(pubClient, lobbyId);
      return;
    }
```

Note for the implementer: `player.connected` is set to `false` on this disconnecting player earlier in `handleDisconnect` (L718) before this check, so a disconnecting last human is correctly excluded from `connectedHumans`. Verify this ordering holds when implementing; if the disconnecting human is still `connected:true` at this point, also exclude `socketId`.

- [ ] **Step 3c: Wire socket events** — in `server/socketHandlers.js`, add after the `kickPlayer` handler (L301-304):

```js
    on('addBot', async (data) => {
      // Phase 5a: pre-game host action — reuse the lobbyConfig bucket (the
      // shared host-settings/lifecycle limiter) so add-spam is throttled.
      if (await lobbyConfigLimited()) return;
      await lobbySystem.addBot(ctx, socket, data || {});
    });

    on('removeBot', async (data) => {
      if (await lobbyConfigLimited()) return;
      await lobbySystem.removeBot(ctx, socket, data || {});
    });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest server/systems/lobbySystem.botlifecycle.test.js` → Expected: PASS
Run: `npx jest server/quit-grace-lock.test.js server/lobby-lock.test.js server/socket.integration.test.js` → Expected: PASS (disconnect/lobby behavior unchanged for human-only lobbies)
Run: `npm test` → Expected: all green, coverage floors hold

- [ ] **Step 5: Commit**

```bash
git add server/systems/lobbySystem.js server/socketHandlers.js server/systems/lobbySystem.botlifecycle.test.js
git commit -m "Phase 5a (5): addBot/removeBot + host-never-bot + bots-only ghost-lobby cleanup"
```

---

### Task 6: Client — Add-Bot control, difficulty selector, BOT badge, thinking affordance

**Goal:** In the lobby, the host sees an "Add Bot" control with an Easy/Normal/Hard selector; bots render in the player list as `name` + a `BOT · <Difficulty>` badge with a host remove (✕) button; on a bot's turn other clients show a lightweight "thinking…" cue. Additive CSS only.

**Files:**
- Modify: `public/js/ui/ui-render.js` (`renderLobby` L30-~127: bot label/remove-btn in the `players.forEach` L50-70; Add-Bot control near the host/start area; reuse `getSocket()`)
- Modify: `public/css/02-hero-lobby.css` (append one additive `.bot-badge` rule block — no existing rule altered)

**Acceptance Criteria:**
- [ ] In `renderLobby`'s player loop, a player with `p.isBot` renders its name plus a `BOT · <Difficulty>` badge (span `class="bot-badge"`), capitalized difficulty; bots show no 👑
- [ ] When `amIHost`, each bot row gets a ✕ remove button (mirror the existing `btn-kick` pattern) → `getSocket().emit('removeBot', { lobbyId: gameState.id, targetId: p.id })`
- [ ] When `amIHost` and the lobby is waiting, an "Add Bot" button + a `<select>` (Easy/Normal/Hard, default Normal) render near the host/start controls → `getSocket().emit('addBot', { lobbyId: gameState.id, difficulty: <selected> })`
- [ ] The Add-Bot control is only rendered for classic/speed lobbies (hidden for team/solo/daily — mirror server gating so the UI never offers a rejected action)
- [ ] `02-hero-lobby.css` ends with exactly one new additive `.bot-badge` rule (+ WHY comment); no existing selector/declaration modified or removed (provable: `git diff` shows only additions in that file)
- [ ] `npm test` green (client suite unchanged — no client test asserts lobby DOM today; do not add brittle DOM tests); manual lobby smoke reported (see Verify)
- [ ] Bot turn "thinking…" cue: reuse the existing peer/turn indicator path so other players see the active bot is "thinking" rather than a dead timer (no new socket event — derive from `gameState` active player `isBot`)

**Verify:** `npm test` → all green. Then MANUAL (report): host a classic lobby, Add Bot ×1 each difficulty, see `BOT · Hard` badges + remove ✕ (host only), remove one, start with 1 human + 1 bot, confirm the bot takes its turn and the UI shows a "thinking…" cue on the bot's turn, no console errors. (Full bot-vs-human fun/balance is the separate playtest gate — see plan header.)

**Steps:**

- [ ] **Step 1: Read the exact current `renderLobby`** — open `public/js/ui/ui-render.js` L1-130. Confirm: the import line for `getSocket` (~L8), `renderLobby` signature L30, `amIHost` L31, the `gameState.players.forEach(p => { ... })` block L50-~75 (label build L~52-57, host kick button L63-70), and the start-button/host area ~L110-127. (Line numbers may have shifted from earlier tasks — re-derive before editing.)

- [ ] **Step 2: Implement the player-row bot rendering** — inside the `gameState.players.forEach(p => { ... })` loop, where the human label/crown is built (around L57 `if (p.isHost) label += ' 👑';`), add bot handling. Use this pattern (adapt variable names to the actual loop, which builds an `li` and a text label):

```js
      // Phase 5a: a bot is always visibly a bot — name + a BOT badge with
      // its difficulty. No crown (bots are never host). The badge is a
      // separate span so the additive .bot-badge CSS can style it without
      // touching the existing player-row rules (zero-visual-change for
      // human rows — Phase 4 additive discipline).
      if (p.isBot) {
        const badge = document.createElement('span');
        badge.className = 'bot-badge';
        const diff = (p.difficulty || 'normal');
        badge.textContent = `BOT · ${diff.charAt(0).toUpperCase()}${diff.slice(1)}`;
        li.appendChild(badge);
      }
```

And in the host-controls branch (the same `if (amIHost && !p.isHost)` block that builds the kick button at L63-70), make the remove button target bots via `removeBot` (kick stays for humans). Concretely, where the kick button's click handler is:

```js
      // existing: getSocket().emit('kickPlayer', { lobbyId: gameState.id, targetId: p.id });
```

branch it:

```js
      kickBtn.addEventListener('click', () => {
        // Phase 5a: bots are removed via removeBot (no socket to 'kick');
        // humans keep the existing kickPlayer path. Same ✕ affordance.
        if (p.isBot) {
          getSocket().emit('removeBot', { lobbyId: gameState.id, targetId: p.id });
        } else {
          getSocket().emit('kickPlayer', { lobbyId: gameState.id, targetId: p.id });
        }
      });
```

- [ ] **Step 3: Implement the Add-Bot control** — near the host/start-button area (~L110-127, where the host's start button is rendered for `amIHost`), add a control rendered only for the host on a classic/speed waiting lobby:

```js
  // Phase 5a: host-only "Add Bot" with a difficulty selector. Only for
  // classic/speed (mirrors the server gate so the UI never offers an action
  // the server will reject). Built from elements (no innerHTML) consistent
  // with the rest of this file.
  const botModeOk = gameState.gameMode === 'classic' || gameState.gameMode === 'speed';
  if (amIHost && botModeOk) {
    const botRow = document.createElement('div');
    botRow.className = 'add-bot-row';
    const sel = document.createElement('select');
    sel.className = 'bot-diff-select';
    [['normal', 'Normal'], ['easy', 'Easy'], ['hard', 'Hard']].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      sel.appendChild(o);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-secondary';   // reuse Phase 4 additive .btn
    addBtn.textContent = '+ Add Bot';
    addBtn.addEventListener('click', () => {
      getSocket().emit('addBot', { lobbyId: gameState.id, difficulty: sel.value });
    });
    botRow.appendChild(addBtn);
    botRow.appendChild(sel);
    // Insert next to the start/host controls (append to the same container
    // the start button uses — re-derive that container variable in step 1).
    <hostControlsContainer>.appendChild(botRow);
  }
```

(The implementer substitutes `<hostControlsContainer>` with the actual container element variable identified in Step 1 — e.g. the element the start button is appended to.)

- [ ] **Step 4: Bot-turn "thinking…" cue** — in `renderPlayerSidebar` (`ui-render.js` ~L180-240; the per-player row loop is `gameState.players.forEach((p, index) => { ... })` ~L213). Inside that loop, where each player row element is built, add the cue for the active bot. Re-derive the row element variable name in Step 1; the concrete addition is:

```js
      // Phase 5a: when it's a BOT's turn, show a derived "thinking…" cue so
      // other players see deliberate AI pacing instead of a silent timer.
      // Pure state-derived (active player isBot + it's their turn) — NO new
      // socket event. WHY a span not text: lets it sit beside the existing
      // turn highlight without disturbing the row's layout rules.
      if (p.isBot && index === gameState.currentTurnIndex && gameState.status === 'playing') {
        const thinking = document.createElement('span');
        thinking.className = 'bot-thinking';
        thinking.textContent = ' 🤖 thinking…';
        playerRowEl.appendChild(thinking); // playerRowEl = the row element built in this iteration
      }
```

Then add a matching additive rule to the Step 5 CSS block (`.bot-thinking { opacity: .8; font-size: .8rem; font-style: italic; }`). `playerRowEl` is whatever the loop already calls its per-player element — substitute the real name; do not introduce a new element.

- [ ] **Step 5: Additive CSS** — append to the END of `public/css/02-hero-lobby.css` (no existing rule touched — provable additive, Phase 4 discipline):

```css

/* Phase 5a: bot opponents. ADDITIVE ONLY — these are brand-new selectors
   (.bot-badge / .add-bot-row / .bot-diff-select / .bot-thinking); no existing
   rule above is modified or removed, so human-only lobbies render
   byte-identically. The badge makes a bot unmistakably a bot at a glance. */
.bot-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 8px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #c7d2fe;
  background: rgba(129, 140, 248, 0.16);
  border: 1px solid rgba(129, 140, 248, 0.4);
  border-radius: 999px;
  vertical-align: middle;
}
.add-bot-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.bot-diff-select {
  padding: 6px 8px;
  border-radius: 8px;
  background: #1e1e22;
  color: #e4e4e7;
  border: 1px solid #3f3f46;
}
.bot-thinking {
  opacity: 0.8;
  font-size: 0.8rem;
  font-style: italic;
}
```

- [ ] **Step 6: Run tests + manual smoke**

Run: `npm test` → Expected: all green, coverage floors hold (no client DOM test added; server suite unaffected)
Manual: `npm start` with a real `TMDB_READ_TOKEN`/`REDIS_URL` (or report that local manual verification isn't possible in this env and defer to the post-merge playtest gate). Report the lobby smoke from **Verify**.

- [ ] **Step 7: Commit**

```bash
git add public/js/ui/ui-render.js public/css/02-hero-lobby.css
git commit -m "Phase 5a (6): client Add-Bot control + difficulty selector + BOT badge + thinking cue"
```

---

## Post-task: final review & finishing

After Task 6 passes both reviews and `.tasks.json` is fully synced:

1. **Final opus whole-branch holistic review** (most-capable model) over `main..phase5a-bot-opponents` — focus: the gameLogic↔botSystem↔matchSystem lazy-require cycle is load-safe; no socketless `.emit` path reachable by a bot; `submitMovie` behavior byte-unchanged; the `0<whiff<1` invariant holds; additive-only CSS; WHY-comments on every change; no scope creep (accounts/friends/5b absent).
2. **finishing-a-development-branch:** verify full `npm test` green, then push `phase5a-bot-opponents` + `gh pr create` base `main`. PR body MUST flag OUTSTANDING post-merge verification: the suite mocks Redis/TMDB and exercises no real boot or browser — after the user merges, confirm the Render deploy is `live` (read-only) AND complete the manual human-vs-bot playtest (regular + hardcore; Easy self-destructs often, Normal fair, Hard tough-but-beatable, NO profile unbeatable; "thinking…" cue shows; no ghost lobbies). **Do NOT merge / push to main / deploy — hand to the user.**
3. Update `project_phase5a_bot_opponents_shipped.md` (create) + `MEMORY.md` index after the PR is created.
