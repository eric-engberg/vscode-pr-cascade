/**
 * test/ext/tree.test.ts — the Stack view inside a real VS Code, over the fixture workspace
 * .vscode-test.mjs built: branch names top-first with counts, the current marker, SHAs in
 * tooltips only; the files under each layer (its own only, a rename, a binary, a deletion,
 * the click that runs `prCascade.openDiff`, the cache, an error row); the two rows that
 * stand above the layers (a paused rebase, a detached HEAD); the one-row messages; the
 * refresh the view does by itself after a commit made outside VS Code (E20); and what
 * git-spice knows about each layer (E56, E57; M5 item 20b) — the texts, the vocabulary, the
 * tooltips, nothing when it is not set up, and the digest that spares a `gs log` per refresh.
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * Depends on: the running extension (what activate() returns), the fixture workspace, the
 * real built-in Git extension through test/ext/helpers/gitApi.ts (E20), and
 * test/helpers/fakeCommand.ts (a fake git-spice through the seams `activate()` returns in test
 * mode). Depended on by: nothing. Plan: §6, §7.1, §7.2, §7.8, §7.14.2, §8
 * E1b/E2/E3/E4/E5/E7/E9/E10/E12/E17/E20/E44/E56/E57/E59/E62, §9.4, §13.2 D60.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { CommandResult } from '../../src/core/command';
import type { ExtensionApi, ReadinessDeps } from '../../src/extension';
import type { StackNode, StackTreeProvider } from '../../src/vscode/tree';
import { exited, FakeCommandRunner, neverStarted } from '../helpers/fakeCommand';
import { realGitApi } from './helpers/gitApi';

// The plan Appendix A stack as the view must list it: top layer first (plan §7.1). The
// fixture leaves HEAD on retry-metrics.
// see primer §4 (const)
const LAYERS_TOP_FIRST = ['retry-metrics', 'add-retries', 'api-refactor'];

// The tree provider, taken from the activated extension once for the whole file (in the
// `before` hook below). Everything is reached through it — `getChildren()` for the rows,
// `getTreeItem(row)` for how each is drawn — the same two calls VS Code makes.
let provider: StackTreeProvider;
// An output channel for the adapter the E20 test builds to reach the Git extension's API.
let output: vscode.OutputChannel;
// The setup flow's seams, from the handle `activate()` returns in test mode: the E56 block puts a
// fake git-spice in `deps.commands` (a new runner is a new backend, with an empty memo) and the
// real one back in `after`.
let deps: ReadinessDeps;
let real: ReadinessDeps;

// The fake git-spice's keys (executable and arguments joined by spaces), as `enrich` asks them.
const VERSION = 'git-spice --no-prompt --version';
const GS_VERSION = 'gs --no-prompt --version';
const LOG = 'git-spice --no-prompt log short --all --json';
const BANNER = 'git-spice 0.31.2\nCopyright (C) Abhinav Gupta\n';

// What `gs log short --all --json` would print for the fixture with its bottom two layers
// tracked: git-spice's own trunk line, the bottom layer with a pull request, the middle one
// needing a restack and a push; the top layer absent — not tracked. One line per JSON object.
// see primer §12 (template strings)
const PR_URL = 'https://example.invalid/pull/12';
const TRUNK_LINE = '{"name":"main","ups":[{"name":"api-refactor"}]}\n';
const BOTTOM_LINE = `{"name":"api-refactor","down":{"name":"main"},"change":{"id":"#12","url":"${PR_URL}"},"push":{"ahead":0,"behind":0}}\n`;
const MIDDLE_LINE = '{"name":"add-retries","down":{"name":"api-refactor","needsRestack":true},"push":{"ahead":1,"behind":0,"needsPush":true}}\n';
const FIXTURE_LINES = TRUNK_LINE + BOTTOM_LINE + MIDDLE_LINE;

/** A fake git-spice that answers its banner and `gs log` with `lines`, installed in the extension's seams; returned so a test can read what it ran. */
// see primer §19 (Map) and §31 (type arguments on `new Map`)
function useFakeGitSpice(canned: Map<string, CommandResult>): FakeCommandRunner {
  const runner = new FakeCommandRunner(canned);
  deps.commands = runner;
  return runner;
}

/** The canned answers for a git-spice that is there and prints `lines` for `gs log`. */
function answering(lines: string): Map<string, CommandResult> {
  return new Map<string, CommandResult>([
    [VERSION, exited(0, BANNER)],
    [LOG, exited(0, lines)],
  ]);
}

/** What `gs repo init` writes, standing in for it: the ref whose existence is the initialised check (plan §7.6). */
function initialise(): void {
  runGit(['update-ref', 'refs/spice/data', 'HEAD']);
}

/** Undoes initialise; exit 0 even when the ref is not there, so a `finally` needs no check. */
function uninitialise(): void {
  runGit(['update-ref', '-d', 'refs/spice/data']);
}

/** The rows at the top of the view, drawn: what VS Code would show under "Stack". */
// see primer §6 (async / await) and §25 (arrays: map)
async function topLevelItems(): Promise<vscode.TreeItem[]> {
  const nodes = await provider.getChildren();
  return nodes.map((node) => provider.getTreeItem(node));
}

