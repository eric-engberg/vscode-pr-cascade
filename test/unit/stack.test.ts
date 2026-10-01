/**
 * test/unit/stack.test.ts — computeStack as a specification, checked against
 * FakeGitRunner: which git commands it runs, in which order, and how their answers become
 * the layers of a RepoState.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on:
 * src/core/stack.ts, test/helpers/fakeGit.ts. What real git does with real branches — an
 * amended or squash-merged bottom layer, a linked worktree — needs a repository and lives
 * in test/git/stack.git.test.ts; a real paused rebase in test/git/rebase.git.test.ts. Plan:
 * §10.1 items 5 and 13a, §5 rows "Current branch", "Stack members", "Layer order", "Layer
 * SHA", "Rebase in progress", §8 E3/E5/E6/E12/E16/E17/E19, §9.4.
 */

// see primer §1 (import / export)
import { describe, expect, it } from 'vitest';
import { computeStack } from '../../src/core/stack';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository every test asks about, and the trunk detectTrunk (PR 4) would have found
// for it. Nothing here touches the disk.
// see primer §4 (const)
const ROOT = '/work/app';
const TRUNK = 'origin/main';

// The three commands computeStack runs once, as the fake keys them (args joined by spaces).
// see primer §12 (template strings)
const HEAD_KEY = 'symbolic-ref --quiet HEAD';
const REBASE_KEY = 'rev-parse --git-path rebase-merge --git-path rebase-apply';
const MEMBERS_KEY = `for-each-ref --format=%(refname:lstrip=2) refs/heads --merged HEAD --no-merged ${TRUNK}`;

