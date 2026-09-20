/**
 * test/helpers/fixture.ts — builds a real, throwaway git repository holding a stack of
 * branches: a TypeScript port of plan Appendix A — one commit on trunk, a bare origin, then
 * one branch per layer, each committing one distinct file (`a`, `b`, `c`, ...).
 *
 * Layer: test helper (plan §9.1 layer 2, §9.3); hermetic on its own — the git environment
 * is built into `git()`, not the test runner — so it works outside Vitest too. Depends on:
 * Node built-ins only, nothing under src/. Depended on by: test/git/stack.git.test.ts,
 * .vscode-test.mjs (its compiled copy under out/), scripts/fixture.ts. Plan: §9.3, Appendix A.
 */

// see primer §1 (import / export) and §28 (the Sync variants of Node's functions): they
// block until done and return the result directly, so setup code reads as a list of steps.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * How to shape the repository. Every field is optional: `buildStack()` with no argument
 * builds the Appendix A stack — three layers on `main` with a bare origin — and a test
 * that needs something else names only what differs (`{ remote: false }`).
 */
// see primer §11 (optional `?` fields) and §10 (union types: exact strings as members)
export interface FixtureOptions {
  /** The trunk branch name. Default `main`; `master` for the older convention (test/git/trunk.git.test.ts covers it too). */
  trunk?: 'main' | 'master';
  /** Layer branch names, bottom to top. Default `['api-refactor', 'add-retries', 'retry-metrics']`; `[]` builds a repository with no stack. */
  layers?: string[];
  /** Create a bare `origin` and fetch it, so `origin/<trunk>` and `origin/HEAD` exist. Default true; false for a repository with no remote (E25). */
  remote?: boolean;
  /**
   * Where to build. The repository goes in `<directory>/repo` and its origin in
   * `<directory>/origin.git`; `cleanup()` removes the whole directory. Default: a fresh
   * temporary directory, which is what every test wants. `npm run fixture`
   * (scripts/fixture.ts) names `../fixture-repo` here so the result is somewhere F5 can
   * open it.
   */
  directory?: string;
}

/**
 * A built repository and the ways a test can change it into one of the plan §8
 * situations. Every method that moves HEAD to do its work puts it back where it was,
 * except `detach` and `startConflictingRebase`, whose whole point is where HEAD ends up.
 * `cleanup` removes everything from disk; call it in `afterAll`.
 */
// see primer §9 (interface: methods) and §11 (an optional `?` parameter)
export interface Fixture {
  /** The repository root — the physical path, so it compares equal to what discovery returns. */
  dir: string;
  /** Runs `git <args>` in the repository and returns stdout; throws on a non-zero exit. For assertions and one-off setup. */
  git(args: string[]): string;
  /** Rewrites the tip commit of `branch` with `file` set to `content` (E14 when `branch` is the bottom layer). */
  amend(branch: string, file: string, content: string): void;
  /** What GitHub's "Squash and merge" does to the bottom layer's PR: trunk gets one new commit with that layer's changes; the local branch is left in place (E15). */
  squashMergeBottomIntoTrunk(): void;
  /** Adds a branch off trunk that is not part of the stack (E16). Default name `other-work`. */
  addUnrelatedStack(name?: string): void;
  /** Leaves HEAD detached at the commit it is on (E3). */
  detach(): void;
  /** Starts a rebase of the stack onto a trunk that now conflicts with the bottom layer, and leaves it paused (E12): the `rebase-merge` directory (`git rev-parse --git-path rebase-merge`) exists afterwards. */
  startConflictingRebase(): void;
  /** Deletes the repository, its origin and the scratch directory holding them. */
  cleanup(): void;
}

// The Appendix A stack: a refactor, retries on top of it, metrics on top of those.
// see primer §4 (const)
const DEFAULT_LAYERS = ['api-refactor', 'add-retries', 'retry-metrics'];

