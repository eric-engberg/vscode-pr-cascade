/**
 * core/forge.ts — which forge a repository's remote points at, and where: the hostname for
 * gh's GH_HOST, the owner and repository name for messages, and the forge kind that decides
 * which CR features v1 offers (GitHub and GitLab) and whether git-spice itself will recognise
 * the host.
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/model.ts (GitRunner) and
 * Node's global URL class. Depended on by: core/backend.ts (a Readiness carries a Forge),
 * core/backends/gitspice.ts (item 18, the readiness probe), src/vscode/login.ts and the tree
 * (items 19–20: the E21/E25/E60/E70/E75 messages), core/ghstatus.ts (item 23, ghEnv).
 * Plan: §4.2, §7.5, §7.6, §8 E21/E22/E25/E60/E65/E70/E75, §9.4, §13.2 D54.
 */

// see primer §1 (import / export) and §9 (`import type`)
import type { GitRunner } from './model';

/**
 * The forges the extension can name. git-spice 0.31.2 knows five — its `--forge` help lists
 * `bitbucket, forgejo, gitea, github, gitlab` — so `azuredevops` is the extension's word
 * alone, kept so E75's message can say which forge it is; `unknown` is every other host.
 * v1 offers CR features on `github` and `gitlab` only (plan §2, E75).
 */
// see primer §10 (union types: exact strings as members)
export type ForgeKind = 'github' | 'gitlab' | 'bitbucket' | 'gitea' | 'forgejo' | 'azuredevops' | 'unknown';

/**
 * The five ids git-spice 0.31.2 accepts in `spice.forge.kind` and as the `<kind>` of
 * `spice.forge.<kind>.url` (verified: its `--forge` flag lists exactly these), in the
 * alphabetical order that flag prints them. git-spice itself tries its forges in no fixed
 * order — its registry is a Go map, walked in unspecified order, first match wins — so when
 * two forges match one remote its answer varies from run to run (verified 0.31.2). This list
 * is the extension's tie-break for that misconfiguration, not an order git-spice has.
 */
// see primer §4 (const) and §14 (readonly arrays)
const GIT_SPICE_FORGE_IDS: readonly ForgeKind[] = ['bitbucket', 'forgejo', 'gitea', 'github', 'gitlab'];

/**
 * A host as git-spice compares it: the hostname exactly as spelled (its comparison is
 * case-sensitive text) and the port, `''` when none. The remote's side comes from
 * parseRemoteUrl, the configured side from a `spice.forge.<kind>.url`.
 */
// see primer §9 (interface)
export interface HostAddress {
  host: string;
  port: string;
}

/**
 * The hosts git-spice 0.31.2 recognises with nothing configured (verified by running
 * `gs auth status` against each): github.com, gitlab.com, bitbucket.org, and codeberg.org as
 * a Forgejo. There is no default gitea host — gitea is reached only through its url key. A
 * subdomain of each counts too (`ssh.github.com`, GitHub's port-443 ssh host), and a
 * configured `spice.forge.<kind>.url` *replaces* that kind's entry here: see gitSpiceMatches
 * and classifyHost.
 */
// see primer §19 (Map: built from a list of pairs) and §14 (`ReadonlyMap`: a Map that can be read but not changed)
const GIT_SPICE_DEFAULT_HOSTS: ReadonlyMap<ForgeKind, string> = new Map<ForgeKind, string>([
  ['github', 'github.com'],
  ['gitlab', 'gitlab.com'],
  ['bitbucket', 'bitbucket.org'],
  ['forgejo', 'codeberg.org'],
]);

