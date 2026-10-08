/**
 * test/unit/readinessFix.test.ts — the offers as a specification: for every way the readiness
 * probe can say "not ready", the exact sentence the user reads, its colour, the one button (if
 * any), what the button runs, and the line shown once it took. Then the question asked of git
 * before an init offer — which local branch is the trunk — and the "ready" sentence.
 *
 * Messages are behaviour, so the first case of each member compares the whole offer with
 * `toStrictEqual` — a changed word fails here, on purpose — and the cases after it pin the one
 * field they are about.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no git-spice, no VS Code). Depends on:
 * src/core/readinessFix.ts, test/helpers/fakeGit.ts. The trunk question on real git is
 * test/git/trunkBranch.git.test.ts. Depended on by: nothing. Plan: §7.6, §7.13.1, §8 E21/E25/E55/
 * E59/E60/E62/E62b/E67/E70/E75, §10.1 item 19a, §13.2 D57.
 */

// see primer §1 (import / export), §9 (`import type`) and §49 (`Ready`, `NotReady`: Extract and Exclude)
import { describe, expect, it } from 'vitest';
import type { NotReady, Ready } from '../../src/core/backend';
import type { Forge, ForgeConfig, HostAddress } from '../../src/core/forge';
import { INSTALL_DOCS_URL, offerFor, readyMessage, trunkBranchFor } from '../../src/core/readinessFix';
import type { OfferFacts } from '../../src/core/readinessFix';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository every offer is about; its folder name is what the sentences call it.
// see primer §4 (const)
const ROOT = '/work/app';

/** A Mac with Homebrew (but no git-spice from it), git-spice looked for automatically, a local `main` as the trunk. */
const FACTS: OfferFacts = {
  root: ROOT,
  remote: 'origin',
  trunkBranch: { kind: 'local', branch: 'main' },
  gsPathSetting: '',
  brewPath: '/opt/homebrew/bin/brew',
  brewGitSpice: null,
};

/** The same without Homebrew — Linux, or a Mac that never installed it. */
// see primer §16 (object literals: spread, then one field replaced)
const NO_BREW: OfferFacts = { ...FACTS, brewPath: null };

/** A github.com remote, as detectForge reports one. */
const GITHUB: Forge = { host: 'github.com', port: '', owner: 'org', repo: 'app', kind: 'github', recognizedByGitSpice: true };

/** No `spice.forge.*` configuration at all. */
const NO_CONFIG: ForgeConfig = { kind: null, rejectedKind: null, hosts: new Map() };

/** A config with one `spice.forge.<kind>.url` set, as parseForgeConfig stores it. */
// see primer §19 (Map) and §31 (type arguments on `new Map`)
function urlKey(kind: 'github' | 'gitlab', address: HostAddress): ForgeConfig {
  return { kind: null, rejectedKind: null, hosts: new Map([[kind, address]]) };
}

/** The `forge-unrecognized` member for a forge and the config detectForge read beside it. */
// see primer §59 (tagged unions: building a member)
function unrecognized(forge: Forge, config: ForgeConfig): NotReady {
  return { kind: 'forge-unrecognized', forge, config };
}

