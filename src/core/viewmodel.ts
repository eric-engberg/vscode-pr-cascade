/**
 * core/viewmodel.ts — one picture of a repository for the two M6 views: the rows of core/graph.ts's
 * rail dressed with what git-spice and the forge know about each branch (plan §7.8's two tiers), an
 * age for every row, the message rows the tree showed as nodes, and the keys a row's context menu
 * reads. The views render this and compute nothing (§7.1.3 "One model"): the glyphs are a list in
 * their fixed order, the dim names and the tooltip lines are decided here, and so is §7.2.1's
 * "Show Only This Stack", which has to reach layoutGraph before lanes are assigned.
 *
 * Layer: core, pure (no VS Code imports, no git; plan §4.1). Depends on: core/graph.ts
 * (`layoutGraph` and its types), core/gsLog.ts (`GsLogEntry`, a type), core/model.ts (`RepoState`,
 * `Enrichment`, `PrExtras`, `ReviewDecision`). Depended on by: src/webview/protocol.ts (types only —
 * the message that carries a model), src/extension.ts from item 23d (which reads the graph texts,
 * the change lists, the clock and the settings and calls buildStackViewModel once per repository
 * and refresh), the renderers of items 23e and 23i (types only), test/unit/viewmodel.test.ts,
 * test/git/gitspice.git.test.ts (the two view-model rows over real git-spice). Nothing in src/
 * imports this file at run time until 23d — protocol.ts's `import type` is erased when compiled
 * (primer §9), so the bundle carries nothing of it. The rows a host shows when no RepoState exists — no
 * repository in the workspace, the Git extension unusable (E82), git itself failing for one
 * repository (E17) — are the host's (src/webview/protocol.ts `HostNotice`), not this file's. The
 * tree's `trackingLines`, `shortSha`, `commitCountLabel` and four message texts have a second copy
 * here until item 23j deletes the tree.
 * Plan: §4.2, §7.1.1 (the tail), §7.1.2, §7.1.3, §7.2.1, §7.8, §8 E3/E4/E5/E12/E15/E56/E57/E79/
 * E80/E81, §9.4 `unit/viewmodel`, §10.1 item 23b (M6), §13.2 D68.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { layoutGraph } from './graph';
import type { GraphInput, GraphRow, LayerRow, TrunkRow, WorkingTreeRow } from './graph';
import type { GsLogChange, GsLogDown, GsLogEntry } from './gsLog';
import type { Enrichment, PrExtras, RepoState, ReviewDecision } from './model';

/**
 * Everything one repository's picture is made from. Plain values and texts: item 23d reads them
 * — the pipeline's RepoState, core/graph.ts's three texts, the built-in Git extension's change
 * lists, the clock, the toggle and two counts — and hands them in; this file spawns nothing and
 * never changes its input.
 */
// see primer §9 (interface), §14 (readonly; `ReadonlyMap`) and §10 (union types: `GraphInput | null`)
export interface ViewModelInput {
  /** The pipeline's answer: trunk, HEAD, the paused rebase, HEAD's layers and `enrichment` (item 20a, grown in 23b). */
  readonly state: RepoState;
  /**
   * core/graph.ts's three texts (`readGraphInput`), or `null` exactly when `state.trunk` is `null`:
   * nothing can be read without a trunk (E4 — two of the three argv need it), and the model then
   * draws no row. With a trunk the texts must be there — `null` beside a trunk is the caller's
   * mistake and is thrown, not drawn.
   */
  readonly graph: GraphInput | null;
  /**
   * How many distinct paths the working tree changes, from the Git extension's three change lists
   * (`mergeChanges`, `indexChanges`, `workingTreeChanges` — plan §7.14; see GraphOptions.dirty): a
   * file both staged and modified is in two of the lists and counts once. 0 is a clean tree: no
   * working-tree row.
   */
  readonly workingTreeFiles: number;
  /** The clock, in unix seconds like every `committedAt`: the ages are measured from it, so a test fixes it. */
  readonly now: number;
  /**
   * §7.2.1's toggle. When set and HEAD is on a stack (`state.layers` non-empty), only HEAD's stack
   * is laid out — in git-spice's sense (GraphOptions.onlyStackOf). On trunk, or with HEAD detached
   * (every rebase pause point but `git am` detaches it; a paused `am` on a layer keeps HEAD's stack
   * and so keeps the filter), there is no stack of HEAD's to show alone, and every stack is drawn as
   * if the toggle were off: an empty rail under a lit toggle would read as a fault. Ric's question 3
   * on #43 may make "this" the focused row instead; the field then becomes a branch name and this is
   * the one line that moves.
   */
  readonly showOnlyThisStack: boolean;
  /** The trunk row's two counts, 23d's one extra spawn; `null` until 23d exists, or when nothing was measured. */
  readonly behindTrunk: BehindTrunk | null;
  /**
   * Plan §7.8's gh tier by branch name — M7's core/prstatus.ts fills it from `gh pr list --json`;
   * empty until then, and always empty on a forge gh does not serve. Consulted only for a branch
   * whose line carries a `change`: gh keys by head branch and lists pull requests, so an entry for
   * a branch git-spice knows no pull request for is stale or belongs to one opened outside the
   * stack, and draws nothing. What it adds lights up `draft`, `reviewDecision`, `title`, `checks`
   * and `baseDrift` the moment it is filled (§10 M6).
   */
  readonly extras: ReadonlyMap<string, PrExtras>;
}

