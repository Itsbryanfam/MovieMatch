# Phase 6c.1 — Quick Kits Replace the Theme Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Quick Kits the single lobby "vibe" control — remove the redundant theme dropdown, expand the catalog 6→9 so every major genre stays reachable, and turn each chip into a self-documenting card (icon + label + description) that fixes the dark-text contrast bug.

**Architecture:** The kit catalog stays server-authoritative (`server/ruleKits.js`); it gains a `desc` field + 3 genre kits. The standalone theme picker (`#theme-select`/`#theme-select-team` + all wiring that serves only it) is removed, while the `themesSystem` *mechanic* (kit theme validation + in-play filtering) is untouched. The chip renderer adds a visible description sub-line (works on touch, unlike hover tooltips) plus a `title`/`aria-label`.

**Tech Stack:** Node/Express/Socket.IO (CommonJS server, no build), vanilla ESM client via `public/js/ui.js`, Jest two-project (server=node, client=jsdom+babel).

**Spec:** `docs/superpowers/specs/2026-05-22-6c1-quick-kits-replace-themes-design.md` (committed @ `7a54dc8`; `origin/main` @ `bcd3b39`).

**Baseline:** suite **660 green**. Target after T2: ~660 (lose 1 theme-picker test, add ~3 kit/desc tests).

---

## Important context

