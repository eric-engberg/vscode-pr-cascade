/**
 * test/ext/webviewFacts.test.ts — what VS Code's webview does, as facts the smartlog relies on,
 * measured in the real VS Code with the real `dist/webview/smartlog.js` and `codicon.css` under the
 * production shell and its Content Security Policy (plan §7.1.3 "Theme": "23d's extension-host run
 * verifies it"). A view's own page cannot be read from the extension host, so the page is loaded
 * into a `createWebviewPanel` — a panel shares the overlay, the element, the bootstrap and
 * `cspSource` with a view — with one scaffold: a probe `<script>` with the shell's nonce, placed
 * before the stylesheet, which acquires the API once, records what a second acquire does, then
 * puts a shim in the global's place handing the bundle the same frozen object — legal because the
 * bootstrap defines `acquireVsCodeApi` by plain assignment (pre/index.html at 1.85.0 and in the
 * installed VS Code) — and answers the host's `facts?` with what it saw. Beside
 * test/git/gitspiceFacts.git.test.ts and test/git/gh.git.test.ts: what the tool does, pinned.
 *
 * Layer: test, extension host (plan §9.1 layer 3; Mocha inside VS Code, `npm run test:ext`).
 * Depends on: the running extension (its `extensionUri`, for dist/webview/), src/vscode/views/shell.ts,
 * test/webview/helpers/models.ts (the rows the bundle draws), `dist/webview/*` (built by `npm run
 * test:ext`'s build step). Depended on by: nothing. Plan: §7.1.3 "Protocol", "Theme" and "Security",
 * §8 E79, §9.4 `ext/webviewFacts`, §10.1 item 23d (M6), §13.2 D70.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as assert from 'node:assert';
import { after, before, describe, it } from 'mocha';
import * as vscode from 'vscode';
import { newNonce, shellHtml } from '../../src/vscode/views/shell';
import { layer, message, model, trunk } from '../webview/helpers/models';

/**
 * What the page reports back, in the order the probe collects it: the API's shape and the second
 * acquire; the origin of the host's posts; which models arrived, and the rows the real bundle had
 * drawn right after each; the rows at the end; the bootstrap's own styling under our policy; the
 * codicon font; every policy violation the page saw.
 */
// see primer §9 (interface) and §14 (readonly arrays — an array of arrays for `drawn`)
interface Facts {
  readonly type: 'facts';
  readonly secondAcquire: string;
  readonly members: readonly string[];
  readonly frozen: boolean;
  readonly originSame: boolean | null;
  readonly modelsSeen: readonly number[];
  readonly drawn: readonly (readonly string[])[];
  readonly bodyLines: readonly string[];
  readonly fontFamily: string;
  readonly themeClass: string;
  readonly codicon: readonly string[];
  readonly violations: readonly string[];
}

/**
 * The probe, as plain JavaScript in a string: it runs in the page, where there is no TypeScript
 * and no import. Everything it reads is named in `Facts` above. `securitypolicyviolation` is the
 * browser's event for a resource the policy refused — the primary witness for the font; the
 * `fonts.load` call is the second, in a `try` since a refused font may reject it.
 */
// see primer §12 (a template string over several lines, nothing interpolated)
const PROBE = `
const violations = [];
document.addEventListener('securitypolicyviolation', (event) => {
  violations.push(event.violatedDirective + ' ' + event.blockedURI);
});
const api = acquireVsCodeApi();
const members = Object.keys(api).sort();
const frozen = Object.isFrozen(api);
let secondAcquire = 'did not throw';
try {
  acquireVsCodeApi();
} catch (error) {
  secondAcquire = error.message;
}
globalThis.acquireVsCodeApi = () => api;
const modelsSeen = [];
const drawn = [];
let originSame = null;
const lines = () => Array.from(document.body.children)
  .filter((element) => element.tagName === 'DIV')
  .map((element) => element.textContent);
window.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'model') {
    modelsSeen.push(data.seq);
    originSame = event.origin === globalThis.location.origin;
    // a timeout, not a microtask: the bundle's listener, registered after this one, runs later in
    // the same dispatch and draws synchronously (render.ts), and a 0 ms timer fires after the whole
    // dispatch — so this reads what the bundle drew for this very model
    setTimeout(() => drawn.push(lines()), 0);
  }
  if (data && data.type === 'facts?') {
    setTimeout(async () => {
      const bodyLines = lines();
      const fontFamily = getComputedStyle(document.body).fontFamily;
      const themeClass = document.body.className;
      let codicon;
      try {
        codicon = (await document.fonts.load('16px codicon')).map((face) => face.status);
      } catch (error) {
        codicon = ['rejected: ' + error.message];
      }
      api.postMessage({ type: 'facts', secondAcquire, members, frozen, originSame, modelsSeen, drawn, bodyLines, fontFamily, themeClass, codicon, violations });
    }, 0);
  }
});
window.addEventListener('load', () => api.postMessage({ type: 'probe-ready' }));
`;

