/**
 * test/unit/git.test.ts — the GitRunner contract as a specification, checked against
 * FakeGitRunner, plus the GitError message rules that need no git binary.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). The fake is only a
 * test helper, but every later unit test of a core module leans on it behaving exactly like
 * this, so it gets its own specification. Depends on: test/helpers/fakeGit.ts,
 * src/core/git.ts (GitError only — RealGitRunner is exercised in test/git). Plan: §10.1
 * item 2, §8 E17.
 */

// see primer §1 (import / export): describe/it/expect come from vitest, never globals.
import { describe, expect, it } from 'vitest';
import { GitError } from '../../src/core/git';
import { FakeGitRunner } from '../helpers/fakeGit';

// see primer §5 (arrow functions); the `async` test bodies are §6 (async / await)
describe('FakeGitRunner', () => {
  describe('run', () => {
    it('resolves with the canned stdout for a known command', async () => {
      // arrange
      const git = new FakeGitRunner(new Map([['--version', 'git version 2.50.1\n']]));

      // act
      const output = await git.run(['--version'], '/repo');

      // assert
      expect(output).toBe('git version 2.50.1\n');
    });

    it('rejects with the canned Error when the command is canned as a failure', async () => {
      // arrange: an Error as the canned value means "git exited non-zero"
      const failure = new Error('fatal: not a git repository');
      const git = new FakeGitRunner(new Map([['rev-parse --show-toplevel', failure]]));

      // act
      const result = git.run(['rev-parse', '--show-toplevel'], '/not-a-repo');

      // assert: the very same Error object, so a test that cans a GitError gets that exact
      // object back and can inspect its fields
      await expect(result).rejects.toBe(failure);
    });
  });

  describe('tryRun', () => {
    it('resolves with the canned stdout for a known command', async () => {
      // arrange
      const git = new FakeGitRunner(new Map([['symbolic-ref --quiet --short HEAD', 'main\n']]));

      // act
      const output = await git.tryRun(['symbolic-ref', '--quiet', '--short', 'HEAD'], '/repo');

      // assert
      expect(output).toBe('main\n');
    });

    it('resolves null, not an error, when the command is canned as a failure (the E3 detached-HEAD shape)', async () => {
      // arrange: detached HEAD makes symbolic-ref exit non-zero (E3); with --quiet git
      // prints nothing, so the Error's text is only a label for the reader
      const git = new FakeGitRunner(
        new Map([['symbolic-ref --quiet --short HEAD', new Error('exit 1 (detached HEAD; --quiet prints nothing)')]]),
      );

      // act
      const output = await git.tryRun(['symbolic-ref', '--quiet', '--short', 'HEAD'], '/repo');

      // assert
      expect(output).toBeNull();
    });
  });

  describe('call recording', () => {
    it('records every call with its args and cwd, oldest first, from both run and tryRun', async () => {
      // arrange: a Map mixing string and Error values needs its types spelled out
      // (primer §19), otherwise the compiler guesses Map<string, string> from the first pair
      const git = new FakeGitRunner(
        new Map<string, string | Error>([
          ['--version', 'git version 2.50.1\n'],
          ['status --porcelain', new Error('exit 128')],
        ]),
      );

      // act
      await git.run(['--version'], '/one');
      await git.tryRun(['status', '--porcelain'], '/two');

      // assert
      expect(git.calls).toEqual([
        { args: ['--version'], cwd: '/one' },
        { args: ['status', '--porcelain'], cwd: '/two' },
      ]);
    });
  });

  describe('unknown command', () => {
    it('rejects with a message naming the command and cwd so the test fails loudly', async () => {
      // arrange
      const git = new FakeGitRunner(new Map([['--version', 'git version 2.50.1\n']]));

      // act
      const result = git.run(['rev-parse', 'HEAD'], '/repo');

      // assert
      await expect(result).rejects.toThrow('no canned output for "git rev-parse HEAD" (cwd /repo)');
    });

    it('lists the canned commands in the message so the fix is obvious', async () => {
      // arrange
      const git = new FakeGitRunner(new Map([['--version', 'git version 2.50.1\n']]));

      // act
      const result = git.run(['rev-parse', 'HEAD'], '/repo');

      // assert
      await expect(result).rejects.toThrow('Canned commands (args joined by spaces): --version');
    });

    it('fails loudly from tryRun too, rather than returning null', async () => {
      // arrange
      const git = new FakeGitRunner(new Map());

      // act
      const result = git.tryRun(['rev-parse', 'HEAD'], '/repo');

      // assert
      await expect(result).rejects.toThrow('no canned output');
    });
  });
});

