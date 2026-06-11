// ui/ui-notifications.js — transient UI feedback: notification overlay,
// elimination/win flashes, confetti, ghost-attempt card, and toast.
// WHY: grouping all ephemeral feedback functions keeps them separate from
// the persistent screen-render logic in ui-render.js, making it easy to
// audit or replace the feedback layer without touching render paths.

// Import notification DOM refs — live bindings written by initUIElements().
// Phase 7.8: attachPosterFallback is now used by the ghost-attempt card,
// which renders a faded reel-node with a real TMDB poster (when available)
// inside the Constellation reel. The same broken-image → designed-placeholder
// fallback the chain entries use applies here.
import { notificationOverlay, notificationText, chainDisplay, attachPosterFallback } from './ui-dom.js';

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
// GHOST ATTEMPT (Phase 7.8) — REDESIGNED for the Constellation board.
//
// The pre-7.8 ghost was a red sliver appended below the chainDisplay's
// filmstrip + cast panel. With the Phase 7.7 Constellation board its full-
// width cast panel pushed the sliver off-screen on common viewports, and
// even when visible the card lived OUTSIDE the new visual language users
// just learned for the chain.
//
// 7.8 lifts the ghost INTO the chain itself: a faded reel-node + a broken
// `✗` bridge appended at the end of the reel, immediately after the now-
// playing hero. The narrative reads as a movie history:
//   [Movie1] ↔ [Movie2] ↔ [Movie3 NOW] ✗ [Ghost: what they tried]
// The ghost reel-node reuses the chain-entry shape (poster, name, title),
// so the visual language stays consistent — but it's grayscale-filtered
// with a dashed red border and a big ✗ stamp, so it's unmistakable as a
// failed attempt rather than another link in the chain.
//
// Architecture: showGhostAttempt stores the payload in module-state and
// (re-)renders the node into the live reel. renderChainItems rebuilds the
// reel from chain data on every stateUpdate, so it calls renderPendingGhost
// AFTER appending the chain nodes to keep the ghost stable across the
// dozen-times-per-turn re-renders triggered by chat/reactions/joins.
// Clearing happens on (a) 8s auto-timer, (b) a new attemptFailed
// replacing it, or (c) the chain growing (handled by renderChainItems).
// ---------------------------------------------------------------------------
let ghostAttemptTimer = null;
let _pendingGhost = null; // {playerName, movieTitle, year, poster, reason}

export function showGhostAttempt({ playerName, movieTitle, year, poster, reason }) {
  if (!chainDisplay) return;
  // Cancel any in-flight auto-clear so the new 8s window starts fresh.
  if (ghostAttemptTimer) clearTimeout(ghostAttemptTimer);
  // Stash payload so renderChainItems can re-attach the ghost on every
  // stateUpdate-driven reel rebuild (chat, reactions, etc.) — without
  // this, the next innocent stateUpdate would wipe the ghost.
  _pendingGhost = { playerName, movieTitle, year, poster, reason };
  ghostAttemptTimer = setTimeout(clearGhostAttempt, 8000);

  // Try to render into the current reel immediately (don't wait for the
  // next stateUpdate — the failed attempt should feel instant).
  const reel = chainDisplay.querySelector('.filmstrip .reel');
  if (reel) renderPendingGhost(reel);
}

export function clearGhostAttempt() {
  if (ghostAttemptTimer) {
    clearTimeout(ghostAttemptTimer);
    ghostAttemptTimer = null;
  }
  _pendingGhost = null;
  // Sweep both the new constellation-integrated ghost AND any lingering
  // legacy .ghost-attempt nodes in case an old session still has one in
  // its DOM (defensive — the new code never emits .ghost-attempt).
  chainDisplay?.querySelectorAll('.reel-node-ghost, .reel-bridge-broken, .ghost-attempt')
    .forEach(el => el.remove());
}

