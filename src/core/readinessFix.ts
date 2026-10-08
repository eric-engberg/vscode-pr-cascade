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
 * (`GitRunner`), Node's `node:path`. Depended on by: src/vscode/login.ts and src/extension.ts
 * (item 19b), test/unit/readinessFix.test.ts, test/git/trunkBranch.git.test.ts. Plan: §7.6,
 * §7.13.1, §8 E21/E25/E55/E59/E60/E62/E62b/E67/E70/E75, §10.1 item 19a, §13.2 D57.
 */

// see primer §1 (import / export) and §9 (`import type`)
import * as path from 'node:path';
import type { NotReady, Ready } from './backend';
import { parseVersion } from './backends/gitspice';
import type { Forge, ForgeConfig, ForgeKind, HostAddress } from './forge';
import type { GitRunner } from './model';

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
  /** No trunk was found (E4). Also what the caller passes for every member but `not-initialized`, which never reads it. */
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
  /** `prCascade.gsPath` as read: empty or blank means "try `gs`, then `git-spice`", as core/backends/gitspice.ts reads it. */
  readonly gsPathSetting: string;
  /** Where Homebrew's `brew` is, or `null` when there is none (item 19b looks in its usual places). */
  readonly brewPath: string | null;
}

/** What one button does. Item 19b has one branch per kind and nothing else interprets it. */
// see primer §59 (tagged unions)
export type Fix =
  /** Run `argv` in the repository's terminal (cwd = root), then wait for the step to pass: the user may have to answer prompts. */
  | { readonly kind: 'terminal'; readonly argv: readonly string[] }
  /** Run `git <args>` in the repository, with no terminal: nothing to answer, and it is done when git returns. */
  | { readonly kind: 'git'; readonly args: readonly string[] }
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
 * test/unit/readinessFix.test.ts. Each member has its own small function below; this one only
 * picks. Taking `NotReady` rather than `Readiness` means `ready` cannot be passed in, and the
 * chain of `if`s is complete: after the eight tests, the compiler has narrowed `readiness` to
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
 * (plus a warning on stderr) for a name that is both a branch and a remote-tracking ref, and
 * exit 1 for a name it does not know. `--end-of-options` keeps a trunk starting with `-` from
 * being read as an option. For a remote-tracking ref, the branch is everything after the remote's
 * name — `refs/remotes/upstream/release/2.0` → `release/2.0` — taken from the ref itself rather
 * than from `prCascade.remote`, because a fork's trunk can live on another remote; then a second
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
 * change nothing: the sentence points at the setting. Otherwise the sentence says *VS Code's*
 * PATH — a terminal may well find git-spice where VS Code did not (plan §13.1) — and the button
 * installs it with Homebrew when there is one, or opens the install page.
 */
// see primer §25 (arrays: `join`) and §14 (`readonly` on an array type)
function gsMissingOffer(tried: readonly string[], facts: OfferFacts): Offer {
  if (facts.gsPathSetting.trim() !== '') {
    return textOnly(
      'warning',
      `prCascade.gsPath is ${facts.gsPathSetting}, which did not answer as git-spice. Point it at git-spice, or clear it to try gs and git-spice.`,
    );
  }
  const notFound = `git-spice was not found in VS Code's PATH (tried ${tried.join(', ')}).`;
  if (facts.brewPath !== null) {
    return {
      severity: 'warning',
      message: `${notFound} Install it with Homebrew, or set prCascade.gsPath if it is installed elsewhere.`,
      fix: { button: 'Install with Homebrew', action: { kind: 'terminal', argv: ['brew', 'install', 'git-spice'] }, done: 'git-spice installed.' },
    };
  }
  return {
    severity: 'warning',
    message: `${notFound} Install it, or set prCascade.gsPath if it is installed elsewhere.`,
    fix: { button: 'Open install docs', action: { kind: 'open-url', url: INSTALL_DOCS_URL }, done: 'git-spice installed.' },
  };
}

