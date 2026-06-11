/**
 * @jest-environment jsdom
 */
// client-tests/turn-motion.test.js — Phase 7.7 Task 0 (T6c behavior conversion)
// WHY: turn-motion.js is the pure zero-import seam the filmstrip DOM driver
// (choreographTurn in ui-render.js) consumes. The pure schema/predicate tests
// below import + call + assert OUTPUT (already behavior, not source text). T6c
// removes the one source-substring assertion that remained — the old
// "barrel re-exports turn-motion" test that did fs.readFileSync + a .toContain
// on ui.js source. It is replaced by:
//   (1) a re-export-BY-USE test (import the seam through the ui.js barrel and
//       assert it behaves identically to the leaf import), and
//   (2) a DOM test that ties isClutchSave's boundary to the REAL rendered
//       motion class (.clutch on the now-playing hero), so the predicate's
//       contract is observable in the rendered filmstrip rather than asserted
//       against a string.
const { loadIndexHtml, makePlayingState } = require('./fixtures');
const { buildTurnTimeline, isClutchSave } = require('../public/js/ui/turn-motion.js');
const { timerSeverity } = require('../public/js/ui/timer-panic.js');
// Barrel re-exports: imported here so the "by use" test can prove the ui.js
// barrel forwards the same seam (replacing the old source-substring grep).
const barrel = require('../public/js/ui.js');
const { initUIElements, renderGame, markClutchSave } = barrel;

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
  // T6c: re-export BY USE (replaces the old fs.readFileSync source-substring
  // grep). If the ui.js barrel forwards the seam, the functions imported from
  // the barrel behave identically to the leaf imports — a behavioral proof the
  // re-export wiring is live, not a string match against source.
  test('ui.js barrel re-exports the turn-motion seam (proven by behavior)', () => {
    expect(typeof barrel.buildTurnTimeline).toBe('function');
    expect(typeof barrel.isClutchSave).toBe('function');
    // Same output as the leaf import for a representative input.
    expect(barrel.buildTurnTimeline({ thinkMs: 1000, clutch: true }))
      .toEqual(buildTurnTimeline({ thinkMs: 1000, clutch: true }));
    expect(barrel.isClutchSave({ valid: true, secondsRemaining: 3 }))
      .toBe(isClutchSave({ valid: true, secondsRemaining: 3 }));
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

// T6c: DOM behavior — tie isClutchSave's predicate to the REAL rendered motion
// class. When a clutch save is signalled, the filmstrip's now-playing hero node
// gets the .clutch motion class + one .clutch-flash overlay; an ordinary save
// gets neither. This exercises the seam through the actual render driver
// (choreographTurn ← renderGame) rather than asserting on source text. (The
// exhaustive one-shot-consume / settled cases are owned by render-chain.test.js;
// here we pin only the predicate↔motion-class correspondence.)
describe('isClutchSave ↔ rendered .clutch motion class (DOM)', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); });
  afterEach(() => { document.body.innerHTML = ''; });

  const display = () => document.getElementById('chain-display');
  const heroNode = () => display().querySelector('.reel-node.now-playing');

  function chainOf(n) {
    // n filmstrip entries; the last is the now-playing hero choreographTurn drives.
    return Array.from({ length: n }, (_, i) => ({
      movie: { title: `M${i}`, year: 2000 + i, cast: ['A'], poster: '' },
      playerName: 'Host',
      matchedActors: i === 0 ? [] : ['A'],
    }));
  }

  test('a clutch-range save (secondsRemaining ≤ 5) renders .clutch + one .clutch-flash', () => {
    // Sanity: the predicate classifies this move as a clutch save…
    expect(isClutchSave({ valid: true, secondsRemaining: 3 })).toBe(true);
    // …and the render driver, when told a clutch occurred, paints the class.
    markClutchSave();
    renderGame(makePlayingState({ chain: chainOf(2) }), 'host_id', false);

    expect(heroNode().classList.contains('clutch')).toBe(true);
    expect(heroNode().querySelectorAll('.clutch-flash')).toHaveLength(1);
  });

  test('a non-clutch save (secondsRemaining > 5) renders no .clutch class', () => {
    // Predicate says NOT a clutch save…
    expect(isClutchSave({ valid: true, secondsRemaining: 9 })).toBe(false);
    // …and without markClutchSave() the rendered hero carries no clutch motion.
    renderGame(makePlayingState({ chain: chainOf(2) }), 'host_id', false);

    expect(heroNode().classList.contains('clutch')).toBe(false);
    expect(display().querySelector('.clutch-flash')).toBeNull();
    // Every settled turn ends in the .settled end-state regardless.
    expect(heroNode().classList.contains('settled')).toBe(true);
  });
});

