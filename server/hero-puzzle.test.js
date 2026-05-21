// Phase 7.9 — server-side puzzle bank + validator unit tests.
// WHY: server is authoritative for the bank and the answer set; client
// never sees validActorTmdbIds for server-supplied puzzles.

const {
  HERO_PUZZLE_BANK,
  pickRandomPuzzle,
  toClientPuzzle,
  validateGuess,
} = require('./heroPuzzle');

describe('HERO_PUZZLE_BANK', () => {
  test('non-empty bank with well-formed entries', () => {
    expect(Array.isArray(HERO_PUZZLE_BANK)).toBe(true);
    expect(HERO_PUZZLE_BANK.length).toBeGreaterThanOrEqual(5);
    for (const p of HERO_PUZZLE_BANK) {
      expect(typeof p.pairId).toBe('string');
      expect(p.movieA).toBeTruthy();
      expect(p.movieB).toBeTruthy();
      expect(Array.isArray(p.validActorTmdbIds)).toBe(true);
      expect(p.validActorTmdbIds.length).toBeGreaterThan(0);
      expect(p.revealActor).toBeTruthy();
      expect(typeof p.revealActor.tmdbId).toBe('number');
      expect(typeof p.revealActor.name).toBe('string');
    }
    const ids = HERO_PUZZLE_BANK.map(p => p.pairId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('toClientPuzzle', () => {
  test('strips validActorTmdbIds (the secret) but keeps revealActor (for local Show Me)', () => {
    const sample = HERO_PUZZLE_BANK[0];
    const wire = toClientPuzzle(sample);
    expect(wire.pairId).toBe(sample.pairId);
    expect(wire.movieA).toEqual(sample.movieA);
    expect(wire.movieB).toEqual(sample.movieB);
    expect(wire.revealActor).toEqual(sample.revealActor);
    // validActorTmdbIds is the strict secret (multi-actor answer set) — never on the wire.
    expect(wire.validActorTmdbIds).toBeUndefined();
  });
});

describe('validateGuess', () => {
  test('correct tmdbId returns { ok: true, correct: true, revealActor }', () => {
    const sample = HERO_PUZZLE_BANK[0];
    const result = validateGuess(sample.pairId, sample.validActorTmdbIds[0]);
    expect(result).toEqual({ ok: true, correct: true, revealActor: sample.revealActor });
  });

  test('wrong tmdbId returns { ok: true, correct: false, revealActor }', () => {
    const sample = HERO_PUZZLE_BANK[0];
    const result = validateGuess(sample.pairId, 999999999);
    expect(result).toEqual({ ok: true, correct: false, revealActor: sample.revealActor });
  });

  test('unknown pairId returns { ok: false, reason: "unknown-pair" }', () => {
    const result = validateGuess('nope-bad-id', 1245);
    expect(result).toEqual({ ok: false, reason: 'unknown-pair' });
  });
});
