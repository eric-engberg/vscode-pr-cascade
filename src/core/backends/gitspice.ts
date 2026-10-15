/**
 * core/backends/gitspice.ts — the git-spice StackBackend. Item 18 implements the readiness
 * probe (plan §7.13.1): is git-spice installed and new enough, is this repository initialised
 * for it, which forge does the remote point at, and is the user logged in to it — answered as
 * one `Readiness` member, the first failing step winning, and remembered once it is `ready`.
 * Item 20a adds `enrich` — plan §7.8's local tier, `gs log short --all --json` behind the
 * §7.14.2 digest memo, self-gated on `refs/spice/data` — and `track`, which adopts the layers
 * git-spice does not know, bottom to top. Item 21 adds `push`, over the same runner.
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/backend.ts (the contract and
 * the answers), core/command.ts (how programs are run), core/digest.ts (`readRefDigest`,
 * `isInitialised`), core/forge.ts (detectForge), core/gsLog.ts (`parseGsLog`), core/model.ts
 * (GitRunner, RepoState, StackLayer, Enrichment), core/readinessFix.ts (`TrunkBranch`, as a
 * type only — that file imports `parseVersion` from here at runtime, so this side stays a type
 * and nothing runs in a circle), core/shell.ts (`shellCommandLine`, for the sentence that names
 * a git command). Depended on by: core/readinessFix.ts (item 19a, `parseVersion`) and
 * src/extension.ts (item 19b, which builds one per window and calls `forget` before the setup
 * command's look; the flow in src/vscode/login.ts sees only a probe function and the `Readiness`
 * types from core/backend.ts; item 20b calls `enrich` on every load and `track` from Track
 * Stack). Plan: §4.4, §7.6, §7.8, §7.13,
 * §7.13.1, §7.13.3, §7.14.2, §8 E17/E22/E55/E56/E57/E59/E60/E62/E67/E70/E75/E83, §13.1 (`gs` is
 * Ghostscript on a Homebrew Mac), §13.2 D56/D59, §13.4 (git-spice 0.31.2 facts, 2026-10-08).
 */

// see primer §1 (import / export) and §9 (`import type`)
import type { Readiness, StackBackend, TrackResult } from '../backend';
import type { CommandResult, CommandRunner } from '../command';
import { isInitialised, readRefDigest } from '../digest';
import { detectForge } from '../forge';
import type { GsLogEntry } from '../gsLog';
import { parseGsLog } from '../gsLog';
import type { Enrichment, EnrichmentCause, GitRunner, RepoState, StackLayer } from '../model';
import type { TrunkBranch } from '../readinessFix';
import { shellCommandLine } from '../shell';

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
// see primer §27 (`_` between digits: `15_000` is 15000)
export const PROBE_TIMEOUT_MS = 15_000;

/**
 * `gs log`'s arguments (item 20a): `short` and `--json` as plan §7.13.2 documents, and `--all`
 * for every tracked branch whatever HEAD is on — without it a tracked HEAD prints only its own
 * stack, so "absent from the output" would mean "untracked" only by accident (verified 0.31.2,
 * D59). `--no-prompt` is `gs()`'s. Exported so the tests can spell the argv from the same list.
 */
export const GS_LOG_ARGS: readonly string[] = ['log', 'short', '--all', '--json'];

/**
 * The git question "is this repository initialised for git-spice" (plan §7.6, D56): `gs repo
 * init` writes `refs/spice/data`, and `rev-parse --verify --quiet` asks whether it exists with
 * no side effect — exit 1, silent, when it is not there, which is `tryRun`'s `null`. The ref's
 * contents stay unread (plan §3). The probe asks it; so does `track`, before its first spawn.
 */
const SPICE_DATA_REF: readonly string[] = ['rev-parse', '--verify', '--quiet', 'refs/spice/data'];

/** The one phrase for a repository without `refs/spice/data`: `enrich`'s reason and `track`'s problem alike. */
const NOT_INITIALISED = 'the repository is not initialised for git-spice (no refs/spice/data)';

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
 * What `enrich` remembers for one repository root: the last `gs log` answer by branch name, the
 * digest it was read under, and whether every line of it parsed — an incomplete answer leaves
 * the layers it does not list unknown (see withTracking), and stays incomplete until the digest
 * moves and `gs log` runs again.
 */
