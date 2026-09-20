/**
 * core/model.ts — the shared types (data shapes) the core logic passes around.
 *
 * Layer: core (no VS Code imports; plan §4.1). This file holds no logic, only descriptions
 * of shapes, so every other core file can import them without importing each other: the
 * GitRunner interface every git-reading module is written against, and the data model the
 * tree renders — StackLayer, RepoState, and the ChangedFile under each layer. Depends on:
 * nothing. Depended on by: every core module — core/git.ts implements GitRunner;
 * core/discovery.ts, core/trunk.ts, core/stack.ts and core/changes.ts take one;
 * core/stack.ts builds the RepoState and core/changes.ts the ChangedFiles. Plan: §4.3.
 */

/**
 * How the core logic runs git. It is an interface — a contract with no code behind it —
 * rather than a class so that two things can satisfy it: RealGitRunner (core/git.ts), which
 * spawns the real `git` executable, and FakeGitRunner (test/helpers/fakeGit.ts), which
 * answers from canned strings. Everything in src/core takes a GitRunner as a parameter and
 * never spawns git itself, which is what lets the stack logic be unit-tested without a
 * repository, a git binary, or VS Code (plan §9.1 layer 1).
 *
 * Both methods run `git <args>` with the working directory set to `cwd` and resolve with
 * git's stdout unmodified — not trimmed, decoded as UTF-8 text: the trailing newline git
 * prints after a branch name or a path is still there, and the NUL separators of
 * `git diff -z` (M2) are untouched. Callers that want a single value drop that newline
 * themselves (or trim, where whitespace cannot be meaningful — a ref name, but not a
 * path). The difference between the two methods is only what happens when git says no.
 */
// see primer §9 (interface) and §10 (union types: `string | null`)
export interface GitRunner {
  /**
   * Run git and expect it to succeed. A non-zero exit rejects the Promise (with a GitError
   * carrying the exit code and stderr, in the real runner). Use this for commands whose
   * failure is a real problem the user has to see, like `for-each-ref` while listing the
   * stack.
   */
  run(args: string[], cwd: string): Promise<string>;

  /**
   * Run git where a non-zero exit is an ordinary answer, not an error: `rev-parse
   * --show-toplevel` outside a repository, `symbolic-ref HEAD` while detached (E3),
   * `rev-parse --verify` for a branch that may not exist. Resolves with `null` in that case,
   * so the caller can write `if (root === null)` instead of catching an exception. A
   * `cwd` that cannot be used — it does not exist, it is a file, or it cannot be entered —
   * gets the same `null`: a workspace folder deleted or renamed on disk is "no repository
   * here" to discovery (PR 3), not a problem with git.
   *
   * It swallows only those two — "git ran and said no" and "there is no usable place to
   * ask in". If git itself could not run — the executable is missing or the path setting
   * is wrong (E17) — it still rejects, because turning that into `null` would make every
   * repository look like "not a git repository" and hide the real problem.
   */
  tryRun(args: string[], cwd: string): Promise<string | null>;
}

/**
 * One branch of the stack under HEAD, as the tree shows it: a row with a name, how far it
 * is from trunk, and which row sits below it. core/stack.ts builds these; the tree view
 * (PR 6) renders one node per layer, and core/changes.ts asks git what changed between
 * `parentSha` and `sha` (a tree diff of the two tips). The fields that depend on the
 * neighbours — `parent`, `parentSha` — are what make the layers a *stack* rather than a
 * bag of branches: every layer's diff is measured against the layer below it, never
 * against trunk, which is what "stacked" means.
 */
// see primer §9 (interface) and §24 (boolean)
export interface StackLayer {
  /** The local branch name, exactly as `git branch` lists it: `feat/otel-ingress`. */
  name: string;
  /** The commit the branch points at, as the full 40-character SHA. */
  sha: string;
  /** The layer below: the previous layer's branch name, or the trunk ref for the bottom layer. */
  parent: string;
  /**
   * The commit `parent` points at. The commits `parentSha..sha` (as `rev-list --count`
   * counts them) are what this layer adds; core/changes.ts diffs the two trees.
   */
  parentSha: string;
  /**
   * How many commits are on the branch and not on trunk (`git rev-list --count
   * trunk..name`) — the layer's distance from trunk, which is what orders the stack. Two
   * branches on one commit have the same count (E6); a layer several commits above its
   * parent has a higher count than the parent, never the same.
   */
  commitCount: number;
  /** Whether HEAD is on this branch. At most one layer is current; none when HEAD is detached (E3). */
  isCurrent: boolean;
}

/**
 * How one file changed between a layer and its parent, in git's own letters
 * (`git diff --name-status`): Added, Modified, Deleted, Renamed, Copied, Type changed
 * (a file became a symlink, or the reverse). A union of exact strings rather than free
 * text so a typo such as `'X'` is a compile error, and so the tree (M2) can branch on
 * them with a plain `===`. Defined with the rest of the data model from plan §4.3, so
 * the shape the tree is built around is in one place; core/changes.ts is where git's
 * text becomes one of these, and where any other letter is refused.
 */
// see primer §10 (union types: exact strings as members)
export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';

/**
 * One file a layer changes relative to its parent — a row under the layer's node (PR 11).
 * Part of the plan §4.3 data model, declared here with the rest of it; core/changes.ts
 * builds them from `git diff --name-status -M -z` output and fills in `binary` from
 * `git diff --numstat -M -z`, the one of the two commands that can tell (E10).
 */
// see primer §11 (optional `?` fields)
export interface ChangedFile {
  status: FileStatus;
  /** The path as it is on the layer's branch. */
  path: string;
  /** For a rename or copy (R/C): the path as it was on the parent. Absent otherwise. */
  oldPath?: string;
  /** git considers the file binary (E10): shown as a file, not opened in a diff editor. */
  binary: boolean;
}

/**
 * Everything the tree knows about one repository — the output of the whole core pipeline
 * for one root: discovery finds `root`, detectTrunk finds `trunk`, computeStack fills in
 * `head` and `layers`. One object rather than four loose values so the tree view receives
 * one thing per repository and a test can assert on one thing (`toEqual`). The `null`
 * cases are states the tree shows as a message instead of a stack: no trunk (E4, "set
 * prCascade.trunk"), detached HEAD (E3). M4 adds `rebaseInProgress` here when it is
 * computed and rendered (plan §5 "Rebase in progress").
 */
// see primer §10 (union types: `string | null`)
export interface RepoState {
  /** The repository root, as discovery found it (physical path, no trailing slash). */
  root: string;
  /** The ref the stack is measured against (`origin/main`, `main`), or null when none was found (E4). */
  trunk: string | null;
  /** The branch HEAD is on; null when HEAD is detached (E3), or when no trunk was found and the stack was not computed (E4, `trunk` also null). */
  head: string | null;
  /** Bottom to top: the first element sits directly on trunk. Empty when HEAD is on trunk (E5). */
  layers: StackLayer[];
}
