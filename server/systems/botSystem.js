// ============================================================================
// botSystem.js — Phase 5a: bot opponents (cold-start fix)
// ============================================================================
// Owns: difficulty profiles, bot-player creation, move GENERATION (TMDB
// person-filmography pathfinding), and turn SCHEDULING. The concurrency-
// critical COMMIT is delegated to matchSystem.submitBotMove so the submit
// lock orchestration stays in one reviewed place. A bot is a normal
// room.players[] entry with isBot:true and no socket.
// ============================================================================

// Difficulty = a named parameter set the move generator reads. NOT branching
// code paths — just a profile object. WHY each knob:
//   whiff          — per-turn probability the bot "blanks" even when a move
//                    exists. THE beatability lever. INVARIANT: 0 < whiff < 1
//                    for every profile (incl. hard) so no difficulty is ever
//                    an unbeatable perfect-recall bot. Monotonic e>n>h.
//   delayMin/MaxMs — "thinking" delay window; realistic pacing, kept under
//                    the turn timer so a non-whiff move lands in time.
//   popularityFloor— TMDB movie popularity a pick must clear; higher = more
//                    mainstream/recognizable (easier human follow).
//   retryCap       — how many actor/candidate attempts before whiffing;
//                    bounded so the bot never loops to a perfect move.
// Starting values are tuning targets validated by the manual playtest gate.
const BOT_DIFFICULTIES = {
  easy:   { whiff: 0.45, delayMinMs: 4000, delayMaxMs: 9000, popularityFloor: 20, retryCap: 1 },
  normal: { whiff: 0.25, delayMinMs: 3000, delayMaxMs: 7000, popularityFloor: 10, retryCap: 2 },
  hard:   { whiff: 0.09, delayMinMs: 2000, delayMaxMs: 5000, popularityFloor: 4,  retryCap: 3 },
};

// Themed names so a bot is always visibly a bot (paired with a UI "BOT"
// badge). 8 names ≥ the 8-player cap, so a lobby can never exhaust them.
const BOT_NAMES = [
  'Bot Bogart', 'Bot Kubrick', 'Bot Hitchcock', 'Bot Kurosawa',
  'Bot Coppola', 'Bot Spielberg', 'Bot Scorsese', 'Bot Tarantino',
];

// Smallest free positive integer N such that `bot_N` is not already an id in
// the lobby. WHY not a timestamp/random: tests need determinism and a small
// stable id reads well in logs; collisions across remove/re-add are avoided
// by scanning existing ids rather than using a monotonic counter (which would
// drift if a bot is removed then another added).
function _nextBotIndex(existingPlayers) {
  const used = new Set(
    (existingPlayers || [])
      .map(p => /^bot_(\d+)$/.exec(p && p.id))
      .filter(Boolean)
      .map(m => Number(m[1]))
  );
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

function createBot(existingPlayers, difficulty) {
  const players = existingPlayers || [];
  // Invalid/missing difficulty falls back to normal so a buggy client can
  // never inject an unknown profile (move generator would read undefined).
  const diff = BOT_DIFFICULTIES[difficulty] ? difficulty : 'normal';
  const n = _nextBotIndex(players);
  // Pick a themed name not already taken in this lobby; cycle with a numeric
  // suffix if (improbably) all 8 base names are in use.
  const taken = new Set(players.map(p => p && p.name));
  let name = BOT_NAMES[(n - 1) % BOT_NAMES.length];
  if (taken.has(name)) name = `${name} ${n}`;
  return {
    id: `bot_${n}`,
    name,
    isHost: false,        // a bot is NEVER host (host = settings/start authority)
    isBot: true,          // discriminator used everywhere (lifecycle, hooks, UI)
    isAlive: true,
    connected: true,      // keeps existing connected-filters treating it as present
    score: 0,
    wins: 0,
    teamId: players.length % 2, // mirrors human join parity (lobbySystem L105)
    difficulty: diff,
    stableId: null,       // no identity → auto-excluded from all stats writes
  };
}

module.exports = { BOT_DIFFICULTIES, BOT_NAMES, createBot };
