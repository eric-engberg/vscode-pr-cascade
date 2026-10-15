/**
 * test/ext/login.test.ts — the git-spice setup flow inside a real VS Code, through the command a
 * user runs ("PR Cascade: Set Up git-spice") on the fixture repository: the command is
 * registered; the init offer's line is typed into a terminal and, once the ref appears, the view
 * refreshes and the next offer follows; the login offer's line likewise, and once the fake
 * git-spice says logged in, the "ready" notification; a second click while a fix runs; a ready
 * repository asked again after a logout; a changed `prCascade.gsPath` making a new backend; and
 * VS Code's own terminals reused by name and directory. Since M5 item 23b the gh rows: a changed
 * `prCascade.ghPath` making a new backend; the gh-stack install and then gh's login in one
 * terminal, ending in the ready line that names both tools; gh installed with the Homebrew the
 * host was told about, then the extension's offer; both gh settings on the login line; and a
 * GitLab repository asking nothing of gh. The timing rules — 3 s, 5 min, aborts — are
 * test/unit/login.test.ts's, on fake timers; here the poll is 50 ms and the point is the wiring.
 *
 * Never the real git-spice, and never the real gh: the handle `activate()` returns under
 * `ExtensionMode.Test` (plan §13.4) carries the setup flow's seams, and the test puts a
 * FakeCommandRunner (which throws on any command nobody canned — gh's three questions are canned
 * since item 23a, when step 5 began reaching gh on every GitHub row) and a fake host in them, and
 * the real ones back afterwards. git is real: the probe's own questions run against the fixture.
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * Depends on: the running extension (what activate() returns in test mode), the fixture
 * workspace, test/helpers/fakeCommand.ts, test/helpers/fakeReadinessHost.ts,
 * src/vscode/terminal.ts. Depended on by: nothing. Plan: §7.5, §7.6, §7.13.1, §8
 * E21/E55/E59/E67/E83, §9.4 `ext/login`, §10.1 item 19b, §13.2 D58, §13.4.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { after, before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { CommandResult } from '../../src/core/command';
import { shellCommandLine } from '../../src/core/shell';
import type { ExtensionApi, ReadinessDeps } from '../../src/extension';
import type { ReadyOutcome } from '../../src/vscode/login';
import { runInTerminal } from '../../src/vscode/terminal';
import type { StackTreeProvider } from '../../src/vscode/tree';
import { exited, FakeCommandRunner, neverStarted } from '../helpers/fakeCommand';
import { fakeReadinessHost } from '../helpers/fakeReadinessHost';
import type { FakeReadinessHost } from '../helpers/fakeReadinessHost';

// The extension's handle and the real seams, kept in `before` to be put back in `after`.
let provider: StackTreeProvider;
let deps: ReadinessDeps;
let real: ReadinessDeps;

// The fake git-spice's keys (executable and arguments joined by spaces), as the probe asks them —
// and as the tree's `enrich` asks `gs log` (item 20b): once the init fix has written
// `refs/spice/data`, the E83 refresh enriches through the same fake, which throws for a command
// nobody canned, so the default fake answers `gs log` with nothing (no layer tracked). And the
// fake gh's three keys (item 23a): once step 5 exists every GitHub row reaches gh through the same
// runner, so the default fake answers all three as found and logged in.
// see primer §4 (const)
const VERSION = 'git-spice --no-prompt --version';
const AUTH = 'git-spice --no-prompt auth status --forge github';
const LOG = 'git-spice --no-prompt log short --all --json';
const BANNER = 'git-spice 0.31.2\nCopyright (C) Abhinav Gupta\n';
const GH_VERSION = 'gh --version';
const GH_STACK = 'gh stack --version';
const GH_AUTH = 'gh auth status --hostname github.com';
const GH_BANNER = 'gh version 2.102.0 (2026-09-30)\nhttps://github.com/cli/cli/releases/tag/v2.102.0\n';

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

/** One canned answer: the fake's key for a command, and what the program would have produced. */
// see primer §9 (interface)
interface Canned {
  key: string;
  result: CommandResult;
}

