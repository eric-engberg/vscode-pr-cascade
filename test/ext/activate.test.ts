/**
 * test/ext/activate.test.ts — extension-host smoke tests: the extension is installed in the
 * test VS Code and activates.
 *
 * Layer: test, extension host (plan §9.1 layer 3). Runs inside a real VS Code launched by
 * `npm run test:ext` (.vscode-test.mjs), with Mocha as the runner because VS Code's harness
 * requires Mocha. Deliberately tiny: its job is to prove the harness works so later PRs can
 * add real assertions (view registered, layers rendered). Plan: §9.4 row
 * "ext/activate.test.ts", §10.1 item 1.
 */

// see primer §1 (import / export)
import * as assert from 'node:assert';
// Every test file imports describe/it from its own runner: 'mocha' here, 'vitest' in
// test/unit and test/git. The vocabulary is the same; neither is a global.
import { describe, it } from 'mocha';
import * as vscode from 'vscode';

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
});
