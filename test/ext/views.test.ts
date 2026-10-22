/**
 * test/ext/views.test.ts — the smartlog webview view (M6 item 23d) inside a real VS Code, two
 * ways. First `StackWebviewProvider` over stand-in views (the ext/gitApi pattern — the module
 * imported directly, VS Code's `EventEmitter` and `Uri` real, the view faked): the shell on
 * resolve with options before html and a fresh nonce; the three fires of its own visibility event;
 * the current model posted on resolve, each model while showing, nothing while hidden and the same
 * object again on show (E79); one model object to two views (E81); a view's message through the
 * wiring to the registered command, every refusal logged and run nothing, a refused command
 * reported as failed; dispose and a second resolve. Then, from the wiring commit, live through
 * the handle `activate()` returns in test mode.
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * Depends on: the running extension (its `extensionUri`), src/vscode/views/base.ts,
 * src/vscode/views/shell.ts and src/vscode/views/smartlog.ts imported directly,
 * src/webview/protocol.ts (`ModelMessage`, a type). Depended on by: nothing. Plan: §7.1.1,
 * §7.1.3 "Protocol" and "Security", §7.11, §8 E79/E81/E82, §9.1 layer 3, §9.4 `ext/views`, §10.1
 * item 23d (M6), §13.2 D70.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
import { before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import { StackWebviewProvider } from '../../src/vscode/views/base';
import type { Handled, ViewHost } from '../../src/vscode/views/base';
import { shellHtml } from '../../src/vscode/views/shell';
import { SMARTLOG_VIEW } from '../../src/vscode/views/smartlog';
import type { ModelMessage } from '../../src/webview/protocol';

// `dist/webview/` of the extension under test, as src/extension.ts builds it — taken in `before`.
let distUri: vscode.Uri;

/** A model with `seq` and nothing in it: the provider reads `seq` and passes the rest on untouched. */
// see primer §16 (object literals: spread — the overrides last)
function model(seq: number, over: Partial<ModelMessage> = {}): ModelMessage {
  return { type: 'model', seq, repos: [], activeRepo: null, notices: [], ...over };
}

/**
 * A stand-in `WebviewView`: VS Code's two real `EventEmitter`s behind the view's two events and a
 * third behind the page's posts, a webview whose `options` and `html` setters record the order they
 * were set in, a `postMessage` that records the message and answers whether the view was visible
 * (as VS Code's does), and `asWebviewUri` / `cspSource` as VS Code gives them for a locally
 * installed extension. The test moves the view through `setVisible`, `receive` and `dispose`.
 */
// see primer §9 (interface: methods and getters), §32 (EventEmitter), §61 (getters and setters in an object literal)
interface FakeWebviewView {
  readonly view: vscode.WebviewView;
  /** Every message the provider posted, in order. */
  readonly posted: unknown[];
  /** `'options'` and `'html'`, in the order the provider set them. */
  readonly writes: string[];
  readonly options: vscode.WebviewOptions;
  readonly html: string;
  /** What the page posts: fires the view's `onDidReceiveMessage`. */
  receive(message: unknown): void;
  /** The view is shown or hidden: fires `onDidChangeVisibility` with `visible` already changed, as VS Code does. */
  setVisible(visible: boolean): void;
  /** The user unchecked the view: fires `onDidDispose`. */
  dispose(): void;
}

function fakeWebviewView(visible: boolean = true): FakeWebviewView {
  const received = new vscode.EventEmitter<unknown>();
  const visibility = new vscode.EventEmitter<void>();
  const disposed = new vscode.EventEmitter<void>();
  const posted: unknown[] = [];
  const writes: string[] = [];
  let isVisible = visible;
  let options: vscode.WebviewOptions = {};
  let html = '';
  const webview: vscode.Webview = {
    get options() {
      return options;
    },
    set options(value) {
      options = value;
      writes.push('options');
    },
    get html() {
      return html;
    },
    set html(value) {
      html = value;
      writes.push('html');
    },
    onDidReceiveMessage: received.event,
    postMessage: (message: unknown) => {
      posted.push(message);
      return Promise.resolve(isVisible);
    },
    asWebviewUri: (uri) => uri.with({ scheme: 'https', authority: 'file+.vscode-resource.vscode-cdn.net' }),
    cspSource: "'self' https://*.vscode-cdn.net",
  };
  const view: vscode.WebviewView = {
    viewType: SMARTLOG_VIEW.id,
    webview,
    get visible() {
      return isVisible;
    },
    onDidChangeVisibility: visibility.event,
    onDidDispose: disposed.event,
    show: () => undefined,
  };
  return {
    view,
    posted,
    writes,
    get options() {
      return options;
    },
    get html() {
      return html;
    },
    receive: (message) => received.fire(message),
    setVisible: (value) => {
      isVisible = value;
      visibility.fire();
    },
    dispose: () => disposed.fire(),
  };
}

