/**
 * test/unit/uri.test.ts — encodeStackDiff and decodeStackDiff as a specification: the
 * three parts of a `stackdiff:` URI (plan §7.4), the exact round trip of every awkward
 * path git can print (E11), and what a decode refuses and how it says so.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on:
 * src/core/uri.ts. Plan: §10.1 M3 item 10, §7.4, §8 E11, §9.4 row `unit/uri.test.ts`.
 */

// see primer §1 (import / export) and §9 (interface: `import type`)
import { describe, expect, it } from 'vitest';
import { decodeStackDiff, encodeStackDiff, STACK_DIFF_SCHEME } from '../../src/core/uri';
import type { StackDiffLocation, UriComponents } from '../../src/core/uri';

// A repository and a commit, as the tree will hand them over: a LayerNode's `layer.sha`
// and `layer.parentSha` (src/vscode/tree.ts; PR 15 passes them through the FileNode that
// is clicked). Nothing here touches the disk.
// see primer §4 (const)
const ROOT = '/work/app';
const REF = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// see primer §5 (arrow functions)
describe('encodeStackDiff', () => {
  it('builds the three parts plan §7.4 lists: the stackdiff scheme, the path with a leading /, root and ref as JSON in the query', () => {
    // arrange
    const location: StackDiffLocation = { root: ROOT, ref: REF, relPath: 'src/ingress.ts' };

    // act
    const components = encodeStackDiff(location);

    // assert: the query is compared as text — what a URI will carry, byte for byte
    expect(components).toStrictEqual({
      scheme: 'stackdiff',
      path: '/src/ingress.ts',
      query: '{"root":"/work/app","ref":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}',
    });
  });

  it('puts exactly root and ref in the query and nothing else — the path carries the file', () => {
    // arrange
    const location: StackDiffLocation = { root: ROOT, ref: REF, relPath: 'a' };

    // act
    const components = encodeStackDiff(location);

    // assert: read the JSON back as a value, so key order and spacing cannot matter here
    // see primer §50 (JSON.parse)
    expect(JSON.parse(components.query)).toStrictEqual({ root: ROOT, ref: REF });
  });

  it('adds one / in front of the path and changes nothing else about it, however deep it is', () => {
    // arrange: a nested path, `/`-separated as git prints it
    const location: StackDiffLocation = { root: ROOT, ref: REF, relPath: 'src/vscode/tree.ts' };

    // act
    const components = encodeStackDiff(location);

    // assert
    expect(components.path).toBe('/src/vscode/tree.ts');
  });

  it('uses the exported scheme constant, the name PR 15 registers the content provider under', () => {
    // arrange
    const location: StackDiffLocation = { root: ROOT, ref: REF, relPath: 'a' };

    // act
    const components = encodeStackDiff(location);

    // assert
    expect(components.scheme).toBe(STACK_DIFF_SCHEME);
  });
});

