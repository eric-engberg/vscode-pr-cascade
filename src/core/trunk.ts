/**
 * core/trunk.ts — decides which ref is the trunk: the branch a stack grows out of, and
 * the base every layer's commits are counted against.
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/model.ts (GitRunner).
 * Depended on by: src/extension.ts (PR 6), which calls detectTrunk once per repository
 * root and hands the answer to computeStack (PR 5); when the answer is null the tree shows
 * "No trunk found — set prCascade.trunk" instead of a stack (E4). Plan: §5 "Trunk
 * auto-detect", §7.3 (prCascade.trunk, prCascade.remote), §8 E4/E25.
 */

// see primer §1 (import / export) and §9 (interface: `import type`)
import type { GitRunner } from './model';

/**
 * The two settings trunk detection reads (plan §7.3), handed in as plain values. This
 * module never touches VS Code's configuration API itself: src/vscode/config.ts (PR 6)
 * reads the settings and builds this object, and tests build it by hand. Passing them as
 * one named object rather than two loose strings means a call site reads
 * `{ configured: '', remote: 'origin' }` — the two cannot be swapped by accident.
 */
// see primer §9 (interface)
export interface TrunkOptions {
  /**
   * `prCascade.trunk`: the ref to treat as trunk, exactly as the user typed it (`main`,
   * `origin/main`, `release/2.0`). Empty — the default — means "work it out from the
   * repository"; detectTrunk below says how.
   */
  configured: string;
  /**
   * `prCascade.remote`: the remote whose default branch is consulted and whose
   * remote-tracking branches are tried first. `origin` by default; someone who works on a
   * fork and keeps the original repository as `upstream` sets it to that.
   */
  remote: string;
}

/**
 * Finds the trunk of the repository at `root`, or `null` when there is none to find (E4).
 *
 * "Trunk" is the branch stacks are built on and merged into — `main` in most repositories
 * — and everything in the tree is measured from it: a layer's commits are `trunk..branch`,
 * and the stack is "ancestors of HEAD that are not yet in trunk" (plan §5). Get it wrong
 * and the tree shows the wrong stack with no sign that anything is off, so the rules below
 * prefer a definite answer over a guess, and `null` over a wrong answer.
 *
 * The order (plan §5 "Trunk auto-detect"):
 *
 * 1. If `prCascade.trunk` is set, it is the answer — provided it names a commit (refExists
 *    below says why "a commit" and not just "something"). If it does not, the answer is
 *    `null`, *not* a fall-through to auto-detection: a user who typed
 *    `release/2.0` and got a stack measured against `origin/main` would have a wrong tree
 *    and no hint why. `null` becomes the "No trunk found — set prCascade.trunk" node
 *    (E4), which points at the setting to fix.
 * 2. Otherwise the remote's default branch. `refs/remotes/<remote>/HEAD` is a pointer git
 *    writes on `git clone` recording which branch the remote checks out by default — what
 *    GitHub shows on the repository's front page. It is the best signal there is, because
 *    the remote itself provides it. The pointer can go stale, though: when a remote
 *    renames `master` to `main`, `git fetch --prune` removes `origin/master` and reports
 *    "refs/remotes/origin/HEAD has become dangling". git 2.48 and later re-create the
 *    pointer during that same fetch; older versions (the plan's floor is 2.38) leave it
 *    dangling, and so does any tool that deletes remote-tracking branches by hand. So
 *    the branch it names is checked too, and a stale pointer counts as none.
 * 3. Otherwise the usual names, remote-tracking branches first: `<remote>/main`,
 *    `<remote>/master`, then the local `main` and `master`. Remote-tracking first because
 *    they are what a stack is really measured against — the local `main` may be behind
 *    the remote, or ahead of it with unpushed work. The local names are for a repository
 *    with no remote at all (E25): a stack still shows there, measured against the local
 *    branch.
 * 4. Nothing above exists → `null` (E4).
 *
 * Each step asks git one or two questions and stops as soon as it has an answer; the
 * unit tests pin the exact sequence of commands for every path.
 */
