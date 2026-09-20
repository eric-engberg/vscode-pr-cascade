/**
 * test/unit/changes.test.ts — parseNameStatus and changedFiles as a specification: the
 * `git diff --name-status -M -z` format, entry by entry, and the one command changedFiles
 * runs, checked against FakeGitRunner.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on:
 * src/core/changes.ts, test/helpers/fakeGit.ts. What real git prints for a real rename,
 * a binary file or a 1500-file layer is PR 10's test/git/changes.git.test.ts; here the
 * output is canned, including one output copied byte for byte from git 2.50. Plan:
 * §10.1 M2 item 7, §5 "Files in a layer", §8 E7/E8/E9/E11/E17, §9.4.
 */

// see primer §1 (import / export)
import { describe, expect, it } from 'vitest';
import { changedFiles, parseNameStatus } from '../../src/core/changes';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository the changedFiles tests ask about, and the two SHAs a LayerNode would
// hand over: the layer's own commit and its parent's (core/stack.ts). Nothing here
// touches the disk.
// see primer §4 (const)
const ROOT = '/work/app';
const PARENT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// The one command changedFiles runs: as the fake keys it (args joined by spaces), and as
// the argument list it must pass to the runner.
// see primer §12 (template strings)
const DIFF_KEY = `diff --name-status -M -z ${PARENT_SHA} ${SHA} --`;
const DIFF_ARGS = ['diff', '--name-status', '-M', '-z', PARENT_SHA, SHA, '--'];

/**
 * What git 2.50.1 printed for `git diff --name-status -M -z <base> <top>` on a
 * repository built to exercise every status letter and every awkward path at once
 * (2026-09-20, hermetic temp repo): between `base` and `top` a file was added, one
 * modified, one deleted, one renamed with a small edit (hence `R052`, 52 % similar),
 * one copied unchanged, one replaced by a symlink, and files were added under
 * `dir with space/`, `ünïcode/`, as `hash#and?question.txt`, and with a newline in the
 * name. Each `\0` below is one NUL byte of that output (primer §44); the `\n` inside
 * `new\nline.txt` is a real newline in a real path. Note the copy: changedFiles passes
 * `-M` and not `-C` (plan §5), so git reports it as a plain addition — the parser's `C`
 * case never fires on this command's output.
 */
const REAL_OUTPUT =
  'A\0added.txt\0' +
  'A\0copied-dst.txt\0' +
  'D\0deleted.txt\0' +
  'A\0dir with space/file name.txt\0' +
  'A\0hash#and?question.txt\0' +
  'M\0modified.txt\0' +
  'A\0new\nline.txt\0' +
  'R052\0renamed-old.txt\0renamed-new.txt\0' +
  'T\0typechange.txt\0' +
  'A\0ünïcode/fïle.txt\0';

