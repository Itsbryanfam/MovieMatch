// sw-routing.test.js — the SW's request-routing decision table.
// WHY: this is the first service worker on a LIVE real-time site. The one
// rule that must never break: the SW must not touch socket.io, non-GET, or
// cross-origin traffic (that would break gameplay or cache third-party
// responses). Testing the pure decision fn lets us prove the table without
// a headless browser/SW harness.
const { swDecision } = require('../public/sw-routing.js');

const ORIGIN = 'https://moviematch.it.com';

describe('swDecision', () => {
  test('non-GET always bypasses', () => {
    expect(swDecision({ method: 'POST', url: `${ORIGIN}/api/x`, mode: 'cors', origin: ORIGIN })).toBe('bypass');
  });
  test('socket.io traffic bypasses (polling transport is same-origin GET)', () => {
    expect(swDecision({ method: 'GET', url: `${ORIGIN}/socket.io/?EIO=4&transport=polling`, mode: 'cors', origin: ORIGIN })).toBe('bypass');
  });
  test('cross-origin (TMDB images, Google Fonts) bypasses', () => {
    expect(swDecision({ method: 'GET', url: 'https://image.tmdb.org/t/p/w200/x.jpg', mode: 'no-cors', origin: ORIGIN })).toBe('bypass');
    expect(swDecision({ method: 'GET', url: 'https://fonts.gstatic.com/s/a.woff2', mode: 'cors', origin: ORIGIN })).toBe('bypass');
  });
  test('unparseable url bypasses (never throw inside fetch handler)', () => {
    expect(swDecision({ method: 'GET', url: 'not a url', mode: 'navigate', origin: ORIGIN })).toBe('bypass');
  });
  test('same-origin navigation is network-first', () => {
    expect(swDecision({ method: 'GET', url: `${ORIGIN}/`, mode: 'navigate', origin: ORIGIN })).toBe('network-first');
  });
  test('same-origin static assets are network-first', () => {
    for (const p of ['/js/app.js', '/css/01-base.css', '/icon.svg', '/manifest.json']) {
      expect(swDecision({ method: 'GET', url: `${ORIGIN}${p}`, mode: 'cors', origin: ORIGIN })).toBe('network-first');
    }
  });
});
