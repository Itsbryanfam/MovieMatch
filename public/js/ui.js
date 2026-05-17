// ====================== UI.JS ======================
// Audit finding #9: escapeHtml import removed — all former call sites now
// build user-controlled content with createElement/textContent (structural
// DOM), so the manual-escaping helper is no longer needed in this module.
import { playSuccess, playFail, playTick, playSfx, prepareAudio } from './utils.js';
import { getSocket, getCurrentLobbyId } from './state.js';

export const MODE_DESCRIPTIONS = {
    classic: 'Last player standing wins. Timer shrinks each round.',
    team: 'Teams submit back-to-back. One failure eliminates the whole team.',
    solo: 'One player vs the chain. Survive as long as you can!',
    speed: '⚡ 15 seconds flat every turn. No exceptions. Chaos guaranteed.'
};

// DOM elements
export let lobbyScreen, heroScreen, gameScreen, waitingRoom, posterCarousel;
export let playerNameInput, lobbyIdInput, joinBtn, startBtn, lobbyPlayersList;
export let lobbyCodeDisplay, lobbySettings, hardcoreToggle, tvShowsToggle, publicRoomToggle;
export let joinPanel, privatePanel, publicPanel, showPublicBtn, showPrivateBtn;
export let backToJoinBtn, backToJoinBtn2, refreshLobbiesBtn, publicLobbiesList;
export let heroPlayBtn, heroCodeBtn, heroDailyBtn, howToPlayModal, creditsModal;
export let howToPlayBtn, creditsBtn, closeHowToPlay, closeCredits;
export let gamePlayersList, chainDisplay, movieInput, submitBtn, inputArea;
export let turnIndicator, hintText, autocompleteContainer, mobileAcDropdown;
export let chatMessages, chatInput, timerBar, timeText, notificationOverlay, notificationText;
export let logo, teamScreen, modeChips, modeDescription, teamLobbyCode;
export let teamRedList, teamBlueList, joinRedBtn, joinBlueBtn, teamBackBtn, teamStartBtn, teamHint;
export let shareModal, shareCanvas, closeShareModal, downloadCardBtn, copyCardBtn;
export let leaderboardBtn, leaderboardModal, closeLeaderboard, leaderboardList;

// Initialize DOM references
export function initUIElements() {
  lobbyScreen = document.getElementById('lobby-screen');
  heroScreen = document.getElementById('hero-screen');
  gameScreen = document.getElementById('game-screen');
  waitingRoom = document.getElementById('waiting-room');
  posterCarousel = document.getElementById('poster-carousel');
  playerNameInput = document.getElementById('player-name');
  lobbyIdInput = document.getElementById('lobby-id-input');
  joinBtn = document.getElementById('join-btn');
  startBtn = document.getElementById('start-btn');
  lobbyPlayersList = document.getElementById('lobby-players');
  lobbyCodeDisplay = document.getElementById('lobby-code-display');
  lobbySettings = document.getElementById('lobby-settings');
  hardcoreToggle = document.getElementById('hardcore-toggle');
  tvShowsToggle = document.getElementById('tv-shows-toggle');
  publicRoomToggle = document.getElementById('public-room-toggle');
  joinPanel = document.getElementById('join-panel');
  privatePanel = document.getElementById('private-panel');
  publicPanel = document.getElementById('public-panel');
  showPublicBtn = document.getElementById('show-public-btn');
  showPrivateBtn = document.getElementById('show-private-btn');
  backToJoinBtn = document.getElementById('back-to-join-btn');
  backToJoinBtn2 = document.getElementById('back-to-join-btn-2');
  refreshLobbiesBtn = document.getElementById('refresh-lobbies-btn');
  publicLobbiesList = document.getElementById('public-lobbies-list');
  heroPlayBtn = document.getElementById('hero-play-btn');
  heroCodeBtn = document.getElementById('hero-code-btn');
  heroDailyBtn = document.getElementById('hero-daily-btn');
  howToPlayModal = document.getElementById('how-to-play-modal');
  creditsModal = document.getElementById('credits-modal');
  howToPlayBtn = document.getElementById('how-to-play-btn');
  creditsBtn = document.getElementById('credits-btn');
  closeHowToPlay = document.getElementById('close-how-to-play');
  closeCredits = document.getElementById('close-credits');
  gamePlayersList = document.getElementById('game-players');
  chainDisplay = document.getElementById('chain-display');
  movieInput = document.getElementById('movie-input');
  submitBtn = document.getElementById('submit-btn');
  inputArea = document.getElementById('input-area');
  turnIndicator = document.getElementById('turn-indicator');
  hintText = document.getElementById('hint-text');
  autocompleteContainer = document.getElementById('autocomplete-container');
  mobileAcDropdown = document.getElementById('mobile-ac-dropdown');
  chatMessages = document.getElementById('chat-messages');
  chatInput = document.getElementById('chat-input');
  timerBar = document.getElementById('timer-bar');
  timeText = document.getElementById('time-text');
  notificationOverlay = document.getElementById('notification-overlay');
  notificationText = document.getElementById('notification-text');
  logo = document.querySelector('.logo');
  teamScreen = document.getElementById('team-screen');
  modeChips = document.querySelectorAll('.mode-chip');
  modeDescription = document.getElementById('mode-description');
  teamLobbyCode = document.getElementById('team-lobby-code');
  teamRedList = document.getElementById('team-red-list');
  teamBlueList = document.getElementById('team-blue-list');
  joinRedBtn = document.getElementById('join-red-btn');
  joinBlueBtn = document.getElementById('join-blue-btn');
  teamBackBtn = document.getElementById('team-back-btn');
  teamStartBtn = document.getElementById('team-start-btn');
  teamHint = document.getElementById('team-hint');
  shareModal = document.getElementById('share-modal');
  shareCanvas = document.getElementById('share-canvas');
  closeShareModal = document.getElementById('close-share-modal');
  downloadCardBtn = document.getElementById('download-card-btn');
  copyCardBtn = document.getElementById('copy-card-btn');

  leaderboardBtn = document.getElementById('leaderboard-btn');
  leaderboardModal = document.getElementById('leaderboard-modal');
  closeLeaderboard = document.getElementById('close-leaderboard');
  leaderboardList = document.getElementById('leaderboard-list');
}

