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
