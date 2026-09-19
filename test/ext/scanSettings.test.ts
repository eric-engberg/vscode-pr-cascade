/**
 * test/ext/scanSettings.test.ts — the two repository-scan settings inside a real VS Code,
 * over Ric's layout: a parent folder that is not a repository, with repositories below it,
 * added to the running workspace. The tree shows a row per repository; depth 0 hides the
 * scanned ones again; the ignore list is honoured; a value settings.json should not hold
 * falls back to the default; and package.json's defaults are the ones the code uses.
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * Depends on: the running extension (through what activate() returns, src/extension.ts),
 * the fixture builder (test/helpers/fixture.ts), src/core/discovery.ts (the defaults).
 * Depended on by: nothing. Plan: §7.3 (the two settings), §6 (several roots → one row
 * each), §13.4, §8 E1/E2, §9.1 layer 3 ("nested-repo workspace (E1) shows the repo").
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import { DEFAULT_DISCOVERY_OPTIONS } from '../../src/core/discovery';
import type { DiscoveryOptions } from '../../src/core/discovery';
import type { ExtensionApi } from '../../src/extension';
import type { StackTreeProvider } from '../../src/vscode/tree';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';

// The plan Appendix A stack, top layer first, as every fixture built here holds it and as
// the view lists it (plan §7.1). The fixture leaves HEAD on retry-metrics.
// see primer §4 (const)
const LAYERS_TOP_FIRST = ['retry-metrics', 'add-retries', 'api-refactor'];

// The tree provider, from the activated extension (in `before`), reached the way VS Code
// reaches it: `getChildren()` for the rows, `getTreeItem(row)` for how each is drawn.
let provider: StackTreeProvider;

// Ric's layout (plan §1), built in `before` and added to the workspace as its third folder:
//
//   parent/            a plain directory — not a repository
//     alpha/           a repository holding the Appendix A stack
//     beta/            the same (built first: the order asserted below is by name)
//     group/           a plain directory ...
//       gamma/         ... with a repository two levels down: out of reach at the default depth
//
// The fixtures are kept for `cleanup()`; the parent is removed separately. `parentDir`
// starts empty so `after` can tell whether `before` got as far as creating it.
let parentDir = '';
const fixtures: Fixture[] = [];

/**
 * The corner of package.json this file reads: the two scan settings' declared defaults.
 * Keys with a dot in them are written in quotes; `default` is `unknown` because a
 * manifest is JSON and could hold anything — deepStrictEqual does the comparing.
 */
// see primer §9 (interface) and §42 (packageJSON; quoted keys; shapes nested inline)
interface ExtensionManifest {
  contributes: {
    configuration: {
      properties: {
        'prCascade.repositoryScanMaxDepth': { default: unknown };
        'prCascade.repositoryScanIgnoredFolders': { default: unknown };
      };
    };
  };
}

/**
 * Builds the Appendix A stack and moves it to `<parent>/<name>`. The fixture builder always
 * puts its repository in a folder named `repo` inside the directory it is given, with the
 * bare origin beside it, and the tree labels a repository row with the folder's name — so
 * three fixtures built in place would all be called `repo`, one level deeper than Ric's
 * layout has them. Moving the repository folder is safe: a repository keeps no record of
 * where it lives, and its `origin` is registered by absolute path, so `origin/main` and
 * `origin/HEAD` (what detectTrunk reads) keep working from the new place. The origin stays
 * behind in the scratch directory, which `cleanup()` removes.
 */
// see primer §28 (the Sync variants of Node's functions): `renameSync` is `mv`
function buildRepositoryUnder(parent: string, name: string): Fixture {
  const fixture = buildStack();
  fs.renameSync(fixture.dir, path.join(parent, name));
  return fixture;
}

