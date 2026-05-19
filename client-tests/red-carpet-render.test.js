/**
 * @jest-environment jsdom
 */
// Phase 7.5.2 — Theater seats glue. Proves the entrance fires ONCE per real
// arrival (idempotent re-render replays nothing), host crown / kick / Director
// gating preserved (§4), NO stableId reaches #waiting-room, team path
// untouched. The pure seam (red-carpet.js) is unchanged — only the seat DOM.
const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
const mockEmit = jest.fn();
jest.mock('../public/js/state.js', () => ({
  getSocket: () => ({ emit: mockEmit }),
  getCurrentLobbyId: () => 'TEST01',
}));
import { initUIElements, renderLobby } from '../public/js/ui.js';

describe('renderLobby — theater entrance + preserved behaviour', () => {
  // Each test uses a UNIQUE lobby id (RC1, RC2, …) so the module-scoped
  // _seenPlayerIds/_lastLobbyId in ui-render.js don't bleed between tests
  // without needing a module reset — the entering/idempotent assertions
  // depend on this isolation.
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('first render: occupied seats .entering with --avatar-hue + emoji', () => {
    renderLobby(makeWaitingState({ id: 'RC1' }), 'host_id');
    const occ = document.querySelectorAll('#lobby-players li.seat.occupied');
    expect(occ.length).toBe(2);
    occ.forEach(s => {
      expect(s.classList.contains('entering')).toBe(true);
      expect(s.style.getPropertyValue('--avatar-hue')).not.toBe('');
      expect(s.querySelector('.avatar-emoji').textContent).not.toBe('');
    });
  });

  test('re-render with the SAME roster → zero .entering (no replay)', () => {
    const state = makeWaitingState({ id: 'RC2' });
    renderLobby(state, 'host_id');
    renderLobby(state, 'host_id');
    expect(document.querySelectorAll('#lobby-players li.seat.entering').length).toBe(0);
  });

  test('only a newly-joined player animates on the next render', () => {
    const s1 = makeWaitingState({ id: 'RC3' });
    renderLobby(s1, 'host_id');
    const s2 = makeWaitingState({ id: 'RC3', players: [...s1.players, makePlayer({ id: 'new_id', name: 'Newcomer' })] });
    renderLobby(s2, 'host_id');
    const entering = [...document.querySelectorAll('#lobby-players li.seat.entering')];
    expect(entering.length).toBe(1);
    expect(entering[0].textContent).toContain('Newcomer');
  });

  test('host crown + kick wiring preserved (§4)', () => {
    renderLobby(makeWaitingState({ id: 'RC4' }), 'host_id');
    const occ = document.querySelectorAll('#lobby-players li.seat.occupied');
    expect(occ[0].textContent).toContain('Host');
    expect(occ[0].textContent).toContain('♛');
    expect(occ[0].querySelector('.seat-kick')).toBeNull();
    const kick = occ[1].querySelector('.seat-kick');
    expect(kick).not.toBeNull();
    kick.click();
    expect(mockEmit).toHaveBeenCalledWith('kickPlayer', { lobbyId: 'RC4', targetId: 'guest_id' });
  });

  test('Director controls + Roll-Camera gating byte-identical (§4)', () => {
    renderLobby(makeWaitingState({ id: 'RC5' }), 'host_id');
    expect(document.getElementById('mode-selector')).not.toBeNull();
    expect(document.querySelector('.director-shell')).not.toBeNull();
    const start = document.getElementById('start-btn');
    expect(start.classList.contains('roll-camera')).toBe(true);
    expect(start.disabled).toBe(false);
    expect(start.textContent).toContain('Roll Camera');
    renderLobby(makeWaitingState({ id: 'RC5' }), 'guest_id');
    expect(document.getElementById('start-btn').disabled).toBe(true);
  });

  test('SECURITY: no stableId substring anywhere in #waiting-room', () => {
    const state = makeWaitingState({ id: 'RC6' });
    state.players.forEach(p => { p.stableId = 'p_LEAK_' + p.id; });
    renderLobby(state, 'host_id');
    expect(document.getElementById('waiting-room').innerHTML).not.toContain('p_LEAK_');
  });

  test('team mode: no seats built (team early-return untouched)', () => {
    renderLobby(makeWaitingState({ gameMode: 'team', id: 'RC7' }), 'host_id');
    expect(document.querySelectorAll('#lobby-players li.seat').length).toBe(0);
    expect(document.querySelectorAll('#team-red-list li, #team-blue-list li').length)
      .toBeGreaterThan(0);
  });
});
