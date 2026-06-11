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
  buildTextRecap, showDailyNamePrompt, // WHY: HL-01 — name-less Daily seam
  showScreen, // WHY: canonical group-normaliser added in Phase 3 Task D
  mountHeroPuzzle, // Phase 7.9: Playable Hero driver mount
  submissionPill, // Phase 7.2 (CG-03): keeps submitted title visible during TMDB round-trip
  createPromptModal, buildNamePromptConfig, buildJoinPromptConfig, // Phase 7.3 (MI-02): shared prompt-modal factory + builders
  // T5d ESLint: dropped genuinely-unused imports (lobbyScreen, heroScreen,
  // gameScreen, publicPanel, joinPanel, hardcoreToggle, tvShowsToggle,
  // closeHowToPlay, closeCredits, closeLeaderboard, shareModal) — they were
  // imported but never referenced in this file. Removing names from an
  // import {} list is behavior-neutral (the still-used names and ui.js's
  // module side effects are unchanged).
  playerNameInput, logo, waitingRoom,
  privatePanel, lobbyIdInput,
  publicRoomToggle, joinBtn, startBtn, showPublicBtn,
  showPrivateBtn, backToJoinBtn, backToJoinBtn2, refreshLobbiesBtn,
  heroPlayBtn, heroCodeBtn, heroDailyBtn, howToPlayBtn, creditsBtn, howToPlayModal,
  creditsModal, leaderboardBtn,
  leaderboardModal, leaderboardList, submitBtn,
  movieInput, autocompleteContainer, chatInput, modeChips, joinRedBtn,
  joinBlueBtn, teamBackBtn, teamStartBtn, teamScreen, downloadCardBtn,
  copyCardBtn, shareCanvas
} from './ui.js';

import { initSocket, leaveLobby } from './socketClient.js';
import { getSocket, getCurrentLobbyId, getGameState } from './state.js';
import { prepareAudio, getStableId, unlockAudioGlobally, isMuted, toggleMute, prefersReducedMotion } from './utils.js';
import { runTutorial, runTutorialThenContinue } from './tutorial.js';
// Phase 7.8c — single source of truth for invite-link URL format. Extracted
// to a leaf module (not defined here) so ui-render.js can import it without
// creating a cycle through the ui.js barrel. Imported here for local use
// AND re-exported so any caller that already imports from app.js still works.
import { makeJoinUrl } from './url-helpers.js';
export { makeJoinUrl };

// ============================================================================
// LOBBY SETTINGS CHANGE HANDLERS — exported for unit testing
// ============================================================================

/**
 * Phase 7.8b: register the classic AND team-suffixed House Rules change
 * handlers on the document. Extracted so tests can call this directly with a
 * fake socket without triggering the full DOMContentLoaded initialiser.
 *
 * Each control's change event emits the SAME socket event + payload as its
 * classic counterpart — only one control is visible at a time (mode dispatch
 * in renderLobby), so no double-emit occurs in practice. Server payload and
 * event names are UNCHANGED (spec §8 guardrail 1: client-only, no new events).
 *
 * @param {object}   socket      Socket.IO socket (or any { emit } mock).
 * @param {Function} getLobbyId  Returns the current lobby id string.
 */
export function initLobbySettingsHandlers(socket, getLobbyId) {
  // Theme picker: classic + team. setTheme payload: { lobbyId, theme }.
  ['theme-select', 'theme-select-team'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', (e) => {
      socket.emit('setTheme', { lobbyId: getLobbyId(), theme: e.target.value });
    });
  });

  // Hardcore toggle: classic + team. toggleHardcore payload: { lobbyId, state }.
  ['hardcore-toggle', 'hardcore-toggle-team'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', (e) => {
      socket.emit('toggleHardcore', { lobbyId: getLobbyId(), state: e.target.checked });
    });
  });

  // TV Shows toggle: classic + team. toggleTvShows payload: { lobbyId, state }.
  ['tv-shows-toggle', 'tv-shows-toggle-team'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', (e) => {
      socket.emit('toggleTvShows', { lobbyId: getLobbyId(), state: e.target.checked });
    });
  });
}

// ============================================================================
// MODAL FOCUS RESTORATION (L6 / T4h) — exported for unit testing
// ============================================================================

