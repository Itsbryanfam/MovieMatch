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

import { initUIElements, renderGame, renderAutocompleteResults, playChainReplay, mountHeroPuzzle } from '../public/js/ui.js';
const { loadIndexHtml, makePlayingState, makeChainItem } = require('./fixtures');

describe('poster load-failure fallback (audit #3)', () => {
  beforeEach(() => {
    loadIndexHtml();
    initUIElements();
  });

  test('a chain poster that fails to load is replaced by the designed placeholder', () => {
    // WHY update (Phase 7.7 guard-rewrite — the §1.9/§5 precedent): renderChainItems
    // now emits .reel-node / img.reel-poster (filmstrip) instead of
    // .chain-item / img.chain-poster. attachPosterFallback is still called with
    // the new class name 'reel-poster'. Selectors updated to match; the tested
    // contract (broken-image → placeholder swap) is 100% preserved.
    const state = makePlayingState({
      chain: [makeChainItem({
        movie: { title: 'Iron Man', year: 2008, cast: ['RDJ'], poster: 'https://image.tmdb.org/t/p/w200/test.jpg' },
      })],
    });
    renderGame(state, 'host_id', false);

    const reelNode = document.querySelector('#chain-display .reel-node');
    const img = reelNode.querySelector('img.reel-poster');
    expect(img).not.toBeNull();

    // Simulate the browser failing to load the image.
    img.dispatchEvent(new Event('error'));

    // The broken <img> must be gone, replaced by the designed placeholder
    // div so the card never shows a native broken-image glyph.
    expect(reelNode.querySelector('img.reel-poster')).toBeNull();
    expect(reelNode.querySelector('.reel-poster.placeholder')).not.toBeNull();
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

  test('hero puzzle reel posters attach attachPosterFallback on mount (Phase 7.9)', () => {
    // Phase 7.9 replaced the 3 static .demo-poster <img> elements with a
    // playable hero puzzle whose poster <img>s are painted dynamically by
    // mountHeroPuzzle. The same attachPosterFallback contract (audit #3)
    // must hold: a broken-image event replaces the img with the placeholder.
    const mockSocket = {
      emit: () => {},
      on: () => {},
    };
    mountHeroPuzzle(mockSocket);

    const reel = document.querySelector('#hero-puzzle .filmstrip .reel');
    const imgs = reel.querySelectorAll('img.reel-poster');
    expect(imgs.length).toBe(2);

    imgs.forEach((img) => {
      // Capture parentElement before firing the error — attachPosterFallback
      // removes the img from the DOM, so img.parentElement is null after.
      const parent = img.parentElement;
      // Simulate the browser failing to load the image.
      img.dispatchEvent(new Event('error'));
      // The broken <img> must be replaced by the designed placeholder.
      expect(parent.querySelector('img.reel-poster')).toBeNull();
      expect(parent.querySelector('.reel-poster.placeholder')).not.toBeNull();
    });
  });
});
