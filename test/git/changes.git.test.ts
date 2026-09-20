/**
 * test/git/changes.git.test.ts — changedFiles against real repositories built by the
 * fixture builder: what git actually prints for each kind of change, read through both
 * parsers end to end. The unit tests pin the two formats on quoted output; these check
 * that a real add, edit, delete, rename, type change, binary file, awkward path and
 * 1500-file layer come back as the ChangedFiles the tree will show. Layer: test, git
 * integration (plan §9.1 layer 2; Vitest, real git in throwaway directories, no VS
 * Code). Depends on: src/core/changes.ts, src/core/git.ts, test/helpers/fixture.ts.
 * Plan: §10.1 M2 item 8, §8 E6/E7/E8/E9/E10/E11/E17/E18, §9.3, §9.4 row
 * "git/changes.git.test.ts", §10 M2 "done when" (each layer shows only its own files).
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { changedFiles } from '../../src/core/changes';
import { GitError, RealGitRunner } from '../../src/core/git';
import type { ChangedFile } from '../../src/core/model';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';

// The trunk every fixture has: buildStack creates a bare origin and fetches it, so this is
// exactly what detectTrunk (PR 4) would answer for these repositories.
// see primer §4 (const)
const TRUNK = 'origin/main';

// `git` is the runner under test: it spawns git with process.env, so the hermetic variables
// are stubbed on process.env for the whole file. `fixture.git(...)`, seen alongside it in
// every block, is the fixture builder's synchronous helper (with its own environment; see
// its header), used only to set a situation up and to resolve branch names to SHAs.
const git = new RealGitRunner();

// A throwaway directory that stands in for HOME, so git never finds the developer's own
// ~/.gitconfig. Removed in afterAll.
let homeDir: string;

// see primer §5 (arrow functions) and §6 (async / await)
beforeAll(async () => {
  homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-changes-test-'));
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

/**
 * changedFiles for the layer `branch` against `parent`, the two names resolved to SHAs
 * first: changedFiles takes SHAs, never names (its doc comment says why), and the tree
 * gets them from the RepoState core/stack.ts built; here `git rev-parse` stands in for
 * that. `git()` (the runner under test) does the diff; `fixture.git()` only the lookup.
 */
async function filesOfLayer(fixture: Fixture, parent: string, branch: string): Promise<ChangedFile[]> {
  // see primer §23 (string methods: trim — a SHA can contain no whitespace)
  const parentSha = fixture.git(['rev-parse', parent]).trim();
  const sha = fixture.git(['rev-parse', branch]).trim();
  return changedFiles(git, fixture.dir, parentSha, sha);
}

/**
 * Stages everything in the working tree — new, changed and deleted files, renames git
 * will pair up itself — and commits it on the branch HEAD is on. Every block below
 * shapes its layer this way after buildStack has left HEAD on the top layer.
 */
function commitEverything(fixture: Fixture, message: string): void {
  fixture.git(['add', '-A']);
  fixture.git(['commit', '-q', '-m', message]);
}

/**
 * Writes `content` to `relativePath` inside the repository, creating the directories on
 * the way there (`mkdir -p`) — the E11 paths live in subdirectories, and the E18 layer
 * puts its 1500 files under one.
 */
