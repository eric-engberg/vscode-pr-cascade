/**
 * test/git/gitspiceOps.git.test.ts — the operations M9 will drive, pinned as facts against the real
 * git-spice: a restack interrupted by a conflict (git's `rebase-merge` directory, the `ERR` remedy
 * lines, git-spice's own record, what `computeStack` sees), `rebase continue` and `rebase abort`
 * on git-spice's pause and on a plain git pause (the same remedy for both; only the upstack
 * differs), amending the bottom layer and `upstack restack` (E14), `branch create --below` (E49's
 * graph) and `branch onto`. `refs/spice/data:rebase-continue` is among the facts: plan §3 forbids
 * the *extension* reading it; the test reads it so a version that changes it fails here, not in a
 * user's window. Two fixtures: the pauses change the repository in ways the surgery must not see.
 * The plain pauses are made on the bottom layer because the fixture sets `rebase.updateRefs`, which
 * would move intermediate branches when a rebase of an upper layer finishes and muddy "the upstack
 * is not restacked"; and every trunk commit is pushed (`commitOnTrunk`), so a local trunk ahead of
 * `origin/main` never reads as a layer of its own.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git and real git-spice in a
 * throwaway directory, no VS Code, no network). Depends on: src/core/backends/gitspice.ts,
 * src/core/git.ts, src/core/command.ts, src/core/stack.ts, test/helpers/gitspice.ts,
 * test/helpers/fixture.ts. Plan: §10.1 item 22b, §7.12, §7.13.3 (`rebaseState`), §8
 * E12/E14/E48/E49, §9.4, §9.6, §12 item 7, §13.2 D50/D64.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GS_LOG_ARGS } from '../../src/core/backends/gitspice';
import type { GitSpiceBackend } from '../../src/core/backends/gitspice';
import { RealCommandRunner } from '../../src/core/command';
import { RealGitRunner } from '../../src/core/git';
import type { RepoState } from '../../src/core/model';
import { computeStack } from '../../src/core/stack';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';
import { backendFor, GIT_SPICE, initAndTrack, loadState, logLinesByName, runGitSpice, stderrLines } from '../helpers/gitspice';

const git = new RealGitRunner();
const commands = new RealCommandRunner();

// The hermetic block is gitspice.git.test.ts's, `GIT_EDITOR=true` included: `rebase continue`
// commits without a message, and git would open `vi` for it.
let homeDir: string;

// see primer §5 (arrow functions) and §6 (async / await)
beforeAll(async () => {
  homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-gitspice-ops-'));
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

/** The five `ERR` lines git-spice prints at a conflict, before its `FTL`: the remedy M9's banner will echo. */
const CONFLICT_REMEDY = ['ERR There was a conflict while rebasing.', 'ERR Resolve the conflict and run:', 'ERR   git-spice rebase continue', 'ERR Or abort the operation with:', 'ERR   git-spice rebase abort'];

/** The three lines a full restack from the bottom prints when only the upper two layers moved. */
const RESTACKED_UPSTACK = ['INF api-refactor: branch does not need to be restacked.', 'INF add-retries: restacked on api-refactor', 'INF retry-metrics: restacked on add-retries'];

/** `git patch-id --stable` of a ref's tip commit: the same for two commits that make the same change on different parents. */
// see primer §28 (`execFileSync` with `input`: the fixture's own `git()` takes no stdin)
function patchId(fixture: Fixture, ref: string): string {
  return execFileSync('git', ['patch-id', '--stable'], { cwd: fixture.dir, input: fixture.git(['show', '--format=', ref]), encoding: 'utf8' }).split(' ')[0];
}

/** The branch git is rebasing while a rebase is paused (`rebase-merge/head-name`), or `null` when none is. */
function rebaseHeadName(fixture: Fixture): string | null {
  const headName = path.join(path.resolve(fixture.dir, fixture.git(['rev-parse', '--git-path', 'rebase-merge']).trim()), 'head-name');
  return fs.existsSync(headName) ? fs.readFileSync(headName, 'utf8').trim() : null;
}