// see primer §9 (interface) and §14 (readonly; `ReadonlyMap`: a Map nobody may `set` on)
interface RememberedLog {
  readonly digest: string;
  readonly byName: ReadonlyMap<string, GsLogEntry>;
  readonly complete: boolean;
}

/**
 * The git-spice backend (plan §4.4, §7.13). One per window (item 19b builds it, and builds a
 * new one when `prCascade.gsPath` changes); it holds the git runner, the command runner and
 * the setting, plus two memos: the `ready` answers, and the last `gs log` answer per root.
 *
 * What the probe never does: run `gs log` (on an uninitialised repository it would try to
 * initialise it, plan §7.6 — see `enrich`), `gs repo init` or `gs auth login` (side effects,
 * prompts — those are item 19b's terminals), reach the network (`auth status` reads the
 * keychain), read `refs/spice/data`'s contents (only its existence, plan §3), or run `gh` (item
 * 23). The happy path is exactly five commands — two of git-spice, three of git — and the tests
 * pin that list. `enrich` keeps the same rules: it runs `gs log` only on an initialised
 * repository, and only when a ref it could read has moved.
 */
// see primer §13 (class: `implements`, `private`, a default parameter; a `readonly` field with a
// literal keeps the exact type `'git-spice'`), §46 (a Map as a cache) and §47 (parameter properties)
export class GitSpiceBackend implements StackBackend {
  readonly kind = 'git-spice';

  /**
   * The `ready` answers so far, by repository and remote (plan §7.13.1: "memoized per root
   * and remote"). Only `ready` is ever stored: a failing step is asked again on the next
   * refresh — which is how an install, `gs repo init` or `gs auth login` done meanwhile is
   * noticed, and what lets item 19b poll `readiness()` itself after opening the terminal. The
   * key joins the two values with a NUL, the one character a path cannot contain (primer §44).
   */
  private readonly readyByRepo = new Map<string, Readiness>();

  /**
   * The last `gs log` answer per repository root, with the digest it was read under (plan
   * §7.14.2: "gs log runs only when it changed"). A hit is `remembered.digest === digest` — the
   * key's validity is the text it was computed from — and the remembered answer is applied to
   * the layers as they are *now*, by name, so a checkout (which moves no ref the digest lists)
   * changes the rows without a `gs log`. Set only after exit 0: a failure is asked again on
   * the next refresh, as `readyByRepo` does. One entry per root, however many windows' worth
   * of refreshes.
   */
  private readonly logByRoot = new Map<string, RememberedLog>();

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

  /**
   * Drops the remembered `ready` for `root` and `remote`, so the next `readiness` probes again.
   * The memo is right for an action gated on readiness — five programs per click would be
   * wasted on a repository that was ready a minute ago — but wrong when the user asks by hand
   * (item 19b's "Set Up git-spice"), who may just have run `gs auth logout` or `gs repo init
   * --reset` in a terminal: that command forgets first (D57). Items 20–21 will do the same
   * after an operation fails on login or init, then ask again. Not part of `StackBackend`
   * (core/backend.ts) until something other than this class needs it (D55).
   */
  // see primer §46 (a Map as a cache: `delete`)
  forget(root: string, remote: string): void {
    this.readyByRepo.delete(`${root}\0${remote}`);
  }

