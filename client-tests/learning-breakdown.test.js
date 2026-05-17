/**
 * @jest-environment jsdom
 */

// Phase 6a: the detailed self-elimination card must additively surface the
// server-computed "you could have played X" suggestion, and must be
// byte-unchanged when the server omits it (miss/error/timeout) or on the
// legacy no-details flash.
import { showSelfEliminationScreen } from '../public/js/ui/ui-notifications.js';

const DETAILS = {
  reason: 'Invalid movie connection.',
  lastChainEntry: { title: 'Inception', year: '2010', cast: ['Leonardo DiCaprio'] },
  yourGuess: { title: 'Casino Royale', year: '2006', cast: ['Daniel Craig'] },
};

describe('learning breakdown — couldHavePlayed in self-elimination screen', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    // afterEach runs even if a test throws, so timer/DOM restore is failure-safe.
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  test('renders the suggestion when couldHavePlayed is present', () => {
    showSelfEliminationScreen({ ...DETAILS, couldHavePlayed: { title: 'The Dark Knight', year: '2008' } });
    const could = document.querySelector('.self-elim-could');
    expect(could).not.toBeNull();
    expect(could.textContent).toContain('The Dark Knight');
    expect(could.textContent).toContain('2008');
    expect(document.querySelector('.self-elim-grid')).not.toBeNull();
  });

  test('omits the suggestion when couldHavePlayed is absent (unchanged card)', () => {
    showSelfEliminationScreen({ ...DETAILS });
    expect(document.querySelector('.self-elim-could')).toBeNull();
    expect(document.querySelector('.self-elim-card')).not.toBeNull();
    expect(document.querySelector('.self-elim-grid')).not.toBeNull();
  });

  test('legacy no-details flash has no suggestion block', () => {
    showSelfEliminationScreen(undefined);
    expect(document.querySelector('.self-elim-could')).toBeNull();
    const screen = document.querySelector('.self-elim-screen');
    expect(screen).not.toBeNull();
    expect(screen.classList.contains('self-elim-screen--detailed')).toBe(false);
  });
});
