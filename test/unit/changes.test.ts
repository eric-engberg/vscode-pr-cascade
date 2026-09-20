/**
 * test/unit/changes.test.ts — parseNameStatus, parseNumstat and changedFiles as a
 * specification: the `git diff --name-status -M -z` and `git diff --numstat -M -z`
 * formats entry by entry, and the two commands changedFiles runs and how it pairs their
 * answers — all on canned output, some of it copied byte for byte from git 2.50.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code; FakeGitRunner).
 * Depends on: src/core/changes.ts, test/helpers/fakeGit.ts. Plan: §10.1 M2 items 7–8,
 * §5 both rows, §8 E7–E11/E17, §9.4.
 */

// see primer §1 (import / export)
import { describe, expect, it } from 'vitest';
import { changedFiles, parseNameStatus, parseNumstat } from '../../src/core/changes';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository the changedFiles tests ask about, and the two SHAs a LayerNode would
// hand over: the layer's own commit and its parent's (core/stack.ts). Nothing here
// touches the disk.
// see primer §4 (const)
const ROOT = '/work/app';
const PARENT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// The two commands changedFiles runs: as the fake keys them (args joined by spaces),
// and as the argument lists it must pass to the runner.
// see primer §12 (template strings)
const NAME_STATUS_KEY = `diff --name-status -M -z ${PARENT_SHA} ${SHA} --`;
const NAME_STATUS_ARGS = ['diff', '--name-status', '-M', '-z', PARENT_SHA, SHA, '--'];
const NUMSTAT_KEY = `diff --numstat -M -z ${PARENT_SHA} ${SHA} --`;
const NUMSTAT_ARGS = ['diff', '--numstat', '-M', '-z', PARENT_SHA, SHA, '--'];

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

/**
 * What git 2.50.1 printed for the two commands on one more repository, built to hold
 * every shape numstat has (2026-09-20, hermetic temp repo). Between `base` and `top`:
 * `added.txt` added; `blob-old.bin`, a binary, renamed unchanged to `blob-new.bin`;
 * `gone.txt` deleted; `image.png`, a binary, modified; `keep.txt` replaced by a
 * symlink; `old-name.txt` renamed unchanged to `new-name.txt`; `new.png`, a binary,
 * added; `text.txt` modified (two lines added, one removed). "Binary" here means the
 * file's bytes include a NUL, which is what git looks for.
 *
 * Read the numstat one against the name-status one line by line: a plain entry is
 * `<added>\t<deleted>\t<path>\0` and a binary one has `-` for both counts; a rename is
 * the counts, an *empty* path, and then the old and new paths as two more NUL-ended
 * pieces — `0\t0\t\0old-name.txt\0new-name.txt\0` — the shape the parser has to tell
 * apart from a plain entry by that empty path. (Each entry is its own literal on its
 * own line because a `\0` directly followed by a digit would be read as an octal
 * escape, primer §44, and every numstat entry starts with one.)
 */
const PROBE_NAME_STATUS =
  'A\0added.txt\0' +
  'R100\0blob-old.bin\0blob-new.bin\0' +
  'D\0gone.txt\0' +
  'M\0image.png\0' +
  'T\0keep.txt\0' +
  'R100\0old-name.txt\0new-name.txt\0' +
  'A\0new.png\0' +
  'M\0text.txt\0';
