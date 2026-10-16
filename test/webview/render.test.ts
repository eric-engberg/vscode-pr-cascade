/**
 * test/webview/render.test.ts — the plain-text renderer as a specification: one line per notice,
 * repository, message row and row, in the model's order; nothing kept between models; text never
 * markup. The first test file that draws into `document`, and the pattern the rail's tests inherit
 * in 23e: a root mounted per test on a reset body, the helpers/models.ts builders, assertions on
 * `textContent`.
 *
 * Layer: test, webview (plan §9.1 layer 1b; Vitest under happy-dom). Depends on:
 * src/webview/smartlog/render.ts, helpers/models.ts. Plan: §7.1.3 "Security", §10.1 items 23c and 23d.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '../../src/webview/smartlog/render';
import { elided, layer, message, model, REPO, trunk, workingTree } from './helpers/models';

/** The text of each line under `root`, top to bottom. */
// see primer §25 (`Array.from(list, fn)`: an array from a DOM collection, mapped in one step)
const linesOf = (root: HTMLElement): (string | null)[] => Array.from(root.children, (line) => line.textContent);

describe('render', () => {
  let root: HTMLElement;
  beforeEach(() => {
    // The document is shared by every test in the file: start each with an empty body and a root of its own.
    document.body.replaceChildren();
    root = document.createElement('main');
    document.body.append(root);
  });

  it("writes one line per row in the model's order — node, name, the indicator kinds, the age", () => {
    const rows = [
      layer('retry-metrics'),
      workingTree('api-refactor', 2),
      layer('api-refactor', { node: 'filled', indicators: [{ kind: 'untracked' }, { kind: 'neverPushed' }] }),
      elided,
      trunk,
    ];

    render(root, message([model(rows)]));

    expect(linesOf(root)).toEqual([
      '○ retry-metrics 3m',
      '◌ Uncommitted changes dirty now',
      '● api-refactor untracked neverPushed 3m',
      '┆',
      '○ origin/main 26h',
    ]);
  });

  it("puts the host's notices first, then a repository's message rows, then its rows", () => {
    const repo = model([trunk], { messages: [{ kind: 'detachedHead', text: 'Detached HEAD', severity: 'information' }] });
    const notices = [{ kind: 'gitNotFound' as const, repo: null, text: 'Git was not found', severity: 'error' as const }];

    render(root, message([repo], { notices }));

    expect(linesOf(root)).toEqual(['error: Git was not found', 'information: Detached HEAD', '○ origin/main 26h']);
  });

  it('names a repository above its rows only when there are several', () => {
    render(root, message([model([trunk]), model([trunk], { repo: '/work/lib' })]));

    expect(linesOf(root)).toEqual([REPO, '○ origin/main 26h', '/work/lib', '○ origin/main 26h']);
  });

  it('replaces what it drew before: nothing survives from one model to the next', () => {
    render(root, message([model([layer('a'), layer('b'), trunk])]));

    render(root, message([model([trunk])]));

    expect(linesOf(root)).toEqual(['○ origin/main 26h']);
  });

  it('writes a name as text, never as markup (a pin against a future innerHTML)', () => {
    render(root, message([model([layer('<b>bold</b>')])]));

    expect(root.querySelector('b')).toBeNull();
    expect(linesOf(root)).toEqual(['○ <b>bold</b> 3m']);
  });
});
