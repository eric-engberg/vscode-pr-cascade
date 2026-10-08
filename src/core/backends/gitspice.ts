/**
 * core/backends/gitspice.ts — the git-spice StackBackend. Item 18 implements the readiness
 * probe (plan §7.13.1): is git-spice installed and new enough, is this repository initialised
 * for it, which forge does the remote point at, and is the user logged in to it — answered as
 * one `Readiness` member, the first failing step winning, and remembered once it is `ready`.
 * Items 20–21 add `enrich`, `track` and `push` here, over the same runner.
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/backend.ts (the contract and
 * the answer), core/command.ts (how programs are run), core/forge.ts (detectForge),
 * core/model.ts (GitRunner). Depended on by: src/extension.ts and src/vscode/login.ts (item 19,
 * which builds one per window and turns each failing member into its one-click fix).
 * Plan: §4.4, §7.6, §7.13, §7.13.1, §7.13.3, §8 E17/E22/E55/E59/E60/E62/E67/E70/E75,
 * §13.1 (`gs` is Ghostscript on a Homebrew Mac), §13.2 D56, §13.4 (git-spice 0.31.2 facts).
 */

// see primer §1 (import / export) and §9 (`import type`)
import type { Readiness, StackBackend } from '../backend';
import type { CommandResult, CommandRunner } from '../command';
import { detectForge } from '../forge';
import type { GitRunner } from '../model';

/**
 * The names tried, in order, when `prCascade.gsPath` is empty. `git-spice` first: it has been
 * the program's own name since v0.24.0 (2026-02-22), and from v0.25.0 the official packages —
 * GitHub Releases, Homebrew, the AUR — ship no `gs` at all (git-spice's CHANGELOG), so every
 * official install new enough to pass the 0.31.0 floor answers to it. Then `gs`, the old name,
 * which a `go install` build still gets. Asking `git-spice` first also spares a Mac with
 * Ghostscript the spawn its `gs` would cost on every probe (plan §13.1): Ghostscript answers
 * `--version` with its own bare version, which the banner test rejects, so it is only ever met
 * when `git-spice` is not there. (The order was `gs` first until a review of item 19a found the
 * rename.)
 */
// see primer §4 (const) and §14 (readonly arrays)
export const GS_CANDIDATES: readonly string[] = ['git-spice', 'gs'];

/**
 * The variables every git-spice call gets on top of the process's own (plan §7.13.1): no
 * colour codes in its output, messages in English, and no optional git locks — the same
 * `GIT_OPTIONAL_LOCKS=0` RealGitRunner sets, for the same reason (core/git.ts).
 */
// see primer §43 (`Record<string, string>`: any keys, all strings)
export const GS_ENV: Record<string, string> = { NO_COLOR: '1', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' };

/**
 * How long one probe spawn may take before it is killed and read as "did not answer". The
 * three measured on this Mac take 15–70 ms; the limit is for a tool stuck behind a keychain
 * prompt or a slow disk, which must not hang the refresh for good.
 */
export const PROBE_TIMEOUT_MS = 15_000;

/** A version as the three numbers the probe compares. */
// see primer §9 (interface) and §14 (readonly)
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * The oldest git-spice the extension drives: 0.31 (plan §7.13.1), the version whose
 * `--no-prompt`, `auth status --forge` and `log --json` the plan documents.
 */
export const MINIMUM_GS_VERSION: Version = { major: 0, minor: 31, patch: 0 };

/**
 * `v?major.minor.patch` at the start of the text; anything after the three numbers — `-rc1`,
 * `-dev`, a build report — is ignored, because the floor is a floor on features, and a
 * pre-release or development build of a version has that version's commands. (A library
 * would rank `0.31.0-rc1` below `0.31.0`; that is not the question here.)
 */
// see primer §20 (regular expression literals: `v?` an optional character, three capturing groups)
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)/;

/**
 * Reads a version out of text such as `0.31.2`, `v0.31.2` or `0.32.0-dev`, or `null` for text
 * that does not start with three numbers (`dev`, `0.31`, a Ghostscript banner).
 */
