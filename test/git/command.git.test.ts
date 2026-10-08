/**
 * test/git/command.git.test.ts — RealCommandRunner against real processes: git as the
 * executable for the exit-code cases (git is on every CI machine; git-spice is not until item
 * 22), Node itself for the environment, stdin and timeout cases, and paths that are not
 * programs for the three start failures. Every case resolves — the runner's one promise is
 * that it never rejects.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real processes, no VS Code).
 * Depends on: src/core/command.ts. Plan: §10.1 item 18, §7.13.1 (env for every gs call),
 * §8 E17/E62, §9.4, §13.2 D56.
 */

// see primer §1 (import / export)
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RealCommandRunner } from '../../src/core/command';

const commands = new RealCommandRunner();

// A throwaway directory to run in: not a repository, so `rev-parse` fails there on purpose.
let scratchDir: string;

// see primer §5 (arrow functions) and §6 (async / await)
beforeAll(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-command-test-'));
  // Hermetic git, as in git.git.test.ts: the runner inherits the developer's environment, and
  // git must not read a real ~/.gitconfig here.
  vi.stubEnv('HOME', scratchDir);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(scratchDir, { recursive: true, force: true });
});

describe('RealCommandRunner', () => {
  describe('a program that runs', () => {
    it('resolves with exit code 0 and the program\'s stdout (`git --version`)', async () => {
      // act
      const result = await commands.run({ executable: 'git', args: ['--version'], cwd: scratchDir });

      // assert
      expect(result.exitCode).toBe(0);
      // see primer §20 (regular expressions): Apple's git says `git version 2.50.1 (Apple Git-155)`
      expect(result.stdout).toMatch(/^git version \d+\.\d+/);
      expect(result.stderr).toBe('');
      expect(result.startFailure).toBeNull();
      expect(result.timedOut).toBe(false);
    });

    it('resolves — never rejects — with the exit code and stderr when the program fails', async () => {
      // act: rev-parse outside any repository exits 128
      const result = await commands.run({ executable: 'git', args: ['rev-parse', '--show-toplevel'], cwd: scratchDir });

      // assert: the failure is data, the way the readiness probe reads `gs auth status`
      expect(result.exitCode).toBe(128);
      expect(result.stderr).toContain('not a git repository');
      expect(result.startFailure).toBeNull();
    });

    it('lays the request\'s variables over the caller\'s environment, keeping the rest', async () => {
      // arrange: the caller's environment already has the variable, with another value — the
      // request's must win
      vi.stubEnv('PRC_PROBE', 'no');

      // act: Node prints the variable and whether PATH survived
      const result = await commands.run({
        executable: process.execPath,
        args: ['-e', 'process.stdout.write(process.env.PRC_PROBE + " " + (process.env.PATH !== undefined))'],
        cwd: scratchDir,
        env: { PRC_PROBE: 'yes' },
      });

      // assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('yes true');
    });

    it('closes the program\'s stdin at once, so a program that reads it does not wait', async () => {
      // act: Node exits as soon as its stdin ends — which happens immediately, or never
      const result = await commands.run({
        executable: process.execPath,
        args: ['-e', 'process.stdin.resume(); process.stdin.on("end", () => process.exit(0))'],
        cwd: scratchDir,
        // see primer §27 (`_` between digits: `2_000` is 2000)
        timeoutMs: 2_000,
      });

      // assert: exit 0 well inside the timeout, not a kill (a runner that left stdin open would
      // report `timedOut` after two seconds instead)
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it('accepts output larger than Node\'s 1 MB default (the same 32 MB ceiling as git)', async () => {
      // act: two megabytes of `x` on stdout
      const result = await commands.run({
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(2 * 1024 * 1024))'],
        cwd: scratchDir,
      });

      // assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBe(2 * 1024 * 1024);
    });

    it('kills a program that runs past the request\'s timeout and says so', async () => {
      // act: a Node process that would live two seconds, allowed 300 ms (a runner that dropped
      // the kill would see it exit 0 after two seconds)
      const result = await commands.run({
        executable: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 2000)'],
        cwd: scratchDir,
        timeoutMs: 300,
      });

      // assert
      expect(result.exitCode).toBeNull();
      expect(result.timedOut).toBe(true);
      expect(result.startFailure).toBeNull();
      expect(result.detail).toMatch(/timed out after 300 ms/);
    });
  });

  describe('a program that never starts (E17, E62)', () => {
    it('reports not-found for an executable that does not exist', async () => {
      // act
      const result = await commands.run({ executable: '/no/such/dir/gs', args: ['--version'], cwd: scratchDir });

      // assert
      expect(result).toStrictEqual({ exitCode: null, stdout: '', stderr: '', startFailure: 'not-found', timedOut: false });
    });

    it('reports not-executable for a path that is a directory', async () => {
      // act
      const result = await commands.run({ executable: os.tmpdir(), args: ['--version'], cwd: scratchDir });

      // assert
      expect(result.startFailure).toBe('not-executable');
      expect(result.exitCode).toBeNull();
    });

    it('blames the directory, not the program, when the working directory does not exist', async () => {
      // act
      const gone = path.join(scratchDir, 'gone');
      const result = await commands.run({ executable: 'git', args: ['--version'], cwd: gone });

      // assert: Node would report the same ENOENT for a missing directory as for a missing
      // program; the directory is checked first, so the two are told apart
      expect(result.startFailure).toBe('unusable-directory');
      expect(result.exitCode).toBeNull();
      expect(result.detail).toContain('ENOENT');
    });

    it('blames the directory when the working directory is a file', async () => {
      // arrange
      const file = path.join(scratchDir, 'not-a-dir');
      await fs.writeFile(file, 'x');

      // act
      const result = await commands.run({ executable: 'git', args: ['--version'], cwd: file });

      // assert
      expect(result.startFailure).toBe('unusable-directory');
      expect(result.detail).toBe('is not a directory');
    });
  });
});
