/**
 * test/git/gitspice.git.test.ts — GitSpiceBackend against the real git-spice, offline: the plan
 * §9.6 (b) contract rows, run through `RealGitRunner` and `RealCommandRunner` on the fixture
 * with its bare origin — readiness before and after `repo init`, enrich on an uninitialised
 * repository (no spawn) and after, track bottom to top and the raw `gs log` lines by name, the
 * plan §13.4 (k) pin (three `gs log` forms change nothing under `.git`), the memo, push (the
 * origin's heads, the upstreams, `push {0, 0, false}`), a detached push, a pushed trunk commit
 * and the restack refusal, the second (k) pin (a deleted branch pruned: `refs/spice/data` and
 * objects only) and an empty HOME at the end. The unit tests pin what the backend spawns and how
 * it reads the answers; this file checks that real git-spice gives the answers they assume.
 *
 * One fixture for the whole file, because the rows are one story — fresh → initialised → tracked
 * → pushed → trunk moved → pruned — and each `it` leaves the repository where the next expects it
 * (the opposite of stack.git.test.ts, whose fixtures are independent). Skipped as a block when no
 * git-spice is installed (README › Tests); CI installs one and sets `PRCASCADE_REQUIRE_GS`, which
 * gitspiceFacts.git.test.ts turns into a failure there.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git and real git-spice in a
 * throwaway directory, no VS Code, no network). Depends on: src/core/backends/gitspice.ts,
 * src/core/digest.ts, src/core/git.ts, src/core/command.ts, src/core/readinessFix.ts,
 * test/helpers/gitspice.ts, test/helpers/fixture.ts. Plan: §10.1 item 22b, §7.6, §7.8, §7.13.2,
 * §7.13.3, §8 E3/E21/E56/E59/E76/E83, §9.4, §9.6, §13.2 D59/D61/D64, §13.4 (k).
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GS_LOG_ARGS } from '../../src/core/backends/gitspice';
import type { GitSpiceBackend } from '../../src/core/backends/gitspice';
import { RealCommandRunner } from '../../src/core/command';
import { isInitialised, readRefDigest } from '../../src/core/digest';
import { RealGitRunner } from '../../src/core/git';
import type { GsLogEntry } from '../../src/core/gsLog';
import type { RepoState } from '../../src/core/model';
import { trunkBranchFor } from '../../src/core/readinessFix';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';
import { backendFor, changedPaths, filesUnder, GIT_SPICE, loadState, logLinesByName, requireGitSpice, runGitSpice, snapshotGitDir, stderrLines } from '../helpers/gitspice';

// The runners under test spawn git and git-spice with process.env, so the hermetic variables are
// stubbed on process.env for the whole file (stack.git.test.ts's pattern). `fixture.git(...)`,
// seen beside them, is the fixture builder's synchronous helper with its own environment.
const git = new RealGitRunner();
const commands = new RealCommandRunner();

// A throwaway directory that stands in for HOME and the three XDG directories git-spice could
// write under: the last test asserts it is still empty. Removed in afterAll.
let homeDir: string;
let fixture: Fixture;
let backend: GitSpiceBackend;

// see primer §5 (arrow functions) and §6 (async / await)
beforeAll(async () => {
  homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-gitspice-test-'));
  vi.stubEnv('HOME', homeDir);
  vi.stubEnv('XDG_CONFIG_HOME', path.join(homeDir, '.config'));
  vi.stubEnv('XDG_DATA_HOME', path.join(homeDir, '.local', 'share'));
  vi.stubEnv('XDG_STATE_HOME', path.join(homeDir, '.local', 'state'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  // git opens an editor from any git-spice command that commits without a message (`rebase
  // continue`, `branch create` with nothing staged) when TERM is set and no editor variable is
  // — `vi`, which sits until the runner's 15 s kill. Pinned here for every spawn; no identity
  // variables, because the fixture's repository config serves git-spice's data commits too (the
  // last test shows HOME stayed empty).
  vi.stubEnv('GIT_EDITOR', 'true');
  fixture = buildStack();
  backend = backendFor(git, commands);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  fixture.cleanup();
  await fs.promises.rm(homeDir, { recursive: true, force: true });
});

/** The three layer names the fixture builds, bottom to top. */
const LAYERS = ['api-refactor', 'add-retries', 'retry-metrics'];

/** The `tracking` of every layer, bottom to top — `undefined` for a layer never enriched, `null` for one git-spice does not track. */
// see primer §25 (arrays: `map`) and §10 (union types: the three things a `tracking` can be)
function trackingOf(state: RepoState): (GsLogEntry | null | undefined)[] {
  return state.layers.map((layer) => layer.tracking);
}

