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

  // Mock pubClient — must handle rate limiter (multi/incr/expire), lobby ID
  // generation (exists), and joinLobby's NX-create (set). The set call returns
  // 'OK' so the create-or-noop path treats this caller as the winning creator.
  const mockPubClient = {
    exists: jest.fn().mockResolvedValue(0),
    set: jest.fn().mockResolvedValue('OK'),
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
    // Audit finding #4: redisUtils is auto-mocked, so withLobbyLock would
    // return undefined and break every wrapped mutator. Faithfully simulate
    // the real contract against the existing getLobby/saveLobby mocks:
    // read → run mutator → persist unless it returned false → return room.
    redisUtils.withLobbyLock.mockImplementation(async (pub, id, fn, opts = {}) => {
      const r = (await redisUtils.getLobby(pub, id)) || opts.seedRoom || null;
      if (!r) return null;
      const res = await fn(r);
      if (res !== false) await redisUtils.saveLobby(pub, id, r);
      return r;
    });
    // recordWin mock removed — function was deleted in favor of recordPlayerWinAtomic.
    redisUtils.getLeaderboard.mockResolvedValue([]);
    // Reset pubClient mocks — including the new set() that joinLobby uses for NX create.
    mockPubClient.exists.mockResolvedValue(0);
    mockPubClient.set.mockResolvedValue('OK');
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
    // Existing lobby: NX-create must return null so the production code falls
    // through to getLobby and joins the canonical existing state (rather than
    // overwriting it with a fresh empty room).
    mockPubClient.set.mockResolvedValueOnce(null);
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
    // SET NX returns null when the key already exists — that's the "lobby
    // already exists" signal. Production code then falls through to getLobby
    // to fetch the canonical state (the full lobby below).
    mockPubClient.set.mockResolvedValueOnce(null);
    redisUtils.getLobby.mockResolvedValue(fullLobby);

    await connect();

    client.emit('joinLobby', { name: 'Overflow', lobbyId: 'FULL01', stableId: 'p_overflow' });

    const msg = await waitFor(client, 'error');
    expect(msg).toContain('full');
  });

  test('joinLobby as spectator when lobby is already playing', async () => {
    // Lobby is already playing — NX-create must signal "key exists" (null) so
    // the production code falls through to the existing-room path.
    mockPubClient.set.mockResolvedValueOnce(null);
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

  // T1 audit (2026-06-09), fix T1f: client-supplied lobbyId previously flowed
  // UNCAPPED into Redis keys — lobby:${id} (NX-created with a 2h TTL), both
  // lock keys, and the activeLobbies set — so a multi-megabyte id inflated
  // Redis at zero cost to the sender. The handler must reject anything that
  // is non-empty after trim/uppercase and not /^[A-Z0-9-]{1,32}$/, via the
  // same socket.emit('error', ...) pattern its sibling guards use, BEFORE any
  // Redis write happens. Generated 6-char codes and DAILY-… ids must pass.

  test('T1f: joinLobby rejects an oversized lobby id before any Redis write', async () => {
    await connect();

    client.emit('joinLobby', { name: 'Bloater', lobbyId: 'A'.repeat(50000), stableId: 'p_bloat' });

    const msg = await waitFor(client, 'error');
    expect(msg).toContain('Invalid lobby code');
    // The whole point: nothing may reach Redis under the abusive key. The
    // NX-create goes through mockPubClient.set; persistence through saveLobby.
    expect(mockPubClient.set).not.toHaveBeenCalled();
    expect(redisUtils.saveLobby).not.toHaveBeenCalled();
    expect(redisUtils.addToActiveLobbies).not.toHaveBeenCalled();
  });

  test('T1f: joinLobby rejects a bad-charset lobby id (no lobby created)', async () => {
    await connect();

    // Underscore + punctuation are outside [A-Z0-9-]; length is fine — this
    // pins the charset half of the guard, not just the cap.
    client.emit('joinLobby', { name: 'Weird', lobbyId: 'AB_CD!', stableId: 'p_weird' });

    const msg = await waitFor(client, 'error');
    expect(msg).toContain('Invalid lobby code');
    expect(mockPubClient.set).not.toHaveBeenCalled();
    expect(redisUtils.saveLobby).not.toHaveBeenCalled();
  });

  test('T1f: joinLobby still admits a DAILY-style hyphenated id (≤32, A-Z/0-9/-)', async () => {
    await connect();

    // Same shape startDailyChallenge mints (DAILY-<stableId12>-<yyyymmdd>,
    // uppercased + sliced to 32). The guard must not lock these out.
    client.emit('joinLobby', { name: 'Daily', lobbyId: 'DAILY-ABC123DEF456-20260609', stableId: 'p_daily' });

    const data = await waitFor(client, 'joined');
    expect(data.lobbyId).toBe('DAILY-ABC123DEF456-20260609');
  });

  // ========================
  // RECONNECTION
  // ========================

  test('rejoinLobby fails for non-existent lobby', async () => {
    redisUtils.getLobby.mockResolvedValue(null);

    await connect();

    // stableId now required by the auth check — supply one even on the
    // missing-lobby path so we exercise the "no lobby" branch, not the
    // "missing identity" guard.
    client.emit('rejoinLobby', { lobbyId: 'GONE01', playerId: 'old-socket-id', stableId: 's_caller' });

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

    // Caller's stableId doesn't match any player in the room — both lookup
    // paths in rejoinLobby fail, so the server replies "not found".
    client.emit('rejoinLobby', { lobbyId: 'EXIST1', playerId: 'wrong-id', stableId: 's_caller' });

    const msg = await waitFor(client, 'rejoinFailed');
    expect(msg).toContain('not found');
  });

  test('rejoinLobby succeeds and updates player socket ID', async () => {
    const oldPlayerId = 'old-socket-id';
    const stableId = 's_return';
    const room = {
      id: 'REJN01', status: 'playing',
      players: [{ id: oldPlayerId, name: 'Returner', isHost: true, isAlive: true, connected: false, score: 50, wins: 1, teamId: 0, stableId }],
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
      isValidating: false, gameMode: 'classic'
    };
    redisUtils.getLobby.mockResolvedValue(room);

    await connect();

    // Pass stableId — required by the auth check in rejoinLobby. Without it
    // the call would be rejected with "Missing identity" instead of succeeding.
    client.emit('rejoinLobby', { lobbyId: 'REJN01', playerId: oldPlayerId, stableId });

    const data = await waitFor(client, 'rejoinSuccess');
    expect(data.lobbyId).toBe('REJN01');
    // The server should have updated playerId to the new socket id
    expect(data.playerId).toBe(client.id);

    // Verify the old socket mapping was cleaned up
    expect(redisUtils.deleteSocketLobby).toHaveBeenCalledWith(mockPubClient, oldPlayerId);
    // Verify the new socket mapping was created
    expect(redisUtils.setSocketLobby).toHaveBeenCalledWith(mockPubClient, client.id, 'REJN01');
  });

  // SECURITY (audit finding #1): rejoinSuccess must NOT leak other players'
  // stableId. stableId is the bearer secret used to authenticate a rejoin —
  // broadcastState already strips it, but the rejoin path historically sent
  // the raw Redis room object, exposing every player's stableId to any
  // participant (who could then take over any slot, including the host).
  // The payload must still deliver usable state (players present, scores
  // intact) so the rejoining client can rebuild its view.
  test('rejoinSuccess does not leak any player stableId but keeps usable state', async () => {
    const stableId = 's_me';
    const room = {
      id: 'LEAK01', status: 'playing',
      players: [
        { id: 'me-old', name: 'Me', isHost: false, isAlive: true, connected: false, score: 30, wins: 0, teamId: 0, stableId },
        { id: 'victim-sock', name: 'Victim', isHost: true, isAlive: true, connected: true, score: 90, wins: 2, teamId: 1, stableId: 's_victim_secret' },
      ],
      spectators: [{ id: 'spec1', name: 'Watcher', connected: true, stableId: 's_spec_secret' }],
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
      isValidating: false, gameMode: 'classic'
    };
    redisUtils.getLobby.mockResolvedValue(room);

    await connect();
    client.emit('rejoinLobby', { lobbyId: 'LEAK01', playerId: 'me-old', stableId });

    const data = await waitFor(client, 'rejoinSuccess');

    // State must still be usable for the rejoining client.
    expect(Array.isArray(data.state.players)).toBe(true);
    expect(data.state.players).toHaveLength(2);
    expect(data.state.players.find(p => p.name === 'Victim').score).toBe(90);

    // No player object may carry stableId — not the caller's, not anyone's.
    for (const p of data.state.players) {
      expect(p.stableId).toBeUndefined();
    }
    // The serialized payload must not contain any secret stableId substring,
    // including the spectator secret (raw spectators were also being sent).
    const wire = JSON.stringify(data);
    expect(wire).not.toContain('s_victim_secret');
    expect(wire).not.toContain('s_spec_secret');
    expect(wire).not.toContain('s_me');
  });

  // Negative test: an attacker who has guessed/observed another player's
  // socket id should NOT be able to take over their slot. Pre-fix, this
  // call would have hijacked the victim's slot silently.
  test('rejoinLobby fails when stableId does not match the player', async () => {
    const room = {
      id: 'HIJK01', status: 'playing',
      players: [{
        id: 'victim-socket', stableId: 'p_victim', name: 'Victim',
        // Disconnected so the second-lookup path (by stableId) is also reachable;
        // this confirms the fix blocks BOTH paths, not just the by-socket-id one.
        isHost: true, isAlive: true, connected: false,
        score: 0, wins: 0, teamId: 0
      }],
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0,
      turnExpiresAt: null, isValidating: false, gameMode: 'classic'
    };
    redisUtils.getLobby.mockResolvedValue(room);

    await connect();
    client.emit('rejoinLobby', {
      lobbyId: 'HIJK01',
      playerId: 'victim-socket',     // victim's socket id (broadcast to all clients)
      stableId: 'p_attacker',        // attacker's own stableId — not the victim's
    });

    // Server must refuse: neither lookup path should match.
    const msg = await waitFor(client, 'rejoinFailed');
    expect(msg).toContain('not found');
  });

  // Negative test: omitting stableId should be rejected with "Missing identity"
  // before any room/player lookup happens.
  test('rejoinLobby fails when stableId is missing', async () => {
    redisUtils.getLobby.mockResolvedValue({
      id: 'NOID01', status: 'playing',
      players: [{ id: 'someone', name: 'X', isHost: true, isAlive: true, connected: false, score: 0, wins: 0, teamId: 0, stableId: 's_x' }],
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
      isValidating: false, gameMode: 'classic'
    });

    await connect();
    client.emit('rejoinLobby', { lobbyId: 'NOID01', playerId: 'someone' });

    const msg = await waitFor(client, 'rejoinFailed');
    expect(msg).toContain('Missing identity');
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

  // SECURITY (audit finding #5): the README claims "per-socket rate limiting
  // on all events", but rejoinLobby / requestPublicLobbies / settings /
  // lifecycle events had none. requestPublicLobbies is the worst — it fans
  // into sMembers(activeLobbies)+mGet(all), a cheap amplification lever. With
  // the limiter reporting "exceeded", these handlers must bail BEFORE doing
  // any Redis work. The shared mock returns count=1 by default, so for these
  // tests we force the limiter over its threshold.
  function forceRateLimitExceeded() {
    mockPubClient.multi.mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([999, 1]), // count=999 ≫ any limit
    });
  }

  test('requestPublicLobbies is rate-limited (no Redis fan-out when over limit)', async () => {
    await connect();
    forceRateLimitExceeded();

    client.emit('requestPublicLobbies');
    await new Promise(resolve => setTimeout(resolve, 250));

    // The expensive getAllLobbies fan-out must not run when over the limit.
    expect(redisUtils.getAllLobbies).not.toHaveBeenCalled();
  });

  test('rejoinLobby is rate-limited (no lobby lookup when over limit)', async () => {
    await connect();
    forceRateLimitExceeded();

    let responded = false;
    client.on('rejoinSuccess', () => { responded = true; });
    client.on('rejoinFailed', () => { responded = true; });

    client.emit('rejoinLobby', { lobbyId: 'ANY01', playerId: 'x', stableId: 's_x' });
    await new Promise(resolve => setTimeout(resolve, 250));

    // Handler must return at the limiter, before any room lookup or reply —
    // otherwise the leak/takeover surface (finding #1) is trivially loopable.
    expect(redisUtils.getLobby).not.toHaveBeenCalled();
    expect(responded).toBe(false);
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

  // SECURITY (audit finding #3): startLobby had no status guard, so a host
  // (or any player who took over the host slot) could emit it mid-game and
  // startGame would wipe chain/usedMovies, revive everyone, and reset scores.
  // startLobby must be a no-op unless the lobby is in 'waiting'.
  test('startLobby is a no-op when the game is already playing', async () => {
    await connect();
    const room = {
      id: 'RESET1', status: 'playing',
      players: [
        { id: client.id, name: 'Host', isHost: true, isAlive: true, connected: true, score: 300, wins: 0, teamId: 0, stableId: 's_h' },
        { id: 'p2', name: 'P2', isHost: false, isAlive: false, connected: true, score: 0, wins: 0, teamId: 1, stableId: 's_2' },
      ],
      spectators: [],
      chain: [{ playerId: 'p2', playerName: 'P2', movie: { id: 1, title: 'Seed', cast: [] }, matchedActors: [] }],
      usedMovies: ['movie:1'], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 4, turnExpiresAt: Date.now() + 10000,
      isValidating: false, gameMode: 'classic', currentTurnIndex: 0,
    };
    redisUtils.getLobby.mockResolvedValue(room);

    client.emit('startLobby', 'RESET1');
    await new Promise(resolve => setTimeout(resolve, 250));

    // startGame (if wrongly invoked) clears chain/usedMovies and revives
    // players. None of that may happen on an already-playing lobby.
    expect(room.chain).toHaveLength(1);
    expect(room.usedMovies).toEqual(['movie:1']);
    expect(room.players[1].isAlive).toBe(false);
    expect(redisUtils.saveLobby).not.toHaveBeenCalled();
  });

  // ========================
  // QUIT GAME (M7)
  // ========================
  // Pre-M7 the only way to leave a game in progress was to disconnect, which
  // armed a 15-second grace period before elimination. These tests pin the
  // post-M7 contract: a quitGame event from a participating, alive player
  // ends their run immediately, with the right side-effects per turn-state.

  // Helper: build a minimal playing-state room with two players, one of whom
  // is the connected client (their socket.id is filled in at emit time).
  function buildPlayingRoom(currentClientId, currentTurnIndex = 0) {
    return {
      id: 'QUIT01',
      status: 'playing',
      players: [
        { id: currentClientId, name: 'Quitter', isHost: true, isAlive: true,
          connected: true, score: 0, wins: 0, teamId: 0, stableId: 's_quit' },
        { id: 'p_other', name: 'Other', isHost: false, isAlive: true,
          connected: true, score: 0, wins: 0, teamId: 1, stableId: 's_other' },
      ],
      spectators: [],
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0,
      turnExpiresAt: Date.now() + 60000, isValidating: false, gameMode: 'classic',
      currentTurnIndex,
    };
  }

  test('quitGame on your own turn eliminates you and saves the lobby', async () => {
    await connect();
    const room = buildPlayingRoom(client.id, 0);
    redisUtils.getLobby.mockResolvedValue(room);

    client.emit('quitGame', 'QUIT01');

    // Wait for the elimination to land — the handler is async so we can't
    // await the emit directly. 250ms is plenty for the local in-memory path.
    await new Promise(resolve => setTimeout(resolve, 250));

    // The quitter must be marked dead — that's the whole point of the
    // feature. Without this assertion a regression that no-ops the handler
    // would silently pass.
    expect(room.players[0].isAlive).toBe(false);
    // The lobby state must be persisted at least once during the elimination
    // path (called from inside eliminateCurrentPlayer → nextTurn).
    expect(redisUtils.saveLobby).toHaveBeenCalled();
  });

  test('quitGame on someone else’s turn marks you dead without disturbing the active player', async () => {
    await connect();
    // currentTurnIndex=1 → the OTHER player has the turn; client is index 0.
    const room = buildPlayingRoom(client.id, 1);
    redisUtils.getLobby.mockResolvedValue(room);

    client.emit('quitGame', 'QUIT01');
    await new Promise(resolve => setTimeout(resolve, 250));

    // Only the quitter is marked dead — the active player is untouched.
    expect(room.players[0].isAlive).toBe(false);
    expect(room.players[1].isAlive).toBe(true);
    // The current turn index didn't advance — the active player keeps their
    // remaining time. (Pre-M7 this case would either no-op or accidentally
    // advance the turn; the integration test pins which.)
    expect(room.currentTurnIndex).toBe(1);
  });

  test('quitGame is a no-op when the game is not in playing state', async () => {
    await connect();
    const room = buildPlayingRoom(client.id, 0);
    room.status = 'waiting'; // not in a playable state — quit makes no sense
    redisUtils.getLobby.mockResolvedValue(room);

    client.emit('quitGame', 'QUIT01');
    await new Promise(resolve => setTimeout(resolve, 250));

    // The player should NOT be marked dead — they're in the lobby, not a game.
    // (Use leaveLobby for that flow.) Regression-guards a path that'd cause a
    // confusing 'X eliminated' notification while still in the waiting room.
    expect(room.players[0].isAlive).toBe(true);
  });

  // ========================
  // HERO ACTOR SEARCH (T3d)
  // ========================
  // T3 audit fix: heroActorSearch is pre-room (no lobby membership) and
  // proxies to TMDB /search/person on the shared token, so junk queries are
  // pure cost. The handler must reject sub-2-char queries (after trim)
  // BEFORE spending rate-limit budget or touching TMDB.

  test('T3d: heroActorSearch drops a sub-2-char query before limiter or TMDB spend', async () => {
    // Spy on global fetch — heroPuzzle.searchPersonForHero calls the bare
    // global, and "no TMDB spend" is the property under test. Restored at
    // the end so other tests' (non-)use of fetch is untouched.
    const realFetch = global.fetch;
    global.fetch = jest.fn();
    try {
      await connect();

      let answered = false;
      client.on('heroActorResults', () => { answered = true; });
      // ' a ' trims to a single char — the guard is min-2 AFTER trim, so
      // whitespace padding can't smuggle a junk query through.
      client.emit('heroActorSearch', { query: ' a ' });
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(answered).toBe(false);
      // Zero TMDB spend…
      expect(global.fetch).not.toHaveBeenCalled();
      // …and zero limiter spend: the rate-limit pipeline runs through
      // pubClient.multi(), which must never have been started for a query
      // the guard should kill first.
      expect(mockPubClient.multi).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
    }
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