/**
 * A fake git-spice: `git-spice` answers its banner and an empty `gs log` (every ext test that writes
 * `refs/spice/data` with a fake installed must can `gs log`, since the refresh after the fix
 * enriches through it), plus whatever the test adds. The Map stays in the test's hands, so it can
 * change an answer mid-flow.
 */
// see primer §19 (Map), §31 (type arguments on `new Map`), §22 (for ... of) and §13 (a default parameter)
function fakeGitSpice(extra: Canned[] = []): { runner: FakeCommandRunner; results: Map<string, CommandResult> } {
  const results = new Map<string, CommandResult>([
    [VERSION, exited(0, BANNER)],
    [LOG, exited(0, '')],
    [GH_VERSION, exited(0, GH_BANNER)],
    [GH_STACK, exited(0, 'gh stack version 0.1.1\n')],
    [GH_AUTH, exited(0, 'github.com\n  ✓ Logged in to github.com account test (keyring)\n')],
  ]);
  for (const canned of extra) {
    results.set(canned.key, canned.result);
  }
  return { runner: new FakeCommandRunner(results), results };
}

/** Puts the fakes into the extension's seams; a new runner also means a new backend, so no `ready` is remembered from another test. */
function useFakes(runner: FakeCommandRunner, host: FakeReadinessHost): void {
  deps.commands = runner;
  deps.host = host;
}

/** Runs the setup command as the Command Palette does; resolves with the flow's outcome. */
// see primer §56 (executeCommand resolves with what the command returned) and §60 (`Thenable`)
function setUp(): Thenable<ReadyOutcome | undefined> {
  return vscode.commands.executeCommand<ReadyOutcome | undefined>('prCascade.setUpGitSpice');
}

/**
 * Ends a flow that may still be waiting — closing every fake terminal stops its wait through the
 * designed path — and waits for the command to settle, whatever it settles with. First in the
 * `finally` of every case that may leave a flow waiting, so a wait that outlived a failed
 * assertion cannot probe the restored fixture.
 */
// see primer §63 (`.then` with a second function for a rejection: the outcome no longer matters here)
async function endFlow(host: FakeReadinessHost, flow: Thenable<unknown> | undefined): Promise<void> {
  for (const terminal of host.terminals.created) {
    host.terminals.close(terminal);
  }
  if (flow !== undefined) {
    await flow.then(
      () => undefined,
      () => undefined,
    );
  }
}

/** The fixture as a GitHub repository the probe can reach step 4 on: initialised, a github.com remote, and `prCascade.remote` pointing at it. */
// see primer §35 (ConfigurationTarget) and §18 (try / catch: a remote left over by a failed run)
async function makeItGitHub(): Promise<void> {
  runGit(['update-ref', 'refs/spice/data', 'HEAD']);
  try {
    runGit(['remote', 'remove', 'github']);
  } catch {
    // not there — the usual case
  }
  runGit(['remote', 'add', 'github', 'git@github.com:org/repo.git']);
  await vscode.workspace.getConfiguration('prCascade').update('remote', 'github', vscode.ConfigurationTarget.Workspace);
}

/** Undoes makeItGitHub. */
async function undoGitHub(): Promise<void> {
  await vscode.workspace.getConfiguration('prCascade').update('remote', undefined, vscode.ConfigurationTarget.Workspace);
  runGit(['remote', 'remove', 'github']);
  runGit(['update-ref', '-d', 'refs/spice/data']);
}

/** The fixture as a GitLab repository, the same way (item 23b): a gitlab.com remote and `prCascade.remote` pointing at it — the probe's step 5 has nothing to ask there. */
async function makeItGitLab(): Promise<void> {
  runGit(['update-ref', 'refs/spice/data', 'HEAD']);
  try {
    runGit(['remote', 'remove', 'gitlab']);
  } catch {
    // not there — the usual case
  }
  runGit(['remote', 'add', 'gitlab', 'git@gitlab.com:org/repo.git']);
  await vscode.workspace.getConfiguration('prCascade').update('remote', 'gitlab', vscode.ConfigurationTarget.Workspace);
}

