/**
 * test/unit/ghstatus.test.ts — the gh half of the readiness probe as a specification (plan §7.13.1
 * step 5, §7.5's auth preflight): the three questions in cost order and the exact request of each
 * spawn (the variables spelled out, not the constant); gh known by its banner and read against the
 * 2.90.0 floor; a program that is not gh, six ways, one spawn each; the extension present, absent
 * (gh's own hint), an old gh's unknown command, a timeout — the login never asked while anything is
 * missing; `auth status` 0 / 1 / 4 / never started / timed out, the offline shape and the
 * empty-default-token shape read exactly as "not logged in" (the one rule the probe takes on faith,
 * D65); the host lower-cased in the flag and in GH_HOST, and the same host in both; the setting
 * empty, blank, set, and set to something that is not gh; the two token readers.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no gh, no VS Code). Depends on:
 * src/core/ghstatus.ts, test/helpers/fakeCommand.ts. The real gh is test/git/gh.git.test.ts; the
 * step inside the whole probe is test/unit/readiness.test.ts. Depended on by: nothing. Plan: §7.5,
 * §7.13.1, §8 E22/E23/E24/E62b, §9.4 `unit/ghstatus`, §10.1 item 23a, §13.2 D65.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { describe, expect, it } from 'vitest';
import type { CommandResult } from '../../src/core/command';
import { GH_CANDIDATE, GH_STACK_EXTENSION, ghReadiness, ghStackVersionToken, ghVersionToken, MINIMUM_GH_VERSION, runGh } from '../../src/core/ghstatus';
import { exited, FakeCommandRunner, neverStarted, timedOut } from '../helpers/fakeCommand';

// The repository every question is about, and the host its remote names.
// see primer §4 (const)
const ROOT = '/work/app';
const HOST = 'github.com';

// What gh 2.102.0 prints (measured 2026-10-14, plan §13.4): the two-line banner; the extension's
// own banner, and gh's three-line hint when it is absent; the logged-in report (on stdout — the
// account is a made-up `test`), and three shapes of exit 1 that the probe reads as one — the
// per-host sentence a host with no account gets, the empty-default-token validation GH_HOST makes
// gh attempt for such a host (the one the probe actually meets), and a token gh could not validate
// (revoked, or no network).
const GH_BANNER = 'gh version 2.102.0 (2026-09-30)\nhttps://github.com/cli/cli/releases/tag/v2.102.0\n';
const GH_STACK_PRESENT = exited(0, 'gh stack version 0.1.1\n');
const GH_STACK_ABSENT = exited(1, '', 'gh stack is available as an official extension.\nTo install it, run:\n  gh extension install github/gh-stack\n');
const GH_LOGGED_IN = exited(0, 'github.com\n  ✓ Logged in to github.com account test (keyring)\n  - Active account: true\n  - Git operations protocol: ssh\n');
const GH_NO_ACCOUNT = exited(1, '', 'You are not logged into any accounts on github.com\n');
const GH_NO_DEFAULT = exited(
  1,
  '',
  'github.com\n  X Failed to log in to github.com using token (default)\n  - Active account: true\n  - The token in default is invalid.\n  - To re-authenticate, run: gh auth login -h github.com\n',
);
const GH_OFFLINE = exited(
  1,
  '',
  'github.com\n  X Failed to log in to github.com account test (keyring)\n  - Active account: true\n  - The token in keyring is invalid.\n  - To re-authenticate, run: gh auth refresh -h github.com\n',
);

// The variables every gh spawn must carry, as a literal: the plan names them, and a constant
// compared with itself would pass at any value (readiness.test's rule).
const GH_ENV_LITERAL = {
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
  NO_COLOR: '1',
  GH_TELEMETRY: 'false',
  CI: undefined,
  GITHUB_ACTIONS: undefined,
  GH_HOST: 'github.com',
};

/** One canned answer: the fake's key for a command, and what the program would have produced. */
// see primer §9 (interface)
interface Canned {
  key: string;
  result: CommandResult;
}

