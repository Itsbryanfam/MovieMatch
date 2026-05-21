/**
 * @jest-environment jsdom
 */
// Phase 7.8b — team-mode render contract. Pins the new DOM:
// - cinema-screen header per team (.team-theater .screen with eyebrow+headline)
// - per-team seat-style chairs with .team-red / .team-blue class
// - host kick + nameplate + crown + you-pill all carried over from classic
// - join/start gating logic byte-identical to today
// - ledger sync to team-suffixed controls

const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
const mockEmit = jest.fn();
jest.mock('../public/js/state.js', () => ({
  getSocket: () => ({ emit: mockEmit }),
  getCurrentLobbyId: () => 'TEST01',
}));
import { initUIElements, renderLobby } from '../public/js/ui.js';

// Helper: a 2v3 team state (default: host+red2 on red, blue1+blue2+blue3 on blue)
const teamState = (overrides = {}) => makeWaitingState({
  gameMode: 'team',
  players: [
    makePlayer({ id: 'host_id', name: 'Host',      isHost: true, teamId: 0 }),
    makePlayer({ id: 'red2',    name: 'RedTwo',                  teamId: 0 }),
    makePlayer({ id: 'blue1',   name: 'BlueOne',                 teamId: 1 }),
    makePlayer({ id: 'blue2',   name: 'BlueTwo',                 teamId: 1 }),
    makePlayer({ id: 'blue3',   name: 'BlueThree',               teamId: 1 }),
  ],
  ...overrides,
});

