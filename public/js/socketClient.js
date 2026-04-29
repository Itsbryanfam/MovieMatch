// ============================================================================
// SOCKET CLIENT — Network layer
// ============================================================================
// Pure socket event handling. Receives server events, updates state,
// and delegates all rendering to ui.js.
//
// No state ownership — reads/writes through state.js.
// No DOM creation — calls ui.js functions for rendering.
// ============================================================================

import {
  initUIElements, renderLobby, renderGame, renderTeamScreen,
  showNotification, renderAutocompleteResults, closeMobileAc,
  openShareModal, showGameOverBanner, resetMobileTab,
  showEliminationFlash, showSelfEliminationScreen, showWinFlash,
  // DOM elements
  publicLobbiesList, posterCarousel, lobbyScreen, gameScreen,
  waitingRoom, lobbyCodeDisplay, notificationOverlay, notificationText,
  chatMessages
} from './ui.js';

import { prepareAudio, playSuccess, playFail, playTick, escapeHtml, getStableId } from './utils.js';

import {
  getSocket, setSocket, getCurrentLobbyId, getMyPlayerId, getGameState,
  getIsSpectator, getTurnInterval, getLastTickSound,
  setTurnInterval, setLastTickSound, clearTurnTimer,
  onJoined, onStateUpdate, onRejoined, resetSession
} from './state.js';

// ---------------------------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------------------------

// Set to true for ~3s when the local player is eliminated.
// Suppresses the generic notification overlay so the full-screen
// self-elimination screen can take the stage without overlap.
let selfElimActive = false;

