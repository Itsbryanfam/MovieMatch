// Two-project setup:
//  - server: existing CommonJS tests, node env, no transform
//  - client: new tests for public/js/* modules, jsdom env, inline babel
//
// The client babel config is inlined here (rather than babel.config.json)
// because a project-level babel config would also be auto-applied to the
// server project and break its CJS module mocks.
module.exports = {
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