export function renderLobby(gameState, myPlayerId) {
  const amIHost = !!gameState.players.find(p => p.id === myPlayerId && p.isHost);
  const mode = gameState.gameMode || 'classic';

  modeChips.forEach(chip => {
    chip.classList.toggle('active', chip.dataset.mode === mode);
    chip.disabled = !amIHost;
  });
  if (modeDescription) modeDescription.innerText = MODE_DESCRIPTIONS[mode] || '';

  if (mode === 'team') {
    waitingRoom.classList.add('hidden');
    teamScreen.classList.remove('hidden');
    renderTeamScreen(gameState, myPlayerId, amIHost);
    return;
  } else {
    teamScreen.classList.add('hidden');
    waitingRoom.classList.remove('hidden');
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

// Audit #3: poster <img> error fallback. TMDB images can 404, be blocked
// by strict networks, or simply fail to load — without this the browser
// paints its native broken-image glyph + alt text inside the polished
// card. The app already styles a `.placeholder` block for the
// no-poster-URL case; on load failure we swap the dead <img> for that
// same designed placeholder so the board never looks broken. posterClass
// is the base class the placeholder shares with the image it replaces
// (e.g. 'chain-poster' or 'mini-poster').
function attachPosterFallback(img, posterClass) {
  img.onerror = () => {
    // Guard against re-entrancy: once swapped there's no <img> to error again.
    if (!img.parentNode) return;
    const placeholder = document.createElement('div');
    placeholder.className = posterClass + ' placeholder';
    img.replaceWith(placeholder);
  };
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

let notificationTimeout = null;
export function showNotification(msg) {
  notificationText.innerText = msg;
  notificationOverlay.classList.remove('hidden', 'is-exiting');

  if (notificationTimeout) clearTimeout(notificationTimeout);
  notificationTimeout = setTimeout(() => {
    notificationOverlay.classList.add('is-exiting');
    setTimeout(() => {
      notificationOverlay.classList.add('hidden');
      notificationOverlay.classList.remove('is-exiting', 'notification--elimination');
    }, 300);
  }, 3000);
}

export function showEliminationFlash() {
  const el = document.createElement('div');
  el.className = 'elimination-flash';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// H3: Optionally accepts a `details` object with the failed-attempt context
// (last chain entry's cast vs. the player's guess). When present, renders a
// side-by-side card so the player learns *why* they lost. When absent
// (timeout, disconnect, quit), falls back to the original 3-second flash.
//
// The detailed card is dismissable instead of auto-removed — players need
// to be able to read both cast lists, which often takes longer than 3s.
// All text content is inserted via DOM APIs (textContent / createElement),
// not innerHTML interpolation, to preserve the codebase's no-innerHTML XSS
// posture for any user-controlled data (movie titles come from TMDB but
// the principle is consistent across the file).
export function showSelfEliminationScreen(details) {
  const el = document.createElement('div');
  el.className = 'self-elim-screen';

  // Simple/legacy path — no details, brief auto-dismiss flash.
  if (!details || !details.lastChainEntry || !details.yourGuess) {
    el.innerHTML = `
      <div class="self-elim-icon">💀</div>
      <div class="self-elim-title">You've Been Eliminated</div>
      <div class="self-elim-sub">Spectating from here on out</div>
    `;
    // The card no longer auto-removes itself when details are absent — but
    // keep the original behavior for the legacy flash so existing tests and
    // edge cases (timeouts, disconnects) still feel snappy.
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
    return;
  }

  // H3 detailed path — render the side-by-side cast comparison.
  el.classList.add('self-elim-screen--detailed');
  // Make the screen interactive so the close button can be clicked.
  el.style.pointerEvents = 'auto';

  const card = document.createElement('div');
  card.className = 'self-elim-card';

  const head = document.createElement('div');
  head.className = 'self-elim-head';
  const icon = document.createElement('div');
  icon.className = 'self-elim-icon';
  icon.textContent = '💀';
  const title = document.createElement('div');
  title.className = 'self-elim-title';
  title.textContent = "You've Been Eliminated";
  const sub = document.createElement('div');
  sub.className = 'self-elim-sub';
  sub.textContent = details.reason || 'Invalid connection';
  head.appendChild(icon);
  head.appendChild(title);
  head.appendChild(sub);

  // Two columns: "needed" (last chain entry) and "you played" (the guess).
  // Cast lists are top-10 only — anything longer would visually overwhelm
  // the card and the actor that mattered (or didn't) is almost always in
  // the top of the cast list anyway. Already trimmed server-side.
  const grid = document.createElement('div');
  grid.className = 'self-elim-grid';

  const buildColumn = (label, movie, columnClass) => {
    const col = document.createElement('div');
    col.className = `self-elim-col ${columnClass}`;
    const colLabel = document.createElement('div');
    colLabel.className = 'self-elim-col-label';
    colLabel.textContent = label;
    const colTitle = document.createElement('div');
    colTitle.className = 'self-elim-col-title';
    // textContent is XSS-safe — escapes interpretation as HTML.
    colTitle.textContent = `${movie.title || 'Unknown'} (${movie.year || '?'})`;
    const castList = document.createElement('div');
    castList.className = 'self-elim-col-cast';
    (movie.cast || []).forEach((name, i) => {
      if (i > 0) castList.appendChild(document.createTextNode(', '));
      castList.appendChild(document.createTextNode(name));
    });
    col.appendChild(colLabel);
    col.appendChild(colTitle);
    col.appendChild(castList);
    return col;
  };

  grid.appendChild(buildColumn('Needed a connection to', details.lastChainEntry, 'self-elim-col--needed'));
  grid.appendChild(buildColumn('You played', details.yourGuess, 'self-elim-col--played'));

  // Hint line — small, encouraging, generic (we don't compute the literal
  // "best next move" here; that's a Week 4+ stretch).
  const hint = document.createElement('div');
  hint.className = 'self-elim-hint';
  hint.textContent = 'No actor appears in both casts above. Look for shared names next time.';

  // Dismiss button — explicit close so screen-reader users have a clear
  // exit. Pressing Escape also dismisses (handled via the close path).
  const close = document.createElement('button');
  close.className = 'self-elim-close';
  close.type = 'button';
  close.textContent = 'Continue spectating';
  const dismiss = () => {
    el.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);

  card.appendChild(head);
  card.appendChild(grid);
  card.appendChild(hint);
  card.appendChild(close);
  el.appendChild(card);

  document.body.appendChild(el);
  // Move focus into the card for keyboard users so Escape and Tab land
  // somewhere predictable.
  close.focus();
}

export function showWinFlash() {
  const el = document.createElement('div');
  el.className = 'win-flash';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

// M2: Confetti burst on win. Pure DOM + CSS — no library, no canvas. ~40
// pieces with randomized colors, horizontal start positions, fall durations,
// and rotation rates. Each piece is positioned absolutely at the top, falls
// to the bottom of the viewport, and self-removes when its animation ends.
//
// Performance: 40 elements with one CSS animation each is well under the
// repaint budget on any device made in the last decade. Skips work entirely
// when prefers-reduced-motion is set — the global CSS rule would zero out
// the animation duration, but creating + removing 40 elements is still
// pointless under reduced motion, so we bail at the JS layer.
export function showConfetti() {
  // Match the CSS reduced-motion gate at the JS level so we don't even
  // create the elements when motion is suppressed.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colors = ['#fbbf24', '#f43f5e', '#34d399', '#60a5fa', '#a78bfa', '#fb923c'];
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  const PIECE_COUNT = 40;
  for (let i = 0; i < PIECE_COUNT; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    // Randomize color, horizontal position, fall duration, sway, rotation.
    const color = colors[Math.floor(Math.random() * colors.length)];
    const left = Math.random() * 100;            // 0–100% of viewport width
    const duration = 1.8 + Math.random() * 1.4;  // 1.8–3.2s fall
    const delay = Math.random() * 0.4;           // 0–400ms stagger
    const sway = (Math.random() - 0.5) * 80;     // ±40px horizontal drift
    const rotate = Math.random() * 720 - 360;    // ±1 full revolution
    piece.style.background = color;
    piece.style.left = left + 'vw';
    piece.style.animationDuration = duration + 's';
    piece.style.animationDelay = delay + 's';
    // Pass per-piece values to the CSS keyframes via custom properties so
    // a single keyframe definition can cover all variations (otherwise
    // we'd need to inject inline keyframes per piece, which is heavier).
    piece.style.setProperty('--sway', sway + 'px');
    piece.style.setProperty('--rotate', rotate + 'deg');
    container.appendChild(piece);
  }

  // Auto-remove the container after the longest piece finishes (max 3.2s
  // duration + 0.4s delay = 3.6s) plus a small grace window. Keeps the DOM
  // clean and prevents stacking confetti containers if a player wins
  // multiple back-to-back games.
  setTimeout(() => container.remove(), 4000);
}

// ---------------------------------------------------------------------------
// GHOST ATTEMPT — transient card showing a player's failed submission so
// other players can see what was tried. Auto-clears after 8s, replaced if
// another attempt fails, and removed when the chain advances (handled by
// renderChainItems — see clearGhostAttempt call there).
// ---------------------------------------------------------------------------
let ghostAttemptTimer = null;

export function showGhostAttempt({ playerName, movieTitle, reason }) {
  if (!chainDisplay) return;
  // Replace any existing ghost so only the latest attempt is visible
  clearGhostAttempt();

  const ghost = document.createElement('div');
  ghost.className = 'ghost-attempt';

  const icon = document.createElement('span');
  icon.className = 'ghost-attempt-icon';
  icon.textContent = '✗';

  const body = document.createElement('div');
  body.className = 'ghost-attempt-body';

  const title = document.createElement('div');
  title.className = 'ghost-attempt-title';
  // Audit finding #9: structural DOM instead of innerHTML interpolation.
  // "<playerName> tried <em><movieTitle></em>" built from text nodes + a
  // real <em> element — no HTML string assembled from user-controlled data.
  const emTitle = document.createElement('em');
  emTitle.textContent = movieTitle;
  title.append(
    document.createTextNode(playerName + ' tried '),
    emTitle
  );

  const reasonEl = document.createElement('div');
  reasonEl.className = 'ghost-attempt-reason';
  reasonEl.textContent = reason || 'Invalid connection';

  body.appendChild(title);
  body.appendChild(reasonEl);
  ghost.appendChild(icon);
  ghost.appendChild(body);

  chainDisplay.appendChild(ghost);
  chainDisplay.scrollTop = chainDisplay.scrollHeight;

  ghostAttemptTimer = setTimeout(clearGhostAttempt, 8000);
}

export function clearGhostAttempt() {
  if (ghostAttemptTimer) {
    clearTimeout(ghostAttemptTimer);
    ghostAttemptTimer = null;
  }
  chainDisplay?.querySelectorAll('.ghost-attempt').forEach(el => el.remove());
}

export function renderAutocompleteResults(results) {
  if (!results || results.length === 0) {
    if (autocompleteContainer) autocompleteContainer.innerHTML = '<div class="empty-hint">No results found.</div>';
    // Group all mobileAcDropdown access behind a single existence check —
    // both innerHTML and classList must be guarded together since either can
    // throw if the element isn't in the DOM (older HTML, viewport pruning, etc.).
    if (mobileAcDropdown) {
      mobileAcDropdown.innerHTML = '<div class="empty-hint">No results found.</div>';
      mobileAcDropdown.classList.add('open');
    }
    return;
  }

  if (autocompleteContainer) autocompleteContainer.innerHTML = '';
  if (mobileAcDropdown) mobileAcDropdown.innerHTML = '';

  results.forEach(movie => {
    // Generate the DOM node logic once, returning a fresh node for each container
    const createAcNode = () => {
      const div = document.createElement('div');
      div.className = 'autocomplete-item';

      const id = movie.id || movie.tmdbId || 'unknown';
      const mediaType = movie.media_type || movie.mediaType || 'movie';

      div.setAttribute('data-tmdb-id', id);
      div.setAttribute('data-media-type', mediaType);

      if (movie.poster && movie.poster.startsWith('https://image.tmdb.org/')) {
        const img = document.createElement('img');
        img.src = movie.poster;
        img.alt = 'Poster';
        img.className = 'mini-poster';
        // Swap to the designed placeholder if the poster fails to load.
        attachPosterFallback(img, 'mini-poster');
        div.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'mini-poster placeholder';
        div.appendChild(placeholder);
      }

      const acText = document.createElement('div');
      acText.className = 'ac-text';
      const acTitle = document.createElement('div');
      acTitle.className = 'ac-title';
      acTitle.textContent = movie.title;
      const yearSpan = document.createElement('span');
      yearSpan.className = 'year';
      yearSpan.textContent = '(' + movie.year + ')';
      acText.appendChild(acTitle);
      acText.appendChild(yearSpan);
      div.appendChild(acText);

      div.addEventListener('click', () => {
        const title = movie.title;
        if (movieInput) movieInput.value = '';
        if (autocompleteContainer) autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
        closeMobileAc();

        const socket = getSocket();
        const lobbyId = getCurrentLobbyId();

        if (socket && id && id !== 'unknown' && mediaType) {
          socket.emit('submitMovie', {
            lobbyId: lobbyId,
            movie: title,
            tmdbId: parseInt(id),
            mediaType: mediaType
          });

          if (movieInput) {
            movieInput.value = '';
            movieInput.disabled = true;
          }
          if (submitBtn) submitBtn.disabled = true;
          if (hintText) hintText.innerText = 'Validating connection...';
          if (autocompleteContainer) autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
          closeMobileAc();
        }
      });

      return div;
    };

    if (autocompleteContainer) autocompleteContainer.appendChild(createAcNode());
    if (mobileAcDropdown) mobileAcDropdown.appendChild(createAcNode());
  });

  // Same guard on the success path — even with results, the element may not exist.
  if (mobileAcDropdown) mobileAcDropdown.classList.add('open');
}

export function closeMobileAc() {
  // Guard so calling this from a context that never had the dropdown (e.g. desktop
  // tests) is a safe no-op instead of a TypeError on .classList / .innerHTML.
  if (!mobileAcDropdown) return;
  mobileAcDropdown.classList.remove('open');
  mobileAcDropdown.innerHTML = '';
}

export function generateShareCard(state) {
    const W = 600, H = 720;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const COLORS = {
        bg: '#09090b',
        surface: '#18181b',
        border: 'rgba(255,255,255,0.08)',
        accent: '#818cf8',
        accentDark: '#4338ca',
        text: '#f8fafc',
        muted: '#94a3b8',
        star: '#fbbf24',
    };

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    const headerGrad = ctx.createLinearGradient(0, 0, W, 0);
    headerGrad.addColorStop(0, COLORS.accentDark);
    headerGrad.addColorStop(1, COLORS.accent);
    ctx.fillStyle = headerGrad;
    ctx.fillRect(0, 0, W, 64);

    ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎬 MovieMatch', 28, 32);

    const chainLen = state.chain.length;
    ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const labelY = 100;
    ctx.fillText(`CHAIN OF ${chainLen} CONNECTION${chainLen !== 1 ? 'S' : ''}`, 32, labelY);

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32, labelY + 10);
    ctx.lineTo(W - 32, labelY + 10);
    ctx.stroke();

    const { entries, skipped } = selectChainEntries(state.chain);
    let y = labelY + 32;
    const lineH = 44;

    entries.forEach((item, i) => {
        const isHighlight = item._score > 0 && item._idx !== 0;
        const isFirst = item._idx === 0;
        const isLast = item._idx === state.chain.length - 1 && state.chain.length > 1;

        if (isHighlight) {
            ctx.fillStyle = 'rgba(129,140,248,0.07)';
            roundRect(ctx, 28, y - 6, W - 56, lineH - 4, 6);
            ctx.fill();
        }

        ctx.textBaseline = 'middle';
        if (isHighlight) {
            ctx.font = '13px sans-serif';
            ctx.fillText('⭐', 32, y + 10);
        }

        ctx.font = `500 13px "Plus Jakarta Sans", sans-serif`;
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'left';
        ctx.fillText(String(item._idx + 1).padStart(2, ' '), isHighlight ? 52 : 32, y + 10);

        ctx.fillStyle = COLORS.text;
        ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(truncate(item.playerName, 12), 72, y + 10);

        ctx.fillStyle = COLORS.text;
        ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
        const titleX = 185;
        const titleStr = `${truncate(item.movie.title, 22)} (${item.movie.year})`;
        ctx.fillText(titleStr, titleX, y + 10);

        if (!isFirst && item.matchedActors && item.matchedActors.length > 0) {
            ctx.fillStyle = COLORS.accent;
            ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
            ctx.fillText(`↔ ${item.matchedActors[0]}`, titleX, y + 28);
        }

        if (isLast) {
            ctx.fillStyle = '#4ade80';
            ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('✓', W - 32, y + 10);
            ctx.textAlign = 'left';
        }

        y += lineH;
    });

    if (skipped > 0) {
        ctx.font = 'italic 12px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(`+ ${skipped} more connection${skipped !== 1 ? 's' : ''}`, 32, y + 10);
        y += 28;
    }

    const winnerY = Math.max(y + 20, H - 140);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32, winnerY);
    ctx.lineTo(W - 32, winnerY);
    ctx.stroke();

    if (state.winner) {
        ctx.font = 'bold 26px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.accent;
        ctx.textAlign = 'center';
        ctx.fillText(`🏆 ${state.winner.name} wins!`, W / 2, winnerY + 36);
        ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(`${chainLen} connections • ${state.winner.score} pts`, W / 2, winnerY + 60);
    } else if (state.gameMode === 'solo') {
        ctx.font = 'bold 26px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'center';
        ctx.fillText(`🎬 Solo Over`, W / 2, winnerY + 36);
        ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(`Final Chain: ${chainLen} connections`, W / 2, winnerY + 60);
    } else {
        ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'center';
        ctx.fillText('🎬 Game Over!', W / 2, winnerY + 36);
    }

    const footerGrad = ctx.createLinearGradient(0, H - 48, 0, H);
    footerGrad.addColorStop(0, 'transparent');
    footerGrad.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = footerGrad;
    ctx.fillRect(0, H - 48, W, 48);

    const siteUrl = window.location.hostname !== 'localhost'
        ? window.location.hostname
        : 'moviematch.it.com';
    ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    ctx.fillText(siteUrl, W / 2, H - 16);

    return canvas;
}

export function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

export function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

export function scoreChainEntry(item, index, chain) {
    if (index === 0) return -1;
    let score = 0;
    const prev = chain[index - 1];

    if (prev.movie.mediaType && item.movie.mediaType &&
        prev.movie.mediaType !== item.movie.mediaType) {
        score += 3;
    }

    const actor = (item.matchedActors || [])[0];
    if (actor) {
        // H4: cast entries are now {id, name} objects (with legacy bare-string
        // entries possible during the transition). Compare on the name field;
        // matchedActors stays as bare strings for client-display compatibility.
        const pos = (item.movie.cast || []).findIndex(c => {
            const cName = typeof c === 'string' ? c : (c && c.name) || '';
            return cName.toLowerCase() === actor.toLowerCase();
        });
        if (pos > 4) score += 2;
    }

    const prevYear = parseInt(prev.movie.year);
    const currYear = parseInt(item.movie.year);
    if (!isNaN(prevYear) && !isNaN(currYear)) {
        score += Math.floor(Math.abs(currYear - prevYear) / 10);
    }

    return score;
}

export function selectChainEntries(chain) {
    const MAX = 7;
    if (chain.length <= MAX) return { entries: chain.map((c, i) => ({ ...c, _idx: i })), skipped: 0 };

    const scored = chain.map((item, i) => ({ ...item, _idx: i, _score: scoreChainEntry(item, i, chain) }));

    const first = scored[0];
    const last = scored[scored.length - 1];

    const middle = scored.slice(1, -1)
        .sort((a, b) => b._score - a._score)
        .slice(0, 5)
        .sort((a, b) => a._idx - b._idx);

    const entries = [first, ...middle, last];
    const skipped = chain.length - entries.length;
    return { entries, skipped };
}

// =========================================================================
// ANIMATED CHAIN REPLAY (L2)
// =========================================================================
// Re-renders a chain one entry at a time into `container`, with a sound
// beat on each new entry. Self-contained — doesn't depend on the global
// gameState or live render path. Reused by the daily-result modal "▶
// Replay" button (and a candidate for the post-game share modal in a
// future iteration).
//
// Long chains are capped at MAX_REPLAY_ENTRIES so a 30-link daily run
// doesn't take 21 seconds to replay; entries beyond the cap are dropped
// from the visible animation but a "+N more" footer flags the omission.

const MAX_REPLAY_ENTRIES = 14;
const REPLAY_STEP_MS = 600;

export function playChainReplay(container, chain, options = {}) {
  if (!container || !Array.isArray(chain) || chain.length === 0) return;
  // Reduced motion: short-circuit to a static render. Animating one beat
  // per entry over several seconds is exactly the kind of long decorative
  // sequence reduced-motion users want suppressed.
  const reduced = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stepMs = options.stepMs || REPLAY_STEP_MS;
  const maxEntries = options.maxEntries || MAX_REPLAY_ENTRIES;
  const onComplete = typeof options.onComplete === 'function' ? options.onComplete : null;

  // Take the most recent N entries — players care more about the moves
  // they just made than the ones at the start of a long chain.
  const tail = chain.slice(-maxEntries);
  const skipped = chain.length - tail.length;

  container.textContent = '';

  if (skipped > 0) {
    const note = document.createElement('div');
    note.className = 'replay-skipped-note';
    note.textContent = `+${skipped} earlier connection${skipped === 1 ? '' : 's'}…`;
    container.appendChild(note);
  }

  // Reduced-motion: render everything immediately, no per-beat sound.
  if (reduced) {
    tail.forEach((item, i) => container.appendChild(_buildReplayEntry(item, i, tail)));
    if (onComplete) onComplete();
    return;
  }

  let i = 0;
  const tick = () => {
    if (i >= tail.length) {
      if (onComplete) onComplete();
      return;
    }
    container.appendChild(_buildReplayEntry(tail[i], i, tail));
    // Each beat: short success ding. Skip on the very first entry so the
    // replay starts visually before audio kicks in (less jarring).
    if (i > 0) playSfx('success');
    i++;
    setTimeout(tick, stepMs);
  };
  // Tiny initial delay so the user has time to register the modal opening
  // before the first entry pops in.
  setTimeout(tick, 200);
}

// Build a single replay-entry DOM node. Uses the same shape as the live
// chain renderer (poster + title + cast) but with a `.replay-entry` class
// so CSS can give it a fade-in animation and a slightly tighter layout.
function _buildReplayEntry(item, index, allItems) {
  const div = document.createElement('div');
  div.className = 'chain-item replay-entry';
  if (index > 0) div.classList.add('shared-highlight');

  // Poster
  if (item.movie && item.movie.poster && item.movie.poster.startsWith('https://image.tmdb.org/')) {
    const img = document.createElement('img');
    img.src = item.movie.poster;
    img.alt = 'Poster';
    img.className = 'chain-poster';
    div.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'chain-poster placeholder';
    div.appendChild(placeholder);
  }

  const content = document.createElement('div');
  content.className = 'chain-content';

  // Player or seed label
  const playerNameDiv = document.createElement('div');
  playerNameDiv.className = 'player-name';
  playerNameDiv.textContent = item.playerName || 'Player';
  content.appendChild(playerNameDiv);

  // Title + year
  const titleDiv = document.createElement('div');
  titleDiv.className = 'movie-title';
  titleDiv.appendChild(document.createTextNode((item.movie?.title || 'Unknown') + ' '));
  const yearSpan = document.createElement('span');
  yearSpan.className = 'year';
  yearSpan.textContent = '(' + (item.movie?.year || '?') + ')';
  titleDiv.appendChild(yearSpan);
  content.appendChild(titleDiv);

  // Connecting actor — for entries past index 0, surface the matched
  // actor as a single line so the replay shows the connection logic
  // beat by beat rather than the player having to scan two cast lists.
  if (index > 0 && Array.isArray(item.matchedActors) && item.matchedActors.length > 0) {
    const conn = document.createElement('div');
    conn.className = 'replay-connector';
    conn.textContent = '↔ via ' + item.matchedActors[0];
    content.appendChild(conn);
  }

  div.appendChild(content);
  return div;
}

// =========================================================================
// MY STATS MODAL (H5)
// =========================================================================
// Renders the player's lifetime stats into the #my-stats-modal body.
// Pure function of the stats payload — no DOM ownership beyond the body
// element it's pointed at. All text is inserted via DOM APIs (textContent
// / createElement) so a future stableId-tied display name with crafted
// characters can't get HTML-injected into the page.

const MODE_LABELS = {
  classic: '⚔️ Classic',
  team: '🤝 Team',
  solo: '👤 Solo',
  speed: '⚡ Speed',
  daily: '🗓️ Daily',
};

export function renderMyStats(stats) {
  const modal = document.getElementById('my-stats-modal');
  const body = document.getElementById('my-stats-body');
  const sub = document.getElementById('my-stats-subtitle');
  if (!modal || !body || !sub) return;

  body.textContent = '';
  const isEmpty = !stats || stats.gamesPlayed === 0;
  sub.textContent = isEmpty
    ? 'Play a few games to start tracking your numbers.'
    : 'Lifetime — last 90 days';

  // Empty-state — no plays yet. Shorter, encouraging copy instead of a
  // sea of zeroes.
  if (isEmpty) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.style.cssText = 'text-align:center; padding:2rem; color:var(--text-muted); font-style:italic;';
    empty.textContent = "No stats yet — your first game will start your record.";
    body.appendChild(empty);
    modal.classList.remove('hidden');
    return;
  }

  // Hero numbers row: gamesPlayed, wins, longestChain, totalPlays.
  // Compact 4-up grid that collapses to 2x2 on phones via CSS.
  const heroGrid = document.createElement('div');
  heroGrid.className = 'stats-hero-grid';
  const heroEntries = [
    { label: 'Games', value: stats.gamesPlayed },
    { label: 'Wins',  value: stats.wins },
    { label: 'Longest chain', value: stats.longestChain },
    { label: 'Plays', value: stats.totalPlays },
  ];
  heroEntries.forEach(e => {
    const card = document.createElement('div');
    card.className = 'stats-hero-card';
    const num = document.createElement('div');
    num.className = 'stats-hero-num';
    num.textContent = String(e.value | 0);
    const lbl = document.createElement('div');
    lbl.className = 'stats-hero-label';
    lbl.textContent = e.label;
    card.appendChild(num);
    card.appendChild(lbl);
    heroGrid.appendChild(card);
  });
  body.appendChild(heroGrid);

  // Win-rate readout (just below the hero grid). Shown only when the
  // player has played at least one game so we don't render "NaN%".
  if (stats.gamesPlayed > 0) {
    const winrate = Math.round((stats.wins / stats.gamesPlayed) * 100);
    const wr = document.createElement('div');
    wr.className = 'stats-winrate';
    wr.textContent = `Win rate: ${winrate}%`;
    body.appendChild(wr);
  }

  // By-mode breakdown — only show modes the player has actually touched.
  // Shows played / won / longest per mode. Modes are rendered in the
  // canonical order (classic, team, solo, speed, daily) regardless of
  // which the player has touched, so the layout is predictable.
  const modesPlayed = Object.entries(stats.byMode || {})
    .filter(([, v]) => (v.played | 0) > 0);
  if (modesPlayed.length > 0) {
    const header = document.createElement('div');
    header.className = 'stats-section-header';
    header.textContent = 'By mode';
    body.appendChild(header);

    const table = document.createElement('div');
    table.className = 'stats-mode-table';
    // Column headers
    ['Mode', 'Played', 'Won', 'Longest'].forEach(t => {
      const h = document.createElement('div');
      h.className = 'stats-mode-th';
      h.textContent = t;
      table.appendChild(h);
    });
    const order = ['classic', 'team', 'solo', 'speed', 'daily'];
    order.forEach(mode => {
      const v = stats.byMode[mode];
      if (!v || (v.played | 0) === 0) return;
      const cells = [
        MODE_LABELS[mode] || mode,
        String(v.played | 0),
        String(v.won | 0),
        String(v.longestChain | 0),
      ];
      cells.forEach((text, i) => {
        const c = document.createElement('div');
        c.className = 'stats-mode-td' + (i === 0 ? ' stats-mode-td--label' : '');
        c.textContent = text;
        table.appendChild(c);
      });
    });
    body.appendChild(table);
  }

  // Favorite connector callout — only shown when we have one. Most fun
  // single-line in the modal because it's specific to the player's history.
  if (stats.favoriteConnector && stats.favoriteConnector.name) {
    const fav = document.createElement('div');
    fav.className = 'stats-favorite';
    const tag = document.createElement('span');
    tag.className = 'stats-favorite-label';
    tag.textContent = '⭐ Most-used connector: ';
    const name = document.createElement('strong');
    name.textContent = stats.favoriteConnector.name;
    const count = document.createElement('span');
    count.className = 'stats-favorite-count';
    count.textContent = ` (${stats.favoriteConnector.count | 0}×)`;
    fav.appendChild(tag);
    fav.appendChild(name);
    fav.appendChild(count);
    body.appendChild(fav);
  }

  modal.classList.remove('hidden');
}

// =========================================================================
// DAILY CHALLENGE RESULT MODAL (H2)
// =========================================================================
// Single render path used by both the "you already played today" view and
// the post-game result view. The two cases differ only in the title/copy
// and whether the share button is wired — handled inline below via flags
// on the `data` argument.

export function renderDailyResult(data) {
  // Defensive: bail silently if the modal markup isn't present (e.g. during
  // tests where index.html isn't loaded). Production always has it.
  const modal = document.getElementById('daily-result-modal');
  if (!modal) return;

  const titleEl = document.getElementById('daily-result-title');
  const subEl = document.getElementById('daily-result-subtitle');
  const bodyEl = document.getElementById('daily-result-body');
  const shareBtn = document.getElementById('daily-result-share-btn');
  if (!titleEl || !subEl || !bodyEl || !shareBtn) return;

  const isAlreadyPlayed = !!data.alreadyPlayed;
  const puzzleNumber = data.puzzleNumber || 1;
  const date = data.date || '';
  const chainLength = Math.max(0, data.chainLength | 0);

  titleEl.textContent = `🗓️ Daily Challenge #${puzzleNumber}`;
  subEl.textContent = isAlreadyPlayed
    ? `You already played today — come back tomorrow for a new puzzle.`
    : `${chainLength === 0 ? 'No moves connected' : `Chain of ${chainLength}`}${date ? ' — ' + date : ''}`;

  // Build body: score readout + leaderboard table. Use DOM APIs (not
  // innerHTML interpolation) so a future leaderboard entry with crafted
  // characters can't get HTML-injected.
  bodyEl.textContent = '';

  // Big score badge.
  const scoreCard = document.createElement('div');
  scoreCard.className = 'daily-score-card';
  const scoreNum = document.createElement('div');
  scoreNum.className = 'daily-score-num';
  scoreNum.textContent = String(chainLength);
  const scoreLabel = document.createElement('div');
  scoreLabel.className = 'daily-score-label';
  scoreLabel.textContent = chainLength === 1 ? 'connection' : 'connections';
  scoreCard.appendChild(scoreNum);
  scoreCard.appendChild(scoreLabel);
  bodyEl.appendChild(scoreCard);

  // L2: Replay-chain panel + button. Only shown when we have the chain
  // (post-game flow has it via the cached state; "already played today"
  // path doesn't and skips this section). Button is rendered inside the
  // body so it sits between the score and the leaderboard — players see
  // their result first, can replay it, then see how they ranked.
  if (Array.isArray(data.chain) && data.chain.length > 0) {
    const replayWrap = document.createElement('div');
    replayWrap.className = 'daily-replay-wrap';

    const replayBtn = document.createElement('button');
    replayBtn.type = 'button';
    replayBtn.className = 'btn-secondary daily-replay-btn';
    replayBtn.textContent = '▶ Replay your chain';

    const replayContainer = document.createElement('div');
    replayContainer.className = 'daily-replay-container';

    replayBtn.addEventListener('click', () => {
      // Disable while playing to prevent accidental restarts mid-replay.
      replayBtn.disabled = true;
      replayBtn.textContent = 'Replaying…';
      playChainReplay(replayContainer, data.chain, {
        onComplete: () => {
          replayBtn.disabled = false;
          replayBtn.textContent = '▶ Replay again';
        },
      });
    });

    replayWrap.appendChild(replayBtn);
    replayWrap.appendChild(replayContainer);
    bodyEl.appendChild(replayWrap);
  }

  // Leaderboard. Empty array → "Be the first!" hint.
  const lbHeader = document.createElement('div');
  lbHeader.className = 'daily-lb-header';
  lbHeader.textContent = "Today's leaderboard";
  bodyEl.appendChild(lbHeader);

  const lbList = document.createElement('div');
  lbList.className = 'daily-lb-list';
  const leaderboard = Array.isArray(data.leaderboard) ? data.leaderboard : [];
  if (leaderboard.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.style.cssText = 'text-align:center; padding:1rem; color:var(--text-muted);';
    empty.textContent = 'No results yet. Yours could be the first!';
    lbList.appendChild(empty);
  } else {
    leaderboard.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'daily-lb-row';
      const rank = document.createElement('span');
      rank.className = 'daily-lb-rank';
      rank.textContent = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
      const name = document.createElement('span');
      name.className = 'daily-lb-name';
      name.textContent = entry.name || 'Anonymous';
      const len = document.createElement('span');
      len.className = 'daily-lb-len';
      len.textContent = String(entry.chainLength | 0);
      row.appendChild(rank);
      row.appendChild(name);
      row.appendChild(len);
      lbList.appendChild(row);
    });
  }
  bodyEl.appendChild(lbList);

  // Wire the share button to copy a Wordle-style text result. Replace any
  // prior listener (cloneNode trick) so reopening the modal doesn't
  // accumulate handlers across multiple opens.
  const newShareBtn = shareBtn.cloneNode(true);
  shareBtn.parentNode.replaceChild(newShareBtn, shareBtn);
  newShareBtn.addEventListener('click', () => {
    const text = `🎬 MovieMatch Daily #${puzzleNumber}\nChain: ${chainLength}\nhttps://moviematch.it.com`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast('Result copied to clipboard! 📋'),
        () => showToast('Couldn\'t copy — try again')
      );
    } else {
      showToast('Clipboard not available');
    }
  });

  // Ensure the close-button + Done button both close the modal cleanly.
  // The MutationObserver focus-trap wiring (L6 from Week 1) handles focus
  // restoration when the modal is hidden.
  const closeBtn = document.getElementById('daily-result-close-btn');
  if (closeBtn) {
    const fresh = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(fresh, closeBtn);
    fresh.addEventListener('click', () => modal.classList.add('hidden'));
  }

  modal.classList.remove('hidden');
}

