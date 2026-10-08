/**
 * test/ext/statusbar.test.ts — the status bar item inside a real VS Code, two ways. Live,
 * through the handle `activate()` returns in test mode only: the text on each layer of the
 * fixture stack (E44), "not on a stack" on trunk (E5), hidden while `prCascade.statusBar` is
 * off and when the load fails (E17), the item keeping up while the view is hidden, and the
 * click command. Then `StackStatusBar` over a stand-in item, for what the live block does
 * not cover: the states this fixture cannot produce (no repository, several repositories, a
 * middle layer with layers above it, two branches on one commit — E6) and the two texts
 * cheaper to pin on a built state than on a checkout (a detached HEAD, E3; no trunk, E4).
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * Depends on: the running extension (what activate() returns in test mode), the fixture
 * workspace, src/vscode/statusbar.ts imported directly. Depended on by: nothing. Plan:
 * §7.1.0 (the status bar bullet), §7.3 `prCascade.statusBar`, §7.14.3, §8 E3/E4/E5/E6/E17/E44,
 * §9.4 row `ext/statusbar.test.ts`, §10.1 item 14, §13.2 D52.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { RepoState, StackLayer } from '../../src/core/model';
import type { ExtensionApi } from '../../src/extension';
import { StackStatusBar, stackStatusText, type StatusBarEntry } from '../../src/vscode/statusbar';
import type { StackNode, StackTreeProvider } from '../../src/vscode/tree';

// The running extension's provider, refresh, status bar and view, taken in `before`. The
// last two are returned by activate() in test mode only (plan §13.4; primer §68).
let provider: StackTreeProvider;
let refresh: () => void;
let statusBar: StackStatusBar;
let treeView: vscode.TreeView<StackNode>;

/** The repository root: the workspace folder named `repo` (the other folder is its empty `nested` subfolder). */
// see primer §25 (arrays: find) and §30 (`??`)
function repositoryRoot(): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const repo = folders.find((folder) => path.basename(folder.uri.fsPath) === 'repo');
  if (repo === undefined) {
    throw new Error('the fixture workspace has no folder named repo');
  }
  return repo.uri.fsPath;
}

/** Runs `git <args>` in the fixture repository — the hermetic environment of test/ext/tree.test.ts, which says why each variable is set. */
// see primer §28 (the Sync variants of Node's functions) and §16 (object literals: spread)
function runGit(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repositoryRoot(),
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

/**
 * Loads the tree's top level the way VS Code does. The provider tells the status bar what
 * it loaded before it answers, so after this the item is current — nothing to wait for.
 */
async function refreshThroughTheTree(): Promise<void> {
  await provider.getChildren();
}

/**
 * A Promise that resolves the next time `event` fires, or rejects after `deadlineMs` naming
 * the wait — so a test that expects an event and gets none fails with its cause and still
 * runs its `finally`. Set up before whatever should fire the event (primer §42).
 */
// see primer §42 (waiting for an event with new Promise), §62 (declaring a type parameter on
// a function) and §58 (setTimeout and clearTimeout: a wait with a deadline)
function nextEvent<T>(event: vscode.Event<T>, deadlineMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error(`no event within ${deadlineMs} ms`));
    }, deadlineMs);
    const subscription = event((value) => {
      clearTimeout(timer);
      subscription.dispose();
      resolve(value);
    });
  });
}

/**
 * Puts the Stack view on or off screen and waits until the extension host knows it. VS Code
 * reports a view's visibility asynchronously, so a command's own Promise resolving is not
 * enough — the `TreeView` says when (primer §67). `prCascade.focus` shows the view; switching
 * the side bar to the Explorer hides every Source Control view, this one included.
 */
