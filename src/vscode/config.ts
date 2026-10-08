/**
 * vscode/config.ts — reads the extension's settings (`prCascade.*`) out of VS Code and hands
 * them over as plain values.
 *
 * Layer: vscode adapter (plan §4.1): the one place that knows settings live in VS Code's
 * configuration API. The core modules never see it — detectTrunk (core/trunk.ts) takes a
 * TrunkOptions object of plain strings, and this file is what builds it. Depends on: the
 * `vscode` module. Depended on by: src/extension.ts, on every refresh and every click.
 * The settings and their defaults are declared in package.json "contributes.configuration".
 * Plan: §7.3, §7.14.1 (`gitPath`), §7.13.1 (`gsPath`, M5 item 19b), §13.4.
 */

// see primer §1 (import / export) and §2 (the vscode module)
import * as vscode from 'vscode';

/**
 * The five settings the extension reads, as plain values — no VS Code types, so a test can build
 * one by hand and core code can take it without importing `vscode`. Each field's doc says
 * what the setting means; package.json "contributes.configuration" is what the user sees
 * in the Settings editor, and the two must agree. (M1 also read two repository-scan
 * settings here; they went with the scan itself in M4, when the built-in Git extension
 * became the source of repositories — plan §7.14.)
 */
// see primer §9 (interface)
export interface PrCascadeSettings {
  /** `prCascade.trunk`: the ref to measure the stack against, or `''` for auto-detection (core/trunk.ts). */
  trunk: string;
  /**
   * `prCascade.gitPath`: the git executable, or `''` — the default — for the one the built-in
   * Git extension found (vscode/gitApi.ts, `gitExecutable`: `api.git.path`, which honours
   * the user's `git.path`). A full path when git is somewhere unusual, and a wrong one is
   * E17. Passed on exactly as read: the empty string is a value here, not an accident.
   */
  gitPath: string;
  /** `prCascade.remote`: the remote whose default branch is consulted first — `origin` unless the user works from a fork. */
  remote: string;
  /** `prCascade.statusBar`: whether the `<branch> · n of N` status bar item is shown (vscode/statusbar.ts); read on every refresh like the rest, so turning it off takes effect at the next one. */
  statusBar: boolean;
  /**
   * `prCascade.gsPath` (M5 item 19b): the git-spice executable, or `''` — the default — for
   * `git-spice`, then `gs`, looked up in VS Code's PATH (core/backends/gitspice.ts). A full path
   * when VS Code's PATH misses it; a wrong one is E62, naming it. Passed on exactly as read, as
   * `gitPath` is.
   */
  gsPath: string;
}

/**
 * Reads the settings as they are right now. Called once per refresh rather than once at
 * startup, so a setting changed in the Settings editor takes effect at the next refresh
 * without reloading the window.
 *
 * `getConfiguration('prCascade')` returns the whole `prCascade.*` group; `get('trunk', '')`
 * reads one key inside it, and the second argument is the value to use if the key is
 * somehow absent. package.json already declares a default for each key, so VS Code hands
 * that back when the user has set nothing — the argument here exists so the compiler knows
 * the result is a `string` and never `undefined`.
 *
 * All of them are taken as they come: any string is a usable value, and a wrong one fails
 * where it is used, with a message that names it (a missing ref → E4, a missing executable
 * → E17). An empty `gitPath` is not turned into `git` here, as M1–M3 did: it now means
 * "the Git extension's git", and src/extension.ts resolves it with the connection in hand.
 */
// see primer §31 (a type argument on a call: `get<string>`) and §16 (object literals)
export function readSettings(): PrCascadeSettings {
  const configuration = vscode.workspace.getConfiguration('prCascade');
  return {
    trunk: configuration.get<string>('trunk', ''),
    gitPath: configuration.get<string>('gitPath', ''),
    remote: configuration.get<string>('remote', 'origin'),
    statusBar: configuration.get<boolean>('statusBar', true),
    gsPath: configuration.get<string>('gsPath', ''),
  };
}
