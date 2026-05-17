/**
 * @jest-environment jsdom
 */

// Design audit finding #4: the first-run tutorial auto-took-over the
// screen ~600ms after first load, before the new visitor had oriented to
// the brand / CTA / lobby choices. The fix moves the trigger to the
// player's first explicit "Play Now" intent via runTutorialThenContinue:
// first-timers get the guided walkthrough THEN proceed; returning players
// proceed immediately. These tests pin that contract at the testable
// seam (tutorial.js) rather than app.js's socket-heavy wiring.

import { runTutorialThenContinue, shouldShowTutorial } from '../public/js/tutorial.js';
const { loadIndexHtml } = require('./fixtures');

describe('runTutorialThenContinue (audit #4)', () => {
  beforeEach(() => {
    loadIndexHtml();
    try { localStorage.clear(); } catch {}
    // jsdom has no layout — scrollIntoView is a no-op stub but be explicit
    // so a future jsdom change can't make the tutorial render throw.
    Element.prototype.scrollIntoView = () => {};
  });

  test('first-time visitor: shows the tutorial first, continues only after dismiss', async () => {
    const cont = jest.fn();
    const p = runTutorialThenContinue(cont);

    // The walkthrough must be on screen, and we must NOT have navigated
    // away yet — the tutorial precedes the lobby, it doesn't run behind it.
    const overlay = document.querySelector('.tutorial-overlay');
    expect(overlay).not.toBeNull();
    expect(cont).not.toHaveBeenCalled();

    // Dismiss via Skip — same path as completing it.
    overlay.querySelector('.tutorial-skip-btn').click();
    await p;

    expect(cont).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.tutorial-overlay')).toBeNull();
    // Flag is now set so it never auto-repeats on a later Play Now.
    expect(shouldShowTutorial()).toBe(false);
  });

  test('returning visitor: continues immediately, no tutorial overlay', async () => {
    localStorage.setItem('mm_completedTutorial', '1');
    const cont = jest.fn();

    await runTutorialThenContinue(cont);

    expect(cont).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.tutorial-overlay')).toBeNull();
  });
});
