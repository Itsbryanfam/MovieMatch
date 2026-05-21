/**
 * @jest-environment jsdom
 */
// Phase 7.10 — DS-01 pass 2 T1: pin the 3 empty-hint .style.cssText
// migrations + the 1 socketClient.js innerHTML inline-style migration.
// renderMyStats and renderDailyResult ARE exported (ui-panels.js), so
// those two get DOM-rendering tests. socketClient.js's joinButton and
// "No open lobbies" innerHTML are inside a socket handler (closure-
// scoped), so they get file-content tests.

const fs = require('fs');
const path = require('path');
const { loadIndexHtml } = require('./fixtures');

const socketClientPath = path.join(__dirname, '..', 'public', 'js', 'socketClient.js');
const heroLobbyCssPath = path.join(__dirname, '..', 'public', 'css', '02-hero-lobby.css');

describe('Phase 7.10 T1 — empty-hint cleanup', () => {
  describe('02-hero-lobby.css — new .join-public-btn rule', () => {
    test('contains .join-public-btn rule with padding 0.5rem 1rem and width:auto', () => {
      const css = fs.readFileSync(heroLobbyCssPath, 'utf8');
      const rule = css.match(/\.join-public-btn\s*\{[^}]*\}/);
      expect(rule).not.toBeNull();
      expect(rule[0]).toMatch(/padding:\s*0\.5rem\s+1rem/);
      expect(rule[0]).toMatch(/width:\s*auto/);
    });
  });

  describe('socketClient.js — joinButton + innerHTML migration', () => {
    test('contains zero .style.cssText writes on joinButton (sites 1 and 2 migrated)', () => {
      const src = fs.readFileSync(socketClientPath, 'utf8');
      expect(src).not.toMatch(/joinButton\.style\.cssText/);
    });
    test('"No open lobbies" innerHTML uses .empty-hint empty-hint--lg class with no inline style', () => {
      const src = fs.readFileSync(socketClientPath, 'utf8');
      // The "No open lobbies" template lives at socketClient.js:115. Post-migration
      // it should be `<div class="empty-hint empty-hint--lg">No open lobbies...`
      // with no `style="..."` substring on that line.
      const tagMatch = src.match(/<div\s+class="empty-hint empty-hint--lg">No open lobbies/);
      expect(tagMatch).not.toBeNull();
      // Negative: no `style="..."` should appear on the "No open lobbies" line.
      const noOpenLine = src.split('\n').find((l) => l.includes('No open lobbies'));
      expect(noOpenLine).toBeDefined();
      expect(noOpenLine).not.toMatch(/style="/);
    });
  });

  describe('ui-panels.js renderMyStats / renderDailyResult — DOM tests', () => {
    let renderMyStats, renderDailyResult;
    beforeEach(() => {
      loadIndexHtml();
      // Reset module registry so we re-import after document is mounted
      jest.resetModules();
      const ui = require('../public/js/ui.js');
      renderMyStats = ui.renderMyStats;
      renderDailyResult = ui.renderDailyResult;
    });

    test('renderMyStats with no plays puts .empty-hint.empty-hint--lg in #my-stats-body, no inline style', () => {
      renderMyStats({ gamesPlayed: 0 });
      const empty = document.querySelector('#my-stats-body .empty-hint');
      expect(empty).not.toBeNull();
      expect(empty.classList.contains('empty-hint--lg')).toBe(true);
      expect(empty.getAttribute('style')).toBeNull();
    });

    test('renderDailyResult with empty leaderboard puts .empty-hint.empty-hint--sm, no inline style', () => {
      renderDailyResult({
        score: { totalSec: 60, longestChain: 3 },
        leaderboard: [],
      });
      const empty = document.querySelector('.daily-lb-list .empty-hint');
      expect(empty).not.toBeNull();
      expect(empty.classList.contains('empty-hint--sm')).toBe(true);
      expect(empty.getAttribute('style')).toBeNull();
    });
  });
});
