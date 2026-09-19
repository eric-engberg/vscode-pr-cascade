/**
 * eslint.config.mjs — lint rules for the whole repo (`npm run lint`).
 *
 * Layer: tooling. ESLint 10 reads this "flat config" file (a plain array of rule sets,
 * each saying which files it applies to). Two jobs: the standard recommended rules for
 * TypeScript and for the .mjs scripts, and the one rule that guards the architecture —
 * nothing under src/core may import `vscode` (plan §4.1). That rule is what keeps the
 * core logic testable under plain Node without a VS Code process.
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

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
]);
