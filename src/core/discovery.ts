/**
 * core/discovery.ts — turns the folders open in VS Code into the list of git repositories
 * they belong to: every root once, in workspace order.
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/model.ts (GitRunner) and
 * Node's `node:fs/promises`. Depended on by: src/extension.ts (PR 6), which runs it over
 * `workspace.workspaceFolders` at startup and again on every refresh. Plan: §3 "Repo
 * discovery", §6, §8 E1/E2/E19.
 */

// see primer §1 (import / export) and §9 (interface: `import type`): `node:fs/promises` is
// the Promise-returning half of Node's file-system module.
import * as fs from 'node:fs/promises';
import type { GitRunner } from './model';

/**
 * Finds the root directory of every git repository the given folders belong to — each
 * root exactly once, in the order the folders were given.
 *
 * Why ask git rather than look for a `.git` entry ourselves: `git rev-parse
 * --show-toplevel` walks *up* from the folder until it finds the repository, so a
 * workspace folder that is a subfolder of a repository still resolves to that repository
 * (E1). It also understands every layout git has — a linked worktree, where `.git` is a
 * small file pointing elsewhere rather than a directory (E19), a repository whose
 * `GIT_DIR` lives outside the working tree — without this code knowing any of them.
 *
 * A folder outside any repository is skipped, not an error: git exits non-zero there
 * ("fatal: not a git repository"), so `tryRun` answers `null`, and a workspace may
 * legitimately mix repositories with plain folders. A folder that no longer exists on
 * disk is skipped the same way. But if git itself cannot run (E17), the rejection is left
 * to propagate to the caller, because "no repositories" would be the wrong answer to
 * "git is missing" — the tree shows one error node for that instead (PR 6).
 *
 * The folders are visited one after another rather than all at once. A workspace holds a
 * handful of folders and one `rev-parse` takes milliseconds, so the plain loop is the
 * easier read and costs nothing noticeable.
 */
// see primer §6 (async / await), §21 (Set), §22 (for ... of) and §23 (string methods)
export async function discoverRepoRoots(folders: string[], git: GitRunner): Promise<string[]> {
  // A Set keeps each value once and remembers the order in which values were first
  // added — exactly the two rules for the result: no duplicates (E2), workspace order kept.
  const roots = new Set<string>();
  for (const folder of folders) {
    // `null` here means git ran and said "not a repository", or the folder is gone
    // (core/model.ts, tryRun). Either way there is nothing to show for this folder.
    const output = await git.tryRun(['rev-parse', '--show-toplevel'], folder);
    if (output === null) {
      continue;
    }
    // git prints the path followed by one newline, and the runner hands stdout over
    // untouched. Only that newline goes: a directory name may legitimately end in a space
    // or a tab, and trim() would eat those too, leaving a path that does not exist.
    let printedRoot = output;
    if (printedRoot.endsWith('\n')) {
      printedRoot = printedRoot.slice(0, -1);
    }
    const root = await normalizeRoot(printedRoot);
    roots.add(root);
  }
  return Array.from(roots);
}

/**
 * Brings a root path into one canonical spelling, so that two folders which are the same
 * directory on disk also compare equal as strings and the Set above counts them once (E2).
 * Two kinds of spelling difference are removed:
 *
 * - Symlinks. On macOS `/tmp` is a symlink to `/private/tmp` and `/var` to `/private/var`,
 *   so a workspace folder opened as `/tmp/work` and one opened as `/private/tmp/work` are
 *   one repository. `realpath` follows every link on the way and returns the physical
 *   path. Current git already prints the physical path from `--show-toplevel`, but that is
 *   git's habit rather than a documented promise; resolving here makes the dedupe
 *   independent of it.
 * - A trailing slash. git never prints one today, but `/work/app/` and `/work/app` name
 *   the same directory and must not count twice.
 *
 * If `realpath` fails — the directory vanished between git answering and us asking, or a
 * permission problem somewhere along the path — the path git printed is used as it is. A
 * root we cannot canonicalize is still a repository worth showing.
 */
// see primer §18 (try / catch and unknown: a `catch` with no name for the error)
async function normalizeRoot(printedRoot: string): Promise<string> {
  let resolved = printedRoot;
  try {
    resolved = await fs.realpath(printedRoot);
  } catch {
    // Keep the path git printed. Nothing about the error would change what we do next,
    // so it is not even given a name.
  }
  return stripTrailingSlash(resolved);
}

/**
 * Removes one trailing `/` from a path, except from `/` itself: a repository at the very
 * top of the filesystem is written `/`, and stripping that would leave an empty string.
 * Only `/` is looked for because git prints forward slashes on every platform, Windows
 * included. On Windows a successful `realpath` hands back backslashes and no trailing
 * separator, so there this check only matters on the fallback path — and a drive root
 * printed as `C:/` would become `C:`, which Windows reads as "the current directory on
 * C:". That case is not handled until a Windows CI leg exists to test it.
 */
function stripTrailingSlash(directory: string): string {
  if (directory === '/') {
    return directory;
  }
  if (directory.endsWith('/')) {
    // Drop the one trailing separator; the directory named is the same.
    return directory.slice(0, -1);
  }
  return directory;
}
