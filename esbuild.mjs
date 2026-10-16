/**
 * esbuild.mjs — bundles the extension's two worlds: src/extension.ts into dist/extension.js (the
 * extension host, Node) and, since M6, src/webview/smartlog/main.ts into dist/webview/smartlog.js
 * (the browser page inside the view), then copies the codicon stylesheet and font beside it.
 *
 * Layer: tooling. VS Code loads exactly one host file, package.json "main" → dist/extension.js,
 * and a view's HTML shell (src/vscode/views/base.ts, item 23d) loads one view file. esbuild
 * follows every import from an entry and writes them into that one file, so node_modules never
 * ships (plan §11.3 "How packaging actually works"). Three modes, each covering both worlds:
 *   npm run build     the bundles, once
 *   npm run watch     rebuild on every save (the F5 dev loop, plan §11.2 item 7)
 *   npm run analyze   the bundles + one table of what each source file contributes (plan §11.3)
 * `--dist <dir>` moves every output: test/unit/build.test.ts runs this very script into a
 * temporary directory and reads it back, so the test and the build cannot drift apart; nothing
 * else passes it, and the flag refuses to run without a directory (a bare `--dist` would write
 * to `./undefined/`). The `.mjs` extension tells Node this file uses `import` rather than `require`.
 * Plan: §4.1, §7.1.3 "Theme", §9.2, §10.1 item 23c, §13.2 D69.
 */
import * as esbuild from 'esbuild';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';

// process.argv is the command line: [node, this-file, ...flags].
const watchMode = process.argv.includes('--watch');
const analyzeMode = process.argv.includes('--analyze');
const distFlag = process.argv.indexOf('--dist');
const dist = distFlag === -1 ? 'dist' : process.argv[distFlag + 1];
// A throw at the top level of an ES module exits Node with 1 and writes nothing.
if (distFlag !== -1 && (dist === undefined || dist.startsWith('--'))) {
  throw new Error('--dist needs a directory');
}

/** The extension host: one Node bundle. */
const hostOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: `${dist}/extension.js`,
  // The extension runs inside VS Code's own Node.js, not in a browser.
  platform: 'node',
  format: 'cjs',
  // VS Code 1.85 (our engines.vscode floor) ships Node 18, so no newer syntax may leak
  // into the bundle.
  target: 'node18',
  // `vscode` is provided by VS Code at runtime; it must be required, never bundled.
  external: ['vscode'],
  // A source map lets breakpoints in dist/extension.js land on the right .ts line.
  sourcemap: true,
  // Only --analyze needs the metafile (the per-file size report).
  metafile: analyzeMode,
  logLevel: 'info',
};

/**
 * The view: one browser bundle. `entryPoints` as an object names the output — the key is the
 * file name under `outdir`, so dist/webview/smartlog.js; item 23i adds
 * `graph: 'src/webview/graph/main.ts'` here and nothing else in this file changes.
 */
const webviewOptions = {
  entryPoints: { smartlog: 'src/webview/smartlog/main.ts' },
  bundle: true,
  outdir: `${dist}/webview`,
  // A webview is a browser page (the Chromium inside VS Code), not Node. With this setting
  // esbuild refuses an import of a Node built-in or of `vscode` outright ("Could not resolve"),
  // so a view cannot be built with host code in it — the lint rule in eslint.config.mjs says the
  // same earlier and in plain words. A Node *global* is the compiler's to refuse
  // (tsconfig.webview.json's `types: []`): esbuild would not complain about `process.env.X`, it
  // rewrites `process.env.NODE_ENV` to a string under this platform and leaves the rest.
  platform: 'browser',
  // An IIFE — the whole bundle inside one function that runs at once, a classic `<script>` —
  // rather than an ES module: nothing is exported, nothing leaks into the page's globals, and
  // the shell's one `<script nonce=…>` tag is all the CSP needs (plan §7.1.3 "Security"). The
  // bundle's first line, `"use strict";`, is tsconfig.json's `strict` arriving through esbuild,
  // which reads the nearest tsconfig.json above the entry (src/webview/tsconfig.json → the chain).
  format: 'iife',
  // VS Code 1.85 (our engines.vscode floor) is Electron 25.9.7, whose Chromium is 114, so no
  // newer syntax may leak into the view bundle — the browser-world twin of `node18` above.
  target: 'chrome114',
  // A source map lets "Developer: Open Webview Developer Tools" show the .ts line.
  sourcemap: true,
  metafile: analyzeMode,
  logLevel: 'info',
};

/**
 * The codicon stylesheet and font (plan §7.1.3 "Theme"), copied unchanged from the package into
 * dist/webview/ so the HTML shell can reference them under its CSP. `@vscode/codicons` is a
 * devDependency and is never imported, so nothing of it is bundled; its licence terms are in
 * THIRD-PARTY-NOTICES.md. Two named files, no glob: the package's dist/ holds 2.2 MB of catalogue
 * and SVG (a 1.4 MB HTML catalogue, a 444 KB sprite) that nothing here needs.
 */
async function copyCodicons() {
  // In watch mode the copy runs before the first build has made the directory.
  await mkdir(`${dist}/webview`, { recursive: true });
  for (const name of ['codicon.css', 'codicon.ttf']) {
    await copyFile(`node_modules/@vscode/codicons/dist/${name}`, `${dist}/webview/${name}`);
  }
}

if (watchMode) {
  // A "context" is esbuild's long-lived build; watch() keeps it alive until Ctrl+C. One per
  // world: a save under src/webview rebuilds only the view, a save elsewhere only the host.
  // top-level await: see primer §6 (async / await)
  const [host, webview] = await Promise.all([esbuild.context(hostOptions), esbuild.context(webviewOptions)]);
  await copyCodicons();
  await Promise.all([host.watch(), webview.watch()]);
} else {
  const [host, webview] = await Promise.all([esbuild.build(hostOptions), esbuild.build(webviewOptions)]);
  await copyCodicons();
  if (analyzeMode) {
    // The metafile records every input file and its size in the output. The two worlds' records
    // are joined into one — no input file is in both, since the view takes only types from core —
    // so one table lists both bundles and one dist/meta.json stays beside them for closer
    // inspection (esbuild's analyser at esbuild.github.io/analyze reads exactly that shape).
    const metafile = {
      inputs: { ...host.metafile.inputs, ...webview.metafile.inputs },
      outputs: { ...host.metafile.outputs, ...webview.metafile.outputs },
    };
    console.log(await esbuild.analyzeMetafile(metafile));
    await writeFile(`${dist}/meta.json`, JSON.stringify(metafile));
  }
}
