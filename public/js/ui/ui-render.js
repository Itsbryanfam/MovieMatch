// ui/ui-render.js — lobby, game, chain, and turn-control rendering functions.
// WHY: extracted from ui.js so all screen-render logic lives in one focused
// module, making it easier to audit rendering behaviour independently of
// notifications, autocomplete, and share-card concerns.

// Import audio helpers — renderChainItems plays success audio on new entries.
import { playSuccess } from '../utils.js';
// Import socket helpers — renderLobby emits kickPlayer via the live socket.
import { getSocket, getCurrentLobbyId } from '../state.js';
// Import DOM refs and shared helpers — live bindings assigned by
// initUIElements() in ui-dom.js; attachPosterFallback lives in ui-dom
// (leaf module) so both render and autocomplete can import it without
// creating a sideways ui-autocomplete → ui-render coupling.
import {
  modeChips, modeDescription, waitingRoom, teamScreen,
  lobbyCodeDisplay, lobbyPlayersList,
  hardcoreToggle, tvShowsToggle, publicRoomToggle, startBtn,
  teamLobbyCode, teamRedList, teamBlueList, joinRedBtn, joinBlueBtn,
  teamHint, teamStartBtn,
  gameScreen, gamePlayersList, chainDisplay,
  movieInput, submitBtn, inputArea, turnIndicator, hintText,
  MODE_DESCRIPTIONS,
  attachPosterFallback,
  showScreen, // WHY: Phase 3 Task D — use canonical group-normaliser for waiting/team pair
} from './ui-dom.js';
// Import clearGhostAttempt — renderChainItems removes the ghost card when a
// new chain entry arrives, which lives in the notifications module.
// Phase 7.8: renderPendingGhost re-attaches the ghost reel-node after every
// reel rebuild (the ghost is now visually integrated into the reel, so it
// must survive the rebuild-on-every-stateUpdate pattern — see
// ui-notifications.js for the full architecture comment).
import { clearGhostAttempt, renderPendingGhost } from './ui-notifications.js';
// Phase 7.5: pure Red Carpet seams. Direct sibling import (NOT via the
// ./ui.js barrel) — ui-render.js is itself re-exported by that barrel, so a
// barrel import here would be a cycle (7.3 DAG discipline; mirrors the 7.4
// ui-panels.js → ./daily-ritual.js precedent).
// SEAT_HUES added Phase 7.5.3: renderLobby mirrors the claim-only mutex
// client-side (compute every OTHER player's effective hue) so taken
// swatches render disabled — the server is still the arbiter.
import { diffArrivals, playerCardModel, seatModel, rollCameraLabel, SEAT_HUES } from './red-carpet.js';
// Phase 7.8c — QR scan-to-join. renderQR is the thin wrapper around the
// vendored qrcode-generator; makeJoinUrl is the single source of truth for
// invite-URL format (extracted from app.js inline duplications into a leaf
// module to avoid a cycle through the ui.js barrel — see url-helpers.js).
import { renderQR } from './ui-qr.js';
import { makeJoinUrl } from '../url-helpers.js';
// Phase 7.8b: shared DOM builder — single source of truth for the seat <li>
// shape, used by both renderLobby (classic) and renderTeamScreen (team).
// WHY NOT via ui.js barrel: ui-render.js is itself re-exported by that barrel,
// so a barrel import would be a cycle (7.3 DAG discipline).
import { buildSeatNode, buildEmptySeatNode } from './ui-seat.js';

// Phase 7.7: per-turn motion timeline engine — buildTurnTimeline schedules
// the reveal→impact choreography phases; imported here (NOT via the ./ui.js
// barrel) to match the 7.5 DAG discipline (ui-render.js is itself re-exported
// by that barrel, so a barrel import would be a cycle).
import { buildTurnTimeline } from './turn-motion.js';

// Phase 7.5 Red Carpet: page-session set of player ids whose entrance card
// has already been shown, so the entrance animation plays ONCE per real
// arrival (renderLobby re-runs on EVERY stateUpdate/rejoin — idempotent).
// Module-scoped, NOT persisted, NO stableId: a full page reload resets it,
// which is the correct first-paint behaviour (everyone "arrives" once).
let _seenPlayerIds = new Set();
// Phase 7.5 Red Carpet: the lobby id the seen-set belongs to. A NEW lobby
// (id changed without a full page reload — e.g. leave→join another room on
// the same socket) is a fresh premiere, so the seen-set must be cleared or
// carried-over ids (notably the local player's own unchanged socket id)
// would suppress their entrance animation in the new room.
let _lastLobbyId = null;

// Phase 7.8b: team-mode lobby arrival tracking — mirrors the classic
// _seenPlayerIds/_lastLobbyId pattern so the entrance animation plays once per
// real arrival per lobby, idempotent across re-renders. Separate state from the
// classic set because both modes may run in the same page session (mode switch).
let _seenTeamPlayerIds = new Set();
let _lastTeamLobbyId   = null;

// Phase 7.5.2 (Theater Lobby): the theater always has exactly 8 chairs —
// one per SEAT_HUES slot (red-carpet.js), so a full lobby fills every
// collision-free hue. Module-scope constant (no per-render dependency).
const SEATS = 8;

