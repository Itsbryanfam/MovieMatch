// client-tests/showScreen.test.js
// WHY: showScreen() is the one behaviour-logic change in Phase 3. This
// spec pins the canonical group-normalisation contract so the call-site
// migration is provably equivalent to the prior ad-hoc toggling.
import { initUIElements, showScreen } from '../public/js/ui.js';

function setDom() {
  document.body.innerHTML = `
    <div id="hero-screen" class="screen active"></div>
    <div id="lobby-screen" class="screen"></div>
    <div id="game-screen" class="screen"></div>
    <div id="join-panel"></div>
    <div id="private-panel" class="hidden"></div>
    <div id="public-panel" class="hidden"></div>
    <div id="waiting-room" class="hidden"></div>
    <div id="team-screen" class="hidden"></div>`;
  initUIElements();
}
const cls = id => document.getElementById(id).className.trim();
beforeEach(setDom);

test('showScreen("game") activates only game', () => {
  showScreen('game');
  expect(cls('game-screen')).toBe('screen active');
  expect(cls('hero-screen')).toBe('screen');
  expect(cls('lobby-screen')).toBe('screen');
});
test('showScreen("lobby") activates only lobby', () => {
  showScreen('lobby');
  expect(cls('lobby-screen')).toBe('screen active');
  expect(cls('hero-screen')).toBe('screen');
  expect(cls('game-screen')).toBe('screen');
});
test('showScreen("private") shows only private panel', () => {
  showScreen('private');
  expect(cls('private-panel')).toBe('');
  expect(cls('join-panel')).toBe('hidden');
  expect(cls('public-panel')).toBe('hidden');
});
test('showScreen("join") shows only join panel', () => {
  showScreen('private'); showScreen('join');
  expect(cls('join-panel')).toBe('');
  expect(cls('private-panel')).toBe('hidden');
  expect(cls('public-panel')).toBe('hidden');
});
test('showScreen("team") then "waiting" swap', () => {
  showScreen('team');
  expect(cls('team-screen')).toBe(''); expect(cls('waiting-room')).toBe('hidden');
  showScreen('waiting');
  expect(cls('waiting-room')).toBe(''); expect(cls('team-screen')).toBe('hidden');
});
test('top-level toggle does not touch entry panels', () => {
  showScreen('lobby');
  expect(cls('join-panel')).toBe('');
  expect(cls('private-panel')).toBe('hidden');
});

// WHY: guards the default branch — an unrecognised name must warn and leave
// the DOM completely untouched (i.e. no partial mutation before the warn).
test('unknown name warns and does not throw or mutate the DOM', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  expect(() => showScreen('nonexistent')).not.toThrow();
  expect(warn).toHaveBeenCalledWith('showScreen: unknown screen name:', 'nonexistent');
  // DOM untouched: hero was the initially-active screen in setDom()
  expect(cls('hero-screen')).toBe('screen active');
  expect(cls('lobby-screen')).toBe('screen');
  expect(cls('game-screen')).toBe('screen');
  warn.mockRestore();
});

// WHY: guards cross-group isolation — toggling the waiting/team sub-group
// must never spill side-effects into the top-level screen group. This is
// the symmetric counterpart of the 'top-level toggle does not touch entry
// panels' test above, covering the other direction.
test('waiting/team toggle does not touch the top-level screen group', () => {
  // hero is .active from setDom(); normalising the waiting/team sub-group
  // must not alter any top-level .screen .active state.
  showScreen('team');
  expect(cls('hero-screen')).toBe('screen active');
  expect(cls('lobby-screen')).toBe('screen');
  expect(cls('game-screen')).toBe('screen');
  showScreen('waiting');
  expect(cls('hero-screen')).toBe('screen active');
  expect(cls('lobby-screen')).toBe('screen');
  expect(cls('game-screen')).toBe('screen');
});