describe('decodeStackDiff', () => {
  it('reads the location back out of the parts encodeStackDiff produced', () => {
    // arrange
    const components: UriComponents = {
      scheme: 'stackdiff',
      path: '/src/ingress.ts',
      query: '{"root":"/work/app","ref":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}',
    };

    // act
    const location = decodeStackDiff(components);

    // assert
    expect(location).toStrictEqual({ root: ROOT, ref: REF, relPath: 'src/ingress.ts' });
  });

  it('removes exactly the one leading / — a path that goes on with / keeps the rest', () => {
    // arrange: git never prints a path starting with `/`, but the rule is "one", not "all"
    const components: UriComponents = { scheme: 'stackdiff', path: '//odd', query: '{"root":"/r","ref":"abc"}' };

    // act
    const location = decodeStackDiff(components);

    // assert
    expect(location.relPath).toBe('/odd');
  });

  it('accepts a vscode.Uri-shaped object: extra fields such as authority and fragment are ignored (structural typing, primer §9)', () => {
    // arrange: the fields a real vscode.Uri has, as PR 15's content provider will pass it
    // — a value with *more* fields than UriComponents lists still satisfies the interface.
    // It is built in a `const` first on purpose: the same literal written inline as the
    // argument is refused ("Object literal may only specify known properties" — the
    // excess-property check, primer §9), because there the extra fields look like typos.
    const uriShaped = {
      scheme: 'stackdiff',
      authority: '',
      path: '/a',
      query: '{"root":"/work/app","ref":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}',
      fragment: '',
      fsPath: '/a',
    };

    // act
    const location = decodeStackDiff(uriShaped);

    // assert
    expect(location).toStrictEqual({ root: ROOT, ref: REF, relPath: 'a' });
  });

  describe('what it refuses — each error names the offending part', () => {
    it('rejects a foreign scheme (plan §9.4): a file: URI is not ours to decode', () => {
      // arrange: everything else is well-formed; only the scheme is wrong
      const components: UriComponents = { scheme: 'file', path: '/a', query: '{"root":"/r","ref":"abc"}' };

      // act
      const attempt = () => decodeStackDiff(components);

      // assert: `toThrow` with a string checks that the error's message contains it
      expect(attempt).toThrow('expected a "stackdiff" URI, got scheme "file"');
    });

    it('rejects a path without its leading /, naming the path', () => {
      // arrange
      const components: UriComponents = { scheme: 'stackdiff', path: 'src/a.ts', query: '{"root":"/r","ref":"abc"}' };

      // act
      const attempt = () => decodeStackDiff(components);

      // assert
      expect(attempt).toThrow('path must start with "/", got "src/a.ts"');
    });

    it('rejects a query that is not JSON, naming the text', () => {
      // arrange: the `root=…&ref=…` shape this scheme deliberately does not use
      const components: UriComponents = { scheme: 'stackdiff', path: '/a', query: 'root=/r&ref=abc' };

      // act
      const attempt = () => decodeStackDiff(components);

      // assert
      expect(attempt).toThrow('query must be JSON, got "root=/r&ref=abc"');
    });

    it('rejects a query that is JSON but not an object — JSON.parse of "null" is null, and of a number a number', () => {
      // arrange
      const nullQuery: UriComponents = { scheme: 'stackdiff', path: '/a', query: 'null' };
      const numberQuery: UriComponents = { scheme: 'stackdiff', path: '/a', query: '42' };

      // act
      const attemptNull = () => decodeStackDiff(nullQuery);
      const attemptNumber = () => decodeStackDiff(numberQuery);

      // assert
      expect(attemptNull).toThrow('query must be a JSON object, got null');
      expect(attemptNumber).toThrow('query must be a JSON object, got 42');
    });

    it('rejects a query without root, naming the field', () => {
      // arrange: a JSON object with only the ref
      const components: UriComponents = { scheme: 'stackdiff', path: '/a', query: '{"ref":"abc"}' };

      // act
      const attempt = () => decodeStackDiff(components);

      // assert
      expect(attempt).toThrow('query must carry a string "root", got {"ref":"abc"}');
    });

    it('rejects a ref that is not a string, naming the field', () => {
      // arrange: a number where the SHA should be
      const components: UriComponents = { scheme: 'stackdiff', path: '/a', query: '{"root":"/r","ref":7}' };

      // act
      const attempt = () => decodeStackDiff(components);

      // assert
      expect(attempt).toThrow('query must carry a string "ref"');
    });
  });
});

describe('round trip: decode(encode(location)) is the location, character for character (E11)', () => {
  // Every kind of path git can print and a URI would mangle without care. `-z` parsing
  // (core/changes.ts) delivers each of these exactly; this file must hand them on exactly.
  // The parts are decoded text (see encodeStackDiff's doc comment): percent-encoding is
  // vscode.Uri's job in PR 15, so `%` here must come back as `%`, not be read as an escape.
  const awkwardPaths = [
    'dir with space/file name.txt',
    'ünïcode/日本語.txt',
    'hash#and?question.txt',
    'percent%20not-an-escape.txt',
    'new\nline.txt',
    '-leading-dash.txt',
    'src/vscode/deep/nested/tree.ts',
  ];

  // One test per path, so a failure names the path that broke.
  // see primer §22 (for ... of)
  for (const relPath of awkwardPaths) {
    it(`brings back ${JSON.stringify(relPath)}`, () => {
      // arrange
      const location: StackDiffLocation = { root: ROOT, ref: REF, relPath };

      // act
      const roundTripped = decodeStackDiff(encodeStackDiff(location));

      // assert
      expect(roundTripped).toStrictEqual(location);
    });
  }

  it('brings back a root with spaces, quotes and unicode — JSON quotes it, JSON unquotes it', () => {
    // arrange: a repository the user put somewhere awkward; a `"` in a path is legal on
    // macOS and Linux and is the one character JSON itself has to escape
    const location: StackDiffLocation = { root: '/Users/ric/my "repos"/ünïcode app', ref: REF, relPath: 'a' };

    // act
    const roundTripped = decodeStackDiff(encodeStackDiff(location));

    // assert
    expect(roundTripped).toStrictEqual(location);
  });

  it('brings back the ref untouched', () => {
    // arrange: a full 40-character SHA, as the tree hands them over
    const location: StackDiffLocation = { root: ROOT, ref: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', relPath: 'a' };

    // act
    const roundTripped = decodeStackDiff(encodeStackDiff(location));

    // assert
    expect(roundTripped.ref).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678');
  });
});
