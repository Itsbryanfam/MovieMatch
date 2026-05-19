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

  test('ledger rows mirror hardcore/tv state onto .on (drives the visible toggle-pill)', () => {
    // WHY: the .toggle-pill slide/tint is CSS-driven by .ledger-row.on; the
    // real .ledger-checkbox is visually hidden (position:absolute;opacity:0;
    // width:0;height:0;pointer-events:none). renderLobby must mirror
    // checkbox→.on or the pill is permanently stuck OFF (host sees no
    // confirmation; guests can't see the room rules). Pins the §4
    // visible-state wiring so it can't silently regress.
    const onState = makeWaitingState({ hardcoreMode: true, allowTvShows: true });
    renderLobby(onState, 'host_id');
    expect(document.getElementById('hardcore-toggle').closest('.ledger-row').classList.contains('on')).toBe(true);
    expect(document.getElementById('tv-shows-toggle').closest('.ledger-row').classList.contains('on')).toBe(true);

    const offState = makeWaitingState({ hardcoreMode: false, allowTvShows: false });
    renderLobby(offState, 'host_id');
    expect(document.getElementById('hardcore-toggle').closest('.ledger-row').classList.contains('on')).toBe(false);
    expect(document.getElementById('tv-shows-toggle').closest('.ledger-row').classList.contains('on')).toBe(false);
  });

  test('local player\'s own seat shows an 8-swatch strip; others/empty/none', () => {
    renderLobby(makeWaitingState(), 'host_id'); // host = players[0] = me
    const occ = document.querySelectorAll('#lobby-players li.seat.occupied');
    const myStrip = occ[0].querySelector('.seat-swatches');
    expect(myStrip).not.toBeNull();
    expect(myStrip.querySelectorAll('.swatch').length).toBe(8);
    expect(occ[1].querySelector('.seat-swatches')).toBeNull();           // guest
    expect(document.querySelector('#lobby-players li.seat:not(.occupied) .seat-swatches')).toBeNull();
  });

  test('own effective hue swatch is .is-selected+disabled; another player\'s is .is-taken+disabled', () => {
    renderLobby(makeWaitingState(), 'host_id');
    const strip = document.querySelector('#lobby-players li.seat.occupied .seat-swatches');
    const sel = strip.querySelectorAll('.swatch.is-selected');
    expect(sel.length).toBe(1);
    expect(sel[0].disabled).toBe(true);
    expect(sel[0].getAttribute('aria-pressed')).toBe('true');
    const taken = strip.querySelectorAll('.swatch.is-taken');
    expect(taken.length).toBe(1);                  // guest's slot fallback
    expect(taken[0].disabled).toBe(true);
    expect(strip.querySelectorAll('.swatch:not([disabled])').length).toBe(6);
  });

  test('clicking a FREE swatch emits selectColor {lobbyId:gameState.id, hue}', () => {
    const { SEAT_HUES } = require('../public/js/ui/red-carpet.js');
    renderLobby(makeWaitingState(), 'host_id');
    const free = document.querySelector('#lobby-players li.seat.occupied .seat-swatches .swatch:not([disabled])');
    free.click();
    const [evt, payload] = mockEmit.mock.calls[mockEmit.mock.calls.length - 1];
    expect(evt).toBe('selectColor');
    expect(payload.lobbyId).toBe('TEST01');
    expect(SEAT_HUES).toContain(payload.hue);
    expect(payload.hue).toBe(Number(free.style.getPropertyValue('--avatar-hue')));
  });

  test('a picked colorHue → .has-picked + --avatar-hue is the picked hue', () => {
    const { SEAT_HUES } = require('../public/js/ui/red-carpet.js');
    const st = makeWaitingState({ players: [
      makePlayer({ id: 'host_id', name: 'Host', isHost: true, colorHue: SEAT_HUES[5] }),
      makePlayer({ id: 'guest_id', name: 'Guest' }),
    ]});
    renderLobby(st, 'host_id');
    const me = document.querySelector('#lobby-players li.seat.occupied');
    expect(me.classList.contains('has-picked')).toBe(true);
    expect(me.style.getPropertyValue('--avatar-hue')).toBe(String(SEAT_HUES[5]));
    expect(me.querySelector('.swatch.is-selected').style.getPropertyValue('--avatar-hue'))
      .toBe(String(SEAT_HUES[5]));
  });
});
