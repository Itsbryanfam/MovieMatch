// ui/ui-render.js — lobby, game, chain, and turn-control rendering functions.
// WHY: extracted from ui.js so all screen-render logic lives in one focused
// module, making it easier to audit rendering behaviour independently of
// notifications, autocomplete, and share-card concerns.

// Import audio helpers — renderChainItems plays success audio on new entries.
import { playSuccess } from '../utils.js';
// Import socket helpers — renderLobby emits kickPlayer via the live socket.
import { getSocket, getCurrentLobbyId } from '../state.js';
// Import DOM refs and shared helpers — live bindings assigned by
// initUIElements() in ui-dom.js; attachPosterFallback lives in ui-dom
// (leaf module) so both render and autocomplete can import it without
// creating a sideways ui-autocomplete → ui-render coupling.
import {
  modeChips, modeDescription, waitingRoom, teamScreen,
  lobbyCodeDisplay, lobbyPlayersList, lobbySettings,
  hardcoreToggle, tvShowsToggle, publicRoomToggle, startBtn,
  teamLobbyCode, teamRedList, teamBlueList, joinRedBtn, joinBlueBtn,
  teamHint, teamStartBtn,
  gameScreen, gamePlayersList, chainDisplay,
  movieInput, submitBtn, inputArea, turnIndicator, hintText,
  MODE_DESCRIPTIONS,
  attachPosterFallback,
  showScreen, // WHY: Phase 3 Task D — use canonical group-normaliser for waiting/team pair
} from './ui-dom.js';
// Import clearGhostAttempt — renderChainItems removes the ghost card when a
// new chain entry arrives, which lives in the notifications module.
import { clearGhostAttempt } from './ui-notifications.js';

export function renderLobby(gameState, myPlayerId) {
  const amIHost = !!gameState.players.find(p => p.id === myPlayerId && p.isHost);
  const mode = gameState.gameMode || 'classic';

  modeChips.forEach(chip => {
    chip.classList.toggle('active', chip.dataset.mode === mode);
    chip.disabled = !amIHost;
  });
  if (modeDescription) modeDescription.innerText = MODE_DESCRIPTIONS[mode] || '';

  if (mode === 'team') {
    showScreen('team');                           // normalise waiting/team pair: show team
    renderTeamScreen(gameState, myPlayerId, amIHost);
    return;
  } else {
    showScreen('waiting');                        // normalise waiting/team pair: show waiting
  }

  lobbyCodeDisplay.innerText = gameState.id || '';
  lobbyPlayersList.innerHTML = '';
  gameState.players.forEach(p => {
    const li = document.createElement('li');
    li.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

    const nameSpan = document.createElement('span');
    let label = p.name;
    if (p.id === myPlayerId) label += ' (You)';
    if (p.isHost) label += ' 👑';
    if (p.wins > 0) label += ` • ${p.wins} 🏆`;
    nameSpan.textContent = label;
    li.appendChild(nameSpan);

    if (amIHost && p.id !== myPlayerId) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'btn-kick';
      kickBtn.title = 'Remove from lobby';
      kickBtn.textContent = '✕';
      kickBtn.addEventListener('click', () => {
        getSocket().emit('kickPlayer', { lobbyId: gameState.id, targetId: p.id });
      });
      li.appendChild(kickBtn);
    }

    lobbyPlayersList.appendChild(li);
  });

  lobbySettings.style.display = 'flex';

  // L1: Theme picker. Populated from the server-supplied themes list
  // (cached on window.__mmThemes by socketClient on connect). Disabled
  // for non-hosts so guests can see what theme is active but can't
  // change it. Only rebuilt if the option set differs (re-rendering
  // every state update would steal the user's mid-selection focus).
  const themeSel = document.getElementById('theme-select');
  if (themeSel) {
    const themes = Array.isArray(window.__mmThemes) ? window.__mmThemes : [{ id: 'any', label: '🎬 Any (no theme)' }];
    const expectedIds = themes.map(t => t.id).join('|');
    if (themeSel.dataset.themeIds !== expectedIds) {
      themeSel.textContent = '';
      themes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.label;
        if (t.description) opt.title = t.description;
        themeSel.appendChild(opt);
      });
      themeSel.dataset.themeIds = expectedIds;
    }
    themeSel.value = gameState.theme || 'any';
    themeSel.disabled = !amIHost;
  }

  hardcoreToggle.checked = gameState.hardcoreMode || false;
  hardcoreToggle.disabled = !amIHost;
  tvShowsToggle.checked = gameState.allowTvShows || false;
  tvShowsToggle.disabled = !amIHost;
  if (publicRoomToggle) {
    publicRoomToggle.checked = gameState.isPublic || false;
    publicRoomToggle.disabled = !amIHost || mode === 'solo';
  }

  const canStart = mode === 'solo' ? gameState.players.length >= 1 : gameState.players.length >= 2;
  startBtn.style.display = 'block'; // Always keep the button in the layout

  if (canStart) {
    if (amIHost) {
      startBtn.innerText = 'Start Match';
      startBtn.disabled = false;
    } else {
      startBtn.innerText = 'Waiting for host...';
      startBtn.disabled = true;
    }
  } else {
    startBtn.innerText = 'Waiting for players...';
    startBtn.disabled = true;
  }
}

