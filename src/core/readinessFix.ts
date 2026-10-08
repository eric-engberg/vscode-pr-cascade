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
 * `Ready`), core/backends/gitspice.ts (`parseVersion`), core/forge.ts (types), core/model.ts
 * (`GitRunner`), core/shell.ts (a command quoted inside a sentence), Node's `node:path`.
 * Depended on by: src/vscode/login.ts and src/extension.ts (item 19b),
 * test/unit/readinessFix.test.ts, test/git/trunkBranch.git.test.ts. Plan: §7.6, §7.13.1, §8
 * E21/E25/E55/E59/E60/E62/E62b/E67/E70/E75, §10.1 item 19a, §13.2 D57.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as path from 'node:path';
import type { NotReady, Ready } from './backend';
import { parseVersion } from './backends/gitspice';
import type { Forge, ForgeConfig, ForgeKind, HostAddress } from './forge';
import type { GitRunner } from './model';
import { shellCommandLine } from './shell';

/** git-spice's install page — the offer when Homebrew is not there, or the git-spice found is not Homebrew's. */
// see primer §4 (const)
export const INSTALL_DOCS_URL = 'https://abhinav.github.io/git-spice/start/install/';

/**
 * The environment variable git-spice reads as a login, for each forge v1 serves. While it is
 * set, git-spice counts the user as logged in, and refuses `auth login` ("already logged in"),
 * even with `--refresh` (verified 0.31.2 for both). The login offer unsets it for that one
 * command, so a terminal that happens to export it still stores a real login.
 */
// see primer §43 (`Record<K, V>`: one value for each member of a union of keys)
const TOKEN_VARIABLE: Record<'github' | 'gitlab', string> = { github: 'GITHUB_TOKEN', gitlab: 'GITLAB_TOKEN' };

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
 * test/unit/readinessFix.test.ts. Six members have a function of their own below; the three
 * that are a single sentence (no-remote, remote-unparseable, forge-unsupported) are worded here.
 * Taking `NotReady` rather than `Readiness` means `ready` cannot be passed in, and the chain of
 * `if`s is complete: after the eight tests, the compiler has narrowed `readiness` to
 * `gh-missing` (primer §59), so a member added to the union later is a compile error on the
 * last line until it gets a case.
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
  return ghMissingOffer(readiness.forge.host, readiness.missing, readiness.ghVersion, readiness.ghMinimum);
}

/** `git-spice 0.31.2 is ready for app (github.com).` — the answer when the user asked by hand and every step passed. */
// see primer §12 (template strings)
export function readyMessage(ready: Ready, root: string): string {
  return `git-spice ${ready.gsVersion} is ready for ${path.basename(root)} (${ready.forge.host}).`;
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
  if (configured !== undefined && configured.host === '') {
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

/**
 * E62b, produced from item 23: what is missing for pull requests on GitHub, with the version of
 * a gh that is there but too old. Information — pushing and every local operation still work —
 * and no button until item 23 decides how gh is installed.
 */
// see primer §25 (arrays: `map`), §48 (the conditional expression) and §59 (`readonly ('gh' | 'gh-stack')[]`)
function ghMissingOffer(host: string, missing: readonly ('gh' | 'gh-stack')[], ghVersion: string | null, ghMinimum: string): Offer {
  const listed = missing.map((name) => (name === 'gh' && ghVersion !== null ? `gh (found ${ghVersion})` : name));
  return textOnly(
    'information',
    `Pull requests on ${host} need gh ${ghMinimum} or newer and its gh-stack extension; missing: ${listed.join(', ')}. Pushing and the local git-spice operations still work.`,
  );
}
