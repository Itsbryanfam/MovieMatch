/**
 * @jest-environment jsdom
 */
// Phase 7.9 — Playable Hero controller integration tests. WHY: integration
// tests verify the wiring between the pure seam (hero-puzzle.js, tested in
// hero-puzzle.test.js) and the DOM + socket event surface. Mocked socket
// captures emits; driver state observable via #hero-puzzle.dataset.state.

const { loadIndexHtml } = require('./fixtures');
const { mountHeroPuzzle } = require('../public/js/ui.js');

// Lightweight EventEmitter-style mock socket: captures emits + lets tests
// fire server-side responses synchronously.
function createMockSocket() {
  const handlers = {};
  const emits = [];
  return {
    emit: (event, payload) => emits.push({ event, payload }),
    on: (event, handler) => {
      handlers[event] = handler;
    },
    off: (event) => { delete handlers[event]; },
    // Test-only helper: synchronously fire a server-side event.
    __fire: (event, payload) => {
      if (handlers[event]) handlers[event](payload);
    },
    __emits: emits,
    __handlers: handlers,
  };
}

describe('mountHeroPuzzle', () => {
  let socket;

  beforeEach(() => {
    loadIndexHtml();
    socket = createMockSocket();
  });

  test('first call paints bundled puzzle into #hero-puzzle .reel + emits heroPuzzleRequest', () => {
    mountHeroPuzzle(socket);

    const reel = document.querySelector('#hero-puzzle .filmstrip .reel');
    expect(reel).toBeTruthy();
    expect(reel.querySelectorAll('.reel-node').length).toBe(2);
    expect(reel.querySelectorAll('.reel-bridge.reel-bridge--unsolved').length).toBe(1);

    const mount = document.getElementById('hero-puzzle');
    expect(mount.dataset.state).toBe('awaiting-guess');

    const requested = socket.__emits.filter(e => e.event === 'heroPuzzleRequest');
    expect(requested.length).toBe(1);
  });

  test('idempotent — second call does not re-emit heroPuzzleRequest or duplicate nodes', () => {
    mountHeroPuzzle(socket);
    mountHeroPuzzle(socket);

    const requested = socket.__emits.filter(e => e.event === 'heroPuzzleRequest');
    expect(requested.length).toBe(1);

    const reel = document.querySelector('#hero-puzzle .filmstrip .reel');
    expect(reel.querySelectorAll('.reel-node').length).toBe(2);
  });

  test('heroPuzzleDelivered swaps puzzle in place when state=awaiting-guess and input empty', () => {
    mountHeroPuzzle(socket);

    const serverPuzzle = {
      pairId: 'hp_server_test',
      movieA: { title: 'Test A', year: 2020, posterUrl: 'https://image.tmdb.org/t/p/w200/x.jpg', tmdbId: 1 },
      movieB: { title: 'Test B', year: 2021, posterUrl: 'https://image.tmdb.org/t/p/w200/y.jpg', tmdbId: 2 },
      revealActor: { tmdbId: 99, name: 'Server Reveal Actor' },
    };
    socket.__fire('heroPuzzleDelivered', serverPuzzle);

    const titles = Array.from(document.querySelectorAll('#hero-puzzle .reel-node .reel-title'))
      .map(n => n.textContent);
    expect(titles[0]).toContain('Test A');
    expect(titles[1]).toContain('Test B');
  });

  test('clicking an autocomplete-item emits heroGuessSubmit and flips state to checking', () => {
    mountHeroPuzzle(socket);
    const mount = document.getElementById('hero-puzzle');
    const currentPairId = mount.dataset.pairId; // driver sets this

    // Simulate the autocomplete dropdown being populated. Driver hooks into
    // heroActorResults so we fire one with a single result:
    socket.__fire('heroActorResults', {
      query: 'sca',
      results: [{ tmdbId: 1245, name: 'Scarlett Johansson', profilePath: null, knownFor: [] }],
    });

    const item = document.querySelector('#hero-puzzle-autocomplete .autocomplete-item');
    expect(item).toBeTruthy();
    expect(item.dataset.actorTmdbId).toBe('1245');
    expect(item.dataset.actorName).toBe('Scarlett Johansson');

    item.click();

    const submitted = socket.__emits.filter(e => e.event === 'heroGuessSubmit');
    expect(submitted.length).toBe(1);
    expect(submitted[0].payload).toEqual({
      pairId: currentPairId,
      actorTmdbId: 1245,
      actorName: 'Scarlett Johansson',
    });
    expect(mount.dataset.state).toBe('checking');
  });

  test('heroGuessResult correct=true flips state, fills bridge, paints correct outcome', () => {
    mountHeroPuzzle(socket);
    const mount = document.getElementById('hero-puzzle');

    // First we have to put the driver into "checking" state — simulate the
    // click flow. The simplest way: fire heroActorResults, click the item,
    // then fire the guess result.
    socket.__fire('heroActorResults', {
      query: 'sca',
      results: [{ tmdbId: 1245, name: 'Scarlett Johansson', profilePath: null, knownFor: [] }],
    });
    document.querySelector('#hero-puzzle-autocomplete .autocomplete-item').click();
    expect(mount.dataset.state).toBe('checking');

    socket.__fire('heroGuessResult', {
      pairId: mount.dataset.pairId,
      correct: true,
      revealActor: { tmdbId: 1245, name: 'Scarlett Johansson' },
    });

    expect(mount.dataset.state).toBe('revealed-correct');

    const bridge = document.querySelector('#hero-puzzle .reel-bridge');
    expect(bridge.classList.contains('reel-bridge--unsolved')).toBe(false);
    expect(bridge.textContent).toContain('Scarlett Johansson');

    const outcome = document.querySelector('#hero-puzzle .hero-puzzle-outcome');
    expect(outcome).toBeTruthy();
    expect(outcome.textContent.toLowerCase()).toContain('nailed');
  });

  test('Show me skips to reveal using current puzzle revealActor, no socket emit', () => {
    mountHeroPuzzle(socket);
    const before = socket.__emits.length;

    const skip = document.querySelector('#hero-puzzle .hero-puzzle-skip');
    expect(skip).toBeTruthy();
    skip.click();

    const mount = document.getElementById('hero-puzzle');
    expect(mount.dataset.state).toBe('revealed-skipped');

    const bridge = document.querySelector('#hero-puzzle .reel-bridge');
    expect(bridge.classList.contains('reel-bridge--unsolved')).toBe(false);
    // Bridge label should be populated (driver pulls revealActor from the
    // current bundled puzzle since we never received a server puzzle).
    expect(bridge.textContent).toMatch(/↔\s+\w+/);

    const outcome = document.querySelector('#hero-puzzle .hero-puzzle-outcome');
    expect(outcome).toBeTruthy();

    // No new socket emits beyond the initial heroPuzzleRequest.
    expect(socket.__emits.length).toBe(before);
  });
});
