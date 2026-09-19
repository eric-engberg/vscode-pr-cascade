/**
 * .vscode-test.mjs — configuration for the extension-host tests (`npm run test:ext`).
 *
 * Layer: tooling. @vscode/test-cli downloads a real VS Code into .vscode-test/ (once;
 * gitignored), launches it with this repo as the extension under development, and runs
 * the Mocha tests listed here inside that VS Code. Mocha is not our choice — VS Code's
 * harness requires it — which is why these tests are compiled to out/ first
 * (tsconfig.ext.json) instead of being run from .ts like the Vitest ones. Plan: §9.1
 * layer 3, §9.2.
 */
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  // The compiled tests; `npm run test:ext` runs `tsc -p tsconfig.ext.json` to produce them.
  files: 'out/test/ext/**/*.test.js',
  // Which VS Code to download. "stable" = the current release, i.e. what users run today;
  // engines.vscode in package.json is the oldest we support, not the one we test on.
  version: 'stable',
  mocha: {
    // "bdd" gives describe/it, the same vocabulary as the Vitest tests.
    ui: 'bdd',
    // Starting an extension host is slow; the default 2 s would fail on a cold start.
    timeout: 20_000,
  },
});
