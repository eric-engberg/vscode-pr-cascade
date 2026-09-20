/**
 * core/stack.ts — figures out which local branches form the stack under HEAD, in what
 * order, and which one is checked out.
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/model.ts (GitRunner,
 * StackLayer, RepoState). Depended on by: src/extension.ts (PR 6), which calls
 * computeStack once per repository root with the trunk detectTrunk found and hands the
 * RepoState to the tree view in src/vscode/tree.ts. Plan: §5 rows "Current branch",
 * "Stack members", "Layer order", "Layer SHA"; §4.3; §8 E3/E5/E6/E14/E15/E16/E19;
 * §12 item 2 (only the stack HEAD is on).
 */

// see primer §1 (import / export) and §9 (interface: `import type`)
import type { GitRunner, RepoState, StackLayer } from './model';

// Every local branch lives under this prefix in git's ref namespace: the branch `docs`
// is the ref `refs/heads/docs`. The code below asks git about branches by that full
// name, because a bare `docs` is ambiguous the moment a tag called `docs` exists — and
// git resolves that ambiguity in the tag's favour, with only a warning on stderr.
// see primer §4 (const)
const LOCAL_BRANCH_PREFIX = 'refs/heads/';

/**
 * What git says about one stack member on its own, before its place in the order is
 * known. StackLayer (core/model.ts) adds the fields that depend on the neighbours —
 * `parent`, `parentSha` — and on HEAD (`isCurrent`); those can only be filled in once the
 * branches are sorted, so the two steps get two shapes. Not exported: nothing outside
 * this file needs the half-built one.
 */
// see primer §9 (interface)
interface MeasuredBranch {
  name: string;
  sha: string;
  /** Commits on the branch that are not on trunk: its distance from trunk. */
  commitCount: number;
}

/**
 * Computes the stack under HEAD in the repository at `root`, measured against `trunk`.
 *
 * "The stack" is every local branch whose commit is an ancestor of HEAD — HEAD's own
 * branch included — and that trunk does not already contain (plan §3 "Stack
 * membership"). git answers that in one command: `for-each-ref refs/heads --merged HEAD
 * --no-merged <trunk>`. Two consequences follow from asking git rather than tracking
 * branches ourselves:
 *
 * - Only the stack HEAD is on is shown (plan §12 item 2). A second, unrelated stack in
 *   the same repository is not an ancestor of HEAD and never appears (E16); when HEAD is
 *   on a middle layer, the layers above it are not ancestors either and drop out of view.
 * - The tree renders what git says, even when the stack is in a state git-spice would
 *   call broken. After the bottom layer is amended its branch is no longer an ancestor
 *   of HEAD, so it disappears and its old commit is simply counted under the next layer
 *   (E14); after the bottom PR is squash-merged its branch's commits are still not in
 *   trunk (the squash wrote a different commit), so it still shows (E15). Both are
 *   documented by tests and fixed by git-spice's restack and sync in M9, not here.
 *
 * The order is each branch's distance from trunk — `rev-list --count <trunk>..<branch>`,
 * ascending — so the bottom layer, one commit above trunk, comes first. Two branches on
 * the same commit have the same count and are ordered by name (E6); both are listed,
 * next to each other, and the second has the first as its parent, so its own diff is
 * empty. Each layer's parent is the layer below it, and the bottom layer's parent is
 * trunk itself: that chain is what makes M2's per-layer diff show only what the layer
 * adds. It assumes the history between trunk and HEAD is a single line, which stacking
 * guarantees; a merge commit in there would still list every branch, in count order,
 * and the diffs would show whatever git says about neighbours that are not really
 * stacked.
 *
 * The caller guarantees `trunk` exists (detectTrunk verified it), so every command here
 * uses `run` and a failure is a real problem that surfaces (E17), never a `null` — with
 * one exception: `symbolic-ref HEAD` fails by design when HEAD is detached (E3), so that
 * one uses `tryRun` and `null` means "no branch".
 */
