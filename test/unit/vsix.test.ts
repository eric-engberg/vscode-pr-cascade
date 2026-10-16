/**
 * test/unit/vsix.test.ts — what reaches a user, pinned on every `npm test`: `vsce ls` over the
 * repository as `npm run package` would pack it. .vscodeignore names root tooling files one by one,
 * so a new root file ships unless a line there leaves it out (measured: a stray config file at the
 * root was listed) — and one root file, THIRD-PARTY-NOTICES.md, is *meant* to ship. Passes with no
 * dist/ built (a fresh clone's `npm test`): the check is the root list and that nothing else but
 * dist/ is packed, source maps excluded.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code) — over the repository's own
 * files, as release.test.ts is. Depends on: .vscodeignore, `@vscode/vsce`. Plan: §11.3 "How
 * packaging actually works", §10.1 item 23c.
 */
import { execFileSync } from 'node:child_process';
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
    const files = shippedFiles();

    const rootFiles = files.filter((file) => !file.includes('/')).sort();
    expect(rootFiles).toEqual(['CHANGELOG.md', 'LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.md', 'package.json']);
    expect(files.filter((file) => file.includes('/')).every((file) => file.startsWith('dist/') && !file.endsWith('.map'))).toBe(true);
  });
});
