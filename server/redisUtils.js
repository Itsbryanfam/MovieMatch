// Phase 5b: local fallback movie DB (leaf module — fs/path only, no cycle).
const fallbackMovies = require('./systems/fallbackMovies');
// T4c audit fix: single source of truth for the 5s TMDB fetch ceiling (was
// duplicated here + in heroPuzzle/lobbySystem/matchSystem). constants.js is a
// leaf module — no require cycle.
const { TMDB_FETCH_TIMEOUT_MS } = require('./constants');

// T7c audit fix: single source of truth for "is this a structurally valid
// lobby id?". WHY this charset: every legitimate id conforms to it BY
// CONSTRUCTION — generated codes are 6 chars from a fixed uppercase-alnum
// alphabet (generateLobbyId), and the daily id is
// `DAILY-<stableId.slice(0,12)>-<yyyymmdd>` uppercased and capped at 32. The
// daily stableId segment carries the client's `p_` prefix (getStableId mints
// `'p_'+base36`), so after uppercasing it contains an UNDERSCORE — which is
// why this regex is the T1f form WIDENED to add `_` (the bare `/^[A-Z0-9-]/`
// would have wrongly rejected every real daily lock/read). 32 is the hard cap
// the daily `.slice(0,32)` already enforces and the largest a generated code
// or daily id can be. Anything else is a client-forged value we must not let
// become a Redis key.
const VALID_LOBBY_ID = /^[A-Z0-9_-]{1,32}$/;
function isValidLobbyId(id) {
  return typeof id === 'string' && VALID_LOBBY_ID.test(id);
}

async function getLobby(pubClient, id) {
  // T7c: defense-in-depth chokepoint. Only joinLobby validated lobbyId before
  // T7c; every other handler forwarded the raw client value into this GET. A
  // malformed id can never name a real lobby, so no-op WITHOUT issuing the
  // (potentially huge-key) GET rather than letting attacker-controlled bytes
  // hit Redis. Returns null — identical to a normal cache miss, so callers
  // already handle it as "lobby not found".
  if (!isValidLobbyId(id)) return null;
  const data = await pubClient.get(`lobby:${id}`);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch (err) {
    // Corrupt blob — could be from a bad release or manual surgery. Drop the
    // key so subsequent reads don't keep hitting the bad value, and let the
    // caller handle "lobby not found" the same way it would for any miss.
    // .catch swallows secondary cleanup failures so a Redis blip on delete
    // can't mask the original parse problem.
    await pubClient.del(`lobby:${id}`).catch(() => {});
    return null;
  }
}

async function saveLobby(pubClient, id, state) {
  await pubClient.setEx(`lobby:${id}`, 7200, JSON.stringify(state));
}



async function deleteLobby(pubClient, id) {
  await pubClient.del(`lobby:${id}`);
  await removeFromActiveLobbies(pubClient, id);
}

async function addToActiveLobbies(pubClient, id) {
  await pubClient.sAdd('activeLobbies', id);
}

async function removeFromActiveLobbies(pubClient, id) {
  await pubClient.sRem('activeLobbies', id);
}

async function getAllLobbies(pubClient) {
  const ids = await pubClient.sMembers('activeLobbies');
  if (ids.length === 0) return [];

  // Single batched mGet replaces N individual GETs — one network round-trip
  // total instead of N. Important for the public-lobby browser, which calls
  // this every refresh.
  const keys = ids.map(id => `lobby:${id}`);
  const blobs = await pubClient.mGet(keys);

  // Same lazy-prune pattern as getLeaderboard: any lobby whose key has
  // expired but is still listed in activeLobbies is stale; remove it in batch
  // rather than one-at-a-time as the old loop did.
  const lobbies = [];
  const stale = [];
  blobs.forEach((data, i) => {
    if (data) {
      try {
        lobbies.push(JSON.parse(data));
      } catch {
        // Corrupt blob — treat as stale, same as missing.
        stale.push(ids[i]);
      }
    } else {
      stale.push(ids[i]);
    }
  });
  if (stale.length > 0) {
    await pubClient.sRem('activeLobbies', stale).catch(() => {});
  }
  return lobbies;
}

