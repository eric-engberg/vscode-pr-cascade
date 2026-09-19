/**
 * test/unit/discovery.test.ts — discoverRepoRoots as a specification, checked against
 * FakeGitRunner.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on:
 * src/core/discovery.ts, test/helpers/fakeGit.ts. The scan below the workspace folders
 * needs real directories for `readdir`, so the second block builds a small layout in a
 * temporary directory — still no git: the fake answers by path. Symlinks to repositories
 * and worktrees live in test/git/discovery.git.test.ts. Plan: §10.1 item 3, §6, §13.4,
 * §9.4.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverRepoRoots } from '../../src/core/discovery';
import type { DiscoveryOptions } from '../../src/core/discovery';
import { FakeGitRunner } from '../helpers/fakeGit';

// The one command discovery runs: as the fake keys it (args joined by spaces), and as
// the argument list discovery passes to the runner.
// see primer §4 (const)
const SHOW_TOPLEVEL_KEY = 'rev-parse --show-toplevel';
const SHOW_TOPLEVEL_ARGS = ['rev-parse', '--show-toplevel'];

// Depth 0 with nothing ignored: only the workspace folders themselves — how M1 first
// shipped, and the up direction on its own.
const FOLDERS_ONLY: DiscoveryOptions = { scanMaxDepth: 0, scanIgnoredFolders: [] };

// The fake answers `rev-parse --show-toplevel` with canned roots, so every rule in
// core/discovery.ts is checked without a repository: a subfolder resolves to the root
// above it (E1b — plan §8's E1 row is being split: E1 is now the repository below a
// folder, E1b the folder inside a repository; the retitled test in
// test/git/discovery.git.test.ts says why), one entry per repository (E2), folders
// outside any repository are skipped, workspace order is kept, only git's newline is
// removed from the path, and a failure of git itself is not hidden (E17). None of the
// paths here exist on disk, which is itself the test of two fallbacks: `realpath` fails
// and the path git printed is kept, and `readdir` fails so the scan asks about the folder
// itself and nothing below it — every test here runs with the default options (depth 1)
// and sees exactly one probe per folder because of that.
// see primer §5 (arrow functions) and §6 (async / await)
describe('discoverRepoRoots', () => {
  it('resolves a workspace folder nested inside a repository to that repository root (E1b)', async () => {
    // arrange: VS Code has /work/app/src open; git walks up from there and finds /work/app
    // see primer §19 (Map)
    const git = new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, '/work/app\n']]));

    // act
    const roots = await discoverRepoRoots(['/work/app/src'], git);

    // assert
    expect(roots).toEqual(['/work/app']);
  });

  it('runs `rev-parse --show-toplevel` once per folder, in that folder, in workspace order', async () => {
    // arrange
    const git = new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, '/work/app\n']]));

    // act
    await discoverRepoRoots(['/work/app/src', '/work/app/docs'], git);

    // assert
    expect(git.calls).toEqual([
      { args: SHOW_TOPLEVEL_ARGS, cwd: '/work/app/src' },
      { args: SHOW_TOPLEVEL_ARGS, cwd: '/work/app/docs' },
    ]);
  });

  it('lists a repository once when several folders belong to it (E2)', async () => {
    // arrange: the root itself and two subfolders of it are all open in the workspace
    const git = new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, '/work/app\n']]));

    // act
    const roots = await discoverRepoRoots(['/work/app/src', '/work/app', '/work/app/docs'], git);

    // assert
    expect(roots).toEqual(['/work/app']);
  });

  it('skips a folder that is not inside any repository', async () => {
    // arrange: an Error as the canned value is "git exited non-zero" — here exit 128,
    // "fatal: not a git repository"
    const notARepo = new Error('fatal: not a git repository');
    const git = new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, notARepo]]));

    // act
    const roots = await discoverRepoRoots(['/work/notes'], git);

    // assert
    expect(roots).toEqual([]);
  });

  it('keeps the repositories and drops the plain folders when a workspace mixes them', async () => {
    // arrange: everywhere is "not a repository", except inside /work/app
    const notARepo = new Error('fatal: not a git repository');
    const git = new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, notARepo]]));
    git.answerIn('/work/app/src', SHOW_TOPLEVEL_ARGS, '/work/app\n');

    // act
    const roots = await discoverRepoRoots(['/work/notes', '/work/app/src', '/work/downloads'], git);

    // assert
    expect(roots).toEqual(['/work/app']);
  });

  it('returns an empty list, and runs no git command, for an empty workspace', async () => {
    // arrange: nothing canned, so any git call at all would throw
    const git = new FakeGitRunner(new Map());

    // act
    const roots = await discoverRepoRoots([], git);

    // assert
    expect(roots).toEqual([]);
    expect(git.calls).toEqual([]);
  });

  it('keeps workspace order, not alphabetical order, for several repositories', async () => {
    // arrange: two repositories, opened "beta" before "alpha"
    const git = new FakeGitRunner(new Map());
    git.answerIn('/work/beta', SHOW_TOPLEVEL_ARGS, '/work/beta\n');
    git.answerIn('/work/alpha', SHOW_TOPLEVEL_ARGS, '/work/alpha\n');

    // act
    const roots = await discoverRepoRoots(['/work/beta', '/work/alpha'], git);

    // assert
    expect(roots).toEqual(['/work/beta', '/work/alpha']);
  });

  it('keeps a repeated repository at the position it was first seen (E2)', async () => {
    // arrange: beta, then alpha, then a second folder inside beta
    const git = new FakeGitRunner(new Map());
    git.answerIn('/work/beta/src', SHOW_TOPLEVEL_ARGS, '/work/beta\n');
    git.answerIn('/work/alpha', SHOW_TOPLEVEL_ARGS, '/work/alpha\n');
    git.answerIn('/work/beta/docs', SHOW_TOPLEVEL_ARGS, '/work/beta\n');

    // act
    const roots = await discoverRepoRoots(['/work/beta/src', '/work/alpha', '/work/beta/docs'], git);

    // assert
    expect(roots).toEqual(['/work/beta', '/work/alpha']);
  });

  it('strips a trailing slash, so /work/app/ and /work/app count as one repository (E2)', async () => {
    // arrange: git never prints the slash itself; this pins the normalization rule
    const git = new FakeGitRunner(new Map());
    git.answerIn('/work/app/src', SHOW_TOPLEVEL_ARGS, '/work/app/\n');
    git.answerIn('/work/app/docs', SHOW_TOPLEVEL_ARGS, '/work/app\n');

    // act
    const roots = await discoverRepoRoots(['/work/app/src', '/work/app/docs'], git);

    // assert
    expect(roots).toEqual(['/work/app']);
  });

  it('leaves the filesystem root "/" alone rather than stripping it to nothing', async () => {
    // arrange: a repository at the very top of the filesystem. `/etc` exists, so its
    // subdirectories would be probed too — depth 0 keeps this test about the one rule.
    const git = new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, '/\n']]));

    // act
    const roots = await discoverRepoRoots(['/etc'], git, FOLDERS_ONLY);

    // assert
    expect(roots).toEqual(['/']);
  });

  it('removes only the newline git prints, so a root whose name ends in a space keeps it', async () => {
    // arrange: a repository at "/work/app " — the trailing space is part of the name. git
    // prints it as it is and then one newline; trim() would have eaten both.
    const git = new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, '/work/app \n']]));

    // act
    const roots = await discoverRepoRoots(['/work/app '], git);

    // assert
    expect(roots).toEqual(['/work/app ']);
  });

  it('uses the output as it is when there is no trailing newline to remove', async () => {
    // arrange: real git always ends the line, but the code only removes a newline that is
    // there — it never takes a character off blindly
    const git = new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, '/work/app']]));

    // act
    const roots = await discoverRepoRoots(['/work/app/src'], git);

    // assert
    expect(roots).toEqual(['/work/app']);
  });

  it('keeps the path git printed when it cannot be resolved on disk', async () => {
    // arrange: /work/app does not exist on this machine, so fs.realpath fails and the
    // fallback keeps git's answer — which is also what lets every test in this file use
    // made-up paths at all
    const git = new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, '/work/app\n']]));

    // act
    const roots = await discoverRepoRoots(['/work/app'], git);

    // assert
    expect(roots).toEqual(['/work/app']);
  });

  it('still asks git about a folder that cannot be read, and about nothing below it', async () => {
    // arrange: /work/gone does not exist, so readdir fails; git is asked anyway (the real
    // runner answers null for a missing directory — core/model.ts, tryRun) and the scan
    // stops there
    const notARepo = new Error('fatal: not a git repository');
    const git = new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, notARepo]]));

    // act
    const roots = await discoverRepoRoots(['/work/gone'], git);

    // assert
    expect(roots).toEqual([]);
    expect(git.calls).toEqual([{ args: SHOW_TOPLEVEL_ARGS, cwd: '/work/gone' }]);
  });

  it('rejects instead of answering "no repositories" when the runner itself fails (E17)', async () => {
    // arrange: nothing is canned, so the fake throws from tryRun — the way the real runner
    // does when git is missing: a throw, never a null
    const git = new FakeGitRunner(new Map());

    // act
    const result = discoverRepoRoots(['/work/app'], git);

    // assert
    await expect(result).rejects.toThrow('no canned output');
  });
});

// The down direction (plan §13.4) needs real directories for `readdir` to find. One
// layout is built once in a temporary directory, and the fake git answers by exact path,
// so *which directories were asked* — `git.calls` — is the assertion in most tests here.
// The fake cannot tell a repository from a plain folder; the real-git tests do that part.
//
//   parent/
//     alpha/             answered as a repository where a test needs one
//       b/
//         c/
//     zulu/
//     node_modules/
//       dep/
//     .git/              a directory named .git: never entered
//     link-to-alpha ->   alpha (a symbolic link: never entered)
//     notes.txt          a file: never a candidate
//   second/              a second workspace folder
//     one/
describe('discoverRepoRoots (scanning below the workspace folders)', () => {
  // see primer §4 (const: `let x: T;` declare-then-assign)
  let scratchDir: string;
  let parentDir: string;
  let secondDir: string;

  // What the fake says everywhere no answer is canned for the exact path.
  const NOT_A_REPO = new Error('fatal: not a git repository');

  /** The directories discovery asked git about, in the order it asked. */
  function probedDirectories(git: FakeGitRunner): string[] {
    // see primer §25 (arrays: map)
    return git.calls.map((call) => call.cwd);
  }

  /** A fake that knows every directory here is "not a repository" unless told otherwise. */
  function fakeGitWithNoRepositories(): FakeGitRunner {
    return new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, NOT_A_REPO]]));
  }

  beforeAll(async () => {
    const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-discovery-unit-'));
    // The physical path (macOS: /private/var/..., not /var/...), so the paths canned with
    // answerIn are the very strings discovery builds with path.join, and so a canned root
    // comes back unchanged from normalizeRoot's realpath.
    scratchDir = await fs.realpath(temporaryDir);
    parentDir = path.join(scratchDir, 'parent');
    secondDir = path.join(scratchDir, 'second');
    // `recursive` creates the missing parents on the way, like `mkdir -p`. zulu is created
    // before alpha on purpose: the order discovery lists them must come from the names.
    await fs.mkdir(path.join(parentDir, 'zulu'), { recursive: true });
    await fs.mkdir(path.join(parentDir, 'alpha', 'b', 'c'), { recursive: true });
    await fs.mkdir(path.join(parentDir, 'node_modules', 'dep'), { recursive: true });
    await fs.mkdir(path.join(parentDir, '.git'));
    await fs.symlink(path.join(parentDir, 'alpha'), path.join(parentDir, 'link-to-alpha'));
    await fs.writeFile(path.join(parentDir, 'notes.txt'), 'not a directory\n');
    await fs.mkdir(path.join(secondDir, 'one'), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(scratchDir, { recursive: true, force: true });
  });

  it('asks only about the workspace folder itself at depth 0 — how M1 first shipped', async () => {
    // arrange
    const git = fakeGitWithNoRepositories();

    // act
    await discoverRepoRoots([parentDir], git, FOLDERS_ONLY);

    // assert: one probe, no readdir
    expect(probedDirectories(git)).toEqual([parentDir]);
  });

  it('finds a repository one level below a folder that is not one itself, at depth 1 (E1)', async () => {
    // arrange: the parent is a plain folder; alpha, inside it, is a repository
    const git = fakeGitWithNoRepositories();
    const alphaDir = path.join(parentDir, 'alpha');
    git.answerIn(alphaDir, SHOW_TOPLEVEL_ARGS, alphaDir + '\n');

    // act
    const roots = await discoverRepoRoots([parentDir], git, { scanMaxDepth: 1, scanIgnoredFolders: [] });

    // assert
    expect(roots).toEqual([alphaDir]);
  });

  it('scans one level and skips node_modules when called without options — the defaults', async () => {
    // arrange
    const git = fakeGitWithNoRepositories();

    // act: no third argument, so DEFAULT_DISCOVERY_OPTIONS applies
    await discoverRepoRoots([parentDir], git);

    // assert: the parent and its two plain subdirectories, in name order; not
    // node_modules, not .git, not the link, not the file, nothing two levels down
    expect(probedDirectories(git)).toEqual([parentDir, path.join(parentDir, 'alpha'), path.join(parentDir, 'zulu')]);
  });

  it('does not ask about the second level at depth 1', async () => {
    // arrange
    const git = fakeGitWithNoRepositories();

    // act
    await discoverRepoRoots([parentDir], git, { scanMaxDepth: 1, scanIgnoredFolders: [] });

    // assert
    expect(probedDirectories(git)).not.toContain(path.join(parentDir, 'alpha', 'b'));
  });

  it('asks about the second level at depth 2, and not the third', async () => {
    // arrange
    const git = fakeGitWithNoRepositories();

    // act
    await discoverRepoRoots([parentDir], git, { scanMaxDepth: 2, scanIgnoredFolders: [] });

    // assert
    const probed = probedDirectories(git);
    expect(probed).toContain(path.join(parentDir, 'alpha', 'b'));
    expect(probed).not.toContain(path.join(parentDir, 'alpha', 'b', 'c'));
  });

  it('asks about every level at depth -1', async () => {
    // arrange
    const git = fakeGitWithNoRepositories();

    // act
    await discoverRepoRoots([parentDir], git, { scanMaxDepth: -1, scanIgnoredFolders: [] });

    // assert: the deepest directory there is
    expect(probedDirectories(git)).toContain(path.join(parentDir, 'alpha', 'b', 'c'));
  });

  it('never enters a directory whose name is in scanIgnoredFolders', async () => {
    // arrange
    const git = fakeGitWithNoRepositories();

    // act
    await discoverRepoRoots([parentDir], git, { scanMaxDepth: -1, scanIgnoredFolders: ['node_modules'] });

    // assert: neither node_modules itself nor anything under it
    const probed = probedDirectories(git);
    expect(probed).not.toContain(path.join(parentDir, 'node_modules'));
    expect(probed).not.toContain(path.join(parentDir, 'node_modules', 'dep'));
  });

  it('takes the ignored names from the options, not from a built-in list', async () => {
    // arrange: alpha ignored instead; node_modules is then an ordinary directory
    const git = fakeGitWithNoRepositories();

    // act
    await discoverRepoRoots([parentDir], git, { scanMaxDepth: 1, scanIgnoredFolders: ['alpha'] });

    // assert
    const probed = probedDirectories(git);
    expect(probed).not.toContain(path.join(parentDir, 'alpha'));
    expect(probed).toContain(path.join(parentDir, 'node_modules'));
  });

  it('never enters a directory named .git', async () => {
    // arrange: parent/.git is a directory here — git's own data in a real repository
    const git = fakeGitWithNoRepositories();

    // act
    await discoverRepoRoots([parentDir], git, { scanMaxDepth: -1, scanIgnoredFolders: [] });

    // assert
    expect(probedDirectories(git)).not.toContain(path.join(parentDir, '.git'));
  });

  it('does not follow a symbolic link, even one that points at a directory', async () => {
    // arrange: link-to-alpha -> alpha
    const git = fakeGitWithNoRepositories();

    // act
    await discoverRepoRoots([parentDir], git, { scanMaxDepth: -1, scanIgnoredFolders: [] });

    // assert: alpha is reached by its own name; the link is not a second way in
    expect(probedDirectories(git)).not.toContain(path.join(parentDir, 'link-to-alpha'));
  });

  it('never treats a file as a candidate', async () => {
    // arrange: notes.txt is a file
    const git = fakeGitWithNoRepositories();

    // act
    await discoverRepoRoots([parentDir], git, { scanMaxDepth: -1, scanIgnoredFolders: [] });

    // assert
    expect(probedDirectories(git)).not.toContain(path.join(parentDir, 'notes.txt'));
  });

  it("asks in workspace order, then each folder's children in name order", async () => {
    // arrange: second before parent in the workspace; parent's children were created
    // zulu-first
    const git = fakeGitWithNoRepositories();

    // act
    await discoverRepoRoots([secondDir, parentDir], git);

    // assert
    expect(probedDirectories(git)).toEqual([
      secondDir,
      path.join(secondDir, 'one'),
      parentDir,
      path.join(parentDir, 'alpha'),
      path.join(parentDir, 'zulu'),
    ]);
  });

  it('lists a repository once when the folder and its subdirectories all answer with it (E2)', async () => {
    // arrange: the parent is itself a repository, so git answers the same root from
    // inside alpha and zulu — the accepted cost of scanning below a repository
    const git = fakeGitWithNoRepositories();
    git.answerIn(parentDir, SHOW_TOPLEVEL_ARGS, parentDir + '\n');
    git.answerIn(path.join(parentDir, 'alpha'), SHOW_TOPLEVEL_ARGS, parentDir + '\n');
    git.answerIn(path.join(parentDir, 'zulu'), SHOW_TOPLEVEL_ARGS, parentDir + '\n');

    // act
    const roots = await discoverRepoRoots([parentDir], git);

    // assert
    expect(roots).toEqual([parentDir]);
  });

  it('rejects instead of answering "no repositories" when a probe below the folder fails to start (E17)', async () => {
    // arrange: an answer for the parent only; the first child probe has none and throws,
    // as the real runner does when git is missing — Promise.all passes that on
    const git = new FakeGitRunner(new Map());
    git.answerIn(parentDir, SHOW_TOPLEVEL_ARGS, NOT_A_REPO);

    // act
    const result = discoverRepoRoots([parentDir], git);

    // assert
    await expect(result).rejects.toThrow('no canned output');
  });
});
