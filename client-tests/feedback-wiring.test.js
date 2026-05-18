/**
 * @jest-environment jsdom
 */
// Verifies the feedback router is wired into the live socket flow: the MI-01
// delta (info -> toast, not overlay), elimination still uses the overlay path,
// submissionRejected uses the error toast + clears the pill, and the pill
// resolution wiring (stateUpdate / autocompleteResults) behaves correctly.
const { loadIndexHtml, makePlayingState, makeChainItem } = require('./fixtures');

jest.mock('../public/js/state.js', () => {
  const internals = {
    socket: null, lobbyId: 'TEST01', playerId: 'host_id',
    isSpectator: false, isDaily: false, gameState: null,
    turnInterval: null, lastTickSound: 0,
  };
  return {
    __setSocket: (s) => { internals.socket = s; },
    __setMyPlayerId: (id) => { internals.playerId = id; },
    getSocket: () => internals.socket,
    setSocket: (s) => { internals.socket = s; },
    getCurrentLobbyId: () => internals.lobbyId,
    getMyPlayerId: () => internals.playerId,
    getGameState: () => internals.gameState,
    getIsSpectator: () => internals.isSpectator,
    getIsDaily: () => internals.isDaily,
    getTurnInterval: () => internals.turnInterval,
    getLastTickSound: () => internals.lastTickSound,
    setTurnInterval: (v) => { internals.turnInterval = v; },
    setLastTickSound: (v) => { internals.lastTickSound = v; },
    clearTurnTimer: () => { if (internals.turnInterval) clearInterval(internals.turnInterval); internals.turnInterval = null; },
    onJoined: jest.fn(), onStateUpdate: jest.fn((s) => { internals.gameState = s; return null; }),
    onRejoined: jest.fn(), resetSession: jest.fn(),
  };
});

import * as state from '../public/js/state.js';
import { initUIElements, submissionPill } from '../public/js/ui.js';
import { initSocket } from '../public/js/socketClient.js';

function createFakeSocket() {
  const handlers = new Map();
  return {
    handlers, id: 'sock_self',
    on(e, h) { handlers.set(e, h); },
    emit: jest.fn(),
    trigger(e, p) { const h = handlers.get(e); if (!h) throw new Error('no handler ' + e); return h(p); },
  };
}
let fakeSocket;
window.io = jest.fn(() => fakeSocket);

describe('feedback wiring — dispatcher delta + pill resolution', () => {
  beforeEach(() => {
    loadIndexHtml();
    initUIElements();
    fakeSocket = createFakeSocket();
    state.__setMyPlayerId('host_id');
    initSocket();
    state.__setSocket(fakeSocket);
  });
  afterEach(() => { submissionPill.clear(); document.body.innerHTML = ''; });

  test("MI-01 delta: kind:'info' renders a toast, NOT the centre overlay", () => {
    fakeSocket.trigger('notification', { msg: 'Game starting soon', kind: 'info' });
    const toast = document.querySelector('.copy-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe('Game starting soon');
    expect(toast.classList.contains('copy-toast--info')).toBe(true);
    const overlay = document.getElementById('notification-overlay');
    expect(overlay.classList.contains('hidden')).toBe(true); // overlay NOT used
  });

  test("kind:'elimination' still uses the overlay + flash (behaviour-preserving)", () => {
    fakeSocket.trigger('notification', { msg: 'Alice was eliminated', kind: 'elimination' });
    const overlay = document.getElementById('notification-overlay');
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(overlay.classList.contains('notification--elimination')).toBe(true);
    expect(document.querySelector('.elimination-flash')).not.toBeNull();
  });

  test('submissionRejected: error toast + input restored + pill cleared', () => {
    submissionPill.checking('Heat'); // simulate the in-flight submit pill
    fakeSocket.trigger('submissionRejected', {
      message: "Couldn't find that title.", retriesLeft: 2, originalInput: 'Heaat',
    });
    const toast = document.querySelector('.copy-toast');
    expect(toast.classList.contains('copy-toast--error')).toBe(true);
    expect(toast.textContent).toContain("Couldn't find that title.");
    const input = document.getElementById('movie-input');
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('Heaat');
    expect(document.getElementById('submission-pill').classList.contains('visible')).toBe(false);
  });

  test('stateUpdate clears an in-flight checking pill', () => {
    submissionPill.checking('Heat');
    fakeSocket.trigger('stateUpdate', makePlayingState({ currentTurnIndex: 0, chain: [makeChainItem()] }));
    expect(document.getElementById('submission-pill').classList.contains('visible')).toBe(false);
  });

  test('autocompleteResults clears searching pill but NOT a checking pill', () => {
    submissionPill.searching();
    fakeSocket.trigger('autocompleteResults', []);
    expect(document.getElementById('submission-pill').classList.contains('visible')).toBe(false);

    submissionPill.checking('Heat');
    fakeSocket.trigger('autocompleteResults', []);
    expect(document.getElementById('submission-pill').textContent).toBe('Checking: "Heat"');
  });
});
