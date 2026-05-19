/**
 * @jest-environment jsdom
 */
// Phase 7.5.2 — theater seat colour contract. Proves the 7.5.1 collision fix
// still holds end-to-end in the theater DOM: a full 8-player lobby yields 8
// DISTINCT --avatar-hue values (= SEAT_HUES, fed by the UNCHANGED seam), the
// host is seat 0 = SEAT_HUES[0], and team mode builds no seats.
const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
const mockEmit = jest.fn();
jest.mock('../public/js/state.js', () => ({
  getSocket: () => ({ emit: mockEmit }),
  getCurrentLobbyId: () => 'TEST01',
}));
import { initUIElements, renderLobby } from '../public/js/ui.js';
import { SEAT_HUES } from '../public/js/ui/red-carpet.js';

const eightPlayers = () => ([
  makePlayer({ id: 'p0', name: 'Host', isHost: true }),
  makePlayer({ id: 'p1', name: 'Bot Bogart', isBot: true }),
  makePlayer({ id: 'p2', name: 'Bot Kurosawa', isBot: true }),
  makePlayer({ id: 'p3', name: 'Bot Coppola', isBot: true }),
  makePlayer({ id: 'p4', name: 'Bot Spielberg', isBot: true }),
  makePlayer({ id: 'p5', name: 'Bot Kubrick', isBot: true }),
  makePlayer({ id: 'p6', name: 'Bot Nolan', isBot: true }),
  makePlayer({ id: 'p7', name: 'Bot Scott', isBot: true }),
]);

describe('renderLobby — theater seat colour', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('full 8-player lobby → 8 DISTINCT --avatar-hue (collision-free)', () => {
    renderLobby(makeWaitingState({ id: 'ST1', players: eightPlayers() }), 'p0');
    const hues = [...document.querySelectorAll('#lobby-players li.seat.occupied')]
      .map(li => li.style.getPropertyValue('--avatar-hue'));
    expect(hues).toHaveLength(8);
    expect(new Set(hues).size).toBe(8);
  });

  test('host is seat 0 → --avatar-hue == SEAT_HUES[0]', () => {
    renderLobby(makeWaitingState({ id: 'ST2', players: eightPlayers() }), 'p0');
    const first = document.querySelector('#lobby-players li.seat.occupied');
    expect(first.textContent).toContain('Host');
    expect(first.style.getPropertyValue('--avatar-hue')).toBe(String(SEAT_HUES[0]));
  });

  test('exactly 8 <li.seat>; 2-player roster → 2 occupied + 6 empty', () => {
    renderLobby(makeWaitingState({ id: 'ST3' }), 'host_id');
    expect(document.querySelectorAll('#lobby-players li.seat').length).toBe(8);
    expect(document.querySelectorAll('#lobby-players li.seat.occupied').length).toBe(2);
    const empties = document.querySelectorAll('#lobby-players li.seat:not(.occupied)');
    expect(empties.length).toBe(6);
    expect(empties[0].querySelector('.seat-num')).not.toBeNull();
  });

  test('team mode: early-return untouched — no seats built', () => {
    renderLobby(makeWaitingState({ gameMode: 'team', id: 'ST4' }), 'host_id');
    expect(document.querySelectorAll('#lobby-players li.seat').length).toBe(0);
    expect(document.querySelectorAll('#team-red-list li, #team-blue-list li').length)
      .toBeGreaterThan(0);
  });

  test('a picked hue stays distinct end-to-end (claim overrides the slot hue)', () => {
    const players = eightPlayers();
    players[7] = makePlayer({ id: 'p7', name: 'Bot Scott', isBot: true, colorHue: SEAT_HUES[0] === SEAT_HUES[7] ? SEAT_HUES[1] : SEAT_HUES[0] });
    // p7 claimed seat-0's hue; p0 (host, un-picked) keeps SEAT_HUES[0].
    // The picked seat must render the CLAIMED hue, not its slot-7 hue.
    renderLobby(makeWaitingState({ id: 'STP', players }), 'p0');
    const seats = [...document.querySelectorAll('#lobby-players li.seat.occupied')];
    expect(seats[7].style.getPropertyValue('--avatar-hue')).toBe(String(SEAT_HUES[0]));
    expect(seats[7].classList.contains('has-picked')).toBe(true);
  });
});
