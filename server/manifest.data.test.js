// manifest.data.test.js — pins the PWA install contract.
// WHY: without a manifest icons[] entry the "Add to Home Screen" prompt
// shows a blank/generic icon and some browsers suppress the install prompt
// entirely. This guards the icon wiring without a headless browser.
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');

describe('PWA manifest + icon', () => {
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

  test('at least one icon references /icon.svg and the file exists & is non-empty', () => {
    const ref = manifest.icons.some((ic) => ic.src === '/icon.svg');
    expect(ref).toBe(true);
    const svg = fs.readFileSync(path.join(PUB, 'icon.svg'), 'utf8');
    expect(svg.length).toBeGreaterThan(0);
    expect(svg).toContain('<svg');
  });
});
