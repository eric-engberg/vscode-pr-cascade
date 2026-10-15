/**
 * test/git/graph.git.test.ts — readGraphInput and layoutGraph against real repositories from the
 * fixture builder: the three texts' shapes, the rail over the Appendix A stack and its variants,
 * and agreement with computeStack for HEAD's stack where the history is a single line above trunk
 * — with the one merge shape where it is not, pinned. The unit tests pin the rules against
 * hand-written texts; this file checks that real git prints what the rules assume, as
 * stack.git.test.ts does for computeStack.
 *
 * Two things about how it compares. The agreement is checked by projection — the rows whose names
 * computeStack lists, bottom first, as `{ name, parent, depth }` — never by climbing `parent` from
 * `head`: with two names on one commit computeStack lists the name above HEAD too, which a climb
 * would miss. And the argv are pinned by output equality: against RealGitRunner nothing records
 * argv, the unit file pins them through the fake, and `fixture.git` of the exported argv printing
 * the same text is digest.git.test.ts's way.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git in throwaway directories, no
 * git-spice, no VS Code). Depends on: src/core/graph.ts, src/core/stack.ts (the agreement rows),
 * src/core/git.ts, test/helpers/fixture.ts. Plan: §8 E78 (E3, E5, E6, E14, E15, E16 as the graph
 * meets them), §9.4 `git/graph.git`, §10.1 item 23a (M6), §13.2 D67.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RealGitRunner } from '../../src/core/git';
import { REFS_ARGS, dagArgs, layoutGraph, parseRefs, parseTrunkTip, readGraphInput, trunkTipArgs } from '../../src/core/graph';
import type { GraphInput, GraphLayout, GraphRow } from '../../src/core/graph';
import type { RepoState } from '../../src/core/model';
import { computeStack } from '../../src/core/stack';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';

// The trunk every fixture has: buildStack creates a bare origin and fetches it, so this is exactly
// what detectTrunk would answer for these repositories.
// see primer §4 (const)
const TRUNK = 'origin/main';

// `git` is the runner under test: it spawns git with process.env, so the hermetic variables are
// stubbed on process.env for the whole file. `fixture.git(...)` is the fixture builder's synchronous
// helper (with its own environment), used only to set a situation up and to ask git for the
// expected answers.
const git = new RealGitRunner();

let homeDir: string;

// see primer §5 (arrow functions) and §6 (async / await)
beforeAll(async () => {
  homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-graph-test-'));
  // Hermetic git, exactly as in stack.git.test.ts; vi.unstubAllEnvs in afterAll restores every variable.
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

/** What git says `ref` points at, as the 40-character SHA. */
// see primer §23 (`trim`)
function shaOf(fixture: Fixture, ref: string): string {
  return fixture.git(['rev-parse', ref]).trim();
}

/** `ref`'s committer date as `for-each-ref` prints it: unix seconds. */
// see primer §27 (Number)
function dateOf(fixture: Fixture, ref: string): number {
  return Number(fixture.git(['show', '-s', '--format=%ct', ref]).trim());
}

/** `side-fix`: one commit adding `e` on top of the middle layer; HEAD back on the top layer. */
function addSideFix(fixture: Fixture): void {
  fixture.git(['checkout', '-q', '-b', 'side-fix', 'add-retries']);
  fs.writeFileSync(path.join(fixture.dir, 'e'), 'e\n');
  fixture.git(['add', 'e']);
  fixture.git(['commit', '-q', '-m', 'side-fix: add e']);
  fixture.git(['checkout', '-q', 'retry-metrics']);
}

/** The layout over real output, with HEAD taken from computeStack — so the agreement is built into the act. */
async function realLayout(fixture: Fixture, dirty = false): Promise<{ layout: GraphLayout; state: RepoState }> {
  const state = await computeStack(git, fixture.dir, TRUNK);
  const input = await readGraphInput(git, fixture.dir, TRUNK);
  return { layout: layoutGraph(input, { trunk: TRUNK, head: state.head, dirty }), state };
}

/** One row of the agreement: the three facts computeStack and the graph both state about a layer. */
interface Link {
  name: string;
  parent: string;
  depth: number;
}

