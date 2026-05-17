const express = require('express');
const request = require('supertest');
// Require the REAL exported limiter and wire it exactly like server.js does,
// so this test guards the actual configured behavior without booting
// server.js (which has Redis/port/process.exit side effects).
const adminLimiter = require('./adminLimiter');

function makeApp() {
  const app = express();
  app.set('trust proxy', 1); // matches server.js:61
  app.use('/api/admin', adminLimiter);
  // Stub admin route that 403s like the real handlers do on bad auth, so
  // the test also proves auth FAILURES consume the limiter budget — that is
  // the intended brute-force ceiling on ADMIN_SECRET.
  app.post('/api/admin/redis-stats', (req, res) => res.status(403).json({ error: 'Forbidden' }));
  return app;
}

describe('adminLimiter', () => {
  test('allows 5 admin requests then 429s the 6th in-window', async () => {
    const agent = request(makeApp());
    for (let i = 0; i < 5; i++) {
      const res = await agent.post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
      // Budget consumed but not yet limited — still hits the (403) handler.
      expect(res.status).toBe(403);
    }
    const sixth = await agent.post('/api/admin/redis-stats').set('x-admin-secret', 'wrong');
    expect(sixth.status).toBe(429);
  });
});