/**
 * T4h audit fix: restore focus to the element that had it before a modal
 * opened — but ONLY if that element is still in the document. Pre-fix the
 * observer called priorFocus.focus() unconditionally; if the opener was
 * removed from the DOM while the modal was open (a re-render, a list item that
 * vanished, the opener button itself being replaced), .focus() either threw or
 * silently no-op'd on a detached node, dumping keyboard users at the top of the
 * page. Now we check isConnected and fall back to a safe landmark.
 *
 * Extracted (like initLobbySettingsHandlers) so it's unit-testable without
 * standing up the whole MutationObserver init.
 *
 * @param {Element|null} priorFocus  Element that had focus before the modal opened.
 * @param {Element}      [fallback]  Where to send focus if priorFocus is gone.
 *                                   Defaults to document.body.
 */
export function restoreModalFocus(priorFocus, fallback) {
  // isConnected is true only while the node is in the live document tree — the
  // exact "was it removed mid-modal?" signal. Guard typeof focus too: exotic
  // activeElement values (SVG, foreign nodes) may lack the method.
  if (priorFocus && priorFocus.isConnected && typeof priorFocus.focus === 'function') {
    try { priorFocus.focus(); return; } catch { /* fall through to fallback */ }
  }
  // Prior opener is gone (or un-focusable) — send focus to a safe element so a
  // keyboard user lands somewhere sane instead of nowhere. document.body is the
  // universal fallback; callers may pass a more specific landmark.
  const safe = (fallback && typeof fallback.focus === 'function') ? fallback : document.body;
  if (safe && typeof safe.focus === 'function') {
    try { safe.focus(); } catch { /* last resort: nothing more we can do */ }
  }
}

