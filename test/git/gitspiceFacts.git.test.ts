/**
 * test/git/gitspiceFacts.git.test.ts — git-spice itself, run directly through the spawn production
 * makes (`runGitSpice`), with its answers pinned so a version change fails loudly here and not in
 * a user's window: the test that makes a missing git-spice a failure on CI rather than a skip; the
 * exit-code table of plan §12 item 7 (every command measured exits 0 or 1 — usage errors are 1,
 * and only stderr tells "not initialised" from "conflict" from "nothing paused"); a command run
 * outside a repository; `repo init --trunk` of a missing branch (E59's terminal line); the
 * `<name>-2` rename a remote branch of the same name causes, and the predicate M7 item 26's guard
 * will read (D61, D64); and a push killed at its timeout with a slow pre-push hook — item 22a's
 * process-group kill measured against the real thing: the branch never lands (D63).
 *
 * Three inner describes, each with its own fixture, because two of them change the repository in
 * ways the others must not see. Skipped as a block when no git-spice is installed (README › Tests),
 * except the first test, which exists only under `PRCASCADE_REQUIRE_GS=1` — ci.yml sets it.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git and real git-spice in a
 * throwaway directory, no VS Code, no network). Depends on: src/core/backends/gitspice.ts,
 * src/core/git.ts, src/core/command.ts, test/helpers/gitspice.ts, test/helpers/fixture.ts. Plan:
 * §10.1 item 22b, §7.13, §7.13.3, §8 E59/E76, §9.4, §9.5, §9.6 (b), §12 item 7, §13.2 D61/D63/D64.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GS_LOG_ARGS, GS_SUBMIT_ARGS } from '../../src/core/backends/gitspice';
import type { GitSpiceBackend } from '../../src/core/backends/gitspice';
import { RealCommandRunner } from '../../src/core/command';
import { RealGitRunner } from '../../src/core/git';
import type { RepoState } from '../../src/core/model';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';
import { backendFor, GIT_SPICE, GIT_SPICE_REQUIRED, GS_TRIED, initAndTrack, runGitSpice, stderrLines } from '../helpers/gitspice';

const git = new RealGitRunner();
const commands = new RealCommandRunner();

// HOME and the XDG directories for the whole file; the hermetic block is gitspice.git.test.ts's,
// `GIT_EDITOR=true` included — the `branch create` row below commits with nothing staged, which
// would otherwise open `vi`.
let homeDir: string;

// see primer §5 (arrow functions) and §6 (async / await)
beforeAll(async () => {
  homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-gitspice-facts-'));
  vi.stubEnv('HOME', homeDir);
  vi.stubEnv('XDG_CONFIG_HOME', path.join(homeDir, '.config'));
  vi.stubEnv('XDG_DATA_HOME', path.join(homeDir, '.local', 'share'));
  vi.stubEnv('XDG_STATE_HOME', path.join(homeDir, '.local', 'state'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_EDITOR', 'true');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.promises.rm(homeDir, { recursive: true, force: true });
});

/** The origin's branch heads, as sorted ref names. */
function originHeads(fixture: Fixture): string[] {
  return fixture
    .git(['ls-remote', '--heads', 'origin'])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\t')[1])
    .sort();
}

// see primer §15 (new Promise) and §58 (setTimeout)
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('git-spice on this machine', () => {
  // see primer §76 (it.runIf: a test that exists only under a condition decided when the file loads; `expect(value, message)`)
  it.runIf(GIT_SPICE_REQUIRED)('is installed — PRCASCADE_REQUIRE_GS=1 makes a missing git-spice a failure, not a skip', () => {
    // assert: what the locator tried, so the failure names the names (not always the two defaults)
    expect(GIT_SPICE, `git-spice not found (tried ${GS_TRIED.join(', ')})`).not.toBeNull();
  });
});

