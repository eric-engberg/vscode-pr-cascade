/**
 * vscode/statusbar.ts — the status bar item: `$(layers) <branch> · n of N`, the branch HEAD
 * is on and its place in the stack counted from the bottom, or `$(layers) not on a stack`;
 * hidden when there is no repository, when the load failed, or while `prCascade.statusBar`
 * is off. A click opens the Stack view. The tree provider feeds it the states of every
 * refresh — the same load that draws the rows, never a second pipeline (plan §7.1.0 "the
 * same refresh cycle"); when two loads overlap, the newest started is the one it hears
 * (vscode/tree.ts, `loads`).
 *
 * Layer: vscode adapter (plan §4.1). Depends on: the `vscode` module (types only — the item
 * itself is made in src/extension.ts and handed in), core/model.ts (RepoState). Depended on
 * by: src/extension.ts (one per window, fed by `StackTreeProvider.onDidLoadStates`) and
 * test/ext/statusbar.test.ts. Plan: §7.1.0 (the status bar bullet), §7.3 `prCascade.statusBar`,
 * §7.14.3 (hidden in the E82 states), §8 E3/E4/E5/E6/E44/E82, §10.1 item 14, §13.2 D52.
 */

// see primer §1 (import / export) and §9 (`import type`)
import type { Disposable, StatusBarItem } from 'vscode';
import type { RepoState } from '../core/model';

/**
 * The part of a StatusBarItem this file touches (primer §66): the four fields it sets and
 * the three methods it calls. A `Pick` (primer §49) rather than the whole interface, so a
 * test can hand in a stand-in with seven members that remembers what it was told — the real
 * item cannot be asked whether it is shown.
 */
export type StatusBarEntry = Pick<StatusBarItem, 'name' | 'text' | 'tooltip' | 'command' | 'show' | 'hide' | 'dispose'>;

/**
 * The item's text for one repository (plan §7.1.0): the current layer's name and its place
 * counted from the bottom — `$(layers) add-retries · 2 of 3` — or `$(layers) not on a stack`
 * when no layer is current: HEAD on trunk (E5), a detached HEAD (E3), no trunk (E4).
 * `$(layers)` is the codicon the view itself uses (package.json). Under v0.1's HEAD-only
 * membership the layers above HEAD are not listed (plan §12 item 2), so `n` equals `N`
 * except when two branches share one commit (E6); the rule is written for every stack all
 * the same, and M6's all-stacks view gives it its full meaning. One function returning a
 * plain string, so a later milestone's texts slot in beside these two.
 */
// see primer §25 (arrays: findIndex) and §12 (template strings)
export function stackStatusText(state: RepoState): string {
  const current = state.layers.findIndex((layer) => layer.isCurrent);
  if (current === -1) {
    return '$(layers) not on a stack';
  }
  return `$(layers) ${state.layers[current].name} · ${current + 1} of ${state.layers.length}`;
}

/**
 * The item, kept for the life of the window and told what the tree loaded on every refresh
 * (`update`). It describes the first repository in view order — plan §6's order, the one
 * the tree's rows use — and names that repository's root in the tooltip, so that with
 * several repositories open (Ric's own layout) the item still says which one it means
 * (D52; M6 moves to the active editor's repository). Hidden on `[]` — no repository, or a
 * load that failed: the five states of plan §7.14.3 — and while `prCascade.statusBar` is off.
 */
// see primer §13 (class: `implements`), §47 (parameter properties), §61 (a getter in a
// class), §14 (`readonly` on an array type) and §66 (the status bar item)
export class StackStatusBar implements Disposable {
  /** What the item was last told: StatusBarItem itself cannot be asked whether it is shown. */
  private shown = false;

  constructor(
    /** The item VS Code made (src/extension.ts, `createStatusBarItem`) — or a test's stand-in. Public so test/ext/statusbar.test.ts can read back `text` and `command`; nothing in src/ reads it. */
    readonly item: StatusBarEntry,
    /** `prCascade.statusBar` as it is right now — read on every update, like every setting (vscode/config.ts). */
    private readonly isEnabled: () => boolean,
  ) {
    // Set once: the label the status bar's own right-click menu uses for this entry, and
    // the click — the `<viewId>.focus` command VS Code creates for every contributed view,
    // so nothing of ours is registered for it (plan §7.1.0 "click → focus the view").
    item.name = 'PR Cascade Stack';
    item.command = 'prCascade.focus';
  }

  /** Whether the item is showing — what the tests read; the real item offers no such field. */
  get visible(): boolean {
    return this.shown;
  }

  /** Called with every refresh's states (StackTreeProvider.onDidLoadStates); `[]` means nothing to show. */
  update(states: readonly RepoState[]): void {
    if (this.isEnabled() === false || states.length === 0) {
      this.item.hide();
      this.shown = false;
      return;
    }
    const state = states[0];
    this.item.text = stackStatusText(state);
    this.item.tooltip = state.root;
    this.item.show();
    this.shown = true;
  }

  /** Called by VS Code on shutdown, through context.subscriptions (src/extension.ts): removes the entry. */
  dispose(): void {
    this.item.dispose();
  }
}