export function renderTeamScreen(gameState, myPlayerId, amIHost) {
  if (!teamLobbyCode || !teamRedList || !teamBlueList) return;
  teamLobbyCode.innerText = gameState.id || '';
  const myTeamId = gameState.players.find(p => p.id === myPlayerId)?.teamId;

  [teamRedList, teamBlueList].forEach((list, teamId) => {
    list.innerHTML = '';
    gameState.players.filter(p => p.teamId === teamId).forEach(p => {
      const li = document.createElement('li');
      li.className = 'team-player-chip' + (p.id === myPlayerId ? ' is-me' : '');
      li.textContent = p.name + (p.id === myPlayerId ? ' (You)' : '');
      if (p.isHost) {
        const crown = document.createElement('span');
        crown.className = 'chip-host';
        crown.textContent = ' 👑';
        li.appendChild(crown);
      }
      list.appendChild(li);
    });
  });

  if (joinRedBtn) joinRedBtn.disabled = myTeamId === 0;
  if (joinBlueBtn) joinBlueBtn.disabled = myTeamId === 1;

  const team0 = gameState.players.filter(p => p.teamId === 0);
  const team1 = gameState.players.filter(p => p.teamId === 1);
  const teamsReady = team0.length >= 1 && team1.length >= 1;
  if (teamHint) {
    teamHint.innerText = teamsReady
      ? `${team0.length} vs ${team1.length} — Ready to start!`
      : 'Teams need at least 1 player each.';
  }
  if (teamStartBtn) {
    if (amIHost) {
      teamStartBtn.style.display = teamsReady ? 'block' : 'none';
    } else {
      teamStartBtn.style.display = 'none';
    }
  }
}

export function renderGame(gameState, myPlayerId, isSpectator = false) {
  const mode = gameState.gameMode || 'classic';
  gameScreen.classList.toggle('solo-mode-ui', mode === 'solo');
  gameScreen.classList.toggle('speed-mode', mode === 'speed');

  renderPlayerSidebar(gameState, mode);
  renderChainItems(gameState, myPlayerId);
  renderTurnControls(gameState, myPlayerId, isSpectator, mode);
}

