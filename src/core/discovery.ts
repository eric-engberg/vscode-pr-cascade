/**
 * core/discovery.ts — turns the folders open in VS Code into the list of git repositories
 * they belong to or contain, every root once, in workspace order. It looks *up*, for a
 * folder that is a repository or sits inside one, and *down*, for repositories in
 * subdirectories of a folder (plan §1's layout).
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/model.ts (GitRunner),
 * `node:fs/promises`, `node:path`. Depended on by: src/extension.ts (at startup and on
 * every refresh) and src/vscode/config.ts (PR 8). Plan: §3, §6, §13.4, §8 E1/E1b/E2/E19.
 */

// see primer §1 (import / export) and §9 (interface: `import type`): `node:fs/promises` is
// the Promise-returning half of Node's file-system module (primer §39), `node:fs` the
// module the Dirent type lives in.
import type { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { GitRunner } from './model';

/**
 * How far below each workspace folder to look, and which directory names to leave out.
 * These are the two settings PR 8 adds (`prCascade.repositoryScanMaxDepth`,
 * `prCascade.repositoryScanIgnoredFolders`), handed in as plain values so this module never
 * touches VS Code — the same arrangement as TrunkOptions in core/trunk.ts. They mean
 * exactly what VS Code's built-in git extension's `git.repositoryScanMaxDepth` and
 * `git.repositoryScanIgnoredFolders` mean, on purpose: anyone who has tuned those for a
 * workspace already knows what these do, and the two views then agree on what a
 * workspace holds.
 */
// see primer §9 (interface)
export interface DiscoveryOptions {
  /**
   * How many directory levels below a workspace folder are still asked about. `0`: only
   * the workspace folders themselves (how M1 first shipped). `1`: their immediate
   * subdirectories too — the parent-folder layout. `-1`: no limit (primer §40). The
   * folder itself is always asked, whatever the depth.
   */
  scanMaxDepth: number;
  /** Directory names never entered while scanning, at any level: `node_modules` by default. */
  scanIgnoredFolders: string[];
}

/**
 * The defaults, in one place — and they are the built-in git extension's own
 * (`git.repositoryScanMaxDepth` 1, `git.repositoryScanIgnoredFolders` `["node_modules"]`),
 * so the Source Control view and the Stack view find the same repositories.
 * `discoverRepoRoots` uses this object when a caller passes no options, and
 * src/vscode/config.ts (PR 8) uses it as the fallback when reading the settings, so
 * package.json's defaults and the code cannot drift apart unnoticed (PR 8 adds the test
 * that they agree).
 */
// see primer §36 (export const: a shared constant object)
export const DEFAULT_DISCOVERY_OPTIONS: DiscoveryOptions = {
  scanMaxDepth: 1,
  scanIgnoredFolders: ['node_modules'],
};

/**
 * Finds the root directory of every git repository the given folders belong to or
 * contain — each root exactly once, in the order the folders were given, and below one
 * folder in name order.
 *
 * Why both directions. `git rev-parse --show-toplevel` walks *up* from wherever it is
 * run, so a workspace folder that is a repository, or a subfolder of one, resolves to
 * that repository (E1b). It never looks *down* — and plan §1's layout is the down case: a
 * parent folder open for browsing, the repositories in subdirectories of it. From that
 * parent git answers "not a repository", and M1 as first submitted showed "No git
 * repository in this workspace" there — the same blind spot that made the jjk extension
 * useless for exactly this layout (plan §1, Appendix C). So each folder's subdirectories
 * are asked too, to a depth (E1; plan §13.4).
 *
 * Why this mirrors VS Code's built-in git extension (`extensions/git/src/model.ts`,
 * `traverseWorkspaceFolder`): it solves the same problem the same way, with the settings
 * `git.repositoryScanMaxDepth` (default 1) and `git.repositoryScanIgnoredFolders` (default
 * `["node_modules"]`), and copying the rules and the defaults means the two views agree
 * on which repositories a workspace holds. One difference: the built-in extension is
 * eager about the down direction but asks before opening a repository found by walking
 * up (`git.openRepositoryInParentFolders`); here both directions are silent, because §6
 * and E1b want the up case shown.
 *
 * Why no `.git` sniffing: nothing here looks for a `.git` entry to decide what is a
 * repository. Every candidate directory gets the same `rev-parse --show-toplevel` and git
 * decides — so every layout git understands works with no code here: a linked worktree,
 * where `.git` is a one-line file rather than a directory (E19), a `GIT_DIR` outside the
 * working tree, whatever git adds next. The one `.git` this file knows by name is the one
 * listCandidates does not descend *into*.
 *
 * Why in parallel: a parent folder with twenty repositories under it is twenty git
 * processes on every refresh, and at tens of milliseconds each, one after another, that
 * is a visible pause; started together (`Promise.all`) they take about as long as one.
 * PR 3's one-folder-at-a-time loop was fine for a handful of workspace folders and is
 * not fine for a scan. The answers come back in candidate order, so the roots still
 * follow workspace order, then name order.
 *
 * Two consequences, both accepted. A workspace folder that *is* a repository has its
 * subdirectories asked too (`src`, `test`, ...), and every one answers with the same
 * root, which the Set counts once — a few extra processes, nothing wrong in the result;
 * the built-in extension does the same, and M4's caching of discovered roots is what
 * stops it happening on every window focus. And the depth is the safety valve: `-1` on a
 * home directory would ask about every directory on the disk — each one a process
 * started at once, so a `-1` scan is bounded only by the operating system's limit on
 * running processes, past which a probe fails to start and the whole scan surfaces as
 * the one error row E17 uses, not as a partial answer. That is why the default is 1 and
 * why the setting exists; PR 8's description of it says so.
 *
 * A candidate outside any repository is skipped, not an error: git exits non-zero there
 * ("fatal: not a git repository"), so `tryRun` answers `null`, and a parent folder is
 * expected to be exactly that. A folder that no longer exists on disk is skipped the same
 * way. But if git itself cannot run (E17), the rejection is left to propagate —
 * `Promise.all` rejects as soon as any probe does — because "no repositories" would be
 * the wrong answer to "git is missing"; the tree shows one error node for that instead.
 */
// see primer §6 (async / await), §13 (a default parameter), §21 (Set), §22 (for ... of),
// §23 (string methods) and §37 (Promise.all)
export async function discoverRepoRoots(
  folders: string[],
  git: GitRunner,
  options: DiscoveryOptions = DEFAULT_DISCOVERY_OPTIONS,
): Promise<string[]> {
  // Every directory to ask git about, in the order the answers must come back: each
  // workspace folder, then what the scan finds below it, before the next folder.
  const candidates: string[] = [];
  for (const folder of folders) {
    const below = await listCandidates(folder, options);
    for (const candidate of below) {
      candidates.push(candidate);
    }
  }

  // Start every probe now, wait for all of them, then read the answers in candidate
  // order. Each answer is the root git found, or `null`: git ran and said "not a
  // repository", or the directory is gone (core/model.ts, tryRun).
  // see primer §25 (arrays: map) and §37 (Promise.all)
  const probes = candidates.map((candidate) => git.tryRun(['rev-parse', '--show-toplevel'], candidate));
  const outputs = await Promise.all(probes);

  // A Set keeps each value once and remembers the order in which values were first
  // added — exactly the two rules for the result: no duplicates (E2), candidate order kept.
  const roots = new Set<string>();
  for (const output of outputs) {
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
 * A directory waiting its turn in the scan: where it is, and how many levels below the
 * workspace folder it sits (the folder itself is 0). Not exported: only the queue in
 * listCandidates holds these.
 */
// see primer §9 (interface)
interface PendingDirectory {
  directory: string;
  depth: number;
}

/**
 * Lists the directories to ask git about for one workspace folder: the folder itself
 * first, then its subdirectories level by level — all of depth 1 in name order, then all
 * of depth 2 — down to `scanMaxDepth`. This is `traverseWorkspaceFolder` from the built-in
 * git extension with one addition: each directory's children are sorted by name, so the
 * order (and so the tree's order) is the same on every filesystem and every run — `readdir`
 * promises nothing about it.
 *
 * What is entered: directories only, by what `readdir` reports for the entry itself. So a
 * symbolic link is skipped even when it points at a directory (as the built-in extension
 * does: following links could loop, and the target is reachable through its own path);
 * so is a `.git` entry (git's own data, never a place to look for another repository);
 * and so is every name in `scanIgnoredFolders`, compared exactly. A directory that cannot
 * be read — it vanished, it is a file after all, permissions forbid it — is skipped along
 * with everything under it, but stays a candidate itself: git may still have an answer
 * for it, and a workspace folder deleted on disk is `null` from tryRun, not an error.
 * Nothing is logged: core has no logger, and an unreadable directory is not something the
 * Stack view could tell the user to fix.
 */
// see primer §38 (while loops and a queue), §16 (object literals: the queue's entries),
// §39 (fs.readdir with withFileTypes, Dirent), §40 (-1 as "no limit") and §25 (arrays:
// includes)
async function listCandidates(folder: string, options: DiscoveryOptions): Promise<string[]> {
  const candidates: string[] = [];
  // Breadth-first: the queue starts with the folder itself; each directory taken off the
  // front adds its children to the back, so a whole level is listed before the next.
  const queue: PendingDirectory[] = [{ directory: folder, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      // Cannot happen — `length > 0` was just checked — but `shift()` is typed "an element,
      // or undefined when the array is empty", and the compiler needs to be shown which.
      break;
    }
    candidates.push(current.directory);

    // Children are added only while this level is above the limit: with a limit of 1 the
    // folder (depth 0) adds its children, and those children (depth 1) add none. `-1` is
    // "no limit"; at 0 the loop never reads the disk at all.
    const childrenWanted = current.depth < options.scanMaxDepth || options.scanMaxDepth === -1;
    if (childrenWanted === false) {
      continue;
    }

    // `withFileTypes` makes each entry a Dirent — the name plus what kind of thing it is —
    // so no separate `stat` per entry is needed.
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current.directory, { withFileTypes: true });
    } catch {
      // Unreadable (see the doc comment): nothing below it. The directory itself was
      // already added above.
      continue;
    }

    const childNames: string[] = [];
    for (const entry of entries) {
      // `isDirectory()` describes the entry itself: false for a file, and false for a
      // symbolic link whatever it points at.
      if (entry.isDirectory() === false) {
        continue;
      }
      if (entry.name === '.git') {
        continue;
      }
      if (options.scanIgnoredFolders.includes(entry.name)) {
        continue;
      }
      childNames.push(entry.name);
    }
    // Sorted with an explicit comparison (primer §26) that orders by character code — the
    // same on every machine, and the order stack.ts uses for branch names. A bare `sort()`
    // would give the same order for plain strings, but the function says so out loud, and
    // SonarQube's rule S2871 flags the bare call because the trap is so common elsewhere.
    childNames.sort(compareByName);
    for (const name of childNames) {
      queue.push({ directory: path.join(current.directory, name), depth: current.depth + 1 });
    }
  }
  return candidates;
}

/**
 * Orders two folder names by character code, the way `<` and `>` compare strings: plain,
 * identical on every machine and in every locale, and the same tie-break core/stack.ts
 * uses for branch names, so a folder and the branch named after it sort alike.
 * `localeCompare`, the usual suggestion, would follow the user's language rules instead —
 * friendlier for display, but different from machine to machine, and the tree should not
 * reorder because a laptop changed locale.
 */
// see primer §26 (sort and comparison functions)
function compareByName(first: string, second: string): number {
  if (first < second) {
    return -1;
  }
  if (first > second) {
    return 1;
  }
  return 0;
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
