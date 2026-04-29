/**
 * @jest-environment jsdom
 */

// Coverage for the socket event handlers in socketClient.js — specifically
// the screen-transition logic that surfaced the most bugs this session:
//
//   1. rejoinSuccess with status='finished' must show game screen (not lobby)
//   2. rejoinSuccess with status='waiting' must hide #join-panel before
//      showing #waiting-room (otherwise both render simultaneously)
//   3. stateUpdate('waiting') after a page-refresh rejoin must also hide
//      #join-panel — sessionStorage data exists but #join-panel starts
//      visible on every page load
//   4. connect handler emits rejoinLobby only when sessionStorage has data
//
// Approach: stub `io()` to return a fake socket whose `.on(event, handler)`
// stores handlers in a map. Tests call `fake.trigger(event, payload)` to
// invoke them and then assert DOM state.

const { loadIndexHtml, makeWaitingState, makePlayingState, makeChainItem } = require('./fixtures');

// state.js mock — all internal state lives inside the factory so Jest's
// no-out-of-scope-variables rule for jest.mock() factories is respected.
// The factory exposes helper accessors via the mocked module itself.
jest.mock('../public/js/state.js', () => {
  const internals = {
    socket: null,
    lobbyId: 'TEST01',
    playerId: 'host_id',
    isSpectator: false,
    gameState: null,
    turnInterval: null,
    lastTickSound: 0,
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
    getTurnInterval: () => internals.turnInterval,
    getLastTickSound: () => internals.lastTickSound,
    setTurnInterval: (v) => { internals.turnInterval = v; },
    setLastTickSound: (v) => { internals.lastTickSound = v; },
    clearTurnTimer: () => {
      if (internals.turnInterval) clearInterval(internals.turnInterval);
      internals.turnInterval = null;
    },
    onJoined: jest.fn((data) => {
      internals.lobbyId = data.lobbyId;
      internals.playerId = data.playerId;
      internals.isSpectator = data.isSpectator || false;
    }),
    onStateUpdate: jest.fn((s) => { internals.gameState = s; return null; }),
    onRejoined: jest.fn((data) => {
      internals.lobbyId = data.lobbyId;
      internals.playerId = data.playerId;
      internals.gameState = data.state;
    }),
    resetSession: jest.fn(() => {
      internals.lobbyId = null;
      internals.playerId = null;
      internals.gameState = null;
      internals.isSpectator = false;
    }),
  };
});

import * as state from '../public/js/state.js';
import { initUIElements } from '../public/js/ui.js';
import { initSocket } from '../public/js/socketClient.js';

// Build a fresh fake socket per test
function createFakeSocket() {
  const handlers = new Map();
  return {
    handlers,
    on(event, handler) { handlers.set(event, handler); },
    emit: jest.fn(),
    trigger(event, payload) {
      const h = handlers.get(event);
      if (!h) throw new Error(`No handler registered for '${event}'`);
      return h(payload);
    },
  };
}

let fakeSocket;
window.io = jest.fn(() => fakeSocket);

