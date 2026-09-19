/**
 * esbuild.mjs — bundles src/extension.ts (and anything it imports) into dist/extension.js.
 *
 * Layer: tooling. VS Code loads exactly one file, package.json "main" → dist/extension.js.
 * esbuild follows every import from src/extension.ts and writes them into that one file,
 * so node_modules never ships (plan §11.3 "How packaging actually works"). Three modes:
 *   npm run build     one bundle
 *   npm run watch     rebuild on every save (the F5 dev loop, plan §11.2)
 *   npm run analyze   one bundle + a table of what each package contributes (plan §11.3)
 * The `.mjs` extension tells Node this file uses `import` rather than `require`.
 */
import * as esbuild from 'esbuild';
import { writeFile } from 'node:fs/promises';

// process.argv is the command line: [node, this-file, ...flags].
const watchMode = process.argv.includes('--watch');
const analyzeMode = process.argv.includes('--analyze');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
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
  // Only --analyze needs the metafile (the per-package size report).
  metafile: analyzeMode,
  logLevel: 'info',
};

if (watchMode) {
  // A "context" is esbuild's long-lived build; watch() keeps it alive until Ctrl+C.
  // top-level await: see primer §6 (async / await)
  const context = await esbuild.context(options);
  await context.watch();
} else {
  const result = await esbuild.build(options);
  if (analyzeMode) {
    // The metafile records every input file and its size in the output; this prints it
    // as a readable table and keeps the raw JSON next to the bundle for closer inspection.
    const report = await esbuild.analyzeMetafile(result.metafile);
    console.log(report);
    await writeFile('dist/meta.json', JSON.stringify(result.metafile));
  }
}
