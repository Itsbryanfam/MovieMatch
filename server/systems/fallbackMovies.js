// ============================================================================
// fallbackMovies.js — Phase 5b: read-once local movie DB for TMDB-outage
// resilience. Consulted ONLY by the failure branches of resolveCandidates and
// getOrFetchCredits. Leaf module (fs/path only) — safe to require top-level.
// ============================================================================
const fs = require('fs');
const path = require('path');

// T4e audit fix: lazy-memoized pino logger (same pattern + rationale as
// botSystem._getLogger / redisUtils._getLogger). WHY lazy: _load runs at first
// fallback consultation and several unit tests drive this module directly;
// instantiating pino at module-load would add a side-effect to every such
// require. Memoized so repeated loads reuse one instance with stable pid.
let _logger = null;
function _getLogger() {
  if (!_logger) _logger = require('pino')();
  return _logger;
}

// T4e: a "healthy" fallback DB is committed at ~900+ entries (pinned by
// fallbackMovies.data.test.js: >= 900). If a load returns far fewer than that
// it's almost certainly a truncated/partially-written file or a generator
// regression — and a silently-degraded fallback is WORSE than none, because
// it's the layer that prevents wrongful eliminations during a TMDB outage.
// Threshold ~25% of the committed floor (900) → 200: low enough that the real
// dataset never trips it, high enough to catch a near-empty/truncated load.
const FALLBACK_MIN_HEALTHY_COUNT = 200;

// Lazy-load + cache. Static readFileSync is fine here for the same reason
// dailySystem's is: a one-time synchronous boot-ish read of a static file,
// never a hot path (the fallback is only hit on a TMDB failure). UNLIKE
// dailySystem we do NOT hardcode a stand-in on failure — an empty DB simply
// means "fallback never matches", which is exactly today's behavior.
let _cache = null; // { byId: Map<number,entry>, all: entry[] }
function _load() {
  if (_cache) return _cache;
  let all = [];
  try {
    const filePath = path.join(__dirname, '..', '..', 'data', 'fallbackMovies.json');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) {
      all = parsed;
    } else {
      // Valid JSON but not an array — the file exists but its shape is wrong
      // (generator wrote an object, manual edit clobbered the top level, etc).
      // Loud + empty, same as a parse failure: a malformed resilience DB must
      // not silently masquerade as a working one.
      _getLogger().error(
        { type: typeof parsed },
        'fallbackMovies.json is not an array — fallback DB EMPTY; TMDB-outage resilience degraded'
      );
      all = [];
    }
  } catch (err) {
    // T4e audit fix: previously this catch SILENTLY set all = [] — a
    // missing/corrupt file turned the entire TMDB-outage resilience layer into
    // an empty DB with zero operator signal, so during the very outage it's
    // meant to cover, players would be wrongly eliminated on correct moves with
    // nothing in the logs to explain it. Log LOUDLY (error) so the degradation
    // is visible, then still boot empty (never throw — a broken fallback file
    // must not block startup or change healthy-path behavior).
    _getLogger().error(err, 'failed to read/parse fallbackMovies.json — fallback DB EMPTY; TMDB-outage resilience degraded');
    all = [];
  }

  // T4e: even on a successful parse, warn when the count is suspiciously low —
  // a truncated/half-written file can parse as a valid-but-tiny array, which
  // the catch above never sees. Skips the warn for a legitimately empty array
  // already reported as an error above? No: an empty array reaches here as a
  // successful-parse 0-length result, so this single check covers both the
  // "tiny" and "empty-but-parsed" degraded shapes with one loud warning.
  if (all.length < FALLBACK_MIN_HEALTHY_COUNT) {
    _getLogger().warn(
      { loaded: all.length, expectedAtLeast: FALLBACK_MIN_HEALTHY_COUNT },
      'fallbackMovies.json loaded suspiciously few entries — fallback DB likely truncated/corrupt; TMDB-outage resilience degraded'
    );
  }
  const byId = new Map();
  // Index by id, skipping entries with a missing/non-integer id: TMDB ids are
  // always positive integers, so a non-integer id means corrupt data that
  // must not be indexed (a bad entry could otherwise be returned mid-outage).
  for (const e of all) if (e && Number.isInteger(e.id)) byId.set(e.id, e);
  _cache = { byId, all };
  return _cache;
}

// Entry for a TMDB movie id (number-coerced), or null. Used by the
// getOrFetchCredits + resolveCandidates direct-ID failure branches.
function getFallbackById(id) {
  // Coerce: callers (the Tasks 2/3 failure branches) may pass an id as a
  // string (e.g. from a TMDB url segment) — accept those.
  const n = Number(id);
  // Reject NaN/floats/non-integers: only a true integer TMDB id can match,
  // and a silent cache miss on a bad input would be hard to diagnose.
  if (!Number.isInteger(n)) return null;
  return _load().byId.get(n) || null;
}

// The full entry array — the resolveCandidates fuzzy failure branch ranks
// these by title with matchSystem's own levenshtein (kept there, not exported
// here, so title-matching stays co-located with the existing fuzzy logic).
function allFallback() {
  return _load().all;
}

module.exports = { getFallbackById, allFallback };