// Renders the player list in the game sidebar (scores, active turn, eliminated state).
function renderPlayerSidebar(gameState, mode) {
  gamePlayersList.innerHTML = '';

  if (mode === 'team') {
    [0, 1].forEach(teamId => {
      const teamLabel = teamId === 0 ? '🔴 Red' : '🔵 Blue';
      const header = document.createElement('li');
      header.className = 'game-team-header';
      if (teamId === 0) header.classList.add('team-red-text', 'first-team');
      if (teamId === 1) header.classList.add('team-blue-text');
      header.innerText = teamLabel;
      gamePlayersList.appendChild(header);
      gameState.players.filter(p => p.teamId === teamId).forEach((p) => {
        const li = document.createElement('li');
        // Audit finding #9: build the row with createElement + textContent
        // instead of innerHTML interpolation. The value was already
        // escaped, so this isn't a vuln fix — it removes the reliance on
        // manual escapeHtml discipline and makes the row structurally
        // XSS-safe, matching the project's stated no-innerHTML-for-user-
        // content posture (the README claim is corrected to match).
        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;
        const scoreSpan = document.createElement('span');
        scoreSpan.textContent = p.score;
        li.append(nameSpan, document.createTextNode(' '), scoreSpan);
        if (!p.isAlive) li.classList.add('eliminated');
        if (gameState.players.indexOf(p) === gameState.currentTurnIndex && p.isAlive) li.classList.add('active-turn');
        gamePlayersList.appendChild(li);
      });
    });
  } else if (mode === 'solo') {
    gamePlayersList.innerHTML = '<li class="solo-run-label">Solo Run</li>';
  } else {
    gameState.players.forEach((p, index) => {
      const li = document.createElement('li');
      // Audit finding #9: structural DOM (createElement + textContent),
      // see the team-mode branch above for rationale.
      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name;
      const scoreSpan = document.createElement('span');
      scoreSpan.textContent = p.score;
      li.append(nameSpan, document.createTextNode(' '), scoreSpan);
      if (!p.isAlive) li.classList.add('eliminated');
      if (index === gameState.currentTurnIndex && p.isAlive) li.classList.add('active-turn');
      gamePlayersList.appendChild(li);
    });
  }

  if (gameState.spectatorCount > 0) {
    const specLi = document.createElement('li');
    specLi.className = 'spectator-count';
    specLi.textContent = '👁 ' + gameState.spectatorCount + ' watching';
    gamePlayersList.appendChild(specLi);
  }

  // Scroll active player into view after the DOM settles
  setTimeout(() => {
    const activeLi = gamePlayersList.querySelector('.active-turn');
    if (activeLi) activeLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 50);
}

// Appends only NEW chain items to the board (incremental — does not re-render existing ones).
function renderChainItems(gameState, myPlayerId) {
  const currentDisplayedCount = chainDisplay.querySelectorAll('.chain-item').length;

  if (gameState.chain.length === 0 && gameState.status === 'playing') {
    chainDisplay.innerHTML = '<div class="empty-board-hint"><span class="empty-board-icon">🎬</span><span class="empty-board-title">The board is empty</span><span class="empty-board-sub">Waiting for the first move...</span></div>';
    return;
  }

  if (gameState.chain.length === 0 || gameState.chain.length < currentDisplayedCount) {
    // Chain was reset (new game) — clear everything
    chainDisplay.innerHTML = '';
    return;
  }

  if (gameState.status === 'playing') {
    // Remove stale game-over banner or empty hint if the game just (re-)started
    chainDisplay.querySelector('.game-over-banner')?.remove();
    chainDisplay.querySelector('.empty-hint')?.remove();
    chainDisplay.querySelector('.empty-board-hint')?.remove();
  }

  // Track which actors were in the previous node so we can bold shared ones
  let previousActors = [];
  if (currentDisplayedCount > 0 && gameState.chain[currentDisplayedCount - 1]) {
    previousActors = gameState.chain[currentDisplayedCount - 1].movie.cast || [];
  }

  // A new chain item is about to be appended → previous attempts are stale
  if (gameState.chain.length > currentDisplayedCount) {
    clearGhostAttempt();
  }

  for (let index = currentDisplayedCount; index < gameState.chain.length; index++) {
    const item = gameState.chain[index];
    const div = document.createElement('div');
    div.className = 'chain-item';
    if (index > 0) div.classList.add('shared-highlight');

    if (item.movie.poster && item.movie.poster.startsWith('https://image.tmdb.org/')) {
      const img = document.createElement('img');
      img.src = item.movie.poster;
      img.alt = 'Poster';
      img.className = 'chain-poster';
      // Swap to the designed placeholder if the poster fails to load.
      attachPosterFallback(img, 'chain-poster');
      div.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'chain-poster placeholder';
      div.appendChild(placeholder);
    }

    const content = document.createElement('div');
    content.className = 'chain-content';

    const playerNameDiv = document.createElement('div');
    playerNameDiv.className = 'player-name';
    playerNameDiv.textContent = item.playerName;
    content.appendChild(playerNameDiv);

    const titleDiv = document.createElement('div');
    titleDiv.className = 'movie-title';
    titleDiv.appendChild(document.createTextNode(item.movie.title + ' '));
    const yearSpan = document.createElement('span');
    yearSpan.className = 'year';
    yearSpan.textContent = '(' + item.movie.year + ')';
    titleDiv.appendChild(yearSpan);
    content.appendChild(titleDiv);

    const castDiv = document.createElement('div');
    castDiv.className = 'movie-cast';
    castDiv.appendChild(document.createTextNode('Cast: '));
    const castList = item.movie.cast || [];
    castList.forEach((actor, ci) => {
      // H4: cast entries are now {id, name} objects. Tolerate the legacy
      // string shape for in-flight rooms whose state was serialized before
      // the deploy that introduced ids.
      const actorName = typeof actor === 'string' ? actor : (actor && actor.name) || '';
      const actorId = typeof actor === 'object' ? actor && actor.id : null;
      if (!actorName) return;
      if (ci > 0) castDiv.appendChild(document.createTextNode(', '));
      // Highlighted iff this actor appears in the previous node's cast.
      // Compare by id when both sides have one (id-precise across name
      // collisions), otherwise fall back to case-insensitive name compare.
      const isMatched = index > 0 && previousActors.some(pa => {
        const paName = typeof pa === 'string' ? pa : (pa && pa.name) || '';
        const paId = typeof pa === 'object' ? pa && pa.id : null;
        if (actorId != null && paId != null) return actorId === paId;
        return paName.toLowerCase() === actorName.toLowerCase();
      });
      if (isMatched) {
        const strong = document.createElement('strong');
        strong.textContent = actorName;
        castDiv.appendChild(strong);
      } else {
        castDiv.appendChild(document.createTextNode(actorName));
      }
    });
    content.appendChild(castDiv);

    div.appendChild(content);
    chainDisplay.appendChild(div);
    previousActors = castList;

    if (index === gameState.chain.length - 1 && item.playerId !== myPlayerId) {
      playSuccess();
    }
  }
  chainDisplay.scrollTop = chainDisplay.scrollHeight;
}

// L3: Show + populate the spectator prediction bar. Tracks the active
// turn index on the bar element so we can re-enable the vote buttons
// when the turn changes (a fresh turn = fresh vote opportunity).
function _renderSpectatorPredictionBar(gameState) {
  const bar = document.getElementById('spectator-prediction-bar');
  if (!bar) return;
  bar.classList.add('visible');
  const tallyEl = document.getElementById('spec-pred-tally');
  const yesBtn = document.getElementById('spec-pred-yes');
  const noBtn = document.getElementById('spec-pred-no');
  const tally = gameState.predictionTally || { yes: 0, no: 0 };
  if (tallyEl) tallyEl.textContent = `${tally.yes} 👍 • ${tally.no} 👎`;
  // Re-enable the buttons on a turn change. We stamp the current turn
  // index on the bar so a stateUpdate within the same turn (chat,
  // typing, etc.) doesn't accidentally re-enable a vote that's already
  // been cast.
  const turnKey = String(gameState.currentTurnIndex) + '|' + (gameState.chain || []).length;
  if (bar.dataset.turnKey !== turnKey) {
    bar.dataset.turnKey = turnKey;
    if (yesBtn) yesBtn.disabled = false;
    if (noBtn) noBtn.disabled = false;
    bar.classList.remove('voted-yes', 'voted-no');
  }
}

function _hideSpectatorPredictionBar() {
  const bar = document.getElementById('spectator-prediction-bar');
  if (bar) bar.classList.remove('visible');
}

// L1: Render or hide the active-theme badge in the input header. Pulls
// the theme label from window.__mmThemes (cached at socket connect) so
// it shows the same friendly label as the lobby picker. Falls back to
// the raw theme id if the cache is missing — degrades to "still
// readable" rather than a broken-looking blank pill.
function _renderActiveThemeBadge(themeId) {
  const slot = document.getElementById('active-theme-badge');
  if (!slot) return;
  if (!themeId || themeId === 'any') {
    slot.classList.remove('visible');
    slot.textContent = '';
    return;
  }
  const themes = Array.isArray(window.__mmThemes) ? window.__mmThemes : [];
  const found = themes.find(t => t.id === themeId);
  slot.textContent = found ? found.label : themeId;
  if (found && found.description) slot.title = found.description;
  slot.classList.add('visible');
}

// Updates the input area, turn indicator, and hint text based on whose turn it is.
function renderTurnControls(gameState, myPlayerId, isSpectator, mode) {
  const activePlayer = gameState.players[gameState.currentTurnIndex];

  // M7: Show the quit button only when the local player can meaningfully
  // quit — alive, in a playing game, not a spectator (spectators have no
  // run to end). Toggling .hidden every render keeps the visibility state
  // in sync with eliminations, win conditions, and game restarts without
  // additional event wiring.
  const quitBtnEl = document.getElementById('quit-game-btn');
  if (quitBtnEl) {
    const me = gameState.players.find(p => p.id === myPlayerId);
    const canQuit = !isSpectator && gameState.status === 'playing' && me && me.isAlive;
    quitBtnEl.classList.toggle('hidden', !canQuit);
  }

  if (mode === 'solo') {
    // M5: Solo HUD now shows three things: chain length, current streak,
    // and bonus points. Streak only renders when ≥2 (no need to show "1
    // in a row"); bonus only renders when nonzero. Built via DOM APIs
    // because turnIndicator can carry user-controlled-ish text in other
    // modes — keep it consistent.
    const chainLen = gameState.chain.length;
    const streak = gameState.currentStreak | 0;
    const bonus = gameState.bonusPoints | 0;
    turnIndicator.textContent = '';
    const link = document.createElement('span');
    link.innerHTML = `🔗 Chain: <span class="chain-badge">${chainLen}</span>`;
    turnIndicator.appendChild(link);
    if (streak >= 2) {
      const streakSpan = document.createElement('span');
      streakSpan.className = 'solo-hud-streak';
      streakSpan.textContent = `🔥 ${streak} in a row`;
      turnIndicator.appendChild(streakSpan);
    }
    if (bonus > 0) {
      const bonusSpan = document.createElement('span');
      bonusSpan.className = 'solo-hud-bonus';
      bonusSpan.textContent = `⭐ +${bonus} bonus`;
      turnIndicator.appendChild(bonusSpan);
    }

    // L1: In-game theme reminder. Render BEFORE the solo bar so it's the
    // first thing the player reads after the timer. Hidden when the
    // theme is 'any' or unset. The server drops off-theme submissions,
    // so making the constraint visible avoids "why was this rejected?"
    // confusion mid-chain.
    _renderActiveThemeBadge(gameState.theme);

    // M5: Objective + personal-best bar. Visible only in solo mode and
    // only when there's something to show (objective + or PB > 0). The
    // .objective-hit class flips to a "complete" green look once the
    // server marks objectiveHit true.
    const bar = document.getElementById('solo-objective-bar');
    const objTxt = document.getElementById('solo-objective-text');
    const pbTxt = document.getElementById('solo-pb-text');
    if (bar && objTxt && pbTxt) {
      const obj = gameState.objective;
      const hit = !!gameState.objectiveHit;
      const pb = gameState.personalBestChain | 0;
      if (obj && obj.description) {
        objTxt.textContent = (hit ? '✅ ' : '🎯 ') + obj.description;
        bar.classList.toggle('objective-hit', hit);
      } else {
        objTxt.textContent = '';
      }
      pbTxt.textContent = pb > 0 ? `Best: ${pb}` : '';
      // Show the bar if there's anything in either slot.
      const hasContent = !!(obj && obj.description) || pb > 0;
      bar.classList.toggle('visible', hasContent);
    }
  } else {
    // Hide the solo bar in all other modes so a player who plays Classic
    // after Solo doesn't see stale objective text.
    const bar = document.getElementById('solo-objective-bar');
    if (bar) bar.classList.remove('visible');
    // L1: still surface the theme reminder in non-solo modes — themes
    // apply to all modes (classic, team, speed, daily) too.
    _renderActiveThemeBadge(gameState.theme);
  }

  if (isSpectator && gameState.status !== 'finished') {
    inputArea.classList.add('disabled-area');
    if (movieInput) movieInput.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    turnIndicator.textContent = '👁 Spectating';
    hintText.textContent = "You'll join when this game ends.";
    // L3: Show the prediction bar for spectators while the game is live.
    // The vote-button click handler in app.js emits spectatorPredict; the
    // tally below comes from each stateUpdate's predictionTally. Buttons
    // re-enable each turn (the server clears predictions on resolution).
    _renderSpectatorPredictionBar(gameState);
    return;
  }
  // Non-spectator path — make sure the bar is hidden so a player who was
  // promoted from spectator doesn't see a stale vote bar after their
  // promotion.
  _hideSpectatorPredictionBar();

  if (gameState.status === 'playing') {
    const isMyTurn = activePlayer && activePlayer.id === myPlayerId;

    if (isMyTurn) {
      inputArea.classList.remove('disabled-area');
      movieInput.disabled = false;
      submitBtn.disabled = false;
      // Skip auto-focus on mobile to avoid the keyboard jumping up unexpectedly
      if (window.innerWidth > 767) movieInput.focus();

      if (mode === 'team') {
        const teamLabel = activePlayer.teamId === 0 ? '🔴 Red' : '🔵 Blue';
        turnIndicator.innerText = `${teamLabel} — It's your turn!`;
      } else if (mode !== 'solo') {
        turnIndicator.innerText = "It's your turn!";
      }
      hintText.innerText = gameState.chain.length > 0
        ? "Name a movie sharing an actor with the previous one!"
        : "Start the chain! Name ANY valid movie.";
    } else {
      inputArea.classList.add('disabled-area');
      movieInput.disabled = true;
      submitBtn.disabled = true;
      if (mode === 'team') {
        const teamLabel = activePlayer?.teamId === 0 ? '🔴 Red' : '🔵 Blue';
        turnIndicator.innerText = `${teamLabel} — Waiting for ${activePlayer?.name}...`;
      } else {
        turnIndicator.innerText = `Waiting for ${activePlayer?.name}...`;
      }
      hintText.innerText = "Their time is ticking...";
    }
  } else {
    inputArea.classList.add('disabled-area');
    turnIndicator.innerText = 'Game Over';
    if (!chainDisplay.querySelector('.game-over-banner')) {
      showGameOverBanner(gameState, myPlayerId);
    }
  }
}

export function resetMobileTab() {
    const mobileTabs = document.getElementById('mobile-tabs');
    const gameBoardEl = document.querySelector('.game-board');
    const playersPanel = document.querySelector('[data-panel="players"]');
    const chatPanel = document.querySelector('[data-panel="chat"]');
    if (!mobileTabs) return;
    document.querySelectorAll('.mobile-tab').forEach(b => b.classList.remove('active'));
    const boardTab = mobileTabs.querySelector('[data-tab="board"]');
    if (boardTab) boardTab.classList.add('active');
    if (gameBoardEl) gameBoardEl.classList.remove('mobile-hidden');
    if (playersPanel) playersPanel.classList.remove('mobile-visible');
    if (chatPanel) chatPanel.classList.remove('mobile-visible');
}

export function showGameOverBanner(state, myPlayerId) {
  const banner = document.createElement('div');
  banner.className = 'game-over-banner';

  const isSolo = state.gameMode === 'solo';
  const winner = state.winner;

  let winnerLine, subLine;

  if (isSolo) {
    if (winner && winner.isSolo) {
      winnerLine = `🎬 Solo Complete!`;
      subLine = `🔗 Chain Length: ${winner.chainLength} link${winner.chainLength !== 1 ? 's' : ''}`;
    } else {
      // Solo loss case
      winnerLine = `🎬 Solo Over`;
      subLine = `🔗 Final Chain: ${state.chain.length} connection${state.chain.length !== 1 ? 's' : ''}`;
    }
  } else if (winner?.isTeamWin) {
    winnerLine = `🏆 ${winner.name} wins!`;
    const memberNames = (winner.players || []).join(' & ');
    subLine = `${memberNames} • ${winner.score} pts`;
  } else if (winner) {
    winnerLine = `🏆 ${winner.name} wins!`;
    subLine = `${winner.score} pts • ${state.chain.length} connections`;
  } else {
    winnerLine = '🎬 Game Over!';
    subLine = `${state.chain.length} connections total`;
  }

  const isHost = state.players?.some(p => p.id === myPlayerId && p.isHost);

  const titleDiv = document.createElement('div');
  titleDiv.className = 'game-over-title';
  titleDiv.textContent = winnerLine;

  const subtitleDiv = document.createElement('div');
  subtitleDiv.className = 'game-over-subtitle';
  subtitleDiv.textContent = subLine;

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'game-over-actions';

  const shareBtn = document.createElement('button');
  shareBtn.id = 'share-results-btn';
  // Phase 4: .btn additive base (cursor:pointer already on btn-primary); zero visual change.
  shareBtn.className = 'btn btn-primary';
  shareBtn.textContent = '🎬 Share Results';
  actionsDiv.appendChild(shareBtn);

  if (isHost) {
    const playAgainBtn = document.createElement('button');
    playAgainBtn.id = 'play-again-btn';
    // Phase 4: .btn additive base (cursor:pointer already on btn-secondary); zero visual change.
    playAgainBtn.className = 'btn btn-secondary';
    playAgainBtn.textContent = '↩ Play Again';
    actionsDiv.appendChild(playAgainBtn);
  }

  banner.appendChild(titleDiv);
  banner.appendChild(subtitleDiv);
  banner.appendChild(actionsDiv);

  chainDisplay.appendChild(banner);
  chainDisplay.scrollTop = chainDisplay.scrollHeight;
}
