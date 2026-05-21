// public/js/ui/hero-puzzle-controller.js — Phase 7.9 Playable Hero driver.
// Thin driver layer. Imports the pure seam + wires the DOM + socket events.
// Module-level state is scoped to the current tab session — no persistence
// across reloads (cross-session memory is out of scope per spec §9).
//
// Public surface:
//   - mountHeroPuzzle(socket) — idempotent; paints bundled puzzle into
//     #hero-puzzle, wires the input + autocomplete, kicks off the lazy
//     server request. No-op if already mounted (dataset flag).

import { pickBundledPuzzle, classifyOutcome } from './hero-puzzle.js';
import { attachPosterFallback } from './ui-dom.js';

// Module-level state. Scoped to one tab session.
// _mounted is stored as dataset.mounted on the #hero-puzzle element rather
// than a module-level boolean so that jsdom reloads in tests (which call
// loadIndexHtml() in beforeEach) naturally reset the flag alongside the DOM.
// Module-level variables below are reset by _resetState() on each mount call
// when the element does not carry the mounted flag.
let _currentPuzzle = null;
let _serverPuzzle = null;
let _seen = [];
let _debounceTimer = null;
const SEARCH_DEBOUNCE_MS = 200;

// Reset per-session state. Called at mount time so a fresh DOM (e.g. in tests)
// starts clean even though the module is cached.
function _resetState() {
  _currentPuzzle = null;
  _serverPuzzle = null;
  _seen = [];
  _debounceTimer = null;
}

// ---- Public entry point -------------------------------------------------

export function mountHeroPuzzle(socket) {
  const container = document.getElementById('hero-puzzle');
  if (!container) return;
  // Idempotency guard: stored on the element so jsdom reloads reset it.
  if (container.dataset.mounted === 'true') return;
  container.dataset.mounted = 'true';
  _resetState();

  // 1. Initial paint from bundled bank (instant — no socket dependency).
  _currentPuzzle = pickBundledPuzzle({ seen: _seen });
  _seen.push(_currentPuzzle.pairId);
  container.dataset.pairId = _currentPuzzle.pairId;
  _renderReel(container, _currentPuzzle);
  container.dataset.state = 'awaiting-guess';

  // 2. Wire DOM events.
  _wireInput(socket, container);
  _wireSkip(container);

  // 3. Wire socket-side events. socket.on is idempotent enough here — we
  //    guard mounting with _mounted so we only attach once per session.
  socket.on('heroPuzzleDelivered', (payload) => _handlePuzzleDelivered(container, payload));
  socket.on('heroActorResults', (payload) => _handleActorResults(container, socket, payload));
  socket.on('heroGuessResult', (payload) => _handleGuessResult(container, payload));

  // 4. Kick off lazy server request for variety on subsequent loads.
  socket.emit('heroPuzzleRequest', {});
}

// ---- Private helpers ----------------------------------------------------

function _renderReel(container, puzzle) {
  const reel = container.querySelector('.filmstrip .reel');
  if (!reel) return;
  reel.innerHTML = '';
  reel.appendChild(_buildReelNode(puzzle.movieA));
  reel.appendChild(_buildBridge());
  reel.appendChild(_buildReelNode(puzzle.movieB));
}

function _buildReelNode(movie) {
  const node = document.createElement('div');
  node.className = 'reel-node';
  const img = document.createElement('img');
  img.className = 'reel-poster';
  img.src = movie.posterUrl;
  img.alt = movie.title;
  img.loading = 'lazy';
  // Attach the same load-failure fallback used by the chain board and autocomplete
  // (audit finding #3) so a TMDB 404 never renders a native broken-image glyph.
  attachPosterFallback(img, 'reel-poster');
  node.appendChild(img);
  const title = document.createElement('div');
  title.className = 'reel-title';
  title.textContent = movie.title + ' ';
  const year = document.createElement('span');
  year.className = 'year';
  year.textContent = '(' + movie.year + ')';
  title.appendChild(year);
  node.appendChild(title);
  return node;
}

function _buildBridge(labelText) {
  const bridge = document.createElement('div');
  bridge.className = 'reel-bridge reel-bridge--unsolved';
  const label = document.createElement('span');
  label.className = 'reel-bridge-label';
  label.textContent = labelText || '↔ ?';
  bridge.appendChild(label);
  return bridge;
}

