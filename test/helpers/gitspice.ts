/**
 * test/helpers/gitspice.ts — the real git-spice for the three test/git/gitspice*.git.test.ts files
 * (M5 item 22b): where it is (found once, synchronously, so `describe.skipIf` can read the answer
 * while Vitest collects a file), how to run it the way production does, a `.git` snapshot for the
 * plan §13.4 (k) pins, and the extension's load pipeline without VS Code so a RepoState is never
 * hand-built. No vitest import, as the fixture: tsconfig.ext.json compiles test/helpers too.
 *
 * Layer: test helper (plan §9.1 layer 2). Depends on: src/core (backends/gitspice, command, model,
 * readinessFix, stack, trunk), test/helpers/fixture.ts, Node built-ins. Depended on by:
 * test/git/gitspice.git.test.ts, test/git/gitspiceFacts.git.test.ts, test/git/gitspiceOps.git.test.ts.
 * Plan: §9.4, §9.6 (b), §13.2 D64, §13.4 (k).
 */

// see primer §1 (import / export), §9 (`import type`) and §28 (`spawnSync`: setup code that
// blocks, and answers with a result object rather than throwing)
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GitSpiceBackend, GS_CANDIDATES, GS_ENV, gitSpiceVersion, PROBE_TIMEOUT_MS } from '../../src/core/backends/gitspice';
import type { CommandResult, CommandRunner } from '../../src/core/command';
import type { GitRunner, RepoState } from '../../src/core/model';
import { trunkBranchFor } from '../../src/core/readinessFix';
import { computeStack } from '../../src/core/stack';
import { detectTrunk } from '../../src/core/trunk';
import type { Fixture } from './fixture';

/** The git-spice the suites run: the executable that answered as git-spice, and the version token it printed. */
export interface TestGitSpice {
  readonly executable: string;
  readonly version: string;
}

/**
 * `PRCASCADE_TEST_GS=<path>` points the suites at one build (a release candidate, an older version);
 * empty or unset means production's own candidates, `git-spice` then `gs`. Identity is the banner
 * (`gitSpiceVersion`), never the exit code — Ghostscript's `gs` answers `--version` with a bare
 * number (D56). `spawnSync` does not throw for ENOENT or a non-zero exit: the answer is in `error`
 * and `stdout`, and a candidate that is not there is simply the next one's turn.
 */
// see primer §30 (`??`) and §23 (`trim`)
const override = (process.env.PRCASCADE_TEST_GS ?? '').trim();

/** What the locator tries, in order — production's two names, or the one build `PRCASCADE_TEST_GS` points at. The require test's message lists exactly these. */
export const GS_TRIED: readonly string[] = override === '' ? GS_CANDIDATES : [override];

export function locateGitSpiceForTests(candidates: readonly string[] = GS_TRIED): TestGitSpice | null {
  // see primer §22 (for ... of, and continue)
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--no-prompt', '--version'], {
      encoding: 'utf8',
      env: { ...process.env, ...GS_ENV },
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (probe.error !== undefined) {
      continue;
    }
    const token = gitSpiceVersion(probe.stdout ?? '');
    if (token !== null) {
      return { executable: candidate, version: token };
    }
  }
  return null;
}

/** Found once per worker when this module loads; `null` is what every `describe.skipIf` reads. */
export const GIT_SPICE = locateGitSpiceForTests();

/** CI's promise (ci.yml sets it): a missing git-spice is a failing test there and a skip everywhere else. */
export const GIT_SPICE_REQUIRED = process.env.PRCASCADE_REQUIRE_GS === '1';

/** Inside a `describe.skipIf(GIT_SPICE === null)` block the locator cannot be null; this says so without a `!`. */
export function requireGitSpice(): TestGitSpice {
  if (GIT_SPICE === null) {
    throw new Error('git-spice is not installed — this helper is for tests inside describe.skipIf(GIT_SPICE === null)');
  }
  return GIT_SPICE;
}

/** The backend as src/extension.ts builds it: `prCascade.gsPath` empty unless the suite was pointed at a build. */
export function backendFor(git: GitRunner, commands: CommandRunner): GitSpiceBackend {
  return new GitSpiceBackend(git, commands, override);
}

/**
 * git-spice run directly, shaped exactly as production's private `gs()` spawns it — `--no-prompt`
 * first, `GS_ENV`, cwd = the root, the probe's timeout unless asked otherwise — so a fact pinned
 * through it is a fact about the spawn we make. `extraEnv` carries `GIT_EDITOR=true` on the two
 * `rebase continue` calls as the record of what production's own call will need (plan §7.13.3);
 * every file's hermetic block already pins it for every spawn, because git opens `vi` from any
 * git-spice command that commits without a message when `TERM` is set and no editor is.
 */
