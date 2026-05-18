/**
 * @jest-environment jsdom
 */

// Phase 6a: the detailed self-elimination card must additively surface the
// server-computed suggestion, and must be byte-unchanged when the server omits
// it (miss/error/timeout) or on the legacy no-details flash.
//
// Phase 7.1 migration: server now sends outs:[{title,year,viaActor}] instead
// of couldHavePlayed:{title,year}. The old .self-elim-could element is gone;
// assertions migrated to .self-elim-outs-row + .self-elim-bridge to preserve
// the test's real intent (suggestion surfaced → suggestion absent).
import { showSelfEliminationScreen } from '../public/js/ui.js'; // use barrel like all sibling client tests

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

  // Migrated from couldHavePlayed → outs shape (Phase 7.1): real intent is
  // "a server suggestion is rendered beneath the grid"; the shape changed from
  // a single .self-elim-could div to a .self-elim-outs list + bridge line.
  test('renders the suggestion when outs are present', () => {
    showSelfEliminationScreen({ ...DETAILS, outs: [{ title: 'The Dark Knight', year: '2008', viaActor: 'Christian Bale' }] });
    const rows = document.querySelectorAll('.self-elim-outs-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent).toContain('The Dark Knight');
    expect(rows[0].textContent).toContain('2008');
    expect(document.querySelector('.self-elim-bridge')).not.toBeNull();
    expect(document.querySelector('.self-elim-grid')).not.toBeNull();
  });

  test('omits the outs block when outs are absent (unchanged card)', () => {
    showSelfEliminationScreen({ ...DETAILS });
    expect(document.querySelector('.self-elim-outs')).toBeNull();
    expect(document.querySelector('.self-elim-card')).not.toBeNull();
    expect(document.querySelector('.self-elim-grid')).not.toBeNull();
  });

  test('legacy no-details flash has no outs block', () => {
    showSelfEliminationScreen(undefined);
    expect(document.querySelector('.self-elim-outs')).toBeNull();
    const screen = document.querySelector('.self-elim-screen');
    expect(screen).not.toBeNull();
    expect(screen.classList.contains('self-elim-screen--detailed')).toBe(false);
  });
});