// The two models the host posts: the first right after the html is set — queued behind a page
// still loading — the second once the probe has said the page is up. Hand-written literals from the
// renderer tests' helpers; their `notices` and `messages` are empty, so every line the bundle draws
// is a row's.
const FIRST = message([model([layer('retry-metrics', { node: 'filled' }), trunk])], { seq: 1 });
const SECOND = message([model([layer('retry-metrics', { node: 'filled' }), layer('add-retries'), trunk])], { seq: 2 });

/** What render.ts prints for FIRST's two rows: the node glyph (filled for HEAD's layer, hollow for trunk), the name, no indicator, the age. */
const FIRST_LINES = ['● retry-metrics 3m', '○ origin/main 26h'];
/** The same for SECOND's three rows. */
const SECOND_LINES = ['● retry-metrics 3m', '○ add-retries 3m', '○ origin/main 26h'];

/**
 * `thenable`'s value within `deadlineMs`, or a rejection naming `what`: for a Thenable VS Code may
 * never settle — a `postMessage` queued behind a page still loading, at 1.85.0 (vscode/views/base.ts).
 */
// see primer §60 (`Thenable`), §62 (a type parameter on a function) and §63 (`.then` with both continuations)
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

/** `thenable`'s value, or the word `timeout` after `deadlineMs` — for a value that may legitimately never come. */
// see primer §37 (`Promise.race`: whichever settles first) and §15 (new Promise)
function settledOr<T>(thenable: Thenable<T>, deadlineMs: number): Promise<T | 'timeout'> {
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), deadlineMs));
  return Promise.race([Promise.resolve(thenable), timeout]);
}

let panel: vscode.WebviewPanel;
let report: Facts;
/** VS Code's answer for the second post — into a page that is up. */
let secondDelivered: boolean;
/** VS Code's answer for the first post — queued behind the loading page: `true` where the queue resolves its promises, `timeout` where it never does (1.85.0). */
let earlySettled: boolean | 'timeout';

