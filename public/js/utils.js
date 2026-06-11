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
// MUTE STATE
// ---------------------------------------------------------------------------

let muted = localStorage.getItem('mm_muted') === 'true';

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  localStorage.setItem('mm_muted', String(muted));
  return muted;
}

// ---------------------------------------------------------------------------
// AUDIO (M2) — playSfx(name) with sample-or-synth fallback
// ---------------------------------------------------------------------------
// audioCtx is lazily initialized on first use — creating it at module load
// time would trigger browser autoplay-policy warnings before any user gesture.
let AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;

// Cache decoded AudioBuffers per URL so repeated SFX don't re-fetch and
// re-decode. A null entry means "we tried and the file is missing" — we
// remember that and skip fetching again, falling through to synthesis.
const _sampleCache = new Map();

// Tries to fetch + decode the SFX file at `url`. Returns an AudioBuffer on
// success, or null if the file is missing/unreadable (in which case the
// caller should synthesize). Errors are absorbed silently — sound is
// decorative, never load-bearing.
async function _loadSample(url) {
  if (_sampleCache.has(url)) return _sampleCache.get(url);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      _sampleCache.set(url, null);
      return null;
    }
    const buf = await response.arrayBuffer();
    if (!audioCtx) audioCtx = new AudioCtx();
    const decoded = await audioCtx.decodeAudioData(buf);
    _sampleCache.set(url, decoded);
    return decoded;
  } catch {
    _sampleCache.set(url, null);
    return null;
  }
}

// Play a single oscillator with an envelope. M2 upgrade over the old
// playTone: configurable attack and uses exponential release for a
// slightly less synthy "click" at the start. Returns the gain node so
// callers can chain (e.g. add a noise burst layer on top).
function _envelope(frequency, type, duration, peakGain = 0.12, attackMs = 8) {
  if (muted) return null;
  if (!audioCtx) audioCtx = new AudioCtx();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  // Exponential ramp-in (attack) softens the front edge so notes don't
  // start with a digital click. exponentialRampToValueAtTime needs a
  // non-zero starting value, hence 0.0001.
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, audioCtx.currentTime + attackMs / 1000);
  gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration + 0.02);
  return gain;
}

// Backwards-compat: keep the old playTone signature around. Some places
// in the codebase may import it directly; the new envelope just makes it
// sound a touch nicer with no API change.
export function playTone(frequency, type, duration) {
  _envelope(frequency, type, duration, 0.1, 4);
}

// SFX_DEFS — named sound effects with both a sample URL and a synth
// fallback. The samples are looked up under /sfx/{name}.mp3; if the file
// is missing (or fetch fails) the synth function runs instead. This lets
// the project ship without any audio files (synth covers everything) and
// lets the dev drop real samples in /public/sfx/ later for a quality
// upgrade with no code changes.
const SFX_DEFS = {
  // Confirmation ding — used after a successful play. Two layered sines
  // form a major-third interval, exponentially decayed for a "harp pluck"
  // feel rather than the old plain sine wave.
  success: {
    url: '/sfx/success.mp3',
    synth: () => {
      _envelope(523.25, 'sine', 0.18, 0.10, 6); // C5
      setTimeout(() => _envelope(659.25, 'sine', 0.22, 0.10, 6), 80); // E5
    },
  },
  // Failure buzz — descending pitch on sawtooth with a subtle noise
  // overlay for grit. Shorter than the old version so it doesn't drag.
  fail: {
    url: '/sfx/fail.mp3',
    synth: () => {
      // T5d ESLint: was `const g = _envelope(...)` but `g` was never read —
      // dropped the unused binding while KEEPING the call so the first
      // envelope still plays (the side effect is the whole point). Behavior-
      // identical: an unused return value is the only thing removed.
      _envelope(280, 'sawtooth', 0.32, 0.12, 4);
      // Pitch drop adds a "wah" feel — sweeps the second oscillator down.
      setTimeout(() => _envelope(180, 'sawtooth', 0.32, 0.10, 4), 100);
    },
  },
  // Turn-tick — short high pulse used during the timer's last seconds.
  // Shorter than the old version (40ms vs 50ms) so it doesn't blur into
  // itself when the timer is tight.
  tick: {
    url: '/sfx/tick.mp3',
    synth: () => _envelope(1100, 'square', 0.04, 0.06, 2),
  },
  // Win fanfare — three-note ascending arpeggio. Replaces the old
  // playSuccess-three-times pattern with something more melodic.
  win: {
    url: '/sfx/win.mp3',
    synth: () => {
      _envelope(523.25, 'sine', 0.18, 0.12, 6); // C5
      setTimeout(() => _envelope(659.25, 'sine', 0.18, 0.12, 6), 130); // E5
      setTimeout(() => _envelope(783.99, 'sine', 0.32, 0.14, 6), 260); // G5
    },
  },
  // Elimination thud — low sine with a sharp attack. Distinct from `fail`
  // so the eliminated player can tell "I'm out for good" apart from "I
  // missed but can keep playing."
  elimination: {
    url: '/sfx/elimination.mp3',
    synth: () => {
      _envelope(150, 'sine', 0.4, 0.16, 2);
      setTimeout(() => _envelope(110, 'sine', 0.5, 0.14, 2), 80);
    },
  },
};

// Public SFX API. Tries the named sample; falls back to the synth def.
// Returns nothing useful (fire-and-forget) — caller can't tell which
// path ran, which is fine for decorative sound.
export async function playSfx(name) {
  if (muted) return;
  const def = SFX_DEFS[name];
  if (!def) return;
  // Resume the audio context if it was suspended by a recent autoplay
  // policy or a backgrounded tab. unlockAudioGlobally() handles the
  // initial unlock; this is the recovery path.
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  // Try the file first. If it loads, play the buffer. Otherwise synth.
  // Async, so a slow first fetch shouldn't block the synth fallback —
  // but the Map cache means subsequent calls are synchronous after the
  // first probe of any given URL.
  const sample = await _loadSample(def.url);
  if (sample) {
    if (!audioCtx) audioCtx = new AudioCtx();
    const src = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    src.buffer = sample;
    gain.gain.value = 0.7; // sample volume — tunable per the dev's mix
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start();
  } else {
    def.synth();
  }
}

// Backwards-compat aliases. Many call sites import these names directly;
// keeping them as thin shims means M2 doesn't need to touch every caller.
export function playSuccess() { playSfx('success'); }
export function playFail()    { playSfx('fail'); }
export function playTick()    { playSfx('tick'); }

// ---------------------------------------------------------------------------
// REDUCED-MOTION HELPER (L7)
// ---------------------------------------------------------------------------
// Users who set `prefers-reduced-motion: reduce` at the OS/browser level are
// asking us to suppress all decorative motion. CSS already respects this via
// a global `prefers-reduced-motion` media query, but JS-driven motion (parallax,
// haptics, animation timeouts) needs an explicit check.
//
// Wrapped in a try/catch because matchMedia is unavailable in old WebViews
// and SSR/test environments — we'd rather degrade silently than throw on
// boot.
export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// HAPTICS
// ---------------------------------------------------------------------------
// navigator.vibrate is supported on Android Chrome and most Android browsers,
// silently no-op'd on iOS Safari. We gate on:
//   - the existing `muted` flag — audio mute covers vibration too, one fewer
//     setting for users to discover
//   - prefers-reduced-motion (L7) — vibration IS motion; honor the OS hint
//     even when sound is on
export function vibrate(pattern) {
  if (muted) return;
  if (prefersReducedMotion()) return;
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch {}
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
