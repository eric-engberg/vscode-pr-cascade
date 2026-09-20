/**
 * test/ext/tree.test.ts — the Stack view inside a real VS Code, over the fixture workspace
 * .vscode-test.mjs built: branch names top-first with counts, the current marker, SHAs in
 * tooltips only; the files under each layer (M2: exactly its own, a rename, a binary file,
 * a second ask from the cache, an error row under a layer); the one-row messages (E4, E5, E17).
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * Depends on: the running extension (what activate() returns) and the fixture workspace.
 * Depended on by: nothing. Plan: §6, §7.1, §8 E1b/E2/E4/E5/E7/E10/E17/E44, §9.4, §10.1 M2 9.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';
import type { StackNode, StackTreeProvider } from '../../src/vscode/tree';

// The plan Appendix A stack as the view must list it: top layer first (plan §7.1). The
// fixture leaves HEAD on retry-metrics.
// see primer §4 (const)
const LAYERS_TOP_FIRST = ['retry-metrics', 'add-retries', 'api-refactor'];

// The tree provider, taken from the activated extension once for the whole file (in the
// `before` hook below). Everything is reached through it — `getChildren()` for the rows,
// `getTreeItem(row)` for how each is drawn — the same two calls VS Code makes.
let provider: StackTreeProvider;

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

/** The repository root: the workspace folder named `repo`; the other folder is the empty `nested` subfolder inside it. */
// see primer §22 (for ... of) and §30 (`??`)
function repositoryRoot(): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    if (path.basename(folder.uri.fsPath) === 'repo') {
      return folder.uri.fsPath;
    }
  }
  throw new Error('the fixture workspace has no folder named repo');
}

/**
 * Runs `git <args>` in the fixture repository and returns what it printed. It carries the
 * part of the fixture builder's hermetic environment (test/helpers/fixture.ts, plan §9.1)
 * these commands need — no global or system config, English messages — so nothing on the
 * developer's machine can change the answer, whether git is asked a question or told to
 * check out a branch. No identity variables, because nothing here commits.
 */
// see primer §28 (the Sync variants of Node's functions) and §16 (object literals: spread)
function runGit(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repositoryRoot(),
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' },
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
    provider = api.provider;
  });

  it('shows the layers at the top level: the two workspace folders are one repository, found from its subfolder (E1b) and listed once (E2)', async () => {
    // precondition, not the idea under test: the workspace .vscode-test.mjs built has the
    // nested folder first, then the root — the shape E1b and E2 need. Fails fast otherwise.
    // (E1b, not E1: plan §8's E1 row was split when discovery learned to look below a
    // folder — test/git/discovery.git.test.ts says how.)
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
  // is the Appendix A stack with two changes to its top layer (.vscode-test.mjs says why
  // these): it also moves `b`, which the middle layer added, to `b2` — so there is a
  // rename to look at (E7) — and adds a small binary file, `logo.png` (E10), beside its `c`.
  describe('the files under a layer', () => {
    it('lists under each layer exactly the files that layer changes against the one below it, never what the layers below it changed (M2 "done when")', async () => {
      // arrange: nothing beyond the fixture

      // act
      const bottom = await filesUnderLayer('api-refactor');
      const middle = await filesUnderLayer('add-retries');
      const top = await filesUnderLayer('retry-metrics');

      // assert: the status letter, two spaces, the file's name (plan §12 item 3). `a` is
      // under the bottom layer only, although every layer above it has the file too; the
      // top layer's three rows are in git's order (by path), the rename first.
      assert.deepStrictEqual(bottom.map((item) => item.label), ['A  a']);
      assert.deepStrictEqual(middle.map((item) => item.label), ['A  b']);
      assert.deepStrictEqual(top.map((item) => item.label), ['R  b2', 'A  c', 'A  logo.png']);
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

    it('marks a text file\'s row stackFile and a binary file\'s stackFileBinary — the contextValues M3\'s menus will key on (plan §7.2, E10)', async () => {
      // arrange: nothing beyond the fixture — the top layer's `b2` and `c` are text, its
      // `logo.png` has a NUL byte in it, which is what makes git call a file binary (the
      // flag itself comes from numstat; test/git/changes.git.test.ts covers that, E10)

      // act
      const top = await filesUnderLayer('retry-metrics');

      // assert: one value per row, in the rows' order
      const contextValues = top.map((item) => item.contextValue);
      assert.deepStrictEqual(contextValues, ['stackFile', 'stackFile', 'stackFileBinary']);
    });

    it('names the file by its absolute path in resourceUri, so VS Code draws its file icon and decorations', async () => {
      // arrange: nothing beyond the fixture

      // act
      const bottom = await filesUnderLayer('api-refactor');

      // assert: the URI's path is `<repository root>/a`, which is where the file is —
      // the root is the physical path discovery found, the same one VS Code lists for
      // the `repo` folder
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

    it('gives a file row nothing to run on click yet — the diff is M3 — and nothing underneath', async () => {
      // arrange: the bottom layer's one file, as a node and as drawn
      const layer = await layerNode('api-refactor');
      const fileNodes = await provider.getChildren(layer);
      const item = provider.getTreeItem(fileNodes[0]);

      // act: what VS Code would ask if the row were opened
      const underneath = await provider.getChildren(fileNodes[0]);

      // assert: a leaf with no command; M3's openDiff goes in the `command` slot
      assert.strictEqual(item.command, undefined);
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
          ['stackFile', 'stackFile', 'stackFileBinary'],
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
      // arrange: a `prCascade.gitPath` that does not exist. The first git command of the
      // pipeline is discovery's `rev-parse --show-toplevel` (core/discovery.ts), and
      // RealGitRunner (core/git.ts) phrases a git that never started as "git not found
      // at <path>", naming the command it was about to run.
      const configuration = vscode.workspace.getConfiguration('prCascade');
      await configuration.update('gitPath', '/nowhere/git', vscode.ConfigurationTarget.Workspace);
      try {
        // act
        const items = await topLevelItems();

        // assert: one row, git's message as its label, drawn with the error icon
        const labels = items.map((item) => item.label);
        assert.deepStrictEqual(labels, ['git not found at /nowhere/git (while running: git rev-parse --show-toplevel)']);
        assert.ok(items[0].iconPath instanceof vscode.ThemeIcon, 'expected a ThemeIcon');
        assert.strictEqual(items[0].iconPath.id, 'error');
      } finally {
        await configuration.update('gitPath', undefined, vscode.ConfigurationTarget.Workspace);
      }
    });
  });
});
