# TypeScript primer for this codebase

This file explains each piece of TypeScript syntax **once**, the first time it appears in the
project, in the order a reader following [`reading-order.md`](reading-order.md) meets it.
Code comments point here (`// see primer §3 (functions and type annotations)`) instead of
re-explaining the language. Every PR that introduces a new construct adds a section.

It is written for someone fluent in shell and git who has not written TypeScript. Two things
to hold onto:

- **TypeScript is JavaScript plus type annotations.** Delete the annotations and what is left
  is JavaScript. The annotations never run; the compiler (`tsc`) reads them to catch mistakes
  before anything executes, then esbuild strips them and bundles the rest.
- **Files ending in `.mjs` are plain JavaScript** (the `m` means "module": they use `import`,
  not `require`). Our tooling scripts are `.mjs` because Node runs them directly, with no
  compile step. They run ahead of this primer's order: `scripts/depcheck.mjs` uses
  JavaScript features (`?.`, `??`, destructuring, `...` spread, template strings,
  `try`/`catch`) that get their section here when they first appear in `src/`. Read the
  tooling scripts for *what* they do — their comments say what each step is for — not how.
  `.mts` is the same idea for TypeScript (only `vitest.config.mts` uses it). Everything that
  ships or is tested is `.ts`.

---

## 1. import / export

*First seen in `src/extension.ts`.*

```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void { ... }
```

A `.ts` file is a **module**: nothing inside it is visible to other files unless the file
`export`s it, and a file sees nothing from other files unless it `import`s it. Think of it as
a shell script where every variable is local by default and `export` opts one in.

- `import * as vscode from 'vscode'` — load the whole module named `vscode` and call it
  `vscode` here. Everything it offers is then reached as `vscode.something`. The name after
  `as` is our choice, but by convention it matches the module.
- `import { describe, it } from 'mocha'` (in `test/ext/activate.test.ts`) — load only the
  named pieces `describe` and `it`. The braces are the "pick these names" form;
  `vitest.config.mts` uses it too (`import { defineConfig } from 'vitest/config'`).
- `export function activate(...)` — make `activate` visible to whoever imports this file.
  Here the importer is VS Code itself: it loads `dist/extension.js` and calls the exported
  `activate` and `deactivate`.
- `export default defineConfig({ ... })` (in `vitest.config.mts`, `.vscode-test.mjs`,
  `eslint.config.mjs`) — a module's single *unnamed* export. The importer picks any name
  and writes no braces: `import config from './vitest.config'`. Tool config files use it
  because the tool wants exactly one value from the file: the configuration.

Module names that start with `.` or `/` are file paths (`'./model'`); anything else is looked
up in `node_modules/` or, for `node:fs` and friends, inside Node itself.

## 2. The `vscode` module

*First seen in `src/extension.ts`.*

`vscode` is not a package we install to ship — it is the API VS Code hands to every extension
at runtime. What we install is `@types/vscode`, a description of that API's shapes so the
compiler can check our calls. Two consequences worth knowing:

- Its version is pinned to `1.85.0` to match `engines.vscode` in `package.json`. If we typed
  against a newer API than the oldest VS Code we claim to support, the code would compile
  and then fail for that user. `vsce` (the packager) refuses to build if they disagree.
- esbuild is told `external: ['vscode']` so it never tries to bundle it — there is nothing to
  bundle; VS Code supplies it at load time.

Only `src/vscode/**`, `src/extension.ts` and the extension-host tests in `test/ext/` may
import it (they run inside VS Code, so it is there). `src/core/**` may not, and
`eslint.config.mjs` turns that one prohibition into a lint error (plan §4.1).

## 3. Functions and type annotations

*First seen in `src/extension.ts`.*

```ts
export function activate(context: vscode.ExtensionContext): void {
```

Read the colons as "is a": `context` **is a** `vscode.ExtensionContext`; the function's result
**is** `void` (it returns nothing). The compiler then checks two things: every caller passes
an `ExtensionContext`, and the body never returns a value.