// see primer §6 (async / await), §10 (union types: `string | null`), §22 (for ... of) and §24 (boolean)
export async function detectTrunk(git: GitRunner, root: string, options: TrunkOptions): Promise<string | null> {
  if (options.configured !== '') {
    const configuredExists = await refExists(git, root, options.configured);
    if (configuredExists) {
      return options.configured;
    }
    // Deliberately no fall-through to the rules below: see step 1 in the comment above.
    return null;
  }

  const remoteDefault = await remoteDefaultBranch(git, root, options.remote);
  if (remoteDefault !== null) {
    return remoteDefault;
  }

  // see primer §12 (template strings)
  const candidates = [`${options.remote}/main`, `${options.remote}/master`, 'main', 'master'];
  for (const candidate of candidates) {
    const candidateExists = await refExists(git, root, candidate);
    if (candidateExists) {
      return candidate;
    }
  }
  return null;
}

/**
 * Asks git whether `ref` names a commit in this repository. `--verify` makes rev-parse
 * check exactly one revision instead of interpreting a command line; `--quiet` makes a
 * miss silent — exit 1 and nothing on stderr — rather than a "fatal: Needed a single
 * revision" for every candidate that is not there. tryRun turns that exit 1 into `null`;
 * anything else (the commit's SHA on stdout) means yes.
 *
 * `^{commit}` on the end makes rev-parse insist on a commit: `--verify` alone accepts
 * any object git can resolve — `main:` is the *tree* of main's commit and passes — and
 * everything later (`rev-list --count <trunk>..`, `for-each-ref --no-merged <trunk>`)
 * needs a commit, so a trunk that is a tree or a blob would fail there with a plausible
 * name in hand. With the suffix, an annotated tag is followed to the commit it points at
 * and a tree or blob is a miss. (The one case where git is not silent: a tag that points
 * at a tree gets an `error:` line on stderr as well as the exit 1; tryRun discards both.)
 *
 * The user's setting reaches git as one argument, exactly as typed (plan §3 "Git
 * access": an argument array, never a shell string). `--end-of-options` means a setting
 * that starts with `-` is still a ref name to rev-parse, not a flag — without it,
 * `--all` would be read as rev-parse's own `--all`. Git has had the marker since 2.24;
 * the plan's floor is 2.38. It has to come after `--verify`, which git insists precede
 * anything that is not an option.
 */
async function refExists(git: GitRunner, root: string, ref: string): Promise<boolean> {
  // Only `${ref}` is TypeScript here (primer §12); `^{commit}` is git's own suffix.
  const output = await git.tryRun(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], root);
  return output !== null;
}

/**
 * Reads the remote's default branch from the `refs/remotes/<remote>/HEAD` pointer, as
 * `<remote>/<branch>` (`origin/main`), or `null` when there is no pointer or it names a
 * branch that is no longer there (step 2 of detectTrunk).
 *
 * Why the pointer may be missing: before git 2.48 only `git clone`, `git remote add -m`
 * and `git remote set-head` wrote it, so a repository that was `git init`ed and given its
 * remote by hand under an older git has none; since 2.48 `git fetch` also creates it when it is absent
 * (`remote.<name>.followRemoteHEAD`, default `create`). On any version it is missing when
 * it was deleted, or when the clone was made by a tool that never sets it.
 */
async function remoteDefaultBranch(git: GitRunner, root: string, remote: string): Promise<string | null> {
  const pointer = `refs/remotes/${remote}/HEAD`;
  // symbolic-ref prints what a pointer ref points at; `--quiet` makes "no such pointer"
  // a silent exit 1 (→ null) instead of an error message.
  const output = await git.tryRun(['symbolic-ref', '--quiet', '--short', pointer], root);
  if (output === null) {
    return null;
  }
  // `--short` prints `origin/main` rather than `refs/remotes/origin/main`, followed by a
  // newline. Unlike a directory name (core/discovery.ts), a ref name can never contain
  // whitespace — git refuses to create one — so trim() removes exactly that newline.
  // see primer §23 (string methods)
  const target = output.trim();
  const targetExists = await refExists(git, root, target);
  if (targetExists === false) {
    // A stale pointer (the remote renamed its default branch; see detectTrunk step 2).
    return null;
  }
  return target;
}
