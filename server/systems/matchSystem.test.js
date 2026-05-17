// ============================================================================
// matchSystem.test.js — Coverage for the submitMovie pipeline, with focus on
// the H1 "title not found = retry, not elimination" change.
// ============================================================================
// These tests pin behaviour the rest of the codebase relies on:
//   - A title TMDB can't find emits `submissionRejected` (private to the
//     submitting socket) and does NOT eliminate the player.
//   - The retry counter on the room is incremented per failed attempt.
//   - Once the per-turn retry budget is exhausted, the next miss falls
//     through to elimination with a clearer reason than the original.
// Without these tests, a regression that re-introduces the old "first miss
// kills you" behavior would silently ship and undo the fix.
// ============================================================================

const matchSystem = require('./matchSystem');
const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');

jest.mock('../redisUtils');

// Mock fetch — TMDB calls return whatever the test sets up. The default is
// "no results" so the title-not-found path is the natural fall-through.
global.fetch = jest.fn();

describe('matchSystem.submitMovie — title-not-found retry behaviour (H1)', () => {
  let mockIo;
  let mockSocket;
  let mockPubClient;
  let ctx;
  let logger;
  let room;

  // Helper: build a minimal-but-valid playing-state room for a single player.
  // Keep it simple — these tests exercise the title-not-found branch only,
  // which doesn't care about chains, hardcore mode, or other players.
  function buildRoom(overrides = {}) {
    return {
      id: 'TEST',
      status: 'playing',
      players: [{
        id: 'sock-1', name: 'Tester', isHost: true, isAlive: true,
        connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1'
      }],
      spectators: [],
      chain: [],
      usedMovies: [],
      hardcoreMode: false,
      previousSharedActors: [],
      allowTvShows: false,
      isPublic: false,
      timerMultiplier: 0,
      turnExpiresAt: Date.now() + 60000,
      isValidating: false,
      gameMode: 'classic',
      currentTurnIndex: 0,
      currentTurnRetries: 0,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    mockSocket = { id: 'sock-1', emit: jest.fn() };
    mockPubClient = {};
    logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    ctx = {
      io: mockIo,
      pubClient: mockPubClient,
      TMDB_HEADERS: { Authorization: 'Bearer test', accept: 'application/json' },
      logger,
    };

    // Default: lock acquire succeeds (returns a token); release is a no-op.
    // Failed tests can override these to test contention paths.
    redisUtils.acquireSubmitLock.mockResolvedValue('token-abc');
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.saveLobby.mockResolvedValue(undefined);
    redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [] });
  });

  afterEach(() => {
    // Clear any active turn timeouts that nextTurn / startGame may have armed —
    // otherwise they'd fire across test boundaries and crash on stale mocks.
    gameLogic.clearTurnTimeout('TEST');
  });

  // -------------------------------------------------------------------------
  // The headline H1 contract: a title-not-found does NOT eliminate.
  // -------------------------------------------------------------------------

  test('emits submissionRejected (not elimination) when TMDB has no candidates', async () => {
    room = buildRoom();
    redisUtils.getLobby.mockResolvedValue(room);

    // TMDB search returns an empty results array — the natural "not found" case.
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    await matchSystem.submitMovie(ctx, mockSocket, {
      lobbyId: 'TEST',
      movie: 'Avengers Endgaem', // intentional typo
    });

    // The submitting socket should receive a private rejection event.
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'submissionRejected',
      expect.objectContaining({
        reason: 'Title not found',
        retriesLeft: expect.any(Number),
        originalInput: 'Avengers Endgaem',
      })
    );

    // The player must still be alive — this is the whole point of H1.
    expect(room.players[0].isAlive).toBe(true);
    // Validation lock must be released for the next attempt.
    expect(room.isValidating).toBe(false);
    // No broadcast notification — others shouldn't learn about typos.
    // (mockIo.emit may be called for unrelated things like state updates,
    // but specifically NOT for a 'notification' with kind 'elimination'.)
    const eliminationCalls = mockIo.emit.mock.calls.filter(
      ([event, payload]) => event === 'notification' && payload?.kind === 'elimination'
    );
    expect(eliminationCalls).toHaveLength(0);
  });

  test('increments currentTurnRetries on each rejected submission', async () => {
    room = buildRoom({ currentTurnRetries: 0 });
    redisUtils.getLobby.mockResolvedValue(room);
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'Bogus 1' });
    expect(room.currentTurnRetries).toBe(1);

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'Bogus 2' });
    expect(room.currentTurnRetries).toBe(2);

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'Bogus 3' });
    expect(room.currentTurnRetries).toBe(3);
  });

  test('retriesLeft starts at MAX-1 (=2) on the first miss and decrements', async () => {
    // The constant MAX_TITLE_NOT_FOUND_RETRIES is 3 in matchSystem.js — first
    // miss leaves 2 retries, second leaves 1, third leaves 0 ("last chance").
    // Pinning the exact countdown here so a future change to the constant has
    // a single failing test (this one) that forces the author to update it
    // intentionally rather than silently changing player-facing copy.
    room = buildRoom({ currentTurnRetries: 0 });
    redisUtils.getLobby.mockResolvedValue(room);
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'A' });
    expect(mockSocket.emit).toHaveBeenLastCalledWith('submissionRejected',
      expect.objectContaining({ retriesLeft: 2 }));

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'B' });
    expect(mockSocket.emit).toHaveBeenLastCalledWith('submissionRejected',
      expect.objectContaining({ retriesLeft: 1 }));

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'C' });
    expect(mockSocket.emit).toHaveBeenLastCalledWith('submissionRejected',
      expect.objectContaining({ retriesLeft: 0 }));
  });

  test('falls through to elimination on the 4th miss (after 3 retries used)', async () => {
    // currentTurnRetries=3 means the player has already used all 3 free
    // retries — the 4th attempt should eliminate. Without this guard a
    // determined typoer (or troll) could stall the game indefinitely.
    room = buildRoom({ currentTurnRetries: 3, players: [
      { id: 'sock-1', name: 'Tester', isHost: true, isAlive: true,
        connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1' },
      { id: 'sock-2', name: 'Other', isHost: false, isAlive: true,
        connected: true, score: 0, wins: 0, teamId: 1, stableId: 's2' },
    ] });
    redisUtils.getLobby.mockResolvedValue(room);
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', movie: 'Final Bogus' });

    // The eliminated player is now dead.
    expect(room.players[0].isAlive).toBe(false);

    // The notification should mention the over-retry reason explicitly so
    // spectators understand what happened ("Too many invalid title attempts"
    // instead of the original "Title not found!" which read like a 1-shot fail).
    const elimNotifications = mockIo.emit.mock.calls.filter(
      ([event, payload]) => event === 'notification' && payload?.kind === 'elimination'
    );
    expect(elimNotifications.length).toBeGreaterThanOrEqual(1);
    const lastElim = elimNotifications[elimNotifications.length - 1][1];
    expect(lastElim.msg).toMatch(/Too many invalid title attempts/);
  });

  // -------------------------------------------------------------------------
  // Counter lifecycle — must reset between turns so each player gets a
  // fresh budget (otherwise a chain of typos by player A would penalise
  // player B's first attempt).
  // -------------------------------------------------------------------------

  test('nextTurn resets currentTurnRetries to 0 for the next player', async () => {
    const state = {
      gameMode: 'classic',
      players: [
        { id: '1', name: 'A', isAlive: true, score: 0 },
        { id: '2', name: 'B', isAlive: true, score: 0 }
      ],
      chain: [],
      status: 'playing',
      currentTurnIndex: 0,
      timerMultiplier: 0,
      turnTime: 60000,
      currentTurnRetries: 2, // player A had used 2 retries
    };

    await gameLogic.nextTurn(mockIo, mockPubClient, 'TEST', state);

    // Player B starts fresh — A's typo budget shouldn't follow the turn.
    expect(state.currentTurnRetries).toBe(0);

    gameLogic.clearTurnTimeout('TEST');
  });

  test('startGame initializes currentTurnRetries to 0', async () => {
    const state = {
      gameMode: 'classic',
      players: [
        { id: '1', isAlive: false, score: 100 },
        { id: '2', isAlive: false, score: 100 }
      ],
      status: 'waiting',
      // Old serialized state could have a stale value here from a previous
      // game — startGame must overwrite it, not preserve it.
      currentTurnRetries: 99,
    };

    await gameLogic.startGame(mockIo, mockPubClient, 'TEST', state);

    expect(state.currentTurnRetries).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H3 — "Why were you eliminated?" learning surface
// ---------------------------------------------------------------------------
// On an invalid-connection elimination, the server should send a private
// `youWereEliminated` event to the failing socket only, carrying both
// casts so the client can render a side-by-side comparison. The broadcast
// `attemptFailed` event continues to fire for everyone else (covered by
// the existing ghost-attempt client tests).

describe('matchSystem.submitMovie — youWereEliminated payload (H3)', () => {
  let mockIo, mockSocket, mockPubClient, ctx, logger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    mockSocket = { id: 'sock-1', emit: jest.fn() };
    mockPubClient = {};
    logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    ctx = {
      io: mockIo,
      pubClient: mockPubClient,
      TMDB_HEADERS: { Authorization: 'Bearer test', accept: 'application/json' },
      logger,
    };
    redisUtils.acquireSubmitLock.mockResolvedValue('token-abc');
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.saveLobby.mockResolvedValue(undefined);
  });

  afterEach(() => {
    gameLogic.clearTurnTimeout('TEST');
  });

  test('emits youWereEliminated to the failing socket on invalid connection', async () => {
    // A room with one prior play: chain has "Inception" (Leonardo DiCaprio).
    // The player is about to submit an unrelated movie with no shared cast,
    // which should trigger the H3 learning payload.
    const room = {
      id: 'TEST',
      status: 'playing',
      players: [{
        id: 'sock-1', name: 'Tester', isHost: true, isAlive: true,
        connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1'
      }, {
        id: 'sock-other', name: 'Other', isHost: false, isAlive: true,
        connected: true, score: 0, wins: 0, teamId: 1, stableId: 's2'
      }],
      spectators: [],
      chain: [{
        playerId: 'sock-other',
        playerName: 'Other',
        movie: {
          id: 27205,
          title: 'Inception',
          year: '2010',
          // Object-shape cast (post-H4) — no overlap with the candidate below.
          cast: [{ id: 6193, name: 'Leonardo DiCaprio' }, { id: 24045, name: 'Joseph Gordon-Levitt' }],
          mediaType: 'movie',
        },
        matchedActors: [],
      }],
      usedMovies: ['movie:27205'],
      hardcoreMode: false,
      previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0,
      turnExpiresAt: Date.now() + 60000, isValidating: false, gameMode: 'classic',
      currentTurnIndex: 0, currentTurnRetries: 0,
    };
    redisUtils.getLobby.mockResolvedValue(room);

    // Direct TMDB ID lookup path so we don't have to mock fetch — submit
    // with a tmdbId, server hits getOrFetchCredits which we mock to return
    // a candidate cast that shares NO actors with Inception.
    redisUtils.getOrFetchCredits.mockResolvedValue({
      cast: [{ id: 8784, name: 'Daniel Craig' }, { id: 1283, name: 'Helen Mirren' }]
    });

    // Direct lookup path: server fetches the movie details via fetch() —
    // mock the response so resolveCandidates produces a single candidate.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 36557,
        title: 'Casino Royale',
        release_date: '2006-11-14',
        poster_path: null,
      }),
    });

    await matchSystem.submitMovie(ctx, mockSocket, {
      lobbyId: 'TEST',
      movie: 'Casino Royale',
      tmdbId: 36557,
      mediaType: 'movie',
    });

    // Assert the H3 payload reached the failing socket.
    const elimEmit = mockSocket.emit.mock.calls.find(([event]) => event === 'youWereEliminated');
    expect(elimEmit).toBeDefined();
    const payload = elimEmit[1];

    // Both casts must be present and bare-name strings (the wire format).
    expect(payload.lastChainEntry.title).toBe('Inception');
    expect(payload.lastChainEntry.cast).toEqual(
      expect.arrayContaining(['Leonardo DiCaprio', 'Joseph Gordon-Levitt'])
    );
    expect(payload.yourGuess.title).toBe('Casino Royale');
    expect(payload.yourGuess.cast).toEqual(
      expect.arrayContaining(['Daniel Craig', 'Helen Mirren'])
    );
    // No actor appears in both — that's the whole reason for the elimination.
    const overlap = payload.yourGuess.cast.filter(a => payload.lastChainEntry.cast.includes(a));
    expect(overlap).toEqual([]);
    // Reason text propagates through so the client UI can show it.
    expect(typeof payload.reason).toBe('string');
    expect(payload.reason.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Audit finding #8 — submitMovie must not trust client mediaType/tmdbId.
// ============================================================================
// The direct-ID path interpolated client-supplied mediaType/tmdbId straight
// into the TMDB URL and the credits cache key, and (unlike the fuzzy-search
// path) never consulted room.allowTvShows. A modified client could submit a
// TV title in a movie-only lobby (game-integrity bypass) or push junk path
// segments that burn TMDB quota and pollute Redis with garbage cache keys.
describe('matchSystem.submitMovie — client mediaType/tmdbId validation (#8)', () => {
  let mockIo, mockSocket, ctx, logger, room;

  function buildRoom(overrides = {}) {
    return {
      id: 'TEST', status: 'playing',
      players: [{ id: 'sock-1', name: 'Tester', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1' }],
      spectators: [], chain: [], usedMovies: [], hardcoreMode: false,
      previousSharedActors: [], allowTvShows: false, isPublic: false,
      timerMultiplier: 0, turnExpiresAt: Date.now() + 60000, isValidating: false,
      gameMode: 'classic', currentTurnIndex: 0, currentTurnRetries: 0,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    mockSocket = { id: 'sock-1', emit: jest.fn() };
    logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    ctx = { io: mockIo, pubClient: {}, TMDB_HEADERS: { Authorization: 'Bearer test', accept: 'application/json' }, logger };
    redisUtils.acquireSubmitLock.mockResolvedValue('token-abc');
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.saveLobby.mockResolvedValue(undefined);
    redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [] });
    global.fetch = jest.fn();
  });

  afterEach(() => gameLogic.clearTurnTimeout('TEST'));

  function tvFetchCalls() {
    return global.fetch.mock.calls.filter(([url]) => typeof url === 'string' && url.includes('/tv/'));
  }

  test('does NOT hit a /tv/ endpoint for a tv tmdbId when allowTvShows is false', async () => {
    room = buildRoom({ allowTvShows: false });
    redisUtils.getLobby.mockResolvedValue(room);

    await matchSystem.submitMovie(ctx, mockSocket, {
      lobbyId: 'TEST', tmdbId: 1396, mediaType: 'tv', // Breaking Bad — TV
    });

    // The TV bypass: server must never fetch TV data in a movie-only room.
    expect(tvFetchCalls()).toHaveLength(0);
    // And the player isn't penalised by the rejection of an illegal payload
    // beyond the normal not-found retry (must still be alive).
    expect(room.players[0].isAlive).toBe(true);
  });

  test('ignores a non-integer tmdbId instead of interpolating it into a URL', async () => {
    room = buildRoom({ allowTvShows: true });
    redisUtils.getLobby.mockResolvedValue(room);

    await matchSystem.submitMovie(ctx, mockSocket, {
      lobbyId: 'TEST', tmdbId: '7 OR 1=1', mediaType: 'movie',
    });

    // No fetch URL may contain the raw injected token.
    const badCalls = global.fetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('7 OR 1=1')
    );
    expect(badCalls).toHaveLength(0);
  });

  test('still allows a tv tmdbId when the lobby permits TV shows', async () => {
    room = buildRoom({ allowTvShows: true });
    redisUtils.getLobby.mockResolvedValue(room);
    // Direct-ID lookup succeeds → details payload for the TV id.
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20' }) });

    await matchSystem.submitMovie(ctx, mockSocket, {
      lobbyId: 'TEST', tmdbId: 1396, mediaType: 'tv',
    });

    // TV is allowed here, so the direct /tv/ lookup is expected to run.
    expect(tvFetchCalls().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// CI2 — the core success path: a valid connecting movie commits and advances
// the turn. This is the central game action and was previously untested on
// the happy path (only the not-found / invalid-connection branches were).
// ---------------------------------------------------------------------------
describe('matchSystem.submitMovie — valid play commits and advances turn (CI2)', () => {
  let mockIo, mockSocket, mockPubClient, ctx, logger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    mockSocket = { id: 'sock-1', emit: jest.fn() };
    mockPubClient = {};
    logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    ctx = {
      io: mockIo, pubClient: mockPubClient,
      TMDB_HEADERS: { Authorization: 'Bearer test', accept: 'application/json' },
      logger,
    };
    redisUtils.acquireSubmitLock.mockResolvedValue('token-abc');
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.saveLobby.mockResolvedValue(undefined);
    // Safe default for getOrFetchCredits — keeps this describe self-contained
    // so a future test added here doesn't silently inherit undefined from
    // jest.clearAllMocks (which resets mock implementations to undefined, not
    // to their previous resolved value). The individual test that needs a
    // specific cast overrides this in its own body.
    redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [] });
  });

  afterEach(() => gameLogic.clearTurnTimeout('TEST'));

  test('commits a valid play and advances to the next player', async () => {
    // Chain head "Inception" has Leonardo DiCaprio. The submitted candidate
    // shares Leonardo DiCaprio, so validateChainConnection returns a match
    // and commitPlay runs, then nextTurn advances to player 2.
    const room = {
      id: 'TEST', status: 'playing',
      players: [
        { id: 'sock-1', name: 'Tester', isHost: true, isAlive: true,
          connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1' },
        { id: 'sock-2', name: 'Other', isHost: false, isAlive: true,
          connected: true, score: 0, wins: 0, teamId: 1, stableId: 's2' },
      ],
      spectators: [],
      chain: [{
        playerId: 'sock-2', playerName: 'Other',
        movie: {
          id: 27205, title: 'Inception', year: '2010',
          cast: [{ id: 6193, name: 'Leonardo DiCaprio' }, { id: 24045, name: 'Joseph Gordon-Levitt' }],
          mediaType: 'movie',
        },
        matchedActors: [],
      }],
      usedMovies: ['movie:27205'],
      hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0,
      turnExpiresAt: Date.now() + 60000, isValidating: false, gameMode: 'classic',
      currentTurnIndex: 0, currentTurnRetries: 0, turnTime: 45000,
    };
    redisUtils.getLobby.mockResolvedValue(room);

    // Direct-ID path: getOrFetchCredits returns a cast that SHARES Leonardo
    // DiCaprio with the chain head → a valid connection.
    redisUtils.getOrFetchCredits.mockResolvedValue({
      cast: [{ id: 6193, name: 'Leonardo DiCaprio' }, { id: 3, name: 'Tom Hardy' }],
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 272, title: 'Batman Begins', release_date: '2005-06-15', poster_path: null }),
    });

    await matchSystem.submitMovie(ctx, mockSocket, {
      lobbyId: 'TEST', movie: 'Batman Begins', tmdbId: 272, mediaType: 'movie',
    });

    // Success contract:
    expect(room.players[0].isAlive).toBe(true);
    const rejected = mockSocket.emit.mock.calls.filter(
      ([e]) => e === 'submissionRejected' || e === 'youWereEliminated');
    expect(rejected).toHaveLength(0);
    const elim = mockIo.emit.mock.calls.filter(
      ([e, p]) => e === 'notification' && p?.kind === 'elimination');
    expect(elim).toHaveLength(0);
    // the chain grew by one (the committed play)
    expect(room.chain.length).toBe(2);
    // Not just "a push happened" — the committed entry must be the movie
    // we submitted (tmdbId 272), so a regression that pushes a stub/wrong
    // entry is caught too. commitPlay stores validMatch.id on the
    // lightweightMovie object under room.chain[n].movie.id.
    expect(room.chain[1].movie.id).toBe(272);
    // nextTurn ran: turn advanced to player 2 and the retry budget reset
    expect(room.currentTurnIndex).toBe(1);
    expect(room.currentTurnRetries).toBe(0);
    // validation flag released
    expect(room.isValidating).toBe(false);
  });
});

// ============================================================================
// Phase 5a follow-up — two pre-existing latent gaps in submitMovie that
// submitBotMove also mirrors (fixed together for consistency):
//   Gap 1: after the post-enrich room re-read, `player` must be re-derived
//          from the FRESH room — using the stale pre-enrich object means a
//          player whose record changed during the async enrich window is
//          rendered with stale data on the chain / attemptFailed payload.
//   Gap 2: the inner catch re-reads getLobby with no null-check, so a Redis
//          blip at cleanup throws a TypeError that escapes as an unhandled
//          rejection (the lock is still released by finally).
// ============================================================================
describe('submitMovie — post-enrich object-graph + catch null-guard (Phase 5a follow-up)', () => {
  let mockIo, mockSocket, mockPubClient, logger, ctx;

  function freshClone(obj, mutate) {
    const c = JSON.parse(JSON.stringify(obj));
    if (mutate) mutate(c);
    return c;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    mockSocket = { id: 'sock-1', emit: jest.fn() };
    mockPubClient = {};
    logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    ctx = { io: mockIo, pubClient: mockPubClient, TMDB_HEADERS: { Authorization: 'Bearer test', accept: 'application/json' }, logger };
    redisUtils.acquireSubmitLock.mockResolvedValue('token-abc');
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.saveLobby.mockResolvedValue(undefined);
    redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [] });
  });

  afterEach(() => gameLogic.clearTurnTimeout('TEST'));

  function preRoom() {
    return {
      id: 'TEST', status: 'playing', isValidating: false, gameMode: 'classic',
      players: [
        { id: 'sock-1', name: 'StaleName', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1' },
        { id: 'sock-2', name: 'Other', isHost: false, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, stableId: 's2' },
      ],
      spectators: [],
      chain: [{ playerId: 'sock-2', playerName: 'Other', movie: { id: 1, title: 'First', year: '2000', cast: [{ id: 1, name: 'A' }], mediaType: 'movie' }, matchedActors: [] }],
      usedMovies: ['movie:1'], hardcoreMode: false, previousSharedActors: [],
      allowTvShows: false, isPublic: false, timerMultiplier: 0,
      turnExpiresAt: Date.now() + 60000, currentTurnIndex: 0, currentTurnRetries: 0,
    };
  }

  test('Gap 1: attemptFailed uses the player from the freshly re-read room (not the stale pre-enrich object)', async () => {
    const pre = preRoom();
    // The post-enrich re-read returns a DISTINCT room object whose current
    // player has been renamed (models any change to the player record during
    // the async resolve/enrich window). The chain is unchanged so the
    // candidate still fails to connect → the attemptFailed broadcast fires.
    const fresh = freshClone(pre, (c) => { c.players[0].name = 'FreshName'; });

    redisUtils.getLobby
      .mockResolvedValueOnce(pre)    // L125 pre-lock
      .mockResolvedValueOnce(pre)    // L139 post-lock
      .mockResolvedValueOnce(fresh); // L204 post-enrich
    // resolveCandidates direct-ID path → one candidate; its cast shares NO
    // actor with the chain's last node ([{id:1}]) → validateChainConnection
    // returns no match → the no-match attemptFailed branch runs.
    global.fetch.mockResolvedValueOnce({ json: async () => ({ id: 99, title: 'Guess', release_date: '2010-01-01' }) });
    redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 999, name: 'Nobody In Common' }] });

    await matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', tmdbId: 99, mediaType: 'movie' });

    const attemptFailed = mockIo.emit.mock.calls.find(([e]) => e === 'attemptFailed');
    expect(attemptFailed).toBeDefined();
    expect(attemptFailed[1].playerName).toBe('FreshName');
  });

  test('Gap 2: inner catch tolerates getLobby returning null at cleanup (resolves, lock still released)', async () => {
    const pre = preRoom();
    redisUtils.getLobby
      .mockResolvedValueOnce(pre)                                 // L125 pre-lock
      .mockResolvedValueOnce(pre)                                 // L139 post-lock
      .mockRejectedValueOnce(new Error('redis blip mid-pipeline')) // L204 post-enrich → throws into inner catch
      .mockResolvedValueOnce(null);                               // L307 catch re-read → null
    global.fetch.mockResolvedValueOnce({ json: async () => ({ id: 99, title: 'G', release_date: '2010-01-01' }) });

    await expect(
      matchSystem.submitMovie(ctx, mockSocket, { lobbyId: 'TEST', tmdbId: 99, mediaType: 'movie' })
    ).resolves.toBeUndefined();
    expect(redisUtils.releaseSubmitLock).toHaveBeenCalledTimes(1);
  });
});
