/**
 * core/command.ts — runs a program other than git — git-spice now, gh from item 23 — and
 * answers with what happened, whatever happened: the exit code, both output streams, or why
 * the program never started. Never a rejection, because for the callers here an exit code is
 * an answer, not a failure: `gs auth status` exiting 1 means "not logged in", and a missing
 * executable means "not installed" (plan §7.13.1, E62, E67).
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: Node's `node:child_process`, and
 * core/git.ts for the three things both runners need the same way — the output ceiling, the
 * working-directory check and the ENOENT/EACCES classification. Depended on by:
 * core/backends/gitspice.ts (the readiness probe, item 18; enrich/track/push from items 20–21)
 * and, from item 23, the gh probe; test/helpers/fakeCommand.ts implements the interface for
 * tests. Plan: §4.2, §7.13 (every gs call: `--no-prompt`, env, cwd), §7.13.1, §11.3 (the
 * `execa` question, item 21: this file is the "execFile wrapper" it is measured against),
 * §13.2 D56.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { execFile } from 'node:child_process';
import type { ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { classifyStartFailure, describeDirectoryProblem, MAX_OUTPUT_BYTES } from './git';
import type { StartFailure } from './git';

/**
 * One program to run, with everything the spawn needs. One object rather than five parameters
 * so a call site names each value (`cwd: root`, `timeoutMs: PROBE_TIMEOUT_MS`), and so a fake
 * can record the whole request and a test assert on all of it at once.
 */
// see primer §9 (interface), §11 (optional `?` fields), §14 (readonly) and §43 (`Record<string, string>`)
export interface CommandRequest {
  /** A bare name PATH resolves (`gs`, `git-spice`, `gh`) or a full path (the `prCascade.gsPath` setting). */
  readonly executable: string;
  /** One element per argument, no shell (plan §3 "Git access"): each reaches the program exactly as written. */
  readonly args: readonly string[];
  /** The directory to run in — a repository root for every gs and gh call (plan §7.13: cwd, never `-C`). */
  readonly cwd: string;
  /**
   * Variables pinned on top of the caller's environment. Each tool's module owns its own:
   * git-spice's `NO_COLOR`, `LC_ALL`, `GIT_OPTIONAL_LOCKS` (plan §7.13.1); gh's `GH_HOST` and
   * hygiene (item 23). Absent means "the environment as it is". A value typed as an
   * `interface` — core/forge.ts's `GhEnv` — is not accepted here as it is (an interface has no
   * index signature, primer §43); item 23 spreads it into a literal, `{ ...ghEnv(host), … }`,
   * which it does anyway to add the hygiene variables.
   */
  readonly env?: Record<string, string>;
  /**
   * Kill the program after this many milliseconds and report `timedOut`. Absent means no
   * limit. The readiness probe sets one on every spawn: a tool stuck behind a keychain prompt
   * or a slow disk must not hang the refresh for good.
   */
  readonly timeoutMs?: number;
}

/**
 * Everything one run produced, success included. The counterpart of core/git.ts's GitFailure,
 * which describes only failures: here a result is returned for every outcome and the caller
 * reads the fields it cares about — `exitCode === 0`, `startFailure === 'not-found'`,
 * `stdout` — instead of catching.
 */
export interface CommandResult {
  /**
   * The exit status, or `null` when there is none: the program never started (`startFailure`
   * says why), it died of a kill (`timedOut`, or a signal named in `detail`), or Node stopped
   * reading its output (`detail`). A program that catches the timeout's SIGTERM and exits on
   * its own keeps its exit code, with `timedOut` true beside it.
   */
  readonly exitCode: number | null;
  /** What the program wrote to stdout, as UTF-8 text, untrimmed. */
  readonly stdout: string;
  /** What the program wrote to stderr — git-spice's `INF`/`WRN`/`FTL` lines go here. */
  readonly stderr: string;
  /** Why the program never started, or `null` when it did — core/git.ts's three cases, classified the same way. */
  readonly startFailure: StartFailure;
  /** The request's `timeoutMs` passed and the program was killed for it. */
  readonly timedOut: boolean;
  /**
   * Node's words when there is no exit code and nothing above explains it: which signal ended
   * the program, that its output exceeded the 32 MB ceiling, what is wrong with the working
   * directory, or why Node refused to start it on the spot.
   */
  readonly detail?: string;
}

