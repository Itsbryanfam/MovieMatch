// ====================== UTILS.JS ======================
// Shared utilities + audio synthesis (no DOM, no sockets)

export function escapeHtml(unsafe) {
  if (!unsafe || typeof unsafe !== 'string') return unsafe;
  return unsafe.replace(/[<>&"']/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;','\'':'&#39;'})[m]);
}

// Audio synthesis
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

export function getStableId() {
  let id = localStorage.getItem('mm_stableId');
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('mm_stableId', id);
  }
  return id;
}

export function unlockAudioGlobally() {
  const unlock = () => {
    prepareAudio();
    document.body.removeEventListener('click', unlock);
    document.body.removeEventListener('touchstart', unlock);
  };
  document.body.addEventListener('click', unlock, { once: true });
  document.body.addEventListener('touchstart', unlock, { once: true });
}
