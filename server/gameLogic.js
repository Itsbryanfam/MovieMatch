const redisUtils = require('./redisUtils');

function broadcastState(io, id, state) {
  const clientState = {
    ...state,
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

  let iterations = 0;
  do {
    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.players.length;
    iterations++;
  } while (!state.players[state.currentTurnIndex].isAlive && iterations < state.players.length);

  resetTimer(state);
  await redisUtils.saveLobby(pubClient, id, state);
  broadcastState(io, id, state);
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
      state.status = 'finished';
      state.turnExpiresAt = null;
      const winningTeamId = teamAlive[0] ? 0 : 1;
      const winningPlayers = state.players.filter(p => p.teamId === winningTeamId);
      winningPlayers.forEach(p => { p.wins = (p.wins || 0) + 1; });
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
      setTimeout(async () => {
        const liveState = await redisUtils.getLobby(pubClient, id);
        if (liveState && liveState.status === 'finished') {
          liveState.status = 'waiting';
          liveState.players = liveState.players.filter(p => p.connected);
          if (liveState.players.length > 0 && !liveState.players.some(p => p.isHost)) liveState.players[0].isHost = true;
          await redisUtils.saveLobby(pubClient, id, liveState);
          broadcastState(io, id, liveState);
        }
      }, 7000);
    }
    return;
  }

  // --- SOLO MODE ---
  if (state.gameMode === 'solo') {
    const alive = state.players.filter(p => p.isAlive);
    if (alive.length === 0) {
      state.status = 'finished';
      state.turnExpiresAt = null;
      const solo = state.players[0];
      state.winner = {
        name: solo ? solo.name : 'Solo Player',
        chainLength: state.chain.length,
        isSolo: true,
        score: state.chain.length
      };
      await redisUtils.saveLobby(pubClient, id, state);
      broadcastState(io, id, state);
      setTimeout(async () => {
        const liveState = await redisUtils.getLobby(pubClient, id);
        if (liveState && liveState.status === 'finished') {
          liveState.status = 'waiting';
          liveState.players = liveState.players.filter(p => p.connected);
          await redisUtils.saveLobby(pubClient, id, liveState);
          broadcastState(io, id, liveState);
        }
      }, 7000);
    }
    return;
  }

  // --- CLASSIC / SPEED ---
  const alivePlayers = state.players.filter(p => p.isAlive);
  if (alivePlayers.length === 1 && state.players.length > 1) {
    state.status = 'finished';
    state.turnExpiresAt = null;
    const winner = alivePlayers[0];
    winner.wins += 1;
    state.winner = { name: winner.name, score: winner.score, id: winner.id };
    io.to(id).emit('notification', `${winner.name} wins!`);
    await redisUtils.saveLobby(pubClient, id, state);
    broadcastState(io, id, state);
    setTimeout(async () => {
      const liveState = await redisUtils.getLobby(pubClient, id);
      if (liveState && liveState.status === 'finished') {
        liveState.status = 'waiting';
        liveState.players = liveState.players.filter(p => p.connected);
        if (liveState.players.length > 0 && !liveState.players.some(p => p.isHost)) liveState.players[0].isHost = true;
        await redisUtils.saveLobby(pubClient, id, liveState);
        broadcastState(io, id, liveState);
      }
    }, 7000);
  } else if (alivePlayers.length === 0) {
    state.status = 'finished';
    state.turnExpiresAt = null;
    await redisUtils.saveLobby(pubClient, id, state);
    broadcastState(io, id, state);
    setTimeout(async () => {
      const liveState = await redisUtils.getLobby(pubClient, id);
      if (liveState && liveState.status === 'finished') {
        liveState.status = 'waiting';
        liveState.players = liveState.players.filter(p => p.connected);
        if (liveState.players.length > 0 && !liveState.players.some(p => p.isHost)) liveState.players[0].isHost = true;
        await redisUtils.saveLobby(pubClient, id, liveState);
        broadcastState(io, id, liveState);
      }
    }, 7000);
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

module.exports = {
  broadcastState,
  eliminateTeam,
  eliminateCurrentPlayer,
  nextTurn,
  resetTimer,
  checkWinCondition,
  startGame
};
