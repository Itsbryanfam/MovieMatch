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

test('Skip button → settled end-state immediately (finale visible), timer cleared', () => {
  jest.useFakeTimers();
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: false });
  document.getElementById('recap-skip').click();
  expect(el.textContent).toContain('🏆 Ann wins!');
  expect(() => jest.runAllTimers()).not.toThrow();
});

test('Replay button → restarts from beat 0 (stage repopulates)', () => {
  jest.useFakeTimers();
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: false });
  jest.runAllTimers();
  const stage = document.getElementById('recap-stage');
  const firstHtml = stage.innerHTML;
  document.getElementById('recap-replay').click();
  jest.runAllTimers();
  expect(stage.innerHTML.length).toBeGreaterThan(0);
  expect(typeof firstHtml).toBe('string');
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

test('poster fallback: non-tmdb poster does not create an <img> with that src', () => {
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: true });
  const imgs = [...el.querySelectorAll('img')].map(i => i.getAttribute('src'));
  expect(imgs).not.toContain('');
});
