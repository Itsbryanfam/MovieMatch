/**
 * @jest-environment jsdom
 */
// Phase 6b — the Titles wall rendered inside the existing My Stats modal.
// Pins: 13 rows, earned vs locked marking, the equipped marker, the equip
// callback, and the legacy-payload no-op (a myStats without `achievements`
// must render the pre-6b modal unchanged).
const { loadIndexHtml } = require('./fixtures');
import { initUIElements, renderMyStats } from '../public/js/ui.js';

// A myStats payload shaped like the enriched server response.
function payload(overrides = {}) {
  return {
    gamesPlayed: 12, wins: 3, longestChain: 11, totalPlays: 40,
    byMode: {}, favoriteConnector: null, lastUpdatedMs: Date.now(),
    equippedTitle: 'first_win',
    achievements: {
      catalog: [
        { id: 'first_steps', title: 'First Steps', description: 'Play your first game.' },
        { id: 'first_win',   title: 'First Win',   description: 'Win your first game.' },
        { id: 'chain_master', title: 'Chain Master', description: 'Reach a chain of 25.' },
      ],
      earned: ['first_steps', 'first_win'],
    },
    ...overrides,
  };
}

describe('renderMyStats — Titles wall', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); try { window.localStorage.clear(); } catch {} });

  test('renders one row per catalog entry with earned/locked marking', () => {
    renderMyStats(payload());
    const rows = document.querySelectorAll('#my-stats-body .achievement-row');
    expect(rows.length).toBe(3);
    const earned = document.querySelectorAll('#my-stats-body .achievement-row.is-earned');
    expect(earned.length).toBe(2);
    const locked = document.querySelectorAll('#my-stats-body .achievement-row.is-locked');
    expect(locked.length).toBe(1);
  });

  test('marks the equipped row', () => {
    renderMyStats(payload());
    const equipped = document.querySelectorAll('#my-stats-body .achievement-row.is-equipped');
    expect(equipped.length).toBe(1);
    expect(equipped[0].textContent).toContain('First Win');
  });

  test('clicking an earned row equip control calls onEquip(id)', () => {
    const onEquip = jest.fn();
    renderMyStats(payload(), { onEquip });
    const rows = [...document.querySelectorAll('#my-stats-body .achievement-row.is-earned')];
    const firstSteps = rows.find(r => r.textContent.includes('First Steps'));
    firstSteps.querySelector('.achievement-equip').click();
    expect(onEquip).toHaveBeenCalledWith('first_steps');
  });

  test('legacy payload without achievements renders no wall section', () => {
    const legacy = payload();
    delete legacy.achievements;
    delete legacy.equippedTitle;
    renderMyStats(legacy);
    expect(document.querySelectorAll('#my-stats-body .achievement-row').length).toBe(0);
    expect(document.querySelector('#my-stats-body .stats-hero-grid')).toBeTruthy();
  });
});
