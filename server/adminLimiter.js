const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');

// M3: was a bare in-memory singleton. The default store made the real
// brute-force ceiling 5×N across N instances and reset it every deploy. A
// Redis store keyed on the shared pubClient restores a true global
// 5/15min/IP ceiling that survives deploys and is shared across instances.
// Still its own module (not inlined in server.js) so it stays unit-testable
// without booting the server (Redis/port/process.exit side effects).
//
// FAIL-OPEN: if Redis is unreachable the whole app is already degraded
// (game state lives in Redis); the admin limiter must not 500 or hard-lock
// the operator out of recovery endpoints. On any store error we degrade to
// "allow". This matches the codebase's existing best-effort lock philosophy
// (withLobbyLock proceeds unlocked after its TTL-bounded spin rather than
// dropping the user's action).
function failOpen(store) {
  // Wraps each Store method so that any throw is caught and replaced with a
  // safe "allow" fallback value instead of propagating to a 500 error page.
  // If `fallback` is a function (thunk) it is called at catch time so the
  // returned value is freshly computed per fail-open call — not frozen at
  // factory/boot time.
  const safe = (name, fallback) => async (...args) => {
    try { return await store[name](...args); }
    catch { return typeof fallback === 'function' ? fallback() : fallback; }
  };
  const wrapped = {
    // init intentionally NOT wrapped by safe — if store.init() throws at
    // factory time we WANT startup to crash loudly (a misconfiguration should
    // never silently fail-open at request time). Only per-request store
    // methods need the fail-open safety net.
    init: (opts) => { if (typeof store.init === 'function') store.init(opts); },
    // increment: the fallback is a THUNK so resetTime is computed fresh on
    // each fail-open call. If it were a plain object literal the Date would be
    // frozen at factory/boot time; after the first 15-min window the
    // RateLimit-Reset header would report a time in the past (effectively 0),
    // misleading clients about when they may retry. Thunking ensures the reset
    // window is always 15 min from *now*. totalHits: 1 is a valid positive
    // integer below max:5, so the rateLimit check (totalHits > max) is false —
    // every fail-open request passes cleanly without a v8 validation warning.
    increment: safe('increment', () => ({ totalHits: 1, resetTime: new Date(Date.now() + 15 * 60 * 1000) })),
    // decrement/resetKey: swallowing errors is correct — if they fail we
    // just leave a stale counter, which is harmless given fail-open mode.
    // Fallback is `undefined` (not a thunk) — no timestamp to go stale.
    decrement: safe('decrement', undefined),
    resetKey: safe('resetKey', undefined),
  };
  // resetAll is optional in the v8 Store interface; preserve it when present.
  if (typeof store.resetAll === 'function') wrapped.resetAll = safe('resetAll', undefined);
  return wrapped;
}

function createAdminLimiter(redisClient) {
  const store = new RedisStore({
    // node-redis v5's sendCommand(array) API is wrapped here into the spread
    // signature that rate-limit-redis expects: (...args: string[]) => Promise.
    // The spread collects the variadic args back into a single array for
    // the underlying client.
    sendCommand: (...args) => redisClient.sendCommand(args),
    prefix: 'rl:admin:',
  });
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    // Wrap the store so any Redis error fails open rather than propagating
    // as a 500. passOnStoreError is also set true as a belt-and-suspenders
    // guard: if a throw somehow escapes the failOpen wrapper, express-rate-limit
    // itself will call next() instead of next(error).
    store: failOpen(store),
    passOnStoreError: true,
  });
}

module.exports = createAdminLimiter;
