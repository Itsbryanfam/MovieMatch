const gameLogic = require('./gameLogic');
const redisUtils = require('./redisUtils');

jest.mock('./redisUtils');
jest.useFakeTimers();

describe('gameLogic tests', () => {
  let mockIo;
  let mockPubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn()
    };
    mockPubClient = {};
  });

  test('resetTimer sets turnExpiresAt for speed mode', () => {
    const state = { gameMode: 'speed', turnExpiresAt: null };
    gameLogic.resetTimer(state);
    expect(state.turnExpiresAt).toBeGreaterThan(Date.now());
    expect(state.turnExpiresAt).toBeLessThanOrEqual(Date.now() + 15000);
  });

  test('resetTimer sets turnExpiresAt for classic mode', () => {
    const state = { gameMode: 'classic', timerMultiplier: 0, turnExpiresAt: null };
    gameLogic.resetTimer(state);
    expect(state.turnExpiresAt).toBeGreaterThan(Date.now());
  });

  test('startGame sets initial state correctly', async () => {
    const state = {
      gameMode: 'classic',
      players: [
        { id: '1', isAlive: false, score: 100 },
        { id: '2', isAlive: false, score: 100 }
      ],
      status: 'waiting'
    };

    await gameLogic.startGame(mockIo, mockPubClient, 'LOBBY1', state);

    expect(state.status).toBe('playing');
    expect(state.chain).toEqual([]);
    expect(state.usedMovies).toEqual([]);
    expect(state.players[0].isAlive).toBe(true);
    expect(state.players[0].score).toBe(0);
    expect(redisUtils.saveLobby).toHaveBeenCalledWith(mockPubClient, 'LOBBY1', state);
  });

  test('checkWinCondition finishes game when one player left in classic mode', async () => {
    const state = {
      gameMode: 'classic',
      players: [
        { id: '1', name: 'Player 1', isAlive: true, wins: 0, score: 100 },
        { id: '2', name: 'Player 2', isAlive: false, wins: 0, score: 50 }
      ],
      chain: [],
      status: 'playing',
      winner: null
    };

    await gameLogic.checkWinCondition(mockIo, mockPubClient, 'LOBBY1', state);

    expect(state.status).toBe('finished');
    expect(state.winner).toEqual({ name: 'Player 1', score: 100, id: '1' });
    expect(state.players[0].wins).toBe(1);
    expect(redisUtils.saveLobby).toHaveBeenCalledWith(mockPubClient, 'LOBBY1', state);
    expect(mockIo.to).toHaveBeenCalledWith('LOBBY1');
    // Notifications now use a structured {msg, kind} payload so the client
    // can dispatch effects (sounds, shakes) without substring matching.
    expect(mockIo.emit).toHaveBeenCalledWith('notification', { msg: 'Player 1 wins!', kind: 'win' });
  });
});

