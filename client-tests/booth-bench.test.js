/** @jest-environment jsdom */
// WHY: the booth bench adds an "Up Next" affordance. nextAliveIndex is pure
// logic (skip eliminated, wrap around) and must be unit-tested independently
// of the DOM render so the marker is provably correct in edge cases.
import { nextAliveIndex } from '../public/js/ui/ui-render.js';

describe('nextAliveIndex (booth bench "Up Next")', () => {
  const P = alive => ({ isAlive: alive });
  test('returns the next alive player after current', () => {
    expect(nextAliveIndex([P(true), P(true), P(true)], 0)).toBe(1);
  });
  test('skips eliminated players', () => {
    expect(nextAliveIndex([P(true), P(false), P(true)], 0)).toBe(2);
  });
  test('wraps around the array', () => {
    expect(nextAliveIndex([P(true), P(true)], 1)).toBe(0);
  });
  test('returns -1 when current is the only one alive', () => {
    expect(nextAliveIndex([P(false), P(true), P(false)], 1)).toBe(-1);
  });
  test('returns -1 for empty / single player', () => {
    expect(nextAliveIndex([], 0)).toBe(-1);
    expect(nextAliveIndex([P(true)], 0)).toBe(-1);
  });
});
