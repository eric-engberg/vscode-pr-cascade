/**
 * core/graph.ts — every stack in the repository as the rows of the smartlog rail: which local
 * branches are stack layers, which layer (or trunk) each one sits on, and the lane each row is
 * drawn in (plan §7.1.1 "Rail", E78). computeStack (core/stack.ts) answers for the stack under
 * HEAD only; the M6 views draw them all (§12 item 2), so this file reads the whole picture in
 * three git commands and lays it out without asking git anything more per branch: three spawns
 * for any number of branches, where computeStack asks two questions per branch — the first of
 * them alone, 101 `rev-list --count` spawns on a 10 000-commit line, measured 3.25 s against the
 * 48 ms of the three commands here (D67).
 *
 * For a history that is a single line above trunk — the shape stacking guarantees, and every
 * shape test/helpers/fixture.ts builds — the rows name HEAD's layers exactly as computeStack
 * does: the same names, parents and depths. Where two named lines have been merged into one
 * another, computeStack's count order is a guess its own header disclaims; the rows here are
 * what git says — one parent per layer, the deepest ancestor — and test/git/graph.git.test.ts
 * pins the one shape where the two differ.
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/model.ts (`GitRunner`). Depended
 * on by: core/viewmodel.ts (item 23b: `layoutGraph` and the row types), src/extension.ts (item 23d,
 * which will call readGraphInput then layoutGraph once per repository and refresh);
 * test/unit/graph.test.ts, test/git/graph.git.test.ts, test/unit/viewmodel.test.ts (`layoutGraph`
 * and the row types, for the geometry rows), test/git/gitspice.git.test.ts (`readGraphInput` for
 * the two view-model rows). Plan: §4.2, §7.1.1, §7.2.1 (Show
 * Only This Stack), §8 E78, §9.4 `unit/graph` and `git/graph.git`, §10.1 item 23a (M6), §13.2 D67.
 */

// see primer §1 (import / export) and §9 (`import type`)
import type { GitRunner } from './model';

/**
 * Every local branch: `<name> <sha> <committer date as unix seconds>` per line, in name order
 * (how `for-each-ref` sorts). `lstrip=2` not `short` for the reason core/stack.ts gives: `short`
 * prints `heads/docs` once a tag called `docs` exists. The date is the layer's age in the rail
 * (item 23b) — one more column here keeps the view model free of spawns; committer date, not
 * author date, because it moves on amend and rebase, which is "last touched". A ref under
 * refs/heads always points at a commit (git refuses to write anything else there — measured),
 * so the third column is always present. A branch name can never contain whitespace (git refuses
 * to create one), so the two spaces are the only two on a line. Exported so the tests can spell
 * the argv they expect from the same list.
 */
// see primer §4 (const) and §14 (readonly arrays)
export const REFS_ARGS: readonly string[] = [
  'for-each-ref',
  '--format=%(refname:lstrip=2) %(objectname) %(committerdate:unix)',
  'refs/heads',
];

/**
 * The DAG: one line per commit that some local branch has and `trunk` does not — `<sha>
 * <parent>…`, newest first. `--branches` is every ref under refs/heads (a detached HEAD, a tag
 * or a remote-tracking branch is not one); `--not <trunk>` cuts the walk at trunk, so a parent
 * that is not itself a line is a trunk commit: the point where a stack forks off trunk. The one
 * exception is a repository where git itself has cut the history — a shallow clone whose depth
 * ends inside a stack prints the graft commit with no parents at all — and the layout reads such
 * a line as an orphan root (see layoutGraph), as `rev-list --count` is truncated the same way.
 * On a trunk-only repository git prints nothing and exits 0. A function, not a constant, because
 * the trunk is detectTrunk's answer; the test spells its expectation from the same list. No
 * `--end-of-options`: a trunk whose name starts with `-` already breaks computeStack's
 * `rev-list --count <trunk>..`, so it is not half-guarded here either.
 */
// see primer §3 (functions and type annotations)
export function dagArgs(trunk: string): string[] {
  return ['rev-list', '--parents', '--branches', '--not', trunk];
}

/**
 * Trunk's tip as `<sha> <committer date>` on one line. `rev-list -1` walks one commit;
 * `--no-commit-header` drops the `commit <sha>` line rev-list would otherwise print above a
 * `--format` (git ≥ 2.33; the floor is 2.38); `^{commit}` insists on a commit, as detectTrunk's
 * own check did, and follows an annotated tag to its commit. rev-list rather than `log` because
 * `log` reads the user's `log.*` settings (`log.showSignature` would add lines). The same SHA and
 * the same failure (exit 128 on a missing ref, so `run` rejects — E17) as the plan's `rev-parse
 * --verify`, plus the date for the trunk row's age.
 */