/**
 * The row for the layer named `branch`, as the provider holds it — a node, not yet drawn —
 * so it can be handed back to `getChildren` the way VS Code hands back the row a user
 * opens. Found by label, since a label is the branch name (E44).
 */
// see primer §22 (for ... of) and §34 (StackNode, the union of row kinds)
async function layerNode(branch: string): Promise<StackNode> {
  const nodes = await provider.getChildren();
  for (const node of nodes) {
    if (provider.getTreeItem(node).label === branch) {
      return node;
    }
  }
  throw new Error(`the view has no layer row labelled ${branch}`);
}

/** The rows under the layer named `branch`, drawn: what VS Code shows when that row is opened. */
async function filesUnderLayer(branch: string): Promise<vscode.TreeItem[]> {
  const layer = await layerNode(branch);
  const nodes = await provider.getChildren(layer);
  return nodes.map((node) => provider.getTreeItem(node));
}

/**
 * The repository root: the workspace folder named `repo`; the other folder is the empty
 * `nested` subfolder inside it.
 */
// see primer §25 (arrays: find) and §30 (`??`)
function repositoryRoot(): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const repo = folders.find((folder) => path.basename(folder.uri.fsPath) === 'repo');
  if (repo === undefined) {
    throw new Error('the fixture workspace has no folder named repo');
  }
  return repo.uri.fsPath;
}

/**
 * Runs `git <args>` in the fixture repository and returns what it printed. It carries the
 * part of the fixture builder's hermetic environment (test/helpers/fixture.ts, plan §9.1)
 * these commands need — no global or system config, English messages — so nothing on the
 * developer's machine can change the answer, whether git is asked a question or told to
 * check out a branch. The identity variables are for the one commit the E20 test makes.
 * git's stderr is captured, not echoed into the test log, as the fixture builder does: Node
 * puts it into the error message when git exits non-zero, so a failing step says what git
 * said — and a step that is *meant* to exit non-zero (the paused rebase of the E12 test,
 * which warns "execution failed: false") stays silent in a green run.
 */
// see primer §28 (the Sync variants of Node's functions) and §16 (object literals: spread)
function runGit(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repositoryRoot(),
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      LC_ALL: 'C',
      GIT_AUTHOR_NAME: 'PR Cascade test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'PR Cascade test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
    // stdin closed (no command can wait for input), stdout returned, stderr captured.
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

/** What `git rev-parse <ref>` prints, without its newline: the full SHA of a ref. */
function shaOf(ref: string): string {
  const output = runGit(['rev-parse', ref]);
  return output.trim();
}

/** The first seven characters of that SHA — what the tooltips must show. */
function shortShaOf(ref: string): string {
  return shaOf(ref).slice(0, 7);
}

/**
 * Resolves on the next `onDidChangeTreeData`, or rejects after `deadlineMs` naming the
 * wait — so a test that expects a refresh and gets none fails at once with its cause, and
 * its `finally` still runs (a Mocha timeout would skip it and leave the fixture changed).
 * Set up before whatever should cause the refresh, so nothing can slip past it.
 */
// see primer §42 (waiting for an event with new Promise) and §58 (setTimeout and
// clearTimeout: a wait with a deadline)
function nextTreeChange(deadlineMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error(`no onDidChangeTreeData within ${deadlineMs} ms`));
    }, deadlineMs);
    const subscription = provider.onDidChangeTreeData(() => {
      clearTimeout(timer);
      subscription.dispose();
      resolve();
    });
  });
}

