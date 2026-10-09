/**
 * test/unit/push.test.ts — `GitSpiceBackend.push` as a specification: the one `stack submit
 * --no-publish --no-update-only` with its 120 s timeout after the one git question and the banner;
 * `pushed` read from git-spice's `INF Pushed <name>` lines and `notes` from every other line; the
 * five refusals before any spawn that moves a ref — no layers, not initialised, a layer the remote
 * is ahead of (E76), git-spice missing or old, a layer that needs a restack — each a sentence; and
 * the phrase a failure earns, with git's own line appended after git-spice's `FTL`.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no git-spice, no VS Code). Depends on:
 * src/core/backends/gitspice.ts, src/core/readinessFix.ts (`offerFor` — the step-1 sentences agree
 * with the setup flow's), test/helpers/fakeGit.ts, test/helpers/fakeCommand.ts. Tracking first is
 * the caller's (test/unit/track.test.ts). Plan: §7.7, §7.13.3, §8 E17/E56/E76, §9.4 `unit/push`,
 * §10.1 item 21a, §13.2 D61, §13.4 (the `stack submit` facts of 2026-10-09).
 */

// see primer §1 (import / export) and §9 (`import type`)
import { describe, expect, it } from 'vitest';
import { GitSpiceBackend, GS_ENV, GS_SUBMIT_ARGS, PROBE_TIMEOUT_MS, PUSH_TIMEOUT_MS } from '../../src/core/backends/gitspice';
import type { CommandResult } from '../../src/core/command';
import type { GsLogEntry, GsLogPush } from '../../src/core/gsLog';
import type { StackLayer } from '../../src/core/model';
import { offerFor } from '../../src/core/readinessFix';
import type { OfferFacts } from '../../src/core/readinessFix';
import { exited, FakeCommandRunner, neverStarted, timedOut } from '../helpers/fakeCommand';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository every test asks about, the one git question `push` asks there, and the programs
// it may run (as the fakes key them: executable and arguments joined by spaces). The submit's
// arguments are spelled out below, never built from GS_SUBMIT_ARGS, so an edit to that list fails
// here on purpose.
// see primer §4 (const) and §12 (template strings)
const ROOT = '/work/app';
const REF_ARGS = ['rev-parse', '--verify', '--quiet', 'refs/spice/data'];
const REF_KEY = REF_ARGS.join(' ');
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n';
const VERSION = 'git-spice --no-prompt --version';
const GS_VERSION = 'gs --no-prompt --version';
const BANNER = exited(0, 'git-spice 0.31.2\nCopyright (C) Abhinav Gupta\n');
// What git-spice prints for the fixture's three layers (stderr, verified 0.31.2): one line per branch.
const PUSHED_3 = exited(0, '', 'INF Pushed api-refactor\nINF Pushed add-retries\nINF Pushed retry-metrics\n');
const THREE = ['api-refactor', 'add-retries', 'retry-metrics'];

// What the setup flow is handed when it words the same step-1 failures (core/readinessFix.ts).
const FACTS: OfferFacts = { root: ROOT, remote: 'origin', trunkBranch: { kind: 'none' }, gsPathSetting: '', brewPath: null, brewGitSpice: null };

/** The request the fake records for the one submit, spelled out. */
// see primer §13 (a default parameter)
function submitRequest(executable: string = 'git-spice'): object {
  return { executable, args: ['--no-prompt', 'stack', 'submit', '--no-publish', '--no-update-only'], cwd: ROOT, env: GS_ENV, timeoutMs: PUSH_TIMEOUT_MS };
}

/** One layer as `enrich` leaves it: `tracking` as given, or no such key when it is `undefined`. */
// see primer §11 (optional `?` fields)
function layer(name: string, parent: string, tracking?: GsLogEntry | null): StackLayer {
  const built: StackLayer = { name, sha: `${name}-sha`, parent, parentSha: `${parent}-sha`, commitCount: 1, isCurrent: false };
  if (tracking !== undefined) {
    built.tracking = tracking;
  }
  return built;
}

