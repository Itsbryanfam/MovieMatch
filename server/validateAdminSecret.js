// Boot-time guard for the admin secret. Pure and standalone (NOT inlined in
// server.js) so it is unit-testable without importing server.js, which has
// boot side effects: Redis connect, port bind, and process.exit(1) on a
// missing TMDB token. Returns an error string when the secret is unusable,
// or null when acceptable. 32-char minimum is the documented floor in
// .env.example — shorter secrets are brute-forceable even behind the
// dedicated admin rate limiter.
function validateAdminSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    return 'ADMIN_SECRET must be set and at least 32 characters';
  }
  return null; // null = acceptable
}

module.exports = validateAdminSecret;
