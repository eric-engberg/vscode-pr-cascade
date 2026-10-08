/**
 * test/unit/login.test.ts — the git-spice setup flow as a specification (plan §7.5's login flow,
 * applied to every §7.13.1 offer): probe → the member's offer → its fix on the click → wait until
 * the step passed → refresh → the next offer, or the action once ready. What happens on a
 * dismissed notification, a closed terminal, a timeout, a second click, a window closing; one
 * fix in flight per repository; and the two small helpers beside the flow.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest on fake timers — src/vscode/login.ts imports only
 * types from `vscode`, so it loads without VS Code, and five minutes of waiting take
 * milliseconds). The flow wired into a real VS Code is test/ext/login.test.ts. Depends on:
 * src/vscode/login.ts, test/helpers/fakeReadinessHost.ts, test/helpers/fakeGit.ts. Depended on
 * by: nothing. Plan: §7.5 steps 1–4, §7.6, §7.13.1, §8 E55/E59/E62/E67/E70/E83, §9.4
 * `ext/login`, §10.1 item 19b, §13.2 D58.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Readiness, Ready } from '../../src/core/backend';
import type { Forge, ForgeConfig } from '../../src/core/forge';
import type { GitRunner } from '../../src/core/model';
import { DEFAULT_POLL } from '../../src/core/poll';
import { INSTALL_DOCS_URL } from '../../src/core/readinessFix';
import { BREW_PATHS, chooseRepository, machineFacts, MAX_STEPS, ReadinessFlows } from '../../src/vscode/login';
import type { ReadyOutcome, ReadyRequest } from '../../src/vscode/login';
import { FakeGitRunner } from '../helpers/fakeGit';
import { fakeReadinessHost } from '../helpers/fakeReadinessHost';
import type { FakeHostScript, FakeReadinessHost } from '../helpers/fakeReadinessHost';

// The repository most cases are about; `repo` is the name the sentences give it.
// see primer §4 (const)
const ROOT = '/w/repo';

const GITHUB: Forge = { host: 'github.com', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: true };
const NO_CONFIG: ForgeConfig = { kind: null, rejectedKind: null, hosts: new Map() };

// The probe's answers the cases script.
// see primer §59 (tagged unions: building a member) and §16 (object literals: spread)
const READY: Ready = { kind: 'ready', gsPath: 'git-spice', gsVersion: '0.31.2', forge: GITHUB };
const NOT_LOGGED_IN: Readiness = { kind: 'not-logged-in', gsPath: 'git-spice', forge: GITHUB };
const NOT_INITIALIZED: Readiness = { kind: 'not-initialized', gsPath: 'git-spice' };
const GS_MISSING: Readiness = { kind: 'gs-missing', tried: ['git-spice', 'gs'] };
const TOO_OLD: Readiness = { kind: 'gs-too-old', gsPath: 'git-spice', found: '0.30.0', minimum: '0.31.0' };
const GH_MISSING: Readiness = { kind: 'gh-missing', forge: GITHUB, missing: ['gh-stack'], ghVersion: '2.91.0', ghMinimum: '2.90.0' };
const UNPARSEABLE: Readiness = { kind: 'remote-unparseable', remote: 'origin', url: '/srv/git/repo.git' };
// A Mac whose Homebrew has git-spice.
const HOMEBREW = { brewPath: '/opt/homebrew/bin/brew', brewGitSpice: '/opt/homebrew/bin/git-spice' };
const E70: Readiness = { kind: 'forge-unrecognized', forge: { ...GITHUB, host: 'corp.ghe.com', recognizedByGitSpice: false }, config: NO_CONFIG };

// The notifications the flow shows for those, as the fake records them.
const LOGIN_OFFER = { severity: 'warning', message: 'git-spice is not logged in to github.com.', buttons: ['Log in'] };
const LOGGED_IN = { severity: 'information', message: 'Logged in to github.com.', buttons: [] };
const LOGIN_LINE = 'cd /w/repo && env -u GITHUB_TOKEN git-spice auth login --forge github';

// The two questions trunkBranchFor asks, with the answers of a clone whose `main` exists.
const SYMBOLIC = 'rev-parse --verify --quiet --symbolic-full-name --end-of-options origin/main';
const LOCAL_MAIN = 'rev-parse --verify --quiet refs/heads/main';

/** A probe that answers from a script, one answer per call, the last one repeating; it counts its calls. */
// see primer §9 (interface), §33 (function types) and §61 (a getter in an object literal)
interface ScriptedProbe {
  probe: () => Promise<Readiness>;
  readonly probes: number;
}

// see primer §5 (arrow functions), §6 (async) and §30 (`??`)
function scripted(answers: Readiness[]): ScriptedProbe {
  let probes = 0;
  return {
    probe: async () => {
      probes += 1;
      return answers[probes - 1] ?? answers[answers.length - 1];
    },
    get probes() {
      return probes;
    },
  };
}

/** The flow with a fake host, and what it did besides the host: refreshes, log lines. */
interface Harness {
  flows: ReadinessFlows;
  host: FakeReadinessHost;
  readonly refreshes: number;
  readonly logs: string[];
}

function harness(script: FakeHostScript = {}): Harness {
  const host = fakeReadinessHost(script);
  let refreshes = 0;
  const logs: string[] = [];
  const flows = new ReadinessFlows(
    { host, poll: DEFAULT_POLL },
    () => {
      refreshes += 1;
    },
    (line) => logs.push(line),
  );
  return {
    flows,
    host,
    get refreshes() {
      return refreshes;
    },
    logs,
  };
}

