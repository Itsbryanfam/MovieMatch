/**
 * @jest-environment jsdom
 */
// client-tests/render-chain.test.js — Phase 7.7 (REWRITTEN — the §1.9/§5
// legitimate guard rewrite, the 7.5.2 Theater-Lobby precedent).
// WHY: renderChainItems is deliberately transformed from the vertical
// .chain-item card list into the horizontal Constellation filmstrip. This
// suite pins the NEW contract and EVERY spec §4 behavioural-equivalence axis
// (4.1–4.8) so the transform provably preserves all gameplay-load-bearing
// behaviour. jsdom never lays out / has no matchMedia → renderChainItems
// computes reducedMotion at the call site and paints the SETTLED end-state
// (no timers) here; the motion fidelity is the user-side eyeball (spec §9.8).
import { initUIElements, renderGame } from '../public/js/ui.js';
const { loadIndexHtml, makePlayingState, makeChainItem, makePlayer } = require('./fixtures');

const display = () => document.getElementById('chain-display');

beforeEach(() => { loadIndexHtml(); initUIElements(); });

describe('filmstrip — §4 behavioural-equivalence', () => {
  test('§4.8 empty-board hint shown when chain empty & playing', () => {
    renderGame(makePlayingState({ chain: [] }), 'host_id', false);
    expect(display().querySelector('.empty-board-hint')).not.toBeNull();
    expect(display().querySelector('.filmstrip')).toBeNull();
  });

  test('§4.8 first move → hint removed, filmstrip appears', () => {
    renderGame(makePlayingState({ chain: [] }), 'host_id', false);
    renderGame(makePlayingState({ chain: [makeChainItem()] }), 'host_id', false);
    expect(display().querySelector('.empty-board-hint')).toBeNull();
    expect(display().querySelector('.filmstrip .reel .reel-node')).not.toBeNull();
  });

  test('§4.1 every chain entry → a reel node, in chain order', () => {
    const chain = [
      makeChainItem({ movie: { title: 'Iron Man', year: 2008, cast: ['Robert Downey Jr.'], poster: '' } }),
      makeChainItem({ movie: { title: 'Sherlock Holmes', year: 2009, cast: ['Robert Downey Jr.'], poster: '' }, matchedActors: ['Robert Downey Jr.'] }),
      makeChainItem({ movie: { title: 'Tropic Thunder', year: 2008, cast: ['Robert Downey Jr.'], poster: '' }, matchedActors: ['Robert Downey Jr.'] }),
    ];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    const titles = [...display().querySelectorAll('.reel-node .reel-title')].map(n => n.textContent);
    expect(titles).toEqual(['Iron Man (2008)', 'Sherlock Holmes (2009)', 'Tropic Thunder (2008)']);
  });

  test('§4.2 linking actor surfaced as a bridge label + the now-cast "linked via"', () => {
    const chain = [
      makeChainItem({ movie: { title: 'A', year: 2001, cast: ['Tom Hanks'], poster: '' } }),
      makeChainItem({ movie: { title: 'B', year: 2002, cast: ['Tom Hanks'], poster: '' }, matchedActors: ['Tom Hanks'] }),
    ];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    const bridges = [...display().querySelectorAll('.reel-bridge')].map(n => n.textContent);
    expect(bridges).toEqual(['↔ Tom Hanks']); // one bridge, before the 2nd node
    expect(display().querySelector('.now-cast-link').textContent).toContain('linked via Tom Hanks');
  });

  test('§4.3 the last entry is the now-playing hero', () => {
    const chain = [
      makeChainItem({ movie: { title: 'First', year: 2000, cast: ['X'], poster: '' } }),
      makeChainItem({ movie: { title: 'Latest', year: 2020, cast: ['X'], poster: '' }, matchedActors: ['X'] }),
    ];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    const nodes = [...display().querySelectorAll('.reel-node')];
    expect(nodes[nodes.length - 1].classList.contains('now-playing')).toBe(true);
    expect(nodes[0].classList.contains('now-playing')).toBe(false);
    expect(display().querySelector('.now-cast-title').textContent).toBe('Latest (2020)');
  });

  test('§4.4 cast panel shows EVERY member, FULL names, ungated (no abbrev, no expand)', () => {
    const cast = [
      'Christian Bale', 'Heath Ledger', 'Aaron Eckhart', 'Michael Caine',
      'Maggie Gyllenhaal', 'Gary Oldman', 'Morgan Freeman', 'Monique Gabriela Curnen',
      'Ron Dean', 'Cillian Murphy', 'Chin Han', 'Nestor Carbonell',
    ];
    const chain = [makeChainItem({ movie: { title: 'The Dark Knight', year: 2008, cast, poster: '' } })];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    const names = [...display().querySelectorAll('.now-cast-list .cast-name')].map(n => n.textContent);
    expect(names).toEqual(cast); // all 12, full names, in billing order
    // ungated: no expand/"show all"/"+N more" control anywhere in the panel
    expect(display().querySelector('.now-cast').textContent).not.toMatch(/show all|\+\s*\d+\s*more/i);
    // no first-name abbreviation leaked in
    expect(display().querySelector('.now-cast-list').textContent).not.toMatch(/\b[A-Z]\.\s/);
  });

  test('§4.4 cast tolerates {id,name} objects and legacy bare strings', () => {
    const chain = [makeChainItem({ movie: { title: 'M', year: 2009, poster: '', cast: [
      { id: 1, name: 'Sam Worthington' }, 'Zoe Saldana', { id: 3, name: 'Sigourney Weaver' },
    ] } })];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    expect([...display().querySelectorAll('.cast-name')].map(n => n.textContent))
      .toEqual(['Sam Worthington', 'Zoe Saldana', 'Sigourney Weaver']);
  });

  test('§4.5 burned stamp absent on normal data; present iff entry.eliminated===true', () => {
    const normal = [makeChainItem(), makeChainItem({ matchedActors: ['x'] })];
    renderGame(makePlayingState({ chain: normal }), 'host_id', false);
    expect(display().querySelector('.reel-burned-stamp')).toBeNull(); // no fabrication
    expect(display().querySelector('.reel-node.burned')).toBeNull();

    loadIndexHtml(); initUIElements();
    const withElim = [
      { ...makeChainItem(), eliminated: true },
      makeChainItem({ matchedActors: ['x'] }),
    ];
    renderGame(makePlayingState({ chain: withElim }), 'host_id', false);
    expect(display().querySelectorAll('.reel-node.burned').length).toBe(1);
    expect(display().querySelector('.reel-burned-stamp').textContent).toBe('OUT');
  });

  test('§4.6 zero stableId / identity in the rendered filmstrip DOM', () => {
    const players = [
      makePlayer({ id: 'sock_AAA', stableId: 'stable_SECRET_1', name: 'Ann', isHost: true }),
      makePlayer({ id: 'sock_BBB', stableId: 'stable_SECRET_2', name: 'Bo' }),
    ];
    const chain = [
      makeChainItem({ playerName: 'Ann', playerId: 'sock_AAA', movie: { title: 'A', year: 2001, cast: ['Q'], poster: '' } }),
      makeChainItem({ playerName: 'Bo', playerId: 'sock_BBB', movie: { title: 'B', year: 2002, cast: ['Q'], poster: '' }, matchedActors: ['Q'] }),
    ];
    renderGame(makePlayingState({ players, chain }), 'sock_AAA', false);
    const html = display().innerHTML;
    expect(html).not.toContain('stable_SECRET_1');
    expect(html).not.toContain('stable_SECRET_2');
    expect(html).not.toContain('sock_AAA');
    expect(html).not.toContain('sock_BBB');
  });

  test('§4.8 a subsequent render does NOT clobber showGameOverBanner', () => {
    // game-over: renderGame runs renderChainItems (filmstrip) AND the
    // game-over branch appends .game-over-banner into #chain-display.
    // A later stateUpdate re-render must keep BOTH (filmstrip never wipes
    // #chain-display.innerHTML — it rebuilds only its .filmstrip child).
    // WHY fix (plan-test correction): renderGame(finished) internally calls
    // showGameOverBanner which appends a real banner with child elements;
    // querying the FIRST .game-over-banner textContent therefore includes all
    // child text, not just the title. The §4.8 property is: after a re-render
    // the banner and filmstrip BOTH survive — we assert the count is unchanged
    // and the filmstrip reel is present, which fully pins the no-clobber contract
    // without brittle textContent matching against internal banner structure.
    const chain = [makeChainItem({ movie: { title: 'Fin', year: 2021, cast: ['Z'], poster: '' } })];
    const finished = { ...makePlayingState({ chain }), status: 'finished', winner: { name: 'Host', score: 3 } };
    renderGame(finished, 'host_id', false);
    // renderGame appended the real banner; mark it with a sentinel data-attr
    // so we can confirm it (and any additional sibling banners) are preserved.
    const realBanner = display().querySelector('.game-over-banner');
    expect(realBanner).not.toBeNull();
    realBanner.dataset.sentinel = 'original';
    // simulate showGameOverBanner having also appended a second banner
    const extraBanner = document.createElement('div');
    extraBanner.className = 'game-over-banner';
    extraBanner.dataset.sentinel = 'extra';
    display().appendChild(extraBanner);
    const countBefore = display().querySelectorAll('.game-over-banner').length; // 2
    // a re-fired stateUpdate re-renders the same finished state
    renderGame(finished, 'host_id', false);
    // both banners must survive (filmstrip rebuild never touches banner siblings)
    expect(display().querySelectorAll('.game-over-banner').length).toBe(countBefore);
    expect(display().querySelector('[data-sentinel="original"]')).not.toBeNull();
    expect(display().querySelector('[data-sentinel="extra"]')).not.toBeNull();
    expect(display().querySelector('.filmstrip .reel-node')).not.toBeNull();
  });

  test('§4.8 chain reset (shrink to empty) clears the filmstrip', () => {
    renderGame(makePlayingState({ chain: [makeChainItem(), makeChainItem({ matchedActors: ['x'] })] }), 'host_id', false);
    expect(display().querySelector('.filmstrip')).not.toBeNull();
    renderGame(makePlayingState({ chain: [] }), 'host_id', false);
    expect(display().querySelector('.filmstrip')).toBeNull();
    expect(display().querySelector('.empty-board-hint')).not.toBeNull();
  });
});

