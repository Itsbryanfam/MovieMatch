const gameLogic = require('./gameLogic');
// recordWin was removed (superseded by recordPlayerWinAtomic) — only its
// surviving siblings are imported here.
const { acquireSubmitLock, releaseSubmitLock, getLeaderboard } = jest.requireActual('./redisUtils');
const { clampString } = require('./socketHandlers');
const redisUtils = require('./redisUtils');

jest.mock('./redisUtils');

// Default mock implementations — set in beforeEach (not at module load) so the
// setup is robust to someone later swapping `clearAllMocks` for `resetAllMocks`,
// which would wipe module-load mockReturnValues. clearAllMocks preserves
// implementations; resetAllMocks does not.
beforeEach(() => {
  redisUtils.incrementPlayerWins.mockResolvedValue(undefined);
  redisUtils.recordPlayerWinAtomic.mockResolvedValue(undefined);
  redisUtils.saveLobby.mockResolvedValue(undefined);
});

describe('clampString', () => {
  test('returns empty string for non-string input', () => {
    expect(clampString(undefined, 10)).toBe('');
    expect(clampString(null, 10)).toBe('');
    expect(clampString(123, 10)).toBe('');
  });

  test('returns string unchanged if under limit', () => {
    expect(clampString('hello', 10)).toBe('hello');
  });

  test('truncates string at limit', () => {
    expect(clampString('hello world', 5)).toBe('hello');
  });

  test('handles zero-length limit', () => {
    expect(clampString('hello', 0)).toBe('');
  });
});

describe('gameLogic — solo mode', () => {
  let mockIo;
  let mockPubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    mockPubClient = {};
  });

  test('startGame allows solo mode with 1 player', async () => {
    const state = {
      gameMode: 'solo',
      players: [{ id: '1', isAlive: false, score: 50 }],
      status: 'waiting'
    };
    await gameLogic.startGame(mockIo, mockPubClient, 'SOLO1', state);
    expect(state.status).toBe('playing');
    expect(state.players[0].isAlive).toBe(true);
    expect(state.players[0].score).toBe(0);
  });

  test('startGame rejects classic mode with 1 player', async () => {
    const state = {
      gameMode: 'classic',
      players: [{ id: '1', isAlive: false, score: 50 }],
      status: 'waiting'
    };
    await gameLogic.startGame(mockIo, mockPubClient, 'CL1', state);
    expect(state.status).toBe('waiting');
    expect(mockIo.emit).toHaveBeenCalledWith('error', 'Need at least 2 players!');
  });

  test('checkWinCondition ends solo game when player is eliminated', async () => {
    const state = {
      gameMode: 'solo',
      players: [{ id: '1', name: 'Solo Player', isAlive: false, connected: true }],
      chain: [{ movie: { title: 'Test' } }, { movie: { title: 'Test2' } }],
      status: 'playing',
      winner: null,
      turnExpiresAt: Date.now() + 30000
    };
    await gameLogic.checkWinCondition(mockIo, mockPubClient, 'SOLO1', state);
    expect(state.status).toBe('finished');
    expect(state.winner.isSolo).toBe(true);
    expect(state.winner.chainLength).toBe(2);
  });
});

describe('gameLogic — team mode', () => {
  let mockIo;
  let mockPubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    mockPubClient = {};
  });

  test('startGame rejects team mode if a team is empty', async () => {
    const state = {
      gameMode: 'team',
      players: [
        { id: '1', teamId: 0, isAlive: false, score: 0 },
        { id: '2', teamId: 0, isAlive: false, score: 0 }
      ],
      status: 'waiting'
    };
    await gameLogic.startGame(mockIo, mockPubClient, 'TEAM1', state);
    expect(state.status).toBe('waiting');
    expect(mockIo.emit).toHaveBeenCalledWith('error', 'Each team needs at least 1 player!');
  });

  test('checkWinCondition ends team game when one team is eliminated', async () => {
    const state = {
      gameMode: 'team',
      players: [
        { id: '1', name: 'A', teamId: 0, isAlive: true, wins: 0, score: 100, stableId: 'p_abc' },
        { id: '2', name: 'B', teamId: 1, isAlive: false, wins: 0, score: 50, stableId: 'p_def' }
      ],
      chain: [],
      status: 'playing',
      winner: null,
      turnExpiresAt: Date.now() + 30000
    };
    await gameLogic.checkWinCondition(mockIo, mockPubClient, 'TEAM1', state);
    expect(state.status).toBe('finished');
    expect(state.winner.isTeamWin).toBe(true);
    expect(state.winner.teamId).toBe(0);
    expect(state.players[0].wins).toBe(1);
    // Win counts now flow through recordPlayerWinAtomic, which writes the
    // per-player count, leaderboard ZSET, and name in one Redis transaction.
    expect(redisUtils.recordPlayerWinAtomic).toHaveBeenCalledWith(mockPubClient, 'p_abc', 'A');
  });
});

