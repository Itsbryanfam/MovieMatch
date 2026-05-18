/**
 * @jest-environment jsdom
 */
// Phase 7.5 — Red Carpet glue (renderLobby). WHY: prove the entrance
// animation fires ONCE per real arrival (never on the idempotent re-render
// every settings toggle / stateUpdate triggers), the host-crown / kick /
// Director controls are byte-identically preserved, NO stableId reaches
// #waiting-room, and the team path is untouched.
// The no-replay guarantee holds within a page session (module-scoped
// _seenPlayerIds, keyed by lobby id); a new lobby id is a fresh premiere.
const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
const mockEmit = jest.fn();
jest.mock('../public/js/state.js', () => ({
  getSocket: () => ({ emit: mockEmit }),
  getCurrentLobbyId: () => 'TEST01',
}));
import { initUIElements, renderLobby } from '../public/js/ui.js';

describe('renderLobby — Red Carpet entrance cards', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('first render: every player .is-entering; cards carry accent + emoji', () => {
    renderLobby(makeWaitingState({ id: 'RC1' }), 'host_id');
    const cards = document.querySelectorAll('#lobby-players li.entrance-card');
    expect(cards.length).toBe(2);
    cards.forEach(c => {
      expect(c.classList.contains('is-entering')).toBe(true);
      expect(c.style.getPropertyValue('--card-accent')).not.toBe('');
      expect(c.querySelector('.entrance-card__emoji').textContent).not.toBe('');
    });
  });

  test('re-render with the SAME roster → zero .is-entering (no replay)', () => {
    const state = makeWaitingState({ id: 'RC2' });
    renderLobby(state, 'host_id');
    renderLobby(state, 'host_id'); // e.g. a settings toggle re-render
    expect(document.querySelectorAll('#lobby-players li.is-entering').length).toBe(0);
  });

  test('only a newly-joined player animates on the next render', () => {
    const s1 = makeWaitingState({ id: 'RC3' });
    renderLobby(s1, 'host_id');
    const s2 = makeWaitingState({ id: 'RC3', players: [...s1.players, makePlayer({ id: 'new_id', name: 'Newcomer' })] });
    renderLobby(s2, 'host_id');
    const entering = [...document.querySelectorAll('#lobby-players li.is-entering')];
    expect(entering.length).toBe(1);
    expect(entering[0].textContent).toContain('Newcomer');
  });

  test('host crown + kick wiring preserved byte-identically (zero-regression)', () => {
    renderLobby(makeWaitingState({ id: 'RC4' }), 'host_id');
    const items = document.querySelectorAll('#lobby-players li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Host');
    expect(items[0].textContent).toContain('👑');
    expect(items[0].querySelector('.btn-kick')).toBeNull();
    const kick = items[1].querySelector('.btn-kick');
    expect(kick).not.toBeNull();
    kick.click();
    expect(mockEmit).toHaveBeenCalledWith('kickPlayer', { lobbyId: 'RC4', targetId: 'guest_id' });
  });

  test('Director panel present; Roll-Camera gating byte-identical', () => {
    renderLobby(makeWaitingState({ id: 'RC5' }), 'host_id'); // host, 2 players, classic
    expect(document.querySelector('.director-panel')).not.toBeNull();
    const start = document.getElementById('start-btn');
    expect(start.classList.contains('roll-camera')).toBe(true);
    expect(start.disabled).toBe(false);
    expect(start.textContent).toContain('Roll Camera');
    renderLobby(makeWaitingState({ id: 'RC5' }), 'guest_id'); // non-host → disabled
    expect(document.getElementById('start-btn').disabled).toBe(true);
  });

  test('SECURITY: no stableId substring anywhere in #waiting-room', () => {
    const state = makeWaitingState({ id: 'RC6' });
    state.players.forEach(p => { p.stableId = 'p_LEAK_' + p.id; });
    renderLobby(state, 'host_id');
    expect(document.getElementById('waiting-room').innerHTML).not.toContain('p_LEAK_');
  });

  test('team mode: no entrance cards built (team early-return untouched)', () => {
    renderLobby(makeWaitingState({ gameMode: 'team', id: 'RC7' }), 'host_id');
    expect(document.querySelectorAll('#lobby-players li.entrance-card').length).toBe(0);
    expect(document.querySelectorAll('#team-red-list li, #team-blue-list li').length)
      .toBeGreaterThan(0);
  });
});
