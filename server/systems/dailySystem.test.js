// ============================================================================
// dailySystem.test.js — Coverage for the H2 Daily Challenge core logic.
// ============================================================================
// What this pins:
//   - getTodayDate returns a UTC YYYY-MM-DD string (matters for global
//     time-zone-consistent puzzles — local-time would split players).
//   - getPuzzleNumber is monotonic from LAUNCH_DATE_UTC and starts at 1.
//   - pickDailyMovie is deterministic per date and stable across runs.
//   - claimDailyAttempt is NX-locked: the second concurrent claim returns
//     the existing attempt rather than overwriting it.
//   - finalizeDailyAttempt records both the player record and the
//     leaderboard ZSET in one atomic pipeline.
// ============================================================================

const dailySystem = require('./dailySystem');

describe('dailySystem — date helpers', () => {
  test('getTodayDate returns a YYYY-MM-DD string in UTC', () => {
    const fixed = new Date('2026-05-04T23:30:00Z');
    expect(dailySystem.getTodayDate(fixed)).toBe('2026-05-04');
  });

  test('getTodayDate ignores the local time zone', () => {
    // Same UTC instant, but a Date object — getTodayDate must NOT shift to
    // local. If it did, players in UTC+12 would see "tomorrow's" puzzle
    // hours before a player in UTC-8.
    const utcMidnight = new Date(Date.UTC(2026, 4, 4, 0, 0, 0));
    expect(dailySystem.getTodayDate(utcMidnight)).toBe('2026-05-04');
  });

  test('getPuzzleNumber starts at 1 on the launch date', () => {
    // The launch date is intentionally hardcoded — pin it here so a careless
    // edit to LAUNCH_DATE_UTC trips this test before retroactively
    // renumbering everyone's daily history.
    expect(dailySystem.getPuzzleNumber('2026-05-04')).toBe(1);
  });

  test('getPuzzleNumber increments by one per UTC day', () => {
    expect(dailySystem.getPuzzleNumber('2026-05-05')).toBe(2);
    expect(dailySystem.getPuzzleNumber('2026-05-14')).toBe(11);
  });

  test('getPuzzleNumber clamps to 1 for dates before the launch date', () => {
    // Defensive: someone hand-passing an old date shouldn't get a negative
    // or zero puzzle number (which would render as "Daily #0" or "#-3" in
    // the share card text).
    expect(dailySystem.getPuzzleNumber('2026-05-03')).toBe(1);
    expect(dailySystem.getPuzzleNumber('2020-01-01')).toBe(1);
  });
});

describe('dailySystem.pickDailyMovie', () => {
  test('is deterministic — same date returns the same movie object', () => {
    const a = dailySystem.pickDailyMovie('2026-05-04');
    const b = dailySystem.pickDailyMovie('2026-05-04');
    expect(a.id).toBe(b.id);
    expect(a.title).toBe(b.title);
  });

  test('different dates produce (almost certainly) different movies', () => {
    // Spot check across a week — the FNV-1a hash distribution should map
    // most consecutive dates to different list indices. Allow up to two
    // collisions across the week (the curated list is ~50 entries; with
    // small N some adjacent dates can hash-collide). If this fails
    // catastrophically (everyone same), the seed function is broken.
    const dates = ['2026-05-04','2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10'];
    const ids = dates.map(d => dailySystem.pickDailyMovie(d).id);
    const distinctCount = new Set(ids).size;
    expect(distinctCount).toBeGreaterThanOrEqual(dates.length - 2);
  });

  test('returned object includes the date for downstream traceability', () => {
    const seed = dailySystem.pickDailyMovie('2026-05-04');
    expect(seed.date).toBe('2026-05-04');
    expect(typeof seed.id).toBe('number');
    expect(typeof seed.mediaType).toBe('string');
  });
});

describe('dailySystem.claimDailyAttempt — NX semantics', () => {
  let mockPubClient;

  beforeEach(() => {
    mockPubClient = {
      // First call to set() — NX wins (returns 'OK'); subsequent calls
      // simulate the slot being taken (returns null).
      set: jest.fn(),
      get: jest.fn(),
    };
  });

  test('first claim wins — returns created:true with a fresh attempt', async () => {
    mockPubClient.set.mockResolvedValueOnce('OK');
    const result = await dailySystem.claimDailyAttempt(
      mockPubClient, 'p_test', 'Tester', '2026-05-04'
    );
    expect(result.created).toBe(true);
    expect(result.attempt.status).toBe('in_progress');
    expect(result.attempt.chainLength).toBe(0);
    expect(result.attempt.stableId).toBe('p_test');
    expect(result.attempt.name).toBe('Tester');
    // The set() call must use NX so a concurrent claim from the same player
    // can't overwrite their in-progress attempt with a fresh-zero one.
    const setCall = mockPubClient.set.mock.calls[0];
    expect(setCall[2]).toMatchObject({ NX: true });
  });

  test('second claim returns created:false with the existing attempt', async () => {
    // First set() returns null = key already exists. Then get() pulls the
    // canonical attempt for the caller to see their prior result.
    mockPubClient.set.mockResolvedValueOnce(null);
    const existing = {
      date: '2026-05-04',
      stableId: 'p_test',
      name: 'Tester',
      status: 'done',
      chainLength: 7,
      startedAt: 1700000000000,
      endedAt: 1700000300000,
      seedMovieId: 27205,
    };
    mockPubClient.get.mockResolvedValueOnce(JSON.stringify(existing));

    const result = await dailySystem.claimDailyAttempt(
      mockPubClient, 'p_test', 'Tester', '2026-05-04'
    );
    expect(result.created).toBe(false);
    expect(result.attempt).toEqual(existing);
  });
});