/**
 * git-spice's line for a tracked branch with nothing to say: clean push state, no restack due —
 * unless `push` says otherwise, or `needsRestack` is set (pass `undefined` for `push` to keep its
 * default and reach the fourth parameter).
 */
function entry(name: string, below: string, push: GsLogPush = { ahead: 0, behind: 0, needsPush: false }, needsRestack: boolean = false): GsLogEntry {
  return { name, down: { name: below, needsRestack }, push };
}

/** The fixture's three layers, every one tracked and clean. */
function tracked(): StackLayer[] {
  return [
    layer('api-refactor', 'origin/main', entry('api-refactor', 'main')),
    layer('add-retries', 'api-refactor', entry('add-retries', 'api-refactor')),
    layer('retry-metrics', 'add-retries', entry('retry-metrics', 'add-retries')),
  ];
}

/** The fakes and the backend over them; the submit's answer and the rest replaceable. */
// see primer §9 (interface) and §30 (`??`)
interface Fakes {
  git: FakeGitRunner;
  commands: FakeCommandRunner;
  backend: GitSpiceBackend;
  programs: Map<string, CommandResult>;
}

function fakes(options: { ref?: string | Error; version?: CommandResult; gsPath?: string; submit?: CommandResult } = {}): Fakes {
  const executable = options.gsPath ?? 'git-spice';
  const programs = new Map<string, CommandResult>([
    [`${executable} --no-prompt --version`, options.version ?? BANNER],
    [`${executable} --no-prompt stack submit --no-publish --no-update-only`, options.submit ?? PUSHED_3],
  ]);
  const git = new FakeGitRunner(new Map<string, string | Error>([[REF_KEY, options.ref ?? SHA]]));
  const commands = new FakeCommandRunner(programs);
  return { git, commands, programs, backend: new GitSpiceBackend(git, commands, options.gsPath ?? '') };
}

// The failures git-spice printed in the measurements of 2026-10-09 (0.31.2), verbatim but for the
// branch name, the origin's path and the SHA (and, on the `remote: error:` line, git's trailing
// padding, which `nonEmptyLines` would trim anyway).
const STALE_INFO =
  'FTL git-spice: submit branch api-refactor: push branch: push: exit status 1\n' +
  'FTL stderr:\n' +
  'FTL To /work/origin.git\n' +
  'FTL  ! [rejected]        29e3acd2fe341fe21322a6127de4c0b5b1f6ca1a -> api-refactor (stale info)\n' +
  "FTL error: failed to push some refs to '/work/origin.git'\n";
const NO_REMOTE_BLOCK =
  'FTL stderr:\n' +
  "FTL fatal: 'origin' does not appear to be a git repository\n" +
  'FTL fatal: Could not read from remote repository.\n' +
  'FTL \n' +
  'FTL Please make sure you have the correct access rights\n' +
  'FTL and the repository exists.\n';
const NO_REMOTE = `FTL git-spice: submit branch api-refactor: find unique branch name: list remote refs: git ls-remote: wait: exit status 128\n${NO_REMOTE_BLOCK}${NO_REMOTE_BLOCK}`;
const CANNOT_LOCK =
  'FTL git-spice: submit branch api-refactor: push branch: push: exit status 1\n' +
  'FTL stderr:\n' +
  "FTL remote: error: cannot lock ref 'refs/heads/api-refactor': reference already exists\n" +
  'FTL To /work/origin.git\n' +
  'FTL  ! [remote rejected] 29e3acd2fe341fe21322a6127de4c0b5b1f6ca1a -> api-refactor (failed to update ref)\n' +
  "FTL error: failed to push some refs to '/work/origin.git'\n";