/** The rows computeStack names, bottom first, as `{ name, parent, depth }` — the projection the header describes. */
// see primer §21 (Set) and §25 (arrays: push, reverse)
function chainOf(layout: GraphLayout, state: RepoState): Link[] {
  const names = new Set(state.layers.map((layer) => layer.name));
  // A loop, not filter + map: the loop's `if` narrows `row` to a LayerRow (primer §59), which a
  // filter callback cannot carry into a later map without a type predicate this codebase does not use.
  const chain: Link[] = [];
  for (const row of layout.rows) {
    if (row.kind === 'layer' && names.has(row.name)) {
      chain.push({ name: row.name, parent: row.parent, depth: row.depth });
    }
  }
  // The rows are top first; computeStack lists bottom first.
  return chain.reverse();
}

/** computeStack's side of the agreement: its layers as the same three facts. */
function chainOfState(state: RepoState): Link[] {
  return state.layers.map((layer) => ({ name: layer.name, parent: layer.parent, depth: layer.commitCount }));
}

/** The fields E78 names, as the unit file projects them. */
// see primer §80 (`GraphRow['kind']`)
interface RowSkeleton {
  kind: GraphRow['kind'];
  name?: string;
  lane: number;
  node?: 'hollow' | 'filled' | 'dashed';
  joinsLane?: number;
  parent?: string;
  depth?: number;
}

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

/** The name of the one filled layer, or null. */
function filledLayer(layout: GraphLayout): string | null {
  const filled = layout.rows.find((row) => row.kind === 'layer' && row.node === 'filled');
  return filled !== undefined && filled.kind === 'layer' ? filled.name : null;
}

/** The trunk row — the last row — narrowed, so a test can read its fields. */
function trunkRow(layout: GraphLayout): { sha: string; node: string } {
  const last = layout.rows[layout.rows.length - 1];
  if (last === undefined || last.kind !== 'trunk') {
    throw new Error('the last row is not the trunk row');
  }
  return { sha: last.sha, node: last.node };
}

