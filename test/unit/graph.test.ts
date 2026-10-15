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
import { REFS_ARGS, dagArgs, layoutGraph, parseDag, parseRefs, parseTrunkTip, readGraphInput, trunkTipArgs } from '../../src/core/graph';
import type { GraphLayout, GraphRow, NodeKind } from '../../src/core/graph';
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
const SHA_OLD = '9999999999999999999999999999999999999999';
const SHA_OLDER = '8888888888888888888888888888888888888888';
const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SHA_C = 'cccccccccccccccccccccccccccccccccccccccc';
const SHA_D = 'dddddddddddddddddddddddddddddddddddddddd';
const SHA_E = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const SHA_F = 'ffffffffffffffffffffffffffffffffffffffff';
const SHA_1 = '1111111111111111111111111111111111111111';
const SHA_2 = '2222222222222222222222222222222222222222';
const SHA_3 = '3333333333333333333333333333333333333333';
// The amended middle layer of one case: a second commit standing where `add-retries` stood.
const SHA_S2 = 'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2';
// The deep-nesting case: the stacks b1–b4, c1–c2 and d1.
const SHA_B1 = 'b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1';
const SHA_B2 = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
const SHA_B3 = 'b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3';
const SHA_B4 = 'b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4';
const SHA_C1 = 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1';
const SHA_C2 = 'c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2';
const SHA_D1 = 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1';
// An orphan branch's three commits — the oldest has no parent at all.
const SHA_P1 = 'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1';
const SHA_P2 = 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2';
const SHA_P3 = 'f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3';
// The view-lab rail (pane B): part1–part4 and chore on digits, the 1610 stack on letters.
const SHA_4 = '4444444444444444444444444444444444444444';
const SHA_6 = '6666666666666666666666666666666666666666';

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

// ---------------------------------------------------------------------------------------------
// layoutGraph: plan E78 as a table of shapes. Each case is the two texts as git would print them
// for that repository, the options the caller would pass, and every row the rail must draw, top
// first and trunk last. The texts use the SHA constants above; a row's `parent` is a layer's name
// or the trunk ref.
// ---------------------------------------------------------------------------------------------

/** The fields E78 names, in one flat shape, so a table row reads as the rail will draw it. */
// see primer §80 (`GraphRow['kind']`: the type of one field, read off a union) and §11 (optional fields)
interface RowSkeleton {
  kind: GraphRow['kind'];
  name?: string;
  lane: number;
  node?: NodeKind;
  joinsLane?: number;
  /** A layer's parent, or the branch the working-tree row's changes sit on. */
  parent?: string;
  depth?: number;
}

/**
 * What the table pins per row. `sha`, `committedAt`, `isTip` and `forks` are pinned once each in
 * "the fields the table leaves out" below, not on every row — a table that repeated them would
 * be a page of SHAs saying nothing about lanes.
 */
// see primer §59 (tagged unions: narrowing on `kind`)
function skeleton(row: GraphRow): RowSkeleton {
  if (row.kind === 'layer') {
    return { kind: row.kind, name: row.name, lane: row.lane, node: row.node, joinsLane: row.joinsLane, parent: row.parent, depth: row.depth };
  }
  if (row.kind === 'trunk') {
    return { kind: row.kind, name: row.name, lane: row.lane, node: row.node };
  }
  if (row.kind === 'workingTree') {
    return { kind: row.kind, parent: row.parent, lane: row.lane, node: row.node };
  }
  return { kind: row.kind, lane: row.lane };
}

/** One shape of the E78 table: the inputs, and the rows and lane count they must produce. */
interface LayoutCase {
  title: string;
  refs: string;
  dag: string;
  head: string | null;
  dirty: boolean;
  onlyStackOf?: string;
  /** Top first, trunk last. */
  rows: RowSkeleton[];
  lanes: number;
}

// The rows that read the same in every shape.
const TRUNK_HOLLOW: RowSkeleton = { kind: 'trunk', name: TRUNK, lane: 0, node: 'hollow' };
const TRUNK_FILLED: RowSkeleton = { kind: 'trunk', name: TRUNK, lane: 0, node: 'filled' };
const ELIDED: RowSkeleton = { kind: 'elided', lane: 0 };

/** The working-tree row: dashed, on `lane`, its changes sitting on the branch `parent`. */
function workingTree(parent: string, lane: number): RowSkeleton {
  return { kind: 'workingTree', parent, lane, node: 'dashed' };
}

