/**
 * test/ext/gitApi.test.ts — the built-in Git extension as the extension's source of
 * repositories, inside a real VS Code: the handshake against the real Git extension over the
 * fixture workspace (one repository from two folders; a second repository appended,
 * expanded, reordered and removed at runtime, seen through the Git extension's own
 * open/close events); the sort rule for roots; which git the extension spawns; and, with
 * stand-ins for the Git extension, every way the handshake can fail (E82), the two ways
 * it recovers, and what a handshake overtaken by a newer one or by dispose() leaves behind
 * (nothing).
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * Depends on: the running extension (what activate() returns), the real built-in Git
 * extension through test/ext/helpers/gitApi.ts, src/vscode/gitApi.ts imported directly
 * (the adapter, its pure helpers), the fixture builder. Depended on by: nothing. Plan:
 * §7.14, §6, §8 E1b/E2/E82, §9.4 row `ext/gitApi.test.ts`, §10.1 item 12a.
 */

// see primer §1 (import / export) and §9 (`import type`); the `src/vscode/gitApi` import
// is primer §60's second half — the adapter tested directly, the way scanSettings.test.ts
// once imported core/discovery
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';
import { GitExtensionAdapter, GitUnavailableError, gitExecutable, realGitExtensionHost, sortRepositoryRoots } from '../../src/vscode/gitApi';
import type { GitApi, GitConnection, GitExtensionExports, GitExtensionHandle, GitExtensionHost } from '../../src/vscode/gitApi';
import { StackTreeProvider } from '../../src/vscode/tree';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';
import { realGitApi } from './helpers/gitApi';

// The plan Appendix A stack, top layer first, as the view lists it (plan §7.1).
// see primer §4 (const)
const LAYERS_TOP_FIRST = ['retry-metrics', 'add-retries', 'api-refactor'];

// The tree provider of the running extension, taken in `before`; an output channel for the
// adapters the tests build themselves (the extension's own writes to "PR Cascade"); and a
// second channel for the one test that disposes its channel mid-handshake. That one is
// created here, in `before`, rather than in the test: VS Code finishes setting a channel up
// asynchronously, and disposing one within a tick of creating it makes the extension host
// log "Trying to add a disposable to a DisposableStore that has already been disposed" —
// harness noise with nothing to do with the adapter.
let provider: StackTreeProvider;
let output: vscode.OutputChannel;
let shutdownOutput: vscode.OutputChannel;

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

/** The rows at the top of the view, drawn. */
// see primer §6 (async / await) and §25 (arrays: map)
async function topLevelLabels(): Promise<(string | vscode.TreeItemLabel | undefined)[]> {
  const nodes = await provider.getChildren();
  return nodes.map((node) => provider.getTreeItem(node).label);
}

/**
 * A Promise that resolves the next time `event` fires. The listener is set up before the
 * caller does whatever fires the event, so nothing can slip past it (primer §42).
 */
// see primer §42 (waiting for an event with new Promise), §62 (declaring a type parameter
// on a function) and §32 (subscribing, dispose)
function nextEvent<T>(event: vscode.Event<T>): Promise<T> {
  return new Promise((resolve) => {
    const subscription = event((value) => {
      subscription.dispose();
      resolve(value);
    });
  });
}

/** `setTimeout` as a Promise: lets the listeners already queued for the current event run before the test looks. */
// see primer §58 (setTimeout)
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

// ---------------------------------------------------------------------------------------
// Stand-ins for the Git extension, for the E82 tests: the same three seams the real host
// has (src/vscode/gitApi.ts, GitExtensionHost), each under the test's control.
// ---------------------------------------------------------------------------------------

/** What a fake API needs so the tests can fire its events: the emitters behind them. */
// see primer §9 (interface) and §32 (EventEmitter)
interface FakeApi {
  api: GitApi;
  stateChanges: vscode.EventEmitter<'uninitialized' | 'initialized'>;
  opened: vscode.EventEmitter<unknown>;
  closed: vscode.EventEmitter<unknown>;
}

