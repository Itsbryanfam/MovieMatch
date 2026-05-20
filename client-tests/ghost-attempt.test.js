/**
 * @jest-environment jsdom
 */

// Phase 7.8 — REWRITTEN. The ghost-attempt was rebuilt from a sliver card
// appended below the filmstrip into a faded reel-node + broken-bridge pair
// at the END of the .reel inside the Constellation board. This suite pins
// the new contract: the ghost is part of the chain narrative, survives
// rebuild-on-every-stateUpdate (via renderPendingGhost), and is cleared
// only on (a) 8s timeout, (b) a new attemptFailed, or (c) chain growth.

import {
  initUIElements,
  renderGame,
  showGhostAttempt,
  clearGhostAttempt,
} from '../public/js/ui.js';
const { loadIndexHtml, makePlayingState, makeChainItem } = require('./fixtures');

const reel = () => document.querySelector('#chain-display .filmstrip .reel');

// Helper: render a chain so the .reel exists (showGhostAttempt needs a
// reel target — the pre-fix sliver was a bare chainDisplay child, but
// the in-reel ghost requires the reel to be built first).
function ensureChainRendered(items = [makeChainItem()]) {
  renderGame(makePlayingState({ chain: items }), 'host_id', false);
}

describe('ghost attempt — Phase 7.8 in-reel design', () => {
  beforeEach(() => {
    loadIndexHtml();
    initUIElements();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('appends a .reel-node-ghost + .reel-bridge-broken at the end of the reel', () => {
    ensureChainRendered();
    showGhostAttempt({
      playerName: 'Bryan',
      movieTitle: 'Top Gun',
      year: '1986',
      poster: null,
      reason: 'No shared cast.',
    });

    const r = reel();
    expect(r).not.toBeNull();
    // Broken bridge sits just before the ghost node (visually telegraphs
    // "this is where the chain breaks").
    const bridges = [...r.querySelectorAll('.reel-bridge-broken')];
    expect(bridges.length).toBe(1);
    expect(bridges[0].textContent).toBe('✗');
    // Ghost reel-node is the very last child of the reel.
    const ghost = r.querySelector('.reel-node-ghost');
    expect(ghost).not.toBeNull();
    expect(r.lastElementChild).toBe(ghost);
    // Content reads "<player> tried" + title + reason.
    expect(ghost.querySelector('.reel-who').textContent).toBe('Bryan tried');
    expect(ghost.querySelector('.reel-title').textContent).toBe('Top Gun (1986)');
    expect(ghost.querySelector('.reel-ghost-reason').textContent).toBe('No shared cast.');
    // The big ✗ stamp overlay is present.
    expect(ghost.querySelector('.reel-ghost-stamp').textContent).toBe('✗');
  });

  test('renders an <img.reel-poster> when a TMDB poster URL is provided', () => {
    ensureChainRendered();
    showGhostAttempt({
      playerName: 'Bryan',
      movieTitle: 'Top Gun',
      year: '1986',
      poster: 'https://image.tmdb.org/t/p/w92/topgun.jpg',
      reason: 'No shared cast.',
    });
    const img = reel().querySelector('.reel-node-ghost img.reel-poster');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w92/topgun.jpg');
  });

  test('renders a poster placeholder when no TMDB poster URL is provided', () => {
    ensureChainRendered();
    showGhostAttempt({
      playerName: 'Bryan',
      movieTitle: 'Top Gun',
      year: '1986',
      poster: null,
      reason: 'No shared cast.',
    });
    const placeholder = reel().querySelector('.reel-node-ghost .reel-poster.placeholder');
    expect(placeholder).not.toBeNull();
    expect(reel().querySelector('.reel-node-ghost img.reel-poster')).toBeNull();
  });

  test('rejects non-TMDB URLs and falls back to placeholder (XSS / unknown-host safety)', () => {
    ensureChainRendered();
    showGhostAttempt({
      playerName: 'Bryan',
      movieTitle: 'Top Gun',
      year: '1986',
      poster: 'https://evil.example.com/x.jpg',
      reason: 'No shared cast.',
    });
    expect(reel().querySelector('.reel-node-ghost img.reel-poster')).toBeNull();
    expect(reel().querySelector('.reel-node-ghost .reel-poster.placeholder')).not.toBeNull();
  });

  test('a second failed attempt REPLACES the first (only latest visible)', () => {
    ensureChainRendered();
    showGhostAttempt({ playerName: 'Bryan', movieTitle: 'Top Gun', year: '1986', poster: null, reason: 'No shared cast.' });
    showGhostAttempt({ playerName: 'Alex',  movieTitle: 'Heat',    year: '1995', poster: null, reason: 'Movie already used!' });

    const ghosts = reel().querySelectorAll('.reel-node-ghost');
    const bridges = reel().querySelectorAll('.reel-bridge-broken');
    expect(ghosts.length).toBe(1);
    expect(bridges.length).toBe(1);
    expect(ghosts[0].querySelector('.reel-who').textContent).toBe('Alex tried');
    expect(ghosts[0].querySelector('.reel-title').textContent).toBe('Heat (1995)');
    expect(ghosts[0].querySelector('.reel-ghost-reason').textContent).toBe('Movie already used!');
  });

  test('the ghost SURVIVES an idempotent stateUpdate re-render of the same chain', () => {
    // Phase 7.8 architecture: renderChainItems wipes the .reel's children
    // on every stateUpdate (chat, reactions, joins, …), so the ghost must
    // be re-attached after each rebuild via renderPendingGhost(reel). This
    // is the test that pins that the survives-idempotent-rerender contract.
    const chain = [makeChainItem(), makeChainItem({ matchedActors: ['x'] })];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    showGhostAttempt({ playerName: 'Bryan', movieTitle: 'Top Gun', year: '1986', poster: null, reason: 'No shared cast.' });
    expect(reel().querySelector('.reel-node-ghost')).not.toBeNull();

    // Re-render with the SAME chain (simulating a chat or reaction stateUpdate).
    renderGame(makePlayingState({ chain }), 'host_id', false);
    expect(reel().querySelector('.reel-node-ghost')).not.toBeNull();
    expect(reel().querySelector('.reel-bridge-broken')).not.toBeNull();
  });

  test('a chain advance (growth) CLEARS the ghost', () => {
    const chain = [makeChainItem()];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    showGhostAttempt({ playerName: 'Bryan', movieTitle: 'Top Gun', year: '1986', poster: null, reason: 'No shared cast.' });
    expect(reel().querySelector('.reel-node-ghost')).not.toBeNull();

    // Someone makes a valid play → chain grows → ghost should be gone.
    renderGame(
      makePlayingState({ chain: [...chain, makeChainItem({ matchedActors: ['x'] })] }),
      'host_id',
      false
    );
    expect(reel().querySelector('.reel-node-ghost')).toBeNull();
    expect(reel().querySelector('.reel-bridge-broken')).toBeNull();
  });

  test('clearGhostAttempt removes the ghost immediately', () => {
    ensureChainRendered();
    showGhostAttempt({ playerName: 'Bryan', movieTitle: 'Top Gun', year: '1986', poster: null, reason: 'No shared cast.' });
    expect(reel().querySelector('.reel-node-ghost')).not.toBeNull();

    clearGhostAttempt();
    expect(reel().querySelector('.reel-node-ghost')).toBeNull();
    expect(reel().querySelector('.reel-bridge-broken')).toBeNull();
  });

  test('auto-clears after 8 seconds', () => {
    ensureChainRendered();
    showGhostAttempt({ playerName: 'Bryan', movieTitle: 'Top Gun', year: '1986', poster: null, reason: 'No shared cast.' });
    expect(reel().querySelector('.reel-node-ghost')).not.toBeNull();

    jest.advanceTimersByTime(8000);
    // After timeout, the next render also clears any leftover. The reel
    // itself still exists (the chain is non-empty); only the ghost is gone.
    expect(reel().querySelector('.reel-node-ghost')).toBeNull();
  });

  test('the ghost falls back to a year-less title when year is missing', () => {
    ensureChainRendered();
    showGhostAttempt({ playerName: 'Bryan', movieTitle: 'Untitled', year: '', poster: null, reason: 'No shared cast.' });
    expect(reel().querySelector('.reel-node-ghost .reel-title').textContent).toBe('Untitled');
  });

  test('escapes HTML in player name and movie title (no live elements)', () => {
    ensureChainRendered();
    showGhostAttempt({
      playerName: '<script>alert(1)</script>',
      movieTitle: '<img onerror=alert(1)>',
      year: '',
      poster: null,
      reason: 'No shared cast.',
    });
    const ghost = reel().querySelector('.reel-node-ghost');
    // Dangerous payload appears as text, never as live elements.
    expect(ghost.querySelector('script')).toBeNull();
    // The poster placeholder is a div, but no rogue <img> from the title
    // payload should be in the reel-who/reel-title slots.
    expect(ghost.querySelector('.reel-who').querySelector('img')).toBeNull();
    expect(ghost.querySelector('.reel-title').querySelector('img')).toBeNull();
    expect(ghost.querySelector('.reel-who').textContent).toContain('<script>alert(1)</script>');
    expect(ghost.querySelector('.reel-title').textContent).toContain('<img onerror=alert(1)>');
  });
});
