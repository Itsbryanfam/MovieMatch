// client-tests/sharecard.test.js — Phase 7.6 Task 2 (focused Share 2.0)
// WHY: ui-sharecard.js has no pre-existing unit suite; this NEW suite pins
// the additive Share 2.0 surface (spoiler-free emoji grid + survived line),
// the zero-identity invariant, and that the existing public exports + text
// recap remain byte-stable (additive only).
/** @jest-environment jsdom */
const sc = require('../public/js/ui/ui-sharecard.js');

function link(idx, over = {}) {
  return {
    playerName: `Player ${idx}`,
    stableId: `SECRET_${idx}`,
    movie: { title: `Title ${idx}`, year: 2000 + idx, poster: '', mediaType: 'movie', cast: [{ name: `Actor ${idx}` }] },
    matchedActors: idx === 0 ? [] : [`Actor ${idx}`],
    ...over,
  };
}
const chainOf = n => Array.from({ length: n }, (_, i) => link(i));

describe('buildEmojiGrid — spoiler-free & zero-identity', () => {
  test('one emoji per curated entry; seed 🎬 and last 🏁', () => {
    const g = sc.buildEmojiGrid({ gameMode: 'classic', chain: chainOf(4), winner: null });
    // WHY slice(0, 1) not slice(0, 2): spread iterates Unicode code points
    // (not UTF-16 code units), so 🎬 (U+1F3AC) is a single spread element.
    // Using slice(0, 1) correctly selects just the first emoji.
    expect([...g].slice(0, 1).join('')).toBe('🎬');
    expect(g.includes('🏁')).toBe(true);
    expect(g).not.toMatch(/Title|Player|SECRET_|stableId/);
  });
  test('long chain → +N suffix equals skipped count', () => {
    const g = sc.buildEmojiGrid({ gameMode: 'classic', chain: chainOf(12), winner: null });
    expect(g).toMatch(/\+5$/); // 12 - 7 curated = 5
  });
  test('spicy 🔥 for a high-score middle entry (scoreChainEntry >= 5)', () => {
    // mediaType diff (movie→tv) = +3; year gap |2000-1975|=25 → floor(25/10)=+2; total 5 → 🔥
    const base = link(0); // movie, year 2000
    const spicy = link(1, {
      movie: { title: 'TV Show', year: 1975, poster: '', mediaType: 'tv', cast: [] },
      matchedActors: [],
    });
    const last = link(2); // movie, year 2002
    const g = sc.buildEmojiGrid({ gameMode: 'classic', chain: [base, spicy, last], winner: null });
    expect([...g]).toEqual(['🎬', '🔥', '🏁']); // seed, spicy-middle, last
  });
});

describe('survivedLine', () => {
  test('first-person, integer-only, no identifier', () => {
    const s = sc.survivedLine({ gameMode: 'classic', chain: chainOf(6), winner: { name: 'Ann' } });
    expect(s).toBe('🔗 I survived 6 links');
    expect(s).not.toMatch(/SECRET_|stableId|Ann/);
  });
});

describe('buildTextRecap — additive (existing content preserved)', () => {
  test('still has header, per-link, winner, Play-at AND the new grid + survived lines', () => {
    const state = { gameMode: 'classic', chain: chainOf(3), winner: { name: 'Ann', score: 9 } };
    const t = sc.buildTextRecap(state);
    expect(t).toContain('🎬 MovieMatch');
    expect(t).toContain('Chain of 3 connections:');
    expect(t).toContain('1. Player 0 → Title 0 (2000)');
    expect(t).toContain('🏆 Ann wins with 9 pts!');
    expect(t).toContain('Play at ');
    expect(t).toContain(sc.buildEmojiGrid(state));
    expect(t).toContain(sc.survivedLine(state));
  });
});

describe('byte-stable public surface', () => {
  test('all pre-7.6 exports still present', () => {
    ['generateShareCard', 'buildTextRecap', 'openShareModal', 'truncate', 'roundRect', 'selectChainEntries', 'scoreChainEntry']
      .forEach(name => expect(typeof sc[name]).toBe('function'));
  });
  test('generateShareCard still returns a canvas (additive draws do not throw)', () => {
    const canvas = sc.generateShareCard({ gameMode: 'classic', chain: chainOf(3), winner: { name: 'Ann', score: 9 } });
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(720);
  });
});
