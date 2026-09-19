/**
 * vitest.config.mts — configuration for the Node-side test runner (Vitest).
 *
 * Layer: tooling. Vitest runs the tests that do not need a VS Code process: pure unit
 * tests in test/unit and real-git integration tests in test/git (plan §9.1 layers 1–2).
 * They are two "projects" so each can be run alone (`npm run test:unit`, `npm run
 * test:git`) and so a slow git suite never hides a fast unit failure. The extension-host
 * tests in test/ext use a different runner (see .vscode-test.mjs). Plan: §9.2.
 *
 * Why `.mts` and not `.ts`: this file uses `import`/`export` (ES-module syntax). Our
 * package.json has no `"type": "module"` line, so Node treats `.js` files as CommonJS, and
 * tsconfig.json `"module": "commonjs"` does the same for `.ts`. Vite therefore warns when a
 * `.ts` config uses `import`, and its next config loader will refuse it. `.mts` says
 * "TypeScript, ES module" regardless of either setting.
 */
// see primer §1 (import / export): a named import, and `export default` below
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No `passWithNoTests`: both folders have tests now, so a run that finds none (a typo
    // in a path, a misnamed file) fails loudly instead of reporting success.
    projects: [
      { test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
      { test: { name: 'git', include: ['test/git/**/*.test.ts'] } },
    ],
    // `vitest run --coverage` reports which lines of the core logic the tests reached.
    // Only src/core is measured: it is the pure part with a ≥ 95 % target (plan §9.1).
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
    },
  },
});
