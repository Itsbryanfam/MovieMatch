/**
 * @jest-environment jsdom
 */
// Phase 7.4 — pure timerSeverity seam. WHY: the panic decision must be a
// pure, unit-testable function (mirrors 7.2 submissionPill / 7.3 modal
// factory) so socketClient.js stays thin glue and the boundaries are pinned.
import { timerSeverity } from '../public/js/ui.js';

describe('timerSeverity', () => {
  test('panic band: secondsRemaining <= 5', () => {
    expect(timerSeverity(5)).toBe('panic');
    expect(timerSeverity(4)).toBe('panic');
    expect(timerSeverity(1)).toBe('panic');
    expect(timerSeverity(0)).toBe('panic');
  });

  test('critical band: 5 < secondsRemaining <= 10', () => {
    expect(timerSeverity(6)).toBe('critical');
    expect(timerSeverity(10)).toBe('critical');
    expect(timerSeverity(5.0001)).toBe('critical');
  });

  test('normal band: secondsRemaining > 10', () => {
    // 10.0001 is the symmetric upper boundary to the 5.0001 lower-boundary
    // assertion above — pins that the critical band is `<= 10` (exclusive
    // above 10), completing the band-boundary contract.
    expect(timerSeverity(10.0001)).toBe('normal');
    expect(timerSeverity(11)).toBe('normal');
    expect(timerSeverity(30)).toBe('normal');
    expect(timerSeverity(999)).toBe('normal');
  });

  test('negative remaining is clamped to 0 → panic (clock overran)', () => {
    expect(timerSeverity(-1)).toBe('panic');
    expect(timerSeverity(-999)).toBe('panic');
  });

  test('non-finite / non-number inputs degrade to normal (unknown ≠ panic)', () => {
    expect(timerSeverity(NaN)).toBe('normal');
    expect(timerSeverity(undefined)).toBe('normal');
    expect(timerSeverity(null)).toBe('normal');
    expect(timerSeverity(Infinity)).toBe('normal');
    expect(timerSeverity('5')).toBe('normal');
  });
});
