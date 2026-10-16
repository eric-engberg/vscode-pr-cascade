/**
 * webview/host.ts — the view side of the bridge to the extension host. VS Code gives a webview
 * page exactly one way to talk to its extension: a global `acquireVsCodeApi()`, whose
 * `postMessage` sends to the host, and `message` events on `window`, which the host's own
 * `postMessage` delivers. `connect()` wraps both so a renderer sees protocol.ts's typed messages
 * and nothing else: `onModel` hands it every model the host posts; `postCommand` sends one
 * `CommandMessage` stamped with the `seq` of the last model received (E79's view half — the host
 * drops a command that names an older model than its latest: a click on a row that no longer
 * exists). `lastSeq` moves before the handler runs, so a renderer that draws inside the handler
 * acts on the model it shows; one that defers drawing (a `requestAnimationFrame`) accepts a
 * one-frame window in which a click on the old picture carries the new `seq`. Called once per
 * page, by the view's main.ts: VS Code throws on a second `acquireVsCodeApi()` (its webview
 * bootstrap, src/vs/workbench/contrib/webview/browser/pre/index.html at 1.85.0 — "An instance of
 * the VS Code API has already been acquired").
 *
 * Layer: webview (plan §4.1: browser code — no `vscode`, no Node built-ins, from src/core types
 * only). Depends on: protocol.ts (types). Depended on by: smartlog/main.ts, the renderers (items
 * 23e, 23i), test/webview/host.test.ts, test/webview/helpers/fakeVsCodeApi.ts (`VsCodeApi`, a type).
 * Plan: §7.1.3 "Protocol", §8 E79, §10.1 item 23c, §13.2 D69.
 */

// see primer §9 (`import type`: erased when compiled, so nothing of protocol.ts is bundled by it)
import type { CommandId, CommandMessage, ModelMessage } from './protocol';

/**
 * What `acquireVsCodeApi()` returns, as this file uses it — a subset of VS Code's object, which
 * also has `getState()` and `setState(state)` (and a second, optional `transfer` argument on
 * `postMessage`). Declared when something reads them (D55): with `retainContextWhenHidden` off
 * (§7.1.3) the host re-posts the model on every show, so nothing keeps state here; item 23f
 * decides whether focus survives a hide. Hand-written — `@types/vscode-webview` would say the
 * same in a package under §11.3's downloads floor.
 */
export interface VsCodeApi {
  postMessage(message: unknown): void;
}

// `declare function` tells the compiler about a name the page provides at run time that no
// import supplies — VS Code injects `acquireVsCodeApi` into every webview page before our
// script runs. It declares, it does not define: nothing is emitted for this line, and the
// bundle calls the page's. Module-scoped on purpose: only this file can name it, so every
// renderer goes through `connect()` and nothing acquires the API a second time.
// see primer §84 (`declare`: a name the page provides and we never define)
declare function acquireVsCodeApi(): VsCodeApi;

/** The two things a renderer does with the host: receive models, send commands. */
export interface HostConnection {
  /**
   * Call `handler` with every model the host posts, in order. Anything else that arrives as a
   * `message` event — a `HostMessage` member a later item adds, a malformed post — is ignored in
   * silence: the host is ours, and a `console.warn` would reach only a Developer Tools pane
   * nobody has open.
   */
  onModel(handler: (message: ModelMessage) => void): void;
  /**
   * Send one command to the host, stamped with the `seq` of the last model received (0 before
   * any) — a view never invents a `seq`. `args` as protocol.ts says: the repository root first.
   */
  postCommand(command: CommandId, args: readonly string[]): void;
}

/**
 * The host, as a renderer sees it. Acquires the API once and keeps the latest `seq` in a closure
 * — the only state in the view, and it belongs to the bridge, not to what is drawn.
 */
export function connect(): HostConnection {
  const api = acquireVsCodeApi();
  let lastSeq = 0;
  // see primer §16 (method shorthand in an object literal) and §64 (two methods sharing a `let` through the closure)
  return {
    onModel(handler) {
      // `event.data` is whatever the host posted, copied into the page: `unknown` until checked.
      // see primer §85 (the browser's globals and the DOM lib: `window`, `MessageEvent<T>`)
      window.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (isModelMessage(event.data)) {
          lastSeq = event.data.seq;
          handler(event.data);
        }
      });
    },
    postCommand(command, args) {
      const message: CommandMessage = { type: 'command', seq: lastSeq, command, args };
      api.postMessage(message);
    },
  };
}

/**
 * Is this a `ModelMessage`? The tag, a numeric `seq` and a `repos` array — enough that `lastSeq`
 * can only ever hold a number and a renderer can index `repos`. Only the host posts into a
 * webview's window (VS Code's bootstrap relays `webview.postMessage`'s object and nothing else),
 * so the check guards against our own future members and a malformed post, not a foreign sender;
 * the host asks the same of what it receives (protocol.ts's header) with more suspicion — that
 * direction is a click.
 */
// see primer §86 (a type predicate: `message is ModelMessage`) and §51 (`typeof`, `null`, `in`)
function isModelMessage(message: unknown): message is ModelMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'model' &&
    'seq' in message &&
    typeof message.seq === 'number' &&
    'repos' in message &&
    Array.isArray(message.repos)
  );
}
