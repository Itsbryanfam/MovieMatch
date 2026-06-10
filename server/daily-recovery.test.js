// ============================================================================
// daily-recovery.test.js — T4a audit fix (2026-06-09)
// ============================================================================
// WHY: startDailyChallenge bootstraps a daily lobby on a bespoke path (NOT via
// joinLobby), and pre-fix it saved the lobby WITHOUT registering it in the
// activeLobbies set OR arming the first-turn watchdog. Both boot-recovery
// (recoverActiveTurns) and the steady-state sweep (sweepMissingTurnWatchdogs)
// iterate the activeLobbies set, so an unregistered daily run is invisible to
// them — a deploy mid-run strands the attempt 'in_progress' with no server
// backstop, locking the player out until the next UTC day. These tests pin
// that a fresh daily claim now calls BOTH addToActiveLobbies and armTurnTimeout.
// ============================================================================

// Mock every collaborator so we drive startDailyChallenge in isolation and can
// assert the two recovery wiring calls fire (and survive future refactors of
// the surrounding seed-fetch logic).
jest.mock('../server/redisUtils');
jest.mock('../server/gameLogic');
jest.mock('../server/systems/dailySystem');
jest.mock('../server/telemetry');
jest.mock('../server/posterCache');

const redisUtils = require('../server/redisUtils');
const gameLogic = require('../server/gameLogic');
const dailySystem = require('../server/systems/dailySystem');
const lobbySystem = require('../server/systems/lobbySystem');

global.fetch = jest.fn();

function makeSocket() {
  // join is the socket.io room-join; emit captures client messages. The
  // returned object is the minimal surface startDailyChallenge touches.
  return { id: 'sock_1', join: jest.fn(), emit: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Deterministic puzzle metadata — values don't matter, only that the flow
  // reaches the save + recovery wiring.
  dailySystem.getTodayDate.mockReturnValue('2026-06-09');
  dailySystem.getPuzzleNumber.mockReturnValue(37);
  // Fresh claim (created:true) so we take the lobby-bootstrap branch, not the
  // already-played short-circuit.
  dailySystem.claimDailyAttempt.mockResolvedValue({
    created: true,
    attempt: { status: 'in_progress', startedAt: 123 },
    seed: { id: 999, mediaType: 'movie', title: 'Seed Movie', year: 2020 },
  });
  // Seed cast comes from the credits cache; details come from the fetch below.
  redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 1, name: 'Actor A' }] });
  redisUtils.addToActiveLobbies.mockResolvedValue(undefined);
  redisUtils.saveLobby.mockResolvedValue(undefined);
  redisUtils.setSocketLobby.mockResolvedValue(undefined);
  // The single /movie/{id} details call for the poster.
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ title: 'Seed Movie', poster_path: '/p.jpg', release_date: '2020-01-01' }),
  });
});

describe('T4a — daily lobbies are wired into recovery', () => {
  test('fresh daily claim registers the lobby in activeLobbies AND arms the first-turn watchdog', async () => {
    const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    const ctx = { io, pubClient: {}, TMDB_HEADERS: { Authorization: 'Bearer t' } };
    const socket = makeSocket();

    await lobbySystem.startDailyChallenge(ctx, socket, { name: 'P', stableId: 'stable_abc' });

    // The lobby must be saved first (precondition for the recovery wiring).
    expect(redisUtils.saveLobby).toHaveBeenCalledTimes(1);
    const savedLobbyId = redisUtils.saveLobby.mock.calls[0][1];

    // T4a: both recovery hooks fire, keyed to the same daily lobby id.
    expect(redisUtils.addToActiveLobbies).toHaveBeenCalledWith(ctx.pubClient, savedLobbyId);
    expect(gameLogic.armTurnTimeout).toHaveBeenCalledTimes(1);
    const armCall = gameLogic.armTurnTimeout.mock.calls[0];
    expect(armCall[0]).toBe(io);          // io
    expect(armCall[1]).toBe(ctx.pubClient); // pubClient
    expect(armCall[2]).toBe(savedLobbyId);  // lobby id
    expect(armCall[3]).toMatchObject({ gameMode: 'daily', status: 'playing' }); // the room
  });

  test('already-played claim short-circuits WITHOUT touching recovery wiring', async () => {
    // created:false → the early dailyAlreadyPlayed return; no lobby is built,
    // so neither recovery hook should fire (guards against over-eager wiring).
    dailySystem.claimDailyAttempt.mockResolvedValue({
      created: false,
      attempt: { status: 'done' },
      seed: { id: 999, mediaType: 'movie' },
    });
    dailySystem.getDailyLeaderboard.mockResolvedValue([]);

    const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    const ctx = { io, pubClient: {}, TMDB_HEADERS: {} };
    const socket = makeSocket();

    await lobbySystem.startDailyChallenge(ctx, socket, { name: 'P', stableId: 'stable_abc' });

    expect(redisUtils.addToActiveLobbies).not.toHaveBeenCalled();
    expect(gameLogic.armTurnTimeout).not.toHaveBeenCalled();
  });
});
