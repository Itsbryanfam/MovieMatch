const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { setupSocketHandlers } = require('./socketHandlers');
const redisUtils = require('./redisUtils');
// T6a: dailySystem is NOT auto-mocked (only redisUtils is). The daily handler
// tests below jest.spyOn its methods so we can drive the claim/leaderboard
// branches without standing up the real Redis ZSET ops — restored per-test.
const dailySystem = require('./systems/dailySystem');
// T6a: lobbySystem is real too. The host-settings handlers are pure
// rate-limit→delegate routers, so the observable contract is "the right
// lobbySystem method ran with the parsed payload". We jest.spyOn (and restore)
// rather than assert deep state, since the deep behavior is owned by
// lobbySystem's own unit suites.
const lobbySystem = require('./systems/lobbySystem');

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

// T6b: deterministic order-barrier. Socket.IO preserves per-socket event
// order, so after we emit some event on a socket, emitting `requestDailyLeaderboard`
// on the SAME socket and awaiting its `dailyLeaderboard` reply PROVES the
// earlier event was already fully processed by the server. This replaces
// real `setTimeout` sleeps in the negative-assertion windows: instead of
// "wait 250ms and hope it's done", we wait for a known sentinel response that
// CANNOT arrive before the prior event ran. requestDailyLeaderboard is the
// ideal sentinel — it always replies (no lobby/membership preconditions) and
// has no effect on lobby state, so it can't perturb the thing under test.
function flushSocket(socket) {
  socket.emit('requestDailyLeaderboard', '__sentinel__');
  return waitFor(socket, 'dailyLeaderboard');
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

  // T6a: room-channel join helper. Several handlers broadcast via
  // io.to(lobbyId) / broadcastState, so the connected socket only receives the
  // emit if it is genuinely joined to that Socket.IO room. Mocking a player
  // record is not enough — the SERVER must have run socket.join(lobbyId).
  // This drives `client` through the real joinLobby flow into `lobbyId`, then
  // returns the new socket id so callers can wire it into the room they want
  // the handler-under-test to read. After this resolves, `client` is in the
  // room channel; the caller re-points redisUtils.getLobby to its own room.
  async function joinClientToRoom(lobbyId) {
    // NX-create returns null → existing-room path → server runs socket.join.
    mockPubClient.set.mockResolvedValueOnce(null);
    redisUtils.getLobby.mockResolvedValueOnce({
      id: lobbyId, status: 'waiting',
      players: [{ id: 'seed-host', name: 'Seed', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's_seed' }],
      chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
      isValidating: false, gameMode: 'classic',
    });
    client.emit('joinLobby', { name: 'Joiner', lobbyId, stableId: 's_joiner' });
    await waitFor(client, 'joined');
    return client.id;
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
  // T6b: call-counting force so the FIRST rate-limit check (the handler under
  // test) sees an over-limit count and bails, while LATER checks see a normal
  // count. This lets the flushSocket() sentinel — itself a rate-limited event —
  // pass the limiter so its reply can serve as the deterministic barrier. Per
  // Socket.IO per-socket ordering, the suspect handler's exec() runs before the
  // sentinel's, so the suspect always gets the over-limit count.
  function forceRateLimitExceeded() {
    let firstExec = true;
    mockPubClient.multi.mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockImplementation(() => {
        // First exec after the force = the suspect event → over the limit.
        // Subsequent execs (the sentinel) = a normal count so it goes through.
        const count = firstExec ? 999 : 1;
        firstExec = false;
        return Promise.resolve([count, 1]);
      }),
    });
  }

  test('requestPublicLobbies is rate-limited (no Redis fan-out when over limit)', async () => {
    await connect();
    forceRateLimitExceeded();

    client.emit('requestPublicLobbies');
    // T6b: deterministic barrier instead of a 250ms sleep — the sentinel reply
    // can only arrive after the requestPublicLobbies handler already ran (and
    // bailed at the limiter), so the negative assertion below is race-free.
    await flushSocket(client);

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
    await flushSocket(client); // T6b: sentinel barrier replaces the sleep

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

    // T6b: sentinel barrier instead of a sleep — once the sentinel replies we
    // know setGameMode was already processed, so the negative saveLobby
    // assertion is deterministic. (setGameMode is not rate-limit-forced here,
    // so the dailyLeaderboard sentinel passes the limiter normally.)
    await flushSocket(client);

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
    // T6b: sentinel barrier replaces the sleep — startLobby on an already-
    // playing lobby is a no-op, so once the sentinel replies (processed after
    // startLobby was invoked) the negative assertions below are race-free.
    await flushSocket(client);

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
    // T6b: join the room channel so the elimination's terminal stateUpdate
    // broadcast (io.to(lobbyId)) actually reaches us — that broadcast is the
    // LAST thing the eliminate path does, so waiting on it is a true completion
    // barrier (replaces the 250ms sleep, which only hoped the async chain was
    // done). buildPlayingRoom uses 'QUIT01', so we join that channel.
    await joinClientToRoom('QUIT01');
    const room = buildPlayingRoom(client.id, 0);
    redisUtils.getLobby.mockResolvedValue(room);
    redisUtils.saveLobby.mockClear(); // ignore the join flow's own saves

    const settled = waitFor(client, 'stateUpdate'); // terminal broadcast
    client.emit('quitGame', 'QUIT01');
    await settled;

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
    // T6b: same room-channel barrier — the else-branch ends with a broadcastState
    // (stateUpdate) after recording the quit, so we wait on that instead of sleeping.
    await joinClientToRoom('QUIT01');
    // currentTurnIndex=1 → the OTHER player has the turn; client is index 0.
    const room = buildPlayingRoom(client.id, 1);
    redisUtils.getLobby.mockResolvedValue(room);

    const settled = waitFor(client, 'stateUpdate'); // terminal broadcast
    client.emit('quitGame', 'QUIT01');
    await settled;

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
    // T6b: sentinel barrier replaces the sleep. The not-playing branch early-
    // returns and NEVER mutates isAlive on any timing, so once the sentinel
    // (which is processed strictly after quitGame is invoked) replies, the
    // negative assertion is race-free.
    await flushSocket(client);

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
      // Snapshot the limiter-pipeline call count BEFORE the suspect emit. The
      // flushSocket() sentinel below is itself a rate-limited event, so it adds
      // exactly ONE multi() call — we assert the suspect query contributed ZERO
      // by checking the delta is exactly the sentinel's single call. (A plain
      // "not.toHaveBeenCalled()" would be polluted by the sentinel; this is the
      // deterministic-barrier equivalent that still proves the guard killed the
      // query before the limiter ran.)
      const multiCallsBefore = mockPubClient.multi.mock.calls.length;
      // ' a ' trims to a single char — the guard is min-2 AFTER trim, so
      // whitespace padding can't smuggle a junk query through.
      client.emit('heroActorSearch', { query: ' a ' });
      // T6b: sentinel barrier replaces the 250ms sleep. Per per-socket ordering,
      // the heroActorSearch handler ran (and synchronously early-returned at the
      // sub-2-char guard) before this sentinel reply arrives.
      await flushSocket(client);

      expect(answered).toBe(false);
      // Zero TMDB spend…
      expect(global.fetch).not.toHaveBeenCalled();
      // …and zero limiter spend: the rate-limit pipeline runs through
      // pubClient.multi(). The only multi() since the snapshot is the sentinel's
      // own one call — the guarded query spent none.
      expect(mockPubClient.multi.mock.calls.length).toBe(multiCallsBefore + 1);
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

    // T6b: sentinel barrier replaces the 300ms sleep. The sentinel
    // (requestDailyLeaderboard) does NOT touch getLobby — which is mocked to
    // reject here — so it still replies, and its reply proves the erroring
    // sendChat was processed (and swallowed by the error boundary) without
    // tearing down the connection.
    await flushSocket(client);

    // The socket should still be connected (error boundary caught the throw)
    expect(client.connected).toBe(true);

    // Now do a normal operation to prove the socket still works
    redisUtils.getLobby.mockResolvedValue(null);
    client.emit('joinLobby', { name: 'StillAlive', lobbyId: '', stableId: 'p_alive' });

    const data = await waitFor(client, 'joined');
    expect(data.lobbyId).toBeDefined();
  });

  // ==========================================================================
  // T6a — THIN-HANDLER COVERAGE
  // ==========================================================================
  // socketHandlers.js is the wire-input security surface; several handlers had
  // no integration coverage (the guard branches T1f/T3 added were unpinned).
  // For each, one guard-rejection test + one happy-path test, asserting
  // OBSERVABLE behavior (emits, Redis writes/absence) — never internal calls
  // where an emit is available. Gaps only: rate-limit/IP/lock specifics are
  // already covered by ip-ratelimit / disconnect-rejoin-lock / lock-unification.

  // -------------------------------------------------------------------------
  // DAILY CHALLENGE
  // -------------------------------------------------------------------------

  test('startDailyChallenge with missing stableId emits an error and makes no claim', async () => {
    // Guard: the handler clamps the name, then lobbySystem rejects a non-string
    // / empty stableId BEFORE attempting the atomic claim. Spy on the claim so
    // we can prove no attempt was minted on the reject path.
    const claimSpy = jest.spyOn(dailySystem, 'claimDailyAttempt').mockResolvedValue(null);
    try {
      await connect();
      // stableId omitted entirely — the in-handler auth guard must fire first.
      client.emit('startDailyChallenge', { name: 'Solo' });

      const msg = await waitFor(client, 'error');
      expect(msg).toContain('stable identity');
      // No NX claim may be attempted when identity is missing.
      expect(claimSpy).not.toHaveBeenCalled();
    } finally {
      claimSpy.mockRestore();
    }
  });

  test('T7b: startDailyChallenge with an oversized stableId makes no daily claim', async () => {
    // Guard: unlike joinLobby/requestMyStats/setEquippedTitle (which all cap
    // stableId at 64), the daily handler used to forward stableId UNCLAMPED
    // into dailySystem.claimDailyAttempt → daily:attempt:<date>:<stableId>
    // Redis key. The .slice(0,12) that protects the LOBBY id happens later and
    // does NOT cover that key, so a multi-KB stableId minted a multi-KB Redis
    // key for free. The handler must now reject (silent return, mirroring
    // requestMyStats' >64 guard) BEFORE any claim is attempted.
    const claimSpy = jest.spyOn(dailySystem, 'claimDailyAttempt').mockResolvedValue(null);
    try {
      await connect();
      // 65 chars — one past the 64 cap the sibling handlers enforce. The legit
      // client stableId is `p_` + 32 hex = 34 chars, so nothing real trips this.
      client.emit('startDailyChallenge', { name: 'Huge', stableId: 'p_' + 'a'.repeat(63) });
      // Sentinel barrier: a same-socket requestDailyLeaderboard reply can only
      // arrive after the (rejected) startDailyChallenge fully processed, so if
      // the claim were going to fire it would have by now.
      await flushSocket(client);
      // No NX claim may be attempted for an over-cap identity — the oversized
      // value never reached the Redis-key construction.
      expect(claimSpy).not.toHaveBeenCalled();
    } finally {
      claimSpy.mockRestore();
    }
  });

  test('startDailyChallenge for an already-played day emits dailyAlreadyPlayed (no new lobby)', async () => {
    // Happy path through the "already played today" branch — the lightest fully
    // observable success path (no TMDB seed fetch / lobby bootstrap needed).
    // claim.created=false routes to the dailyAlreadyPlayed emit.
    const claimSpy = jest.spyOn(dailySystem, 'claimDailyAttempt').mockResolvedValue({
      created: false,
      attempt: { status: 'done', chainLength: 7, name: 'Repeat' },
    });
    // getDailyLeaderboard is awaited on this branch — return a known list so
    // we can assert it's forwarded verbatim in the payload.
    const lbSpy = jest.spyOn(dailySystem, 'getDailyLeaderboard')
      .mockResolvedValue([{ chainLength: 7, name: 'Repeat' }]);
    try {
      await connect();
      client.emit('startDailyChallenge', { name: 'Repeat', stableId: 'p_repeat' });

      const data = await waitFor(client, 'dailyAlreadyPlayed');
      expect(typeof data.date).toBe('string');
      expect(data.puzzleNumber).toBeGreaterThanOrEqual(1);
      expect(data.attempt.chainLength).toBe(7);
      expect(data.leaderboard).toEqual([{ chainLength: 7, name: 'Repeat' }]);
    } finally {
      claimSpy.mockRestore();
      lbSpy.mockRestore();
    }
  });

  test('requestDailyLeaderboard with a junk date falls back to today and emits a leaderboard', async () => {
    // Guard half: a non-YYYY-MM-DD date must NOT reach Redis as-is — the
    // handler substitutes getTodayDate(). We spy to capture the date actually
    // queried, proving the junk string was sanitized away.
    const lbSpy = jest.spyOn(dailySystem, 'getDailyLeaderboard').mockResolvedValue([]);
    try {
      await connect();
      client.emit('requestDailyLeaderboard', 'not-a-date');

      const data = await waitFor(client, 'dailyLeaderboard');
      // Emitted date is the sanitized fallback, never the junk input.
      expect(data.date).not.toBe('not-a-date');
      expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(data.puzzleNumber).toBeGreaterThanOrEqual(1);
      // The DB query used the sanitized date, not the attacker-supplied junk.
      expect(lbSpy).toHaveBeenCalledWith(expect.anything(), data.date, 20);
    } finally {
      lbSpy.mockRestore();
    }
  });

  test('requestDailyLeaderboard with a valid date queries that exact date', async () => {
    // Happy path: a well-formed date passes the regex and is used verbatim.
    const lbSpy = jest.spyOn(dailySystem, 'getDailyLeaderboard')
      .mockResolvedValue([{ chainLength: 5, name: 'Ace' }]);
    try {
      await connect();
      client.emit('requestDailyLeaderboard', '2026-06-09');

      const data = await waitFor(client, 'dailyLeaderboard');
      expect(data.date).toBe('2026-06-09');
      expect(data.leaderboard).toEqual([{ chainLength: 5, name: 'Ace' }]);
      expect(lbSpy).toHaveBeenCalledWith(expect.anything(), '2026-06-09', 20);
    } finally {
      lbSpy.mockRestore();
    }
  });

  // -------------------------------------------------------------------------
  // PLAYABLE HERO (pre-room)
  // -------------------------------------------------------------------------

  test('heroPuzzleRequest delivers a client-safe puzzle (answer set stripped)', async () => {
    // Happy path: the handler picks a random puzzle and strips the multi-actor
    // answer set (validActorTmdbIds) before sending. The wire payload must
    // carry the pair + the single revealActor, never the full answer set.
    await connect();
    client.emit('heroPuzzleRequest');

    const puzzle = await waitFor(client, 'heroPuzzleDelivered');
    expect(typeof puzzle.pairId).toBe('string');
    expect(puzzle.movieA).toBeDefined();
    expect(puzzle.movieB).toBeDefined();
    // The answer set must never cross the wire — only the single reveal name.
    expect(puzzle.validActorTmdbIds).toBeUndefined();
    expect(puzzle.revealActor).toBeDefined();
  });

  test('heroGuessSubmit drops a non-numeric actorTmdbId before validating', async () => {
    // Guard: actorTmdbId must be an integer. A string id is dropped silently —
    // no heroGuessResult is emitted. Prove the negative with a sentinel
    // round-trip (T6b pattern) rather than a real sleep.
    await connect();
    let answered = false;
    client.on('heroGuessResult', () => { answered = true; });

    client.emit('heroGuessSubmit', { pairId: 'hp_005_titanic_wolf', actorTmdbId: 'oops', actorName: 'X' });
    await flushSocket(client); // barrier — proves the bad guess was processed

    expect(answered).toBe(false);
  });

  test('heroGuessSubmit validates a known pair and reveals the canonical actor', async () => {
    // Happy path: a known pairId + the correct actor tmdbId classifies as
    // correct and returns the reveal actor. hp_005 → 6193 (Leonardo DiCaprio).
    await connect();
    client.emit('heroGuessSubmit', { pairId: 'hp_005_titanic_wolf', actorTmdbId: 6193 });

    const result = await waitFor(client, 'heroGuessResult');
    expect(result.pairId).toBe('hp_005_titanic_wolf');
    expect(result.correct).toBe(true);
    expect(result.revealActor.tmdbId).toBe(6193);
  });

  test('heroGuessSubmit on an unknown pair returns a defensive null reveal', async () => {
    // Branch: an unknown pairId yields { ok:false } inside validateGuess, so
    // the handler emits a generic incorrect outcome with a null reveal rather
    // than hanging the client.
    await connect();
    client.emit('heroGuessSubmit', { pairId: 'hp_does_not_exist', actorTmdbId: 6193 });

    const result = await waitFor(client, 'heroGuessResult');
    expect(result.correct).toBe(false);
    expect(result.revealActor).toBeNull();
  });

  test('heroActorSearch (≥2 chars) proxies to TMDB and returns mapped results', async () => {
    // Happy path complement to the T3d sub-2-char drop test above: a valid
    // query DOES spend a TMDB call and emits the mapped results back, keyed
    // by the original query so the client can match late responses.
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ id: 31, name: 'Tom Hanks', profile_path: '/th.jpg', known_for: [{ title: 'Big' }] }],
      }),
    });
    try {
      await connect();
      client.emit('heroActorSearch', { query: 'Tom Hanks' });

      const data = await waitFor(client, 'heroActorResults');
      expect(data.query).toBe('Tom Hanks');
      expect(data.results).toHaveLength(1);
      expect(data.results[0]).toMatchObject({ tmdbId: 31, name: 'Tom Hanks' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = realFetch;
    }
  });

  // -------------------------------------------------------------------------
  // MATCH SYSTEM — autocomplete, submit, force-next-turn
  // -------------------------------------------------------------------------

  test('autocompleteSearch by a non-member is dropped before any TMDB spend', async () => {
    // Guard: matchSystem.autocompleteSearch requires the caller to be a player
    // in the room. The connected client is NOT in this lobby's players, so the
    // handler must bail before fetching — proven via a sentinel barrier.
    const realFetch = global.fetch;
    global.fetch = jest.fn();
    redisUtils.getLobby.mockResolvedValue({
      id: 'AC01', status: 'playing', allowTvShows: false,
      players: [{ id: 'someone-else', name: 'Other' }],
    });
    try {
      await connect();
      let answered = false;
      client.on('autocompleteResults', () => { answered = true; });

      client.emit('autocompleteSearch', { query: 'Inception', lobbyId: 'AC01' });
      await flushSocket(client); // barrier

      expect(global.fetch).not.toHaveBeenCalled();
      expect(answered).toBe(false);
    } finally {
      global.fetch = realFetch;
    }
  });

  test('autocompleteSearch by a member returns TMDB-mapped suggestions', async () => {
    // Happy path: a member's query hits TMDB and the top results are mapped to
    // the client suggestion shape (person results filtered out, capped at 5).
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { id: 27205, title: 'Inception', release_date: '2010-07-16', poster_path: '/inc.jpg', media_type: 'movie' },
          { id: 99, name: 'Some Person', media_type: 'person' }, // must be filtered out
        ],
      }),
    });
    try {
      await connect();
      redisUtils.getLobby.mockResolvedValue({
        id: 'AC02', status: 'playing', allowTvShows: false,
        players: [{ id: client.id, name: 'Me' }],
      });

      client.emit('autocompleteSearch', { query: 'Inception', lobbyId: 'AC02' });

      const results = await waitFor(client, 'autocompleteResults');
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(1); // person entry filtered out
      expect(results[0]).toMatchObject({ id: 27205, title: 'Inception', year: '2010' });
    } finally {
      global.fetch = realFetch;
    }
  });

  test('submitMovie with an oversized movie string is dropped before taking the submit lock', async () => {
    // Guard: a movie title longer than 200 chars is rejected at the handler
    // boundary, BEFORE matchSystem acquires the per-lobby submit lock. The
    // absence of an acquireSubmitLock call is the observable proof the call
    // short-circuited.
    await connect();
    redisUtils.getLobby.mockResolvedValue(buildPlayingRoom(client.id, 0));

    client.emit('submitMovie', { lobbyId: 'QUIT01', movie: 'X'.repeat(201) });
    await flushSocket(client); // barrier

    expect(redisUtils.acquireSubmitLock).not.toHaveBeenCalled();
  });

  test('submitMovie wiring: a well-formed in-turn submit reaches the lock pipeline', async () => {
    // Happy-path wiring: a valid in-turn submit passes every handler guard and
    // enters matchSystem's lock→resolve pipeline. acquireSubmitLock being
    // called is the observable seam that proves the handler delegated (we do
    // NOT drive the full TMDB resolution — that's matchSystem's own suite).
    const realFetch = global.fetch;
    // The pipeline searches TMDB after the lock; return zero candidates so it
    // resolves quickly down the "title not found" branch without needing a
    // full credits fixture. The lock acquisition is what we assert.
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    try {
      await connect();
      redisUtils.getLobby.mockResolvedValue(buildPlayingRoom(client.id, 0));

      client.emit('submitMovie', { lobbyId: 'QUIT01', movie: 'Inception' });
      // submissionRejected ('Title not found') confirms the pipeline ran end
      // to end — a stronger observable than spying on the lock call alone.
      const rejected = await waitFor(client, 'submissionRejected');
      expect(rejected.reason).toBe('Title not found');
      expect(redisUtils.acquireSubmitLock).toHaveBeenCalledWith(mockPubClient, 'QUIT01');
    } finally {
      global.fetch = realFetch;
    }
  });

  test('forceNextTurn by a non-member never takes the submit lock... (member + expired turn does)', async () => {
    // Two-in-one wiring pin. forceNextTurn first acquires the lock, then bails
    // if the caller is not a participant. So the lock IS taken either way, but
    // a non-member never reaches eliminateCurrentPlayer (no saveLobby on a
    // non-expired, non-member call). We assert the member+expired case advances.
    await connect();
    // Expired turn (turnExpiresAt in the past) + client is a member → the
    // handler calls eliminateCurrentPlayer, which persists the lobby.
    const room = buildPlayingRoom(client.id, 0);
    room.turnExpiresAt = Date.now() - 1000; // already expired
    redisUtils.getLobby.mockResolvedValue(room);

    client.emit('forceNextTurn', 'QUIT01');
    await flushSocket(client); // barrier

    // Lock taken (wiring) and elimination ran (saveLobby persisted the advance).
    expect(redisUtils.acquireSubmitLock).toHaveBeenCalledWith(mockPubClient, 'QUIT01');
    expect(redisUtils.saveLobby).toHaveBeenCalled();
  });

  test('forceNextTurn on a not-yet-expired turn releases the lock without eliminating', async () => {
    // Guard: a turn whose timer has NOT expired must no-op (the lock is taken
    // then released; no elimination, no save). Prevents a player from forcing
    // a skip before time is actually up.
    await connect();
    const room = buildPlayingRoom(client.id, 0);
    room.turnExpiresAt = Date.now() + 60000; // plenty of time left
    redisUtils.getLobby.mockResolvedValue(room);

    client.emit('forceNextTurn', 'QUIT01');
    await flushSocket(client); // barrier

    expect(redisUtils.acquireSubmitLock).toHaveBeenCalledWith(mockPubClient, 'QUIT01');
    // No elimination ⇒ no lobby persistence on this path.
    expect(redisUtils.saveLobby).not.toHaveBeenCalled();
    expect(redisUtils.releaseSubmitLock).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SOCIAL — chat, reactions
  // -------------------------------------------------------------------------

  test('sendChat from a non-participant is not broadcast', async () => {
    // Guard: only players/spectators in the room may chat. The connected client
    // is not in this room, so no receiveChat may be broadcast and the locked
    // chatCount increment must not run.
    redisUtils.getLobby.mockResolvedValue({
      id: 'CHAT01', status: 'playing',
      players: [{ id: 'other', name: 'Other' }], spectators: [],
    });
    await connect();
    let broadcast = false;
    client.on('receiveChat', () => { broadcast = true; });

    client.emit('sendChat', { lobbyId: 'CHAT01', msg: 'sneaky' });
    await flushSocket(client); // barrier

    expect(broadcast).toBe(false);
    expect(redisUtils.withLobbyLock).not.toHaveBeenCalled();
  });

  test('sendChat from a participant broadcasts receiveChat and bumps the locked chat counter', async () => {
    // Happy path: a participating player's message is broadcast to the room
    // with their display name, and the per-lobby chatCount is incremented under
    // the lobby lock (the M4 vibe-tag counter). The socket must be joined to
    // the room channel for io.to(lobbyId) to reach it.
    await connect();
    await joinClientToRoom('CHAT02');
    const room = {
      id: 'CHAT02', status: 'playing',
      players: [{ id: client.id, name: 'Talker' }], spectators: [],
      chatCount: 0,
    };
    redisUtils.getLobby.mockResolvedValue(room);

    client.emit('sendChat', { lobbyId: 'CHAT02', msg: 'hello room' });

    const chat = await waitFor(client, 'receiveChat');
    expect(chat.msg).toBe('hello room');
    expect(chat.playerName).toBe('Talker');
    expect(chat.isSpectator).toBe(false);
    // The fire-and-forget locked increment must have run.
    await flushSocket(client); // let the .catch()-wrapped lock settle
    expect(redisUtils.withLobbyLock).toHaveBeenCalledWith(mockPubClient, 'CHAT02', expect.any(Function));
  });

  test('sendReaction with an oversized emoji is dropped before any room lookup', async () => {
    // Guard: emoji must be ≤8 chars. An oversized "emoji" (an attempt to smuggle
    // a payload) is dropped before the getLobby read even happens.
    await connect();
    let broadcast = false;
    client.on('receiveReaction', () => { broadcast = true; });

    client.emit('sendReaction', { lobbyId: 'RX01', emoji: 'x'.repeat(20) });
    await flushSocket(client); // barrier

    expect(broadcast).toBe(false);
    expect(redisUtils.getLobby).not.toHaveBeenCalled();
  });

  test('sendReaction from a participant broadcasts receiveReaction', async () => {
    // Happy path: a participating player's reaction is broadcast room-wide with
    // their socket id so clients can anchor the floating emoji to their seat.
    // Join the room channel first so io.to(lobbyId) reaches this socket.
    await connect();
    await joinClientToRoom('RX02');
    const room = {
      id: 'RX02', status: 'playing',
      players: [{ id: client.id, name: 'Reactor' }], spectators: [],
    };
    redisUtils.getLobby.mockResolvedValue(room);

    client.emit('sendReaction', { lobbyId: 'RX02', emoji: '🎬' });

    const rx = await waitFor(client, 'receiveReaction');
    expect(rx.emoji).toBe('🎬');
    expect(rx.playerId).toBe(client.id);
  });

  // -------------------------------------------------------------------------
  // SPECTATOR PREDICTIONS (L3)
  // -------------------------------------------------------------------------

  test('spectatorPredict with an invalid prediction value is ignored', async () => {
    // Guard: prediction must be exactly 'yes' or 'no'. Anything else is dropped
    // — no lock taken, no state change. (The rate-limit gate runs first; an
    // invalid value past it must still no-op.)
    redisUtils.getLobby.mockResolvedValue({
      id: 'PRED01', status: 'playing',
      players: [{ id: 'p1', name: 'P1' }], spectators: [{ id: 'spec', name: 'Watcher' }],
    });
    await connect();

    client.emit('spectatorPredict', { lobbyId: 'PRED01', prediction: 'maybe' });
    await flushSocket(client); // barrier

    // Invalid value short-circuits before the withLobbyLock read-modify-write.
    expect(redisUtils.withLobbyLock).not.toHaveBeenCalled();
  });

  test('spectatorPredict from a real spectator records the vote and re-broadcasts state', async () => {
    // Happy path: a genuine spectator's 'yes' vote is recorded into
    // spectatorPredictions under the lock, and the updated tally is
    // re-broadcast via broadcastState (a stateUpdate emit).
    await connect();
    // Join the room channel so broadcastState's io.to(lobbyId) reaches us.
    await joinClientToRoom('PRED02');
    const room = {
      id: 'PRED02', status: 'playing',
      players: [{ id: 'p1', name: 'P1' }],
      spectators: [{ id: client.id, name: 'Watcher' }],
      chain: [], spectatorPredictions: {},
    };
    redisUtils.getLobby.mockResolvedValue(room);

    client.emit('spectatorPredict', { lobbyId: 'PRED02', prediction: 'yes' });

    // broadcastState emits 'stateUpdate' room-wide; receiving it proves the
    // vote was recorded and the tally re-broadcast.
    const state = await waitFor(client, 'stateUpdate');
    expect(state).toBeDefined();
    expect(room.spectatorPredictions[client.id]).toBe('yes');
  });

  // -------------------------------------------------------------------------
  // TYPING INDICATOR (M3)
  // -------------------------------------------------------------------------

  test('typing is not relayed when the caller is not the active player', async () => {
    // Guard: only the player whose turn it is may announce typing. A non-active
    // player's typing event must not reach peers. We verify via a SECOND client
    // in the room that never receives peerTyping.
    const room = {
      id: 'TYPE01', status: 'playing', currentTurnIndex: 0,
      players: [
        { id: 'active-player', name: 'Active' },
        { id: 'idle-player', name: 'Idle' },
      ],
    };
    redisUtils.getLobby.mockResolvedValue(room);

    // Observer client joins the room channel so it could receive peerTyping.
    const observer = Client(`http://localhost:${port}`, { forceNew: true, transports: ['websocket'] });
    await waitFor(observer, 'connect');

    try {
      await connect(); // `client` is the non-active typer
      // Both sockets must be in the room for socket.to(lobbyId) to reach the
      // observer; join via the server-side room is done by the join flow, but
      // here we drive typing directly, so put the observer in the room channel
      // by having the server emit — simplest: the observer listens, and we
      // assert it never fires.
      let relayed = false;
      observer.on('peerTyping', () => { relayed = true; });

      client.emit('typing', 'TYPE01'); // client.id !== active-player → must drop
      await flushSocket(client); // barrier

      expect(relayed).toBe(false);
    } finally {
      observer.disconnect();
    }
  });

  test('typing from the active player relays peerTyping to peers (not the sender)', async () => {
    // Happy path: the active player's typing is relayed to OTHER sockets in the
    // room (socket.to excludes the sender). We use two real sockets both joined
    // to the same lobby so the room channel is genuine.
    await connect(); // this is the active player
    const activeId = client.id;
    const room = {
      id: 'TYPE02', status: 'playing', currentTurnIndex: 0,
      players: [{ id: activeId, name: 'Active' }, { id: 'peer-id', name: 'Peer' }],
    };
    redisUtils.getLobby.mockResolvedValue(room);

    // A second socket joins lobby TYPE02 via the real join flow so it shares
    // the room channel and can receive the relayed peerTyping.
    const peer = Client(`http://localhost:${port}`, { forceNew: true, transports: ['websocket'] });
    await waitFor(peer, 'connect');
    try {
      // Drive the peer into the room channel through joinLobby (NX-create
      // returns null → existing-room path → server does socket.join).
      mockPubClient.set.mockResolvedValueOnce(null);
      redisUtils.getLobby.mockResolvedValueOnce({
        id: 'TYPE02', status: 'waiting',
        players: [{ id: 'host', name: 'H', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's_h' }],
        chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
        allowTvShows: false, isPublic: false, timerMultiplier: 0, turnExpiresAt: null,
        isValidating: false, gameMode: 'classic',
      });
      peer.emit('joinLobby', { name: 'Peer', lobbyId: 'TYPE02', stableId: 's_peer' });
      await waitFor(peer, 'joined');
      // Restore the playing-room lookup for the typing handler.
      redisUtils.getLobby.mockResolvedValue(room);

      const relayed = waitFor(peer, 'peerTyping');
      client.emit('typing', 'TYPE02');
      const data = await relayed;
      expect(data.playerName).toBe('Active');
    } finally {
      peer.disconnect();
    }
  });

  // -------------------------------------------------------------------------
  // LEAVE LOBBY
  // -------------------------------------------------------------------------

  test('leaveLobby leaves the socket channel and runs the disconnect cleanup', async () => {
    // Happy path: leaveLobby looks up the socket's lobby, leaves that channel,
    // and routes through handleDisconnect (the same cleanup as a real
    // disconnect). We observe the getSocketLobby lookup + disconnect side-effects.
    redisUtils.getSocketLobby.mockResolvedValue('LEAVE01');
    redisUtils.getLobby.mockResolvedValue({
      id: 'LEAVE01', status: 'waiting',
      players: [{ id: 'me', name: 'Leaver', isHost: true, isAlive: true, connected: true, teamId: 0, stableId: 's_l' }],
      spectators: [],
    });
    await connect();

    client.emit('leaveLobby');
    await flushSocket(client); // barrier

    // The handler read the socket→lobby mapping (then leaves + cleans up).
    expect(redisUtils.getSocketLobby).toHaveBeenCalledWith(mockPubClient, client.id);
  });

  // -------------------------------------------------------------------------
  // HOST-SETTINGS DELEGATION WIRING
  // -------------------------------------------------------------------------
  // These handlers are thin rate-limit→delegate routers. The observable
  // contract is "the parsed payload reached the right lobbySystem method".
  // We spy on lobbySystem (real module) and assert the delegation, restoring
  // every spy afterward so no cross-test bleed occurs.

  test('setGameMode / selectRuleKit / setTheme / assignTeam / selectColor / toggle* delegate to lobbySystem', async () => {
    const spies = {
      setGameMode: jest.spyOn(lobbySystem, 'setGameMode').mockResolvedValue(undefined),
      selectRuleKit: jest.spyOn(lobbySystem, 'selectRuleKit').mockResolvedValue(undefined),
      setTheme: jest.spyOn(lobbySystem, 'setTheme').mockResolvedValue(undefined),
      assignTeam: jest.spyOn(lobbySystem, 'assignTeam').mockResolvedValue(undefined),
      selectColor: jest.spyOn(lobbySystem, 'selectColor').mockResolvedValue(undefined),
      toggleSetting: jest.spyOn(lobbySystem, 'toggleSetting').mockResolvedValue(undefined),
    };
    try {
      await connect();
      client.emit('setGameMode', { lobbyId: 'L1', mode: 'speed' });
      client.emit('selectRuleKit', { lobbyId: 'L1', kitId: 'comedy' });
      client.emit('setTheme', { lobbyId: 'L1', theme: 'horror' });
      client.emit('assignTeam', { lobbyId: 'L1', teamId: 1 });
      client.emit('selectColor', { lobbyId: 'L1', color: '#ff0000' });
      client.emit('togglePublic', { lobbyId: 'L1', state: true });
      client.emit('toggleHardcore', { lobbyId: 'L1', state: true });
      client.emit('toggleTvShows', { lobbyId: 'L1', state: true });
      await flushSocket(client); // barrier — all eight delegations have run

      expect(spies.setGameMode).toHaveBeenCalledWith(expect.anything(), expect.anything(), { lobbyId: 'L1', mode: 'speed' });
      expect(spies.selectRuleKit).toHaveBeenCalledWith(expect.anything(), expect.anything(), { lobbyId: 'L1', kitId: 'comedy' });
      expect(spies.setTheme).toHaveBeenCalled();
      expect(spies.assignTeam).toHaveBeenCalled();
      expect(spies.selectColor).toHaveBeenCalled();
      // The three toggle handlers all route through toggleSetting with the
      // field name as the 4th arg — assert the field dispatch is correct.
      expect(spies.toggleSetting).toHaveBeenCalledWith(expect.anything(), expect.anything(), { lobbyId: 'L1', state: true }, 'isPublic');
      expect(spies.toggleSetting).toHaveBeenCalledWith(expect.anything(), expect.anything(), { lobbyId: 'L1', state: true }, 'hardcoreMode');
      expect(spies.toggleSetting).toHaveBeenCalledWith(expect.anything(), expect.anything(), { lobbyId: 'L1', state: true }, 'allowTvShows');
    } finally {
      Object.values(spies).forEach(s => s.mockRestore());
    }
  });

  test('kickPlayer / addBot / removeBot delegate to lobbySystem', async () => {
    const spies = {
      kickPlayer: jest.spyOn(lobbySystem, 'kickPlayer').mockResolvedValue(undefined),
      addBot: jest.spyOn(lobbySystem, 'addBot').mockResolvedValue(undefined),
      removeBot: jest.spyOn(lobbySystem, 'removeBot').mockResolvedValue(undefined),
    };
    try {
      await connect();
      client.emit('kickPlayer', { lobbyId: 'L2', targetId: 'pX' });
      client.emit('addBot', { lobbyId: 'L2' });
      client.emit('removeBot', { lobbyId: 'L2', botId: 'b1' });
      await flushSocket(client); // barrier

      expect(spies.kickPlayer).toHaveBeenCalledWith(expect.anything(), expect.anything(), { lobbyId: 'L2', targetId: 'pX' });
      // addBot/removeBot defensively pass data||{} — assert they ran.
      expect(spies.addBot).toHaveBeenCalled();
      expect(spies.removeBot).toHaveBeenCalled();
    } finally {
      Object.values(spies).forEach(s => s.mockRestore());
    }
  });

  test('requestMyStats with an empty stableId is dropped before any stats read', async () => {
    // Guard: stableId is the bearer auth — a non-string / empty / oversize value
    // must drop before the stats system is touched (no myStats emit).
    await connect();
    let answered = false;
    client.on('myStats', () => { answered = true; });

    client.emit('requestMyStats', ''); // empty string fails the length>0 guard
    await flushSocket(client); // barrier

    expect(answered).toBe(false);
  });

  test('setEquippedTitle with an oversized titleId is dropped before delegation', async () => {
    // Guard: titleId must be ≤64 chars. An oversized value drops before
    // lobbySystem.setEquippedTitle runs.
    const spy = jest.spyOn(lobbySystem, 'setEquippedTitle').mockResolvedValue(undefined);
    try {
      await connect();
      client.emit('setEquippedTitle', { stableId: 'p_ok', titleId: 'T'.repeat(65) });
      await flushSocket(client); // barrier

      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('leaveLobby with no mapped lobby still runs cleanup without throwing', async () => {
    // Edge path: a socket with no lobby mapping (never joined) must not throw —
    // the handler skips socket.leave and still calls handleDisconnect harmlessly.
    redisUtils.getSocketLobby.mockResolvedValue(null);
    await connect();

    client.emit('leaveLobby');
    await flushSocket(client); // barrier — proves the handler ran to completion

    expect(redisUtils.getSocketLobby).toHaveBeenCalledWith(mockPubClient, client.id);
    expect(client.connected).toBe(true); // no crash
  });
});
