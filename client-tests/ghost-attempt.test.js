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
