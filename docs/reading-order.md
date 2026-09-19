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
3. **`src/core/model.ts`** — the shapes every core module shares. First the `GitRunner`
   interface: the two ways core code runs git (`run`, `tryRun`) and what each does when git
   says no — read the doc comment on `tryRun` for the decision PR 2's body flags under
   "Deviations": two things become `null` (git exited non-zero; there is no usable
   directory to ask in) and one never does (git itself cannot run, E17). Then the data
   model the tree renders (plan §4.3): `StackLayer` (one branch of the stack, with the
   layer below it as `parent`), `RepoState` (everything about one repository: root, trunk,
   HEAD's branch or `null`, the layers bottom to top), and `FileStatus` / `ChangedFile`,
   declared now and filled in by M2.
4. **`src/core/git.ts`** — `RealGitRunner`, the only place the codebase spawns a process.
   Look for *why* an argument array and never a shell string, the two environment variables
   every git call carries (`LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`) and why, the 32 MB output
   buffer (E18), and how Node's `error.code` is turned into a `GitError`: `StartFailure`
   names the three ways git can fail to start, `describeDirectoryProblem` explains why the
   working directory is checked *before* git is asked to run in it, and
   `classifyStartFailure` is then free to blame git with the E17 message "git not found
   at <path>".
5. **`test/helpers/fakeGit.ts`** — the same interface answered from canned strings. Every
   unit test of a core module uses it; note that it records every call and fails loudly on
   a command nobody canned. `answerIn` cans an answer for one command *in one directory* —
   discovery is the one module whose answers depend on where git runs, and its tests are
   why that method exists.
6. **`test/unit/git.test.ts`** — the runner contract written as a specification against the
   fake (including `answerIn`), plus the `GitError` message rules. Vitest, no git binary
   needed.
7. **`test/git/git.git.test.ts`** — the real thing: how a real-git test is made hermetic
   (`HOME` pointed at a throwaway directory, `GIT_CONFIG_GLOBAL` at `/dev/null` and
   `GIT_CONFIG_NOSYSTEM=1`, all via `vi.stubEnv` and restored afterwards), `git --version`,
   a non-zero exit, the environment variables observed from inside git, 2 MB of output, a
   missing executable, a directory in place of one, and a working directory that does not
   exist, cannot be entered, or is a file.
8. **`src/core/discovery.ts`** — workspace folders in, repository roots out. Look for *why*
   git is asked instead of looking for `.git` ourselves (`rev-parse --show-toplevel` walks
   up from a subfolder, E1, and understands worktrees, E19), why a folder outside any
   repository is `null` and skipped while a missing git still throws (E17), why only the
   newline git prints is removed from the path (a directory name may end in a space), and
   how `normalizeRoot` makes two spellings of one directory compare equal — symlinks, the
   macOS `/tmp` → `/private/tmp` case, a trailing slash — so the `Set` counts them once (E2).
9. **`test/unit/discovery.test.ts`** — the rules as a specification against the fake: a
   nested folder (E1), one entry per repository (E2), skipped folders, workspace order, the
   trailing-slash, newline-only and realpath-fallback rules, and E17 not hidden.
10. **`test/git/discovery.git.test.ts`** — the same on a real filesystem: a repository built
    inline with `git init`, a folder nested in it, a symlink to it, a linked worktree whose
    `.git` is a file (E19), a plain folder beside it, and a second repository whose name
    ends in a space. It keeps its own three-line `git init` helper rather than using the
    fixture builder (item 16): the builder always names its repository `repo`, and the
    trailing-space case needs a name of its own.
11. **`src/core/trunk.ts`** — which branch is "trunk", the base every stack is measured
    against. Read the doc comment on `detectTrunk` for the four-step order (plan §5) and
    the two decisions in it: a configured `prCascade.trunk` that does not exist gives
    `null` rather than falling back to a guess (E4), and the remote's `origin/HEAD`
    pointer is verified before it is trusted, because a remote that renamed `master` to
    `main` can leave it dangling at a branch that `fetch --prune` has removed (git before
    2.48 does exactly that; the plan's floor is 2.38). Then the two small helpers:
    `refExists` (what `rev-parse --verify --quiet` means, and why the ref goes in after
    `--end-of-options` and with `^{commit}` on the end) and `remoteDefaultBranch` (what
    `symbolic-ref` reads, and why `trim()` is safe on a ref name when it was not on a
    path). `TrunkOptions` at the top is the two settings, handed in as plain values so
    this file never touches VS Code.
12. **`test/unit/trunk.test.ts`** — every step of the order as a specification against the
    fake, including the exact git commands each path runs and where it stops: configured
    ref found / missing (E4, no fall-through), `origin/HEAD`, a stale `origin/HEAD`,
    `origin/main`, `origin/master`, local `main` (E25), local `master`, nothing (E4),
    `prCascade.remote` other than `origin`, and E17 not hidden.
13. **`test/git/trunk.git.test.ts`** — the same against real repositories built in
    `beforeAll`: a clone with `origin/HEAD` (and a second remote, `upstream`), one with the
    pointer deleted, one whose remote renamed `master` → `main` and whose `origin/HEAD` is
    left dangling at the pruned branch, a master-only repository, no remote (E25), and a
    repository whose only branch is `trunk` (E4 — and the case `prCascade.trunk` exists
    for). Note how each fixture sets, deletes or overwrites `origin/HEAD` explicitly,
    because git versions differ in what `fetch` does to it.
14. **`src/core/stack.ts`** — the stack itself: which branches, in what order, each on
    which. Read the doc comment on `computeStack` first. It says what "the stack" means to
    git — one command, `for-each-ref refs/heads --merged HEAD --no-merged <trunk>`:
    the local branches that are ancestors of HEAD and that trunk does not already contain
    — and what follows from asking git rather than tracking branches ourselves: only the
    stack HEAD is on is shown (E16; plan §12 item 2, HEAD-only in v0.1), and the two stale
    states — an amended bottom layer (E14), a squash-merged bottom layer (E15) — are
    rendered as git sees them, not repaired here. Then the body: measure each member
    (`rev-list --count <trunk>..<branch>` for its distance from trunk, `rev-parse` for its
    SHA), sort by distance and then by name (E6), and chain the parents bottom-up so every
    layer's diff (M2) is against the layer below it. The four helpers each explain one git
    command (`measureBranch` runs two), and why every per-branch question names the
    branch by its full ref,
    `refs/heads/<name>` — a tag with the same name would otherwise answer instead;
    `compareByDistanceThenName` says why the tie-break uses `<` on names and not
    `localeCompare`. `MeasuredBranch`, the un-exported interface at the top, is the
    half-built layer before its neighbours are known.
15. **`test/unit/stack.test.ts`** — the rules as a specification against the fake: bottom
    first whatever order git listed the refs in, counts as numbers, the parent chain by
    name and by SHA, two branches on one commit (E6 — the fake lists them backwards on
    purpose), the current marker on HEAD's layer and on a middle layer, detached HEAD (E3)
    and HEAD pointed outside `refs/heads/`, HEAD on trunk (E5, and no further git call),
    the exact command sequence (the `--merged HEAD --no-merged` argv is the whole of E16;
    every per-branch lookup by full ref), and E17 not hidden.
16. **`test/helpers/fixture.ts`** — the fixture builder (plan §9.3): a real, throwaway
    repository holding the plan Appendix A stack, and a handle whose methods put it into
    each §8 situation. Read the header for why the hermetic environment is built into the
    helper rather than the test runner, `buildStack` for the port of Appendix A line by
    line (each layer commits one distinct file, `a`, `b`, `c`, so M2's file lists are
    trivially assertable), and each method's comment for what the git operation does to
    the graph and which E-number it is for: `amend` (E14), `squashMergeBottomIntoTrunk`
    (E15), `addUnrelatedStack` (E16), `detach` (E3), `startConflictingRebase` (E12, used
    from M4). The class at the bottom is the first one in the codebase whose methods carry
    real domain logic; the `Fixture` interface above it is all a test ever sees.
17. **`test/git/stack.git.test.ts`** — `computeStack` on real repositories: the Appendix A
    stack as built (order, counts, parents, SHAs against `git rev-parse`, the current
    marker), an unrelated branch that must never appear (E16), a linked worktree checked
    out on the middle layer (E19), and then one fresh fixture per situation: HEAD on trunk
    (E5), detached HEAD (E3), two branches on one commit (E6), the bottom layer amended
    (E14), the bottom layer squash-merged (E15), and a tag sharing a branch's name (the
    names, `head` and SHAs are the branches', not `heads/<name>` or the tag's). The E14
    and E15 blocks document what the tree shows in those states — git's answer, until
    git-spice restacks or syncs in M8 — rather than a fix.
18. **`test/ext/activate.test.ts`** — two tests: a real VS Code is launched, the extension is
    found by its id, and it activates. Read it for the shape every later extension-host test
    follows (arrange / act / assert, one idea per test, `describe`/`it` imported from
    `mocha`).

## The toolchain (read once, then only when something breaks)

19. **`tsconfig.json`** — how `tsc` type-checks `src/` and `test/`. Emits nothing.
20. **`esbuild.mjs`** — how `src/extension.ts` becomes `dist/extension.js` (build, watch,
    analyze). The `target`/`external` lines explain the two constraints VS Code imposes.
21. **`eslint.config.mjs`** — lint rules, including the one that enforces the architecture:
    `src/core/**` must not import `vscode`.
22. **`vitest.config.mts`** — the Node-side runner: `unit` and `git` projects, coverage on
    `src/core`, and why only the `git` project gets a longer `hookTimeout` (every real git
    command is a separate process; a `beforeAll` that builds six repositories went past the
    default once, under load). (`.mts` = TypeScript as an ES module; the header explains
    why not `.ts`.)
23. **`tsconfig.ext.json`** and **`.vscode-test.mjs`** — the extension-host runner: tests are
    compiled to `out/` and run by Mocha inside a downloaded VS Code.
24. **`.vscode/launch.json`**, **`.vscode/tasks.json`** — F5 (plan §11.2): build, then open a
    second VS Code with the extension loaded and `../fixture-repo` open.
25. **`.github/workflows/ci.yml`** — the same `npm test` and `npm run test:ext`, on Linux and
    macOS, on every pull request and on pushes to `main`.
26. **`scripts/depcheck.mjs`** — prints the dependency card (plan §11.3) that every PR adding
    a runtime library must include. Not used until M5. Plain JavaScript that runs ahead of
    the primer: read it for what it does, not how (primer intro).
27. **`.vscodeignore`** — what is left out of the `.vsix`; the reason `node_modules` never
    reaches a user.

## Where the layers live

- `src/core/` — pure logic and the git runner. No VS Code imports. Fully testable under Node.
  So far: `model.ts` (shared types, now including the §4.3 data model), `git.ts` (the
  runner), `discovery.ts` (workspace folders → repository roots), `trunk.ts` (which branch
  is trunk) and `stack.ts` (the layers under HEAD). That is the whole M1 core; PR 6 wires
  it to a tree view.
- `src/vscode/` — adapters: tree view, content provider, commands, config. Empty until PR 6.
- `test/unit/` (Vitest, no git), `test/git/` (Vitest, real git in temp repos),
  `test/ext/` (Mocha inside VS Code), `test/helpers/` (the fake git runner and the fixture
  builder).
