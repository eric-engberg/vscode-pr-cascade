/**
 * core/readinessFix.ts — what to tell the user, and what one click should do, for each way the
 * readiness probe can answer "not ready" (plan §7.13.1's offers; E55: "any missing piece → the
 * matching one-click fix"). `offerFor` turns a failing `Readiness` member into an `Offer`: the
 * colour of the message, its sentence, and at most one button with the command it runs and the
 * line shown once the step passed. It decides the words and the command only; showing the
 * message, running the command in a terminal and waiting for the step to pass are item 19b's
 * (src/vscode/login.ts), which is why this file can be tested to the letter without VS Code.
 *
 * Also here: `trunkBranchFor`, the one question asked of git before an init offer — which
 * *local* branch `gs repo init --trunk` can be given — and `readyMessage`.
 *
 * Rules every sentence follows (D57): plain sentences with no "PR Cascade:" prefix (VS Code
 * already names the extension on every notification) and the British spelling of the rest of
 * the extension's text; `warning` when the user has something to do — a button, or a setting,
 * key or command named — and `information` when there is nothing to do (the colours of the
 * tree's rows, D51); at most one button and never a "Cancel", since closing the notification
 * already says no. `<repo>` in a sentence is the repository's folder name; `<host>` the host as
 * the remote spells it (git-spice compares the spelling, D54).
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/backend.ts (`NotReady`,
 * `Ready`), core/forge.ts (types), core/ghstatus.ts (`GH_STACK_EXTENSION`, item 23b), core/model.ts
 * (`GitRunner`), core/shell.ts (a command quoted inside a sentence), core/version.ts
 * (`parseVersion` — from core/backends/gitspice.ts until item 23a moved it; nothing here runs the
 * backend), Node's `node:path`. Depended on by: src/vscode/login.ts and src/extension.ts (item
 * 19b), test/unit/readinessFix.test.ts, test/git/trunkBranch.git.test.ts. Plan: §7.5 (the gh login
 * line), §7.6, §7.13.1, §8 E21/E23/E25/E55/E59/E60/E62/E62b/E67/E70/E75, §10.1 items 19a, 23a and
 * 23b, §13.2 D57/D65/D66.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as path from 'node:path';
import type { NotReady, Ready } from './backend';
import type { Forge, ForgeConfig, ForgeKind, HostAddress } from './forge';
import { GH_STACK_EXTENSION } from './ghstatus';
import type { GitRunner } from './model';
import { shellCommandLine } from './shell';
import { parseVersion } from './version';

/** git-spice's install page — the offer when Homebrew is not there, or the git-spice found is not Homebrew's. */
// see primer §4 (const)
export const INSTALL_DOCS_URL = 'https://abhinav.github.io/git-spice/start/install/';

/** gh's install page — the README's installation section, every package manager listed (cli.github.com is one download button). Item 23b. */
export const GH_INSTALL_DOCS_URL = 'https://github.com/cli/cli#installation';

/**
 * The environment variable git-spice reads as a login, for each forge v1 serves. While it is
 * set, git-spice counts the user as logged in, and refuses `auth login` ("already logged in"),
 * even with `--refresh` (verified 0.31.2 for both). The login offer unsets it for that one
 * command, so a terminal that happens to export it still stores a real login.
 */
// see primer §43 (`Record<K, V>`: one value for each member of a union of keys)
const TOKEN_VARIABLE: Record<'github' | 'gitlab', string> = { github: 'GITHUB_TOKEN', gitlab: 'GITLAB_TOKEN' };

/**
 * The environment variables gh reads as a login, by host class (`gh help environment`): the first
 * pair for github.com, its subdomains and *.ghe.com, the second for GitHub Enterprise Server. While
 * one of the pair for the host is set, gh refuses `auth login` outright ("The value of the GH_TOKEN
 * environment variable is being used for authentication", exit 1 — measured 2.102.0), so the login
 * offer unsets both for that one command, as the git-spice line unsets GITHUB_TOKEN. The other pair
 * changes nothing for the host and is left alone, so the line the user watches stays short. Item 23b.
 */
// see primer §25 (a tuple type: an array of exactly these types in these positions) and §14 (readonly)
const GITHUB_COM_TOKENS: readonly [string, string] = ['GH_TOKEN', 'GITHUB_TOKEN'];
const ENTERPRISE_TOKENS: readonly [string, string] = ['GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'];

