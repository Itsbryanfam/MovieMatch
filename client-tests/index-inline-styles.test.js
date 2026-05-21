// Phase 7.10 — DS-01 pass 2 T2: pin the index.html migration's
// post-state. All tests are file-content based since the assertions
// are about static markup + CSS, not runtime behaviour.

const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, '..', 'public', 'index.html');
const heroLobbyCssPath = path.join(__dirname, '..', 'public', 'css', '02-hero-lobby.css');
const modalsCssPath = path.join(__dirname, '..', 'public', 'css', '04-modals.css');

const html = fs.readFileSync(indexHtmlPath, 'utf8');
const heroLobbyCss = fs.readFileSync(heroLobbyCssPath, 'utf8');
const modalsCss = fs.readFileSync(modalsCssPath, 'utf8');

describe('Phase 7.10 T2 — index.html migration + .demo-item orphan deletion', () => {
  describe('index.html — inline styles removed', () => {
    test('no style="..." attribute remains on any element', () => {
      // The pre-migration count was 13; post-migration must be 0.
      const matches = html.match(/style="[^"]*"/g) || [];
      expect(matches).toEqual([]);
    });
    test('<head> contains no inline <style> block (only <link> and JSON-LD <script>)', () => {
      const head = html.match(/<head>[\s\S]*?<\/head>/);
      expect(head).not.toBeNull();
      // No <style>...</style> block anywhere in head (the .hero-demo flicker
      // guard at L79-82 was deleted; the rest of <head> never had inline styles).
      expect(head[0]).not.toMatch(/<style[^>]*>[\s\S]*?<\/style>/);
    });
    test('#team-start-btn includes class "hidden" (replaces inline display:none)', () => {
      const tag = html.match(/<button[^>]*id="team-start-btn"[^>]*>/);
      expect(tag).not.toBeNull();
      expect(tag[0]).toMatch(/class="[^"]*\bhidden\b[^"]*"/);
    });
    test('#chat-badge includes class "hidden"', () => {
      const tag = html.match(/<span[^>]*id="chat-badge"[^>]*>/);
      expect(tag).not.toBeNull();
      expect(tag[0]).toMatch(/class="[^"]*\bhidden\b[^"]*"/);
    });
  });

  describe('02-hero-lobby.css — new rules + orphan deletion', () => {
    test('contains #join-panel .input-group-vertical contextual rule with margin-bottom 1.5rem', () => {
      expect(heroLobbyCss).toMatch(/#join-panel \.input-group-vertical\s*\{[^}]*margin-bottom:\s*1\.5rem/);
    });
    test('contains #join-btn rule with margin-bottom 0.75rem', () => {
      expect(heroLobbyCss).toMatch(/#join-btn\s*\{[^}]*margin-bottom:\s*0\.75rem/);
    });
    test('.demo-item selector is fully absent from 02-hero-lobby.css', () => {
      expect(heroLobbyCss).not.toMatch(/\.demo-item/);
    });
    test('.animate-demo selector is fully absent from 02-hero-lobby.css (co-orphan)', () => {
      expect(heroLobbyCss).not.toMatch(/\.animate-demo/);
    });
  });

  describe('04-modals.css — 6 new rules from index.html migration', () => {
    test('contains .replay-tutorial-row rule with display:flex + justify-content:center', () => {
      const rule = modalsCss.match(/\.replay-tutorial-row\s*\{[^}]*\}/);
      expect(rule).not.toBeNull();
      expect(rule[0]).toMatch(/display:\s*flex/);
      expect(rule[0]).toMatch(/justify-content:\s*center/);
    });
    test('contains #replay-tutorial-btn rule with padding 0.5rem 1.2rem', () => {
      expect(modalsCss).toMatch(/#replay-tutorial-btn\s*\{[^}]*padding:\s*0\.5rem\s+1\.2rem/);
    });
    test('contains #leaderboard-list rule with max-height 400px', () => {
      expect(modalsCss).toMatch(/#leaderboard-list\s*\{[^}]*max-height:\s*400px/);
    });
    test('contains combined #my-stats-body, #daily-result-body rule with max-height 60vh', () => {
      // The combined selector should appear (either order).
      expect(modalsCss).toMatch(/#my-stats-body,\s*#daily-result-body\s*\{[^}]*max-height:\s*60vh/);
    });
    test('contains .daily-result-actions rule with display:flex + gap 0.6rem', () => {
      const rule = modalsCss.match(/\.daily-result-actions\s*\{[^}]*\}/);
      expect(rule).not.toBeNull();
      expect(rule[0]).toMatch(/display:\s*flex/);
      expect(rule[0]).toMatch(/gap:\s*0\.6rem/);
    });
    test('contains combined #daily-result-share-btn, #daily-result-close-btn rule with padding 0.55rem 1.2rem', () => {
      expect(modalsCss).toMatch(/#daily-result-share-btn,\s*#daily-result-close-btn\s*\{[^}]*padding:\s*0\.55rem\s+1\.2rem/);
    });
  });
});
