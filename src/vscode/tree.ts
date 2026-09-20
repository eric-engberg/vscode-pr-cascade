/**
 * vscode/tree.ts — the Stack view: turns the RepoStates the core computed into the rows
 * VS Code draws in the Source Control side bar, one row per layer, branch names only.
 *
 * Layer: vscode adapter (plan §4.1). Depends on: the `vscode` module, core/model.ts (types
 * only), Node's `node:path`. Depended on by: src/extension.ts (registers the provider for
 * the view declared in package.json) and test/ext/tree.test.ts. Plan: §4.2, §6, §7.1,
 * §8 E17/E44.
 */

// see primer §1 (import / export), §2 (the vscode module) and §9 (`import type`)
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RepoState, StackLayer } from '../core/model';

/**
 * One layer of the stack — the row `retry-metrics   3 commits · current`. The label is
 * the branch name and nothing else (plan §7.1: "labels are always branch names, never
 * SHAs"; E44); the SHAs live in the tooltip. In M1 a layer has no children; M2 puts the
 * layer's changed files under it.
 */
// see primer §13 (class) and §14 (readonly)
export class LayerNode {
  readonly layer: StackLayer;

  constructor(layer: StackLayer) {
    this.layer = layer;
  }

  /** How VS Code should draw this row. Called by the provider's getTreeItem. */
  // see primer §35 (enum values from the VS Code API: TreeItemCollapsibleState)
  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.layer.name, vscode.TreeItemCollapsibleState.None);
    // The dimmer text after the label: how far the layer is from trunk, and whether HEAD
    // is here. The icon and the contextValue change with it: `$(target)` for the branch
    // the user is on, `$(git-branch)` for the rest (plan §7.1), and `stackBranchCurrent`
    // so later PRs' context menus can hide "Check Out Branch" on the branch already
    // checked out (plan §7.2.1).
    let description = commitCountLabel(this.layer.commitCount);
    let icon = 'git-branch';
    let contextValue = 'stackBranch';
    if (this.layer.isCurrent) {
      description = description + ' · current';
      icon = 'target';
      contextValue = 'stackBranchCurrent';
    }
    item.description = description;
    item.iconPath = new vscode.ThemeIcon(icon);
    item.contextValue = contextValue;
    // Hovering is where the SHAs are: this layer's commit, and what it sits on — the
    // layer below, or trunk for the bottom layer (plan §7.1). Seven characters is where
    // git's own abbreviation starts (`core.abbrev=auto` begins at seven and grows with
    // the repository); in a repository of the size a stack lives in, that is enough to
    // paste into a git command.
    // see primer §12 (template strings)
    item.tooltip =
      `${this.layer.name} @ ${shortSha(this.layer.sha)}\n` +
      `base: ${this.layer.parent} @ ${shortSha(this.layer.parentSha)}`;
    return item;
  }
}

/**
 * One repository, shown only when the workspace holds more than one (plan §6): a
 * collapsible row named after the repository's folder, with the repository's layers as
 * its children. With a single repository the layers sit at the top level instead and no
 * RepoNode is made — a row that would always be the only one is noise.
 */
export class RepoNode {
  readonly state: RepoState;

  constructor(state: RepoState) {
    this.state = state;
  }

  /** How VS Code should draw this row. Called by the provider's getTreeItem. */
  toTreeItem(): vscode.TreeItem {
    // `path.basename` is the last piece of a path: `/work/app` → `app`. The full path is
    // in the tooltip for the case where two repositories have folders of the same name.
    const folderName = path.basename(this.state.root);
    const item = new vscode.TreeItem(folderName, vscode.TreeItemCollapsibleState.Expanded);
    item.iconPath = new vscode.ThemeIcon('repo');
    item.tooltip = this.state.root;
    item.contextValue = 'repo';
    return item;
  }
}

/**
 * A row that is a sentence rather than a layer: "No git repository in this workspace"
 * (plan §6, zero repositories), and the states in which a repository has no stack to
 * draw — no trunk found (E4), HEAD on trunk (E5) — or git could not be run at all (E17:
 * "one clear error node, not a crash loop"). M4 (plan §10.1 item 13) owns the full set of
 * state nodes and may reshape these; here they exist so the view is never silently empty.
 */
export class MessageNode {
  readonly message: string;
  /** A codicon name — `info`, `warning`, `error` — drawn before the text. */
  readonly icon: string;

  // see primer §13 (default parameters)
  constructor(message: string, icon: string = 'info') {
    this.message = message;
    this.icon = icon;
  }

  /** How VS Code should draw this row. Called by the provider's getTreeItem. */
  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.message, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(this.icon);
    // Nothing to do on it, and no menu should offer anything: the empty contextValue
    // keeps every `viewItem == ...` menu rule (package.json) from matching.
    item.contextValue = '';
    return item;
  }
}

/**
 * Anything that can be a row in the view. The provider is written against this union so
 * one tree can mix the three kinds; each kind knows how to draw itself (`toTreeItem`),
 * and `instanceof` tells them apart where it matters (getChildren).
 */
// see primer §34 (a union of classes, narrowed with instanceof)
export type StackNode = RepoNode | LayerNode | MessageNode;