// see primer §5 (arrow functions)
describe('parseNameStatus', () => {
  describe('one entry per status letter', () => {
    // `toStrictEqual` rather than `toEqual`: it also fails when the parsed object carries
    // a key the expected one lacks — an `oldPath: undefined` on a plain entry would
    // slip past `toEqual`, which treats a key set to undefined as absent.
    it('reads an added file: the letter A, then the path (E8)', () => {
      // arrange
      const output = 'A\0src/new.ts\0';

      // act
      const files = parseNameStatus(output);

      // assert
      expect(files).toStrictEqual([{ status: 'A', path: 'src/new.ts', binary: false }]);
    });

    it('reads a modified file: M', () => {
      // arrange
      const output = 'M\0README.md\0';

      // act
      const files = parseNameStatus(output);

      // assert
      expect(files).toStrictEqual([{ status: 'M', path: 'README.md', binary: false }]);
    });

    it('reads a deleted file: D (E9)', () => {
      // arrange
      const output = 'D\0old/gone.txt\0';

      // act
      const files = parseNameStatus(output);

      // assert
      expect(files).toStrictEqual([{ status: 'D', path: 'old/gone.txt', binary: false }]);
    });

    it('reads a type change — a file that became a symlink, or the reverse: T', () => {
      // arrange
      const output = 'T\0config.yaml\0';

      // act
      const files = parseNameStatus(output);

      // assert
      expect(files).toStrictEqual([{ status: 'T', path: 'config.yaml', binary: false }]);
    });

    it('reads a rename as old path then new path, and drops the similarity score (E7)', () => {
      // arrange: R100 — every byte unchanged, git is certain
      const output = 'R100\0src/old.ts\0src/new.ts\0';

      // act
      const files = parseNameStatus(output);

      // assert: `path` is where the file is now; `oldPath` where it was at the parent
      expect(files).toStrictEqual([{ status: 'R', path: 'src/new.ts', oldPath: 'src/old.ts', binary: false }]);
    });

    it('reads a rename with a lower score the same way — the digits never reach the status', () => {
      // arrange: R075 — moved and edited, three quarters of the content unchanged
      const output = 'R075\0lib/a.ts\0lib/b.ts\0';

      // act
      const files = parseNameStatus(output);

      // assert
      expect(files).toStrictEqual([{ status: 'R', path: 'lib/b.ts', oldPath: 'lib/a.ts', binary: false }]);
    });

    it('reads a copy like a rename, with status C', () => {
      // arrange: C075 — git only reports copies when asked (`-C`); the format is the
      // rename's with a different letter, and the parser accepts it either way
      const output = 'C075\0template.md\0copy.md\0';

      // act
      const files = parseNameStatus(output);

      // assert
      expect(files).toStrictEqual([{ status: 'C', path: 'copy.md', oldPath: 'template.md', binary: false }]);
    });

    it('reports every entry as not binary — name-status cannot tell; PR 10 adds numstat, which can', () => {
      // arrange: a PNG is added; name-status has no way to say it is binary
      const output = 'A\0logo.png\0M\0a.txt\0';

      // act
      const files = parseNameStatus(output);

      // assert
      // see primer §25 (arrays: map)
      const binaryFlags = files.map((file) => file.binary);
      expect(binaryFlags).toEqual([false, false]);
    });
  });

  describe('a whole output', () => {
    it('reads every entry of a real git 2.50 output, in the order git printed them', () => {
      // arrange: REAL_OUTPUT, copied from git (see its comment)

      // act
      const files = parseNameStatus(REAL_OUTPUT);

      // assert: nine two-field entries and one three-field rename — ten entries in all
      expect(files).toStrictEqual([
        { status: 'A', path: 'added.txt', binary: false },
        { status: 'A', path: 'copied-dst.txt', binary: false },
        { status: 'D', path: 'deleted.txt', binary: false },
        { status: 'A', path: 'dir with space/file name.txt', binary: false },
        { status: 'A', path: 'hash#and?question.txt', binary: false },
        { status: 'M', path: 'modified.txt', binary: false },
        { status: 'A', path: 'new\nline.txt', binary: false },
        { status: 'R', path: 'renamed-new.txt', oldPath: 'renamed-old.txt', binary: false },
        { status: 'T', path: 'typechange.txt', binary: false },
        { status: 'A', path: 'ünïcode/fïle.txt', binary: false },
      ]);
    });

    it('returns an empty list for empty output — the layer changes nothing (the second of two branches on one commit, E6)', () => {
      // arrange: git prints nothing at all, not even a NUL, when the two trees are equal
      const output = '';

      // act
      const files = parseNameStatus(output);

      // assert
      expect(files).toEqual([]);
    });

    it('treats the NUL after the last field as the end of that entry, not the start of an empty one', () => {
      // arrange: one entry, ending in the NUL every field ends in
      const output = 'M\0only.txt\0';

      // act
      const files = parseNameStatus(output);

      // assert: one entry — a parser that split first and asked questions later would
      // see a third, empty field here and either fail on it or invent an entry
      expect(files.length).toBe(1);
    });
  });

  describe('paths are taken byte for byte (E11)', () => {
    it('keeps spaces, unicode, # and ? in a path exactly as git printed them', () => {
      // arrange: every character that would break a shell, a URL, or a tab-separated
      // line — none of them special between two NULs
      const output = 'A\0dir with space/file name.txt\0A\0ünïcode/fïle.txt\0A\0hash#and?question.txt\0';

      // act
      const files = parseNameStatus(output);

      // assert
      const paths = files.map((file) => file.path);
      expect(paths).toEqual(['dir with space/file name.txt', 'ünïcode/fïle.txt', 'hash#and?question.txt']);
    });

    it('never splits on a newline: a path containing one is one path — the reason for -z', () => {
      // arrange: `new\nline.txt` is a single file whose name has a newline in it; without
      // `-z` git would have printed it as the quoted text "new\nline.txt"
      const output = 'A\0new\nline.txt\0';

      // act
      const files = parseNameStatus(output);

      // assert
      expect(files).toStrictEqual([{ status: 'A', path: 'new\nline.txt', binary: false }]);
    });

    it('keeps a tab in a path — the character that separates fields without -z', () => {
      // arrange
      const output = 'M\0with\ttab.txt\0';

      // act
      const files = parseNameStatus(output);

      // assert
      expect(files[0].path).toBe('with\ttab.txt');
    });
  });

  describe('what it refuses', () => {
    it('throws naming the letter for a status it does not know, rather than guessing', () => {
      // arrange: `X` is git's "unknown" — it should never appear; if it does, the
      // command or the parser's assumptions are wrong and the tree must say so
      const output = 'X\0mystery.txt\0';

      // act
      const attempt = () => parseNameStatus(output);

      // assert
      // see primer §20 (regular expressions)
      expect(attempt).toThrow(/unknown status "X"/);
    });

    it('throws when the output ends before an entry has its path', () => {
      // arrange: a status letter with nothing after it
      const output = 'A\0';

      // act
      const attempt = () => parseNameStatus(output);

      // assert
      expect(attempt).toThrow(/ended before the path/);
    });

    it('throws when a rename has its old path but not its new one', () => {
      // arrange
      const output = 'R100\0old.txt\0';

      // act
      const attempt = () => parseNameStatus(output);

      // assert
      expect(attempt).toThrow(/ended before the new path/);
    });
  });
});

