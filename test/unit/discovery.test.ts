/**
 * test/unit/discovery.test.ts — discoverRepoRoots as a specification, checked against
 * FakeGitRunner.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on:
 * src/core/discovery.ts, test/helpers/fakeGit.ts. Symlinks and worktrees need a real
 * filesystem and live in test/git/discovery.git.test.ts. Plan: §10.1 item 3, §6, §9.4.
 */

// see primer §1 (import / export)
import { describe, expect, it } from 'vitest';
import { discoverRepoRoots } from '../../src/core/discovery';
import { FakeGitRunner } from '../helpers/fakeGit';

// The one command discovery runs: as the fake keys it (args joined by spaces), and as
// the argument list discovery passes to the runner.
// see primer §4 (const)
const SHOW_TOPLEVEL_KEY = 'rev-parse --show-toplevel';
const SHOW_TOPLEVEL_ARGS = ['rev-parse', '--show-toplevel'];

// The fake answers `rev-parse --show-toplevel` with canned roots, so every rule in
// core/discovery.ts is checked without a repository: a subfolder resolves to the root
// above it (E1), one entry per repository (E2), folders outside any repository are
// skipped, workspace order is kept, only git's newline is removed from the path, and a
// failure of git itself is not hidden (E17). None of the paths here exist on disk, which
// is itself the test of the realpath fallback.
// see primer §5 (arrow functions) and §6 (async / await)
describe('discoverRepoRoots', () => {
  it('resolves a workspace folder nested inside a repository to that repository root (E1)', async () => {
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
    // arrange: a repository at the very top of the filesystem
    const git = new FakeGitRunner(new Map([[SHOW_TOPLEVEL_KEY, '/\n']]));

    // act
    const roots = await discoverRepoRoots(['/etc'], git);

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
