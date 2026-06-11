# Game Screen Redesign — "The Projection Booth"

**Date:** 2026-06-11
**Status:** Design approved (visual direction + chat placement); awaiting spec review → writing-plans
**Scope:** The in-game screen (`#game-screen`) only. The hero, lobby/theater, and all modals are out of scope except where they share tokens.

---

## 1. Thesis

The in-game screen is a **working projection booth at the instant of a reel-change** — the few seconds where a projectionist holds two filmstrips and has to find the splice. The game *is* the splice: you connect the outgoing reel to the incoming reel through a shared cast member.

This is one committed world, not a menu of skins. Every decision (type, color, light, motion, copy, failure states) descends from that single premise instead of being borrowed from reference brands. It was chosen after two prior rounds were rejected as "still AI-looking"; a multi-agent research pass (X discourse + AI-tell taxonomy + high-craft playbook + cinema-product language + motion craft) plus a 3-lens adversarial critique produced the design law this spec encodes.

**Why it defeats the "AI look":** authored work commits to a specific point of view with its own internal physics; averaging machines cannot. The booth premise dictates the design rather than the design citing influences.

### Non-negotiables carried from the research
- **Keep + evolve the chain board** (the one thing the user already likes — the Phase 7.7 Constellation filmstrip). Never silently replace it; evolve its shipped vocabulary (burned/ghost states included).
- **One accent, rationed.** Indigo `#818cf8` is the brand and stays, but only as *projector light* — it touches exactly two things (the poster in the gate + the active-turn marker). If the accent lands on a third element, that's a bug.
- **No glassmorphism, no blurred-poster wallpaper, no Playfair, no mono mm:ss clock, no OS-emoji reaction quartet, no "now playing" web voice.** These were named tells.

---

## 2. Brand reconciliation (decided)