/** A `ViewHost` that records every run, line and notification, and whose `run` rejects with `failure` when one is set. */
interface RecordingHost {
  readonly host: ViewHost;
  readonly runs: { command: string; args: readonly string[] }[];
  readonly logged: string[];
  readonly notified: string[];
  failure: Error | undefined;
}

function recordingHost(): RecordingHost {
  const runs: { command: string; args: readonly string[] }[] = [];
  const logged: string[] = [];
  const notified: string[] = [];
  const recorder: RecordingHost = {
    runs,
    logged,
    notified,
    failure: undefined,
    host: {
      run: (command, args) => {
        runs.push({ command, args });
        return recorder.failure === undefined ? Promise.resolve(undefined) : Promise.reject(recorder.failure);
      },
      log: (line) => {
        logged.push(line);
      },
      notify: (message) => {
        notified.push(message);
      },
    },
  };
  return recorder;
}

/** A provider over a recording host; `resolve` hands it a fake view the way VS Code would. */
function provider(host: ViewHost = recordingHost().host): StackWebviewProvider {
  return new StackWebviewProvider(SMARTLOG_VIEW, distUri, host);
}

/** The nonce the shell carries, read back from the html — 32 hex characters, or a failure. */
// see primer §20 (regular expression literals: a capture group)
function nonceOf(html: string): string {
  const match = /<script nonce="([0-9a-f]{32})"/.exec(html);
  if (match === null) {
    assert.fail('the shell has no 32-hex nonce on its script');
  }
  return match[1];
}

