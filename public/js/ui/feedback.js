// ui/feedback.js — Phase 7.2 feedback-layer split.
// WHY: a thin POLICY layer over the existing ui-notifications primitives so
// non-dramatic feedback stops borrowing the cinematic centre overlay (MI-01)
// and later phases have a stable calm-feedback API. One-way dependency
// (feedback -> ui-notifications); never import socketClient/app here.
import {
  showNotification, showEliminationFlash, showWinFlash, showConfetti, showToast,
} from './ui-notifications.js';

// Transient, non-blocking channel. Delegates to the (now variant-aware)
// showToast primitive so there is exactly one toast implementation.
export function toast(message, opts) {
  // showToast returns undefined; drop the no-op return so callers see no implied value
  showToast(message, opts);
}

// Dramatic channel. Replicates EXACTLY the visual branching socketClient's
// notification handler did (showNotification gated by selfElimActive, the
// elimination overlay class + board shake, the win flash/confetti), so
// routing eliminations/wins through here is behaviour-preserving. Audio/
// haptics (playFail/playSfx/vibrate) stay in the socket handler — they are
// network-layer side effects, not UI-feedback DOM, and keeping them out of
// this module avoids pulling utils.js audio deps into the UI layer.
export function gameEvent(kind, { msg = '', selfElimActive = false } = {}) {
  if (!selfElimActive) showNotification(msg);

  if (kind === 'elimination') {
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
    // Win supersedes any in-flight elimination flash from the same losing turn.
    document.querySelectorAll('.elimination-flash').forEach((el) => el.remove());
    showWinFlash();
    showConfetti();
  }
  // kind 'info'/unknown: showNotification above already handled the text.
  // (In 7.2 the socket handler routes 'info' to toast() instead and never
  // calls gameEvent for it — this branch stays for any direct caller.)
}
