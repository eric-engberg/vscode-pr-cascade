# TypeScript primer for this codebase

This file explains each piece of TypeScript syntax **once**, the first time it appears in the
project, in the order a reader following [`reading-order.md`](reading-order.md) meets it.
Code comments point here (`// see primer §3 (functions and type annotations)`) instead of
re-explaining the language. Every PR that introduces a new construct adds a section.
One exception to the order: `src/extension.ts` is read second, for its shape, and again
after the core and `src/vscode/` (reading-order item 2); the constructs it uses are
counted as first seen in the file that introduced them, and its `// see primer` links are
for that second reading.

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
  other Array methods — `filter`, `map`, `sort` — have sections of their own (§25, §26),
  as does `split`, the string method that produces an array in the first place.
- `import type { GitRunner } from './model'` (in `core/git.ts` and `test/helpers/fakeGit.ts`)
  — the `type` keyword says "I only need this name for type-checking". Because interfaces
  vanish at compile time, so does the import; there is nothing for esbuild to bundle. A
  plain `import { GitRunner }` would also work; `import type` states the intent.

An interface can also `extends` another interface. `PrCascadeSettings extends
DiscoveryOptions` (`src/vscode/config.ts`) has every `DiscoveryOptions` field plus its own
three, so a `PrCascadeSettings` can be passed wherever a `DiscoveryOptions` is expected —
`src/extension.ts` hands the settings object straight to `discoverRepoRoots` — and a field
added to `DiscoveryOptions` must be supplied by whatever builds a `PrCascadeSettings`, here
`readSettings`, or it will not compile. This is not §13's `extends` on a class: nothing is
inherited at run time, the interface simply lists the parent's fields as its own.

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
  version of a shell `case` over fixed words. `FileStatus` in `core/model.ts`
  (`'A' | 'M' | 'D' | ...`) and the fixture builder's `trunk?: 'main' | 'master'` work the
  same way.
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

The same `?` on a function parameter means the argument may be left out. In the `Fixture`
interface (`test/helpers/fixture.ts`), `addUnrelatedStack(name?: string): void` lets a test
call `fixture.addUnrelatedStack()` with no name; the class that implements it writes the
same thing with the blank filled in — `addUnrelatedStack(name: string = 'other-work')`, a
default parameter (§13) — so callers may omit the argument and the method always has one.
`FixtureOptions` is an interface made entirely of optional fields, which is what lets
`buildStack({ remote: false })` name only the one thing that differs from the default.

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

export class RealGitRunner implements GitRunner {
  constructor(private readonly gitPath: string = 'git') {}

  run(args: string[], cwd: string): Promise<string> { ... }
}

const error = new GitError({ ... });
const git = new RealGitRunner();
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
- `private readonly gitPath` (`RealGitRunner`) — `private` means only code inside the class
  can read it; without `private` a member is public — the default — and anything holding
  the object may use it. Callers see the public surface (the methods) and nothing else. It
  is declared inside the constructor's parentheses rather than as a line of its own: a
  **parameter property**, which declares the field and fills it from the argument in one
  go — §47 is its section. `GitError` above shows the other way a field is filled, by an
  assignment in the constructor body (`this.exitCode = failure.exitCode`): the value is
  *taken out of* an argument there, not the argument itself.
- `constructor(private readonly gitPath: string = 'git')` — a **default parameter**:
  `new RealGitRunner()` is the same as `new RealGitRunner('git')`. A default combines with
  a parameter property as with any other parameter.
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

A third form, `try` / `finally`, first seen in `test/ext/tree.test.ts` (the E5 test):

```ts
runGit(['checkout', '-q', 'main']);
try {
  const items = await topLevelItems();
  assert.deepStrictEqual(labels, ['Not on a stack']);
} finally {
  runGit(['checkout', '-q', 'retry-metrics']);
}
```

`finally` runs its block on every way out of `try` — the block finished, it `return`ed, or
it threw — and then lets whatever happened carry on (a thrown error keeps travelling up
after `finally` is done). There is no `catch` here on purpose: a failing assertion must
still fail the test, but the fixture must be put back on its branch first, or every test
after this one would start from the wrong place. That is the job of `finally`: undoing a
change the code above it made, whether or not that code succeeded. The three can be
combined (`try` / `catch` / `finally`), but this codebase has not needed to.

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

A pattern is a value with methods of its own, and `src/` uses one — the only regular
expression in `src/` so far: `LINE_COUNT.test(field)` in `core/changes.ts` (`isBinary`,
PR 10) asks whether `field` matches `/^\d+$/` and answers with a plain boolean (§24). It
is the same match `toMatch` makes in a test, called directly. `$` is `^`'s twin: it
anchors the match to the *end* of the string, so `^\d+$` means "digits, and nothing but
digits, from start to end" — `'12'` matches, `'12x'` and `''` do not. The pattern is a
module-level `const` (§4) rather than written inline at the call, so it is built once
and has a name that says what it recognises.

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
here) would leave the loop altogether. A `return` inside the body leaves the loop and the
whole function at once — `detectTrunk` in `core/trunk.ts` stops at the first candidate
that exists this way, so `break` is never needed there. An `await` inside the body is
ordinary: the loop pauses at each git call and resumes when it answers, so the folders are
asked one at a time, in order.