/** Undoes makeItGitLab. */
async function undoGitLab(): Promise<void> {
  await vscode.workspace.getConfiguration('prCascade').update('remote', undefined, vscode.ConfigurationTarget.Workspace);
  runGit(['remote', 'remove', 'gitlab']);
  runGit(['update-ref', '-d', 'refs/spice/data']);
}

/** What gh prints for `stack --version` when the extension is absent (measured 2.102.0). */
const GH_STACK_ABSENT = exited(1, '', 'gh stack is available as an official extension.\nTo install it, run:\n  gh extension install github/gh-stack\n');

// see primer §5 (arrow functions) and §6 (async / await)
describe('PR Cascade: Set Up git-spice (plan §7.13.1, D58)', () => {
  before(async () => {
    // see primer §31 (a type argument on a call) and §8 (undefined and narrowing)
    const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    const api = await extension.activate();
    assert.ok(api.readinessDeps, 'activate() returned no readinessDeps — the extension host is not in ExtensionMode.Test');
    provider = api.provider;
    deps = api.readinessDeps;
    // see primer §16 (object literals: spread — a copy of the three fields, not the object itself)
    real = { ...deps };
    deps.poll = { intervalMs: 50, timeoutMs: 5_000 };
  });

  after(() => {
    deps.commands = real.commands;
    deps.host = real.host;
    deps.poll = real.poll;
  });

  it('is registered', async () => {
    // act
    const commands = await vscode.commands.getCommands(true);

    // assert
    assert.ok(commands.includes('prCascade.setUpGitSpice'));
  });

  it('types `gs repo init` into the repository\'s terminal, and once the ref is there refreshes the view and offers the next step (E59, E83, E21)', async () => {
    // arrange: the fixture as built — no refs/spice/data, a bare local origin (E21 after init)
    const { runner } = fakeGitSpice();
    const host = fakeReadinessHost({ answers: ['Initialise'] });
    useFakes(runner, host);
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    let flow: Thenable<ReadyOutcome | undefined> | undefined;
    try {
      // act: the command, then — once the line is typed — what `gs repo init` would write
      flow = setUp();
      const sent = await host.terminals.nextSent();
      runGit(['update-ref', 'refs/spice/data', 'HEAD']);
      const outcome = await flow;

      // assert: the line, from the trunk git named (origin/main → main) and prCascade.remote
      assert.deepStrictEqual(sent, {
        name: 'PR Cascade: repo',
        cwd: repositoryRoot(),
        // see primer §12 (template strings)
        text: `${shellCommandLine(['cd', repositoryRoot()])} && command git-spice repo init --trunk main --remote origin`,
        execute: true,
      });
      assert.strictEqual(outcome, 'not-ready');
      assert.deepStrictEqual(
        host.asked.map((asked) => asked.message),
        [
          'git-spice is not initialised in repo. Initialise it with trunk main and remote origin?',
          'git-spice initialised in repo.',
          `The URL of repo's remote origin, ${path.join(path.dirname(repositoryRoot()), 'origin.git')}, names no GitHub or GitLab repository; the Stack view still works.`,
        ],
      );
      assert.strictEqual(treeChanges, 1);
      // never a login check: the probe stopped at the remote
      // see primer §25 (arrays: `every`, `includes`)
      assert.ok(runner.calls.every((call) => !call.args.includes('auth')));
    } finally {
      await endFlow(host, flow);
      counting.dispose();
      runGit(['update-ref', '-d', 'refs/spice/data']);
    }
  });

  it('types the login into a terminal, and once git-spice says logged in refreshes the view and says the repository is ready (E67, E55, E83)', async () => {
    // arrange
    await makeItGitHub();
    const { runner, results } = fakeGitSpice([{ key: AUTH, result: exited(1, '', 'FTL git-spice: github: not logged in\n') }]);
    const host = fakeReadinessHost({ answers: ['Log in'] });
    useFakes(runner, host);
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    let flow: Thenable<ReadyOutcome | undefined> | undefined;
    try {
      // act: the command; once the line is typed, the user logs in
      flow = setUp();
      const sent = await host.terminals.nextSent();
      results.set(AUTH, exited(0, '', 'INF github: currently logged in\n'));
      const outcome = await flow;

      // assert
      assert.strictEqual(sent.text, `${shellCommandLine(['cd', repositoryRoot()])} && env -u GITHUB_TOKEN git-spice auth login --forge github`);
      assert.strictEqual(outcome, 'acted');
      assert.deepStrictEqual(host.asked, [
        { severity: 'warning', message: 'git-spice is not logged in to github.com.', buttons: ['Log in'] },
        { severity: 'information', message: 'Logged in to github.com.', buttons: [] },
        { severity: 'information', message: 'git-spice 0.31.2 and gh 2.102.0 are ready for repo (github.com).', buttons: [] },
      ]);
      assert.strictEqual(treeChanges, 1);
      // asked at least twice while waiting, and never logged in by itself
      assert.ok(runner.calls.filter((call) => call.args.join(' ') === '--no-prompt auth status --forge github').length >= 2);
      assert.ok(runner.calls.every((call) => !call.args.includes('login')));
    } finally {
      await endFlow(host, flow);
      counting.dispose();
      await undoGitHub();
    }
  });

  it('brings the running fix\'s terminal forward on a second click, instead of starting another', async () => {
    // arrange
    await makeItGitHub();
    const { runner, results } = fakeGitSpice([{ key: AUTH, result: exited(1) }]);
    const host = fakeReadinessHost({ answers: ['Log in', 'Log in'] });
    useFakes(runner, host);
    let flow: Thenable<ReadyOutcome | undefined> | undefined;
    try {
      flow = setUp();
      await host.terminals.nextSent();

      // act: the command again, while the first waits
      const second = await setUp();

      // assert
      assert.strictEqual(second, 'in-flight');
      assert.strictEqual(host.terminals.created.length, 1);
      assert.strictEqual(host.terminals.sent.length, 1);
      assert.strictEqual(host.terminals.shows, 2);

      // and the first still finishes
      results.set(AUTH, exited(0));
      assert.strictEqual(await flow, 'acted');
    } finally {
      await endFlow(host, flow);
      await undoGitHub();
    }
  });

  it('says ready at once when it is — and asked again after a logout, looks again rather than answering from memory', async () => {
    // arrange
    await makeItGitHub();
    const { runner, results } = fakeGitSpice([{ key: AUTH, result: exited(0) }]);
    const host = fakeReadinessHost({ answers: [undefined] });
    useFakes(runner, host);
    try {
      // act: ready
      const first = await setUp();

      // assert
      assert.strictEqual(first, 'acted');
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'git-spice 0.31.2 and gh 2.102.0 are ready for repo (github.com).', buttons: [] }]);
      assert.strictEqual(host.terminals.created.length, 0);

      // act again: `gs auth logout` in a terminal, then the command once more (the offer is closed)
      results.set(AUTH, exited(1));
      const second = await setUp();

      // assert: the backend's remembered `ready` was dropped first, so the logout is seen
      assert.strictEqual(second, 'not-ready');
      assert.deepStrictEqual(host.asked[1], { severity: 'warning', message: 'git-spice is not logged in to github.com.', buttons: ['Log in'] });
    } finally {
      await endFlow(host, undefined);
      await undoGitHub();
    }
  });

  it('builds a new backend when prCascade.gsPath changes — the next probe runs the program it names (D56)', async () => {
    // arrange: one fake runner for both runs; the second program exists only in the fake
    await makeItGitHub();
    const { runner } = fakeGitSpice([
      { key: AUTH, result: exited(0) },
      { key: '/opt/fake/git-spice --no-prompt --version', result: exited(0, BANNER) },
      { key: '/opt/fake/git-spice --no-prompt auth status --forge github', result: exited(0) },
    ]);
    const host = fakeReadinessHost();
    useFakes(runner, host);
    const configuration = vscode.workspace.getConfiguration('prCascade');
    try {
      assert.strictEqual(await setUp(), 'acted');

      // act
      await configuration.update('gsPath', '/opt/fake/git-spice', vscode.ConfigurationTarget.Workspace);
      const outcome = await setUp();

      // assert: the old backend could only have asked git-spice or gs
      assert.strictEqual(outcome, 'acted');
      assert.ok(runner.calls.some((call) => call.executable === '/opt/fake/git-spice'));
    } finally {
      await configuration.update('gsPath', undefined, vscode.ConfigurationTarget.Workspace);
      await undoGitHub();
    }
  });

  it('builds a new backend when prCascade.ghPath changes — the next probe runs the gh it names (D56, item 23b)', async () => {
    // arrange: one fake runner for both runs; the second gh exists only in the fake, with all three answers
    await makeItGitHub();
    const { runner } = fakeGitSpice([
      { key: AUTH, result: exited(0) },
      { key: '/opt/fake/gh --version', result: exited(0, GH_BANNER) },
      { key: '/opt/fake/gh stack --version', result: exited(0, 'gh stack version 0.1.1\n') },
      { key: '/opt/fake/gh auth status --hostname github.com', result: exited(0) },
    ]);
    const host = fakeReadinessHost();
    useFakes(runner, host);
    const configuration = vscode.workspace.getConfiguration('prCascade');
    try {
      assert.strictEqual(await setUp(), 'acted');
      const before = runner.calls.length;

      // act
      await configuration.update('ghPath', '/opt/fake/gh', vscode.ConfigurationTarget.Workspace);
      const outcome = await setUp();

      // assert: after the change the new backend asked the gh named and never `gh`; the ready line is the same
      assert.strictEqual(outcome, 'acted');
      const after = runner.calls.slice(before);
      assert.ok(after.some((call) => call.executable === '/opt/fake/gh'));
      assert.ok(after.every((call) => call.executable !== 'gh'));
      assert.deepStrictEqual(host.asked[1], { severity: 'information', message: 'git-spice 0.31.2 and gh 2.102.0 are ready for repo (github.com).', buttons: [] });
    } finally {
      await configuration.update('ghPath', undefined, vscode.ConfigurationTarget.Workspace);
      await undoGitHub();
    }
  });

  it('installs gh-stack, then logs gh in, in one terminal, and says the repository is ready (E62b, E23, E83)', async () => {
    // arrange: git-spice logged in; gh there but its extension missing, and gh not logged in
    await makeItGitHub();
    const { runner, results } = fakeGitSpice([
      { key: AUTH, result: exited(0) },
      { key: GH_STACK, result: GH_STACK_ABSENT },
      { key: GH_AUTH, result: exited(1, '', 'You are not logged into any accounts on github.com\n') },
    ]);
    const host = fakeReadinessHost({ answers: ['Install gh-stack', 'Log in'] });
    useFakes(runner, host);
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    let flow: Thenable<ReadyOutcome | undefined> | undefined;
    try {
      // act: the command; once the install line is typed the extension "appears"; once the login
      // line is typed the user logs in
      flow = setUp();
      const install = await host.terminals.nextSent();
      results.set(GH_STACK, exited(0, 'gh stack version 0.2.1\n'));
      const login = await host.terminals.nextSent();
      results.set(GH_AUTH, exited(0));
      const outcome = await flow;

      // assert: both lines in the repository's one terminal, `command` past any alias, the token pair unset
      const cd = shellCommandLine(['cd', repositoryRoot()]);
      assert.deepStrictEqual(install, { name: 'PR Cascade: repo', cwd: repositoryRoot(), text: `${cd} && command gh extension install github/gh-stack`, execute: true });
      assert.strictEqual(login.text, `${cd} && env -u GH_TOKEN -u GITHUB_TOKEN gh auth login --hostname github.com --web --git-protocol https`);
      assert.strictEqual(outcome, 'acted');
      assert.deepStrictEqual(host.asked, [
        { severity: 'warning', message: 'gh 2.102.0 is installed, but its gh-stack extension is not; pull requests on github.com need it. Install it?', buttons: ['Install gh-stack'] },
        { severity: 'information', message: 'gh-stack installed.', buttons: [] },
        { severity: 'warning', message: 'gh is not logged in to github.com.', buttons: ['Log in'] },
        { severity: 'information', message: 'gh is logged in to github.com.', buttons: [] },
        { severity: 'information', message: 'git-spice 0.31.2 and gh 2.102.0 are ready for repo (github.com).', buttons: [] },
      ]);
      assert.strictEqual(treeChanges, 2);
      assert.strictEqual(host.terminals.created.length, 1);
      // asked at least twice while waiting for the login, and nothing of ours ever installed or logged in
      const ghCalls = runner.calls.filter((call) => call.executable === 'gh');
      assert.ok(ghCalls.filter((call) => call.args.join(' ') === 'auth status --hostname github.com').length >= 2);
      assert.ok(ghCalls.every((call) => !call.args.includes('login') && !call.args.includes('install')));
      // every gh spawn from the repository, for its host, with the probe's hygiene and timeout
      for (const call of ghCalls) {
        assert.strictEqual(call.cwd, repositoryRoot());
        assert.strictEqual(call.env?.GH_HOST, 'github.com');
        assert.strictEqual(call.env?.GH_PROMPT_DISABLED, '1');
        assert.strictEqual(call.timeoutMs, 15_000);
      }
    } finally {
      await endFlow(host, flow);
      counting.dispose();
      await undoGitHub();
    }
  });

  it('installs gh with the Homebrew it was told about, waits for gh to answer, then offers the extension (E24, E62b)', async () => {
    // arrange: nothing answers as gh; the host knows where brew is
    await makeItGitHub();
    const { runner, results } = fakeGitSpice([
      { key: AUTH, result: exited(0) },
      { key: GH_VERSION, result: neverStarted('not-found') },
      { key: GH_STACK, result: GH_STACK_ABSENT },
    ]);
    const host = fakeReadinessHost({ answers: ['Install with Homebrew', undefined], machine: { brewPath: '/opt/homebrew/bin/brew', brewGitSpice: null, brewGh: null } });
    useFakes(runner, host);
    let treeChanges = 0;
    const counting = provider.onDidChangeTreeData(() => {
      treeChanges += 1;
    });
    let flow: Thenable<ReadyOutcome | undefined> | undefined;
    try {
      // act: once the install line is typed, gh "appears"; the extension's offer is then closed
      flow = setUp();
      const sent = await host.terminals.nextSent();
      results.set(GH_VERSION, exited(0, GH_BANNER));
      const outcome = await flow;

      // assert
      assert.strictEqual(sent.text, `${shellCommandLine(['cd', repositoryRoot()])} && /opt/homebrew/bin/brew install gh`);
      assert.strictEqual(outcome, 'not-ready');
      assert.deepStrictEqual(
        host.asked.map((asked) => asked.message),
        [
          "Pull requests on github.com need gh 2.90.0 or newer and its gh-stack extension, and gh was not found in VS Code's PATH. Install it with Homebrew — or, if it is already installed, set prCascade.ghPath to its full path.",
          'gh installed.',
          'gh 2.102.0 is installed, but its gh-stack extension is not; pull requests on github.com need it. Install it?',
        ],
      );
      assert.strictEqual(treeChanges, 1);
    } finally {
      await endFlow(host, flow);
      counting.dispose();
      await undoGitHub();
    }
  });

  it('reads prCascade.ghPath and prCascade.gitProtocol on the login line — the gh named, the protocol set', async () => {
    // arrange: both settings set in the workspace; the gh named answers, and is not logged in
    await makeItGitHub();
    const configuration = vscode.workspace.getConfiguration('prCascade');
    await configuration.update('ghPath', '/opt/fake/gh', vscode.ConfigurationTarget.Workspace);
    await configuration.update('gitProtocol', 'ssh', vscode.ConfigurationTarget.Workspace);
    const { runner, results } = fakeGitSpice([
      { key: AUTH, result: exited(0) },
      { key: '/opt/fake/gh --version', result: exited(0, GH_BANNER) },
      { key: '/opt/fake/gh stack --version', result: exited(0, 'gh stack version 0.1.1\n') },
      { key: '/opt/fake/gh auth status --hostname github.com', result: exited(1) },
    ]);
    const host = fakeReadinessHost({ answers: ['Log in'] });
    useFakes(runner, host);
    let flow: Thenable<ReadyOutcome | undefined> | undefined;
    try {
      // act
      flow = setUp();
      const sent = await host.terminals.nextSent();
      results.set('/opt/fake/gh auth status --hostname github.com', exited(0));
      const outcome = await flow;

      // assert
      assert.strictEqual(sent.text, `${shellCommandLine(['cd', repositoryRoot()])} && env -u GH_TOKEN -u GITHUB_TOKEN /opt/fake/gh auth login --hostname github.com --web --git-protocol ssh`);
      assert.strictEqual(outcome, 'acted');
    } finally {
      await endFlow(host, flow);
      await configuration.update('ghPath', undefined, vscode.ConfigurationTarget.Workspace);
      await configuration.update('gitProtocol', undefined, vscode.ConfigurationTarget.Workspace);
      await undoGitHub();
    }
  });

  it('asks nothing of gh for a GitLab repository (E24)', async () => {
    // arrange: a gitlab.com remote, git-spice logged in to GitLab
    await makeItGitLab();
    const { runner } = fakeGitSpice([{ key: 'git-spice --no-prompt auth status --forge gitlab', result: exited(0) }]);
    const host = fakeReadinessHost({ answers: [undefined] });
    useFakes(runner, host);
    try {
      // act
      const outcome = await setUp();

      // assert: ready, naming git-spice alone, and no gh spawned
      assert.strictEqual(outcome, 'acted');
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'git-spice 0.31.2 is ready for repo (gitlab.com).', buttons: [] }]);
      assert.ok(runner.calls.every((call) => call.executable !== 'gh'));
    } finally {
      await endFlow(host, undefined);
      await undoGitLab();
    }
  });

  it('reuses one of VS Code\'s own terminals by name and directory — the real TerminalHost', async () => {
    // arrange: VS Code's window, as src/extension.ts hands it to the flow; `true` is harmless
    // see primer §72 (window.terminals, createTerminal, onDidCloseTerminal)
    const host = {
      terminals: () => vscode.window.terminals,
      create: (options: { readonly name: string; readonly cwd: string }) => vscode.window.createTerminal({ name: options.name, cwd: options.cwd }),
      onDidClose: vscode.window.onDidCloseTerminal,
    };
    const root = repositoryRoot();
    try {
      // act
      const first = runInTerminal(host, 'PR Cascade: login test', root, ['true']);
      const second = runInTerminal(host, 'PR Cascade: login test', root, ['true']);

      // assert
      assert.strictEqual(second, first);
      assert.strictEqual(vscode.window.terminals.filter((terminal) => terminal.name === 'PR Cascade: login test').length, 1);
    } finally {
      for (const terminal of vscode.window.terminals.filter((candidate) => candidate.name === 'PR Cascade: login test')) {
        terminal.dispose();
      }
    }
  });
});