describe('gameLogic — stableId fallback', () => {
  let mockIo;
  let mockPubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    mockPubClient = {};
  });

  test('recordPlayerWinAtomic uses stableId when present', async () => {
    const state = {
      gameMode: 'classic',
      players: [
        { id: 'sock1', name: 'Winner', isAlive: true, wins: 0, score: 200, stableId: 'p_stable1' },
        { id: 'sock2', name: 'Loser', isAlive: false, wins: 0, score: 50, stableId: 'p_stable2' }
      ],
      chain: [],
      status: 'playing',
      winner: null,
      turnExpiresAt: Date.now() + 30000
    };
    await gameLogic.checkWinCondition(mockIo, mockPubClient, 'LOBBY1', state);
    // stableId is canonical — the leaderboard and per-player count are keyed by it
    // so wins persist across socket reconnects.
    expect(redisUtils.recordPlayerWinAtomic).toHaveBeenCalledWith(mockPubClient, 'p_stable1', 'Winner');
  });

  test('recordPlayerWinAtomic falls back to socket id when stableId is missing', async () => {
    const state = {
      gameMode: 'classic',
      players: [
        { id: 'sock1', name: 'Winner', isAlive: true, wins: 0, score: 200 },
        { id: 'sock2', name: 'Loser', isAlive: false, wins: 0, score: 50 }
      ],
      chain: [],
      status: 'playing',
      winner: null,
      turnExpiresAt: Date.now() + 30000
    };
    await gameLogic.checkWinCondition(mockIo, mockPubClient, 'LOBBY1', state);
    // Without stableId we use socket.id — wins won't persist across reconnects,
    // but the gameLogic shouldn't crash on legacy/test states that lack one.
    expect(redisUtils.recordPlayerWinAtomic).toHaveBeenCalledWith(mockPubClient, 'sock1', 'Winner');
  });
});

describe('gameLogic — all players eliminated', () => {
  let mockIo;
  let mockPubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    mockPubClient = {};
  });

  test('checkWinCondition ends classic game with no winner when all eliminated', async () => {
    const state = {
      gameMode: 'classic',
      players: [
        { id: '1', name: 'A', isAlive: false, wins: 0, score: 0 },
        { id: '2', name: 'B', isAlive: false, wins: 0, score: 0 }
      ],
      chain: [],
      status: 'playing',
      winner: null,
      turnExpiresAt: Date.now() + 30000
    };
    await gameLogic.checkWinCondition(mockIo, mockPubClient, 'LOBBY1', state);
    expect(state.status).toBe('finished');
    expect(state.winner).toBe(null);
  });
});

describe('submitLock functions', () => {
  test('acquireSubmitLock returns a unique token when lock is available', async () => {
    // The mock always returns 'OK' so both acquires "succeed" — we're asserting
    // the contract that each acquire generates its OWN token, not the same one.
    // That uniqueness is what makes the Lua compare-and-delete release safe.
    const mockClient = { set: jest.fn().mockResolvedValue('OK') };
    const t1 = await acquireSubmitLock(mockClient, 'LOBBY1');
    const t2 = await acquireSubmitLock(mockClient, 'LOBBY1');
    expect(t1).toBeTruthy();
    expect(t2).toBeTruthy();
    expect(t1).not.toBe(t2);
    // Verify the SET call shape — NX EX is the canonical Redis-lock acquire.
    expect(mockClient.set).toHaveBeenCalledWith(
      'lock:submit:LOBBY1', expect.any(String), { NX: true, EX: 30 }
    );
  });

  test('acquireSubmitLock returns null when lock is already held', async () => {
    // Redis returns null for SET NX when the key already exists — our wrapper
    // surfaces that as a falsy return so callers can `if (!token) return`.
    const mockClient = { set: jest.fn().mockResolvedValue(null) };
    const result = await acquireSubmitLock(mockClient, 'LOBBY1');
    expect(result).toBeNull();
  });

  test('releaseSubmitLock invokes the Lua compare-and-delete script with the token', async () => {
    // The Lua script does atomic "if value matches token, delete". We can't
    // exercise the actual delete here without real Redis, but we CAN verify
    // the token is forwarded — that's the difference between this fix and
    // the old unconditional del.
    const mockClient = { eval: jest.fn().mockResolvedValue(1) };
    await releaseSubmitLock(mockClient, 'LOBBY1', 'tok_abc123');
    expect(mockClient.eval).toHaveBeenCalledWith(
      expect.any(String),
      { keys: ['lock:submit:LOBBY1'], arguments: ['tok_abc123'] }
    );
  });

  test('releaseSubmitLock no-ops when token is missing', async () => {
    // Caller may pass null after a failed acquire. The release MUST do nothing
    // in that case — otherwise we'd run an unnecessary Lua eval against Redis.
    const mockClient = { eval: jest.fn() };
    await releaseSubmitLock(mockClient, 'LOBBY1', null);
    expect(mockClient.eval).not.toHaveBeenCalled();
  });
});

