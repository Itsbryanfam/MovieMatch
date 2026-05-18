/**
 * @jest-environment jsdom
 */
const { loadIndexHtml } = require('./fixtures');
// initUIElements binds the live notificationOverlay/notificationText refs that
// showNotification (called inside gameEvent) depends on. Pure-UI harness — no socket.
import { initUIElements } from '../public/js/ui.js';
import { toast, gameEvent } from '../public/js/ui.js';
import { showToast } from '../public/js/ui.js';

describe('feedback router — toast + gameEvent', () => {
  beforeEach(() => { loadIndexHtml(); initUIElements(); });
  afterEach(() => { document.body.innerHTML = ''; });

  test('showToast default adds copy-toast--info, stays behaviour-compatible', () => {
    showToast('hello');
    const t = document.querySelector('.copy-toast');
    expect(t).not.toBeNull();
    expect(t.textContent).toBe('hello');
    expect(t.classList.contains('copy-toast')).toBe(true);
    expect(t.classList.contains('copy-toast--info')).toBe(true);
    expect(t.classList.contains('visible')).toBe(true);
  });

  test('toast(error) reuses the element and swaps the variant class (no leak)', () => {
    toast('first', { variant: 'error' });
    let t = document.querySelector('.copy-toast');
    expect(t.classList.contains('copy-toast--error')).toBe(true);
    toast('second', { variant: 'success' });
    t = document.querySelector('.copy-toast');
    expect(t.textContent).toBe('second');
    expect(t.classList.contains('copy-toast--success')).toBe(true);
    expect(t.classList.contains('copy-toast--error')).toBe(false); // no stale variant
  });

  test('gameEvent(elimination) shows overlay + flash when not self-eliminated', () => {
    gameEvent('elimination', { msg: 'Alice was eliminated', selfElimActive: false });
    const overlay = document.getElementById('notification-overlay');
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(overlay.classList.contains('notification--elimination')).toBe(true);
    expect(document.getElementById('notification-text').innerText).toBe('Alice was eliminated');
    expect(document.querySelector('.elimination-flash')).not.toBeNull();
  });

  test('gameEvent(elimination) suppresses overlay but still flashes when selfElimActive', () => {
    const overlay = document.getElementById('notification-overlay');
    overlay.classList.add('hidden');
    gameEvent('elimination', { msg: 'You were eliminated', selfElimActive: true });
    expect(overlay.classList.contains('hidden')).toBe(true);
    expect(overlay.classList.contains('notification--elimination')).toBe(false);
    expect(document.querySelector('.elimination-flash')).not.toBeNull(); // flash NOT gated
  });

  test('gameEvent(win) clears prior elimination flash and shows win flash', () => {
    const stale = document.createElement('div');
    stale.className = 'elimination-flash';
    document.body.appendChild(stale);
    gameEvent('win', { msg: 'Bob wins!', selfElimActive: false });
    expect(document.querySelector('.elimination-flash')).toBeNull();
    expect(document.querySelector('.win-flash')).not.toBeNull();
  });
});