/**
 * How far behind the trunk ref two things are, as 23d measures them with one `rev-list --count`
 * each: `origin` is the commits on `trunk` that HEAD's history lacks (`rev-list --count <trunk>
 * ^HEAD` — trunk has moved on since HEAD's stack forked; the mockup's `↓5`), `local` the commits the
 * local trunk branch lacks (`rev-list --count <trunk> ^<branch>` — a `git pull` is due; `local ↓3`).
 * Either may be 0; 23d passes 0 for `local` when there is no local trunk branch.
 */
export interface BehindTrunk {
  readonly origin: number;
  readonly local: number;
}

/**
 * A change request's state as the rail colours its circle (§7.1.1: green open, grey draft, purple
 * merged, red closed). `open`, `closed` and `merged` are `change.status` when `--cr-status` was
 * asked (M7's network tier; the parser keeps the text, this file narrows it — primer §45); `draft`
 * is gh's `isDraft` over an open or unknown status (a draft is an open pull request GitHub flags);
 * `unknown` is every refresh until M7: the local tier knows the id and the url and not the state,
 * and a status a later git-spice adds is unknown too rather than a malformed line (E57).
 */
// see primer §10 (union types: exact strings as members)
export type PrState = 'open' | 'draft' | 'merged' | 'closed' | 'unknown';

/**
 * One glyph of a row's tail (plan §7.1.1), told apart by `kind`, each carrying the number or the
 * names its glyph prints — nothing a renderer has to look up. A row's `indicators` holds every one
 * that is true for it, in the one fixed order below (`untracked` first, then §7.1.1's bullet:
 * ⇈ · 💬 · ⇄ · ↑n · ⛅ · the PR circle · ✕), so a renderer maps the list and never sorts. The order
 * is for drawing only: E80's condensed tail is the `pr` indicator, when the row has one, and the
 * age — a renderer finds it by `kind === 'pr'`, never by position.
 */
// see primer §59 (tagged unions)
export type Indicator =
  /** Not tracked by git-spice (E56): `null` tracking. Dim name and "not tracked"; only ⛅ can stand beside it. */
  | { readonly kind: 'untracked' }
  /** ⇈ — the layer below moved and this branch has not been rebased onto it (`down.needsRestack`). */
  | { readonly kind: 'needsRestack' }
  /** 💬n — review comments not yet resolved (`change.comments.unresolved`, M7's `--cr-status`); absent at 0. */
  | { readonly kind: 'unresolved'; readonly count: number }
  /**
   * ⇄ — the forge's pull request targets `prBase` while git-spice stacks this branch on
   * `localParent` (`down.name`): GitHub retargeted it when the layer below merged (E71), or it was
   * created on the wrong base (E28); the next `gs branch submit` would move the base to
   * `localParent`. From gh's `baseRefName` (M7) against git-spice's base, both local branch names,
   * so a root's `main` is never compared with the trunk ref's `origin/main`. Not against the rail's
   * `parent`: the two differ for two names on one commit (E6 — the rail chains through the later
   * name, git-spice through the tracked one) and after a plain-git rebase git-spice was not told
   * about, where ⇈ already speaks.
   */
  | { readonly kind: 'baseDrift'; readonly prBase: string; readonly localParent: string }
  /**
   * ↑n and a blue cloud — commits the remote branch lacks: `push.ahead` when it is above 0.
   * git-spice knows this for the branches it submitted (F9, F12) and for no other: a branch pushed
   * with plain `git push -u` has no `push` even once tracked (M1, M2), and whether it is ahead would
   * cost one `rev-list` per branch — it draws nothing here. Not `push.needsPush`: that flag is "the
   * two tips differ", so a branch strictly behind its remote prints `needsPush: true` with `ahead: 0`
   * (M4a, 0.31.2) — E76's state, M9's banner, no glyph in this tail.
   */
  | { readonly kind: 'needsPush'; readonly ahead: number }
  /**
   * ⛅ — no remote-tracking branch of this name on any remote: never pushed (or pruned since). A
   * git fact read off the digest (`Enrichment.remoteBranches`), never off `push`, which git-spice
   * prints only for branches it submitted itself — a branch pushed with `git push -u` has the ref
   * and no `push` (F2, F8), a never-pushed one has neither (F1). `push` present implies the ref
   * exists (M5, M6), so ⛅ and ↑n never share a line in practice. A branch deleted on the remote and
   * not yet pruned keeps its stale ref: no cloud, and git-spice still prints `push {0, 0}` against
   * it — `fetch --prune` fixes both at once.
   */
  | { readonly kind: 'neverPushed' }
  /**
   * The PR circle: the change request git-spice knows (`change`), its id as the forge spells it
   * (`#482`, `!12` — text, never a number), its url, its state, and gh's review decision and title
   * when M7 brings them (`null` until then, and on forges gh does not serve). The one indicator
   * E80's condensed tail keeps.
   */
  | { readonly kind: 'pr'; readonly id: string; readonly url: string; readonly state: PrState; readonly reviewDecision: ReviewDecision | null; readonly title: string | null }
  /** ✕ f/n — failing status checks on the pull request's head (gh's `statusCheckRollup`, M7; GitHub only); absent when none fails. */
  | { readonly kind: 'checks'; readonly failing: number; readonly total: number }
  /** The trunk row's `↓n · local ↓m` (BehindTrunk); a renderer prints each count that is above 0. Absent when both are 0. */
  | { readonly kind: 'behindTrunk'; readonly origin: number; readonly local: number }
  /** The working-tree row's `n files`. */
  | { readonly kind: 'dirty'; readonly files: number };

