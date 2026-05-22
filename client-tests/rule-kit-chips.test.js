/**
 * @jest-environment jsdom
 */
// Phase 6c — the rule-kit chip renderer. Pins: one chip per kit with the right
// data-kit-id, and that a click reports the kit id to onPick.
import { renderRuleKitChips } from '../public/js/ui.js';

const KITS = [
  { id: 'date_night', label: 'Date Night', icon: '💘' },
  { id: 'after_dark', label: 'After Dark', icon: '🎃' },
  { id: 'classic_open', label: 'Classic Open', icon: '🎬' },
];

describe('renderRuleKitChips', () => {
  let container;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { container.remove(); });

  test('renders one .rule-kit-chip per kit with data-kit-id + label', () => {
    renderRuleKitChips(KITS, container, () => {});
    const chips = container.querySelectorAll('.rule-kit-chip');
    expect(chips.length).toBe(3);
    expect([...chips].map(c => c.dataset.kitId)).toEqual(['date_night', 'after_dark', 'classic_open']);
    expect(chips[0].textContent).toContain('Date Night');
  });

  test('click reports the kit id', () => {
    const onPick = jest.fn();
    renderRuleKitChips(KITS, container, onPick);
    container.querySelector('.rule-kit-chip[data-kit-id="after_dark"]').click();
    expect(onPick).toHaveBeenCalledWith('after_dark');
  });

  test('clears prior chips on re-render and tolerates a null container', () => {
    renderRuleKitChips(KITS, container, () => {});
    renderRuleKitChips([KITS[0]], container, () => {});
    expect(container.querySelectorAll('.rule-kit-chip').length).toBe(1);
    expect(() => renderRuleKitChips(KITS, null, () => {})).not.toThrow();
  });
});
