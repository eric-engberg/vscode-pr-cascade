/**
 * test/unit/trunk.test.ts — detectTrunk as a specification against FakeGitRunner: every
 * step of the plan §5 order, the exact git commands each step runs, and what stops the
 * search.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on:
 * src/core/trunk.ts, test/helpers/fakeGit.ts. Real repositories are in
 * test/git/trunk.git.test.ts. Plan: §10.1 item 4, §5 "Trunk auto-detect", §7.3, §8 E4/E25, §9.4.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { describe, expect, it } from 'vitest';
import { detectTrunk } from '../../src/core/trunk';
import type { TrunkOptions } from '../../src/core/trunk';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository every test asks about. Nothing here touches the disk.
// see primer §4 (const)
const ROOT = '/work/app';

// The origin/HEAD command as the fake keys it (args joined by spaces). The other command
// detectTrunk runs, the rev-parse existence check, is built per ref by verifyKey below.
const ORIGIN_HEAD_KEY = 'symbolic-ref --quiet --short refs/remotes/origin/HEAD';

/**
 * The fake's key for "does this ref name a commit?" — `rev-parse --verify --quiet
 * --end-of-options <ref>^{commit}`. The suffix and the marker are git syntax that
 * refExists in src/core/trunk.ts explains; the ref itself goes in exactly as typed.
 */
// see primer §3 (functions and type annotations) and §12 (template strings)
function verifyKey(ref: string): string {
  return `rev-parse --verify --quiet --end-of-options ${ref}^{commit}`;
}

// What git prints for a ref that exists: its SHA. Any non-null answer would do.
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n';

// An Error as the canned value means "git exited non-zero": here `rev-parse --verify
// --quiet` exiting 1, silently, for a ref that is not there.
const MISSING = new Error('exit 1');

// The default settings: prCascade.trunk empty (auto-detect), prCascade.remote "origin".
// The `: TrunkOptions` annotation holds this literal to the interface detectTrunk takes: a
// misspelled or stray key is a compile error on this line, and a field added to the
// interface later is reported here, once, rather than at every call below.
// see primer §9 (an object literal that satisfies an interface) and §16 (a type
// annotation on an object literal)
const AUTO_DETECT: TrunkOptions = { configured: '', remote: 'origin' };

