/**
 * @jest-environment jsdom
 */
// Phase 7.3 CSS hygiene guard. CSS has no jsdom-observable layout, so this
// test pins the DOM *contract* the CSS edits rely on:
//  - .self-elim-could is never emitted (verified orphan → safe to delete)
//  - the 7.1 .self-elim-outs*/-bridge classes ARE emitted (correct style targets)
//  - the timeout card renders exactly ONE .self-elim-col (the :only-child
//    centering target — the asymmetry case)
// It is written first and must pass; it provides lasting regression value
// (fails if a future change reintroduces .self-elim-could or stops emitting
// the outs classes). Visual correctness is verified in-browser (user-side).
const { loadIndexHtml } = require('./fixtures');
import { showSelfEliminationScreen } from '../public/js/ui.js';

const lastEntry = { title: 'Heat', year: 1995, cast: ['Al Pacino', 'Robert De Niro'] };

describe('Phase 7.3 self-elim CSS hygiene — DOM contract', () => {
  beforeEach(() => { loadIndexHtml(); });
  afterEach(() => { document.body.innerHTML = ''; });

  test('orphaned .self-elim-could is never emitted (safe to delete the rule)', () => {
    showSelfEliminationScreen({
      reason: 'No shared cast', lastChainEntry: lastEntry,
      yourGuess: { title: 'Cats', year: 2019, cast: ['x'] },
      outs: [{ title: 'Speed', year: '1994', viaActor: 'Keanu Reeves' }],
    });
    expect(document.querySelector('.self-elim-could')).toBeNull();
  });

  test('the 7.1 outs classes ARE emitted (correct style targets)', () => {
    showSelfEliminationScreen({
      reason: 'No shared cast', lastChainEntry: lastEntry,
      yourGuess: { title: 'Cats', year: 2019, cast: ['x'] },
      outs: [{ title: 'Speed', year: '1994', viaActor: 'Keanu Reeves' }],
    });
    expect(document.querySelector('.self-elim-outs')).not.toBeNull();
    expect(document.querySelector('.self-elim-outs-label')).not.toBeNull();
    expect(document.querySelector('.self-elim-outs-row')).not.toBeNull();
    expect(document.querySelector('.self-elim-bridge')).not.toBeNull();
  });

  test('timeout card renders a single .self-elim-col (the :only-child target)', () => {
    showSelfEliminationScreen({ reason: 'Turn timed out', lastChainEntry: lastEntry, timedOut: true });
    const cols = document.querySelectorAll('.self-elim-grid > .self-elim-col');
    expect(cols.length).toBe(1);
    expect(document.querySelector('.self-elim-col--played')).toBeNull();
  });
});
