// ui/ui-panels.js — animated chain replay, my-stats modal, and daily-result modal.
// WHY: these three "result panel" features share a post-game context and are
// larger self-contained rendering blocks; grouping them frees ui-render.js
// from the display-only result screens and makes each panel easy to find.

// Import audio helper — playChainReplay emits a beat sound per chain entry.
import { playSfx } from '../utils.js';
// Import showToast — renderDailyResult's share button confirms copy via toast.
import { showToast } from './ui-notifications.js';
// Import attachPosterFallback — the replay panel builds its own poster
// <img>s; without this a broken/404 TMDB poster shows the native
// broken-image glyph instead of the designed placeholder (the chain
// board and autocomplete already use this shared ui-dom helper).
import { attachPosterFallback } from './ui-dom.js';
// Phase 7.3 (MI-02): the daily prompt is now the shared modal factory.
// Direct sibling imports (not the ./ui.js barrel) keep a one-way DAG —
// modal.js imports nothing, name-prompts.js imports nothing — so there is
// no barrel cycle (same discipline as 7.2's feedback.js).
import { createPromptModal } from './modal.js';
import { buildDailyPromptConfig } from './name-prompts.js';
// Phase 7.4 (Daily ritual): direct sibling import — daily-ritual.js imports
// nothing, so this keeps the one-way module DAG (no ./ui.js barrel cycle),
// the same discipline as the 7.3 modal imports above.
import { formatResetCountdown, computeDailyStreak, readDailyStreak, writeDailyStreak } from './daily-ritual.js';

// Phase 7.4: the single live daily-reset countdown interval id (see
// renderDailyResult). Module-scoped so a re-open can hard-clear any prior
// one — bounding the app to at most ONE such interval, ever.
let _dailyCountdownTimer = null;

// =========================================================================
// ANIMATED CHAIN REPLAY (L2)
// =========================================================================
// Re-renders a chain one entry at a time into `container`, with a sound
// beat on each new entry. Self-contained — doesn't depend on the global
// gameState or live render path. Reused by the daily-result modal "▶
// Replay" button (and a candidate for the post-game share modal in a
// future iteration).
//
// Long chains are capped at MAX_REPLAY_ENTRIES so a 30-link daily run
// doesn't take 21 seconds to replay; entries beyond the cap are dropped
// from the visible animation but a "+N more" footer flags the omission.

const MAX_REPLAY_ENTRIES = 14;
const REPLAY_STEP_MS = 600;

export function playChainReplay(container, chain, options = {}) {
  if (!container || !Array.isArray(chain) || chain.length === 0) return;
  // Reduced motion: short-circuit to a static render. Animating one beat
  // per entry over several seconds is exactly the kind of long decorative
  // sequence reduced-motion users want suppressed.
  const reduced = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stepMs = options.stepMs || REPLAY_STEP_MS;
  const maxEntries = options.maxEntries || MAX_REPLAY_ENTRIES;
  const onComplete = typeof options.onComplete === 'function' ? options.onComplete : null;

  // Take the most recent N entries — players care more about the moves
  // they just made than the ones at the start of a long chain.
  const tail = chain.slice(-maxEntries);
  const skipped = chain.length - tail.length;

  container.textContent = '';

  if (skipped > 0) {
    const note = document.createElement('div');
    note.className = 'replay-skipped-note';
    note.textContent = `+${skipped} earlier connection${skipped === 1 ? '' : 's'}…`;
    container.appendChild(note);
  }

  // Reduced-motion: render everything immediately, no per-beat sound.
  if (reduced) {
    tail.forEach((item, i) => container.appendChild(_buildReplayEntry(item, i, tail)));
    if (onComplete) onComplete();
    return;
  }

  let i = 0;
  const tick = () => {
    if (i >= tail.length) {
      if (onComplete) onComplete();
      return;
    }
    container.appendChild(_buildReplayEntry(tail[i], i, tail));
    // Each beat: short success ding. Skip on the very first entry so the
    // replay starts visually before audio kicks in (less jarring).
    if (i > 0) playSfx('success');
    i++;
    setTimeout(tick, stepMs);
  };
  // Tiny initial delay so the user has time to register the modal opening
  // before the first entry pops in.
  setTimeout(tick, 200);
}

