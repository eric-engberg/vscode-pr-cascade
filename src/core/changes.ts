/**
 * core/changes.ts — lists the files one layer changes against the layer below it, and
 * which of them git considers binary, by reading two NUL-separated tree diffs.
 *
 * Layer: core (no VS Code imports; plan §4.1). Depends on: core/model.ts (GitRunner,
 * ChangedFile, FileStatus). Depended on by: src/extension.ts (PR 11), which wraps
 * changedFiles in the loadFiles function the tree (src/vscode/tree.ts) calls once per
 * expanded layer to render one row per ChangedFile. Plan: §4.2, §4.3, §5 rows "Files in
 * a layer" / "Binary detection", §8 E7–E11, E18, §10.1 M2 items 7–8.
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
 * The separator between the columns of one `--numstat` entry: a tab, which `-z` does
 * not change (it only replaces the newline between entries). A path may contain a tab
 * too, so parseNumstat cuts at the first two tabs of an entry and never at every one.
 */
const COLUMN_SEPARATOR = '\t';

/**
 * What a numstat count looks like when git counted: one or more digits, nothing else.
 * The other thing git prints there is `-`, for a binary file; isBinary reads both.
 */
// see primer §20 (regular expression literals: `test`)
const LINE_COUNT = /^\d+$/;

/**
 * One entry of `git diff --numstat -M -z` output, reduced to the one thing this codebase
 * asks numstat: is the file binary? git prints two counts per file — lines added, lines
 * deleted — and `-` for both when it considers the file binary (E10); the counts are
 * read only to answer that and are not kept, because nothing in the tree shows them.
 * `path` is where the file is at the layer — for a rename, the new path — so it is the
 * same string ChangedFile.path holds for that entry, and changedFiles can pair the two
 * lists by it. Not part of the plan §4.3 data model: it lives only between parseNumstat
 * and changedFiles, which is why it is declared here rather than in core/model.ts.
 */
// see primer §9 (interface) and §24 (boolean)
export interface NumstatEntry {
  path: string;
  binary: boolean;
}

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
 * may be wrong. `binary` is `false` on every entry: name-status has no binary flag;
 * changedFiles fills the field in from parseNumstat, which has.
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
 * Turns the output of `git diff --numstat -M -z <parent> <layer>` into one NumstatEntry
 * per file, in git's order — the same order as name-status, though changedFiles does
 * not rely on that. A pure function like parseNameStatus, and specified the same way:
 * the unit tests quote real output byte for byte.
 *
 * The format, as git 2.50 prints it (verified on a real repository, 2026-09-20). One
 * entry per line here so each can be read on its own; git prints them back to back,
 * with nothing but the NUL between them:
 *
 *     1\t0\tadded.txt\0
 *     -\t-\timage.png\0
 *     0\t0\t\0old-name.txt\0new-name.txt\0
 *
 * Without `-z` numstat is a tab-separated table — lines added, lines deleted, path —
 * one file per line. `-z` keeps the tabs and ends each entry with a NUL instead of a
 * newline, and it stops git quoting paths, as with name-status:
 *
 * - A plain entry is one NUL-ended piece: `<added>\t<deleted>\t<path>`. The counts are
 *   digits — or `-` for both when git considers the file binary (E10): it found a NUL
 *   byte in the first 8000 bytes of the content, or a `.gitattributes` line says
 *   `binary`, and a line count means nothing for such a file. That `-` is the whole
 *   reason this command is run at all.
 * - A rename or copy is *three* NUL-ended pieces: the two counts followed by an *empty*
 *   path — `<added>\t<deleted>\t` and then the NUL at once — then the old path, then the
 *   new one, each ended by its own NUL. It is the same trick name-status uses for its
 *   three-field entries, and the empty path is what tells the two shapes apart: git
 *   never prints an empty path for a real file.
 * - The path is everything after the second tab, tabs included. `-z` leaves a path
 *   containing a tab (or a newline, or anything else) unquoted, so the piece is cut at
 *   its first two tabs only — `cut -f3-`, not `cut -f3` — never at every tab.
 * - The last piece ends in a NUL like every other; nothing changed is an empty string.
 *
 * Anything else — a piece with fewer than two tabs, a count that is neither digits nor
 * `-` — is an error naming what was found, never a guess (the rule toFileStatus follows):
 * such output is not numstat's, and quietly calling every file text would hide that.
 */
