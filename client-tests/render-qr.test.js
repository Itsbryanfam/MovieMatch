/**
 * @jest-environment jsdom
 */
// Phase 7.8c — pure-unit tests for ui-qr.js. Tests synthesize their own
// mount elements via document.createElement. Real-lobby-DOM integration
// tests land in T1 after the lobby-qr <div>s exist in index.html.

const { loadVendoredQrLib } = require('./fixtures');
import { renderQR, clearQR } from '../public/js/ui/ui-qr.js';

beforeAll(() => {
  // Make window.qrcode available in jsdom — matches what the production
  // <script src="/js/lib/qrcode.js"> does on a real page load.
  loadVendoredQrLib();
});

describe('renderQR / clearQR — pure unit', () => {

  test('renderQR mounts an SVG inside the target element', () => {
    const el = document.createElement('div');
    renderQR(el, 'https://example.com?room=ABCDEF');
    // The vendored encoder emits a single <svg> with QR cells inside.
    expect(el.querySelector('svg')).not.toBeNull();
  });

  test('renderQR sets dataset.qrUrl to the encoded URL', () => {
    const el = document.createElement('div');
    renderQR(el, 'https://example.com?room=TEST01');
    expect(el.dataset.qrUrl).toBe('https://example.com?room=TEST01');
  });

  test('renderQR with same URL twice does NOT replace the SVG node', () => {
    const el = document.createElement('div');
    renderQR(el, 'https://example.com?room=SAME01');
    const firstSvg = el.querySelector('svg');
    renderQR(el, 'https://example.com?room=SAME01');
    const secondSvg = el.querySelector('svg');
    // Memo path: same URL → renderQR returns early → SVG node identity
    // is preserved. If memo breaks, innerHTML is reassigned and a new
    // SVG node would be created (different identity → test fails).
    expect(secondSvg).toBe(firstSvg);
  });

  test('renderQR with a different URL replaces the SVG node', () => {
    const el = document.createElement('div');
    renderQR(el, 'https://example.com?room=FIRST');
    const firstSvg = el.querySelector('svg');
    renderQR(el, 'https://example.com?room=SECOND');
    const secondSvg = el.querySelector('svg');
    // Different URL → memo doesn't hit → re-encode → new SVG node.
    expect(secondSvg).not.toBe(firstSvg);
    expect(el.dataset.qrUrl).toBe('https://example.com?room=SECOND');
  });

  test('clearQR empties the element and removes dataset.qrUrl', () => {
    const el = document.createElement('div');
    renderQR(el, 'https://example.com?room=CLEAR');
    expect(el.children.length).toBeGreaterThan(0);
    clearQR(el);
    expect(el.children.length).toBe(0);
    expect(el.dataset.qrUrl).toBeUndefined();
  });

  test('renderQR is a silent no-op when window.qrcode is missing', () => {
    // Save + delete so we can restore for any subsequent tests in the file.
    const saved = window.qrcode;
    delete window.qrcode;
    const el = document.createElement('div');
    // Must not throw, must not mount any DOM, must not set the dataset.
    expect(() => renderQR(el, 'https://example.com?room=X')).not.toThrow();
    expect(el.children.length).toBe(0);
    expect(el.dataset.qrUrl).toBeUndefined();
    window.qrcode = saved;
  });

  test('encoded SVG has a viewBox attribute and non-empty content', () => {
    const el = document.createElement('div');
    renderQR(el, 'https://example.com?room=SANITY');
    const svg = el.querySelector('svg');
    expect(svg).not.toBeNull();
    // viewBox is set by createSvgTag — looks like "0 0 N N" for a square QR.
    // We don't pin exact dimensions (lib version may shift cell count) —
    // only that the attribute exists and has 4 space-separated values.
    const viewBox = svg.getAttribute('viewBox');
    expect(viewBox).toBeTruthy();
    expect(viewBox.split(' ').length).toBe(4);
    // The svg must have rendered cells, not just be empty.
    expect(svg.innerHTML.length).toBeGreaterThan(0);
  });

});

// ─── Integration test for #waiting-room-qr (Phase 7.8c T1) ───
// Lives in render-qr.test.js (not render-lobby.test.js, which is sacrosanct).
describe('renderLobby — classic lobby QR integration', () => {
  const { loadIndexHtml, makeWaitingState, makePlayer } = require('./fixtures');
  const mockEmit = jest.fn();
  jest.mock('../public/js/state.js', () => ({
    getSocket: () => ({ emit: mockEmit }),
    getCurrentLobbyId: () => 'TEST01',
  }));
  // Re-import via the ui.js barrel — same shape as render-lobby.test.js.
  const { initUIElements, renderLobby } = require('../public/js/ui.js');

  beforeEach(() => { loadIndexHtml(); initUIElements(); mockEmit.mockClear(); });

  test('renderLobby paints SVG into #waiting-room-qr .lobby-qr-svg', () => {
    const state = makeWaitingState({
      id: 'ABCDEF',
      gameMode: 'classic',
      players: [
        makePlayer({ id: 'host_id', name: 'Host', isHost: true }),
      ],
    });
    renderLobby(state, 'host_id');
    const mount = document.querySelector('#waiting-room-qr .lobby-qr-svg');
    expect(mount).not.toBeNull();
    const svg = mount.querySelector('svg');
    expect(svg).not.toBeNull();
    // dataset.qrUrl must encode the lobby code via makeJoinUrl. The
    // jsdom default origin is http://localhost so we expect the URL to
    // end with '?room=ABCDEF'.
    expect(mount.dataset.qrUrl).toMatch(/\?room=ABCDEF$/);
  });
});
