// ============================================================================
// turn-watchdog.test.js — Audit finding #2: the server-side turn watchdog
// must be authoritative.
// ============================================================================
// Two real soft-lock holes this pins:
//   (a) startGame only reset the timer + broadcast; it never armed the
//       server watchdog. The FIRST turn of every game had no server
//       enforcement — a client that suppressed forceNextTurn stalled the
//       whole table forever.
//   (b) handleDisconnect cleared the active turn watchdog for ANY
//       disconnecting player, including one whose turn it ISN'T. A
//       bystander dropping their connection wiped the current player's
//       only server-side timer.
// Plus the reconnect corollary: when the current player disconnects we
// (correctly) clear the watchdog so it can't double-eliminate with the
// 15s grace timer — but on their reconnect within grace, the watchdog
// must be re-armed or their turn is again unenforced.
// ============================================================================

const gameLogic = require('./gameLogic');
const lobbySystem = require('./systems/lobbySystem');
const redisUtils = require('./redisUtils');

jest.mock('./redisUtils');
jest.useFakeTimers();

function fakeIo() {
  // io.to(id).emit(...) and io.sockets.sockets.get(...) are the only
  // surfaces handleDisconnect / broadcastState touch.
  return {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    sockets: { sockets: new Map() },
  };
}

function playingRoom(currentTurnIndex = 0) {
  return {
    id: 'LOBBY1',
    gameMode: 'classic',
    status: 'playing',
    players: [
      { id: 'sock-cur', name: 'Current', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's_cur' },
      { id: 'sock-by', name: 'Bystander', isHost: false, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, stableId: 's_by' },
    ],
    spectators: [],
    chain: [], usedMovies: [], hardcoreMode: false, previousSharedActors: [],
    allowTvShows: false, isPublic: false, timerMultiplier: 0,
    turnExpiresAt: Date.now() + 60000, isValidating: false, currentTurnIndex,
  };
}

describe('audit #2 — turn watchdog authority', () => {
  let io, pubClient, ctx;

  beforeEach(() => {
    jest.clearAllMocks();
    io = fakeIo();
    pubClient = {};
    ctx = { io, pubClient, logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } };
    redisUtils.acquireSubmitLock.mockResolvedValue(null);
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.saveLobby.mockResolvedValue(undefined);
    redisUtils.getSocketLobby.mockResolvedValue('LOBBY1');
    redisUtils.deleteSocketLobby.mockResolvedValue(undefined);
  });

  afterEach(() => {
    gameLogic.clearTurnTimeout('LOBBY1');
  });

  // (a) The first-turn hole.
  test('startGame arms the server turn watchdog', async () => {
    const state = playingRoom(0);
    state.status = 'waiting';

    expect(gameLogic.hasActiveTurnTimeout('LOBBY1')).toBe(false);
    await gameLogic.startGame(io, pubClient, 'LOBBY1', state);

    expect(state.status).toBe('playing');
    // Without a server watchdog the first turn can only be advanced by the
    // active client's forceNextTurn — exactly the soft-lock finding #2.
    expect(gameLogic.hasActiveTurnTimeout('LOBBY1')).toBe(true);
  });

  // (b) Bystander disconnect must NOT disarm the active player's watchdog.
  test('a non-current player disconnect leaves the active watchdog armed', async () => {
    const room = playingRoom(0); // 'sock-cur' holds the turn
    gameLogic.armTurnTimeout(io, pubClient, 'LOBBY1', room);
    expect(gameLogic.hasActiveTurnTimeout('LOBBY1')).toBe(true);

    redisUtils.getLobby.mockResolvedValue(room);
    // 'sock-by' is NOT the current turn holder.
    await lobbySystem.handleDisconnect(ctx, 'sock-by');

    expect(gameLogic.hasActiveTurnTimeout('LOBBY1')).toBe(true);
  });

  // (b corollary) Current player's disconnect SHOULD clear the watchdog
  // (the 15s grace timer owns elimination from here; a live watchdog would
  // double-eliminate).
  test('the current player disconnecting clears the watchdog (grace owns it)', async () => {
    const room = playingRoom(0);
    gameLogic.armTurnTimeout(io, pubClient, 'LOBBY1', room);
    redisUtils.getLobby.mockResolvedValue(room);

    await lobbySystem.handleDisconnect(ctx, 'sock-cur');

    expect(gameLogic.hasActiveTurnTimeout('LOBBY1')).toBe(false);
  });

  // (b corollary) …and on reconnect within grace the watchdog must come back
  // or the reconnected player's turn is unenforced again.
  test('current player reconnecting within grace re-arms the watchdog', async () => {
    const room = playingRoom(0);
    redisUtils.getLobby.mockResolvedValue(room);

    await lobbySystem.handleDisconnect(ctx, 'sock-cur');
    expect(gameLogic.hasActiveTurnTimeout('LOBBY1')).toBe(false);

    // Mark the player disconnected (handleDisconnect set connected=false on
    // the same room object) and rejoin from a new socket.
    const socket = { id: 'sock-cur-2', join: jest.fn(), emit: jest.fn() };
    await lobbySystem.rejoinLobby(ctx, socket, {
      lobbyId: 'LOBBY1', playerId: 'sock-cur', stableId: 's_cur',
    });

    expect(gameLogic.hasActiveTurnTimeout('LOBBY1')).toBe(true);
  });
});

