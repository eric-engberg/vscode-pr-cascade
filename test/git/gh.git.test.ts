/**
 * test/git/gh.git.test.ts — the real GitHub CLI, run directly through the spawn production makes
 * (`runGh`) and through `ghReadiness`, read-only against an empty gh config, data and state
 * directory, so every machine — this logged-in Mac and a GitHub runner — is "not logged in, no
 * gh-stack": the test that makes a missing gh a failure on CI (`PRCASCADE_REQUIRE_GH=1`, ci.yml;
 * the runner images ship gh, so there is no install step); the banner's shape and the floor;
 * `stack --version` absent with its three-line hint; `extension list`'s exit 4 without a login and
 * no GH_HOST — and exit 0 with GH_HOST, an answer that depends on the environment (why the probe
 * asks `stack --version`); `auth status` exit 1 both ways for a host with no account — the generic
 * sentence a bare call gets, and under the probe's own GH_HOST the validation of an empty default
 * token that gh attempts over the network (the same exit, a different stderr, one network call per
 * probe), for github.com and a GHE host; the offline shape through a dead proxy with a bogus token
 * — the same exit 1 again, the ambiguity D65 reads by exit code; `auth login` refused while a token
 * variable for the host is set, and not refused by the other pair (why the login line unsets a
 * pair per host); and the three directories still empty afterwards (telemetry off). Every `auth
 * status` and `auth login` row goes through a dead proxy, so the file is deterministic and offline
 * on CI too.
 *
 * Layer: test, git integration (plan §9.1 layer 2; Vitest, a real gh, no VS Code, no network
 * reached). Depends on: src/core/ghstatus.ts, src/core/command.ts, src/core/forge.ts,
 * src/core/version.ts. Plan: §7.5, §7.13.1, §8 E22/E23/E24/E62b, §9.4, §9.5, §13.2 D65, §13.4 (the
 * gh 2.102.0 facts, 2026-10-14).
 */

// see primer §1 (import / export), §9 (`import type`) and §28 (`spawnSync`: setup code that
// blocks, and answers with a result object rather than throwing)
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RealCommandRunner } from '../../src/core/command';
import type { CommandResult } from '../../src/core/command';
import { ghEnv } from '../../src/core/forge';
import { GH_CANDIDATE, GH_ENV, GH_TIMEOUT_MS, ghReadiness, ghStackVersionToken, ghVersionToken, MINIMUM_GH_VERSION, runGh } from '../../src/core/ghstatus';
import { formatVersion, isAtLeast, parseVersion } from '../../src/core/version';

/**
 * gh, found once by its banner when this file loads — under production's own variables, so even
 * this spawn writes no telemetry id into the developer's real state directory; `null` is what
 * `describe.skipIf` reads. Only `gh` is tried: the setting is the user's, not the suite's.
 */