export function showToast(msg) {
  const toast = document.querySelector('.copy-toast') || document.createElement('div');
  toast.className = 'copy-toast';
  toast.textContent = msg;
  if (!toast.parentElement) document.body.appendChild(toast);
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

export function openShareModal(gameState) {
  document.fonts.ready.then(() => {
    const generated = generateShareCard(gameState);
    shareCanvas.width = generated.width;
    shareCanvas.height = generated.height;
    shareCanvas.getContext('2d').drawImage(generated, 0, 0);
    shareModal.classList.remove('hidden');
  });
}

export function buildTextRecap(state) {
    const lines = ['🎬 MovieMatch\n'];
    lines.push(`Chain of ${state.chain.length} connections:\n`);
    state.chain.forEach((item, i) => {
        const actor = (item.matchedActors || [])[0];
        lines.push(`${i + 1}. ${item.playerName} → ${item.movie.title} (${item.movie.year})${actor ? ` ↔ ${actor}` : ''}`);
    });
    if (state.winner) lines.push(`\n🏆 ${state.winner.name} wins with ${state.winner.score} pts!`);
    const siteUrl = window.location.hostname !== 'localhost' ? window.location.hostname : 'moviematch.it.com';
    lines.push(`\nPlay at ${siteUrl}`);
    return lines.join('\n');
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
  shareBtn.className = 'btn-primary';
  shareBtn.textContent = '\uD83C\uDFAC Share Results';
  actionsDiv.appendChild(shareBtn);

  if (isHost) {
    const playAgainBtn = document.createElement('button');
    playAgainBtn.id = 'play-again-btn';
    playAgainBtn.className = 'btn-secondary';
    playAgainBtn.textContent = '\u21A9 Play Again';
    actionsDiv.appendChild(playAgainBtn);
  }

  banner.appendChild(titleDiv);
  banner.appendChild(subtitleDiv);
  banner.appendChild(actionsDiv);

  chainDisplay.appendChild(banner);
  chainDisplay.scrollTop = chainDisplay.scrollHeight;
}
