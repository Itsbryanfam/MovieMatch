// client-tests/turn-motion.test.js — Phase 7.7 Task 0
// WHY: turn-motion.js is the pure zero-import seam (red-carpet.js/chain-recap.js
// pattern) the filmstrip DOM driver consumes. This suite pins the §3.1 Phase
// schema (order/determinism/frozen timings/atMs running-sum/caller-supplied
// think), the isClutchSave boundary, the zero-identity invariant, the barrel
// wiring (the 7.6 lesson — consumers resolve it via ./ui.js), and that the
// clutch boundary stays in agreement with timer-panic.js's 'panic' band.
const fs = require('fs');
const path = require('path');
const { buildTurnTimeline, isClutchSave } = require('../public/js/ui/turn-motion.js');
const { timerSeverity } = require('../public/js/ui/timer-panic.js');

const NAMES = ['handoff', 'think', 'submit', 'reveal', 'impact'];

describe('buildTurnTimeline — §3.1 schema', () => {
  test('ordered handoff→think→submit→reveal→impact with 0-based indices', () => {
    const tl = buildTurnTimeline({ thinkMs: 60000 });
    expect(tl.map(p => p.name)).toEqual(NAMES);
    expect(tl.map(p => p.index)).toEqual([0, 1, 2, 3, 4]);
  });

  test('non-think durations are frozen constants (400/250/600/500)', () => {
    const tl = buildTurnTimeline({ thinkMs: 1234 });
    const byName = Object.fromEntries(tl.map(p => [p.name, p.durMs]));
    expect(byName.handoff).toBe(400);
    expect(byName.submit).toBe(250);
    expect(byName.reveal).toBe(600);
    expect(byName.impact).toBe(500);
  });

  test('think.durMs is the caller-supplied thinkMs (floored)', () => {
    expect(buildTurnTimeline({ thinkMs: 60000 })[1].durMs).toBe(60000);
    expect(buildTurnTimeline({ thinkMs: 1500.9 })[1].durMs).toBe(1500);
  });

  test('omitted / non-finite / non-positive thinkMs → 0 (producer is clock-free)', () => {
    expect(buildTurnTimeline()[1].durMs).toBe(0);
    expect(buildTurnTimeline({})[1].durMs).toBe(0);
    expect(buildTurnTimeline({ thinkMs: NaN })[1].durMs).toBe(0);
    expect(buildTurnTimeline({ thinkMs: -5 })[1].durMs).toBe(0);
    expect(buildTurnTimeline({ thinkMs: 'x' })[1].durMs).toBe(0);
  });

  test('atMs is the running sum of prior durMs', () => {
    const tl = buildTurnTimeline({ thinkMs: 1000 });
    expect(tl.map(p => p.atMs)).toEqual([0, 400, 1400, 1650, 2250]);
  });

  test('deterministic — same input ⇒ deep-equal output', () => {
    expect(buildTurnTimeline({ thinkMs: 5000, clutch: true }))
      .toEqual(buildTurnTimeline({ thinkMs: 5000, clutch: true }));
  });

  test('impact.meta.clutch reflects input.clutch (default false)', () => {
    expect(buildTurnTimeline({ thinkMs: 1 })[4].meta.clutch).toBe(false);
    expect(buildTurnTimeline({ thinkMs: 1, clutch: true })[4].meta.clutch).toBe(true);
    expect(buildTurnTimeline({ thinkMs: 1, clutch: 'truthy' })[4].meta.clutch).toBe(true);
  });

  test('zero-identity sentinel — no identifier can appear in the schedule', () => {
    const json = JSON.stringify(buildTurnTimeline({ thinkMs: 42, clutch: true }));
    expect(json).not.toMatch(/stableId|socket|playerId|_id/i);
    expect(json).not.toContain('undefined');
  });
});

describe('isClutchSave — predicate', () => {
  test('invalid move is never a clutch save', () => {
    expect(isClutchSave({ valid: false, secondsRemaining: 1 })).toBe(false);
    expect(isClutchSave({ secondsRemaining: 1 })).toBe(false);
    expect(isClutchSave()).toBe(false);
  });
  test('valid move outside the panic window is not a clutch save', () => {
    expect(isClutchSave({ valid: true, secondsRemaining: 6 })).toBe(false);
    expect(isClutchSave({ valid: true, secondsRemaining: 10 })).toBe(false);
  });
  test('valid move inside the panic window IS a clutch save', () => {
    expect(isClutchSave({ valid: true, secondsRemaining: 5 })).toBe(true);
    expect(isClutchSave({ valid: true, secondsRemaining: 3 })).toBe(true);
    expect(isClutchSave({ valid: true, secondsRemaining: 0 })).toBe(true);
    expect(isClutchSave({ valid: true, secondsRemaining: -2 })).toBe(true); // overran clock clamps to 0
  });
  test('non-finite secondsRemaining → false (unknown state never flashes clutch)', () => {
    expect(isClutchSave({ valid: true, secondsRemaining: NaN })).toBe(false);
    expect(isClutchSave({ valid: true, secondsRemaining: 'x' })).toBe(false);
    expect(isClutchSave({ valid: true })).toBe(false);
  });
});

describe('integration invariants', () => {
  test('barrel wiring — public/js/ui.js re-exports turn-motion (the 7.6 lesson)', () => {
    // Source assertion (not an import) so this pure suite never loads the
    // DOM-heavy barrel; pins that consumers/other tests resolve the seam.
    const barrel = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');
    expect(barrel).toContain("export * from './ui/turn-motion.js'");
  });

  test('clutch boundary stays in agreement with timer-panic.js panic band', () => {
    // timerSeverity: <=5 'panic'. isClutchSave must mirror that exact boundary
    // (CLUTCH_PANIC_MAX_SECONDS is a frozen local const to keep turn-motion.js
    // zero-import; THIS test is the anti-drift guarantee).
    for (const s of [0, 3, 5]) {
      expect(timerSeverity(s)).toBe('panic');
      expect(isClutchSave({ valid: true, secondsRemaining: s })).toBe(true);
    }
    expect(timerSeverity(6)).not.toBe('panic');
    expect(isClutchSave({ valid: true, secondsRemaining: 6 })).toBe(false);
  });
});
