/**
 * @jest-environment jsdom
 */

// Design audit finding #3: TMDB poster <img> tags had no error handling.
// On a strict network / slow load / 404, the browser renders its native
// broken-image glyph + alt text inside the otherwise-polished cards. The
// app already ships a designed `.placeholder` fallback for the
// no-poster-URL case — these tests pin that the same fallback now also
// covers the load-FAILURE case for the chain board, the autocomplete
// list, and the static hero demo posters.

import { initUIElements, renderGame, renderAutocompleteResults, playChainReplay } from '../public/js/ui.js';
const { loadIndexHtml, makePlayingState, makeChainItem } = require('./fixtures');

describe('poster load-failure fallback (audit #3)', () => {
  beforeEach(() => {
    loadIndexHtml();
    initUIElements();
  });

  test('a chain poster that fails to load is replaced by the designed placeholder', () => {
    const state = makePlayingState({
      chain: [makeChainItem({
        movie: { title: 'Iron Man', year: 2008, cast: ['RDJ'], poster: 'https://image.tmdb.org/t/p/w200/test.jpg' },
      })],
    });
    renderGame(state, 'host_id', false);

    const chainItem = document.querySelector('#chain-display .chain-item');
    const img = chainItem.querySelector('img.chain-poster');
    expect(img).not.toBeNull();

    // Simulate the browser failing to load the image.
    img.dispatchEvent(new Event('error'));

    // The broken <img> must be gone, replaced by the designed placeholder
    // div so the card never shows a native broken-image glyph.
    expect(chainItem.querySelector('img.chain-poster')).toBeNull();
    expect(chainItem.querySelector('.chain-poster.placeholder')).not.toBeNull();
  });

  test('an autocomplete mini-poster that fails to load is replaced by the placeholder', () => {
    renderAutocompleteResults([
      { title: 'Iron Man', year: 2008, id: 1726, poster: 'https://image.tmdb.org/t/p/w200/test.jpg' },
    ]);

    const item = document.querySelector('#autocomplete-container .autocomplete-item');
    const img = item.querySelector('img.mini-poster');
    expect(img).not.toBeNull();

    img.dispatchEvent(new Event('error'));

    expect(item.querySelector('img.mini-poster')).toBeNull();
    expect(item.querySelector('.mini-poster.placeholder')).not.toBeNull();
  });

  test('a chain-replay poster that fails to load is replaced by the placeholder', () => {
    // The daily-result "▶ Replay your chain" panel builds its own poster
    // <img>s via _buildReplayEntry. Pre-fix this was the ONE poster site
    // (of three) missing the broken-image fallback the other two have.
    // Force the reduced-motion branch so playChainReplay renders all
    // entries synchronously (no setTimeout to await).
    const realMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: true });
    try {
      const container = document.createElement('div');
      document.body.appendChild(container);

      playChainReplay(container, [makeChainItem({
        movie: { title: 'Iron Man', year: 2008, cast: ['RDJ'], poster: 'https://image.tmdb.org/t/p/w200/test.jpg' },
      })]);

      const img = container.querySelector('img.chain-poster');
      expect(img).not.toBeNull();

      img.dispatchEvent(new Event('error'));

      expect(container.querySelector('img.chain-poster')).toBeNull();
      expect(container.querySelector('.chain-poster.placeholder')).not.toBeNull();
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  test('the static hero demo posters declare an onerror fallback', () => {
    // The 3 hero demo <img>s are static markup (not rendered by ui.js), so
    // they need an inline onerror to swap to the placeholder styling.
    const heroImgs = document.querySelectorAll('.hero-demo .demo-poster img');
    expect(heroImgs.length).toBe(3);
    heroImgs.forEach((img) => {
      expect((img.getAttribute('onerror') || '').length).toBeGreaterThan(0);
    });
  });
});
