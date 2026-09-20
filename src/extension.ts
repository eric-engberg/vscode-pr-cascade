/**
 * extension.ts — the entry point VS Code calls when the extension starts and stops, and
 * the wiring between the pure logic in src/core and the VS Code adapters in src/vscode.
 *
 * Layer: wiring (plan §4.1); the only file VS Code loads directly (package.json "main"
 * points at its bundled form, dist/extension.js). Depends on: the `vscode` module,
 * core/git.ts, core/discovery.ts, core/trunk.ts, core/stack.ts, core/changes.ts,
 * vscode/config.ts, vscode/tree.ts. Depended on by: VS Code itself, and test/ext/*.
 * Plan: §4.1, §9.1 (what activate returns), §10.1 items 6 and M2 9.
 */

// see primer §1 (import / export), §2 (the vscode module) and §9 (`import type`)
import * as vscode from 'vscode';
import { changedFiles } from './core/changes';
import { discoverRepoRoots } from './core/discovery';
import { RealGitRunner } from './core/git';
import type { ChangedFile, RepoState, StackLayer } from './core/model';
import { computeStack } from './core/stack';
import { detectTrunk } from './core/trunk';
import { readSettings } from './vscode/config';
import { StackTreeProvider } from './vscode/tree';

/**
 * What activate() hands back. VS Code ignores it; the extension-host tests
 * (test/ext/*.test.ts) receive it from `extension.activate()` and drive the tree through
 * it — `provider.getChildren()` for the rows, `refresh()` for what the toolbar button
 * does — instead of reaching into the extension's insides (plan §9.1, "activate() must
 * return { provider, refresh }").
 */
// see primer §9 (interface) and §33 (function types)
export interface ExtensionApi {
  /** The Stack view's data provider — the object VS Code asks for rows. */
  provider: StackTreeProvider;
  /** Recompute everything and redraw: the same thing `prCascade.refresh` does. */
  refresh: () => void;
}

/**
 * Called by VS Code once, when the extension is activated — after startup finishes, per
 * "activationEvents" in package.json. Everything the extension ever does begins here, and
 * this is the one place that knows about both halves of the codebase: it is where the
 * core's plain functions meet VS Code's views, commands and events, and nothing else
 * happens in it (plan §4.1).
 *
 * Why an output channel rather than console.log: an output channel appears in the user's
 * Output panel (dropdown entry "PR Cascade"), so someone who is not running the debugger
 * can still see what the extension did on each refresh.
 */
// see primer §3 (functions and type annotations) and §32 (EventEmitter and Event:
// subscribing, and context.subscriptions)
export function activate(context: vscode.ExtensionContext): ExtensionApi {
  // see primer §4 (const)
  const output = vscode.window.createOutputChannel('PR Cascade');
  // Anything pushed onto context.subscriptions is disposed by VS Code when the extension
  // is deactivated, so nothing here has to be cleaned up by hand.
  context.subscriptions.push(output);

  // The provider is handed both pipelines as functions and calls them when VS Code asks:
  // the first for the top of the tree, the second for the rows under a layer the user
  // opens (vscode/tree.ts explains why functions and not the results). The output
  // channel goes along so a failure the provider turns into a row is also logged.
  // see primer §5 (arrow functions) and §33 (function types: a closure over `output`)
  const provider = new StackTreeProvider(
    () => loadRepoStates(output),
    (root, layer) => loadChangedFiles(output, root, layer),
    output,
  );
  context.subscriptions.push(provider);
  // "prCascade" is the view id from package.json "contributes.views"; VS Code has
  // already drawn the empty view under Source Control and now knows whom to ask for rows.
  context.subscriptions.push(vscode.window.registerTreeDataProvider('prCascade', provider));

  function refresh(): void {
    provider.refresh();
  }
  // The toolbar button (package.json "contributes.menus" › "view/title") runs the command
  // by this id; registering it here is what gives the id a function to run.
  context.subscriptions.push(vscode.commands.registerCommand('prCascade.refresh', refresh));
  // A folder added to or removed from the workspace changes which repositories exist
  // (plan §6: "re-run discovery on onDidChangeWorkspaceFolders"). Every other trigger —
  // window focus, the editor changing, after a command — is M4's.
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(refresh));

  output.appendLine('PR Cascade active');
  // see primer §16 (object literals: shorthand keys)
  return { provider, refresh };
}

