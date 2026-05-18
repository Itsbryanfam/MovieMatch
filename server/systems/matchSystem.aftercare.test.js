const matchSystem = require('./matchSystem');
const botSystem = require('./botSystem');

describe('_computeCouldHavePlayed → outs', () => {
  const room = { chain: [{ movie: { id: 99, cast: [] } }] };
  afterEach(() => jest.restoreAllMocks());

  test('maps enumerator results to ≤3 deduped {title,year,viaActor}', async () => {
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

  test('no enumerator results → null', async () => {
    jest.spyOn(botSystem, 'enumerateConnectingMoves').mockResolvedValue([]);
    await expect(matchSystem._computeCouldHavePlayed(room, {}, {})).resolves.toBeNull();
  });

  test('enumerator throwing is swallowed → null (never breaks elimination)', async () => {
    jest.spyOn(botSystem, 'enumerateConnectingMoves').mockRejectedValue(new Error('x'));
    await expect(matchSystem._computeCouldHavePlayed(room, {}, {})).resolves.toBeNull();
  });
});
