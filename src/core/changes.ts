/**
 * core/changes.ts — lists the files one layer changes against the layer below it, by
 * asking git for a tree diff and reading its NUL-separated answer.
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/model.ts (GitRunner,
 * ChangedFile, FileStatus). Depended on by: src/extension.ts (PR 11), which wraps
 * changedFiles in the loadFiles function the tree (src/vscode/tree.ts) calls once per
 * expanded layer to render one row per ChangedFile; PR 10 adds binary detection here.
 * Plan: §4.2, §4.3 (ChangedFile), §5 row "Files in a layer", §8 E7/E8/E9/E11, §10.1 M2
 * item 7.
 */

// see primer §1 (import / export) and §9 (interface: `import type`)
import type { ChangedFile, FileStatus, GitRunner } from './model';

/**
 * The separator `git diff -z` puts after every field: the NUL byte, written `\0` in a
 * string literal (primer §44). It is the one byte a path can never contain — to the
 * operating system a file name is a C string, and NUL is what ends a C string — which
 * is exactly why git offers it as a separator.
 */
// see primer §4 (const) and §44 (escape sequences in string literals: `\0`)
const FIELD_SEPARATOR = '\0';

/**
 * Turns the output of `git diff --name-status -M -z <parent> <layer>` into one
 * ChangedFile per entry, in git's order (by path). A pure function — text in, list out —
 * so it is unit-tested on canned strings with no repository (plan §9.1 layer 1).
 *
 * The format, as git 2.50 prints it (verified on a real repository; the unit tests
 * quote that output byte for byte). Every field ends in a NUL, and there are no
 * newlines between fields anywhere:
 *
 *     A\0added.txt\0M\0modified.txt\0D\0deleted.txt\0T\0typechange.txt\0
 *     R052\0renamed-old.txt\0renamed-new.txt\0
 *
 * - A plain entry is two fields: the status letter, then the path. A (added), M
 *   (modified), D (deleted), T (type changed: a file became a symlink, or the reverse).
 * - A rename or copy is three fields: the letter with a similarity score glued on —
 *   `R052` is "renamed, 52 % of the content unchanged", `C` the same for a copy — then
 *   the old path, then the new one. The score is dropped: it only says how sure git was
 *   about the pairing, and the tree shows the pair, not the number. The letter is
 *   always the first character, so one rule reads every entry. git prints `C` only
 *   when asked to look for copies with `-C`, which changedFiles does not pass (plan §5's
 *   command has `-M` alone), so on this command's output a copied file is a plain `A`
 *   and the letter never appears; it is accepted because the entry has the rename's
 *   shape, not because the tree expects to show one.
 * - The last field ends in a NUL like every other, so the output as a whole ends in
 *   one. Nothing changed at all is an empty string (zero bytes), not a lone NUL.
 *
 * Why the paths are taken byte for byte, and why nothing here splits on `\n`: a path
 * may contain spaces, `#`, `?`, any unicode, tabs — and newlines. Without `-z` git
 * separates fields with tabs and entries with newlines, so it has to *quote* any path
 * that would break that: the probe that verified this format got `"new\nline.txt"`
 * and `"\303\274n\303\257code/f\303\257le.txt"` back — a C-style escape for the newline
 * and octal escapes for the bytes of `ünïcode` — text that would have to be unquoted
 * before `git show` could be handed the path (E11). With `-z` there is no quoting,
 * ever: what git prints between two NULs is the path. (Byte for byte as far as the
 * runner's decoding allows: core/git.ts hands git's output over as text decoded as
 * UTF-8, so a path whose bytes are not valid UTF-8 — rare; an old repository with
 * Latin-1 file names — arrives with replacement characters in it. That is a limit of
 * the runner returning text, not of this parser.)
 *
 * An entry whose status letter is not one of the six in FileStatus is an error naming
 * the letter, never a guess. `U` (unmerged) cannot appear in a diff between two
 * commits, and `X` is git's own "this should not happen"; either would mean the command
 * or the rules above are wrong, and the tree should say so rather than show a row that
 * may be wrong. `binary` is `false` on every entry: name-status has no binary flag, and
 * PR 10 adds the second command (`--numstat`) that does.
 */
// see primer §25 (arrays: split on a separator, pop), §38 (a while loop that walks a
// list by an index it advances itself), §16 (object literals) and §11 (optional `?`
// fields: `oldPath` is set on renames and copies only)
export function parseNameStatus(output: string): ChangedFile[] {
  // Cut the output at every NUL. The NUL after the last field leaves one empty piece at
  // the end — and empty output is one empty piece in total — so dropping it leaves
  // exactly the fields, or nothing.
  const fields = output.split(FIELD_SEPARATOR);
  if (fields[fields.length - 1] === '') {
    fields.pop();
  }

  const files: ChangedFile[] = [];
  // An entry is two fields or three, so the loop steps by two or three: `index` always
  // sits on a status field when the body starts.
  let index = 0;
  while (index < fields.length) {
    const status = toFileStatus(fields[index]);
    if (status === 'R' || status === 'C') {
      // Three fields: the path at the parent, then the path at the layer.
      const oldPath = requireField(fields, index + 1, 'old path');
      const newPath = requireField(fields, index + 2, 'new path');
      files.push({ status, path: newPath, oldPath, binary: false });
      index = index + 3;
    } else {
      const filePath = requireField(fields, index + 1, 'path');
      files.push({ status, path: filePath, binary: false });
      index = index + 2;
    }
  }
  return files;
}