/**
 * The bridge between the core's RepoStates and VS Code's tree widget. VS Code never
 * holds the tree; it asks this object — "what is at the top level?", "what are this
 * row's children?", "how is this row drawn?" — and draws the answers. That is the
 * TreeDataProvider contract, and implementing it is the whole job of this class.
 *
 * Why the provider is given a *function* that loads the states rather than the states
 * themselves: the states go stale with every commit, and re-asking git is the only way to
 * know what changed (plan §3 "Refresh"). So `refresh()` does not recompute anything — it
 * tells VS Code "the tree changed", VS Code asks for the top level again, and
 * `getChildren` calls the loader, which runs the whole pipeline (discovery → trunk →
 * stack) afresh. src/extension.ts owns that pipeline; this class only knows it exists.
 */
// see primer §31 (generics on classes: TreeDataProvider<StackNode>), §32 (EventEmitter and
// Event) and §33 (function types)
export class StackTreeProvider implements vscode.TreeDataProvider<StackNode>, vscode.Disposable {
  /**
   * How VS Code learns the tree changed. The emitter is private — only this class may
   * fire it; the `.event` half is what VS Code subscribes to, through the public field
   * below, whose name is fixed by the TreeDataProvider interface. Firing `undefined`
   * means "everything changed, start again from the top".
   */
  private readonly changeEmitter = new vscode.EventEmitter<StackNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<StackNode | undefined>;

  /** Runs the whole pipeline and answers with one RepoState per repository, in workspace order. */
  private readonly loadStates: () => Promise<RepoState[]>;

  constructor(loadStates: () => Promise<RepoState[]>) {
    this.loadStates = loadStates;
    this.onDidChangeTreeData = this.changeEmitter.event;
  }

  /** Redraw from scratch. What the toolbar button (`prCascade.refresh`) and every later automatic trigger (M4) call. */
  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  // The rest of the class is the TreeDataProvider contract, in the order VS Code calls it.

  /** VS Code asks this once per repaint of the root (`node` absent) and once per expanded row. */
  // see primer §6 (async / await) and §11 (an optional `?` parameter)
  async getChildren(node?: StackNode): Promise<StackNode[]> {
    if (node === undefined) {
      return this.topLevelNodes();
    }
    if (node instanceof RepoNode) {
      return nodesForRepo(node.state);
    }
    // A layer (until M2 adds its files) or a message: nothing underneath.
    return [];
  }

  /** VS Code asks this for every row it is about to draw. Each node kind draws itself. */
  getTreeItem(node: StackNode): vscode.TreeItem {
    return node.toTreeItem();
  }

  /** Called by VS Code on shutdown, through context.subscriptions (src/extension.ts). */
  dispose(): void {
    this.changeEmitter.dispose();
  }

  /**
   * The nodes at the top level of the view, per plan §6: one repository → its layers
   * directly; several → one RepoNode each; none → one message. A pipeline failure — git
   * not runnable (E17), a command that exited non-zero on a `run` — becomes one error row
   * with git's own words, rather than a rejected Promise that VS Code would report as a
   * toast and an empty view. The next refresh tries again from scratch.
   */
  // see primer §18 (try / catch and unknown)
  private async topLevelNodes(): Promise<StackNode[]> {
    let states: RepoState[];
    try {
      states = await this.loadStates();
    } catch (error) {
      let message = 'PR Cascade could not read the repository';
      if (error instanceof Error) {
        // GitError (core/git.ts) already phrases E17 as "git not found at <path>".
        message = error.message;
      }
      return [new MessageNode(message, 'error')];
    }
    if (states.length === 0) {
      return [new MessageNode('No git repository in this workspace')];
    }
    if (states.length === 1) {
      return nodesForRepo(states[0]);
    }
    // see primer §25 (arrays: map)
    return states.map((state) => new RepoNode(state));
  }
}

/**
 * The rows for one repository: its layers, top-first, or the one message that says why
 * there are none. Top-first — the reverse of RepoState.layers, which is bottom to top —
 * because that is how `git log` reads: the newest work at the top, trunk at the bottom
 * (plan §7.1). The loop counts down from the last layer to do the reversing; the array
 * is left as it was.
 */
// see primer §29 (counted for loops)
function nodesForRepo(state: RepoState): StackNode[] {
  if (state.trunk === null) {
    // Nothing can be measured without a base (E4); the message names the setting to fix.
    return [new MessageNode('No trunk found — set prCascade.trunk', 'warning')];
  }
  if (state.layers.length === 0) {
    // HEAD is on trunk, or on a branch trunk already contains (E5).
    return [new MessageNode('Not on a stack')];
  }
  const nodes: StackNode[] = [];
  for (let index = state.layers.length - 1; index >= 0; index--) {
    nodes.push(new LayerNode(state.layers[index]));
  }
  return nodes;
}

/** `1 commit`, `2 commits`: the layer's distance from trunk, as the description shows it. */
function commitCountLabel(commitCount: number): string {
  if (commitCount === 1) {
    return '1 commit';
  }
  return `${commitCount} commits`;
}

/** The first seven characters of a SHA — where git's own abbreviation starts (`core.abbrev`), and enough to paste into a git command. */
// see primer §23 (string methods: slice)
function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