describe('socketClient handlers — screen transitions', () => {
  beforeEach(() => {
    loadIndexHtml();
    initUIElements();
    fakeSocket = createFakeSocket();
    sessionStorage.clear();
    document.title = 'MovieMatch';
    state.__setMyPlayerId('host_id');
    initSocket();
    state.__setSocket(fakeSocket); // initSocket calls setSocket internally; reassert here
  });

  // ------------------------------------------------------------------------
  // rejoinSuccess — the handler that bit us repeatedly
  // ------------------------------------------------------------------------

  test('rejoinSuccess with playing state activates game screen, hides hero', () => {
    fakeSocket.trigger('rejoinSuccess', {
      lobbyId: 'TEST01',
      playerId: 'host_id',
      state: makePlayingState({ chain: [makeChainItem()] }),
    });

    expect(document.getElementById('game-screen').classList.contains('active')).toBe(true);
    expect(document.getElementById('hero-screen').classList.contains('active')).toBe(false);
    expect(document.getElementById('lobby-screen').classList.contains('active')).toBe(false);
  });

  test('rejoinSuccess with finished state shows game screen (regression)', () => {
    // Pre-fix bug: finished states fell into the `else` branch and tried to
    // show the lobby screen. The user reported double-UI on refresh after game end.
    fakeSocket.trigger('rejoinSuccess', {
      lobbyId: 'TEST01',
      playerId: 'host_id',
      state: { ...makePlayingState({ chain: [makeChainItem()] }), status: 'finished', winner: 'Host' },
    });

    expect(document.getElementById('game-screen').classList.contains('active')).toBe(true);
    expect(document.getElementById('lobby-screen').classList.contains('active')).toBe(false);
  });

  test('rejoinSuccess with waiting state hides join-panel before showing waiting-room (regression)', () => {
    // Pre-fix bug: rejoinSuccess only hid #join-panel inside the else branch.
    // We moved the hide-call out unconditionally — this test pins it there.
    expect(document.getElementById('join-panel').classList.contains('hidden')).toBe(false); // sanity: starts visible

    fakeSocket.trigger('rejoinSuccess', {
      lobbyId: 'TEST01',
      playerId: 'host_id',
      state: makeWaitingState(),
    });

    expect(document.getElementById('join-panel').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('private-panel').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('public-panel').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('waiting-room').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('lobby-screen').classList.contains('active')).toBe(true);
  });

  // ------------------------------------------------------------------------
  // stateUpdate — the secondary path that also has to hide join panels
  // ------------------------------------------------------------------------

  test('stateUpdate with waiting status hides join-panel (regression)', () => {
    expect(document.getElementById('join-panel').classList.contains('hidden')).toBe(false);

    fakeSocket.trigger('stateUpdate', makeWaitingState());

    expect(document.getElementById('join-panel').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('lobby-screen').classList.contains('active')).toBe(true);
  });

  // ------------------------------------------------------------------------
  // connect — page-refresh recovery via sessionStorage + stableId
  // ------------------------------------------------------------------------

  test('connect with no sessionStorage data does not emit rejoinLobby', () => {
    fakeSocket.trigger('connect');
    expect(fakeSocket.emit).not.toHaveBeenCalledWith('rejoinLobby', expect.anything());
  });

  test('connect with sessionStorage data emits rejoinLobby and hides hero', () => {
    sessionStorage.setItem('mm_lobbyId', 'TEST01');
    sessionStorage.setItem('mm_playerId', 'host_id');

    fakeSocket.trigger('connect');

    expect(fakeSocket.emit).toHaveBeenCalledWith(
      'rejoinLobby',
      expect.objectContaining({ lobbyId: 'TEST01', playerId: 'host_id' }),
    );
    // Hero must be hidden immediately to prevent flash before server replies
    expect(document.getElementById('hero-screen').classList.contains('active')).toBe(false);
  });

  // ------------------------------------------------------------------------
  // Tab title (Feature 2)
  // ------------------------------------------------------------------------

  test('document title flips to "Your turn!" when it becomes my turn', () => {
    fakeSocket.trigger('stateUpdate', makePlayingState({
      currentTurnIndex: 0, // host_id sits at index 0
      chain: [makeChainItem()],
    }));

    expect(document.title).toContain('Your turn');
  });

  test('document title resets to MovieMatch when game finishes', () => {
    fakeSocket.trigger('stateUpdate', makePlayingState({
      currentTurnIndex: 0,
      chain: [makeChainItem()],
    }));
    expect(document.title).toContain('Your turn');

    fakeSocket.trigger('stateUpdate', {
      ...makePlayingState({ chain: [makeChainItem()] }),
      status: 'finished',
      winner: 'Host',
    });

    expect(document.title).toBe('MovieMatch');
  });
});
