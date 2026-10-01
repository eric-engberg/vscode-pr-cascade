/**
 * test/git/remote.git.test.ts — detectForge against real repositories: what `git remote
 * get-url` and `git config --get-regexp` actually print for a repository with no remote
 * (E25), for the fixture's bare origin (a local path, not a forge), for a second remote that
 * `prCascade.remote` selects, for a URL git rewrites through `url.<base>.insteadOf` (and one
 * it does not, through `pushInsteadOf`), and for the `spice.forge.*` keys as git itself
 * stores and prints them.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, real git in a throwaway
 * directory, no VS Code). The unit tests pin the commands and the classification rules; these
 * check that real git hands detectForge the text those tests assume. Depends on:
 * src/core/forge.ts, src/core/git.ts, test/helpers/fixture.ts. Plan: §10.1 item 16, §7.5,
 * §7.6, §8 E21/E25/E60/E70, §9.4 `git/remote.git`.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { detectForge } from '../../src/core/forge';
import { RealGitRunner } from '../../src/core/git';
import { buildStack } from '../helpers/fixture';
import type { Fixture } from '../helpers/fixture';
import type { ForgeConfig } from '../../src/core/forge';

const git = new RealGitRunner();

// What `parseForgeConfig` gives for a repository with no `spice.forge.*` keys at all.
// see primer §9 (an object literal that satisfies an interface) and §19 (Map)
const NO_CONFIG: ForgeConfig = { kind: null, rejectedKind: null, hosts: new Map() };

// The two keys the configured block writes, as `parseForgeConfig` reads them back.
const TWO_URLS: ForgeConfig = {
  kind: null,
  rejectedKind: null,
  hosts: new Map([
    ['github', { host: 'eu.ghe.com', port: '' }],
    ['gitlab', { host: 'gitlab.example.com', port: '' }],
  ]),
};

// see primer §5 (arrow functions)
beforeAll(() => {
  // Hermetic git for the runner under test, in the spirit of trunk.git.test.ts: detectForge
  // reads configuration through RealGitRunner, which inherits the developer's environment,
  // and `config --get-regexp` would otherwise see a real `spice.forge.*` key or a real
  // `url.*.insteadOf` rewrite from ~/.gitconfig. HOME is pointed at a path that does not
  // exist, so there is no ~/.gitconfig to find; GIT_CONFIG_GLOBAL at an empty file closes
  // the other route to a global file, and the system file is skipped. (The fixture's own
  // `git()` already does this for the setup commands.)
  vi.stubEnv('HOME', path.join(__dirname, 'no-such-home'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// see primer §6 (async / await)
describe('detectForge (real git)', () => {
  describe('a repository with no remote (E25)', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack({ remote: false });
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('answers no-remote — `git remote get-url origin` exits 2', async () => {
      // act
      const detection = await detectForge(git, fixture.dir, 'origin');

      // assert
      expect(detection).toStrictEqual({ kind: 'no-remote', remote: 'origin' });
    });
  });

  describe('the fixture\'s bare origin and four forge-looking remotes, nothing configured', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      // Remotes are URLs git stores; none of these is ever fetched, so no network and no
      // such host is needed.
      fixture.git(['remote', 'add', 'github', 'git@github.com:org/repo.git']);
      fixture.git(['remote', 'add', 'ghe', 'ssh://git@eu.ghe.com/org/repo.git']);
      // An `insteadOf` rewrite, the way many people shorten a host: `gl:` stands for the
      // ssh form of a self-hosted GitLab. The remote is stored as typed; `remote get-url`
      // prints the rewritten URL.
      fixture.git(['config', 'url.git@gitlab.example.com:.insteadOf', 'gl:']);
      fixture.git(['remote', 'add', 'gl', 'gl:group/sub/repo.git']);
      // A `pushInsteadOf` rewrite applies to pushes only; `remote get-url` prints the fetch
      // URL, so this one reaches detectForge unrewritten.
      fixture.git(['config', 'url.git@gitlab.example.com:.pushInsteadOf', 'glpush:']);
      fixture.git(['remote', 'add', 'glpush', 'glpush:group/sub/repo.git']);
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('answers unparseable for the bare origin, which is a directory on disk, with its path', async () => {
      // arrange: buildStack puts `origin.git` beside `repo` in the scratch directory
      const originDir = path.join(path.dirname(fixture.dir), 'origin.git');

      // act
      const detection = await detectForge(git, fixture.dir, 'origin');

      // assert: a local path is not a forge — PR features off, the tree still works
      expect(detection).toStrictEqual({ kind: 'unparseable', remote: 'origin', url: originDir });
    });

    it('reads the remote prCascade.remote names — github.com through the second remote', async () => {
      // act
      const detection = await detectForge(git, fixture.dir, 'github');

      // assert
      expect(detection).toStrictEqual({
        kind: 'forge',
        remote: 'github',
        forge: { host: 'github.com', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: true },
        config: NO_CONFIG,
      });
    });

    it('sees the URL git rewrites through url.<base>.insteadOf, not the text the remote was added with', async () => {
      // act
      const detection = await detectForge(git, fixture.dir, 'gl');

      // assert: the rewritten host, the subgroup as the owner; a self-hosted GitLab nobody
      // has told git-spice about is unknown (E60)
      expect(detection).toStrictEqual({
        kind: 'forge',
        remote: 'gl',
        forge: { host: 'gitlab.example.com', port: '', owner: 'group/sub', repo: 'repo', kind: 'unknown', recognizedByGitSpice: false },
        config: NO_CONFIG,
      });
    });

    it('reads the fetch URL — a pushInsteadOf rewrite is not applied, and git-spice reads the same URL', async () => {
      // act
      const detection = await detectForge(git, fixture.dir, 'glpush');

      // assert: the alias itself is the host; git-spice 0.31.2 says "no forge found for
      // glpush:…" for the same remote, so the two agree, and E60's remedy (`spice.forge.kind`)
      // fixes both
      expect(detection).toStrictEqual({
        kind: 'forge',
        remote: 'glpush',
        forge: { host: 'glpush', port: '', owner: 'group/sub', repo: 'repo', kind: 'unknown', recognizedByGitSpice: false },
        config: NO_CONFIG,
      });
    });

    it('guesses github for a *.ghe.com host that git-spice will not recognise (E70)', async () => {
      // act
      const detection = await detectForge(git, fixture.dir, 'ghe');

      // assert
      expect(detection).toStrictEqual({
        kind: 'forge',
        remote: 'ghe',
        forge: { host: 'eu.ghe.com', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: false },
        config: NO_CONFIG,
      });
    });

    it('answers no-remote for a name that is not a remote, even beside remotes that are', async () => {
      // act
      const detection = await detectForge(git, fixture.dir, 'nope');

      // assert
      expect(detection).toStrictEqual({ kind: 'no-remote', remote: 'nope' });
    });
  });

  describe('with spice.forge.<kind>.url configured in the repository', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      fixture.git(['remote', 'add', 'github', 'git@github.com:org/repo.git']);
      fixture.git(['remote', 'add', 'ghe', 'ssh://git@eu.ghe.com/org/repo.git']);
      fixture.git(['remote', 'add', 'GHE', 'ssh://git@EU.ghe.com/org/repo.git']);
      fixture.git(['config', 'url.git@gitlab.example.com:.insteadOf', 'gl:']);
      fixture.git(['remote', 'add', 'gl', 'gl:group/sub/repo.git']);
      // What E70's offer and the README's self-hosted paragraph tell the user to run.
      fixture.git(['config', 'spice.forge.github.url', 'https://eu.ghe.com']);
      fixture.git(['config', 'spice.forge.gitlab.url', 'https://gitlab.example.com/']);
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('recognises the self-hosted GitLab once spice.forge.gitlab.url names it', async () => {
      // act: the two keys come back from one real `config --get-regexp`
      const detection = await detectForge(git, fixture.dir, 'gl');

      // assert
      expect(detection).toStrictEqual({
        kind: 'forge',
        remote: 'gl',
        forge: { host: 'gitlab.example.com', port: '', owner: 'group/sub', repo: 'repo', kind: 'gitlab', recognizedByGitSpice: true },
        config: TWO_URLS,
      });
    });

    it('recognises the *.ghe.com host once spice.forge.github.url names it — E70 resolved', async () => {
      // act
      const detection = await detectForge(git, fixture.dir, 'ghe');

      // assert
      expect(detection).toStrictEqual({
        kind: 'forge',
        remote: 'ghe',
        forge: { host: 'eu.ghe.com', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: true },
        config: TWO_URLS,
      });
    });

    it('does not recognise the same host spelled with capitals — git-spice compares the text as typed', async () => {
      // act: the key says `eu.ghe.com`; the remote says `EU.ghe.com`
      const detection = await detectForge(git, fixture.dir, 'GHE');

      // assert: still GitHub to the extension, but E70's offer must echo the remote's spelling
      expect(detection).toStrictEqual({
        kind: 'forge',
        remote: 'GHE',
        forge: { host: 'EU.ghe.com', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: false },
        config: TWO_URLS,
      });
    });

    it('reports github.com as unrecognised while spice.forge.github.url names another host — a url key replaces the default', async () => {
      // act: verified with git-spice 0.31.2: "no forge found for git@github.com:org/repo.git"
      // in exactly this configuration
      const detection = await detectForge(git, fixture.dir, 'github');

      // assert
      expect(detection).toStrictEqual({
        kind: 'forge',
        remote: 'github',
        forge: { host: 'github.com', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: false },
        config: TWO_URLS,
      });
    });
  });

  describe('with spice.forge.kind configured for an ssh alias', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      // `work` would be a Host entry in ~/.ssh/config; the URL alone says nothing about the
      // forge, which is what spice.forge.kind is for.
      fixture.git(['remote', 'add', 'work', 'work:org/repo.git']);
      fixture.git(['config', 'spice.forge.kind', 'github']);
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('classifies the alias as the configured kind, recognised by git-spice', async () => {
      // act
      const detection = await detectForge(git, fixture.dir, 'work');

      // assert
      expect(detection).toStrictEqual({
        kind: 'forge',
        remote: 'work',
        forge: { host: 'work', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: true },
        config: { kind: 'github', rejectedKind: null, hosts: new Map() },
      });
    });
  });

  describe('with a spice.forge.kind git-spice rejects', () => {
    let fixture: Fixture;

    beforeAll(() => {
      fixture = buildStack();
      fixture.git(['remote', 'add', 'github', 'git@github.com:org/repo.git']);
      // A capitalised id — git-spice's ids are case-sensitive, and with this in place 0.31.2
      // refuses every forge-touching command (`unknown forge: "GitHub"`).
      fixture.git(['config', 'spice.forge.kind', 'GitHub']);
    });

    afterAll(() => {
      fixture.cleanup();
    });

    it('reports even github.com as unrecognised, through the real config output', async () => {
      // act
      const detection = await detectForge(git, fixture.dir, 'github');

      // assert
      expect(detection).toStrictEqual({
        kind: 'forge',
        remote: 'github',
        forge: { host: 'github.com', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: false },
        config: { kind: null, rejectedKind: 'GitHub', hosts: new Map() },
      });
    });
  });
});
