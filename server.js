require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pino = require('pino');

const logger = pino();
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
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

app.post('/api/admin/flush-credits', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
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
  if (secret !== process.env.ADMIN_SECRET) {
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

app.get('/api/leaderboard', async (req, res) => {
  try {
    const entries = await redisUtils.getLeaderboard(pubClient);
    res.json(entries);
  } catch (err) {
    logger.error(err, 'Failed to fetch leaderboard');
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => logger.error(err, 'Redis Pub Client Error'));
subClient.on('error', (err) => logger.error(err, 'Redis Sub Client Error'));

const TMDB_TOKEN = process.env.TMDB_READ_TOKEN;
if (!TMDB_TOKEN) {
  logger.fatal('TMDB_READ_TOKEN environment variable is required. Set it in your .env file.');
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
    posters.sort(() => 0.5 - Math.random());
    
    posterCache.setPosters(posters);

    if (io) io.emit('posters', posters);
  } catch (err) {
    logger.error(err, 'Failed to fetch background posters');
  }
}

const { setupSocketHandlers } = require('./server/socketHandlers');
const redisUtils = require('./server/redisUtils');
const posterCache = require('./server/posterCache');

async function startApp() {
  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    logger.info('Redis connected');
    setInterval(fetchBackgroundPosters, 30 * 60 * 1000);
  } catch (err) {
    logger.error(err, 'Redis connection failed');
  }

  io = new Server(server, { 
    adapter: createAdapter(pubClient, subClient),
    cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000' }
  });

  setupSocketHandlers(io, pubClient, TMDB_HEADERS);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => logger.info(`Server listening on port ${PORT}`));
}

fetchBackgroundPosters();
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
