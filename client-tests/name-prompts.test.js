/**
 * @jest-environment jsdom
 */
// Phase 7.3 MI-02: the 3 prompt config builders are the unit-testable seam
// (project convention — see daily-name-prompt.test.js:13-15). We pin the
// config shape AND the exact side-effect order of each onSubmit with mock
// deps, so the app.js/ui-panels.js wrappers (Task 2) are correct by
// construction without booting app.js's socket-heavy DOMContentLoaded.
const { loadIndexHtml } = require('./fixtures');
import {
  buildNamePromptConfig, buildJoinPromptConfig, buildDailyPromptConfig,
  createPromptModal,
} from '../public/js/ui.js';

function mkDeps(over = {}) {
  const calls = [];
  const store = new Map();
  const pn = { value: '' };
  return {
    calls, pn,
    deps: {
      socket: { emit: (...a) => calls.push(['emit', ...a]) },
      showScreen: (s) => calls.push(['showScreen', s]),
      getStableId: () => 'SID',
      getPlayerNameInput: () => pn,
      prepareAudio: () => calls.push(['prepareAudio']),
      getPathname: () => '/p',
      history: { replaceState: (...a) => calls.push(['replaceState', ...a]) },
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, v); calls.push(['setItem', k, v]); },
      },
      ...over,
    },
  };
}

