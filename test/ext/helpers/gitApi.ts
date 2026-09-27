/**
 * test/ext/helpers/gitApi.ts — the one place the extension-host tests reach the built-in
 * Git extension's API: through the extension's own adapter and the real host, exactly the
 * way src/extension.ts does, so a test sees the repositories and events the view sees
 * (plan §9.1 layer 3, "From M4").
 *
 * Layer: test helper, extension host (Mocha inside VS Code, `npm run test:ext`; compiled
 * by tsconfig.ext.json with test/ext, and not a test itself — the runner's glob takes only
 * `*.test.js`). Depends on: the `vscode` module (a type only), src/vscode/gitApi.ts (the
 * adapter, its real host, the `GitApi` type). Depended on by: test/ext/gitApi.test.ts,
 * test/ext-parent/parentFolder.test.ts; from M4 item 12b the tree tests that need
 * `repository.status()`. Plan: §9.1 layer 3, §7.14.
 */

// see primer §1 (import / export) and §9 (`import type`)
import type { OutputChannel } from 'vscode';
import { GitExtensionAdapter, realGitExtensionHost } from '../../../src/vscode/gitApi';
import type { GitApi } from '../../../src/vscode/gitApi';

/**
 * The Git extension's API from a fresh handshake with the real extension. A fresh adapter
 * per call keeps each test's listeners its own; the API object outlives the adapter that
 * fetched it, so only the adapter's own subscriptions go in the `finally`. Throws, with the
 * E82 row's text, if the real Git extension is not usable in the test VS Code — a broken
 * harness, not a case any test expects.
 */
// see primer §6 (async / await) and §18 (try / catch: `finally` runs either way)
export async function realGitApi(output: OutputChannel): Promise<GitApi> {
  const adapter = new GitExtensionAdapter(realGitExtensionHost, output);
  try {
    const connection = await adapter.connection();
    if (connection.kind !== 'ready') {
      throw new Error(`the real Git extension is not usable in the test VS Code: ${connection.message}`);
    }
    return connection.api;
  } finally {
    adapter.dispose();
  }
}
