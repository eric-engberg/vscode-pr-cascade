/**
 * test/ext/commands.test.ts — "Track Stack with git-spice" and "Push Whole Stack" inside a real
 * VS Code, through the commands a user runs (`prCascade.trackStack`, `prCascade.pushStack`) on the
 * fixture repository. Track Stack (M5 item 20b): registered and in the manifest under the right
 * `when`; the untracked layers tracked bottom to top, exactly one refresh (E83) and one sentence;
 * the repository re-loaded fresh before anything runs; the refusals — nothing untracked, not
 * initialised, nothing loaded, no stack anywhere, the stack emptied before the click, a paused
 * rebase (E12) — each with its sentence; and a failure mid-way that still refreshes once. Push
 * Whole Stack (M5 item 21b): the manifest with `enablement` compared against the one module both
 * it and the listener read; one `stack submit --no-publish --no-update-only` with its 120 s
 * timeout after the fresh load, the untracked layers tracked first; the refusals — a paused rebase
 * with nothing pushed (E12), a layer the remote is ahead of (E76), a layer needing a restack, not
 * initialised, nothing loaded, no layers, a detached HEAD — a rejected push's sentence, one
 * branch, git-spice's notes and the sentence's tail, a second click while one runs, and the pick
 * with a second repository in the workspace. git-spice is a fake in the extension's seams (plan
 * §13.4); git is real, and nothing is ever pushed — the fake answers the submit.
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
 * workspace, src/core/backends/gitspice.ts (`GS_ENV`, `PROBE_TIMEOUT_MS`, `PUSH_TIMEOUT_MS`),
 * src/vscode/contextKeys.ts (the key names the manifest must spell), test/helpers/fakeCommand.ts,
 * test/helpers/fakeReadinessHost.ts, test/helpers/fixture.ts (a second repository), the real
 * built-in Git extension through test/ext/helpers/gitApi.ts (its "opened" event). Depended on by:
 * nothing. Plan: §7.2, §7.2.1, §7.7, §7.8, §8 E3/E5/E12/E17/E56/E59/E76/E83, §9.4 `ext/commands`,
 * §10.1 items 20b and 21b, §13.2 D60, D62.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { PushResult, TrackResult } from '../../src/core/backend';
import { GS_ENV, PROBE_TIMEOUT_MS, PUSH_TIMEOUT_MS } from '../../src/core/backends/gitspice';
import type { CommandRequest, CommandResult } from '../../src/core/command';
import type { ExtensionApi, ReadinessDeps } from '../../src/extension';
import { HAS_UNTRACKED_KEY, REBASE_IN_PROGRESS_KEY } from '../../src/vscode/contextKeys';
import type { StackTreeProvider } from '../../src/vscode/tree';
import { exited, FakeCommandRunner } from '../helpers/fakeCommand';
import { fakeReadinessHost } from '../helpers/fakeReadinessHost';
import type { FakeReadinessHost } from '../helpers/fakeReadinessHost';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';
import { realGitApi } from './helpers/gitApi';

// The extension's handle and the real seams, kept in `before` to be put back in `after`.
let provider: StackTreeProvider;
let deps: ReadinessDeps;
let real: ReadinessDeps;

/** The parts of the manifest the first case reads: VS Code hands `packageJSON` out as `any`, and this puts it under a written type. */
// see primer §9 (interface: shapes nested inline) and §42 (`packageJSON`: the manifest as VS Code read it; a key with a slash, quoted)
interface ExtensionManifest {
  contributes: {
    commands: { command: string; title: string; category?: string; enablement?: string }[];
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
// see primer §63 (`.then` with a second function: the outcome no longer matters here) and §60 (`Thenable`)
async function drain(settled: Thenable<unknown> | undefined): Promise<void> {
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

// Push Whole Stack's fake answers (item 21b): the submit's key, what git-spice prints for the
// fixture's three layers (stderr, verified 0.31.2), and `gs log` with every layer tracked and clean.
const SUBMIT = 'git-spice --no-prompt stack submit --no-publish --no-update-only';
const PUSHED_3 = exited(0, '', 'INF Pushed api-refactor\nINF Pushed add-retries\nINF Pushed retry-metrics\n');
const THREE = ['api-refactor', 'add-retries', 'retry-metrics'];
const ALL_TRACKED =
  TRUNK_LINE +
  '{"name":"api-refactor","down":{"name":"main"},"push":{"ahead":0,"behind":0}}\n' +
  '{"name":"add-retries","down":{"name":"api-refactor"},"push":{"ahead":0,"behind":0}}\n' +
  '{"name":"retry-metrics","down":{"name":"add-retries"},"push":{"ahead":0,"behind":0}}\n';

/** One turn of the event loop: what VS Code needs between applying a folder change and the events it sends for it. */
// see primer §15 (new Promise) and §58 (setTimeout)
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Runs the push command as the `…` menu or the Command Palette does; resolves with what it returned. */
function runPush(): Thenable<PushResult | undefined> {
  return vscode.commands.executeCommand<PushResult | undefined>('prCascade.pushStack');
}

/** The git-spice calls that act — `branch track` and `stack submit` — as argument lists, in order; the prime's `gs log` and the banners are not among them. */
function stackCalls(runner: FakeCommandRunner): readonly string[][] {
  return runner.calls.filter((call) => call.args[1] === 'branch' || call.args[1] === 'stack').map((call) => [...call.args]);
}

/** The submits alone, whole. */
function submitCalls(runner: FakeCommandRunner): readonly CommandRequest[] {
  return runner.calls.filter((call) => call.args[1] === 'stack');
}

/** What the fixture's origin holds, by ref name: the proof that a case pushed nothing real. */
// see primer §25 (arrays: `split`, `filter`, `map`)
function remoteHeads(): string[] {
  return runGit(['ls-remote', '--heads', 'origin'])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\t')[1]);
}

/**
 * A fake whose `stack submit` answer waits for a gate the test opens, so a second click lands while
 * the first push is in flight. `reached` resolves when the submit was asked — or rejects after
 * `deadlineMs`, so a push that settled early (a refusal the case did not expect) fails with its
 * cause instead of hanging to Mocha's timeout; `openGate` lets the submit answer. Built on the Map
 * the fake helper returns, since the fake keeps its answers private.
 */
// see primer §13 (class, extends and constructor: a class built on another, and `super.run` — the
// parent's method, called from the child's), §15 (new Promise: a gate the test opens, its `resolve`
// kept in a variable), §33 (function types: `openGate: () => void`, a no-op until `resolve` replaces
// it) and §58 (a wait with a deadline)
function slowRunner(results: Map<string, CommandResult>, deadlineMs: number): { runner: FakeCommandRunner; reached: Promise<void>; openGate: () => void } {
  let openGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  let signalReached: () => void = () => undefined;
  const reached = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`the first push did not reach the submit within ${deadlineMs} ms`));
    }, deadlineMs);
    signalReached = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  // A case that fails before its act never awaits `reached`, and a rejection nobody awaited would
  // surface as an unhandled one: a handler that does nothing marks it handled, and `await reached`
  // still rejects for the case that does wait (primer §63).
  void reached.then(undefined, () => undefined);
  class SlowRunner extends FakeCommandRunner {
    async run(request: CommandRequest): Promise<CommandResult> {
      if (request.args[1] === 'stack') {
        signalReached();
        await gate;
      }
      return super.run(request);
    }
  }
  return { runner: new SlowRunner(results), reached, openGate };
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

    // assert: the command, its title and category, the `view/title` entry word for word — its
    // `when` and (since item 21b) its `enablement` spelled from the module the listener writes
    // through, so a typo on either side fails here instead of leaving the entry always on
    assert.ok(commands.includes('prCascade.trackStack'));
    // see primer §25 (arrays: `find`)
    const declared = manifest.contributes.commands.find((command) => command.command === 'prCascade.trackStack');
    assert.deepStrictEqual(declared, { command: 'prCascade.trackStack', title: 'Track Stack with git-spice', category: 'PR Cascade', enablement: `!${REBASE_IN_PROGRESS_KEY}` });
    const menuEntry = manifest.contributes.menus['view/title'].find((entry) => entry.command === 'prCascade.trackStack');
    assert.deepStrictEqual(menuEntry, { command: 'prCascade.trackStack', when: `view == prCascade && ${HAS_UNTRACKED_KEY}`, group: '2_stack@8' });
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

