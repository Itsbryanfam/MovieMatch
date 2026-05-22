// server/systems/titlesSystem.test.js — Phase 6b. Pins sibling-key persistence,
// the earned-only write guard (defense at the persistence boundary), the
// 90-day TTL, and Redis-error tolerance (a cosmetic write must never throw).
const titlesSystem = require('./titlesSystem');

describe('titlesSystem.setEquippedTitle', () => {
  test('writes title:{stableId} with 90-day TTL when the title is earned', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const pub = { set };
    await titlesSystem.setEquippedTitle(pub, 'p1', 'chain_master', ['first_win', 'chain_master']);
    expect(set).toHaveBeenCalledWith('title:p1', 'chain_master', { EX: 90 * 24 * 60 * 60 });
  });

  test('no-ops when the title is NOT in the earned set', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    await titlesSystem.setEquippedTitle({ set }, 'p1', 'chain_master', ['first_win']);
    expect(set).not.toHaveBeenCalled();
  });

  test('no-ops on missing args and swallows Redis errors', async () => {
    const set = jest.fn().mockRejectedValue(new Error('down'));
    await expect(titlesSystem.setEquippedTitle({ set }, 'p1', 'chain_master', ['chain_master'])).resolves.toBeUndefined();
    await expect(titlesSystem.setEquippedTitle({ set }, '', 'x', ['x'])).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledTimes(1); // only the first (error) call reached set
  });
});

describe('titlesSystem.getEquippedTitle', () => {
  test('returns the stored id', async () => {
    const get = jest.fn().mockResolvedValue('chain_master');
    expect(await titlesSystem.getEquippedTitle({ get }, 'p1')).toBe('chain_master');
  });
  test('returns null for unset key and on error', async () => {
    expect(await titlesSystem.getEquippedTitle({ get: jest.fn().mockResolvedValue(null) }, 'p1')).toBeNull();
    expect(await titlesSystem.getEquippedTitle({ get: jest.fn().mockRejectedValue(new Error('x')) }, 'p1')).toBeNull();
    expect(await titlesSystem.getEquippedTitle({ get: jest.fn() }, '')).toBeNull();
  });
});