const PROBE_NUMSTAT =
  '1\t0\tadded.txt\0' +
  '-\t-\t\0blob-old.bin\0blob-new.bin\0' +
  '0\t1\tgone.txt\0' +
  '-\t-\timage.png\0' +
  '1\t1\tkeep.txt\0' +
  '0\t0\t\0old-name.txt\0new-name.txt\0' +
  '-\t-\tnew.png\0' +
  '2\t1\ttext.txt\0';

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

    it('reports every entry as not binary — name-status cannot tell; changedFiles fills that in from numstat', () => {
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

describe('parseNumstat', () => {
  describe('one entry per file', () => {
    it('reads a text file: lines added, lines deleted, then the path — not binary', () => {
      // arrange: three lines added and one removed in src/app.ts
      const output = '3\t1\tsrc/app.ts\0';

      // act
      const entries = parseNumstat(output);

      // assert: the counts are not kept; only what they say about the file is
      expect(entries).toStrictEqual([{ path: 'src/app.ts', binary: false }]);
    });

    it('reads a binary file: `-` for both counts (E10)', () => {
      // arrange: git found a NUL byte in logo.png and refused to count lines
      const output = '-\t-\tlogo.png\0';

      // act
      const entries = parseNumstat(output);

      // assert
      expect(entries).toStrictEqual([{ path: 'logo.png', binary: true }]);
    });

    it('reads a rename as the counts, an empty path, then the old and new paths — and keeps the new one (E7)', () => {
      // arrange: PROBE_NUMSTAT's sixth entry, byte for byte — what git 2.50.1 printed
      // after `git mv old-name.txt new-name.txt`: no lines changed, so `0\t0\t`, then a
      // NUL at once where the path would be, then the two paths
      const output = '0\t0\t\0old-name.txt\0new-name.txt\0';

      // act
      const entries = parseNumstat(output);

      // assert: `path` is where the file is at the layer, the same string
      // parseNameStatus puts in ChangedFile.path for this rename
      expect(entries).toStrictEqual([{ path: 'new-name.txt', binary: false }]);
    });

    it('reads a rename with an edit the same way', () => {
      // arrange: what git printed after `git mv text.txt moved.txt` plus one added line
      // — the rename shape, with a real count in front
      const output = '1\t0\t\0text.txt\0moved.txt\0';

      // act
      const entries = parseNumstat(output);

      // assert
      expect(entries).toStrictEqual([{ path: 'moved.txt', binary: false }]);
    });

    it('reads a binary rename: `-` counts in the rename shape (E7, E10)', () => {
      // arrange: PROBE_NUMSTAT's second entry — a moved binary
      const output = '-\t-\t\0blob-old.bin\0blob-new.bin\0';

      // act
      const entries = parseNumstat(output);

      // assert
      expect(entries).toStrictEqual([{ path: 'blob-new.bin', binary: true }]);
    });
  });

  describe('a whole output', () => {
    it('reads every entry of a real git 2.50 output, in the order git printed them', () => {
      // arrange: PROBE_NUMSTAT, copied from git (see its comment)

      // act
      const entries = parseNumstat(PROBE_NUMSTAT);

      // assert: six one-piece entries and two three-piece renames — eight entries, three
      // of them binary
      expect(entries).toStrictEqual([
        { path: 'added.txt', binary: false },
        { path: 'blob-new.bin', binary: true },
        { path: 'gone.txt', binary: false },
        { path: 'image.png', binary: true },
        { path: 'keep.txt', binary: false },
        { path: 'new-name.txt', binary: false },
        { path: 'new.png', binary: true },
        { path: 'text.txt', binary: false },
      ]);
    });

    it('returns an empty list for empty output', () => {
      // arrange: nothing changed, so git printed nothing at all
      const output = '';

      // act
      const entries = parseNumstat(output);

      // assert
      expect(entries).toEqual([]);
    });

    it('treats the NUL after the last entry as its end, not the start of an empty one', () => {
      // arrange
      const output = '1\t1\tonly.txt\0';

      // act
      const entries = parseNumstat(output);

      // assert
      expect(entries.length).toBe(1);
    });
  });

  describe('paths are taken byte for byte (E11)', () => {
    it('keeps a tab in a path: only the first two tabs of an entry separate columns', () => {
      // arrange: a file called `with<tab>tab.txt` — three tabs in the entry, two of
      // them columns, one of them the path's own
      const output = '1\t0\twith\ttab.txt\0';

      // act
      const entries = parseNumstat(output);

      // assert
      expect(entries).toStrictEqual([{ path: 'with\ttab.txt', binary: false }]);
    });

    it('keeps a newline in a path: -z means git never quotes it', () => {
      // arrange
      const output = '1\t0\tnew\nline.txt\0';

      // act
      const entries = parseNumstat(output);

      // assert
      expect(entries[0].path).toBe('new\nline.txt');
    });
  });

  describe('what it refuses', () => {
    it('throws when an entry has fewer than two tabs — that is not numstat output', () => {
      // arrange: one tab, so there is no second count and no path column
      const output = '1\tonly-one-tab.txt\0';

      // act
      const attempt = () => parseNumstat(output);

      // assert
      expect(attempt).toThrow(/without its two counts/);
    });

    it('throws naming the counts when they are neither digits nor "-", rather than calling the file text', () => {
      // arrange
      const output = 'x\t0\tfile.txt\0';

      // act
      const attempt = () => parseNumstat(output);

      // assert
      expect(attempt).toThrow(/neither digits nor "-": "x" and "0"/);
    });

    it('throws when a rename ends before its new path', () => {
      // arrange: the rename shape with only the old path after it
      const output = '0\t0\t\0old.txt\0';

      // act
      const attempt = () => parseNumstat(output);

      // assert
      expect(attempt).toThrow(/ended before the new path/);
    });
  });
});

// see primer §6 (async / await)
describe('changedFiles', () => {
  /** A fake that answers both commands: the two outputs a real git would print for one layer. */
  // see primer §19 (Map)
  function fakeGitAnswering(nameStatusOutput: string, numstatOutput: string): FakeGitRunner {
    return new FakeGitRunner(
      new Map([
        [NAME_STATUS_KEY, nameStatusOutput],
        [NUMSTAT_KEY, numstatOutput],
      ]),
    );
  }

  it('asks git for name-status and then numstat — both -M -z over the same two SHAs and a closing --, in the root — and nothing else', async () => {
    // arrange
    const git = fakeGitAnswering('A\0b\0', '1\t0\tb\0');

    // act
    await changedFiles(git, ROOT, PARENT_SHA, SHA);

    // assert: two commands, the two SHAs in parent-then-layer order on both (a tree
    // diff, not a merge-base one), rename detection and NUL separators on both, and
    // `--` closing the list of revisions on both so no file can be mistaken for one
    expect(git.calls).toEqual([
      { args: NAME_STATUS_ARGS, cwd: ROOT },
      { args: NUMSTAT_ARGS, cwd: ROOT },
    ]);
  });

  it('returns the name-status entries with `binary` filled in from numstat — the two real outputs of one repository, paired', async () => {
    // arrange: PROBE_NAME_STATUS and PROBE_NUMSTAT, from the same two commits
    const git = fakeGitAnswering(PROBE_NAME_STATUS, PROBE_NUMSTAT);

    // act
    const files = await changedFiles(git, ROOT, PARENT_SHA, SHA);

    // assert: every status letter and both rename paths from the first command; the
    // three binaries — a moved one, an edited one, a new one — from the second
    expect(files).toStrictEqual([
      { status: 'A', path: 'added.txt', binary: false },
      { status: 'R', path: 'blob-new.bin', oldPath: 'blob-old.bin', binary: true },
      { status: 'D', path: 'gone.txt', binary: false },
      { status: 'M', path: 'image.png', binary: true },
      { status: 'T', path: 'keep.txt', binary: false },
      { status: 'R', path: 'new-name.txt', oldPath: 'old-name.txt', binary: false },
      { status: 'A', path: 'new.png', binary: true },
      { status: 'M', path: 'text.txt', binary: false },
    ]);
  });

  it('marks a file binary exactly when numstat printed `-` for it (E10)', async () => {
    // arrange: a PNG added and a text file edited in the same layer
    const git = fakeGitAnswering('A\0logo.png\0M\0a.txt\0', '-\t-\tlogo.png\0' + '1\t1\ta.txt\0');

    // act
    const files = await changedFiles(git, ROOT, PARENT_SHA, SHA);

    // assert
    const binaryFlags = files.map((file) => file.binary);
    expect(binaryFlags).toEqual([true, false]);
  });

  it('pairs a rename by its new path, the one both commands print last', async () => {
    // arrange: a binary moved; name-status names both paths, numstat the same two
    const git = fakeGitAnswering('R100\0old.bin\0new.bin\0', '-\t-\t\0old.bin\0new.bin\0');

    // act
    const files = await changedFiles(git, ROOT, PARENT_SHA, SHA);

    // assert
    expect(files).toStrictEqual([{ status: 'R', path: 'new.bin', oldPath: 'old.bin', binary: true }]);
  });

  it('leaves a file text when numstat does not mention it', async () => {
    // arrange: a numstat with nothing in it — not something git does, but the rule
    // when the two lists differ: no `-` means not binary
    const git = fakeGitAnswering('A\0a\0', '');

    // act
    const files = await changedFiles(git, ROOT, PARENT_SHA, SHA);

    // assert
    expect(files).toStrictEqual([{ status: 'A', path: 'a', binary: false }]);
  });

  it('ignores a path only numstat mentions — name-status decides which files exist', async () => {
    // arrange: numstat knows a binary name-status never listed
    const git = fakeGitAnswering('A\0a\0', '-\t-\textra.png\0' + '1\t0\ta\0');

    // act
    const files = await changedFiles(git, ROOT, PARENT_SHA, SHA);

    // assert: one entry, and `extra.png` is not it
    expect(files).toStrictEqual([{ status: 'A', path: 'a', binary: false }]);
  });

  it('rejects with the runner\'s own error when name-status fails — a `run`, never a `tryRun` (E17)', async () => {
    // arrange: git exits non-zero (the repository vanished, a SHA that no longer
    // resolves after a gc, git itself missing); an empty list would hide it
    const failure = new Error('fatal: bad object bbbbbbbb');
    // No type arguments on this Map even though its value is an Error, not a string: the
    // compiler infers Map<string, Error>, and a map that only ever holds errors is an
    // acceptable Map<string, string | Error> for the fake to read from (primer §19).
    // git.test.ts spells the types out because its one literal mixes the two kinds.
    const git = new FakeGitRunner(new Map([[NAME_STATUS_KEY, failure]]));

    // act
    const result = changedFiles(git, ROOT, PARENT_SHA, SHA);

    // assert: the very same error the runner threw
    await expect(result).rejects.toBe(failure);
  });

  it('rejects with the runner\'s own error when numstat fails, even though name-status succeeded (E17)', async () => {
    // arrange: the first command answers, the second does not. This Map mixes a string
    // and an Error, so its types are spelled out (primer §19).
    const failure = new Error('fatal: bad object bbbbbbbb');
    const git = new FakeGitRunner(
      new Map<string, string | Error>([
        [NAME_STATUS_KEY, 'A\0a\0'],
        [NUMSTAT_KEY, failure],
      ]),
    );

    // act
    const result = changedFiles(git, ROOT, PARENT_SHA, SHA);

    // assert: no half answer with every file called text
    await expect(result).rejects.toBe(failure);
  });
});
