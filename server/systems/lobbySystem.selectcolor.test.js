// ============================================================================
// lobbySystem.selectcolor.test.js — Phase 7.5.3 pick-your-own-colour mutex
// ============================================================================
// WHY: selectColor is the first non-host self-mutation that enforces a
// claim-only palette mutex. These pins are the server-authoritative truth
// (the client only offers free swatches; the server is the arbiter).
const lobbySystem = require('./lobbySystem');
const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');
const { SEAT_HUES } = require('../constants');
jest.mock('../redisUtils');

const HOST = 'sock-host';
const GUEST = 'sock-guest';
function lobby(over = {}) {
  return {
    id: 'L', status: 'waiting', gameMode: 'classic', isPublic: false,
    players: [
      { id: HOST, name: 'Host', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 'h' },
      { id: GUEST, name: 'Guest', isHost: false, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, stableId: 'g' },
    ],
    spectators: [], chain: [], usedMovies: [], ...over,
  };
}
let io, ctx, broadcast;
beforeEach(() => {
  jest.clearAllMocks();
  io = { to: jest.fn().mockReturnThis(), emit: jest.fn(), sockets: { sockets: new Map() } };
  ctx = { io, pubClient: {}, logger: { error: jest.fn() } };
  redisUtils.withLobbyLock.mockImplementation(async (_p, _id, fn) => {
    const r = global.__room; await fn(r); return r;
  });
  broadcast = jest.spyOn(gameLogic, 'broadcastState').mockImplementation(() => {});
});
afterEach(() => broadcast.mockRestore());

describe('constants.SEAT_HUES (server mirror of red-carpet.js:39)', () => {
  test('exact frozen literal — pinned both sides so an edit fails CI', () => {
    expect([...SEAT_HUES]).toEqual([350, 25, 45, 140, 188, 220, 270, 312]);
    expect(Object.isFrozen(SEAT_HUES)).toBe(true);
    expect(SEAT_HUES).toHaveLength(8);
  });
});

describe('selectColor — claim-only mutex', () => {
  test('claims a FREE in-palette hue + broadcasts', async () => {
    global.__room = lobby();
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players.find(p => p.id === GUEST).colorHue).toBe(SEAT_HUES[5]);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  test('declines a hue that is another player\'s EXPLICIT colorHue (no mutate, no broadcast)', async () => {
    global.__room = lobby();
    global.__room.players[0].colorHue = SEAT_HUES[5];
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players[1].colorHue).toBeUndefined();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('declines a hue that equals an UN-PICKED player\'s slot fallback', async () => {
    global.__room = lobby();
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[0] });
    expect(global.__room.players[1].colorHue).toBeUndefined();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('declines off-palette and non-integer hues', async () => {
    global.__room = lobby();
    for (const bad of [37, 999, -1, 1.5, '350', null, undefined, NaN]) {
      await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: bad });
    }
    expect(global.__room.players[1].colorHue).toBeUndefined();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('declines when status !== waiting', async () => {
    global.__room = lobby({ status: 'playing' });
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players[1].colorHue).toBeUndefined();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('declines a socket that is not a player in the room', async () => {
    global.__room = lobby();
    await lobbySystem.selectColor(ctx, { id: 'sock-stranger', emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players.some(p => p.colorHue !== undefined)).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('re-claiming after the holder leaves succeeds (hue freed on leave)', async () => {
    global.__room = lobby();
    global.__room.players[0].colorHue = SEAT_HUES[5];
    global.__room.players = [global.__room.players[1]];
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players[0].colorHue).toBe(SEAT_HUES[5]);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  test('a player may re-select their own current hue (own index excluded from taken)', async () => {
    global.__room = lobby();
    global.__room.players[1].colorHue = SEAT_HUES[5];
    await lobbySystem.selectColor(ctx, { id: GUEST, emit: jest.fn() }, { lobbyId: 'L', hue: SEAT_HUES[5] });
    expect(global.__room.players[1].colorHue).toBe(SEAT_HUES[5]);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });
});