import { markClutchSave } from '../public/js/ui.js';

describe('filmstrip — Task 2 wired contract', () => {
  test('jsdom (no matchMedia) → settled end-state, no pending timers', () => {
    jest.useFakeTimers();
    const chain = [makeChainItem({ movie: { title: 'Solo', year: 2018, cast: ['A'], poster: '' } })];
    renderGame(makePlayingState({ chain }), 'host_id', false);
    // reducedMotion is computed at the call site; jsdom has no matchMedia →
    // treated as reduced → choreographTurn takes instant settled path (0 new
    // timers). renderGame also schedules a pre-existing scroll-into-view
    // setTimeout (renderPlayerSidebar L676) — that's 1 timer total, all from
    // the scroll helper, NONE from choreographTurn. Plan-test bug fix: the
    // plan assumed 0 but renderGame pre-dates Task 2 with its own scroll timer.
    expect(jest.getTimerCount()).toBe(1);
    expect(display().querySelector('.reel-node.now-playing .reel-title').textContent).toBe('Solo (2018)');
    jest.useRealTimers();
  });

  test('clutch flag → now-playing node gets .clutch + one .clutch-flash, for that render only', () => {
    const base = makePlayingState({ chain: [makeChainItem(), makeChainItem({ matchedActors: ['x'] })] });
    markClutchSave();
    renderGame(base, 'host_id', false);
    const hero = display().querySelector('.reel-node.now-playing');
    expect(hero.classList.contains('clutch')).toBe(true);
    expect(hero.querySelectorAll('.clutch-flash').length).toBe(1);
    // flag consumed: a subsequent render WITHOUT markClutchSave() → no clutch
    renderGame(base, 'host_id', false);
    expect(display().querySelector('.reel-node.now-playing').classList.contains('clutch')).toBe(false);
  });

  test('no clutch flag → never any .clutch / .clutch-flash', () => {
    renderGame(makePlayingState({ chain: [makeChainItem()] }), 'host_id', false);
    expect(display().querySelector('.clutch')).toBeNull();
    expect(display().querySelector('.clutch-flash')).toBeNull();
  });
});
