/**
 * @jest-environment jsdom
 */
// Phase 7.5.1 — Seat-Table redesign glue. WHY: prove (a) the live colour
// collision is fixed — a full 8-player lobby yields 8 DISTINCT --card-accent
// values, host = seat 0 = SEAT_HUES[0]; (b) the ONE additive .lobby-stage
// wrapper exists and contains both the players list and the Director panel
// (the desktop sidebar/grid + mobile stack is pure CSS, jsdom can't lay out);
// (c) team-mode still early-returns (no entrance cards / no .lobby-stage build).
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

describe('renderLobby — Seat-Table redesign', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('full 8-player lobby → 8 DISTINCT --card-accent values (collision fixed)', () => {
    renderLobby(makeWaitingState({ id: 'ST1', players: eightPlayers() }), 'p0');
    const accents = [...document.querySelectorAll('#lobby-players li.entrance-card')]
      .map(li => li.style.getPropertyValue('--card-accent'));
    expect(accents).toHaveLength(8);
    expect(new Set(accents).size).toBe(8);
  });

  test('host is seat 0 → host tile --card-accent == SEAT_HUES[0]', () => {
    renderLobby(makeWaitingState({ id: 'ST2', players: eightPlayers() }), 'p0');
    const first = document.querySelector('#lobby-players li.entrance-card');
    expect(first.textContent).toContain('Host');
    expect(first.style.getPropertyValue('--card-accent')).toBe(String(SEAT_HUES[0]));
  });

  test('ONE additive .lobby-stage wraps the players list AND the Director panel', () => {
    renderLobby(makeWaitingState({ id: 'ST3' }), 'host_id');
    const stage = document.querySelector('#waiting-room .lobby-stage');
    expect(stage).not.toBeNull();
    expect(stage.querySelector('.players-list-container #lobby-players')).not.toBeNull();
    expect(stage.querySelector('.director-panel')).not.toBeNull();
    expect(document.querySelector('.lobby-stage #team-screen')).toBeNull();
  });

  test('team mode: early-return untouched — no entrance cards / no stage build', () => {
    renderLobby(makeWaitingState({ gameMode: 'team', id: 'ST4' }), 'host_id');
    expect(document.querySelectorAll('#lobby-players li.entrance-card').length).toBe(0);
    expect(document.querySelectorAll('#team-red-list li, #team-blue-list li').length)
      .toBeGreaterThan(0);
  });
});
