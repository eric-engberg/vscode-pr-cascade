/**
 * test/git/readiness.git.test.ts — the probe's git side against a real repository: that
 * `rev-parse --verify --quiet refs/spice/data` answers what step 2 assumes before and after
 * the ref exists, that the real detectForge runs on the fixture once it does, and that a
 * failing answer is not remembered. git-spice itself is faked — CI has none until item 22
 * (plan D5), and `git update-ref refs/spice/data HEAD` stands in for what `gs repo init`
 * writes.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git in a throwaway directory,
 * no git-spice, no VS Code). Depends on: src/core/backends/gitspice.ts, src/core/git.ts,
 * test/helpers/fixture.ts, test/helpers/fakeCommand.ts. Plan: §10.1 item 18, §7.6 (the init
 * check), §7.13.1 step 2, §8 E59, §13.2 D56.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GitSpiceBackend } from '../../src/core/backends/gitspice';
import { RealGitRunner } from '../../src/core/git';
import { exited, FakeCommandRunner } from '../helpers/fakeCommand';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';

const git = new RealGitRunner();

/** A command fake in which `gs` is git-spice 0.31.2 — the probe never gets as far as a login check here. */
// see primer §3 (functions and type annotations) and §19 (Map)
function fakeGitSpice(): FakeCommandRunner {
  return new FakeCommandRunner(new Map([['gs --no-prompt --version', exited(0, 'git-spice 0.31.2\n')]]));
}

// see primer §5 (arrow functions)
beforeAll(() => {
  // Hermetic git for the runner under test, as in remote.git.test.ts: HOME points at a path
  // that does not exist, the global file is empty, the system file skipped.
  vi.stubEnv('HOME', path.join(__dirname, 'no-such-home'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// see primer §6 (async / await)
describe('GitSpiceBackend.readiness (real git)', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildStack();
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it('reports not-initialized for a repository git-spice has never seen (E59)', async () => {
    // arrange
    const commands = fakeGitSpice();
    const backend = new GitSpiceBackend(git, commands);

    // act
    const answer = await backend.readiness(fixture.dir, 'origin');

    // assert: real git said the ref is not there; the one program run was the version banner
    expect(answer).toStrictEqual({ kind: 'not-initialized', gsPath: 'gs' });
    // see primer §25 (arrays: map)
    expect(commands.calls.map((call) => call.args)).toEqual([['--no-prompt', '--version']]);
  });

  it('passes step 2 once refs/spice/data exists — and reaches the real detectForge, which finds the bare origin to be a local path', async () => {
    // arrange: what `gs repo init` writes, without git-spice; the ref's contents are never read
    fixture.git(['update-ref', 'refs/spice/data', 'HEAD']);
    const backend = new GitSpiceBackend(git, fakeGitSpice());

    // act
    const answer = await backend.readiness(fixture.dir, 'origin');

    // assert: E21 on the fixture (remote.git.test.ts shows why), so the probe stopped before any login check
    expect(answer).toStrictEqual({
      kind: 'remote-unparseable',
      remote: 'origin',
      url: path.join(path.dirname(fixture.dir), 'origin.git'),
    });
  });

  it('asks again on the next call — a failing answer is not remembered', async () => {
    // arrange: initialised, asked once, then no longer initialised
    fixture.git(['update-ref', 'refs/spice/data', 'HEAD']);
    const commands = fakeGitSpice();
    const backend = new GitSpiceBackend(git, commands);
    const before = await backend.readiness(fixture.dir, 'origin');
    fixture.git(['update-ref', '-d', 'refs/spice/data']);

    // act
    const after = await backend.readiness(fixture.dir, 'origin');

    // assert
    expect(before.kind).toBe('remote-unparseable');
    expect(after).toStrictEqual({ kind: 'not-initialized', gsPath: 'gs' });
    expect(commands.calls.length).toBe(2);
  });
});
