/**
 * test/webview/host.test.ts — the view side of the protocol as a specification: the page's API is
 * acquired once; every model reaches the handler and nothing else does; a command is stamped with
 * the last model's `seq`, 0 before any (E79's view half); a message from another origin is not
 * the host's. happy-dom supplies `window` and `MessageEvent`; the fake API comes from
 * helpers/fakeVsCodeApi.ts.
 *
 * Layer: test, webview (plan §9.1 layer 1b; Vitest under happy-dom, no VS Code). Depends on:
 * src/webview/host.ts, src/webview/protocol.ts (types), helpers/fakeVsCodeApi.ts. Plan: §7.1.3
 * "Protocol", §8 E79, §10.1 item 23c.
 */
// see primer §1 (import / export) and §9 (`import type`)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect } from '../../src/webview/host';
import type { ModelMessage } from '../../src/webview/protocol';
import { installFakeVsCodeApi, postFromHost, type FakeVsCodeApi } from './helpers/fakeVsCodeApi';

/** A model with nothing in it but its `seq`: the bridge reads the tag, the number and the array, nothing else. */
function model(seq: number): ModelMessage {
  return { type: 'model', seq, repos: [], activeRepo: null, notices: [] };
}

describe('connect', () => {
  let api: FakeVsCodeApi;
  beforeEach(() => {
    // arrange, for every test: a fresh fake on the page
    api = installFakeVsCodeApi();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('acquires the VS Code API exactly once', () => {
    // act
    connect();

    // assert
    expect(api.acquired).toBe(1);
  });

  it('hands every model message to the handler, in order', () => {
    // arrange
    const seen: ModelMessage[] = [];
    connect().onModel((message) => seen.push(message));

    // act
    postFromHost(model(1));
    postFromHost(model(2));

    // assert
    expect(seen).toEqual([model(1), model(2)]);
  });

  it('ignores a message of another type, no data, a string, null, a model without a seq or repos, and one whose repos is not an array', () => {
    // arrange
    const seen: ModelMessage[] = [];
    connect().onModel((message) => seen.push(message));

    // act: each post is refused by one clause of the check — the tag (with seq and repos present),
    // the shape, the seq's type, the repos' presence and type
    postFromHost({ type: 'files', seq: 1, repos: [] });
    postFromHost(undefined);
    postFromHost('model');
    postFromHost(null);
    postFromHost({ type: 'model' });
    postFromHost({ type: 'model', seq: '2', repos: [] });
    postFromHost({ type: 'model', seq: 2, repos: 'none' });

    // assert
    expect(seen).toEqual([]);
  });

  it('posts a command with seq 0 before any model has arrived', () => {
    // act
    connect().postCommand('prCascade.refresh', []);

    // assert
    expect(api.posted).toStrictEqual([{ type: 'command', seq: 0, command: 'prCascade.refresh', args: [] }]);
  });

  it("stamps the last model's seq on a command, with the args as given", () => {
    // arrange
    const host = connect();
    host.onModel(() => undefined);
    postFromHost(model(3));
    postFromHost(model(7));

    // act
    host.postCommand('prCascade.openDiff', ['/work/app', 'feature']);

    // assert
    expect(api.posted).toStrictEqual([
      { type: 'command', seq: 7, command: 'prCascade.openDiff', args: ['/work/app', 'feature'] },
    ]);
  });

  it('does not count a message it did not recognise towards seq', () => {
    // arrange: a model, then a foreign type with every field a model has, then a model with no repos
    const host = connect();
    host.onModel(() => undefined);
    postFromHost(model(4));
    postFromHost({ type: 'focus', seq: 9, repos: [] });
    postFromHost({ type: 'model', seq: 10 });

    // act
    host.postCommand('prCascade.refresh', []);

    // assert
    expect(api.posted).toStrictEqual([{ type: 'command', seq: 4, command: 'prCascade.refresh', args: [] }]);
  });

  it("ignores a model posted from another origin: only the page's own carries the host's messages", () => {
    // arrange
    const seen: ModelMessage[] = [];
    const host = connect();
    host.onModel((message) => seen.push(message));

    // act: a well-formed model, but not from where VS Code's bootstrap posts
    postFromHost(model(5), 'https://other.example');
    host.postCommand('prCascade.refresh', []);

    // assert: not delivered, not counted
    expect(seen).toEqual([]);
    expect(api.posted).toStrictEqual([{ type: 'command', seq: 0, command: 'prCascade.refresh', args: [] }]);
  });
});
