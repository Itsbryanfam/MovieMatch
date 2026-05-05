// ============================================================================
// APP.JS — Entry point + input wiring
// ============================================================================
// This file is the INPUT layer. It handles:
//   - DOM event binding (buttons, inputs, keyboard shortcuts)
//   - Screen transitions
//   - Modal management
//   - Join/name prompt overlays
//   - Share card actions
//   - Parallax effect
//
// No state ownership — reads through state.js.
// No socket events — delegates server communication to socketClient.js.
// ============================================================================

import {
  initUIElements, closeMobileAc, openShareModal, showNotification, showToast,
  buildTextRecap,
  playerNameInput, logo, lobbyScreen, heroScreen, gameScreen, waitingRoom,
  privatePanel, publicPanel, joinPanel, lobbyIdInput, hardcoreToggle,
  tvShowsToggle, publicRoomToggle, joinBtn, startBtn, showPublicBtn,
  showPrivateBtn, backToJoinBtn, backToJoinBtn2, refreshLobbiesBtn,
  heroPlayBtn, heroCodeBtn, heroDailyBtn, howToPlayBtn, creditsBtn, howToPlayModal,
  creditsModal, closeHowToPlay, closeCredits, leaderboardBtn,
  leaderboardModal, closeLeaderboard, leaderboardList, submitBtn,
  movieInput, autocompleteContainer, chatInput, modeChips, joinRedBtn,
  joinBlueBtn, teamBackBtn, teamStartBtn, teamScreen, downloadCardBtn,
  copyCardBtn, shareCanvas, shareModal
} from './ui.js';

