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
 * core/backends/gitspice.ts (the readiness probe, item 18; `enrich` and `track`, item 20a;
 * `push`, item 21a) and, from item 23, the gh probe; test/helpers/fakeCommand.ts implements the
 * interface for tests. Plan: §4.2, §7.13 (every gs call: `--no-prompt`, env, cwd), §7.13.1, §11.3
 * (the `execa` question: this file is the "execFile wrapper" it was measured against in item 21a
 * and kept — D61), §13.2 D56, D61, D63 (item 22a: the process-group kill).
 */

// see primer §1 (import / export), §9 (`import type`) and §75 (spawn: stdio, detached and a
// process group; process.kill(-pid); a child's events; a timer's `unref()`; NodeJS.ErrnoException
// and NodeJS.Signals)
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
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
   * git-spice's `NO_COLOR`, `LC_ALL`, `GIT_OPTIONAL_LOCKS` and, from item 21a, `GIT_TERMINAL_PROMPT` (plan §7.13.1); gh's `GH_HOST` and
   * hygiene (item 23). Absent means "the environment as it is". A value typed as an
   * `interface` — core/forge.ts's `GhEnv` — is not accepted here as it is (an interface has no
   * index signature, primer §43); item 23 spreads it into a literal, `{ ...ghEnv(host), … }`,
   * which it does anyway to add the hygiene variables.
   */
  readonly env?: Record<string, string>;
  /**
   * Kill the program after this many milliseconds and report `timedOut`. Absent means no
   * limit. The readiness probe sets one on every spawn: a tool stuck behind a keychain prompt
   * or a slow disk must not hang the refresh for good. Since item 22a the kill is SIGTERM to the
   * program's whole process group — the program and everything it started (git's `push`, a
   * pre-push hook) — so a timeout is a cancel: a push killed at the limit does not land on the
   * remote (measured, plan §13.4 item 22a). Until then the signal reached the program alone and
   * git's push finished on its own (item 21a, D61). A program that ignores SIGTERM is sent
   * SIGKILL after `KILL_GRACE_MS`. On Windows only the program itself is killed (see killGroup).
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
   * says why), it died of a kill (`timedOut`, or a signal named in `detail`), or its output
   * went past the ceiling (`detail`). A program that catches the timeout's SIGTERM and exits on
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
   * The words when there is no exit code and nothing above explains it: which signal ended
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
 * How long a program has to act on the timeout's SIGTERM before its group is sent SIGKILL,
 * which nothing can ignore. SIGTERM first because git cleans up on it — a `config.lock` or a
 * ref lock left behind by a SIGKILL would make the next push fail with "could not lock" —
 * and git, git-spice and a shell hook all exit on it (measured: no survivor in the group);
 * the SIGKILL is for a program that catches it and carries on. Two seconds is plenty for a
 * clean exit and short against the 120 s a push already had.
 */
// see primer §27 (`_` between digits: `2_000` is 2000)
export const KILL_GRACE_MS = 2_000;

/**
 * The CommandRunner that spawns real programs. Stateless — one instance serves the window.
 *
 * `spawn` turned into a Promise, as RealGitRunner (core/git.ts) does with `execFile`, with
 * five differences that follow from "a result, never a rejection" and from item 22a's kill:
 * the exit code and both streams are returned rather than thrown; the program's stdin is
 * `/dev/null` from the start (`stdio: 'ignore'`), so a tool that would wait for input gives up
 * at once (`--no-prompt` is git-spice's own guard, this is the runner's); the executable comes
 * from the request; the program is started as the leader of its own process group
 * (`detached: true` — on POSIX a `setsid()`, nothing more: it is still waited for, its output
 * still read, it is not `unref`'d), so that the timeout can kill the group — the program and
 * every child it started — where `execFile`'s own `timeout` signalled the one pid and left
 * git's push running (D61); and the 32 MB output ceiling is this file's own, since `spawn`
 * has no `maxBuffer`. Why not `execFile` with `detached`: Node's `execFile` hands `spawn` a
 * fixed list of options — cwd, env, uid, gid, shell, signal, the two Windows flags — and drops
 * `detached` (lib/child_process.js; measured: the child's group stayed the parent's).
 */