/**
 * One stack layer as the views draw it. Three groups of fields: what the rail draws (`lane`, `node`,
 * `joinsLane`, copied from core/graph.ts unchanged); the facts the host reads back by name when a
 * view asks for something — the two commits a diff is taken between (item 23g), the trunk commits
 * a root forked from (item 23i's `git log <trunk> --not <forks…>` range), so no host spawns a
 * `rev-parse` for a row it already has; and the tail the view prints as it is.
 */
// see primer §11 (optional `?` fields) and §14 (readonly arrays)
export interface LayerViewRow {
  readonly kind: 'layer';
  /** The branch name, as `git branch` lists it: the label (plan §7.1: never a SHA), the key into `extras`, the argument of every command the row fires (E79). */
  readonly name: string;
  /** The commit it points at, 40 hex characters. */
  readonly sha: string;
  /** The layer this one sits on — a layer's name, or the trunk ref for a root (LayerRow.parent). */
  readonly parent: string;
  /** The commit `parent` points at: the parent row's `sha`, or the trunk row's for a root — the other side of the layer's diff. */
  readonly parentSha: string;
  /** LayerRow.forks: the trunk commits this branch's history stops at, for item 23i; a renderer never draws it. */
  readonly forks: readonly string[];
  readonly lane: number;
  /** `filled` when HEAD is on this branch, else `hollow` (LayerRow.node). */
  readonly node: 'hollow' | 'filled';
  /** As LayerRow.joinsLane: present on the lowest row of a stack drawn beside its parent's line, always `lane − 1`; absent, never `undefined`. */
  readonly joinsLane?: number;
  /** The tail, in its fixed order (Indicator); `[]` for a clean tracked layer and for every layer while nothing is known (E57) — the cloud included. */
  readonly indicators: readonly Indicator[];
  /** `committedAt` worded against `now` (formatAge): `3m`, `26h`, `2d`, `1w`, `2mo`, `1y`. */
  readonly age: string;
  /** A dim name: untracked by git-spice, or its pull request merged while the branch is still here (E15; §7.1.1). */
  readonly dim: boolean;
  /**
   * The tooltip's lines, the tree's as built (vscode/tree.ts, items 6 and 20b): `<branch> @ <short
   * sha>`, `base: <parent> @ <short sha>`, then git-spice's line when something is known, the
   * change request's `<id> <url>` when there is one, and its title when gh knows it (M7). A
   * renderer joins them with newlines and, under E80, adds the words of the glyphs it dropped.
   */
  readonly tooltip: readonly string[];
  /** What the row sets in `data-vscode-context` (§7.1.1, §7.2.1): the keys the `webview/context` menus' `when` clauses read, and the arguments the menu command receives. */
  readonly context: LayerContext;
}

/** The last row: the trunk ref, as detectTrunk named it (`origin/main` — the ref the stacks are measured against, which the tree's tooltip also spells; the local branch's distance from it is the `local ↓m` of the tail). */
export interface TrunkViewRow {
  readonly kind: 'trunk';
  readonly name: string;
  readonly sha: string;
  /** The literal 0: trunk's line is lane 0 by definition (primer §10 — a literal type may be a number). */
  readonly lane: 0;
  /** `filled` when HEAD is on a branch trunk already contains (TrunkRow.node), else `hollow`. */
  readonly node: 'hollow' | 'filled';
  /** `[]`, or the one `behindTrunk` when either count is above 0. */
  readonly indicators: readonly Indicator[];
  /** Trunk's tip's `committedAt` worded against `now`. */
  readonly age: string;
  /** `<trunk> @ <short sha>`, then one line per count above 0. */
  readonly tooltip: readonly string[];
  readonly context: TrunkContext;
}

/** The uncommitted working tree (WorkingTreeRow): the "Uncommitted changes" row, one above the checked-out row, on its lane. The label is the renderer's; the facts are here. */
export interface WorkingTreeViewRow {
  readonly kind: 'workingTree';
  /** The branch the changes sit on (WorkingTreeRow.parent): the filled layer, or the local branch when the trunk row is filled. */
  readonly parent: string;
  readonly lane: number;
  readonly node: 'dashed';
  /** The one `dirty { files }`. */
  readonly indicators: readonly Indicator[];
  /** Always `now`: the row is the present. */
  readonly age: 'now';
  /** `<n> files changed on <parent>`. */
  readonly tooltip: readonly string[];
  readonly context: WorkingTreeContext;
}

/** Elided trunk history (ElidedRow): a dashed segment, no node, no name, no age, no menu. */
export interface ElidedViewRow {
  readonly kind: 'elided';
  readonly lane: 0;
}

/** A row of either view, told apart by `kind` — the four kinds of core/graph.ts's rail, dressed. Item 23i adds its trunk-commit rows as a fifth. */
// see primer §59 (tagged unions)
export type ViewRow = LayerViewRow | TrunkViewRow | WorkingTreeViewRow | ElidedViewRow;

