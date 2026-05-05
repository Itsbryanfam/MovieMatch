// ============================================================================
// telemetry.test.js — Coverage for the H6 lightweight-telemetry module.
// ============================================================================
// What this pins:
//   - track() writes to the expected Redis sorted set with timestamp score
//     and JSON-blob member, registers the event type in the index, and
//     prunes anything older than retention in the same atomic pipeline.
//   - track() silently ignores unknown event types (the whitelist guard).
//   - track() sanitizes props — strings clamped, non-primitives dropped,
//     no PII shape allowed through.
//   - track() swallows Redis errors so a flaky Redis can't break gameplay.
//   - getSummary() aggregates counts using ZCOUNT and falls back to the
//     hardcoded whitelist when the index is empty (first-run scenario).
// ============================================================================

const telemetry = require('./telemetry');

describe('telemetry.track — basic writes', () => {
  let mockMulti;
  let mockPubClient;

  beforeEach(() => {
    // multi() returns a chainable that records the calls in order so the
    // tests can assert on the exact pipeline contents.
    mockMulti = {
      zAdd: jest.fn().mockReturnThis(),
      zRemRangeByScore: jest.fn().mockReturnThis(),
      sAdd: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockPubClient = {
      multi: jest.fn(() => mockMulti),
      sMembers: jest.fn().mockResolvedValue([]),
      zCount: jest.fn().mockResolvedValue(0),
      zRangeByScore: jest.fn().mockResolvedValue([]),
    };
  });

  test('writes to the expected key with score and member', async () => {
    const before = Date.now();
    await telemetry.track(mockPubClient, 'lobby_created', { mode: 'classic', isPublic: true });
    const after = Date.now();

    expect(mockMulti.zAdd).toHaveBeenCalledTimes(1);
    const [key, entry] = mockMulti.zAdd.mock.calls[0];
    expect(key).toBe('tel:event:lobby_created');
    expect(entry.score).toBeGreaterThanOrEqual(before);
    expect(entry.score).toBeLessThanOrEqual(after);

    // The member is the serialized event blob — decode it to assert its
    // shape matches what callers will read back.
    const blob = JSON.parse(entry.value);
    expect(blob.t).toBe(entry.score); // t === score so reads can decode time without splitting
    expect(typeof blob.n).toBe('string'); // nonce keeps members unique within the same ms
    expect(blob.mode).toBe('classic');
    expect(blob.isPublic).toBe(true);
  });

  test('issues a retention-prune with the same multi() pipeline', async () => {
    // Without the prune, the ZSET would grow unbounded and eventually
    // exhaust Redis memory — pinning the call here guards the cleanup.
    await telemetry.track(mockPubClient, 'game_started', { mode: 'speed' });
    expect(mockMulti.zRemRangeByScore).toHaveBeenCalledTimes(1);
    const [key, min, max] = mockMulti.zRemRangeByScore.mock.calls[0];
    expect(key).toBe('tel:event:game_started');
    expect(min).toBe(0);
    // max should be older than now by approximately TEL_RETENTION_DAYS
    const expectedMax = Date.now() - telemetry.TEL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    // Wide tolerance — allow for test-run timing drift up to a second.
    expect(Math.abs(max - expectedMax)).toBeLessThan(1500);
  });

  test('registers the event type in the discovery index', async () => {
    // The summary endpoint reads this set to enumerate event types — without
    // the registration, a brand-new event type would never appear in summary
    // output until someone updated the hardcoded whitelist.
    await telemetry.track(mockPubClient, 'submit_success', { mode: 'classic' });
    expect(mockMulti.sAdd).toHaveBeenCalledWith('tel:eventTypes', 'submit_success');
  });
});

describe('telemetry.track — guards', () => {
  let mockMulti, mockPubClient;
  beforeEach(() => {
    mockMulti = {
      zAdd: jest.fn().mockReturnThis(),
      zRemRangeByScore: jest.fn().mockReturnThis(),
      sAdd: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockPubClient = { multi: jest.fn(() => mockMulti) };
  });

  test('silently drops unknown event types (whitelist guard)', async () => {
    // Without this guard a typo at the call site or a malicious caller
    // could create unbounded ZSETs and bloat Redis. The whitelist is the
    // only way to keep the event-type set finite.
    await telemetry.track(mockPubClient, 'this_event_does_not_exist', { x: 1 });
    expect(mockMulti.zAdd).not.toHaveBeenCalled();
  });

  test('drops non-primitive prop values without crashing', async () => {
    // Sanitization is the line of defence against accidentally writing
    // huge objects (e.g. the full room state) into the telemetry stream.
    await telemetry.track(mockPubClient, 'lobby_created', {
      mode: 'classic',           // primitive string — kept
      isPublic: true,            // primitive boolean — kept
      bigBlob: { nested: 1 },    // object — dropped
      handler: () => {},          // function — dropped
      arr: [1, 2, 3],            // array — dropped
      huge: 'x'.repeat(500),      // long string — clamped to 100 chars
    });
    const [, entry] = mockMulti.zAdd.mock.calls[0];
    const blob = JSON.parse(entry.value);
    expect(blob.mode).toBe('classic');
    expect(blob.isPublic).toBe(true);
    expect(blob.bigBlob).toBeUndefined();
    expect(blob.handler).toBeUndefined();
    expect(blob.arr).toBeUndefined();
    expect(typeof blob.huge).toBe('string');
    expect(blob.huge.length).toBe(100);
  });

  test('swallows Redis errors so callers never see them', async () => {
    // Telemetry MUST NOT crash gameplay. If Redis hiccups during a track()
    // call mid-game, the player should never know — the event is just lost.
    mockMulti.exec.mockRejectedValueOnce(new Error('Redis is down'));
    await expect(
      telemetry.track(mockPubClient, 'lobby_created', { mode: 'classic' })
    ).resolves.toBeUndefined();
  });

  test('no-ops when pubClient is missing or event is empty', async () => {
    // Defensive — the wiring layer might pass undefined during boot. We
    // shouldn't throw; we should just not record the event.
    await expect(telemetry.track(null, 'lobby_created', {})).resolves.toBeUndefined();
    await expect(telemetry.track(mockPubClient, '', {})).resolves.toBeUndefined();
    expect(mockMulti.zAdd).not.toHaveBeenCalled();
  });
});

describe('telemetry.getSummary', () => {
  test('aggregates counts via ZCOUNT for each event type in the index', async () => {
    const mockPubClient = {
      sMembers: jest.fn().mockResolvedValue(['lobby_created', 'game_started']),
      zCount: jest.fn()
        .mockResolvedValueOnce(5)   // lobby_created has 5 events in window
        .mockResolvedValueOnce(3),  // game_started has 3 events
    };
    const summary = await telemetry.getSummary(mockPubClient, 7 * 24 * 60 * 60 * 1000);
    expect(summary).toEqual({ lobby_created: 5, game_started: 3 });
  });

  test('omits event types with zero count from the summary', async () => {
    // Keeping zero-count entries out keeps the response slim and the
    // /api/admin/stats UI uncluttered.
    const mockPubClient = {
      sMembers: jest.fn().mockResolvedValue(['lobby_created', 'game_started']),
      zCount: jest.fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(7),
    };
    const summary = await telemetry.getSummary(mockPubClient, 86400000);
    expect(summary).toEqual({ game_started: 7 });
    expect(summary.lobby_created).toBeUndefined();
  });

  test('falls back to the hardcoded whitelist when the index is empty', async () => {
    // First run after deploy, before any events have fired: the index set
    // doesn't exist yet, so we walk the hardcoded KNOWN_EVENTS list. Without
    // this fallback the dashboard would render empty even though the system
    // is wired — a confusing first impression.
    const mockPubClient = {
      sMembers: jest.fn().mockResolvedValue([]),
      zCount: jest.fn().mockResolvedValue(0),
    };
    await telemetry.getSummary(mockPubClient, 86400000);
    // We should have called zCount once per known event type.
    expect(mockPubClient.zCount).toHaveBeenCalledTimes(telemetry.KNOWN_EVENTS.size);
  });
});
