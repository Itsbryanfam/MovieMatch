require('dotenv').config();
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pino = require('pino');

// Hash the inline JSON-LD <script> at startup so CSP can allow exactly that
// script (and only that script) without falling back to 'unsafe-inline'.
// 'unsafe-inline' nullifies XSS protection from the policy entirely; a
// per-script hash limits the trust to the byte sequence we shipped.
// Computed once at startup, not per request — and any whitespace edit to the
// JSON-LD block invalidates the hash automatically (browser will block the
// script and the page won't load), which surfaces the maintenance burden
// instead of letting it silently rot.
function computeInlineScriptHashes() {
  try {
    const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const hashes = [];
    // Match each inline <script>...</script> block (skips external <script src=...>).
    const scriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(indexHtml)) !== null) {
      const body = match[1];
      const hash = crypto.createHash('sha256').update(body).digest('base64');
      hashes.push(`'sha256-${hash}'`);
    }
    return hashes;
  } catch (err) {
    // If the index.html read fails at startup, log and fall back to the
    // permissive policy rather than refusing to boot. CSP is defense-in-depth,
    // not a load-bearing auth check.
    console.error('CSP hash computation failed; falling back to unsafe-inline:', err.message);
    return null;
  }
}
const INLINE_SCRIPT_HASHES = computeInlineScriptHashes();

// Constant-time string comparison for admin secrets. Returns false on type
// or length mismatch — those bail before timingSafeEqual (which throws on
// length mismatch). For everything else, compares O(n) regardless of where
// bytes diverge, so an attacker can't measure response-time differences to
// learn the secret prefix.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

const logger = pino();
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Pin script-src to the inline-script hashes if we computed them; fall back
// to 'unsafe-inline' only if the hash computation failed at startup (so a
// hash-mismatch outage during dev doesn't leave the page unusable).
const scriptSrc = INLINE_SCRIPT_HASHES
  ? ["'self'", ...INLINE_SCRIPT_HASHES]
  : ["'self'", "'unsafe-inline'"];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // unsafe-inline removed in favor of per-script SHA-256 hashes — see
      // computeInlineScriptHashes above. Any added/edited inline <script> will
      // automatically be hashed at startup; an attacker injecting a fresh
      // inline script via XSS will be blocked because their script's hash
      // isn't on the allowlist.
      scriptSrc,
      // styleSrc keeps 'unsafe-inline' — many inline style="..." attributes
      // throughout index.html make per-style hashing impractical. Document
      // and accept the residual risk for now.
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "https://image.tmdb.org"],
      connectSrc: ["'self'", "wss:", "https://api.themoviedb.org"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // needed for some browser features
}));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));

const limiter = rateLimit({
  windowMs: 60000,
  max: 120,
  skip: (req) => req.path.startsWith('/socket.io/') || req.path.startsWith('/static/')
});
app.use(limiter);

app.use(express.static('public'));

// M3: pubClient/subClient are constructed here (moved up from below the
// telemetry routes) because the admin limiter now needs the Redis client at
// mount time, and the mount MUST stay before the /api/admin route defs.
// createClient is lazy — no connection happens until startApp() calls
// .connect(), so relocating the construction is behavior-neutral.
const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => logger.error(err, 'Redis Pub Client Error'));
subClient.on('error', (err) => logger.error(err, 'Redis Sub Client Error'));

// Strict admin-only rate limiter (5 / 15min / IP), layered on top of the
// global limiter. Path-prefixed so it covers every current and future
// /api/admin/* route without restructuring the handlers. MUST be registered
// before the admin route definitions — Express runs middleware in order.
const createAdminLimiter = require('./server/adminLimiter');
app.use('/api/admin', createAdminLimiter(pubClient));

app.post('/api/admin/flush-credits', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  // safeEqual: constant-time compare so the response time doesn't leak how
  // many bytes of the secret the caller got right.
  if (!safeEqual(secret, process.env.ADMIN_SECRET)) {
    logger.warn({ ip: req.ip, path: req.path }, 'Admin auth failed');
    return res.status(403).json({ error: 'Forbidden' });
  }
  logger.info({ ip: req.ip, action: 'flush-credits' }, 'Admin action');
  try {
    let cursor = '0';
    let deleted = 0;
    do {
      const result = await pubClient.scan(parseInt(cursor), { MATCH: 'credits:*', COUNT: 100 });
      cursor = String(result.cursor);
      if (result.keys.length > 0) {
        await pubClient.del(result.keys);
        deleted += result.keys.length;
      }
    } while (cursor !== '0');
    logger.info(`Flushed ${deleted} cached credits entries`);
    res.json({ deleted });
  } catch (err) {
    logger.error(err, 'Failed to flush credits cache');
    res.status(500).json({ error: 'Flush failed' });
  }
});

