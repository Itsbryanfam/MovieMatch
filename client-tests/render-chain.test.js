/**
 * @jest-environment jsdom
 */

// Regression coverage for the renderChainItems bug:
// When the first chain item arrived, the .empty-board-hint placeholder was
// not removed (the cleanup block only removed .empty-hint), so the "Board is
// empty" text persisted alongside the new chain entry. This test would fail
// against the pre-fix version of ui.js.

import { initUIElements, renderGame } from '../public/js/ui.js';
const { loadIndexHtml, makePlayingState, makeChainItem } = require('./fixtures');

describe('renderChainItems — empty state cleanup', () => {
  beforeEach(() => {
    loadIndexHtml();
    initUIElements();
  });

  test('shows empty-board hint when chain is empty and game is playing', () => {
    const state = makePlayingState({ chain: [] });
    renderGame(state, 'host_id', false);

    const chainDisplay = document.getElementById('chain-display');
    expect(chainDisplay.querySelector('.empty-board-hint')).not.toBeNull();
  });

  test('removes empty-board hint when first chain item arrives', () => {
    // First render: empty board → placeholder appears
    const empty = makePlayingState({ chain: [] });
    renderGame(empty, 'host_id', false);
    expect(
      document.getElementById('chain-display').querySelector('.empty-board-hint')
    ).not.toBeNull();

    // Second render: first move played → placeholder must be gone
    const oneMove = makePlayingState({ chain: [makeChainItem()] });
    renderGame(oneMove, 'host_id', false);

    const chain = document.getElementById('chain-display');
    expect(chain.querySelector('.empty-board-hint')).toBeNull();
    expect(chain.querySelectorAll('.chain-item').length).toBe(1);
  });

  test('appends subsequent chain items without re-rendering existing ones', () => {
    const chainDisplay = () => document.getElementById('chain-display');

    const first = makePlayingState({ chain: [makeChainItem({ movie: { title: 'Iron Man', year: 2008, cast: ['RDJ'], poster: '' } })] });
    renderGame(first, 'host_id', false);
    const firstNode = chainDisplay().querySelector('.chain-item');

    const second = makePlayingState({
      chain: [
        first.chain[0],
        makeChainItem({ movie: { title: 'Iron Man 2', year: 2010, cast: ['RDJ'], poster: '' } }),
      ],
    });
    renderGame(second, 'host_id', false);

    const items = chainDisplay().querySelectorAll('.chain-item');
    expect(items.length).toBe(2);
    // First node is the same DOM node — incremental render preserves identity
    expect(items[0]).toBe(firstNode);
  });
});
