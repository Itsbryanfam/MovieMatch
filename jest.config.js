// Two-project setup:
//  - server: existing CommonJS tests, node env, no transform
//  - client: new tests for public/js/* modules, jsdom env, inline babel
//
// The client babel config is inlined here (rather than babel.config.json)
// because a project-level babel config would also be auto-applied to the
// server project and break its CJS module mocks.
//
// CI2: coverageThreshold is a RATCHET FLOOR, not an aspirational target —
// numbers are set ~1pt below measured post-Phase-2 coverage so CI blocks
// regressions without being flaky. Raise these in later phases as coverage
// improves; never lower them without an explicit decision.
module.exports = {
  // server/**/*.js intentionally excludes the root server.js boot file (it
  // lives at repo root, not under server/). That file runs boot side-effects
  // (Redis connect, port bind, process.exit) and is not require()-able in
  // tests, so excluding it from coverage instrumentation is correct.
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/**/*.test.js',
  ],
  coverageThreshold: {
    global: {
      statements: 63,
      branches: 52,
      functions: 62,
      lines: 69,
    },
  },
  projects: [
    {
      displayName: 'server',
      testMatch: ['<rootDir>/server/**/*.test.js'],
      testEnvironment: 'node',
    },
    {
      displayName: 'client',
      testMatch: ['<rootDir>/client-tests/**/*.test.js'],
      testEnvironment: 'jsdom',
      setupFiles: ['<rootDir>/client-tests/setup.js'],
      transform: {
        '^.+\\.js$': [
          'babel-jest',
          { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
        ],
      },
    },
  ],
};
