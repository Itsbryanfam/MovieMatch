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
    // eslint-disable-next-line no-loss-of-precision -- T5d: the literal is an intentional non-string input; exact precision is irrelevant — the test only asserts validateAdminSecret rejects any number. Editing the literal would dilute the "non-string" intent.
    expect(validateAdminSecret(1234567890123456789012345678901234)).toMatch(/at least 32/);
  });

  test('rejects a 31-char secret (just under the length floor)', () => {
    expect(validateAdminSecret('a'.repeat(31))).toMatch(/at least 32/);
  });

  // M2: length alone is insufficient. A 32-char single-char string clears the
  // length floor but is trivially brute-forceable — it must now be rejected
  // for low entropy, with a DISTINCT message so the boot log is actionable.
  test('rejects a 32-char secret with only 1 distinct character', () => {
    expect(validateAdminSecret('a'.repeat(32))).toMatch(/distinct characters/);
  });

  test('rejects a 40-char secret with only 4 distinct characters', () => {
    // 'abcd' repeated → length 40, 4 distinct chars → still too weak.
    expect(validateAdminSecret('abcd'.repeat(10))).toMatch(/distinct characters/);
  });

  test('accepts a 32-char secret with >= 5 distinct characters', () => {
    // 'abcde' x 7 = 35 chars, 5 distinct → clears both bars.
    expect(validateAdminSecret('abcde'.repeat(7))).toBeNull();
  });

  test('accepts a real 64-hex random secret (the deployed shape)', () => {
    // Hex secrets have ~16 distinct chars in practice — must never be a
    // false-positive rejection (this is the value live in Render).
    const hex64 = '57a9ad9e1d0bfaa3aed54109cf8a6a464252e9153f3d66212cb0ba8e741ff670';
    expect(validateAdminSecret(hex64)).toBeNull();
  });
});
