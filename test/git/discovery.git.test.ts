/**
 * test/git/discovery.git.test.ts — discoverRepoRoots against real git on a real
 * filesystem.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git in a throwaway
 * directory, no VS Code). Depends on: src/core/discovery.ts, src/core/git.ts. Plan: §10.1
 * item 3, §6, §8 E1/E2/E19, §9.1 "hermetic".
 */

// see primer §1 (import / export)
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { discoverRepoRoots } from '../../src/core/discovery';
import { RealGitRunner } from '../../src/core/git';
import { FakeGitRunner } from '../helpers/fakeGit';

// Everything lives under one throwaway directory, removed in afterAll.
let scratchDir: string;
// The repository, a folder two levels inside it, and a symlink pointing at it.
let repoDir: string;
let nestedDir: string;
let linkToRepoDir: string;
// A linked worktree of the repository (`git worktree add`), and a folder that is no repo.
let worktreeDir: string;
let plainDir: string;
// A second repository whose directory name ends in a space.
let spaceRepoDir: string;
// What discovery must return for the repositories and the worktree: their physical paths.
// On macOS os.tmpdir() is under /var, which is a symlink to /private/var, so these differ
// from repoDir and worktreeDir — which several tests below rely on. On Linux the raw and
// physical paths are usually the same string, and those tests are then trivially true.
let physicalRepoDir: string;
let physicalWorktreeDir: string;
let physicalSpaceRepoDir: string;

const git = new RealGitRunner();

/**
 * Creates a repository with one commit at `directory`. The commit matters: `git worktree
 * add` has to check something out. Inline rather than the fixture builder
 * (test/helpers/fixture.ts) on purpose: the builder always names its repository `repo`,
 * and one repository here must have a name ending in a space. Three git calls are not
 * worth a second builder.
 */
// see primer §6 (async / await)
async function initRepoWithOneCommit(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await git.run(['init', '-q', '-b', 'main'], directory);
  await fs.writeFile(path.join(directory, 'README'), 'fixture\n');
  await git.run(['add', 'README'], directory);
  // `-c commit.gpgsign=false`: never wait on a signing key, whatever the machine is set to.
  await git.run(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base'], directory);
}

// see primer §5 (arrow functions)
beforeAll(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-discovery-test-'));
  // Hermetic git, exactly as in git.git.test.ts: git never reads the developer's own
  // config and never writes it; vi.unstubAllEnvs in afterAll restores every variable.
  vi.stubEnv('HOME', scratchDir);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_AUTHOR_NAME', 'PR Cascade tests');
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'tests@example.invalid');
  vi.stubEnv('GIT_COMMITTER_NAME', 'PR Cascade tests');
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'tests@example.invalid');

  repoDir = path.join(scratchDir, 'repo');
  await initRepoWithOneCommit(repoDir);
  physicalRepoDir = await fs.realpath(repoDir);

  nestedDir = path.join(repoDir, 'src', 'deep');
  await fs.mkdir(nestedDir, { recursive: true });

  linkToRepoDir = path.join(scratchDir, 'link-to-repo');
  await fs.symlink(repoDir, linkToRepoDir);

  // A linked worktree: a second working directory sharing the repository's history. Its
  // `.git` is a one-line file ("gitdir: ...") pointing back into repo/.git, not a
  // directory (E19). It needs a branch of its own, hence `-b`.
  worktreeDir = path.join(scratchDir, 'worktree');
  await git.run(['worktree', 'add', '-q', '-b', 'worktree-branch', worktreeDir], repoDir);
  // The E19 test is about exactly that layout, so prove it here rather than trusting git's
  // documentation: a throw in beforeAll fails every test in the file with this message.
  const worktreeDotGit = await fs.stat(path.join(worktreeDir, '.git'));
  if (worktreeDotGit.isFile() === false) {
    throw new Error(`expected ${worktreeDir}/.git to be a file (a linked worktree), not a directory`);
  }
  physicalWorktreeDir = await fs.realpath(worktreeDir);

  plainDir = path.join(scratchDir, 'plain');
  await fs.mkdir(plainDir);

  // A repository whose directory name ends in a space — legal on macOS and Linux. git
  // prints the name as it is, followed by one newline: the case discovery must not
  // "clean up" by trimming.
  spaceRepoDir = path.join(scratchDir, 'space repo ');
  await initRepoWithOneCommit(spaceRepoDir);
  physicalSpaceRepoDir = await fs.realpath(spaceRepoDir);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(scratchDir, { recursive: true, force: true });
});