/**
 * A Git extension API with no repositories and a made-up git path. `state` starts as
 * given so a test can hold the handshake at `uninitialized` and release it later: firing
 * `stateChanges` moves it on, the way the real one moves after the initial scan.
 */
// see primer §61 (a getter in an object literal: `get state()` is read like a field)
function fakeApi(state: 'uninitialized' | 'initialized' = 'initialized'): FakeApi {
  const stateChanges = new vscode.EventEmitter<'uninitialized' | 'initialized'>();
  const opened = new vscode.EventEmitter<unknown>();
  const closed = new vscode.EventEmitter<unknown>();
  let current = state;
  stateChanges.event((next) => {
    current = next;
  });
  const api: GitApi = {
    get state() {
      return current;
    },
    onDidChangeState: stateChanges.event,
    git: { path: '/fake/bin/git' },
    repositories: [],
    onDidOpenRepository: opened.event,
    onDidCloseRepository: closed.event,
  };
  return { api, stateChanges, opened, closed };
}

/** What a fake exports object needs so the tests can flip `enabled`, hold `getAPI` back, and fire the event. */
interface FakeExports {
  exports: GitExtensionExports;
  enablementChanges: vscode.EventEmitter<boolean>;
  /** Flip the Git extension's `enabled` flag the way its `model` setter does. */
  setEnabled(enabled: boolean): void;
  /**
   * Whether `getAPI(1)` succeeds while `enabled` is true. At VS Code 1.138 the flag turns
   * on and the event fires one statement *before* `getAPI` can succeed (plan §13.4 (g));
   * a test that wants that moment sets this to false and lets a timer set it back.
   */
  setApiUsable(usable: boolean): void;
}

/**
 * The object the real Git extension returns from `activate()`. `getAPI(1)` throws the
 * real extension's own message while `enabled` is false (that is how "disabled" and "no
 * git" look through the API, plan §13.4 (g)) or while the test holds it back, and hands
 * `api` over otherwise.
 */
// see primer §61 (a getter in an object literal)
function fakeExports(enabled: boolean, api: GitApi): FakeExports {
  const enablementChanges = new vscode.EventEmitter<boolean>();
  let isEnabled = enabled;
  let apiUsable = true;
  const exports: GitExtensionExports = {
    get enabled() {
      return isEnabled;
    },
    onDidChangeEnablement: enablementChanges.event,
    getAPI(): GitApi {
      if (!isEnabled || !apiUsable) {
        throw new Error('Git model not found');
      }
      return api;
    },
  };
  return {
    exports,
    enablementChanges,
    setEnabled(next: boolean): void {
      isEnabled = next;
    },
    setApiUsable(next: boolean): void {
      apiUsable = next;
    },
  };
}

/** A host whose `lookUp` answer and `git.enabled` reading the test controls, and whose extensions event the test fires. */
interface FakeHost {
  host: GitExtensionHost;
  extensionChanges: vscode.EventEmitter<void>;
  /** What the next `lookUp()` returns: the Git extension's handle, or `undefined` for "disabled by the user". */
  setHandle(handle: GitExtensionHandle | undefined): void;
}

function fakeHost(handle: GitExtensionHandle | undefined, gitEnabledInSettings: boolean): FakeHost {
  const extensionChanges = new vscode.EventEmitter<void>();
  let current = handle;
  const host: GitExtensionHost = {
    lookUp: () => current,
    onDidChangeExtensions: extensionChanges.event,
    isGitEnabledInSettings: () => gitEnabledInSettings,
  };
  return {
    host,
    extensionChanges,
    setHandle(next: GitExtensionHandle | undefined): void {
      current = next;
    },
  };
}

/** A handle whose `activate()` resolves with the given exports — what `getExtension` returns for a working Git extension. */
function handleFor(exports: GitExtensionExports): GitExtensionHandle {
  return { activate: () => Promise.resolve(exports) };
}

/** The one E82 row an adapter reports: the message, or a failure if it connected instead. */
function unavailableMessage(connection: GitConnection): string {
  if (connection.kind !== 'unavailable') {
    assert.fail('expected the Git extension to be unavailable, but the handshake connected');
  }
  return connection.message;
}