Two look-alikes to keep apart: the older counted form
`for (let index = 0; index < list.length; index++)` appears only when the index itself is
needed (§29 — the fixture builder needs it to pick each layer's file name), and
`for (const key in object)` — `in`, not `of` — walks an object's key names; this codebase
does not use it.

## 23. String methods: trim, endsWith, slice

*First seen in `src/core/discovery.ts` (`trim` in `core/git.ts`).*

```ts
if (printedRoot.endsWith('\n')) {
  printedRoot = printedRoot.slice(0, -1);
}
```

Strings carry their own methods, called with a dot like a method on any object:

- `endsWith('\n')` — true when the string ends in that text. `'\n'` between quotes is one
  newline character, as `$'\n'` is in bash. `startsWith('refs/heads/')` is its mirror:
  true when the string begins with that text (`core/stack.ts` asks it before cutting the
  prefix off, below).
- `slice(start, end)` — the characters from position `start` up to, but not including,
  `end`. Positions count from 0, and a negative number counts back from the end, so
  `slice(0, -1)` is everything but the last character. Leave `end` out and it runs to the
  end of the string: `ref.slice('refs/heads/'.length)` in `core/stack.ts` is everything
  after that prefix (checked first with `startsWith`). Arrays have the same `slice`.
- `trim()` — a copy with whitespace (spaces, tabs, newlines) removed from both ends.
  `core/git.ts` uses it on stderr, where whitespace around the message is noise. Discovery
  deliberately does *not* use it on the path git prints: a directory name may end in a
  space, and `trim()` would eat that along with the newline. When exactly one known
  character has to go, `endsWith` plus `slice` say so precisely.

- `padStart(width, fill)` — a copy padded on the left with `fill` until it is `width`
  characters long: `String(7).padStart(4, '0')` is `'0007'`, `printf '%04d'`.
  `test/git/changes.git.test.ts` (PR 10) numbers 1500 files that way so that git's
  order — by path, byte by byte, the same `<` order as §26 — is the order they were
  made in (`file-0002` before `file-0010`, where `file-2` would sort after `file-10`).
  `String(7)` is §27's `Number` in reverse: number to text.
- `repeat(n)` — the string `n` times over: `'0'.repeat(40)` is forty zeros, a
  40-character SHA no object has (`printf '0%.0s' {1..40}`). `test/git/git.git.test.ts`
  builds its 2 MB argument with it, and `test/git/changes.git.test.ts` (PR 10) its bad SHA.

None of them change the string they are called on — a string, once made, never changes;
each method returns a new one. That is why the code writes `printedRoot =
printedRoot.slice(0, -1)` rather than expecting the variable to change in place.

## 24. boolean

*First seen in `src/core/trunk.ts` (`refExists`).*

```ts
async function refExists(git: GitRunner, root: string, ref: string): Promise<boolean> {
  const output = await git.tryRun(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], root);
  return output !== null;
}

const configuredExists = await refExists(git, root, options.configured);
if (configuredExists) {
  return options.configured;
}
```

`boolean` is the type with exactly two values, `true` and `false`. Every comparison —
`===`, `!==`, `<` and the rest — *is* an expression of that type, so `return output !==
null;` hands back the answer to "did git print something?" directly; there is no need for
an `if` that returns `true` in one branch and `false` in the other. `Promise<boolean>` (§7)
is a yes-or-no, eventually. A variable holding one is named so the `if` reads as a sentence:
`configuredExists`, `targetExists`, `gitSaidNo` (§18).

An `if` takes any boolean, so a variable that *is* one stands alone: `if (configuredExists)`.
Compare that with the explicit checks elsewhere in the codebase — `if (output === null)`,
`if (failure.detail !== undefined)`. Those values are not booleans, and JavaScript would
still accept them in an `if`: it silently treats `0`, `''`, `null` and `undefined` as
false and everything else as true (the "truthy / falsy" rules). That conversion hides
mistakes — an empty string that was a real answer, a `0` that was a real count — so this
codebase writes the comparison out whenever the value is not already a boolean.

For "not", `trunk.ts` writes `if (targetExists === false)`, matching its `=== null`
checks. JavaScript's shorthand is a prefix `!` (`!targetExists`, read "not
targetExists"); it means the same and appears in later PRs where a spelled-out comparison
would only add noise.

## 25. Arrays: split, filter, map, push, length, and a typed empty array

*First seen in `src/core/stack.ts`; `map` in `test/unit/stack.test.ts`.*

```ts
const lines = output.split('\n');
const names = lines.filter((line) => line !== '');

const measured: MeasuredBranch[] = [];
measured.push(branch);
if (measured.length === 0) { ... }

const names = state.layers.map((layer) => layer.name);   // in the tests
```

§9 introduced `string[]`, `join` and `push`. Here are the rest of the array tools this
codebase uses, all of them the same idea as a shell pipeline stage: a list goes in, a list
(or one value) comes out.

- `text.split('\n')` — a string method (§23) that cuts the text at every newline and
  returns the pieces as an array, like reading lines with `IFS=$'\n'`. git ends its last
  line with a newline too, so the last piece is an empty string — which the next line
  removes.
- `list.filter(fn)` — a new array holding only the elements for which `fn` returned true.
  `fn` is an arrow function (§5) with an **expression body**: `(line) => line !== ''` has
  no braces and no `return`; the expression's value is the result. `grep -v '^$'`.
- `list.map(fn)` — a new array of the same length, holding `fn`'s result for each element.
  `layers.map((layer) => layer.name)` turns a list of layers into a list of their names,
  which is how the tests compare the order in one `toEqual`. `awk '{print $1}'`.
- `list.length` — the number of elements; `list[0]` is the first (positions count from 0,
  as with `slice` in §23), `list[1]` the second. Reading past the end gives `undefined`
  rather than an error, so the code checks `length` first where it matters.
- `const measured: MeasuredBranch[] = [];` — an empty array with its type written out.
  The annotation is needed for the same reason `new Set<string>()` (§21) needed one: `[]`
  on its own tells the compiler nothing about what will go in. With it, a later
  `measured.push(...)` of the wrong shape is a compile error.
- `list.includes(value)` — true when `value` is one of the elements, compared with `===`.
  `options.scanIgnoredFolders.includes(entry.name)` in `core/discovery.ts` (PR 7) asks "is
  this name on the ignore list?" — `grep -qxF` over a list. For a large list a `Set` (§21)
  and `has` would be faster; for two or three names an array reads more plainly.
- `text.split(separator)` again, with something other than a newline:
  `output.split(FIELD_SEPARATOR)` — the constant is `'\0'` — in `core/changes.ts` (PR 9)
  cuts `git diff -z` output at every NUL byte (§44). Any
  string works as the separator — it is `cut -d`, not a fixed `IFS`. And as with the
  newline, a separator that ends the text leaves an empty last piece, which is what the
  next method is there for.
- `list.pop()` — removes the last element and returns it: `push` in reverse.
  `core/changes.ts` uses it to drop that empty last piece; the returned value is not
  wanted, so the whole line is `fields.pop();`.
- `columns.slice(2).join('\t')` — `slice` on an *array* (§23 said arrays have it too):
  the elements from position 2 to the end, as a new array; `join` (§9) then glues them
  back into one string with a tab between each. Together they are the shell's
  `cut -f3-`: in `parseNumstat` (`core/changes.ts`, PR 10) a numstat entry is cut at
  every tab, the first two pieces are the two counts, and everything after them — a
  path, which may itself contain tabs — is put back together exactly as it was. `split`
  alone would have been `cut -f3`, and would have lost the rest of such a path.

Which of these change the array they are called on: `push`, `pop`, `shift` (§38) and `sort`
(§26) do; `filter`, `map`, `slice`, `join` and `includes` never do — they return something
new and leave the original as it was, the same rule as for strings in §23.

## 26. sort and comparison functions

*First seen in `src/core/stack.ts`.*

```ts
measured.sort(compareByDistanceThenName);

function compareByDistanceThenName(first: MeasuredBranch, second: MeasuredBranch): number {
  if (first.commitCount !== second.commitCount) {
    return first.commitCount - second.commitCount;
  }
  if (first.name < second.name) {
    return -1;
  }
  if (first.name > second.name) {
    return 1;
  }
  return 0;
}
```

`list.sort(fn)` reorders the array **in place** — `measured` itself is now sorted; nothing
is returned that needs keeping — using `fn` to decide the order of any two elements. It is
`sort -k` with the key written as a function instead of a column number: `fn(first,
second)` returns a **negative** number when `first` belongs before `second`, a **positive**
one when it belongs after, and `0` when they tie. Subtracting two counts gives exactly that
sign, which is what the first `return` does; the name comparison spells the three cases
out.

Two things worth knowing:

- A function is a value like any other, so `sort(compareByDistanceThenName)` hands the
  function over by name, the way `execFile(..., callback)` did in §15 — no parentheses,
  because it is not being *called* here; `sort` will call it, many times.
- **Always give `sort` a comparison function.** With no argument, JavaScript sorts by
  converting every element to text, so `[10, 9, 1]` sorts to `[1, 10, 9]`. It is a
  well-known trap; the function makes the order explicit. Even for plain strings, where the
  default order happens to be right, `src/` spells it out: `childNames.sort(compareByName)`
  in `core/discovery.ts` (PR 7) uses a three-line comparison that orders by character code,
  the same `<` / `>` order the name tie-break below uses — and static analysis (SonarQube
  rule S2871) flags a bare `sort()` precisely because the trap is so common.

The name tie-break uses `<` and `>` on strings, which order by character code — plain, and
the same on every machine. The alternative, `first.name.localeCompare(second.name)`, sorts
the way the user's language does, and could put two branches in a different order on two
developers' machines; the comment on the function says why that was not wanted.

## 27. Number: text to number

*First seen in `src/core/stack.ts` (`measureBranch`).*

```ts
const branchRef = LOCAL_BRANCH_PREFIX + name;
const countOutput = await git.run(['rev-list', '--count', `${trunk}..${branchRef}`], root);
const commitCount = Number(countOutput.trim());
```

(`branchRef` is `refs/heads/<name>` — the comment on `measureBranch` says why the bare
name is not used.)

Everything git prints is text, even when it is a count. `Number('3')` is the number `3`;
the shell never needed this step because `$(( ... ))` converts on the fly, but here
`'3' === 3` is false and `'10' < '9'` is true (text compares character by character), so
the conversion has to be explicit before a count is compared or sorted (§26). `Number`
tolerates surrounding whitespace, so the `trim()` is for the reader, not the machine.

`Number('abc')` gives `NaN` — "not a number", a real value of type `number` that compares
unequal to everything, itself included. Nothing here checks for it because `rev-list
--count` prints only digits, and if git fails it exits non-zero, which `run` turns into a
rejection before any conversion happens. `number` is the only numeric type: there is no
separate integer type, and `3` and `3.0` are the same value.

## 28. The Sync variants of Node's functions

*First seen in `src/core/git.ts` (`existsSync`); throughout `test/helpers/fixture.ts`.*

```ts
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

const output = execFileSync('git', args, { cwd: this.dir, env: { ... }, encoding: 'utf8', ... });
fs.writeFileSync(path.join(repoDir, 'f'), 'base\n');
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-cascade-fixture-'));
const scratchDir = fs.realpathSync(temporaryDir);
```

Node offers most file and process operations twice. The forms used so far in `src/` —
`realpath` from `node:fs/promises` in `core/discovery.ts`, `execFile` wrapped in a Promise
(§15) — hand the work off and let the program continue; `await` collects the result later. The
**`Sync`** forms do the work right there: the call blocks until it is done and returns the
result directly (or throws on failure, with `execFileSync` putting git's stderr into the
error message). Each `Sync` function is the same operation as its non-`Sync` twin, with
the same arguments, so nothing new has to be learned per call.

The extension itself never blocks — VS Code's whole window would freeze for the duration
— so `src/` uses the `Sync` form only for `statSync` and `accessSync` in `core/git.ts`
(`describeDirectoryProblem`), where the answer is instant. The Promise-returning half of
`node:fs` gets its own section when discovery starts reading directories (§39). The fixture builder is setup code: it runs some twenty git commands in
a fixed order and nothing else is waiting, so the `Sync` forms make it a plain list of
steps with no `async`, no `await`, and no Promise to hand back. That is also what lets PR
6's `npm run fixture` script call `buildStack()` as an ordinary function.

Three small Node helpers appear alongside: `path.join(a, b)` glues path pieces with the
platform's separator; `os.tmpdir()` is the system temp directory (`$TMPDIR`);
`fs.mkdtempSync(prefix)` creates a uniquely named directory starting with that prefix, the
same as `mktemp -d`. The `execFileSync` options are commented in the fixture where they
are set — `encoding` (text rather than raw bytes) and `stdio` (close stdin so no command
can wait for input) are the two that matter. A few more of the same kind appear in the
fixture and its test: `fs.rmSync(dir, { recursive: true, force: true })` is `rm -rf`;
`fs.statSync(p).isFile()` is `test -f`; `path.resolve(base, p)` makes a relative path
absolute (`realpath -m`), `path.dirname(p)` is `dirname`, and `path.basename(p)` is
`basename` — the last piece of a path, which `src/vscode/tree.ts` uses for a row's label
(`RepoNode` since PR 6, `FileNode` since PR 11). Three more in
`test/git/changes.git.test.ts` (PR 10): `fs.mkdirSync(p, { recursive: true })` is
`mkdir -p` (the fixture builder uses it too), `fs.copyFileSync(a, b)` is `cp a b`, and
`fs.symlinkSync(target, p)` is `ln -s target p` — the arguments in that order, target
first, exactly as `ln` takes them.

## 29. Counted for loops

*First seen in `test/helpers/fixture.ts` (`buildStack`); counting down, in
`src/vscode/tree.ts` (`nodesForRepo`).*

```ts
for (let index = 0; index < layers.length; index++) {
  const layerName = layers[index];
  const fileName = FILE_NAMES.charAt(index);
  ...
}
```

§22's `for ... of` walks a list without ever naming a position. This older form does name
one: the three parts in the parentheses are *start* (`let index = 0` — a `let`, §4,
because it changes), *keep going while* (`index < layers.length`), and *after each pass*
(`index++`, "add one to index"). It is `for ((i = 0; i < n; i++))` in bash, character for
character. Use it only when the number itself is needed — here it is, twice: to pick the
layer's name from one list and the file's letter from a string (`charAt(index)`, the
character at that position, counted from 0). Everywhere the position is not needed,
`for ... of` says less and is preferred.

The same three parts count down: `for (let index = list.length - 1; index >= 0; index--)`
starts at the last position, keeps going while it is still a valid one (`>= 0`), and
`index--` subtracts one. First seen in `nodesForRepo`, `src/vscode/tree.ts`, where it is
how the layers are listed top-first without touching the array.

## 30. ?? — a default for a missing value

*First seen in `test/helpers/fixture.ts` (`buildStack`).*

```ts
export function buildStack(options: FixtureOptions = {}): Fixture {
  const trunk = options.trunk ?? 'main';
  const withRemote = options.remote ?? true;
```

`a ?? b` is `a` — unless `a` is `null` or `undefined`, in which case it is `b`. An
optional field (§11) that was left out reads as `undefined`, so this is the one-line way
to fill in a default: `${trunk:-main}` in shell. The `= {}` on the parameter (a default
parameter, §13) handles the case where no options object was passed at all, so
`buildStack()` with nothing works too.

The reason it is `??` and not `||` (§18): `||` treats `0`, `''` and `false` as "missing"
as well, because they are falsy (§24). `options.remote ?? true` keeps a caller's
`remote: false`; `options.remote || true` would silently turn it into `true`, and the "no
remote" fixture (E25) could never be built. `??` looks only for the two "nothing" values,
which is what "was this option given?" means. Its sibling `?.` — "read this field only if
the thing before the dot is present" — is not used yet and gets its section when it is.

The same idea on an optional field of an interface (§11) rather than of an options object,
in `describeFailure` (`src/core/git.ts`):

```ts
const problem = failure.detail ?? 'cannot be used as the working directory';
return `${command} could not run: ${failure.cwd} ${problem}`;
```

`GitFailure.detail` is there when Node had something to say about the directory and absent
otherwise; the line reads "the detail, or this wording". M1 spelled it as a `let` with the
default, then `if (failure.detail !== undefined) { problem = failure.detail; }` — four
lines for one fact, and a `let` (§4) for a value that is decided once and never changes.
The idiomatic-TypeScript pass (plan §11.1, §13.2 D39) rewrote it: a value that *has a
default* is a `const` with `??`; the `if` form is kept for a *decision* — `if (node ===
undefined)` in the tree provider, which chooses between two different things to do, is one,
and stays as it is.

## 31. Generics on classes and calls

*First seen in `src/vscode/tree.ts` (`TreeDataProvider<StackNode>`,
`EventEmitter<StackNode | undefined>`); on a call in `src/vscode/config.ts` (`get<string>`)
and `test/ext/tree.test.ts` (`getExtension<ExtensionApi>`).*

```ts
export class StackTreeProvider implements vscode.TreeDataProvider<StackNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<StackNode | undefined>();
  async getChildren(node?: StackNode): Promise<StackNode[]> { ... }
}

const trunk = configuration.get<string>('trunk', '');
const extension = vscode.extensions.getExtension<ExtensionApi>('local.vscode-pr-cascade');
```

§19 introduced type parameters on built-in types: `Map<string, Error>`, `Promise<string>`.
VS Code's API is full of the same idea. `TreeDataProvider<T>` is "a provider of rows of
type `T`" — the interface is written once, for any `T`, and `implements
vscode.TreeDataProvider<StackNode>` fills the blank in: from then on the compiler insists
that `getChildren` returns `StackNode[]` and that `getTreeItem` accepts a `StackNode`,
because that is what the interface says with `T` = `StackNode`. `EventEmitter<T>` is the
same for events: `T` is what `fire` sends and what every listener receives (§32).

The angle brackets can also go on a **call**. Usually the compiler works the type out from
the arguments and nothing is written — `new Map([['a', 'b']])` in §19. Two cases need a
hand:

- `configuration.get<string>('trunk', '')` — VS Code cannot know what type a setting holds
  (it is whatever the user typed into a JSON file), so `get` is generic and we say
  `<string>`. The compiler then treats the result as a `string`, and `readSettings` can
  promise `PrCascadeSettings` without a check. That is a claim, not a check — §41 is
  where the difference matters, and what the same file does about it for a setting that
  is not a string.
- `getExtension<ExtensionApi>(...)` — what an extension's `activate()` returns is the
  extension's own business, so the API declares it as `any` unless told otherwise. This
  is the first `any` this codebase meets, and it is on the API's side (§41 and §42 meet
  two more, both also the API's or the standard library's, never ours); naming the type
  turns `api.provider` back into a checked value (§18: `any` switches checking off).

A class can `implements` more than one interface, comma-separated, as
`StackTreeProvider` does: it is a `TreeDataProvider` *and* a `Disposable` (§32). And as
§19 said: this codebase only *uses* generic types; it defines none (plan §11.1).

## 32. EventEmitter and Event

*First seen in `src/vscode/tree.ts` (`StackTreeProvider`); subscribing in
`src/extension.ts` and `test/ext/tree.test.ts`.*

```ts
private readonly changeEmitter = new vscode.EventEmitter<StackNode | undefined>();
readonly onDidChangeTreeData: vscode.Event<StackNode | undefined>;

constructor(loadStates: () => Promise<RepoState[]>) {
  this.onDidChangeTreeData = this.changeEmitter.event;
}

refresh(): void {
  this.changeEmitter.fire(undefined);
}

// elsewhere:
context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(refresh));
const subscription = provider.onDidChangeTreeData((node) => { received.push(node); });
subscription.dispose();
```

VS Code tells extensions about things that happen — a folder added, a file saved, "your
tree changed" — through **events**, and this is the whole mechanism. An `EventEmitter<T>`
has two halves:

- `.fire(value)` — the *sending* half: notify everyone listening, handing each a `value`
  of type `T`.
- `.event` — the *subscribing* half: a function that takes a **listener** (an arrow
  function, §5, that receives the `value`) and returns a `Disposable`. Calling
  `.dispose()` on that stops listening. `vscode.Event<T>` is the type of this half.

The naming convention is fixed across the API: every event is a field named
`onDidSomething` (or `onWillSomething`), and you subscribe by *calling* it with your
listener — `vscode.workspace.onDidChangeWorkspaceFolders(refresh)` passes the function
`refresh` by name, the way `sort(compareByDistanceThenName)` did in §26. The provider
follows the same convention: the emitter is `private` (only the class may fire it), and
the public field `onDidChangeTreeData` — the name `TreeDataProvider` requires — is its
`.event` half, so VS Code can subscribe and nobody else can fire. Firing `undefined` has
a meaning defined by that interface: "the whole tree changed, ask for the top again".

**Disposable** is anything with a `dispose(): void` method — a subscription, an output
channel, a registered command, the provider itself. Pushing one onto
`context.subscriptions` (in `activate`) hands it to VS Code, which calls `dispose()` on
each when the extension shuts down; that is why `activate` never has to undo anything.

## 33. Function types

*First seen in `src/vscode/tree.ts` (the constructor parameter `loadStates`) and
`src/extension.ts` (`ExtensionApi.refresh`).*

```ts
constructor(loadStates: () => Promise<RepoState[]>) { ... }

