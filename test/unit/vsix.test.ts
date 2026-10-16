/**
 * test/unit/vsix.test.ts — what reaches a user, pinned on every `npm test`: `vsce ls` over the
 * repository as `npm run package` would pack it. .vscodeignore names root tooling files one by one,
 * so a new root file ships unless a line there leaves it out (measured: a stray config file at the
 * root was listed) — and one root file, THIRD-PARTY-NOTICES.md, is *meant* to ship. The root list is
 * the check that holds everywhere; the second half of the `vsce ls` assertion — nothing but dist/,
 * no source map — holds only on a built tree (a developer's after `npm run build`), since CI's
 * `npm test` runs before any build and a fresh clone's listing has no dist/ at all. So the two
 * exclusion lines that keep the maps and the analyze report out are pinned in .vscodeignore's own
 * text, where the file list cannot see them.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code) — over the repository's own
 * files, as release.test.ts is. Depends on: .vscodeignore, `@vscode/vsce`. Plan: §11.3 "How
 * packaging actually works", §10.1 item 23c.
 */
// see primer §1 (import / export)
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');

/** What `vsce package` would put in the .vsix today, one path per line, as `vsce ls` prints it. */
function shippedFiles(): string[] {
  const vsce = path.join(ROOT, 'node_modules', '@vscode', 'vsce', 'vsce');
  const out = execFileSync(process.execPath, [vsce, 'ls', '--no-dependencies'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('WARNING') && !line.startsWith('DONE'));
}

describe('.vscodeignore — what reaches a user', () => {
  it('ships exactly five root files beside dist/ — a new root file is packed unless .vscodeignore names it', () => {
    // act
    const files = shippedFiles();
    const ignored = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8').split('\n');

    // assert: the root list; everything else under dist/ and no map (on a built tree); the two
    // exclusion lines the listing cannot see on an unbuilt one
    const rootFiles = files.filter((file) => !file.includes('/')).sort();
    expect(rootFiles).toEqual(['CHANGELOG.md', 'LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.md', 'package.json']);
    expect(files.filter((file) => file.includes('/')).every((file) => file.startsWith('dist/') && !file.endsWith('.map'))).toBe(true);
    expect(ignored).toEqual(expect.arrayContaining(['**/*.map', 'dist/meta.json']));
  });
});
