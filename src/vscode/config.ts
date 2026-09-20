/**
 * vscode/config.ts — reads the extension's settings (`prCascade.*`) out of VS Code and hands
 * them over as plain values, checked where a wrong value would otherwise go unnoticed.
 *
 * Layer: vscode adapter (plan §4.1): the one place that knows settings live in VS Code's
 * configuration API. The core modules never see it — detectTrunk (core/trunk.ts) takes a
 * TrunkOptions object of plain strings, discoverRepoRoots (core/discovery.ts) a
 * DiscoveryOptions object, and this file is what builds both. Depends on: the `vscode`
 * module, and core/discovery.ts for the scan defaults (a value imported from core into
 * vscode — the allowed direction; core never imports from here) and for the
 * DiscoveryOptions shape the settings extend. Depended on by:
 * src/extension.ts, on every refresh. The settings and their defaults are declared in
 * package.json "contributes.configuration". Plan: §7.3, §13.4.
 */

// see primer §1 (import / export) and §2 (the vscode module); the `../core/discovery`
// value import is primer §41's first point (a value crossing from core into vscode); the
// `import type` beside it is §9's, and exists only for the compiler
import * as vscode from 'vscode';
import { DEFAULT_DISCOVERY_OPTIONS } from '../core/discovery';
import type { DiscoveryOptions } from '../core/discovery';

/**
 * The five settings M1 reads, as plain values — no VS Code types, so a test can build one
 * by hand and core code can take it without importing `vscode`. Three fields are declared
 * here; the two scan settings are the fields of DiscoveryOptions (core/discovery.ts), taken
 * over with `extends` so this object can be handed to discoverRepoRoots as it is, and so
 * a scan option added there must be read here or readSettings will not compile. Each
 * field's doc says what the setting means; package.json "contributes.configuration" is what
 * the user sees in the Settings editor, and the two must agree (test/ext/scanSettings.test.ts
 * checks the two scan defaults against DEFAULT_DISCOVERY_OPTIONS).
 */
// see primer §9 (interface, and `extends` on an interface)
export interface PrCascadeSettings extends DiscoveryOptions {
  /** `prCascade.trunk`: the ref to measure the stack against, or `''` for auto-detection (core/trunk.ts). */
  trunk: string;
  /** `prCascade.gitPath`: the git executable — `git` on PATH by default, or a full path when git is somewhere unusual (E17). */
  gitPath: string;
  /** `prCascade.remote`: the remote whose default branch is consulted first — `origin` unless the user works from a fork. */
  remote: string;
  // The two scan settings — `prCascade.repositoryScanMaxDepth` (`scanMaxDepth`) and
  // `prCascade.repositoryScanIgnoredFolders` (`scanIgnoredFolders`) — are not written out
  // here: `extends DiscoveryOptions` takes them over from core/discovery.ts, field for field.
  // That is the compiler's link, not a copy: add a scan option to DiscoveryOptions and
  // readSettings below stops compiling until it reads the new setting too. What the two
  // fields mean is documented on DiscoveryOptions; what this file adds is the guarantee that
  // they are always a whole number of -1 or more and always a list of strings, whatever
  // settings.json holds (readScanMaxDepth / readScanIgnoredFolders).
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
 * The three string settings are taken as they come: any string is a usable value, and a
 * wrong one fails where it is used, with a message that names it (a missing ref → E4, a
 * missing executable → E17). The two scan settings are not strings and have rules, so
 * each has a reader of its own below that checks the value before it is trusted.
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
    scanMaxDepth: readScanMaxDepth(configuration),
    scanIgnoredFolders: readScanIgnoredFolders(configuration),
  };
}

/**
 * `prCascade.repositoryScanMaxDepth`, checked before it is trusted. settings.json is a
 * file the user types into, and VS Code hands `get()` whatever is in it — `"1"`, `1.5`,
 * `-5` — although package.json declares a number with `minimum: -1`: the Settings editor
 * underlines a value that breaks the declaration, it does not refuse it. Passed on
 * unchecked, such a value would not fail loudly; it would quietly mean something else.
 * The scan compares the depth with `<` and tests for `-1` exactly (core/discovery.ts,
 * listCandidates; primer §40), so `-5` would behave as `0` — nothing below any folder —
 * and `1.5` as `2`, and the tree would show a different set of repositories with no word
 * about why. So anything but a whole number of `-1` or more becomes the default: the one
 * package.json declares, read from DEFAULT_DISCOVERY_OPTIONS so the two cannot drift.
 */
// see primer §41 (checking a value the compiler cannot vouch for: `get<unknown>`, typeof,
// Number.isInteger)
function readScanMaxDepth(configuration: vscode.WorkspaceConfiguration): number {
  // `<unknown>`, not `<number>`: the type argument on `get` is a claim, not a check
  // (primer §31), and the value is whatever the file holds. `unknown` makes the checks
  // below mandatory — the compiler refuses to compare or return it until they are done.
  const value = configuration.get<unknown>('repositoryScanMaxDepth', DEFAULT_DISCOVERY_OPTIONS.scanMaxDepth);
  if (typeof value !== 'number') {
    return DEFAULT_DISCOVERY_OPTIONS.scanMaxDepth;
  }
  // A whole number: `Number.isInteger` is false for `1.5`, and also for NaN and Infinity,
  // which JSON cannot hold but a `number` can be. Then the floor: `-1` is the "no limit"
  // sentinel, anything lower means nothing.
  if (Number.isInteger(value) === false || value < -1) {
    return DEFAULT_DISCOVERY_OPTIONS.scanMaxDepth;
  }
  return value;
}

/**
 * `prCascade.repositoryScanIgnoredFolders`, checked the same way. Declared as a list of
 * strings, but the file may hold anything: one string instead of a list (`"node_modules"`
 * — an easy slip, and a bad one to pass on, because a string has an `includes` method of
 * its own and `'node_modules'.includes('node')` is true, so the scan would skip every
 * folder whose name is a piece of that string), a number, a list with a number in it.
 * Not a list at all → the default list. A list → the strings in it, anything else
 * dropped: the names the user did type are honoured, and a stray `5` could never match a
 * directory name anyway.
 */
// see primer §41 (Array.isArray narrows `unknown`; the entries are still unknown) and
// §21 (Array.from: a copy of a list)
function readScanIgnoredFolders(configuration: vscode.WorkspaceConfiguration): string[] {
  const value = configuration.get<unknown>('repositoryScanIgnoredFolders', DEFAULT_DISCOVERY_OPTIONS.scanIgnoredFolders);
  if (Array.isArray(value)) {
    // `Array.isArray` proves "a list", not "a list of strings": the compiler calls the
    // elements `any`, and writing the list back as `unknown[]` makes each one need its
    // own check (primer §41 says why).
    const entries: unknown[] = value;
    const names: string[] = [];
    // see primer §22 (for ... of) and §17 (narrowing with typeof)
    for (const entry of entries) {
      if (typeof entry === 'string') {
        names.push(entry);
      }
    }
    return names;
  }
  // A copy, not the shared default itself. DEFAULT_DISCOVERY_OPTIONS is one object for the
  // whole session — discoverRepoRoots falls back to it too — and a `string[]` can be pushed
  // onto; nothing does today, but a settings object that carried the default by reference
  // would let one stray `push` change what every later refresh starts from.
  return Array.from(DEFAULT_DISCOVERY_OPTIONS.scanIgnoredFolders);
}
