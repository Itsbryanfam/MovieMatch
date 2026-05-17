// Unit-tests the pure boot guard in isolation. It lives in its own module
// (not inlined in server.js) precisely so this test can require it without
// triggering server.js's boot side effects (Redis connect, port bind,
// process.exit on missing TMDB token).
const validateAdminSecret = require('./validateAdminSecret');

describe('validateAdminSecret', () => {
  test('rejects undefined (env var unset)', () => {
    expect(validateAdminSecret(undefined)).toMatch(/at least 32/);
  });

  test('rejects an empty string', () => {
    expect(validateAdminSecret('')).toMatch(/at least 32/);
  });

  test('rejects a non-string value', () => {
    expect(validateAdminSecret(1234567890123456789012345678901234)).toMatch(/at least 32/);
  });

  test('rejects a 31-char secret (just under the floor)', () => {
    expect(validateAdminSecret('a'.repeat(31))).toMatch(/at least 32/);
  });

  test('accepts a 32-char secret', () => {
    expect(validateAdminSecret('a'.repeat(32))).toBeNull();
  });
});
