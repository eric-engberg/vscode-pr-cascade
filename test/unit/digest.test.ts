/**
 * test/unit/digest.test.ts — the §7.14.2 pre-filter's input as a specification: the one git
 * command it runs, spelled; its text handed back as it is; and `isInitialised`, the probe's
 * step-2 fact read off that text with no spawn.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on:
 * src/core/digest.ts, test/helpers/fakeGit.ts. What real git prints, and what moves it, is
 * test/git/digest.git.test.ts. Plan: §7.6, §7.14.2, §9.4 `unit/digest`, §10.1 item 20a, §13.2 D59.
 */

// see primer §1 (import / export)
import { describe, expect, it } from 'vitest';
import { DIGEST_ARGS, isInitialised, readRefDigest } from '../../src/core/digest';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository every test asks about, and the fake's key for the digest command (its
// arguments joined by spaces, as FakeGitRunner keys them).
// see primer §4 (const) and §25 (arrays: `join`)
const ROOT = '/work/app';
const KEY = DIGEST_ARGS.join(' ');

// What `for-each-ref` prints for the fixture once git-spice has initialised it: one
// `<refname> <sha>` per line, sorted by refname, and `refs/spice/data` last.
const SPICE_LINE = 'refs/spice/data dddddddddddddddddddddddddddddddddddddddd\n';
const NO_SPICE =
  'refs/heads/add-retries bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n' +
  'refs/heads/api-refactor aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' +
  'refs/heads/main 0000000000000000000000000000000000000000\n' +
  'refs/heads/retry-metrics cccccccccccccccccccccccccccccccccccccccc\n' +
  'refs/remotes/origin/HEAD 0000000000000000000000000000000000000000\n' +
  'refs/remotes/origin/main 0000000000000000000000000000000000000000\n';
const REFS = NO_SPICE + SPICE_LINE;

// see primer §5 (arrow functions) and §6 (async / await)
describe('readRefDigest', () => {
  it('runs the one for-each-ref of plan §7.14.2 — the three namespaces, names and object names only — and hands its text back untouched', async () => {
    // arrange
    const git = new FakeGitRunner(new Map([[KEY, REFS]]));

    // act
    const digest = await readRefDigest(git, ROOT);

    // assert: verbatim, trailing newline and all — the text is compared, never parsed
    expect(digest).toBe(REFS);
    expect(git.calls).toStrictEqual([
      { args: ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes', 'refs/spice'], cwd: ROOT },
    ]);
  });

  it('rejects when git fails — the digest is asked with `run`, and a failing git is E17, not an answer', async () => {
    // arrange
    const git = new FakeGitRunner(new Map([[KEY, new Error('git: ENOENT')]]));

    // act and assert
    await expect(readRefDigest(git, ROOT)).rejects.toThrow('git: ENOENT');
  });
});

describe('isInitialised', () => {
  it('is true when the digest has the refs/spice/data line — what `gs repo init` writes', () => {
    expect(isInitialised(REFS)).toBe(true);
  });

  it('finds the line wherever it is — first, not only last', () => {
    expect(isInitialised(SPICE_LINE + NO_SPICE)).toBe(true);
  });

  it('is false without it, and for an empty digest', () => {
    expect(isInitialised(NO_SPICE)).toBe(false);
    expect(isInitialised('')).toBe(false);
  });

  it('matches the whole ref name and nothing like it — the line start and the space after the name', () => {
    expect(isInitialised('refs/spice/database dddddddddddddddddddddddddddddddddddddddd\n')).toBe(false);
    expect(isInitialised('refs/spice/data/x dddddddddddddddddddddddddddddddddddddddd\n')).toBe(false);
    expect(isInitialised('xrefs/spice/data dddddddddddddddddddddddddddddddddddddddd\n')).toBe(false);
  });
});