/** Which pair `host` is in; the host compared lower-cased, as gh compares it. Exported for the test's table. */
// see primer §23 (`endsWith`, `toLowerCase`)
export function ghTokenVariables(host: string): readonly [string, string] {
  const lower = host.toLowerCase();
  return lower === 'github.com' || lower.endsWith('.github.com') || lower.endsWith('.ghe.com') ? GITHUB_COM_TOKENS : ENTERPRISE_TOKENS;
}

/** The name a sentence gives each forge kind. `unknown` never reaches a sentence that uses it; it is here because a Record must name every key. */
const FORGE_NAMES: Record<ForgeKind, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  gitea: 'Gitea',
  forgejo: 'Forgejo',
  azuredevops: 'Azure DevOps',
  unknown: 'an unknown forge',
};

/**
 * What `gs repo init --trunk` can be given for the repository's trunk. It wants the name of an
 * existing *local* branch — `main`, never `origin/main` (verified 0.31.2: "not a branch: main"
 * for a repository that has only `origin/main`) — while the extension's trunk is a ref such as
 * `origin/main` (core/trunk.ts). trunkBranchFor asks git which it is.
 */
// see primer §59 (tagged unions)
export type TrunkBranch =
  /** A local branch exists for the trunk: the init offer can run. */
  | { readonly kind: 'local'; readonly branch: string }
  /** The trunk is the remote-tracking `trunk` (`origin/main`), and there is no local `branch` (`main`) yet. */
  | { readonly kind: 'missing'; readonly branch: string; readonly trunk: string }
  /** The trunk names no branch at all: a tag, a commit, a name git finds ambiguous or no longer knows. */
  | { readonly kind: 'not-a-branch'; readonly trunk: string }
  /** No trunk was found (E4). Also what the caller passes for every member other than `not-initialized`, the only one that reads it. */
  | { readonly kind: 'none' };

/** What the sentences and commands need beyond the probe's answer. Plain values: item 19b reads them from VS Code and git. */
// see primer §9 (interface) and §14 (readonly)
export interface OfferFacts {
  /** The repository root; its last path segment is `<repo>` in every sentence. */
  readonly root: string;
  /** `prCascade.remote` as read — what `gs repo init --remote` is given. */
  readonly remote: string;
  /** trunkBranchFor's answer — asked only for `not-initialized`, `{ kind: 'none' }` otherwise. */
  readonly trunkBranch: TrunkBranch;
  /** `prCascade.gsPath` as read: empty or blank means "try `git-spice`, then `gs`", as core/backends/gitspice.ts reads it. */
  readonly gsPathSetting: string;
  /**
   * The full path of Homebrew's `brew`, or `null` when there is none (item 19b looks in its usual
   * places). The install and upgrade lines run it by that path, so they work in a terminal whose
   * PATH does not have Homebrew's directory.
   */
  readonly brewPath: string | null;
  /**
   * The `git-spice` in the directory beside `brewPath` — where Homebrew links the one it
   * installed — when there is one, else `null` (item 19b checks the disk). What tells a
   * Homebrew install apart from the others: since v0.25 every official package is named
   * `git-spice`, so the name alone proves nothing.
   */
  readonly brewGitSpice: string | null;
  /** `prCascade.ghPath` as read (item 23b): empty or blank means `gh` from VS Code's PATH (core/ghstatus.ts); set, the only executable tried. */
  readonly ghPathSetting: string;
  /** The `gh` beside `brewPath` — where Homebrew links the one it installed — or `null`; tells a Homebrew gh apart, as `brewGitSpice` does for git-spice. Item 23b. */
  readonly brewGh: string | null;
  /** `prCascade.gitProtocol` as read (item 23b) — what `gh auth login --git-protocol` is given. */
  readonly gitProtocol: string;
}

/** One `git config <key> <value>`, written to the repository's own config file. */
// see primer §9 (interface) and §14 (readonly)
export interface ConfigEntry {
  readonly key: string;
  readonly value: string;
}

