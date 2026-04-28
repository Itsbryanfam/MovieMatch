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
const server = http.createServer(app);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));

const limiter = rateLimit({
  windowMs: 60000,
  max: 120,
  skip: (req) => req.path.startsWith('/socket.io/') || req.path.startsWith('/static/')
});
app.use(limiter);

app.use(express.static('public'));

const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => logger.error(err, 'Redis Pub Client Error'));
subClient.on('error', (err) => logger.error(err, 'Redis Sub Client Error'));

const TMDB_TOKEN = process.env.TMDB_READ_TOKEN;
const TMDB_HEADERS = { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' };

let io;
let cachedPosters = [];

async function fetchBackgroundPosters() {
  try {
    const res1 = await fetch(`https://api.themoviedb.org/3/movie/popular?language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
    const data1 = await res1.json();
    const res2 = await fetch(`https://api.themoviedb.org/3/movie/top_rated?language=en-US&page=1`, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) });
    const data2 = await res2.json();
    
    const combined = [...(data1.results || []), ...(data2.results || [])];
    cachedPosters = combined.filter(m => m.poster_path).map(m => `https://image.tmdb.org/t/p/w200${m.poster_path}`);
    cachedPosters.sort(() => 0.5 - Math.random());
  } catch (err) {
    logger.error(err, 'Failed to fetch background posters');
  }
}

const { setupSocketHandlers } = require('./server/socketHandlers');

async function startApp() {
  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    console.log('Redis connected');
    setInterval(fetchBackgroundPosters, 30 * 60 * 1000);
  } catch (err) {
    console.error("FAIL", err);
  }

  io = new Server(server, { 
    adapter: createAdapter(pubClient, subClient),
    cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000' }
  });

  setupSocketHandlers(io, pubClient, cachedPosters);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}

fetchBackgroundPosters();
startApp();
