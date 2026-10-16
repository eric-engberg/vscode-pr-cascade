/**
 * test/unit/viewmodel.test.ts — buildStackViewModel as a specification: pane B of
 * docs/view-lab.html as one model, every `Indicator` kind from its source field and its absence,
 * the fixed tail order, the age table from a fixed clock, the message rows and how they co-occur,
 * the working-tree row, Show Only This Stack, the three states a row can be in, and that the rows'
 * geometry is `layoutGraph`'s over the same texts.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no git-spice, no VS Code). Depends on:
 * src/core/viewmodel.ts, src/core/graph.ts (`layoutGraph` for the geometry rows; the types),
 * src/core/model.ts and src/core/gsLog.ts (types). The texts and SHA constants are copied from
 * test/unit/graph.test.ts (as graph.git.test.ts copied `skeleton`: a helper module for sixty lines
 * of constants is not worth a reading-order item, and the geometry rows prove the two files' texts
 * cannot drift apart unnoticed). The rows that belong to no `RepoState` (E82, E17) are the host's —
 * src/webview/protocol.ts's `HostNotice` — and have no test here. Plan: §7.1.1, §7.1.3, §7.2.1,
 * §7.8, §8 E3/E4/E5/E12/E15/E56/E57/E80, §9.4 `unit/viewmodel`, §10.1 item 23b (M6), §13.2 D68.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { describe, expect, it } from 'vitest';
import { layoutGraph } from '../../src/core/graph';
import type { GraphInput, GraphRow } from '../../src/core/graph';
import type { GsLogEntry } from '../../src/core/gsLog';
import type { Enrichment, PrExtras, RepoState, StackLayer } from '../../src/core/model';
import { buildStackViewModel, DETACHED_HEAD_TEXT, formatAge, NO_TRUNK_TEXT, NOT_ON_STACK_TEXT, REBASE_IN_PROGRESS_TEXT } from '../../src/core/viewmodel';
import type { BehindTrunk, LayerViewRow, StackViewModel, ViewModelInput, ViewRow } from '../../src/core/viewmodel';

// The repository every test asks about, and its trunk.
// see primer §4 (const)
const ROOT = '/work/app';
const TRUNK = 'origin/main';

// The fixed clock, and the dates that read as the view-lab's ages from it (viewmodel.ts's units).
// see primer §27 (`_` in a number literal)
const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;
const NOW = 1_760_000_000;
const AGO_3M = NOW - 3 * MINUTE;
const AGO_15M = NOW - 15 * MINUTE;
const AGO_40M = NOW - 40 * MINUTE;
const AGO_26H = NOW - 26 * HOUR;
const AGO_2D = NOW - 2 * DAY;
const AGO_3D = NOW - 3 * DAY;
const AGO_1W = NOW - 7 * DAY;
const AGO_2MO = NOW - 61 * DAY; // 61, not 60: sixty days is 1.97 mean months and reads `1mo`
/** The date of every refs line a shape does not care about: `3m`. */
const DATE = AGO_3M;

// The SHA constants of test/unit/graph.test.ts, the ones the shapes below use.
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
const SHA_4 = '4444444444444444444444444444444444444444';
const SHA_6 = '6666666666666666666666666666666666666666';

/** Trunk's tip as `rev-list -1` prints it, dated 26 hours ago. */
// see primer §12 (template strings)
const TRUNK_TIP = `${SHA_T} ${AGO_26H}\n`;

/** A refs text as `for-each-ref` prints it, a date per line this time — the ages are the point. */
// see primer §54 (destructuring a triple in a parameter) and §78 (a tuple type)
function refs(...entries: [string, string, number][]): string {
  return entries.map(([name, sha, date]) => `${name} ${sha} ${date}\n`).join('');
}

/** A DAG text as `rev-list --parents` prints it. */
function dag(...lines: string[][]): string {
  return lines.map((line) => `${line.join(' ')}\n`).join('');
}

/** `https://github.com/org/repo/pull/<n>`. */
function pullUrl(n: number): string {
  return `https://github.com/org/repo/pull/${n}`;
}

// The Appendix A stack: three layers on trunk, HEAD on the top one.
const APPENDIX_A_REFS = refs(['add-retries', SHA_B, DATE], ['api-refactor', SHA_A, DATE], ['main', SHA_T, DATE], ['retry-metrics', SHA_C, DATE]);
const APPENDIX_A_DAG = dag([SHA_C, SHA_B], [SHA_B, SHA_A], [SHA_A, SHA_T]);
const APPENDIX_A_GRAPH: GraphInput = { refs: APPENDIX_A_REFS, dag: APPENDIX_A_DAG, trunkTip: TRUNK_TIP };

