// ui/timer-panic.js — pure per-turn timer severity. Phase 7.4 (Panic Timer).
// WHY: socketClient.js already drives the timer bar (width + red/yellow/green
// + ≤10s `timer-critical`). 7.4 adds a physical "panic" treatment for the
// final 5s. The threshold decision is extracted into this pure, zero-import,
// unit-testable function (the 7.2/7.3 pure-seam discipline) so the wiring in
// socketClient.js stays a thin, additive class toggle and the band boundaries
// are pinned by tests rather than buried in an interval callback.

/**
 * Map seconds-remaining to a severity band.
 *   <= 5  → 'panic'    (the physical last-5s state; strict subset of critical)
 *   <= 10 → 'critical'  (the existing red/blink band)
 *   else  → 'normal'
 * Defensive: a finite negative reading means the clock overran — treat as 0
 * (still panic). A non-finite / non-number reading means the remaining time
 * is unknown; we must NOT flash panic on unknown state, so degrade to
 * 'normal' (the caller's existing guards handle the not-playing case).
 */
export function timerSeverity(secondsRemaining) {
  if (typeof secondsRemaining !== 'number' || !Number.isFinite(secondsRemaining)) {
    return 'normal';
  }
  const s = secondsRemaining < 0 ? 0 : secondsRemaining;
  if (s <= 5) return 'panic';
  if (s <= 10) return 'critical';
  return 'normal';
}
