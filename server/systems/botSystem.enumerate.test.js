// Phase 7.1: read-side enumerator. Own file (hoisted jest.mock isolation —
// mirrors botSystem.schedule.test.js) so credit mocks never leak into the
// difficulty/move-gen tests in botSystem.test.js.
const botSystem = require('./botSystem');

// last chain entry casts Alice (id1) and Bob (id2). Alice also stars in
// movies 10/11; Bob in 12. rng:()=>0 makes _shuffled + any pick deterministic.
function room() {
  return {
    chain: [{ movie: { id: 99, cast: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] } }],
    usedMovies: [],
    previousSharedActors: [],
    hardcoreMode: false,
  };
}
function deps(creditsById) {
  return {
    pubClient: {}, headers: {}, rng: () => 0, dailySeed: [],
    getOrFetchPersonCredits: async (_pc, id) => creditsById[id] || { movies: [] },
  };
}

describe('enumerateConnectingMoves', () => {
  test('returns up to limit moves, each tagged with the bridging actor', async () => {
    const credits = {
      1: { movies: [{ id: 10, popularity: 90 }, { id: 11, popularity: 50 }] },
      2: { movies: [{ id: 12, popularity: 80 }] },
    };
    const out = await botSystem.enumerateConnectingMoves(room(), deps(credits), { limit: 3 });
    expect(out).toHaveLength(3);
    expect(out.map(o => o.tmdbId).sort()).toEqual([10, 11, 12]);
    const viaFor = id => out.find(o => o.tmdbId === id).viaActor.name;
    expect(viaFor(10)).toBe('Alice');
    expect(viaFor(12)).toBe('Bob');
    out.forEach(o => expect(o.mediaType).toBe('movie'));
  });

  test('dedupes a movie reachable via two actors and respects limit', async () => {
    const credits = {
      1: { movies: [{ id: 10, popularity: 90 }] },
      2: { movies: [{ id: 10, popularity: 90 }, { id: 12, popularity: 70 }] },
    };
    const out = await botSystem.enumerateConnectingMoves(room(), deps(credits), { limit: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].tmdbId).toBe(10);
  });

  test('fail-closed: no chain / no credits / all errors → []', async () => {
    await expect(botSystem.enumerateConnectingMoves({ chain: [] }, deps({}), { limit: 3 })).resolves.toEqual([]);
    await expect(botSystem.enumerateConnectingMoves(room(), deps({}), { limit: 3 })).resolves.toEqual([]);
    const throwing = { ...deps({}), getOrFetchPersonCredits: async () => { throw new Error('tmdb'); } };
    await expect(botSystem.enumerateConnectingMoves(room(), throwing, { limit: 3 })).resolves.toEqual([]);
  });
});