// see primer §13 (class: `implements`, a constructor with a default parameter) and §47 (a parameter
// property: `private readonly killGraceMs` declares the field and fills it)
export class RealCommandRunner implements CommandRunner {
  constructor(
    /** Test seam only: how long SIGTERM gets before SIGKILL. Production uses the default. */
    private readonly killGraceMs: number = KILL_GRACE_MS,
  ) {}

  // see primer §15 (new Promise) and §16 (object literals: spreading two objects, the later wins)
  run(request: CommandRequest): Promise<CommandResult> {
    return new Promise((resolve) => {
      // The working directory first, for the reason core/git.ts gives: Node reports a missing
      // or unenterable directory with the same ENOENT / EACCES it uses for a missing or
      // unrunnable program, so the directory is ruled out before the program is suspected.
      const directoryProblem = describeDirectoryProblem(request.cwd);
      if (directoryProblem !== null) {
        resolve(neverRan('unusable-directory', directoryProblem));
        return;
      }
      let child: ChildProcess;
      try {
        child = spawn(request.executable, [...request.args], {
          cwd: request.cwd,
          // The caller's environment under the request's variables (`{ ...a, ...b }`: b's keys
          // win), so PATH, HOME, the keychain and credential helpers all still work.
          env: { ...process.env, ...request.env },
          // No input pipe at all (`/dev/null`), both outputs read below.
          stdio: ['ignore', 'pipe', 'pipe'],
          // Its own process group, so killGroup can reach everything it starts. Not on
          // Windows, where `detached` means a new console and there is no group kill anyway.
          detached: process.platform !== 'win32',
          windowsHide: true,
        });
      } catch (error) {
        // spawn can also throw on the spot — E2BIG, an argument list too long, for one
        // (core/git.ts says why). Still a result, not a rejection.
        // see primer §18 (try / catch and unknown) and §48 (the conditional expression)
        resolve(neverRan(null, error instanceof Error ? error.message : 'Node could not start the program'));
        return;
      }
      watch(child, request, this.killGraceMs, resolve);
    });
  }
}

/** A result for a program that was never run: no exit code, nothing printed, and the one reason. */
function neverRan(startFailure: StartFailure, detail: string): CommandResult {
  return { exitCode: null, stdout: '', stderr: '', startFailure, timedOut: false, detail };
}

/**
 * Wires one spawned program up to its result: collects both streams (as UTF-8 text, the
 * decoder keeping a multi-byte character split across two chunks whole), stops the group at
 * the timeout or when the output passes the ceiling (`stopGroup`: SIGTERM, SIGKILL after the
 * grace, then the pipes freed), and resolves once on `close` — the event Node fires after the
 * program has ended *and* both streams are drained, so no output is lost (`exit` can come
 * first). A program that never started fires `error` and then `close` with a negative code
 * (measured: −2 for ENOENT, −13 for EACCES), so the `error` is remembered and decides the
 * result when `close` arrives. The timeout's timer is cleared on `close`; the SIGKILL timer is
 * not (stopGroup says why).
 */
