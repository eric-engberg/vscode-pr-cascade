/**
 * vscode/views/shell.ts — the one HTML page both M6 views load (plan §7.1.3 "Security"): the
 * Content Security Policy with its nonce, the codicon stylesheet, and the view's bundle as the
 * last thing in `<body>`. A pure template over four strings the host makes — never over data
 * from git, which arrives by message — so a test pins the policy word for word without VS Code.
 *
 * Layer: vscode adapter (plan §4.1), with no `vscode` import: `node:crypto` is all it needs, so
 * Vitest runs its test under `npm test`, the per-commit gate (the terminal.ts / login.ts
 * precedent). Depends on: `node:crypto`. Depended on by: vscode/views/base.ts (the shell on every
 * resolve), test/unit/viewShell.test.ts, test/ext/views.test.ts, test/ext/webviewFacts.test.ts.
 * Plan: §7.1.3 "Security" and "Theme", §10.1 item 23d (M6), §13.2 D70.
 */

// see primer §1 (import / export) and §89 (`node:crypto`: random bytes as hex)
import { randomBytes } from 'node:crypto';

/**
 * What the shell is made of — four values the host makes, none of them data from git (§7.1.3:
 * "nothing is interpolated into markup"): VS Code's `cspSource` for the resources it serves, the
 * nonce for this one page, and the two resources as webview URIs (`asWebviewUri`).
 */
// see primer §9 (interface) and §14 (readonly)
export interface ShellInput {
  readonly cspSource: string;
  readonly nonce: string;
  readonly scriptUri: string;
  readonly styleUri: string;
}

/**
 * 128 random bits as 32 hex characters — a CSP nonce needs an unguessable value, fresh for every
 * page VS Code loads, and hex reads plainly with no `+`, `/` or `-` to explain (a UUID would be
 * legal too). Called once per `resolveWebviewView` (vscode/views/base.ts).
 */
export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * The one HTML template (§7.1.3 "Security"). The policy is the plan's, word for word:
 * `default-src 'none'` refuses everything not named; `style-src` admits the codicon stylesheet
 * (`cspSource` names the host VS Code serves our files from) and an inline `<style>` carrying the
 * nonce (none in 23d — 23e's rail brings one, and needs no policy change for it); `script-src`
 * admits exactly the one `<script>` with the nonce — nothing else on the page may run; `font-src`
 * admits the font the stylesheet names by a relative URL, from the same host. No `img-src`, no
 * `connect-src`: the views draw text and codicons and fetch nothing. `document.body` is the render
 * root — 23c's main.ts draws into it, and 23d names no other (D69's clause, kept): the first
 * `render` replaces the body's children, this `<script>` element among them, which has run by
 * then. No `<title>`, no viewport: VS Code's bootstrap titles the frame, and a side-bar pane
 * is not a page a phone scales.
 */
// see primer §54 (destructuring: the four parts out of the one argument) and §12 (a template string over several lines)
export function shellHtml({ cspSource, nonce, scriptUri, styleUri }: ShellInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; font-src ${cspSource}">
<link rel="stylesheet" href="${styleUri}">
</head>
<body>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
