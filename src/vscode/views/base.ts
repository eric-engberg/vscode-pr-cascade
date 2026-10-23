/**
 * vscode/views/base.ts — `StackWebviewProvider`, the one `WebviewViewProvider` both M6 views are
 * instances of (plan §4.2, §7.1.3). When VS Code resolves a view it writes the shell with a fresh
 * nonce and posts the current model; `update` posts each new model while the view is showing and
 * posts the current one again when the view becomes visible — `retainContextWhenHidden` is off, so
 * the page starts over on every show and knows nothing until a model arrives; a message the view
 * posts goes through `routeViewMessage` to the registered command (E79). It owns no load and spawns
 * nothing: src/extension.ts hands it the model, stamped with its `seq`, and three functions.
 *
 * Layer: vscode adapter (plan §4.1). Depends on: the `vscode` module, src/webview/protocol.ts
 * (`ModelMessage`, a type), vscode/views/route.ts, vscode/views/shell.ts. Depended on by:
 * src/extension.ts (one instance per view, registered under its spec's id; the smartlog's is
 * handed out under `ExtensionMode.Test` as `ExtensionApi.smartlog`), vscode/views/smartlog.ts
 * (`ViewSpec`, a type), test/ext/views.test.ts. Plan: §4.2, §7.1.1 (title-bar actions), §7.1.3
 * "Protocol", "Theme" and "Security", §8 E79/E81, §9.1 layer 3 (the handle), §9.4 `ext/views`,
 * §10.1 item 23d (M6), §13.2 D70.
 */

// see primer §1 (import / export), §2 (the vscode module) and §9 (`import type`)
import * as vscode from 'vscode';
import type { ModelMessage } from '../../webview/protocol';
import { routeViewMessage } from './route';
import type { Route } from './route';
import { newNonce, shellHtml } from './shell';

/** What tells one view from the other: two strings, so the smartlog and 23i's graph are two constants, not two classes (D70). */
// see primer §9 (interface) and §14 (readonly)
export interface ViewSpec {
  /** The view id `package.json` contributes (`prCascade.smartlog`): what `registerWebviewViewProvider` is given, and what `view == …` in a menu's `when` clause names. */
  readonly id: string;
  /** The bundle under dist/webview/ the shell loads, without `.js` — esbuild.mjs's `entryPoints` key (`smartlog`). */
  readonly bundle: string;
}

/**
 * What the provider asks of the window, handed in by src/extension.ts (plan §4.1: a view gets
 * functions, never a runner or the Output channel itself), so a test hands in recorders.
 */
// see primer §9 (interface: methods) and §60 (`Thenable`: VS Code's promise-like type)
export interface ViewHost {
  /** Runs a registered command with its string arguments — `vscode.commands.executeCommand`. Rejects when VS Code refuses the id or the command throws. */
  run(command: string, args: readonly string[]): Thenable<unknown>;
  /** One line to the Output channel: every refusal and failure, prefixed with the view's id. */
  log(line: string): void;
  /** An error notification: a command the view asked for was refused by VS Code or threw — what VS Code itself shows for the same rejection from the palette or a tree row (E17 parity). */
  notify(message: string): void;
}

/**
 * One `postMessage` call, as `onDidPost` reports it: the model, and VS Code's answer — `true`
 * when the message reached the page, `false` while the view is hidden — which at 1.85.0 never
 * settles for a post queued behind a page still loading (`webviewElement.ts` at 1.85.0: the flush
 * does not resolve the queued promises; newer VS Code does), so nobody in src awaits it: the tests
 * do, with a deadline.
 */
export interface Delivery {
  readonly message: ModelMessage;
  readonly delivered: Thenable<boolean>;
}

/** What `handleMessage` did: the route it took, or `failed` when the routed command rejected — then `why` is the Output line and the notification. */
// see primer §59 (tagged unions: one more member beside Route's four)
export type Handled = Route | { readonly kind: 'failed'; readonly command: string; readonly why: string };

