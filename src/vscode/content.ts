/**
 * vscode/content.ts — fills in the `stackdiff:` documents: when VS Code needs the text
 * behind one side of a diff the extension opened, it asks this provider, which reads the
 * file at that commit out of the repository.
 *
 * Layer: vscode adapter (plan §4.1). Depends on: the `vscode` module, core/uri.ts.
 * Depended on by: src/extension.ts, which builds one with the git-backed reader and
 * registers it for the scheme. Plan: §3 "Diff rendering", §5 row "File content at ref",
 * §7.4, §8 E8/E9, §10.1 M3 item 11.
 */

// see primer §1 (import / export) and §2 (the vscode module)
import * as vscode from 'vscode';
import { decodeStackDiff } from '../core/uri';

/**
 * The content provider for the `stackdiff:` scheme (plan §3 "Diff rendering"). VS Code
 * never reads a file itself when a URI is not `file:`; it looks up the provider
 * registered for the URI's scheme and asks it for the text (primer §53). Registering
 * this class for `stackdiff` is what makes `vscode.diff(left, right)` on two such URIs
 * work — and work with the built-in git extension switched off, which is the reason the
 * extension has a scheme of its own rather than borrowing the built-in `git:` one.
 * Nothing calls this class directly: the command (vscode/commands.ts) builds the URIs,
 * and VS Code routes them here.
 *
 * Why it is handed a function rather than a git runner: the same shape as the tree's two
 * loaders (vscode/tree.ts) — src/extension.ts owns the runner and the settings, this
 * class only knows that "a file at a commit" can be read; a test can hand it something
 * that answers from a string and never touches git. The reader's contract is the one
 * `git show` gives (plan §5): the text of the file at that commit, or `''` when the file
 * does not exist there — an added file has no parent side (E8), a deleted file has no
 * layer side (E9), and an empty pane is exactly what the diff editor should show for
 * both.
 *
 * There is no `onDidChange` event: the interface offers one for documents whose content
 * can change under an open editor, and a `stackdiff:` document cannot — its `ref` is a
 * commit SHA (core/uri.ts says why), and the file at a commit is the same for ever.
 */
// see primer §53 (TextDocumentContentProvider), §13 (`implements`) and §47 (parameter
// properties); the function type is §33's
export class StackDiffContentProvider implements vscode.TextDocumentContentProvider {
  constructor(
    /** Reads one file at one commit in one repository; `''` when the file is not there. */
    private readonly readFileAtRef: (root: string, ref: string, relPath: string) => Promise<string>,
  ) {}

  /**
   * Called by VS Code, once per `stackdiff:` document it opens (it keeps the text for as
   * long as the document is open, so a diff editor costs two `git show`s, not one per
   * repaint). The URI is decoded — a `vscode.Uri` has the three fields `UriComponents`
   * asks for, and its `.path` and `.query` are already decoded text, `#` and `ü` as
   * themselves (primer §55) — and the location handed to the reader.
   *
   * A URI that is not what encodeStackDiff produces makes decodeStackDiff throw, and the
   * method is `async` so that throw becomes a rejected Promise: VS Code then shows the
   * error's message in place of the document, which names the offending part, instead
   * of `git show` being asked for a path that was never a path.
   */
  // see primer §6 (async / await) and §54 (destructuring: the three fields of the
  // location, taken out by name)
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { root, ref, relPath } = decodeStackDiff(uri);
    return this.readFileAtRef(root, ref, relPath);
  }
}