Annotations on parameters are required on `function` declarations; annotations on the return
value are required on every exported function (plan §11.1) so a reader sees the contract
without reading the body. Inside a body TypeScript usually infers types on its own, which is
why local variables (next section) rarely carry one — and why a callback handed to another
function (the arrow functions in §5) may leave its parameter types off: the compiler takes
them from the function that receives the callback.

## 4. const

*First seen in `src/extension.ts`.*

```ts
const output = vscode.window.createOutputChannel('PR Cascade');
```

`const` declares a name that cannot be reassigned. It is the default in this codebase;
`let` is used only where a value genuinely changes (a counter, an accumulator). Note that
`const` fixes the *binding*, not the *contents*: `output` will always point at that channel,
but `output.appendLine(...)` still changes the channel.

No type is written here because the compiler already knows what `createOutputChannel`
returns (`vscode.OutputChannel`). Hover over `output` in VS Code to see it.

`let` also comes in a form with a type but no value yet — `let scratchDir: string;` at the
top of `test/git/git.git.test.ts`. It is for a value that exists only once some setup has
run: `beforeAll` assigns it, once, before any test reads it. The type has to be written
out, because there is no value for the compiler to infer it from.

## 5. Arrow functions

*First seen in `test/ext/activate.test.ts`.*

```ts
describe('extension activation', () => {
  ...
});
```

`() => { ... }` is a function without a name, written inline: the parameters go in the
parentheses, the body in the braces. Test runners are built on them — `describe` takes a
label and "a function to run", and the arrow function is that function. When the body is a
single expression the braces may be dropped: `(entry) => entry.name` returns `entry.name`.

There is one real difference from `function name() {}`: an arrow function has no `this` of
its own — it keeps the `this` of the code it is written in — while a `function` gets a
`this` of its own (usually nothing useful). Until §13 nothing here uses `this`, so up to
that point the two forms are interchangeable. From `RealGitRunner.run` on they are not:
the callbacks handed to `new Promise` and to `execFile` (§15) read `this.gitPath`, which
works only because they are arrows; written as `function () {}` they would find
`this.gitPath` undefined. The rule in this codebase: arrows for callbacks, `function` for
anything exported.

## 6. async / await

*First seen in `test/ext/activate.test.ts`.*

```ts
it('activates', async () => {
  await extension.activate();
  assert.strictEqual(extension.isActive, true);
});
```

Some operations take time and JavaScript does not block while they run (a git command, a
file read, VS Code starting an extension). `await` says "pause this function here until that
finishes, then continue with the result" — and only functions marked `async` may contain an
`await`. Without the `await`, the assertion on the next line would run before activation was
finished.

One exception to "only inside `async` functions": in an ES module (a `.mjs` or `.mts` file)
`await` is also allowed at the top level of the file, outside any function. `esbuild.mjs`
and `scripts/depcheck.mjs` do this because they are short scripts that run top to bottom,
not libraries; nothing under `src/` does.

