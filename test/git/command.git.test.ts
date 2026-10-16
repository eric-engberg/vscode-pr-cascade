/**
 * test/git/command.git.test.ts — RealCommandRunner against real processes: git as the
 * executable for the exit-code cases (git is on every CI machine; the real git-spice is item
 * 22b's, in test/git/gitspice*.git.test.ts), Node itself for the environment, stdin and timeout
 * cases, and paths that are not programs for the three start failures. Since M5 item 22a the
 * timeout kills the program's whole process group, and the last describe proves it with a Node
 * child that starts a Node grandchild: gone after the timeout; SIGKILL after the grace for a
 * program that ignores SIGTERM, the line it wrote on the signal kept; the one-pid kill as a
 * control, leaving the grandchild alive; an exit code kept beside `timedOut`; the 32 MB ceiling
 * (the program stopped, not only unread); a foreign signal named; a descendant that left the
 * group but kept the pipes, which cannot hold the result open; a grandchild that ignores SIGTERM
 * while the program itself dies on it, still reached by the SIGKILL; and no timer left queued
 * once a result is in. Every case resolves — the runner's one promise is that it never rejects.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real processes, no VS Code).
 * Depends on: src/core/command.ts. Plan: §10.1 items 18 and 22a, §7.13.1 (env for every gs
 * call), §7.13.3 (the push's timeout), §8 E17/E62, §9.4, §13.2 D56, D61, D63.
 */

