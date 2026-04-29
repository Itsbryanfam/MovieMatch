const { createClient } = require('redis');

async function getLobby(pubClient, id) {
  const data = await pubClient.get(`lobby:${id}`);
  return data ? JSON.parse(data) : null;
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
  const lobbies = [];
  for (const id of ids) {
    const data = await pubClient.get(`lobby:${id}`);
    if (data) {
      lobbies.push(JSON.parse(data));
    } else {
      // Lobby key expired — clean up the stale set entry
      await pubClient.sRem('activeLobbies', id);
    }
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
  await pubClient.incrBy(`playerWins:${playerId}`, amount);
  await pubClient.expire(`playerWins:${playerId}`, 30 * 24 * 60 * 60); // 30 days
}

async function setPlayerWins(pubClient, playerId, wins) {
  await pubClient.setEx(`playerWins:${playerId}`, 30 * 24 * 60 * 60, wins.toString());
}

/**
 * Get credits from Redis cache or fetch from TMDB and cache for 30 days
 */
async function getOrFetchCredits(pubClient, tmdbId, mediaType, headers) {
  const cacheKey = `credits:${mediaType}:${tmdbId}`;
  
  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Fetch from TMDB
  let response;
  if (mediaType === 'tv') {
    const tvUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/aggregate_credits?language=en-US`;
    response = await fetch(tvUrl, { headers });
  } else {
    const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/credits?language=en-US`;
    response = await fetch(url, { headers });
  }

  if (!response.ok) {
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
}

async function acquireSubmitLock(pubClient, lobbyId) {
  const result = await pubClient.set(`lock:submit:${lobbyId}`, '1', { NX: true, EX: 30 });
  return result !== null;
}

async function releaseSubmitLock(pubClient, lobbyId) {
  await pubClient.del(`lock:submit:${lobbyId}`);
}

async function recordWin(pubClient, stableId, name) {
  await pubClient.zIncrBy('leaderboard', 1, stableId);
  await pubClient.set(`playerName:${stableId}`, name, { EX: 2592000 }); // 30 days
}

async function getLeaderboard(pubClient, limit = 20) {
  const results = await pubClient.zRangeWithScores('leaderboard', 0, limit - 1, { REV: true });
  if (results.length === 0) return [];
  const nameKeys = results.map(r => `playerName:${r.value}`);
  const names = await pubClient.mGet(nameKeys);
  return results.map((r, i) => ({
    name: names[i] || 'Unknown Player',
    wins: Math.floor(r.score)
  }));
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
  getLeaderboard
};
