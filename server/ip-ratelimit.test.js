// ============================================================================
// T3 audit fix (P2) — per-IP rate limiting, connection throttle, hero cache
// ============================================================================
// WHY this file exists: every socket rate-limit bucket is keyed on socket.id,
// and a fresh socket gets fresh buckets — so one attacker opening many
// sockets multiplies TMDB spend (heroActorSearch needs no lobby membership
// and proxies straight to TMDB /search/person on the shared token). These
// tests pin the per-IP defense layers added by T3:
//   T3a — socket.data.clientIp derived once per connection (rightmost XFF)
//   T3b — per-IP buckets on the expensive/pre-room events (fail-open)
//   T3c — io.use connection throttle (20/min/IP, fail-open)
//   T3d — heroActorSearch min-length guard + 6h Redis result cache
// Harness mirrors socket.integration.test.js (real socket.io server + real
// client over a loopback port, Redis mocked) but with a COUNTING pubClient
// mock, so tests can assert WHICH bucket keys were incremented and how often
// — the whole point of T3 is the distinction between per-socket and per-IP
// keys, which a yes/no mock can't express.

const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { setupSocketHandlers } = require('./socketHandlers');
const { deriveClientIp } = require('./clientIp');

// redisUtils is auto-mocked so the disconnect path (handleDisconnect →
// getSocketLobby) stays inert across client.disconnect() in afterEach —
// these tests exercise the rate-limit plumbing, which talks to the
// pubClient directly, never through redisUtils.
jest.mock('./redisUtils');
const redisUtils = require('./redisUtils');

// ---------------------------------------------------------------------------
// Counting pubClient mock. The real rateLimit helper drives
// multi().incr(key).expire(key, ttl).exec() — this mock actually counts per
// key so assertions can distinguish per-socket buckets from per-IP buckets.
// The `state` knobs simulate Redis flaps scoped by key prefix, so a test can
// fail ONLY the per-IP bucket while the per-socket bucket keeps working —
// exactly the degraded mode the fail-open requirement is about.
// ---------------------------------------------------------------------------
function makeCountingPubClient() {
  const counts = new Map(); // INCR counters by full Redis key
  const kv = new Map();     // GET/SET store (hero search cache backing)
  const state = {
    failIncrPrefix: null,   // exec() throws if the incr key starts with this
    failAllMulti: false,    // every exec() throws (total Redis flap)
    failGetPrefix: null,    // get() throws for matching keys (cache-read flap)
    failSetPrefix: null,    // set() throws for matching keys (write-back flap)
  };
  return {
    counts,
    kv,
    state,
    // reset() instead of swapping the object: setupSocketHandlers captures
    // the pubClient in a closure at beforeAll, so per-test isolation must
    // mutate this same instance rather than replace it.
    reset() {
      counts.clear();
      kv.clear();
      state.failIncrPrefix = null;
      state.failAllMulti = false;
      state.failGetPrefix = null;
      state.failSetPrefix = null;
    },
    async get(key) {
      if (state.failGetPrefix && key.startsWith(state.failGetPrefix)) {
        throw new Error('redis flap (get)');
      }
      return kv.has(key) ? kv.get(key) : null;
    },
    async set(key, value) {
      if (state.failSetPrefix && key.startsWith(state.failSetPrefix)) {
        throw new Error('redis flap (set)');
      }
      kv.set(key, value);
      return 'OK';
    },
    async exists() { return 0; },
    multi() {
      // Each multi() call returns a fresh chain (matches node-redis), and
      // exec() resolves [count, 1] — the same shape the production helper
      // destructures (results[0] = post-INCR counter value).
      let incrKey = null;
      const chain = {
        incr(k) { incrKey = k; return chain; },
        expire() { return chain; },
        async exec() {
          if (state.failAllMulti) throw new Error('redis flap (multi)');
          if (state.failIncrPrefix && incrKey && incrKey.startsWith(state.failIncrPrefix)) {
            throw new Error('redis flap (multi prefix)');
          }
          const next = (counts.get(incrKey) || 0) + 1;
          counts.set(incrKey, next);
          return [next, 1];
        },
      };
      return chain;
    },
  };
}

