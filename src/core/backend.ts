/**
 * core/backend.ts — the contract every stack operation goes through, and the readiness
 * probe's answer. Types only: this file compiles to nothing, and `npm run typecheck` is its
 * test.
 *
 * Layer: core (plan §4.1). Depends on: core/forge.ts (Forge, ForgeConfig). Depended on by:
 * core/backends/gitspice.ts (item 18, the first implementation), src/vscode/login.ts and
 * src/extension.ts (items 19–20). Plan: §4.4 (the target shape — this file declares what the
 * next PR implements and grows with each one, D55), §7.13.1 (the probe), §7.13.3 (what each
 * member runs), §8 E21/E25/E55/E59/E60/E62/E62b/E67/E70/E75.
 */

// see primer §1 (import / export) and §9 (`import type`: a types-only module imports types only)
import type { Forge, ForgeConfig } from './forge';

/**
 * The readiness probe's answer (plan §7.13.1): one object, never a throw. A tagged union on
 * `kind` (primer §59), one member per step that can fail, listed in PROBE ORDER — the first
 * failure is the answer, because every step needs the one before it: no version without an
 * executable, no auth answer without a forge git-spice recognises. Each member carries what
 * its message or one-click fix needs (E55: "the matching one-click fix") and nothing the
 * caller already holds.
 *
 * The order corrects §7.13.1's original numbering (D55): the forge step runs *before* the auth
 * step, because bare `gs auth status` exits 1 with "no remote set" or "No Forge specified"
 * before it ever reports login state, so item 18 asks `gs auth status --forge <kind>` once the
 * kind is known (verified with 0.31.2, plan §13.4). Within the forge step the checks are: no
 * remote (E25), unparseable URL (E21), `kind` unknown (E60), `kind` not github or gitlab
 * (E75), then github or gitlab with `recognizedByGitSpice` false (E70, named after its GitHub
 * case; the offer names the kind's own key) — in that order, so an Azure or Bitbucket host is
 * reported as unsupported, never as "set `spice.forge.*`".
 */