// Redis-backed socket → lobby mapping
async function getSocketLobby(pubClient, socketId) {
  const lobbyId = await pubClient.get(`socket:${socketId}`);
  return lobbyId;
}

async function setSocketLobby(pubClient, socketId, lobbyId) {
  await pubClient.setEx(`socket:${socketId}`, 7200, lobbyId);
}

async function deleteSocketLobby(pubClient, socketId) {
  await pubClient.del(`socket:${socketId}`);
}

// Persistent wins (30-day TTL)
async function getPlayerWins(pubClient, playerId) {
  const wins = await pubClient.get(`playerWins:${playerId}`);
  return wins ? parseInt(wins, 10) : 0;
}

async function incrementPlayerWins(pubClient, playerId, amount = 1) {
  const ttlSec = 30 * 24 * 60 * 60; // 30-day expiry — abandoned players age out
  // multi() pipelines both commands in one round-trip and runs them atomically.
  // Either both succeed or both fail — no half-state where the key exists with
  // no TTL (which would defeat the 30-day intent).
  await pubClient.multi()
    .incrBy(`playerWins:${playerId}`, amount)
    .expire(`playerWins:${playerId}`, ttlSec)
    .exec();
}

async function setPlayerWins(pubClient, playerId, wins) {
  await pubClient.setEx(`playerWins:${playerId}`, 30 * 24 * 60 * 60, wins.toString());
}

// T4c: TMDB_FETCH_TIMEOUT_MS now imported from ./constants (single source of
// truth). Critical here: this module's fetches run inside the submit-movie
// lock — any hang would freeze the room until the 30s lock TTL expires, which
// is exactly why the 5s ceiling exists.

// L10: Cache schema version. Bump this whenever the shape of the cached
// credits payload changes — old entries simply expire over the 7-day TTL,
// and new fetches start landing under the new prefix immediately. Documented
// schema history (so future authors know which bump was for what):
//   v1 — { cast: [{ name }] } (initial)
//   v2 — { cast: [{ id, name }] } (H4 — id-based actor matching)
const CREDITS_CACHE_VERSION = 'v2';

// T1 audit fix T1d-ext: lazy-memoized module logger for degraded-path
// warnings (same pattern + rationale as botSystem._getLogger): pino is only
// instantiated the first time a degraded log actually fires, so requiring
// this module stays side-effect-free for the many unit tests that drive it
// with a bare mock pubClient. Memoized so repeated flaps reuse one instance
// and keep stable pid correlation in prod logs.
let _logger = null;
function _getLogger() {
  if (!_logger) _logger = require('pino')();
  return _logger;
}

/**
 * Get credits from Redis cache or fetch from TMDB and cache for 30 days.
 *
 * Cache key embeds CREDITS_CACHE_VERSION so a payload-shape change is a
 * single-line bump above. Reading a v1 entry as v2 would silently lose the
 * id and defeat id-based actor matching, so the version segment ensures we
 * never cross the streams. Old-version entries simply expire; new submits
 * after deploy land in the current version from the first miss.
 */
