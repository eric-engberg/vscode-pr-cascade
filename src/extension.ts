/**
 * extension.ts — the entry point VS Code calls when the extension starts and stops, and
 * the wiring between the pure logic in src/core and the VS Code adapters in src/vscode.
 *
 * Layer: wiring (plan §4.1); the only file VS Code loads directly (package.json "main"
 * points at its bundled form, dist/extension.js). Depends on: the `vscode` module,
 * core/git.ts, trunk.ts, stack.ts, changes.ts, uri.ts (the scheme name), debounce.ts (the
 * refresh), vscode/gitApi.ts (the built-in Git extension: repositories, events, the status
 * signal, the git executable), vscode/config.ts,
 * tree.ts, content.ts, commands.ts. Depended on by: VS Code itself, test/ext/* and
 * test/ext-parent/*. Plan:
 * §4.1, §6, §7.14, §9.1 (what activate returns), §10.1 items 6, M2 9, M3 11, M4 12a, 12b.
 */

// see primer §1 (import / export), §2 (the vscode module) and §9 (`import type`)
import * as vscode from 'vscode';
import { changedFiles } from './core/changes';
import { debounce } from './core/debounce';
import { RealGitRunner } from './core/git';
import type { ChangedFile, RepoState, StackLayer } from './core/model';
import { computeStack } from './core/stack';
import { detectTrunk } from './core/trunk';
import { STACK_DIFF_SCHEME } from './core/uri';
import { openDiff } from './vscode/commands';
import { readSettings } from './vscode/config';
import type { PrCascadeSettings } from './vscode/config';
import { StackDiffContentProvider } from './vscode/content';
import { GitExtensionAdapter, GitUnavailableError, gitExecutable, realGitExtensionHost, sortRepositoryRoots } from './vscode/gitApi';
import type { GitApi } from './vscode/gitApi';
import { StackTreeProvider } from './vscode/tree';

/**
 * How long the view waits after the last "a git status completed" event, or the last click
 * on Refresh, before it recomputes (core/debounce.ts). A quarter of a second is short next
 * to the pipeline that follows it (a handful of git spawns) and well over the gap between
 * the statuses of one burst of the Git extension's. M5 revisits the value with its digest
 * pre-filter (plan §7.14.2).
 */
// see primer §4 (const)
const STATUS_REFRESH_DELAY_MS = 250;

/**
 * What activate() hands back. VS Code ignores it; the extension-host tests
 * (test/ext/*.test.ts) receive it from `extension.activate()` and drive the tree through
 * it — `provider.getChildren()` for the rows, `refresh()` for a redraw at once — instead
 * of reaching into the extension's insides (plan §9.1, "activate() must return
 * { provider, refresh }").
 */
// see primer §9 (interface) and §33 (function types)
export interface ExtensionApi {
  /** The Stack view's data provider — the object VS Code asks for rows. */
  provider: StackTreeProvider;
  /**
   * Recompute everything and redraw, at once. The toolbar button (`prCascade.refresh`) ends
   * in this same function, but through `refreshSoon` — the debounce in `activate` — so a
   * test that wants the redraw now uses this handle, not the command.
   */
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

  // The built-in Git extension is where the repositories come from (plan §7.14): the
  // adapter runs its handshake when the first of the three pipelines below asks for the
  // connection — the first refresh, moments from now — and keeps the outcome for every
  // later one. The
  // real host — `getExtension('vscode.git')`, the extensions event, the `git.enabled`
  // setting — is handed in here so the adapter itself never has to touch those and a test
  // can hand it stand-ins instead (vscode/gitApi.ts says why).
  const gitExtension = new GitExtensionAdapter(realGitExtensionHost, output);
  context.subscriptions.push(gitExtension);

  // The provider is handed both pipelines as functions and calls them when VS Code asks:
  // the first for the top of the tree, the second for the rows under a layer the user
  // opens (vscode/tree.ts explains why functions and not the results). The output
  // channel goes along so a failure the provider turns into a row is also logged.
  // see primer §5 (arrow functions) and §33 (function types: a closure over `output`)
  const provider = new StackTreeProvider(
    () => loadRepoStates(output, gitExtension),
    (root, layer) => loadChangedFiles(output, gitExtension, root, layer),
    output,
  );
  context.subscriptions.push(provider);
  // "prCascade" is the view id from package.json "contributes.views"; VS Code has
  // already drawn the empty view under Source Control and now knows whom to ask for rows.
  context.subscriptions.push(vscode.window.registerTreeDataProvider('prCascade', provider));