// git-spice's lines for it as parseGsLog types them: the trunk line and three clean tracked layers.
const TRUNK_LINE: GsLogEntry = { name: 'main' };
const BOTTOM: GsLogEntry = { name: 'api-refactor', down: { name: 'main', needsRestack: false } };
const MIDDLE: GsLogEntry = { name: 'add-retries', down: { name: 'api-refactor', needsRestack: false } };
const TOP: GsLogEntry = { name: 'retry-metrics', down: { name: 'add-retries', needsRestack: false } };
const APPENDIX_A_ENTRIES: readonly GsLogEntry[] = [TRUNK_LINE, BOTTOM, MIDDLE, TOP];

/** Every branch pushed: the digest's `refs/remotes/<remote>/…` names as bare branch names, `HEAD` among them. */
// see primer §21 (Set)
const ALL_REMOTE: ReadonlySet<string> = new Set(['HEAD', 'main', 'api-refactor', 'add-retries', 'retry-metrics']);

/**
 * One layer as `enrich` leaves it: `tracking` set when given (an entry, or `null` for untracked),
 * no such key when not — the shape computeStack builds and the one an unknown layer keeps.
 */
// see primer §11 (an optional parameter) and §13 (a default parameter value)
function layer(name: string, sha: string, parent: string, parentSha: string, commitCount: number, tracking?: GsLogEntry | null, isCurrent = false): StackLayer {
  const built: StackLayer = { name, sha, parent, parentSha, commitCount, isCurrent };
  if (tracking !== undefined) {
    built.tracking = tracking;
  }
  return built;
}

/** An `enriched` enrichment from the lines and the remote names — what `enrich` builds (complete unless told otherwise). */
// see primer §19 (a Map built from pairs)
function enriched(entries: readonly GsLogEntry[], remoteBranches: ReadonlySet<string>, complete = true): Enrichment {
  return { kind: 'enriched', ranGsLog: true, malformed: [], byName: new Map(entries.map((entry) => [entry.name, entry])), complete, remoteBranches };
}

/** The entry naming `name`, `null` when a complete answer lacks it — what `withTracking` would put on the layer. */
function trackingIn(entries: readonly GsLogEntry[], name: string): GsLogEntry | null {
  return entries.find((entry) => entry.name === name) ?? null;
}

/**
 * What a test varies; everything else is the Appendix A stack with HEAD on the top, clean,
 * enriched, every branch pushed. `enrichment: 'none'` leaves the key off the state; `graph: null`
 * is passed through as the no-trunk encoding.
 */
interface Shape {
  graph?: GraphInput | null;
  refs?: string;
  dag?: string;
  trunkTip?: string;
  trunk?: string | null;
  head?: string | null;
  rebaseInProgress?: boolean;
  layers?: StackLayer[];
  enrichment?: Enrichment | 'none';
  entries?: readonly GsLogEntry[];
  remoteBranches?: ReadonlySet<string>;
  extras?: ReadonlyMap<string, PrExtras>;
  workingTreeFiles?: number;
  behindTrunk?: BehindTrunk | null;
  showOnlyThisStack?: boolean;
}

/** The input for a shape, every unnamed field at its default. */
// see primer §30 (`??`) and §16 (object literals: shorthand keys)
function input(shape: Shape = {}): ViewModelInput {
  const entries = shape.entries ?? APPENDIX_A_ENTRIES;
  const layers = shape.layers ?? [
    layer('api-refactor', SHA_A, TRUNK, SHA_T, 1, trackingIn(entries, 'api-refactor')),
    layer('add-retries', SHA_B, 'api-refactor', SHA_A, 2, trackingIn(entries, 'add-retries')),
    layer('retry-metrics', SHA_C, 'add-retries', SHA_B, 3, trackingIn(entries, 'retry-metrics'), true),
  ];
  const state: RepoState = {
    root: ROOT,
    trunk: shape.trunk === undefined ? TRUNK : shape.trunk,
    head: shape.head === undefined ? 'retry-metrics' : shape.head,
    rebaseInProgress: shape.rebaseInProgress ?? false,
    layers,
  };
  if (shape.enrichment !== 'none') {
    state.enrichment = shape.enrichment ?? enriched(entries, shape.remoteBranches ?? ALL_REMOTE);
  }
  let graph: GraphInput | null = APPENDIX_A_GRAPH;
  if (shape.graph !== undefined) {
    graph = shape.graph;
  } else if (shape.refs !== undefined || shape.dag !== undefined || shape.trunkTip !== undefined) {
    graph = { refs: shape.refs ?? APPENDIX_A_REFS, dag: shape.dag ?? APPENDIX_A_DAG, trunkTip: shape.trunkTip ?? TRUNK_TIP };
  }
  return {
    state,
    graph,
    workingTreeFiles: shape.workingTreeFiles ?? 0,
    now: NOW,
    showOnlyThisStack: shape.showOnlyThisStack ?? false,
    behindTrunk: shape.behindTrunk === undefined ? null : shape.behindTrunk,
    extras: shape.extras ?? new Map(),
  };
}

