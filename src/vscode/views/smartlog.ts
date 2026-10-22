/**
 * vscode/views/smartlog.ts — the smartlog view's spec (plan §7.1.1, §7.11): its id, the one string
 * `package.json`'s `contributes.views.explorer` entry and the three `view/title` `when` clauses must
 * spell, and the bundle it loads. One module both sides read, as vscode/contextKeys.ts is for the
 * keys — a view id cannot be read back from VS Code, so the manifest test compares against this.
 * Item 23i adds the graph view's spec beside it (its own file, `graph.ts`); items 23e–23h put
 * the smartlog's other constants here.
 *
 * Layer: vscode adapter (plan §4.1). Depends on: vscode/views/base.ts (`ViewSpec`, a type).
 * Depended on by: src/extension.ts (the provider's spec and its registration), test/ext/views.test.ts.
 * Plan: §7.1.1, §7.11, §10.1 item 23d (M6), §13.2 D70.
 */

// see primer §9 (`import type`) and §36 (export const: a shared constant object)
import type { ViewSpec } from './base';

/** The smartlog: `prCascade.smartlog` in the Explorer, drawn by dist/webview/smartlog.js. */
export const SMARTLOG_VIEW: ViewSpec = { id: 'prCascade.smartlog', bundle: 'smartlog' };
