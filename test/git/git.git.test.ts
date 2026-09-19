/**
 * test/git/git.git.test.ts — RealGitRunner against the real git executable.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git in a throwaway
 * directory, no VS Code). No repository is needed: only the runner is under test — that
 * git runs, how its failures become GitErrors, and what tryRun turns into null. Depends
 * on: src/core/git.ts. Plan: §10.1 item 2, §8 E17/E18, §9.1 "hermetic".
 */

// see primer §1 (import / export): `node:fs/promises` is the Promise-returning half of fs.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GitError, RealGitRunner } from '../../src/core/git';

// A throwaway directory that is not inside any repository. Created once for this file.
// `let` with a type and no value yet: beforeAll below assigns it, once (primer §4).
let scratchDir: string;

// Root may enter any directory whatever its permission bits, so the "cannot be entered"
// test has nothing to test there (a container running as root, for instance).
// `process.getuid` does not exist on Windows, hence the check before the call.
const runningAsRoot = process.getuid !== undefined && process.getuid() === 0;

// see primer §5 (arrow functions) and §6 (async / await)
beforeAll(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-git-test-'));
  // Hermetic git (plan §9.1 layer 2). RealGitRunner passes process.env through to git, so
  // pointing HOME at the scratch directory and the config files at nothing means git never
  // reads the developer's own ~/.gitconfig or the system one, and nothing here can change
  // them either. `vi.stubEnv` rather than assigning `process.env.HOME = ...` directly:
  // Vitest remembers the original value, and `vi.unstubAllEnvs` in afterAll puts every
  // one back, so a test file that later shares this worker process never inherits our HOME.
  vi.stubEnv('HOME', scratchDir);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  // Nothing in this file commits, but every real-git test file sets the same identity so
  // git never has to look one up (and never asks the developer's config for it).
  vi.stubEnv('GIT_AUTHOR_NAME', 'PR Cascade tests');
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'tests@example.invalid');
  vi.stubEnv('GIT_COMMITTER_NAME', 'PR Cascade tests');
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'tests@example.invalid');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(scratchDir, { recursive: true, force: true });
});

/**
 * Awaits a git command that is expected to fail and hands back its GitError. Anything
 * else — success, or some other kind of error — fails the test, so each `it` below can
 * read the error's fields directly instead of repeating this try/catch.
 */