// Phase 7.5.2 (Theater Lobby): the velvet chair, verbatim from the design
// handoff. Identical markup for every seat — recolored per-seat purely via
// the inherited `--avatar-hue` custom property (see .seat.occupied CSS). It
// MUST carry its OWN <defs>: the gradient <stop stop-color:var(--velvet-*)>
// resolves the custom property against the gradient element's own computed
// style, so a single shared <defs> would render every chair identically.
// Constant string, zero user data — safe to inject via insertAdjacentHTML.
// Phase 7.8b note: a byte-identical copy lives in public/js/ui/ui-seat.js
// (the shared buildSeatNode also injects this SVG). Keep both copies in
// sync until the DS-01 pass 2 dedupes them.
const SEAT_CHAIR_SVG = `<svg class="seat-svg" viewBox="0 0 150 120" aria-hidden="true">
  <defs>
    <linearGradient id="seat-backG" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%"  stop-color="var(--velvet-light)"/>
      <stop offset="55%" stop-color="var(--velvet-mid)"/>
      <stop offset="100%" stop-color="var(--velvet-dark)"/>
    </linearGradient>
    <linearGradient id="seat-armG" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%"  stop-color="var(--arm-light)"/>
      <stop offset="100%" stop-color="var(--arm-mid)"/>
    </linearGradient>
    <linearGradient id="seat-cushG" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%"  stop-color="var(--cushion-top)"/>
      <stop offset="100%" stop-color="var(--cushion-bot)"/>
    </linearGradient>
    <radialGradient id="seat-velvetSheen" cx="50%" cy="20%" r="60%">
      <stop offset="0%"  stop-color="rgba(255,255,255,0.10)"/>
      <stop offset="60%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>

  <ellipse cx="75" cy="116" rx="58" ry="4" fill="rgba(0,0,0,0.5)" opacity=".7"/>

  <!-- cushion peeking under the backrest -->
  <path d="M 16 86 Q 16 102 30 102 H 120 Q 134 102 134 86 V 78 H 16 Z"
        fill="url(#seat-cushG)" stroke="rgba(255,255,255,0.04)"/>
  <path d="M 18 80 Q 75 76 132 80" stroke="rgba(255,255,255,0.06)" fill="none"/>

  <!-- left arm -->
  <rect x="6"   y="44" width="16" height="50" rx="6" fill="url(#seat-armG)" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>
  <ellipse cx="14"  cy="44" rx="9" ry="3.5" fill="var(--arm-cap)" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>
  <ellipse cx="14"  cy="43" rx="6" ry="1.5" fill="rgba(255,255,255,0.08)"/>

  <!-- right arm -->
  <rect x="128" y="44" width="16" height="50" rx="6" fill="url(#seat-armG)" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>
  <ellipse cx="136" cy="44" rx="9" ry="3.5" fill="var(--arm-cap)" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>
  <ellipse cx="136" cy="43" rx="6" ry="1.5" fill="rgba(255,255,255,0.08)"/>

  <!-- backrest -->
  <path d="M 24 14 Q 24 4 36 4 H 114 Q 126 4 126 14 V 86 H 24 Z"
        fill="url(#seat-backG)" stroke="rgba(0,0,0,0.4)" stroke-width="0.8"/>
  <path d="M 24 14 Q 24 4 36 4 H 114 Q 126 4 126 14 V 86 H 24 Z"
        fill="url(#seat-velvetSheen)"/>
  <!-- top piping -->
  <path d="M 24 14 Q 24 4 36 4 H 114 Q 126 4 126 14"
        fill="none" stroke="var(--piping)" stroke-width="2" stroke-linecap="round"/>

  <!-- tuft stitching: 3 vertical channels -->
  <line x1="50"  y1="20" x2="50"  y2="78" stroke="var(--stitch)" stroke-width="1"   stroke-dasharray="2 5"/>
  <line x1="75"  y1="20" x2="75"  y2="78" stroke="var(--stitch)" stroke-width="1.2" stroke-dasharray="2 5"/>
  <line x1="100" y1="20" x2="100" y2="78" stroke="var(--stitch)" stroke-width="1"   stroke-dasharray="2 5"/>

  <!-- tuft buttons -->
  <circle cx="50"  cy="32" r="1.2" fill="rgba(0,0,0,0.5)"/>
  <circle cx="50"  cy="52" r="1.2" fill="rgba(0,0,0,0.5)"/>
  <circle cx="50"  cy="72" r="1.2" fill="rgba(0,0,0,0.5)"/>
  <circle cx="75"  cy="32" r="1.2" fill="rgba(0,0,0,0.5)"/>
  <circle cx="75"  cy="52" r="1.2" fill="rgba(0,0,0,0.5)"/>
  <circle cx="75"  cy="72" r="1.2" fill="rgba(0,0,0,0.5)"/>
  <circle cx="100" cy="32" r="1.2" fill="rgba(0,0,0,0.5)"/>
  <circle cx="100" cy="52" r="1.2" fill="rgba(0,0,0,0.5)"/>
  <circle cx="100" cy="72" r="1.2" fill="rgba(0,0,0,0.5)"/>

  <!-- back/cushion seam shadow -->
  <rect x="24" y="84" width="102" height="3" fill="rgba(0,0,0,0.45)"/>
</svg>`;

