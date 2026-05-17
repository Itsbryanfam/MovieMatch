# Local Fallback Movie DB (Phase 5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During a TMDB outage, a submit of a *common* movie (a bundled ~1000-movie local DB) is resolved and validated from local data instead of eliminating the player — covering bots, autocomplete picks, and typed titles.

**Architecture:** A committed `data/fallbackMovies.json` (`{id,title,year,mediaType:"movie",cast:[{id,name}]}`), produced by a committed one-time generator `scripts/build-fallback-movies.js` (mirrors the Phase 4 `build-daily-movies.js` precedent), read once by a `server/systems/fallbackMovies.js` loader (mirrors `dailySystem`'s static-read posture). Two **failure-only** fallback branches consult it: `resolveCandidates` (direct-ID by id, fuzzy by title) and `getOrFetchCredits` (cast by id). When TMDB is healthy the live path is byte-unchanged; an uncovered movie during an outage keeps today's exact eliminate behavior.

**Tech Stack:** Node CommonJS, Jest 30 (server project node env; `jest.mock('../redisUtils')` + `global.fetch=jest.fn()` patterns), TMDB REST, dotenv.

**Process (validated Phases 1–5a — memory/feedback_phase_execution_workflow.md):** spec `ddb491e` already committed to local `main`. After this plan + `.tasks.json` are committed to local `main`, create branch `phase5b-fallback-movie-db` off `main` (`4e1372b` = Phases 1–5a + PR #18 + PR #19; **#19 is merged so there is NO overlap concern** — `resolveCandidates`/`getOrFetchCredits` are untouched by #18/#19). NOT a worktree, NOT stacked. Native Task tools unavailable → TodoWrite + hand-sync `.md.tasks.json`. Per task: implementer (full task text + exact code) → independent spec-compliance review → independent code-quality review → fix-loop until both pass → commit → sync `.tasks.json`. **Every changed line carries a WHY-comment** (memory/feedback_code_comments.md). `coverage/` stays untracked. After all 5 tasks: final opus whole-branch holistic review, then finishing-a-development-branch (push + `gh pr create` base `main`). **PR-merge / push-to-main / Render deploy is classifier-gated and handed to the user — do NOT merge/deploy.** Suite mocks Redis/TMDB and exercises no real boot or real outage: **real-boot verification + a real TMDB-failure simulation are OUTSTANDING until the user merges and Render is checked.** Out-of-scope findings during reviews → session spawn_task chip, not scope creep. This is the LAST phase — once 5b is merged+deployed+verified the 5-phase remediation is complete.

**Model tiering:** Task 1 = cheap (mechanical loader, 1 file + test, exact precedent). Task 0, 2, 3, 4 = standard (the generator must produce valid-by-construction data and correctly surface a BLOCKER vs fake data; the failure-branch + integration tasks are judgment).

---

## Verified Integration Facts (current `main` @ 4e1372b — re-confirm if code moved)

- **`resolveCandidates`** `server/systems/matchSystem.js:359-413`. Direct-ID path: `_validatedDirectLookup` (L351-357) → `const detailsRes = await fetch(`${TMDB_API_BASE}/${direct.mediaType}/${direct.id}?language=en-US`, { headers, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) })` (L367) → `const detailsData = await detailsRes.json()` (L368) → `if (detailsData && detailsData.id) topCandidates = [{ id, media_type: direct.mediaType, name, title, release_date, first_air_date, poster_path }]` (L370-379). Fuzzy path (L384-410): `const searchRes = await fetch(`${TMDB_API_BASE}/search/${searchType}?query=…`, {…})` (L386-389) → `const searchData = await searchRes.json()` (L390) → `let results = (searchData.results||[]).filter(r => r.media_type !== 'person')` (L391) → theme filter `if (room.theme && room.theme !== 'any') results = results.filter(r => themesSystem.matchesTheme(room.theme, r))` (L398-400) → `results.sort(... levenshtein ...)` (L402-407) → `topCandidates = results.slice(0, 5)` (L409). NOTE: the live code does NOT check `.ok` — it calls `.json()` directly; a non-OK TMDB response yields a junk body (no `.id` / no `.results`) and a network/timeout failure throws out of `resolveCandidates`. `levenshtein` is a private fn at `matchSystem.js:55`. `TMDB_API_BASE`/`TMDB_FETCH_TIMEOUT_MS` are module consts. `module.exports` at L752 (already exports `resolveCandidates`, `enrichWithCredits`, etc. — no export change needed).
- **`enrichWithCredits`** `matchSystem.js:415-447`: per-candidate `try { credData = await redisUtils.getOrFetchCredits(pubClient, c.id, mt, headers); return {…cast…} } catch { logger.error; return {…, cast: [] } }`. **Unchanged by this phase** — once `getOrFetchCredits` returns fallback cast instead of throwing, enrich gets real cast automatically.
- **`getOrFetchCredits`** `server/redisUtils.js:126-192`. Structure: `cacheKey = credits:v2:{mediaType}:{tmdbId}`; cache-hit fast path `const cached = await pubClient.get(cacheKey); if (cached) return JSON.parse(cached)` (L133-136); NX stampede lock (L141-151); `try {` (L153) fetch movie `${TMDB}/${mediaType}/${tmdbId}/credits?language=en-US` or tv `aggregate_credits` (L156-163); `if (!response.ok) { await response.arrayBuffer(); throw new Error(`TMDB credits failed: ${response.status}`); }` (L165-170); `const raw = await response.json()` (L172); `const stripped = { cast: (raw.cast||[]).filter(a=>a&&a.name).map(a=>({id:a.id,name:a.name})) }` (L178-182); `await pubClient.set(cacheKey, JSON.stringify(stripped), { EX: 604800 })` (L184); `return stripped` (L186); `} finally { if (gotLock) await pubClient.del(lockKey).catch(()=>{}) }` (L187-191). There is **try/finally but NO catch** — a network/timeout fetch throw currently propagates out.
- **Loader precedent** `server/systems/dailySystem.js:41-59`: `let _movieList=null; function _loadMovieList(){ if(_movieList) return _movieList; try { _movieList = JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','data','dailyMovies.json'),'utf8')); if(!Array.isArray(_movieList)||_movieList.length===0) throw new Error(...) } catch(err){ _movieList = [{ id:27205, title:'Inception', year:2010, mediaType:'movie' }] } return _movieList }`. `const fs=require('fs'); const path=require('path')` at top.
- **Generator precedent** `scripts/build-daily-movies.js` (full): `require('dotenv').config()`; `const TMDB_TOKEN=process.env.TMDB_READ_TOKEN; if(!TMDB_TOKEN){ console.error(...); process.exit(1) }`; `const TMDB_HEADERS={Authorization:`Bearer ${TMDB_TOKEN}`,accept:'application/json'}`; `loadExisting()` reads current JSON; `fetchPage(kind,page)` GETs `https://api.themoviedb.org/3/movie/${kind}?language=en-US&page=${page}` with `AbortSignal.timeout(8000)`, throws on `!res.ok`; `toEntry(r)` → `{id,title,year,mediaType:'movie'}` skipping invalid; loops `['top_rated','popular']` pages 1..30 unioning into a `Map` keyed by id until `TARGET+40`; `list=[...byId.values()].sort((a,b)=>a.id-b.id)`; `if(list.length<TARGET){ console.error(...); process.exit(1) }`; `fs.writeFileSync(OUT, JSON.stringify(list,null,2)+'\n')`. `npm run build:daily-movies`. **TMDB_READ_TOKEN is present in this env** (Phase 4 generated the committed 553-entry `data/dailyMovies.json` with it).
- `data/dailyMovies.json` = 553 entries `{id,title,year,mediaType:"movie"}` (e.g. `{"id":11,"title":"Star Wars","year":1977,"mediaType":"movie"}`). `package.json` scripts: `start`, `test`, `build:daily-movies`.
- **Require-cycle:** `fallbackMovies.js` will require ONLY `fs`+`path` (a leaf, like `dailySystem`). `redisUtils.js` and `matchSystem.js` may therefore `require` it at top-level with no cycle (it pulls nothing back).
- **Test patterns:** `server/systems/matchSystem.test.js` & `matchSystem.botmove.test.js`: `jest.mock('../redisUtils')`, `global.fetch=jest.fn()`, `mockIo={to:jest.fn().mockReturnThis(),emit:jest.fn()}`, `ctx={io,pubClient,TMDB_HEADERS,logger}`, `afterEach(()=>gameLogic.clearTurnTimeout('TEST'))`. Data-test precedent: `server/systems/dailyMovies.data.test.js` (no-network, structural).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `scripts/build-fallback-movies.js` (create) | one-time dev generator → writes `data/fallbackMovies.json` | 0 |
| `data/fallbackMovies.json` (create, generated) | committed dataset `{id,title,year,mediaType,cast:[{id,name}]}` | 0 |
| `package.json` (modify) | + `build:fallback-movies` script | 0 |
| `server/systems/fallbackMovies.data.test.js` (create) | no-network structural test of the dataset | 0 |
| `server/systems/fallbackMovies.js` (create) | read-once loader: `getFallbackById`, `allFallback` | 1 |
| `server/systems/fallbackMovies.test.js` (create) | loader unit tests | 1 |
| `server/redisUtils.js` (modify) | `getOrFetchCredits` failure-only fallback branch | 2 |
| `server/redisUtils.fallbackcredits.test.js` (create) | credits-branch tests | 2 |
| `server/systems/matchSystem.js` (modify) | `resolveCandidates` failure-only fallback branches | 3 |
| `server/systems/matchSystem.fallback.test.js` (create) | resolve-branch tests | 3 |
| `server/systems/fallbackMovies.integration.test.js` (create) | simulated-outage end-to-end | 4 |

Sequential chain: **0 → 1 → 2 → 3 → 4**.

---

### Task 0: One-time generator + committed dataset + structural test

**Goal:** A committed `scripts/build-fallback-movies.js`, run to produce a committed `data/fallbackMovies.json` (~1000 movies, each with cast), `npm run build:fallback-movies`, and a no-network structural test.

**Files:**
- Create: `scripts/build-fallback-movies.js`, `data/fallbackMovies.json` (generated output), `server/systems/fallbackMovies.data.test.js`
- Modify: `package.json` (add script)

**Acceptance Criteria:**
- [ ] `scripts/build-fallback-movies.js` mirrors `build-daily-movies.js`: `dotenv`, `process.env.TMDB_READ_TOKEN` (exit 1 if missing), headers `{Authorization:`Bearer ${t}`,accept:'application/json'}`, `AbortSignal.timeout`, sorted-by-id output, `JSON.stringify(list,null,2)+'\n'`, exit non-zero if under target
- [ ] Curated id set = union of all ids in `data/dailyMovies.json` ∪ ids gathered from `/movie/top_rated` + `/movie/popular` list pages, target **1000** unique; title/year taken from the list/daily entry (no extra `/movie/{id}` details call); per id one `/movie/{id}/credits?language=en-US` fetch → `cast = (credits.cast||[]).filter(a=>a&&a.name).slice(0,20).map(a=>({id:a.id,name:a.name}))`; an entry with no usable cast is skipped (a cast-less fallback entry is useless)
- [ ] `data/fallbackMovies.json` committed: a JSON array sorted by id, each entry exactly `{id:<int>,title:<str>,year:<int>,mediaType:"movie",cast:[{id:<int>,name:<str>},…]}` (cast non-empty, ≤20)
- [ ] `package.json` gains `"build:fallback-movies": "node scripts/build-fallback-movies.js"`
- [ ] `server/systems/fallbackMovies.data.test.js` (no network) passes: file parses to an array; length ≥ **900**; every entry has integer `id`, non-empty string `title`, integer `year`, `mediaType==='movie'`, and a non-empty `cast` array of `{id:int,name:string}`; no duplicate ids; **every id in `data/dailyMovies.json` is present**
- [ ] `npm test` green; coverage ratchet floors hold
- [ ] **BLOCKER protocol:** if `TMDB_READ_TOKEN` is missing/unset, or TMDB is unreachable / rate-limits such that < ~900 entries with cast can be collected, STOP and report BLOCKED with the exact shortfall. Do **NOT** hand-write, stub, or fake any entry — ids/cast must be valid by construction.

**Verify:** `node scripts/build-fallback-movies.js` (writes the file) then `npx jest server/systems/fallbackMovies.data.test.js` → PASS

**Steps:**

- [ ] **Step 1: Write the failing structural test** — create `server/systems/fallbackMovies.data.test.js`:

```js
// ============================================================================
// fallbackMovies.data.test.js — Phase 5b: pins data/fallbackMovies.json shape.
// ============================================================================
// WHY: the fallback DB is only consulted during a TMDB outage, so a shape
// regression would be invisible until prod is already degraded. This no-network
// test fails CI immediately if the committed dataset drifts.
// ============================================================================
const fs = require('fs');
const path = require('path');

const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'fallbackMovies.json'), 'utf8')
);
const daily = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'dailyMovies.json'), 'utf8')
);

test('is a sizable array of well-formed movie entries with cast', () => {
  expect(Array.isArray(data)).toBe(true);
  expect(data.length).toBeGreaterThanOrEqual(900);
  for (const e of data) {
    expect(Number.isInteger(e.id)).toBe(true);
    expect(typeof e.title).toBe('string');
    expect(e.title.length).toBeGreaterThan(0);
    expect(Number.isInteger(e.year)).toBe(true);
    expect(e.mediaType).toBe('movie');
    expect(Array.isArray(e.cast)).toBe(true);
    expect(e.cast.length).toBeGreaterThan(0);
    expect(e.cast.length).toBeLessThanOrEqual(20);
    for (const a of e.cast) {
      expect(Number.isInteger(a.id)).toBe(true);
      expect(typeof a.name).toBe('string');
      expect(a.name.length).toBeGreaterThan(0);
    }
  }
});

test('has no duplicate ids and is sorted by id', () => {
  const ids = data.map(e => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  const sorted = [...ids].sort((x, y) => x - y);
  expect(ids).toEqual(sorted);
});

test('contains every daily-pool id (the common universe is covered)', () => {
  const have = new Set(data.map(e => e.id));
  const missing = daily.map(d => d.id).filter(id => !have.has(id));
  expect(missing).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest server/systems/fallbackMovies.data.test.js`
Expected: FAIL — `ENOENT … data/fallbackMovies.json` (file not generated yet)

- [ ] **Step 3: Create the generator** — `scripts/build-fallback-movies.js`:

```js
// build-fallback-movies.js — ONE-TIME generator for data/fallbackMovies.json.
// WHY: a TMDB outage on an uncached title currently ELIMINATES the active
// player (resolveCandidates' fetch fails before credits even run). The runtime
// fallback needs, per movie, its title/year AND cast — sourced from TMDB so
// every id+cast is valid BY CONSTRUCTION (hand-writing ~1000 movies' casts
// would inevitably hallucinate). Run manually (npm run build:fallback-movies);
// the output is committed. The server runtime never runs this — it does a
// static read via server/systems/fallbackMovies.js.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Mirror server.js / build-daily-movies.js exactly — same credentials the app
// already runs with, no new env var.
const TMDB_TOKEN = process.env.TMDB_READ_TOKEN;
if (!TMDB_TOKEN) {
  console.error('TMDB_READ_TOKEN missing — set it in .env (same token the server uses).');
  process.exit(1);
}
const TMDB_HEADERS = { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' };
const OUT = path.join(__dirname, '..', 'data', 'fallbackMovies.json');
const DAILY = path.join(__dirname, '..', 'data', 'dailyMovies.json');
// ~1000 ≈ broad common-movie coverage; the fallback is failure-only so this is
// "the universe a TMDB outage must not break", not "every movie".
const TARGET = 1000;
// Cast cap: validation only needs shared-actor detection and commitPlay trims
// displayed cast to 30 — top 20 billed keeps the committed file ~1MB.
const CAST_CAP = 20;
const SLEEP_MS = 60; // gentle pacing so ~1000 credits calls don't rate-limit

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadDailyIdsAndEntries() {
  // The 553 daily ids MUST all be present (they are exactly the "common
  // movies players actually encounter"); seed the map with their {id,title,
  // year} so we never need a per-movie details call for them.
  try {
    const arr = JSON.parse(fs.readFileSync(DAILY, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function fetchListPage(kind, page) {
  // List endpoints already return id+title+release_date — using them avoids a
  // per-movie /movie/{id} details call (only credits needs a per-id fetch).
  const url = `https://api.themoviedb.org/3/movie/${kind}?language=en-US&page=${page}`;
  const res = await fetch(url, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`TMDB ${kind} p${page} → HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.results) ? json.results : [];
}

function listResultToBase(r) {
  const year = parseInt(String(r.release_date || '').slice(0, 4), 10);
  if (!r.id || !r.title || !Number.isInteger(year)) return null;
  return { id: r.id, title: r.title, year, mediaType: 'movie' };
}

async function fetchCast(id) {
  // The single per-movie call. Strip to the exact shape getOrFetchCredits
  // returns ({cast:[{id,name}]}) so the runtime fallback is drop-in.
  const url = `https://api.themoviedb.org/3/movie/${id}/credits?language=en-US`;
  const res = await fetch(url, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`credits ${id} → HTTP ${res.status}`);
  const json = await res.json();
  return (json.cast || [])
    .filter(a => a && a.name && Number.isInteger(a.id))
    .slice(0, CAST_CAP)
    .map(a => ({ id: a.id, name: a.name }));
}

(async () => {
  // 1) Gather base {id,title,year} for the curated set: daily entries first
  //    (guaranteed present), then top_rated/popular list pages until TARGET.
  const base = new Map(); // id -> {id,title,year,mediaType}
  for (const d of loadDailyIdsAndEntries()) {
    if (d && d.id) base.set(d.id, { id: d.id, title: d.title, year: d.year, mediaType: 'movie' });
  }
  outer: for (const kind of ['top_rated', 'popular']) {
    for (let page = 1; page <= 60 && base.size < TARGET + 60; page++) {
      let results;
      try { results = await fetchListPage(kind, page); }
      catch (e) { console.warn(String(e.message || e)); continue; }
      if (results.length === 0) break;
      for (const r of results) {
        const b = listResultToBase(r);
        if (b && !base.has(b.id)) base.set(b.id, b);
      }
      if (base.size >= TARGET + 60 && kind === 'popular') break outer;
      await sleep(SLEEP_MS);
    }
  }

  // 2) Fetch cast per id. Skip (don't emit) any movie whose credits fail or
  //    are empty — a cast-less fallback entry can never validate a connection.
  const out = [];
  let done = 0;
  for (const b of base.values()) {
    try {
      const cast = await fetchCast(b.id);
      if (cast.length > 0) out.push({ ...b, cast });
    } catch (e) {
      console.warn(`skip ${b.id}: ${e.message || e}`);
    }
    if (++done % 50 === 0) console.log(`credits ${done}/${base.size} … kept ${out.length}`);
    await sleep(SLEEP_MS);
  }

  out.sort((a, b) => a.id - b.id);
  if (out.length < TARGET - 50) {
    // Hard stop rather than committing a thin file — surfaces as a BLOCKER.
    console.error(`Only ${out.length} entries with cast (< ${TARGET - 50}). TMDB likely rate-limiting; re-run.`);
    process.exit(1);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${out.length} entries to ${OUT}`);
})();
```

- [ ] **Step 4: Add the npm script** — in `package.json` `"scripts"`, add after `"build:daily-movies"`:

```json
    "build:fallback-movies": "node scripts/build-fallback-movies.js",
```

- [ ] **Step 5: Run the generator** (requires `.env` `TMDB_READ_TOKEN` — present in this env per Phase 4):

Run: `node scripts/build-fallback-movies.js`
Expected: console progress, then `Wrote <N> entries to …/data/fallbackMovies.json` with `N ≥ 950`.
**If it exits non-zero / `TMDB_READ_TOKEN missing` / cannot reach ~950:** STOP, report **BLOCKED** with the exact message and counts. Do NOT fabricate or hand-edit `data/fallbackMovies.json`.

- [ ] **Step 6: Run the structural test**

Run: `npx jest server/systems/fallbackMovies.data.test.js` → Expected: PASS (3 tests)
Run: `npm test` → Expected: all green, coverage floors hold

- [ ] **Step 7: Commit** (the generated data file IS committed — like `dailyMovies.json`; NEVER `git add coverage/`):

```bash
git add scripts/build-fallback-movies.js data/fallbackMovies.json package.json server/systems/fallbackMovies.data.test.js
git commit -m "Phase 5b (0): one-time fallback-movies generator + committed dataset + data test"
```

---

### Task 1: Read-once fallback loader

**Goal:** `server/systems/fallbackMovies.js` — a read-once-cached loader exposing `getFallbackById(id)` and `allFallback()`, mirroring `dailySystem`'s static-read posture; missing/corrupt file → empty (never throws, never blocks boot).

**Files:**
- Create: `server/systems/fallbackMovies.js`, `server/systems/fallbackMovies.test.js`

**Acceptance Criteria:**
- [ ] Read-once cached: first call `fs.readFileSync(path.join(__dirname,'..','..','data','fallbackMovies.json'))` + parse; subsequent calls reuse the cache
- [ ] `getFallbackById(id)` → the entry `{id,title,year,mediaType,cast}` for `Number(id)`, or `null` if absent
- [ ] `allFallback()` → the array of entries (empty array if none)
- [ ] Missing / corrupt / non-array file → empty (`getFallbackById` always `null`, `allFallback()` `[]`) — **no throw, no process exit** (UNLIKE `dailySystem` which hardcodes an Inception fallback; here empty = "fallback never matches" = exact current behavior)
- [ ] Top-level requires are ONLY `fs` + `path` (leaf module — safe for redisUtils/matchSystem to require at top-level with no cycle)
- [ ] `npx jest server/systems/fallbackMovies.test.js` PASS; `npm test` green; coverage floors hold

**Verify:** `npx jest server/systems/fallbackMovies.test.js` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — create `server/systems/fallbackMovies.test.js`:

```js
// ============================================================================
// fallbackMovies.test.js — Phase 5b read-once loader.
// ============================================================================
const path = require('path');

describe('fallbackMovies loader', () => {
  afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

  test('getFallbackById returns the entry by id (number-coerced), null if absent', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: () => JSON.stringify([
          { id: 11, title: 'Star Wars', year: 1977, mediaType: 'movie', cast: [{ id: 2, name: 'Mark Hamill' }] },
        ]),
      }));
      const fb = require('./fallbackMovies');
      expect(fb.getFallbackById(11)).toMatchObject({ id: 11, title: 'Star Wars' });
      expect(fb.getFallbackById('11')).toMatchObject({ id: 11 }); // string coerced
      expect(fb.getFallbackById(999)).toBeNull();
      expect(fb.allFallback()).toHaveLength(1);
    });
  });

  test('missing/corrupt file → empty (no throw, no exit)', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({ readFileSync: () => { throw new Error('ENOENT'); } }));
      const fb = require('./fallbackMovies');
      expect(fb.getFallbackById(11)).toBeNull();
      expect(fb.allFallback()).toEqual([]);
    });
  });

  test('non-array JSON → empty', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({ readFileSync: () => JSON.stringify({ not: 'an array' }) }));
      const fb = require('./fallbackMovies');
      expect(fb.allFallback()).toEqual([]);
      expect(fb.getFallbackById(1)).toBeNull();
    });
  });

  test('read happens once (cached) across many calls', () => {
    jest.isolateModules(() => {
      const readFileSync = jest.fn(() => JSON.stringify([{ id: 5, title: 'X', year: 2000, mediaType: 'movie', cast: [{ id: 1, name: 'A' }] }]));
      jest.doMock('fs', () => ({ readFileSync }));
      const fb = require('./fallbackMovies');
      fb.getFallbackById(5); fb.getFallbackById(5); fb.allFallback();
      expect(readFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest server/systems/fallbackMovies.test.js`
Expected: FAIL — `Cannot find module './fallbackMovies'`

- [ ] **Step 3: Implement** — create `server/systems/fallbackMovies.js`:

```js
// ============================================================================
// fallbackMovies.js — Phase 5b: read-once local movie DB for TMDB-outage
// resilience. Consulted ONLY by the failure branches of resolveCandidates and
// getOrFetchCredits. Leaf module (fs/path only) — safe to require top-level.
// ============================================================================
const fs = require('fs');
const path = require('path');

// Lazy-load + cache. Static readFileSync is fine here for the same reason
// dailySystem's is: a one-time synchronous boot-ish read of a static file,
// never a hot path (the fallback is only hit on a TMDB failure). UNLIKE
// dailySystem we do NOT hardcode a stand-in on failure — an empty DB simply
// means "fallback never matches", which is exactly today's behavior.
let _cache = null; // { byId: Map<number,entry>, all: entry[] }
function _load() {
  if (_cache) return _cache;
  let all = [];
  try {
    const filePath = path.join(__dirname, '..', '..', 'data', 'fallbackMovies.json');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) all = parsed;
  } catch (err) {
    // Missing/corrupt → empty. Never throw: a broken fallback file must not
    // block boot or change healthy-path behavior.
    all = [];
  }
  const byId = new Map();
  for (const e of all) if (e && Number.isInteger(e.id)) byId.set(e.id, e);
  _cache = { byId, all };
  return _cache;
}

// Entry for a TMDB movie id (number-coerced), or null. Used by the
// getOrFetchCredits + resolveCandidates direct-ID failure branches.
function getFallbackById(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  return _load().byId.get(n) || null;
}

// The full entry array — the resolveCandidates fuzzy failure branch ranks
// these by title with matchSystem's own levenshtein (kept there, not exported
// here, so title-matching stays co-located with the existing fuzzy logic).
function allFallback() {
  return _load().all;
}

module.exports = { getFallbackById, allFallback };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest server/systems/fallbackMovies.test.js` → Expected: PASS (4 tests)
Run: `npm test` → Expected: all green, coverage floors hold

- [ ] **Step 5: Commit**

```bash
git add server/systems/fallbackMovies.js server/systems/fallbackMovies.test.js
git commit -m "Phase 5b (1): read-once fallback movie loader (getFallbackById/allFallback)"
```

---

### Task 2: `getOrFetchCredits` failure-only fallback branch

**Goal:** When the TMDB credits fetch fails (`!ok` or network/timeout throw) for a **movie**, return `{cast}` from the local DB *instead of throwing* — without writing it to the Redis cache. Cache-hit and successful-fetch paths byte-unchanged.

**Files:**
- Modify: `server/redisUtils.js` (`getOrFetchCredits` L126-192; add top-level `require('./systems/fallbackMovies')`)
- Create: `server/redisUtils.fallbackcredits.test.js`

**Acceptance Criteria:**
- [ ] On `!response.ok`: after `await response.arrayBuffer()`, if `mediaType !== 'tv'` and `fallbackMovies.getFallbackById(tmdbId)` has a non-empty `cast` array → `return { cast: fb.cast }` **without** `pubClient.set` (no cache poisoning); else throw `TMDB credits failed: …` exactly as today
- [ ] On a network/timeout fetch throw: a new `catch` consults the same fallback (movie only) → `return { cast: fb.cast }`; else **rethrow the original error** (today's behavior — caller eliminates)
- [ ] Cache-hit fast path (L133-136) and the successful-fetch path (strip → `pubClient.set(…,{EX:604800})` → return) are **byte-unchanged**; `finally` lock release unchanged
- [ ] Fallback path performs NO `pubClient.set`/`get` and NO network — pure in-memory
- [ ] `npx jest server/redisUtils.fallbackcredits.test.js` PASS; `npm test` green incl. unchanged credits behaviour; coverage floors hold

**Verify:** `npx jest server/redisUtils.fallbackcredits.test.js` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — create `server/redisUtils.fallbackcredits.test.js`:

```js
// ============================================================================
// redisUtils.fallbackcredits.test.js — Phase 5b: getOrFetchCredits falls back
// to the local DB on TMDB failure WITHOUT poisoning the Redis cache.
// ============================================================================
const redisUtils = require('./redisUtils');
const fallbackMovies = require('./systems/fallbackMovies');

global.fetch = jest.fn();

function pub() {
  const store = new Map();
  return {
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async () => 1),
    _store: store,
  };
}
const H = { Authorization: 'Bearer t', accept: 'application/json' };
beforeEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

test('non-OK TMDB + movie in fallback → returns local cast, does NOT cache', async () => {
  const p = pub();
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue({ id: 7, cast: [{ id: 1, name: 'A' }] });
  global.fetch.mockResolvedValue({ ok: false, status: 503, arrayBuffer: async () => {} });
  const res = await redisUtils.getOrFetchCredits(p, 7, 'movie', H);
  expect(res).toEqual({ cast: [{ id: 1, name: 'A' }] });
  // No cache poisoning: the credits cache key must NOT have been written.
  const wrote = p.set.mock.calls.some(c => String(c[0]).startsWith('credits:'));
  expect(wrote).toBe(false);
});

test('network throw + movie in fallback → returns local cast (no rethrow)', async () => {
  const p = pub();
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue({ id: 7, cast: [{ id: 9, name: 'B' }] });
  global.fetch.mockRejectedValue(new Error('ETIMEDOUT'));
  await expect(redisUtils.getOrFetchCredits(p, 7, 'movie', H)).resolves.toEqual({ cast: [{ id: 9, name: 'B' }] });
});

test('TMDB failure + NOT in fallback → throws as today', async () => {
  const p = pub();
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue(null);
  global.fetch.mockResolvedValue({ ok: false, status: 500, arrayBuffer: async () => {} });
  await expect(redisUtils.getOrFetchCredits(p, 7, 'movie', H)).rejects.toThrow(/TMDB credits failed: 500/);
});

test('tv mediaType never uses the (movies-only) fallback', async () => {
  const p = pub();
  const spy = jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue({ id: 7, cast: [{ id: 1, name: 'A' }] });
  global.fetch.mockResolvedValue({ ok: false, status: 503, arrayBuffer: async () => {} });
  await expect(redisUtils.getOrFetchCredits(p, 7, 'tv', H)).rejects.toThrow(/TMDB credits failed/);
  expect(spy).not.toHaveBeenCalled();
});

test('healthy fetch path unchanged: still strips + caches with 7-day EX', async () => {
  const p = pub();
  const spy = jest.spyOn(fallbackMovies, 'getFallbackById');
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ cast: [{ id: 3, name: 'C', extra: 'x' }] }) });
  const res = await redisUtils.getOrFetchCredits(p, 7, 'movie', H);
  expect(res).toEqual({ cast: [{ id: 3, name: 'C' }] });
  const setCall = p.set.mock.calls.find(c => String(c[0]).startsWith('credits:'));
  expect(setCall[2]).toEqual({ EX: 604800 });
  expect(spy).not.toHaveBeenCalled(); // fallback never consulted on the healthy path
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest server/redisUtils.fallbackcredits.test.js`
Expected: FAIL — the non-OK/throw tests reject instead of returning fallback cast (branch not implemented yet)

- [ ] **Step 3: Implement** — in `server/redisUtils.js`:

(3a) Add a top-level require near the other requires at the top of the file:

```js
// Phase 5b: local fallback movie DB (leaf module — fs/path only, no cycle).
const fallbackMovies = require('./systems/fallbackMovies');
```

(3b) Replace the non-OK block (currently L165-170):

```js
    if (!response.ok) {
      // Drain the body before throwing so the underlying connection is
      // returned to the pool, not held open while we wait for GC.
      await response.arrayBuffer();
      throw new Error(`TMDB credits failed: ${response.status}`);
    }
```

with (the body-drain is unchanged; the throw is now fallback-gated):

```js
    if (!response.ok) {
      // Drain the body before falling back/throwing so the underlying
      // connection is returned to the pool, not held open until GC.
      await response.arrayBuffer();
      // Phase 5b: TMDB is down for this title. If it's a movie we have
      // locally, return that cast instead of eliminating the player. Do NOT
      // write it to the 7-day Redis cache — once TMDB recovers, the next miss
      // must re-fetch fresh full credits, not serve trimmed fallback for a week.
      if (mediaType !== 'tv') {
        const fb = fallbackMovies.getFallbackById(tmdbId);
        if (fb && Array.isArray(fb.cast) && fb.cast.length > 0) return { cast: fb.cast };
      }
      throw new Error(`TMDB credits failed: ${response.status}`);
    }
```

(3c) Wrap the fetch/`!ok`/strip/set body in a `catch` so a network/timeout throw also falls back. The existing `try {` is at L153 and the existing `} finally {` at L187 — insert a `catch` between the try body and `finally`:

```js
  } catch (err) {
    // Phase 5b: a network/timeout failure (fetch rejected, not a non-OK
    // response) — same resilience as the !ok branch above. Movie-only; the
    // !ok branch's own fallback already returned, so reaching here means a
    // thrown fetch (or a rethrow we should not swallow if uncovered).
    if (mediaType !== 'tv') {
      const fb = fallbackMovies.getFallbackById(tmdbId);
      if (fb && Array.isArray(fb.cast) && fb.cast.length > 0) return { cast: fb.cast };
    }
    throw err; // uncovered: today's behavior (caller eliminates)
  } finally {
```

(Implementer: confirm the `!ok` branch's own `throw` is caught by this new `catch` — it is, and it correctly re-attempts the same fallback then rethrows; that is harmless and keeps both failure modes identical. Verify the success-path `return stripped` still occurs inside the `try` before `finally`, and the cache-hit early `return` at L133-136 is OUTSIDE/above this `try` and untouched.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest server/redisUtils.fallbackcredits.test.js` → Expected: PASS (5 tests)
Run: `npx jest server/redisUtils.personcredits.test.js` → Expected: PASS unchanged (Phase 5a person-credits cache untouched)
Run: `npm test` → Expected: all green, coverage floors hold

- [ ] **Step 5: Commit**

```bash
git add server/redisUtils.js server/redisUtils.fallbackcredits.test.js
git commit -m "Phase 5b (2): getOrFetchCredits failure-only local fallback (no cache poisoning)"
```

---

### Task 3: `resolveCandidates` failure-only fallback branches

**Goal:** When the direct-ID details fetch or the fuzzy search fetch fails (throw or `!ok`), resolve from the local DB (by id / by title) instead of letting the failure propagate to elimination. Healthy fetch paths byte-unchanged.

**Files:**
- Modify: `server/systems/matchSystem.js` (`resolveCandidates` L359-413; add top-level `require('./fallbackMovies')`)
- Create: `server/systems/matchSystem.fallback.test.js`

**Acceptance Criteria:**
- [ ] Direct-ID path: wrap the details `fetch` (+`.json()`); on throw OR `!detailsRes.ok` → `fb = fallbackMovies.getFallbackById(direct.id)`; if present set `topCandidates = [{ id: fb.id, media_type: 'movie', name: fb.title, title: fb.title, release_date: `${fb.year}-01-01`, first_air_date: undefined, poster_path: null }]` (same shape the live block produces); else leave `topCandidates = []` (→ existing typo/elim path)
- [ ] Fuzzy path: wrap the search `fetch` (+`.json()`); on throw OR `!searchRes.ok` → rank `fallbackMovies.allFallback()` by `levenshtein(title.toLowerCase(), movie.toLowerCase())`, apply the SAME `themesSystem.matchesTheme(room.theme, …)` filter the live path applies (build a TMDB-shaped object `{ id, title, media_type:'movie', release_date:`${year}-01-01` }` for the matcher), take top 5, map to the same candidate shape as the direct fallback; else `topCandidates = []`
- [ ] The healthy direct path (L365-381) and healthy fuzzy path (L384-410) — including the existing `.json()`, theme filter, levenshtein sort, `slice(0,5)` — are **byte-unchanged**; the fallback is only reached when the `fetch`/`.json()` throws or the response is `!ok`
- [ ] Top-level requires gain `require('./fallbackMovies')` (leaf, no cycle); `levenshtein`/`themesSystem` reused (not duplicated)
- [ ] `npx jest server/systems/matchSystem.fallback.test.js` PASS; `npx jest server/systems/matchSystem.test.js server/systems/matchSystem.botmove.test.js` PASS unchanged; `npm test` green; coverage floors hold

**Verify:** `npx jest server/systems/matchSystem.fallback.test.js` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** — create `server/systems/matchSystem.fallback.test.js`:

```js
// ============================================================================
// matchSystem.fallback.test.js — Phase 5b: resolveCandidates falls back to the
// local DB when TMDB resolve (details/search) fails.
// ============================================================================
const matchSystem = require('./matchSystem');
const fallbackMovies = require('./fallbackMovies');

global.fetch = jest.fn();
const H = { Authorization: 'Bearer t', accept: 'application/json' };
const room = (over = {}) => ({ allowTvShows: false, theme: 'any', ...over });

beforeEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

test('direct-ID fetch throws + id in fallback → local candidate (live shape)', async () => {
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue({ id: 27205, title: 'Inception', year: 2010, mediaType: 'movie', cast: [{ id: 1, name: 'L' }] });
  global.fetch.mockRejectedValue(new Error('ETIMEDOUT'));
  const out = await matchSystem.resolveCandidates(room(), null, 27205, 'movie', H);
  expect(out).toEqual([{ id: 27205, media_type: 'movie', name: 'Inception', title: 'Inception', release_date: '2010-01-01', first_air_date: undefined, poster_path: null }]);
});

test('direct-ID non-OK + id NOT in fallback → empty (existing eliminate path)', async () => {
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue(null);
  global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
  const out = await matchSystem.resolveCandidates(room(), null, 999999, 'movie', H);
  expect(out).toEqual([]);
});

test('fuzzy search throws + title in fallback → levenshtein-ranked local candidate', async () => {
  jest.spyOn(fallbackMovies, 'allFallback').mockReturnValue([
    { id: 1, title: 'The Matrix', year: 1999, mediaType: 'movie', cast: [{ id: 1, name: 'K' }] },
    { id: 2, title: 'Matrix Reloaded', year: 2003, mediaType: 'movie', cast: [{ id: 1, name: 'K' }] },
  ]);
  global.fetch.mockRejectedValue(new Error('ETIMEDOUT'));
  const out = await matchSystem.resolveCandidates(room(), 'the matrix', null, null, H);
  expect(out[0]).toMatchObject({ id: 1, title: 'The Matrix', media_type: 'movie', release_date: '1999-01-01' });
});

test('healthy direct path unchanged (fallback never consulted)', async () => {
  const spy = jest.spyOn(fallbackMovies, 'getFallbackById');
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 5, title: 'Live', release_date: '2020-05-01', poster_path: '/p.jpg' }) });
  const out = await matchSystem.resolveCandidates(room(), null, 5, 'movie', H);
  expect(out[0]).toMatchObject({ id: 5, title: 'Live', poster_path: '/p.jpg' });
  expect(spy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest server/systems/matchSystem.fallback.test.js`
Expected: FAIL — direct/fuzzy fallback tests reject/throw (no fallback yet); healthy test passes

- [ ] **Step 3: Implement** — in `server/systems/matchSystem.js`:

(3a) Add to the top-level requires (next to the other `require`s, ~L9-14):

```js
// Phase 5b: local fallback movie DB (leaf module — fs/path only, no cycle).
const fallbackMovies = require('./fallbackMovies');
```

(3b) Add a private helper just above `resolveCandidates` (before L359):

```js
// Phase 5b: a fallback entry → the exact candidate shape resolveCandidates'
// live blocks produce, so enrichWithCredits/validateChainConnection are shape-
// agnostic. mediaType is always 'movie' (the fallback DB is movies-only).
function _fallbackCandidate(entry) {
  return {
    id: entry.id,
    media_type: 'movie',
    name: entry.title,
    title: entry.title,
    release_date: `${entry.year}-01-01`,
    first_air_date: undefined,
    poster_path: null,
  };
}
```

(3c) Wrap the direct-ID details fetch. Replace L365-381 (`if (direct) { … }`) with — the live `topCandidates = [{…}]` assignment is byte-unchanged, only wrapped:

```js
  if (direct) {
    const lookupUrl = `${TMDB_API_BASE}/${direct.mediaType}/${direct.id}?language=en-US`;
    try {
      const detailsRes = await fetch(lookupUrl, { headers, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) });
      if (!detailsRes.ok) throw new Error(`TMDB details ${detailsRes.status}`);
      const detailsData = await detailsRes.json();
      if (detailsData && detailsData.id) {
        topCandidates = [{
          id: detailsData.id,
          // Use the validated mediaType, never the raw client string.
          media_type: direct.mediaType,
          name: detailsData.name,
          title: detailsData.title || detailsData.name,
          release_date: detailsData.release_date,
          first_air_date: detailsData.first_air_date,
          poster_path: detailsData.poster_path
        }];
      }
    } catch (e) {
      // Phase 5b: TMDB details unreachable. If we have this movie locally,
      // resolve from it so the player isn't eliminated by an outage. Movies
      // only (direct.mediaType may be 'tv' — fallback DB has no TV).
      if (direct.mediaType === 'movie') {
        const fb = fallbackMovies.getFallbackById(direct.id);
        if (fb) topCandidates = [_fallbackCandidate(fb)];
      }
      // Uncovered/TV → topCandidates stays [] → existing typo/eliminate path.
    }
  }
```

(3d) Wrap the fuzzy search fetch. Replace L384-410 (`if (topCandidates.length === 0 && movie) { … }`) — the live filter/sort/slice is byte-unchanged, only wrapped, with a fallback `catch`:

```js
  if (topCandidates.length === 0 && movie) {
    const searchType = room.allowTvShows ? 'multi' : 'movie';
    try {
      const searchRes = await fetch(
        `${TMDB_API_BASE}/search/${searchType}?query=${encodeURIComponent(movie)}&include_adult=false&language=en-US&page=1`,
        { headers, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) }
      );
      if (!searchRes.ok) throw new Error(`TMDB search ${searchRes.status}`);
      const searchData = await searchRes.json();
      let results = (searchData.results || []).filter(r => r.media_type !== 'person');

      // L1: Apply theme filter BEFORE the levenshtein sort — otherwise we
      // could end up picking the closest-string-match result that doesn't
      // fit the theme and still letting it through downstream. Filtering
      // first means the candidates we hand to validation are already
      // theme-compliant.
      if (room.theme && room.theme !== 'any') {
        results = results.filter(r => themesSystem.matchesTheme(room.theme, r));
      }

      results.sort((a, b) => {
        const titleA = (a.media_type === 'tv' ? a.name : a.title || a.name || '').toLowerCase();
        const titleB = (b.media_type === 'tv' ? b.name : b.title || b.name || '').toLowerCase();
        const target = movie.toLowerCase();
        return levenshtein(titleA, target) - levenshtein(titleB, target);
      });

      topCandidates = results.slice(0, 5);
    } catch (e) {
      // Phase 5b: TMDB search unreachable. Rank the local DB by title with
      // the SAME levenshtein + theme filter the live path uses, so an outage
      // doesn't eliminate a player who typed a common title.
      const target = movie.toLowerCase();
      let local = fallbackMovies.allFallback().map(entry => ({
        // TMDB-shaped just enough for matchesTheme + the sort key.
        id: entry.id, title: entry.title, media_type: 'movie',
        release_date: `${entry.year}-01-01`, _entry: entry,
      }));
      if (room.theme && room.theme !== 'any') {
        local = local.filter(r => themesSystem.matchesTheme(room.theme, r));
      }
      local.sort((a, b) =>
        levenshtein(a.title.toLowerCase(), target) - levenshtein(b.title.toLowerCase(), target));
      topCandidates = local.slice(0, 5).map(r => _fallbackCandidate(r._entry));
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest server/systems/matchSystem.fallback.test.js` → Expected: PASS (4 tests)
Run: `npx jest server/systems/matchSystem.test.js server/systems/matchSystem.botmove.test.js` → Expected: PASS unchanged (live submit/bot behaviour intact)
Run: `npm test` → Expected: all green, coverage floors hold

- [ ] **Step 5: Commit**

```bash
git add server/systems/matchSystem.js server/systems/matchSystem.fallback.test.js
git commit -m "Phase 5b (3): resolveCandidates failure-only local fallback (direct + fuzzy)"
```

---

### Task 4: Simulated-outage integration test

**Goal:** End-to-end proof that, with TMDB fully unavailable, a submit of a covered movie is NOT eliminated, an uncovered movie still IS (unchanged), and a covered bot move survives.

**Files:**
- Create: `server/systems/fallbackMovies.integration.test.js`

**Acceptance Criteria:**
- [ ] With `global.fetch` rejecting (full TMDB outage) and `redisUtils.getOrFetchCredits` UNMOCKED in real terms (use the real pipeline via mocked `pubClient` cache-miss + the real fallback), a `submitMovie` of a fallback-covered movie that connects to the chain → `room.chain` grows, player NOT eliminated
- [ ] Same outage, an uncovered movie → player eliminated (today's behavior, unchanged)
- [ ] Same outage, a `submitBotMove` (direct-ID, covered, connecting) → chain grows, bot NOT eliminated
- [ ] `npx jest server/systems/fallbackMovies.integration.test.js` PASS; `npm test` fully green; coverage floors hold

**Verify:** `npx jest server/systems/fallbackMovies.integration.test.js` → PASS

**Steps:**

- [ ] **Step 1: Write the test** — create `server/systems/fallbackMovies.integration.test.js`. (TDD note: this is an integration assertion over Tasks 2+3 *already implemented*; write it, run it, it should pass. If it FAILS: first determine whether it's a real Task 2/3 production gap (the fallback genuinely didn't prevent elimination / didn't resolve) — fix the *implementation* in that case, never weaken an assertion. The `jest.mock('../redisUtils')` + `jest.requireActual` wiring that makes the REAL `getOrFetchCredits` run is harness plumbing — if that specific wiring needs adjusting so the real function actually executes (e.g. the auto-mock shadows it), adjusting the *wiring* is allowed; the *assertions* (chain grows / player alive / uncovered eliminated) must not change.)

```js
// ============================================================================
// fallbackMovies.integration.test.js — Phase 5b: a full TMDB outage must NOT
// eliminate a player submitting a covered movie (the whole point of L9).
// ============================================================================
const matchSystem = require('./matchSystem');
const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');
const fallbackMovies = require('./fallbackMovies');

jest.mock('../redisUtils');
global.fetch = jest.fn();

function buildRoom(over = {}) {
  return {
    id: 'TEST', status: 'playing', isValidating: false, gameMode: 'classic',
    players: [
      { id: 's1', name: 'H', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 'h' },
      { id: 'bot_1', name: 'Bot', isHost: false, isBot: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, difficulty: 'normal', stableId: null },
    ],
    spectators: [],
    chain: [{ playerId: 's1', playerName: 'H', movie: { id: 1, title: 'First', year: '2000', cast: [{ id: 42, name: 'Shared' }], mediaType: 'movie' }, matchedActors: [] }],
    usedMovies: ['movie:1'], hardcoreMode: false, previousSharedActors: [],
    allowTvShows: false, theme: 'any', isPublic: false, timerMultiplier: 0,
    turnExpiresAt: Date.now() + 60000, currentTurnIndex: 0, currentTurnRetries: 0, ...over,
  };
}
let mockIo, ctx, mockSocket;
beforeEach(() => {
  jest.clearAllMocks(); jest.restoreAllMocks();
  mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
  mockSocket = { id: 's1', emit: jest.fn() };
  ctx = { io: mockIo, pubClient: {}, TMDB_HEADERS: { Authorization: 'Bearer t', accept: 'application/json' }, logger: { error: jest.fn() } };
  redisUtils.acquireSubmitLock.mockResolvedValue('tok');
  redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
  redisUtils.saveLobby.mockResolvedValue(undefined);
  // Cache miss + lock claim so getOrFetchCredits runs its fetch (which fails)
  // then hits the Phase 5b fallback. getOrFetchCredits is the REAL impl.
  redisUtils.getOrFetchCredits.mockImplementation((...a) => jest.requireActual('../redisUtils').getOrFetchCredits(...a));
  global.fetch.mockRejectedValue(new Error('TMDB DOWN')); // full outage
});
afterEach(() => gameLogic.clearTurnTimeout('TEST'));

test('covered connecting movie survives a full TMDB outage (not eliminated)', async () => {
  const room = buildRoom();
  redisUtils.getLobby.mockResolvedValue(room);
  // Covered movie #2 shares actor 42 with the chain's last node.
  jest.spyOn(fallbackMovies, 'getFallbackById').mockImplementation(id =>
    id === 2 ? { id: 2, title: 'Second', year: 2005, mediaType: 'movie', cast: [{ id: 42, name: 'Shared' }] } : null);
  // pubClient cache-miss shim so the real getOrFetchCredits reaches its fetch.
  ctx.pubClient = { get: async () => null, set: async () => 'OK', del: async () => 1 };

  await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', tmdbId: 2, mediaType: 'movie' });

  expect(room.chain.length).toBe(2);
  expect(room.players.find(p => p.id === 's1').isAlive).toBe(true);
});

test('uncovered movie during the same outage still eliminates (unchanged)', async () => {
  const room = buildRoom();
  redisUtils.getLobby.mockResolvedValue(room);
  jest.spyOn(fallbackMovies, 'getFallbackById').mockReturnValue(null); // not covered
  ctx.pubClient = { get: async () => null, set: async () => 'OK', del: async () => 1 };

  await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', tmdbId: 424242, mediaType: 'movie' });

  expect(room.players.find(p => p.id === 's1').isAlive).toBe(false);
});

test('covered bot move survives the outage (direct-ID, connecting)', async () => {
  const room = buildRoom({ currentTurnIndex: 1 });
  redisUtils.getLobby.mockResolvedValue(room);
  jest.spyOn(fallbackMovies, 'getFallbackById').mockImplementation(id =>
    id === 2 ? { id: 2, title: 'Second', year: 2005, mediaType: 'movie', cast: [{ id: 42, name: 'Shared' }] } : null);
  ctx.pubClient = { get: async () => null, set: async () => 'OK', del: async () => 1 };

  await matchSystem.submitBotMove(ctx, 'TEST', 'bot_1', { tmdbId: 2, mediaType: 'movie' });

  expect(room.chain.length).toBe(2);
  expect(room.players.find(p => p.id === 'bot_1').isAlive).toBe(true);
});
```

- [ ] **Step 2: Run**

Run: `npx jest server/systems/fallbackMovies.integration.test.js`
Expected: PASS (3 tests). If any FAILS for a *behavioral* reason (fallback didn't prevent elimination / didn't resolve), the gap is in Task 2/3 production code — fix the implementation, never weaken the assertions. If it fails because the real `getOrFetchCredits` isn't actually executing (auto-mock shadowing), repair only the mock/`requireActual` wiring so it does — assertions unchanged.

- [ ] **Step 3: Full suite + module-load sanity**

Run: `npm test` → Expected: all green, coverage floors hold
Run: `node -e "require('./server/systems/fallbackMovies'); require('./server/redisUtils'); require('./server/systems/matchSystem'); console.log('load ok')"` → `load ok`

- [ ] **Step 4: Commit**

```bash
git add server/systems/fallbackMovies.integration.test.js
git commit -m "Phase 5b (4): simulated-TMDB-outage integration test (covered survives, uncovered unchanged)"
```

---

## Post-task: final review & finishing

After Task 4 passes both reviews and `.tasks.json` is fully synced:

1. **Final opus whole-branch holistic review** over `main..phase5b-fallback-movie-db` — focus: the failure-only invariant (healthy cache-hit + successful-fetch + healthy resolve paths are byte-unchanged — `git diff` shows only added try/catch wrappers and new branches, the live assignments verbatim); uncovered-during-outage keeps today's exact eliminate behavior (zero game-rule change); the fallback path does NO network and NO Redis write; loader missing/corrupt file can't block boot; no require cycle (fallbackMovies is fs/path-only leaf); WHY-comments on every change; the committed `data/fallbackMovies.json` matches the structural test; no scope creep (no poster/TV fallback, no elimination-semantics change).
2. **finishing-a-development-branch:** full `npm test` green, then push `phase5b-fallback-movie-db` + `gh pr create` base `main`. PR body MUST flag OUTSTANDING post-merge verification: the suite mocks Redis/TMDB and exercises no real boot or real outage — after merge, confirm the Render deploy is `live`, and run a real TMDB-failure simulation showing a covered-movie submit surviving. **Do NOT merge / push to main / deploy — hand to the user.**
3. Create `project_phase5b_fallback_db_shipped.md` + update `MEMORY.md` index; note this is the FINAL phase — once 5b is merged+deployed+verified (along with the user's still-outstanding #18/#19 deploy verification) the entire 5-phase post-2026-05-16 remediation is complete.
