// server/systems/titlesSystem.js — Phase 6b equipped-title persistence.
// The equipped title is stored at a SIBLING key title:{stableId} (STRING,
// 90-day TTL), NOT as a field on stats:{stableId}: statsSystem._reconstruct
// drops non-numeric HASH fields and statsSystem.js is sacrosanct, so a string
// would be silently lost there. A sibling key mirrors the existing
// stats:connectors:{stableId} precedent and keeps statsSystem.js byte-untouched.
// Anonymous: title:{stableId} reuses the same stableId keyspace + TTL — no new
// accounts, no new persistence model.

const TITLE_RETENTION_DAYS = 90;
const TITLE_RETENTION_SEC = TITLE_RETENTION_DAYS * 24 * 60 * 60;

function _titleKey(stableId) { return `title:${stableId}`; }

// Read the equipped title id, or null. Best-effort: a Redis blip or unset key
// yields null (the player simply shows no title — graceful).
async function getEquippedTitle(pubClient, stableId) {
  if (!pubClient || !stableId) return null;
  try {
    const v = await pubClient.get(_titleKey(stableId));
    return (typeof v === 'string' && v.length > 0) ? v : null;
  } catch {
    return null;
  }
}

// Persist the equipped title id — ONLY if titleId is in the caller-supplied
// earnedSet (defense at the persistence boundary; the client only ever offers
// earned titles, so this is pure defense). Unknown/unearned → no-op. Swallows
// Redis errors so an equip never throws to the socket layer.
async function setEquippedTitle(pubClient, stableId, titleId, earnedSet) {
  if (!pubClient || !stableId || !titleId) return;
  const earned = Array.isArray(earnedSet) ? earnedSet : [];
  if (!earned.includes(titleId)) return; // not earned → refuse to persist
  try {
    await pubClient.set(_titleKey(stableId), titleId, { EX: TITLE_RETENTION_SEC });
  } catch {
    // Cosmetic write — a Redis blip just means the title didn't stick.
  }
}

module.exports = { getEquippedTitle, setEquippedTitle, TITLE_RETENTION_DAYS };