// Called by renderChainItems (ui-render.js) AFTER it rebuilds the .reel's
// chain nodes, so the pending ghost survives the rebuild-on-every-
// stateUpdate pattern. Idempotent: removes any existing ghost in the reel
// before re-attaching, so calling this twice in a row doesn't double up.
// Exported so it lives in the same module as the ghost lifecycle (and the
// payload it consumes), not in ui-render.js — ui-render has the reel
// rebuild plumbing, but the ghost feature owns its own DOM contract here.
export function renderPendingGhost(reel) {
  if (!reel) return;
  // Always wipe any stale ghost first — the reel was just rebuilt, so any
  // ghost in it is from a previous render and may have a different payload.
  reel.querySelectorAll('.reel-node-ghost, .reel-bridge-broken').forEach(el => el.remove());
  if (!_pendingGhost) return;

  const { playerName, movieTitle, year, poster, reason } = _pendingGhost;

  // Broken bridge — visual cue that the connection failed. Sits between
  // the now-playing hero and the ghost reel-node.
  const bridge = document.createElement('div');
  bridge.className = 'reel-bridge reel-bridge-broken';
  bridge.textContent = '✗';

  // Booth T5 fix: fire the torn-seam recoil animation when the broken bridge
  // first appears. WHY add then remove on animationend: lets the same bridge
  // element re-animate if showGhostAttempt is called a second time while the
  // 8 s window is still open (a rapid second failed attempt clears and
  // re-renders, so a fresh animationend listener is safe here).
  bridge.classList.add('booth-seam-recoil');
  bridge.addEventListener('animationend', () => {
    bridge.classList.remove('booth-seam-recoil');
  }, { once: true });

  reel.appendChild(bridge);

  // Ghost reel-node — borrows the .reel-node layout so the failed attempt
  // sits in the same horizontal cadence as the chain entries.
  const node = document.createElement('div');
  node.className = 'reel-node reel-node-ghost';

  // Booth T5 fix: fire the strip-recoil animation on the ghost node as soon
  // as it enters the DOM. WHY add before appendChild: the class must be on
  // the element when it connects to the document so the CSS animation starts
  // from keyframe 0% (adding after insert risks missing the first paint).
  // WHY animationend cleanup: the ghost node is replaced on every
  // renderPendingGhost call so leak risk is negligible, but cleanup keeps the
  // pattern consistent with the other Booth T5 animation hooks.
  node.classList.add('booth-recoil');
  node.addEventListener('animationend', () => {
    node.classList.remove('booth-recoil');
  }, { once: true });

  // Poster: same TMDB-URL gate the chain entries use, with the same
  // attachPosterFallback so a broken poster degrades to the designed
  // placeholder rather than a broken-image glyph.
  if (poster && typeof poster === 'string' && poster.startsWith('https://image.tmdb.org/')) {
    const img = document.createElement('img');
    img.src = poster;
    img.alt = '';
    img.className = 'reel-poster';
    img.loading = 'lazy';
    attachPosterFallback(img, 'reel-poster');
    node.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'reel-poster placeholder';
    node.appendChild(placeholder);
  }

  // Big ✗ stamp overlay on the poster — unmistakable failure mark.
  const stamp = document.createElement('div');
  stamp.className = 'reel-ghost-stamp';
  stamp.textContent = '✗';
  node.appendChild(stamp);

  // Player name + "tried" — borrows the .reel-who slot from chain entries.
  const who = document.createElement('div');
  who.className = 'reel-who';
  who.textContent = `${playerName} tried`;
  node.appendChild(who);

  // Movie title (with year if available) — borrows .reel-title.
  const title = document.createElement('div');
  title.className = 'reel-title';
  title.textContent = year ? `${movieTitle} (${year})` : movieTitle;
  node.appendChild(title);

  // Reason — a small red footnote below the title.
  const reasonEl = document.createElement('div');
  reasonEl.className = 'reel-ghost-reason';
  reasonEl.textContent = reason || 'Invalid connection';
  node.appendChild(reasonEl);

  reel.appendChild(node);

  // Auto-focus the freshly-appended ghost (same scrollIntoView pattern
  // PR#43 introduced for the legacy ghost). `inline: 'end'` keeps the
  // newest content at the right of the horizontal reel, matching PR#42.
  node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
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
