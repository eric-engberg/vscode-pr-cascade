/**
 * core/git.ts — runs the real `git` executable: the one place in the codebase that spawns
 * a process.
 *
 * Layer: core (no VS Code imports; plan §4.1). RealGitRunner implements the GitRunner
 * interface from core/model.ts using Node's child_process.execFile; GitError is what its
 * failures look like to callers. Depends on: core/model.ts and Node's built-in
 * `node:child_process` and `node:fs`. Depended on by: src/extension.ts (which builds one
 * runner per window, PR 6) and, through the interface, every core module. Plan: §3 "Git
 * access", §4.2, §5 "Environment for every git call", §8 E17/E18.
 */

// see primer §1 (import / export) and §9 (`import type`): `node:` names are Node's own
// modules, not packages.
import { execFile } from 'node:child_process';
import type { ExecFileException, ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import type { GitRunner } from './model';

/**
 * How much output one git command may produce before Node cuts it off and reports an error.
 * Node's default is 1 MB, which a `git diff --name-status` over a large layer (E18) or a
 * `git show` of a big file can exceed; 32 MB is the floor the plan sets (§5).
 */
// see primer §4 (const)
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * Why a git command never started, or `null` when git did start (and then succeeded,
 * exited non-zero, or was cut off). The first two are E17 — git is missing or the
 * `prCascade.gitPath` setting is wrong — and the tree shows them as the one clear error
 * node that names the fix:
 *
 * - `'not-found'`: nothing at that path (Node's ENOENT, "no such file or directory").
 * - `'not-executable'`: something is there but cannot be run — a directory
 *   (`/usr/local/bin` instead of `/usr/local/bin/git`) or a file without the execute bit
 *   (Node's EACCES, "permission denied").
 * - `'unusable-directory'`: git is fine; the directory it was asked to run in cannot be
 *   used — it does not exist (a workspace folder deleted or renamed on disk while VS Code
 *   still lists it), it is a file, or its permissions forbid entering it. Neither git's
 *   fault nor the user's setting, so it is kept apart from the two above.
 */
// see primer §10 (union types: exact strings as members, and the `type` keyword)
export type StartFailure = 'not-found' | 'not-executable' | 'unusable-directory' | null;

/**
 * Everything known about one failed git command. It is a separate interface (rather than a
 * list of constructor parameters) so the call site names each value — `exitCode: 128` reads;
 * a fifth positional argument does not.
 */
// see primer §11 (optional `?` fields)
export interface GitFailure {
  /** The executable that was run, as configured (default `git`). */
  gitPath: string;
  /** The arguments, exactly as passed — no shell, no quoting (plan §3 "Git access"). */
  args: string[];
  /** The directory git ran in. */
  cwd: string;
  /**
   * git's exit status, or `null` when there is none: git never started (`startFailure`
   * says why), it was killed by a signal, or Node stopped reading its output
   * (MAX_OUTPUT_BYTES exceeded).
   */
  exitCode: number | null;
  /** What git wrote to stderr — its own explanation, e.g. `fatal: not a git repository`. */
  stderr: string;
  /** Why git never started, or `null` when it did (see StartFailure). */
  startFailure: StartFailure;
  /**
   * Node's own words for what went wrong when there is no exit code: why the output was
   * cut off (E18), which signal ended git, or what is wrong with the working directory.
   */
  detail?: string;
}

/**
 * Builds the human-readable message for a GitFailure. It lives outside the class because it
 * is a pure "data in, string out" function, and because the class constructor must call
 * `super(message)` before it can touch `this`, so the message has to exist first.
 *
 * The E17 wordings, "git not found at <path>" and "git is not executable at <path>", put
 * the path first deliberately: that string is what the tree shows when git cannot start,
 * and it names the fix.
 */
// see primer §3 (functions and type annotations) and §12 (template strings)
function describeFailure(failure: GitFailure): string {
  const command = 'git ' + failure.args.join(' ');
  if (failure.startFailure === 'not-found') {
    return `git not found at ${failure.gitPath} (while running: ${command})`;
  }
  if (failure.startFailure === 'not-executable') {
    return `git is not executable at ${failure.gitPath} (while running: ${command})`;
  }
  if (failure.startFailure === 'unusable-directory') {
    // `detail` says what is wrong with the directory (see describeDirectoryProblem); the
    // plain wording is for a GitError built without one.
    let problem = 'cannot be used as the working directory';
    if (failure.detail !== undefined) {
      problem = failure.detail;
    }
    return `${command} could not run: ${failure.cwd} ${problem}`;
  }
  if (failure.exitCode === null) {
    let reason = 'no further detail';
    if (failure.detail !== undefined) {
      reason = failure.detail;
    }
    return `${command} did not exit normally in ${failure.cwd}: ${reason}`;
  }
  // stderr from git already ends in a newline; trim so the message is one tidy line.
  const explanation = failure.stderr.trim();
  if (explanation === '') {
    // Some commands fail silently by design — `rev-parse --verify --quiet` and
    // `symbolic-ref --quiet` (core/trunk.ts, PR 4 onward) exit 1 and print nothing. Say
    // so, rather than end the message in a dangling colon.
    return `${command} failed with exit code ${failure.exitCode} in ${failure.cwd} (git printed nothing on stderr)`;
  }
  return `${command} failed with exit code ${failure.exitCode} in ${failure.cwd}: ${explanation}`;
}

/**
 * The error a failed git command rejects with. It exists so callers can tell "git said no"
 * apart from any other exception, and so the tree (PR 6 onward) can show the exit code and
 * git's stderr instead of a bare "something went wrong". `startFailure` is how the E17
 * error node is recognised (`'not-found'` or `'not-executable'`). Every field is a copy of
 * the GitFailure so a caller holding only the error still has the whole story.
 *
 * `implements GitFailure` makes the interface the contract for that copy: add a field to
 * GitFailure and forget it here, and the class no longer compiles. Without it the two
 * shapes were only kept in step by hand, and a forgotten field compiled silently.
 */
// see primer §13 (class, extends and constructor: `implements` a shape while `extends` a
// class) and §14 (readonly)
export class GitError extends Error implements GitFailure {
  readonly gitPath: string;
  readonly args: string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly startFailure: StartFailure;
  // `string | undefined` rather than `detail?:` — a class field is always present; this
  // one simply holds `undefined` when the failure had no detail (primer §11).
  readonly detail: string | undefined;

  constructor(failure: GitFailure) {
    // Error's own constructor takes the message; it must run before `this` is usable.
    super(describeFailure(failure));
    // Without this the error prints as "Error: ..." in logs; the name says which kind.
    this.name = 'GitError';
    this.gitPath = failure.gitPath;
    this.args = failure.args;
    this.cwd = failure.cwd;
    this.exitCode = failure.exitCode;
    this.stderr = failure.stderr;
    this.startFailure = failure.startFailure;
    this.detail = failure.detail;
  }
}

/**
 * What is wrong with `cwd` as a working directory, or `null` when nothing is: it exists,
 * it is a directory, and this user may enter it. RealGitRunner.run asks this *before* it
 * asks Node to start git, because Node reports a missing or unenterable working directory
 * with the very same ENOENT / EACCES it uses for a missing or unrunnable executable —
 * nothing on the error object tells the two apart — and blaming git for a vanished folder
 * would send the user to the wrong fix (`prCascade.gitPath`). Checked first, the directory
 * is known good by the time git fails to start, and git is the only suspect left.
 *
 * The answer is a phrase completing "<path> ...", with Node's own words in brackets where
 * it has some.
 */
// see primer §18 (try / catch and unknown): `instanceof Error` narrows the caught value
function describeDirectoryProblem(cwd: string): string | null {
  try {
    // statSync throws ENOENT when nothing is there; for a directory, the "execute"
    // permission (X_OK) means "may enter it", and accessSync throws EACCES when it is
    // missing.
    const stats = statSync(cwd);
    if (stats.isDirectory()) {
      accessSync(cwd, constants.X_OK);
      return null;
    }
    return 'is not a directory';
  } catch (error) {
    // Node's message names the code and the path, e.g. "ENOENT: no such file or
    // directory, stat '/work/gone'" or "EACCES: permission denied, access '/work/locked'".
    let problem = 'cannot be used as the working directory';
    if (error instanceof Error) {
      problem = `${problem} (${error.message})`;
    }
    return problem;
  }
}

/**
 * Works out why git never started, from the error Node hands the execFile callback.
 * `error.code` is a number when git ran and exited, and a string naming Node's own reason
 * when it did not; only two of those strings mean "never started", and both point at the
 * executable — the working directory, which Node would report with the same two codes,
 * was checked by describeDirectoryProblem before git was asked to run in it.
 */
function classifyStartFailure(error: ExecFileException): StartFailure {
  if (error.code === 'ENOENT') {
    // Nothing at gitPath: git is not installed, or the setting has a typo.
    return 'not-found';
  }
  if (error.code === 'EACCES') {
    // Something is at gitPath but it cannot be executed: a directory, or a file without
    // the execute bit.
    return 'not-executable';
  }
  // A number (git ran and exited), or another string (a signal, the output overflow of
  // E18): git did start, or at least the trouble is not where it lives.
  return null;
}

/**
 * The GitRunner that spawns the real `git`. One instance serves the whole window; it holds
 * nothing but the path to the executable, so it is cheap and safe to share.
 *
 * Why execFile with an array of arguments and never a shell string: branch names contain
 * `/`, paths contain spaces, and a PR body (M7) can contain anything. With an argv array
 * each element reaches git exactly as written; with a shell string every one of those
 * would need quoting, and quoting bugs are how commands break — or worse — on odd input
 * (plan §3 "Git access").
 */
// see primer §13 (class, extends and constructor: `implements`, `private`, default parameters)
export class RealGitRunner implements GitRunner {
  private readonly gitPath: string;

  /**
   * `gitPath` is the `prCascade.gitPath` setting (PR 6): normally just `git`, resolved via
   * PATH the same way a terminal would; a full path when git is somewhere unusual.
   */
  constructor(gitPath: string = 'git') {
    this.gitPath = gitPath;
  }

  // see primer §5 (arrow functions), §15 (new Promise) and §16 (object literals: shorthand
  // keys and spread)
  run(args: string[], cwd: string): Promise<string> {
    // execFile reports its result through a callback, the older Node style. Wrapping it in
    // a Promise by hand is what lets callers `await` it like everything else in core. Both
    // callbacks below are arrow functions on purpose: they read `this.gitPath`, and an
    // arrow keeps the `this` of the method it is written in (primer §5).
    return new Promise((resolve, reject) => {
      // The working directory is checked before git is asked to run in it (see
      // describeDirectoryProblem for why): a folder that is gone is reported as exactly
      // that, and every failure past this line is about git itself.
      const directoryProblem = describeDirectoryProblem(cwd);
      if (directoryProblem !== null) {
        reject(
          new GitError({
            gitPath: this.gitPath,
            args,
            cwd,
            exitCode: null,
            stderr: '',
            startFailure: 'unusable-directory',
            detail: directoryProblem,
          }),
        );
        return;
      }
      // The `: ExecFileOptionsWithStringEncoding` is what makes a misspelled key (`maxBufer`) a
      // compile error rather than an option Node silently ignores. It is Node's type for execFile's
      // options when output comes back as strings (no `encoding` means utf8 text); the plainer
      // `ExecFileOptions` would pick the `string | Buffer` overload and break `resolve(stdout)`.
      const options: ExecFileOptionsWithStringEncoding = {
        cwd,
        // Start from the user's environment (so PATH, HOME, SSH agent, credential helpers
        // all still work) and pin two variables on top of it (plan §5):
        //   LC_ALL=C            git's messages and dates in English, in a fixed format, so
        //                       parsing them never depends on the user's locale.
        //   GIT_OPTIONAL_LOCKS=0 makes *our* git skip optional side-work that needs a lock
        //                       (e.g. `git status` refreshing the index). VS Code's built-in
        //                       git extension runs `git status` constantly and holds
        //                       `.git/index.lock` while it does; with this set, our commands
        //                       never try to take that lock, so they cannot fail on it.
        env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
        maxBuffer: MAX_OUTPUT_BYTES,
      };
      try {
        execFile(this.gitPath, args, options, (error, stdout, stderr) => {
          if (error === null) {
            resolve(stdout);
            return;
          }
          // Node reuses `error.code` for two different things: a number is git's exit
          // status; a string is Node's own reason the process failed (classifyStartFailure
          // sorts out the two strings that mean E17).
          // see primer §17 (narrowing with typeof)
          let exitCode: number | null = null;
          if (typeof error.code === 'number') {
            exitCode = error.code;
          }
          const startFailure = classifyStartFailure(error);
          // Node's own words for what is left: no exit code and git did start — a signal,
          // or the output overflow of E18.
          let detail: string | undefined = undefined;
          if (exitCode === null && startFailure === null) {
            detail = error.message;
          }
          reject(new GitError({ gitPath: this.gitPath, args, cwd, exitCode, stderr, startFailure, detail }));
        });
      } catch (error) {
        // execFile can also throw on the spot, before any callback: Node routes only a
        // handful of start failures (ENOENT and EACCES among them) through the callback and
        // throws the rest — E2BIG, an argument list too long, for one. `new Promise` would
        // turn that throw into a rejection carrying Node's raw error; catching it here
        // keeps run's promise that every rejection is a GitError. Not E17: git itself was
        // never the problem, so `startFailure` stays null and tryRun will not hide it.
        let detail = 'Node could not start git';
        if (error instanceof Error) {
          detail = error.message;
        }
        reject(
          new GitError({ gitPath: this.gitPath, args, cwd, exitCode: null, stderr: '', startFailure: null, detail }),
        );
      }
    });
  }

  // see primer §6 (async / await) and §18 (try / catch and unknown)
  async tryRun(args: string[], cwd: string): Promise<string | null> {
    try {
      return await this.run(args, cwd);
    } catch (error) {
      // `null` means "no answer from git about this place": git ran and exited non-zero,
      // or there is no usable directory to ask in (a stale workspace folder, which PR 3's
      // discovery skips). Anything else is re-thrown — a missing or unrunnable git (E17),
      // a signal, an output overflow (E18) are problems to surface, not answers. `error`
      // is `unknown` in a catch block, so it is narrowed first.
      if (error instanceof GitError) {
        const gitSaidNo = error.exitCode !== null;
        const directoryUnusable = error.startFailure === 'unusable-directory';
        if (gitSaidNo || directoryUnusable) {
          return null;
        }
      }
      throw error;
    }
  }
}
