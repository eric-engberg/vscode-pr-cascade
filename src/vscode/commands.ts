/**
 * vscode/commands.ts — what the extension's commands do when run. For now one:
 * `prCascade.openDiff`, the click on a file row, which opens VS Code's own diff editor
 * on the file as it was at the layer's parent against the file as it is at the layer.
 *
 * Layer: vscode adapter (plan §4.1). Depends on: the `vscode` module, core/uri.ts (the
 * two sides of a diff as the parts of `stackdiff:` URIs), vscode/tree.ts (the FileNode a
 * row hands over; type only) and Node's `node:path`. Depended on by: src/extension.ts,
 * which registers openDiff under its command id. Plan: §7.2, §7.4, §8 E7–E11, §10.1 M3 11.
 */

// see primer §1 (import / export), §2 (the vscode module) and §9 (`import type`)
import * as path from 'node:path';
import * as vscode from 'vscode';
import { encodeStackDiff } from '../core/uri';
import type { FileNode } from './tree';

/**
 * `prCascade.openDiff` — "Open Changes" (plan §7.2): show what the layer did to one file.
 * Registered by src/extension.ts; run by VS Code with the FileNode a row carries as its
 * command argument (vscode/tree.ts, `item.command`), or with nothing at all from the
 * Command Palette, where there is no row — hence `FileNode | undefined`.
 *
 * The diff is the file at `layer.parentSha` on the left against the file at `layer.sha`
 * on the right: the same two snapshots core/changes.ts listed the row from, so what the
 * editor shows is exactly what the row claimed. Each side is a `stackdiff:` URI
 * (core/uri.ts); VS Code routes both to the content provider (vscode/content.ts), which
 * runs `git show` for each. For a rename the left side is the *old* path (E7) — that is
 * where the file was at the parent, and `oldPath` is set exactly then. An added file has
 * no parent side and a deleted file no layer side; nothing here has to know: the
 * provider answers `''` for a file a commit does not have, and the diff editor draws
 * the empty pane (E8, E9). The title is `<file> (<parent> → <layer>)` in branch names,
 * never SHAs (plan §7.2, and §7.1's rule for labels); VS Code puts it on the tab.
 *
 * A binary file (E10) gets no diff editor — git has no text diff for it, and the editor
 * would only show "the file is binary" twice. Plan §7.2 says "open the file at `branch`
 * instead", which is possible exactly when that branch is checked out: the file is then
 * on disk, and `vscode.open` shows it with whatever VS Code has for that kind of file
 * (an image preview for a real image). On any other layer the file exists only inside
 * git, and reading it out into a temporary file to show is more machinery than a
 * message is worth in v0.1 — so the row says so and names the layer. A binary file the
 * current layer *deleted* is not on disk either, and gets the message too.
 */
// see primer §6 (async / await), §54 (destructuring), §55 (vscode.Uri.from) and §56
// (executeCommand and the built-in `vscode.diff` / `vscode.open` commands;
// showInformationMessage)
export async function openDiff(node: FileNode | undefined): Promise<void> {
  if (node === undefined) {
    // Not awaited: the call resolves when the toast is dismissed, and nothing here
    // waits for that — the command is done once the message is up.
    vscode.window.showInformationMessage('Select a file in the Stack view to open its changes.');
    return;
  }
  const { root, layer, file } = node;
  const fileName = path.basename(file.path);

  if (file.binary) {
    if (layer.isCurrent && file.status !== 'D') {
      // The file is normally on disk at this path — HEAD is on the layer, and the layer
      // did not delete it. HEAD says nothing about the working tree, though: if an
      // uncommitted `rm` or `mv` has taken it away since, `vscode.open` shows VS Code's
      // own "not found", which is still better than a diff that would be empty anyway.
      // `vscode.open` is the built-in command behind a double-click in the Explorer.
      // (see primer §42 for Uri.file)
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(root, file.path)));
      return;
    }
    // Not awaited either — see the first toast above.
    // see primer §12 (template strings)
    vscode.window.showInformationMessage(`${fileName} is binary; git has no text diff for it (layer ${layer.name}).`);
    return;
  }

  // Two URIs, one per side, built by VS Code from the parts core/uri.ts lays out (plan
  // §7.4: "build with vscode.Uri.from, not string concatenation" — `from` is what
  // percent-encodes a `#` or a space in the path, E11). `??`: the old path when there is
  // one — a rename — else the path itself.
  // see primer §30 (`??`) and §16 (object literals: shorthand keys)
  const left = vscode.Uri.from(encodeStackDiff({ root, ref: layer.parentSha, relPath: file.oldPath ?? file.path }));
  const right = vscode.Uri.from(encodeStackDiff({ root, ref: layer.sha, relPath: file.path }));
  const title = `${fileName} (${layer.parent} → ${layer.name})`;
  // `vscode.diff` is the built-in command behind every diff editor VS Code opens — the
  // one the built-in git extension runs for "Open Changes". It resolves once the editor
  // is showing.
  await vscode.commands.executeCommand('vscode.diff', left, right, title);
}