// see primer §5 (arrow functions) and §6 (async / await)
describe('the webview page inside the real VS Code — facts the smartlog relies on (plan §7.1.3 Theme: "23d\'s extension-host run verifies it")', () => {
  before(async () => {
    const extension = vscode.extensions.getExtension('local.vscode-pr-cascade');
    assert.ok(extension, 'the extension was not loaded');
    const distUri = vscode.Uri.joinPath(extension.extensionUri, 'dist', 'webview');
    // A panel rather than the view: the page is the same bootstrap over the same files, and this
    // one is ours to load with a probe in it. `preserveFocus` keeps the editor focus where it was.
    // see primer §35 (enum values from the VS Code API: ViewColumn) and §88 (`createWebviewPanel` as the view's twin)
    panel = vscode.window.createWebviewPanel('prCascade.facts', 'PR Cascade facts', { viewColumn: vscode.ViewColumn.One, preserveFocus: true }, {
      enableScripts: true,
      localResourceRoots: [distUri],
    });
    const { webview } = panel;
    const nonce = newNonce();
    // The production shell, word for word, with the probe before the stylesheet — carrying the one
    // nonce, as the policy requires of every script on the page.
    const shell = shellHtml({
      cspSource: webview.cspSource,
      nonce,
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'smartlog.js')).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'codicon.css')).toString(),
    });
    const html = shell.replace('<link rel="stylesheet"', `<script nonce="${nonce}">${PROBE}</script>\n<link rel="stylesheet"`);
    assert.strictEqual(html.split('<link').length - 1, 1, 'one stylesheet');
    assert.strictEqual(html.split('<script').length - 1, 2, 'the probe and the bundle');

    // The page's two answers, armed before the html is set so neither can be missed.
    // see primer §15 (new Promise: resolve kept for later), §51 (the shape of a value the page sent) and §50 (`as Facts`: an assertion that checks nothing past the `type` the `in` check saw — every field is asserted on below)
    let probeReady: () => void = () => undefined;
    let factsArrived: (facts: Facts) => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      probeReady = resolve;
    });
    const facts = new Promise<Facts>((resolve) => {
      factsArrived = resolve;
    });
    webview.onDidReceiveMessage((data: unknown) => {
      if (typeof data === 'object' && data !== null && 'type' in data) {
        if (data.type === 'probe-ready') {
          probeReady();
        }
        if (data.type === 'facts') {
          factsArrived(data as Facts);
        }
      }
    });

    // act, in the order the smartlog does it: the html, a post at once, then the rest once up
    webview.html = html;
    const early = settledOr(webview.postMessage(FIRST), 3_000);
    await withDeadline(ready, 10_000, "the probe's ready");
    secondDelivered = await withDeadline(webview.postMessage(SECOND), 10_000, 'the second post');
    await withDeadline(webview.postMessage({ type: 'facts?' }), 10_000, 'the question');
    report = await withDeadline(facts, 10_000, 'the facts');
    earlySettled = await early;
  });

  after(() => {
    panel.dispose();
  });

  it("throws on the second acquireVsCodeApi() with VS Code's own sentence, and the one object is frozen with getState, postMessage and setState — host.ts's \"called once per page\" is a fact", () => {
    // assert
    assert.strictEqual(report.secondAcquire, 'An instance of the VS Code API has already been acquired');
    assert.strictEqual(report.frozen, true);
    assert.deepStrictEqual(report.members, ['getState', 'postMessage', 'setState']);
  });

  it("delivers the host's messages from the page's own origin — the check host.ts makes holds in the real bootstrap", () => {
    // assert: at least one model arrived to set it, and it held
    assert.strictEqual(report.originSame, true);
  });

  it('loads the codicon font the stylesheet names by a relative URL under font-src ${cspSource}, with no policy violation anywhere on the page — the one place that directive is exercised until 23e draws a glyph (plan §7.1.3 Theme)', () => {
    // assert: the browser refused nothing, and the font face loaded
    assert.deepStrictEqual(report.violations, []);
    assert.deepStrictEqual(report.codicon, ['loaded']);
  });

  it("keeps VS Code's own styles and theme class under our policy: the body's font family is set and its class names the theme — the bootstrap puts its style before our meta", () => {
    // assert
    assert.notStrictEqual(report.fontFamily, '');
    // see primer §20 (regular expression literals)
    assert.match(report.themeClass, /vscode-(light|dark|high-contrast)/);
  });

  it('draws the model posted right after the html was set — queued while the page loaded, then delivered — and the second one, with the real bundle: one line per row after each, the first naming retry-metrics', () => {
    // assert: both arrived, in order, and both were drawn — the queued one by a bundle whose
    // listener was already attached when the bootstrap relayed it (the content frame's load, or
    // its 200 ms timer, whichever comes first), then replaced by the second; the lines at the end
    // are the second model's rows and nothing else (the literals' notices and messages are empty).
    // `drawn[0]` equal to `[]` would mean the bootstrap flushed the queued post before smartlog.js
    // had run — base.ts's resolve-time post lost on a slow bundle load, a product finding (the view
    // would need a page-side ready handshake), not a flaky test.
    assert.deepStrictEqual(report.modelsSeen, [1, 2]);
    assert.deepStrictEqual(report.drawn, [FIRST_LINES, SECOND_LINES]);
    assert.deepStrictEqual(report.bodyLines, SECOND_LINES);
  });

  it('answers true for a post into a page that is up, and records how the first, queued post settled: true where VS Code resolves its queue, never at 1.85.0 — either, written down', () => {
    // assert: the one answer src relies on, and the one it must not (vscode/views/base.ts never awaits a post)
    assert.strictEqual(secondDelivered, true);
    assert.ok(earlySettled === true || earlySettled === 'timeout', `the early post settled ${String(earlySettled)}`);
    // The measured value, for plan §13.4's bullet: read it in the run's output.
    console.log(`webviewFacts: the post queued behind the loading page settled: ${String(earlySettled)}`);
  });
});