// One small repository is built once for the whole file (beforeAll), with a folder nested
// inside it, a symlink pointing at it, a linked worktree, and a plain folder beside it —
// plus a second repository whose name ends in a space. The unit tests already pin the
// rules; these check what only a real filesystem can: that git really walks up (E1), that
// two spellings of one directory — through a symlink, and on macOS the `/tmp` →
// `/private/tmp` kind (here `/var` → `/private/var`, where the temp directory lives) —
// come back as one physical path (E2), that a linked worktree, where `.git` is a file, is
// found as its own root (E19), and that git really does print a trailing space in a name
// followed by exactly one newline. One thing these tests cannot show: with today's git the
// `realpath` step in `normalizeRoot` changes nothing here, because git already prints the
// physical path. The describe after this one pins that step with a git that does not.
describe('discoverRepoRoots (real git)', () => {
  it('returns the physical path of a repository root (macOS: the /var temp dir comes back as /private/var) (E2)', async () => {
    // arrange: nothing beyond the fixture — repoDir is the symlinked spelling on macOS

    // act
    const roots = await discoverRepoRoots([repoDir], git);

    // assert: compare against fs.realpath, never against the raw string
    expect(roots).toEqual([physicalRepoDir]);
  });

  it('resolves a folder nested two levels inside the repository to its root (E1)', async () => {
    // arrange: repo/src/deep is what VS Code has open, not the repository itself

    // act
    const roots = await discoverRepoRoots([nestedDir], git);

    // assert
    expect(roots).toEqual([physicalRepoDir]);
  });

  it('lists the repository once when its root and a nested folder are both open (E2)', async () => {
    // arrange: nothing beyond the fixture — the root and the folder two levels inside it

    // act
    const roots = await discoverRepoRoots([repoDir, nestedDir], git);

    // assert
    expect(roots).toEqual([physicalRepoDir]);
  });

  it('skips a folder that is not inside any repository', async () => {
    // arrange: `plain` sits next to the repository, not in it; git exits 128 there

    // act
    const roots = await discoverRepoRoots([plainDir], git);

    // assert
    expect(roots).toEqual([]);
  });

  it('skips a folder that no longer exists on disk (a stale workspace folder)', async () => {
    // arrange: never created
    const goneDir = path.join(scratchDir, 'gone');

    // act
    const roots = await discoverRepoRoots([goneDir], git);

    // assert
    expect(roots).toEqual([]);
  });

  it('keeps the repository and drops the plain folder when a workspace has both', async () => {
    // arrange: nothing beyond the fixture — the plain folder and the nested one both exist

    // act
    const roots = await discoverRepoRoots([plainDir, nestedDir], git);

    // assert
    expect(roots).toEqual([physicalRepoDir]);
  });

  it('follows a symlink to the repository and returns the physical path', async () => {
    // arrange: link-to-repo → repo

    // act
    const roots = await discoverRepoRoots([linkToRepoDir], git);

    // assert
    expect(roots).toEqual([physicalRepoDir]);
  });

  it('lists the repository once when it is open both through a symlink and directly (E2)', async () => {
    // arrange: nothing beyond the fixture — link-to-repo and repo are one directory

    // act
    const roots = await discoverRepoRoots([linkToRepoDir, repoDir], git);

    // assert
    expect(roots).toEqual([physicalRepoDir]);
  });

  it('finds a linked worktree as its own root, where .git is a file rather than a directory (E19)', async () => {
    // arrange: nothing beyond the fixture — beforeAll checked that worktree/.git is a file

    // act
    const roots = await discoverRepoRoots([worktreeDir], git);

    // assert: the worktree's own directory, not the main repository's
    expect(roots).toEqual([physicalWorktreeDir]);
  });

  it('keeps the main repository and its worktree as two separate roots, in workspace order', async () => {
    // arrange: nothing beyond the fixture — the repository and its linked worktree

    // act
    const roots = await discoverRepoRoots([repoDir, worktreeDir], git);

    // assert
    expect(roots).toEqual([physicalRepoDir, physicalWorktreeDir]);
  });

  it('keeps a trailing space in a repository name, removing only the newline git prints', async () => {
    // arrange: nothing beyond the fixture — "space repo " exists, trailing space and all

    // act
    const roots = await discoverRepoRoots([spaceRepoDir], git);

    // assert: the physical path still ends in the space. Trimming would have produced a
    // path that does not exist, and the realpath fallback would then have kept that one.
    expect(roots).toEqual([physicalSpaceRepoDir]);
  });
});

// The one test that proves discovery resolves symlinks *itself*. Real git prints the
// physical path from `--show-toplevel`, so in every test above the `realpath` call in
// `normalizeRoot` receives a path that is already resolved and hands it back unchanged —
// delete that call and they all still pass. Here a fake git prints the symlinked spelling
// instead, so only discovery's own `realpath` can turn it into the physical path. The
// fixture from `beforeAll` is reused for the one thing this needs: a real symlink on disk.
describe('discoverRepoRoots (real filesystem, fake git)', () => {
  it('resolves a symlinked spelling to the physical path itself, even when git prints the link (E2)', async () => {
    // arrange: a fake git that answers with the link, newline and all — where real git
    // would already have printed the physical path
    const fakeGit = new FakeGitRunner(new Map());
    fakeGit.answerIn(linkToRepoDir, ['rev-parse', '--show-toplevel'], linkToRepoDir + '\n');

    // act
    const roots = await discoverRepoRoots([linkToRepoDir], fakeGit);

    // assert: link-to-repo → repo, resolved by discovery rather than by git
    expect(roots).toEqual([physicalRepoDir]);
  });
});
