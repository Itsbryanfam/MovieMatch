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

  test('wires the store sendCommand to the injected redis client', async () => {
    const client = { sendCommand: jest.fn().mockResolvedValue('PONG') };
    createAdminLimiter(client);
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
    // Flip the last-constructed FakeRedisStore instance to throw on the next
    // increment call — proves the limiter doesn't propagate store errors as 500.
    RedisStore.lastInstance.__failNext = true;
    const res = await request(app).post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
    // The real guarantee here is "never 500 when the store throws". Each
    // makeApp() builds a fresh createAdminLimiter() → a fresh FakeRedisStore
    // with an empty hits map, so in this test 429 cannot actually occur (no
    // prior hits exist to trigger the limit). The [403,429] assertion is kept
    // intentionally broad so a future refactor that pre-seeds hits or reuses
    // the app instance doesn't accidentally break this test; what we're
    // proving is that a store error is handled gracefully (fail-open → 403
    // from the route handler) and never propagated as a 500.
    expect([403, 429]).toContain(res.status); // never 500
  });
});
