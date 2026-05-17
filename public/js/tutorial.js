// ============================================================================
// TUTORIAL (M6) — first-time player guided walkthrough
// ============================================================================
// What this is:
//   - A fully client-side overlay shown to brand-new players on their
//     first visit. No server round-trips, no TMDB calls, no Redis state.
//   - A scripted "chain" with three pre-baked Marvel movies and obvious
//     shared actors. Each step highlights the connecting actor and
//     explains why the play counts.
//   - Skip-able at any time. Once completed (or skipped) the gate flag
//     `mm_completedTutorial` is set in localStorage and the tutorial
//     never shows again.
//
// Why client-only:
//   - Server complexity for a one-shot teaching flow isn't worth it.
//   - No TMDB calls means the tutorial works offline + at zero API cost
//     even if a million new players show up at once.
//   - The pre-baked chain is illustrative, not validation-driven —
//     teaching the concept, not testing the system.
// ============================================================================

const TUTORIAL_FLAG = 'mm_completedTutorial';

// Pre-baked teaching chain. Marvel was chosen because RDJ links Iron Man
// to Iron Man 2 obviously, and Scarlett Johansson is a household name
// linking IM2 to The Avengers — both connections "click" instantly for
// most audiences without genre or movie-buff knowledge.
//
// Posters point at TMDB CDN (same origin policy as the rest of the app);
// they fail soft to a placeholder if TMDB is unreachable.
const TUTORIAL_CHAIN = [
  {
    title: 'Iron Man',
    year: 2008,
    poster: 'https://image.tmdb.org/t/p/w200/78lPtwv72eTNqFW9COBYI0dWDJa.jpg',
    cast: ['Robert Downey Jr.', 'Gwyneth Paltrow', 'Jeff Bridges', 'Terrence Howard'],
    explanation: 'The chain starts with any movie. Here we begin with Iron Man.',
  },
  {
    title: 'Iron Man 2',
    year: 2010,
    poster: 'https://image.tmdb.org/t/p/w200/6WBeq4fCfn7AN0o21W9qNcRF2l9.jpg',
    cast: ['Robert Downey Jr.', 'Scarlett Johansson', 'Don Cheadle', 'Mickey Rourke'],
    connector: 'Robert Downey Jr.',
    explanation: 'Iron Man 2 shares Robert Downey Jr. with Iron Man. That actor is the link — name a movie that shares an actor with the previous one to keep the chain alive.',
  },
  {
    title: 'The Avengers',
    year: 2012,
    poster: 'https://image.tmdb.org/t/p/w200/RYMX2wcKCBAr24UyPD7xwmjaTn.jpg',
    cast: ['Scarlett Johansson', 'Chris Evans', 'Robert Downey Jr.', 'Mark Ruffalo'],
    connector: 'Scarlett Johansson',
    explanation: 'You can use any actor that connects — here Scarlett Johansson is in both Iron Man 2 and The Avengers. That is your turn complete!',
  },
];

// Idempotent gate: returns true the first time, false thereafter. Any
// failure to read localStorage (private mode, quota exceeded) returns
// false so a broken localStorage never re-pops the tutorial on every
// page load.
export function shouldShowTutorial() {
  try {
    return localStorage.getItem(TUTORIAL_FLAG) !== '1';
  } catch {
    return false;
  }
}

// Mark the tutorial as completed (or skipped). Called when the user
// finishes all steps or hits Skip — both paths set the flag identically
// so a player who skips doesn't get re-prompted next visit.
function _markCompleted() {
  try { localStorage.setItem(TUTORIAL_FLAG, '1'); } catch {}
}

