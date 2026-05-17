// build-fallback-movies.js — ONE-TIME generator for data/fallbackMovies.json.
// WHY: a TMDB outage on an uncached title currently ELIMINATES the active
// player (resolveCandidates' fetch fails before credits even run). The runtime
// fallback needs, per movie, its title/year AND cast — sourced from TMDB so
// every id+cast is valid BY CONSTRUCTION (hand-writing ~1000 movies' casts
// would inevitably hallucinate). Run manually (npm run build:fallback-movies);
// the output is committed. The server runtime never runs this — it does a
// static read via server/systems/fallbackMovies.js.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Mirror server.js / build-daily-movies.js exactly — same credentials the app
// already runs with, no new env var.
const TMDB_TOKEN = process.env.TMDB_READ_TOKEN;
if (!TMDB_TOKEN) {
  console.error('TMDB_READ_TOKEN missing — set it in .env (same token the server uses).');
  process.exit(1);
}
const TMDB_HEADERS = { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' };
const OUT = path.join(__dirname, '..', 'data', 'fallbackMovies.json');
const DAILY = path.join(__dirname, '..', 'data', 'dailyMovies.json');
// ~1000 ≈ broad common-movie coverage; the fallback is failure-only so this is
// "the universe a TMDB outage must not break", not "every movie".
const TARGET = 1000;
// Cast cap: validation only needs shared-actor detection and commitPlay trims
// displayed cast to 30 — top 20 billed keeps the committed file ~1MB.
const CAST_CAP = 20;
const SLEEP_MS = 60; // gentle pacing so ~1000 credits calls don't rate-limit

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadDailyIdsAndEntries() {
  // The 553 daily ids MUST all be present (they are exactly the "common
  // movies players actually encounter"); seed the map with their {id,title,
  // year} so we never need a per-movie details call for them.
  try {
    const arr = JSON.parse(fs.readFileSync(DAILY, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function fetchListPage(kind, page) {
  // List endpoints already return id+title+release_date — using them avoids a
  // per-movie /movie/{id} details call (only credits needs a per-id fetch).
  const url = `https://api.themoviedb.org/3/movie/${kind}?language=en-US&page=${page}`;
  const res = await fetch(url, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`TMDB ${kind} p${page} → HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.results) ? json.results : [];
}

function listResultToBase(r) {
  // TMDB list result → our base shape. Drop entries with no parseable year
  // here rather than emit year:NaN — the data test would reject them and a
  // runtime fallback lookup on a NaN-year entry would be worse than absence.
  const year = parseInt(String(r.release_date || '').slice(0, 4), 10);
  if (!r.id || !r.title || !Number.isInteger(year)) return null;
  return { id: r.id, title: r.title, year, mediaType: 'movie' };
}

async function fetchCast(id) {
  // The single per-movie call. Strip to the exact shape getOrFetchCredits
  // returns ({cast:[{id,name}]}) so the runtime fallback is drop-in.
  const url = `https://api.themoviedb.org/3/movie/${id}/credits?language=en-US`;
  const res = await fetch(url, { headers: TMDB_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`credits ${id} → HTTP ${res.status}`);
  const json = await res.json();
  return (json.cast || [])
    .filter(a => a && a.name && Number.isInteger(a.id))
    .slice(0, CAST_CAP)
    .map(a => ({ id: a.id, name: a.name }));
}

(async () => {
  // 1) Gather base {id,title,year} for the curated set: daily entries first
  //    (guaranteed present), then top_rated/popular list pages until TARGET.
  const base = new Map(); // id -> {id,title,year,mediaType}
  for (const d of loadDailyIdsAndEntries()) {
    if (d && d.id) base.set(d.id, { id: d.id, title: d.title, year: d.year, mediaType: 'movie' });
  }
  outer: for (const kind of ['top_rated', 'popular']) {
    for (let page = 1; page <= 60 && base.size < TARGET + 60; page++) {
      let results;
      try { results = await fetchListPage(kind, page); }
      catch (e) { console.warn(String(e.message || e)); continue; }
      if (results.length === 0) break;
      for (const r of results) {
        const b = listResultToBase(r);
        if (b && !base.has(b.id)) base.set(b.id, b);
      }
      // explicit early exit; the inner-loop guard (base.size < TARGET+60) also
      // stops here — kept for clarity, and the popular-only gate means
      // top_rated always fully contributes before popular backfills.
      if (base.size >= TARGET + 60 && kind === 'popular') break outer;
      await sleep(SLEEP_MS);
    }
  }

  // 2) Fetch cast per id. Skip (don't emit) any movie whose credits fail or
  //    are empty — a cast-less fallback entry can never validate a connection.
  const out = [];
  let done = 0;
  for (const b of base.values()) {
    try {
      const cast = await fetchCast(b.id);
      if (cast.length > 0) out.push({ ...b, cast });
    } catch (e) {
      console.warn(`skip ${b.id}: ${e.message || e}`);
    }
    if (++done % 50 === 0) console.log(`credits ${done}/${base.size} … kept ${out.length}`);
    await sleep(SLEEP_MS);
  }

  out.sort((a, b) => a.id - b.id);
  if (out.length < TARGET - 50) {
    // Hard stop rather than committing a thin file — surfaces as a BLOCKER.
    console.error(`Only ${out.length} entries with cast (< ${TARGET - 50}). TMDB likely rate-limiting; re-run.`);
    process.exit(1);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${out.length} entries to ${OUT}`);
})();