export interface ExtensionApi {
  provider: StackTreeProvider;
  refresh: () => void;
}

const provider = new StackTreeProvider(() => loadRepoStates(output));
```

A function is a value (§26), so it has a type, and the type is written with the same
arrow as an arrow function — in a *type* position it describes rather than defines.
`() => Promise<RepoState[]>` reads "a function that takes nothing and returns a Promise
of a `RepoState[]`"; `() => void` is "takes nothing, returns nothing". Parameters go in
the parentheses with their types, `(name: string) => boolean`. So the provider's
constructor accepts *any* function of that shape — the real pipeline in
`src/extension.ts`, or something else in a test — and the interface field
`refresh: () => void` says "an object with a `refresh` you can call".

The value handed to the constructor, `() => loadRepoStates(output)`, is an arrow function
that uses `output` — a variable that belongs to the surrounding `activate`. That is
allowed, and the function keeps `output` alive for as long as it is around, even after
`activate` has returned; the technical name is a **closure**. `function refresh() {
provider.refresh(); }` inside `activate` is the same thing with `provider`. A shell
function that reads a variable set in the script around it is the closest analogy, except
that here the variable survives the script's end.

The provider's second loader (PR 11) is `(root: string, layer: StackLayer) =>
Promise<ChangedFile[]>`, and `src/extension.ts` hands it `(root, layer) =>
loadChangedFiles(output, root, layer)`: an arrow whose two parameters carry no types of
their own, because the compiler takes them from the parameter the arrow is passed to
(§3), and which closes over `output` exactly as the first loader does.

## 34. A union of classes, narrowed with instanceof

*First seen in `src/vscode/tree.ts` (`StackNode`).*

```ts
export type StackNode = RepoNode | LayerNode | MessageNode;

