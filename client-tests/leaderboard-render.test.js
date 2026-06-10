/**
 * @jest-environment jsdom
 */
// T6c: BEHAVIOR conversion. This suite previously regex-extracted the
// loadLeaderboard() body out of app.js SOURCE TEXT and asserted on substrings
// (brittle — it needed a T5 eslint-disable for the regex and broke on any
// reformat). loadLeaderboard is now a module-scope export (export-only hoist —
// no logic change), so we exercise the REAL renderer against the jsdom fixture
// DOM and assert the actual rendered output: ranks, names, wins, and the
// empty/error/loading states. The CSS-rule guards that USED to live here are
// genuine source guards and stay in client-tests/index-inline-styles.test.js
// / the 03-game.css component tests — they are not behavior and are out of
// scope for this conversion.
const { loadIndexHtml } = require('./fixtures');
// leaderboardModal/leaderboardList are live bindings owned by ui-dom.js and
// re-exported through the ui.js barrel; initUIElements() populates them. We
// import the modal binding from ui.js (its true owner) and read the list node
// back through the DOM.
import { initUIElements, leaderboardModal } from '../public/js/ui.js';
import { loadLeaderboard } from '../public/js/app.js';

describe('loadLeaderboard — rendered behavior (T6c)', () => {
  let realFetch;
  beforeEach(() => {
    loadIndexHtml();      // real public/index.html markup into jsdom
    initUIElements();     // populate ui.js DOM bindings against that markup
    realFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    document.body.innerHTML = '';
  });

  function listEl() {
    return document.getElementById('leaderboard-list');
  }

  test('opens the modal and renders one .leaderboard-row per entry', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => [
        { name: 'Ace', wins: 9 },
        { name: 'Bex', wins: 4 },
        { name: 'Cy', wins: 2 },
        { name: 'Dot', wins: 1 },
      ],
    });

    // Pre-condition: the fixture modal starts hidden.
    expect(document.getElementById('leaderboard-modal').classList.contains('hidden')).toBe(true);

    await loadLeaderboard();

    // The modal is revealed (the .hidden class is removed — the imported live
    // binding points at the same node).
    expect(leaderboardModal.classList.contains('hidden')).toBe(false);

    const rows = listEl().querySelectorAll('.leaderboard-row');
    expect(rows).toHaveLength(4);
    // No stale loading placeholder left behind.
    expect(listEl().textContent).not.toContain('Loading...');
  });

  test('renders medal emoji for the top three and #N for the rest', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => [
        { name: 'First', wins: 10 },
        { name: 'Second', wins: 8 },
        { name: 'Third', wins: 6 },
        { name: 'Fourth', wins: 4 },
        { name: 'Fifth', wins: 2 },
      ],
    });

    await loadLeaderboard();

    const ranks = [...listEl().querySelectorAll('.leaderboard-rank')].map(r => r.textContent);
    // Gold/silver/bronze for the podium, positional #N afterward.
    expect(ranks[0]).toBe('🥇');
    expect(ranks[1]).toBe('🥈');
    expect(ranks[2]).toBe('🥉');
    expect(ranks[3]).toBe('#4');
    expect(ranks[4]).toBe('#5');
  });

  test('renders each entry name and a wins count with the trophy', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => [{ name: 'Quentin', wins: 7 }],
    });

    await loadLeaderboard();

    const row = listEl().querySelector('.leaderboard-row');
    expect(row.querySelector('.leaderboard-name').textContent).toBe('Quentin');
    expect(row.querySelector('.leaderboard-wins').textContent).toBe('7 🏆');
  });

  test('entry names are rendered as inert text (XSS-safe textContent, not HTML)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => [{ name: '<img src=x onerror=alert(1)>', wins: 1 }],
    });

    await loadLeaderboard();

    const name = listEl().querySelector('.leaderboard-name');
    // The crafted string must be text, never a live <img> node.
    expect(name.querySelector('img')).toBeNull();
    expect(name.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  test('empty leaderboard renders the "no wins" hint and zero rows', async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => [] });

    await loadLeaderboard();

    expect(listEl().querySelectorAll('.leaderboard-row')).toHaveLength(0);
    const hint = listEl().querySelector('.empty-hint--lg');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toBe('No wins recorded yet. Play a game!');
  });

  test('a fetch failure renders the error hint without throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(loadLeaderboard()).resolves.toBeUndefined();

    expect(listEl().querySelectorAll('.leaderboard-row')).toHaveLength(0);
    const hint = listEl().querySelector('.empty-hint--lg');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toBe('Failed to load leaderboard.');
  });
});