/**
 * A Promise that resolves the next time VS Code reports that the workspace folders
 * changed. `updateWorkspaceFolders` only *starts* a change: it returns at once, VS Code
 * applies the change a moment later and then fires `onDidChangeWorkspaceFolders` — the
 * event src/extension.ts refreshes on — and the API says not to call it again before
 * that. So a test asks for this Promise *before* the call (an event cannot slip past a
 * listener that is already there) and waits on it after.
 */
// see primer §42 (waiting for an event with new Promise) and §32 (subscribing, dispose)
function nextWorkspaceFoldersChange(): Promise<void> {
  return new Promise((resolve) => {
    const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // Once is enough: stop listening, then let the awaiting code continue.
      subscription.dispose();
      resolve();
    });
  });
}

/** The parent folder as VS Code lists it, or `undefined` while it is not in the workspace. */
// see primer §22 (for ... of), §30 (`??`) and §8 (undefined)
function parentWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    if (folder.uri.fsPath === parentDir) {
      return folder;
    }
  }
  return undefined;
}

/** The rows at the top of the view, drawn: what VS Code would show under "Stack". */
// see primer §6 (async / await) and §25 (arrays: map)
async function topLevelItems(): Promise<vscode.TreeItem[]> {
  const nodes = await provider.getChildren();
  return nodes.map((node) => provider.getTreeItem(node));
}

/**
 * Runs `body` with one `prCascade.*` setting set at Workspace level, and removes the
 * setting again afterwards, whatever happened — the try / finally of the E4 and E17 tests
 * in test/ext/tree.test.ts, written once. `undefined` removes the key, so the package.json
 * default applies again. Settings are read on every refresh (src/vscode/config.ts), so the
 * very next getChildren sees the change; nothing has to be waited for. Before `body` runs,
 * the value is read back and must be exactly what was given — the precondition every
 * fallback test below rests on.
 */
// see primer §33 (function types: the body is handed in as a function), §18 (try /
// finally) and §35 (enum values from the VS Code API: ConfigurationTarget)
async function withSetting(key: string, value: unknown, body: () => Promise<void>): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('prCascade');
  await configuration.update(key, value, vscode.ConfigurationTarget.Workspace);
  try {
    // precondition, not the idea under test: VS Code keeps whatever `update` is given,
    // schema or not — so what the tree shows next is src/vscode/config.ts's doing, not VS
    // Code's having refused `-5` or `"alpha"` and applied the default itself. Read back
    // through a fresh getConfiguration: the object above is a snapshot from before the
    // update. Inside the try, so a failure here still removes the key.
    const stored = vscode.workspace.getConfiguration('prCascade').get<unknown>(key);
    assert.deepStrictEqual(stored, value, 'VS Code did not keep the value as given');

    await body();
  } finally {
    await configuration.update(key, undefined, vscode.ConfigurationTarget.Workspace);
  }
}

