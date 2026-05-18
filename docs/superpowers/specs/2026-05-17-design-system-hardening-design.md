# Phase 7.3 — Design-System Hardening: Design Spec

**Date:** 2026-05-17
**Status:** Approved (brainstorming, Approach A) — proceeding to writing-plans.
**Phase:** **7.3** — third sub-phase of Phase 7 UI/UX Elevation; the second *enabling-infra* sub-phase (after 7.2 Feedback-layer Split). Sourced from the committed decision record `docs/superpowers/specs/2026-05-17-phase7-uiux-elevation-design.md` §2 (7.3) + §3 guardrails. Subsumes Codex Pass-1 findings **DS-01** (inline-style debt) and **MI-02** (ad-hoc overlays bypass the modal system).

This is an **implementation design spec** (decision record + decomposition), to be consumed by writing-plans next. One sub-phase = one spec → plan → subagent-build → PR.

---

## 0. Goal

Harden the design system without changing what the user sees or how the UI behaves:

1. **MI-02** — consolidate the three ad-hoc, imperatively-built name overlays (`showNamePrompt`, `showJoinPrompt`, `showDailyNamePrompt`) into one shared modal factory built on the existing `.modal-overlay`/`.modal-card` class system, deleting their ~28 `.style.cssText` constant assignments.
2. **DS-01 (bounded slice)** — the prompt-cssText cluster removed by MI-02 *is* the largest single static-inline-style cluster; plus a verified CSS-hygiene list. The DS-01 long tail is explicitly deferred to a recorded "DS-01 pass 2" so 7.3 stays bounded and provably zero-behaviour.

**Hard constraint (from decision doc §2 / §3):** **zero-behaviour-change refactor.** The migration must be byte-for-byte visually and behaviourally identical. The six-partial CSS cascade order is load-bearing and is not reordered. The one *intentional, bounded* visual delta is finishing 7.1's own deferred styling on currently-unstyled elements (§5) — additive polish on elements that render unstyled today, never a change to already-correct UI.

---

## 1. Findings (verified against `origin/main` 57e4599)

### 1.1 The three overlays (MI-02 surface)

| | `showNamePrompt(roomCode)` | `showJoinPrompt()` | `showDailyNamePrompt({prefill,onConfirm})` |
|---|---|---|---|
| **Location** | `public/js/app.js:290-341` (closure fn) | `public/js/app.js:343-417` (closure fn) | `public/js/ui/ui-panels.js:447-517` (exported seam) |
| **Title** | `Join Game` | `Join a Room` | `🗓️ Daily Challenge` |
| **Subtitle** | `Room <code>` | *(none)* | `Pick a name to track your score on the daily leaderboard.` |
| **Fields** | 1 text input (name) | name input (prefilled from `mm_playerName`) + code input (uppercased) | 1 text input (prefilled from `prefill`) |
| **Primary btn** | `Join Game` | `Join Game` | `Start Daily Challenge` (class `daily-name-go`) |
| **Secondary btn** | *(none)* | `Back` | `Maybe later` (class `daily-name-cancel`) |
| **Overlay class** | *(none)* | *(none)* | `daily-name-overlay` |
| **Backdrop click closes** | **No** | **Yes** | **Yes** |
| **Focus timing** | `setTimeout(...,100)` | `setTimeout(...,100)` (focus code if name prefilled, else name) | **immediate** (no setTimeout — documented: overlay has no entrance transition) |
| **Enter key** | Enter → submit | name Enter → focus code; code Enter → submit | Enter → submit |
| **Submit side-effects** | `localStorage.setItem('mm_playerName')`, set `playerNameInput.value`, `overlay.remove()`, `showScreen('lobby')`, `socket.emit('joinLobby',{name,lobbyId:roomCode,stableId})`, `history.replaceState({},'',pathname)` | `localStorage.setItem`, set `playerNameInput.value`, `overlay.remove()`, `prepareAudio()`, `showScreen('lobby')`, `socket.emit('joinLobby',{name,lobbyId:code,stableId})` | `close()`, then `onConfirm(name)` (socket-free seam — caller owns the emit) |
| **Empty-name cue** | `input.style.borderColor='#f87171'` + `focus()`, keep open | same (on `nameInput`) | same |

All three build `overlay`/`card`/`title`/`subtitle?`/`input(s)`/`button(s)` via `document.createElement` + `.style.cssText` string constants, append to `document.body`, and remove on close. The cssText constants are identical across the three (overlay, card, input, primary btn, secondary btn, label) modulo per-prompt spacing (title bottom-margin depends on subtitle presence; field bottom-margins; primary-btn bottom-margin depends on secondary presence).

