/**
 * extension.ts — the entry point VS Code calls when the extension starts and stops.
 *
 * Layer: wiring (plan §4.1). This is the only file VS Code loads directly: package.json
 * "main" points at its bundled form, dist/extension.js. Later PRs make it connect the pure
 * logic in src/core to the VS Code adapters in src/vscode; in this PR it only proves the
 * extension loads. Depends on: the `vscode` API module. Depended on by: nothing in the
 * codebase — VS Code itself is the caller. Plan: §4.1, §10.1 item 1.
 */

// see primer §1 (import / export) and §2 (the vscode module)
import * as vscode from 'vscode';

/**
 * Called by VS Code once, when the extension is activated — after startup finishes, per
 * "activationEvents" in package.json. It exists because an extension must expose some
 * function VS Code can call to start it; everything the extension ever does begins here.
 *
 * Why an output channel rather than console.log: an output channel appears in the user's
 * Output panel (dropdown entry "PR Cascade"), so someone who is not running the debugger
 * can still see what the extension is doing. console.log is only visible in the debugger.
 */
// see primer §3 (functions and type annotations)
export function activate(context: vscode.ExtensionContext): void {
  // see primer §4 (const)
  const output = vscode.window.createOutputChannel('PR Cascade');
  // Anything pushed onto context.subscriptions is disposed by VS Code when the extension
  // is deactivated, so the channel is cleaned up without us remembering to do it.
  context.subscriptions.push(output);
  output.appendLine('PR Cascade active');
}

/**
 * Called by VS Code when the extension shuts down (window closed, extension disabled).
 * There is nothing to do by hand — VS Code disposes everything in context.subscriptions —
 * but VS Code looks for this export, so it exists and is empty.
 */
export function deactivate(): void {
  // Intentionally empty; see the comment above.
}
