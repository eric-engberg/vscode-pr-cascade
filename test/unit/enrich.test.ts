/**
 * test/unit/enrich.test.ts — `GitSpiceBackend.enrich` as a specification: what each line of
 * `gs log short --all --json` becomes on the layer it names (E56), the exact programs and git
 * commands it runs — and the ones it must never run — the self-gate on `refs/spice/data` (plan
 * §7.6), every failure shape (E57), the §7.14.2 memo (what re-runs `gs log`, what does not, and
 * that a failure is never remembered), two repositories, and that the input is never changed.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no git-spice, no VS Code). Depends on:
 * src/core/backends/gitspice.ts, src/core/digest.ts (`DIGEST_ARGS`), src/core/readinessFix.ts
 * (`offerFor` — to pin that the reasons are the setup flow's own words), test/helpers/fakeGit.ts,
 * test/helpers/fakeCommand.ts. The digest itself is test/unit/digest.test.ts's; `track` is
 * test/unit/track.test.ts's. Plan: §7.8, §7.13.3, §7.14.2, §8 E17/E56/E57, §9.4 `unit/enrich`,
 * §10.1 item 20a, §13.2 D59.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { describe, expect, it } from 'vitest';
import { GitSpiceBackend, GS_ENV, PROBE_TIMEOUT_MS } from '../../src/core/backends/gitspice';
import type { CommandResult } from '../../src/core/command';
import { DIGEST_ARGS } from '../../src/core/digest';
import type { RepoState, StackLayer } from '../../src/core/model';
import { offerFor } from '../../src/core/readinessFix';
import type { OfferFacts } from '../../src/core/readinessFix';
import { exited, FakeCommandRunner, neverStarted, timedOut } from '../helpers/fakeCommand';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository every test asks about, and the fakes' keys for the three commands `enrich`
// may run there: the digest (FakeGitRunner keys by the arguments joined with spaces) and the
// two programs (FakeCommandRunner keys by the executable and the arguments joined the same way).
// see primer §4 (const), §25 (arrays: `join`) and §12 (template strings)
const ROOT = '/work/app';
const DIGEST_KEY = DIGEST_ARGS.join(' ');
const VERSION = 'git-spice --no-prompt --version';
const GS_VERSION = 'gs --no-prompt --version';
const LOG = 'git-spice --no-prompt log short --all --json';
const BANNER = exited(0, 'git-spice 0.31.2\nCopyright (C) Abhinav Gupta\n');

// What `for-each-ref` prints for the fixture once git-spice has initialised it — the digest —
// and the same text without git-spice's line.
const SPICE_LINE = 'refs/spice/data dddddddddddddddddddddddddddddddddddddddd\n';
const NO_SPICE =
  'refs/heads/add-retries bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n' +
  'refs/heads/api-refactor aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' +
  'refs/heads/main 0000000000000000000000000000000000000000\n' +
  'refs/heads/retry-metrics cccccccccccccccccccccccccccccccccccccccc\n' +
  'refs/remotes/origin/HEAD 0000000000000000000000000000000000000000\n' +
  'refs/remotes/origin/main 0000000000000000000000000000000000000000\n';
const REFS = NO_SPICE + SPICE_LINE;

// What `gs log short --all --json` prints for the fixture with the bottom two layers tracked:
// git-spice's own trunk line first (`ups`, no `down`), the bottom layer with a pull request and
// a clean push state, the middle one needing a restack and a push; the top layer absent.
const PR_URL = 'https://github.com/org/repo/pull/12';
const TRUNK = '{"name":"main","ups":[{"name":"api-refactor"}]}\n';
const BOTTOM = `{"name":"api-refactor","down":{"name":"main"},"change":{"id":"#12","url":"${PR_URL}"},"push":{"ahead":0,"behind":0}}\n`;
const MIDDLE = '{"name":"add-retries","down":{"name":"api-refactor","needsRestack":true},"push":{"ahead":1,"behind":0,"needsPush":true}}\n';
const TOP = '{"name":"retry-metrics","down":{"name":"add-retries"}}\n';
const LINES = TRUNK + BOTTOM + MIDDLE;

// Those two lines as parseGsLog types them: `needsRestack` and `needsPush` filled in when absent,
// `ups` dropped (core/gsLog.ts).
const BOTTOM_TRACKING = {
  name: 'api-refactor',
  down: { name: 'main', needsRestack: false },
  change: { id: '#12', url: PR_URL },
  push: { ahead: 0, behind: 0, needsPush: false },
};
const MIDDLE_TRACKING = { name: 'add-retries', down: { name: 'api-refactor', needsRestack: true }, push: { ahead: 1, behind: 0, needsPush: true } };

// A `gs log` failure's reason starts with the command it names.
const FAILED = 'gs log short --all --json failed: ';

// What the setup flow is handed when it words the same step-1 failures (core/readinessFix.ts):
// nothing set, no Homebrew — the plainest sentences.
const FACTS: OfferFacts = { root: ROOT, remote: 'origin', trunkBranch: { kind: 'none' }, gsPathSetting: '', brewPath: null, brewGitSpice: null };

/** One layer as computeStack builds it: no `tracking` key at all. */
// see primer §3 (functions and type annotations) and §13 (default parameters)
function layer(name: string, parent: string, commitCount: number, isCurrent: boolean = false): StackLayer {
  return { name, sha: `${name}-sha`, parent, parentSha: `${parent}-sha`, commitCount, isCurrent };
}

