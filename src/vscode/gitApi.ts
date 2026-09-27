/**
 * vscode/gitApi.ts — the extension's connection to VS Code's built-in Git extension: the
 * one place that asks it for its API, waits until it has found the repositories in the
 * window, and passes on the three things this extension takes from it (plan §7.14) — the
 * repository list, the "a repository opened / closed" events, and the git executable it
 * found. Everything else the extension knows about a repository still comes from its own
 * git commands (plan §5).
 *
 * Layer: vscode adapter (plan §4.1). Depends on: the `vscode` module, Node's `node:path`,
 * and vscode/git.d.ts — the Git extension's public types, copied verbatim from VS Code
 * 1.85 (the oldest VS Code this extension supports) so the compiler refuses anything a
 * newer Git extension added. Depended on by: src/extension.ts (one adapter per window,
 * handed the real host; roots and the git path read from it on every refresh),
 * vscode/tree.ts (GitUnavailableError → a warning row), test/ext/gitApi.test.ts, and the
 * ext-test helper test/ext/helpers/gitApi.ts (so test/ext-parent/parentFolder.test.ts).
 * Plan: §7.14, §6, §7.3 `prCascade.gitPath`, §8 E82, §10.1 item 12a.
 */

// see primer §1 (import / export), §2 (the vscode module) and §9 (`import type`); the
// `./git` import is primer §60's: types from a `.d.ts` file, which has no code behind it.
// A plain import of names used only as types would compile and bundle too (tsc drops such
// an import, and so does esbuild), so `import type` here is the plan's rule (§7.14.1), not
// a necessity: it turns a slip into a *value* use of that file — `RefType.Tag`, a
// `const enum` — into a compile error instead of a bundle-time failure
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { API, GitExtension } from './git';

/**
 * The part of the Git extension's API this extension reads — and, by being a type of its
 * own, the whole of it: `Pick` (primer §49) names four members and the two events are
 * declared beside them, and nothing else on the real object is reachable through this
 * type, so a stand-in for tests has six things to provide, not the eighteen of the real
 * `API` — nor a `Repository` per event, see below. `state` says
 * whether the Git extension has finished its first look through the workspace;
 * `repositories` are the repositories it has open right now; the two events say when that
 * list changes; `git.path` is the executable it found.
 *
 * The events are typed `Event<unknown>` rather than the `Event<Repository>` git.d.ts
 * declares: this file never reads the repository an event carries — the list is re-read
 * whole — and the looser type is what lets a test fire the event without building a whole
 * `Repository`. The real API still fits: an event that hands out a `Repository` is an
 * event that hands out *something*.
 */
// see primer §49 (`Pick<T, K>`) and §9 (`extends` on an interface)
export interface GitApi extends Pick<API, 'state' | 'onDidChangeState' | 'git' | 'repositories'> {
  readonly onDidOpenRepository: vscode.Event<unknown>;
  readonly onDidCloseRepository: vscode.Event<unknown>;
}

/**
 * What the Git extension hands out when it is activated (primer §60): a flag saying
 * whether it has a working git behind it, an event for when that flag turns on, and
 * `getAPI(1)`, which throws while the flag is off. Declared here rather than used as the
 * `GitExtension` type from git.d.ts so that `getAPI` promises only the `GitApi` slice above
 * — the real object satisfies this shape, and so does a test's stand-in.
 */
// see primer §9 (interface, and `extends` on an interface)
export interface GitExtensionExports extends Pick<GitExtension, 'enabled' | 'onDidChangeEnablement'> {
  getAPI(version: 1): GitApi;
}

/**
 * What `vscode.extensions.getExtension('vscode.git')` returns, reduced to the one thing
 * this file does with it: `activate()`, which starts the Git extension if it is not
 * running yet and resolves with its exports (primer §60). `Thenable` is VS Code's word
 * for "a Promise, or something that can be awaited like one".
 */
export interface GitExtensionHandle {
  activate(): Thenable<GitExtensionExports>;
}

/**
 * The three places the adapter touches VS Code itself, as one object it is handed. There
 * is one real implementation (below) and the tests build their own — that is the whole
 * reason for the indirection: the E82 rows describe a Git extension that is disabled,
 * failed, or without git, and none of those can be arranged in the test VS Code, where
 * the real Git extension is present and working (plan §7.14.1).
 */
