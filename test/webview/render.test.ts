/**
 * test/webview/render.test.ts — the plain-text renderer as a specification: one line per notice,
 * repository, message row and row, in the model's order; nothing kept between models; text never
 * markup. The first test file that draws into `document`, and the pattern the rail's tests inherit
 * in 23e: a root mounted per test on a reset body, the helpers/models.ts builders, assertions on
 * `textContent`.
 *
 * Layer: test, webview (plan §9.1 layer 1b; Vitest under happy-dom). Depends on:
 * src/webview/smartlog/render.ts, src/webview/protocol.ts (a type), helpers/models.ts. Plan: §7.1.3
 * "Security", §10.1 items 23c and 23d.
 */
// see primer §1 (import / export) and §9 (`import type`)
import { beforeEach, describe, expect, it } from 'vitest';
import type { HostNotice } from '../../src/webview/protocol';
import { render } from '../../src/webview/smartlog/render';
import { elided, layer, message, model, REPO, trunk, workingTree } from './helpers/models';

/** The text of each line under `root`, top to bottom. */
// see primer §25 (`Array.from(list, fn)`: an array from a DOM collection, mapped in one step)
const linesOf = (root: HTMLElement): (string | null)[] => Array.from(root.children, (line) => line.textContent);

/** The one notice two tests post: typed as the protocol's, so the literal's strings stay the union's members. */
const gitNotFound: HostNotice[] = [{ kind: 'gitNotFound', repo: null, text: 'Git was not found', severity: 'error' }];

describe('render', () => {
  let root: HTMLElement;
  beforeEach(() => {
    // arrange, for every test: the document is shared by the file, so start each with an empty
    // body and a root of its own
    document.body.replaceChildren();
    root = document.createElement('main');
    document.body.append(root);
  });

  it("writes one line per row in the model's order — node, name, the indicator kinds, the age — each line a <div>", () => {
    // arrange
    const rows = [
      layer('retry-metrics'),
      workingTree('api-refactor', 2),
      layer('api-refactor', { node: 'filled', indicators: [{ kind: 'untracked' }, { kind: 'neverPushed' }] }),
      elided,
      trunk,
    ];

    // act
    render(root, message([model(rows)]));

    // assert: the texts, and the element each is in — a <div> is a block, so the rows break without
    // a stylesheet; a <span> would run them together on one line
    expect(linesOf(root)).toEqual([
      '○ retry-metrics 3m',
      '◌ Uncommitted changes dirty now',
      '● api-refactor untracked neverPushed 3m',
      '┆',
      '○ origin/main 26h',
    ]);
    expect(Array.from(root.children, (line) => line.tagName)).toEqual(['DIV', 'DIV', 'DIV', 'DIV', 'DIV']);
  });

  it("puts the host's notices first, then a repository's message rows, then its rows", () => {
    // arrange
    const repo = model([trunk], { messages: [{ kind: 'detachedHead', text: 'Detached HEAD', severity: 'information' }] });

    // act
    render(root, message([repo], { notices: gitNotFound }));

    // assert
    expect(linesOf(root)).toEqual(['error: Git was not found', 'information: Detached HEAD', '○ origin/main 26h']);
  });

  it("names a repository above its rows only when there are several, with the host's notices once before them all", () => {
    // act
    render(root, message([model([trunk]), model([trunk], { repo: '/work/lib' })], { notices: gitNotFound }));

    // assert
    expect(linesOf(root)).toEqual(['error: Git was not found', REPO, '○ origin/main 26h', '/work/lib', '○ origin/main 26h']);
  });

  it('replaces what it drew before: nothing survives from one model to the next', () => {
    // arrange
    render(root, message([model([layer('a'), layer('b'), trunk])]));

    // act
    render(root, message([model([trunk])]));

    // assert
    expect(linesOf(root)).toEqual(['○ origin/main 26h']);
  });

  it('writes a name as text, never as markup (a pin against a future innerHTML)', () => {
    // act
    render(root, message([model([layer('<b>bold</b>')])]));

    // assert: no element was made from the name, and the text came through whole
    // see primer §87 (`querySelector`: a CSS selector over the subtree, `null` when nothing matches)
    expect(root.querySelector('b')).toBeNull();
    expect(linesOf(root)).toEqual(['○ <b>bold</b> 3m']);
  });
});