const PARTIAL =
  'INF Pushed api-refactor\n' +
  'ERR Branch add-retries needs to be restacked.\n' +
  'ERR Run the following command to fix this:\n' +
  'ERR   git-spice branch restack --branch=add-retries\n' +
  'ERR Or, try again with --force to submit anyway.\n' +
  'FTL git-spice: submit branch add-retries: refusing to submit outdated branch\n';
const COULD_NOT = 'git-spice could not push the stack: ';

// see primer §5 (arrow functions) and §6 (async / await)
describe('GitSpiceBackend.push', () => {
  describe('the push (plan §7.13.3)', () => {
    it('asks the one git question and the banner, then runs `stack submit --no-publish --no-update-only` with a push-sized timeout, and reports what git-spice pushed', async () => {
      // arrange
      const { backend, git, commands } = fakes();

      // act
      const result = await backend.push(ROOT, tracked());

      // assert: the banner at the probe's 15 s, the submit at 120 s — both in one list
      expect(result).toStrictEqual({ pushed: THREE, notes: [], problem: null });
      expect(git.calls).toStrictEqual([{ args: REF_ARGS, cwd: ROOT }]);
      expect(commands.calls).toStrictEqual([
        { executable: 'git-spice', args: ['--no-prompt', '--version'], cwd: ROOT, env: GS_ENV, timeoutMs: PROBE_TIMEOUT_MS },
        submitRequest(),
      ]);
    });

    it('reads `pushed` from the `INF Pushed <name>` lines alone — trimmed, in order — and puts every other non-empty line in `notes`', async () => {
      // arrange: a WRN block with continuation lines (two pushers at once), a near miss, a continuation
      // line that quotes the words, text after a name, a blank, a CRLF on a pushed line, stdout
      const stderr =
        'INF Using remote: origin\nINF WOULD push branch x\nWRN Could not set upstream  branch=a remote=origin \n  error=\n    | git branch: exit status 1\n    | INF Pushed c\nINF Pushedz\nINF Pushed a (extra)\n\nINF Pushed b\r\nINF Pushed a\n';
      const { backend } = fakes({ submit: exited(0, 'ignored stdout\n', stderr) });

      // act
      const result = await backend.push(ROOT, tracked());

      // assert: only a whole line `INF Pushed <name>` counts — not one that merely contains the words
      expect(result).toStrictEqual({
        pushed: ['b', 'a'],
        notes: [
          'INF Using remote: origin',
          'INF WOULD push branch x',
          'WRN Could not set upstream  branch=a remote=origin',
          'error=',
          '| git branch: exit status 1',
          '| INF Pushed c',
          'INF Pushedz',
          'INF Pushed a (extra)',
        ],
        problem: null,
      });
    });

    it("keeps the two lines of a renamed upstream in `notes` — the one place git-spice says a branch went to `<name>-2`", async () => {
      // arrange: verbatim 0.31.2 — the remote already had api-refactor with no upstream recorded here
      const stderr =
        "INF api-refactor: Branch name already in use in remote 'origin'\nINF api-refactor: Using upstream name 'api-refactor-2' instead\nINF Pushed api-refactor\nINF Pushed add-retries\nINF Pushed retry-metrics\n";
      const { backend } = fakes({ submit: exited(0, '', stderr) });

      // act
      const result = await backend.push(ROOT, tracked());

      // assert: the core reports, the caller shows
      expect(result).toStrictEqual({
        pushed: THREE,
        notes: ["INF api-refactor: Branch name already in use in remote 'origin'", "INF api-refactor: Using upstream name 'api-refactor-2' instead"],
        problem: null,
      });
    });

    it('reports nothing pushed, and no problem, when git-spice exited 0 without a line it recognises', async () => {
      // arrange
      const { backend } = fakes({ submit: exited(0, '', 'INF something else\n') });

      // act
      const result = await backend.push(ROOT, tracked());

      // assert
      expect(result).toStrictEqual({ pushed: [], notes: ['INF something else'], problem: null });
    });

    it('pins the constants whole: the environment with its prompt switch, both timeouts, both `--no-` flags', () => {
      expect(GS_ENV).toStrictEqual({ NO_COLOR: '1', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
      expect(PUSH_TIMEOUT_MS).toBe(120_000);
      expect(PROBE_TIMEOUT_MS).toBe(15_000);
      expect(GS_SUBMIT_ARGS).toStrictEqual(['stack', 'submit', '--no-publish', '--no-update-only']);
    });

    it('runs the executable prCascade.gsPath names, for the banner and the submit alike', async () => {
      // arrange
      const { backend, commands } = fakes({ gsPath: '/opt/x/git-spice' });

      // act
      const result = await backend.push(ROOT, tracked());

      // assert
      expect(result.problem).toBeNull();
      // see primer §25 (arrays: `map`)
      expect(commands.calls.map((call) => call.executable)).toStrictEqual(['/opt/x/git-spice', '/opt/x/git-spice']);
    });
  });

  describe('the refusals before the spawn', () => {
    it('does nothing at all — no git, no program — for an empty stack', async () => {
      // arrange: from trunk git-spice would push every tracked branch of every stack, none of which the view shows
      const { backend, git, commands } = fakes();

      // act
      const result = await backend.push(ROOT, []);

      // assert
      expect(result).toStrictEqual({ pushed: [], notes: [], problem: null });
      expect(git.calls).toStrictEqual([]);
      expect(commands.calls).toStrictEqual([]);
    });

    it('refuses with a sentence and runs no program when the repository is not initialised — `stack submit` would try to initialise it', async () => {
      // arrange
      const { backend, git, commands } = fakes({ ref: new Error('exit 1') });

      // act
      const result = await backend.push(ROOT, tracked());

      // assert
      expect(result).toStrictEqual({ pushed: [], notes: [], problem: 'Nothing was pushed: the repository is not initialised for git-spice (no refs/spice/data).' });
      expect(git.calls).toStrictEqual([{ args: REF_ARGS, cwd: ROOT }]);
      expect(commands.calls).toStrictEqual([]);
    });

    it('refuses, before even the banner, a layer whose remote copy has commits this clone does not — a push would drop them (E76)', async () => {
      // arrange: after a `git fetch`, the lease no longer protects anyone and git-spice overwrites (verified 0.31.2)
      const { backend, git, commands } = fakes();
      const layers = tracked();
      layers[0] = layer('api-refactor', 'origin/main', entry('api-refactor', 'main', { ahead: 0, behind: 1, needsPush: true }));

      // act
      const result = await backend.push(ROOT, layers);

      // assert
      expect(result).toStrictEqual({
        pushed: [],
        notes: [],
        problem: 'Nothing was pushed: api-refactor has commits on the remote that are not here. Bring them in first — a push would drop them.',
      });
      expect(commands.calls).toStrictEqual([]);
      expect(git.calls.length).toBe(1);
    });

    it('names every such layer, two or three, and counts a diverged one (ahead and behind) too — on `behind` alone, whatever `needsPush` says', async () => {
      // arrange: git-spice sets needsPush beside behind today; the rule is `behind > 0` by itself
      const behind = { ahead: 0, behind: 2, needsPush: false };
      const diverged = { ahead: 1, behind: 1, needsPush: true };
      const two = fakes();
      const three = fakes();

      // act
      const twoResult = await two.backend.push(ROOT, [
        layer('api-refactor', 'origin/main', entry('api-refactor', 'main', behind)),
        layer('add-retries', 'api-refactor', entry('add-retries', 'api-refactor', diverged)),
        layer('retry-metrics', 'add-retries', entry('retry-metrics', 'add-retries')),
      ]);
      const threeResult = await three.backend.push(ROOT, [
        layer('a', 'origin/main', entry('a', 'main', behind)),
        layer('b', 'a', entry('b', 'a', behind)),
        layer('c', 'b', entry('c', 'b', diverged)),
      ]);

      // assert
      expect(twoResult.problem).toBe('Nothing was pushed: api-refactor and add-retries have commits on the remote that are not here. Bring them in first — a push would drop them.');
      expect(threeResult.problem).toBe('Nothing was pushed: a, b and c have commits on the remote that are not here. Bring them in first — a push would drop them.');
    });

    it('never counts as behind: no `push` field yet, the everyday ahead-only `needs push`, a `null` or an absent `tracking`', async () => {
      // arrange
      const { backend } = fakes();
      const noPush: GsLogEntry = { name: 'api-refactor', down: { name: 'main', needsRestack: false } };
      const layers = [
        layer('api-refactor', 'origin/main', noPush),
        layer('add-retries', 'api-refactor', entry('add-retries', 'api-refactor', { ahead: 2, behind: 0, needsPush: true })),
        layer('retry-metrics', 'add-retries', null),
        layer('retry-docs', 'retry-metrics'),
      ];

      // act
      const result = await backend.push(ROOT, layers);

      // assert: pushed, no refusal
      expect(result).toStrictEqual({ pushed: THREE, notes: [], problem: null });
    });

    it("says git-spice is missing, or too old, in the setup flow's words and runs no submit", async () => {
      // arrange
      const missing = fakes({ version: neverStarted('not-found') });
      missing.programs.set(GS_VERSION, neverStarted('not-found'));
      const old = fakes({ version: exited(0, 'git-spice 0.30.0\n') });
      const dev = fakes({ version: exited(0, 'git-spice dev\n') });

      // act
      const missingResult = await missing.backend.push(ROOT, tracked());
      const oldResult = await old.backend.push(ROOT, tracked());
      const devResult = await dev.backend.push(ROOT, tracked());

      // assert
      const missingReason = "git-spice was not found in VS Code's PATH (tried git-spice, gs)";
      const oldReason = 'git-spice 0.30.0 is older than 0.31.0, the oldest PR Cascade works with';
      const devReason = 'git-spice reports version "dev", so whether it is at least 0.31.0 could not be checked';
      expect(missingResult).toStrictEqual({ pushed: [], notes: [], problem: `Nothing was pushed: ${missingReason}.` });
      expect(oldResult).toStrictEqual({ pushed: [], notes: [], problem: `Nothing was pushed: ${oldReason}.` });
      expect(devResult).toStrictEqual({ pushed: [], notes: [], problem: `Nothing was pushed: ${devReason}.` });
      expect(missing.commands.calls.map((call) => `${call.executable} ${call.args.join(' ')}`)).toStrictEqual([VERSION, GS_VERSION]);
      expect(old.commands.calls.length).toBe(1);
      // the setup flow's sentences start with the same words (core/readinessFix.ts)
      // see primer §23 (`startsWith`)
      expect(offerFor({ kind: 'gs-missing', tried: ['git-spice', 'gs'] }, FACTS).message.startsWith(`${missingReason}.`)).toBe(true);
      expect(offerFor({ kind: 'gs-too-old', gsPath: 'git-spice', found: '0.30.0', minimum: '0.31.0' }, FACTS).message.startsWith(`${oldReason}.`)).toBe(true);
      expect(offerFor({ kind: 'gs-too-old', gsPath: 'git-spice', found: 'dev', minimum: '0.31.0' }, FACTS).message.startsWith(`${devReason}.`)).toBe(true);
    });

    it('refuses a layer that needs a restack — git-spice would push the layers below it and then refuse — naming the command to run', async () => {
      // arrange
      const { backend, git, commands } = fakes();
      const layers = tracked();
      layers[1] = layer('add-retries', 'api-refactor', entry('add-retries', 'api-refactor', undefined, true));

      // act
      const result = await backend.push(ROOT, layers);

      // assert: the banner was asked (the sentence spells the executable that answered), no submit
      expect(result).toStrictEqual({ pushed: [], notes: [], problem: 'Nothing was pushed: add-retries needs a restack. Run git-spice stack restack in a terminal first.' });
      expect(commands.calls.length).toBe(1);
      expect(git.calls.length).toBe(1);
    });

    it('names every such layer, and spells the executable prCascade.gsPath names — quoted when a shell would need it', async () => {
      // arrange
      const two = fakes();
      const three = fakes({ gsPath: '/opt/x/git-spice' });
      const blank = fakes({ gsPath: '/Applications/Dev Tools/git-spice' });
      const stale = (name: string, below: string): StackLayer => layer(name, below, entry(name, below, undefined, true));

      // act
      const twoResult = await two.backend.push(ROOT, [layer('api-refactor', 'origin/main', entry('api-refactor', 'main')), stale('add-retries', 'api-refactor'), stale('retry-metrics', 'add-retries')]);
      const threeResult = await three.backend.push(ROOT, [stale('a', 'main'), stale('b', 'a'), stale('c', 'b')]);
      const blankResult = await blank.backend.push(ROOT, [stale('a', 'main')]);

      // assert
      expect(twoResult.problem).toBe('Nothing was pushed: add-retries and retry-metrics need a restack. Run git-spice stack restack in a terminal first.');
      expect(threeResult.problem).toBe('Nothing was pushed: a, b and c need a restack. Run /opt/x/git-spice stack restack in a terminal first.');
      expect(blankResult.problem).toBe("Nothing was pushed: a needs a restack. Run '/Applications/Dev Tools/git-spice' stack restack in a terminal first.");
    });

    it("never counts as needing a restack: a `null` or absent `tracking`, or git-spice's trunk line (no `down`)", async () => {
      // arrange
      const { backend } = fakes();
      const layers = [layer('main', 'origin/main', { name: 'main' }), layer('a', 'main', null), layer('b', 'a')];

      // act
      const result = await backend.push(ROOT, layers);

      // assert
      expect(result).toStrictEqual({ pushed: THREE, notes: [], problem: null });
    });

    it('checks the remote before the restack: with one layer behind and another needing a restack, the behind sentence, and no program run', async () => {
      // arrange
      const { backend, commands } = fakes();
      const layers = [
        layer('api-refactor', 'origin/main', entry('api-refactor', 'main', undefined, true)),
        layer('add-retries', 'api-refactor', entry('add-retries', 'api-refactor', { ahead: 0, behind: 1, needsPush: true })),
      ];

      // act
      const result = await backend.push(ROOT, layers);

      // assert
      expect(result.problem).toBe('Nothing was pushed: add-retries has commits on the remote that are not here. Bring them in first — a push would drop them.');
      expect(commands.calls).toStrictEqual([]);
    });
  });

  describe('when git-spice says no', () => {
    it("quotes git-spice's fatal line and git's own line after it for a branch someone else moved on the remote (stale info)", async () => {
      // arrange: verbatim 0.31.2, unfetched — force-with-lease, no `--force`
      const { backend } = fakes({ submit: exited(1, '', STALE_INFO) });

      // act
      const result = await backend.push(ROOT, tracked());

      // assert: the phrase collapses git's column padding; `notes` keeps the lines as trimmed
      expect(result).toStrictEqual({
        pushed: [],
        notes: [
          'FTL git-spice: submit branch api-refactor: push branch: push: exit status 1',
          'FTL stderr:',
          'FTL To /work/origin.git',
          'FTL  ! [rejected]        29e3acd2fe341fe21322a6127de4c0b5b1f6ca1a -> api-refactor (stale info)',
          "FTL error: failed to push some refs to '/work/origin.git'",
        ],
        problem: `${COULD_NOT}FTL git-spice: submit branch api-refactor: push branch: push: exit status 1 — ! [rejected] 29e3acd2fe341fe21322a6127de4c0b5b1f6ca1a -> api-refactor (stale info).`,
      });
    });

    it("appends git's first relayed line for a missing remote and for two pushers at once — the `stderr:` marker skipped, the repeated block ignored, every line kept in `notes`", async () => {
      // arrange
      const noRemote = fakes({ submit: exited(1, '', NO_REMOTE) });
      const race = fakes({ submit: exited(1, '', CANNOT_LOCK) });

      // act
      const noRemoteResult = await noRemote.backend.push(ROOT, tracked());
      const raceResult = await race.backend.push(ROOT, tracked());

      // assert: `notes` holds every non-empty line as trimmed — git's relayed blank lines become a bare `FTL`
      const block = [
        'FTL stderr:',
        "FTL fatal: 'origin' does not appear to be a git repository",
        'FTL fatal: Could not read from remote repository.',
        'FTL',
        'FTL Please make sure you have the correct access rights',
        'FTL and the repository exists.',
      ];
      expect(noRemoteResult).toStrictEqual({
        pushed: [],
        notes: ['FTL git-spice: submit branch api-refactor: find unique branch name: list remote refs: git ls-remote: wait: exit status 128', ...block, ...block],
        problem: `${COULD_NOT}FTL git-spice: submit branch api-refactor: find unique branch name: list remote refs: git ls-remote: wait: exit status 128 — fatal: 'origin' does not appear to be a git repository.`,
      });
      expect(raceResult.problem).toBe(
        `${COULD_NOT}FTL git-spice: submit branch api-refactor: push branch: push: exit status 1 — remote: error: cannot lock ref 'refs/heads/api-refactor': reference already exists.`,
      );
    });

    it('keeps what a partial push moved beside the problem, with the ERR remedy lines in `notes` and never in the phrase', async () => {
      // arrange: verbatim 0.31.2 — a restack needed above HEAD, which the caller could not see
      const { backend } = fakes({ submit: exited(1, '', PARTIAL) });

      // act
      const result = await backend.push(ROOT, tracked());

      // assert
      expect(result).toStrictEqual({
        pushed: ['api-refactor'],
        notes: [
          'ERR Branch add-retries needs to be restacked.',
          'ERR Run the following command to fix this:',
          'ERR   git-spice branch restack --branch=add-retries',
          'ERR Or, try again with --force to submit anyway.',
          'FTL git-spice: submit branch add-retries: refusing to submit outdated branch',
        ],
        problem: `${COULD_NOT}FTL git-spice: submit branch add-retries: refusing to submit outdated branch.`,
      });
    });

    it("follows one rule for the appended line: the first later FTL line that says something — not the marker, a blank or git's `To` header — collapsed to single blanks, and one full stop", async () => {
      // arrange: each stderr, and the phrase it earns after the fixed prefix; a relayed line that
      // ends with a full stop gets no second one
      const shapes: { name: string; stderr: string; phrase: string }[] = [
        { name: 'marker, header and blank skipped', stderr: 'FTL git-spice: boom\nFTL stderr:\nFTL To /x/origin.git\nFTL \nFTL error: y\n', phrase: 'FTL git-spice: boom — error: y.' },
        { name: 'not only fatal: — ssh says ERROR:', stderr: 'FTL git-spice: boom\nFTL stderr:\nFTL ERROR: Repository not found.\nFTL fatal: Could not read from remote repository.\n', phrase: 'FTL git-spice: boom — ERROR: Repository not found.' },
        { name: 'https with no credential helper', stderr: "FTL git-spice: boom\nFTL stderr:\nFTL fatal: could not read Username for 'https://github.com': terminal prompts disabled\n", phrase: "FTL git-spice: boom — fatal: could not read Username for 'https://github.com': terminal prompts disabled." },
        { name: 'nothing to append', stderr: 'FTL git-spice: boom\nFTL stderr:\n', phrase: 'FTL git-spice: boom.' },
        { name: 'a git line before the first FTL is not the detail', stderr: 'fatal: before\nFTL git-spice: boom\n', phrase: 'FTL git-spice: boom.' },
        { name: 'the first line is quoted as it is; only the detail is collapsed', stderr: 'FTL  ! [a]     b\nFTL stderr:\nFTL  ! [c]     d\n', phrase: 'FTL  ! [a]     b — ! [c] d.' },
        { name: "a bare FTL line is nobody's fatal line", stderr: 'FTL\nFTL git-spice: boom\nFTL stderr:\nFTL fatal: x\n', phrase: 'FTL git-spice: boom — fatal: x.' },
      ];
      // see primer §22 (for ... of)
      for (const shape of shapes) {
        const { backend } = fakes({ submit: exited(1, '', shape.stderr) });

        // act
        const result = await backend.push(ROOT, tracked());

        // assert
        expect(result.problem, shape.name).toBe(`${COULD_NOT}${shape.phrase}`);
      }
    });

    it("quotes the detached-HEAD refusal as it is — one FTL line, nothing appended (a caller without the command's check)", async () => {
      // arrange
      const { backend } = fakes({ submit: exited(1, '', 'FTL git-spice: get current branch: in detached HEAD state\n') });

      // act
      const result = await backend.push(ROOT, tracked());

      // assert
      expect(result.problem).toBe(`${COULD_NOT}FTL git-spice: get current branch: in detached HEAD state.`);
    });

    it('turns the other failures into the familiar phrases — the first line, the exit code, a push-sized timeout, the start failure, the detail', async () => {
      // arrange
      const failures: { name: string; result: CommandResult; phrase: string; pushed: string[] }[] = [
        { name: 'no FTL line', result: exited(1, '', 'something else\n'), phrase: 'something else', pushed: [] },
        { name: 'empty stderr', result: exited(1), phrase: 'exited 1', pushed: [] },
        { name: 'whitespace-only stderr', result: exited(1, '', ' \r\n'), phrase: 'exited 1', pushed: [] },
        { name: 'a timeout', result: timedOut(), phrase: 'timed out after 120000 ms', pushed: [] },
        {
          // What `pushed` names here is what git-spice reported before the kill, not what reached the
          // remote: the kill stops git-spice alone and a push in flight lands anyway (verified).
          name: 'a timeout after one branch',
          result: { ...timedOut(), stderr: 'INF Pushed api-refactor\n' },
          phrase: 'timed out after 120000 ms',
          pushed: ['api-refactor'],
        },
        { name: 'never started', result: neverStarted('not-found'), phrase: 'could not start (not-found)', pushed: [] },
        {
          name: 'a signal kill',
          result: { exitCode: null, stdout: '', stderr: '', startFailure: null, timedOut: false, detail: 'Command failed: git-spice' },
          phrase: 'Command failed: git-spice',
          pushed: [],
        },
        { name: 'no exit code and no detail', result: { exitCode: null, stdout: '', stderr: '', startFailure: null, timedOut: false }, phrase: 'no exit code', pushed: [] },
      ];
      for (const failure of failures) {
        const { backend } = fakes({ submit: failure.result });

        // act
        const result = await backend.push(ROOT, tracked());

        // assert
        expect(result.problem, failure.name).toBe(`${COULD_NOT}${failure.phrase}.`);
        expect(result.pushed, failure.name).toStrictEqual(failure.pushed);
      }
    });
  });

  it('never changes the layers it was given, and rejects only when git itself cannot run (E17)', async () => {
    // arrange
    const { backend } = fakes();
    const layers = tracked();
    // see primer §50 (`JSON.stringify` / `JSON.parse`: a deep copy to compare against)
    const before = JSON.parse(JSON.stringify(layers));
    const broken = new FakeGitRunner(new Map());
    const commands = new FakeCommandRunner(new Map());

    // act
    await backend.push(ROOT, layers);

    // assert
    expect(layers).toStrictEqual(before);
    await expect(new GitSpiceBackend(broken, commands).push(ROOT, tracked())).rejects.toThrow('FakeGitRunner');
    expect(commands.calls).toStrictEqual([]);
  });
});
