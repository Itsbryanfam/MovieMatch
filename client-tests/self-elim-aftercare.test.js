/**
 * @jest-environment jsdom
 */
const { loadIndexHtml } = require('./fixtures');
import { showSelfEliminationScreen } from '../public/js/ui.js';

const lastEntry = { title: 'Heat', year: 1995, cast: ['Al Pacino', 'Robert De Niro'] };

describe('showSelfEliminationScreen — 7.1 aftercare', () => {
  beforeEach(() => { loadIndexHtml(); });
  // Fix C: align teardown to sibling-suite convention (learning-breakdown, etc.)
  afterEach(() => { document.body.innerHTML = ''; });

  test('invalid path: outs list with via-actor + bridge line, no generic hint', () => {
    showSelfEliminationScreen({
      reason: 'No shared cast', lastChainEntry: lastEntry,
      yourGuess: { title: 'Cats', year: 2019, cast: ['x'] },
      outs: [{ title: 'Speed', year: '1994', viaActor: 'Keanu Reeves' },
             { title: 'Point Break', year: '1991', viaActor: 'Keanu Reeves' }],
    });
    const rows = [...document.querySelectorAll('.self-elim-outs-row')].map(r => r.textContent);
    expect(rows).toEqual(['Speed (1994) — via Keanu Reeves', 'Point Break (1991) — via Keanu Reeves']);
    expect(document.querySelector('.self-elim-bridge').textContent).toMatch(/one bridge away/i);
    expect(document.querySelector('.self-elim-hint')).toBeNull();
    expect(document.querySelector('.self-elim-col--played')).not.toBeNull();
  });

  test('timeout variant: detailed card, needed-only, no "You played"', () => {
    showSelfEliminationScreen({ reason: 'Turn timed out', lastChainEntry: lastEntry, timedOut: true,
      outs: [{ title: 'Speed', year: '1994', viaActor: 'Keanu Reeves' }] });
    expect(document.querySelector('.self-elim-screen--detailed')).not.toBeNull();
    expect(document.querySelector('.self-elim-col--needed')).not.toBeNull();
    expect(document.querySelector('.self-elim-col--played')).toBeNull();
    expect(document.querySelector('.self-elim-title').textContent).toMatch(/time/i);
  });

  test('no outs + no timedOut ⇒ pre-7.1 detailed card (generic hint, no outs block)', () => {
    showSelfEliminationScreen({ reason: 'No shared cast', lastChainEntry: lastEntry,
      yourGuess: { title: 'Cats', year: 2019, cast: ['x'] } });
    expect(document.querySelector('.self-elim-outs')).toBeNull();
    expect(document.querySelector('.self-elim-hint')).not.toBeNull();
  });

  test('detail-less ⇒ legacy flash (auto-removing, no card)', () => {
    showSelfEliminationScreen();
    expect(document.querySelector('.self-elim-card')).toBeNull();
    expect(document.querySelector('.self-elim-screen')).not.toBeNull();
  });

  test('XSS: crafted title rendered as text', () => {
    showSelfEliminationScreen({ reason: 'r', lastChainEntry: lastEntry, timedOut: true,
      outs: [{ title: '<img src=x onerror=alert(1)>', year: '2', viaActor: 'Z' }] });
    const row = document.querySelector('.self-elim-outs-row');
    expect(row.querySelector('img')).toBeNull();
    expect(row.textContent).toContain('<img');
  });

  // Fix B: fail-closed — timedOut:true with no outs (server TMDB-miss / _computeCouldHavePlayed
  // returned null → key omitted). Card must degrade coherently: detailed timeout card renders,
  // needed column present, no "You played" column, no .self-elim-outs block, generic hint fallback.
  test('timeout + no outs ⇒ detailed timeout card, needed-only, generic hint fallback (fail-closed)', () => {
    showSelfEliminationScreen({ reason: 'Turn timed out', lastChainEntry: lastEntry, timedOut: true });
    expect(document.querySelector('.self-elim-screen--detailed')).not.toBeNull();
    expect(document.querySelector('.self-elim-col--needed')).not.toBeNull();
    expect(document.querySelector('.self-elim-col--played')).toBeNull();
    expect(document.querySelector('.self-elim-outs')).toBeNull();
    expect(document.querySelector('.self-elim-hint')).not.toBeNull();
    expect(document.querySelector('.self-elim-title').textContent).toMatch(/time/i);
  });
});
