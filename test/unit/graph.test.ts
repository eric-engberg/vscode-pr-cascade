/**
 * test/unit/graph.test.ts — core/graph.ts as a specification: the three git commands spelled and
 * their texts handed back as they are, the three parsers, and plan E78 — every stack in the
 * repository laid out in lanes — as a table of shapes against hand-written texts.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on:
 * src/core/graph.ts, test/helpers/fakeGit.ts (for readGraphInput's three commands and E17 only;
 * the parsers and the layout take texts, so the rest needs no runner). What real git prints for
 * these shapes, and the agreement with computeStack, is test/git/graph.git.test.ts. Plan: §7.1.1,
 * §7.2.1, §8 E78 (E3/E5/E6/E14/E15/E16 as they read in the graph), §9.4 `unit/graph`, §10.1 item
 * 23a (M6), §13.2 D67.
 */

// see primer §1 (import / export)
import { describe, expect, it } from 'vitest';
import { REFS_ARGS, dagArgs, parseDag, parseRefs, parseTrunkTip, readGraphInput, trunkTipArgs } from '../../src/core/graph';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository every test asks about, and the trunk detectTrunk would have found for it.
// see primer §4 (const)
const ROOT = '/work/app';
const TRUNK = 'origin/main';

// Every refs line's third column, and the trunk tip's second — two different numbers, so a test
// can tell which text a date came from.
const DATE = 1760000000;
const TRUNK_DATE = 1760000900;

// Made-up SHAs, 40 hex characters like git's, readable in a failure: a letter or digit repeated
// stands for the branch of that letter below; T is trunk's tip, OLD and OLDER two trunk commits
// behind it — the fork points of stale stacks (a parent that is not itself a DAG line, F1).
const SHA_T = '0000000000000000000000000000000000000000';
const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SHA_C = 'cccccccccccccccccccccccccccccccccccccccc';
const SHA_D = 'dddddddddddddddddddddddddddddddddddddddd';
const SHA_F = 'ffffffffffffffffffffffffffffffffffffffff';

// What `rev-list -1 --no-commit-header --format='%H %ct'` prints for trunk: its tip and the date.
// see primer §12 (template strings)
const TRUNK_TIP = `${SHA_T} ${TRUNK_DATE}\n`;

/**
 * A refs text as `for-each-ref` prints it: `<name> <sha> <date>` per line, in the order given
 * (the callers keep for-each-ref's name order, so the tests never rely on the parser sorting).
 */
// see primer §54 (destructuring a pair in a parameter), §25 (arrays: map, join) and §78 (a tuple
// type: `[string, string]` is a pair)
function refs(...entries: [string, string][]): string {
  return entries.map(([name, sha]) => `${name} ${sha} ${DATE}\n`).join('');
}

/** A DAG text as `rev-list --parents` prints it: the commit, then its parents, one line each. */
function dag(...lines: string[][]): string {
  return lines.map((line) => `${line.join(' ')}\n`).join('');
}

// The plan Appendix A stack as the two commands print it: for-each-ref in name order (so
// `add-retries` before `api-refactor`, the bottom layer, and the local `main` among them), rev-list
// newest first — the parser must not care about either order.
const APPENDIX_A_REFS = refs(['add-retries', SHA_B], ['api-refactor', SHA_A], ['main', SHA_T], ['retry-metrics', SHA_C]);
const APPENDIX_A_DAG = dag([SHA_C, SHA_B], [SHA_B, SHA_A], [SHA_A, SHA_T]);

// see primer §5 (arrow functions) and §6 (async / await)
describe('readGraphInput', () => {
  // The fake's keys: each command's arguments joined by spaces, as FakeGitRunner keys them.
  const REFS_KEY = REFS_ARGS.join(' ');
  const DAG_KEY = dagArgs(TRUNK).join(' ');
  const TIP_KEY = trunkTipArgs(TRUNK).join(' ');

  it("runs for-each-ref over refs/heads with the date column, rev-list --parents --branches --not <trunk>, then rev-list -1 for trunk's tip — all in the root — and hands the three texts back untouched", async () => {
    // arrange
    const git = new FakeGitRunner(
      new Map([
        [REFS_KEY, APPENDIX_A_REFS],
        [DAG_KEY, APPENDIX_A_DAG],
        [TIP_KEY, TRUNK_TIP],
      ]),
    );

    // act
    const input = await readGraphInput(git, ROOT, TRUNK);

    // assert: verbatim, trailing newlines and all; the argv spelled out, not built from the
    // constants, so the constants are pinned too
    expect(input).toStrictEqual({ refs: APPENDIX_A_REFS, dag: APPENDIX_A_DAG, trunkTip: TRUNK_TIP });
    expect(git.calls).toStrictEqual([
      { args: ['for-each-ref', '--format=%(refname:lstrip=2) %(objectname) %(committerdate:unix)', 'refs/heads'], cwd: ROOT },
      { args: ['rev-list', '--parents', '--branches', '--not', 'origin/main'], cwd: ROOT },
      { args: ['rev-list', '-1', '--no-commit-header', '--format=%H %ct', 'origin/main^{commit}'], cwd: ROOT },
    ]);
  });

  it('hands back an empty rev-list text as it is — a trunk-only repository is an answer, not an error (F2)', async () => {
    // arrange
    const git = new FakeGitRunner(
      new Map([
        [REFS_KEY, refs(['main', SHA_T])],
        [DAG_KEY, ''],
        [TIP_KEY, TRUNK_TIP],
      ]),
    );

    // act
    const input = await readGraphInput(git, ROOT, TRUNK);

    // assert
    expect(input.dag).toBe('');
  });

  it('rejects when any of the three fails — a failing git is E17, never an empty graph', async () => {
    // arrange: `run`, not `tryRun` — a tryRun would have answered null here
    const failure = new Error('fatal: bad revision');
    const git = new FakeGitRunner(
      new Map<string, string | Error>([
        [REFS_KEY, APPENDIX_A_REFS],
        [DAG_KEY, failure],
        [TIP_KEY, TRUNK_TIP],
      ]),
    );

    // act and assert
    await expect(readGraphInput(git, ROOT, TRUNK)).rejects.toBe(failure);
  });
});

