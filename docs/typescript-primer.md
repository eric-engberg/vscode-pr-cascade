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
its own. We do not rely on `this` in this codebase, so treat the two forms as interchangeable
and use arrows for callbacks, `function` for anything exported.

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
