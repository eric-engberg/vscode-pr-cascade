/**
 * test/unit/forge.test.ts — core/forge.ts as a specification: every remote URL form plan §7.5
 * lists and the forge kind for every host §8 E65 names, the `spice.forge.*` overrides as git
 * prints them, git-spice's matching rules (subdomains, case, ports, a url key displacing a
 * default host, a rejected kind), `ghEnv`, and `detectForge` against FakeGitRunner — the
 * exact git commands it runs and where it stops.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on:
 * src/core/forge.ts, test/helpers/fakeGit.ts. Real repositories are in
 * test/git/remote.git.test.ts. Plan: §10.1 item 16, §7.5, §7.6, §8 E21/E22/E25/E60/E65/E70, §9.4.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { describe, expect, it } from 'vitest';
import { classifyHost, detectForge, ghEnv, parseForgeConfig, parseRemoteUrl } from '../../src/core/forge';
import type { ForgeConfig, ForgeKind, HostAddress, RemoteRepository } from '../../src/core/forge';
import { FakeGitRunner } from '../helpers/fakeGit';

// The repository every detectForge test asks about. Nothing here touches the disk.
// see primer §4 (const)
const ROOT = '/work/app';

// The two commands detectForge runs, as the fake keys them (args joined by spaces). The
// pattern is git's, handed over as one argument: `^spice\.forge\.` with the dots escaped.
const GET_URL_KEY = 'remote get-url origin';
const CONFIG_KEY = 'config --get-regexp ^spice\\.forge\\.';

// An Error as the canned value means "git exited non-zero": `remote get-url` exits 2 for a
// remote that does not exist, `config --get-regexp` exits 1 when nothing matches.
const MISSING = new Error('exit 2');

// No `spice.forge.*` configuration at all: what parseForgeConfig('') gives, built by hand so
// the classifyHost tests do not depend on the parser.
// see primer §9 (an object literal that satisfies an interface), §16 and §19 (Map)
const NO_CONFIG: ForgeConfig = { kind: null, rejectedKind: null, hosts: new Map() };

/** The expectation for github.com/org/repo, which most URL forms below spell. */
const GITHUB_ORG_REPO: RemoteRepository = { host: 'github.com', port: '', owner: 'org', repo: 'repo' };

/** A configuration with one `spice.forge.<kind>.url`, naming `host` (and `port`, usually none). */
// see primer §3 (functions and type annotations) and §13 (default parameters)
function configured(kind: ForgeKind, host: string, port: string = ''): ForgeConfig {
  return { kind: null, rejectedKind: null, hosts: new Map([[kind, { host, port }]]) };
}

/** The remote's side of a host comparison: a hostname, and its port when the URL named one. */
function at(host: string, port: string = ''): HostAddress {
  return { host, port };
}