// see primer §16 (object literals: spreading two objects, the later wins)
export function runGitSpice(commands: CommandRunner, args: readonly string[], cwd: string, extraEnv: Record<string, string> = {}, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<CommandResult> {
  return commands.run({ executable: requireGitSpice().executable, args: ['--no-prompt', ...args], cwd, env: { ...GS_ENV, ...extraEnv }, timeoutMs });
}

/** stderr as trimmed, non-empty lines in order — what `describeResult` and `pushedBranches` read. */
// see primer §25 (arrays: `split`, `map`, `filter`)
export function stderrLines(result: CommandResult): string[] {
  return result.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** One `gs log --json` line, as parsed JSON: `name` is the one field every line has. */
// see primer §43 (an index signature: `[key: string]: unknown` — any other key, each holding anything; `readonly` covers them too)
export interface RawLogLine {
  readonly name: string;
  readonly [key: string]: unknown;
}

/** `gs log … --json` stdout by branch name — the lines are sorted by name, so nothing reads them by position. */
// see primer §19 (`new Map` from an array of pairs) and §50 (`JSON.parse`, and `as`: an assertion that checks nothing)
export function logLinesByName(stdout: string): Map<string, RawLogLine> {
  const lines = stdout
    .trim()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as RawLogLine);
  return new Map(lines.map((line) => [line.name, line]));
}

/** Every file under the git directory, keyed by its path relative to it, valued `size mtimeNs inode`. */
export type GitDirSnapshot = ReadonlyMap<string, string>;

/**
 * The plan §13.4 (k) instrument: a line per file under `.git` (found with `rev-parse --git-dir`, right
 * for a linked worktree too) made of its size, its modification time in nanoseconds and its inode —
 * `BigInt` stats so nothing is rounded. Two snapshots around one `gs log` and `changedPaths` of them
 * being `[]` is "it wrote nothing"; the tests read the ref digest beside it as a second instrument.
 */
// see primer §79 (`statSync(…, { bigint: true })` and `BigInt`) and §39 (a recursive `readdirSync` walk)
export function snapshotGitDir(fixture: Fixture): GitDirSnapshot {
  const gitDir = path.resolve(fixture.dir, fixture.git(['rev-parse', '--git-dir']).trim());
  const files = new Map<string, string>();
  for (const relative of filesUnder(gitDir)) {
    const stat = fs.statSync(path.join(gitDir, relative), { bigint: true });
    files.set(relative, `${stat.size} ${stat.mtimeNs} ${stat.ino}`);
  }
  return files;
}

/** The paths whose line differs, appeared or vanished between two snapshots — sorted, so `toStrictEqual([])` reads as "nothing changed". */
// see primer §21 (Set), §22 (for ... of over a Map's pairs) and §54 (destructuring each pair by position)
export function changedPaths(before: GitDirSnapshot, after: GitDirSnapshot): string[] {
  const changed = new Set<string>();
  for (const [file, line] of after) {
    if (before.get(file) !== line) {
      changed.add(file);
    }
  }
  for (const file of before.keys()) {
    if (!after.has(file)) {
      changed.add(file);
    }
  }
  return [...changed].sort();
}

/** Every regular file under `dir`, as paths relative to it, sorted; `[]` for a directory that does not exist (the stubbed HOME). */
// see primer §39 (`readdirSync(…, { withFileTypes: true })`: `Dirent`s, and a walk that calls itself)
export function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        found.push(path.relative(dir, full));
      }
    }
  };
  if (fs.existsSync(dir)) {
    walk(dir);
  }
  return found.sort();
}

/** src/extension.ts's `loadRepoState` without VS Code: trunk, then the stack. Throws for no trunk — every fixture here has `origin/main`. */
// see primer §6 (async / await)
export async function loadState(git: GitRunner, fixture: Fixture): Promise<RepoState> {
  const trunk = await detectTrunk(git, fixture.dir, { configured: '', remote: 'origin' });
  if (trunk === null) {
    throw new Error(`loadState: no trunk found in ${fixture.dir}`);
  }
  return computeStack(git, fixture.dir, trunk);
}

/**
 * The fixture initialised for git-spice and every layer tracked, through production's own steps —
 * `trunkBranchFor` for `--trunk`, `enrich` → `track` → `enrich` as item 20b's `trackIn` does — and
 * the enriched state back. Throws on anything but the happy path: this is arrangement, the tests
 * assert. gitspice.git.test.ts does these steps as its own tests; the other two files call this.
 */
export async function initAndTrack(backend: GitSpiceBackend, git: GitRunner, commands: CommandRunner, fixture: Fixture): Promise<RepoState> {
  const trunk = await detectTrunk(git, fixture.dir, { configured: '', remote: 'origin' });
  const trunkBranch = await trunkBranchFor(git, fixture.dir, trunk);
  if (trunkBranch.kind !== 'local') {
    throw new Error(`initAndTrack: the trunk has no local branch (${trunkBranch.kind})`);
  }
  const init = await runGitSpice(commands, ['repo', 'init', '--trunk', trunkBranch.branch, '--remote', 'origin'], fixture.dir);
  if (init.exitCode !== 0) {
    throw new Error(`initAndTrack: repo init exited ${init.exitCode}: ${init.stderr}`);
  }
  const state = await backend.enrich(await loadState(git, fixture));
  const tracked = await backend.track(fixture.dir, state.layers, trunkBranch);
  if (tracked.problem !== null) {
    throw new Error(`initAndTrack: ${tracked.problem}`);
  }
  // The one check that proves the arrangement took: every layer carries git-spice's entry. A
  // first enrich that failed quietly (nothing `null`, so nothing tracked) would otherwise hand
  // back a state the tests could not tell from a tracked one.
  // see primer §70 (`?.`) and §25 (arrays: `some`)
  const after = await backend.enrich(await loadState(git, fixture));
  if (after.enrichment?.kind !== 'enriched' || after.layers.some((layer) => layer.tracking === null || layer.tracking === undefined)) {
    throw new Error(`initAndTrack: not every layer is tracked after track (${JSON.stringify(after.enrichment)})`);
  }
  return after;
}