/**
 * A layer row's `data-vscode-context` (§7.1.1): VS Code shows the `webview/context` menu items
 * whose `when` clause matches these keys and hands the whole object to the command that is
 * picked, so the keys are also the command's arguments — `repo` and `layer` name what to act on
 * (E77 refuses a drop across repositories by `repo`). Pure data, decided here so both views set
 * the same keys. Four facts about git-spice, not one: `isTracked` (an entry — git-spice's trunk
 * line too), `isUntracked` (`null`, E56 — what Track Stack may adopt), neither when nothing is
 * known (E57, where a plain `!isTracked` would offer to track a branch git-spice already tracks),
 * and `isTrunkLine` (the entry has no `down`: a local `main` ahead of its remote, F3/M7 — tracked,
 * yet `gs branch submit` refuses it, so Create / Submit hide on it).
 */
export interface LayerContext {
  readonly webviewSection: 'layer';
  /** `StackViewModel.repo`: the repository root. */
  readonly repo: string;
  /** The branch name. */
  readonly layer: string;
  /** HEAD is on it: "Check Out" hides (§7.2.1's `Current` suffix). */
  readonly isCurrent: boolean;
  readonly isTracked: boolean;
  readonly isUntracked: boolean;
  readonly isTrunkLine: boolean;
  /** git-spice knows a change request for it (§7.2.1's `stackBranchWithPR`). */
  readonly hasPR: boolean;
  /** The PR circle's state is `draft` (gh's `isDraft` over an open or unknown status, M7; `stackBranchWithDraftPR`): never true without `hasPR`, never for a merged or closed pull request. */
  readonly isDraft: boolean;
}

/** The trunk row's context: a drop target (E77); `isCurrent` when the row is filled. A trunk menu, if one comes (23f), adds what it needs — the local branch to check out is not named here. */
export interface TrunkContext {
  readonly webviewSection: 'trunk';
  readonly repo: string;
  /** The trunk ref, as the row names it. */
  readonly trunk: string;
  readonly isCurrent: boolean;
}

/** The working-tree row's context: no menu of its own yet; `layer` is the branch the changes sit on. */
export interface WorkingTreeContext {
  readonly webviewSection: 'workingTree';
  readonly repo: string;
  readonly layer: string;
}

/** Which sentence a message row is: the four states the tree drew as nodes (E4, E12, E3, E5), for the icon a renderer picks and the banner actions M9 adds to the rebase row. */
export type MessageKind = 'noTrunk' | 'rebaseInProgress' | 'detachedHead' | 'notOnStack';

/**
 * A row that is a sentence rather than a branch (§7.1.1 "Message rows"), drawn above the rail.
 * `text` word for word as vscode/tree.ts printed it, so item 23j's migrated assertions find the
 * same words; `severity` as D51 — `warning` when the user has something to do (no trunk: a setting
 * to set; a paused rebase: resolve it), `information` when nothing is wrong (detached, not on a stack).
 */
export interface MessageRow {
  readonly kind: MessageKind;
  readonly text: string;
  readonly severity: 'warning' | 'information';
}

/**
 * One repository's picture, posted to both views as it is (E81): the rows in drawing order, top
 * first and the trunk row last; the rail's width in lanes; the message rows above them. Plain
 * values only — strings, numbers, booleans, arrays, `null` — so it crosses `postMessage` unchanged
 * (a Map or a Set would not: `ViewModelInput` and `Enrichment` are host-side values and are never
 * posted). One per repository; how several are shown is pending item 5's, which is why the
 * protocol carries an array (src/webview/protocol.ts). A label for a repository section (the
 * root's last path segment) is one additive field when item 5 is decided; nothing reads it yet.
 */
export interface StackViewModel {
  /** `RepoState.root`: the repository root, the key the host and the views agree on. */
  readonly repo: string;
  readonly rows: readonly ViewRow[];
  /** GraphLayout.lanes — highest lane + 1; 0 when no trunk was found and there are no rows. */
  readonly lanes: number;
  /** `[]`, or the sentences in the order the tree drew them (steps 2 and 8 below); never both E12 and E3. */
  readonly messages: readonly MessageRow[];
}

// The four message texts, word for word as vscode/tree.ts prints them (items 6 and 13b, D51),
// exported so the tests import nothing from src/vscode and item 23j's migrated assertions have one
// source once the tree is gone.
// see primer §4 (const) and §36 (`export const`)
export const NO_TRUNK_TEXT = 'No trunk found — set prCascade.trunk';
export const REBASE_IN_PROGRESS_TEXT = 'Rebase in progress — resolve it first';
export const DETACHED_HEAD_TEXT = 'Detached HEAD';
export const NOT_ON_STACK_TEXT = 'Not on a stack';

// The units formatAge counts in, as seconds: a mean month of 30.4375 days (365.25 / 12) and a
// year of 365 days — so twelve mean months (365.25 days) are already a year, and `12mo` never prints.
// see primer §27 (`_` in a number literal)
const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;
const WEEK = 604_800;
const MONTH = 2_629_800;
const YEAR = 31_536_000;

/**
 * The three things a branch's git-spice line can be once looked up by name: an entry (tracked —
 * git-spice's own trunk line included), `null` (untracked: absent from a complete answer, E56),
 * or `undefined` (unknown: nothing was asked, nothing came back, or the answer was incomplete —
 * E57). The same three values `StackLayer.tracking` takes, resolved here for any branch.
 */