// Build a single replay-entry DOM node. Uses the same shape as the live
// chain renderer (poster + title + cast) but with a `.replay-entry` class
// so CSS can give it a fade-in animation and a slightly tighter layout.
// T5d ESLint: trailing `allItems` param is unused — prefixed with _ to mark it
// intentionally-unused (kept positionally for call-site/signature parity).
function _buildReplayEntry(item, index, _allItems) {
  const div = document.createElement('div');
  div.className = 'chain-item replay-entry';
  if (index > 0) div.classList.add('shared-highlight');

  // Poster
  if (item.movie && item.movie.poster && item.movie.poster.startsWith('https://image.tmdb.org/')) {
    const img = document.createElement('img');
    img.src = item.movie.poster;
    img.alt = 'Poster';
    img.className = 'chain-poster';
    // Swap to the designed placeholder if the poster fails to load —
    // matches renderChainItems / renderAutocompleteResults so all three
    // poster sites degrade identically (was the only one missing this).
    attachPosterFallback(img, 'chain-poster');
    div.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'chain-poster placeholder';
    div.appendChild(placeholder);
  }

  const content = document.createElement('div');
  content.className = 'chain-content';

  // Player or seed label
  const playerNameDiv = document.createElement('div');
  playerNameDiv.className = 'player-name';
  playerNameDiv.textContent = item.playerName || 'Player';
  content.appendChild(playerNameDiv);

  // Title + year
  const titleDiv = document.createElement('div');
  titleDiv.className = 'movie-title';
  titleDiv.appendChild(document.createTextNode((item.movie?.title || 'Unknown') + ' '));
  const yearSpan = document.createElement('span');
  yearSpan.className = 'year';
  yearSpan.textContent = '(' + (item.movie?.year || '?') + ')';
  titleDiv.appendChild(yearSpan);
  content.appendChild(titleDiv);

  // Connecting actor — for entries past index 0, surface the matched
  // actor as a single line so the replay shows the connection logic
  // beat by beat rather than the player having to scan two cast lists.
  if (index > 0 && Array.isArray(item.matchedActors) && item.matchedActors.length > 0) {
    const conn = document.createElement('div');
    conn.className = 'replay-connector';
    conn.textContent = '↔ via ' + item.matchedActors[0];
    content.appendChild(conn);
  }

  div.appendChild(content);
  return div;
}

// =========================================================================
// MY STATS MODAL (H5)
// =========================================================================
// Renders the player's lifetime stats into the #my-stats-modal body.
// Pure function of the stats payload — no DOM ownership beyond the body
// element it's pointed at. All text is inserted via DOM APIs (textContent
// / createElement) so a future stableId-tied display name with crafted
// characters can't get HTML-injected into the page.

const MODE_LABELS = {
  classic: '⚔️ Classic',
  team: '🤝 Team',
  solo: '👤 Solo',
  speed: '⚡ Speed',
  daily: '🗓️ Daily',
};

