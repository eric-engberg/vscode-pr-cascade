/**
 * webview/protocol.ts — the messages between the extension host and the two views (plan §7.1.3
 * "Protocol", E79): the model one way, a command or a drop the other. Types only — no code runs
 * from here, so the browser bundles carry nothing of the host's and the host nothing of the
 * views'; `import type` from core is what §4.1 allows this folder, and the lint rule that refuses
 * anything else in `src/webview/` is eslint.config.mjs's second layering block (item 23c, D69), with
 * tsconfig.webview.json as the compiler's half.
 *
 * The rules around the messages are the host's (item 23d), written here so both sides read them
 * in one place: every model the host posts carries a rising `seq`, and a message from a view whose
 * `seq` is older than the last model's is dropped — a click on a row that no longer exists; a
 * `command` must start with `prCascade.` (the type says so for what a view sends; the host checks
 * the text it receives, which is data) and is run as the registered command with its string
 * arguments, nothing else the view sends is evaluated; for every command that acts in a
 * repository the first argument is the repository root (`StackViewModel.repo`) and the second the
 * branch or ref (a layer or trunk row's `name`); the host keeps the last `repos` it posted so a `webview/context`
 * command can look its row up by `repo` and `layer`; a hidden view gets the current model when it
 * becomes visible; one model object goes to both views (E81). A `webview/context` menu is not a
 * message: VS Code hands the row's `data-vscode-context` to the command itself (core/viewmodel.ts
 * `LayerContext`). `HostMessage` and `ViewMessage` are unions so items 23g (the lower panel's
 * files and the focused row) and later can add members without changing a field.
 *
 * Layer: webview (plan §4.1: no `vscode`, no Node built-ins; types from core only). Depends on:
 * core/viewmodel.ts (`StackViewModel`, a type). Depended on by: src/webview/host.ts (item 23c, the three
 * message types) and src/webview/smartlog/render.ts (item 23c's plain-text rows, rewritten in place by
 * 23e), src/vscode/views/base.ts (item 23d), the graph renderer (item 23i), test/webview/host.test.ts,
 * test/webview/helpers/models.ts. Plan: §4.1, §4.2, §7.1.3, §7.2.1 (drag and drop), §7.14.3
 * (the host's notices), §8 E17/E77/E79/E81/E82, §10.1 item 23b (M6), §13.2 D68. Pending item 5
 * (several repositories in one window) decides how `repos` and `activeRepo` are shown; this file
 * only carries them.
 */

// see primer §1 (import / export) and §9 (`import type`: erased when compiled, so nothing of core/ is bundled by it)
import type { StackViewModel } from '../core/viewmodel';

/**
 * A row that belongs to no repository's model: the view has nothing else to draw (plan §6's "No
 * git repository in this workspace"; §7.14.3's four Git-extension states, "one message row in an
 * otherwise empty view") or one repository's whole load failed (E17 — git could not be run, with
 * git's own words; vscode/tree.ts's error row today). The texts are the host's — §7.14.3's table
 * is their single source — and item 23d fills them; a renderer draws them as it draws a
 * core/viewmodel.ts `MessageRow`, above every repository (`repo` null) or in that repository's
 * place.
 */
// see primer §9 (interface), §10 (union types: exact strings as members, `string | null`) and §14 (readonly)
export interface HostNotice {
  readonly kind: 'noRepository' | 'gitExtensionDisabled' | 'gitExtensionFailed' | 'gitDisabled' | 'gitNotFound' | 'repositoryError';
  /** The repository root for `repositoryError`; `null` for the states that belong to the window. */
  readonly repo: string | null;
  readonly text: string;
  readonly severity: 'warning' | 'error' | 'information';
}

/**
 * Host → view, on every refresh and whenever the view becomes visible: one model per repository
 * in workspace order (one element for one repository; pending item 5's arrangement for several),
 * which repository is active — the one the host wants shown or expanded (the active editor's,
 * item 5) — or `null` when none is, and the notices for what has no model. `seq` rises by one per post.
 */
// see primer §14 (readonly arrays)
export interface ModelMessage {
  readonly type: 'model';
  readonly seq: number;
  readonly repos: readonly StackViewModel[];
  readonly activeRepo: string | null;
  readonly notices: readonly HostNotice[];
}

/**
 * A command id of ours: every string that starts with `prCascade.` and nothing else (E79's prefix
 * rule as a type — primer §83), so a renderer that posts another extension's command fails
 * `npm run typecheck`. What arrives at the host is data and is checked again there.
 */
// see primer §83 (a template literal type)
export type CommandId = `prCascade.${string}`;

/**
 * View → host: run a registered command — everything a click or a key does in a view (§7.1.3:
 * "the webview has no logic of its own"). `args` are strings only — the repository root first,
 * then a branch name or a path — in the order the command takes them. `seq` is the `seq` of the
 * model the view was showing when the user acted.
 */
export interface CommandMessage {
  readonly type: 'command';
  readonly seq: number;
  readonly command: CommandId;
  readonly args: readonly string[];
}

/**
 * View → host: a layer row was dropped on a layer row or the trunk row (E77; §7.2.1 "Drag and
 * drop"). `layer` is the dragged branch, `target` the branch or trunk ref it landed on — the
 * target row's `name` as the model spells it (`origin/main` for the trunk row; M9's `moveOnto`
 * maps it to git-spice's trunk) — both in `repo`: a drop across repositories is refused in the view
 * (no target) and again here. The confirmation, the other refusals and `moveOnto` itself are the
 * host's (item 23h, M9).
 */
export interface MoveOntoMessage {
  readonly type: 'moveOnto';
  readonly seq: number;
  readonly repo: string;
  readonly layer: string;
  readonly target: string;
}

/** Everything the host sends — a union of one member today; item 23g adds the lower panel's messages. */
export type HostMessage = ModelMessage;

/** Everything a view sends; item 23g adds the focused row here. */
// see primer §59 (tagged unions: told apart by `type`)
export type ViewMessage = CommandMessage | MoveOntoMessage;
