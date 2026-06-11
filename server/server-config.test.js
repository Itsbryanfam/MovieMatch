// ============================================================================
// server-config.test.js — T4f audit fix (2026-06-09)
// ============================================================================
// WHY a NEW file (and NOT my-stats-enrichment.test.js's connect-time suite):
// that suite is in-flight 6c.1 work and is off-limits. This pins the new
// server-authoritative 'serverConfig' connect-time emit independently — the
// player cap is emitted from constants.MAX_PLAYERS_PER_LOBBY so the client can
// render the public-lobby "N / max" count dynamically instead of hardcoding 8.
// ============================================================================
jest.mock('./posterCache');

const posterCache = require('./posterCache');
const { setupSocketHandlers } = require('./socketHandlers');
const { MAX_PLAYERS_PER_LOBBY } = require('./constants');

// A pubClient stub whose multi() pipeline resolves the rate-limit read to
// count=1 (under every limit) — same minimal shape my-stats-enrichment uses.
function makePubClient() {
  const chain = { incr() { return chain; }, expire() { return chain; }, exec: async () => [1] };
  return { multi: () => chain };
}

// Wire one connection and return the fake socket (so we can read its emits).
function connect(pubClient) {
  let connectionCb = null;
  const io = { on: (evt, cb) => { if (evt === 'connection') connectionCb = cb; } };
  const socket = {
    id: 'sock_1',
    on: jest.fn(),
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
  };
  setupSocketHandlers(io, pubClient, {});
  connectionCb(socket);
  return { socket };
}

beforeEach(() => {
  jest.clearAllMocks();
  posterCache.getPosters.mockReturnValue([]); // no poster emit noise
});

describe('T4f — serverConfig connect-time emit', () => {
  test('emits serverConfig with { maxPlayers } sourced from MAX_PLAYERS_PER_LOBBY', () => {
    const { socket } = connect(makePubClient());

    const call = socket.emit.mock.calls.find(c => c[0] === 'serverConfig');
    expect(call).toBeTruthy();
    expect(call[1]).toEqual({ maxPlayers: MAX_PLAYERS_PER_LOBBY });
    // Pin the concrete shape the client expects too (8 today).
    expect(call[1].maxPlayers).toBe(8);
  });

  test('serverConfig is emitted exactly once per connection', () => {
    const { socket } = connect(makePubClient());
    const configEmits = socket.emit.mock.calls.filter(c => c[0] === 'serverConfig');
    expect(configEmits).toHaveLength(1);
  });
});
