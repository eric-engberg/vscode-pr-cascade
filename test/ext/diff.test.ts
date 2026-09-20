/**
 * test/ext/diff.test.ts — the diff on click inside a real VS Code, over the fixture
 * workspace .vscode-test.mjs built: what `prCascade.openDiff` opens for each kind of row
 * (E7–E11), read back through the registered provider; and the provider's own contract.
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code). Depends on: the
 * running extension (what activate() returns), the fixture workspace, src/core/uri.ts,
 * src/vscode/content.ts, src/vscode/tree.ts. Depended on by: nothing. Plan: §7.2, §7.4,
 * §8 E7–E11/E17, §9.4 row `ext/diff.test.ts`, §10.1 M3 item 11.
 */

// see primer §1 (import / export) and §9 (`import type`, and the inline `type` modifier)
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { afterEach, before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { StackLayer } from '../../src/core/model';
import { decodeStackDiff, encodeStackDiff } from '../../src/core/uri';
import type { ExtensionApi } from '../../src/extension';
import { StackDiffContentProvider } from '../../src/vscode/content';
import { FileNode, type StackTreeProvider } from '../../src/vscode/tree';

// The tree provider, from the activated extension (in `before`). The rows are reached the
// way VS Code reaches them — `getChildren()`, `getTreeItem(row)` — and a row's *node* is
// what the click hands the command, so the tests hand over the same.
let provider: StackTreeProvider;

/**
 * The repository root: the workspace folder named `repo` (the other folder is the empty
 * `nested` subfolder inside it).
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
 * What `git rev-parse <ref>` prints, without its newline: the full SHA of a ref, asked of
 * git directly, so the URIs the command built can be checked against what the tree was
 * computed from. The same hermetic environment test/ext/tree.test.ts gives its git —
 * no global or system config, English messages; no identity, since nothing commits.
 * (tree.test.ts has the same two helpers; a shared module is worth making when a third
 * file needs them.)
 */
// see primer §28 (the Sync variants of Node's functions) and §16 (object literals: spread)
function shaOf(ref: string): string {
  const output = execFileSync('git', ['rev-parse', ref], {
    cwd: repositoryRoot(),
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' },
    encoding: 'utf8',
  });
  return output.trim();
}

/**
 * The node of the row drawn as `label` under the layer named `branch` — found the way a
 * user finds it, by the text on the rows, and returned as the provider holds it, because
 * the node (not the drawn item) is what a click passes to the command. Typed FileNode, so
 * the test hands the command exactly what its signature asks for (primer §52): the rows
 * under a layer are FileNodes, or one MessageNode when git failed, and the `'file' in`
 * check is what tells the compiler which this one is. Not `instanceof FileNode`: the
 * provider's nodes come from the bundled extension (dist/extension.js) and the FileNode
 * this file imports is the tsc copy under out/ — two classes of the same name, and
 * `instanceof` says no (primer §34 explains). Only FileNode has a `file` field.
 */
// see primer §6 (async / await), §22 (for ... of) and §34 (narrowing the StackNode union:
// by shape with `in`, here, and why not instanceof)
async function fileNodeUnder(branch: string, label: string): Promise<FileNode> {
  const topLevel = await provider.getChildren();
  for (const layerNode of topLevel) {
    if (provider.getTreeItem(layerNode).label !== branch) {
      continue;
    }
    const fileNodes = await provider.getChildren(layerNode);
    for (const fileNode of fileNodes) {
      if ('file' in fileNode && provider.getTreeItem(fileNode).label === label) {
        return fileNode;
      }
    }
    throw new Error(`the layer ${branch} has no row labelled ${label}`);
  }
  throw new Error(`the view has no layer row labelled ${branch}`);
}

/**
 * Every open editor tab, across every editor group: what the user sees along the top of
 * the editor area, as one flat list.
 */
// see primer §57 (tabGroups and tab inputs) and §25 (arrays: flatMap)
function allTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs);
}