getTreeItem(node: StackNode): vscode.TreeItem {
  return node.toTreeItem();
}

if (node instanceof RepoNode) {
  return nodesForRepo(node.state);
}
```

§10's `|` works on classes too: a `StackNode` is an object of one of these three classes.
On a value of the union you may use only what **every** member has — all three define
`toTreeItem()`, so `node.toTreeItem()` compiles with no check. Anything only one member
has (`node.state` exists on `RepoNode` alone) needs narrowing first, and `instanceof`
(§18, where it told a `GitError` from other errors) is the tool: inside
`if (node instanceof RepoNode)` the compiler treats `node` as a `RepoNode`.

Many TypeScript codebases give each class a `kind: 'repo' | 'layer'` field and narrow on
that instead. `instanceof` was chosen here because it is already known from §18 and needs
no extra field.

The union has since grown a member — `FileNode`, in PR 11: `RepoNode | LayerNode |
FileNode | MessageNode`. Adding it was one line here; what happened elsewhere is the
lesson. `getTreeItem` needed nothing, because the new class has a `toTreeItem` like the
others. `getChildren` needed a new `instanceof LayerNode` branch to list a layer's files —
and had that branch been forgotten, the compiler would *not* have said so, because the
chain of `if`s ends in a `return []` that answers for every kind not named above it, the
new one included. A fall-through like that is convenient and quiet, which is why the
comment on it names the kinds it is meant to cover ("a file or a message"). The compiler
cannot check an `instanceof` chain for completeness: dropping the `return []` only makes
it refuse the function outright (TS2366, "Function lacks ending return statement…"),
whether or not every kind is handled, because it never treats such a chain as having
covered the whole union. A completeness check is what the other pattern above — a `kind`
field and a `switch` over it — would buy; that construct belongs to the PR that first
needs it. With `instanceof`, the comment on the fall-through is the check.

## 35. Enum values from the VS Code API

*First seen in `src/vscode/tree.ts` (`vscode.TreeItemCollapsibleState.None`).*

```ts
new vscode.TreeItem(this.layer.name, vscode.TreeItemCollapsibleState.None);
new vscode.TreeItem(path.basename(this.state.root), vscode.TreeItemCollapsibleState.Expanded);
```

An **enum** is a named set of constants. `TreeItemCollapsibleState` has three members —
`None` (a leaf row), `Collapsed` (has children, shown folded) and `Expanded` (has children,
shown open) — and a value of that type must be one of them, written
`vscode.TreeItemCollapsibleState.None`; a misspelt name is a compile error, and so is a
number that is not one of the members' values — though a bare `1` slips through, which is
one reason to always write the name. It is the same job the exact-string unions of §10 do
(`FileStatus`, `StartFailure`), which is why this codebase uses the API's enums where the
API demands them and defines none of its own (plan §11.1). All three members are in use
since PR 11: a `LayerNode` is `Collapsed` — it has children, its files, and starts
folded — a `FileNode` and a `MessageNode` are `None`, a `RepoNode` is `Expanded`.

## 36. export const: a shared constant object

*First seen in `src/core/discovery.ts` (`DEFAULT_DISCOVERY_OPTIONS`).*

```ts
export const DEFAULT_DISCOVERY_OPTIONS: DiscoveryOptions = {
  scanMaxDepth: 1,
  scanIgnoredFolders: ['node_modules'],
};

