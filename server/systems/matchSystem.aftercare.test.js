const matchSystem = require('./matchSystem');
const botSystem = require('./botSystem');

describe('_computeCouldHavePlayed → outs', () => {
  const room = { chain: [{ movie: { id: 99, cast: [] } }] };
  afterEach(() => jest.restoreAllMocks());

  test('maps enumerator results to ≤3 deduped {title,year,viaActor}', async () => {
    // Two moves with distinct titles — neither dedup branch is hit here;
    // the title-dedup path is exercised in the separate test below.
    jest.spyOn(botSystem, 'enumerateConnectingMoves').mockResolvedValue([
      { tmdbId: 10, mediaType: 'movie', viaActor: { id: 1, name: 'Alice' } },
      { tmdbId: 12, mediaType: 'movie', viaActor: { id: 2, name: 'Bob' } },
    ]);
    jest.spyOn(matchSystem, 'resolveCandidates').mockImplementation(async (_r, _m, id) =>
      id === 10 ? [{ id: 10, title: 'Heat', release_date: '1995-12-15' }]
                : [{ id: 12, title: 'Speed', release_date: '1994-06-10' }]);
    const outs = await matchSystem._computeCouldHavePlayed(room, {}, {});
    expect(outs).toEqual([
      { title: 'Heat', year: '1995', viaActor: 'Alice' },
      { title: 'Speed', year: '1994', viaActor: 'Bob' },
    ]);
  });

  test('title-dedup drops second move when two distinct tmdbIds resolve to the same title', async () => {
    // tmdbId 10 and tmdbId 20 are different IDs (enumerator already deduped by
    // tmdbId), but both resolve to 'The Mummy'. Only the first should survive.
    jest.spyOn(botSystem, 'enumerateConnectingMoves').mockResolvedValue([
      { tmdbId: 10, mediaType: 'movie', viaActor: { id: 1, name: 'Alice' } },
      { tmdbId: 20, mediaType: 'movie', viaActor: { id: 2, name: 'Bob' } },
    ]);
    jest.spyOn(matchSystem, 'resolveCandidates').mockImplementation(async (_r, _m, id) =>
      // Both ids resolve to the same on-card title string
      id === 10
        ? [{ id: 10, title: 'The Mummy', release_date: '1999-05-07' }]
        : [{ id: 20, title: 'The Mummy', release_date: '2017-06-09' }]);
    const outs = await matchSystem._computeCouldHavePlayed(room, {}, {});
    // Second same-title entry is dropped; only Alice's move survives
    expect(outs).toHaveLength(1);
    expect(outs[0]).toEqual({ title: 'The Mummy', year: '1999', viaActor: 'Alice' });
  });

  test('no enumerator results → null', async () => {
    jest.spyOn(botSystem, 'enumerateConnectingMoves').mockResolvedValue([]);
    await expect(matchSystem._computeCouldHavePlayed(room, {}, {})).resolves.toBeNull();
  });

  test('enumerator throwing is swallowed → null (never breaks elimination)', async () => {
    jest.spyOn(botSystem, 'enumerateConnectingMoves').mockRejectedValue(new Error('x'));
    await expect(matchSystem._computeCouldHavePlayed(room, {}, {})).resolves.toBeNull();
  });
});

describe('topCastNames', () => {
  test('maps an array of {name} objects to a string array', () => {
    // Standard post-H4 cast shape: array of {id, name} objects
    const cast = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
    expect(matchSystem.topCastNames(cast)).toEqual(['Alice', 'Bob']);
  });

  test('passes through a legacy string entry unchanged', () => {
    // Pre-H4 in-flight rooms may still hold bare strings in cast arrays
    const cast = ['Alice', { id: 2, name: 'Bob' }];
    expect(matchSystem.topCastNames(cast)).toEqual(['Alice', 'Bob']);
  });

  test('returns empty string for null / {} / missing-name entries', () => {
    // Defensive: malformed or partial cast entries must not throw
    const cast = [null, {}, { id: 3 }];
    expect(matchSystem.topCastNames(cast)).toEqual(['', '', '']);
  });

  test('slices at 10 — input of 12 entries yields length 10', () => {
    // topCastNames must never expose more than 10 names in the wire payload
    const cast = Array.from({ length: 12 }, (_, i) => ({ id: i, name: `Actor${i}` }));
    expect(matchSystem.topCastNames(cast)).toHaveLength(10);
  });
});
