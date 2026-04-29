const gameLogic = require('./gameLogic');
const { acquireSubmitLock, releaseSubmitLock } = jest.requireActual('./redisUtils');
const { clampString } = require('./socketHandlers');
const redisUtils = require('./redisUtils');

jest.mock('./redisUtils');
redisUtils.incrementPlayerWins.mockReturnValue(Promise.resolve());

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