  /**
   * Plan §7.8's local tier — StackBackend.enrich (core/backend.ts) says what it promises. In
   * order: nothing to ask → the same object back; the digest (one git command, ~10 ms; a
   * failing git rejects, E17); no `refs/spice/data` line in it → not enriched with **no program
   * run** (plan §7.6: on an uninitialised repository `gs log` would try to initialise it and,
   * under `--no-prompt`, die at the trunk prompt — exit 1, nothing written, verified 0.31.2;
   * the FTL would be no answer, and an unasked init no better); the memo — the same digest as
   * last time → last time's answer applied to today's layers; else step 1 of the probe (which
   * executable, is it new enough — one 20 ms spawn, only right before a `gs log`), then `gs log
   * short --all --json` (0.3–0.6 s), parsed and remembered with the digest it was read under.
   *
   * `gs log` is not quite read-only: when it finds a tracked branch deleted out of band it
   * prunes it and moves `refs/spice/data` while printing (verified 0.31.2), so the refresh after
   * such a run sees a new digest and asks once more; the run after that hits the memo.
   */
  // see primer §46 (a cache: a hit is `remembered.digest === digest`, set on success only)
  async enrich(state: RepoState): Promise<RepoState> {
    if (state.trunk === null || state.layers.length === 0) {
      return state;
    }
    const digest = await readRefDigest(this.git, state.root);
    if (!isInitialised(digest)) {
      return notEnriched(state, 'not-initialised', NOT_INITIALISED);
    }
    const remembered = this.logByRoot.get(state.root);
    if (remembered !== undefined && remembered.digest === digest) {
      return withTracking(state, remembered, { kind: 'enriched', ranGsLog: false, malformed: [] });
    }
    const located = await locateGitSpice(this.commands, this.gsPath, state.root);
    if (located.kind !== 'located') {
      return notEnriched(state, located.kind, notLocatedReason(located, this.gsPath));
    }
    const result = await gs(this.commands, located.gsPath, GS_LOG_ARGS, state.root);
    if (result.exitCode !== 0) {
      return notEnriched(state, 'gs-log-failed', `gs ${GS_LOG_ARGS.join(' ')} failed: ${describeResult(result)}`);
    }
    const parsed = parseGsLog(result.stdout);
    // By name, the later of two lines naming one branch winning — `set` overwrites.
    // see primer §19 (Map: `set`) and §22 (for ... of)
    const byName = new Map<string, GsLogEntry>();
    for (const entry of parsed.entries) {
      byName.set(entry.name, entry);
    }
    const answer: RememberedLog = { digest, byName, complete: parsed.malformed.length === 0 };
    this.logByRoot.set(state.root, answer);
    return withTracking(state, answer, { kind: 'enriched', ranGsLog: true, malformed: parsed.malformed });
  }

