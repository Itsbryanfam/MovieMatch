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
  showGhostAttempt, showToast, renderDailyResult,
  // DOM elements
  publicLobbiesList, posterCarousel, lobbyScreen, gameScreen,
  heroScreen, waitingRoom, lobbyCodeDisplay, notificationOverlay, notificationText,
  chatMessages
} from './ui.js';

import { prepareAudio, playSuccess, playFail, playTick, vibrate, escapeHtml, getStableId } from './utils.js';

import {
  getSocket, setSocket, getCurrentLobbyId, getMyPlayerId, getGameState,
  getIsSpectator, getIsDaily, getTurnInterval, getLastTickSound,
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

// H3: Most recent `youWereEliminated` payload, buffered so it can be picked
// up by the alive→dead transition handler in stateUpdate. The events arrive
// in this order: youWereEliminated → notification → stateUpdate, so by the
// time stateUpdate detects the transition the payload is already here.
// Cleared on game start/restart and after consumption to keep stale data
// from leaking into a future elimination.
let pendingEliminationDetails = null;

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
    // H2: For daily lobbies, the lobby ID is an internal `DAILY-xxx-...`
    // string not meant to be shared. Show a friendlier label instead so
    // the in-game header doesn't expose plumbing.
    if (lobbyCodeDisplay) {
      lobbyCodeDisplay.innerText = getIsDaily() ? '🗓️ Daily Challenge' : getCurrentLobbyId();
    }
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
      // H3: If a youWereEliminated payload is buffered (invalid-connection
      // path), pass it through so the screen can show the side-by-side
      // cast comparison. Otherwise (timeout, disconnect, quit) fall back
      // to the generic screen — those eliminations have no comparison to
      // surface anyway. Consume the buffer so a stale payload from a
      // previous game can never leak into a future elimination.
      const details = pendingEliminationDetails;
      pendingEliminationDetails = null;
      showSelfEliminationScreen(details);
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
      vibrate(40); // brief tap to draw attention if user tabbed away
    }

    document.title = (isNowMyTurn && !getIsSpectator())
      ? '🎬 Your turn! — MovieMatch'
      : 'MovieMatch';

    if (state.status === 'playing') {
      if (lobbyScreen) lobbyScreen.classList.remove('active');
      if (gameScreen) gameScreen.classList.add('active');
      resetMobileTab();
      renderGame(state, getMyPlayerId(), getIsSpectator());

      // Only rebuild the timer interval when the turn actually changes.
      // stateUpdate fires on chat messages, reactions, and player joins too —
      // previously each event tore down and rebuilt the interval, causing
      // visible jitter and pointless work.
      const turnChanged = state.currentTurnIndex !== prevState?.currentTurnIndex
        || state.status !== prevState?.status;
      if (turnChanged) {
        clearTurnTimer();
        // 250ms cadence (4× per second) lets the bar animate smoothly using
        // the fractional ms reading — much smoother than the old 1s tick.
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
          // Default to 60s for older states without turnDurationMs (backward
          // compat with rooms saved before the server fix). New states always
          // include the field, so the bar is correct in every mode.
          const totalMs = gs.turnDurationMs || 60000;
          // Use raw ms (not the rounded second `tr`) so the bar shrinks
          // smoothly within each second instead of stepping in 1% chunks.
          const percentage = Math.max(0, Math.min(100, (ms / totalMs) * 100));
          if (timerBar) {
            timerBar.style.width = percentage + '%';

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
        }, 250);
        setTurnInterval(interval);
      }

    } else if (state.status === 'waiting') {
      clearTurnTimer();
      if (gameScreen) gameScreen.classList.remove('active');
      if (lobbyScreen) lobbyScreen.classList.add('active');
      // join-panel starts visible on every page load — hide it here so a
      // stateUpdate received after a page refresh never reveals it alongside waitingRoom.
      document.getElementById('join-panel')?.classList.add('hidden');
      document.getElementById('private-panel')?.classList.add('hidden');
      document.getElementById('public-panel')?.classList.add('hidden');
      renderLobby(state, getMyPlayerId());
    } else if (state.status === 'finished') {
      clearTurnTimer();
      document.title = 'MovieMatch';
      renderGame(state, getMyPlayerId(), getIsSpectator());

      // H2: Daily Challenge end-of-game modal. Only fires once per
      // finished transition to avoid duplicate opens when stateUpdate
      // re-fires for unrelated reasons (chat messages, reactions).
      // We piggyback on prevState.status to detect the playing→finished
      // edge — same pattern as the win-flash handler above.
      const justFinished = prevState?.status === 'playing' && state.status === 'finished';
      if (justFinished && getIsDaily() && state.winner?.isDaily) {
        // Ask the server for the latest leaderboard so the player's freshly
        // recorded entry shows up. Render the modal as soon as we get it.
        const date = state.winner.date;
        socket.emit('requestDailyLeaderboard', date);
        // The leaderboard response handler stores on socket._lastDailyLeaderboard;
        // poll briefly for it (server is local, expected within a few hundred ms).
        // Caps at ~2s so a slow network still surfaces the modal with whatever
        // leaderboard came back, even if it's empty.
        let elapsed = 0;
        const pollMs = 100;
        const maxMs = 2000;
        const tryRender = () => {
          const lb = socket._lastDailyLeaderboard;
          if (lb && lb.date === date) {
            socket._lastDailyLeaderboard = null;
            renderDailyResult({
              alreadyPlayed: false,
              puzzleNumber: state.winner.puzzleNumber,
              date,
              chainLength: state.winner.chainLength || 0,
              leaderboard: lb.leaderboard || [],
            });
            return;
          }
          elapsed += pollMs;
          if (elapsed >= maxMs) {
            renderDailyResult({
              alreadyPlayed: false,
              puzzleNumber: state.winner.puzzleNumber,
              date,
              chainLength: state.winner.chainLength || 0,
              leaderboard: [],
            });
            return;
          }
          setTimeout(tryRender, pollMs);
        };
        setTimeout(tryRender, pollMs);
      }
    }
  });

  // -----------------------------------------------------------------------
  // NOTIFICATIONS
  // -----------------------------------------------------------------------

  socket.on('notification', (payload) => {
    // Server may send either a plain string (legacy) or a {msg, kind} object.
    // Normalize so the rest of the handler can dispatch on kind without
    // worrying about the wire format. The kind-based dispatch replaces the
    // old `msg.includes(...)` substring matching, which was fragile to copy
    // changes and would break on i18n.
    const msg = typeof payload === 'string' ? payload : payload?.msg ?? '';
    let kind = typeof payload === 'object' && payload?.kind ? payload.kind : null;
    // Backward-compat fallback: infer kind from the text if the server didn't
    // tag it. Lets a freshly-deployed client still work against an older server.
    if (!kind) {
      if (msg.includes('eliminated')) kind = 'elimination';
      else if (msg.includes('wins')) kind = 'win';
    }

    if (!selfElimActive) showNotification(msg);

    if (kind === 'elimination') {
      playFail();
      vibrate([200, 100, 200]); // attention-grabbing pattern on elimination
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
    } else if (kind === 'win') {
      // Win takes precedence over any in-flight elimination flash from the
      // same losing turn — clean those up before the celebration plays.
      document.querySelectorAll('.elimination-flash').forEach(el => el.remove());
      playSuccess();
      setTimeout(playSuccess, 300);
      setTimeout(playSuccess, 600);
      vibrate([60, 80, 60, 80, 60]); // celebration pattern on win
      showWinFlash();
    }
    // kind === 'info' (or unknown): no effects, just the text overlay.
  });

  // -----------------------------------------------------------------------
  // FAILED ATTEMPTS — render a transient ghost card so other players can
  // see what was tried before someone got eliminated, without polluting
  // the chain history.
  // -----------------------------------------------------------------------

  socket.on('attemptFailed', showGhostAttempt);

  // -----------------------------------------------------------------------
  // YOU WERE ELIMINATED (H3) — private payload sent only to the eliminated
  // player when the cause is a strategic failure (invalid connection,
  // hardcore actor reuse, or movie-already-used). Carries the cast lists
  // for both the player's guess and the last chain entry so the
  // self-elimination screen can show why no actor connected the two.
  // Cleared either by consumption (the next stateUpdate that flips the
  // local player to dead) or by the next `gameStarted`/`stateUpdate` that
  // resets the game — see resetGame logic below if added later.
  // -----------------------------------------------------------------------

  socket.on('youWereEliminated', (payload) => {
    pendingEliminationDetails = payload;
  });

  // -----------------------------------------------------------------------
  // DAILY CHALLENGE (H2)
  // -----------------------------------------------------------------------
  // dailyAlreadyPlayed — sent when the player tried to start today's daily
  // but their attempt for this UTC day already exists. The client just
  // shows the result modal pre-populated with their previous score and
  // the leaderboard; no lobby is created.

  socket.on('dailyAlreadyPlayed', (payload) => {
    renderDailyResult({
      alreadyPlayed: true,
      puzzleNumber: payload.puzzleNumber,
      date: payload.date,
      chainLength: payload.attempt?.chainLength || 0,
      leaderboard: payload.leaderboard || [],
    });
  });

  // dailyLeaderboard — response to requestDailyLeaderboard (used when the
  // result modal needs a refresh, e.g. after the player just finished and
  // we want the latest standings to reflect their entry).
  socket.on('dailyLeaderboard', (payload) => {
    // Keep the most recent leaderboard so renderDailyResult can pull it
    // when the post-game flow fires below. Stored on a property of the
    // function so we don't have to expose another state-module field.
    socket._lastDailyLeaderboard = payload;
  });

  // -----------------------------------------------------------------------
  // SUBMISSION REJECTED (H1) — server couldn't find the title (typo or
  // off-canon name TMDB doesn't index). The player is NOT eliminated; they
  // can submit again until they exhaust the per-turn retry budget. This
  // event is emitted only to the submitting socket — other players don't
  // need to learn about typos, so we keep it private and quiet.
  // -----------------------------------------------------------------------

  socket.on('submissionRejected', ({ message, retriesLeft, originalInput }) => {
    // Show the count tail only when we still have retries — once retriesLeft
    // hits 0, the server has already used the elimination path and a
    // separate notification is on its way.
    let tail = '';
    if (typeof retriesLeft === 'number') {
      if (retriesLeft > 1) tail = ` (${retriesLeft} tries left)`;
      else if (retriesLeft === 1) tail = ' (1 try left)';
      else if (retriesLeft === 0) tail = ' (last chance!)';
    }
    showToast((message || "Couldn't find that title.") + tail);

    // Re-enable the input. submitMovie() in app.js disables the input/button
    // locally when the player presses Enter, expecting a server-side state
    // update to re-enable them on the next turn. On a rejected submission
    // we *don't* broadcast a state update (no point telling everyone about
    // a typo), so the local controls would otherwise stay stuck disabled.
    const movieInputEl = document.getElementById('movie-input');
    const submitBtnEl = document.getElementById('submit-btn');
    const hintEl = document.getElementById('hint-text');
    if (movieInputEl) {
      movieInputEl.disabled = false;
      // Restore the rejected text into the input — submitMovie() in app.js
      // clears the field on emit (optimistic UI for the success case), so
      // without restoring it the player would be left with an empty box and
      // no easy way to fix a typo.
      if (typeof originalInput === 'string' && originalInput.length > 0) {
        movieInputEl.value = originalInput;
      }
      // Select-on-focus so a fresh keystroke replaces everything if the
      // player prefers to start over. Skipped on mobile to avoid summoning
      // the keyboard unexpectedly (matches the existing mobile focus guard).
      if (window.innerWidth > 767) {
        movieInputEl.focus();
        movieInputEl.select();
      }
    }
    if (submitBtnEl) submitBtnEl.disabled = false;
    if (hintEl) {
      hintEl.innerText = retriesLeft > 0
        ? `Try again — pick a suggestion or check the spelling.`
        : `Last chance — get this one right!`;
    }
    // Brief haptic so a player whose eyes are off the screen still notices.
    vibrate(40);
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
    document.title = 'MovieMatch';
    const banner = document.getElementById('offline-banner');
    if (banner && reason !== 'io client disconnect') {
      banner.classList.remove('hidden');
    }
  });

  // Covers both socket reconnect (same tab) and page refresh (new socket).
  // sessionStorage holds the last known lobbyId/playerId and is cleared on intentional leave,
  // so this will no-op on a fresh page load with no prior session.
  socket.on('connect', () => {
    const savedLobbyId = sessionStorage.getItem('mm_lobbyId');
    const savedPlayerId = sessionStorage.getItem('mm_playerId');
    if (savedLobbyId && savedPlayerId) {
      // Hide hero screen immediately \u2014 rejoinSuccess/rejoinFailed will handle final state.
      // This prevents the hero from flashing behind the lobby/game on page refresh.
      if (heroScreen) heroScreen.classList.remove('active');
      socket.emit('rejoinLobby', {
        lobbyId: savedLobbyId,
        playerId: savedPlayerId,
        stableId: getStableId(),
      });
    } else {
      const banner = document.getElementById('offline-banner');
      if (banner) banner.classList.add('hidden');
    }
  });

  socket.on('rejoinSuccess', (data) => {
    const banner = document.getElementById('offline-banner');
    if (banner) banner.classList.add('hidden');

    onRejoined(data);
    // Update sessionStorage with the new socket.id so future refreshes use the correct ID
    sessionStorage.setItem('mm_lobbyId', data.lobbyId);
    sessionStorage.setItem('mm_playerId', data.playerId);

    if (heroScreen) heroScreen.classList.remove('active');

    // Always hide join-flow panels — rejoining means we're already in a lobby.
    document.getElementById('join-panel')?.classList.add('hidden');
    document.getElementById('private-panel')?.classList.add('hidden');
    document.getElementById('public-panel')?.classList.add('hidden');

    if (data.state.status === 'playing' || data.state.status === 'finished') {
      if (lobbyScreen) lobbyScreen.classList.remove('active');
      if (gameScreen) gameScreen.classList.add('active');
      resetMobileTab();
      renderGame(data.state, getMyPlayerId(), getIsSpectator());
    } else {
      if (gameScreen) gameScreen.classList.remove('active');
      if (lobbyScreen) lobbyScreen.classList.add('active');
      if (waitingRoom) waitingRoom.classList.remove('hidden');
      renderLobby(data.state, getMyPlayerId());
    }
    // H2: Same lobby-code-display override as the 'joined' handler \u2014 after
    // refresh during a Daily run, show the friendly label rather than the
    // internal DAILY-...-... lobby ID.
    if (lobbyCodeDisplay) {
      lobbyCodeDisplay.innerText = getIsDaily() ? '\ud83d\uddd3\ufe0f Daily Challenge' : data.lobbyId;
    }
    showNotification('\u2705 Reconnected to game!');
  });

  socket.on('rejoinFailed', (msg) => {
    // Clear stale session so we don't retry on next connect
    sessionStorage.removeItem('mm_lobbyId');
    sessionStorage.removeItem('mm_playerId');
    // Restore hero screen (was hidden optimistically on connect)
    if (heroScreen) heroScreen.classList.add('active');
    if (lobbyScreen) lobbyScreen.classList.remove('active');
    if (gameScreen) gameScreen.classList.remove('active');
    const banner = document.getElementById('offline-banner');
    // Only show error if there was an active disconnect (banner visible)
    if (banner && !banner.classList.contains('hidden')) {
      banner.classList.add('hidden');
      showNotification(msg || 'Could not rejoin game');
    }
  });

  socket.on('kicked', (msg) => {
    showNotification(msg || 'You were removed from the lobby.');
    resetSession();
    if (gameScreen) gameScreen.classList.remove('active');
    if (lobbyScreen) lobbyScreen.classList.remove('active');
    if (heroScreen) heroScreen.classList.add('active');
    if (waitingRoom) waitingRoom.classList.add('hidden');
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
