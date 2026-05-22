# Phase 6c.1 — Quick Kits Replace the Theme Picker (+ kit UI enhancement): Design Spec

**Date:** 2026-05-22
**Status:** Approved (brainstorming) — proceeding to implementation plan
**Phase:** **6c.1** — a fast-follow polish/iteration on Phase 6c (Rule Kits),
shipped in PR #51 (merged to `main` @ `bcd3b39`, live). Sourced from direct user
feedback on the live Quick Kits chips.

---

## 1. Provenance (decision record)

User feedback on the shipped 6c Quick Kits chip row:
1. **Chip text is too dark / low-contrast** — a real bug: `.rule-kit-chip` set a
   background but no explicit text `color`, so the label inherited a dark color
   instead of the light text the adjacent `.mode-chip` uses.
2. **No description of what each kit does** — `listKits()` only sends
   `{id, label, icon}`; a chip labeled "Date Night" doesn't say it sets
   romance + classic.
3. **Quick Kits "competes with themes for design space"** — the lobby has Mode
   chips + Quick Kits chips + a House-Rules Theme dropdown, and a kit overlaps
   all three.

**User decision (verbatim):** *"I feel like its one or the other I like the quick
kits, just get rid of themes and enhance the UI."*

**Resolved scope (this spec):**
- **Remove the standalone lobby Theme picker** (the `#theme-select` /
  `#theme-select-team` dropdowns) and all client/server wiring that exists
  *only* to serve it. Quick Kits become the single "vibe" control.
- **Keep the `themesSystem` mechanic** untouched — a kit still sets `room.theme`,
  `themesSystem.isValidTheme` still validates it inside `selectRuleKit`, and
  `matchesTheme` still filters movies during play. Only the *picker UI* is removed.
- **Expand the kit catalog from 6 → 9** so the major genres remain reachable
  (the dropdown previously offered comedy/action/sci-fi/decades). New: Comedy
  Night, Blockbuster, Sci-Fi Night.
- **Enhance the kit UI**: fix contrast; make each chip **self-documenting** (icon
  + bold label + a muted one-line description of exactly what it sets) so the
  "what does this do" need is met on every device — `title`-attribute tooltips
  alone are invisible on touch, and MovieMatch is a mobile PWA.

**Approach decision:** self-documenting **cards** (visible description sub-line)
over hover-only tooltips, because the latter don't appear on touch devices.
A `title` attribute is *also* set for desktop hover (belt-and-suspenders).

---

## 2. Goal & Non-goals

**Goal:** Make Quick Kits the single, self-explanatory way to set a game's vibe
(theme + mode + toggles) in the lobby, removing the redundant theme dropdown and
fixing the contrast/affordance problems — without losing genre coverage.

**Non-goals:** changing the `selectRuleKit` apply mechanic; changing the
`themesSystem` filtering/validation; touching the Mode selector or the
Hardcore/TV toggles (those stay as granular House Rules); any 6b
Achievements/Titles change; team-mode kit chips (still out of scope — the team
lobby keeps its Hardcore/TV controls, just loses its theme dropdown like the
classic lobby).

---

## 3. Current Architecture (grounding)

Verified against `main` @ `bcd3b39` on 2026-05-22. The plan re-pins exact lines.

**Theme-picker surface (to remove — UI + its sole-purpose wiring):**
- `public/index.html` — classic theme row (`<label>` wrapping
  `<select id="theme-select">`, ~:332-341) + team theme row
  (`<select id="theme-select-team">`, ~:447).
- `public/js/app.js` — `initLobbySettingsHandlers` registers a `change` handler
  on `['theme-select','theme-select-team']` emitting `setTheme` (~:64-67). The
  Hardcore + TV handlers in the same function STAY.
- `public/js/socketClient.js` — `socket.on('themesList', …)` caches themes on
  `window.__mmThemes` to populate the dropdown (~:222).
- `public/js/ui/ui-render.js` — `renderLobby` populates `#theme-select` from
  `window.__mmThemes` (~:292, **already null-guarded** `if (themeSel) {…}`) and
  `renderTeamScreen` populates `#theme-select-team` (~:483, same guard). Because
  both are null-guarded, removing the DOM elements cannot crash these — but the
  now-dead blocks are removed for cleanliness.
- `public/css/06-states-anim.css` — `#theme-select option` styling (~:535-540),
  dead once the element is gone → removed with a tombstone comment (the
  documented dead-code-excision pattern, e.g. the 7.10 `.demo-item` removal).
- `server/socketHandlers.js` — `socket.emit('themesList', themesSystem.listThemes())`
  on connect (~:148) and the `on('setTheme', …)` handler (~:223-227) become
  orphaned (no dropdown emits `setTheme`; nothing consumes `themesList`) → removed.
