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
  return {
    ...makeWaitingState(),
    status: 'playing',
    turnExpiresAt: Date.now() + 60000,
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
};