// see primer §5 (arrow functions)
describe('parseRemoteUrl', () => {
  // Every form plan §7.5 lists and the ones E65 adds, each with what it must give. One test
  // per row, so a failure names the URL that broke (the house table form, test/unit/uri.test.ts).
  // see primer §9 (an object type written inline, with `[]` after it: an array of such rows)
  // and §59 (the same inline shape as a union member)
  const forms: { url: string; expected: RemoteRepository; note: string }[] = [
    { url: 'git@github.com:org/repo.git', expected: GITHUB_ORG_REPO, note: 'scp-like, the common ssh form' },
    { url: 'github.com:org/repo.git', expected: GITHUB_ORG_REPO, note: 'scp-like without a user — a valid URL with scheme `github.com:` to new URL, so the regex must come first' },
    { url: 'git@github.com:/org/repo.git', expected: GITHUB_ORG_REPO, note: 'scp-like with a leading slash in the path' },
    { url: 'git@github.com:org/repo', expected: GITHUB_ORG_REPO, note: 'scp-like, no .git' },
    { url: 'git@github.com:org/repo.git/', expected: GITHUB_ORG_REPO, note: 'scp-like, trailing slash' },
    { url: 'cd:/org/repo.git', expected: { host: 'cd', port: '', owner: 'org', repo: 'repo' }, note: 'two letters are a host, as they are to git — only one letter is a Windows drive' },
    { url: 'Git@GitHub.com:Org/Repo.git', expected: { host: 'GitHub.com', port: '', owner: 'Org', repo: 'Repo' }, note: 'spelling is kept everywhere — git-spice compares the host as text, so the host\'s case must survive to be compared' },
    { url: 'ssh://git@github.com/org/repo.git', expected: GITHUB_ORG_REPO, note: 'ssh URL' },
    { url: 'ssh://git@ghes.corp.com:2222/org/repo.git', expected: { host: 'ghes.corp.com', port: '2222', owner: 'org', repo: 'repo' }, note: 'ssh URL with a port — kept apart from the host, which GH_HOST and messages want alone' },
    { url: 'ssh://git@GitHub.com/Org/Repo.git', expected: { host: 'GitHub.com', port: '', owner: 'Org', repo: 'Repo' }, note: 'the URL class leaves an ssh host\'s case alone, and so does the parser' },
    { url: 'ssh://git@github.com/org/repo.git/', expected: GITHUB_ORG_REPO, note: 'ssh URL, trailing slash' },
    { url: 'ssh://git@[::1]/org/repo.git', expected: { host: '[::1]', port: '', owner: 'org', repo: 'repo' }, note: 'an IPv6 literal in URL form — kept as the URL class spells it, brackets included; only the scp-like spelling is refused' },
    { url: 'git+ssh://git@github.com/org/repo.git', expected: GITHUB_ORG_REPO, note: 'the git+ssh scheme' },
    { url: 'git://github.com/org/repo.git', expected: GITHUB_ORG_REPO, note: 'the git protocol' },
    { url: 'https://github.com/org/repo', expected: GITHUB_ORG_REPO, note: 'https, no .git' },
    { url: 'https://github.com/org/repo/', expected: GITHUB_ORG_REPO, note: 'https, trailing slash' },
    { url: 'https://github.com/org/repo.git/', expected: GITHUB_ORG_REPO, note: 'https, .git and a trailing slash' },
    { url: 'https://GitHub.com/org/repo.git', expected: { host: 'GitHub.com', port: '', owner: 'org', repo: 'repo' }, note: 'the URL class lower-cases the host of a special scheme (https); the parser puts the spelling back, because git-spice compares it as typed' },
    { url: 'HTTPS://GitHub.com/org/repo.git', expected: { host: 'GitHub.com', port: '', owner: 'org', repo: 'repo' }, note: 'scheme in capitals — a URL to the URL class (git-spice reads an upper-case scheme as scp-like and finds no forge; outside the mirror)' },
    { url: 'https://github.com:443/org/repo.git', expected: GITHUB_ORG_REPO, note: 'the URL class drops a scheme\'s default port, so this reads as no port (git-spice keeps it — one of the documented disagreements)' },
    { url: 'https://GitHub.com:token@github.com/org/repo.git', expected: GITHUB_ORG_REPO, note: 'a user that repeats the host in another case — the host\'s spelling is taken, not the user\'s' },
    { url: 'https://bücher.example/org/repo.git', expected: { host: 'xn--bcher-kva.example', port: '', owner: 'org', repo: 'repo' }, note: 'an internationalised host — the URL class re-encodes it where git-spice keeps the text (a documented disagreement)' },
    { url: 'https://user@ghes.corp.com/org/repo.git', expected: { host: 'ghes.corp.com', port: '', owner: 'org', repo: 'repo' }, note: 'https with a user — dropped' },
    { url: 'https://user:pass@ghes.corp.com:8443/org/repo.git', expected: { host: 'ghes.corp.com', port: '8443', owner: 'org', repo: 'repo' }, note: 'credentials dropped, the https port kept' },
    { url: 'https://github.com/org/repo.git?x=1#frag', expected: GITHUB_ORG_REPO, note: 'a query and a fragment — ignored' },
    { url: 'http://gitea.local:3000/org/repo.git', expected: { host: 'gitea.local', port: '3000', owner: 'org', repo: 'repo' }, note: 'plain http on a port, a self-hosted gitea' },
    { url: 'https://gitlab.com/group/sub/repo.git', expected: { host: 'gitlab.com', port: '', owner: 'group/sub', repo: 'repo' }, note: 'a GitLab subgroup (E65): the whole namespace is the owner' },
    { url: 'git@gitlab.example.com:group/sub/deeper/repo.git', expected: { host: 'gitlab.example.com', port: '', owner: 'group/sub/deeper', repo: 'repo' }, note: 'self-hosted GitLab, three levels' },
    { url: 'git@bitbucket.org:team/repo.git', expected: { host: 'bitbucket.org', port: '', owner: 'team', repo: 'repo' }, note: 'Bitbucket Cloud' },
    { url: 'ssh://git@bitbucket.corp.com:7999/proj/repo.git', expected: { host: 'bitbucket.corp.com', port: '7999', owner: 'proj', repo: 'repo' }, note: 'Bitbucket Data Center on its usual ssh port' },
    { url: 'git@codeberg.org:org/repo.git', expected: { host: 'codeberg.org', port: '', owner: 'org', repo: 'repo' }, note: 'Codeberg (Forgejo)' },
    { url: 'https://dev.azure.com/org/project/_git/repo', expected: { host: 'dev.azure.com', port: '', owner: 'org/project/_git', repo: 'repo' }, note: 'Azure DevOps https — the owner is left as the path says it until M11 reads it' },
    { url: 'git@ssh.dev.azure.com:v3/org/project/repo', expected: { host: 'ssh.dev.azure.com', port: '', owner: 'v3/org/project', repo: 'repo' }, note: 'Azure DevOps ssh' },
    { url: 'https://org.visualstudio.com/project/_git/repo', expected: { host: 'org.visualstudio.com', port: '', owner: 'project/_git', repo: 'repo' }, note: 'Azure DevOps, the older host' },
    { url: '  git@github.com:org/repo.git\n', expected: GITHUB_ORG_REPO, note: 'surrounding whitespace, as `git remote get-url` prints it with a newline' },
  ];

  // see primer §22 (for ... of), §12 (template strings) and §50 (`JSON.stringify`: quotes the
  // URL so a space or a newline in it is visible in the test's name)
  for (const form of forms) {
    it(`reads ${JSON.stringify(form.url)} — ${form.note} (E21, E65)`, () => {
      // act
      const repository = parseRemoteUrl(form.url);

      // assert: exactly these four fields, nothing else
      expect(repository).toStrictEqual(form.expected);
    });
  }

  it('removes exactly one .git suffix: repo.git.git is the repository repo.git', () => {
    // act
    const repository = parseRemoteUrl('https://github.com/org/repo.git.git');

    // assert
    expect(repository).toStrictEqual({ host: 'github.com', port: '', owner: 'org', repo: 'repo.git' });
  });

  it('removes only a lower-case .git — Repo.GIT is a repository called Repo.GIT', () => {
    // act
    const repository = parseRemoteUrl('https://github.com/org/Repo.GIT');

    // assert
    expect(repository).toStrictEqual({ host: 'github.com', port: '', owner: 'org', repo: 'Repo.GIT' });
  });

  it('keeps percent-encoding in the path as the URL spelled it', () => {
    // act: a space in a path is `%20` in a URL; git would send it on encoded, and so does the parser
    const repository = parseRemoteUrl('https://github.com/org/my%20repo.git');

    // assert
    expect(repository).toStrictEqual({ host: 'github.com', port: '', owner: 'org', repo: 'my%20repo' });
  });

  // Text that names no forge repository: a local path (what the fixture's bare origin is),
  // `file:` (always a local path to git, whatever follows the slashes), a bare host, fewer
  // than two path segments, an empty segment, garbage. Each must be null, never a throw.
  const notForgeUrls: { text: string; note: string }[] = [
    { text: '', note: 'empty' },
    { text: 'not a url', note: 'words' },
    { text: '/private/tmp/x/origin.git', note: 'an absolute local path — the fixture\'s bare origin' },
    { text: '../origin.git', note: 'a relative local path' },
    { text: 'file:///tmp/origin.git', note: 'file: with no host' },
    { text: 'file://server/share/repo.git', note: 'file: with a host — still a local path to git' },
    { text: 'C:\\repos\\x.git', note: 'a Windows drive, not a host called C' },
    { text: 'C:/Users/me/repo', note: 'a Windows drive with forward slashes' },
    { text: '[::1]:org/repo.git', note: 'an IPv6 literal in the scp-like form (outside §7.5\'s list; documented, not handled)' },
    { text: 'git@[::1]:org/repo.git', note: 'the same with a user — never read as host `git@[`' },
    { text: '[2001:db8::1]:org/repo.git', note: 'a real IPv6 literal — never read as host `[2001`' },
    { text: 'git@[2001:db8::1]:org/repo.git', note: 'a real IPv6 literal with a user' },
    { text: '@github.com:org/repo.git', note: 'an empty user' },
    { text: 'https://github.com', note: 'no path' },
    { text: 'https://github.com/', note: 'a bare host' },
    { text: 'https://github.com/org', note: 'one path segment' },
    { text: 'git@github.com:repo.git', note: 'scp-like, one segment' },
    { text: 'git@github.com:', note: 'scp-like, no path' },
    { text: 'localhost:repo.git', note: 'scp-like, one segment on a local host' },
    { text: 'git@github.com:org//repo.git', note: 'an empty segment' },
    { text: 'https://github.com//org/repo.git', note: 'an empty first segment' },
    { text: 'https://github.com/org/.git', note: 'a repository name that is only the suffix' },
    { text: 'ssh://git@github.com', note: 'ssh URL, no path' },
    { text: 'ssh://github.com:org/repo.git', note: 'an ssh URL with the scp-like colon — new URL refuses it' },
    { text: 'g:org/repo.git', note: 'a one-letter host (a drive letter to git on Windows; documented limit)' },
  ];

  for (const candidate of notForgeUrls) {
    it(`returns null for ${JSON.stringify(candidate.text)} — ${candidate.note} (E21)`, () => {
      // act
      const repository = parseRemoteUrl(candidate.text);

      // assert
      expect(repository).toBeNull();
    });
  }
});

