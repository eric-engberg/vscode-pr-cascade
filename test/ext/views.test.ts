/**
 * test/ext/views.test.ts — the smartlog webview view (M6 item 23d) inside a real VS Code, two
 * ways. First `StackWebviewProvider` over stand-in views (the ext/gitApi pattern — the module
 * imported directly, VS Code's `EventEmitter` and `Uri` real, the view faked): the shell on
 * resolve with options before html and a fresh nonce; the three places its own visibility event fires;
 * the current model posted on resolve, each model while showing, nothing while hidden and the same
 * object again on show (E79); one model object to two views (E81); a view's message through the
 * wiring to the registered command, every refusal logged and run nothing, a refused command
 * reported as failed; dispose and a second resolve. Then live, through the handle `activate()`
 * returns in test mode: the view resolved by its `.focus` command and the manifest that contributes
 * it; the real shell in the real view; the fixture's rows top-first in the model; `seq` up by one
 * per refresh with the post delivered; nothing posted while hidden and the current model again on
 * show; a view's message to a command the test registers, the stale and foreign ones refused, an
 * unregistered id reported with VS Code's own words and one error notification; a failed load drawn
 * as its one notice (E17).
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * Depends on: the running extension (what activate() returns in test mode — `smartlog`,
 * `provider`, `refresh`, `readinessDeps`), src/vscode/views/base.ts, src/vscode/views/shell.ts
 * and src/vscode/views/smartlog.ts imported directly, src/vscode/contextKeys.ts (the key the
 * manifest's `when` must spell), src/webview/protocol.ts (`ModelMessage`, a type),
 * test/helpers/fakeReadinessHost.ts, the fixture workspace. Depended on by: nothing. Plan:
 * §7.1.1, §7.1.3 "Protocol" and "Security", §7.11, §8 E17/E79/E81/E82, §9.1 layer 3, §9.4
 * `ext/views`, §10.1 item 23d (M6), §13.2 D70.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
import * as path from 'node:path';
import { before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { ViewRow } from '../../src/core/viewmodel';
import type { ExtensionApi, ReadinessDeps } from '../../src/extension';
import { HAS_UNTRACKED_KEY } from '../../src/vscode/contextKeys';
import type { StackTreeProvider } from '../../src/vscode/tree';
import { StackWebviewProvider } from '../../src/vscode/views/base';
import type { Delivery, Handled, ViewHost } from '../../src/vscode/views/base';
import { shellHtml } from '../../src/vscode/views/shell';
import { SMARTLOG_VIEW } from '../../src/vscode/views/smartlog';
import type { ModelMessage } from '../../src/webview/protocol';
import { fakeReadinessHost } from '../helpers/fakeReadinessHost';

// `dist/webview/` of the extension under test, as src/extension.ts builds it — taken in `before`.
let distUri: vscode.Uri;

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

/**
 * A Promise that resolves the next time `event` fires, or rejects after `deadlineMs` naming
 * the wait — so a test that expects an event and gets none fails with its cause and still
 * runs its `finally`. Set up before whatever should fire the event (primer §42).
 */
// see primer §42 (waiting for an event with new Promise), §62 (declaring a type parameter on a function) and §58 (setTimeout and clearTimeout)
function nextEvent<T>(event: vscode.Event<T>, deadlineMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error(`no event within ${deadlineMs} ms`));
    }, deadlineMs);
    const subscription = event((value) => {
      clearTimeout(timer);
      subscription.dispose();
      resolve(value);
    });
  });
}

/**
 * `thenable`'s value within `deadlineMs`, or a rejection naming `what`: for a Thenable VS Code may
 * never settle — a `postMessage` queued behind a page still loading, at 1.85.0 (vscode/views/base.ts).
 */