export function renderMyStats(stats, opts) {
  const modal = document.getElementById('my-stats-modal');
  const body = document.getElementById('my-stats-body');
  const sub = document.getElementById('my-stats-subtitle');
  if (!modal || !body || !sub) return;

  body.textContent = '';
  const isEmpty = !stats || stats.gamesPlayed === 0;
  sub.textContent = isEmpty
    ? 'Play a few games to start tracking your numbers.'
    : 'Lifetime — last 90 days';

  // Empty-state — no plays yet. Shorter, encouraging copy instead of a
  // sea of zeroes.
  if (isEmpty) {
    // Phase 7.10 — DS-01 pass 2: padding override moved to .empty-hint--lg
    // modifier in 03-game.css; existing .empty-hint rule covers the rest.
    const empty = document.createElement('div');
    empty.className = 'empty-hint empty-hint--lg';
    empty.textContent = "No stats yet — your first game will start your record.";
    body.appendChild(empty);
    modal.classList.remove('hidden');
    return;
  }

  // Hero numbers row: gamesPlayed, wins, longestChain, totalPlays.
  // Compact 4-up grid that collapses to 2x2 on phones via CSS.
  const heroGrid = document.createElement('div');
  heroGrid.className = 'stats-hero-grid';
  const heroEntries = [
    { label: 'Games', value: stats.gamesPlayed },
    { label: 'Wins',  value: stats.wins },
    { label: 'Longest chain', value: stats.longestChain },
    { label: 'Plays', value: stats.totalPlays },
  ];
  heroEntries.forEach(e => {
    const card = document.createElement('div');
    card.className = 'stats-hero-card';
    const num = document.createElement('div');
    num.className = 'stats-hero-num';
    num.textContent = String(e.value | 0);
    const lbl = document.createElement('div');
    lbl.className = 'stats-hero-label';
    lbl.textContent = e.label;
    card.appendChild(num);
    card.appendChild(lbl);
    heroGrid.appendChild(card);
  });
  body.appendChild(heroGrid);

  // Win-rate readout (just below the hero grid). Shown only when the
  // player has played at least one game so we don't render "NaN%".
  if (stats.gamesPlayed > 0) {
    const winrate = Math.round((stats.wins / stats.gamesPlayed) * 100);
    const wr = document.createElement('div');
    wr.className = 'stats-winrate';
    wr.textContent = `Win rate: ${winrate}%`;
    body.appendChild(wr);
  }

  // By-mode breakdown — only show modes the player has actually touched.
  // Shows played / won / longest per mode. Modes are rendered in the
  // canonical order (classic, team, solo, speed, daily) regardless of
  // which the player has touched, so the layout is predictable.
  const modesPlayed = Object.entries(stats.byMode || {})
    .filter(([, v]) => (v.played | 0) > 0);
  if (modesPlayed.length > 0) {
    const header = document.createElement('div');
    header.className = 'stats-section-header';
    header.textContent = 'By mode';
    body.appendChild(header);

    const table = document.createElement('div');
    table.className = 'stats-mode-table';
    // Column headers
    ['Mode', 'Played', 'Won', 'Longest'].forEach(t => {
      const h = document.createElement('div');
      h.className = 'stats-mode-th';
      h.textContent = t;
      table.appendChild(h);
    });
    const order = ['classic', 'team', 'solo', 'speed', 'daily'];
    order.forEach(mode => {
      const v = stats.byMode[mode];
      if (!v || (v.played | 0) === 0) return;
      const cells = [
        MODE_LABELS[mode] || mode,
        String(v.played | 0),
        String(v.won | 0),
        String(v.longestChain | 0),
      ];
      cells.forEach((text, i) => {
        const c = document.createElement('div');
        c.className = 'stats-mode-td' + (i === 0 ? ' stats-mode-td--label' : '');
        c.textContent = text;
        table.appendChild(c);
      });
    });
    body.appendChild(table);
  }

  // Favorite connector callout — only shown when we have one. Most fun
  // single-line in the modal because it's specific to the player's history.
  if (stats.favoriteConnector && stats.favoriteConnector.name) {
    const fav = document.createElement('div');
    fav.className = 'stats-favorite';
    const tag = document.createElement('span');
    tag.className = 'stats-favorite-label';
    tag.textContent = '⭐ Most-used connector: ';
    const name = document.createElement('strong');
    name.textContent = stats.favoriteConnector.name;
    const count = document.createElement('span');
    count.className = 'stats-favorite-count';
    count.textContent = ` (${stats.favoriteConnector.count | 0}×)`;
    fav.appendChild(tag);
    fav.appendChild(name);
    fav.appendChild(count);
    body.appendChild(fav);
  }

  // Phase 6b — Titles wall. Rendered from the server-enriched payload
  // (stats.achievements = { catalog, earned }) + stats.equippedTitle. Gated:
  // a legacy myStats payload without `achievements` renders the pre-6b modal
  // unchanged (existing renderMyStats tests pass no achievements).
  if (stats && stats.achievements && Array.isArray(stats.achievements.catalog)) {
    const onEquip = (opts && typeof opts.onEquip === 'function') ? opts.onEquip : null;
    const earnedSet = new Set(stats.achievements.earned || []);
    const equippedId = stats.equippedTitle || null;

    // "New" flag: ids earned since the player last opened the wall. Device-local
    // only (no server involvement); wrapped because localStorage can throw.
    let seen = [];
    try { seen = JSON.parse(window.localStorage.getItem('mm_seen_titles') || '[]'); } catch {}
    const seenSet = new Set(Array.isArray(seen) ? seen : []);

    const section = document.createElement('div');
    section.className = 'achievements-wall';
    const heading = document.createElement('div');
    heading.className = 'achievements-heading';
    heading.textContent = 'Titles';
    section.appendChild(heading);

    stats.achievements.catalog.forEach(a => {
      const earned = earnedSet.has(a.id);
      const equipped = equippedId === a.id;
      const row = document.createElement('div');
      row.className = 'achievement-row'
        + (earned ? ' is-earned' : ' is-locked')
        + (equipped ? ' is-equipped' : '');

      const text = document.createElement('div');
      text.className = 'achievement-text';
      const name = document.createElement('div');
      name.className = 'achievement-name';
      name.textContent = a.title;
      // "New" marker for a freshly-earned, not-yet-seen title.
      if (earned && !seenSet.has(a.id)) {
        const nu = document.createElement('span');
        nu.className = 'achievement-new';
        nu.textContent = '✦ New';
        name.appendChild(nu);
      }
      const desc = document.createElement('div');
      desc.className = 'achievement-desc';
      desc.textContent = a.description;
      text.appendChild(name);
      text.appendChild(desc);
      row.appendChild(text);

      // Earned rows get an equip affordance; the equipped row shows a static
      // "Equipped" marker instead of a button.
      if (earned) {
        if (equipped) {
          const badge = document.createElement('span');
          badge.className = 'achievement-equipped-badge';
          badge.textContent = 'Equipped';
          row.appendChild(badge);
        } else {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn achievement-equip';
          btn.textContent = 'Equip';
          if (onEquip) btn.addEventListener('click', () => onEquip(a.id));
          row.appendChild(btn);
        }
      }
      section.appendChild(row);
    });
    body.appendChild(section);

    // Mark all currently-earned titles as seen for the next open.
    try { window.localStorage.setItem('mm_seen_titles', JSON.stringify([...earnedSet])); } catch {}
  }

  modal.classList.remove('hidden');
}