// see primer §5 (arrow functions)
describe('offerFor', () => {
  describe('gs-missing (E62)', () => {
    it('offers Homebrew in a terminal — the brew that was found, by its full path — when git-spice was looked for by both names', () => {
      // act
      const offer = offerFor({ kind: 'gs-missing', tried: ['git-spice', 'gs'] }, FACTS);

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: "git-spice was not found in VS Code's PATH (tried git-spice, gs). Install it with Homebrew — or, if it is already installed, set prCascade.gsPath to its full path.",
        fix: { button: 'Install with Homebrew', action: { kind: 'terminal', argv: ['/opt/homebrew/bin/brew', 'install', 'git-spice'] }, done: 'git-spice installed.' },
      });
    });

    it("runs an Intel Mac's brew from where it is", () => {
      // act
      const offer = offerFor({ kind: 'gs-missing', tried: ['git-spice', 'gs'] }, { ...FACTS, brewPath: '/usr/local/bin/brew' });

      // assert
      // see primer §70 (`?.`: `fix` is null for an offer with no button)
      expect(offer.fix?.action).toStrictEqual({ kind: 'terminal', argv: ['/usr/local/bin/brew', 'install', 'git-spice'] });
    });

    it('names the path, with no button, when Homebrew has git-spice and VS Code cannot see it — installing again would change nothing', () => {
      // act
      const offer = offerFor({ kind: 'gs-missing', tried: ['git-spice', 'gs'] }, { ...FACTS, brewGitSpice: '/opt/homebrew/bin/git-spice' });

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: 'git-spice is installed at /opt/homebrew/bin/git-spice, but VS Code did not find it (tried git-spice, gs). Set prCascade.gsPath to /opt/homebrew/bin/git-spice.',
        fix: null,
      });
    });

    it('offers the install page when there is no Homebrew', () => {
      // act
      const offer = offerFor({ kind: 'gs-missing', tried: ['git-spice', 'gs'] }, NO_BREW);

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: "git-spice was not found in VS Code's PATH (tried git-spice, gs). Install it — or, if it is already installed, set prCascade.gsPath to its full path.",
        fix: { button: 'Open install docs', action: { kind: 'open-url', url: INSTALL_DOCS_URL }, done: 'git-spice installed.' },
      });
    });

    it('points at the setting, with no button, when prCascade.gsPath is set — installing would not change what is tried', () => {
      // act: Homebrew's git-spice is there too, and still not offered — only the setting is tried
      const offer = offerFor(
        { kind: 'gs-missing', tried: ['/usr/local/bin/gs'] },
        { ...FACTS, gsPathSetting: '/usr/local/bin/gs', brewGitSpice: '/opt/homebrew/bin/git-spice' },
      );

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: 'prCascade.gsPath is /usr/local/bin/gs, which did not answer as git-spice. Point it at git-spice, or clear it to try git-spice and gs.',
        fix: null,
      });
    });

    it('reads a setting of only spaces as empty, as the probe does — both names were tried', () => {
      // act
      const offer = offerFor({ kind: 'gs-missing', tried: ['git-spice', 'gs'] }, { ...FACTS, gsPathSetting: '  ' });

      // assert
      expect(offer.fix?.button).toBe('Install with Homebrew');
    });

    it('links to the documented install page', () => {
      expect(INSTALL_DOCS_URL).toBe('https://abhinav.github.io/git-spice/start/install/');
    });
  });

  describe('gs-too-old', () => {
    // A Mac where Homebrew installed the git-spice that answered.
    const BREW_GIT_SPICE: OfferFacts = { ...FACTS, brewGitSpice: '/opt/homebrew/bin/git-spice' };

    it("offers `brew upgrade` when the git-spice that answered is Homebrew's", () => {
      // act
      const offer = offerFor({ kind: 'gs-too-old', gsPath: 'git-spice', found: '0.30.0', minimum: '0.31.0' }, BREW_GIT_SPICE);

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: 'git-spice 0.30.0 is older than 0.31.0, the oldest PR Cascade works with.',
        fix: { button: 'Upgrade with Homebrew', action: { kind: 'terminal', argv: ['/opt/homebrew/bin/brew', 'upgrade', 'git-spice'] }, done: 'git-spice upgraded.' },
      });
    });

    it("knows Homebrew's git-spice by its full path, set by hand", () => {
      // act
      const offer = offerFor({ kind: 'gs-too-old', gsPath: '/opt/homebrew/bin/git-spice', found: '0.30.0', minimum: '0.31.0' }, BREW_GIT_SPICE);

      // assert
      expect(offer.fix?.action).toStrictEqual({ kind: 'terminal', argv: ['/opt/homebrew/bin/brew', 'upgrade', 'git-spice'] });
    });

    it('offers the install page for a git-spice installed some other way, though Homebrew is there — `brew upgrade` would not touch it', () => {
      // act: every official package is named git-spice since v0.25, so the name proves nothing
      const offer = offerFor({ kind: 'gs-too-old', gsPath: 'git-spice', found: '0.30.0', minimum: '0.31.0' }, FACTS);

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: 'git-spice 0.30.0 is older than 0.31.0, the oldest PR Cascade works with.',
        fix: { button: 'Open install docs', action: { kind: 'open-url', url: INSTALL_DOCS_URL }, done: 'git-spice upgraded.' },
      });
    });

    it("offers the install page for another git-spice set by hand, though Homebrew's is there too — and says where it is", () => {
      // act
      const offer = offerFor({ kind: 'gs-too-old', gsPath: '/home/u/.local/bin/git-spice', found: '0.30.0', minimum: '0.31.0' }, BREW_GIT_SPICE);

      // assert: a path is worth naming; a bare name only repeats "git-spice"
      expect(offer.message).toBe('git-spice 0.30.0 at /home/u/.local/bin/git-spice is older than 0.31.0, the oldest PR Cascade works with.');
      expect(offer.fix?.button).toBe('Open install docs');
    });

    it('offers the install page for a `gs`, which Homebrew no longer installs — a `go install` build', () => {
      // act
      const offer = offerFor({ kind: 'gs-too-old', gsPath: 'gs', found: '0.30.0', minimum: '0.31.0' }, BREW_GIT_SPICE);

      // assert
      expect(offer.fix?.button).toBe('Open install docs');
    });

    it('offers the install page when there is no Homebrew', () => {
      // act
      const offer = offerFor({ kind: 'gs-too-old', gsPath: 'git-spice', found: '0.30.0', minimum: '0.31.0' }, NO_BREW);

      // assert
      expect(offer.fix?.button).toBe('Open install docs');
    });

    it('says the version could not be checked for a build that reports none (`dev`), and offers the install page — even for Homebrew\'s', () => {
      // act
      const offer = offerFor({ kind: 'gs-too-old', gsPath: 'git-spice', found: 'dev', minimum: '0.31.0' }, BREW_GIT_SPICE);

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: 'git-spice reports version "dev", so whether it is at least 0.31.0 could not be checked.',
        fix: { button: 'Open install docs', action: { kind: 'open-url', url: INSTALL_DOCS_URL }, done: 'git-spice upgraded.' },
      });
    });
  });

  describe('not-initialized (E59)', () => {
    it('offers `gs repo init` with the local trunk branch and the remote, run by the executable that answered, past any alias', () => {
      // act
      const offer = offerFor({ kind: 'not-initialized', gsPath: 'git-spice' }, FACTS);

      // assert: `command` makes the shell run the program, not an alias or function of that name
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: 'git-spice is not initialised in app. Initialise it with trunk main and remote origin?',
        fix: {
          button: 'Initialise',
          action: { kind: 'terminal', argv: ['command', 'git-spice', 'repo', 'init', '--trunk', 'main', '--remote', 'origin'] },
          done: 'git-spice initialised in app.',
        },
      });
    });

    it('passes a trunk branch with a slash in it as it is', () => {
      // act
      const offer = offerFor({ kind: 'not-initialized', gsPath: 'gs' }, { ...FACTS, remote: 'upstream', trunkBranch: { kind: 'local', branch: 'release/2.0' } });

      // assert
      expect(offer.fix?.action).toStrictEqual({ kind: 'terminal', argv: ['command', 'gs', 'repo', 'init', '--trunk', 'release/2.0', '--remote', 'upstream'] });
    });

    it('names the git command, with no button, when the trunk exists only on the remote — git-spice needs a local branch', () => {
      // act
      const offer = offerFor({ kind: 'not-initialized', gsPath: 'gs' }, { ...FACTS, trunkBranch: { kind: 'missing', branch: 'main', trunk: 'origin/main' } });

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: 'git-spice is not initialised in app; it needs trunk main as a local branch, and there is only origin/main. Run git branch main origin/main to create it.',
        fix: null,
      });
    });

    it('quotes that git command for a shell, so it can be pasted as it is', () => {
      // act: git allows a quote and a `$` in a branch name
      const offer = offerFor({ kind: 'not-initialized', gsPath: 'gs' }, { ...FACTS, trunkBranch: { kind: 'missing', branch: "it's-$x", trunk: "origin/it's-$x" } });

      // assert
      expect(offer.message).toBe(
        "git-spice is not initialised in app; it needs trunk it's-$x as a local branch, and there is only origin/it's-$x. Run git branch 'it'\\''s-$x' 'origin/it'\\''s-$x' to create it.",
      );
    });

    it('asks for prCascade.trunk, with no button, when the trunk does not name one branch (a tag, a commit, an ambiguous name)', () => {
      // act
      const offer = offerFor({ kind: 'not-initialized', gsPath: 'gs' }, { ...FACTS, trunkBranch: { kind: 'not-a-branch', trunk: 'v1' } });

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: 'git-spice is not initialised in app, and its trunk v1 does not name one branch — set prCascade.trunk to a branch first.',
        fix: null,
      });
    });

    it('asks for prCascade.trunk, with no button, when no trunk was found (E4)', () => {
      // act
      const offer = offerFor({ kind: 'not-initialized', gsPath: 'gs' }, { ...FACTS, trunkBranch: { kind: 'none' } });

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: 'git-spice is not initialised in app, and no trunk was found to initialise it with — set prCascade.trunk first.',
        fix: null,
      });
    });
  });

  describe('the remote (E25, E21)', () => {
    it('no-remote: names the remote and the setting', () => {
      // act
      const offer = offerFor({ kind: 'no-remote', remote: 'upstream' }, FACTS);

      // assert
      expect(offer).toStrictEqual({ severity: 'warning', message: 'app has no remote named upstream — add one, or set prCascade.remote.', fix: null });
    });

    it('remote-unparseable: says what the URL is and that the view still works — information, nothing to fix', () => {
      // act
      const offer = offerFor({ kind: 'remote-unparseable', remote: 'origin', url: '/srv/git/app.git' }, FACTS);

      // assert
      expect(offer).toStrictEqual({
        severity: 'information',
        message: "The URL of app's remote origin, /srv/git/app.git, names no GitHub or GitLab repository; the Stack view still works.",
        fix: null,
      });
    });
  });

  describe('forge-unrecognized (E60, E70)', () => {
    it('E60: a host nobody knows — names both url keys, and spice.forge.kind for an ssh alias', () => {
      // act
      const offer = offerFor(unrecognized({ ...GITHUB, host: 'git.corp.example', kind: 'unknown', recognizedByGitSpice: false }, NO_CONFIG), FACTS);

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message:
          "git-spice does not recognise git.corp.example; v1 supports GitHub and GitLab. If git.corp.example is one of them, set spice.forge.github.url or spice.forge.gitlab.url to https://git.corp.example in app's git config — or, if git.corp.example is an ssh alias, set spice.forge.kind to github or gitlab.",
        fix: null,
      });
    });

    it('E70: a *.ghe.com host with no url key — offers git config for it as the remote spells it, and for its API on api.<host>', () => {
      // act
      const offer = offerFor(unrecognized({ ...GITHUB, host: 'corp.ghe.com', recognizedByGitSpice: false }, NO_CONFIG), FACTS);

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message:
          'git-spice will not match corp.ghe.com as GitHub until spice.forge.github.url names it. Set it to https://corp.ghe.com, and spice.forge.github.apiUrl to https://api.corp.ghe.com, for app?',
        fix: {
          button: 'Set GitHub URLs',
          action: {
            kind: 'git-config',
            entries: [
              { key: 'spice.forge.github.url', value: 'https://corp.ghe.com' },
              // GHE.com serves its API on api.<host>; from the url alone git-spice would guess https://corp.ghe.com/api
              { key: 'spice.forge.github.apiUrl', value: 'https://api.corp.ghe.com' },
            ],
          },
          done: 'spice.forge.github.url set to https://corp.ghe.com, and spice.forge.github.apiUrl to https://api.corp.ghe.com.',
        },
      });
    });

    it('E70: github.com while the url key names a company host — the key replaced the default', () => {
      // act
      const offer = offerFor(unrecognized({ ...GITHUB, recognizedByGitSpice: false }, urlKey('github', { host: 'ghes.corp.com', port: '' })), FACTS);

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message:
          'spice.forge.github.url names ghes.corp.com, so git-spice no longer matches github.com as GitHub. Set it to https://github.com, and spice.forge.github.apiUrl to https://api.github.com, for app?',
        fix: {
          button: 'Set GitHub URLs',
          action: {
            kind: 'git-config',
            entries: [
              { key: 'spice.forge.github.url', value: 'https://github.com' },
              // named too: an apiUrl set beside the company url would otherwise still apply here
              { key: 'spice.forge.github.apiUrl', value: 'https://api.github.com' },
            ],
          },
          done: 'spice.forge.github.url set to https://github.com, and spice.forge.github.apiUrl to https://api.github.com.',
        },
      });
    });

    it('E70: names the configured port when the url key has one — the reason the remote does not match', () => {
      // act: git-spice compares the port when the url key names one, and the remote's has none
      const offer = offerFor(unrecognized({ ...GITHUB, recognizedByGitSpice: false }, urlKey('github', { host: 'github.com', port: '8443' })), FACTS);

      // assert: the offered URL has no port — a remote's port is usually ssh's, not the web server's
      expect(offer.message).toBe(
        'spice.forge.github.url names github.com:8443, so git-spice no longer matches github.com as GitHub. Set it to https://github.com, and spice.forge.github.apiUrl to https://api.github.com, for app?',
      );
    });

    it('E70: another GitHub host gets its API under /api on that host — what git-spice derives for Enterprise Server', () => {
      // act: detectForge does not produce this today (an Enterprise Server host is E60 until its url
      // key names it), so this pins the fallback rather than a case the probe meets
      const offer = offerFor(unrecognized({ ...GITHUB, host: 'ghes.corp.com', recognizedByGitSpice: false }, NO_CONFIG), FACTS);

      // assert
      expect(offer.fix?.action).toStrictEqual({
        kind: 'git-config',
        entries: [
          { key: 'spice.forge.github.url', value: 'https://ghes.corp.com' },
          { key: 'spice.forge.github.apiUrl', value: 'https://ghes.corp.com/api' },
        ],
      });
    });

    it('E70: a url key that is not a URL says so, rather than quoting it', () => {
      // act
      const offer = offerFor(unrecognized({ ...GITHUB, recognizedByGitSpice: false }, urlKey('github', { host: '', port: '' })), FACTS);

      // assert
      expect(offer.message).toBe(
        'spice.forge.github.url is not a URL, so git-spice matches nothing as GitHub. Set it to https://github.com, and spice.forge.github.apiUrl to https://api.github.com, for app?',
      );
      expect(offer.fix?.button).toBe('Set GitHub URLs');
    });

    it('E70: reads github.com and ghe.com without regard to case when choosing the API host, and keeps the spelling', () => {
      // act: a remote spelled GitHub.com, and one spelled Corp.GHE.com
      const capitals = offerFor(unrecognized({ ...GITHUB, host: 'GitHub.com', recognizedByGitSpice: false }, NO_CONFIG), FACTS);
      const tenant = offerFor(unrecognized({ ...GITHUB, host: 'Corp.GHE.com', recognizedByGitSpice: false }, NO_CONFIG), FACTS);

      // assert
      expect(capitals.fix?.action).toStrictEqual({
        kind: 'git-config',
        entries: [
          { key: 'spice.forge.github.url', value: 'https://GitHub.com' },
          { key: 'spice.forge.github.apiUrl', value: 'https://api.github.com' },
        ],
      });
      expect(tenant.fix?.action).toStrictEqual({
        kind: 'git-config',
        entries: [
          { key: 'spice.forge.github.url', value: 'https://Corp.GHE.com' },
          { key: 'spice.forge.github.apiUrl', value: 'https://api.Corp.GHE.com' },
        ],
      });
    });

    it('E70: a subdomain of github.com (ssh.github.com, ssh over port 443) is github.com — the url and API are GitHub\'s own', () => {
      // act: the url key names a company host, so git-spice no longer matches github.com's subdomains either
      const offer = offerFor(
        unrecognized({ ...GITHUB, host: 'ssh.github.com', port: '443', recognizedByGitSpice: false }, urlKey('github', { host: 'ghes.corp.com', port: '' })),
        FACTS,
      );

      // assert: never https://ssh.github.com — no web pages or API there
      expect(offer.fix?.action).toStrictEqual({
        kind: 'git-config',
        entries: [
          { key: 'spice.forge.github.url', value: 'https://github.com' },
          { key: 'spice.forge.github.apiUrl', value: 'https://api.github.com' },
        ],
      });
    });

    it('E70: a subdomain in capitals keeps github.com\'s own spelling from the remote — SSH.GitHub.com gives https://GitHub.com', () => {
      // act: the extension's guess ignores case, git-spice does not, so this is E70 with no url key
      const offer = offerFor(unrecognized({ ...GITHUB, host: 'SSH.GitHub.com', recognizedByGitSpice: false }, NO_CONFIG), FACTS);

      // assert
      expect(offer.fix?.action).toStrictEqual({
        kind: 'git-config',
        entries: [
          { key: 'spice.forge.github.url', value: 'https://GitHub.com' },
          { key: 'spice.forge.github.apiUrl', value: 'https://api.github.com' },
        ],
      });
    });

    it('E70 on GitLab: echoes the remote\'s own spelling — git-spice compares the text', () => {
      // act
      const offer = offerFor(unrecognized({ ...GITHUB, host: 'GitLab.com', kind: 'gitlab', recognizedByGitSpice: false }, NO_CONFIG), FACTS);

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message:
          'git-spice will not match GitLab.com as GitLab until spice.forge.gitlab.url names it. Set it to https://GitLab.com, and spice.forge.gitlab.apiUrl to https://GitLab.com, for app?',
        fix: {
          button: 'Set GitLab URLs',
          // git-spice's GitLab API is the GitLab URL itself unless told otherwise; named so an
          // apiUrl set for another GitLab elsewhere cannot apply here
          action: {
            kind: 'git-config',
            entries: [
              { key: 'spice.forge.gitlab.url', value: 'https://GitLab.com' },
              { key: 'spice.forge.gitlab.apiUrl', value: 'https://GitLab.com' },
            ],
          },
          done: 'spice.forge.gitlab.url set to https://GitLab.com, and spice.forge.gitlab.apiUrl to https://GitLab.com.',
        },
      });
    });

    it('an explicit spice.forge.kind whose url key the remote misses is text only — the remote is often an ssh alias, no URL to offer', () => {
      // arrange: `work:org/app.git` through an ssh alias, kind github, the url key naming the real host
      const config: ForgeConfig = { kind: 'github', rejectedKind: null, hosts: new Map([['github', { host: 'ghes.corp.com', port: '' }]]) };

      // act
      const offer = offerFor(unrecognized({ ...GITHUB, host: 'work', recognizedByGitSpice: false }, config), FACTS);

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message:
          'spice.forge.kind is github, but work does not match spice.forge.github.url (ghes.corp.com), so git-spice will not use GitHub in app. Change the remote or spice.forge.github.url so they agree.',
        fix: null,
      });
    });

    it('says "not a URL" for an explicit kind whose url key is not one', () => {
      // arrange
      const config: ForgeConfig = { kind: 'gitlab', rejectedKind: null, hosts: new Map([['gitlab', { host: '', port: '' }]]) };

      // act
      const offer = offerFor(unrecognized({ ...GITHUB, host: 'work', kind: 'gitlab', recognizedByGitSpice: false }, config), FACTS);

      // assert
      expect(offer.message).toBe(
        'spice.forge.kind is gitlab, but work does not match spice.forge.gitlab.url (not a URL), so git-spice will not use GitLab in app. Change the remote or spice.forge.gitlab.url so they agree.',
      );
    });

    it('a rejected spice.forge.kind comes before E60 too — for a host nobody knows, the bad kind is still the cause', () => {
      // act
      const offer = offerFor(
        unrecognized({ ...GITHUB, host: 'git.corp.example', kind: 'unknown', recognizedByGitSpice: false }, { kind: null, rejectedKind: 'GitHub', hosts: new Map() }),
        FACTS,
      );

      // assert
      expect(offer.message).toBe(
        'spice.forge.kind is "GitHub", which git-spice rejects, so it matches no forge in app. Unset it, or set it to one of bitbucket, forgejo, gitea, github, gitlab.',
      );
    });

    it('a rejected spice.forge.kind comes first, whatever the host looks like, and is text only', () => {
      // act: github.com would have matched, but the bad kind stops git-spice matching anything
      const offer = offerFor(unrecognized({ ...GITHUB, recognizedByGitSpice: false }, { kind: null, rejectedKind: 'GitHub', hosts: new Map() }), FACTS);

      // assert
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: 'spice.forge.kind is "GitHub", which git-spice rejects, so it matches no forge in app. Unset it, or set it to one of bitbucket, forgejo, gitea, github, gitlab.',
        fix: null,
      });
    });
  });

  describe('forge-unsupported (E75)', () => {
    /** One forge v1 does not serve: its kind, the name a sentence gives it, and a host of its. */
    // see primer §9 (interface) and §10 (union types: exact strings as members)
    interface Unsupported {
      kind: 'bitbucket' | 'gitea' | 'forgejo' | 'azuredevops';
      name: string;
      host: string;
    }
    const UNSUPPORTED: Unsupported[] = [
      { kind: 'bitbucket', name: 'Bitbucket', host: 'bitbucket.org' },
      { kind: 'gitea', name: 'Gitea', host: 'gitea.corp.com' },
      { kind: 'forgejo', name: 'Forgejo', host: 'codeberg.org' },
      { kind: 'azuredevops', name: 'Azure DevOps', host: 'dev.azure.com' },
    ];

    // see primer §22 (for ... of): one test per forge, named after it
    for (const unsupported of UNSUPPORTED) {
      it(`${unsupported.kind}: says v1 supports GitHub and GitLab, and that the view still works — information`, () => {
        // act
        const forge: Forge = { ...GITHUB, host: unsupported.host, kind: unsupported.kind };
        const offer = offerFor({ kind: 'forge-unsupported', forge }, FACTS);

        // assert
        expect(offer).toStrictEqual({
          severity: 'information',
          message: `app's remote is on ${unsupported.name} (${unsupported.host}); v1 supports GitHub and GitLab, so pull-request actions are off there. The Stack view still works.`,
          fix: null,
        });
      });
    }
  });

  describe('not-logged-in (E67)', () => {
    it('offers `gs auth login --forge github` in a terminal, with GITHUB_TOKEN unset for that one command', () => {
      // act
      const offer = offerFor({ kind: 'not-logged-in', gsPath: 'gs', forge: GITHUB }, FACTS);

      // assert: a token in the terminal's environment would make git-spice refuse the login
      // ("already logged in") — and `--refresh` refuses too (verified 0.31.2)
      expect(offer).toStrictEqual({
        severity: 'warning',
        message: 'git-spice is not logged in to github.com.',
        fix: {
          button: 'Log in',
          action: { kind: 'terminal', argv: ['env', '-u', 'GITHUB_TOKEN', 'gs', 'auth', 'login', '--forge', 'github'] },
          done: 'Logged in to github.com.',
        },
      });
    });

    it('runs a plain login for a forge with no token variable of ours — the probe never sends one, but the type allows it', () => {
      // act
      const offer = offerFor({ kind: 'not-logged-in', gsPath: 'gs', forge: { ...GITHUB, host: 'bitbucket.org', kind: 'bitbucket' } }, FACTS);

      // assert
      expect(offer.fix?.action).toStrictEqual({ kind: 'terminal', argv: ['gs', 'auth', 'login', '--forge', 'bitbucket'] });
    });

    it('unsets GITLAB_TOKEN for GitLab, and runs the executable that answered', () => {
      // act
      const offer = offerFor({ kind: 'not-logged-in', gsPath: 'git-spice', forge: { ...GITHUB, host: 'gitlab.com', kind: 'gitlab' } }, FACTS);

      // assert
      expect(offer.message).toBe('git-spice is not logged in to gitlab.com.');
      expect(offer.fix?.action).toStrictEqual({ kind: 'terminal', argv: ['env', '-u', 'GITLAB_TOKEN', 'git-spice', 'auth', 'login', '--forge', 'gitlab'] });
    });
  });

  describe('gh-missing (E62b — drawn now, produced from item 23)', () => {
    it('lists both when gh is not there at all', () => {
      // act
      const offer = offerFor({ kind: 'gh-missing', forge: GITHUB, missing: ['gh', 'gh-stack'], ghVersion: null, ghMinimum: '2.90.0' }, FACTS);

      // assert
      expect(offer).toStrictEqual({
        severity: 'information',
        message: 'Pull requests on github.com need gh 2.90.0 or newer and its gh-stack extension; missing: gh, gh-stack. Pushing and the local git-spice operations still work.',
        fix: null,
      });
    });

    it('quotes the version of a gh that is too old', () => {
      // act
      const offer = offerFor({ kind: 'gh-missing', forge: GITHUB, missing: ['gh'], ghVersion: '2.40.1', ghMinimum: '2.90.0' }, FACTS);

      // assert
      expect(offer.message).toBe('Pull requests on github.com need gh 2.90.0 or newer and its gh-stack extension; missing: gh (found 2.40.1). Pushing and the local git-spice operations still work.');
    });

    it('lists only the extension when gh itself is fine', () => {
      // act
      const offer = offerFor({ kind: 'gh-missing', forge: GITHUB, missing: ['gh-stack'], ghVersion: '2.91.0', ghMinimum: '2.90.0' }, FACTS);

      // assert
      expect(offer.message).toBe('Pull requests on github.com need gh 2.90.0 or newer and its gh-stack extension; missing: gh-stack. Pushing and the local git-spice operations still work.');
    });
  });
});

