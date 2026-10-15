/**
 * test/unit/track.test.ts — `GitSpiceBackend.track` as a specification: the `gs branch track`
 * commands bottom to top with their bases (plan §7.13.3), the layers it leaves alone (tracked,
 * git-spice's trunk, not enriched), its two guards before the first spawn — the
 * `refs/spice/data` question and step 1 of the probe — stopping at the first failure with
 * git-spice's own words, and the three sentences for a trunk it cannot hand to `--base`.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no git-spice, no VS Code). Depends on:
 * src/core/backends/gitspice.ts, test/helpers/fakeGit.ts, test/helpers/fakeCommand.ts. `enrich`,
 * which decides which layers are `null`, is test/unit/enrich.test.ts's. Plan: §7.13.3, §8 E56,
 * §9.4 `unit/track`, §10.1 item 20a, §13.2 D59, §13.4 (the `branch track` facts of 2026-10-08).
 */

// see primer §1 (import / export) and §9 (`import type`)
import { describe, expect, it } from 'vitest';
import { GitSpiceBackend, GS_ENV, PROBE_TIMEOUT_MS } from '../../src/core/backends/gitspice';
import type { CommandResult } from '../../src/core/command';
import type { GsLogEntry } from '../../src/core/gsLog';
import type { StackLayer } from '../../src/core/model';
import type { TrunkBranch } from '../../src/core/readinessFix';
import { exited, FakeCommandRunner, neverStarted, timedOut } from '../helpers/fakeCommand';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository every test asks about, the one git question `track` asks there, and the
// programs it may run (as the fakes key them: executable and arguments joined by spaces).
// see primer §4 (const) and §12 (template strings)
const ROOT = '/work/app';
const REF_ARGS = ['rev-parse', '--verify', '--quiet', 'refs/spice/data'];
const REF_KEY = REF_ARGS.join(' ');
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n';
const VERSION = 'git-spice --no-prompt --version';
const GS_VERSION = 'gs --no-prompt --version';
const BANNER = exited(0, 'git-spice 0.31.2\nCopyright (C) Abhinav Gupta\n');
const LOCAL: TrunkBranch = { kind: 'local', branch: 'main' };
const NONE: TrunkBranch = { kind: 'none' };

/** The fake's key for one `gs branch track`, and what git-spice prints when it works (stderr, exit 0 — verified 0.31.2). */
// see primer §3 (functions and type annotations)
function trackKey(name: string, base: string, executable: string = 'git-spice'): string {
  return `${executable} --no-prompt branch track ${name} --base ${base}`;
}

function tracked(name: string, base: string): CommandResult {
  return exited(0, '', `INF ${name}: tracking with base ${base}\n`);
}

/** The request the fake records for one `gs branch track`. */
function trackRequest(name: string, base: string, executable: string = 'git-spice'): object {
  return { executable, args: ['--no-prompt', 'branch', 'track', name, '--base', base], cwd: ROOT, env: GS_ENV, timeoutMs: PROBE_TIMEOUT_MS };
}

/** One layer as `enrich` leaves it: `tracking` as given, or no such key when it is `undefined`. */
// see primer §11 (optional `?` fields) and §13 (default parameters)
function layer(name: string, parent: string, tracking?: GsLogEntry | null): StackLayer {
  const built: StackLayer = { name, sha: `${name}-sha`, parent, parentSha: `${parent}-sha`, commitCount: 1, isCurrent: false };
  if (tracking !== undefined) {
    built.tracking = tracking;
  }
  return built;
}

/** The fixture's three layers, none of them known to git-spice. */
function untracked(): StackLayer[] {
  return [layer('api-refactor', 'origin/main', null), layer('add-retries', 'api-refactor', null), layer('retry-metrics', 'add-retries', null)];
}

/** The fakes and the backend over them; `tracks` cans each `gs branch track` (every one succeeds unless said otherwise). */
// see primer §9 (interface) and §30 (`??`)
interface Fakes {
  git: FakeGitRunner;
  commands: FakeCommandRunner;
  backend: GitSpiceBackend;
  programs: Map<string, CommandResult>;
}