describe('buildNamePromptConfig', () => {
  test('shape', () => {
    const { deps } = mkDeps();
    const c = buildNamePromptConfig({ roomCode: 'WXYZ', deps });
    expect(c.title).toBe('Join Game');
    expect(c.subtitle).toBe('Room WXYZ');
    expect(c.fields).toHaveLength(1);
    expect(c.fields[0]).toMatchObject({ maxLength: 24, gap: '1rem' });
    expect(c.fields[0].label).toBeUndefined();
    expect(c.secondary).toBeUndefined();
    expect(c.closeOnBackdrop).toBe(false);
    expect(c.focusDelayMs).toBe(100);
  });

  test('onSubmit side-effects fire in legacy order', () => {
    const { deps, calls, pn } = mkDeps();
    const c = buildNamePromptConfig({ roomCode: 'WXYZ', deps });
    // Phase 7.3 review-fix (M1): track close() in calls so the legacy-order test pins close()'s POSITION (between setItem and showScreen), not just that it was called.
    const close = jest.fn(() => calls.push(['close']));
    c.primary.onSubmit(['  Ada  '], { invalid: jest.fn(), close });
    expect(pn.value).toBe('Ada');
    expect(close).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      ['setItem', 'mm_playerName', 'Ada'],
      ['close'],
      ['showScreen', 'lobby'],
      ['emit', 'joinLobby', { name: 'Ada', lobbyId: 'WXYZ', stableId: 'SID' }],
      ['replaceState', {}, '', '/p'],
    ]);
  });

  test('blank name → invalid(0), no side-effects, no close', () => {
    const { deps, calls } = mkDeps();
    const c = buildNamePromptConfig({ roomCode: 'WXYZ', deps });
    const invalid = jest.fn(); const close = jest.fn();
    c.primary.onSubmit(['   '], { invalid, close });
    expect(invalid).toHaveBeenCalledWith(0);
    expect(close).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('buildJoinPromptConfig', () => {
  test('shape + focusIndex by prefill', () => {
    const empty = mkDeps();
    const c0 = buildJoinPromptConfig({ deps: empty.deps });
    expect(c0.title).toBe('Join a Room');
    expect(c0.subtitle).toBeUndefined();
    expect(c0.fields).toHaveLength(2);
    expect(c0.fields[0]).toMatchObject({ label: 'Your Name', maxLength: 24, gap: '1rem', value: '' });
    expect(c0.fields[1]).toMatchObject({ label: 'Room Code', maxLength: 6, gap: '1.5rem', uppercase: true });
    expect(c0.secondary.label).toBe('Back');
    expect(c0.closeOnBackdrop).toBe(true);
    expect(c0.focusDelayMs).toBe(100);
    expect(c0.focusIndex).toBe(0);

    const pre = mkDeps();
    pre.deps.localStorage.setItem('mm_playerName', 'Bo');
    const c1 = buildJoinPromptConfig({ deps: pre.deps });
    expect(c1.fields[0].value).toBe('Bo');
    expect(c1.focusIndex).toBe(1);
  });

  test('onSubmit uppercases code, fires legacy order incl. prepareAudio', () => {
    const { deps, calls, pn } = mkDeps();
    const c = buildJoinPromptConfig({ deps });
    // Phase 7.3 review-fix (M1): track close() in calls so the legacy-order test pins close()'s POSITION (between setItem and showScreen), not just that it was called.
    const close = jest.fn(() => calls.push(['close']));
    c.primary.onSubmit(['Ada', ' rm12 '], { invalid: jest.fn(), close });
    expect(pn.value).toBe('Ada');
    expect(close).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      ['setItem', 'mm_playerName', 'Ada'],
      ['close'],
      ['prepareAudio'],
      ['showScreen', 'lobby'],
      ['emit', 'joinLobby', { name: 'Ada', lobbyId: 'RM12', stableId: 'SID' }],
    ]);
  });

  test('Back secondary closes', () => {
    const { deps } = mkDeps();
    const c = buildJoinPromptConfig({ deps });
    const close = jest.fn();
    c.secondary.onClick({ close });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('blank name → invalid(0) only', () => {
    const { deps, calls } = mkDeps();
    const c = buildJoinPromptConfig({ deps });
    const invalid = jest.fn(); const close = jest.fn();
    c.primary.onSubmit(['  ', 'RM'], { invalid, close });
    expect(invalid).toHaveBeenCalledWith(0);
    expect(close).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  // Phase 7.3 review-fix (M3): production first-time-visitor path —
  // #player-name-input may not be on screen, so getPlayerNameInput() returns
  // null. The `if (pn)` guard must not throw, for BOTH name & join builders.
  test('getPlayerNameInput() → null is guarded (no #player-name on screen)', () => {
    const { deps } = mkDeps({ getPlayerNameInput: () => null });
    const cn = buildNamePromptConfig({ roomCode: 'WX', deps });
    expect(() => cn.primary.onSubmit(['Ada'], { invalid: jest.fn(), close: jest.fn() }))
      .not.toThrow();
    const cj = buildJoinPromptConfig({ deps });
    expect(() => cj.primary.onSubmit(['Ada', 'rm'], { invalid: jest.fn(), close: jest.fn() }))
      .not.toThrow();
  });
});

describe('buildDailyPromptConfig', () => {
  test('shape', () => {
    const c = buildDailyPromptConfig({ prefill: 'Grace', onConfirm: jest.fn() });
    expect(c.overlayClass).toBe('daily-name-overlay');
    expect(c.title).toBe('🗓️ Daily Challenge');
    expect(c.subtitle).toMatch(/daily leaderboard/i);
    expect(c.fields[0].value).toBe('Grace');
    expect(c.primary).toMatchObject({ label: 'Start Daily Challenge', className: 'daily-name-go' });
    expect(c.secondary).toMatchObject({ label: 'Maybe later', className: 'daily-name-cancel' });
    expect(c.closeOnBackdrop).toBe(true);
    expect(c.focusDelayMs).toBe(0);
  });

  test('onSubmit: trims, closes, then onConfirm(name); blank does nothing', () => {
    const onConfirm = jest.fn();
    const c = buildDailyPromptConfig({ prefill: '', onConfirm });
    const close = jest.fn();
    c.primary.onSubmit(['  Ada  '], { invalid: jest.fn(), close });
    expect(close).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Ada');

    const inv = jest.fn(); const close2 = jest.fn(); onConfirm.mockClear();
    c.primary.onSubmit(['   '], { invalid: inv, close: close2 });
    expect(inv).toHaveBeenCalledWith(0);
    expect(close2).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // Phase 7.3 review-fix (M2): the `if (onConfirm)` guard exists because the
  // caller may omit it (default param) — pin that a valid submit then does
  // not throw and still closes.
  test('no onConfirm: a valid submit closes without throwing', () => {
    const c = buildDailyPromptConfig({});
    const close = jest.fn();
    expect(() => c.primary.onSubmit(['Ada'], { invalid: jest.fn(), close }))
      .not.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('factory + builder integration (daily contract sanity)', () => {
  beforeEach(() => { loadIndexHtml(); try { localStorage.clear(); } catch {} });
  afterEach(() => { document.body.innerHTML = ''; });

  test('createPromptModal(buildDailyPromptConfig) satisfies the daily DOM contract', () => {
    const onConfirm = jest.fn();
    createPromptModal(buildDailyPromptConfig({ prefill: '', onConfirm }));
    const overlay = document.querySelector('.daily-name-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('input')).not.toBeNull();
    expect(overlay.querySelector('.daily-name-go')).not.toBeNull();
    overlay.querySelector('input').value = '  Ada  ';
    overlay.querySelector('.daily-name-go').click();
    expect(onConfirm).toHaveBeenCalledWith('Ada');
    expect(document.querySelector('.daily-name-overlay')).toBeNull();
  });
});