/** The fake's keys for the three questions, for one executable and one (lower-cased) host. */
// see primer §12 (template strings)
const versionKey = (executable: string): string => `${executable} --version`;
const stackKey = (executable: string): string => `${executable} stack --version`;
const authKey = (executable: string, host: string): string => `${executable} auth status --hostname ${host}`;

/** A command fake where `executable` is gh 2.102.0 with its extension, logged in to `host`, with answers replaced or added. */
// see primer §31 (type arguments on `new Map`), §22 (for ... of) and §13 (default parameters)
function runnerFor(entries: Canned[] = [], executable: string = 'gh', host: string = HOST): FakeCommandRunner {
  const results = new Map<string, CommandResult>([
    [versionKey(executable), exited(0, GH_BANNER)],
    [stackKey(executable), GH_STACK_PRESENT],
    [authKey(executable, host), GH_LOGGED_IN],
  ]);
  for (const entry of entries) {
    results.set(entry.key, entry.result);
  }
  return new FakeCommandRunner(results);
}

/** The whole step for the repository at ROOT, `gh` from PATH unless a setting is given. */
// see primer §6 (async / await)
function ready(runner: FakeCommandRunner, ghPath: string = '', host: string = HOST) {
  return ghReadiness(runner, ghPath, ROOT, host);
}

/** The arguments of every spawn so far, joined — what the tests compare the order against. */
// see primer §25 (arrays: `map`, `join`)
function asked(runner: FakeCommandRunner): string[] {
  return runner.calls.map((call) => call.args.join(' '));
}