// see primer §33 (a function type as a parameter: `resolve`), §32 (events: `on`), §58
// (`setTimeout` / `clearTimeout`; `clearTimeout(undefined)` is allowed) and §70 (`?.`: `stdout` is
// typed as possibly null)
function watch(child: ChildProcess, request: CommandRequest, killGraceMs: number, resolve: (result: CommandResult) => void): void {
  let stdout = '';
  let stderr = '';
  let startError: NodeJS.ErrnoException | null = null;
  let timedOut = false;
  let overflowed = false;
  let timeoutTimer: NodeJS.Timeout | undefined;

  // SIGTERM to the group now; SIGKILL after the grace for anything that ignored it; and then
  // both pipes destroyed, because `close` waits for them, and a descendant that left the group
  // (a `setsid`, a daemonising hook) while keeping them would otherwise hold the result open
  // until it exited — or for ever (measured: 5.2 s for a 0.5 s limit through the first draft of
  // this file). After the SIGKILL and not before the SIGTERM: the `INF Pushed` lines a push
  // wrote before the cut-off are what `pushed` reads, and nothing arriving after a SIGKILL is
  // worth keeping. `execFile`'s own `kill()` destroyed the streams too, so the old runner never
  // waited on such a descendant. `destroy()` closes our end; what `data` already delivered stays.
  // The SIGKILL timer is deliberately not cleared on `close`: the program may die on the SIGTERM
  // — git-spice, a Go program with no handler, does — while a member of its group that ignored
  // the signal holds neither pipe; then `close` fires at once, and only this timer reaches the
  // survivor (measured: a grandchild trapping SIGTERM lived on when the timer was cleared with
  // the result). Harmless when nothing survived — ESRCH is swallowed in killGroup, `destroy()`
  // is a no-op on a closed stream — and `unref()`'d, so a settled run never keeps the process
  // alive for it. The residual is a group id reused within the grace, which is also V9's.
  const stopGroup = (): void => {
    killGroup(child, 'SIGTERM');
    setTimeout(() => {
      killGroup(child, 'SIGKILL');
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, killGraceMs).unref();
  };
  const collect = (chunk: string, append: (text: string) => void): void => {
    // Past the ceiling nothing more is kept and the program is stopped, as execFile's
    // `maxBuffer` would — the group, not the one pid, so the kill means the same here.
    if (overflowed) {
      return;
    }
    if (stdout.length + stderr.length + chunk.length > MAX_OUTPUT_BYTES) {
      overflowed = true;
      stopGroup();
      return;
    }
    append(chunk);
  };
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => collect(chunk, (text) => (stdout += text)));
  child.stderr?.on('data', (chunk: string) => collect(chunk, (text) => (stderr += text)));

  if (request.timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      stopGroup();
    }, request.timeoutMs);
  }

  // see primer §75 (NodeJS.ErrnoException: Node's Error with a `code`; NodeJS.Signals: the signal names as a string union)
  child.on('error', (error: NodeJS.ErrnoException) => {
    startError = error;
  });
  child.on('close', (code, signal) => {
    clearTimeout(timeoutTimer);
    resolve(resultFor(request, { stdout, stderr, code, signal, startError, timedOut, overflowed }));
  });
}

/** What `watch` knows when the program is over, as one object for resultFor. */
interface Ended {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly startError: NodeJS.ErrnoException | null;
  readonly timedOut: boolean;
  readonly overflowed: boolean;
}

/**
 * The result for a program that is over. In order: never started → the start failure (ENOENT
 * / EACCES classified as core/git.ts does; another start error keeps Node's words as `detail`);
 * killed at the timeout → `timedOut` with the limit in `detail` (a program that caught the
 * signal and exited on its own keeps its code); output past the ceiling; a plain exit code; or
 * a signal nobody here sent, named. No `detail` key at all rather than one holding undefined:
 * the two are different objects to a test's `toStrictEqual`, and "nothing to add" is an absent
 * field.
 */
// see primer §54 (destructuring: three fields out of `ended`), §12 (template strings), §16 (object
// literals: spread, then one more field), §48 (the conditional expression) and §30 (`??`)
function resultFor(request: CommandRequest, ended: Ended): CommandResult {
  const { stdout, stderr, startError } = ended;
  if (startError !== null) {
    const startFailure = classifyStartFailure(startError);
    const base: CommandResult = { exitCode: null, stdout, stderr, startFailure, timedOut: false };
    return startFailure === null ? { ...base, detail: startError.message } : base;
  }
  const result: CommandResult = { exitCode: ended.code, stdout, stderr, startFailure: null, timedOut: ended.timedOut };
  if (ended.timedOut) {
    return { ...result, detail: `timed out after ${request.timeoutMs} ms` };
  }
  if (ended.overflowed) {
    return { ...result, exitCode: null, detail: `output exceeded ${MAX_OUTPUT_BYTES / 1024 / 1024} MB` };
  }
  if (ended.code === null) {
    return { ...result, detail: `killed by ${ended.signal ?? 'a signal'}` };
  }
  return result;
}

/**
 * Sends `signal` to the program's whole process group: `process.kill` with the negated pid
 * means "the group whose id is pid", and the program is that group's leader (`detached`).
 * Nothing to do when the program never got a pid (spawn failed), and nothing to report when
 * the group is already gone (ESRCH — it exited between the timer and the kill: the `close`
 * handler settles the result either way). On Windows there is no group kill and
 * `process.kill(-pid)` throws, so the program alone is signalled, as before item 22a — the
 * extension's floor is macOS and Linux (plan §13.2 D63).
 */
// see primer §8 (undefined and narrowing: the `=== undefined` guard — `pid` is `number | undefined`) and §18 (a `catch` with no name for the error)
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    // ESRCH: already gone. Any other failure to kill shows up as the timeout running on, which
    // the SIGKILL timer and the caller's own limit cover.
  }
}
