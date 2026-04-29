// ====================== APP.JS ======================
// Thin entry point — imports everything and wires up the app
import { initUIElements, closeMobileAc, openShareModal } from './ui.js';
import { initSocket, getSocket, getCurrentLobbyId, getGameState } from './socketClient.js';
import { prepareAudio, getStableId } from './utils.js';

// Initialize everything when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize all DOM references FIRST
  initUIElements();
  
  // 2. Start socket connection
  const socket = initSocket();

  // Enable reconnection logging
  console.log('🔌 Reconnection support enabled');
  
  // Small safety delay to ensure DOM is fully ready for background elements
  setTimeout(() => {
    // Request posters on load (in case the server already sent them)
    if (socket) socket.emit('requestPosters');
  }, 300);

  // 3. All event listeners that were at the bottom of the old app.js
  const playerNameInput = document.getElementById('player-name');
  const logo = document.querySelector('.logo');
  const lobbyScreen = document.getElementById('lobby-screen');
  const heroScreen = document.getElementById('hero-screen');
  const gameScreen = document.getElementById('game-screen');
  const waitingRoom = document.getElementById('waiting-room');
  const privatePanel = document.getElementById('private-panel');
  const publicPanel = document.getElementById('public-panel');
  const joinPanel = document.getElementById('join-panel');
  const lobbyIdInput = document.getElementById('lobby-id-input');
  const hardcoreToggle = document.getElementById('hardcore-toggle');
  const tvShowsToggle = document.getElementById('tv-shows-toggle');
  const publicRoomToggle = document.getElementById('public-room-toggle');
  const joinBtn = document.getElementById('join-btn');
  const startBtn = document.getElementById('start-btn');
  const showPublicBtn = document.getElementById('show-public-btn');
  const showPrivateBtn = document.getElementById('show-private-btn');
  const backToJoinBtn = document.getElementById('back-to-join-btn');
  const backToJoinBtn2 = document.getElementById('back-to-join-btn-2');
  const refreshLobbiesBtn = document.getElementById('refresh-lobbies-btn');
  const heroPlayBtn = document.getElementById('hero-play-btn');
  const heroCodeBtn = document.getElementById('hero-code-btn');
  const howToPlayBtn = document.getElementById('how-to-play-btn');
  const creditsBtn = document.getElementById('credits-btn');
  const howToPlayModal = document.getElementById('how-to-play-modal');
  const creditsModal = document.getElementById('credits-modal');
  const closeHowToPlay = document.getElementById('close-how-to-play');
  const closeCredits = document.getElementById('close-credits');
  const leaderboardBtn = document.getElementById('leaderboard-btn');
  const leaderboardModal = document.getElementById('leaderboard-modal');
  const closeLeaderboard = document.getElementById('close-leaderboard');
  const leaderboardList = document.getElementById('leaderboard-list');
  const submitBtn = document.getElementById('submit-btn');
  const movieInput = document.getElementById('movie-input');
  const autocompleteContainer = document.getElementById('autocomplete-container');
  const chatInput = document.getElementById('chat-input');
  const modeChips = document.querySelectorAll('.mode-chip');
  const joinRedBtn = document.getElementById('join-red-btn');
  const joinBlueBtn = document.getElementById('join-blue-btn');
  const teamBackBtn = document.getElementById('team-back-btn');
  const teamStartBtn = document.getElementById('team-start-btn');
  const teamScreen = document.getElementById('team-screen');
  const downloadCardBtn = document.getElementById('download-card-btn');
  const copyCardBtn = document.getElementById('copy-card-btn');
  const shareCanvas = document.getElementById('share-canvas');
  const shareModal = document.getElementById('share-modal');

  logo.addEventListener('click', () => {
    const currentLobbyId = getCurrentLobbyId();
    if (currentLobbyId) {
      socket.emit('leaveLobby');
    }
    gameScreen.classList.remove('active');
    lobbyScreen.classList.remove('active');
    heroScreen.classList.add('active');
    waitingRoom.classList.add('hidden');
    if(privatePanel) privatePanel.classList.add('hidden');
    if(publicPanel) publicPanel.classList.add('hidden');
    if(joinPanel) joinPanel.classList.remove('hidden');
  });

  const savedName = localStorage.getItem('mm_playerName');
  if (savedName && playerNameInput) playerNameInput.value = savedName;
  if (playerNameInput) {
      playerNameInput.addEventListener('input', () => {
          localStorage.setItem('mm_playerName', playerNameInput.value.trim());
      });
  }

  function checkName() {
      const name = playerNameInput ? playerNameInput.value.trim() : '';
      if (!name) {
          alert('Enter a name first!');
          return false;
      }
      return true;
  }

  showPrivateBtn?.addEventListener('click', () => {
      if (!checkName()) return;
      prepareAudio();
      joinPanel.classList.add('hidden');
      privatePanel.classList.remove('hidden');
  });

  showPublicBtn?.addEventListener('click', () => {
      if (!checkName()) return;
      prepareAudio();
      joinPanel.classList.add('hidden');
      publicPanel.classList.remove('hidden');
      socket.emit('requestPublicLobbies');
  });

  backToJoinBtn?.addEventListener('click', () => {
      privatePanel.classList.add('hidden');
      joinPanel.classList.remove('hidden');
  });

  backToJoinBtn2?.addEventListener('click', () => {
      publicPanel.classList.add('hidden');
      joinPanel.classList.remove('hidden');
  });

  refreshLobbiesBtn?.addEventListener('click', () => {
      const publicLobbiesList = document.getElementById('public-lobbies-list');
      if (publicLobbiesList) publicLobbiesList.innerHTML = '<div class="empty-hint" style="text-align:center; padding: 2rem; color: var(--text-muted); font-style:italic;">Loading lobbies...</div>';
      socket.emit('requestPublicLobbies');
  });

  joinBtn?.addEventListener('click', () => {
      const name = playerNameInput.value.trim();
      localStorage.setItem('mm_playerName', name);
      socket.emit('joinLobby', { 
          name, 
          lobbyId: lobbyIdInput.value.trim(),
          stableId: getStableId()
      });

      // Hide private room modal immediately
      const privatePanel = document.getElementById('private-panel');
      if (privatePanel) privatePanel.classList.add('hidden');
  });

  startBtn?.addEventListener('click', () => {
      socket.emit('startLobby', getCurrentLobbyId());
  });

  heroPlayBtn?.addEventListener('click', () => {
      heroScreen.classList.remove('active');
      lobbyScreen.classList.add('active');
      prepareAudio();
  });

  heroCodeBtn?.addEventListener('click', () => {
      heroScreen.classList.remove('active');
      lobbyScreen.classList.add('active');
      joinPanel.classList.add('hidden');
      privatePanel.classList.remove('hidden');
      lobbyIdInput.focus();
      prepareAudio();
  });

  function checkUrlParams() {
      const params = new URLSearchParams(window.location.search);
      const roomId = params.get('room') || params.get('lobby');
      if (roomId) {
          if (lobbyIdInput) lobbyIdInput.value = roomId.toUpperCase();
          heroScreen.classList.remove('active');
          lobbyScreen.classList.add('active');
          joinPanel.classList.add('hidden');
          privatePanel.classList.remove('hidden');
      }
  }
  checkUrlParams();

  const heroDemo = document.querySelector('.hero-demo');
  if (heroDemo) {
      setTimeout(() => {
          heroDemo.classList.add('animate-demo');
      }, 500);
  }

  modeChips.forEach(chip => {
      chip.addEventListener('click', () => {
          const mode = chip.dataset.mode;
          socket.emit('setGameMode', { lobbyId: getCurrentLobbyId(), mode });
      });
  });

  joinRedBtn?.addEventListener('click', () => {
      socket.emit('assignTeam', { lobbyId: getCurrentLobbyId(), teamId: 0 });
  });
  joinBlueBtn?.addEventListener('click', () => {
      socket.emit('assignTeam', { lobbyId: getCurrentLobbyId(), teamId: 1 });
  });
  teamBackBtn?.addEventListener('click', () => {
      teamScreen.classList.add('hidden');
      waitingRoom.classList.remove('hidden');
  });
  teamStartBtn?.addEventListener('click', () => {
      socket.emit('startLobby', getCurrentLobbyId());
  });

  hardcoreToggle?.addEventListener('change', (e) => {
      socket.emit('toggleHardcore', { lobbyId: getCurrentLobbyId(), state: e.target.checked });
  });

  if(publicRoomToggle) {
      publicRoomToggle.addEventListener('change', (e) => {
          socket.emit('togglePublic', { lobbyId: getCurrentLobbyId(), state: e.target.checked });
      });
  }

  tvShowsToggle?.addEventListener('change', (e) => {
      socket.emit('toggleTvShows', { lobbyId: getCurrentLobbyId(), state: e.target.checked });
  });

  let debounceTimeout = null;

  let currentSelectedMovie = null;

  function submitMovie() {
    const movie = movieInput ? movieInput.value.trim() : '';
    if (!movie) return;

    console.log('🎬 Manual submitMovie called with:', { movie, currentSelectedMovie });

    if (autocompleteContainer) autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
    closeMobileAc();

    const socket = getSocket();
    const lobbyId = getCurrentLobbyId();

    if (currentSelectedMovie && currentSelectedMovie.title.toLowerCase() === movie.toLowerCase()) {
      console.log('🎬 Using selected movie ID:', currentSelectedMovie);
      socket.emit('submitMovie', {
        lobbyId,
        movie,
        tmdbId: currentSelectedMovie.id,
        mediaType: currentSelectedMovie.mediaType
      });
    } else {
      console.log('🎬 No selected movie ID - sending title only');
      socket.emit('submitMovie', { lobbyId, movie });
    }

    currentSelectedMovie = null;
    if (movieInput) movieInput.value = '';
  }

  submitBtn?.addEventListener('click', submitMovie);
  movieInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitMovie();
  });

  movieInput?.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (query.length < 2) {
          if (autocompleteContainer) autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
          closeMobileAc();
          return;
      }
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
          socket.emit('autocompleteSearch', { query, lobbyId: getCurrentLobbyId() });
      }, 400);
  });

  chatInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
          const msg = chatInput.value.trim();
          if (msg) {
              socket.emit('sendChat', { lobbyId: getCurrentLobbyId(), msg });
              chatInput.value = '';
          }
      }
  });

  const reactionBtns = document.querySelectorAll('.reaction-btn');
  reactionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
          const lobbyId = getCurrentLobbyId();
          if (!lobbyId) return;
          socket.emit('sendReaction', { lobbyId, emoji: btn.innerText });
          btn.style.transform = 'scale(0.8)';
          setTimeout(() => btn.style.transform = '', 100);
      });
  });

    howToPlayBtn?.addEventListener('click', () => howToPlayModal?.classList.remove('hidden'));
  creditsBtn?.addEventListener('click', () => creditsModal?.classList.remove('hidden'));
  closeHowToPlay?.addEventListener('click', () => howToPlayModal?.classList.add('hidden'));
  closeCredits?.addEventListener('click', () => creditsModal?.classList.add('hidden'));
  howToPlayModal?.addEventListener('click', (e) => { if (e.target === howToPlayModal) howToPlayModal.classList.add('hidden'); });
  creditsModal?.addEventListener('click', (e) => { if (e.target === creditsModal) creditsModal.classList.add('hidden'); });

  async function loadLeaderboard() {
    leaderboardModal.classList.remove('hidden');
    leaderboardList.innerHTML = '';
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'empty-hint';
    loadingDiv.style.cssText = 'text-align:center;padding:2rem;color:var(--text-muted);';
    loadingDiv.textContent = 'Loading...';
    leaderboardList.appendChild(loadingDiv);
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      leaderboardList.innerHTML = '';
      if (!data.length) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-hint';
        emptyDiv.style.cssText = 'text-align:center;padding:2rem;color:var(--text-muted);font-style:italic;';
        emptyDiv.textContent = 'No wins recorded yet. Play a game!';
        leaderboardList.appendChild(emptyDiv);
        return;
      }
      data.forEach((entry, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;padding:0.75rem 1rem;border-bottom:1px solid rgba(255,255,255,0.06);';
        const rank = document.createElement('span');
        rank.style.cssText = 'width:2.5rem;font-size:1.1rem;text-align:center;flex-shrink:0;';
        rank.textContent = i === 0 ? '\uD83E\uDD47' : i === 1 ? '\uD83E\uDD48' : i === 2 ? '\uD83E\uDD49' : '#' + (i + 1);
        const name = document.createElement('span');
        name.style.cssText = 'flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        name.textContent = entry.name;
        const wins = document.createElement('span');
        wins.style.cssText = 'color:var(--text-muted,#94a3b8);font-size:0.9rem;flex-shrink:0;margin-left:0.5rem;';
        wins.textContent = entry.wins + ' \uD83C\uDFC6';
        row.appendChild(rank);
        row.appendChild(name);
        row.appendChild(wins);
        leaderboardList.appendChild(row);
      });
    } catch (err) {
      leaderboardList.innerHTML = '';
      const errorDiv = document.createElement('div');
      errorDiv.className = 'empty-hint';
      errorDiv.style.cssText = 'text-align:center;padding:2rem;color:var(--text-muted);';
      errorDiv.textContent = 'Failed to load leaderboard.';
      leaderboardList.appendChild(errorDiv);
    }
  }

  leaderboardBtn?.addEventListener('click', loadLeaderboard);
  closeLeaderboard?.addEventListener('click', () => leaderboardModal?.classList.add('hidden'));
  leaderboardModal?.addEventListener('click', (e) => { if (e.target === leaderboardModal) leaderboardModal.classList.add('hidden'); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
          howToPlayModal?.classList.add('hidden');
          creditsModal?.classList.add('hidden');
          leaderboardModal?.classList.add('hidden');
      }
  });

  const mobileTabs = document.getElementById('mobile-tabs');
  const gameBoardEl = document.querySelector('.game-board');
  const playersPanel = document.querySelector('[data-panel="players"]');
  const chatPanel = document.querySelector('[data-panel="chat"]');

  if (mobileTabs) {
      mobileTabs.addEventListener('click', (e) => {
          const btn = e.target.closest('.mobile-tab');
          if (!btn) return;
          const tab = btn.dataset.tab;

          document.querySelectorAll('.mobile-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          if (gameBoardEl) gameBoardEl.classList.remove('mobile-hidden');
          if (playersPanel) playersPanel.classList.remove('mobile-visible');
          if (chatPanel) chatPanel.classList.remove('mobile-visible');

          if (tab === 'players') {
              if (gameBoardEl) gameBoardEl.classList.add('mobile-hidden');
              if (playersPanel) playersPanel.classList.add('mobile-visible');
          } else if (tab === 'chat') {
              if (gameBoardEl) gameBoardEl.classList.add('mobile-hidden');
              if (chatPanel) chatPanel.classList.add('mobile-visible');
          }
      });
  }

  document.body.addEventListener('click', (e) => {
      const shareBtn = e.target.closest('#share-results-btn');
      const playAgainBtn = e.target.closest('#play-again-btn');
      if (shareBtn) {
          openShareModal(getGameState());
      }
      if (playAgainBtn) {
          socket.emit('restartLobby', getCurrentLobbyId());
      }
  });

  function showToast(msg) {
      const toast = document.querySelector('.copy-toast') || document.createElement('div');
      toast.className = 'copy-toast';
      toast.textContent = msg;
      if (!toast.parentElement) document.body.appendChild(toast);
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), 2500);
  }

  downloadCardBtn?.addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = `moviematch-chain-${Date.now()}.png`;
      link.href = shareCanvas.toDataURL('image/png');
      link.click();
      showToast('Downloaded! 🎬');
  });

  copyCardBtn?.addEventListener('click', async () => {
      try {
          const blob = await new Promise(res => shareCanvas.toBlob(res, 'image/png'));
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          showToast('Image copied to clipboard! 📋');
      } catch {
          // Fallback
          const text = buildTextRecap(getGameState());
          navigator.clipboard.writeText(text).catch(() => {});
          showToast('Image unavailable — text recap copied! ✓');
      }
  });

  function buildTextRecap(state) {
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

  console.log('🎬 MovieMatch frontend initialized (modular version)');
});
