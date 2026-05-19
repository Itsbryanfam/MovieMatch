# Phase 7.6 — Chain Premiere Recap + Share Cards 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cinematic post-game Chain Premiere Recap (a pure, reusable choreography engine + a thin overlay driver) and a focused additive Share Cards 2.0 (emoji grid + "I survived N links"), client-only, with the 1.0 end-game banner and all server/lobby surfaces byte-identical.

**Architecture:** A pure zero-import `chain-recap.js` turns finished game state into a deterministic **storyboard** (ordered timed beats) — the `red-carpet.js` pure-seam pattern; 7.9 Post-Game Trailer will reuse it unchanged. A thin `recap-player.js` driver renders the storyboard into a dedicated additive `#recap-overlay` using the proven `ui-panels.js` `setTimeout`-chain, compositor-only transform/opacity classes, Skip/Replay, and an accessibility-safe instant-settle path. Share 2.0 is additive to the existing pure `ui-sharecard.js`. Wiring is one block in `socketClient.js` on the existing `playing→finished` one-shot edge, Daily-suppressed; `ui-render.js`/`showGameOverBanner` is **zero-change**.

**Tech Stack:** Vanilla ES-module no-build client; Jest 30 + jest-environment-jsdom; CommonJS server (untouched). Worktree `C:\mm-phase7-6`, branch `phase7-6-chain-premiere-recap`, off `origin/main ed6f041`; `node_modules` junctioned to shared `C:\moviematch-git\node_modules` (359) so jest resolves. A parallel Codex agent shares the repo → **branch-verify `git -C C:/mm-phase7-6 branch --show-current` == `phase7-6-chain-premiere-recap` before EVERY commit**.

**Spec:** `docs/superpowers/specs/2026-05-19-chain-premiere-recap-design.md` (committed `56a8302`). Read §1 (8 locked decisions), §3 (contract), §5 (zero-regression ratchet), §8 (G1–G8), §9 (acceptance).

**Base suite at `ed6f041`:** 55 suites / 437 tests (7.5.3's +2/+22 rides PR #34 separately — NOT in this base). Every task ends with full `cd C:/mm-phase7-6 && npx jest` green (additive over 55/437).

**Binding (all tasks):** client-only — **zero** `server/**`, `gameLogic`, socket-protocol, or new-socket-event change. Every code change ships a WHY comment. No `innerHTML` for dynamic/user-derived content (DOM APIs only). Out-of-scope findings → `mcp__ccd_session__spawn_task` chip, never widen 7.6. After each task: spec-compliance review → real fix-loop → code-quality review → real fix-loop → mark complete + sync `.tasks.json` as its OWN follow-up commit.

---

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `public/js/ui/chain-recap.js` | 0 (create) | Pure zero-import engine: `buildRecapStoryboard(state)` + the relocated `selectChainEntries`/`scoreChainEntry` (their new home). |
| `public/js/ui/ui-sharecard.js` | 0 (modify), 2 (modify) | T0: remove the two relocated fns, import+re-export them from chain-recap.js (byte-stable surface). T2: additive `buildEmojiGrid` + survived-line on canvas + text. |
| `client-tests/chain-recap.test.js` | 0 (create) | Storyboard schema/order/determinism, cap reuse, finale parity, elimination best-effort, zero-identity sentinel, relocation parity. |
| `public/js/ui/recap-player.js` | 1 (create) | Thin DOM driver: `playRecap`/`cancelRecap` — storyboard → `#recap-overlay`, Skip/Replay, reduced-motion instant-settle, leak-safe. |
| `public/index.html` | 1 (modify) | Additive `#recap-overlay` sibling after `#share-modal` (L564). |
| `public/css/04-modals.css` | 1 (modify) | Append-only recap overlay STRUCTURAL CSS (mirrors `.share-modal-card`). |
| `public/css/06-states-anim.css` | 1 (modify) | Append-only recap `@keyframes`/animation classes (compositor-only; existing global reduced-motion handling neutralizes). |
| `public/js/socketClient.js` | 1 (modify) | Add `playRecap` to the ui.js import; one Daily-suppressed one-shot block after the Daily block. |
| `client-tests/recap-player.test.js` | 1 (create) | Mount, Skip→settled, reduced-motion short-circuit, one-shot guard, Daily-suppression, poster fallback. |
| `client-tests/sharecard.test.js` | 2 (create) | `buildEmojiGrid` spoiler-free/zero-identity, survived-line, `buildTextRecap` composition, existing-export byte-stability. |

`ui-render.js` (incl. `showGameOverBanner` L865–930), all `server/**`, the lobby suites, `render-chain.test.js`/`socket-handlers.test.js`/`showScreen.test.js` — **byte-identical / untouched** (the §5 ratchet proof).

---

## Task 0: Pure choreography engine + DRY relocation

**Goal:** Create the pure zero-import `chain-recap.js` (`buildRecapStoryboard` + the relocated `selectChainEntries`/`scoreChainEntry`); `ui-sharecard.js` imports them back and re-exports them so its public surface is byte-stable.

**Files:**
- Create: `public/js/ui/chain-recap.js`
- Modify: `public/js/ui/ui-sharecard.js` (remove fn defs at L183–231; add import + re-export near L7)
- Test: `client-tests/chain-recap.test.js` (create)

**Acceptance Criteria:**
- [ ] `chain-recap.js` is zero-import (no `import` statement) and pure (no DOM/`window`/timers/`Date`/RNG).
- [ ] `buildRecapStoryboard(state)` returns an ordered `Array<Beat>` matching spec §3.1: `intro` → (`bridge`?→`link`) per curated entry → `skipped`? → `finale`; each beat `{type,index,atMs,durMs,payload}`; `atMs` is the cumulative sum of prior `durMs`, `index` is the 0-based ordinal, `durMs` is the frozen per-type constant.
- [ ] Curation reuses the relocated `selectChainEntries` (≤7 entries: first + ≤5 top middle + last) + a single `skipped` beat iff `skipped>0`.
- [ ] `finale.payload.winnerLine`/`subLine` are character-identical to what `showGameOverBanner` (ui-render.js L872–893) would render for solo-complete / solo-over / team-win / winner / no-winner.
- [ ] `elimination` beat emitted **only** if a curated entry has `eliminated===true`; absent on realistic fixtures (no fabrication).
- [ ] Zero-identity: no beat payload contains `stableId`/socket-id/any identifier (sentinel test green).
- [ ] Long-chain (≥12, no eliminations) storyboard total (`last.atMs+last.durMs`) ≤ 13000.
- [ ] `ui-sharecard.js` re-exports `selectChainEntries`/`scoreChainEntry` as the **same function references** as `chain-recap.js`; existing-fixture output parity holds.
- [ ] `server/**` untouched. Full `cd C:/mm-phase7-6 && npx jest` green.

**Verify:** `cd C:/mm-phase7-6 && npx jest client-tests/chain-recap.test.js` → PASS; then `cd C:/mm-phase7-6 && npx jest` → all green (additive over 55/437).

**Steps:**

- [ ] **Step 1: Write the failing test** — `client-tests/chain-recap.test.js`

```js
// client-tests/chain-recap.test.js — Phase 7.6 Task 0
// WHY: chain-recap.js is the pure, zero-import, 7.9-reusable storyboard
// producer (the red-carpet.js seam pattern). This suite is its own unit
// suite (the 7.5.1/7.5.2/7.5.3 seam-suite precedent — legitimately new,
// not a guard rewrite) and also pins the DRY relocation's byte-stable
// ui-sharecard.js public surface.
const {
  buildRecapStoryboard,
  selectChainEntries,
  scoreChainEntry,
} = require('../public/js/ui/chain-recap.js');
const sharecard = require('../public/js/ui/ui-sharecard.js');

// Minimal chain entry factory. NOTE: stableId is deliberately injected on
// the player to prove the storyboard never echoes it (zero-identity, the
// Phase-1 daily-leaderboard security invariant).
function link(idx, over = {}) {
  return {
    playerName: `P${idx}`,
    stableId: `SECRET_${idx}`, // must never appear in any beat
    movie: {
      title: `Movie ${idx}`,
      year: 2000 + idx,
      poster: idx % 2 === 0 ? `https://image.tmdb.org/t/p/w200/x${idx}.jpg` : '',
      mediaType: 'movie',
      cast: [{ name: `Actor ${idx}` }],
    },
    matchedActors: idx === 0 ? [] : [`Actor ${idx}`],
    ...over,
  };
}
function chainOf(n) { return Array.from({ length: n }, (_, i) => link(i)); }

