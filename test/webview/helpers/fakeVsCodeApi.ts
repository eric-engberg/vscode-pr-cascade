/**
 * test/webview/helpers/fakeVsCodeApi.ts — a fake `acquireVsCodeApi` on the page, and the host's
 * `postMessage` as the page sees it, for every renderer test (items 23c–23i). `installFakeVsCodeApi`
 * puts the function on the page's globals the way VS Code's bootstrap does (`vi.stubGlobal`; pair it
 * with `vi.unstubAllGlobals()` in `afterEach`) and records what the view posts; a second acquire
 * throws, as VS Code's does (pre/index.html: "An instance of the VS Code API has already been
 * acquired" — a fact for 23d's extension-host run to confirm, modelled here, not tested).
 * `postFromHost` is what `webview.postMessage(message)` becomes on the page: a `message` event on
 * `window` carrying `data`.
 *
 * Layer: test, webview (plan §9.1 layer 1b). Depends on: src/webview/host.ts (the `VsCodeApi` type).
 */
import { vi } from 'vitest';
import type { VsCodeApi } from '../../../src/webview/host';

export interface FakeVsCodeApi extends VsCodeApi {
  /** Every message the view posted, in order — what the host would receive. */
  readonly posted: unknown[];
  /** How many times the page called `acquireVsCodeApi()`. */
  acquired: number;
}

/** Puts `acquireVsCodeApi` on the page; the second call throws, as VS Code's does. */
// see primer §65 (`vi.stubGlobal`: a fake global for one test, undone by `vi.unstubAllGlobals`)
export function installFakeVsCodeApi(): FakeVsCodeApi {
  const posted: unknown[] = [];
  const api: FakeVsCodeApi = {
    posted,
    acquired: 0,
    postMessage(message) {
      posted.push(message);
    },
  };
  vi.stubGlobal('acquireVsCodeApi', () => {
    api.acquired += 1;
    if (api.acquired > 1) {
      throw new Error('An instance of the VS Code API has already been acquired');
    }
    return api;
  });
  return api;
}

/** What the host's `webview.postMessage(message)` becomes on the page: a `message` event on `window`. */
export function postFromHost(message: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
}