// see primer §5 (arrow functions)
describe('the built-in Git extension as the source of repositories (plan §7.14)', () => {
  before(async () => {
    // see primer §31 (a type argument on a call) and §8 (undefined and narrowing)
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    const api = await extension.activate();
    provider = api.provider;
    output = vscode.window.createOutputChannel('PR Cascade tests');
    shutdownOutput = vscode.window.createOutputChannel('PR Cascade tests: shutdown');
  });

  after(() => {
    output.dispose();
    // Already disposed by its test when that test ran; a second dispose is a no-op.
    shutdownOutput.dispose();
  });

  describe('the handshake with the real Git extension', () => {
    it('connects, and the one repository it opened for the two-folder workspace is the fixture repository (E1b, E2 delegated)', async () => {
      // arrange: the real host — the same one src/extension.ts uses
      const adapter = new GitExtensionAdapter(realGitExtensionHost, output);
      try {
        // act
        const connection = await adapter.connection();

        // assert: ready, not a row; `nested` and `repo` are one repository to the Git
        // extension, opened once, and its root is the physical path VS Code lists for `repo`
        assert.strictEqual(connection.kind, 'ready');
        if (connection.kind !== 'ready') {
          return;
        }
        const roots = connection.api.repositories.map((repository) => repository.rootUri.fsPath);
        assert.deepStrictEqual(roots, [repositoryRoot()]);
      } finally {
        adapter.dispose();
      }
    });

    it('reports a git executable that runs — the one the extension spawns when prCascade.gitPath is empty', async () => {
      // arrange
      const api = await realGitApi(output);

      // act: what src/extension.ts hands RealGitRunner for the default setting
      const executable = gitExecutable('', api.git.path);

      // assert: the Git extension's own answer, and it is a git
      assert.strictEqual(executable, api.git.path);
      // see primer §28 (the Sync variants of Node's functions)
      const version = execFileSync(executable, ['--version'], { encoding: 'utf8' });
      assert.match(version, /^git version /);
    });
  });

  describe('a repository the Git extension opens or closes later', () => {
    // A second Appendix A stack, moved to a folder named `second` (the builder always
    // names its repository `repo`, and the tree labels a repository row with the folder's
    // name — so a second `repo` would be indistinguishable). Built in `before`, removed
    // from the workspace and from disk in `after`, whatever the tests did.
    // `second` stays undefined if `buildStack` threw in `before`, so `after` must not
    // assume it (a failure there would hide the real one).
    let second: Fixture | undefined;
    let secondDir = '';

    before(() => {
      second = buildStack();
      secondDir = path.join(path.dirname(second.dir), 'second');
      // see primer §28: `renameSync` is `mv`
      fs.renameSync(second.dir, secondDir);
    });

    after(async () => {
      try {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const folder = folders.find((candidate) => candidate.uri.fsPath === secondDir);
        if (folder !== undefined) {
          const changed = nextEvent(vscode.workspace.onDidChangeWorkspaceFolders);
          assert.strictEqual(vscode.workspace.updateWorkspaceFolders(folder.index, 1), true, 'VS Code refused to remove the second folder');
          await changed;
        }
      } finally {
        if (second !== undefined) {
          second.cleanup();
        }
      }
    });

    /**
     * Makes sure `second` is a workspace folder the Git extension has open — the state the
     * first test below leaves behind — so the tests after it can also run on their own
     * (`it.only`) and fail only for their own reason.
     */
    async function secondFolderOpen(): Promise<void> {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.find((candidate) => candidate.uri.fsPath === secondDir) !== undefined) {
        return;
      }
      const api = await realGitApi(output);
      const opened = nextEvent(api.onDidOpenRepository);
      const foldersChanged = nextEvent(vscode.workspace.onDidChangeWorkspaceFolders);
      assert.strictEqual(vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(secondDir) }), true, 'VS Code refused to add the second folder');
      await foldersChanged;
      await opened;
      await tick();
    }

    it('lists the repository once the Git extension has opened it, and refreshes twice on the way: for the folder, then for the open event', async () => {
      // arrange: listen the way VS Code and the extension do — for tree changes, for the
      // Git extension's own "opened" event, and for VS Code applying the folder change
      const treeChanges: string[] = [];
      const subscription = provider.onDidChangeTreeData(() => {
        treeChanges.push('tree');
      });
      const api = await realGitApi(output);
      const opened = nextEvent(api.onDidOpenRepository);
      const foldersChanged = nextEvent(vscode.workspace.onDidChangeWorkspaceFolders);
      const folders = vscode.workspace.workspaceFolders ?? [];
      try {
        // act: append the second repository's folder to the workspace (never at index 0 —
        // changing the first folder restarts the extension host, primer §42)
        const accepted = vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(secondDir) });
        assert.strictEqual(accepted, true, 'VS Code refused to add the second folder');
        await foldersChanged;
        await opened;
        await tick();

        // assert: the tree refreshed once for the folder change (our own listener) and
        // once for the open event (the adapter's) — two, not one, or the open event is
        // not wired; and the view now has a row per repository (plan §6), the fixture
        // repository first (its folders come first in the workspace), so the repository
        // the Git extension opened is the one that was added
        assert.deepStrictEqual(treeChanges, ['tree', 'tree']);
        assert.deepStrictEqual(await topLevelLabels(), ['repo', 'second']);
      } finally {
        subscription.dispose();
      }
    });

    it('lists the stack of the repository the Git extension opened under its row, like any other', async () => {
      // arrange: the row for `second`
      await secondFolderOpen();
      const nodes = await provider.getChildren();
      const secondRow = nodes.find((node) => provider.getTreeItem(node).label === 'second');
      assert.ok(secondRow !== undefined, 'no row labelled second');

      // act: what VS Code asks for when the row is expanded
      const layers = await provider.getChildren(secondRow);

      // assert: the whole pipeline ran for the repository the Git extension opened — its
      // trunk from its own origin/HEAD, its layers top first. The row's label alone could
      // not show that: a row needs nothing but a root.
      assert.deepStrictEqual(layers.map((node) => provider.getTreeItem(node).label), LAYERS_TOP_FIRST);
    });

    it('refreshes once, with no open or close event, when the workspace folders are reordered (plan §6: folder order is the sort key)', async () => {
      // arrange: [nested, repo, second], and listeners for tree changes and for both of
      // the Git extension's repository events
      await secondFolderOpen();
      const api = await realGitApi(output);
      const folders = vscode.workspace.workspaceFolders ?? [];
      const repo = folders.find((candidate) => candidate.uri.fsPath === repositoryRoot());
      const secondFolder = folders.find((candidate) => candidate.uri.fsPath === secondDir);
      assert.ok(repo !== undefined && secondFolder !== undefined, 'repo and second are not both workspace folders');
      // precondition, not the idea under test: `second` sits right after `repo`, and
      // neither is the first folder — replacing the first restarts the extension host
      // (primer §42), which is why `nested` leads the fixture workspace
      assert.ok(repo.index > 0 && secondFolder.index === repo.index + 1, `unexpected folder order: ${folders.map((folder) => folder.name).join(', ')}`);
      const treeChanges: string[] = [];
      const repositoryEvents: string[] = [];
      const subscriptions = [
        provider.onDidChangeTreeData(() => {
          treeChanges.push('tree');
        }),
        api.onDidOpenRepository(() => {
          repositoryEvents.push('opened');
        }),
        api.onDidCloseRepository(() => {
          repositoryEvents.push('closed');
        }),
      ];
      const foldersChanged = nextEvent(vscode.workspace.onDidChangeWorkspaceFolders);
      try {
        // act: swap the two — one call replacing [repo, second] by [second, repo]
        const accepted = vscode.workspace.updateWorkspaceFolders(repo.index, 2, { uri: secondFolder.uri }, { uri: repo.uri });
        assert.strictEqual(accepted, true, 'VS Code refused to reorder the folders');
        await foldersChanged;
        await tick();

        // assert: our folder listener refreshed once, and the Git extension — whose
        // repositories did not change — said nothing (plan §7.14.2 is why the listener
        // stays). The view's order follows the folders (§6): `repo` keeps first place
        // because its `nested` folder is still first, so the labels do not move.
        assert.deepStrictEqual(treeChanges, ['tree']);
        assert.deepStrictEqual(repositoryEvents, []);
        assert.deepStrictEqual(await topLevelLabels(), ['repo', 'second']);
      } finally {
        for (const subscription of subscriptions) {
          subscription.dispose();
        }
      }
    });

    it('drops the repository again when the Git extension closes it, after its folder is removed', async () => {
      // arrange: the second folder is in the workspace and the Git extension has it open;
      // listen for its "closed" event
      await secondFolderOpen();
      const api = await realGitApi(output);
      const folders = vscode.workspace.workspaceFolders ?? [];
      const folder = folders.find((candidate) => candidate.uri.fsPath === secondDir);
      assert.ok(folder !== undefined, 'the second folder is not in the workspace');
      const closed = nextEvent(api.onDidCloseRepository);
      const foldersChanged = nextEvent(vscode.workspace.onDidChangeWorkspaceFolders);

      // act: remove the folder. No editor is open in that repository and no other folder
      // is at or above it, so the Git extension disposes the repository (plan §7.14.2).
      assert.strictEqual(vscode.workspace.updateWorkspaceFolders(folder.index, 1), true, 'VS Code refused to remove the second folder');
      await foldersChanged;
      await closed;
      await tick();

      // assert: the view is back to one repository, so its layers sit at the top level
      assert.deepStrictEqual(await topLevelLabels(), LAYERS_TOP_FIRST);
    });
  });

  describe('sortRepositoryRoots: the order of repositories in the view (plan §6)', () => {
    it('orders roots by the workspace folder each belongs to — the folder equal to, above or below the root', () => {
      // arrange: three folders, and — in the order the result must have — a root that is
      // its folder, one below its folder (E1), one above its folder (E1b); `roots` lists
      // them backwards on purpose
      const folders = ['/w/lib', '/w/apps', '/w/mono/packages/ui'];
      const roots = ['/w/mono', '/w/apps/api', '/w/lib'];

      // act
      const sorted = sortRepositoryRoots(roots, folders);

      // assert: folder order, whatever order the Git extension listed them in
      assert.deepStrictEqual(sorted, ['/w/lib', '/w/apps/api', '/w/mono']);
    });

    it('uses the lowest folder index when several folders relate to one root, and path order for ties', () => {
      // arrange: `nested` inside `repo` comes first, `repo` itself second — the fixture's
      // own layout; a second root also under the first folder
      const folders = ['/w/repo/nested', '/w/repo', '/w/parent'];
      const roots = ['/w/parent/beta', '/w/repo', '/w/parent/alpha'];

      // act
      const sorted = sortRepositoryRoots(roots, folders);

      // assert: repo (index 0, through `nested`), then the two below `parent` by name
      assert.deepStrictEqual(sorted, ['/w/repo', '/w/parent/alpha', '/w/parent/beta']);
    });

    it('puts a root that belongs to no folder after every other', () => {
      // arrange: a repository the Git extension kept open after its folder went (an editor
      // in it was still visible — plan §6)
      const folders = ['/w/repo'];
      const roots = ['/elsewhere/gone', '/w/repo'];

      // act
      const sorted = sortRepositoryRoots(roots, folders);

      // assert
      assert.deepStrictEqual(sorted, ['/w/repo', '/elsewhere/gone']);
    });

    it('compares whole path pieces, so /w/repo2 is not "below" /w/repo', () => {
      // arrange: `repo2` shares a prefix with the first folder but belongs to no folder;
      // `other` is the second folder. (With `repo` itself among the roots the tie-break by
      // name would hide a prefix bug — `/w/repo` sorts before `/w/repo2` either way.)
      const folders = ['/w/repo', '/w/other'];
      const roots = ['/w/other', '/w/repo2'];

      // act
      const sorted = sortRepositoryRoots(roots, folders);

      // assert: repo2 goes last, as a root with no folder. A plain startsWith would give it
      // the first folder's index and put it before `other`.
      assert.deepStrictEqual(sorted, ['/w/other', '/w/repo2']);
    });
  });

  describe('gitExecutable: which git the extension spawns (plan §7.3, §7.14.1)', () => {
    it('is the Git extension\'s git when prCascade.gitPath is empty', () => {
      assert.strictEqual(gitExecutable('', '/opt/git/bin/git'), '/opt/git/bin/git');
    });

    it('is the setting when prCascade.gitPath is set', () => {
      assert.strictEqual(gitExecutable('/nowhere/git', '/opt/git/bin/git'), '/nowhere/git');
    });
  });

  // Each test builds an adapter over stand-ins (fakeHost / fakeExports / fakeApi above)
  // and asserts the exact row text of plan §7.14.3 — the text is the behaviour (pending
  // rule 7b), so a wrong or missing word fails here.
  describe('when the Git extension cannot be used (E82, plan §7.14.3)', () => {
    it('row 1: the user disabled the Git extension — getExtension finds nothing', async () => {
      // arrange
      const { host } = fakeHost(undefined, true);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        // act
        const connection = await adapter.connection();

        // assert
        assert.strictEqual(unavailableMessage(connection), 'PR Cascade needs the built-in Git extension — enable it in the Extensions view');
      } finally {
        adapter.dispose();
      }
    });

    it('row 2: the Git extension failed to start — activate() rejects', async () => {
      // arrange: a handle whose activation fails, as the real one's does when the Git
      // extension rethrows anything but "git not found"
      const handle: GitExtensionHandle = { activate: () => Promise.reject(new Error('boom')) };
      const { host } = fakeHost(handle, true);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        // act
        const connection = await adapter.connection();

        // assert
        assert.strictEqual(unavailableMessage(connection), 'The Git extension failed to start — reload the window');
      } finally {
        adapter.dispose();
      }
    });

    it('row 3: git.enabled is false — the exports say disabled and the setting agrees', async () => {
      // arrange
      const { exports } = fakeExports(false, fakeApi().api);
      const { host } = fakeHost(handleFor(exports), false);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        // act
        const connection = await adapter.connection();

        // assert
        assert.strictEqual(unavailableMessage(connection), 'Git is disabled in this workspace (git.enabled)');
      } finally {
        adapter.dispose();
      }
    });

    it('row 4: the Git extension found no git — the exports say disabled while the setting says enabled', async () => {
      // arrange
      const { exports } = fakeExports(false, fakeApi().api);
      const { host } = fakeHost(handleFor(exports), true);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        // act
        const connection = await adapter.connection();

        // assert
        assert.strictEqual(unavailableMessage(connection), 'The Git extension found no git — set git.path, then reload the window');
      } finally {
        adapter.dispose();
      }
    });

    it('row 2 again, never a retry loop, when getAPI throws although the exports say enabled', async () => {
      // arrange: enabled, but getAPI throws anyway — at 1.138 that is the one tick before
      // the API is ready (plan §7.14.1); after the retry it means something else is wrong
      const { enablementChanges, exports } = fakeExports(true, fakeApi().api);
      let getApiCalls = 0;
      const throwing: GitExtensionExports = {
        get enabled() {
          return exports.enabled;
        },
        onDidChangeEnablement: enablementChanges.event,
        getAPI(): GitApi {
          getApiCalls += 1;
          throw new Error('Git model not found');
        },
      };
      const { host } = fakeHost(handleFor(throwing), true);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        // act
        const connection = await adapter.connection();

        // assert: the row, after exactly one attempt
        assert.strictEqual(unavailableMessage(connection), 'The Git extension failed to start — reload the window');
        assert.strictEqual(getApiCalls, 1, 'getAPI was retried');
      } finally {
        adapter.dispose();
      }
    });

    it('recovers from row 3 when git.enabled is turned on: onDidChangeEnablement(true) → connected, and the adapter says so', async () => {
      // arrange: disabled at first
      const { exports, enablementChanges, setEnabled, setApiUsable } = fakeExports(false, fakeApi().api);
      const { host } = fakeHost(handleFor(exports), false);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        const before = await adapter.connection();
        assert.strictEqual(before.kind, 'unavailable');
        const changed = nextEvent(adapter.onDidChange);

        // act: the order at VS Code 1.138 (plan §13.4 (g)) — the flag first, the event
        // next, and getAPI usable only once the handler has returned. The fake makes it
        // usable from a timer set *before* the event: timers run in the order they were
        // set, so it runs ahead of the adapter's own setTimeout(…, 0) and after anything
        // the handler did at once. An adapter that called getAPI inside the handler, or in
        // the same turn, would end in row 2 here.
        // see primer §58 (setTimeout)
        setApiUsable(false);
        setEnabled(true);
        setTimeout(() => setApiUsable(true), 0);
        enablementChanges.fire(true);
        await changed;

        // assert
        const after = await adapter.connection();
        assert.strictEqual(after.kind, 'ready');
      } finally {
        adapter.dispose();
      }
    });

    it('recovers from row 1 when the Git extension is enabled again: extensions.onDidChange → getExtension answers → connected', async () => {
      // arrange: nothing to find at first
      const { host, extensionChanges, setHandle } = fakeHost(undefined, true);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        const before = await adapter.connection();
        assert.strictEqual(before.kind, 'unavailable');
        const changed = nextEvent(adapter.onDidChange);

        // act: VS Code enables the Git extension in place and fires the extensions event
        setHandle(handleFor(fakeExports(true, fakeApi().api).exports));
        extensionChanges.fire();
        await changed;

        // assert
        const after = await adapter.connection();
        assert.strictEqual(after.kind, 'ready');
      } finally {
        adapter.dispose();
      }
    });

    it('runs the newest handshake to the end when the extensions event fires again while the Git extension is still scanning — the overtaken one registers nothing', async () => {
      // arrange: row 1 first; then a Git extension that is found but still scanning
      const fake = fakeApi('uninitialized');
      const { host, extensionChanges, setHandle } = fakeHost(undefined, true);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        await adapter.connection();
        setHandle(handleFor(fakeExports(true, fake.api).exports));

        // act: the event fires (any extension changing state fires it), the reconnect
        // reaches the wait for `initialized`, the event fires again — and then the scan
        // finishes, releasing both handshakes
        extensionChanges.fire();
        await tick();
        extensionChanges.fire();
        fake.stateChanges.fire('initialized');
        const connection = await adapter.connection();
        await tick();
        // precondition, not the idea under test: connected
        assert.strictEqual(connection.kind, 'ready');

        // assert: one refresh per repository event, not two — the handshake the second
        // event overtook left no listener behind
        const changes: string[] = [];
        const subscription = adapter.onDidChange(() => {
          changes.push('change');
        });
        fake.opened.fire(undefined);
        subscription.dispose();
        assert.deepStrictEqual(changes, ['change']);
      } finally {
        adapter.dispose();
      }
    });

    it('leaves a ready connection alone when extensions.onDidChange fires — every install or enable of any extension fires it', async () => {
      // arrange: connected
      const { exports } = fakeExports(true, fakeApi().api);
      const { host, extensionChanges } = fakeHost(handleFor(exports), true);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        const before = await adapter.connection();
        const changes: string[] = [];
        const subscription = adapter.onDidChange(() => {
          changes.push('change');
        });

        // act
        extensionChanges.fire();
        await tick();
        subscription.dispose();

        // assert: no refresh, and the very same connection — no new handshake ran
        assert.deepStrictEqual(changes, []);
        assert.strictEqual(await adapter.connection(), before);
      } finally {
        adapter.dispose();
      }
    });

    it('keeps row 1 when extensions.onDidChange fires for some other extension and getExtension still finds nothing', async () => {
      // arrange
      const { host, extensionChanges } = fakeHost(undefined, true);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        await adapter.connection();

        // act
        extensionChanges.fire();
        await tick();

        // assert: the same row, no crash
        const connection = await adapter.connection();
        assert.strictEqual(unavailableMessage(connection), 'PR Cascade needs the built-in Git extension — enable it in the Extensions view');
      } finally {
        adapter.dispose();
      }
    });
  });

  describe('the connected adapter', () => {
    it('waits for the Git extension\'s initial scan: the handshake settles only when the API reports initialized', async () => {
      // arrange: an API still scanning
      const fake = fakeApi('uninitialized');
      const { exports } = fakeExports(true, fake.api);
      const { host } = fakeHost(handleFor(exports), true);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        let settled = false;
        // see primer §63 (`.then`: a continuation on a Promise, without `await`)
        const pending = adapter.connection().then((connection) => {
          settled = true;
          return connection;
        });
        await tick();
        // precondition, not the idea under test: still waiting
        assert.strictEqual(settled, false, 'the handshake settled before the scan finished');

        // act: the scan finishes
        fake.stateChanges.fire('initialized');
        const connection = await pending;

        // assert
        assert.strictEqual(connection.kind, 'ready');
      } finally {
        adapter.dispose();
      }
    });

    it('asks for a refresh when the Git extension opens or closes a repository', async () => {
      // arrange
      const fake = fakeApi();
      const { exports } = fakeExports(true, fake.api);
      const { host } = fakeHost(handleFor(exports), true);
      const adapter = new GitExtensionAdapter(host, output);
      try {
        await adapter.connection();
        const changes: string[] = [];
        const subscription = adapter.onDidChange(() => {
          changes.push('change');
        });

        // act
        fake.opened.fire(undefined);
        fake.closed.fire(undefined);
        subscription.dispose();

        // assert: one refresh per event
        assert.deepStrictEqual(changes, ['change', 'change']);
      } finally {
        adapter.dispose();
      }
    });

    it('stops listening when disposed', async () => {
      // arrange
      const fake = fakeApi();
      const { exports } = fakeExports(true, fake.api);
      const { host } = fakeHost(handleFor(exports), true);
      const adapter = new GitExtensionAdapter(host, output);
      await adapter.connection();
      const changes: string[] = [];
      adapter.onDidChange(() => {
        changes.push('change');
      });

      // act
      adapter.dispose();
      fake.opened.fire(undefined);

      // assert
      assert.deepStrictEqual(changes, []);
    });

    it('settles a handshake still in flight when disposed, without writing to the output channel VS Code disposed first', async () => {
      // arrange: an API still scanning, and an output channel this test may dispose — at
      // shutdown VS Code disposes context.subscriptions in push order, the extension's
      // channel before its adapter (src/extension.ts), and appendLine on a disposed channel
      // throws
      const fake = fakeApi('uninitialized');
      const { exports } = fakeExports(true, fake.api);
      const { host } = fakeHost(handleFor(exports), true);
      const adapter = new GitExtensionAdapter(host, shutdownOutput);
      const pending = adapter.connection();
      await tick();

      // act: shutdown, then the scan finishes anyway
      shutdownOutput.dispose();
      adapter.dispose();
      fake.stateChanges.fire('initialized');

      // assert: "never rejects" holds — the handshake ends quietly instead of throwing
      // into a Promise nobody can catch
      const connection = await pending;
      assert.strictEqual(connection.kind, 'ready');
    });
  });

  describe('the view when the Git extension is unavailable', () => {
    it('shows the E82 message as one warning row, not an error row', async () => {
      // arrange: a provider whose loader fails the way src/extension.ts does for E82
      const unavailable = new StackTreeProvider(
        () => Promise.reject(new GitUnavailableError('Git is disabled in this workspace (git.enabled)')),
        () => Promise.resolve([]),
        output,
      );
      try {
        // act
        const nodes = await unavailable.getChildren();
        const items = nodes.map((node) => unavailable.getTreeItem(node));

        // assert: the message as the row, drawn as a warning — a state to fix, not a failure
        assert.deepStrictEqual(items.map((item) => item.label), ['Git is disabled in this workspace (git.enabled)']);
        assert.ok(items[0].iconPath instanceof vscode.ThemeIcon, 'expected a ThemeIcon');
        assert.strictEqual(items[0].iconPath.id, 'warning');
      } finally {
        unavailable.dispose();
      }
    });
  });
});
