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
    // T6d: measure the client bundle too — it was entirely excluded before
    // (~7,130 lines dark). The vendored libs under public/js/lib are
    // third-party (qrcode.js etc.) and not our code to ratchet, so they stay
    // excluded.
    'public/js/**/*.js',
    '!public/js/lib/**',
  ],
  coverageThreshold: {
    // T6d: a per-glob key REMOVES its matched files from the `global` bucket,
    // so with the public/js/** entry below, `global` is now effectively
    // SERVER-ONLY. Measured server aggregate (CI parity — 6c.1 working-tree
    // edits stashed): stmt 82.69 / branch 71.27 / func 81.14 / lines 88.91.
    // Floors sit ~1pt under measured so CI blocks regressions without flaking.
    global: {
      statements: 81,
      branches: 70,
      functions: 80,
      lines: 87,
    },
    // T6d: client bundle ratchet. NOTE on jest semantics — a GLOB key
    // ('public/js/**/*.js') is checked PER-FILE (every matched file must clear
    // the floor individually), which would force the floor below the weakest
    // file (state.js/app.js are <15%) and defeat the ratchet. A DIRECTORY-PATH
    // key instead AGGREGATES coverage across all files under it (and likewise
    // removes them from the `global` bucket). So we key on the directory to get
    // the intended whole-bundle aggregate floor. Measured public/js aggregate
    // (CI parity, excluding vendored lib/**): stmt 68.81 / branch 57.06 /
    // func 55.06 / lines 71.17. Floors sit ~5pt under — a softer margin than
    // the server bucket since the client suite is younger; tighten as it grows.
    './public/js/': {
      statements: 63,
      branches: 52,
      functions: 50,
      lines: 66,
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