// see primer §10 (union types: `| null | undefined`)
type Tracking = GsLogEntry | null | undefined;

/**
 * What every row of one model is built from, besides its graph row: the input's plain facts and
 * the two lookups prepared once — a layer's `sha` by name (for `parentSha`) and the enrichment.
 * One object, handed to viewRowFor, so the row builders take two arguments and not nine.
 */
interface RowFacts {
  readonly repo: string;
  readonly trunk: string;
  readonly now: number;
  readonly workingTreeFiles: number;
  readonly behindTrunk: BehindTrunk | null;
  readonly enrichment: Enrichment | undefined;
  /** The digest's remote-tracking names when enriched, else empty — never consulted then, since every row is unknown. */
  readonly remoteBranches: ReadonlySet<string>;
  readonly extras: ReadonlyMap<string, PrExtras>;
  readonly shaByName: ReadonlyMap<string, string>;
}

/**
 * The picture, from the facts, in numbered steps (the comments below carry the numbers D68 uses).
 * Pure: the same input always gives the same model, nothing is spawned, the input is never
 * changed. Throws only for a caller's mistake — graph texts missing beside a trunk, or texts
 * `layoutGraph` itself refuses (a bad trunk-tip line); every state a repository can be in is a model.
 */
// see primer §19 (Map), §22 (for ... of), §25 (arrays: push, some, a typed empty array), §54 (destructuring:
// one field out of the input), §5 (arrow functions) and §16 (object literals: shorthand keys)
export function buildStackViewModel(input: ViewModelInput): StackViewModel {
  const { state } = input;

  // 1. No trunk (E4): the one warning and no rows — nothing can be laid out without a base, and
  // the tree draws this message alone for the same reason. `graph` is not looked at; `lanes` is 0
  // because there is no rail, not layoutGraph's 1.
  if (state.trunk === null) {
    return { repo: state.root, rows: [], lanes: 0, messages: [{ kind: 'noTrunk', text: NO_TRUNK_TEXT, severity: 'warning' }] };
  }

  // 2. The messages above the rail, as tree.ts's nodesForRepo decides them (D51): a paused rebase
  // is the warning that says what to do, and it replaces the detached-HEAD row — every pause point
  // but `git am` detaches HEAD, so both rows would say the same thing twice. "Not on a stack" waits
  // for step 8, which needs the layout.
  const messages: MessageRow[] = [];
  if (state.rebaseInProgress) {
    messages.push({ kind: 'rebaseInProgress', text: REBASE_IN_PROGRESS_TEXT, severity: 'warning' });
  } else if (state.head === null) {
    messages.push({ kind: 'detachedHead', text: DETACHED_HEAD_TEXT, severity: 'information' });
  }

  // 3. The graph texts: missing beside a trunk is a caller's mistake, not a state to draw.
  if (input.graph === null) {
    // see primer §18 (throw) and §12 (template strings)
    throw new Error(`buildStackViewModel: no graph texts for ${state.root}, whose trunk is ${state.trunk}`);
  }

  // 4. The §7.2.1 filter: HEAD's stack, when the toggle is on and HEAD is on one — `state.layers`
  // non-empty is computeStack's own "HEAD is on a stack" (E5's test), and HEAD's branch is then a
  // member of the graph too, both reading the same fact (a commit of the branch trunk lacks). On
  // trunk, with HEAD detached (every rebase pause point but `git am`), or on a branch with no
  // commits of its own there is no stack of HEAD's to show alone, so every stack is drawn as if the
  // toggle were off: an empty rail under a lit toggle would read as a fault. A `git am` paused on a
  // layer keeps HEAD on it, so the filter stands beside the rebase row.
  const onlyStackOf = input.showOnlyThisStack && state.head !== null && state.layers.length > 0 ? state.head : undefined;

  // 5. The layout. `onlyStackOf` is passed as `undefined` when unset, which layoutGraph reads as
  // absent (its own `=== undefined` test; `exactOptionalPropertyTypes` is off, so this compiles and
  // nobody should "fix" it to a conditional spread). `dirty` is the file count as a yes or no.
  const layout = layoutGraph(input.graph, { trunk: state.trunk, head: state.head, dirty: input.workingTreeFiles > 0, onlyStackOf });

  // 6. Every row's commit by name, for a layer's `parentSha`: a kept row's parent is a kept row or
  // the trunk — under the filter too, since the kept path is contiguous (core/graph.ts step 6).
  const shaByName = new Map<string, string>();
  for (const row of layout.rows) {
    if (row.kind === 'layer' || row.kind === 'trunk') {
      shaByName.set(row.name, row.sha);
    }
  }
  const facts: RowFacts = {
    repo: state.root,
    trunk: state.trunk,
    now: input.now,
    workingTreeFiles: input.workingTreeFiles,
    behindTrunk: input.behindTrunk,
    enrichment: state.enrichment,
    remoteBranches: state.enrichment?.kind === 'enriched' ? state.enrichment.remoteBranches : new Set<string>(),
    extras: input.extras,
    shaByName,
  };

  // 7. One view row per graph row, in the layout's order.
  const rows = layout.rows.map((row) => viewRowFor(row, facts));

  // 8. "Not on a stack" (E5) when the layout has no layer row: the repository has no stack at all.
  // The tree's test was HEAD's stack (`state.layers`); §7.1.1 moves it to the repository, so with
  // HEAD on trunk beside other stacks nothing is said and the stacks are drawn. Under the filter
  // (step 4) a layer row exists whenever the state and the texts describe the same moment — the one
  // refresh 23d reads them in — so the filter itself never produces the message; a pair gone stale
  // between the two reads (HEAD's branch merged, or switched) is drawn as the texts say and
  // corrected by the next refresh.
  if (!layout.rows.some((row) => row.kind === 'layer')) {
    messages.push({ kind: 'notOnStack', text: NOT_ON_STACK_TEXT, severity: 'information' });
  }

  // 9. The model: new objects throughout, nothing of the input reused but strings and the layout's
  // own `forks` arrays.
  return { repo: state.root, rows, lanes: layout.lanes, messages };
}