/** The layer row called `name`; a failure names it. */
// see primer §18 (throw)
function rowOf(model: StackViewModel, name: string): LayerViewRow {
  const row = model.rows.find((candidate) => candidate.kind === 'layer' && candidate.name === name);
  if (row === undefined || row.kind !== 'layer') {
    throw new Error(`no layer row called ${name}; the rows are ${model.rows.map((candidate) => (candidate.kind === 'layer' ? candidate.name : candidate.kind)).join(', ')}`);
  }
  return row;
}

/** `layoutGraph`'s own shape of a row and the model's, in one flat form: what the rail draws. */
interface Geometry {
  kind: string;
  name?: string;
  lane: number;
  node?: string;
  joinsLane?: number;
}

function geometry(row: ViewRow | GraphRow): Geometry {
  if (row.kind === 'layer') {
    return { kind: row.kind, name: row.name, lane: row.lane, node: row.node, joinsLane: row.joinsLane };
  }
  if (row.kind === 'trunk') {
    return { kind: row.kind, name: row.name, lane: row.lane, node: row.node };
  }
  if (row.kind === 'workingTree') {
    return { kind: row.kind, lane: row.lane, node: row.node };
  }
  return { kind: row.kind, lane: row.lane };
}

/** A layer row's context with every key false but the ones given. */
// see primer §43 (`Record`), §49 (`Partial`: every field optional) and §16 (spread: the given keys last, so they win)
function layerContext(name: string, on: Partial<Record<'isCurrent' | 'isTracked' | 'isUntracked' | 'isTrunkLine' | 'hasPR' | 'isDraft', boolean>> = {}) {
  return { webviewSection: 'layer' as const, repo: ROOT, layer: name, isCurrent: false, isTracked: false, isUntracked: false, isTrunkLine: false, hasPR: false, isDraft: false, ...on };
}

// ---------------------------------------------------------------------------------------------
// Pane B of docs/view-lab.html (lines 380–423) as inputs: the texts of test/unit/graph.test.ts's
// L17 with the mockup's dates, git-spice's lines for every branch it tracks, the remote-tracking
// names, and M7's gh tier for three pull requests.
// ---------------------------------------------------------------------------------------------

const P1 = 'feat/FWRK-1434-part1';
const P2 = 'feat/FWRK-1434-part2';
const P3 = 'feat/FWRK-1434-part3';
const P4 = 'feat/FWRK-1434-part4';
const S_A = 'feat/FWRK-1610-a-collector-core';
const S_B = 'feat/FWRK-1610-b-collector-auth';
const S_C = 'feat/FWRK-1610-c-collector-tests';
const S_D = 'feat/FWRK-1610-d-collector-api';
const S_E = 'feat/FWRK-1610-e-collector-ui';
const FIX = 'fix/FWRK-1500-retry-timeout';
const CHORE = 'chore/FWRK-1011-update-kbs-settings';

// for-each-ref's byte order: `chore/…` < `feat/…` < `fix/…` < `main`.
const PANE_B_REFS = refs(
  [CHORE, SHA_6, AGO_2MO],
  [P1, SHA_1, AGO_3D],
  [P2, SHA_2, AGO_40M],
  [P3, SHA_3, AGO_2D],
  [P4, SHA_4, AGO_15M],
  [S_A, SHA_A, AGO_3M],
  [S_B, SHA_B, AGO_3M],
  [S_C, SHA_C, AGO_3M],
  [S_D, SHA_D, AGO_3M],
  [S_E, SHA_E, AGO_3M],
  [FIX, SHA_F, AGO_1W],
  ['main', SHA_T, AGO_26H],
);
const PANE_B_DAG = dag(
  [SHA_E, SHA_D], [SHA_D, SHA_C], [SHA_C, SHA_B], [SHA_B, SHA_A], [SHA_A, SHA_1],
  [SHA_4, SHA_3], [SHA_3, SHA_2], [SHA_2, SHA_1], [SHA_1, SHA_OLD],
  [SHA_F, SHA_T], [SHA_6, SHA_OLD],
);

