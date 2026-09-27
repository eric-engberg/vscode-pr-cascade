/**
 * .vscode-test.mjs — configuration for the extension-host tests (`npm run test:ext`), and
 * the builder of the two workspaces those tests open: the fixture repository (most tests)
 * and, since M4, a parent folder with repositories below it (E1), each in a VS Code launch
 * of its own.
 *
 * Layer: tooling. @vscode/test-cli downloads a real VS Code into .vscode-test/ (once;
 * gitignored), launches it with this repo as the extension under development — once per
 * entry in the list at the bottom — and runs the Mocha tests listed for that entry inside
 * it. Depends on: @vscode/test-cli, the compiled fixture builder out/test/helpers/fixture.js.
 * Depended on by: `npm run test:ext`. Plan: §9.1 layer 3, §9.2, §8 E1/E1b/E2/E7/E9/E10/E11.
 */
import { defineConfig } from '@vscode/test-cli';
import * as fs from 'node:fs';
import * as os from 'node:os';
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
// Four changes to the Appendix A stack, all folded into the top layer's own commit
// (test/ext/tree.test.ts and test/ext/diff.test.ts look at them). First, so the view has
// a rename to show (E7):
// the top layer also moves `b`, which the middle layer added, to `b2`. Two things about
// how. The move is folded in with `--amend` (buildStack leaves HEAD on the top layer),
// because a second commit would change the `3 commits` every other test asserts;
// amending the top is safe, as no branch is built on it (E14 is about amending a
// *lower* layer). And it is `b`, not the top layer's own `c`, because the tree lists
// what a layer changes as a diff of two snapshots — the parent's and the layer's
// (core/changes.ts) — and a rename can only appear in that diff when the file exists at
// the parent: `c` does not, so `git mv c c2` would show up as nothing but an added `c2`.
fixture.git(['mv', 'b', 'b2']);
// Second, so the view has a binary file to show (E10; the `stackFileBinary` row): git
// calls a file binary when there is a NUL byte in its first 8000 bytes, and a `\0` in
// the text written here is that byte — the idiom test/git/changes.git.test.ts uses. It
// sorts after `c`, so it is the top layer's last row.
fs.writeFileSync(path.join(fixture.dir, 'logo.png'), 'PNG\0not a real picture, but binary to git\0');
fixture.git(['add', 'logo.png']);
// Third, for M3 (test/ext/diff.test.ts): a text file whose name has a space, a `#`, a
// `ü` and a `?` in it (E11). A URI has to percent-encode every one of those, and this is
// the one place the whole trip is real — the name goes from git through a vscode.Uri to
// `git show` and back — so the harness carries it rather than a unit test faking it.
// `?` is not allowed in a Windows file name, so this harness — and `npm run fixture`,
// which writes the same file — runs on macOS and Linux only, which is what CI runs
// (.github/workflows/ci.yml).
fs.writeFileSync(path.join(fixture.dir, 'weird #1 ü?.txt'), 'weird\n');
fixture.git(['add', 'weird #1 ü?.txt']);
// Fourth, a deletion (E9): the top layer removes `f`, the file trunk was made with. Its
// row is `D  f`, and the diff has content on the left and nothing on the right.
fixture.git(['rm', '-q', 'f']);
fixture.git(['commit', '-q', '--amend', '--no-edit']);
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
// so whoever finds the repository — the built-in Git extension since M4 — meets E1b before the root.
const workspaceFile = path.join(path.dirname(fixture.dir), 'fixture.code-workspace');
fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [{ path: nestedDir }, { path: fixture.dir }] }));

// The second workspace, for E1 (plan §8; test/ext-parent): Ric's layout — a parent folder
// that is not a repository, with a repository one level below it and another two levels
// down. Since M4 the built-in Git extension finds the repositories, and it looks *below* a
// workspace folder only in its initial scan, when the window opens; a parent folder added
// to a running workspace is opened as a repository itself and never scanned. So the layout
// has to be in the workspace at launch, and it gets a launch of its own rather than a
// folder added to the first one at run time (which is what the M1 scan-settings test did).
// The parent is a fresh `mkdtemp` every run — the Git extension remembers, per path, roots
// it has asked the user about (plan §9.1), and a path that never repeats cannot meet such a
// memory. The two repositories come from the fixture builder and are moved into place: it
// always names its repository `repo`, and the test names the root it expects by folder.
const parentDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pr-cascade-parent-')));
const one = buildStack();
fs.renameSync(one.dir, path.join(parentDir, 'one'));
fs.mkdirSync(path.join(parentDir, 'deep'));
const two = buildStack();
fs.renameSync(two.dir, path.join(parentDir, 'deep', 'two'));
// Each builder's scratch directory still holds that repository's origin; the parent holds
// the moved repositories. All of it goes at exit, as above.
process.on('exit', () => {
  one.cleanup();
  two.cleanup();
  fs.rmSync(parentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

// Shared by both launches. "bdd" gives describe/it, the same vocabulary as the Vitest
// tests; starting an extension host is slow, so the default 2 s timeout would fail on a
// cold start.
const mocha = { ui: 'bdd', timeout: 20_000 };

// One entry per launch: the harness starts VS Code once for each, on that entry's
// workspace, and runs that entry's test files inside it. `npm run test:ext` runs
// `tsc -p tsconfig.ext.json` first to produce the compiled tests under out/. Mocha is not
// our choice — VS Code's harness requires it — and it runs JavaScript, which is why the
// tests are compiled to out/ first instead of being run from .ts like the Vitest ones.
// "stable" = the current VS Code release, i.e. what users run today; engines.vscode in
// package.json is the oldest we support, not the one we test on. The labels are for
// running one file by hand — `npx vscode-test -l fixture --run out/test/ext/tree.test.js`
// — because `--run` alone runs the file in *every* launch, and a fixture test run inside
// the parent-folder launch adds folders to that workspace, which VS Code then remembers in
// .vscode-test/user-data and restores for the next run (delete that directory to recover).
export default defineConfig([
  {
    label: 'fixture',
    files: 'out/test/ext/**/*.test.js',
    version: 'stable',
    // The two-folder workspace built above.
    workspaceFolder: workspaceFile,
    mocha,
  },
  {
    label: 'parent',
    files: 'out/test/ext-parent/**/*.test.js',
    version: 'stable',
    // The parent folder, opened on its own.
    workspaceFolder: parentDir,
    mocha,
  },
]);
