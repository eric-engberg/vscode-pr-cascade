/**
 * test/helpers/fakeReadinessHost.ts — stand-ins for the two things the git-spice setup flow
 * asks of VS Code (src/vscode/login.ts): its terminals, and its notifications, quick pick and
 * browser. Each records what it was asked, and answers from a script, so a test can say "the user
 * clicks Log in" and then check exactly which line was typed into which terminal.
 *
 * Layer: test helper (plan §9.1 layers 1 and 3). No Vitest or Mocha import and only `import type`
 * from `vscode`, so both runners can compile it — as test/helpers/fakeCommand.ts. Depends on:
 * src/vscode/terminal.ts and src/vscode/login.ts (types). Depended on by:
 * test/unit/terminal.test.ts, test/unit/login.test.ts, test/ext/login.test.ts. Plan: §9.4
 * `ext/login`, §13.4 (the fake terminal injection), §13.2 D58.
 */

// see primer §1 (import / export) and §9 (`import type`)
import type { Disposable, Event } from 'vscode';
import type { MachineFacts, ReadinessHost } from '../../src/vscode/login';
import type { TerminalHost, TerminalLike } from '../../src/vscode/terminal';

/** One `sendText`: which terminal (its name and directory), the text, and whether Enter was pressed. */
// see primer §9 (interface) and §14 (readonly)
export interface SentLine {
  readonly name: string;
  readonly cwd: string;
  readonly text: string;
  readonly execute: boolean | undefined;
}

/** A terminal that remembers what it was told. `exitStatus` becomes `{}` when the host closes it — the shell has exited. */
// see primer §13 (class: `implements`) and §47 (parameter properties)
export class FakeTerminal implements TerminalLike {
  readonly creationOptions: { readonly name: string; readonly cwd: string };
  /** Every line sent to this terminal, oldest first. */
  readonly sent: SentLine[] = [];
  /** The argument of every `show()` call — `undefined` when the terminal was told to take the focus. */
  readonly showCalls: (boolean | undefined)[] = [];
  // see primer §51 (`object`: any object at all)
  exitStatus: object | undefined = undefined;

  constructor(
    readonly name: string,
    cwd: string,
    /** Told about every line, so the host keeps one list across its terminals. */
    private readonly onSend: (line: SentLine) => void,
  ) {
    this.creationOptions = { name, cwd };
  }

  sendText(text: string, shouldExecute?: boolean): void {
    const line: SentLine = { name: this.name, cwd: this.creationOptions.cwd, text, execute: shouldExecute };
    this.sent.push(line);
    this.onSend(line);
  }

  show(preserveFocus?: boolean): void {
    this.showCalls.push(preserveFocus);
  }

  /** How many times `show()` was called. */
  get shows(): number {
    return this.showCalls.length;
  }
}

/**
 * The TerminalHost stand-in. `close(terminal)` is the user closing a terminal: its exit status is
 * set and every close listener is told. Subscriptions return a Disposable that really removes the
 * listener, and `listenerCount` says how many are live — what the tests read to see that each wait
 * let go of its listener. `nextSent()` hands out the sent lines one at a time, in order, waiting for
 * the next one when all have been handed out — what the extension-host test awaits before it
 * changes the fake git-spice's answer.
 */
// see primer §21 (Set), §33 (function types) and §61 (a getter)
export class FakeTerminalHost implements TerminalHost {
  /** Every terminal made, oldest first. */
  readonly created: FakeTerminal[] = [];
  /** Every line sent, to any terminal, oldest first. */
  readonly sent: SentLine[] = [];
  /** Terminals that were open before — made by the user or another extension, not by `create`. */
  private readonly existing: TerminalLike[] = [];
  private readonly listeners = new Set<(terminal: TerminalLike) => void>();
  /** The `nextSent` call waiting for a line, if any — one at a time. */
  private waiting: ((line: SentLine) => void) | undefined = undefined;
  private handedOut = 0;

  // see primer §16 (arrays: spread — the two lists as one)
  terminals(): readonly TerminalLike[] {
    return [...this.existing, ...this.created];
  }

  /** Adds a terminal that was there before the flow, such as one the user opened. */
  addExisting(terminal: TerminalLike): void {
    this.existing.push(terminal);
  }

  create(options: { readonly name: string; readonly cwd: string }): FakeTerminal {
    const terminal = new FakeTerminal(options.name, options.cwd, (line) => this.record(line));
    this.created.push(terminal);
    return terminal;
  }

