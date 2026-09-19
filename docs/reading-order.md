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
2. **`src/extension.ts`** — the entry point. `activate` runs when VS Code starts the
   extension and creates the "PR Cascade" output channel; `deactivate` is the required
   counterpart. This file will grow into the wiring between `src/core` and `src/vscode`
   (plan §4.1), and nothing more.
3. **`src/core/model.ts`** — the `GitRunner` interface: the two ways core code runs git
   (`run`, `tryRun`) and what each does when git says no. Read the doc comment on `tryRun`
   for the decision PR 2's body flags under "Deviations": two things become `null` — git
   exited non-zero, or there is no usable directory to ask in — and one never does: git
   itself cannot run (E17).
4. **`src/core/git.ts`** — `RealGitRunner`, the only place the codebase spawns a process.
   Look for *why* an argument array and never a shell string, the two environment variables
   every git call carries (`LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`) and why, the 32 MB output
   buffer (E18), and how Node's `error.code` is turned into a `GitError`: `StartFailure`
   names the three ways git can fail to start, `describeDirectoryProblem` explains why the
   working directory is checked *before* git is asked to run in it, and
   `classifyStartFailure` is then free to blame git with the E17 message "git not found
   at <path>".
5. **`test/helpers/fakeGit.ts`** — the same interface answered from canned strings. Every
   unit test of a core module will use it; note that it records every call and fails loudly
   on a command nobody canned.
6. **`test/unit/git.test.ts`** — the runner contract written as a specification against the
   fake, plus the `GitError` message rules. Vitest, no git binary needed.
7. **`test/git/git.git.test.ts`** — the real thing: how a real-git test is made hermetic
   (`HOME` pointed at a throwaway directory, `GIT_CONFIG_GLOBAL` at `/dev/null` and
   `GIT_CONFIG_NOSYSTEM=1`, all via `vi.stubEnv` and restored afterwards), `git --version`,
   a non-zero exit, the environment variables observed from inside git, 2 MB of output, a
   missing executable, a directory in place of one, and a working directory that does not
   exist, cannot be entered, or is a file.
8. **`test/ext/activate.test.ts`** — two tests: a real VS Code is launched, the extension is
   found by its id, and it activates. Read it for the shape every later extension-host test
   follows (arrange / act / assert, one idea per test, `describe`/`it` imported from
   `mocha`).

## The toolchain (read once, then only when something breaks)

9. **`tsconfig.json`** — how `tsc` type-checks `src/` and `test/`. Emits nothing.
10. **`esbuild.mjs`** — how `src/extension.ts` becomes `dist/extension.js` (build, watch,
    analyze). The `target`/`external` lines explain the two constraints VS Code imposes.
11. **`eslint.config.mjs`** — lint rules, including the one that enforces the architecture:
    `src/core/**` must not import `vscode`.
12. **`vitest.config.mts`** — the Node-side runner: `unit` and `git` projects, coverage on
    `src/core`. (`.mts` = TypeScript as an ES module; the header explains why not `.ts`.)
13. **`tsconfig.ext.json`** and **`.vscode-test.mjs`** — the extension-host runner: tests are
    compiled to `out/` and run by Mocha inside a downloaded VS Code.
14. **`.vscode/launch.json`**, **`.vscode/tasks.json`** — F5 (plan §11.2): build, then open a
    second VS Code with the extension loaded and `../fixture-repo` open.
15. **`.github/workflows/ci.yml`** — the same `npm test` and `npm run test:ext`, on Linux and
    macOS, on every pull request and on pushes to `main`.
16. **`scripts/depcheck.mjs`** — prints the dependency card (plan §11.3) that every PR adding
    a runtime library must include. Not used until M5. Plain JavaScript that runs ahead of
    the primer: read it for what it does, not how (primer intro).
17. **`.vscodeignore`** — what is left out of the `.vsix`; the reason `node_modules` never
    reaches a user.

## Where the layers live

- `src/core/` — pure logic and the git runner. No VS Code imports. Fully testable under Node.
  So far: `model.ts` (shared types) and `git.ts` (the runner). Next: `discovery.ts`,
  `trunk.ts`, `stack.ts` (PRs 3–5).
- `src/vscode/` — adapters: tree view, content provider, commands, config. Empty until PR 6.
- `test/unit/` (Vitest, no git), `test/git/` (Vitest, real git in temp repos),
  `test/ext/` (Mocha inside VS Code), `test/helpers/` (the fake git runner; the fixture
  builder arrives in PR 5).
