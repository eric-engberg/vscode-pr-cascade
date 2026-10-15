/**
 * test/unit/readiness.test.ts — the readiness probe as a specification: every `Readiness`
 * member in probe order (gs → initialised → forge → auth), the exact programs and git commands
 * the probe runs — and the ones it must never run — the version rules, and the memo.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no git-spice, no VS Code). Depends on:
 * src/core/backends/gitspice.ts, test/helpers/fakeGit.ts, test/helpers/fakeCommand.ts. The
 * real runner is in test/git/command.git.test.ts; the init check on real git in
 * test/git/readiness.git.test.ts. Plan: §10.1 item 18, §7.13.1, §8 E17/E22/E55/E59/E60/E62/
 * E67/E70/E75, §9.4 `unit/readiness`, §13.2 D56.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { describe, expect, it } from 'vitest';
import type { CommandResult } from '../../src/core/command';
import type { ForgeConfig } from '../../src/core/forge';
import {
  formatVersion,
  GitSpiceBackend,
  gitSpiceVersion,
  GS_ENV,
  isAtLeast,
  MINIMUM_GS_VERSION,
  parseVersion,
  PROBE_TIMEOUT_MS,
} from '../../src/core/backends/gitspice';
import { exited, FakeCommandRunner, neverStarted, timedOut } from '../helpers/fakeCommand';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository every test asks about, and the three git commands the probe may run there
// (as the fake keys them: args joined by spaces).
// see primer §4 (const)
const ROOT = '/work/app';
const REF_KEY = 'rev-parse --verify --quiet refs/spice/data';
const GET_URL_KEY = 'remote get-url origin';
const CONFIG_KEY = 'config --get-regexp ^spice\\.forge\\.';

// An Error as a canned git value means "git exited non-zero": no `refs/spice/data`, no such
// remote, no `spice.forge.*` keys.
const MISSING = new Error('exit 1');

// What git prints for a ref that exists: its SHA.
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n';

// The git-spice banner `--version` prints on this Mac (0.31.2), and what Ghostscript's `gs` prints
// to the probe's own command, `gs --no-prompt --version`: its bare version, exit 0 (Ghostscript
// answers `--version` before reading switches; to any other `--no-prompt …` it says `Unknown
// switch` and exits 1 — the table below has that row too). Neither program is run here.
const BANNER = 'git-spice 0.31.2\nCopyright (C) Abhinav Gupta\n  <https://github.com/abhinav/git-spice>\n';
const GHOSTSCRIPT = exited(0, '10.08.0\n');
const LOGGED_IN = exited(0, '', 'INF github: currently logged in\n');
const NOT_LOGGED_IN = exited(1, '', 'FTL git-spice: github: not logged in\n');

// No `spice.forge.*` configuration, as parseForgeConfig reads it from a config call that
// exited 1.
const NO_CONFIG: ForgeConfig = { kind: null, rejectedKind: null, hosts: new Map() };

/** The fake's key for a program's version banner request. */
// see primer §3 (functions and type annotations) and §12 (template strings)
function versionKey(executable: string): string {
  return `${executable} --no-prompt --version`;
}

/** The fake's key for the login check of one forge kind. */
function authKey(executable: string, kind: string): string {
  return `${executable} --no-prompt auth status --forge ${kind}`;
}

/**
 * A git fake for the happy path — initialised, a github.com origin, nothing configured — with
 * any of the three answers replaced. `undefined` for a field keeps the happy answer.
 */
// see primer §11 (optional `?` fields) and §30 (`??`)
function gitFor(answers: { ref?: string | Error; url?: string | Error; config?: string | Error } = {}): FakeGitRunner {
  return new FakeGitRunner(
    new Map<string, string | Error>([
      [REF_KEY, answers.ref ?? SHA],
      [GET_URL_KEY, answers.url ?? 'git@github.com:org/repo.git\n'],
      [CONFIG_KEY, answers.config ?? MISSING],
    ]),
  );
}

/** One canned answer: the fake's key for a command, and what the program would have produced. */
// see primer §9 (interface)
interface Canned {
  key: string;
  result: CommandResult;
}

