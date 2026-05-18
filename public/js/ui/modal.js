// public/js/ui/modal.js
//
// WHY (Phase 7.3 MI-02 + DS-01): showNamePrompt / showJoinPrompt /
// showDailyNamePrompt were three near-identical overlays built imperatively
// with ~28 hardcoded `.style.cssText` assignments that bypassed the
// .modal-overlay/.modal-card design system (the DS-01 inline-style debt and
// the MI-02 ad-hoc-overlay debt are the same code). This is the single,
// pure, app-agnostic factory they now delegate to. It emits the design
// system's classes plus a pixel-parity `--prompt` compact modifier
// (04-modals.css) so consolidation is a strict zero-behaviour-change
// refactor. No app/socket imports. textContent-only — preserves the
// originals' XSS posture (titles/labels are static, but the discipline is
// kept). The empty-required `borderColor` cue is a *dynamic* state write
// (behaviour, not static debt) and is intentionally preserved here.

export function createPromptModal(config) {
  const {
    overlayClass,
    title,
    subtitle,
    fields = [],
    primary,
    secondary,
    closeOnBackdrop = false,
    focusDelayMs = 0,
    focusIndex = 0,
  } = config;

  const overlay = document.createElement('div');
  // .modal-overlay = the design-system backdrop; --prompt = the compact,
  // no-entrance-animation modifier reproducing the legacy prompt pixels.
  overlay.className = 'modal-overlay modal-overlay--prompt';
  if (overlayClass) overlay.classList.add(overlayClass); // additive — keeps test hooks

  const card = document.createElement('div');
  card.className = 'modal-card modal-card--prompt';

  const titleEl = document.createElement('h2');
  // No-subtitle prompts (showJoinPrompt) used a larger title bottom-margin;
  // the --solo modifier carries that exact spacing instead of cssText.
  titleEl.className = subtitle
    ? 'modal-prompt-title'
    : 'modal-prompt-title modal-prompt-title--solo';
  titleEl.textContent = title;
  card.appendChild(titleEl);

  if (subtitle) {
    const subEl = document.createElement('p');
    subEl.className = 'modal-prompt-subtitle';
    subEl.textContent = subtitle;
    card.appendChild(subEl);
  }

  const inputEls = fields.map((f) => {
    if (f.label) {
      const labelEl = document.createElement('label');
      labelEl.className = 'modal-prompt-label';
      labelEl.textContent = f.label;
      card.appendChild(labelEl);
    }
    const input = document.createElement('input');
    // WHY (Phase 7.3 review-fix): all 3 legacy prompts use text inputs
    // only — hard-code it rather than expose an untested `type` option
    // (YAGNI; keeps the factory contract minimal for the zero-behaviour
    // refactor).
    input.type = 'text';
    input.placeholder = f.placeholder || '';
    input.autocomplete = 'off';
    if (typeof f.maxLength === 'number') input.maxLength = f.maxLength;
    // WHY (Phase 7.3 review-fix): guard against a MISSING value, not a
    // falsy one — '' is a valid explicit pre-fill (e.g. the new-user name
    // field) and must be applied, mirroring the maxLength guard above.
    if (f.value !== undefined && f.value !== null) input.value = f.value;
    // gap = the exact per-field bottom margin from the legacy cssText:
    // '1rem' is the base; '1.5rem' (join code field) gets --gap-lg.
    input.className = f.gap === '1.5rem'
      ? 'modal-prompt-input modal-prompt-input--gap-lg'
      : 'modal-prompt-input';
    if (f.uppercase) input.classList.add('modal-prompt-input--upper');
    card.appendChild(input);
    return input;
  });

  const primaryBtn = document.createElement('button');
  primaryBtn.type = 'button';
  // Legacy: the primary button only had a bottom margin when a secondary
  // button followed it (single-button prompts had none) — --stacked is
  // that exact conditional spacing.
  primaryBtn.className = secondary
    ? 'modal-prompt-btn modal-prompt-btn--primary modal-prompt-btn--stacked'
    : 'modal-prompt-btn modal-prompt-btn--primary';
  if (primary.className) primaryBtn.classList.add(primary.className);
  primaryBtn.textContent = primary.label;
  card.appendChild(primaryBtn);

  let secondaryBtn = null;
  if (secondary) {
    secondaryBtn = document.createElement('button');
    secondaryBtn.type = 'button';
    secondaryBtn.className = 'modal-prompt-btn modal-prompt-btn--secondary';
    if (secondary.className) secondaryBtn.classList.add(secondary.className);
    secondaryBtn.textContent = secondary.label;
    card.appendChild(secondaryBtn);
  }

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }

  function submit() {
    // invalid(idx): the legacy red-border cue. It is a dynamic .style write
    // (per-keystroke state feedback) — NOT static inline-style debt — so it
    // stays in JS, byte-for-byte with the originals (#f87171 + focus, keep
    // the modal open). close: lets the caller dismiss after a valid submit.
    primary.onSubmit(inputEls.map((i) => i.value), {
      invalid(idx = 0) {
        const el = inputEls[idx];
        if (el) { el.style.borderColor = '#f87171'; el.focus(); }
      },
      close,
    });
  }

  primaryBtn.addEventListener('click', submit);
  if (secondaryBtn) {
    secondaryBtn.addEventListener('click', () => secondary.onClick({ close }));
  }
  if (closeOnBackdrop) {
    // Only a click on the backdrop itself (not bubbled from the card)
    // closes — exactly the legacy `if (e.target === overlay)` guard.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  // Enter: multi-field prompts advance focus field-by-field; the last
  // field submits (exact legacy showJoinPrompt behaviour; single-field
  // prompts therefore submit immediately).
  inputEls.forEach((input, idx) => {
    input.addEventListener('keypress', (e) => {
      if (e.key !== 'Enter') return;
      if (idx < inputEls.length - 1) inputEls[idx + 1].focus();
      else submit();
    });
  });

  // Focus timing is behavioural: showDailyNamePrompt focuses synchronously
  // (it has no entrance transition — the whole reason for the --prompt
  // modifier is "no animation"); the app.js prompts deferred 100ms so the
  // (now removed) animation/layout could settle. Preserve both exactly.
  const focusTarget = inputEls[focusIndex] || inputEls[0];
  if (focusTarget) {
    if (focusDelayMs > 0) setTimeout(() => focusTarget.focus(), focusDelayMs);
    else focusTarget.focus();
  }

  return { overlay, close };
}