/** Plan §7.5's `{ host, owner, repo }` — plus the port, which git-spice compares — as a remote URL names them. */
export interface RemoteRepository extends HostAddress {
  /**
   * The hostname exactly as the remote spells it — `ghes.corp.com`, or `GHES.Corp.com` if that
   * is what the remote says — never with a port or a `git@`. Kept as spelled because git-spice
   * compares it as text, case included: a remote at `GitHub.com` is "no forge found" to it, and
   * E70's offer (`git config spice.forge.github.url https://<host>`) only works when it echoes
   * the remote's spelling (verified 0.31.2). gh's GH_HOST wants a hostname and lower-cases it
   * itself; ghEnv does the same. An internationalised name is the exception: the URL class
   * re-encodes it (punycode for https, percent-encoding for ssh) where git-spice keeps the raw
   * text — one of the known disagreements listed on Forge.recognizedByGitSpice.
   */
  host: string;
  /**
   * The port the URL names, `''` when it names none — and always `''` for the scp-like form,
   * which has no place for one. git-spice compares it when a `spice.forge.<kind>.url` carries a
   * port. One of the known disagreements (Forge.recognizedByGitSpice lists them): the URL class
   * drops a scheme's default port (`https://h:443/` reads as no port) where git-spice keeps it, so
   * a configured URL naming the default port explicitly is matched here and not there.
   */
  port: string;
  /**
   * Every path segment before the last, joined with `/`: `org` on GitHub; `group/sub` for a
   * GitLab subgroup, because GitLab's project path is the whole namespace; on Azure DevOps
   * the raw path (`org/project/_git`), left for M11 to read when Azure becomes a forge
   * (E75).
   */
  owner: string;
  /** The last path segment, one trailing `.git` removed. */
  repo: string;
}

/**
 * git's scp-like form, `[user@]host:path` — `git@github.com:org/repo.git`. Tried only when the
 * text has no `://` (git's own rule: a colon before any slash, and no scheme), and tried
 * FIRST, because `new URL('github.com:org/repo.git')` happily parses that text as a URL with
 * the scheme `github.com:` (primer §69). Group 1 is the host, group 2 the path, which may
 * start with a `/` (`git@host:/org/repo.git`). `(?:[^@/]+@)?` eats an optional user without
 * capturing it. `[^@:/[]{2,}`: a host holds no `@`, `:`, `/` or `[` — excluding `@` is what
 * stops `git@[::1]:…` from being read as the host `git@[`, excluding `[` is what stops
 * `[2001:db8::1]:…` from being read as the host `[2001` — and is at least two characters, so
 * a Windows drive (`C:\repos\x.git`) is not read as a host called `C` while `cd:/org/repo.git`
 * is a host called `cd`, as it is to git. A bracketed IPv6 literal is thus refused rather than
 * misread; it is outside §7.5's list and documented, not handled.
 */
