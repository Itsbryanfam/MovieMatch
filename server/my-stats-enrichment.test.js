// server/my-stats-enrichment.test.js — Phase 6b/6c. Closes the holistic-review
// gap: the requestMyStats `myStats` enrichment (an explicit T2 acceptance
// criterion) and the connect-time ruleKitsList emit + new handler registrations
// were only exercised indirectly. This drives the real socketHandlers wiring
// through a minimal fake io/socket so a regression in the emit shape is caught.
jest.mock('./systems/statsSystem');
jest.mock('./systems/titlesSystem');
jest.mock('./posterCache');

const statsSystem = require('./systems/statsSystem');
const titlesSystem = require('./systems/titlesSystem');
const posterCache = require('./posterCache');
const { setupSocketHandlers } = require('./socketHandlers');

// A pubClient stub whose multi() pipeline resolves the rate-limit read to
// count=1 (under every limit), so handlers proceed past the limiter.
function makePubClient() {
  const chain = {
    incr() { return chain; },
    expire() { return chain; },
    exec: async () => [1],
  };
  return { multi: () => chain };
}

// Wire up one connection and return the fake socket + the captured handler map.
function connect(pubClient) {
  let connectionCb = null;
  const io = { on: (evt, cb) => { if (evt === 'connection') connectionCb = cb; } };
  const handlers = {};
  const socket = {
    id: 'sock_1',
    on: (evt, fn) => { handlers[evt] = fn; },
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
  };
  setupSocketHandlers(io, pubClient, {});
  connectionCb(socket); // simulate a client connecting
  return { socket, handlers };
}

beforeEach(() => {
  jest.clearAllMocks();
  posterCache.getPosters.mockReturnValue([]); // no poster emit noise
});

describe('requestMyStats — myStats enrichment', () => {
  test('emits myStats with equippedTitle + achievements{catalog,earned}, stats spread unchanged', async () => {
    statsSystem.getStats.mockResolvedValue({
      gamesPlayed: 30, wins: 12, longestChain: 25, totalPlays: 100,
      byMode: {}, favoriteConnector: null, lastUpdatedMs: 123,
    });
    titlesSystem.getEquippedTitle.mockResolvedValue('chain_master');

    const { socket, handlers } = connect(makePubClient());
    await handlers.requestMyStats('p_test');

    const call = socket.emit.mock.calls.find(c => c[0] === 'myStats');
    expect(call).toBeTruthy();
    const payload = call[1];
    // Original getStats fields spread through unchanged.
    expect(payload.gamesPlayed).toBe(30);
    expect(payload.wins).toBe(12);
    expect(payload.longestChain).toBe(25);
    expect(payload.totalPlays).toBe(100);
    // Enrichment fields present.
    expect(payload.equippedTitle).toBe('chain_master');
    expect(Array.isArray(payload.achievements.catalog)).toBe(true);
    expect(payload.achievements.catalog.length).toBe(13);
    // earned is derived from the stats above (30 games, 12 wins, chain 25, 100 plays).
    expect(payload.achievements.earned).toEqual(expect.arrayContaining([
      'first_steps', 'getting_hang', 'first_win', 'on_a_roll',
      'chain_builder', 'chain_master', 'well_connected',
    ]));
    // regular needs 50 games — not earned at 30.
    expect(payload.achievements.earned).not.toContain('regular');
  });

  test('equippedTitle defaults to null when none is set', async () => {
    statsSystem.getStats.mockResolvedValue({
      gamesPlayed: 0, wins: 0, longestChain: 0, totalPlays: 0,
      byMode: {}, favoriteConnector: null, lastUpdatedMs: null,
    });
    titlesSystem.getEquippedTitle.mockResolvedValue(null);

    const { socket, handlers } = connect(makePubClient());
    await handlers.requestMyStats('p_new');

    const payload = socket.emit.mock.calls.find(c => c[0] === 'myStats')[1];
    expect(payload.equippedTitle).toBeNull();
    expect(payload.achievements.earned).toEqual([]);
  });

  test('rejects an invalid stableId (no myStats emit)', async () => {
    const { socket, handlers } = connect(makePubClient());
    await handlers.requestMyStats('');                 // empty
    await handlers.requestMyStats('x'.repeat(65));     // too long
    expect(socket.emit.mock.calls.some(c => c[0] === 'myStats')).toBe(false);
  });
});

describe('connect-time wiring', () => {
  test('emits ruleKitsList (6 kits) on connection', () => {
    const { socket } = connect(makePubClient());
    const call = socket.emit.mock.calls.find(c => c[0] === 'ruleKitsList');
    expect(call).toBeTruthy();
    expect(Array.isArray(call[1])).toBe(true);
    expect(call[1].length).toBe(6);
    // display shape only (no rule fields leaked)
    expect(Object.keys(call[1][0]).sort()).toEqual(['icon', 'id', 'label']);
  });

  test('registers the new 6b/6c socket handlers', () => {
    const { handlers } = connect(makePubClient());
    expect(typeof handlers.requestMyStats).toBe('function');
    expect(typeof handlers.setEquippedTitle).toBe('function');
    expect(typeof handlers.selectRuleKit).toBe('function');
  });
});