export function initSocket() {
  const socket = io({
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  setSocket(socket);

  // -----------------------------------------------------------------------
  // JOIN / IDENTITY
  // -----------------------------------------------------------------------

  socket.on('joined', (data) => {
    onJoined(data);

    const joinPanel = document.getElementById('join-panel');
    const privatePanel = document.getElementById('private-panel');
    const publicPanel = document.getElementById('public-panel');
    const waitingRoomEl = document.getElementById('waiting-room');
    const lobbyScreenEl = document.getElementById('lobby-screen');
    const heroScreenEl = document.getElementById('hero-screen');

    if (joinPanel) joinPanel.classList.add('hidden');
    if (privatePanel) privatePanel.classList.add('hidden');
    if (publicPanel) publicPanel.classList.add('hidden');
    if (heroScreenEl) heroScreenEl.classList.remove('active');
    if (getIsSpectator()) {
      if (lobbyScreenEl) lobbyScreenEl.classList.remove('active');
      const gameScreenEl = document.getElementById('game-screen');
      if (gameScreenEl) gameScreenEl.classList.add('active');
    } else {
      if (waitingRoomEl) waitingRoomEl.classList.remove('hidden');
      if (lobbyScreenEl) lobbyScreenEl.classList.add('active');
    }
    if (lobbyCodeDisplay) lobbyCodeDisplay.innerText = getCurrentLobbyId();
  });

  socket.on('error', (msg) => showNotification(msg));

  // -----------------------------------------------------------------------
  // PUBLIC LOBBY BROWSER
  // -----------------------------------------------------------------------

  socket.on('publicLobbiesList', (lobbies) => {
    if (!publicLobbiesList) return;
    publicLobbiesList.innerHTML = '';

    if (!lobbies || lobbies.length === 0) {
      publicLobbiesList.innerHTML = '<div class="empty-hint" style="text-align:center; padding: 2rem; color: var(--text-muted); font-style:italic;">No open lobbies found. Create a private one!</div>';
      return;
    }

    const playerNameInput = document.getElementById('player-name');

    lobbies.forEach(lobby => {
      const card = document.createElement('div');
      card.className = 'public-lobby-card';

      const info = document.createElement('div');
      info.className = 'public-lobby-info';

      const h3 = document.createElement('h3');
      h3.textContent = lobby.hostName + "'s Lobby";

      const stats = document.createElement('div');
      stats.className = 'public-lobby-stats';

      const countSpan = document.createElement('span');
      countSpan.textContent = '👥 ' + lobby.playerCount + ' / 8';
      stats.appendChild(countSpan);

      if (lobby.hardcoreMode || lobby.allowTvShows) {
        const tagsDiv = document.createElement('div');
        if (lobby.hardcoreMode) {
          const tag = document.createElement('span');
          tag.className = 'mode-tag';
          tag.textContent = 'Hardcore';
          tagsDiv.appendChild(tag);
        }
        if (lobby.allowTvShows) {
          const tag = document.createElement('span');
          tag.className = 'mode-tag';
          tag.textContent = 'TV Shows';
          tagsDiv.appendChild(tag);
        }
        stats.appendChild(tagsDiv);
      }

      info.appendChild(h3);
      info.appendChild(stats);

      const joinButton = document.createElement('button');
      joinButton.className = 'btn-primary join-public-btn';
      joinButton.style.cssText = 'padding: 0.5rem 1rem; width: auto;';
      joinButton.textContent = 'Join';
      joinButton.addEventListener('click', () => {
        const name = playerNameInput ? playerNameInput.value.trim() : '';
        if (!name) return;
        socket.emit('joinLobby', { name, lobbyId: lobby.id, stableId: getStableId() });
      });

      card.appendChild(info);
      card.appendChild(joinButton);
      publicLobbiesList.appendChild(card);
    });
  });

  // -----------------------------------------------------------------------
  // BACKGROUND POSTERS
  // -----------------------------------------------------------------------

  socket.on('posters', (posters) => {
    let carousel = posterCarousel || document.getElementById('poster-carousel');
    if (!carousel) return;

    carousel.innerHTML = '';

    const rows = 4;
    const postersPerRow = Math.ceil(posters.length / rows);

    for (let i = 0; i < rows; i++) {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'poster-row';

      const rowPosters = posters.slice(i * postersPerRow, (i + 1) * postersPerRow);
      const seamlessPosters = [...rowPosters, ...rowPosters, ...rowPosters, ...rowPosters, ...rowPosters];

      seamlessPosters.forEach(url => {
        const img = document.createElement('img');
        img.src = url;
        rowDiv.appendChild(img);
      });

      carousel.appendChild(rowDiv);
    }
  });

  // -----------------------------------------------------------------------
  // GAME STATE UPDATES
  // -----------------------------------------------------------------------

  socket.on('stateUpdate', (state) => {
    const prevState = getGameState();
    const prevSelfAlive = prevState?.players?.find(p => p.id === getMyPlayerId())?.isAlive;
    const wasMyTurn = prevState?.status === 'playing' &&
      prevState?.players?.[prevState?.currentTurnIndex]?.id === getMyPlayerId();

    const promotion = onStateUpdate(state);
    if (promotion === 'promoted') {
      showNotification('\uD83C\uDFAE You\'ve joined the game!');
    }

    // Self-elimination detection
    const newSelfAlive = state.players?.find(p => p.id === getMyPlayerId())?.isAlive;
    if (prevSelfAlive === true && newSelfAlive === false) {
      selfElimActive = true;
      setTimeout(() => { selfElimActive = false; }, 3200);
      const overlay = document.getElementById('notification-overlay');
      if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('is-exiting', 'notification--elimination');
      }
      showSelfEliminationScreen();
    }

    // Your-turn glow
    const isNowMyTurn = state.status === 'playing' &&
      state.players?.[state.currentTurnIndex]?.id === getMyPlayerId();
    if (isNowMyTurn && !wasMyTurn && !getIsSpectator()) {
      const inputArea = document.getElementById('input-area');
      if (inputArea) {
        inputArea.classList.remove('your-turn-flash');
        void inputArea.offsetWidth;
        inputArea.classList.add('your-turn-flash');
      }
    }

    if (state.status === 'playing') {
      if (lobbyScreen) lobbyScreen.classList.remove('active');
      if (gameScreen) gameScreen.classList.add('active');
      resetMobileTab();
      renderGame(state, getMyPlayerId(), getIsSpectator());

      clearTurnTimer();
      const interval = setInterval(() => {
        const timerBar = document.getElementById('timer-bar');
        const timeText = document.getElementById('time-text');
        const gs = getGameState();
        if (!gs || !gs.turnExpiresAt || gs.status !== 'playing') {
          clearInterval(interval);
          setTurnInterval(null);
          if (timerBar) timerBar.classList.remove('timer-critical');
          return;
        }

        const ms = gs.turnExpiresAt - Date.now();
        let tr = Math.max(0, Math.ceil(ms / 1000));

        if (timeText) timeText.innerText = tr + 's';
        const percentage = (tr / 60) * 100;
        if (timerBar) {
          timerBar.style.width = Math.max(0, Math.min(percentage, 100)) + '%';

          if (tr <= 10) {
            timerBar.style.backgroundColor = 'var(--timer-red)';
            timerBar.classList.add('timer-critical');
            if (tr > 0 && Math.floor(Date.now() / 1000) > getLastTickSound()) {
              playTick();
              setLastTickSound(Math.floor(Date.now() / 1000));
            }
          } else {
            timerBar.classList.remove('timer-critical');
            if (tr <= 30) {
              timerBar.style.backgroundColor = 'var(--timer-yellow)';
            } else {
              timerBar.style.backgroundColor = 'var(--timer-green)';
            }
          }
        }

        if (tr === 0) {
          socket.emit('forceNextTurn', getCurrentLobbyId());
          clearInterval(interval);
          setTurnInterval(null);
        }
      }, 1000);
      setTurnInterval(interval);

    } else if (state.status === 'waiting') {
      clearTurnTimer();
      if (gameScreen) gameScreen.classList.remove('active');
      if (lobbyScreen) lobbyScreen.classList.add('active');
      renderLobby(state, getMyPlayerId());
    } else if (state.status === 'finished') {
      clearTurnTimer();
      renderGame(state, getMyPlayerId(), getIsSpectator());
    }
  });

  // -----------------------------------------------------------------------
  // NOTIFICATIONS
  // -----------------------------------------------------------------------

  socket.on('notification', (msg) => {
    if (!selfElimActive) showNotification(msg);
    if (msg.includes('eliminated')) {
      playFail();
      showEliminationFlash();
      if (!selfElimActive) {
        const overlay = document.getElementById('notification-overlay');
        if (overlay) overlay.classList.add('notification--elimination');
      }
      const board = document.querySelector('.board');
      if (board) {
        board.classList.add('shake');
        setTimeout(() => board.classList.remove('shake'), 750);
      }
    } else if (msg.includes('wins')) {
      document.querySelectorAll('.elimination-flash').forEach(el => el.remove());
      playSuccess();
      setTimeout(playSuccess, 300);
      setTimeout(playSuccess, 600);
      showWinFlash();
    }
  });

  // -----------------------------------------------------------------------
  // AUTOCOMPLETE
  // -----------------------------------------------------------------------

  socket.on('autocompleteResults', renderAutocompleteResults);

  // -----------------------------------------------------------------------
  // CHAT & REACTIONS
  // -----------------------------------------------------------------------

  socket.on('receiveChat', ({ playerName, msg, isSpectator: fromSpectator }) => {
    if (!chatMessages) return;
    const hint = chatMessages.querySelector('.empty-hint');
    if (hint) hint.remove();
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const author = document.createElement('span');
    author.className = 'chat-author';
    author.textContent = playerName + (fromSpectator ? ' \uD83D\uDC41' : '') + ':';
    div.appendChild(author);
    div.appendChild(document.createTextNode(msg));
    const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50;

    chatMessages.appendChild(div);

    if (isNearBottom) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    const chatPanel = document.querySelector('[data-panel="chat"]');
    const isMobileVisible = chatPanel && chatPanel.classList.contains('mobile-visible');
    const isDesktop = window.innerWidth > 767;

    if (!isDesktop && !isMobileVisible) {
      const badgeEl = document.getElementById('chat-badge');
      if (badgeEl) badgeEl.style.display = 'block';
    }
  });

  socket.on('receiveReaction', ({ emoji }) => {
    const board = document.querySelector('.game-board');
    if (!board) return;
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.innerText = emoji;
    const randomX = Math.random() * (board.clientWidth - 40);
    el.style.left = randomX + 'px';
    el.style.bottom = '120px';
    board.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  });

  // -----------------------------------------------------------------------
  // RECONNECTION
  // -----------------------------------------------------------------------

  socket.on('disconnect', (reason) => {
    const banner = document.getElementById('offline-banner');
    if (banner && reason !== 'io client disconnect') {
      banner.classList.remove('hidden');
    }
  });

  socket.on('reconnect', () => {
    const lobbyId = getCurrentLobbyId();
    const playerId = getMyPlayerId();
    if (lobbyId && playerId) {
      socket.emit('rejoinLobby', { lobbyId, playerId });
    } else {
      const banner = document.getElementById('offline-banner');
      if (banner) banner.classList.add('hidden');
    }
  });

  socket.on('rejoinSuccess', (data) => {
    const banner = document.getElementById('offline-banner');
    if (banner) banner.classList.add('hidden');

    onRejoined(data);

    if (data.state.status === 'playing') {
      renderGame(data.state, getMyPlayerId());
    } else {
      renderLobby(data.state, getMyPlayerId());
    }
    showNotification('\u2705 Reconnected to game!');
  });

  socket.on('rejoinFailed', (msg) => {
    showNotification(msg || 'Could not rejoin game');
  });

  return socket;
}

// ---------------------------------------------------------------------------
// LEAVE LOBBY — emits socket event + resets state
// ---------------------------------------------------------------------------

export function leaveLobby() {
  const socket = getSocket();
  if (socket) socket.emit('leaveLobby');
  resetSession();
}
