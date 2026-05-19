// public/js/ui/recap-player.js — Phase 7.6 thin recap DOM driver.
// WHY: chain-recap.js is the pure storyboard producer; this module is the
// ONLY place that touches the DOM/timers for the recap, so the engine stays
// pure/testable and 7.9 can reuse the storyboard with different chrome. The
// setTimeout-chain + single cancellable handle mirrors the proven leak-safe
// ui-panels.js replay tick.
import { buildRecapStoryboard } from './chain-recap.js';
import { attachPosterFallback } from './ui-dom.js';

let _recapTimer = null; // single cancellable handle (leak-safe)

export function cancelRecap() {
  if (_recapTimer) { clearTimeout(_recapTimer); _recapTimer = null; }
}

// Build one beat's DOM node. createElement/textContent only (no innerHTML
// for dynamic content — the established XSS discipline). Posters use
// attachPosterFallback so a 404/non-tmdb url degrades to the designed
// placeholder exactly like renderChainItems/_buildReplayEntry.
function beatNode(beat) {
  const d = document.createElement('div');
  d.className = `recap-beat recap-${beat.type}`;
  const p = beat.payload || {};
  if (beat.type === 'intro') {
    d.textContent = `${p.title} — Chain of ${p.chainCount} connection${p.chainCount !== 1 ? 's' : ''}`;
  } else if (beat.type === 'bridge') {
    d.textContent = `↔ via ${p.actor}`;
  } else if (beat.type === 'skipped') {
    d.textContent = `+ ${p.skipped} more connection${p.skipped !== 1 ? 's' : ''}`;
  } else if (beat.type === 'elimination') {
    d.textContent = `❌ ${p.playerName} eliminated`;
  } else if (beat.type === 'finale') {
    const t = document.createElement('div');
    t.className = 'recap-finale-title';
    t.textContent = p.winnerLine;
    const s = document.createElement('div');
    s.className = 'recap-finale-sub';
    s.textContent = p.subLine;
    d.appendChild(t); d.appendChild(s);
  } else { // link
    if (p.poster) {
      const img = document.createElement('img');
      img.src = p.poster;
      img.alt = 'Poster';
      img.className = 'recap-poster';
      attachPosterFallback(img, 'recap-poster');
      d.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'recap-poster placeholder';
      d.appendChild(ph);
    }
    const meta = document.createElement('div');
    meta.className = 'recap-meta';
    const who = document.createElement('div');
    who.className = 'recap-who';
    who.textContent = p.playerName;
    const ttl = document.createElement('div');
    ttl.className = 'recap-title';
    ttl.textContent = `${p.title} (${p.year})`;
    meta.appendChild(who); meta.appendChild(ttl);
    d.appendChild(meta);
  }
  return d;
}

export function playRecap(state, mountEl, opts = {}) {
  if (!mountEl) return; // safe no-op (jsdom / missing skeleton)
  const { onDone, prefersReducedMotion } = opts;
  // synchronous & pure — the storyboard does not depend on live state after
  // this line, so later stateUpdates (e.g. the 7s reset) cannot corrupt it.
  const storyboard = buildRecapStoryboard(state);
  const stage = mountEl.querySelector('#recap-stage');
  const skipBtn = mountEl.querySelector('#recap-skip');
  const replayBtn = mountEl.querySelector('#recap-replay');
  const closeBtn = mountEl.querySelector('#recap-close');
  cancelRecap();
  mountEl.classList.remove('hidden');

  const clearStage = () => { while (stage && stage.firstChild) stage.removeChild(stage.firstChild); };
  const renderAll = () => { clearStage(); storyboard.forEach(b => stage && stage.appendChild(beatNode(b))); };
  const settle = (fireDone) => {
    cancelRecap();
    renderAll(); // settled end-state = every beat's final content, no animation
    if (fireDone && onDone) onDone();
  };

  if (closeBtn) closeBtn.onclick = () => { cancelRecap(); mountEl.classList.add('hidden'); };
  if (skipBtn) skipBtn.onclick = () => settle(false);

  // Accessibility-safe: reduced-motion (or unknowable motion preference,
  // handled at the call site) → no animation, instant settled end-state.
  if (prefersReducedMotion) { settle(true); if (replayBtn) replayBtn.onclick = () => start(); return; }

  function start() {
    cancelRecap();
    clearStage();
    let i = 0;
    const tick = () => {
      if (i >= storyboard.length) { _recapTimer = null; if (onDone) onDone(); return; }
      const b = storyboard[i];
      const node = beatNode(b);
      // compositor-only entrance: the .recap-beat base is opacity:0; adding
      // .is-in on the next frame triggers the CSS transform/opacity transition.
      stage && stage.appendChild(node);
      requestAnimationFrame ? requestAnimationFrame(() => node.classList.add('is-in')) : node.classList.add('is-in');
      i++;
      _recapTimer = setTimeout(tick, b.durMs);
    };
    _recapTimer = setTimeout(tick, 200); // small initial beat (mirrors ui-panels)
  }
  if (replayBtn) replayBtn.onclick = () => start();
  start();
}
