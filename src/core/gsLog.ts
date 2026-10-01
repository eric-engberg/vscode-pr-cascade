/**
 * core/gsLog.ts — turns the stdout of `gs log short --json` (one JSON object per line) into
 * typed entries, one bad line at a time: every well-formed line is kept, every malformed one is
 * reported once with its line number, and nothing here ever throws (E57).
 *
 * Layer: core, pure (text in, value out; plan §4.1). Depends on: nothing. Depended on by:
 * core/backends/gitspice.ts `enrich` (item 20), which runs the command and hands the text here.
 * Plan: §7.13.2 (the documented schema), §8 E57, §9.4 `unit/gsLog`, §13.2 D55 (hand-rolled
 * after measuring zod; fields nothing reads yet are dropped).
 */

/**
 * The branch below this one (`down` in the JSON). Absent on the trunk's own line, which
 * git-spice 0.31.2 prints too (with `ups` and no `down`), so "no `down`" is how the trunk is
 * told apart; nothing else marks it, because `enrich` already knows `RepoState.trunk`.
 */
// see primer §9 (interface) and §24 (boolean)
export interface GsLogDown {
  name: string;
  /**
   * The branch below moved and this one has not been rebased onto it yet. In the JSON only
   * when true; absent means false, and it is filled in here so no reader writes `?? false`.
   */
  needsRestack: boolean;
}

/** The change request (PR or MR) git-spice knows for the branch. */
export interface GsLogChange {
  /**
   * Display text as the forge spells it — `#23` on GitHub, `!123` on GitLab. Not validated:
   * other forges spell it their way, and the text is only ever shown.
   */
  id: string;
  url: string;
  /**
   * Present only with `--cr-status` (a network call, plan §7.8). Documented as `open`,
   * `closed` or `merged`, but kept as text here: a value a later git-spice adds must not make
   * the whole line malformed (E57's degrade rule); M7 narrows it where it is read (primer §45).
   */
  // see primer §11 (optional `?` fields)
  status?: string;
}

/** How the branch compares with its remote-tracking branch. */
export interface GsLogPush {
  /** Local commits the remote does not have. */
  ahead: number;
  /** Remote commits the local branch does not have. */
  behind: number;
  /** In the JSON only when true; absent means false, filled in here. */
  needsPush: boolean;
}

/**
 * One line of `gs log short --json`: the fields `enrich` reads (plan §4.4, §7.8's local tier).
 * The schema's `current`, `worktree`, `ups`, `commits` and `change.comments` are documented
 * (§7.13.2) and dropped here until something reads them — git already tells the extension
 * which branch is current and how the layers stack — and unknown fields are dropped the same
 * way (E57, D55).
 */
export interface GsLogEntry {
  /** The branch name, exactly as git-spice prints it. */
  name: string;
  /** The branch below; absent on the trunk's line. */
  down?: GsLogDown;
  /** The change request, when one has been submitted. */
  change?: GsLogChange;
  /** The push state, when the branch has a remote-tracking branch. */
  push?: GsLogPush;
}

/** One line parseGsLog could not use. */
export interface MalformedLine {
  /** 1-based position in the stdout. Blank lines count towards it but are never reported. */
  line: number;
  /**
   * What was wrong, as a short phrase: `not JSON`, `not a JSON object`, or `<path> is not a
   * <type>` — `push.ahead is not a number`, `down is not an object`. The first failing check
   * only, so one bad line is one problem however much is wrong with it.
   */
  problem: string;
}

/** What parseGsLog answers: the usable lines, in output order, and the lines it had to skip. */
export interface GsLogParse {
  /** One per well-formed line, in the order git-spice printed them; nothing is deduplicated. */
  entries: GsLogEntry[];
  malformed: MalformedLine[];
}

/**
 * Parses the stdout of `gs log short --json` — stdout only: git-spice's `INF` and `WRN` lines
 * go to stderr (verified with 0.31.2), and a caller that mixed the two streams would see them
 * reported here as `not JSON`, once each.
 *
 * The text is split on `\n`; each line is trimmed (which takes a CRLF's `\r` with it) and a
 * blank line is skipped; every other line goes through `parseJsonLine` and then the §51 ladder
 * inside one `try`, whose `catch` turns the thrown `Error` — `not JSON` from `parseJsonLine`, or
 * the ladder's message naming the field — into one MalformedLine. Empty output gives two
 * empty arrays. Never throws for any text.
 */