// see primer §18 (try / catch and unknown)
async function expectGitError(result: Promise<string | null>): Promise<GitError> {
  try {
    await result;
  } catch (error) {
    if (error instanceof GitError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the git command to fail, but it succeeded');
}

describe('RealGitRunner', () => {
  describe('run', () => {
    it('runs git and resolves with its stdout (`git --version` smoke test)', async () => {
      // arrange
      const git = new RealGitRunner();

      // act
      const output = await git.run(['--version'], scratchDir);

      // assert: "git version 2.50.1" (Apple's build appends more; only the prefix matters)
      // see primer §20 (regular expression literals)
      expect(output).toMatch(/^git version \d+\.\d+/);
    });

    it('rejects with a GitError carrying the exit code and stderr when git exits non-zero', async () => {
      // arrange: rev-parse outside any repository exits 128 (plan §5, first row)
      const git = new RealGitRunner();

      // act
      const error = await expectGitError(git.run(['rev-parse', '--show-toplevel'], scratchDir));

      // assert
      expect(error.exitCode).toBe(128);
      expect(error.stderr).toContain('not a git repository');
    });

    it('records on the GitError which command ran and where', async () => {
      // arrange
      const git = new RealGitRunner();

      // act
      const error = await expectGitError(git.run(['rev-parse', '--show-toplevel'], scratchDir));

      // assert
      expect(error.args).toEqual(['rev-parse', '--show-toplevel']);
      expect(error.cwd).toBe(scratchDir);
      expect(error.startFailure).toBeNull();
    });

    it('sets LC_ALL=C and GIT_OPTIONAL_LOCKS=0 on top of the caller environment (plan §5)', async () => {
      // arrange: a `!`-alias runs a shell command, which is the only way to make git itself
      // report the environment it received. HOME proves the caller's variables still come
      // through (merged, not replaced).
      const git = new RealGitRunner();

      // act
      const output = await git.run(
        ['-c', 'alias.show-env=!echo "$LC_ALL $GIT_OPTIONAL_LOCKS $HOME"', 'show-env'],
        scratchDir,
      );

      // assert
      expect(output).toBe(`C 0 ${scratchDir}\n`);
    });

    it('accepts output larger than Node\'s 1 MB default (E18: a large layer\'s file list)', async () => {
      // arrange: 2 MB of output; with the default maxBuffer Node would abort at 1 MB
      const twoMegabytes = 2 * 1024 * 1024;
      const git = new RealGitRunner();

      // act
      const output = await git.run(['-c', `alias.big=!head -c ${twoMegabytes} /dev/zero`, 'big'], scratchDir);

      // assert: `.length` is the number of characters in the string
      expect(output.length).toBe(twoMegabytes);
    });

    it('rejects with a GitError that says why when output exceeds the 32 MB ceiling (E18)', async () => {
      // arrange: just over the limit; Node stops reading, kills git, and reports no exit code
      const overTheLimit = 33 * 1024 * 1024;
      const git = new RealGitRunner();

      // act
      const error = await expectGitError(
        git.run(['-c', `alias.flood=!head -c ${overTheLimit} /dev/zero`, 'flood'], scratchDir),
      );

      // assert: not a normal exit and not a start failure, and Node's reason is in the message
      expect(error.exitCode).toBeNull();
      expect(error.startFailure).toBeNull();
      expect(error.message).toContain('maxBuffer');
    });

    it('rejects with "git not found at <path>" when the executable does not exist (E17)', async () => {
      // arrange: the prCascade.gitPath setting pointing somewhere wrong
      const git = new RealGitRunner('/no/such/dir/git');

      // act
      const error = await expectGitError(git.run(['--version'], scratchDir));

      // assert: the path comes first (the exact wording is the unit test's job)
      expect(error.startFailure).toBe('not-found');
      expect(error.exitCode).toBeNull();
      expect(error.message).toMatch(/^git not found at \/no\/such\/dir\/git/);
    });

    it('rejects with "git is not executable at <path>" when the path is a directory (E17)', async () => {
      // arrange: prCascade.gitPath set to the folder git lives in instead of git itself.
      // The scratch directory stands in for `/usr/local/bin`; Node reports EACCES for it.
      const git = new RealGitRunner(scratchDir);

      // act
      const error = await expectGitError(git.run(['--version'], scratchDir));

      // assert: the path still comes first, so the E17 node names the setting to fix
      expect(error.startFailure).toBe('not-executable');
      expect(error.exitCode).toBeNull();
      expect(error.message).toBe(`git is not executable at ${scratchDir} (while running: git --version)`);
    });

    it('blames the directory, not git, when the working directory does not exist', async () => {
      // arrange: a workspace folder deleted on disk while VS Code still lists it. Node
      // would report this with the very same ENOENT as a missing executable, which is why
      // the runner checks the directory first; without that it would come back as
      // "git not found at git" — the wrong fix.
      const goneDir = path.join(scratchDir, 'gone');
      const git = new RealGitRunner();

      // act
      const error = await expectGitError(git.run(['--version'], goneDir));

      // assert: Node's own reason follows ours (its exact text is Node's to change, so only
      // the start of it is checked)
      expect(error.startFailure).toBe('unusable-directory');
      expect(error.exitCode).toBeNull();
      expect(error.message).toContain(
        `git --version could not run: ${goneDir} cannot be used as the working directory (ENOENT`,
      );
    });

    it.skipIf(runningAsRoot)(
      'blames the directory, not git, when the working directory cannot be entered',
      async () => {
        // arrange: a directory with every permission bit off. Node reports this with the
        // very same EACCES as a gitPath that is not executable.
        const lockedDir = path.join(scratchDir, 'locked');
        await fs.mkdir(lockedDir);
        await fs.chmod(lockedDir, 0o000);
        const git = new RealGitRunner();

        // act
        const error = await expectGitError(git.run(['--version'], lockedDir));
        await fs.chmod(lockedDir, 0o755);

        // assert: no "git is not executable" — that would send the user to the gitPath setting
        expect(error.startFailure).toBe('unusable-directory');
        expect(error.exitCode).toBeNull();
        expect(error.message).toContain(
          `git --version could not run: ${lockedDir} cannot be used as the working directory (EACCES`,
        );
      },
    );

    it('blames the directory, not git, when the working directory is a file', async () => {
      // arrange: a file where a folder is expected. This is also the case Node would refuse
      // on the spot (ENOTDIR) rather than through the callback; the runner never gets that far.
      const filePath = path.join(scratchDir, 'a-file');
      await fs.writeFile(filePath, 'not a directory\n');
      const git = new RealGitRunner();

      // act
      const error = await expectGitError(git.run(['--version'], filePath));

      // assert
      expect(error.startFailure).toBe('unusable-directory');
      expect(error.message).toBe(`git --version could not run: ${filePath} is not a directory`);
    });

    it('rejects with a GitError, never Node\'s raw error, when Node refuses to start git on the spot', async () => {
      // arrange: a single 2 MB argument is longer than any system allows (E2BIG, "argument
      // list too long"). Node reports that by throwing from execFile itself instead of
      // calling back — the path the runner has to catch by hand. `'x'.repeat(n)` builds a
      // string of n copies.
      const tooLong = 'x'.repeat(2 * 1024 * 1024);
      const git = new RealGitRunner();

      // act
      const error = await expectGitError(git.run(['--version', tooLong], scratchDir));

      // assert: neither E17 (git was never the problem) nor an exit, and Node's reason is kept
      expect(error.startFailure).toBeNull();
      expect(error.exitCode).toBeNull();
      expect(error.message).toContain('E2BIG');
    });
  });

  describe('tryRun', () => {
    it('resolves with stdout when git succeeds', async () => {
      // arrange
      const git = new RealGitRunner();

      // act
      const output = await git.tryRun(['--version'], scratchDir);

      // assert
      expect(output).toMatch(/^git version /);
    });

    it('resolves null when git exits non-zero (rev-parse outside a repository)', async () => {
      // arrange
      const git = new RealGitRunner();

      // act
      const output = await git.tryRun(['rev-parse', '--show-toplevel'], scratchDir);

      // assert
      expect(output).toBeNull();
    });

    it('resolves null when the working directory does not exist (a stale workspace folder)', async () => {
      // arrange: to discovery (PR 3) a folder that is gone is "no repository here", not an error
      const goneDir = path.join(scratchDir, 'gone');
      const git = new RealGitRunner();

      // act
      const output = await git.tryRun(['rev-parse', '--show-toplevel'], goneDir);

      // assert
      expect(output).toBeNull();
    });

    it('still rejects when git itself is missing — E17 is never hidden behind null', async () => {
      // arrange
      const git = new RealGitRunner('/no/such/dir/git');

      // act
      const result = git.tryRun(['rev-parse', '--show-toplevel'], scratchDir);

      // assert
      await expect(result).rejects.toThrow(/^git not found at \/no\/such\/dir\/git/);
    });
  });
});
