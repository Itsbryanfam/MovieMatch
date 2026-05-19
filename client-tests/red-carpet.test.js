/**
 * @jest-environment jsdom
 */
// Phase 7.5 — Red Carpet Lobby pure seams. WHY: the arrival diff, the
// device-local per-player accent, and the re-voiced Roll-Camera gating must
// be pure + unit-pinned (deterministic, defensive, NO stableId) BEFORE any
// glue wires them into renderLobby. jsdom docblock = client-tests dir
// convention; this module is pure so no DOM is touched.
// Phase 7.5.1 (Seat-Table): the accent COLOUR contract changed from a djb2
// hash hue to a frozen SEAT_HUES palette indexed by the player's seat slot
// (fixes the live collision where two identities shared a colour). This is
// 7.5's OWN unit suite legitimately tracking the model contract change — it
// is NOT the sacrosanct render-lobby.test.js zero-regression guard.
import {
  diffArrivals,
  playerCardModel,
  rollCameraLabel,
  marqueeSegments,
  ACCENT_EMOJI,
  SEAT_HUES,
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
  test('id guard: defined non-null id (0 or empty string) is a valid id (not skipped)', () => {
    expect(diffArrivals(new Set(), [{ id: 0 }, { id: 'b' }]).seen).toEqual([0, 'b']);
  });
  test('does not mutate inputs (purity)', () => {
    const seen = new Set(['a']);
    const players = [{ id: 'a' }, { id: 'b' }];
    diffArrivals(seen, players);
    expect([...seen]).toEqual(['a']);
    expect(players).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});

describe('SEAT_HUES (Phase 7.5.1 seat palette)', () => {
  test('frozen array of exactly 8 integer hues in [0,359]', () => {
    expect(Array.isArray(SEAT_HUES)).toBe(true);
    expect(SEAT_HUES).toHaveLength(8);
    expect(Object.isFrozen(SEAT_HUES)).toBe(true);
    SEAT_HUES.forEach(h => {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(359);
    });
  });
  test('all 8 hues are pairwise-distinct (no collision possible for a full lobby)', () => {
    expect(new Set(SEAT_HUES).size).toBe(8);
  });
});

describe('playerCardModel', () => {
  test('deterministic: same input + same slot → identical model across calls', () => {
    const p = { id: 's1', name: 'Ada', isHost: false, wins: 0 };
    expect(playerCardModel(p, { myPlayerId: 'x', slot: 3 }))
      .toEqual(playerCardModel(p, { myPlayerId: 'x', slot: 3 }));
  });
  test('accentHue is the seat palette entry; integer 0..359; emoji ∈ frozen 12-set', () => {
    const m = playerCardModel({ id: 's1', name: 'Ada' }, { slot: 2 });
    expect(m.accentHue).toBe(SEAT_HUES[2]);
    expect(Number.isInteger(m.accentHue)).toBe(true);
    expect(m.accentHue).toBeGreaterThanOrEqual(0);
    expect(m.accentHue).toBeLessThanOrEqual(359);
    expect(ACCENT_EMOJI).toHaveLength(12);
    expect(Object.isFrozen(ACCENT_EMOJI)).toBe(true);
    expect(ACCENT_EMOJI).toContain(m.accentEmoji);
  });
  test('slots 0..7 → the 8 distinct palette hues (collision-free for a full lobby)', () => {
    const hues = [0, 1, 2, 3, 4, 5, 6, 7].map(
      slot => playerCardModel({ id: 's' + slot, name: 'N' + slot }, { slot }).accentHue
    );
    expect(hues).toEqual([...SEAT_HUES]);
    expect(new Set(hues).size).toBe(8);
  });
  test('colour reads ZERO identity: different identities at the SAME slot → SAME hue', () => {
    const a = playerCardModel({ id: 'aaa', name: 'Kurosawa' }, { slot: 4 });
    const b = playerCardModel({ id: 'bbb', name: 'Coppola' }, { slot: 4 });
    expect(a.accentHue).toBe(b.accentHue);
    expect(a.accentHue).toBe(SEAT_HUES[4]);
  });
  test('defensive slot: non-finite / negative / non-integer / absent → valid in-range hue, never throws', () => {
    const base = { id: 's1', name: 'Ada' };
    expect(playerCardModel(base, {}).accentHue).toBe(SEAT_HUES[0]);
    expect(playerCardModel(base, { slot: undefined }).accentHue).toBe(SEAT_HUES[0]);
    expect(playerCardModel(base, { slot: -1 }).accentHue).toBe(SEAT_HUES[7]);
    expect(playerCardModel(base, { slot: 8 }).accentHue).toBe(SEAT_HUES[0]);
    expect(playerCardModel(base, { slot: 2.5 }).accentHue).toBe(SEAT_HUES[0]);
    expect(playerCardModel(base, { slot: NaN }).accentHue).toBe(SEAT_HUES[0]);
    expect(() => playerCardModel(base, { slot: Infinity })).not.toThrow();
    expect(SEAT_HUES).toContain(playerCardModel(base, { slot: Infinity }).accentHue);
  });
  test('emoji UNCHANGED: deterministic by name+id, independent of slot', () => {
    const s0 = playerCardModel({ id: 's1', name: 'Ada' }, { slot: 0 });
    const s5 = playerCardModel({ id: 's1', name: 'Ada' }, { slot: 5 });
    expect(s0.accentEmoji).toBe(s5.accentEmoji);
    expect(ACCENT_EMOJI).toContain(s0.accentEmoji);
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
    expect(playerCardModel(withStable, { myPlayerId: 'x', slot: 1 }))
      .toEqual(playerCardModel(base, { myPlayerId: 'x', slot: 1 }));
  });
  test('defensive: missing name/id/null does not throw', () => {
    expect(() => playerCardModel({}, {})).not.toThrow();
    expect(() => playerCardModel(null, null)).not.toThrow();
    expect(playerCardModel({}, {}).name).toBe('');
  });
  test('label: wins badge only for a positive finite count (defensive)', () => {
    expect(playerCardModel({ id: 'a', name: 'A', wins: 0 }, {}).label).toBe('A');
    expect(playerCardModel({ id: 'b', name: 'B', wins: -4 }, {}).label).toBe('B');
    expect(playerCardModel({ id: 'c', name: 'C', wins: NaN }, {}).label).toBe('C');
    expect(playerCardModel({ id: 'd', name: 'D', wins: Infinity }, {}).label).toBe('D');
    expect(playerCardModel({ id: 'e', name: 'E', wins: 3 }, {}).label).toBe('E • 3 🏆');
  });
});

describe('SEAT_HUES — exact literal pin (must match server/constants.js)', () => {
  test('the frozen palette is byte-identical to the server mirror', () => {
    // WHY exact values (the 7.5.1 suite only pinned len/distinct/range):
    // Phase 7.5.3 added server/constants.js SEAT_HUES for server-side
    // validation. Pinning the SAME literal on BOTH sides makes any drift
    // (a one-side edit) fail CI — they cannot cross-import (ESM vs CJS).
    expect([...SEAT_HUES]).toEqual([350, 25, 45, 140, 188, 220, 270, 312]);
  });
});

describe('playerCardModel — Phase 7.5.3 colorHue prefer/fallback', () => {
  test('no colorHue → slot hue + hasPickedColor false (byte-identical to 7.5.2)', () => {
    const m = playerCardModel({ id: 's1', name: 'Ada' }, { slot: 3 });
    expect(m.accentHue).toBe(SEAT_HUES[3]);
    expect(m.hasPickedColor).toBe(false);
  });
  test('valid in-palette colorHue overrides the slot hue', () => {
    const m = playerCardModel({ id: 's1', name: 'Ada', colorHue: SEAT_HUES[6] }, { slot: 2 });
    expect(m.accentHue).toBe(SEAT_HUES[6]);
    expect(m.hasPickedColor).toBe(true);
  });
  test('off-palette / non-int / null colorHue → slot fallback, not picked', () => {
    for (const bad of [37, 999, -1, 2.5, '350', null, undefined, NaN]) {
      const m = playerCardModel({ id: 's1', name: 'Ada', colorHue: bad }, { slot: 1 });
      expect(m.accentHue).toBe(SEAT_HUES[1]);
      expect(m.hasPickedColor).toBe(false);
    }
  });
  test('a picked colorHue still carries ZERO identity (sentinel: stableId irrelevant)', () => {
    const base = { id: 's1', name: 'Ada', colorHue: SEAT_HUES[4] };
    expect(playerCardModel({ ...base, stableId: 'p_LEAK' }, { slot: 0 }))
      .toEqual(playerCardModel(base, { slot: 0 }));
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