// see primer §60 (`Thenable`) and §63 (`.then` with both continuations)
function withDeadline<T>(thenable: Thenable<T>, deadlineMs: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not settle within ${deadlineMs} ms`)), deadlineMs);
    thenable.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** A row's name as the plain-text view prints it: the branch or trunk ref, the working tree's label, the elided mark. */
// see primer §82 (`switch` over a tagged union)
function rowName(row: ViewRow): string {
  switch (row.kind) {
    case 'layer':
    case 'trunk':
      return row.name;
    case 'workingTree':
      return 'Uncommitted changes';
    case 'elided':
      return '┆';
  }
}

/** The parts of the manifest the live block reads: VS Code hands `packageJSON` out as `any`, and this puts it under a written type. */
// see primer §9 (interface: shapes nested inline) and §42 (`packageJSON`)
interface ViewsManifest {
  contributes: {
    views: { explorer: unknown[] };
    menus: { 'view/title': { command: string; when?: string }[] };
  };
}

/** A model with `seq` and nothing in it: the provider reads `seq` and passes the rest on untouched. */
// see primer §49 (`Partial`: every field optional) and §16 (spread: the given keys last, so they win)
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

    it('uses a fresh nonce for every resolve — one provider, a view disposed and a new one resolved, two nonces', () => {
      // arrange
      const first = fakeWebviewView();
      const second = fakeWebviewView();
      const subject = provider();

      // act: the pane's first life, its end (the user unchecked the view), and a second life
      subject.resolveWebviewView(first.view);
      first.dispose();
      subject.resolveWebviewView(second.view);

      // assert: the html each view was given carries its own nonce — a nonce cached on the
      // provider would make these equal
      assert.notStrictEqual(nonceOf(first.html), nonceOf(second.html));
    });

    it('reports its visibility as changed in three places: when a view is resolved (VS Code constructs it visible and sends no event for the first show), when the view says so, and when the view is disposed', () => {
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
      // see primer §50 (`as`: a type assertion — `posted` is `unknown`, and the compiler checks nothing; the test compares the value)
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

  // The real view, through the handle `activate()` returns in test mode (plan §9.1; primer §68).
  // Two rules of the real VS Code every case here respects. The Explorer starts every contributed
  // view collapsed, and a collapsed view is not resolved — `prCascade.smartlog.focus` expands it;
  // and the smartlog is hidden with `workbench.action.closeSidebar`, never by showing the Source
  // Control container: a tree view that received a refresh while hidden replays it when shown, and
  // that extra load would move `seq` under an assertion.
  describe('live, through the handle activate() returns in test mode', () => {
    let smartlog: StackWebviewProvider;
    let treeProvider: StackTreeProvider;
    let refresh: () => void;
    let deps: ReadinessDeps;

    /**
     * Puts the smartlog on or off screen and waits until the provider says so — its own
     * `onDidChangeVisibility`, which fires at resolve too (VS Code sends no event for the first
     * show, vscode/views/base.ts). `.focus` opens the Explorer on the view, expanded; closing the
     * side bar hides it.
     */
    async function showSmartlog(shown: boolean): Promise<void> {
      if (smartlog.visible === shown) {
        return;
      }
      const changed = nextEvent(smartlog.onDidChangeVisibility, 5_000);
      await vscode.commands.executeCommand(shown ? `${SMARTLOG_VIEW.id}.focus` : 'workbench.action.closeSidebar');
      await changed;
      assert.strictEqual(smartlog.visible, shown, 'the smartlog did not change visibility as asked');
    }

    before(async () => {
      const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
      assert.ok(extension, 'the extension was not loaded');
      const api = await extension.activate();
      assert.ok(api.smartlog, 'activate() returned no smartlog — the extension host is not in ExtensionMode.Test');
      assert.ok(api.readinessDeps, 'activate() returned no readinessDeps');
      smartlog = api.smartlog;
      treeProvider = api.provider;
      refresh = api.refresh;
      deps = api.readinessDeps;
      await showSmartlog(true);
      // A model to work with: the one the startup load built, or a fresh one if none has landed yet.
      if (smartlog.current === undefined) {
        const loaded = nextEvent(treeProvider.onDidLoadStates, 10_000);
        refresh();
        await loaded;
      }
    });

    it("is resolved once by prCascade.smartlog.focus — VS Code's command for the contributed view, which also expands it in the Explorer — and stays resolved across hide and show: the page is rebuilt, the provider is not asked again", async () => {
      // arrange: `before` showed it
      assert.strictEqual(smartlog.resolves, 1);
      assert.ok(smartlog.view, 'no view resolved');
      assert.strictEqual(smartlog.view.viewType, SMARTLOG_VIEW.id);

      try {
        // act
        await showSmartlog(false);
        await showSmartlog(true);

        // assert
        assert.strictEqual(smartlog.resolves, 1);
      } finally {
        await showSmartlog(true);
      }
    });

    it('declares the view in the manifest word for word, its id the one SMARTLOG_VIEW spells, and names both views in the three view/title entries (plan §7.11; §7.1.1 title-bar actions)', () => {
      // arrange
      const extension = vscode.extensions.getExtension('local.vscode-pr-cascade');
      assert.ok(extension, 'the extension was not loaded');
      const manifest = extension.packageJSON as ViewsManifest;

      // assert: the Explorer entry as plan §7.11 writes it, plus the container's title after a
      // drag; and every title-bar entry naming the smartlog beside the tree
      assert.deepStrictEqual(manifest.contributes.views.explorer, [
        { type: 'webview', id: SMARTLOG_VIEW.id, name: 'Stack', icon: '$(layers)', contextualTitle: 'PR Cascade', visibility: 'visible' },
      ]);
      // … and every title-bar entry's `when` word for word — exact, never `includes`: `view ==
      // prCascade` is a prefix of `view == prCascade.smartlog`, so a substring check for the tree's
      // half would pass on an entry that names the smartlog alone; the key from the module the
      // listener writes through, as commands.test.ts spells it
      // see primer §43 (`Record<K, V>`) and §22 (for ... of over `Object.entries`)
      const bothViews = `view == prCascade || view == ${SMARTLOG_VIEW.id}`;
      const whens: Record<string, string> = {
        'prCascade.refresh': bothViews,
        'prCascade.pushStack': bothViews,
        'prCascade.trackStack': `(${bothViews}) && ${HAS_UNTRACKED_KEY}`,
      };
      for (const [command, when] of Object.entries(whens)) {
        const entry = manifest.contributes.menus['view/title'].find((candidate) => candidate.command === command);
        assert.strictEqual(entry?.when, when, `${command}'s view/title when`);
      }
    });

    it("wrote the §7.1.3 shell into the real view: webview.html is shellHtml over the real cspSource and the real asWebviewUri of the two files under dist/webview — https URIs on VS Code's resource host", () => {
      // arrange
      const view = smartlog.view;
      assert.ok(view, 'no view resolved');
      const { webview } = view;
      const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'smartlog.js')).toString();
      const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'codicon.css')).toString();

      // assert
      assert.strictEqual(webview.html, shellHtml({ cspSource: webview.cspSource, nonce: nonceOf(webview.html), scriptUri, styleUri }));
      assert.ok(scriptUri.startsWith('https://') && scriptUri.endsWith('/dist/webview/smartlog.js'), scriptUri);
      assert.ok(webview.cspSource.includes('vscode-cdn.net'), webview.cspSource);
    });

    it("carries the fixture's rows top-first, trunk last — retry-metrics, add-retries, api-refactor, origin/main — one repository, no notice, no active repository, a clean tree and a trunk nobody is behind", async () => {
      // arrange: a fresh load, so no earlier file's state is read
      const loaded = nextEvent(treeProvider.onDidLoadStates, 10_000);
      refresh();
      await loaded;

      // act
      const current = smartlog.current;

      // assert
      assert.ok(current, 'no model built');
      assert.strictEqual(current.type, 'model');
      assert.deepStrictEqual(current.notices, []);
      assert.strictEqual(current.activeRepo, null);
      assert.strictEqual(current.repos.length, 1);
      const [repo] = current.repos;
      assert.strictEqual(repo.repo, repositoryRoot());
      assert.deepStrictEqual(repo.messages, []);
      assert.deepStrictEqual(repo.rows.map(rowName), ['retry-metrics', 'add-retries', 'api-refactor', 'origin/main']);
      const [top] = repo.rows;
      assert.ok(top.kind === 'layer' && top.node === 'filled', 'the top layer is HEAD and should be filled');
      const trunk = repo.rows[repo.rows.length - 1];
      assert.ok(trunk.kind === 'trunk' && trunk.indicators.length === 0, 'the trunk row should carry no indicator');
    });

    it('raises seq by one on refresh() and delivers the post — postMessage resolves true for a view that has been showing (E79; not asserted on the first post after a show, which VS Code 1.85 never settles)', async () => {
      // arrange
      await showSmartlog(true);
      const before = smartlog.current?.seq ?? 0;
      const posted = nextEvent(smartlog.onDidPost, 10_000);

      // act
      refresh();
      const delivery = await posted;

      // assert
      assert.strictEqual(delivery.message.seq, before + 1);
      assert.strictEqual(smartlog.current, delivery.message);
      assert.strictEqual(await withDeadline(delivery.delivered, 10_000, 'the post'), true);
    });

    it("posts nothing while hidden — refresh() still loads and the current model moves on (D52's path) — and re-posts that model, the same object with the same seq, when shown again (E79)", async () => {
      try {
        // arrange: hidden, and a listener for anything posted meanwhile
        await showSmartlog(false);
        const postsWhileHidden: Delivery[] = [];
        const listening = smartlog.onDidPost((delivery) => postsWhileHidden.push(delivery));
        const loaded = nextEvent(treeProvider.onDidLoadStates, 10_000);

        // act: a load while hidden, then the show
        refresh();
        await loaded;
        listening.dispose();
        const current = smartlog.current;
        assert.ok(current, 'no model built');
        const posted = nextEvent(smartlog.onDidPost, 10_000);
        await showSmartlog(true);
        const delivery = await posted;

        // assert
        assert.deepStrictEqual(postsWhileHidden, []);
        assert.strictEqual(delivery.message, current);
      } finally {
        await showSmartlog(true);
      }
    });

    it("runs the registered command a `command` message names, with the message's arguments, when its seq is the current model's (E79)", async () => {
      // arrange: a command of ours, registered by the test, that records what it is called with
      const recorded: unknown[][] = [];
      const registration = vscode.commands.registerCommand('prCascade.__test.record', (...args: unknown[]) => {
        recorded.push(args);
      });
      try {
        const seq = smartlog.current?.seq ?? 0;

        // act
        const handled = await smartlog.handleMessage({ type: 'command', seq, command: 'prCascade.__test.record', args: [repositoryRoot(), 'add-retries'] });

        // assert
        assert.strictEqual(handled.kind, 'run');
        assert.deepStrictEqual(recorded, [[repositoryRoot(), 'add-retries']]);
      } finally {
        registration.dispose();
      }
    });

    it("drops a `command` whose seq is older than the current model's, and refuses one ahead of it — nothing runs (E79)", async () => {
      // arrange
      const recorded: unknown[][] = [];
      const registration = vscode.commands.registerCommand('prCascade.__test.record', (...args: unknown[]) => {
        recorded.push(args);
      });
      try {
        const seq = smartlog.current?.seq ?? 0;
        assert.ok(seq >= 1, 'at least one model has been built by now');

        // act
        const stale = await smartlog.handleMessage({ type: 'command', seq: seq - 1, command: 'prCascade.__test.record', args: [] });
        const ahead = await smartlog.handleMessage({ type: 'command', seq: seq + 1, command: 'prCascade.__test.record', args: [] });

        // assert
        assert.strictEqual(stale.kind, 'stale');
        assert.strictEqual(ahead.kind, 'rejected');
        assert.deepStrictEqual(recorded, []);
      } finally {
        registration.dispose();
      }
    });

    it("refuses a command id outside prCascade. — a test-registered zzTest.record is never run — and reports a prCascade. id nobody registered as failed, with VS Code's own \"not found\" and one error notification through the readiness host (E17 parity)", async () => {
      // arrange: a foreign command that would record if run, and a fake host in the seams
      const recorded: unknown[][] = [];
      const registration = vscode.commands.registerCommand('zzTest.record', (...args: unknown[]) => {
        recorded.push(args);
      });
      const host = fakeReadinessHost();
      const realHost = deps.host;
      deps.host = host;
      try {
        const seq = smartlog.current?.seq ?? 0;

        // act
        const foreign = await smartlog.handleMessage({ type: 'command', seq, command: 'zzTest.record', args: [] });
        const unknownId = await smartlog.handleMessage({ type: 'command', seq, command: 'prCascade.__test.nothing', args: [] });

        // assert
        assert.strictEqual(foreign.kind, 'rejected');
        assert.deepStrictEqual(recorded, []);
        const why = "prCascade.__test.nothing failed: command 'prCascade.__test.nothing' not found";
        assert.deepStrictEqual(unknownId, { kind: 'failed', command: 'prCascade.__test.nothing', why });
        assert.deepStrictEqual(host.asked, [{ severity: 'error', message: why, buttons: [] }]);
      } finally {
        deps.host = realHost;
        registration.dispose();
      }
    });

    it("draws a failed load as its one notice — no repository, no active repository, git's own words as a repositoryError in the repository git ran in — with seq up by one (E17)", async () => {
      // arrange: the unrunnable git of ext/tree's E17 cases; settings are read afresh per load, and
      // no listener of ours starts a load on a settings change, so the next load is refresh()'s own
      const configuration = vscode.workspace.getConfiguration('prCascade');
      await configuration.update('gitPath', '/nowhere/git', vscode.ConfigurationTarget.Workspace);
      try {
        const seqBefore = smartlog.current?.seq ?? 0;
        const loaded = nextEvent(treeProvider.onDidLoadStates, 10_000);

        // act
        refresh();
        await loaded;

        // assert: the whole message — the tree's notice is the smartlog's, and nothing else is drawn
        assert.deepStrictEqual(smartlog.current, {
          type: 'model',
          seq: seqBefore + 1,
          repos: [],
          activeRepo: null,
          notices: [
            {
              kind: 'repositoryError',
              repo: repositoryRoot(),
              text: 'git not found at /nowhere/git (while running: git symbolic-ref --quiet --short refs/remotes/origin/HEAD)',
              severity: 'error',
            },
          ],
        });
      } finally {
        await configuration.update('gitPath', undefined, vscode.ConfigurationTarget.Workspace);
        // A good model again for whoever runs next, the listener armed first.
        const restored = nextEvent(treeProvider.onDidLoadStates, 10_000);
        refresh();
        await restored;
      }
    });
  });
});