// see primer §29 (a counted loop: the index is the line number), §22 (`continue`), §18
// (`catch (error)`, narrowed with `instanceof Error` before `.message` is read) and §16
// (object literals: a shorthand key — `{ entries, malformed }`)
export function parseGsLog(stdout: string): GsLogParse {
  const entries: GsLogEntry[] = [];
  const malformed: MalformedLine[] = [];
  const lines = stdout.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line === '') {
      continue;
    }
    try {
      entries.push(entryFromJson(parseJsonLine(line)));
    } catch (error) {
      // Everything thrown below is an Error carrying the problem as its message. Anything
      // else would be a bug in this file, not a bad line, so it is not swallowed.
      if (!(error instanceof Error)) {
        throw error;
      }
      malformed.push({ line: index + 1, problem: error.message });
    }
  }
  return { entries, malformed };
}

/**
 * `JSON.parse` with the one message this file wants for text that is not JSON. The result is
 * declared `unknown` (primer §50): JSON can hold anything, and nothing may be read off it
 * until a check below has proved its shape.
 */
// see primer §50 (`JSON.parse`) and §18 (a `catch` with no binding)
function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new Error('not JSON');
  }
}

/**
 * One line's object → GsLogEntry, or a throw naming the first field that is wrong. The rule
 * for every field in this file: a documented field that is *present* with the wrong type makes
 * the whole line malformed; an absent optional field is fine; and an optional field is **not
 * assigned** when absent, so an entry built here is `{ name: 'main' }` and not
 * `{ name: 'main', down: undefined }` — the shape a test can compare with `toStrictEqual`.
 *
 * `Array.isArray` sits beside the `typeof`/`null` check because `typeof []` is `'object'` too
 * (primer §41): without it a line reading `[]` would be reported as "name is not a string".
 * The nested objects each have a function of their own below, so every ladder stays one
 * level deep (primer §51) and names its path in the message.
 */
// see primer §51 (checking the shape of a parsed value: `typeof`, `null`, `in`) and §41
// (`Array.isArray`)
function entryFromJson(value: unknown): GsLogEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('not a JSON object');
  }
  if (!('name' in value) || typeof value.name !== 'string') {
    throw new Error('name is not a string');
  }
  const entry: GsLogEntry = { name: value.name };
  if ('down' in value) {
    entry.down = downFromJson(value.down);
  }
  if ('change' in value) {
    entry.change = changeFromJson(value.change);
  }
  if ('push' in value) {
    entry.push = pushFromJson(value.push);
  }
  return entry;
}

/** The `down` object → GsLogDown; `needsRestack` defaults to false when absent. */
function downFromJson(value: unknown): GsLogDown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('down is not an object');
  }
  if (!('name' in value) || typeof value.name !== 'string') {
    throw new Error('down.name is not a string');
  }
  const down: GsLogDown = { name: value.name, needsRestack: false };
  if ('needsRestack' in value) {
    if (typeof value.needsRestack !== 'boolean') {
      throw new Error('down.needsRestack is not a boolean');
    }
    down.needsRestack = value.needsRestack;
  }
  return down;
}

/** The `change` object → GsLogChange; `status` is kept only when present, `comments` is dropped. */
function changeFromJson(value: unknown): GsLogChange {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('change is not an object');
  }
  if (!('id' in value) || typeof value.id !== 'string') {
    throw new Error('change.id is not a string');
  }
  if (!('url' in value) || typeof value.url !== 'string') {
    throw new Error('change.url is not a string');
  }
  const change: GsLogChange = { id: value.id, url: value.url };
  if ('status' in value) {
    if (typeof value.status !== 'string') {
      throw new Error('change.status is not a string');
    }
    change.status = value.status;
  }
  return change;
}

/** The `push` object → GsLogPush; `needsPush` defaults to false when absent. */
function pushFromJson(value: unknown): GsLogPush {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('push is not an object');
  }
  if (!('ahead' in value) || typeof value.ahead !== 'number') {
    throw new Error('push.ahead is not a number');
  }
  if (!('behind' in value) || typeof value.behind !== 'number') {
    throw new Error('push.behind is not a number');
  }
  const push: GsLogPush = { ahead: value.ahead, behind: value.behind, needsPush: false };
  if ('needsPush' in value) {
    if (typeof value.needsPush !== 'boolean') {
      throw new Error('push.needsPush is not a boolean');
    }
    push.needsPush = value.needsPush;
  }
  return push;
}
