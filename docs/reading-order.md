# Reading order

Which files to open first and why. Each PR updates this list so it always describes the
codebase as it is now, not as it was scaffolded. The TypeScript syntax you meet along the way
is explained, in this same order, in [`typescript-primer.md`](typescript-primer.md).

The plan every file header cites by section is [`pr-cascade-plan.md`](../pr-cascade-plan.md) at
the repository root; its §13 is the running log of decisions and deviations made while building.

## Start here

1. **`package.json`** — the extension manifest. VS Code reads it before any code runs:
   `main` (the one file it loads), `activationEvents` (when), `engines` (which VS Code), and
   later `contributes` (views, commands, settings). The `scripts` block is every command a
   developer runs; the `devDependencies` block is the toolchain, nothing here ships.
2. **`src/extension.ts`** — the only source file so far. `activate` runs when VS Code starts
   the extension and creates the "PR Cascade" output channel; `deactivate` is the required
   counterpart. This file will grow into the wiring between `src/core` and `src/vscode`
   (plan §4.1), and nothing more.
3. **`test/ext/activate.test.ts`** — two tests: a real VS Code is launched, the extension is
   found by its id, and it activates. Read it for the shape every later extension-host test
   follows (arrange / act / assert, one idea per test, `describe`/`it` imported from
   `mocha`).

## The toolchain (read once, then only when something breaks)

4. **`tsconfig.json`** — how `tsc` type-checks `src/` and `test/`. Emits nothing.
5. **`esbuild.mjs`** — how `src/extension.ts` becomes `dist/extension.js` (build, watch,
   analyze). The `target`/`external` lines explain the two constraints VS Code imposes.
6. **`eslint.config.mjs`** — lint rules, including the one that enforces the architecture:
   `src/core/**` must not import `vscode`.
7. **`vitest.config.mts`** — the Node-side runner: `unit` and `git` projects, coverage on
   `src/core`. `passWithNoTests` is temporary and says why. (`.mts` = TypeScript as an ES
   module; the header explains why not `.ts`.)
8. **`tsconfig.ext.json`** and **`.vscode-test.mjs`** — the extension-host runner: tests are
   compiled to `out/` and run by Mocha inside a downloaded VS Code.
9. **`.vscode/launch.json`**, **`.vscode/tasks.json`** — F5 (plan §11.2): build, then open a
   second VS Code with the extension loaded and `../fixture-repo` open.
10. **`.github/workflows/ci.yml`** — the same `npm test` and `npm run test:ext`, on Linux and
    macOS, on every pull request and on pushes to `main`.
11. **`scripts/depcheck.mjs`** — prints the dependency card (plan §11.3) that every PR adding
    a runtime library must include. Not used until M5. Plain JavaScript that runs ahead of
    the primer: read it for what it does, not how (primer intro).
12. **`.vscodeignore`** — what is left out of the `.vsix`; the reason `node_modules` never
    reaches a user.

## Where the layers will live

- `src/core/` — pure logic and the git runner. No VS Code imports. Fully testable under Node.
- `src/vscode/` — adapters: tree view, content provider, commands, config.
- `test/unit/` (Vitest, no git), `test/git/` (Vitest, real git in temp repos),
  `test/ext/` (Mocha inside VS Code), `test/helpers/` (fixture builder, fake git runner).

Neither `src/core` nor `src/vscode` exists yet; PR 2 creates the first and PR 6 the second,
in the order above.
