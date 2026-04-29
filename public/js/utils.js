// ============================================================================
// UTILS — Shared utilities + audio synthesis
// ============================================================================
// No DOM manipulation, no socket calls. Safe to import from any module.
// ============================================================================

export function escapeHtml(unsafe) {
  if (!unsafe || typeof unsafe !== 'string') return unsafe;
  return unsafe.replace(/[<>&"']/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;','\'':'&#39;'})[m]);
}

// ---------------------------------------------------------------------------
// AUDIO SYNTHESIS (Web Audio API)
// ---------------------------------------------------------------------------
// audioCtx is lazily initialized on first use — creating it at module load
// time would trigger browser autoplay-policy warnings before any user gesture.
let AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;

export function playTone(frequency, type, duration) {
  if (!audioCtx) audioCtx = new AudioCtx();
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration);
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + duration);
}

export function playSuccess() {
  playTone(600, 'sine', 0.1);
  setTimeout(() => playTone(800, 'sine', 0.2), 100);
}

export function playFail() {
  playTone(300, 'sawtooth', 0.3);
  setTimeout(() => playTone(250, 'sawtooth', 0.4), 150);
}

export function playTick() {
  playTone(1000, 'square', 0.05);
}

export function prepareAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

// ---------------------------------------------------------------------------
// STABLE CLIENT ID
// ---------------------------------------------------------------------------
// A persistent random ID stored in localStorage so a player can be recognised
// across socket reconnects (the socket.id changes on every reconnect).
// The 'p_' prefix distinguishes it from other localStorage keys at a glance.
export function getStableId() {
  let id = localStorage.getItem('mm_stableId');
  if (!id) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = 'p_' + Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('');
    localStorage.setItem('mm_stableId', id);
  }
  return id;
}

// ---------------------------------------------------------------------------
// AUDIO UNLOCK
// ---------------------------------------------------------------------------
// Browsers block AudioContext.resume() until a user gesture has occurred.
// We hook the first click/touch to resume the context, then remove the listeners.
export function unlockAudioGlobally() {
  const unlock = () => {
    prepareAudio();
    document.body.removeEventListener('click', unlock);
    document.body.removeEventListener('touchstart', unlock);
  };
  document.body.addEventListener('click', unlock, { once: true });
  document.body.addEventListener('touchstart', unlock, { once: true });
}
