const redisUtils = require('./redisUtils');
const logger = require('pino')();

// In-memory map for active turn timeouts.
// Stored in-process (not Redis) because setTimeout handles are not serializable.
const activeTurnTimeouts = new Map();

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

// Clears the active turn timeout for a room if one is armed.
// Called before arming a new timeout, on game end, and on disconnect.
function clearTurnTimeout(id) {
  if (activeTurnTimeouts.has(id)) {
    clearTimeout(activeTurnTimeouts.get(id));
    activeTurnTimeouts.delete(id);
  }
}

function broadcastState(io, id, state) {
  const clientState = {
    ...state,
    players: state.players.map(({ stableId, ...rest }) => rest),
    spectators: undefined,
    spectatorCount: (state.spectators || []).filter(s => s.connected).length,
    chain: state.chain.map(item => ({
      playerId: item.playerId,
      playerName: item.playerName,
      movie: item.movie,
      matchedActors: item.matchedActors || []
    })),
    winner: state.winner || null
  };
  io.to(id).emit('stateUpdate', clientState);
}

// Records a win for a single player. Goes through redisUtils.recordPlayerWinAtomic
// so the per-player count, leaderboard ZSET, and name lookup are all written in
// one Redis transaction — they can't drift on partial failure the way the
// previous Promise.all pattern could.
async function recordPlayerWin(pubClient, player) {
  // stableId is the canonical identity; fall back to socket.id for older
  // states/tests that didn't carry a stableId.
  await redisUtils.recordPlayerWinAtomic(pubClient, player.stableId || player.id, player.name);
}

// ---------------------------------------------------------------------------
// ELIMINATION
// ---------------------------------------------------------------------------

async function eliminateTeam(io, pubClient, id, state, teamId, reason) {
  const teamLabel = teamId === 0 ? '🔴 Red' : '🔵 Blue';
  // Structured payload: `kind` lets the client dispatch effects (sounds,
  // shakes, vibration) without brittle substring matching on the human-
  // readable `msg`. Future i18n won't break elimination effects.
  io.to(id).emit('notification', { msg: `Team ${teamLabel} eliminated: ${reason}`, kind: 'elimination' });
  state.players.forEach(p => {
    if (p.teamId === teamId) p.isAlive = false;
  });
  await checkWinCondition(io, pubClient, id, state);
  if (state.status === 'playing') {
    await nextTurn(io, pubClient, id, state);
  }
}

async function eliminateCurrentPlayer(io, pubClient, id, state, reason) {
  if (state.gameMode === 'team') {
    const player = state.players[state.currentTurnIndex];
    const teamId = player ? player.teamId : 0;
    await eliminateTeam(io, pubClient, id, state, teamId, reason);
    return;
  }
  const player = state.players[state.currentTurnIndex];
  if (player) {
    player.isAlive = false;
    io.to(id).emit('notification', { msg: `${player.name} eliminated: ${reason}`, kind: 'elimination' });
  }
  await checkWinCondition(io, pubClient, id, state);
  if (state.status === 'playing') {
    await nextTurn(io, pubClient, id, state);
  }
}

// ---------------------------------------------------------------------------
// TURN MANAGEMENT
// ---------------------------------------------------------------------------

async function nextTurn(io, pubClient, id, state) {
  await checkWinCondition(io, pubClient, id, state);
  if (state.status !== 'playing') return;

  clearTurnTimeout(id);

  let iterations = 0;
  do {
    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.players.length;
    iterations++;
  } while (!state.players[state.currentTurnIndex].isAlive && iterations < state.players.length);

  // Guard: all players ended up dead — checkWinCondition should have caught this,
  // but don't arm a new timer on a dead player if it somehow slips through.
  if (!state.players[state.currentTurnIndex].isAlive) return;

  resetTimer(state);

  // Server-side hard timeout: eliminates the current player if they haven't
  // submitted by the time the client-side timer expires. The +4s grace period
  // gives the client's forceNextTurn emit time to arrive and be processed first,
  // so the server timeout only fires when the client is genuinely unreachable.
  const turnTimeMs = state.turnTime || 45000;
  const timeoutId = setTimeout(async () => {
    // Take the submit lock before acting — without this, the watchdog races
    // with submitMovie and forceNextTurn, which can double-eliminate or skip
    // turns. If the lock is held, a submit is in flight and will advance the
    // turn naturally; we should bail out and let it.
    const lockToken = await redisUtils.acquireSubmitLock(pubClient, id);
    if (!lockToken) {
      activeTurnTimeouts.delete(id);
      return;
    }
    try {
      const liveRoom = await redisUtils.getLobby(pubClient, id);
      // Re-check expiry on the FRESH state — another lock holder may have
      // already advanced the turn, in which case turnExpiresAt is now in
      // the future and we no-op.
      if (liveRoom && liveRoom.status === 'playing' &&
          liveRoom.turnExpiresAt && Date.now() > liveRoom.turnExpiresAt) {
        await eliminateCurrentPlayer(io, pubClient, id, liveRoom, "Turn timed out");
      }
    } catch (err) {
      logger.error(err, 'Timeout handler error');
    } finally {
      activeTurnTimeouts.delete(id);
      await redisUtils.releaseSubmitLock(pubClient, id, lockToken).catch(() => {});
    }
  }, turnTimeMs + 4000);

  activeTurnTimeouts.set(id, timeoutId);

  await redisUtils.saveLobby(pubClient, id, state);
  broadcastState(io, id, state);
}