// Booth review-fix [animation-cleanup]: on a WINNING turn the now-playing hero
// is also the newly-spliced node, so it carries BOTH .booth-splice-enter and
// .booth-match-win. Regression guarded here: with no compound CSS rule the
// splice selector (0,5,0) outranked the win-beam selector (0,4,0) and
// boothWinBeam never fired, so onWinEnd never saw its keyframe end →
// .booth-match-win was never stripped and the animationend listener leaked
// every win turn. This test pins the JS contract the CSS fix enables:
// onWinEnd ignores the splice keyframe and strips the class ONLY when a
// win-beam-family keyframe ends. (CSS specificity itself is enforced by the
// rule's existence; jsdom does not compute cascade winners, so we assert the
// cleanup logic against the keyframe names the corrected CSS guarantees fire.)
describe('win-turn animation cleanup (booth-match-win)', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); });
  afterEach(() => { document.body.innerHTML = ''; });

  const display = () => document.getElementById('chain-display');
  const heroNode = () => display().querySelector('.reel-node.now-playing');

  function chainOf(n) {
    return Array.from({ length: n }, (_, i) => ({
      movie: { title: `M${i}`, year: 2000 + i, cast: ['A'], poster: '' },
      playerName: 'Host',
      matchedActors: i === 0 ? [] : ['A'],
    }));
  }

  // Dispatch an animationend that bubbles from the hero's .reel-poster (where
  // the keyframes run) up to the heroNode listener — the real event path.
  function fireAnimEnd(name) {
    const poster = heroNode().querySelector('.reel-poster');
    const ev = new Event('animationend', { bubbles: true });
    // jsdom has no AnimationEvent ctor; set the name the handler reads.
    ev.animationName = name;
    poster.dispatchEvent(ev);
  }

  test('strips .booth-match-win ONLY after boothWinBeam, not after the splice keyframe', () => {
    // Fresh render of a grown winning chain: prevCount=0 ⇒ grew=true, so the
    // hero gets .booth-splice-enter AND (via gameState.winner) .booth-match-win.
    renderGame(
      makePlayingState({
        chain: chainOf(3),
        status: 'finished',
        winner: { name: 'Host', score: 10 },
      }),
      'host_id',
      false
    );

    const hero = heroNode();
    // Both classes coexist on the winning entering hero.
    expect(hero.classList.contains('booth-match-win')).toBe(true);
    expect(hero.classList.contains('booth-splice-enter')).toBe(true);

    // The splice keyframe ending first must NOT strip the win class — the old
    // code only listened for boothWinBeam, which the splice rule suppressed.
    fireAnimEnd('boothSpliceAdvance');
    expect(hero.classList.contains('booth-match-win')).toBe(true);

    // The win-beam keyframe ending strips the class (and detaches the listener).
    fireAnimEnd('boothWinBeam');
    expect(hero.classList.contains('booth-match-win')).toBe(false);

    // Idempotent: a later stray animationend must not throw or re-toggle.
    fireAnimEnd('boothWinBeam');
    expect(hero.classList.contains('booth-match-win')).toBe(false);
  });

  test('reduced-motion win keyframe (boothWinBeamReduced) also strips the class', () => {
    // Under prefers-reduced-motion the CSS substitutes boothWinBeamReduced for
    // boothWinBeam; onWinEnd must accept that family member too or it leaks.
    renderGame(
      makePlayingState({
        chain: chainOf(2),
        status: 'finished',
        winner: { name: 'Host', score: 7 },
      }),
      'host_id',
      false
    );

    const hero = heroNode();
    expect(hero.classList.contains('booth-match-win')).toBe(true);
    // Splice (reduced) keyframe alone does not strip…
    fireAnimEnd('boothSpliceAppear');
    expect(hero.classList.contains('booth-match-win')).toBe(true);
    // …the reduced win-beam keyframe does.
    fireAnimEnd('boothWinBeamReduced');
    expect(hero.classList.contains('booth-match-win')).toBe(false);
  });
});
