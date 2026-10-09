/**
 * extension.ts — the entry point VS Code calls when the extension starts and stops, and
 * the wiring between the pure logic in src/core and the VS Code adapters in src/vscode.
 *
 * Layer: wiring (plan §4.1); the only file VS Code loads directly (package.json "main"
 * points at its bundled form, dist/extension.js). Depends on: the `vscode` module, Node's
 * `node:fs` (`existsSync`, for where Homebrew is) and `node:path` (a repository's folder name
 * in a sentence), core/git.ts, trunk.ts, stack.ts, changes.ts, uri.ts (the scheme name),
 * debounce.ts (the refresh), command.ts, backends/gitspice.ts (the readiness probe; `enrich` on
 * every load, `track` from Track Stack, item 20b, and `push` from Push Whole Stack, item 21b),
 * poll.ts, readinessFix.ts (`readyMessage`, `trunkBranchFor`), vscode/gitApi.ts (the built-in Git
 * extension: repositories, events, the status signal, the git executable), vscode/config.ts,
 * contextKeys.ts (the names of the context keys the listener sets), tree.ts, statusbar.ts,
 * content.ts, commands.ts, terminal.ts, login.ts (the git-spice setup flow, `chooseRepository`).
 * Depended on by: VS Code itself, test/ext/* and test/ext-parent/*. Plan: §4.1, §6, §7.1.0 (the
 * status bar), §7.2 (`prCascade.setUpGitSpice`, D58; `prCascade.trackStack`, D60;
 * `prCascade.pushStack`, D62), §7.2.1 (the `…` menu entries, their context keys and `enablement`),
 * §7.7 (tracking before a push), §7.8 (the local tier on every load), §7.13.1, §7.14, §7.14.2 (the
 * digest behind `enrich`), §8 E3/E12/E56/E76/E83, §9.1 (what activate returns), §10.1 items 6, M2
 * 9, M3 11, M4 12a, 12b, 14, M5 19b, 20b, 21b; §13.2 D52, D58, D60, D62.
 */