function promoteSpectators(state) {
  if (!state.spectators || state.spectators.length === 0) return;
  // Disconnected spectators don't get promoted — they wouldn't be there to play.
  const connected = state.spectators.filter(s => s.connected);
  // 8-player hard cap defined in joinLobby; same value used here.
  const slotsAvailable = 8 - state.players.length;
  const promoted = connected.slice(0, slotsAvailable);

  promoted.forEach(s => {
    // Recompute team sizes inside the loop — the previous iteration may have
    // just added to one team, so each promotion looks at the current state,
    // not a snapshot from before the loop. The old `state.players.length % 2`
    // pattern ignored team imbalance entirely (e.g. on restart after a 4-vs-1
    // game it would land new players on team 0 first, worsening the gap).
    const t0 = state.players.filter(p => p.teamId === 0).length;
    const t1 = state.players.filter(p => p.teamId === 1).length;
    state.players.push({
      id: s.id, name: s.name, isHost: false, isAlive: true,
      connected: true, score: 0, wins: s.wins || 0,
      // Assign to the smaller team. Ties go to team 0 (consistent with the
      // initial join order in joinLobby, which also favors team 0 first).
      teamId: t0 <= t1 ? 0 : 1,
      stableId: s.stableId
    });
  });

  // Anything beyond slotsAvailable stays in spectators — they'll get a shot next round.
  state.spectators = connected.slice(slotsAvailable);
}

function scheduleGameReset(io, pubClient, id) {
  setTimeout(async () => {
    try {
      const liveState = await redisUtils.getLobby(pubClient, id);
      if (liveState && liveState.status === 'finished') {
        liveState.status = 'waiting';
        liveState.players = liveState.players.filter(p => p.connected);
        promoteSpectators(liveState);
        if (liveState.players.length > 0 && !liveState.players.some(p => p.isHost)) {
          liveState.players[0].isHost = true;
        }
        await redisUtils.saveLobby(pubClient, id, liveState);
        broadcastState(io, id, liveState);
      }
    } catch (err) {
      logger.error(err, 'Game reset error');
    }
  }, 7000);
}

function resetTimer(state) {
  if (state.gameMode === 'speed') {
    // Speed mode: flat 15s every turn, no reduction logic.
    state.turnDurationMs = 15000;
  } else {
    // Classic/team/solo: every 2 successful turns the time limit shrinks by
    // 5 seconds, floored at 10s. timerMultiplier increments each turn.
    const reduction = Math.floor(state.timerMultiplier / 2) * 5;
    state.turnDurationMs = Math.max(10, 60 - reduction) * 1000;
  }
  // Persist BOTH fields so the client can render the timer bar correctly:
  // turnDurationMs is the bar's denominator, turnExpiresAt drives the countdown.
  // Without turnDurationMs, the client would have to assume 60s — which is
  // wrong in speed mode and after hardcore-shrink in classic.
  state.turnExpiresAt = Date.now() + state.turnDurationMs;
}

// ---------------------------------------------------------------------------
// WIN CONDITION CHECKS (one per game mode)
// ---------------------------------------------------------------------------

async function checkTeamWin(io, pubClient, id, state) {
  const teamAlive = [false, false];
  state.players.forEach(p => {
    if (p.isAlive && p.teamId !== undefined) teamAlive[p.teamId] = true;
  });
  if (teamAlive.filter(Boolean).length > 1) return; // both teams still alive

  clearTurnTimeout(id);
  state.status = 'finished';
  state.turnExpiresAt = null;

  const winningTeamId = teamAlive[0] ? 0 : 1;
  const winningPlayers = state.players.filter(p => p.teamId === winningTeamId);
  await Promise.all(winningPlayers.map(p => {
    p.wins = (p.wins || 0) + 1;
    return recordPlayerWin(pubClient, p);
  }));

  const teamLabel = winningTeamId === 0 ? '🔴 Red' : '🔵 Blue';
  state.winner = {
    name: `Team ${teamLabel}`,
    teamId: winningTeamId,
    players: winningPlayers.map(p => p.name),
    score: winningPlayers.reduce((sum, p) => sum + p.score, 0),
    isTeamWin: true
  };
  io.to(id).emit('notification', { msg: `Team ${teamLabel} wins!`, kind: 'win' });
  await redisUtils.saveLobby(pubClient, id, state);
  broadcastState(io, id, state);
  scheduleGameReset(io, pubClient, id);
}

