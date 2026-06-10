// ============================================================================
// T3c audit fix (P2) — per-IP cap on NEW socket connections
// ============================================================================
// WHY this exists: the per-event rate limits (socketHandlers' rateLimit)
// bound what an ADMITTED socket can do, and T3b bounds flagged events per
// IP — but nothing bounded how fast one IP could mint fresh sockets. The
// Express global limiter explicitly skips /socket.io/ (server.js), so the
// connection loop itself (handshake + the posters/themes/ruleKits push every
// connect triggers) was free amplification. This io.use() middleware caps
// new connections per IP per minute.
//
// WHY its own module (not inline in server.js): same reasoning as
// adminLimiter.js — server.js runs boot side effects (Redis connect, port
// bind, process.exit) and cannot be require()d in tests, so any logic that
// needs unit coverage must live in a leaf module.

// T3a's shared derivation — the throttle and the per-event limiter MUST
// resolve the same IP for the same client, so this is imported, never
// re-implemented (a drift between the two would let an attacker sit in
// different buckets per layer).
const { deriveClientIp } = require('./clientIp');

// 20 new connections per IP per minute. Generous for humans — a player
// reconnecting through flaky wifi or refresh-spamming the page stays far
// under it (each refresh is ONE connection) — while capping a socket-minting
// attacker at 20 fresh per-socket budgets a minute instead of unlimited.
const CONNECTION_LIMIT = 20;
const CONNECTION_WINDOW_SEC = 60;

/**
 * Returns an io.use() middleware: INCR a per-IP Redis bucket on every new
 * connection attempt; over the cap → next(Error('rate_limited')) so the
 * client handshake is refused. FAIL-OPEN on any Redis error.
 */
function createConnectionThrottle(pubClient) {
  return async (socket, next) => {
    // The whole body is inside one try so NO failure mode in here — Redis
    // flap, exotic handshake, anything — can ever refuse a connection for a
    // reason other than "over the cap". Matches the adminLimiter fail-open
    // philosophy: if Redis is down the app is already degraded; refusing
    // handshakes on top would turn a Redis blip into a front-door outage.
    try {
      // Rightmost-XFF-wins (Render appends the real client IP last; left
      // entries are client-supplied) — full trust reasoning in clientIp.js.
      const ip = deriveClientIp(socket.handshake);
      const key = `ratelimit:conn:${ip}`;
      // Same INCR+EXPIRE atomic pipeline idiom as socketHandlers' rateLimit,
      // so the two throttle layers share one mental model. The expire
      // re-arms per attempt: an IP that keeps hammering keeps its bucket
      // alive (stays capped), while a quiet minute resets it.
      const results = await pubClient.multi()
        .incr(key)
        .expire(key, CONNECTION_WINDOW_SEC)
        .exec();
      // Strictly-greater: the 20th connection in a window is admitted, the
      // 21st is refused — "20/min" means 20 ARE allowed.
      if (results[0] > CONNECTION_LIMIT) return next(new Error('rate_limited'));
      return next();
    } catch {
      // Fail-open (see above): admit rather than punish players for a flap.
      return next();
    }
  };
}

module.exports = {
  createConnectionThrottle,
  // Exported so tests pin the promised cap/window — a silent tweak to either
  // fails a test instead of quietly changing production behavior.
  CONNECTION_LIMIT,
  CONNECTION_WINDOW_SEC,
};