export async function discoverRepoRoots(
  folders: string[],
  git: GitRunner,
  options: DiscoveryOptions = DEFAULT_DISCOVERY_OPTIONS,
): Promise<string[]> { ... }
```

§4's `const` and §1's `export` together: a value built once, when the module is first
loaded, and visible to other files by name. `MAX_OUTPUT_BYTES` in `core/git.ts` was a
`const` too, but a private number; this one is an *object*, and shared.

- The type is written out, `: DiscoveryOptions`, although the compiler could infer
  `{ scanMaxDepth: number; scanIgnoredFolders: string[] }` from the literal on its own. The
  annotation makes the compiler check the literal *against the interface* (§9) right
  here — a misspelt or missing key is an error at the definition, not at some call site
  — and it tells the reader what the object is for.
- `const` fixes the name, not the contents (§4): `DEFAULT_DISCOVERY_OPTIONS.scanMaxDepth
  = 2` would compile, and would change the default for every later call. The codebase
  relies on the obvious rule — nobody assigns into it — rather than the compiler-enforced
  version, `readonly` (§14) on each field of the interface, because the object is two
  fields long and read from two places.
- It is the **default parameter** (§13) of `discoverRepoRoots`: a call with two arguments
  gets this object as its third. Every such call is handed *the same* object, not a copy,
  which is only safe because nothing changes it. The old two-argument call in
  `src/extension.ts` kept compiling when the parameter was added — that is the point of a
  default.

Why export it at all: PR 8's `src/vscode/config.ts` uses the same values as the
fallbacks when it reads the settings, so the defaults live in one file and the Settings
UI, the code and the tests cannot disagree.

## 37. Promise.all

*First seen in `src/core/discovery.ts` (`discoverRepoRoots`).*

```ts
const probes = candidates.map((candidate) => git.tryRun(['rev-parse', '--show-toplevel'], candidate));
const outputs = await Promise.all(probes);
```

§6's `await` pauses at *one* Promise. Until now every git call was awaited where it was
made, one after another: `for (const folder of folders) { const output = await
git.tryRun(...); }` asks about the second folder only after the first has answered. Here
the calls are all *started* first, with no `await` — `map` (§25) calls `tryRun` once per
candidate and collects the Promises (§7) it returns, each one a git process already
running — and `Promise.all(list)` is a single Promise that resolves when every Promise in
the list has, with their values in the same order as the list. Twenty candidates take
about as long as one. The shell version:
`for d in ...; do git -C "$d" rev-parse --show-toplevel & done; wait`.

Two rules follow. **Order**: `outputs[3]` is the answer for `candidates[3]` whatever order
the processes finished in, so the loop after it can read the answers in candidate order.
**Failure**: if any Promise in the list rejects, `Promise.all` rejects at once with that
error and the other results are discarded (their processes still run to the end; nothing
waits for them). That is exactly what discovery wants for E17 — a missing git fails every
probe the same way, and the first rejection is the whole story — and it is the thing to
check before reaching for `Promise.all` anywhere else: when one failure should *not*
discard the rest, `Promise.allSettled` (not used yet) reports every outcome separately.

The types: `probes` is `Promise<string | null>[]`, a list of Promises; `Promise.all`
turns it inside out into `Promise<(string | null)[]>`, a Promise of a list; `await`
unwraps that to `(string | null)[]`.

## 38. while loops and a queue

*First seen in `src/core/discovery.ts` (`listCandidates`).*

```ts
const queue: PendingDirectory[] = [{ directory: folder, depth: 0 }];
while (queue.length > 0) {
  const current = queue.shift();
  if (current === undefined) {
    break;
  }
  ...
  queue.push({ directory: path.join(current.directory, name), depth: current.depth + 1 });
}
```

`while (condition) { ... }` repeats the body as long as the condition holds, checking it
before each pass — `while [ ... ]; do ...; done`. §22's `for ... of` walks a list that
exists up front; `while` is for when the amount of work is not known in advance. Here the
list is a **queue**: `shift()` removes the first element and returns it (§9's `push` adds
at the end), so elements come out in the order they went in, and the body adds more as it
goes. Started with the workspace folder, taking one directory off the front and pushing its
children onto the back, the queue empties one *level* at a time — the folder, then all of
depth 1, then all of depth 2 — a breadth-first walk, which is why a depth limit can be a
plain comparison on each entry.

The `undefined` check: `shift()` on an empty array returns `undefined`, so its type is
`PendingDirectory | undefined` (§10), and the compiler does not connect that with the
`length > 0` one line above — it follows checks on the *value* (§8), not reasoning about
the array. The `if` proves the value is present, and `break` (§22 mentioned it) leaves the
loop; it can never actually run. It is the honest cost of a queue in TypeScript. The
alternative — `queue.shift()!`, a `!` that tells the compiler "trust me, it is there" —
is not used in this codebase: a claim the compiler cannot check is a claim that goes
stale.

`depth: current.depth + 1` builds each child's entry (an object literal, §16) one level
deeper than its parent's.

A second shape of `while`, in `core/changes.ts` (`parseNameStatus`, PR 9): the list exists
up front, but its entries are two fields long or three (a rename carries two paths), so
`for ... of` cannot walk it one *entry* at a time. An index starts at 0; the body reads the
fields at `index` and `index + 1` (and `index + 2`), then moves the index past them by hand
— `index = index + 2`, or `+ 3` — and the loop runs while `index < fields.length`. It is
§29's counted loop with a step decided inside the body, which the `for (...; ...; index++)`
header cannot express. JavaScript also has the shorthand `index += 2`; it is not used here,
so the step reads as the arithmetic it is.

## 39. Node's Promise-returning file-system calls: readdir and Dirent

*First seen in `src/core/discovery.ts` (`listCandidates`); `fs.realpath` in the same file
since PR 3.*

```ts
import type { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';

let entries: Dirent[];
try {
  entries = await fs.readdir(current.directory, { withFileTypes: true });
} catch {
  continue;
}
for (const entry of entries) {
  if (entry.isDirectory() === false) {
    continue;
  }
  ...
}
```

§28 covered the `Sync` forms; these are the other half. `node:fs/promises` offers the
same operations returning Promises (§7), so `await fs.readdir(...)` hands the work to the
operating system and pauses only this function (§6) — the extension stays responsive —
where `fs.readdirSync` would block VS Code's whole extension host until the disk answered.
`src/` uses this half everywhere but the two instant directory checks in `core/git.ts`
(`statSync`, `accessSync` — §28); the fixture builder, which is setup code, uses the
`Sync` forms throughout.

`readdir` is `ls -A`: the names in a directory, no `.` or `..`, no path in front. With
`{ withFileTypes: true }` each result is a **`Dirent`** (directory entry) instead of a bare
name: `entry.name`, plus questions about what it is — `isDirectory()`, `isFile()`,
`isSymbolicLink()` — answered from the listing itself, with no `stat` call per entry. The
questions are about the entry *itself*: a symbolic link answers yes to `isSymbolicLink()`
and no to `isDirectory()`, whatever it points at, which is how discovery skips links with
no second call. `Dirent` is imported with `import type` (§9) from `node:fs` — the type
lives in the base module, the Promise functions in `/promises` — for one purpose: the
`let entries: Dirent[];` line, §4's declare-then-assign form. The value is assigned inside
`try`, so the type has to be written; the compiler then checks that every path out of the
`try`/`catch` (§18) either assigned it or left the loop.

`readdir` rejects — so the `await` throws — when the directory does not exist, is not a
directory, or cannot be read; discovery treats all three alike and skips what is below.
`path.join(a, b)` (§28) makes each child's full path from its parent's and its name.

## 40. A sentinel value: -1 for "no limit"

*First seen in `src/core/discovery.ts` (`DiscoveryOptions.scanMaxDepth`, `listCandidates`).*

```ts
const childrenWanted = current.depth < options.scanMaxDepth || options.scanMaxDepth === -1;
```

Not syntax: a convention. A **sentinel** is an ordinary value given a special meaning —
here `-1` for "no depth limit", which works because no real depth is negative. The
alternatives were a union (§10), `number | null` with `null` meaning unlimited, or
`Infinity` (a real JavaScript number, larger than every other, and `depth < Infinity` is
always true). `-1` was kept because the setting this option comes from (PR 8) must mean
the same as VS Code's own `git.repositoryScanMaxDepth`, where `-1` already means that —
and because a settings file is JSON, which can hold `-1` and cannot hold `Infinity`.

The cost of a sentinel is that every comparison has to remember it — hence the
`|| === -1` — and that values with no meaning are still valid numbers: `-5` here behaves
like `0`, and nothing in the type says otherwise. The settings reader in
`src/vscode/config.ts` (§41) is where such a value is turned back into the default,
because settings are typed by hand. When the special case is ours to design, a union or
`null` says it in the type instead, and the compiler does the remembering.

## 41. Checking a value the compiler cannot vouch for: `get<unknown>`, `Number.isInteger`, `Array.isArray`

*First seen in `src/vscode/config.ts` (`readScanMaxDepth`, `readScanIgnoredFolders`).*

```ts
import { DEFAULT_DISCOVERY_OPTIONS } from '../core/discovery';

const value = configuration.get<unknown>('repositoryScanMaxDepth', DEFAULT_DISCOVERY_OPTIONS.scanMaxDepth);
if (typeof value !== 'number') {
  return DEFAULT_DISCOVERY_OPTIONS.scanMaxDepth;
}
if (Number.isInteger(value) === false || value < -1) {
  return DEFAULT_DISCOVERY_OPTIONS.scanMaxDepth;
}
return value;
```

Three things here, in the order they appear.

**The import.** `'../core/discovery'` is a path (§1): `..` climbs from `src/vscode/` to
`src/`, then into `core/`. `src/vscode/tree.ts` already imported from core, but only
types (`import type`, §9), which vanish at compile time; this is the first *value* — an
object that exists when the extension runs — to cross from core into vscode. The
direction is the one §2 allows: vscode may depend on core, core never on vscode, and the
lint rule enforces the half that could go wrong. It is also why the defaults live in core
(§36): the file that reads the settings imports them from the file that uses them, never
the other way round.

**`get<unknown>`.** §31 said `configuration.get<string>('trunk', '')` makes the compiler
treat the result as a `string`. That is a *claim*: the annotations never run (the top of
this file), so `get<number>` would not turn the `"1"` or `1.5` a user typed into
settings.json into a valid number — it would only stop the compiler from asking. For a
string setting the claim costs nothing: any string is usable, and a wrong one fails where
it is used, with a message. For a number with rules — a whole number, `-1` or more — a
wrong claim is a wrong answer with no error: `-5` would reach the scan and behave as `0`
(§40). So the code says `<unknown>` (§18) instead: the compiler now refuses `value < -1`
and `return value` until the code has proved what `value` is, and the checks that follow
are not optional.

**The checks.** `typeof value !== 'number'` is §17's narrowing turned round: once that
`if` has returned, the compiler knows `value` is a `number`. `Number.isInteger(value)`
asks "a whole number?" — §27 said `number` is the only numeric type and `3` and `3.0` the
same value, so whether a value is an integer is a run-time question, and this is the
function that asks it (it also answers no to `NaN` and `Infinity`). It returns a plain
boolean, hence `=== false` rather than `!`, as §24 says the codebase writes it. `value <
-1` is the floor package.json declares as `minimum`, checked again here because VS Code's
Settings editor underlines a value that breaks a declared `minimum` and stores it anyway.

The list setting adds one more tool:

```ts
const value = configuration.get<unknown>('repositoryScanIgnoredFolders', DEFAULT_DISCOVERY_OPTIONS.scanIgnoredFolders);
if (Array.isArray(value)) {
  const entries: unknown[] = value;
  const names: string[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      names.push(entry);
    }
  }
  return names;
}
return Array.from(DEFAULT_DISCOVERY_OPTIONS.scanIgnoredFolders);
```

`Array.isArray(value)` is the `typeof` for lists — `typeof []` is `'object'`, no help —
and, like `instanceof` in §18, it narrows: inside the `if`, `value` is a list. But the
compiler can only call it a list *of anything*, `any[]` — the second `any` this codebase
meets (§31 had the first), and again on the standard library's side, not ours. `const
entries: unknown[] = value;` is the repair: a list of `any` may be assigned to a list of
`unknown`, and from then on every element has to be checked before it is used — the
`typeof entry === 'string'` inside the loop (§22). The `if` is written the positive way
round, with the default *after* the block, where the function above returned early on
the failing case: the two read the same, and here the list branch is the long one, so it
is the one that gets the block.

The default is handed out as a copy — `Array.from(list)` copies an array the way it copied
a Set in §21 — rather than as the shared object itself. `DEFAULT_DISCOVERY_OPTIONS` is one
object for the whole session, `discoverRepoRoots` falls back to it too, and a `string[]`
can always be `push`ed onto (§25). Nothing pushes onto the settings' list today; the copy
makes sure that if something ever does, it changes that refresh's list and not the default
every later refresh starts from.

## 42. Changing the workspace from a test: updateWorkspaceFolders, Uri.file, and waiting for an event

*First seen in `test/ext/scanSettings.test.ts`.*

```ts
const changed = nextWorkspaceFoldersChange();
const accepted = vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(parentDir) });
assert.strictEqual(accepted, true);
await changed;