### 1.2 The core tension

The existing modal system (`public/css/04-modals.css:150-227`) differs *visually and behaviourally* from the prompts:

| | Prompts (today) | `.modal-overlay`/`.modal-card` |
|---|---|---|
| Card max-width | `340px` | `min(640px, 90vw)` |
| Card padding | `2rem` | `2.5rem` |
| Overlay z-index | `1000` | `200` |
| Entrance animation | **none** | `fadeIn 0.2s` + `slideUp 0.3s` |
| Backdrop | `rgba(0,0,0,0.75)` flat | `rgba(0,0,0,0.75)` + `backdrop-filter: blur(--blur-md)` |
| Show/hide contract | append/remove from body | `.hidden` class toggle on pre-declared markup |

`showDailyNamePrompt` *depends* on the absence of an entrance transition: it focuses immediately precisely because "there's nothing to wait on" (documented at `ui-panels.js:513-516`). Therefore literally adopting the existing classes verbatim = a visual + behaviour change = a direct violation of 7.3's hard zero-behaviour-change constraint. **Resolution = Approach A:** the factory emits the modal system's classes **plus a `--prompt` compact modifier** whose CSS exactly reproduces today's prompt pixels and the no-animation behaviour. Structure is unified into the modal system now; *visual* unification (making prompts look like the big modals) is deliberately deferred to a later visual phase (7.4+) on the hardened base.

### 1.3 CSS-hygiene list — corrected against live code

