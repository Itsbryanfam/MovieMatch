// ============================================================================
// T3a audit fix (P2) — client IP derivation for the socket layer
// ============================================================================
// WHY a dedicated leaf module: the same derivation is needed in two places —
// socketHandlers' connection handler (per-IP rate-limit buckets, T3b) and
// server.js's io.use() connection throttle (T3c). Both see a socket.io
// `handshake`; sharing one helper guarantees they can never disagree about
// which IP a request "is", and keeps server.js (which boots Redis/ports and
// is untestable by design) free of logic that needs unit coverage.
//
// TRUST MODEL (why rightmost-XFF-wins): the app runs on Render behind exactly
// one proxy hop. Render's proxy APPENDS the real client IP as the LAST entry
// of x-forwarded-for; any entries further LEFT arrived in the client's own
// request headers and are attacker-controlled — a spoofer can prepend
// arbitrary values but can never control the rightmost slot. Taking the
// rightmost entry mirrors Express `trust proxy: 1` semantics (server.js:61),
// so the socket layer and the Express layer resolve the SAME IP for the same
// client — one consistent identity across HTTP and websocket rate limiting.

/**
 * Derive the trustworthy client IP from a socket.io handshake.
 * Rightmost x-forwarded-for entry (split on comma, trimmed) when present;
 * otherwise the socket's raw remote address.
 */
function deriveClientIp(handshake) {
  // Optional-chaining-free guards: this runs on EVERY connection, including
  // any malformed/exotic handshake — it must never throw (a throw here would
  // reject the connection for a parsing nit, the opposite of fail-open).
  const headers = (handshake && handshake.headers) || {};
  const xff = headers['x-forwarded-for'];
  // Node folds duplicate XFF headers into a single comma-joined string; a
  // non-string here is exotic client garbage — fall through to the raw
  // address rather than guessing.
  if (typeof xff === 'string') {
    const parts = xff.split(',');
    // Rightmost-wins: the trusted proxy appended last — see trust model above.
    const rightmost = parts[parts.length - 1].trim();
    // Blank rightmost (header sent but content-free) must NOT become an
    // empty-string bucket shared by every such client — fall through.
    if (rightmost) return rightmost;
  }
  // Direct connection (local dev / tests) or unusable header: the raw remote
  // address engine.io recorded. 'unknown' is a last-ditch shared bucket so a
  // pathological handshake still gets SOME throttling instead of a crash.
  return (handshake && handshake.address) || 'unknown';
}

module.exports = { deriveClientIp };
