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
import type { BehindTrunk, Indicator, LayerViewRow, StackViewModel, ViewModelInput, ViewRow } from '../../src/core/viewmodel';

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

/** The first seven characters, as the tree's tooltip shows a SHA. */
// see primer §23 (`slice`)
function short(sha: string): string {
  return sha.slice(0, 7);
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

/** The same set without one name (`new Set(other)` copies — primer §21). */
function without(set: ReadonlySet<string>, name: string): Set<string> {
  const copy = new Set(set);
  copy.delete(name);
  return copy;
}

/** A change request git-spice knows, open; and the circle it draws with no gh extras. */
const CHANGE = { id: '#7', url: pullUrl(7), status: 'open' };
const PR_7: Indicator = { kind: 'pr', id: '#7', url: pullUrl(7), state: 'open', reviewDecision: null, title: null };

/** gh's answer with nothing of note, to vary one field at a time. */
const PLAIN_EXTRAS: PrExtras = { isDraft: false, reviewDecision: null, checks: null, baseRef: 'add-retries', title: null };

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
// see primer §19 (a Map built from pairs) and §49 (`Extract`: the one member of the union, so a test may spread it)
function enriched(entries: readonly GsLogEntry[], remoteBranches: ReadonlySet<string>, complete = true): Extract<Enrichment, { kind: 'enriched' }> {
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

/** The indicators of the layer row called `name`. */
function indicatorsOf(model: StackViewModel, name: string): readonly Indicator[] {
  return rowOf(model, name).indicators;
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

/** One of pane B's 1610 rows: tracked, never submitted, never pushed — the cloud and nothing else. */
function collectorRow(name: string, sha: string, parent: string, parentSha: string): LayerViewRow {
  return {
    kind: 'layer',
    name,
    sha,
    parent,
    parentSha,
    forks: [SHA_OLD],
    lane: 0,
    node: 'hollow',
    indicators: [{ kind: 'neverPushed' }],
    age: '3m',
    dim: false,
    tooltip: [`${name} @ ${short(sha)}`, `base: ${parent} @ ${short(parentSha)}`, `git-spice: tracked on ${parent}`],
    context: layerContext(name, { isTracked: true }),
  };
}

/** Pane B's checked-out row, part3: a restack due, a draft pull request, two failing checks. */
const PANE_B_PART3: LayerViewRow = {
  kind: 'layer',
  name: P3,
  sha: SHA_3,
  parent: P2,
  parentSha: SHA_2,
  forks: [SHA_OLD],
  lane: 1,
  node: 'filled',
  indicators: [
    { kind: 'needsRestack' },
    { kind: 'pr', id: '#482', url: pullUrl(482), state: 'draft', reviewDecision: null, title: null },
    { kind: 'checks', failing: 2, total: 7 },
  ],
  age: '2d',
  dim: false,
  tooltip: [`${P3} @ 3333333`, `base: ${P2} @ 2222222`, `git-spice: tracked on ${P2} · needs restack`, `#482 ${pullUrl(482)}`],
  context: layerContext(P3, { isCurrent: true, isTracked: true, hasPR: true, isDraft: true }),
};

/** The fourteen rows of pane B, top first — docs/view-lab.html lines 380–423 as the model draws them. */
const PANE_B_ROWS: ViewRow[] = [
  collectorRow(S_E, SHA_E, S_D, SHA_D),
  collectorRow(S_D, SHA_D, S_C, SHA_C),
  collectorRow(S_C, SHA_C, S_B, SHA_B),
  collectorRow(S_B, SHA_B, S_A, SHA_A),
  collectorRow(S_A, SHA_A, P1, SHA_1),
  {
    kind: 'layer',
    name: P4,
    sha: SHA_4,
    parent: P3,
    parentSha: SHA_3,
    forks: [SHA_OLD],
    lane: 1,
    node: 'hollow',
    indicators: [{ kind: 'untracked' }, { kind: 'neverPushed' }],
    age: '15m',
    dim: true,
    tooltip: [`${P4} @ 4444444`, `base: ${P3} @ 3333333`, 'git-spice: not tracked'],
    context: layerContext(P4, { isUntracked: true }),
  },
  {
    kind: 'workingTree',
    parent: P3,
    lane: 1,
    node: 'dashed',
    indicators: [{ kind: 'dirty', files: 2 }],
    age: 'now',
    tooltip: [`2 files changed on ${P3}`],
    context: { webviewSection: 'workingTree', repo: ROOT, layer: P3 },
  },
  PANE_B_PART3,
  {
    kind: 'layer',
    name: P2,
    sha: SHA_2,
    parent: P1,
    parentSha: SHA_1,
    forks: [SHA_OLD],
    lane: 1,
    node: 'hollow',
    joinsLane: 0,
    indicators: [
      { kind: 'unresolved', count: 2 },
      { kind: 'baseDrift', prBase: 'main', localParent: P1 },
      { kind: 'needsPush', ahead: 1 },
      { kind: 'pr', id: '#481', url: pullUrl(481), state: 'open', reviewDecision: 'changes-requested', title: null },
    ],
    age: '40m',
    dim: false,
    tooltip: [`${P2} @ 2222222`, `base: ${P1} @ 1111111`, `git-spice: tracked on ${P1} · needs push`, `#481 ${pullUrl(481)}`],
    context: layerContext(P2, { isTracked: true, hasPR: true }),
  },
  {
    kind: 'layer',
    name: P1,
    sha: SHA_1,
    parent: TRUNK,
    parentSha: SHA_T,
    forks: [SHA_OLD],
    lane: 0,
    node: 'hollow',
    indicators: [{ kind: 'pr', id: '#480', url: pullUrl(480), state: 'merged', reviewDecision: null, title: null }],
    age: '3d',
    dim: true,
    tooltip: [`${P1} @ 1111111`, 'base: origin/main @ 0000000', 'git-spice: tracked on main', `#480 ${pullUrl(480)}`],
    context: layerContext(P1, { isTracked: true, hasPR: true }),
  },
  {
    kind: 'layer',
    name: FIX,
    sha: SHA_F,
    parent: TRUNK,
    parentSha: SHA_T,
    forks: [SHA_T],
    lane: 1,
    node: 'hollow',
    joinsLane: 0,
    indicators: [{ kind: 'pr', id: '#479', url: pullUrl(479), state: 'open', reviewDecision: 'approved', title: null }],
    age: '1w',
    dim: false,
    tooltip: [`${FIX} @ fffffff`, 'base: origin/main @ 0000000', 'git-spice: tracked on main', `#479 ${pullUrl(479)}`],
    context: layerContext(FIX, { isTracked: true, hasPR: true }),
  },
  {
    kind: 'layer',
    name: CHORE,
    sha: SHA_6,
    parent: TRUNK,
    parentSha: SHA_T,
    forks: [SHA_OLD],
    lane: 1,
    node: 'hollow',
    joinsLane: 0,
    indicators: [{ kind: 'needsRestack' }, { kind: 'pr', id: '#478', url: pullUrl(478), state: 'open', reviewDecision: null, title: null }],
    age: '2mo',
    dim: false,
    tooltip: [`${CHORE} @ 6666666`, 'base: origin/main @ 0000000', 'git-spice: tracked on main · needs restack', `#478 ${pullUrl(478)}`],
    context: layerContext(CHORE, { isTracked: true, hasPR: true }),
  },
  { kind: 'elided', lane: 0 },
  {
    kind: 'trunk',
    name: TRUNK,
    sha: SHA_T,
    lane: 0,
    node: 'hollow',
    indicators: [{ kind: 'behindTrunk', origin: 5, local: 3 }],
    age: '26h',
    tooltip: ['origin/main @ 0000000', "HEAD's stack is 5 commits behind origin/main", 'the local trunk branch is 3 commits behind origin/main'],
    context: { webviewSection: 'trunk', repo: ROOT, trunk: TRUNK, isCurrent: false },
  },
];

// see primer §5 (arrow functions)
describe('buildStackViewModel', () => {
  describe('pane B — docs/view-lab.html as one model', () => {
    it("dresses the pane B rail row for row: lanes and nodes from the graph, every indicator from its source in the fixed order, ages from the committer dates, dim names, the tree's tooltip lines and the context keys", () => {
      // act
      const model = buildStackViewModel(paneB());

      // assert: the fourteen rows, whole
      expect(model).toStrictEqual({ repo: ROOT, lanes: 2, messages: [], rows: PANE_B_ROWS });
    });

    it('with no gh extras the same picture loses exactly the gh tier: the draft state, the failing checks, the base drift and the review decisions', () => {
      // act
      const model = buildStackViewModel(paneB({ extras: new Map() }));

      // assert: four things change, nothing else
      expect(indicatorsOf(model, P3)).toStrictEqual([{ kind: 'needsRestack' }, { kind: 'pr', id: '#482', url: pullUrl(482), state: 'open', reviewDecision: null, title: null }]);
      expect(rowOf(model, P3).context.isDraft).toBe(false);
      expect(indicatorsOf(model, P2)).toStrictEqual([
        { kind: 'unresolved', count: 2 },
        { kind: 'needsPush', ahead: 1 },
        { kind: 'pr', id: '#481', url: pullUrl(481), state: 'open', reviewDecision: null, title: null },
      ]);
      expect(indicatorsOf(model, FIX)).toStrictEqual([{ kind: 'pr', id: '#479', url: pullUrl(479), state: 'open', reviewDecision: null, title: null }]);
      const unchanged = model.rows.filter((row) => !(row.kind === 'layer' && [P2, P3, FIX].includes(row.name)));
      const expectedUnchanged = PANE_B_ROWS.filter((row) => !(row.kind === 'layer' && [P2, P3, FIX].includes(row.name)));
      expect(unchanged).toStrictEqual(expectedUnchanged);
    });
  });

  describe('each indicator from its source field', () => {
    describe('needsRestack — down.needsRestack', () => {
      it('is present when git-spice says the branch below moved', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, down: { name: 'add-retries', needsRestack: true } }] }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ kind: 'needsRestack' }]);
      });

      it('is absent when it did not', () => {
        expect(indicatorsOf(buildStackViewModel(input()), 'retry-metrics')).toStrictEqual([]);
      });
    });

    describe('unresolved — change.comments.unresolved', () => {
      it('counts the unresolved comments, before the PR circle', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: { ...CHANGE, comments: { resolved: 1, unresolved: 2, total: 3 } } }] }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ kind: 'unresolved', count: 2 }, PR_7]);
      });

      it('is absent when every comment is resolved', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: { ...CHANGE, comments: { resolved: 5, unresolved: 0, total: 5 } } }] }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([PR_7]);
      });

      it('is absent when --cr-status did not run (no comments at all)', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: CHANGE }] }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([PR_7]);
      });
    });

    describe("baseDrift — the PR's base against the base git-spice stacks on", () => {
      it("names the PR's base and git-spice's when they differ", () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: CHANGE }], extras: new Map([['retry-metrics', { ...PLAIN_EXTRAS, baseRef: 'api-refactor' }]]) }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ kind: 'baseDrift', prBase: 'api-refactor', localParent: 'add-retries' }, PR_7]);
      });

      it('is absent when they agree', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: CHANGE }], extras: new Map([['retry-metrics', PLAIN_EXTRAS]]) }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([PR_7]);
      });

      it('is absent for a bottom layer whose PR targets main while the rail says origin/main — both sides are local branch names, so the trunk ref is never compared', () => {
        const model = buildStackViewModel(
          input({
            entries: [TRUNK_LINE, { ...BOTTOM, change: { id: '#5', url: pullUrl(5), status: 'open' } }, MIDDLE, TOP],
            extras: new Map([['api-refactor', { ...PLAIN_EXTRAS, baseRef: 'main' }]]),
          }),
        );
        expect(indicatorsOf(model, 'api-refactor')).toStrictEqual([{ kind: 'pr', id: '#5', url: pullUrl(5), state: 'open', reviewDecision: null, title: null }]);
      });

      it("reads git-spice's base, not the rail's parent: a second name on the layer below (E6) changes the tooltip's base and not the drift", () => {
        // arrange: api-refactor-backup shares api-refactor's commit, so the rail chains add-retries through the backup
        const model = buildStackViewModel(
          input({
            refs: refs(['add-retries', SHA_B, DATE], ['api-refactor', SHA_A, DATE], ['api-refactor-backup', SHA_A, DATE], ['main', SHA_T, DATE]),
            dag: dag([SHA_B, SHA_A], [SHA_A, SHA_T]),
            head: 'add-retries',
            layers: [],
            entries: [TRUNK_LINE, BOTTOM, { ...MIDDLE, change: CHANGE }],
            extras: new Map([['add-retries', { ...PLAIN_EXTRAS, baseRef: 'api-refactor' }]]),
          }),
        );

        // assert
        expect(indicatorsOf(model, 'add-retries')).toStrictEqual([PR_7]);
        expect(rowOf(model, 'add-retries').tooltip).toStrictEqual(['add-retries @ bbbbbbb', 'base: api-refactor-backup @ aaaaaaa', 'git-spice: tracked on api-refactor', `#7 ${pullUrl(7)}`]);
      });
    });

    describe('needsPush — push.ahead', () => {
      it('carries the ahead count when the local branch is ahead of the remote one', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, push: { ahead: 1, behind: 0, needsPush: true } }] }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ kind: 'needsPush', ahead: 1 }]);
      });

      it('is absent for a submitted branch in sync', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, push: { ahead: 0, behind: 0, needsPush: false } }] }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([]);
      });

      it('is absent for a branch pushed with plain git — no push field, so whether it is ahead cannot be known without a rev-list (F2, M1, M2); the remote branch exists, so no cloud either', () => {
        expect(indicatorsOf(buildStackViewModel(input()), 'retry-metrics')).toStrictEqual([]);
      });

      it("is absent when only the remote is ahead: git-spice's needsPush means the tips differ (M4a), and a branch strictly behind draws nothing here (E76 is M9's)", () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, push: { ahead: 0, behind: 1, needsPush: true } }] }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([]);
        expect(rowOf(model, 'retry-metrics').tooltip[2]).toBe('git-spice: tracked on add-retries');
      });
    });

    describe('neverPushed — no remote-tracking branch of that name in the digest', () => {
      it('is present when no remote has the branch', () => {
        const model = buildStackViewModel(input({ remoteBranches: without(ALL_REMOTE, 'retry-metrics') }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ kind: 'neverPushed' }]);
      });

      it('is absent when one does', () => {
        expect(indicatorsOf(buildStackViewModel(input()), 'retry-metrics')).toStrictEqual([]);
      });

      it('reads the digest and never the push field: a push object beside a missing ref (a state 0.31.2 does not print — the ref goes and push with it, M5) still gives the cloud, after the arrow', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, push: { ahead: 2, behind: 0, needsPush: true } }], remoteBranches: without(ALL_REMOTE, 'retry-metrics') }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ kind: 'needsPush', ahead: 2 }, { kind: 'neverPushed' }]);
      });
    });

    describe("pr — change.id, change.url and change.status, gh's isDraft, reviewDecision and title", () => {
      it.each([
        { status: 'open', state: 'open' },
        { status: 'closed', state: 'closed' },
        { status: 'merged', state: 'merged' },
        { status: undefined, state: 'unknown' },
        { status: 'something-new', state: 'unknown' },
      ])('reads status $status as state $state — the id as git-spice spells it, the url as given, any text the local tier does not know as unknown', ({ status, state }) => {
        // arrange: `status` only when the row gives one
        const change: GsLogEntry['change'] = status === undefined ? { id: '#7', url: pullUrl(7) } : { id: '#7', url: pullUrl(7), status };
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change }] }));

        // assert
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ kind: 'pr', id: '#7', url: pullUrl(7), state, reviewDecision: null, title: null }]);
      });

      it('keeps a GitLab id as text', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: { id: '!12', url: 'https://gitlab.com/g/p/-/merge_requests/12', status: 'open' } }] }));
        const [pr] = indicatorsOf(model, 'retry-metrics');
        expect(pr.kind === 'pr' ? pr.id : null).toBe('!12');
      });

      it('is draft when gh says so and git-spice says open', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: CHANGE }], extras: new Map([['retry-metrics', { ...PLAIN_EXTRAS, isDraft: true }]]) }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ ...PR_7, state: 'draft' }]);
        expect(rowOf(model, 'retry-metrics').context.isDraft).toBe(true);
      });

      it('is draft when gh says so and the local tier has no status', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: { id: '#7', url: pullUrl(7) } }], extras: new Map([['retry-metrics', { ...PLAIN_EXTRAS, isDraft: true }]]) }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ ...PR_7, state: 'draft' }]);
      });

      it("stays merged whatever gh's isDraft says", () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: { ...CHANGE, status: 'merged' } }], extras: new Map([['retry-metrics', { ...PLAIN_EXTRAS, isDraft: true }]]) }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ ...PR_7, state: 'merged' }]);
      });

      it("carries gh's review decision in this codebase's spelling, and null when gh has none", () => {
        const decided = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: CHANGE }], extras: new Map([['retry-metrics', { ...PLAIN_EXTRAS, reviewDecision: 'changes-requested' }]]) }));
        const plain = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: CHANGE }], extras: new Map([['retry-metrics', PLAIN_EXTRAS]]) }));
        expect(indicatorsOf(decided, 'retry-metrics')).toStrictEqual([{ ...PR_7, reviewDecision: 'changes-requested' }]);
        expect(indicatorsOf(plain, 'retry-metrics')).toStrictEqual([PR_7]);
      });

      it("is absent without a change, and then gh's extras are ignored — no draft, no checks, no drift, no title", () => {
        const model = buildStackViewModel(input({ extras: new Map([['retry-metrics', { isDraft: true, reviewDecision: 'approved', checks: { failing: 1, total: 1 }, baseRef: 'main', title: 'Stale' }]]) }));
        const row = rowOf(model, 'retry-metrics');
        expect(row.indicators).toStrictEqual([]);
        expect(row.context).toStrictEqual(layerContext('retry-metrics', { isCurrent: true, isTracked: true }));
        expect(row.tooltip.length).toBe(3);
      });
    });

    describe("checks — gh's statusCheckRollup, failing of total", () => {
      it('is present after the PR circle when a check fails', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: CHANGE }], extras: new Map([['retry-metrics', { ...PLAIN_EXTRAS, checks: { failing: 2, total: 7 } }]]) }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([PR_7, { kind: 'checks', failing: 2, total: 7 }]);
      });

      it('is absent when every check passes', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: CHANGE }], extras: new Map([['retry-metrics', { ...PLAIN_EXTRAS, checks: { failing: 0, total: 7 } }]]) }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([PR_7]);
      });

      it('is absent when gh has no checks for the PR', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: CHANGE }], extras: new Map([['retry-metrics', PLAIN_EXTRAS]]) }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([PR_7]);
      });
    });

    describe('untracked — absent from a complete gs log --all answer', () => {
      it('is the one indicator of a branch git-spice does not track, and the row is dim', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE] }));
        const row = rowOf(model, 'retry-metrics');
        expect(row.indicators).toStrictEqual([{ kind: 'untracked' }]);
        expect(row.dim).toBe(true);
        expect(row.context.isTracked).toBe(false);
        expect(row.context.isUntracked).toBe(true);
      });

      it('comes before the cloud when the branch was never pushed either', () => {
        const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE], remoteBranches: without(ALL_REMOTE, 'retry-metrics') }));
        expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ kind: 'untracked' }, { kind: 'neverPushed' }]);
      });
    });
  });

  describe('the fixed order', () => {
    it("puts every indicator a tracked layer can carry in §7.1.1's tail order whatever order the sources came in: needs restack, unresolved, base drift, needs push, never pushed, the PR, the checks", () => {
      // arrange: one line with everything on it
      const everything: GsLogEntry = {
        name: 'retry-metrics',
        down: { name: 'add-retries', needsRestack: true },
        change: { id: '#7', url: pullUrl(7), status: 'open', comments: { resolved: 0, unresolved: 3, total: 3 } },
        push: { ahead: 2, behind: 0, needsPush: true },
      };
      const model = buildStackViewModel(
        input({
          entries: [TRUNK_LINE, BOTTOM, MIDDLE, everything],
          remoteBranches: without(ALL_REMOTE, 'retry-metrics'),
          extras: new Map([['retry-metrics', { isDraft: false, reviewDecision: 'approved', checks: { failing: 1, total: 4 }, baseRef: 'main', title: 'Retry metrics' }]]),
        }),
      );

      // assert
      expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([
        { kind: 'needsRestack' },
        { kind: 'unresolved', count: 3 },
        { kind: 'baseDrift', prBase: 'main', localParent: 'add-retries' },
        { kind: 'needsPush', ahead: 2 },
        { kind: 'neverPushed' },
        { kind: 'pr', id: '#7', url: pullUrl(7), state: 'open', reviewDecision: 'approved', title: 'Retry metrics' },
        { kind: 'checks', failing: 1, total: 4 },
      ]);
    });

    it('an untracked layer can carry only the cloud beside its own mark, in that order', () => {
      const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE], remoteBranches: without(ALL_REMOTE, 'retry-metrics') }));
      expect(indicatorsOf(model, 'retry-metrics')).toStrictEqual([{ kind: 'untracked' }, { kind: 'neverPushed' }]);
    });
  });

  describe('Show Only This Stack on a stack', () => {
    it("keeps HEAD's stack in git-spice's sense — the layers below and above part3 — in one lane, every indicator as before, and part2 loses its curve", () => {
      // act
      const model = buildStackViewModel(paneB({ showOnlyThisStack: true }));

      // assert
      expect(model.rows.map(geometry)).toEqual([
        { kind: 'layer', name: P4, lane: 0, node: 'hollow' },
        { kind: 'workingTree', lane: 0, node: 'dashed' },
        { kind: 'layer', name: P3, lane: 0, node: 'filled' },
        { kind: 'layer', name: P2, lane: 0, node: 'hollow' },
        { kind: 'layer', name: P1, lane: 0, node: 'hollow' },
        { kind: 'elided', lane: 0 },
        { kind: 'trunk', name: TRUNK, lane: 0, node: 'hollow' },
      ]);
      expect(model.lanes).toBe(1);
      expect(rowOf(model, P3)).toStrictEqual({ ...PANE_B_PART3, lane: 0 });
      expect('joinsLane' in rowOf(model, P2)).toBe(false);
      expect(model.messages).toStrictEqual([]);
    });
  });

  describe('unknown, untracked, tracked — the states a tracked answer tells apart', () => {
    it('unlisted by an incomplete answer: unknown — no "not tracked", no cloud, not dim, two tooltip lines; nothing is drawn on a row no complete answer classified, as nothing is for a repository without git-spice', () => {
      // arrange: a malformed fourth line, so the answer is incomplete and retry-metrics is unlisted
      const incomplete: Enrichment = { ...enriched([TRUNK_LINE, BOTTOM, MIDDLE], without(ALL_REMOTE, 'retry-metrics'), false), malformed: [{ line: 4, problem: 'push.ahead is not a number' }] };
      const model = buildStackViewModel(input({ enrichment: incomplete }));

      // assert
      const row = rowOf(model, 'retry-metrics');
      expect(row.indicators).toStrictEqual([]);
      expect(row.dim).toBe(false);
      expect(row.tooltip.length).toBe(2);
      expect(row.context).toStrictEqual(layerContext('retry-metrics', { isCurrent: true }));
    });

    it('untracked: absent from a complete answer', () => {
      const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE] }));
      const row = rowOf(model, 'retry-metrics');
      expect(row.indicators).toStrictEqual([{ kind: 'untracked' }]);
      expect(row.dim).toBe(true);
      expect(row.tooltip[2]).toBe('git-spice: not tracked');
      expect(row.context).toStrictEqual(layerContext('retry-metrics', { isCurrent: true, isUntracked: true }));
    });

    it("tracked and clean: no indicator, not dim, the third tooltip line names git-spice's base, isTracked true", () => {
      expect(rowOf(buildStackViewModel(input()), 'retry-metrics')).toStrictEqual({
        kind: 'layer',
        name: 'retry-metrics',
        sha: SHA_C,
        parent: 'add-retries',
        parentSha: SHA_B,
        forks: [SHA_T],
        lane: 0,
        node: 'filled',
        indicators: [],
        age: '3m',
        dim: false,
        tooltip: ['retry-metrics @ ccccccc', 'base: add-retries @ bbbbbbb', 'git-spice: tracked on add-retries'],
        context: layerContext('retry-metrics', { isCurrent: true, isTracked: true }),
      });
    });

    it("git-spice's own trunk line (a local main ahead of origin/main, F3/M7): a tracked row with nothing to say — \"git-spice: trunk\", no indicator, not dim, isTrunkLine", () => {
      // arrange: 23a's L16 — main one commit ahead of the ref the stack is measured against
      const model = buildStackViewModel(
        input({
          refs: refs(['add-retries', SHA_B, DATE], ['api-refactor', SHA_A, DATE], ['main', SHA_1, DATE], ['retry-metrics', SHA_C, DATE]),
          dag: dag([SHA_1, SHA_T]) + APPENDIX_A_DAG,
          head: 'main',
          layers: [layer('main', SHA_1, TRUNK, SHA_T, 1, TRUNK_LINE, true)],
        }),
      );

      // assert
      expect(rowOf(model, 'main')).toStrictEqual({
        kind: 'layer',
        name: 'main',
        sha: SHA_1,
        parent: TRUNK,
        parentSha: SHA_T,
        forks: [SHA_T],
        lane: 1,
        node: 'filled',
        joinsLane: 0,
        indicators: [],
        age: '3m',
        dim: false,
        tooltip: ['main @ 1111111', 'base: origin/main @ 0000000', 'git-spice: trunk'],
        context: layerContext('main', { isCurrent: true, isTracked: true, isTrunkLine: true }),
      });
    });

    it('byName is the one source: a state whose layers carry no tracking key (fresh from computeStack) gives the same model as one whose layers do', () => {
      // arrange
      const bare = paneB({ layers: [layer(P1, SHA_1, TRUNK, SHA_T, 1), layer(P2, SHA_2, P1, SHA_1, 2), layer(P3, SHA_3, P2, SHA_2, 3, undefined, true)] });

      // act and assert
      expect(buildStackViewModel(bare)).toStrictEqual(buildStackViewModel(paneB()));
    });

    it('a stack HEAD is not on gets its indicators through byName — no StackLayer exists for it', () => {
      // arrange: 23a's L2 — other-work beside the Appendix A stack
      const model = buildStackViewModel(
        input({
          refs: refs(['add-retries', SHA_B, DATE], ['api-refactor', SHA_A, DATE], ['main', SHA_T, DATE], ['other-work', SHA_D, DATE], ['retry-metrics', SHA_C, DATE]),
          dag: dag([SHA_D, SHA_T]) + APPENDIX_A_DAG,
          entries: [...APPENDIX_A_ENTRIES, { name: 'other-work', down: { name: 'main', needsRestack: true }, change: { id: '#9', url: pullUrl(9), status: 'open' } }],
          remoteBranches: new Set([...ALL_REMOTE, 'other-work']),
        }),
      );

      // assert
      expect(indicatorsOf(model, 'other-work')).toStrictEqual([{ kind: 'needsRestack' }, { kind: 'pr', id: '#9', url: pullUrl(9), state: 'open', reviewDecision: null, title: null }]);
      expect(rowOf(model, 'other-work').context).toStrictEqual(layerContext('other-work', { isTracked: true, hasPR: true }));
    });
  });

  describe('dim names and the tooltip', () => {
    it('dims a merged layer and an untracked one, and no other', () => {
      // arrange: the bottom merged, the middle open, the top unlisted
      const model = buildStackViewModel(
        input({ entries: [TRUNK_LINE, { ...BOTTOM, change: { id: '#1', url: pullUrl(1), status: 'merged' } }, { ...MIDDLE, change: { id: '#2', url: pullUrl(2), status: 'open' } }] }),
      );

      // assert: top first
      const dims = model.rows.filter((row) => row.kind === 'layer').map((row) => (row.kind === 'layer' ? row.dim : null));
      expect(dims).toEqual([true, false, true]);
    });

    it("gives a layer with a PR the tree's four tooltip lines word for word: the commit, the base with the parent row's commit, git-spice's line with the to-dos, the id and the link", () => {
      const model = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, down: { name: 'add-retries', needsRestack: true }, change: CHANGE, push: { ahead: 1, behind: 0, needsPush: true } }] }));
      expect(rowOf(model, 'retry-metrics').tooltip).toStrictEqual([
        'retry-metrics @ ccccccc',
        'base: add-retries @ bbbbbbb',
        'git-spice: tracked on add-retries · needs restack · needs push',
        '#7 https://github.com/org/repo/pull/7',
      ]);
    });

    it("adds the pull request's title as a fifth line when gh knows it (§7.1.1), and nothing when it does not", () => {
      const titled = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: CHANGE }], extras: new Map([['retry-metrics', { ...PLAIN_EXTRAS, title: 'Add retry metrics' }]]) }));
      const plain = buildStackViewModel(input({ entries: [TRUNK_LINE, BOTTOM, MIDDLE, { ...TOP, change: CHANGE }], extras: new Map([['retry-metrics', PLAIN_EXTRAS]]) }));
      expect(rowOf(titled, 'retry-metrics').tooltip).toStrictEqual(['retry-metrics @ ccccccc', 'base: add-retries @ bbbbbbb', 'git-spice: tracked on add-retries', `#7 ${pullUrl(7)}`, 'Add retry metrics']);
      expect(rowOf(titled, 'retry-metrics').indicators[0]).toStrictEqual({ ...PR_7, title: 'Add retry metrics' });
      expect(rowOf(plain, 'retry-metrics').tooltip.length).toBe(4);
      expect(rowOf(plain, 'retry-metrics').indicators[0]).toStrictEqual(PR_7);
    });
  });

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