/**
 * How core runs git-spice (and, from item 23, gh). An interface, like GitRunner (core/model.ts),
 * so two things can satisfy it: RealCommandRunner below and test/helpers/fakeCommand.ts, which
 * answers from canned results — the readiness probe is tested without a git-spice on the
 * machine. Unlike GitRunner it is not bound to one executable: the probe tries two names for
 * git-spice, so the executable is part of each request. One method, and it never rejects.
 */
export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

/**
 * The CommandRunner that spawns real programs. Stateless — one instance serves the window.
 *
 * It is execFile turned into a Promise the way RealGitRunner does it (core/git.ts), with
 * four differences that follow from "a result, never a rejection": the exit code and both
 * streams are returned rather than thrown; the program's stdin is closed as soon as it
 * starts, so a tool that would wait for input gives up at once (execFile keeps a pipe open
 * otherwise; `--no-prompt` is git-spice's own guard, this is the runner's); an optional
 * timeout kills a program that outlives it; and the executable comes from the request.
 */
// see primer §13 (class: `implements`)
export class RealCommandRunner implements CommandRunner {
  // see primer §15 (new Promise) and §16 (object literals: spreading two objects, the later wins)
  run(request: CommandRequest): Promise<CommandResult> {
    return new Promise((resolve) => {
      // The working directory first, for the reason core/git.ts gives: Node reports a missing
      // or unenterable directory with the same ENOENT / EACCES it uses for a missing or
      // unrunnable program, so the directory is ruled out before the program is suspected.
      const directoryProblem = describeDirectoryProblem(request.cwd);
      if (directoryProblem !== null) {
        resolve({
          exitCode: null,
          stdout: '',
          stderr: '',
          startFailure: 'unusable-directory',
          timedOut: false,
          detail: directoryProblem,
        });
        return;
      }
      // The caller's environment under the request's variables (`{ ...a, ...b }`: b's keys
      // win), so PATH, HOME, the keychain and credential helpers all still work. The same
      // 32 MB ceiling as git; `timeout: 0` is Node's "no limit".
      // see primer §30 (`??`)
      const options: ExecFileOptionsWithStringEncoding = {
        cwd: request.cwd,
        env: { ...process.env, ...request.env },
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: request.timeoutMs ?? 0,
      };
      try {
        const child = execFile(request.executable, [...request.args], options, (error, stdout, stderr) => {
          if (error === null) {
            resolve({ exitCode: 0, stdout, stderr, startFailure: null, timedOut: false });
            return;
          }
          // Node reuses `error.code` for two things: a number is the program's exit status; a
          // string is Node's own reason the process failed. Two of those strings mean the
          // program never started (classifyStartFailure); `killed: true` means Node's own timer
          // killed it — the only error that sets `killed` (a start failure and a cut-off output
          // carry a string code and no `killed`), hence the `typeof` guard beside it.
          // see primer §17 (narrowing with typeof) and §48 (the conditional expression)
          const exitCode = typeof error.code === 'number' ? error.code : null;
          const startFailure = classifyStartFailure(error);
          const timedOut = error.killed === true && typeof error.code !== 'string';
          const result: CommandResult = { exitCode, stdout, stderr, startFailure, timedOut };
          if (timedOut) {
            // see primer §12 (template strings)
            resolve({ ...result, detail: `timed out after ${request.timeoutMs} ms` });
          } else if (exitCode === null && startFailure === null) {
            resolve({ ...result, detail: error.message });
          } else {
            // No `detail` key at all, rather than one holding undefined: the two are different
            // objects to a test's `toStrictEqual`, and "nothing to add" is an absent field.
            resolve(result);
          }
        });
        // Close the program's input straight away. `stdin` is typed `Writable | null` because a
        // child *can* be spawned without an input pipe; execFile always gives one, so the `?.`
        // (primer §70) satisfies the type rather than a case this code can meet.
        child.stdin?.end();
      } catch (error) {
        // execFile can also throw on the spot, before any callback — E2BIG, an argument list
        // too long, for one (core/git.ts says why). Still a result, not a rejection.
        // see primer §18 (try / catch and unknown)
        let detail = 'Node could not start the program';
        if (error instanceof Error) {
          detail = error.message;
        }
        resolve({ exitCode: null, stdout: '', stderr: '', startFailure: null, timedOut: false, detail });
      }
    });
  }
}
