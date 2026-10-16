/**
 * test/unit/build.test.ts — the build script run for real (`node esbuild.mjs --dist <tmp>`) and its
 * output read back: the host bundle and one IIFE per view, each with its source map beside it; the
 * IIFE in strict mode; no code from src/core in it — plan §4.1's "the browser bundle carries no host
 * code" at the level that ships, beside lint.test.ts's source-level check, and the one guard that
 * sees a dynamic `import()` or a `require()` of core; no `require(` and no `node:` in the view where
 * the host bundle does `require("vscode")`; the codicon files copied. Into a temporary directory,
 * never dist/: a test must not race `npm run watch`, and a fresh clone's `npm test` must pass before
 * `npm run build`.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on: esbuild.mjs,
 * src/extension.ts, src/webview/**. Plan: §4.1, §7.1.3 "Theme", §9.2, §10.1 item 23c.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
let dist: string;
let view: string;
let host: string;

// One real build, exactly as `npm run build` runs it — the same Node (`process.execPath`), the same
// script, from the root — into a directory of its own, removed afterwards.
// see primer §28 (`execFileSync`, `mkdtempSync`)
beforeAll(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-cascade-build-'));
  execFileSync(process.execPath, ['esbuild.mjs', '--dist', dist], { cwd: ROOT, stdio: 'pipe' });
  view = fs.readFileSync(path.join(dist, 'webview', 'smartlog.js'), 'utf8');
  host = fs.readFileSync(path.join(dist, 'extension.js'), 'utf8');
});
afterAll(() => {
  fs.rmSync(dist, { recursive: true, force: true });
});

/** esbuild names every input file in a `// src/...` comment above its code; this is that list. */
const inputComments = (): string[] => (view.match(/^\s*\/\/ src\/\S+/gm) ?? []).map((line) => line.trim().slice(3));

describe('esbuild.mjs — the two worlds', () => {
  it('writes the host bundle and one IIFE per view, each with a source map beside it', () => {
    expect(fs.readdirSync(dist).sort()).toEqual(['extension.js', 'extension.js.map', 'webview']);
    expect(fs.readdirSync(path.join(dist, 'webview')).sort()).toEqual(['codicon.css', 'codicon.ttf', 'smartlog.js', 'smartlog.js.map']);
    expect(view.split('\n')[1]).toBe('(() => {');
    expect(view.trimEnd().split('\n').slice(-2)).toEqual(['})();', '//# sourceMappingURL=smartlog.js.map']);
  });

  it("runs both bundles in strict mode — tsconfig.json's `strict`, read by esbuild from the nearest tsconfig", () => {
    expect(view.split('\n')[0]).toBe('"use strict";');
    expect(host.split('\n')[0]).toBe('"use strict";');
  });

  it('carries no code from src/core into the view — only types cross that line (plan §4.1)', () => {
    expect(inputComments().length).toBeGreaterThan(0);
    expect(inputComments().every((file) => file.startsWith('src/webview/'))).toBe(true);
  });

  it('takes the API from the page and leaves Node out of the view, where the host bundle requires vscode', () => {
    expect(view).toContain('acquireVsCodeApi()');
    expect(view).not.toContain('require(');
    expect(view).not.toContain('node:');
    expect(host).toContain('require("vscode")');
  });

  it('copies the codicon stylesheet and font, the stylesheet naming the font by its relative path', () => {
    const css = fs.readFileSync(path.join(dist, 'webview', 'codicon.css'), 'utf8');
    expect(css).toContain('@font-face');
    expect(css).toContain('url("./codicon.ttf');
    expect(fs.statSync(path.join(dist, 'webview', 'codicon.ttf')).size).toBeGreaterThan(100_000);
  });
});