/** What one button does. Item 19b has one branch per kind and nothing else interprets it. */
// see primer §59 (tagged unions)
export type Fix =
  /** Run `argv` in the repository's terminal (cwd = root), then wait for the step to pass: the user may have to answer prompts. */
  | { readonly kind: 'terminal'; readonly argv: readonly string[] }
  /** Run `git config <key> <value>` in the repository for each entry, in order, with no terminal: nothing to answer, and it is done when git returns. */
  | { readonly kind: 'git-config'; readonly entries: readonly ConfigEntry[] }
  /** Open `url` in the browser, then wait for the step to pass. */
  | { readonly kind: 'open-url'; readonly url: string };

/** The one button an offer may carry: its label, what it does, and the line shown once the step has passed. */
export interface OfferedFix {
  readonly button: string;
  readonly action: Fix;
  readonly done: string;
}

/** One message: its colour, its sentence, and its button — `null` when the sentence is all there is to say. */
export interface Offer {
  readonly severity: 'warning' | 'information';
  readonly message: string;
  readonly fix: OfferedFix | null;
}

/**
 * The offer for a member that is not `ready` (plan §7.13.1, E55) — one test per variant in
 * test/unit/readinessFix.test.ts. Seven members have a function of their own below; the three
 * that are a single sentence (no-remote, remote-unparseable, forge-unsupported) are worded here.
 * Taking `NotReady` rather than `Readiness` means `ready` cannot be passed in, and the chain of
 * `if`s is complete: after the nine tests, the compiler has narrowed `readiness` to `gh-missing`
 * (primer §59), so a member added to the union later is a compile error on the last line until
 * it gets a case.
 */
// see primer §59 (tagged unions: narrowing on `kind`) and §28 (`path.basename`)
export function offerFor(readiness: NotReady, facts: OfferFacts): Offer {
  const repo = path.basename(facts.root);
  if (readiness.kind === 'gs-missing') {
    return gsMissingOffer(readiness.tried, facts);
  }
  if (readiness.kind === 'gs-too-old') {
    return gsTooOldOffer(readiness.gsPath, readiness.found, readiness.minimum, facts);
  }
  if (readiness.kind === 'not-initialized') {
    return initOffer(readiness.gsPath, repo, facts);
  }
  if (readiness.kind === 'no-remote') {
    return textOnly('warning', `${repo} has no remote named ${readiness.remote} — add one, or set prCascade.remote.`);
  }
  if (readiness.kind === 'remote-unparseable') {
    return textOnly(
      'information',
      `The URL of ${repo}'s remote ${readiness.remote}, ${readiness.url}, names no GitHub or GitLab repository; the Stack view still works.`,
    );
  }
  if (readiness.kind === 'forge-unrecognized') {
    return unrecognizedOffer(readiness.forge, readiness.config, repo);
  }
  if (readiness.kind === 'forge-unsupported') {
    // see primer §54 (destructuring)
    const { forge } = readiness;
    return textOnly(
      'information',
      `${repo}'s remote is on ${FORGE_NAMES[forge.kind]} (${forge.host}); v1 supports GitHub and GitLab, so pull-request actions are off there. The Stack view still works.`,
    );
  }
  if (readiness.kind === 'not-logged-in') {
    return loginOffer(readiness.gsPath, readiness.forge);
  }
  if (readiness.kind === 'gh-not-logged-in') {
    return ghLoginOffer(readiness.ghPath, readiness.forge, facts);
  }
  return ghMissingOffer(readiness, facts);
}

/**
 * `git-spice 0.31.2 is ready for app (gitlab.com).` — or, on GitHub, `git-spice 0.31.2 and gh
 * 2.102.0 are ready for app (github.com).`: the answer when the user asked by hand and every step
 * passed, naming every tool it checked (item 23a: `ready.gh` is the gh step 5 found, `null` where
 * there was no step).
 */
// see primer §12 (template strings) and §48 (the conditional expression)
export function readyMessage(ready: Ready, root: string): string {
  const tools = ready.gh === null ? `git-spice ${ready.gsVersion} is` : `git-spice ${ready.gsVersion} and gh ${ready.gh.version} are`;
  return `${tools} ready for ${path.basename(root)} (${ready.forge.host}).`;
}