// see primer §12 (template strings)
export function trunkTipArgs(trunk: string): string[] {
  return ['rev-list', '-1', '--no-commit-header', '--format=%H %ct', `${trunk}^{commit}`];
}

/**
 * The three texts, exactly as git printed them (trailing newline included). Kept as text so a
 * unit test can hand in a hand-written repository shape and so nothing is lost between the spawn
 * and the parse; layoutGraph parses them.
 */
// see primer §9 (interface) and §14 (readonly)
export interface GraphInput {
  /** `REFS_ARGS`: `<name> <sha> <unix date>` per line. */
  readonly refs: string;
  /** `dagArgs`: `<sha> <parent>…` per line; empty on a trunk-only repository. */
  readonly dag: string;
  /** `trunkTipArgs`: `<sha> <unix date>` and a newline. */
  readonly trunkTip: string;
}

/**
 * Runs the three commands in the repository at `root` against `trunk` (as detectTrunk named it)
 * and hands the texts back untouched. All three are `run`: detectTrunk verified the trunk, so a
 * failure is git itself failing (E17), never an answer. Three sequential awaits, as computeStack
 * does; together well under 100 ms on a thousand-commit stack (measured, D67).
 */
// see primer §6 (async / await) and §16 (arrays: spread — a mutable copy, since `run` takes `string[]`)
export async function readGraphInput(git: GitRunner, root: string, trunk: string): Promise<GraphInput> {
  const refs = await git.run([...REFS_ARGS], root);
  const dag = await git.run(dagArgs(trunk), root);
  const trunkTip = await git.run(trunkTipArgs(trunk), root);
  // see primer §16 (object literals: shorthand keys)
  return { refs, dag, trunkTip };
}

/** One `REFS_ARGS` line: a local branch, its commit, and that commit's committer date. */
export interface RefEntry {
  readonly name: string;
  readonly sha: string;
  /** Committer date, seconds since 1970 — the row's age once item 23b words it. */
  readonly committedAt: number;
}

/**
 * The refs text as entries, in git's order. Each line splits on its two spaces (a name has
 * none). Two names on one commit are two entries with the same `sha` (E6) — both kept; the
 * layout makes them a chain. Empty text → `[]`; a trailing newline or none reads the same.
 */
// see primer §25 (arrays: split, filter, map), §54 (destructuring an array: `const [name, sha, date]`)
// and §27 (Number: text to number)
export function parseRefs(text: string): RefEntry[] {
  const lines = text.split('\n').filter((line) => line !== '');
  return lines.map((line) => {
    const [name, sha, date] = line.split(' ');
    return { name, sha, committedAt: Number(date) };
  });
}

/**
 * The DAG text as commit → its parents, in git's order (first parent first). A Map so the layout
 * can ask "is this a commit trunk lacks?" and "what are its parents?" by SHA in constant time. A
 * commit with no parents is an orphan root (a branch with its own history, `gh-pages`; a shallow
 * clone's graft): an empty list, not an absent key. Order-independent: every line is a key
 * whatever order git printed them in. Trusts git — never throws — and the layout's walk
 * terminates on any text because every commit is visited once.
 */
// see primer §19 (Map), §14 (readonly arrays as Map values) and §54 (a rest element: `const [sha, ...parents]`)
export function parseDag(text: string): Map<string, readonly string[]> {
  const commits = new Map<string, readonly string[]>();
  for (const line of text.split('\n')) {
    if (line === '') {
      continue;
    }
    const [sha, ...parents] = line.split(' ');
    commits.set(sha, parents);
  }
  return commits;
}

/** Trunk's tip: the commit the stacks are measured against, and its date for the trunk row's age. */
export interface TrunkTip {
  readonly sha: string;
  readonly committedAt: number;
}

/**
 * The one `trunkTipArgs` line. The command is `run` on a ref detectTrunk verified, so git always
 * prints exactly `<sha> <date>`; anything else is git misbehaving, and a thrown Error naming the
 * text says so instead of letting a half-read tip into the layout.
 */
// see primer §18 (throw), §20 (regular expression literals: `test`), §30 (`??`: an absent second word
// read as an empty one) and §50 (`JSON.stringify`: the text quoted, so a stray newline shows)
export function parseTrunkTip(text: string): TrunkTip {
  const [sha, date] = text.trim().split(' ');
  if (!/^[0-9a-f]{40}$/.test(sha) || !/^\d+$/.test(date ?? '')) {
    throw new Error(`parseTrunkTip: expected one "<sha> <date>" line from rev-list, got ${JSON.stringify(text)}`);
  }
  return { sha, committedAt: Number(date) };
}