  /**
   * Plan §7.13.3's `track` — StackBackend.track (core/backend.ts) says what it promises. Only
   * layers whose `tracking` is `null` are touched: a tracked one would have its base moved
   * silently by a second `gs branch track`, git-spice's trunk line is refused ("cannot track
   * trunk branch"), and a layer with no `tracking` at all is unknown (verified 0.31.2, all
   * three). Nothing to do → no git, no program. Else two guards before the first spawn, kept
   * here although a caller who just ran `enrich` has paid for both — `track` is a backend
   * member any caller may use (M7's preflight next), and the invariant belongs beside the
   * spawn: `refs/spice/data` must exist (on an uninitialised repository `gs branch track`
   * tries to initialise it and dies at the trunk prompt under `--no-prompt`, writing nothing —
   * verified), and git-spice must be found and new enough. Then one `gs branch track <name>
   * --base <base>` per layer, bottom to top, stopping at the first that does not exit 0.
   *
   * Every `problem` is a full sentence — capital, full stop — because the command (item 20b)
   * shows it as it is; `enrich`'s `reason` is a phrase, because the Output line embeds it. The
   * guards' sentences say that nothing was tracked, so a reader of the notification alone knows.
   */
  // see primer §25 (arrays: `some`), §16 (arrays: spread — a mutable copy, since `tryRun` takes
  // `string[]`), §29 (a counted loop: the index finds the layer below) and §51 (`in`: which
  // member of baseFor's answer this is)
  async track(root: string, layers: readonly StackLayer[], trunkBranch: TrunkBranch): Promise<TrackResult> {
    if (!layers.some((layer) => layer.tracking === null)) {
      return { tracked: [], problem: null };
    }
    const dataRef = await this.git.tryRun([...SPICE_DATA_REF], root);
    if (dataRef === null) {
      return { tracked: [], problem: `Nothing was tracked: ${NOT_INITIALISED}.` };
    }
    const located = await locateGitSpice(this.commands, this.gsPath, root);
    if (located.kind !== 'located') {
      return { tracked: [], problem: `Nothing was tracked: ${notLocatedReason(located, this.gsPath)}.` };
    }
    const tracked: string[] = [];
    for (let index = 0; index < layers.length; index++) {
      const layer = layers[index];
      if (layer.tracking !== null) {
        continue;
      }
      const base = baseFor(layers, index, trunkBranch);
      if ('problem' in base) {
        return { tracked, problem: base.problem };
      }
      const result = await gs(this.commands, located.gsPath, ['branch', 'track', layer.name, '--base', base.base], root);
      if (result.exitCode !== 0) {
        return { tracked, problem: `git-spice could not track ${layer.name}: ${describeResult(result)}.` };
      }
      tracked.push(layer.name);
    }
    return { tracked, problem: null };
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
 * Step 1's two failing answers — the only Readiness members locateGitSpice can give. Named so
 * that `enrich` and `track`, which stop at step 1, can hand the answer to notLocatedReason
 * without a case for members step 1 never produces.
 */
// see primer §49 (`Extract`: the members of a union whose `kind` is one of two)
type NotLocated = Extract<Readiness, { kind: 'gs-missing' | 'gs-too-old' }>;

/**
 * Step 1 of the probe: which executable is git-spice, and is it new enough. Every name asked
 * goes into `tried`, Ghostscript's `gs` included — it was tried, and did not answer as
 * git-spice. Its own function so that `probe` below reads as the four steps (and so that each
 * stays simple enough for a reader — and for SonarCloud's complexity rule, which asked for the
 * split); from item 20a `enrich` and `track` run it too, right before their first git-spice
 * command.
 */
// see primer §48 (the conditional expression) and §22 (for ... of, and `break`)
async function locateGitSpice(commands: CommandRunner, gsPath: string, root: string): Promise<LocatedGitSpice | NotLocated> {
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

  // Step 2: initialised — SPICE_DATA_REF says how. Never `gs log` here: on an uninitialised
  // repository it would try to initialise it (plan §7.6). The ref's contents stay unread (plan §3).
  const dataRef = await git.tryRun([...SPICE_DATA_REF], root);
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

/**
 * `state` with `enrichment` set and each layer's `tracking` filled from the answer: the entry
 * naming it; `null` when a complete answer does not list it (untracked, E56); and no key at all
 * when an *incomplete* answer does not list it — a malformed line names no branch (core/gsLog.ts),
 * so absence proves nothing (unknown), and `null` there would read "not tracked" and let Track
 * Stack run `gs branch track` on a branch git-spice already tracks, moving its base. New state
 * and layer objects: the input is never changed, and a test can compare it with what it was.
 */
// see primer §25 (arrays: `map`) and §16 (object literals: spread copies a layer, then adds a field)
function withTracking(state: RepoState, answer: RememberedLog, enrichment: Enrichment): RepoState {
  const layers = state.layers.map((layer) => {
    const entry = answer.byName.get(layer.name);
    if (entry !== undefined) {
      return { ...layer, tracking: entry };
    }
    if (answer.complete) {
      return { ...layer, tracking: null };
    }
    return { ...layer };
  });
  return { ...state, layers, enrichment };
}

/** `state` with a `not-enriched` enrichment and its layers as they were — no `tracking` key on any (E57's degrade). */
function notEnriched(state: RepoState, cause: EnrichmentCause, reason: string): RepoState {
  return { ...state, enrichment: { kind: 'not-enriched', cause, reason } };
}

/**
 * Step 1's bad news as one phrase, in the setup flow's own words — the first sentence of
 * core/readinessFix.ts's `gsMissingOffer` or `gsTooOldOffer`, without its full stop and without
 * the ` at <path>` the offer adds for a path set by hand — so the Output channel and the
 * notification agree wherever this file can tell the cases apart: the setting set (`prCascade.
 * gsPath is …`) or not (`not found in VS Code's PATH`); the offer's third sentence, for a
 * Homebrew git-spice the probe could not reach, needs the disk, which only the VS Code side
 * reads. test/unit/enrich.test.ts pins the agreement. Spelled here rather than imported:
 * readinessFix.ts imports `parseVersion` from this file at runtime, and an import the other way
 * would run in a circle.
 */
// see primer §59 (narrowing a tagged union with `===` on `kind`)
function notLocatedReason(answer: NotLocated, gsPath: string): string {
  if (answer.kind === 'gs-missing') {
    if (gsPath.trim() !== '') {
      return `prCascade.gsPath is ${gsPath}, which did not answer as git-spice`;
    }
    return `git-spice was not found in VS Code's PATH (tried ${answer.tried.join(', ')})`;
  }
  if (parseVersion(answer.found) === null) {
    return `git-spice reports version "${answer.found}", so whether it is at least ${answer.minimum} could not be checked`;
  }
  return `git-spice ${answer.found} is older than ${answer.minimum}, the oldest PR Cascade works with`;
}

/**
 * One phrase for a program that did not exit 0, for a reason or a problem sentence: git-spice's
 * fatal line — the first stderr line starting with `FTL ` (an auto-init failure prints two `INF`
 * lines before it; a plain `branch track` failure prints the `FTL` alone — verified 0.31.2).
 * Without one: `timed out after <ms> ms` for a run the timeout killed (the one every call here
 * asks for) — an `INF` line it printed before the kill is not the reason, the kill is; else the
 * first non-empty stderr line, trimmed; else `exited <code>`, `could not start (<why>)` (a
 * program that never started printed nothing), or Node's own `detail` (a signal, the output
 * ceiling). One line, not the whole text: the sentence goes in a notification.
 */
// see primer §22 (for ... of, and `continue`), §23 (`trim`, `startsWith`) and §30 (`??`)
function describeResult(result: CommandResult): string {
  let first: string | null = null;
  for (const raw of result.stderr.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    if (line.startsWith('FTL ')) {
      return line;
    }
    if (first === null) {
      first = line;
    }
  }
  if (result.timedOut) {
    return `timed out after ${PROBE_TIMEOUT_MS} ms`;
  }
  if (first !== null) {
    return first;
  }
  if (result.exitCode !== null) {
    return `exited ${result.exitCode}`;
  }
  if (result.startFailure !== null) {
    return `could not start (${result.startFailure})`;
  }
  return result.detail ?? 'no exit code';
}

/**
 * The `--base` for `layers[index]`: the layer below's name — tracked already, git-spice's trunk,
 * or tracked a moment ago by the loop in `track` — or, for the bottom layer, the trunk's *local*
 * branch: `--base` must name a tracked branch or the trunk's local name, and `origin/main` is
 * refused ("branch origin/main is not tracked", verified 0.31.2). When the caller's TrunkBranch
 * has no such branch, a problem sentence instead, mirroring the setup flow's init offer
 * (core/readinessFix.ts) for the same three states so one wording serves both: the git command
 * that would create the branch (quoted for a shell — the names are the user's), the setting to
 * change, or the setting to set. `none` is unreachable from the command — trunkBranchFor
 * answers it only for `trunk: null`, which has no layers — but TrunkBranch has four members
 * and each needs its sentence.
 */
// see primer §10 (a union of two object shapes as a return type) and §59 (narrowing `kind` with `===`)
function baseFor(layers: readonly StackLayer[], index: number, trunkBranch: TrunkBranch): { base: string } | { problem: string } {
  if (index > 0) {
    return { base: layers[index - 1].name };
  }
  const name = layers[index].name;
  if (trunkBranch.kind === 'local') {
    return { base: trunkBranch.branch };
  }
  if (trunkBranch.kind === 'missing') {
    const create = shellCommandLine(['git', 'branch', trunkBranch.branch, trunkBranch.trunk]);
    return { problem: `Tracking ${name} needs trunk ${trunkBranch.branch} as a local branch, and there is only ${trunkBranch.trunk}. Run ${create} first.` };
  }
  if (trunkBranch.kind === 'not-a-branch') {
    return { problem: `Tracking ${name} needs a trunk branch, and ${trunkBranch.trunk} does not name one — set prCascade.trunk to a branch first.` };
  }
  return { problem: `Tracking ${name} needs a trunk branch, and none was found — set prCascade.trunk first.` };
}