/**
 * Which local branch the trunk is, for `gs repo init --trunk`. Git is asked for the trunk's
 * full name — `git rev-parse --verify --quiet --symbolic-full-name --end-of-options <trunk>`
 * (verified on git 2.50, 2026-10-06): `refs/heads/main` for `main`, `refs/remotes/origin/main`
 * for `origin/main` and for `origin/HEAD`, `refs/tags/v1` for a tag, nothing for a commit, nothing
 * (and exit 0, with `refname … is ambiguous` on stderr) for a name that is both a branch and a
 * remote-tracking ref, and exit 1 for a name it does not know. `--end-of-options` keeps a trunk
 * starting with `-` from being read as an option — defence in depth, since `--verify` already
 * refuses `--all` and its kind (exit 1). For a
 * remote-tracking ref, the branch is everything after the remote's name —
 * `refs/remotes/upstream/release/2.0` → `release/2.0` — taken from the ref itself rather than from
 * `prCascade.remote`, because a fork's trunk can live on another remote; then a second
 * question asks whether that local branch exists. A remote whose own name contains a `/` would be
 * misread (git allows it; it is rare enough to leave).
 *
 * `tryRun`: exit 1 is an answer here ("no such ref"), and E17 still rejects (core/model.ts).
 */
// see primer §6 (async / await), §23 (string methods: `startsWith`, `slice`) and §25 (arrays: `split`, `slice`, `join`)
export async function trunkBranchFor(git: GitRunner, root: string, trunk: string | null): Promise<TrunkBranch> {
  if (trunk === null) {
    return { kind: 'none' };
  }
  const output = await git.tryRun(['rev-parse', '--verify', '--quiet', '--symbolic-full-name', '--end-of-options', trunk], root);
  // see primer §30 (`??`): no output and exit 1 read the same — not a branch
  const fullName = (output ?? '').trim();
  if (fullName.startsWith('refs/heads/')) {
    return { kind: 'local', branch: fullName.slice('refs/heads/'.length) };
  }
  if (!fullName.startsWith('refs/remotes/')) {
    return { kind: 'not-a-branch', trunk };
  }
  // `refs/remotes/<remote>/<branch>`: drop the remote's name, keep every segment after it.
  const branch = fullName.slice('refs/remotes/'.length).split('/').slice(1).join('/');
  const local = await git.tryRun(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root);
  if (local === null) {
    return { kind: 'missing', branch, trunk };
  }
  return { kind: 'local', branch };
}

/** An offer that is only a sentence: nothing to click. */
function textOnly(severity: 'warning' | 'information', message: string): Offer {
  return { severity, message, fix: null };
}

/**
 * E62. With `prCascade.gsPath` set, only that one name was tried, so installing git-spice would
 * change nothing: the sentence points at the setting. When Homebrew has git-spice and the probe
 * still did not find it — most likely VS Code's PATH does not reach Homebrew's directory — the
 * sentence names the path to put in the setting, and installing again would change nothing. Otherwise
 * the sentence says *VS Code's* PATH — a terminal may well find git-spice where VS Code did not
 * (D57) — and the button installs it with Homebrew when there is one, or opens the install page.
 */
// see primer §25 (arrays: `join`) and §14 (`readonly` on an array type)
function gsMissingOffer(tried: readonly string[], facts: OfferFacts): Offer {
  if (facts.gsPathSetting.trim() !== '') {
    return textOnly(
      'warning',
      `prCascade.gsPath is ${facts.gsPathSetting}, which did not answer as git-spice. Point it at git-spice, or clear it to try git-spice and gs.`,
    );
  }
  if (facts.brewGitSpice !== null) {
    return textOnly(
      'warning',
      `git-spice is installed at ${facts.brewGitSpice}, but VS Code did not find it (tried ${tried.join(', ')}). Set prCascade.gsPath to ${facts.brewGitSpice}.`,
    );
  }
  const notFound = `git-spice was not found in VS Code's PATH (tried ${tried.join(', ')}).`;
  const installed = 'or, if it is already installed, set prCascade.gsPath to its full path.';
  if (facts.brewPath !== null) {
    return {
      severity: 'warning',
      message: `${notFound} Install it with Homebrew — ${installed}`,
      fix: { button: 'Install with Homebrew', action: { kind: 'terminal', argv: [facts.brewPath, 'install', 'git-spice'] }, done: 'git-spice installed.' },
    };
  }
  return {
    severity: 'warning',
    message: `${notFound} Install it — ${installed}`,
    fix: { button: 'Open install docs', action: { kind: 'open-url', url: INSTALL_DOCS_URL }, done: 'git-spice installed.' },
  };
}

