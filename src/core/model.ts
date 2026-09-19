/**
 * core/model.ts — the shared types (data shapes) the core logic passes around.
 *
 * Layer: core (no VS Code imports; plan §4.1). This file holds no logic, only descriptions
 * of shapes, so every other core file can import them without importing each other. In
 * this PR it defines just GitRunner, the one interface every git-reading module is written
 * against; PR 5 adds StackLayer, ChangedFile and RepoState. Depends on: nothing. Depended
 * on by: core/git.ts (implements GitRunner) and every later core module. Plan: §4.3.
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