// see primer §1 (import / export)
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { KILL_GRACE_MS, RealCommandRunner } from '../../src/core/command';

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

    it('removes a variable the request sets to undefined, so the program never sees the caller\'s value', async () => {
      // arrange: the caller's environment has it — a `CI=true` inherited from an Actions job, say
      vi.stubEnv('PRC_PROBE', 'inherited');

      // act: Node prints what the child sees; `undefined` in the request means "take it away"
      const result = await commands.run({
        executable: process.execPath,
        args: ['-e', 'process.stdout.write(String(process.env.PRC_PROBE))'],
        cwd: scratchDir,
        env: { PRC_PROBE: undefined },
      });

      // assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('undefined');
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

    it('keeps a multi-byte character that a chunk boundary split in two whole (UTF-8 across chunks)', async () => {
      // act: 100 000 euro signs — 300 KB of three-byte characters. The pipe delivers 64 KiB at a
      // time and 65536 is not a multiple of 3, so every boundary cuts one character in two.
      // Without the stream's decoder (`setEncoding`, item 22a) each chunk would be turned to
      // text on its own and the halves become U+FFFD: 100 005 characters, eight of them wrong.
      const result = await commands.run({
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("€".repeat(100000))'],
        cwd: scratchDir,
      });

      // assert: the length first, so a failure reads as a number, then the text itself
      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBe(100_000);
      expect(result.stdout).toBe('€'.repeat(100_000));
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

  // Item 22a (plan D63): the kill reaches the group. Every program here is Node — child,
  // grandchild and the one that ignores SIGTERM — so the file needs nothing CI lacks (no `sleep`,
  // no `pgrep`); liveness is asked with signal 0. Windows has no process groups and the floor is
  // macOS and Linux, so the block is skipped there.
  // see primer §76 (describe.skipIf: a block decided when the file loads) and §75 (process.kill with a
  // signal name; signal 0 in isAlive; a plain spawn as the control)
  describe.skipIf(process.platform === 'win32')('the timeout kills the whole process group (item 22a)', () => {
    it('a grandchild the program started is gone too after the timeout', async () => {
      // arrange: the program writes its grandchild's pid, then both live 20 s; the pid is read
      // beside the run so a Node slow to start fails at once with its cause
      const pidFile = path.join(scratchDir, 'grandchild-11.pid');
      let grandchild = 0;
      // see primer §18 (try / finally: the grandchild is ended whatever the assertions say)
      try {
        // act
        // see primer §37 (Promise.all: two waits side by side) and §54 (destructuring: the array form — the two results by position)
        const [result, pid] = await Promise.all([
          commands.run({ executable: process.execPath, args: ['-e', parentOfAGrandchild(pidFile)], cwd: scratchDir, timeoutMs: 1_500 }),
          pidFrom(pidFile),
        ]);
        grandchild = pid;

        // assert: the run reads as a timeout, and the grandchild — which the one-pid kill below
        // leaves alive — is gone
        expect(result.exitCode).toBeNull();
        expect(result.timedOut).toBe(true);
        expect(result.detail).toBe('timed out after 1500 ms');
        expect(await waitUntilGone(grandchild)).toBe(true);
      } finally {
        if (grandchild > 0 && isAlive(grandchild)) {
          process.kill(grandchild, 'SIGKILL');
        }
      }
    });

    it('sends SIGKILL after the grace to a program that ignores SIGTERM, and its grandchild goes too', async () => {
      // arrange: a 200 ms grace instead of the two seconds production gives
      const patient = new RealCommandRunner(200);
      const pidFile = path.join(scratchDir, 'grandchild-12.pid');
      let grandchild = 0;
      const started = Date.now();
      try {
        // act
        const [result, pid] = await Promise.all([
          patient.run({ executable: process.execPath, args: ['-e', parentOfAGrandchild(pidFile, 'process.on("SIGTERM", () => { process.stdout.write("caught\\n"); });')], cwd: scratchDir, timeoutMs: 1_000 }),
          pidFrom(pidFile),
        ]);
        grandchild = pid;
        const elapsed = Date.now() - started;

        // assert: the SIGKILL came after the grace, not with the SIGTERM (that would be ~1 000 ms),
        // and after the 200 ms seam, not the 2 s default (that would be ~3 000 ms); measured
        // 1 203–1 209 ms, the bounds leave room for a timer firing a millisecond early and for a
        // slow runner. The production grace is pinned too. And the line the handler wrote on
        // SIGTERM is kept: the pipes stayed open through the grace, destroyed after the SIGKILL and
        // not before the SIGTERM.
        expect(result.timedOut).toBe(true);
        expect(result.exitCode).toBeNull();
        expect(elapsed).toBeGreaterThanOrEqual(1_100);
        expect(elapsed).toBeLessThan(2_500);
        expect(result.stdout).toBe('caught\n');
        expect(await waitUntilGone(grandchild)).toBe(true);
        expect(KILL_GRACE_MS).toBe(2_000);
      } finally {
        if (grandchild > 0 && isAlive(grandchild)) {
          process.kill(grandchild, 'SIGKILL');
        }
      }
    });

    it('control: a kill of the one pid, as execFile did, leaves the grandchild running — the fact the group kill is for', async () => {
      // arrange: a plain spawn, no group of its own
      const pidFile = path.join(scratchDir, 'grandchild-13.pid');
      const child = spawn(process.execPath, ['-e', parentOfAGrandchild(pidFile)], { cwd: scratchDir, stdio: 'ignore' });
      // see primer §15 (new Promise: resolved from the child's `close` event)
      const closed = new Promise<void>((resolve) => child.on('close', () => resolve()));
      // the grandchild must exist before the kill, or the test would prove nothing
      const grandchild = await pidFrom(pidFile);
      try {
        // act
        child.kill('SIGTERM');
        await closed;

        // assert
        expect(isAlive(grandchild)).toBe(true);
      } finally {
        process.kill(grandchild, 'SIGKILL');
      }
    });

    it('a program that exits on its own at the timeout\'s SIGTERM keeps its exit code, with timedOut beside it', async () => {
      // act: Node installs the handler first, then the kill arrives a second later
      const result = await commands.run({
        executable: process.execPath,
        args: ['-e', 'process.on("SIGTERM", () => process.exit(7)); setTimeout(() => {}, 20000)'],
        cwd: scratchDir,
        timeoutMs: 1_000,
      });

      // assert
      expect(result.exitCode).toBe(7);
      expect(result.timedOut).toBe(true);
    });

    it('stops a program whose output passes the 32 MB ceiling and says so', async () => {
      // act: forty megabytes of `x` on stdout, then 20 s of doing nothing — so the result arriving
      // at all is the kill (a runner that only stopped collecting would wait out the 20 s, and
      // the test would time out at 5 s)
      const result = await commands.run({
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(40 * 1024 * 1024)); setTimeout(() => {}, 20000)'],
        cwd: scratchDir,
      });

      // assert
      expect(result.exitCode).toBeNull();
      expect(result.timedOut).toBe(false);
      expect(result.detail).toBe('output exceeded 32 MB');
      expect(result.stdout.length).toBeLessThanOrEqual(32 * 1024 * 1024);
    });

    it('names the signal when something else killed the program', async () => {
      // act: the program signals itself
      const result = await commands.run({
        executable: process.execPath,
        args: ['-e', 'process.kill(process.pid, "SIGINT"); setTimeout(() => {}, 20000)'],
        cwd: scratchDir,
      });

      // assert
      expect(result.exitCode).toBeNull();
      expect(result.detail).toBe('killed by SIGINT');
    });

    // see primer §77 (a test's own time limit: the third argument to `it`)
    it('a descendant that left the group but kept the program\'s pipes does not hold the result: run() settles at the timeout plus the grace', async () => {
      // arrange: the grandchild is outside the group by design — the destroyed pipes are what
      // free the result; the test ends it, not the runner
      const patient = new RealCommandRunner(200);
      const pidFile = path.join(scratchDir, 'grandchild-17.pid');
      let grandchild = 0;
      const started = Date.now();
      try {
        // act
        const [result, pid] = await Promise.all([
          patient.run({ executable: process.execPath, args: ['-e', escapedGrandchild(pidFile)], cwd: scratchDir, timeoutMs: 1_000 }),
          pidFrom(pidFile),
        ]);
        grandchild = pid;
        const elapsed = Date.now() - started;

        // assert: back well before the grandchild's five seconds — without the destroy, `close`
        // waits for it and this line fails at about 5.2 s; the ten-second ceiling below keeps
        // Vitest's own 5 s clock out of the way, so a regression reads here, not as "Test timed
        // out" — and not before the grace is up: the pipes go after the SIGKILL, not at the
        // SIGTERM, so what the program still writes while exiting on SIGTERM (a push's last
        // `INF` lines) arrives. The grandchild is still there: it is outside the group.
        expect(result.timedOut).toBe(true);
        expect(result.exitCode).toBeNull();
        expect(elapsed).toBeLessThan(3_000);
        expect(elapsed).toBeGreaterThanOrEqual(1_200);
        expect(isAlive(grandchild)).toBe(true);
      } finally {
        if (grandchild > 0 && isAlive(grandchild)) {
          process.kill(grandchild, 'SIGKILL');
        }
      }
    }, 10_000);

    it('a grandchild that ignores SIGTERM is still reached by the SIGKILL when the program itself died on the SIGTERM', async () => {
      // arrange: the program has no handler — like git-spice, a Go program, it dies on SIGTERM
      // and `close` fires at once — while its grandchild traps the signal and holds no pipe. Only
      // a SIGKILL timer that outlives `close` reaches it; one cleared with the result would not.
      const patient = new RealCommandRunner(200);
      const pidFile = path.join(scratchDir, 'grandchild-18.pid');
      let grandchild = 0;
      const started = Date.now();
      try {
        // act
        const [result, pid] = await Promise.all([
          patient.run({ executable: process.execPath, args: ['-e', parentOfAGrandchild(pidFile, '', 'process.on("SIGTERM", () => {});')], cwd: scratchDir, timeoutMs: 1_000 }),
          pidFrom(pidFile),
        ]);
        grandchild = pid;
        const elapsed = Date.now() - started;

        // assert: the result came with the program's death, before the grace was up — and the
        // grandchild is gone once it is
        expect(result.timedOut).toBe(true);
        expect(result.exitCode).toBeNull();
        expect(elapsed).toBeLessThan(1_200);
        expect(await waitUntilGone(grandchild)).toBe(true);
      } finally {
        if (grandchild > 0 && isAlive(grandchild)) {
          process.kill(grandchild, 'SIGKILL');
        }
      }
    });

    it('leaves no timer queued once the result is in: a program that exits before its limit', async () => {
      // arrange: fake only the two timer calls (Date and the rest stay real), so a timer the
      // runner forgot to clear is still queued once the real `close` has settled the result —
      // every git-spice call carries a limit (15 s probe, 120 s push), so a forgotten timer would
      // fire SIGTERM at a group id long since freed, and maybe reused
      // see primer §65 (vi.useFakeTimers with `toFake`; vi.getTimerCount)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        // act
        const result = await commands.run({ executable: process.execPath, args: ['-e', '0'], cwd: scratchDir, timeoutMs: 60_000 });

        // assert
        expect(result.exitCode).toBe(0);
        expect(result.timedOut).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// ---------------------------------------------------------------------------------------
// Item 22a's helpers: the programs the tests run, and how a pid is read and watched.

/**
 * A Node program (for `node -e`) that starts a Node grandchild living 20 s, writes the
 * grandchild's pid to `pidFile`, then lives 20 s itself — the shape of git-spice running git's
 * push: a program with a child that outlives the limit. `prelude` runs first in the program (a
 * SIGTERM handler); `grandchildPrelude` first in the grandchild.
 */
// see primer §12 (template strings) and §50 (`JSON.stringify`: a path or a program quoted for JavaScript)
function parentOfAGrandchild(pidFile: string, prelude = '', grandchildPrelude = ''): string {
  const grandchildProgram = JSON.stringify(`${grandchildPrelude}setTimeout(() => {}, 20000)`);
  return (
    `${prelude}const { spawn } = require("node:child_process"); const fs = require("node:fs");` +
    ` const grandchild = spawn(process.execPath, ["-e", ${grandchildProgram}], { stdio: "ignore" });` +
    ` fs.writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid)); setTimeout(() => {}, 20000);`
  );
}

/**
 * The same, but the grandchild leaves the group (`detached`, `unref`) while inheriting the
 * program's two output pipes, and lives 5 s: a descendant the group kill cannot reach, holding
 * the pipes `close` waits for — the case the runner destroys the pipes for.
 */
function escapedGrandchild(pidFile: string): string {
  return (
    `const { spawn } = require("node:child_process"); const fs = require("node:fs");` +
    ` const grandchild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { detached: true, stdio: ["ignore", "inherit", "inherit"] });` +
    ` grandchild.unref(); fs.writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid)); setTimeout(() => {}, 20000);`
  );
}

/** Whether a process with this pid exists: signal 0 is the question, not a kill (primer §75). */
// see primer §18 (try / catch: a `catch` with no name for the error)
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The grandchild's pid once the program has written it — polled, because the program needs a
 * moment to start Node twice; only a pid greater than zero counts (a file read between its
 * creation and its write is empty, `Number('')` is 0, and `process.kill(0, 0)` would take 0 for
 * our own group and answer "alive" for ever). Rejects after 4 s so a slow start fails with its
 * cause rather than after the run.
 */
// see primer §38 (a while loop with a deadline) and §27 (`Number`: text to number)
async function pidFrom(pidFile: string): Promise<number> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try {
      const pid = Number(await fs.readFile(pidFile, 'utf8'));
      if (pid > 0) {
        return pid;
      }
    } catch {
      // Not written yet.
    }
    await sleep(20);
  }
  throw new Error(`no pid file at ${pidFile} within 4 s`);
}

/** True once `pid` is gone, polled for up to a second — a killed process is a zombie until it is reaped. */
async function waitUntilGone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      return true;
    }
    await sleep(20);
  }
  return !isAlive(pid);
}

// see primer §58 (setTimeout: a wait, resolved from its callback)
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
