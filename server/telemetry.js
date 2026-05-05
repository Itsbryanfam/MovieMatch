// ============================================================================
// TELEMETRY (H6) — Minimal, self-hosted event tracking for product decisions
// ============================================================================
// What this is:
//   - A fire-and-forget `track(event, props)` helper that appends events to
//     Redis sorted sets keyed by event type, scored by Unix timestamp.
//   - A `getEvents` reader for time-windowed queries.
//   - A `getSummary` aggregator for the admin /api/admin/stats endpoint.
//
// Why not Sentry / DataDog / PostHog:
//   - The plan called for "just enough telemetry" without taking a third-party
//     dependency. Redis is already a load-bearing piece of the stack, so
//     reusing it as the sink keeps ops surface area unchanged.
//   - Redis sorted sets give us cheap time-range queries (ZRANGEBYSCORE) and
//     atomic inserts in a single primitive.
//
// Data hygiene:
//   - track() filters props to primitive values only. Strings clamped at 100
//     chars. This makes accidentally leaking PII (player name, raw input) or
//     large blobs much harder — callers can pass extra fields without
//     auditing each call site.
//   - No IP collection; no player names. stableId is OK to include since it
//     is anonymous and already used as the canonical identity throughout.
//
// Failure model:
//   - track() swallows all errors. Telemetry MUST NOT crash the caller — a
//     Redis blip during an event write should not bubble into a game pipeline.
// ============================================================================

const TEL_RETENTION_DAYS = 30;
const TEL_RETENTION_MS = TEL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const TEL_KEY_PREFIX = 'tel:event:';
const TEL_INDEX_KEY = 'tel:eventTypes'; // SET of all event-type names ever seen
const MAX_STRING_LEN = 100;

function eventKey(event) {
  return TEL_KEY_PREFIX + event;
}

// Whitelist of allowed event-type names — prevents a typo (or a malicious
// caller) from spawning unbounded ZSETs and bloating Redis. Add new types
// here and at the call site simultaneously so regression is detected.
const KNOWN_EVENTS = new Set([
  'lobby_created',
  'game_started',
  'submit_success',
  'submit_rejected',
  'eliminated',
  'game_won',
  'quit_game',
  // Reserved for Week 3 (H2 Daily Challenge) and Week 4 (H5 stats) work —
  // the call sites don't exist yet but the names are reserved so the admin
  // endpoint enumerates them as soon as they start firing.
  'daily_played',
  'share_clicked',
]);

// Sanitize props to primitive values only and clamp string length. The
// shape of the returned object is what gets serialized into Redis, so this
// is also the natural place to enforce the "no PII / no large blobs" rule.
function _sanitize(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    const t = typeof v;
    if (t === 'string') {
      out[k] = v.length > MAX_STRING_LEN ? v.slice(0, MAX_STRING_LEN) : v;
    } else if (t === 'number' || t === 'boolean') {
      out[k] = v;
    }
    // Everything else (objects, arrays, functions) is dropped silently —
    // callers shouldn't pass them, but if they do, we don't want to write
    // structures we can't easily query later.
  }
  return out;
}

/**
 * Record a telemetry event. Fire-and-forget — never throws or rejects.
 *
 * @param {object} pubClient - Redis client
 * @param {string} event     - Event type name (must be in KNOWN_EVENTS)
 * @param {object} [props]   - Primitive-only props ({ mode, playerCount, ... })
 */
async function track(pubClient, event, props = {}) {
  if (!pubClient || typeof event !== 'string' || !event) return;
  if (!KNOWN_EVENTS.has(event)) {
    // Silently drop unknown events. Logging here would be noisy in tests
    // and the "must not crash caller" contract precludes throwing.
    return;
  }
  try {
    const now = Date.now();
    // Random nonce ensures member uniqueness in the ZSET when multiple
    // events fire in the same millisecond — the ZADD would otherwise dedupe
    // them as the same member string.
    const n = Math.random().toString(36).slice(2, 10);
    const blob = JSON.stringify({ t: now, n, ...(_sanitize(props)) });
    const cutoff = now - TEL_RETENTION_MS;
    // Lazy retention prune on every track call — cheap (only touches the
    // tail of the ZSET) and saves us a separate cleanup job.
    // sAdd registers the event type so the admin /summary endpoint can
    // enumerate whatever has actually been emitted, not just what we hardcode.
    await pubClient.multi()
      .zAdd(eventKey(event), { score: now, value: blob })
      .zRemRangeByScore(eventKey(event), 0, cutoff)
      .sAdd(TEL_INDEX_KEY, event)
      .exec();
  } catch {
    // Telemetry failure must never affect game logic.
  }
}

/**
 * Fetch events of a given type within the last `windowMs`. Returns oldest
 * first. Each entry is the decoded JSON blob ({t, n, ...props}).
 */
async function getEvents(pubClient, event, windowMs) {
  if (!pubClient || !event || typeof windowMs !== 'number') return [];
  try {
    const cutoff = Date.now() - windowMs;
    const blobs = await pubClient.zRangeByScore(eventKey(event), cutoff, '+inf');
    const events = [];
    for (const blob of blobs) {
      try { events.push(JSON.parse(blob)); } catch { /* skip malformed */ }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * Aggregate event counts across all known event types within the last
 * `windowMs`. Returns { eventType: count } for every type that has at
 * least one entry in range. Used by the admin /api/admin/stats endpoint.
 *
 * Implementation: ZCOUNT per type (one Redis call per type, but each is
 * O(log N)). For our scale (~10 event types, ~10k events/day each) the
 * overhead is negligible; if it ever matters we can pipeline.
 */
async function getSummary(pubClient, windowMs) {
  if (!pubClient || typeof windowMs !== 'number') return {};
  try {
    const cutoff = Date.now() - windowMs;
    // Pull the live set of event types from Redis so newly-added types
    // (added via track) show up automatically without a config change.
    let types = [];
    try {
      types = await pubClient.sMembers(TEL_INDEX_KEY);
    } catch {
      types = [];
    }
    // Fall back to the hardcoded whitelist when the index is empty (e.g.
    // first run after deploy, before any events have fired).
    if (!types || types.length === 0) {
      types = Array.from(KNOWN_EVENTS);
    }
    const result = {};
    await Promise.all(types.map(async (event) => {
      try {
        const count = await pubClient.zCount(eventKey(event), cutoff, '+inf');
        if (count > 0) result[event] = count;
      } catch {
        // Skip this event type silently if Redis hiccups on a single key.
      }
    }));
    return result;
  } catch {
    return {};
  }
}

module.exports = {
  track,
  getEvents,
  getSummary,
  KNOWN_EVENTS,
  TEL_RETENTION_DAYS,
};