async function checkSoloWin(io, pubClient, id, state) {
  const alive = state.players.filter(p => p.isAlive);
  if (alive.length > 0) return; // player still alive

  clearTurnTimeout(id);
  state.status = 'finished';
  state.turnExpiresAt = null;

  const solo = state.players[0];
  if (solo) {
    solo.wins = (solo.wins || 0) + 1;
    await recordPlayerWin(pubClient, solo);
  }
  state.winner = {
    name: solo ? solo.name : 'Solo Player',
    chainLength: state.chain.length,
    isSolo: true,
    score: state.chain.length
  };
  await redisUtils.saveLobby(pubClient, id, state);
  broadcastState(io, id, state);
  scheduleGameReset(io, pubClient, id);
}

async function checkClassicWin(io, pubClient, id, state) {
  const alivePlayers = state.players.filter(p => p.isAlive);

  if (alivePlayers.length === 1 && state.players.length > 1) {
    clearTurnTimeout(id);
    state.status = 'finished';
    state.turnExpiresAt = null;

    const winner = alivePlayers[0];
    winner.wins = (winner.wins || 0) + 1;
    await recordPlayerWin(pubClient, winner);
    state.winner = { name: winner.name, score: winner.score, id: winner.id };
    io.to(id).emit('notification', { msg: `${winner.name} wins!`, kind: 'win' });
    await redisUtils.saveLobby(pubClient, id, state);
    broadcastState(io, id, state);
    scheduleGameReset(io, pubClient, id);

  } else if (alivePlayers.length === 0) {
    // All players eliminated simultaneously (e.g. both disconnect at once).
    // No winner; game ends without awarding points.
    clearTurnTimeout(id);
    state.status = 'finished';
    state.turnExpiresAt = null;
    await redisUtils.saveLobby(pubClient, id, state);
    broadcastState(io, id, state);
    scheduleGameReset(io, pubClient, id);
  }
}

async function checkWinCondition(io, pubClient, id, state) {
  if (state.gameMode === 'team')    return checkTeamWin(io, pubClient, id, state);
  if (state.gameMode === 'solo')    return checkSoloWin(io, pubClient, id, state);
  /* classic / speed */             return checkClassicWin(io, pubClient, id, state);
}

// ---------------------------------------------------------------------------
// GAME START
// ---------------------------------------------------------------------------

async function startGame(io, pubClient, id, state) {
  const mode = state.gameMode || 'classic';

  if (mode === 'solo') {
    if (state.players.length < 1) {
      io.to(id).emit('error', 'Need at least 1 player!');
      return;
    }
  } else if (mode === 'team') {
    const team0 = state.players.filter(p => p.teamId === 0);
    const team1 = state.players.filter(p => p.teamId === 1);
    if (team0.length === 0 || team1.length === 0) {
      io.to(id).emit('error', 'Each team needs at least 1 player!');
      return;
    }
    // Sort so all team-0 players come first in the turn order
    state.players.sort((a, b) => (a.teamId ?? 0) - (b.teamId ?? 0));
  } else {
    if (state.players.length < 2) {
      io.to(id).emit('error', 'Need at least 2 players!');
      return;
    }
  }

  state.status = 'playing';
  state.chain = [];
  state.usedMovies = [];
  state.timerMultiplier = 0;
  state.previousSharedActors = [];
  state.players.forEach(p => { p.isAlive = true; p.score = 0; });

  // Classic and speed start at a random index; team and solo always start at 0
  state.currentTurnIndex = 0;
  if (mode === 'classic' || mode === 'speed') {
    state.currentTurnIndex = Math.floor(Math.random() * state.players.length);
  }
  state.isValidating = false;

  resetTimer(state);
  await redisUtils.saveLobby(pubClient, id, state);
  broadcastState(io, id, state);
}

// ---------------------------------------------------------------------------
// CHAIN VALIDATION (pure — no I/O, exported for testing)
// ---------------------------------------------------------------------------

function validateConnection(lastNodeCast, candidateCast, hardcoreMode, previousSharedActors) {
  const sharedActors = candidateCast.filter(actor =>
    lastNodeCast.some(lastActor => lastActor.toLowerCase() === actor.toLowerCase())
  );

  if (sharedActors.length === 0) {
    return { valid: false, reason: "Invalid movie connection." };
  }

  if (hardcoreMode && previousSharedActors.length > 0) {
    // Hardcore mode: the connecting actor must be different from last turn's connector
    const newSharedActors = sharedActors.filter(actor =>
      !previousSharedActors.some(pActor => pActor.toLowerCase() === actor.toLowerCase())
    );
    if (newSharedActors.length === 0) {
      return { valid: false, reason: "Hardcore Mode: You cannot reuse the exact same connecting actor from the previous turn!" };
    }
    return { valid: true, matchedActors: newSharedActors };
  }

  return { valid: true, matchedActors: sharedActors };
}

module.exports = {
  broadcastState,
  eliminateTeam,
  eliminateCurrentPlayer,
  nextTurn,
  resetTimer,
  checkWinCondition,
  startGame,
  validateConnection,
  clearTurnTimeout,
  promoteSpectators,
};
