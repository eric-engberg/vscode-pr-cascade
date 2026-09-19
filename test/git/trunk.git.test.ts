/**
 * test/git/trunk.git.test.ts — detectTrunk against real repositories: six fixtures built
 * once in beforeAll (each `let` below says what its repository is for).
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git in a throwaway
 * directory, no VS Code). The unit tests pin the order and the exact commands; these
 * check that real git, on real refs, gives the answers the order assumes. Depends on:
 * src/core/trunk.ts, src/core/git.ts. Plan: §10.1 item 4, §5 "Trunk auto-detect", §7.3,
 * §8 E4/E25, §9.1 "hermetic".
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RealGitRunner } from '../../src/core/git';
import { detectTrunk } from '../../src/core/trunk';
import type { TrunkOptions } from '../../src/core/trunk';

// Everything lives under one throwaway directory, removed in afterAll.
let scratchDir: string;
// A clone-like repository: bare origin, origin/HEAD → origin/main, plus a second remote
// named `upstream` pointing at the same bare repository, and a tag that points at a tree.
let clonedDir: string;
// Same, but with origin/HEAD deleted (older git never creates it on fetch; newer git does,
// so the fixture removes it explicitly).
let noOriginHeadDir: string;
// The remote renamed master → main after this repository fetched; origin/HEAD is stale.
let renamedDir: string;
// No remote; the one branch is master.
let masterOnlyDir: string;
// No remote; the one branch is main (E25).
let noRemoteDir: string;
// No remote; the one branch is called trunk — neither main nor master exists (E4).
let noTrunkDir: string;

const git = new RealGitRunner();

// The default settings: prCascade.trunk empty (auto-detect), prCascade.remote "origin".
// The `: TrunkOptions` annotation holds this literal to the interface detectTrunk takes: a
// misspelled or stray key is a compile error on this line, and a field added to the
// interface later is reported here, once, rather than at every call below.
// see primer §9 (an object literal that satisfies an interface) and §16 (a type
// annotation on an object literal)
const AUTO_DETECT: TrunkOptions = { configured: '', remote: 'origin' };

/**
 * Creates a repository at `dir` with one commit on `branch`. Inline, as in
 * test/git/discovery.git.test.ts, rather than the fixture builder
 * (test/helpers/fixture.ts): the builder makes a stack on `main` or `master`, and the
 * repositories here need a branch called `trunk`, a second remote, and `origin/HEAD`
 * pointers set by hand.
 */
// see primer §6 (async / await)
async function initRepoWithOneCommit(dir: string, branch: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await git.run(['init', '-q', '-b', branch], dir);
  await fs.writeFile(path.join(dir, 'README'), 'fixture\n');
  await git.run(['add', 'README'], dir);
  // `-c commit.gpgsign=false`: never wait on a signing key, whatever the machine is set to.
  await git.run(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base'], dir);
}

/**
 * Gives the repository at `repoDir` a remote called `remoteName`: a bare copy of itself
 * next to it (the way plan Appendix A builds "origin"), registered and fetched, so
 * `refs/remotes/<remoteName>/<branch>` exists. Returns the bare repository's path.
 *
 * What it deliberately does not do is decide whether `<remoteName>/HEAD` exists. Older
 * git never touches that pointer on fetch; git 2.48 and later create it when it is
 * missing (or dangling). Each fixture below sets, deletes or overwrites the pointer
 * explicitly, so the tests mean the same thing on every git version.
 */
async function addBareRemote(repoDir: string, remoteName: string): Promise<string> {
  const bareDir = `${repoDir}-${remoteName}.git`;
  await git.run(['clone', '-q', '--bare', repoDir, bareDir], repoDir);
  await git.run(['remote', 'add', remoteName, bareDir], repoDir);
  await git.run(['fetch', '-q', remoteName], repoDir);
  return bareDir;
}

// see primer §5 (arrow functions)
beforeAll(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-trunk-test-'));
  // Hermetic git, exactly as in git.git.test.ts: git never reads the developer's own
  // config and never writes it; vi.unstubAllEnvs in afterAll restores every variable.
  vi.stubEnv('HOME', scratchDir);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_AUTHOR_NAME', 'PR Cascade tests');
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'tests@example.invalid');
  vi.stubEnv('GIT_COMMITTER_NAME', 'PR Cascade tests');
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'tests@example.invalid');

  // A clone: origin/HEAD → origin/main. `remote set-head <remote> <branch>` writes the
  // pointer the way `git clone` would have; a second remote, `upstream`, gets one too.
  clonedDir = path.join(scratchDir, 'cloned');
  await initRepoWithOneCommit(clonedDir, 'main');
  await addBareRemote(clonedDir, 'origin');
  await git.run(['remote', 'set-head', 'origin', 'main'], clonedDir);
  await addBareRemote(clonedDir, 'upstream');
  await git.run(['remote', 'set-head', 'upstream', 'main'], clonedDir);
  // A tag on a tree, not a commit (`main^{tree}` is the tree main's commit points at):
  // a name rev-parse resolves but nothing could count commits against.
  await git.run(['tag', 'tree-only', 'main^{tree}'], clonedDir);

  // No origin/HEAD: `--delete` removes the pointer whether or not fetch created it.
  noOriginHeadDir = path.join(scratchDir, 'no-origin-head');
  await initRepoWithOneCommit(noOriginHeadDir, 'main');
  await addBareRemote(noOriginHeadDir, 'origin');
  await git.run(['remote', 'set-head', 'origin', '--delete'], noOriginHeadDir);

  // The rename. Start on master with origin/HEAD → origin/master, as an older clone
  // would be. Then the remote renames its branch (on GitHub: Settings → Branches →
  // rename) and this repository fetches with --prune: origin/master disappears and
  // origin/main appears. What happens to origin/HEAD depends on the git version — before
  // 2.48 it is left dangling at the branch that is gone; 2.48 and later re-create it
  // during that same fetch — so the dangling pointer is written explicitly afterwards.
  // (`git symbolic-ref <pointer> <target>` does not require the target to exist.) The
  // fixture then means the same thing on every git version.
  renamedDir = path.join(scratchDir, 'renamed');
  await initRepoWithOneCommit(renamedDir, 'master');
  const renamedOriginDir = await addBareRemote(renamedDir, 'origin');
  await git.run(['remote', 'set-head', 'origin', 'master'], renamedDir);
  await git.run(['branch', '-m', 'master', 'main'], renamedOriginDir);
  await git.run(['symbolic-ref', 'HEAD', 'refs/heads/main'], renamedOriginDir);
  await git.run(['fetch', '-q', '--prune', 'origin'], renamedDir);
  await git.run(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master'], renamedDir);
  // The test below is about exactly this state, so prove it here: a throw in beforeAll
  // fails every test in the file with this message.
  const staleTarget = await git.tryRun(['rev-parse', '--verify', '--quiet', 'origin/master'], renamedDir);
  if (staleTarget !== null) {
    throw new Error('expected origin/master to be pruned in the renamed fixture');
  }

  masterOnlyDir = path.join(scratchDir, 'master-only');
  await initRepoWithOneCommit(masterOnlyDir, 'master');

  noRemoteDir = path.join(scratchDir, 'no-remote');
  await initRepoWithOneCommit(noRemoteDir, 'main');

  noTrunkDir = path.join(scratchDir, 'no-trunk');
  await initRepoWithOneCommit(noTrunkDir, 'trunk');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(scratchDir, { recursive: true, force: true });
});