// The three Appendix A layers as rows, with HEAD on the top one: the shape every other case varies.
const APPENDIX_A_ROWS: RowSkeleton[] = [
  { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'filled', parent: 'add-retries', depth: 3 },
  { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow', parent: 'api-refactor', depth: 2 },
  { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
];

/** The same rows with every node hollow — HEAD somewhere else. */
function allHollow(rows: RowSkeleton[]): RowSkeleton[] {
  // see primer §16 (object literals: spread — a copy with one field changed)
  return rows.map((row) => (row.node === 'filled' ? { ...row, node: 'hollow' } : row));
}

// L3's texts: `side-fix` one commit on top of the middle layer, beside `retry-metrics`.
const SIDE_FIX_REFS = refs(['add-retries', SHA_B], ['api-refactor', SHA_A], ['main', SHA_T], ['retry-metrics', SHA_C], ['side-fix', SHA_E]);
const SIDE_FIX_DAG = dag([SHA_E, SHA_B]) + APPENDIX_A_DAG;

// The view-lab rail, docs/view-lab.html pane B, as the two commands would print it: part1 on an
// old trunk commit (squash-merged — "#480 merged" — so behind), the five-layer 1610 stack on part1,
// part2–part4 on part1 too, fix on trunk's tip, chore on the old commit. for-each-ref's order:
// `chore/…` < `feat/…` < `fix/…` < `main`.
const PANE_B_REFS = refs(
  ['chore/FWRK-1011-update-kbs-settings', SHA_6],
  ['feat/FWRK-1434-part1', SHA_1],
  ['feat/FWRK-1434-part2', SHA_2],
  ['feat/FWRK-1434-part3', SHA_3],
  ['feat/FWRK-1434-part4', SHA_4],
  ['feat/FWRK-1610-a-collector-core', SHA_A],
  ['feat/FWRK-1610-b-collector-auth', SHA_B],
  ['feat/FWRK-1610-c-collector-tests', SHA_C],
  ['feat/FWRK-1610-d-collector-api', SHA_D],
  ['feat/FWRK-1610-e-collector-ui', SHA_E],
  ['fix/FWRK-1500-retry-timeout', SHA_F],
  ['main', SHA_T],
);
const PANE_B_DAG = dag(
  [SHA_E, SHA_D], [SHA_D, SHA_C], [SHA_C, SHA_B], [SHA_B, SHA_A], [SHA_A, SHA_1],
  [SHA_4, SHA_3], [SHA_3, SHA_2], [SHA_2, SHA_1], [SHA_1, SHA_OLD],
  [SHA_F, SHA_T], [SHA_6, SHA_OLD],
);
// Rows 1–12 and 14 are the thirteen rows of the mockup in its order; the view-lab draws the elided
// history inside main's own cell, E78 makes it a row, so 13 becomes 14.
const PANE_B_ROWS: RowSkeleton[] = [
  { kind: 'layer', name: 'feat/FWRK-1610-e-collector-ui', lane: 0, node: 'hollow', parent: 'feat/FWRK-1610-d-collector-api', depth: 6 },
  { kind: 'layer', name: 'feat/FWRK-1610-d-collector-api', lane: 0, node: 'hollow', parent: 'feat/FWRK-1610-c-collector-tests', depth: 5 },
  { kind: 'layer', name: 'feat/FWRK-1610-c-collector-tests', lane: 0, node: 'hollow', parent: 'feat/FWRK-1610-b-collector-auth', depth: 4 },
  { kind: 'layer', name: 'feat/FWRK-1610-b-collector-auth', lane: 0, node: 'hollow', parent: 'feat/FWRK-1610-a-collector-core', depth: 3 },
  { kind: 'layer', name: 'feat/FWRK-1610-a-collector-core', lane: 0, node: 'hollow', parent: 'feat/FWRK-1434-part1', depth: 2 },
  { kind: 'layer', name: 'feat/FWRK-1434-part4', lane: 1, node: 'hollow', parent: 'feat/FWRK-1434-part3', depth: 4 },
  workingTree('feat/FWRK-1434-part3', 1),
  { kind: 'layer', name: 'feat/FWRK-1434-part3', lane: 1, node: 'filled', parent: 'feat/FWRK-1434-part2', depth: 3 },
  { kind: 'layer', name: 'feat/FWRK-1434-part2', lane: 1, node: 'hollow', joinsLane: 0, parent: 'feat/FWRK-1434-part1', depth: 2 },
  { kind: 'layer', name: 'feat/FWRK-1434-part1', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
  { kind: 'layer', name: 'fix/FWRK-1500-retry-timeout', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
  { kind: 'layer', name: 'chore/FWRK-1011-update-kbs-settings', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
  ELIDED,
  TRUNK_HOLLOW,
];

// L8's texts: a two-row stack behind trunk's tip, a one-row branch on it.
const STALE_REFS = refs(['fresh', SHA_A], ['main', SHA_T], ['stale', SHA_B], ['stale-up', SHA_C]);
const STALE_DAG = dag([SHA_C, SHA_B], [SHA_B, SHA_OLD], [SHA_A, SHA_T]);
const STALE_ROWS: RowSkeleton[] = [
  { kind: 'layer', name: 'stale-up', lane: 0, node: 'hollow', parent: 'stale', depth: 2 },
  { kind: 'layer', name: 'stale', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
  { kind: 'layer', name: 'fresh', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
];

const E78_CASES: LayoutCase[] = [
  {
    title: 'one stack → one lane: the Appendix A stack straight on lane 0, the checked-out top filled, trunk last',
    refs: APPENDIX_A_REFS,
    dag: APPENDIX_A_DAG,
    head: 'retry-metrics',
    dirty: false,
    rows: [...APPENDIX_A_ROWS, TRUNK_HOLLOW],
    lanes: 1,
  },
  {
    title: 'trunk-only repository → just the trunk row, filled because HEAD is on main at the tip',
    refs: refs(['main', SHA_T]),
    dag: '',
    head: 'main',
    dirty: false,
    rows: [TRUNK_FILLED],
    lanes: 1,
  },
  {
    title: "HEAD on trunk's tip (E5): the trunk row is filled, every layer hollow",
    refs: APPENDIX_A_REFS,
    dag: APPENDIX_A_DAG,
    head: 'main',
    dirty: false,
    rows: [...allHollow(APPENDIX_A_ROWS), TRUNK_FILLED],
    lanes: 1,
  },
  {
    title: 'two names on one commit (E6): a chain in name order, api-refactor-backup on api-refactor, add-retries on the backup — as computeStack lists them',
    refs: refs(['add-retries', SHA_B], ['api-refactor', SHA_A], ['api-refactor-backup', SHA_A], ['main', SHA_T], ['retry-metrics', SHA_C]),
    dag: APPENDIX_A_DAG,
    head: 'add-retries',
    dirty: false,
    rows: [
      { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'hollow', parent: 'add-retries', depth: 3 },
      { kind: 'layer', name: 'add-retries', lane: 0, node: 'filled', parent: 'api-refactor-backup', depth: 2 },
      { kind: 'layer', name: 'api-refactor-backup', lane: 0, node: 'hollow', parent: 'api-refactor', depth: 1 },
      { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      TRUNK_HOLLOW,
    ],
    lanes: 1,
  },
  {
    title: 'a branch whose tip is in trunk (F5) is listed by for-each-ref but gets no row',
    refs: refs(['add-retries', SHA_B], ['api-refactor', SHA_A], ['main', SHA_T], ['merged-already', SHA_OLD], ['retry-metrics', SHA_C]),
    dag: APPENDIX_A_DAG,
    head: 'retry-metrics',
    dirty: false,
    rows: [...APPENDIX_A_ROWS, TRUNK_HOLLOW],
    lanes: 1,
  },
  {
    title: 'no local branches at all: just the trunk row, hollow',
    refs: '',
    dag: '',
    head: null,
    dirty: false,
    rows: [TRUNK_HOLLOW],
    lanes: 1,
  },
  {
    title: "a second stack on the same parent → lane 1 with joinsLane 0 on its lowest row; the bigger stack continues (E16's other-work, drawn)",
    refs: refs(['add-retries', SHA_B], ['api-refactor', SHA_A], ['main', SHA_T], ['other-work', SHA_D], ['retry-metrics', SHA_C]),
    dag: dag([SHA_D, SHA_T]) + APPENDIX_A_DAG,
    head: 'retry-metrics',
    dirty: false,
    rows: [...APPENDIX_A_ROWS, { kind: 'layer', name: 'other-work', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 }, TRUNK_HOLLOW],
    lanes: 2,
  },
  {
    title: 'a stack rooted on a middle layer → lane 1 from that layer: side-fix off add-retries, retry-metrics continuing (the size tie goes to the smaller name)',
    refs: SIDE_FIX_REFS,
    dag: SIDE_FIX_DAG,
    head: 'retry-metrics',
    dirty: false,
    rows: [
      { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'filled', parent: 'add-retries', depth: 3 },
      { kind: 'layer', name: 'side-fix', lane: 1, node: 'hollow', joinsLane: 0, parent: 'add-retries', depth: 3 },
      { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow', parent: 'api-refactor', depth: 2 },
      { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      TRUNK_HOLLOW,
    ],
    lanes: 2,
  },
  {
    title: "three siblings on trunk reuse lane 1, never lane 2; the tie is broken by code-point order, not the locale's (alpha, zeta, ömega)",
    refs: refs(['alpha', SHA_A], ['main', SHA_T], ['zeta', SHA_B], ['ömega', SHA_C]),
    dag: dag([SHA_C, SHA_T], [SHA_B, SHA_T], [SHA_A, SHA_T]),
    head: 'alpha',
    dirty: false,
    // 'zeta' < 'ömega' by code point while 'zeta'.localeCompare('ömega') is 1: a localeCompare
    // would draw ömega above zeta and fail here.
    rows: [
      { kind: 'layer', name: 'alpha', lane: 0, node: 'filled', parent: TRUNK, depth: 1 },
      { kind: 'layer', name: 'zeta', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
      { kind: 'layer', name: 'ömega', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
      TRUNK_HOLLOW,
    ],
    lanes: 2,
  },
  {
    title: 'a side child with a side child of its own opens lane 2 and joins lane 1 — lanes step one at a time',
    refs: refs(['alpha', SHA_A], ['alpha-top', SHA_C], ['alpha-up', SHA_B], ['beta', SHA_1], ['beta-1', SHA_2], ['beta-2', SHA_3], ['main', SHA_T]),
    dag: dag([SHA_C, SHA_B], [SHA_B, SHA_A], [SHA_A, SHA_T], [SHA_3, SHA_1], [SHA_2, SHA_1], [SHA_1, SHA_T]),
    head: 'beta-2',
    dirty: false,
    // alpha's chain and beta's bush both have three rows: the name decides, alpha continues.
    rows: [
      { kind: 'layer', name: 'alpha-top', lane: 0, node: 'hollow', parent: 'alpha-up', depth: 3 },
      { kind: 'layer', name: 'alpha-up', lane: 0, node: 'hollow', parent: 'alpha', depth: 2 },
      { kind: 'layer', name: 'alpha', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      { kind: 'layer', name: 'beta-1', lane: 1, node: 'hollow', parent: 'beta', depth: 2 },
      { kind: 'layer', name: 'beta-2', lane: 2, node: 'filled', joinsLane: 1, parent: 'beta', depth: 2 },
      { kind: 'layer', name: 'beta', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
      TRUNK_HOLLOW,
    ],
    lanes: 3,
  },
  {
    title: 'bottom layer amended (E14): the old commit stays unnamed under add-retries, which becomes a root of depth 2 on lane 0; the amended api-refactor is a one-row stack on lane 1 — what computeStack lists, plus the branch it drops',
    refs: refs(['add-retries', SHA_B], ['api-refactor', SHA_1], ['main', SHA_T], ['retry-metrics', SHA_C]),
    dag: dag([SHA_1, SHA_T]) + APPENDIX_A_DAG,
    head: 'retry-metrics',
    dirty: false,
    rows: [
      { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'filled', parent: 'add-retries', depth: 3 },
      { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow', parent: TRUNK, depth: 2 },
      { kind: 'layer', name: 'api-refactor', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
      TRUNK_HOLLOW,
    ],
    lanes: 2,
  },
  {
    title: "a branch merged into another's deeper line: the merge sits on its deepest named ancestor and the merged branch is a one-row stack of its own — what git says (E14/E15); the one shape where computeStack's count order would chain a → b-base → b instead",
    refs: refs(['a', SHA_A], ['b', SHA_2], ['b-base', SHA_B], ['main', SHA_T]),
    dag: dag([SHA_2, SHA_B, SHA_A], [SHA_B, SHA_1], [SHA_1, SHA_T], [SHA_A, SHA_T]),
    head: null,
    dirty: false,
    rows: [
      { kind: 'layer', name: 'b', lane: 0, node: 'hollow', parent: 'b-base', depth: 4 },
      { kind: 'layer', name: 'b-base', lane: 0, node: 'hollow', parent: TRUNK, depth: 2 },
      { kind: 'layer', name: 'a', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
      TRUNK_HOLLOW,
    ],
    lanes: 2,
  },
  {
    title: "the middle layer amended (E14's cousin): the top layer still sits on the old unnamed commit, so both are children of the nearest layer whose tip they contain; the size tie goes to the smaller name",
    refs: refs(['add-retries', SHA_S2], ['api-refactor', SHA_A], ['main', SHA_T], ['retry-metrics', SHA_C]),
    dag: dag([SHA_C, SHA_B], [SHA_B, SHA_A], [SHA_S2, SHA_A], [SHA_A, SHA_T]),
    head: 'retry-metrics',
    dirty: false,
    rows: [
      { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow', parent: 'api-refactor', depth: 2 },
      { kind: 'layer', name: 'retry-metrics', lane: 1, node: 'filled', joinsLane: 0, parent: 'api-refactor', depth: 3 },
      { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      TRUNK_HOLLOW,
    ],
    lanes: 2,
  },
  {
    title: 'size, not position and not HEAD, chooses the straight line: the bigger side stack off the middle layer continues on lane 0 and the checked-out one-row tip curves beside it',
    refs: refs(['add-retries', SHA_B], ['api-refactor', SHA_A], ['main', SHA_T], ['retry-metrics', SHA_C], ['side-1', SHA_E], ['side-2', SHA_F]),
    dag: dag([SHA_F, SHA_E], [SHA_E, SHA_B], [SHA_C, SHA_B], [SHA_B, SHA_A], [SHA_A, SHA_T]),
    head: 'retry-metrics',
    dirty: false,
    rows: [
      { kind: 'layer', name: 'side-2', lane: 0, node: 'hollow', parent: 'side-1', depth: 4 },
      { kind: 'layer', name: 'side-1', lane: 0, node: 'hollow', parent: 'add-retries', depth: 3 },
      { kind: 'layer', name: 'retry-metrics', lane: 1, node: 'filled', joinsLane: 0, parent: 'add-retries', depth: 3 },
      { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow', parent: 'api-refactor', depth: 2 },
      { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      TRUNK_HOLLOW,
    ],
    lanes: 2,
  },
  {
    title: 'deep nesting: a seven-row stale stack keeps lane 0 and the one-row root on the tip hangs beside it; its own sides open lanes 1 and 2; lanes = 3',
    refs: refs(['a', SHA_A], ['b1', SHA_B1], ['b2', SHA_B2], ['b3', SHA_B3], ['b4', SHA_B4], ['c1', SHA_C1], ['c2', SHA_C2], ['d1', SHA_D1], ['main', SHA_T]),
    dag: dag([SHA_B4, SHA_B3], [SHA_B3, SHA_B2], [SHA_B2, SHA_B1], [SHA_D1, SHA_C1], [SHA_C2, SHA_C1], [SHA_C1, SHA_B1], [SHA_B1, SHA_OLD], [SHA_A, SHA_T]),
    head: 'd1',
    dirty: false,
    // b1's subtree has seven rows, `a` one: size decides, not the fork. b1's children b2 and c1 tie
    // at three → b2 continues; c1's children tie at one → c2 continues.
    rows: [
      { kind: 'layer', name: 'b4', lane: 0, node: 'hollow', parent: 'b3', depth: 4 },
      { kind: 'layer', name: 'b3', lane: 0, node: 'hollow', parent: 'b2', depth: 3 },
      { kind: 'layer', name: 'b2', lane: 0, node: 'hollow', parent: 'b1', depth: 2 },
      { kind: 'layer', name: 'c2', lane: 1, node: 'hollow', parent: 'c1', depth: 3 },
      { kind: 'layer', name: 'd1', lane: 2, node: 'filled', joinsLane: 1, parent: 'c1', depth: 3 },
      { kind: 'layer', name: 'c1', lane: 1, node: 'hollow', joinsLane: 0, parent: 'b1', depth: 2 },
      { kind: 'layer', name: 'b1', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      { kind: 'layer', name: 'a', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
      ELIDED,
      TRUNK_HOLLOW,
    ],
    lanes: 3,
  },
  {
    title: 'a stale two-row stack is the bigger, so it stays on lane 0 — lane 0 does not move when a fetch leaves it behind — and the one-row root on the tip hangs beside it above the elided row',
    refs: STALE_REFS,
    dag: STALE_DAG,
    head: null,
    dirty: false,
    rows: [...STALE_ROWS, ELIDED, TRUNK_HOLLOW],
    lanes: 2,
  },
  {
    title: 'every root behind, at two different fork points → still one elided row; the size tie goes to the smaller name',
    refs: refs(['main', SHA_T], ['stale-a', SHA_A], ['stale-b', SHA_B]),
    dag: dag([SHA_B, SHA_OLDER], [SHA_A, SHA_OLD]),
    head: 'stale-b',
    dirty: false,
    rows: [
      { kind: 'layer', name: 'stale-a', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      { kind: 'layer', name: 'stale-b', lane: 1, node: 'filled', joinsLane: 0, parent: TRUNK, depth: 1 },
      ELIDED,
      TRUNK_HOLLOW,
    ],
    lanes: 2,
  },
  {
    title: 'detached HEAD (E3): every layer drawn, nothing filled, and no working-tree row even when dirty',
    refs: APPENDIX_A_REFS,
    dag: APPENDIX_A_DAG,
    head: null,
    dirty: true,
    rows: [...allHollow(APPENDIX_A_ROWS), TRUNK_HOLLOW],
    lanes: 1,
  },
  {
    title: 'HEAD on a merged branch behind the tip (F5), dirty: the trunk row is filled — HEAD is on a branch trunk contains — and the dashed row sits above it naming that branch',
    refs: refs(['add-retries', SHA_B], ['api-refactor', SHA_A], ['main', SHA_T], ['merged-already', SHA_OLD], ['retry-metrics', SHA_C]),
    dag: APPENDIX_A_DAG,
    head: 'merged-already',
    dirty: true,
    // No row named merged-already; no elided row — the stack's fork is the tip.
    rows: [...allHollow(APPENDIX_A_ROWS), workingTree('merged-already', 0), TRUNK_FILLED],
    lanes: 1,
  },
  {
    title: "dirty tree → a dashed working-tree row directly above the checked-out layer, below that layer's children",
    refs: SIDE_FIX_REFS,
    dag: SIDE_FIX_DAG,
    head: 'add-retries',
    dirty: true,
    rows: [
      { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'hollow', parent: 'add-retries', depth: 3 },
      { kind: 'layer', name: 'side-fix', lane: 1, node: 'hollow', joinsLane: 0, parent: 'add-retries', depth: 3 },
      workingTree('add-retries', 0),
      { kind: 'layer', name: 'add-retries', lane: 0, node: 'filled', parent: 'api-refactor', depth: 2 },
      { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      TRUNK_HOLLOW,
    ],
    lanes: 2,
  },
  {
    title: 'dirty on trunk with a stale root: the elided row, then the working tree naming main, then the filled trunk row',
    refs: STALE_REFS,
    dag: STALE_DAG,
    head: 'main',
    dirty: true,
    // The working tree sits on trunk's tip, so the elided history is above it.
    rows: [...STALE_ROWS, ELIDED, workingTree('main', 0), TRUNK_FILLED],
    lanes: 2,
  },
  {
    title: "a merge from trunk's tip (F4): the merge commit counts one, the trunk side none — depth 2 — and the merged tip is a fork, so the root is on the tip and nothing is elided",
    refs: refs(['main', SHA_T], ['other-work', SHA_F]),
    dag: dag([SHA_F, SHA_D, SHA_T], [SHA_D, SHA_OLD]),
    head: 'other-work',
    dirty: false,
    rows: [{ kind: 'layer', name: 'other-work', lane: 0, node: 'filled', parent: TRUNK, depth: 2 }, TRUNK_HOLLOW],
    lanes: 1,
  },
  {
    title: 'a merge from an older trunk commit: depth 2 still, but no fork is the tip, so the root is behind and the history elided',
    refs: refs(['main', SHA_T], ['other-work', SHA_F]),
    dag: dag([SHA_F, SHA_D, SHA_OLDER], [SHA_D, SHA_OLD]),
    head: 'other-work',
    dirty: false,
    rows: [{ kind: 'layer', name: 'other-work', lane: 0, node: 'filled', parent: TRUNK, depth: 2 }, ELIDED, TRUNK_HOLLOW],
    lanes: 1,
  },
  {
    title: 'a local main ahead of origin/main (F3, D59) is a DAG line and so a member like any other — here a one-row stack beside the others, drawn as git says',
    refs: refs(['add-retries', SHA_B], ['api-refactor', SHA_A], ['main', SHA_1], ['retry-metrics', SHA_C]),
    dag: dag([SHA_1, SHA_T]) + APPENDIX_A_DAG,
    head: 'main',
    dirty: false,
    // `head` is a member, so its row is filled and the trunk row is not.
    rows: [...allHollow(APPENDIX_A_ROWS), { kind: 'layer', name: 'main', lane: 1, node: 'filled', joinsLane: 0, parent: TRUNK, depth: 1 }, TRUNK_HOLLOW],
    lanes: 2,
  },
  {
    title: 'the view-lab rail (pane B): the 1610 stack straight above part1 — squash-merged, so behind, and still the lane-0 line because it is the biggest — part2–part4 on lane 1 with the working tree above the checked-out part3, fix (on the tip) then chore (behind) curving into main, one elided row',
    refs: PANE_B_REFS,
    dag: PANE_B_DAG,
    head: 'feat/FWRK-1434-part3',
    dirty: true,
    rows: PANE_B_ROWS,
    lanes: 2,
  },
  {
    title: "onlyStackOf a middle layer (pane B on part3) is git-spice's stack: the layers below it and every layer above it, in one lane — the 1610 stack, fix and chore gone, the elided row kept because part1 is behind",
    refs: PANE_B_REFS,
    dag: PANE_B_DAG,
    head: 'feat/FWRK-1434-part3',
    dirty: true,
    onlyStackOf: 'feat/FWRK-1434-part3',
    rows: [
      { kind: 'layer', name: 'feat/FWRK-1434-part4', lane: 0, node: 'hollow', parent: 'feat/FWRK-1434-part3', depth: 4 },
      workingTree('feat/FWRK-1434-part3', 0),
      { kind: 'layer', name: 'feat/FWRK-1434-part3', lane: 0, node: 'filled', parent: 'feat/FWRK-1434-part2', depth: 3 },
      { kind: 'layer', name: 'feat/FWRK-1434-part2', lane: 0, node: 'hollow', parent: 'feat/FWRK-1434-part1', depth: 2 },
      { kind: 'layer', name: 'feat/FWRK-1434-part1', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      ELIDED,
      TRUNK_HOLLOW,
    ],
    lanes: 1,
  },
  {
    title: 'onlyStackOf a root beside the others keeps that root alone; the checked-out layer is among the dropped, so nothing is filled and no working-tree row is drawn',
    refs: PANE_B_REFS,
    dag: PANE_B_DAG,
    head: 'feat/FWRK-1434-part3',
    dirty: true,
    onlyStackOf: 'fix/FWRK-1500-retry-timeout',
    // No elided row: the one drawn root is on the tip. The trunk row is hollow: `head` is a member, filtered out or not.
    rows: [{ kind: 'layer', name: 'fix/FWRK-1500-retry-timeout', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 }, TRUNK_HOLLOW],
    lanes: 1,
  },
  {
    title: "onlyStackOf a name that is no layer (trunk's own branch here) leaves the trunk row alone",
    refs: PANE_B_REFS,
    dag: PANE_B_DAG,
    head: 'feat/FWRK-1434-part3',
    dirty: true,
    onlyStackOf: 'main',
    rows: [TRUNK_HOLLOW],
    lanes: 1,
  },
  {
    title: 'an orphan branch (gh-pages: a line with no parent, as every branch of a shallow clone cut inside a stack prints) is drawn as a stale one-row stack of its whole history — its curve into trunk and the elided row stand for history that is not trunk\'s',
    refs: refs(['feat', SHA_A], ['gh-pages', SHA_P3], ['main', SHA_T]),
    dag: dag([SHA_A, SHA_T], [SHA_P3, SHA_P2], [SHA_P2, SHA_P1], [SHA_P1]),
    head: null,
    dirty: false,
    // Sizes tie at one; 'feat' < 'gh-pages'.
    rows: [
      { kind: 'layer', name: 'feat', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      { kind: 'layer', name: 'gh-pages', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 3 },
      ELIDED,
      TRUNK_HOLLOW,
    ],
    lanes: 2,
  },
  {
    title: 'HEAD on a local main behind origin/main, dirty — the everyday case: the trunk row is filled and the working tree sits directly above it, naming main',
    refs: refs(['add-retries', SHA_B], ['api-refactor', SHA_A], ['main', SHA_OLD], ['retry-metrics', SHA_C]),
    dag: APPENDIX_A_DAG,
    head: 'main',
    dirty: true,
    // No elided row: the stack forks at the tip; `main` being behind is 23d's behindTrunk.local.
    rows: [...allHollow(APPENDIX_A_ROWS), workingTree('main', 0), TRUNK_FILLED],
    lanes: 1,
  },
  {
    title: 'HEAD on an unborn branch (named by HEAD, in no refs line): nothing filled, no working-tree row even when dirty',
    refs: APPENDIX_A_REFS,
    dag: APPENDIX_A_DAG,
    head: 'unborn',
    dirty: true,
    rows: [...allHollow(APPENDIX_A_ROWS), TRUNK_HOLLOW],
    lanes: 1,
  },
  {
    title: 'HEAD on a branch with no commits of its own yet (git checkout -b fresh origin/main), dirty: no row of that name; the trunk row is filled and the working tree above it names fresh',
    refs: refs(['fresh', SHA_T], ['main', SHA_T]),
    dag: '',
    head: 'fresh',
    dirty: true,
    rows: [workingTree('fresh', 0), TRUNK_FILLED],
    lanes: 1,
  },
];

describe('layoutGraph', () => {
  describe('the E78 table', () => {
    // see primer §78 (`it.each` over object rows: `$title` reads a field off the row)
    it.each(E78_CASES)('$title', ({ refs, dag, head, dirty, onlyStackOf, rows, lanes }) => {
      // arrange: the three texts as git prints them, HEAD from computeStack, dirty from the Git extension
      const input = { refs, dag, trunkTip: TRUNK_TIP };

      // act
      const layout = layoutGraph(input, { trunk: TRUNK, head, dirty, onlyStackOf });

      // assert: every row in drawing order, top first and trunk last, and how many lanes the rail needs
      expect(layout.rows.map(skeleton)).toEqual(rows);
      expect(layout.lanes).toBe(lanes);
    });
  });

  describe('lanes never cross', () => {
    // The same table, run through the rules every layout obeys whatever its shape — the
    // properties the renderer (item 23e) relies on, stated once rather than read off each row.
    it.each(E78_CASES)('lanes never cross, parents sit below, one node is filled: $title', ({ refs, dag, head, dirty, onlyStackOf }) => {
      // act
      const layout = layoutGraph({ refs, dag, trunkTip: TRUNK_TIP }, { trunk: TRUNK, head, dirty, onlyStackOf });

      // assert
      expectWellFormed(layout, { refs, dag, head, onlyStackOf });
    });
  });

  describe('the fields the table leaves out', () => {
    it("copies each layer's SHA and date from the refs text and gives the trunk row trunk's tip and its own date", () => {
      // act
      const layout = layoutGraph({ refs: SIDE_FIX_REFS, dag: SIDE_FIX_DAG, trunkTip: TRUNK_TIP }, { trunk: TRUNK, head: 'retry-metrics', dirty: false });

      // assert: the rows in drawing order carry their own commits; the trunk row, last, carries the tip
      // see primer §25 (arrays: map, filter)
      const shas = layout.rows.map((row) => (row.kind === 'layer' || row.kind === 'trunk' ? row.sha : null));
      expect(shas).toEqual([SHA_C, SHA_E, SHA_B, SHA_A, SHA_T]);
      const dates = layout.rows.map((row) => (row.kind === 'layer' || row.kind === 'trunk' ? row.committedAt : null));
      expect(dates).toEqual([DATE, DATE, DATE, DATE, TRUNK_DATE]);
    });

    it('a checkout changes which node is filled and nothing else — a HEAD-first lane rule would swap lanes on every checkout', () => {
      // arrange: the same repository seen from the top layer and from the side branch
      const input = { refs: SIDE_FIX_REFS, dag: SIDE_FIX_DAG, trunkTip: TRUNK_TIP };

      // act
      const onTop = layoutGraph(input, { trunk: TRUNK, head: 'retry-metrics', dirty: false });
      const onSide = layoutGraph(input, { trunk: TRUNK, head: 'side-fix', dirty: false });

      // assert: the skeletons differ in `node` alone — side-fix keeps lane 1 and its curve into lane 0
      // see primer §54 (destructuring: the fields by name, `node` left out)
      const withoutNode = (row: GraphRow) => {
        const { kind, name, lane, joinsLane, parent, depth } = skeleton(row);
        return { kind, name, lane, joinsLane, parent, depth };
      };
      expect(onTop.rows.map(withoutNode)).toEqual(onSide.rows.map(withoutNode));
      const filledName = (layout: { rows: readonly GraphRow[] }): string | null => {
        const filled = layout.rows.find((row) => row.kind === 'layer' && row.node === 'filled');
        return filled !== undefined && filled.kind === 'layer' ? filled.name : null;
      };
      expect(filledName(onTop)).toBe('retry-metrics');
      expect(filledName(onSide)).toBe('side-fix');
    });

    it('dirty adds exactly one row and moves nothing: the same layout with the working-tree row taken out', () => {
      // arrange
      const input = { refs: SIDE_FIX_REFS, dag: SIDE_FIX_DAG, trunkTip: TRUNK_TIP };

      // act
      const dirty = layoutGraph(input, { trunk: TRUNK, head: 'add-retries', dirty: true });
      const clean = layoutGraph(input, { trunk: TRUNK, head: 'add-retries', dirty: false });

      // assert
      expect(dirty.rows.filter((row) => row.kind !== 'workingTree').map(skeleton)).toEqual(clean.rows.map(skeleton));
      expect(dirty.rows.length).toBe(clean.rows.length + 1);
      expect(dirty.lanes).toBe(clean.lanes);
    });

    it("keeps on every layer the trunk commits its history stops at, sorted — one for a plain fork, two after a merge from trunk, none for an orphan — so a root is on the tip exactly when they include trunk's SHA", () => {
      /** The `forks` of the layer called `name`, or null when no row is. */
      const forksOf = (layout: { rows: readonly GraphRow[] }, name: string): readonly string[] | null => {
        const row = layout.rows.find((candidate) => candidate.kind === 'layer' && candidate.name === name);
        return row !== undefined && row.kind === 'layer' ? row.forks : null;
      };

      // act
      const paneB = layoutGraph({ refs: PANE_B_REFS, dag: PANE_B_DAG, trunkTip: TRUNK_TIP }, { trunk: TRUNK, head: null, dirty: false });
      const mergeFromTip = layoutGraph(
        { refs: refs(['main', SHA_T], ['other-work', SHA_F]), dag: dag([SHA_F, SHA_D, SHA_T], [SHA_D, SHA_OLD]), trunkTip: TRUNK_TIP },
        { trunk: TRUNK, head: null, dirty: false },
      );
      const orphan = layoutGraph(
        { refs: refs(['feat', SHA_A], ['gh-pages', SHA_P3], ['main', SHA_T]), dag: dag([SHA_A, SHA_T], [SHA_P3, SHA_P2], [SHA_P2, SHA_P1], [SHA_P1]), trunkTip: TRUNK_TIP },
        { trunk: TRUNK, head: null, dirty: false },
      );

      // assert: a layer's forks are its own history's, however far up the stack it sits
      expect(forksOf(paneB, 'fix/FWRK-1500-retry-timeout')).toEqual([SHA_T]);
      expect(forksOf(paneB, 'chore/FWRK-1011-update-kbs-settings')).toEqual([SHA_OLD]);
      expect(forksOf(paneB, 'feat/FWRK-1434-part1')).toEqual([SHA_OLD]);
      expect(forksOf(paneB, 'feat/FWRK-1610-e-collector-ui')).toEqual([SHA_OLD]);
      // Two forks, sorted by character code: '0000…' before '9999…'.
      expect(forksOf(mergeFromTip, 'other-work')).toEqual([SHA_T, SHA_OLD]);
      expect(forksOf(orphan, 'gh-pages')).toEqual([]);
      expect(forksOf(orphan, 'feat')).toEqual([SHA_T]);
    });

    it('marks a layer isTip when no row has it as its parent', () => {
      // act
      const layout = layoutGraph({ refs: SIDE_FIX_REFS, dag: SIDE_FIX_DAG, trunkTip: TRUNK_TIP }, { trunk: TRUNK, head: 'retry-metrics', dirty: false });

      // assert: retry-metrics and side-fix are tips; add-retries and api-refactor carry them
      const tips = layout.rows.filter((row) => row.kind === 'layer').map((row) => (row.kind === 'layer' ? row.isTip : null));
      expect(tips).toEqual([true, true, false, false]);
    });
  });
});

/**
 * The seven rules every layout obeys. Each is one `expect(value, message)` (primer §76), so a
 * failure names the rule and the row rather than printing two long arrays.
 */
// see primer §21 (Set: has, add, delete) and §22 (for ... of)
function expectWellFormed(layout: GraphLayout, inputs: { refs: string; dag: string; head: string | null; onlyStackOf?: string }): void {
  const rows = layout.rows;

  // 1. The last row is the trunk row, and no other row is one.
  expect(rows[rows.length - 1]?.kind, 'the last row is the trunk row').toBe('trunk');
  expect(rows.filter((row) => row.kind === 'trunk').length, 'exactly one trunk row').toBe(1);

  // 2. `lanes` is the greatest lane plus one.
  let greatestLane = 0;
  for (const row of rows) {
    if (row.lane > greatestLane) {
      greatestLane = row.lane;
    }
  }
  expect(layout.lanes, 'lanes = the greatest lane + 1').toBe(greatestLane + 1);

  // 3. Every curve moves one lane left: `joinsLane` is always `lane − 1`.
  for (const row of rows) {
    if (row.kind === 'layer' && row.joinsLane !== undefined) {
      expect(row.joinsLane, `${row.name}'s joinsLane is its lane − 1`).toBe(row.lane - 1);
    }
  }

  // 4. Walking top to bottom with the set of open lanes (lane 0 open from the start): a row on a
  // lane that is not open opens it, and at that moment no greater lane may be open — "a stack
  // always sits right of everything drawn above it" — and every lane below the row's is open,
  // so the lines the renderer draws straight through the row are real. A row with `joinsLane`
  // closes its lane after itself; the lane is free for the next sibling.
  const open = new Set<number>([0]);
  for (const row of rows) {
    const label = row.kind === 'layer' ? row.name : row.kind;
    if (!open.has(row.lane)) {
      for (const lane of open) {
        expect(lane < row.lane, `${label} opens lane ${row.lane} while lane ${lane} is still open`).toBe(true);
      }
      open.add(row.lane);
    }
    for (let lane = 0; lane < row.lane; lane++) {
      expect(open.has(lane), `lane ${lane} runs through ${label} on lane ${row.lane}`).toBe(true);
    }
    if (row.kind === 'layer' && row.joinsLane !== undefined) {
      open.delete(row.lane);
    }
  }

  // 5. Every layer's parent is the trunk or a layer drawn below it.
  const seenAbove = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'layer') {
      expect(row.parent === TRUNK || !seenAbove.has(row.parent), `${row.name}'s parent ${row.parent} is drawn below it`).toBe(true);
      seenAbove.add(row.name);
    }
  }
  const layerNames = new Set(rows.filter((row) => row.kind === 'layer').map((row) => (row.kind === 'layer' ? row.name : '')));
  for (const row of rows) {
    if (row.kind === 'layer') {
      expect(row.parent === TRUNK || layerNames.has(row.parent), `${row.name}'s parent ${row.parent} is a drawn layer or the trunk`).toBe(true);
    }
  }

  // 6. At most one row is filled; a working-tree row is directly above a filled row on its own
  // lane and names `head`; `dashed` is the working-tree row's alone.
  const filledCount = rows.filter((row) => (row.kind === 'layer' || row.kind === 'trunk') && row.node === 'filled').length;
  expect(filledCount, 'at most one filled node').toBeLessThanOrEqual(1);
  rows.forEach((row, index) => {
    if (row.kind === 'workingTree') {
      const below = rows[index + 1];
      expect(below !== undefined && (below.kind === 'layer' || below.kind === 'trunk') && below.node === 'filled', 'the working tree sits directly above the filled row').toBe(true);
      if (below !== undefined && (below.kind === 'layer' || below.kind === 'trunk')) {
        expect(below.lane, 'the working tree is on the filled row\'s lane').toBe(row.lane);
      }
      expect(row.parent, 'the working tree names the branch HEAD is on').toBe(inputs.head);
    }
  });

  // 7. Without the filter, every branch whose commit starts a DAG line is a layer row exactly
  // once, and no other branch is a row.
  if (inputs.onlyStackOf === undefined) {
    const commits = parseDag(inputs.dag);
    const expected = parseRefs(inputs.refs).filter((entry) => commits.has(entry.sha)).map((entry) => entry.name).sort();
    const drawn = Array.from(layerNames).sort();
    expect(drawn, 'the layer rows are exactly the members').toEqual(expected);
    expect(rows.filter((row) => row.kind === 'layer').length, 'each member once').toBe(expected.length);
  }
}
