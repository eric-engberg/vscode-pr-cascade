/**
 * test/unit/gsLog.test.ts — parseGsLog as a specification: the lines git-spice 0.31.2 really
 * prints (a tracked branch with a PR, the trunk, the current branch), the documented fields
 * kept and the ones dropped, and every way a line can be malformed — reported once, with its
 * line number, while the lines around it still parse (E57).
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no git-spice, no VS Code). Depends on:
 * src/core/gsLog.ts. Plan: §10.1 item 17, §7.13.2, §8 E57, §9.4 `unit/gsLog`, §13.2 D55.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { describe, expect, it } from 'vitest';
import { parseGsLog } from '../../src/core/gsLog';
import type { GsLogEntry } from '../../src/core/gsLog';

// Three lines copied from `git-spice log short --json` in this repository on 2026-10-01 (git-spice
// 0.31.2), before #30 was submitted: a tracked branch with an open PR, the trunk's own line, and the
// branch that was current then — a current branch's line changes with every submit, so re-running
// the command today prints different text for it.
// see primer §4 (const)
const TRACKED_WITH_PR =
  '{"name":"m4/12a-vscode-git-api","down":{"name":"main"},"ups":[{"name":"m4/12b-status-refresh"}],"change":{"id":"#23","url":"https://github.com/eric-engberg/vscode-pr-cascade/pull/23"},"push":{"ahead":0,"behind":0}}';
const TRUNK = '{"name":"main","ups":[{"name":"m4/12a-vscode-git-api"}]}';
const CURRENT = '{"name":"m5/16-core-forge","current":true,"down":{"name":"m4/15-v0.1.0"}}';

// see primer §5 (arrow functions)
describe('parseGsLog', () => {
  describe('well-formed output', () => {
    it('returns no entries and no problems for empty output', () => {
      // act
      const parsed = parseGsLog('');

      // assert
      expect(parsed).toStrictEqual({ entries: [], malformed: [] });
    });

    it('skips blank lines without reporting them', () => {
      // act: a trailing newline, an empty line, a line of spaces
      const parsed = parseGsLog('\n\n  \n');

      // assert
      expect(parsed).toStrictEqual({ entries: [], malformed: [] });
    });

    it('parses the 0.31.2 line for a tracked branch with a PR, filling in the two absent booleans', () => {
      // act
      const parsed = parseGsLog(TRACKED_WITH_PR);

      // assert: `ups` is dropped; `needsRestack` and `needsPush`, absent in the JSON, are false
      const expected: GsLogEntry = {
        name: 'm4/12a-vscode-git-api',
        down: { name: 'main', needsRestack: false },
        change: { id: '#23', url: 'https://github.com/eric-engberg/vscode-pr-cascade/pull/23' },
        push: { ahead: 0, behind: 0, needsPush: false },
      };
      expect(parsed).toStrictEqual({ entries: [expected], malformed: [] });
    });

    it('parses the trunk\'s own line, which has ups and no down, as an entry with only a name', () => {
      // act
      const parsed = parseGsLog(TRUNK);

      // assert: no `down` key at all — not `down: undefined`
      expect(parsed.entries).toStrictEqual([{ name: 'main' }]);
    });

    it('parses the current branch\'s line, dropping `current`', () => {
      // act
      const parsed = parseGsLog(CURRENT);

      // assert
      expect(parsed.entries).toStrictEqual([{ name: 'm5/16-core-forge', down: { name: 'm4/15-v0.1.0', needsRestack: false } }]);
    });

    it('parses a minimal object', () => {
      // act
      const parsed = parseGsLog('{"name":"x"}');

      // assert
      expect(parsed.entries).toStrictEqual([{ name: 'x' }]);
    });

    it('reads needsRestack and needsPush when they are present and true', () => {
      // act
      const parsed = parseGsLog('{"name":"x","down":{"name":"main","needsRestack":true},"push":{"ahead":2,"behind":1,"needsPush":true}}');

      // assert
      expect(parsed.entries).toStrictEqual([
        { name: 'x', down: { name: 'main', needsRestack: true }, push: { ahead: 2, behind: 1, needsPush: true } },
      ]);
    });

    it('keeps change.status as text when --cr-status adds it, and drops comments', () => {
      // act
      const parsed = parseGsLog(
        '{"name":"x","change":{"id":"#1","url":"u","status":"open","comments":{"resolved":1,"unresolved":0,"total":1}}}',
      );

      // assert
      expect(parsed.entries).toStrictEqual([{ name: 'x', change: { id: '#1', url: 'u', status: 'open' } }]);
    });

    it('keeps a status outside open/closed/merged as the text it is, rather than refusing the line', () => {
      // act: a value a later git-spice might add
      const parsed = parseGsLog('{"name":"x","change":{"id":"#1","url":"u","status":"draft"}}');

      // assert
      expect(parsed).toStrictEqual({ entries: [{ name: 'x', change: { id: '#1', url: 'u', status: 'draft' } }], malformed: [] });
    });

    it('keeps a GitLab change id as text — `!123`, not validated', () => {
      // act
      const parsed = parseGsLog('{"name":"x","change":{"id":"!123","url":"u"}}');

      // assert
      expect(parsed.entries).toStrictEqual([{ name: 'x', change: { id: '!123', url: 'u' } }]);
    });

    it('ignores unknown fields at the top level and inside change and push (E57)', () => {
      // act
      const parsed = parseGsLog(
        '{"name":"x","future":1,"change":{"id":"#1","url":"u","extra":[]},"push":{"ahead":0,"behind":0,"extra":true}}',
      );

      // assert: the known fields only
      expect(parsed.entries).toStrictEqual([
        { name: 'x', change: { id: '#1', url: 'u' }, push: { ahead: 0, behind: 0, needsPush: false } },
      ]);
    });

    it('drops the documented fields nothing reads yet — current, worktree, ups, commits (D55)', () => {
      // act
      const parsed = parseGsLog(
        '{"name":"x","current":true,"worktree":"/w","ups":[{"name":"y"}],"commits":[{"sha":"abc","subject":"s"}]}',
      );

      // assert
      expect(parsed.entries).toStrictEqual([{ name: 'x' }]);
    });

    it('keeps the entries in output order and does not deduplicate', () => {
      // act
      const parsed = parseGsLog('{"name":"b"}\n{"name":"a"}\n{"name":"b"}');

      // assert
      // see primer §25 (arrays: map)
      expect(parsed.entries.map((entry) => entry.name)).toEqual(['b', 'a', 'b']);
    });

    it('parses CRLF line endings like LF', () => {
      // act: the blank line is `\r` alone once split on `\n`; only stripping the CR makes it blank —
      // kept, it would be `not JSON`
      const parsed = parseGsLog('{"name":"a"}\r\n\r\n{"name":"b"}\r\n');

      // assert
      expect(parsed).toStrictEqual({ entries: [{ name: 'a' }, { name: 'b' }], malformed: [] });
    });
  });

  describe('malformed lines (E57)', () => {
    it('reports a line that is not JSON once, with its line number, and parses the lines around it', () => {
      // act
      const parsed = parseGsLog('{"name":"a"}\nnot json\n{"name":"c"}');

      // assert
      expect(parsed.entries.map((entry) => entry.name)).toEqual(['a', 'c']);
      expect(parsed.malformed).toStrictEqual([{ line: 2, problem: 'not JSON' }]);
    });

    it('reports a stderr-looking line the same way — callers must pass stdout only', () => {
      // act: what git-spice writes to stderr while initialising; it never appears on stdout
      const parsed = parseGsLog('INF Repository not initialized. Initializing.\n{"name":"main"}');

      // assert
      expect(parsed.entries).toStrictEqual([{ name: 'main' }]);
      expect(parsed.malformed).toStrictEqual([{ line: 1, problem: 'not JSON' }]);
    });

    it('reports a JSON value that is not an object — a number, an array, null, a string', () => {
      // act
      const parsed = parseGsLog('42\n[]\nnull\n"x"');

      // assert: four problems, lines 1–4, the same words for each
      expect(parsed.entries).toStrictEqual([]);
      expect(parsed.malformed).toStrictEqual([
        { line: 1, problem: 'not a JSON object' },
        { line: 2, problem: 'not a JSON object' },
        { line: 3, problem: 'not a JSON object' },
        { line: 4, problem: 'not a JSON object' },
      ]);
    });

    it('reports an object without a string name', () => {
      // act
      const missing = parseGsLog('{"down":{"name":"main"}}');
      const wrongType = parseGsLog('{"name":1}');

      // assert
      expect(missing.malformed).toStrictEqual([{ line: 1, problem: 'name is not a string' }]);
      expect(wrongType.malformed).toStrictEqual([{ line: 1, problem: 'name is not a string' }]);
    });

    it('reports a down that is not an object — a string, null, an array', () => {
      // act
      const text = parseGsLog('{"name":"x","down":"main"}');
      const nothing = parseGsLog('{"name":"x","down":null}');
      const list = parseGsLog('{"name":"x","down":[]}');

      // assert
      expect(text.malformed).toStrictEqual([{ line: 1, problem: 'down is not an object' }]);
      expect(nothing.malformed).toStrictEqual([{ line: 1, problem: 'down is not an object' }]);
      expect(list.malformed).toStrictEqual([{ line: 1, problem: 'down is not an object' }]);
    });

    it('reports a down without a string name', () => {
      // act
      const parsed = parseGsLog('{"name":"x","down":{}}');

      // assert
      expect(parsed.malformed).toStrictEqual([{ line: 1, problem: 'down.name is not a string' }]);
    });

    it('reports a needsRestack that is not a boolean', () => {
      // act
      const parsed = parseGsLog('{"name":"x","down":{"name":"main","needsRestack":"yes"}}');

      // assert
      expect(parsed.malformed).toStrictEqual([{ line: 1, problem: 'down.needsRestack is not a boolean' }]);
    });

    it('reports a change that is not an object — a string, null, an array — or one without a string id or url', () => {
      // act
      const notObject = parseGsLog('{"name":"x","change":"#1"}');
      const nothing = parseGsLog('{"name":"x","change":null}');
      const list = parseGsLog('{"name":"x","change":[]}');
      const noId = parseGsLog('{"name":"x","change":{"url":"u"}}');
      const noUrl = parseGsLog('{"name":"x","change":{"id":"#1"}}');

      // assert
      expect(notObject.malformed).toStrictEqual([{ line: 1, problem: 'change is not an object' }]);
      expect(nothing.malformed).toStrictEqual([{ line: 1, problem: 'change is not an object' }]);
      expect(list.malformed).toStrictEqual([{ line: 1, problem: 'change is not an object' }]);
      expect(noId.malformed).toStrictEqual([{ line: 1, problem: 'change.id is not a string' }]);
      expect(noUrl.malformed).toStrictEqual([{ line: 1, problem: 'change.url is not a string' }]);
    });

    it('reports a status that is present but not a string', () => {
      // act
      const parsed = parseGsLog('{"name":"x","change":{"id":"#1","url":"u","status":1}}');

      // assert
      expect(parsed.malformed).toStrictEqual([{ line: 1, problem: 'change.status is not a string' }]);
    });

    it('reports a push that is not an object — an array, null, a string', () => {
      // act
      const list = parseGsLog('{"name":"x","push":[]}');
      const nothing = parseGsLog('{"name":"x","push":null}');
      const text = parseGsLog('{"name":"x","push":"x"}');

      // assert
      expect(list.malformed).toStrictEqual([{ line: 1, problem: 'push is not an object' }]);
      expect(nothing.malformed).toStrictEqual([{ line: 1, problem: 'push is not an object' }]);
      expect(text.malformed).toStrictEqual([{ line: 1, problem: 'push is not an object' }]);
    });

    it('reports push counts that are not numbers', () => {
      // act
      const aheadText = parseGsLog('{"name":"x","push":{"ahead":"1","behind":0}}');
      const behindMissing = parseGsLog('{"name":"x","push":{"ahead":1}}');

      // assert
      expect(aheadText.malformed).toStrictEqual([{ line: 1, problem: 'push.ahead is not a number' }]);
      expect(behindMissing.malformed).toStrictEqual([{ line: 1, problem: 'push.behind is not a number' }]);
    });

    it('reports a needsPush that is not a boolean', () => {
      // act
      const parsed = parseGsLog('{"name":"x","push":{"ahead":1,"behind":0,"needsPush":"yes"}}');

      // assert
      expect(parsed.malformed).toStrictEqual([{ line: 1, problem: 'push.needsPush is not a boolean' }]);
    });

    it('treats a bad line as one problem, however much is wrong with it', () => {
      // act: a bad name and a bad push on the same line
      const parsed = parseGsLog('{"name":1,"push":"no"}');

      // assert: the first failing check only
      expect(parsed.malformed).toStrictEqual([{ line: 1, problem: 'name is not a string' }]);
    });

    it('does not keep any part of a malformed line as an entry', () => {
      // act: the name is fine, the push is not
      const parsed = parseGsLog('{"name":"x","push":{"ahead":"1","behind":0}}');

      // assert
      expect(parsed.entries).toStrictEqual([]);
    });

    it('numbers lines from 1 and counts blank lines towards the number', () => {
      // act
      const parsed = parseGsLog('{"name":"a"}\n\nbad\n');

      // assert
      expect(parsed.malformed).toStrictEqual([{ line: 3, problem: 'not JSON' }]);
    });

    it('treats characters trim() leaves, such as NUL, as not JSON rather than as blank', () => {
      // act: two NUL characters — trim() leaves them, JSON.parse refuses them
      // see primer §44 (escape sequences: `\0`)
      const parsed = parseGsLog('\0\0');

      // assert
      expect(parsed.entries).toStrictEqual([]);
      expect(parsed.malformed).toStrictEqual([{ line: 1, problem: 'not JSON' }]);
    });
  });
});