// see primer §25 (arrays: split, slice and join — `cut -f3-`) and §38 (the same
// index-advancing while loop as parseNameStatus)
export function parseNumstat(output: string): NumstatEntry[] {
  // The same cut as parseNameStatus: one piece per NUL, and the empty piece the last
  // NUL leaves behind is dropped.
  const pieces = output.split(FIELD_SEPARATOR);
  if (pieces[pieces.length - 1] === '') {
    pieces.pop();
  }

  const entries: NumstatEntry[] = [];
  // A plain entry is one piece, a rename three: the loop steps by one or three, and
  // `index` always sits on a counts piece when the body starts.
  let index = 0;
  while (index < pieces.length) {
    // `<added>\t<deleted>\t<path>`: cut at the tabs, take the two counts, and glue the
    // rest back together with the tabs it had — that rest is the path, tabs and all.
    const columns = pieces[index].split(COLUMN_SEPARATOR);
    if (columns.length < 3) {
      // see primer §12 (template strings)
      throw new Error(`git diff --numstat printed an entry without its two counts: "${pieces[index]}"`);
    }
    const binary = isBinary(columns[0], columns[1]);
    const pathColumn = columns.slice(2).join(COLUMN_SEPARATOR);
    if (pathColumn === '') {
      // A rename or copy: the path comes as the next two pieces, old then new. Only the
      // new path is kept — it is where the file is at the layer, and the string
      // ChangedFile.path holds for the same entry. Asking for the new path checks that
      // the output did not end early; the old path, one piece before it, is then there.
      const newPath = requireField(pieces, index + 2, 'new path');
      entries.push({ path: newPath, binary });
      index = index + 3;
    } else {
      entries.push({ path: pathColumn, binary });
      index = index + 1;
    }
  }
  return entries;
}

/**
 * Reads git's answer off the two counts of a numstat entry: `-` and `-` means git
 * considers the file binary; digits and digits means it counted lines, so the file is
 * text. git prints nothing else there, so anything else is an error naming both fields
 * — the output is not numstat's, or the rules in parseNumstat are wrong — rather than a
 * file quietly shown as text.
 */
// see primer §20 (regular expression literals: `test`) and §24 (boolean)
function isBinary(addedField: string, deletedField: string): boolean {
  if (addedField === '-' && deletedField === '-') {
    return true;
  }
  if (LINE_COUNT.test(addedField) && LINE_COUNT.test(deletedField)) {
    return false;
  }
  throw new Error(`git diff --numstat printed counts that are neither digits nor "-": "${addedField}" and "${deletedField}"`);
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
  throw new Error(`git diff --name-status printed an entry with the unknown status "${letter}" (field: "${statusField}")`);
}

/**
 * The field at `position`, or an error when the output ended before it — a status
 * letter with no path after it, a rename with only one of its two paths. git never
 * prints half an entry, so this is about honesty rather than a case anyone expects:
 * reading past the end of an array gives `undefined` (primer §25), and the right thing
 * to do with that is to stop with a message naming what was missing, not to push
 * `undefined` into a list of paths. `description` is the missing field's name in that
 * message. Shared by both parsers, so the message names neither command.
 */
function requireField(fields: string[], position: number, description: string): string {
  if (position >= fields.length) {
    throw new Error(`git diff output ended before the ${description} of its last entry`);
  }
  return fields[position];
}

/**
 * The files the layer at `sha` changes against its parent at `parentSha`, in the
 * repository at `root` — one ChangedFile per file, as the tree lists them under the
 * layer's row (PR 11).
 *
 * Two commands are run over the same pair of commits, because neither alone says
 * everything the tree needs (plan §5, rows "Files in a layer" and "Binary detection"):
 * `--name-status` gives each file's status letter and, for a rename, both paths, but has
 * no way to say a file is binary; `--numstat` says binary — `-` for both counts (E10) —
 * but has no status letter. The first command,
 * `git diff --name-status -M -z <parentSha> <sha> --`, piece by piece:
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
 * The second command is the same with `--numstat` in place of `--name-status`, and the
 * two lists are paired by path: a ChangedFile whose path numstat marks binary becomes
 * `binary: true`; one numstat does not mention stays `false`; a path only numstat
 * mentions is ignored. The same `-M` and `-z` on both is not tidiness. The two lists
 * have to describe the same entries the same way, and rename detection is what decides
 * how a moved file is described: a user whose git config says `diff.renames = false`
 * would, with `-M` on one command only, get one `R` entry from name-status and a `D`
 * plus an `A` from numstat, and the paths would never pair up (verified on git 2.50:
 * with `-M` on both, that config makes no difference). Pairing by path rather than by
 * position — git does sort both lists the same way — because a lookup by path is
 * obviously right, and a lookup by position would only be right for as long as nobody
 * changed one flag. The commands run one after the other: a click on a layer is not a
 * hot path, and two steps in a row read as two steps.
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
// see primer §6 (async / await), §21 (Set) and §22 (for ... of)
export async function changedFiles(git: GitRunner, root: string, parentSha: string, sha: string): Promise<ChangedFile[]> {
  const nameStatusOutput = await git.run(['diff', '--name-status', '-M', '-z', parentSha, sha, '--'], root);
  const files = parseNameStatus(nameStatusOutput);
  const numstatOutput = await git.run(['diff', '--numstat', '-M', '-z', parentSha, sha, '--'], root);
  const numstatEntries = parseNumstat(numstatOutput);

  // The paths git considers binary, as a Set so each file below is one `has` away from
  // its answer (E10).
  const binaryPaths = new Set<string>();
  for (const entry of numstatEntries) {
    if (entry.binary) {
      binaryPaths.add(entry.path);
    }
  }
  // parseNameStatus built these objects a moment ago with `binary: false` in every one;
  // this fills the field in (allowed on a `const` array — primer §4).
  for (const file of files) {
    file.binary = binaryPaths.has(file.path);
  }
  return files;
}
