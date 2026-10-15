/**
 * core/ghstatus.ts — the gh half of the readiness probe for GitHub repositories (plan §7.13.1
 * step 5, §7.5 "auth preflight"): is gh installed and new enough, is its gh-stack extension there,
 * and is gh logged in to this repository's host. Three read-only questions over a CommandRunner,
 * each answered from a banner or an exit code and nothing else. Never `gh auth login`,
 * `gh extension install` or anything that writes: those are the offers' terminal lines
 * (core/readinessFix.ts), typed into a terminal the user watches (src/vscode/login.ts); the login
 * poll is the probe itself through core/poll.ts's waitUntil (D57).
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/command.ts (the runner and its
 * result), core/forge.ts (`ghEnv`), core/version.ts (the floor compare). Depended on by:
 * core/backends/gitspice.ts (step 5), test/unit/ghstatus.test.ts, test/git/gh.git.test.ts; M7's
 * core/nativeStack.ts will run `gh stack link` through `runGh`. Plan: §4.2, §7.5, §7.13.1,
 * §7.13.4, §8 E22/E23/E24/E62b, §9.4 `unit/ghstatus`, §10.1 item 23a, §13.2 D65, §13.4 (the gh
 * 2.102.0 facts, 2026-10-14).
 */

// see primer §1 (import / export) and §9 (`import type`)
import type { CommandResult, CommandRunner } from './command';
import { ghEnv } from './forge';
import { formatVersion, isAtLeast, parseVersion } from './version';
import type { Version } from './version';

/** The one name tried when `prCascade.ghPath` is empty: gh has only ever had one. */
// see primer §4 (const)
export const GH_CANDIDATE = 'gh';

/** The oldest gh the extension drives (plan §7.13.1, §7.13.4): 2.90, the floor plan §11.3 and scripts/doctor.sh carry. */
export const MINIMUM_GH_VERSION: Version = { major: 2, minor: 90, patch: 0 };

/** The official extension's repository, as `gh extension install` and gh's own hint spell it. */
export const GH_STACK_EXTENSION = 'github/gh-stack';

/**
 * How long one gh spawn may take before it is killed and read as "did not answer": the same 15 s
 * as git-spice's PROBE_TIMEOUT_MS, for the same reason (a keychain dialog, a slow disk), under its
 * own name because this module must not import the backend that imports it. The three calls
 * measured take 56 ms, 75 ms and — `auth status`, which validates the token over the network —
 * 0.4 s for a real account, about 0.25 s for a host with no account (GH_HOST puts the host on
 * gh's list, and gh then looks it up — in the OS keyring, else as an empty default token — and
 * validates what it found rather than answer locally; plan §13.4), and on a black-holed network
 * as long as this timeout allows.
 */
// see primer §27 (`_` between digits)
export const GH_TIMEOUT_MS = 15_000;

/**
 * The variables every gh spawn gets on top of the process's own, under `ghEnv(host)`'s GH_HOST
 * (plan §7.5): no prompt — a program the runner starts has no tty, so a prompt would hang until
 * the timeout (the `--web` login's prompts are the terminal's business, core/readinessFix.ts); no
 * update notice for gh and none for an executed extension (`gh stack --version` executes one;
 * both are network calls and stderr lines); no colour; and no telemetry — these spawns are the
 * extension's, up to a hundred in one login wait, not the user's commands, and without this gh
 * writes a device id under the user's state directory on every call (measured 2.102.0, plan
 * §13.4). No LC_ALL: gh has no locale variable and spawns nothing of ours.
 */
// see primer §43 (`Record<string, string>`: any keys, all strings)
export const GH_ENV: Record<string, string> = {
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
  NO_COLOR: '1',
  GH_TELEMETRY: 'false',
};

/**
 * gh's `--version` banner: `gh version 2.102.0 (2026-09-30)`, then the release URL on a second
 * line. The name identifies the program; the token is what parseVersion reads (`DEV` for a source
 * build — a token the floor cannot be checked against, as git-spice's `dev`). `\S+` rather than
 * three numbers so that such a token is still *gh's*, and reads as too old rather than as
 * "not gh".
 */
// see primer §20 (a capturing group; `\S+`)
const GH_BANNER = /^gh version (\S+)/;

/** The extension's own banner: `gh stack version 0.1.1`. Present iff it answers with this — never by exit code alone. */
const GH_STACK_BANNER = /^gh stack version (\S+)/;

/** The version token when `stdout` is gh's own banner, else `null` — how a program is known to be gh: by what it calls itself (D56's rule for git-spice). */
// see primer §23 (`trim`) and §25 (arrays: `split`)
export function ghVersionToken(stdout: string): string | null {
  const match = GH_BANNER.exec(stdout.trim().split('\n')[0]);
  return match === null ? null : match[1];
}

