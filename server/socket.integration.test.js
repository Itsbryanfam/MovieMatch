const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { setupSocketHandlers } = require('./socketHandlers');
const redisUtils = require('./redisUtils');

jest.mock('./redisUtils');

// Helper: wait for a single event with timeout
function waitFor(socket, event, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('Socket.io Integration', () => {
  let httpServer, io, port;

  // Mock pubClient — must handle rate limiter (multi/incr/expire) and lobby ID generation (exists)
  const mockPubClient = {
    exists: jest.fn().mockResolvedValue(0),
    multi: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([1, 1]),
    })),
  };

  beforeAll((done) => {
    global.cachedPosters = [];
    httpServer = http.createServer();
    io = new Server(httpServer, { cors: { origin: '*' } });
    const TMDB_HEADERS = { Authorization: 'Bearer test_token', accept: 'application/json' };
    setupSocketHandlers(io, mockPubClient, TMDB_HEADERS);
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    io.close();
    httpServer.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementations — handlers call these via require('./redisUtils')
    redisUtils.getLobby.mockResolvedValue(null);
    redisUtils.saveLobby.mockResolvedValue(undefined);
    redisUtils.setSocketLobby.mockResolvedValue(undefined);
    redisUtils.deleteSocketLobby.mockResolvedValue(undefined);
    redisUtils.addToActiveLobbies.mockResolvedValue(undefined);
    redisUtils.removeFromActiveLobbies.mockResolvedValue(undefined);
    redisUtils.getPlayerWins.mockResolvedValue(0);
    redisUtils.incrementPlayerWins.mockResolvedValue(undefined);
    redisUtils.setPlayerWins.mockResolvedValue(undefined);
    redisUtils.getAllLobbies.mockResolvedValue([]);
    redisUtils.deleteLobby.mockResolvedValue(undefined);
    redisUtils.getSocketLobby.mockResolvedValue(null);
    redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [] });
    redisUtils.acquireSubmitLock.mockResolvedValue(true);
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.recordWin.mockResolvedValue(undefined);
    redisUtils.getLeaderboard.mockResolvedValue([]);
    // Reset pubClient mocks
    mockPubClient.exists.mockResolvedValue(0);
    mockPubClient.multi.mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([1, 1]),
    });
  });

  let client;
  afterEach(() => {
    if (client && client.connected) {
      client.disconnect();
    }
  });

  function connect() {
    client = Client(`http://localhost:${port}`, {
      forceNew: true,
      transports: ['websocket'],
    });
    return waitFor(client, 'connect');
  }

  // ========================
  // JOIN FLOW
  // ========================

  test('joinLobby with valid name creates lobby and responds with joined', async () => {
    await connect();

    client.emit('joinLobby', { name: 'Alice', lobbyId: '', stableId: 'p_alice123' });

    const data = await waitFor(client, 'joined');
    expect(data.lobbyId).toBeDefined();
    expect(data.lobbyId.length).toBe(6);
    expect(data.playerId).toBe(client.id);

    // Verify server persisted the lobby
    expect(redisUtils.saveLobby).toHaveBeenCalled();
    expect(redisUtils.setSocketLobby).toHaveBeenCalledWith(
      mockPubClient, client.id, data.lobbyId
    );
    expect(redisUtils.addToActiveLobbies).toHaveBeenCalledWith(
      mockPubClient, data.lobbyId
    );
  });

  test('joinLobby with specific lobby code joins that lobby', async () => {
    // Mock: lobby exists and is waiting
    redisUtils.getLobby.mockResolvedValue({
      id: 'TEST01', status: 'waiting',
      players: [{ id: 'host1', name: 'Host', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 'p_host' }],
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
      isValidating: false, gameMode: 'classic'
    });

    await connect();

    client.emit('joinLobby', { name: 'Bob', lobbyId: 'TEST01', stableId: 'p_bob123' });

    const data = await waitFor(client, 'joined');
    expect(data.lobbyId).toBe('TEST01');
  });

  test('joinLobby with empty name returns error', async () => {
    await connect();

    client.emit('joinLobby', { name: '', lobbyId: '', stableId: 'p_test' });

    const msg = await waitFor(client, 'error');
    expect(msg).toContain('Name cannot be empty');
  });

  test('joinLobby rejects when lobby is full (8 players)', async () => {
    const fullLobby = {
      id: 'FULL01', status: 'waiting',
      players: Array.from({ length: 8 }, (_, i) => ({
        id: `p${i}`, name: `Player${i}`, isHost: i === 0, isAlive: true,
        connected: true, score: 0, wins: 0, teamId: i % 2, stableId: `s${i}`
      })),
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
      isValidating: false, gameMode: 'classic'
    };
    redisUtils.getLobby.mockResolvedValue(fullLobby);

    await connect();

    client.emit('joinLobby', { name: 'Overflow', lobbyId: 'FULL01', stableId: 'p_overflow' });

    const msg = await waitFor(client, 'error');
    expect(msg).toContain('full');
  });

  test('joinLobby as spectator when lobby is already playing', async () => {
    redisUtils.getLobby.mockResolvedValue({
      id: 'PLAY01', status: 'playing',
      players: [{ id: 'p1', name: 'A', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1' }],
      spectators: [],
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
      isValidating: false, gameMode: 'classic'
    });

    await connect();

    client.emit('joinLobby', { name: 'Late', lobbyId: 'PLAY01', stableId: 'p_late' });

    const data = await waitFor(client, 'joined');
    expect(data.lobbyId).toBe('PLAY01');
    expect(data.isSpectator).toBe(true);
  });

  // ========================
  // RECONNECTION
  // ========================

  test('rejoinLobby fails for non-existent lobby', async () => {
    redisUtils.getLobby.mockResolvedValue(null);

    await connect();

    client.emit('rejoinLobby', { lobbyId: 'GONE01', playerId: 'old-socket-id' });

    const msg = await waitFor(client, 'rejoinFailed');
    expect(msg).toContain('no longer exists');
  });

  test('rejoinLobby fails when player not found in lobby', async () => {
    redisUtils.getLobby.mockResolvedValue({
      id: 'EXIST1', status: 'playing',
      players: [{ id: 'other-player', name: 'Other', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's_other' }],
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
      isValidating: false, gameMode: 'classic'
    });

    await connect();

    client.emit('rejoinLobby', { lobbyId: 'EXIST1', playerId: 'wrong-id' });

    const msg = await waitFor(client, 'rejoinFailed');
    expect(msg).toContain('not found');
  });

  test('rejoinLobby succeeds and updates player socket ID', async () => {
    const oldPlayerId = 'old-socket-id';
    const room = {
      id: 'REJN01', status: 'playing',
      players: [{ id: oldPlayerId, name: 'Returner', isHost: true, isAlive: true, connected: false, score: 50, wins: 1, teamId: 0, stableId: 's_return' }],
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
      isValidating: false, gameMode: 'classic'
    };
    redisUtils.getLobby.mockResolvedValue(room);

    await connect();

    client.emit('rejoinLobby', { lobbyId: 'REJN01', playerId: oldPlayerId });

    const data = await waitFor(client, 'rejoinSuccess');
    expect(data.lobbyId).toBe('REJN01');
    // The server should have updated playerId to the new socket id
    expect(data.playerId).toBe(client.id);

    // Verify the old socket mapping was cleaned up
    expect(redisUtils.deleteSocketLobby).toHaveBeenCalledWith(mockPubClient, oldPlayerId);
    // Verify the new socket mapping was created
    expect(redisUtils.setSocketLobby).toHaveBeenCalledWith(mockPubClient, client.id, 'REJN01');
  });

  // ========================
  // PUBLIC LOBBIES
  // ========================

  test('requestPublicLobbies returns only public waiting lobbies', async () => {
    redisUtils.getAllLobbies.mockResolvedValue([
      {
        id: 'PUB001', status: 'waiting', isPublic: true,
        players: [{ id: 'p1', name: 'HostA', isHost: true }]
      },
      {
        id: 'PRIV01', status: 'waiting', isPublic: false,
        players: [{ id: 'p2', name: 'HostB', isHost: true }]
      },
      {
        id: 'PUB002', status: 'playing', isPublic: true,
        players: [{ id: 'p3', name: 'HostC', isHost: true }]
      }
    ]);

    await connect();

    client.emit('requestPublicLobbies');

    const lobbies = await waitFor(client, 'publicLobbiesList');
    expect(lobbies).toHaveLength(1);
    expect(lobbies[0].id).toBe('PUB001');
    expect(lobbies[0].hostName).toBe('HostA');
  });

  // ========================
  // LOBBY SETTINGS (host-only)
  // ========================

  test('setGameMode is rejected for non-host player', async () => {
    const room = {
      id: 'MODE01', status: 'waiting',
      players: [
        { id: 'host-id', name: 'Host', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's_host' },
        { id: 'will-be-replaced', name: 'Guest', isHost: false, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, stableId: 's_guest' }
      ],
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
      isValidating: false, gameMode: 'classic'
    };
    redisUtils.getLobby.mockResolvedValue(room);

    await connect();

    // The connected client's socket.id won't match 'host-id', so it's not the host
    client.emit('setGameMode', { lobbyId: 'MODE01', mode: 'speed' });

    // Wait a beat — if it were accepted, saveLobby would be called
    await new Promise(resolve => setTimeout(resolve, 300));

    // setGameMode saves the lobby if accepted. Since we're not the host, it should NOT have saved.
    // saveLobby might have been called 0 times, or if the error boundary swallows it, also 0 times.
    expect(redisUtils.saveLobby).not.toHaveBeenCalled();
  });

  // ========================
  // ERROR BOUNDARY
  // ========================

  test('error in handler does not crash the socket connection', async () => {
    // Make getLobby throw an error
    redisUtils.getLobby.mockRejectedValue(new Error('Redis connection lost'));

    await connect();

    // This will trigger the error inside the handler
    client.emit('sendChat', { lobbyId: 'ANY01', msg: 'hello' });

    // Wait a beat for the error to be caught
    await new Promise(resolve => setTimeout(resolve, 300));

    // The socket should still be connected (error boundary caught the throw)
    expect(client.connected).toBe(true);

    // Now do a normal operation to prove the socket still works
    redisUtils.getLobby.mockResolvedValue(null);
    client.emit('joinLobby', { name: 'StillAlive', lobbyId: '', stableId: 'p_alive' });

    const data = await waitFor(client, 'joined');
    expect(data.lobbyId).toBeDefined();
  });
});
