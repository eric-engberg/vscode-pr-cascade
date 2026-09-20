/**
 * test/helpers/fakeGit.ts — a GitRunner that answers from canned strings instead of
 * running git.
 *
 * Layer: test helper (plan §9.1 layer 1, §11 skeleton). It implements the same GitRunner
 * interface as core/git.ts, so any core function can be handed this in place of the real
 * runner and tested with no repository, no git binary and no VS Code. Depends on:
 * core/model.ts. Depended on by: test/unit/*.test.ts — every unit test of a core module
 * that reads git. Plan: §11 "helpers/fakeGit.ts", §9.4.
 */

// see primer §1 (import / export) and §9 (interface: `import type`)
import type { GitRunner } from '../../src/core/model';

/** One recorded invocation: what the code under test asked git to do, and where. */
export interface GitCall {
  args: string[];
  cwd: string;
}

/**
 * Stands in for git in unit tests. Construct it with a Map from the argument list joined
 * by single spaces (`'rev-parse --show-toplevel'`) to what git should print, or to an Error
 * meaning "git exited non-zero". A test then asserts on what the code under test returned
 * and, through `calls`, on exactly which git commands it ran and in which directory.
 *
 * That constructor map ignores the directory a command runs in, and for almost every
 * core module that is right: trunk detection and the stack computation (PRs 4–5) ask all
 * their questions at one repository root. Discovery (PR 3) is the exception — it runs the
 * same `rev-parse --show-toplevel` once per workspace folder and needs a different answer
 * from each — so `answerIn` cans an answer for one command in one specific directory.
 *
 * Why it fails loudly on an unknown command: a fake that quietly returned '' for anything
 * unexpected would let a test pass while the code ran a command nobody canned — the exact
 * kind of silent drift these tests exist to catch. The thrown message names the command
 * and lists the canned ones so the fix is obvious.
 *
 * What it does not model: git failing to start (E17) or a directory that does not exist.
 * A canned Error always means "git ran and said no", so `tryRun` turns it into `null`; the
 * real runner's start failures are covered by test/git/git.git.test.ts instead.
 */
// see primer §19 (Map), §13 (class, extends and constructor: `implements`) and §47
// (parameter properties)
export class FakeGitRunner implements GitRunner {
  /** Every call made so far, oldest first, from both run and tryRun. */
  readonly calls: GitCall[] = [];

  /**
   * Answers that depend on the directory: cwd → (joined args → answer). A Map whose values
   * are themselves Maps (primer §19, applied twice). Empty until answerIn is called.
   */
  private readonly responsesByDirectory: Map<string, Map<string, string | Error>> = new Map();

  constructor(
    /** The directory-blind answers: joined args → what git prints, or an Error meaning "git exited non-zero". */
    private readonly responses: Map<string, string | Error>,
  ) {}

  /**
   * Cans an answer for one command run in one specific directory. It wins over the
   * constructor map for that command in that directory, and has no effect anywhere else,
   * so a test can say "in /work/app/src git finds /work/app; in /work/lib it finds
   * /work/lib; everywhere else, whatever the constructor map says".
   */
  answerIn(cwd: string, args: string[], response: string | Error): void {
    let forDirectory = this.responsesByDirectory.get(cwd);
    if (forDirectory === undefined) {
      // No type parameters on this Map: it takes them from forDirectory (primer §21).
      forDirectory = new Map();
      this.responsesByDirectory.set(cwd, forDirectory);
    }
    forDirectory.set(args.join(' '), response);
  }

  // see primer §6 (async / await)
  async run(args: string[], cwd: string): Promise<string> {
    const response = this.lookUp(args, cwd);
    // Throwing inside an async method is how a Promise rejects (primer §7); the test sees
    // the same rejection the real runner would produce on a non-zero exit.
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }

  async tryRun(args: string[], cwd: string): Promise<string | null> {
    const response = this.lookUp(args, cwd);
    if (response instanceof Error) {
      return null;
    }
    return response;
  }

  /** Records the call and finds its canned answer; throws when there is none. */
  private lookUp(args: string[], cwd: string): string | Error {
    // see primer §16 (object literals: shorthand keys)
    this.calls.push({ args, cwd });
    const key = args.join(' ');
    // An answer canned for this exact directory wins; otherwise the directory-blind
    // constructor map decides.
    let response: string | Error | undefined = undefined;
    const forDirectory = this.responsesByDirectory.get(cwd);
    if (forDirectory !== undefined) {
      response = forDirectory.get(key);
    }
    if (response === undefined) {
      response = this.responses.get(key);
    }
    if (response === undefined) {
      // "(none)" rather than an empty list, so the message never reads "...spaces): ." —
      // the shape a discovery test produces when its fake was set up with answerIn only.
      let cannedKeys = '(none)';
      if (this.responses.size > 0) {
        cannedKeys = Array.from(this.responses.keys()).join(', ');
      }
      let message =
        `FakeGitRunner: no canned output for "git ${key}" (cwd ${cwd}). ` +
        `Canned commands (args joined by spaces): ${cannedKeys}`;
      if (this.responsesByDirectory.size > 0) {
        const directories = Array.from(this.responsesByDirectory.keys()).join(', ');
        message = message + `. Directories with answers of their own (answerIn): ${directories}`;
      }
      throw new Error(message);
    }
    return response;
  }
}
