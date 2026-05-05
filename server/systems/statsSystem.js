// ============================================================================
// STATS SYSTEM (H5) — Per-player lifetime stats: games, wins, longest chain,
// favorite connector. Lowest-effort retention multiplier in any trivia game.
// ============================================================================
// Schema
//   stats:{stableId}              HASH  flat keys, dotted for nesting:
//                                       gamesPlayed                 INT
//                                       wins                        INT
//                                       longestChain                INT  (max across all modes)
//                                       totalPlays                  INT  (chain links the player contributed)
//                                       byMode.{mode}.played        INT
//                                       byMode.{mode}.won           INT
//                                       byMode.{mode}.longestChain  INT
//                                       lastUpdatedMs               INT  (Date.now() of last write)
//   stats:connectors:{stableId}   HASH  actorName → count           used to compute favoriteConnector
//
// Why flat HASH with dotted keys instead of a JSON blob:
//   - HINCRBY is atomic, so concurrent increments (player on multiple
//     devices, or a watchdog firing at the same time as commit) can't lose
//     updates. JSON blobs would need read-modify-write.
//   - HGETALL is one Redis round-trip and reconstructs to nested JSON
//     cheaply on the read side.
//
// Retention: 90 days. Longer than wins (30d) and telemetry (30d) because
// these are sentimental for the player — losing your "longest chain" PB
// because you stopped playing for a month would feel worse than losing a
// metric you never knew about.
// ============================================================================

const STATS_RETENTION_DAYS = 90;
const STATS_RETENTION_SEC = STATS_RETENTION_DAYS * 24 * 60 * 60;

// Keep "favorite connector" top-N tracking bounded so a player who's
// played 1000 games doesn't grow this hash unboundedly. With ~30 cast
// per movie and ~10 plays per game, a 90-day cap of ~10k connectors per
// active player is plausible — well within Redis hash limits but worth
// a soft cap in case a bug ever causes excessive writes.
const MAX_CONNECTOR_ENTRIES = 1000;

// Modes we bucket separately. Not enforced (any string passed in is
// stored), but documented here so the client UI knows what to display.
const TRACKED_MODES = ['classic', 'team', 'solo', 'speed', 'daily'];

function _statsKey(stableId) { return `stats:${stableId}`; }
function _connectorsKey(stableId) { return `stats:connectors:${stableId}`; }

// ---------------------------------------------------------------------------
// WRITE PATHS — fire-and-forget; never throw to caller
// ---------------------------------------------------------------------------

/**
 * Record that a player started a game. Increments gamesPlayed + per-mode
 * played counter. Called once per player per game in gameLogic.startGame.
 */
async function recordGamePlayed(pubClient, stableId, mode) {
  if (!pubClient || !stableId) return;
  const safeMode = TRACKED_MODES.includes(mode) ? mode : 'classic';
  try {
    await pubClient.multi()
      .hIncrBy(_statsKey(stableId), 'gamesPlayed', 1)
      .hIncrBy(_statsKey(stableId), `byMode.${safeMode}.played`, 1)
      .hSet(_statsKey(stableId), 'lastUpdatedMs', String(Date.now()))
      .expire(_statsKey(stableId), STATS_RETENTION_SEC)
      .exec();
  } catch {
    // Stats must never crash gameplay — a Redis blip during recordGamePlayed
    // results in an off-by-one stat the next time the player views their
    // dashboard. That's acceptable; throwing here would crash startGame.
  }
}

/**
 * Record a win. Increments wins + per-mode won. Updates longestChain
 * (overall and per-mode) if the new chain length exceeds the current max.
 */
async function recordGameWon(pubClient, stableId, mode, chainLength) {
  if (!pubClient || !stableId) return;
  const safeMode = TRACKED_MODES.includes(mode) ? mode : 'classic';
  try {
    await pubClient.multi()
      .hIncrBy(_statsKey(stableId), 'wins', 1)
      .hIncrBy(_statsKey(stableId), `byMode.${safeMode}.won`, 1)
      .hSet(_statsKey(stableId), 'lastUpdatedMs', String(Date.now()))
      .expire(_statsKey(stableId), STATS_RETENTION_SEC)
      .exec();

    // Conditional max for longestChain. Read-compare-write is non-atomic
    // but the race window is tiny (single player updating own stats) and
    // a lost update only means the displayed "longest chain" is briefly
    // stale — not a gameplay correctness issue.
    if (typeof chainLength === 'number' && chainLength > 0) {
      await _setIfGreater(pubClient, _statsKey(stableId), 'longestChain', chainLength);
      await _setIfGreater(pubClient, _statsKey(stableId), `byMode.${safeMode}.longestChain`, chainLength);
    }
  } catch {}
}

/**
 * Record a successful play (one chain link contributed by this player).
 * Increments totalPlays and bumps the favorite-connector hash.
 *
 * @param matchedActors Array of actor names (strings). Empty for the first
 *                      move in a chain (no connector). Multiple entries
 *                      possible if several actors connected simultaneously.
 */