/**
 * Called by VS Code when the extension shuts down (window closed, extension disabled).
 * There is nothing to do by hand — VS Code disposes everything in context.subscriptions —
 * but VS Code looks for this export, so it exists and is empty.
 */
export function deactivate(): void {
  // Intentionally empty; see the comment above.
}

/**
 * The whole read pipeline, run once per refresh: the four core functions in the order
 * the plan lays them out (§6 discovery, §5 trunk, §5 stack), over the folders open in
 * this window. One RepoState per repository, in workspace order; a repository whose
 * trunk cannot be found is kept, with `trunk: null`, so the tree can say so (E4) rather
 * than leave the repository out without a word.
 *
 * Settings are read here, on every run, so a changed `prCascade.gitPath`,
 * `prCascade.trunk` or scan setting takes effect at the next refresh — and the git
 * runner is rebuilt from them for the same reason (it holds nothing but the path). A
 * failure anywhere in here — git missing (E17), a command exiting non-zero — rejects, and
 * the provider turns that into one error row (vscode/tree.ts, topLevelNodes).
 */
// see primer §6 (async / await), §22 (for ... of) and §30 (`??`)
async function loadRepoStates(output: vscode.OutputChannel): Promise<RepoState[]> {
  const settings = readSettings();
  const git = new RealGitRunner(settings.gitPath);

  // `workspaceFolders` is `undefined` when no folder is open at all (an empty window),
  // and a list otherwise; `?? []` makes both cases a list. `uri.fsPath` is the folder as
  // a plain file-system path, which is what git needs as a working directory.
  // see primer §25 (arrays: map)
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folderPaths = folders.map((folder) => folder.uri.fsPath);
  // The settings object is a DiscoveryOptions by declaration (vscode/config.ts:
  // `PrCascadeSettings extends DiscoveryOptions`), its two scan fields already checked
  // there, so it is handed over as it is — no second copy to keep in step. The rules of
  // the scan itself live in core/discovery.ts (plan §13.4).
  const roots = await discoverRepoRoots(folderPaths, git, settings);

  const states: RepoState[] = [];
  for (const root of roots) {
    const trunk = await detectTrunk(git, root, { configured: settings.trunk, remote: settings.remote });
    if (trunk === null) {
      output.appendLine(`${root}: no trunk found (set prCascade.trunk)`);
      // Nothing can be measured without a trunk, so no stack is computed and HEAD is not
      // looked up either: `head: null` here is the "not computed" case core/model.ts
      // names next to "detached", and nothing draws `head` while `trunk` is null — the
      // tree shows only the E4 message for this state.
      states.push({ root, trunk: null, head: null, layers: [] });
      continue;
    }
    const state = await computeStack(git, root, trunk);
    // see primer §12 (template strings)
    output.appendLine(`${root}: ${state.layers.length} layer(s) above ${trunk}`);
    states.push(state);
  }
  return states;
}

/**
 * The second half of the read pipeline: the files one layer changes against the layer
 * below it, for the provider to list under the layer's row. Run per layer and on demand
 * — when the user opens the row — rather than once per refresh, because a diff is only
 * wanted for a layer someone looks at, and the provider keeps the answer for a pair of
 * commits it has seen (vscode/tree.ts, filesByCommitPair). `changedFiles`
 * (core/changes.ts) does the work, over the two SHAs the layer carries rather than the
 * branch names — its doc comment says why.
 *
 * The runner is built here, the way loadRepoStates builds its own: from the setting, on
 * every call, so a corrected `prCascade.gitPath` takes effect at the next click and not
 * at the next window. Neither the provider nor the core ever constructs one (plan §4.1):
 * this function is what activate() hands the provider, and a test could hand it
 * something else. A failure rejects, and the provider turns it into one error row under
 * the layer (vscode/tree.ts, filesForLayer).
 */
async function loadChangedFiles(output: vscode.OutputChannel, root: string, layer: StackLayer): Promise<ChangedFile[]> {
  const settings = readSettings();
  const git = new RealGitRunner(settings.gitPath);
  const files = await changedFiles(git, root, layer.parentSha, layer.sha);
  output.appendLine(`${layer.name}: ${files.length} file(s) changed against ${layer.parent}`);
  return files;
}