describe('detectTrunk (real git)', () => {
  describe('auto-detect', () => {
    it('returns origin/main from origin/HEAD in a clone (the remote default branch)', async () => {
      // arrange: nothing beyond the fixture — origin/HEAD → origin/main

      // act
      const trunk = await detectTrunk(git, clonedDir, AUTO_DETECT);

      // assert: the remote-tracking name, not the local `main`
      expect(trunk).toBe('origin/main');
    });

    it('returns origin/main from the remote-tracking branch when origin/HEAD is absent', async () => {
      // arrange: nothing beyond the fixture — no pointer, but origin/main was fetched

      // act
      const trunk = await detectTrunk(git, noOriginHeadDir, AUTO_DETECT);

      // assert
      expect(trunk).toBe('origin/main');
    });

    it('moves past a stale origin/HEAD after the remote renamed master to main', async () => {
      // arrange: nothing beyond the fixture — origin/HEAD → origin/master, which is gone

      // act
      const trunk = await detectTrunk(git, renamedDir, AUTO_DETECT);

      // assert: never `origin/master` — a name that no longer resolves would make every
      // later git command fail
      expect(trunk).toBe('origin/main');
    });

    it('returns master in a master-only repository with no remote', async () => {
      // arrange: nothing beyond the fixture

      // act
      const trunk = await detectTrunk(git, masterOnlyDir, AUTO_DETECT);

      // assert
      expect(trunk).toBe('master');
    });

    it('returns the local main when the repository has no remote (E25)', async () => {
      // arrange: nothing beyond the fixture — refs/remotes/ does not exist at all

      // act
      const trunk = await detectTrunk(git, noRemoteDir, AUTO_DETECT);

      // assert
      expect(trunk).toBe('main');
    });

    it('returns null when neither main nor master exists (E4)', async () => {
      // arrange: nothing beyond the fixture — the only branch is `trunk`

      // act
      const trunk = await detectTrunk(git, noTrunkDir, AUTO_DETECT);

      // assert
      expect(trunk).toBeNull();
    });

    it('reads the remote named by prCascade.remote', async () => {
      // arrange: nothing beyond the fixture — `upstream` has its own HEAD pointer

      // act
      const trunk = await detectTrunk(git, clonedDir, { configured: '', remote: 'upstream' });

      // assert
      expect(trunk).toBe('upstream/main');
    });
  });

  describe('with prCascade.trunk set', () => {
    it('returns the configured ref when it is a branch that exists', async () => {
      // arrange: the repository whose branch is called `trunk` — the setting is how the
      // user tells the extension so

      // act
      const trunk = await detectTrunk(git, noTrunkDir, { configured: 'trunk', remote: 'origin' });

      // assert
      expect(trunk).toBe('trunk');
    });

    it('accepts a remote-tracking branch as the configured ref', async () => {
      // arrange: nothing beyond the fixture

      // act
      const trunk = await detectTrunk(git, clonedDir, { configured: 'origin/main', remote: 'origin' });

      // assert
      expect(trunk).toBe('origin/main');
    });

    it('returns null for a configured ref that does not exist, even though auto-detection would succeed (E4)', async () => {
      // arrange: the clone has origin/HEAD, but the user asked for a branch that is not there

      // act
      const trunk = await detectTrunk(git, clonedDir, { configured: 'develop', remote: 'origin' });

      // assert
      expect(trunk).toBeNull();
    });

    it('returns null for a configured ref that names a tree, not a commit (E4)', async () => {
      // arrange: nothing beyond the fixture — the tag `tree-only` points at a tree

      // act
      const trunk = await detectTrunk(git, clonedDir, { configured: 'tree-only', remote: 'origin' });

      // assert: `rev-parse --verify` alone would have said yes; `^{commit}` says no, and
      // null is better than a trunk every later command would choke on
      expect(trunk).toBeNull();
    });
  });
});