/** Closes every tab, so each test starts and ends with an empty editor area. */
async function closeAllTabs(): Promise<void> {
  const tabs = allTabs();
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs);
  }
}

/**
 * A Promise that resolves the next time the set of tabs changes — the §42 pattern,
 * on the tabs event. VS Code tells the extension host about a new tab in a message of
 * its own, separate from the command's result, so a test makes this Promise *before*
 * running the command and awaits it after: a tab that appears before the command
 * resolves has already been caught, one that appears after is waited for, and a tab
 * that never appears fails on Mocha's timeout rather than on a missing assertion.
 * (settleTabs, below, is the counterpart for a test that expects no tab at all.)
 */
// see primer §42 (waiting for an event with new Promise) and §32 (subscribing, dispose)
function nextTabsChange(): Promise<void> {
  return new Promise((resolve) => {
    const subscription = vscode.window.tabGroups.onDidChangeTabs(() => {
      subscription.dispose();
      resolve();
    });
  });
}

/**
 * Runs `prCascade.openDiff` with `node` as a click would, and returns once a tab has
 * appeared.
 */
async function openDiffFor(node: FileNode): Promise<void> {
  const changed = nextTabsChange();
  await vscode.commands.executeCommand('prCascade.openDiff', node);
  await changed;
}

/**
 * The counterpart for a test that expects *no* tab. Waiting on the tabs event alone
 * would wait forever when the command rightly opens nothing, and looking the instant the
 * command resolves could look before the message about a wrongly opened editor has
 * arrived (see nextTabsChange). So: the next tabs change, or a short wait, whichever
 * comes first — long enough for an editor the command started to show up, short enough
 * to cost nothing noticeable. Whichever ends the wait cancels the other, so neither
 * fires into a later test.
 */
// see primer §58 (setTimeout and clearTimeout: a wait with a deadline)
function settleTabs(): Promise<void> {
  return new Promise((resolve) => {
    const subscription = vscode.window.tabGroups.onDidChangeTabs(() => {
      clearTimeout(timer);
      subscription.dispose();
      resolve();
    });
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve();
    }, 250);
  });
}

/** The one open tab, which must be a diff editor; its two URIs are the result. */
// see primer §57 (TabInputTextDiff, and instanceof on a VS Code class)
function onlyDiffInput(): vscode.TabInputTextDiff {
  const tabs = allTabs();
  assert.strictEqual(tabs.length, 1, `expected exactly one tab, found ${tabs.length}`);
  const input = tabs[0].input;
  assert.ok(input instanceof vscode.TabInputTextDiff, 'the tab is not a diff editor');
  return input;
}

/**
 * The text VS Code holds for a URI — for a `stackdiff:` one, what the registered content
 * provider answered, i.e. what `git show` printed. `openTextDocument` loads the document
 * without showing it, so this opens no tab.
 */
// see primer §57 (openTextDocument and getText)
async function textOf(uri: vscode.Uri): Promise<string> {
  const document = await vscode.workspace.openTextDocument(uri);
  return document.getText();
}

