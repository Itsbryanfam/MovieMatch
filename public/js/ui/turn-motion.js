// public/js/ui/turn-motion.js — Phase 7.7 pure per-turn motion timeline +
// clutch-save predicate.
// WHY: this is the single, reusable, ZERO-IMPORT pure seam (the red-carpet.js /
// chain-recap.js pattern). It owns NO DOM, NO timers, NO clock, NO randomness,
// so it is fully unit-testable; the filmstrip DOM driver in ui-render.js
// consumes it. buildTurnTimeline + isClutchSave are bundled here because both
// are "turn dynamics" always used together by that one driver — the
// one-pure-engine-per-sub-phase precedent (red-carpet.js bundles diffArrivals/
// playerCardModel/…; chain-recap.js bundles buildRecapStoryboard/…).

// Frozen per-phase durations (ms). 'think' is intentionally NOT here — its
// duration is the live turn length, supplied by the caller, so this producer
// never reads a clock. WHY these values: the non-think choreography must be
// tight (it runs EVERY turn, not once) — 400+250+600+500 = 1750ms ≈ spec
// §3.1's ~1.75s budget.
const PHASE_DURATIONS = Object.freeze({ handoff: 400, submit: 250, reveal: 600, impact: 500 });

// WHY a frozen local constant (not an import): turn-motion.js is a ZERO-IMPORT
// pure seam (the red-carpet.js invariant the spec §3.2 states verbatim). This
// mirrors timer-panic.js timerSeverity()'s `<= 5` 'panic' band — the single
// conceptual source. turn-motion.test.js imports timerSeverity and asserts
// isClutchSave agrees at the 4/5/6s boundary, so the two can never drift.
const CLUTCH_PANIC_MAX_SECONDS = 5;

/**
 * Build the deterministic per-turn motion timeline.
 * @param {{ thinkMs?: number, clutch?: boolean }} [input]
 *   thinkMs — the live turn length (caller-supplied; the ONLY non-frozen
 *             duration). Omitted/non-finite/≤0 → 0 (producer never reads a clock).
 *   clutch  — whether this turn ended in a clutch save (drives impact.meta).
 * @returns {Array<{name:string,index:number,atMs:number,durMs:number,meta:object}>}
 *   ordered handoff→think→submit→reveal→impact; atMs = running sum of prior durMs.
 */
export function buildTurnTimeline(input = {}) {
  const raw = input && input.thinkMs;
  const thinkMs = (typeof raw === 'number' && Number.isFinite(raw) && raw > 0)
    ? Math.floor(raw) : 0;
  const clutch = !!(input && input.clutch);
  const spec = [
    ['handoff', PHASE_DURATIONS.handoff, {}],
    ['think', thinkMs, {}],
    ['submit', PHASE_DURATIONS.submit, {}],
    ['reveal', PHASE_DURATIONS.reveal, {}],
    ['impact', PHASE_DURATIONS.impact, { clutch }],
  ];
  let at = 0;
  return spec.map(([name, durMs, meta], index) => {
    const phase = { name, index, atMs: at, durMs, meta };
    at += durMs;
    return phase;
  });
}

/**
 * Pure clutch-save predicate. A "clutch save" = a VALID answer that landed
 * while the turn timer was inside the panic window (mirrors timer-panic.js
 * timerSeverity's 'panic' band, ≤5s). Reads no DOM/timer/clock — the caller
 * supplies plain values.
 * @param {{ valid?: boolean, secondsRemaining?: number }} [input]
 * @returns {boolean}
 */
export function isClutchSave(input = {}) {
  if (!input || input.valid !== true) return false;
  const s = input.secondsRemaining;
  if (typeof s !== 'number' || !Number.isFinite(s)) return false;
  const clamped = s < 0 ? 0 : s;
  return clamped <= CLUTCH_PANIC_MAX_SECONDS;
}