// =========================================================================
// DAILY CHALLENGE RESULT MODAL (H2)
// =========================================================================
// Single render path used by both the "you already played today" view and
// the post-game result view. The two cases differ only in the title/copy
// and whether the share button is wired — handled inline below via flags
// on the `data` argument.

export function renderDailyResult(data) {
  // Defensive: bail silently if the modal markup isn't present (e.g. during
  // tests where index.html isn't loaded). Production always has it.
  const modal = document.getElementById('daily-result-modal');
  if (!modal) return;

  const titleEl = document.getElementById('daily-result-title');
  const subEl = document.getElementById('daily-result-subtitle');
  const bodyEl = document.getElementById('daily-result-body');
  const shareBtn = document.getElementById('daily-result-share-btn');
  if (!titleEl || !subEl || !bodyEl || !shareBtn) return;

  // Phase 7.4: a previous open may have left the countdown interval running
  // (e.g. closed via the ✕ global handler). Hard-clear it here so re-opening
  // never stacks intervals — at most one is ever live.
  clearInterval(_dailyCountdownTimer);
  _dailyCountdownTimer = null;

  const isAlreadyPlayed = !!data.alreadyPlayed;
  const puzzleNumber = data.puzzleNumber || 1;
  const date = data.date || '';
  const chainLength = Math.max(0, data.chainLength | 0);

  titleEl.textContent = `🗓️ Daily Challenge #${puzzleNumber}`;
  subEl.textContent = isAlreadyPlayed
    ? `You already played today — come back tomorrow for a new puzzle.`
    : `${chainLength === 0 ? 'No moves connected' : `Chain of ${chainLength}`}${date ? ' — ' + date : ''}`;

  // Build body: score readout + leaderboard table. Use DOM APIs (not
  // innerHTML interpolation) so a future leaderboard entry with crafted
  // characters can't get HTML-injected.
  bodyEl.textContent = '';

  // Big score badge.
  const scoreCard = document.createElement('div');
  scoreCard.className = 'daily-score-card';
  const scoreNum = document.createElement('div');
  scoreNum.className = 'daily-score-num';
  scoreNum.textContent = String(chainLength);
  const scoreLabel = document.createElement('div');
  scoreLabel.className = 'daily-score-label';
  scoreLabel.textContent = chainLength === 1 ? 'connection' : 'connections';
  scoreCard.appendChild(scoreNum);
  scoreCard.appendChild(scoreLabel);
  bodyEl.appendChild(scoreCard);

  // L2: Replay-chain panel + button. Only shown when we have the chain
  // (post-game flow has it via the cached state; "already played today"
  // path doesn't and skips this section). Button is rendered inside the
  // body so it sits between the score and the leaderboard — players see
  // their result first, can replay it, then see how they ranked.
  if (Array.isArray(data.chain) && data.chain.length > 0) {
    const replayWrap = document.createElement('div');
    replayWrap.className = 'daily-replay-wrap';

    const replayBtn = document.createElement('button');
    replayBtn.type = 'button';
    // Phase 4: .btn additive base (cursor:pointer already on btn-secondary); zero visual change.
    replayBtn.className = 'btn btn-secondary daily-replay-btn';
    replayBtn.textContent = '▶ Replay your chain';

    const replayContainer = document.createElement('div');
    replayContainer.className = 'daily-replay-container';

    replayBtn.addEventListener('click', () => {
      // Disable while playing to prevent accidental restarts mid-replay.
      replayBtn.disabled = true;
      replayBtn.textContent = 'Replaying…';
      playChainReplay(replayContainer, data.chain, {
        onComplete: () => {
          replayBtn.disabled = false;
          replayBtn.textContent = '▶ Replay again';
        },
      });
    });

    replayWrap.appendChild(replayBtn);
    replayWrap.appendChild(replayContainer);
    bodyEl.appendChild(replayWrap);
  }

  // Leaderboard. Empty array → "Be the first!" hint.
  const lbHeader = document.createElement('div');
  lbHeader.className = 'daily-lb-header';
  lbHeader.textContent = "Today's leaderboard";
  bodyEl.appendChild(lbHeader);

  const lbList = document.createElement('div');
  lbList.className = 'daily-lb-list';
  const leaderboard = Array.isArray(data.leaderboard) ? data.leaderboard : [];
  if (leaderboard.length === 0) {
    // Phase 7.10 — DS-01 pass 2: padding override moved to .empty-hint--sm
    // modifier in 03-game.css; the 1rem here is smaller than the lg variant.
    // Side-note: the original inline style omitted font-style, but the base
    // .empty-hint rule (03-game.css:357-363) sets font-style: italic — so
    // post-migration this empty hint becomes italic. Visually harmless and
    // aligns with the stats-empty case that always had italic.
    const empty = document.createElement('div');
    empty.className = 'empty-hint empty-hint--sm';
    empty.textContent = 'No results yet. Yours could be the first!';
    lbList.appendChild(empty);
  } else {
    leaderboard.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'daily-lb-row';
      const rank = document.createElement('span');
      rank.className = 'daily-lb-rank';
      rank.textContent = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
      const name = document.createElement('span');
      name.className = 'daily-lb-name';
      name.textContent = entry.name || 'Anonymous';
      const len = document.createElement('span');
      len.className = 'daily-lb-len';
      len.textContent = String(entry.chainLength | 0);
      row.appendChild(rank);
      row.appendChild(name);
      row.appendChild(len);
      lbList.appendChild(row);
    });
  }
  bodyEl.appendChild(lbList);

  // Wire the share button to copy a Wordle-style text result. Replace any
  // prior listener (cloneNode trick) so reopening the modal doesn't
  // accumulate handlers across multiple opens.
  const newShareBtn = shareBtn.cloneNode(true);
  shareBtn.parentNode.replaceChild(newShareBtn, shareBtn);
  newShareBtn.addEventListener('click', () => {
    const text = `🎬 MovieMatch Daily #${puzzleNumber}\nChain: ${chainLength}\nhttps://moviematch.it.com`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast('Result copied to clipboard! 📋'),
        () => showToast('Couldn\'t copy — try again')
      );
    } else {
      showToast('Clipboard not available');
    }
  });

  // Ensure the close-button + Done button both close the modal cleanly.
  // The MutationObserver focus-trap wiring (L6 from Week 1) handles focus
  // restoration when the modal is hidden.
  const closeBtn = document.getElementById('daily-result-close-btn');
  if (closeBtn) {
    const fresh = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(fresh, closeBtn);
    fresh.addEventListener('click', () => modal.classList.add('hidden'));
  }

  // Phase 7.4 (Daily ritual): append a single additive block (device-local
  // streak + live reset countdown) as the LAST child of the rebuilt body.
  // WHY append + rebuilt-body: bodyEl.textContent was cleared at the top of
  // this function and fully rebuilt, so adding one trailing child touches no
  // existing node and is idempotent across re-opens. No stableId is read;
  // nothing here is sent to the server (Phase-1 security + no-accounts).
  const ritual = document.createElement('div');
  ritual.className = 'daily-ritual';

  const prevStreak = readDailyStreak();
  const { streak, next } = computeDailyStreak(puzzleNumber, prevStreak);
  writeDailyStreak(next);

  const streakEl = document.createElement('div');
  streakEl.className = 'daily-streak';
  streakEl.textContent = `Day ${streak} 🔥`;

  const countdownEl = document.createElement('div');
  countdownEl.className = 'daily-countdown';
  countdownEl.textContent = `Resets in ${formatResetCountdown()}`;

  ritual.appendChild(streakEl);
  ritual.appendChild(countdownEl);
  bodyEl.appendChild(ritual);

  // Phase 7.4: keep the countdown live (minute cadence — h/m granularity
  // never needs faster). Self-clearing: the first tick that observes the
  // modal hidden clears itself, so EVERY close path (Done button, the ✕
  // global .modal-close handler, any programmatic .hidden) stops it without
  // touching that global handler. Combined with the top-of-render hard-clear
  // this bounds the app to ≤1 live interval, ever.
  _dailyCountdownTimer = setInterval(() => {
    if (modal.classList.contains('hidden')) {
      clearInterval(_dailyCountdownTimer);
      _dailyCountdownTimer = null;
      return;
    }
    countdownEl.textContent = `Resets in ${formatResetCountdown()}`;
  }, 60000);

  modal.classList.remove('hidden');
}

// =========================================================================
// DAILY NAME PROMPT (HL-01)
// =========================================================================
// WHY: the hero "Today's Daily Challenge" CTA used to read its name from
// #player-name — an input that only exists on the (hidden) lobby screen.
// A first-time visitor (no saved name) therefore got a full-screen "enter
// a name first" notification plus a focus() on an off-screen field: a
// dead-end on a primary entry point. This inline prompt lets a name-less
// player start the Daily in place. It is intentionally socket-free: the
// caller owns the `startDailyChallenge` emit (pure, unit-testable seam —
// daily-name-prompt.test.js). Phase 7.3 (MI-02): the overlay markup is now
// the shared createPromptModal factory (this used to be ~70 lines of
// hardcoded .style.cssText that deliberately mirrored showNamePrompt/
// showJoinPrompt to avoid a third divergent look — that divergence is now
// resolved; all three share one factory + the .modal-*--prompt CSS, with
// the daily-name-* class names preserved as the test contract).
export function showDailyNamePrompt({ prefill = '', onConfirm } = {}) {
  return createPromptModal(buildDailyPromptConfig({ prefill, onConfirm }));
}
