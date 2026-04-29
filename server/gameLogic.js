const redisUtils = require('./redisUtils');
const logger = require('pino')();

// In-memory map for active turn timeouts (never stored in Redis)
const activeTurnTimeouts = new Map();

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

async function eliminateTeam(io, pubClient, id, state, teamId, reason) {
  const teamLabel = teamId === 0 ? '🔴 Red' : '🔵 Blue';
  io.to(id).emit('notification', `Team ${teamLabel} eliminated: ${reason}`);
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
    io.to(id).emit('notification', `${player.name} eliminated: ${reason}`);
  }
  await checkWinCondition(io, pubClient, id, state);
  if (state.status === 'playing') {
    await nextTurn(io, pubClient, id, state);
  }
}

async function nextTurn(io, pubClient, id, state) {
  await checkWinCondition(io, pubClient, id, state);
  if (state.status !== 'playing') return;

  // Clear any existing timeout
  if (activeTurnTimeouts.has(id)) {
    clearTimeout(activeTurnTimeouts.get(id));
    activeTurnTimeouts.delete(id);
  }

  let iterations = 0;
  do {
    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.players.length;
    iterations++;
  } while (!state.players[state.currentTurnIndex].isAlive && iterations < state.players.length);

  resetTimer(state);

  // === SERVER-SIDE HARD TIMEOUT ===
  const turnTimeMs = state.turnTime || 45000;
  const timeoutId = setTimeout(async () => {
    try {
      const liveRoom = await redisUtils.getLobby(pubClient, id);
      if (liveRoom && liveRoom.status === 'playing' &&
          liveRoom.turnExpiresAt && Date.now() > liveRoom.turnExpiresAt) {
        await eliminateCurrentPlayer(io, pubClient, id, liveRoom, "Turn timed out");
      }
    } catch (err) {
      logger.error(err, 'Timeout handler error');
    } finally {
      activeTurnTimeouts.delete(id); // cleanup even on error
    }
  }, turnTimeMs + 4000);

  activeTurnTimeouts.set(id, timeoutId);

  await redisUtils.saveLobby(pubClient, id, state);
  broadcastState(io, id, state);
}

function promoteSpectators(state) {
  if (!state.spectators || state.spectators.length === 0) return;
  const connected = state.spectators.filter(s => s.connected);
  const slotsAvailable = 8 - state.players.length;
  const promoted = connected.slice(0, slotsAvailable);
  promoted.forEach(s => {
    state.players.push({
      id: s.id, name: s.name, isHost: false, isAlive: true,
      connected: true, score: 0, wins: s.wins || 0,
      teamId: state.players.length % 2, stableId: s.stableId
    });
  });
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
    state.turnExpiresAt = Date.now() + 15000;
    return;
  }
  const reduction = Math.floor(state.timerMultiplier / 2) * 5;
  const timeRemaining = Math.max(10, 60 - reduction);
  state.turnExpiresAt = Date.now() + (timeRemaining * 1000);
}

