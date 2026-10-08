/**
 * vscode/login.ts — the git-spice setup flow (plan §4.2: "prompt → terminal → poll → re-run
 * action"; §7.5's login flow, applied to every §7.13.1 offer). `ReadinessFlows.ensureReady`
 * probes; for a failing member it shows that member's offer (core/readinessFix.ts); on the click
 * it runs the fix — a line in the repository's terminal, `git config` lines, or a web page —
 * waits until the step passed (core/poll.ts, asking the probe again every 3 s for up to 5 min),
 * refreshes the view (E83), says so, and goes round again; once the probe says ready, it runs the
 * action it was given. The by-hand "Set Up git-spice" command (src/extension.ts) is its first
 * caller; items 20–21 will gate their actions on it.
 *
 * One fix runs at a time per repository: a click while one runs brings that fix's terminal
 * forward instead (§7.5 step 4). Nothing is held while a notification is open — only the click
 * claims the repository — so a notification left unanswered in the notification centre blocks
 * nothing later; and because one may be answered long after it was shown, the flow looks again
 * at the click before it runs anything. Per repository rather than §7.5's per host: a repository is what owns a terminal
 * and a directory, and a login done in one repository's terminal is seen by every other on the
 * host anyway (one keychain).
 *
 * Layer: vscode adapter (plan §4.1). Imports only *types* from `vscode`: everything it asks of VS
 * Code — notifications, the quick pick, the browser, terminals, the disk — comes through one
 * `ReadinessHost`, which src/extension.ts builds and a test replaces (plan §13.4), so Vitest
 * loads this file with no VS Code and fake timers (test/unit/login.test.ts). Depends on: the
 * `vscode` module (types), core/backend.ts, core/model.ts (`GitRunner`), core/poll.ts,
 * core/readinessFix.ts, vscode/terminal.ts, Node's `node:path`. Depended on by: src/extension.ts,
 * test/helpers/fakeReadinessHost.ts (types), test/unit/login.test.ts, test/ext/login.test.ts.
 * Plan: §4.2, §7.5 steps 1–4, §7.6, §7.13.1, §8 E55/E59/E62/E67/E70/E83, §9.4 `ext/login`, §10.1
 * item 19b, §13.2 D58, §13.4 (test-only hooks).
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as path from 'node:path';
import type { Disposable } from 'vscode';
import type { NotReady, Readiness, Ready } from '../core/backend';
import type { GitRunner } from '../core/model';
import { waitUntil } from '../core/poll';
import type { PollTiming } from '../core/poll';
import { offerFor, trunkBranchFor } from '../core/readinessFix';
import type { Fix, OfferFacts, TrunkBranch } from '../core/readinessFix';
import { runInTerminal, terminalName } from './terminal';
import type { TerminalHost, TerminalLike } from './terminal';

/** Where Homebrew puts `brew`: Apple silicon Macs, Intel Macs (plan §13.1), Linux. */
// see primer §4 (const) and §14 (readonly arrays)
export const BREW_PATHS: readonly string[] = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew', '/home/linuxbrew/.linuxbrew/bin/brew'];

/** What the install offers need to know about the machine (core/readinessFix.ts, `OfferFacts`). */
// see primer §9 (interface)
export interface MachineFacts {
  readonly brewPath: string | null;
  readonly brewGitSpice: string | null;
}

/**
 * Where Homebrew is, and whether it has git-spice: the first of BREW_PATHS that exists, and the
 * `git-spice` beside it — where Homebrew links the one it installed. `exists` is handed in
 * (`fs.existsSync` in src/extension.ts) so a test can say what is on the disk.
 */
// see primer §25 (arrays: `find`), §33 (a function as a parameter), §28 (`path.dirname`, `path.join`),
// §30 (`??`) and §48 (the conditional expression)
export function machineFacts(exists: (file: string) => boolean): MachineFacts {
  const brewPath = BREW_PATHS.find(exists) ?? null;
  if (brewPath === null) {
    return { brewPath: null, brewGitSpice: null };
  }
  const beside = path.join(path.dirname(brewPath), 'git-spice');
  return { brewPath, brewGitSpice: exists(beside) ? beside : null };
}

