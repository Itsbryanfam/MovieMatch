// public/js/ui/ui-seat.js — impure DOM builder for seat <li> nodes.
// Phase 7.8b. WHY a dedicated module: the seat DOM is the single biggest
// shape both renderLobby (classic) and renderTeamScreen (team) build.
// Hoisting it out of ui-render.js avoids that file growing further and
// gives both callers a single source of truth — the same pure-seam-then-
// thin-glue pattern as red-carpet.js, chain-recap.js, turn-motion.js.
//
// model  — output of seatModel(player, opts) from red-carpet.js.
// callbacks — { onKick(id), onRemoveBot(id), onPickHue(hue) }
//   All optional: a missing callback means that affordance is not wired
//   (host-only and is-you cases are gated by the caller passing or omitting).
// extra  — { playerId, isEntering, takenByOthers, allHues, containerForCleanup }
//
// Branch on model.team:
//   present  → team mode: .seat.team-<color>, --seat-team-color set, no
//              swatches, no --avatar-hue. T2 CSS scopes its overrides here.
//   absent   → classic mode: byte-identical to the pre-7.8b inline builder
//              (the unedited render-lobby.test.js suite is the regression proof).

// SEAT_CHAIR_SVG — verbatim copy from ui-render.js. WHY duplicated: ui-seat.js
// is a leaf module (no imports from its sibling ui-render.js — that would be a
// circular dep: ui-render imports ui-seat, ui-seat would import ui-render).
// Both copies must stay in sync; a DS-01 pass can introduce a shared constant
// once the circular-dep risk is assessed. Constant, zero user data — safe for
// insertAdjacentHTML.
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

/**
 * Build an EMPTY seat placeholder <li> (classic mode only — team mode uses
 * variable-length rosters with no empty slots).
 *
 * @param {number} slot  0-based seat index (drives the "SEAT 01" label).
 * @returns {HTMLLIElement}
 */
export function buildEmptySeatNode(slot) {
  // WHY createElement throughout (no innerHTML for dynamic content):
  // consistent with file convention; SEAT_CHAIR_SVG constant is safe for
  // insertAdjacentHTML (zero user data, no XSS vector).
  const li = document.createElement('li');
  li.className = 'seat';
  li.dataset.slot = String(slot);

  const num = document.createElement('div');
  num.className = 'seat-num';
  num.textContent = 'SEAT ' + String(slot + 1).padStart(2, '0');
  li.appendChild(num);

  const wrap = document.createElement('div');
  wrap.className = 'seat-svg-wrap';
  const spot = document.createElement('div');
  spot.className = 'seat-spotlight';
  wrap.appendChild(spot);
  wrap.insertAdjacentHTML('beforeend', SEAT_CHAIR_SVG); // constant, no user data
  li.appendChild(wrap);

  return li;
}

/**
 * Build an OCCUPIED seat <li>. Branches on model.team:
 *
 *   model.team present  → team mode:
 *     - classes: "seat occupied team-<color>" (+ is-you/is-host/is-bot/entering)
 *     - CSS: --seat-team-color: var(--team-<color>) — T2 CSS scopes overrides here
 *     - NO .seat-swatches, NO --avatar-hue
 *
 *   model.team absent   → classic mode:
 *     - classes: "seat occupied" (+ is-you/is-host/is-bot/entering/has-picked)
 *     - CSS: --avatar-hue: <model.accentHue>
 *     - .seat-swatches built when model.isYou && cbs.onPickHue && ex.allHues
 *
 * Both branches produce identical nameplate / avatar / chair / kick structure
 * so the DOM shape stays consistent for styling purposes.
 *
 * @param {object} model      Output of seatModel(player, opts).
 * @param {object} callbacks  { onKick, onRemoveBot, onPickHue } — all optional.
 * @param {object} extra      { playerId, isEntering, takenByOthers, allHues,
 *                              containerForCleanup }
 * @returns {HTMLLIElement}
 */