/**
 * Too old, or a version that cannot be read (`dev`, a `go install` build). `brew upgrade` only
 * when the git-spice that answered is Homebrew's — `brewGitSpice` itself, or the bare name
 * `git-spice` while Homebrew has one (the name alone is not enough: every official package is
 * called that since v0.25, and `brew upgrade` would leave a .deb or a tarball's copy as it was)
 * — and only for a version that was read; otherwise the install page. A bare `git-spice` that
 * resolves, through VS Code's PATH, to another install ahead of Homebrew's would be upgraded in
 * the wrong place and the wait would time out; rare enough to leave.
 */
// see primer §48 (the conditional expression)
function gsTooOldOffer(gsPath: string, found: string, minimum: string, facts: OfferFacts): Offer {
  const readable = parseVersion(found) !== null;
  // Where it is, when that says more than its name: a path set by hand, not the bare `git-spice`.
  const where = gsPath.includes('/') ? ` at ${gsPath}` : '';
  const message = readable
    ? `git-spice ${found}${where} is older than ${minimum}, the oldest PR Cascade works with.`
    : `git-spice${where} reports version "${found}", so whether it is at least ${minimum} could not be checked.`;
  const fromHomebrew = facts.brewGitSpice !== null && (gsPath === 'git-spice' || gsPath === facts.brewGitSpice);
  if (readable && facts.brewPath !== null && fromHomebrew) {
    return {
      severity: 'warning',
      message,
      fix: { button: 'Upgrade with Homebrew', action: { kind: 'terminal', argv: [facts.brewPath, 'upgrade', 'git-spice'] }, done: 'git-spice upgraded.' },
    };
  }
  return {
    severity: 'warning',
    message,
    fix: { button: 'Open install docs', action: { kind: 'open-url', url: INSTALL_DOCS_URL }, done: 'git-spice upgraded.' },
  };
}

/**
 * E59. The init offer runs `gs repo init --trunk <branch> --remote <remote>` with the executable
 * that answered the probe — but only once git has named a local branch for the trunk; without
 * one, the sentence says what to do first and there is no button, and a command it names is
 * quoted the way the terminal lines are, and kept off the end of the sentence, so it can be
 * pasted as it is (git allows a `'` or a `$` in a branch name). The line starts with `command`, the shell's own way of saying "the program
 * of that name, not an alias or a function": a `gs` alias is common (`alias gs='git stash'` in
 * some zsh setups), and the probe, which spawns programs directly, would never have seen it.
 */
function initOffer(gsPath: string, repo: string, facts: OfferFacts): Offer {
  const trunk = facts.trunkBranch;
  if (trunk.kind === 'none') {
    return textOnly('warning', `git-spice is not initialised in ${repo}, and no trunk was found to initialise it with — set prCascade.trunk first.`);
  }
  if (trunk.kind === 'not-a-branch') {
    return textOnly(
      'warning',
      `git-spice is not initialised in ${repo}, and its trunk ${trunk.trunk} does not name one branch — set prCascade.trunk to a branch first.`,
    );
  }
  if (trunk.kind === 'missing') {
    return textOnly(
      'warning',
      `git-spice is not initialised in ${repo}; it needs trunk ${trunk.branch} as a local branch, and there is only ${trunk.trunk}. Run ${shellCommandLine(['git', 'branch', trunk.branch, trunk.trunk])} to create it.`,
    );
  }
  return {
    severity: 'warning',
    message: `git-spice is not initialised in ${repo}. Initialise it with trunk ${trunk.branch} and remote ${facts.remote}?`,
    fix: {
      button: 'Initialise',
      action: { kind: 'terminal', argv: ['command', gsPath, 'repo', 'init', '--trunk', trunk.branch, '--remote', facts.remote] },
      done: `git-spice initialised in ${repo}.`,
    },
  };
}