export interface GitExtensionHost {
  /**
   * `getExtension('vscode.git')`: the handle when the Git extension is enabled, `undefined`
   * when the user has disabled it. Called again on every reconnect, so a Git extension the
   * user turns back on is found.
   */
  lookUp(): GitExtensionHandle | undefined;
  /** `vscode.extensions.onDidChange`: fires when any extension is installed, uninstalled, enabled or disabled. */
  readonly onDidChangeExtensions: vscode.Event<void>;
  /**
   * The `git.enabled` setting as the Git extension itself reads it when it starts —
   * window-level, `getConfiguration('git', null)`: the `null` means "no particular folder",
   * so a folder that switched git off for itself alone does not count (plan §7.14.3 row 3).
   */
  isGitEnabledInSettings(): boolean;
}

/** The real thing: what src/extension.ts hands its adapter. */
// see primer §36 (export const: a shared constant object) and §31 (a type argument on a call)
export const realGitExtensionHost: GitExtensionHost = {
  lookUp: () => vscode.extensions.getExtension<GitExtension>('vscode.git'),
  onDidChangeExtensions: vscode.extensions.onDidChange,
  isGitEnabledInSettings: () => vscode.workspace.getConfiguration('git', null).get<boolean>('enabled', true),
};

/**
 * What the handshake ends in: the Git extension's API, ready to be read, or one sentence
 * saying why it is not — the row the view shows in place of the stack (E82). A union of
 * two object shapes told apart by their `kind` field (primer §59): code that holds a
 * GitConnection checks `kind` and the compiler then knows which other field exists.
 */
// see primer §59 (tagged unions: object shapes told apart by a `kind` field)
export type GitConnection =
  | { readonly kind: 'ready'; readonly api: GitApi }
  | { readonly kind: 'unavailable'; readonly message: string };

/**
 * The error src/extension.ts throws from its loaders when the connection is unavailable,
 * so that the tree (vscode/tree.ts) can tell "the Git extension cannot be used" — a state
 * the user can change, drawn as a warning — from "a git command failed" (E17, an error).
 * The message is the E82 row text (plan §7.14.3).
 */
// see primer §13 (class, extends and constructor)
export class GitUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitUnavailableError';
  }
}

// The four E82 rows, word for word from plan §7.14.3. The tests assert these exact strings
// without importing them — the text is the behaviour, so a wrong word must fail a test.
const GIT_EXTENSION_DISABLED = 'PR Cascade needs the built-in Git extension — enable it in the Extensions view';
const GIT_EXTENSION_FAILED = 'The Git extension failed to start — reload the window';
const GIT_DISABLED_IN_SETTINGS = 'Git is disabled in this workspace (git.enabled)';
const GIT_NOT_FOUND = 'The Git extension found no git — set git.path, then reload the window';

/**
 * Which git the extension spawns (plan §7.3 `prCascade.gitPath`): the setting when the
 * user set one, else the executable the Git extension found — `api.git.path`, which
 * honours the user's `git.path` — so both extensions run the same git and agree on what
 * a repository is. A pure function so a test can check both branches without a runner
 * to look inside; src/extension.ts calls it every time it builds a RealGitRunner.
 */
// see primer §48 (the conditional expression)
export function gitExecutable(setting: string, apiPath: string): string {
  return setting === '' ? apiPath : setting;
}

/**
 * The order repositories appear in the view (plan §6): by the workspace folder each root
 * belongs to — the first folder that is the root, is below it, or is above it — and, for
 * roots that share a folder, by path. A root that belongs to no folder goes last: the Git
 * extension keeps a repository open after its folder is removed while an editor in it is
 * still visible, and can open one for a visible editor in an empty window, so the case
 * exists and the rule has to place it rather than leave the comparison to chance.
 *
 * Why sort at all: the Git extension's own list is in no useful order — it re-sorts the
 * array internally on every lookup, longest root first — and a view whose repositories
 * changed places between refreshes would be a bug report.
 *
 * Paths are compared as strings, so a folder opened through a symlink (`/tmp` for
 * `/private/tmp` on macOS) does not match the physical root the Git extension reports for
 * it, and that repository sorts as belonging to no folder — last, still shown. Accepted:
 * the view is right, only the order is not, and the case needs a symlinked workspace.
 */
