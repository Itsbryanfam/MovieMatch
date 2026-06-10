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

  // -------------------------------------------------------------------------
  // T3b — per-IP buckets: the new-socket-resets-everything hole
  // -------------------------------------------------------------------------

  test('T3b: two sockets, same IP — per-IP bucket spans both, per-socket buckets stay independent', async () => {
    // The attack this defends: one IP opening N sockets to get N fresh
    // per-socket buckets. The per-IP bucket must count ACROSS sockets while
    // the per-socket buckets keep counting per socket (UX fairness intact).
    const xff = { 'x-forwarded-for': '203.0.113.7' };
    const a = await connect(xff);
    const b = await connect(xff);

    // Distinct queries so the (T3d) result cache can never collapse the
    // second call — this test is about limiter accounting, not caching.
    a.emit('heroActorSearch', { query: 'tom hanks' });
    await waitFor(a, 'heroActorResults');
    b.emit('heroActorSearch', { query: 'keanu reeves' });
    await waitFor(b, 'heroActorResults');

    // ONE shared IP bucket incremented by both sockets…
    expect(pubClient.counts.get('ratelimit:ip:heroActorSearch:203.0.113.7')).toBe(2);
    // …while each socket's own bucket saw exactly its own event.
    expect(pubClient.counts.get(`ratelimit:heroActorSearch:${a.id}`)).toBe(1);
    expect(pubClient.counts.get(`ratelimit:heroActorSearch:${b.id}`)).toBe(1);
  });

  test('T3b: spoofed left XFF entries cannot relocate the per-IP bucket', async () => {
    // An attacker prepending fake entries must still land in the bucket of
    // the proxy-appended (rightmost) address — otherwise per-IP limiting is
    // trivially evadable by rotating the spoofed prefix.
    const c = await connect({ 'x-forwarded-for': 'rotating-fake-1, 10.9.9.9, 198.51.100.9' });
    c.emit('heroActorSearch', { query: 'tom hanks' });
    await waitFor(c, 'heroActorResults');

    expect(pubClient.counts.get('ratelimit:ip:heroActorSearch:198.51.100.9')).toBe(1);
    // No bucket may be keyed by any attacker-controlled (non-rightmost) entry.
    for (const key of pubClient.counts.keys()) {
      expect(key).not.toContain('rotating-fake-1');
      expect(key).not.toContain('10.9.9.9');
    }
  });

  test('T3b: all three flagged events maintain per-IP buckets (joinLobby, autocomplete, heroActorSearch)', async () => {
    // These are the expensive/pre-room surfaces T3 scopes the IP dimension
    // to: joinLobby (covers lobby creation too — there is no separate
    // createLobby handler), autocompleteSearch, and heroActorSearch.
    const c = await connect({ 'x-forwarded-for': '203.0.113.42' });

    c.emit('joinLobby', { name: 'IpDim', lobbyId: '', stableId: 'p_ipdim' });
    // Unknown lobby → matchSystem bails after the limiter spend, which is
    // all this test needs (the increment happens in the handler, pre-bail).
    c.emit('autocompleteSearch', { query: 'tom', lobbyId: 'NOPE01' });
    c.emit('heroActorSearch', { query: 'tom hanks' });
    // Allow the three async handlers to settle (same wait idiom as
    // socket.integration.test.js uses for fire-and-forget handlers).
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(pubClient.counts.get('ratelimit:ip:joinLobby:203.0.113.42')).toBe(1);
    expect(pubClient.counts.get('ratelimit:ip:autocomplete:203.0.113.42')).toBe(1);
    expect(pubClient.counts.get('ratelimit:ip:heroActorSearch:203.0.113.42')).toBe(1);
  });

  test('T3b: non-flagged events get NO per-IP bucket (scope control)', async () => {
    // Per-IP applies ONLY to the expensive/pre-room events — cheap in-room
    // events keep their per-socket-only buckets so the extra Redis round
    // trip isn't paid on every chat/typing/poster ping.
    const c = await connect({ 'x-forwarded-for': '203.0.113.55' });
    c.emit('requestPosters');
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(pubClient.counts.get(`ratelimit:requestPosters:${c.id}`)).toBe(1);
    for (const key of pubClient.counts.keys()) {
      expect(key).not.toContain('ratelimit:ip:requestPosters');
    }
  });

  test('T3b: per-IP ceiling is 4× the per-socket ceiling — under it passes, over it blocks', async () => {
    // heroActorSearch borrows the autocomplete numbers (limit 20), so its
    // per-IP ceiling is 80. Seed the shared bucket as if other sockets on
    // this IP already spent 79 — the 80th increment must still pass.
    pubClient.counts.set('ratelimit:ip:heroActorSearch:203.0.113.99', 79);
    const under = await connect({ 'x-forwarded-for': '203.0.113.99' });
    under.emit('heroActorSearch', { query: 'tom hanks' });
    await waitFor(under, 'heroActorResults');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Bucket now sits at 80 (the ceiling). The 81st increment — from a
    // brand-new socket whose per-socket bucket is EMPTY — must be dropped:
    // that fresh-socket case is precisely the hole T3b closes.
    const over = await connect({ 'x-forwarded-for': '203.0.113.99' });
    let answered = false;
    over.on('heroActorResults', () => { answered = true; });
    over.emit('heroActorSearch', { query: 'keanu reeves' });
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(answered).toBe(false);
    // No further TMDB spend happened for the blocked call…
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // …and the per-socket bucket shows the block came from the IP dimension
    // (1 is far below the per-socket limit of 20).
    expect(pubClient.counts.get(`ratelimit:heroActorSearch:${over.id}`)).toBe(1);
  });

  test('T3b: per-IP bucket flap fails OPEN — event still allowed', async () => {
    // adminLimiter philosophy: a degraded Redis must never lock players out.
    // Fail ONLY the per-IP increment (per-socket keeps working) and the
    // event must go through as if the IP bucket said "fine".
    pubClient.state.failIncrPrefix = 'ratelimit:ip:';
    const c = await connect({ 'x-forwarded-for': '203.0.113.13' });
    c.emit('heroActorSearch', { query: 'tom hanks' });

    const data = await waitFor(c, 'heroActorResults');
    expect(Array.isArray(data.results)).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // The per-socket dimension still did its (unchanged) job.
    expect(pubClient.counts.get(`ratelimit:heroActorSearch:${c.id}`)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // T3d — heroActorSearch hardening, end-to-end through the handler
  // -------------------------------------------------------------------------

  test('T3d: sub-2-char query is dropped BEFORE any fetch or limiter spend', async () => {
    // A 1-char fragment is useless for the dropdown but still costs a TMDB
    // call and rate-limit budget if it gets past the guard. It must die at
    // the top of the handler: zero fetches, zero bucket increments.
    const c = await connect({ 'x-forwarded-for': '203.0.113.61' });
    let answered = false;
    c.on('heroActorResults', () => { answered = true; });
    // ' a ' trims to 1 char — the guard is min length AFTER trim, so
    // whitespace padding can't smuggle a 1-char query through.
    c.emit('heroActorSearch', { query: ' a ' });
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(answered).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    // No limiter spend: neither the per-socket nor the per-IP bucket may
    // have been touched (junk queries must not eat a player's real budget).
    expect(pubClient.counts.get(`ratelimit:heroActorSearch:${c.id}`)).toBeUndefined();
    expect(pubClient.counts.get('ratelimit:ip:heroActorSearch:203.0.113.61')).toBeUndefined();
  });

  test('T3d: repeated hero searches hit the Redis cache — exactly one TMDB fetch', async () => {
    // End-to-end proof the handler actually wires the cache (a unit test on
    // heroPuzzle alone could pass while the handler forgot to pass the Redis
    // client). Identical normalized query twice → one upstream call, both
    // emits answered with the same client-facing payload.
    const c = await connect({ 'x-forwarded-for': '203.0.113.62' });

    c.emit('heroActorSearch', { query: 'Tom Hanks' });
    const first = await waitFor(c, 'heroActorResults');
    // Different raw casing/whitespace, same normalized key — must be a hit.
    c.emit('heroActorSearch', { query: '  tom   HANKS ' });
    const second = await waitFor(c, 'heroActorResults');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Cache stores the CLIENT-FACING shape — a hit serves the wire payload
    // verbatim, zero re-mapping, zero TMDB work.
    expect(second.results).toEqual(first.results);
    expect(first.results[0]).toEqual({
      tmdbId: 31,
      name: 'Tom Hanks',
      profilePath: 'https://image.tmdb.org/t/p/w200/x.jpg',
      knownFor: ['Forrest Gump'],
    });
  });
});

// ===========================================================================
// T3c — io.use() connection throttle (per-IP cap on NEW connections)
// ===========================================================================
// The per-event buckets (T3b) bound what an admitted socket can do; this
// middleware bounds how fast one IP can mint NEW sockets in the first place.
// Without it, the connection loop itself (handshake + posters/themes/kits
// push per connect) is free amplification, and an attacker can keep cycling
// fresh sockets to dodge any per-socket accounting.

const { createConnectionThrottle, CONNECTION_LIMIT, CONNECTION_WINDOW_SEC } = require('./connectionThrottle');

describe('T3c — connection throttle middleware', () => {
  let httpServer, io, port;
  const pubClient = makeCountingPubClient();
  let clients = [];

  beforeAll((done) => {
    httpServer = http.createServer();
    io = new Server(httpServer, { cors: { origin: '*' } });
    // Middleware only — no event handlers. The throttle decision happens
    // before any handler would run, which is exactly the property under test.
    io.use(createConnectionThrottle(pubClient));
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
    pubClient.reset();
  });

  afterEach(() => {
    // disconnect() unconditionally — rejected clients are not `connected`
    // but still hold a manager that would otherwise keep retrying (and keep
    // the Jest worker alive).
    for (const c of clients) c.disconnect();
    clients = [];
  });

  // Returns { socket, result } where result resolves 'connected' or the
  // connect_error message — a throttle test needs BOTH outcomes first-class.
  function tryConnect(extraHeaders) {
    const c = Client(`http://localhost:${port}`, {
      forceNew: true,
      transports: ['websocket'],
      // reconnection off: a rejected handshake must settle as a final
      // observable outcome, not loop retries in the background of the test.
      reconnection: false,
      ...(extraHeaders ? { extraHeaders } : {}),
    });
    clients.push(c);
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for connect outcome')), 2000);
      c.once('connect', () => { clearTimeout(timer); resolve('connected'); });
      c.once('connect_error', (err) => { clearTimeout(timer); resolve(err.message); });
    });
    return { socket: c, result };
  }

  test('T3c: cap is 20 new connections per 60s window', () => {
    // Pin the constants the audit fix promises — a silent tweak to either
    // shows up here, not in production behavior nobody is watching.
    expect(CONNECTION_LIMIT).toBe(20);
    expect(CONNECTION_WINDOW_SEC).toBe(60);
  });

  test('T3c: 20th connection in-window is admitted, 21st is rejected with rate_limited', async () => {
    const xff = { 'x-forwarded-for': '198.51.100.50' };
    // Seed as if 19 connections already landed in this window — the next
    // one is the 20th (the cap itself, still admitted: limit is "per
    // minute", so count must EXCEED the cap to reject).
    pubClient.counts.set('ratelimit:conn:198.51.100.50', CONNECTION_LIMIT - 1);

    const twentieth = tryConnect(xff);
    await expect(twentieth.result).resolves.toBe('connected');

    const twentyFirst = tryConnect(xff);
    await expect(twentyFirst.result).resolves.toBe('rate_limited');
  });

  test('T3c: rejection is per-IP — a different IP connects fine while one is capped', async () => {
    // The throttle must never become a global outage lever: capping one
    // abusive IP cannot affect anyone else.
    pubClient.counts.set('ratelimit:conn:198.51.100.50', CONNECTION_LIMIT + 5);
    const blocked = tryConnect({ 'x-forwarded-for': '198.51.100.50' });
    await expect(blocked.result).resolves.toBe('rate_limited');

    const other = tryConnect({ 'x-forwarded-for': '203.0.113.200' });
    await expect(other.result).resolves.toBe('connected');
  });

  test('T3c: shares rightmost-XFF derivation — spoofed left entries cannot dodge the conn bucket', async () => {
    // Same trust rule as T3a/T3b (one shared helper, not a re-implementation):
    // only the proxy-appended rightmost entry picks the bucket.
    const t = tryConnect({ 'x-forwarded-for': 'fake-a, fake-b, 198.51.100.77' });
    await expect(t.result).resolves.toBe('connected');

    expect(pubClient.counts.get('ratelimit:conn:198.51.100.77')).toBe(1);
    for (const key of pubClient.counts.keys()) {
      expect(key).not.toContain('fake-a');
      expect(key).not.toContain('fake-b');
    }
  });

  test('T3c: Redis flap fails OPEN — connection admitted', async () => {
    // Same fail-open contract as T3b and the adminLimiter: if Redis is down
    // the app is already degraded; refusing handshakes on top of that would
    // turn a Redis blip into a full front-door outage.
    pubClient.state.failAllMulti = true;
    const t = tryConnect({ 'x-forwarded-for': '198.51.100.88' });
    await expect(t.result).resolves.toBe('connected');
  });
});