/**
 * E60 and E70 — the probe's `forge-unrecognized`, whose two fields say why (core/backend.ts).
 * In order: a rejected `spice.forge.kind` stops git-spice matching any forge, whatever the host
 * (text only: where the bad value lives — this repository's config, the global one — is the
 * user's to find); a host that is neither GitHub nor GitLab to the extension (E60, text only,
 * naming both url keys and, for an ssh alias, `spice.forge.kind`); an explicit
 * `spice.forge.kind` whose own url key the remote does not match (text only — offering the
 * remote's host as the URL would be wrong for the ssh alias such a key usually serves); then
 * E70 proper, a GitHub or GitLab host git-spice will not match, whose offer is `git config` in
 * this repository's own file (it wins over a global value, so other repositories keep theirs —
 * hence "for <repo>") naming `https://<host>` as the remote spells the host. No port in that
 * URL: a remote's port is usually ssh's, not the web server's. The offer names the forge's API
 * address too, `spice.forge.<kind>.apiUrl`: for GitHub because git-spice cannot always derive it
 * (githubUrls says when), and for both because an `apiUrl` written for another host — beside
 * the url key that displaced the default — would otherwise still apply here. One button, "Set
 * GitHub URLs" (or GitLab), for the two keys.
 */
// see primer §19 (Map: `get`) and §12 (template strings)
function unrecognizedOffer(forge: Forge, config: ForgeConfig, repo: string): Offer {
  if (config.rejectedKind !== null) {
    return textOnly(
      'warning',
      `spice.forge.kind is "${config.rejectedKind}", which git-spice rejects, so it matches no forge in ${repo}. Unset it, or set it to one of bitbucket, forgejo, gitea, github, gitlab.`,
    );
  }
  const host = forge.host;
  if (forge.kind !== 'github' && forge.kind !== 'gitlab') {
    return textOnly(
      'warning',
      `git-spice does not recognise ${host}; v1 supports GitHub and GitLab. If ${host} is one of them, set spice.forge.github.url or spice.forge.gitlab.url to https://${host} in ${repo}'s git config — or, if ${host} is an ssh alias, set spice.forge.kind to github or gitlab.`,
    );
  }
  const key = `spice.forge.${forge.kind}.url`;
  const name = FORGE_NAMES[forge.kind];
  const configured = config.hosts.get(forge.kind);
  if (config.kind !== null && configured !== undefined) {
    return textOnly(
      'warning',
      `spice.forge.kind is ${config.kind}, but ${host} does not match ${key} (${addressText(configured)}), so git-spice will not use ${name} in ${repo}. Change the remote or ${key} so they agree.`,
    );
  }
  // The url and the API address to write: GitHub's rules in githubUrls; GitLab's API is the
  // GitLab URL itself, which is git-spice's own default for it.
  const { url, apiUrl } = forge.kind === 'github' ? githubUrls(host) : { url: `https://${host}`, apiUrl: `https://${host}` };
  const apiKey = `spice.forge.${forge.kind}.apiUrl`;
  const entries: ConfigEntry[] = [
    { key, value: url },
    { key: apiKey, value: apiUrl },
  ];
  let reason = `git-spice will not match ${host} as ${name} until ${key} names it.`;
  // see primer §70 (`?.`: an unset key is `undefined`, and `undefined === ''` is false)
  if (configured?.host === '') {
    reason = `${key} is not a URL, so git-spice matches nothing as ${name}.`;
  } else if (configured !== undefined) {
    reason = `${key} names ${addressText(configured)}, so git-spice no longer matches ${host} as ${name}.`;
  }
  return {
    severity: 'warning',
    message: `${reason} Set it to ${url}, and ${apiKey} to ${apiUrl}, for ${repo}?`,
    fix: {
      button: `Set ${name} URLs`,
      action: { kind: 'git-config', entries },
      done: `${key} set to ${url}, and ${apiKey} to ${apiUrl}.`,
    },
  };
}

