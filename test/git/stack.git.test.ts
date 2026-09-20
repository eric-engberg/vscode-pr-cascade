/**
 * test/git/stack.git.test.ts — computeStack against real repositories built by the fixture
 * builder: the plan Appendix A stack as it is, then each plan §8 situation git can be put
 * into. The unit tests pin the commands and the rules; these check that real git gives
 * the answers the rules assume. Layer: test, git integration (plan §9.1 layer 2; Vitest,
 * real git in throwaway directories, no VS Code). Depends on: src/core/stack.ts,
 * src/core/git.ts, test/helpers/fixture.ts. Plan: §10.1 item 5, §8, §9.3, §9.4 row
 * "git/stack.git.test.ts", Appendix A.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RealGitRunner } from '../../src/core/git';
import { computeStack } from '../../src/core/stack';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';

// The trunk every fixture has: buildStack creates a bare origin and fetches it, so this is
// exactly what detectTrunk (PR 4) would answer for these repositories.
// see primer §4 (const)
const TRUNK = 'origin/main';

// `git` is the runner under test: it spawns git with process.env, so the hermetic variables
// are stubbed on process.env for the whole file. `fixture.git(...)`, seen alongside it in
// every test, is the fixture builder's synchronous helper (with its own environment; see
// its header), used only to set a situation up and to ask git for the expected answers.
const git = new RealGitRunner();

// A throwaway directory that stands in for HOME, so git never finds the developer's own
// ~/.gitconfig. Removed in afterAll.
let homeDir: string;

// see primer §5 (arrow functions) and §6 (async / await)
beforeAll(async () => {
  homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-stack-test-'));
  // Hermetic git, exactly as in git.git.test.ts; vi.unstubAllEnvs in afterAll restores
  // every variable.
  vi.stubEnv('HOME', homeDir);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_AUTHOR_NAME', 'PR Cascade tests');
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'tests@example.invalid');
  vi.stubEnv('GIT_COMMITTER_NAME', 'PR Cascade tests');
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'tests@example.invalid');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.promises.rm(homeDir, { recursive: true, force: true });
});

// The situations, one `describe` each: the Appendix A stack with an unrelated stack beside
// it (E16) and a linked worktree (E19); HEAD on trunk (E5); a detached HEAD (E3); two
// branches on one commit (E6); an amended bottom layer (E14); a squash-merged bottom layer
// (E15); and one §8 does not list, a tag with the same name as a branch. The E14 and E15
// blocks document what the tree will show until git-spice's restack and sync (M9) repair
// the stack. Each block builds its own fixture in `beforeAll` and removes it in `afterAll`,
// so the situations never leak into one another: an amended layer in one block cannot
// change what the next block sees, whatever order the tests run in.
describe('computeStack (real git)', () => {
  describe('the Appendix A stack', () => {
    let fixture: Fixture;
    // A second working directory of the same repository, checked out on the middle layer
    // (E19). Created beside the repository, inside the fixture's scratch directory, so
    // `fixture.cleanup()` removes it too.
    let worktreeDir: string;

    beforeAll(() => {
      fixture = buildStack();
      // A branch off trunk that is not part of the stack (E16): `other-work`.
      fixture.addUnrelatedStack();
      // `worktree add <dir> <branch>` checks `add-retries` out in a second directory;
      // git refuses to check out a branch that is already checked out elsewhere, which
      // is why it is the middle layer and not `retry-metrics`. Its `.git` is a one-line
      // file pointing back into the repository, not a directory.
      worktreeDir = path.join(path.dirname(fixture.dir), 'worktree');
      fixture.git(['worktree', 'add', '-q', worktreeDir, 'add-retries']);
      // The E19 tests are about exactly that layout, so prove it here: a throw in
      // beforeAll fails every test in the block with this message.
      // see primer §28 (the Sync variants of Node's functions)
      if (fs.statSync(path.join(worktreeDir, '.git')).isFile() === false) {
        throw new Error(`expected ${worktreeDir}/.git to be a file (a linked worktree), not a directory`);
      }
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('lists the three layers bottom to top: api-refactor, add-retries, retry-metrics', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      // see primer §25 (arrays: map)
      const names = state.layers.map((layer) => layer.name);
      expect(names).toEqual(['api-refactor', 'add-retries', 'retry-metrics']);
    });

    it('counts 1, 2 and 3 commits since trunk', async () => {
      // arrange: nothing beyond the fixture — one commit per layer, stacked

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      const counts = state.layers.map((layer) => layer.commitCount);
      expect(counts).toEqual([1, 2, 3]);
    });

    it('chains the parents: trunk, then each layer on the one below it', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      const parents = state.layers.map((layer) => layer.parent);
      expect(parents).toEqual([TRUNK, 'api-refactor', 'add-retries']);
    });

    it('records for each layer the SHA `git rev-parse <branch>` prints', async () => {
      // arrange: what git says each branch points at, asked directly
      const expectedShas = ['api-refactor', 'add-retries', 'retry-metrics'].map((name) =>
        fixture.git(['rev-parse', name]).trim(),
      );

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert: full 40-character SHAs, one per layer
      const shas = state.layers.map((layer) => layer.sha);
      expect(shas).toEqual(expectedShas);
      // see primer §20 (regular expression literals)
      expect(shas[0]).toMatch(/^[0-9a-f]{40}$/);
    });

    it('records each parent\'s SHA: trunk\'s for the bottom layer, the layer below for the rest', async () => {
      // arrange
      const trunkSha = fixture.git(['rev-parse', TRUNK]).trim();

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert: parentSha[i] is sha[i - 1], and trunk's SHA before that
      const parentShas = state.layers.map((layer) => layer.parentSha);
      expect(parentShas).toEqual([trunkSha, state.layers[0].sha, state.layers[1].sha]);
    });

    it('reports the branch HEAD is on and marks only that layer current', async () => {
      // arrange: nothing beyond the fixture — buildStack leaves HEAD on the top layer

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.head).toBe('retry-metrics');
      const current = state.layers.map((layer) => layer.isCurrent);
      expect(current).toEqual([false, false, true]);
    });

    it('never lists a branch that is not an ancestor of HEAD, even though it is not in trunk either (E16)', async () => {
      // arrange: `other-work` exists and has a commit trunk does not have — it is exactly
      // the kind of branch `--no-merged origin/main` alone would keep
      const unrelatedExists = fixture.git(['branch', '--list', 'other-work']).trim();
      expect(unrelatedExists).toContain('other-work');

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      const names = state.layers.map((layer) => layer.name);
      expect(names).not.toContain('other-work');
    });

    it('computes the stack from inside a linked worktree, where .git is a file (E19)', async () => {
      // arrange: nothing beyond the fixture — beforeAll checked that worktree/.git is a file

      // act
      const state = await computeStack(git, worktreeDir, TRUNK);

      // assert: the worktree's own HEAD is on add-retries, so the stack under it is the
      // two lower layers; retry-metrics is above HEAD and is not an ancestor of it
      expect(state.head).toBe('add-retries');
      const names = state.layers.map((layer) => layer.name);
      expect(names).toEqual(['api-refactor', 'add-retries']);
    });

    it('marks the worktree\'s own branch current, not the branch the main working directory is on (E19)', async () => {
      // arrange: nothing beyond the fixture — the main directory is still on retry-metrics

      // act
      const state = await computeStack(git, worktreeDir, TRUNK);

      // assert
      const current = state.layers.map((layer) => layer.isCurrent);
      expect(current).toEqual([false, true]);
    });
  });

  describe('HEAD on trunk (E5)', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      fixture.git(['checkout', '-q', 'main']);
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('returns no layers: every local branch is trunk itself or already in it', async () => {
      // arrange: nothing beyond the fixture — the three layers still exist, above HEAD

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.layers).toEqual([]);
    });

    it('still reports the branch HEAD is on, so the tree can name it', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.head).toBe('main');
    });
  });

  describe('detached HEAD (E3)', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      // HEAD now holds the top layer's commit directly, not the branch name.
      fixture.detach();
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('reports head as null', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.head).toBeNull();
    });

    it('still lists every layer, because `--merged HEAD` needs only a commit, not a branch', async () => {
      // arrange: nothing beyond the fixture — HEAD is at retry-metrics's commit

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      const names = state.layers.map((layer) => layer.name);
      expect(names).toEqual(['api-refactor', 'add-retries', 'retry-metrics']);
    });

    it('marks no layer current', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert: not even retry-metrics, whose commit HEAD is sitting on
      const current = state.layers.map((layer) => layer.isCurrent);
      expect(current).toEqual([false, false, false]);
    });
  });

  describe('two branches on one commit (E6)', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      // A second name for the bottom layer's commit: `git branch <new> <start-point>`
      // creates the branch without checking it out. Someone keeping a backup before an
      // amend does exactly this.
      fixture.git(['branch', 'api-refactor-backup', 'api-refactor']);
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('lists both, next to each other, in name order', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert: both are one commit from trunk, so the name decides
      const names = state.layers.map((layer) => layer.name);
      expect(names).toEqual(['api-refactor', 'api-refactor-backup', 'add-retries', 'retry-metrics']);
    });

    it('gives both the same commit count and the same SHA', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.layers[0].commitCount).toBe(1);
      expect(state.layers[1].commitCount).toBe(1);
      expect(state.layers[1].sha).toBe(state.layers[0].sha);
    });

    it('stacks the second on the first, so the second\'s diff against its parent is empty', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert: parent is the first name; parentSha equals its own sha — nothing between
      // them, which is E6's "second has 0 files vs first" once M2 lists files
      const backup = state.layers[1];
      expect(backup.parent).toBe('api-refactor');
      expect(backup.parentSha).toBe(backup.sha);
      expect(state.layers[2].parent).toBe('api-refactor-backup');
    });
  });

  describe('bottom layer amended (E14)', () => {
    let fixture: Fixture;
    // The bottom layer's commit before and after the amend.
    let originalBottomSha: string;
    let amendedBottomSha: string;

    beforeAll(() => {
      fixture = buildStack();
      originalBottomSha = fixture.git(['rev-parse', 'api-refactor']).trim();
      // Rewrite the bottom commit. The two layers above still sit on the *old* commit,
      // which is what "descendants now stale" means; HEAD goes back to retry-metrics.
      fixture.amend('api-refactor', 'a', 'a, fixed\n');
      amendedBottomSha = fixture.git(['rev-parse', 'api-refactor']).trim();
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('drops the amended branch from the stack, because its new commit is not an ancestor of HEAD', async () => {
      // arrange: the amend really did move the branch
      expect(amendedBottomSha).not.toBe(originalBottomSha);

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert: what git says — api-refactor is a sibling of the stack now, not its base.
      // git-spice will flag this as `needsRestack` (M5) and restack it (M9); the tree
      // renders the state, it does not hide it.
      const names = state.layers.map((layer) => layer.name);
      expect(names).toEqual(['add-retries', 'retry-metrics']);
    });

    it('counts the old bottom commit under the next layer, which now sits directly on trunk', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert: add-retries is two commits from trunk (the unnamed old A, then B) and its
      // parent is trunk — the old commit shows as part of it, not as a layer of its own
      const bottom = state.layers[0];
      expect(bottom.name).toBe('add-retries');
      expect(bottom.commitCount).toBe(2);
      expect(bottom.parent).toBe(TRUNK);
    });
  });

  describe('bottom layer squash-merged into trunk (E15)', () => {
    let fixture: Fixture;
    // Trunk's commit before the merge, to show that the merge really moved it.
    let trunkShaBeforeMerge: string;

    beforeAll(() => {
      fixture = buildStack();
      trunkShaBeforeMerge = fixture.git(['rev-parse', TRUNK]).trim();
      // What "Squash and merge" on GitHub does to the bottom PR: trunk gets one new commit
      // with api-refactor's changes, origin is pushed, the local branch is left alone.
      fixture.squashMergeBottomIntoTrunk();
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('still lists the merged layer, because the squash commit on trunk is not its commit', async () => {
      // arrange: trunk did move — origin/main is a new commit
      const trunkShaAfterMerge = fixture.git(['rev-parse', TRUNK]).trim();
      expect(trunkShaAfterMerge).not.toBe(trunkShaBeforeMerge);

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert: the same three layers as before the merge. api-refactor's own commit is
      // not an ancestor of the squash commit (same tree, different commit), so
      // `--no-merged origin/main` keeps it. git-spice's sync (M9) is what removes it.
      const names = state.layers.map((layer) => layer.name);
      expect(names).toEqual(['api-refactor', 'add-retries', 'retry-metrics']);
    });

    it('measures the stack against the moved trunk: the bottom\'s parentSha is the squash commit', async () => {
      // arrange
      const trunkShaAfterMerge = fixture.git(['rev-parse', TRUNK]).trim();

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert: parent SHA follows trunk; the counts are unchanged, because none of the
      // layers' commits are reachable from the squash commit
      expect(state.layers[0].parentSha).toBe(trunkShaAfterMerge);
      const counts = state.layers.map((layer) => layer.commitCount);
      expect(counts).toEqual([1, 2, 3]);
    });
  });

  describe('a tag with the same name as a branch', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      // Tags share git's name lookup with branches, and win it: a bare `api-refactor` now
      // means the tag, and `%(refname:short)` prints the branch as `heads/api-refactor`.
      // Both tags point at trunk's commit, so anything that reads a tag instead of its
      // branch gets trunk's SHA and a count of 0 — impossible to miss.
      fixture.git(['tag', 'api-refactor', 'main']);
      fixture.git(['tag', 'retry-metrics', 'main']);
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('lists every layer by its branch name, not as heads/<name>', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      const names = state.layers.map((layer) => layer.name);
      expect(names).toEqual(['api-refactor', 'add-retries', 'retry-metrics']);
    });

    it('reports head as the branch name, not as heads/<name>', async () => {
      // arrange: nothing beyond the fixture — HEAD is on retry-metrics, now also a tag name

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.head).toBe('retry-metrics');
    });

    it('measures the branch, not the tag: the bottom layer keeps its own SHA and its count of 1', async () => {
      // arrange: what the branch itself points at, asked by its full ref; the tag differs
      const branchSha = fixture.git(['rev-parse', 'refs/heads/api-refactor']).trim();
      const tagSha = fixture.git(['rev-parse', 'refs/tags/api-refactor']).trim();
      expect(tagSha).not.toBe(branchSha);

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert: the tag would have given trunk's SHA and a count of 0
      const bottom = state.layers[0];
      expect(bottom.sha).toBe(branchSha);
      expect(bottom.commitCount).toBe(1);
    });
  });
});
