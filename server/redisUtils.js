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

/**
 * Get credits from Redis cache or fetch from TMDB and cache for 30 days
 */
async function getOrFetchCredits(pubClient, tmdbId, mediaType, headers) {
  const cacheKey = `credits:${mediaType}:${tmdbId}`;
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

    // Strip to just cast names — the only field the game uses.
    // Raw responses are 50-100KB; stripped is ~1-2KB. Saves massive Redis memory.
    const stripped = {
      cast: (raw.cast || []).map(actor => ({ name: actor.name }))
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

async function recordWin(pubClient, stableId, name) {
  await pubClient.zIncrBy('leaderboard', 1, stableId);
  await pubClient.set(`playerName:${stableId}`, name, { EX: 2592000 }); // 30 days
}

// Atomic combined win-record: per-player count + leaderboard + name, all in
// one multi() so they can't drift on partial failure. Replaces the previous
// pattern of calling incrementPlayerWins and recordWin via Promise.all, which
// could leave the lobby win count and leaderboard ZSET out of sync if either
// individual write failed.
async function recordPlayerWinAtomic(pubClient, stableId, name) {
  const ttlSec = 30 * 24 * 60 * 60; // 30 days — matches existing TTLs
  await pubClient.multi()
    .incrBy(`playerWins:${stableId}`, 1)              // per-player lobby display count
    .expire(`playerWins:${stableId}`, ttlSec)          // refresh expiry on every win
    .zIncrBy('leaderboard', 1, stableId)               // global leaderboard score
    .set(`playerName:${stableId}`, name, { EX: ttlSec }) // store latest name for leaderboard lookup
    .exec();
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
  recordWin,
  recordPlayerWinAtomic,
  getLeaderboard
};
