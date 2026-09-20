/**
 * vscode/tree.ts — the Stack view: turns the RepoStates the core computed into the rows
 * VS Code draws in the Source Control side bar — one row per layer, branch names only,
 * and under each layer one row per file that layer changes against the layer below it.
 *
 * Layer: vscode adapter (plan §4.1). Depends on: the `vscode` module, core/model.ts (types
 * only), Node's `node:path`. Depended on by: src/extension.ts (registers the provider and
 * hands it the two loaders), vscode/commands.ts (the FileNode a file row hands its command)
 * and test/ext/tree.test.ts. Plan: §6, §7.1, §7.2 (the click), §8 E7/E10/E17/E44, §12 item 3.
 */

// see primer §1 (import / export), §2 (the vscode module) and §9 (`import type`)
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ChangedFile, RepoState, StackLayer } from '../core/model';

/**
 * One layer of the stack — the row `retry-metrics   3 commits · current`. The label is
 * the branch name and nothing else (plan §7.1: "labels are always branch names, never
 * SHAs"; E44); the SHAs live in the tooltip. The row opens: under it the provider lists
 * the files the layer changes, one FileNode each. That is why the node carries `root` —
 * a FileNode names its file by an absolute path, and a layer on its own does not know
 * which repository it belongs to.
 */
// see primer §13 (class), §14 (readonly) and §47 (parameter properties: `readonly` on a
// constructor parameter declares the public field and fills it)
export class LayerNode {
  constructor(
    /** The repository the layer is in, as discovery found it (RepoState.root). */
    readonly root: string,
    readonly layer: StackLayer,
  ) {}

