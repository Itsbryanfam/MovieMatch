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
  const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/credits?language=en-US`;
  if (mediaType === 'tv') {
    // Use the correct endpoint for TV shows (aggregate_credits)
    const tvUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/aggregate_credits?language=en-US`;
    const response = await fetch(tvUrl, { headers });
    if (!response.ok) throw new Error(`TMDB credits failed: ${response.status}`);
    const credits = await response.json();
    await pubClient.set(cacheKey, JSON.stringify(credits), { EX: 2592000 }); // 30 days
    return credits;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`TMDB credits failed: ${response.status}`);
  
  const credits = await response.json();

  // Cache for 30 days
  await pubClient.set(cacheKey, JSON.stringify(credits), { EX: 2592000 }); // 30 days in seconds

  return credits;
}

async function acquireSubmitLock(pubClient, lobbyId) {
  const result = await pubClient.set(`lock:submit:${lobbyId}`, '1', { NX: true, EX: 30 });
  return result !== null;
}

async function releaseSubmitLock(pubClient, lobbyId) {
  await pubClient.del(`lock:submit:${lobbyId}`);
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
  releaseSubmitLock
};