  function refresh(): void {
    provider.refresh();
  }
  // The refreshes that come in bursts go through one debounce (core/debounce.ts): every
  // completed `git status` in any repository — the Git extension runs several in a row
  // during its own operations — and the toolbar button, so that a click during such a
  // burst costs one redraw, not two (plan §7.14.2). The open/close and folder events below
  // stay direct: each is a discrete change of the list, and a redraw per change is right.
  // `schedule` is passed bare below, as `refresh` is: it closes over its own state and
  // never reads `this`, so detaching it from `refreshSoon` loses nothing (primer §64).
  const refreshSoon = debounce(refresh, STATUS_REFRESH_DELAY_MS);
  // Cancelled on shutdown, so a run still pending cannot fire into a disposed view. An
  // object with a `dispose` method is all a Disposable is (primer §9: structural typing).
  context.subscriptions.push({ dispose: () => refreshSoon.cancel() });
  // The toolbar button (package.json "contributes.menus" › "view/title") runs the command
  // by this id; registering it here is what gives the id a function to run.
  context.subscriptions.push(vscode.commands.registerCommand('prCascade.refresh', refreshSoon.schedule));
  // The Git extension opened or closed a repository, or became usable (plan §7.14.2) — the
  // list of repositories changed, so redraw.
  context.subscriptions.push(gitExtension.onDidChange(refresh));
  // A repository's `git status` completed (plan §7.14.2, E20): after git run in a terminal
  // the Git extension's watcher saw it, waited for the window to regain focus, ran the
  // status and fired — and after its own operations too. What changed is not in the event
  // (and a ref that moved on its own is never seen — E83, the button is the recovery), so
  // the answer is always the same: recompute, soon.
  context.subscriptions.push(gitExtension.onDidRunStatus(refreshSoon.schedule));
  // A folder added, removed or reordered in the workspace changes the order the
  // repositories are listed in (plan §6: folder order is the sort key), and need not open
  // or close a repository at all — a folder added inside an open repository opens nothing
  // — so this one-line listener stays beside the Git extension's events.
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(refresh));

  // The diff on click (M3). Two registrations that only meet inside VS Code: the
  // content provider answers for every `stackdiff:` URI — VS Code routes a URI to the
  // provider registered for its scheme, so the scheme name here and the one core/uri.ts
  // writes into every URI must be the same string, hence the shared constant — and the
  // command builds two such URIs from a file row and asks VS Code for a diff editor on
  // them (vscode/commands.ts). The provider gets its reader the way the tree got its
  // loaders: a function closing over `output`, built here, so vscode/content.ts never
  // sees a runner or a setting.
  // see primer §53 (TextDocumentContentProvider and registering one for a scheme)
  const contentProvider = new StackDiffContentProvider((root, ref, relPath) => loadFileAtRef(output, gitExtension, root, ref, relPath));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(STACK_DIFF_SCHEME, contentProvider));
  // Run by a click on a file row (vscode/tree.ts sets `item.command` to this id) with
  // the row's node as the argument, or from the Command Palette with none.
  context.subscriptions.push(vscode.commands.registerCommand('prCascade.openDiff', openDiff));

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
 * What every pipeline starts from: the Git extension's API, the settings as they are right
 * now, and a git runner built from the two. Read afresh on every call — a corrected
 * `prCascade.gitPath` or `prCascade.trunk` takes effect at the next refresh or click, not
 * the next window — while the connection itself is the adapter's one memoised handshake,
 * so awaiting it costs nothing once it has settled.
 */
// see primer §9 (interface)
interface ConnectedGit {
  api: GitApi;
  settings: PrCascadeSettings;
  git: RealGitRunner;
}

/**
 * Waits for the Git extension and builds the runner. The executable is `prCascade.gitPath`
 * when set, else the git the Git extension found (vscode/gitApi.ts, `gitExecutable`), so
 * both extensions run the same git. An unusable Git extension (E82) is thrown as a
 * GitUnavailableError carrying the row text from plan §7.14.3: no git of ours runs, and
 * the tree draws the message as a warning (vscode/tree.ts).
 */
// see primer §6 (async / await) and §59 (tagged unions: `connection.kind` decides which
// fields exist)
async function connectedGit(gitExtension: GitExtensionAdapter): Promise<ConnectedGit> {
  const connection = await gitExtension.connection();
  if (connection.kind === 'unavailable') {
    throw new GitUnavailableError(connection.message);
  }
  const settings = readSettings();
  const git = new RealGitRunner(gitExecutable(settings.gitPath, connection.api.git.path));
  return { api: connection.api, settings, git };
}

/**
 * The whole read pipeline, run once per refresh: the repositories the Git extension has
 * open (plan §6, §7.14), then the core functions in the order the plan lays them out (§5
 * trunk, §5 stack). One RepoState per repository, in the order of plan §6 — by the
 * workspace folder each belongs to, then by path — and a repository whose trunk cannot be
 * found is kept, with `trunk: null`, so the tree can say so (E4) rather than leave the
 * repository out without a word. A failure anywhere in here — git missing (E17), a command
 * exiting non-zero, the Git extension unusable (E82) — rejects, and the provider turns
 * that into one row (vscode/tree.ts, topLevelNodes).
 */