// git-spice's answer as parseGsLog types it. `push` only on the five branches git-spice submitted
// (chore is the plain-pushed one: a pull request git-spice adopted, pushed with plain git, so no
// `push`); the 1610 stack is tracked and never submitted; part4 has no line (untracked).
const P1_ENTRY: GsLogEntry = { name: P1, down: { name: 'main', needsRestack: false }, change: { id: '#480', url: pullUrl(480), status: 'merged' }, push: { ahead: 0, behind: 0, needsPush: false } };
const P2_ENTRY: GsLogEntry = {
  name: P2,
  down: { name: P1, needsRestack: false },
  change: { id: '#481', url: pullUrl(481), status: 'open', comments: { resolved: 3, unresolved: 2, total: 5 } },
  push: { ahead: 1, behind: 0, needsPush: true },
};
const P3_ENTRY: GsLogEntry = { name: P3, down: { name: P2, needsRestack: true }, change: { id: '#482', url: pullUrl(482), status: 'open' }, push: { ahead: 0, behind: 0, needsPush: false } };
const FIX_ENTRY: GsLogEntry = { name: FIX, down: { name: 'main', needsRestack: false }, change: { id: '#479', url: pullUrl(479), status: 'open' }, push: { ahead: 0, behind: 0, needsPush: false } };
const CHORE_ENTRY: GsLogEntry = { name: CHORE, down: { name: 'main', needsRestack: true }, change: { id: '#478', url: pullUrl(478), status: 'open' } };
const PANE_B_ENTRIES: readonly GsLogEntry[] = [
  TRUNK_LINE,
  P1_ENTRY,
  P2_ENTRY,
  P3_ENTRY,
  FIX_ENTRY,
  CHORE_ENTRY,
  { name: S_A, down: { name: P1, needsRestack: false } },
  { name: S_B, down: { name: S_A, needsRestack: false } },
  { name: S_C, down: { name: S_B, needsRestack: false } },
  { name: S_D, down: { name: S_C, needsRestack: false } },
  { name: S_E, down: { name: S_D, needsRestack: false } },
];
/** The pushed branches: not part4, not the 1610 stack. */
const PANE_B_REMOTE: ReadonlySet<string> = new Set(['HEAD', 'main', P1, P2, P3, FIX, CHORE]);
/** M7's gh tier, hand-written: part2 has changes requested and a drifted base, part3 is a draft with failing checks, fix is approved. */
const PANE_B_EXTRAS: ReadonlyMap<string, PrExtras> = new Map([
  [P2, { isDraft: false, reviewDecision: 'changes-requested', checks: { failing: 0, total: 7 }, baseRef: 'main', title: null }],
  [P3, { isDraft: true, reviewDecision: null, checks: { failing: 2, total: 7 }, baseRef: P2, title: null }],
  [FIX, { isDraft: false, reviewDecision: 'approved', checks: null, baseRef: 'main', title: null }],
]);

/** A fresh pane B input on every call, so a test that compares before and after copies nothing by accident. */
function paneB(overrides: Shape = {}): ViewModelInput {
  return input({
    refs: PANE_B_REFS,
    dag: PANE_B_DAG,
    head: P3,
    layers: [layer(P1, SHA_1, TRUNK, SHA_T, 1, P1_ENTRY), layer(P2, SHA_2, P1, SHA_1, 2, P2_ENTRY), layer(P3, SHA_3, P2, SHA_2, 3, P3_ENTRY, true)],
    entries: PANE_B_ENTRIES,
    remoteBranches: PANE_B_REMOTE,
    extras: PANE_B_EXTRAS,
    workingTreeFiles: 2,
    behindTrunk: { origin: 5, local: 3 },
    ...overrides,
  });
}