/** What the layout needs beyond git's texts. Plain values: item 23d reads them and passes them in. */
export interface GraphOptions {
  /** The trunk ref as detectTrunk named it (`origin/main`): the trunk row's name and every root's `parent`. */
  readonly trunk: string;
  /** `RepoState.head`: the branch HEAD is on, or null when detached (E3) — then nothing is filled. */
  readonly head: string | null;
  /**
   * Whether the working tree has changes. Item 23d reads it off the built-in Git extension
   * (plan §7.14: VS Code's own API where it has the fact): true when any of
   * `state.mergeChanges`, `state.indexChanges`, `state.workingTreeChanges` is non-empty (the
   * three lists the vendored src/vscode/git.d.ts has; an untracked file is a `Status.UNTRACKED`
   * entry of the last one under the default `git.untrackedChanges`). The lists are `[]` before a
   * repository's first status, so the row appears on the refresh that status fires. For drawing
   * only: the E13 checkout refusal takes its own fresh look (plan §5 keeps `git status
   * --porcelain` for it). This file never runs `git status`.
   */
  readonly dirty: boolean;
  /**
   * §7.2.1 "Show Only This Stack": when set, only this branch's stack is laid out — in git-spice's
   * sense of "stack": the layers below it down to trunk and every layer above it, never a sibling
   * subtree hanging off one of its ancestors (`gs stack submit` from the branch reaches exactly
   * these). The other roots and the dropped subtrees go before lanes are assigned, so what is
   * kept is drawn as if it were alone. A name that is no layer (trunk's own branch, a merged
   * branch, a typo) leaves the trunk row alone. If the checked-out layer is among the dropped,
   * nothing is filled and no working-tree row is drawn. The view model decides whether and for
   * which branch to set it (§7.2.1 "a view-model filter"); absent = every stack (§12 item 2).
   */
  // see primer §11 (optional `?` fields)
  readonly onlyStackOf?: string;
}

/** How a row's node is drawn (plan §7.1.1). Item 23i adds `'diamond'` on its own rows. */
// see primer §10 (union types: exact strings as members)
export type NodeKind = 'hollow' | 'filled' | 'dashed';

/**
 * One stack layer: a local branch whose commit trunk does not contain. The fields the rail draws
 * (`lane`, `node`, `joinsLane`) and the facts item 23b hangs indicators on (`name`, `sha`,
 * `committedAt`, `parent`, `depth`, `isTip`, `forks`). Nothing about PRs, pushes or files: those
 * are the view model's (§7.1.3).
 */
export interface LayerRow {
  readonly kind: 'layer';
  /** The branch name, as `git branch` lists it. */
  readonly name: string;
  /** The commit it points at, 40 hex characters. */
  readonly sha: string;
  /** That commit's committer date, unix seconds (from the refs text). */
  readonly committedAt: number;
  /** The layer this one sits on — a layer's name, or `GraphOptions.trunk` for a root. Same meaning as `StackLayer.parent`. */
  readonly parent: string;
  /**
   * Commits on this branch that trunk lacks (`rev-list --count <trunk>..<name>`, as computeStack
   * counts). For a stack that is a single line, the layer's own commits are `depth − parent's
   * depth` (0 for the second of two names on one commit); after a merge the subtraction counts
   * the merged-in line too, as computeStack's `commitCount` would.
   */
  readonly depth: number;
  /**
   * No layer sits on this one in the tree built here: the top of a drawn stack, what `gs stack
   * submit` submits up to. Plan §10's "no other such branch contains it" is the same thing except
   * after a merge of one stack into another, where the merged branch keeps a stack of its own.
   */
  readonly isTip: boolean;
  /**
   * The trunk commits this branch's history stops at — the DAG parents that are no line — sorted
   * by `<`: one for a plain fork, two after a merge from trunk, none for an orphan branch. A root
   * sits on trunk's tip iff this includes the trunk row's `sha`; item 23i's trunk-commit rows
   * (§7.1.2) take their `git log <trunk> --not <forks…>` range from here with no second walk.
   */
  readonly forks: readonly string[];
  /** 0 is trunk's lane; a stack's lane is its parent's, or one more when it is drawn beside a sibling. */
  readonly lane: number;
  /** `filled` when HEAD is on this branch (`GraphOptions.head`), else `hollow`. At most one row in the layout is filled. */
  readonly node: 'hollow' | 'filled';
  /**
   * Present on the lowest row of a stack drawn beside its parent's line: below this node the line
   * curves left into that lane (the ╮ of §7.1.1). Always `lane − 1`; absent on every other row —
   * never assigned `undefined`, so `toStrictEqual` works.
   */
  readonly joinsLane?: number;
}

