const express = require('express');
const request = require('supertest');

// Mock rate-limit-redis with a minimal in-memory Store implementing the
// express-rate-limit v8 Store interface (init/increment/decrement/resetKey).
// The constructor records the options it was handed so we can assert the
// factory wired `sendCommand` to the injected client. `__failNext` lets a
// test force a store error to prove fail-open.
jest.mock('rate-limit-redis', () => {
  class FakeRedisStore {
    constructor(opts) {
      FakeRedisStore.lastOpts = opts;
      // Track the last constructed instance so the fail-open test can flip
      // __failNext without having to reach through lastOpts.
      FakeRedisStore.lastInstance = this;
      this.hits = new Map();
      this.__failNext = false;
    }
    init() {}
    async increment(key) {
      if (this.__failNext) { this.__failNext = false; throw new Error('redis down'); }
      const n = (this.hits.get(key) || 0) + 1;
      this.hits.set(key, n);
      return { totalHits: n, resetTime: new Date(Date.now() + 900000) };
    }
    async decrement(key) { this.hits.set(key, Math.max(0, (this.hits.get(key) || 0) - 1)); }
    async resetKey(key) { this.hits.delete(key); }
  }
  FakeRedisStore.lastOpts = null;
  FakeRedisStore.lastInstance = null;
  return { RedisStore: FakeRedisStore };
});

const { RedisStore } = require('rate-limit-redis');
const createAdminLimiter = require('./adminLimiter');

function makeApp(client) {
  const app = express();
  app.set('trust proxy', 1); // matches server.js
  app.use('/api/admin', createAdminLimiter(client));
  app.post('/api/admin/redis-stats', (req, res) => res.status(403).json({ error: 'Forbidden' }));
  return app;
}

describe('createAdminLimiter (M3 — Redis-backed, fail-open)', () => {
  test('is a factory returning express middleware', () => {
    const mw = createAdminLimiter({ sendCommand: jest.fn() });
    expect(typeof mw).toBe('function');
  });

  test('does NOT construct the Redis store until the first request (boot-before-connect guard)', () => {
    // Regression (prod incident 2026-05-17, deploys dep-d84ouuho /
    // dep-d8504cho → ClientClosedError, exit 1): server.js mounts this
    // middleware at module load, BEFORE startApp() awaits
    // pubClient.connect(). rate-limit-redis's RedisStore constructor
    // eagerly issues a Redis command (loadIncrementScript → SCRIPT LOAD).
    // Constructed at mount time it hit an unconnected client and the
    // unhandled rejection killed boot. The store must be built lazily on
    // first request — by then server.listen() has run, so connect resolved.
    RedisStore.lastOpts = null;
    RedisStore.lastInstance = null;
    const client = { sendCommand: jest.fn().mockResolvedValue('OK') };
    const mw = createAdminLimiter(client);
    expect(typeof mw).toBe('function');
    // Nothing constructed at factory/mount time:
    expect(RedisStore.lastInstance).toBeNull();
    expect(client.sendCommand).not.toHaveBeenCalled();
  });

  test('wires the store sendCommand to the injected redis client (built on first request)', async () => {
    const client = { sendCommand: jest.fn().mockResolvedValue('PONG') };
    RedisStore.lastOpts = null;
    // Lazy now: drive one request so the limiter constructs the store.
    await request(makeApp(client)).post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
    expect(RedisStore.lastOpts).toBeTruthy();
    await RedisStore.lastOpts.sendCommand('PING', 'x');
    expect(client.sendCommand).toHaveBeenCalledWith(['PING', 'x']);
  });

  test('allows 5 admin requests then 429s the 6th in-window', async () => {
    const agent = request(makeApp({ sendCommand: jest.fn() }));
    for (let i = 0; i < 5; i++) {
      const res = await agent.post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
      expect(res.status).toBe(403);
    }
    const sixth = await agent.post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
    expect(sixth.status).toBe(429);
  });

  test('fails OPEN when the store throws (request served, not 500/blocked)', async () => {
    const app = express();
    app.set('trust proxy', 1);
    const mw = createAdminLimiter({ sendCommand: jest.fn() });
    app.use('/api/admin', mw);
    app.post('/api/admin/redis-stats', (req, res) => res.status(403).json({ error: 'Forbidden' }));
    const agent = request(app);
    // Lazy now: the first request constructs the FakeRedisStore (sets
    // lastInstance). Then flip it to throw on the next increment to prove
    // the limiter fails open instead of propagating the error as a 500.
    await agent.post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
    RedisStore.lastInstance.__failNext = true;
    const res = await agent.post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
    // The real guarantee here is "never 500 when the store throws". Only 2
    // requests are made (well under max:5) so 429 cannot occur; the
    // [403,429] assertion is kept intentionally broad so a future refactor
    // that pre-seeds hits doesn't accidentally break this test. What we're
    // proving: a store error is handled gracefully (fail-open → 403 from
    // the route handler) and never propagated as a 500.
    expect([403, 429]).toContain(res.status); // never 500
  });
});