/** Where git-spice's data ref points: unchanged means git-spice wrote no record. */
function dataRefSha(fixture: Fixture): string {
  return fixture.git(['rev-parse', 'refs/spice/data']).trim();
}

/** git-spice's own record of an interrupted command, parsed; the test's business, never production's (plan §3). */
// see primer §50 (`JSON.parse`)
function continuation(fixture: Fixture): unknown {
  return JSON.parse(fixture.git(['show', 'refs/spice/data:rebase-continue']));
}

/** The names of the layers a state holds, bottom to top. */
function names(state: RepoState): string[] {
  return state.layers.map((layer) => layer.name);
}

/** A plain `git rebase` of the bottom layer onto trunk, left paused at its conflict — git's pause, not git-spice's. */
// see primer §18 (try / catch: a `catch` with no name for the error)
function pauseOnBottom(fixture: Fixture): void {
  fixture.git(['checkout', '-q', 'api-refactor']);
  try {
    fixture.git(['rebase', '-q', 'main']);
  } catch {
    // Expected: git exits 1 at the conflict and leaves the rebase paused.
  }
  expect(rebaseHeadName(fixture)).toBe('refs/heads/api-refactor');
}

// see primer §76 (describe.skipIf: a block decided when the file loads)
describe.skipIf(GIT_SPICE === null)(`git-spice ${GIT_SPICE?.version ?? ''} operations M9 will drive (offline; skipped when none is installed — README › Tests)`, () => {
  describe('a restack interrupted by a conflict, and the two kinds of pause (the E12 banner and M9 read these)', () => {
    let fixture: Fixture;
    let backend: GitSpiceBackend;

    beforeAll(async () => {
      fixture = buildStack();
      backend = backendFor(git, commands);
      await initAndTrack(backend, git, commands, fixture);
      // Trunk rewrites the bottom layer's file: replaying `api-refactor` on it is an add/add conflict.
      fixture.commitOnTrunk('a', 'a as trunk wrote it\n');
    });

    afterAll(() => {
      if (rebaseHeadName(fixture) !== null) {
        fixture.git(['rebase', '--abort']);
      }
      fixture.cleanup();
    });

    it('before any pause the data tree has no rebase-continue: git show exits 128, tryRun\'s null', async () => {
      // act
      const record = await git.tryRun(['show', 'refs/spice/data:rebase-continue'], fixture.dir);

      // assert
      expect(record).toBeNull();
    });

    it('stack restack exits 1 with the five ERR lines and the FTL; git\'s rebase-merge directory exists (D50\'s check says so); head-name names the layer being rebased; the data tree gained rebase-continue naming the command and the branch it was run from; no .git/spice', async () => {
      // act
      const result = await runGitSpice(commands, ['stack', 'restack'], fixture.dir);
      const state = await computeStack(git, fixture.dir, 'origin/main');

      // assert: the pause is git's, the record is git-spice's, and the view sees no layers (HEAD
      // is detached at trunk's tip — the first pick stopped)
      expect(result.exitCode).toBe(1);
      const lines = stderrLines(result);
      expect(lines.slice(0, 5)).toStrictEqual(CONFLICT_REMEDY);
      expect(lines[5]).toMatch(/^FTL git-spice: rebase of api-refactor interrupted by a conflict: exit status 1$/);
      expect(state.rebaseInProgress).toBe(true);
      expect(state.head).toBeNull();
      expect(state.layers).toStrictEqual([]);
      expect(rebaseHeadName(fixture)).toBe('refs/heads/api-refactor');
      expect(continuation(fixture)).toStrictEqual({ continuations: [{ command: ['stack', 'restack'], branch: 'retry-metrics' }] });
      expect(fs.existsSync(path.join(fixture.dir, '.git', 'spice'))).toBe(false);
    });

    it('during the pause: gs log exits 0 with no current line and the bottom still needsRestack; branch track works; backend.push sees no layers; rebase continue unresolved exits 1 with "more conflicts" and git\'s "needs merge" on stdout', async () => {
      // act
      const log = await runGitSpice(commands, GS_LOG_ARGS, fixture.dir);
      const track = await runGitSpice(commands, ['branch', 'track', 'retry-metrics', '--base', 'add-retries'], fixture.dir);
      const push = await backend.push(fixture.dir, (await backend.enrich(await loadState(git, fixture))).layers);
      const unresolved = await runGitSpice(commands, ['rebase', 'continue'], fixture.dir);

      // assert
      expect(log.exitCode).toBe(0);
      const byName = logLinesByName(log.stdout);
      expect([...byName.values()].some((line) => line.current === true)).toBe(false);
      expect(byName.get('api-refactor')?.down).toStrictEqual({ name: 'main', needsRestack: true });
      expect(track.exitCode).toBe(0);
      expect(push).toStrictEqual({ pushed: [], notes: [], problem: null });
      expect(unresolved.exitCode).toBe(1);
      expect(unresolved.stderr).toContain('ERR There are more conflicts to resolve.');
      expect(unresolved.stdout).toContain('needs merge');
    });

    it('resolve, then rebase continue (GIT_EDITOR=true): exit 0, the three INF lines, HEAD back on retry-metrics, continuations null, no needsRestack anywhere, rebaseInProgress false; continue and abort then say nothing is paused', async () => {
      // arrange
      fs.writeFileSync(path.join(fixture.dir, 'a'), 'resolved\n');
      fixture.git(['add', 'a']);

      // act: the explicit GIT_EDITOR is the record of what production's own call will need (§7.13.3)
      const result = await runGitSpice(commands, ['rebase', 'continue'], fixture.dir, { GIT_EDITOR: 'true' });
      const state = await backend.enrich(await loadState(git, fixture));
      const nothingToContinue = await runGitSpice(commands, ['rebase', 'continue'], fixture.dir);
      const nothingToAbort = await runGitSpice(commands, ['rebase', 'abort'], fixture.dir);

      // assert: the whole interrupted restack finishes, upstack included
      expect(result.exitCode).toBe(0);
      expect(stderrLines(result)).toStrictEqual(RESTACKED_UPSTACK);
      expect(fixture.git(['symbolic-ref', 'HEAD']).trim()).toBe('refs/heads/retry-metrics');
      expect(continuation(fixture)).toStrictEqual({ continuations: null });
      expect(state.layers.map((layer) => layer.tracking?.down?.needsRestack)).toStrictEqual([false, false, false]);
      expect(state.rebaseInProgress).toBe(false);
      expect(nothingToContinue.exitCode).toBe(1);
      expect(nothingToContinue.stderr.trim()).toBe('FTL git-spice: no rebase in progress');
      expect(nothingToAbort.exitCode).toBe(1);
      expect(nothingToAbort.stderr.trim()).toBe('FTL git-spice: no operation to abort');
    });

    it('a plain git rebase paused on the bottom layer: rebase-merge exists, head-name names it, continuations stays null (the discriminator); gs rebase abort exits 0, ends git\'s rebase, puts HEAD back and writes no data commit', async () => {
      // arrange: trunk rewrites `a` again, so the bottom layer conflicts again — git's own rebase this time
      fixture.commitOnTrunk('a', 'a as trunk wrote it again\n');
      const sha = dataRefSha(fixture);
      try {
        pauseOnBottom(fixture);
        const state = await computeStack(git, fixture.dir, 'origin/main');
        const log = await runGitSpice(commands, GS_LOG_ARGS, fixture.dir);

        // act
        const abort = await runGitSpice(commands, ['rebase', 'abort'], fixture.dir);

        // assert
        expect(state.rebaseInProgress).toBe(true);
        expect(continuation(fixture)).toStrictEqual({ continuations: null });
        expect(log.exitCode).toBe(0);
        expect(abort.exitCode).toBe(0);
        expect(abort.stderr).toBe('');
        expect(rebaseHeadName(fixture)).toBeNull();
        expect(fixture.git(['symbolic-ref', 'HEAD']).trim()).toBe('refs/heads/api-refactor');
        expect(dataRefSha(fixture)).toBe(sha);
      } finally {
        if (rebaseHeadName(fixture) !== null) {
          fixture.git(['rebase', '--abort']);
        }
        fixture.git(['checkout', '-q', 'retry-metrics']);
      }
    });

    it('a plain pause resolved with gs rebase continue (GIT_EDITOR=true): exit 0, HEAD back on the branch, no data commit of its own — the next gs log records the external restack, the upstack is not restacked until upstack restack is run', async () => {
      // arrange: the same conflict, paused again
      const sha = dataRefSha(fixture);
      try {
        pauseOnBottom(fixture);
        fs.writeFileSync(path.join(fixture.dir, 'a'), 'resolved again\n');
        fixture.git(['add', 'a']);

        // act
        const result = await runGitSpice(commands, ['rebase', 'continue'], fixture.dir, { GIT_EDITOR: 'true' });
        const headAfterContinue = fixture.git(['symbolic-ref', 'HEAD']).trim();
        const shaAfterContinue = dataRefSha(fixture);
        const log = await runGitSpice(commands, GS_LOG_ARGS, fixture.dir);
        const shaAfterLog = dataRefSha(fixture);
        const lastDataCommit = fixture.git(['log', '-1', '--format=%s', 'refs/spice/data']).trim();
        const restack = await runGitSpice(commands, ['upstack', 'restack'], fixture.dir);
        fixture.git(['checkout', '-q', 'retry-metrics']);
        const state = await backend.enrich(await loadState(git, fixture));

        // assert: git-spice finished git's rebase and wrote nothing of its own; the `gs log` that
        // follows notices the moved branch and records it ("restacked externally" — the one write
        // a read-only command makes, as the prune in gitspice.git.test.ts is); the layers above
        // waited for `upstack restack`
        expect(result.exitCode).toBe(0);
        expect(headAfterContinue).toBe('refs/heads/api-refactor');
        expect(rebaseHeadName(fixture)).toBeNull();
        expect(shaAfterContinue).toBe(sha);
        expect(logLinesByName(log.stdout).get('add-retries')?.down).toStrictEqual({ name: 'api-refactor', needsRestack: true });
        expect(shaAfterLog).not.toBe(sha);
        expect(lastDataCommit).toBe('api-refactor: branch was restacked externally');
        expect(restack.exitCode).toBe(0);
        expect(stderrLines(restack)).toStrictEqual(RESTACKED_UPSTACK);
        expect(state.layers.map((layer) => layer.tracking?.down?.needsRestack)).toStrictEqual([false, false, false]);
        expect(state.rebaseInProgress).toBe(false);
      } finally {
        if (rebaseHeadName(fixture) !== null) {
          fixture.git(['rebase', '--abort']);
        }
        fixture.git(['checkout', '-q', 'retry-metrics']);
      }
    });
  });

  describe('surgery: amend, insert below, move onto (E14, E49, §7.12)', () => {
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

    it('amend the bottom: the stack from HEAD drops it and gs log marks the middle needsRestack; upstack restack from the bottom restores three layers with the upper two patch-ids unchanged (E14)', async () => {
      // arrange
      const pidB = patchId(fixture, 'add-retries');
      const pidC = patchId(fixture, 'retry-metrics');
      fixture.amend('api-refactor', 'a', 'a amended\n');

      // act
      const amended = await backend.enrich(await loadState(git, fixture));
      fixture.git(['checkout', '-q', 'api-refactor']);
      const restack = await runGitSpice(commands, ['upstack', 'restack'], fixture.dir);
      fixture.git(['checkout', '-q', 'retry-metrics']);
      const restacked = await backend.enrich(await loadState(git, fixture));

      // assert
      expect(names(amended)).toStrictEqual(['add-retries', 'retry-metrics']);
      expect(amended.layers[0].tracking?.down).toStrictEqual({ name: 'api-refactor', needsRestack: true });
      expect(restack.exitCode).toBe(0);
      expect(stderrLines(restack)).toStrictEqual(RESTACKED_UPSTACK);
      expect(names(restacked)).toStrictEqual(['api-refactor', 'add-retries', 'retry-metrics']);
      expect(restacked.layers.map((layer) => layer.tracking?.down?.needsRestack)).toStrictEqual([false, false, false]);
      expect(patchId(fixture, 'add-retries')).toBe(pidB);
      expect(patchId(fixture, 'retry-metrics')).toBe(pidC);
      expect(fixture.git(['rev-parse', 'add-retries^']).trim()).toBe(fixture.git(['rev-parse', 'api-refactor']).trim());
    });

    it('branch create fix --below --no-commit from the middle, a commit, upstack restack: a ← fix ← b ← c; a\'s sha untouched; b and c patch-ids unchanged; bases follow (E49)', async () => {
      // arrange
      const shaA = fixture.git(['rev-parse', 'api-refactor']).trim();
      const pidB = patchId(fixture, 'add-retries');
      const pidC = patchId(fixture, 'retry-metrics');
      fixture.git(['checkout', '-q', 'add-retries']);

      // act
      const create = await runGitSpice(commands, ['branch', 'create', 'fix', '--below', '--no-commit'], fixture.dir);
      const headAfterCreate = fixture.git(['symbolic-ref', 'HEAD']).trim();
      const fixBeforeCommit = fixture.git(['rev-parse', 'fix']).trim();
      fs.writeFileSync(path.join(fixture.dir, 'fix'), 'fix\n');
      fixture.git(['add', 'fix']);
      fixture.git(['commit', '-q', '-m', 'fix']);
      const restack = await runGitSpice(commands, ['upstack', 'restack'], fixture.dir);
      fixture.git(['checkout', '-q', 'retry-metrics']);
      const state = await backend.enrich(await loadState(git, fixture));

      // assert
      expect(create.exitCode).toBe(0);
      expect(headAfterCreate).toBe('refs/heads/fix');
      expect(fixBeforeCommit).toBe(shaA);
      expect(restack.exitCode).toBe(0);
      expect(names(state)).toStrictEqual(['api-refactor', 'fix', 'add-retries', 'retry-metrics']);
      expect(state.layers.map((layer) => layer.tracking?.down?.name)).toStrictEqual(['main', 'api-refactor', 'fix', 'add-retries']);
      expect(fixture.git(['rev-parse', 'api-refactor']).trim()).toBe(shaA);
      expect(patchId(fixture, 'add-retries')).toBe(pidB);
      expect(patchId(fixture, 'retry-metrics')).toBe(pidC);
      expect(fixture.git(['rev-parse', 'add-retries^']).trim()).toBe(fixture.git(['rev-parse', 'fix']).trim());
    });

    it('branch onto main from the top: it leaves the stack; onto a missing branch and onto itself exit 1 with their FTL lines exact', async () => {
      // act
      const onto = await runGitSpice(commands, ['branch', 'onto', 'main'], fixture.dir);
      const state = await backend.enrich(await loadState(git, fixture));
      const missing = await runGitSpice(commands, ['branch', 'onto', 'zzz'], fixture.dir);
      const itself = await runGitSpice(commands, ['branch', 'onto', 'retry-metrics'], fixture.dir);

      // assert
      expect(onto.exitCode).toBe(0);
      expect(onto.stderr.trim()).toBe('INF retry-metrics: moved onto main');
      expect(names(state)).toStrictEqual(['retry-metrics']);
      expect(state.layers[0].tracking?.down).toStrictEqual({ name: 'main', needsRestack: false });
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr.trim()).toBe('FTL git-spice: lookup onto: resolve head: does not exist');
      expect(itself.exitCode).toBe(1);
      expect(itself.stderr.trim()).toBe('FTL git-spice: set base of branch retry-metrics to retry-metrics: would create a cycle: retry-metrics -> retry-metrics');
    });
  });
});
