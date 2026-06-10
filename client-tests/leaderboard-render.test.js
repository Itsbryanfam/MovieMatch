// Phase 7.10 — DS-01 pass 2 T0: pin the leaderboard renderer migration.
// NOTE: uses the default jsdom env (not node) because setup.js (required by
// the client jest project) references `window` and crashes in node env.
// fs.readFileSync works identically in jsdom — the assertions are file-content
// only (no DOM interaction) so the env choice has no effect on correctness.
// loadLeaderboard is closure-scoped inside app.js DOMContentLoaded so
// direct import is impossible; we assert the migration's post-state by
// reading the source files. The sacrosanct guard is that no pre-existing
// behaviour test changes (renderer's render contract is unchanged — only
// inline-style vs class is migrated).

const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'public', 'css', '03-game.css');
const appJsPath = path.join(__dirname, '..', 'public', 'js', 'app.js');
const css = fs.readFileSync(cssPath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');

// Isolate the loadLeaderboard function body — start to its closing brace
// followed by a blank line (the function ends at `  }\n\n  leaderboardBtn...`).
// The trailing blank-line anchor prevents the non-greedy `*?` from stopping
// at a nested block's closing brace. The function spans approx lines 609-654;
// we capture the chunk so substring assertions don't false-match elsewhere
// in app.js.
// WHY \r?\n: the repo uses CRLF line endings on Windows; the regex must
// handle both LF and CRLF so the tests are cross-platform stable.
// eslint-disable-next-line no-regex-spaces -- T5d: the two literal spaces match the exact 2-space source indentation of the closing brace in app.js. Rewriting to ` {2}` is equivalent but pointlessly perturbs a regex that intentionally mirrors source text; leave the byte-for-byte form.
const leaderboardFnMatch = appJs.match(/async function loadLeaderboard\([\s\S]*?\r?\n  \}\r?\n\r?\n/);
const leaderboardFnBody = leaderboardFnMatch ? leaderboardFnMatch[0] : '';

describe('Phase 7.10 T0 — leaderboard renderer migration', () => {
  describe('03-game.css new rules', () => {
    test('contains .leaderboard-row rule with display:flex', () => {
      expect(css).toMatch(/\.leaderboard-row\s*\{[^}]*display:\s*flex/);
    });
    test('contains .leaderboard-rank rule with width 2.5rem', () => {
      expect(css).toMatch(/\.leaderboard-rank\s*\{[^}]*width:\s*2\.5rem/);
    });
    test('contains .leaderboard-name rule with flex:1', () => {
      expect(css).toMatch(/\.leaderboard-name\s*\{[^}]*flex:\s*1/);
    });
    test('contains .leaderboard-wins rule with var(--text-muted) — no #94a3b8 fallback', () => {
      const winsRule = css.match(/\.leaderboard-wins\s*\{[^}]*\}/);
      expect(winsRule).not.toBeNull();
      expect(winsRule[0]).toMatch(/color:\s*var\(--text-muted\)/);
      expect(winsRule[0]).not.toMatch(/#94a3b8/);
    });
    test('contains .empty-hint--lg modifier with padding 2rem', () => {
      expect(css).toMatch(/\.empty-hint--lg\s*\{[^}]*padding:\s*2rem/);
    });
    test('contains .empty-hint--sm modifier with padding 1rem', () => {
      expect(css).toMatch(/\.empty-hint--sm\s*\{[^}]*padding:\s*1rem/);
    });
  });

  describe('app.js loadLeaderboard function — migration to className', () => {
    test('function body found in app.js (regex sanity check)', () => {
      expect(leaderboardFnBody).not.toBe('');
      expect(leaderboardFnBody).toContain('leaderboardList.innerHTML');
    });
    test('contains zero .style.cssText writes (all 7 sites migrated)', () => {
      expect(leaderboardFnBody).not.toMatch(/\.style\.cssText\s*=/);
    });
  });
});