export function buildSeatNode(model, callbacks, extra) {
  const cbs = callbacks || {};
  const ex  = extra    || {};
  const li  = document.createElement('li');

  const isTeam = !!model.team;

  // Compose className: base flags + optional team suffix (team mode) or
  // has-picked (classic mode). WHY concatenation not classList.add: mirrors
  // the pre-7.8b inline builder's single-assignment style; both are correct
  // but this keeps the diff minimal for the regression proof.
  li.className =
    'seat occupied'
    + (model.isYou        ? ' is-you'               : '')
    + (model.isHost       ? ' is-host'              : '')
    + (model.isBot        ? ' is-bot'               : '')
    + (ex.isEntering      ? ' entering'             : '')
    + (!isTeam && model.hasPickedColor ? ' has-picked' : '')
    + (isTeam             ? ` team-${model.team}`   : '');

  if (ex.playerId != null) li.dataset.playerId = String(ex.playerId);

  if (isTeam) {
    // Team mode: --seat-team-color drives the new .seat.team-red/.team-blue
    // overrides that T2 will add. No per-seat hue variable in team mode —
    // team identity supersedes per-player color identity (spec §1 decision 1).
    li.style.setProperty('--seat-team-color', `var(--team-${model.team})`);
  } else {
    // Classic mode: --avatar-hue feeds the existing velvet/arm/cushion recolor.
    // Room-scoped slot index; NO stableId (Phase-1 leak fix preserved).
    li.style.setProperty('--avatar-hue', String(model.accentHue));
  }

  // ---- nameplate ----
  // WHY structured composition (not card.label): the pre-7.8b inline builder
  // already adopted this pattern in Phase 7.6.1 to prevent double-crown
  // overflow. Consistent here for team mode too.
  const plate = document.createElement('div');
  plate.className = 'nameplate';
  if (model.isHost) {
    const crown = document.createElement('span');
    crown.className = 'crown';
    crown.title = 'Host';
    crown.textContent = '♛';
    plate.appendChild(crown);
  }
  const nameSpan = document.createElement('span');
  nameSpan.className = 'seat-name';
  nameSpan.textContent = model.name + (model.wins > 0 ? ` • ${model.wins} 🏆` : '');
  plate.appendChild(nameSpan);
  if (model.isYou) {
    const youPill = document.createElement('span');
    youPill.className = 'you-pill';
    youPill.textContent = 'YOU';
    plate.appendChild(youPill);
  } else if (model.isBot) {
    const botPill = document.createElement('span');
    botPill.className = 'bot-pill';
    botPill.textContent = 'BOT';
    plate.appendChild(botPill);
  }
  li.appendChild(plate);

  // ---- person / avatar emoji ----
  const person = document.createElement('div');
  person.className = 'seat-person';
  const av = document.createElement('div');
  av.className = 'avatar-emoji';
  av.setAttribute('aria-hidden', 'true'); // decorative; name carries identity
  av.textContent = model.accentEmoji;
  person.appendChild(av);
  li.appendChild(person);

  // ---- swatches (classic is-you ONLY; team mode never builds them) ----
  // WHY gated on all three: onPickHue absent ⇒ caller doesn't want swatches
  // (non-host path from renderLobby); allHues absent ⇒ safe no-op.
  if (!isTeam && model.isYou && cbs.onPickHue && Array.isArray(ex.allHues)) {
    const strip = document.createElement('div');
    strip.className = 'seat-swatches';
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Pick your seat colour');
    const taken = ex.takenByOthers instanceof Set ? ex.takenByOthers : new Set();
    const myEff = model.accentHue;
    ex.allHues.forEach(hue => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'swatch';
      sw.style.setProperty('--avatar-hue', String(hue));
      sw.setAttribute('aria-label', 'Seat colour ' + hue);
      if (hue === myEff) {
        sw.classList.add('is-selected');
        sw.disabled = true;
        sw.setAttribute('aria-pressed', 'true');
      } else if (taken.has(hue)) {
        sw.classList.add('is-taken');
        sw.disabled = true;
      } else {
        sw.addEventListener('click', () => cbs.onPickHue(hue));
      }
      strip.appendChild(sw);
    });
    li.appendChild(strip);
  }

  // ---- chair SVG + spotlight + optional kick button ----
  const wrap = document.createElement('div');
  wrap.className = 'seat-svg-wrap';
  const spot = document.createElement('div');
  spot.className = 'seat-spotlight';
  wrap.appendChild(spot);
  wrap.insertAdjacentHTML('beforeend', SEAT_CHAIR_SVG); // constant, no user data

  // Kick wired only when caller passes a callback AND seat is not local viewer.
  // Bot kicks emit removeBot; human kicks emit kickPlayer (§4 byte-identical).
  if (!model.isYou && (cbs.onKick || cbs.onRemoveBot) && ex.playerId != null) {
    const kickBtn = document.createElement('button');
    kickBtn.className = 'seat-kick';
    kickBtn.title = 'Kick';
    kickBtn.dataset.kickId = String(ex.playerId);
    kickBtn.textContent = '✕';
    kickBtn.addEventListener('click', () => {
      if (model.isBot && cbs.onRemoveBot) cbs.onRemoveBot(ex.playerId);
      else if (cbs.onKick) cbs.onKick(ex.playerId);
    });
    wrap.appendChild(kickBtn);
  }
  li.appendChild(wrap);

  // ---- entering cleanup (one-shot: strip after 1400ms, keyed by player id) ----
  // WHY containerForCleanup ref: the seat is appended after this function returns,
  // so we can't query the li directly — we must query the container by data-player-id.
  if (ex.isEntering && ex.containerForCleanup) {
    const id = ex.playerId;
    setTimeout(() => {
      const el = ex.containerForCleanup.querySelector('li.seat[data-player-id="' + id + '"]');
      if (el) el.classList.remove('entering');
    }, 1400);
  }

  return li;
}
