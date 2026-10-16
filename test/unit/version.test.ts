/**
 * test/unit/version.test.ts — the version helpers as a specification: the texts `parseVersion`
 * reads and refuses, `isAtLeast` as numbers not text — against both floors, git-spice's 0.31.0
 * and gh's 2.90.0 — and `formatVersion`. Moved from test/unit/readiness.test.ts in item 23a with
 * core/version.ts; the banner readers stay with their backends (`gitSpiceVersion` in
 * unit/readiness, `ghVersionToken` in unit/ghstatus).
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no git-spice, no gh, no VS Code). Depends
 * on: src/core/version.ts, src/core/backends/gitspice.ts (`MINIMUM_GS_VERSION`). Depended on by:
 * nothing. Plan: §7.13.1, §9.4 `unit/version`, §11.3, §13.2 D56/D65.
 */

// see primer §1 (import / export)
import { describe, expect, it } from 'vitest';
import { MINIMUM_GS_VERSION } from '../../src/core/backends/gitspice';
import { formatVersion, isAtLeast, parseVersion } from '../../src/core/version';

// see primer §5 (arrow functions)
describe('the version helpers', () => {
  // Text → the three numbers, or null. One test per row, so a failure names the text.
  // see primer §10 (union types: `Version | null` as a row's expectation)
  const parsed: { text: string; expected: { major: number; minor: number; patch: number } | null }[] = [
    { text: '0.31.2', expected: { major: 0, minor: 31, patch: 2 } },
    { text: 'v1.2.3-rc1', expected: { major: 1, minor: 2, patch: 3 } },
    { text: '0.32.0-dev (abc1234 2026-07-21)', expected: { major: 0, minor: 32, patch: 0 } },
    { text: '0.31', expected: null },
    { text: 'dev', expected: null },
    { text: '', expected: null },
    { text: 'GPL Ghostscript 10.08.0', expected: null },
  ];

  for (const row of parsed) {
    it(`parseVersion reads ${JSON.stringify(row.text)} as ${row.expected === null ? 'no version' : 'three numbers, ignoring what follows'}`, () => {
      // act
      const version = parseVersion(row.text);

      // assert
      expect(version).toStrictEqual(row.expected);
    });
  }

  const compared: { major: number; minor: number; patch: number; atLeast: boolean }[] = [
    { major: 0, minor: 31, patch: 0, atLeast: true },
    { major: 0, minor: 31, patch: 1, atLeast: true },
    { major: 1, minor: 0, patch: 0, atLeast: true },
    { major: 0, minor: 30, patch: 99, atLeast: false },
    { major: 0, minor: 9, patch: 99, atLeast: false },
  ];

  for (const row of compared) {
    it(`isAtLeast puts ${row.major}.${row.minor}.${row.patch} ${row.atLeast ? 'at or above' : 'below'} the 0.31.0 floor — numbers, not text`, () => {
      // act
      const result = isAtLeast({ major: row.major, minor: row.minor, patch: row.patch }, MINIMUM_GS_VERSION);

      // assert
      expect(result).toBe(row.atLeast);
    });
  }

  // gh's floor (item 23a): a minor of three digits against one of two — numbers again, where text
  // would put `2.102.0` before `2.90.0`.
  it('isAtLeast puts 2.102.0 at or above the 2.90.0 floor — gh\'s, where text would sort it below', () => {
    // act
    const result = isAtLeast({ major: 2, minor: 102, patch: 0 }, { major: 2, minor: 90, patch: 0 });

    // assert
    expect(result).toBe(true);
  });

  it('isAtLeast puts 2.89.9 below the 2.90.0 floor', () => {
    // act
    const result = isAtLeast({ major: 2, minor: 89, patch: 9 }, { major: 2, minor: 90, patch: 0 });

    // assert
    expect(result).toBe(false);
  });

  it('formatVersion writes the floor the way a message quotes it', () => {
    // act
    const text = formatVersion(MINIMUM_GS_VERSION);

    // assert
    expect(text).toBe('0.31.0');
  });
});
