// ui/ui-notifications.js — transient UI feedback: notification overlay,
// elimination/win flashes, confetti, ghost-attempt card, and toast.
// WHY: grouping all ephemeral feedback functions keeps them separate from
// the persistent screen-render logic in ui-render.js, making it easy to
// audit or replace the feedback layer without touching render paths.

// Import notification DOM refs — live bindings written by initUIElements().
import { notificationOverlay, notificationText, chainDisplay } from './ui-dom.js';

let notificationTimeout = null;
export function showNotification(msg) {
  notificationText.innerText = msg;
  notificationOverlay.classList.remove('hidden', 'is-exiting');

  if (notificationTimeout) clearTimeout(notificationTimeout);
  notificationTimeout = setTimeout(() => {
    notificationOverlay.classList.add('is-exiting');
    setTimeout(() => {
      notificationOverlay.classList.add('hidden');
      notificationOverlay.classList.remove('is-exiting', 'notification--elimination');
    }, 300);
  }, 3000);
}

export function showEliminationFlash() {
  const el = document.createElement('div');
  el.className = 'elimination-flash';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// H3: Optionally accepts a `details` object with the failed-attempt context
// (last chain entry's cast vs. the player's guess). When present, renders a
// side-by-side card so the player learns *why* they lost. When absent
// (timeout, disconnect, quit), falls back to the original 3-second flash.
//
// The detailed card is dismissable instead of auto-removed — players need
// to be able to read both cast lists, which often takes longer than 3s.
// All text content is inserted via DOM APIs (textContent / createElement),
// not innerHTML interpolation, to preserve the codebase's no-innerHTML XSS
// posture for any user-controlled data (movie titles come from TMDB but
// the principle is consistent across the file).
export function showSelfEliminationScreen(details) {
  const el = document.createElement('div');
  el.className = 'self-elim-screen';

  // Simple/legacy path — no details, brief auto-dismiss flash.
  // 7.1: a timeout payload has lastChainEntry + timedOut but no yourGuess —
  // it must take the detailed path, not the legacy flash.
  if (!details || !details.lastChainEntry || (!details.yourGuess && !details.timedOut)) {
    el.innerHTML = `
      <div class="self-elim-icon">💀</div>
      <div class="self-elim-title">You've Been Eliminated</div>
      <div class="self-elim-sub">Spectating from here on out</div>
    `;
    // The card no longer auto-removes itself when details are absent — but
    // keep the original behavior for the legacy flash so existing tests and
    // edge cases (timeouts, disconnects) still feel snappy.
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
    return;
  }

  // H3 detailed path — render the side-by-side cast comparison.
  el.classList.add('self-elim-screen--detailed');
  // Make the screen interactive so the close button can be clicked.
  el.style.pointerEvents = 'auto';

  const card = document.createElement('div');
  card.className = 'self-elim-card';

  const head = document.createElement('div');
  head.className = 'self-elim-head';
  const icon = document.createElement('div');
  icon.className = 'self-elim-icon';
  icon.textContent = '💀';
  const title = document.createElement('div');
  title.className = 'self-elim-title';
  // 7.1: timeout payloads get a distinct head so the player knows why they
  // were eliminated (froze vs. bad connection) without reading the sub-line.
  title.textContent = details.timedOut ? "Time's up — you froze" : "You've Been Eliminated";
  const sub = document.createElement('div');
  sub.className = 'self-elim-sub';
  sub.textContent = details.reason || (details.timedOut ? 'You ran out of time' : 'Invalid connection');
  head.appendChild(icon);
  head.appendChild(title);
  head.appendChild(sub);

  // Two columns: "needed" (last chain entry) and "you played" (the guess).
  // Cast lists are top-10 only — anything longer would visually overwhelm
  // the card and the actor that mattered (or didn't) is almost always in
  // the top of the cast list anyway. Already trimmed server-side.
  const grid = document.createElement('div');
  grid.className = 'self-elim-grid';

  const buildColumn = (label, movie, columnClass) => {
    const col = document.createElement('div');
    col.className = `self-elim-col ${columnClass}`;
    const colLabel = document.createElement('div');
    colLabel.className = 'self-elim-col-label';
    colLabel.textContent = label;
    const colTitle = document.createElement('div');
    colTitle.className = 'self-elim-col-title';
    // textContent is XSS-safe — escapes interpretation as HTML.
    colTitle.textContent = `${movie.title || 'Unknown'} (${movie.year || '?'})`;
    const castList = document.createElement('div');
    castList.className = 'self-elim-col-cast';
    (movie.cast || []).forEach((name, i) => {
      if (i > 0) castList.appendChild(document.createTextNode(', '));
      castList.appendChild(document.createTextNode(name));
    });
    col.appendChild(colLabel);
    col.appendChild(colTitle);
    col.appendChild(castList);
    return col;
  };

  grid.appendChild(buildColumn('Needed a connection to', details.lastChainEntry, 'self-elim-col--needed'));
  // 7.1: no guess on a timeout — render only the needed column so we don't
  // try to render an empty/undefined yourGuess as a movie card.
  if (!details.timedOut && details.yourGuess) {
    grid.appendChild(buildColumn('You played', details.yourGuess, 'self-elim-col--played'));
  }

  // Phase 7.1: surface up to 3 outs (movies that would have connected via a
  // shared actor) so the player learns the concrete missed opportunity. Each
  // out is {title, year, viaActor} — all rendered via textContent (no
  // innerHTML) to preserve the file's XSS posture; titles/actors are
  // TMDB-sourced but we stay consistent. The bridge line replaces the generic
  // hint when outs are present — a specific lesson is more actionable.
  let outsEl = null;
  if (Array.isArray(details.outs) && details.outs.length) {
    outsEl = document.createElement('div');
    outsEl.className = 'self-elim-outs';
    const lbl = document.createElement('div');
    lbl.className = 'self-elim-outs-label';
    lbl.textContent = 'You had outs:';
    outsEl.appendChild(lbl);
    details.outs.slice(0, 3).forEach(o => {
      const row = document.createElement('div');
      row.className = 'self-elim-outs-row';
      const y = o && o.year ? ` (${o.year})` : '';
      const via = o && o.viaActor ? ` — via ${o.viaActor}` : '';
      // textContent only — titles/actors are TMDB-sourced; no innerHTML.
      row.textContent = `${(o && o.title) || 'Unknown'}${y}${via}`;
      outsEl.appendChild(row);
    });
    const bridge = document.createElement('div');
    bridge.className = 'self-elim-bridge';
    bridge.textContent = 'You were one bridge away.';
    outsEl.appendChild(bridge);
  }

  // Generic hint is the no-outs fallback only — when we have concrete outs the
  // bridge line above carries the lesson.
  let hint = null;
  if (!outsEl) {
    hint = document.createElement('div');
    hint.className = 'self-elim-hint';
    hint.textContent = 'No actor appears in both casts above. Look for shared names next time.';
  }

  // Dismiss button — explicit close so screen-reader users have a clear
  // exit. Pressing Escape also dismisses (handled via the close path).
  const close = document.createElement('button');
  close.className = 'self-elim-close';
  close.type = 'button';
  close.textContent = 'Continue spectating';
  const dismiss = () => {
    el.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);

  card.appendChild(head);
  card.appendChild(grid);
  // 7.1: outs block (if present) replaces the generic hint; hint is null when
  // outsEl is set, so exactly one of these appends a non-null element.
  if (outsEl) card.appendChild(outsEl);
  if (hint) card.appendChild(hint);
  card.appendChild(close);
  el.appendChild(card);

  document.body.appendChild(el);
  // Move focus into the card for keyboard users so Escape and Tab land
  // somewhere predictable.
  close.focus();
}

export function showWinFlash() {
  const el = document.createElement('div');
  el.className = 'win-flash';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

// M2: Confetti burst on win. Pure DOM + CSS — no library, no canvas. ~40
// pieces with randomized colors, horizontal start positions, fall durations,
// and rotation rates. Each piece is positioned absolutely at the top, falls
// to the bottom of the viewport, and self-removes when its animation ends.
//
// Performance: 40 elements with one CSS animation each is well under the
// repaint budget on any device made in the last decade. Skips work entirely
// when prefers-reduced-motion is set — the global CSS rule would zero out
// the animation duration, but creating + removing 40 elements is still
// pointless under reduced motion, so we bail at the JS layer.
export function showConfetti() {
  // Match the CSS reduced-motion gate at the JS level so we don't even
  // create the elements when motion is suppressed.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colors = ['#fbbf24', '#f43f5e', '#34d399', '#60a5fa', '#a78bfa', '#fb923c'];
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  const PIECE_COUNT = 40;
  for (let i = 0; i < PIECE_COUNT; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    // Randomize color, horizontal position, fall duration, sway, rotation.
    const color = colors[Math.floor(Math.random() * colors.length)];
    const left = Math.random() * 100;            // 0–100% of viewport width
    const duration = 1.8 + Math.random() * 1.4;  // 1.8–3.2s fall
    const delay = Math.random() * 0.4;           // 0–400ms stagger
    const sway = (Math.random() - 0.5) * 80;     // ±40px horizontal drift
    const rotate = Math.random() * 720 - 360;    // ±1 full revolution
    piece.style.background = color;
    piece.style.left = left + 'vw';
    piece.style.animationDuration = duration + 's';
    piece.style.animationDelay = delay + 's';
    // Pass per-piece values to the CSS keyframes via custom properties so
    // a single keyframe definition can cover all variations (otherwise
    // we'd need to inject inline keyframes per piece, which is heavier).
    piece.style.setProperty('--sway', sway + 'px');
    piece.style.setProperty('--rotate', rotate + 'deg');
    container.appendChild(piece);
  }

  // Auto-remove the container after the longest piece finishes (max 3.2s
  // duration + 0.4s delay = 3.6s) plus a small grace window. Keeps the DOM
  // clean and prevents stacking confetti containers if a player wins
  // multiple back-to-back games.
  setTimeout(() => container.remove(), 4000);
}

// ---------------------------------------------------------------------------
// GHOST ATTEMPT — transient card showing a player's failed submission so
// other players can see what was tried. Auto-clears after 8s, replaced if
// another attempt fails, and removed when the chain advances (handled by
// renderChainItems — see clearGhostAttempt call there).
// ---------------------------------------------------------------------------
let ghostAttemptTimer = null;

export function showGhostAttempt({ playerName, movieTitle, reason }) {
  if (!chainDisplay) return;
  // Replace any existing ghost so only the latest attempt is visible
  clearGhostAttempt();

  const ghost = document.createElement('div');
  ghost.className = 'ghost-attempt';

  const icon = document.createElement('span');
  icon.className = 'ghost-attempt-icon';
  icon.textContent = '✗';

  const body = document.createElement('div');
  body.className = 'ghost-attempt-body';

  const title = document.createElement('div');
  title.className = 'ghost-attempt-title';
  // Audit finding #9: structural DOM instead of innerHTML interpolation.
  // "<playerName> tried <em><movieTitle></em>" built from text nodes + a
  // real <em> element — no HTML string assembled from user-controlled data.
  const emTitle = document.createElement('em');
  emTitle.textContent = movieTitle;
  title.append(
    document.createTextNode(playerName + ' tried '),
    emTitle
  );

  const reasonEl = document.createElement('div');
  reasonEl.className = 'ghost-attempt-reason';
  reasonEl.textContent = reason || 'Invalid connection';

  body.appendChild(title);
  body.appendChild(reasonEl);
  ghost.appendChild(icon);
  ghost.appendChild(body);

  chainDisplay.appendChild(ghost);
  chainDisplay.scrollTop = chainDisplay.scrollHeight;

  ghostAttemptTimer = setTimeout(clearGhostAttempt, 8000);
}

export function clearGhostAttempt() {
  if (ghostAttemptTimer) {
    clearTimeout(ghostAttemptTimer);
    ghostAttemptTimer = null;
  }
  chainDisplay?.querySelectorAll('.ghost-attempt').forEach(el => el.remove());
}

// Phase 7.2 (MI-01): showToast gains an optional variant so the feedback
// router can colour validation errors / successes differently from neutral
// info, WITHOUT changing the call shape for existing string-only callers
// (default 'info' = today's neutral look). `toast.className = 'copy-toast'`
// already wipes any prior variant/visible class on the reused element, so
// re-adding the variant below can never leak across consecutive toasts.
export function showToast(msg, { variant = 'info' } = {}) {
  const toast = document.querySelector('.copy-toast') || document.createElement('div');
  toast.className = 'copy-toast';
  toast.classList.add('copy-toast--' + variant);
  toast.textContent = msg;
  if (!toast.parentElement) document.body.appendChild(toast);
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}
