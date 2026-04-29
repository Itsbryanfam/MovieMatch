// ====================== APP.JS ======================
// Thin entry point — imports everything and wires up the app
import { 
  initUIElements, closeMobileAc, openShareModal, showNotification, showToast,
  playerNameInput, logo, lobbyScreen, heroScreen, gameScreen, waitingRoom,
  privatePanel, publicPanel, joinPanel, lobbyIdInput, hardcoreToggle,
  tvShowsToggle, publicRoomToggle, joinBtn, startBtn, showPublicBtn,
  showPrivateBtn, backToJoinBtn, backToJoinBtn2, refreshLobbiesBtn,
  heroPlayBtn, heroCodeBtn, howToPlayBtn, creditsBtn, howToPlayModal,
  creditsModal, closeHowToPlay, closeCredits, leaderboardBtn,
  leaderboardModal, closeLeaderboard, leaderboardList, submitBtn,
  movieInput, autocompleteContainer, chatInput, modeChips, joinRedBtn,
  joinBlueBtn, teamBackBtn, teamStartBtn, teamScreen, downloadCardBtn,
  copyCardBtn, shareCanvas, shareModal
} from './ui.js';
import { initSocket, getSocket, getCurrentLobbyId, getGameState, leaveLobby } from './socketClient.js';
import { prepareAudio, getStableId, unlockAudioGlobally } from './utils.js';