/** A git fake that can answer the trunk question and take the E70 fix. */
// see primer §19 (Map) and §31 (type arguments on `new Map`)
function gitFor(): FakeGitRunner {
  return new FakeGitRunner(
    new Map<string, string | Error>([
      [SYMBOLIC, 'refs/remotes/origin/main\n'],
      [LOCAL_MAIN, 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n'],
      ['config spice.forge.github.url https://corp.ghe.com', ''],
      ['config spice.forge.github.apiUrl https://api.corp.ghe.com', ''],
    ]),
  );
}

/** One question for the flow: the repository at `root`, the script's probe, a git fake, and an action that records what it was given. */
// see primer §13 (default parameters)
function requestFor(probe: ScriptedProbe, actions: Ready[], root = ROOT, git: GitRunner = gitFor()): ReadyRequest {
  return {
    root,
    remote: 'origin',
    trunk: 'origin/main',
    gsPathSetting: '',
    probe: probe.probe,
    git,
    action: async (ready) => {
      actions.push(ready);
    },
  };
}

/** A Promise the test settles when it chooses: the way to hold a probe, a notification or an action in mid-air. */
// see primer §62 (declaring a type parameter on a function) and §15 (new Promise: keeping `resolve` to call later)
function held<T>(): { promise: Promise<T>; release: (value: T) => void } {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** A git whose `config` writes wait for `config.release()`, and which answers everything else as gitFor() does. */
// see primer §9 (an object literal that satisfies an interface)
function heldConfig(config: { promise: Promise<string> }): GitRunner {
  const inner = gitFor();
  return {
    run: (args, cwd) => (args[0] === 'config' ? config.promise : inner.run(args, cwd)),
    tryRun: (args, cwd) => inner.tryRun(args, cwd),
  };
}

/** An outcome, or `'pending'` while the flow has not finished — so a test can look in the middle without awaiting it. */
// see primer §63 (`.then`: a continuation without `await`)
function watch(flow: Promise<ReadyOutcome>): { readonly outcome: ReadyOutcome | 'pending' } {
  const state: { outcome: ReadyOutcome | 'pending' } = { outcome: 'pending' };
  void flow.then((outcome) => {
    state.outcome = outcome;
  });
  return state;
}

// Fake timers in every test (primer §65): the poll's 3-second sleeps happen when a test moves the
// clock, and the `Async` advance lets the flow's awaits run between them.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ReadinessFlows.ensureReady', () => {
  describe('ready, or not and the user says no', () => {
    it('runs the action at once when the probe says ready — no notification, no refresh, no terminal', async () => {
      // arrange
      const probe = scripted([READY]);
      const h = harness();
      const actions: Ready[] = [];

      // act
      const outcome = await h.flows.ensureReady(requestFor(probe, actions));

      // assert
      expect(outcome).toBe('acted');
      expect(actions).toStrictEqual([READY]);
      expect(h.host.asked).toStrictEqual([]);
      expect(h.refreshes).toBe(0);
      expect(h.host.terminals.created).toStrictEqual([]);
    });

    it('shows the offer and stops when the notification is closed — nothing run, nothing asked of git', async () => {
      // arrange
      const probe = scripted([NOT_LOGGED_IN]);
      const h = harness({ answers: [undefined] });
      const git = gitFor();
      const actions: Ready[] = [];

      // act
      const outcome = await h.flows.ensureReady(requestFor(probe, actions, ROOT, git));

      // assert
      expect(outcome).toBe('not-ready');
      expect(h.host.asked).toStrictEqual([LOGIN_OFFER]);
      expect(h.host.terminals.created).toStrictEqual([]);
      expect(probe.probes).toBe(1);
      expect(actions).toStrictEqual([]);
      // the trunk is asked about only for the init offer
      expect(git.calls).toStrictEqual([]);
    });

    it('shows an offer with no button without waiting for it to be closed, and stops there', async () => {
      // arrange: the fake never settles a notification with no buttons — awaiting it would hang
      const probe = scripted([{ kind: 'no-remote', remote: 'origin' }]);
      const h = harness();

      // act: no time passes, only what is already due runs
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(flow.outcome).toBe('not-ready');
      expect(h.host.asked).toStrictEqual([{ severity: 'warning', message: 'repo has no remote named origin — add one, or set prCascade.remote.', buttons: [] }]);
    });

    it('shows a button-less offer in its own colour — information for a remote that names no forge repository', async () => {
      // arrange
      const probe = scripted([{ kind: 'remote-unparseable', remote: 'origin', url: '/srv/git/repo.git' }]);
      const h = harness();

      // act
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(flow.outcome).toBe('not-ready');
      expect(h.host.asked[0].severity).toBe('information');
    });

    it('finishes only once the action has — the caller learns `acted` after the work, not before', async () => {
      // arrange: an action that takes as long as the test says
      const action = held<void>();
      const h = harness();
      const request: ReadyRequest = { ...requestFor(scripted([READY]), []), action: () => action.promise };

      // act
      const flow = watch(h.flows.ensureReady(request));
      await vi.advanceTimersByTimeAsync(0);
      const during = flow.outcome;
      action.release();
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(during).toBe('pending');
      expect(flow.outcome).toBe('acted');
    });
  });

  describe('the login flow (E67): terminal, wait, refresh, then the action', () => {
    it('types the login into the repository\'s terminal, asks again every 3 s, and once logged in refreshes, says so, and runs the action', async () => {
      // arrange: the offer's probe, the look after the click, still not logged in at 3 s, logged in at 6 s
      const probe = scripted([NOT_LOGGED_IN, NOT_LOGGED_IN, NOT_LOGGED_IN, READY]);
      const h = harness({ answers: ['Log in'] });
      const actions: Ready[] = [];

      // act: the click
      const flow = watch(h.flows.ensureReady(requestFor(probe, actions)));
      await vi.advanceTimersByTimeAsync(0);

      // assert: the line, in the repository's own terminal, and the wait listening for its close
      expect(h.host.terminals.sent).toStrictEqual([{ name: 'PR Cascade: repo', cwd: ROOT, text: LOGIN_LINE, execute: true }]);
      expect(h.host.terminals.shows).toBe(1);
      expect(h.host.terminals.listenerCount).toBe(1);
      expect(h.flows.inFlight).toStrictEqual([ROOT]);

      // act and assert: asked again at the click, then nothing before the first interval
      expect(probe.probes).toBe(2);
      await vi.advanceTimersByTimeAsync(2_999);
      expect(probe.probes).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(probe.probes).toBe(3);
      expect(flow.outcome).toBe('pending');

      // act: the next interval finds the login
      await vi.advanceTimersByTimeAsync(3_000);

      // assert: one refresh (E83), the done line, one more probe — ready — and the action
      expect(flow.outcome).toBe('acted');
      expect(probe.probes).toBe(5);
      expect(h.refreshes).toBe(1);
      expect(h.host.asked).toStrictEqual([LOGIN_OFFER, LOGGED_IN]);
      expect(actions).toStrictEqual([READY]);
      expect(h.host.terminals.listenerCount).toBe(0);
      expect(h.flows.inFlight).toStrictEqual([]);
    });

    it('gives up after 5 min with one line in the log and no notification — and asks again next time', async () => {
      // arrange
      const probe = scripted([NOT_LOGGED_IN]);
      const h = harness({ answers: ['Log in', 'Log in'] });

      // act
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(300_000);

      // assert
      expect(flow.outcome).toBe('gave-up');
      expect(probe.probes).toBe(102);
      expect(h.logs).toStrictEqual(['/w/repo: gave up waiting for not-logged-in to be fixed (timed out)']);
      expect(h.refreshes).toBe(0);
      expect(h.host.asked).toStrictEqual([LOGIN_OFFER]);
      expect(h.host.terminals.listenerCount).toBe(0);

      // act again: nothing is remembered about the give-up — not even the repository's flight
      const again = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(0);

      // assert: offered again, and the click types the line again — into a new terminal, since
      // the old one may still be sitting in the login it gave up waiting on
      expect(h.host.asked).toStrictEqual([LOGIN_OFFER, LOGIN_OFFER]);
      expect(h.host.terminals.sent.map((line) => line.text)).toStrictEqual([LOGIN_LINE, LOGIN_LINE]);
      expect(h.host.terminals.created.length).toBe(2);
      h.host.terminals.close(h.host.terminals.created[1]);
      await vi.advanceTimersByTimeAsync(0);
      expect(again.outcome).toBe('gave-up');
    });

    it('looks once more when the terminal is closed, and gives up — with a log line — if nothing changed', async () => {
      // arrange
      const probe = scripted([NOT_LOGGED_IN]);
      const h = harness({ answers: ['Log in'] });
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(0);

      // act: the user closes the terminal before the first interval
      h.host.terminals.close(h.host.terminals.created[0]);
      await vi.advanceTimersByTimeAsync(0);

      // assert: the offer's probe, the look at the click, and one last look — no waiting out the 5 minutes
      expect(flow.outcome).toBe('gave-up');
      expect(probe.probes).toBe(3);
      expect(h.logs).toStrictEqual(['/w/repo: gave up waiting for not-logged-in to be fixed (terminal closed)']);
      expect(h.host.terminals.listenerCount).toBe(0);
      expect(h.flows.inFlight).toStrictEqual([]);
    });

    it('counts a login finished just before the terminal was closed — the last look finds it', async () => {
      // arrange
      const probe = scripted([NOT_LOGGED_IN, NOT_LOGGED_IN, READY]);
      const h = harness({ answers: ['Log in'] });
      const actions: Ready[] = [];
      const flow = watch(h.flows.ensureReady(requestFor(probe, actions)));
      await vi.advanceTimersByTimeAsync(0);

      // act
      h.host.terminals.close(h.host.terminals.created[0]);
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(flow.outcome).toBe('acted');
      expect(h.refreshes).toBe(1);
      expect(h.host.asked).toStrictEqual([LOGIN_OFFER, LOGGED_IN]);
      expect(actions).toStrictEqual([READY]);
      expect(h.logs).toStrictEqual([]);
    });

    it('ignores the close of another terminal', async () => {
      // arrange
      const probe = scripted([NOT_LOGGED_IN]);
      const h = harness({ answers: ['Log in'] });
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(0);
      const other = h.host.terminals.create({ name: 'zsh', cwd: ROOT });

      // act
      h.host.terminals.close(other);
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(flow.outcome).toBe('pending');
      expect(probe.probes).toBe(2);
    });
  });

  describe('what counts as the step having passed', () => {
    it('looks again at the click: a notification answered after the step was done meanwhile runs nothing', async () => {
      // arrange: logged in in a terminal of the user's own while the offer sat in the notification centre
      const probe = scripted([NOT_LOGGED_IN, READY]);
      const h = harness({ answers: ['Log in'] });
      const actions: Ready[] = [];

      // act
      const outcome = await h.flows.ensureReady(requestFor(probe, actions));

      // assert: no terminal, no done line — the next pass found ready and acted
      expect(outcome).toBe('acted');
      expect(h.host.terminals.created).toStrictEqual([]);
      expect(h.host.asked).toStrictEqual([LOGIN_OFFER]);
      expect(h.refreshes).toBe(0);
      expect(actions).toStrictEqual([READY]);
    });

    it('never re-initialises: an Initialise clicked after the repository was initialised another way offers the next step instead', async () => {
      // arrange: `gs repo init --trunk develop` was run by hand while the offer was open — a second
      // init with `--trunk main` would quietly replace that trunk (git-spice 0.31.2 does not ask)
      const probe = scripted([NOT_INITIALIZED, NOT_LOGGED_IN]);
      const h = harness({ answers: ['Initialise', undefined] });

      // act
      const outcome = await h.flows.ensureReady(requestFor(probe, []));

      // assert
      expect(outcome).toBe('not-ready');
      expect(h.host.terminals.sent).toStrictEqual([]);
      expect(h.host.asked.map((asked) => asked.buttons)).toStrictEqual([['Initialise'], ['Log in']]);
    });

    it('does not count a step that went backwards — a probe that times out during a login wait says gs-missing, which is no login', async () => {
      // arrange: at 3 s git-spice does not answer in time; at 6 s the login is there
      const probe = scripted([NOT_LOGGED_IN, NOT_LOGGED_IN, GS_MISSING, READY]);
      const h = harness({ answers: ['Log in'] });

      // act
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(3_000);
      const at3 = { outcome: flow.outcome, refreshes: h.refreshes };
      await vi.advanceTimersByTimeAsync(3_000);

      // assert
      expect(at3).toStrictEqual({ outcome: 'pending', refreshes: 0 });
      expect(flow.outcome).toBe('acted');
      expect(h.host.asked).toStrictEqual([LOGIN_OFFER, LOGGED_IN]);
    });

    it('counts an install as done when Homebrew\'s git-spice appears on disk, though VS Code still cannot find it — and says where it is', async () => {
      // arrange: VS Code's PATH lacks Homebrew's directory, so the probe keeps saying gs-missing
      const probe = scripted([GS_MISSING]);
      const h = harness({ answers: ['Install with Homebrew'], machine: { brewPath: '/opt/homebrew/bin/brew', brewGitSpice: null } });
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(3_000);

      // act: `brew install` finishes
      h.host.machineFacts = { brewPath: '/opt/homebrew/bin/brew', brewGitSpice: '/opt/homebrew/bin/git-spice' };
      await vi.advanceTimersByTimeAsync(3_000);

      // assert: no 5-minute wait — installed, then the sentence that names the path for the setting
      expect(flow.outcome).toBe('not-ready');
      expect(h.refreshes).toBe(1);
      expect(h.host.asked.map((asked) => asked.message)).toStrictEqual([
        "git-spice was not found in VS Code's PATH (tried git-spice, gs). Install it with Homebrew — or, if it is already installed, set prCascade.gsPath to its full path.",
        'git-spice installed.',
        'git-spice is installed at /opt/homebrew/bin/git-spice, but VS Code did not find it (tried git-spice, gs). Set prCascade.gsPath to /opt/homebrew/bin/git-spice.',
      ]);
    });
  });

  describe('how far the probe got (`progressOf`)', () => {
    it('upgrades with Homebrew, and counts the upgrade as done when the probe gets past the version check', async () => {
      // arrange: upgraded by 3 s; the init offer after it is closed
      const probe = scripted([TOO_OLD, TOO_OLD, NOT_INITIALIZED]);
      const h = harness({ answers: ['Upgrade with Homebrew', undefined], machine: HOMEBREW });

      // act
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(3_000);

      // assert
      expect(h.host.terminals.sent[0].text).toBe('cd /w/repo && /opt/homebrew/bin/brew upgrade git-spice');
      expect(h.host.asked.map((asked) => asked.message)).toStrictEqual([
        'git-spice 0.30.0 is older than 0.31.0, the oldest PR Cascade works with.',
        'git-spice upgraded.',
        'git-spice is not initialised in repo. Initialise it with trunk main and remote origin?',
      ]);
      expect(flow.outcome).toBe('not-ready');
    });

    it('counts an install as done when the probe finds git-spice too old — it is installed, then offers the upgrade', async () => {
      // arrange
      const probe = scripted([GS_MISSING, GS_MISSING, TOO_OLD]);
      const h = harness({ answers: ['Install with Homebrew', undefined], machine: { brewPath: '/opt/homebrew/bin/brew', brewGitSpice: null } });

      // act
      watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(3_000);

      // assert
      expect(h.host.asked.map((asked) => asked.message).slice(1)).toStrictEqual(['git-spice installed.', 'git-spice 0.30.0 is older than 0.31.0, the oldest PR Cascade works with.']);
    });

    it('counts an init as done when the probe reaches the forge step', async () => {
      // arrange
      const probe = scripted([NOT_INITIALIZED, NOT_INITIALIZED, UNPARSEABLE]);
      const h = harness({ answers: ['Initialise'] });

      // act
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(3_000);

      // assert
      expect(flow.outcome).toBe('not-ready');
      expect(h.refreshes).toBe(1);
      expect(h.host.asked[1].message).toBe('git-spice initialised in repo.');
    });

    it('counts a login as done when the probe gets to gh (item 23\'s step)', async () => {
      // arrange
      const probe = scripted([NOT_LOGGED_IN, NOT_LOGGED_IN, GH_MISSING]);
      const h = harness({ answers: ['Log in'] });

      // act
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(3_000);

      // assert
      expect(flow.outcome).toBe('not-ready');
      expect(h.host.asked.map((asked) => asked.message)).toStrictEqual([
        LOGIN_OFFER.message,
        LOGGED_IN.message,
        'Pull requests on github.com need gh 2.90.0 or newer and its gh-stack extension; missing: gh-stack. Pushing and the local git-spice operations still work.',
      ]);
    });

    it('does not count a login as done when the probe falls back to the forge step', async () => {
      // arrange: at 3 s the remote is suddenly gone (prCascade.remote changed elsewhere)
      const probe = scripted([NOT_LOGGED_IN, NOT_LOGGED_IN, { kind: 'no-remote', remote: 'origin' }]);
      const h = harness({ answers: ['Log in'] });

      // act
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(3_000);

      // assert
      expect(flow.outcome).toBe('pending');
      expect(h.refreshes).toBe(0);
    });

    it('lets Homebrew\'s git-spice end only an install\'s wait — not a login\'s, nor an upgrade\'s', async () => {
      // arrange: Homebrew has git-spice all along; the login and the upgrade never happen
      const login = scripted([NOT_LOGGED_IN]);
      const upgrade = scripted([TOO_OLD]);
      const h = harness({ answers: ['Log in', 'Upgrade with Homebrew'], machine: HOMEBREW });

      // act
      const loginFlow = watch(h.flows.ensureReady(requestFor(login, [], '/w/a')));
      const upgradeFlow = watch(h.flows.ensureReady(requestFor(upgrade, [], '/w/b')));
      await vi.advanceTimersByTimeAsync(3_000);

      // assert
      expect({ login: loginFlow.outcome, upgrade: upgradeFlow.outcome }).toStrictEqual({ login: 'pending', upgrade: 'pending' });
      expect(h.refreshes).toBe(0);
    });
  });

  describe('one fix in flight per repository (§7.5 step 4)', () => {
    it('answers a second click while the fix runs by showing its terminal — no second terminal, no second line', async () => {
      // arrange: the first flow is waiting for the login; a second question for the same repository
      const probe = scripted([NOT_LOGGED_IN, NOT_LOGGED_IN, NOT_LOGGED_IN, NOT_LOGGED_IN, READY]);
      const h = harness({ answers: ['Log in', 'Log in'] });
      const actions: Ready[] = [];
      const first = watch(h.flows.ensureReady(requestFor(probe, actions)));
      await vi.advanceTimersByTimeAsync(0);

      // act
      const second = await h.flows.ensureReady(requestFor(probe, actions));

      // assert: shown again, taking the focus as the first time
      expect(second).toBe('in-flight');
      expect(h.host.terminals.created.length).toBe(1);
      expect(h.host.terminals.sent.length).toBe(1);
      expect(h.host.terminals.created[0].showCalls).toStrictEqual([undefined, undefined]);
      expect(h.host.asked).toStrictEqual([LOGIN_OFFER, LOGIN_OFFER]);

      // act: the first flow's wait goes on, and finds the login
      await vi.advanceTimersByTimeAsync(6_000);

      // assert: the action that was pending is the first one, run once
      expect(first.outcome).toBe('acted');
      expect(actions).toStrictEqual([READY]);
    });

    it('holds nothing while a notification is open — the click decides, so a notification left open does not block a later one', async () => {
      // arrange: the first notification is held open; a second question is asked meanwhile
      let release: (answer: string | undefined) => void = () => undefined;
      // see primer §15 (new Promise: keeping `resolve` to call later)
      const held = new Promise<string | undefined>((resolve) => {
        release = resolve;
      });
      const probe = scripted([NOT_LOGGED_IN, NOT_LOGGED_IN, NOT_LOGGED_IN, NOT_LOGGED_IN, READY]);
      const h = harness({ answers: [held, 'Log in'] });
      const actions: Ready[] = [];
      const first = watch(h.flows.ensureReady(requestFor(probe, actions)));
      await vi.advanceTimersByTimeAsync(0);

      // act: the second is clicked first, then the first
      const second = watch(h.flows.ensureReady(requestFor(probe, actions)));
      await vi.advanceTimersByTimeAsync(0);
      release('Log in');
      await vi.advanceTimersByTimeAsync(0);

      // assert: the second runs the fix; the first, clicked while it ran, shows the terminal
      expect(first.outcome).toBe('in-flight');
      expect(h.host.terminals.sent.length).toBe(1);
      expect(h.host.terminals.shows).toBe(2);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(second.outcome).toBe('acted');
      expect(actions).toStrictEqual([READY]);
    });

    it('keeps two repositories apart — a terminal, a wait and an action each', async () => {
      // arrange: a is logged in at 3 s, b at 6 s (each asked at its offer and again at its click first)
      const a = scripted([NOT_LOGGED_IN, NOT_LOGGED_IN, READY]);
      const b = scripted([NOT_LOGGED_IN, NOT_LOGGED_IN, NOT_LOGGED_IN, READY]);
      const h = harness({ answers: ['Log in', 'Log in'] });
      const actions: Ready[] = [];

      // act
      const flowA = watch(h.flows.ensureReady(requestFor(a, actions, '/w/a')));
      const flowB = watch(h.flows.ensureReady(requestFor(b, actions, '/w/b')));
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(h.host.terminals.created.map((terminal) => terminal.name)).toStrictEqual(['PR Cascade: a', 'PR Cascade: b']);
      expect(h.flows.inFlight).toStrictEqual(['/w/a', '/w/b']);
      await vi.advanceTimersByTimeAsync(3_000);
      expect({ a: flowA.outcome, b: flowB.outcome }).toStrictEqual({ a: 'acted', b: 'pending' });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(flowB.outcome).toBe('acted');
      expect(actions.length).toBe(2);
    });
  });

  describe('one fix after another (E55)', () => {
    it('initialises, then logs in, in the same terminal, then acts — one refresh and one done line per step', async () => {
      // arrange: not initialised until 6 s; then not logged in until 12 s (each step asked at its
      // offer and again at its click)
      const probe = scripted([NOT_INITIALIZED, NOT_INITIALIZED, NOT_INITIALIZED, NOT_LOGGED_IN, NOT_LOGGED_IN, NOT_LOGGED_IN, NOT_LOGGED_IN, READY]);
      const h = harness({ answers: ['Initialise', 'Log in'] });
      const git = gitFor();
      const actions: Ready[] = [];

      // act
      const flow = watch(h.flows.ensureReady(requestFor(probe, actions, ROOT, git)));
      await vi.advanceTimersByTimeAsync(12_000);

      // assert
      expect(flow.outcome).toBe('acted');
      expect(h.host.terminals.created.length).toBe(1);
      expect(h.host.terminals.sent.map((line) => line.text)).toStrictEqual(['cd /w/repo && command git-spice repo init --trunk main --remote origin', LOGIN_LINE]);
      expect(h.host.asked).toStrictEqual([
        { severity: 'warning', message: 'git-spice is not initialised in repo. Initialise it with trunk main and remote origin?', buttons: ['Initialise'] },
        { severity: 'information', message: 'git-spice initialised in repo.', buttons: [] },
        LOGIN_OFFER,
        LOGGED_IN,
      ]);
      expect(h.refreshes).toBe(2);
      expect(probe.probes).toBe(9);
      expect(actions).toStrictEqual([READY]);
      // the trunk question, asked for the init offer only, in the repository
      expect(git.calls.map((call) => call.args.join(' '))).toStrictEqual([SYMBOLIC, LOCAL_MAIN]);
      expect(h.host.terminals.listenerCount).toBe(0);
    });

    it('runs a git-config fix with git, at once and with no terminal or wait, then probes again (E70)', async () => {
      // arrange
      const probe = scripted([E70, E70, READY]);
      const h = harness({ answers: ['Set GitHub URLs'] });
      const git = gitFor();
      const actions: Ready[] = [];

      // act: no time passes
      const outcome = await h.flows.ensureReady(requestFor(probe, actions, ROOT, git));

      // assert
      expect(outcome).toBe('acted');
      expect(git.calls).toStrictEqual([
        { args: ['config', 'spice.forge.github.url', 'https://corp.ghe.com'], cwd: ROOT },
        { args: ['config', 'spice.forge.github.apiUrl', 'https://api.corp.ghe.com'], cwd: ROOT },
      ]);
      expect(h.host.terminals.created).toStrictEqual([]);
      expect(h.refreshes).toBe(1);
      expect(h.host.asked[1]).toStrictEqual({
        severity: 'information',
        message: 'spice.forge.github.url set to https://corp.ghe.com, and spice.forge.github.apiUrl to https://api.corp.ghe.com.',
        buttons: [],
      });
      expect(actions).toStrictEqual([READY]);
    });

    it('asks the probe again only once git config has returned', async () => {
      // arrange
      const config = held<string>();
      const probe = scripted([E70, E70, READY]);
      const h = harness({ answers: ['Set GitHub URLs'] });

      // act
      const flow = watch(h.flows.ensureReady(requestFor(probe, [], ROOT, heldConfig(config))));
      await vi.advanceTimersByTimeAsync(0);
      const during = { probes: probe.probes, refreshes: h.refreshes };
      config.release('');
      await vi.advanceTimersByTimeAsync(0);

      // assert: the offer's probe and the look at the click, then nothing until git returned
      expect(during).toStrictEqual({ probes: 2, refreshes: 0 });
      expect(flow.outcome).toBe('acted');
    });

    it('installs with the brew it found, waits for git-spice to answer, then goes on to the next offer', async () => {
      // arrange: installed by 6 s; the init offer after it is closed
      const probe = scripted([GS_MISSING, GS_MISSING, GS_MISSING, NOT_INITIALIZED]);
      const h = harness({ answers: ['Install with Homebrew', undefined], machine: { brewPath: '/opt/homebrew/bin/brew', brewGitSpice: null } });

      // act
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(6_000);

      // assert
      expect(h.host.terminals.sent[0].text).toBe('cd /w/repo && /opt/homebrew/bin/brew install git-spice');
      expect(h.host.asked.map((asked) => asked.message)).toStrictEqual([
        "git-spice was not found in VS Code's PATH (tried git-spice, gs). Install it with Homebrew — or, if it is already installed, set prCascade.gsPath to its full path.",
        'git-spice installed.',
        'git-spice is not initialised in repo. Initialise it with trunk main and remote origin?',
      ]);
      expect(flow.outcome).toBe('not-ready');
    });

    it('opens the install page when there is no Homebrew, and waits the same way — with no terminal to close', async () => {
      // arrange: installed by 3 s; the login offer after it is closed
      const probe = scripted([GS_MISSING, GS_MISSING, NOT_LOGGED_IN]);
      const h = harness({ answers: ['Open install docs', undefined] });

      // act
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(0);
      const listening = h.host.terminals.listenerCount;
      await vi.advanceTimersByTimeAsync(3_000);

      // assert
      expect(h.host.opened).toStrictEqual([INSTALL_DOCS_URL]);
      expect(h.host.terminals.created).toStrictEqual([]);
      expect(listening).toBe(0);
      expect(h.refreshes).toBe(1);
      expect(flow.outcome).toBe('not-ready');
    });

    it('allows ten passes — room for the longest real chain (install, upgrade, initialise, URLs, log in, ready) with some to spare', () => {
      expect(MAX_STEPS).toBe(10);
    });

    it('lets a six-pass chain reach the action', async () => {
      // arrange: five fixes, each passing (each pass asks at its offer and again at its click), then ready
      const probe = scripted([E70, E70, E70, E70, E70, E70, E70, E70, E70, E70, READY]);
      const h = harness({ answers: ['Set GitHub URLs', 'Set GitHub URLs', 'Set GitHub URLs', 'Set GitHub URLs', 'Set GitHub URLs'] });
      const actions: Ready[] = [];

      // act
      const outcome = await h.flows.ensureReady(requestFor(probe, actions));

      // assert
      expect(outcome).toBe('acted');
      expect(actions).toStrictEqual([READY]);
    });

    it('stops at once when the user turns down opening the page — VS Code asks first for a site it does not trust', async () => {
      // arrange
      const h = harness({ answers: ['Open install docs'] });
      h.host.openExternal = (url) => {
        h.host.opened.push(url);
        return Promise.resolve(false);
      };

      // act: no time passes
      const outcome = await h.flows.ensureReady(requestFor(scripted([GS_MISSING]), []));

      // assert: no 5-minute wait for an install that was never started, and nothing held
      expect(outcome).toBe('gave-up');
      expect(h.flows.inFlight).toStrictEqual([]);
      expect(h.logs).toStrictEqual(['/w/repo: the install page was not opened']);
    });

    it('opens the page again for a second click while it waits — there is no terminal to bring forward', async () => {
      // arrange
      const probe = scripted([GS_MISSING]);
      const h = harness({ answers: ['Open install docs', 'Open install docs'] });
      watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(0);

      // act
      const second = await h.flows.ensureReady(requestFor(probe, []));

      // assert
      expect(second).toBe('in-flight');
      expect(h.host.opened).toStrictEqual([INSTALL_DOCS_URL, INSTALL_DOCS_URL]);
    });

    // see primer §12 (a template string as a test's name)
    it(`stops after ${MAX_STEPS} passes that never settle, with a log line — a guard against a loop, not a limit a real chain meets`, async () => {
      // arrange: the E70 fix is clicked and runs every time, and the probe never changes its answer
      const probe = scripted([E70]);
      const clicks: string[] = [];
      // see primer §29 (a counted for loop)
      for (let pass = 0; pass < MAX_STEPS; pass += 1) {
        clicks.push('Set GitHub URLs');
      }
      const h = harness({ answers: clicks });
      const git = gitFor();

      // act
      const outcome = await h.flows.ensureReady(requestFor(probe, [], ROOT, git));

      // assert
      expect(outcome).toBe('gave-up');
      expect(git.calls.length).toBe(2 * MAX_STEPS);
      expect(h.refreshes).toBe(MAX_STEPS);
      expect(h.logs).toStrictEqual([`/w/repo: readiness did not settle after ${MAX_STEPS} passes`]);
    });
  });

  describe('what the offer is told', () => {
    it('names the configured remote in the init offer', async () => {
      // arrange
      const h = harness({ answers: [undefined] });

      // act
      await h.flows.ensureReady({ ...requestFor(scripted([NOT_INITIALIZED]), []), remote: 'upstream' });

      // assert
      expect(h.host.asked[0].message).toBe('git-spice is not initialised in repo. Initialise it with trunk main and remote upstream?');
    });

    it('points at prCascade.gsPath when it is set', async () => {
      // arrange
      const h = harness();

      // act
      const flow = watch(h.flows.ensureReady({ ...requestFor(scripted([GS_MISSING]), []), gsPathSetting: '/x/gs' }));
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(flow.outcome).toBe('not-ready');
      expect(h.host.asked[0].message).toBe('prCascade.gsPath is /x/gs, which did not answer as git-spice. Point it at git-spice, or clear it to try git-spice and gs.');
    });

    it("names Homebrew's git-spice when it is there and VS Code did not find it", async () => {
      // arrange
      const h = harness({ machine: { brewPath: '/opt/homebrew/bin/brew', brewGitSpice: '/opt/homebrew/bin/git-spice' } });

      // act
      watch(h.flows.ensureReady(requestFor(scripted([GS_MISSING]), [])));
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(h.host.asked[0].message).toBe(
        'git-spice is installed at /opt/homebrew/bin/git-spice, but VS Code did not find it (tried git-spice, gs). Set prCascade.gsPath to /opt/homebrew/bin/git-spice.',
      );
    });

    it('reads the machine again for every question — Homebrew installed in between is seen', async () => {
      // arrange: no Homebrew for the first question
      const h = harness({ answers: [undefined, undefined] });
      await h.flows.ensureReady(requestFor(scripted([GS_MISSING]), []));

      // act
      h.host.machineFacts = { brewPath: '/opt/homebrew/bin/brew', brewGitSpice: null };
      await h.flows.ensureReady(requestFor(scripted([GS_MISSING]), []));

      // assert
      expect(h.host.asked.map((asked) => asked.buttons)).toStrictEqual([['Open install docs'], ['Install with Homebrew']]);
    });
  });

  describe('failures and the window closing', () => {
    // see primer §60 (`Promise.reject`) and §20 (`.rejects.toThrow`)
    it('rejects with the probe\'s own error, holding nothing — git could not run (E17)', async () => {
      // arrange
      const h = harness();
      const request: ReadyRequest = { ...requestFor(scripted([READY]), []), probe: () => Promise.reject(new Error('git: ENOENT')) };

      // act and assert
      await expect(h.flows.ensureReady(request)).rejects.toThrow('git: ENOENT');
      expect(h.flows.inFlight).toStrictEqual([]);
    });

    it('rejects when a probe during the wait fails, letting go of the terminal\'s close listener and the flight', async () => {
      // arrange
      let probes = 0;
      const probe = async (): Promise<Readiness> => {
        probes += 1;
        if (probes <= 2) {
          return NOT_LOGGED_IN;
        }
        throw new Error('git: ENOENT');
      };
      const h = harness({ answers: ['Log in', 'Log in'] });
      const flow = h.flows.ensureReady({ ...requestFor(scripted([READY]), []), probe });
      const rejected = expect(flow).rejects.toThrow('git: ENOENT');

      // act
      await vi.advanceTimersByTimeAsync(3_000);
      await rejected;

      // assert
      expect(h.flows.inFlight).toStrictEqual([]);
      expect(h.host.terminals.listenerCount).toBe(0);

      // and the terminal it gave up on is not typed into again — it may still be in the prompt
      const again = watch(h.flows.ensureReady(requestFor(scripted([NOT_LOGGED_IN]), [])));
      await vi.advanceTimersByTimeAsync(0);
      expect(h.host.terminals.created.length).toBe(2);
      h.host.terminals.close(h.host.terminals.created[1]);
      await vi.advanceTimersByTimeAsync(0);
      expect(again.outcome).toBe('gave-up');
    });

    it('stops at once when the window closes during a wait — no last look, no log, no refresh, no notification', async () => {
      // arrange
      const probe = scripted([NOT_LOGGED_IN, NOT_LOGGED_IN, READY]);
      const h = harness({ answers: ['Log in'] });
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(0);

      // act
      h.flows.dispose();
      await vi.advanceTimersByTimeAsync(10_000);

      // assert
      expect(flow.outcome).toBe('gave-up');
      expect(probe.probes).toBe(2);
      expect(h.logs).toStrictEqual([]);
      expect(h.refreshes).toBe(0);
      expect(h.host.asked).toStrictEqual([LOGIN_OFFER]);
      expect(h.host.terminals.listenerCount).toBe(0);
    });

    it('asks nothing once disposed', async () => {
      // arrange
      const probe = scripted([READY]);
      const h = harness();
      h.flows.dispose();

      // act
      const outcome = await h.flows.ensureReady(requestFor(probe, []));

      // assert
      expect(outcome).toBe('gave-up');
      expect(probe.probes).toBe(0);
    });

    it('reads its host and its poll at every use, so ones swapped in after a first use are the ones used (the test hook, plan §13.4)', async () => {
      // arrange: a first question answered through the first host
      const first = fakeReadinessHost({ answers: [undefined] });
      const second = fakeReadinessHost({ answers: ['Log in'] });
      const deps = { host: first, poll: DEFAULT_POLL };
      const flows = new ReadinessFlows(
        deps,
        () => undefined,
        () => undefined,
      );
      await flows.ensureReady(requestFor(scripted([NOT_LOGGED_IN]), []));

      // act: both swapped, then a second question — waited for every 10 ms for 20 ms
      deps.host = second;
      deps.poll = { intervalMs: 10, timeoutMs: 20 };
      const probe = scripted([NOT_LOGGED_IN]);
      const flow = watch(flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(20);

      // assert
      expect(first.asked).toStrictEqual([LOGIN_OFFER]);
      expect(second.asked).toStrictEqual([LOGIN_OFFER]);
      expect(flow.outcome).toBe('gave-up');
      expect(probe.probes).toBe(4);
    });

    it('stops when the window closes during the first probe — the action does not run', async () => {
      // arrange
      const probe = held<Readiness>();
      const h = harness();
      const actions: Ready[] = [];
      const flow = watch(h.flows.ensureReady({ ...requestFor(scripted([READY]), actions), probe: () => probe.promise }));

      // act
      h.flows.dispose();
      probe.release(READY);
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(flow.outcome).toBe('gave-up');
      expect(actions).toStrictEqual([]);
    });

    it('runs nothing for a click that comes after the window started closing', async () => {
      // arrange: the offer is open when the window closes
      const click = held<string | undefined>();
      const probe = scripted([NOT_LOGGED_IN]);
      const h = harness({ answers: [click.promise] });
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(0);

      // act
      h.flows.dispose();
      click.release('Log in');
      await vi.advanceTimersByTimeAsync(0);

      // assert: not even the look again
      expect(flow.outcome).toBe('gave-up');
      expect(probe.probes).toBe(1);
      expect(h.host.terminals.created).toStrictEqual([]);
    });

    it('runs nothing when the window closes during the look again at the click', async () => {
      // arrange: the second probe — the one after the click — is held
      let probes = 0;
      const second = held<Readiness>();
      const probe = (): Promise<Readiness> => {
        probes += 1;
        return probes === 1 ? Promise.resolve(NOT_LOGGED_IN) : second.promise;
      };
      const h = harness({ answers: ['Log in'] });
      const flow = watch(h.flows.ensureReady({ ...requestFor(scripted([READY]), []), probe }));
      await vi.advanceTimersByTimeAsync(0);

      // act
      h.flows.dispose();
      second.release(NOT_LOGGED_IN);
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(flow.outcome).toBe('gave-up');
      expect(h.host.terminals.created).toStrictEqual([]);
    });

    it('starts no wait when the window closes while the page is being opened', async () => {
      // arrange: opening the page is held
      const opening = held<boolean>();
      const probe = scripted([GS_MISSING]);
      const h = harness({ answers: ['Open install docs'] });
      h.host.openExternal = () => opening.promise;
      const flow = watch(h.flows.ensureReady(requestFor(probe, [])));
      await vi.advanceTimersByTimeAsync(0);

      // act
      h.flows.dispose();
      opening.release(true);
      await vi.advanceTimersByTimeAsync(30_000);

      // assert: nothing asked after the close
      expect(flow.outcome).toBe('gave-up');
      expect(probe.probes).toBe(2);
      expect(h.flows.inFlight).toStrictEqual([]);
    });

    it('neither refreshes nor says done when the window closes while a git-config fix runs', async () => {
      // arrange
      const config = held<string>();
      const h = harness({ answers: ['Set GitHub URLs'] });
      const flow = watch(h.flows.ensureReady(requestFor(scripted([E70, E70, READY]), [], ROOT, heldConfig(config))));
      await vi.advanceTimersByTimeAsync(0);

      // act
      h.flows.dispose();
      config.release('');
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(flow.outcome).toBe('gave-up');
      expect(h.refreshes).toBe(0);
      expect(h.host.asked.length).toBe(1);
    });

    it('writes no log line when the window closes during the last look', async () => {
      // arrange: the terminal is closed; the last look is held
      let probes = 0;
      const last = held<Readiness>();
      const probe = (): Promise<Readiness> => {
        probes += 1;
        return probes <= 2 ? Promise.resolve(NOT_LOGGED_IN) : last.promise;
      };
      const h = harness({ answers: ['Log in'] });
      const flow = watch(h.flows.ensureReady({ ...requestFor(scripted([READY]), []), probe }));
      await vi.advanceTimersByTimeAsync(0);
      h.host.terminals.close(h.host.terminals.created[0]);
      await vi.advanceTimersByTimeAsync(0);

      // act
      h.flows.dispose();
      last.release(NOT_LOGGED_IN);
      await vi.advanceTimersByTimeAsync(0);

      // assert
      expect(flow.outcome).toBe('gave-up');
      expect(h.logs).toStrictEqual([]);
    });

    it('rejects, holding nothing, when the browser cannot be opened', async () => {
      // arrange
      const h = harness({ answers: ['Open install docs'] });
      h.host.openExternal = () => Promise.reject(new Error('no browser'));

      // act and assert
      await expect(h.flows.ensureReady(requestFor(scripted([GS_MISSING]), []))).rejects.toThrow('no browser');
      expect(h.flows.inFlight).toStrictEqual([]);
    });
  });
});

describe('chooseRepository', () => {
  it('says there is no repository, and returns nothing, for an empty workspace', async () => {
    // arrange: the notification never settles in the fake — waiting for it would hang
    const host = fakeReadinessHost();
    let root: string | undefined | 'pending' = 'pending';

    // act
    void chooseRepository([], host).then((chosen) => {
      root = chosen;
    });
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(root).toBeUndefined();
    expect(host.asked).toStrictEqual([{ severity: 'information', message: 'No git repository in this workspace.', buttons: [] }]);
  });

  it('takes the only repository without asking', async () => {
    // arrange
    const host = fakeReadinessHost();

    // act
    const root = await chooseRepository(['/w/a'], host);

    // assert
    expect(root).toBe('/w/a');
    expect(host.picked).toStrictEqual([]);
  });

  it('asks which one, by folder name and in the view\'s order, when there are several', async () => {
    // arrange
    const host = fakeReadinessHost({ picks: ['b'] });

    // act
    const root = await chooseRepository(['/w/a', '/w/b'], host);

    // assert
    expect(root).toBe('/w/b');
    expect(host.picked).toStrictEqual([{ labels: ['a', 'b'], placeHolder: 'Set up git-spice for which repository?' }]);
  });

  it('lists full paths when two folder names are the same', async () => {
    // arrange
    const host = fakeReadinessHost({ picks: ['/y/repo'] });

    // act
    const root = await chooseRepository(['/x/repo', '/y/repo'], host);

    // assert
    expect(root).toBe('/y/repo');
    expect(host.picked[0].labels).toStrictEqual(['/x/repo', '/y/repo']);
  });

  it('returns nothing when the pick is escaped', async () => {
    // arrange
    const host = fakeReadinessHost({ picks: [undefined] });

    // act and assert
    expect(await chooseRepository(['/w/a', '/w/b'], host)).toBeUndefined();
  });
});

describe('machineFacts', () => {
  // see primer §21 (Set)
  it('finds brew in the first of its usual places that exists, and the git-spice Homebrew linked beside it', () => {
    // arrange: an Intel Mac — no /opt/homebrew
    const present = new Set(['/usr/local/bin/brew', '/usr/local/bin/git-spice']);

    // act
    const facts = machineFacts((file) => present.has(file));

    // assert
    expect(facts).toStrictEqual({ brewPath: '/usr/local/bin/brew', brewGitSpice: '/usr/local/bin/git-spice' });
  });

  it("prefers Apple silicon's brew when an Intel one is left behind too, as on a migrated Mac", () => {
    // arrange
    const present = new Set(['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);

    // act
    const facts = machineFacts((file) => present.has(file));

    // assert
    expect(facts.brewPath).toBe('/opt/homebrew/bin/brew');
  });

  it('reports brew without git-spice when Homebrew has none', () => {
    expect(machineFacts((file) => file === '/opt/homebrew/bin/brew')).toStrictEqual({ brewPath: '/opt/homebrew/bin/brew', brewGitSpice: null });
  });

  it('reports neither when there is no Homebrew — and does not look for git-spice beside nothing', () => {
    // arrange
    const asked: string[] = [];

    // act
    const facts = machineFacts((file) => {
      asked.push(file);
      return false;
    });

    // assert
    expect(facts).toStrictEqual({ brewPath: null, brewGitSpice: null });
    expect(asked).toStrictEqual([...BREW_PATHS]);
  });

  it('looks in Apple silicon\'s, Intel\'s and Linux\'s places, in that order', () => {
    expect(BREW_PATHS).toStrictEqual(['/opt/homebrew/bin/brew', '/usr/local/bin/brew', '/home/linuxbrew/.linuxbrew/bin/brew']);
  });
});