- `server/systems/lobbySystem.js` — `setTheme` (~:287) + its `module.exports`
  entry: removed **iff** no remaining caller/test depends on it (the plan
  verifies; `selectRuleKit` sets `r.theme` directly and does NOT call `setTheme`).

**Kept (the mechanic):** `server/systems/themesSystem.js` entirely —
`isValidTheme` is called by `selectRuleKit` (lobbySystem) to validate a kit's
theme; `matchesTheme` filters candidates during play. `listThemes`/`clientShape`
become unused but are harmless and left in place (no consumer to break).

**Kit surface (to expand + enhance):**
- `server/ruleKits.js` — `RULE_KITS` (6) + `getKit` + `listKits()` (returns
  `{id,label,icon}`). `selectRuleKit` (lobbySystem) reads it.
- `public/js/ui/rule-kits.js` — `renderRuleKitChips(kits, container, onPick)`
  builds `.rule-kit-chip` buttons (icon + name).
- `public/index.html` — `#rule-kit-chips` container in the `.rule-kit-section`.
- `public/css/02-hero-lobby.css` — `.rule-kit-chip` rules (the contrast bug).

**Existing tests that reference the theme picker:** only
`client-tests/socket-handlers.test.js` — one test `'#theme-select-team change
emits setTheme …'` (~:330-342). It is removed (the feature is gone). The two
sibling tests (hardcore/tv toggle handlers) stay. No other test references
`theme-select`/`themesList`/`setTheme` on the client.

---

## 4. Catalog — 9 kits, each with a description

`RULE_KITS` gains a `desc` field (the human description shown on the card +
in the `title` attribute) and 3 new genre kits. Final catalog:

| id | icon | label | theme | mode | hardcore | tvShows | desc |
|----|------|-------|-------|------|----------|---------|------|
| `date_night` | 💘 | Date Night | romance | classic | false | false | Romance · Classic |
| `after_dark` | 🎃 | After Dark | horror | classic | false | false | Horror · Classic |
| `comedy_night` | 😂 | Comedy Night | comedy | classic | false | false | Comedy · Classic |
| `blockbuster` | 💥 | Blockbuster | action | classic | false | false | Action · Classic |
| `scifi_night` | 🚀 | Sci-Fi Night | scifi | classic | false | false | Sci-Fi · Classic |
| `hardcore_sprint` | 🔥 | Hardcore Sprint | any | speed | true | false | Any · Speed · Hardcore |
| `decade_drift` | 📼 | Decade Drift | decade_1990s | classic | false | false | '90s · Classic |
| `saturday_cartoons` | 🎨 | Saturday Cartoons | animation | classic | false | true | Animation · incl. TV |
| `classic_open` | 🎬 | Classic Open | any | classic | false | false | Anything goes · Classic |

The 3 new kits use `comedy`/`action`/`scifi` (all valid `themesSystem` ids) with
`classic` mode + no toggles — the straightforward "genre night" shape. Icons
echo the existing `themesSystem` genre labels (😂 Comedy Night, 💥 Blockbuster
Night, 🚀 Future Features), consistent with how `date_night`/`after_dark` already
echo the romance/horror theme labels. Catalog order is the display order.

---

## 5. Components & Data Flow

1. **`ruleKits.js` (server, single source):** add `desc` to every kit + the 3
   new kits. `getKit` unchanged. `listKits()` now returns
   `{id, label, icon, desc}`.
2. **Wire:** unchanged — `ruleKitsList` (on connect) carries the enriched display
   shape; `selectRuleKit({lobbyId, kitId})` unchanged (already sets
   theme/mode/toggles from `getKit`).
3. **`rule-kits.js` (client):** `renderRuleKitChips` builds each chip as a card:
   `.rule-kit-chip-icon` + a text column with `.rule-kit-chip-name` (label) and a
   new `.rule-kit-chip-desc` (the `desc`); sets `chip.title = desc` and
   `aria-label = "<label>: <desc>"`. Null-container + click→`onPick(id)` behavior
   unchanged.
4. **Theme-picker removal:** delete the DOM rows, the `app.js` theme handler, the
   `socketClient` `themesList` handler, the `ui-render` population blocks, the dead
   CSS, and the server `themesList` emit + `setTheme` handler (+ `lobbySystem.setTheme`
   if unreferenced).
5. **CSS:** give `.rule-kit-chip` an explicit light text color (matching
   `.mode-chip`), style the two-line card layout + `.rule-kit-chip-desc` (small,
   muted). Additive where possible; the `06-states-anim.css` `#theme-select`
   removal is a documented dead-code excision (tombstoned).

Each unit stays small and independently testable; the catalog remains the single
server-authoritative source (no client/server duplication).

## 6. Testing