// see primer §5 (arrow functions)
describe('buildStackViewModel', () => {
  describe('message rows (E3, E4, E5, E12) and how they co-occur', () => {
    it('no trunk (E4): the one warning, no rows at all and no lanes — the graph texts are not even read', () => {
      // act
      const model = buildStackViewModel(input({ trunk: null, head: null, layers: [], enrichment: 'none', graph: null }));

      // assert: the four texts are pinned once each in this group, so 23j's migration has the words here
      expect(model).toStrictEqual({ repo: ROOT, rows: [], lanes: 0, messages: [{ kind: 'noTrunk', text: NO_TRUNK_TEXT, severity: 'warning' }] });
      expect(NO_TRUNK_TEXT).toBe('No trunk found — set prCascade.trunk');
    });

    it('a paused rebase (E12) replaces the detached-HEAD row: one warning, the layers drawn hollow, no working-tree row for the dirty tree', () => {
      // act
      const model = buildStackViewModel(input({ head: null, rebaseInProgress: true, workingTreeFiles: 1 }));

      // assert
      expect(model.messages).toStrictEqual([{ kind: 'rebaseInProgress', text: REBASE_IN_PROGRESS_TEXT, severity: 'warning' }]);
      expect(REBASE_IN_PROGRESS_TEXT).toBe('Rebase in progress — resolve it first');
      expect(model.rows.map(geometry)).toEqual([
        { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'hollow' },
        { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow' },
        { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow' },
        { kind: 'trunk', name: TRUNK, lane: 0, node: 'hollow' },
      ]);
    });

    it('a detached HEAD (E3): one information row, the layers drawn, nothing filled', () => {
      // act
      const model = buildStackViewModel(input({ head: null }));

      // assert
      expect(model.messages).toStrictEqual([{ kind: 'detachedHead', text: DETACHED_HEAD_TEXT, severity: 'information' }]);
      expect(DETACHED_HEAD_TEXT).toBe('Detached HEAD');
      expect(model.rows.some((row) => (row.kind === 'layer' || row.kind === 'trunk') && row.node === 'filled')).toBe(false);
    });

    it('on trunk with no stack anywhere (E5): "Not on a stack" and the filled trunk row alone', () => {
      // act
      const model = buildStackViewModel(input({ refs: refs(['main', SHA_T, DATE]), dag: '', head: 'main', layers: [], enrichment: 'none' }));

      // assert
      expect(model.messages).toStrictEqual([{ kind: 'notOnStack', text: NOT_ON_STACK_TEXT, severity: 'information' }]);
      expect(NOT_ON_STACK_TEXT).toBe('Not on a stack');
      expect(model.rows).toStrictEqual([
        {
          kind: 'trunk',
          name: TRUNK,
          sha: SHA_T,
          lane: 0,
          node: 'filled',
          indicators: [],
          age: '26h',
          tooltip: ['origin/main @ 0000000'],
          context: { webviewSection: 'trunk', repo: ROOT, trunk: TRUNK, isCurrent: true },
        },
      ]);
      expect(model.lanes).toBe(1);
    });

    it("detached in a repository with no stack: the detached row, then \"Not on a stack\" (the tree's order)", () => {
      // act
      const model = buildStackViewModel(input({ refs: refs(['main', SHA_T, DATE]), dag: '', head: null, layers: [], enrichment: 'none' }));

      // assert
      expect(model.messages.map((message) => message.kind)).toEqual(['detachedHead', 'notOnStack']);
    });

    it("git-spice's own interrupted restack (22b: HEAD detached at trunk's tip, no layer): the rebase row, then \"Not on a stack\"", () => {
      // act
      const model = buildStackViewModel(input({ refs: refs(['main', SHA_T, DATE]), dag: '', head: null, rebaseInProgress: true, layers: [], enrichment: 'none' }));

      // assert
      expect(model.messages.map((message) => message.kind)).toEqual(['rebaseInProgress', 'notOnStack']);
    });

    it('on trunk beside other stacks: no message — "Not on a stack" only when the repository has no layer at all (§7.1.1); the trunk row is filled and the stacks are drawn', () => {
      // act: the enrichment stays, so the other stack's rows read byName
      const model = buildStackViewModel(input({ head: 'main', layers: [] }));

      // assert
      expect(model.messages).toStrictEqual([]);
      expect(model.rows.map(geometry)).toEqual([
        { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'hollow' },
        { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow' },
        { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow' },
        { kind: 'trunk', name: TRUNK, lane: 0, node: 'filled' },
      ]);
    });
  });

  describe('the working-tree row', () => {
    it('sits directly above the checked-out layer on its lane, with the file count as its one indicator, age now, one tooltip line and its context naming the branch', () => {
      // act
      const model = buildStackViewModel(input({ head: 'add-retries', workingTreeFiles: 3 }));

      // assert
      expect(model.rows[1]).toStrictEqual({
        kind: 'workingTree',
        parent: 'add-retries',
        lane: 0,
        node: 'dashed',
        indicators: [{ kind: 'dirty', files: 3 }],
        age: 'now',
        tooltip: ['3 files changed on add-retries'],
        context: { webviewSection: 'workingTree', repo: ROOT, layer: 'add-retries' },
      });
      expect(geometry(model.rows[2])).toEqual({ kind: 'layer', name: 'add-retries', lane: 0, node: 'filled' });
    });

    it('is not drawn for a clean tree', () => {
      // act
      const model = buildStackViewModel(input({ workingTreeFiles: 0 }));

      // assert
      expect(model.rows.some((row) => row.kind === 'workingTree')).toBe(false);
    });

    it("is not drawn when nothing is checked out, dirty or not (the graph's rule: nowhere to hang it)", () => {
      // act
      const model = buildStackViewModel(input({ head: null, workingTreeFiles: 2 }));

      // assert
      expect(model.rows.some((row) => row.kind === 'workingTree')).toBe(false);
      expect(model.messages.map((message) => message.kind)).toEqual(['detachedHead']);
    });

    it('the everyday case — HEAD on a local main behind origin/main, one file changed: the working tree sits above the filled trunk row, names main and says "1 file"', () => {
      // act
      const model = buildStackViewModel(
        input({
          refs: refs(['add-retries', SHA_B, DATE], ['api-refactor', SHA_A, DATE], ['main', SHA_OLD, DATE], ['retry-metrics', SHA_C, DATE]),
          head: 'main',
          layers: [],
          workingTreeFiles: 1,
        }),
      );

      // assert
      // see primer §25 (arrays: `slice` with a negative start — the last two)
      const [workingTree, trunk] = model.rows.slice(-2);
      expect(workingTree).toStrictEqual({
        kind: 'workingTree',
        parent: 'main',
        lane: 0,
        node: 'dashed',
        indicators: [{ kind: 'dirty', files: 1 }],
        age: 'now',
        tooltip: ['1 file changed on main'],
        context: { webviewSection: 'workingTree', repo: ROOT, layer: 'main' },
      });
      expect(geometry(trunk)).toEqual({ kind: 'trunk', name: TRUNK, lane: 0, node: 'filled' });
      expect(model.messages).toStrictEqual([]);
    });
  });

  describe('Show Only This Stack (§7.2.1)', () => {
    it("on trunk with the toggle on there is no stack of HEAD's to show alone: every stack is drawn as if the toggle were off, and no message", () => {
      // act
      const on = buildStackViewModel(input({ head: 'main', layers: [], showOnlyThisStack: true }));
      const off = buildStackViewModel(input({ head: 'main', layers: [] }));

      // assert
      expect(on).toStrictEqual(off);
      expect(on.messages).toStrictEqual([]);
    });

    it('a detached HEAD names no stack: the toggle draws every stack, with the detached row', () => {
      // act
      const model = buildStackViewModel(input({ head: null, showOnlyThisStack: true }));

      // assert
      expect(model.rows.map(geometry)).toEqual([
        { kind: 'layer', name: 'retry-metrics', lane: 0, node: 'hollow' },
        { kind: 'layer', name: 'add-retries', lane: 0, node: 'hollow' },
        { kind: 'layer', name: 'api-refactor', lane: 0, node: 'hollow' },
        { kind: 'trunk', name: TRUNK, lane: 0, node: 'hollow' },
      ]);
      expect(model.messages.map((message) => message.kind)).toEqual(['detachedHead']);
    });
  });

  describe('unknown, untracked, tracked — the three states of a row', () => {
    it('with no enrichment at all every layer is unknown: no indicator — not even the cloud, nothing was read — not dim, two tooltip lines, neither tracked nor untracked', () => {
      // arrange: layers fresh from computeStack, no `tracking` key on any
      const bare = [layer('api-refactor', SHA_A, TRUNK, SHA_T, 1), layer('add-retries', SHA_B, 'api-refactor', SHA_A, 2), layer('retry-metrics', SHA_C, 'add-retries', SHA_B, 3, undefined, true)];

      // act
      const model = buildStackViewModel(input({ enrichment: 'none', layers: bare }));

      // assert
      for (const name of ['retry-metrics', 'add-retries', 'api-refactor']) {
        const row = rowOf(model, name);
        expect(row.indicators, name).toStrictEqual([]);
        expect(row.dim, name).toBe(false);
        expect(row.tooltip.length, name).toBe(2);
        expect(row.context, name).toStrictEqual(layerContext(name, { isCurrent: name === 'retry-metrics' }));
      }
      expect(rowOf(model, 'api-refactor').tooltip).toStrictEqual(['api-refactor @ aaaaaaa', 'base: origin/main @ 0000000']);
    });

    it('not enriched (E57) reads the same as no enrichment', () => {
      // arrange
      const bare = [layer('api-refactor', SHA_A, TRUNK, SHA_T, 1), layer('add-retries', SHA_B, 'api-refactor', SHA_A, 2), layer('retry-metrics', SHA_C, 'add-retries', SHA_B, 3, undefined, true)];

      // act
      const none = buildStackViewModel(input({ enrichment: 'none', layers: bare }));
      const failed = buildStackViewModel(input({ enrichment: { kind: 'not-enriched', cause: 'gs-log-failed', reason: 'gs log short --all --json failed: exited 1' }, layers: bare }));

      // assert
      expect(failed.rows).toStrictEqual(none.rows);
    });
  });

  describe("behindTrunk — the trunk row's input", () => {
    // see primer §78 (`it.each` over object rows)
    it.each([
      { title: 'five and three behind', behindTrunk: { origin: 5, local: 3 }, expected: [{ kind: 'behindTrunk', origin: 5, local: 3 }] },
      { title: 'origin behind, the local trunk level', behindTrunk: { origin: 5, local: 0 }, expected: [{ kind: 'behindTrunk', origin: 5, local: 0 }] },
      { title: 'only the local trunk behind', behindTrunk: { origin: 0, local: 3 }, expected: [{ kind: 'behindTrunk', origin: 0, local: 3 }] },
      { title: 'both level — present only when either count is above zero', behindTrunk: { origin: 0, local: 0 }, expected: [] },
      { title: 'not spawned yet (null until 23d)', behindTrunk: null, expected: [] },
    ])('$title', ({ behindTrunk, expected }) => {
      // act
      const model = buildStackViewModel(input({ behindTrunk }));

      // assert
      const trunk = model.rows[model.rows.length - 1];
      expect(trunk.kind).toBe('trunk');
      if (trunk.kind === 'trunk') {
        expect(trunk.indicators).toStrictEqual(expected);
      }
    });

    it("words each count above zero as a tooltip line after the trunk's commit", () => {
      // act
      const model = buildStackViewModel(input({ behindTrunk: { origin: 5, local: 1 } }));

      // assert
      const trunk = model.rows[model.rows.length - 1];
      expect(trunk.kind === 'trunk' ? trunk.tooltip : null).toStrictEqual([
        'origin/main @ 0000000',
        "HEAD's stack is 5 commits behind origin/main",
        'the local trunk branch is 1 commit behind origin/main',
      ]);
    });
  });

  describe("the rows' geometry is layoutGraph's", () => {
    const shapes = [
      { title: 'pane B, dirty on part3', refs: PANE_B_REFS, dag: PANE_B_DAG, head: P3, workingTreeFiles: 2, showOnlyThisStack: false },
      { title: 'the Appendix A stack, clean, on the top layer', refs: APPENDIX_A_REFS, dag: APPENDIX_A_DAG, head: 'retry-metrics', workingTreeFiles: 0, showOnlyThisStack: false },
      {
        title: 'the everyday main behind origin/main, dirty',
        refs: refs(['add-retries', SHA_B, DATE], ['api-refactor', SHA_A, DATE], ['main', SHA_OLD, DATE], ['retry-metrics', SHA_C, DATE]),
        dag: APPENDIX_A_DAG,
        head: 'main',
        workingTreeFiles: 1,
        showOnlyThisStack: false,
      },
      {
        title: "23a's stale stack beside a fresh root, HEAD on main, dirty",
        refs: refs(['fresh', SHA_A, DATE], ['main', SHA_T, DATE], ['stale', SHA_B, DATE], ['stale-up', SHA_C, DATE]),
        dag: dag([SHA_C, SHA_B], [SHA_B, SHA_OLD], [SHA_A, SHA_T]),
        head: 'main',
        workingTreeFiles: 1,
        showOnlyThisStack: false,
      },
      { title: 'pane B with Show Only This Stack', refs: PANE_B_REFS, dag: PANE_B_DAG, head: P3, workingTreeFiles: 2, showOnlyThisStack: true },
    ];

    it.each(shapes)('$title', ({ refs: refsText, dag: dagText, head, workingTreeFiles, showOnlyThisStack }) => {
      // arrange: the filter needs HEAD on a stack, which pane B's layers say; the other shapes carry none
      const modelInput = showOnlyThisStack ? paneB({ showOnlyThisStack: true }) : input({ refs: refsText, dag: dagText, head, layers: [], workingTreeFiles });

      // act
      const model = buildStackViewModel(modelInput);
      const layout = layoutGraph({ refs: refsText, dag: dagText, trunkTip: TRUNK_TIP }, { trunk: TRUNK, head, dirty: workingTreeFiles > 0, onlyStackOf: showOnlyThisStack ? head : undefined });

      // assert: the same rows in the same lanes, and the facts copied from them
      expect(model.rows.map(geometry)).toEqual(layout.rows.map(geometry));
      expect(model.lanes).toBe(layout.lanes);
      const shaOf = new Map<string, string>();
      for (const row of layout.rows) {
        if (row.kind === 'layer') {
          shaOf.set(row.name, row.sha);
        } else if (row.kind === 'trunk') {
          shaOf.set(row.name, row.sha);
        }
      }
      for (const [index, row] of model.rows.entries()) {
        const graphRow = layout.rows[index];
        if (row.kind === 'layer' && graphRow.kind === 'layer') {
          expect(row.sha, row.name).toBe(graphRow.sha);
          expect(row.parentSha, row.name).toBe(shaOf.get(row.parent));
          expect(row.forks, row.name).toStrictEqual(graphRow.forks);
        }
      }
    });
  });

  describe("pure, and the caller's one mistake", () => {
    it("never changes its input — the state, its layers, the enrichment's map and set, the graph texts, the extras", () => {
      // arrange: a deep copy that keeps a Map and a Set (JSON would not)
      // see primer §50 (`structuredClone`)
      const modelInput = paneB();
      const before = structuredClone(modelInput);

      // act
      buildStackViewModel(modelInput);

      // assert
      expect(modelInput).toStrictEqual(before);
    });

    it('gives an equal model for the same input twice, and a new one', () => {
      // arrange
      const modelInput = paneB();

      // act
      const first = buildStackViewModel(modelInput);
      const second = buildStackViewModel(modelInput);

      // assert
      expect(second).toStrictEqual(first);
      expect(second).not.toBe(first);
      expect(second.rows).not.toBe(first.rows);
    });

    it("throws, naming the root, when the graph texts are missing beside a trunk — a caller's mistake, not a state", () => {
      expect(() => buildStackViewModel(input({ graph: null }))).toThrow('buildStackViewModel: no graph texts for /work/app, whose trunk is origin/main');
    });
  });
});

describe('formatAge — from a fixed clock', () => {
  // see primer §78 (`it.each` over object rows: `$title → $expected`)
  it.each([
    { title: 'a date in the future', committedAt: NOW + 1, expected: 'now' },
    { title: 'a date a day ahead (a clock skew)', committedAt: NOW + DAY, expected: 'now' },
    { title: 'this second', committedAt: NOW, expected: 'now' },
    { title: '59 s', committedAt: NOW - 59, expected: 'now' },
    { title: '60 s', committedAt: NOW - 60, expected: '1m' },
    { title: '59 min', committedAt: NOW - 59 * MINUTE, expected: '59m' },
    { title: '60 min', committedAt: NOW - HOUR, expected: '1h' },
    { title: '26 h (the trunk row)', committedAt: NOW - 26 * HOUR, expected: '26h' },
    { title: '47 h', committedAt: NOW - 47 * HOUR, expected: '47h' },
    { title: '47 h 59 min 59 s', committedAt: NOW - 48 * HOUR + 1, expected: '47h' },
    { title: '48 h', committedAt: NOW - 48 * HOUR, expected: '2d' },
    { title: '6 d', committedAt: NOW - 6 * DAY, expected: '6d' },
    { title: '7 d', committedAt: NOW - 7 * DAY, expected: '1w' },
    { title: '13 d', committedAt: NOW - 13 * DAY, expected: '1w' },
    { title: '14 d', committedAt: NOW - 14 * DAY, expected: '2w' },
    { title: '29 d', committedAt: NOW - 29 * DAY, expected: '4w' },
    { title: '30 d — still weeks under a mean month', committedAt: NOW - 30 * DAY, expected: '4w' },
    { title: '31 d', committedAt: NOW - 31 * DAY, expected: '1mo' },
    { title: '59 d', committedAt: NOW - 59 * DAY, expected: '1mo' },
    { title: '60 d — 1.97 mean months', committedAt: NOW - 60 * DAY, expected: '1mo' },
    { title: "61 d (pane B's chore)", committedAt: NOW - 61 * DAY, expected: '2mo' },
    { title: '359 d', committedAt: NOW - 359 * DAY, expected: '11mo' },
    { title: '360 d', committedAt: NOW - 360 * DAY, expected: '11mo' },
    { title: '364 d — 12mo never prints', committedAt: NOW - 364 * DAY, expected: '11mo' },
    { title: '365 d', committedAt: NOW - 365 * DAY, expected: '1y' },
    { title: '719 d', committedAt: NOW - 719 * DAY, expected: '1y' },
    { title: '720 d', committedAt: NOW - 720 * DAY, expected: '1y' },
    { title: '730 d', committedAt: NOW - 730 * DAY, expected: '2y' },
  ])('$title → $expected', ({ committedAt, expected }) => {
    expect(formatAge(committedAt, NOW)).toBe(expected);
  });
});