import { initSocket, leaveLobby } from './socketClient.js';
import { getSocket, getCurrentLobbyId, getGameState } from './state.js';
import { prepareAudio, getStableId, unlockAudioGlobally, isMuted, toggleMute, prefersReducedMotion } from './utils.js';

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize all DOM references
  initUIElements();

  // 2. Start socket connection (registers all server event listeners)
  const socket = initSocket();

  // 3. Unlock audio for browsers that require user interaction
  unlockAudioGlobally();

  // =========================================================================
  // MUTE BUTTON
  // =========================================================================

  const muteBtn = document.getElementById('mute-btn');
  if (muteBtn) {
    muteBtn.textContent = isMuted() ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', isMuted());
    // aria-pressed communicates the toggle state to screen readers. Keeping
    // the aria-label static ("Toggle sound") makes the announcement consistent —
    // "Toggle sound, pressed" vs "Toggle sound, not pressed" — instead of
    // changing the button's name on each click.
    muteBtn.setAttribute('aria-pressed', String(isMuted()));
    muteBtn.addEventListener('click', () => {
      const nowMuted = toggleMute();
      muteBtn.textContent = nowMuted ? '🔇' : '🔊';
      muteBtn.classList.toggle('muted', nowMuted);
      muteBtn.setAttribute('aria-pressed', String(nowMuted));
    });
  }

  // =========================================================================
  // IN-GAME INVITE BUTTON
  // =========================================================================

  const gameInviteBtn = document.getElementById('game-invite-btn');
  gameInviteBtn?.addEventListener('click', () => {
    const code = getCurrentLobbyId();
    if (!code) return;
    const url = window.location.origin + '?room=' + code;
    navigator.clipboard.writeText(url)
      .then(() => showToast('Invite link copied! 🔗'))
      .catch(() => showToast('Room code: ' + code));
  });

  // =========================================================================
  // DAILY CHALLENGE BUTTON (H2)
  // =========================================================================
  // Single-click entry point. Server checks attempt-NX; if the player has
  // already played today, server emits dailyAlreadyPlayed and the result
  // modal opens with their prior score + leaderboard. Otherwise it creates
  // an ephemeral daily lobby with the seed pre-populated as chain[0] and
  // the player joins via the standard 'joined' event flow.
  heroDailyBtn?.addEventListener('click', () => {
    const name = playerNameInput ? playerNameInput.value.trim() : '';
    if (!name) {
      showNotification('Enter a name first to track your Daily score!');
      // Scroll the name input into view + focus it so the player can fix
      // the gap immediately. Skipped on mobile to avoid summoning the
      // keyboard before the player has time to read the message.
      if (window.innerWidth > 767) playerNameInput?.focus();
      return;
    }
    // Persist the name (same pattern as the existing join flow) so a
    // refresh after a daily run still shows the player's name on their
    // future daily attempts and on the daily leaderboard.
    localStorage.setItem('mm_playerName', name);
    getSocket().emit('startDailyChallenge', {
      name,
      stableId: getStableId(),
    });
  });

  // =========================================================================
  // QUIT GAME BUTTON (M7)
  // =========================================================================
  // Confirm dialog before emitting — quitting mid-game is irreversible and
  // a misclick (especially on mobile, where the icon is small) shouldn't
  // end someone's run. The server is authoritative; we just send the intent.

  const quitGameBtn = document.getElementById('quit-game-btn');
  quitGameBtn?.addEventListener('click', () => {
    const lobbyId = getCurrentLobbyId();
    if (!lobbyId) return;
    // window.confirm is intentionally synchronous + native — it's blocking,
    // simple, and ships with screen-reader support out of the box. A custom
    // modal would be nicer visually but adds focus-management complexity for
    // a low-frequency action.
    const ok = window.confirm('Quit the game? You’ll be eliminated immediately.');
    if (!ok) return;
    getSocket().emit('quitGame', lobbyId);
  });

  // 4. Request background posters
  setTimeout(() => {
    if (socket) socket.emit('requestPosters');
  }, 300);

  // =========================================================================
  // NAVIGATION
  // =========================================================================

  logo.addEventListener('click', () => {
    if (getCurrentLobbyId()) leaveLobby();
    gameScreen.classList.remove('active');
    lobbyScreen.classList.remove('active');
    heroScreen.classList.add('active');
    waitingRoom.classList.add('hidden');
    if (privatePanel) privatePanel.classList.add('hidden');
    if (publicPanel) publicPanel.classList.add('hidden');
    if (joinPanel) joinPanel.classList.remove('hidden');
  });

  // =========================================================================
  // PLAYER NAME (persisted in localStorage)
  // =========================================================================

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

  // =========================================================================
  // JOIN PANELS
  // =========================================================================

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

  // =========================================================================
  // ROOM CODE JOIN
  // =========================================================================

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
      if (privatePanel && !privatePanel.classList.contains('hidden')) {
        handleJoinRoomSubmit();
      }
    }
  });

  // =========================================================================
  // GAME LIFECYCLE
  // =========================================================================

  startBtn?.addEventListener('click', () => {
    socket.emit('startLobby', getCurrentLobbyId());
  });

  heroPlayBtn?.addEventListener('click', () => {
    heroScreen.classList.remove('active');
    lobbyScreen.classList.add('active');
  });

  heroCodeBtn?.addEventListener('click', () => showJoinPrompt());

  // =========================================================================
  // INVITE LINK JOIN — overlay prompts
  // =========================================================================

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

  // =========================================================================
  // URL PARAMS (invite links)
  // =========================================================================

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

  // =========================================================================
  // CLICK-TO-COPY INVITE LINK
  // =========================================================================

  function setupCodeCopy(element) {
    if (!element) return;
    element.style.cursor = 'pointer';
    element.title = 'Click to copy invite link';
    element.addEventListener('click', () => {
      const code = element.innerText.trim();
      if (!code) return;
      const url = window.location.origin + '?room=' + code;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Invite link copied! \uD83D\uDD17');
      }).catch(() => {
        navigator.clipboard.writeText(code).catch(() => {});
        showToast('Room code copied!');
      });
    });
  }

  setupCodeCopy(document.getElementById('lobby-code-display'));
  setupCodeCopy(document.getElementById('team-lobby-code'));

  // =========================================================================
  // HERO DEMO ANIMATION
  // =========================================================================

  const heroDemo = document.querySelector('.hero-demo');
  if (heroDemo) {
    setTimeout(() => heroDemo.classList.add('animate-demo'), 500);
  }

  // =========================================================================
  // LOBBY SETTINGS
  // =========================================================================

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

  if (publicRoomToggle) {
    publicRoomToggle.addEventListener('change', (e) => {
      socket.emit('togglePublic', { lobbyId: getCurrentLobbyId(), state: e.target.checked });
    });
  }

  tvShowsToggle?.addEventListener('change', (e) => {
    socket.emit('toggleTvShows', { lobbyId: getCurrentLobbyId(), state: e.target.checked });
  });

  // =========================================================================
  // MOVIE SUBMISSION
  // =========================================================================

  let debounceTimeout = null;
  const hintText = document.getElementById('hint-text');

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

  // =========================================================================
  // CHAT & REACTIONS
  // =========================================================================

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

  // =========================================================================
  // MODALS (unified delegation)
  // =========================================================================

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

  // =========================================================================
  // MY STATS BUTTON (H5)
  // =========================================================================
  // Opens the modal optimistically (so the player sees something immediately)
  // and asks the server for their stats. The 'myStats' socket handler in
  // socketClient.js calls renderMyStats() with the response.
  const myStatsBtn = document.getElementById('my-stats-btn');
  myStatsBtn?.addEventListener('click', () => {
    const sock = getSocket();
    if (!sock) {
      showNotification("Stats aren't available right now — try again in a sec.");
      return;
    }
    // Show the modal immediately with a loading state — the server response
    // will repaint the body within a few hundred ms. Without this, a slow
    // network would leave the user wondering whether the click registered.
    const modal = document.getElementById('my-stats-modal');
    const sub = document.getElementById('my-stats-subtitle');
    const body = document.getElementById('my-stats-body');
    if (modal) modal.classList.remove('hidden');
    if (sub) sub.textContent = 'Loading…';
    if (body) body.textContent = '';
    sock.emit('requestMyStats', getStableId());
  });

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

  // =========================================================================
  // MODAL FOCUS TRAP + RESTORATION (L6)
  // =========================================================================
  // Watches every .modal-overlay element for visibility changes (via class
  // mutation). When a modal opens, focus moves inside it and the element
  // that previously had focus is remembered. When it closes, focus returns
  // there. A document-level Tab handler keeps focus inside the visible modal.
  //
  // Implemented as a MutationObserver instead of wrapping each open call
  // site so the trap works regardless of HOW the modal was shown (button
  // click, programmatic show, user click on overlay close, Escape key).

  const focusableSelector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  document.querySelectorAll('.modal-overlay').forEach(modal => {
    let priorFocus = null;
    new MutationObserver(() => {
      const isOpen = !modal.classList.contains('hidden');
      // _wasOpen lets us only act on transitions, not every class change.
      if (isOpen && !modal._wasOpen) {
        modal._wasOpen = true;
        priorFocus = document.activeElement;
        // Move focus inside the modal so the next Tab cycles within it and
        // screen readers announce the modal's content. Prefer the close
        // button (it's the safest first stop — Tab moves forward into the
        // modal, Shift+Tab to the last element).
        const closeBtn = modal.querySelector('.modal-close');
        const target = closeBtn || modal.querySelector(focusableSelector);
        if (target && typeof target.focus === 'function') target.focus();
      } else if (!isOpen && modal._wasOpen) {
        modal._wasOpen = false;
        // Restore focus to whoever opened the modal so keyboard users don't
        // get dumped at the top of the page.
        if (priorFocus && typeof priorFocus.focus === 'function') {
          try { priorFocus.focus(); } catch {}
        }
      }
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  });

  // Single document-level Tab interceptor — runs only when a modal is open.
  // Wraps Tab/Shift+Tab around the modal's focusable elements. Without this,
  // Tab would cycle through the underlying screen and hide focus from the
  // user.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const modal = document.querySelector('.modal-overlay:not(.hidden)');
    if (!modal) return;
    // offsetParent === null filters out elements hidden via display:none —
    // querySelectorAll alone would also return e.g. hidden close buttons.
    const focusable = Array.from(modal.querySelectorAll(focusableSelector))
      .filter(el => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (e.shiftKey && (active === first || !modal.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (!modal.contains(active)) {
      // Focus drifted outside the modal somehow (extension, dev tools) —
      // pull it back to the first element so Tab still works predictably.
      e.preventDefault();
      first.focus();
    }
  });

  // =========================================================================
  // MOBILE TABS
  // =========================================================================

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

  // =========================================================================
  // GAME-OVER ACTIONS (delegated — buttons are created dynamically)
  // =========================================================================

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

  // =========================================================================
  // SHARE CARD
  // =========================================================================

  downloadCardBtn?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `moviematch-chain-${Date.now()}.png`;
    link.href = shareCanvas.toDataURL('image/png');
    link.click();
    showToast('Downloaded! \uD83C\uDFAC');
  });

  copyCardBtn?.addEventListener('click', async () => {
    try {
      const blob = await new Promise(res => shareCanvas.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('Image copied to clipboard! \uD83D\uDCCB');
    } catch {
      const text = buildTextRecap(getGameState());
      navigator.clipboard.writeText(text).catch(() => {});
      showToast('Image unavailable \u2014 text recap copied! \u2713');
    }
  });

  // =========================================================================
  // PARALLAX EFFECT
  // =========================================================================

  const bgCarousel = document.getElementById('poster-carousel');
  // L7: Skip the parallax wiring entirely when the user has requested
  // reduced motion. The CSS reduced-motion block already neutralizes the
  // 0.2s transition on the carousel transform, but the mousemove handler
  // would still fire 60+ times/sec and trigger constant repaints — silly
  // when the user doesn't want motion. Mobile is also skipped (existing
  // behavior — the touch UI doesn't have a "cursor" to track).
  if (bgCarousel && !prefersReducedMotion()) {
    document.addEventListener('mousemove', (e) => {
      if (window.innerWidth <= 767) return;
      const xShift = (e.clientX / window.innerWidth - 0.5) * -30;
      const yShift = (e.clientY / window.innerHeight - 0.5) * -30;
      bgCarousel.style.transform = `rotate(-6deg) translate(${xShift}px, ${yShift}px)`;
    });
  }

  // =========================================================================
  // MOBILE KEYBOARD HANDLING
  // =========================================================================
  // On mobile, the on-screen keyboard normally covers the chat input + the
  // bottom-fixed tab bar. We use the Visual Viewport API to detect keyboard
  // open/close and lift fixed elements above it.
  if (window.visualViewport) {
    const root = document.documentElement;
    const updateKeyboardOffset = () => {
      const offset = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
      root.style.setProperty('--keyboard-inset', offset + 'px');
      root.classList.toggle('keyboard-open', offset > 50);
    };
    window.visualViewport.addEventListener('resize', updateKeyboardOffset);
    window.visualViewport.addEventListener('scroll', updateKeyboardOffset);
    updateKeyboardOffset();
  }
});
