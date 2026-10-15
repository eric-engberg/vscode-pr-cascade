/**
 * test/ext/login.test.ts — the git-spice setup flow inside a real VS Code, through the command a
 * user runs ("PR Cascade: Set Up git-spice") on the fixture repository: the command is
 * registered; the init offer's line is typed into a terminal and, once the ref appears, the view
 * refreshes and the next offer follows; the login offer's line likewise, and once the fake
 * git-spice says logged in, the "ready" notification; a second click while a fix runs; a ready
 * repository asked again after a logout; a changed `prCascade.gsPath` making a new backend; and
 * VS Code's own terminals reused by name and directory. The timing rules — 3 s, 5 min, aborts —
 * are test/unit/login.test.ts's, on fake timers; here the poll is 50 ms and the point is the
 * wiring.
 *
 * Never the real git-spice: the handle `activate()` returns under `ExtensionMode.Test` (plan
 * §13.4) carries the setup flow's seams, and the test puts a FakeCommandRunner (which throws on
 * any command nobody canned) and a fake host in them, and the real ones back afterwards. git is
 * real: the probe's own questions run against the fixture.
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
import { exited, FakeCommandRunner } from '../helpers/fakeCommand';
import { fakeReadinessHost } from '../helpers/fakeReadinessHost';
import type { FakeReadinessHost } from '../helpers/fakeReadinessHost';

// The extension's handle and the real seams, kept in `before` to be put back in `after`.
let provider: StackTreeProvider;
let deps: ReadinessDeps;
let real: ReadinessDeps;

// The fake git-spice's keys (executable and arguments joined by spaces), as the probe asks them —
// and as the tree's `enrich` asks `gs log` (item 20b): once the init fix has written
// `refs/spice/data`, the E83 refresh enriches through the same fake, which throws for a command
// nobody canned, so the default fake answers `gs log` with nothing (no layer tracked).
// see primer §4 (const)
const VERSION = 'git-spice --no-prompt --version';
const AUTH = 'git-spice --no-prompt auth status --forge github';
const LOG = 'git-spice --no-prompt log short --all --json';
const BANNER = 'git-spice 0.31.2\nCopyright (C) Abhinav Gupta\n';

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
        { severity: 'information', message: 'git-spice 0.31.2 is ready for repo (github.com).', buttons: [] },
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
      assert.deepStrictEqual(host.asked, [{ severity: 'information', message: 'git-spice 0.31.2 is ready for repo (github.com).', buttons: [] }]);
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
