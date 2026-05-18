/**
 * @jest-environment jsdom
 */
// Phase 7.3 MI-02: createPromptModal is the single generic factory the 3
// name overlays delegate to. These tests pin its structural + behavioural
// contract so the prompt wrappers (Task 1/2) are correct by construction.
const { loadIndexHtml } = require('./fixtures');
import { createPromptModal } from '../public/js/ui.js';

function baseConfig(over = {}) {
  return {
    title: 'T',
    fields: [{ placeholder: 'name', maxLength: 24, gap: '1rem' }],
    primary: { label: 'Go', onSubmit: jest.fn() },
    closeOnBackdrop: false,
    focusDelayMs: 0,
    ...over,
  };
}

describe('createPromptModal — Phase 7.3 modal factory', () => {
  beforeEach(() => { loadIndexHtml(); try { localStorage.clear(); } catch {} });
  afterEach(() => { document.body.innerHTML = ''; jest.useRealTimers(); });

  test('builds modal-system markup and appends to body', () => {
    createPromptModal(baseConfig());
    const overlay = document.querySelector('.modal-overlay.modal-overlay--prompt');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('.modal-card.modal-card--prompt')).not.toBeNull();
    expect(overlay.parentNode).toBe(document.body);
  });

  test('overlayClass is additive', () => {
    createPromptModal(baseConfig({ overlayClass: 'daily-name-overlay' }));
    const overlay = document.querySelector('.daily-name-overlay');
    expect(overlay.classList.contains('modal-overlay')).toBe(true);
    expect(overlay.classList.contains('modal-overlay--prompt')).toBe(true);
  });

  test('title --solo only when no subtitle; subtitle rendered when present', () => {
    createPromptModal(baseConfig());
    expect(document.querySelector('.modal-prompt-title--solo')).not.toBeNull();
    expect(document.querySelector('.modal-prompt-subtitle')).toBeNull();
    document.body.innerHTML = '';
    createPromptModal(baseConfig({ subtitle: 'S' }));
    expect(document.querySelector('.modal-prompt-title--solo')).toBeNull();
    expect(document.querySelector('.modal-prompt-subtitle').textContent).toBe('S');
  });

  test('field flags: label, --gap-lg, --upper', () => {
    createPromptModal(baseConfig({
      fields: [
        { label: 'Your Name', placeholder: 'n', maxLength: 24, gap: '1rem' },
        { label: 'Room Code', placeholder: 'c', maxLength: 6, gap: '1.5rem', uppercase: true },
      ],
    }));
    const labels = [...document.querySelectorAll('.modal-prompt-label')].map(l => l.textContent);
    expect(labels).toEqual(['Your Name', 'Room Code']);
    const inputs = document.querySelectorAll('.modal-prompt-input');
    expect(inputs[0].classList.contains('modal-prompt-input--gap-lg')).toBe(false);
    expect(inputs[1].classList.contains('modal-prompt-input--gap-lg')).toBe(true);
    expect(inputs[1].classList.contains('modal-prompt-input--upper')).toBe(true);
    expect(inputs[1].maxLength).toBe(6);
  });

  test('primary --stacked iff secondary; custom classNames applied', () => {
    createPromptModal(baseConfig());
    expect(document.querySelector('.modal-prompt-btn--stacked')).toBeNull();
    document.body.innerHTML = '';
    createPromptModal(baseConfig({
      primary: { label: 'Go', className: 'daily-name-go', onSubmit: jest.fn() },
      secondary: { label: 'Back', className: 'daily-name-cancel', onClick: jest.fn() },
    }));
    expect(document.querySelector('.modal-prompt-btn--primary.modal-prompt-btn--stacked')).not.toBeNull();
    expect(document.querySelector('.daily-name-go')).not.toBeNull();
    expect(document.querySelector('.daily-name-cancel')).not.toBeNull();
  });

  test('primary click invokes onSubmit with values + helpers; invalid() flags + keeps open', () => {
    const onSubmit = jest.fn((vals, { invalid }) => invalid(0));
    createPromptModal(baseConfig({ primary: { label: 'Go', onSubmit } }));
    const input = document.querySelector('.modal-prompt-input');
    input.value = 'x';
    document.querySelector('.modal-prompt-btn--primary').click();
    expect(onSubmit).toHaveBeenCalledWith(['x'], expect.objectContaining({
      invalid: expect.any(Function), close: expect.any(Function),
    }));
    expect(input.style.borderColor).toBe('rgb(248, 113, 113)'); // #f87171
    expect(document.querySelector('.modal-overlay')).not.toBeNull(); // still open
  });

  test('close() removes the overlay; secondary.onClick gets {close}', () => {
    const onClick = jest.fn(({ close }) => close());
    const { overlay, close } = createPromptModal(baseConfig({
      secondary: { label: 'Back', onClick },
    }));
    expect(typeof close).toBe('function');
    document.querySelector('.modal-prompt-btn--secondary').click();
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ close: expect.any(Function) }));
    expect(overlay.isConnected).toBe(false);
  });

  test('closeOnBackdrop gate', () => {
    createPromptModal(baseConfig({ closeOnBackdrop: false }));
    document.querySelector('.modal-overlay').click();
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    document.body.innerHTML = '';
    createPromptModal(baseConfig({ closeOnBackdrop: true }));
    const ov = document.querySelector('.modal-overlay');
    ov.querySelector('.modal-card').click();          // inside → stays
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    ov.click();                                       // backdrop → closes
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  test('Enter advances focus then submits on last field', () => {
    const onSubmit = jest.fn();
    createPromptModal(baseConfig({
      fields: [
        { placeholder: 'n', maxLength: 24, gap: '1rem' },
        { placeholder: 'c', maxLength: 6, gap: '1.5rem' },
      ],
      primary: { label: 'Go', onSubmit },
    }));
    const [f0, f1] = document.querySelectorAll('.modal-prompt-input');
    f0.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
    expect(document.activeElement).toBe(f1);
    expect(onSubmit).not.toHaveBeenCalled();
    f1.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('focusDelayMs:0 focuses synchronously; >0 waits; focusIndex selects', () => {
    jest.useFakeTimers();
    createPromptModal(baseConfig({
      fields: [
        { placeholder: 'n', maxLength: 24, gap: '1rem' },
        { placeholder: 'c', maxLength: 6, gap: '1.5rem' },
      ],
      focusDelayMs: 100, focusIndex: 1,
    }));
    const f1 = document.querySelectorAll('.modal-prompt-input')[1];
    expect(document.activeElement).not.toBe(f1);
    jest.advanceTimersByTime(100);
    expect(document.activeElement).toBe(f1);
  });

  test('focusDelayMs:0 focuses the focusIndex field synchronously', () => {
    createPromptModal(baseConfig({
      fields: [
        { placeholder: 'n', maxLength: 24, gap: '1rem' },
        { placeholder: 'c', maxLength: 6, gap: '1.5rem' },
      ],
      focusDelayMs: 0, focusIndex: 1,
    }));
    const f1 = document.querySelectorAll('.modal-prompt-input')[1];
    expect(document.activeElement).toBe(f1);
  });

  test('field value pre-fill is applied (incl. explicit empty string)', () => {
    createPromptModal(baseConfig({ fields: [{ placeholder: 'n', maxLength: 24, gap: '1rem', value: 'Alice' }] }));
    expect(document.querySelector('.modal-prompt-input').value).toBe('Alice');
    document.body.innerHTML = '';
    createPromptModal(baseConfig({ fields: [{ placeholder: 'n', maxLength: 24, gap: '1rem', value: '' }] }));
    expect(document.querySelector('.modal-prompt-input').value).toBe('');
  });

  test('XSS: crafted title is inert text', () => {
    createPromptModal(baseConfig({ title: '<img src=x onerror=alert(1)>' }));
    const t = document.querySelector('.modal-prompt-title');
    expect(t.querySelector('img')).toBeNull();
    expect(t.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