// Audit finding #6: turn watchdogs live in an in-process Map, so a process
// restart (deploy, crash, scale event) loses every armed watchdog while the
// games themselves persist in Redis. recoverActiveTurns is the boot sweep:
// it re-arms a server watchdog for every still-playing lobby so a restart
// can't leave an in-flight game with no enforcement. (Bounds the practical
// risk; the README's horizontal-scaling claim is scoped to match.)
describe('audit #6 — recoverActiveTurns re-arms watchdogs after restart', () => {
  let io, pubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    io = fakeIo();
    pubClient = {};
    redisUtils.acquireSubmitLock.mockResolvedValue(null);
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
    redisUtils.saveLobby.mockResolvedValue(undefined);
  });

  afterEach(() => {
    gameLogic.clearTurnTimeout('PLAY1');
    gameLogic.clearTurnTimeout('PLAY2');
    gameLogic.clearTurnTimeout('WAIT1');
  });

  test('arms a watchdog for every playing lobby and skips non-playing ones', async () => {
    redisUtils.getAllLobbies.mockResolvedValue([
      { ...playingRoom(0), id: 'PLAY1' },
      { ...playingRoom(1), id: 'PLAY2' },
      { ...playingRoom(0), id: 'WAIT1', status: 'waiting' },
    ]);

    expect(gameLogic.hasActiveTurnTimeout('PLAY1')).toBe(false);

    const recovered = await gameLogic.recoverActiveTurns(io, pubClient);

    expect(gameLogic.hasActiveTurnTimeout('PLAY1')).toBe(true);
    expect(gameLogic.hasActiveTurnTimeout('PLAY2')).toBe(true);
    // A waiting lobby has no active turn — must NOT get a watchdog.
    expect(gameLogic.hasActiveTurnTimeout('WAIT1')).toBe(false);
    expect(recovered).toBe(2);
  });

  test('is resilient — a getAllLobbies failure does not throw at boot', async () => {
    redisUtils.getAllLobbies.mockRejectedValue(new Error('redis down at boot'));
    await expect(gameLogic.recoverActiveTurns(io, pubClient)).resolves.toBe(0);
  });
});

// T1 audit (2026-06-09), fix T1a: the watchdog callback's FIRST await — the
// submit-lock acquire — sat OUTSIDE its try block. node-redis v4 rejects every
// in-flight command when the socket drops, so a Redis flap landing at exactly
// watchdog-fire time became an unhandled rejection; with no process-level
// handler that kills the process and drops every live game at once. These
// tests capture the armed callback and invoke it directly: awaiting it is the
// only deterministic way to observe whether its promise rejects — production
// setTimeout discards the promise, which is precisely WHY a rejection escapes
// as "unhandled" there instead of surfacing anywhere recoverable.
describe('audit T1a — watchdog Redis flap cannot escape as an unhandled rejection', () => {
  let io, pubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    io = fakeIo();
    pubClient = {};
    redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    gameLogic.clearTurnTimeout('LOBBY1');
  });

  // Spy on (fake-timer) setTimeout around the arm call so the test holds the
  // exact async callback the watchdog registered. First recorded call is the
  // watchdog: armTurnTimeout registers its timer before the bot-move hook
  // could schedule anything (and no player here is a bot anyway).
  function armAndCaptureCallback(room) {
    const spy = jest.spyOn(global, 'setTimeout');
    gameLogic.armTurnTimeout(io, pubClient, 'LOBBY1', room);
    const cb = spy.mock.calls[0][0];
    spy.mockRestore();
    return cb;
  }

  test('acquireSubmitLock rejecting is contained: callback resolves and the map entry is cleaned up', async () => {
    // The node-redis v4 failure mode: in-flight command rejected on socket drop.
    redisUtils.acquireSubmitLock.mockRejectedValue(new Error('Socket closed unexpectedly'));
    const cb = armAndCaptureCallback(playingRoom(0));
    expect(gameLogic.hasActiveTurnTimeout('LOBBY1')).toBe(true);

    // Pre-T1a this REJECTS (the unhandled rejection that crashed prod);
    // post-fix the rejection is caught + logged and the callback resolves.
    await expect(cb()).resolves.toBeUndefined();

    // The in-process map entry must not leak when the fire path errors —
    // a stale entry would block hasActiveTurnTimeout-based re-arming forever.
    expect(gameLogic.hasActiveTurnTimeout('LOBBY1')).toBe(false);
    // Nothing was acquired, so nothing may be released (a release call here
    // would be a second pointless round-trip into the very flap we survived).
    expect(redisUtils.releaseSubmitLock).not.toHaveBeenCalled();
  });

  // Behavior-preservation pin for the restructure: the pre-existing no-lock
  // semantics (a submit holds the lock → watchdog stands down, cleans its map
  // entry, releases NOTHING) must survive the acquire moving inside the try.
  test('no lock acquired (submit in flight) → map cleanup only, release never called', async () => {
    redisUtils.acquireSubmitLock.mockResolvedValue(null);
    const cb = armAndCaptureCallback(playingRoom(0));

    await expect(cb()).resolves.toBeUndefined();

    expect(gameLogic.hasActiveTurnTimeout('LOBBY1')).toBe(false);
    expect(redisUtils.releaseSubmitLock).not.toHaveBeenCalled();
    // It never read the room either — without the lock any state it saw
    // could be mid-mutation by the lock holder.
    expect(redisUtils.getLobby).not.toHaveBeenCalled();
  });
});