describe('parseForgeConfig', () => {
  it('reads nothing from empty output — the exit-1 case of `git config --get-regexp`', () => {
    // act
    const config = parseForgeConfig('');

    // assert
    expect(config).toStrictEqual(NO_CONFIG);
  });

  it('reads the host out of spice.forge.github.url', () => {
    // act: `key value` per line, exactly as git prints it
    const config = parseForgeConfig('spice.forge.github.url https://ghes.corp.com\n');

    // assert
    expect(config.hosts.get('github')).toStrictEqual({ host: 'ghes.corp.com', port: '' });
    expect(config.hosts.size).toBe(1);
    expect(config.kind).toBeNull();
  });

  it('keeps the hostname and the port exactly as typed — git-spice compares both as text', () => {
    // act
    const config = parseForgeConfig('spice.forge.github.url https://GHES.Corp.com:8443/\n');

    // assert: the scheme and the trailing slash go, the case and the port stay
    expect(config.hosts.get('github')).toStrictEqual({ host: 'GHES.Corp.com', port: '8443' });
  });

  it('reads one host per forge kind', () => {
    // act
    const config = parseForgeConfig(
      'spice.forge.github.url https://ghes.corp.com\nspice.forge.gitlab.url https://gitlab.corp.com\n',
    );

    // assert
    expect(config.hosts.get('github')).toStrictEqual({ host: 'ghes.corp.com', port: '' });
    expect(config.hosts.get('gitlab')).toStrictEqual({ host: 'gitlab.corp.com', port: '' });
  });

  it('lets the last value for a key win, as `git config --get` does', () => {
    // act
    const config = parseForgeConfig('spice.forge.github.url https://one.example\nspice.forge.github.url https://two.example\n');

    // assert
    expect(config.hosts.get('github')).toStrictEqual({ host: 'two.example', port: '' });
  });

  it('reads spice.forge.kind when it is one of git-spice\'s five forge ids', () => {
    // act
    const config = parseForgeConfig('spice.forge.kind gitlab\n');

    // assert
    expect(config.kind).toBe('gitlab');
    expect(config.rejectedKind).toBeNull();
  });

  it('reports a spice.forge.kind git-spice rejects — nonsense, azuredevops, GitHub — rather than ignoring it', () => {
    // act: 0.31.2's ids are bitbucket, forgejo, gitea, github, gitlab, case-sensitively; with
    // any other value it refuses every forge-touching command (`unknown forge: "GitHub"`)
    const nonsense = parseForgeConfig('spice.forge.kind nonsense\n');
    const azure = parseForgeConfig('spice.forge.kind azuredevops\n');
    const capitals = parseForgeConfig('spice.forge.kind GitHub\n');

    // assert
    expect(nonsense.kind).toBeNull();
    expect(nonsense.rejectedKind).toBe('nonsense');
    expect(azure.rejectedKind).toBe('azuredevops');
    expect(capitals.rejectedKind).toBe('GitHub');
  });

  it('lets the last spice.forge.kind win, whichever way round — as git-spice reads it', () => {
    // act: verified with 0.31.2: `nonsense` then `gitlab` resolves gitlab; the reverse fails
    const repaired = parseForgeConfig('spice.forge.kind nonsense\nspice.forge.kind gitlab\n');
    const broken = parseForgeConfig('spice.forge.kind gitlab\nspice.forge.kind nonsense\n');

    // assert
    expect(repaired.kind).toBe('gitlab');
    expect(repaired.rejectedKind).toBeNull();
    expect(broken.kind).toBeNull();
    expect(broken.rejectedKind).toBe('nonsense');
  });

  it('treats an empty spice.forge.kind as unset, as git-spice does', () => {
    // act: `git config spice.forge.kind ''` prints as the key and one space, which matches no line
    const config = parseForgeConfig('spice.forge.kind \n');

    // assert
    expect(config.kind).toBeNull();
    expect(config.rejectedKind).toBeNull();
  });

  it('keeps a value\'s trailing space, which git-spice rejects — `gitlab ` is not gitlab', () => {
    // act: only a CRLF\'s `\\r` is stripped, never a value\'s own whitespace
    const config = parseForgeConfig('spice.forge.kind gitlab \n');

    // assert
    expect(config.kind).toBeNull();
    expect(config.rejectedKind).toBe('gitlab ');
  });

  it('ignores the other spice.forge.* keys — apiurl, bitbucket.kind', () => {
    // act: `--get-regexp` matches them too; only `.url` of a forge id names a host
    const config = parseForgeConfig('spice.forge.github.apiurl https://ghes.corp.com/api/v3\nspice.forge.bitbucket.kind dc\n');

    // assert
    expect(config).toStrictEqual(NO_CONFIG);
  });

  it('ignores a url for a kind git-spice 0.31.2 has no forge for (azuredevops)', () => {
    // act
    const config = parseForgeConfig('spice.forge.azuredevops.url https://dev.azure.com\n');

    // assert
    expect(config.hosts.size).toBe(0);
  });

  it('keeps a value that is not a URL as an empty host, which displaces the default and matches nothing — as git-spice does', () => {
    // act: a bare hostname is a configuration mistake; verified with 0.31.2, a github.com remote
    // beside `spice.forge.github.url ghes.corp.com` is "no forge found"
    const bare = parseForgeConfig('spice.forge.github.url ghes.corp.com\n');
    const schemeOnly = parseForgeConfig('spice.forge.github.url https://\n');

    // assert
    expect(bare.hosts.get('github')).toStrictEqual({ host: '', port: '' });
    expect(schemeOnly.hosts.get('github')).toStrictEqual({ host: '', port: '' });
  });

  it('ignores a key whose subsection is not lower-case — git keeps it as typed, and git-spice reads the lower-case key', () => {
    // act: `git config spice.forge.GitHub.url …` prints back `spice.forge.GitHub.url`
    const config = parseForgeConfig('spice.forge.GitHub.url https://ghes.corp.com\n');

    // assert
    expect(config.hosts.size).toBe(0);
  });

  it('reads CRLF line endings like LF', () => {
    // act
    const config = parseForgeConfig('spice.forge.kind github\r\nspice.forge.github.url https://ghes.corp.com\r\n');

    // assert
    expect(config.kind).toBe('github');
    expect(config.hosts.get('github')).toStrictEqual({ host: 'ghes.corp.com', port: '' });
  });
});