describe('dailySystem.finalizeDailyAttempt', () => {
  test('writes attempt + leaderboard + expiries in a single multi pipeline', async () => {
    // The atomic pipeline matters: without multi(), a Redis blip after the
    // attempt write but before the ZADD would leave the player's record
    // marked done with no leaderboard entry — they'd lose their rank.
    const mockMulti = {
      set: jest.fn().mockReturnThis(),
      zAdd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const mockPubClient = {
      get: jest.fn().mockResolvedValueOnce(JSON.stringify({
        date: '2026-05-04', stableId: 'p_test', name: 'Tester',
        status: 'in_progress', chainLength: 0, startedAt: 1700000000000,
      })),
      multi: jest.fn(() => mockMulti),
    };

    await dailySystem.finalizeDailyAttempt(mockPubClient, 'p_test', 'Tester', 12, '2026-05-04');

    expect(mockPubClient.multi).toHaveBeenCalledTimes(1);
    expect(mockMulti.set).toHaveBeenCalledTimes(1);
    expect(mockMulti.zAdd).toHaveBeenCalledTimes(1);
    expect(mockMulti.expire).toHaveBeenCalledTimes(1);
    expect(mockMulti.exec).toHaveBeenCalledTimes(1);

    // Verify the leaderboard score is the chain length and the value is
    // the stableId — that's how getDailyLeaderboard joins to attempt records.
    const zAddCall = mockMulti.zAdd.mock.calls[0];
    expect(zAddCall[0]).toBe('daily:leaderboard:2026-05-04');
    expect(zAddCall[1]).toEqual({ score: 12, value: 'p_test' });
  });

  test('no-op when no prior attempt exists (avoids half-state writes)', async () => {
    // Defensive: a finalize without a prior claim shouldn't insert an
    // orphan leaderboard entry. The contract is "claim then finalize," and
    // skipping finalize is the only safe path when claim was never reached
    // (e.g. server crash mid-flight).
    const mockPubClient = {
      get: jest.fn().mockResolvedValueOnce(null),
      multi: jest.fn(),
    };
    await dailySystem.finalizeDailyAttempt(mockPubClient, 'p_ghost', 'Ghost', 5, '2026-05-04');
    expect(mockPubClient.multi).not.toHaveBeenCalled();
  });
});

// Audit finding #7: startDailyChallenge NX-claims the attempt BEFORE the
// TMDB seed bootstrap. If TMDB is briefly unreachable the claim used to be
// left as 'in_progress', locking the player out of that whole UTC day even
// though they never actually got to play. releaseInProgressAttempt is the
// rollback: delete the just-claimed slot iff it's still in_progress and is
// the same attempt we created (startedAt match), so a transient outage is
// retryable but a real finished run is never destroyed.
describe('dailySystem.releaseInProgressAttempt', () => {
  test('deletes the attempt when it is still in_progress and startedAt matches', async () => {
    const attempt = {
      date: '2026-05-04', stableId: 'p_test', name: 'Tester',
      status: 'in_progress', chainLength: 0, startedAt: 1700000000000, seedMovieId: 27205,
    };
    const mockPubClient = {
      get: jest.fn().mockResolvedValue(JSON.stringify(attempt)),
      del: jest.fn().mockResolvedValue(1),
    };

    const released = await dailySystem.releaseInProgressAttempt(
      mockPubClient, 'p_test', '2026-05-04', 1700000000000
    );

    expect(released).toBe(true);
    expect(mockPubClient.del).toHaveBeenCalledWith('daily:attempt:2026-05-04:p_test');
  });

  test('never deletes a finished (done) attempt', async () => {
    const done = {
      date: '2026-05-04', stableId: 'p_test', name: 'Tester',
      status: 'done', chainLength: 9, startedAt: 1700000000000, endedAt: 1700000300000,
    };
    const mockPubClient = {
      get: jest.fn().mockResolvedValue(JSON.stringify(done)),
      del: jest.fn().mockResolvedValue(1),
    };

    const released = await dailySystem.releaseInProgressAttempt(
      mockPubClient, 'p_test', '2026-05-04', 1700000000000
    );

    expect(released).toBe(false);
    expect(mockPubClient.del).not.toHaveBeenCalled();
  });

  test('does not delete when startedAt differs (a newer attempt replaced it)', async () => {
    const newer = {
      date: '2026-05-04', stableId: 'p_test', name: 'Tester',
      status: 'in_progress', chainLength: 0, startedAt: 1700009999999,
    };
    const mockPubClient = {
      get: jest.fn().mockResolvedValue(JSON.stringify(newer)),
      del: jest.fn().mockResolvedValue(1),
    };

    const released = await dailySystem.releaseInProgressAttempt(
      mockPubClient, 'p_test', '2026-05-04', 1700000000000
    );

    expect(released).toBe(false);
    expect(mockPubClient.del).not.toHaveBeenCalled();
  });
});