/**
 * Too old, or a version that cannot be read (`dev`, a `go install` build). `brew upgrade` only
 * for an executable named `git-spice` — Homebrew is the one install that renames git-spice's own
 * `gs` (core/backends/gitspice.ts, GS_CANDIDATES), so a `gs` came from somewhere Homebrew cannot
 * upgrade — and only for a version that was read; otherwise the install page.
 */
// see primer §48 (the conditional expression)
function gsTooOldOffer(gsPath: string, found: string, minimum: string, facts: OfferFacts): Offer {
  const readable = parseVersion(found) !== null;
  const message = readable
    ? `git-spice ${found} at ${gsPath} is older than ${minimum}, the oldest PR Cascade works with.`
    : `git-spice at ${gsPath} reports version "${found}", so whether it is at least ${minimum} could not be checked.`;
  if (readable && facts.brewPath !== null && path.basename(gsPath) === 'git-spice') {
    return {
      severity: 'warning',
      message,
      fix: { button: 'Upgrade with Homebrew', action: { kind: 'terminal', argv: ['brew', 'upgrade', 'git-spice'] }, done: 'git-spice upgraded.' },
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
 * one, the sentence says what to do first and there is no button.
 */
function initOffer(gsPath: string, repo: string, facts: OfferFacts): Offer {
  const trunk = facts.trunkBranch;
  if (trunk.kind === 'none') {
    return textOnly('warning', `git-spice is not initialised in ${repo}, and no trunk was found to initialise it with — set prCascade.trunk first.`);
  }
  if (trunk.kind === 'not-a-branch') {
    return textOnly('warning', `git-spice is not initialised in ${repo}, and its trunk ${trunk.trunk} is not a branch — set prCascade.trunk to one first.`);
  }
  if (trunk.kind === 'missing') {
    return textOnly(
      'warning',
      `git-spice is not initialised in ${repo}; it needs trunk ${trunk.branch} as a local branch, and there is only ${trunk.trunk}. Create it with git branch ${trunk.branch} ${trunk.trunk}.`,
    );
  }
  return {
    severity: 'warning',
    message: `git-spice is not initialised in ${repo}. Initialise it with trunk ${trunk.branch} and remote ${facts.remote}?`,
    fix: {
      button: 'Initialise',
      action: { kind: 'terminal', argv: [gsPath, 'repo', 'init', '--trunk', trunk.branch, '--remote', facts.remote] },
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
 * E70 proper, a GitHub or GitLab host git-spice will not match, whose offer is a `git config`
 * line in this repository's own file (it wins over a global value, so other repositories keep
 * theirs — hence "for <repo>") naming `https://<host>` as the remote spells the host. No port in
 * that URL: a remote's port is usually ssh's, not the web server's.
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
  const url = `https://${host}`;
  let message = `git-spice will not match ${host} as ${name} until ${key} names it. Set it to ${url} for ${repo}?`;
  if (configured !== undefined && configured.host === '') {
    message = `${key} is not a URL, so git-spice matches nothing as ${name}. Set it to ${url} for ${repo}?`;
  } else if (configured !== undefined) {
    message = `${key} names ${addressText(configured)}, so git-spice no longer matches ${host} as ${name}. Point it at ${url} for ${repo}?`;
  }
  return {
    severity: 'warning',
    message,
    fix: { button: `Set ${key}`, action: { kind: 'git', args: ['config', key, url] }, done: `${key} set to ${url}.` },
  };
}

/** A configured url key's host, with its port when it names one (`ghes.corp.com:8443`); `(not a URL)` for a value that is not one. */
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
// see primer §25 (arrays: `map`) and §48 (the conditional expression)
function ghMissingOffer(host: string, missing: readonly ('gh' | 'gh-stack')[], ghVersion: string | null, ghMinimum: string): Offer {
  const listed = missing.map((name) => (name === 'gh' && ghVersion !== null ? `gh (found ${ghVersion})` : name));
  return textOnly(
    'information',
    `Pull requests on ${host} need gh ${ghMinimum} or newer and its gh-stack extension; missing: ${listed.join(', ')}. Pushing and the local git-spice operations still work.`,
  );
}
