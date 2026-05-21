/**
 * @jest-environment jsdom
 */
// Phase 7.9 — Playable Hero pure seam unit tests. WHY: the seam owns the
// bundled puzzle bank, selection logic, and guess-outcome classification.
// Pure functions, no DOM, no socket — full coverage at this layer keeps
// the driver tests focused on wiring.
import {
  BUNDLED_PUZZLES,
  pickBundledPuzzle,
  classifyOutcome,
} from '../public/js/ui.js';

describe('BUNDLED_PUZZLES', () => {
  test('exports a non-empty array of well-formed puzzles', () => {
    expect(Array.isArray(BUNDLED_PUZZLES)).toBe(true);
    expect(BUNDLED_PUZZLES.length).toBeGreaterThanOrEqual(1);
    expect(BUNDLED_PUZZLES.length).toBeLessThanOrEqual(3);

    for (const p of BUNDLED_PUZZLES) {
      expect(typeof p.pairId).toBe('string');
      expect(p.pairId.length).toBeGreaterThan(0);

      expect(p.movieA).toBeTruthy();
      expect(typeof p.movieA.title).toBe('string');
      expect(typeof p.movieA.year).toBe('number');
      expect(typeof p.movieA.posterUrl).toBe('string');
      expect(typeof p.movieA.tmdbId).toBe('number');

      expect(p.movieB).toBeTruthy();
      expect(typeof p.movieB.title).toBe('string');
      expect(typeof p.movieB.year).toBe('number');
      expect(typeof p.movieB.posterUrl).toBe('string');
      expect(typeof p.movieB.tmdbId).toBe('number');

      expect(Array.isArray(p.validActorTmdbIds)).toBe(true);
      expect(p.validActorTmdbIds.length).toBeGreaterThan(0);
      for (const id of p.validActorTmdbIds) {
        expect(typeof id).toBe('number');
      }

      expect(p.revealActor).toBeTruthy();
      expect(typeof p.revealActor.tmdbId).toBe('number');
      expect(typeof p.revealActor.name).toBe('string');
    }
  });

  test('all pairIds are unique', () => {
    const ids = BUNDLED_PUZZLES.map(p => p.pairId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('pickBundledPuzzle', () => {
  test('returns a puzzle from the bank when seen is empty', () => {
    const picked = pickBundledPuzzle({ seen: [] });
    expect(BUNDLED_PUZZLES).toContain(picked);
  });

  test('skips seen pairIds when at least one remains', () => {
    const seen = [BUNDLED_PUZZLES[0].pairId];
    // Run many times — random selection should never return a seen id while
    // a fresh one is available. 50 samples gives a vanishing false-pass rate.
    for (let i = 0; i < 50; i++) {
      const picked = pickBundledPuzzle({ seen });
      expect(picked.pairId).not.toBe(seen[0]);
    }
  });

  test('falls back to full bank when every id is seen', () => {
    const seen = BUNDLED_PUZZLES.map(p => p.pairId);
    const picked = pickBundledPuzzle({ seen });
    expect(picked).toBeDefined();
    expect(BUNDLED_PUZZLES).toContain(picked);
  });

  test('default-args (no argument) behaves like seen=[]', () => {
    const picked = pickBundledPuzzle();
    expect(BUNDLED_PUZZLES).toContain(picked);
  });
});

describe('classifyOutcome', () => {
  const puzzle = BUNDLED_PUZZLES[0];

  test('correct guess returns { kind: "correct", revealActor }', () => {
    const out = classifyOutcome(puzzle, {
      actorTmdbId: puzzle.validActorTmdbIds[0],
      actorName: puzzle.revealActor.name,
    });
    expect(out.kind).toBe('correct');
    expect(out.revealActor).toEqual(puzzle.revealActor);
  });

  test('incorrect guess returns { kind: "incorrect", revealActor, guessedName }', () => {
    // 999999999 is well outside the bundled validActorTmdbIds.
    const out = classifyOutcome(puzzle, {
      actorTmdbId: 999999999,
      actorName: 'Some Other Actor',
    });
    expect(out.kind).toBe('incorrect');
    expect(out.revealActor).toEqual(puzzle.revealActor);
    expect(out.guessedName).toBe('Some Other Actor');
  });

  test('null/missing puzzle returns { kind: "invalid" }', () => {
    expect(classifyOutcome(null, { actorTmdbId: 1 })).toEqual({ kind: 'invalid' });
    expect(classifyOutcome(undefined, { actorTmdbId: 1 })).toEqual({ kind: 'invalid' });
  });

  test('missing actorTmdbId returns { kind: "invalid" }', () => {
    expect(classifyOutcome(puzzle, {})).toEqual({ kind: 'invalid' });
    expect(classifyOutcome(puzzle, { actorTmdbId: null })).toEqual({ kind: 'invalid' });
    expect(classifyOutcome(puzzle)).toEqual({ kind: 'invalid' });
  });
});