// Push Whole Stack (M5 item 21b, D62): the same seams, the same timing rules. The fake answers the
// submit, so nothing reaches the fixture's origin — the happy case proves it with `ls-remote`.
describe('Push Whole Stack (plan §7.2.1, E12, E76, E83, D62)', () => {
  before(async () => {
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    const api = await extension.activate();
    assert.ok(api.readinessDeps, 'activate() returned no readinessDeps — the extension host is not in ExtensionMode.Test');
    provider = api.provider;
    deps = api.readinessDeps;
    real = { ...deps };
    uninitialise();
  });

  after(() => {
    deps.commands = real.commands;
    deps.host = real.host;
  });

  it('is registered, and the manifest disables it through the key the listener sets and puts it first in the view\'s `…` menu (plan §7.2.1)', async () => {
    // arrange
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    const manifest: ExtensionManifest = extension.packageJSON;

    // act
    const commands = await vscode.commands.getCommands(true);

    // assert: the `enablement` is spelled from the module the listener writes through — a key's value
    // cannot be read back, so this is the one check there is (`some` vs `every` stays a review item)
    assert.ok(commands.includes('prCascade.pushStack'));
    const declared = manifest.contributes.commands.find((command) => command.command === 'prCascade.pushStack');
    assert.deepStrictEqual(declared, { command: 'prCascade.pushStack', title: 'Push Whole Stack', category: 'PR Cascade', enablement: `!${REBASE_IN_PROGRESS_KEY}` });
    const menuEntry = manifest.contributes.menus['view/title'].find((entry) => entry.command === 'prCascade.pushStack');
    assert.deepStrictEqual(menuEntry, { command: 'prCascade.pushStack', when: 'view == prCascade', group: '2_stack@1' });
    const trackEntry = manifest.contributes.menus['view/title'].find((entry) => entry.command === 'prCascade.trackStack');
    assert.strictEqual(trackEntry?.group, '2_stack@8');
  });

  it('pushes the whole tracked stack with one `stack submit --no-publish --no-update-only`, a push-sized timeout, one refresh and one sentence — and nothing reaches the origin (E83)', async () => {
    // arrange: every layer tracked, nothing to track first
    const { runner, results } = fakeGitSpice(ALL_TRACKED);
    results.set(SUBMIT, PUSHED_3);
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
      const result = await runPush();

      // assert
      assert.deepStrictEqual(result, { pushed: THREE, notes: [], problem: null });
      const submits = submitCalls(runner);
      assert.strictEqual(submits.length, 1);
      assert.deepStrictEqual([...submits[0].args], ['--no-prompt', 'stack', 'submit', '--no-publish', '--no-update-only']);
      assert.strictEqual(submits[0].cwd, repositoryRoot());
      assert.deepStrictEqual(submits[0].env, GS_ENV);
      assert.strictEqual(submits[0].timeoutMs, PUSH_TIMEOUT_MS);
      // every other spawn keeps the probe's budget; no track, no login
      for (const call of runner.calls.filter((candidate) => candidate.args[1] !== 'stack')) {
        assert.strictEqual(call.timeoutMs, PROBE_TIMEOUT_MS);
        assert.ok(!call.args.includes('branch') && !call.args.includes('auth'), `an unexpected call: ${call.args.join(' ')}`);
      }
      assert.strictEqual(treeChanges, 1);
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Pushed 3 branches with git-spice in repo.', buttons: [] }]);
      assert.deepStrictEqual(host.picked, []);
      assert.deepStrictEqual(remoteHeads(), ['refs/heads/main']);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  it('tracks the untracked layers first, bottom to top, then pushes (E56, §7.7)', async () => {
    // arrange: git-spice knows only its trunk
    const { runner, results } = fakeGitSpice(TRUNK_LINE);
    results.set(SUBMIT, PUSHED_3);
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
      const result = await runPush();

      // assert: three tracks, then the one submit, in that order
      assert.deepStrictEqual(stackCalls(runner), [
        ['--no-prompt', 'branch', 'track', 'api-refactor', '--base', 'main'],
        ['--no-prompt', 'branch', 'track', 'add-retries', '--base', 'api-refactor'],
        ['--no-prompt', 'branch', 'track', 'retry-metrics', '--base', 'add-retries'],
        ['--no-prompt', 'stack', 'submit', '--no-publish', '--no-update-only'],
      ]);
      assert.deepStrictEqual(result, { pushed: THREE, notes: [], problem: null });
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Pushed 3 branches with git-spice in repo.', buttons: [] }]);
      assert.strictEqual(treeChanges, 1);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  it('pushes nothing when tracking a layer fails, and says what git-spice said', async () => {
    // arrange
    const { runner, results } = fakeGitSpice(TRUNK_LINE);
    results.set(SUBMIT, PUSHED_3);
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
      const result = await runPush();

      // assert
      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(submitCalls(runner), []);
      assert.deepStrictEqual(host.asked, [{ severity: 'warning', message: 'git-spice could not track add-retries: FTL git-spice: branch "add-retries" does not exist.', buttons: [] }]);
      assert.strictEqual(treeChanges, 1);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  it('refuses during a paused rebase with the view\'s own sentence and pushes nothing — "assert message, don\'t actually push" (E12)', async () => {
    // arrange: the submit is canned, so a wrong push would be seen, not thrown
    const { runner, results } = fakeGitSpice(ALL_TRACKED);
    results.set(SUBMIT, PUSHED_3);
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
    const rebaseDir = path.resolve(repositoryRoot(), runGit(['rev-parse', '--git-path', 'rebase-merge']).trim());
    assert.ok(fs.existsSync(rebaseDir), 'the rebase did not pause');
    try {
      settled = nextEvent(provider.onDidLoadStates, 5_000);

      // act
      const result = await runPush();

      // assert
      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(submitCalls(runner), []);
      assert.strictEqual(treeChanges, 1);
      assert.deepStrictEqual(host.asked, [{ severity: 'warning', message: 'Rebase in progress in repo — resolve it first.', buttons: [] }]);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
      runGit(['rebase', '--abort']);
    }
  });

  it('refuses before anything moves when a layer needs a restack, naming the command to run', async () => {
    // arrange: the top two layers need a restack — git-spice would push the bottom one and then refuse
    // see primer §23 (`replace` with a string: the first occurrence — here the only one — in a copy; the string itself never changes)
    const stale = ALL_TRACKED.replace('"down":{"name":"api-refactor"}', '"down":{"name":"api-refactor","needsRestack":true}').replace('"down":{"name":"add-retries"}', '"down":{"name":"add-retries","needsRestack":true}');
    const { runner, results } = fakeGitSpice(stale);
    results.set(SUBMIT, PUSHED_3);
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
      const result = await runPush();

      // assert
      const problem = 'Nothing was pushed: add-retries and retry-metrics need a restack. Run git-spice stack restack in a terminal first.';
      assert.deepStrictEqual(result, { pushed: [], notes: [], problem });
      assert.deepStrictEqual(submitCalls(runner), []);
      assert.deepStrictEqual(host.asked, [{ severity: 'warning', message: problem, buttons: [] }]);
      assert.strictEqual(treeChanges, 1);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  it("refuses before anything moves when a layer's remote copy has commits this clone does not (E76)", async () => {
    // arrange: after a fetch, git-spice would overwrite them with exit 0 (verified 0.31.2)
    const behind = ALL_TRACKED.replace('"name":"api-refactor","down":{"name":"main"},"push":{"ahead":0,"behind":0}', '"name":"api-refactor","down":{"name":"main"},"push":{"ahead":0,"behind":1,"needsPush":true}');
    const { runner, results } = fakeGitSpice(behind);
    results.set(SUBMIT, PUSHED_3);
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
      const result = await runPush();

      // assert
      const problem = 'Nothing was pushed: api-refactor has commits on the remote that are not here. Bring them in first — a push would drop them.';
      assert.deepStrictEqual(result, { pushed: [], notes: [], problem });
      assert.deepStrictEqual(submitCalls(runner), []);
      assert.deepStrictEqual(host.asked, [{ severity: 'warning', message: problem, buttons: [] }]);
      assert.strictEqual(treeChanges, 1);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  it("quotes git-spice's fatal line and git's own line when the remote refuses a branch someone else moved (stale info)", async () => {
    // arrange: verbatim 0.31.2, with the fixture's origin and branch
    const originPath = path.join(path.dirname(repositoryRoot()), 'origin.git');
    const stderr =
      'FTL git-spice: submit branch api-refactor: push branch: push: exit status 1\n' +
      'FTL stderr:\n' +
      `FTL To ${originPath}\n` +
      'FTL  ! [rejected]        29e3acd2fe341fe21322a6127de4c0b5b1f6ca1a -> api-refactor (stale info)\n' +
      `FTL error: failed to push some refs to '${originPath}'\n`;
    const { runner, results } = fakeGitSpice(ALL_TRACKED);
    results.set(SUBMIT, exited(1, '', stderr));
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
      const result = await runPush();

      // assert
      const problem =
        'git-spice could not push the stack: FTL git-spice: submit branch api-refactor: push branch: push: exit status 1 — ! [rejected] 29e3acd2fe341fe21322a6127de4c0b5b1f6ca1a -> api-refactor (stale info).';
      assert.deepStrictEqual(result, {
        pushed: [],
        notes: [
          'FTL git-spice: submit branch api-refactor: push branch: push: exit status 1',
          'FTL stderr:',
          `FTL To ${originPath}`,
          'FTL  ! [rejected]        29e3acd2fe341fe21322a6127de4c0b5b1f6ca1a -> api-refactor (stale info)',
          `FTL error: failed to push some refs to '${originPath}'`,
        ],
        problem,
      });
      assert.deepStrictEqual(host.asked, [{ severity: 'warning', message: problem, buttons: [] }]);
      assert.strictEqual(treeChanges, 1);
      assert.strictEqual(submitCalls(runner).length, 1);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  it('names the reason and the setup command, as a warning, when the repository is not initialised — and still refreshes once, a repository having been chosen (E59)', async () => {
    // arrange: a fake installed anyway, and no refs/spice/data
    const { runner, results } = fakeGitSpice(ALL_TRACKED);
    results.set(SUBMIT, PUSHED_3);
    const host = fakeReadinessHost();
    useFakes(runner, host);
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    let settled: Promise<unknown> | undefined;
    try {
      await prime();
      settled = nextEvent(provider.onDidLoadStates, 5_000);

      // act
      const result = await runPush();

      // assert: zero spawns — the digest said not initialised in the load and in the command
      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(runner.calls, []);
      assert.strictEqual(treeChanges, 1);
      assert.deepStrictEqual(host.asked, [
        {
          severity: 'warning',
          message: 'No git-spice tracking info for repo — the repository is not initialised for git-spice (no refs/spice/data). Run PR Cascade: Set Up git-spice.',
          buttons: [],
        },
      ]);
    } finally {
      await drain(settled);
      counting.dispose();
    }
  });

  it('says the view has no repository loaded when the last load failed (E17)', async () => {
    // arrange
    const { runner } = fakeGitSpice(ALL_TRACKED);
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
      const result = await runPush();

      // assert
      assert.strictEqual(result, undefined);
      assert.strictEqual(treeChanges, 0);
      assert.deepStrictEqual(host.asked, [{ severity: 'warning', message: 'The Stack view has no repository loaded — refresh it first.', buttons: [] }]);
    } finally {
      counting.dispose();
      await configuration.update('gitPath', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  it('says there is nothing to push when no repository shows a layer (E5)', async () => {
    // arrange: HEAD on trunk
    const { runner } = fakeGitSpice(ALL_TRACKED);
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
      const result = await runPush();

      // assert
      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(runner.calls, []);
      assert.strictEqual(treeChanges, 0);
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Nothing to push — the Stack view shows no layers.', buttons: [] }]);
    } finally {
      counting.dispose();
      runGit(['checkout', '-q', 'retry-metrics']);
    }
  });

  it('finds no stack in the fresh load when trunk was checked out between the load and the click, and still refreshes once', async () => {
    // arrange
    const { runner, results } = fakeGitSpice(ALL_TRACKED);
    results.set(SUBMIT, PUSHED_3);
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
      const result = await runPush();

      // assert
      assert.deepStrictEqual(result, { pushed: [], notes: [], problem: null });
      assert.deepStrictEqual(submitCalls(runner), []);
      assert.strictEqual(treeChanges, 1);
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Not on a stack in repo — nothing to push.', buttons: [] }]);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
      runGit(['checkout', '-q', 'retry-metrics']);
    }
  });

  it('refuses on a detached HEAD — `stack submit` acts on the branch checked out — and still refreshes once (E3)', async () => {
    // arrange
    const { runner, results } = fakeGitSpice(ALL_TRACKED);
    results.set(SUBMIT, PUSHED_3);
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
      runGit(['checkout', '-q', '--detach']);
      settled = nextEvent(provider.onDidLoadStates, 5_000);

      // act
      const result = await runPush();

      // assert
      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(submitCalls(runner), []);
      assert.strictEqual(treeChanges, 1);
      assert.deepStrictEqual(host.asked, [{ severity: 'warning', message: 'Detached HEAD in repo — check out a branch of the stack first.', buttons: [] }]);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
      runGit(['checkout', '-q', 'retry-metrics']);
    }
  });

  it('answers a second click while a push is in flight with a sentence, running nothing twice', async () => {
    // arrange: a fake that holds the submit's answer until the test lets go
    const { results } = fakeGitSpice(ALL_TRACKED);
    results.set(SUBMIT, PUSHED_3);
    const slow = slowRunner(results, 5_000);
    const host = fakeReadinessHost();
    useFakes(slow.runner, host);
    initialise();
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    let settled: Promise<unknown> | undefined;
    let first: Thenable<PushResult | undefined> | undefined;
    try {
      await prime();
      settled = nextEvent(provider.onDidLoadStates, 5_000);

      // act: the first push reaches the submit and waits there; the second click lands meanwhile
      first = runPush();
      await slow.reached;
      const second = await runPush();

      // assert: the second said so and ran nothing; the first finished alone
      assert.strictEqual(second, undefined);
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Already pushing the stack in repo.', buttons: [] }]);
      slow.openGate();
      const result = await first;
      assert.deepStrictEqual(result, { pushed: THREE, notes: [], problem: null });
      assert.strictEqual(submitCalls(slow.runner).length, 1);
      assert.strictEqual(treeChanges, 1);
      assert.strictEqual(host.asked.length, 2);
    } finally {
      // The gate first: a failed assertion before it opened would otherwise leave the first push
      // parked inside the fake, the guard holding the root for every later case.
      slow.openGate();
      await drain(first);
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  it('says `1 branch` for one — the count is git-spice\'s, not the view\'s', async () => {
    // arrange
    const { runner, results } = fakeGitSpice(ALL_TRACKED);
    results.set(SUBMIT, exited(0, '', 'INF Pushed api-refactor\n'));
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
      const result = await runPush();

      // assert
      assert.deepStrictEqual(result, { pushed: ['api-refactor'], notes: [], problem: null });
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Pushed 1 branch with git-spice in repo.', buttons: [] }]);
      assert.strictEqual(treeChanges, 1);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  it("points at the Output panel when git-spice said more than `Pushed` — an upstream renamed to `<name>-2`", async () => {
    // arrange: verbatim 0.31.2 — the remote already had api-refactor with no upstream recorded here
    const { runner, results } = fakeGitSpice(ALL_TRACKED);
    results.set(
      SUBMIT,
      exited(0, '', "INF api-refactor: Branch name already in use in remote 'origin'\nINF api-refactor: Using upstream name 'api-refactor-2' instead\nINF Pushed api-refactor\nINF Pushed add-retries\nINF Pushed retry-metrics\n"),
    );
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
      const result = await runPush();

      // assert: the Output lines themselves cannot be read from the extension host (20b's precedent); the tail can
      assert.deepStrictEqual(result, {
        pushed: THREE,
        notes: ["INF api-refactor: Branch name already in use in remote 'origin'", "INF api-refactor: Using upstream name 'api-refactor-2' instead"],
        problem: null,
      });
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'Pushed 3 branches with git-spice in repo — git-spice also left notes in the Output panel.', buttons: [] }]);
      assert.strictEqual(treeChanges, 1);
    } finally {
      await drain(settled);
      counting.dispose();
      uninitialise();
    }
  });

  // The pick, pinned against the command itself: a second repository joins the workspace the way
  // test/ext/gitApi.test.ts adds one — a second Appendix A stack renamed `second` (the builder
  // always names its repository `repo`), added with `updateWorkspaceFolders`, the Git extension's
  // "opened" event and the load it causes waited for; removed in `after`, whatever the test did.
  describe('with a second repository in the workspace', () => {
    let second: Fixture | undefined;
    let secondDir = '';
    let output: vscode.OutputChannel;

    before(async () => {
      output = vscode.window.createOutputChannel('PR Cascade push tests');
      second = buildStack();
      secondDir = path.join(path.dirname(second.dir), 'second');
      // see primer §28 (`renameSync` is `mv`)
      fs.renameSync(second.dir, secondDir);
      const api = await realGitApi(output);
      const folders = vscode.workspace.workspaceFolders ?? [];
      const opened = nextEvent(api.onDidOpenRepository, 10_000);
      const foldersChanged = nextEvent(vscode.workspace.onDidChangeWorkspaceFolders, 10_000);
      assert.strictEqual(vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(secondDir) }), true, 'VS Code refused to add the second folder');
      await foldersChanged;
      await opened;
      await tick();
      // The Git extension runs the new repository's first `git status` right after opening it, and
      // that status becomes a debounced refresh (M4 item 12b): waited for here, so it cannot land in
      // a case. The loads these refreshes start need no wait: a case's `prime()` numbers its own load
      // newest before any of them can finish, and an older load fires nothing (vscode/tree.ts, `loads`).
      await nextEvent(provider.onDidChangeTreeData, 10_000);
    });

    after(async () => {
      try {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const folder = folders.find((candidate) => candidate.uri.fsPath === secondDir);
        if (folder !== undefined) {
          const changed = nextEvent(vscode.workspace.onDidChangeWorkspaceFolders, 10_000);
          assert.strictEqual(vscode.workspace.updateWorkspaceFolders(folder.index, 1), true, 'VS Code refused to remove the second folder');
          await changed;
          await tick();
        }
      } finally {
        if (second !== undefined) {
          second.cleanup();
        }
        output.dispose();
      }
    });

    it('asks which repository, by folder name, with its own question — and refreshes nothing before one is chosen', async () => {
      // arrange: both repositories have layers, neither is initialised for git-spice; the user escapes the pick
      const { runner } = fakeGitSpice(TRUNK_LINE);
      const host = fakeReadinessHost({ picks: [undefined] });
      useFakes(runner, host);
      let treeChanges = 0;
      const counting = provider.onDidChangeTreeData(() => {
        treeChanges += 1;
      });
      try {
        await prime();

        // act
        const result = await runPush();

        // assert
        assert.strictEqual(result, undefined);
        assert.deepStrictEqual(host.picked, [{ labels: ['repo', 'second'], placeHolder: 'Push the stack of which repository with git-spice?' }]);
        assert.strictEqual(treeChanges, 0);
        assert.deepStrictEqual(stackCalls(runner), []);
      } finally {
        counting.dispose();
      }
    });
  });
});