function _wireInput(socket, container) {
  const input = container.querySelector('#hero-puzzle-search');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(_debounceTimer);
    const query = input.value.trim();
    if (query.length === 0) {
      const drop = container.querySelector('#hero-puzzle-autocomplete');
      if (drop) drop.innerHTML = '';
      return;
    }
    _debounceTimer = setTimeout(() => {
      socket.emit('heroActorSearch', { query });
    }, SEARCH_DEBOUNCE_MS);
  });
}

function _wireSkip(container) {
  const skip = container.querySelector('.hero-puzzle-skip');
  if (!skip) return;
  skip.addEventListener('click', () => {
    if (container.dataset.state !== 'awaiting-guess') return;
    _revealNow(container, _currentPuzzle.revealActor, /* outcomeKind */ 'skipped');
  });
}

function _handlePuzzleDelivered(container, payload) {
  if (!payload || !payload.pairId) return;
  _serverPuzzle = payload;
  const input = container.querySelector('#hero-puzzle-search');
  if (
    container.dataset.state === 'awaiting-guess' &&
    input && input.value === ''
  ) {
    _currentPuzzle = payload;
    container.dataset.pairId = _currentPuzzle.pairId;
    _renderReel(container, _currentPuzzle);
  }
}

function _handleActorResults(container, socket, payload) {
  const drop = container.querySelector('#hero-puzzle-autocomplete');
  if (!drop) return;
  drop.innerHTML = '';
  if (!payload || !Array.isArray(payload.results) || payload.results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'No actors matched — try a fuller name';
    drop.appendChild(empty);
    return;
  }
  for (const actor of payload.results) {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.dataset.actorTmdbId = String(actor.tmdbId);
    item.dataset.actorName = actor.name;
    if (actor.profilePath) {
      const img = document.createElement('img');
      img.className = 'mini-poster';
      img.src = actor.profilePath;
      img.alt = actor.name;
      item.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'mini-poster placeholder';
      item.appendChild(ph);
    }
    const text = document.createElement('div');
    text.className = 'ac-text';
    const name = document.createElement('div');
    name.className = 'ac-title';
    name.textContent = actor.name;
    text.appendChild(name);
    if (actor.knownFor && actor.knownFor.length > 0) {
      const kf = document.createElement('span');
      kf.className = 'year';
      kf.textContent = actor.knownFor.join(', ');
      text.appendChild(kf);
    }
    item.appendChild(text);
    item.addEventListener('click', () => {
      if (container.dataset.state !== 'awaiting-guess') return;
      socket.emit('heroGuessSubmit', {
        pairId: container.dataset.pairId,
        actorTmdbId: actor.tmdbId,
        actorName: actor.name,
      });
      container.dataset.state = 'checking';
      const input = container.querySelector('#hero-puzzle-search');
      if (input) input.disabled = true;
      drop.innerHTML = '';
    });
    drop.appendChild(item);
  }
}

function _handleGuessResult(container, payload) {
  if (!payload) return;
  if (container.dataset.pairId !== payload.pairId) return;
  if (container.dataset.state !== 'checking') return;
  const revealActor = payload.revealActor || _currentPuzzle.revealActor || { name: 'Unknown' };
  const kind = payload.correct ? 'correct' : 'incorrect';
  _revealNow(container, revealActor, kind);
}

function _revealNow(container, revealActor, kind) {
  container.dataset.state = 'revealed-' + kind;

  // Fill the bridge.
  const bridge = container.querySelector('.reel-bridge');
  if (bridge) {
    bridge.classList.remove('reel-bridge--unsolved');
    const label = bridge.querySelector('.reel-bridge-label');
    if (label) label.textContent = '↔ ' + revealActor.name;
  }

  // Remove any prior outcome card (idempotency).
  const prior = container.querySelector('.hero-puzzle-outcome');
  if (prior) prior.remove();

  // Paint the outcome card.
  const card = document.createElement('div');
  card.className = 'hero-puzzle-outcome';
  card.setAttribute('role', 'status');
  let copy;
  if (kind === 'correct') {
    copy = `Nailed it — they're both in ${revealActor.name}'s filmography.`;
  } else if (kind === 'incorrect') {
    copy = `Almost — the connection was ${revealActor.name}.`;
  } else {
    copy = `Here's how it connects — ${revealActor.name} is in both.`;
  }
  card.textContent = copy;
  container.appendChild(card);
}
