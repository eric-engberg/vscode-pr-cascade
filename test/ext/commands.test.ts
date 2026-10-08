/**
 * test/ext/commands.test.ts — "Track Stack with git-spice" inside a real VS Code, through the
 * command a user runs (`prCascade.trackStack`) on the fixture repository: registered and in the
 * manifest under the right `when`; the untracked layers tracked bottom to top, exactly one refresh
 * (E83) and one sentence; the repository re-loaded fresh before anything runs; the refusals —
 * nothing untracked, not initialised, nothing loaded, no stack anywhere, the stack emptied before
 * the click, a paused rebase (E12) — each with its sentence; and a failure mid-way that still
 * refreshes once. git-spice is a fake in the extension's seams (plan §13.4); git is real.
 *
 * Two timing rules, because a load VS Code starts on its own can outrun a test's. `prime()` waits
 * for the load's `onDidLoadStates`, not just for `getChildren()` — an overtaken load fires nothing
 * (vscode/tree.ts, `loads`). And a case whose command refreshes subscribes to the next
 * `onDidLoadStates` *before* running it and drains it first thing in its `finally` — its outcome
 * thrown away, so a drain that runs out cannot skip the cleanup after it — so the refresh's load
 * settles while the fake and the ref are still in place, instead of outranking the next case's
 * `prime()`.
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * Depends on: the running extension (what activate() returns in test mode), the fixture
 * workspace, src/core/backends/gitspice.ts (`GS_ENV`, `PROBE_TIMEOUT_MS`),
 * test/helpers/fakeCommand.ts, test/helpers/fakeReadinessHost.ts. Depended on by: nothing. Plan:
 * §7.2, §7.2.1, §7.8, §8 E5/E12/E17/E56/E59/E83, §9.4 `ext/commands` (its first rows — E12's
 * `pushStack` row arrives with item 21), §10.1 item 20b, §13.2 D60.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { TrackResult } from '../../src/core/backend';
import { GS_ENV, PROBE_TIMEOUT_MS } from '../../src/core/backends/gitspice';
import type { CommandResult } from '../../src/core/command';
import type { ExtensionApi, ReadinessDeps } from '../../src/extension';
import type { StackTreeProvider } from '../../src/vscode/tree';
import { exited, FakeCommandRunner } from '../helpers/fakeCommand';
import { fakeReadinessHost } from '../helpers/fakeReadinessHost';
import type { FakeReadinessHost } from '../helpers/fakeReadinessHost';

// The extension's handle and the real seams, kept in `before` to be put back in `after`.
let provider: StackTreeProvider;
let deps: ReadinessDeps;
let real: ReadinessDeps;

/** The parts of the manifest the first case reads: VS Code hands `packageJSON` out as `any`, and this puts it under a written type. */
// see primer §9 (interface: shapes nested inline) and §42 (`packageJSON`: the manifest as VS Code read it; a key with a slash, quoted)
interface ExtensionManifest {
  contributes: {
    commands: { command: string; title: string; category?: string }[];
    menus: { 'view/title': { command: string; when?: string; group?: string }[] };
  };
}

// The fake git-spice's keys (executable and arguments joined by spaces).
// see primer §4 (const)
const VERSION = 'git-spice --no-prompt --version';
const LOG = 'git-spice --no-prompt log short --all --json';
const BANNER = 'git-spice 0.31.2\nCopyright (C) Abhinav Gupta\n';
// git-spice's own trunk line: with it alone, every layer is untracked.
const TRUNK_LINE = '{"name":"main","ups":[{"name":"api-refactor"}]}\n';
const BOTTOM_LINE = '{"name":"api-refactor","down":{"name":"main"}}\n';
const MIDDLE_LINE = '{"name":"add-retries","down":{"name":"api-refactor"}}\n';
const TOP_LINE = '{"name":"retry-metrics","down":{"name":"add-retries"}}\n';

/** The fake's key for one `gs branch track`, and what git-spice prints when it works (stderr, exit 0). */
// see primer §3 (functions and type annotations) and §12 (template strings)
function trackKey(name: string, base: string): string {
  return `git-spice --no-prompt branch track ${name} --base ${base}`;
}