function nextWorkspaceFoldersChange(): Promise<void> {
  return new Promise((resolve) => {
    const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      subscription.dispose();
      resolve();
    });
  });
}
```

- **`vscode.Uri.file(path)`** — VS Code names everything by URI, not by path: a workspace
  folder is `file:///private/tmp/...`, and later the two sides of a diff will be
  `stackdiff:` URIs (plan §7.4). `Uri.file` builds the URI for a local path; `.fsPath`,
  which `src/extension.ts` already reads off each workspace folder, goes the other way.
  Its first use in shipped code is PR 11's `FileNode.toTreeItem` (`src/vscode/tree.ts`):
  `item.resourceUri = vscode.Uri.file(path.join(root, file.path))`. `resourceUri` is the
  `TreeItem` field that says "this row *is* that file" — VS Code then draws the icon the
  user's icon theme has for the file type and applies its file decorations, and the code
  needs to know nothing about either. `test/ext/tree.test.ts` reads the `.fsPath` back
  off the drawn row and compares it with the path it expects.
- **`updateWorkspaceFolders(start, deleteCount, ...toAdd)`** — one call that removes
  `deleteCount` folders at position `start` and inserts the ones given, so it adds
  (`(folders.length, 0, { uri })`), removes (`(index, 1)`) or replaces. It returns `true`
  or `false` *at once* — whether the change was accepted; a folder already present is
  refused — and applies it a moment later. Then `onDidChangeWorkspaceFolders` fires, the
  same event `src/extension.ts` refreshes the tree on, and the API's own note says not to
  call it again before that event has fired. Two things make it usable from a test: the
  workspace `.vscode-test.mjs` opens is a `.code-workspace` file, so the change is an edit
  to that file — adding a folder to a *single-folder* window turns it into a new
  multi-root workspace and reloads the window, with the test run inside it — and the
  folder is added at the end, because changing the first folder can restart the
  extension host too.
- **Waiting for an event with `new Promise`** — §15 wrapped a callback; here the same
  shape wraps an event. The Promise resolves when the listener runs, and the listener
  first removes itself (`subscription.dispose()`, §32) so it fires once. The order
  matters: the Promise is *made* before `updateWorkspaceFolders` is called and *awaited*
  after — a listener attached after the change could miss the event, and a Promise that
  never resolves would hang the test until Mocha's timeout.