describe('promoteSpectators', () => {
  test('promotes connected spectators up to 8-player cap', () => {
    const state = {
      players: [
        { id: 'p1', name: 'Player1', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 's1' }
      ],
      spectators: [
        { id: 's1', name: 'Spec1', stableId: 'ss1', connected: true, wins: 3 },
        { id: 's2', name: 'Spec2', stableId: 'ss2', connected: true, wins: 0 },
        { id: 's3', name: 'Spec3', stableId: 'ss3', connected: false, wins: 0 }
      ]
    };

    gameLogic.promoteSpectators(state);

    expect(state.players).toHaveLength(3);
    expect(state.players[1].name).toBe('Spec1');
    expect(state.players[1].wins).toBe(3);
    expect(state.players[1].isAlive).toBe(true);
    expect(state.players[1].isHost).toBe(false);
    expect(state.players[2].name).toBe('Spec2');
    // Disconnected spectator should NOT be promoted
    expect(state.spectators).toHaveLength(0);
  });

  test('does not promote beyond 8 players', () => {
    const state = {
      players: Array.from({ length: 7 }, (_, i) => ({
        id: `p${i}`, name: `Player${i}`, isHost: i === 0, isAlive: true,
        connected: true, score: 0, wins: 0, teamId: i % 2, stableId: `sp${i}`
      })),
      spectators: [
        { id: 's1', name: 'Spec1', stableId: 'ss1', connected: true, wins: 0 },
        { id: 's2', name: 'Spec2', stableId: 'ss2', connected: true, wins: 0 },
        { id: 's3', name: 'Spec3', stableId: 'ss3', connected: true, wins: 0 }
      ]
    };

    gameLogic.promoteSpectators(state);

    expect(state.players).toHaveLength(8);
    expect(state.spectators).toHaveLength(2);
    expect(state.spectators[0].name).toBe('Spec2');
  });

  test('does nothing when no spectators exist', () => {
    const state = { players: [{ id: 'p1' }], spectators: [] };
    gameLogic.promoteSpectators(state);
    expect(state.players).toHaveLength(1);
  });

  test('does nothing when spectators is undefined', () => {
    const state = { players: [{ id: 'p1' }] };
    gameLogic.promoteSpectators(state);
    expect(state.players).toHaveLength(1);
  });
});

describe('leaderboard functions', () => {
  // Note: a previous `recordWin` test was removed when that function was
  // deleted in favor of `recordPlayerWinAtomic` (covered elsewhere). The
  // atomic version is the only production-callable leaderboard write path.

  test('getLeaderboard returns top players with names', async () => {
    const mockClient = {
      zRangeWithScores: jest.fn().mockResolvedValue([
        { value: 'p_abc', score: 5 },
        { value: 'p_def', score: 3 },
      ]),
      mGet: jest.fn().mockResolvedValue(['Alice', 'Bob']),
    };
    const result = await getLeaderboard(mockClient, 20);
    expect(result).toEqual([
      { name: 'Alice', wins: 5 },
      { name: 'Bob', wins: 3 },
    ]);
    expect(mockClient.zRangeWithScores).toHaveBeenCalledWith('leaderboard', 0, 19, { REV: true });
  });

  test('getLeaderboard prunes stale entries whose names have expired', async () => {
    // Lazy prune: when a playerName key has TTL'd out, the corresponding ZSET
    // entry is removed and excluded from the response. Replaces the old
    // "Unknown Player" placeholder behavior — those rows were just visual noise.
    const mockClient = {
      zRangeWithScores: jest.fn().mockResolvedValue([
        { value: 'p_ghost', score: 2 },
      ]),
      mGet: jest.fn().mockResolvedValue([null]),
      zRem: jest.fn().mockResolvedValue(1),
    };
    const result = await getLeaderboard(mockClient);
    expect(result).toEqual([]);
    // Verify the prune actually fires — without this assertion a regression
    // that drops the zRem call would still pass the empty-result check.
    expect(mockClient.zRem).toHaveBeenCalledWith('leaderboard', ['p_ghost']);
  });

  test('getLeaderboard returns empty array when no entries exist', async () => {
    const mockClient = {
      zRangeWithScores: jest.fn().mockResolvedValue([]),
    };
    const result = await getLeaderboard(mockClient);
    expect(result).toEqual([]);
  });
});