// see primer §5 (arrow functions) and §6 (async / await)
describe('detectTrunk', () => {
  describe('with prCascade.trunk set', () => {
    it('returns the configured ref when it exists', async () => {
      // arrange: the user set prCascade.trunk to a release branch
      // see primer §19 (Map)
      const git = new FakeGitRunner(new Map([[verifyKey('release/2.0'), SHA]]));

      // act
      const trunk = await detectTrunk(git, ROOT, { configured: 'release/2.0', remote: 'origin' });

      // assert
      expect(trunk).toBe('release/2.0');
    });

    it('asks git only whether that ref exists — nothing about remotes', async () => {
      // arrange
      const git = new FakeGitRunner(new Map([[verifyKey('release/2.0'), SHA]]));

      // act
      await detectTrunk(git, ROOT, { configured: 'release/2.0', remote: 'origin' });

      // assert: one command; the setting is one argument, as typed plus git's `^{commit}`
      // suffix, after `--end-of-options` so a value starting with `-` can never be a flag
      expect(git.calls).toEqual([
        { args: ['rev-parse', '--verify', '--quiet', '--end-of-options', 'release/2.0^{commit}'], cwd: ROOT },
      ]);
    });

    it('returns null for a configured ref that does not exist, even though auto-detection would succeed (E4)', async () => {
      // arrange: a typo in the setting; origin/HEAD is there and would have answered
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [verifyKey('relaese/2.0'), MISSING],
          [ORIGIN_HEAD_KEY, 'origin/main\n'],
          [verifyKey('origin/main'), SHA],
        ]),
      );

      // act
      const trunk = await detectTrunk(git, ROOT, { configured: 'relaese/2.0', remote: 'origin' });

      // assert: null, so the tree says "set prCascade.trunk" instead of showing a stack
      // measured against a branch the user never asked for
      expect(trunk).toBeNull();
    });

    it('does not fall through to auto-detection after the configured ref fails', async () => {
      // arrange: same repository as above
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [verifyKey('relaese/2.0'), MISSING],
          [ORIGIN_HEAD_KEY, 'origin/main\n'],
          [verifyKey('origin/main'), SHA],
        ]),
      );

      // act
      await detectTrunk(git, ROOT, { configured: 'relaese/2.0', remote: 'origin' });

      // assert: the one failed check, and then it stopped
      expect(git.calls).toEqual([
        { args: ['rev-parse', '--verify', '--quiet', '--end-of-options', 'relaese/2.0^{commit}'], cwd: ROOT },
      ]);
    });
  });

  describe('auto-detect (prCascade.trunk empty)', () => {
    it('returns the remote default branch that origin/HEAD points at', async () => {
      // arrange: a normal clone — origin/HEAD → origin/main, and origin/main exists
      const git = new FakeGitRunner(
        new Map([
          [ORIGIN_HEAD_KEY, 'origin/main\n'],
          [verifyKey('origin/main'), SHA],
        ]),
      );

      // act
      const trunk = await detectTrunk(git, ROOT, AUTO_DETECT);

      // assert: the newline git prints is gone; the remote-tracking name is kept as is
      expect(trunk).toBe('origin/main');
    });

    it('runs every command in the repository root it was given', async () => {
      // arrange
      const git = new FakeGitRunner(
        new Map([
          [ORIGIN_HEAD_KEY, 'origin/main\n'],
          [verifyKey('origin/main'), SHA],
        ]),
      );

      // act
      await detectTrunk(git, ROOT, AUTO_DETECT);

      // assert
      expect(git.calls).toEqual([
        { args: ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd: ROOT },
        { args: ['rev-parse', '--verify', '--quiet', '--end-of-options', 'origin/main^{commit}'], cwd: ROOT },
      ]);
    });

    it('moves past a stale origin/HEAD whose branch is gone (default branch renamed on the remote)', async () => {
      // arrange: the remote renamed master → main; `fetch --prune` removed origin/master
      // but origin/HEAD still points at it
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [ORIGIN_HEAD_KEY, 'origin/master\n'],
          [verifyKey('origin/master'), MISSING],
          [verifyKey('origin/main'), SHA],
        ]),
      );

      // act
      const trunk = await detectTrunk(git, ROOT, AUTO_DETECT);

      // assert: the stale pointer is ignored and the candidates take over
      expect(trunk).toBe('origin/main');
    });

    it('falls back to origin/main when origin/HEAD is not set', async () => {
      // arrange: no origin/HEAD pointer (never written, or deleted), but origin/main was fetched
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [ORIGIN_HEAD_KEY, MISSING],
          [verifyKey('origin/main'), SHA],
        ]),
      );

      // act
      const trunk = await detectTrunk(git, ROOT, AUTO_DETECT);

      // assert
      expect(trunk).toBe('origin/main');
    });

    it('stops at the first ref that exists instead of checking the rest', async () => {
      // arrange: as above; `main` and `master` are deliberately not canned, so checking
      // them would make the fake throw
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [ORIGIN_HEAD_KEY, MISSING],
          [verifyKey('origin/main'), SHA],
        ]),
      );

      // act
      await detectTrunk(git, ROOT, AUTO_DETECT);

      // assert
      expect(git.calls).toEqual([
        { args: ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd: ROOT },
        { args: ['rev-parse', '--verify', '--quiet', '--end-of-options', 'origin/main^{commit}'], cwd: ROOT },
      ]);
    });

    it('tries origin/master after origin/main', async () => {
      // arrange: an older repository whose remote still uses master
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [ORIGIN_HEAD_KEY, MISSING],
          [verifyKey('origin/main'), MISSING],
          [verifyKey('origin/master'), SHA],
        ]),
      );

      // act
      const trunk = await detectTrunk(git, ROOT, AUTO_DETECT);

      // assert
      expect(trunk).toBe('origin/master');
    });

    it('falls back to the local main when the repository has no remote (E25)', async () => {
      // arrange: no remote, so nothing under refs/remotes/ exists at all
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [ORIGIN_HEAD_KEY, MISSING],
          [verifyKey('origin/main'), MISSING],
          [verifyKey('origin/master'), MISSING],
          [verifyKey('main'), SHA],
        ]),
      );

      // act
      const trunk = await detectTrunk(git, ROOT, AUTO_DETECT);

      // assert
      expect(trunk).toBe('main');
    });

    it('tries the local master last', async () => {
      // arrange
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [ORIGIN_HEAD_KEY, MISSING],
          [verifyKey('origin/main'), MISSING],
          [verifyKey('origin/master'), MISSING],
          [verifyKey('main'), MISSING],
          [verifyKey('master'), SHA],
        ]),
      );

      // act
      const trunk = await detectTrunk(git, ROOT, AUTO_DETECT);

      // assert
      expect(trunk).toBe('master');
    });

    it('asks in the plan §5 order: origin/HEAD, origin/main, origin/master, main, master', async () => {
      // arrange: everything missing but the very last candidate, so every step runs
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [ORIGIN_HEAD_KEY, MISSING],
          [verifyKey('origin/main'), MISSING],
          [verifyKey('origin/master'), MISSING],
          [verifyKey('main'), MISSING],
          [verifyKey('master'), SHA],
        ]),
      );

      // act
      await detectTrunk(git, ROOT, AUTO_DETECT);

      // assert: the full sequence, one command per step
      expect(git.calls).toEqual([
        { args: ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd: ROOT },
        { args: ['rev-parse', '--verify', '--quiet', '--end-of-options', 'origin/main^{commit}'], cwd: ROOT },
        { args: ['rev-parse', '--verify', '--quiet', '--end-of-options', 'origin/master^{commit}'], cwd: ROOT },
        { args: ['rev-parse', '--verify', '--quiet', '--end-of-options', 'main^{commit}'], cwd: ROOT },
        { args: ['rev-parse', '--verify', '--quiet', '--end-of-options', 'master^{commit}'], cwd: ROOT },
      ]);
    });

    it('returns null when nothing resolves (E4)', async () => {
      // arrange: a repository whose only branch is called `trunk`, with no remote
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [ORIGIN_HEAD_KEY, MISSING],
          [verifyKey('origin/main'), MISSING],
          [verifyKey('origin/master'), MISSING],
          [verifyKey('main'), MISSING],
          [verifyKey('master'), MISSING],
        ]),
      );

      // act
      const trunk = await detectTrunk(git, ROOT, AUTO_DETECT);

      // assert: null, never a guess — the tree will say "set prCascade.trunk"
      expect(trunk).toBeNull();
    });

    it('reads the remote named by prCascade.remote instead of origin', async () => {
      // arrange: a fork, with the original repository kept as `upstream`
      const git = new FakeGitRunner(
        new Map([
          ['symbolic-ref --quiet --short refs/remotes/upstream/HEAD', 'upstream/main\n'],
          [verifyKey('upstream/main'), SHA],
        ]),
      );

      // act
      const trunk = await detectTrunk(git, ROOT, { configured: '', remote: 'upstream' });

      // assert
      expect(trunk).toBe('upstream/main');
    });

    it('uses prCascade.remote for the remote-tracking candidates too', async () => {
      // arrange: `upstream` has no HEAD pointer; its main exists
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          ['symbolic-ref --quiet --short refs/remotes/upstream/HEAD', MISSING],
          [verifyKey('upstream/main'), SHA],
        ]),
      );

      // act
      const trunk = await detectTrunk(git, ROOT, { configured: '', remote: 'upstream' });

      // assert: origin is never mentioned
      expect(trunk).toBe('upstream/main');
    });
  });

  describe('when git itself fails', () => {
    it('rejects instead of answering null when the runner cannot run git (E17)', async () => {
      // arrange: nothing is canned, so the fake throws from tryRun — the way the real
      // runner does when git is missing: a throw, never a null
      const git = new FakeGitRunner(new Map());

      // act
      const result = detectTrunk(git, ROOT, AUTO_DETECT);

      // assert
      await expect(result).rejects.toThrow('no canned output');
    });
  });
});
