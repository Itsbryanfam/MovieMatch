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
  openShareModal, showGameOverBanner, resetMobileTab, playRecap,
  showEliminationFlash, showSelfEliminationScreen, showWinFlash,
  showGhostAttempt, showToast, renderDailyResult, renderMyStats, showConfetti,
  toast, gameEvent, submissionPill, // Phase 7.2: feedback router
  timerSeverity, // Phase 7.4: pure timer-severity seam (Panic Timer)
  isClutchSave, markClutchSave, // Phase 7.7: clutch-save predicate + one-shot flag
  showScreen, // WHY: Phase 3 Task D — canonical group-normaliser for screen transitions
  renderRuleKitChips, // Phase 6c: renders lobby quick-kit chips from server-delivered list
  // DOM elements
  publicLobbiesList, posterCarousel, lobbyScreen, gameScreen,
  heroScreen, waitingRoom, lobbyCodeDisplay, notificationOverlay, notificationText,
  chatMessages
} from './ui.js';

import { prepareAudio, playSuccess, playFail, playTick, playSfx, vibrate, escapeHtml, getStableId } from './utils.js';

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

// T4f audit fix: server-authoritative player cap, delivered via the
// 'serverConfig' connect-time event. Module-local with a fallback of 8 so the
// public-lobby "N / max" count renders correctly even before the event arrives
// (or if an old server never sends it). Updated in the serverConfig handler;
// read by the publicLobbiesList renderer below. Single source of truth on the
// client so the cap can never be hardcoded out of sync with the server.
let serverMaxPlayers = 8;

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

    // NOTE: entry-panel hides below use direct getElementById because this
    // handler runs during initSocket() before initUIElements() has assigned
    // the module-level refs. We keep the direct DOM lookups and hide all
    // three panels (not just private/public) because on join the canonical
    // state is "no panel visible" — showScreen('join') would show the join
    // panel, which is incorrect here.
    const joinPanel = document.getElementById('join-panel');
    const privatePanel = document.getElementById('private-panel');
    const publicPanel = document.getElementById('public-panel');
    if (joinPanel) joinPanel.classList.add('hidden');     // hide all panels on join
    if (privatePanel) privatePanel.classList.add('hidden');
    if (publicPanel) publicPanel.classList.add('hidden');

    if (getIsSpectator()) {
      // Spectator path: hero-active + lobby-active already cleared by
      // showScreen('game') normalising the full top-level group.
      // WHY: hero line was a partial toggle before — showScreen covers it.
      showScreen('game');                                  // normalise top-level group: hero+lobby→off, game→on
    } else {
      // Player path: hero-active cleared by showScreen('lobby'); also show
      // waiting room for the player's lobby view.
      // WHY: hero line was a partial toggle before — showScreen covers it.
      showScreen('lobby');                                 // normalise top-level group: hero+game→off, lobby→on
      showScreen('waiting');                               // normalise waiting/team pair: show waiting room
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
      // Phase 7.10 — DS-01 pass 2: empty-hint inline style migrated to
      // .empty-hint--lg modifier (existing .empty-hint rule in 03-game.css
      // covers text-align/color/font-style/font-size; --lg preserves the
      // 2rem padding override).
      publicLobbiesList.innerHTML = '<div class="empty-hint empty-hint--lg">No open lobbies found. Create a private one!</div>';
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

      // M4: Skill-bracket badge next to the host name. Compact, single
      // emoji-and-label so the host's experience level is the first
      // signal a browser sees. New players get a friendly "🌱 New" label
      // so they aren't joining unaware that the host might be a first-
      // timer too — sets expectations both ways.
      if (lobby.skill && lobby.skill.label) {
        const skillBadge = document.createElement('span');
        skillBadge.className = 'public-lobby-skill';
        skillBadge.textContent = `${lobby.skill.icon || ''} ${lobby.skill.label}`;
        skillBadge.title = `Host wins: ${lobby.hostWins | 0}`;
        h3.appendChild(document.createTextNode(' '));
        h3.appendChild(skillBadge);
      }

      const stats = document.createElement('div');
      stats.className = 'public-lobby-stats';

      const countSpan = document.createElement('span');
      // T4f: render the cap from the server-delivered serverMaxPlayers (falls
      // back to 8 pre-event) instead of a hardcoded '/ 8' literal.
      countSpan.textContent = '👥 ' + lobby.playerCount + ' / ' + serverMaxPlayers;
      stats.appendChild(countSpan);

      // M4: Last-game chain-length stat. Only shown when the lobby has
      // actually finished a game — a brand-new lobby with no plays yet
      // would render "Last chain: 0" which is misleading.
      if (typeof lobby.lastChainLength === 'number' && lobby.lastChainLength > 0) {
        const lastSpan = document.createElement('span');
        lastSpan.textContent = `🔗 Last: ${lobby.lastChainLength}`;
        stats.appendChild(lastSpan);
      }

      // M4: Vibe tag (chatty / casual / quiet). Only shown when the
      // server returns a non-null vibe — younger lobbies have no
      // signal yet and we don't want to mislabel them.
      if (lobby.vibe && lobby.vibe.label) {
        const vibeSpan = document.createElement('span');
        vibeSpan.className = 'public-lobby-vibe';
        vibeSpan.textContent = `${lobby.vibe.icon || ''} ${lobby.vibe.label}`;
        stats.appendChild(vibeSpan);
      }

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
      // Phase 7.10 — DS-01 pass 2: padding/width moved to .join-public-btn
      // rule in 02-hero-lobby.css; class already present, just drops the
      // redundant inline cssText.
      joinButton.className = 'btn-primary join-public-btn';
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
  // THEMES LIST (L1) — server sends this once per connection. Cached on
  // window.__mmThemes so renderLobby can populate the picker without a
  // round-trip when the player enters the lobby screen. Window-global
  // (vs a state.js field) keeps this concern off the hot path; themes
  // are a static, rarely-touched taxonomy.
  // -----------------------------------------------------------------------

  socket.on('themesList', (themes) => {
    if (Array.isArray(themes)) {
      window.__mmThemes = themes;
      // Repopulate the picker if the lobby screen is already rendered
      // (e.g. on socket reconnect after a brief drop). renderLobby reads
      // from window.__mmThemes so a fresh render naturally picks up the
      // updated list — but if no fresh render fires, dispatch a custom
      // event the picker code listens for.
      window.dispatchEvent(new CustomEvent('mm:themes-updated'));
    }
  });

  socket.on('ruleKitsList', (kits) => {
    // Phase 6c — render the lobby quick-kit chips. Click emits selectRuleKit;
    // the server enforces host-only/waiting + applies the kit authoritatively.
    // The lobby id is read at CLICK time (chips render pre-lobby on connect).
    const container = document.getElementById('rule-kit-chips');
    renderRuleKitChips(kits, container, (kitId) => {
      socket.emit('selectRuleKit', { lobbyId: getCurrentLobbyId(), kitId });
    });
  });

  // T4f audit fix: server-authoritative config. Currently just the player
  // hard-cap, used by the publicLobbiesList renderer's "N / max" count. Guard
  // the value so a malformed/old payload can't blank the cap — only a positive
  // integer replaces the fallback of 8.
  socket.on('serverConfig', (cfg) => {
    if (cfg && Number.isInteger(cfg.maxPlayers) && cfg.maxPlayers > 0) {
      serverMaxPlayers = cfg.maxPlayers;
    }
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
        // T4g audit fix: decode off the main thread so the marquee animation
        // doesn't jank while each poster decodes. NOT loading="lazy" here — the
        // carousel is always visible (it's the page background), so lazy would
        // only add IntersectionObserver overhead with nothing to defer.
        img.decoding = 'async';
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
    // Phase 7.2 (CG-03): any state broadcast means the in-flight submit
    // resolved (accepted move, or eliminate-then-update). Idempotent — a
    // no-op when no pill is showing; safe on the frequent stateUpdate fire.
    submissionPill.clear();
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
      showScreen('game');                               // normalise top-level group: lobby→off, game→on
      resetMobileTab();                                 // keep: non-visibility side-effect

      // Phase 7.7: Clutch Save — a VALID answer I just played while my turn
      // timer was inside the panic window (spec §3.3.1). Purely additive,
      // zero socket/protocol change: the chain only grows on a valid move,
      // so a new last entry whose playerId is mine + it WAS my turn in
      // prevState ⇒ valid:true; secondsRemaining is derived from the turn I
      // just played (prevState.turnExpiresAt) using the SAME ceil()-of-ms
      // the live timer bar uses, and isClutchSave mirrors timer-panic.js's
      // ≤5s 'panic' band. markClutchSave() is consumed by the very next
      // renderGame → renderChainItems (one-shot — never replays).
      const prevChainLen = prevState?.chain?.length || 0;
      const newLast = state.chain && state.chain[state.chain.length - 1];
      const iJustPlayed = state.chain.length > prevChainLen &&
        newLast && newLast.playerId === getMyPlayerId();
      if (iJustPlayed && wasMyTurn && prevState?.turnExpiresAt) {
        const secsLeft = Math.max(0, Math.ceil((prevState.turnExpiresAt - Date.now()) / 1000));
        if (isClutchSave({ valid: true, secondsRemaining: secsLeft })) markClutchSave();
      }

      renderGame(state, getMyPlayerId(), getIsSpectator());

      // M5: Solo streak / objective celebrations. The server stamps
      // `streakMilestone` (a count) or `objectiveJustHit` (boolean) on the
      // very next state broadcast after the milestone fires, then clears
      // them in broadcastState so subsequent updates don't re-trigger.
      // We fire on either flag — both award bonus points and deserve a
      // visible "ding" so the player notices.
      if (state.gameMode === 'solo' && !getIsSpectator()) {
        if (state.streakMilestone) {
          showToast(`🔥 ${state.streakMilestone} in a row! +${state.streakMilestone} bonus`);
          playSfx('success');
        }
        if (state.objectiveJustHit) {
          showToast('🎯 Objective complete! +5 bonus');
          playSfx('win');
        }
      }

      // Only rebuild the timer interval when the turn actually changes.
      // stateUpdate fires on chat messages, reactions, and player joins too —
      // previously each event tore down and rebuilt the interval, causing
      // visible jitter and pointless work.
      const turnChanged = state.currentTurnIndex !== prevState?.currentTurnIndex
        || state.status !== prevState?.status;

      // L1: Clear the "X is typing…" indicator when the turn moves on or the
      // active player has disconnected. The peerTyping handler has a 3s
      // auto-clear, but if the active player vanishes mid-typing no event
      // arrives to fire it, so the indicator lingers and falsely suggests
      // they're still active. Backstop here using the freshly-received state:
      // either trigger covers a case the auto-clear misses.
      const activePlayer = state.players?.[state.currentTurnIndex];
      if (turnChanged || (activePlayer && activePlayer.connected === false)) {
        const typingEl = document.getElementById('peer-typing-indicator');
        if (typingEl) typingEl.classList.remove('visible');
        // typingClearTimeout is a closure variable declared further down in
        // initSocket(); accessing it here is safe because the handler body
        // doesn't execute until after initSocket() has fully run top-to-bottom.
        if (typingClearTimeout) {
          clearTimeout(typingClearTimeout);
          typingClearTimeout = null;
        }
      }

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
            // Phase 7.4: panic is a strict subset of critical — clear it
            // wherever critical is cleared so it can never outlive critical.
            if (timerBar) timerBar.classList.remove('timer-panic');
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
              // Phase 7.4: physical last-5s. toggle (not add) using the pure
              // seam so 6–10s correctly CLEARS panic while still inside the
              // critical band — panic ⊂ critical, decided in one place.
              timerBar.classList.toggle('timer-panic', timerSeverity(tr) === 'panic');
              if (tr > 0 && Math.floor(Date.now() / 1000) > getLastTickSound()) {
                playTick();
                setLastTickSound(Math.floor(Date.now() / 1000));
              }
            } else {
              timerBar.classList.remove('timer-critical');
              // Phase 7.4: tr>10 → neither critical nor panic.
              timerBar.classList.remove('timer-panic');
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
      showScreen('lobby');                              // normalise top-level group: game→off, lobby→on
      // join-panel starts visible on every page load — hide it here so a
      // stateUpdate received after a page refresh never reveals it alongside waitingRoom.
      // NOTE: hide ALL three panels (not showScreen('join') which would show join) —
      // the lobby/waiting view should show neither join nor private nor public.
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
        // L2: Capture the chain at the moment of finishing so the daily-
        // result modal can replay it. Take a snapshot rather than holding
        // a live reference because subsequent stateUpdates (e.g. the 7s
        // game-reset transition to 'waiting') would clear it.
        const finishedChain = Array.isArray(state.chain) ? state.chain.slice() : [];
        // The leaderboard response handler stores on socket._lastDailyLeaderboard;
        // poll briefly for it (server is local, expected within a few hundred ms).
        // Caps at ~2s so a slow network still surfaces the modal with whatever
        // leaderboard came back, even if it's empty.
        let elapsed = 0;
        const pollMs = 100;
        // M1: 5s cap (was 2s) covers slow mobile/3G round-trips where the
        // leaderboard response can exceed 2s, which previously caused the
        // modal to render with an empty leaderboard. The poll exits the
        // moment the response arrives (see `lb && lb.date === date` below),
        // so faster connections still feel instant; the only cost is that
        // a totally unresponsive server delays the empty-fallback by 3s.
        const maxMs = 5000;
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
              chain: finishedChain, // L2: enables the "▶ Replay" button in the modal
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
              chain: finishedChain,
            });
            return;
          }
          setTimeout(tryRender, pollMs);
        };
        setTimeout(tryRender, pollMs);
      }

      // Phase 7.6: cinematic Chain Premiere Recap. One-shot on the SAME
      // playing→finished edge the Daily modal uses (justFinished is itself
      // the guard — re-fired stateUpdates have prevState.status==='finished',
      // so this never replays — exactly the Daily-modal precedent above).
      // Daily-suppressed: the Daily-result modal already owns end-of-game in
      // Daily (its own ▶ Replay); two competing end overlays would be a UX +
      // contract risk (spec §1.6). showGameOverBanner (rendered by renderGame
      // above, L439) is byte-identical and present underneath whether or not
      // this plays — the overlay is purely additive.
      if (justFinished && !getIsDaily()) {
        const recapOverlay = document.getElementById('recap-overlay');
        // Accessibility-safe: if motion preference is unreadable (no
        // matchMedia, e.g. jsdom) OR reduced-motion is preferred → skip the
        // animation and show the settled end-state instantly (spec §1.8).
        const prefersReducedMotion = !window.matchMedia
          || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        playRecap(state, recapOverlay, { prefersReducedMotion });
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

    // Phase 7.2: route through the feedback layer. Audio/haptics stay here
    // (network-layer side effects, not UI-feedback DOM). gameEvent replicates
    // the exact prior overlay/flash/confetti behaviour for elim/win, so those
    // are behaviour-preserving. The ONE deliberate delta: kind:'info' no
    // longer takes over the centre overlay — it goes to the calm toast
    // channel (MI-01). Eliminations/wins keep the overlay via gameEvent.
    if (kind === 'elimination') {
      playFail();
      vibrate([200, 100, 200]); // attention-grabbing pattern on elimination
      gameEvent('elimination', { msg, selfElimActive });
    } else if (kind === 'win') {
      // M2: single melodic arpeggio + celebration haptics (unchanged).
      playSfx('win');
      vibrate([60, 80, 60, 80, 60]);
      gameEvent('win', { msg, selfElimActive });
    } else {
      toast(msg, { variant: 'info' });
    }
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
  // PERSONAL STATS (H5) — response to requestMyStats. Server returns a
  // fully-shaped payload (zeros for unset fields) so the client can render
  // unconditionally without null-checking every nested field.
  // -----------------------------------------------------------------------

  socket.on('myStats', (stats) => {
    // Phase 6b — pass an equip callback so the Titles wall can persist the
    // player's choice. getStableId() is the same anonymous id used by
    // requestMyStats; the server re-derives the earned set before persisting.
    renderMyStats(stats, {
      onEquip: (titleId) => socket.emit('setEquippedTitle', { stableId: getStableId(), titleId }),
    });
  });

  // -----------------------------------------------------------------------
  // PEER TYPING (M3) — server announces that the active player is typing.
  // We render a subtle "X is typing…" line under the chain area and clear
  // it after 3s of silence. The 3s timeout is just over the server's
  // 1.5s ping cadence, so a continuously-typing player keeps the line
  // visible without flicker.
  // -----------------------------------------------------------------------

  let typingClearTimeout = null;
  // -----------------------------------------------------------------------
  // PREDICTION RESULT (L3) — fired by the server when a turn resolves
  // (success or failure). Carries per-voter correctness so the spectator
  // sees a personal "you called it!" / "wrong call" toast, plus the
  // overall correct/total tally everyone hears about ("3 of 5 called it").
  // Players who didn't vote get the tally line only.
  // -----------------------------------------------------------------------

  socket.on('predictionResult', ({ outcome, correct, total, perVoter }) => {
    if (!total) return; // no votes this turn — nothing to surface
    const myVoteCorrect = perVoter && perVoter[socket.id];
    const overall = `${correct} of ${total} called it`;
    // Phase 7.2: consolidate through the toast channel with a status variant
    // (still a toast, same text/timing — purely additive colour accent).
    if (myVoteCorrect === true) {
      toast(`✅ You called it! (${overall})`, { variant: 'success' });
      playSfx('success');
    } else if (myVoteCorrect === false) {
      toast(`❌ Wrong call (${overall})`, { variant: 'error' });
      playSfx('fail');
    } else {
      toast(`🔮 ${overall}`, { variant: 'info' });
    }
  });

  socket.on('peerTyping', ({ playerName }) => {
    const el = document.getElementById('peer-typing-indicator');
    if (!el) return;
    el.textContent = `${playerName} is typing…`;
    el.classList.add('visible');
    if (typingClearTimeout) clearTimeout(typingClearTimeout);
    typingClearTimeout = setTimeout(() => {
      el.classList.remove('visible');
      typingClearTimeout = null;
    }, 3000);
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
    // Phase 7.2: validation errors use the error-variant toast channel; the
    // in-flight "Checking:" pill is resolved (the restored input + this toast
    // now carry the feedback). All other behaviour below is unchanged.
    toast((message || "Couldn't find that title.") + tail, { variant: 'error' });
    submissionPill.clear();

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

  // Phase 7.2 (CG-03): a returned search clears the "Searching…" pill, but
  // ONLY if still in searching mode — a debounced result that lands after
  // the player pressed Enter must not wipe the "Checking:" pill.
  socket.on('autocompleteResults', (payload) => {
    submissionPill.clear('searching');
    renderAutocompleteResults(payload);
  });

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
      // NOTE: not migrated \u2014 lone partial toggle (hero only).
      // Intentionally hides hero immediately to prevent flash; rejoinSuccess/
      // rejoinFailed handles the final normalised screen state. Calling
      // showScreen('lobby') or showScreen('game') here would be wrong because
      // we don't know the destination yet; showScreen('hero') would remove
      // .active from all screens including ones not visible, which is harmless
      // but the explicit intent here is a momentary hide-only, not a full
      // group normalisation.
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

    // Always hide join-flow panels — rejoining means we're already in a lobby.
    // NOTE: hide ALL three panels (not showScreen('join')) — rejoin should show
    // no panel; this "hide all" pattern is distinct from the entry-panel group.
    document.getElementById('join-panel')?.classList.add('hidden');
    document.getElementById('private-panel')?.classList.add('hidden');
    document.getElementById('public-panel')?.classList.add('hidden');

    if (data.state.status === 'playing' || data.state.status === 'finished') {
      showScreen('game');                               // normalise top-level group: hero+lobby→off, game→on
      resetMobileTab();                                 // keep: non-visibility side-effect
      renderGame(data.state, getMyPlayerId(), getIsSpectator());
    } else {
      showScreen('lobby');                              // normalise top-level group: hero+game→off, lobby→on
      showScreen('waiting');                            // normalise waiting/team pair: show waiting room
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
    showScreen('hero');                                   // normalise top-level group: lobby+game→off, hero→on
    // Returning to hero — reset the lobby sub-panels (waiting + team) so a
    // failed rejoin from a team-mode lobby doesn't leave #team-screen
    // visible-stale for the next lobby entry. getElementById is the
    // defensive panel-hide idiom already used elsewhere in this file.
    document.getElementById('waiting-room')?.classList.add('hidden');
    document.getElementById('team-screen')?.classList.add('hidden');
    const banner = document.getElementById('offline-banner'); // keep: non-visibility side-effect
    // Only show error if there was an active disconnect (banner visible)
    if (banner && !banner.classList.contains('hidden')) {
      banner.classList.add('hidden');
      showNotification(msg || 'Could not rejoin game');
    }
  });

  socket.on('kicked', (msg) => {
    showNotification(msg || 'You were removed from the lobby.');
    resetSession();
    showScreen('hero');                                   // normalise top-level group: game+lobby→off, hero→on
    if (waitingRoom) waitingRoom.classList.add('hidden'); // keep: not part of top-level group
    // teamScreen is the sibling lobby sub-panel — hide it too so a kick
    // from a team-mode lobby doesn't leave #team-screen visible-stale.
    document.getElementById('team-screen')?.classList.add('hidden');
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