// Initialize everything when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize all DOM references FIRST
  initUIElements();
  
  // 2. Start socket connection
  const socket = initSocket();

  // Ensure audio works even if user auto-joins via URL params
  unlockAudioGlobally();

  // Enable reconnection logging
  console.log('🔌 Reconnection support enabled');
  
  // Small safety delay to ensure DOM is fully ready for background elements
  setTimeout(() => {
    // Request posters on load (in case the server already sent them)
    if (socket) socket.emit('requestPosters');
  }, 300);

  // 3. All event listeners that were at the bottom of the old app.js

  logo.addEventListener('click', () => {
    const currentLobbyId = getCurrentLobbyId();
    if (currentLobbyId) {
      leaveLobby();
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
          showNotification('Enter a name first!');
          return false;
      }
      return true;
  }

  showPrivateBtn?.addEventListener('click', () => {
      if (!checkName()) return;
      joinPanel.classList.add('hidden');
      privatePanel.classList.remove('hidden');
  });

  showPublicBtn?.addEventListener('click', () => {
      if (!checkName()) return;
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

  function handleJoinRoomSubmit() {
      const name = playerNameInput ? playerNameInput.value.trim() : '';
      if (!name) {
          showNotification('Enter a name first!');
          if (privatePanel) privatePanel.classList.add('hidden');
          if (joinPanel) joinPanel.classList.remove('hidden');
          if (playerNameInput) playerNameInput.focus();
          return;
      }
      localStorage.setItem('mm_playerName', name);
      getSocket().emit('joinLobby', { 
          name, 
          lobbyId: lobbyIdInput ? lobbyIdInput.value.trim() : '',
          stableId: getStableId()
      });

      if (privatePanel) privatePanel.classList.add('hidden');
  }

  joinBtn?.addEventListener('click', handleJoinRoomSubmit);
  
  lobbyIdInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleJoinRoomSubmit();
  });
  
  playerNameInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
          // If private panel is visible, submit. Otherwise, just save name.
          if (privatePanel && !privatePanel.classList.contains('hidden')) {
              handleJoinRoomSubmit();
          } else if (lobbyIdInput && !privatePanel.classList.contains('hidden') === false) {
              // Optionally auto-transition to next screen here if desired in the future
          }
      }
  });

  startBtn?.addEventListener('click', () => {
      socket.emit('startLobby', getCurrentLobbyId());
  });

  heroPlayBtn?.addEventListener('click', () => {
      heroScreen.classList.remove('active');
      lobbyScreen.classList.add('active');
  });

  heroCodeBtn?.addEventListener('click', () => showJoinPrompt());

  function showNamePrompt(roomCode) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:1000;';

    const card = document.createElement('div');
    card.style.cssText = 'background:var(--surface,#18181b);border-radius:1rem;padding:2rem;max-width:340px;width:90%;text-align:center;border:1px solid rgba(255,255,255,0.08);';

    const title = document.createElement('h2');
    title.style.cssText = 'margin:0 0 0.25rem;font-size:1.25rem;color:var(--text,#f8fafc);';
    title.textContent = 'Join Game';

    const subtitle = document.createElement('p');
    subtitle.style.cssText = 'margin:0 0 1.5rem;color:var(--text-muted,#94a3b8);font-size:0.9rem;';
    subtitle.textContent = 'Room ' + roomCode;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter your name';
    input.autocomplete = 'off';
    input.maxLength = 24;
    input.style.cssText = 'width:100%;padding:0.75rem 1rem;border-radius:0.5rem;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text,#f8fafc);font-size:1rem;box-sizing:border-box;margin-bottom:1rem;outline:none;font-family:inherit;';

    const btn = document.createElement('button');
    btn.textContent = 'Join Game';
    btn.style.cssText = 'width:100%;padding:0.75rem;border-radius:0.5rem;border:none;background:var(--accent,#818cf8);color:white;font-size:1rem;font-weight:600;cursor:pointer;font-family:inherit;';

    function submit() {
      const name = input.value.trim();
      if (!name) {
        input.style.borderColor = '#f87171';
        input.focus();
        return;
      }
      localStorage.setItem('mm_playerName', name);
      if (playerNameInput) playerNameInput.value = name;
      overlay.remove();
      heroScreen.classList.remove('active');
      lobbyScreen.classList.add('active');
      socket.emit('joinLobby', { name, lobbyId: roomCode, stableId: getStableId() });
      window.history.replaceState({}, '', window.location.pathname);
    }

    btn.addEventListener('click', submit);
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') submit(); });

    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(input);
    card.appendChild(btn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 100);
  }

  function showJoinPrompt() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:1000;';

    const card = document.createElement('div');
    card.style.cssText = 'background:var(--surface,#18181b);border-radius:1rem;padding:2rem;max-width:340px;width:90%;text-align:center;border:1px solid rgba(255,255,255,0.08);';

    const title = document.createElement('h2');
    title.style.cssText = 'margin:0 0 1.5rem;font-size:1.25rem;color:var(--text,#f8fafc);';
    title.textContent = 'Join a Room';

    const lblStyle = 'display:block;text-align:left;font-size:0.8rem;font-weight:600;color:var(--text-muted,#94a3b8);margin-bottom:0.35rem;letter-spacing:0.03em;';
    const inpStyle = 'width:100%;padding:0.75rem 1rem;border-radius:0.5rem;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text,#f8fafc);font-size:1rem;box-sizing:border-box;outline:none;font-family:inherit;';

    const nameLabel = document.createElement('label');
    nameLabel.style.cssText = lblStyle;
    nameLabel.textContent = 'Your Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Enter your name';
    nameInput.autocomplete = 'off';
    nameInput.maxLength = 24;
    nameInput.value = localStorage.getItem('mm_playerName') || '';
    nameInput.style.cssText = inpStyle + 'margin-bottom:1rem;';

    const codeLabel = document.createElement('label');
    codeLabel.style.cssText = lblStyle;
    codeLabel.textContent = 'Room Code';
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.placeholder = 'Leave blank to create new';
    codeInput.autocomplete = 'off';
    codeInput.maxLength = 6;
    codeInput.style.cssText = inpStyle + 'margin-bottom:1.5rem;text-transform:uppercase;';

    const btn = document.createElement('button');
    btn.textContent = 'Join Game';
    btn.style.cssText = 'width:100%;padding:0.75rem;border-radius:0.5rem;border:none;background:var(--accent,#818cf8);color:white;font-size:1rem;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:0.75rem;';

    const backBtn = document.createElement('button');
    backBtn.textContent = 'Back';
    backBtn.style.cssText = 'width:100%;padding:0.75rem;border-radius:0.5rem;border:1px solid rgba(255,255,255,0.1);background:transparent;color:var(--text-muted,#94a3b8);font-size:0.9rem;cursor:pointer;font-family:inherit;';

    function close() { overlay.remove(); }

    function submit() {
      const name = nameInput.value.trim();
      const code = codeInput.value.trim().toUpperCase();
      if (!name) { nameInput.style.borderColor = '#f87171'; nameInput.focus(); return; }
      localStorage.setItem('mm_playerName', name);
      if (playerNameInput) playerNameInput.value = name;
      overlay.remove();
      prepareAudio();
      heroScreen.classList.remove('active');
      lobbyScreen.classList.add('active');
      socket.emit('joinLobby', { name, lobbyId: code, stableId: getStableId() });
    }

    btn.addEventListener('click', submit);
    backBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    codeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') submit(); });
    nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') codeInput.focus(); });

    card.appendChild(title);
    card.appendChild(nameLabel);
    card.appendChild(nameInput);
    card.appendChild(codeLabel);
    card.appendChild(codeInput);
    card.appendChild(btn);
    card.appendChild(backBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    setTimeout(() => { (nameInput.value ? codeInput : nameInput).focus(); }, 100);
  }

  function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room') || params.get('lobby');
    if (!roomId) return;

    const code = roomId.toUpperCase();
    const savedName = localStorage.getItem('mm_playerName');

    if (savedName) {
      if (playerNameInput) playerNameInput.value = savedName;
      heroScreen.classList.remove('active');
      lobbyScreen.classList.add('active');
      socket.emit('joinLobby', { name: savedName, lobbyId: code, stableId: getStableId() });
      window.history.replaceState({}, '', window.location.pathname);
    } else {
      showNamePrompt(code);
    }
  }
  checkUrlParams();

  // Click lobby code to copy invite link
  function setupCodeCopy(element) {
    if (!element) return;
    element.style.cursor = 'pointer';
    element.title = 'Click to copy invite link';
    element.addEventListener('click', () => {
      const code = element.innerText.trim();
      if (!code) return;
      const url = window.location.origin + '?room=' + code;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Invite link copied! 🔗');
      }).catch(() => {
        navigator.clipboard.writeText(code).catch(() => {});
        showToast('Room code copied!');
      });
    });
  }

  setupCodeCopy(document.getElementById('lobby-code-display'));
  setupCodeCopy(document.getElementById('team-lobby-code'));

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

  function submitMovie() {
    const movie = movieInput ? movieInput.value.trim() : '';
    if (!movie) return;

    if (autocompleteContainer) autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
    closeMobileAc();

    getSocket().emit('submitMovie', { lobbyId: getCurrentLobbyId(), movie });

    if (movieInput) {
      movieInput.value = '';
      movieInput.disabled = true;
    }
    if (submitBtn) submitBtn.disabled = true;
    if (hintText) hintText.innerText = 'Validating connection...';
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

  const chatSendBtn = document.getElementById('chat-send-btn');
  
  function handleChatSend() {
      const msg = chatInput ? chatInput.value.trim() : '';
      if (msg) {
          getSocket().emit('sendChat', { lobbyId: getCurrentLobbyId(), msg });
          if (chatInput) chatInput.value = '';
      }
  }
  
  chatSendBtn?.addEventListener('click', handleChatSend);
  chatInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleChatSend();
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
  // Unified Modal Management (Handles all Modals)
  document.body.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
          e.target.classList.add('hidden');
      }
      if (e.target.closest('.modal-close')) {
          const overlay = e.target.closest('.modal-overlay');
          if (overlay) overlay.classList.add('hidden');
      }
  });

  document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
          document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(modal => modal.classList.add('hidden'));
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
              const badge = document.getElementById('chat-badge');
              if (badge) badge.style.display = 'none';
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

  // Premium Ambient Parallax Effect
  const bgCarousel = document.getElementById('poster-carousel');
  if (bgCarousel) {
      document.addEventListener('mousemove', (e) => {
          // Disable on mobile/tablets where accelerometer makes more sense than cursor tracking
          if (window.innerWidth <= 767) return; 
          
          // Calculate subtle offset (max 20px shift to avoid motion sickness)
          const xShift = (e.clientX / window.innerWidth - 0.5) * -30; 
          const yShift = (e.clientY / window.innerHeight - 0.5) * -30;
          
          // Combine original rotation with dynamic translation
          bgCarousel.style.transform = `rotate(-6deg) translate(${xShift}px, ${yShift}px)`;
      });
  }

  console.log('🎬 MovieMatch frontend initialized (modular version)');
});