/** Everything the flow asks of VS Code, as one object: the real one in src/extension.ts, a test's from test/helpers/fakeReadinessHost.ts. */
// see primer §73 (asking the user) and §72 (terminals)
export interface ReadinessHost {
  /** A notification — `showWarningMessage` or `showInformationMessage` with `buttons` — resolving to the label clicked, or `undefined` when it is closed. Awaited only when there are buttons. (`Thenable`: VS Code's promise-like type, primer §60.) */
  prompt(severity: 'warning' | 'information', message: string, buttons: readonly string[]): Thenable<string | undefined>;
  /** `showQuickPick` over `labels`: the one picked, or `undefined` for Escape. */
  pick(labels: readonly string[], placeHolder: string): Thenable<string | undefined>;
  /** `env.openExternal`: the page in the user's browser — `false` when it was not opened (VS Code asks first for a site it does not trust, and the user may say no). */
  openExternal(url: string): Thenable<boolean>;
  /** The terminals (vscode/terminal.ts). */
  readonly terminals: TerminalHost;
  /** Where Homebrew is, read from disk each time — `brew install` changes the answer. */
  machine(): MachineFacts;
}

/** What a test swaps (plan §13.4): read at every use, never kept, so a swap after `activate()` takes effect. */
export interface FlowDeps {
  host: ReadinessHost;
  poll: PollTiming;
}

/** One question for the flow, with everything its fixes need. */
// see primer §33 (function types) and §14 (readonly)
export interface ReadyRequest {
  /** The repository root. */
  readonly root: string;
  /** `prCascade.remote` as read — the probe's remote, and `gs repo init`'s. */
  readonly remote: string;
  /** `RepoState.trunk`: the ref the stack is measured against, or `null` (E4). */
  readonly trunk: string | null;
  /** `prCascade.gsPath` as read. */
  readonly gsPathSetting: string;
  /** The readiness probe for this repository (src/extension.ts, `probeFor`): asked for the offer, during each wait, and after each fix. */
  readonly probe: () => Promise<Readiness>;
  /** git in this repository: the trunk question before an init offer, and the `git config` fixes. */
  readonly git: GitRunner;
  /** Run once ready (E55: "the action re-runs after"). */
  readonly action: (ready: Ready) => Promise<void>;
}

/**
 * How one `ensureReady` ended: `acted` — ready, and the action ran; `not-ready` — an offer was
 * shown and closed, or had no button; `gave-up` — a wait timed out or its terminal was closed with
 * nothing changed, a page the user would not let VS Code open, MAX_STEPS passes went by, or the
 * window is closing; `in-flight` — another fix for this repository was running, so its terminal
 * was brought forward (or its page opened again — and nothing at all is shown when that fix is
 * only `git config` lines, or the look again at its click, both over in a moment) and this action
 * did not run. Items 20–21 can say which.
 */
// see primer §10 (union types: exact strings as members)
export type ReadyOutcome = 'acted' | 'not-ready' | 'gave-up' | 'in-flight';

/**
 * Passes per question before the flow gives up — a guard against a loop, not a limit a real
 * chain meets: the longest is install, upgrade, initialise, set the forge's URLs, log in, and the
 * pass that finds ready.
 */
export const MAX_STEPS = 10;

/** A fix running for one repository: its terminal or its page (once there is one) and the controller of its wait. */
interface Flight {
  terminal: TerminalLike | undefined;
  url: string | undefined;
  wait: AbortController | undefined;
}

/** How a fix ended: the step passed; it did not (timed out, closed, refused); or the step had already changed when the user clicked. */
type FixResult = 'passed' | 'failed' | 'changed';

/**
 * How far through the probe's steps an answer is (plan §7.13.1's order, `ready` last). A wait has
 * passed when the probe gets *further* than the member it was waiting on — not merely somewhere
 * else: a git-spice that times out during a login wait answers `gs-missing`, and that is no login.
 * The forge step's four members share one number; only E70 among them has a fix, and that fix
 * does not wait.
 */
