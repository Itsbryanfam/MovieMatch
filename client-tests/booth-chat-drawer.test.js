/** @jest-environment jsdom */
// WHY: the drawer's unread counter is pure state logic — increments only while
// closed, resets on open. Unit-tested so the badge can't drift.
import { ChatDrawerState } from '../public/js/app.js';
test('unread increments only while closed', () => {
  const s = new ChatDrawerState();           // starts closed
  s.onMessage(); s.onMessage();
  expect(s.unread).toBe(2);
  s.open();
  expect(s.unread).toBe(0);
  s.onMessage();                              // open → no unread
  expect(s.unread).toBe(0);
  s.close(); s.onMessage();
  expect(s.unread).toBe(1);
});
