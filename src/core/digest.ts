/**
 * core/digest.ts — the one git command whose output says whether anything `gs log` could
 * answer has changed (plan §7.14.2's pre-filter), and the one fact read off that output. The
 * tree refreshes after every `git status` the built-in Git extension runs — a stage click, an
 * autofetch tick — and `gs log short --all --json` costs 0.6 s a call (measured 2026-10-08), so
 * the backend asks it only when this text differs from the last time: every ref under
 * `refs/heads` (a commit), `refs/remotes` (a fetch or push — trunk is a remote-tracking ref) and
 * `refs/spice` (what `gs repo init`, `gs branch track` and `gs branch submit` write, and what
 * `gs log` itself rewrites when it prunes a branch deleted out of band), with the commit each
 * points at. Object names only, never a ref's contents (plan §3 "Read model": `refs/spice/data`
 * is git-spice's own, declared internal). HEAD is not in it: with `--all` git-spice prints the
 * same lines whatever branch is checked out, but for the `current` flag on HEAD's line, which
 * core/gsLog.ts drops (verified 0.31.2, D59).
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/model.ts (`GitRunner`). Depended
 * on by: core/backends/gitspice.ts (`enrich`, item 20a), test/unit/digest.test.ts,
 * test/git/digest.git.test.ts, test/unit/enrich.test.ts (`DIGEST_ARGS`). Plan: §3, §7.6,
 * §7.14.2, §9.4 `unit/digest`, §10.1 item 20a, §13.2 D59 (a module §4.2 did not list).
 */

// see primer §1 (import / export) and §9 (`import type`)
import type { GitRunner } from './model';

/**
 * The command: `for-each-ref` lists refs sorted by name, one per line, in the format asked for
 * — here the full ref name, a space and the object name — under the three namespaces named.
 * Exported so the tests can spell the argv they expect from the same list.
 */
// see primer §4 (const) and §14 (readonly arrays)
export const DIGEST_ARGS: readonly string[] = ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes', 'refs/spice'];

/**
 * The line `gs repo init` writes, as `for-each-ref` prints it: `refs/spice/data` at the start of
 * a line, then the space before the object name — so `refs/spice/database` or `refs/spice/data/x`
 * would not match. `m` makes `^` the start of every line, not only the text's.
 */
// see primer §20 (regular expression literals: the `m` flag)
const SPICE_DATA_LINE = /^refs\/spice\/data /m;

/**
 * The digest for the repository at `root`: `for-each-ref`'s text, exactly as printed, trailing
 * newline included — the backend compares it with `===` and never takes it apart. `run`, not
 * `tryRun`: this command fails only when git itself cannot run (E17), which is not an answer.
 */
// see primer §16 (arrays: spread — a mutable copy, since `run` takes `string[]`)
export function readRefDigest(git: GitRunner, root: string): Promise<string> {
  return git.run([...DIGEST_ARGS], root);
}

/**
 * Whether the digest has a `refs/spice/data` line — the repository is initialised for git-spice
 * (the probe's step 2, plan §7.13.1, D56). The fact is read off text already in hand, so the
 * backend learns it with no spawn — and never runs `gs log` without it: on an uninitialised
 * repository git-spice would try to initialise it and, with no prompt allowed, die at the trunk
 * question (verified 0.31.2; plan §7.6).
 */
// see primer §20 (`test`: a yes-or-no match)
export function isInitialised(digest: string): boolean {
  return SPICE_DATA_LINE.test(digest);
}
