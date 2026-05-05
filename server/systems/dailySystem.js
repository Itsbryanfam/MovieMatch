// ============================================================================
// DAILY SYSTEM (H2) — One puzzle a day, async, shareable
// ============================================================================
// What this is:
//   - Deterministic seed selection: every player on a given UTC day starts
//     from the same "movie of the day."
//   - Per-player attempt records: one attempt per UTC day per stableId,
//     enforced by Redis SET NX on a date+id key.
//   - Daily leaderboard: a ZSET per day, scored by the player's chain
//     length, lazily pruned when stale name-lookups are missed.
//   - Puzzle numbering: Wordle-style "Daily #N" derived from a fixed
//     launch date so share cards stay stable across deploys.
//
// What this ISN'T:
//   - Multiplayer state. The Daily Challenge plays through the existing
//     solo/lobby plumbing — this module just supplies the seed and the
//     attempt-record bookkeeping.
//   - Movie validation logic. Reuses gameLogic.validateConnection and the
//     credits cache. We don't re-implement chain rules here.
// ============================================================================

const fs = require('fs');
const path = require('path');

// Wordle-style fixed launch date in UTC (YYYY-MM-DD). "Daily #1" is the
// puzzle generated for this date. Bump only if you intentionally want to
// renumber — the share-card text "Daily #N" has no other anchor and any
// change here will reset the count for everyone retroactively.
const LAUNCH_DATE_UTC = '2026-05-04';

// Daily attempt + leaderboard retention. 90 days lets returning players see
// their recent past results in stats screens; older runs age out so Redis
// doesn't grow unbounded. Per-day leaderboards live for the same window.
const DAILY_RETENTION_DAYS = 90;
const DAILY_RETENTION_SEC = DAILY_RETENTION_DAYS * 24 * 60 * 60;

// Lazy-load the curated starter list. fs.readFileSync at boot is fine
// because the file is tiny (<10KB) and the dev server restarts on edits;
// no need for a hot-reload mechanism.
let _movieList = null;
function _loadMovieList() {
  if (_movieList) return _movieList;
  try {
    const filePath = path.join(__dirname, '..', '..', 'data', 'dailyMovies.json');
    _movieList = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(_movieList) || _movieList.length === 0) {
      throw new Error('dailyMovies.json must be a non-empty array');
    }
  } catch (err) {
    // Fall back to a single hardcoded entry rather than throwing — the
    // server should still boot if the curated list is missing/corrupt,
    // and the player will at least get a valid puzzle.
    _movieList = [
      { id: 27205, title: 'Inception', year: 2010, mediaType: 'movie' },
    ];
  }
  return _movieList;
}

// ---------------------------------------------------------------------------
// DATE HELPERS
// ---------------------------------------------------------------------------

// UTC date as 'YYYY-MM-DD'. Using UTC means players in different time zones
// rotate to the new puzzle at the same moment globally — a common pattern
// for daily games. Local-time would split the leaderboard between time zones
// and create gaps where eastern players "see tomorrow's" before western ones.
function getTodayDate(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Whole UTC days between two YYYY-MM-DD strings (inclusive of start).
// Returns 1 when both dates are equal (so launch date = Daily #1, not #0).
function _dayDiff(fromYmd, toYmd) {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.floor((toMs - fromMs) / 86400000) + 1;
}

// "Daily #N" puzzle number for a date. Stays stable across deploys as long
// as LAUNCH_DATE_UTC doesn't change.
function getPuzzleNumber(date = getTodayDate()) {
  return Math.max(1, _dayDiff(LAUNCH_DATE_UTC, date));
}

// ---------------------------------------------------------------------------
// SEED PICKER
// ---------------------------------------------------------------------------

// Stable hash from a date string → 32-bit unsigned int. We avoid Math.random
// (non-deterministic) and avoid pulling in a hash library — the point is
// "same date everywhere = same movie", not cryptographic strength.
//
// FNV-1a 32-bit: simple, fast, good distribution for short strings, and
// trivially audited (no library opacity).
function _hashDate(dateStr) {
  let h = 2166136261; // FNV offset basis (32-bit)
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    // 32-bit FNV prime, applied with Math.imul to stay in Int32 range.
    h = Math.imul(h, 16777619);
  }
  // Convert to unsigned for the modulo step below.
  return h >>> 0;
}

// Pick today's seed movie deterministically. Same date globally returns the
// same entry; a different date returns a (likely) different entry. Bumping
// LAUNCH_DATE_UTC or editing dailyMovies.json reshuffles the schedule — be
// aware before changing.
function pickDailyMovie(date = getTodayDate()) {
  const list = _loadMovieList();
  const idx = _hashDate(date) % list.length;
  return { ...list[idx], date };
}

// ---------------------------------------------------------------------------
// ATTEMPT RECORDS (one per stableId per UTC day)
// ---------------------------------------------------------------------------