describe('buildRecapStoryboard — schema & order', () => {
  test('first beat is intro with chainCount; last beat is finale', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(3), winner: { name: 'P1', score: 9 } });
    expect(sb[0]).toMatchObject({ type: 'intro', index: 0, payload: { chainCount: 3 } });
    expect(sb[sb.length - 1].type).toBe('finale');
  });

  test('a 3-link chain yields intro, link0, bridge+link1, bridge+link2, finale in order', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(3), winner: { name: 'P1', score: 9 } });
    expect(sb.map(b => b.type)).toEqual(['intro', 'link', 'bridge', 'link', 'bridge', 'link', 'finale']);
    // seed link has no preceding bridge; isSeed true only at idx 0
    const links = sb.filter(b => b.type === 'link');
    expect(links[0].payload).toMatchObject({ idx: 0, isSeed: true });
    expect(links[1].payload).toMatchObject({ idx: 1, isSeed: false });
    // poster: tmdb url kept for even idx, null otherwise
    expect(links[0].payload.poster).toBe('https://image.tmdb.org/t/p/w200/x0.jpg');
    expect(links[1].payload.poster).toBeNull();
    // bridge carries the connecting actor
    expect(sb.filter(b => b.type === 'bridge').map(b => b.payload.actor)).toEqual(['Actor 1', 'Actor 2']);
  });

  test('atMs is the cumulative sum of prior durMs; index is the ordinal', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(2), winner: { name: 'P1', score: 1 } });
    let acc = 0;
    sb.forEach((b, i) => {
      expect(b.index).toBe(i);
      expect(b.atMs).toBe(acc);
      expect(Number.isInteger(b.durMs) && b.durMs > 0).toBe(true);
      acc += b.durMs;
    });
  });

  test('deterministic — same input yields identical storyboard', () => {
    const st = { gameMode: 'classic', chain: chainOf(4), winner: { name: 'P2', score: 7 } };
    expect(buildRecapStoryboard(st)).toEqual(buildRecapStoryboard(st));
  });

  test('empty/short chain — intro + finale only, no link/bridge', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: [], winner: null });
    expect(sb.map(b => b.type)).toEqual(['intro', 'finale']);
  });
});

describe('buildRecapStoryboard — curation cap & skipped beat', () => {
  test('chain >7 is curated to ≤7 links + a single skipped beat; total ≤13000ms', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(12), winner: { name: 'P1', score: 30 } });
    expect(sb.filter(b => b.type === 'link').length).toBeLessThanOrEqual(7);
    expect(sb.filter(b => b.type === 'skipped').length).toBe(1);
    expect(sb.find(b => b.type === 'skipped').payload.skipped).toBe(12 - 7);
    const last = sb[sb.length - 1];
    expect(last.atMs + last.durMs).toBeLessThanOrEqual(13000);
  });

  test('chain ≤7 produces no skipped beat', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(7), winner: { name: 'P1', score: 9 } });
    expect(sb.some(b => b.type === 'skipped')).toBe(false);
  });
});

describe('buildRecapStoryboard — finale parity with showGameOverBanner', () => {
  // Strings copied verbatim from ui-render.js showGameOverBanner L872-893.
  test('solo complete', () => {
    const sb = buildRecapStoryboard({ gameMode: 'solo', chain: chainOf(5), winner: { isSolo: true, chainLength: 5 } });
    const f = sb[sb.length - 1].payload;
    expect(f.winnerLine).toBe('🎬 Solo Complete!');
    expect(f.subLine).toBe('🔗 Chain Length: 5 links');
  });
  test('solo over (no solo winner)', () => {
    const sb = buildRecapStoryboard({ gameMode: 'solo', chain: chainOf(1), winner: null });
    const f = sb[sb.length - 1].payload;
    expect(f.winnerLine).toBe('🎬 Solo Over');
    expect(f.subLine).toBe('🔗 Final Chain: 1 connection');
  });
  test('team win', () => {
    const sb = buildRecapStoryboard({ gameMode: 'team', chain: chainOf(4), winner: { isTeamWin: true, name: '🔴 Red', players: ['A', 'B'], score: 12 } });
    const f = sb[sb.length - 1].payload;
    expect(f.winnerLine).toBe('🏆 🔴 Red wins!');
    expect(f.subLine).toBe('A & B • 12 pts');
  });
  test('classic winner', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(3), winner: { name: 'Zoe', score: 8 } });
    const f = sb[sb.length - 1].payload;
    expect(f.winnerLine).toBe('🏆 Zoe wins!');
    expect(f.subLine).toBe('8 pts • 3 connections');
  });
  test('no winner', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(2), winner: null });
    const f = sb[sb.length - 1].payload;
    expect(f.winnerLine).toBe('🎬 Game Over!');
    expect(f.subLine).toBe('2 connections total');
  });
});

describe('buildRecapStoryboard — elimination best-effort (no fabrication)', () => {
  test('realistic fixture (no eliminated field) → zero elimination beats', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(5), winner: { name: 'P1', score: 9 } });
    expect(sb.some(b => b.type === 'elimination')).toBe(false);
  });
  test('synthetic entry with eliminated===true → one elimination beat (capability, not fabricated into real data)', () => {
    const chain = chainOf(3);
    chain[1].eliminated = true;
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain, winner: null });
    const elim = sb.filter(b => b.type === 'elimination');
    expect(elim.length).toBe(1);
    expect(elim[0].payload).toEqual({ playerName: 'P1' }); // chain[1].playerName === 'P1'
  });
});

describe('zero-identity sentinel', () => {
  test('no beat payload anywhere echoes stableId/socket id', () => {
    const sb = buildRecapStoryboard({ gameMode: 'classic', chain: chainOf(9), winner: { name: 'P1', score: 20 } });
    const json = JSON.stringify(sb);
    expect(json).not.toMatch(/SECRET_/);
    expect(json).not.toMatch(/stableId/);
  });
});