| Item | Verified state | Verdict |
|---|---|---|
| Orphaned `.self-elim-could` (`06-states-anim.css:1082-1093`) | Rule is well-formed but **has no consumer** — client emits `self-elim-outs*`/`self-elim-bridge` (`ui-notifications.js:134-149`), never `self-elim-could`; 7.1 markup superseded it | **DELETE** — dead code, zero visual change |
| Unstyled 7.1 classes `.self-elim-outs`, `.self-elim-outs-label`, `.self-elim-outs-row`, `.self-elim-bridge` | Emitted by `ui-notifications.js:134-149`, **no CSS rule exists** (only `.self-elim-grid` + `.self-elim-could` match in the file) | **STYLE** — the one intentional bounded visual delta (finishing 7.1's deferred styling on currently-unstyled elements) |
| `.self-elim-grid` single-child asymmetry | Rule is `grid-template-columns: 1fr 1fr`; the timeout card adds only the "Needed a connection to" column (`ui-notifications.js:118`; "You played" is conditional at `:122`) → one child renders left-aligned in a 2-col track | **FIX** — single child centers; two children unchanged |
| "Malformed `\*` comment near :1082-1085" (from memory) | **Does not exist** — zero literal backslash anywhere in `06-states-anim.css`; the comment block above `.self-elim-could` is well-formed | **DROP from scope** + correct the memory record |
| "Formalize `.copy-toast--info`" (from memory, marked optional) | 7.2 author's no-rule choice is deliberate and documented (`06-states-anim.css:1114-1123`): neutral = today's look, no empty ruleset | **DROP** — YAGNI; honour the documented 7.2 intent |

---

## 2. Architecture (Approach A)

**New module:** `public/js/ui/modal.js` — a pure, app-agnostic prompt-modal factory. No imports from `app.js`/`socketClient.js`/`state.js`; depends only on the DOM. Mirrors the validated 7.2 pattern (`public/js/ui/feedback.js`: a focused `ui/` module, barrel-exported via `ui.js`, with thin glue at the call sites).

**Barrel:** add `export * from './ui/modal.js';` to `public/js/ui.js` (same mechanism 7.2 used for `feedback.js`).

**Call-site refactors (thin wrappers, behaviour preserved exactly):**
- `public/js/app.js` — `showNamePrompt`/`showJoinPrompt` become thin functions that build a config object (closing over their existing closure callbacks: `socket`, `showScreen`, `getStableId`, `prepareAudio`, `playerNameInput`, `localStorage`, `history`) and call the factory. The closure callbacks stay in `app.js` — the factory never sees socket/app internals.
- `public/js/ui/ui-panels.js` — `showDailyNamePrompt` keeps its exported signature `({prefill='',onConfirm}={})` and its socket-free contract byte-for-byte; internally it builds a config and calls the factory. The HL-01 comment block at `ui-panels.js:436-446` is updated to reflect that MI-02 consolidation is now done (not deferred).

**New CSS:** `.modal-overlay--prompt` / `.modal-card--prompt` (+ element classes for the prompt's title/subtitle/input/label/primary/secondary, e.g. `.modal-prompt-*`) added **to `public/css/04-modals.css`**, immediately after the modal system block — it *is* modal-system CSS, and 04-modals.css's position in the load-bearing cascade is unchanged. These rules reproduce the exact current pixel values from §1.1/§1.2 (max-width 340px, padding 2rem, overlay z-index 1000, no `fadeIn`/`slideUp`, no `backdrop-filter`, the input/button/label constants verbatim).

**CSS hygiene:** the three §1.3 "in-scope" edits land in `public/css/06-states-anim.css` (where the self-elim rules live).

**No changes to:** `server.js`, any socket event, any dependency, the six `<link>` partial order in `index.html`, the existing pre-declared modals, or any dynamic `.style.*` write.

---

## 3. The factory contract

```
createPromptModal(config) → { overlay, close }

config = {
  overlayClass?:  string,            // e.g. 'daily-name-overlay' (preserves test hook)
  title:          string,            // textContent (never innerHTML)
  subtitle?:      string,            // textContent; omitted → title uses the no-subtitle bottom spacing
  fields: [ {
      type:        'text',
      placeholder: string,
      value?:      string,           // prefill
      maxLength:   number,
      uppercase?:  boolean,          // text-transform:uppercase (codeInput)
      gap:         '1rem' | '1.5rem' // exact current per-field bottom margin
  } ],
  primary:   { label: string, className?: string, onSubmit: (values: string[]) => void },
  secondary?:{ label: string, className?: string, onClick: () => void },
  closeOnBackdrop: boolean,          // overlay click (target===overlay) → close()
  focusDelayMs:    0 | 100,          // 0 = immediate focus (daily); 100 = setTimeout (join/name)
  focusIndex?:     number            // which field to focus (showJoinPrompt: code if name prefilled)
}
```

**Factory responsibilities (must reproduce current behaviour exactly):**
- Build `overlay > card > [title, subtitle?, ...fields, primary, secondary?]` with the `.modal-overlay--prompt`/`.modal-card--prompt` classes (+ per-element prompt classes). `overlayClass` is added to the overlay (additive — alongside the modifier class). All text via `textContent` (no `innerHTML` — XSS-safe; matches today).
- Title bottom-spacing = the no-subtitle value when `subtitle` is omitted, else the with-subtitle value (reproducing `showJoinPrompt` vs `showNamePrompt`/`showDaily`).
- Each field's bottom margin = its configured `gap`. Primary-button bottom margin = present iff a `secondary` follows (reproducing today).
- Empty-required cue: if `primary.onSubmit`'s validation rejects (the wrappers pass a validator equivalent to "first field non-empty"), set that field's `borderColor:'#f87171'`, `focus()`, keep the modal open. (This stays a dynamic `.style` write — it is behaviour, not static debt.)
- Enter handling: single-field → Enter submits; multi-field → Enter on a non-last field focuses the next, Enter on the last submits (reproduces `showJoinPrompt`).
- Backdrop click closes iff `closeOnBackdrop`. Secondary click → `secondary.onClick`. `close()` = `overlay.remove()`.
- Focus: `focusDelayMs===0` → focus synchronously; `===100` → `setTimeout(...,100)`; field chosen by `focusIndex` (default 0).
- Returns `{ overlay, close }` so wrappers can drive lifecycle.

The wrappers own all app side-effects (localStorage, `playerNameInput`, `showScreen`, `socket.emit`, `history.replaceState`, `prepareAudio`, `onConfirm`) inside the `onSubmit` callback — identical statements, identical order, to today.

---

## 4. Per-prompt config mapping (exact preservation)

- **`showNamePrompt(roomCode)`** → `{ title:'Join Game', subtitle:'Room '+roomCode, fields:[{name,placeholder:'Enter your name',maxLength:24,gap:'1rem'}], primary:{label:'Join Game',onSubmit([name]) → trim/validate → localStorage+playerNameInput+overlay.remove()+showScreen('lobby')+socket.emit('joinLobby',{name,lobbyId:roomCode,stableId:getStableId()})+history.replaceState({},'',location.pathname)}, closeOnBackdrop:false, focusDelayMs:100 }`. No secondary.
- **`showJoinPrompt()`** → `{ title:'Join a Room', fields:[{placeholder:'Enter your name',value:localStorage.getItem('mm_playerName')||'',maxLength:24,gap:'1rem'},{placeholder:'Leave blank to create new',maxLength:6,uppercase:true,gap:'1.5rem'}], primary:{label:'Join Game',onSubmit([name,code]) → validate name → localStorage+playerNameInput+overlay.remove()+prepareAudio()+showScreen('lobby')+socket.emit('joinLobby',{name,lobbyId:code.toUpperCase(),stableId})}, secondary:{label:'Back',onClick:close}, closeOnBackdrop:true, focusDelayMs:100, focusIndex: nameValue ? 1 : 0 }`.
- **`showDailyNamePrompt({prefill,onConfirm})`** → `{ overlayClass:'daily-name-overlay', title:'🗓️ Daily Challenge', subtitle:'Pick a name to track your score on the daily leaderboard.', fields:[{placeholder:'Enter your name',value:prefill||'',maxLength:24,gap:'1rem'}], primary:{label:'Start Daily Challenge',className:'daily-name-go',onSubmit([name]) → validate → close()+onConfirm(name)}, secondary:{label:'Maybe later',className:'daily-name-cancel',onClick:close}, closeOnBackdrop:true, focusDelayMs:0 }`.

The `daily-name-overlay`/`daily-name-go`/`daily-name-cancel` class names are a **test contract** (`client-tests/daily-name-prompt.test.js`) and must be emitted exactly.

---

## 5. CSS hygiene (in scope — verified)

In `public/css/06-states-anim.css`:

1. **Delete** the orphaned `.self-elim-could` rule + its now-irrelevant comment (`:1082-1093`). No consumer exists (verified); zero visual change.
2. **Add** styling for the currently-unstyled 7.1 classes `.self-elim-outs`, `.self-elim-outs-label`, `.self-elim-outs-row`, `.self-elim-bridge`. This is the one *intentional* visual delta: these elements render unstyled today; styling them finishes 7.1's own deferred work. Visual treatment: consistent with the existing `.self-elim-*` palette (e.g. the `rgba(52,211,153,…)`/`#34d399` "you had outs" accent already used by the deleted `.self-elim-could`), legible, honouring `prefers-reduced-motion` (no new motion). Exact rules specified in the plan.
3. **Fix** `.self-elim-grid` so a single child centers instead of left-aligning in the 2-col track (timeout card has no "You played" column — `ui-notifications.js:122` adds it only `if (details.yourGuess)`). Two-column case unchanged; mobile `1fr` collapse (`:110-112`) unchanged. Strategy: a pure-CSS single-column treatment (e.g. `.self-elim-grid:has(> :only-child)` or a `.self-elim-col:only-child` centering rule) so no JS change is required — exact rule in the plan.

Out (verified non-existent or deliberately-neutral): the "malformed `\*` comment" (no backslash in the file) and "formalize `.copy-toast--info`" (7.2's documented intent). Memory record to be corrected.

---

## 6. Zero-behaviour-change guard & testing (TDD)

**Primary guard — the existing suite must stay green, untouched:** `client-tests/daily-name-prompt.test.js`, `client-tests/self-elim-aftercare.test.js`, `client-tests/learning-breakdown.test.js` (and the full 47-suite/342-test suite from 7.2). These assert the `daily-name-*` hooks and the self-elim DOM contracts; passing them unchanged proves the refactor preserved the contracts. If a refactor requires editing an existing test, that is a behaviour change and is out of scope (escalate, do not weaken the test).

**New tests (TDD — failing test first):**
- `client-tests/modal-factory.test.js` — factory builds the exact DOM tree per a representative config; backdrop-close honoured/ignored per flag; Enter single-vs-multi-field; focus immediate-vs-100ms (fake timers); empty-required cue sets `borderColor` + keeps open; `overlayClass` additive; text via `textContent` (XSS-safe — a `<script>`-laden title is inert).
- `client-tests/name-prompts.test.js` — each refactored wrapper emits the right structure and fires the exact side-effects in order (mock `socket`, `localStorage`, `history`, `showScreen`, `prepareAudio`; assert `joinLobby` payloads incl. `stableId`; `showDailyNamePrompt` stays socket-free and calls `onConfirm(name)`).
- CSS hygiene: a test asserting no DOM emits `self-elim-could` (orphan-safe to delete) and that the styled 7.1 classes are the ones emitted.

Coverage is additive; the 7.2 ratchet (47/342) must hold or rise. The suite mocks Redis and never boots a browser → **real-boot/in-browser eyeball is user-side** (the refactor touches the join/Daily render path); state this in the PR.

---

## 7. Scope boundaries

**In scope:** the MI-02 modal factory + 3 wrapper refactors; the `--prompt` compact-modifier CSS; the three verified §5 CSS-hygiene edits; the new tests.

**Permanently excluded (not debt):** dynamic `.style.*` writes — `display` show/hide toggles, progress widths, computed transforms, the empty-field `borderColor` cue. These are behaviour/state, not static presentational debt; migrating them would change behaviour or be impossible.

**Deferred to a recorded "DS-01 pass 2" follow-up** (keeps 7.3 bounded/M-effort and provably zero-behaviour): bulk static HTML `style=` attributes in `index.html` (demo `<img>`, margin one-offs, the `theme-select` inline styling, initial `display:none` states), the leaderboard-render `.style.cssText` block (`app.js:662-701`), the `socketClient.js`/`app.js` empty-hint `innerHTML` inline styles, and the `index.html:76-79` inline `<style>` block. Recorded here so a later pass (or a spawned task) can pick it up; not started in 7.3.

**Out-of-scope findings during build** → session `spawn_task` chip, never widen 7.3 (per decision-doc §3.8).

---

## 8. Guardrails & pipeline (binding)

- **No accounts / no server change.** Client-only; no socket event, no dependency, Redis untouched.
- **Cascade order load-bearing.** The six `<link>` partials in `index.html` are not reordered; new prompt CSS lives in `04-modals.css` (modal-system home), hygiene in `06-states-anim.css`.
- **Real-boot + in-browser gate.** Touches the invite-join / Daily render path; suite never boots a browser → real-boot verification is outstanding, confirm Render `live` (read-only Render MCP) post-merge, flag the in-browser eyeball as user-side. "Merged" ≠ "deployed."
- **Comments.** Every code change ships a WHY comment (the *why*, not the *what*).
- **Branch safety.** Isolated worktree `C:/mm-phase7-3`, branch `phase7-3-design-system-hardening`, off `origin/main 57e4599`; a parallel Codex agent shares the repo → verify `git branch --show-current` before **every** commit; never history-rewrite a shared branch.
- **Pipeline.** writing-plans → subagent-driven build (native Task tools unavailable → TodoWrite + hand-authored co-located `.md.tasks.json`, status synced+committed per task) → per-task two-stage review (spec-compliance then code-quality, real fix loops) → final most-capable-model whole-branch holistic review → PR. **PR-merge / push-to-main / Render deploy is classifier-gated and handed to the user.**

---

## 9. Acceptance criteria

- [ ] `public/js/ui/modal.js` exists: pure `createPromptModal(config) → {overlay,close}`, no app/socket imports, `textContent`-only.
- [ ] Barrel `public/js/ui.js` re-exports it.
- [ ] `showNamePrompt`, `showJoinPrompt` (app.js), `showDailyNamePrompt` (ui-panels.js) are thin wrappers over the factory; all ~28 `.style.cssText` prompt assignments removed.
- [ ] `showDailyNamePrompt` keeps its exported signature, socket-free contract, and `daily-name-overlay`/`daily-name-go`/`daily-name-cancel` class names byte-for-byte.
- [ ] `.modal-overlay--prompt`/`.modal-card--prompt` (+ prompt element classes) in `04-modals.css` reproduce the exact current pixels (max-width 340px, padding 2rem, z-index 1000, no fadeIn/slideUp, no backdrop-filter, input/button/label constants verbatim, per-prompt spacing preserved).
- [ ] Each prompt renders an identical box model and behaves identically (titles, fields, buttons, backdrop-close on/off, focus 0ms/100ms, Enter handling, empty-name cue, all submit side-effects incl. `joinLobby` payloads + `stableId` + `history.replaceState` + `prepareAudio`).
- [ ] Orphaned `.self-elim-could` deleted; no DOM emits that class.
- [ ] `.self-elim-outs`/`-outs-label`/`-outs-row`/`.self-elim-bridge` styled, consistent with the existing self-elim palette, `prefers-reduced-motion` honoured.
- [ ] `.self-elim-grid` single child centers; two-column + mobile collapse unchanged.
- [ ] Existing suite (incl. `daily-name-prompt`, `self-elim-aftercare`, `learning-breakdown`) green **without edits**; new factory + wrapper tests added; total ≥ 47 suites / 342 tests, ratchet holds.
- [ ] No `server.js`/socket/dependency change; six-partial cascade order unchanged; no dynamic `.style.*` migrated.
- [ ] Every code change carries a WHY comment.

---

## 10. Next step

Invoke **writing-plans** to decompose this spec into TDD tasks (co-located plan + `.md.tasks.json` in `docs/superpowers/plans/`), then subagent-driven build in `C:/mm-phase7-3`, then PR handed to the user for merge/deploy.