async function getOrFetchCredits(pubClient, tmdbId, mediaType, headers) {
  const cacheKey = `credits:${CREDITS_CACHE_VERSION}:${mediaType}:${tmdbId}`;
  // Companion lock for stampede protection — see logic below.
  // 10s expiry > the 5s TMDB timeout, so the lock can't outlive a stuck fetch.
  const lockKey = `${cacheKey}:fetching`;

  // Cache hit — fast path. Most calls land here in steady state.
  // T1 audit fix T1d: this read (and the lock SET below) previously ran
  // OUTSIDE the try that owns the TMDB-fetch + Phase-5b-fallback path.
  // node-redis v4 rejects in-flight commands when the socket flaps, so a
  // blip exactly here propagated to matchSystem's enrichWithCredits catch,
  // which answers `cast: []` — zero shared actors — and the player is
  // eliminated "Invalid movie connection" on a CORRECT move. A Redis error
  // on this path must instead degrade to cache-MISS semantics and fall
  // through to the fetch (which has its own try + local-DB fallback).
  // eslint-disable-next-line no-useless-assignment -- T5d: the `= null` init is intentional defensive scaffolding paired with the catch below (cache-miss-on-Redis-flap semantics — see the multi-line WHY above this block). Not auto-fixable without weakening that contract.
  let cached = null;
  try {
    cached = await pubClient.get(cacheKey);
  } catch {
    cached = null; // flap = miss; TMDB below is the actual source of truth
  }
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // T1d: corrupt cache entry (torn write / manual poke) is a miss, not a
      // fatal — fall through; the fresh write below self-heals the key.
    }
  }

  // Try to claim the right to fetch. NX returns null if another worker is
  // already fetching the same movie — without this, five concurrent submits
  // for the same uncached title would all hit TMDB.
  // T1d: a REJECTED set (Redis flap — distinct from a clean null) forfeits
  // stampede protection for this call on purpose: a duplicate TMDB fetch is
  // an acceptable price, eliminating a player on a correct move is not
  // (correctness over efficiency in degraded mode). lockSubsystemUp also
  // gates the wait-and-retry below — retrying a flapping Redis would burn
  // 250ms inside the submit lock just to reject again.
  let gotLock = null;
  let lockSubsystemUp = true;
  try {
    gotLock = await pubClient.set(lockKey, '1', { NX: true, EX: 10 });
  } catch {
    lockSubsystemUp = false;
  }
  if (!gotLock && lockSubsystemUp) {
    // Another worker is already fetching. Briefly wait and retry the cache —
    // typical TMDB call returns in <1s, so 250ms catches most of them.
    await new Promise(r => setTimeout(r, 250));
    // T1d: the retry read degrades identically — a flap or corrupt JSON here
    // means we fetch ourselves rather than reject out to the eliminator.
    try {
      const retry = await pubClient.get(cacheKey);
      if (retry) return JSON.parse(retry);
    } catch {
      // fall through and fetch ourselves
    }
    // Cache still empty after the wait — fall through and fetch ourselves
    // rather than hang. We'd rather make a duplicate TMDB call than block
    // the user's submit indefinitely.
  }

  try {
    // Fetch from TMDB. AbortSignal.timeout enforces the 5s ceiling so a
    // hung TMDB response can't stall the submit pipeline.
    let response;
    if (mediaType === 'tv') {
      const tvUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/aggregate_credits?language=en-US`;
      response = await fetch(tvUrl, { headers, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) });
    } else {
      const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/credits?language=en-US`;
      response = await fetch(url, { headers, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) });
    }

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
        // length>0 guard: an entry with an empty cast is no better than no
        // entry (a 0-actor "match" can't validate any chain connection) —
        // treat it as uncovered and fall through to the existing throw.
        if (fb && Array.isArray(fb.cast) && fb.cast.length > 0) return { cast: fb.cast };
      }
      throw new Error(`TMDB credits failed: ${response.status}`);
    }

    const raw = await response.json();

    // Strip to id+name per cast member — id powers H4 (correct id-based
    // matching across name collisions and punctuation drift), name remains
    // for client display. Raw TMDB cast entries are ~50 fields each; the
    // stripped form keeps Redis at ~1-2KB per movie.
    const stripped = {
      cast: (raw.cast || [])
        .filter(a => a && a.name) // skip malformed entries (rare but real on obscure films)
        .map(actor => ({ id: actor.id, name: actor.name }))
    };

    // T1 audit fix T1d-ext: the write-back is Redis-only bookkeeping that
    // runs AFTER TMDB already answered — at this point `stripped` is valid
    // credits we hold. It used to share the fetch path's try, so a socket
    // flap on this single SET fell into the catch below; for titles outside
    // the local fallback DB that re-threw → matchSystem's enrichWithCredits
    // catch → cast: [] → player eliminated on a CORRECT move. Isolated
    // try/catch: log and continue. Worst case of a lost write-back is one
    // duplicate TMDB fetch on the next miss — never a wrong elimination.
    // (The other post-success Redis call, the lock-release del in finally,
    // already swallows errors via .catch.)
    try {
      await pubClient.set(cacheKey, JSON.stringify(stripped), { EX: 604800 }); // 7 days
    } catch (cacheErr) {
      _getLogger().warn(cacheErr, 'credits cache write-back failed — returning fetched credits uncached');
    }

    return stripped;
  } catch (err) {
    // Phase 5b: two cases reach here. (1) Network/timeout: fetch() rejected
    // (ETIMEDOUT/AbortError/etc.) — this path had NO catch before; try the
    // local fallback. (2) !ok + NOT in fallback: the throw above is caught
    // here, getFallbackById returns null again (a pure idempotent Map read,
    // no side effects) and we fall through to re-throw the ORIGINAL error
    // unchanged via `throw err` — behavior identical to baseline. (!ok + IN
    // fallback already returned before the throw, so it never reaches here.)
    // Movie-only; tv falls straight to `throw err`.
    if (mediaType !== 'tv') {
      const fb = fallbackMovies.getFallbackById(tmdbId);
      // length>0 guard: an entry with an empty cast is no better than no
      // entry (a 0-actor "match" can't validate any chain connection) —
      // treat it as uncovered and fall through to the existing throw.
      if (fb && Array.isArray(fb.cast) && fb.cast.length > 0) return { cast: fb.cast };
    }
    throw err; // uncovered: today's behavior (caller eliminates)
  } finally {
    // Release only if we actually held the lock — the fall-through path above
    // proceeds without holding it.
    if (gotLock) await pubClient.del(lockKey).catch(() => {});
  }
}

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

  // T7d audit fix: read-path symmetry with getOrFetchCredits' T1d discipline.
  // node-redis v4 rejects in-flight commands on a socket flap, so a bare
  // `get` + `JSON.parse` here used to propagate (a flap rejected the lookup;
  // a corrupt cached blob threw SyntaxError and persisted to TTL). Degrade to
  // cache-MISS: any read/parse error → fall through to the TMDB fetch (the
  // actual source of truth), which self-heals the entry on its write-back.
  // eslint-disable-next-line no-useless-assignment -- the `= null` init is intentional defensive scaffolding paired with the catch below (cache-miss-on-Redis-flap semantics — see the multi-line WHY above). Mirrors the identical disable in getOrFetchCredits.
  let cached = null;
  try {
    cached = await pubClient.get(cacheKey);
  } catch {
    cached = null; // flap = miss; TMDB below is the actual source of truth
  }
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Corrupt entry (torn write / manual poke) → miss; the write-back below
      // overwrites the bad blob with fresh credits.
    }
  }

  // NX claim: only one worker fetches an uncached person; the rest wait+retry
  // the cache. Without it, a busy bot turn could fan out duplicate TMDB calls.
  // T7d: a REJECTED lock-set (Redis flap) forfeits stampede protection for
  // this call rather than throwing — a duplicate TMDB fetch is the acceptable
  // price (same tradeoff getOrFetchCredits makes), and lockSubsystemUp gates
  // the wait-and-retry so we don't burn 250ms retrying a flapping Redis.
  let gotLock = null;
  let lockSubsystemUp = true;
  try {
    gotLock = await pubClient.set(lockKey, '1', { NX: true, EX: 10 });
  } catch {
    lockSubsystemUp = false;
  }
  if (!gotLock && lockSubsystemUp) {
    await new Promise(r => setTimeout(r, 250));
    // T7d: the retry read degrades identically — a flap or corrupt JSON here
    // means we fetch ourselves rather than reject out to the bot generator.
    try {
      const retry = await pubClient.get(cacheKey);
      if (retry) return JSON.parse(retry);
    } catch {
      // fall through and fetch ourselves
    }
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
    // T4i audit fix: same exposure fixed for getOrFetchCredits in 7ebeaa5
    // (T1d-ext). The 7-day cache write-back is Redis-only bookkeeping that runs
    // AFTER TMDB already answered — at this point `stripped` is a real
    // filmography we hold. It used to share this function's try with no
    // isolating catch, so a socket flap on this single SET propagated out of
    // getOrFetchPersonCredits and rejected the bot's filmography lookup despite
    // a SUCCESSFUL fetch (the bot would whiff its turn over a transient blip
    // unrelated to the fetch). Isolate: log and continue — worst case of a lost
    // write-back is one duplicate TMDB fetch on the next miss, never a failed
    // bot move. (The lock-release del in finally already swallows via .catch.)
    try {
      await pubClient.set(cacheKey, JSON.stringify(stripped), { EX: 604800 }); // 7 days
    } catch (cacheErr) {
      _getLogger().warn(cacheErr, 'person-credits cache write-back failed — returning fetched credits uncached');
    }
    return stripped;
  } finally {
    if (gotLock) await pubClient.del(lockKey).catch(() => {});
  }
}