// see primer §6 (async / await)
describe('changedFiles', () => {
  it('asks git for exactly `diff --name-status -M -z <parentSha> <sha> --`, in the root', async () => {
    // arrange
    // see primer §19 (Map)
    const git = new FakeGitRunner(new Map([[DIFF_KEY, 'A\0b\0']]));

    // act
    await changedFiles(git, ROOT, PARENT_SHA, SHA);

    // assert: one command, the two SHAs in parent-then-layer order (a tree diff, not a
    // merge-base one), rename detection on, NUL separators on, `--` closing the list of
    // revisions so no file can be mistaken for one, and nothing else
    expect(git.calls).toEqual([{ args: DIFF_ARGS, cwd: ROOT }]);
  });

  it('returns the parsed entries', async () => {
    // arrange: the fixture builder's second layer adds the one file `b`
    const git = new FakeGitRunner(new Map([[DIFF_KEY, 'A\0b\0']]));

    // act
    const files = await changedFiles(git, ROOT, PARENT_SHA, SHA);

    // assert
    expect(files).toStrictEqual([{ status: 'A', path: 'b', binary: false }]);
  });

  it('rejects with the runner\'s own error when git fails — a `run`, never a `tryRun` (E17)', async () => {
    // arrange: git exits non-zero (the repository vanished, a SHA that no longer
    // resolves after a gc, git itself missing); an empty list would hide it
    const failure = new Error('fatal: bad object bbbbbbbb');
    // No type arguments on this Map even though its value is an Error, not a string: the
    // compiler infers Map<string, Error>, and a map that only ever holds errors is an
    // acceptable Map<string, string | Error> for the fake to read from (primer §19).
    // git.test.ts spells the types out because its one literal mixes the two kinds.
    const git = new FakeGitRunner(new Map([[DIFF_KEY, failure]]));

    // act
    const result = changedFiles(git, ROOT, PARENT_SHA, SHA);

    // assert: the very same error the runner threw
    await expect(result).rejects.toBe(failure);
  });
});