// see primer §1 (import / export), §2 (the vscode module) and §9 (`import type`)
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { PushResult, Readiness, TrackResult } from './core/backend';
import { GitSpiceBackend } from './core/backends/gitspice';
import { changedFiles } from './core/changes';
import { RealCommandRunner } from './core/command';
import type { CommandRunner } from './core/command';
import { debounce } from './core/debounce';
import { RealGitRunner } from './core/git';
import type { ChangedFile, EnrichmentCause, RepoState, StackLayer } from './core/model';
import { DEFAULT_POLL } from './core/poll';
import { readyMessage, trunkBranchFor } from './core/readinessFix';
import { computeStack } from './core/stack';
import { detectTrunk } from './core/trunk';
import { STACK_DIFF_SCHEME } from './core/uri';
import { openDiff } from './vscode/commands';
import { readSettings } from './vscode/config';
import type { PrCascadeSettings } from './vscode/config';
import { HAS_UNTRACKED_KEY, REBASE_IN_PROGRESS_KEY } from './vscode/contextKeys';
import { StackDiffContentProvider } from './vscode/content';
import { GitExtensionAdapter, GitUnavailableError, gitExecutable, realGitExtensionHost, sortRepositoryRoots } from './vscode/gitApi';
import type { GitApi } from './vscode/gitApi';
import { chooseRepository, machineFacts, ReadinessFlows } from './vscode/login';
import type { FlowDeps, ReadinessHost, ReadyOutcome } from './vscode/login';
import { StackStatusBar } from './vscode/statusbar';
import type { TerminalHost } from './vscode/terminal';
import { StackTreeProvider, type StackNode } from './vscode/tree';

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
 * What activate() hands back. VS Code ignores it, but every other extension in the window
 * could read it; the extension-host tests (test/ext/*.test.ts) receive it from
 * `extension.activate()` and drive the tree through it — `provider.getChildren()` for the
 * rows, `refresh()` for a redraw at once — instead of reaching into the extension's insides
 * (plan §9.1, "activate() must return { provider, refresh }"). Anything that exists only for
 * the tests is added only when the extension runs under the test harness (plan §13.4;
 * primer §68).
 */
// see primer §9 (interface), §33 (function types) and §11 (an optional `?` field)
export interface ExtensionApi {
  /** The Stack view's data provider — the object VS Code asks for rows. */
  provider: StackTreeProvider;
  /**
   * Recompute everything and redraw, at once. The toolbar button (`prCascade.refresh`) ends
   * in this same function, but through `refreshSoon` — the debounce in `activate` — so a
   * test that wants the redraw now uses this handle, not the command.
   */
  refresh: () => void;
  /**
   * The status bar item's wrapper — present only under `ExtensionMode.Test` (plan §13.4):
   * its text and whether it is showing are what test/ext/statusbar.test.ts asserts, and the
   * item itself cannot be read back from VS Code.
   */
  statusBar?: StackStatusBar;
  /** The Stack view itself — present only under `ExtensionMode.Test`, for the one test that hides the view and expects the item to keep up (D52). */
  treeView?: vscode.TreeView<StackNode>;
  /**
   * What the git-spice setup flow takes from outside — present only under `ExtensionMode.Test`
   * (plan §13.4): test/ext/login.test.ts puts a FakeCommandRunner, a fake host and a short poll
   * in its fields, and puts the real ones back afterwards. The very object the flow reads at
   * every use, and from whose `commands` `backendFor` builds the backend — not a copy.
   */
  readinessDeps?: ReadinessDeps;
}

/**
 * The setup flow's seams (vscode/login.ts, `FlowDeps`) plus the runner git-spice is run with — a
 * new runner means a new backend (`backendFor`), which is how a test's fake git-spice is used
 * from its first probe.
 */
// see primer §9 (an interface that extends another)
export interface ReadinessDeps extends FlowDeps {
  commands: CommandRunner;
}

/** VS Code's terminals, as vscode/terminal.ts takes them (primer §72). */
// see primer §72 (window.terminals, createTerminal, onDidCloseTerminal)
const realTerminalHost: TerminalHost = {
  terminals: () => vscode.window.terminals,
  create: (options) => vscode.window.createTerminal({ name: options.name, cwd: options.cwd }),
  onDidClose: vscode.window.onDidCloseTerminal,
};

/** VS Code itself, as vscode/login.ts asks for it (primer §73): notifications, the quick pick, the browser, the terminals, the disk. */
// see primer §73 (showWarningMessage with buttons, showQuickPick, env.openExternal), §16 (spread
// into a call) and §28 (`existsSync`, handed on as a function, §33)
const realReadinessHost: ReadinessHost = {
  prompt: (severity, message, buttons) =>
    severity === 'warning' ? vscode.window.showWarningMessage(message, ...buttons) : vscode.window.showInformationMessage(message, ...buttons),
  pick: (labels, placeHolder) => vscode.window.showQuickPick(labels, { placeHolder }),
  openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
  terminals: realTerminalHost,
  machine: () => machineFacts(fs.existsSync),
};

/**
 * The one set of seams for the window — the real ones, unless a test has put fakes in (plan
 * §13.4). Module-level because `backendFor` below reads it too; the extension is activated once
 * per window.
 */
// see primer §4 (const: the binding is fixed, its fields are not) and §68 (a hook to change)
const readinessDeps: ReadinessDeps = { commands: new RealCommandRunner(), host: realReadinessHost, poll: DEFAULT_POLL };

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
  // "prCascade" is the view id from package.json "contributes.views"; VS Code has already
  // drawn the empty view under Source Control and now knows whom to ask for rows. A
  // `TreeView` rather than a bare registration (primer §67), because `refresh` below has to
  // know whether the view is showing.
  const treeView = vscode.window.createTreeView('prCascade', { treeDataProvider: provider });
  context.subscriptions.push(treeView);

  // The status bar item (plan §7.1.0) is fed by the provider: whatever a top-level load
  // produced goes to it — the same load that draws the rows, never a second pipeline; when
  // two loads overlap, the provider lets only the newest speak (vscode/tree.ts, `loads`).
  // `createStatusBarItem` wants an id, a side and a priority (primer
  // §66): left, beside the built-in Git branch item. The listener is an arrow and not a
  // bare `statusBar.update`, because `update` reads `this` — unlike `refreshSoon.schedule`
  // below (primer §64).
  // see primer §35 (enum values from the VS Code API: StatusBarAlignment)
  const statusBar = new StackStatusBar(
    vscode.window.createStatusBarItem('prCascade.stack', vscode.StatusBarAlignment.Left, 100),
    () => readSettings().statusBar,
  );
  context.subscriptions.push(statusBar);
  // The one listener on a load's states feeds four things from the same load (plan §7.1.0 "the
  // same refresh cycle", D52): the status bar; `lastStates`, which Track Stack and Push Whole
  // Stack pick their repository from; the context key `prCascade.hasUntracked`, which is what
  // shows "Track Stack with git-spice" in the view's `…` menu exactly while a repository has a
  // `not tracked` row — a static `when` in package.json cannot say that, a key an extension sets
  // can (plan §7.2.1; the device §7.11 already plans for `prCascade.hasStack`); and
  // `prCascade.rebaseInProgress`, which both commands' `enablement` negate, so their entries are
  // greyed out while a rebase is paused (item 21b; one key for the window, so one paused
  // repository greys them for every repository — and each command still refuses with the
  // folder's name, because `enablement` does not stop `executeCommand`, the route another
  // extension or a test takes; what the Command Palette does with a disabled command is for
  // Ric's F5 and is recorded in plan §13.4, item 21b's bullet). The names come from
  // vscode/contextKeys.ts, the one module package.json's clauses are checked against
  // (test/ext/commands.test.ts): a key's value cannot be read back. `setContext` is a built-in
  // command, the one way an extension writes such a key; its Thenable is nobody's to await
  // (primer §63).
  // see primer §74 (a context key: `executeCommand('setContext', key, value)`, a menu's `when` and a command's `enablement`)
  context.subscriptions.push(
    provider.onDidLoadStates((states) => {
      statusBar.update(states);
      lastStates = states;
      void vscode.commands.executeCommand('setContext', HAS_UNTRACKED_KEY, states.some(hasUntracked));
      void vscode.commands.executeCommand('setContext', REBASE_IN_PROGRESS_KEY, states.some((state) => state.rebaseInProgress));
    }),
  );

  function refresh(): void {
    provider.refresh();
    if (treeView.visible === false) {
      // VS Code asks a hidden view for nothing until it is shown again — it keeps the
      // refresh for then — so nobody would run the pipeline, and the status bar would keep
      // naming a branch that is gone. Run it here: the rows are discarded (VS Code asks
      // again when the view shows), the states event feeds the status bar (plan §13.4, D52).
      // Deliberately not awaited — `void` says so (primer §63): refresh() is called from
      // event handlers that must return at once, and getChildren does not reject while the
      // extension runs — the provider turns every failure into a row (only a load still in
      // flight at shutdown can, once the Output channel is gone, and nothing listens by then).
      void provider.getChildren();
    }
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

  // The git-spice setup flow (M5 item 19b, vscode/login.ts): one per window, handed the refresh
  // a fix of ours must be followed by (E83) and the Output channel for its give-up lines;
  // disposed with the window, which stops every wait at once. "PR Cascade: Set Up git-spice" in
  // the Command Palette is its first caller (D58); the first gated action is M7's `createPRs`.
  // Track Stack (item 20b) and Push Whole Stack (item 21b), below, are not gated: local
  // operations — a push with `--no-publish` consults neither forge nor login — D60 and D62 say why.
  const flows = new ReadinessFlows(readinessDeps, refresh, (line) => output.appendLine(line));
  // `push` takes several at once (primer §25): the flows, and the commands that run them.
  context.subscriptions.push(
    flows,
    vscode.commands.registerCommand('prCascade.setUpGitSpice', () => setUpGitSpice(gitExtension, flows)),
    // "Track Stack with git-spice" — in the view's `…` menu while a layer reads `not tracked`
    // (the first context key above), greyed out during a rebase through the second key (item 21b,
    // D62), and in the Command Palette (plan §7.2.1, E56, D60).
    vscode.commands.registerCommand('prCascade.trackStack', () => trackStack(output, gitExtension, refresh)),
    // "Push Whole Stack" — in the view's `…` menu always, greyed out during a rebase through the
    // second key above, and in the Command Palette (plan §7.2.1, E12, E76, E83, D62).
    vscode.commands.registerCommand('prCascade.pushStack', () => pushStack(output, gitExtension, refresh)),
  );

  // With the Stack view hidden at startup — a collapsed Source Control pane — VS Code asks
  // for no rows, and the handshake with the Git extension starts only on the first load
  // (vscode/gitApi.ts), so nothing would ever reach the status bar (plan §13.4, D52). One
  // load now feeds it, in every window. Not guarded by `treeView.visible`: VS Code reports a
  // view's visibility to the extension host asynchronously, after `createTreeView` has
  // returned, so here it reads false whether or not the view is on screen. When the view is
  // showing, its own first render loads too — the one duplicate load per window D52
  // accepts. Deliberately not awaited, as in refresh() (primer §63).
  void provider.getChildren();

  output.appendLine('PR Cascade active');
  // The status bar wrapper, the view handle and the setup flow's seams exist only for the tests,
  // and this object is readable by every extension in the window — so they are handed out only
  // under the test harness (plan §13.4; primer §68): no other extension can put a fake runner
  // into ours. `{ provider, refresh }` is what plan §9.1 fixed, in every mode.
  // see primer §16 (object literals: shorthand keys) and §48 (the conditional expression)
  return context.extensionMode === vscode.ExtensionMode.Test ? { provider, refresh, statusBar, treeView, readinessDeps } : { provider, refresh };
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
 * The repositories the Git extension has open, in plan §6's order — by the workspace folder
 * each belongs to, then by path: what the tree lists, and what the setup command offers.
 * `rootUri.fsPath` is the repository root as a plain file-system path — the physical path, since
 * the Git extension gets it from `git rev-parse --show-toplevel`. The Git extension's own list is
 * in no stable order (vscode/gitApi.ts, sortRepositoryRoots); `workspaceFolders` is `undefined`
 * when no folder is open at all (an empty window), and a list otherwise; `?? []` makes both cases
 * a list.
 */
// see primer §25 (arrays: map) and §30 (`??`)
function repositoryRoots(api: GitApi): string[] {
  const roots = api.repositories.map((repository) => repository.rootUri.fsPath);
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folderPaths = folders.map((folder) => folder.uri.fsPath);
  return sortRepositoryRoots(roots, folderPaths);
}

/**
 * The whole read pipeline, run once per refresh: the repositories the Git extension has
 * open (plan §6, §7.14), then `loadRepoState` for each. One RepoState per repository, in the
 * order of plan §6 — by the workspace folder each belongs to, then by path. A failure anywhere
 * in here — git missing (E17), a command exiting non-zero, the Git extension unusable (E82) —
 * rejects, and the provider turns that into one row (vscode/tree.ts, topLevelNodes).
 */
// see primer §6 (async / await), §22 (for ... of) and §25 (arrays: push, a typed empty array)
async function loadRepoStates(output: vscode.OutputChannel, gitExtension: GitExtensionAdapter): Promise<RepoState[]> {
  const connected = await connectedGit(gitExtension);
  const states: RepoState[] = [];
  for (const root of repositoryRoots(connected.api)) {
    states.push(await loadRepoState(output, connected, root));
  }
  return states;
}

/**
 * One repository's pipeline, the core functions in the order the plan lays them out: trunk
 * (§5), stack (§5), then plan §7.8's local tier — `backend.enrich` (item 20a), which reads one
 * `for-each-ref` and runs `gs log` only when that text changed (§7.14.2) and only on a repository
 * git-spice has initialised, and never throws for anything git-spice can be in (its answer is
 * `state.enrichment`, logged below). Split out of loadRepoStates (item 20b) so Track Stack can
 * load one root afresh before it acts. A repository whose trunk cannot be found is kept, with
 * `trunk: null`, so the tree can say so (E4) rather than leave the repository out without a word.
 */
// see primer §54 (destructuring: the three fields of the connection)
async function loadRepoState(output: vscode.OutputChannel, connected: ConnectedGit, root: string): Promise<RepoState> {
  const { api, settings, git } = connected;
  const trunk = await detectTrunk(git, root, { configured: settings.trunk, remote: settings.remote });
  if (trunk === null) {
    output.appendLine(`${root}: no trunk found (set prCascade.trunk)`);
    // Nothing can be measured without a trunk, so no stack is computed, and neither HEAD
    // nor the rebase directories are looked up: `head: null` and `rebaseInProgress: false`
    // here are the "not computed" case core/model.ts names next to "detached" and
    // "paused", and nothing draws either while `trunk` is null — the tree shows only the
    // E4 message for this state. Nor is `enrich` asked: nothing to ask about.
    return { root, trunk: null, head: null, rebaseInProgress: false, layers: [] };
  }
  const state = await computeStack(git, root, trunk);
  // see primer §12 (template strings)
  output.appendLine(`${root}: ${state.layers.length} layer(s) above ${trunk}`);
  if (state.rebaseInProgress) {
    // Logged like the E4 line above: E4 and E12 are the view's two warning rows, states the
    // user must act on (D51). Its information rows — detached HEAD (E3), not on a stack
    // (E5) — get no line of their own.
    output.appendLine(`${root}: rebase in progress`);
  }
  const backend = backendFor(git, gitExecutable(settings.gitPath, api.git.path), settings.gsPath);
  const enriched = await backend.enrich(state);
  logEnrichment(output, enriched);
  return enriched;
}

/**
 * The Output lines for what `enrich` found (plan §7.8 as built): how many layers git-spice
 * tracks (its own trunk line counts — git-spice knows it), and whether `gs log` ran or the
 * §7.14.2 memo answered — the one place a user sees the pre-filter at work; one line per line
 * of the answer that could not be read, with the reminder that the layers such an answer does
 * not list are left unknown (E57); or why there is no information at all. Nothing when `enrich`
 * was not asked (no trunk, no layers). Core never logs; this is where its answer is written down.
 */
// see primer §59 (narrowing on `kind`), §25 (arrays: `filter`, `length`) and §48 (the conditional expression)
function logEnrichment(output: vscode.OutputChannel, state: RepoState): void {
  const enrichment = state.enrichment;
  if (enrichment === undefined) {
    return;
  }
  if (enrichment.kind === 'not-enriched') {
    output.appendLine(`${state.root}: no git-spice tracking info — ${enrichment.reason}`);
    return;
  }
  const known = state.layers.filter((layer) => layer.tracking !== null && layer.tracking !== undefined).length;
  const memo = enrichment.ranGsLog ? '' : ' (unchanged — gs log not run)';
  output.appendLine(`${state.root}: git-spice tracks ${known} of ${state.layers.length} layer(s)${memo}`);
  for (const bad of enrichment.malformed) {
    output.appendLine(`${state.root}: gs log line ${bad.line} skipped: ${bad.problem}`);
  }
  if (enrichment.malformed.length > 0) {
    output.appendLine(`${state.root}: layers it did not list are left unknown`);
  }
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

/**
 * The window's git-spice backend (core/backends/gitspice.ts), and what it was built from. Kept
 * between calls because it remembers `ready` answers — five programs per action saved — and
 * rebuilt, memo and all, when the git executable, `prCascade.gsPath` or (in a test) the command
 * runner changes (D56: "a changed setting means a new backend").
 */
// see primer §8 (undefined: nothing built yet)
let backend: { key: string; commands: CommandRunner; instance: GitSpiceBackend } | undefined;

/** The backend for this git and this setting — the one kept, or a new one when either, or the runner, changed. */
// see primer §44 (`\0` as a separator), §12 (template strings) and §70 (`?.`: none built yet reads
// `undefined`, which is never the key — and once that test is false, `backend` is there)
function backendFor(git: RealGitRunner, executable: string, gsPath: string): GitSpiceBackend {
  const key = `${executable}\0${gsPath}`;
  if (backend?.key !== key || backend.commands !== readinessDeps.commands) {
    backend = { key, commands: readinessDeps.commands, instance: new GitSpiceBackend(git, readinessDeps.commands, gsPath) };
  }
  return backend.instance;
}

/**
 * The readiness probe for one repository, as the setup flow asks it: through connectedGit on
 * every call, so `prCascade.gitPath` and `prCascade.gsPath` are read afresh for each question
 * (the remote and the trunk are fixed when the flow starts). With `fresh`, the remembered `ready`
 * is dropped first (`forget`): asked by hand, the user may just have logged out or re-initialised
 * in a terminal. M7's gated `createPRs` will pass false.
 */
// see primer §33 (a function that returns a function) and §6 (async / await)
function probeFor(gitExtension: GitExtensionAdapter, root: string, remote: string, fresh: boolean): () => Promise<Readiness> {
  return async () => {
    const { api, settings, git } = await connectedGit(gitExtension);
    const probing = backendFor(git, gitExecutable(settings.gitPath, api.git.path), settings.gsPath);
    if (fresh) {
      probing.forget(root, remote);
    }
    return probing.readiness(root, remote);
  };
}

/**
 * `prCascade.setUpGitSpice` — "PR Cascade: Set Up git-spice" (D58): the §7.13.1 offers for one
 * repository, one fix at a time, ending in the "ready" notification. The repository is the only
 * one, or the one picked (vscode/login.ts, `chooseRepository`); its trunk is asked of git the way
 * the tree asks it. Returns the flow's outcome — `executeCommand` resolves with it, which is what
 * lets test/ext/login.test.ts wait for the flow — or `undefined` when no repository was chosen.
 * A rejection (git could not run, E17) reaches VS Code, which shows it as an error.
 */
// see primer §6 (async / await), §8 (narrowing) and §73 (a notification with no buttons, not awaited)
async function setUpGitSpice(gitExtension: GitExtensionAdapter, flows: ReadinessFlows): Promise<ReadyOutcome | undefined> {
  const { api, settings, git } = await connectedGit(gitExtension);
  const root = await chooseRepository(repositoryRoots(api), readinessDeps.host);
  if (root === undefined) {
    return undefined;
  }
  const trunk = await detectTrunk(git, root, { configured: settings.trunk, remote: settings.remote });
  return flows.ensureReady({
    root,
    remote: settings.remote,
    trunk,
    gsPathSetting: settings.gsPath,
    probe: probeFor(gitExtension, root, settings.remote, true),
    git,
    action: async (ready) => {
      void readinessDeps.host.prompt('information', readyMessage(ready, root), []);
    },
  });
}

/**
 * What the last top-level load produced, kept from `onDidLoadStates` for Track Stack's and Push
 * Whole Stack's repository pick — one load, one truth, the same event the status bar follows
 * (D52). `[]` after a failed load (vscode/tree.ts fires it so), with no repository, or while the
 * first load is still in flight — never "all tracked".
 */
// see primer §4 (`let`: reassigned by the listener) and §14 (`readonly` on an array type)
let lastStates: readonly RepoState[] = [];

/**
 * The sentence for a command run while nothing is loaded — a failed load, no repository, or the
 * first load still in flight; the Refresh button is the action named, so a warning (D57). Shared
 * by Track Stack and Push Whole Stack.
 */
const NO_REPOSITORY_LOADED = 'The Stack view has no repository loaded — refresh it first.';

/**
 * The roots with a push in flight. Two `gs stack submit` at once in one repository race on the
 * remote's refs and on `.git/config` — one run leaves an upstream unset with a `WRN`, another
 * rejects a push `(failed to update ref)` (verified 0.31.2) — so a second click while one runs is
 * answered with a sentence, not run (item 21b). Cleared in `pushStack`'s `finally`, whatever
 * happened.
 */
// see primer §21 (Set: membership, `add`, `delete`)
const pushing = new Set<string>();

/**
 * Whether a state has a layer git-spice does not track — what shows "Track Stack with git-spice"
 * and what it offers. A layer with no `tracking` at all (not enriched, or unlisted by an answer
 * with a malformed line) does not count: unknown is not untracked (core/model.ts).
 */
// see primer §25 (arrays: `some`)
function hasUntracked(state: RepoState): boolean {
  return state.layers.some((layer) => layer.tracking === null);
}

/**
 * The sentence for a repository `enrich` could not serve — `No git-spice tracking info for
 * <folder> — <reason>.` — with ` Run PR Cascade: Set Up git-spice.` appended, as a warning,
 * when the setup flow would fix the cause (not initialised, git-spice missing or too old; a
 * command is named, so a warning — D57's rule), and as information with no hint when `gs log`
 * itself failed: the flow would report ready and fix nothing, and the Output channel has the
 * line. The reason is core's phrase (core/backends/gitspice.ts), embedded.
 */
// see primer §10 (a union of two exact strings as a field's type) and §45 (narrowing an exact-string union with `===`)
function notEnrichedMessage(folder: string, cause: EnrichmentCause, reason: string): { severity: 'warning' | 'information'; message: string } {
  const sentence = `No git-spice tracking info for ${folder} — ${reason}.`;
  if (cause === 'gs-log-failed') {
    return { severity: 'information', message: sentence };
  }
  return { severity: 'warning', message: `${sentence} Run PR Cascade: Set Up git-spice.` };
}

/** `1 branch`, `3 branches`: what Track Stack says it tracked, and Push Whole Stack what it pushed. */
function branchesLabel(count: number): string {
  if (count === 1) {
    return '1 branch';
  }
  return `${count} branches`;
}

/**
 * `prCascade.trackStack` — "Track Stack with git-spice" (plan §7.2.1, E56, D60): the repository
 * from the last load's untracked layers (picked when several), re-loaded fresh, refused with a
 * sentence during a paused rebase (E12), its `null` layers tracked bottom to top
 * (core/backends/gitspice.ts `track`), exactly one refresh once a repository was chosen (E83 —
 * success, failure or refusal alike, in the `finally`), one sentence. Not gated on the readiness
 * flow (D60): a local operation that needs neither forge nor login, which the flow could never
 * pass for a forge-less repository (E21). Returns the result — `executeCommand` resolves with it,
 * which is what lets test/ext/commands.test.ts wait for it: `track`'s own answer, or `{ tracked:
 * [], problem: null }` when the fresh load had no layers or no untracked one; `undefined` when
 * nothing was loaded, no repository was a candidate, the pick was escaped, a rebase is paused or
 * the fresh load was not enriched. A rejection (git could not run, E17) reaches VS Code, which
 * shows it as an error; the refresh still runs.
 */
// see primer §6 (async / await) and §18 (try / finally: the refresh whatever happened)
async function trackStack(output: vscode.OutputChannel, gitExtension: GitExtensionAdapter, refresh: () => void): Promise<TrackResult | undefined> {
  const host = readinessDeps.host;
  const candidates = untrackedRepositories(host);
  if (candidates.length === 0) {
    return undefined;
  }
  const root = await chooseRepository(candidates, host, 'Track the stack of which repository with git-spice?');
  if (root === undefined) {
    return undefined;
  }
  try {
    return await trackIn(output, gitExtension, root);
  } finally {
    refresh();
  }
}

/**
 * The roots of the last load's repositories with an untracked layer — Track Stack's candidates —
 * or `[]` after saying why there are none, in this order: nothing loaded (a failed load, no
 * repository, or the first load still in flight; the Refresh button is the action named, so a
 * warning — D57), no layers anywhere (E4, E5), a repository `enrich` could not serve (its reason,
 * and the setup command where that would help), or every layer tracked already. No refresh in
 * any of these: nothing of ours ran.
 */
// see primer §25 (arrays: `every`, `filter`, `map`), §22 (for ... of), §70 (`?.` on a field that may be absent) and
// §54 (destructuring the message's two fields)
function untrackedRepositories(host: ReadinessHost): string[] {
  if (lastStates.length === 0) {
    void host.prompt('warning', NO_REPOSITORY_LOADED, []);
    return [];
  }
  if (lastStates.every((state) => state.layers.length === 0)) {
    void host.prompt('information', 'Nothing to track — the Stack view shows no layers.', []);
    return [];
  }
  const candidates = lastStates.filter(hasUntracked);
  if (candidates.length > 0) {
    return candidates.map((state) => state.root);
  }
  for (const state of lastStates) {
    const enrichment = state.enrichment;
    if (enrichment?.kind === 'not-enriched') {
      const { severity, message } = notEnrichedMessage(path.basename(state.root), enrichment.cause, enrichment.reason);
      void host.prompt(severity, message, []);
      return [];
    }
  }
  void host.prompt('information', 'Every layer in the Stack view is already tracked by git-spice.', []);
  return [];
}

/**
 * Track Stack's action for one chosen repository, loaded afresh first and never from the last
 * load: a `gs branch track` typed in a terminal is seen by no watcher (E83), so the last load
 * may show `not tracked` for a branch already tracked, and re-tracking it would silently move
 * its base. Then, in order: a paused rebase is refused with the view's own sentence (E12 —
 * git-spice would not refuse, verified 0.31.2; the greyed-out menu entry is `enablement`, item 21b);
 * no layers → nothing to track (the one state with no `enrichment`, so its reason is never
 * read); not enriched → its sentence; every layer tracked → a sentence; else `track`, with the
 * trunk's local branch asked of git the way the setup flow asks it (`trunkBranchFor`, item
 * 19a), and one sentence from the result — core's own, as a warning, when it stopped short.
 */
// see primer §70 (`?.` on `enrichment`, absent only on the no-layers path above) and §28 (`basename`)
async function trackIn(output: vscode.OutputChannel, gitExtension: GitExtensionAdapter, root: string): Promise<TrackResult | undefined> {
  const host = readinessDeps.host;
  const folder = path.basename(root);
  const connected = await connectedGit(gitExtension);
  const fresh = await loadRepoState(output, connected, root);
  if (fresh.rebaseInProgress) {
    void host.prompt('warning', `Rebase in progress in ${folder} — resolve it first.`, []);
    return undefined;
  }
  if (fresh.layers.length === 0) {
    void host.prompt('information', `Not on a stack in ${folder} — nothing to track.`, []);
    return { tracked: [], problem: null };
  }
  if (fresh.enrichment?.kind === 'not-enriched') {
    const { severity, message } = notEnrichedMessage(folder, fresh.enrichment.cause, fresh.enrichment.reason);
    void host.prompt(severity, message, []);
    return undefined;
  }
  if (!hasUntracked(fresh)) {
    void host.prompt('information', `Every layer in ${folder} is already tracked by git-spice.`, []);
    return { tracked: [], problem: null };
  }
  const { api, settings, git } = connected;
  const backend = backendFor(git, gitExecutable(settings.gitPath, api.git.path), settings.gsPath);
  const result = await backend.track(root, fresh.layers, await trunkBranchFor(git, root, fresh.trunk));
  if (result.problem !== null) {
    void host.prompt('warning', result.problem, []);
  } else {
    void host.prompt('information', `Tracked ${branchesLabel(result.tracked.length)} with git-spice in ${folder}.`, []);
  }
  return result;
}

/**
 * `prCascade.pushStack` — "Push Whole Stack" (plan §7.2.1, E12, E76, E83, D62): the stack of one
 * repository from the last load (picked when several), re-loaded fresh, its untracked layers
 * tracked first (§7.7's preflight, E56), then `gs stack submit --no-publish` through the backend
 * (core/backends/gitspice.ts `push`, which refuses first what must not be pushed), exactly one
 * refresh per push begun (E83 — success, failure or refusal alike, in the `finally`; the in-flight
 * guard's sentence refreshes nothing, since nothing of ours ran — the running push's `finally` will),
 * one sentence. Not gated on the readiness flow (D62): `--no-publish` needs neither forge nor
 * login — verified — so the flow would refuse pushes that work; where the setup flow would help
 * (not initialised, git-spice missing or too old), the sentence names it. Returns the result —
 * `executeCommand` resolves with it, which is what lets test/ext/commands.test.ts wait for it:
 * `push`'s own answer, or `{ pushed: [], notes: [], problem: null }` when the fresh load had no
 * layers; `undefined` when nothing was loaded, no repository had layers, the pick was escaped, a
 * push is already running here, a rebase is paused, HEAD is detached, the fresh load was not
 * enriched, or tracking first failed. A rejection (git could not run, E17) reaches VS Code, which
 * shows it as an error; the refresh still runs and the guard is released.
 */
// see primer §6 (async / await), §18 (try / finally: the refresh and the guard's release, whatever happened) and §21 (Set)
async function pushStack(output: vscode.OutputChannel, gitExtension: GitExtensionAdapter, refresh: () => void): Promise<PushResult | undefined> {
  const host = readinessDeps.host;
  const candidates = stackedRepositories(host);
  if (candidates.length === 0) {
    return undefined;
  }
  const root = await chooseRepository(candidates, host, 'Push the stack of which repository with git-spice?');
  if (root === undefined) {
    return undefined;
  }
  if (pushing.has(root)) {
    void host.prompt('information', `Already pushing the stack in ${path.basename(root)}.`, []);
    return undefined;
  }
  pushing.add(root);
  try {
    return await pushIn(output, gitExtension, root);
  } finally {
    pushing.delete(root);
    refresh();
  }
}

/**
 * The roots of the last load's repositories with layers — Push Whole Stack's candidates — or `[]`
 * after saying why there are none: nothing loaded (the shared warning), or no layers anywhere
 * (E4, E5; information). No refresh in either: nothing of ours ran. Unlike Track Stack's
 * candidates, a repository `enrich` could not serve is still one — `pushIn` says what is missing
 * after the fresh load, so the user hears the setup command named for the repository they chose.
 */
// see primer §25 (arrays: `filter`, `map`)
function stackedRepositories(host: ReadinessHost): string[] {
  if (lastStates.length === 0) {
    void host.prompt('warning', NO_REPOSITORY_LOADED, []);
    return [];
  }
  const withLayers = lastStates.filter((state) => state.layers.length > 0);
  if (withLayers.length === 0) {
    void host.prompt('information', 'Nothing to push — the Stack view shows no layers.', []);
    return [];
  }
  return withLayers.map((state) => state.root);
}

/**
 * Push Whole Stack's action for one chosen repository, loaded afresh first and never from the last
 * load (E83's reason: a `gs branch track`, a fetch or a rebase since then is seen by no watcher —
 * and `push`'s own refusals read the fresh load's `gs log` lines). Then, in order: a paused rebase
 * is refused with the view's own sentence (E12; `enablement` greys the entry too, but it does not
 * stop `executeCommand`); no layers → nothing to push (the one state with no `enrichment`); a
 * detached HEAD → `stack submit` acts on HEAD's branch, and git-spice would only say `in detached
 * HEAD state` (E3); not enriched → its sentence, the setup command named where it would help; then
 * the `null` layers tracked first (§7.7's preflight — an untracked layer between tracked ones
 * git-spice skips silently, an untracked HEAD it refuses; a `track` problem ends it, pushing
 * nothing); then `push`, and `reportPush` says how it went.
 */
// see primer §70 (`?.` on `enrichment`, absent only on the no-layers path above) and §28 (`basename`)
async function pushIn(output: vscode.OutputChannel, gitExtension: GitExtensionAdapter, root: string): Promise<PushResult | undefined> {
  const host = readinessDeps.host;
  const folder = path.basename(root);
  const connected = await connectedGit(gitExtension);
  const fresh = await loadRepoState(output, connected, root);
  if (fresh.rebaseInProgress) {
    void host.prompt('warning', `Rebase in progress in ${folder} — resolve it first.`, []);
    return undefined;
  }
  if (fresh.layers.length === 0) {
    void host.prompt('information', `Not on a stack in ${folder} — nothing to push.`, []);
    return { pushed: [], notes: [], problem: null };
  }
  if (fresh.head === null) {
    void host.prompt('warning', `Detached HEAD in ${folder} — check out a branch of the stack first.`, []);
    return undefined;
  }
  if (fresh.enrichment?.kind === 'not-enriched') {
    const { severity, message } = notEnrichedMessage(folder, fresh.enrichment.cause, fresh.enrichment.reason);
    void host.prompt(severity, message, []);
    return undefined;
  }
  const { api, settings, git } = connected;
  const backend = backendFor(git, gitExecutable(settings.gitPath, api.git.path), settings.gsPath);
  if (hasUntracked(fresh)) {
    const tracked = await backend.track(root, fresh.layers, await trunkBranchFor(git, root, fresh.trunk));
    if (tracked.problem !== null) {
      void host.prompt('warning', tracked.problem, []);
      return undefined;
    }
    output.appendLine(`${root}: tracked ${tracked.tracked.join(', ')} before pushing`);
  }
  const result = await backend.push(root, fresh.layers);
  reportPush(output, host, root, folder, result);
  return result;
}

/**
 * What the user hears and the Output panel keeps after `push`: every line git-spice said beside
 * `Pushed` (a `<name>-2` rename, a `WRN`, the `ERR` remedy of a partial push — `notes`), one line
 * naming the branches pushed (on a failure too: a partial push moved them), then core's `problem`
 * as a warning, or the success sentence — with a tail pointing at the Output panel when git-spice
 * said more than `Pushed`, the one honest way to surface a rename it reports with exit 0.
 */
// see primer §22 (for ... of), §48 (the conditional expression) and §12 (template strings)
function reportPush(output: vscode.OutputChannel, host: ReadinessHost, root: string, folder: string, result: PushResult): void {
  for (const line of result.notes) {
    output.appendLine(`${root}: git-spice: ${line}`);
  }
  if (result.pushed.length > 0) {
    output.appendLine(`${root}: pushed ${result.pushed.join(', ')}`);
  }
  if (result.problem !== null) {
    void host.prompt('warning', result.problem, []);
    return;
  }
  const tail = result.notes.length > 0 ? ' — git-spice also left notes in the Output panel' : '';
  void host.prompt('information', `Pushed ${branchesLabel(result.pushed.length)} with git-spice in ${folder}${tail}.`, []);
}
