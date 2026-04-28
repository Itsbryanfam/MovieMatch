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
    if (data) lobbies.push(JSON.parse(data));
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

module.exports = {
  getLobby,
  saveLobby,
  deleteLobby,
  addToActiveLobbies,
  removeFromActiveLobbies,
  getAllLobbies,
  getSocketLobby,
  setSocketLobby,
  deleteSocketLobby
};