// Helper: wait for a single event with timeout — same pattern as
// socket.integration.test.js so failures read identically across suites.
function waitFor(socket, event, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ===========================================================================
// T3a — deriveClientIp: pure-function trust semantics
// ===========================================================================
// Render's proxy APPENDS the real client IP as the LAST x-forwarded-for
// entry; anything further LEFT was supplied by the client and is untrusted.
// Rightmost-wins mirrors Express `trust proxy: 1`, so the socket layer and
// the HTTP layer resolve the same IP for the same request.

describe('T3a — deriveClientIp (rightmost-XFF-wins)', () => {
  test('rightmost XFF entry wins; spoofed left entries are ignored', () => {
    // The attacker controls the LEFT side (they sent the header); the proxy
    // appended the genuine address last. Only the rightmost may be trusted.
    expect(deriveClientIp({
      headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.1, 198.51.100.9' },
      address: '::ffff:172.16.0.1',
    })).toBe('198.51.100.9');
  });

  test('entries are trimmed (proxies join with ", ")', () => {
    expect(deriveClientIp({
      headers: { 'x-forwarded-for': ' 6.6.6.6 ,  198.51.100.9  ' },
      address: '::1',
    })).toBe('198.51.100.9');
  });

  test('missing or blank XFF falls back to the socket remote address', () => {
    // No proxy header at all (direct connection / local dev).
    expect(deriveClientIp({ headers: {}, address: '::ffff:127.0.0.1' })).toBe('::ffff:127.0.0.1');
    // Header present but content-free — must not yield an empty-string IP,
    // which would collapse every such client into one shared '' bucket.
    expect(deriveClientIp({ headers: { 'x-forwarded-for': '   ' }, address: '::1' })).toBe('::1');
  });

  test('non-string XFF (defensive) falls back to the remote address', () => {
    // Node folds duplicate headers into a comma string for XFF, but be
    // defensive about exotic inputs — never crash the connection path.
    expect(deriveClientIp({ headers: { 'x-forwarded-for': 42 }, address: '::1' })).toBe('::1');
  });
});

// ===========================================================================
// Shared socket harness — T3a storage + T3b per-IP buckets
// ===========================================================================

describe('T3a/T3b — per-connection IP + per-IP rate-limit buckets', () => {
  let httpServer, io, port;
  const pubClient = makeCountingPubClient();
  // Track every client opened in a test so afterEach can close them all —
  // leaked sockets keep the Jest worker alive (the repo's Phase 2 lesson).
  let clients = [];

  // Minimal TMDB person-search payload — heroActorSearch proxies to
  // /search/person, so tests that let the event through need fetch mocked.
  const tmdbPersonPayload = {
    results: [
      { id: 31, name: 'Tom Hanks', profile_path: '/x.jpg', known_for: [{ title: 'Forrest Gump' }] },
    ],
  };
  const realFetch = global.fetch;

  beforeAll((done) => {
    httpServer = http.createServer();
    io = new Server(httpServer, { cors: { origin: '*' } });
    const TMDB_HEADERS = { Authorization: 'Bearer test_token', accept: 'application/json' };
    setupSocketHandlers(io, pubClient, TMDB_HEADERS);
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    io.close();
    httpServer.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    pubClient.reset();
    // Keep the disconnect path inert: handleDisconnect early-returns on a
    // null socket→lobby mapping, so client.disconnect() in afterEach can't
    // cascade into unmocked lobby machinery.
    redisUtils.getSocketLobby.mockResolvedValue(null);
    // Every test in this block that reaches TMDB must do so through this
    // spy — assertions on call counts are how we prove spend was prevented.
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => tmdbPersonPayload }));
  });

  afterEach(() => {
    for (const c of clients) {
      if (c && c.connected) c.disconnect();
    }
    clients = [];
    global.fetch = realFetch;
  });

  // Connect a client with optional spoofable headers; returns the socket.
  function connect(extraHeaders) {
    const c = Client(`http://localhost:${port}`, {
      forceNew: true,
      transports: ['websocket'],
      // extraHeaders rides the websocket upgrade request in Node, which is
      // how a reverse proxy's x-forwarded-for reaches socket.handshake.
      ...(extraHeaders ? { extraHeaders } : {}),
    });
    clients.push(c);
    return waitFor(c, 'connect').then(() => c);
  }

  test('T3a: server socket stores rightmost-XFF clientIp once at connection', async () => {
    // Left entry is attacker-supplied garbage; the rightmost is what the
    // trusted proxy appended. socket.data.clientIp must hold the rightmost.
    const c = await connect({ 'x-forwarded-for': 'spoofed.example, 198.51.100.9' });
    const serverSocket = io.sockets.sockets.get(c.id);
    expect(serverSocket).toBeDefined();
    expect(serverSocket.data.clientIp).toBe('198.51.100.9');
  });

  test('T3a: no XFF header → clientIp falls back to the handshake remote address', async () => {
    const c = await connect();
    const serverSocket = io.sockets.sockets.get(c.id);
    // Loopback test traffic has no proxy in front, so the derived IP must be
    // exactly the raw remote address engine.io recorded for the handshake.
    expect(serverSocket.data.clientIp).toBe(serverSocket.handshake.address);
    expect(typeof serverSocket.data.clientIp).toBe('string');
    expect(serverSocket.data.clientIp.length).toBeGreaterThan(0);
  });
});