// see primer §6 (async / await), §22 (for ... of), §25 (arrays: map) and §30 (`??`)
async function loadRepoStates(output: vscode.OutputChannel, gitExtension: GitExtensionAdapter): Promise<RepoState[]> {
  const { api, settings, git } = await connectedGit(gitExtension);

  // `rootUri.fsPath` is the repository root as a plain file-system path — the physical
  // path, since the Git extension gets it from `git rev-parse --show-toplevel`. The Git
  // extension's own list is in no stable order (vscode/gitApi.ts, sortRepositoryRoots);
  // `workspaceFolders` is `undefined` when no folder is open at all (an empty window), and
  // a list otherwise; `?? []` makes both cases a list.
  const roots = api.repositories.map((repository) => repository.rootUri.fsPath);
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folderPaths = folders.map((folder) => folder.uri.fsPath);
  const sortedRoots = sortRepositoryRoots(roots, folderPaths);

  const states: RepoState[] = [];
  for (const root of sortedRoots) {
    const trunk = await detectTrunk(git, root, { configured: settings.trunk, remote: settings.remote });
    if (trunk === null) {
      output.appendLine(`${root}: no trunk found (set prCascade.trunk)`);
      // Nothing can be measured without a trunk, so no stack is computed, and neither HEAD
      // nor the rebase directories are looked up: `head: null` and `rebaseInProgress: false`
      // here are the "not computed" case core/model.ts names next to "detached" and
      // "paused", and nothing draws either while `trunk` is null — the tree shows only the
      // E4 message for this state.
      states.push({ root, trunk: null, head: null, rebaseInProgress: false, layers: [] });
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
 * The runner comes from connectedGit, the way loadRepoStates' does: from the settings, on
 * every call, so a corrected `prCascade.gitPath` takes effect at the next click and not
 * at the next window. Neither the provider nor the core ever constructs one (plan §4.1):
 * this function is what activate() hands the provider, and a test could hand it
 * something else. A failure rejects, and the provider turns it into one error row under
 * the layer (vscode/tree.ts, filesForLayer).
 */
async function loadChangedFiles(
  output: vscode.OutputChannel,
  gitExtension: GitExtensionAdapter,
  root: string,
  layer: StackLayer,
): Promise<ChangedFile[]> {
  const { git } = await connectedGit(gitExtension);
  const files = await changedFiles(git, root, layer.parentSha, layer.sha);
  output.appendLine(`${layer.name}: ${files.length} file(s) changed against ${layer.parent}`);
  return files;
}

/**
 * The third pipeline, one file deep: the text of `relPath` as it was at the commit `ref`
 * in the repository at `root` — what the content provider (vscode/content.ts) hands VS
 * Code for one side of a diff. Run once per side of each diff the user opens, and never
 * on a refresh. The runner comes from connectedGit on every call, as the other two
 * pipelines' do, and for the same reason.
 *
 * The command is `git show <ref>:<relPath> --` (plan §5 "File content at ref"): `<ref>:<path>`
 * names a blob — that file in that commit's tree — and `git show` prints it as it is, no
 * header, no trailing newline added. The `--` says "everything before me is a revision":
 * without it, a file in the working directory that happens to be named `<sha>:<path>`
 * makes git refuse the argument as ambiguous ("both revision and filename", exit 128);
 * with it git reads the same blob either way (verified on git 2.50 while writing this,
 * with such a file present). The output is returned untouched — it *is* the file, and
 * trimming would eat a final newline the file has, or the whole of a file that is only
 * whitespace.
 *
 * `tryRun`, not `run`: a non-zero exit is an ordinary answer here. `git show` exits 128
 * when the file does not exist at that commit — an added file's parent side (E8), a
 * deleted file's layer side (E9) — and the diff editor should show an empty pane for
 * both (plan §5: "treat as empty string"). A `null` from `tryRun` means git had nothing
 * to give: the file is not in that commit, or — a repository deleted or renamed under an
 * open window — the directory could not be used (core/git.ts, tryRun, lists what it
 * swallows). Either way `null` becomes `''`. A git that cannot start (E17), a signal, or
 * an output larger than 32 MB still rejects, which VS Code reports in place of the
 * document. The Output panel notes which happened — nothing from git, or how much —
 * since an empty pane cannot say on its own whether the file was absent or empty.
 */
// see primer §6 (async / await), §12 (template strings), §48 (the conditional expression)
// and §30 (`??`: the empty string for a file the commit does not have)
async function loadFileAtRef(
  output: vscode.OutputChannel,
  gitExtension: GitExtensionAdapter,
  root: string,
  ref: string,
  relPath: string,
): Promise<string> {
  const { git } = await connectedGit(gitExtension);
  const content = await git.tryRun(['show', `${ref}:${relPath}`, '--'], root);
  const outcome = content === null ? 'git had no content for it, shown empty' : `${content.length} character(s)`;
  // The SHA cut to seven characters, as the tooltips show it (vscode/tree.ts, shortSha,
  // says why seven); a string helper is not worth an import of the tree module.
  output.appendLine(`${relPath} @ ${ref.slice(0, 7)}: ${outcome}`);
  return content ?? '';
}