// see primer §59 (narrowing on `kind`)
function progressOf(answer: Readiness): number {
  if (answer.kind === 'gs-missing') {
    return 0;
  }
  if (answer.kind === 'gs-too-old') {
    return 1;
  }
  if (answer.kind === 'not-initialized') {
    return 2;
  }
  if (answer.kind === 'not-logged-in') {
    return 4;
  }
  if (answer.kind === 'gh-missing') {
    return 5;
  }
  if (answer.kind === 'ready') {
    return 6;
  }
  // no-remote, remote-unparseable, forge-unrecognized, forge-unsupported: the forge step
  return 3;
}

/**
 * The flows of one window (src/extension.ts makes one, on `context.subscriptions`). Holds which
 * repositories have a fix running, and whether the window is closing.
 */
// see primer §13 (class: `implements`, `private`), §47 (parameter properties) and §19 (Map)
export class ReadinessFlows implements Disposable {
  /** The fix running per repository root: set at the click, deleted when the fix is done or failed. */
  private readonly flights = new Map<string, Flight>();
  /** Set by `dispose`: after it nothing is probed, logged, refreshed or shown. */
  private disposed = false;
  /**
   * Terminals whose last command the flow gave up waiting on: they may still be sitting in that
   * command's prompt, so the next fix gets a new terminal rather than typing into the old one.
   */
  private readonly abandoned = new Set<TerminalLike>();

  constructor(
    /** Read at every use — the test hook swaps its fields (plan §13.4). */
    private readonly deps: FlowDeps,
    /** The view's refresh: after a fix of ours, the Git extension may not have noticed (E83). */
    private readonly refresh: () => void,
    /** A line in the Output channel. */
    private readonly log: (line: string) => void,
  ) {}

  /** The roots with a fix running — what the tests read. */
  // see primer §61 (a getter), §16 (spread: a Map's keys into an array) and §19 (`keys()`)
  get inFlight(): readonly string[] {
    return [...this.flights.keys()];
  }

  /**
   * Probe, offer, fix, wait, refresh, again — until the probe says ready (then the action runs),
   * an offer is closed or has no button, a wait ends with nothing changed, the window closes, or
   * MAX_STEPS passes went by. After a click it looks once more before running the fix
   * (`fixIfStillNeeded`), and when the step was done meanwhile it starts the pass again. Rejects
   * when a probe, a `git config` or opening the browser rejects (git could not run, E17), and then
   * holds nothing. The
   * action runs outside any flight: it is not a fix, and a slow push must not block a second
   * repository's login.
   */
  // see primer §6 (async / await), §29 (a counted for loop), §22 (`continue`), §59 (narrowing on
  // `kind`), §18 (try / finally) and §12 (template strings)
  async ensureReady(request: ReadyRequest): Promise<ReadyOutcome> {
    for (let pass = 0; pass < MAX_STEPS; pass += 1) {
      if (this.disposed) {
        return 'gave-up';
      }
      const answer = await request.probe();
      if (this.disposed) {
        return 'gave-up';
      }
      if (answer.kind === 'ready') {
        await request.action(answer);
        return 'acted';
      }
      const offer = offerFor(answer, await this.factsFor(request, answer));
      if (offer.fix === null) {
        // Shown and not awaited: the promise settles only when the notification is closed, and
        // nothing here waits for that (the rule of vscode/commands.ts's messages).
        void this.deps.host.prompt(offer.severity, offer.message, []);
        return 'not-ready';
      }
      const chosen = await this.deps.host.prompt(offer.severity, offer.message, [offer.fix.button]);
      if (this.disposed) {
        return 'gave-up';
      }
      if (chosen === undefined) {
        return 'not-ready';
      }
      // The click claims the repository — checked and set with no `await` in between, so two
      // clicks cannot both get past here.
      const running = this.flights.get(request.root);
      if (running !== undefined) {
        this.bringForward(running);
        return 'in-flight';
      }
      const flight: Flight = { terminal: undefined, url: undefined, wait: undefined };
      this.flights.set(request.root, flight);
      // Declared before the `try` so the lines after the `finally` can read it; assigned inside.
      let result: FixResult;
      try {
        result = await this.fixIfStillNeeded(request, answer, offer.fix.action, flight);
      } finally {
        this.flights.delete(request.root);
      }
      if (this.disposed || result === 'failed') {
        return 'gave-up';
      }
      if (result === 'changed') {
        // The step was done some other way while the notification was open: offer afresh.
        continue;
      }
      this.refresh();
      void this.deps.host.prompt('information', offer.fix.done, []);
    }
    this.say(`${request.root}: readiness did not settle after ${MAX_STEPS} passes`);
    return 'gave-up';
  }