// Build the tutorial overlay DOM and run the step sequence. Returns a
// promise that resolves when the tutorial is dismissed (either by
// completion or skip) so callers can chain follow-up UX (e.g. focus
// the player-name input after the tutorial closes).
export function runTutorial() {
  return new Promise((resolve) => {
    // If already shown, resolve immediately so the caller doesn't need
    // to repeat the gate check.
    if (!shouldShowTutorial()) {
      resolve();
      return;
    }

    // Overlay container — full-viewport modal with backdrop. role=dialog
    // + aria-modal communicates to screen readers that the rest of the
    // page is inert while this is open. Focus management piggybacks on
    // the existing modal-overlay focus-trap (L6 from Week 1) since this
    // overlay carries the same .modal-overlay class.
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay tutorial-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tutorial-title');

    const card = document.createElement('div');
    card.className = 'modal-card tutorial-card';

    // Header
    const header = document.createElement('div');
    header.className = 'tutorial-header';
    const title = document.createElement('h2');
    title.id = 'tutorial-title';
    title.className = 'modal-title';
    title.textContent = '🎬 How to play MovieMatch';
    const skipBtn = document.createElement('button');
    skipBtn.className = 'tutorial-skip-btn';
    skipBtn.type = 'button';
    skipBtn.textContent = 'Skip';
    header.appendChild(title);
    header.appendChild(skipBtn);

    // Step indicator dots — visual progress so the player knows how many
    // steps are left. Updated in setStep below.
    const dots = document.createElement('div');
    dots.className = 'tutorial-dots';
    TUTORIAL_CHAIN.forEach(() => {
      const dot = document.createElement('span');
      dot.className = 'tutorial-dot';
      dots.appendChild(dot);
    });

    // Chain area — accumulates entries as the user advances through steps.
    // We ADD to it each step rather than replace, so the player visually
    // sees the chain build up turn by turn.
    const chainArea = document.createElement('div');
    chainArea.className = 'tutorial-chain';

    // Explanation panel + advance button. Updated per step.
    const explainPanel = document.createElement('div');
    explainPanel.className = 'tutorial-explain';

    const advanceBtn = document.createElement('button');
    advanceBtn.className = 'btn-primary tutorial-advance-btn';
    advanceBtn.type = 'button';

    card.appendChild(header);
    card.appendChild(dots);
    card.appendChild(chainArea);
    card.appendChild(explainPanel);
    card.appendChild(advanceBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Render a single chain entry into the chain area.
    function appendChainEntry(step) {
      const entry = document.createElement('div');
      entry.className = 'chain-item tutorial-chain-item';
      if (step.connector) entry.classList.add('shared-highlight');

      const img = document.createElement('img');
      img.src = step.poster;
      img.alt = step.title + ' poster';
      img.className = 'chain-poster';
      // Failsafe: a poster fetch failure swaps to a neutral placeholder
      // instead of leaving a broken-image icon. Tutorial UX should never
      // look broken even when the CDN hiccups.
      img.addEventListener('error', () => {
        img.replaceWith(Object.assign(document.createElement('div'), {
          className: 'chain-poster placeholder',
        }));
      });
      entry.appendChild(img);

      const content = document.createElement('div');
      content.className = 'chain-content';

      const player = document.createElement('div');
      player.className = 'player-name';
      player.textContent = step.connector ? 'You' : 'Game starts';
      content.appendChild(player);

      const titleDiv = document.createElement('div');
      titleDiv.className = 'movie-title';
      titleDiv.appendChild(document.createTextNode(step.title + ' '));
      const yearSpan = document.createElement('span');
      yearSpan.className = 'year';
      yearSpan.textContent = '(' + step.year + ')';
      titleDiv.appendChild(yearSpan);
      content.appendChild(titleDiv);

      const castDiv = document.createElement('div');
      castDiv.className = 'movie-cast';
      castDiv.appendChild(document.createTextNode('Cast: '));
      step.cast.forEach((actorName, ci) => {
        if (ci > 0) castDiv.appendChild(document.createTextNode(', '));
        // Bold the connector for the current entry — the visual bridge
        // between this entry and the previous one.
        if (step.connector && actorName === step.connector) {
          const strong = document.createElement('strong');
          strong.textContent = actorName;
          castDiv.appendChild(strong);
        } else {
          castDiv.appendChild(document.createTextNode(actorName));
        }
      });
      content.appendChild(castDiv);

      entry.appendChild(content);
      chainArea.appendChild(entry);
      // Scroll the new entry into view — useful when the chain area is
      // shorter than the cumulative chain (which it is by step 3).
      entry.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    let stepIndex = 0;
    function setStep(i) {
      stepIndex = i;
      // Update the dot indicator to mark the current step as active.
      Array.from(dots.children).forEach((dot, idx) => {
        dot.classList.toggle('active', idx === i);
        dot.classList.toggle('done', idx < i);
      });

      // Append the entry for THIS step and update the explanation.
      appendChainEntry(TUTORIAL_CHAIN[i]);
      explainPanel.textContent = TUTORIAL_CHAIN[i].explanation;

      // Last step: change the advance button to "Got it — let's play"
      // so the player knows the tutorial is about to close.
      const isLast = i === TUTORIAL_CHAIN.length - 1;
      advanceBtn.textContent = isLast ? "Got it — let's play" : 'Next →';
      advanceBtn.focus();
    }

    function dismiss() {
      _markCompleted();
      overlay.remove();
      resolve();
    }

    skipBtn.addEventListener('click', dismiss);

    advanceBtn.addEventListener('click', () => {
      if (stepIndex < TUTORIAL_CHAIN.length - 1) {
        setStep(stepIndex + 1);
      } else {
        dismiss();
      }
    });

    // Escape closes the tutorial — same as Skip. Honors the codebase
    // convention from the L6 modal-focus work.
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') dismiss();
    });

    // Kick off the first step.
    setStep(0);
  });
}

// Audit #4: drive onboarding from the player's first explicit "Play Now"
// intent instead of an unsolicited timed modal. First-time visitors get
// the guided walkthrough and then continue into the lobby; returning
// players (gate flag set) continue immediately with no interruption.
// continueFn always runs exactly once, after any tutorial is dismissed,
// so the caller can hang the screen transition off this. The .catch keeps
// a (defensive) tutorial rejection from stranding the player on the hero.
export function runTutorialThenContinue(continueFn) {
  if (shouldShowTutorial()) {
    return runTutorial().catch(() => {}).then(() => { continueFn(); });
  }
  continueFn();
  return Promise.resolve();
}