// see primer §27 (`Number`: text to number — the groups hold digits only, so never NaN)
export function parseVersion(text: string): Version | null {
  const match = VERSION.exec(text.trim());
  if (match === null) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Whether `found` is `minimum` or later: the three numbers compared in order, as numbers —
 * `0.9.99` is below `0.31.0` though it would sort after it as text.
 */
export function isAtLeast(found: Version, minimum: Version): boolean {
  if (found.major !== minimum.major) {
    return found.major > minimum.major;
  }
  if (found.minor !== minimum.minor) {
    return found.minor > minimum.minor;
  }
  return found.patch >= minimum.patch;
}

/** `0.31.0` — a version the way a message quotes it. */
// see primer §12 (template strings)
export function formatVersion(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * git-spice's `--version` banner: the program's name, a space, the version token, then
 * whatever else it prints (`git-spice 0.31.2\nCopyright …`). The name is what identifies the
 * program; the token is what `_version` was built with — a release number, or `dev` for a
 * `go install` build. Ghostscript's `gs --no-prompt --version` prints a bare `10.08.0` and exits 0,
 * so neither the exit code nor "it printed a version" would do; the name does.
 */
const GIT_SPICE_BANNER = /^git-spice (\S+)/;

/**
 * The version token when `stdout` is git-spice's own `--version` banner, else `null`. This
 * is how a candidate executable is known to be git-spice: by what it calls itself, never by
 * its exit code. Ghostscript's `gs --version` prints a bare `10.08.0` (no name — `null`), and
 * to `--no-prompt` beside anything but `--version` or `--help` it says `Unknown switch` and exits 1
 * (`null` too); `true` prints nothing; an echo
 * prints the arguments. All `null`, so all "not git-spice, try the next name".
 */
// see primer §23 (`trim`) and §25 (arrays: `split`)
export function gitSpiceVersion(stdout: string): string | null {
  const firstLine = stdout.trim().split('\n')[0];
  const match = GIT_SPICE_BANNER.exec(firstLine);
  if (match === null) {
    return null;
  }
  return match[1];
}

/**
 * The git-spice backend (plan §4.4, §7.13). One per window (item 19 builds it, and builds a
 * new one when `prCascade.gsPath` changes); it holds the git runner, the command runner and
 * the setting, plus the memo of `ready` answers.
 *
 * What the probe never does: run `gs log` (it initialises an uninitialised repository itself,
 * plan §7.6), `gs repo init` or `gs auth login` (side effects, prompts — those are item 19's
 * terminals), reach the network (`auth status` reads the keychain), read `refs/spice/data`'s
 * contents (only its existence, plan §3), or run `gh` (item 23). The happy path is exactly
 * five commands — two of git-spice, three of git — and the tests pin that list.
 */
// see primer §13 (class: `implements`, `private`, a default parameter; a `readonly` field with a
// literal keeps the exact type `'git-spice'`), §46 (a Map as a cache) and §47 (parameter properties)
export class GitSpiceBackend implements StackBackend {
  readonly kind = 'git-spice';

  /**
   * The `ready` answers so far, by repository and remote (plan §7.13.1: "memoized per root
   * and remote"). Only `ready` is ever stored: a failing step is asked again on the next
   * refresh — which is how an install, `gs repo init` or `gs auth login` done meanwhile is
   * noticed, and what lets item 19 poll `readiness()` itself after opening the terminal. The
   * key joins the two values with a NUL, the one character a path cannot contain (primer §44).
   */
  private readonly readyByRepo = new Map<string, Readiness>();

  constructor(
    private readonly git: GitRunner,
    private readonly commands: CommandRunner,
    /**
     * `prCascade.gsPath` as read: `''` (the default from item 18, as `gitPath` is empty for
     * "the Git extension's git" — or only whitespace, a setting cleared by hand) tries
     * GS_CANDIDATES in order; anything else is the one
     * executable tried, so a setting that points at the wrong program says so (E62) rather
     * than being quietly worked around.
     */
    private readonly gsPath: string = '',
  ) {}

  /**
   * Plan §7.13.1's steps 1–4 in order, first failure wins; step 5 (gh, for GitHub's native
   * stack) is item 23's, so until then a logged-in GitHub repository is `ready`. Never throws
   * for anything git-spice or the forge can be in — every such outcome is a Readiness member.
   * It rejects only as every core function does: when git itself cannot run (E17), or when the
   * root cannot be used as a directory — faults the caller already draws for the tree, with
   * no one-click fix a member could carry.
   */
  // see primer §6 (async / await) and §44 (`\0` in a string literal)
  async readiness(root: string, remote: string): Promise<Readiness> {
    const key = `${root}\0${remote}`;
    const remembered = this.readyByRepo.get(key);
    if (remembered !== undefined) {
      return remembered;
    }
    const answer = await probe(this.git, this.commands, this.gsPath, root, remote);
    if (answer.kind === 'ready') {
      this.readyByRepo.set(key, answer);
    }
    return answer;
  }
}

/**
 * Step 1's answer when it is good news: the executable that answered as git-spice and the
 * version token it printed. The other answers step 1 can give are Readiness members (`gs-missing`,
 * `gs-too-old`), so locateGitSpice returns one or the other and the caller tells them apart by
 * `kind` — `'located'` is not a Readiness kind.
 */
// see primer §59 (tagged unions: a member of our own beside Readiness's)
interface LocatedGitSpice {
  readonly kind: 'located';
  readonly gsPath: string;
  readonly gsVersion: string;
}

/**
 * Step 1 of the probe: which executable is git-spice, and is it new enough. Every name asked
 * goes into `tried`, Ghostscript's `gs` included — it was tried, and did not answer as
 * git-spice. Its own function so that `probe` below reads as the four steps (and so that each
 * stays simple enough for a reader — and for SonarCloud's complexity rule, which asked for the
 * split).
 */
// see primer §48 (the conditional expression) and §22 (for ... of, and `break`)
async function locateGitSpice(commands: CommandRunner, gsPath: string, root: string): Promise<LocatedGitSpice | Readiness> {
  const candidates = gsPath.trim() === '' ? GS_CANDIDATES : [gsPath];
  const tried: string[] = [];
  let located: LocatedGitSpice | undefined = undefined;
  for (const candidate of candidates) {
    tried.push(candidate);
    const banner = await gs(commands, candidate, ['--version'], root);
    if (banner.startFailure === 'unusable-directory') {
      // Not about git-spice at all: the repository root is gone or cannot be entered. The
      // same class of fault as E17, with no member and no fix to offer — the caller sees it.
      throw new Error(`readiness: ${root} ${banner.detail ?? 'cannot be used as the working directory'}`);
    }
    const token = gitSpiceVersion(banner.stdout);
    if (token !== null) {
      located = { kind: 'located', gsPath: candidate, gsVersion: token };
      break;
    }
  }
  if (located === undefined) {
    return { kind: 'gs-missing', tried };
  }
  const version = parseVersion(located.gsVersion);
  if (version === null || !isAtLeast(version, MINIMUM_GS_VERSION)) {
    // `null` is a token the probe cannot read — `dev`, a build with no number: git-spice, but
    // not confirmably new enough, so the honest answer is this member with the token as found.
    return { kind: 'gs-too-old', gsPath: located.gsPath, found: located.gsVersion, minimum: formatVersion(MINIMUM_GS_VERSION) };
  }
  return located;
}

/**
 * One run of the probe, uncached. A function beside the class rather than a method, as
 * core/git.ts keeps its helpers: the class holds state, this holds the steps.
 */
// see primer §59 (tagged unions: building members, and narrowing `forge.kind` with `!==`)
async function probe(git: GitRunner, commands: CommandRunner, gsPath: string, root: string, remote: string): Promise<Readiness> {
  // Step 1: see locateGitSpice. Anything but `located` is already the answer.
  const located = await locateGitSpice(commands, gsPath, root);
  if (located.kind !== 'located') {
    return located;
  }

  // Step 2: initialised. `gs repo init` writes `refs/spice/data`; its existence is the fact,
  // and `rev-parse --verify --quiet` asks exactly that with no side effect (exit 1, silent,
  // when the ref is not there — tryRun's null). Never `gs log` here: on 0.31.2 it initialises
  // the repository itself (plan §7.6). The ref's contents stay unread (plan §3).
  const dataRef = await git.tryRun(['rev-parse', '--verify', '--quiet', 'refs/spice/data'], root);
  if (dataRef === null) {
    return { kind: 'not-initialized', gsPath: located.gsPath };
  }

  // Step 3: the forge, in backend.ts's order — no remote, no URL, unknown host, a forge v1
  // does not serve, then a host git-spice will not match — so an Azure or Bitbucket host is
  // reported as unsupported and never offered a `spice.forge.*` key.
  const detection = await detectForge(git, root, remote);
  if (detection.kind === 'no-remote') {
    return { kind: 'no-remote', remote };
  }
  if (detection.kind === 'unparseable') {
    return { kind: 'remote-unparseable', remote, url: detection.url };
  }
  // see primer §54 (destructuring: two fields out of the detection)
  const { forge, config } = detection;
  if (forge.kind === 'unknown') {
    return { kind: 'forge-unrecognized', forge, config };
  }
  if (forge.kind !== 'github' && forge.kind !== 'gitlab') {
    return { kind: 'forge-unsupported', forge };
  }
  if (!forge.recognizedByGitSpice) {
    return { kind: 'forge-unrecognized', forge, config };
  }

  // Step 4: logged in. `--forge <kind>` is given because bare `gs auth status` exits 1 for
  // "no remote" and "no forge found" before it says anything about login (plan §13.4); with
  // it, exit 0 is logged in and anything else is not — stderr is not read, since every
  // non-zero answer has the same fix. `forge.kind` is `github` or `gitlab` here — the two tests
  // above narrowed it (primer §45) — which is what guarantees `--forge` is only ever asked about
  // a kind v1 serves; the call would compile without the narrowing, since `args` takes any string.
  const auth = await gs(commands, located.gsPath, ['auth', 'status', '--forge', forge.kind], root);
  if (auth.exitCode !== 0) {
    return { kind: 'not-logged-in', gsPath: located.gsPath, forge };
  }
  return { kind: 'ready', gsPath: located.gsPath, gsVersion: located.gsVersion, forge };
}

/**
 * Runs git-spice the way every call of ours must (plan §7.13, §7.13.1): `--no-prompt` first,
 * so nothing ever waits for an answer; GS_ENV; the repository root as the working directory —
 * never `-C`, because 0.31.2 reads `spice.forge.*` from the directory it was started in, not
 * the one `-C` names (plan §13.4); and the probe's timeout.
 */
// see primer §16 (arrays: spread puts `--no-prompt` before the caller's arguments)
function gs(commands: CommandRunner, executable: string, args: readonly string[], root: string): Promise<CommandResult> {
  return commands.run({ executable, args: ['--no-prompt', ...args], cwd: root, env: GS_ENV, timeoutMs: PROBE_TIMEOUT_MS });
}