/** The fixture's state as the pipeline hands it to `enrich`: three layers on `origin/main`, HEAD on the top, nothing of git-spice's. */
function threeLayers(): RepoState {
  return {
    root: ROOT,
    trunk: 'origin/main',
    head: 'retry-metrics',
    rebaseInProgress: false,
    layers: [layer('api-refactor', 'origin/main', 1), layer('add-retries', 'api-refactor', 2), layer('retry-metrics', 'add-retries', 3, true)],
  };
}

/** The two fakes, the backend over them, and the two answer maps a test may change between calls. */
// see primer §9 (interface) and §11 (optional `?` fields)
interface Fakes {
  git: FakeGitRunner;
  commands: FakeCommandRunner;
  backend: GitSpiceBackend;
  gitAnswers: Map<string, string | Error>;
  programs: Map<string, CommandResult>;
}

/**
 * The happy path — an initialised digest, git-spice 0.31.2 answering as `git-spice`, `gs log`
 * printing LINES — with any answer replaced, under the executable `gsPath` names when set.
 */
// see primer §30 (`??`) and §19 (Map)
function fakes(options: { refs?: string | Error; version?: CommandResult; log?: CommandResult; gsPath?: string } = {}): Fakes {
  const executable = options.gsPath ?? 'git-spice';
  const gitAnswers = new Map<string, string | Error>([[DIGEST_KEY, options.refs ?? REFS]]);
  const programs = new Map<string, CommandResult>([
    [`${executable} --no-prompt --version`, options.version ?? BANNER],
    [`${executable} --no-prompt log short --all --json`, options.log ?? exited(0, LINES)],
  ]);
  const git = new FakeGitRunner(gitAnswers);
  const commands = new FakeCommandRunner(programs);
  return { git, commands, gitAnswers, programs, backend: new GitSpiceBackend(git, commands, options.gsPath ?? '') };
}

