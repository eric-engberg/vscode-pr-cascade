/**
 * vscode/terminal.ts — run a command in a named terminal, reusing it while it lives (plan §4.2).
 * The git-spice fixes that need the user — `gs repo init`, `gs auth login`, `brew install` and
 * `brew upgrade` — run in a VS Code terminal the user can see and answer (plan §7.5 step 2): one
 * terminal per repository, named `PR Cascade: <folder>`, started at the repository root, found
 * again for the next step while its shell is still running, and told to `cd` to the root before
 * each command, since the user may have changed directory in it since.
 *
 * Layer: vscode adapter (plan §4.1). Imports only *types* from `vscode`: the three things it
 * needs from VS Code's window — the list of terminals, making one, and the close event — are
 * handed in as one `TerminalHost` (src/extension.ts builds the real one), the way vscode/gitApi.ts
 * takes its `GitExtensionHost`. That is also why Vitest can load this file with no VS Code
 * (test/unit/terminal.test.ts). Depends on: the `vscode` module (types), core/shell.ts, Node's
 * `node:path`. Depended on by: src/vscode/login.ts, src/extension.ts,
 * test/helpers/fakeReadinessHost.ts, test/unit/terminal.test.ts, test/ext/login.test.ts. Plan:
 * §4.2, §7.5 step 2, §7.6, §10.1 item 19b, §13.2 D58.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as path from 'node:path';
import type { Event, Terminal } from 'vscode';
import { shellCommandLine } from '../core/shell';

/**
 * The part of a VS Code `Terminal` this file touches (primer §72): its name, `sendText` and
 * `show` as they are, plus two fields read more loosely than VS Code types them, so a test's
 * stand-in needs no VS Code objects. `exitStatus` is only asked "set or not" — VS Code sets it
 * when the terminal's shell has exited. `creationOptions.cwd` is the directory the terminal was
 * made in, a string or a `Uri` (only its `fsPath` is read): two repositories with the same folder
 * name get terminals with the same name, and the directory tells them apart.
 */
// see primer §9 (an interface that extends another), §49 (`Pick`), §10 (union types), §11 (`?`
// fields), §14 (readonly) and §51 (`object`: any object at all)
export interface TerminalLike extends Pick<Terminal, 'name' | 'sendText' | 'show'> {
  readonly exitStatus: object | undefined;
  readonly creationOptions: { readonly name?: string; readonly cwd?: string | { readonly fsPath: string } };
}

/** The three window calls around terminals, as one object handed in (primer §72). */
// see primer §33 (function types) and §32 (Event)
export interface TerminalHost {
  /** `window.terminals`: every terminal open now. */
  terminals(): readonly TerminalLike[];
  /** `window.createTerminal(options)`: a new terminal with that name, its shell started in `cwd`. */
  create(options: { readonly name: string; readonly cwd: string }): TerminalLike;
  /** `window.onDidCloseTerminal`: fired with the terminal the user (or its shell) closed. */
  readonly onDidClose: Event<TerminalLike>;
}

/** `PR Cascade: <folder>` — the one terminal of a repository. */
// see primer §12 (template strings) and §28 (`path.basename`)
export function terminalName(root: string): string {
  return `PR Cascade: ${path.basename(root)}`;
}

/**
 * Types `argv` into the terminal named `name` at `cwd` — the live one, when there is one the caller
 * may use (`usable`), else a new one — as one line with Enter: `cd <cwd> && <argv>`, both quoted
 * for the shell (core/shell.ts), so the command runs at `cwd` even if the user has changed
 * directory in the terminal since it was made. Then brings the terminal forward, taking the focus
 * (`show()` with no `true`): the user may have to answer it. Returns the terminal, so a caller can
 * tell whether a close it hears of is this one's. `usable` is how login.ts passes over a terminal
 * whose last command it gave up waiting on — it may still be sitting in that command's prompt.
 */
// see primer §25 (arrays: `find`), §30 (`??`), §13 (a default parameter) and §33 (a function as a parameter)
export function runInTerminal(
  host: TerminalHost,
  name: string,
  cwd: string,
  argv: readonly string[],
  usable: (terminal: TerminalLike) => boolean = () => true,
): TerminalLike {
  const live = host
    .terminals()
    .find((terminal) => terminal.name === name && terminal.exitStatus === undefined && directoryOf(terminal) === cwd && usable(terminal));
  const terminal = live ?? host.create({ name, cwd });
  terminal.sendText(`${shellCommandLine(['cd', cwd])} && ${shellCommandLine(argv)}`, true);
  terminal.show();
  return terminal;
}

/** The directory a terminal was made in, as a path, or `undefined` when it was made without one. */
// see primer §17 (narrowing with typeof) and §70 (`?.`)
function directoryOf(terminal: TerminalLike): string | undefined {
  const cwd = terminal.creationOptions.cwd;
  if (typeof cwd === 'string') {
    return cwd;
  }
  return cwd?.fsPath;
}
