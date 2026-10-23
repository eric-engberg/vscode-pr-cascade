/**
 * vscode/views/route.ts — E79's host half over a message a view posted: run the registered command
 * it names, or say why not — as a pure function of the message and the current model's `seq`, so
 * the rules src/webview/protocol.ts's header states are a unit test (`test/unit/viewRoute.test.ts`).
 * The checks, in order: is it one of our messages at all; is it a `command` (a `moveOnto` is 23h's
 * and is ignored until then); is the id `prCascade.` followed by letters, digits, `_`, `.` or `-`
 * and nothing else; are the arguments all strings;
 * is the `seq` a number the host could have posted; is it the current model's — older is a click
 * on a row that is gone, newer is nothing a view can honestly hold. Nothing but those four fields is
 * read, and nothing the view sends is evaluated (plan §7.1.3: "the host evaluates nothing the view
 * sends except a command id … and its string arguments").
 *
 * Layer: vscode adapter (plan §4.1), with no `vscode` import, so Vitest runs its test under
 * `npm test`. Depends on: src/webview/protocol.ts (`CommandId`, a type). Depended on by:
 * vscode/views/base.ts (`handleMessage`), test/unit/viewRoute.test.ts. Plan: §7.1.3 "Protocol",
 * §8 E79, §9.4 `ext/views` (the table is `unit/viewRoute`'s), §10.1 item 23d (M6), §13.2 D70.
 */

// see primer §1 (import / export) and §9 (`import type`: a type from the view protocol, nothing of its code — there is none)
import type { CommandId } from '../../webview/protocol';

/**
 * What to do with one message from a view, told apart by `kind`: `run` the command with its
 * arguments; or not, with `why` as the Output line's tail (the provider prefixes the view's id) —
 * `stale` for a `seq` older than the current model's (a click on a row that no longer exists —
 * E79), `rejected` for a `command` that fails a check (nothing runs), `ignored` for a message that
 * is not a `command` at all (a `moveOnto` until 23h, a type a later item adds, a post that is not
 * an object).
 */
// see primer §59 (tagged unions) and §14 (readonly arrays)
export type Route =
  | { readonly kind: 'run'; readonly command: CommandId; readonly args: readonly string[] }
  | { readonly kind: 'stale'; readonly why: string }
  | { readonly kind: 'rejected'; readonly why: string }
  | { readonly kind: 'ignored'; readonly why: string };

/**
 * Our command ids, stricter than protocol.ts's `CommandId` on purpose: `prCascade.` followed by
 * letters, digits, `_`, `.` or `-`, and nothing else. The id is executed as received, echoed into
 * the Output line and, when VS Code refuses it, into an error notification — where VS Code turns
 * `[label](command:…)` into a link that runs any command on one click — so no space, bracket,
 * parenthesis or line break may pass. Every id of ours fits (`package.json`'s five, VS Code's
 * `prCascade.smartlog.focus`).
 */
// see primer §20 (a regular expression literal, anchored `^…$`; `.test`)
const COMMAND_ID = /^prCascade\.[\w.-]+$/;

/**
 * The decision for `message`, against `currentSeq` — the `seq` of the model the host built last
 * (0 before any), which is the model a hidden view receives on its next show. Shape before
 * staleness, so a malformed command is rejected whatever its `seq`. `seq` must be a non-negative
 * integer: a view only ever holds a `seq` the host posted (src/webview/host.ts), so a fraction, a
 * negative number or a `seq` ahead of the current model is not a view's and runs nothing.
 */
// see primer §51 (`typeof x === 'object'`, `null`, `in`), §41 (`Number.isInteger`), §16 (arrays: spread — a copy, not the view's array) and §12 (template strings; `JSON.stringify` quotes a value the way it was sent)
export function routeViewMessage(message: unknown, currentSeq: number): Route {
  if (typeof message !== 'object' || message === null || !('type' in message) || typeof message.type !== 'string') {
    return { kind: 'ignored', why: 'ignored a message that is not one of ours' };
  }
  if (message.type !== 'command') {
    return { kind: 'ignored', why: `ignored a ${JSON.stringify(message.type)} message` };
  }
  const command = 'command' in message ? message.command : undefined;
  if (!isCommandId(command)) {
    return { kind: 'rejected', why: `rejected a command id that is not ours: ${JSON.stringify(command)}` };
  }
  const args = 'args' in message ? message.args : undefined;
  if (!isStringArray(args)) {
    return { kind: 'rejected', why: `rejected ${command}: its arguments are not all strings` };
  }
  const seq = 'seq' in message ? message.seq : undefined;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    return { kind: 'rejected', why: `rejected ${command}: no usable seq` };
  }
  if (seq > currentSeq) {
    return { kind: 'rejected', why: `rejected ${command}: seq ${seq} is ahead of the current model (${currentSeq})` };
  }
  if (seq < currentSeq) {
    return { kind: 'stale', why: `dropped ${command} for model ${seq}; model ${currentSeq} is current` };
  }
  return { kind: 'run', command, args: [...args] };
}

/** Is this one of our command ids — `COMMAND_ID`'s shape? The check protocol.ts's `CommandId` type makes at compile time, made again and more strictly on the received text, which is data (E79). */
// see primer §86 (a type predicate: `value is CommandId`) and §17 (narrowing with typeof)
function isCommandId(value: unknown): value is CommandId {
  return typeof value === 'string' && COMMAND_ID.test(value);
}

/** Is this an array of strings — the only shape a command's arguments may take (protocol.ts)? */
// see primer §41 (`Array.isArray`) and §25 (arrays: `every`)
function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