Shell analogy: calling an `async` function is `git fetch &` — it starts, and your script
carries on. `await` is the `wait $!` you write later: this function stops at that line until
the fetch is done, but everything else in the program (other functions, VS Code's UI) keeps
running, because only this one function is paused.

## 7. Promise

*First seen in `test/ext/activate.test.ts` (the value `extension.activate()` returns).*

A `Promise<T>` is "a `T` that is not here yet". Every `async` function returns one, and
`await` is how you unwrap it. In this PR the two places are the value `extension.activate()`
returns and the test bodies themselves:

```ts
it('activates', async () => { ... });   // an async arrow function returns Promise<void>
```

`Promise<void>` is "nothing useful, eventually": there is no value to unwrap, but a caller
can still `await` it to know the work is done — which is exactly what Mocha does with each
test. Later PRs put the type in signatures (`Promise<string>`: a string, eventually).

A Promise ends in one of two ways: it **resolves** with a value (`await` hands you the value)
or it **rejects** with an error (`await` throws it, and `try`/`catch` can catch it — that
construct gets its own section when it first appears). VS Code's API uses the name `Thenable`
in a few places; for our purposes it is a Promise.

## 8. undefined and narrowing

*First seen in `test/ext/activate.test.ts`.*

```ts
const extension = vscode.extensions.getExtension('local.vscode-pr-cascade');
assert.ok(extension);
await extension.activate();
```

`getExtension` returns either an `Extension` or `undefined` (when no extension has that id).
Under `"strict": true` the compiler refuses `extension.activate()` on the first line after
the lookup: "`extension` is possibly `undefined`". This is the single most valuable check in
TypeScript — it is the null-pointer bug caught at compile time.

**Narrowing** is how you satisfy it: prove to the compiler that the value is present.
`assert.ok(extension)` throws if `extension` is `undefined`, and its type declaration tells
the compiler so; from that line on, `extension` is known to be an `Extension`. An `if
(extension === undefined) { return; }` guard narrows the same way. Both are ordinary code —
the compiler simply follows the control flow.

## 9. interface

*First seen in `src/core/model.ts`.*

```ts
export interface GitRunner {
  run(args: string[], cwd: string): Promise<string>;
  tryRun(args: string[], cwd: string): Promise<string | null>;
}
```

An `interface` describes a **shape**: "anything called a `GitRunner` has these two methods,
with these parameters and results". It contains no code and produces nothing at run time —
after compilation it is simply gone. Its value is that a function can ask for
`git: GitRunner` and accept *anything* with that shape: the real runner in production, a
fake that answers from canned strings in tests. Neither has to know the other exists.

An interface can describe data fields as well as methods (`GitFailure` in `core/git.ts` is
all fields: `exitCode: number | null;`), and a plain object literal with those fields
satisfies it — no `new`, no class needed: `new GitError({ gitPath: 'git', args: [...], ... })`.

Two small things that appear alongside it:

- `string[]` — "an array of strings". Any type followed by `[]` is an array of that type.
  Arrays come with methods: `failure.args.join(' ')` (in `core/git.ts`) glues the elements
  into one string with a space between each — `['rev-parse', 'HEAD']` becomes
  `'rev-parse HEAD'` — and `this.calls.push(...)` (in the fake runner) appends one element
  at the end. `Array.from(...)` (§19, §21) turns a Map's keys or a Set into an array. The
  other Array methods get a section of their own when a later PR starts using them.
- `import type { GitRunner } from './model'` (in `core/git.ts` and `test/helpers/fakeGit.ts`)
  — the `type` keyword says "I only need this name for type-checking". Because interfaces
  vanish at compile time, so does the import; there is nothing for esbuild to bundle. A
  plain `import { GitRunner }` would also work; `import type` states the intent.

## 10. Union types

*First seen in `src/core/model.ts`.*

```ts
tryRun(args: string[], cwd: string): Promise<string | null>;
```

The `|` reads "or": the result is a `string`, or `null`. Where a shell script signals "no
answer" with an empty string and hopes every caller remembers, TypeScript lets the type say
the answer may be absent — and then refuses to let a caller use it as a string until it has
checked (§8 narrowing): `if (root === null) { ... }`.

JavaScript has two "nothing" values, for historical reasons. The convention in this
codebase: **`null` is a deliberate answer** we return ("git said no"); **`undefined` is what
you get when something was never set** — an optional field that was left out (§11), a
`Map` lookup that found nothing (§19). Other unions you will meet here: `number | null`
(an exit code, or none), `string | Error` (the fake runner's canned values).

Two more things a union can do, both in `core/git.ts` (`StartFailure`):

```ts
export type StartFailure = 'not-found' | 'not-executable' | 'unusable-directory' | null;
```

- The members can be **exact strings**, not only kinds of value. This union means "one of
  these three spellings, or `null`": a typo such as `'notfound'` is a compile error, and
  `failure.startFailure === 'not-found'` is how code branches on it. It is the type-level
  version of a shell `case` over fixed words. PR 5's `FileStatus` (`'A' | 'M' | 'D' | ...`)
  works the same way.
- `type Name = ...` gives a type a **name**, so it is written once and used by name
  (`startFailure: StartFailure` in the interface, in the class, and as a function's return
  type). Like `interface` (§9), a `type` produces nothing at run time. The difference:
  an `interface` describes an object's shape; `type` can name *any* type, a union included.

## 11. Optional fields

*First seen in `src/core/git.ts` (`GitFailure`).*

```ts
export interface GitFailure {
  stderr: string;
  detail?: string;
}
```

The `?` after a name means the field **may be left out entirely** when the object is built.
Reading it gives `string | undefined`, so code that uses it checks first:
`if (failure.detail !== undefined) { ... }`. This is different from writing
`detail: string | undefined` without the `?`, which would *require* the key to be present
(even if set to `undefined`). Use `?` for a value that only sometimes exists.

The class `GitError` holds the same value as `readonly detail: string | undefined` — the
form *without* `?` — on purpose: a class field is always present on the object, so the
honest description is "a string, or `undefined` when the failure had no detail", not "may
be left out".

## 12. Template strings

*First seen in `src/core/git.ts` (`describeFailure`).*

```ts
return `git not found at ${failure.gitPath} (while running: ${command})`;
```

A string in **backticks** may contain `${...}` holes, and whatever expression is inside a
hole is evaluated and inserted — like `"$var"` in shell, except any expression is allowed,
not just a variable name. Template strings may also span several lines. Ordinary
single-quoted strings have no holes; this codebase uses them everywhere a string is fixed.

## 13. class, extends and constructor

*First seen in `src/core/git.ts` (`GitError`, `RealGitRunner`).*

```ts
export class GitError extends Error implements GitFailure {
  readonly exitCode: number | null;

  constructor(failure: GitFailure) {
    super(describeFailure(failure));
    this.name = 'GitError';
    this.exitCode = failure.exitCode;
  }
}

const error = new GitError({ ... });
```

A **class** is a blueprint for objects that carry both data (**fields**) and behaviour
(**methods**). `new GitError(...)` creates one object from the blueprint and runs its
`constructor` with the arguments given. Inside the class, `this` is the object being built
or used. An interface (§9) describes only a shape; a class also brings the code — use a
class when there is something to *do* or *remember*, an interface when a shape is enough.

- `extends Error` — this class **inherits** from the built-in `Error`. A `GitError`
  therefore *is* an `Error`: it can be thrown and caught, `instanceof Error` is true, and it
  gets `.message` and a stack trace for free. `super(...)` calls the parent's constructor
  (here: `Error`'s, which takes the message) and must run before `this` is touched.
- `implements GitRunner` (`RealGitRunner`, `FakeGitRunner`) — a promise to the compiler that
  the class has the interface's shape; a missing or mismatched method is a compile error.
  `extends` inherits code; `implements` only checks a shape. The promise covers fields as
  well as methods, and a class may make it while also extending something: `GitError
  extends Error implements GitFailure` inherits `Error`'s code *and* is held to
  `GitFailure`'s fields, so a field added to the interface and forgotten in the class is a
  compile error rather than an error object that silently lacks it.
- A **method** is a function attached to the object: `run(args: string[], cwd: string):
  Promise<string> { ... }` inside the class, `git.run(...)` outside.
- `private readonly gitPath: string;` — `private` means only code inside the class can
  read it. Callers see the public surface (the methods) and nothing else.
- `constructor(gitPath: string = 'git')` — a **default parameter**: `new RealGitRunner()`
  is the same as `new RealGitRunner('git')`.
- `readonly calls: GitCall[] = [];` (in the fake) — a field with an initial value, set
  when the object is created; no constructor line needed.

## 14. readonly

*First seen in `src/core/git.ts` (`GitError`).*

```ts
readonly exitCode: number | null;
```

A `readonly` field can be assigned only where the object is created — in the constructor or
in its initializer — and `error.exitCode = 1` anywhere later is a compile error. It is
`const` (§4) for fields, and like `const` it is a compile-time promise only. Read it as
"this is a fact about the object, not a knob": a `GitError` describes one failure, and
nothing should be able to edit that description afterwards.

## 15. new Promise

*First seen in `src/core/git.ts` (`RealGitRunner.run`).*

```ts
return new Promise((resolve, reject) => {
  execFile(this.gitPath, args, options, (error, stdout, stderr) => {
    if (error === null) {
      resolve(stdout);
      return;
    }
    reject(new GitError({ ... }));
  });
});
```

§7 said every `async` function returns a Promise. Here a Promise is built **by hand**,
because the thing being wrapped — Node's `execFile` — is an older-style API that reports
its result through a **callback**: a function you hand in, which Node calls later with
`(error, stdout, stderr)`. `new Promise` takes a function and gives it two functions of its
own: call `resolve(value)` when the work is done, or `reject(error)` when it failed. The
Promise settles exactly once, and whoever `await`s it gets the value or has the error
thrown at them. This is the standard adapter between callback APIs and `await`, and
`RealGitRunner.run` is the only place in the codebase that needs it.

Three details: `run` is not marked `async`, because it already returns a Promise
explicitly; the `return;` after `resolve(stdout)` matters, because the callback would
otherwise continue into the failure branch; and both callbacks are arrow functions because
they read `this.gitPath` — an arrow keeps the method's `this`, a `function` would not (§5).

## 16. Object literals: shorthand and spread

*First seen in `src/core/git.ts` (`RealGitRunner.run`); shorthand keys also in
`test/helpers/fakeGit.ts`.*

```ts
const options: ExecFileOptionsWithStringEncoding = {
  cwd,
  env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
  maxBuffer: MAX_OUTPUT_BYTES,
};
```

`{ key: value, ... }` builds an object on the spot — an **object literal** (§9 showed one
satisfying an interface). The `: ExecFileOptionsWithStringEncoding` after the name is an
ordinary type annotation (§3), and on an object literal it is what turns an unknown key — a
misspelled `maxBufer`, say — into a compile error instead of an option Node would silently
ignore. This one uses all three ways of writing a key:

- `maxBuffer: MAX_OUTPUT_BYTES` — the ordinary form: key, colon, value.
- `cwd` on its own is **shorthand** for `cwd: cwd`. When a variable already has the name
  the key should have, writing it once does both: the key is `cwd` and the value is
  whatever the variable `cwd` holds — here, `run`'s parameter. `this.calls.push({ args, cwd })`
  in the fake runner and `new GitError({ gitPath: this.gitPath, args, cwd, exitCode, ... })`
  are the same thing: every bare name is a key *and* the variable of that name.
- `...process.env` inside `{ }` is **spread**: it copies every key of `process.env` into the
  new object being built; the keys written after it are added, or **override** a copied
  key with the same name (later wins). The original object is untouched. It is exactly the
  shell idiom `LC_ALL=C GIT_OPTIONAL_LOCKS=0 git ...`: the child gets the parent's whole
  environment plus these two.

## 17. Narrowing with typeof

*First seen in `src/core/git.ts` (`RealGitRunner.run`).*

```ts
let exitCode: number | null = null;
if (typeof error.code === 'number') {
  exitCode = error.code;
}
```

Node declares `error.code` as `string | number | null | undefined` — a union (§10) of
everything it might put there. `typeof x` evaluates to a string naming the value's
JavaScript type (`'string'`, `'number'`, `'undefined'`, ...), and inside the `if` the
compiler knows `error.code` is a `number`, so the assignment is allowed. Comparing with
`=== 'ENOENT'` or `=== 'EACCES'` (in `classifyStartFailure`) needs no narrowing: comparison
is always permitted, and the result is a plain boolean. `let exitCode: number | null = null`
is a `let` (§4) with a written type: it starts as `null` and may become a number, and the
type says so.

## 18. try / catch and unknown

*First seen in `src/core/git.ts` (`RealGitRunner.tryRun`).*

```ts
try {
  return await this.run(args, cwd);
} catch (error) {
  if (error instanceof GitError) {
    const gitSaidNo = error.exitCode !== null;
    const directoryUnusable = error.startFailure === 'unusable-directory';
    if (gitSaidNo || directoryUnusable) {
      return null;
    }
  }
  throw error;
}
```

`try` runs its block; if anything inside throws — including a rejected Promise that was
`await`ed (§7) — execution jumps to `catch` with the thrown value. What is not handled
there can be thrown again (`throw error`) for the caller to deal with.

The caught value is typed **`unknown`** under strict mode: JavaScript lets code throw
anything (a string, a number, an object), so the compiler refuses to let you read
`error.exitCode` until you have proved what `error` is. `error instanceof GitError` does
that: it is true only for objects created by `new GitError(...)` (or a subclass), and inside
the `if` the compiler treats `error` as a `GitError`. `unknown` is the honest cousin of
`any`: `any` switches checking off, `unknown` demands proof. This codebase never uses `any`
(plan §11.1).

`&&` is "and" and `||` is "or" (`gitSaidNo || directoryUnusable`: true when either is). Both
stop early — `a && b` never looks at `b` when `a` is false — which is why a check such as
`error instanceof GitError && error.exitCode !== null` is safe to write on one line: the
field is only read once the `instanceof` has proved it exists.

One more form, in `src/core/discovery.ts` (`normalizeRoot`):

```ts
try {
  resolved = await fs.realpath(printedRoot);
} catch {
  // Keep the path git printed.
}
```

When the code in `catch` does not look at the error at all — every failure gets the same
treatment — the name may be left off: `catch {` instead of `catch (error) {`. It tells the
reader "this can fail, and why does not matter here". A comment inside the block is still
wanted, so it never looks like an accident (ESLint flags an empty block without one).

## 19. Map

*First seen in `test/helpers/fakeGit.ts`.*

```ts
private readonly responses: Map<string, string | Error>;

const git = new FakeGitRunner(new Map([['--version', 'git version 2.50.1\n']]));
const response = this.responses.get(key);   // string | Error | undefined
```

A `Map` is a key → value store. `new Map([[key, value], ...])` builds one from a list of
pairs; `.get(key)` returns the value or `undefined` when the key is absent; `.has(key)`,
`.set(key, value)` and `.keys()` do what they say, and `Array.from(map.keys())` turns the
keys into an ordinary array. Compared with a plain object used as a dictionary, a `Map`
takes any key type, iterates in insertion order, and has no built-in names (`toString`,
`constructor`) that could collide with a key.

The angle brackets are **type parameters**: `Map<string, string | Error>` says this
particular map's keys are strings and its values are strings or Errors, so the compiler
knows `.get` returns `string | Error | undefined`. `Promise<string>` (§7) is the same idea:
"a Promise of a string". This codebase only *uses* generic built-in types like these; it
does not define generic types of its own (plan §11.1).

Usually the compiler works the parameters out from the pairs you pass, and
`new Map([['--version', 'git version 2.50.1\n']])` needs nothing more. When the pairs mix
value types it guesses from the first one and then rejects the second, so the test that
cans one string and one Error writes them out: `new Map<string, string | Error>([...])`
(`test/unit/git.test.ts`, "call recording").

## 20. Regular expression literals

*First seen in `test/git/git.git.test.ts`.*

```ts
expect(output).toMatch(/^git version \d+\.\d+/);
expect(error.message).toMatch(/^git not found at \/no\/such\/dir\/git/);
```

Text between two slashes is a **regular expression** — a pattern, in the same language as
`grep -E`. `^` anchors the match to the start of the string; `\d+` is one or more digits;
`\.` is a literal dot (an unescaped `.` matches any character); and because `/` ends the
pattern, a slash inside it is written `\/`. `expect(text).toMatch(pattern)` passes when the
text contains a match, and `.rejects.toThrow(pattern)` checks a rejection's message the same
way.

The tests reach for a pattern only where the exact text is not ours to promise (Apple's git
prints `git version 2.50.1 (Apple Git-155)`) or where a prefix is the whole point (an E17
message must *start* with the path). Everywhere else they compare whole strings with
`toBe`, which fails with a clearer diff.

## 21. Set

*First seen in `src/core/discovery.ts`.*

```ts
const roots = new Set<string>();
roots.add(root);
return Array.from(roots);
```

A `Set` is a collection of values with **no duplicates**: `add` of a value already present
does nothing, and the values are kept in the order they were **first** added. `has(value)`
asks whether one is present, `size` is the count, and `Array.from(set)` copies the values
into an ordinary array in that same order. It is the sibling of `Map` (§19) — keys with no
values — and the right tool whenever the question is "have I seen this before?". In
discovery that question is "is this repository root already in the list?" (E2), and the
Set answers it without an `if` in sight.

`new Set<string>()` carries its type parameter (§19) explicitly because the Set is going
into a brand-new `const`: there is nothing on the left to guess from, and without
`<string>` the compiler would settle on `Set<unknown>` and refuse to hand the values back
as strings. Two other shapes need no annotation, and both appear on this branch. A
collection built from a list, `new Set(['a', 'b'])` or `new Map([[...]])`, is typed by its
contents. And an *empty* collection is fine when it lands somewhere that already has a
type: in `test/helpers/fakeGit.ts`, `forDirectory = new Map()` assigns into a variable the
`get` two lines earlier already typed as `Map<string, string | Error> | undefined`, and in
the unit tests `new FakeGitRunner(new Map())` hands an empty Map to a parameter declared
`Map<string, string | Error>`. In both the compiler takes the type from where the value is
going, and nothing needs writing.

## 22. for ... of, and continue

*First seen in `src/core/discovery.ts`.*

```ts
for (const folder of folders) {
  const output = await git.tryRun(['rev-parse', '--show-toplevel'], folder);
  if (output === null) {
    continue;
  }
  ...
}
```

`for (const item of list) { ... }` runs the body once per element, with `item` bound to
each element in turn — `for f in "$@"; do ...; done` in shell. It works on arrays and on
anything else that can be walked in order (a `Set`, a `Map`, the characters of a string).
`const` is allowed because every pass of the loop gets a fresh `folder`; nothing is ever
reassigned.

`continue` skips the rest of the body and moves on to the next element; `break` (not used
here) would leave the loop altogether. An `await` inside the body is ordinary: the loop
pauses at each git call and resumes when it answers, so the folders are asked one at a
time, in order.

Two look-alikes to keep apart: the older counted form
`for (let i = 0; i < list.length; i++)` appears only when the index itself is needed, and
`for (const key in object)` — `in`, not `of` — walks an object's key names; this codebase
uses neither so far.

## 23. String methods: trim, endsWith, slice

*First seen in `src/core/discovery.ts` (`trim` in `core/git.ts`).*

```ts
if (printedRoot.endsWith('\n')) {
  printedRoot = printedRoot.slice(0, -1);
}
```

Strings carry their own methods, called with a dot like a method on any object:

- `endsWith('\n')` — true when the string ends in that text; `startsWith` is its mirror.
  `'\n'` between quotes is one newline character, as `$'\n'` is in bash.
- `slice(start, end)` — the characters from position `start` up to, but not including,
  `end`. Positions count from 0, and a negative number counts back from the end, so
  `slice(0, -1)` is everything but the last character. Arrays have the same `slice`.
- `trim()` — a copy with whitespace (spaces, tabs, newlines) removed from both ends.
  `core/git.ts` uses it on stderr, where whitespace around the message is noise. Discovery
  deliberately does *not* use it on the path git prints: a directory name may end in a
  space, and `trim()` would eat that along with the newline. When exactly one known
  character has to go, `endsWith` plus `slice` say so precisely.

None of them change the string they are called on — a string, once made, never changes;
each method returns a new one. That is why the code writes `printedRoot =
printedRoot.slice(0, -1)` rather than expecting the variable to change in place.
