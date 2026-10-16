/**
 * eslint.config.mjs — lint rules for the whole repo (`npm run lint`).
 *
 * Layer: tooling. ESLint 10 reads this "flat config" file (a plain array of rule sets,
 * each saying which files it applies to). Two jobs: the standard recommended rules for
 * TypeScript and for the .mjs scripts, and the two rules that guard the architecture (plan
 * §4.1) — nothing under src/core may import `vscode`, and nothing under src/webview may import
 * `vscode`, a Node built-in, or anything but a type from src/core. The first keeps the core
 * logic testable under plain Node without a VS Code process; the second keeps the browser
 * bundle free of host code. test/unit/lint.test.ts is both rules' test.
 */
import js from '@eslint/js';
import globals from 'globals';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/** The sentence the webview rule prints for a Node built-in, in either spelling. */
const NO_NODE_IN_WEBVIEW = 'src/webview runs in a browser: no Node built-ins (plan §4.1).';

// Every module Node itself provides (`fs`, `path`, `child_process`, …, the `_`-prefixed internal
// ones and the subpaths such as `fs/promises` included), in both spellings a file could import —
// `fs` and `node:fs` — except the few Node lists in the `node:` spelling only (`node:test`,
// `node:sqlite`). Taken from the running Node rather than written out, so a module Node adds is
// refused the day it ships; CI's Node and this machine's need not agree on the count.
const nodeBuiltins = builtinModules
  .flatMap((name) => (name.startsWith('node:') ? [name] : [name, `node:${name}`]))
  .map((name) => ({ name, message: NO_NODE_IN_WEBVIEW }));

// `window`'s properties that the DOM lib declares as bare globals: with the DOM in `lib`
// (tsconfig.webview.json) a renderer that writes `parent` for `row.parent`, `name` for
// `row.name` or `if (event)` compiles — against window.parent, window.name, window.event — and
// ships. The compiler cannot refuse them (they exist); this list makes each a lint error.
const WINDOW_GLOBALS = [
  'name', 'length', 'event', 'status', 'top', 'parent', 'self', 'open', 'close', 'closed',
  'origin', 'stop', 'print', 'external', 'screen', 'history', 'location',
].map((name) => ({ name, message: `\`${name}\` here is window.${name} (the DOM lib): declare the value you meant.` }));

export default defineConfig([
  // Generated and downloaded folders are never linted.
  globalIgnores(['node_modules/', 'dist/', 'out/', '.vscode-test/', 'coverage/']),

  // TypeScript sources, tests and vitest.config.mts: ESLint's recommended rules plus
  // typescript-eslint's.
  {
    files: ['**/*.ts', '**/*.mts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },

  // Plain-JavaScript tooling (this file, esbuild.mjs, scripts/): recommended rules only.
  // `globals.node` tells ESLint that `process`, `console`, `fetch` etc. exist.
  {
    files: ['**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },

  // The layering rule (plan §4.1): src/core is pure logic and must stay runnable outside
  // VS Code. Importing `vscode` there is a lint error, not a code-review comment.
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message:
                'src/core must not depend on VS Code (plan §4.1). Put VS Code-facing code in src/vscode.',
            },
          ],
        },
      ],
    },
  },

  // The second layering rule (plan §4.1, from M6): src/webview runs inside a webview — a browser
  // page — where there is no `vscode` module and no Node. Three things are refused: `vscode`;
  // every Node built-in, in both spellings; and a *value* import from src/core. A type import
  // from core (`import type { StackViewModel } …`) is allowed, because the compiler erases it and
  // so it carries no host code into the browser bundle (measured: one `formatAge` call brought
  // graph.ts and viewmodel.ts along, 411 → 822 bytes) — the difference between the two is why
  // this block uses typescript-eslint's copy of the rule (`allowTypeImports`) and the core block
  // above ESLint's own. Two forms the rule does not see — a dynamic `import()` and a `require()`
  // call — are caught by the bundle test (test/unit/build.test.ts), which reads what esbuild
  // actually wrote; esbuild itself refuses to resolve `vscode` or a built-in under
  // `platform: 'browser'`, so a value import of those fails the build as well.
  {
    files: ['src/webview/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message:
                'src/webview runs in a browser: there is no vscode module there, only acquireVsCodeApi() (plan §4.1).',
            },
            ...nodeBuiltins,
          ],
          patterns: [
            {
              group: ['**/core/**'],
              allowTypeImports: true,
              message:
                'src/webview may import only types from src/core (plan §4.1): a value import would bundle host code into the view.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...WINDOW_GLOBALS],
    },
  },
]);
