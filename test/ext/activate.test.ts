/**
 * test/ext/activate.test.ts — extension-host smoke tests: the extension is installed in the
 * test VS Code, activates, registers its view and command, and returns the API the other
 * extension-host tests drive.
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * Depends on: the running extension, package.json "contributes". Depended on by: nothing.
 * Plan: §9.4 row "ext/activate.test.ts", §9.1 "activate() must return { provider,
 * refresh }", §10.1 items 1 and 6.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
// Every test file imports describe/it from its own runner: 'mocha' here (VS Code's
// harness requires Mocha), 'vitest' in test/unit and test/git. The vocabulary is the
// same; neither is a global.
import { describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';

// Deliberately small: what the view *shows* is test/ext/tree.test.ts's job; this file
// proves the plumbing — package.json "contributes" and activate() — is wired.
// see primer §5 (arrow functions)
describe('extension activation', () => {
  it('is installed under the id local.vscode-pr-cascade', () => {
    // act: the id is "<publisher>.<name>" from package.json (plan §12 "name").
    const extension = vscode.extensions.getExtension('local.vscode-pr-cascade');

    // assert
    assert.notStrictEqual(extension, undefined, 'VS Code did not load the extension from --extensionDevelopmentPath');
  });

  // see primer §6 (async / await) and §7 (Promise)
  it('activates', async () => {
    // arrange
    const extension = vscode.extensions.getExtension('local.vscode-pr-cascade');
    // see primer §8 (undefined and narrowing): not the idea under test (the test above
    // owns that), only proof to the compiler that `extension` is present.
    assert.ok(extension);

    // act: resolves once activate() in src/extension.ts has run. With "onStartupFinished"
    // it may already be active; calling activate() again is harmless.
    await extension.activate();

    // assert
    assert.strictEqual(extension.isActive, true);
  });

  it('returns { provider, refresh } from activate(), so tests can reach the tree', async () => {
    // arrange
    // see primer §31 (a type argument on a call): what activate() resolves with
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    assert.ok(extension);

    // act
    const api = await extension.activate();

    // assert: the two things plan §9.1 requires — a provider VS Code could ask for rows,
    // and the refresh function the toolbar button runs
    assert.strictEqual(typeof api.provider.getChildren, 'function');
    assert.strictEqual(typeof api.provider.getTreeItem, 'function');
    assert.strictEqual(typeof api.refresh, 'function');
  });

  it('registers the Stack view: VS Code accepts the `prCascade.focus` command it creates for every contributed view', async () => {
    // arrange: package.json "contributes.views.scm" declares the view with id prCascade;
    // VS Code makes a `<viewId>.focus` command for each declared view, and running it
    // fails with "command not found" for an id that was never contributed.

    // act + assert: the command resolves rather than rejecting with "command not found"
    // (the Source Control side bar opens on the Stack view). `doesNotReject` states the
    // check in the open: an awaited call that merely does not throw reads as a test with
    // nothing asserted (SonarQube rule S2699).
    // `executeCommand` returns VS Code's own Thenable, not a Promise, and doesNotReject
    // wants a Promise — an async arrow that awaits it hands one over.
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('prCascade.focus');
    });
  });

  it('registers the prCascade.refresh command that the view toolbar runs', async () => {
    // arrange: the extension is active (the tests above), so activate() has registered it
    const extension = vscode.extensions.getExtension('local.vscode-pr-cascade');
    assert.ok(extension);
    await extension.activate();

    // act: every command id VS Code knows right now (true = include internal ones)
    const commands = await vscode.commands.getCommands(true);

    // assert
    assert.ok(commands.includes('prCascade.refresh'), 'prCascade.refresh is not registered');
  });
});
