/**
 * @jest-environment jsdom
 */

// Coverage for renderLobby — host-only kick button visibility and click wiring.
// The kick button is the host's only way to remove a stuck player from the
// waiting room; mis-rendering this would either lock players out or expose
// the action to non-hosts.

const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');

// state.js exposes getSocket(); we replace it so we can assert what the
// kick button emits without spinning up real Socket.io.
const mockEmit = jest.fn();
jest.mock('../public/js/state.js', () => ({
  getSocket: () => ({ emit: mockEmit }),
  getCurrentLobbyId: () => 'TEST01',
}));

import { initUIElements, renderLobby } from '../public/js/ui.js';

describe('renderLobby — player list and kick button', () => {
  beforeEach(() => {
    loadIndexHtml();
    initUIElements();
    mockEmit.mockClear();
  });

  test('renders all player names with host crown', () => {
    const state = makeWaitingState();
    renderLobby(state, 'host_id');

    const playersList = document.getElementById('lobby-players');
    const items = playersList.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Host');
    expect(items[0].textContent).toContain('👑');
    expect(items[1].textContent).toContain('Guest');
  });

  test('host sees kick button next to non-host players', () => {
    const state = makeWaitingState();
    renderLobby(state, 'host_id'); // viewing AS the host

    const playersList = document.getElementById('lobby-players');
    const kickBtns = playersList.querySelectorAll('.btn-kick');
    expect(kickBtns.length).toBe(1); // only the guest, not the host themselves
  });

  test('host does NOT see a kick button next to themselves', () => {
    const state = makeWaitingState();
    renderLobby(state, 'host_id');

    const playersList = document.getElementById('lobby-players');
    const items = playersList.querySelectorAll('li');
    // First li = host (the viewer); should NOT contain a kick button
    expect(items[0].querySelector('.btn-kick')).toBeNull();
    // Second li = guest; SHOULD contain a kick button
    expect(items[1].querySelector('.btn-kick')).not.toBeNull();
  });

  test('non-host player sees no kick buttons at all', () => {
    const state = makeWaitingState();
    renderLobby(state, 'guest_id'); // viewing AS the guest

    const kickBtns = document.getElementById('lobby-players').querySelectorAll('.btn-kick');
    expect(kickBtns.length).toBe(0);
  });

  test('clicking kick button emits kickPlayer with the target ID', () => {
    const state = makeWaitingState();
    renderLobby(state, 'host_id');

    const kickBtn = document
      .getElementById('lobby-players')
      .querySelector('.btn-kick');
    kickBtn.click();

    expect(mockEmit).toHaveBeenCalledWith('kickPlayer', {
      lobbyId: 'TEST01',
      targetId: 'guest_id',
    });
  });
});
