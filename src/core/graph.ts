/**
 * core/graph.ts — every stack in the repository as the rows of the smartlog rail: which local
 * branches are stack layers, which layer (or trunk) each one sits on, and the lane each row is
 * drawn in (plan §7.1.1 "Rail", E78). computeStack (core/stack.ts) answers for the stack under
 * HEAD only; the M6 views draw them all (§12 item 2), so this file reads the whole picture in
 * three git commands and lays it out without asking git anything more per branch: three spawns
 * for any number of branches, where computeStack's way is three per branch (measured 48 ms
 * against 3.25 s for 101 branches on a 10 000-commit line, D67).
 *
 * For a history that is a single line above trunk — the shape stacking guarantees, and every
 * shape test/helpers/fixture.ts builds — the rows name HEAD's layers exactly as computeStack
 * does: the same names, parents and depths. Where two named lines have been merged into one
 * another, computeStack's count order is a guess its own header disclaims; the rows here are
 * what git says — one parent per layer, the deepest ancestor — and test/git/graph.git.test.ts
 * pins the one shape where the two differ.
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/model.ts (`GitRunner`). Depended
 * on by: core/viewmodel.ts (item 23b) and src/extension.ts (item 23d), which call readGraphInput
 * then layoutGraph once per repository and refresh — nothing in src/ imports this file until
 * then; test/unit/graph.test.ts, test/git/graph.git.test.ts. Plan: §4.2, §7.1.1, §7.2.1 (Show
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
// see primer §18 (throw) and §20 (regular expression literals: `test`)
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
 * Lays out every stack in the repository. Pure: the same texts and options always give the same
 * rows, whatever order git printed the lines in. In this commit it knows only the trunk row —
 * the stacks, the lanes, the working tree and the elided history arrive in the next three
 * commits, each with its rows of the E78 table.
 */
export function layoutGraph(input: GraphInput, options: GraphOptions): GraphLayout {
  const trunkTip = parseTrunkTip(input.trunkTip);
  const trunkRow: TrunkRow = { kind: 'trunk', name: options.trunk, sha: trunkTip.sha, committedAt: trunkTip.committedAt, lane: 0, node: 'hollow' };
  return { rows: [trunkRow], lanes: 1 };
}