function fakes(options: { ref?: string | Error; version?: CommandResult; gsPath?: string; tracks?: Map<string, CommandResult> } = {}): Fakes {
  const executable = options.gsPath ?? 'git-spice';
  const programs = new Map<string, CommandResult>([[`${executable} --no-prompt --version`, options.version ?? BANNER]]);
  const tracks =
    options.tracks ??
    new Map([
      [trackKey('api-refactor', 'main', executable), tracked('api-refactor', 'main')],
      [trackKey('add-retries', 'api-refactor', executable), tracked('add-retries', 'api-refactor')],
      [trackKey('retry-metrics', 'add-retries', executable), tracked('retry-metrics', 'add-retries')],
    ]);
  // see primer §22 (for ... of over a Map's pairs) and §54 (destructuring each pair by position)
  for (const [key, result] of tracks) {
    programs.set(key, result);
  }
  const git = new FakeGitRunner(new Map<string, string | Error>([[REF_KEY, options.ref ?? SHA]]));
  const commands = new FakeCommandRunner(programs);
  return { git, commands, programs, backend: new GitSpiceBackend(git, commands, options.gsPath ?? '') };
}

// see primer §5 (arrow functions) and §6 (async / await)
describe('GitSpiceBackend.track', () => {
  describe('which layers, with which base (plan §7.13.3)', () => {
    it('tracks every `null` layer bottom to top — the first on the trunk\'s local branch, each next on the one below — after one git question and one banner', async () => {
      // arrange
      const { backend, git, commands } = fakes();

      // act
      const result = await backend.track(ROOT, untracked(), LOCAL);

      // assert
      expect(result).toStrictEqual({ tracked: ['api-refactor', 'add-retries', 'retry-metrics'], problem: null });
      expect(git.calls).toStrictEqual([{ args: REF_ARGS, cwd: ROOT }]);
      expect(commands.calls).toStrictEqual([
        { executable: 'git-spice', args: ['--no-prompt', '--version'], cwd: ROOT, env: GS_ENV, timeoutMs: PROBE_TIMEOUT_MS },
        trackRequest('api-refactor', 'main'),
        trackRequest('add-retries', 'api-refactor'),
        trackRequest('retry-metrics', 'add-retries'),
      ]);
    });

    it('leaves a tracked layer alone — a second `track` would move its base — and never reads the trunk when the bottom is tracked', async () => {
      // arrange
      const { backend, commands } = fakes();
      const layers = [layer('api-refactor', 'origin/main', { name: 'api-refactor', down: { name: 'main', needsRestack: false } }), layer('add-retries', 'api-refactor', null), layer('retry-metrics', 'add-retries', null)];

      // act
      const result = await backend.track(ROOT, layers, NONE);

      // assert
      expect(result).toStrictEqual({ tracked: ['add-retries', 'retry-metrics'], problem: null });
      // see primer §25 (arrays: `slice`, `map`)
      expect(commands.calls.slice(1).map((call) => call.args)).toStrictEqual([
        ['--no-prompt', 'branch', 'track', 'add-retries', '--base', 'api-refactor'],
        ['--no-prompt', 'branch', 'track', 'retry-metrics', '--base', 'add-retries'],
      ]);
    });

    it("leaves git-spice's trunk line alone (a local main ahead of origin/main) and uses it as the base above it", async () => {
      // arrange: `gs branch track main --base main` would be refused — "cannot track trunk branch"
      const { backend, commands } = fakes({ tracks: new Map([[trackKey('a', 'main'), tracked('a', 'main')]]) });
      const layers = [layer('main', 'origin/main', { name: 'main' }), layer('a', 'main', null)];

      // act
      const result = await backend.track(ROOT, layers, NONE);

      // assert
      expect(result).toStrictEqual({ tracked: ['a'], problem: null });
      expect(commands.calls.slice(1).map((call) => call.args)).toStrictEqual([['--no-prompt', 'branch', 'track', 'a', '--base', 'main']]);
    });

    it('leaves a layer with no `tracking` at all alone (not enriched, or unknown) — and still names it as the base of the layer above', async () => {
      // arrange
      const { backend, commands } = fakes();
      const layers = [layer('api-refactor', 'origin/main', null), layer('add-retries', 'api-refactor'), layer('retry-metrics', 'add-retries', null)];

      // act
      const result = await backend.track(ROOT, layers, LOCAL);

      // assert
      expect(result).toStrictEqual({ tracked: ['api-refactor', 'retry-metrics'], problem: null });
      expect(commands.calls.slice(1).map((call) => call.args)).toStrictEqual([
        ['--no-prompt', 'branch', 'track', 'api-refactor', '--base', 'main'],
        ['--no-prompt', 'branch', 'track', 'retry-metrics', '--base', 'add-retries'],
      ]);
    });

    it('does nothing at all — no git, no program — when no layer is `null`', async () => {
      // arrange
      const { backend, git, commands } = fakes();
      const layers = [layer('api-refactor', 'origin/main', { name: 'api-refactor', down: { name: 'main', needsRestack: false } }), layer('add-retries', 'api-refactor')];

      // act
      const result = await backend.track(ROOT, layers, LOCAL);

      // assert
      expect(result).toStrictEqual({ tracked: [], problem: null });
      expect(git.calls).toStrictEqual([]);
      expect(commands.calls).toStrictEqual([]);
    });

    it('runs the executable prCascade.gsPath names', async () => {
      // arrange
      const { backend, commands } = fakes({ gsPath: '/opt/x/git-spice' });

      // act
      const result = await backend.track(ROOT, untracked(), LOCAL);

      // assert
      expect(result.problem).toBeNull();
      expect(commands.calls.map((call) => call.executable)).toStrictEqual(['/opt/x/git-spice', '/opt/x/git-spice', '/opt/x/git-spice', '/opt/x/git-spice']);
    });
  });

  describe('when git-spice says no', () => {
    it("stops at the first failure, keeps what it tracked before it, and quotes git-spice's FTL line", async () => {
      // arrange: the middle track fails as git-spice words it (verified 0.31.2)
      const { backend, commands, programs } = fakes();
      programs.set(trackKey('add-retries', 'api-refactor'), exited(1, '', 'FTL git-spice: track add-retries with base api-refactor: branch api-refactor is not tracked\n'));

      // act
      const result = await backend.track(ROOT, untracked(), LOCAL);

      // assert: the third track is never asked
      expect(result).toStrictEqual({
        tracked: ['api-refactor'],
        problem: 'git-spice could not track add-retries: FTL git-spice: track add-retries with base api-refactor: branch api-refactor is not tracked.',
      });
      expect(commands.calls.length).toBe(3);
    });

    it('quotes the FTL line past any INF lines before it, else the timeout, else the first line, the exit code, the start failure or Node\'s detail', async () => {
      // arrange: the first track fails each way in turn
      const failures: { name: string; result: CommandResult; phrase: string }[] = [
        { name: 'INF lines first', result: exited(1, '', 'INF x\nINF y\nFTL git-spice: boom\n'), phrase: 'FTL git-spice: boom' },
        { name: 'no FTL line', result: exited(1, '', 'something else\n'), phrase: 'something else' },
        { name: 'empty stderr', result: exited(1), phrase: 'exited 1' },
        { name: 'a timeout', result: timedOut(), phrase: 'timed out after 15000 ms' },
        {
          // The success line was printed, then git-spice hung: the kill is the story
          name: 'a timeout after some output',
          result: { ...timedOut(), stderr: 'INF api-refactor: tracking with base main\n' },
          phrase: 'timed out after 15000 ms',
        },
        { name: 'never started', result: neverStarted('not-executable'), phrase: 'could not start (not-executable)' },
        {
          name: 'a signal kill',
          result: { exitCode: null, stdout: '', stderr: '', startFailure: null, timedOut: false, detail: 'Command failed: git-spice --no-prompt branch track api-refactor --base main' },
          phrase: 'Command failed: git-spice --no-prompt branch track api-refactor --base main',
        },
        { name: 'no exit code and no detail', result: { exitCode: null, stdout: '', stderr: '', startFailure: null, timedOut: false }, phrase: 'no exit code' },
      ];
      // see primer §22 (for ... of)
      for (const failure of failures) {
        const { backend, commands, programs } = fakes();
        programs.set(trackKey('api-refactor', 'main'), failure.result);

        // act
        const result = await backend.track(ROOT, untracked(), LOCAL);

        // assert: a full sentence — the command shows it as it is
        expect(result, failure.name).toStrictEqual({ tracked: [], problem: `git-spice could not track api-refactor: ${failure.phrase}.` });
        expect(commands.calls.length, failure.name).toBe(2);
      }
    });
  });

  describe('the guards before the first spawn', () => {
    it('refuses with a sentence and runs no program when the repository is not initialised — `gs branch track` would try to initialise it', async () => {
      // arrange
      const { backend, git, commands } = fakes({ ref: new Error('exit 1') });

      // act
      const result = await backend.track(ROOT, untracked(), LOCAL);

      // assert
      expect(result).toStrictEqual({ tracked: [], problem: 'Nothing was tracked: the repository is not initialised for git-spice (no refs/spice/data).' });
      expect(git.calls).toStrictEqual([{ args: REF_ARGS, cwd: ROOT }]);
      expect(commands.calls).toStrictEqual([]);
    });

    it("says git-spice is missing, or too old, in the setup flow's words and tracks nothing", async () => {
      // arrange
      const missing = fakes({ version: neverStarted('not-found') });
      missing.programs.set(GS_VERSION, neverStarted('not-found'));
      const old = fakes({ version: exited(0, 'git-spice 0.30.0\n') });

      // act
      const missingResult = await missing.backend.track(ROOT, untracked(), LOCAL);
      const oldResult = await old.backend.track(ROOT, untracked(), LOCAL);

      // assert
      expect(missingResult).toStrictEqual({ tracked: [], problem: "Nothing was tracked: git-spice was not found in VS Code's PATH (tried git-spice, gs)." });
      expect(missing.commands.calls.map((call) => `${call.executable} ${call.args.join(' ')}`)).toStrictEqual([VERSION, GS_VERSION]);
      expect(oldResult).toStrictEqual({ tracked: [], problem: 'Nothing was tracked: git-spice 0.30.0 is older than 0.31.0, the oldest PR Cascade works with.' });
      expect(old.commands.calls.length).toBe(1);
    });
  });

  describe('a trunk that cannot be the base', () => {
    it('names the git command that would create the local branch when the trunk is only remote-tracking, and tracks nothing', async () => {
      // arrange
      const { backend, commands } = fakes();
      const trunk: TrunkBranch = { kind: 'missing', branch: 'main', trunk: 'origin/main' };

      // act
      const result = await backend.track(ROOT, untracked(), trunk);

      // assert: the banner was asked, no track was
      expect(result).toStrictEqual({
        tracked: [],
        problem: 'Tracking api-refactor needs trunk main as a local branch, and there is only origin/main. Run git branch main origin/main first.',
      });
      expect(commands.calls.length).toBe(1);
    });

    it('names the setting when the trunk is not a branch, or when none was found', async () => {
      // arrange
      const notABranch = fakes();
      const none = fakes();

      // act
      const notABranchResult = await notABranch.backend.track(ROOT, untracked(), { kind: 'not-a-branch', trunk: 'v1' });
      // `none` is unreachable from the command — trunkBranchFor answers it only for `trunk: null`,
      // which has no layers — but TrunkBranch has four members and each needs its sentence.
      const noneResult = await none.backend.track(ROOT, untracked(), NONE);

      // assert
      expect(notABranchResult).toStrictEqual({ tracked: [], problem: 'Tracking api-refactor needs a trunk branch, and v1 does not name one — set prCascade.trunk to a branch first.' });
      expect(noneResult).toStrictEqual({ tracked: [], problem: 'Tracking api-refactor needs a trunk branch, and none was found — set prCascade.trunk first.' });
    });

    it('quotes the branch names in the git command it names, as a shell would need them', async () => {
      // arrange: the quote sits in the trunk's names — the only words that reach shellCommandLine
      const { backend } = fakes();
      const trunk: TrunkBranch = { kind: 'missing', branch: "feat'x", trunk: "origin/feat'x" };

      // act
      const result = await backend.track(ROOT, untracked(), trunk);

      // assert
      expect(result.problem).toBe("Tracking api-refactor needs trunk feat'x as a local branch, and there is only origin/feat'x. Run git branch 'feat'\\''x' 'origin/feat'\\''x' first.");
    });
  });
});
