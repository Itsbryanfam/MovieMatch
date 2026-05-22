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
    // .btn = existing design-system base (cursor/reset); .rule-kit-chip extends
    // the .mode-chip pattern (T5 CSS).
    chip.className = 'btn rule-kit-chip';
    chip.dataset.kitId = kit.id;
    const icon = document.createElement('span');
    icon.className = 'rule-kit-chip-icon';
    icon.setAttribute('aria-hidden', 'true'); // decorative; label carries meaning
    icon.textContent = kit.icon || '';
    const name = document.createElement('span');
    name.className = 'rule-kit-chip-name';
    name.textContent = kit.label || kit.id;
    chip.appendChild(icon);
    chip.appendChild(name);
    if (typeof onPick === 'function') {
      chip.addEventListener('click', () => onPick(kit.id));
    }
    container.appendChild(chip);
  });
}