/**
 * The two addresses E70's GitHub offer writes: `spice.forge.github.url`, and the API address
 * GitHub documents for that host as `spice.forge.github.apiUrl`. git-spice 0.31.2 sends every
 * GitHub request to `<apiUrl>/graphql`; with only the url set it uses `https://api.github.com`
 * when the url is exactly `https://github.com`, and guesses `<url>/api` for any other url
 * (`internal/forge/github/forge.go`, `APIURL`) — right for GitHub Enterprise Server, wrong for
 * GitHub Enterprise Cloud with data residency (`*.ghe.com`, the case E70 meets most), whose API
 * is `api.<host>` (gh does the same for those hosts), and wrong for github.com spelled any
 * other way (`https://GitHub.com`, which E70 writes for a remote spelled so). A subdomain of
 * github.com (`ssh.github.com`, ssh over port 443) is github.com itself: git-spice matches
 * subdomains, and there are no web pages at `ssh.github.com`. The last branch, any other GitHub
 * host, is a fallback: detectForge does not produce one today — an Enterprise Server host is E60
 * until its url key names it. Hosts are compared without regard to case and written as the
 * remote spells them, since git-spice compares the spelling (D54).
 */
// see primer §23 (string methods: `toLowerCase`, `endsWith`, a negative `slice`) and §9 (an object type written inline)
function githubUrls(host: string): { url: string; apiUrl: string } {
  const lower = host.toLowerCase();
  if (lower === 'github.com') {
    return { url: `https://${host}`, apiUrl: 'https://api.github.com' };
  }
  if (lower.endsWith('.github.com')) {
    // the last two labels as the remote spells them: `GitHub.com` from `SSH.GitHub.com`
    return { url: `https://${host.slice(-'github.com'.length)}`, apiUrl: 'https://api.github.com' };
  }
  if (lower.endsWith('.ghe.com')) {
    return { url: `https://${host}`, apiUrl: `https://api.${host}` };
  }
  return { url: `https://${host}`, apiUrl: `https://${host}/api` };
}

/** A configured url key's host, with its port when it names one (`ghes.corp.com:8443`); `not a URL` for a value that is not one. */
function addressText(address: HostAddress): string {
  if (address.host === '') {
    return 'not a URL';
  }
  return address.port === '' ? address.host : `${address.host}:${address.port}`;
}

/**
 * E67. The login runs in a terminal because git-spice asks there how to log in (verified: with
 * `--no-prompt` it fails "select authenticator: not allowed to prompt for input"), with
 * `--forge` so it does not depend on the remote, and with the forge's token variable unset
 * (TOKEN_VARIABLE says why) — through `env -u`, which BSD and GNU `env` both have.
 */
// see primer §16 (arrays: spread)
function loginOffer(gsPath: string, forge: Forge): Offer {
  const login = [gsPath, 'auth', 'login', '--forge', forge.kind];
  const argv = forge.kind === 'github' || forge.kind === 'gitlab' ? ['env', '-u', TOKEN_VARIABLE[forge.kind], ...login] : login;
  return {
    severity: 'warning',
    message: `git-spice is not logged in to ${forge.host}.`,
    fix: { button: 'Log in', action: { kind: 'terminal', argv }, done: `Logged in to ${forge.host}.` },
  };
}

/** The `gh-missing` member alone, for the three gh install offers. */
// see primer §49 (`Extract`)
type GhMissing = Extract<NotReady, { kind: 'gh-missing' }>;

/**
 * E62b (item 23b): which of the three gh offers. gh itself not found (nothing answered `--version`
 * as gh — `ghVersion` and `ghPath` are null together); gh found and fine but its extension not; gh
 * found and too old (the extension may be missing too — `missing` says so — but gh comes first: a
 * new gh is where `gh extension install` runs, and the probe lists the extension again afterwards).
 * Every sentence a warning: there is something to do (D57). Item 19a's information sentence,
 * produced by item 23a for one PR of interim, is gone (D65, D66).
 */
// see primer §54 (destructuring) and §59 (narrowing two nullable fields at once)
function ghMissingOffer(member: GhMissing, facts: OfferFacts): Offer {
  const { forge, missing, ghVersion, ghPath, ghMinimum } = member;
  if (ghVersion === null || ghPath === null) {
    return ghNotFoundOffer(forge.host, ghMinimum, facts);
  }
  if (!missing.includes('gh')) {
    return ghStackOffer(ghPath, ghVersion, forge.host);
  }
  return ghTooOldOffer(ghPath, ghVersion, ghMinimum, facts);
}