/** The last row: trunk itself, always on lane 0. */
export interface TrunkRow {
  readonly kind: 'trunk';
  /** `GraphOptions.trunk` as given (`origin/main`); item 23b decides how to word it. */
  readonly name: string;
  readonly sha: string;
  readonly committedAt: number;
  /** The literal 0: trunk's line is lane 0 by definition (primer §10 — a literal type may be a number). */
  readonly lane: 0;
  /**
   * `filled` when HEAD is on a branch trunk already contains (see layoutGraph): its local trunk at
   * or behind the tip, a merged branch, or a branch with no commits of its own yet (`git checkout
   * -b x origin/main`) — the name of that branch is `RepoState.head`, not this row's. Else `hollow`.
   */
  readonly node: 'hollow' | 'filled';
}

/** The uncommitted working tree, one row directly above the checked-out row, on its lane (Graphite draws it so; §7.1.1). */
export interface WorkingTreeRow {
  readonly kind: 'workingTree';
  /**
   * The branch HEAD is on (`GraphOptions.head`) — the commit the changes sit on. The filled
   * layer's name when a layer is checked out; for a filled trunk row the local branch (`main`
   * three behind `origin/main`, a merged branch, a branch with no commits yet), never the trunk
   * ref: the changes are against that branch's commit, not trunk's tip.
   */
  readonly parent: string;
  readonly lane: number;
  readonly node: 'dashed';
}

/**
 * Trunk history no row shows, between the lowest stack and trunk: a dashed segment on lane 0, no
 * node. One row for the repository, not one per stack: it says that some drawn root is behind
 * trunk's tip, not which — the ⇈ of §7.1.1 says which, from git-spice, in item 23b. For an orphan
 * branch it stands for history that is not trunk's at all.
 */
export interface ElidedRow {
  readonly kind: 'elided';
  readonly lane: 0;
}

/** A row of the rail, told apart by `kind`. */
// see primer §59 (tagged unions)
export type GraphRow = LayerRow | TrunkRow | WorkingTreeRow | ElidedRow;

/** The rail: rows in drawing order (top first, trunk last) and how many lanes they use. */
export interface GraphLayout {
  readonly rows: readonly GraphRow[];
  /** Highest `lane` + 1: the rail cell's width in lanes. 1 for a trunk-only repository. */
  readonly lanes: number;
}

/**
 * What the layout knows about one layer while it is being placed — the half-built shape, as
 * computeStack's MeasuredBranch is for the stack under HEAD; nothing outside this file sees it.
 * `depth`, `forks`, `onTip` and `candidates` come from the member's own walk (layoutGraph step 3),
 * `parent` from comparing it with the others (step 4), `children` once every member has its
 * parent (step 5).
 */
// see primer §9 (interface) and §14 (readonly)
interface Member {
  readonly name: string;
  readonly sha: string;
  readonly committedAt: number;
  readonly depth: number;
  readonly forks: readonly string[];
  /** Whether `forks` includes trunk's tip: the stack sits on today's trunk, nothing elided below it. */
  readonly onTip: boolean;
  /** The names of every member this one's history reaches — the layers below it, in no order. */
  readonly candidates: readonly string[];
  /** A layer's name, or the trunk ref — set once every member is measured. */
  parent: string;
  /** The members whose `parent` is this one — filled once every member has its parent; the §7.2.1 filter (step 6) may narrow it. */
  children: Member[];
  /** No member sits on this one in the full picture — set with the tree (step 5), before any filter. */
  isTip: boolean;
  /** Rows in this member's subtree, itself included — set once the tree stands (step 7); decides which child continues a lane. */
  size: number;
}

/**
 * Lays out every stack in the repository: the rows of plan §7.1.1's rail in drawing order (top
 * first, trunk last) with a lane each. Pure — the same texts and options always give the same
 * rows, whatever order git printed the lines in — and built in numbered steps, their reasons in
 * the comments (D67 numbers them the same way; steps 2 to 8 are each a function after this one,
 * step 1 is the three parsers above, steps 9 to 14 are in this function's body):
 *
 * 1. parse the three texts (nothing else touches them);
 * 2. membership: a branch is a layer iff its commit starts a DAG line;
 * 3. one walk per member down its history, for its depth and its fork commits;
 * 4. its parent: the deepest member its history reaches, else trunk;
 * 5. the tree: children, roots, tips;
 * 6. the §7.2.1 filter, `onlyStackOf`: one branch's stack kept, in git-spice's sense, before any
 *    lane is assigned;
 * 7. each subtree's size — how many rows it will draw;
 * 8. which child continues its parent's lane (the biggest subtree, ties by name) and in what
 *    order the rest stand beside it — for trunk's side roots, the ones on its tip first;
 * 9. the rows, depth-first: the continuing child's subtree on the parent's lane, each other
 *    child's subtree one lane to the right with `joinsLane` on its lowest row, then the parent;
 *    trunk last;
 * 10. why that never crosses a lane (`draw`'s comment);
 * 11. the checked-out row is filled — a layer, or the trunk row when HEAD is on a branch trunk
 *     already contains;
 * 12. the working tree, when dirty: one dashed row directly above the checked-out row;
 * 13. the elided history: one row above trunk when any drawn root sits behind trunk's tip;
 * 14. `lanes`, the highest lane drawn plus one.
 */
