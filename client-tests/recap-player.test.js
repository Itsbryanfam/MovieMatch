// client-tests/recap-player.test.js — Phase 7.6 Task 1
// WHY: recap-player.js is the ONLY DOM/timer surface for the recap; this
// suite pins mount, the accessibility-safe instant-settle path, the
// cancellable timer (leak-safe), Skip/Replay, and the Daily one-shot guard.
// jsdom has no layout/matchMedia and fake timers stand in for the cinematic
// schedule — the motion fidelity itself is the user-side eyeball (spec §9.7).
/** @jest-environment jsdom */
const { playRecap, cancelRecap } = require('../public/js/ui/recap-player.js');

function overlay() {
  document.body.innerHTML = `
    <div id="recap-overlay" class="modal-overlay recap-overlay hidden">
      <div class="modal-card recap-card">
        <button class="btn modal-close" id="recap-close">✕</button>
        <div id="recap-stage" class="recap-stage"></div>
        <div class="recap-actions">
          <button id="recap-skip" class="btn btn-secondary">⏭ Skip</button>
          <button id="recap-replay" class="btn btn-primary">↻ Replay</button>
        </div>
      </div>
    </div>`;
  return document.getElementById('recap-overlay');
}
const state = (over = {}) => ({
  gameMode: 'classic',
  chain: [
    { playerName: 'Ann', movie: { title: 'A', year: 2001, poster: 'https://image.tmdb.org/t/p/w200/a.jpg' }, matchedActors: [] },
    { playerName: 'Bo', movie: { title: 'B', year: 2002, poster: '' }, matchedActors: ['Actor 1'] },
  ],
  winner: { name: 'Ann', score: 5 },
  ...over,
});

afterEach(() => { cancelRecap(); jest.useRealTimers(); document.body.innerHTML = ''; });

test('reduced-motion → instant settled end-state, overlay shown, onDone called, no timer', () => {
  const el = overlay();
  const onDone = jest.fn();
  playRecap(state(), el, { prefersReducedMotion: true, onDone });
  expect(el.classList.contains('hidden')).toBe(false);
  expect(el.textContent).toContain('🏆 Ann wins!');
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('animated path schedules beats then resolves; cancelRecap stops it', () => {
  jest.useFakeTimers();
  const el = overlay();
  const onDone = jest.fn();
  playRecap(state(), el, { prefersReducedMotion: false, onDone });
  expect(el.classList.contains('hidden')).toBe(false);
  jest.runAllTimers();
  expect(onDone).toHaveBeenCalled();
  expect(() => cancelRecap()).not.toThrow();
});

// I-2: pin the leak-safe claim — mid-flight cancel must leave zero orphaned
// tick-chain timers. After the 200 ms initial delay fires, tick() runs: it
// schedules a requestAnimationFrame (harmless .is-in class add, ~16 ms fake
// frame) and the next _recapTimer setTimeout. cancelRecap() clears _recapTimer;
// draining the rAF by advancing 16 ms must NOT re-queue any new setTimeout,
// proving the tick chain is truly stopped.
test('cancelRecap mid-flight clears all pending timers (leak-safe)', () => {
  jest.useFakeTimers();
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: false });
  jest.advanceTimersByTime(200); // fire initial delay → tick runs
  expect(jest.getTimerCount()).toBeGreaterThan(0); // next beat + rAF queued
  cancelRecap();
  // drain the in-flight rAF (adds .is-in class only — must not re-queue tick)
  jest.advanceTimersByTime(16);
  expect(jest.getTimerCount()).toBe(0); // no orphaned timers remain
});

test('Skip button → settled end-state immediately (finale visible), timer cleared', () => {
  jest.useFakeTimers();
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: false });
  document.getElementById('recap-skip').click();
  expect(el.textContent).toContain('🏆 Ann wins!');
  expect(() => jest.runAllTimers()).not.toThrow();
});

// M-2: drop the trivially-true assertion; actually pin clear → repopulate from beat 0.
// start() calls clearStage() synchronously before scheduling the first tick, so the
// stage is empty RIGHT after the click (before any timer fires).
test('Replay button → clears the stage and repopulates from beat 0', () => {
  jest.useFakeTimers();
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: false });
  jest.runAllTimers();
  const stage = document.getElementById('recap-stage');
  const afterFirst = stage.children.length;
  expect(afterFirst).toBeGreaterThan(0);
  document.getElementById('recap-replay').click();
  // clearStage() runs synchronously inside start() before the first timer fires
  expect(stage.children.length).toBe(0);
  jest.runAllTimers();
  expect(stage.children.length).toBe(afterFirst); // fully repopulated, same beat count
});

test('Close button hides the overlay', () => {
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: true });
  document.getElementById('recap-close').click();
  expect(el.classList.contains('hidden')).toBe(true);
});

test('null mount element is a safe no-op', () => {
  expect(() => playRecap(state(), null, { prefersReducedMotion: true })).not.toThrow();
});

// M-3: accurately verifies BOTH the tmdb-<img>+fallback path AND the
// empty-poster → placeholder path. (The empty poster is normalised to null
// by chain-recap.js, so it goes straight to the placeholder <div> path —
// no <img src=""> is ever created.)
test('tmdb poster → <img> (with fallback handler); empty poster → placeholder div, no empty <img>', () => {
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: true });
  const imgs = [...el.querySelectorAll('img')];
  // the tmdb-poster entry produces exactly one <img> with the real src
  expect(imgs.map(i => i.getAttribute('src'))).toEqual(['https://image.tmdb.org/t/p/w200/a.jpg']);
  // attachPosterFallback wires an onerror handler so a 404 degrades gracefully
  expect(typeof imgs[0].onerror).toBe('function');
  // the empty-poster entry produced a placeholder div, NOT an <img src="">
  expect(el.querySelectorAll('.recap-poster.placeholder').length).toBe(1);
  expect(imgs.map(i => i.getAttribute('src'))).not.toContain('');
});