// The file each layer commits: the first layer adds `a`, the second `b`, and so on. One
// distinct file per layer keeps M2's file lists trivially assertable.
const FILE_NAMES = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Builds the repository and returns the handle for it. Synchronous on purpose: this is
 * setup code that runs some twenty git commands in a fixed order, and a `beforeAll` (or
 * PR 6's script) reads better as a plain list of steps than as twenty `await`s.
 *
 * Follows plan Appendix A line by line, with two additions the shell script did not need:
 * `origin/HEAD` is set explicitly (git versions differ in whether `fetch` creates it; see
 * test/git/trunk.git.test.ts), and the scratch directory's path is resolved to its
 * physical form, because on macOS `os.tmpdir()` lives under a symlink and discovery
 * returns physical paths (brief §4).
 */
// see primer §30 (`??`: a default for a missing option) and §29 (counted `for` loops)
export function buildStack(options: FixtureOptions = {}): Fixture {
  const trunk = options.trunk ?? 'main';
  const layers = options.layers ?? DEFAULT_LAYERS;
  const hasRemote = options.remote ?? true;
  // see primer §12 (template strings)
  if (layers.length > FILE_NAMES.length) {
    throw new Error(`buildStack: at most ${FILE_NAMES.length} layers (one file name letter each), got ${layers.length}`);
  }

  // One scratch directory holds the repository (`repo/`) and its bare origin
  // (`origin.git`) side by side, the way Appendix A's `../origin.git` does, and cleanup
  // removes it whole. `realpathSync` turns macOS's `/var/folders/...` into
  // `/private/var/folders/...`.
  let scratchDir: string;
  if (options.directory === undefined) {
    const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-cascade-fixture-'));
    scratchDir = fs.realpathSync(temporaryDir);
  } else {
    // `recursive` creates missing parents and is a no-op if the directory exists — the
    // caller (scripts/fixture.ts) is responsible for it being empty.
    fs.mkdirSync(options.directory, { recursive: true });
    scratchDir = fs.realpathSync(options.directory);
  }
  const repoDir = path.join(scratchDir, 'repo');
  fs.mkdirSync(repoDir);
  const fixture = new StackFixture(scratchDir, repoDir, trunk, layers, hasRemote);

  // Trunk: one commit with a file `f`, on a branch named by `-b` (git ≥ 2.28; the plan's
  // floor is 2.38). The identity and the two settings go into the repository's own
  // config, as the shell script does, so anyone opening the fixture by hand (PR 6's
  // `npm run fixture`) can commit in it too: `rebase.updateRefs` is what Appendix B's
  // manual restack relies on, and `commit.gpgsign=false` means never waiting on a key.
  fixture.git(['init', '-q', '-b', trunk]);
  fixture.git(['config', 'user.name', 'PR Cascade fixture']);
  fixture.git(['config', 'user.email', 'fixture@example.invalid']);
  fixture.git(['config', 'commit.gpgsign', 'false']);
  fixture.git(['config', 'rebase.updateRefs', 'true']);
  fs.writeFileSync(path.join(repoDir, 'f'), 'base\n');
  fixture.git(['add', 'f']);
  fixture.git(['commit', '-q', '-m', 'base']);

  if (hasRemote) {
    // A bare clone of the repository is the "origin" — the same shape a GitHub remote
    // has, with no working tree. Registering and fetching it gives `origin/<trunk>`; the
    // explicit `set-head` gives `origin/HEAD`, which detectTrunk reads first.
    const originDir = path.join(scratchDir, 'origin.git');
    fixture.git(['clone', '-q', '--bare', repoDir, originDir]);
    fixture.git(['remote', 'add', 'origin', originDir]);
    fixture.git(['fetch', '-q', 'origin']);
    fixture.git(['remote', 'set-head', 'origin', trunk]);
  }

  // Each layer branches off the previous one (`checkout -b` starts from HEAD, which is
  // where the last layer left it) and commits one new file: `a` on the first layer, `b`
  // on the second... The index is needed to pick the letter, hence the counted loop.
  for (let index = 0; index < layers.length; index++) {
    const layerName = layers[index];
    const fileName = FILE_NAMES.charAt(index);
    fixture.git(['checkout', '-q', '-b', layerName]);
    fs.writeFileSync(path.join(repoDir, fileName), `${fileName}\n`);
    fixture.git(['add', fileName]);
    fixture.git(['commit', '-q', '-m', `${layerName}: add ${fileName}`]);
  }

  return fixture;
}

/**
 * The Fixture handle. A class rather than a bag of arrow functions because every method
 * needs the same five facts (where the repository is, what trunk is called, which layers
 * exist, whether there is an origin, where the scratch directory is), and fields are the
 * plain way to keep them together. Not exported: tests only ever see the Fixture
 * interface, which is all they need.
 */
// see primer §13 (class, extends and constructor: `implements`, `private`, default parameters),
// §14 (readonly) and §47 (parameter properties)
class StackFixture implements Fixture {
  constructor(
    /** Holds `repo/` and `origin.git/` side by side; what `cleanup` removes. */
    private readonly scratchDir: string,
    /**
     * The repository root. A parameter property is named after the field it declares, and
     * the Fixture interface calls this one `dir`, so the parameter is `dir` too (buildStack
     * passes its `repoDir` variable here; the argument is positional, so nothing there changed).
     */
    readonly dir: string,
    private readonly trunk: string,
    private readonly layers: string[],
    private readonly hasRemote: boolean,
  ) {}

  // see primer §28 (the Sync variants of Node's functions) and §16 (object literals: spread)
  git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.dir,
      // The hermetic environment from plan §9.1, built here rather than by the test
      // runner so the fixture is safe wherever it is used: git looks for its global
      // config under HOME (now the scratch directory, which has none) and at
      // GIT_CONFIG_GLOBAL (/dev/null); GIT_CONFIG_NOSYSTEM skips /etc/gitconfig; the
      // identity variables mean `commit` never has to look one up; LC_ALL=C keeps git's
      // messages in English so a failure reads the same on every machine.
      env: {
        ...process.env,
        HOME: this.scratchDir,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'PR Cascade fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'PR Cascade fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        LC_ALL: 'C',
      },
      // `utf8` makes the result a string rather than raw bytes.
      encoding: 'utf8',
      // stdin is closed so no command can ever sit waiting for input; stdout is
      // captured as the return value; stderr is captured too, and Node puts it into the
      // error message when git exits non-zero, so a failing step says what git said.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  amend(branch: string, file: string, content: string): void {
    const previousBranch = this.currentBranch();
    this.git(['checkout', '-q', branch]);
    fs.writeFileSync(path.join(this.dir, file), content);
    this.git(['add', file]);
    // `--amend` replaces the tip commit with a new one holding the staged change; the
    // old commit stays in the object store and, if another branch was built on it, in
    // that branch's history (E14). `--no-edit` keeps the message, so no editor opens.
    this.git(['commit', '-q', '--amend', '--no-edit']);
    this.git(['checkout', '-q', previousBranch]);
  }

  squashMergeBottomIntoTrunk(): void {
    const bottom = this.bottomLayer();
    const previousBranch = this.currentBranch();
    this.git(['checkout', '-q', this.trunk]);
    // `merge --squash` stages the bottom layer's changes as if they were typed in by
    // hand and stops short of committing; the commit that follows is a brand-new commit
    // that is not the layer's commit and has no merge parent — exactly what GitHub's
    // "Squash and merge" produces. The layer's own commit is therefore still not an
    // ancestor of trunk (E15).
    this.git(['merge', '-q', '--squash', bottom]);
    this.git(['commit', '-q', '-m', `${bottom} (squashed)`]);
    if (this.hasRemote) {
      // On GitHub the merge happens on the remote; pushing moves origin/<trunk> the same
      // way, so the fixture is right whichever spelling of trunk a test uses.
      this.git(['push', '-q', 'origin', this.trunk]);
    }
    this.git(['checkout', '-q', previousBranch]);
  }

  addUnrelatedStack(name: string = 'other-work'): void {
    const previousBranch = this.currentBranch();
    // A branch started from trunk, not from the stack: its commit is not an ancestor of
    // the stack's HEAD, so computeStack must never list it (E16).
    this.git(['checkout', '-q', '-b', name, this.trunk]);
    fs.writeFileSync(path.join(this.dir, 'unrelated'), `${name}\n`);
    this.git(['add', 'unrelated']);
    this.git(['commit', '-q', '-m', `${name}: unrelated work`]);
    this.git(['checkout', '-q', previousBranch]);
  }

  detach(): void {
    // `--detach` checks out the commit HEAD is on, as a commit rather than a branch:
    // HEAD now holds a SHA, `symbolic-ref HEAD` fails, and no branch is "current" (E3).
    this.git(['checkout', '-q', '--detach']);
  }

  startConflictingRebase(): void {
    if (this.layers.length === 0) {
      throw new Error('startConflictingRebase: the fixture has no layers to rebase');
    }
    // The bottom layer's file is the first letter; the rebase is started from whichever
    // branch HEAD is on (the top layer, unless a test moved it).
    const bottomFile = FILE_NAMES.charAt(0);
    const startingBranch = this.currentBranch();
    // Trunk gains a commit adding the bottom layer's file with different content. Replaying
    // the bottom layer's commit on top of that is an add/add conflict on that file.
    this.git(['checkout', '-q', this.trunk]);
    fs.writeFileSync(path.join(this.dir, bottomFile), `${bottomFile} as trunk wrote it\n`);
    this.git(['add', bottomFile]);
    this.git(['commit', '-q', '-m', `trunk: also add ${bottomFile}`]);
    this.git(['checkout', '-q', startingBranch]);
    // see primer §18 (try / catch and unknown: a `catch` with no name for the error)
    try {
      this.git(['rebase', '-q', this.trunk]);
    } catch {
      // Expected: git exits 1 at the conflict and leaves the rebase paused. What matters
      // is the state it leaves behind, checked next, not the error.
    }
    // `--git-path` prints where this worktree keeps `rebase-merge` — under `.git/` for the
    // main worktree, elsewhere for a linked one (E19) — so it is never hardcoded (plan
    // §5). The path may be relative to the repository; resolve makes it absolute.
    // see primer §23 (string methods: trim)
    const rebaseDirOutput = this.git(['rev-parse', '--git-path', 'rebase-merge']);
    const rebaseDir = path.resolve(this.dir, rebaseDirOutput.trim());
    if (fs.existsSync(rebaseDir) === false) {
      throw new Error(`startConflictingRebase: expected a paused rebase, but ${rebaseDir} does not exist`);
    }
  }

  cleanup(): void {
    // `force` makes a missing directory a no-op, so calling cleanup twice is harmless.
    // `maxRetries` / `retryDelay`: on macOS a recursive delete can fail with ENOTEMPTY when
    // something is still touching the tree as it goes — Spotlight indexing the files just
    // written, or a git process finishing up — and the E18 layer of 1500 files hit exactly
    // that on GitHub's macOS runner (every test passed; the teardown did not). Node retries
    // EBUSY / ENOTEMPTY / EPERM with a growing pause, ten times up to a second here.
    fs.rmSync(this.scratchDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  /** The branch HEAD is on. Throws when HEAD is detached: the helpers that call this need a branch to come back to. */
  private currentBranch(): string {
    // Not `--short`: see currentBranch in src/core/stack.ts — with a tag of the same name
    // it would print `heads/<name>`, and the `checkout` the callers do next would then
    // leave HEAD detached at the tag instead of back on the branch.
    // see primer §23 (string methods: trim, endsWith/startsWith, slice)
    const ref = this.git(['symbolic-ref', '--quiet', 'HEAD']).trim();
    if (ref.startsWith('refs/heads/') === false) {
      throw new Error(`currentBranch: HEAD points at ${ref}, which is not a local branch`);
    }
    return ref.slice('refs/heads/'.length);
  }

  /** The first layer — the one whose parent is trunk. Throws for a fixture built with no layers. */
  private bottomLayer(): string {
    if (this.layers.length === 0) {
      throw new Error('the fixture has no layers, so there is no bottom layer');
    }
    // see primer §25 (arrays: `[0]` is the first element)
    return this.layers[0];
  }
}