/**
 * Reads the status letter off the first field of an entry and checks it is one of the
 * six this codebase models. The letter is the first character; the digits a rename or
 * copy carries after it (`R052`) are the similarity score, not part of the status.
 *
 * The return type is FileStatus, a union of six exact strings, and the compiler will
 * not let a plain `string` be returned as one — git could have printed anything. The
 * `if` proves, by comparing against each member, that `letter` is one of them (primer
 * §45); anything else throws, naming the letter, so no caller ever has to wonder what
 * a seventh letter would have meant. This is the one place git's text becomes a
 * FileStatus; everything after it compares against a closed list.
 */
// see primer §29 (charAt) and §45 (narrowing a string to an exact-string union)
function toFileStatus(statusField: string): FileStatus {
  const letter = statusField.charAt(0);
  if (letter === 'A' || letter === 'M' || letter === 'D' || letter === 'T' || letter === 'R' || letter === 'C') {
    return letter;
  }
  // see primer §12 (template strings)
  throw new Error(`git diff --name-status printed an entry with the unknown status "${letter}" (field: "${statusField}")`);
}

/**
 * The field at `position`, or an error when the output ended before it — a status
 * letter with no path after it. git never prints half an entry, so this is about
 * honesty rather than a case anyone expects: reading past the end of an array gives
 * `undefined` (primer §25), and the right thing to do with that is to stop with a
 * message naming what was missing, not to push `undefined` into a list of paths.
 * `description` is the missing field's name in that message.
 */
function requireField(fields: string[], position: number, description: string): string {
  if (position >= fields.length) {
    throw new Error(`git diff --name-status output ended before the ${description} of its last entry`);
  }
  return fields[position];
}

/**
 * The files the layer at `sha` changes against its parent at `parentSha`, in the
 * repository at `root` — one ChangedFile per file, as the tree lists them under the
 * layer's row (PR 11).
 *
 * The command is `git diff --name-status -M -z <parentSha> <sha> --` (plan §5 "Files in
 * a layer", plus the closing `--`), each piece for a reason:
 *
 * - Two revisions as two arguments compare two *trees*: the snapshot at the parent's
 *   tip against the snapshot at the layer's tip. So the list is what the layer as a
 *   whole changes, however many commits it took, and nothing the parent already had —
 *   "exactly its own files, not cumulative" (plan §10, M2) — because the bottom layer's
 *   parent is trunk and every other layer's parent is the layer below (core/stack.ts).
 *   It is also the comparison M3's diff editor will show, `<parentSha>:<path>` on the
 *   left and `<sha>:<path>` on the right, so the list and the diffs always agree. The
 *   merge-base form, `parent...layer`, would compare against the commit the two
 *   histories share instead — the same commit while the stack is in order, a different
 *   one once a parent has moved (E14, E15) — and its list would then name files whose
 *   diff against the parent looks nothing like it. `git diff` also accepts
 *   `parent..layer` and treats it exactly like the two arguments, but that spelling
 *   reads like `rev-list`'s range of commits (which core/stack.ts counts with), a
 *   different thing; the two-argument form says "these two snapshots" outright.
 * - `--name-status`: one entry per file with its status letter, no content. The tree
 *   only needs what changed and how; the content is M3's.
 * - `-M`: detect renames. Without it a moved file is a deletion and an addition; with
 *   it git pairs them into one `R` entry carrying both paths, so the tree can show
 *   `old → new` (E7) and the diff editor (M3) can put the old file on the left. git's
 *   default threshold applies: at least half the content unchanged.
 * - `-z`: NUL between fields and no quoting; parseNameStatus above says why.
 * - `--`: tells git the arguments before it are revisions and there are no paths, so a
 *   file at the repository root that happens to be named like one of the SHAs cannot
 *   make git refuse the command as ambiguous ("both revision and filename", exit 128).
 *   The output is byte for byte the same with it; plan §5's row simply omits it.
 *
 * Why SHAs and not branch names: the tree hands over `layer.parentSha` and `layer.sha`
 * from the RepoState it is showing. A branch can move between the moment the stack was
 * computed and the moment the user expands a layer — a commit in a terminal is enough
 * — and a list computed from the *names* then would not match the row it sits under,
 * whose tooltip still shows the old SHAs. The SHAs name exactly the two snapshots the
 * row describes, and the same pair always gives the same list, which is what lets PR 11
 * cache lists by `parentSha:sha` with no way for an entry to go stale. (A bare branch
 * name is also ambiguous with a tag of the same name, as core/stack.ts explains; a SHA
 * is not.)
 *
 * `run`, not `tryRun`: both SHAs came from git moments ago, so a non-zero exit is a
 * real problem — git gone (E17), the repository deleted — and it surfaces as a
 * rejection, which the tree turns into a message row under the layer (PR 11), never as
 * an empty list that looks like "this layer changes nothing".
 */
// see primer §6 (async / await)
export async function changedFiles(git: GitRunner, root: string, parentSha: string, sha: string): Promise<ChangedFile[]> {
  const output = await git.run(['diff', '--name-status', '-M', '-z', parentSha, sha, '--'], root);
  return parseNameStatus(output);
}
