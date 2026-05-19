// ============================================================================
// gameLogic.colorhue.test.js — Phase 7.5.3 toClientState carries colorHue,
// never stableId (G1). WHY a dedicated file: keeps server/gameLogic.test.js
// BYTE-IDENTICAL (the §5 ratchet) while pinning the additive-field invariant.
// toClientState is pure — no redis/socket needed.
// ============================================================================
const { toClientState } = require('./gameLogic');

test('toClientState carries colorHue on each player and strips stableId', () => {
  const room = {
    id: 'R', status: 'waiting', players: [
      { id: 'a', name: 'A', isHost: true, stableId: 'p_SECRET_A', colorHue: 350 },
      { id: 'b', name: 'B', stableId: 'p_SECRET_B' },
    ],
    spectators: [], chain: [],
  };
  const cs = toClientState(room);
  expect(cs.players[0].colorHue).toBe(350);
  expect('colorHue' in cs.players[1]).toBe(false);
  cs.players.forEach(p => expect('stableId' in p).toBe(false));
  expect(JSON.stringify(cs)).not.toContain('p_SECRET');
});