export function renderLobby(gameState, myPlayerId) {
  const amIHost = !!gameState.players.find(p => p.id === myPlayerId && p.isHost);
  const mode = gameState.gameMode || 'classic';

  modeChips.forEach(chip => {
    chip.classList.toggle('active', chip.dataset.mode === mode);
    chip.disabled = !amIHost;
  });
  if (modeDescription) modeDescription.innerText = MODE_DESCRIPTIONS[mode] || '';

  // Phase 5a: tear down any previously-rendered Add-Bot row on EVERY render,
  // BEFORE the team-mode early return — otherwise a classic/speed→team
  // switch would leave a stale .add-bot-row node lingering in the DOM
  // (renderLobby runs on every stateUpdate; this keeps it idempotent).
  const prevBotRow = startBtn.parentNode && startBtn.parentNode.querySelector('.add-bot-row');
  if (prevBotRow) prevBotRow.remove();

  if (mode === 'team') {
    showScreen('team');                           // normalise waiting/team pair: show team
    renderTeamScreen(gameState, myPlayerId, amIHost);
    return;
  } else {
    showScreen('waiting');                        // normalise waiting/team pair: show waiting
  }

  lobbyCodeDisplay.innerText = gameState.id || '';

  // Phase 7.5 Red Carpet: a NEW lobby (gameState.id changed without a full
  // page reload) is a fresh premiere — clear the seen-set so every player
  // "arrives" once in the new room. Without this, ids carried from a prior
  // lobby (notably the local player's own unchanged socket id) would
  // suppress their entrance. Same-lobby re-renders keep the set (animate
  // once per real arrival, never replayed on a settings-toggle re-render).
  if (gameState.id !== _lastLobbyId) {
    _seenPlayerIds = new Set();
    _lastLobbyId = gameState.id;
  }
  // diffArrivals is pure; the seen-set is page-session module state (NOT
  // persisted, NO stableId).
  const { entering, seen } = diffArrivals(_seenPlayerIds, gameState.players);
  _seenPlayerIds = new Set(seen);
  // WHY a local Set for membership: diffArrivals returns `entering` as an
  // ORDERED array (pure, trivially unit-assertable — Task 0 pins it as an
  // array, do not change that contract). Lobby rosters are tiny (≤~12 incl.
  // bots) so cost is irrelevant, but set-ifying here keeps the per-player
  // membership check O(1) and the intent explicit (no O(n·m) .includes in
  // the render loop).
  const enteringSet = new Set(entering);

  lobbyPlayersList.innerHTML = '';
  // Phase 7.5.2 (Theater Lobby): the lobby is now a theater of 8 velvet
  // chairs. ALWAYS render exactly 8 <li class="seat"> — the first
  // players.length OCCUPIED, the rest EMPTY slots — so the house fills up
  // visibly.
  // Phase 7.8b: seat DOM delegated to the shared ui-seat.js builder
  // (buildSeatNode / buildEmptySeatNode). Output is byte-identical to the
  // pre-7.8b inline block — the unedited render-lobby.test.js and
  // red-carpet-seat-table.test.js suites are the regression proof.
  for (let slot = 0; slot < SEATS; slot++) {
    const p = gameState.players[slot];

    if (!p) {
      // Empty seat slot — shared builder (classic mode only).
      lobbyPlayersList.appendChild(buildEmptySeatNode(slot));
      continue;
    }

    // Build the classic model (SEAT_HUES slot hue, optional pick override).
    const model = seatModel(p, { mode: 'classic', slot, myPlayerId });
    const isEntering = enteringSet.has(p.id);

    // Compute takenByOthers for the swatch strip — only needed when isYou
    // since buildSeatNode gates on cbs.onPickHue + model.isYou.
    let takenByOthers;
    if (model.isYou) {
      takenByOthers = new Set();
      gameState.players.forEach((op, oi) => {
        if (oi === slot) return; // own slot — skip when collecting other players' hues
        const eff = (Number.isInteger(op.colorHue) && SEAT_HUES.includes(op.colorHue))
          ? op.colorHue
          : SEAT_HUES[((oi % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length];
        takenByOthers.add(eff);
      });
    }

    const node = buildSeatNode(
      model,
      {
        // onKick / onRemoveBot only provided to host (caller gating — classic §4).
        onKick:      amIHost ? (id) => getSocket().emit('kickPlayer',  { lobbyId: gameState.id, targetId: id }) : null,
        onRemoveBot: amIHost ? (id) => getSocket().emit('removeBot',   { lobbyId: gameState.id, targetId: id }) : null,
        // onPickHue provided for local player only — swatches require isYou.
        onPickHue:   model.isYou ? (hue) => getSocket().emit('selectColor', { lobbyId: gameState.id, hue }) : null,
      },
      {
        playerId: p.id,
        isEntering,
        takenByOthers,
        allHues: SEAT_HUES,
        containerForCleanup: lobbyPlayersList,
      }
    );
    lobbyPlayersList.appendChild(node);
  }

  // Theater status line.
  const seatedCount = document.getElementById('seated-count');
  if (seatedCount) seatedCount.textContent = String(gameState.players.length);
  const seatedHint = document.getElementById('seated-hint');
  if (seatedHint) {
    seatedHint.textContent = gameState.players.length < 2
      ? 'Waiting for more cast…'
      : 'Ready when the Director rolls camera.';
  }

  // Phase 7.5 (bounded DS-01): the inline `lobbySettings.style.display =
  // 'flex'` write + the index.html style="display:none;" are removed (and
  // the now-unused `lobbySettings` ui-dom import dropped above) — the
  // existing `.lobby-settings` rule (02-hero-lobby.css) is already
  // `display:flex`, and the block only needs to be hidden while its
  // ancestor #waiting-room is `.hidden` (the screen system handles that,
  // and #waiting-room ships with class="hidden" so there is no FOUC). Net
  // rendered result is identical; one less inline-style write + one less
  // dead import.

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
  // Phase 7.5.2 (Theater Lobby): the ledger's visible .toggle-pill is
  // CSS-driven by `.ledger-row.on` (the real .ledger-checkbox is visually
  // hidden: position:absolute;opacity:0;width:0;height:0;pointer-events:none).
  // The React prototype set `.on` in JSX; vanilla must mirror checkbox→.on
  // here or the pill is permanently OFF (host gets no confirmation, guests
  // can't see the room rules). The emit/change-handler path is unchanged —
  // this only reflects state visually. ?. guards against a missing row.
  hardcoreToggle.closest('.ledger-row')?.classList.toggle('on', gameState.hardcoreMode || false);
  tvShowsToggle.checked = gameState.allowTvShows || false;
  tvShowsToggle.disabled = !amIHost;
  tvShowsToggle.closest('.ledger-row')?.classList.toggle('on', gameState.allowTvShows || false);
  if (publicRoomToggle) {
    publicRoomToggle.checked = gameState.isPublic || false;
    publicRoomToggle.disabled = !amIHost || mode === 'solo';
  }

  // Phase 7.5 Red Carpet: the Start button becomes "Roll Camera". The
  // ENABLE/DISABLE truth-table is byte-identical to the pre-7.5 logic
  // (rollCameraLabel computes canStart = solo ? >=1 : >=2 and enables only
  // when canStart && amIHost) — ONLY the copy is re-voiced + a variant class
  // for the Task-2 CSS. The old inline startBtn.style.display='block' write
  // + the index.html style="display:none;" are removed (bounded DS-01); the
  // additive .roll-camera rule restores the exact block layout.
  const roll = rollCameraLabel({
    amIHost,
    playerCount: gameState.players.length,
    mode,
  });
  startBtn.classList.add('roll-camera');
  startBtn.classList.remove('roll-camera--ready', 'roll-camera--waiting-host', 'roll-camera--waiting-cast');
  startBtn.classList.add('roll-camera--' + roll.variant);
  // WHY textContent (not innerText): button carries no HTML children — they
  // are semantically identical for plain-text button labels; textContent is
  // the DOM-spec setter that jsdom honours in tests (innerText is layout-
  // dependent and not fully implemented in jsdom 26). The rendered browser
  // result is identical (single text node either way).
  startBtn.textContent = roll.text;
  startBtn.disabled = roll.disabled;

  // Phase 5a / 7.8b: host-only "Add Bot" + difficulty selector. Only classic/
  // speed (mirrors the server gate so the UI never offers an action the server
  // rejects). Extracted to shared helper so renderTeamScreen can reuse it.
  const botModeOk = gameState.gameMode === 'classic' || gameState.gameMode === 'speed';
  if (amIHost && botModeOk) {
    const botRow = buildAddBotRow(amIHost, gameState.id);
    if (botRow) startBtn.insertAdjacentElement('afterend', botRow);
  }

  // Phase 7.8c — paint the lobby QR if its mount node exists and we have a
  // lobby code. The memo inside renderQR skips re-encoding on every render
  // call, so this is cheap to invoke unconditionally.
  const classicQrMount = document.querySelector('#waiting-room-qr .lobby-qr-svg');
  if (classicQrMount && gameState.id) {
    renderQR(classicQrMount, makeJoinUrl(gameState.id));
  }
}

// Phase 7.8b: shared host-only "Add Bot" row builder. Extracted from the
// renderLobby inline block so both renderLobby (classic/speed) and
// renderTeamScreen (team) can call the same builder — single source of truth
// for the row shape and the addBot emit payload. Existing socket event +
// payload unchanged (spec §8 guardrail 8).
//
// @param {boolean} host     True when the local player is the host.
// @param {string}  lobbyId  The current lobby id (passed in — no state read).
// @returns {HTMLDivElement|null}  The row element, or null when host is falsy.
function buildAddBotRow(host, lobbyId) {
  if (!host) return null;
  const botRow = document.createElement('div');
  botRow.className = 'add-bot-row';
  const sel = document.createElement('select');
  sel.className = 'bot-diff-select';
  // a11y: the select has no visible <label>; the adjacent button provides
  // sighted context, so screen readers need an explicit name here.
  sel.setAttribute('aria-label', 'Bot difficulty');
  // Default to 'Normal' so it's the pre-selected value when the host opens
  // the lobby; easy/hard are secondary choices.
  [['normal', 'Normal'], ['easy', 'Easy'], ['hard', 'Hard']].forEach(([v, label]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    sel.appendChild(o);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-secondary'; // reuse Phase 4 additive .btn
  addBtn.textContent = '+ Add Bot';
  addBtn.addEventListener('click', () => {
    getSocket().emit('addBot', { lobbyId, difficulty: sel.value });
  });
  botRow.appendChild(addBtn);
  botRow.appendChild(sel);
  return botRow;
}

// Phase 7.8b — team-mode lobby rewritten to full parity with the classic
// Theater Lobby: cinema-screen headers, seat-style chairs (one team color
// per side via --seat-team-color), Director shell mirroring House Rules +
// Start Match. Calls the same buildSeatNode the classic lobby uses (single
// source of truth). Existing socket emit paths unchanged (spec §8).
export function renderTeamScreen(gameState, myPlayerId, amIHost) {
  if (!teamLobbyCode || !teamRedList || !teamBlueList) return;
  teamLobbyCode.innerText = gameState.id || '';

  // Arrival diff — mirrors the classic _seenPlayerIds/_lastLobbyId pattern.
  // A NEW lobby id (same socket, different room) resets the seen-set so
  // everyone "arrives" once in the new room.
  if (gameState.id !== _lastTeamLobbyId) {
    _seenTeamPlayerIds = new Set();
    _lastTeamLobbyId   = gameState.id;
  }
  const { entering, seen } = diffArrivals(_seenTeamPlayerIds, gameState.players);
  const enteringSet = new Set(entering);
  _seenTeamPlayerIds = new Set(seen);

  const myTeamId = gameState.players.find(p => p.id === myPlayerId)?.teamId;

  // Build per-team seat rows using the shared DOM builder.
  // No empty placeholder seats — team roster is variable length (spec §3.5).
  [teamRedList, teamBlueList].forEach((list, teamIdNum) => {
    list.innerHTML = '';
    const teamName = teamIdNum === 0 ? 'red' : 'blue';
    gameState.players
      .filter(p => p.teamId === teamIdNum)
      .forEach(p => {
        const model = seatModel(p, { mode: 'team', team: teamName, myPlayerId });
        const node  = buildSeatNode(
          model,
          {
            // Kick callbacks host-only, as in classic mode.
            onKick:      amIHost ? (id) => getSocket().emit('kickPlayer', { lobbyId: gameState.id, targetId: id }) : null,
            onRemoveBot: amIHost ? (id) => getSocket().emit('removeBot',  { lobbyId: gameState.id, targetId: id }) : null,
            // No onPickHue — team mode has one color per side (spec §1 decision 1).
            onPickHue: null,
          },
          {
            playerId:          p.id,
            isEntering:        enteringSet.has(p.id),
            containerForCleanup: list,
          }
        );
        list.appendChild(node);
      });
  });

  // Join button disabled-state — preserved verbatim from pre-7.8b.
  if (joinRedBtn)  joinRedBtn.disabled  = (myTeamId === 0);
  if (joinBlueBtn) joinBlueBtn.disabled = (myTeamId === 1);

  // Start gating + hint — preserved verbatim.
  const team0 = gameState.players.filter(p => p.teamId === 0);
  const team1 = gameState.players.filter(p => p.teamId === 1);
  const teamsReady = team0.length >= 1 && team1.length >= 1;
  if (teamHint) {
    teamHint.innerText = teamsReady
      ? `${team0.length} vs ${team1.length} — Ready to start!`
      : 'Teams need at least 1 player each.';
  }
  if (teamStartBtn) {
    // WHY inline style (not class): mirrors the pre-7.8b contract exactly —
    // the test pins .style.display directly and the start btn ships with
    // style="display:none" in index.html. Changing to a CSS class would
    // require a new CSS rule and editing the test, which is out of scope.
    teamStartBtn.style.display = (amIHost && teamsReady) ? 'block' : 'none';
  }

  // WHY duplicate (not extracted): operates on different elements (-team suffix)
  // than the classic block above. A shared helper would need an element-ref
  // parameter and is deferred to DS-01 pass 2 — both paths can be unified there.
  // House Rules ledger — sync the team-suffixed controls + .ledger-row.on.
  // Mirrors the classic renderLobby ledger sync block (hardcoreToggle, etc.)
  // but targets the -team element ids introduced in the Phase 7.8b HTML update.
  const themeSelTeam = document.getElementById('theme-select-team');
  if (themeSelTeam) {
    const themes = Array.isArray(window.__mmThemes)
      ? window.__mmThemes
      : [{ id: 'any', label: '🎬 Any (no theme)' }];
    const expectedIds = themes.map(t => t.id).join('|');
    if (themeSelTeam.dataset.themeIds !== expectedIds) {
      themeSelTeam.textContent = '';
      themes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.label;
        if (t.description) opt.title = t.description;
        themeSelTeam.appendChild(opt);
      });
      themeSelTeam.dataset.themeIds = expectedIds;
    }
    themeSelTeam.value    = gameState.theme || 'any';
    themeSelTeam.disabled = !amIHost;
  }
  const hcTeam = document.getElementById('hardcore-toggle-team');
  if (hcTeam) {
    hcTeam.checked  = gameState.hardcoreMode || false;
    hcTeam.disabled = !amIHost;
    hcTeam.closest('.ledger-row')?.classList.toggle('on', gameState.hardcoreMode || false);
  }
  const tvTeam = document.getElementById('tv-shows-toggle-team');
  if (tvTeam) {
    tvTeam.checked  = gameState.allowTvShows || false;
    tvTeam.disabled = !amIHost;
    tvTeam.closest('.ledger-row')?.classList.toggle('on', gameState.allowTvShows || false);
  }

  // Add Bot row — host-only, shared helper. WHY innerHTML='': we clear the
  // container and re-insert each render so the bot row stays idempotent (the
  // same pattern renderLobby uses for startBtn.querySelector('.add-bot-row')).
  const botContainer = document.getElementById('add-bot-row-team');
  if (botContainer) {
    botContainer.innerHTML = '';
    if (amIHost) {
      const row = buildAddBotRow(amIHost, gameState.id);
      if (row) botContainer.appendChild(row);
    }
  }

  // Phase 7.8c — paint the team-screen QR. Same mount-pattern as classic.
  const teamQrMount = document.querySelector('#team-screen-qr .lobby-qr-svg');
  if (teamQrMount && gameState.id) {
    renderQR(teamQrMount, makeJoinUrl(gameState.id));
  }
}

// Phase 7.7: Clutch Save + per-turn motion timeline driver state. WHY a
// module-level flag (not a renderGame signature change): socketClient.js
// detects the clutch on the playing edge and calls markClutchSave() right
// before the renderGame it already invokes — additive, mirrors how 7.6 added
// playRecap as a new ui export called from socketClient (no signature/
// protocol change). The single cancellable handle is the leak-safe
// recap-player.js pattern (_recapTimer/cancelRecap).
let _clutchPending = false;
let _turnMotionTimer = null;

export function markClutchSave() { _clutchPending = true; }
export function cancelTurnMotion() {
  // WHY: matches the recap-player.js cancelRecap() pattern — one module-level
  // handle, cleared on cancel so isPending checks are trivial.
  if (_turnMotionTimer) { clearTimeout(_turnMotionTimer); _turnMotionTimer = null; }
}

// Drive the now-playing node's per-turn presentation.
//
// POST-MERGE FIX (2026-05-19, after PR#39): users reported that "guesses
// take a long time to validate connections." The cause was the per-turn
// motion timeline below — .phase-reveal's CSS animation `reelRevealRise`
// uses `animation-fill-mode: both` with `from { opacity: 0 }`, which snaps
// the freshly-revealed poster to opacity:0 the frame after it appears,
// then fades in over 600ms, then runs a 500ms .phase-impact scale-lock
// (1.1s total). That stretched the visual confirmation of an accepted
// guess from a snappy beat into a noticeable wait. The settled DOM is
// already painted by renderChainItems, so we now ALWAYS short-circuit to
// the settled end-state (matching the previous reduced-motion / jsdom path
// — see render-chain.test.js L171 "settled end-state, no pending timers")
// and skip the phase-reveal/phase-impact timeline entirely. The clutch
// flash + .clutch glow still fire on actual clutch saves (the intended
// cinematic moment), so the user-earned surprise is preserved.
//
// buildTurnTimeline + cancelTurnMotion + _turnMotionTimer remain available
// in this module: buildTurnTimeline is independently tested as a pure
// engine (turn-motion.test.js) and may be reused for future cinematic
// passes; keeping the cancel + timer handle preserves the leak-safe
// contract if a later patch reintroduces a scheduled phase.
function choreographTurn(heroNode, gameState, clutch) {
  if (!heroNode) return;
  if (clutch) {
    // Clutch save IS the cinematic moment — keep the glow + flash overlay.
    // The .clutch-flash CSS animation in 06-states-anim.css fades it out
    // on its own; the DOM node persists harmlessly until the next render
    // replaces the filmstrip.
    heroNode.classList.add('clutch');
    const flash = document.createElement('div');
    flash.className = 'clutch-flash';
    flash.textContent = 'CLUTCH SAVE';
    heroNode.appendChild(flash);
  }
  // Instant settled end-state for ALL turns — restores the pre-PR#39
  // "instant" feel users expect when validating connections. No phase
  // classes added, no timers scheduled. Cancel any in-flight phase timer
  // from a prior render so a stale tick can never re-apply a phase class
  // to the freshly-rebuilt filmstrip.
  cancelTurnMotion();
  heroNode.classList.add('settled');
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
      // Phase 5a: when it's a BOT's turn, show a derived "thinking…" cue so
      // other players see deliberate AI pacing instead of a silent timer.
      // Pure state-derived (active player isBot + their turn) — NO new socket
      // event. A span so it sits beside the existing turn highlight without
      // disturbing row layout rules.
      if (p.isBot && index === gameState.currentTurnIndex && gameState.status === 'playing') {
        const thinking = document.createElement('span');
        thinking.className = 'bot-thinking';
        // Spacing handled via CSS margin-left on .bot-thinking (no leading space needed).
        thinking.textContent = '🤖 thinking…';
        li.appendChild(thinking);
      }
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

// Phase 7.7: the chain is the horizontal Constellation filmstrip — a reel of
// poster nodes + labeled actor bridges + a glowing now-playing hero + a
// full-width, full-name, ALL-member, ungated cast panel. WHY a deterministic
// full rebuild of a .filmstrip CHILD of #chain-display (NOT #chain-display
// .innerHTML): showGameOverBanner independently appendChild()s its
// .game-over-banner into #chain-display at game-over — rebuilding only the
// .filmstrip child leaves that banner sibling byte-identical and never
// clobbered (spec §1.7 / §4.8). Task 1 paints the SETTLED end-state on every
// render; Task 2 layers the per-turn motion timeline + Clutch Save on top
// without removing any behaviour here.
function renderChainItems(gameState, myPlayerId) {
  const displayEl = chainDisplay;
  const chain = gameState.chain;

  // pre-first-move: the empty-board hint (preserved verbatim from the 1.0,
  // built with createElement so it never relies on innerHTML for the path
  // the §4.8 test pins).
  if (chain.length === 0 && gameState.status === 'playing') {
    displayEl.querySelector('.filmstrip')?.remove();
    // Sweep fix (issue 4): when a new game starts (e.g. Solo "Play Again"
    // or host re-start), the previous game's `.game-over-banner` was left
    // sitting at the top of #chain-display above the new "The board is
    // empty" hint. The status-conditional cleanup below (L737) only ran
    // on a NON-empty chain, so the empty-→-playing edge missed it.
    // Clearing it here covers the new-game edge without affecting the
    // legit finished-state persistence (banners MUST stay through
    // finished-state re-renders — §4.8 / spec §1.7; status is 'playing'
    // here so we are NOT in that case).
    displayEl.querySelector('.game-over-banner')?.remove();
    if (!displayEl.querySelector('.empty-board-hint')) {
      const hint = document.createElement('div');
      hint.className = 'empty-board-hint';
      const icon = document.createElement('span');
      icon.className = 'empty-board-icon';
      icon.textContent = '🎬';
      const title = document.createElement('span');
      title.className = 'empty-board-title';
      title.textContent = 'The board is empty';
      const sub = document.createElement('span');
      sub.className = 'empty-board-sub';
      sub.textContent = 'Waiting for the first move...';
      hint.appendChild(icon);
      hint.appendChild(title);
      hint.appendChild(sub);
      displayEl.appendChild(hint);
    }
    return;
  }

  // hard reset (chain cleared / new game) — drop the filmstrip + any hint
  // (the 1.0 L626-630 intent: nothing to show).
  if (chain.length === 0) {
    displayEl.querySelectorAll('.filmstrip, .empty-board-hint').forEach(n => n.remove());
    return;
  }

  // a (re)started game has a chain again → clear stale end-of-game artifacts.
  // .game-over-banner and .empty-hint are status-conditional (banners MUST
  // persist across finished-state re-renders — §4.8 / spec §1.7); but the
  // empty-board-hint must clear UNCONDITIONALLY when a chain exists, otherwise
  // a direct playing-empty → finished-with-chain transition (forfeit race /
  // late-join spectator path) could leave it stuck alongside the filmstrip.
  if (gameState.status === 'playing') {
    displayEl.querySelector('.game-over-banner')?.remove();
    displayEl.querySelector('.empty-hint')?.remove();
  }
  displayEl.querySelector('.empty-board-hint')?.remove();

  // .filmstrip is the rebuilt child; its dataset.count carries the
  // previously-rendered chain length so the "new entry only" side effects
  // (clearGhostAttempt + playSuccess) fire exactly when the 1.0 fired them
  // — NOT on every idempotent stateUpdate re-render.
  let film = displayEl.querySelector('.filmstrip');
  const prevCount = film ? Number(film.dataset.count || 0) : 0;
  const grew = chain.length > prevCount;

  if (grew) {
    // a new chain entry arrived → the prior ghost attempt is stale
    // (preserved from the 1.0 L645-648).
    clearGhostAttempt();
  }

  if (film) {
    while (film.firstChild) film.removeChild(film.firstChild);
  } else {
    film = document.createElement('div');
    film.className = 'filmstrip';
    // FIRST child so showGameOverBanner's appendChild()'d banner renders
    // AFTER the reel — exactly as the 1.0 banner rendered after the chain.
    displayEl.insertBefore(film, displayEl.firstChild);
  }
  film.dataset.count = String(chain.length);

  const reel = document.createElement('div');
  reel.className = 'reel';
  const lastIdx = chain.length - 1;

  for (let index = 0; index < chain.length; index++) {
    const item = chain[index];

    // bridge BEFORE this node (index>0): the actor linking it to the
    // previous movie — the semantics the 1.0 bold-shared-actor carried.
    if (index > 0) {
      const linkActor = (item.matchedActors || [])[0];
      const bridge = document.createElement('div');
      bridge.className = 'reel-bridge';
      bridge.textContent = linkActor ? `↔ ${linkActor}` : '↔';
      reel.appendChild(bridge);
    }

    const node = document.createElement('div');
    node.className = 'reel-node';
    if (index === lastIdx) node.classList.add('now-playing');
    // Best-effort burned stamp (spec §1.5): the live chain entry shape
    // carries NO per-link elimination marker today, so this NEVER fires on
    // real data — defensive + NO fabrication. Tested both ways (§4.5).
    const eliminated = !!(item && item.eliminated === true);
    if (eliminated) node.classList.add('burned');

    if (item.movie.poster && item.movie.poster.startsWith('https://image.tmdb.org/')) {
      const img = document.createElement('img');
      img.src = item.movie.poster;
      img.alt = 'Poster';
      img.className = 'reel-poster';
      // WHY: off-screen reel posters defer-load — additive perf, no
      // behaviour change (spec §1.10).
      img.loading = 'lazy';
      attachPosterFallback(img, 'reel-poster');
      node.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'reel-poster placeholder';
      node.appendChild(ph);
    }

    const who = document.createElement('div');
    who.className = 'reel-who';
    who.textContent = item.playerName;
    node.appendChild(who);

    const title = document.createElement('div');
    title.className = 'reel-title';
    title.textContent = `${item.movie.title} (${item.movie.year})`;
    node.appendChild(title);

    if (eliminated) {
      const stamp = document.createElement('div');
      stamp.className = 'reel-burned-stamp';
      stamp.textContent = 'OUT';
      node.appendChild(stamp);
    }

    reel.appendChild(node);
  }
  film.appendChild(reel);

  // Phase 7.8: re-attach the pending ghost (if any) at the end of the reel
  // so it survives the rebuild-on-every-stateUpdate pattern. The ghost is
  // visually integrated into the chain narrative — a faded reel-node with
  // a broken `✗` bridge — instead of the legacy red sliver appended below
  // the filmstrip. No-op when no ghost is pending. (`clearGhostAttempt`
  // was already called above on `grew`, so the only ghost that survives
  // here is one from an attemptFailed that hasn't been overtaken by a
  // valid play yet.)
  renderPendingGhost(reel);

  // The now-playing cast panel — full-width, FULL names, EVERY member,
  // ungated (spec §1.2 — identical data to the 1.0 .movie-cast; the §4 hinge).
  const nowItem = chain[lastIdx];
  const panel = document.createElement('div');
  panel.className = 'now-cast';

  const head = document.createElement('div');
  head.className = 'now-cast-head';
  const link = document.createElement('span');
  link.className = 'now-cast-link';
  const linkedVia = (nowItem.matchedActors || [])[0];
  link.textContent = (lastIdx > 0 && linkedVia)
    ? `${nowItem.playerName} linked via ${linkedVia}`
    : `${nowItem.playerName} · the chain starts here`;
  head.appendChild(link);
  const ttl = document.createElement('div');
  ttl.className = 'now-cast-title';
  ttl.textContent = `${nowItem.movie.title} (${nowItem.movie.year})`;
  head.appendChild(ttl);
  panel.appendChild(head);

  const list = document.createElement('div');
  list.className = 'now-cast-list';
  const castList = nowItem.movie.cast || [];
  let emitted = 0;
  castList.forEach((actor) => {
    // tolerate {id,name} or legacy bare string (verbatim from the 1.0
    // L692-697); FULL name, never abbreviated (spec §1.2).
    const actorName = typeof actor === 'string' ? actor : (actor && actor.name) || '';
    if (!actorName) return;
    if (emitted > 0) list.appendChild(document.createTextNode(' · '));
    const span = document.createElement('span');
    span.className = 'cast-name';
    span.textContent = actorName;
    list.appendChild(span);
    emitted++;
  });
  panel.appendChild(list);
  film.appendChild(panel);

  // Newest pinned right — the horizontal analog of the 1.0
  // `chainDisplay.scrollTop = scrollHeight`. A ONE-TIME scroll-position set,
  // NOT a rAF loop (spec §1.10). No-op under jsdom (no layout) — harmless.
  //
  // Post-PR#41 follow-up: PR#41 (sweep fix issue 1) moved overflow-x from
  // .filmstrip onto .filmstrip .reel so the cast panel below would stop
  // scrolling with the posters. That left this line targeting `film` —
  // which no longer has overflow — so `film.scrollLeft = …` became a
  // silent no-op and the reel sat at its default scrollLeft of 0 (the
  // FIRST poster, left edge), instead of being auto-focused on the
  // newest hero at the right. Retarget to the actual scroll container.
  reel.scrollLeft = reel.scrollWidth;

  // A new entry by another player still chimes (preserved from the 1.0
  // L722-724) — gated on growth so idempotent re-renders never spam it.
  if (grew && nowItem && nowItem.playerId !== myPlayerId) {
    playSuccess();
  }

  // Phase 7.7: consume the one-shot clutch flag (set by socketClient on the
  // playing edge) and drive the per-turn choreography on the hero node. The
  // flag is consumed every render so it can never replay on an idempotent
  // stateUpdate re-fire (the 7.6 one-shot discipline). The flag-consume must
  // happen UNCONDITIONALLY (not only on grew) so a non-grow render after a
  // grow render reliably clears the flag, preventing contamination across
  // tests and across idempotent re-fires.
  const clutch = _clutchPending;
  _clutchPending = false;
  if (grew) {
    choreographTurn(reel.querySelector('.reel-node.now-playing'), gameState, clutch);
  }
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
  // Phase 4: .btn additive base (cursor:pointer already on btn-primary); zero visual change.
  shareBtn.className = 'btn btn-primary';
  shareBtn.textContent = '🎬 Share Results';
  actionsDiv.appendChild(shareBtn);

  if (isHost) {
    const playAgainBtn = document.createElement('button');
    playAgainBtn.id = 'play-again-btn';
    // Phase 4: .btn additive base (cursor:pointer already on btn-secondary); zero visual change.
    playAgainBtn.className = 'btn btn-secondary';
    playAgainBtn.textContent = '↩ Play Again';
    actionsDiv.appendChild(playAgainBtn);
  }

  banner.appendChild(titleDiv);
  banner.appendChild(subtitleDiv);
  banner.appendChild(actionsDiv);

  chainDisplay.appendChild(banner);
  chainDisplay.scrollTop = chainDisplay.scrollHeight;
}