- This is a **fast-follow on 6c** (PR #51, merged). Editing tests here is **legitimate** where they pin the removed theme picker or the `listKits` shape — that's not the additive 6b/6c discipline. **Only** touch tests tied to those two things; everything else stays untouched.
- **Byte-untouched:** `server/systems/themesSystem.js` (mechanic kept — `isValidTheme` is used by `selectRuleKit`, `matchesTheme` filters in play), `server/systems/statsSystem.js`, `server/gameLogic.js`, and all 6b achievements/titles code.
- The two `ui-render.js` theme blocks are **already null-guarded** (`if (themeSel) {…}`), so removing the DOM elements cannot crash render — the blocks are removed for cleanliness, not necessity.
- **WHY-comments on every changed line.**
- Commits prefixed `Phase 6c1 T<N>:`.

---

## File Structure / decomposition

- **T0** — `server/ruleKits.js` (data: `desc` + 3 kits) + its test consumers. Pure data change.
- **T1** — Theme-picker removal across client (`index.html`, `app.js`, `socketClient.js`, `ui-render.js`) + server (`socketHandlers.js`, `lobbySystem.js`) + the one test that pins it. Behavior removal.
- **T2** — Kit card UI: `rule-kits.js` renderer + its test + CSS (chip card restyle in `02-hero-lobby.css`, dead `#theme-select` CSS tombstone in `06-states-anim.css`). Presentation.

Dependencies: T0 and T1 are independent; **T2 blockedBy [T0, T1]** (the card renders T0's `desc`, and the CSS tombstone follows T1's element removal).

---

### Task 0: ruleKits.js — add `desc` + 3 genre kits (6→9)

**Goal:** The catalog gains a `desc` per kit and 3 new genre kits; `listKits()` returns `{id,label,icon,desc}`.

**Files:**
- Modify: `server/ruleKits.js`
- Modify (test): `server/ruleKits.test.js`, `server/my-stats-enrichment.test.js`

**Acceptance Criteria:**
- [ ] `RULE_KITS` has 9 entries; the 3 new (`comedy_night`, `blockbuster`, `scifi_night`) use themes `comedy`/`action`/`scifi` + `classic` mode + no toggles.
- [ ] Every kit has a non-empty string `desc`.
- [ ] `listKits()` returns rows of exactly `{id,label,icon,desc}`.
- [ ] `ruleKits.test.js` + `my-stats-enrichment.test.js` updated for 9 + the new shape; full suite green.

**Verify:** `npx jest server/ruleKits.test.js server/my-stats-enrichment.test.js --verbose && npm test --silent`

**Steps:**

- [ ] **Step 1: Update the tests first (RED).** In `server/ruleKits.test.js`:
  - Change `expect(RULE_KITS.length).toBe(6);` → `expect(RULE_KITS.length).toBe(9);`
  - Inside the `for (const k of RULE_KITS) {…}` integrity loop, add:
    ```js
    expect(typeof k.desc).toBe('string');
    expect(k.desc.length).toBeGreaterThan(0);
    ```
  - Change `expect(list.length).toBe(6);` → `expect(list.length).toBe(9);`
  - Change `expect(Object.keys(row).sort()).toEqual(['icon', 'id', 'label']);` → `expect(Object.keys(row).sort()).toEqual(['desc', 'icon', 'id', 'label']);`
  - Add a new test after the integrity block:
    ```js
    test('includes the 3 new genre kits mapped to valid themes', () => {
      // Phase 6c.1 — kits replace the theme picker; these backfill the genres
      // the dropdown used to offer (comedy/action/scifi).
      expect(getKit('comedy_night')).toMatchObject({ theme: 'comedy', mode: 'classic' });
      expect(getKit('blockbuster')).toMatchObject({ theme: 'action', mode: 'classic' });
      expect(getKit('scifi_night')).toMatchObject({ theme: 'scifi', mode: 'classic' });
    });
    ```

  In `server/my-stats-enrichment.test.js`, in the `'emits ruleKitsList (6 kits) on connection'` test:
  - Rename the test title to `'emits ruleKitsList (9 kits) on connection'`.
  - Change `expect(call[1].length).toBe(6);` → `expect(call[1].length).toBe(9);`
  - Change `expect(Object.keys(call[1][0]).sort()).toEqual(['icon', 'id', 'label']);` → `expect(Object.keys(call[1][0]).sort()).toEqual(['desc', 'icon', 'id', 'label']);`

- [ ] **Step 2: Run RED** — `npx jest server/ruleKits.test.js server/my-stats-enrichment.test.js --verbose` → FAIL (length 6≠9, missing `desc`).

- [ ] **Step 3: Rewrite the catalog + `listKits` in `server/ruleKits.js`.** Replace the `RULE_KITS` array and the `listKits` function with:

```js
const RULE_KITS = Object.freeze([
  Object.freeze({ id: 'date_night',        label: 'Date Night',        icon: '💘', theme: 'romance',      mode: 'classic', hardcore: false, tvShows: false, desc: 'Romance · Classic' }),
  Object.freeze({ id: 'after_dark',        label: 'After Dark',        icon: '🎃', theme: 'horror',       mode: 'classic', hardcore: false, tvShows: false, desc: 'Horror · Classic' }),
  // Phase 6c.1 — comedy/action/scifi kits backfill the genres the removed
  // theme dropdown used to offer, so kits fully replace the picker.
  Object.freeze({ id: 'comedy_night',      label: 'Comedy Night',      icon: '😂', theme: 'comedy',       mode: 'classic', hardcore: false, tvShows: false, desc: 'Comedy · Classic' }),
  Object.freeze({ id: 'blockbuster',       label: 'Blockbuster',       icon: '💥', theme: 'action',       mode: 'classic', hardcore: false, tvShows: false, desc: 'Action · Classic' }),
  Object.freeze({ id: 'scifi_night',       label: 'Sci-Fi Night',      icon: '🚀', theme: 'scifi',        mode: 'classic', hardcore: false, tvShows: false, desc: 'Sci-Fi · Classic' }),
  Object.freeze({ id: 'hardcore_sprint',   label: 'Hardcore Sprint',   icon: '🔥', theme: 'any',         mode: 'speed',   hardcore: true,  tvShows: false, desc: 'Any · Speed · Hardcore' }),
  Object.freeze({ id: 'decade_drift',      label: 'Decade Drift',      icon: '📼', theme: 'decade_1990s', mode: 'classic', hardcore: false, tvShows: false, desc: "'90s · Classic" }),
  Object.freeze({ id: 'saturday_cartoons', label: 'Saturday Cartoons', icon: '🎨', theme: 'animation',    mode: 'classic', hardcore: false, tvShows: true,  desc: 'Animation · incl. TV' }),
  Object.freeze({ id: 'classic_open',      label: 'Classic Open',      icon: '🎬', theme: 'any',         mode: 'classic', hardcore: false, tvShows: false, desc: 'Anything goes · Classic' }),
]);
```

And update `listKits` to carry `desc`:

```js
// Display shape for the client chip strip (id + label + icon + desc only).
// Phase 6c.1 — `desc` drives the self-documenting card sub-line + hover title.
function listKits() {
  return RULE_KITS.map(k => ({ id: k.id, label: k.label, icon: k.icon, desc: k.desc }));
}
```

`getKit` and `module.exports` are unchanged.

- [ ] **Step 4: Run GREEN** — `npx jest server/ruleKits.test.js server/my-stats-enrichment.test.js --verbose` → PASS; then `npm test --silent` → full suite green.

- [ ] **Step 5: Commit**

```bash
git add server/ruleKits.js server/ruleKits.test.js server/my-stats-enrichment.test.js
git commit -m "Phase 6c1 T0: add kit desc + comedy/action/scifi kits (6 -> 9)"
```

```json:metadata
{"files": ["server/ruleKits.js", "server/ruleKits.test.js", "server/my-stats-enrichment.test.js"], "verifyCommand": "npx jest server/ruleKits.test.js server/my-stats-enrichment.test.js --verbose && npm test --silent", "acceptanceCriteria": ["RULE_KITS has 9 entries incl comedy_night/blockbuster/scifi_night (comedy/action/scifi, classic, no toggles)", "every kit has non-empty desc", "listKits returns {id,label,icon,desc}", "ruleKits.test + my-stats-enrichment.test updated for 9 + new shape; full suite green"]}
```

---

### Task 1: Remove the theme picker (UI + sole-purpose wiring)

**Goal:** Delete the standalone theme dropdown and everything that exists only to serve it, keeping the `themesSystem` mechanic and the Hardcore/TV controls.

**Files:**
- Modify: `public/index.html` (remove 2 theme `<label>` rows)
- Modify: `public/js/app.js` (drop theme-select from `initLobbySettingsHandlers`)
- Modify: `public/js/socketClient.js` (remove `themesList` handler)
- Modify: `public/js/ui/ui-render.js` (remove 2 dead `#theme-select(-team)` blocks)
- Modify: `server/socketHandlers.js` (remove `themesList` emit + `setTheme` handler)
- Modify: `server/systems/lobbySystem.js` (remove `setTheme` + its export)
- Modify (test): `client-tests/socket-handlers.test.js` (remove the `#theme-select-team` test)

**Acceptance Criteria:**
- [ ] No `#theme-select` / `#theme-select-team` in `index.html`; no theme `change` handler in `app.js`; no `themesList` handler in `socketClient.js`; no `#theme-select` blocks in `ui-render.js`.
- [ ] No `themesList` emit and no `setTheme` handler in `socketHandlers.js`; no `setTheme` in `lobbySystem.js` (or its export).
- [ ] `themesSystem.js` byte-identical; Hardcore + TV controls + handlers intact.
- [ ] `socket-handlers.test.js` theme test removed; sibling hardcore/tv tests still pass; full suite green.

**Verify:** `npx jest client-tests/socket-handlers.test.js --verbose && npm test --silent`

**Steps:**

- [ ] **Step 1: Remove the test that pins the picker (RED-by-removal is N/A; this is a deletion).** In `client-tests/socket-handlers.test.js`, delete the entire test block:
    ```js
    test('#theme-select-team change emits setTheme with the selected theme value', () => {
      const el = document.getElementById('theme-select-team');
      // Add an option so we can set a non-empty value.
      const opt = document.createElement('option');
      opt.value = 'horror'; opt.textContent = 'Horror';
      el.appendChild(opt);
      el.value = 'horror';
      el.dispatchEvent(new Event('change', { bubbles: true }));
      expect(mockSocket.emit).toHaveBeenCalledWith('setTheme', {
        lobbyId: 'TEST01',
        theme: 'horror',
      });
    });
    ```
  Leave the two sibling tests (`#hardcore-toggle-team`, `#tv-shows-toggle-team`) and the `describe` wrapper intact.

- [ ] **Step 2: Remove the classic theme row in `public/index.html`** — delete this block (the `<label>` wrapping `#theme-select`, currently ~:332-343, including the comment above it):
    ```html
                <!-- Theme row: <label> wraps #theme-select to restore the programmatic
                     label/control association (a11y); matches Hardcore/TV rows;
                     socketClient change handler fires on the <select> unchanged. -->
                <label class="ledger-row">
                  <div>
                    <div class="lr-name">Theme</div>
                    <div class="lr-desc">Filter the candidate pool</div>
                  </div>
                  <div class="lr-right">
                    <select id="theme-select" class="theme-select" disabled></select>
                  </div>
                </label>
    ```
  The `#lobby-settings` ledger keeps the Hardcore + TV rows that follow.

- [ ] **Step 3: Remove the team theme row in `public/index.html`** — delete this block (~:441-449):
    ```html
                <label class="ledger-row">
                  <div>
                    <div class="lr-name">Theme</div>
                    <div class="lr-desc">Filter the candidate pool</div>
                  </div>
                  <div class="lr-right">
                    <select id="theme-select-team" class="theme-select" disabled></select>
                  </div>
                </label>
    ```
  The `#lobby-settings-team` ledger keeps its Hardcore + TV rows.

- [ ] **Step 4: Drop theme-select from `initLobbySettingsHandlers` in `public/js/app.js`** — delete this block (~:64-69), keeping the Hardcore + TV blocks:
    ```js
      // Theme picker: classic + team. setTheme payload: { lobbyId, theme }.
      ['theme-select', 'theme-select-team'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', (e) => {
          socket.emit('setTheme', { lobbyId: getLobbyId(), theme: e.target.value });
        });
      });
    ```

- [ ] **Step 5: Remove the `themesList` handler in `public/js/socketClient.js`** — delete the handler + its descriptive comment block (~:210-232: the `// L1 …`/`window.__mmThemes …` comment paragraph through the closing `});` of `socket.on('themesList', …)`). Remove the whole comment-and-handler unit; leave surrounding handlers intact. The exact handler:
    ```js
      socket.on('themesList', (themes) => {
        if (Array.isArray(themes)) {
          window.__mmThemes = themes;
          window.dispatchEvent(new CustomEvent('mm:themes-updated'));
        }
      });
    ```

- [ ] **Step 6: Remove the dead `#theme-select` block in `public/js/ui/ui-render.js` (`renderLobby`)** — delete (~:287-309):
    ```js
      // L1: Theme picker. Populated from the server-supplied themes list
      // (cached on window.__mmThemes by socketClient on connect). Disabled
      // for non-hosts so guests can see what theme is active but can't
      // change it. Only rebuilt if the option set differs (re-rendering
      // every state update would steal the user's mid-selection focus).
      const themeSel = document.getElementById('theme-select');
      if (themeSel) {
        const themes = Array.isArray(window.__mmThemes) ? window.__mmThemes : [{ id: 'any', label: '🎬 Any (no theme)' }];
        const expectedIds = themes.map(t => t.id).join('|');
        if (themeSel.dataset.themeIds !== expectedIds) {
          themeSel.textContent = '';
          themes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.label;
            if (t.description) opt.title = t.description;
            themeSel.appendChild(opt);
          });
          themeSel.dataset.themeIds = expectedIds;
        }
        themeSel.value = gameState.theme || 'any';
        themeSel.disabled = !amIHost;
      }
    ```
  The `hardcoreToggle.checked = …` lines immediately after stay.

- [ ] **Step 7: Remove the dead `#theme-select-team` block in `public/js/ui/ui-render.js` (`renderTeamScreen`)** — delete the `const themeSelTeam = …` block (~:483-502) AND the now-stale comment lines just above it that refer only to the theme-block duplication (the "A shared helper … deferred to DS-01 pass 2" sentence at ~:478-479):
    ```js
      const themeSelTeam = document.getElementById('theme-select-team');
      if (themeSelTeam) {
        const themes = Array.isArray(window.__mmThemes)
          ? window.__mmThemes
          : [{ id: 'any', label: '🎬 Any (no theme)' }];
        const expectedIds = themes.map(t => t.id).join('|');
        if (themeSelTeam.dataset.themeIds !== expectedIds) {
          themeSelTeam.textContent = '';
          themes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.label;
            if (t.description) opt.title = t.description;
            themeSelTeam.appendChild(opt);
          });
          themeSelTeam.dataset.themeIds = expectedIds;
        }
        themeSelTeam.value    = gameState.theme || 'any';
        themeSelTeam.disabled = !amIHost;
      }
    ```
  Keep the `const hcTeam = …` block that follows. If removing the upstream comment is ambiguous, leave the general "House Rules ledger — sync the team-suffixed controls" comment and only drop the theme-specific sentence.

- [ ] **Step 8: Remove the `themesList` emit in `server/socketHandlers.js`** — delete (~:143-152):
    ```js
        // L1: Send the theme list once per connection so the lobby's theme
        // picker can populate without a round-trip when the player enters
        // the lobby screen. ~600 bytes, sent once. Same pattern as posters.
        try {
          const themesSystem = require('./systems/themesSystem');
          socket.emit('themesList', themesSystem.listThemes());
        } catch {
          // No themes available is degenerate — client falls back to a
          // single "Any" entry it hardcodes.
        }
    ```
  The Phase 6c `ruleKitsList` emit block immediately after stays.

- [ ] **Step 9: Remove the `setTheme` handler in `server/socketHandlers.js`** — delete (~:223-228):
    ```js
        on('setTheme', async (data) => {
          // L1: Host-only setter; lobbySystem validates the theme id against
          // the whitelist so a buggy/malicious client can't write garbage.
          if (await lobbyConfigLimited()) return;
          await lobbySystem.setTheme(ctx, socket, data);
        });
    ```

- [ ] **Step 10: Remove `setTheme` from `server/systems/lobbySystem.js`** — delete the function + its comment (~:283-300):
    ```js
    // L1: Host-only setter for the lobby theme. Validated against the
    // themesSystem whitelist so a malicious client can't set an arbitrary
    // string (which would degrade safely via matchesTheme's fallback, but
    // would also clutter the room state with junk).
    async function setTheme(ctx, socket, { lobbyId, theme }) {
      const { io, pubClient } = ctx;
      const themesSystem = require('./themesSystem');
      if (!themesSystem.isValidTheme(theme)) return;
      // Audit finding #4: serialized read-modify-write (see setGameMode).
      let changed = false;
      const room = await redisUtils.withLobbyLock(pubClient, lobbyId, (r) => {
        if (r.status !== 'waiting') return false;
        if (!r.players.find(p => p.id === socket.id)?.isHost) return false;
        r.theme = theme;
        changed = true;
      });
      if (changed && room) gameLogic.broadcastState(io, lobbyId, room);
    }
    ```
  And remove the `setTheme,` line from the `module.exports` block (~:962). (Confirmed sole caller was the now-removed socket handler; no test references it.)

- [ ] **Step 11: Verify** — `npx jest client-tests/socket-handlers.test.js --verbose` → PASS (the 2 sibling toggle tests + the rest). Then `npm test --silent` → full suite green. Then confirm cleanliness:
    ```bash
    grep -rn "theme-select\|themesList\|setTheme" public/ server/ | grep -v node_modules
    git diff --stat 7a54dc8 -- server/systems/themesSystem.js
    ```
  Expect: no matches in code (only possibly stale comments you may leave), and `themesSystem.js` shows zero changes.

- [ ] **Step 12: Commit**

```bash
git add public/index.html public/js/app.js public/js/socketClient.js public/js/ui/ui-render.js server/socketHandlers.js server/systems/lobbySystem.js client-tests/socket-handlers.test.js
git commit -m "Phase 6c1 T1: remove the lobby theme picker (keep themesSystem mechanic)"
```

```json:metadata
{"files": ["public/index.html", "public/js/app.js", "public/js/socketClient.js", "public/js/ui/ui-render.js", "server/socketHandlers.js", "server/systems/lobbySystem.js", "client-tests/socket-handlers.test.js"], "verifyCommand": "npx jest client-tests/socket-handlers.test.js --verbose && npm test --silent", "acceptanceCriteria": ["no #theme-select/#theme-select-team in index.html; no theme change-handler in app.js; no themesList handler in socketClient; no #theme-select blocks in ui-render", "no themesList emit + no setTheme handler in socketHandlers; no setTheme in lobbySystem/export", "themesSystem.js byte-identical; hardcore/tv controls intact", "socket-handlers.test theme test removed, siblings pass; full suite green"]}
```

---

### Task 2: Kit card UI — self-documenting cards + contrast fix + dead-CSS tombstone

**Goal:** Render each kit as a card (icon + bold label + muted description), set `title`/`aria-label`, fix the dark-text contrast, and tombstone the dead `#theme-select` CSS.

**Files:**
- Modify: `public/js/ui/rule-kits.js` (`renderRuleKitChips` — desc sub-line + title/aria)
- Modify (test): `client-tests/rule-kit-chips.test.js`
- Modify: `public/css/02-hero-lobby.css` (restyle the 6c `.rule-kit-chip*` rules into a card; explicit light text)
- Modify: `public/css/06-states-anim.css` (remove dead `#theme-select option` rules → tombstone)

**Acceptance Criteria:**
- [ ] `renderRuleKitChips` renders `.rule-kit-chip-name` (label) + `.rule-kit-chip-desc` (desc) in a `.rule-kit-chip-text` column, sets `chip.title` + `aria-label` from `desc`; null-container + click→`onPick(id)` unchanged.
- [ ] `.rule-kit-chip` has an explicit light text `color` (no longer inherits dark); the card shows two lines.
- [ ] `06-states-anim.css` `#theme-select option` rules removed (tombstoned), no other rule changed.
- [ ] `rule-kit-chips.test.js` asserts the desc renders + `title` set; existing assertions pass; full suite green.

**Verify:** `npx jest client-tests/rule-kit-chips.test.js --verbose && npm test --silent`

**Steps:**

- [ ] **Step 1: Update `client-tests/rule-kit-chips.test.js` (RED).** Change the `KITS` fixture to include `desc`:
    ```js
    const KITS = [
      { id: 'date_night', label: 'Date Night', icon: '💘', desc: 'Romance · Classic' },
      { id: 'after_dark', label: 'After Dark', icon: '🎃', desc: 'Horror · Classic' },
      { id: 'classic_open', label: 'Classic Open', icon: '🎬', desc: 'Anything goes · Classic' },
    ];
    ```
  Add a new test (the existing tests stay):
    ```js
    test('renders the description sub-line and a title/aria tooltip', () => {
      renderRuleKitChips(KITS, container, () => {});
      const chip = container.querySelector('.rule-kit-chip[data-kit-id="date_night"]');
      expect(chip.querySelector('.rule-kit-chip-desc').textContent).toBe('Romance · Classic');
      expect(chip.title).toBe('Romance · Classic');
      expect(chip.getAttribute('aria-label')).toBe('Date Night: Romance · Classic');
    });
    ```

- [ ] **Step 2: Run RED** — `npx jest client-tests/rule-kit-chips.test.js --verbose` → FAIL (no `.rule-kit-chip-desc`, no title).

- [ ] **Step 3: Rewrite `renderRuleKitChips` in `public/js/ui/rule-kits.js`:**

```js
// public/js/ui/rule-kits.js — Phase 6c rule-kit chip renderer (client UI only).
// The kit catalog is SERVER-AUTHORITATIVE, delivered via the ruleKitsList
// socket event — this module just renders whatever kit list it's handed and
// reports clicks. No catalog data here → zero client/server duplication.
export function renderRuleKitChips(kits, container, onPick) {
  if (!container) return;
  container.textContent = '';
  (Array.isArray(kits) ? kits : []).forEach(kit => {
    const chip = document.createElement('button');
    chip.type = 'button';
    // .btn = existing design-system base (cursor/reset); .rule-kit-chip is the
    // card (T2 CSS). Phase 6c.1: kits are now the primary vibe control.
    chip.className = 'btn rule-kit-chip';
    chip.dataset.kitId = kit.id;
    // Phase 6c.1 — desc doubles as the desktop hover title + the a11y label.
    // The visible sub-line below is what covers touch (title tooltips never
    // appear on touch devices).
    if (kit.desc) {
      chip.title = kit.desc;
      chip.setAttribute('aria-label', `${kit.label || kit.id}: ${kit.desc}`);
    }
    const icon = document.createElement('span');
    icon.className = 'rule-kit-chip-icon';
    icon.setAttribute('aria-hidden', 'true'); // decorative; label carries meaning
    icon.textContent = kit.icon || '';
    // Phase 6c.1 — text column: bold label over a muted description sub-line so
    // each chip is self-documenting on every device.
    const text = document.createElement('span');
    text.className = 'rule-kit-chip-text';
    const name = document.createElement('span');
    name.className = 'rule-kit-chip-name';
    name.textContent = kit.label || kit.id;
    text.appendChild(name);
    if (kit.desc) {
      const desc = document.createElement('span');
      desc.className = 'rule-kit-chip-desc';
      desc.textContent = kit.desc;
      text.appendChild(desc);
    }
    chip.appendChild(icon);
    chip.appendChild(text);
    if (typeof onPick === 'function') {
      chip.addEventListener('click', () => onPick(kit.id));
    }
    container.appendChild(chip);
  });
}
```

- [ ] **Step 4: Restyle the chip in `public/css/02-hero-lobby.css`.** Find the 6c-appended `.rule-kit-chip`, `.rule-kit-chip:hover`, `.rule-kit-chip-icon`, `.rule-kit-chip-name` rules and **replace those four rules** with the card version below (keep `.rule-kit-section`, `.rule-kit-chips`, and `.seat-title` exactly as they are — do not touch them). WHY this is an edit not an append: we are fixing the contrast bug + restructuring rules added in 6c (PR #51), not modifying any pre-6c rule.

```css
.rule-kit-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.8rem;
  min-height: 44px; /* match the .mode-chip touch-target a11y standard */
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px; /* card-ish; distinct from the pill mode-chips so the two rows don't read as the same control */
  background: rgba(255, 255, 255, 0.04);
  color: var(--text, #f4f4f5); /* Phase 6c.1 — explicit light text; the chip was inheriting a dark color (the contrast bug) */
  text-align: left;
}
.rule-kit-chip:hover {
  background: rgba(255, 255, 255, 0.09);
}
.rule-kit-chip-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}
/* Phase 6c.1 — two-line text column: bold label over a muted description. */
.rule-kit-chip-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.rule-kit-chip-name {
  font-weight: 600;
  font-size: 0.85rem;
}
.rule-kit-chip-desc {
  font-size: 0.7rem;
  color: var(--text-muted, #9ca3af);
}
```

- [ ] **Step 5: Tombstone the dead `#theme-select` CSS in `public/css/06-states-anim.css`.** Replace the dead block (~:533-543) with a tombstone:

```css
/* Phase 6c.1 — the #theme-select dropdown was removed (Quick Kits replaced the
   theme picker). Its Windows-option-color workaround is deleted here; verified
   zero remaining #theme-select references in public/**. */
```

  (i.e. delete the `/* L1 follow-up: native <select> … */` comment AND the `#theme-select option { … }` rule, leaving the tombstone.)

- [ ] **Step 6: Run GREEN** — `npx jest client-tests/rule-kit-chips.test.js --verbose` → PASS; then `npm test --silent` → full suite green. Confirm the CSS edit didn't delete any unrelated rule:
    ```bash
    git diff 7a54dc8 -- public/css/06-states-anim.css
    ```
  Expect only the `#theme-select option` block replaced by the tombstone.

- [ ] **Step 7: Commit**

```bash
git add public/js/ui/rule-kits.js client-tests/rule-kit-chips.test.js public/css/02-hero-lobby.css public/css/06-states-anim.css
git commit -m "Phase 6c1 T2: self-documenting kit cards + contrast fix + dead theme CSS tombstone"
```

```json:metadata
{"files": ["public/js/ui/rule-kits.js", "client-tests/rule-kit-chips.test.js", "public/css/02-hero-lobby.css", "public/css/06-states-anim.css"], "verifyCommand": "npx jest client-tests/rule-kit-chips.test.js --verbose && npm test --silent", "acceptanceCriteria": ["renderRuleKitChips renders .rule-kit-chip-name + .rule-kit-chip-desc in .rule-kit-chip-text; sets title + aria-label; null-container + click unchanged", ".rule-kit-chip has explicit light color; two-line card", "06-states-anim #theme-select option removed (tombstone), no other rule changed", "rule-kit-chips.test asserts desc + title; existing pass; full suite green"]}
```

---

## Final verification (after all tasks)

1. `npm test --silent` → full suite green (~660).
2. `git diff --stat 7a54dc8 -- server/systems/themesSystem.js server/systems/statsSystem.js server/gameLogic.js` → **empty** (mechanic + sacrosanct untouched).
3. `grep -rn "theme-select\|themesList\|onsetTheme\|'setTheme'" public/ server/ | grep -v node_modules` → no live references (stale comments OK).
4. Dispatch the **opus whole-branch holistic review**.
5. Finishing: push `phase6c1-kits-replace-themes` + `gh pr create` (base `main`). PR-merge / deploy is classifier-gated → **handed to the user**. After merge: verify Render `live` + in-browser eyeball — theme dropdown gone, 9 self-documenting kit cards with correct contrast + descriptions, a kit chip (incl. a new genre kit) applying live.

## Self-review notes (author)

- **Spec coverage:** removal (T1) ✓; 9-kit catalog + desc (T0) ✓; self-documenting cards + contrast + title/aria (T2) ✓; dead-CSS tombstone (T2) ✓; themesSystem kept (no task touches it) ✓; test edits scoped to picker + listKits shape (T0/T1/T2) ✓.
- **Type consistency:** `desc` is a string on every kit; `listKits` shape `{id,label,icon,desc}` matches T0 data, the my-stats-enrichment assertion (T0), and the renderer/test (T2). `.rule-kit-chip-text`/`.rule-kit-chip-desc` class names match between `rule-kits.js` (T2 Step 3), the test (T2 Step 1), and the CSS (T2 Step 4).
- **No placeholders:** every step shows exact code/edits + exact commands.