// see primer §5 (arrow functions)
describe('the repository scan settings', () => {
  // Runs once before the tests in this block: activate the extension, build the layout,
  // add the parent to the workspace and wait until VS Code says it is there.
  before(async () => {
    // see primer §31 (a type argument on a call) and §8 (undefined and narrowing)
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    const api = await extension.activate();
    provider = api.provider;

    // The physical path (`realpathSync`, as the fixture builder does): what VS Code hands
    // back for the folder is compared with it in parentWorkspaceFolder.
    parentDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pr-cascade-parent-')));
    fixtures.push(buildRepositoryUnder(parentDir, 'beta'));
    fixtures.push(buildRepositoryUnder(parentDir, 'alpha'));
    const groupDir = path.join(parentDir, 'group');
    fs.mkdirSync(groupDir);
    fixtures.push(buildRepositoryUnder(groupDir, 'gamma'));

    // Add the parent at the end of the folder list. The workspace .vscode-test.mjs opened
    // is a `.code-workspace` file, so this is an edit to that file followed by the event;
    // a single-folder window would instead have been turned into a new workspace and
    // reloaded — with this test run inside it (primer §42).
    // see primer §42 (updateWorkspaceFolders, Uri.file)
    const folders = vscode.workspace.workspaceFolders ?? [];
    const changed = nextWorkspaceFoldersChange();
    const accepted = vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(parentDir) });
    assert.strictEqual(accepted, true, 'VS Code refused to add the parent folder');
    await changed;
  });

  // Runs once after the tests in this block, whatever they did: settings back to their
  // defaults, the parent out of the workspace, the repositories off disk — so whichever
  // test file Mocha runs next (test/ext/tree.test.ts asserts the folder list) sees the
  // workspace as .vscode-test.mjs built it.
  after(async () => {
    try {
      const configuration = vscode.workspace.getConfiguration('prCascade');
      await configuration.update('repositoryScanMaxDepth', undefined, vscode.ConfigurationTarget.Workspace);
      await configuration.update('repositoryScanIgnoredFolders', undefined, vscode.ConfigurationTarget.Workspace);
      const folder = parentWorkspaceFolder();
      if (folder !== undefined) {
        const changed = nextWorkspaceFoldersChange();
        // Checked like the add in `before`: a refused removal returns false and fires no
        // event, and waiting for that event would fail with Mocha's timeout, not a message.
        const removed = vscode.workspace.updateWorkspaceFolders(folder.index, 1);
        assert.strictEqual(removed, true, 'VS Code refused to remove the parent folder');
        await changed;
      }
    } finally {
      // Off disk whatever the workspace did — see primer §18 (try / finally).
      for (const fixture of fixtures) {
        fixture.cleanup();
      }
      if (parentDir !== '') {
        fs.rmSync(parentDir, { recursive: true, force: true });
      }
    }
  });

  it('shows one row per repository — the fixture repository, then alpha and beta found below the parent (E1; `repo` once, E2)', async () => {
    // arrange: nothing beyond `before` — the workspace is [nested, repo, parent]

    // act
    const items = await topLevelItems();

    // assert: several repositories, so a row each (plan §6), labelled by folder name
    // (vscode/tree.ts, RepoNode): `repo` from the first two folders, once (E2); then
    // alpha before beta although beta was built first — workspace order, then name
    // order. gamma is two levels down and the default depth is 1.
    const labels = items.map((item) => item.label);
    assert.deepStrictEqual(labels, ['repo', 'alpha', 'beta']);
  });

  it('lists the stack of a repository found by the scan under its row, like any other', async () => {
    // arrange: the row for alpha
    // see primer §25 (arrays: filter)
    const nodes = await provider.getChildren();
    const alphaNodes = nodes.filter((node) => provider.getTreeItem(node).label === 'alpha');
    assert.strictEqual(alphaNodes.length, 1, 'expected exactly one row labelled alpha');

    // act: what VS Code asks for when the row is expanded
    const children = await provider.getChildren(alphaNodes[0]);

    // assert: the whole pipeline ran for a repository the scan found — its trunk from its
    // own origin/HEAD, its layers top-first
    const labels = children.map((node) => provider.getTreeItem(node).label);
    assert.deepStrictEqual(labels, LAYERS_TOP_FIRST);
  });

  it('hides the scanned repositories at prCascade.repositoryScanMaxDepth 0: only the folders themselves are asked, and the parent is not one', async () => {
    // arrange: depth 0 for the body's duration
    await withSetting('repositoryScanMaxDepth', 0, async () => {
      // act
      const items = await topLevelItems();

      // assert: back to one repository, so its layers sit at the top level (plan §6) —
      // what M1 first showed for this layout
      const labels = items.map((item) => item.label);
      assert.deepStrictEqual(labels, LAYERS_TOP_FIRST);
    });
  });

  it('reaches a repository two levels down at prCascade.repositoryScanMaxDepth 2', async () => {
    // arrange: depth 2 — gamma sits at parent/group/gamma
    await withSetting('repositoryScanMaxDepth', 2, async () => {
      // act
      const items = await topLevelItems();

      // assert: gamma after alpha and beta — the scan lists a whole level before the next
      const labels = items.map((item) => item.label);
      assert.deepStrictEqual(labels, ['repo', 'alpha', 'beta', 'gamma']);
    });
  });

  it('skips the folder names in prCascade.repositoryScanIgnoredFolders', async () => {
    // arrange: alpha on the ignore list
    await withSetting('repositoryScanIgnoredFolders', ['alpha'], async () => {
      // act
      const items = await topLevelItems();

      // assert
      const labels = items.map((item) => item.label);
      assert.deepStrictEqual(labels, ['repo', 'beta']);
    });
  });

  it('treats a depth below -1 as the default — settings.json is typed by hand', async () => {
    // arrange: a depth that means nothing
    await withSetting('repositoryScanMaxDepth', -5, async () => {
      // act
      const items = await topLevelItems();

      // assert: alpha and beta are found, as at the default depth of 1. Passed on as it
      // is, -5 would have meant "nothing below any folder" (core/discovery.ts compares the
      // depth with `<`), and the layers alone would be here — the depth-0 test above.
      const labels = items.map((item) => item.label);
      assert.deepStrictEqual(labels, ['repo', 'alpha', 'beta']);
    });
  });

  it('treats a depth that is not a whole number as the default', async () => {
    // arrange: a depth between 1 and 2
    await withSetting('repositoryScanMaxDepth', 1.5, async () => {
      // act
      const items = await topLevelItems();

      // assert: gamma is not reached. Passed on as it is, 1.5 would have behaved as 2
      // (`1 < 1.5` lets the scan into the second level) and found it — the depth-2 test
      // above shows what that looks like.
      const labels = items.map((item) => item.label);
      assert.deepStrictEqual(labels, ['repo', 'alpha', 'beta']);
    });
  });

  it('treats an ignore list that is not a list as the default', async () => {
    // arrange: one string where a list of names belongs — the easy slip
    await withSetting('repositoryScanIgnoredFolders', 'alpha', async () => {
      // act
      const items = await topLevelItems();

      // assert: alpha is not ignored. Passed on as it is, the string would have hidden it:
      // a string has an `includes` method too, `'alpha'.includes('alpha')` is true, and
      // that is the call the scan makes for every folder name.
      const labels = items.map((item) => item.label);
      assert.deepStrictEqual(labels, ['repo', 'alpha', 'beta']);
    });
  });

  it('keeps the names in an ignore list and drops an entry that is not a name', async () => {
    // arrange: a list with a number in it
    await withSetting('repositoryScanIgnoredFolders', ['beta', 7], async () => {
      // act
      const items = await topLevelItems();

      // assert: the name the user did type is honoured; the stray entry does not throw the
      // whole list away for the default
      const labels = items.map((item) => item.label);
      assert.deepStrictEqual(labels, ['repo', 'alpha']);
    });
  });

  it('declares in package.json the same defaults the code uses, so the Settings editor and the scan agree', () => {
    // arrange: the manifest as VS Code read it, and the corner of it this test needs
    const extension = vscode.extensions.getExtension('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    // see primer §42 (packageJSON is `any`; a written type puts it back under checking)
    const manifest: ExtensionManifest = extension.packageJSON;
    const properties = manifest.contributes.configuration.properties;

    // act
    // see primer §43 (Record<keyof ...>: an interface's field names, with any values)
    const declared: Record<keyof DiscoveryOptions, unknown> = {
      scanMaxDepth: properties['prCascade.repositoryScanMaxDepth'].default,
      scanIgnoredFolders: properties['prCascade.repositoryScanIgnoredFolders'].default,
    };

    // assert: the values src/vscode/config.ts falls back to are the ones the Settings
    // editor shows; change a default on one side without the other and this fails. Adding
    // a field to DiscoveryOptions without reading its package.json default here does not
    // get this far: the annotation on `declared` makes `npm run typecheck` refuse it.
    assert.deepStrictEqual(declared, DEFAULT_DISCOVERY_OPTIONS);
  });
});
