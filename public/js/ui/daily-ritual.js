// ui/daily-ritual.js — pure daily-ritual seams. Phase 7.4 (Daily ritual).
// WHY: the Daily is a habit loop with no habit cues. 7.4 adds a live
// reset countdown + a device-local streak. Per the no-accounts guardrail the
// streak is localStorage-only and the streak key is the server-authoritative
// MONOTONIC puzzleNumber (consecutive days ⇔ +1) — this sidesteps all local
// timezone/ISO ambiguity (the server keys the Daily by UTC for the same
// reason). These are pure, zero-import, unit-testable functions (7.2/7.3
// pure-seam discipline); ui-panels.js stays thin glue. Nothing here is sent
// to the server and no stableId is involved (Phase-1 security preserved).

const STREAK_KEY = 'mm:dailyStreak';

/**
 * Time from `now` to the next UTC 00:00:00, formatted:
 *   ≥1h → "Xh Ym"   ·   <1h & ≥1m → "Ym"   ·   <1m → "<1m"
 * Never negative; never a day component (next UTC midnight is always <24h).
 */
export function formatResetCountdown(now = new Date()) {
  // WHY Date.UTC with +1 day: constructs the exact next UTC midnight without
  // any local-timezone offset — the Daily resets at UTC midnight so the
  // countdown must measure against UTC, not the device's local midnight.
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0,
  ));
  let ms = next.getTime() - now.getTime();
  // WHY clamp: if `now` is exactly midnight the diff is ~86400000ms
  // (the next day); negative would only occur from a malformed `now`,
  // clamp defensively to avoid "−Xh Ym" ever appearing.
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  // WHY cap at 1439 min (23h 59m): at exactly UTC midnight ms == 86400000
  // which would produce "24h 0m" — a day component the spec forbids. The
  // next reset is always < 24h of actual play time; cap enforces that
  // invariant and handles the precise-midnight edge without extra branching.
  const totalMinutes = Math.min(Math.floor(ms / 60000), 23 * 60 + 59);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m`;
  return '<1m';
}

/**
 * WHY _validPrev: centralises the shape-guard so both computeDailyStreak
 * and readDailyStreak agree on what "a valid stored value" looks like.
 * A stored streak of 0 is impossible (minimum is 1), so streak >= 1 guards
 * against accidental zero-writes too.
 */
function _validPrev(prev) {
  return prev
    && typeof prev === 'object'
    && Number.isInteger(prev.lastPuzzleNumber)
    && Number.isInteger(prev.streak)
    && prev.streak >= 1;
}

/**
 * Pure streak transition. `prev`/`next` shape: { lastPuzzleNumber, streak }.
 *   puzzleNumber === prev.lastPuzzleNumber     → unchanged (idempotent)
 *   puzzleNumber === prev.lastPuzzleNumber + 1 → prev.streak + 1
 *   otherwise / no-or-corrupt prev / bad input → 1
 *
 * WHY puzzleNumber as the key: it's the server-authoritative MONOTONIC daily
 * counter (UTC, +1 per day). Two consecutive completions ⇔ puzzleNumber +1.
 * This is timezone-proof and requires no local date parsing.
 */
export function computeDailyStreak(puzzleNumber, prev) {
  // WHY integer guard first: NaN/undefined/string/float are all invalid puzzle
  // numbers — treat as "no history" so we don't corrupt the streak store.
  if (!Number.isInteger(puzzleNumber)) {
    return { streak: 1, next: { lastPuzzleNumber: -1, streak: 1 } };
  }
  if (!_validPrev(prev)) {
    // WHY separate branch: missing/corrupt prev is "first ever play", not an
    // error — start the streak at 1 with the current puzzle as the anchor.
    return { streak: 1, next: { lastPuzzleNumber: puzzleNumber, streak: 1 } };
  }
  if (puzzleNumber === prev.lastPuzzleNumber) {
    // WHY idempotent: the modal can be re-opened (alreadyPlayed path, Done →
    // reopen) without incrementing the streak. Same puzzle = no change.
    return { streak: prev.streak, next: { lastPuzzleNumber: puzzleNumber, streak: prev.streak } };
  }
  if (puzzleNumber === prev.lastPuzzleNumber + 1) {
    // WHY +1 exactly: consecutive days → consecutive puzzle numbers (server
    // monotonic). Any gap (skip a day, skip multiple) breaks the chain.
    const streak = prev.streak + 1;
    return { streak, next: { lastPuzzleNumber: puzzleNumber, streak } };
  }
  // WHY reset: gap (≥+2) or going backwards (replay old puzzle on new device)
  // both break the streak — start fresh from this puzzle.
  return { streak: 1, next: { lastPuzzleNumber: puzzleNumber, streak: 1 } };
}

/**
 * Read the persisted streak from localStorage, or null.
 * WHY fully defensive: localStorage can throw (private browsing quota, iOS
 * Safari ITP), JSON.parse can throw (truncated write), and the stored shape
 * may be stale or tampered. Any failure → null (graceful degradation to
 * streak = 1 on the next computeDailyStreak call).
 */
export function readDailyStreak() {
  try {
    const raw = window.localStorage.getItem(STREAK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return _validPrev(parsed) ? parsed : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Persist the streak. Swallows quota/security errors (best-effort).
 * WHY best-effort: a failed write just means no streak context next time —
 * the user still sees the correct streak for this session, and losing
 * streak persistence is far better than an uncaught exception.
 */
export function writeDailyStreak(next) {
  try {
    window.localStorage.setItem(STREAK_KEY, JSON.stringify(next));
  } catch (_e) {
    // Best-effort only — a failed write just means no streak next time.
  }
}