// see primer §5 (arrow functions)
describe('the Stack view', () => {
  // Runs once before the tests in this block: activate the extension and keep its provider.
  before(async () => {
    // see primer §31 (a type argument on a call): `getExtension<ExtensionApi>` tells the
    // compiler what activate() returns, so `api.provider` below is typed.
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    // see primer §8 (undefined and narrowing)
    assert.ok(extension, 'the extension was not loaded');
    const api = await extension.activate();
    assert.ok(api.readinessDeps, 'activate() returned no readinessDeps — the extension host is not in ExtensionMode.Test');
    provider = api.provider;
    deps = api.readinessDeps;
    // see primer §16 (object literals: spread — a copy of the fields, not the object itself)
    real = { ...deps };
    output = vscode.window.createOutputChannel('PR Cascade tree tests');
  });

  after(() => {
    deps.commands = real.commands;
    output.dispose();
  });

  it('shows the layers at the top level: the two workspace folders are one repository, found from its subfolder (E1b) and listed once (E2)', async () => {
    // precondition, not the idea under test: the workspace .vscode-test.mjs built has the
    // nested folder first, then the root — the shape E1b and E2 need. Fails fast otherwise.
    // (E1b, not E1: plan §8's E1 row is a repository *below* a folder; since M4 both rows
    // are the built-in Git extension's to satisfy — test/ext/gitApi.test.ts, plan §7.14.)
    const folders = vscode.workspace.workspaceFolders ?? [];
    const folderNames = folders.map((folder) => path.basename(folder.uri.fsPath));
    assert.deepStrictEqual(folderNames, ['nested', 'repo']);

    // arrange: nothing beyond that workspace

    // act
    const items = await topLevelItems();

    // assert: three layer rows, directly at the top (plan §6, one repository) — not a
    // row per folder, not a repository row above them, not a "no repository" message
    assert.strictEqual(items.length, 3);
    for (const item of items) {
      // see primer §8 (undefined and narrowing): contextValue may be unset on a TreeItem
      assert.ok(item.contextValue !== undefined, 'a row without a contextValue');
      assert.ok(item.contextValue.startsWith('stackBranch'), `not a layer row: contextValue ${item.contextValue}`);
    }
  });

  it('labels every layer with its branch name, top layer first (E44)', async () => {
    // arrange: nothing beyond the fixture

    // act
    const items = await topLevelItems();

    // assert: the label is the name — not "heads/<name>", not the SHA, nothing added
    const labels = items.map((item) => item.label);
    assert.deepStrictEqual(labels, LAYERS_TOP_FIRST);
  });

  it('puts no SHA in any label — SHAs belong in tooltips (E44)', async () => {
    // arrange: nothing beyond the fixture

    // act
    const items = await topLevelItems();

    // assert: no run of seven hex digits anywhere in a label. A branch name can contain
    // a few (`add`, `dead-code`); an abbreviated SHA is seven or more in a row.
    // see primer §20 (regular expression literals)
    for (const item of items) {
      // see primer §17 (narrowing with typeof): a label may also be a richer object
      if (typeof item.label !== 'string') {
        assert.fail('expected a plain-string label');
      }
      assert.doesNotMatch(item.label, /[0-9a-f]{7}/);
    }
  });

  it('describes each layer by its distance from trunk, and marks the layer HEAD is on', async () => {
    // arrange: nothing beyond the fixture — one commit per layer, HEAD on the top one

    // act
    const items = await topLevelItems();

    // assert: `N commits` (singular for one), `· current` only on retry-metrics
    const descriptions = items.map((item) => item.description);
    assert.deepStrictEqual(descriptions, ['3 commits · current', '2 commits', '1 commit']);
  });

  it('marks the current layer stackBranchCurrent and the others stackBranch (plan §7.2.1)', async () => {
    // arrange: nothing beyond the fixture — HEAD on the top layer

    // act
    const items = await topLevelItems();

    // assert: the contextValue is what every later context menu keys on
    const contextValues = items.map((item) => item.contextValue);
    assert.deepStrictEqual(contextValues, ['stackBranchCurrent', 'stackBranch', 'stackBranch']);
  });

  it('gives the current layer the target icon and the others git-branch (plan §7.1)', async () => {
    // arrange: nothing beyond the fixture — HEAD on the top layer

    // act
    const items = await topLevelItems();

    // assert: each icon is a ThemeIcon (a codicon by name), and the name is the marker
    const iconNames: string[] = [];
    for (const item of items) {
      assert.ok(item.iconPath instanceof vscode.ThemeIcon, 'expected a ThemeIcon');
      iconNames.push(item.iconPath.id);
    }
    assert.deepStrictEqual(iconNames, ['target', 'git-branch', 'git-branch']);
  });

  it('puts the SHAs in the tooltip: the layer and what it sits on, trunk for the bottom layer', async () => {
    // arrange: what git says each ref points at, asked directly
    const expectedTop = `retry-metrics @ ${shortShaOf('retry-metrics')}\nbase: add-retries @ ${shortShaOf('add-retries')}`;
    const expectedBottom = `api-refactor @ ${shortShaOf('api-refactor')}\nbase: origin/main @ ${shortShaOf('origin/main')}`;

    // act
    const items = await topLevelItems();

    // assert
    assert.strictEqual(items[0].tooltip, expectedTop);
    assert.strictEqual(items[2].tooltip, expectedBottom);
  });

  // What VS Code asks for when a layer row is opened: the files that layer changes against
  // the layer below it (plan §7.1 "File nodes"; §10 M2 "done when"). The harness fixture
  // is the Appendix A stack with four changes to its top layer (.vscode-test.mjs says why
  // these): it also moves `b`, which the middle layer added, to `b2` — so there is a
  // rename to look at (E7) — adds a small binary file, `logo.png` (E10), beside its `c`,
  // and, for M3's diff tests, adds a text file named `weird #1 ü?.txt` (E11) and deletes
  // trunk's `f` (E9).
  describe('the files under a layer', () => {
    it('lists under each layer exactly the files that layer changes against the one below it, never what the layers below it changed (M2 "done when")', async () => {
      // arrange: nothing beyond the fixture

      // act
      const bottom = await filesUnderLayer('api-refactor');
      const middle = await filesUnderLayer('add-retries');
      const top = await filesUnderLayer('retry-metrics');

      // assert: the status letter, two spaces, the file's name (plan §12 item 3). `a` is
      // under the bottom layer only, although every layer above it has the file too; the
      // top layer's five rows are in git's order (by path), the rename first.
      assert.deepStrictEqual(bottom.map((item) => item.label), ['A  a']);
      assert.deepStrictEqual(middle.map((item) => item.label), ['A  b']);
      assert.deepStrictEqual(top.map((item) => item.label), ['R  b2', 'A  c', 'D  f', 'A  logo.png', 'A  weird #1 ü?.txt']);
    });

    it('draws every layer row collapsed, so it can be opened (plan §7.1)', async () => {
      // arrange: nothing beyond the fixture

      // act
      const items = await topLevelItems();

      // assert: M1 drew a layer as a leaf; now it has children and starts folded
      // see primer §35 (enum values from the VS Code API)
      for (const item of items) {
        assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
      }
    });

    it('marks a text file\'s row stackFile and a binary file\'s stackFileBinary — the contextValues the file-row menus will key on (plan §7.2.1, E10)', async () => {
      // arrange: nothing beyond the fixture — the top layer's `b2`, `c`, `f` and
      // `weird #1 ü?.txt` are text, its `logo.png` has a NUL byte in it, which is what
      // makes git call a file binary (the flag itself comes from numstat;
      // test/git/changes.git.test.ts covers that, E10)

      // act
      const top = await filesUnderLayer('retry-metrics');

      // assert: one value per row, in the rows' order
      const contextValues = top.map((item) => item.contextValue);
      assert.deepStrictEqual(contextValues, ['stackFile', 'stackFile', 'stackFile', 'stackFileBinary', 'stackFile']);
    });

    it('names the file by its absolute path in resourceUri, so VS Code draws its file icon and decorations', async () => {
      // arrange: nothing beyond the fixture

      // act
      const bottom = await filesUnderLayer('api-refactor');

      // assert: the URI's path is `<repository root>/a`, which is where the file is —
      // the root is the physical path the Git extension reports, the same one VS Code
      // lists for the `repo` folder
      // see primer §8 (undefined and narrowing) and §42 (Uri: `fsPath` is the path back)
      const resourceUri = bottom[0].resourceUri;
      assert.ok(resourceUri !== undefined, 'a file row without a resourceUri');
      assert.strictEqual(resourceUri.fsPath, path.join(repositoryRoot(), 'a'));
    });

    it('leaves the description empty for a file at the repository root — the description is the directory — and puts the path in the tooltip', async () => {
      // arrange: nothing beyond the fixture — `a` sits at the root

      // act
      const bottom = await filesUnderLayer('api-refactor');

      // assert: `path.dirname('a')` is `.`, and the row does not show that
      assert.strictEqual(bottom[0].description, '');
      assert.strictEqual(bottom[0].tooltip, 'a');
    });

    it('shows a rename as `R  <new name>`, with `old → new` as the description and the tooltip (E7)', async () => {
      // arrange: nothing beyond the fixture — the top layer moves `b` to `b2`

      // act
      const top = await filesUnderLayer('retry-metrics');

      // assert: both paths in full (plan §7.1), in place of the directory
      assert.strictEqual(top[0].label, 'R  b2');
      assert.strictEqual(top[0].description, 'b → b2');
      assert.strictEqual(top[0].tooltip, 'b → b2');
    });

    it('runs prCascade.openDiff with the row\'s own node when clicked (plan §7.2), and has nothing underneath', async () => {
      // arrange: the bottom layer's one file, as a node and as drawn
      const layer = await layerNode('api-refactor');
      const fileNodes = await provider.getChildren(layer);
      const item = provider.getTreeItem(fileNodes[0]);

      // act: what VS Code would ask if the row were opened
      const underneath = await provider.getChildren(fileNodes[0]);

      // assert: a leaf whose `command` slot names the diff command and carries the node
      // itself — the very object the provider holds, not a copy — as its one argument;
      // what the command does with it is test/ext/diff.test.ts's subject
      // see primer §8 (undefined and narrowing) and §52 (TreeItem.command)
      assert.ok(item.command !== undefined, 'a file row without a command');
      assert.strictEqual(item.command.command, 'prCascade.openDiff');
      assert.strictEqual(item.command.title, 'Open Changes');
      assert.ok(item.command.arguments !== undefined, 'a command without arguments');
      assert.strictEqual(item.command.arguments.length, 1);
      assert.strictEqual(item.command.arguments[0], fileNodes[0]);
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
      assert.deepStrictEqual(underneath, []);
    });

    it('answers a second getChildren for the same pair of commits from the cache, without asking git', async () => {
      // arrange: the layer row, and a first getChildren that fills the provider's cache
      // for its pair of commits (vscode/tree.ts, filesByCommitPair) — after a refresh(),
      // so the entry is this test's own and not one an earlier test left. Then a
      // `prCascade.gitPath` that does not exist, with *no* refresh() this time.
      // src/extension.ts builds the runner from the setting on every call, so from here
      // on any list that reaches git is an error row (the E17 test below shows exactly
      // that, with a refresh() in between); a second ask that still answers the files
      // can only have come from the cache. VS Code itself never asks twice between
      // refreshes — a row closed and reopened keeps the children it has — so this is
      // the one place the map is seen answering. Written at Workspace level, and removed
      // again in `finally`.
      // see primer §18 (try / finally) and §35 (ConfigurationTarget)
      const layer = await layerNode('retry-metrics');
      provider.refresh();
      const firstNodes = await provider.getChildren(layer);
      const first = firstNodes.map((node) => provider.getTreeItem(node));
      const configuration = vscode.workspace.getConfiguration('prCascade');
      await configuration.update('gitPath', '/nowhere/git', vscode.ConfigurationTarget.Workspace);
      try {
        // act
        const secondNodes = await provider.getChildren(layer);
        const second = secondNodes.map((node) => provider.getTreeItem(node));

        // assert: the same file rows as the first ask — not one error row
        assert.deepStrictEqual(
          second.map((item) => item.label),
          first.map((item) => item.label),
        );
        assert.deepStrictEqual(
          second.map((item) => item.contextValue),
          ['stackFile', 'stackFile', 'stackFile', 'stackFileBinary', 'stackFile'],
        );
      } finally {
        await configuration.update('gitPath', undefined, vscode.ConfigurationTarget.Workspace);
      }
    });

    it('shows one error row under the layer, with the message from RealGitRunner, when git cannot list its files (E17)', async () => {
      // arrange: the layer row, taken while git works; then a `prCascade.gitPath` that
      // does not exist. refresh() empties the provider's cache, so the next open of the
      // layer asks git — and src/extension.ts builds the runner from the setting on every
      // call, so the git it asks is the missing one. Written at Workspace level, and
      // removed again in `finally`, as the E17 test at the top level does. The message
      // names the command that never ran: the first of changedFiles' two
      // (core/changes.ts), over the two SHAs the layer carries — trunk's and the bottom
      // layer's here — and not over the names `origin/main` and `api-refactor`. That is
      // the choice core/changes.ts spends a paragraph on, and this row is the one place
      // the view can be seen making it.
      // see primer §18 (try / finally) and §35 (ConfigurationTarget)
      const parentSha = shaOf('origin/main');
      const sha = shaOf('api-refactor');
      const expectedMessage = `git not found at /nowhere/git (while running: git diff --name-status -M -z ${parentSha} ${sha} --)`;
      const layer = await layerNode('api-refactor');
      provider.refresh();
      const configuration = vscode.workspace.getConfiguration('prCascade');
      await configuration.update('gitPath', '/nowhere/git', vscode.ConfigurationTarget.Workspace);
      try {
        // act
        const nodes = await provider.getChildren(layer);
        const items = nodes.map((node) => provider.getTreeItem(node));

        // assert: one row under the layer — not a rejected Promise, not an empty list
        // that would read as "this layer changes nothing" — with git's own message and
        // the error icon
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].label, expectedMessage);
        assert.ok(items[0].iconPath instanceof vscode.ThemeIcon, 'expected a ThemeIcon');
        assert.strictEqual(items[0].iconPath.id, 'error');
      } finally {
        await configuration.update('gitPath', undefined, vscode.ConfigurationTarget.Workspace);
      }
    });
  });

  it('tells VS Code the whole tree changed when refresh() is called', () => {
    // arrange: listen the way VS Code does
    // see primer §32 (EventEmitter and Event)
    const received: unknown[] = [];
    const subscription = provider.onDidChangeTreeData((node) => {
      received.push(node);
    });

    // act
    provider.refresh();

    // assert: fired once, with `undefined` — "start again from the top"
    subscription.dispose();
    assert.deepStrictEqual(received, [undefined]);
  });

  it('refreshes by itself after a commit made outside VS Code, once the Git extension has run its status (E20)', async () => {
    // arrange: the tree-change listener first — the only sign that our handler ran, since
    // refresh() recomputes nothing itself, it only tells VS Code to ask again (plan §9.1) —
    // and the fixture repository as the Git extension holds it. Five seconds is twenty
    // times the debounce and leaves room for the `finally`'s own wait inside Mocha's 20 s.
    // see primer §27 (`_` between digits: `5_000` is 5000)
    const changed = nextTreeChange(5_000);
    const api = await realGitApi(output);
    const repository = api.repositories.find((candidate) => candidate.rootUri.fsPath === repositoryRoot());
    assert.ok(repository !== undefined, 'the Git extension has not opened the fixture repository');
    try {
      // act: a commit from outside VS Code — a terminal, in real life — on the current (top)
      // layer; then the status the Git extension would run once the window regains focus,
      // run at once instead (`status()` skips the focus wait, plan §7.14.2); then wait for
      // the view to say it changed. Nothing here calls refresh: without the adapter's
      // status listener, or the wiring in src/extension.ts, `changed` rejects at its deadline.
      runGit(['commit', '-q', '--allow-empty', '-m', 'made outside VS Code']);
      await repository.status();
      await changed;

      // assert: the redraw shows the new commit — the top layer is one commit longer
      const items = await topLevelItems();
      assert.deepStrictEqual(items.map((item) => item.description), ['4 commits · current', '2 commits', '1 commit']);
    } finally {
      // Put the fixture back for the tests after this one; let the Git extension see that
      // too, and wait for the refresh it causes, so this test leaves no refresh() pending
      // for the next one.
      const restored = nextTreeChange(5_000);
      runGit(['reset', '-q', '--hard', 'HEAD~1']);
      await repository.status();
      await restored;
    }
  });

  // The two rows that stand above the layers (plan §7.1.0; M4 item 13b): a paused rebase
  // (E12) and a detached HEAD (E3). Each test puts the fixture repository into the state
  // and undoes it in `finally`, as the one-row-message tests below do.
  describe('the row above the layers', () => {
    it('puts "Detached HEAD" above the layers, none of them current, when HEAD is detached (E3)', async () => {
      // arrange: HEAD at the top layer's commit, as a commit rather than a branch
      runGit(['checkout', '-q', '--detach']);
      try {
        // act
        const items = await topLevelItems();

        // assert: the row first, drawn as information — nothing is wrong, the view still
        // does its job — with the empty contextValue that keeps every menu away; the
        // layers follow, and no layer is current
        assert.deepStrictEqual(items.map((item) => item.label), ['Detached HEAD', 'retry-metrics', 'add-retries', 'api-refactor']);
        assert.ok(items[0].iconPath instanceof vscode.ThemeIcon, 'expected a ThemeIcon');
        assert.strictEqual(items[0].iconPath.id, 'info');
        assert.strictEqual(items[0].contextValue, '');
        // see primer §25 (arrays: slice — the elements from position 1 on: the layers without the row above them)
        assert.deepStrictEqual(items.slice(1).map((item) => item.description), ['3 commits', '2 commits', '1 commit']);
      } finally {
        runGit(['checkout', '-q', 'retry-metrics']);
      }
    });

    it('puts "Rebase in progress — resolve it first" above the layers git still finds while a rebase is paused, and no "Detached HEAD" row (E12)', async () => {
      // arrange: a rebase of the stack onto trunk that stops after the first replayed
      // commit — `-x false` runs `false` after each one — leaving HEAD detached at the
      // bottom layer's commit and git's rebase-merge directory in place. execFileSync
      // throws on git's non-zero exit, which here is the paused state, not a failure.
      // see primer §18 (try / catch: a `catch` with no name for the error)
      try {
        runGit(['rebase', '-x', 'false', 'main']);
      } catch {
        // Expected: exit 1 after "warning: execution failed: false".
      }
      // precondition, not the idea under test: the rebase did pause (plan §5: where this
      // working tree keeps the directory, as git itself says)
      const rebaseDir = path.resolve(repositoryRoot(), runGit(['rev-parse', '--git-path', 'rebase-merge']).trim());
      assert.ok(fs.existsSync(rebaseDir), 'the rebase did not pause');
      try {
        // act
        const items = await topLevelItems();

        // assert: the warning row — a state the user can change — then the one layer below
        // the pause; HEAD is detached too, but the rebase row says why, so no second row
        assert.deepStrictEqual(items.map((item) => item.label), ['Rebase in progress — resolve it first', 'api-refactor']);
        assert.ok(items[0].iconPath instanceof vscode.ThemeIcon, 'expected a ThemeIcon');
        assert.strictEqual(items[0].iconPath.id, 'warning');
        assert.strictEqual(items[0].contextValue, '');
        assert.strictEqual(items[1].description, '1 commit');
      } finally {
        runGit(['rebase', '--abort']);
      }
    });
  });

  // Each test here puts the repository or the settings into one plan §8 state and undoes
  // it before finishing, so the tests above see the fixture as built whatever order Mocha
  // runs them in. Settings are read on every refresh (src/vscode/config.ts), so a changed
  // setting is seen by the very next getChildren, with no reload.
  describe('when there is no stack to draw', () => {
    it('says "Not on a stack" when HEAD is on trunk (E5)', async () => {
      // arrange: HEAD on trunk — every layer is now above HEAD, so none is an ancestor
      // of it and computeStack finds no layers
      runGit(['checkout', '-q', 'main']);
      // see primer §18 (try / finally): the checkout at the end runs even if an
      // assertion fails, so a failure here cannot leave the fixture on the wrong branch
      try {
        // act
        const items = await topLevelItems();

        // assert: one message row, with the empty contextValue that keeps every menu away
        const labels = items.map((item) => item.label);
        assert.deepStrictEqual(labels, ['Not on a stack']);
        assert.strictEqual(items[0].contextValue, '');
      } finally {
        runGit(['checkout', '-q', 'retry-metrics']);
      }
    });

    it('says "No trunk found — set prCascade.trunk" when the configured trunk does not exist (E4)', async () => {
      // arrange: a `prCascade.trunk` naming a ref the repository does not have. detectTrunk
      // (core/trunk.ts) does not fall back from a configured ref, so there is no trunk.
      // Written at Workspace level: that lands in the fixture's .code-workspace file, not
      // in the user settings of the test VS Code.
      // see primer §35 (enum values from the VS Code API: ConfigurationTarget)
      const configuration = vscode.workspace.getConfiguration('prCascade');
      await configuration.update('trunk', 'no-such-ref', vscode.ConfigurationTarget.Workspace);
      try {
        // act
        const items = await topLevelItems();

        // assert
        const labels = items.map((item) => item.label);
        assert.deepStrictEqual(labels, ['No trunk found — set prCascade.trunk']);
      } finally {
        // `undefined` removes the key, so the default from package.json applies again.
        await configuration.update('trunk', undefined, vscode.ConfigurationTarget.Workspace);
      }
    });

    it('shows one error row with the message from RealGitRunner when git cannot be run (E17)', async () => {
      // arrange: a `prCascade.gitPath` that does not exist. The repositories come from the
      // built-in Git extension, so the first git command of *our* pipeline is trunk
      // detection's read of `origin/HEAD` (core/trunk.ts, remoteDefaultBranch), and
      // RealGitRunner (core/git.ts) phrases a git that never started as "git not found
      // at <path>", naming the command it was about to run. (Until M4 the first command
      // was the scan's `rev-parse --show-toplevel`.)
      const configuration = vscode.workspace.getConfiguration('prCascade');
      await configuration.update('gitPath', '/nowhere/git', vscode.ConfigurationTarget.Workspace);
      try {
        // act
        const items = await topLevelItems();

        // assert: one row, git's message as its label, drawn with the error icon
        const labels = items.map((item) => item.label);
        assert.deepStrictEqual(labels, [
          'git not found at /nowhere/git (while running: git symbolic-ref --quiet --short refs/remotes/origin/HEAD)',
        ]);
        assert.ok(items[0].iconPath instanceof vscode.ThemeIcon, 'expected a ThemeIcon');
        assert.strictEqual(items[0].iconPath.id, 'error');
      } finally {
        await configuration.update('gitPath', undefined, vscode.ConfigurationTarget.Workspace);
      }
    });
  });

  // Plan §7.8's local tier (M5 item 20b, D60): what `gs log short --all --json` says about each
  // layer, drawn into the description, the contextValue and the tooltip — through a fake
  // git-spice in the extension's seams, never the real one. Two rules every case keeps. The fake
  // is installed *before* `refs/spice/data` is written: src/extension.ts reads the seams when a
  // load reaches the backend, and a load VS Code started on its own could otherwise reach the
  // real git-spice between the two steps. And every case deletes the ref and restores the runner
  // in `finally`, so the tests above see the fixture as built.
  describe('what git-spice knows about each layer (E56, E57)', () => {
    before(() => {
      // A ref a failed run left behind would make every case here start initialised.
      uninitialise();
    });

    it('shows the pull request id, the two to-dos and `not tracked` beside the count, in that order, with `· current` last (E56)', async () => {
      // arrange: a git-spice that tracks the bottom two layers, then the ref it would have written
      useFakeGitSpice(answering(FIXTURE_LINES));
      initialise();
      try {
        // act
        const items = await topLevelItems();

        // assert: the texts of plan §7.8, labels and icons as before (E44)
        assert.deepStrictEqual(
          items.map((item) => item.description),
          ['3 commits · not tracked · current', '2 commits · needs restack · needs push', '1 commit · #12'],
        );
        assert.deepStrictEqual(items.map((item) => item.label), LAYERS_TOP_FIRST);
        const iconNames: string[] = [];
        for (const item of items) {
          assert.ok(item.iconPath instanceof vscode.ThemeIcon, 'expected a ThemeIcon');
          iconNames.push(item.iconPath.id);
        }
        assert.deepStrictEqual(iconNames, ['target', 'git-branch', 'git-branch']);
      } finally {
        uninitialise();
        deps.commands = real.commands;
      }
    });

    it('marks a layer with a pull request stackBranchWithPR, and the current one stackBranchWithPRCurrent (plan §7.2.1)', async () => {
      // arrange: the fixture lines, then — a new fake, so a new backend with an empty memo — the
      // top layer tracked with a pull request of its own
      useFakeGitSpice(answering(FIXTURE_LINES));
      initialise();
      try {
        // act
        const items = await topLevelItems();
        useFakeGitSpice(answering(`${FIXTURE_LINES}{"name":"retry-metrics","down":{"name":"add-retries"},"change":{"id":"#13","url":"https://example.invalid/pull/13"}}\n`));
        const withTopPR = await topLevelItems();

        // assert
        assert.deepStrictEqual(
          items.map((item) => item.contextValue),
          ['stackBranchCurrent', 'stackBranch', 'stackBranchWithPR'],
        );
        assert.deepStrictEqual(
          withTopPR.map((item) => item.contextValue),
          ['stackBranchWithPRCurrent', 'stackBranch', 'stackBranchWithPR'],
        );
        assert.strictEqual(withTopPR[0].description, '3 commits · #13 · current');
      } finally {
        uninitialise();
        deps.commands = real.commands;
      }
    });

    it('adds what git-spice knows to the tooltip: the base as git-spice names it, the to-dos again, and the pull request with its link', async () => {
      // arrange: today's two lines first (three git questions that could fail), then the fake, then the ref
      const asBuilt = {
        top: `retry-metrics @ ${shortShaOf('retry-metrics')}\nbase: add-retries @ ${shortShaOf('add-retries')}`,
        middle: `add-retries @ ${shortShaOf('add-retries')}\nbase: api-refactor @ ${shortShaOf('api-refactor')}`,
        bottom: `api-refactor @ ${shortShaOf('api-refactor')}\nbase: origin/main @ ${shortShaOf('origin/main')}`,
      };
      useFakeGitSpice(answering(FIXTURE_LINES));
      initialise();
      try {
        // act
        const items = await topLevelItems();

        // assert: `main`, not `origin/main`, on the bottom layer's third line — git-spice's own
        // name for the trunk; the to-dos repeated, since a narrow row cuts the description short
        assert.strictEqual(items[0].tooltip, `${asBuilt.top}\ngit-spice: not tracked`);
        assert.strictEqual(items[1].tooltip, `${asBuilt.middle}\ngit-spice: tracked on api-refactor · needs restack · needs push`);
        assert.strictEqual(items[2].tooltip, `${asBuilt.bottom}\ngit-spice: tracked on main\n#12 ${PR_URL}`);
      } finally {
        uninitialise();
        deps.commands = real.commands;
      }
    });

    it('draws the rows as before, and runs no git-spice at all, while the repository is not initialised for it (E59)', async () => {
      // arrange: a git-spice that would answer its banner — and no refs/spice/data
      const runner = useFakeGitSpice(new Map([[VERSION, exited(0, BANNER)]]));
      try {
        // act
        const items = await topLevelItems();

        // assert: today's texts, two-line tooltips, zero spawns (the digest said so, plan §7.6)
        assert.deepStrictEqual(items.map((item) => item.description), ['3 commits · current', '2 commits', '1 commit']);
        assert.strictEqual(items[2].tooltip, `api-refactor @ ${shortShaOf('api-refactor')}\nbase: origin/main @ ${shortShaOf('origin/main')}`);
        assert.deepStrictEqual(runner.calls, []);
      } finally {
        deps.commands = real.commands;
      }
    });

    it('draws the rows as before when git-spice is missing, and when `gs log` fails (E62, E57)', async () => {
      // arrange: neither name answers; then, with a new fake, a git-spice whose `gs log` exits 1
      const missing = useFakeGitSpice(
        new Map([
          [VERSION, neverStarted('not-found')],
          [GS_VERSION, neverStarted('not-found')],
        ]),
      );
      initialise();
      try {
        // act
        const withoutGitSpice = await topLevelItems();
        useFakeGitSpice(
          new Map([
            [VERSION, exited(0, BANNER)],
            [LOG, exited(1, '', 'FTL git-spice: boom\n')],
          ]),
        );
        const withFailingLog = await topLevelItems();

        // assert: both as built — no row added, no text changed (E57 "without touching the tree");
        // the missing git-spice was looked for under both names and asked for no log
        assert.deepStrictEqual(withoutGitSpice.map((item) => item.description), ['3 commits · current', '2 commits', '1 commit']);
        assert.deepStrictEqual(
          missing.calls.map((call) => [call.executable, ...call.args]),
          [
            ['git-spice', '--no-prompt', '--version'],
            ['gs', '--no-prompt', '--version'],
          ],
        );
        assert.deepStrictEqual(withFailingLog.map((item) => item.description), ['3 commits · current', '2 commits', '1 commit']);
        assert.deepStrictEqual(withFailingLog.map((item) => item.contextValue), ['stackBranchCurrent', 'stackBranch', 'stackBranch']);
      } finally {
        uninitialise();
        deps.commands = real.commands;
      }
    });

    it('runs `gs log` once for two loads, again when refs/spice/data moved, and not at all for a checkout — the digest, live (plan §7.14.2)', async () => {
      // arrange
      const runner = useFakeGitSpice(answering(FIXTURE_LINES));
      initialise();
      const logRuns = (): number => runner.calls.filter((call) => call.args.includes('log')).length;
      try {
        // act and assert, step by step: two loads, one `gs log`
        await topLevelItems();
        await topLevelItems();
        assert.strictEqual(logRuns(), 1);
        // a git-spice write (what `gs branch track` does) moves the ref: one more
        runGit(['update-ref', 'refs/spice/data', 'HEAD~1']);
        await topLevelItems();
        assert.strictEqual(logRuns(), 2);
        // a checkout moves no ref the digest lists: none — and the remembered answer is applied
        // to the two layers now under HEAD
        runGit(['checkout', '-q', 'add-retries']);
        const afterCheckout = await topLevelItems();
        assert.strictEqual(logRuns(), 2);
        assert.deepStrictEqual(afterCheckout.map((item) => item.description), ['2 commits · needs restack · needs push · current', '1 commit · #12']);
      } finally {
        runGit(['checkout', '-q', 'retry-metrics']);
        uninitialise();
        deps.commands = real.commands;
      }
    });
  });
});