describe('parseRefs', () => {
  it('is empty for an empty text', () => {
    expect(parseRefs('')).toStrictEqual([]);
  });

  it('reads one line into a name, a SHA and the date as a number', () => {
    // act
    const entries = parseRefs(refs(['main', SHA_T]));

    // assert: a number, not the text "1760000000" — computeStack's `'1\n'`-is-not-`1` lesson
    expect(entries).toStrictEqual([{ name: 'main', sha: SHA_T, committedAt: DATE }]);
  });

  it('keeps two names on one SHA as two entries, in the order git printed them (E6)', () => {
    // act
    const entries = parseRefs(refs(['api-refactor', SHA_A], ['api-refactor-backup', SHA_A]));

    // assert
    expect(entries.map((entry) => entry.name)).toEqual(['api-refactor', 'api-refactor-backup']);
    expect(entries.map((entry) => entry.sha)).toEqual([SHA_A, SHA_A]);
  });

  it('keeps a name with slashes and non-ASCII letters whole — a branch name has no spaces, so the two spaces split the line', () => {
    // act
    const entries = parseRefs(refs(['feat/FWRK-1434-part1', SHA_A], ['fix/ünïcode', SHA_B]));

    // assert
    expect(entries.map((entry) => entry.name)).toEqual(['feat/FWRK-1434-part1', 'fix/ünïcode']);
  });

  it('reads a text with or without the trailing newline the same way', () => {
    // arrange
    const withNewline = refs(['add-retries', SHA_B], ['api-refactor', SHA_A]);
    const withoutNewline = withNewline.slice(0, -1);

    // act and assert
    expect(parseRefs(withoutNewline)).toEqual(parseRefs(withNewline));
  });
});

describe('parseDag', () => {
  it('is empty for an empty text (F2)', () => {
    expect(parseDag('').size).toBe(0);
  });

  it('maps a commit to its one parent', () => {
    expect(parseDag(dag([SHA_A, SHA_T])).get(SHA_A)).toEqual([SHA_T]);
  });

  it('keeps both parents of a merge, first parent first (F4)', () => {
    expect(parseDag(dag([SHA_F, SHA_D, SHA_T])).get(SHA_F)).toEqual([SHA_D, SHA_T]);
  });

  it('keeps a parent that is not itself a line — the fork point, a trunk commit (F1)', () => {
    // act
    const commits = parseDag(APPENDIX_A_DAG);

    // assert: the bottom layer's parent is trunk's commit, which no line starts with
    expect(commits.get(SHA_A)).toEqual([SHA_T]);
    expect(commits.has(SHA_T)).toBe(false);
  });

  it("gives a commit with no parent an empty list — an orphan branch's first commit, or a shallow clone's graft", () => {
    expect(parseDag(dag([SHA_A])).get(SHA_A)).toEqual([]);
  });

  it('does not depend on line order (F8)', () => {
    // arrange: the same three lines, oldest first instead of newest first
    const reversed = dag([SHA_A, SHA_T], [SHA_B, SHA_A], [SHA_C, SHA_B]);

    // act and assert
    expect(parseDag(reversed)).toEqual(parseDag(APPENDIX_A_DAG));
  });
});

describe('parseTrunkTip', () => {
  it("reads trunk's one line into its SHA and the date as a number", () => {
    expect(parseTrunkTip(TRUNK_TIP)).toStrictEqual({ sha: SHA_T, committedAt: TRUNK_DATE });
  });

  it('throws, naming the text, when git printed anything but one `<sha> <date>` line — the command is `run`, so an empty text is git misbehaving, not an answer', () => {
    expect(() => parseTrunkTip('')).toThrow('parseTrunkTip');
  });
});