The research argued indigo is the `bg-indigo-500` AI fingerprint and pushed warm tungsten. **Overridden** for brand coherence: MovieMatch is an indigo-branded product (hero, lobby, and the chain board's now-playing poster all use `#818cf8`). A warm game screen would orphan it.

Reconciliation: a xenon projector lamp throws **cool blue-white light**, so the booth concept survives with indigo as the beam. The gate frame reuses the *exact* indigo border + glow the live `.reel-node.now-playing .reel-poster` already ships — making the redesign continuous with the board, not a new color story. The only warm note is the **amber cue dot** at <5s, which is already `--status-warning` / `--accent-warm`.

---

## 3. Surfaces in scope

| Zone | Live element(s) | Booth role |
|---|---|---|
| Players rail | `.sidebar[data-panel=players]`, `#game-players`, `.sidebar-players li` | **The Bench** — operators as small film frames |
| Chain board | `#chain-display`, `.filmstrip`, `.reel`, `.reel-node`, `.reel-bridge`, `.now-cast*` | **The Beam** — film running through the gate (evolve) |
| Input area | `#input-area`, `#movie-input`, `#submit-btn`, `#turn-indicator`, `#hint-text` | **The Splice Console** |
| Timer | `#timer-bar` (+ `.timer-critical`/`.timer-panic`) | **The Cue Dot** at the cue edge |
| Reactions | `#reaction-bar .reaction-btn` | **Ticket stubs** |
| Suggestions | `#autocomplete-container`, `#mobile-ac-dropdown` | **Float over the console** |
| Chat | `#chat-messages`, `#chat-input`, `#chat-send-btn`, `#chat-badge` | **Collapsible lobby drawer** |
| Header | `.app-header`, `.logo`, `.header-nav` | Light booth treatment only |

---

## 4. Layout — the booth sightline

Two zones, asymmetric **by mechanism** (where the light falls), not by decoration:

- **BENCH** (left, narrow ~206px): operator roster (top) + splice console (bottom).
- **BEAM** (center, dominant): a top letterbox matte (box-office slug), the running filmstrip with the now-playing poster enlarged into a sharp **gate frame**, then the billing block beneath.
- **CUE EDGE** (top-right corner): the single countdown dot.
- **LOBBY DRAWER**: chat, off-canvas, toggled from the bench with an unread badge.

Replaces today's three-column `.layout-grid` (`240–300px | 1100px | 240–300px`). The right rail is retired; suggestions float, chat drawers.

**Empty/pre-game:** dark booth, an empty dashed aperture, one line — *"Thread the first reel."* No dashboard furniture.

---

## 5. Design system

### 5.1 Tokens (reuse-first)
Reuse existing `01-base.css` tokens. **Add** only:
- `--font-display: 'Saira Condensed'` (condensed grotesque — the billing-block voice).
- Type scale (1.2 ratio off 16px): `--t-1:12.8px / --t0:16px / --t1:19.2px / --t2:23px / --t3:33px / --t-display:~46px`. **Every** font-size must be a scale step (kills the ~19 ad-hoc sizes).
- Semantic aliases (point at existing values, don't invent): `--beam: var(--accent-primary)`, `--beam-glow: rgba(129,140,248,.55)`, `--cue-hot: var(--status-warning)`.
- Surfaces: reuse `--bg-base #09090b` / `--bg-surface #121214` / `--bg-elevated #18181b`. **Booth grain + vignette + center-beam radial** are additive overlays.

### 5.2 Typography
- **Display / titles / billing block:** Saira Condensed, ALL-CAPS, the iconic film one-sheet voice. The now-playing title is `--t-display`; the connecting cast is set as a real **billing block** (smaller caps, tighter leading).
- **Body / chat / metadata / clock:** keep the already-loaded Plus Jakarta Sans (one fewer font request, one fewer tell).
- **Clock:** Plus Jakarta with `font-variant-numeric: tabular-nums` — explicitly **not** a mono font.
- Add `Saira Condensed` to the existing Google Fonts `<link>` in `index.html` (append to the current request, don't add a tag).
- Caps reserved for the billing voice; **no ALL-CAPS decorative eyebrows** on every panel.

### 5.3 Color discipline
- Monochrome cool charcoal everywhere (the brand surfaces); the **only** chromatic accent on screen is the beam (indigo) on the gate poster + active marker.
- Cue dot: faint indigo ring at rest → amber `--cue-hot` + pulse at the cue threshold.
- Semantics stay separate from the beam: accept = `--status-success` (one flash), fail = `--status-danger` (torn seam). These reuse the live ghost/burned colors.
- Text ramp passes WCAG AA on the dark base: `#f8fafc / #a8b2c4 / ~#7c8598 / ~#565e6e`.
- **Kill** `.feed-container` `backdrop-filter` frost → opaque graded charcoal. Legibility over frost on a timed competitive screen.

### 5.4 Radius / elevation / spacing
- One 8px spacing grid (`4 / 8 / 12 / 16 / 24 / 32`).
- Hold the existing radius tokens; posters keep minimal sharp corners (rounding poster art looks wrong). Kill one-off 2px/3px radii.
- One 2–3 step shadow set from tokens; no bespoke `0 30px 70px` shadows.

---

## 6. Component design

### 6.1 The Beam — gate, splice, billing (evolve the Constellation)
- `.reel` = the strip; add **sprocket perfs** (decorative top/bottom pseudo-element bands) so it reads as film. Keep the existing center-when-fits / scroll-when-overflows behavior.
- `.reel-node.now-playing` = the **gate frame**: enlarge (push past the shipped 104px), keep its indigo border + glow, add a black film-cell matte + perfs, allow a slight bleed past the safe area. The ambient beam halo may sample one dominant swatch from the poster at low alpha (diegetic per-film color); indigo border stays constant.
- `.reel-bridge` (connecting actor) = the **splice seam**: typeset the actor name *on the seam* between outgoing and incoming posters (the physical splice point) with a taped-seam motif. Vertical treatment on desktop; **horizontal fallback** at narrow widths (must stay legible — flagged for QA).
- `.now-cast` / `.now-cast-list` = the **billing block** beneath the gate: title `--t-display`, cast as a one-sheet credit stack, the connecting actor as the lead.
- Box-office copy: `Now Showing`, `Reel N`, `Feature Presentation`.

### 6.2 The Bench — operators (evolve `renderPlayerSidebar`)
- `.sidebar-players li` → operator rows: a small **film-frame** chip (avatar/initial, sprocket nicks) + name + a status line.
- States via existing classes: `.active-turn` → **On Screen** (indigo frame + glow); `.eliminated` → **Walked Out** (struck, dimmed). **New "Up Next"** state requires a small `renderPlayerSidebar` tweak to mark the next live player (minor JS).
- Box-office status vocabulary: `On Screen / Up Next / Seated / Walked Out / Intermission`.
- **Team mode:** two benches (🔴 Red / 🔵 Blue) flanking or stacked on the bench side; reuse the `game-team-header` rows.
- **Solo mode:** bench collapses to a single projectionist card + run stats (reuse `solo-objective-bar`).
- **Spectator:** the `spectator-count` row + `spectator-prediction-bar` restyle to "the audience."

### 6.3 The Splice Console — input
- `#input-area` → console: `#movie-input` as the slot ("Name the next feature…"), `#submit-btn` as a confident rectangular **Roll It** key (indigo, gains a text label; keep the icon + aria-label).
- Header controls (`#mute-btn`, `#game-invite-btn`, `#quit-game-btn`, `#active-theme-badge`) keep their IDs/handlers; restyle as booth controls.
- Disabled-out-of-turn behavior preserved (the Audit #2 partial-dim contract on `.input-area.disabled-area .input-row` stays).
- `#submission-pill` and `#peer-typing-indicator` keep their aria-live roles.

### 6.4 The Cue Dot — timer
- Keep `#timer-bar` as the JS-driven state element (socketClient writes its `width` + `--timer-green/yellow/red` + `.timer-critical`/`.timer-panic`). Re-express the cue **at the cue edge** as a depleting ring/dot.
- Implementation: either restyle `#timer-bar` into the dot, or add a sibling cue-dot that mirrors the same classes via CSS (preferred — least JS churn). At `.timer-critical`/panic (≤ threshold) the dot shifts indigo→amber and pulses on an accelerating cadence (the reel-change burn).
- The numeric `#time-text` stays (tabular-nums) as the non-color, screen-reader-safe cue.
- **Collapse the redundant time indicators** — one canonical countdown (the cue dot), not bar + per-player time + numeric all at once.

### 6.5 Reactions — ticket stubs
- `#reaction-bar .reaction-btn` → **die-cut ticket-stub** chips (perforation motif, condensed caps). Replace the 🔥😂💀👀 quartet with a small booth-native set (e.g. *Bravo / Brutal / Cut!*).
- The broadcast reaction that flies across the board should match (drawn mark / stub), **not** a raw OS emoji — flagged as a content sub-decision; keep payload wiring intact.

### 6.6 Chat — lobby drawer (decided)
- Booth stays two zones; chat lives in a **collapsible drawer** toggled from the bench, with an unread badge (reuse `#chat-badge` semantics).
- Preserve `#chat-messages`, `#chat-input`, `#chat-send-btn`. Requires a drawer container + toggle (new markup) and a small open/close + unread handler (minor JS). Restyle as "the lobby."

### 6.7 Header
- Light touch only: keep `.logo`, `.header-nav`, all four nav button IDs. Optional restrained marquee detail on the logo; no structural change.

### 6.8 Failure / empty states (evolve, never regress)
- Keep the shipped `.reel-node.burned` (grayscale + warm border + stamp) and `.reel-node-ghost` / `.reel-bridge-broken` (dashed-red + ✗) vocabulary; evolve into the booth language: a **failed splice** = the incoming strip jumps the sprockets + the seam tears red. Do not discard these stateful components.

---

## 7. Motion

Named curves, reused everywhere (transform + opacity only, GPU):
- `--ease-gate: cubic-bezier(0.16,1,0.3,1)` (reuse the codebase's existing curve) — entrances/handoff.
- `--ease-snap` (short sharp) — accept.
- `--ease-in` (accelerating) — **failure only**.
- A spring (slight overshoot, interruptible) — your-turn gate-light.
- Durations: `120 / 200 / 320ms`.

Frequency ladder (intensity inverse to frequency):
1. **Timer (every frame → whisper):** cue dot depletes smoothly; silent until ≤5s, then indigo→amber + accelerating pulse.
2. **Turn handoff (every turn):** the beam/active-marker **travels** along the bench from the previous operator to the next (320ms) — never a cross-fade in place; the motion encodes who's up. (Hook: existing `choreographTurn()`.)
3. **Accepted splice (every turn):** strip advances one frame (~220ms `--ease-gate`) + the seam billing fades up (110ms) + a soft indigo flare on the gate poster (~180ms). (Hook: existing clutch effect.)
4. **Your-turn (per your turn):** the gate lights (spring).
5. **Failed splice (rarer):** strip recoil (3-oscillation, 300–360ms `--ease-in`) + the shipped ghost stamp tears in + danger flash. No positive screen-shake.
6. **Match win (once):** the one theatrical moment — the reel runs off the gate, beam flares, hands to recap.

**Reduced motion is a first-class path:** extend the existing `06-states-anim.css` global reduced-motion block; swap every translate/scale/recoil for opacity cross-fades that **preserve the information and the cue color**, never just disable.

> Motion is never shipped as prose — each interaction above is speccable (curve + duration + trigger + end state). The implementation plan owns the per-interaction breakdown.

---

## 8. DOM / ID contract (must survive)

CSS-first redesign. These are queried by JS and **must not be renamed**:
`#game-screen`, `.layout-grid`, `.sidebar`, `#game-players`, `.game-board`, `#chain-display`, `.filmstrip`, `.reel`, `.reel-node`, `.reel-bridge`, `.now-cast`, `#input-area`, `#timer-bar`, `#movie-input`, `#submit-btn`, `#turn-indicator`, `#time-text`, `#hint-text`, `#mute-btn`, `#game-invite-btn`, `#quit-game-btn`, `#active-theme-badge`, `#submission-pill`, `#peer-typing-indicator`, `#solo-objective-bar`, `#reaction-bar`, `#autocomplete-container`, `#mobile-ac-dropdown`, `#chat-messages`, `#chat-input`, `#chat-send-btn`, `#chat-badge`, `#spectator-prediction-bar`, `.mobile-tabs`.
Render hooks that must keep working: `renderPlayerSidebar`, `renderTurnControls`, `choreographTurn`, the clutch effect, the socketClient `#timer-bar` handler.

**Allowed JS/markup changes (minor, additive):** "Up Next" marking in `renderPlayerSidebar`; chat drawer container + toggle/unread handler; optional cue-dot sibling element; reaction relabel. Everything else is CSS.

---

## 9. Responsive / mobile
- Booth stacks: **Beam** on top; bench + chat behind the existing `.mobile-tabs` (relabel Board/Players/Chat → e.g. *Gate / Booth / Lobby*; keep `data-tab` values).
- The reel keeps its mobile sticky-strip behavior (existing 767px breakpoint).
- Splice-seam falls back to horizontal at narrow widths.

---

## 10. Accessibility
- Turn state is conveyed by the **"On Screen" label**, not color alone.
- Cue urgency has the numeric `#time-text` + aria-live, not just the amber color.
- Maintain AA contrast on the cool-grey ramp; preserve all existing aria roles/labels and the focus-trap wiring.
- Reduced-motion path preserves all information.

---

## 11. Constraints & risks
- **Live site**, vanilla JS + CSS, no framework. Render deploy is classifier-gated → hand off to user.
- `public/css/*.css` load order is **load-bearing** (cascade); `03-game.css` is the primary file. New rules likely append to `03-game.css` (and `06-states-anim.css` for motion). A new partial would need an ordered `<link>` insertion.
- **Do NOT touch** `server/ruleKits.test.js` or `server/my-stats-enrichment.test.js` (in-flight 6c.1 TDD-red).
- The coverage ratchet now measures `public/js/` — any JS touch must keep thresholds (`./public/js/` floors 63/52/50/66).
- 5 client suites regex-pin source formatting — JS edits may trip them; update tests in lockstep.
- **Risk: regressing the chain board.** Mitigation: evolve `.filmstrip/.reel` classes in place; keep burned/ghost states; visual-diff the board before/after.

---

## 12. Validation — must survive hostile content
No frame is accepted until it survives all of:
1. 5-player bench. 2. A 26-char movie title in the gate. 3. A 9-name cast billing block (wrap). 4. The empty pre-game gate. 5. The broken-splice failure state. 6. Team mode (two benches). 7. Solo mode. 8. Mobile stack. 9. `prefers-reduced-motion`. 10. Spectator view.

Testing: jsdom unit tests for any `renderPlayerSidebar`/chat-drawer JS changes; keep/refresh the regex-pinned client suites; manual visual smoke on the 10 cases above against the live element IDs.

---

## 13. Proposed phasing (plan will detail)
Each phase is independently shippable and visually coherent:
1. **Foundation (low risk, CSS-only):** add Saira Condensed + type scale + semantic tokens; re-skin surfaces to booth-dark; kill `.feed-container` frost.
2. **The Beam:** gate frame + sprocket perfs + splice seam + billing block (evolve Constellation).
3. **The Bench:** operator film-frames + states + "Up Next" + team/solo variants.
4. **Console + Cue Dot + Suggestions float.**
5. **Lobby drawer (chat) + ticket-stub reactions.**
6. **Motion system + reduced-motion path.**

---

## 14. Open sub-decisions (non-blocking; resolve during build)
- Exact ticket-stub reaction labels + whether the broadcast glyph is a drawn mark vs stylized stub.
- Whether the gate halo samples poster color or stays constant indigo.
- Splice-seam vertical vs horizontal threshold.
- Mobile tab relabeling (Gate/Booth/Lobby vs keep current).
