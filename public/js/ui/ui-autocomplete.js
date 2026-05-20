// ui/ui-autocomplete.js — autocomplete dropdown rendering and mobile AC helpers.
// WHY: isolating autocomplete logic from the rest of the render layer keeps
// socket-emit-on-click plumbing out of the general rendering functions and
// makes it straightforward to swap or extend the dropdown behaviour.

// Import DOM refs and shared helpers — live bindings written by
// initUIElements() in ui-dom.js; attachPosterFallback is a shared DOM
// primitive that also lives here (leaf module) so this module has no
// dependency on ui-render.js.
import { autocompleteContainer, mobileAcDropdown, movieInput, submitBtn, hintText, attachPosterFallback } from './ui-dom.js';
// Import socket helpers — click handler emits submitMovie via the live socket.
import { getSocket, getCurrentLobbyId } from '../state.js';

export function renderAutocompleteResults(results) {
  if (!results || results.length === 0) {
    if (autocompleteContainer) autocompleteContainer.innerHTML = '<div class="empty-hint">No results found.</div>';
    // Group all mobileAcDropdown access behind a single existence check —
    // both innerHTML and classList must be guarded together since either can
    // throw if the element isn't in the DOM (older HTML, viewport pruning, etc.).
    if (mobileAcDropdown) {
      mobileAcDropdown.innerHTML = '<div class="empty-hint">No results found.</div>';
      mobileAcDropdown.classList.add('open');
    }
    return;
  }

  if (autocompleteContainer) autocompleteContainer.innerHTML = '';
  if (mobileAcDropdown) mobileAcDropdown.innerHTML = '';

  results.forEach(movie => {
    // Generate the DOM node logic once, returning a fresh node for each container
    const createAcNode = () => {
      const div = document.createElement('div');
      div.className = 'autocomplete-item';

      const id = movie.id || movie.tmdbId || 'unknown';
      const mediaType = movie.media_type || movie.mediaType || 'movie';

      div.setAttribute('data-tmdb-id', id);
      div.setAttribute('data-media-type', mediaType);

      if (movie.poster && movie.poster.startsWith('https://image.tmdb.org/')) {
        const img = document.createElement('img');
        img.src = movie.poster;
        img.alt = 'Poster';
        img.className = 'mini-poster';
        // Swap to the designed placeholder if the poster fails to load.
        attachPosterFallback(img, 'mini-poster');
        div.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'mini-poster placeholder';
        div.appendChild(placeholder);
      }

      const acText = document.createElement('div');
      acText.className = 'ac-text';
      const acTitle = document.createElement('div');
      acTitle.className = 'ac-title';
      acTitle.textContent = movie.title;
      const yearSpan = document.createElement('span');
      yearSpan.className = 'year';
      yearSpan.textContent = '(' + movie.year + ')';
      acText.appendChild(acTitle);
      acText.appendChild(yearSpan);
      div.appendChild(acText);

      div.addEventListener('click', () => {
        const title = movie.title;
        if (movieInput) movieInput.value = '';
        if (autocompleteContainer) autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
        closeMobileAc();

        const socket = getSocket();
        const lobbyId = getCurrentLobbyId();

        if (socket && id && id !== 'unknown' && mediaType) {
          socket.emit('submitMovie', {
            lobbyId: lobbyId,
            movie: title,
            tmdbId: parseInt(id),
            mediaType: mediaType,
            // Sweep fix (issue 3): forward the autocomplete-known poster URL
            // so the server can fall back to it when /movie/{id}?language=en-US
            // returns null poster_path (a known TMDB quirk that left e.g.
            // Dune: Part Two with an empty-frame placeholder despite the
            // search endpoint having had a poster). Only set when the
            // current item actually rendered a TMDB poster — keeps the wire
            // payload empty for placeholder picks so the server's existing
            // null-poster pathway still wins for genuinely poster-less
            // titles. Server-side validates the URL (matchSystem
            // _isValidPosterHint) so a hostile client can't inject garbage.
            posterHint: (typeof movie.poster === 'string'
              && movie.poster.startsWith('https://image.tmdb.org/'))
              ? movie.poster : undefined,
          });

          if (movieInput) {
            movieInput.value = '';
            movieInput.disabled = true;
          }
          if (submitBtn) submitBtn.disabled = true;
          if (hintText) hintText.innerText = 'Validating connection...';
          if (autocompleteContainer) autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
          closeMobileAc();
        }
      });

      return div;
    };

    if (autocompleteContainer) autocompleteContainer.appendChild(createAcNode());
    if (mobileAcDropdown) mobileAcDropdown.appendChild(createAcNode());
  });

  // Same guard on the success path — even with results, the element may not exist.
  if (mobileAcDropdown) mobileAcDropdown.classList.add('open');
}

export function closeMobileAc() {
  // Guard so calling this from a context that never had the dropdown (e.g. desktop
  // tests) is a safe no-op instead of a TypeError on .classList / .innerHTML.
  if (!mobileAcDropdown) return;
  mobileAcDropdown.classList.remove('open');
  mobileAcDropdown.innerHTML = '';
}