describe('classifyHost', () => {
  // The hosts E65 names, with no spice.forge.* configuration: git-spice's own defaults and
  // their subdomains are recognised; the extension's guesses (`*.ghe.com`, Azure, a default
  // host spelled with capitals) are not, which is E70's input; everything else is unknown,
  // which is E60's.
  const defaults: { host: string; kind: ForgeKind; recognized: boolean; note: string }[] = [
    { host: 'github.com', kind: 'github', recognized: true, note: 'git-spice\'s default' },
    { host: 'ssh.github.com', kind: 'github', recognized: true, note: 'GitHub\'s port-443 ssh host — a subdomain of the default, which git-spice matches' },
    { host: 'GitHub.com', kind: 'github', recognized: false, note: 'the default spelled with capitals — git-spice compares text and finds no forge; the extension still knows what it is (E70)' },
    { host: 'SSH.GitHub.com', kind: 'github', recognized: false, note: 'a subdomain of a default spelled with capitals — guessed, not matched' },
    { host: 'eu.ghe.com', kind: 'github', recognized: false, note: 'GitHub Enterprise Cloud with data residency — the extension\'s guess, not git-spice\'s (E70)' },
    { host: 'ghe.com', kind: 'unknown', recognized: false, note: 'the bare domain hosts no repositories, so it is not guessed' },
    { host: 'gitlab.com', kind: 'gitlab', recognized: true, note: 'git-spice\'s default' },
    { host: 'altssh.gitlab.com', kind: 'gitlab', recognized: true, note: 'GitLab\'s alternate ssh host — a subdomain' },
    { host: 'gitlab.example.com', kind: 'unknown', recognized: false, note: 'self-hosted GitLab without spice.forge.gitlab.url (E60)' },
    { host: 'bitbucket.org', kind: 'bitbucket', recognized: true, note: 'Bitbucket Cloud, git-spice\'s default' },
    { host: 'bitbucket.corp.com', kind: 'unknown', recognized: false, note: 'Bitbucket Data Center without spice.forge.bitbucket.url' },
    { host: 'codeberg.org', kind: 'forgejo', recognized: true, note: 'git-spice\'s default Forgejo host' },
    { host: 'gitea.com', kind: 'unknown', recognized: false, note: 'git-spice 0.31.2 has no default gitea host' },
    { host: 'dev.azure.com', kind: 'azuredevops', recognized: false, note: 'Azure DevOps — the extension\'s word; git-spice 0.31.2 has no Azure forge' },
    { host: 'ssh.dev.azure.com', kind: 'azuredevops', recognized: false, note: 'Azure DevOps over ssh' },
    { host: 'org.visualstudio.com', kind: 'azuredevops', recognized: false, note: 'Azure DevOps, the older host' },
    { host: 'example.com', kind: 'unknown', recognized: false, note: 'anything else' },
  ];

  // see primer §48 (the conditional expression)
  for (const row of defaults) {
    it(`classifies ${row.host} as ${row.kind}${row.recognized ? '' : ', not recognised by git-spice'} — ${row.note} (E65)`, () => {
      // act
      const forge = classifyHost(at(row.host), NO_CONFIG);

      // assert
      expect(forge).toStrictEqual({ kind: row.kind, recognizedByGitSpice: row.recognized });
    });
  }

  describe('with a spice.forge.<kind>.url', () => {
    it('recognises a self-hosted GitLab once spice.forge.gitlab.url names it', () => {
      // act
      const forge = classifyHost(at('gitlab.example.com'), configured('gitlab', 'gitlab.example.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'gitlab', recognizedByGitSpice: true });
    });

    it('recognises a Bitbucket Data Center host through spice.forge.bitbucket.url — one bitbucket kind in v1', () => {
      // act
      const forge = classifyHost(at('bitbucket.corp.com'), configured('bitbucket', 'bitbucket.corp.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'bitbucket', recognizedByGitSpice: true });
    });

    it('classifies a gitea host only through spice.forge.gitea.url', () => {
      // act
      const forge = classifyHost(at('gitea.local'), configured('gitea', 'gitea.local'));

      // assert
      expect(forge).toStrictEqual({ kind: 'gitea', recognizedByGitSpice: true });
    });

    it('classifies a self-hosted Forgejo through spice.forge.forgejo.url', () => {
      // act
      const forge = classifyHost(at('forge.example.org'), configured('forgejo', 'forge.example.org'));

      // assert
      expect(forge).toStrictEqual({ kind: 'forgejo', recognizedByGitSpice: true });
    });

    it('recognises a *.ghe.com host once spice.forge.github.url names it — E70 resolved', () => {
      // act
      const forge = classifyHost(at('eu.ghe.com'), configured('github', 'eu.ghe.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'github', recognizedByGitSpice: true });
    });

    it('recognises a subdomain of the configured host, as git-spice does', () => {
      // act: `spice.forge.github.url https://corp.com` covers every host under corp.com
      const forge = classifyHost(at('ghes.corp.com'), configured('github', 'corp.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'github', recognizedByGitSpice: true });
    });

    it('does not match a bare suffix — notcorp.com is not under corp.com', () => {
      // act
      const forge = classifyHost(at('notcorp.com'), configured('github', 'corp.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'unknown', recognizedByGitSpice: false });
    });

    it('does not match the other way round — corp.com is not under ghes.corp.com', () => {
      // act
      const forge = classifyHost(at('corp.com'), configured('github', 'ghes.corp.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'unknown', recognizedByGitSpice: false });
    });

    it('ignores a configured url whose host is a different one', () => {
      // act: spice.forge.github.url names another host; this one stays unknown
      const forge = classifyHost(at('ghes.corp.com'), configured('github', 'other.example.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'unknown', recognizedByGitSpice: false });
    });

    it('compares the configured host as text — a spelling in capitals does not match a lower-case remote', () => {
      // act: verified with 0.31.2: `https://GHES.Corp.com` against `ghes.corp.com` is "no forge found"
      const forge = classifyHost(at('ghes.corp.com'), configured('github', 'GHES.Corp.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'unknown', recognizedByGitSpice: false });
    });

    it('requires the remote\'s port to match when the configured url names one', () => {
      // act: `https://ghes.corp.com:8443` against an ssh remote on 2222, on no port, and on 8443
      const otherPort = classifyHost(at('ghes.corp.com', '2222'), configured('github', 'ghes.corp.com', '8443'));
      const noPort = classifyHost(at('ghes.corp.com'), configured('github', 'ghes.corp.com', '8443'));
      const samePort = classifyHost(at('ghes.corp.com', '8443'), configured('github', 'ghes.corp.com', '8443'));

      // assert
      expect(otherPort).toStrictEqual({ kind: 'unknown', recognizedByGitSpice: false });
      expect(noPort).toStrictEqual({ kind: 'unknown', recognizedByGitSpice: false });
      expect(samePort).toStrictEqual({ kind: 'github', recognizedByGitSpice: true });
    });

    it('ignores the remote\'s port when the configured url names none', () => {
      // act: the usual pairing — a web URL in the config, an ssh remote on 2222
      const forge = classifyHost(at('ghes.corp.com', '2222'), configured('github', 'ghes.corp.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'github', recognizedByGitSpice: true });
    });

    it('lets a spice.forge.github.url replace github.com as git-spice\'s GitHub — github.com itself is then unrecognised (E70)', () => {
      // act: the ordinary enterprise setup — a global github.url for the company GHES — and a
      // github.com side project: verified with 0.31.2, "no forge found for git@github.com:…"
      const forge = classifyHost(at('github.com'), configured('github', 'ghes.corp.com'));

      // assert: the extension still knows it is GitHub, so E70 can offer `git config
      // spice.forge.github.url https://github.com` in that repository
      expect(forge).toStrictEqual({ kind: 'github', recognizedByGitSpice: false });
    });

    it('guesses github for a subdomain of the displaced default — ssh.github.com beside a GHES url is still GitHub to the extension, so E70 offers the key', () => {
      // act
      const forge = classifyHost(at('ssh.github.com'), configured('github', 'ghes.corp.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'github', recognizedByGitSpice: false });
    });

    it('lets a url value that is not a URL displace the default too — github.com is unrecognised beside `spice.forge.github.url ghes.corp.com`', () => {
      // act: verified with 0.31.2 — "no forge found"; E70\'s offer is `https://github.com`
      const forge = classifyHost(at('github.com'), configured('github', ''));

      // assert
      expect(forge).toStrictEqual({ kind: 'github', recognizedByGitSpice: false });
    });

    it('leaves the other kinds\' default hosts in place — a gitlab url does not displace github.com', () => {
      // act
      const forge = classifyHost(at('github.com'), configured('gitlab', 'gitlab.example.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'github', recognizedByGitSpice: true });
    });

    it('still recognises github.com when spice.forge.github.url names github.com explicitly', () => {
      // act
      const forge = classifyHost(at('github.com'), configured('github', 'github.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'github', recognizedByGitSpice: true });
    });

    it('breaks a tie between two kinds configured for one host by the id list\'s order — bitbucket before github; git-spice itself is not deterministic here', () => {
      // arrange: measured with 0.31.2 — its answer flips between runs
      const config: ForgeConfig = {
        kind: null,
        rejectedKind: null,
        hosts: new Map([
          ['github', { host: 'x.example', port: '' }],
          ['bitbucket', { host: 'x.example', port: '' }],
        ]),
      };

      // act
      const forge = classifyHost(at('x.example'), config);

      // assert: either kind is one git-spice recognises, so the flag is honest whichever it picks
      expect(forge).toStrictEqual({ kind: 'bitbucket', recognizedByGitSpice: true });
    });

    it('breaks a tie between a url key naming another kind\'s default host and that default by the same order — github before gitlab', () => {
      // act: spice.forge.gitlab.url names github.com, so both forges match in git-spice (which
      // answers github or gitlab at random); the extension answers by the id list
      const forge = classifyHost(at('github.com'), configured('gitlab', 'github.com'));

      // assert
      expect(forge).toStrictEqual({ kind: 'github', recognizedByGitSpice: true });
    });
  });

  describe('with spice.forge.kind', () => {
    it('takes spice.forge.kind for a host that says nothing — an ssh alias', () => {
      // arrange: the remote is `work:org/repo.git`; `work` is an alias in ~/.ssh/config
      const config: ForgeConfig = { kind: 'github', rejectedKind: null, hosts: new Map() };

      // act
      const forge = classifyHost(at('work'), config);

      // assert
      expect(forge).toStrictEqual({ kind: 'github', recognizedByGitSpice: true });
    });

    it('lets spice.forge.kind win over the host, as git-spice does', () => {
      // arrange: verified with git-spice 0.31.2 — `spice.forge.kind gitlab` and a github.com
      // remote make it ask GitLab
      const config: ForgeConfig = { kind: 'gitlab', rejectedKind: null, hosts: new Map() };

      // act
      const forge = classifyHost(at('github.com'), config);

      // assert
      expect(forge).toStrictEqual({ kind: 'gitlab', recognizedByGitSpice: true });
    });

    it('checks the remote against the kind\'s own url key when both are set — git-spice refuses a remote that does not match it', () => {
      // arrange: verified with 0.31.2 — `unsupported URL: remote URL "git@github.com:o/r.git" does
      // not match configured forge URL "https://ghes.corp.com"`; a subdomain of it is fine
      const config: ForgeConfig = { kind: 'github', rejectedKind: null, hosts: new Map([['github', { host: 'ghes.corp.com', port: '' }]]) };

      // act
      const mismatch = classifyHost(at('github.com'), config);
      const match = classifyHost(at('ghes.corp.com'), config);
      const subdomain = classifyHost(at('sub.ghes.corp.com'), config);

      // assert
      expect(mismatch).toStrictEqual({ kind: 'github', recognizedByGitSpice: false });
      expect(match).toStrictEqual({ kind: 'github', recognizedByGitSpice: true });
      expect(subdomain).toStrictEqual({ kind: 'github', recognizedByGitSpice: true });
    });

    it('ignores another kind\'s url key when spice.forge.kind is set', () => {
      // arrange: kind gitlab, a github url, a github.com remote — git-spice asks GitLab (verified)
      const config: ForgeConfig = { kind: 'gitlab', rejectedKind: null, hosts: new Map([['github', { host: 'ghes.corp.com', port: '' }]]) };

      // act
      const forge = classifyHost(at('github.com'), config);

      // assert
      expect(forge).toStrictEqual({ kind: 'gitlab', recognizedByGitSpice: true });
    });

    it('reports even github.com as unrecognised while spice.forge.kind holds a value git-spice rejects', () => {
      // arrange: `spice.forge.kind GitHub` — git-spice refuses every forge-touching command,
      // and `gs auth status --forge github` would not notice, so the probe must
      const config: ForgeConfig = { kind: null, rejectedKind: 'GitHub', hosts: new Map() };

      // act
      const forge = classifyHost(at('github.com'), config);

      // assert: the kind the host looks like, so the message can still name the forge
      expect(forge).toStrictEqual({ kind: 'github', recognizedByGitSpice: false });
    });
  });
});

describe('ghEnv', () => {
  it('sets GH_HOST to the host, and nothing else', () => {
    // act
    const env = ghEnv('ghes.corp.com');

    // assert
    expect(env).toStrictEqual({ GH_HOST: 'ghes.corp.com' });
  });

  it('lower-cases the host, as gh itself normalises hostnames', () => {
    // act: a remote spelled `GitHub.com` is still github.com to gh
    const env = ghEnv('GitHub.com');

    // assert
    expect(env).toStrictEqual({ GH_HOST: 'github.com' });
  });

  it('gives every call a fresh object, so one repository\'s environment cannot leak into another\'s (E22)', () => {
    // act
    const first = ghEnv('github.com');
    const second = ghEnv('github.com');

    // assert: equal in content, not the same object
    expect(first).toStrictEqual(second);
    expect(first).not.toBe(second);
  });
});

// see primer §6 (async / await)
describe('detectForge', () => {
  it('runs `remote get-url` and then `config --get-regexp`, both in the repository root', async () => {
    // arrange
    // see primer §31 (type arguments on `new Map`, for a map that holds strings and Errors)
    const git = new FakeGitRunner(
      new Map<string, string | Error>([
        [GET_URL_KEY, 'git@github.com:org/repo.git\n'],
        [CONFIG_KEY, MISSING],
      ]),
    );

    // act
    await detectForge(git, ROOT, 'origin');

    // assert: two commands; the pattern reaches git as one argument with its dots escaped
    expect(git.calls).toEqual([
      { args: ['remote', 'get-url', 'origin'], cwd: ROOT },
      { args: ['config', '--get-regexp', '^spice\\.forge\\.'], cwd: ROOT },
    ]);
  });

  it('answers no-remote after one command when the remote does not exist (E25)', async () => {
    // arrange: `git remote get-url origin` exits 2 — "No such remote"
    const git = new FakeGitRunner(new Map<string, string | Error>([[GET_URL_KEY, MISSING]]));

    // act
    const detection = await detectForge(git, ROOT, 'origin');

    // assert
    expect(detection).toStrictEqual({ kind: 'no-remote', remote: 'origin' });
    expect(git.calls.length).toBe(1);
  });

  it('answers unparseable, with the URL trimmed, after one command for a local-path remote', async () => {
    // arrange: a remote that is a directory on disk — the fixture's bare origin, or a
    // colleague's clone on a shared drive. No forge to configure, so the config is not read.
    const git = new FakeGitRunner(new Map([[GET_URL_KEY, '/work/origin.git\n']]));

    // act
    const detection = await detectForge(git, ROOT, 'origin');

    // assert
    expect(detection).toStrictEqual({ kind: 'unparseable', remote: 'origin', url: '/work/origin.git' });
    expect(git.calls.length).toBe(1);
  });

  it('trims git\'s newline and classifies a github.com remote with nothing configured', async () => {
    // arrange: exit 1 from `config --get-regexp` means "no spice.forge.* keys at all"
    const git = new FakeGitRunner(
      new Map<string, string | Error>([
        [GET_URL_KEY, 'git@github.com:org/repo.git\n'],
        [CONFIG_KEY, MISSING],
      ]),
    );

    // act
    const detection = await detectForge(git, ROOT, 'origin');

    // assert: the whole shape — the repository, its kind, and that git-spice agrees
    expect(detection).toStrictEqual({
      kind: 'forge',
      remote: 'origin',
      forge: { host: 'github.com', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: true },
    });
  });

  it('classifies an unconfigured GitHub Enterprise Server host as unknown and unrecognised (E60)', async () => {
    // arrange
    const git = new FakeGitRunner(
      new Map<string, string | Error>([
        [GET_URL_KEY, 'ssh://git@ghes.corp.com:2222/org/repo.git\n'],
        [CONFIG_KEY, MISSING],
      ]),
    );

    // act
    const detection = await detectForge(git, ROOT, 'origin');

    // assert
    expect(detection).toStrictEqual({
      kind: 'forge',
      remote: 'origin',
      forge: { host: 'ghes.corp.com', port: '2222', owner: 'org', repo: 'repo', kind: 'unknown', recognizedByGitSpice: false },
    });
  });

  it('recognises the same host as github once spice.forge.github.url names it — E70\'s fix', async () => {
    // arrange: the config call now answers with the key the user set; its URL names no port,
    // so the remote's 2222 does not matter
    const git = new FakeGitRunner(
      new Map([
        [GET_URL_KEY, 'ssh://git@ghes.corp.com:2222/org/repo.git\n'],
        [CONFIG_KEY, 'spice.forge.github.url https://ghes.corp.com\n'],
      ]),
    );

    // act
    const detection = await detectForge(git, ROOT, 'origin');

    // assert
    expect(detection).toStrictEqual({
      kind: 'forge',
      remote: 'origin',
      forge: { host: 'ghes.corp.com', port: '2222', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: true },
    });
  });

  it('guesses github for a *.ghe.com host but reports that git-spice will not — E70\'s input', async () => {
    // arrange
    const git = new FakeGitRunner(
      new Map<string, string | Error>([
        [GET_URL_KEY, 'ssh://git@eu.ghe.com/org/repo.git\n'],
        [CONFIG_KEY, MISSING],
      ]),
    );

    // act
    const detection = await detectForge(git, ROOT, 'origin');

    // assert
    expect(detection).toStrictEqual({
      kind: 'forge',
      remote: 'origin',
      forge: { host: 'eu.ghe.com', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: false },
    });
  });

  it('classifies an ssh alias through spice.forge.kind', async () => {
    // arrange: `work` is a Host entry in ~/.ssh/config; the URL alone says nothing
    const git = new FakeGitRunner(
      new Map([
        [GET_URL_KEY, 'work:org/repo.git\n'],
        [CONFIG_KEY, 'spice.forge.kind github\n'],
      ]),
    );

    // act
    const detection = await detectForge(git, ROOT, 'origin');

    // assert
    expect(detection).toStrictEqual({
      kind: 'forge',
      remote: 'origin',
      forge: { host: 'work', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: true },
    });
  });

  it('reports github.com as unrecognised while spice.forge.kind holds a value git-spice rejects', async () => {
    // arrange: a capitalised id — the realistic typo
    const git = new FakeGitRunner(
      new Map([
        [GET_URL_KEY, 'git@github.com:org/repo.git\n'],
        [CONFIG_KEY, 'spice.forge.kind GitHub\n'],
      ]),
    );

    // act
    const detection = await detectForge(git, ROOT, 'origin');

    // assert
    expect(detection).toStrictEqual({
      kind: 'forge',
      remote: 'origin',
      forge: { host: 'github.com', port: '', owner: 'org', repo: 'repo', kind: 'github', recognizedByGitSpice: false },
    });
  });

  it('asks for the remote prCascade.remote names instead of origin', async () => {
    // arrange: a fork, the original repository kept as `upstream`
    const git = new FakeGitRunner(
      new Map<string, string | Error>([
        ['remote get-url upstream', 'git@github.com:org/repo.git\n'],
        [CONFIG_KEY, MISSING],
      ]),
    );

    // act
    const detection = await detectForge(git, ROOT, 'upstream');

    // assert
    expect(detection.remote).toBe('upstream');
    expect(git.calls[0]).toEqual({ args: ['remote', 'get-url', 'upstream'], cwd: ROOT });
  });

  it('lets a rejection from the runner through unchanged — E17 must not be swallowed', async () => {
    // arrange: nothing is canned, so the fake throws from tryRun. Any rejection tryRun does
    // not turn into null — a missing git in the real runner (E17) — must come out of
    // detectForge as it went in: no catch, no retry.
    const git = new FakeGitRunner(new Map());

    // act
    const result = detectForge(git, ROOT, 'origin');

    // assert
    await expect(result).rejects.toThrow(Error);
    expect(git.calls.length).toBe(1);
  });
});
