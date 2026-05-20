/**
 * @jest-environment jsdom
 */

// Coverage for the ghost-attempt UI — the transient card that surfaces
// what an eliminated player tried to play, so other players can see the
// attempt without it polluting the chain history.

import { initUIElements, renderGame, showGhostAttempt, clearGhostAttempt } from '../public/js/ui.js';
const { loadIndexHtml, makePlayingState, makeChainItem } = require('./fixtures');

describe('ghost attempt rendering', () => {
  beforeEach(() => {
    loadIndexHtml();
    initUIElements();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders a ghost-attempt card with player, title, and reason', () => {
    showGhostAttempt({
      playerName: 'Bryan',
      movieTitle: 'Top Gun',
      reason: 'No shared cast.',
    });

    const ghost = document.querySelector('.ghost-attempt');
    expect(ghost).not.toBeNull();
    expect(ghost.textContent).toContain('Bryan');
    expect(ghost.textContent).toContain('Top Gun');
    expect(ghost.textContent).toContain('No shared cast.');
  });

  test('a second failed attempt replaces the first (only latest is shown)', () => {
    showGhostAttempt({ playerName: 'Bryan', movieTitle: 'Top Gun', reason: 'No shared cast.' });
    showGhostAttempt({ playerName: 'Alex', movieTitle: 'Heat', reason: 'Movie already used!' });

    const ghosts = document.querySelectorAll('.ghost-attempt');
    expect(ghosts.length).toBe(1);
    expect(ghosts[0].textContent).toContain('Alex');
    expect(ghosts[0].textContent).toContain('Heat');
  });

  test('auto-clears after 8 seconds', () => {
    showGhostAttempt({ playerName: 'Bryan', movieTitle: 'Top Gun', reason: 'No shared cast.' });
    expect(document.querySelector('.ghost-attempt')).not.toBeNull();

    jest.advanceTimersByTime(8000);
    expect(document.querySelector('.ghost-attempt')).toBeNull();
  });

  test('clearGhostAttempt removes the card immediately', () => {
    showGhostAttempt({ playerName: 'Bryan', movieTitle: 'Top Gun', reason: 'No shared cast.' });
    expect(document.querySelector('.ghost-attempt')).not.toBeNull();

    clearGhostAttempt();
    expect(document.querySelector('.ghost-attempt')).toBeNull();
  });

  test('a successful chain advance clears the ghost', () => {
    // First: render an empty chain → empty-board hint shows
    renderGame(makePlayingState({ chain: [] }), 'host_id', false);

    // Then a player fails an attempt → ghost appears
    showGhostAttempt({ playerName: 'Bryan', movieTitle: 'Top Gun', reason: 'No shared cast.' });
    expect(document.querySelector('.ghost-attempt')).not.toBeNull();

    // Then someone makes a valid play → chain advances → ghost should be gone
    renderGame(makePlayingState({ chain: [makeChainItem()] }), 'host_id', false);
    expect(document.querySelector('.ghost-attempt')).toBeNull();
  });

  test('post-7.7 fix: appended ghost is scrolled into view (not pre-layout scrollTop)', () => {
    // The pre-fix path was `chainDisplay.scrollTop = chainDisplay.scrollHeight`,
    // which raced the freshly-appended child's layout (scrollHeight was the
    // pre-insert value) and on the Phase 7.7 board left the ghost just below
    // the viewport when the full-width cast panel had already filled the
    // column. scrollIntoView is layout-aware. Instrument Element.prototype to
    // verify the ghost's own scrollIntoView is what fired (not e.g. a
    // chainDisplay scrollIntoView, which would not target the ghost).
    const calls = [];
    const real = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (opts) {
      calls.push({ tag: this.tagName, classes: this.className, opts });
    };
    try {
      showGhostAttempt({ playerName: 'Bryan', movieTitle: 'Top Gun', reason: 'No shared cast.' });
    } finally {
      Element.prototype.scrollIntoView = real;
    }
    const ghostCall = calls.find(c => /\bghost-attempt\b/.test(c.classes));
    expect(ghostCall).toBeDefined();
    expect(ghostCall.opts).toEqual({ behavior: 'smooth', block: 'nearest' });
  });

  test('escapes HTML in player name and movie title', () => {
    showGhostAttempt({
      playerName: '<script>alert(1)</script>',
      movieTitle: '<img onerror=alert(1)>',
      reason: 'No shared cast.',
    });

    const ghost = document.querySelector('.ghost-attempt');
    // The dangerous payload should appear as text, not as live elements
    expect(ghost.querySelector('script')).toBeNull();
    expect(ghost.querySelector('img')).toBeNull();
    expect(ghost.textContent).toContain('<script>alert(1)</script>');
  });
});