describe('readyMessage', () => {
  it('names the version, the repository and the host', () => {
    // arrange
    const ready: Ready = { kind: 'ready', gsPath: 'git-spice', gsVersion: '0.31.2', forge: GITHUB };

    // act
    const message = readyMessage(ready, ROOT);

    // assert
    expect(message).toBe('git-spice 0.31.2 is ready for app (github.com).');
  });
});

describe('trunkBranchFor — which local branch `gs repo init --trunk` can be given', () => {
  // The question git is asked about the trunk ref, as the fake keys it: args joined by spaces.
  // see primer §12 (template strings)
  const symbolic = (ref: string): string => `rev-parse --verify --quiet --symbolic-full-name --end-of-options ${ref}`;
  const localBranch = (branch: string): string => `rev-parse --verify --quiet refs/heads/${branch}`;
  // What git prints for a ref that exists, and an Error for "git exited non-zero".
  const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n';
  const MISSING = new Error('exit 1');

  // see primer §6 (async / await)
  it('is none, asking git nothing, when there is no trunk (E4)', async () => {
    // arrange
    const git = new FakeGitRunner(new Map());

    // act
    const answer = await trunkBranchFor(git, ROOT, null);

    // assert
    expect(answer).toStrictEqual({ kind: 'none' });
    expect(git.calls).toStrictEqual([]);
  });

  it('is the branch itself for a local trunk — one question', async () => {
    // arrange
    const git = new FakeGitRunner(new Map([[symbolic('main'), 'refs/heads/main\n']]));

    // act
    const answer = await trunkBranchFor(git, ROOT, 'main');

    // assert
    expect(answer).toStrictEqual({ kind: 'local', branch: 'main' });
    expect(git.calls).toStrictEqual([{ args: ['rev-parse', '--verify', '--quiet', '--symbolic-full-name', '--end-of-options', 'main'], cwd: ROOT }]);
  });

  it('is the local branch of the same name for a remote-tracking trunk, once git confirms it exists', async () => {
    // arrange
    const git = new FakeGitRunner(
      new Map<string, string | Error>([
        [symbolic('origin/main'), 'refs/remotes/origin/main\n'],
        [localBranch('main'), SHA],
      ]),
    );

    // act
    const answer = await trunkBranchFor(git, ROOT, 'origin/main');

    // assert: both questions, in order, both in the repository
    expect(answer).toStrictEqual({ kind: 'local', branch: 'main' });
    // see primer §25 (arrays: `map`, `join`)
    expect(git.calls.map((call) => call.args.join(' '))).toStrictEqual([symbolic('origin/main'), localBranch('main')]);
    expect(git.calls.map((call) => call.cwd)).toStrictEqual([ROOT, ROOT]);
  });

  it('is missing when the remote-tracking trunk has no local branch yet', async () => {
    // arrange
    const git = new FakeGitRunner(
      new Map<string, string | Error>([
        [symbolic('origin/main'), 'refs/remotes/origin/main\n'],
        [localBranch('main'), MISSING],
      ]),
    );

    // act
    const answer = await trunkBranchFor(git, ROOT, 'origin/main');

    // assert
    expect(answer).toStrictEqual({ kind: 'missing', branch: 'main', trunk: 'origin/main' });
  });

  it('takes the branch from the ref, not from prCascade.remote — a trunk on another remote keeps its own name', async () => {
    // arrange: a fork, trunk upstream/release/2.0
    const git = new FakeGitRunner(
      new Map<string, string | Error>([
        [symbolic('upstream/release/2.0'), 'refs/remotes/upstream/release/2.0\n'],
        [localBranch('release/2.0'), SHA],
      ]),
    );

    // act
    const answer = await trunkBranchFor(git, ROOT, 'upstream/release/2.0');

    // assert
    expect(answer).toStrictEqual({ kind: 'local', branch: 'release/2.0' });
  });

  it('is not-a-branch for a tag', async () => {
    // arrange
    const git = new FakeGitRunner(new Map([[symbolic('v1'), 'refs/tags/v1\n']]));

    // act
    const answer = await trunkBranchFor(git, ROOT, 'v1');

    // assert
    expect(answer).toStrictEqual({ kind: 'not-a-branch', trunk: 'v1' });
  });

  it('is not-a-branch for a commit, or an ambiguous name — git prints no full name for either', async () => {
    // arrange
    const git = new FakeGitRunner(new Map([[symbolic('a1b2c3d'), '']]));

    // act
    const answer = await trunkBranchFor(git, ROOT, 'a1b2c3d');

    // assert
    expect(answer).toStrictEqual({ kind: 'not-a-branch', trunk: 'a1b2c3d' });
  });

  it('is not-a-branch for a name git no longer knows', async () => {
    // arrange
    const git = new FakeGitRunner(new Map<string, string | Error>([[symbolic('gone'), MISSING]]));

    // act
    const answer = await trunkBranchFor(git, ROOT, 'gone');

    // assert
    expect(answer).toStrictEqual({ kind: 'not-a-branch', trunk: 'gone' });
  });
});
