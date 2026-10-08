/**
 * test/unit/command.test.ts — the FakeCommandRunner contract as a specification: what it
 * records, what it answers, where `answerIn` applies, and how loudly it fails on a command
 * nobody canned. The three result builders are pinned here too.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git-spice, no VS Code). The fake is only a
 * test helper, but test/unit/readiness.test.ts and item 19's extension-host tests lean on it
 * behaving exactly like this, so it gets its own specification — as test/unit/git.test.ts
 * gives FakeGitRunner. The real runner is exercised in test/git/command.git.test.ts. Depends
 * on: test/helpers/fakeCommand.ts, src/core/command.ts (types). Plan: §10.1 item 18, §9.4,
 * §13.2 D56.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { describe, expect, it } from 'vitest';
import type { CommandRequest } from '../../src/core/command';
import { exited, FakeCommandRunner, neverStarted, timedOut } from '../helpers/fakeCommand';

// The request most tests make: git-spice's version banner, the way the readiness probe asks.
// see primer §4 (const) and §9 (an object literal that satisfies an interface)
const VERSION_REQUEST: CommandRequest = {
  executable: 'gs',
  args: ['--no-prompt', '--version'],
  cwd: '/work/app',
  env: { NO_COLOR: '1' },
  // see primer §27 (`_` between digits: `15_000` is 15000)
  timeoutMs: 15_000,
};

// see primer §5 (arrow functions) and §6 (async / await)
describe('FakeCommandRunner', () => {
  describe('run', () => {
    it('resolves with the canned result for a known command', async () => {
      // arrange: the key is the executable and the arguments joined by spaces
      const banner = exited(0, 'git-spice 0.31.2\n');
      const commands = new FakeCommandRunner(new Map([['gs --no-prompt --version', banner]]));

      // act
      const result = await commands.run(VERSION_REQUEST);

      // assert: the very same object, so a test can keep a reference and compare with `toBe`
      expect(result).toBe(banner);
    });

    it('records every request whole, oldest first — executable, args, cwd, env and timeout', async () => {
      // arrange
      const commands = new FakeCommandRunner(
        new Map([
          ['gs --no-prompt --version', exited(0, 'git-spice 0.31.2\n')],
          ['gs --no-prompt auth status --forge github', exited(1)],
        ]),
      );

      // act
      await commands.run(VERSION_REQUEST);
      await commands.run({ executable: 'gs', args: ['--no-prompt', 'auth', 'status', '--forge', 'github'], cwd: '/work/app' });

      // assert
      expect(commands.calls).toStrictEqual([
        VERSION_REQUEST,
        { executable: 'gs', args: ['--no-prompt', 'auth', 'status', '--forge', 'github'], cwd: '/work/app' },
      ]);
    });

    it('records a copy of the arguments, so a caller changing its array later cannot rewrite the record', async () => {
      // arrange
      const args = ['--no-prompt', '--version'];
      const commands = new FakeCommandRunner(new Map([['gs --no-prompt --version', exited(0)]]));

      // act
      await commands.run({ executable: 'gs', args, cwd: '/work/app' });
      args.push('--later');

      // assert
      expect(commands.calls[0].args).toEqual(['--no-prompt', '--version']);
      expect(commands.calls[0].args).not.toBe(args);
    });
  });

  describe('answerIn', () => {
    it('prefers an answer canned for the exact directory over the directory-blind one (E22)', async () => {
      // arrange: logged in for the first repository, not for the second
      const commands = new FakeCommandRunner(new Map([['gs --no-prompt auth status --forge github', exited(0)]]));
      commands.answerIn('/work/b', 'gs', ['--no-prompt', 'auth', 'status', '--forge', 'github'], exited(1));

      // act
      const inA = await commands.run({ executable: 'gs', args: ['--no-prompt', 'auth', 'status', '--forge', 'github'], cwd: '/work/a' });
      const inB = await commands.run({ executable: 'gs', args: ['--no-prompt', 'auth', 'status', '--forge', 'github'], cwd: '/work/b' });

      // assert
      expect(inA.exitCode).toBe(0);
      expect(inB.exitCode).toBe(1);
    });

    it('falls back to the directory-blind answer for a command the directory has no answer to', async () => {
      // arrange
      const commands = new FakeCommandRunner(new Map([['gs --no-prompt --version', exited(0, 'git-spice 0.31.2\n')]]));
      commands.answerIn('/work/b', 'gs', ['--no-prompt', 'auth', 'status', '--forge', 'github'], exited(1));

      // act
      const result = await commands.run({ executable: 'gs', args: ['--no-prompt', '--version'], cwd: '/work/b' });

      // assert
      expect(result.stdout).toBe('git-spice 0.31.2\n');
    });
  });

  describe('unknown command', () => {
    it('rejects with a message naming the command and the directory, so the test fails loudly', async () => {
      // arrange
      const commands = new FakeCommandRunner(new Map([['gs --no-prompt --version', exited(0)]]));

      // act
      const result = commands.run({ executable: 'gs', args: ['--no-prompt', 'log', 'short', '--json'], cwd: '/work/app' });

      // assert: the fake is the one runner that throws — a program nobody canned is a test bug
      await expect(result).rejects.toThrow('no canned result for "gs --no-prompt log short --json" (cwd /work/app)');
    });

    it('lists the canned commands in the message so the fix is obvious', async () => {
      // arrange
      const commands = new FakeCommandRunner(new Map([['gs --no-prompt --version', exited(0)]]));

      // act
      const result = commands.run({ executable: 'git-spice', args: ['--no-prompt', '--version'], cwd: '/work/app' });

      // assert
      await expect(result).rejects.toThrow('Canned commands (executable and args joined by spaces): gs --no-prompt --version');
    });

    it('names the directories that have answers of their own when a command is unknown', async () => {
      // arrange
      const commands = new FakeCommandRunner(new Map());
      commands.answerIn('/work/b', 'gs', ['--no-prompt', '--version'], exited(0));

      // act
      const result = commands.run({ executable: 'gs', args: ['--no-prompt', '--version'], cwd: '/work/a' });

      // assert
      await expect(result).rejects.toThrow('Directories with answers of their own (answerIn): /work/b');
    });

    it('says "(none)" instead of an empty list when nothing at all is canned', async () => {
      // arrange
      const commands = new FakeCommandRunner(new Map());

      // act
      const result = commands.run(VERSION_REQUEST);

      // assert
      await expect(result).rejects.toThrow('joined by spaces): (none)');
    });
  });
});

describe('the result builders', () => {
  it('exited: a program that ran, with its exit code and both streams', () => {
    // act
    const result = exited(1, 'out\n', 'FTL git-spice: github: not logged in\n');

    // assert
    expect(result).toStrictEqual({
      exitCode: 1,
      stdout: 'out\n',
      stderr: 'FTL git-spice: github: not logged in\n',
      startFailure: null,
      timedOut: false,
    });
  });

  it('exited: both streams default to empty', () => {
    // act
    const result = exited(0);

    // assert
    expect(result).toStrictEqual({ exitCode: 0, stdout: '', stderr: '', startFailure: null, timedOut: false });
  });

  it('neverStarted: no exit code, nothing printed, the reason as the start failure', () => {
    // act
    const result = neverStarted('not-found');

    // assert
    expect(result).toStrictEqual({ exitCode: null, stdout: '', stderr: '', startFailure: 'not-found', timedOut: false });
  });

  it('timedOut: no exit code, timedOut set, a detail saying so', () => {
    // act
    const result = timedOut();

    // assert
    expect(result).toStrictEqual({ exitCode: null, stdout: '', stderr: '', startFailure: null, timedOut: true, detail: 'timed out' });
  });
});