// see primer §76 (describe.skipIf: a block decided when the file loads)
describe.skipIf(GIT_SPICE === null)(`git-spice ${GIT_SPICE?.version ?? ''} run directly (offline; skipped when none is installed — README › Tests)`, () => {
  describe('exit codes: every command measured exits 0 or 1 — usage errors are 1, and only stderr tells "not initialised" from "conflict" (§12 item 7)', () => {
    let fixture: Fixture;
    let backend: GitSpiceBackend;

    beforeAll(async () => {
      fixture = buildStack();
      backend = backendFor(git, commands);
      await initAndTrack(backend, git, commands, fixture);
    });

    afterAll(() => {
      fixture.cleanup();
    });

    // One row per command: its arguments, the exit code measured on 0.31.2 and 0.32.0, and the
    // one stderr line that names the outcome (anchored to a line, so a prefix or a second line
    // cannot pass). Only rows production reads or M9 will, and only ones that leave the fixture
    // as they found it.
    // see primer §78 (it.each: a table of tests, `%s` filled from the first column)
    const rows: [string, string[], number, RegExp][] = [
      ['an unknown command', ['nonsense'], 1, /^FTL git-spice: unexpected argument nonsense$/m],
      ['an unknown flag', ['log', 'short', '--bogus'], 1, /^FTL git-spice: unknown flag --bogus$/m],
      ['track of a branch that does not exist', ['branch', 'track', 'zzz', '--base', 'main'], 1, /^FTL git-spice: branch "zzz" does not exist$/m],
      ['track with a base that does not exist', ['branch', 'track', 'retry-metrics', '--base', 'zzz'], 1, /^FTL git-spice: peel to commit: does not exist$/m],
      ['track of the trunk itself', ['branch', 'track', 'main', '--base', 'main'], 1, /^FTL git-spice: cannot track trunk branch$/m],
      ['track again with the same base is idempotent', ['branch', 'track', 'api-refactor', '--base', 'main'], 0, /^INF api-refactor: tracking with base main$/m],
      ['rebase continue with nothing paused', ['rebase', 'continue'], 1, /^FTL git-spice: no rebase in progress$/m],
      ['rebase abort with nothing paused', ['rebase', 'abort'], 1, /^FTL git-spice: no operation to abort$/m],
      ['stack restack with nothing to do', ['stack', 'restack'], 0, /^INF api-refactor: branch does not need to be restacked\.$/m],
      ['stack submit --no-publish --dry-run pushes nothing and exits 0', ['stack', 'submit', '--no-publish', '--dry-run'], 0, /^INF WOULD push branch api-refactor$/m],
      // The first stderr line here belongs to the environment, not to git-spice — `Aborting
      // commit due to empty commit message.` under GIT_EDITOR=true, `error: Terminal is dumb,
      // but EDITOR unset` with no TERM — so only the FTL line is pinned.
      ['branch create with nothing staged', ['branch', 'create', 'empty-one'], 1, /^FTL git-spice: commit: commit: exit status 1$/m],
    ];

    it.each(rows)('%s', async (_label, args, exit, line) => {
      // act
      const result = await runGitSpice(commands, args, fixture.dir);

      // assert: the code, the line, and the whole table's rule
      expect(result.exitCode).toBe(exit);
      expect(result.stderr).toMatch(line);
      expect([0, 1]).toContain(result.exitCode);
    });

    it('outside a repository: exit 1 and the bare "FTL git-spice: exit status 128"', async () => {
      // act: the stubbed HOME is a directory that is not a repository
      const result = await runGitSpice(commands, GS_LOG_ARGS, homeDir);

      // assert: git's own exit code, relayed and nothing more
      expect(result.exitCode).toBe(1);
      expect(result.stderr.trim()).toBe('FTL git-spice: exit status 128');
    });

    it('repo init --trunk of a missing branch: exit 1, "not a branch: nope" (E59\'s terminal line), the existing init untouched', async () => {
      // act
      const result = await runGitSpice(commands, ['repo', 'init', '--trunk', 'nope', '--remote', 'origin'], fixture.dir);

      // assert
      expect(result.exitCode).toBe(1);
      const lines = stderrLines(result);
      expect(lines[lines.length - 1]).toBe('FTL git-spice: not a branch: nope');
      expect(fixture.git(['rev-parse', '--verify', '--quiet', 'refs/spice/data']).trim()).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe('a remote branch of the same name with no upstream here (the <name>-2 rename, D61; item 26\'s guard)', () => {
    let fixture: Fixture;
    let backend: GitSpiceBackend;
    let state: RepoState;

    beforeAll(async () => {
      fixture = buildStack();
      backend = backendFor(git, commands);
      // The remote already has `api-refactor` — pushed once by hand, without `-u`, so no upstream
      // is recorded here — before git-spice knows the branch.
      fixture.git(['push', '-q', 'origin', 'api-refactor']);
      state = await initAndTrack(backend, git, commands, fixture);
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('before any submit no tracked layer has a push field — tracking.push absent means no upstream configured, whatever the remote holds', () => {
      // assert: the predicate item 26's guard will read beside the digest's refs/remotes line
      expect(state.layers.map((layer) => layer.tracking?.push)).toStrictEqual([undefined, undefined, undefined]);
    });

    it('backend.push pushes all three, says the rename in exactly two notes, and sets the upstream to api-refactor-2', async () => {
      // act
      const result = await backend.push(fixture.dir, state.layers);

      // assert: non-destructive, said in two INF lines only — surfaced by item 21b's Output panel, not guarded (D61)
      expect(result.pushed).toStrictEqual(['api-refactor', 'add-retries', 'retry-metrics']);
      expect(result.notes).toStrictEqual(["INF api-refactor: Branch name already in use in remote 'origin'", "INF api-refactor: Using upstream name 'api-refactor-2' instead"]);
      expect(result.problem).toBeNull();
      expect(fixture.git(['config', '--get', 'branch.api-refactor.merge']).trim()).toBe('refs/heads/api-refactor-2');
      const heads = originHeads(fixture);
      expect(heads).toContain('refs/heads/api-refactor');
      expect(heads).toContain('refs/heads/api-refactor-2');
    });
  });

  describe('a push killed at its timeout with a slow pre-push hook (§9.6 (b); item 22a\'s kill measured)', () => {
    let fixture: Fixture;

    beforeAll(async () => {
      fixture = buildStack();
      await initAndTrack(backendFor(git, commands), git, commands, fixture);
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('the group is killed: the origin never gets the branch, no upstream is recorded, the hook never finishes, and the next push lands every branch under its own name', async () => {
      // arrange: a pre-push hook that runs Node for three seconds (Node is the one program the
      // tests already have; no `sleep`), logging where it got to
      const log = path.join(path.dirname(fixture.dir), 'hook.log');
      const hook = fixture.addHook('pre-push', `#!/bin/sh\necho "hook start $$" >> "${log}"\n"${process.execPath}" -e "setTimeout(() => {}, 3000)"\necho "hook end" >> "${log}"\nexit 0\n`);
      const started = Date.now();

      // act: a 1.5 s limit against a 3 s hook
      const result = await runGitSpice(commands, GS_SUBMIT_ARGS, fixture.dir, {}, 1_500);
      const elapsed = Date.now() - started;
      const headsAtReturn = originHeads(fixture);
      await sleep(3_000);
      const headsLater = originHeads(fixture);
      const logLines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter((line) => line !== '') : [];
      // read before the second push, which sets every upstream; `git config --get` exits 1 for a
      // missing key, and the fixture's `git()` throws on a non-zero exit
      // see primer §18 (try / catch: a `catch` with no name for the error)
      let upstreamAfterKill: string | null;
      try {
        upstreamAfterKill = fixture.git(['config', '--get', 'branch.api-refactor.merge']).trim();
      } catch {
        upstreamAfterKill = null;
      }
      fs.rmSync(hook);
      const again = await runGitSpice(commands, GS_SUBMIT_ARGS, fixture.dir, {}, 60_000);

      // assert: the kill, and what it left — nothing on the remote, nothing in config, a hook
      // that never reached its end; then a clean push under the original names
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
      expect(result.detail).toBe('timed out after 1500 ms');
      expect(elapsed).toBeLessThan(3_000);
      expect(headsAtReturn).not.toContain('refs/heads/api-refactor');
      expect(headsLater).not.toContain('refs/heads/api-refactor');
      expect(logLines.length).toBeLessThanOrEqual(1);
      for (const line of logLines) {
        expect(line).toMatch(/^hook start \d+$/);
      }
      expect(upstreamAfterKill).toBeNull();
      expect(again.exitCode).toBe(0);
      expect(stderrLines(again)).toStrictEqual(['INF Pushed api-refactor', 'INF Pushed add-retries', 'INF Pushed retry-metrics']);
      expect(fixture.git(['config', '--get', 'branch.api-refactor.merge']).trim()).toBe('refs/heads/api-refactor');
    });
  });
});
