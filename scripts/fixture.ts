/**
 * scripts/fixture.ts — `npm run fixture`: builds the plan Appendix A stack at
 * ../fixture-repo so the F5 dev loop (plan §11.2) has a repository to open.
 *
 * Layer: developer tooling (never shipped; .vscodeignore drops scripts/). Depends on:
 * test/helpers/fixture.ts, Node built-ins. Depended on by: nothing — it is run, not
 * imported; .vscode/launch.json opens what it writes. Plan: §9.2 "npm run fixture", §11.2.
 */

// How it runs: `npm run fixture` (package.json) has esbuild bundle this file and its
// import into one JavaScript file, out/scripts/fixture.js, and then runs that with node —
// the same tool and the same step that turn src/ into dist/extension.js. out/ is scratch
// (gitignored, never shipped). The two commands are joined with `&&` so that a bundling
// error stops the script there, rather than node running an empty program and reporting
// success. Node 24 can also run TypeScript directly by stripping the types, but only with
// `.ts` written on every import, which the compiler settings here do not allow; esbuild
// needs no such thing.

// see primer §1 (import / export) and §28 (the Sync variants of Node's functions)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildStack } from '../test/helpers/fixture';

// `npm run` starts every script in the package's own folder, so the current directory is
// the repository root — checked below before anything is deleted or written.
// see primer §4 (const)
const projectDir = process.cwd();
const manifestPath = path.join(projectDir, 'package.json');
if (fs.existsSync(manifestPath) === false) {
  console.error(`fixture: expected to run from the vscode-pr-cascade folder, but ${projectDir} has no package.json`);
  // A non-zero exit code is how a script tells npm (and a shell) that it failed.
  process.exit(1);
}

// The one place outside the repository this project writes to (plan §11.2): a sibling
// folder, so `${workspaceFolder}/../fixture-repo/repo` in launch.json finds it.
const fixtureDir = path.resolve(projectDir, '..', 'fixture-repo');

// A fixture is a throwaway: rebuilding from nothing is what makes a second run identical
// to the first, whatever was done to the last one in the dev host. The builder is the
// one the git tests use, pointed at a fixed directory instead of a temporary one:
// `../fixture-repo/repo` is the repository (three layers on `main`, HEAD on the top one)
// and `../fixture-repo/origin.git` its bare origin, so `origin/main` exists and trunk
// detection behaves as it does on a clone.
fs.rmSync(fixtureDir, { recursive: true, force: true });
const fixture = buildStack({ directory: fixtureDir });

// `git branch` with a format prints one name per line; the `*` marker and colours of the
// plain form would only confuse a log line.
const branchList = fixture.git(['branch', '--format=%(refname:short)']);
console.log(`fixture repository: ${fixture.dir}`);
console.log('branches:\n' + branchList);
console.log('Press F5 in VS Code ("Run Extension") to open it in the Extension Development Host.');
