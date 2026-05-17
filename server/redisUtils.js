async function getLobby(pubClient, id) {
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

// 5s ceiling matches the timeout used by every other TMDB call in matchSystem.
// Critical: this function runs inside the submit-movie lock — any hang here
// freezes the game for the entire room until the 30s lock TTL expires.
const TMDB_FETCH_TIMEOUT_MS = 5000;

// L10: Cache schema version. Bump this whenever the shape of the cached
// credits payload changes — old entries simply expire over the 7-day TTL,
// and new fetches start landing under the new prefix immediately. Documented
// schema history (so future authors know which bump was for what):
//   v1 — { cast: [{ name }] } (initial)
//   v2 — { cast: [{ id, name }] } (H4 — id-based actor matching)
const CREDITS_CACHE_VERSION = 'v2';

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
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Try to claim the right to fetch. NX returns null if another worker is
  // already fetching the same movie — without this, five concurrent submits
  // for the same uncached title would all hit TMDB.
  const gotLock = await pubClient.set(lockKey, '1', { NX: true, EX: 10 });
  if (!gotLock) {
    // Another worker is already fetching. Briefly wait and retry the cache —
    // typical TMDB call returns in <1s, so 250ms catches most of them.
    await new Promise(r => setTimeout(r, 250));
    const retry = await pubClient.get(cacheKey);
    if (retry) return JSON.parse(retry);
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
      // Drain the body before throwing so the underlying connection is
      // returned to the pool, not held open while we wait for GC.
      await response.arrayBuffer();
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

    await pubClient.set(cacheKey, JSON.stringify(stripped), { EX: 604800 }); // 7 days

    return stripped;
  } finally {
    // Release only if we actually held the lock — the fall-through path above
    // proceeds without holding it.
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

// opts.seedRoom: used ONLY when getLobby returns null. joinLobby just
// NX-created the key, so in production the in-lock read finds it; the seed
// preserves the old `isNewLobby ? initialRoom : getLobby` semantic (and
// keeps a brand-new lobby working if a read-after-write is briefly empty).
// Without a seed, a null read means "lobby gone" → return null (callers
// surface "unavailable"), exactly the pre-fix behavior for existing lobbies.
async function withLobbyLock(pubClient, id, mutator, opts = {}) {
  const token = require('crypto').randomBytes(16).toString('hex');
  const lockKey = `${LOBBY_MUTEX_PREFIX}${id}`;

  // Bounded spin-acquire. Lobby critical sections are sub-millisecond, so a
  // contended caller normally gets in within a spin or two. If we exhaust
  // the budget (a holder is pathologically slow, or died and we're waiting
  // on the PX TTL) we proceed UNLOCKED rather than drop the user's action
  // entirely — same best-effort tradeoff getOrFetchCredits makes for its
  // stampede lock. The PX TTL bounds worst-case staleness.
  let acquired = false;
  for (let i = 0; i < 25; i++) {
    const res = await pubClient.set(lockKey, token, { NX: true, PX: LOBBY_MUTEX_TTL_MS });
    if (res === 'OK') { acquired = true; break; }
    await new Promise(r => setTimeout(r, 20));
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
  acquireSubmitLock,
  releaseSubmitLock,
  // Audit finding #4: per-lobby mutation mutex for all non-submit RMW paths.
  withLobbyLock,
  recordPlayerWinAtomic,
  getLeaderboard,
  // Audit finding #10: full-ZSET sweep to bound unbounded leaderboard growth.
  pruneLeaderboard
};