Two smaller things in the same file. Mocha's **`after`** hook is `before`'s twin: it runs
once when every test in the block is done, pass or fail, and here undoes what `before`
did — settings back to their defaults, the folder out of the workspace, the repositories
off disk — so the file that runs next meets the workspace as built. And
**`extension.packageJSON`** is `package.json` as VS Code read it, declared `any` by the
API like `activate()`'s result in §31; `const manifest: ExtensionManifest =
extension.packageJSON;` puts it under a written type from that line on. `ExtensionManifest`
is an interface (§9) whose fields are themselves object shapes, written inline between
braces instead of being named, with the two dotted keys in quotes because a bare
`prCascade.repositoryScanMaxDepth` would be read as a path through three fields. Reading
such a field uses the same square brackets as an array index (§25, `list[0]`) with the key
as a string — `properties['prCascade.repositoryScanMaxDepth'].default` — because
`properties.prCascade.repositoryScanMaxDepth` would again be three steps; `object['name']`
and `object.name` are one operation written two ways, and the bracket form is the one that
takes any string. Like every claim about an `any`, it is checked at run time by the
assertion, not by the compiler.

## 43. `keyof` and `Record<K, V>`: an object with exactly another type's fields

*First seen in `test/ext/scanSettings.test.ts`.*

```ts
const declared: Record<keyof DiscoveryOptions, unknown> = {
  scanMaxDepth: properties['prCascade.repositoryScanMaxDepth'].default,
  scanIgnoredFolders: properties['prCascade.repositoryScanIgnoredFolders'].default,
};
```

- **`keyof DiscoveryOptions`** is a type made from another type: the union (§10) of its
  field names — here `'scanMaxDepth' | 'scanIgnoredFolders'`. It is not written out by
  hand, so when a field is added to the interface this union grows with it.
- **`Record<K, V>`** is a built-in generic type (§31, like `Promise<T>`): "an object that
  has every key in `K`, each holding a `V`". So `Record<keyof DiscoveryOptions, unknown>`
  reads "an object with exactly the fields of `DiscoveryOptions`, each holding anything".
  Plain `const declared: DiscoveryOptions` cannot be written here: the values come out of
  package.json as `unknown` (§18, §41), and the compiler refuses `unknown` where a
  `number` is wanted. This spelling keeps the values `unknown` — `deepStrictEqual` still
  does the comparing — and pins only the set of keys.
- **Why it is there.** The object literal mirrors the interface's fields by hand. Without
  the annotation, a third field added to `DiscoveryOptions` leaves this literal two fields
  short and `tsc` says nothing; the mismatch only shows up when the extension-host suite
  runs inside VS Code. With it, `npm run typecheck` reports the missing field (`Property
  'x' is missing in type ...`) and a misspelled one (`... does not exist in type ... Did
  you mean ...?`). It is the same idea as `implements` in §13: a link the compiler checks,
  instead of a copy kept up by hand.

## 44. Escape sequences in string literals: `\0`

*First seen in `src/core/changes.ts` (`FIELD_SEPARATOR`); throughout
`test/unit/changes.test.ts`.*

```ts
const FIELD_SEPARATOR = '\0';
const fields = output.split(FIELD_SEPARATOR);

const output = 'R100\0src/old.ts\0src/new.ts\0';   // in the tests
```

Inside quotes a backslash starts an **escape**: a way to write a character that cannot be
typed as itself. §23 met `'\n'`, one newline. The others this codebase uses: `'\t'`, a
tab; `'\''`, a quote inside single quotes; and `'\0'`, the **NUL byte** — character code
zero, the byte C uses to end a string, and so the one byte a file name can never contain.
That last fact is why `git diff -z` (plan §5) separates its fields with it, and why
`parseNameStatus` can cut on it and trust every piece to be a whole path. (A backslash
meant as itself is doubled, `'\\'`; no string in this codebase needs one yet.)
The spellings are bash's `$'\n'`, `$'\t'`, `$'\0'` — with one difference: bash cannot
*hold* a NUL in a variable (which is why shell scripts reach for `xargs -0` and
`tr '\0' '\n'`), while a JavaScript string holds it like any other character:
`'a\0b'.length` is 3.

Two things to know. The tests write git's output as literals, so `'A\0added.txt\0'` in the
source *is* the twelve bytes git printed — `A`, a NUL, the nine of `added.txt`, a NUL —
the format is specified by example. And a `\0` directly followed by a digit, `'\01'`, is
read as an old octal escape,
which strict mode forbids and the compiler rejects; none of the paths in the tests start
with a digit, and if one must, `'\u0000'` (the same byte by its Unicode number, always
unambiguous) or a `+` between two strings avoids it. Last, the same `\0` inside a *regular
expression* (§20) is a lint error (`no-control-regex`, recorded in plan §13.4); the
codebase splits on the byte and never matches it.

The same escape works the other way round, too: `test/git/changes.git.test.ts` (PR 10)
writes `'PNG\0not a real picture\0'` *to a file*, and the `\0`s land on disk as real NUL
bytes — which is exactly what makes git call that file binary (E10).

## 45. Narrowing a `string` to an exact-string union with `===`

*First seen in `src/core/changes.ts` (`toFileStatus`).*

```ts
function toFileStatus(statusField: string): FileStatus {
  const letter = statusField.charAt(0);
  if (letter === 'A' || letter === 'M' || letter === 'D' || letter === 'T' || letter === 'R' || letter === 'C') {
    return letter;
  }
  throw new Error(`git diff --name-status printed an entry with the unknown status "${letter}" ...`);
}
```

§10 defined `FileStatus` as six exact strings, and every earlier narrowing — §8 against
`undefined`, §17 with `typeof`, §18 with `instanceof` — proved which *kind* of value
something was. A comparison with `===` against a literal narrows too, to that one *value*:
inside `if (letter === 'A')` the compiler knows `letter` is exactly `'A'`, and with the six
comparisons joined by `||` it knows, inside the block, that `letter` is one of the six —
which is what `FileStatus` is. So `return letter` compiles there, where
`return statusField.charAt(0)` at the top of the function would not: `charAt` gives a
`string`, a `string` might be `'X'`, and the compiler refuses to call it a `FileStatus`
until the code has checked.

This is the boundary between the outside world and the typed inside. Text from git crosses
it exactly once, checked, and from then on every `status === 'R'` in the codebase is a
comparison against a closed list the compiler knows: misspell it as `'r'` and the compiler
reports it (`This comparison appears to be unintentional because the types ... have no
overlap`), because `'r'` is not in the union. `if (status === 'R' || status === 'C')` in
`parseNameStatus` is the same narrowing again, on a value that is already a union, down to
the two members that carry an `oldPath`.

The `throw` after the `if` is not decoration. Without it the function could reach its end
without returning, and the compiler says so (`Function lacks ending return statement`).
`throw new Error(message)` builds an error carrying a message and throws it — §18 re-threw
one it had caught; the fake runner (§19) builds its own the same way — and whoever called,
up the chain, gets it: `parseNameStatus`, then `changedFiles`, then the tree (PR 11), which
shows the message under the layer. Because a `throw` is how an `async` function's Promise
rejects (§7), the test for it is a plain `expect(() => parseNameStatus(output)).toThrow(...)`
on the synchronous function and `rejects` on the asynchronous one.

## 46. A cache: a Map keyed by two values joined into one string, and `clear`

*First seen in `src/vscode/tree.ts` (`StackTreeProvider.filesByCommitPair`, `filesForLayer`,
`refresh`).*

```ts
private readonly filesByCommitPair = new Map<string, ChangedFile[]>();

const key = `${node.layer.parentSha}:${node.layer.sha}`;
let files = this.filesByCommitPair.get(key);
if (files === undefined) {
  try {
    files = await this.loadFiles(node.root, node.layer);
  } catch (error) {
    ...
    return [new MessageNode(message, 'error')];
  }
  this.filesByCommitPair.set(key, files);
}
return files.map((file) => new FileNode(node.root, file));

