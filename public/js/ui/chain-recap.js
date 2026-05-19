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