function _attemptKey(date, stableId) {
  return `daily:attempt:${date}:${stableId}`;
}
function _leaderboardKey(date) {
  return `daily:leaderboard:${date}`;
}

// Read the player's existing attempt for `date`, or null. Returned attempt
// has shape: { date, stableId, status: 'in_progress' | 'done',
//   chainLength, startedAt, endedAt? }
async function getDailyAttempt(pubClient, stableId, date = getTodayDate()) {
  if (!pubClient || !stableId) return null;
  try {
    const raw = await pubClient.get(_attemptKey(date, stableId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    // Treat corrupt blobs as "no attempt" — better to let the player play
    // than to surface a confusing error from a one-off Redis hiccup.
    return null;
  }
}

// Atomically claim the daily attempt slot. Returns:
//   { created: true, attempt }   if the player just opened today's puzzle
//   { created: false, attempt }  if they already have one in progress or done
//
// Implementation: SET NX EX so two concurrent clicks (e.g. a double-tap on
// the "Daily" button) can't both create simultaneous attempts that race
// each other to write a final result.
async function claimDailyAttempt(pubClient, stableId, name, date = getTodayDate()) {
  if (!pubClient || !stableId) return null;
  const seed = pickDailyMovie(date);
  const fresh = {
    date,
    stableId,
    name: typeof name === 'string' ? name.slice(0, 40) : '',
    status: 'in_progress',
    chainLength: 0,
    startedAt: Date.now(),
    seedMovieId: seed.id,
  };
  try {
    const result = await pubClient.set(
      _attemptKey(date, stableId),
      JSON.stringify(fresh),
      { NX: true, EX: DAILY_RETENTION_SEC }
    );
    if (result === 'OK') {
      return { created: true, attempt: fresh, seed };
    }
    // Existing attempt — fetch and return so the caller can show "you've
    // already played today" UX with the prior result.
    const existing = await getDailyAttempt(pubClient, stableId, date);
    return { created: false, attempt: existing, seed };
  } catch {
    return null;
  }
}

// Mark the attempt as done and record the chain length on the daily
// leaderboard ZSET. Idempotent — a re-call with the same chainLength just
// overwrites the same record.
async function finalizeDailyAttempt(pubClient, stableId, name, chainLength, date = getTodayDate()) {
  if (!pubClient || !stableId) return;
  try {
    const existing = await getDailyAttempt(pubClient, stableId, date);
    if (!existing) return; // never claimed — nothing to finalize
    const updated = {
      ...existing,
      status: 'done',
      chainLength: Math.max(0, chainLength | 0),
      endedAt: Date.now(),
      name: typeof name === 'string' && name ? name.slice(0, 40) : existing.name,
    };
    // Pipeline: write the attempt record, add/update the leaderboard ZSET,
    // refresh both expiries. multi() so a Redis blip can't leave the
    // leaderboard updated but the attempt record stale (or vice versa).
    await pubClient.multi()
      .set(_attemptKey(date, stableId), JSON.stringify(updated), { EX: DAILY_RETENTION_SEC })
      .zAdd(_leaderboardKey(date), { score: updated.chainLength, value: stableId })
      .expire(_leaderboardKey(date), DAILY_RETENTION_SEC)
      .exec();
  } catch {
    // Telemetry-style swallow: failing to record a daily result shouldn't
    // crash the game pipeline. The attempt key TTL ensures eventual cleanup.
  }
}

// Top-N for `date`. Returns [{ stableId, chainLength, name }] descending.
// Lazily fetches names from the existing leaderboard name cache (if any)
// or from the attempt records as a fallback. Capped at limit=20 by default
// to keep the response slim — the UI rarely shows more than top 10.
async function getDailyLeaderboard(pubClient, date = getTodayDate(), limit = 20) {
  if (!pubClient) return [];
  try {
    // REV: true → descending by score (longest chain first).
    const entries = await pubClient.zRangeWithScores(_leaderboardKey(date), 0, limit - 1, { REV: true });
    if (!entries || entries.length === 0) return [];

    // Pull each player's attempt record to get their name. Done in parallel
    // because per-key reads serialized would multiply latency on top-20.
    const records = await Promise.all(
      entries.map(e => getDailyAttempt(pubClient, e.value, date))
    );
    return entries.map((e, i) => ({
      stableId: e.value,
      chainLength: Math.floor(e.score),
      name: (records[i] && records[i].name) || 'Anonymous',
    }));
  } catch {
    return [];
  }
}

module.exports = {
  // Date helpers
  getTodayDate,
  getPuzzleNumber,
  // Seed
  pickDailyMovie,
  // Attempt records
  getDailyAttempt,
  claimDailyAttempt,
  finalizeDailyAttempt,
  // Leaderboard
  getDailyLeaderboard,
  // Constants (exported so tests can pin them and admin endpoints can show TTLs)
  LAUNCH_DATE_UTC,
  DAILY_RETENTION_DAYS,
};