/** gsMissingOffer's rules for gh: the setting, Homebrew's gh out of VS Code's PATH, Homebrew, the page. */
function ghNotFoundOffer(host: string, minimum: string, facts: OfferFacts): Offer {
  if (facts.ghPathSetting.trim() !== '') {
    return textOnly('warning', `prCascade.ghPath is ${facts.ghPathSetting}, which did not answer as gh. Point it at gh, or clear it to try gh from VS Code's PATH.`);
  }
  if (facts.brewGh !== null) {
    return textOnly('warning', `gh is installed at ${facts.brewGh}, but VS Code did not find it. Set prCascade.ghPath to ${facts.brewGh}.`);
  }
  const needed = `Pull requests on ${host} need gh ${minimum} or newer and its gh-stack extension, and gh was not found in VS Code's PATH.`;
  const installed = 'or, if it is already installed, set prCascade.ghPath to its full path.';
  if (facts.brewPath !== null) {
    return {
      severity: 'warning',
      message: `${needed} Install it with Homebrew — ${installed}`,
      fix: { button: 'Install with Homebrew', action: { kind: 'terminal', argv: [facts.brewPath, 'install', 'gh'] }, done: 'gh installed.' },
    };
  }
  return {
    severity: 'warning',
    message: `${needed} Install it — ${installed}`,
    fix: { button: 'Open install docs', action: { kind: 'open-url', url: GH_INSTALL_DOCS_URL }, done: 'gh installed.' },
  };
}

/** gsTooOldOffer's rules for gh: `brew upgrade gh` only for Homebrew's gh with a readable version, else the page. */
function ghTooOldOffer(ghPath: string, found: string, minimum: string, facts: OfferFacts): Offer {
  const readable = parseVersion(found) !== null;
  const where = ghPath.includes('/') ? ` at ${ghPath}` : '';
  const message = readable
    ? `gh ${found}${where} is older than ${minimum}, the oldest PR Cascade works with.`
    : `gh${where} reports version "${found}", so whether it is at least ${minimum} could not be checked.`;
  const fromHomebrew = facts.brewGh !== null && (ghPath === 'gh' || ghPath === facts.brewGh);
  if (readable && facts.brewPath !== null && fromHomebrew) {
    return {
      severity: 'warning',
      message,
      fix: { button: 'Upgrade with Homebrew', action: { kind: 'terminal', argv: [facts.brewPath, 'upgrade', 'gh'] }, done: 'gh upgraded.' },
    };
  }
  return {
    severity: 'warning',
    message,
    fix: { button: 'Open install docs', action: { kind: 'open-url', url: GH_INSTALL_DOCS_URL }, done: 'gh upgraded.' },
  };
}

/**
 * E62b, the extension alone. A terminal, not a hidden run: it downloads a release over the network
 * and prints progress (and a proxy's complaint). No login is needed (measured 2.102.0: the install
 * succeeds with an empty gh config). `command` as the init line has it, so an alias named `gh`
 * cannot take the line over.
 */
function ghStackOffer(ghPath: string, ghVersion: string, host: string): Offer {
  return {
    severity: 'warning',
    message: `gh ${ghVersion} is installed, but its gh-stack extension is not; pull requests on ${host} need it. Install it?`,
    fix: { button: 'Install gh-stack', action: { kind: 'terminal', argv: ['command', ghPath, 'extension', 'install', GH_STACK_EXTENSION] }, done: 'gh-stack installed.' },
  };
}

/**
 * E23 (item 23b). `--web` is the device flow — a code printed, the browser opened, no token
 * anywhere (plan §7.5); `--hostname` always, lower-cased (gh does not fold the flag's case);
 * `--git-protocol` from prCascade.gitProtocol (what gh itself will use for git on this host —
 * nothing of PR Cascade's pushes); the host's token pair unset for this one command
 * (ghTokenVariables says why). The done line names gh because "Logged in to <host>." is already
 * git-spice's and a GitHub flow can show both.
 */
function ghLoginOffer(ghPath: string, forge: Forge, facts: OfferFacts): Offer {
  const lower = forge.host.toLowerCase();
  const tokens = ghTokenVariables(lower);
  return {
    severity: 'warning',
    message: `gh is not logged in to ${forge.host}.`,
    fix: {
      button: 'Log in',
      action: { kind: 'terminal', argv: ['env', '-u', tokens[0], '-u', tokens[1], ghPath, 'auth', 'login', '--hostname', lower, '--web', '--git-protocol', facts.gitProtocol] },
      done: `gh is logged in to ${forge.host}.`,
    },
  };
}