// see primer §5 (arrow functions)
describe('ghReadiness', () => {
  describe('the three questions, in cost order', () => {
    it('is gh-ready when all three answer, asking exactly three questions — the banner, the extension, the login', async () => {
      // arrange
      const runner = runnerFor();

      // act
      const answer = await ready(runner);

      // assert
      expect(answer).toStrictEqual({ kind: 'gh-ready', ghPath: 'gh', ghVersion: '2.102.0' });
      expect(asked(runner)).toStrictEqual(['--version', 'stack --version', 'auth status --hostname github.com']);
    });

    it('spells the first spawn exactly — executable, arguments, directory, variables, timeout', async () => {
      // arrange
      const runner = runnerFor();

      // act
      await ready(runner);

      // assert: the environment as a literal, GH_HOST among the five (plan §7.5); 15 s as the plan says
      expect(runner.calls[0]).toStrictEqual({ executable: 'gh', args: ['--version'], cwd: ROOT, env: GH_ENV_LITERAL, timeoutMs: 15_000 });
    });

    it('puts the same variables, directory and timeout on every gh spawn', async () => {
      // arrange
      const runner = runnerFor();

      // act
      await ready(runner);

      // assert
      expect(runner.calls.length).toBe(3);
      for (const call of runner.calls) {
        expect(call.env).toStrictEqual(GH_ENV_LITERAL);
        expect(call.cwd).toBe(ROOT);
        expect(call.timeoutMs).toBe(15_000);
      }
    });

    it('clears CI and GITHUB_ACTIONS from every gh spawn, so a probe meant to be read-only never installs anything', async () => {
      // arrange
      const runner = runnerFor();

      // act
      await ready(runner);

      // assert: the two keys are present and undefined — the runner removes a variable set so
      // (under `CI=true` gh treats itself as automation and `gh stack --version` downloads the
      // extension instead of printing the hint; measured in this item's first CI run)
      for (const call of runner.calls) {
        expect(Object.keys(call.env ?? {})).toEqual(expect.arrayContaining(['CI', 'GITHUB_ACTIONS']));
        expect(call.env?.CI).toBeUndefined();
        expect(call.env?.GITHUB_ACTIONS).toBeUndefined();
      }
    });
  });

  describe('the banner and the floor (E62b)', () => {
    // Each token gh's banner may carry and what it means, one test per row.
    // see primer §9 (an object type written inline, with `[]` after it)
    const versions: { token: string; outcome: 'gh-ready' | 'gh-missing'; note: string }[] = [
      { token: '2.102.0', outcome: 'gh-ready', note: 'the version measured on this Mac' },
      { token: '2.90.0', outcome: 'gh-ready', note: 'the floor itself' },
      { token: 'v2.90.0', outcome: 'gh-ready', note: 'a leading v' },
      { token: '2.90.0-rc1', outcome: 'gh-ready', note: 'a pre-release of the floor — a floor on features' },
      { token: '2.89.9', outcome: 'gh-missing', note: 'one patch below' },
      { token: '1.14.0', outcome: 'gh-missing', note: 'an old major — numbers, not text, are compared' },
      { token: 'DEV', outcome: 'gh-missing', note: 'a source build with no number — gh, but not confirmably new enough' },
    ];

    for (const row of versions) {
      it(`reads \`gh version ${row.token}\` as ${row.outcome} — ${row.note}`, async () => {
        // arrange
        const runner = runnerFor([{ key: versionKey('gh'), result: exited(0, `gh version ${row.token} (2026-01-01)\n`) }]);

        // act
        const answer = await ready(runner);

        // assert
        expect(answer.kind).toBe(row.outcome);
        // see primer §59 (narrowing on `kind` before reading a member's own fields)
        if (answer.kind === 'gh-missing') {
          // too old, not absent: the token as printed, the path that answered, gh alone listed
          expect(answer.missing).toStrictEqual(['gh']);
          expect(answer.ghVersion).toBe(row.token);
          expect(answer.ghPath).toBe('gh');
        }
      });
    }

    // Every way the first spawn can fail to answer as gh: one spawn, both listed, nothing to name.
    const notGh: { result: CommandResult; note: string }[] = [
      { result: neverStarted('not-found'), note: 'nothing at that name (E24)' },
      { result: neverStarted('not-executable'), note: 'a directory, or a file without the execute bit' },
      { result: exited(0, ''), note: 'a program that prints nothing (`true`)' },
      { result: exited(0, '--version\n'), note: 'a program that echoes its arguments' },
      { result: exited(1, '', 'gh: unknown option\n'), note: 'another program called gh' },
      { result: timedOut(), note: 'a program that hangs past the timeout' },
    ];

    for (const candidate of notGh) {
      it(`reports gh-missing with both listed, after one spawn, when gh --version answers with ${candidate.note}`, async () => {
        // arrange
        const runner = runnerFor([{ key: versionKey('gh'), result: candidate.result }]);

        // act
        const answer = await ready(runner);

        // assert: the extension is not asked about — it cannot be there without gh
        expect(answer).toStrictEqual({ kind: 'gh-missing', missing: ['gh', 'gh-stack'], ghVersion: null, ghMinimum: '2.90.0', ghPath: null });
        expect(runner.calls.length).toBe(1);
      });
    }

    it('reads a banner with CRLF line endings, and one with no release line', async () => {
      // arrange
      const crlf = runnerFor([{ key: versionKey('gh'), result: exited(0, 'gh version 2.102.0 (2026-09-30)\r\nhttps://github.com/cli/cli/releases/tag/v2.102.0\r\n') }]);
      const bare = runnerFor([{ key: versionKey('gh'), result: exited(0, 'gh version 2.102.0 (2026-09-30)\n') }]);

      // act
      const fromCrlf = await ready(crlf);
      const fromBare = await ready(bare);

      // assert
      expect(fromCrlf).toStrictEqual({ kind: 'gh-ready', ghPath: 'gh', ghVersion: '2.102.0' });
      expect(fromBare).toStrictEqual({ kind: 'gh-ready', ghPath: 'gh', ghVersion: '2.102.0' });
    });

    it('rejects, naming the root, when the directory itself cannot be used — a fault, not a state (as locateGitSpice treats it)', async () => {
      // arrange
      const runner = runnerFor([{ key: versionKey('gh'), result: neverStarted('unusable-directory') }]);

      // act
      const result = ready(runner);

      // assert
      await expect(result).rejects.toThrow('readiness: /work/app');
      expect(runner.calls.length).toBe(1);
    });
  });

  describe('the gh-stack extension (E62b)', () => {
    it('is gh-ready when the extension answers its banner', async () => {
      // act
      const answer = await ready(runnerFor([{ key: stackKey('gh'), result: GH_STACK_PRESENT }]));

      // assert
      expect(answer.kind).toBe('gh-ready');
    });

    it('lists gh-stack when gh prints the install hint instead, and asks nothing about the login', async () => {
      // arrange
      const runner = runnerFor([{ key: stackKey('gh'), result: GH_STACK_ABSENT }]);

      // act
      const answer = await ready(runner);

      // assert: gh itself answered, so its path and version are there for the install line
      expect(answer).toStrictEqual({ kind: 'gh-missing', missing: ['gh-stack'], ghVersion: '2.102.0', ghMinimum: '2.90.0', ghPath: 'gh' });
      expect(runner.calls.length).toBe(2);
    });

    it('reads an old gh\'s `unknown command "stack"` as absent too', async () => {
      // arrange: a gh from before it knew the official extension names
      const runner = runnerFor([{ key: stackKey('gh'), result: exited(1, '', 'unknown command "stack" for "gh"\n') }]);

      // act
      const answer = await ready(runner);

      // assert
      expect(answer.kind).toBe('gh-missing');
      if (answer.kind === 'gh-missing') {
        expect(answer.missing).toStrictEqual(['gh-stack']);
      }
      expect(runner.calls.length).toBe(2);
    });

    it('knows the extension by its name, not by exit 0', async () => {
      // act: a program exiting 0 with some other banner
      const answer = await ready(runnerFor([{ key: stackKey('gh'), result: exited(0, 'something else 0.1.1\n') }]));

      // assert
      expect(answer.kind).toBe('gh-missing');
      if (answer.kind === 'gh-missing') {
        expect(answer.missing).toStrictEqual(['gh-stack']);
      }
    });

    it('reads a `gh stack --version` that never finished as absent', async () => {
      // act
      const answer = await ready(runnerFor([{ key: stackKey('gh'), result: timedOut() }]));

      // assert
      expect(answer.kind).toBe('gh-missing');
      if (answer.kind === 'gh-missing') {
        expect(answer.missing).toStrictEqual(['gh-stack']);
      }
    });

    it('lists both, gh first, when gh is too old and the extension is missing', async () => {
      // arrange
      const runner = runnerFor([
        { key: versionKey('gh'), result: exited(0, 'gh version 2.89.9 (2025-01-01)\n') },
        { key: stackKey('gh'), result: GH_STACK_ABSENT },
      ]);

      // act
      const answer = await ready(runner);

      // assert
      expect(answer).toStrictEqual({ kind: 'gh-missing', missing: ['gh', 'gh-stack'], ghVersion: '2.89.9', ghMinimum: '2.90.0', ghPath: 'gh' });
      expect(runner.calls.length).toBe(2);
    });

    it('still asks about the extension when gh is too old — E62b names everything at once', async () => {
      // arrange
      const runner = runnerFor([{ key: versionKey('gh'), result: exited(0, 'gh version 2.89.9 (2025-01-01)\n') }]);

      // act
      const answer = await ready(runner);

      // assert
      expect(answer.kind).toBe('gh-missing');
      if (answer.kind === 'gh-missing') {
        expect(answer.missing).toStrictEqual(['gh']);
      }
      expect(asked(runner)).toContain('stack --version');
    });
  });

  describe('the login (E23) — exit code only', () => {
    it('is gh-ready on exit 0 of `auth status`, whatever it printed', async () => {
      // act: nothing on stdout at all
      const answer = await ready(runnerFor([{ key: authKey('gh', HOST), result: exited(0) }]));

      // assert
      expect(answer.kind).toBe('gh-ready');
    });

    it('is gh-not-logged-in on exit 1 with gh\'s not-logged-in sentence', async () => {
      // act
      const answer = await ready(runnerFor([{ key: authKey('gh', HOST), result: GH_NO_ACCOUNT }]));

      // assert
      expect(answer).toStrictEqual({ kind: 'gh-not-logged-in', ghPath: 'gh' });
    });

    it('reads the offline shape and the empty-default-token shape as not logged in too — stderr is not read, the exit code is the same (D65)', async () => {
      // act: a token gh could not validate (revoked, or no network), and the validation GH_HOST
      // makes gh attempt for a host with no account — one exit code, three texts
      const offline = await ready(runnerFor([{ key: authKey('gh', HOST), result: GH_OFFLINE }]));
      const noDefault = await ready(runnerFor([{ key: authKey('gh', HOST), result: GH_NO_DEFAULT }]));

      // assert
      expect(offline).toStrictEqual({ kind: 'gh-not-logged-in', ghPath: 'gh' });
      expect(noDefault).toStrictEqual({ kind: 'gh-not-logged-in', ghPath: 'gh' });
    });

    it('reads exit 4 and a check that never finished as not logged in', async () => {
      // act: 4 is gh's "requires authentication"; a hung keychain prompt is the timeout
      const four = await ready(runnerFor([{ key: authKey('gh', HOST), result: exited(4) }]));
      const hung = await ready(runnerFor([{ key: authKey('gh', HOST), result: timedOut() }]));

      // assert
      expect(four).toStrictEqual({ kind: 'gh-not-logged-in', ghPath: 'gh' });
      expect(hung).toStrictEqual({ kind: 'gh-not-logged-in', ghPath: 'gh' });
    });

    it('reads an `auth status` that never started as not logged in — gh gone between the first spawn and the third', async () => {
      // act: no exit code at all (`exitCode: null`) is still not exit 0
      const answer = await ready(runnerFor([{ key: authKey('gh', HOST), result: neverStarted('not-found') }]));

      // assert
      expect(answer).toStrictEqual({ kind: 'gh-not-logged-in', ghPath: 'gh' });
    });
  });

  describe('the host (E22)', () => {
    it('lower-cases the host in the flag and in GH_HOST — gh folds neither', async () => {
      // arrange: the remote spells it in capitals; the fake is keyed on what gh is actually asked
      const runner = runnerFor();

      // act
      const answer = await ready(runner, '', 'GitHub.COM');

      // assert
      expect(answer.kind).toBe('gh-ready');
      expect(runner.calls[2].args).toStrictEqual(['auth', 'status', '--hostname', 'github.com']);
      for (const call of runner.calls) {
        expect(call.env?.GH_HOST).toBe('github.com');
      }
    });

    it('passes the same host as the flag and as GH_HOST — gh matches the flag against its host list, which only GH_HOST puts the host on', async () => {
      // arrange: a *.github.com remote (ssh over port 443), which core/forge.ts accepts as GitHub.
      // With the flag alone gh would say "not logged into any accounts on ssh.github.com" while
      // github.com is logged in (measured 2.102.0); with GH_HOST beside it, logged in.
      const runner = runnerFor([], 'gh', 'ssh.github.com');

      // act
      await ready(runner, '', 'ssh.github.com');

      // assert
      const auth = runner.calls[2];
      expect(auth.args[3]).toBe('ssh.github.com');
      expect(auth.env?.GH_HOST).toBe('ssh.github.com');
      expect(auth.args[3]).toBe(auth.env?.GH_HOST);
    });

    it('asks about the repository\'s own host — a GHE.com tenant', async () => {
      // arrange
      const runner = runnerFor([], 'gh', 'eu.ghe.com');

      // act
      const answer = await ready(runner, '', 'eu.ghe.com');

      // assert
      expect(answer.kind).toBe('gh-ready');
      expect(runner.calls[2].args).toStrictEqual(['auth', 'status', '--hostname', 'eu.ghe.com']);
      expect(runner.calls[2].env?.GH_HOST).toBe('eu.ghe.com');
    });
  });

  describe('prCascade.ghPath (the setting is item 23b\'s; the argument is read here)', () => {
    it('runs `gh` for an empty or blank setting', async () => {
      // arrange
      const empty = runnerFor();
      const blank = runnerFor();

      // act
      await ready(empty, '');
      await ready(blank, '  ');

      // assert
      expect(empty.calls[0].executable).toBe('gh');
      expect(blank.calls[0].executable).toBe('gh');
    });

    it('runs only the configured executable, and names it in the answer', async () => {
      // arrange: `gh` is not canned at all, so asking it would throw
      const runner = new FakeCommandRunner(
        new Map<string, CommandResult>([
          [versionKey('/opt/homebrew/bin/gh'), exited(0, GH_BANNER)],
          [stackKey('/opt/homebrew/bin/gh'), GH_STACK_PRESENT],
          [authKey('/opt/homebrew/bin/gh', HOST), GH_LOGGED_IN],
        ]),
      );

      // act
      const answer = await ready(runner, '/opt/homebrew/bin/gh');

      // assert
      expect(answer).toStrictEqual({ kind: 'gh-ready', ghPath: '/opt/homebrew/bin/gh', ghVersion: '2.102.0' });
      expect(runner.calls.map((call) => call.executable)).toStrictEqual(['/opt/homebrew/bin/gh', '/opt/homebrew/bin/gh', '/opt/homebrew/bin/gh']);
    });

    it('reports a configured executable that is not gh as missing, with no fall-back to `gh`', async () => {
      // arrange: the setting points at something that prints nothing
      const runner = new FakeCommandRunner(new Map<string, CommandResult>([[versionKey('/opt/x/gh'), exited(0, '')]]));

      // act
      const answer = await ready(runner, '/opt/x/gh');

      // assert: no path to name — the one tried did not answer as gh
      expect(answer).toStrictEqual({ kind: 'gh-missing', missing: ['gh', 'gh-stack'], ghVersion: null, ghMinimum: '2.90.0', ghPath: null });
      expect(runner.calls.length).toBe(1);
    });
  });
});