// What the click opens, per kind of row: the diff editor with a `stackdiff:` URI on each
// side and the `<file> (<parent> → <layer>)` title; an added file (E8), a rename (E7), a
// deleted file (E9) and a file with an awkward name (E11) each show the right text on
// each side, read through the registered content provider; a binary file opens as a
// file, or nothing (E10); no row → no editor. Then the content provider on its own: its
// contract with a reader handed in, and what reaches the user when it rejects (E17).
// see primer §5 (arrow functions)
describe('prCascade.openDiff — the click on a file row', () => {
  // Runs once before the tests in this block: activate the extension, keep its provider,
  // start with no tabs open.
  before(async () => {
    // see primer §31 (a type argument on a call) and §8 (undefined and narrowing)
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    const api = await extension.activate();
    provider = api.provider;
    await closeAllTabs();
  });

  // Runs after every test, pass or fail: each test opens at most one editor, and the next
  // one asserts on "the one open tab", so none may be left behind.
  // see primer §57 (afterEach)
  afterEach(async () => {
    await closeAllTabs();
  });

  it('is registered under the id the file rows run', async () => {
    // arrange: the extension is active (`before`)

    // act: every command id VS Code knows right now (true = include internal ones)
    const commands = await vscode.commands.getCommands(true);

    // assert
    assert.ok(commands.includes('prCascade.openDiff'), 'prCascade.openDiff is not registered');
  });

  it('opens the diff editor with a stackdiff: URI on each side and the title `<file> (<parent> → <layer>)` (plan §7.2)', async () => {
    // arrange: the bottom layer's one row, `A  a`. Its parent is trunk, which the tree
    // names as detectTrunk found it — `origin/main` — the same name the row's layer shows
    // in its tooltip.
    const node = await fileNodeUnder('api-refactor', 'A  a');

    // act
    await openDiffFor(node);

    // assert: one tab, a diff, both sides ours, the title in branch names and never SHAs
    const input = onlyDiffInput();
    assert.strictEqual(input.original.scheme, 'stackdiff');
    assert.strictEqual(input.modified.scheme, 'stackdiff');
    assert.strictEqual(allTabs()[0].label, 'a (origin/main → api-refactor)');
  });

  it('names each side by the file\'s path and the layer\'s two SHAs — the pair the row was listed from, not the branch names', async () => {
    // arrange: the same row; what git says the two refs point at
    const node = await fileNodeUnder('api-refactor', 'A  a');
    const expectedLeft = { root: repositoryRoot(), ref: shaOf('origin/main'), relPath: 'a' };
    const expectedRight = { root: repositoryRoot(), ref: shaOf('api-refactor'), relPath: 'a' };

    // act
    await openDiffFor(node);

    // assert: decoded with the core's own function, from the real vscode.Uri each side is
    const input = onlyDiffInput();
    assert.deepStrictEqual(decodeStackDiff(input.original), expectedLeft);
    assert.deepStrictEqual(decodeStackDiff(input.modified), expectedRight);
  });

  it('shows an added file as nothing on the left and the file on the right (E8)', async () => {
    // arrange: `a` did not exist at trunk; the bottom layer added it with the content `a\n`
    const node = await fileNodeUnder('api-refactor', 'A  a');

    // act
    await openDiffFor(node);

    // assert: the text behind each side, as the content provider answered it — `''` for
    // a file the commit does not have (git show exits non-zero; the reader turns that
    // into the empty string), the file itself for the other side, final newline included
    const input = onlyDiffInput();
    assert.strictEqual(await textOf(input.original), '');
    assert.strictEqual(await textOf(input.modified), 'a\n');
  });

  it('puts the old path on the left of a rename and the new one on the right (E7)', async () => {
    // arrange: the top layer moves `b` — added by the layer below, content `b\n` — to `b2`
    const node = await fileNodeUnder('retry-metrics', 'R  b2');

    // act
    await openDiffFor(node);

    // assert: left is `b` at the parent, right is `b2` at the layer; same content, so the
    // editor shows the move and no line changes. The title names the new path.
    const input = onlyDiffInput();
    assert.strictEqual(input.original.path, '/b');
    assert.strictEqual(input.modified.path, '/b2');
    assert.strictEqual(await textOf(input.original), 'b\n');
    assert.strictEqual(await textOf(input.modified), 'b\n');
    assert.strictEqual(allTabs()[0].label, 'b2 (add-retries → retry-metrics)');
  });

  it('shows a deleted file as the file on the left and nothing on the right (E9)', async () => {
    // arrange: the top layer deletes `f`, which trunk was made with (content `base\n`)
    const node = await fileNodeUnder('retry-metrics', 'D  f');

    // act
    await openDiffFor(node);

    // assert: the mirror image of E8
    const input = onlyDiffInput();
    assert.strictEqual(await textOf(input.original), 'base\n');
    assert.strictEqual(await textOf(input.modified), '');
  });

  it('carries a path with a space, #, ü and ? through a real vscode.Uri and back to git exactly (E11)', async () => {
    // arrange: the top layer adds `weird #1 ü?.txt` with the content `weird\n`. A `#`
    // starts a URI's fragment and a `?` its query, so a URI built by gluing strings
    // would lose the name at the `#`; test/unit/uri.test.ts proved the parts round-trip,
    // and this is the trip through VS Code's own encoding and decoding.
    const node = await fileNodeUnder('retry-metrics', 'A  weird #1 ü?.txt');
    const expected = { root: repositoryRoot(), ref: shaOf('retry-metrics'), relPath: 'weird #1 ü?.txt' };

    // act
    await openDiffFor(node);

    // assert: the URI's text is percent-encoded — the `#` is `%23`, so it is in the path
    // and not a fragment — and decoding the Uri gives the exact name back, which is what
    // `git show` was asked for: the content proves it found the file
    const input = onlyDiffInput();
    assert.ok(input.modified.toString().startsWith('stackdiff:/weird%20%231%20%C3%BC%3F.txt?'), input.modified.toString());
    assert.deepStrictEqual(decodeStackDiff(input.modified), expected);
    assert.strictEqual(await textOf(input.modified), 'weird\n');
  });

  it('opens a binary file on the checked-out layer as a file, not in the diff editor (E10)', async () => {
    // arrange: `logo.png` on the top layer, which is HEAD, so the file is on disk
    const node = await fileNodeUnder('retry-metrics', 'A  logo.png');

    // act
    await openDiffFor(node);

    // assert: one tab, not a diff, on the file itself (`file:` scheme, the path on disk).
    // Which editor VS Code picked for a `.png` depends on what is enabled in the test VS
    // Code — the image preview (a custom editor) or, without it, the text editor with its
    // "binary file" notice — so both inputs are accepted; each names the file by `uri`.
    // see primer §57 (TabInputText, TabInputCustom)
    const tabs = allTabs();
    assert.strictEqual(tabs.length, 1, `expected exactly one tab, found ${tabs.length}`);
    const input = tabs[0].input;
    assert.ok(!(input instanceof vscode.TabInputTextDiff), 'a diff editor was opened for a binary file');
    assert.ok(input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom, 'the tab is not on a file');
    assert.strictEqual(input.uri.scheme, 'file');
    assert.strictEqual(input.uri.fsPath, path.join(repositoryRoot(), 'logo.png'));
  });

  it('opens nothing for a binary file on a layer that is not checked out — it is not on disk — and says so instead (E10)', async () => {
    // arrange: a row built by hand, since the fixture's binary file is on HEAD's layer:
    // `logo.png` as if the middle layer had added it. The command reads only the node's
    // three fields, so a node built here is as good as one from the provider.
    // see primer §13 (`new` on a class from a test)
    const layer: StackLayer = {
      name: 'add-retries',
      sha: shaOf('add-retries'),
      parent: 'api-refactor',
      parentSha: shaOf('api-refactor'),
      commitCount: 2,
      isCurrent: false,
    };
    const node = new FileNode(repositoryRoot(), layer, { status: 'A', path: 'logo.png', binary: true });

    // act: no tab is expected, so the wait is not for one to appear but for one that
    // was going to appear to have had its message delivered (settleTabs)
    await vscode.commands.executeCommand('prCascade.openDiff', node);
    await settleTabs();

    // assert: no tab at all — not a diff, not the file (the message is a toast, which a
    // test cannot read)
    assert.deepStrictEqual(allTabs(), []);
  });

  it('opens nothing when run with no row — from the Command Palette — and says so instead', async () => {
    // arrange: nothing — the palette passes no argument

    // act, then give a tab that was going to appear the time to (settleTabs)
    await vscode.commands.executeCommand('prCascade.openDiff');
    await settleTabs();

    // assert
    assert.deepStrictEqual(allTabs(), []);
  });

  // The provider is built directly here, with a reader of the test's choosing, because
  // the one activate() registered cannot be reached from outside — VS Code holds it — and
  // its reader is the real git one. The two tests above that read a `stackdiff:`
  // document's text go through the registered one; these are about the class's contract.
  describe('the stackdiff: content provider', () => {
    it('hands its reader the decoded location and answers with what the reader returns', async () => {
      // arrange: a reader that records what it was asked and answers a fixed string
      const asked: string[] = [];
      const contentProvider = new StackDiffContentProvider(async (root, ref, relPath) => {
        asked.push(root, ref, relPath);
        return 'from the reader';
      });
      // see primer §55 (vscode.Uri.from)
      const uri = vscode.Uri.from(encodeStackDiff({ root: '/work/app', ref: 'abc123', relPath: 'dir/weird #1.txt' }));

      // act
      const text = await contentProvider.provideTextDocumentContent(uri);

      // assert: the path arrived decoded — `#` as `#`, not `%23`
      assert.strictEqual(text, 'from the reader');
      assert.deepStrictEqual(asked, ['/work/app', 'abc123', 'dir/weird #1.txt']);
    });

    it('rejects a URI of another scheme, naming it (plan §9.4), without asking the reader', async () => {
      // arrange: a reader that must never be reached
      const contentProvider = new StackDiffContentProvider(async () => {
        throw new Error('the reader was asked for a file: URI');
      });

      // act
      const attempt = contentProvider.provideTextDocumentContent(vscode.Uri.file('/etc/hosts'));

      // assert: rejects with decodeStackDiff's own message
      await assert.rejects(attempt, /expected a "stackdiff" URI, got scheme "file"/);
    });

    it('lets a decode error through to VS Code: a stackdiff: document with a query that is not JSON cannot be opened', async () => {
      // arrange: a URI in our scheme that encodeStackDiff would never produce
      const uri = vscode.Uri.from({ scheme: 'stackdiff', path: '/a', query: 'root=/r&ref=abc' });

      // act: `openTextDocument` returns VS Code's own Thenable, not a Promise, and
      // `rejects` wants a Promise — an async arrow that awaits it hands one over (the
      // same wrapping test/ext/activate.test.ts does for `doesNotReject`)
      const attempt = async () => {
        await vscode.workspace.openTextDocument(uri);
      };

      // assert: the registered provider throws rather than answering `''`, and VS Code
      // reports it — the message names the query
      await assert.rejects(attempt, /query must be JSON/);
    });

    it('still rejects when git itself cannot start (E17) — VS Code reports that in place of the document, never an empty pane', async () => {
      // arrange: a `prCascade.gitPath` that does not exist, written at Workspace level and
      // removed again in `finally`, as test/ext/tree.test.ts's E17 tests do. The reader
      // src/extension.ts registered (loadFileAtRef) builds the runner from the setting on
      // every call, so the next `stackdiff:` document asks the missing git. Its `tryRun`
      // turns "the file is not in that commit" into `''`, but a git that never started is
      // not that (core/git.ts says which failures tryRun swallows) and must not be shown
      // as an empty file. A URI no earlier test opened — `c` at the top layer — so VS
      // Code cannot answer from a document it already holds. `shaOf` asks git directly,
      // not through the setting, so it still works here.
      // see primer §18 (try / finally) and §35 (ConfigurationTarget)
      const uri = vscode.Uri.from(encodeStackDiff({ root: repositoryRoot(), ref: shaOf('retry-metrics'), relPath: 'c' }));
      const configuration = vscode.workspace.getConfiguration('prCascade');
      await configuration.update('gitPath', '/nowhere/git', vscode.ConfigurationTarget.Workspace);
      try {
        // act (the async arrow, as in the test above)
        const attempt = async () => {
          await vscode.workspace.openTextDocument(uri);
        };

        // assert: RealGitRunner's E17 message, naming the path that does not exist
        await assert.rejects(attempt, /git not found at \/nowhere\/git/);
      } finally {
        await configuration.update('gitPath', undefined, vscode.ConfigurationTarget.Workspace);
      }
    });
  });
});
