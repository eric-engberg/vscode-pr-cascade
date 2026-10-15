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
      {
        test: {
          name: 'git',
          include: ['test/git/**/*.test.ts'],
          // Each git test file builds its repositories once, in `beforeAll`, and every git
          // command there is a separate process. trunk.git.test.ts runs about forty of
          // them (six repositories, four bare clones): around 2 s on an idle Mac, but it
          // went past Vitest's 10 s default once while another build was running — which
          // skips every test in the file. Sixty seconds is a ceiling, not a budget: a
          // hook that reaches it is broken, not slow.
          hookTimeout: 60_000,
          // The real-git-spice files (M5 item 22b) make up to four git-spice commands in one test,
          // plus the backend's `--version` probe before each of its own — 0.4–0.5 s each on an idle
          // Mac, 1.5 s for a push of three branches; the whole `git` project ran 16 s on the Ubuntu
          // runner and 41 s on the macOS one against 24 s here (first CI run, 2026-10-15) — and the
          // kill test also waits 3 s on purpose, passing the 5 s default
          // on every run by design. Two others measured 4.2 and 4.7 s here: under Vitest's 5 s
          // default, but close enough that a slower runner would go over it. Thirty seconds is a
          // ceiling, not a budget: a test that reaches it is broken, not slow. Shared arrangement
          // (building and tracking a fixture) goes in `beforeAll` (above).
          testTimeout: 30_000,
        },
      },
    ],
    // `vitest run --coverage` reports which lines of the core logic the tests reached.
    // Only src/core is measured: it is the pure part with a ≥ 95 % target (plan §9.1).
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
    },
  },
});
