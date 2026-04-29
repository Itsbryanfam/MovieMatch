// ====================== UI.JS ======================
import { escapeHtml, playSuccess, playFail, playTick, prepareAudio } from './utils.js';
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
export let heroPlayBtn, heroCodeBtn, howToPlayModal, creditsModal;
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
        li.innerHTML = `<span>${escapeHtml(p.name)}</span> <span>${p.score}</span>`;
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
      li.innerHTML = `<span>${escapeHtml(p.name)}</span> <span>${p.score}</span>`;
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
    castList.forEach((actorName, ci) => {
      if (ci > 0) castDiv.appendChild(document.createTextNode(', '));
      const isMatched = index > 0 && previousActors.some(pa => pa.toLowerCase() === actorName.toLowerCase());
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

// Updates the input area, turn indicator, and hint text based on whose turn it is.
function renderTurnControls(gameState, myPlayerId, isSpectator, mode) {
  const activePlayer = gameState.players[gameState.currentTurnIndex];

  if (mode === 'solo') {
    turnIndicator.innerHTML = `🔗 Chain: <span class="chain-badge">${gameState.chain.length}</span>`;
  }

  if (isSpectator && gameState.status !== 'finished') {
    inputArea.classList.add('disabled-area');
    if (movieInput) movieInput.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    turnIndicator.textContent = '👁 Spectating';
    hintText.textContent = "You'll join when this game ends.";
    return;
  }

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

export function showSelfEliminationScreen() {
  const el = document.createElement('div');
  el.className = 'self-elim-screen';
  el.innerHTML = `
    <div class="self-elim-icon">💀</div>
    <div class="self-elim-title">You've Been Eliminated</div>
    <div class="self-elim-sub">Spectating from here on out</div>
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

export function showWinFlash() {
  const el = document.createElement('div');
  el.className = 'win-flash';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2300);
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
  title.innerHTML = escapeHtml(playerName) + ' tried <em>' + escapeHtml(movieTitle) + '</em>';

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
    if (mobileAcDropdown) mobileAcDropdown.innerHTML = '<div class="empty-hint">No results found.</div>';
    mobileAcDropdown.classList.add('open');
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

  mobileAcDropdown.classList.add('open');
}

export function closeMobileAc() {
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
        const pos = (item.movie.cast || []).findIndex(
            c => c.toLowerCase() === actor.toLowerCase()
        );
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