async function recordPlay(pubClient, stableId, matchedActors) {
  if (!pubClient || !stableId) return;
  try {
    await pubClient.multi()
      .hIncrBy(_statsKey(stableId), 'totalPlays', 1)
      .hSet(_statsKey(stableId), 'lastUpdatedMs', String(Date.now()))
      .expire(_statsKey(stableId), STATS_RETENTION_SEC)
      .exec();

    // Track each connecting actor for the favoriteConnector readout.
    // Use a separate hash so the main stats blob stays small and easy to
    // HGETALL-and-render.
    if (Array.isArray(matchedActors) && matchedActors.length > 0) {
      const ops = pubClient.multi();
      let added = 0;
      for (const actor of matchedActors) {
        if (typeof actor !== 'string' || !actor) continue;
        // Cap at MAX_CONNECTOR_ENTRIES to bound the hash size. We don't
        // actually enforce the cap atomically (would require a Lua script);
        // instead we count opportunistically and stop adding when over.
        // Worst case: a few extra entries past the cap on a hot night —
        // not worth the complexity of a hard guard.
        const trimmed = actor.length > 64 ? actor.slice(0, 64) : actor;
        ops.hIncrBy(_connectorsKey(stableId), trimmed, 1);
        added++;
        if (added >= 10) break; // sanity per-call cap so a corrupt array can't pile on
      }
      ops.expire(_connectorsKey(stableId), STATS_RETENTION_SEC);
      await ops.exec();
    }
  } catch {}
}

// Conditional max: HSET only if the new value is strictly greater than
// the existing one. Read-compare-write — see recordGameWon for the
// race-tolerance rationale.
async function _setIfGreater(pubClient, key, field, value) {
  const current = await pubClient.hGet(key, field);
  const cur = current ? parseInt(current, 10) : 0;
  if (Number.isFinite(value) && value > cur) {
    await pubClient.hSet(key, field, String(value));
  }
}

// ---------------------------------------------------------------------------
// READ PATH — assembles the full stats payload for the client
// ---------------------------------------------------------------------------

/**
 * Fetch and reconstruct the player's stats. Returns a fully-shaped object
 * with all known fields (defaulted to 0/null when unset) so the client UI
 * can render confidently without null-checking every field.
 */
async function getStats(pubClient, stableId) {
  if (!pubClient || !stableId) return _emptyStats();
  try {
    const [flat, connectors] = await Promise.all([
      pubClient.hGetAll(_statsKey(stableId)),
      pubClient.hGetAll(_connectorsKey(stableId)),
    ]);
    return _reconstruct(flat, connectors);
  } catch {
    return _emptyStats();
  }
}

function _emptyStats() {
  const byMode = {};
  TRACKED_MODES.forEach(m => {
    byMode[m] = { played: 0, won: 0, longestChain: 0 };
  });
  return {
    gamesPlayed: 0,
    wins: 0,
    longestChain: 0,
    totalPlays: 0,
    byMode,
    favoriteConnector: null,
    lastUpdatedMs: null,
  };
}

// Convert the flat hash back into the nested shape. Dotted keys
// (`byMode.classic.won`) become nested objects; numeric strings parse to
// numbers. Unknown fields are ignored — defensive against schema drift
// (e.g. a future field added then rolled back leaves leftover keys in
// existing player records).
function _reconstruct(flat, connectors) {
  const out = _emptyStats();
  if (!flat || typeof flat !== 'object') return _withFavorite(out, connectors);

  for (const [k, v] of Object.entries(flat)) {
    const num = parseInt(v, 10);
    if (!Number.isFinite(num)) continue;
    if (k === 'gamesPlayed') out.gamesPlayed = num;
    else if (k === 'wins') out.wins = num;
    else if (k === 'longestChain') out.longestChain = num;
    else if (k === 'totalPlays') out.totalPlays = num;
    else if (k === 'lastUpdatedMs') out.lastUpdatedMs = num;
    else if (k.startsWith('byMode.')) {
      // byMode.{mode}.{field} — split conservatively in case mode names
      // ever contain dots (they shouldn't, but defensive).
      const parts = k.split('.');
      if (parts.length === 3) {
        const mode = parts[1];
        const field = parts[2];
        if (!out.byMode[mode]) out.byMode[mode] = { played: 0, won: 0, longestChain: 0 };
        if (['played', 'won', 'longestChain'].includes(field)) {
          out.byMode[mode][field] = num;
        }
      }
    }
  }

  return _withFavorite(out, connectors);
}

function _withFavorite(stats, connectors) {
  if (!connectors || typeof connectors !== 'object') return stats;
  let topName = null;
  let topCount = 0;
  for (const [name, raw] of Object.entries(connectors)) {
    const c = parseInt(raw, 10);
    if (!Number.isFinite(c)) continue;
    if (c > topCount) {
      topCount = c;
      topName = name;
    }
  }
  stats.favoriteConnector = topName ? { name: topName, count: topCount } : null;
  return stats;
}

module.exports = {
  recordGamePlayed,
  recordGameWon,
  recordPlay,
  getStats,
  TRACKED_MODES,
  STATS_RETENTION_DAYS,
};
