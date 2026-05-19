// client-tests/chain-recap.test.js — Phase 7.6 Task 0
// WHY: chain-recap.js is the pure, zero-import, 7.9-reusable storyboard
// producer (the red-carpet.js seam pattern). This suite is its own unit
// suite (the 7.5.1/7.5.2/7.5.3 seam-suite precedent — legitimately new,
// not a guard rewrite) and also pins the DRY relocation's byte-stable
// ui-sharecard.js public surface.
const {
  buildRecapStoryboard,
  selectChainEntries,
  scoreChainEntry,
} = require('../public/js/ui/chain-recap.js');
const sharecard = require('../public/js/ui/ui-sharecard.js');

// Minimal chain entry factory. NOTE: stableId is deliberately injected on
// the player to prove the storyboard never echoes it (zero-identity, the
// Phase-1 daily-leaderboard security invariant).
function link(idx, over = {}) {
  return {
    playerName: `P${idx}`,
    stableId: `SECRET_${idx}`, // must never appear in any beat
    movie: {
      title: `Movie ${idx}`,
      year: 2000 + idx,
      poster: idx % 2 === 0 ? `https://image.tmdb.org/t/p/w200/x${idx}.jpg` : '',
      mediaType: 'movie',
      cast: [{ name: `Actor ${idx}` }],
    },
    matchedActors: idx === 0 ? [] : [`Actor ${idx}`],
    ...over,
  };
}
function chainOf(n) { return Array.from({ length: n }, (_, i) => link(i)); }

describe('buildRecapStoryboard — schema & order', () => {
  test('first beat is intro with chainCount; last beat is finale', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(3), winner: { name: 'P1', score: 9 } });
    expect(sb[0]).toMatchObject({ type: 'intro', index: 0, payload: { title: 'MovieMatch', chainCount: 3 } });
    expect(sb[sb.length - 1].type).toBe('finale');
  });

  test('a 3-link chain yields intro, link0, bridge+link1, bridge+link2, finale in order', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(3), winner: { name: 'P1', score: 9 } });
    expect(sb.map(b => b.type)).toEqual(['intro', 'link', 'bridge', 'link', 'bridge', 'link', 'finale']);
    const links = sb.filter(b => b.type === 'link');
    expect(links[0].payload).toMatchObject({ idx: 0, isSeed: true });
    expect(links[1].payload).toMatchObject({ idx: 1, isSeed: false });
    expect(links[0].payload.poster).toBe('https://image.tmdb.org/t/p/w200/x0.jpg');
    expect(links[1].payload.poster).toBeNull();
    expect(sb.filter(b => b.type === 'bridge').map(b => b.payload.actor)).toEqual(['Actor 1', 'Actor 2']);
  });

  test('atMs is the cumulative sum of prior durMs; index is the ordinal', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(2), winner: { name: 'P1', score: 1 } });
    let acc = 0;
    sb.forEach((b, i) => {
      expect(b.index).toBe(i);
      expect(b.atMs).toBe(acc);
      expect(Number.isInteger(b.durMs) && b.durMs > 0).toBe(true);
      acc += b.durMs;
    });
  });

  test('deterministic — same input yields identical storyboard', () => {
    const st = { gameMode: 'classic', chain: chainOf(4), winner: { name: 'P2', score: 7 } };
    expect(buildRecapStoryboard(st)).toEqual(buildRecapStoryboard(st));
  });

  test('empty/short chain — intro + finale only, no link/bridge', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: [], winner: null });
    expect(sb.map(b => b.type)).toEqual(['intro', 'finale']);
  });
});

describe('buildRecapStoryboard — curation cap & skipped beat', () => {
  test('chain >7 is curated to ≤7 links + a single skipped beat; total ≤13000ms', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(12), winner: { name: 'P1', score: 30 } });
    expect(sb.filter(b => b.type === 'link').length).toBeLessThanOrEqual(7);
    expect(sb.filter(b => b.type === 'skipped').length).toBe(1);
    expect(sb.find(b => b.type === 'skipped').payload.skipped).toBe(12 - 7);
    // pin the ordering: skipped beat must appear after the last link and before the finale
    const types = sb.map(b => b.type);
    const skippedIdx = types.indexOf('skipped');
    const lastLinkIdx = types.lastIndexOf('link');
    const finaleIdx = types.indexOf('finale');
    expect(skippedIdx).toBeGreaterThan(lastLinkIdx);
    expect(skippedIdx).toBeLessThan(finaleIdx);
    const last = sb[sb.length - 1];
    expect(last.atMs + last.durMs).toBeLessThanOrEqual(13000);
  });

  test('chain ≤7 produces no skipped beat', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(7), winner: { name: 'P1', score: 9 } });
    expect(sb.some(b => b.type === 'skipped')).toBe(false);
  });
});