  /** How VS Code should draw this row. Called by the provider's getTreeItem. */
  // see primer §35 (enum values from the VS Code API: TreeItemCollapsibleState)
  toTreeItem(): vscode.TreeItem {
    // `Collapsed`: the row has children and starts folded. VS Code asks the provider for
    // them only when the user opens the row, so a stack of ten layers costs one diff per
    // layer *looked at*, not ten diffs up front.
    const item = new vscode.TreeItem(this.layer.name, vscode.TreeItemCollapsibleState.Collapsed);
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
 * One file a layer changes, as a row under the layer: `M  ingress.ts`, with the file's
 * directory as the dimmer description (plan §7.1 "File nodes"). The status letter is
 * part of the label rather than an icon (plan §12 item 3, decided: prefix) so the icon
 * slot stays free for VS Code's own file icon: the row names its file through
 * `resourceUri`, and VS Code then draws the icon the user's icon theme has for that kind
 * of file and applies its file decorations — the colour and letter the built-in git
 * extension gives a file that is modified or untracked in the working tree — exactly as
 * in the Explorer. Two spaces after the letter, so the names line up whatever the letter.
 *
 * A click on the row runs `prCascade.openDiff` (vscode/commands.ts) with the node itself
 * as the argument: the file at the layer's parent against the file at the layer, in the
 * diff editor (plan §7.2). That is why the node carries the `layer` and not only the
 * file — the two SHAs the command diffs, and the two names in the editor's title, are
 * the layer's.
 */
export class FileNode {
  constructor(
    /** The repository root: `file.path` is relative to it, and a URI wants the whole path. */
    readonly root: string,
    /**
     * The layer the file is listed under: its `parentSha` / `sha` are the two sides of
     * the diff, its `parent` / `name` the diff editor's title.
     */
    readonly layer: StackLayer,
    readonly file: ChangedFile,
  ) {}

  /** How VS Code should draw this row. Called by the provider's getTreeItem. */
  toTreeItem(): vscode.TreeItem {
    // git prints paths with `/` on every platform, and Node's `path` reads `/` on every
    // platform, so no conversion is needed before taking the file's name and directory.
    // see primer §28 (basename, dirname)
    const fileName = path.basename(this.file.path);
    const label = `${this.file.status}  ${fileName}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    // The description is the directory the file is in — and empty for a file at the
    // repository root, where `dirname` answers `.` (as the shell's does), which on a row
    // would only be noise. The tooltip is the whole path, since a description can be cut
    // short when the side bar is narrow.
    let description = path.dirname(this.file.path);
    if (description === '.') {
      description = '';
    }
    let tooltip = this.file.path;
    // A rename or copy is the one kind of row where the description is not the
    // directory: the move *is* the change, so the row shows where the file came from,
    // both paths in full — `src/old.ts → src/new.ts` (plan §7.1; E7). `oldPath` is set
    // exactly on renames and copies (core/model.ts), so its presence is the test.
    // see primer §11 (optional `?` fields) and §12 (template strings)
    if (this.file.oldPath !== undefined) {
      description = `${this.file.oldPath} → ${this.file.path}`;
      tooltip = description;
    }
    item.description = description;
    item.tooltip = tooltip;
    // The file as VS Code names things — a URI, `file:///work/app/src/ingress.ts`.
    // Setting it is all it takes for VS Code to treat the row as that file (icon,
    // decorations); this code knows nothing about icon themes. The path is the one at
    // the layer, which for a rename is the new name.
    // see primer §42 (vscode.Uri.file)
    item.resourceUri = vscode.Uri.file(path.join(this.root, this.file.path));
    // `stackFile`, or `stackFileBinary` for a file git considers binary (E10). The click
    // below is the same for both — openDiff itself shows a binary file as a file rather
    // than a diff — but the right-click menu a later milestone adds (plan §7.2.1 lays it
    // out: "Open File", "Open File at Parent"; §10.1 does not schedule it yet) will key
    // on the difference.
    // see primer §48 (the conditional expression)
    item.contextValue = this.file.binary ? 'stackFileBinary' : 'stackFile';
    // What a single click does: VS Code runs the command named here with the arguments
    // listed, and the argument is this very node — the file, the layer and the root in
    // one object — so the command needs nothing else to find both sides of the diff.
    // The title is what VS Code would show if the command were ever drawn as a button;
    // for a row it is never seen. This is the tree-item convention every "click opens
    // something" view uses (the Explorer's rows run `vscode.open` the same way).
    // see primer §52 (TreeItem.command and `arguments: [this]`)
    item.command = { command: 'prCascade.openDiff', title: 'Open Changes', arguments: [this] };
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
  constructor(readonly state: RepoState) {}

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
 * "one clear error node, not a crash loop"), at the top of the tree or under a layer
 * whose files could not be listed. M4 (plan §10.1 item 13) owns the full set of state
 * nodes and may reshape these; here they exist so the view is never silently empty.
 */
export class MessageNode {
  // see primer §13 (default parameters) and §47 (parameter properties)
  constructor(
    readonly message: string,
    /** A codicon name — `info`, `warning`, `error` — drawn before the text. */
    readonly icon: string = 'info',
  ) {}

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
 * one tree can mix the four kinds; each kind knows how to draw itself (`toTreeItem`),
 * and `instanceof` tells them apart where it matters (getChildren).
 */
// see primer §34 (a union of classes, narrowed with instanceof — and what happens when
// a member is added)
export type StackNode = RepoNode | LayerNode | FileNode | MessageNode;

/**
 * The bridge between the core's RepoStates and VS Code's tree widget. VS Code never
 * holds the tree; it asks this object — "what is at the top level?", "what are this
 * row's children?", "how is this row drawn?" — and draws the answers. That is the
 * TreeDataProvider contract, and implementing it is the whole job of this class.
 *
 * Why the provider is given *functions* that load the states and the files rather than
 * the data itself: the states go stale with every commit, and re-asking git is the only
 * way to know what changed (plan §3 "Refresh"). So `refresh()` does not recompute
 * anything — it tells VS Code "the tree changed", VS Code asks for the top level again,
 * and `getChildren` calls the loader, which runs the whole pipeline (discovery → trunk →
 * stack) afresh; a layer's files are loaded the same way, when its row is opened.
 * src/extension.ts owns both pipelines; this class only knows they exist.
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

  /**
   * The file lists already fetched, by the pair of commits each was computed between —
   * the key is `<parentSha>:<sha>`, two values joined into one string (primer §46).
   *
   * Why a cache: plan §10 M2 asks for one per layer, keyed on the two SHAs. Who consults
   * it is narrower than it may look. VS Code itself remembers a row's children until the
   * next refresh, so a layer closed and reopened is *not* asked for again; and refresh()
   * empties this map before VS Code re-asks. What the map answers, then, is a second
   * getChildren for the same pair of commits between two refreshes — which today only a
   * test issues. It pays off once refreshes stop emptying it, or a partial refresh
   * (`fire(node)`: one row re-asked while the others keep their entries) is used.
   *
   * Why the key is the two SHAs and not the branch name: the same pair of commits always
   * has the same diff, so an entry can never be wrong; a branch that moved has a new SHA,
   * hence a new key, and its old entry is simply never asked for again. That is also why
   * the map is emptied in refresh() rather than never — not because entries go stale, but
   * so a window kept open for a week does not hold every list it ever showed.
   */
  private readonly filesByCommitPair = new Map<string, ChangedFile[]>();

  // see primer §47 (parameter properties: the three `private readonly` parameters are the
  // class's remaining fields; the fields with an initialiser above are set before them, and
  // the body line runs last)
  constructor(
    /** Runs the whole pipeline and answers with one RepoState per repository, in workspace order. */
    private readonly loadStates: () => Promise<RepoState[]>,
    /** Lists the files one layer changes against the layer below it, in the repository at `root`. */
    private readonly loadFiles: (root: string, layer: StackLayer) => Promise<ChangedFile[]>,
    /** The "PR Cascade" entry of the Output panel: a failure that became a row is also written there, in full. */
    private readonly output: vscode.OutputChannel,
  ) {
    this.onDidChangeTreeData = this.changeEmitter.event;
  }

  /** Redraw from scratch. What the toolbar button (`prCascade.refresh`) and every later automatic trigger (M4) call. */
  refresh(): void {
    // Emptied before the event fires, so the re-asks that follow start from an empty
    // map. Why it is emptied at all — memory, not staleness — is on the field above.
    this.filesByCommitPair.clear();
    this.changeEmitter.fire(undefined);
  }

  // The rest of the class is the TreeDataProvider contract, in the order VS Code calls it.

  /** VS Code asks this once per repaint of the root (`node` absent) and once per opened row. */
  // see primer §6 (async / await) and §11 (an optional `?` parameter)
  async getChildren(node?: StackNode): Promise<StackNode[]> {
    if (node === undefined) {
      return this.topLevelNodes();
    }
    if (node instanceof RepoNode) {
      return nodesForRepo(node.state);
    }
    if (node instanceof LayerNode) {
      return this.filesForLayer(node);
    }
    // A file or a message: nothing underneath.
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
      this.output.appendLine(message);
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

  /**
   * The rows under one layer: a FileNode per changed file, in git's order — from the
   * cache when this pair of commits has been listed before, from git otherwise. A
   * failure — git gone (E17), a repository deleted under an open window — becomes one
   * error row *under the layer*, with git's own words, plus a line in the Output panel;
   * the rest of the tree stays as it is, because hiding three good layers over one that
   * could not be listed would help nobody. A failed list is not cached, so opening the
   * layer again asks git again. A layer that changes nothing — the second of two
   * branches on one commit (E6) — gets an empty list, which VS Code draws as a row with
   * nothing under it.
   */
  // see primer §46 (a cache: a Map with a composite key) and §18 (try / catch and unknown)
  private async filesForLayer(node: LayerNode): Promise<StackNode[]> {
    const key = `${node.layer.parentSha}:${node.layer.sha}`;
    let files = this.filesByCommitPair.get(key);
    if (files === undefined) {
      try {
        files = await this.loadFiles(node.root, node.layer);
      } catch (error) {
        let message = 'PR Cascade could not list the files of this layer';
        if (error instanceof Error) {
          message = error.message;
        }
        this.output.appendLine(`${node.layer.name}: ${message}`);
        return [new MessageNode(message, 'error')];
      }
      this.filesByCommitPair.set(key, files);
    }
    // see primer §25 (arrays: map)
    return files.map((file) => new FileNode(node.root, node.layer, file));
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
    nodes.push(new LayerNode(state.root, state.layers[index]));
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