async function checkWinCondition(io, pubClient, id, state) {
  // --- TEAM MODE ---
  if (state.gameMode === 'team') {
    const teamAlive = [false, false];
    state.players.forEach(p => {
      if (p.isAlive && p.teamId !== undefined) teamAlive[p.teamId] = true;
    });
    const aliveTeams = teamAlive.filter(Boolean).length;
    if (aliveTeams <= 1) {
      if (activeTurnTimeouts.has(id)) {
        clearTimeout(activeTurnTimeouts.get(id));
        activeTurnTimeouts.delete(id);
      }
      state.status = 'finished';
      state.turnExpiresAt = null;
      if (pubClient && typeof pubClient.sRem === 'function') {
        await pubClient.sRem('activeLobbies', id); // Fixed typo
        await pubClient.del(`lobby:${id}`);
      }
      const winningTeamId = teamAlive[0] ? 0 : 1;
      const winningPlayers = state.players.filter(p => p.teamId === winningTeamId);
      winningPlayers.forEach(p => { 
        p.wins = (p.wins || 0) + 1; 
        redisUtils.incrementPlayerWins(pubClient, p.stableId || p.id).catch(e => logger.error(e, 'Failed to increment team player wins'));
        redisUtils.recordWin(pubClient, p.stableId || p.id, p.name).catch(e => logger.error(e, 'Failed to record team win'));
      });
      const teamLabel = winningTeamId === 0 ? '🔴 Red' : '🔵 Blue';
      state.winner = {
        name: `Team ${teamLabel}`,
        teamId: winningTeamId,
        players: winningPlayers.map(p => p.name),
        score: winningPlayers.reduce((sum, p) => sum + p.score, 0),
        isTeamWin: true
      };
      io.to(id).emit('notification', `Team ${teamLabel} wins!`);
      await redisUtils.saveLobby(pubClient, id, state);
      broadcastState(io, id, state);
      scheduleGameReset(io, pubClient, id);
    }
    return;
  }

  // --- SOLO MODE ---
  if (state.gameMode === 'solo') {
    const alive = state.players.filter(p => p.isAlive);
    if (alive.length === 0) {
      if (activeTurnTimeouts.has(id)) {
        clearTimeout(activeTurnTimeouts.get(id));
        activeTurnTimeouts.delete(id);
      }
      state.status = 'finished';
      state.turnExpiresAt = null;
      if (pubClient && typeof pubClient.sRem === 'function') {
        await pubClient.sRem('activeLobbies', id); // Fixed typo
        await pubClient.del(`lobby:${id}`);
      }
      const solo = state.players[0];
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
    return;
  }

  // --- CLASSIC / SPEED ---
  const alivePlayers = state.players.filter(p => p.isAlive);
  if (alivePlayers.length === 1 && state.players.length > 1) {
    if (activeTurnTimeouts.has(id)) {
      clearTimeout(activeTurnTimeouts.get(id));
      activeTurnTimeouts.delete(id);
    }
    state.status = 'finished';
    state.turnExpiresAt = null;
    if (pubClient && typeof pubClient.sRem === 'function') {
      await pubClient.sRem('activeLobbies', id); // Fixed typo
      await pubClient.del(`lobby:${id}`);
    }
    const winner = alivePlayers[0];
    winner.wins = (winner.wins || 0) + 1;
    await redisUtils.incrementPlayerWins(pubClient, winner.stableId || winner.id);
    await redisUtils.recordWin(pubClient, winner.stableId || winner.id, winner.name);
    state.winner = { name: winner.name, score: winner.score, id: winner.id };
    io.to(id).emit('notification', `${winner.name} wins!`);
    await redisUtils.saveLobby(pubClient, id, state);
    broadcastState(io, id, state);
    scheduleGameReset(io, pubClient, id);
  } else if (alivePlayers.length === 0) {
    if (activeTurnTimeouts.has(id)) {
      clearTimeout(activeTurnTimeouts.get(id));
      activeTurnTimeouts.delete(id);
    }
    state.status = 'finished';
    state.turnExpiresAt = null;
    if (pubClient && typeof pubClient.sRem === 'function') {
      await pubClient.sRem('activeLobbies', id); // Fixed typo
      await pubClient.del(`lobby:${id}`);
    }
    await redisUtils.saveLobby(pubClient, id, state);
    broadcastState(io, id, state);
    scheduleGameReset(io, pubClient, id);
  }



}

async function startGame(io, pubClient, id, state) {
  const mode = state.gameMode || 'classic';

  // Solo: allow 1 player
  if (mode === 'solo') {
    if (state.players.length < 1) {
      io.to(id).emit('error', 'Need at least 1 player!');
      return;
    }
  } else if (mode === 'team') {
    // Each team must have at least 1 player
    const team0 = state.players.filter(p => p.teamId === 0);
    const team1 = state.players.filter(p => p.teamId === 1);
    if (team0.length === 0 || team1.length === 0) {
      io.to(id).emit('error', 'Each team needs at least 1 player!');
      return;
    }
    // Sort players: all team 0 first, then team 1 (keeps back-to-back within team)
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
  state.currentTurnIndex = 0; // Always start at index 0
  if (mode === 'classic' || mode === 'speed') {
    state.currentTurnIndex = Math.floor(Math.random() * state.players.length);
  }
  state.isValidating = false;

  resetTimer(state);
  await redisUtils.saveLobby(pubClient, id, state);
  broadcastState(io, id, state);
}

// Pure validation function for testing
function validateConnection(lastNodeCast, candidateCast, hardcoreMode, previousSharedActors, usedMovies) {
  const sharedActors = candidateCast.filter(actor => 
    lastNodeCast.some(lastActor => lastActor.toLowerCase() === actor.toLowerCase())
  );

  if (sharedActors.length === 0) {
    return { valid: false, reason: "Invalid movie connection." };
  }

  if (hardcoreMode && previousSharedActors.length > 0) {
    const newSharedActors = sharedActors.filter(actor => 
      !previousSharedActors.some(pActor => pActor.toLowerCase() === actor.toLowerCase())
    );
    if (newSharedActors.length === 0) {
      return { valid: false, reason: "Hardcore Mode: You cannot reuse the exact same connecting actor!" };
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
  activeTurnTimeouts,
  promoteSpectators,
};
