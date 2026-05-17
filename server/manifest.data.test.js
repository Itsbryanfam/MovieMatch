// manifest.data.test.js — pins the PWA install contract.
// WHY: without a manifest icons[] entry the "Add to Home Screen" prompt
// shows a blank/generic icon and some browsers suppress the install prompt
// entirely. This guards the icon wiring without a headless browser.
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');

describe('PWA manifest + icon', () => {
  // WHY: parse at describe-body scope (not beforeAll) to stay consistent with
  // the pattern used in server/systems/dailyMovies.data.test.js so both test
  // files share the same synchronous setup style.
  const manifest = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.json'), 'utf8'));

  test('icons is a non-empty array', () => {
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('every icon has a string src and type', () => {
    for (const ic of manifest.icons) {
      expect(typeof ic.src).toBe('string');
      expect(ic.src.length).toBeGreaterThan(0);
      expect(typeof ic.type).toBe('string');
    }
  });

  // WHY: split into two tests so a missing file and a missing manifest entry
  // produce separate, targeted failure messages rather than one conflated one.
  test('at least one icon entry wires /icon.svg', () => {
    // WHY: guards that the manifest actually references the SVG asset we ship;
    // without this, platforms silently fall back to a generic blank icon.
    const ref = manifest.icons.some((ic) => ic.src === '/icon.svg');
    expect(ref).toBe(true);
  });

  test('public/icon.svg exists, is non-empty, and contains <svg', () => {
    // WHY: guards that the file the manifest points at is actually present and
    // is a valid SVG document — a missing or empty file would silently break
    // the favicon, apple-touch-icon, and PWA install icon in one shot.
    const svg = fs.readFileSync(path.join(PUB, 'icon.svg'), 'utf8');
    expect(svg.length).toBeGreaterThan(0);
    expect(svg).toContain('<svg');
  });
});