// see primer §19 (Map), §21 (Set) and §22 (for ... of)
export function layoutGraph(input: GraphInput, options: GraphOptions): GraphLayout {
  // 1. Parse.
  const entries = parseRefs(input.refs);
  const commits = parseDag(input.dag);
  const trunkTip = parseTrunkTip(input.trunkTip);

  // 2–5. The members with their parents, then the tree.
  const members = measureMembers(entries, commits, trunkTip.sha, options.trunk);
  const fullRoots = buildTree(members, options.trunk);

  // 6. The filter, before any lane is assigned: dropping rows from a finished layout would leave
  // the lanes they took; what is kept must be drawn as if it were alone.
  // see primer §8 (narrowing `undefined` away)
  const roots = options.onlyStackOf === undefined ? fullRoots : keepOnlyStackOf(options.onlyStackOf, members);

  // 11. Which row is checked out. A layer: the member `head` names. Otherwise the trunk row, when
  // `head` names a branch that exists and is not a member — by step 2 exactly "a branch trunk
  // already contains": the local trunk at or behind the tip, a merged branch, a branch with no
  // commits of its own yet. A detached HEAD (`null`, E3) or a branch no refs line names (unborn)
  // fills nothing: there is no row for it.
  const branchNames = new Set(entries.map((entry) => entry.name));
  const memberNames = new Set(members.map((member) => member.name));
  const trunkFilled = options.head !== null && branchNames.has(options.head) && !memberNames.has(options.head);

  // 7. How many rows each subtree will draw (after the filter: a kept stack is sized as drawn).
  for (const root of roots) {
    measureSize(root);
  }

  // 9 and 10. The rows, built by a function that draws a layer's children before the layer itself
  // and calls itself for each child (primer §81): the continuing child's whole subtree on this
  // lane, then each side child's subtree on the next lane with its lowest row — the side child
  // itself, drawn last — curving into this lane, then the layer's own row. Rows come out top
  // first and trunk last by construction. Why `lane + 1` is always free, so lanes never cross:
  // when a side child starts, everything drawn above it on lanes greater than `lane` belongs to
  // an earlier sibling's subtree or to the continuing child's own side children, and every one
  // of those ended in a row joining `lane` — every higher lane has already curved back. So
  // consecutive siblings reuse one lane (view-lab's `fix/…` and `chore/…` are both on lane 1),
  // every lane left of a row carries a straight line through it, and `joinsLane` is always
  // `lane − 1`. `lanes` is a running maximum: the highest lane any row took, plus one.
  const rows: GraphRow[] = [];
  let lanes = 1;
  // see primer §5 (arrow functions), §33 (a closure: `draw` reads `rows`, `lanes` and `options` from the
  // layoutGraph call around it), §54 (a rest element: `const [continuing, ...side]`), §8 (`continuing` is
  // undefined for a tip)
  // and §48 (the conditional expression that keeps `joinsLane` absent, not `undefined`)
  const draw = (member: Member, lane: number, joins: number | null): void => {
    const [continuing, ...side] = orderChildren(member.children);
    if (continuing !== undefined) {
      draw(continuing, lane, null);
    }
    for (const child of side) {
      draw(child, lane + 1, lane);
    }
    if (lane + 1 > lanes) {
      lanes = lane + 1;
    }
    // 12. The working tree hangs on the checked-out layer, directly above it — after its children,
    // so with children the dashed node sits between the child chain and the layer (view-lab rows
    // 6–8). Its `parent` is the branch the changes sit on.
    if (options.dirty && member.name === options.head) {
      rows.push({ kind: 'workingTree', parent: member.name, lane, node: 'dashed' });
    }
    const row: LayerRow = {
      kind: 'layer',
      name: member.name,
      sha: member.sha,
      committedAt: member.committedAt,
      parent: member.parent,
      depth: member.depth,
      isTip: member.isTip,
      forks: member.forks,
      lane,
      node: member.name === options.head ? 'filled' : 'hollow',
    };
    rows.push(joins === null ? row : { ...row, joinsLane: joins });
  };

  // Trunk is drawn like any other parent — its continuing child straight up lane 0, the other
  // roots beside it (orderSideRoots says in what order) — except that its own row is the trunk
  // row, with the elided history and its working tree above it.
  const [continuingRoot, ...sideRoots] = orderChildren(roots);
  if (continuingRoot !== undefined) {
    draw(continuingRoot, 0, null);
  }
  for (const root of orderSideRoots(sideRoots)) {
    draw(root, 1, 0);
  }
  // 13. One elided row for the repository when any drawn root is behind trunk's tip: trunk has
  // commits none of the drawn stacks is built on — E78's "elided trunk history between the lowest
  // stack and main". It says that some root is behind, not which; the ⇈ of §7.1.1 says which,
  // from git-spice, in item 23b. An orphan branch has no forks, so it is never on the tip and the
  // row stands for history that is not trunk's at all. Every root on the tip → no row.
  // see primer §25 (arrays: some)
  if (roots.some((root) => !root.onTip)) {
    rows.push({ kind: 'elided', lane: 0 });
  }
  // 12 again, for trunk: the working tree of a HEAD on a branch trunk contains sits directly above
  // the trunk row — below the elided history: the row hangs on the trunk row whichever of trunk's
  // commits that branch is at (`main` three behind, a merged branch at `origin/main~1`, a branch
  // with no commits yet) — and names that branch, never the trunk ref (see WorkingTreeRow.parent).
  // `head` is a string here: trunkFilled checked it.
  if (options.dirty && trunkFilled && options.head !== null) {
    rows.push({ kind: 'workingTree', parent: options.head, lane: 0, node: 'dashed' });
  }
  rows.push({
    kind: 'trunk',
    name: options.trunk,
    sha: trunkTip.sha,
    committedAt: trunkTip.committedAt,
    lane: 0,
    node: trunkFilled ? 'filled' : 'hollow',
  });
  return { rows, lanes };
}

