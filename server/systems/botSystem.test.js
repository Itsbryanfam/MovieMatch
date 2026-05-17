// ============================================================================
// botSystem.test.js — Phase 5a bot opponents
// ============================================================================
const botSystem = require('./botSystem');

describe('BOT_DIFFICULTIES invariants', () => {
  const profiles = botSystem.BOT_DIFFICULTIES;

  test('has exactly easy/normal/hard', () => {
    expect(Object.keys(profiles).sort()).toEqual(['easy', 'hard', 'normal']);
  });

  test('every profile has a strictly-beatable whiff (0 < whiff < 1)', () => {
    // WHY: this is THE "bot is never unbeatable" invariant from the spec.
    for (const [name, p] of Object.entries(profiles)) {
      expect(p.whiff).toBeGreaterThan(0);
      expect(p.whiff).toBeLessThan(1);
    }
  });

  test('whiff is monotonic easy > normal > hard', () => {
    expect(profiles.easy.whiff).toBeGreaterThan(profiles.normal.whiff);
    expect(profiles.normal.whiff).toBeGreaterThan(profiles.hard.whiff);
  });

  test('each profile has a valid delay window and retry cap', () => {
    for (const p of Object.values(profiles)) {
      expect(p.delayMinMs).toBeLessThan(p.delayMaxMs);
      expect(Number.isInteger(p.retryCap)).toBe(true);
      expect(p.retryCap).toBeGreaterThanOrEqual(1);
      expect(typeof p.popularityFloor).toBe('number');
    }
  });
});

describe('createBot', () => {
  test('produces a socketless player entry with stableId null', () => {
    const bot = botSystem.createBot([], 'hard');
    expect(bot).toMatchObject({
      isBot: true, isAlive: true, connected: true, score: 0, wins: 0,
      difficulty: 'hard', stableId: null, teamId: 0,
    });
    expect(bot.id).toMatch(/^bot_\d+$/);
    expect(typeof bot.name).toBe('string');
    expect(bot.name.length).toBeGreaterThan(0);
    expect(bot.isHost).toBeFalsy();
  });

  test('defaults invalid/missing difficulty to normal', () => {
    expect(botSystem.createBot([], 'banana').difficulty).toBe('normal');
    expect(botSystem.createBot([], undefined).difficulty).toBe('normal');
  });

  test('id and name are unique vs existing players/bots', () => {
    const existing = [
      { id: 'sock-1', name: 'Human', isBot: false },
      botSystem.createBot([], 'easy'), // bot_1
    ];
    const b2 = botSystem.createBot(existing, 'normal');
    expect(b2.id).toBe('bot_2');
    expect(existing.map(p => p.name)).not.toContain(b2.name);
  });

  test('teamId mirrors join order parity', () => {
    expect(botSystem.createBot([{ id: 'a' }], 'easy').teamId).toBe(1);
    expect(botSystem.createBot([{ id: 'a' }, { id: 'b' }], 'easy').teamId).toBe(0);
  });
});

describe('generateBotMove', () => {
  const profile = { whiff: 0.25, delayMinMs: 1, delayMaxMs: 2, popularityFloor: 10, retryCap: 2 };
  const baseDeps = (over = {}) => ({
    pubClient: {},
    headers: {},
    rng: () => 0.99, // > whiff → never a deliberate whiff unless overridden
    getOrFetchPersonCredits: jest.fn(),
    dailySeed: [{ id: 100, title: 'Seed', year: '2020', mediaType: 'movie' }],
    ...over,
  });

  test('returns null on a deliberate whiff (rng < whiff) without any TMDB call', async () => {
    const deps = baseDeps({ rng: () => 0.01 });
    const room = { chain: [{ movie: { cast: [{ id: 1, name: 'A' }] } }], usedMovies: [], previousSharedActors: [], hardcoreMode: false };
    expect(await botSystem.generateBotMove(room, profile, deps)).toBeNull();
    expect(deps.getOrFetchPersonCredits).not.toHaveBeenCalled();
  });

  test('first move (empty chain) picks from dailySeed', async () => {
    const deps = baseDeps();
    const room = { chain: [], usedMovies: [], previousSharedActors: [], hardcoreMode: false };
    expect(await botSystem.generateBotMove(room, profile, deps)).toEqual({ tmdbId: 100, mediaType: 'movie' });
  });

  test('empty dailySeed on first move → null', async () => {
    const deps = baseDeps({ dailySeed: [] });
    const room = { chain: [], usedMovies: [], previousSharedActors: [], hardcoreMode: false };
    expect(await botSystem.generateBotMove(room, profile, deps)).toBeNull();
  });

  test('picks an unused, popularity-floored film via a cast actor', async () => {
    const deps = baseDeps();
    deps.getOrFetchPersonCredits.mockResolvedValue({ movies: [
      { id: 7, title: 'TooObscure', year: '1990', popularity: 2 },   // below floor
      { id: 8, title: 'Used', year: '1991', popularity: 50 },         // used
      { id: 9, title: 'Good', year: '1992', popularity: 30 },         // ✓
    ]});
    const room = {
      chain: [{ movie: { id: 1, cast: [{ id: 42, name: 'Actor' }] } }],
      usedMovies: ['movie:1', 'movie:8'], previousSharedActors: [], hardcoreMode: false,
    };
    expect(await botSystem.generateBotMove(room, profile, deps)).toEqual({ tmdbId: 9, mediaType: 'movie' });
    expect(deps.getOrFetchPersonCredits).toHaveBeenCalledWith(deps.pubClient, 42, deps.headers);
  });

  test('hardcore: skips actors already in previousSharedActors', async () => {
    const deps = baseDeps();
    deps.getOrFetchPersonCredits.mockResolvedValue({ movies: [{ id: 9, title: 'G', year: '1', popularity: 99 }] });
    const room = {
      chain: [{ movie: { id: 1, cast: [{ id: 42, name: 'Used' }, { id: 43, name: 'Fresh' }] } }],
      usedMovies: ['movie:1'], previousSharedActors: [{ id: 42, name: 'Used' }], hardcoreMode: true,
    };
    await botSystem.generateBotMove(room, profile, deps);
    // Actor 42 is locked → only actor 43 is queried.
    expect(deps.getOrFetchPersonCredits).toHaveBeenCalledWith(deps.pubClient, 43, deps.headers);
    expect(deps.getOrFetchPersonCredits).not.toHaveBeenCalledWith(deps.pubClient, 42, deps.headers);
  });

  test('returns null when no actor yields a qualifying film within retryCap', async () => {
    const deps = baseDeps();
    deps.getOrFetchPersonCredits.mockResolvedValue({ movies: [{ id: 8, title: 'Used', year: '1', popularity: 99 }] });
    const room = {
      chain: [{ movie: { id: 1, cast: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }] } }],
      usedMovies: ['movie:1', 'movie:8'], previousSharedActors: [], hardcoreMode: false,
    };
    expect(await botSystem.generateBotMove(room, profile, deps)).toBeNull();
  });

  test('swallows a getOrFetchPersonCredits throw and tries the next actor', async () => {
    const deps = baseDeps();
    deps.getOrFetchPersonCredits
      .mockRejectedValueOnce(new Error('TMDB down'))
      .mockResolvedValueOnce({ movies: [{ id: 9, title: 'G', year: '1', popularity: 99 }] });
    const room = {
      chain: [{ movie: { id: 1, cast: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] } }],
      usedMovies: ['movie:1'], previousSharedActors: [], hardcoreMode: false,
    };
    expect(await botSystem.generateBotMove(room, profile, deps)).toEqual({ tmdbId: 9, mediaType: 'movie' });
  });
});