// see primer §6 (async / await), §22 (for ... of), §25 (arrays: push, length, a typed empty
// array) and §26 (sort and comparison functions)
export async function computeStack(git: GitRunner, root: string, trunk: string): Promise<RepoState> {
  const head = await currentBranch(git, root);
  const memberNames = await stackMemberNames(git, root, trunk);

  // Ask git two questions per branch — how far from trunk, and which commit — one branch
  // at a time. A stack is a handful of branches, so the plain loop reads better than
  // anything cleverer and costs nothing noticeable.
  const measured: MeasuredBranch[] = [];
  for (const name of memberNames) {
    const branch = await measureBranch(git, root, trunk, name);
    measured.push(branch);
  }
  // see primer §26 (sort and comparison functions)
  measured.sort(compareByDistanceThenName);

  if (measured.length === 0) {
    // HEAD is on trunk, or on something trunk already contains: no stack (E5). The tree
    // shows "Not on a stack" for an empty list. Nothing more is asked of git.
    // see primer §16 (object literals: shorthand keys)
    return { root, trunk, head, layers: [] };
  }

  // The bottom layer sits directly on trunk, so its parent is trunk and its parentSha is
  // trunk's commit. Every later layer's parent is the one before it: `parent` and
  // `parentSha` start as trunk and are moved up one layer per pass of the loop.
  const trunkSha = await resolveSha(git, root, trunk);
  const layers: StackLayer[] = [];
  let parent = trunk;
  let parentSha = trunkSha;
  for (const branch of measured) {
    layers.push({
      name: branch.name,
      sha: branch.sha,
      parent,
      parentSha,
      commitCount: branch.commitCount,
      // `head` is null when detached, and no branch name equals null, so no layer is
      // current then (E3) — exactly the behaviour E3 asks for, with no special case.
      isCurrent: branch.name === head,
    });
    parent = branch.name;
    parentSha = branch.sha;
  }
  return { root, trunk, head, layers };
}

/**
 * The branch HEAD is on, or `null` when HEAD is not on a local branch: detached (E3) —
 * checked out at a commit or a tag rather than a branch, as during a rebase or a
 * `git checkout <sha>` — or, rarely, pointed by hand at a ref outside `refs/heads/`.
 * `symbolic-ref` prints the full name of the ref HEAD points at, `refs/heads/main`, and
 * `--quiet` makes the detached case a silent exit 1 — which `tryRun` turns into `null` —
 * instead of an error message. The `refs/heads/` prefix is removed here rather than by
 * git's `--short`, because `--short` shortens only as far as stays unambiguous: with a
 * tag named like the branch it prints `heads/main`, and the tree would show that as the
 * layer's name.
 */
// see primer §23 (string methods: trim, endsWith/startsWith, slice)
async function currentBranch(git: GitRunner, root: string): Promise<string | null> {
  const output = await git.tryRun(['symbolic-ref', '--quiet', 'HEAD'], root);
  if (output === null) {
    return null;
  }
  // A ref name can never contain whitespace (git refuses to create one), so trim()
  // removes exactly the newline git prints and nothing that was part of the name.
  const ref = output.trim();
  if (ref.startsWith(LOCAL_BRANCH_PREFIX) === false) {
    // HEAD is a symbolic ref, but not to a local branch (`git symbolic-ref HEAD
    // refs/remotes/origin/main` does this). git's own `branch --show-current` refuses
    // outright here (`fatal: HEAD not found below refs/heads!`). We answer `null` instead
    // of throwing because, to the tree, it is the same as a detached HEAD: no layer can
    // be current.
    return null;
  }
  return ref.slice(LOCAL_BRANCH_PREFIX.length);
}

/**
 * The names of every local branch that is an ancestor of HEAD (or HEAD itself) and not
 * already contained in trunk — the stack members, in whatever order git lists them
 * (alphabetical; computeStack sorts them by distance afterwards).
 *
 * The command, piece by piece: `for-each-ref` walks refs and prints one line per ref in
 * the given format; `--format=%(refname:lstrip=2)` asks for the ref's name with its
 * first two path pieces — `refs/heads/` — cut off, which is exactly the branch name;
 * `refs/heads` limits it to local branches (no tags, no remote-tracking branches);
 * `--merged HEAD` keeps only refs whose commit is reachable from HEAD — "an ancestor of
 * HEAD" in the exact sense git uses for `git branch --merged`; `--no-merged <trunk>`
 * then drops the ones trunk already contains, which is trunk itself, every branch behind
 * it, and every branch already merged. What is left is the stack (E16: an unrelated
 * stack fails the `--merged HEAD` test and is never seen). This works on a detached HEAD
 * (E3) and inside a linked worktree (E19), where HEAD is the worktree's own, because
 * HEAD is just a commit to git here.
 *
 * `lstrip=2` rather than the more usual `%(refname:short)`: `short` shortens a ref only
 * as far as stays unambiguous, so once a tag has the same name as a branch it prints
 * `heads/docs` instead of `docs` — not what `git branch` lists, and not what the tree
 * should show as the layer's name.
 */
