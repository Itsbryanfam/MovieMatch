const rateLimit = require('express-rate-limit');

// Strict limiter for /api/admin/*, separate from and stricter than the
// global 120/min limiter in server.js. Admin auth FAILURES count toward
// this budget on purpose — that is the brute-force ceiling on ADMIN_SECRET.
// 5 requests / 15 min / IP is generous for legitimate human admin use
// (flush-credits / prune-leaderboard are rare manual actions). trust proxy
// is set in server.js so req.ip is the real client IP behind the PaaS
// proxy. Exported as its own module so the behavior is unit-testable
// without booting server.js (Redis/port/process.exit side effects).
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = adminLimiter;
