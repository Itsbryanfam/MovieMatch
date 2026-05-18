/**
 * @jest-environment jsdom
 */
// Phase 7.5 — Red Carpet Lobby pure seams. WHY: the arrival diff, the
// device-local per-player accent, and the re-voiced Roll-Camera gating must
// be pure + unit-pinned (deterministic, defensive, NO stableId) BEFORE any
// glue wires them into renderLobby. jsdom docblock = client-tests dir
// convention; this module is pure so no DOM is touched.
import {
  diffArrivals,
  playerCardModel,
  rollCameraLabel,
  marqueeSegments,
  ACCENT_EMOJI,
} from '../public/js/ui/red-carpet.js';

describe('diffArrivals', () => {
  test('empty seen → everyone entering; seen = current roster', () => {
    const r = diffArrivals(new Set(), [{ id: 'a' }, { id: 'b' }]);
    expect(r.entering).toEqual(['a', 'b']);
    expect(r.seen).toEqual(['a', 'b']);
  });
  test('idempotent: roster already seen → nobody entering', () => {
    const r = diffArrivals(new Set(['a', 'b']), [{ id: 'a' }, { id: 'b' }]);
    expect(r.entering).toEqual([]);
    expect(r.seen).toEqual(['a', 'b']);
  });
  test('only the newly added id is entering', () => {
    const r = diffArrivals(new Set(['a']), [{ id: 'a' }, { id: 'c' }]);
    expect(r.entering).toEqual(['c']);
    expect(r.seen).toEqual(['a', 'c']);
  });
  test('departed id pruned from seen (bounded)', () => {
    const r = diffArrivals(new Set(['a', 'b']), [{ id: 'a' }]);
    expect(r.seen).toEqual(['a']);
    expect(r.entering).toEqual([]);
  });
  test('leave→rejoin (new socket id) re-animates', () => {
    expect(diffArrivals(new Set(['a']), [{ id: 'a2' }]).entering).toEqual(['a2']);
  });
  test('tolerates array seenIds / non-array players / missing id', () => {
    expect(diffArrivals(['a'], [{ id: 'a' }, { id: 'b' }]).entering).toEqual(['b']);
    expect(diffArrivals(null, null)).toEqual({ entering: [], seen: [] });
    expect(diffArrivals(new Set(), [{ id: 'a' }, {}, { id: null }, { id: 'b' }]).seen)
      .toEqual(['a', 'b']);
  });
  test('does not mutate inputs (purity)', () => {
    const seen = new Set(['a']);
    const players = [{ id: 'a' }, { id: 'b' }];
    diffArrivals(seen, players);
    expect([...seen]).toEqual(['a']);
    expect(players).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});

describe('playerCardModel', () => {
  test('deterministic: same name+id → identical model across calls', () => {
    const p = { id: 's1', name: 'Ada', isHost: false, wins: 0 };
    expect(playerCardModel(p, { myPlayerId: 'x' }))
      .toEqual(playerCardModel(p, { myPlayerId: 'x' }));
  });
  test('accentHue int 0..359; accentEmoji ∈ exported frozen 12-set', () => {
    const m = playerCardModel({ id: 's1', name: 'Ada' }, {});
    expect(Number.isInteger(m.accentHue)).toBe(true);
    expect(m.accentHue).toBeGreaterThanOrEqual(0);
    expect(m.accentHue).toBeLessThanOrEqual(359);
    expect(ACCENT_EMOJI).toHaveLength(12);
    expect(Object.isFrozen(ACCENT_EMOJI)).toBe(true);
    expect(ACCENT_EMOJI).toContain(m.accentEmoji);
  });
  test('different identity → different accent (hue or emoji differs)', () => {
    const a = playerCardModel({ id: 's1', name: 'Ada' }, {});
    const b = playerCardModel({ id: 's2', name: 'Bo' }, {});
    expect(a.accentHue !== b.accentHue || a.accentEmoji !== b.accentEmoji).toBe(true);
  });
  test('label mirrors the exact (You)/👑/• N 🏆 matrix', () => {
    expect(playerCardModel({ id: 'h', name: 'Host', isHost: true }, { myPlayerId: 'h' }).label)
      .toBe('Host (You) 👑');
    expect(playerCardModel({ id: 'g', name: 'Guest' }, { myPlayerId: 'h' }).label).toBe('Guest');
    expect(playerCardModel({ id: 'w', name: 'Pro', wins: 3 }, {}).label).toBe('Pro • 3 🏆');
  });
  test('isYou/isHost/isBot/wins derivation', () => {
    expect(playerCardModel({ id: 'me', name: 'Me', isHost: true, isBot: false, wins: 2 },
      { myPlayerId: 'me' })).toMatchObject({ isYou: true, isHost: true, isBot: false, wins: 2, name: 'Me' });
    expect(playerCardModel({ id: 'b', name: 'B', isBot: true, wins: -4 }, {}))
      .toMatchObject({ isBot: true, wins: 0 });
  });
  test('SECURITY sentinel: a stableId on the input never affects the model', () => {
    const base = { id: 's1', name: 'Ada', isHost: true, wins: 1 };
    const withStable = { ...base, stableId: 'p_SECRET_LEAK' };
    expect(playerCardModel(withStable, { myPlayerId: 'x' }))
      .toEqual(playerCardModel(base, { myPlayerId: 'x' }));
  });
  test('defensive: missing name/id/null does not throw', () => {
    expect(() => playerCardModel({}, {})).not.toThrow();
    expect(() => playerCardModel(null, null)).not.toThrow();
    expect(playerCardModel({}, {}).name).toBe('');
  });
});

describe('rollCameraLabel — gating (disabled/variant exact, copy re-voiced)', () => {
  test('classic <2 players → Waiting for the cast (disabled)', () => {
    expect(rollCameraLabel({ amIHost: true, playerCount: 1, mode: 'classic' }))
      .toEqual({ text: 'Waiting for the cast…', disabled: true, variant: 'waiting-cast' });
  });
  test('classic 2 players host → Roll Camera (enabled)', () => {
    expect(rollCameraLabel({ amIHost: true, playerCount: 2, mode: 'classic' }))
      .toEqual({ text: '🎬 Roll Camera', disabled: false, variant: 'ready' });
  });
  test('classic 2 players non-host → Waiting for the director (disabled)', () => {
    expect(rollCameraLabel({ amIHost: false, playerCount: 2, mode: 'classic' }))
      .toEqual({ text: 'Waiting for the director…', disabled: true, variant: 'waiting-host' });
  });
  test('solo 1 player host → Roll Camera (enabled)', () => {
    expect(rollCameraLabel({ amIHost: true, playerCount: 1, mode: 'solo' }))
      .toEqual({ text: '🎬 Roll Camera', disabled: false, variant: 'ready' });
  });
  test('solo 1 player non-host → Waiting for the director', () => {
    expect(rollCameraLabel({ amIHost: false, playerCount: 1, mode: 'solo' }))
      .toEqual({ text: 'Waiting for the director…', disabled: true, variant: 'waiting-host' });
  });
  test('defensive: non-finite/absent playerCount → waiting-cast disabled', () => {
    expect(rollCameraLabel({ amIHost: true, mode: 'classic' }).variant).toBe('waiting-cast');
    expect(rollCameraLabel({}).disabled).toBe(true);
  });
});

describe('marqueeSegments', () => {
  test('splits a code into per-char cells', () => {
    expect(marqueeSegments('AB12')).toEqual(['A', 'B', '1', '2']);
  });
  test('empty / non-string → []', () => {
    expect(marqueeSegments('')).toEqual([]);
    expect(marqueeSegments(null)).toEqual([]);
    expect(marqueeSegments(42)).toEqual([]);
  });
});
