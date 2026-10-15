/**
 * vscode/contextKeys.ts — the names of the context keys the `onDidLoadStates` listener in
 * src/extension.ts sets after every load, and package.json's `when` and `enablement` clauses read.
 * One module both sides import, because a key's value cannot be read back (primer §74): the one
 * check a test can make is that the string written is the string the manifest names —
 * test/ext/commands.test.ts compares the manifest against these. Two literals, one in each place,
 * would let a typo on either side leave `!prCascade.rebaseInProgress` reading `!undefined`, which
 * is `true`: both commands enabled for ever, and every test green.
 *
 * Layer: VS Code side (plan §4.1) — strings only, no `vscode` import, so the extension-host tests
 * can read them without the bundle's twin. Depends on: nothing. Depended on by: src/extension.ts
 * (the listener), test/ext/commands.test.ts (the manifest cases). Plan: §7.2.1, §7.11, §13.2
 * D60, D62.
 */

// see primer §4 (const) and §36 (export const: a shared constant)

/**
 * True while any loaded repository has a layer git-spice does not track (`tracking === null`).
 * Read by the `view/title` entry of `prCascade.trackStack` (`when`), so "Track Stack with
 * git-spice" is in the `…` menu exactly while a repository shows a `not tracked` row (M5 item 20b).
 */
export const HAS_UNTRACKED_KEY = 'prCascade.hasUntracked';

/**
 * True while any loaded repository has a rebase paused (`rebaseInProgress`). Read by the
 * `enablement` of `prCascade.pushStack` and `prCascade.trackStack` — negated — so both entries are
 * greyed out during a rebase (plan §7.2.1; M5 item 21b). One window-wide key: a `when` cannot name
 * a repository, so one paused repository greys the entries for every repository, and each command's
 * own sentence names the folder when it refuses.
 */
export const REBASE_IN_PROGRESS_KEY = 'prCascade.rebaseInProgress';
