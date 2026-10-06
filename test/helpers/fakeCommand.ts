/**
 * test/helpers/fakeCommand.ts — a CommandRunner that answers from canned results instead of
 * running a program.
 *
 * Layer: test helper (plan §9.1 layer 1). It implements the same CommandRunner interface as
 * core/command.ts, so the git-spice backend can be handed this in place of the real runner
 * and tested with no git-spice installed, no VS Code and no process spawned. It imports
 * nothing from vitest, so the extension-host tests (item 19) can use it too. Depends on:
 * core/command.ts (the interface and the result shape), core/git.ts (StartFailure). Depended
 * on by: test/unit/command.test.ts (its own contract), test/unit/readiness.test.ts,
 * test/git/readiness.git.test.ts. Plan: §9.4, §13.4 (the fake-runner injection the
 * extension-host tests will need), §13.2 D56.
 */

// see primer §1 (import / export) and §9 (`import type`)
import type { CommandRequest, CommandResult, CommandRunner } from '../../src/core/command';

/**
 * Stands in for the real runner in tests. Construct it with a Map from the executable and the
 * argument list joined by single spaces (`'gs --no-prompt --version'`) to the CommandResult the
 * program would have produced. A test then asserts on what the code under test did with the
 * answers and, through `calls`, on exactly which programs it ran, with which arguments, in
 * which directory, with which variables and which timeout — every request is recorded whole.
 *
 * `answerIn` cans an answer for one command in one specific directory, for a caller that asks
 * the same question in several repositories (E22: one window, two repositories, two login
 * states); it wins over the constructor map there and has no effect anywhere else.
 *
 * Why it fails loudly on an unknown command: a fake that quietly answered "exit 0, no output"
 * for anything unexpected would let a test pass while the code ran a program nobody canned —
 * the kind of silent drift these tests exist to catch, and the one property of this runner
 * that differs from the real one, which never throws. The thrown message names the command
 * and lists the canned ones so the fix is obvious. (FakeGitRunner has the same rule.)
 */
// see primer §19 (Map), §13 (class: `implements`) and §47 (parameter properties)
export class FakeCommandRunner implements CommandRunner {
  /** Every request made so far, oldest first. */
  readonly calls: CommandRequest[] = [];

  /** Answers that depend on the directory: cwd → (joined executable and args → result). */
  private readonly resultsByDirectory: Map<string, Map<string, CommandResult>> = new Map();

  constructor(
    /** The directory-blind answers: `executable args…` joined by spaces → the result. Tests keep the Map and `set` an entry to change an answer between calls. */
    private readonly results: Map<string, CommandResult>,
  ) {}

  /** Cans an answer for one command run in one specific directory; see the class comment. */
  answerIn(cwd: string, executable: string, args: string[], result: CommandResult): void {
    let forDirectory = this.resultsByDirectory.get(cwd);
    if (forDirectory === undefined) {
      forDirectory = new Map();
      this.resultsByDirectory.set(cwd, forDirectory);
    }
    forDirectory.set(commandKey(executable, args), result);
  }

  // see primer §6 (async / await) and §16 (object literals: spread copies the request)
  async run(request: CommandRequest): Promise<CommandResult> {
    // Recorded as a copy, with the arguments copied too, so a later change to the caller's
    // array cannot rewrite what the test saw.
    this.calls.push({ ...request, args: [...request.args] });
    const key = commandKey(request.executable, request.args);
    let result: CommandResult | undefined = undefined;
    const forDirectory = this.resultsByDirectory.get(request.cwd);
    if (forDirectory !== undefined) {
      result = forDirectory.get(key);
    }
    if (result === undefined) {
      result = this.results.get(key);
    }
    if (result === undefined) {
      let cannedKeys = '(none)';
      if (this.results.size > 0) {
        cannedKeys = Array.from(this.results.keys()).join(', ');
      }
      // see primer §12 (template strings)
      let message =
        `FakeCommandRunner: no canned result for "${key}" (cwd ${request.cwd}). ` +
        `Canned commands (executable and args joined by spaces): ${cannedKeys}`;
      if (this.resultsByDirectory.size > 0) {
        const directories = Array.from(this.resultsByDirectory.keys()).join(', ');
        message = message + `. Directories with answers of their own (answerIn): ${directories}`;
      }
      throw new Error(message);
    }
    return result;
  }
}

/** The Map key for one command: the executable, a space, the arguments joined by spaces. */
// see primer §3 (functions and type annotations) and §25 (arrays: join)
function commandKey(executable: string, args: readonly string[]): string {
  return `${executable} ${args.join(' ')}`;
}

/** A program that ran and exited with `exitCode`, having printed `stdout` and `stderr`. */
// see primer §13 (default parameters)
export function exited(exitCode: number, stdout: string = '', stderr: string = ''): CommandResult {
  return { exitCode, stdout, stderr, startFailure: null, timedOut: false };
}

/**
 * A program that never started: nothing at that path (`'not-found'`, Node's ENOENT), something
 * there that cannot be run (`'not-executable'`, EACCES), or a working directory that cannot be
 * used (`'unusable-directory'`). The three members of core/git.ts's StartFailure other than its
 * `null`, written out.
 */
// see primer §10 (union types: exact strings as members)
export function neverStarted(why: 'not-found' | 'not-executable' | 'unusable-directory'): CommandResult {
  return { exitCode: null, stdout: '', stderr: '', startFailure: why, timedOut: false };
}

/** A program the runner killed because it ran past the request's `timeoutMs`. */
export function timedOut(): CommandResult {
  return { exitCode: null, stdout: '', stderr: '', startFailure: null, timedOut: true, detail: 'timed out' };
}