async function stackMemberNames(git: GitRunner, root: string, trunk: string): Promise<string[]> {
  const output = await git.run(
    ['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads', '--merged', 'HEAD', '--no-merged', trunk],
    root,
  );
  // One name per line, and a newline after the last one — so splitting on newlines
  // leaves an empty string at the end (and only that, when there are no members). The
  // filter keeps every line that is a name.
  // see primer §5 (arrow functions: an expression body) and §25 (arrays: split, filter)
  const lines = output.split('\n');
  const names = lines.filter((line) => line !== '');
  return names;
}

/**
 * Asks git the two per-branch questions: how many commits are on `name` that are not on
 * `trunk`, and which commit `name` points at.
 *
 * `rev-list --count <trunk>..<branch>` counts the commits reachable from the branch but
 * not from `trunk` — the two-dot range is "what the branch has that trunk lacks". That
 * count is the branch's distance from trunk and decides its place in the stack (plan §5
 * "Layer order"). It is a count of commits, not of files: a layer of three commits is
 * three above the layer below it, however small each commit was.
 *
 * Both questions name the branch by its full ref, `refs/heads/<name>`, never by the bare
 * name: a bare name is ambiguous when a tag of the same name exists, and git then
 * answers about the tag, which would give the layer the wrong SHA and the wrong count.
 * Trunk is used exactly as detectTrunk verified it (`origin/main`, `main`).
 */
// see primer §27 (Number: text to number)
async function measureBranch(git: GitRunner, root: string, trunk: string, name: string): Promise<MeasuredBranch> {
  const branchRef = LOCAL_BRANCH_PREFIX + name;
  // see primer §12 (template strings)
  const countOutput = await git.run(['rev-list', '--count', `${trunk}..${branchRef}`], root);
  // git prints the count as digits followed by a newline: "3\n". Number() reads it.
  const commitCount = Number(countOutput.trim());
  const sha = await resolveSha(git, root, branchRef);
  return { name, sha, commitCount };
}

/**
 * The full SHA of the commit `ref` points at, via `rev-parse` (plan §5 "Layer SHA").
 * Used for each layer (as `refs/heads/<name>`) and once for trunk (as detectTrunk named
 * it), so the bottom layer's `parentSha` is found the same way as every other SHA in the
 * state.
 */
async function resolveSha(git: GitRunner, root: string, ref: string): Promise<string> {
  const output = await git.run(['rev-parse', ref], root);
  return output.trim();
}

/**
 * Decides the order of two stack members for `Array.sort`: the one nearer trunk first,
 * and for two at the same distance — two branch names on one commit (E6) — the one whose
 * name sorts first. A negative result means `first` goes before `second`, positive the
 * reverse, zero that they are equal (which never happens here: two local branches cannot
 * share a name).
 *
 * The tie-break compares the names with `<` and `>`, which order strings by their
 * character codes — plain, and identical on every machine. `localeCompare`, the
 * alternative, orders by the user's language rules and could put the same two branches
 * in a different order on two developers' machines; a tree that changes order between
 * machines would be a bug report waiting to happen.
 */
// see primer §26 (sort and comparison functions)
function compareByDistanceThenName(first: MeasuredBranch, second: MeasuredBranch): number {
  if (first.commitCount !== second.commitCount) {
    // Fewer commits since trunk = nearer the bottom. Subtracting gives the sign sort
    // wants: negative when `first` is nearer.
    return first.commitCount - second.commitCount;
  }
  if (first.name < second.name) {
    return -1;
  }
  if (first.name > second.name) {
    return 1;
  }
  return 0;
}
