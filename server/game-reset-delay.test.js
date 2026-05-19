// server/game-reset-delay.test.js
// WHY: user feedback — after a game ends the room flipped finished→waiting
// after only 7s, which pre-empted the client Chain Premiere Recap (the
// storyboard runs up to ~12.55s) AND left no time to open/look at the
// share card before the game-over banner was replaced by the lobby. This
// pins the post-game window as an explicit, exported, documented constant
// whose value MUST outlast the recap budget so the reset can never race
// it. A pure constant assertion is the testable seam for scheduleGameReset
// (an internal .unref()'d setTimeout that is intentionally not exported).
const gameLogic = require('./gameLogic');

describe('GAME_RESET_DELAY_MS — post-game viewing window', () => {
  test('is an exported positive integer (ms)', () => {
    expect(typeof gameLogic.GAME_RESET_DELAY_MS).toBe('number');
    expect(Number.isInteger(gameLogic.GAME_RESET_DELAY_MS)).toBe(true);
    expect(gameLogic.GAME_RESET_DELAY_MS).toBeGreaterThan(0);
  });

  test('outlasts the client recap budget so the reset cannot pre-empt it', () => {
    // chain-recap.js BEAT_MS sums to a hard ceiling of ~12.55s; 13000 is
    // that budget rounded up. The reset must be strictly longer so a
    // player can watch the full recap AND still reach the Share button.
    const RECAP_BUDGET_MS = 13000;
    expect(gameLogic.GAME_RESET_DELAY_MS).toBeGreaterThanOrEqual(RECAP_BUDGET_MS);
  });

  test('is bounded so a multiplayer lobby is not stranded', () => {
    // Upper sanity bound — generous viewing time, but the room must
    // eventually return to the lobby on its own.
    expect(gameLogic.GAME_RESET_DELAY_MS).toBeLessThanOrEqual(60000);
  });
});