refresh(): void {
  this.filesByCommitPair.clear();
  this.changeEmitter.fire(undefined);
}
```

No new syntax — §19's `Map`, §12's template string, §8's narrowing — but a pattern worth
naming: a **cache**, "ask once, remember the answer". Four things in it.

- **The key.** A `Map` has one key per entry, and the answer here depends on two things,
  the parent's SHA and the layer's. The plain way to make one key from two values is to
  join them into one string with a separator between: `${parentSha}:${sha}`. Without a
  separator `ab` + `c` and `a` + `bc` would both become `abc`; with one, the same collision
  needs the separator inside a value — `a:b` + `c` and `a` + `b:c` both become `a:b:c` — so
  it must be a character the values cannot contain. A SHA is hexadecimal digits only (forty
  of them; sixty-four in a SHA-256 repository) and never a colon, so here it is safe; with
  paths or free text it would not be, and the comment on the field should always say why
  the separator is fine.
- **The lookup and the fill.** `get` answers `undefined` for a key it has not seen (§19);
  the `if` computes the answer and `set`s it for next time. Note the `let files` (§4): its
  type is `ChangedFile[] | undefined`, from `get`, and after the `if` the compiler treats
  it as a `ChangedFile[]` — on the path through the `if` it was assigned one (or the
  function returned), on the path around it it was never `undefined`. §8's narrowing,
  applied by an assignment rather than a check; nothing has to be written for it.
- **What is not cached.** The `set` comes after the `try` / `catch` (§18), so a failure
  leaves the map untouched and the next open of the layer asks git again. A cached error
  would be an error the user could never get rid of.
- **`clear()`** empties the map. §19's list of `Map` methods did not need it; a cache does.
  Why it is called at all is the interesting part, and the comment on the field says it:
  the key names two exact commits, and the same two commits always have the same diff, so
  an entry can never be *wrong* — a branch that moved has a new SHA, hence a new key. The
  map is emptied on refresh for the other reason a cache is emptied: memory. Without it a
  window kept open for a week would hold every list it ever showed. A cache whose keys
  name the content they were computed from ("content-addressed", as git's own object
  store is) is the easy kind to get right; the hard kind is one keyed by a *name* whose
  meaning changes, and that kind this codebase avoids.

## 47. Parameter properties

*First seen in `src/core/git.ts` (`RealGitRunner`); then in every class of
`src/vscode/tree.ts`, and in `test/helpers/fakeGit.ts` and `test/helpers/fixture.ts`.
Added by the idiomatic-TypeScript pass (plan §11.1, §13.2 D39), which rewrote the eight
constructors M1 and M2 had written the long way.*

```ts
export class RealGitRunner implements GitRunner {
  constructor(private readonly gitPath: string = 'git') {}
}
```

Writing `private`, `readonly`, `public` or `protected` in front of a constructor parameter
makes it a **parameter property**: the compiler declares a field with that name and type
*and* assigns the argument to it, before the constructor body runs. The one line above
means exactly this, which is how every class in M1 and M2 was written until this section
existed:

```ts
export class RealGitRunner implements GitRunner {
  private readonly gitPath: string;

  constructor(gitPath: string = 'git') {
    this.gitPath = gitPath;
  }
}
```

The long form is not wrong; it is what TypeScript compiles the short one into. But nobody
writing TypeScript writes it: it spells the field's name three times and its type twice, and
the two copies can drift (a field renamed, a `this.gitPath = gitPath` left behind for the
old name). The plan's rule (§11.1) is that the code look like what a TypeScript developer
writes and that the *primer* carry the explanation; this section is that explanation.

What to know:

- **The modifier is what makes it a field.** `constructor(gitPath: string)` is an ordinary
  parameter: a local name, gone when the constructor returns. `constructor(private readonly
  gitPath: string)` is a field of the object, readable as `this.gitPath` in every method.
  Nothing else about the line changes.
- **`readonly` on its own means public and read-only.** `LayerNode` in `src/vscode/tree.ts`
  is `constructor(readonly root: string, readonly layer: StackLayer) {}`: with no `private`,
  the field is public — the default for a class member (§13) — and `readonly` says anyone
  may read it and nobody may assign it (§14). The provider reads them from outside the
  class — `node.state` in `getChildren`, `node.root` and `node.layer` in `filesForLayer` —
  on exactly that promise. `private readonly` (the runner's `gitPath`, the provider's two
  loaders and its output channel, the fake's `responses`) is the field nobody outside the
  class sees. Each converted class kept the visibility its fields had.
- **A default value works as before.** `= 'git'` is §13's default parameter; the field takes
  the default when no argument is passed.
- **The doc comment goes on the parameter.** A field's comment used to sit above its
  declaration, `/** ... */ private readonly gitPath: string;`. The declaration is now inside
  the parentheses, so that is where the comment goes, one parameter per line; editors show
  the comment attached to the declaration when you hover `this.gitPath`, wherever the
  declaration is. Read a constructor's parameter list as the class's field list.
- **Order, when a class has other fields too.** `StackTreeProvider` (`src/vscode/tree.ts`)
  mixes the three kinds: fields with an initialiser (`private readonly changeEmitter = new
  vscode.EventEmitter(...)`), parameter properties, and a body line
  (`this.onDidChangeTreeData = this.changeEmitter.event`). They run in that order — the
  initialisers, then the parameter-property assignments, then the body — in both `tsc`'s
  output and esbuild's (checked while writing this). That is the order under this project's
  ES2022 target, where fields follow JavaScript's own class-field rules (`tsconfig.json`
  `target`); TypeScript's older emit assigned the parameter properties first, which is what
  an older answer online will say. An initialiser may therefore not read a parameter
  property; the compiler refuses it (`Property 'x' is used before its initialization`). The
  body may read everything.
- **Named after the field, not the caller's variable.** A parameter property's name *is* the
  field's name. `StackFixture` in `test/helpers/fixture.ts` implements the `Fixture`
  interface, whose field is `dir`, so the parameter is `readonly dir: string` even though
  `buildStack` passes a variable called `repoDir` into it — arguments are positional, so the
  call site did not change, and the comment on the parameter says so.
- **What it does not replace.** `GitError` keeps its long form: its constructor takes *one*
  `GitFailure` object and copies seven fields out of it, and `constructor(private readonly
  failure: GitFailure)` would be a different class — one field holding an object, not seven
  fields implementing the interface. A parameter property says "this argument *is* this
  field", and nothing else.

## 48. The conditional expression: `condition ? a : b`

*First seen in `src/core/git.ts` (`RealGitRunner.run`). Added by the same pass as §47.*

```ts
const exitCode = typeof error.code === 'number' ? error.code : null;
const startFailure = classifyStartFailure(error);
const detail = exitCode === null && startFailure === null ? error.message : undefined;
```

`condition ? a : b` is an *expression* — a thing with a value — and its value is `a` when
the condition holds and `b` when it does not. Only the chosen side is evaluated. It is the
`if` of values: `if` (§8) chooses which statements *run*; `? :` chooses which value
something *is*. Shell has no exact equivalent — `[ cond ] && a || b` is the nearest, with
its known trap when `a` itself fails.

The first line reads "`exitCode` is `error.code` if that is a number, otherwise `null`". M1
wrote it as a `let` and an `if`:

```ts
let exitCode: number | null = null;
if (typeof error.code === 'number') {
  exitCode = error.code;
}
```

Same value either way; but the `let` form says "`exitCode` starts as `null` and may then
become something else", when what is meant is "`exitCode` is one of two things, decided
here". With `? :` it is a `const` (§4) that never changes after its line — the compiler holds
it to that — and its type is worked out from the two sides, `number | null` (§10), without
being written. The narrowing (§17) still applies: on the `?` side the compiler knows
`error.code` is a `number`. The third line is the same shape with a two-part condition and
`undefined` as the "otherwise" (the `detail` field is optional, §11).

When it fits and when it does not. It fits a value that is one of *two* things, decided on
one line. It does not fit three or more choices (`a ? b : c ? d : e` is legal and
unreadable — write `if`s or a lookup), a side that *does* something rather than *is*
something (`ok ? save() : warn()` is two statements wearing an expression's clothes — write
the `if`), or a condition long enough that the `?` gets lost in it. The `.mjs` tooling
scripts used it before `src/` did (`scripts/depcheck.mjs`: `match === null ? null : ...`),
which this primer's introduction allows for.

On the name: TypeScript's documentation calls `? :` the **conditional operator**, and
everyone else the **ternary** (the language's only three-part operator); "conditional
expression" here means the whole `condition ? a : b`. It is unrelated to *conditional types*
(`T extends U ? X : Y`), a type-level construct the style rules (plan §11.1) keep out of this
codebase.