// see primer §25 (arrays: map) and §26 (sort and comparison functions)
export function sortRepositoryRoots(roots: readonly string[], folderPaths: readonly string[]): string[] {
  // Pair every root with the index of its folder once, so the comparison below is two
  // numbers and two strings rather than a search per comparison.
  const keyed = roots.map((root) => ({ root, folderIndex: folderIndexFor(root, folderPaths) }));
  keyed.sort((first, second) => {
    if (first.folderIndex !== second.folderIndex) {
      return first.folderIndex - second.folderIndex;
    }
    return compareByCharacterCode(first.root, second.root);
  });
  return keyed.map((entry) => entry.root);
}

/**
 * The lowest index of a workspace folder that is `root`, lies below it, or lies above it;
 * `folderPaths.length` — one past the last real index — when there is none, so such a
 * root sorts after every root that has a folder.
 */
// see primer §29 (counted for loops)
function folderIndexFor(root: string, folderPaths: readonly string[]): number {
  for (let index = 0; index < folderPaths.length; index++) {
    const folder = folderPaths[index];
    if (isEqualOrBelow(root, folder) || isEqualOrBelow(folder, root)) {
      return index;
    }
  }
  return folderPaths.length;
}

/**
 * Whether `candidate` is `ancestor` itself or a path inside it. The separator is put on
 * the end of `ancestor` before the prefix test so that `/w/repo2` does not count as being
 * below `/w/repo` — a plain `startsWith` would say it is.
 */
// see primer §23 (string methods: endsWith, startsWith) and §28 (`path.sep`: the
// platform's separator, `/` here and `\` on Windows)
function isEqualOrBelow(candidate: string, ancestor: string): boolean {
  if (candidate === ancestor) {
    return true;
  }
  const prefix = ancestor.endsWith(path.sep) ? ancestor : ancestor + path.sep;
  return candidate.startsWith(prefix);
}

/** Orders two paths by their character codes — the same plain, machine-independent order core/stack.ts uses for branch names. */
function compareByCharacterCode(first: string, second: string): number {
  if (first < second) {
    return -1;
  }
  if (first > second) {
    return 1;
  }
  return 0;
}

/**
 * The connection to the Git extension, kept for the life of the window. It runs the
 * handshake of plan §7.14.1 once, memoises the outcome, and runs it again on the two
 * events that can turn an unusable Git extension into a usable one: `git.enabled` turned
 * on (the Git extension's own `onDidChangeEnablement`) and the Git extension itself
 * enabled again in the Extensions view (`vscode.extensions.onDidChange`; VS Code starts a
 * re-enabled extension in place, without a reload — plan §7.14.3 row 1). It fires
 * `onDidChange` — "the view should refresh" — whenever the Git extension opens or closes
 * a repository, and after every reconnect.
 *
 * `connection()` is a Promise and stays one: src/extension.ts awaits it at the start of
 * every refresh, which costs nothing once it has settled and, before it settles, is what
 * makes the first refresh wait for the Git extension's initial scan instead of showing
 * "no repository" for a moment.
 */