function tracked(name: string, base: string): CommandResult {
  return exited(0, '', `INF ${name}: tracking with base ${base}\n`);
}

/** The repository root: the workspace folder named `repo` (the other folder is its empty `nested` subfolder). */
// see primer §25 (arrays: find) and §30 (`??`)
function repositoryRoot(): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const repo = folders.find((folder) => path.basename(folder.uri.fsPath) === 'repo');
  if (repo === undefined) {
    throw new Error('the fixture workspace has no folder named repo');
  }
  return repo.uri.fsPath;
}

/** Runs `git <args>` in the fixture repository — the hermetic environment of test/ext/tree.test.ts, which says why each variable is set. */
// see primer §28 (the Sync variants of Node's functions) and §16 (object literals: spread)
function runGit(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repositoryRoot(),
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

/**
 * A fake git-spice that answers its banner, `gs log` with `lines`, and each `gs branch track` the
 * fixture's three layers could need with git-spice's success line; the Map stays in the test's
 * hands, so a case can make one track fail or change the log.
 */
// see primer §19 (Map) and §31 (type arguments on `new Map`)
function fakeGitSpice(lines: string): { runner: FakeCommandRunner; results: Map<string, CommandResult> } {
  const results = new Map<string, CommandResult>([
    [VERSION, exited(0, BANNER)],
    [LOG, exited(0, lines)],
    [trackKey('api-refactor', 'main'), tracked('api-refactor', 'main')],
    [trackKey('add-retries', 'api-refactor'), tracked('add-retries', 'api-refactor')],
    [trackKey('retry-metrics', 'add-retries'), tracked('retry-metrics', 'add-retries')],
  ]);
  return { runner: new FakeCommandRunner(results), results };
}

/** Puts the fakes into the extension's seams; a new runner also means a new backend, with an empty memo. */
function useFakes(runner: FakeCommandRunner, host: FakeReadinessHost): void {
  deps.commands = runner;
  deps.host = host;
}

/** What `gs repo init` writes, standing in for it; and its undoing, exit 0 even when the ref is not there. */
function initialise(): void {
  runGit(['update-ref', 'refs/spice/data', 'HEAD']);
}

function uninitialise(): void {
  runGit(['update-ref', '-d', 'refs/spice/data']);
}

/**
 * Resolves with the next value `event` fires, or rejects after `deadlineMs` — so a test that
 * expects a load and gets none fails with its cause, and its `finally` still runs.
 */
// see primer §62 (a type parameter on a function), §42 (waiting for an event) and §58 (a wait with a deadline)
function nextEvent<T>(event: vscode.Event<T>, deadlineMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error(`no event within ${deadlineMs} ms`));
    }, deadlineMs);
    const subscription = event((value) => {
      clearTimeout(timer);
      subscription.dispose();
      resolve(value);
    });
  });
}

/**
 * One load, settled: the states the command will read were produced after this case's arrange.
 * The event, not the call, is the proof — a load overtaken by a newer one fires nothing.
 */
async function prime(): Promise<void> {
  const fired = nextEvent(provider.onDidLoadStates, 5_000);
  await provider.getChildren();
  await fired;
}

/**
 * Waits for the refresh's load a case subscribed to before running the command, with its outcome
 * thrown away: a rejection inside a `finally` would leave the block and skip the cleanup after it
 * — and replace the assertion that failed — so a drain that runs out must not throw. Nothing when
 * the case never got as far as subscribing.
 */
// see primer §63 (`.then` with a second function: the outcome no longer matters here)
async function drain(settled: Promise<unknown> | undefined): Promise<void> {
  if (settled !== undefined) {
    await settled.then(
      () => undefined,
      () => undefined,
    );
  }
}

/** Runs the command as the `…` menu or the Command Palette does; resolves with what it returned. */
// see primer §56 (executeCommand resolves with what the command returned) and §60 (`Thenable`)
function run(): Thenable<TrackResult | undefined> {
  return vscode.commands.executeCommand<TrackResult | undefined>('prCascade.trackStack');
}

/** The `gs branch track` requests the fake saw, as their argument lists. */
// see primer §25 (arrays: `filter`, `map`)
function trackCalls(runner: FakeCommandRunner): readonly string[][] {
  return runner.calls.filter((call) => call.args[1] === 'branch').map((call) => [...call.args]);
}

