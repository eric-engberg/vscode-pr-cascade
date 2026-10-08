/**
 * test/unit/terminal.test.ts — runInTerminal as a specification: one terminal per repository,
 * found again by its name and directory while its shell lives, a new one otherwise; the command
 * typed as one quoted line with Enter; the terminal brought forward.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest — src/vscode/terminal.ts imports only types from
 * `vscode`, so it loads without VS Code). The real terminals are exercised in
 * test/ext/login.test.ts. Depends on: src/vscode/terminal.ts, test/helpers/fakeReadinessHost.ts.
 * Depended on by: nothing. Plan: §4.2 (`terminal.ts`: "run a command in a named terminal, reuse
 * if exists"), §7.5 step 2, §10.1 item 19b, §13.2 D58.
 */

// see primer §1 (import / export)
import { describe, expect, it } from 'vitest';
import { runInTerminal, terminalName } from '../../src/vscode/terminal';
import { FakeTerminalHost } from '../helpers/fakeReadinessHost';

// see primer §5 (arrow functions)
describe('terminalName', () => {
  it('names the terminal after the repository folder', () => {
    expect(terminalName('/w/repo')).toBe('PR Cascade: repo');
  });
});

describe('runInTerminal', () => {
  it('makes a terminal at the repository root, types the command as one line with Enter, and shows it', () => {
    // arrange
    const host = new FakeTerminalHost();

    // act
    const terminal = runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['git-spice', 'auth', 'login', '--forge', 'github']);

    // assert
    expect(host.created.length).toBe(1);
    expect(terminal).toBe(host.created[0]);
    expect(host.sent).toStrictEqual([{ name: 'PR Cascade: repo', cwd: '/w/repo', text: 'cd /w/repo && git-spice auth login --forge github', execute: true }]);
    // shown taking the focus — the user is about to type into it — not `show(true)`
    expect(host.created[0].showCalls).toStrictEqual([undefined]);
  });

  it('quotes the words for the shell', () => {
    // arrange
    const host = new FakeTerminalHost();

    // act
    runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['/Applications/Dev Tools/git-spice', 'repo', 'init', '--trunk', "it's"]);

    // assert
    expect(host.sent[0].text).toBe("cd /w/repo && '/Applications/Dev Tools/git-spice' repo init --trunk 'it'\\''s'");
  });

  it('types into the same terminal again while its shell lives — one per repository, reused across the steps', () => {
    // arrange
    const host = new FakeTerminalHost();
    const first = runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['git-spice', 'repo', 'init']);

    // act
    const second = runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['git-spice', 'auth', 'login']);

    // assert
    expect(second).toBe(first);
    expect(host.created.length).toBe(1);
    // see primer §25 (arrays: `map`)
    expect(host.created[0].sent.map((line) => line.text)).toStrictEqual(['cd /w/repo && git-spice repo init', 'cd /w/repo && git-spice auth login']);
    expect(host.shows).toBe(2);
  });

  it('changes to the repository first, so a terminal the user has `cd`-ed elsewhere still runs it in the right place', () => {
    // arrange: a root with a space, quoted like any other word
    const host = new FakeTerminalHost();

    // act
    runInTerminal(host, 'PR Cascade: my repo', '/w/my repo', ['git-spice', 'repo', 'init']);

    // assert
    expect(host.sent[0].text).toBe("cd '/w/my repo' && git-spice repo init");
  });

  it('passes over a live terminal the caller says not to use, and makes a new one', () => {
    // arrange: the first terminal is still in a prompt the flow gave up waiting on
    const host = new FakeTerminalHost();
    const stuck = runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['git-spice', 'auth', 'login']);

    // act
    const terminal = runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['git-spice', 'auth', 'login'], (candidate) => candidate !== stuck);

    // assert
    expect(terminal).not.toBe(stuck);
    expect(host.created.length).toBe(2);
  });

  it('makes a new terminal when the old one\'s shell has exited', () => {
    // arrange
    const host = new FakeTerminalHost();
    runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['true']);
    host.close(host.created[0]);

    // act
    const terminal = runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['true']);

    // assert
    expect(host.created.length).toBe(2);
    expect(terminal).toBe(host.created[1]);
  });

  it('does not reuse a terminal of another name', () => {
    // arrange
    const host = new FakeTerminalHost();
    host.create({ name: 'zsh', cwd: '/w/repo' });

    // act
    runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['true']);

    // assert
    // see primer §25 (arrays: `map`)
    expect(host.created.map((terminal) => terminal.name)).toStrictEqual(['zsh', 'PR Cascade: repo']);
  });

  it('keeps two repositories with the same folder name apart — same name, different directory, two terminals', () => {
    // arrange
    const host = new FakeTerminalHost();

    // act
    runInTerminal(host, 'PR Cascade: repo', '/a/repo', ['true']);
    runInTerminal(host, 'PR Cascade: repo', '/b/repo', ['false']);

    // assert
    expect(host.created.map((terminal) => terminal.creationOptions.cwd)).toStrictEqual(['/a/repo', '/b/repo']);
    expect(host.created[1].sent[0].text).toBe('cd /b/repo && false');
  });

  it('reuses the first of two live terminals that match', () => {
    // arrange: runInTerminal never makes two, but a reload can leave them
    const host = new FakeTerminalHost();
    const first = host.create({ name: 'PR Cascade: repo', cwd: '/w/repo' });
    host.create({ name: 'PR Cascade: repo', cwd: '/w/repo' });

    // act
    const terminal = runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['true']);

    // assert
    expect(terminal).toBe(first);
  });

  it('does not reuse a terminal of the same name made with no directory — and does not trip over it', () => {
    // arrange
    const host = new FakeTerminalHost();
    const bare = { name: 'PR Cascade: repo', exitStatus: undefined, creationOptions: {}, sendText: () => undefined, show: () => undefined };
    host.addExisting(bare);

    // act
    const terminal = runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['true']);

    // assert
    expect(terminal).not.toBe(bare);
    expect(host.created.length).toBe(1);
  });

  it('reads a terminal\'s directory given as a Uri, as VS Code may hold it', () => {
    // arrange: a terminal made elsewhere with `cwd: vscode.Uri.file(...)` — only `fsPath` is read
    const host = new FakeTerminalHost();
    const existing = { name: 'PR Cascade: repo', exitStatus: undefined, creationOptions: { cwd: { fsPath: '/w/repo' } }, sendText: () => undefined, show: () => undefined };
    host.addExisting(existing);

    // act
    const terminal = runInTerminal(host, 'PR Cascade: repo', '/w/repo', ['true']);

    // assert
    expect(terminal).toBe(existing);
    expect(host.created.length).toBe(0);
  });
});
