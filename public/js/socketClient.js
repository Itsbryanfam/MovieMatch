// ====================== SOCKETCLIENT.JS ======================
import { 
  initUIElements, renderLobby, renderGame, renderTeamScreen, 
  showNotification, renderAutocompleteResults, closeMobileAc,
  openShareModal, showGameOverBanner, resetMobileTab,
  // DOM elements
  publicLobbiesList, posterCarousel, lobbyScreen, gameScreen,
  waitingRoom, lobbyCodeDisplay, notificationOverlay, notificationText,
  chatMessages
} from './ui.js';

import { prepareAudio, playSuccess, playFail, playTick, escapeHtml, getStableId } from './utils.js';

let socket;
let currentLobbyId = null;
let myPlayerId = null;
let gameState = null;
let turnInterval = null;
let lastTickSound = 0;
let isSpectator = false;

export function initSocket() {
  socket = io({
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  // === ALL SOCKET LISTENERS ===
  socket.on('joined', (data) => {
    currentLobbyId = data.lobbyId;
    myPlayerId = data.playerId;
    isSpectator = data.isSpectator || false;
    // Hide join screens and show waiting room
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
    if (isSpectator) {
      // Go straight to game screen — stateUpdate will render spectator view
      if (lobbyScreenEl) lobbyScreenEl.classList.remove('active');
      const gameScreenEl = document.getElementById('game-screen');
      if (gameScreenEl) gameScreenEl.classList.add('active');
    } else {
      if (waitingRoomEl) waitingRoomEl.classList.remove('hidden');
      if (lobbyScreenEl) lobbyScreenEl.classList.add('active');
    }
    if (lobbyCodeDisplay) lobbyCodeDisplay.innerText = currentLobbyId;
  });

  socket.on('error', (msg) => showNotification(msg));

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
        
        let tagsHTML = '';
        if (lobby.hardcoreMode) tagsHTML += '<span class="mode-tag">Hardcore</span> ';
        if (lobby.allowTvShows) tagsHTML += '<span class="mode-tag">TV Shows</span>';
        
        card.innerHTML = `
            <div class="public-lobby-info">
                <h3>${escapeHtml(lobby.hostName)}'s Lobby</h3>
                <div class="public-lobby-stats">
                    <span>👥 ${lobby.playerCount} / 8</span>
                    ${tagsHTML ? `<div>${tagsHTML}</div>` : ''}
                </div>
            </div>
            <button class="btn-primary join-public-btn" style="padding: 0.5rem 1rem; width: auto;" data-id="${lobby.id}">Join</button>
        `;
        
        const joinButton = card.querySelector('.join-public-btn');
        joinButton.addEventListener('click', () => {
            const name = playerNameInput ? playerNameInput.value.trim() : '';
            if (!name) return;
            socket.emit('joinLobby', { name, lobbyId: lobby.id, stableId: getStableId() });
        });
        
        publicLobbiesList.appendChild(card);
    });
  });

  socket.on('posters', (posters) => {
    // Try exported reference first, then fallback to direct DOM lookup
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

  socket.on('stateUpdate', (state) => {
    gameState = state;
    // Detect spectator promotion
    if (isSpectator && state.status === 'waiting' && state.players && state.players.find(p => p.id === myPlayerId)) {
      isSpectator = false;
      showNotification('🎮 You\'ve joined the game!');
    }
    if (state.status === 'playing') {
      if (lobbyScreen) lobbyScreen.classList.remove('active');
      if (gameScreen) gameScreen.classList.add('active');
      resetMobileTab();
      renderGame(state, myPlayerId, isSpectator);
      
      if (turnInterval) clearInterval(turnInterval);
      turnInterval = setInterval(() => {
        const timerBar = document.getElementById('timer-bar');
        const timeText = document.getElementById('time-text');
        if (!gameState || !gameState.turnExpiresAt || gameState.status !== 'playing') {
            clearInterval(turnInterval);
            return;
        }
        
        const ms = gameState.turnExpiresAt - Date.now();
        let tr = Math.max(0, Math.ceil(ms / 1000));
        
        if (timeText) timeText.innerText = tr + 's';
        const percentage = (tr / 60) * 100;
        if (timerBar) {
            timerBar.style.width = Math.max(0, Math.min(percentage, 100)) + '%';
            
            if (tr <= 10) {
                timerBar.style.backgroundColor = 'var(--timer-red)';
                if (tr > 0 && Math.floor(Date.now() / 1000) > lastTickSound) {
                   playTick();
                   lastTickSound = Math.floor(Date.now() / 1000);
                 }
            } else if (tr <= 30) {
                timerBar.style.backgroundColor = 'var(--timer-yellow)';
            } else {
                timerBar.style.backgroundColor = 'var(--timer-green)';
            }
        }
        
        if (tr === 0) {
            socket.emit('forceNextTurn', currentLobbyId);
            clearInterval(turnInterval);
        }
      }, 1000);
    } else if (state.status === 'waiting') {
      if (turnInterval) clearInterval(turnInterval);
      if (gameScreen) gameScreen.classList.remove('active');
      if (lobbyScreen) lobbyScreen.classList.add('active');
      renderLobby(state, myPlayerId);
    } else if (state.status === 'finished') {
      if (turnInterval) clearInterval(turnInterval);
      renderGame(state, myPlayerId, isSpectator);
    }
  });

  socket.on('notification', (msg) => {
    showNotification(msg);
    if (msg.includes('eliminated')) {
      playFail();
      const board = document.querySelector('.board');
      if (board) {
        board.classList.add('shake');
        setTimeout(() => board.classList.remove('shake'), 500);
      }
    } else if (msg.includes('wins')) {
      playSuccess();
      setTimeout(playSuccess, 300);
      setTimeout(playSuccess, 600);
    }
  });

  socket.on('autocompleteResults', renderAutocompleteResults);

  socket.on('receiveChat', ({ playerName, msg, isSpectator: fromSpectator }) => {
    if (!chatMessages) return;
    const hint = chatMessages.querySelector('.empty-hint');
    if (hint) hint.remove();
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const badge = fromSpectator ? ' 👁' : '';
    div.innerHTML = `<span class="chat-author">${escapeHtml(playerName)}${badge}:</span>${escapeHtml(msg)}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
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

  // === RECONNECTION HANDLING ===
  socket.on('reconnect', () => {
    console.log('🔄 Reconnected to server');
    const lobbyId = getCurrentLobbyId();
    const playerId = getMyPlayerId();
    if (lobbyId && playerId) {
      console.log(`🔄 Attempting to rejoin lobby ${lobbyId}`);
      socket.emit('rejoinLobby', { lobbyId, playerId });
    }
  });

  socket.on('rejoinSuccess', (data) => {
    console.log('✅ Rejoined lobby successfully', data);
    currentLobbyId = data.lobbyId;
    myPlayerId = data.playerId;
    gameState = data.state;

    if (data.state.status === 'playing') {
      renderGame(data.state, myPlayerId);
    } else {
      renderLobby(data.state, myPlayerId);
    }
    showNotification('✅ Reconnected to game!');
  });

  socket.on('rejoinFailed', (msg) => {
    console.warn('❌ Rejoin failed:', msg);
    showNotification(msg || 'Could not rejoin game');
  });

  return socket;
}

export function leaveLobby() {
  if (turnInterval) {
    clearInterval(turnInterval);
    turnInterval = null;
  }
  if (socket) socket.emit('leaveLobby');
  currentLobbyId = null;
  myPlayerId = null;
  gameState = null;
  isSpectator = false;
}

export function getSocket() { return socket; }
export function getCurrentLobbyId() { return currentLobbyId; }
export function getMyPlayerId() { return myPlayerId; }
export function getGameState() { return gameState; }
export function getIsSpectator() { return isSpectator; }
