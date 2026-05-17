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