  /** Called by VS Code when the window closes (context.subscriptions): every wait stops at once. */
  // see primer §71 (AbortController: `abort`) and §19 (a Map's `values()`, walked with for … of, §22)
  dispose(): void {
    this.disposed = true;
    for (const flight of this.flights.values()) {
      flight.wait?.abort();
    }
  }

  /** A second click while a fix runs: its terminal forward, or its page opened again — there is no terminal to show for a page. */
  // see primer §73 (`openExternal`, not awaited: nothing waits on it here)
  private bringForward(running: Flight): void {
    if (running.terminal !== undefined) {
      running.terminal.show();
    } else if (running.url !== undefined) {
      void this.deps.host.openExternal(running.url);
    }
  }

  /**
   * Looks once more before running the fix: the notification may have sat in the notification
   * centre while the user did the step another way — and running `gs repo init` a second time
   * with another `--trunk` would quietly replace the trunk they chose (git-spice 0.31.2 does not
   * ask). When the probe's answer is still the member offered, runs the fix. Compared by `kind`
   * only: the same step failing with other details (another host, another version) still runs
   * the offer that was clicked.
   */
  private async fixIfStillNeeded(request: ReadyRequest, failing: NotReady, fix: Fix, flight: Flight): Promise<FixResult> {
    const now = await request.probe();
    if (this.disposed) {
      return 'failed';
    }
    if (now.kind !== failing.kind) {
      return 'changed';
    }
    return (await this.runFix(request, failing, fix, flight)) ? 'passed' : 'failed';
  }

  /**
   * Runs one fix. `git config` lines are done when git returns, so the next pass's probe is the
   * check and there is nothing to wait for; a terminal line or a web page needs the user, so the
   * wait decides. A page the user would not let VS Code open ends the fix at once — there is
   * nothing to wait for. True when the step passed.
   */
  // see primer §22 (for ... of)
  private async runFix(request: ReadyRequest, failing: NotReady, fix: Fix, flight: Flight): Promise<boolean> {
    if (fix.kind === 'git-config') {
      for (const entry of fix.entries) {
        await request.git.run(['config', entry.key, entry.value], request.root);
      }
      return true;
    }
    if (fix.kind === 'open-url') {
      flight.url = fix.url;
      const opened = await this.deps.host.openExternal(fix.url);
      if (!opened) {
        this.say(`${request.root}: the install page was not opened`);
        return false;
      }
      return this.waitForStep(request, failing, flight);
    }
    // Forget abandoned terminals the user has since closed, so the set does not grow for the life
    // of the window — deleting from a Set while walking it is allowed.
    // see primer §21 (Set: `delete`) and §22 (for ... of)
    for (const terminal of this.abandoned) {
      if (terminal.exitStatus !== undefined) {
        this.abandoned.delete(terminal);
      }
    }
    // see primer §5 (an arrow function as an argument)
    flight.terminal = runInTerminal(this.deps.host.terminals, terminalName(request.root), request.root, fix.argv, (terminal) => !this.abandoned.has(terminal));
    return this.waitForStep(request, failing, flight);
  }