// The Appendix A stack with side-fix off the middle layer and other-work beside it: the fixture of
// the first two blocks, as the rail draws it.
const APPENDIX_A_WITH_SIDES: RowSkeleton[] = [
  { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'filled', parent: 'add-retries', depth: 3 },
  { kind: 'layer', name: 'side-fix', lane: 1, node: 'hollow', joinsLane: 0, parent: 'add-retries', depth: 3 },
  { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow', parent: 'api-refactor', depth: 2 },
  { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
  { kind: 'layer', name: 'other-work', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
  { kind: 'trunk', name: TRUNK, lane: 0, node: 'hollow' },
];

describe('readGraphInput (real git)', () => {
  let fixture: Fixture;
  let input: GraphInput;

  beforeAll(async () => {
    fixture = buildStack();
    fixture.addUnrelatedStack();
    addSideFix(fixture);
    input = await readGraphInput(git, fixture.dir, TRUNK);
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('runs the three pinned commands: what the exported argv print is what the function hands back — pinned by output equality', () => {
    // see primer §16 (arrays: spread — `fixture.git` takes a mutable string[])
    expect(input.refs).toBe(fixture.git([...REFS_ARGS]));
    expect(input.dag).toBe(fixture.git(dagArgs(TRUNK)));
    expect(input.trunkTip).toBe(fixture.git(trunkTipArgs(TRUNK)));
  });

  it("lists every local branch in name order, one <name> <sha> <date> per line, merged or not, the date the commit's committer date", () => {
    // assert: the shape of every line
    const lines = input.refs.split('\n').filter((line) => line !== '');
    for (const line of lines) {
      expect(line).toMatch(/^\S+ [0-9a-f]{40} \d+$/);
    }
    // the names, `main` among them though trunk contains it
    const entries = parseRefs(input.refs);
    expect(entries.map((entry) => entry.name)).toEqual(['add-retries', 'api-refactor', 'main', 'other-work', 'retry-metrics', 'side-fix']);
    // and each one's commit and date, as git reports them by other means
    for (const entry of entries) {
      expect(entry.sha, entry.name).toBe(shaOf(fixture, entry.name));
      expect(entry.committedAt, entry.name).toBe(dateOf(fixture, entry.name));
    }
  });

  it("prints one <sha> <parent> line per commit not in trunk — five here, nothing for trunk's own commit", () => {
    // arrange: the five commits above trunk and their parents, by name
    const sha = (ref: string): string => shaOf(fixture, ref);
    const expected = [
      `${sha('retry-metrics')} ${sha('add-retries')}`,
      `${sha('add-retries')} ${sha('api-refactor')}`,
      `${sha('api-refactor')} ${sha(TRUNK)}`,
      `${sha('other-work')} ${sha(TRUNK)}`,
      `${sha('side-fix')} ${sha('add-retries')}`,
    ].sort();

    // assert: compared as a sorted set — the fixture's commits share a second, and rev-list orders by date
    const lines = input.dag.split('\n').filter((line) => line !== '');
    expect([...lines].sort()).toEqual(expected);
    for (const line of lines) {
      expect(line).toMatch(/^[0-9a-f]{40} [0-9a-f]{40}$/);
    }
  });

  it("names trunk's tip and its date on one line: the SHA rev-parse origin/main prints, the date show prints", () => {
    expect(input.trunkTip).toMatch(/^[0-9a-f]{40} \d+\n$/);
    expect(parseTrunkTip(input.trunkTip)).toStrictEqual({ sha: shaOf(fixture, TRUNK), committedAt: dateOf(fixture, TRUNK) });
  });

  it('ignores a tag named like a branch (F7): none of the three texts changes', async () => {
    // arrange: a tag called `add-retries` on trunk's commit — `refs/heads` and `--branches` never look at tags
    fixture.git(['tag', 'add-retries', 'main']);
    // see primer §18 (try / finally)
    try {
      // act
      const tagged = await readGraphInput(git, fixture.dir, TRUNK);

      // assert
      expect(tagged).toEqual(input);
    } finally {
      fixture.git(['tag', '-d', 'add-retries']);
    }
  });
});

describe('layoutGraph over real output', () => {
  let fixture: Fixture;
  let layout: GraphLayout;
  let state: RepoState;

  beforeAll(async () => {
    fixture = buildStack();
    fixture.addUnrelatedStack();
    addSideFix(fixture);
    ({ layout, state } = await realLayout(fixture));
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('draws the HEAD stack straight on lane 0, side-fix and other-work on lane 1 curving into it, trunk last, in two lanes', () => {
    expect(layout.rows.map(skeleton)).toEqual(APPENDIX_A_WITH_SIDES);
    expect(layout.lanes).toBe(2);
    // the commits behind the rows, and every stack forking from today's trunk
    for (const row of layout.rows) {
      if (row.kind === 'layer') {
        expect(row.sha, row.name).toBe(shaOf(fixture, row.name));
        expect(row.forks, row.name).toEqual([shaOf(fixture, TRUNK)]);
      }
    }
    expect(trunkRow(layout).sha).toBe(shaOf(fixture, TRUNK));
  });

  it("agrees with computeStack on HEAD's stack where the history is a single line: the same names bottom to top, the same parents, depth = commitCount", () => {
    expect(chainOf(layout, state)).toEqual(chainOfState(state));
    expect(chainOfState(state)).toEqual([
      { name: 'api-refactor', parent: TRUNK, depth: 1 },
      { name: 'add-retries', parent: 'api-refactor', depth: 2 },
      { name: 'retry-metrics', parent: 'add-retries', depth: 3 },
    ]);
  });

  it('fills the node of the branch HEAD is on and no other', () => {
    expect(filledLayer(layout)).toBe(state.head);
    expect(state.head).toBe('retry-metrics');
  });
});

describe('trunk moved on (commitOnTrunk)', () => {
  let fixture: Fixture;
  let before: { layout: GraphLayout; state: RepoState };
  let beforeInput: GraphInput;
  let after: { layout: GraphLayout; state: RepoState };
  let afterInput: GraphInput;

  beforeAll(async () => {
    fixture = buildStack();
    fixture.addUnrelatedStack();
    before = await realLayout(fixture);
    beforeInput = await readGraphInput(git, fixture.dir, TRUNK);
    fixture.commitOnTrunk('g', 'g\n');
    after = await realLayout(fixture);
    afterInput = await readGraphInput(git, fixture.dir, TRUNK);
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('adds the one elided row above trunk once every root is behind the tip, and changes no layer row', () => {
    const rows = after.layout.rows;
    expect(rows.filter((row) => row.kind !== 'elided').map(skeleton)).toEqual(before.layout.rows.map(skeleton));
    expect(rows[rows.length - 2]?.kind).toBe('elided');
    // the new trunk commit is not a DAG line; the trunk row moved to it; no stack forks from it
    expect(afterInput.dag).toBe(beforeInput.dag);
    const tip = shaOf(fixture, TRUNK);
    expect(trunkRow(after.layout).sha).toBe(tip);
    expect(trunkRow(before.layout).sha).not.toBe(tip);
    for (const row of rows) {
      if (row.kind === 'layer') {
        expect(row.forks.includes(tip), row.name).toBe(false);
      }
    }
  });

  it("still agrees with computeStack: depth counts the branch's own commits, not the distance to the moved tip", () => {
    expect(chainOf(after.layout, after.state)).toEqual(chainOfState(after.state));
    expect(after.state.layers.map((layer) => layer.commitCount)).toEqual([1, 2, 3]);
  });
});

describe('HEAD on trunk (E5)', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildStack();
    fixture.git(['checkout', '-q', 'main']);
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('fills the trunk row and every layer hollow; main itself has no row', async () => {
    // act
    const { layout, state } = await realLayout(fixture);

    // assert
    expect(state.head).toBe('main');
    expect(trunkRow(layout).node).toBe('filled');
    const layers = layout.rows.filter((row) => row.kind === 'layer');
    expect(layers.map((row) => (row.kind === 'layer' ? row.name : ''))).toEqual(['retry-metrics', 'add-retries', 'api-refactor']);
    expect(layers.every((row) => row.kind === 'layer' && row.node === 'hollow')).toBe(true);
  });
});

describe('detached HEAD (E3)', () => {
  let fixture: Fixture;
  let before: GraphInput;

  beforeAll(async () => {
    fixture = buildStack();
    before = await readGraphInput(git, fixture.dir, TRUNK);
    fixture.detach();
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('reads the same three texts as before the detach (F6)', async () => {
    expect(await readGraphInput(git, fixture.dir, TRUNK)).toEqual(before);
  });

  it('fills nothing: head is null', async () => {
    // act
    const { layout, state } = await realLayout(fixture);

    // assert
    expect(state.head).toBeNull();
    expect(filledLayer(layout)).toBeNull();
    expect(trunkRow(layout).node).toBe('hollow');
    expect(layout.rows.filter((row) => row.kind === 'layer').length).toBe(3);
  });
});

describe('two branches on one commit (E6)', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildStack();
    fixture.git(['branch', 'api-refactor-backup', 'api-refactor']);
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('chains the backup on api-refactor and add-retries on the backup, all on lane 0 — the parents computeStack gives', async () => {
    // act
    const { layout, state } = await realLayout(fixture);

    // assert
    expect(chainOf(layout, state)).toEqual(chainOfState(state));
    expect(chainOfState(state).map((link) => `${link.name} on ${link.parent}`)).toEqual([
      `api-refactor on ${TRUNK}`,
      'api-refactor-backup on api-refactor',
      'add-retries on api-refactor-backup',
      'retry-metrics on add-retries',
    ]);
    expect(layout.rows.every((row) => row.lane === 0)).toBe(true);
    expect(layout.lanes).toBe(1);
  });
});

describe('a merged branch (F5)', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildStack();
    fixture.commitOnTrunk('g', 'g\n');
    fixture.git(['branch', 'merged-already', 'origin/main~1']);
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('is listed in refs, has no DAG line and gets no row', async () => {
    // act
    const input = await readGraphInput(git, fixture.dir, TRUNK);
    const { layout } = await realLayout(fixture);

    // assert
    const merged = shaOf(fixture, 'merged-already');
    expect(parseRefs(input.refs).find((entry) => entry.name === 'merged-already')?.sha).toBe(merged);
    expect(input.dag.split('\n').some((line) => line.startsWith(merged))).toBe(false);
    expect(layout.rows.some((row) => row.kind === 'layer' && row.name === 'merged-already')).toBe(false);
  });

  it('HEAD on it, dirty: the trunk row is filled and the working-tree row sits directly above it naming merged-already; the elided row is there because every root is behind the moved tip', async () => {
    // arrange
    fixture.git(['checkout', '-q', 'merged-already']);

    // act
    const { layout, state } = await realLayout(fixture, true);

    // assert
    expect(state.head).toBe('merged-already');
    expect(layout.rows.slice(-3).map((row) => row.kind)).toEqual(['elided', 'workingTree', 'trunk']);
    expect(trunkRow(layout).node).toBe('filled');
    const workingTree = layout.rows[layout.rows.length - 2];
    expect(workingTree?.kind === 'workingTree' ? workingTree.parent : null).toBe('merged-already');
    expect(filledLayer(layout)).toBeNull();
  });
});

describe('local trunk ahead of origin/main (F3, D59)', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildStack();
    fixture.git(['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(fixture.dir, 'g'), 'g\n');
    fixture.git(['add', 'g']);
    fixture.git(['commit', '-q', '-m', 'local only']);
    fixture.git(['checkout', '-q', 'retry-metrics']);
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('main is a DAG line and so a one-row stack on lane 1 beside the stack — the quirk drawn as git says; computeStack does not list it', async () => {
    // act
    const { layout, state } = await realLayout(fixture);

    // assert
    expect(layout.rows.map(skeleton)).toContainEqual({ kind: 'layer', name: 'main', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 });
    expect(state.layers.map((layer) => layer.name)).not.toContain('main');
    expect(layout.rows.some((row) => row.kind === 'elided')).toBe(false);
  });
});

describe('bottom layer amended (E14)', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildStack();
    fixture.amend('api-refactor', 'a', 'a, fixed\n');
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('draws add-retries as a root of depth 2 with retry-metrics above it, and the amended api-refactor as a one-row stack on lane 1 — what computeStack lists, plus the branch it drops', async () => {
    // act
    const { layout, state } = await realLayout(fixture);

    // assert
    expect(layout.rows.map(skeleton)).toEqual([
      { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'filled', parent: 'add-retries', depth: 3 },
      { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow', parent: TRUNK, depth: 2 },
      { kind: 'layer', name: 'api-refactor', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
      { kind: 'trunk', name: TRUNK, lane: 0, node: 'hollow' },
    ]);
    expect(chainOf(layout, state)).toEqual(chainOfState(state));
    expect(chainOfState(state)).toEqual([
      { name: 'add-retries', parent: TRUNK, depth: 2 },
      { name: 'retry-metrics', parent: 'add-retries', depth: 3 },
    ]);
  });
});

describe('bottom layer squash-merged (E15)', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildStack();
    fixture.squashMergeBottomIntoTrunk();
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('still draws api-refactor as a layer — the squash commit is not its commit — with the history elided, depths 1, 2, 3 unchanged', async () => {
    // act
    const { layout, state } = await realLayout(fixture);

    // assert
    expect(layout.rows.map(skeleton)).toEqual([
      { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'filled', parent: 'add-retries', depth: 3 },
      { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow', parent: 'api-refactor', depth: 2 },
      { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      { kind: 'elided', lane: 0 },
      { kind: 'trunk', name: TRUNK, lane: 0, node: 'hollow' },
    ]);
    expect(chainOf(layout, state)).toEqual(chainOfState(state));
  });
});

describe('a merge of two named lines', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildStack();
    fixture.addUnrelatedStack();
    // HEAD is on retry-metrics; merging other-work into it makes a commit with two named ancestors.
    fixture.git(['merge', '-q', '--no-edit', 'other-work']);
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it("lays the merge out by depth — retry-metrics on add-retries, other-work a root of its own — where computeStack's count order chains api-refactor → other-work → add-retries → retry-metrics: the one shape the agreement does not cover, pinned", async () => {
    // act
    const { layout, state } = await realLayout(fixture);

    // assert: the graph is what git says — the deepest named ancestor is the parent
    expect(layout.rows.map(skeleton)).toEqual([
      { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'filled', parent: 'add-retries', depth: 5 },
      { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow', parent: 'api-refactor', depth: 2 },
      { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow', parent: TRUNK, depth: 1 },
      { kind: 'layer', name: 'other-work', lane: 1, node: 'hollow', joinsLane: 0, parent: TRUNK, depth: 1 },
      { kind: 'trunk', name: TRUNK, lane: 0, node: 'hollow' },
    ]);
    expect(layout.lanes).toBe(2);
    // computeStack sorts the same four branches by count then name and chains neighbours — its
    // own header admits the single-line assumption; the two disagree on other-work's and
    // add-retries's parents, and on nothing else
    expect(chainOfState(state)).toEqual([
      { name: 'api-refactor', parent: TRUNK, depth: 1 },
      { name: 'other-work', parent: 'api-refactor', depth: 1 },
      { name: 'add-retries', parent: 'other-work', depth: 2 },
      { name: 'retry-metrics', parent: 'add-retries', depth: 5 },
    ]);
  });
});