// ============================================================================
// LEADERBOARD RENDERER — exported for behavior testing
// ============================================================================
// T6c: hoisted from inside the DOMContentLoaded closure to module scope and
// exported (export-only — the body is byte-for-byte unchanged, it only reads
// the same module-scope ui.js DOM bindings and the global fetch it always did).
// This lets leaderboard-render.test.js exercise the REAL render through the
// jsdom fixture DOM instead of regex-extracting the function body from source
// text. The DOMContentLoaded wiring below still references it by name (module
// function declarations are in scope there).
export async function loadLeaderboard() {
  leaderboardModal.classList.remove('hidden');
  leaderboardList.innerHTML = '';
  // Phase 7.10 — DS-01 pass 2: classes migrated to 03-game.css.
  // .empty-hint--lg preserves the previous 2rem inline padding override.
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'empty-hint empty-hint--lg';
  loadingDiv.textContent = 'Loading...';
  leaderboardList.appendChild(loadingDiv);
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    leaderboardList.innerHTML = '';
    if (!data.length) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-hint empty-hint--lg';
      emptyDiv.textContent = 'No wins recorded yet. Play a game!';
      leaderboardList.appendChild(emptyDiv);
      return;
    }
    data.forEach((entry, i) => {
      // Phase 7.10 — DS-01 pass 2: row/rank/name/wins styling moved to
      // .leaderboard-* component classes in 03-game.css.
      const row = document.createElement('div');
      row.className = 'leaderboard-row';
      const rank = document.createElement('span');
      rank.className = 'leaderboard-rank';
      rank.textContent = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
      const name = document.createElement('span');
      name.className = 'leaderboard-name';
      name.textContent = entry.name;
      const wins = document.createElement('span');
      wins.className = 'leaderboard-wins';
      wins.textContent = entry.wins + ' 🏆';
      row.appendChild(rank);
      row.appendChild(name);
      row.appendChild(wins);
      leaderboardList.appendChild(row);
    });
  } catch {
    // T7e: optional catch binding — the error object is never read (we render a
    // fixed user-facing message regardless of cause), so drop the unused `err`
    // param to match the codebase idiom (see the other bare `catch {}` sites).
    leaderboardList.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'empty-hint empty-hint--lg';
    errorDiv.textContent = 'Failed to load leaderboard.';
    leaderboardList.appendChild(errorDiv);
  }
}

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

  // Phase 7.9: Playable Hero — paint the bundled puzzle into #hero-puzzle
  // and wire DOM + socket events. Idempotent (guarded by container.dataset.mounted
  // so the test harness's loadIndexHtml DOM teardown resets the flag naturally
  // between tests, while production sees one mount per page lifetime).
  mountHeroPuzzle(socket);

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
    // Phase 7.8c: replaced inline URL construction with shared makeJoinUrl.
    const url = makeJoinUrl(code);
    navigator.clipboard.writeText(url)
      .then(() => showToast('Invite link copied! 🔗'))
      .catch(() => showToast('Room code: ' + code));
  });

  // =========================================================================
  // DAILY CHALLENGE BUTTON (H2 / HL-01)
  // =========================================================================
  // Single-click entry point. Server checks attempt-NX; if the player has
  // already played today, server emits dailyAlreadyPlayed and the result
  // modal opens with their prior score + leaderboard. Otherwise it creates
  // an ephemeral daily lobby with the seed pre-populated as chain[0] and
  // the player joins via the standard 'joined' event flow.
  //
  // HL-01: a name may already exist because init pre-fills #player-name
  // from localStorage (see the `savedName` block lower in this file) or the
  // player typed one in the lobby. ONLY then can we start straight away. A
  // first-time visitor on the hero has neither — the old code showed a
  // full-screen notification and focused #player-name, which lives on the
  // hidden lobby screen, so the primary Daily CTA dead-ended (silently: a
  // developer always has a saved name, so it never reproduced in testing).
  // Now a name-less start opens an inline prompt instead of dead-ending.
  function emitStartDaily(name) {
    // Persist the name (same pattern as the join flow) so a refresh after a
    // daily run still shows the player's name on future attempts and on the
    // daily leaderboard; mirror it into #player-name so the rest of the app
    // sees the same name the lobby flow would have set.
    localStorage.setItem('mm_playerName', name);
    if (playerNameInput) playerNameInput.value = name;
    getSocket().emit('startDailyChallenge', { name, stableId: getStableId() });
  }

  heroDailyBtn?.addEventListener('click', () => {
    const existing = (
      (playerNameInput && playerNameInput.value) ||
      localStorage.getItem('mm_playerName') ||
      ''
    ).trim();
    if (existing) { emitStartDaily(existing); return; }
    // No name yet — prompt in place rather than dead-ending. The prompt is
    // a socket-free ui seam (unit-tested in client-tests/daily-name-prompt
    // .test.js); the emit stays here where the socket + stableId live.
    showDailyNamePrompt({ prefill: '', onConfirm: emitStartDaily });
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

  // M6 / audit #4: the first-run tutorial is NOT auto-popped here anymore.
  // An unsolicited modal ~600ms after load took over before the visitor
  // had oriented to the brand/CTA. It now fires from the player's first
  // explicit "Play Now" intent — see the hero-play-btn handler below,
  // which routes through runTutorialThenContinue (still gated on the
  // mm_completedTutorial flag, still client-only).

  // =========================================================================
  // NAVIGATION
  // =========================================================================

  logo.addEventListener('click', () => {
    if (getCurrentLobbyId()) leaveLobby();
    showScreen('hero');                           // normalise top-level screen group
    // waitingRoom + teamScreen are lobby sub-panels, NOT part of the
    // top-level screen group that showScreen('hero') resets. Hide both
    // so returning to hero from a team-mode lobby doesn't leave
    // #team-screen with stale visibility that resurfaces on the next
    // lobby entry (fixes the pre-existing asymmetry flagged in Phase 3).
    waitingRoom.classList.add('hidden');
    teamScreen.classList.add('hidden');
    showScreen('join');                           // normalise entry-panel group back to join
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
    showScreen('private');                        // normalise entry-panel group
  });

  showPublicBtn?.addEventListener('click', () => {
    if (!checkName()) return;
    showScreen('public');                         // normalise entry-panel group
    socket.emit('requestPublicLobbies');          // keep: non-visibility side-effect
  });

  backToJoinBtn?.addEventListener('click', () => {
    showScreen('join');                           // normalise entry-panel group
  });

  backToJoinBtn2?.addEventListener('click', () => {
    showScreen('join');                           // normalise entry-panel group
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
      showScreen('join');                         // normalise entry-panel group (error path)
      if (playerNameInput) playerNameInput.focus(); // keep: non-visibility side-effect
      return;
    }
    localStorage.setItem('mm_playerName', name);
    getSocket().emit('joinLobby', {
      name,
      lobbyId: lobbyIdInput ? lobbyIdInput.value.trim() : '',
      stableId: getStableId()
    });
    // NOTE: not migrated — lone partial toggle, no behaviour-preserving
    // canonical equivalent. showScreen('join') would reveal the
    // player-setup panel during the joinLobby round-trip; the original
    // hides only the private panel (blank area) until the 'joined'
    // handler hides all panels on the server response.
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
    // Audit #4: first-time visitors see the guided walkthrough now (on
    // their own Play-Now intent), THEN land in the lobby. Returning
    // players skip straight through. The screen swap is the continueFn so
    // it can't run until any tutorial is dismissed.
    runTutorialThenContinue(() => {
      showScreen('lobby');                        // normalise top-level screen group
    });
  });

  heroCodeBtn?.addEventListener('click', () => showJoinPrompt());

  // =========================================================================
  // INVITE LINK JOIN — overlay prompts
  // =========================================================================

  // Phase 7.3 (MI-02): these were two ~60-line overlays built with
  // hardcoded .style.cssText. They are now thin glue over the shared
  // createPromptModal factory + pure config builders (public/js/ui/
  // modal.js, name-prompts.js). Behaviour/pixels are byte-for-byte
  // preserved by the builders + the .modal-*--prompt CSS; this file just
  // injects the app-level deps the builders need — those stay here so the
  // builders remain pure and unit-tested. `socket` is the closure const
  // from `const socket = initSocket()` (app.js:47); `showScreen` /
  // `playerNameInput` are ui-barrel imports; `getStableId` / `prepareAudio`
  // are utils.js imports — all in scope here, exactly as the legacy bodies
  // referenced them.
  const promptDeps = {
    socket,
    showScreen,
    getStableId,
    prepareAudio,
    getPlayerNameInput: () => playerNameInput,
    getPathname: () => window.location.pathname,
    history: window.history,
    localStorage: window.localStorage,
  };

  function showNamePrompt(roomCode) {
    createPromptModal(buildNamePromptConfig({ roomCode, deps: promptDeps }));
  }

  function showJoinPrompt() {
    createPromptModal(buildJoinPromptConfig({ deps: promptDeps }));
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
      showScreen('lobby');                        // normalise top-level screen group
      socket.emit('joinLobby', { name: savedName, lobbyId: code, stableId: getStableId() });
      window.history.replaceState({}, '', window.location.pathname); // keep: non-visibility side-effect
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
      // Phase 7.8c: replaced inline URL construction with shared makeJoinUrl.
      const url = makeJoinUrl(code);
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
    showScreen('waiting');                        // normalise waiting/team pair
  });
  teamStartBtn?.addEventListener('click', () => {
    socket.emit('startLobby', getCurrentLobbyId());
  });

  // L1/7.8b: House Rules change handlers for both classic and team-suffixed
  // controls. Extracted to initLobbySettingsHandlers (above) so it is unit-
  // testable without triggering the full DOMContentLoaded initialiser.
  // Server validates the theme id against the whitelist so an injected option
  // value can't bypass the picker — if it does, the server simply drops it.
  initLobbySettingsHandlers(socket, getCurrentLobbyId);

  // L3: Spectator prediction vote buttons. Disabled after click so the
  // spectator can't double-vote within the same turn (the server's rate
  // limit is the real ceiling, but disabling locally avoids the visual
  // flicker of a click that's silently dropped). The buttons re-enable
  // on the next turn via renderTurnControls's turnKey check.
  function emitPrediction(prediction) {
    const lobbyId = getCurrentLobbyId();
    if (!lobbyId) return;
    socket.emit('spectatorPredict', { lobbyId, prediction });
    const bar = document.getElementById('spectator-prediction-bar');
    if (bar) {
      bar.classList.toggle('voted-yes', prediction === 'yes');
      bar.classList.toggle('voted-no', prediction === 'no');
    }
    const yesBtn = document.getElementById('spec-pred-yes');
    const noBtn = document.getElementById('spec-pred-no');
    if (yesBtn) yesBtn.disabled = true;
    if (noBtn) noBtn.disabled = true;
  }
  document.getElementById('spec-pred-yes')?.addEventListener('click', () => emitPrediction('yes'));
  document.getElementById('spec-pred-no')?.addEventListener('click', () => emitPrediction('no'));

  if (publicRoomToggle) {
    publicRoomToggle.addEventListener('change', (e) => {
      socket.emit('togglePublic', { lobbyId: getCurrentLobbyId(), state: e.target.checked });
    });
  }

  // =========================================================================
  // MOVIE SUBMISSION
  // =========================================================================

  let debounceTimeout = null;

  function submitMovie() {
    const movie = movieInput ? movieInput.value.trim() : '';
    if (!movie) return;

    // Submitting supersedes any in-flight typeahead search: cancel the
    // pending debounced autocompleteSearch so it can't fire a stale request
    // (~400ms later) for input the player has already submitted.
    clearTimeout(debounceTimeout);

    if (autocompleteContainer) autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
    closeMobileAc();

    getSocket().emit('submitMovie', { lobbyId: getCurrentLobbyId(), movie });

    if (movieInput) {
      movieInput.value = '';
      movieInput.disabled = true;
    }
    if (submitBtn) submitBtn.disabled = true;
    // Phase 7.2 (CG-03): the pill replaces the static "Validating
    // connection..." hint so the player's submitted title stays visible
    // through the TMDB round-trip instead of facing a blank input.
    submissionPill.checking(movie);
  }

  submitBtn?.addEventListener('click', submitMovie);
  movieInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitMovie();
  });

  // M3: Debounce the typing-indicator broadcast so a typing player emits
  // at most once per 1.5s. Without the gate, every keystroke would fire
  // its own server round-trip, which both wastes bandwidth and trips the
  // server-side rate limit on a normal-speed typist.
  let typingPingTimeout = null;
  const TYPING_PING_INTERVAL_MS = 1500;
  function maybeEmitTyping() {
    if (typingPingTimeout) return;            // already scheduled — coalesce
    typingPingTimeout = setTimeout(() => {
      typingPingTimeout = null;
    }, TYPING_PING_INTERVAL_MS);
    socket.emit('typing', getCurrentLobbyId());
  }

  movieInput?.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    // M3: Notify the room that the active player is typing. Server checks
    // it's actually their turn before broadcasting; sending always (rather
    // than gating on local "is it my turn" state) is simpler and safe — a
    // wrong-turn ping is just dropped server-side.
    if (query.length > 0) maybeEmitTyping();
    if (query.length < 2) {
      if (autocompleteContainer) autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
      closeMobileAc();
      submissionPill.clear('searching'); // left the typeahead — drop the searching pill
      return;
    }
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      submissionPill.searching();
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

  // M6: Returning players can replay the tutorial from the How-to-Play
  // modal. We close the modal first (avoid stacked overlays competing
  // for focus) then clear the gate flag so runTutorial doesn't no-op,
  // then run it. The runTutorial promise resolves on dismiss; nothing
  // chains off it here.
  document.getElementById('replay-tutorial-btn')?.addEventListener('click', () => {
    if (howToPlayModal) howToPlayModal.classList.add('hidden');
    try { localStorage.removeItem('mm_completedTutorial'); } catch {}
    runTutorial().catch(() => {});
  });

  // T6c: loadLeaderboard hoisted to module scope (see export above) so it can
  // be behavior-tested directly. The click wiring is unchanged \u2014 it still binds
  // the same function by name.
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
        // T4h: restore focus to whoever opened the modal — but the guarded
        // helper falls back to document.body if that opener was removed from
        // the DOM mid-modal, so keyboard users are never silently dumped onto
        // a detached node.
        restoreModalFocus(priorFocus);
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

  // =========================================================================
  // SERVICE WORKER (Phase 4)
  // =========================================================================
  // Registered on `load` (not immediately) so it never competes with
  // critical first-paint resources. Guarded + swallowed: a registration
  // failure (unsupported browser, insecure context in some dev setups) must
  // never break the app. The SW itself is network-first — see public/sw.js.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
});