/** A command fake where `git-spice` is git-spice 0.31.2 and logged in to GitHub, with answers replaced or added. */
// see primer §31 (type arguments on `new Map`) and §22 (for ... of)
function commandsFor(entries: Canned[] = []): FakeCommandRunner {
  const results = new Map<string, CommandResult>([
    [versionKey('git-spice'), exited(0, BANNER)],
    [authKey('git-spice', 'github'), LOGGED_IN],
  ]);
  for (const entry of entries) {
    results.set(entry.key, entry.result);
  }
  return new FakeCommandRunner(results);
}

/** The forge the happy path's remote names, as detectForge reports it. */
const GITHUB_FORGE = { host: 'github.com', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: true };

// see primer §5 (arrow functions) and §6 (async / await)
describe('GitSpiceBackend.readiness', () => {
  describe('step 1 — finding git-spice (E62)', () => {
    it('is ready when `git-spice` answers `--version` as git-spice, asking nothing of `gs`', async () => {
      // arrange
      const commands = commandsFor();
      const backend = new GitSpiceBackend(gitFor(), commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert
      expect(answer).toStrictEqual({ kind: 'ready', gsPath: 'git-spice', gsVersion: '0.31.2', forge: GITHUB_FORGE });
      expect(commands.calls[0]).toStrictEqual({
        executable: 'git-spice',
        args: ['--no-prompt', '--version'],
        cwd: ROOT,
        env: GS_ENV,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      // see primer §25 (arrays: map)
      expect(commands.calls.map((call) => call.executable)).not.toContain('gs');
    });

    it('moves on to `gs` when there is no `git-spice` — a `go install` build keeps the old name', async () => {
      // arrange
      const commands = commandsFor([
        { key: versionKey('git-spice'), result: neverStarted('not-found') },
        { key: versionKey('gs'), result: exited(0, BANNER) },
        { key: authKey('gs', 'github'), result: LOGGED_IN },
      ]);
      const backend = new GitSpiceBackend(gitFor(), commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert: the one that answered is the one later commands will run
      expect(answer).toStrictEqual({ kind: 'ready', gsPath: 'gs', gsVersion: '0.31.2', forge: GITHUB_FORGE });
      expect(commands.calls.map((call) => call.executable)).toEqual(['git-spice', 'gs', 'gs']);
    });

    // Every way a candidate can fail to answer as git-spice; each moves the probe to the next.
    // see primer §9 (an object type written inline, with `[]` after it)
    const notGitSpice: { result: CommandResult; note: string }[] = [
      { result: neverStarted('not-found'), note: 'nothing at that name (E62)' },
      { result: neverStarted('not-executable'), note: 'a directory, or a file without the execute bit' },
      { result: GHOSTSCRIPT, note: "Ghostscript's bare version to `--no-prompt --version` — exit 0 proves nothing, the name does" },
      { result: exited(1, "   Unknown switch '--no-prompt'.\n"), note: 'Ghostscript refusing a flag it does not know (any other argument after `--no-prompt`)' },
      { result: exited(0, ''), note: 'a program that prints nothing (`true`)' },
      { result: exited(0, '--no-prompt --version\n'), note: 'a program that echoes its arguments' },
      { result: timedOut(), note: 'a program that hangs past the probe timeout' },
    ];

    for (const candidate of notGitSpice) {
      it(`tries the next name when a candidate answers with ${candidate.note}`, async () => {
        // arrange
        const commands = commandsFor([
          { key: versionKey('git-spice'), result: candidate.result },
          { key: versionKey('gs'), result: exited(0, BANNER) },
          { key: authKey('gs', 'github'), result: LOGGED_IN },
        ]);
        const backend = new GitSpiceBackend(gitFor(), commands);

        // act
        const answer = await backend.readiness(ROOT, 'origin');

        // assert
        expect(answer.kind).toBe('ready');
        expect(commands.calls[1].executable).toBe('gs');
      });
    }

    it('reports gs-missing with every name it tried when none answers, asking git nothing (E62)', async () => {
      // arrange
      const git = gitFor();
      const commands = commandsFor([
        { key: versionKey('git-spice'), result: neverStarted('not-found') },
        { key: versionKey('gs'), result: neverStarted('not-found') },
      ]);
      const backend = new GitSpiceBackend(git, commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert
      expect(answer).toStrictEqual({ kind: 'gs-missing', tried: ['git-spice', 'gs'] });
      expect(commands.calls.length).toBe(2);
      expect(git.calls).toEqual([]);
    });

    it('counts Ghostscript as tried — the name was asked and did not answer as git-spice (the Homebrew Mac, plan §13.1)', async () => {
      // arrange: no git-spice at all, and `gs` is Ghostscript
      const commands = commandsFor([
        { key: versionKey('git-spice'), result: neverStarted('not-found') },
        { key: versionKey('gs'), result: GHOSTSCRIPT },
      ]);
      const backend = new GitSpiceBackend(gitFor(), commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert
      expect(answer).toStrictEqual({ kind: 'gs-missing', tried: ['git-spice', 'gs'] });
    });

    it('tries only the configured executable when prCascade.gsPath is set', async () => {
      // arrange: a full path. Neither default name may be consulted: `git-spice` is canned as
      // missing, and `gs` not at all, so asking it would throw
      const commands = commandsFor([
        { key: versionKey('git-spice'), result: neverStarted('not-found') },
        { key: versionKey('/opt/homebrew/bin/git-spice'), result: exited(0, BANNER) },
        { key: authKey('/opt/homebrew/bin/git-spice', 'github'), result: LOGGED_IN },
      ]);
      const backend = new GitSpiceBackend(gitFor(), commands, '/opt/homebrew/bin/git-spice');

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert
      expect(answer).toStrictEqual({ kind: 'ready', gsPath: '/opt/homebrew/bin/git-spice', gsVersion: '0.31.2', forge: GITHUB_FORGE });
      expect(commands.calls.map((call) => call.executable)).toEqual(['/opt/homebrew/bin/git-spice', '/opt/homebrew/bin/git-spice']);
    });

    it('treats a setting that is only whitespace as unset — the two default names are tried', async () => {
      // arrange: a setting cleared by hand, leaving a space behind
      const commands = commandsFor();
      const backend = new GitSpiceBackend(gitFor(), commands, '  ');

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert
      expect(answer.kind).toBe('ready');
      expect(commands.calls[0].executable).toBe('git-spice');
    });

    it('reports a configured executable that is not git-spice as gs-missing with just that name', async () => {
      // arrange: the setting points at Ghostscript, or at nothing
      const commands = commandsFor([{ key: versionKey('/usr/local/bin/gs'), result: GHOSTSCRIPT }]);
      const backend = new GitSpiceBackend(gitFor(), commands, '/usr/local/bin/gs');

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert: no fallback to the two default names
      expect(answer).toStrictEqual({ kind: 'gs-missing', tried: ['/usr/local/bin/gs'] });
      expect(commands.calls.length).toBe(1);
    });

    it('rejects, naming the root, when the directory itself cannot be used — a fault of E17\'s class, not a readiness state', async () => {
      // arrange
      const commands = commandsFor([{ key: versionKey('git-spice'), result: neverStarted('unusable-directory') }]);
      const backend = new GitSpiceBackend(gitFor(), commands);

      // act
      const result = backend.readiness(ROOT, 'origin');

      // assert: the probe's own message, not the fake's — and no second name was tried
      await expect(result).rejects.toThrow('readiness: /work/app cannot be used as the working directory');
      expect(commands.calls.length).toBe(1);
    });
  });

  describe('step 1 — the version floor', () => {
    // Each banner token the probe may meet and what it means, one test per row.
    const versions: { token: string; outcome: 'ready' | 'gs-too-old'; note: string }[] = [
      { token: '0.31.2', outcome: 'ready', note: 'the version measured on this Mac' },
      { token: '0.31.0', outcome: 'ready', note: 'the floor itself' },
      { token: '1.0.0', outcome: 'ready', note: 'a later major' },
      { token: 'v0.31.2', outcome: 'ready', note: 'a leading v' },
      { token: '0.32.0-dev', outcome: 'ready', note: 'a development build of a later version — the suffix is ignored' },
      { token: '0.31.0-rc1', outcome: 'ready', note: 'a pre-release of the floor — it has the commands the floor stands for' },
      { token: '0.30.9', outcome: 'gs-too-old', note: 'one patch below' },
      { token: '0.9.99', outcome: 'gs-too-old', note: 'an old minor with a high patch — numbers, not text, are compared' },
      { token: 'dev', outcome: 'gs-too-old', note: 'a `go install` build with no version — git-spice, but unconfirmed' },
      { token: '0.31', outcome: 'gs-too-old', note: 'two numbers only — not a version this probe can read' },
    ];

    for (const row of versions) {
      it(`reads \`git-spice ${row.token}\` as ${row.outcome} — ${row.note}`, async () => {
        // arrange
        const commands = commandsFor([
          { key: versionKey('git-spice'), result: exited(0, `git-spice ${row.token}\n`) },
        ]);
        const backend = new GitSpiceBackend(gitFor(), commands);

        // act
        const answer = await backend.readiness(ROOT, 'origin');

        // assert
        expect(answer.kind).toBe(row.outcome);
      });
    }

    it('reports gs-too-old with the token as printed and the floor it fell short of', async () => {
      // arrange
      const git = gitFor();
      const commands = commandsFor([
        { key: versionKey('git-spice'), result: exited(0, 'git-spice 0.30.9\nCopyright …\n') },
      ]);
      const backend = new GitSpiceBackend(git, commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert: and it stops there — no git command, no login check
      expect(answer).toStrictEqual({ kind: 'gs-too-old', gsPath: 'git-spice', found: '0.30.9', minimum: '0.31.0' });
      expect(git.calls).toEqual([]);
      expect(commands.calls.length).toBe(1);
    });

    it('keeps the token as printed in gsVersion — `v0.31.2` stays `v0.31.2`', async () => {
      // arrange
      const commands = commandsFor([{ key: versionKey('git-spice'), result: exited(0, 'git-spice v0.31.2\n') }]);
      const backend = new GitSpiceBackend(gitFor(), commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert
      expect(answer).toStrictEqual({ kind: 'ready', gsPath: 'git-spice', gsVersion: 'v0.31.2', forge: GITHUB_FORGE });
    });

    it('reads a banner with CRLF line endings', async () => {
      // arrange
      const commands = commandsFor([
        { key: versionKey('git-spice'), result: exited(0, 'git-spice 0.31.2\r\nCopyright …\r\n') },
      ]);
      const backend = new GitSpiceBackend(gitFor(), commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert
      expect(answer.kind).toBe('ready');
    });
  });

  describe('step 2 — the repository is initialised for git-spice (E59)', () => {
    it('reports not-initialized when refs/spice/data does not exist, asking git exactly that and nothing else', async () => {
      // arrange
      const git = gitFor({ ref: MISSING });
      const commands = commandsFor();
      const backend = new GitSpiceBackend(git, commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert: the check has no side effect — `rev-parse --verify --quiet` of the ref, never
      // `gs log`, which would initialise the repository itself (plan §7.6)
      expect(answer).toStrictEqual({ kind: 'not-initialized', gsPath: 'git-spice' });
      expect(git.calls).toEqual([{ args: ['rev-parse', '--verify', '--quiet', 'refs/spice/data'], cwd: ROOT }]);
      expect(commands.calls.length).toBe(1);
    });
  });

  describe('step 3 — the forge', () => {
    it('reports no-remote when the remote does not exist (E25)', async () => {
      // arrange
      const commands = commandsFor();
      const backend = new GitSpiceBackend(gitFor({ url: MISSING }), commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert: no login check for a forge nobody knows
      expect(answer).toStrictEqual({ kind: 'no-remote', remote: 'origin' });
      expect(commands.calls.length).toBe(1);
    });

    it('reports remote-unparseable with the URL for a local-path remote (E21)', async () => {
      // act
      const answer = await new GitSpiceBackend(gitFor({ url: '/work/origin.git\n' }), commandsFor()).readiness(ROOT, 'origin');

      // assert
      expect(answer).toStrictEqual({ kind: 'remote-unparseable', remote: 'origin', url: '/work/origin.git' });
    });

    it('reports forge-unrecognized with the configuration for a host nobody has named (E60)', async () => {
      // act
      const answer = await new GitSpiceBackend(gitFor({ url: 'git@git.corp.com:org/repo.git\n' }), commandsFor()).readiness(ROOT, 'origin');

      // assert
      expect(answer).toStrictEqual({
        kind: 'forge-unrecognized',
        forge: { host: 'git.corp.com', port: '', owner: 'org', repo: 'repo', kind: 'unknown', recognizedByGitSpice: false },
        config: NO_CONFIG,
      });
    });

    it('reports forge-unrecognized for a *.ghe.com host git-spice will not match (E70)', async () => {
      // act
      const answer = await new GitSpiceBackend(gitFor({ url: 'git@eu.ghe.com:org/repo.git\n' }), commandsFor()).readiness(ROOT, 'origin');

      // assert
      // see primer §59 (narrowing on `kind` before reading a member's own fields)
      expect(answer.kind).toBe('forge-unrecognized');
      if (answer.kind === 'forge-unrecognized') {
        expect(answer.forge.kind).toBe('github');
        expect(answer.forge.recognizedByGitSpice).toBe(false);
      }
    });

    it('carries the configuration that disabled github.com — a rejected spice.forge.kind — so the message can name it', async () => {
      // act
      const answer = await new GitSpiceBackend(gitFor({ config: 'spice.forge.kind GitHub\n' }), commandsFor()).readiness(ROOT, 'origin');

      // assert
      expect(answer.kind).toBe('forge-unrecognized');
      if (answer.kind === 'forge-unrecognized') {
        expect(answer.config.rejectedKind).toBe('GitHub');
      }
    });

    // The forges v1 does not serve (E75): reported as unsupported, never offered a
    // `spice.forge.*` key — even Azure, which git-spice does not recognise either.
    const unsupported: { url: string; kind: string }[] = [
      { url: 'git@bitbucket.org:team/repo.git\n', kind: 'bitbucket' },
      { url: 'git@codeberg.org:org/repo.git\n', kind: 'forgejo' },
      { url: 'https://dev.azure.com/org/project/_git/repo\n', kind: 'azuredevops' },
    ];

    for (const row of unsupported) {
      it(`reports forge-unsupported for ${row.kind} (E75)`, async () => {
        // act
        const answer = await new GitSpiceBackend(gitFor({ url: row.url }), commandsFor()).readiness(ROOT, 'origin');

        // assert
        expect(answer.kind).toBe('forge-unsupported');
        if (answer.kind === 'forge-unsupported') {
          expect(answer.forge.kind).toBe(row.kind);
        }
      });
    }

    it('runs no login check when the forge step fails', async () => {
      // arrange
      const commands = commandsFor();
      const backend = new GitSpiceBackend(gitFor({ url: 'git@bitbucket.org:team/repo.git\n' }), commands);

      // act
      await backend.readiness(ROOT, 'origin');

      // assert: the version banner and nothing more
      expect(commands.calls.map((call) => call.args)).toEqual([['--no-prompt', '--version']]);
    });

    it('asks about the remote prCascade.remote names', async () => {
      // arrange
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [REF_KEY, SHA],
          ['remote get-url upstream', 'git@github.com:org/repo.git\n'],
          [CONFIG_KEY, MISSING],
        ]),
      );

      // act
      await new GitSpiceBackend(git, commandsFor()).readiness(ROOT, 'upstream');

      // assert
      expect(git.calls[1]).toEqual({ args: ['remote', 'get-url', 'upstream'], cwd: ROOT });
    });
  });

  describe('step 4 — logged in to the forge (E67)', () => {
    it('reports not-logged-in when `auth status --forge <kind>` exits non-zero, asking exactly that', async () => {
      // arrange
      const commands = commandsFor([{ key: authKey('git-spice', 'github'), result: NOT_LOGGED_IN }]);
      const backend = new GitSpiceBackend(gitFor(), commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert
      expect(answer).toStrictEqual({ kind: 'not-logged-in', gsPath: 'git-spice', forge: GITHUB_FORGE });
      expect(commands.calls[1]).toStrictEqual({
        executable: 'git-spice',
        args: ['--no-prompt', 'auth', 'status', '--forge', 'github'],
        cwd: ROOT,
        env: GS_ENV,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
    });

    it('asks git-spice about the kind the forge step settled on — gitlab for a gitlab.com remote', async () => {
      // arrange
      const commands = commandsFor([{ key: authKey('git-spice', 'gitlab'), result: LOGGED_IN }]);
      const backend = new GitSpiceBackend(gitFor({ url: 'https://gitlab.com/group/sub/repo.git\n' }), commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert
      expect(answer.kind).toBe('ready');
      expect(commands.calls[1].args).toEqual(['--no-prompt', 'auth', 'status', '--forge', 'gitlab']);
    });

    it('follows spice.forge.kind, as git-spice does — kind gitlab beside a github.com remote asks GitLab', async () => {
      // arrange
      const commands = commandsFor([{ key: authKey('git-spice', 'gitlab'), result: LOGGED_IN }]);
      const backend = new GitSpiceBackend(gitFor({ config: 'spice.forge.kind gitlab\n' }), commands);

      // act
      const answer = await backend.readiness(ROOT, 'origin');

      // assert
      expect(answer.kind).toBe('ready');
      expect(commands.calls[1].args).toEqual(['--no-prompt', 'auth', 'status', '--forge', 'gitlab']);
    });

    it('treats a login check that never finished as not logged in — a hung keychain prompt, say', async () => {
      // act
      const answer = await new GitSpiceBackend(gitFor(), commandsFor([{ key: authKey('git-spice', 'github'), result: timedOut() }])).readiness(ROOT, 'origin');

      // assert
      expect(answer.kind).toBe('not-logged-in');
    });

    it('does not read stderr — any exit 0 is logged in, any other exit is not', async () => {
      // act
      const quiet = await new GitSpiceBackend(gitFor(), commandsFor([{ key: authKey('git-spice', 'github'), result: exited(0) }])).readiness(ROOT, 'origin');
      const keychain = await new GitSpiceBackend(
        gitFor(),
        commandsFor([{ key: authKey('git-spice', 'github'), result: exited(1, '', 'FTL git-spice: load authentication token: keychain locked\n') }]),
      ).readiness(ROOT, 'origin');

      // assert
      expect(quiet.kind).toBe('ready');
      expect(keychain.kind).toBe('not-logged-in');
    });
  });

  describe('the whole probe (E55)', () => {
    it('is exactly two programs and three git commands on the happy path, in order — and no gh (step 5 is item 23\'s)', async () => {
      // arrange
      const git = gitFor();
      const commands = commandsFor();

      // act
      await new GitSpiceBackend(git, commands).readiness(ROOT, 'origin');

      // assert
      expect(commands.calls.map((call) => `${call.executable} ${call.args.join(' ')}`)).toEqual([
        'git-spice --no-prompt --version',
        'git-spice --no-prompt auth status --forge github',
      ]);
      expect(git.calls.map((call) => call.args.join(' '))).toEqual([REF_KEY, GET_URL_KEY, CONFIG_KEY]);
    });

    it('puts --no-prompt first and the git-spice environment on every program it runs', async () => {
      // arrange
      const commands = commandsFor();

      // act
      await new GitSpiceBackend(gitFor(), commands).readiness(ROOT, 'origin');

      // assert
      for (const call of commands.calls) {
        expect(call.args[0]).toBe('--no-prompt');
        expect(call.env).toStrictEqual({ NO_COLOR: '1', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
        expect(call.cwd).toBe(ROOT);
        // The literal, not the constant: the plan says 15 seconds, and a constant compared with
        // itself would pass at any value. (See primer §27 for the `_` in `15_000`.)
        expect(call.timeoutMs).toBe(15_000);
      }
    });
  });

  describe('the memo', () => {
    it('answers a second question about the same repository from memory — the same object, no program run', async () => {
      // arrange
      const git = gitFor();
      const commands = commandsFor();
      const backend = new GitSpiceBackend(git, commands);
      const first = await backend.readiness(ROOT, 'origin');
      const programsRun = commands.calls.length;
      const gitRun = git.calls.length;

      // act
      const second = await backend.readiness(ROOT, 'origin');

      // assert
      expect(second).toBe(first);
      expect(commands.calls.length).toBe(programsRun);
      expect(git.calls.length).toBe(gitRun);
    });

    it('does not remember a failure — the next refresh probes again, and finds the login that happened meanwhile', async () => {
      // arrange
      const results = new Map<string, CommandResult>([
        [versionKey('git-spice'), exited(0, BANNER)],
        [authKey('git-spice', 'github'), NOT_LOGGED_IN],
      ]);
      const commands = new FakeCommandRunner(results);
      const backend = new GitSpiceBackend(gitFor(), commands);
      const before = await backend.readiness(ROOT, 'origin');

      // act: the user ran `gs auth login` in the terminal item 19 opens
      results.set(authKey('git-spice', 'github'), LOGGED_IN);
      const after = await backend.readiness(ROOT, 'origin');

      // assert
      expect(before.kind).toBe('not-logged-in');
      expect(after.kind).toBe('ready');
      expect(commands.calls.length).toBe(4);
    });

    it('does not remember gs-missing either — an install is noticed by the next refresh', async () => {
      // arrange
      const results = new Map<string, CommandResult>([
        [versionKey('git-spice'), neverStarted('not-found')],
        [versionKey('gs'), neverStarted('not-found')],
      ]);
      const commands = new FakeCommandRunner(results);
      const backend = new GitSpiceBackend(gitFor(), commands);
      await backend.readiness(ROOT, 'origin');

      // act
      results.set(versionKey('git-spice'), exited(0, BANNER));
      results.set(authKey('git-spice', 'github'), LOGGED_IN);
      const after = await backend.readiness(ROOT, 'origin');

      // assert
      expect(after.kind).toBe('ready');
    });

    it('forgets a remembered ready when told to — the next question probes again, and finds a logout', async () => {
      // arrange: ready and remembered; then the user runs `gs auth logout` in a terminal
      const results = new Map<string, CommandResult>([
        [versionKey('git-spice'), exited(0, BANNER)],
        [authKey('git-spice', 'github'), LOGGED_IN],
      ]);
      const commands = new FakeCommandRunner(results);
      const backend = new GitSpiceBackend(gitFor(), commands);
      const remembered = await backend.readiness(ROOT, 'origin');
      results.set(authKey('git-spice', 'github'), NOT_LOGGED_IN);

      // act: what the setup command does before it asks (item 19b, D57)
      backend.forget(ROOT, 'origin');
      const after = await backend.readiness(ROOT, 'origin');

      // assert: the memo would have said ready; asked again, the probe ran all its programs again
      expect(remembered.kind).toBe('ready');
      expect(after.kind).toBe('not-logged-in');
      expect(commands.calls.length).toBe(4);
    });

    it('forgets only the repository and remote it is told — another remote stays remembered', async () => {
      // arrange
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [REF_KEY, SHA],
          [GET_URL_KEY, 'git@github.com:org/repo.git\n'],
          ['remote get-url upstream', 'git@github.com:org/upstream.git\n'],
          [CONFIG_KEY, MISSING],
        ]),
      );
      const commands = commandsFor();
      const backend = new GitSpiceBackend(git, commands);
      const origin = await backend.readiness(ROOT, 'origin');
      await backend.readiness(ROOT, 'upstream');
      const programsRun = commands.calls.length;

      // act
      backend.forget(ROOT, 'upstream');
      const originAgain = await backend.readiness(ROOT, 'origin');

      // assert: origin answered from memory — the same object, nothing run
      expect(originAgain).toBe(origin);
      expect(commands.calls.length).toBe(programsRun);
    });

    it('treats another remote of the same repository as a new question', async () => {
      // arrange
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          [REF_KEY, SHA],
          [GET_URL_KEY, 'git@github.com:org/repo.git\n'],
          ['remote get-url upstream', 'git@github.com:org/upstream.git\n'],
          [CONFIG_KEY, MISSING],
        ]),
      );
      const backend = new GitSpiceBackend(git, commandsFor());
      await backend.readiness(ROOT, 'origin');

      // act
      const upstream = await backend.readiness(ROOT, 'upstream');

      // assert
      expect(upstream.kind).toBe('ready');
      if (upstream.kind === 'ready') {
        expect(upstream.forge.repo).toBe('upstream');
      }
    });

    it('keeps repositories apart — two roots, two login states (E22)', async () => {
      // arrange: both repositories are github.com clones; only the first is logged in
      const git = gitFor();
      const commands = commandsFor();
      commands.answerIn('/work/b', 'git-spice', ['--no-prompt', 'auth', 'status', '--forge', 'github'], NOT_LOGGED_IN);
      const backend = new GitSpiceBackend(git, commands);

      // act
      const a = await backend.readiness('/work/a', 'origin');
      const b = await backend.readiness('/work/b', 'origin');
      const aAgain = await backend.readiness('/work/a', 'origin');
      const bAgain = await backend.readiness('/work/b', 'origin');

      // assert: a answered from memory, b probed twice
      expect(a.kind).toBe('ready');
      expect(b.kind).toBe('not-logged-in');
      expect(aAgain).toBe(a);
      expect(bAgain.kind).toBe('not-logged-in');
      expect(commands.calls.filter((call) => call.cwd === '/work/a').length).toBe(2);
      expect(commands.calls.filter((call) => call.cwd === '/work/b').length).toBe(4);
    });
  });

  describe('when git itself cannot run (E17)', () => {
    it('lets the rejection through unchanged, after git-spice has answered', async () => {
      // arrange: nothing is canned for git, so its first question throws — the way the real
      // runner does when git is missing; readiness has no member for that and must not hide it
      const commands = commandsFor();
      const backend = new GitSpiceBackend(new FakeGitRunner(new Map()), commands);

      // act
      const result = backend.readiness(ROOT, 'origin');

      // assert
      await expect(result).rejects.toThrow('no canned output');
      expect(commands.calls.length).toBe(1);
    });
  });
});

describe('the version helpers', () => {
  // Text → the three numbers, or null. One test per row, so a failure names the text.
  // see primer §10 (union types: `Version | null` as a row's expectation)
  const parsed: { text: string; expected: { major: number; minor: number; patch: number } | null }[] = [
    { text: '0.31.2', expected: { major: 0, minor: 31, patch: 2 } },
    { text: 'v1.2.3-rc1', expected: { major: 1, minor: 2, patch: 3 } },
    { text: '0.32.0-dev (abc1234 2026-07-21)', expected: { major: 0, minor: 32, patch: 0 } },
    { text: '0.31', expected: null },
    { text: 'dev', expected: null },
    { text: '', expected: null },
    { text: 'GPL Ghostscript 10.08.0', expected: null },
  ];

  for (const row of parsed) {
    it(`parseVersion reads ${JSON.stringify(row.text)} as ${row.expected === null ? 'no version' : 'three numbers, ignoring what follows'}`, () => {
      // act
      const version = parseVersion(row.text);

      // assert
      expect(version).toStrictEqual(row.expected);
    });
  }

  const compared: { major: number; minor: number; patch: number; atLeast: boolean }[] = [
    { major: 0, minor: 31, patch: 0, atLeast: true },
    { major: 0, minor: 31, patch: 1, atLeast: true },
    { major: 1, minor: 0, patch: 0, atLeast: true },
    { major: 0, minor: 30, patch: 99, atLeast: false },
    { major: 0, minor: 9, patch: 99, atLeast: false },
  ];

  for (const row of compared) {
    it(`isAtLeast puts ${row.major}.${row.minor}.${row.patch} ${row.atLeast ? 'at or above' : 'below'} the 0.31.0 floor — numbers, not text`, () => {
      // act
      const result = isAtLeast({ major: row.major, minor: row.minor, patch: row.patch }, MINIMUM_GS_VERSION);

      // assert
      expect(result).toBe(row.atLeast);
    });
  }

  it('formatVersion writes the floor the way a message quotes it', () => {
    // act
    const text = formatVersion(MINIMUM_GS_VERSION);

    // assert
    expect(text).toBe('0.31.0');
  });

  // Program output → git-spice's version token, or null for any other program's.
  const banners: { stdout: string; token: string | null; note: string }[] = [
    { stdout: BANNER, token: '0.31.2', note: 'the release banner' },
    { stdout: 'git-spice dev (go install)\n', token: 'dev', note: 'a build with no version number' },
    { stdout: '10.08.0\n', token: null, note: "Ghostscript's bare version" },
    { stdout: '', token: null, note: 'nothing at all' },
    { stdout: "   Unknown switch '--no-prompt'.\n", token: null, note: "Ghostscript refusing a flag" },
  ];

  for (const row of banners) {
    it(`gitSpiceVersion ${row.token === null ? 'refuses' : 'takes the token from'} ${row.note}`, () => {
      // act
      const token = gitSpiceVersion(row.stdout);

      // assert
      expect(token).toBe(row.token);
    });
  }
});
