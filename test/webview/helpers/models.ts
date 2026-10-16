/**
 * test/webview/helpers/models.ts — hand-written view-model rows and messages for renderer tests:
 * `layer(name, overrides)`, the `trunk` row, `workingTree(parent, files)`, the `elided` row,
 * `model(rows, overrides)` and `message(repos, overrides)`, so a test spells only the field it is
 * about. Literals rather than `buildStackViewModel` over 23b's texts: a renderer test is about
 * drawing a model, not building one, and a literal with one indicator reads as the specification
 * it is. Item 23e adds what the rail needs (lanes, `joinsLane`, pane B's fourteen rows).
 *
 * Layer: test, webview (plan §9.1 layer 1b). Depends on: src/core/viewmodel.ts, src/webview/protocol.ts (types).
 * Depended on by: test/webview/render.test.ts; 23e's rail tests inherit it.
 */
// see primer §1 (import / export) and §9 (`import type`)
import type {
  ElidedViewRow,
  LayerViewRow,
  StackViewModel,
  TrunkViewRow,
  ViewRow,
  WorkingTreeViewRow,
} from '../../../src/core/viewmodel';
import type { ModelMessage } from '../../../src/webview/protocol';

export const REPO = '/work/app';
const SHA_A = 'a'.repeat(40);
const SHA_T = '0'.repeat(40);

/** A tracked, clean, hollow layer on trunk, `3m` old; `over` replaces any field (primer §49, §16). */
export function layer(name: string, over: Partial<LayerViewRow> = {}): LayerViewRow {
  return {
    kind: 'layer',
    name,
    sha: SHA_A,
    parent: 'origin/main',
    parentSha: SHA_T,
    forks: [],
    lane: 0,
    node: 'hollow',
    indicators: [],
    age: '3m',
    dim: false,
    tooltip: [],
    context: {
      webviewSection: 'layer',
      repo: REPO,
      layer: name,
      isCurrent: false,
      isTracked: true,
      isUntracked: false,
      isTrunkLine: false,
      hasPR: false,
      isDraft: false,
    },
    ...over,
  };
}

export const trunk: TrunkViewRow = {
  kind: 'trunk',
  name: 'origin/main',
  sha: SHA_T,
  lane: 0,
  node: 'hollow',
  indicators: [],
  age: '26h',
  tooltip: [],
  context: { webviewSection: 'trunk', repo: REPO, trunk: 'origin/main', isCurrent: false },
};

/** The uncommitted-changes row above `parent`, with `files` changed. */
export function workingTree(parent: string, files: number): WorkingTreeViewRow {
  return {
    kind: 'workingTree',
    parent,
    lane: 0,
    node: 'dashed',
    indicators: [{ kind: 'dirty', files }],
    age: 'now',
    tooltip: [`${files} files changed on ${parent}`],
    context: { webviewSection: 'workingTree', repo: REPO, layer: parent },
  };
}

export const elided: ElidedViewRow = { kind: 'elided', lane: 0 };

export function model(rows: readonly ViewRow[], over: Partial<StackViewModel> = {}): StackViewModel {
  return { repo: REPO, rows, lanes: 1, messages: [], ...over };
}

export function message(repos: readonly StackViewModel[], over: Partial<ModelMessage> = {}): ModelMessage {
  return { type: 'model', seq: 1, repos, activeRepo: null, notices: [], ...over };
}