/** The origin's branch heads, as sorted ref names: what a push changed. */
function originHeads(): string[] {
  return fixture
    .git(['ls-remote', '--heads', 'origin'])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\t')[1])
    .sort();
}

// see primer §76 (describe.skipIf: a block decided when the file loads), §70 (`?.`) and §30 (`??`): no version to name when none is installed
describe.skipIf(GIT_SPICE === null)(`GitSpiceBackend against real git-spice ${GIT_SPICE?.version ?? ''} (offline, bare origin; skipped when none is installed — README › Tests)`, () => {
  // The state the story carries from one `it` to the next: the last enriched RepoState.
  let enriched: RepoState;

  it('readiness: not-initialized before repo init — the real banner read by the real locator', async () => {
    // act
    const answer = await backend.readiness(fixture.dir, 'origin');

    // assert
    expect(answer).toStrictEqual({ kind: 'not-initialized', gsPath: requireGitSpice().executable });
  });

  it('enrich before init: not-enriched / not-initialised with the one phrase, and no layer carries tracking', async () => {
    // act
    const state = await backend.enrich(await loadState(git, fixture));

    // assert: the §7.6 gate — nothing was spawned, nothing is known
    expect(state.enrichment).toStrictEqual({ kind: 'not-enriched', cause: 'not-initialised', reason: 'the repository is not initialised for git-spice (no refs/spice/data)' });
    // see primer §51 (`in`: whether an object has the key at all)
    expect(state.layers.every((layer) => !('tracking' in layer))).toBe(true);
  });

  it('gs log on an uninitialised repository exits 1 at the trunk prompt and writes nothing under .git (the §7.6 gate\'s reason)', async () => {
    // arrange
    const before = snapshotGitDir(fixture);

    // act
    const result = await runGitSpice(commands, GS_LOG_ARGS, fixture.dir);

    // assert: git-spice tries to initialise, cannot prompt, dies — and leaves no trace
    const lines = stderrLines(result);
    expect(result.exitCode).toBe(1);
    expect(lines[0]).toBe('INF Repository not initialized. Initializing.');
    expect(lines[lines.length - 1]).toMatch(/^FTL git-spice: .*not allowed to prompt for input$/);
    expect(changedPaths(before, snapshotGitDir(fixture))).toStrictEqual([]);
  });

  it('repo init adds exactly the refs/spice/data line to the digest and isInitialised flips; a second init is idempotent', async () => {
    // arrange
    const before = await readRefDigest(git, fixture.dir);
    expect(isInitialised(before)).toBe(false);

    // act
    const result = await runGitSpice(commands, ['repo', 'init', '--trunk', 'main', '--remote', 'origin'], fixture.dir);
    const after = await readRefDigest(git, fixture.dir);
    const again = await runGitSpice(commands, ['repo', 'init', '--trunk', 'main', '--remote', 'origin'], fixture.dir);

    // assert
    expect(result.exitCode).toBe(0);
    const lines = stderrLines(result);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('INF Using remote: origin');
    expect(lines[1]).toMatch(/^INF Initialized repository\s+trunk=main$/);
    expect(isInitialised(after)).toBe(true);
    // `for-each-ref` sorts by name and refs/spice sorts last, so the new line is appended — and
    // it is the only one
    expect(after.startsWith(before)).toBe(true);
    const added = after.slice(before.length).split('\n').filter((line) => line !== '');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^refs\/spice\/data [0-9a-f]{40}$/);
    expect(again.exitCode).toBe(0);
    expect(await readRefDigest(git, fixture.dir)).toBe(after);
  });

  it('readiness after init runs on to detectForge: remote-unparseable for the bare origin (E21)', async () => {
    // act
    const answer = await backend.readiness(fixture.dir, 'origin');

    // assert: a local path names no forge, which is the state every fixture here is in
    expect(answer.kind).toBe('remote-unparseable');
    if (answer.kind === 'remote-unparseable') {
      expect(answer.remote).toBe('origin');
      expect(answer.url.endsWith('origin.git')).toBe(true);
    }
  });

  it('enrich after init: every layer null, ranGsLog true, the trunk line is no layer', async () => {
    // act
    enriched = await backend.enrich(await loadState(git, fixture));

    // assert: a complete answer that lists only trunk — every layer is "not tracked" (E56); the digest's
    // remote-tracking names are origin's HEAD and main (item 23b)
    expect(enriched.enrichment).toStrictEqual({
      kind: 'enriched',
      ranGsLog: true,
      malformed: [],
      byName: new Map([['main', { name: 'main' }]]),
      complete: true,
      remoteBranches: new Set(['HEAD', 'main']),
    });
    expect(trackingOf(enriched)).toStrictEqual([null, null, null]);
  });

  it('track: three branch track calls bottom to top with main as the first base; enrich then shows the bases and no needsRestack', async () => {
    // arrange: the trunk's local branch, asked the way the setup flow asks it
    const trunkBranch = await trunkBranchFor(git, fixture.dir, enriched.trunk);
    expect(trunkBranch).toStrictEqual({ kind: 'local', branch: 'main' });

    // act
    const tracked = await backend.track(fixture.dir, enriched.layers, trunkBranch);
    enriched = await backend.enrich(await loadState(git, fixture));

    // assert
    expect(tracked).toStrictEqual({ tracked: LAYERS, problem: null });
    expect(enriched.layers.map((layer) => layer.tracking?.down)).toStrictEqual([
      { name: 'main', needsRestack: false },
      { name: 'api-refactor', needsRestack: false },
      { name: 'add-retries', needsRestack: false },
    ]);
  });

  it('the raw gs log lines: one per tracked branch plus trunk, sorted by name — three exact objects (§7.13.2)', async () => {
    // act
    const result = await runGitSpice(commands, GS_LOG_ARGS, fixture.dir);

    // assert: the order is alphabetical, not the stack's — the one fact every reader of these
    // lines must not assume away (production maps them by name, D59)
    expect(result.exitCode).toBe(0);
    const byName = logLinesByName(result.stdout);
    expect([...byName.keys()]).toStrictEqual(['add-retries', 'api-refactor', 'main', 'retry-metrics']);
    expect(byName.get('main')).toStrictEqual({ name: 'main', ups: [{ name: 'api-refactor' }] });
    expect(byName.get('api-refactor')).toStrictEqual({ name: 'api-refactor', down: { name: 'main' }, ups: [{ name: 'add-retries' }] });
    expect(byName.get('retry-metrics')).toStrictEqual({ name: 'retry-metrics', current: true, down: { name: 'add-retries' } });
  });

  it('track again: nothing to do and no spawn', async () => {
    // act: every layer carries an entry, so there is nothing `null` to adopt
    const tracked = await backend.track(fixture.dir, enriched.layers, { kind: 'local', branch: 'main' });

    // assert
    expect(tracked).toStrictEqual({ tracked: [], problem: null });
  });

  it('(k) pin: log short --all --json, with --cr-status, and log long change no file under .git and leave the digest byte-identical', async () => {
    // arrange: the snapshot sees every file (size, mtime in ns, inode); the digest is the second
    // instrument, the one production reads
    const digestBefore = await readRefDigest(git, fixture.dir);
    const forms = [GS_LOG_ARGS, [...GS_LOG_ARGS, '--cr-status'], ['log', 'long', '--all', '--json']];

    // act + assert, one form at a time
    // see primer §22 (for ... of) and §76 (expect(value, message): the second argument becomes the failure's message)
    for (const args of forms) {
      const before = snapshotGitDir(fixture);
      expect(before.size).toBeGreaterThan(10);
      const result = await runGitSpice(commands, args, fixture.dir);
      expect(result.exitCode, `exit of ${args.join(' ')}`).toBe(0);
      expect(changedPaths(before, snapshotGitDir(fixture)), `files changed by ${args.join(' ')}`).toStrictEqual([]);
      expect(await readRefDigest(git, fixture.dir)).toBe(digestBefore);
    }
  });

  it('enrich memo: the same digest → ranGsLog false', async () => {
    // act
    enriched = await backend.enrich(await loadState(git, fixture));

    // assert: the whole tracked answer remembered by name, nothing pushed yet
    expect(enriched.enrichment).toStrictEqual({
      kind: 'enriched',
      ranGsLog: false,
      malformed: [],
      byName: new Map([
        ['main', { name: 'main' }],
        ['api-refactor', { name: 'api-refactor', down: { name: 'main', needsRestack: false } }],
        ['add-retries', { name: 'add-retries', down: { name: 'api-refactor', needsRestack: false } }],
        ['retry-metrics', { name: 'retry-metrics', down: { name: 'add-retries', needsRestack: false } }],
      ]),
      complete: true,
      remoteBranches: new Set(['HEAD', 'main']),
    });
  });

  it('push: the origin gains every layer, upstreams are set, pushed is the three names in git-spice\'s order, notes empty; pushing again says the same three; gs log then shows push {0, 0, false}', async () => {
    // arrange
    expect(originHeads()).toStrictEqual(['refs/heads/main']);

    // act
    const result = await backend.push(fixture.dir, enriched.layers);
    const again = await backend.push(fixture.dir, enriched.layers);
    enriched = await backend.enrich(await loadState(git, fixture));

    // assert
    expect(result).toStrictEqual({ pushed: LAYERS, notes: [], problem: null });
    expect(originHeads()).toStrictEqual(['refs/heads/add-retries', 'refs/heads/api-refactor', 'refs/heads/main', 'refs/heads/retry-metrics']);
    expect(fixture.git(['config', '--get', 'branch.add-retries.merge']).trim()).toBe('refs/heads/add-retries');
    expect(fixture.git(['config', '--get', 'branch.add-retries.remote']).trim()).toBe('origin');
    expect(again).toStrictEqual({ pushed: LAYERS, notes: [], problem: null });
    expect(enriched.layers.map((layer) => layer.tracking?.push)).toStrictEqual([
      { ahead: 0, behind: 0, needsPush: false },
      { ahead: 0, behind: 0, needsPush: false },
      { ahead: 0, behind: 0, needsPush: false },
    ]);
  });

  it('push from a detached HEAD: git-spice refuses and the sentence quotes its FTL line (E3)', async () => {
    // arrange
    fixture.detach();
    try {
      // act
      const result = await backend.push(fixture.dir, enriched.layers);

      // assert: `stack submit` acts on HEAD's branch, and there is none
      expect(result.pushed).toStrictEqual([]);
      expect(result.problem).toBe('git-spice could not push the stack: FTL git-spice: get current branch: in detached HEAD state.');
    } finally {
      fixture.git(['checkout', '-q', 'retry-metrics']);
    }
  });

  it('a commit on trunk marks the bottom layer needsRestack; push refuses before the submit; stack restack clears it', async () => {
    // arrange: a pushed trunk commit, so `origin/main` moves with it and the stack stays three layers
    fixture.commitOnTrunk('trunk-note', 'note\n');
    enriched = await backend.enrich(await loadState(git, fixture));
    expect(enriched.layers.map((layer) => layer.tracking?.down)).toStrictEqual([
      { name: 'main', needsRestack: true },
      { name: 'api-refactor', needsRestack: false },
      { name: 'add-retries', needsRestack: false },
    ]);
    const headsBefore = originHeads();

    // act
    const refused = await backend.push(fixture.dir, enriched.layers);
    const restack = await runGitSpice(commands, ['stack', 'restack'], fixture.dir);
    enriched = await backend.enrich(await loadState(git, fixture));

    // assert
    expect(enriched.layers).toHaveLength(3);
    expect(refused.pushed).toStrictEqual([]);
    expect(refused.problem).toMatch(/^Nothing was pushed: api-refactor needs a restack\. Run .* stack restack in a terminal first\.$/);
    expect(originHeads()).toStrictEqual(headsBefore);
    expect(restack.exitCode).toBe(0);
    expect(stderrLines(restack)).toStrictEqual(['INF api-refactor: restacked on main', 'INF add-retries: restacked on api-refactor', 'INF retry-metrics: restacked on add-retries']);
    expect(enriched.layers.map((layer) => layer.tracking?.down?.needsRestack)).toStrictEqual([false, false, false]);
  });

  it('(k) second pin: a tracked branch deleted out of band is pruned by the next gs log, which moves refs/spice/data and writes loose objects and nothing else; the gs log after that changes nothing', async () => {
    // arrange: a branch that is not checked out (git refuses to delete the current one — the
    // void attempt of 2026-10-09); `-D` because git counts it unmerged into its upstream
    fixture.git(['branch', '-D', 'add-retries']);
    const before = snapshotGitDir(fixture);

    // act
    const result = await runGitSpice(commands, GS_LOG_ARGS, fixture.dir);
    const changed = changedPaths(before, snapshotGitDir(fixture));
    const quiet = snapshotGitDir(fixture);
    const again = await runGitSpice(commands, GS_LOG_ARGS, fixture.dir);

    // assert
    expect(result.exitCode).toBe(0);
    expect(stderrLines(result)).toContain('INF tracked branch add-retries was deleted out of band: removing...');
    expect([...logLinesByName(result.stdout).keys()]).toStrictEqual(['api-refactor', 'main', 'retry-metrics']);
    expect(changed).toContain('refs/spice/data');
    expect(changed.filter((file) => !file.startsWith('objects/') && file !== 'refs/spice/data')).toStrictEqual([]);
    expect(again.exitCode).toBe(0);
    expect(changedPaths(quiet, snapshotGitDir(fixture))).toStrictEqual([]);
  });

  it('git-spice wrote nothing under HOME or the XDG directories', () => {
    // assert: last, because the `it`s of a file run in order and this is the whole file's trace
    expect(filesUnder(homeDir)).toStrictEqual([]);
  });
});