/**
 * Steps 2–4: which branches are layers, what each one's walk finds, and which layer each sits on.
 *
 * Membership (2): a branch is a layer iff its SHA starts a DAG line — a commit some local branch
 * has and trunk lacks. That leaves out trunk's own local branch while trunk contains it, every
 * merged branch (listed by `for-each-ref`, no line), a branch with no commits of its own yet and
 * anything behind trunk; it keeps a local `main` ahead of `origin/main` — a member like any other,
 * usually a one-row stack (D59's quirk, which computeStack has too: "what git says", gone on
 * push). Two names on one commit are two members with one SHA (E6).
 *
 * The parent (4) is the greatest candidate by (depth, name): the layer directly below is the
 * deepest layer the history reaches, and for two names on one commit the later name is the
 * chain's upper link — computeStack's E6 chain, `api-refactor → api-refactor-backup →
 * add-retries`. Names are unique, so the order is total and every member gets exactly one
 * parent; no candidate means the layer sits on trunk. After a merge of two named lines the
 * deepest named ancestor wins whichever side of the merge it came from — first-parent order is
 * never consulted, because one parent per member needs a total order, and first-parent is none
 * once two named ancestors tie on depth — so either the merged-in branch or the merging branch's
 * own base is left a stack of its own: what git says, as E14/E15, and the one shape where
 * computeStack's count order chains differently (the file header; test/git/graph.git.test.ts).
 */
// see primer §25 (arrays: map, filter, push) and §46 (a Map of arrays: get, then push)
function measureMembers(entries: RefEntry[], commits: Map<string, readonly string[]>, trunkSha: string, trunk: string): Member[] {
  // Every member's names by its SHA, known before any walk: two names on one commit share a list.
  const namesBySha = new Map<string, string[]>();
  for (const entry of entries) {
    if (commits.has(entry.sha)) {
      const names = namesBySha.get(entry.sha) ?? [];
      names.push(entry.name);
      namesBySha.set(entry.sha, names);
    }
  }

  // 3. One walk per member.
  const members: Member[] = [];
  for (const entry of entries) {
    if (!commits.has(entry.sha)) {
      continue;
    }
    const walk = walkHistory(entry.sha, commits);
    members.push({
      name: entry.name,
      sha: entry.sha,
      committedAt: entry.committedAt,
      depth: walk.depth,
      forks: walk.forks,
      onTip: walk.forks.includes(trunkSha),
      candidates: candidatesOf(entry, walk, namesBySha),
      parent: trunk,
      children: [],
      isTip: true,
      size: 0,
    });
  }

  // 4. The parent, once every member's depth is known.
  const byName = new Map(members.map((member) => [member.name, member]));
  for (const member of members) {
    member.parent = chooseParent(member.candidates, byName, trunk);
  }
  return members;
}

/**
 * Step 3's last answer: the names of every member on a commit the walk visited — the layers
 * `entry`'s history reaches — other than `entry` itself; on its own commit only the names that
 * sort before it (compareByCodePoint), so that of two names on one commit the earlier is the
 * ancestor and never the reverse (E6). A function of its own, so measureMembers stays readable
 * (and under SonarCloud's cognitive-complexity ceiling, as `probe` was split in item 18).
 */
