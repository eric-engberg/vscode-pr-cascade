/**
 * webview/smartlog/render.ts — the rail before it is a rail: every notice, repository, message row
 * and row of a `ModelMessage` as one line of plain text, written into a root element. Item 23d's
 * "rows rendered as plain text for now" (plan §10.1), built on the view side so that 23d is host
 * code only (§10.1's never-mix rule, applied to the webview/vscode pair); item 23e rewrites this
 * file in place into §7.1.1's rail. Two rules the rail keeps: nothing survives from one model to
 * the next (`retainContextWhenHidden` is off — the view is rebuilt from a fresh model on every
 * show, §7.1.3), and text is text — `textContent`, never `innerHTML`, because a branch name is
 * data from git and "nothing is interpolated into markup" (§7.1.3 "Security").
 *
 * Layer: webview (plan §4.1: browser code; from src/core types only). Depends on: protocol.ts,
 * core/viewmodel.ts (types). Depended on by: smartlog/main.ts, test/webview/render.test.ts.
 * Plan: §7.1.3, §10.1 items 23c and 23d, §13.2 D69. Pending item 5 (several repositories) is not
 * decided here: a repository's root is printed above its rows only when there are several — the
 * tree's rule today — and `activeRepo` is carried, not drawn.
 */

// see primer §9 (`import type` from core: types only cross this line — plan §4.1)
import type { Indicator, ViewRow } from '../../core/viewmodel';
import type { ModelMessage } from '../protocol';

/**
 * Write `message` into `root` as one `<div>` per line, replacing whatever was there: the host's
 * notices first, then for each repository its root (when there are several), its message rows
 * and its rows, top first and the trunk row last — the model's order throughout.
 */
export function render(root: HTMLElement, message: ModelMessage): void {
  const lines = [
    ...message.notices.map((notice) => `${notice.severity}: ${notice.text}`),
    ...message.repos.flatMap((repo) => [
      ...(message.repos.length > 1 ? [repo.repo] : []),
      ...repo.messages.map((row) => `${row.severity}: ${row.text}`),
      ...repo.rows.map(rowText),
    ]),
  ];
  // see primer §87 (the DOM as a tree: `createElement`, `textContent`, `replaceChildren`)
  root.replaceChildren(...lines.map(lineElement));
}

/** One line as one element — a `<div>`, so the browser breaks lines without a stylesheet — with its text set as text. */
function lineElement(text: string): HTMLElement {
  const line = document.createElement('div');
  line.textContent = text;
  return line;
}

/**
 * One row as one line: the node (`●` checked out, `○` not, `◌` the working tree), the name, the
 * tail as its indicator kinds in the model's order, the age; `┆` for elided trunk history.
 */
// see primer §82 (`switch` over a tagged union; two labels sharing one body)
function rowText(row: ViewRow): string {
  switch (row.kind) {
    case 'layer':
    case 'trunk':
      return `${row.node === 'filled' ? '●' : '○'} ${row.name}${kinds(row.indicators)} ${row.age}`;
    case 'workingTree':
      return `◌ Uncommitted changes${kinds(row.indicators)} ${row.age}`;
    case 'elided':
      return '┆';
  }
}

/** The tail as words: one `kind` per indicator, in the model's order, each with a leading space. */
function kinds(indicators: readonly Indicator[]): string {
  return indicators.map((indicator) => ` ${indicator.kind}`).join('');
}
