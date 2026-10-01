/**
 * test/unit/release.test.ts — the facts the release workflow relies on, pinned on every
 * `npm test` instead of discovered at tag time: the version in package.json is a plain
 * `major.minor.patch`, CHANGELOG.md's newest release section is that version and links to
 * its release, and the VS Code floor in `engines` is the one the type declarations were
 * installed for (vsce refuses types newer than the floor; equal is what the floor promises).
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code) — over the repository's
 * own files, nothing under src/. Depends on: package.json, CHANGELOG.md. Depended on by:
 * nothing; .github/workflows/release.yml checks, on the tag, that the tag is `v<version>` and
 * that CHANGELOG.md has that section. Plan: §10.1 item 15, §11.2 (packaging), §13.2 D53.
 */

// see primer §1 (import / export), §9 (interface) and §54 (destructuring)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// The repository root, two levels up from this file — `__dirname` is the folder this file is
// in, a name CommonJS gives every module, like `$(dirname "$0")` in a shell script. The tests
// read the real files, not copies, so a bump that forgets one of them fails here.
// see primer §28 (`path.resolve`, `readFileSync` is `cat`)
const ROOT = path.resolve(__dirname, '..', '..');

/** The three facts these tests read out of package.json, as plain strings. */
interface ReleaseFacts {
  version: string;
  /** `engines.vscode`, the oldest VS Code the extension declares it runs on. */
  vscodeFloor: string;
  /** `devDependencies["@types/vscode"]`, the API version the code is checked against. */
  typesVersion: string;
}

/**
 * package.json as vsce reads it: parsed, then checked field by field the way core/uri.ts
 * checks a URI's query (primer §51) — `typeof`, `null`, `in`, each key written out, so the
 * compiler follows every step and nothing is cast. A missing or mistyped field throws with
 * its name, which is the failure a bump that forgot a file should produce.
 */
// see primer §50 (`JSON.parse`) and §51 (checking the shape of a parsed value: `typeof`, `null`, `in`)
function readReleaseFacts(): ReleaseFacts {
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('package.json is not an object');
  }
  if (!('version' in manifest) || typeof manifest.version !== 'string') {
    throw new Error('package.json has no string "version"');
  }
  if (!('engines' in manifest) || typeof manifest.engines !== 'object' || manifest.engines === null) {
    throw new Error('package.json has no "engines" object');
  }
  if (!('vscode' in manifest.engines) || typeof manifest.engines.vscode !== 'string') {
    throw new Error('package.json has no string "engines.vscode"');
  }
  if (!('devDependencies' in manifest) || typeof manifest.devDependencies !== 'object' || manifest.devDependencies === null) {
    throw new Error('package.json has no "devDependencies" object');
  }
  if (!('@types/vscode' in manifest.devDependencies) || typeof manifest.devDependencies['@types/vscode'] !== 'string') {
    throw new Error('package.json has no string devDependencies["@types/vscode"]');
  }
  return { version: manifest.version, vscodeFloor: manifest.engines.vscode, typesVersion: manifest.devDependencies['@types/vscode'] };
}

function readChangelog(): string {
  return fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
}

// see primer §5 (arrow functions)
describe('the release facts (plan §10.1 item 15)', () => {
  it('has a plain major.minor.patch version in package.json — what vsce accepts and the tag must equal', () => {
    // act
    const { version } = readReleaseFacts();

    // assert
    // see primer §20 (regular expression literals)
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('names the current version in the first `## [x.y.z]` heading of CHANGELOG.md — its newest release section', () => {
    // arrange
    const { version } = readReleaseFacts();

    // act: the first `## [x.y.z]` heading — Keep a Changelog's shape; `[Unreleased]` has no
    // digits and is passed over
    const match = /^## \[(\d+\.\d+\.\d+)\]/m.exec(readChangelog());

    // assert
    // see primer §8 (undefined and narrowing: a throw, so the compiler knows `match` below)
    if (match === null) {
      throw new Error('CHANGELOG.md has no "## [x.y.z]" heading');
    }
    expect(match[1]).toBe(version);
  });

  it('links the current version to its GitHub release tag in CHANGELOG.md', () => {
    // arrange
    const { version } = readReleaseFacts();

    // act + assert: the reference-style link Keep a Changelog ends with
    expect(readChangelog()).toContain(`[${version}]: https://github.com/eric-engberg/vscode-pr-cascade/releases/tag/v${version}`);
  });

  it('types the VS Code API against the same version as the engines floor — vsce refuses types newer than the floor, and equal is what the floor promises', () => {
    // act
    const { vscodeFloor, typesVersion } = readReleaseFacts();

    // assert: `^1.85.0` against `1.85.0`. vsce would accept older types; equal means the API
    // the code is checked against is exactly the one the floor promises
    expect(vscodeFloor).toBe(`^${typesVersion}`);
  });
});