function candidatesOf(entry: RefEntry, walk: Walk, namesBySha: Map<string, string[]>): string[] {
  const candidates: string[] = [];
  for (const sha of walk.visited) {
    for (const name of namesBySha.get(sha) ?? []) {
      if (sha !== entry.sha || compareByCodePoint(name, entry.name) < 0) {
        candidates.push(name);
      }
    }
  }
  return candidates;
}

/** What one walk down a member's history finds (step 3). */
// see primer §14 (`ReadonlySet`: a Set handed out with `has` and `size` but no `add`)
interface Walk {
  /** The commits visited: this member's `rev-list --count <trunk>..<name>`. */
  readonly depth: number;
  /** The trunk commits the walk stopped at — parents that are no DAG line — sorted. */
  readonly forks: readonly string[];
  /** Every commit visited, for finding the layers below. */
  readonly visited: ReadonlySet<string>;
}

/**
 * Step 3: from `start`, follow parents while they are DAG lines; a parent that is not one is a
 * trunk commit — recorded as a fork, not followed. An explicit worklist (an array used as a stack:
 * `push` and `pop` at the same end; primer §38's queue took from the other) rather than a
 * recursive call, because a branch can be a thousand commits long and an orphan branch its whole
 * history, and each commit would be one more paused call. The visited Set is what makes the walk
 * end on any text, a hand-typed cycle included: every commit is looked at once. The visited count
 * is the member's depth — exactly `rev-list --count <trunk>..<name>`, since both count the commits
 * reachable from the branch and not from trunk; a merge from trunk counts the merge commit only,
 * its trunk-side parent being a fork, not a line. The forks are sorted so the result is the same
 * whatever order the parents were met in — by character codes, as every order in this file is.
 */
// see primer §38 (while loops and a worklist), §21 (Set: has, add, size) and §26 (sort)
function walkHistory(start: string, commits: Map<string, readonly string[]>): Walk {
  const visited = new Set<string>();
  const forks = new Set<string>();
  const worklist = [start];
  while (worklist.length > 0) {
    const sha = worklist.pop();
    if (sha === undefined || visited.has(sha)) {
      continue;
    }
    visited.add(sha);
    // `start` is a DAG line by construction (membership), and only lines are pushed; `?? []` is
    // for the compiler, which cannot know that.
    for (const parent of commits.get(sha) ?? []) {
      if (commits.has(parent)) {
        worklist.push(parent);
      } else {
        forks.add(parent);
      }
    }
  }
  return { depth: visited.size, forks: Array.from(forks).sort(compareByCodePoint), visited };
}

/**
 * Step 4: the greatest candidate by (depth, name), or `trunk` when there is none. `candidates`
 * came from `namesBySha`, which was built from the same members as `byName`, so every name is
 * found; the `undefined` branch is for the compiler.
 */
function chooseParent(candidates: readonly string[], byName: Map<string, Member>, trunk: string): string {
  let best: Member | null = null;
  for (const name of candidates) {
    const candidate = byName.get(name);
    if (candidate !== undefined && (best === null || isDeeper(candidate, best))) {
      best = candidate;
    }
  }
  return best === null ? trunk : best.name;
}

/**
 * Whether `first` comes later in the (depth, name) order than `second`: deeper, or as deep with
 * the greater name (compareByCodePoint says how names are compared, and why).
 */
function isDeeper(first: Member, second: Member): boolean {
  if (first.depth !== second.depth) {
    return first.depth > second.depth;
  }
  return compareByCodePoint(first.name, second.name) > 0;
}

/**
 * The one way two names — or two SHAs — are ordered in this file: by their character codes, with
 * `<` and `>`, which is the same on every machine. Never `localeCompare`, for the reason
 * computeStack's compareByDistanceThenName gives: it orders by the user's language rules and could
 * put two branches in a different order on two developers' machines (`'zeta' < 'ömega'` by code
 * point, the reverse in most locales). Written once so the parent choice, the drawing order and the
 * forks all agree.
 */
// see primer §26 (sort and comparison functions)
function compareByCodePoint(first: string, second: string): number {
  if (first < second) {
    return -1;
  }
  return first > second ? 1 : 0;
}

/**
 * Step 5: the tree. Every member joins its parent's `children`; the members whose parent is trunk
 * are the roots, returned. A member with no children is a tip — the top of a stack, what `gs stack
 * submit` submits up to.
 */
