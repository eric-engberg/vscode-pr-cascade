/**
 * core/uri.ts — names "this file, at this commit, in this repository" as the parts of a
 * `stackdiff:` URI, and reads such a URI back. Each side of a diff the extension opens
 * (M3) is one of these URIs; VS Code asks the content provider to fill it in.
 *
 * Layer: core (no VS Code imports; plan §4.1) — so it works on the three *parts* of a
 * URI, not on a vscode.Uri; src/vscode builds the Uri from them. Depends on: nothing.
 * Depended on by (all PR 15): src/vscode/commands.ts (encodes both sides of a diff),
 * src/vscode/content.ts (decodes the URI VS Code hands it) and src/extension.ts (the
 * scheme name, when it registers the content provider). Plan: §7.4, §3 "Diff rendering",
 * §8 E11, §10.1 M3 item 10.
 */

/**
 * The URI scheme the extension owns. VS Code routes every `stackdiff:` URI to the content
 * provider PR 15 registers under this name (plan §3 "Diff rendering": our own scheme,
 * backed by `git show`, so diffs work even with the built-in git extension disabled).
 */
// see primer §4 (const) and §1 (export) — §36 is the same shape with an object
export const STACK_DIFF_SCHEME = 'stackdiff';

/**
 * What one side of a diff is: a file, at a commit, in a repository. `relPath` is the
 * path as git spells it — relative to `root`, `/`-separated on every platform, no
 * leading slash — so `git show <ref>:<relPath>` (PR 15) can be built from it directly.
 * `ref` is a commit SHA, never a branch name: the tree hands over `layer.parentSha` and
 * `layer.sha`, the same pair core/changes.ts diffs, so the diff editor shows exactly the
 * two snapshots the row was computed from. A branch name would name whatever the branch
 * points at *when VS Code asks* — a commit made in a terminal after the editor was opened
 * would silently change what the editor shows — and VS Code keeps a document's content by
 * its URI, so a URI must name content that cannot change. A SHA does.
 */
// see primer §9 (interface)
export interface StackDiffLocation {
  root: string;
  ref: string;
  relPath: string;
}

/**
 * The three parts of a URI this scheme uses, with the names a vscode.Uri gives them, so
 * the vscode side can pass a vscode.Uri straight to decodeStackDiff — an interface accepts
 * anything with at least these fields (primer §9), and the Uri's other ones (`authority`,
 * `fragment`, `fsPath`) are simply not looked at. Written out here rather than imported
 * from `vscode` because this file must stay runnable under plain Node (plan §4.1).
 */
// see primer §9 (structural typing: a value with these fields and more still fits)
export interface UriComponents {
  scheme: string;
  path: string;
  query: string;
}

/**
 * What the query part carries: the two fields of a location the path cannot. The path is
 * the file; the repository and the commit go here, as JSON. Spelled as "these fields of
 * StackDiffLocation" so what encodeStackDiff writes is, by construction, two fields of a
 * location. decodeStackDiff checks for the same two names by hand, field by field: a
 * parsed JSON value has no type to check against (primer §51), so the type cannot do
 * that side for it.
 */
// see primer §49 (Pick: some of another type's fields)
type StackDiffQuery = Pick<StackDiffLocation, 'root' | 'ref'>;

/**
 * Turns a location into the parts of a `stackdiff:` URI (plan §7.4):
 *
 *     scheme  stackdiff
 *     path    "/" + relPath          e.g. /src/ingress.ts
 *     query   {"root":"…","ref":"…"} as JSON
 *
 * The leading `/`: VS Code takes a document's language — and so its syntax colouring —
 * from the extension at the end of the URI's path, and shows the path in the tab and the
 * breadcrumbs; a path shaped like an absolute one reads as a file there. The built-in git
 * extension's own `git:` URIs are built the same way (path in the path, `{ path, ref }`
 * as JSON in the query), which is where this layout comes from.
 *
 * JSON in the query rather than `root=…&ref=…`: a repository root is a path the user
 * chose, and can hold spaces, `&`, `=`, `%`, any unicode; JSON already has an exact
 * encoding for any string, and both sides of the URI — this code and the content provider
 * — already have `JSON.stringify` and `JSON.parse` (Node's). Nothing in the codebase has
 * to invent a quoting rule (E11).
 *
 * These parts are *decoded* text: the `#`, `?`, spaces and unicode in a path go into
 * `path` as they are. Percent-encoding is the URI's job, not this function's:
 * `vscode.Uri.from(parts)` (PR 15) encodes them when the URI is turned into a string, and
 * `vscode.Uri.parse` decodes them again into `.path` and `.query`. That is why the
 * round-trip test here is exact by construction, and why the real E11 proof is PR 15's
 * extension-host test, which pushes an awkward path through a real vscode.Uri.
 */
