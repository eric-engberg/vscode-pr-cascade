/**
 * test/ext-parent/parentFolder.test.ts — E1, delegated: Ric's layout (plan §1) inside a real
 * VS Code — a parent folder that is not a repository, opened as the workspace's one folder,
 * with a repository one level below it and another two levels down. The built-in Git
 * extension's own scan finds the first at its default depth, with no setting of ours, and
 * leaves the second; the view shows the found repository's stack.
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * This file runs in a VS Code launch of its own — the second entry in .vscode-test.mjs —
 * because the Git extension looks *below* a workspace folder only in its initial scan, when
 * the window opens (plan §8 E1): a parent folder added to a running workspace is opened as
 * a repository itself, never scanned. Depends on: the running extension, the real built-in
 * Git extension through test/ext/helpers/gitApi.ts (the adapter, for the repository list),
 * the layout .vscode-test.mjs built. Depended on by: nothing. Plan: §8 E1, §9.4 row `ext/gitApi.test.ts`
 * ("E1 delegated"), §10.1 item 12a.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';
import type { StackTreeProvider } from '../../src/vscode/tree';
import { realGitApi } from '../ext/helpers/gitApi';

// The plan Appendix A stack, top layer first, as the view lists it (plan §7.1).
// see primer §4 (const)
const LAYERS_TOP_FIRST = ['retry-metrics', 'add-retries', 'api-refactor'];

let provider: StackTreeProvider;
let output: vscode.OutputChannel;

/** The workspace's one folder: the parent that is not a repository. */
// see primer §30 (`??`) and §8 (undefined and narrowing)
function parentFolder(): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  assert.strictEqual(folders.length, 1, 'this launch opens exactly one folder, the parent');
  return folders[0].uri.fsPath;
}

// see primer §5 (arrow functions)
describe('a repository below the workspace folder (E1, delegated to the Git extension)', () => {
  before(async () => {
    // see primer §31 (a type argument on a call) and §8 (undefined and narrowing)
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    const api = await extension.activate();
    provider = api.provider;
    output = vscode.window.createOutputChannel('PR Cascade tests');
  });

  after(() => {
    output.dispose();
  });

  it('is opened by the Git extension\'s initial scan at its default depth — one level down, not two — with no setting of ours', async () => {
    // arrange: the layout .vscode-test.mjs built — `parent/one` is a repository, so is
    // `parent/deep/two`, and `parent` itself is not. Checked, not assumed: without the
    // two-level repository the "not two" half of this test would prove nothing.
    // see primer §28 (the Sync variants of Node's functions: `existsSync` is `test -e`)
    const parent = parentFolder();
    assert.ok(fs.existsSync(path.join(parent, 'one', '.git')), 'fixture: parent/one is not a repository');
    assert.ok(fs.existsSync(path.join(parent, 'deep', 'two', '.git')), 'fixture: parent/deep/two is not a repository');
    assert.ok(!fs.existsSync(path.join(parent, '.git')), 'fixture: parent itself is a repository');

    // act: the handshake, through the same adapter and host src/extension.ts uses
    const api = await realGitApi(output);

    // assert: exactly the one-level repository. `git.repositoryScanMaxDepth` is 1 by
    // default, and this extension no longer has a depth setting to raise or lower.
    const roots = api.repositories.map((repository) => repository.rootUri.fsPath);
    assert.deepStrictEqual(roots, [path.join(parent, 'one')]);
  });

  it('shows that repository\'s stack at the top level of the view', async () => {
    // arrange: nothing beyond the layout

    // act
    const nodes = await provider.getChildren();
    const labels = nodes.map((node) => provider.getTreeItem(node).label);

    // assert: one repository, so its layers sit at the top (plan §6) — the view works for a
    // repository the Git extension found below the folder exactly as for one that is the folder
    assert.deepStrictEqual(labels, LAYERS_TOP_FIRST);
  });
});
