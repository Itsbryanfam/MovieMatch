// ============================================================================
// fallbackMovies.js — Phase 5b: read-once local movie DB for TMDB-outage
// resilience. Consulted ONLY by the failure branches of resolveCandidates and
// getOrFetchCredits. Leaf module (fs/path only) — safe to require top-level.
// ============================================================================
const fs = require('fs');
const path = require('path');

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
    if (Array.isArray(parsed)) all = parsed;
  } catch (err) {
    // Missing/corrupt → empty. Never throw: a broken fallback file must not
    // block boot or change healthy-path behavior.
    all = [];
  }
  const byId = new Map();
  for (const e of all) if (e && Number.isInteger(e.id)) byId.set(e.id, e);
  _cache = { byId, all };
  return _cache;
}

// Entry for a TMDB movie id (number-coerced), or null. Used by the
// getOrFetchCredits + resolveCandidates direct-ID failure branches.
function getFallbackById(id) {
  const n = Number(id);
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
