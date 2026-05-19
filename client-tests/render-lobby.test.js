/**
 * @jest-environment jsdom
 */
// Phase 7.5.2 — renderLobby theater seats. The kick control is the host's
// only way to remove a stuck player; mis-rendering it would lock players out
// or expose it to non-hosts. Pins the §4 behavioural-equivalence kick
// contract on the NEW .seat-kick element (was .btn-kick pre-7.5.2).
const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
const mockEmit = jest.fn();
jest.mock('../public/js/state.js', () => ({
  getSocket: () => ({ emit: mockEmit }),
  getCurrentLobbyId: () => 'TEST01',
}));
import { initUIElements, renderLobby } from '../public/js/ui.js';

describe('renderLobby — theater seats + kick wiring', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('always renders exactly 8 seats; first N occupied carry name + host crown', () => {
    renderLobby(makeWaitingState(), 'host_id'); // 2 players
    const seats = document.querySelectorAll('#lobby-players li.seat');
    expect(seats.length).toBe(8);
    const occ = document.querySelectorAll('#lobby-players li.seat.occupied');
    expect(occ.length).toBe(2);
    expect(occ[0].textContent).toContain('Host');
    expect(occ[0].textContent).toContain('♛');
    expect(occ[1].textContent).toContain('Guest');
    expect(document.querySelectorAll('#lobby-players li.seat:not(.occupied)').length).toBe(6);
  });

  test('host sees one .seat-kick (on the guest, not on self)', () => {
    renderLobby(makeWaitingState(), 'host_id');
    expect(document.querySelectorAll('#lobby-players .seat-kick').length).toBe(1);
    const occ = document.querySelectorAll('#lobby-players li.seat.occupied');
    expect(occ[0].querySelector('.seat-kick')).toBeNull();   // host's own seat
    expect(occ[1].querySelector('.seat-kick')).not.toBeNull();
  });

  test('non-host sees zero .seat-kick', () => {
    renderLobby(makeWaitingState(), 'guest_id');
    expect(document.querySelectorAll('#lobby-players .seat-kick').length).toBe(0);
  });

  test('clicking .seat-kick emits kickPlayer with the byte-identical payload', () => {
    renderLobby(makeWaitingState(), 'host_id');
    document.querySelector('#lobby-players .seat-kick').click();
    expect(mockEmit).toHaveBeenCalledWith('kickPlayer', {
      lobbyId: 'TEST01', targetId: 'guest_id',
    });
  });

  test('bot kick emits removeBot with the byte-identical payload', () => {
    const state = makeWaitingState({ players: [
      makePlayer({ id: 'host_id', name: 'Host', isHost: true }),
      makePlayer({ id: 'bot_id', name: 'Bot Bogart', isBot: true }),
    ]});
    renderLobby(state, 'host_id');
    document.querySelector('#lobby-players li.seat.occupied:nth-child(2) .seat-kick').click();
    expect(mockEmit).toHaveBeenCalledWith('removeBot', {
      lobbyId: 'TEST01', targetId: 'bot_id',
    });
  });

  test('#seated-count / #seated-hint reflect roster size', () => {
    renderLobby(makeWaitingState(), 'host_id'); // 2 players
    expect(document.getElementById('seated-count').textContent).toBe('2');
    expect(document.getElementById('seated-hint').textContent)
      .toBe('Ready when the Director rolls camera.');
    renderLobby(makeWaitingState({ players: [ makePlayer({ id: 'host_id', name: 'Host', isHost: true }) ] }), 'host_id');
    expect(document.getElementById('seated-count').textContent).toBe('1');
    expect(document.getElementById('seated-hint').textContent).toBe('Waiting for more cast…');
  });
});