// The same three, as the argument lists computeStack must pass to the runner.
const HEAD_ARGS = ['symbolic-ref', '--quiet', 'HEAD'];
const REBASE_ARGS = ['rev-parse', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply'];
const MEMBERS_ARGS = ['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads', '--merged', 'HEAD', '--no-merged', TRUNK];

// What `rev-parse --git-path` prints in an ordinary repository — one path per name asked,
// relative to the working directory — whether or not a rebase is paused: the paths are the
// same either way, and whether the directories exist is the `directoryExists` stand-in's
// answer below, never the disk's.
const REBASE_PATHS = '.git/rebase-merge\n.git/rebase-apply\n';

/** The directory check computeStack takes: in these tests always "no", so nothing is looked up on disk (the fake runner cannot fake a directory). */
// see primer §33 (function types) and §5 (arrow functions)
const NO_REBASE_DIRECTORIES = (): boolean => false;

// Trunk's SHA is asked for by the name detectTrunk gave (`origin/main`); each branch's by
// its full ref (`refs/heads/<name>`), so a tag sharing the name can never answer instead.
const TRUNK_SHA_KEY = `rev-parse ${TRUNK}`;

/** The fake's key for "how many commits since trunk?" — `rev-list --count <trunk>..refs/heads/<branch>`. */
// see primer §3 (functions and type annotations)
function countKey(branch: string): string {
  return `rev-list --count ${TRUNK}..refs/heads/${branch}`;
}

/** The fake's key for "which commit is this branch?" — `rev-parse refs/heads/<branch>`. */
function branchShaKey(branch: string): string {
  return `rev-parse refs/heads/${branch}`;
}

// Made-up SHAs, one per ref: 40 hex characters like git's, but readable in a failure.
const SHA_TRUNK = '0000000000000000000000000000000000000000';
const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SHA_C = 'cccccccccccccccccccccccccccccccccccccccc';

// An Error as the canned value means "git exited non-zero": here `symbolic-ref --quiet
// HEAD` exiting 1, silently, because HEAD is detached (E3).
const DETACHED = new Error('exit 1');

/**
 * Cans the plan Appendix A stack: HEAD on `retry-metrics` (`symbolic-ref` answers with
 * the full ref name, `refs/heads/retry-metrics`), three layers, `origin/main` as trunk.
 * git lists refs in name order, so `for-each-ref` prints `add-retries` before
 * `api-refactor` even though `api-refactor` is the bottom layer — that is what the sort in
 * computeStack is for, and why these tests never assume git's order is the stack's.
 */
// see primer §19 (Map)
function threeLayerStack(): FakeGitRunner {
  return new FakeGitRunner(
    new Map([
      [HEAD_KEY, 'refs/heads/retry-metrics\n'],
      [REBASE_KEY, REBASE_PATHS],
      [MEMBERS_KEY, 'add-retries\napi-refactor\nretry-metrics\n'],
      [countKey('api-refactor'), '1\n'],
      [countKey('add-retries'), '2\n'],
      [countKey('retry-metrics'), '3\n'],
      [branchShaKey('api-refactor'), `${SHA_A}\n`],
      [branchShaKey('add-retries'), `${SHA_B}\n`],
      [branchShaKey('retry-metrics'), `${SHA_C}\n`],
      [TRUNK_SHA_KEY, `${SHA_TRUNK}\n`],
    ]),
  );
}

/**
 * Cans the E6 situation: `api-refactor` and `api-refactor-backup` point at the same
 * commit, so both are one commit from trunk; HEAD is on `add-retries` above them. git
 * itself lists refs by name; the fake lists these two backwards on purpose, so a test
 * built on it fails if the code ever relies on git's order instead of sorting by name.
 */
function twoBranchesOnOneCommit(): FakeGitRunner {
  return new FakeGitRunner(
    new Map([
      [HEAD_KEY, 'refs/heads/add-retries\n'],
      [REBASE_KEY, REBASE_PATHS],
      [MEMBERS_KEY, 'add-retries\napi-refactor-backup\napi-refactor\n'],
      [countKey('api-refactor'), '1\n'],
      [countKey('api-refactor-backup'), '1\n'],
      [countKey('add-retries'), '2\n'],
      [branchShaKey('api-refactor'), `${SHA_A}\n`],
      [branchShaKey('api-refactor-backup'), `${SHA_A}\n`],
      [branchShaKey('add-retries'), `${SHA_B}\n`],
      [TRUNK_SHA_KEY, `${SHA_TRUNK}\n`],
    ]),
  );
}

// see primer §5 (arrow functions) and §6 (async / await)
describe('computeStack', () => {
  describe('order and parents', () => {
    it('orders layers by distance from trunk, bottom first, whatever order git listed them in', async () => {
      // arrange: for-each-ref lists add-retries first (name order); it is the middle layer
      const git = threeLayerStack();

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      // see primer §25 (arrays: map)
      const names = state.layers.map((layer) => layer.name);
      expect(names).toEqual(['api-refactor', 'add-retries', 'retry-metrics']);
    });

    it('reads each commit count from `rev-list --count <trunk>..<branch>` as a number, not text', async () => {
      // arrange
      const git = threeLayerStack();

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert: 1, 2, 3 — numbers. The strings '1', '2', '3' would fail this comparison.
      const counts = state.layers.map((layer) => layer.commitCount);
      expect(counts).toEqual([1, 2, 3]);
    });

    it('gives the bottom layer trunk as its parent, with the SHA `rev-parse <trunk>` prints', async () => {
      // arrange
      const git = threeLayerStack();

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      const bottom = state.layers[0];
      expect(bottom.parent).toBe(TRUNK);
      expect(bottom.parentSha).toBe(SHA_TRUNK);
    });

    it('chains every other layer onto the one below it, by name and by SHA', async () => {
      // arrange
      const git = threeLayerStack();

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert: the middle layer sits on the bottom one, the top on the middle
      const parents = state.layers.map((layer) => layer.parent);
      const parentShas = state.layers.map((layer) => layer.parentSha);
      expect(parents).toEqual([TRUNK, 'api-refactor', 'add-retries']);
      expect(parentShas).toEqual([SHA_TRUNK, SHA_A, SHA_B]);
    });

    it('records each layer\'s SHA from `rev-parse <branch>`, without the newline git prints', async () => {
      // arrange
      const git = threeLayerStack();

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      const shas = state.layers.map((layer) => layer.sha);
      expect(shas).toEqual([SHA_A, SHA_B, SHA_C]);
    });

    it('lists two branches on one commit next to each other, in name order (E6)', async () => {
      // arrange: the fake lists the two backwards (see the builder)
      const git = twoBranchesOnOneCommit();

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert: both listed, adjacent, `api-refactor` first
      const names = state.layers.map((layer) => layer.name);
      expect(names).toEqual(['api-refactor', 'api-refactor-backup', 'add-retries']);
    });

    it('stacks the second of two branches on one commit on the first, so its diff against its parent is empty (E6)', async () => {
      // arrange
      const git = twoBranchesOnOneCommit();

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert: the backup's parent is the original, and parentSha equals its own sha —
      // nothing between them, which is the "second has 0 files vs first" of E6; the layer
      // above sits on the backup, not on the original
      const backup = state.layers[1];
      expect(backup.parent).toBe('api-refactor');
      expect(backup.parentSha).toBe(backup.sha);
      expect(state.layers[2].parent).toBe('api-refactor-backup');
    });
  });

  describe('current branch', () => {
    it('reports the branch HEAD is on: the `refs/heads/` prefix and the newline git prints both removed', async () => {
      // arrange: symbolic-ref answers `refs/heads/retry-metrics\n`
      const git = threeLayerStack();

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      expect(state.head).toBe('retry-metrics');
    });

    it('marks the layer HEAD is on as current, and no other', async () => {
      // arrange: HEAD on the top layer
      const git = threeLayerStack();

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      const current = state.layers.map((layer) => layer.isCurrent);
      expect(current).toEqual([false, false, true]);
    });

    it('marks a middle layer current when HEAD is there; the layers above it are not ancestors of HEAD and are absent', async () => {
      // arrange: HEAD checked out on add-retries. for-each-ref --merged HEAD then never
      // lists retry-metrics (it is above HEAD), so the fake does not either.
      const git = new FakeGitRunner(
        new Map([
          [HEAD_KEY, 'refs/heads/add-retries\n'],
          [REBASE_KEY, REBASE_PATHS],
          [MEMBERS_KEY, 'add-retries\napi-refactor\n'],
          [countKey('api-refactor'), '1\n'],
          [countKey('add-retries'), '2\n'],
          [branchShaKey('api-refactor'), `${SHA_A}\n`],
          [branchShaKey('add-retries'), `${SHA_B}\n`],
          [TRUNK_SHA_KEY, `${SHA_TRUNK}\n`],
        ]),
      );

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      expect(state.head).toBe('add-retries');
      const current = state.layers.map((layer) => layer.isCurrent);
      expect(current).toEqual([false, true]);
    });

    it('reports head as null when HEAD is detached (E3)', async () => {
      // arrange: symbolic-ref exits 1 on a detached HEAD; the layers are still there
      const git = threeLayerStack();
      git.answerIn(ROOT, HEAD_ARGS, DETACHED);

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      expect(state.head).toBeNull();
    });

    it('still computes every layer when HEAD is detached, and marks none of them current (E3)', async () => {
      // arrange: as above — `--merged HEAD` works on a bare commit just as well
      const git = threeLayerStack();
      git.answerIn(ROOT, HEAD_ARGS, DETACHED);

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      const names = state.layers.map((layer) => layer.name);
      const current = state.layers.map((layer) => layer.isCurrent);
      expect(names).toEqual(['api-refactor', 'add-retries', 'retry-metrics']);
      expect(current).toEqual([false, false, false]);
    });

    it('reports head as null when HEAD points at a ref that is not a local branch', async () => {
      // arrange: `git symbolic-ref HEAD refs/remotes/origin/main` makes HEAD symbolic, but
      // not to anything under refs/heads/. git's own `branch --show-current` refuses
      // outright there (`fatal: HEAD not found below refs/heads!`); computeStack answers
      // null instead, because to the tree it is "not on a branch", the same as a detached
      // HEAD.
      const git = threeLayerStack();
      git.answerIn(ROOT, HEAD_ARGS, 'refs/remotes/origin/main\n');

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      expect(state.head).toBeNull();
    });
  });

  describe('no stack', () => {
    it('returns no layers when HEAD is on trunk (E5)', async () => {
      // arrange: on main, every local branch is either trunk itself or already merged, so
      // `--no-merged origin/main` leaves nothing and for-each-ref prints nothing at all
      const git = new FakeGitRunner(
        new Map([
          [HEAD_KEY, 'refs/heads/main\n'],
          [REBASE_KEY, REBASE_PATHS],
          [MEMBERS_KEY, ''],
        ]),
      );

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert: head is still reported — the tree's "Not on a stack" node can name it
      expect(state.layers).toEqual([]);
      expect(state.head).toBe('main');
    });

    it('asks git nothing more once there are no members', async () => {
      // arrange: no rev-list, rev-parse or trunk SHA is canned, so asking would throw
      const git = new FakeGitRunner(
        new Map([
          [HEAD_KEY, 'refs/heads/main\n'],
          [REBASE_KEY, REBASE_PATHS],
          [MEMBERS_KEY, ''],
        ]),
      );

      // act
      await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert: HEAD, the rebase check, the members — and then nothing
      expect(git.calls).toEqual([
        { args: HEAD_ARGS, cwd: ROOT },
        { args: REBASE_ARGS, cwd: ROOT },
        { args: MEMBERS_ARGS, cwd: ROOT },
      ]);
    });
  });

  describe('what it asks git', () => {
    it('asks only for local branches merged into HEAD and not into trunk, so an unrelated stack is never listed (E16)', async () => {
      // arrange
      const git = threeLayerStack();

      // act
      await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert: `refs/heads` (local branches only), `--merged HEAD` (ancestors of HEAD —
      // a branch off trunk that HEAD does not contain fails this), `--no-merged <trunk>`
      // (drop what trunk already has). The exact argv is the whole of E16.
      expect(git.calls[2]).toEqual({ args: MEMBERS_ARGS, cwd: ROOT });
    });

    it('runs HEAD, then the rebase check, then the members, then a count and a SHA per member, then the trunk SHA — all in the root', async () => {
      // arrange
      const git = threeLayerStack();

      // act
      await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert: members are measured in the order git listed them (the sort comes after),
      // each by its full ref — a bare `add-retries` would mean a tag of that name, if one
      // existed — and trunk by the name detectTrunk gave
      expect(git.calls).toEqual([
        { args: HEAD_ARGS, cwd: ROOT },
        { args: REBASE_ARGS, cwd: ROOT },
        { args: MEMBERS_ARGS, cwd: ROOT },
        { args: ['rev-list', '--count', 'origin/main..refs/heads/add-retries'], cwd: ROOT },
        { args: ['rev-parse', 'refs/heads/add-retries'], cwd: ROOT },
        { args: ['rev-list', '--count', 'origin/main..refs/heads/api-refactor'], cwd: ROOT },
        { args: ['rev-parse', 'refs/heads/api-refactor'], cwd: ROOT },
        { args: ['rev-list', '--count', 'origin/main..refs/heads/retry-metrics'], cwd: ROOT },
        { args: ['rev-parse', 'refs/heads/retry-metrics'], cwd: ROOT },
        { args: ['rev-parse', 'origin/main'], cwd: ROOT },
      ]);
    });

    it('copies the root and the trunk it was given into the state unchanged', async () => {
      // arrange
      const git = threeLayerStack();

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert: the tree reads both from here, so they travel with the layers
      expect(state.root).toBe(ROOT);
      expect(state.trunk).toBe(TRUNK);
    });
  });

  describe('rebase in progress (E12)', () => {
    it('reports no rebase when neither directory git names exists', async () => {
      // arrange: the stand-in says "no" for every path
      const git = threeLayerStack();

      // act
      const state = await computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      expect(state.rebaseInProgress).toBe(false);
    });

    it('resolves each relative path git printed against the root before checking it', async () => {
      // arrange: a stand-in that records what it was asked about
      const git = threeLayerStack();
      const checked: string[] = [];
      const recording = (candidate: string): boolean => {
        checked.push(candidate);
        return false;
      };

      // act
      await computeStack(git, ROOT, TRUNK, recording);

      // assert: git's relative answers made absolute against the root the command ran in
      // — the real runner runs it there (the command itself, and its place in the
      // sequence, are pinned by the command-sequence tests above)
      expect(checked).toEqual(['/work/app/.git/rebase-merge', '/work/app/.git/rebase-apply']);
    });

    it('reports a rebase when the rebase-merge directory exists — the merge backend: a conflict stop, edit, break, a failed exec', async () => {
      // arrange
      const git = threeLayerStack();
      const mergeDirectoryExists = (candidate: string): boolean => candidate === '/work/app/.git/rebase-merge';

      // act
      const state = await computeStack(git, ROOT, TRUNK, mergeDirectoryExists);

      // assert
      expect(state.rebaseInProgress).toBe(true);
    });

    it('reports a rebase when the rebase-apply directory exists — the apply backend, and git am', async () => {
      // arrange
      const git = threeLayerStack();
      const applyDirectoryExists = (candidate: string): boolean => candidate === '/work/app/.git/rebase-apply';

      // act
      const state = await computeStack(git, ROOT, TRUNK, applyDirectoryExists);

      // assert
      expect(state.rebaseInProgress).toBe(true);
    });

    it('keeps an absolute path as git printed it — a linked worktree keeps its rebase state under .git/worktrees/<name>/ (E19)', async () => {
      // arrange: inside a linked worktree `rev-parse --git-path` prints absolute paths into
      // the main repository's .git; resolving an absolute path against the root changes nothing
      const git = threeLayerStack();
      git.answerIn(ROOT, REBASE_ARGS, '/elsewhere/main/.git/worktrees/app/rebase-merge\n/elsewhere/main/.git/worktrees/app/rebase-apply\n');
      const checked: string[] = [];
      const recording = (candidate: string): boolean => {
        checked.push(candidate);
        return false;
      };

      // act
      await computeStack(git, ROOT, TRUNK, recording);

      // assert
      expect(checked).toEqual(['/elsewhere/main/.git/worktrees/app/rebase-merge', '/elsewhere/main/.git/worktrees/app/rebase-apply']);
    });

    it('still lists every layer and marks none current while a paused rebase holds HEAD detached (E3 alongside E12)', async () => {
      // arrange: every rebase pause point but `git am` detaches HEAD
      const git = threeLayerStack();
      git.answerIn(ROOT, HEAD_ARGS, DETACHED);
      const mergeDirectoryExists = (candidate: string): boolean => candidate === '/work/app/.git/rebase-merge';

      // act
      const state = await computeStack(git, ROOT, TRUNK, mergeDirectoryExists);

      // assert
      expect(state.head).toBeNull();
      expect(state.rebaseInProgress).toBe(true);
      expect(state.layers.map((layer) => layer.name)).toEqual(['api-refactor', 'add-retries', 'retry-metrics']);
      expect(state.layers.map((layer) => layer.isCurrent)).toEqual([false, false, false]);
    });

    it('rejects when rev-parse --git-path fails — the rebase check is a `run`, not a `tryRun`', async () => {
      // arrange: `rev-parse --git-path` succeeds in every repository state, so a failure is
      // git itself failing, which must surface (E17), never read as "no rebase"
      const failure = new Error('fatal: not a git repository');
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [HEAD_KEY, 'refs/heads/retry-metrics\n'],
          [REBASE_KEY, failure],
        ]),
      );

      // act
      const result = computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      await expect(result).rejects.toBe(failure);
    });
  });

  describe('when git itself fails', () => {
    it('rejects instead of answering an empty stack when the runner cannot run git (E17)', async () => {
      // arrange: nothing is canned, so the fake throws from the very first call — the way
      // the real runner does when git is missing: a throw, never a null
      const git = new FakeGitRunner(new Map());

      // act
      const result = computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert
      await expect(result).rejects.toThrow('no canned output');
    });

    it('rejects when for-each-ref fails — the members list is a `run`, not a `tryRun`', async () => {
      // arrange: HEAD answers, but the members command exits non-zero (a trunk ref that
      // stopped resolving after the tree was first shown, say). That must surface, not
      // silently become "no stack".
      const failure = new Error('fatal: malformed object name origin/main');
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [HEAD_KEY, 'refs/heads/retry-metrics\n'],
          [REBASE_KEY, REBASE_PATHS],
          [MEMBERS_KEY, failure],
        ]),
      );

      // act
      const result = computeStack(git, ROOT, TRUNK, NO_REBASE_DIRECTORIES);

      // assert: the very same error the runner threw
      await expect(result).rejects.toBe(failure);
    });
  });
});