async function showStackView(shown: boolean): Promise<void> {
  if (treeView.visible === shown) {
    return;
  }
  // see primer §27 (`_` between digits: `5_000` is 5000)
  const changed = nextEvent(treeView.onDidChangeVisibility, 5_000);
  await vscode.commands.executeCommand(shown ? 'prCascade.focus' : 'workbench.view.explorer');
  const event = await changed;
  assert.strictEqual(event.visible, shown, 'the Stack view did not change visibility as asked');
}

// ---------------------------------------------------------------------------------------
// Stand-ins for the StatusBarItem and for RepoStates, for the rules the fixture cannot
// reach. The item needs seven things (`StatusBarEntry`, the slice StackStatusBar touches),
// and remembers what it was told, which the real one does not tell anyone.
// ---------------------------------------------------------------------------------------

/** A stand-in item: the slice of a StatusBarItem the class touches, plus what it was last told. */
// see primer §9 (interface) and §61 (a getter in an object literal)
interface FakeItem {
  entry: StatusBarEntry;
  /** Whether `show()` was the last of show/hide to be called. */
  readonly shown: boolean;
  readonly disposed: boolean;
}

function fakeItem(): FakeItem {
  let shown = false;
  let disposed = false;
  const entry: StatusBarEntry = {
    name: undefined,
    text: '',
    tooltip: undefined,
    command: undefined,
    show(): void {
      shown = true;
    },
    hide(): void {
      shown = false;
    },
    dispose(): void {
      disposed = true;
    },
  };
  return {
    entry,
    get shown() {
      return shown;
    },
    get disposed() {
      return disposed;
    },
  };
}

/** A layer with only what the status bar reads: its name and whether HEAD is on it. The SHAs are placeholders. */
function layer(name: string, isCurrent: boolean): StackLayer {
  return { name, sha: 'sha', parent: 'parent', parentSha: 'parentSha', commitCount: 1, isCurrent };
}

/** A RepoState with the given layers; `head` follows the current layer, as computeStack would set it. */
// see primer §25 (arrays: find) and §48 (the conditional expression)
function stateWith(layers: StackLayer[], root = '/w/repo'): RepoState {
  const current = layers.find((candidate) => candidate.isCurrent);
  return { root, trunk: 'origin/main', head: current === undefined ? null : current.name, rebaseInProgress: false, layers };
}

/** Setting readers for the stand-in tests — `prCascade.statusBar` always on, always off — the `isEnabled` parameter of StackStatusBar. */
// see primer §4 (const) and §33 (function types)
const ALWAYS_ON = (): boolean => true;
const ALWAYS_OFF = (): boolean => false;

