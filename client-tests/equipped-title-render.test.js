/**
 * @jest-environment jsdom
 */
// Phase 6b — equipped title on the classic lobby seat + the local player's
// end-of-game card. Both renders are GATED on a titleLabel field absent from
// pre-6b fixtures, so the existing seat-builder / render-lobby / game-over
// suites are unaffected; these tests pin the new gated branches.
const { loadIndexHtml, makeWaitingState, makePlayer, makePlayingState } = require('./fixtures');
import { initUIElements, renderLobby, showGameOverBanner } from '../public/js/ui.js';

describe('seat title badge (classic lobby)', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); });

  test('renders .seat-title for a player carrying titleLabel', () => {
    const state = makeWaitingState({
      players: [
        makePlayer({ id: 'host_id', name: 'Host', isHost: true, titleLabel: 'Chain Master' }),
        makePlayer({ id: 'guest_id', name: 'Guest' }),
      ],
    });
    renderLobby(state, 'host_id');
    const titles = document.querySelectorAll('#lobby-players .seat-title');
    expect(titles.length).toBe(1);
    expect(titles[0].textContent).toBe('Chain Master');
  });

  test('renders no .seat-title when nobody has a title (pre-6b parity)', () => {
    renderLobby(makeWaitingState(), 'host_id');
    expect(document.querySelectorAll('#lobby-players .seat-title').length).toBe(0);
  });
});

describe('end-of-game card title badge (local player)', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); });

  test('shows "Played as X" when the local player has a title', () => {
    const state = makePlayingState({
      status: 'finished',
      winner: { name: 'Host', score: 10 },
      chain: [],
      players: [
        makePlayer({ id: 'me', name: 'Me', titleLabel: 'Speed Demon' }),
        makePlayer({ id: 'other', name: 'Other' }),
      ],
    });
    showGameOverBanner(state, 'me');
    const badge = document.querySelector('.game-over-title-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('Speed Demon');
  });

  test('renders no badge when the local player has no title', () => {
    const state = makePlayingState({ status: 'finished', winner: { name: 'Host', score: 10 }, chain: [],
      players: [makePlayer({ id: 'me', name: 'Me' })] });
    showGameOverBanner(state, 'me');
    expect(document.querySelector('.game-over-title-badge')).toBeNull();
  });
});