// see primer §5 (arrow functions) and §6 (async / await)
describe('GitSpiceBackend.enrich', () => {
  describe('what each line becomes (E56)', () => {
    it('puts each line on the layer it names, `null` on a layer a complete answer does not list, and says it ran', async () => {
      // arrange
      const { backend } = fakes();
      const state = threeLayers();

      // act
      const result = await backend.enrich(state);

      // assert: the parser's own lines, the untracked top as `null`, everything else copied
      expect(result.layers).toStrictEqual([
        { ...state.layers[0], tracking: BOTTOM_TRACKING },
        { ...state.layers[1], tracking: MIDDLE_TRACKING },
        { ...state.layers[2], tracking: null },
      ]);
      expect(result.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: true, malformed: [] });
      expect(result.root).toBe(ROOT);
      expect(result.trunk).toBe('origin/main');
      expect(result.head).toBe('retry-metrics');
      expect(result.rebaseInProgress).toBe(false);
    });

    it('runs exactly one git command and two programs — the §7.14.2 digest, the §7.13.1 banner, then `gs log short --all --json` (§7.13.3, D59)', async () => {
      // arrange
      const { backend, git, commands } = fakes();

      // act
      await backend.enrich(threeLayers());

      // assert
      expect(git.calls).toStrictEqual([{ args: [...DIGEST_ARGS], cwd: ROOT }]);
      expect(commands.calls).toStrictEqual([
        { executable: 'git-spice', args: ['--no-prompt', '--version'], cwd: ROOT, env: GS_ENV, timeoutMs: PROBE_TIMEOUT_MS },
        { executable: 'git-spice', args: ['--no-prompt', 'log', 'short', '--all', '--json'], cwd: ROOT, env: GS_ENV, timeoutMs: PROBE_TIMEOUT_MS },
      ]);
    });

    it('runs the executable prCascade.gsPath names, for the banner and for `gs log` alike', async () => {
      // arrange
      const { backend, commands } = fakes({ gsPath: '/opt/x/git-spice' });

      // act
      const result = await backend.enrich(threeLayers());

      // assert
      // see primer §25 (arrays: `map`)
      expect(commands.calls.map((call) => call.executable)).toStrictEqual(['/opt/x/git-spice', '/opt/x/git-spice']);
      expect(result.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: true, malformed: [] });
    });

    it("gives a layer named like the trunk git-spice's own trunk line — an entry with no `down` — never `null` (a local main ahead of origin/main)", async () => {
      // arrange: computeStack lists the local `main` as the bottom layer when it is ahead of
      // `origin/main`; git-spice prints it as its trunk (verified 0.31.2).
      const { backend } = fakes({ log: exited(0, `${TRUNK}{"name":"a","down":{"name":"main"}}\n`) });
      const state: RepoState = { ...threeLayers(), head: 'a', layers: [layer('main', 'origin/main', 1), layer('a', 'main', 2, true)] };

      // act
      const result = await backend.enrich(state);

      // assert
      expect(result.layers[0].tracking).toStrictEqual({ name: 'main' });
      expect(result.layers[1].tracking).toStrictEqual({ name: 'a', down: { name: 'main', needsRestack: false } });
    });

    it('lets the later of two lines naming one branch win', async () => {
      // arrange
      const { backend } = fakes({ log: exited(0, `${BOTTOM}{"name":"api-refactor","down":{"name":"main","needsRestack":true}}\n`) });

      // act
      const result = await backend.enrich(threeLayers());

      // assert
      expect(result.layers[0].tracking).toStrictEqual({ name: 'api-refactor', down: { name: 'main', needsRestack: true } });
    });

    it('keeps `change.status` as the parser keeps it — M7 reads it', async () => {
      // arrange
      const { backend } = fakes({ log: exited(0, `{"name":"api-refactor","down":{"name":"main"},"change":{"id":"#12","url":"${PR_URL}","status":"open"}}\n`) });

      // act
      const result = await backend.enrich(threeLayers());

      // assert
      // see primer §70 (`?.` on a field that may be `null` or `undefined`)
      expect(result.layers[0].tracking?.change?.status).toBe('open');
    });

    it('never changes the state it was given: new state and layer objects, the input byte for byte as before', async () => {
      // arrange
      const { backend } = fakes();
      const state = threeLayers();
      // see primer §50 (`JSON.stringify` / `JSON.parse`: a deep copy to compare against)
      const before = JSON.parse(JSON.stringify(state));

      // act
      const result = await backend.enrich(state);

      // assert
      expect(state).toStrictEqual(before);
      expect(result).not.toBe(state);
      expect(result.layers).not.toBe(state.layers);
      expect(result.layers[0]).not.toBe(state.layers[0]);
      // see primer §51 (`in`: whether an object has the key at all)
      expect('tracking' in state.layers[0]).toBe(false);
      expect('enrichment' in state).toBe(false);
    });

    it('runs during a paused rebase or a detached HEAD alike — HEAD is not an input (E3, E12)', async () => {
      // arrange: computeStack during `git rebase -x false main` — HEAD detached, no layer current
      const { backend, commands } = fakes();
      const paused: RepoState = { ...threeLayers(), head: null, rebaseInProgress: true };
      paused.layers[2].isCurrent = false;

      // act
      const result = await backend.enrich(paused);

      // assert: the same answer as on a branch, the two fields copied through
      expect(result.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: true, malformed: [] });
      expect(result.layers[0].tracking).toStrictEqual(BOTTOM_TRACKING);
      expect(result.head).toBeNull();
      expect(result.rebaseInProgress).toBe(true);
      expect(commands.calls.length).toBe(2);
    });
  });

  describe('nothing to ask (E4, E5)', () => {
    it('hands the same object back, runs nothing and adds no `enrichment` when there are no layers', async () => {
      // arrange
      const { backend, git, commands } = fakes();
      const state: RepoState = { ...threeLayers(), head: 'main', layers: [] };

      // act
      const result = await backend.enrich(state);

      // assert
      expect(result).toBe(state);
      expect('enrichment' in result).toBe(false);
      expect(git.calls).toStrictEqual([]);
      expect(commands.calls).toStrictEqual([]);
    });

    it('hands the same object back and runs nothing when no trunk was found — whatever the layers say', async () => {
      // arrange: computeStack never pairs `trunk: null` with layers; the check is on the trunk alone
      const { backend, git, commands } = fakes();
      const state: RepoState = { ...threeLayers(), trunk: null };

      // act
      const result = await backend.enrich(state);

      // assert
      expect(result).toBe(state);
      expect(git.calls).toStrictEqual([]);
      expect(commands.calls).toStrictEqual([]);
    });
  });

  describe('the self-gate and the failures (E57)', () => {
    it('runs no program at all when the digest has no refs/spice/data line — plan §7.6 in core — and says why', async () => {
      // arrange
      const { backend, git, commands } = fakes({ refs: NO_SPICE });
      const state = threeLayers();
      const before = JSON.parse(JSON.stringify(state));

      // act
      const result = await backend.enrich(state);

      // assert: the cause and the reason; the layers as handed in — no `tracking` on any — and
      // the input untouched (the layers array is shared, so the copy is what proves it)
      expect(result.enrichment).toStrictEqual({
        kind: 'not-enriched',
        cause: 'not-initialised',
        reason: 'the repository is not initialised for git-spice (no refs/spice/data)',
      });
      expect(commands.calls).toStrictEqual([]);
      expect(git.calls).toStrictEqual([{ args: [...DIGEST_ARGS], cwd: ROOT }]);
      expect(result.layers).toStrictEqual(before.layers);
      expect(state).toStrictEqual(before);
      expect(result).not.toBe(state);
    });

    it('is not fooled by a ref whose name merely starts with refs/spice/data', async () => {
      // arrange
      const { backend, commands } = fakes({ refs: `${NO_SPICE}refs/spice/database dddddddddddddddddddddddddddddddddddddddd\n` });

      // act
      const result = await backend.enrich(threeLayers());

      // assert
      expect(result.enrichment?.kind).toBe('not-enriched');
      expect(commands.calls).toStrictEqual([]);
    });

    it("says git-spice is missing in the setup flow's own words, having tried both names and asked for no log", async () => {
      // arrange
      const { backend, commands, programs } = fakes({ version: neverStarted('not-found') });
      programs.set(GS_VERSION, neverStarted('not-found'));

      // act
      const result = await backend.enrich(threeLayers());

      // assert
      const reason = "git-spice was not found in VS Code's PATH (tried git-spice, gs)";
      expect(result.enrichment).toStrictEqual({ kind: 'not-enriched', cause: 'gs-missing', reason });
      expect(commands.calls.map((call) => `${call.executable} ${call.args.join(' ')}`)).toStrictEqual([VERSION, GS_VERSION]);
      // The setup flow's sentence (core/readinessFix.ts) starts with the same words, so the Output
      // channel and the notification agree.
      // see primer §23 (`startsWith`)
      expect(offerFor({ kind: 'gs-missing', tried: ['git-spice', 'gs'] }, FACTS).message.startsWith(`${reason}.`)).toBe(true);
    });

    it("says what the setup flow says when prCascade.gsPath named the one executable tried — PATH was never asked", async () => {
      // arrange
      const { backend } = fakes({ gsPath: '/opt/x/git-spice', version: neverStarted('not-found') });

      // act
      const result = await backend.enrich(threeLayers());

      // assert
      const reason = 'prCascade.gsPath is /opt/x/git-spice, which did not answer as git-spice';
      expect(result.enrichment).toStrictEqual({ kind: 'not-enriched', cause: 'gs-missing', reason });
      const facts: OfferFacts = { ...FACTS, gsPathSetting: '/opt/x/git-spice' };
      expect(offerFor({ kind: 'gs-missing', tried: ['/opt/x/git-spice'] }, facts).message.startsWith(`${reason}.`)).toBe(true);
    });

    it("says git-spice is too old — or that its version could not be read — in the setup flow's own words, and asks for no log", async () => {
      // arrange
      const old = fakes({ version: exited(0, 'git-spice 0.30.0\n') });
      const dev = fakes({ version: exited(0, 'git-spice dev\n') });

      // act
      const oldResult = await old.backend.enrich(threeLayers());
      const devResult = await dev.backend.enrich(threeLayers());

      // assert
      const oldReason = 'git-spice 0.30.0 is older than 0.31.0, the oldest PR Cascade works with';
      const devReason = 'git-spice reports version "dev", so whether it is at least 0.31.0 could not be checked';
      expect(oldResult.enrichment).toStrictEqual({ kind: 'not-enriched', cause: 'gs-too-old', reason: oldReason });
      expect(devResult.enrichment).toStrictEqual({ kind: 'not-enriched', cause: 'gs-too-old', reason: devReason });
      expect(old.commands.calls.length).toBe(1);
      expect(dev.commands.calls.length).toBe(1);
      expect(offerFor({ kind: 'gs-too-old', gsPath: 'git-spice', found: '0.30.0', minimum: '0.31.0' }, FACTS).message.startsWith(`${oldReason}.`)).toBe(true);
      expect(offerFor({ kind: 'gs-too-old', gsPath: 'git-spice', found: 'dev', minimum: '0.31.0' }, FACTS).message.startsWith(`${devReason}.`)).toBe(true);
    });

    it('turns every way `gs log` can fail into one phrase: the FTL line past any INF lines, else the first line, else the exit code, the timeout or the start failure', async () => {
      // arrange: each failure, and the phrase it earns after `gs log short --all --json failed: `
      const failures: { name: string; log: CommandResult; phrase: string }[] = [
        { name: 'the FTL line', log: exited(1, '', 'FTL git-spice: boom\n'), phrase: 'FTL git-spice: boom' },
        {
          // What an auto-init failure prints (verified 0.31.2): two INF lines, then the FTL.
          name: 'INF lines before the FTL',
          log: exited(1, '', 'INF Repository not initialized. Initializing.\nINF Using remote: origin\nFTL git-spice: boom\n'),
          phrase: 'FTL git-spice: boom',
        },
        { name: 'a line that merely mentions FTL', log: exited(1, '', 'INF the FTL line follows\nFTLISH not it\nFTL git-spice: boom\n'), phrase: 'FTL git-spice: boom' },
        // A git line relayed after git-spice's `FTL stderr:` marker is appended (item 21a's rule, shared).
        { name: 'a git line relayed after the FTL', log: exited(1, '', 'FTL git-spice: boom\nFTL stderr:\nFTL fatal: nope\n'), phrase: 'FTL git-spice: boom — fatal: nope' },
        { name: 'no FTL line', log: exited(1, '', '\n  oops  \nmore\n'), phrase: 'oops' },
        { name: 'empty stderr', log: exited(1), phrase: 'exited 1' },
        { name: 'whitespace-only stderr', log: exited(1, '', ' \r\n'), phrase: 'exited 1' },
        { name: 'a timeout', log: timedOut(), phrase: 'timed out after 15000 ms' },
        {
          // What git-spice printed before the kill is not the reason; the kill is.
          name: 'a timeout after some output',
          log: { ...timedOut(), stderr: 'INF tracked branch c was deleted out of band: removing...\n' },
          phrase: 'timed out after 15000 ms',
        },
        { name: 'never started', log: neverStarted('not-found'), phrase: 'could not start (not-found)' },
        {
          // No exit code, no timeout, nothing about starting: Node's own words (a signal, the output ceiling).
          name: 'a signal kill',
          log: { exitCode: null, stdout: '', stderr: '', startFailure: null, timedOut: false, detail: 'Command failed: git-spice --no-prompt log short --all --json' },
          phrase: 'Command failed: git-spice --no-prompt log short --all --json',
        },
        { name: 'no exit code and no detail', log: { exitCode: null, stdout: '', stderr: '', startFailure: null, timedOut: false }, phrase: 'no exit code' },
      ];
      // see primer §22 (for ... of)
      for (const failure of failures) {
        const { backend } = fakes({ log: failure.log });
        const state = threeLayers();
        const before = JSON.parse(JSON.stringify(state));

        // act
        const result = await backend.enrich(state);

        // assert: the cause, the phrase, and the layers as handed in — no `tracking` on any,
        // the input untouched
        expect(result.enrichment, failure.name).toStrictEqual({ kind: 'not-enriched', cause: 'gs-log-failed', reason: FAILED + failure.phrase });
        expect(result.layers, failure.name).toStrictEqual(before.layers);
        expect(state, failure.name).toStrictEqual(before);
      }
    });

    it('never reads stderr beside exit 0 — INF lines there are not malformed JSON', async () => {
      // arrange
      const { backend } = fakes({ log: exited(0, LINES, 'INF something git-spice noticed\n') });

      // act
      const result = await backend.enrich(threeLayers());

      // assert
      expect(result.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: true, malformed: [] });
      expect(result.layers[0].tracking).toStrictEqual(BOTTOM_TRACKING);
    });

    it('leaves a layer an incomplete answer does not list without any `tracking` key — unknown, not `null` — and reports the bad line once', async () => {
      // arrange: the middle layer's line is unreadable, the top is absent — and because a bad line
      // names no branch, nothing can say which of the two git-spice tracks (E57)
      const { backend } = fakes({ log: exited(0, `${TRUNK}${BOTTOM}{"name":"add-retries","push":{"ahead":"x"}}\n`) });
      const state = threeLayers();

      // act
      const result = await backend.enrich(state);

      // assert: the unknown layers are new objects too, not the input's handed back
      expect(result.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: true, malformed: [{ line: 3, problem: 'push.ahead is not a number' }] });
      expect(result.layers[0].tracking).toStrictEqual(BOTTOM_TRACKING);
      expect('tracking' in result.layers[1]).toBe(false);
      expect('tracking' in result.layers[2]).toBe(false);
      expect(result.layers[1]).not.toBe(state.layers[1]);
    });

    it('leaves every layer unknown when every line is malformed, and still counts as enriched (the exit code decides)', async () => {
      // arrange
      const { backend } = fakes({ log: exited(0, 'x\ny\nz\n') });

      // act
      const result = await backend.enrich(threeLayers());

      // assert
      expect(result.enrichment).toStrictEqual({
        kind: 'enriched',
        ranGsLog: true,
        malformed: [
          { line: 1, problem: 'not JSON' },
          { line: 2, problem: 'not JSON' },
          { line: 3, problem: 'not JSON' },
        ],
      });
      // see primer §25 (arrays: `every`)
      expect(result.layers.every((candidate) => !('tracking' in candidate))).toBe(true);
    });
  });

  describe('the memo (plan §7.14.2)', () => {
    it('runs `gs log` once for two loads with the same digest — the digest is read each time, the programs are not run — and says so', async () => {
      // arrange
      const { backend, git, commands } = fakes();

      // act
      const first = await backend.enrich(threeLayers());
      const second = await backend.enrich(threeLayers());

      // assert
      expect(git.calls.length).toBe(2);
      expect(commands.calls.length).toBe(2);
      expect(second.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: false, malformed: [] });
      expect(second.layers).toStrictEqual(first.layers);
    });

    it('applies the remembered answer to the layers as they are now — a branch created since is `null`, with no program run', async () => {
      // arrange: a checkout changed the stack but moved no ref the digest lists
      const { backend, commands } = fakes();
      await backend.enrich(threeLayers());
      const grown = threeLayers();
      grown.layers[2].isCurrent = false;
      grown.layers.push(layer('retry-docs', 'retry-metrics', 4, true));
      grown.head = 'retry-docs';

      // act
      const result = await backend.enrich(grown);

      // assert
      expect(commands.calls.length).toBe(2);
      expect(result.layers[0].tracking).toStrictEqual(BOTTOM_TRACKING);
      expect(result.layers[3]).toStrictEqual({ ...grown.layers[3], tracking: null });
      expect(result.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: false, malformed: [] });
    });

    it('remembers that an answer was incomplete: a later hit reports no bad line again, and still leaves the unlisted layers unknown', async () => {
      // arrange
      const { backend } = fakes({ log: exited(0, `${TRUNK}${BOTTOM}{"name":"add-retries","push":{"ahead":"x"}}\n`) });
      await backend.enrich(threeLayers());

      // act
      const second = await backend.enrich(threeLayers());

      // assert
      expect(second.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: false, malformed: [] });
      expect(second.layers[0].tracking).toStrictEqual(BOTTOM_TRACKING);
      expect('tracking' in second.layers[1]).toBe(false);
      expect('tracking' in second.layers[2]).toBe(false);
    });

    it('runs `gs log` again when a branch, a remote-tracking ref or refs/spice/data moved — and shows the new answer', async () => {
      // arrange: three digests that differ from REFS by one object name each
      const moved = [
        { name: 'a commit on a branch (refs/heads)', refs: REFS.replace('add-retries bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'add-retries eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') },
        { name: 'a fetch that moved trunk (refs/remotes)', refs: REFS.replace('origin/main 0000000000000000000000000000000000000000', 'origin/main ffffffffffffffffffffffffffffffffffffffff') },
        { name: 'a git-spice write (refs/spice/data)', refs: `${NO_SPICE}refs/spice/data eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n` },
      ];
      for (const change of moved) {
        const { backend, gitAnswers, programs, commands } = fakes();
        await backend.enrich(threeLayers());
        expect(change.refs, change.name).not.toBe(REFS);
        gitAnswers.set(DIGEST_KEY, change.refs);
        programs.set(LOG, exited(0, LINES + TOP));

        // act
        const result = await backend.enrich(threeLayers());

        // assert: the banner and the log once more, the top now tracked
        expect(commands.calls.length, change.name).toBe(4);
        expect(result.enrichment, change.name).toStrictEqual({ kind: 'enriched', ranGsLog: true, malformed: [] });
        expect(result.layers[2].tracking, change.name).toStrictEqual({ name: 'retry-metrics', down: { name: 'add-retries', needsRestack: false } });
      }
    });

    it('leaves the memo as it was when `gs log` fails: a digest that comes back is still a hit', async () => {
      // arrange: a good answer at REFS; then refs/spice/data moves and `gs log` fails; then it moves back
      const MOVED = `${NO_SPICE}refs/spice/data eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n`;
      const { backend, gitAnswers, programs, commands } = fakes();
      await backend.enrich(threeLayers());
      gitAnswers.set(DIGEST_KEY, MOVED);
      programs.set(LOG, exited(1, '', 'FTL git-spice: boom\n'));
      const failed = await backend.enrich(threeLayers());
      gitAnswers.set(DIGEST_KEY, REFS);

      // act
      const result = await backend.enrich(threeLayers());

      // assert: the failed run neither replaced nor dropped the REFS answer
      expect(failed.enrichment?.kind).toBe('not-enriched');
      expect(result.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: false, malformed: [] });
      expect(result.layers[0].tracking).toStrictEqual(BOTTOM_TRACKING);
      expect(commands.calls.length).toBe(4);
    });

    it('never remembers a failure: the next load with the same digest asks `gs log` again', async () => {
      // arrange
      const { backend, programs, commands } = fakes({ log: exited(1, '', 'FTL git-spice: boom\n') });
      const first = await backend.enrich(threeLayers());
      programs.set(LOG, exited(0, LINES));

      // act
      const second = await backend.enrich(threeLayers());

      // assert
      expect(first.enrichment?.kind).toBe('not-enriched');
      expect(second.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: true, malformed: [] });
      expect(commands.calls.length).toBe(4);
    });

    it('keeps one memo per repository: a digest that moved in one re-runs `gs log` there alone', async () => {
      // arrange
      const { backend, git, commands } = fakes();
      const a: RepoState = { ...threeLayers(), root: '/w/a' };
      const b: RepoState = { ...threeLayers(), root: '/w/b' };
      await backend.enrich(a);
      await backend.enrich(b);
      git.answerIn('/w/a', [...DIGEST_ARGS], `${NO_SPICE}refs/spice/data eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n`);

      // act
      const secondA = await backend.enrich(a);
      const secondB = await backend.enrich(b);

      // assert
      expect(secondA.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: true, malformed: [] });
      expect(secondB.enrichment).toStrictEqual({ kind: 'enriched', ranGsLog: false, malformed: [] });
      expect(commands.calls.map((call) => call.cwd)).toStrictEqual(['/w/a', '/w/a', '/w/b', '/w/b', '/w/a', '/w/a']);
    });
  });

  it('rejects when git itself cannot run (E17) — before any program is asked', async () => {
    // arrange
    const { backend, commands } = fakes({ refs: new Error('git: ENOENT') });

    // act and assert
    await expect(backend.enrich(threeLayers())).rejects.toThrow('git: ENOENT');
    expect(commands.calls).toStrictEqual([]);
  });
});