- `server/ruleKits.test.js` *(update)*: assert **9** kits; every kit has a
  non-empty string `desc`; `listKits()` rows are exactly `{desc,icon,id,label}`;
  the 3 new kits map to valid themes (`isValidTheme`) + `classic` mode; existing
  integrity assertions still hold.
- `server/my-stats-enrichment.test.js` *(update)*: the `ruleKitsList` connect
  assertion expects **9** kits and the `{desc,icon,id,label}` shape.
- `server/rule-kit-select.test.js` *(update only if needed)*: a new-kit apply case
  (e.g. `comedy_night` → theme `comedy`, mode `classic`) may be added; existing
  cases hold (the apply mechanic is unchanged).
- `client-tests/rule-kit-chips.test.js` *(update)*: assert the `.rule-kit-chip-desc`
  renders the kit's `desc` and the chip's `title` attribute is set; existing
  render/click assertions hold.
- `client-tests/socket-handlers.test.js` *(update)*: remove the `#theme-select-team
  change emits setTheme` test (feature removed); the hardcore/tv sibling tests stay.
- Optional new guard: a test asserting `index.html` contains no `#theme-select`
  and `renderLobby`/`renderTeamScreen` don't reference it.

Full suite stays green; coverage ratchet floors hold. **Outstanding until merge +
Render check** (per the validated workflow): real-boot + in-browser eyeball of the
lobby with the theme dropdown gone, the 9 self-documenting kit cards rendering
with correct contrast + descriptions, and a kit chip applying live (incl. a new
genre kit). This touches the lobby DOM + socket wiring, so that gate applies.

## 7. Files (approximate — the plan pins exact lines)

**Modify**
- `server/ruleKits.js` — `desc` field + 3 new kits; `listKits` shape.
- `server/socketHandlers.js` — remove `themesList` emit + `setTheme` handler.
- `server/systems/lobbySystem.js` — remove `setTheme` (+ export) if unreferenced.
- `public/index.html` — remove the two theme-select rows.
- `public/js/app.js` — drop `theme-select` from `initLobbySettingsHandlers`.
- `public/js/socketClient.js` — remove the `themesList` handler.
- `public/js/ui/ui-render.js` — remove the dead `#theme-select(-team)` blocks.
- `public/js/ui/rule-kits.js` — render the description sub-line + `title`/aria.
- `public/css/02-hero-lobby.css` — chip text color + two-line card + `.rule-kit-chip-desc`.
- `public/css/06-states-anim.css` — remove the dead `#theme-select option` rules (tombstone).
- Tests listed in §6.

**Untouched (mechanic + sacrosanct):** `server/systems/themesSystem.js`,
`server/systems/statsSystem.js`, `server/gameLogic.js`, all 6b achievements/titles
code, and every test not tied to the theme picker or the kit-display shape.

## 8. Task Decomposition (preview — the plan finalizes)

~3 linear tasks:
- **T0** — `ruleKits.js`: `desc` + 3 new kits + `listKits` shape; update
  `ruleKits.test.js` + `my-stats-enrichment.test.js` (+ `rule-kit-select.test.js`
  if a new-kit case is added).
- **T1** — Remove the theme picker (index.html + app.js + socketClient.js +
  ui-render.js + server socketHandlers/lobbySystem) + update
  `socket-handlers.test.js`; add the optional no-`#theme-select` guard test.
- **T2** — Kit card UI: `rule-kits.js` description sub-line + `title`/aria;
  `client-tests/rule-kit-chips.test.js`; CSS (contrast + card layout +
  `.rule-kit-chip-desc`) + the `06-states-anim.css` dead-CSS tombstone.

Each task is independently verifiable, gets its own commit, and is `completed`
only after both per-task reviews (spec-compliance, then code-quality) pass.

## 9. Process Notes

Ships via the validated pipeline: **spec → writing-plans →
subagent-driven-development → finishing-a-development-branch.**

- Spec committed to `main` locally; plan + co-located `.md.tasks.json` committed
  to `main`; a feature branch **`phase6c1-kits-replace-themes` off the
  then-current `origin/main`** for all implementation commits.
- Native Task tools for tracking + the co-located `.md.tasks.json`. A task is
  `completed` only after both per-task reviews pass.
- WHY-comments on every changed line. Test edits here are **legitimate** (we are
  deliberately removing a control + changing the `listKits` shape) — distinct
  from the additive 6b/6c discipline; only edit tests tied to the removed picker
  or the kit-display shape, nothing else.
- Final opus whole-branch holistic review before finishing.
- `coverage/` stays untracked. Finishing: push branch + `gh pr create` (base
  `main`); PR-merge / push-to-main / Render deploy is classifier-gated and
  **handed to the user**. After merge, verify Render `live` (read-only) + the
  in-browser eyeball in §6.
