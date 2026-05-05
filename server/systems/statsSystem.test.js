// ============================================================================
// statsSystem.test.js — Coverage for the H5 personal-stats module.
// ============================================================================
// What this pins:
//   - recordGamePlayed/recordGameWon increment the right HASH fields and
//     bucket per-mode under `byMode.{mode}.played` / `byMode.{mode}.won`.
//   - longestChain uses set-if-greater semantics so a worse run doesn't
//     overwrite a personal best.
//   - recordPlay tracks favorite-connector via a separate hash with
//     HINCRBY per actor name.
//   - getStats reconstructs the nested shape from the flat HASH and
//     defaults missing fields so the client can render unconditionally.
// ============================================================================

const statsSystem = require('./statsSystem');

describe('statsSystem.recordGamePlayed', () => {
  let mockMulti, mockPubClient;

  beforeEach(() => {
    mockMulti = {
      hIncrBy: jest.fn().mockReturnThis(),
      hSet: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockPubClient = { multi: jest.fn(() => mockMulti) };
  });

  test('increments gamesPlayed AND byMode.{mode}.played in one pipeline', async () => {
    await statsSystem.recordGamePlayed(mockPubClient, 'p_test', 'classic');

    // Both increments must be in the SAME multi() so a Redis blip can't
    // leave the global counter incremented but the per-mode counter not
    // (or vice versa) — that would make the by-mode rows visually disagree
    // with the hero numbers.
    expect(mockPubClient.multi).toHaveBeenCalledTimes(1);

    const calls = mockMulti.hIncrBy.mock.calls;
    expect(calls).toContainEqual(['stats:p_test', 'gamesPlayed', 1]);
    expect(calls).toContainEqual(['stats:p_test', 'byMode.classic.played', 1]);

    // Retention refresh on every write — without this, an active player's
    // stats expire 90 days after their FIRST game instead of their last.
    expect(mockMulti.expire).toHaveBeenCalledWith(
      'stats:p_test',
      90 * 24 * 60 * 60
    );
  });

  test('coerces unknown modes to "classic" so byMode keys stay bounded', async () => {
    // Defensive: a typo or future mode that wasn't added to the
    // TRACKED_MODES list shouldn't create a brand-new HASH key — that would
    // leak unbounded keys per player over time.
    await statsSystem.recordGamePlayed(mockPubClient, 'p_test', 'totallyMadeUpMode');
    const calls = mockMulti.hIncrBy.mock.calls;
    // Should NOT contain the made-up mode.
    expect(calls.some(([, field]) => field === 'byMode.totallyMadeUpMode.played')).toBe(false);
    // Should fall back to classic.
    expect(calls).toContainEqual(['stats:p_test', 'byMode.classic.played', 1]);
  });

  test('no-ops when stableId is missing or empty', async () => {
    // The wiring layer might pass undefined during boot or for guest
    // sessions — we shouldn't write a `stats:` HASH with no key suffix.
    await statsSystem.recordGamePlayed(mockPubClient, '', 'classic');
    await statsSystem.recordGamePlayed(mockPubClient, null, 'classic');
    expect(mockPubClient.multi).not.toHaveBeenCalled();
  });

  test('swallows Redis errors so callers never see them', async () => {
    // Stats MUST NOT crash gameplay. If startGame's recordGamePlayed call
    // throws, the game-start broadcast wouldn't fire and players would sit
    // staring at a frozen lobby.
    mockMulti.exec.mockRejectedValueOnce(new Error('Redis is down'));
    await expect(
      statsSystem.recordGamePlayed(mockPubClient, 'p_test', 'classic')
    ).resolves.toBeUndefined();
  });
});

describe('statsSystem.recordGameWon — wins + longestChain', () => {
  let mockMulti, mockPubClient;

  beforeEach(() => {
    mockMulti = {
      hIncrBy: jest.fn().mockReturnThis(),
      hSet: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockPubClient = {
      multi: jest.fn(() => mockMulti),
      hGet: jest.fn().mockResolvedValue(null),
      hSet: jest.fn().mockResolvedValue(1),
    };
  });

  test('increments wins AND byMode.{mode}.won in one pipeline', async () => {
    await statsSystem.recordGameWon(mockPubClient, 'p_test', 'team', 5);
    const calls = mockMulti.hIncrBy.mock.calls;
    expect(calls).toContainEqual(['stats:p_test', 'wins', 1]);
    expect(calls).toContainEqual(['stats:p_test', 'byMode.team.won', 1]);
  });

  test('updates longestChain only when the new value strictly exceeds the prior one', async () => {
    // Existing personal best: 8. New chain: 5. Should NOT overwrite.
    mockPubClient.hGet.mockResolvedValueOnce('8'); // overall longestChain
    mockPubClient.hGet.mockResolvedValueOnce('8'); // per-mode longestChain
    await statsSystem.recordGameWon(mockPubClient, 'p_test', 'classic', 5);
    expect(mockPubClient.hSet).not.toHaveBeenCalled();
  });

  test('updates longestChain when the new value beats the prior one', async () => {
    // Existing PB: 5. New chain: 10. Should overwrite both global and per-mode.
    mockPubClient.hGet.mockResolvedValueOnce('5'); // overall
    mockPubClient.hGet.mockResolvedValueOnce('5'); // per-mode
    await statsSystem.recordGameWon(mockPubClient, 'p_test', 'classic', 10);
    // Two hSet calls: one for the global longestChain, one for byMode.classic.longestChain.
    expect(mockPubClient.hSet).toHaveBeenCalledWith('stats:p_test', 'longestChain', '10');
    expect(mockPubClient.hSet).toHaveBeenCalledWith('stats:p_test', 'byMode.classic.longestChain', '10');
  });

  test('skips longestChain update when chainLength is 0 or negative', async () => {
    // Defensive — a 0-length win shouldn't be recorded as a PB. Daily
    // failures-on-move-1 score 0 (the seed doesn't count); we don't want
    // to leak that 0 into the longestChain field if the player's existing
    // PB is positive.
    await statsSystem.recordGameWon(mockPubClient, 'p_test', 'daily', 0);
    expect(mockPubClient.hGet).not.toHaveBeenCalled();
    expect(mockPubClient.hSet).not.toHaveBeenCalled();
  });
});

describe('statsSystem.recordPlay — favorite connector tracking', () => {
  test('HINCRBYs each matched actor in a separate connectors hash', async () => {
    const statsMulti = {
      hIncrBy: jest.fn().mockReturnThis(),
      hSet: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const connMulti = {
      hIncrBy: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    let multiCallCount = 0;
    const mockPubClient = {
      multi: jest.fn(() => (++multiCallCount === 1 ? statsMulti : connMulti)),
    };

    await statsSystem.recordPlay(mockPubClient, 'p_test', ['Tom Hanks', 'Meg Ryan']);

    // First multi() pipelines totalPlays + lastUpdatedMs + expire on the main hash.
    expect(statsMulti.hIncrBy).toHaveBeenCalledWith('stats:p_test', 'totalPlays', 1);
    // Second multi() pipelines one HINCRBY per matched actor on the connectors hash.
    expect(connMulti.hIncrBy).toHaveBeenCalledWith('stats:connectors:p_test', 'Tom Hanks', 1);
    expect(connMulti.hIncrBy).toHaveBeenCalledWith('stats:connectors:p_test', 'Meg Ryan', 1);
  });

  test('skips the connectors hash entirely when matchedActors is empty', async () => {
    // First-move-in-chain plays have no connector. Without the skip, we'd
    // open a multi() pipeline that only contains an expire — pointless work.
    const statsMulti = {
      hIncrBy: jest.fn().mockReturnThis(),
      hSet: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const mockPubClient = { multi: jest.fn(() => statsMulti) };
    await statsSystem.recordPlay(mockPubClient, 'p_test', []);
    // Only one multi() call (the totalPlays one) — no connectors hash write.
    expect(mockPubClient.multi).toHaveBeenCalledTimes(1);
  });

  test('clamps each actor name to 64 chars', async () => {
    // Defensive — a freak name (or a future bug that passes raw text)
    // shouldn't write huge HASH keys. The stats system's correctness
    // doesn't depend on full names matching; this is defense-in-depth.
    const statsMulti = {
      hIncrBy: jest.fn().mockReturnThis(),
      hSet: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const connMulti = {
      hIncrBy: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    let i = 0;
    const mockPubClient = { multi: jest.fn(() => (++i === 1 ? statsMulti : connMulti)) };
    const longName = 'A'.repeat(200);
    await statsSystem.recordPlay(mockPubClient, 'p_test', [longName]);
    const call = connMulti.hIncrBy.mock.calls[0];
    expect(call[1].length).toBe(64);
  });
});

describe('statsSystem.getStats — reconstruction', () => {
  test('returns fully-defaulted shape when no record exists', async () => {
    const mockPubClient = {
      hGetAll: jest.fn().mockResolvedValue({}),
    };
    const stats = await statsSystem.getStats(mockPubClient, 'p_new');
    expect(stats.gamesPlayed).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.longestChain).toBe(0);
    expect(stats.totalPlays).toBe(0);
    // byMode object has all tracked modes pre-zeroed so the client UI
    // can iterate without null checks.
    statsSystem.TRACKED_MODES.forEach(m => {
      expect(stats.byMode[m]).toEqual({ played: 0, won: 0, longestChain: 0 });
    });
    expect(stats.favoriteConnector).toBe(null);
  });

  test('reconstructs nested byMode from dotted flat keys', async () => {
    const mockPubClient = {
      hGetAll: jest.fn()
        .mockResolvedValueOnce({
          gamesPlayed: '10',
          wins: '4',
          longestChain: '15',
          totalPlays: '60',
          'byMode.classic.played': '5',
          'byMode.classic.won': '2',
          'byMode.classic.longestChain': '12',
          'byMode.solo.played': '5',
          'byMode.solo.won': '2',
          'byMode.solo.longestChain': '15',
        })
        .mockResolvedValueOnce({
          'Tom Hanks': '7',
          'Brad Pitt': '3',
          'Scarlett Johansson': '12',
        }),
    };
    const stats = await statsSystem.getStats(mockPubClient, 'p_test');
    expect(stats.gamesPlayed).toBe(10);
    expect(stats.wins).toBe(4);
    expect(stats.longestChain).toBe(15);
    expect(stats.byMode.classic).toEqual({ played: 5, won: 2, longestChain: 12 });
    expect(stats.byMode.solo).toEqual({ played: 5, won: 2, longestChain: 15 });
    // Favorite connector should be the actor with the highest count.
    expect(stats.favoriteConnector).toEqual({ name: 'Scarlett Johansson', count: 12 });
  });

  test('ignores unknown flat keys (defensive against schema drift)', async () => {
    // A field added in a future deploy then rolled back leaves orphan
    // keys in existing players' records. The reconstructor must drop
    // them silently, not blow up.
    const mockPubClient = {
      hGetAll: jest.fn()
        .mockResolvedValueOnce({
          gamesPlayed: '3',
          'byMode.classic.played': '3',
          'someFutureField': '999',
          'byMode.classic.invalidSubfield': '42',
        })
        .mockResolvedValueOnce({}),
    };
    const stats = await statsSystem.getStats(mockPubClient, 'p_test');
    expect(stats.gamesPlayed).toBe(3);
    expect(stats.byMode.classic.played).toBe(3);
    // Orphan fields don't appear anywhere in the output.
    expect(stats.someFutureField).toBeUndefined();
    expect(stats.byMode.classic.invalidSubfield).toBeUndefined();
  });
});
