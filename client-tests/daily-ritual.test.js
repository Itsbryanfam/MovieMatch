/**
 * @jest-environment jsdom
 */
// Phase 7.4 — daily ritual pure seams + additive render. WHY: streak/countdown
// must be pure + unit-testable (no accounts, device-local), and the modal
// change must be provably additive (existing nodes untouched, no stableId).
const { loadIndexHtml } = require('./fixtures');
import {
  formatResetCountdown,
  computeDailyStreak,
  readDailyStreak,
  writeDailyStreak,
  renderDailyResult,
} from '../public/js/ui.js';

describe('formatResetCountdown', () => {
  test('≥1h → "Xh Ym"', () => {
    const now = new Date('2026-05-18T20:30:00Z');
    expect(formatResetCountdown(now)).toBe('3h 30m');
  });
  test('<1h and ≥1m → "Ym"', () => {
    const now = new Date('2026-05-18T23:18:00Z');
    expect(formatResetCountdown(now)).toBe('42m');
  });
  test('<1m → "<1m"', () => {
    const now = new Date('2026-05-18T23:59:30Z');
    expect(formatResetCountdown(now)).toBe('<1m');
  });
  test('exactly at midnight → next full day, never negative', () => {
    const now = new Date('2026-05-18T00:00:00Z');
    expect(formatResetCountdown(now)).toBe('23h 59m');
  });
  test('one hour before midnight', () => {
    const now = new Date('2026-05-18T23:00:00Z');
    expect(formatResetCountdown(now)).toBe('1h 0m');
  });
});

describe('computeDailyStreak', () => {
  test('no prior (null/undefined) → streak 1', () => {
    expect(computeDailyStreak(42, null)).toEqual({ streak: 1, next: { lastPuzzleNumber: 42, streak: 1 } });
    expect(computeDailyStreak(42, undefined)).toEqual({ streak: 1, next: { lastPuzzleNumber: 42, streak: 1 } });
  });
  test('same puzzle again → unchanged (idempotent)', () => {
    const prev = { lastPuzzleNumber: 42, streak: 7 };
    expect(computeDailyStreak(42, prev)).toEqual({ streak: 7, next: { lastPuzzleNumber: 42, streak: 7 } });
    const once = computeDailyStreak(42, prev).next;
    expect(computeDailyStreak(42, once)).toEqual({ streak: 7, next: { lastPuzzleNumber: 42, streak: 7 } });
  });
  test('consecutive (+1) → increment', () => {
    expect(computeDailyStreak(43, { lastPuzzleNumber: 42, streak: 7 }))
      .toEqual({ streak: 8, next: { lastPuzzleNumber: 43, streak: 8 } });
  });
  test('gap (≥+2 or earlier) → reset to 1', () => {
    expect(computeDailyStreak(45, { lastPuzzleNumber: 42, streak: 7 }))
      .toEqual({ streak: 1, next: { lastPuzzleNumber: 45, streak: 1 } });
    expect(computeDailyStreak(40, { lastPuzzleNumber: 42, streak: 7 }))
      .toEqual({ streak: 1, next: { lastPuzzleNumber: 40, streak: 1 } });
  });
  test('corrupt prev shape → treated as no prior', () => {
    expect(computeDailyStreak(42, { junk: true }).streak).toBe(1);
    expect(computeDailyStreak(42, 'nonsense').streak).toBe(1);
    expect(computeDailyStreak(42, { lastPuzzleNumber: 'x', streak: 'y' }).streak).toBe(1);
  });
  test('non-integer puzzleNumber → streak 1 (defensive)', () => {
    expect(computeDailyStreak(NaN, { lastPuzzleNumber: 1, streak: 5 }).streak).toBe(1);
    expect(computeDailyStreak(undefined, { lastPuzzleNumber: 1, streak: 5 }).streak).toBe(1);
  });
});

describe('readDailyStreak / writeDailyStreak', () => {
  beforeEach(() => window.localStorage.clear());
  test('round-trips a valid value', () => {
    writeDailyStreak({ lastPuzzleNumber: 9, streak: 3 });
    expect(readDailyStreak()).toEqual({ lastPuzzleNumber: 9, streak: 3 });
  });
  test('missing key → null', () => {
    expect(readDailyStreak()).toBeNull();
  });
  test('malformed JSON → null (no throw)', () => {
    window.localStorage.setItem('mm:dailyStreak', '{not json');
    expect(() => readDailyStreak()).not.toThrow();
    expect(readDailyStreak()).toBeNull();
  });
  test('wrong shape → null', () => {
    window.localStorage.setItem('mm:dailyStreak', JSON.stringify({ foo: 1 }));
    expect(readDailyStreak()).toBeNull();
  });
});

describe('renderDailyResult — additive ritual block', () => {
  beforeEach(() => {
    loadIndexHtml();
    window.localStorage.clear();
  });

  test('appends streak + countdown without touching existing nodes; no stableId', () => {
    renderDailyResult({
      puzzleNumber: 12,
      date: '2026-05-18',
      chainLength: 5,
      leaderboard: [{ name: 'Alice', chainLength: 9 }],
      stableId: 'SECRET_STABLE_ID',
    });
    const body = document.getElementById('daily-result-body');
    expect(body.querySelector('.daily-score-num').textContent).toBe('5');
    expect(body.querySelector('.daily-lb-name').textContent).toBe('Alice');
    const ritual = body.querySelector('.daily-ritual');
    expect(ritual).not.toBeNull();
    expect(body.lastElementChild).toBe(ritual);
    expect(ritual.querySelector('.daily-streak').textContent).toBe('Day 1 🔥');
    expect(ritual.querySelector('.daily-countdown').textContent).toMatch(/^Resets in /);
    expect(document.getElementById('daily-result-modal').innerHTML).not.toContain('SECRET_STABLE_ID');
  });

  test('alreadyPlayed path also gets the ritual block; idempotent re-open', () => {
    const data = { alreadyPlayed: true, puzzleNumber: 12, date: '2026-05-18', chainLength: 0, leaderboard: [] };
    renderDailyResult(data);
    expect(document.querySelector('.daily-streak').textContent).toBe('Day 1 🔥');
    renderDailyResult(data);
    expect(document.querySelectorAll('.daily-ritual').length).toBe(1);
    expect(document.querySelector('.daily-streak').textContent).toBe('Day 1 🔥');
  });
});
