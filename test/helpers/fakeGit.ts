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
 * Why it fails loudly on an unknown command: a fake that quietly returned '' for anything
 * unexpected would let a test pass while the code ran a command nobody canned — the exact
 * kind of silent drift these tests exist to catch. The thrown message names the command
 * and lists the canned ones so the fix is obvious.
 *
 * What it does not model: git failing to start (E17) or a directory that does not exist.
 * A canned Error always means "git ran and said no", so `tryRun` turns it into `null`; the
 * real runner's start failures are covered by test/git/git.git.test.ts instead.
 */
// see primer §19 (Map) and §13 (class, extends and constructor: `implements`)
export class FakeGitRunner implements GitRunner {
  /** Every call made so far, oldest first, from both run and tryRun. */
  readonly calls: GitCall[] = [];

  private readonly responses: Map<string, string | Error>;

  constructor(responses: Map<string, string | Error>) {
    this.responses = responses;
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
    const response = this.responses.get(key);
    if (response === undefined) {
      const cannedKeys = Array.from(this.responses.keys()).join(', ');
      throw new Error(
        `FakeGitRunner: no canned output for "git ${key}" (cwd ${cwd}). ` +
          `Canned commands (args joined by spaces): ${cannedKeys}`,
      );
    }
    return response;
  }
}
