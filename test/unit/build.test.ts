/**
 * test/unit/build.test.ts — the build script run for real (`node esbuild.mjs --dist <tmp>`) and its
 * output read back: the host bundle and one IIFE per view, each with its source map beside it; the
 * IIFE in strict mode; no code from src/core in it — plan §4.1's "the browser bundle carries no host
 * code" at the level that ships, beside lint.test.ts's source-level check, and the one guard that
 * sees a dynamic `import()` of core (a bare `require()` is TS2591 under tsconfig.webview.json's
 * `types: []` and `@typescript-eslint/no-require-imports` under lint before this test runs) — and
 * nothing of protocol.ts, whose header promises no bundle carries it; no `require(` in the view where
 * the host bundle does `require("vscode")`; the codicon files copied. Into a temporary directory,
 * never dist/: a test must not race `npm run watch`, and a fresh clone's `npm test` must pass before
 * `npm run build`.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on: esbuild.mjs,
 * src/extension.ts, src/webview/**. Plan: §4.1, §7.1.3 "Theme", §9.2, §10.1 item 23c.
 */
// see primer §1 (import / export)
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
let dist: string;
let view: string;
let host: string;

// arrange + act, once for the file: one real build, exactly as `npm run build` runs it — the same
// Node (`process.execPath`), the same script, from the root — into a directory of its own, removed
// afterwards. Every test below asserts on what it wrote.
// see primer §28 (`execFileSync`, `mkdtempSync`, `__dirname`)
beforeAll(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-cascade-build-'));
  execFileSync(process.execPath, ['esbuild.mjs', '--dist', dist], { cwd: ROOT, stdio: 'pipe' });
  view = fs.readFileSync(path.join(dist, 'webview', 'smartlog.js'), 'utf8');
  host = fs.readFileSync(path.join(dist, 'extension.js'), 'utf8');
});
afterAll(() => {
  fs.rmSync(dist, { recursive: true, force: true });
});

/**
 * esbuild writes a `// <path from the root>` comment above every input file's code; this collects
 * the ones under src/ — enough for the src/core and protocol.ts checks below. A dependency's would
 * read `// node_modules/…` and is not collected; none exists today (package.json has no
 * `dependencies`), and one admitted by §11.3 is not what this test guards.
 */
// see primer §20 (`match` with the `g` flag: every match, or `null` — hence the `?? []`)
const inputComments = (): string[] => (view.match(/^\s*\/\/ src\/\S+/gm) ?? []).map((line) => line.trim().slice(3));

describe('esbuild.mjs — the two worlds', () => {
  it('writes the host bundle and one IIFE per view, each with a source map beside it', () => {
    // assert: the listing, then the IIFE's first and last lines
    expect(fs.readdirSync(dist).sort()).toEqual(['extension.js', 'extension.js.map', 'webview']);
    expect(fs.readdirSync(path.join(dist, 'webview')).sort()).toEqual(['codicon.css', 'codicon.ttf', 'smartlog.js', 'smartlog.js.map']);
    expect(view.split('\n')[1]).toBe('(() => {');
    // see primer §23 (`trimEnd`; `slice(-2)` on an array: the last two)
    expect(view.trimEnd().split('\n').slice(-2)).toEqual(['})();', '//# sourceMappingURL=smartlog.js.map']);
  });

  it("runs both bundles in strict mode — tsconfig.json's `strict`, read by esbuild from the nearest tsconfig", () => {
    // assert
    expect(view.split('\n')[0]).toBe('"use strict";');
    expect(host.split('\n')[0]).toBe('"use strict";');
  });

  it('carries no code from src/core into the view — only types cross that line (plan §4.1) — and nothing of protocol.ts', () => {
    // assert: every input esbuild named is under src/webview/, and protocol.ts is not among them (a
    // value exported there and read at run time would put it there; an unused one is tree-shaken)
    expect(inputComments().length).toBeGreaterThan(0);
    expect(inputComments().every((file) => file.startsWith('src/webview/'))).toBe(true);
    expect(inputComments()).not.toContain('src/webview/protocol.ts');
  });

  it('takes the API from the page and requires nothing, where the host bundle requires vscode', () => {
    // assert: `platform: 'browser'` refused every Node import before this bundle existed; a surviving
    // one (an `external`, a wrong platform) would be esbuild's `__require("…")`, which the second line sees
    expect(view).toContain('acquireVsCodeApi()');
    expect(view).not.toContain('require(');
    expect(host).toContain('require("vscode")');
  });

  it('copies the codicon stylesheet and font, the stylesheet naming the font by its relative path', () => {
    // act
    const css = fs.readFileSync(path.join(dist, 'webview', 'codicon.css'), 'utf8');

    // assert
    expect(css).toContain('@font-face');
    expect(css).toContain('url("./codicon.ttf');
    expect(fs.statSync(path.join(dist, 'webview', 'codicon.ttf')).size).toBeGreaterThan(100_000);
  });
});