/**
 * Step 7: the view row for one graph row, by its kind. A `switch` with one `case` per kind, each
 * returning, and no `default` (primer §82): the function promises a ViewRow and the compiler can
 * see the four labels cover every member of `GraphRow['kind']`, so a fifth row kind in
 * core/graph.ts — item 23i's trunk commits — stops this file compiling until it has a case, where
 * an `if` chain ending in the elided row would swallow it in silence.
 */
// see primer §82 (`switch` over a tagged union)
function viewRowFor(row: GraphRow, facts: RowFacts): ViewRow {
  switch (row.kind) {
    case 'layer':
      return layerViewRow(row, facts);
    case 'trunk':
      return trunkViewRow(row, facts);
    case 'workingTree':
      return workingTreeViewRow(row, facts);
    case 'elided':
      return { kind: 'elided', lane: 0 };
  }
}

/**
 * 7a: a layer. The drawn fields copied from the graph row; `parentSha` looked up by the parent's
 * name; the age from the committer date; then what git-spice knows about the branch, looked up by
 * name (trackingOf), and what gh knows — read once, and only for a branch whose line carries a
 * change request: gh keys by head branch and lists pull requests, so an entry for a branch
 * git-spice knows no pull request for is stale or belongs to one opened outside the stack, and a
 * red ✕ beside no circle, or a "Mark Ready" item for a row with no pull request, would draw that
 * stale answer. `dim` is §7.1.1's two cases — untracked, or merged while the branch is still here
 * (E15); unknown is not dim, nothing being known.
 */
// see primer §70 (`?.`), §30 (`??`) and §48 (the conditional expression that keeps `joinsLane` absent, not `undefined`)
function layerViewRow(row: LayerRow, facts: RowFacts): LayerViewRow {
  const parentSha = facts.shaByName.get(row.parent);
  if (parentSha === undefined) {
    // Cannot happen — core/graph.ts draws every kept row's parent — but the compiler is not told that.
    throw new Error(`buildStackViewModel: ${row.name}'s parent ${row.parent} is not a row`);
  }
  const tracking = trackingOf(facts.enrichment, row.name);
  // The change request this row draws: a tracked layer's `change`, never git-spice's own trunk line's
  // (nothing in the tail is true of that line, a stray `change` on it included). Everything PR-shaped
  // below — gh's answer, the circle's state, the title line, `hasPR`, `isDraft` — reads this one value.
  const change = tracking?.down !== undefined ? tracking.change : undefined;
  const extra = change !== undefined ? facts.extras.get(row.name) : undefined;
  const indicators = indicatorsFor(row, tracking, extra, facts.remoteBranches);
  const prState = change !== undefined ? prStateOf(change.status, extra?.isDraft ?? false) : null;
  // see primer §16 (spread: git-spice's lines appended to the tooltip) and §17 (`typeof`: a title gh gave)
  const tooltip = [`${row.name} @ ${shortSha(row.sha)}`, `base: ${row.parent} @ ${shortSha(parentSha)}`, ...trackingLines(tracking)];
  if (typeof extra?.title === 'string') {
    tooltip.push(extra.title);
  }
  const base: LayerViewRow = {
    kind: 'layer',
    name: row.name,
    sha: row.sha,
    parent: row.parent,
    parentSha,
    forks: row.forks,
    lane: row.lane,
    node: row.node,
    indicators,
    age: formatAge(row.committedAt, facts.now),
    dim: tracking === null || prState === 'merged',
    tooltip,
    context: {
      webviewSection: 'layer',
      repo: facts.repo,
      layer: row.name,
      isCurrent: row.node === 'filled',
      isTracked: tracking !== undefined && tracking !== null,
      isUntracked: tracking === null,
      isTrunkLine: tracking !== undefined && tracking !== null && tracking.down === undefined,
      hasPR: change !== undefined,
      isDraft: prState === 'draft',
    },
  };
  // see primer §16 (spread: a copy of `base` with `joinsLane` added)
  return row.joinsLane === undefined ? base : { ...base, joinsLane: row.joinsLane };
}

/**
 * What git-spice knows about the branch called `name`, looked up in the whole answer rather than
 * on HEAD's layer, so a layer of any stack gets the same three-way answer `withTracking`
 * (core/backends/gitspice.ts) gives HEAD's: an entry — git-spice's own trunk line is one too;
 * `null` when a complete answer does not list it (untracked, E56); `undefined` when nothing was
 * asked (no `enrichment`), nothing came back (`not-enriched`), or the answer was incomplete — a
 * malformed line names no branch, so absence proves nothing (E57). For HEAD's layers this agrees
 * with `StackLayer.tracking` by construction, since `byName` is the map that filled it.
 */