describe('the banner readers', () => {
  // Program output → gh's version token, or null for any other program's.
  const banners: { stdout: string; token: string | null; note: string }[] = [
    { stdout: GH_BANNER, token: '2.102.0', note: 'the release banner' },
    { stdout: 'gh version DEV (DEV)\n', token: 'DEV', note: 'a source build — a token the floor cannot be checked against' },
    { stdout: '', token: null, note: 'nothing at all' },
    { stdout: '10.08.0\n', token: null, note: 'a bare version with no name' },
    { stdout: 'GitHub CLI 2.1.0\n', token: null, note: 'another spelling of the name' },
  ];

  for (const row of banners) {
    it(`ghVersionToken ${row.token === null ? 'refuses' : 'takes the token from'} ${row.note}`, () => {
      // act
      const token = ghVersionToken(row.stdout);

      // assert
      expect(token).toBe(row.token);
    });
  }

  const stackBanners: { stdout: string; token: string | null; note: string }[] = [
    { stdout: 'gh stack version 0.1.1\n', token: '0.1.1', note: "the extension's banner" },
    { stdout: GH_STACK_ABSENT.stderr, token: null, note: "gh's install hint (on stderr, but the reader is given text)" },
    { stdout: '', token: null, note: 'nothing at all' },
  ];

  for (const row of stackBanners) {
    it(`ghStackVersionToken ${row.token === null ? 'refuses' : 'takes the token from'} ${row.note}`, () => {
      // act
      const token = ghStackVersionToken(row.stdout);

      // assert
      expect(token).toBe(row.token);
    });
  }
});

describe('runGh and the constants', () => {
  it("keeps a caller's own timeout — M7's `gh stack link` will want a longer one — and the constants are what the plan says", async () => {
    // arrange
    const runner = new FakeCommandRunner(new Map<string, CommandResult>([['gh stack link a', exited(0)]]));

    // act
    await runGh(runner, 'gh', ['stack', 'link', 'a'], ROOT, HOST, 60_000);

    // assert
    expect(runner.calls[0]).toStrictEqual({ executable: 'gh', args: ['stack', 'link', 'a'], cwd: ROOT, env: GH_ENV_LITERAL, timeoutMs: 60_000 });
    expect(GH_STACK_EXTENSION).toBe('github/gh-stack');
    expect(MINIMUM_GH_VERSION).toStrictEqual({ major: 2, minor: 90, patch: 0 });
    expect(GH_CANDIDATE).toBe('gh');
  });
});
