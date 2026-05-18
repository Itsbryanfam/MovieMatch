/**
 * @jest-environment jsdom
 */

// HL-01: the hero "Today's Daily Challenge" CTA read its name from
// #player-name, which lives on the (hidden) lobby screen. A first-time
// visitor — no saved name in localStorage, lobby never opened — got a
// full-screen "Enter a name first" notification plus a focus() on an input
// that isn't on the hero screen: a dead-end on a primary entry point that
// is invisible in normal dev testing (the developer always has a saved
// name). The fix routes a name-less Daily start through an inline prompt.
//
// These tests pin that prompt's contract at the testable ui seam —
// deliberately mirroring tutorial-trigger.test.js: app.js's socket-heavy
// DOMContentLoaded wiring is not unit-tested, the extracted seam is.

const { loadIndexHtml } = require('./fixtures');
import { showDailyNamePrompt } from '../public/js/ui.js';

describe('showDailyNamePrompt (HL-01 — a first-time visitor can start the Daily)', () => {
  beforeEach(() => {
    loadIndexHtml();
    try { localStorage.clear(); } catch {}
  });

  test('first-time visitor: surfaces a real name prompt instead of dead-ending', () => {
    const onConfirm = jest.fn();
    showDailyNamePrompt({ prefill: '', onConfirm });

    // A visible prompt with a name input must appear — NOT a notification
    // pointing at a field that isn't on the current screen.
    const overlay = document.querySelector('.daily-name-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('input')).not.toBeNull();
    expect(overlay.querySelector('.daily-name-go')).not.toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('entering a name and confirming starts the Daily, then dismisses the prompt', () => {
    const onConfirm = jest.fn();
    showDailyNamePrompt({ prefill: '', onConfirm });

    const overlay = document.querySelector('.daily-name-overlay');
    overlay.querySelector('input').value = '  Ada  ';
    overlay.querySelector('.daily-name-go').click();

    // The trimmed name is handed to the caller exactly once (the caller
    // owns the socket emit — keeps this fn socket-free and unit-testable),
    // and the prompt is removed.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Ada');
    expect(document.querySelector('.daily-name-overlay')).toBeNull();
  });

  test('a blank name does not start the Daily and keeps the prompt open', () => {
    const onConfirm = jest.fn();
    showDailyNamePrompt({ prefill: '', onConfirm });

    const overlay = document.querySelector('.daily-name-overlay');
    overlay.querySelector('input').value = '   ';
    overlay.querySelector('.daily-name-go').click();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector('.daily-name-overlay')).not.toBeNull();
  });

  test('prefill populates the input so a known name is one tap away', () => {
    showDailyNamePrompt({ prefill: 'Grace', onConfirm: jest.fn() });
    expect(document.querySelector('.daily-name-overlay input').value).toBe('Grace');
  });

  test('the backdrop offers an escape so the new prompt is not itself a trap', () => {
    const onConfirm = jest.fn();
    showDailyNamePrompt({ prefill: '', onConfirm });

    const overlay = document.querySelector('.daily-name-overlay');
    // Clicking the backdrop (the overlay itself, not the card) closes it
    // without starting a run.
    overlay.click();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector('.daily-name-overlay')).toBeNull();
  });
});
