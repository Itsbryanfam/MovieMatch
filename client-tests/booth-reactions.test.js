/** @jest-environment jsdom */
// WHY: ticket-stub labels change visible text, so the reaction payload must be
// decoupled from innerText. This pins the wire contract: emit data-reaction.
import { reactionPayload } from '../public/js/app.js';
test('reaction payload comes from data-reaction, not text', () => {
  const btn = document.createElement('button');
  btn.dataset.reaction = '🔥';
  btn.textContent = 'Bravo';
  expect(reactionPayload(btn)).toBe('🔥');
});
test('falls back to textContent when data-reaction absent', () => {
  const btn = document.createElement('button');
  btn.textContent = '👀';
  expect(reactionPayload(btn)).toBe('👀');
});
// WHY (Finding 4): pin the '' fallback branch — a button with NEITHER a
// data-reaction attribute NOR any text content must yield the empty string
// (the `|| ''` arm), not undefined, so callers never emit `undefined` on the
// wire. Previously this branch of reactionPayload() was untested.
test('returns empty string when neither data-reaction nor text present', () => {
  const btn = document.createElement('button');
  expect(reactionPayload(btn)).toBe('');
});
