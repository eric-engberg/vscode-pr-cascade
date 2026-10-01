/**
 * test/git/rebase.git.test.ts — computeStack's rebase check against real paused rebases:
 * the pause points plan §9.4 asks for, built in throwaway repositories, so that the directory check
 * (`rev-parse --git-path rebase-merge` / `rebase-apply`, plan §5) is shown to see what the
 * built-in Git extension's `state.rebaseCommit` misses — a linked worktree (E19), and the
 * pauses git marks with no `REBASE_HEAD`: an interactive `break`, a failed `exec`, `git am`
 * (plan §7.14, §13.4 (c)).
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git in throwaway
 * directories, no VS Code). Depends on: src/core/stack.ts, src/core/git.ts,
 * test/helpers/fixture.ts. Depended on by: nothing. Plan: §5 "Rebase in progress", §7.14,
 * §8 E3/E12/E19, §9.4 row `git/rebase.git.test.ts`, §10.1 item 13a, §13.4 (c).
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

// The trunk every fixture has (buildStack creates a bare origin and fetches it), and the
// local branch the rebases below run onto — the same commit as `origin/main` until a test
// says otherwise.
// see primer §4 (const)
const TRUNK = 'origin/main';
const LOCAL_TRUNK = 'main';

// `git` is the runner under test (see test/git/stack.git.test.ts for why it and
// `fixture.git(...)` coexist). Every `computeStack` call below passes no fourth argument,
// so `directoryExists` keeps its default — the real `existsSync` — and the rebase
// directory check this file exists to exercise runs against the disk. `fixture.git(...)`
// is the fixture builder's synchronous helper, used only to set a situation up.
const git = new RealGitRunner();

// A throwaway HOME, so git never reads the developer's own ~/.gitconfig. Removed in afterAll.
let homeDir: string;

// see primer §5 (arrow functions) and §6 (async / await)
beforeAll(async () => {
  homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-rebase-test-'));
  // Hermetic git, exactly as in stack.git.test.ts; vi.unstubAllEnvs in afterAll restores
  // every variable — including the GIT_SEQUENCE_EDITOR the last block sets.
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

/**
 * Runs a git command that is expected to stop part-way — a rebase at a conflict or a
 * failed `exec`, an `am` whose patch does not apply — and ignores the non-zero exit: the
 * state git leaves behind is the point, and each block checks that state before asserting
 * anything about computeStack.
 */
// see primer §18 (try / catch and unknown: a `catch` with no name for the error)
function runUntilItStops(fixture: Fixture, args: string[]): void {
  try {
    fixture.git(args);
  } catch {
    // Expected: git exits 1 (rebase) or 128 (am) when it pauses.
  }
}

/** The two directories git keeps a paused rebase's state in: the merge backend's, and the apply backend's (which `git am` shares). */
// see primer §10 (union types: exact strings as members, named once with `type`)
type RebaseDirectoryName = 'rebase-merge' | 'rebase-apply';

/** Where this working tree keeps a paused rebase's state, as git itself says: `rev-parse --git-path <name>`, made absolute. */
// see primer §28 (`path.resolve`)
function rebaseDirectory(fixture: Fixture, directory: string, name: RebaseDirectoryName): string {
  const printed = fixture.git(['-C', directory, 'rev-parse', '--git-path', name]).trim();
  return path.resolve(directory, printed);
}

/** Throws unless git's rebase directory of that kind exists where `directory`'s git says — the precondition every paused block proves first. */
function expectPaused(fixture: Fixture, directory: string, name: RebaseDirectoryName): void {
  const rebaseDir = rebaseDirectory(fixture, directory, name);
  if (fs.existsSync(rebaseDir) === false) {
    throw new Error(`expected a paused rebase, but ${rebaseDir} does not exist`);
  }
}

/** Whether git wrote `REBASE_HEAD` for this pause — what the built-in Git extension's `state.rebaseCommit` needs (plan §13.4 (c)). */
function rebaseHeadExists(fixture: Fixture, directory: string): boolean {
  const printed = fixture.git(['-C', directory, 'rev-parse', '--git-path', 'REBASE_HEAD']).trim();
  return fs.existsSync(path.resolve(directory, printed));
}