describe('buildRecapStoryboard — finale parity with showGameOverBanner', () => {
  test('solo complete', () => {
    const sb = buildRecapStoryboard({ gameMode: 'solo', chain: chainOf(5), winner: { isSolo: true, chainLength: 5 } });
    const f = sb[sb.length - 1].payload;
    // kind pins the seam contract consumed by Task 1's driver
    expect(f.kind).toBe('solo-complete');
    expect(f.winnerLine).toBe('🎬 Solo Complete!');
    expect(f.subLine).toBe('🔗 Chain Length: 5 links');
  });
  test('solo over (no solo winner)', () => {
    const sb = buildRecapStoryboard({ gameMode: 'solo', chain: chainOf(1), winner: null });
    const f = sb[sb.length - 1].payload;
    // kind pins the seam contract consumed by Task 1's driver
    expect(f.kind).toBe('solo-over');
    expect(f.winnerLine).toBe('🎬 Solo Over');
    expect(f.subLine).toBe('🔗 Final Chain: 1 connection');
  });
  test('team win', () => {
    const sb = buildRecapStoryboard({ gameMode: 'team', chain: chainOf(4), winner: { isTeamWin: true, name: '🔴 Red', players: ['A', 'B'], score: 12 } });
    const f = sb[sb.length - 1].payload;
    // kind pins the seam contract consumed by Task 1's driver
    expect(f.kind).toBe('team');
    expect(f.winnerLine).toBe('🏆 🔴 Red wins!');
    expect(f.subLine).toBe('A & B • 12 pts');
  });
  test('classic winner', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(3), winner: { name: 'Zoe', score: 8 } });
    const f = sb[sb.length - 1].payload;
    // kind pins the seam contract consumed by Task 1's driver
    expect(f.kind).toBe('winner');
    expect(f.winnerLine).toBe('🏆 Zoe wins!');
    expect(f.subLine).toBe('8 pts • 3 connections');
  });
  test('no winner', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(2), winner: null });
    const f = sb[sb.length - 1].payload;
    // kind pins the seam contract consumed by Task 1's driver
    expect(f.kind).toBe('none');
    expect(f.winnerLine).toBe('🎬 Game Over!');
    expect(f.subLine).toBe('2 connections total');
  });
});

describe('buildRecapStoryboard — elimination best-effort (no fabrication)', () => {
  test('realistic fixture (no eliminated field) → zero elimination beats', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(5), winner: { name: 'P1', score: 9 } });
    expect(sb.some(b => b.type === 'elimination')).toBe(false);
  });
  test('synthetic entry with eliminated===true → one elimination beat (capability, not fabricated into real data)', () => {
    const chain = chainOf(3);
    chain[1].eliminated = true;
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain, winner: null });
    const elim = sb.filter(b => b.type === 'elimination');
    expect(elim.length).toBe(1);
    expect(elim[0].payload).toEqual({ playerName: 'P1' }); // chain[1].playerName === 'P1'
  });
});

describe('zero-identity sentinel', () => {
  test('no beat payload anywhere echoes stableId/socket id', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(9), winner: { name: 'P1', score: 20 } });
    const json = JSON.stringify(sb);
    expect(json).not.toMatch(/SECRET_/);
    expect(json).not.toMatch(/stableId/);
  });
});

describe('DRY relocation — ui-sharecard.js byte-stable public surface', () => {
  test('ui-sharecard re-exports the SAME function references as chain-recap', () => {
    expect(sharecard.selectChainEntries).toBe(selectChainEntries);
    expect(sharecard.scoreChainEntry).toBe(scoreChainEntry);
  });
  test('relocated selectChainEntries output parity for representative fixtures', () => {
    const small = chainOf(3);
    expect(selectChainEntries(small)).toEqual({ entries: small.map((c, i) => ({ ...c, _idx: i })), skipped: 0 });
    const big = chainOf(10);
    const r = selectChainEntries(big);
    expect(r.entries.length).toBe(7);
    expect(r.skipped).toBe(3);
    expect(r.entries[0]._idx).toBe(0);
    expect(r.entries[6]._idx).toBe(9);
  });
  test('scoreChainEntry seed returns -1; cross-mediaType adds 3', () => {
    expect(scoreChainEntry(chainOf(2)[0], 0, chainOf(2))).toBe(-1);
    const c = chainOf(2);
    c[0].movie.mediaType = 'tv'; c[1].movie.mediaType = 'movie';
    expect(scoreChainEntry(c[1], 1, c)).toBeGreaterThanOrEqual(3);
  });
});