// see primer §28 (the Sync variants of Node's functions: mkdirSync with `recursive`)
function writeFile(fixture: Fixture, relativePath: string, content: string): void {
  const fullPath = path.join(fixture.dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

// The situations, one `describe` each, every one on its own fixture so the layers
// shaped in one block never show up in another: the Appendix A stack as built (E8, per
// layer not cumulative, E6, E17); a layer that edits, moves, deletes and re-types files
// its parent has (E7, E9, and the copy that is not a `C`); binary files, added, moved
// and edited (E10); paths git would have to quote without `-z` (E11); and a layer of
// 1500 files (E18).
describe('changedFiles (real git)', () => {
  describe('the Appendix A stack as built', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('lists the one file the bottom layer adds, as an addition (E8)', async () => {
      // arrange: nothing beyond the fixture — api-refactor adds `a` on top of trunk's `f`

      // act
      const files = await filesOfLayer(fixture, TRUNK, 'api-refactor');

      // assert
      expect(files).toStrictEqual([{ status: 'A', path: 'a', binary: false }]);
    });

    it('lists only what each layer itself changes, never what the layers below it did (M2 "done when")', async () => {
      // arrange: nothing beyond the fixture — add-retries adds `b` on top of
      // api-refactor's `a`, and retry-metrics adds `c` on top of both

      // act
      const middle = await filesOfLayer(fixture, 'api-refactor', 'add-retries');
      const top = await filesOfLayer(fixture, 'add-retries', 'retry-metrics');

      // assert: `a` is in both snapshots the middle layer is measured between, so it is
      // not a change of that layer — a tree diff of parent and layer, not of trunk and
      // layer, is what makes the list per layer
      // see primer §25 (arrays: map)
      expect(middle.map((file) => file.path)).toEqual(['b']);
      expect(top.map((file) => file.path)).toEqual(['c']);
    });

    it('returns an empty list for a second branch on the same commit — the same SHA on both sides (E6)', async () => {
      // arrange: a second name for the bottom layer's commit. computeStack lists it right
      // after api-refactor with api-refactor as its parent, so its parentSha is its own sha.
      fixture.git(['branch', 'api-refactor-backup', 'api-refactor']);

      // act
      const files = await filesOfLayer(fixture, 'api-refactor', 'api-refactor-backup');

      // assert: git prints nothing at all for two equal trees, and nothing is what the
      // tree shows — "second has 0 files vs first"
      expect(files).toEqual([]);
    });

    it('rejects with a GitError when a SHA does not exist, rather than answering with an empty list (E17)', async () => {
      // arrange: a SHA no object has — forty zeros (`repeat`, primer §23); git says
      // `fatal: bad object` and exits 128
      const noSuchSha = '0'.repeat(40);
      const sha = fixture.git(['rev-parse', 'api-refactor']).trim();

      // act
      const result = changedFiles(git, fixture.dir, noSuchSha, sha);

      // assert: Vitest's own instanceof check — git.git.test.ts's `expectGitError` returns
      // the error so its fields can be read; here only the class matters
      await expect(result).rejects.toBeInstanceOf(GitError);
    });
  });

  describe('a layer that changes files its parent already has', () => {
    let fixture: Fixture;

    beforeAll(() => {
      // Four layers rather than Appendix A's three: the top layer, `polish`, needs four
      // files from below it — `f` from trunk and `a`, `b`, `c` from the layers — to show
      // an edit, a rename, a deletion and a type change on one file each. buildStack
      // leaves HEAD on `polish`, so everything below is committed there, against a
      // parent (retry-metrics) that has all four.
      fixture = buildStack({ layers: ['api-refactor', 'add-retries', 'retry-metrics', 'polish'] });
      // A copy of `f` as it is, before `f` itself is edited (`cp f f-copy`).
      fs.copyFileSync(path.join(fixture.dir, 'f'), path.join(fixture.dir, 'f-copy'));
      writeFile(fixture, 'f', 'base, edited\n');
      // `git mv` moves the file and stages the move; with `-M` git pairs the old and new
      // path into one rename.
      fixture.git(['mv', 'a', 'a2']);
      fs.rmSync(path.join(fixture.dir, 'b'));
      // `c` becomes a symbolic link to `f` (`ln -s f c`): the same path holding a
      // different kind of thing, which git reports as a type change, not an edit.
      fs.rmSync(path.join(fixture.dir, 'c'));
      fs.symlinkSync('f', path.join(fixture.dir, 'c'));
      commitEverything(fixture, 'polish: edit f, move a, drop b, link c, copy f');
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('reports an edited file as M', async () => {
      // arrange: nothing beyond the fixture

      // act
      const files = await filesOfLayer(fixture, 'retry-metrics', 'polish');

      // assert
      // see primer §25 (arrays: filter)
      const edited = files.filter((file) => file.status === 'M');
      expect(edited).toStrictEqual([{ status: 'M', path: 'f', binary: false }]);
    });

    it('reports a moved file as R with the old path and the new one (E7)', async () => {
      // arrange: nothing beyond the fixture

      // act
      const files = await filesOfLayer(fixture, 'retry-metrics', 'polish');

      // assert: `oldPath` is where it was at the parent, `path` where it is now
      const moved = files.filter((file) => file.status === 'R');
      expect(moved).toStrictEqual([{ status: 'R', path: 'a2', oldPath: 'a', binary: false }]);
    });

    it('reports a deleted file as D (E9)', async () => {
      // arrange: nothing beyond the fixture

      // act
      const files = await filesOfLayer(fixture, 'retry-metrics', 'polish');

      // assert
      const deleted = files.filter((file) => file.status === 'D');
      expect(deleted).toStrictEqual([{ status: 'D', path: 'b', binary: false }]);
    });

    it('reports a file replaced by a symbolic link as T', async () => {
      // arrange: nothing beyond the fixture

      // act
      const files = await filesOfLayer(fixture, 'retry-metrics', 'polish');

      // assert: a link's content is its target, one line of text, so it is not binary
      const retyped = files.filter((file) => file.status === 'T');
      expect(retyped).toStrictEqual([{ status: 'T', path: 'c', binary: false }]);
    });

    it('reports a copied file as an addition — git pairs copies only with -C, which changedFiles does not pass', async () => {
      // arrange: nothing beyond the fixture — `f-copy` is byte for byte the old `f`

      // act
      const files = await filesOfLayer(fixture, 'retry-metrics', 'polish');

      // assert: two additions, the layer's own `d` and the copy; no `C` anywhere. A copy
      // is a new file to the tree. git pairs it with its source only when asked with
      // `-C`, and plain `-C` looks only at files changed in the same commit (`f` here —
      // so `-C` *would* have printed `C100 f f-copy`); `--find-copies-harder` widens that
      // to every file in the parent, at the cost of comparing each added file against
      // the whole tree. Neither is passed: plan §5 asks for `-M` only, and the tree draws
      // no rename/copy distinction.
      const added = files.filter((file) => file.status === 'A');
      expect(added).toStrictEqual([
        { status: 'A', path: 'd', binary: false },
        { status: 'A', path: 'f-copy', binary: false },
      ]);
    });

    it('lists every entry once, in git\'s order by path, and nothing the parent had that is unchanged', async () => {
      // arrange: nothing beyond the fixture

      // act
      const files = await filesOfLayer(fixture, 'retry-metrics', 'polish');

      // assert: six entries — a rename is listed at its new path — and no `f-copy`
      // twice, no unchanged file from below
      const paths = files.map((file) => file.path);
      expect(paths).toEqual(['a2', 'b', 'c', 'd', 'f', 'f-copy']);
    });
  });

  describe('binary files (E10)', () => {
    let fixture: Fixture;

    beforeAll(() => {
      // One layer, `add-assets`, that adds two binary files and a text file on top of
      // the builder's `a`. git calls a file binary when it finds a NUL byte in its first
      // 8000 bytes, and a `\0` in a string written to disk is exactly that byte (primer
      // §44). Then a second layer on top, made by hand because the builder commits one
      // text file per layer: it moves one binary, edits the other, and edits the text.
      fixture = buildStack({ layers: ['add-assets'] });
      writeFile(fixture, 'logo.png', 'PNG\0not a real picture, but binary to git\0');
      writeFile(fixture, 'data.bin', '\0\0\0one\0two');
      writeFile(fixture, 'notes.txt', 'notes\n');
      commitEverything(fixture, 'add-assets: two binaries and a text file');
      fixture.git(['checkout', '-q', '-b', 'use-assets']);
      fixture.git(['mv', 'logo.png', 'brand.png']);
      writeFile(fixture, 'data.bin', '\0\0\0one\0two\0three');
      writeFile(fixture, 'notes.txt', 'notes, edited\n');
      commitEverything(fixture, 'use-assets: move one binary, edit the other');
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('marks a file git considers binary — a NUL byte in its content — binary, and a text file beside it not', async () => {
      // arrange: nothing beyond the fixture

      // act
      const files = await filesOfLayer(fixture, TRUNK, 'add-assets');

      // assert: the letter comes from name-status, the flag from numstat's `-` counts
      expect(files).toStrictEqual([
        { status: 'A', path: 'a', binary: false },
        { status: 'A', path: 'data.bin', binary: true },
        { status: 'A', path: 'logo.png', binary: true },
        { status: 'A', path: 'notes.txt', binary: false },
      ]);
    });

    it('keeps the flag through a rename — numstat\'s `-` counts in its three-piece rename shape (E7, E10)', async () => {
      // arrange: nothing beyond the fixture

      // act
      const files = await filesOfLayer(fixture, 'add-assets', 'use-assets');

      // assert: paired by the new path, which both commands print last
      const moved = files.filter((file) => file.status === 'R');
      expect(moved).toStrictEqual([{ status: 'R', path: 'brand.png', oldPath: 'logo.png', binary: true }]);
    });

    it('marks an edited binary binary, and an edited text file beside it not', async () => {
      // arrange: nothing beyond the fixture

      // act
      const files = await filesOfLayer(fixture, 'add-assets', 'use-assets');

      // assert
      const edited = files.filter((file) => file.status === 'M');
      expect(edited).toStrictEqual([
        { status: 'M', path: 'data.bin', binary: true },
        { status: 'M', path: 'notes.txt', binary: false },
      ]);
    });
  });

  describe('paths git would have to quote without -z (E11)', () => {
    let fixture: Fixture;
    // Every kind of character that breaks a shell, a URL, or a tab-separated table:
    // spaces, `#`, `?`, non-ASCII letters, a newline. Each becomes a real text file.
    const awkwardPaths = ['dir with space/file name.txt', 'hash#and?question.txt', 'new\nline.txt', 'ünïcode.txt'];
    // And a tab, in the name of a *binary* file — binary on purpose: numstat's columns
    // are tab-separated, so this is the one path that can catch a parser cutting the
    // entry at every tab, and only a binary file's flag makes such a cut visible (the
    // last test says how).
    const tabbedBinaryPath = 'with\ttab.bin';

    beforeAll(() => {
      fixture = buildStack();
      // Committed on the top layer, retry-metrics, next to its own `c`.
      // see primer §22 (for ... of)
      for (const relativePath of awkwardPaths) {
        writeFile(fixture, relativePath, `${relativePath}\n`);
      }
      // A NUL byte in the content is what makes git call it binary (as in the E10 block).
      writeFile(fixture, tabbedBinaryPath, 'tab\0binary\0');
      commitEverything(fixture, 'retry-metrics: paths git would quote');
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('returns every path exactly as it is on disk — spaces, #, ?, unicode, a newline, a tab', async () => {
      // arrange: nothing beyond the fixture

      // act
      const files = await filesOfLayer(fixture, 'add-retries', 'retry-metrics');

      // assert: git orders by path, byte by byte — `c` (the layer's own file), then `d`,
      // `h`, `n`, `w`, and `ü` last, because its first byte (0xC3) is above every ASCII
      // letter. Without `-z` the last three would have come back quoted:
      // "new\nline.txt", "with\ttab.bin", "\303\274n\303\257code.txt".
      const paths = files.map((file) => file.path);
      expect(paths).toEqual(['c', 'dir with space/file name.txt', 'hash#and?question.txt', 'new\nline.txt', 'with\ttab.bin', 'ünïcode.txt']);
    });

    it('reads a numstat entry whole when the path itself contains a tab: the binary flag lands on `with\\ttab.bin`', async () => {
      // arrange: nothing beyond the fixture. numstat prints `-<tab>-<tab>with<tab>tab.bin`
      // for the binary file: three tabs, two of them columns and one the path's own. A
      // parser that cut at every tab would take `with` as the path — a name no entry in
      // the name-status list has — so the flag would pair with nothing and the real file
      // would come back `false`, which is what the assertion below refuses.

      // act
      const files = await filesOfLayer(fixture, 'add-retries', 'retry-metrics');

      // assert: exactly one binary entry, and it is the tab-named file
      const binaryFiles = files.filter((file) => file.binary);
      expect(binaryFiles).toStrictEqual([{ status: 'A', path: 'with\ttab.bin', binary: true }]);
    });
  });

  describe('a large layer (E18)', () => {
    let fixture: Fixture;
    // The 1500 paths, in the order they are made — which is git's order too, thanks to
    // the zero-padded numbers.
    // see primer §25 (arrays: a typed empty array)
    const generatedPaths: string[] = [];

    beforeAll(() => {
      fixture = buildStack({ layers: ['bulk'] });
      // 1500 files under `many/`, numbered with leading zeros (`padStart`, primer §23)
      // so that git's order — by path, byte by byte — is the order they were made in:
      // `file-0002` sorts before `file-0010`, where `file-2` would not.
      // see primer §29 (counted for loops)
      for (let index = 0; index < 1500; index++) {
        const relativePath = `many/file-${String(index).padStart(4, '0')}.txt`;
        writeFile(fixture, relativePath, `${index}\n`);
        generatedPaths.push(relativePath);
      }
      commitEverything(fixture, 'bulk: 1500 files');
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('lists all 1500 files after the layer\'s own `a`, in git\'s order, with no output-size error', async () => {
      // arrange: nothing beyond the fixture. Two commands each print some 30 KB here —
      // far below the runner's 32 MB ceiling, and the same shape at any size.

      // act
      const files = await filesOfLayer(fixture, TRUNK, 'bulk');

      // assert: 1501 entries — `a`, then the 1500 in order (array `slice`, primer §25)
      const paths = files.map((file) => file.path);
      expect(paths.length).toBe(1501);
      expect(paths[0]).toBe('a');
      expect(paths.slice(1)).toEqual(generatedPaths);
    });

    it('reports every one of them as an addition and none as binary', async () => {
      // arrange: nothing beyond the fixture

      // act
      const files = await filesOfLayer(fixture, TRUNK, 'bulk');

      // assert: the set of distinct statuses is exactly {A}, of distinct flags exactly {false}
      // see primer §21 (Set: a collection with no duplicates)
      const statuses = new Set(files.map((file) => file.status));
      const binaryFlags = new Set(files.map((file) => file.binary));
      expect(Array.from(statuses)).toEqual(['A']);
      expect(Array.from(binaryFlags)).toEqual([false]);
    });
  });
});