// see primer §50 (JSON.stringify and JSON.parse) and §16 (object literals)
export function encodeStackDiff(location: StackDiffLocation): UriComponents {
  const queryFields: StackDiffQuery = { root: location.root, ref: location.ref };
  return {
    scheme: STACK_DIFF_SCHEME,
    path: '/' + location.relPath,
    query: JSON.stringify(queryFields),
  };
}

/**
 * Reads a location back out of the parts of a `stackdiff:` URI — the reverse of
 * encodeStackDiff. Anything that is not what encodeStackDiff produces is an error naming
 * the offending part, never a guess: a foreign scheme (`file:`, plan §9.4 — VS Code only
 * routes our scheme here, so one means a bug on the vscode side), a path without its
 * leading `/`, a query that is not JSON or not an object, or a `root` or `ref` that is
 * missing or not a string. The content provider (PR 15) lets the error through, and VS
 * Code shows the message in place of the document — better than `git show` being asked
 * for a path that was never a path.
 *
 * `JSON.parse` hands back a value the compiler knows nothing about, so the query is
 * checked step by step — an object, then each field a string — before either field is
 * read (primer §50, §51). The one leading `/` is removed; the rest of the path is the
 * relPath exactly, including any further `/` git printed.
 */
// see primer §23 (startsWith, slice), §24 (the prefix `!`, "not"), §12 (template strings),
// §17 (typeof) and §51 (`in`)
export function decodeStackDiff(components: UriComponents): StackDiffLocation {
  if (components.scheme !== STACK_DIFF_SCHEME) {
    throw new Error(`expected a "${STACK_DIFF_SCHEME}" URI, got scheme "${components.scheme}"`);
  }
  if (!components.path.startsWith('/')) {
    throw new Error(`a ${STACK_DIFF_SCHEME} URI's path must start with "/", got "${components.path}"`);
  }
  const relPath = components.path.slice(1);

  const parsed = parseJsonQuery(components.query);
  // `typeof null` is `'object'` — a JavaScript quirk older than the language's name — so
  // JSON's `null` has to be turned away separately; after both checks the compiler knows
  // `parsed` is an object, though not yet what is in it.
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`a ${STACK_DIFF_SCHEME} URI's query must be a JSON object, got ${components.query}`);
  }
  // `'root' in parsed` is "does the object have a field called root"; only once that and
  // the `typeof` hold does the compiler let `parsed.root` be read as a string.
  if (!('root' in parsed) || typeof parsed.root !== 'string') {
    throw new Error(`a ${STACK_DIFF_SCHEME} URI's query must carry a string "root", got ${components.query}`);
  }
  if (!('ref' in parsed) || typeof parsed.ref !== 'string') {
    throw new Error(`a ${STACK_DIFF_SCHEME} URI's query must carry a string "ref", got ${components.query}`);
  }
  return { root: parsed.root, ref: parsed.ref, relPath };
}

/**
 * The query text as a JSON value, or an error naming the text when it is not JSON at all
 * (`JSON.parse` throws a SyntaxError of its own, whose message says where in the text it
 * gave up but not what the text was for). The return type is `unknown` on purpose:
 * `JSON.parse` claims `any`, and handing that on as it is would let decodeStackDiff read
 * `.root` off a number without a word from the compiler; `unknown` at this function's
 * boundary makes the checks above compulsory (primer §50 — the same repair §41 made to a
 * list).
 */
// see primer §18 (try / catch) and §50 (JSON.parse returns any; declaring it unknown)
function parseJsonQuery(query: string): unknown {
  try {
    return JSON.parse(query);
  } catch {
    throw new Error(`a ${STACK_DIFF_SCHEME} URI's query must be JSON, got "${query}"`);
  }
}