  /**
   * Asks the probe again every interval until it gets further than the member that was offered
   * (`progressOf`) — the step passed; the next one may well fail, and gets its own offer on the
   * next pass. For an install, the step also passed when Homebrew's `git-spice` appears beside its
   * `brew`, though VS Code's PATH may never find it: the next offer then names its path for
   * `prCascade.gsPath`, rather than the wait running out. The close of the fix's own terminal
   * stops the wait, and then one last look is taken: the user may have finished in the last
   * seconds and closed it. A timeout, or a close with nothing changed, gives up with one line in
   * the log and no notification (§7.5: "silent give-up"); a terminal given up on that way is not
   * used again. The close listener is let go of however the wait ends.
   */
  // see primer §71 (AbortController and its signal), §72 (`onDidCloseTerminal` and its Disposable) and §18 (finally)
  private async waitForStep(request: ReadyRequest, failing: NotReady, flight: Flight): Promise<boolean> {
    if (this.disposed) {
      // The window closed while the fix was starting (the page still opening): `dispose` found no
      // wait to stop, so none may start now.
      return false;
    }
    const controller = new AbortController();
    flight.wait = controller;
    const passed = async (): Promise<boolean> =>
      progressOf(await request.probe()) > progressOf(failing) || (failing.kind === 'gs-missing' && this.deps.host.machine().brewGitSpice !== null);
    const closing =
      flight.terminal === undefined
        ? undefined
        : this.deps.host.terminals.onDidClose((closed) => {
            if (closed === flight.terminal) {
              controller.abort();
            }
          });
    // Whether the step passed, for the `finally`: a wait that ends any other way — timed out, a
    // probe that rejected, the window closing — leaves its terminal possibly mid-prompt.
    let succeeded = false;
    try {
      const outcome = await waitUntil(passed, this.deps.poll, controller.signal);
      if (outcome === 'done') {
        succeeded = true;
        return true;
      }
      if (this.disposed) {
        return false;
      }
      if (outcome === 'aborted' && (await passed())) {
        succeeded = true;
        return true;
      }
      const why = outcome === 'timeout' ? 'timed out' : 'terminal closed';
      this.say(`${request.root}: gave up waiting for ${failing.kind} to be fixed (${why})`);
      return false;
    } finally {
      closing?.dispose();
      // A closed terminal is never reused anyway (its exit status is set), so only a live one is kept.
      if (!succeeded && flight.terminal !== undefined && flight.terminal.exitStatus === undefined) {
        this.abandoned.add(flight.terminal);
      }
    }
  }

  /** What the offer's sentences need beyond the member — the trunk question only for the init offer. */
  private async factsFor(request: ReadyRequest, answer: NotReady): Promise<OfferFacts> {
    const machine = this.deps.host.machine();
    let trunkBranch: TrunkBranch = { kind: 'none' };
    if (answer.kind === 'not-initialized') {
      trunkBranch = await trunkBranchFor(request.git, request.root, request.trunk);
    }
    return {
      root: request.root,
      remote: request.remote,
      trunkBranch,
      gsPathSetting: request.gsPathSetting,
      brewPath: machine.brewPath,
      brewGitSpice: machine.brewGitSpice,
    };
  }

  /** A log line, unless the window is closing — the Output channel may be gone already. */
  private say(line: string): void {
    if (!this.disposed) {
      this.log(line);
    }
  }
}

/**
 * The repository the setup command is for (src/extension.ts): none → a notification and
 * `undefined`; one → it; several → a quick pick of their folder names, in the view's order (plan
 * §6), or of their full paths when two folder names are the same; Escape → `undefined`.
 */
// see primer §21 (Set: counting distinct names), §25 (arrays: `map`, `indexOf`), §16 (spread: a copy) and §49 (`Pick`)
export async function chooseRepository(roots: readonly string[], host: Pick<ReadinessHost, 'prompt' | 'pick'>): Promise<string | undefined> {
  if (roots.length === 0) {
    void host.prompt('information', 'No git repository in this workspace.', []);
    return undefined;
  }
  if (roots.length === 1) {
    return roots[0];
  }
  const names = roots.map((root) => path.basename(root));
  const labels = new Set(names).size === names.length ? names : [...roots];
  const picked = await host.pick(labels, 'Set up git-spice for which repository?');
  if (picked === undefined) {
    return undefined;
  }
  return roots[labels.indexOf(picked)];
}