// ===========================================================================
// T3d — searchPersonForHero result cache (unit level, T1d degraded-mode
// discipline: cache errors = miss; write-back isolated so a flap can't
// discard fetched results)
// ===========================================================================

const heroPuzzle = require('./heroPuzzle');

describe('T3d — searchPersonForHero Redis result cache', () => {
  const TMDB_HEADERS = { Authorization: 'Bearer test_token', accept: 'application/json' };
  // Same payload/expected pair as the socket-level test, kept local so this
  // describe stands alone (no shared mutable fixtures across describes).
  const tmdbPersonPayload = {
    results: [
      { id: 31, name: 'Tom Hanks', profile_path: '/x.jpg', known_for: [{ title: 'Forrest Gump' }] },
    ],
  };
  const expectedClientShape = [{
    tmdbId: 31,
    name: 'Tom Hanks',
    profilePath: 'https://image.tmdb.org/t/p/w200/x.jpg',
    knownFor: ['Forrest Gump'],
  }];
  const realFetch = global.fetch;
  let pub;

  beforeEach(() => {
    pub = makeCountingPubClient();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => tmdbPersonPayload }));
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('miss → fetch + write-back; normalized-equal query → hit with zero fetch', async () => {
    const first = await heroPuzzle.searchPersonForHero('Tom Hanks', TMDB_HEADERS, pub);
    expect(first).toEqual(expectedClientShape);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Key is the NORMALIZED query (lowercase/trim/collapse-whitespace) so
    // cosmetic input variants share one entry instead of refetching.
    expect(pub.kv.has('herosearch:v1:tom hanks')).toBe(true);

    const second = await heroPuzzle.searchPersonForHero('  tom   HANKS ', TMDB_HEADERS, pub);
    expect(second).toEqual(expectedClientShape);
    // The whole point of the cache: a hit does ZERO TMDB work.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('cache-read flap degrades to MISS — results still served from TMDB', async () => {
    // T1d discipline: node-redis rejects in-flight commands on a socket
    // flap; a read error here must mean "miss", never "search broken".
    pub.state.failGetPrefix = 'herosearch:';
    const results = await heroPuzzle.searchPersonForHero('Tom Hanks', TMDB_HEADERS, pub);
    expect(results).toEqual(expectedClientShape);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('write-back flap cannot discard fetched results (T1d-ext discipline)', async () => {
    // The write-back runs AFTER TMDB answered — at that point we HOLD valid
    // results, and a Redis blip on the SET must not throw them away (the
    // exact bug class fixed for credits in commits 09cf70f/7ebeaa5).
    pub.state.failSetPrefix = 'herosearch:';
    const results = await heroPuzzle.searchPersonForHero('Tom Hanks', TMDB_HEADERS, pub);
    expect(results).toEqual(expectedClientShape);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Nothing landed in the cache — the price of the flap is a future
    // re-fetch, never a lost answer.
    expect(pub.kv.has('herosearch:v1:tom hanks')).toBe(false);
  });

  test('corrupt cache entry is a miss and self-heals on the fresh write-back', async () => {
    // Torn write / manual poke: parse failure must fall through to fetch
    // (same as getOrFetchCredits' corrupt-entry handling), and the fresh
    // write-back replaces the bad blob.
    pub.kv.set('herosearch:v1:tom hanks', '{ not json');
    const results = await heroPuzzle.searchPersonForHero('Tom Hanks', TMDB_HEADERS, pub);
    expect(results).toEqual(expectedClientShape);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(pub.kv.get('herosearch:v1:tom hanks'))).toEqual(expectedClientShape);
  });

  test('no pubClient (backward-compatible signature) → plain uncached fetch', async () => {
    // The cache is additive: callers without a Redis client (or a future
    // degraded boot path) keep the original direct-fetch behavior.
    const results = await heroPuzzle.searchPersonForHero('Tom Hanks', TMDB_HEADERS);
    expect(results).toEqual(expectedClientShape);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('non-OK TMDB response returns [] and is NOT cached', async () => {
    // Caching an upstream error for 6h would pin a transient TMDB blip into
    // a long outage for that query — error responses must stay uncached.
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const results = await heroPuzzle.searchPersonForHero('Tom Hanks', TMDB_HEADERS, pub);
    expect(results).toEqual([]);
    expect(pub.kv.has('herosearch:v1:tom hanks')).toBe(false);
  });
});
