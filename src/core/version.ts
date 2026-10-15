/**
 * core/version.ts — a version as three numbers, read off a program's banner and compared against
 * a floor: git-spice's 0.31.0 (core/backends/gitspice.ts) and gh's 2.90.0 (core/ghstatus.ts).
 * Hand-rolled (D56: `semver` measured 27 KB for one three-number compare); a suffix is ignored
 * because every floor here is a floor on features. Moved out of the git-spice backend in item 23a
 * so the gh reader can compare without importing the backend that imports it (D65).
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: nothing. Depended on by:
 * core/backends/gitspice.ts, core/ghstatus.ts, core/readinessFix.ts, test/unit/version.test.ts,
 * test/git/gh.git.test.ts (the floor met on the machine).
 * Plan: §4.2, §7.13.1, §11.3 (the `semver` row), §13.2 D56/D65.
 */

/** A version as the three numbers the probe compares. */
// see primer §9 (interface) and §14 (readonly)
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

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