// see primer §59 (tagged unions, incl. `readonly ('gh' | 'gh-stack')[]`: an array of a union) and §14 (readonly)
export type Readiness =
  /**
   * Every step passed. `gsPath` is the executable that answered — `gs` is Ghostscript on some
   * Macs (plan §13.1), so the probe tries `git-spice` too and later commands run whichever
   * worked. `gsVersion` is what `gs version --short` printed, for the log.
   */
  | { readonly kind: 'ready'; readonly gsPath: string; readonly gsVersion: string; readonly forge: Forge }
  /** Step 1, E62: none of the executables ran — `prCascade.gsPath` when set, else `gs` then `git-spice`. `tried` lists them for the message. */
  | { readonly kind: 'gs-missing'; readonly tried: readonly string[] }
  /** Step 1: `gs version --short` printed `found` (`0.30.0`), below the floor `minimum` the message quotes. */
  | { readonly kind: 'gs-too-old'; readonly gsPath: string; readonly found: string; readonly minimum: string }
  /**
   * Step 2, E59: the repository has no `refs/spice/data` — a check with no side effect, never
   * `gs log` (plan §7.6). The offer runs `gs repo init --trunk <branch> --remote <remote>` in a
   * terminal; the caller derives the branch name from `RepoState.trunk` (a ref such as
   * `origin/main`) and has the remote's name.
   */
  | { readonly kind: 'not-initialized'; readonly gsPath: string }
  /** Step 3, E25: `git remote get-url <remote>` found no such remote. */
  | { readonly kind: 'no-remote'; readonly remote: string }
  /** Step 3, E21: the remote's URL names no forge repository — a local path, garbage. `url` is for the message. */
  | { readonly kind: 'remote-unparseable'; readonly remote: string; readonly url: string }
  /**
   * Step 3, E60 when `forge.kind` is `unknown` (the message names `spice.forge.<kind>.url` and
   * `spice.forge.kind`); E70 when it is `github` or `gitlab` and `recognizedByGitSpice` is false,
   * and the offer is `git config spice.forge.<kind>.url https://<host>`, spelled as the remote
   * spells it. By the host alone that happens for `*.ghe.com` (github only — the extension's
   * guess), for a default host while its own url key names another host (github.com beside a
   * GHES url: the key displaces the default), and for a spelling or port git-spice will not
   * match (`GitLab.com`). Through `spice.forge.kind` it happens for any kind: a rejected value,
   * or a valid one whose own url key the remote does not match. `config` is the `spice.forge.*`
   * state detectForge read (`ForgeDetection`'s `forge` member carries it): `config.rejectedKind`
   * is the refused kind when that is the cause (remedy: unset it, or set one of the five ids).
   * For E70 (`forge.kind` is github or gitlab) `config.hosts.get(forge.kind)` is the url key that
   * displaced the default or whose spelling the remote misses — name it and its value before
   * offering a new one. For E60 (`forge.kind` is `unknown`) that lookup finds nothing, since
   * `hosts` is keyed by git-spice's five ids: the key already set with the wrong port or spelling,
   * if any, is the `config.hosts` entry whose host the remote's host equals or ends in — search by
   * host, not by kind — and when there is none the plain E60 offer applies. `gs auth status
   * --forge <kind>` catches none of these, so this step must.
   */
  | { readonly kind: 'forge-unrecognized'; readonly forge: Forge; readonly config: ForgeConfig }
  /** Step 3, E75: bitbucket, gitea, forgejo or azuredevops — the tree works, CR actions say "v1 supports GitHub and GitLab". */
  | { readonly kind: 'forge-unsupported'; readonly forge: Forge }
  /** Step 4, E67: `gs auth status --forge <kind>` exited non-zero. `forge.host` goes in the prompt; `gsPath` runs `gs auth login`. */
  | { readonly kind: 'not-logged-in'; readonly gsPath: string; readonly forge: Forge }
  /**
   * Step 5, E62b, GitHub only: `gh` ≥ 2.90 and the gh-stack extension — the one step where two
   * things can be missing at once, so `missing` is a list, never empty. `ghVersion` is null when
   * gh was not found at all; a gh that is present but too old is `missing: ['gh']` with its version
   * here and the floor in `ghMinimum`, so the message can quote both. Produced from item 23; item
   * 19 already draws it. Push and the local gs operations still work in this state (E24, E62b):
   * only CR creation waits for gh.
   */
  | { readonly kind: 'gh-missing'; readonly forge: Forge; readonly missing: readonly ('gh' | 'gh-stack')[]; readonly ghVersion: string | null; readonly ghMinimum: string };

/**
 * Everything that changes a stack or talks to a forge about one goes through this (plan
 * §4.4). There is one implementation, git-spice (core/backends/gitspice.ts, from item 18); the
 * interface exists so tests can substitute a fake and so a second backend would be additive.
 *
 * Declared with the members the next PR implements, and grown by each PR that implements
 * another (D55): item 18 adds nothing to it (it implements `readiness`), items 20–21 add
 * `enrich`, `track` and `push`, M7–M9 the rest of §4.4 — `createPRs`, `setDraft`, `restack`,
 * `sync`, `moveOnto`, `insertBelow`, `mergeBottom`, `rebaseState` — with their types. A member
 * declared before its implementation would force every implementer and every fake to stub it.
 */
// see primer §9 (interface: methods) and §10 (an exact string as a type: the one value `kind` may hold)
export interface StackBackend {
  /** Which backend this is; the only value today. `prCascade.backend` (plan §7.3) is reserved for a second. */
  readonly kind: 'git-spice';
  /**
   * The §7.13.1 probe for the repository at `root`, whose forge is read from the remote
   * `remote` names (`prCascade.remote`). Memoized per root and remote until a refresh after a
   * failure — a changed `prCascade.remote` is a new question.
   * Never throws: every outcome is a Readiness member.
   */
  readiness(root: string, remote: string): Promise<Readiness>;
}