function locateGh(): string | null {
  const probe = spawnSync(GH_CANDIDATE, ['--version'], { encoding: 'utf8', env: { ...process.env, ...GH_ENV }, timeout: GH_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
  // see primer §30 (`??`) and §48 (the conditional expression)
  return probe.error === undefined ? ghVersionToken(probe.stdout ?? '') : null;
}

const GH_VERSION = locateGh();

/** CI's promise (ci.yml sets it): a missing gh is a failing test there and a skip everywhere else. */
const GH_REQUIRED = process.env.PRCASCADE_REQUIRE_GH === '1';

const commands = new RealCommandRunner();

/**
 * A proxy nothing listens on: port 9 (discard) on the loopback address refuses at once, on a Mac
 * and on both runner images, so every row that would reach a host fails there deterministically —
 * and the file never touches GitHub from CI, where an unauthenticated call could meet a shared-IP
 * rate limit and change a pinned text.
 */
// see primer §43 (`Record<string, string>`)
const DEAD_PROXY: Record<string, string> = { https_proxy: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' };

// A HOME of its own with the XDG directories under it (the real git-spice files do the same), the
// gh config directory named explicitly — a developer's exported GH_CONFIG_DIR would otherwise win
// over XDG_CONFIG_HOME — and the variables gh reads as a login, a host or a debug switch deleted,
// so no job token or shell export reaches a pin. gh creates none of the directories for a
// read-only command (measured); row l checks.
let homeDir: string;
let configDir: string;
let dataDir: string;
let stateDir: string;
/** The working directory of every spawn: no repository is needed — gh is never asked about one here. */
let root: string;

// see primer §5 (arrow functions), §6 (async / await) and §65 (`vi.stubEnv`; with `undefined` it deletes the variable)
beforeAll(async () => {
  homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-cascade-gh-'));
  configDir = path.join(homeDir, '.config', 'gh');
  dataDir = path.join(homeDir, '.local', 'share');
  stateDir = path.join(homeDir, '.local', 'state');
  root = path.join(homeDir, 'work');
  await fs.promises.mkdir(root);
  vi.stubEnv('HOME', homeDir);
  vi.stubEnv('XDG_CONFIG_HOME', path.join(homeDir, '.config'));
  vi.stubEnv('XDG_DATA_HOME', dataDir);
  vi.stubEnv('XDG_STATE_HOME', stateDir);
  vi.stubEnv('GH_CONFIG_DIR', configDir);
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_DEBUG']) {
    vi.stubEnv(name, undefined);
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.promises.rm(homeDir, { recursive: true, force: true });
});

/**
 * gh as a terminal would run it: production's hygiene variables, no GH_HOST, the proxy only when a
 * row asks for it. The counterpart of `asProbe`, because GH_HOST changes what gh answers (rows f/f2
 * and g/g2 pin both).
 */
// see primer §16 (object literals: spread) and §13 (default parameters)
function bare(args: string[], extraEnv: Record<string, string> = {}): Promise<CommandResult> {
  return commands.run({ executable: 'gh', args, cwd: root, env: { ...GH_ENV, ...extraEnv }, timeoutMs: GH_TIMEOUT_MS });
}

/**
 * gh as the probe runs it — `runGh`'s environment, `{ ...GH_ENV, ...ghEnv(host) }`, spelled out
 * here because the dead proxy has to join it and `runGh` takes no extra variables (rows b, d and e
 * go through `runGh` and `ghReadiness` themselves, so the shape is pinned both ways).
 */
function asProbe(args: string[], host: string, extraEnv: Record<string, string> = {}): Promise<CommandResult> {
  return commands.run({ executable: 'gh', args, cwd: root, env: { ...GH_ENV, ...ghEnv(host), ...DEAD_PROXY, ...extraEnv }, timeoutMs: GH_TIMEOUT_MS });
}

/** stderr as trimmed, non-empty lines in order. */
// see primer §25 (arrays: `split`, `map`, `filter`)
function stderrLines(result: CommandResult): string[] {
  return result.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

describe('gh on this machine', () => {
  // see primer §76 (it.runIf: a test that runs only when a load-time condition holds; `expect(value, message)`)
  it.runIf(GH_REQUIRED)('is installed — PRCASCADE_REQUIRE_GH=1 makes a missing gh a failure, not a skip', () => {
    expect(GH_VERSION, 'gh not found on PATH').not.toBeNull();
  });
});

// see primer §76 (describe.skipIf: a block decided when the file loads)
describe.skipIf(GH_VERSION === null)(`gh ${GH_VERSION ?? ''} run directly (hermetic; offline through a dead proxy; skipped when none is installed — README › Tests)`, () => {
  it('prints its two-line banner, and ghVersionToken reads the token off it', async () => {
    // act: through runGh — the spawn the probe makes
    const result = await runGh(commands, 'gh', ['--version'], root, 'github.com');

    // assert
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const lines = result.stdout.trim().split('\n');
    expect(lines.length).toBe(2);
    // see primer §20 (a capturing group; `\d{4}`: exactly four digits)
    const banner = /^gh version (\S+) \(\d{4}-\d{2}-\d{2}\)$/.exec(lines[0]);
    expect(banner, `not gh's banner: ${lines[0]}`).not.toBeNull();
    const token = banner === null ? '' : banner[1];
    expect(lines[1]).toBe(`https://github.com/cli/cli/releases/tag/v${token}`);
    expect(ghVersionToken(result.stdout)).toBe(token);
    expect(token).toBe(GH_VERSION);
  });

  it("is at least the extension's floor on this machine — a runner image that drifts below 2.90 fails here by name", () => {
    // act
    const version = parseVersion(GH_VERSION ?? '');

    // assert
    expect(version).not.toBeNull();
    expect(version !== null && isAtLeast(version, MINIMUM_GH_VERSION), `gh ${GH_VERSION} is below the floor ${formatVersion(MINIMUM_GH_VERSION)} — brew upgrade gh`).toBe(true);
  });

  it('answers `stack --version` with the install hint when the extension is absent — exit 1, stdout empty, three lines on stderr', async () => {
    // act: the empty data directory has no extensions
    const result = await runGh(commands, 'gh', ['stack', '--version'], root, 'github.com');

    // assert: gh knows the official extension names, so the hint names the install command itself
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('gh stack is available as an official extension.\nTo install it, run:\n  gh extension install github/gh-stack\n');
    expect(ghStackVersionToken(result.stdout)).toBeNull();
  });

  it("the probe's whole gh step on this machine: gh found, the extension missing, the login never asked", async () => {
    // act: the real runner; the member is the whole assertion
    const answer = await ghReadiness(commands, '', root, 'github.com');

    // assert: two spawns, no network — ghReadiness stops before `auth status` while anything is missing
    expect(answer).toStrictEqual({ kind: 'gh-missing', missing: ['gh-stack'], ghVersion: GH_VERSION, ghMinimum: '2.90.0', ghPath: 'gh' });
  });

  it('exits 4 from `extension list` with no login and no GH_HOST — why the probe asks `stack --version` instead', async () => {
    // act
    const result = await bare(['extension', 'list']);

    // assert: gh's "requires authentication" code, before it looks at the disk
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toMatch(/^To get started with GitHub CLI, please run:\s+gh auth login/m);
    expect(result.stderr).toMatch(/populate the GH_TOKEN environment variable/);
  });

  it('and 0 with GH_HOST set — an answer that depends on the environment, one more reason the probe asks `stack --version`', async () => {
    // act: GH_HOST counts as a configured host for gh's pre-command auth check (measured 2.102.0)
    const result = await asProbe(['extension', 'list'], 'github.com');

    // assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it("reports no login for github.com with exit 1 and gh's generic sentence — the local answer a bare call gets", async () => {
    // act: through the dead proxy, which proves it never went out
    const result = await bare(['auth', 'status', '--hostname', 'github.com'], DEAD_PROXY);

    // assert
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(stderrLines(result)[0]).toBe('You are not logged into any GitHub hosts. To log in, run: gh auth login');
  });

  it("and, under the probe's own GH_HOST, exit 1 after validating an empty default token over the network — the shape the probe actually meets, offline here", async () => {
    // act: GH_HOST puts the host on gh's list, gh finds an empty "default" token for it and goes
    // to the API to validate it (GH_DEBUG=api showed GET https://api.github.com/ → 401 online) —
    // one bounded network call per probe for a host with no account; the proxy refuses it here
    const result = await asProbe(['auth', 'status', '--hostname', 'github.com'], 'github.com');

    // assert: the same exit code as the row above, a different stderr — which is why the probe reads only the code
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^ {2}X Failed to log in to github\.com using token \(default\)$/m);
    expect(result.stderr).toMatch(/The token in default is invalid\.$/m);
  });

  it('reports the same two lines for a GHE host under its own GH_HOST — so the probe never reads them', async () => {
    // act
    const result = await asProbe(['auth', 'status', '--hostname', 'example.ghe.com'], 'example.ghe.com');

    // assert
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^ {2}X Failed to log in to example\.ghe\.com using token \(default\)$/m);
    expect(result.stderr).toMatch(/The token in default is invalid\.$/m);
  });

  it("exits 1 for a token it cannot validate too — offline, through a dead proxy with a bogus GH_TOKEN (D65's ambiguity as a fact)", async () => {
    // act
    const result = await asProbe(['auth', 'status', '--hostname', 'github.com'], 'github.com', { GH_TOKEN: 'x' });

    // assert: not logged in, revoked and offline are one exit code; only the text differs
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^ {2}X Failed to log in to github\.com using token \(GH_TOKEN\)$/m);
    expect(result.stderr).toMatch(/The token in GH_TOKEN is invalid\.$/m);
  });

  // The four variables gh reads as a login, each with a host of its class (`gh help environment`):
  // while one is set for the host, `auth login` is refused outright and nothing is written.
  // see primer §78 (it.each: a table of tests, the rows typed as tuples)
  const tokenRows: [string, string][] = [
    ['GH_TOKEN', 'github.com'],
    ['GITHUB_TOKEN', 'github.com'],
    ['GH_ENTERPRISE_TOKEN', 'ghes.corp.example'],
    ['GITHUB_ENTERPRISE_TOKEN', 'ghes.corp.example'],
  ];

  it.each(tokenRows)("refuses `auth login` while %s is set for its host's class, writing nothing", async (name, host) => {
    // arrange: the one variable, through an index signature (primer §43) — the name is the row's
    const extra: Record<string, string> = {};
    extra[name] = 'x';

    // act: the dead proxy is belt and braces — a gh that one day did not refuse would fail at
    // once instead of reaching the host
    const result = await asProbe(['auth', 'login', '--hostname', host, '--web', '--git-protocol', 'https'], host, extra);

    // assert
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`The value of the ${name} environment variable is being used for authentication.`);
    expect(result.stderr).toContain('first clear the value from the environment');
    expect(fs.existsSync(configDir)).toBe(false);
  });

  it('is not stopped by the github.com pair for an Enterprise Server host — gh goes to *that* host — why the login line picks the pair per host', async () => {
    // act: GH_TOKEN set, the host an Enterprise Server one
    const result = await asProbe(['auth', 'login', '--hostname', 'ghes.corp.example', '--web', '--git-protocol', 'https'], 'ghes.corp.example', { GH_TOKEN: 'x' });

    // assert: no refusal; gh asked that host for a device code, and the proxy refused the connection
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain('being used for authentication');
    expect(result.stderr).toMatch(/^failed to authenticate via web browser: Post "https:\/\/ghes\.corp\.example\/login\/device\/code"/m);
  });

  it('wrote nothing under the config, data or state directory — telemetry off, nothing stored', () => {
    // assert, after every row above: gh creates none of the three for a read-only command, and
    // GH_TELEMETRY=false is what keeps `state/gh/device-id` away (without it every call writes one)
    // see primer §25 (arrays: `every`) and §39 (`readdirSync`)
    const empty = [configDir, dataDir, stateDir].every((dir) => !fs.existsSync(dir) || fs.readdirSync(dir).length === 0);
    expect(empty).toBe(true);
  });
});