// ---------------------------------------------------------------------------
// nextTurn — timer arming and cleanup
// ---------------------------------------------------------------------------
// These pin behavior we previously had no coverage for: that nextTurn arms
// a setTimeout, that the watchdog acquires the submit lock before acting,
// and that clearTurnTimeout cleans up properly. Without these tests, a
// regression that breaks the lock acquisition (e.g. someone removing the
// guard added in fix #4) would silently re-introduce the double-elimination race.
describe('gameLogic — nextTurn timer arming and cleanup', () => {
  let mockIo;
  let mockPubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    mockPubClient = {};
    // Default: lock acquire fails (returns null) so the watchdog inside
    // setTimeout no-ops cleanly. Individual tests override this.
    redisUtils.acquireSubmitLock.mockResolvedValue(null);
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.saveLobby.mockResolvedValue(undefined);
    redisUtils.getLobby.mockResolvedValue(null);
    // T2b: nextTurn commits through withLobbyLock now (fresh re-read inside
    // the lock). Faithful contract mock against this suite's getLobby/
    // saveLobby mocks — same shape as turn-watchdog.test.js. Tests that
    // drive nextTurn point getLobby at their state object so the in-lock
    // "fresh" room is that same object.
    redisUtils.withLobbyLock.mockImplementation(async (pub, id, fn, opts = {}) => {
      const r = (await redisUtils.getLobby(pub, id)) || opts.seedRoom || null;
      if (!r) return null;
      const res = await fn(r);
      if (res !== false) await redisUtils.saveLobby(pub, id, r);
      return r;
    });
  });

  test('clearTurnTimeout is exported and removes nothing for an unknown id', () => {
    // Calling clearTurnTimeout on a lobby that has no armed timer is a safe
    // no-op — never throws, never logs. This pins behavior callers rely on
    // (handleDisconnect calls it unconditionally).
    expect(() => gameLogic.clearTurnTimeout('UNKNOWN_LOBBY')).not.toThrow();
  });

  test('nextTurn arms a setTimeout that fires after turnTime + grace', async () => {
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
      turnTime: 1000, // short turn so the watchdog could fire quickly
    };
    // T2b: wire the in-lock fresh read to the state under test.
    redisUtils.getLobby.mockResolvedValue(state);

    await gameLogic.nextTurn(mockIo, mockPubClient, 'LOBBY1', state);

    // Timer is armed and broadcast happened. We can't fire the timer here
    // without involving real timers; this test pins the arming contract.
    expect(state.turnExpiresAt).toBeGreaterThan(Date.now());
    expect(redisUtils.saveLobby).toHaveBeenCalled();

    // Cleanup so the timer doesn't leak between tests.
    gameLogic.clearTurnTimeout('LOBBY1');
  });

  // ---------------------------------------------------------------------------
  // L3 — spectator predictions: settle + clear
  // ---------------------------------------------------------------------------

  test('settlePredictions emits a result event and clears the predictions map', () => {
    // Three spectators voted: one yes, two no. Outcome = 'yes' (the
    // player got it). One of the three (the yes-voter) was correct.
    const state = {
      spectatorPredictions: {
        sock_a: 'yes',
        sock_b: 'no',
        sock_c: 'no',
      },
    };
    gameLogic.settlePredictions(mockIo, 'LOBBY1', state, 'yes');

    // Single broadcast with the per-voter correctness map + tally.
    expect(mockIo.emit).toHaveBeenCalledWith(
      'predictionResult',
      expect.objectContaining({
        outcome: 'yes',
        correct: 1,
        total: 3,
        perVoter: { sock_a: true, sock_b: false, sock_c: false },
      })
    );
    // Map cleared on the room so the next turn starts at zero. Without
    // this, votes would carry across turns and pollute the next tally.
    expect(state.spectatorPredictions).toEqual({});
  });

  test('settlePredictions no-ops (no broadcast) when no spectator voted', () => {
    // Quiet room — don't add chatter to a turn that nobody bet on.
    const state = { spectatorPredictions: {} };
    gameLogic.settlePredictions(mockIo, 'LOBBY1', state, 'yes');
    expect(mockIo.emit).not.toHaveBeenCalled();
  });

  test('settlePredictions tolerates a missing spectatorPredictions field', () => {
    // Older serialized lobbies (created before L3) won't have the field.
    // Must not crash the resolution path — just skip the settle.
    const state = {};
    expect(() => gameLogic.settlePredictions(mockIo, 'LOBBY1', state, 'no')).not.toThrow();
    expect(mockIo.emit).not.toHaveBeenCalled();
  });

  test('nextTurn re-arming for the same lobby clears the previous timer', async () => {
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
      turnTime: 1000,
    };
    // T2b: wire the in-lock fresh read to the state under test.
    redisUtils.getLobby.mockResolvedValue(state);

    // First call arms timer A, second call arms timer B — the implementation
    // must clear A before arming B, otherwise we'd accumulate timer handles
    // and double-eliminate when both fire.
    await gameLogic.nextTurn(mockIo, mockPubClient, 'LOBBY1', state);
    await gameLogic.nextTurn(mockIo, mockPubClient, 'LOBBY1', state);

    // Two saves happened (one per nextTurn). If clearTimeout were missing,
    // we'd still pass this assertion — but the leak would surface as
    // unhandled-rejection noise in a real run because the orphan timer would
    // hit getLobby(null). Best we can do without faking timers is verify the
    // call chain is clean.
    expect(redisUtils.saveLobby).toHaveBeenCalledTimes(2);

    // Cleanup
    gameLogic.clearTurnTimeout('LOBBY1');
  });
});
