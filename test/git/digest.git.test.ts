/**
 * test/git/digest.git.test.ts — the digest on a real repository: what `for-each-ref` prints for
 * the fixture, in which order, and which actions move it — a ref `gs repo init` would write
 * (`git update-ref` stands in), a commit, a push — and which do not: a checkout. The last is the
 * fact behind leaving HEAD out of the digest (D59); the others are what §7.14.2 says must re-run
 * `gs log`.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git in a throwaway directory, no
 * git-spice, no VS Code). Depends on: src/core/digest.ts, src/core/git.ts, test/helpers/fixture.ts.
 * Depended on by: nothing. Plan: §7.14.2, §9.4 `unit/digest`, §10.1 item 20a, §13.2 D59.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isInitialised, readRefDigest } from '../../src/core/digest';
import { RealGitRunner } from '../../src/core/git';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';

const git = new RealGitRunner();

// see primer §5 (arrow functions)
beforeAll(() => {
  // Hermetic git for the runner under test, as in readiness.git.test.ts.
  vi.stubEnv('HOME', path.join(__dirname, 'no-such-home'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// see primer §6 (async / await)
describe('readRefDigest (real git)', () => {
  // The plan Appendix A stack: three layers on `main`, a bare origin with `origin/main` and
  // `origin/HEAD`, HEAD on the top layer, nothing of git-spice's.
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildStack();
  });

  afterAll(() => {
    fixture.cleanup();
  });

  /** What git says `ref` points at. */
  // see primer §23 (`trim`)
  function shaOf(ref: string): string {
    return fixture.git(['rev-parse', ref]).trim();
  }

  it('lists the three namespaces, sorted by ref name, one `<refname> <sha>` per line — and nothing of git-spice\'s on a fresh fixture', async () => {
    // act
    const digest = await readRefDigest(git, fixture.dir);

    // assert
    expect(digest).toBe(
      `refs/heads/add-retries ${shaOf('add-retries')}\n` +
        `refs/heads/api-refactor ${shaOf('api-refactor')}\n` +
        `refs/heads/main ${shaOf('main')}\n` +
        `refs/heads/retry-metrics ${shaOf('retry-metrics')}\n` +
        `refs/remotes/origin/HEAD ${shaOf('origin/HEAD')}\n` +
        `refs/remotes/origin/main ${shaOf('origin/main')}\n`,
    );
    expect(isInitialised(digest)).toBe(false);
  });

  it('gains a last line, and becomes initialised, when refs/spice/data appears — what `gs repo init` writes', async () => {
    // arrange
    const before = await readRefDigest(git, fixture.dir);
    fixture.git(['update-ref', 'refs/spice/data', 'HEAD']);
    try {
      // act
      const digest = await readRefDigest(git, fixture.dir);

      // assert
      expect(digest).toBe(`${before}refs/spice/data ${shaOf('HEAD')}\n`);
      expect(isInitialised(digest)).toBe(true);
    } finally {
      fixture.git(['update-ref', '-d', 'refs/spice/data']);
    }
    expect(await readRefDigest(git, fixture.dir)).toBe(before);
  });

  it('changes by exactly the branch\'s line when a commit is made on it', async () => {
    // arrange
    const before = await readRefDigest(git, fixture.dir);
    fixture.git(['commit', '-q', '--allow-empty', '-m', 'one more']);
    try {
      // act
      const digest = await readRefDigest(git, fixture.dir);

      // assert: the one line for retry-metrics differs; every other line is the same
      // see primer §25 (arrays: `split`, `filter`)
      const differing = digest.split('\n').filter((line, index) => line !== before.split('\n')[index]);
      expect(differing).toStrictEqual([`refs/heads/retry-metrics ${shaOf('retry-metrics')}`]);
    } finally {
      fixture.git(['reset', '-q', '--hard', 'HEAD~1']);
    }
    expect(await readRefDigest(git, fixture.dir)).toBe(before);
  });

  it('changes when a branch is pushed — a new remote-tracking ref — and back when it is deleted there', async () => {
    // arrange
    const before = await readRefDigest(git, fixture.dir);
    fixture.git(['push', '-q', 'origin', 'api-refactor']);
    try {
      // act
      const digest = await readRefDigest(git, fixture.dir);

      // assert
      expect(digest).toContain(`refs/remotes/origin/api-refactor ${shaOf('api-refactor')}\n`);
      expect(digest).not.toBe(before);
    } finally {
      fixture.git(['push', '-q', 'origin', ':api-refactor']);
    }
    expect(await readRefDigest(git, fixture.dir)).toBe(before);
  });

  it('does not change on a checkout — HEAD moves, no ref the digest lists does (D59)', async () => {
    // arrange
    const before = await readRefDigest(git, fixture.dir);
    fixture.git(['checkout', '-q', 'add-retries']);
    try {
      // act and assert
      expect(await readRefDigest(git, fixture.dir)).toBe(before);
    } finally {
      fixture.git(['checkout', '-q', 'retry-metrics']);
    }
  });
});
