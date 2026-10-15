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
import type { GraphRow, NodeKind } from '../../src/core/graph';
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

    it('marks a layer isTip when no row has it as its parent', () => {
      // act
      const layout = layoutGraph({ refs: SIDE_FIX_REFS, dag: SIDE_FIX_DAG, trunkTip: TRUNK_TIP }, { trunk: TRUNK, head: 'retry-metrics', dirty: false });

      // assert: retry-metrics and side-fix are tips; add-retries and api-refactor carry them
      const tips = layout.rows.filter((row) => row.kind === 'layer').map((row) => (row.kind === 'layer' ? row.isTip : null));
      expect(tips).toEqual([true, true, false, false]);
    });
  });
});