// One fixture per situation, built in `beforeAll` and removed in `afterAll`, so a paused
// rebase in one block can never leak into another.
describe('computeStack: rebase in progress (real git)', () => {
  describe('no rebase', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('reports no rebase on the stack as built', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.rebaseInProgress).toBe(false);
    });
  });

  describe('the merge backend stopped on a conflict (E12)', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      // The fixture's own recipe: a commit on local trunk that conflicts with the bottom
      // layer, then `rebase <trunk>`, paused at the conflict (it checks `rebase-merge` exists).
      fixture.startConflictingRebase();
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('reports a rebase while the rebase-merge directory exists', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.rebaseInProgress).toBe(true);
    });

    it('reports head as null: the paused rebase has detached HEAD (E3 alongside E12)', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert — the layers are not asserted here: the recipe's extra commit on local
      // `main` makes `main` itself a member against `origin/main`, which is the recipe's
      // doing, not the rebase's; the exec block below shows what a paused rebase lists
      expect(state.head).toBeNull();
    });
  });

  describe('after git rebase --abort', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      fixture.startConflictingRebase();
      fixture.git(['rebase', '--abort']);
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('reports no rebase again, with HEAD back on the top layer — git removes the directory whole', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.rebaseInProgress).toBe(false);
      expect(state.head).toBe('retry-metrics');
    });
  });

  describe('git am stopped on a patch that does not apply (rebase-apply, no REBASE_HEAD)', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      // The bottom layer's commit as a patch, applied where its file already exists: `am`
      // stops at the first patch and leaves `rebase-apply` behind, with HEAD still attached.
      const patchDir = path.join(path.dirname(fixture.dir), 'patches');
      fixture.git(['format-patch', '-q', '-1', 'api-refactor', '-o', patchDir]);
      // see primer §54 (destructuring: the array form) — the one file format-patch wrote
      const [patch] = fs.readdirSync(patchDir);
      runUntilItStops(fixture, ['am', path.join(patchDir, patch)]);
      expectPaused(fixture, fixture.dir, 'rebase-apply');
      if (rebaseHeadExists(fixture, fixture.dir)) {
        throw new Error('expected no REBASE_HEAD during git am — this git writes one, so the case proves nothing');
      }
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('reports a rebase while the rebase-apply directory exists, although git wrote no REBASE_HEAD', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.rebaseInProgress).toBe(true);
    });

    it('keeps head on the top layer: an am session never detaches HEAD', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.head).toBe('retry-metrics');
    });
  });

  describe('a rebase stopped by a failed exec (rebase -x false, no REBASE_HEAD)', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      // `-x false` runs `false` after each replayed commit; the first run fails and the
      // rebase pauses there. The first pick is a fast-forward (trunk has not moved), so
      // HEAD sits exactly on the bottom layer's commit, detached.
      runUntilItStops(fixture, ['rebase', '-x', 'false', LOCAL_TRUNK]);
      expectPaused(fixture, fixture.dir, 'rebase-merge');
      if (rebaseHeadExists(fixture, fixture.dir)) {
        throw new Error('expected no REBASE_HEAD after a failed exec — this git writes one, so the case proves nothing');
      }
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('reports a rebase although git wrote no REBASE_HEAD', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.rebaseInProgress).toBe(true);
    });

    it('lists only the layers below the pause, none of them current — what the view shows mid-rebase', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.layers.map((layer) => layer.name)).toEqual(['api-refactor']);
      expect(state.layers.map((layer) => layer.isCurrent)).toEqual([false]);
      expect(state.head).toBeNull();
    });
  });

  describe('a linked worktree mid-rebase (E19)', () => {
    let fixture: Fixture;
    let worktreeDir: string;

    beforeAll(() => {
      fixture = buildStack();
      // A second working directory of the same repository, on the middle layer; its `.git`
      // is a file pointing into the main repository's `.git/worktrees/<name>/`, which is
      // where its paused rebase lives.
      worktreeDir = path.join(path.dirname(fixture.dir), 'worktree');
      fixture.git(['worktree', 'add', '-q', worktreeDir, 'add-retries']);
      if (fs.statSync(path.join(worktreeDir, '.git')).isFile() === false) {
        throw new Error('expected the linked worktree to have a .git file');
      }
      runUntilItStops(fixture, ['-C', worktreeDir, 'rebase', '-x', 'false', LOCAL_TRUNK]);
      expectPaused(fixture, worktreeDir, 'rebase-merge');
      // The main repository's own `.git/rebase-merge` must not exist: anything that spelled
      // `.git/` out by hand would say "no rebase" for the worktree, and "rebase" for the
      // main working directory if it did.
      if (fs.existsSync(path.join(fixture.dir, '.git', 'rebase-merge'))) {
        throw new Error('expected the paused rebase to live under .git/worktrees/, not in the main .git');
      }
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('reports a rebase from inside the worktree, whose rebase-merge lives under the main repository\'s .git/worktrees/<name>/ (E19)', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, worktreeDir, TRUNK);

      // assert: git prints that path absolute, and path.resolve against the worktree root
      // leaves it alone
      expect(state.rebaseInProgress).toBe(true);
    });

    it('reports no rebase for the main working directory at the same moment: the check is per working tree', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.rebaseInProgress).toBe(false);
    });
  });

  // Last in the file: it sets GIT_SEQUENCE_EDITOR for every later interactive rebase in
  // this process, and the file-level afterAll removes it again.
  describe('an interactive rebase paused at break (no REBASE_HEAD)', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      // `git rebase -i` opens the todo list in GIT_SEQUENCE_EDITOR; this one-line shell
      // script puts `break` at the top, so the rebase stops before its first pick — with
      // HEAD detached at trunk's commit and nothing replayed yet. git exits 0 here ("Stopped
      // at …"), so no runUntilItStops. `fixture.git` spreads process.env at call time, which
      // is how vi.stubEnv reaches it.
      const editor = path.join(path.dirname(fixture.dir), 'prepend-break.sh');
      fs.writeFileSync(editor, '{ echo break; cat "$1"; } > "$1.new" && mv "$1.new" "$1"\n');
      vi.stubEnv('GIT_SEQUENCE_EDITOR', `sh "${editor}"`);
      fixture.git(['rebase', '-q', '-i', LOCAL_TRUNK]);
      expectPaused(fixture, fixture.dir, 'rebase-merge');
      if (rebaseHeadExists(fixture, fixture.dir)) {
        throw new Error('expected no REBASE_HEAD at a break — this git writes one, so the case proves nothing');
      }
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('reports a rebase although git wrote no REBASE_HEAD', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.rebaseInProgress).toBe(true);
    });

    it('lists no layers: HEAD sits on trunk\'s commit until the first pick (E5 under E12)', async () => {
      // arrange: nothing beyond the fixture

      // act
      const state = await computeStack(git, fixture.dir, TRUNK);

      // assert
      expect(state.layers).toEqual([]);
      expect(state.head).toBeNull();
    });
  });
});
