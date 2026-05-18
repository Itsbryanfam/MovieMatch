/**
 * @jest-environment jsdom
 */
const { loadIndexHtml } = require('./fixtures');
import { submissionPill } from '../public/js/ui.js';

describe('submissionPill — CG-03 state machine', () => {
  beforeEach(() => { loadIndexHtml(); });
  // Module-level _pillMode persists across tests in this file — reset it.
  afterEach(() => { submissionPill.clear(); document.body.innerHTML = ''; });

  test('checking shows the submitted title', () => {
    submissionPill.checking('Heat');
    const el = document.getElementById('submission-pill');
    expect(el.classList.contains('visible')).toBe(true);
    expect(el.textContent).toBe('Checking: "Heat"');
  });

  test('searching does not stomp a checking pill', () => {
    submissionPill.checking('Heat');
    submissionPill.searching();
    expect(document.getElementById('submission-pill').textContent).toBe('Checking: "Heat"');
  });

  test('searching shows the searching state when not checking', () => {
    submissionPill.searching();
    const el = document.getElementById('submission-pill');
    expect(el.textContent).toBe('Searching…');
    expect(el.classList.contains('visible')).toBe(true);
  });

  test('clear() empties and hides', () => {
    submissionPill.checking('Heat');
    submissionPill.clear();
    const el = document.getElementById('submission-pill');
    expect(el.classList.contains('visible')).toBe(false);
    expect(el.textContent).toBe('');
  });

  test("clear('searching') is a no-op while checking", () => {
    submissionPill.checking('Heat');
    submissionPill.clear('searching');
    expect(document.getElementById('submission-pill').textContent).toBe('Checking: "Heat"');
  });

  test('XSS: crafted title rendered as text', () => {
    submissionPill.checking('<img src=x onerror=alert(1)>');
    const el = document.getElementById('submission-pill');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img');
  });
});
