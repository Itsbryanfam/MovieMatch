// ============================================================================
// leaderboard-prune.test.js — Audit finding #10: the global `leaderboard`
// ZSET has no TTL. getLeaderboard only lazy-prunes the top-N slice it reads,
// so any winner who never re-enters the top-N and goes inactive >30d (their
// playerName:* key expires) stays in the ZSET forever. On a public
// deployment that's unbounded growth: one ZSET member per unique historical
// winner, indefinitely.
// ============================================================================
// pruneLeaderboard sweeps the WHOLE ZSET with ZSCAN and removes any member
// whose playerName:* lookup key is gone (the same "name expired ⇒ inactive
// 30d+" signal getLeaderboard already trusts for the top-N).
// ============================================================================

const redisUtils = require('./redisUtils');

describe('audit #10 — pruneLeaderboard sweeps the entire ZSET', () => {
  test('is exported', () => {
    expect(typeof redisUtils.pruneLeaderboard).toBe('function');
  });

  test('removes only members whose playerName key has expired', async () => {
    // Two ZSCAN pages. live1/live2 still have a name key; ghost1/ghost2 do
    // not (inactive >30d) and must be zRem'd. Members outside any top-N read
    // are exactly the ones the old lazy prune could never reach.
    const pages = [
      { cursor: 7, members: [ { value: 'live1', score: 5 }, { value: 'ghost1', score: 1 } ] },
      { cursor: 0, members: [ { value: 'ghost2', score: 1 }, { value: 'live2', score: 9 } ] },
    ];
    let call = 0;
    const removed = [];
    const pub = {
      zScan: jest.fn(async () => pages[call++]),
      mGet: jest.fn(async (keys) =>
        keys.map(k => (k === 'playerName:live1' || k === 'playerName:live2') ? 'Name' : null)
      ),
      zRem: jest.fn(async (_key, members) => { removed.push(...members); return members.length; }),
    };

    const count = await redisUtils.pruneLeaderboard(pub);

    expect(removed.sort()).toEqual(['ghost1', 'ghost2']);
    expect(count).toBe(2);
    // Must have walked the cursor to completion (both pages), not just page 1.
    expect(pub.zScan).toHaveBeenCalledTimes(2);
    // live members are never removed.
    expect(removed).not.toContain('live1');
    expect(removed).not.toContain('live2');
  });

  test('no zRem call when every member is still active', async () => {
    const pub = {
      zScan: jest.fn(async () => ({ cursor: 0, members: [{ value: 'a', score: 3 }] })),
      mGet: jest.fn(async () => ['Active']),
      zRem: jest.fn(),
    };
    const count = await redisUtils.pruneLeaderboard(pub);
    expect(count).toBe(0);
    expect(pub.zRem).not.toHaveBeenCalled();
  });

  test('handles an empty leaderboard without error', async () => {
    const pub = {
      zScan: jest.fn(async () => ({ cursor: 0, members: [] })),
      mGet: jest.fn(),
      zRem: jest.fn(),
    };
    await expect(redisUtils.pruneLeaderboard(pub)).resolves.toBe(0);
  });
});