// see primer §5 (arrow functions) and §6 (async / await)
describe('Track Stack with git-spice (plan §7.2.1, E56, D60)', () => {
  before(async () => {
    // see primer §31 (a type argument on a call) and §8 (undefined and narrowing)
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    const api = await extension.activate();
    assert.ok(api.readinessDeps, 'activate() returned no readinessDeps — the extension host is not in ExtensionMode.Test');
    provider = api.provider;
    deps = api.readinessDeps;
    // see primer §16 (object literals: spread — a copy of the fields, not the object itself)
    real = { ...deps };
    // A ref a failed run left behind would make every case here start initialised.
    uninitialise();
  });

  after(() => {
    deps.commands = real.commands;
    deps.host = real.host;
  });

  it('is registered, and the manifest puts it in the view\'s `…` menu while a layer is untracked (plan §7.2.1)', async () => {
    // arrange
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    // see primer §42 (`packageJSON`, under a written type from this line on)
    const manifest: ExtensionManifest = extension.packageJSON;

    // act
    const commands = await vscode.commands.getCommands(true);

    // assert: the command, its title and category, the `view/title` entry word for word — and
    // no `enablement` yet (item 21's, with the rebase key)
    assert.ok(commands.includes('prCascade.trackStack'));
    // see primer §25 (arrays: `find`)
    const declared = manifest.contributes.commands.find((command) => command.command === 'prCascade.trackStack');
    assert.deepStrictEqual(declared, { command: 'prCascade.trackStack', title: 'Track Stack with git-spice', category: 'PR Cascade' });
    const menuEntry = manifest.contributes.menus['view/title'].find((entry) => entry.command === 'prCascade.trackStack');
    assert.deepStrictEqual(menuEntry, { command: 'prCascade.trackStack', when: 'view == prCascade && prCascade.hasUntracked', group: '2_stack@8' });
  });

  it('tracks every untracked layer bottom to top, on the trunk\'s local branch then each layer below, refreshes once and says how many (E56, E83)', async () => {
    // arrange: git-spice knows only its trunk — three untracked layers
    const { runner } = fakeGitSpice(TRUNK_LINE);
    const host = fakeReadinessHost();
    useFakes(runner, host);
    initialise();
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    let settled: Promise<unknown> | undefined;
    try {
      await prime();
      settled = nextEvent(provider.onDidLoadStates, 5_000);

      // act
      const result = await run();

      // assert
      assert.deepStrictEqual(result, { tracked: ['api-refactor', 'add-retries', 'retry-metrics'], problem: null });
      assert.deepStrictEqual(trackCalls(runner), [
        ['--no-prompt', 'branch', 'track', 'api-refactor', '--base', 'main'],
        ['--no-prompt', 'branch', 'track', 'add-retries', '--base', 'api-refactor'],
        ['--no-prompt', 'branch', 'track', 'retry-metrics', '--base', 'add-retries'],
      ]);
      // every call at the repository root, with the variables and the timeout every git-spice call
      // carries — compared structurally: out/'s GS_ENV is not the bundle's object
      for (const call of runner.calls) {
        assert.strictEqual(call.cwd, repositoryRoot());
        assert.deepStrictEqual(call.env, GS_ENV);
        assert.strictEqual(call.timeoutMs, PROBE_TIMEOUT_MS);
      }
      assert.strictEqual(treeChanges, 1);
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Tracked 3 branches with git-spice in repo.', buttons: [] }]);
      assert.deepStrictEqual(host.picked, []);
      // see primer §25 (arrays: `every`, `includes`): no login for the local tier
      assert.ok(runner.calls.every((call) => !call.args.includes('auth')));
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  it('re-loads the repository before tracking, so a branch tracked in a terminal since the last load is left alone', async () => {
    // arrange: the last load saw three untracked layers; then — as `gs branch track` in a terminal
    // would — git-spice knows the bottom one and refs/spice/data has moved
    const { runner, results } = fakeGitSpice(TRUNK_LINE);
    const host = fakeReadinessHost();
    useFakes(runner, host);
    initialise();
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    let settled: Promise<unknown> | undefined;
    try {
      await prime();
      results.set(LOG, exited(0, TRUNK_LINE + BOTTOM_LINE));
      runGit(['update-ref', 'refs/spice/data', 'HEAD~1']);
      settled = nextEvent(provider.onDidLoadStates, 5_000);

      // act
      const result = await run();

      // assert: two tracks, not three — the bottom layer is never re-tracked (its base would move)
      assert.deepStrictEqual(result, { tracked: ['add-retries', 'retry-metrics'], problem: null });
      assert.deepStrictEqual(trackCalls(runner), [
        ['--no-prompt', 'branch', 'track', 'add-retries', '--base', 'api-refactor'],
        ['--no-prompt', 'branch', 'track', 'retry-metrics', '--base', 'add-retries'],
      ]);
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Tracked 2 branches with git-spice in repo.', buttons: [] }]);
      assert.strictEqual(treeChanges, 1);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  it('says every layer is already tracked, runs nothing and refreshes nothing when git-spice knows them all', async () => {
    // arrange
    const { runner } = fakeGitSpice(TRUNK_LINE + BOTTOM_LINE + MIDDLE_LINE + TOP_LINE);
    const host = fakeReadinessHost();
    useFakes(runner, host);
    initialise();
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    try {
      await prime();

      // act
      const result = await run();

      // assert
      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(trackCalls(runner), []);
      assert.strictEqual(treeChanges, 0);
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Every layer in the Stack view is already tracked by git-spice.', buttons: [] }]);
    } finally {
      counting.dispose();
      uninitialise();
    }
  });

  it('names the reason and the setup command, as a warning, when the repository is not initialised for git-spice (E59, D60)', async () => {
    // arrange: a fake installed anyway, and no refs/spice/data
    const { runner } = fakeGitSpice(TRUNK_LINE);
    const host = fakeReadinessHost();
    useFakes(runner, host);
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    try {
      await prime();

      // act
      const result = await run();

      // assert: a warning, because a command is named (D57); nothing run, nothing refreshed
      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(runner.calls, []);
      assert.strictEqual(treeChanges, 0);
      assert.deepStrictEqual(host.asked, [
        {
          severity: 'warning',
          message: 'No git-spice tracking info for repo — the repository is not initialised for git-spice (no refs/spice/data). Run PR Cascade: Set Up git-spice.',
          buttons: [],
        },
      ]);
    } finally {
      counting.dispose();
    }
  });

  it('stops at the first layer git-spice refuses, keeps the ones before it, quotes git-spice, and still refreshes once', async () => {
    // arrange
    const { runner, results } = fakeGitSpice(TRUNK_LINE);
    results.set(trackKey('add-retries', 'api-refactor'), exited(1, '', 'FTL git-spice: branch "add-retries" does not exist\n'));
    const host = fakeReadinessHost();
    useFakes(runner, host);
    initialise();
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    let settled: Promise<unknown> | undefined;
    try {
      await prime();
      settled = nextEvent(provider.onDidLoadStates, 5_000);

      // act
      const result = await run();

      // assert: the third track was never asked; the sentence is core's, as a warning
      const problem = 'git-spice could not track add-retries: FTL git-spice: branch "add-retries" does not exist.';
      assert.deepStrictEqual(result, { tracked: ['api-refactor'], problem });
      assert.deepStrictEqual(trackCalls(runner), [
        ['--no-prompt', 'branch', 'track', 'api-refactor', '--base', 'main'],
        ['--no-prompt', 'branch', 'track', 'add-retries', '--base', 'api-refactor'],
      ]);
      assert.strictEqual(treeChanges, 1);
      assert.deepStrictEqual(host.asked, [{ severity: 'warning', message: problem, buttons: [] }]);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  it('says there is nothing to track when no repository shows a layer (E5)', async () => {
    // arrange: HEAD on trunk — no layers, nothing for git-spice to be asked about
    const { runner } = fakeGitSpice(TRUNK_LINE);
    const host = fakeReadinessHost();
    useFakes(runner, host);
    runGit(['checkout', '-q', 'main']);
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    try {
      await prime();

      // act
      const result = await run();

      // assert
      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(runner.calls, []);
      assert.strictEqual(treeChanges, 0);
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Nothing to track — the Stack view shows no layers.', buttons: [] }]);
    } finally {
      counting.dispose();
      runGit(['checkout', '-q', 'retry-metrics']);
    }
  });

  it('says the view has no repository loaded when the last load failed (E17)', async () => {
    // arrange: a `prCascade.gitPath` that does not exist — the load fails, the view shows an
    // error row and announces `[]` (vscode/tree.ts)
    const { runner } = fakeGitSpice(TRUNK_LINE);
    const host = fakeReadinessHost();
    useFakes(runner, host);
    const configuration = vscode.workspace.getConfiguration('prCascade');
    await configuration.update('gitPath', '/nowhere/git', vscode.ConfigurationTarget.Workspace);
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    try {
      await prime();

      // act
      const result = await run();

      // assert: a warning — the Refresh button is the action named
      assert.strictEqual(result, undefined);
      assert.strictEqual(treeChanges, 0);
      assert.deepStrictEqual(host.asked, [{ severity: 'warning', message: 'The Stack view has no repository loaded — refresh it first.', buttons: [] }]);
    } finally {
      counting.dispose();
      await configuration.update('gitPath', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  it('finds no stack in the fresh load when trunk was checked out between the load and the click, and still refreshes once', async () => {
    // arrange: the last load shows three untracked layers; then HEAD moves to trunk
    const { runner } = fakeGitSpice(TRUNK_LINE);
    const host = fakeReadinessHost();
    useFakes(runner, host);
    initialise();
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    let settled: Promise<unknown> | undefined;
    try {
      await prime();
      runGit(['checkout', '-q', 'main']);
      settled = nextEvent(provider.onDidLoadStates, 5_000);

      // act
      const result = await run();

      // assert: a root was chosen, so one refresh; nothing tracked
      assert.deepStrictEqual(result, { tracked: [], problem: null });
      assert.deepStrictEqual(trackCalls(runner), []);
      assert.strictEqual(treeChanges, 1);
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Not on a stack in repo — nothing to track.', buttons: [] }]);
    } finally {
      // The steps that cannot throw first, so a checkout that fails cannot leave the ref behind.
      await drain(settled);
      counting.dispose();
      uninitialise();
      runGit(['checkout', '-q', 'retry-metrics']);
    }
  });

  it('refuses during a paused rebase with the view\'s own sentence, tracking nothing, and still refreshes once (E12)', async () => {
    // arrange: the last load shows three untracked layers; then a rebase of the stack onto trunk
    // stops after the first replayed commit (`-x false`), as the E12 tree test does — git-spice
    // itself would track during the pause (verified 0.31.2), so the command must refuse
    const { runner } = fakeGitSpice(TRUNK_LINE);
    const host = fakeReadinessHost();
    useFakes(runner, host);
    initialise();
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    let settled: Promise<unknown> | undefined;
    try {
      await prime();
    } catch (error) {
      // The ref and the fake are in place and no rebase has started: undo them before failing.
      uninitialise();
      counting.dispose();
      throw error;
    }
    // see primer §18 (try / catch: a `catch` with no name for the error)
    try {
      runGit(['rebase', '-x', 'false', 'main']);
    } catch {
      // Expected: exit 1 after "warning: execution failed: false".
    }
    // precondition, not the idea under test: the rebase did pause — asserted outside the `try`
    // below, as the E12 tree test does, so a rebase that did not pause is not followed by an
    // `--abort` that would mask the message
    const rebaseDir = path.resolve(repositoryRoot(), runGit(['rev-parse', '--git-path', 'rebase-merge']).trim());
    assert.ok(fs.existsSync(rebaseDir), 'the rebase did not pause');
    try {
      settled = nextEvent(provider.onDidLoadStates, 5_000);

      // act
      const result = await run();

      // assert
      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(trackCalls(runner), []);
      assert.strictEqual(treeChanges, 1);
      assert.deepStrictEqual(host.asked, [{ severity: 'warning', message: 'Rebase in progress in repo — resolve it first.', buttons: [] }]);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
      runGit(['rebase', '--abort']);
    }
  });
});