/**
 * The provider. VS Code calls `resolveWebviewView` when the view first shows (a collapsed pane is
 * not showing — the Explorer starts every contributed view collapsed); src/extension.ts calls
 * `update` with every model; the page calls back through `onDidReceiveMessage`. Everything else is
 * for the tests, through the handle `activate()` returns in test mode (plan §9.1): `current`, the
 * model built last — what a show posts — and `onDidPost`, the posts themselves (together they are
 * §9.1's "last posted model", D70); `visible` and `onDidChangeVisibility`, which this class fires
 * itself in the three places the view's state changes — on resolve (VS Code sends no event for
 * the first show), on the view's own event, on dispose; `resolves`, how many times VS Code
 * resolved a view here; `view`, for the shell it was given.
 */
// see primer §13 (class: `implements` two interfaces), §32 (EventEmitter and Event), §47 (parameter
// properties), §61 (a getter in a class) and §14 (readonly)
export class StackWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly postEmitter = new vscode.EventEmitter<Delivery>();
  /** Every `postMessage` made, in order: on resolve, on each model while showing, on each show. */
  readonly onDidPost: vscode.Event<Delivery>;

  private readonly visibilityEmitter = new vscode.EventEmitter<void>();
  /** Fires when `visible` changes: at resolve (no view → a view, visible from construction), on the view's own event, on dispose. */
  readonly onDidChangeVisibility: vscode.Event<void>;

  /** How many times VS Code resolved a view here: 1 across hide and show, 2 after the user unchecked the view and showed it again — a new `WebviewView`, and a new nonce, on that next resolve. */
  resolves = 0;

  /** The model built last, posted on resolve and on every show; `undefined` until the first load. */
  private model: ModelMessage | undefined;
  /** The view VS Code handed over, until it is disposed. */
  private resolved: vscode.WebviewView | undefined;
  /**
   * Whether the view is showing, mirrored from the view rather than read off it: a disposed
   * `WebviewView` throws on every member, and `dropView` needs the last state after the dispose.
   */
  private shown = false;
  /** The three listeners on the view, disposed with it. */
  private viewSubscriptions: vscode.Disposable[] = [];

  constructor(
    readonly spec: ViewSpec,
    /** `dist/webview/` as a Uri (`Uri.joinPath(context.extensionUri, 'dist', 'webview')`): the one folder the page may load from, and where the bundle and the codicons are. */
    private readonly distUri: vscode.Uri,
    private readonly host: ViewHost,
  ) {
    this.onDidPost = this.postEmitter.event;
    this.onDidChangeVisibility = this.visibilityEmitter.event;
  }

  /** The model built last — what the view shows once it shows, whatever is posted meanwhile. */
  get current(): ModelMessage | undefined {
    return this.model;
  }

  /** The view VS Code resolved, or `undefined` before the first resolve and after a dispose. */
  get view(): vscode.WebviewView | undefined {
    return this.resolved;
  }

  /** Whether the view is on screen and expanded — when a post reaches the page. */
  get visible(): boolean {
    return this.shown;
  }

  /**
   * Called by VS Code when the view first shows, and again only after it was disposed. In this
   * order, each step for a reason: the three listeners first, synchronously, so a collapse during
   * this very call is not missed; `options` before `html`, because each setter is its own message
   * to the window and a change of options after the html reloads the page; the shell with a fresh
   * nonce — VS Code re-sets this same string on every later show, so one nonce serves the pane's
   * life; then this class's own visibility event (the view is visible from construction and VS
   * Code sends no event for the first show); then the current model, if one has been built.
   * One parameter where the interface declares three (`context`, `token`): an implementation may
   * take fewer, and neither is read — `retainContextWhenHidden` is off, so there is no state to
   * restore, and the shell is set before anything could be cancelled.
   */
  // see primer §88 (a webview view: `resolveWebviewView`, `options`, `html`, `asWebviewUri`, `cspSource`, `postMessage`) and §54 (destructuring: the webview out of the view)
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.resolves += 1;
    this.dropView();
    this.resolved = webviewView;
    this.shown = webviewView.visible;
    const { webview } = webviewView;
    this.viewSubscriptions = [
      // `onDidReceiveMessage` hands over whatever the page posted, typed `any` by VS Code; it is
      // `unknown` here and checked, field by field, in route.ts. `void`: the handler is async and
      // nobody awaits an event listener (primer §63).
      webview.onDidReceiveMessage((message: unknown) => void this.handleMessage(message)),
      webviewView.onDidChangeVisibility(() => {
        this.shown = webviewView.visible;
        this.visibilityEmitter.fire();
        // Shown again: the page has started over and holds nothing — post the current model, as it
        // is, with its `seq` unchanged (E79: "a hidden view receives the current model when it
        // becomes visible"). Hidden: `deliver` posts nothing.
        this.deliver();
      }),
      webviewView.onDidDispose(() => this.dropView()),
    ];
    webview.options = { enableScripts: true, localResourceRoots: [this.distUri] };
    webview.html = shellHtml({
      cspSource: webview.cspSource,
      nonce: newNonce(),
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.distUri, `${this.spec.bundle}.js`)).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.distUri, 'codicon.css')).toString(),
    });
    this.visibilityEmitter.fire();
    this.deliver();
  }

  /** A new model from the load (src/extension.ts, stamped with its `seq`): kept as the current one, and posted if the view is showing. */
  update(message: ModelMessage): void {
    this.model = message;
    this.deliver();
  }

  /**
   * What a message from the page becomes — the function `onDidReceiveMessage` is wired to, public
   * so a test can feed a message the way the page would. Everything but a `run` is one Output line
   * and nothing else (E79: a stale click, a foreign id, a malformed post run nothing); a `run` is
   * the registered command with the view's string arguments, awaited inside a `try` because a
   * rejection here reaches nobody otherwise — VS Code shows a rejected command from the palette or
   * a tree row as an error notification, and a click in the view must not be the one place that
   * is silent (E17 parity; D70): logged, shown through `host.notify`, and answered as `failed`.
   */
  // see primer §6 (async / await), §18 (try / catch and unknown), §30 (`??`: 0 before any model) and §70 (`?.` on a model that may not be there)
  async handleMessage(message: unknown): Promise<Handled> {
    const route = routeViewMessage(message, this.model?.seq ?? 0);
    if (route.kind !== 'run') {
      this.host.log(`${this.spec.id}: ${route.why}`);
      return route;
    }
    try {
      await this.host.run(route.command, route.args);
      return route;
    } catch (error) {
      const why = `${route.command} failed: ${error instanceof Error ? error.message : String(error)}`;
      this.host.log(`${this.spec.id}: ${why}`);
      this.host.notify(why);
      return { kind: 'failed', command: route.command, why };
    }
  }

  /** Called by VS Code on shutdown, through context.subscriptions (src/extension.ts): lets go of the view and the two emitters. */
  dispose(): void {
    this.dropView();
    this.postEmitter.dispose();
    this.visibilityEmitter.dispose();
  }

  /**
   * One post, when there is a view showing and a model to post: `postMessage`'s answer is handed
   * to `onDidPost` and never awaited here (`Delivery` says why). Nothing while hidden — VS Code
   * would answer `false` and drop it — the show posts instead.
   */
  private deliver(): void {
    const view = this.resolved;
    const message = this.model;
    if (view === undefined || !this.shown || message === undefined) {
      return;
    }
    const delivered = view.webview.postMessage(message);
    this.postEmitter.fire({ message, delivered });
  }

  /** Forgets the view — its listeners disposed, `visible` false — and says so if it was showing. The view itself is VS Code's to dispose. */
  // see primer §22 (for ... of)
  private dropView(): void {
    const wasShown = this.shown;
    for (const subscription of this.viewSubscriptions) {
      subscription.dispose();
    }
    this.viewSubscriptions = [];
    this.resolved = undefined;
    this.shown = false;
    if (wasShown) {
      this.visibilityEmitter.fire();
    }
  }
}
