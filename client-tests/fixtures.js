// ============================================================================
// CLIENT TEST FIXTURES
// ============================================================================
// Loads the real public/index.html into jsdom and exposes helpers for
// constructing mock game states. Tests then call ui.js render functions
// against this DOM and assert the resulting class/text state.
// ============================================================================

const fs = require('fs');
const path = require('path');

const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'index.html'),
  'utf8'
);

// Replace the document body with the markup from public/index.html so we
// get the real initial class state (e.g., #join-panel has no .hidden class
// — this is exactly the condition that surfaced the double-lobby bug).
function loadIndexHtml() {
  // jsdom won't execute <script> tags here — we only want the markup.
  // Strip the module script tag so jsdom doesn't try to fetch it.
  const html = INDEX_HTML.replace(
    /<script type="module"[^>]*><\/script>/g,
    ''
  ).replace(/<script src="\/socket\.io[^"]*"><\/script>/g, '');

  // jsdom is initialized by jest-environment-jsdom; we just write into it.
  document.documentElement.innerHTML = html.replace(/<\/?html[^>]*>/gi, '');
}

// Phase 7.8c — load the vendored qrcode-generator into the jsdom global so
// tests can exercise the real encoder path. The vendored UMD assigns
// `var qrcode = ...` at top level; in a browser that becomes window.qrcode.
// In jsdom we use indirect eval (0, eval) to evaluate in global scope so
// the var lands on the jsdom window instead of inside a local function frame.
function loadVendoredQrLib() {
  // Idempotent: skip if already loaded by a prior test in the same worker.
  if (typeof window.qrcode === 'function') return;
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'lib', 'qrcode.js'),
    'utf8'
  );
  // Indirect-eval form: (0, eval) breaks the local-scope binding so the
  // script evaluates in the global scope (= jsdom window). Top-level
  // `var qrcode` in the vendored file becomes window.qrcode.
  (0, eval)(src);
}

// Build a player object with sensible defaults
function makePlayer(overrides = {}) {
  return {
    id: 'socket_' + Math.random().toString(36).slice(2, 8),
    stableId: 'p_' + Math.random().toString(36).slice(2, 8),
    name: 'Player',
    isHost: false,
    isAlive: true,
    connected: true,
    score: 0,
    wins: 0,
    teamId: 0,
    ...overrides,
  };
}

// Build a game state with sensible defaults for a 2-player waiting room
function makeWaitingState(overrides = {}) {
  return {
    id: 'TEST01',
    status: 'waiting',
    gameMode: 'classic',
    hardcoreMode: false,
    allowTvShows: false,
    isPublic: false,
    chain: [],
    currentTurnIndex: 0,
    players: [
      makePlayer({ id: 'host_id', name: 'Host', isHost: true }),
      makePlayer({ id: 'guest_id', name: 'Guest' }),
    ],
    ...overrides,
  };
}

function makePlayingState(overrides = {}) {
  // Default to 60s for backward compat with existing tests, but let callers
  // override (e.g. 15000 for speed mode) so the timer-bar logic is exercised
  // across all modes, not just classic.
  const turnDurationMs = overrides.turnDurationMs ?? 60000;
  return {
    ...makeWaitingState(),
    status: 'playing',
    // Pair turnDurationMs with turnExpiresAt — the client uses both
    // (durationMs as the denominator for the bar width, expiresAt for the
    // remaining-time display).
    turnExpiresAt: Date.now() + turnDurationMs,
    turnDurationMs,
    ...overrides,
  };
}

function makeChainItem(overrides = {}) {
  return {
    movie: {
      title: 'Iron Man',
      year: 2008,
      cast: ['Robert Downey Jr.', 'Gwyneth Paltrow'],
      poster: 'https://image.tmdb.org/t/p/w200/test.jpg',
    },
    playerName: 'Host',
    matchedActors: [],
    ...overrides,
  };
}

module.exports = {
  loadIndexHtml,
  makePlayer,
  makeWaitingState,
  makePlayingState,
  makeChainItem,
  loadVendoredQrLib,   // Phase 7.8c — vendored QR encoder loader
};