// see primer §13 (class, extends and constructor: `implements`), §32 (EventEmitter and
// Event), §47 (parameter properties) and §7 (Promise: one kept and awaited many times)
export class GitExtensionAdapter implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires when the repository list or the Git extension's usability changed: the extension refreshes the view on it. */
  readonly onDidChange: vscode.Event<void>;

  /**
   * The handshake in flight or finished. Replaced whole on a reconnect, so a caller
   * holding the old Promise still gets the old answer and the next `connection()` call
   * gets the new one.
   */
  private current: Promise<GitConnection>;
  /** What the newest handshake ended in, for the extensions listener to look at without awaiting. */
  private latest: GitConnection | undefined;
  /**
   * Counts the handshakes started, and numbers each: a handshake waits twice — for
   * `activate()`, then for the initial scan — and a recovery event during either wait
   * starts a newer one. The older one finds out by comparing its number with this count
   * (`isStale`) and then leaves no trace: no listeners, no log lines, no `latest`.
   */
  private generation = 0;
  /**
   * Listeners tied to one handshake's outcome (open/close, enablement): dropped on every
   * reconnect and on dispose. A handshake that finishes after either adds none (`keep`).
   */
  private connectionSubscriptions: vscode.Disposable[] = [];
  private readonly extensionsSubscription: vscode.Disposable;
  private disposed = false;

  constructor(
    /** The three seams into VS Code (see GitExtensionHost); the real one, or a test's. */
    private readonly host: GitExtensionHost,
    /** The "PR Cascade" entry of the Output panel: what the handshake found is written there. */
    private readonly output: vscode.OutputChannel,
  ) {
    this.onDidChange = this.changeEmitter.event;
    // Fires for every extension that changes state, ours included. Only an unusable Git
    // extension can be helped by it — the user just enabled it (row 1); for the other rows
    // the re-check is harmless and ends in the same row — so a ready connection is left
    // alone, and so is the first handshake while it is in flight (`latest` is undefined
    // until it settles). A *reconnect* in flight is not shielded that way: the event starts
    // another handshake, and `generation` makes the overtaken one inert.
    this.extensionsSubscription = host.onDidChangeExtensions(() => {
      if (this.latest !== undefined && this.latest.kind === 'unavailable') {
        this.reconnect();
      }
    });
    this.current = this.beginHandshake();
  }

  /** The outcome of the handshake — the API, or the E82 row — once it is known. Never rejects. */
  connection(): Promise<GitConnection> {
    return this.current;
  }

  /** Called by VS Code on shutdown, through context.subscriptions (src/extension.ts). */
  dispose(): void {
    this.disposed = true;
    this.extensionsSubscription.dispose();
    this.dropConnectionSubscriptions();
    this.changeEmitter.dispose();
  }

  /**
   * Starts a handshake, numbered, and returns its Promise, which the caller stores as
   * `current`. Its answer becomes `latest` only if it is still the newest handshake when
   * it settles — two recovery events in quick succession start two handshakes, and only
   * the last one's answer may stand.
   */
  private beginHandshake(): Promise<GitConnection> {
    this.generation += 1;
    const generation = this.generation;
    const run = this.handshake(generation);
    // Not awaited: the constructor and reconnect() must return at once. `.then` queues
    // what should happen once the handshake settles (primer §63).
    run.then((connection) => {
      if (!this.isStale(generation)) {
        this.latest = connection;
      }
    });
    return run;
  }

  /** A fresh handshake, then a refresh — whatever it finds, the view has something new to show. */
  private reconnect(): void {
    if (this.disposed) {
      return;
    }
    this.dropConnectionSubscriptions();
    this.current = this.beginHandshake();
    const generation = this.generation;
    // see primer §63 (`.then`)
    this.current.then(() => {
      if (!this.isStale(generation)) {
        this.changeEmitter.fire();
      }
    });
  }

  /** Whether handshake number `generation` has been overtaken — by a newer handshake, or by dispose(). */
  private isStale(generation: number): boolean {
    return this.disposed || generation !== this.generation;
  }

  /**
   * Adds listeners that belong to handshake `generation` — or, if that handshake is
   * stale, disposes them at once: a handshake overtaken while it waited must not leave a
   * second set of listeners behind (two refreshes per event, for the life of the window).
   */
  private keep(generation: number, subscriptions: vscode.Disposable[]): void {
    if (this.isStale(generation)) {
      for (const subscription of subscriptions) {
        subscription.dispose();
      }
      return;
    }
    for (const subscription of subscriptions) {
      this.connectionSubscriptions.push(subscription);
    }
  }

  /**
   * Writes a line to the Output panel on behalf of handshake `generation` — unless that
   * handshake is stale. The overtaken case is only tidiness; the disposed case matters:
   * VS Code disposes context.subscriptions in the order they were pushed, the channel
   * before this adapter (src/extension.ts), and `appendLine` on a disposed channel throws,
   * which would turn a handshake still in flight at shutdown into a rejected Promise.
   */
  private log(generation: number, line: string): void {
    if (!this.isStale(generation)) {
      this.output.appendLine(line);
    }
  }

  private dropConnectionSubscriptions(): void {
    for (const subscription of this.connectionSubscriptions) {
      subscription.dispose();
    }
    this.connectionSubscriptions = [];
  }

  /**
   * Plan §7.14.1, line by line. Each way out is one E82 row (plan §7.14.3), never a
   * rejection: the view shows a row, the Output panel gets the detail. `generation` is
   * this handshake's number, for `keep` and `log` (see `isStale`).
   */
  // see primer §6 (async / await) and §18 (try / catch and unknown)
  private async handshake(generation: number): Promise<GitConnection> {
    const handle = this.host.lookUp();
    if (handle === undefined) {
      // Row 1. Recovery is the extensions event the constructor subscribed to.
      return this.unavailable(generation, GIT_EXTENSION_DISABLED);
    }

    // see primer §4 (`let` with a type and no value yet: assigned inside the try, read after it)
    let extensionExports: GitExtensionExports;
    try {
      // Resolves at once when the Git extension is already running — which it normally
      // is: its activation event is `*`, VS Code starts it with every window.
      extensionExports = await handle.activate();
    } catch (error) {
      // Row 2: the Git extension rethrows anything but "git not found" out of its own
      // start-up, and VS Code then hands that rejection to whoever called activate().
      this.log(generation, `the Git extension failed to activate: ${describeError(error)}`);
      return this.unavailable(generation, GIT_EXTENSION_FAILED);
    }

    if (extensionExports.enabled === false) {
      // Rows 3 and 4 look the same through the API — no model, `enabled` false, `getAPI`
      // would throw — and differ in the setting: git switched off in settings (row 3), or
      // the Git extension found no git binary (row 4). Only row 3 recovers by itself: the
      // Git extension fires `onDidChangeEnablement(true)` when the setting is turned on
      // (once; the reverse flip is not reported). The reconnect runs one tick later
      // because at VS Code 1.138 that event fires one statement before `getAPI` can
      // succeed, so a call made inside the handler would throw (plan §13.4 (g)).
      // see primer §58 (setTimeout)
      this.keep(generation, [
        extensionExports.onDidChangeEnablement((enabled) => {
          if (enabled) {
            setTimeout(() => this.reconnect(), 0);
          }
        }),
      ]);
      if (this.host.isGitEnabledInSettings()) {
        return this.unavailable(generation, GIT_NOT_FOUND);
      }
      return this.unavailable(generation, GIT_DISABLED_IN_SETTINGS);
    }

    let api: GitApi;
    try {
      api = extensionExports.getAPI(1);
    } catch (error) {
      // `enabled` said yes and the API still would not come: after the one-tick retry
      // above there is nothing left to wait for, so this is row 2, not a retry loop.
      this.log(generation, `the Git extension refused to hand over its API: ${describeError(error)}`);
      return this.unavailable(generation, GIT_EXTENSION_FAILED);
    }

    if (api.state !== 'initialized') {
      // The Git extension is still looking through the workspace folders for repositories;
      // `repositories` would be incomplete. `initialized` means that first look has
      // settled — not that any repository's first `git status` has run, which this
      // extension never waits for (it reads nothing from a repository's state).
      await whenInitialized(api);
    }

    // The two events that change the repository list: a repository the Git extension
    // opened later (a folder added, a submodule, a prompt answered) or closed (a folder
    // removed, "Close Repository" in Source Control). Either way the view redraws.
    this.keep(generation, [
      api.onDidOpenRepository(() => this.changeEmitter.fire()),
      api.onDidCloseRepository(() => this.changeEmitter.fire()),
    ]);
    // see primer §12 (template strings)
    this.log(generation, `connected to the Git extension: ${api.repositories.length} repository(ies) open, git at ${api.git.path}`);
    return { kind: 'ready', api };
  }

  /** One E82 row: logged (unless this handshake is stale), and returned as the connection's outcome. */
  private unavailable(generation: number, message: string): GitConnection {
    this.log(generation, `Git extension unavailable: ${message}`);
    return { kind: 'unavailable', message };
  }
}

/**
 * Resolves when the Git extension reports `initialized` — its first look through the
 * workspace is done. The one listener not kept in `connectionSubscriptions`: it removes
 * itself when it fires, and the handshake waiting on it re-checks `isStale` afterwards
 * (through `keep` and `log`), so a wait that outlives a reconnect or dispose() ends quietly.
 */
// see primer §15 (new Promise) and §42 (waiting for an event with new Promise)
function whenInitialized(api: GitApi): Promise<void> {
  return new Promise((resolve) => {
    const subscription = api.onDidChangeState((state) => {
      if (state === 'initialized') {
        subscription.dispose();
        resolve();
      }
    });
  });
}

/** The message of a caught value, which in a `catch` is `unknown` and need not be an Error at all. */
// see primer §18 (try / catch and unknown)
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'an error that is not an Error object';
}
