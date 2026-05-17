// Boot-time guard for the admin secret. Pure and standalone (NOT inlined in
// server.js) so it is unit-testable without importing server.js, which has
// boot side effects: Redis connect, port bind, and process.exit(1) on a
// missing TMDB token. Returns an error string when the secret is unusable,
// or null when acceptable.
//
// Two independent bars:
//  1. Length >= 32 — the documented floor in .env.example.
//  2. M2: at least 5 DISTINCT characters. Length alone let 'a'.repeat(32)
//     boot — long but trivially brute-forceable. Distinct-character count
//     (not a regex character-class rule) is used deliberately: a class rule
//     like "must contain a symbol" would reject the already-deployed valid
//     64-hex secret. A cryptographically random secret has well over 5
//     distinct characters with overwhelming probability, so there are no
//     false positives on real secrets. The two failures return DIFFERENT
//     messages so the fatal boot log says which bar failed.
function validateAdminSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    return 'ADMIN_SECRET must be set and at least 32 characters';
  }
  const distinct = new Set(secret).size;
  if (distinct < 5) {
    return 'ADMIN_SECRET is too weak (needs at least 5 distinct characters)';
  }
  return null; // null = acceptable
}

module.exports = validateAdminSecret;