  /**
   * The close event, written by hand: a function that takes a listener and returns how to remove
   * it (primer §32). A field holding an arrow function, so `this` inside it is this host (primer §5).
   */
  readonly onDidClose: Event<TerminalLike> = (listener): Disposable => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  /** How many close listeners are subscribed right now. */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** `show()` calls across every terminal made. */
  get shows(): number {
    let total = 0;
    for (const terminal of this.created) {
      total += terminal.shows;
    }
    return total;
  }

  /** The user closes `terminal`: its shell has exited, and every close listener hears of it. */
  // see primer §16 (arrays: spread — a copy, since a listener may unsubscribe while being told)
  close(terminal: FakeTerminal): void {
    terminal.exitStatus = {};
    for (const listener of [...this.listeners]) {
      listener(terminal);
    }
  }

  /**
   * The next sent line not yet handed out — at once when there is one, else when it is sent.
   * Rejects after `deadlineMs`, naming what it waited for, so a test that expected a line and got
   * none fails with its cause (test/ext/statusbar.test.ts's `nextEvent` shape).
   */
  // see primer §15 (new Promise), §58 (setTimeout with a deadline), §27 (`5_000`), §13 (a default
  // parameter) and §60 (`Promise.resolve`: an answer that is already there)
  nextSent(deadlineMs = 5_000): Promise<SentLine> {
    if (this.handedOut < this.sent.length) {
      const line = this.sent[this.handedOut];
      this.handedOut += 1;
      return Promise.resolve(line);
    }
    if (this.waiting !== undefined) {
      return Promise.reject(new Error('nextSent: already waiting for a line'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = undefined;
        reject(new Error(`no line was sent to a terminal within ${deadlineMs} ms`));
      }, deadlineMs);
      this.waiting = (line: SentLine): void => {
        clearTimeout(timer);
        resolve(line);
      };
    });
  }

  private record(line: SentLine): void {
    this.sent.push(line);
    const waiter = this.waiting;
    if (waiter !== undefined) {
      this.waiting = undefined;
      this.handedOut += 1;
      waiter(line);
    }
  }
}

/** One notification shown: its colour, its sentence and its buttons. */
export interface Asked {
  readonly severity: 'warning' | 'information';
  readonly message: string;
  readonly buttons: readonly string[];
}

/** A ReadinessHost that records everything, with its terminals and machine facts in reach of the test. */
// see primer §9 (an interface that extends another)
export interface FakeReadinessHost extends ReadinessHost {
  readonly asked: Asked[];
  readonly picked: { readonly labels: readonly string[]; readonly placeHolder: string }[];
  readonly opened: string[];
  readonly terminals: FakeTerminalHost;
  /** What `machine()` answers — a test may change it while a wait is running. */
  machineFacts: MachineFacts;
}

/** What the user will do, in order. */
export interface FakeHostScript {
  /**
   * The answers to notifications that have buttons, in order: a label is a click, `undefined` the
   * notification closed. A Thenable is handed back as it is, so a test can hold a notification
   * open and answer it later. A notification with buttons and no answer left throws, as
   * FakeCommandRunner does for a command nobody canned.
   */
  readonly answers?: readonly (string | undefined | Thenable<string | undefined>)[];
  /** The answers to quick picks, in order: a label, or `undefined` for Escape. */
  readonly picks?: readonly (string | undefined)[];
  /** `machine()`'s first answer. Default: no Homebrew. */
  readonly machine?: MachineFacts;
}

/**
 * The host the flow gets in a test. A notification with no buttons returns a Promise that never
 * settles — like a real one nobody closes — so a flow that wrongly awaited one would hang its test.
 */
// see primer §15 (new Promise), §30 (`??`), §38 (`shift`), §60 (`Thenable`, and `Promise.resolve` of
// one — handed back as it is) and §16 (spread: copies of the scripts)
export function fakeReadinessHost(script: FakeHostScript = {}): FakeReadinessHost {
  const answers = [...(script.answers ?? [])];
  const picks = [...(script.picks ?? [])];
  const host: FakeReadinessHost = {
    asked: [],
    picked: [],
    opened: [],
    terminals: new FakeTerminalHost(),
    machineFacts: script.machine ?? { brewPath: null, brewGitSpice: null },
    prompt(severity, message, buttons) {
      host.asked.push({ severity, message, buttons: [...buttons] });
      if (buttons.length === 0) {
        return new Promise<string | undefined>(() => undefined);
      }
      if (answers.length === 0) {
        throw new Error(`fakeReadinessHost: no answer left for the notification "${message}"`);
      }
      return Promise.resolve(answers.shift());
    },
    pick(labels, placeHolder) {
      host.picked.push({ labels: [...labels], placeHolder });
      return Promise.resolve(picks.shift());
    },
    openExternal(url) {
      host.opened.push(url);
      return Promise.resolve(true);
    },
    machine() {
      return host.machineFacts;
    },
  };
  return host;
}
