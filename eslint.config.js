// eslint.config.js — flat config (ESLint v9+). WHY CommonJS (.js with
// module.exports, not .mjs): the repo is CommonJS end-to-end (package.json
// has "type":"commonjs"), and ESLint loads a `.js` flat config under that
// type as CJS, so module.exports is the natural, churn-free choice here.
//
// Scope of this config: catch REAL defects only — unused vars/imports,
// undefined globals, unreachable code (the @eslint/js "recommended" set).
// Deliberately NO stylistic/formatting rules (semi, quotes, indent): those
// would flag the existing hand-formatted codebase wholesale and create
// review churn with zero behavioral value.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Global ignores. WHY each:
  //  - node_modules/coverage/data/docs: generated, vendored, or content — not
  //    our source to lint.
  //  - public/js/lib/**: vendored qrcode-generator lib (third-party, minified-
  //    ish UMD) — linting it would only produce noise we can't act on.
  //  - the two ruleKits/my-stats tests: in-flight 6c.1 working-tree edits —
  //    not ours to modify (they intentionally fail 4 tests by design), so we
  //    must not let lint pressure a change to them.
  {
    ignores: [
      'node_modules/',
      'coverage/',
      'data/',
      'docs/',
      'public/js/lib/**',
      'server/ruleKits.test.js',
      'server/my-stats-enrichment.test.js',
    ],
  },

  // Base: ESLint's recommended ruleset (real-bug rules only).
  js.configs.recommended,

  // Server + build scripts: Node.js runtime, CommonJS modules (require/exports).
  {
    files: ['server/**/*.js', 'scripts/**/*.js', 'server.js', 'jest.config.js', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
    },
  },

  // Browser client (ES modules — these files use import/export). `io` is the
  // socket.io client global injected by the <script> tag in index.html, so it
  // is readonly here; everything else the client touches (window, document,
  // navigator, AudioContext, fetch, localStorage…) is covered by globals.browser.
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
        io: 'readonly',
      },
    },
  },

  // Service worker(s) at public/ root: classic worker scripts (not ES modules)
  // running in the ServiceWorker global scope (self/caches/clients/
  // importScripts). sw-routing.js is a UMD that also assigns module.exports so
  // Jest can require it — keep commonjs globals available alongside the worker
  // ones. sourceType 'script' because importScripts() can't be used in a module.
  {
    files: ['public/sw.js', 'public/sw-routing.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
        ...globals.commonjs,
      },
    },
  },

  // Server test files: Jest + Node, CommonJS (these use require()).
  {
    files: ['server/**/*.test.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
  },

  // Client test files: Jest + Node globals but ES module syntax (import) since
  // babel-jest transpiles them; jsdom supplies the browser surface at runtime.
  {
    files: ['client-tests/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.jest,
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Project-wide rule tweaks.
  {
    rules: {
      // argsIgnorePattern/varsIgnorePattern '^_' lets us intentionally mark an
      // unused binding by prefixing it with _ (common for unused callback args)
      // without disabling the rule's real value elsewhere. caughtErrors:'none'
      // because this codebase deliberately swallows errors in many catch blocks
      // (defensive `} catch (e) {` around localStorage/JSON/vibrate/Redis); the
      // unused-catch-binding is idiomatic here, not a defect, so flagging every
      // one would be pure noise that buries the real unused-import findings.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      // allowEmptyCatch: every `catch {}` in this repo is an intentional
      // swallow-and-continue around an operation that may legitimately throw
      // (localStorage in private mode, navigator.vibrate, JSON.parse of user
      // storage). Empty catches elsewhere are still flagged by no-empty's
      // default; only the catch case is whitelisted.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