function buildTree(members: Member[], trunk: string): Member[] {
  const byName = new Map(members.map((member) => [member.name, member]));
  const roots: Member[] = [];
  for (const member of members) {
    const parent = byName.get(member.parent);
    if (parent === undefined) {
      roots.push(member);
    } else {
      parent.children.push(member);
    }
  }
  if (roots.length === 0 && members.length > 0) {
    // Cannot happen — a member whose parent is no member has `trunk` as its parent — but the
    // compiler is not told that, and a tree with members and no roots would draw nothing.
    throw new Error(`layoutGraph: ${members.length} layers and none sits on ${trunk}`);
  }
  for (const member of members) {
    member.isTip = member.children.length === 0;
  }
  return roots;
}

/**
 * Step 6, §7.2.1's "Show Only This Stack": the stack of the branch called `name`, in git-spice's
 * sense — the layers below it down to trunk and every layer above it, never a sibling subtree
 * hanging off one of its ancestors (`gs stack submit` from the branch reaches exactly these).
 * Climbing `parent` from the branch to its root, every ancestor keeps only the child on the path;
 * the branch keeps its own children whole; the root becomes trunk's only child. Nothing else
 * changes — `depth`, `parent` and `isTip` of every kept row are the full picture's — so the kept
 * stack lays out exactly as it would in a repository holding nothing else. A name that is no
 * layer (trunk's own branch, a merged branch, a typo) leaves trunk with no children at all.
 * Membership, and so "is HEAD on a layer", was judged before this: a checked-out layer that the
 * filter drops fills nothing and draws no working-tree row.
 */
// see primer §38 (while loops: climbing a chain)
function keepOnlyStackOf(name: string, members: Member[]): Member[] {
  const byName = new Map(members.map((member) => [member.name, member]));
  let node = byName.get(name);
  if (node === undefined) {
    return [];
  }
  let parent = byName.get(node.parent);
  while (parent !== undefined) {
    parent.children = [node];
    node = parent;
    parent = byName.get(node.parent);
  }
  // The climb stopped at a member whose parent is no member — the trunk — so `node` is the path's
  // root, and the only root left.
  return [node];
}

/**
 * Step 7: how many rows a member's subtree will draw — itself and every layer above it. A
 * function that calls itself once per child and adds up the answers (primer §81): a post-order
 * walk, the children before the parent, as `draw` is. Recursion is safe here where the commit
 * walk (step 3) avoided it: one paused call per layer of nesting, a few dozen at most, never one
 * per commit. Layers only — the working-tree row is not counted, or a checkout would change which
 * child continues a lane.
 */
// see primer §81 (recursion: a function that calls itself)
function measureSize(member: Member): number {
  let size = 1;
  for (const child of member.children) {
    size += measureSize(child);
  }
  member.size = size;
  return size;
}

/**
 * Step 8: the order a parent's children are drawn in. The first continues on the parent's lane;
 * the rest are side children, drawn in this order, the first of them highest. Sorted by subtree
 * size, biggest first, then by name: the subtree with the most rows stays straight (usually the
 * long stack), a HEAD-first rule would swap lanes on every checkout, and the name tie-break keeps
 * two equal siblings in one order on every machine (compareByCodePoint). A sorted copy, so
 * `children` keeps the order step 5 built it in for any later reader that should not depend on
 * whether `draw` has run.
 */
// see primer §26 (sort and comparison functions) and §16 (arrays: spread — a copy)
function orderChildren(children: readonly Member[]): Member[] {
  return [...children].sort(compareBySizeThenName);
}

/**
 * Step 8 for trunk's side roots only: the roots on trunk's tip above the roots behind it, then
 * size, then name — fresh side stacks higher, stale ones lower, just above the elided segment
 * (view-lab's `fix` above `chore`, with no dates read). The tip key does not decide which root
 * continues lane 0: that stays the biggest subtree, because lane 0 must not move when `git fetch`
 * moves trunk under the main stack, and the view-lab's lane-0 stack (`part1`, "#480 merged", so
 * behind) would otherwise be pushed to lane 1 by any one-row fresh branch. A consequence to keep,
 * not fix: two one-row roots tie on size and the name decides, so a stale `alpha` is straight while
 * a fresh `zeta` curves — stability over freshness, since a (size, onTip, name) key would swap the
 * two lanes on the next fetch, when both are behind.
 */
function orderSideRoots(roots: readonly Member[]): Member[] {
  return [...roots].sort((first, second) => {
    if (first.onTip !== second.onTip) {
      return first.onTip ? -1 : 1;
    }
    return compareBySizeThenName(first, second);
  });
}

/** Biggest subtree first, then the smaller name first (compareByCodePoint). */
function compareBySizeThenName(first: Member, second: Member): number {
  if (first.size !== second.size) {
    // The bigger first: a negative result puts `first` before `second`.
    return second.size - first.size;
  }
  return compareByCodePoint(first.name, second.name);
}