describe('DRY relocation — ui-sharecard.js byte-stable public surface', () => {
  test('ui-sharecard re-exports the SAME function references as chain-recap', () => {
    expect(sharecard.selectChainEntries).toBe(selectChainEntries);
    expect(sharecard.scoreChainEntry).toBe(scoreChainEntry);
  });
  test('relocated selectChainEntries output parity for representative fixtures', () => {
    const small = chainOf(3);
    expect(selectChainEntries(small)).toEqual({ entries: small.map((c, i) => ({ ...c, _idx: i })), skipped: 0 });
    const big = chainOf(10);
    const r = selectChainEntries(big);
    expect(r.entries.length).toBe(7);
    expect(r.skipped).toBe(3);
    expect(r.entries[0]._idx).toBe(0);
    expect(r.entries[6]._idx).toBe(9);
  });
  test('scoreChainEntry seed returns -1; cross-mediaType adds 3', () => {
    expect(scoreChainEntry(chainOf(2)[0], 0, chainOf(2))).toBe(-1);
    const c = chainOf(2);
    c[0].movie.mediaType = 'tv'; c[1].movie.mediaType = 'movie';
    expect(scoreChainEntry(c[1], 1, c)).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/mm-phase7-6 && npx jest client-tests/chain-recap.test.js`
Expected: FAIL — `Cannot find module '../public/js/ui/chain-recap.js'`.

- [ ] **Step 3: Create `public/js/ui/chain-recap.js`** (verbatim — zero-import, pure)

```js
// public/js/ui/chain-recap.js — Phase 7.6 pure chain-choreography engine.
// WHY: this is the single, reusable, ZERO-IMPORT pure seam (the red-carpet.js
// pattern). It turns a finished game state into a deterministic storyboard
// (ordered timed beats) and owns NO DOM, NO timers, NO clock, NO randomness,
// so it is fully unit-testable and Phase 7.9 (Post-Game Trailer) reuses
// buildRecapStoryboard unchanged. selectChainEntries/scoreChainEntry are
// RELOCATED here verbatim from ui-sharecard.js (their new home) so this file
// stays zero-import while remaining DRY — ui-sharecard.js imports them back
// and re-exports them under the same names (byte-stable public surface).

// --- relocated verbatim from ui-sharecard.js (was L183-231) ---
export function scoreChainEntry(item, index, chain) {
    if (index === 0) return -1;
    let score = 0;
    const prev = chain[index - 1];

    if (prev.movie.mediaType && item.movie.mediaType &&
        prev.movie.mediaType !== item.movie.mediaType) {
        score += 3;
    }

    const actor = (item.matchedActors || [])[0];
    if (actor) {
        // H4: cast entries are now {id, name} objects (with legacy bare-string
        // entries possible during the transition). Compare on the name field;
        // matchedActors stays as bare strings for client-display compatibility.
        const pos = (item.movie.cast || []).findIndex(c => {
            const cName = typeof c === 'string' ? c : (c && c.name) || '';
            return cName.toLowerCase() === actor.toLowerCase();
        });
        if (pos > 4) score += 2;
    }

    const prevYear = parseInt(prev.movie.year);
    const currYear = parseInt(item.movie.year);
    if (!isNaN(prevYear) && !isNaN(currYear)) {
        score += Math.floor(Math.abs(currYear - prevYear) / 10);
    }

    return score;
}

export function selectChainEntries(chain) {
    const MAX = 7;
    if (chain.length <= MAX) return { entries: chain.map((c, i) => ({ ...c, _idx: i })), skipped: 0 };

    const scored = chain.map((item, i) => ({ ...item, _idx: i, _score: scoreChainEntry(item, i, chain) }));

    const first = scored[0];
    const last = scored[scored.length - 1];

    const middle = scored.slice(1, -1)
        .sort((a, b) => b._score - a._score)
        .slice(0, 5)
        .sort((a, b) => a._idx - b._idx);

    const entries = [first, ...middle, last];
    const skipped = chain.length - entries.length;
    return { entries, skipped };
}

// --- storyboard ---

// WHY frozen per-type durations: timing must be deterministic (no clock/RNG)
// so the engine is unit-testable and 7.9 reusable. Tuned so the worst case
// (7 curated links + 6 bridges + skipped + intro + finale, no eliminations)
// totals ≈ 12.55s ≤ the spec §1.8 ~13s perf budget.
const BEAT_MS = Object.freeze({
  intro: 1000,
  link: 850,
  bridge: 500,
  skipped: 600,
  elimination: 700,
  finale: 2000,
});

// WHY pure replica (not a DOM import) of showGameOverBanner's winner
// branching (ui-render.js L872-893): the recap's settled end-state must be
// character-identical to the 1.0 banner (spec §4 behavioural-equivalence),
// but the engine stays pure — so the branching is duplicated here as data
// and pinned by the finale-parity tests rather than imported from the
// impure DOM function.
function buildFinalePayload(state, chainLen) {
  const isSolo = state.gameMode === 'solo';
  const winner = state.winner;
  let kind, winnerLine, subLine;
  if (isSolo) {
    if (winner && winner.isSolo) {
      kind = 'solo-complete';
      winnerLine = `🎬 Solo Complete!`;
      subLine = `🔗 Chain Length: ${winner.chainLength} link${winner.chainLength !== 1 ? 's' : ''}`;
    } else {
      kind = 'solo-over';
      winnerLine = `🎬 Solo Over`;
      subLine = `🔗 Final Chain: ${chainLen} connection${chainLen !== 1 ? 's' : ''}`;
    }
  } else if (winner && winner.isTeamWin) {
    kind = 'team';
    winnerLine = `🏆 ${winner.name} wins!`;
    subLine = `${(winner.players || []).join(' & ')} • ${winner.score} pts`;
  } else if (winner) {
    kind = 'winner';
    winnerLine = `🏆 ${winner.name} wins!`;
    subLine = `${winner.score} pts • ${chainLen} connections`;
  } else {
    kind = 'none';
    winnerLine = '🎬 Game Over!';
    subLine = `${chainLen} connections total`;
  }
  return { kind, winnerLine, subLine };
}

export function buildRecapStoryboard(state) {
  const chain = Array.isArray(state && state.chain) ? state.chain : [];
  const { entries, skipped } = selectChainEntries(chain);

  const beats = [];
  let atMs = 0;
  const push = (type, payload) => {
    beats.push({ type, index: beats.length, atMs, durMs: BEAT_MS[type], payload });
    atMs += BEAT_MS[type];
  };

  push('intro', { title: 'MovieMatch', chainCount: chain.length });

  for (const e of entries) {
    const idx = e._idx;
    // bridge precedes the link it connects TO (cinematic: the actor flips
    // in, then the connected poster slides). Seed (idx 0) has no bridge.
    if (idx > 0 && e.matchedActors && e.matchedActors[0]) {
      push('bridge', { actor: e.matchedActors[0] });
    }
    push('link', {
      idx,
      playerName: e.playerName || 'Player',
      title: (e.movie && e.movie.title) || 'Unknown',
      year: (e.movie && e.movie.year != null) ? e.movie.year : '?',
      // only trust real TMDB urls (same guard as ui-render/ui-panels);
      // anything else → null so the driver shows the designed placeholder.
      poster: (e.movie && typeof e.movie.poster === 'string'
        && e.movie.poster.startsWith('https://image.tmdb.org/')) ? e.movie.poster : null,
      isSeed: idx === 0,
    });
    // best-effort, NO fabrication (spec §1.4): the data model has no
    // per-link elimination marker today, so this never fires on real
    // games — it is a forward-compatible hook, omitted when absent.
    if (e && e.eliminated === true) {
      push('elimination', { playerName: e.playerName || 'Player' });
    }
  }

  if (skipped > 0) push('skipped', { skipped });

  push('finale', buildFinalePayload(state || {}, chain.length));

  return beats;
}
```

- [ ] **Step 4: Modify `public/js/ui/ui-sharecard.js`** — remove the two relocated fns, import + re-export them

Replace the import line at the top (currently L7 `import { shareCanvas, shareModal } from './ui-dom.js';`) — add a second import + a re-export immediately after it:

```js
import { shareCanvas, shareModal } from './ui-dom.js';
// Phase 7.6: selectChainEntries/scoreChainEntry RELOCATED to the pure
// zero-import chain-recap.js (its new home — keeps that engine pure & DRY).
// Imported back for generateShareCard's internal use AND re-exported under
// the SAME names so this module's public surface is byte-stable for every
// existing importer (spec §3.2 / §5 ratchet).
import { selectChainEntries, scoreChainEntry } from './chain-recap.js';
export { selectChainEntries, scoreChainEntry };
```

Then DELETE the now-duplicated function definitions. Remove the entire `export function scoreChainEntry(item, index, chain) { … }` block AND the entire `export function selectChainEntries(chain) { … }` block (the two contiguous definitions that were at L183–231 — verbatim the same bodies now living in chain-recap.js). Leave everything else (`generateShareCard`, `truncate`, `roundRect`, `openShareModal`, `buildTextRecap`) **untouched** — `generateShareCard`'s internal `selectChainEntries(state.chain)` call now resolves to the imported binding.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd C:/mm-phase7-6 && npx jest client-tests/chain-recap.test.js`
Expected: PASS (all describes green).

- [ ] **Step 6: Run the full suite (no regression)**

Run: `cd C:/mm-phase7-6 && npx jest`
Expected: all green — 55 base suites + the new `chain-recap.test.js` (56 suites). `ui-sharecard.js` consumers unaffected (re-export is reference-equal). `server/**` untouched.

- [ ] **Step 7: Branch-verify then commit**

```bash
cd C:/mm-phase7-6 && test "$(git branch --show-current)" = "phase7-6-chain-premiere-recap" \
  && git add public/js/ui/chain-recap.js public/js/ui/ui-sharecard.js client-tests/chain-recap.test.js \
  && git -c commit.gpgsign=false commit -m "Phase 7.6 (0): pure chain-recap storyboard engine + DRY relocation

buildRecapStoryboard (zero-import/pure, deterministic, 7.9-reusable) +
selectChainEntries/scoreChainEntry relocated here verbatim; ui-sharecard.js
imports them back and re-exports them (byte-stable public surface). New
chain-recap.test.js (schema/order/determinism/cap/finale-parity/elimination-
best-effort/zero-identity/relocation-parity). server/** untouched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["public/js/ui/chain-recap.js", "public/js/ui/ui-sharecard.js", "client-tests/chain-recap.test.js"], "verifyCommand": "cd C:/mm-phase7-6 && npx jest client-tests/chain-recap.test.js && cd C:/mm-phase7-6 && npx jest", "acceptanceCriteria": ["chain-recap.js zero-import & pure (no DOM/window/timers/Date/RNG)", "buildRecapStoryboard returns spec-§3.1 ordered beats; atMs=cumsum(durMs), index=ordinal, durMs=frozen per-type const", "curation reuses relocated selectChainEntries (≤7) + single skipped beat iff skipped>0", "finale.winnerLine/subLine char-identical to showGameOverBanner for all 5 winner branches", "elimination beat only if entry.eliminated===true; absent on realistic fixtures (no fabrication)", "zero-identity sentinel green (no stableId/socket id in any beat)", "long no-elim chain total atMs+durMs ≤ 13000", "ui-sharecard re-exports SAME refs as chain-recap; output parity holds; server/** untouched; full npx jest green"]}
```

---

## Task 1: Recap overlay driver + wiring (blockedBy [0])

**Goal:** Create the thin `recap-player.js` driver, the additive `#recap-overlay` skeleton, the append-only recap CSS, and the one-shot Daily-suppressed wiring in `socketClient.js` — with `showGameOverBanner`/`ui-render.js` byte-identical and the §5 surfaces unchanged.

**Files:**
- Create: `public/js/ui/recap-player.js`
- Modify: `public/index.html` (additive `#recap-overlay` after L564)
- Modify: `public/css/04-modals.css` (append-only at EOF, after L610)
- Modify: `public/css/06-states-anim.css` (append-only at EOF, after L1214)
- Modify: `public/js/socketClient.js` (add `playRecap` to the ui.js import L11–24; one block after the Daily block, after L499)
- Test: `client-tests/recap-player.test.js` (create)

**Acceptance Criteria:**
- [ ] `playRecap(state, mountEl, {prefersReducedMotion,onDone})` builds the storyboard synchronously, renders into `#recap-overlay`, reveals it (removes `hidden`).
- [ ] `prefersReducedMotion` truthy → renders the **settled end-state** (all beats' final content, no animation) instantly, calls `onDone`, schedules no timer.
- [ ] Otherwise animates via a single cancellable `setTimeout` chain (the `ui-panels.js` pattern); `cancelRecap()` clears the handle (leak-safe).
- [ ] `#recap-skip` → cancel + settled end-state; `#recap-replay` → restart from beat 0; `#recap-close` → hide overlay. Posters use `attachPosterFallback`.
- [ ] Wiring fires `playRecap` exactly once on `justFinished && !getIsDaily()`; **never** in Daily; never on stateUpdate re-fire (the `justFinished` edge is itself the one-shot, mirroring the Daily modal).
- [ ] `public/js/ui/ui-render.js` is **byte-identical** to `ed6f041` (zero change — `showGameOverBanner` untouched); the only `socketClient.js` change is the import addition + the one block; CSS is append-only (no pre-existing rule edited, no new `@media`, no new colour value); index.html change is the additive `#recap-overlay` sibling only.
- [ ] `render-chain.test.js`/`socket-handlers.test.js`/`showScreen.test.js`/lobby suites/`server/**` byte-identical & green. Full `cd C:/mm-phase7-6 && npx jest` green.

**Verify:** `cd C:/mm-phase7-6 && npx jest client-tests/recap-player.test.js` → PASS; then `cd C:/mm-phase7-6 && npx jest` → all green; then `git -C C:/mm-phase7-6 diff ed6f041 -- public/js/ui/ui-render.js` → EMPTY, and `git -C C:/mm-phase7-6 diff ed6f041 -- public/css/04-modals.css public/css/06-states-anim.css` shows **only** appended trailing hunks.

**Steps:**

- [ ] **Step 1: Write the failing test** — `client-tests/recap-player.test.js`

```js
// client-tests/recap-player.test.js — Phase 7.6 Task 1
// WHY: recap-player.js is the ONLY DOM/timer surface for the recap; this
// suite pins mount, the accessibility-safe instant-settle path, the
// cancellable timer (leak-safe), Skip/Replay, and the Daily one-shot guard.
// jsdom has no layout/matchMedia and fake timers stand in for the cinematic
// schedule — the motion fidelity itself is the user-side eyeball (spec §9.7).
/** @jest-environment jsdom */
const { playRecap, cancelRecap } = require('../public/js/ui/recap-player.js');

function overlay() {
  document.body.innerHTML = `
    <div id="recap-overlay" class="modal-overlay recap-overlay hidden">
      <div class="modal-card recap-card">
        <button class="btn modal-close" id="recap-close">✕</button>
        <div id="recap-stage" class="recap-stage"></div>
        <div class="recap-actions">
          <button id="recap-skip" class="btn btn-secondary">⏭ Skip</button>
          <button id="recap-replay" class="btn btn-primary">↻ Replay</button>
        </div>
      </div>
    </div>`;
  return document.getElementById('recap-overlay');
}
const state = (over = {}) => ({
  gameMode: 'classic',
  chain: [
    { playerName: 'Ann', movie: { title: 'A', year: 2001, poster: 'https://image.tmdb.org/t/p/w200/a.jpg' }, matchedActors: [] },
    { playerName: 'Bo', movie: { title: 'B', year: 2002, poster: '' }, matchedActors: ['Actor 1'] },
  ],
  winner: { name: 'Ann', score: 5 },
  ...over,
});

afterEach(() => { cancelRecap(); jest.useRealTimers(); document.body.innerHTML = ''; });

test('reduced-motion → instant settled end-state, overlay shown, onDone called, no timer', () => {
  const el = overlay();
  const onDone = jest.fn();
  playRecap(state(), el, { prefersReducedMotion: true, onDone });
  expect(el.classList.contains('hidden')).toBe(false);
  // settled end-state contains the finale winner line (parity w/ banner)
  expect(el.textContent).toContain('🏆 Ann wins!');
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('animated path schedules beats then resolves; cancelRecap stops it', () => {
  jest.useFakeTimers();
  const el = overlay();
  const onDone = jest.fn();
  playRecap(state(), el, { prefersReducedMotion: false, onDone });
  expect(el.classList.contains('hidden')).toBe(false);
  jest.runAllTimers();
  expect(onDone).toHaveBeenCalled();
  // cancel after completion is a safe no-op
  expect(() => cancelRecap()).not.toThrow();
});

test('Skip button → settled end-state immediately (finale visible), timer cleared', () => {
  jest.useFakeTimers();
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: false });
  document.getElementById('recap-skip').click();
  expect(el.textContent).toContain('🏆 Ann wins!');
  // no pending timer left (advancing time must not throw / re-render)
  expect(() => jest.runAllTimers()).not.toThrow();
});

test('Replay button → restarts from beat 0 (stage repopulates)', () => {
  jest.useFakeTimers();
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: false });
  jest.runAllTimers();
  const stage = document.getElementById('recap-stage');
  const firstHtml = stage.innerHTML;
  document.getElementById('recap-replay').click();
  // immediately after replay the stage is cleared then re-seeded
  jest.runAllTimers();
  expect(stage.innerHTML.length).toBeGreaterThan(0);
  expect(typeof firstHtml).toBe('string');
});

test('Close button hides the overlay', () => {
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: true });
  document.getElementById('recap-close').click();
  expect(el.classList.contains('hidden')).toBe(true);
});

test('null mount element is a safe no-op', () => {
  expect(() => playRecap(state(), null, { prefersReducedMotion: true })).not.toThrow();
});

test('poster fallback: non-tmdb poster does not create an <img> with that src', () => {
  const el = overlay();
  playRecap(state(), el, { prefersReducedMotion: true });
  const imgs = [...el.querySelectorAll('img')].map(i => i.getAttribute('src'));
  expect(imgs).not.toContain(''); // empty/non-tmdb poster → placeholder, not a broken <img src="">
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/mm-phase7-6 && npx jest client-tests/recap-player.test.js`
Expected: FAIL — `Cannot find module '../public/js/ui/recap-player.js'`.

- [ ] **Step 3: Create `public/js/ui/recap-player.js`** (verbatim)

```js
// public/js/ui/recap-player.js — Phase 7.6 thin recap DOM driver.
// WHY: chain-recap.js is the pure storyboard producer; this module is the
// ONLY place that touches the DOM/timers for the recap, so the engine stays
// pure/testable and 7.9 can reuse the storyboard with different chrome. The
// setTimeout-chain + single cancellable handle mirrors the proven leak-safe
// ui-panels.js replay tick.
import { buildRecapStoryboard } from './chain-recap.js';
import { attachPosterFallback } from './ui-dom.js';

let _recapTimer = null; // single cancellable handle (leak-safe)

export function cancelRecap() {
  if (_recapTimer) { clearTimeout(_recapTimer); _recapTimer = null; }
}

// Build one beat's DOM node. Pure-ish: createElement/textContent only (no
// innerHTML for dynamic content — the established XSS discipline). Posters
// use attachPosterFallback so a 404/non-tmdb url degrades to the designed
// placeholder exactly like renderChainItems/_buildReplayEntry.
function beatNode(beat) {
  const d = document.createElement('div');
  d.className = `recap-beat recap-${beat.type}`;
  const p = beat.payload || {};
  if (beat.type === 'intro') {
    d.textContent = `${p.title} — Chain of ${p.chainCount} connection${p.chainCount !== 1 ? 's' : ''}`;
  } else if (beat.type === 'bridge') {
    d.textContent = `↔ via ${p.actor}`;
  } else if (beat.type === 'skipped') {
    d.textContent = `+ ${p.skipped} more connection${p.skipped !== 1 ? 's' : ''}`;
  } else if (beat.type === 'elimination') {
    d.textContent = `❌ ${p.playerName} eliminated`;
  } else if (beat.type === 'finale') {
    const t = document.createElement('div');
    t.className = 'recap-finale-title';
    t.textContent = p.winnerLine;
    const s = document.createElement('div');
    s.className = 'recap-finale-sub';
    s.textContent = p.subLine;
    d.appendChild(t); d.appendChild(s);
  } else { // link
    if (p.poster) {
      const img = document.createElement('img');
      img.src = p.poster;
      img.alt = 'Poster';
      img.className = 'recap-poster';
      attachPosterFallback(img, 'recap-poster');
      d.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'recap-poster placeholder';
      d.appendChild(ph);
    }
    const meta = document.createElement('div');
    meta.className = 'recap-meta';
    const who = document.createElement('div');
    who.className = 'recap-who';
    who.textContent = p.playerName;
    const ttl = document.createElement('div');
    ttl.className = 'recap-title';
    ttl.textContent = `${p.title} (${p.year})`;
    meta.appendChild(who); meta.appendChild(ttl);
    d.appendChild(meta);
  }
  return d;
}

export function playRecap(state, mountEl, opts = {}) {
  if (!mountEl) return; // safe no-op (jsdom / missing skeleton)
  const { onDone, prefersReducedMotion } = opts;
  // synchronous & pure — the storyboard does not depend on live state after
  // this line, so later stateUpdates (e.g. the 7s reset) cannot corrupt it.
  const storyboard = buildRecapStoryboard(state);
  const stage = mountEl.querySelector('#recap-stage');
  const skipBtn = mountEl.querySelector('#recap-skip');
  const replayBtn = mountEl.querySelector('#recap-replay');
  const closeBtn = mountEl.querySelector('#recap-close');
  cancelRecap();
  mountEl.classList.remove('hidden');

  const clearStage = () => { while (stage && stage.firstChild) stage.removeChild(stage.firstChild); };
  const renderAll = () => { clearStage(); storyboard.forEach(b => stage && stage.appendChild(beatNode(b))); };
  const settle = (fireDone) => {
    cancelRecap();
    renderAll(); // settled end-state = every beat's final content, no animation
    if (fireDone && onDone) onDone();
  };

  if (closeBtn) closeBtn.onclick = () => { cancelRecap(); mountEl.classList.add('hidden'); };
  if (skipBtn) skipBtn.onclick = () => settle(false);

  // Accessibility-safe: reduced-motion (or unknowable motion preference,
  // handled at the call site) → no animation, instant settled end-state.
  if (prefersReducedMotion) { settle(true); if (replayBtn) replayBtn.onclick = () => start(); return; }

  function start() {
    cancelRecap();
    clearStage();
    let i = 0;
    const tick = () => {
      if (i >= storyboard.length) { _recapTimer = null; if (onDone) onDone(); return; }
      const b = storyboard[i];
      const node = beatNode(b);
      // compositor-only entrance: the .recap-beat base is opacity:0; adding
      // .is-in on the next frame triggers the CSS transform/opacity transition.
      stage && stage.appendChild(node);
      requestAnimationFrame ? requestAnimationFrame(() => node.classList.add('is-in')) : node.classList.add('is-in');
      i++;
      _recapTimer = setTimeout(tick, b.durMs);
    };
    _recapTimer = setTimeout(tick, 200); // small initial beat (mirrors ui-panels)
  }
  if (replayBtn) replayBtn.onclick = () => start();
  start();
}
```

- [ ] **Step 4: Add the additive `#recap-overlay` skeleton to `public/index.html`**

Insert this block immediately AFTER L564 (`</div>` that closes `#share-modal`) and BEFORE L566 (`<!-- HOW TO PLAY MODAL -->`). Pure addition — no existing line changed:

```html

  <!-- PHASE 7.6 — CHAIN PREMIERE RECAP OVERLAY (additive; mirrors #share-modal .modal-overlay) -->
  <div id="recap-overlay" class="modal-overlay recap-overlay hidden" role="dialog" aria-modal="true" aria-label="Chain premiere recap">
    <div class="modal-card recap-card">
      <!-- glyph-only close needs an accessible name (same convention as #close-share-modal) -->
      <button class="btn modal-close" id="recap-close" aria-label="Close recap" title="Close">✕</button>
      <div id="recap-stage" class="recap-stage" aria-live="polite"></div>
      <div class="recap-actions">
        <button id="recap-skip" class="btn btn-secondary">⏭ Skip</button>
        <button id="recap-replay" class="btn btn-primary">↻ Replay</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 5: Append the recap STRUCTURAL CSS to `public/css/04-modals.css`** (append-only at EOF, after L610)

```css

/* =============================================================
   PHASE 7.6 — CHAIN PREMIERE RECAP OVERLAY (append-only)
   WHY: structural rules only, mirroring .share-modal-card so the
   recap reuses the existing .modal-overlay/.modal-card system. NO
   pre-existing rule edited; NO new colour value (existing custom
   props / palette only). Entrance animation lives in
   06-states-anim.css so the existing global reduced-motion handling
   neutralizes it; recap-player.js also JS-short-circuits.
   ============================================================= */
.recap-card {
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.recap-stage {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-height: 60vh;
  overflow-y: auto;
}
.recap-beat {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}
.recap-intro, .recap-skipped, .recap-bridge {
  justify-content: center;
  color: var(--text-secondary);
  font-style: italic;
}
.recap-finale {
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  background: var(--bg-surface);
}
.recap-finale-title { font-size: 1.4rem; font-weight: 700; color: var(--accent); text-align: center; }
.recap-finale-sub { color: var(--text-secondary); }
.recap-poster {
  width: 46px;
  height: 69px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.recap-poster.placeholder { background: var(--bg-base); }
.recap-meta { display: flex; flex-direction: column; min-width: 0; }
.recap-who { font-weight: 600; }
.recap-title { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.recap-actions { display: flex; gap: 0.75rem; }
.recap-actions .btn-primary, .recap-actions .btn-secondary { flex: 1; }
```

> If a referenced custom prop (e.g. `--bg-elevated`, `--bg-base`, `--text-secondary`, `--accent`, `--radius-sm`) does not exist at the branch base, the implementer MUST substitute the nearest EXISTING token used elsewhere in `04-modals.css` (verify with a grep of the partials) — **no new colour value may be introduced** (spec G5). Pin the substitutions in the commit body.

- [ ] **Step 6: Append the recap entrance animation to `public/css/06-states-anim.css`** (append-only at EOF, after L1214)

```css

/* =============================================================
   PHASE 7.6 — CHAIN PREMIERE RECAP entrance (append-only)
   WHY: compositor-only (transform + opacity) so it is GPU-cheap on
   the vanilla no-build mobile stack and the EXISTING global
   prefers-reduced-motion handling (see the comment at :409-412 —
   "global media query already zeroes the animation-duration")
   neutralizes it with NO new @media. recap-player.js ALSO
   JS-short-circuits to the instant settled end-state under
   reduced-motion (belt-and-suspenders, spec §1.8).
   ============================================================= */
.recap-beat {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.34s ease, transform 0.34s cubic-bezier(0.2, 0.75, 0.25, 1);
}
.recap-beat.is-in {
  opacity: 1;
  transform: translateY(0);
}
```

- [ ] **Step 7: Wire the one-shot in `public/js/socketClient.js`**

(7a) Add `playRecap` to the `./ui.js` import block (L11–24). Change the line that currently reads `openShareModal, showGameOverBanner, resetMobileTab,` (L14) to add `playRecap`:

```js
  openShareModal, showGameOverBanner, resetMobileTab, playRecap,
```

(7b) Immediately AFTER the Daily block's closing `}` (currently L499) and BEFORE the `}` that closes the `else if (state.status === 'finished')` branch (currently L500), insert:

```js

      // Phase 7.6: cinematic Chain Premiere Recap. One-shot on the SAME
      // playing→finished edge the Daily modal uses (justFinished is itself
      // the guard — re-fired stateUpdates have prevState.status==='finished',
      // so this never replays — exactly the Daily-modal precedent above).
      // Daily-suppressed: the Daily-result modal already owns end-of-game in
      // Daily (its own ▶ Replay); two competing end overlays would be a UX +
      // contract risk (spec §1.6). showGameOverBanner (rendered by renderGame
      // above, L439) is byte-identical and present underneath whether or not
      // this plays — the overlay is purely additive.
      if (justFinished && !getIsDaily()) {
        const recapOverlay = document.getElementById('recap-overlay');
        // Accessibility-safe: if motion preference is unreadable (no
        // matchMedia, e.g. jsdom) OR reduced-motion is preferred → skip the
        // animation and show the settled end-state instantly (spec §1.8).
        const prefersReducedMotion = !window.matchMedia
          || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        playRecap(state, recapOverlay, { prefersReducedMotion });
      }
```

This is the **only** `socketClient.js` change. `ui-render.js` is **not touched**.

- [ ] **Step 8: Run the new test, then the full suite**

Run: `cd C:/mm-phase7-6 && npx jest client-tests/recap-player.test.js` → PASS.
Run: `cd C:/mm-phase7-6 && npx jest` → all green (57 suites: 55 base + chain-recap + recap-player).

- [ ] **Step 9: Diff-gate (the §5 ratchet proof)**

```bash
cd C:/mm-phase7-6 && git diff ed6f041 -- public/js/ui/ui-render.js   # MUST be EMPTY
cd C:/mm-phase7-6 && git diff ed6f041 -- public/css/04-modals.css public/css/06-states-anim.css   # ONLY trailing appended hunks
cd C:/mm-phase7-6 && git diff ed6f041 -- public/index.html           # ONLY the additive #recap-overlay block
cd C:/mm-phase7-6 && git diff ed6f041 -- public/js/socketClient.js   # ONLY the import addition + the one block
cd C:/mm-phase7-6 && git diff ed6f041 -- server/   # MUST be EMPTY
```

- [ ] **Step 10: Branch-verify then commit**

```bash
cd C:/mm-phase7-6 && test "$(git branch --show-current)" = "phase7-6-chain-premiere-recap" \
  && git add public/js/ui/recap-player.js public/index.html public/css/04-modals.css public/css/06-states-anim.css public/js/socketClient.js client-tests/recap-player.test.js \
  && git -c commit.gpgsign=false commit -m "Phase 7.6 (1): recap overlay driver + one-shot Daily-suppressed wiring

recap-player.js (thin DOM driver: storyboard→#recap-overlay via the
ui-panels setTimeout-chain, Skip/Replay/Close, leak-safe cancellable,
reduced-motion instant-settle, attachPosterFallback). Additive
#recap-overlay sibling in index.html. Append-only recap CSS (04-modals
structural + 06-states-anim compositor-only entrance; existing global
reduced-motion neutralizes). One Daily-suppressed one-shot block in
socketClient.js. ui-render.js byte-identical; server/** untouched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["public/js/ui/recap-player.js", "public/index.html", "public/css/04-modals.css", "public/css/06-states-anim.css", "public/js/socketClient.js", "client-tests/recap-player.test.js"], "verifyCommand": "cd C:/mm-phase7-6 && npx jest client-tests/recap-player.test.js && cd C:/mm-phase7-6 && npx jest", "acceptanceCriteria": ["playRecap builds storyboard sync, renders into #recap-overlay, removes hidden", "prefersReducedMotion → instant settled end-state + onDone, no timer", "animated path = single cancellable setTimeout chain; cancelRecap leak-safe", "#recap-skip→settled, #recap-replay→restart, #recap-close→hide; posters via attachPosterFallback", "wiring fires once on justFinished && !getIsDaily(); never Daily; never on re-render", "ui-render.js byte-identical vs ed6f041; socketClient.js = import add + one block only; CSS append-only no new @media/colour; index.html additive sibling only", "render-chain/socket-handlers/showScreen/lobby suites/server/** byte-identical & green; full npx jest green"]}
```

---

## Task 2: Focused Share Cards 2.0 (blockedBy [1])

**Goal:** Add the spoiler-free emoji grid + "I survived N links" line to the existing share card (canvas + text recap), additively — existing `ui-sharecard.js` exports byte-stable, `#share-modal` markup + Share button + modal wiring unchanged.

**Files:**
- Modify: `public/js/ui/ui-sharecard.js` (add `buildEmojiGrid` + `survivedLine`; additive draws in `generateShareCard`; additive lines in `buildTextRecap`)
- Test: `client-tests/sharecard.test.js` (create)

**Acceptance Criteria:**
- [ ] `buildEmojiGrid(state)` (new pure export) → a string of one emoji per **curated** entry: seed→🎬, last(len>1)→🏁, spicy (`scoreChainEntry >= 5`)→🔥, else 🟦; appends ` +N` iff `selectChainEntries().skipped>0`. Contains **no** titles, player names, or identifiers.
- [ ] `survivedLine(state)` (new pure export) → `🔗 I survived ${n} links` where `n = state.chain.length` (first-person, integer-only — no name/identifier).
- [ ] `buildTextRecap(state)` output additively includes the emoji grid line and the survived line, AND still contains every original line (header, per-link lines, winner line, `Play at …`).
- [ ] `generateShareCard` still returns a canvas; the emoji grid + survived line are drawn additively reusing the existing `COLORS` (no new colour value); no existing draw removed.
- [ ] `selectChainEntries`/`scoreChainEntry`/`openShareModal`/`truncate`/`roundRect`/`generateShareCard`/`buildTextRecap` all still exported (byte-stable surface); `#share-modal` markup + Share/Download/Copy wiring untouched.
- [ ] Zero-identity sentinel: a stableId-carrying fixture produces an emoji grid + survived line with no `stableId`/socket id. Full `cd C:/mm-phase7-6 && npx jest` green.

**Verify:** `cd C:/mm-phase7-6 && npx jest client-tests/sharecard.test.js` → PASS; then `cd C:/mm-phase7-6 && npx jest` → all green; then `git -C C:/mm-phase7-6 diff ed6f041 -- public/index.html` shows no `#share-modal` change beyond Task 1's sibling, and the `ui-sharecard.js` diff is additive-only.

**Steps:**

- [ ] **Step 1: Write the failing test** — `client-tests/sharecard.test.js`

```js
// client-tests/sharecard.test.js — Phase 7.6 Task 2 (focused Share 2.0)
// WHY: ui-sharecard.js has no pre-existing unit suite; this NEW suite pins
// the additive Share 2.0 surface (spoiler-free emoji grid + survived line),
// the zero-identity invariant, and that the existing public exports + text
// recap remain byte-stable (additive only).
/** @jest-environment jsdom */
const sc = require('../public/js/ui/ui-sharecard.js');

function link(idx, over = {}) {
  return {
    playerName: `Player ${idx}`,
    stableId: `SECRET_${idx}`,
    movie: { title: `Title ${idx}`, year: 2000 + idx, poster: '', mediaType: 'movie', cast: [{ name: `Actor ${idx}` }] },
    matchedActors: idx === 0 ? [] : [`Actor ${idx}`],
    ...over,
  };
}
const chainOf = n => Array.from({ length: n }, (_, i) => link(i));

describe('buildEmojiGrid — spoiler-free & zero-identity', () => {
  test('one emoji per curated entry; seed 🎬 and last 🏁', () => {
    const g = sc.buildEmojiGrid({ gameMode: 'classic', chain: chainOf(4), winner: null });
    const glyphs = [...g.split(' ')[0]]; // strip any " +N" suffix
    // 4 entries ≤7 → 4 glyphs, first 🎬, last 🏁
    expect([...g].slice(0, 2).join('')).toBe('🎬');
    expect(g.includes('🏁')).toBe(true);
    expect(g).not.toMatch(/Title|Player|SECRET_|stableId/);
  });
  test('long chain → +N suffix equals skipped count', () => {
    const g = sc.buildEmojiGrid({ gameMode: 'classic', chain: chainOf(12), winner: null });
    expect(g).toMatch(/\+5$/); // 12 - 7 curated = 5
  });
});

describe('survivedLine', () => {
  test('first-person, integer-only, no identifier', () => {
    const s = sc.survivedLine({ gameMode: 'classic', chain: chainOf(6), winner: { name: 'Ann' } });
    expect(s).toBe('🔗 I survived 6 links');
    expect(s).not.toMatch(/SECRET_|stableId|Ann/);
  });
});

describe('buildTextRecap — additive (existing content preserved)', () => {
  test('still has header, per-link, winner, Play-at AND the new grid + survived lines', () => {
    const state = { gameMode: 'classic', chain: chainOf(3), winner: { name: 'Ann', score: 9 } };
    const t = sc.buildTextRecap(state);
    expect(t).toContain('🎬 MovieMatch');
    expect(t).toContain('Chain of 3 connections:');
    expect(t).toContain('1. Player 0 → Title 0 (2000)');
    expect(t).toContain('🏆 Ann wins with 9 pts!');
    expect(t).toContain('Play at ');
    // additive 2.0:
    expect(t).toContain(sc.buildEmojiGrid(state));
    expect(t).toContain(sc.survivedLine(state));
  });
});

describe('byte-stable public surface', () => {
  test('all pre-7.6 exports still present', () => {
    ['generateShareCard', 'buildTextRecap', 'openShareModal', 'truncate', 'roundRect', 'selectChainEntries', 'scoreChainEntry']
      .forEach(name => expect(typeof sc[name]).toBe('function'));
  });
  test('generateShareCard still returns a canvas (additive draws do not throw)', () => {
    const canvas = sc.generateShareCard({ gameMode: 'classic', chain: chainOf(3), winner: { name: 'Ann', score: 9 } });
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(720);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/mm-phase7-6 && npx jest client-tests/sharecard.test.js`
Expected: FAIL — `sc.buildEmojiGrid is not a function`.

- [ ] **Step 3: Add `buildEmojiGrid` + `survivedLine` to `public/js/ui/ui-sharecard.js`**

Add these two exports (e.g. immediately before `export function buildTextRecap`):

```js
// Phase 7.6 Share 2.0: spoiler-free result strip — one emoji per CURATED
// chain entry, encoding the same signal scoreChainEntry already computes.
// WHY: shareable like a Framed/Wordle grid WITHOUT leaking titles or any
// identifier (zero-identity — the Phase-1 daily-leaderboard security
// invariant). Reuses the relocated selectChainEntries/scoreChainEntry.
export function buildEmojiGrid(state) {
  const chain = Array.isArray(state && state.chain) ? state.chain : [];
  const { entries, skipped } = selectChainEntries(chain);
  const lastIdx = chain.length - 1;
  const glyphs = entries.map((e) => {
    if (e._idx === 0) return '🎬';
    if (e._idx === lastIdx && chain.length > 1) return '🏁';
    // "spicy" link: a high cross-media / deep-cast / era-jump score.
    return scoreChainEntry(e, e._idx, chain) >= 5 ? '🔥' : '🟦';
  }).join('');
  return skipped > 0 ? `${glyphs} +${skipped}` : glyphs;
}

// Phase 7.6 Share 2.0: first-person, integer-only "survived" line. WHY:
// no name/identifier (zero-identity); a personal, shareable badge of the
// chain length the player reached.
export function survivedLine(state) {
  const n = Array.isArray(state && state.chain) ? state.chain.length : 0;
  return `🔗 I survived ${n} links`;
}
```

- [ ] **Step 4: Additively append the two lines in `buildTextRecap`**

In `buildTextRecap`, immediately BEFORE the `const siteUrl = …` line (the existing `Play at` block), insert (no existing line removed/changed):

```js
    // Phase 7.6 Share 2.0: additive spoiler-free grid + survived badge.
    lines.push(`\n${buildEmojiGrid(state)}`);
    lines.push(survivedLine(state));
```

- [ ] **Step 5: Additively draw them on the canvas in `generateShareCard`**

In `generateShareCard`, immediately AFTER the existing winner/solo/game-over billing block and BEFORE the footer-gradient block (the `const footerGrad = …`), insert (additive draws only — reuse the existing `COLORS`, no new colour):

```js
    // Phase 7.6 Share 2.0: additive spoiler-free emoji strip + survived
    // badge above the footer. Reuses the existing COLORS (no new colour
    // value) and the existing layout math (winnerY) — purely additive.
    ctx.font = '20px sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.fillText(buildEmojiGrid(state), W / 2, winnerY + 92);
    ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(survivedLine(state), W / 2, winnerY + 116);
```

> If `winnerY + 116` collides with the existing footer at the branch base (verify against the read `generateShareCard` body — footer starts at `H - 48`, winnerY = `Math.max(y+20, H-140)`, so `winnerY+116` ≤ `H-24` worst case — clears the `H-48` footer band only if `winnerY ≤ H-140`; when the chain is long `winnerY` can be larger), the implementer MUST place the strip where it does not overdraw the footer URL — the binding constraint is *additive, legible, no existing draw removed*; the exact y-offsets may be adjusted and pinned in the commit body. Canvas pixels are not unit-tested (no pre-existing pixel test; the visual is the user-side eyeball, spec §9.7) — the test asserts the canvas is returned and the string builders are correct.

- [ ] **Step 6: Run the new test, then the full suite**

Run: `cd C:/mm-phase7-6 && npx jest client-tests/sharecard.test.js` → PASS.
Run: `cd C:/mm-phase7-6 && npx jest` → all green (58 suites: 55 base + chain-recap + recap-player + sharecard).

- [ ] **Step 7: Diff-gate**

```bash
cd C:/mm-phase7-6 && git diff ed6f041 -- public/js/ui/ui-sharecard.js   # Task0 relocation + Task2 additive only (no behaviour removed)
cd C:/mm-phase7-6 && git diff ed6f041 -- public/index.html             # ONLY Task 1's #recap-overlay sibling (no #share-modal change)
cd C:/mm-phase7-6 && git diff ed6f041 -- server/                        # MUST be EMPTY
```

- [ ] **Step 8: Branch-verify then commit**

```bash
cd C:/mm-phase7-6 && test "$(git branch --show-current)" = "phase7-6-chain-premiere-recap" \
  && git add public/js/ui/ui-sharecard.js client-tests/sharecard.test.js \
  && git -c commit.gpgsign=false commit -m "Phase 7.6 (2): focused Share Cards 2.0 — emoji grid + survived line

Additive buildEmojiGrid (spoiler-free, scoreChainEntry signal, no
titles/identifiers) + survivedLine (first-person, integer-only) on the
existing canvas + buildTextRecap. Existing ui-sharecard.js exports
byte-stable; #share-modal markup + Share/Download/Copy wiring unchanged;
server/** untouched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["public/js/ui/ui-sharecard.js", "client-tests/sharecard.test.js"], "verifyCommand": "cd C:/mm-phase7-6 && npx jest client-tests/sharecard.test.js && cd C:/mm-phase7-6 && npx jest", "acceptanceCriteria": ["buildEmojiGrid: one emoji/curated entry (seed🎬/last🏁/spicy🔥/else🟦) + ' +N' iff skipped; no titles/names/identifiers", "survivedLine: '🔗 I survived N links', first-person integer-only, no identifier", "buildTextRecap additively includes grid+survived AND all original lines", "generateShareCard still returns the 600x720 canvas; additive draws reuse COLORS (no new colour); no existing draw removed", "all pre-7.6 exports still present (byte-stable surface); #share-modal markup + Share/Download/Copy wiring unchanged", "zero-identity sentinel green; server/** untouched; full npx jest green"]}
```

---

## Self-Review

**1. Spec coverage:** §1.1 pure engine → T0. §1.2 dedicated overlay → T1 `#recap-overlay`. §1.3 banner byte-identical → T1 (ui-render.js zero-change, diff-gate). §1.4 fail-soft elimination → T0 (best-effort hook + both-way tests). §1.5 zero-identity → T0/T2 sentinels. §1.6 Daily-suppressed → T1 wiring `!getIsDaily()`. §1.7 client-only → all (server/** diff-gate EMPTY). §1.8 perf budget → T0 (≤13000 test) + T1 (compositor CSS + JS short-circuit). §3.1 beat schema → T0. §3.2 DRY relocation + byte-stable surface → T0. §3.3 driver → T1. §3.3.1 one-shot wiring → T1. §3.4 focused Share 2.0 → T2. §4 behavioural-equivalence → T0 finale-parity + T1 banner-untouched. §5 ratchet → T1/T2 diff-gates. §8 G1–G8 → covered across T0–T2 acceptance. §9 acceptance → the per-task Acceptance Criteria + Verify. **No gap.**

**2. Placeholder scan:** No "TBD/TODO/implement later". The two ">" notes (CSS custom-prop substitution; canvas y-offset) are explicit conditional instructions with a binding constraint + a verification step, not placeholders — they exist because exact pixel/token values must be confirmed against the branch base, and the rule for resolving them is fully specified.

**3. Type consistency:** `buildRecapStoryboard`, `selectChainEntries`, `scoreChainEntry` (T0) are the exact names imported in T1/T2. Beat `{type,index,atMs,durMs,payload}` is consistent across T0 producer ↔ T1 `beatNode`. `playRecap(state,mountEl,{prefersReducedMotion,onDone})` / `cancelRecap()` consistent T1 module ↔ test ↔ socketClient wiring. `buildEmojiGrid(state)`/`survivedLine(state)` consistent T2 ↔ tests ↔ `buildTextRecap`. `#recap-overlay`/`#recap-stage`/`#recap-skip`/`#recap-replay`/`#recap-close` consistent index.html ↔ recap-player ↔ test ↔ CSS. Verified.

---

## Pipeline

subagent-driven-development: per-task implementer (sonnet, TDD red→green, WHY comments, branch-verify before every commit) → spec-compliance review (sonnet, verify by reading code) + real fix-loop → code-quality review (sonnet) + real fix-loop → mark complete + sync `.tasks.json` (own follow-up commit) → next task. Then final **opus** whole-branch holistic — GO bar = every §5 byte-identical surface provably empty-diff (`ui-render.js`, `server/**`, lobby suites, `render-chain`/`socket-handlers`/`showScreen`), G1–G8 evidenced, client/engine reuse-seam clean, full `cd C:/mm-phase7-6 && npx jest` green, §9 acceptance met; NO-GO → real fix-loop + opus re-review until GO → finishing-a-development-branch **Option 2** (push + `gh pr create --base main`; PR-merge/Render-deploy classifier-gated → handed to the user; worktree PRESERVED until the user merges; post-merge reconcile owed mirroring 7.1–7.5.2).
