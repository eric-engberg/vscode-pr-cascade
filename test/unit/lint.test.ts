/**
 * test/unit/lint.test.ts — the two layering rules (plan §4.1) as a specification, through ESLint's
 * own API over the real eslint.config.mjs on probes written here: a few lines of text linted as if
 * they were a file at a path under the folder a rule guards (the path need not exist), and the rule
 * ids that come back. The `src/core` rule has guarded the architecture since M1 and had no test
 * until this file. What the webview rule cannot see — a dynamic `import()` — is the bundle test's
 * (build.test.ts), which reads what esbuild wrote; a `require()` call it cannot see either, but
 * `@typescript-eslint/no-require-imports` and the compiler (no `require` under tsconfig.webview.json's
 * `types: []`) refuse that before any bundle exists.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code) — over the repository's own
 * config, as release.test.ts is over its manifest. Depends on: eslint.config.mjs, the `eslint`
 * package's `ESLint` class (https://eslint.org/docs/latest/integrate/nodejs-api). Plan: §4.1, §9.2,
 * §10.1 item 23c.
 */
// see primer §1 (import / export)
import * as path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The repository root, two levels up from this file (as release.test.ts finds it).
const ROOT = path.resolve(__dirname, '..', '..');
// One ESLint over the real config; its first `lintText` loads the config (~0.4 s), the rest are milliseconds.
const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, 'eslint.config.mjs') });

/**
 * The rule ids ESLint reports for `code` as if it were the file at `file`. A parse error carries no
 * rule id (`ruleId` is `null`), so it comes back as `fatal` and no expectation below matches it.
 */
async function ruleIds(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  return result.messages.map((problem) => problem.ruleId ?? 'fatal');
}

const CORE_RULE = 'no-restricted-imports';
const WEBVIEW_RULE = '@typescript-eslint/no-restricted-imports';
const GLOBALS_RULE = 'no-restricted-globals';
const USE_VSCODE = "import * as vscode from 'vscode';\nexport const version = vscode.version;";
const USE_FS = "import { readFileSync } from 'node:fs';\nexport const hosts = readFileSync('/etc/hosts', 'utf8');";
const USE_PATH = "import * as path from 'path';\nexport const separator = path.sep;";
const USE_INTERNAL = "import * as agent from '_http_agent';\nexport const a = agent;";
const USE_CORE_VALUE = "import { formatAge } from '../../core/viewmodel';\nexport const age = formatAge(0, 60);";
const USE_CORE_NAMESPACE = "import * as viewmodel from '../../core/viewmodel';\nexport const age = viewmodel.formatAge(0, 60);";
const USE_CORE_TYPE = "import type { StackViewModel } from '../../core/viewmodel';\nexport const none: StackViewModel | null = null;";
const USE_CORE_INLINE_TYPE = "import { type StackViewModel } from '../../core/viewmodel';\nexport const none: StackViewModel | null = null;";
// Every name eslint.config.mjs's WINDOW_GLOBALS lists, so dropping one there is seen here.
const WINDOW_GLOBALS = ['name', 'length', 'event', 'status', 'top', 'parent', 'self', 'open', 'close', 'closed', 'origin', 'stop', 'print', 'external', 'screen', 'history', 'location'];
const USE_WINDOW_GLOBALS = `export const all = [${WINDOW_GLOBALS.join(', ')}];`;

describe('eslint.config.mjs — the layering rules (plan §4.1)', () => {
  it('src/core must not import vscode', async () => {
    // act + assert
    expect(await ruleIds('src/core/probe.ts', USE_VSCODE)).toEqual([CORE_RULE]);
  });

  it('src/core may import Node built-ins: its rule stops at vscode', async () => {
    // act + assert
    expect(await ruleIds('src/core/probe.ts', USE_FS)).toEqual([]);
  });

  it('src/webview must not import vscode', async () => {
    // act + assert
    expect(await ruleIds('src/webview/smartlog/probe.ts', USE_VSCODE)).toEqual([WEBVIEW_RULE]);
  });

  it('src/webview must not import a Node built-in — node: prefix, bare, or an internal _ name', async () => {
    // act + assert: one probe per spelling
    expect(await ruleIds('src/webview/smartlog/probe.ts', USE_FS)).toEqual([WEBVIEW_RULE]);
    expect(await ruleIds('src/webview/probe.ts', USE_PATH)).toEqual([WEBVIEW_RULE]);
    expect(await ruleIds('src/webview/probe.ts', USE_INTERNAL)).toEqual([WEBVIEW_RULE]);
  });

  it('src/webview may import types from src/core, never values — in a .mts file too', async () => {
    // act + assert: the two type forms clean, the two value forms refused, whatever the extension
    expect(await ruleIds('src/webview/smartlog/probe.ts', USE_CORE_TYPE)).toEqual([]);
    expect(await ruleIds('src/webview/smartlog/probe.ts', USE_CORE_INLINE_TYPE)).toEqual([]);
    expect(await ruleIds('src/webview/smartlog/probe.ts', USE_CORE_VALUE)).toEqual([WEBVIEW_RULE]);
    expect(await ruleIds('src/webview/smartlog/probe.ts', USE_CORE_NAMESPACE)).toEqual([WEBVIEW_RULE]);
    expect(await ruleIds('src/webview/smartlog/probe.mts', USE_CORE_VALUE)).toEqual([WEBVIEW_RULE]);
  });

  it("src/webview must not use window's properties by their bare names — all seventeen", async () => {
    // act + assert: one hit per name, in one line
    expect(await ruleIds('src/webview/smartlog/probe.ts', USE_WINDOW_GLOBALS)).toEqual(Array(WINDOW_GLOBALS.length).fill(GLOBALS_RULE));
  });

  it('the rules stop at their folders: src/vscode imports vscode and test/webview imports Node', async () => {
    // act + assert
    expect(await ruleIds('src/vscode/probe.ts', USE_VSCODE)).toEqual([]);
    expect(await ruleIds('test/webview/probe.test.ts', USE_FS)).toEqual([]);
  });
});
