/**
 * .vscode-test.mjs — configuration for the extension-host tests (`npm run test:ext`), and
 * the builder of the fixture workspace those tests open.
 *
 * Layer: tooling. @vscode/test-cli downloads a real VS Code into .vscode-test/ (once;
 * gitignored), launches it with this repo as the extension under development, and runs
 * the Mocha tests listed here inside it. Depends on: @vscode/test-cli, the compiled
 * fixture builder out/test/helpers/fixture.js. Depended on by: `npm run test:ext`.
 * Plan: §9.1 layer 3, §9.2, §8 E1b/E2.
 */
import { defineConfig } from '@vscode/test-cli';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildStack } from './out/test/helpers/fixture.js';

// The workspace the tests open is a throwaway repository holding the plan Appendix A
// stack, made by the same fixture builder the git tests use (test/helpers/fixture.ts —
// imported above as the compiled copy under out/, which `tsc -p tsconfig.ext.json`
// writes before this file is loaded). Below, the workspace lists the repository twice, as
// a nested subfolder and as the root, so the tree must find the repository from a
// subfolder (E1b) and show it once (E2). Built in a temporary directory: `<scratch>/repo`
// with `origin.git` beside it.
const fixture = buildStack();
// The CLI process that loads this file outlives the VS Code it launches, so the scratch
// directory is removed when that process exits — after every test has run. A Ctrl+C
// during the run gets there too: @vscode/test-electron (what the CLI launches VS Code
// through) catches it, closes VS Code, then ends this process with process.exit, and
// 'exit' fires. Only a Ctrl+C during the one-time VS Code download, before
// @vscode/test-electron's Ctrl+C handler is installed (a plain Ctrl+C kills the process
// without running 'exit' handlers), can leave a `pr-cascade-fixture-*` directory behind
// in the temp folder.
process.on('exit', () => fixture.cleanup());

// An empty subfolder is enough for E1b: git ignores empty directories, so the repository
// is unchanged, and opening it as a workspace folder is opening "a nested subfolder of
// the repository".
const nestedDir = path.join(fixture.dir, 'nested');
fs.mkdirSync(nestedDir);

// A `.code-workspace` file is how VS Code opens several folders at once (a "multi-root
// workspace"). Both entries resolve to the one repository; the nested one comes first
// so discovery meets E1b before it meets the root.
const workspaceFile = path.join(path.dirname(fixture.dir), 'fixture.code-workspace');
fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [{ path: nestedDir }, { path: fixture.dir }] }));

export default defineConfig({
  // The compiled tests; `npm run test:ext` runs `tsc -p tsconfig.ext.json` to produce them.
  // Mocha is not our choice — VS Code's harness requires it — and it runs JavaScript,
  // which is why these tests are compiled to out/ first instead of being run from .ts
  // like the Vitest ones.
  files: 'out/test/ext/**/*.test.js',
  // Which VS Code to download. "stable" = the current release, i.e. what users run today;
  // engines.vscode in package.json is the oldest we support, not the one we test on.
  version: 'stable',
  // What the launched VS Code opens: the two-folder workspace built above.
  workspaceFolder: workspaceFile,
  mocha: {
    // "bdd" gives describe/it, the same vocabulary as the Vitest tests.
    ui: 'bdd',
    // Starting an extension host is slow; the default 2 s would fail on a cold start.
    timeout: 20_000,
  },
});