// see primer §59 (narrowing on `kind`) and §48 (the conditional expression)
function trackingOf(enrichment: Enrichment | undefined, name: string): Tracking {
  if (enrichment === undefined || enrichment.kind === 'not-enriched') {
    return undefined;
  }
  const entry = enrichment.byName.get(name);
  if (entry !== undefined) {
    return entry;
  }
  return enrichment.complete ? null : undefined;
}

/**
 * The tail of a layer row, pushed in §7.1.1's fixed order and never sorted — `untracked` first (the
 * exclusive state, which only ⛅ may join), then the bullet's ⇈ · 💬 · ⇄ · ↑n · ⛅ · the PR circle ·
 * ✕ — each present only when its source field says so (Indicator's members name the fields).
 * Nothing at all for an unknown layer: "degrade without touching the tree" (E57), the cloud
 * included — its fact lives on the same enrichment and already vanishes with it for every
 * `not-enriched` cause, so one unknown row with a cloud would be the inconsistency. Nothing either
 * for git-spice's own trunk line (an entry with no `down`): a local `main` ahead of its remote is
 * tracked, yet nothing in this tail is true of it. `extra` is gh's answer, already gated on a
 * change request by the caller; `remoteBranches` the digest's names (RowFacts).
 */
// see primer §70 (`?.` through two optional fields), §30 (`??`) and §25 (arrays: push)
function indicatorsFor(row: LayerRow, tracking: Tracking, extra: PrExtras | undefined, remoteBranches: ReadonlySet<string>): Indicator[] {
  if (tracking === undefined) {
    return [];
  }
  let indicators: Indicator[];
  if (tracking === null) {
    indicators = [{ kind: 'untracked' }];
  } else if (tracking.down === undefined) {
    return [];
  } else {
    indicators = gitSpiceIndicators(tracking, tracking.down, extra);
  }
  // ⛅ is a git fact, read off the digest: no remote-tracking branch of this name on any remote.
  if (!remoteBranches.has(row.name)) {
    indicators.push({ kind: 'neverPushed' });
  }
  if (tracking?.change !== undefined) {
    indicators.push(...changeIndicators(tracking.change, extra));
  }
  return indicators;
}

/**
 * The four indicators a tracked layer's own line can carry, in the bullet's order: ⇈ · 💬 · ⇄ · ↑n.
 * `down` is the entry's, passed separately as a `GsLogDown` so the compiler knows it is there (the
 * caller has tested it; a tracked layer always has one — only git-spice's trunk line lacks it).
 */
function gitSpiceIndicators(entry: GsLogEntry, down: GsLogDown, extra: PrExtras | undefined): Indicator[] {
  const indicators: Indicator[] = [];
  if (down.needsRestack) {
    indicators.push({ kind: 'needsRestack' });
  }
  const unresolved = entry.change?.comments?.unresolved ?? 0;
  if (unresolved > 0) {
    indicators.push({ kind: 'unresolved', count: unresolved });
  }
  // The forge's base against git-spice's, both local branch names: the rail's `parent` would
  // differ for two names on one commit (E6) and after a plain-git rebase git-spice was not told
  // about, where ⇈ already speaks.
  if (extra !== undefined && extra.baseRef !== down.name) {
    indicators.push({ kind: 'baseDrift', prBase: extra.baseRef, localParent: down.name });
  }
  // `push.ahead`, not `push.needsPush`: that flag is "the two tips differ" and is true for a
  // branch strictly behind its remote too (measured, M4a), which has no glyph in this tail.
  if (entry.push !== undefined && entry.push.ahead > 0) {
    indicators.push({ kind: 'needsPush', ahead: entry.push.ahead });
  }
  return indicators;
}

/** The PR circle, and ✕ after it when gh counts a failing check: the two indicators a change request brings. */
function changeIndicators(change: GsLogChange, extra: PrExtras | undefined): Indicator[] {
  const indicators: Indicator[] = [
    {
      kind: 'pr',
      id: change.id,
      url: change.url,
      state: prStateOf(change.status, extra?.isDraft ?? false),
      reviewDecision: extra?.reviewDecision ?? null,
      title: extra?.title ?? null,
    },
  ];
  const checks = extra?.checks ?? null;
  if (checks !== null && checks.failing > 0) {
    indicators.push({ kind: 'checks', failing: checks.failing, total: checks.total });
  }
  return indicators;
}

/**
 * The PR circle's state from `change.status` — text the parser kept as it came (core/gsLog.ts), so
 * a value a later git-spice adds is `unknown` rather than a malformed line — and gh's `isDraft`,
 * which marks an open pull request GitHub flags: a draft over `open`, or over `unknown` when the
 * local tier has no status yet (M7's `--cr-status` brings it), never over `merged` or `closed`.
 */
// see primer §45 (narrowing a `string` to an exact-string union with `===`)
function prStateOf(status: string | undefined, isDraft: boolean): PrState {
  if (status === 'merged') {
    return 'merged';
  }
  if (status === 'closed') {
    return 'closed';
  }
  if (isDraft) {
    return 'draft';
  }
  return status === 'open' ? 'open' : 'unknown';
}