describe('GitError', () => {
  it('puts "git not found at <path>" first when the executable could not start (E17)', () => {
    // arrange / act
    const error = new GitError({
      gitPath: '/opt/nowhere/git',
      args: ['--version'],
      cwd: '/repo',
      exitCode: null,
      stderr: '',
      startFailure: 'not-found',
    });

    // assert: the tree will show this message, so its first words name the fix
    expect(error.message).toBe('git not found at /opt/nowhere/git (while running: git --version)');
  });

  it('puts "git is not executable at <path>" first when the path is a directory or lacks +x (E17)', () => {
    // arrange / act: prCascade.gitPath set to the folder git lives in, not to git itself
    const error = new GitError({
      gitPath: '/usr/local/bin',
      args: ['--version'],
      cwd: '/repo',
      exitCode: null,
      stderr: '',
      startFailure: 'not-executable',
    });

    // assert
    expect(error.message).toBe('git is not executable at /usr/local/bin (while running: git --version)');
  });

  it('blames the directory, not git, when the working directory cannot be used', () => {
    // arrange / act: a workspace folder that was deleted on disk while VS Code still lists
    // it; `detail` is what the runner found out about the directory, in Node's words
    const error = new GitError({
      gitPath: 'git',
      args: ['rev-parse', '--show-toplevel'],
      cwd: '/workspace/gone',
      exitCode: null,
      stderr: '',
      startFailure: 'unusable-directory',
      detail: "cannot be used as the working directory (ENOENT: no such file or directory, stat '/workspace/gone')",
    });

    // assert: no "git not found" — that would send the user to the gitPath setting for nothing
    expect(error.message).toBe(
      'git rev-parse --show-toplevel could not run: /workspace/gone cannot be used as the working directory ' +
        "(ENOENT: no such file or directory, stat '/workspace/gone')",
    );
  });

  it('still names the directory when an unusable one comes with no detail', () => {
    // arrange / act
    const error = new GitError({
      gitPath: 'git',
      args: ['rev-parse', '--show-toplevel'],
      cwd: '/workspace/gone',
      exitCode: null,
      stderr: '',
      startFailure: 'unusable-directory',
    });

    // assert
    expect(error.message).toBe(
      'git rev-parse --show-toplevel could not run: /workspace/gone cannot be used as the working directory',
    );
  });

  it('reports the command, exit code, directory and stderr of a normal failure', () => {
    // arrange / act
    const error = new GitError({
      gitPath: 'git',
      args: ['rev-parse', '--show-toplevel'],
      cwd: '/tmp/somewhere',
      exitCode: 128,
      stderr: 'fatal: not a git repository\n',
      startFailure: null,
    });

    // assert
    expect(error.message).toBe(
      'git rev-parse --show-toplevel failed with exit code 128 in /tmp/somewhere: fatal: not a git repository',
    );
  });

  it('says git printed nothing when a command fails with empty stderr', () => {
    // arrange / act: `rev-parse --verify --quiet` (PR 4) exits 1 silently for a missing ref
    const error = new GitError({
      gitPath: 'git',
      args: ['rev-parse', '--verify', '--quiet', 'origin/main'],
      cwd: '/repo',
      exitCode: 1,
      stderr: '',
      startFailure: null,
    });

    // assert: no dangling ": " at the end
    expect(error.message).toBe(
      'git rev-parse --verify --quiet origin/main failed with exit code 1 in /repo (git printed nothing on stderr)',
    );
  });

  it('uses the detail it was given when there is no exit code and git was found', () => {
    // arrange / act: Node stopped reading because the output exceeded maxBuffer
    const error = new GitError({
      gitPath: 'git',
      args: ['show', 'HEAD:huge.bin'],
      cwd: '/repo',
      exitCode: null,
      stderr: '',
      startFailure: null,
      detail: 'stdout maxBuffer length exceeded',
    });

    // assert
    expect(error.message).toBe(
      'git show HEAD:huge.bin did not exit normally in /repo: stdout maxBuffer length exceeded',
    );
  });

  it('says so when there is no exit code and no detail', () => {
    // arrange / act
    const error = new GitError({
      gitPath: 'git',
      args: ['status'],
      cwd: '/repo',
      exitCode: null,
      stderr: '',
      startFailure: null,
    });

    // assert
    expect(error.message).toBe('git status did not exit normally in /repo: no further detail');
  });

  it('keeps every field of the failure so a caller holding only the error has the whole story', () => {
    // arrange / act: every field filled in, the optional one included
    const error = new GitError({
      gitPath: '/usr/bin/git',
      args: ['rev-parse', 'HEAD'],
      cwd: '/repo',
      exitCode: 128,
      stderr: 'fatal: bad revision\n',
      startFailure: null,
      detail: 'words from Node',
    });

    // assert
    expect(error.gitPath).toBe('/usr/bin/git');
    expect(error.args).toEqual(['rev-parse', 'HEAD']);
    expect(error.cwd).toBe('/repo');
    expect(error.exitCode).toBe(128);
    expect(error.stderr).toBe('fatal: bad revision\n');
    expect(error.startFailure).toBeNull();
    expect(error.detail).toBe('words from Node');
  });

  it('holds undefined for detail, not a missing field, when the failure had none', () => {
    // arrange / act
    const error = new GitError({
      gitPath: 'git',
      args: ['status'],
      cwd: '/repo',
      exitCode: 1,
      stderr: '',
      startFailure: null,
    });

    // assert
    expect(error.detail).toBeUndefined();
  });

  it('is a real Error with its own name, so logs and instanceof checks tell it apart', () => {
    // arrange / act
    const error = new GitError({
      gitPath: 'git',
      args: ['status'],
      cwd: '/repo',
      exitCode: 1,
      stderr: '',
      startFailure: null,
    });

    // assert
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GitError');
  });
});