// see primer §5 (arrow functions)
describe('the smartlog webview view (plan §7.1.1, §7.1.3, E79, E81)', () => {
  before(() => {
    const extension = vscode.extensions.getExtension('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    distUri = vscode.Uri.joinPath(extension.extensionUri, 'dist', 'webview');
  });

  describe('StackWebviewProvider over stand-in views', () => {
    it("writes the shell on resolve — options first, then html: scripts enabled, dist/webview the one resource root, and shellHtml over the view's cspSource, a 32-hex nonce and the two webview URIs of smartlog.js and codicon.css (plan §7.1.3 Security)", () => {
      // arrange
      const fake = fakeWebviewView();

      // act
      provider().resolveWebviewView(fake.view);

      // assert: the order, the options, and the html as the template makes it over the parts VS
      // Code would give — the nonce read back, since only the provider knows it
      assert.deepStrictEqual(fake.writes, ['options', 'html']);
      assert.deepStrictEqual(fake.options, { enableScripts: true, localResourceRoots: [distUri] });
      const nonce = nonceOf(fake.html);
      assert.strictEqual(
        fake.html,
        shellHtml({
          cspSource: fake.view.webview.cspSource,
          nonce,
          scriptUri: fake.view.webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'smartlog.js')).toString(),
          styleUri: fake.view.webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'codicon.css')).toString(),
        }),
      );
    });

    it('uses a fresh nonce for every resolve — two views, two nonces', () => {
      // arrange
      const first = fakeWebviewView();
      const second = fakeWebviewView();

      // act
      provider().resolveWebviewView(first.view);
      provider().resolveWebviewView(second.view);

      // assert
      assert.notStrictEqual(nonceOf(first.html), nonceOf(second.html));
    });

    it('reports its visibility as changed three times: when a view is resolved (VS Code constructs it visible and sends no event for the first show), when the view says so, and when the view is disposed', () => {
      // arrange
      const fake = fakeWebviewView();
      const subject = provider();
      const seen: boolean[] = [];
      subject.onDidChangeVisibility(() => seen.push(subject.visible));

      // act
      subject.resolveWebviewView(fake.view);
      fake.setVisible(false);
      fake.setVisible(true);
      fake.dispose();

      // assert: the value at each fire — shown at resolve, hidden, shown, gone
      assert.deepStrictEqual(seen, [true, false, true, false]);
      assert.strictEqual(subject.visible, false);
    });

    it('posts the current model on resolve when one has been built, and nothing when none has', () => {
      // arrange: one provider that has a model before its view arrives, one that has not
      const withModel = provider();
      const first = model(1);
      withModel.update(first);
      const fakeWith = fakeWebviewView();
      const fakeWithout = fakeWebviewView();

      // act
      withModel.resolveWebviewView(fakeWith.view);
      provider().resolveWebviewView(fakeWithout.view);

      // assert: the very object, once; nothing for the empty provider
      assert.deepStrictEqual(fakeWith.posted, [first]);
      assert.strictEqual(fakeWith.posted[0], first);
      assert.deepStrictEqual(fakeWithout.posted, []);
    });

    it('posts each model it is given while the view shows, in order, the seq as stamped — never changed (E79)', () => {
      // arrange
      const fake = fakeWebviewView();
      const subject = provider();
      subject.resolveWebviewView(fake.view);
      const deliveries: number[] = [];
      subject.onDidPost((delivery) => deliveries.push(delivery.message.seq));

      // act
      subject.update(model(7));
      subject.update(model(8));

      // assert: what the page got, and what onDidPost reported, agree
      assert.deepStrictEqual(
        fake.posted.map((posted) => (posted as ModelMessage).seq),
        [7, 8],
      );
      assert.deepStrictEqual(deliveries, [7, 8]);
      assert.strictEqual(subject.current?.seq, 8);
    });

    it('posts nothing while the view is hidden — the current model moves on — and posts that model, the same object with the same seq, when the view shows again (E79: "a hidden view receives the current model when it becomes visible")', async () => {
      // arrange: a view resolved and then hidden
      const fake = fakeWebviewView();
      const subject = provider();
      subject.resolveWebviewView(fake.view);
      fake.setVisible(false);
      const deliveries: Thenable<boolean>[] = [];
      subject.onDidPost((delivery) => deliveries.push(delivery.delivered));

      // act: two models arrive while hidden, then the view shows
      subject.update(model(3));
      const latest = model(4);
      subject.update(latest);
      assert.deepStrictEqual(fake.posted, [], 'posted while hidden');
      fake.setVisible(true);

      // assert: one post, the latest model as it is, and the fake's "delivered" for a visible view
      assert.deepStrictEqual(fake.posted, [latest]);
      assert.strictEqual(fake.posted[0], latest);
      assert.strictEqual(deliveries.length, 1);
      assert.strictEqual(await deliveries[0], true);
    });

    it('hands one model object to two views — E81 in its 23d form: two providers, one message, the same object in both pages', () => {
      // arrange: two views, as the smartlog and 23i's graph will be
      const fakeA = fakeWebviewView();
      const fakeB = fakeWebviewView();
      const a = provider();
      const b = new StackWebviewProvider({ id: 'prCascade.graph', bundle: 'graph' }, distUri, recordingHost().host);
      a.resolveWebviewView(fakeA.view);
      b.resolveWebviewView(fakeB.view);
      const shared = model(5);

      // act
      a.update(shared);
      b.update(shared);

      // assert
      assert.strictEqual(fakeA.posted[0], shared);
      assert.strictEqual(fakeB.posted[0], shared);
    });

    it("runs a `command` the page posts as the registered command with its string arguments — through the view's onDidReceiveMessage, the wiring itself (E79)", async () => {
      // arrange
      const recorder = recordingHost();
      const fake = fakeWebviewView();
      const subject = provider(recorder.host);
      subject.resolveWebviewView(fake.view);
      subject.update(model(2));

      // act: what host.ts's postCommand sends for the current model
      fake.receive({ type: 'command', seq: 2, command: 'prCascade.refresh', args: ['/work/app'] });
      // the handler is async; the run is recorded before its first await, but let it settle
      await Promise.resolve();

      // assert
      assert.deepStrictEqual(recorder.runs, [{ command: 'prCascade.refresh', args: ['/work/app'] }]);
      assert.deepStrictEqual(recorder.logged, []);
      assert.deepStrictEqual(recorder.notified, []);
    });

    it('runs nothing for a stale seq, a seq ahead of the model, a command id outside prCascade., arguments that are not all strings, or a message that is not a command — one Output line each, prefixed with the view id (E79; the table is unit/viewRoute\'s)', async () => {
      // arrange
      const recorder = recordingHost();
      const subject = provider(recorder.host);
      subject.update(model(2));
      const stale = { type: 'command', seq: 1, command: 'prCascade.refresh', args: [] };
      const ahead = { type: 'command', seq: 3, command: 'prCascade.refresh', args: [] };
      const foreign = { type: 'command', seq: 2, command: 'workbench.action.closeWindow', args: [] };
      const badArgs = { type: 'command', seq: 2, command: 'prCascade.refresh', args: [1] };
      const notACommand = { type: 'moveOnto', seq: 2, repo: '/work/app', layer: 'a', target: 'origin/main' };

      // act
      const kinds = (await Promise.all([stale, ahead, foreign, badArgs, notACommand].map((message) => subject.handleMessage(message)))).map((handled) => handled.kind);

      // assert: the decisions, nothing run, five lines — each the view's id, then route.ts's sentence
      assert.deepStrictEqual(kinds, ['stale', 'rejected', 'rejected', 'rejected', 'ignored']);
      assert.deepStrictEqual(recorder.runs, []);
      assert.deepStrictEqual(recorder.logged, [
        'prCascade.smartlog: dropped prCascade.refresh for model 1; model 2 is current',
        'prCascade.smartlog: rejected prCascade.refresh: seq 3 is ahead of the current model (2)',
        'prCascade.smartlog: rejected a command id that is not ours: "workbench.action.closeWindow"',
        'prCascade.smartlog: rejected prCascade.refresh: its arguments are not all strings',
        'prCascade.smartlog: ignored a "moveOnto" message',
      ]);
      assert.deepStrictEqual(recorder.notified, []);
    });

    it('reports a command VS Code refuses — a rejection from the runner — as failed: one Output line, one error notification, nothing thrown out of the listener', async () => {
      // arrange: a host whose run rejects the way VS Code does for an id nobody registered
      const recorder = recordingHost();
      recorder.failure = new Error("command 'prCascade.nothing' not found");
      const subject = provider(recorder.host);
      subject.update(model(1));

      // act
      const handled: Handled = await subject.handleMessage({ type: 'command', seq: 1, command: 'prCascade.nothing', args: [] });

      // assert
      const why = "prCascade.nothing failed: command 'prCascade.nothing' not found";
      assert.deepStrictEqual(handled, { kind: 'failed', command: 'prCascade.nothing', why });
      assert.deepStrictEqual(recorder.runs, [{ command: 'prCascade.nothing', args: [] }]);
      assert.deepStrictEqual(recorder.logged, [`prCascade.smartlog: ${why}`]);
      assert.deepStrictEqual(recorder.notified, [why]);
    });

    it('stops posting after the view is disposed, counts a second resolve — the user unchecked the view and showed it again — and posts the current model into the new view', () => {
      // arrange
      const first = fakeWebviewView();
      const subject = provider();
      subject.resolveWebviewView(first.view);
      subject.update(model(1));

      // act: the view goes, a model arrives, a new view comes
      first.dispose();
      const latest = model(2);
      subject.update(latest);
      const second = fakeWebviewView();
      subject.resolveWebviewView(second.view);

      // assert
      assert.deepStrictEqual(first.posted.map((posted) => (posted as ModelMessage).seq), [1]);
      assert.strictEqual(subject.resolves, 2);
      assert.deepStrictEqual(second.posted, [latest]);
      assert.strictEqual(subject.view, second.view);
    });
  });
});
