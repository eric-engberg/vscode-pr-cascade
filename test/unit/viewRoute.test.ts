/**
 * test/unit/viewRoute.test.ts — E79's host half as a specification: what the host does with each
 * message a view could post, clause by clause from src/webview/protocol.ts's header — run the
 * command at the current `seq`; drop one for an older model; refuse an id outside `prCascade.`, an
 * argument that is not a string, a `seq` no view could hold; ignore everything that is not a
 * `command` (a `moveOnto` until 23h). The `why` of every refusal is pinned too: it is the Output line.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code — the module imports none).
 * Depends on: src/vscode/views/route.ts. Plan: §7.1.3 "Protocol", §8 E79, §9.4 `unit/viewRoute`,
 * §10.1 item 23d (M6), §13.2 D70.
 */

// see primer §1 (import / export)
import { describe, expect, it } from 'vitest';
import { routeViewMessage } from '../../src/vscode/views/route';

// The model the host built last, and a command as a view posts it for that model.
// see primer §4 (const)
const CURRENT = 4;
const COMMAND = { type: 'command', seq: CURRENT, command: 'prCascade.checkout', args: ['/work/app', 'add-retries'] };

describe("routeViewMessage — the host half of E79 (protocol.ts's header, clause by clause)", () => {
  it('runs a command at the current seq with its arguments copied — the id narrowed to CommandId, the array a new one', () => {
    // act
    const route = routeViewMessage(COMMAND, CURRENT);

    // assert: the whole decision, and that the view's own array is not handed on
    expect(route).toStrictEqual({ kind: 'run', command: 'prCascade.checkout', args: ['/work/app', 'add-retries'] });
    if (route.kind === 'run') {
      expect(route.args).not.toBe(COMMAND.args);
    }
  });

  // One row per refusal: the message as a view (or a bug, or a stranger) would post it, and the
  // decision with its Output line.
  // see primer §78 (`it.each` over object rows: `$name`) and §16 (object literals: spread — one field changed)
  it.each([
    {
      name: 'a seq older than the current model — a click on a row that is gone — is dropped (E79)',
      message: { ...COMMAND, seq: 3 },
      kind: 'stale',
      why: 'dropped prCascade.checkout for model 3; model 4 is current',
    },
    {
      name: 'a seq ahead of the current model is rejected: a view only ever holds a seq the host posted',
      message: { ...COMMAND, seq: 9 },
      kind: 'rejected',
      why: 'rejected prCascade.checkout: seq 9 is ahead of the current model (4)',
    },
    { name: 'a seq that is a string is rejected', message: { ...COMMAND, seq: '4' }, kind: 'rejected', why: 'rejected prCascade.checkout: no usable seq' },
    { name: 'a seq that is a fraction is rejected', message: { ...COMMAND, seq: 1.5 }, kind: 'rejected', why: 'rejected prCascade.checkout: no usable seq' },
    { name: 'a negative seq is rejected', message: { ...COMMAND, seq: -1 }, kind: 'rejected', why: 'rejected prCascade.checkout: no usable seq' },
    {
      name: 'a missing seq is rejected',
      message: { type: 'command', command: 'prCascade.checkout', args: [] },
      kind: 'rejected',
      why: 'rejected prCascade.checkout: no usable seq',
    },
    {
      name: "a command id outside prCascade. is rejected — another extension's command never runs from a view",
      message: { ...COMMAND, command: 'workbench.action.closeAllEditors' },
      kind: 'rejected',
      why: 'rejected a command id that is not ours: "workbench.action.closeAllEditors"',
    },
    {
      name: 'a command id that is not a string is rejected, quoted as sent',
      message: { ...COMMAND, command: 7 },
      kind: 'rejected',
      why: 'rejected a command id that is not ours: 7',
    },
    {
      name: 'a missing command id is rejected',
      message: { type: 'command', seq: CURRENT, args: [] },
      kind: 'rejected',
      why: 'rejected a command id that is not ours: undefined',
    },
    {
      name: 'an argument that is not a string is rejected — nothing but strings reaches a command',
      message: { ...COMMAND, args: ['/work/app', 1] },
      kind: 'rejected',
      why: 'rejected prCascade.checkout: its arguments are not all strings',
    },
    {
      name: 'arguments that are not an array are rejected',
      message: { ...COMMAND, args: '/work/app' },
      kind: 'rejected',
      why: 'rejected prCascade.checkout: its arguments are not all strings',
    },
    {
      name: 'missing arguments are rejected',
      message: { type: 'command', seq: CURRENT, command: 'prCascade.checkout' },
      kind: 'rejected',
      why: 'rejected prCascade.checkout: its arguments are not all strings',
    },
    {
      name: 'a moveOnto message is ignored until 23h wires the drop (E77)',
      message: { type: 'moveOnto', seq: CURRENT, repo: '/work/app', layer: 'add-retries', target: 'origin/main' },
      kind: 'ignored',
      why: 'ignored a "moveOnto" message',
    },
    { name: 'a type no item has given the protocol is ignored', message: { type: 'focus', seq: CURRENT }, kind: 'ignored', why: 'ignored a "focus" message' },
    { name: 'null is ignored', message: null, kind: 'ignored', why: 'ignored a message that is not one of ours' },
    { name: 'a bare string is ignored', message: 'command', kind: 'ignored', why: 'ignored a message that is not one of ours' },
    { name: 'undefined is ignored', message: undefined, kind: 'ignored', why: 'ignored a message that is not one of ours' },
    { name: 'an object without a type is ignored', message: { seq: 1 }, kind: 'ignored', why: 'ignored a message that is not one of ours' },
    { name: 'an object whose type is not a string is ignored', message: { type: 2 }, kind: 'ignored', why: 'ignored a message that is not one of ours' },
  ])('$name', ({ message, kind, why }) => {
    // act + assert
    expect(routeViewMessage(message, CURRENT)).toStrictEqual({ kind, why });
  });

  it('checks shape before staleness: a malformed command with a stale seq is rejected, not dropped', () => {
    // arrange: an old seq and a foreign id at once
    const message = { ...COMMAND, seq: 1, command: 'workbench.action.closeAllEditors' };

    // act + assert
    expect(routeViewMessage(message, CURRENT).kind).toBe('rejected');
  });

  it('runs a command for the very first model too — seq 0 before any was posted matches a host whose current seq is 0', () => {
    // act + assert
    expect(routeViewMessage({ ...COMMAND, seq: 0 }, 0).kind).toBe('run');
  });
});
