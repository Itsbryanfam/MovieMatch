/**
 * @jest-environment jsdom
 */
// Phase 7.8b — pure-seam tests for seatModel + buildSeatNode.
// seatModel is the unified per-seat model: classic mode uses SEAT_HUES[slot]
// (or colorHue), team mode uses team:'red'|'blue' (no accentHue, no swatches).
// playerCardModel is now a thin wrapper around seatModel({mode:'classic',...})
// — its byte-identical-output contract is pinned by the wrapper-equivalence
// sentinel + the unedited red-carpet.test.js suite continuing to pass.

const { seatModel, playerCardModel, SEAT_HUES } = require('../public/js/ui/red-carpet.js');

describe('seatModel — pure model', () => {
  describe('classic mode', () => {
    test('slot N maps to SEAT_HUES[N]; no team key', () => {
      const p = { id: 's1', name: 'Alice', isHost: false };
      const m = seatModel(p, { mode: 'classic', slot: 3, myPlayerId: 'sX' });
      expect(m.accentHue).toBe(SEAT_HUES[3]);
      expect(m.team).toBeUndefined();
      expect(m.name).toBe('Alice');
    });

    test('out-of-range slot wraps via double-modulo (negative-safe)', () => {
      const p = { id: 's1', name: 'A' };
      const negative = seatModel(p, { mode: 'classic', slot: -1, myPlayerId: 'sX' });
      expect(negative.accentHue).toBe(SEAT_HUES[7]);  // (-1 % 8 + 8) % 8 === 7
      const over = seatModel(p, { mode: 'classic', slot: 9, myPlayerId: 'sX' });
      expect(over.accentHue).toBe(SEAT_HUES[1]);       // 9 % 8 === 1
    });

    test('valid colorHue pick overrides slot hue; hasPickedColor:true', () => {
      const p = { id: 's1', name: 'A', colorHue: SEAT_HUES[5] };
      const m = seatModel(p, { mode: 'classic', slot: 2, myPlayerId: 'sX' });
      expect(m.accentHue).toBe(SEAT_HUES[5]);
      expect(m.hasPickedColor).toBe(true);
    });

    test('off-palette colorHue falls back to slot hue; hasPickedColor:false', () => {
      const p = { id: 's1', name: 'A', colorHue: 999 };
      const m = seatModel(p, { mode: 'classic', slot: 2, myPlayerId: 'sX' });
      expect(m.accentHue).toBe(SEAT_HUES[2]);
      expect(m.hasPickedColor).toBe(false);
    });
  });

  describe('team mode', () => {
    test('team:red → team key set, no accentHue, no hasPickedColor', () => {
      const p = { id: 's1', name: 'A', isHost: false };
      const m = seatModel(p, { mode: 'team', team: 'red', myPlayerId: 'sX' });
      expect(m.team).toBe('red');
      expect(m).not.toHaveProperty('accentHue');
      expect(m).not.toHaveProperty('hasPickedColor');
    });

    test('team:blue symmetric', () => {
      const p = { id: 's1', name: 'A', isHost: false };
      const m = seatModel(p, { mode: 'team', team: 'blue', myPlayerId: 'sX' });
      expect(m.team).toBe('blue');
      expect(m).not.toHaveProperty('accentHue');
    });

    test('team mode ignores colorHue (no per-player pick in team mode)', () => {
      const p = { id: 's1', name: 'A', colorHue: SEAT_HUES[5] };
      const m = seatModel(p, { mode: 'team', team: 'red', myPlayerId: 'sX' });
      expect(m).not.toHaveProperty('accentHue');
      expect(m).not.toHaveProperty('hasPickedColor');
    });
  });

  describe('zero-identity discipline (no stableId leak)', () => {
    test('classic: passing stableId does not change any field', () => {
      const base = { id: 's1', name: 'A', isHost: false };
      const withStable = { ...base, stableId: 'STABLE_X' };
      const a = seatModel(base, { mode: 'classic', slot: 0, myPlayerId: 'sX' });
      const b = seatModel(withStable, { mode: 'classic', slot: 0, myPlayerId: 'sX' });
      expect(a).toEqual(b);
    });

    test('team: passing stableId does not change any field', () => {
      const base = { id: 's1', name: 'A', isHost: false };
      const withStable = { ...base, stableId: 'STABLE_X' };
      const a = seatModel(base, { mode: 'team', team: 'red', myPlayerId: 'sX' });
      const b = seatModel(withStable, { mode: 'team', team: 'red', myPlayerId: 'sX' });
      expect(a).toEqual(b);
    });
  });

  describe('playerCardModel wrapper-equivalence', () => {
    test('playerCardModel(p, opts) ≡ seatModel(p, {...opts, mode:"classic"})', () => {
      const cases = [
        [{ id: 's1', name: 'Host', isHost: true }, { myPlayerId: 's1', slot: 0 }],
        [{ id: 's2', name: 'Guest', wins: 3 },     { myPlayerId: 's1', slot: 1 }],
        [{ id: 's3', name: 'Bot', isBot: true },   { myPlayerId: 's1', slot: 7 }],
        [{ id: 's4', name: 'P', colorHue: SEAT_HUES[5] }, { myPlayerId: 's4', slot: 2 }],
      ];
      for (const [p, opts] of cases) {
        const a = playerCardModel(p, opts);
        const b = seatModel(p, { ...opts, mode: 'classic' });
        expect(a).toEqual(b);
      }
    });
  });
});