/** The gh-stack version token when `stdout` is the extension's banner, else `null`. Read for identity only — the extension has no floor (D65). */
export function ghStackVersionToken(stdout: string): string | null {
  const match = GH_STACK_BANNER.exec(stdout.trim().split('\n')[0]);
  return match === null ? null : match[1];
}

/**
 * Step 5's answer before the forge is attached (core/backends/gitspice.ts adds it): the two
 * failing shapes carry exactly the fields of the Readiness members of the same name, so the
 * backend copies them over. `gh-ready` carries what `ready.gh` records.
 */
// see primer §59 (tagged unions) and §14 (readonly)
export type GhReadiness =
  | { readonly kind: 'gh-ready'; readonly ghPath: string; readonly ghVersion: string }
  | { readonly kind: 'gh-missing'; readonly missing: readonly ('gh' | 'gh-stack')[]; readonly ghVersion: string | null; readonly ghMinimum: string; readonly ghPath: string | null }
  | { readonly kind: 'gh-not-logged-in'; readonly ghPath: string };

/**
 * The three questions in cost order, first failure wins — except that a gh below the floor still
 * has gh-stack asked, so `missing` lists both when both are wrong (E62b: "exactly what to
 * install"); a gh that did not answer at all has it listed unasked (an extension cannot be there
 * without gh). `ghPath` empty or blank → `gh`; else only that executable, as `prCascade.gsPath`
 * is read (a setting that points at the wrong program says so rather than being worked around).
 * `auth status` is asked only once nothing is missing, and read by exit code alone: gh exits 1 for
 * no account, for a revoked token and offline alike, telling them apart only on stderr — and
 * under GH_HOST even "no account" is a network call, gh validating whatever it finds for the
 * host, the OS keyring's entry or an empty default token (plan §13.4) — and the fix is the same login for the two that have one
 * (D65). Rejects only when the root cannot be used as a directory (the first spawn says so) — a
 * fault, not a state, as locateGitSpice treats it.
 */
// see primer §6 (async / await), §48 (the conditional expression), §25 (arrays: `push`), §23 (`toLowerCase`) and §12 (template strings)
export async function ghReadiness(commands: CommandRunner, ghPath: string, root: string, host: string): Promise<GhReadiness> {
  const executable = ghPath.trim() === '' ? GH_CANDIDATE : ghPath;
  const ghMinimum = formatVersion(MINIMUM_GH_VERSION);
  const banner = await runGh(commands, executable, ['--version'], root, host);
  if (banner.startFailure === 'unusable-directory') {
    // see primer §30 (`??`)
    throw new Error(`readiness: ${root} ${banner.detail ?? 'cannot be used as the working directory'}`);
  }
  const token = ghVersionToken(banner.stdout);
  if (token === null) {
    return { kind: 'gh-missing', missing: ['gh', 'gh-stack'], ghVersion: null, ghMinimum, ghPath: null };
  }
  const version = parseVersion(token);
  const tooOld = version === null || !isAtLeast(version, MINIMUM_GH_VERSION);
  const stack = await runGh(commands, executable, ['stack', '--version'], root, host);
  const missing: ('gh' | 'gh-stack')[] = [];
  if (tooOld) {
    missing.push('gh');
  }
  if (ghStackVersionToken(stack.stdout) === null) {
    missing.push('gh-stack');
  }
  if (missing.length > 0) {
    return { kind: 'gh-missing', missing, ghVersion: token, ghMinimum, ghPath: executable };
  }
  const auth = await runGh(commands, executable, ['auth', 'status', '--hostname', host.toLowerCase()], root, host);
  if (auth.exitCode !== 0) {
    return { kind: 'gh-not-logged-in', ghPath: executable };
  }
  return { kind: 'gh-ready', ghPath: executable, ghVersion: token };
}

/**
 * Runs gh the way every call of ours must (plan §7.5): cwd = the repository root, GH_ENV under
 * GH_HOST for this host (lower-cased by ghEnv — one object per call, so two repositories in one
 * window never share one, E22), the probe's timeout unless the caller asks for its own. Where a
 * command takes `--hostname`, the caller passes the same lower-cased host as the flag — the two
 * are one value on purpose: gh matches the flag against its host list without normalising it,
 * and GH_HOST is what puts a host it has no account for on that list. `--hostname ssh.github.com`
 * alone reads "not logged in" while github.com is; with GH_HOST=ssh.github.com beside it, logged
 * in (measured 2.102.0, plan §13.4). Without the flag GH_HOST makes `auth status` report every
 * host. Exported so the facts file pins the spawn's shape through this function rather than a
 * copy, and M7's `gh stack link` is the same spawn.
 */
// see primer §16 (object literals: two spreads, the later wins) and §13 (a default parameter after required ones)
export function runGh(commands: CommandRunner, executable: string, args: readonly string[], root: string, host: string, timeoutMs: number = GH_TIMEOUT_MS): Promise<CommandResult> {
  return commands.run({ executable, args: [...args], cwd: root, env: { ...GH_ENV, ...ghEnv(host) }, timeoutMs });
}
