// build-daily-movies.js — ONE-TIME generator for data/dailyMovies.json.
// WHY: the Daily Challenge seed is list[hash(date) % list.length]; the id
// must be a real TMDB id with cast data or the puzzle is unsolvable. Hand-
// writing ~500 ids would inevitably hallucinate some. Sourcing them from
// TMDB's own top-rated/popular endpoints makes every id valid BY
// CONSTRUCTION. This script is run manually by a developer (npm run
// build:daily-movies); its output is committed. The server runtime is
// unchanged — dailySystem.js still does a static readFileSync.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Mirror server.js:250/265 exactly so this uses the same credentials the
// app already runs with — no new env var.
const TMDB_TOKEN = process.env.TMDB_READ_TOKEN;
if (!TMDB_TOKEN) {
  console.error('TMDB_READ_TOKEN missing — set it in .env (same token the server uses).');
  process.exit(1);
}
const TMDB_HEADERS = { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' };
const OUT = path.join(__dirname, '..', 'data', 'dailyMovies.json');
// 500 ≈ 16 months of non-repeating daily puzzles; pool grows on each regeneration
const TARGET = 500;

// Preserve the existing hand-curated entries: read whatever is there now and
// seed the map with it so a regeneration is purely additive to the favorites.
function loadExisting() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return []; }
}

async function fetchPage(kind, page) {
  // en-US: English titles match the game's UI/search; other locales return translated titles that wouldn't match player input
  const url = `https://api.themoviedb.org/3/movie/${kind}?language=en-US&page=${page}`;
  const res = await fetch(url, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`TMDB ${kind} p${page} → HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.results) ? json.results : [];
}

function toEntry(r) {
  // TMDB movie result → our shape. Skip entries we can't make a valid year
  // for (the data test would reject them anyway).
  const year = parseInt(String(r.release_date || '').slice(0, 4), 10);
  if (!r.id || !r.title || !Number.isInteger(year)) return null;
  return { id: r.id, title: r.title, year, mediaType: 'movie' };
}

(async () => {
  const byId = new Map();
  for (const m of loadExisting()) if (m && m.id) byId.set(m.id, m);

  // top_rated first (curated quality), then popular as a backfill, until we
  // clear TARGET unique. ~30 pages * 20 = 600 raw before dedupe/skips.
  outer: for (const kind of ['top_rated', 'popular']) {
    for (let page = 1; page <= 30 && byId.size < TARGET + 40; page++) {
      let results;
      try { results = await fetchPage(kind, page); }
      catch (e) { console.warn(String(e.message || e)); continue; }
      if (results.length === 0) break;
      for (const r of results) {
        const e = toEntry(r);
        if (e && !byId.has(e.id)) byId.set(e.id, e);
      }
      // explicit early exit; the inner-loop size guard also stops here — kept for clarity
      if (byId.size >= TARGET + 40 && kind === 'popular') break outer;
    }
  }

  // sort by id so re-runs are byte-stable (git diff stays clean on regeneration)
  const list = [...byId.values()].sort((a, b) => a.id - b.id);
  if (list.length < TARGET) {
    console.error(`Only collected ${list.length} (< ${TARGET}). TMDB may be rate-limiting; re-run.`);
    process.exit(1);
  }
  fs.writeFileSync(OUT, JSON.stringify(list, null, 2) + '\n');
  console.log(`Wrote ${list.length} entries to ${OUT}`);
})();