// Lua compare-and-delete: only delete if the stored value still matches our token.
// Runs server-side in Redis so the GET and DEL are atomic — no TOCTOU window
// where another process could grab the lock between our check and our delete.
const SUBMIT_LOCK_RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end`;

// ============================================================================
// T2 LOCK ORDERING RULE (audit P1-3) — read before touching either helper.
// ============================================================================
// Two lock classes guard the same lobby blob, and they are STRICTLY ordered:
//   OUTER — lock:submit:<id> (acquireSubmitLock here): the PIPELINE-level
//     dedup. Exactly one submission/turn-advance pipeline runs per lobby at a
//     time (prevents double-eliminate / double-advance). It is held across
//     long TMDB awaits, so it must never be the lock that guards data writes.
//   INNER — lock:lobbymut:<id> (withLobbyLock below): the short DATA-COMMIT
//     mutex. Every write of lobby:<id> happens inside it, on a room re-read
//     inside the lock, with preconditions re-verified on that fresh room.
// lobbymut MAY be acquired while holding submit — every commit in the submit
// pipeline does exactly that. The submit lock must NEVER be acquired inside a
// withLobbyLock mutator: that inverts the order and deadlocks the two
// pipelines against each other until a TTL expires. Corollary: a mutator
// passed to withLobbyLock must not call back into anything that takes the
// submit lock (submitMovie / submitBotMove / forceNextTurn / quitGame / the
// grace-expiry kill / the watchdog callback). Scheduling a timer whose
// CALLBACK takes the submit lock later (armTurnTimeout, scheduleBotMove) is
// fine — the acquisition happens long after the mutator returned.
// ============================================================================

async function acquireSubmitLock(pubClient, lobbyId) {
  // Unique 128-bit token tags this lock so a release after expiry can't
  // delete a successor's lock. Hex encoding keeps the value Redis-safe.
  const token = require('crypto').randomBytes(16).toString('hex');
  // SET NX EX: atomic "set if not exists, with 30s expiry" — the canonical
  // safe way to acquire a Redis lock. Returns 'OK' on success, null if held.
  const result = await pubClient.set(`lock:submit:${lobbyId}`, token, { NX: true, EX: 30 });
  // Returns the token on success (caller passes it back to release), or null
  // if another caller already holds the lock.
  return result === 'OK' ? token : null;
}

async function releaseSubmitLock(pubClient, lobbyId, token) {
  // No-op if acquire never succeeded — caller may pass null after a failed
  // acquire to keep the call site uniform.
  if (!token) return;
  // Lua eval ensures the GET-and-DEL is atomic, so we can never delete a
  // lock owned by another process even if our local view of the world is stale.
  await pubClient.eval(SUBMIT_LOCK_RELEASE_SCRIPT, {
    keys: [`lock:submit:${lobbyId}`],
    arguments: [token],
  });
}

// Atomic combined win-record: per-player count + leaderboard + name, all in
// one multi() so they can't drift on partial failure. Replaces an earlier
// non-atomic pattern (separate incrementPlayerWins + a now-removed recordWin
// helper called via Promise.all) that could leave the lobby win count and
// leaderboard ZSET out of sync if either individual write failed.
async function recordPlayerWinAtomic(pubClient, stableId, name) {
  const ttlSec = 30 * 24 * 60 * 60; // 30 days — matches existing TTLs
  await pubClient.multi()
    .incrBy(`playerWins:${stableId}`, 1)              // per-player lobby display count
    .expire(`playerWins:${stableId}`, ttlSec)          // refresh expiry on every win
    .zIncrBy('leaderboard', 1, stableId)               // global leaderboard score
    .set(`playerName:${stableId}`, name, { EX: ttlSec }) // store latest name for leaderboard lookup
    .exec();
}

// ============================================================================
// Audit finding #4: per-lobby mutation mutex.
// ============================================================================
// Every lobby write is a full-blob read-modify-write on lobby:${id}. Two
// events that interleave inside the get→mutate→setEx window silently drop
// one update — the canonical symptom being two players joining the same
// lobby simultaneously and only one landing in the players array. The
// submit pipeline already serializes via acquireSubmitLock; this is the
// same primitive (SET NX + Lua compare-and-delete, reusing
// SUBMIT_LOCK_RELEASE_SCRIPT) generalized for the OTHER mutators.
//
// withLobbyLock(pubClient, id, mutator):
//   - acquires lock:lobbymut:${id} (PX TTL so a crashed holder self-frees —
//     no permanent deadlock),
//   - re-reads the lobby INSIDE the lock (the read must be inside, or the
//     mutation is based on a pre-lock snapshot and the race is back),
//   - runs `await mutator(room)` (mutate `room` in place),
//   - persists unless the mutator returns exactly false (the uniform "I
//     decided not to change anything — e.g. caller wasn't the host" signal),
//   - returns the (possibly mutated) room so the caller can broadcast it,
//     or null if the lobby was gone.
const LOBBY_MUTEX_PREFIX = 'lock:lobbymut:';
const LOBBY_MUTEX_TTL_MS = 5000;

// T8a audit fix: spin-acquire budget. The OLD budget was 25 × 20ms = 500ms —
// an ORDER OF MAGNITUDE shorter than the 5000ms lock TTL, so a section that
// legitimately ran long (mutators that await Redis inside the critical section,
// e.g. joinLobby reading wins/title data under slow Redis) made a concurrent
// caller exhaust the budget and fall through to an UNLOCKED save (the bug).
// The new budget (≈110 × 50ms ≈ 5.5s) comfortably EXCEEDS the TTL: a live
// holder's section is short so we normally acquire in a spin or two; a CRASHED
// holder's lock self-frees at the PX TTL, so waiting slightly past the TTL
// guarantees acquisition unless there is sustained back-to-back contention —
// at which point we now DECLINE (return null) rather than save unlocked.
// SPIN_INTERVAL_MS is env-tunable so tests can drive the full budget in
// milliseconds (no real multi-second sleeps) without changing the prod default.
// It is resolved PER CALL (via _spinIntervalMs) rather than frozen at require
// time so a test can override the env after this module is already loaded.
const LOBBY_MUTEX_SPIN_ATTEMPTS = 110;
const LOBBY_MUTEX_SPIN_INTERVAL_MS_DEFAULT = 50;
function _spinIntervalMs() {
  const raw = Number(process.env.LOBBY_MUTEX_SPIN_INTERVAL_MS);
  // Only honor a finite, non-negative override; anything else uses the default.
  return Number.isFinite(raw) && raw >= 0 ? raw : LOBBY_MUTEX_SPIN_INTERVAL_MS_DEFAULT;
}
// Exported snapshot of the effective interval for the budget>TTL assertion.
const LOBBY_MUTEX_SPIN_INTERVAL_MS = _spinIntervalMs();

// opts.seedRoom: used ONLY when getLobby returns null. joinLobby just
// NX-created the key, so in production the in-lock read finds it; the seed
// preserves the old `isNewLobby ? initialRoom : getLobby` semantic (and
// keeps a brand-new lobby working if a read-after-write is briefly empty).
// Without a seed, a null read means "lobby gone" → return null (callers
// surface "unavailable"), exactly the pre-fix behavior for existing lobbies.
//
// T2 LOCK ORDERING (see the full rule above acquireSubmitLock): lobbymut is
// the INNER lock — it may be taken while holding lock:submit:<id>, but a
// mutator must NEVER acquire the submit lock (or call into any code path
// that does). Inversion deadlocks both pipelines until a TTL expires.
async function withLobbyLock(pubClient, id, mutator, opts = {}) {
  // T7c: defense-in-depth chokepoint, the CRITICAL half — this function does
  // `SET lock:lobbymut:<id> NX PX` BEFORE the in-lock existence check, so a
  // raw client lobbyId used to mint an attacker-controlled lock key for free.
  // Bail on a malformed id BEFORE the lock SET (and before the mutator runs):
  // no lock key is ever created, return null so callers treat it as "lobby
  // gone" exactly as they would for a missing room. Every legitimate id
  // conforms (see isValidLobbyId), so no real mutator path is affected.
  if (!isValidLobbyId(id)) return null;
  const token = require('crypto').randomBytes(16).toString('hex');
  const lockKey = `${LOBBY_MUTEX_PREFIX}${id}`;

  // Bounded spin-acquire. Lobby critical sections are short, so a contended
  // caller normally gets in within a spin or two. T8a: the budget now exceeds
  // LOBBY_MUTEX_TTL_MS (see the constants above) so genuine exhaustion is rare
  // — a live holder finishes fast and a crashed holder's lock self-frees at the
  // PX TTL within this window.
  let acquired = false;
  const spinIntervalMs = _spinIntervalMs(); // resolved per call (test-overridable)
  for (let i = 0; i < LOBBY_MUTEX_SPIN_ATTEMPTS; i++) {
    const res = await pubClient.set(lockKey, token, { NX: true, PX: LOBBY_MUTEX_TTL_MS });
    if (res === 'OK') { acquired = true; break; }
    await new Promise(r => setTimeout(r, spinIntervalMs));
  }

  // T8a audit fix: on TRUE exhaustion, DECLINE the mutation instead of running
  // it unlocked. The pre-fix code fell through here and did
  // getLobby→mutator→saveLobby with acquired=false, so a full lobby blob was
  // written with NO mutex held — clobbering any write a concurrent locked
  // section committed during the spin (the exact lost-update withLobbyLock
  // exists to prevent; unlike getOrFetchCredits' stampede lock, proceeding
  // unlocked here CORRUPTS state, it doesn't merely waste a fetch). Returning
  // null is the existing "lobby unavailable" signal every caller already
  // handles, so a declined mutation becomes a clean, rare, retryable transient
  // failure. Log via the module's lazy logger (added in T1d-ext) so we can see
  // sustained contention in prod without instantiating pino at require time.
  if (!acquired) {
    _getLogger().warn({ lobbyId: id }, 'withLobbyLock spin exhausted — declining mutation (no unlocked save)');
    return null;
  }

  try {
    const room = await getLobby(pubClient, id) || opts.seedRoom || null;
    if (!room) return null;
    const result = await mutator(room);
    if (result !== false) {
      await saveLobby(pubClient, id, room);
    }
    return room;
  } finally {
    if (acquired) {
      // Compare-and-delete: only release if WE still hold it. If our section
      // overran the PX TTL and someone else acquired, this is a no-op — we
      // must never delete a successor's lock.
      await pubClient.eval(SUBMIT_LOCK_RELEASE_SCRIPT, {
        keys: [lockKey],
        arguments: [token],
      }).catch(() => {});
    }
  }
}

async function getLeaderboard(pubClient, limit = 20) {
  // Top-N by score, descending (REV: true).
  const results = await pubClient.zRangeWithScores('leaderboard', 0, limit - 1, { REV: true });
  if (results.length === 0) return [];

  // Batch-fetch the latest names. mGet returns null for any key whose TTL has
  // expired — those entries are now orphaned in the ZSET (the ZSET has no TTL,
  // but the playerName lookup expires after 30 days).
  const nameKeys = results.map(r => `playerName:${r.value}`);
  const names = await pubClient.mGet(nameKeys);

  // Lazy prune: any entry whose name has expired hasn't been a player in 30+ days.
  // Drop them from the ZSET so the leaderboard doesn't fill with ghosts over time.
  // This runs every read but is cheap — only touches the top-N slice, not the
  // whole ZSET.
  const stale = [];
  const live = [];
  results.forEach((r, i) => {
    if (names[i] === null || names[i] === undefined) {
      stale.push(r.value);
    } else {
      live.push({ name: names[i], wins: Math.floor(r.score) });
    }
  });
  if (stale.length > 0) {
    await pubClient.zRem('leaderboard', stale).catch(() => {});
  }
  return live;
}

// Audit finding #10: full-ZSET prune for the global leaderboard. The ZSET
// itself has no TTL, and getLeaderboard only lazy-prunes the top-N slice it
// reads — so a winner who never re-enters the top-N and then goes inactive
// >30d (their playerName:* key expires) is orphaned in the ZSET forever.
// This walks the WHOLE set with ZSCAN (cursor-paged, COUNT-bounded so it
// never blocks Redis) and removes any member whose name key is gone — the
// same "name expired ⇒ inactive" signal getLeaderboard already trusts.
// Called on a slow timer + via an admin endpoint; safe to run repeatedly.
async function pruneLeaderboard(pubClient) {
  let cursor = 0;
  let removedTotal = 0;
  do {
    const res = await pubClient.zScan('leaderboard', cursor, { COUNT: 200 });
    cursor = Number(res.cursor);
    const members = res.members || [];
    if (members.length > 0) {
      const ids = members.map(m => m.value);
      const names = await pubClient.mGet(ids.map(v => `playerName:${v}`));
      const stale = ids.filter((_, i) => names[i] === null || names[i] === undefined);
      if (stale.length > 0) {
        await pubClient.zRem('leaderboard', stale).catch(() => {});
        removedTotal += stale.length;
      }
    }
  } while (cursor !== 0);
  return removedTotal;
}

module.exports = {
  getLobby,
  // T7c: exported so handler-side guards/tests can reuse the SAME lobby-id
  // charset rule instead of re-implementing (and drifting from) it.
  isValidLobbyId,
  saveLobby,
  deleteLobby,
  addToActiveLobbies,
  removeFromActiveLobbies,
  getAllLobbies,
  getSocketLobby,
  setSocketLobby,
  deleteSocketLobby,
  getPlayerWins,
  incrementPlayerWins,
  setPlayerWins,
  getOrFetchCredits,
  // Phase 5a (bots): cached person filmography lookup, structurally identical
  // to getOrFetchCredits so the bot generator inherits the same stampede-lock
  // and body-draining guarantees.
  getOrFetchPersonCredits,
  acquireSubmitLock,
  releaseSubmitLock,
  // Audit finding #4: per-lobby mutation mutex for all non-submit RMW paths.
  withLobbyLock,
  // T8a: spin-budget + TTL constants exported so tests can assert the budget
  // exceeds the TTL (the invariant that makes genuine exhaustion rare) without
  // hard-coding the numbers in a second place that could drift.
  LOBBY_MUTEX_TTL_MS,
  LOBBY_MUTEX_SPIN_ATTEMPTS,
  LOBBY_MUTEX_SPIN_INTERVAL_MS,
  recordPlayerWinAtomic,
  getLeaderboard,
  // Audit finding #10: full-ZSET sweep to bound unbounded leaderboard growth.
  pruneLeaderboard
};
