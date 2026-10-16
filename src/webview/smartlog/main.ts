/**
 * webview/smartlog/main.ts — the entry of the smartlog view's bundle (esbuild.mjs →
 * dist/webview/smartlog.js), the one script item 23d's HTML shell loads into the view. It
 * connects to the host and draws every model it posts — as plain text until item 23e draws
 * §7.1.1's rail; `document.body` is the root until 23d's shell names one. The only module here
 * with a top-level side effect, so no test file of its own: the bundle test sees it
 * (`acquireVsCodeApi()` in the IIFE) and 23d's `ext/views` runs the real page.
 *
 * Layer: webview (plan §4.1). Depends on: ../host.ts, ./render.ts. Depended on by: esbuild.mjs
 * (as an entry). Plan: §7.1.3, §9.2, §10.1 item 23c.
 */
// see primer §1 (import / export)
import { connect } from '../host';
import { render } from './render';

connect().onModel((message) => render(document.body, message));