// see primer §20 (regular expression literals: `exec`, capturing groups, `(?:…)`, `[^…]`, `{2,}`)
const SCP_LIKE = /^(?:[^@/]+@)?([^@:/[]{2,}):(.+)$/;

/**
 * Takes a remote URL apart into the repository it names, or `null` when it names none.
 *
 * Three families, all of which `git remote get-url` can print (plan §7.5): URLs with a
 * scheme — `ssh://`, `git+ssh://`, `https://`, `http://`, `git://` — go through Node's `URL`
 * class (primer §69), whose user, query and fragment are dropped and whose hostname is put
 * back the way the text spells it (hostnameAsTyped: the class lower-cases it for the special
 * schemes — http, https, ws, wss, ftp, file — and git-spice compares it as typed); the
 * scp-like `[user@]host:path` goes through SCP_LIKE. A scheme spelled in capitals
 * (`HTTPS://…`) is a URL here but scp-like text to git-spice 0.31.2, whose scheme test is
 * case-sensitive, so it finds no forge — a known disagreement, left unmirrored. Everything
 * else is `null`: a local path (`/work/origin.git`, the
 * fixture's bare origin), any `file:` URL (to git that is a local path whatever follows the
 * slashes), a bare host, fewer than two path segments, an empty segment, garbage. The text
 * is trimmed first, so git's trailing newline is harmless. Never throws.
 *
 * Percent-encoding in a path is kept as the URL spelled it (`my%20repo`): the value is for
 * messages and for matching hosts, and git itself sends the path on as written. An IPv6
 * literal in a URL comes back as the URL class spells its hostname, brackets included
 * (`[::1]`) — the same spelling parseForgeConfig stores for a `spice.forge.<kind>.url` naming
 * it, so the two still match; only the scp-like spelling is refused (SCP_LIKE).
 */
// see primer §10 (`RemoteRepository | null`) and §23 (`trim`, `includes`)
export function parseRemoteUrl(url: string): RemoteRepository | null {
  const text = url.trim();
  if (!text.includes('://')) {
    // No scheme: the scp-like form or not a URL at all.
    const match = SCP_LIKE.exec(text);
    if (match === null) {
      return null;
    }
    const path = repositoryPath(match[2]);
    if (path === null) {
      return null;
    }
    // see primer §16 (object literals: spread)
    return { host: match[1], port: '', ...path };
  }
  const parsed = tryUrl(text);
  if (parsed === null) {
    return null;
  }
  if (parsed.protocol === 'file:' || parsed.hostname === '') {
    // `file:` is always a local path to git, with or without a host part; `ssh://h` and the
    // like without a hostname name no machine.
    return null;
  }
  const path = repositoryPath(parsed.pathname);
  if (path === null) {
    return null;
  }
  return { host: hostnameAsTyped(text, parsed), port: parsed.port, ...path };
}

/**
 * The hostname as the URL text spells it. The URL class lower-cases the hostname of a special
 * scheme (`https://GHES.Corp.com/…` reads back as `ghes.corp.com`), and git-spice compares
 * hostnames as typed — so the spelling is recovered from the text: the hostname is the last
 * thing in the URL's authority (what sits between `://` and the first `/`), so the lower-cased
 * text is searched backwards from there, and a user that happens to repeat the host
 * (`https://GitHub.com:token@github.com/…`) is skipped. When the hostname is not in the text
 * at all (an internationalised name the class re-encoded), the class's own spelling is the
 * answer.
 */
// see primer §23 (`toLowerCase`, `indexOf`, `lastIndexOf`, `slice`)
function hostnameAsTyped(text: string, parsed: URL): string {
  const lowerCased = text.toLowerCase();
  const authorityStart = lowerCased.indexOf('://') + '://'.length;
  const pathStart = lowerCased.indexOf('/', authorityStart);
  const authorityEnd = pathStart === -1 ? lowerCased.length : pathStart;
  const index = lowerCased.lastIndexOf(parsed.hostname.toLowerCase(), authorityEnd);
  if (index === -1) {
    return parsed.hostname;
  }
  return text.slice(index, index + parsed.hostname.length);
}

/**
 * `new URL(text)`, or `null` when the text is not a URL — the constructor throws a TypeError
 * for `/work/origin.git`, for `''`, and for `ssh://github.com:org/repo.git` (letters where a
 * port number should be). Nothing else in this file ever throws, so the one place that can
 * is kept to one line of `try`.
 */
// see primer §69 (`new URL`: the URL class as a value and as a type) and §18 (try / catch)
function tryUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/**
 * The owner and repository name in a URL path, or `null` when the path does not name both.
 * One leading `/` goes (a URL's pathname always has one; a scp path may), then one trailing
 * `/`, then one `.git` — in that order, so `org/repo.git/` reads as `org/repo`. What remains
 * is split on `/`: fewer than two segments (`https://github.com/org`), or any empty one
 * (`org//repo`, a path that was only `.git`), is `null`. The last segment is the repository,
 * everything before it the owner.
 */
// see primer §49 (`Pick`: the two path-derived fields of a RemoteRepository), §23
// (`startsWith`, `endsWith`, `slice`) and §25 (array `slice`, `join`, `includes`)
function repositoryPath(pathname: string): Pick<RemoteRepository, 'owner' | 'repo'> | null {
  let path = pathname;
  if (path.startsWith('/')) {
    path = path.slice(1);
  }
  if (path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  if (path.endsWith('.git')) {
    path = path.slice(0, -'.git'.length);
  }
  const segments = path.split('/');
  if (segments.length < 2 || segments.includes('')) {
    return null;
  }
  return { owner: segments.slice(0, -1).join('/'), repo: segments[segments.length - 1] };
}

/**
 * The `spice.forge.*` configuration as git prints it, reduced to the three things
 * classification reads. `kind` and `hosts` are what git-spice 0.31.2 itself reads from git
 * config (verified), so the extension and the backend agree on which forge a host is (plan
 * §7.6) — as far as git config says: the `GITHUB_URL` / `GITLAB_URL` / … and
 * `GIT_SPICE_FORGE_KIND` environment variables git-spice also honours are not read here, and
 * the worst case is an unnecessary E70 offer (item 18 decides whether to read `process.env`).
 */
export interface ForgeConfig {
  /**
   * `spice.forge.kind`: the forge git-spice uses no matter what the host says — its answer
   * for an ssh alias such as `work:org/repo.git`. `null` when unset, when the value is empty
   * (git-spice treats `kind ''` as unset), or when the last value is one git-spice rejects
   * (`rejectedKind` holds it then).
   */
  kind: ForgeKind | null;
  /**
   * The last `spice.forge.kind` value that is not one of git-spice's five ids — `nonsense`,
   * `azuredevops`, or `GitHub` (the ids are case-sensitive) — else `null`. Not ignored,
   * because git-spice does not ignore it: with such a value in place 0.31.2 refuses every
   * forge-touching command (`unknown forge: "GitHub"`, exit 1 — bare `gs auth status`,
   * `gs branch submit`), while `gs auth status --forge <kind>` bypasses the key, so the probe
   * cannot rely on that step to catch it. The fix the message names: unset the key, or set one
   * of `bitbucket, forgejo, gitea, github, gitlab`.
   */
  rejectedKind: string | null;
  /**
   * For each `spice.forge.<kind>.url` whose `<kind>` is one of the five ids: the URL's hostname
   * and port exactly as typed (hostnameAsTyped) — not lower-cased, because git-spice compares
   * them as text and requires the remote's port to match when the configured URL names one
   * (verified 0.31.2). git-spice matches a remote whose host is this host or a subdomain of
   * it. A value that is not a URL (`ghes.corp.com`, `https://`) is kept as an empty host: it
   * still displaces the kind's default and matches nothing, as it does in git-spice (verified:
   * "no forge found" for a github.com remote while `spice.forge.github.url` is `ghes.corp.com`);
   * only an empty value is unset. The last value for a key wins, as it does for `git config
   * --get`.
   */
  hosts: ReadonlyMap<ForgeKind, HostAddress>;
}

/**
 * One line of `git config --get-regexp` output: the key, one space, the value. A value here is
 * a URL or a forge id, neither of which contains a space, so the first space is the split.
 */
const CONFIG_LINE = /^([^ ]+) (.+)$/;

/**
 * Parses the stdout of `git config --get-regexp '^spice\.forge\.'` — `key value` per line.
 * Pass `''` for "nothing set" (the command exits 1 with no output then; tryRun gives `null`).
 *
 * git lower-cases the first and last components of a key and keeps everything between them —
 * the subsection, `forge.github` here — as typed, and git-spice reads the lower-case key. So
 * `spice.forge.GitHub.url` is a different key that neither this pattern nor git-spice matches,
 * and nothing but the exact `spice.forge.<id>.url` of one of the five ids counts: `apiurl`,
 * `bitbucket.kind` and any other key are ignored, as is a url for a kind git-spice 0.31.2 has
 * no forge for (`azuredevops`). An empty value (`spice.forge.kind ''`) prints as the key and
 * one space, which `(.+)` does not match — right, since git-spice treats it as unset; a value
 * that is only spaces, or has a trailing one (`gitlab `), is kept as typed, because git-spice
 * rejects it (`unknown forge: "gitlab "`).
 */
// see primer §22 (for ... of) and §12 (template strings)
export function parseForgeConfig(output: string): ForgeConfig {
  let kind: ForgeKind | null = null;
  let rejectedKind: string | null = null;
  const hosts = new Map<ForgeKind, HostAddress>();
  for (const rawLine of output.split('\n')) {
    // Only the `\r` of a CRLF ending goes — a value's own trailing space must survive, since
    // git-spice rejects `gitlab ` as a kind; a blank line matches nothing below.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const match = CONFIG_LINE.exec(line);
    if (match === null) {
      continue;
    }
    const key = match[1];
    const value = match[2];
    if (key === 'spice.forge.kind') {
      // The last value wins, as git-spice reads it (verified: `nonsense` then `gitlab` is
      // gitlab; `gitlab` then `nonsense` is "unknown forge").
      kind = toForgeId(value);
      rejectedKind = kind === null ? value : null;
      continue;
    }
    for (const id of GIT_SPICE_FORGE_IDS) {
      if (key === `spice.forge.${id}.url`) {
        const parsed = tryUrl(value);
        if (parsed !== null && parsed.hostname !== '') {
          hosts.set(id, { host: hostnameAsTyped(value, parsed), port: parsed.port });
        } else {
          hosts.set(id, { host: '', port: '' });
        }
      }
    }
  }
  return { kind, rejectedKind, hosts };
}

/**
 * Narrows a configuration value to one of git-spice's five forge ids, or `null` for anything
 * else. A plain `===` per id is what lets the compiler turn a `string` into a `ForgeKind`
 * (primer §45); `GIT_SPICE_FORGE_IDS.includes(value)` would not — the compiler refuses to
 * look a `string` up in a list of `ForgeKind`s.
 */
// see primer §45 (narrowing a `string` to an exact-string union with `===`) and §48 (the conditional expression)
function toForgeId(value: string): ForgeKind | null {
  if (value === 'bitbucket' || value === 'forgejo' || value === 'gitea' || value === 'github' || value === 'gitlab') {
    return value;
  }
  return null;
}

/** The remote repository plus which forge serves it, and whether git-spice agrees. */
// see primer §9 (an interface that extends another: all of RemoteRepository's fields, plus two)
export interface Forge extends RemoteRepository {
  kind: ForgeKind;
  /**
   * `true` when git-spice 0.31.2 will match this remote on its own, by the rules
   * gitSpiceMatches mirrors: `spice.forge.kind` names a forge, or the remote's host is — or is a
   * subdomain of — the host a `spice.forge.<kind>.url` names (with its port, if it names one),
   * or, for a kind with no url key, one of git-spice's default hosts. `false` is E70's trigger
   * when `kind` is `github`: the host is `*.ghe.com` (the extension's guess, not git-spice's),
   * or github.com itself while a `spice.forge.github.url` names another host (a url key
   * replaces the default), or a spelling git-spice will not match (case, a port that differs
   * from the configured one), a `spice.forge.kind` whose own url key the remote does not match,
   * or a rejected `spice.forge.kind` — and the fix is a `git config` line that echoes the
   * remote's spelling. `false` with `kind` `unknown` is E60. Always `false` for `azuredevops`:
   * 0.31.2 has no Azure forge, even with its url key set. Known to disagree with git-spice, all
   * outside §7.5's list: a configured URL naming a scheme's default port explicitly (the URL
   * class drops it), a scheme in capitals (git-spice reads `HTTPS://…` as scp-like and finds no
   * forge), and an internationalised hostname (the URL class re-encodes it).
   */
  recognizedByGitSpice: boolean;
}

/**
 * Which forge a remote is, and whether git-spice agrees. Pure: the remote's host and port and
 * the configuration in, two fields out.
 *
 * git-spice's side first (every rule verified with 0.31.2 by configuring it and reading
 * `gs auth status`): a rejected `spice.forge.kind` stops it resolving any forge; a valid one
 * wins outright, even over github.com — though when that kind also has a url key, the remote
 * must match it (`unsupported URL: remote URL … does not match configured forge URL`);
 * otherwise each of its five forges has one base host —
 * the `spice.forge.<kind>.url` when set, else the default (github.com, gitlab.com,
 * bitbucket.org, codeberg.org; none for gitea) — and the remote matches a forge when its host
 * is that base or a subdomain of it, spelled the same, with the same port if the base names
 * one. git-spice walks its forges in unspecified order, so when two match (two url keys on
 * one host; a url key naming another forge's default host) its pick varies run to run; the
 * extension takes the first in GIT_SPICE_FORGE_IDS order, and `recognizedByGitSpice` is true
 * either way, since git-spice does match. Then the extension's own guesses, for the kind of a
 * host git-spice will not match: the default hosts and their subdomains again, compared
 * without regard to case,
 * `*.ghe.com` as GitHub Enterprise Cloud, `dev.azure.com`, `ssh.dev.azure.com` and
 * `*.visualstudio.com` as Azure DevOps; then `unknown`.
 */
// see primer §49 (`Pick`: the two fields of a Forge that come from the address and the configuration, not the path) and §30 (`??`)
export function classifyHost(remote: HostAddress, config: ForgeConfig): Pick<Forge, 'kind' | 'recognizedByGitSpice'> {
  if (config.rejectedKind !== null) {
    return { kind: guessKind(remote.host), recognizedByGitSpice: false };
  }
  if (config.kind !== null) {
    const own = config.hosts.get(config.kind);
    return { kind: config.kind, recognizedByGitSpice: own === undefined || gitSpiceMatches(remote, own) };
  }
  for (const id of GIT_SPICE_FORGE_IDS) {
    const base = config.hosts.get(id) ?? defaultHost(id);
    if (base !== undefined && gitSpiceMatches(remote, base)) {
      return { kind: id, recognizedByGitSpice: true };
    }
  }
  return { kind: guessKind(remote.host), recognizedByGitSpice: false };
}

/** git-spice's default host for a kind as a HostAddress (no port), or `undefined` for gitea and the extension's own kinds. */
function defaultHost(kind: ForgeKind): HostAddress | undefined {
  const host = GIT_SPICE_DEFAULT_HOSTS.get(kind);
  if (host === undefined) {
    return undefined;
  }
  return { host, port: '' };
}

/**
 * git-spice's test for one forge (0.31.2, `internal/forge/remote_url.go`): the remote's host
 * is the base host or ends in `.` + the base host — `ghes.corp.com` matches a configured
 * `https://corp.com`, `ssh.github.com` matches the default github.com, `notcorp.com` does not
 * match `corp.com` — and, when the base names a port, the remote's port is the same. Both
 * comparisons are plain text, so case matters. An empty base host (a url key that is not a
 * URL) matches only a remote host ending in `.`, as in git-spice.
 */
function gitSpiceMatches(remote: HostAddress, base: HostAddress): boolean {
  const hostMatches = remote.host === base.host || remote.host.endsWith(`.${base.host}`);
  const portMatches = base.port === '' || remote.port === base.port;
  return hostMatches && portMatches;
}

/**
 * The extension's own idea of a host's forge kind, for a remote git-spice will not match: the
 * kind a message should name, and the kind E70's offer is for. A default host or a subdomain of
 * one (`ssh.github.com` beside a GHES url is still GitHub), `*.ghe.com`, Azure's hosts —
 * compared without regard to case, a hostname being case-insensitive by definition even where
 * git-spice's text compare is not.
 */
function guessKind(host: string): ForgeKind {
  const lowerCased = host.toLowerCase();
  for (const id of GIT_SPICE_FORGE_IDS) {
    const base = GIT_SPICE_DEFAULT_HOSTS.get(id);
    if (base !== undefined && (lowerCased === base || lowerCased.endsWith(`.${base}`))) {
      return id;
    }
  }
  if (lowerCased.endsWith('.ghe.com')) {
    // GitHub Enterprise Cloud with data residency lives at `<subdomain>.ghe.com`; the bare
    // domain hosts no repositories.
    return 'github';
  }
  if (lowerCased === 'dev.azure.com' || lowerCased === 'ssh.dev.azure.com' || lowerCased.endsWith('.visualstudio.com')) {
    return 'azuredevops';
  }
  return 'unknown';
}

/**
 * What detectForge found for the remote `prCascade.remote` names. Three §8 rows need three
 * different messages — E25 (add a remote), E21 (the URL is the problem), E60/E70/E75 (set a
 * `spice.forge.*` key, or wait for M11) — which a plain `Forge | null` could not tell apart.
 * Told apart by `kind` (primer §59); the `forge` member nests a Forge whose own `kind` is
 * the forge kind, so a reader writes `detection.kind === 'forge'` and then
 * `detection.forge.kind === 'github'`. Every member carries the remote's name, so a message
 * can be built from the result alone; the `forge` member also carries the `spice.forge.*`
 * configuration that decided it, because an E60/E70 message has to say *why* git-spice will
 * not match — a rejected `spice.forge.kind`, a url key that displaced a default or names
 * another port — and that is in the configuration, not in the Forge (item 17's `Readiness`
 * carries both on).
 */
// see primer §59 (tagged unions)
export type ForgeDetection =
  /** E25: `git remote get-url <remote>` found no such remote. */
  | { readonly kind: 'no-remote'; readonly remote: string }
  /** E21: the remote's URL names no forge repository — a local path, garbage. `url` is for the message. */
  | { readonly kind: 'unparseable'; readonly remote: string; readonly url: string }
  /** A forge repository; E60, E70 and E75 are read off `forge.kind` and `forge.recognizedByGitSpice`, their remedy off `config`. */
  | { readonly kind: 'forge'; readonly remote: string; readonly forge: Forge; readonly config: ForgeConfig };

/**
 * Reads the remote's URL and classifies it: `git remote get-url <remote>` (tryRun — exit 2
 * means no such remote; this is the *fetch* URL, with any `url.<base>.insteadOf` rewrite
 * already applied by git — `pushInsteadOf` and `remote.<name>.pushurl` are not, and the fetch
 * URL is also what git-spice 0.31.2 guesses the forge from), parseRemoteUrl, then `git config
 * --get-regexp '^spice\.forge\.'` (tryRun — exit 1 means nothing is set) and classifyHost.
 * One git command when there is no remote or no usable URL, two otherwise, both run at
 * `root`. Rejects only when git itself cannot run (E17); every other outcome is a
 * ForgeDetection.
 */
// see primer §6 (async / await) and §30 (`??`: an empty string when nothing is configured)
export async function detectForge(git: GitRunner, root: string, remote: string): Promise<ForgeDetection> {
  const printed = await git.tryRun(['remote', 'get-url', remote], root);
  if (printed === null) {
    return { kind: 'no-remote', remote };
  }
  // A remote URL has no leading or trailing whitespace of its own, so trim() removes exactly
  // git's trailing newline (a local path may contain spaces inside; they survive).
  const url = printed.trim();
  const repository = parseRemoteUrl(url);
  if (repository === null) {
    return { kind: 'unparseable', remote, url };
  }
  // The pattern reaches git as one argument; the backslashes escape the dots for git's
  // regular-expression engine, not for ours.
  const configOutput = await git.tryRun(['config', '--get-regexp', '^spice\\.forge\\.'], root);
  const config = parseForgeConfig(configOutput ?? '');
  return { kind: 'forge', remote, forge: { ...repository, ...classifyHost(repository, config) }, config };
}

/** The one environment variable for `gh` that varies per repository (plan §7.5, E22). */
export interface GhEnv {
  readonly GH_HOST: string;
}

/**
 * The environment every execFile'd `gh` call gets on top of the process's own: `GH_HOST`,
 * so gh talks to this repository's host even when the repository has several remotes
 * (plan §7.5), and each repository in a window gets its own (E22). Lower-cased, as gh
 * normalises hostnames itself, so two spellings of one host are one host to it. Only this
 * key — the non-interactive hygiene (`GH_PROMPT_DISABLED`, `GH_NO_UPDATE_NOTIFIER`,
 * `NO_COLOR`) is the same for every call and belongs to the gh runner of item 23, the way
 * `LC_ALL=C` and `GIT_OPTIONAL_LOCKS=0` belong to RealGitRunner — and the §7.5 login terminal
 * must keep prompting, so a per-host function must not switch prompts off. A fresh object on
 * every call, so no caller can change another's.
 */
export function ghEnv(host: string): GhEnv {
  return { GH_HOST: host.toLowerCase() };
}
