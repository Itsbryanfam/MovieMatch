const gameLogic = require('./gameLogic');
const { acquireSubmitLock, releaseSubmitLock, recordWin, getLeaderboard } = jest.requireActual('./redisUtils');
const { clampString } = require('./socketHandlers');
const redisUtils = require('./redisUtils');

jest.mock('./redisUtils');
redisUtils.incrementPlayerWins.mockReturnValue(Promise.resolve());
redisUtils.recordWin.mockReturnValue(Promise.resolve());

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
    expect(redisUtils.incrementPlayerWins).toHaveBeenCalledWith(mockPubClient, 'p_abc');
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

  test('incrementPlayerWins uses stableId when present', async () => {
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
    expect(redisUtils.incrementPlayerWins).toHaveBeenCalledWith(mockPubClient, 'p_stable1');
  });

  test('incrementPlayerWins falls back to socket id when stableId is missing', async () => {
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
    expect(redisUtils.incrementPlayerWins).toHaveBeenCalledWith(mockPubClient, 'sock1');
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
  test('acquireSubmitLock returns true when lock is available', async () => {
    const mockClient = { set: jest.fn().mockResolvedValue('OK') };
    const result = await acquireSubmitLock(mockClient, 'LOBBY1');
    expect(result).toBe(true);
    expect(mockClient.set).toHaveBeenCalledWith(
      'lock:submit:LOBBY1', '1', { NX: true, EX: 30 }
    );
  });

  test('acquireSubmitLock returns false when lock is already held', async () => {
    const mockClient = { set: jest.fn().mockResolvedValue(null) };
    const result = await acquireSubmitLock(mockClient, 'LOBBY1');
    expect(result).toBe(false);
  });

  test('releaseSubmitLock deletes the lock key', async () => {
    const mockClient = { del: jest.fn().mockResolvedValue(1) };
    await releaseSubmitLock(mockClient, 'LOBBY1');
    expect(mockClient.del).toHaveBeenCalledWith('lock:submit:LOBBY1');
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
  test('recordWin increments sorted set and stores player name', async () => {
    const mockClient = {
      zIncrBy: jest.fn().mockResolvedValue(3),
      set: jest.fn().mockResolvedValue('OK'),
    };
    await recordWin(mockClient, 'p_abc', 'Alice');
    expect(mockClient.zIncrBy).toHaveBeenCalledWith('leaderboard', 1, 'p_abc');
    expect(mockClient.set).toHaveBeenCalledWith('playerName:p_abc', 'Alice', { EX: 2592000 });
  });

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

  test('getLeaderboard shows Unknown Player for missing names', async () => {
    const mockClient = {
      zRangeWithScores: jest.fn().mockResolvedValue([
        { value: 'p_ghost', score: 2 },
      ]),
      mGet: jest.fn().mockResolvedValue([null]),
    };
    const result = await getLeaderboard(mockClient);
    expect(result).toEqual([{ name: 'Unknown Player', wins: 2 }]);
  });

  test('getLeaderboard returns empty array when no entries exist', async () => {
    const mockClient = {
      zRangeWithScores: jest.fn().mockResolvedValue([]),
    };
    const result = await getLeaderboard(mockClient);
    expect(result).toEqual([]);
  });
});