app.get('/api/admin/redis-stats', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!safeEqual(secret, process.env.ADMIN_SECRET)) {
    logger.warn({ ip: req.ip, path: req.path }, 'Admin auth failed');
    return res.status(403).json({ error: 'Forbidden' });
  }
  logger.info({ ip: req.ip, action: 'redis-stats' }, 'Admin action');
  try {
    const info = await pubClient.info('memory');
    const dbSize = await pubClient.dbSize();
    const memMatch = info.match(/used_memory_human:(\S+)/);
    const peakMatch = info.match(/used_memory_peak_human:(\S+)/);
    res.json({
      usedMemory: memMatch ? memMatch[1] : 'unknown',
      peakMemory: peakMatch ? peakMatch[1] : 'unknown',
      totalKeys: dbSize
    });
  } catch (err) {
    logger.error(err, 'Failed to get Redis stats');
    res.status(500).json({ error: 'Stats failed' });
  }
});

// Audit finding #10: manual trigger for the full leaderboard ZSET prune
// (also runs on a slow timer in startApp). Same x-admin-secret +
// constant-time compare + structured-log pattern as the other admin
// endpoints. Returns how many orphaned members were removed.
app.post('/api/admin/prune-leaderboard', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!safeEqual(secret, process.env.ADMIN_SECRET)) {
    logger.warn({ ip: req.ip, path: req.path }, 'Admin auth failed');
    return res.status(403).json({ error: 'Forbidden' });
  }
  logger.info({ ip: req.ip, action: 'prune-leaderboard' }, 'Admin action');
  try {
    const removed = await redisUtils.pruneLeaderboard(pubClient);
    logger.info(`Pruned ${removed} stale leaderboard entries`);
    res.json({ removed });
  } catch (err) {
    logger.error(err, 'Failed to prune leaderboard');
    res.status(500).json({ error: 'Prune failed' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const entries = await redisUtils.getLeaderboard(pubClient);
    res.json(entries);
  } catch (err) {
    logger.error(err, 'Failed to fetch leaderboard');
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// H6: Admin telemetry stats endpoint. Returns per-event-type counts within
// the requested time window. The data lives in Redis ZSETs populated by
// server/telemetry.js — see that file for the event schema and retention.
//
// Query params:
//   days  — window size in days (default 7, clamped to [1, telemetry retention])
//   event — optional single event type; when set, returns the raw events
//           in the window instead of a summary (useful for ad-hoc spelunking)
//
// Auth: same x-admin-secret pattern as /api/admin/flush-credits — constant-
// time compare, 403 on miss, structured warn-log on failure.
app.get('/api/admin/stats', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!safeEqual(secret, process.env.ADMIN_SECRET)) {
    logger.warn({ ip: req.ip, path: req.path }, 'Admin auth failed');
    return res.status(403).json({ error: 'Forbidden' });
  }
  logger.info({ ip: req.ip, action: 'stats' }, 'Admin action');
  try {
    // Parse and clamp `days` so a malformed or absurd value can't blow out
    // memory by trying to read multi-decade ranges. Cap at retention
    // because anything older has been pruned anyway.
    const requestedDays = parseInt(req.query.days, 10);
    const days = Math.min(
      Math.max(Number.isFinite(requestedDays) ? requestedDays : 7, 1),
      telemetry.TEL_RETENTION_DAYS
    );
    const windowMs = days * 24 * 60 * 60 * 1000;

    // Single-event mode: return the raw events for ad-hoc analysis.
    if (typeof req.query.event === 'string' && req.query.event) {
      const events = await telemetry.getEvents(pubClient, req.query.event, windowMs);
      return res.json({ days, event: req.query.event, count: events.length, events });
    }

    // Summary mode: counts per event type for the window.
    const summary = await telemetry.getSummary(pubClient, windowMs);
    res.json({ days, summary });
  } catch (err) {
    logger.error(err, 'Failed to read telemetry stats');
    res.status(500).json({ error: 'Stats failed' });
  }
});

const TMDB_TOKEN = process.env.TMDB_READ_TOKEN;
if (!TMDB_TOKEN) {
  logger.fatal('TMDB_READ_TOKEN environment variable is required. Set it in your .env file.');
  process.exit(1);
}
// ADMIN_SECRET fail-fast — parity with the TMDB guard above. safeEqual
// already fails closed when the secret is missing, but a missing/weak
// secret should refuse to boot LOUDLY rather than silently shipping
// unreachable (or brute-forceable) destructive admin endpoints.
const validateAdminSecret = require('./server/validateAdminSecret');
const adminSecretErr = validateAdminSecret(process.env.ADMIN_SECRET);
if (adminSecretErr) {
  logger.fatal(adminSecretErr + '. Set it in your .env file.');
  process.exit(1);
}
const TMDB_HEADERS = { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' };

let io;


async function fetchBackgroundPosters() {
  try {
    const res1 = await fetch(`https://api.themoviedb.org/3/movie/popular?language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
    const data1 = await res1.json();
    const res2 = await fetch(`https://api.themoviedb.org/3/movie/top_rated?language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
    const data2 = await res2.json();
    
    const combined = [...(data1.results || []), ...(data2.results || [])];
    const posters = combined.filter(m => m.poster_path).map(m => `https://image.tmdb.org/t/p/w200${m.poster_path}`);
    // Fisher–Yates shuffle: walk from the end, swapping each element with a
    // randomly chosen earlier-or-self position. Produces a uniformly random
    // permutation. The previous `sort(() => 0.5 - Math.random())` was biased —
    // a non-deterministic comparator violates the comparator contract.
    for (let i = posters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [posters[i], posters[j]] = [posters[j], posters[i]];
    }
    
    posterCache.setPosters(posters);

    if (io) io.emit('posters', posters);
  } catch (err) {
    logger.error(err, 'Failed to fetch background posters');
  }
}

const { setupSocketHandlers } = require('./server/socketHandlers');
const redisUtils = require('./server/redisUtils');
const posterCache = require('./server/posterCache');
const telemetry = require('./server/telemetry');
// Audit finding #6: needed for the boot-time turn-watchdog recovery sweep.
const gameLogic = require('./server/gameLogic');

const POSTER_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
// Audit finding #10: the leaderboard ZSET only ever shed entries via the
// top-N lazy prune. A slow full sweep (once a day) bounds total growth on a
// long-lived public deployment without adding meaningful load — ZSCAN is
// cursor-paged and the whole set is tiny relative to lobby traffic.
const LEADERBOARD_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
// Phase 2 R2: how often every instance re-checks for playing lobbies it
// isn't watching. 30s bounds worst-case soft-lock latency to one cycle
// while keeping the getAllLobbies load negligible.
const TURN_SWEEP_INTERVAL_MS = 30 * 1000; // 30 seconds

async function startApp() {
  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    logger.info('Redis connected');
    // Fetch immediately on boot, then refresh every 30 minutes.
    // Must run after Redis connects because posterCache.setPosters triggers
    // an io.emit, and io is only ready after this function runs.
    fetchBackgroundPosters();
    setInterval(fetchBackgroundPosters, POSTER_REFRESH_INTERVAL_MS);
    // Audit finding #10: periodic full leaderboard prune. Best-effort —
    // a failed sweep just means stale entries linger until the next run or
    // an admin POST /api/admin/prune-leaderboard; it must never crash boot.
    setInterval(() => {
      redisUtils.pruneLeaderboard(pubClient)
        .then(n => { if (n > 0) logger.info(`Leaderboard prune removed ${n} stale entries`); })
        .catch(err => logger.error(err, 'Periodic leaderboard prune failed'));
    }, LEADERBOARD_PRUNE_INTERVAL_MS);
  } catch (err) {
    logger.error(err, 'Redis connection failed');
  }

  io = new Server(server, { 
    adapter: createAdapter(pubClient, subClient),
    cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000' }
  });

  setupSocketHandlers(io, pubClient, TMDB_HEADERS);

  // Audit finding #6: in-process turn watchdogs don't survive a restart but
  // the games (in Redis) do. Re-arm a server watchdog for every in-flight
  // lobby so a deploy/crash can't leave a game soft-locked with no
  // enforcement. Best-effort — never blocks server start.
  gameLogic.recoverActiveTurns(io, pubClient)
    .then(n => { if (n > 0) logger.info(`Recovered turn watchdogs for ${n} in-flight lobbies`); })
    .catch(err => logger.error(err, 'Turn-watchdog recovery sweep failed'));

  // Phase 2 R2: boot recovery only fixes THIS process at THIS instant. A
  // mid-game crash/deploy/scale event elsewhere can still leave a playing
  // lobby with an expired turn and nobody watching. This periodic sweep
  // closes that steady-state window. .unref() so the timer never by itself
  // keeps the process (or a Jest worker) alive — see Phase 2 R3.
  const turnSweepInterval = setInterval(() => {
    gameLogic.sweepMissingTurnWatchdogs(io, pubClient)
      .then(n => { if (n > 0) logger.info(`Turn-watchdog sweep armed ${n} unwatched lobbies`); })
      .catch(err => logger.error(err, 'Periodic turn-watchdog sweep failed'));
  }, TURN_SWEEP_INTERVAL_MS);
  turnSweepInterval.unref();

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => logger.info(`Server listening on port ${PORT}`));
}

startApp();

// Graceful shutdown — close connections cleanly on deploy or Ctrl+C
function gracefulShutdown(signal) {
  logger.info(`${signal} received — shutting down`);
  server.close(() => {
    Promise.all([pubClient.quit(), subClient.quit()])
      .then(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      })
      .catch((err) => {
        logger.error(err, 'Error during shutdown');
        process.exit(1);
      });
  });
  // Force exit if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
