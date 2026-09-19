/**
 * vscode/config.ts — reads the extension's settings (`prCascade.*`) out of VS Code and hands
 * them over as plain values.
 *
 * Layer: vscode adapter (plan §4.1): the one place that knows settings live in VS Code's
 * configuration API. The core modules never see it — detectTrunk (core/trunk.ts) takes a
 * TrunkOptions object of plain strings, and this file is what builds it. Depends on: the
 * `vscode` module. Depended on by: src/extension.ts, on every refresh. The settings and
 * their defaults are declared in package.json "contributes.configuration". Plan: §7.3.
 */

// see primer §1 (import / export) and §2 (the vscode module)
import * as vscode from 'vscode';

/**
 * The three settings M1 reads, as plain values — no VS Code types, so a test can build one
 * by hand and core code can take it without importing `vscode`. Each field's doc says what
 * the setting means; package.json "contributes.configuration" is what the user sees in the
 * Settings editor, and the two must agree.
 */
// see primer §9 (interface)
export interface PrCascadeSettings {
  /** `prCascade.trunk`: the ref to measure the stack against, or `''` for auto-detection (core/trunk.ts). */
  trunk: string;
  /** `prCascade.gitPath`: the git executable — `git` on PATH by default, or a full path when git is somewhere unusual (E17). */
  gitPath: string;
  /** `prCascade.remote`: the remote whose default branch is consulted first — `origin` unless the user works from a fork. */
  remote: string;
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
 */
// see primer §31 (a type argument on a call: `get<string>`)
export function readSettings(): PrCascadeSettings {
  const configuration = vscode.workspace.getConfiguration('prCascade');
  let gitPath = configuration.get<string>('gitPath', 'git');
  if (gitPath === '') {
    // A user who clears the setting means "the default", not "a program with no name" —
    // which is what execFile would be asked to run, and fail on (E17) with a message that
    // names an empty path.
    gitPath = 'git';
  }
  // see primer §16 (object literals)
  return {
    trunk: configuration.get<string>('trunk', ''),
    gitPath,
    remote: configuration.get<string>('remote', 'origin'),
  };
}