// see primer §5 (arrow functions)
describe('the status bar item (plan §7.1.0)', () => {
  before(async () => {
    // see primer §31 (a type argument on a call) and §8 (undefined and narrowing)
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    const api = await extension.activate();
    assert.ok(api.statusBar, 'activate() returned no status bar — the extension host is not in ExtensionMode.Test');
    assert.ok(api.treeView, 'activate() returned no tree view — the extension host is not in ExtensionMode.Test');
    provider = api.provider;
    refresh = api.refresh;
    statusBar = api.statusBar;
    treeView = api.treeView;
  });

  describe('live, through the handle activate() returns in test mode', () => {
    it('reads `$(layers) retry-metrics · 3 of 3` on the fixture as built — the top layer, counted from the bottom', async () => {
      // arrange: nothing beyond the fixture (HEAD on retry-metrics)

      // act
      await refreshThroughTheTree();

      // assert
      assert.strictEqual(statusBar.item.text, '$(layers) retry-metrics · 3 of 3');
      assert.strictEqual(statusBar.visible, true);
    });

    it('reads `$(layers) add-retries · 2 of 2` with HEAD on the middle layer: the layer above is no longer an ancestor of HEAD and leaves the stack (E44)', async () => {
      // arrange
      runGit(['checkout', '-q', 'add-retries']);
      try {
        // act
        await refreshThroughTheTree();

        // assert
        assert.strictEqual(statusBar.item.text, '$(layers) add-retries · 2 of 2');
      } finally {
        runGit(['checkout', '-q', 'retry-metrics']);
      }
    });

    it('reads `$(layers) api-refactor · 1 of 1` on the bottom layer', async () => {
      // arrange
      runGit(['checkout', '-q', 'api-refactor']);
      try {
        // act
        await refreshThroughTheTree();

        // assert
        assert.strictEqual(statusBar.item.text, '$(layers) api-refactor · 1 of 1');
      } finally {
        runGit(['checkout', '-q', 'retry-metrics']);
      }
    });

    it('reads `$(layers) not on a stack` on trunk, and stays shown (E5)', async () => {
      // arrange
      runGit(['checkout', '-q', 'main']);
      try {
        // act
        await refreshThroughTheTree();

        // assert
        assert.strictEqual(statusBar.item.text, '$(layers) not on a stack');
        assert.strictEqual(statusBar.visible, true);
      } finally {
        runGit(['checkout', '-q', 'retry-metrics']);
      }
    });

    it('is hidden while prCascade.statusBar is false, and back at the next refresh once the setting is removed', async () => {
      // arrange: the setting at Workspace level lands in the fixture's .code-workspace, not
      // in the test VS Code's user settings
      // see primer §35 (enum values from the VS Code API: ConfigurationTarget)
      const configuration = vscode.workspace.getConfiguration('prCascade');
      await configuration.update('statusBar', false, vscode.ConfigurationTarget.Workspace);
      try {
        // act
        await refreshThroughTheTree();

        // assert
        assert.strictEqual(statusBar.visible, false);
      } finally {
        // `undefined` removes the key, so the default from package.json applies again.
        await configuration.update('statusBar', undefined, vscode.ConfigurationTarget.Workspace);
      }
      // act again: the setting is read on each refresh, like every setting (vscode/config.ts)
      await refreshThroughTheTree();

      // assert
      assert.strictEqual(statusBar.visible, true);
    });

    it('is hidden when the load fails — a prCascade.gitPath that cannot run (E17; the E82 rows hide it the same way)', async () => {
      // arrange
      const configuration = vscode.workspace.getConfiguration('prCascade');
      await configuration.update('gitPath', '/nowhere/git', vscode.ConfigurationTarget.Workspace);
      try {
        // act
        await refreshThroughTheTree();

        // assert
        assert.strictEqual(statusBar.visible, false);
      } finally {
        await configuration.update('gitPath', undefined, vscode.ConfigurationTarget.Workspace);
        // Leave the item as every test here finds it, shown; none depends on this today.
        await refreshThroughTheTree();
      }
    });

    it('keeps up while the Stack view is hidden: refresh() runs the load itself, because VS Code asks a hidden view for nothing (D52)', async () => {
      // arrange: the view showing first, so that hiding it is a change the host reports;
      // then hidden; then HEAD moved
      await showStackView(true);
      await showStackView(false);
      runGit(['checkout', '-q', 'add-retries']);
      try {
        // act: the refresh every trigger ends in — not getChildren, which the tests above
        // call directly. With the view hidden, the only load that can produce this event is
        // refresh()'s own.
        const loaded = nextEvent(provider.onDidLoadStates, 5_000);
        refresh();
        await loaded;

        // assert
        assert.strictEqual(statusBar.item.text, '$(layers) add-retries · 2 of 2');
      } finally {
        runGit(['checkout', '-q', 'retry-metrics']);
        await showStackView(true);
        await refreshThroughTheTree();
      }
    });

    it('opens the Stack view when clicked: its command is the one VS Code creates for the view, and it runs', async () => {
      // arrange: nothing beyond the fixture

      // act + assert: the command id, and that running it resolves (test/ext/activate.test.ts
      // says why doesNotReject rather than a bare await)
      assert.strictEqual(statusBar.item.command, 'prCascade.focus');
      await assert.doesNotReject(async () => {
        await vscode.commands.executeCommand('prCascade.focus');
      });
    });
  });

  describe('StackStatusBar over a stand-in item', () => {
    it('starts hidden, with its name and its click command set in the constructor', () => {
      // arrange + act
      const item = fakeItem();
      const bar = new StackStatusBar(item.entry, ALWAYS_ON);

      // assert
      assert.strictEqual(bar.visible, false);
      assert.strictEqual(item.shown, false);
      assert.strictEqual(item.entry.name, 'PR Cascade Stack');
      assert.strictEqual(item.entry.command, 'prCascade.focus');
    });

    it('hides when there is no repository — the zero-repository case and every failed load (E82, E17) look the same to it', () => {
      // arrange: shown first
      const item = fakeItem();
      const bar = new StackStatusBar(item.entry, ALWAYS_ON);
      bar.update([stateWith([layer('api-refactor', true)])]);
      assert.strictEqual(item.shown, true, 'precondition: shown before the empty update');

      // act
      bar.update([]);

      // assert
      assert.strictEqual(bar.visible, false);
      assert.strictEqual(item.shown, false);
    });

    it('hides while the setting says no, whatever the states say', () => {
      // arrange
      const item = fakeItem();
      const bar = new StackStatusBar(item.entry, ALWAYS_OFF);

      // act
      bar.update([stateWith([layer('api-refactor', true)])]);

      // assert
      assert.strictEqual(bar.visible, false);
      assert.strictEqual(item.shown, false);
    });

    it('counts the current layer from the bottom: the middle of three reads `$(layers) add-retries · 2 of 3`', () => {
      // arrange: a state with layers above the current one — which v0.1's HEAD-only stack
      // produces only for E6; the rule is written for every stack all the same (D52)
      const state = stateWith([layer('api-refactor', false), layer('add-retries', true), layer('retry-metrics', false)]);

      // act
      const text = stackStatusText(state);

      // assert
      assert.strictEqual(text, '$(layers) add-retries · 2 of 3');
    });

    it('reads `$(layers) api-refactor · 1 of 2` when two branches share one commit and HEAD is on the first by name (E6)', () => {
      // arrange: the one way v0.1 reaches n < N
      const state = stateWith([layer('api-refactor', true), layer('api-refactor-backup', false)]);

      // act
      const text = stackStatusText(state);

      // assert
      assert.strictEqual(text, '$(layers) api-refactor · 1 of 2');
    });

    it('reads `$(layers) not on a stack` whenever no layer is current: a detached HEAD above the layers (E3), and no trunk (E4)', () => {
      // arrange: detached — the layers are there, none current; no trunk — nothing computed
      const detached = stateWith([layer('api-refactor', false), layer('add-retries', false)]);
      const noTrunk: RepoState = { root: '/w/repo', trunk: null, head: null, rebaseInProgress: false, layers: [] };

      // act + assert: the same one text for both
      assert.strictEqual(stackStatusText(detached), '$(layers) not on a stack');
      assert.strictEqual(stackStatusText(noTrunk), '$(layers) not on a stack');
    });

    it('describes the first repository when several are open, and names it in the tooltip (D52)', () => {
      // arrange: two repositories in view order
      const item = fakeItem();
      const bar = new StackStatusBar(item.entry, ALWAYS_ON);

      // act
      bar.update([stateWith([layer('api-refactor', true)], '/w/first'), stateWith([layer('other', true)], '/w/second')]);

      // assert
      assert.strictEqual(item.entry.text, '$(layers) api-refactor · 1 of 1');
      assert.strictEqual(item.entry.tooltip, '/w/first');
      assert.strictEqual(bar.visible, true);
    });

    it('disposes the item it was given', () => {
      // arrange
      const item = fakeItem();
      const bar = new StackStatusBar(item.entry, ALWAYS_ON);

      // act
      bar.dispose();

      // assert
      assert.strictEqual(item.disposed, true);
    });
  });
});