describe('renderTeamScreen — team theater parity', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('2-red-vs-3-blue renders 2 .seat.team-red + 3 .seat.team-blue', () => {
    renderLobby(teamState(), 'host_id');
    const redSeats  = document.querySelectorAll('#team-red-list  li.seat.team-red');
    const blueSeats = document.querySelectorAll('#team-blue-list li.seat.team-blue');
    expect(redSeats.length).toBe(2);
    expect(blueSeats.length).toBe(3);
    // No empty placeholder seats in team mode (variable team size).
    expect(document.querySelectorAll('#team-red-list  li.seat:not(.occupied)').length).toBe(0);
    expect(document.querySelectorAll('#team-blue-list li.seat:not(.occupied)').length).toBe(0);
  });

  test('team seats carry --seat-team-color; classic --avatar-hue absent', () => {
    renderLobby(teamState(), 'host_id');
    const seats = document.querySelectorAll('#team-red-list li.seat, #team-blue-list li.seat');
    expect(seats.length).toBeGreaterThan(0);
    for (const s of seats) {
      // Team mode: no per-seat hue variable.
      expect(s.style.getPropertyValue('--avatar-hue')).toBe('');
      // Team mode: the team-color CSS variable IS set.
      expect(s.style.getPropertyValue('--seat-team-color')).not.toBe('');
    }
  });

  test('host sees .seat-kick on every non-self seat across both teams', () => {
    renderLobby(teamState(), 'host_id');
    const allSeats       = document.querySelectorAll('#team-red-list li.seat, #team-blue-list li.seat');
    const expectedKicks  = allSeats.length - 1; // every seat except host's own
    expect(document.querySelectorAll('#team-screen .seat-kick').length).toBe(expectedKicks);
    const myOwnSeat = document.querySelector('#team-red-list li.seat[data-player-id="host_id"]');
    expect(myOwnSeat.querySelector('.seat-kick')).toBeNull();
  });

  test('non-host sees zero .seat-kick', () => {
    renderLobby(teamState(), 'blue1');
    expect(document.querySelectorAll('#team-screen .seat-kick').length).toBe(0);
  });

  test('host-with-wins nameplate: single .crown, no (You)/👑 baked in text', () => {
    renderLobby(teamState({ players: [
      makePlayer({ id: 'host_id', name: 'Bryan', isHost: true, wins: 34, teamId: 0 }),
      makePlayer({ id: 'blue1',   name: 'Guest',                          teamId: 1 }),
    ]}), 'host_id');
    const me = document.querySelector('#team-red-list li.seat[data-player-id="host_id"]');
    expect(me.querySelectorAll('.crown').length).toBe(1);
    expect((me.textContent.match(/♛/g) || []).length).toBe(1);
    expect(me.textContent).not.toContain('👑');
    expect(me.querySelector('.nameplate .seat-name').textContent).toBe('Bryan • 34 🏆');
  });

  test('cinema screens render: eyebrow "Red Team" + "Blue Team"', () => {
    renderLobby(teamState(), 'host_id');
    const red  = document.querySelector('#team-screen .team-theater.team-red  .screen-eyebrow');
    const blue = document.querySelector('#team-screen .team-theater.team-blue .screen-eyebrow');
    expect(red).not.toBeNull();
    expect(blue).not.toBeNull();
    expect(red.textContent).toBe('Red Team');
    expect(blue.textContent).toBe('Blue Team');
  });

  test('join buttons reflect my team: my own team disabled, other enabled', () => {
    renderLobby(teamState(), 'blue1'); // I am on blue
    expect(document.getElementById('join-red-btn').disabled).toBe(false);
    expect(document.getElementById('join-blue-btn').disabled).toBe(true);
  });

  test('Start Match visible for host when teams ready; hidden for non-host', () => {
    renderLobby(teamState(), 'host_id'); // 2v3 — both ≥1, ready
    const btn = document.getElementById('team-start-btn');
    expect(btn.style.display).toBe('block');
    // Non-host viewer: hidden even when ready.
    renderLobby(teamState(), 'blue1');
    expect(document.getElementById('team-start-btn').style.display).toBe('none');
  });

  test('Start Match hidden when one team has 0 players', () => {
    const allRed = teamState({ players: [
      makePlayer({ id: 'host_id', name: 'Host', isHost: true, teamId: 0 }),
      makePlayer({ id: 'red2',    name: 'R',                  teamId: 0 }),
    ]});
    renderLobby(allRed, 'host_id');
    expect(document.getElementById('team-start-btn').style.display).toBe('none');
  });

  test('ledger mirrors hardcoreMode/allowTvShows onto .ledger-row.on (team controls)', () => {
    renderLobby(teamState({ hardcoreMode: true, allowTvShows: true }), 'host_id');
    const hardcore = document.getElementById('hardcore-toggle-team').closest('.ledger-row');
    const tv       = document.getElementById('tv-shows-toggle-team').closest('.ledger-row');
    expect(hardcore.classList.contains('on')).toBe(true);
    expect(tv.classList.contains('on')).toBe(true);

    renderLobby(teamState({ hardcoreMode: false, allowTvShows: false }), 'host_id');
    expect(document.getElementById('hardcore-toggle-team').closest('.ledger-row').classList.contains('on')).toBe(false);
  });

  // Regression: T1 put .lobby-panel class on #team-screen but missed that the
  // classic .lobby-panel base rule (02-hero-lobby.css L230) sets max-width:380px
  // — classic #waiting-room.lobby-panel escapes via an ID-anchored override
  // (max-width:none at L757). Without an equivalent override the 3-col team
  // theater shell gets squished into a 380px column with text clipping in
  // every column. jsdom can't compute layout so this is a string-grep pin
  // on the CSS rule itself — the only signal we have that the escape exists.
  test('regression: #team-screen.lobby-panel must escape the 380px lobby-panel clamp', () => {
    const fs = require('fs');
    const path = require('path');
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'css', '02-hero-lobby.css'),
      'utf-8'
    );
    // Pattern: an ID-anchored override on #team-screen.lobby-panel that sets
    // max-width:none. Mirrors classic #waiting-room.lobby-panel at L757.
    expect(css).toMatch(/#team-screen\.lobby-panel\s*\{[^}]*max-width:\s*none/);
  });

  test('idempotent re-render does NOT re-apply .entering (arrival-diff)', () => {
    // Use a unique lobby id so the module-level _seenTeamPlayerIds resets
    // (the set is keyed to _lastTeamLobbyId; a new id triggers a fresh set).
    // This isolates the test from the accumulated seen-set of prior tests
    // that ran with id:'TEST01' — same pattern the classic renderLobby uses.
    const uniqueLobbyId = 'FRESH_LOBBY_' + Date.now();
    const st = teamState({ id: uniqueLobbyId });
    renderLobby(st, 'host_id');
    // First render: everyone is new → .entering applied.
    const firstEntering = document.querySelectorAll('#team-screen li.seat.entering').length;
    expect(firstEntering).toBeGreaterThan(0);
    // Second render: same roster, same lobby id → no players are NEW arrivals.
    // The seat DOM is rebuilt each render, so arrival-diff returns no new ids.
    renderLobby(st, 'host_id');
    expect(document.querySelectorAll('#team-screen li.seat.entering').length).toBe(0);
  });

  // Phase 7.8c — team-mode QR integration. Mirrors the classic test in
  // render-qr.test.js; pinned in this file too so the team contract
  // explicitly covers the QR mount.
  // beforeAll loads the vendored qrcode-generator so window.qrcode is
  // defined — renderQR is a silent no-op without it (ui-qr.js guards).
  beforeAll(() => {
    const { loadVendoredQrLib } = require('./fixtures');
    loadVendoredQrLib();
  });

  test('renderLobby paints SVG into #team-screen-qr .lobby-qr-svg in team mode', () => {
    const state = teamState({ id: 'XYZ987' });
    renderLobby(state, 'host_id');
    const mount = document.querySelector('#team-screen-qr .lobby-qr-svg');
    expect(mount).not.toBeNull();
    const svg = mount.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(mount.dataset.qrUrl).toMatch(/\?room=XYZ987$/);
  });
});
