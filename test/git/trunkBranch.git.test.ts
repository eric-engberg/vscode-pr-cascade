/**
 * test/git/trunkBranch.git.test.ts — trunkBranchFor against a real repository: that git names
 * each kind of trunk the way the unit tests' fake says it does. The fake's answers were copied
 * from git 2.50 on a Mac; CI runs other versions on Linux, and `--symbolic-full-name`'s output
 * for a tag, a commit or an ambiguous name is exactly the kind of detail that could differ, so
 * the real thing is asked here once per kind.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git in a throwaway directory,
 * no git-spice, no VS Code). Depends on: src/core/readinessFix.ts, src/core/git.ts,
 * test/helpers/fixture.ts. Plan: §7.13.1 (the init offer's `--trunk`), §8 E59, §10.1 item 19a,
 * §13.2 D57.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RealGitRunner } from '../../src/core/git';
import { trunkBranchFor } from '../../src/core/readinessFix';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';

const git = new RealGitRunner();

// see primer §5 (arrow functions)
beforeAll(() => {
  // Hermetic git for the runner under test, as in readiness.git.test.ts: HOME points at a path
  // that does not exist, the global file is empty, the system file skipped.
  vi.stubEnv('HOME', path.join(__dirname, 'no-such-home'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// see primer §6 (async / await)
describe('trunkBranchFor (real git)', () => {
  // The plan Appendix A stack: `main` with a bare origin, so `origin/main` and `origin/HEAD`
  // exist, and HEAD on the top layer.
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildStack();
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('names the local branch for a local trunk', async () => {
    expect(await trunkBranchFor(git, fixture.dir, 'main')).toStrictEqual({ kind: 'local', branch: 'main' });
  });

  it('names the local branch for the remote-tracking trunk core/trunk.ts usually finds', async () => {
    expect(await trunkBranchFor(git, fixture.dir, 'origin/main')).toStrictEqual({ kind: 'local', branch: 'main' });
  });

  it('follows origin/HEAD to the branch it points at', async () => {
    expect(await trunkBranchFor(git, fixture.dir, 'origin/HEAD')).toStrictEqual({ kind: 'local', branch: 'main' });
  });

  it('is not-a-branch for a tag', async () => {
    // arrange
    fixture.git(['tag', 'v1', 'main']);
    try {
      // act
      const answer = await trunkBranchFor(git, fixture.dir, 'v1');

      // assert
      expect(answer).toStrictEqual({ kind: 'not-a-branch', trunk: 'v1' });
    } finally {
      fixture.git(['tag', '-d', 'v1']);
    }
  });

  it('is not-a-branch for a commit', async () => {
    // arrange
    const sha = fixture.git(['rev-parse', 'main']).trim();

    // act
    const answer = await trunkBranchFor(git, fixture.dir, sha);

    // assert
    expect(answer).toStrictEqual({ kind: 'not-a-branch', trunk: sha });
  });

  it('is not-a-branch for a name that is both a local branch and a remote-tracking ref', async () => {
    // arrange: a local branch literally named `origin/main` makes the name ambiguous
    fixture.git(['branch', 'origin/main', 'main']);
    try {
      // act
      const answer = await trunkBranchFor(git, fixture.dir, 'origin/main');

      // assert
      expect(answer).toStrictEqual({ kind: 'not-a-branch', trunk: 'origin/main' });
    } finally {
      fixture.git(['branch', '-D', 'origin/main']);
    }
  });

  it('is not-a-branch for a name git does not know', async () => {
    expect(await trunkBranchFor(git, fixture.dir, 'no-such-branch')).toStrictEqual({ kind: 'not-a-branch', trunk: 'no-such-branch' });
  });

  it('is missing when only the remote-tracking ref is there — the local branch was deleted', async () => {
    // arrange: HEAD is on retry-metrics, so `main` can go; put it back afterwards
    const sha = fixture.git(['rev-parse', 'main']).trim();
    fixture.git(['branch', '-D', 'main']);
    try {
      // act
      const answer = await trunkBranchFor(git, fixture.dir, 'origin/main');

      // assert
      expect(answer).toStrictEqual({ kind: 'missing', branch: 'main', trunk: 'origin/main' });
    } finally {
      fixture.git(['branch', 'main', sha]);
    }
  });
});