/**
 * The tooltip's lines from git-spice — the tree's `trackingLines` (vscode/tree.ts, item 20b) word for
 * word but for one test: none while unknown; `git-spice: not tracked`; `git-spice: trunk` for
 * git-spice's own trunk line; else `git-spice: tracked on <base>` — the base as git-spice names it,
 * the trunk's local branch for a bottom layer beside the row's `origin/main`: two spellings, not
 * drift — with ` · needs restack` and ` · needs push` appended when true, and the change request's
 * `<id> <url>` on a line of its own. The one changed test is `needs push`: `push.ahead > 0`, as the
 * tail's ↑n reads it, where the tree read `needsPush === true` — true for a branch strictly behind
 * its remote too (M4a); item 23j deletes the tree's copy.
 */
// see primer §25 (arrays: push, join, a typed empty array)
function trackingLines(tracking: Tracking): string[] {
  if (tracking === undefined) {
    return [];
  }
  if (tracking === null) {
    return ['git-spice: not tracked'];
  }
  if (tracking.down === undefined) {
    return ['git-spice: trunk'];
  }
  const parts = [`git-spice: tracked on ${tracking.down.name}`];
  if (tracking.down.needsRestack) {
    parts.push('needs restack');
  }
  if (tracking.push !== undefined && tracking.push.ahead > 0) {
    parts.push('needs push');
  }
  const lines = [parts.join(' · ')];
  if (tracking.change !== undefined) {
    lines.push(`${tracking.change.id} ${tracking.change.url}`);
  }
  return lines;
}

/**
 * 7b: the trunk row. Its one indicator is the input's two counts, present when either is above 0;
 * its tooltip names the commit and then words each count that is.
 */
function trunkViewRow(row: TrunkRow, facts: RowFacts): TrunkViewRow {
  const indicators: Indicator[] = [];
  const tooltip = [`${row.name} @ ${shortSha(row.sha)}`];
  const behind = facts.behindTrunk;
  if (behind !== null && (behind.origin > 0 || behind.local > 0)) {
    indicators.push({ kind: 'behindTrunk', origin: behind.origin, local: behind.local });
    if (behind.origin > 0) {
      tooltip.push(`HEAD's stack is ${countLabel(behind.origin, 'commit')} behind ${row.name}`);
    }
    if (behind.local > 0) {
      tooltip.push(`the local trunk branch is ${countLabel(behind.local, 'commit')} behind ${row.name}`);
    }
  }
  return {
    kind: 'trunk',
    name: row.name,
    sha: row.sha,
    lane: 0,
    node: row.node,
    indicators,
    age: formatAge(row.committedAt, facts.now),
    tooltip,
    context: { webviewSection: 'trunk', repo: facts.repo, trunk: row.name, isCurrent: row.node === 'filled' },
  };
}

/**
 * 7c: the working tree. The row exists only when the tree is dirty, so the count is at least 1;
 * its age is the present, written as the literal `now` rather than through formatAge.
 */
function workingTreeViewRow(row: WorkingTreeRow, facts: RowFacts): WorkingTreeViewRow {
  return {
    kind: 'workingTree',
    parent: row.parent,
    lane: row.lane,
    node: 'dashed',
    indicators: [{ kind: 'dirty', files: facts.workingTreeFiles }],
    age: 'now',
    tooltip: [`${countLabel(facts.workingTreeFiles, 'file')} changed on ${row.parent}`],
    context: { webviewSection: 'workingTree', repo: facts.repo, layer: row.parent },
  };
}

/**
 * A commit's age as the rail prints it (§7.1.1's right-hand column; the view-lab's `3m`, `26h`,
 * `2d`, `1w`, `2mo`): the largest unit that fits, floored, with one letter — `now` under a minute
 * (and for a date in the future: a clock skew is not an age), `m` under an hour, `h` under 48 hours
 * (so a day-old commit reads `26h`, not `1d`), `d` under a week, `w` under a mean month (30.4375
 * days — four weeks is still `4w`), `mo` under 365 days (twelve mean months are 365.25 days, so
 * `11mo` is the last month and `12mo` never prints), then `y`. Both arguments are unix seconds.
 * Hand-rolled: `Intl.RelativeTimeFormat` would print words and read the user's locale, and the
 * rail wants a two- or three-character column. An `if` chain rather than a table, because the
 * hours row's ceiling is two days, not one unit.
 */
// see primer §27 (`Math.floor`: integer division)
export function formatAge(committedAt: number, now: number): string {
  const delta = now - committedAt;
  if (delta < MINUTE) {
    return 'now';
  }
  if (delta < HOUR) {
    return `${Math.floor(delta / MINUTE)}m`;
  }
  if (delta < 2 * DAY) {
    return `${Math.floor(delta / HOUR)}h`;
  }
  if (delta < WEEK) {
    return `${Math.floor(delta / DAY)}d`;
  }
  if (delta < MONTH) {
    return `${Math.floor(delta / WEEK)}w`;
  }
  if (delta < YEAR) {
    return `${Math.floor(delta / MONTH)}mo`;
  }
  return `${Math.floor(delta / YEAR)}y`;
}

/** The first seven characters of a SHA — git's own abbreviation floor, as the tree's tooltip shows one. */
// see primer §23 (`slice`)
function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** `1 file`, `2 files`, `5 commits`: a count with its noun, the tree's `commitCountLabel` for any noun. */
function countLabel(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
