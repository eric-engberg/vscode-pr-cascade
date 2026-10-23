/**
 * test/unit/viewShell.test.ts — the views' HTML shell as a specification: one whole document with
 * plan §7.1.3's Content Security Policy word for word, the codicon stylesheet and the one bundle
 * with its nonce, nothing else interpolated; and the nonce — 32 hex characters, never the same twice.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code — the module imports none).
 * Depends on: src/vscode/views/shell.ts. Plan: §7.1.3 "Security", §9.4 `unit/viewShell`, §10.1
 * item 23d (M6), §13.2 D70.
 */

// see primer §1 (import / export)
import { describe, expect, it } from 'vitest';
import { newNonce, shellHtml } from '../../src/vscode/views/shell';

// The four parts as VS Code would hand them: its `cspSource` for a locally installed extension,
// a nonce, and the two files under dist/webview/ as webview URIs.
// see primer §4 (const)
const CSP_SOURCE = "'self' https://*.vscode-cdn.net";
const NONCE = '0123456789abcdef0123456789abcdef';
const SCRIPT_URI = 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/smartlog.js';
const STYLE_URI = 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/codicon.css';

const html = shellHtml({ cspSource: CSP_SOURCE, nonce: NONCE, scriptUri: SCRIPT_URI, styleUri: STYLE_URI });

/** How many times `text` occurs in `html`, non-overlapping. */
// see primer §25 (arrays: `split`, `length`)
function occurrences(text: string): number {
  return html.split(text).length - 1;
}

describe('shellHtml — the one template (plan §7.1.3 Security)', () => {
  it("is a whole document — <!DOCTYPE html>, lang, charset — with the policy exactly: default-src none; style-src cspSource and the nonce; script-src the nonce; font-src cspSource", () => {
    // assert: the opening as written, and the one meta with the plan's string, every part in its place
    expect(html.startsWith('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n')).toBe(true);
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${CSP_SOURCE} 'nonce-${NONCE}'; script-src 'nonce-${NONCE}'; font-src ${CSP_SOURCE}">`,
    );
    expect(html.endsWith('</body>\n</html>')).toBe(true);
  });

  it('links codicon.css by the style URI and loads the one bundle by the script URI with the nonce — the only <link>, the only <script>, the nonce in three places', () => {
    // assert
    expect(occurrences('<link')).toBe(1);
    expect(html).toContain(`<link rel="stylesheet" href="${STYLE_URI}">`);
    expect(occurrences('<script')).toBe(1);
    expect(html).toContain(`<script nonce="${NONCE}" src="${SCRIPT_URI}"></script>`);
    // twice in the policy, once on the script — and nowhere else
    expect(occurrences(NONCE)).toBe(3);
  });

  it("interpolates nothing but the four parts and leaves <body> empty but for the script: document.body is the render root, as 23c's main.ts draws (D69's clause, kept)", () => {
    // assert: the body is the script and nothing else; the parts occur where the template puts
    // them and nowhere else
    expect(html).toMatch(/<body>\n<script nonce="[0-9a-f]{32}" src="[^"]+"><\/script>\n<\/body>/);
    expect(occurrences(SCRIPT_URI)).toBe(1);
    expect(occurrences(STYLE_URI)).toBe(1);
    expect(occurrences(CSP_SOURCE)).toBe(2);
  });
});

describe('newNonce', () => {
  it('is 32 lowercase hex characters — 128 random bits', () => {
    // act
    const nonce = newNonce();

    // assert
    // see primer §20 (regular expression literals)
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs between two calls — one page, one nonce', () => {
    // act + assert
    expect(newNonce()).not.toBe(newNonce());
  });
});
