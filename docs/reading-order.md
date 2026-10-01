# Reading order

Which files to open first and why. Each PR updates this list so it always describes the
codebase as it is now, not as it was scaffolded. The TypeScript syntax you meet along the way
is explained, in this same order, in [`typescript-primer.md`](typescript-primer.md).

The plan every file header cites by section is [`pr-cascade-plan.md`](../pr-cascade-plan.md) at
the repository root; its §13 is the running log of decisions and deviations made while building.

## Start here

1. **`package.json`** — the extension manifest. VS Code reads it before any code runs:
   `main` (the one file it loads), `activationEvents` (when), `capabilities` (the two kinds
   of workspace it declares it cannot work in — Restricted Mode and virtual file systems,
   plan §13.4), `engines` (which VS Code), and `contributes`: the **Stack** view under Source Control (`views.scm`), the **Refresh
   Stack** command and the toolbar slot it sits in (`commands`, `menus` › `view/title`,
   `navigation@1` = an inline icon), the **Open Changes** command (`prCascade.openDiff`,
   M3 — no menu entry: a click on a file row is what runs it, item 32; the right-click
   menu is a later milestone's, plan §7.2.1), and the four settings (`configuration`:
   `prCascade.trunk`, `prCascade.gitPath` — empty by default, meaning "the git the built-in
   Git extension found", item 31 — `prCascade.remote`, and `prCascade.statusBar`, item 33).
   There is deliberately no
   `extensionDependencies` entry for the Git extension (plan §7.14.1 says why). Everything
   declared here is given code in `src/extension.ts`. `version` is the release's tag without
   its `v` (item 50 checks that), and `publisher` — `local` until a Marketplace publisher
   exists — is the first half of the extension's id, `local.vscode-pr-cascade`, the name the
   extension-host tests look it up by. The `scripts` block is every command a developer
   runs; the `devDependencies` block is the toolchain, nothing here ships.
2. **`src/extension.ts`** — the entry point and the wiring. Read it twice: now for the
   shape — `activate` builds the adapter for the built-in Git extension (item 31), builds
   the provider from two loader functions and the output channel, creates the view with
   `createTreeView` (primer §67) and the status bar item fed by the provider's
   `onDidLoadStates` (item 33), registers the two commands, refreshes on the adapter's
   open/close event and on workspace-folder
   changes directly and — through one debounce, `refreshSoon` (`core/debounce.ts`, item 21;
   250 ms) — on every completed `git status` the adapter relays and on the Refresh button,
   registers the `stackdiff:` content provider with a reader function, runs the load itself
   while the view is hidden and once at startup (plan §13.4, D52), returns
   `{ provider, refresh }` — plus `statusBar` and `treeView` in test mode (primer §68) — and again after
   item 35, when `connectedGit` and
   `loadRepoStates` at the bottom read as the pipeline in a row: the Git extension's
   connection (awaited; an unusable Git extension is thrown as a `GitUnavailableError`,
   E82) → settings → `RealGitRunner` over `gitExecutable(setting, api.git.path)` → the
   Git extension's repositories, sorted by `sortRepositoryRoots` → `detectTrunk` →
   `computeStack`, one `RepoState` per repository; `loadChangedFiles` under it, run for one
   layer when its row is opened: the same connection → `changedFiles`; and `loadFileAtRef`
   last, run for one side of a diff when a file row is clicked: the connection → `git show
   <ref>:<path> --` through `tryRun`, so a file the commit does not have is `''` (E8, E9)
   — read its doc comment for why the `--`, why never trimmed, and why `tryRun`. Nothing
   else ever happens in this file (plan §4.1).
3. **`src/core/model.ts`** — the shapes every core module shares. First the `GitRunner`
   interface: the two ways core code runs git (`run`, `tryRun`) and what each does when git
   says no — read the doc comment on `tryRun` for the decision PR 2's body flags under
   "Deviations": two things become `null` (git exited non-zero; there is no usable
   directory to ask in) and one never does (git itself cannot run, E17). Then the data
   model the tree renders (plan §4.3): `StackLayer` (one branch of the stack, with the
   layer below it as `parent`), `RepoState` (everything about one repository: root, trunk,
   HEAD's branch or `null`, whether a rebase is paused, the layers bottom to top), and
   `FileStatus` / `ChangedFile`, the row under a layer, built by `src/core/changes.ts`
   (item 16).
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
   written for M1's repository scan, which asked the same question in every workspace
   folder; that scan is gone (M4), the method stays for the next such caller.
6. **`test/unit/git.test.ts`** — the runner contract written as a specification against the
   fake (including `answerIn`), plus the `GitError` message rules. Vitest, no git binary
   needed.
7. **`test/git/git.git.test.ts`** — the real thing: how a real-git test is made hermetic
   (`HOME` pointed at a throwaway directory, `GIT_CONFIG_GLOBAL` at `/dev/null` and
   `GIT_CONFIG_NOSYSTEM=1`, all via `vi.stubEnv` and restored afterwards), `git --version`,
   a non-zero exit, the environment variables observed from inside git, 2 MB of output, a
   missing executable, a directory in place of one, and a working directory that does not
   exist, cannot be entered, or is a file.
8. **`src/core/trunk.ts`** — which branch is "trunk", the base every stack is measured
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
   this file never touches VS Code — `src/vscode/config.ts` (item 29) is what builds it.
9. **`test/unit/trunk.test.ts`** — every step of the order as a specification against the
   fake, including the exact git commands each path runs and where it stops: configured
   ref found / missing (E4, no fall-through), `origin/HEAD`, a stale `origin/HEAD`,
   `origin/main`, `origin/master`, local `main` (E25), local `master`, nothing (E4),
   `prCascade.remote` other than `origin`, and E17 not hidden.
10. **`test/git/trunk.git.test.ts`** — the same against real repositories built in
    `beforeAll`: a clone with `origin/HEAD` (and a second remote, `upstream`), one with the
    pointer deleted, one whose remote renamed `master` → `main` and whose `origin/HEAD` is
    left dangling at the pruned branch, a master-only repository, no remote (E25), and a
    repository whose only branch is `trunk` (E4 — and the case `prCascade.trunk` exists
    for). Note how each fixture sets, deletes or overwrites `origin/HEAD` explicitly,
    because git versions differ in what `fetch` does to it.
11. **`src/core/stack.ts`** — the stack itself: which branches, in what order, each on
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
    half-built layer before its neighbours are known. Since M4 item 13a the same pass asks
    whether a rebase is paused (E12): `isRebaseInProgress` — one `rev-parse --git-path
    rebase-merge --git-path rebase-apply`, each printed path resolved against the root and
    tested with `existsSync`; read its comment for why the directory and not the Git
    extension's `state.rebaseCommit` and why `--git-path` (a linked worktree, E19);
    `computeStack`'s own comment says why it takes `directoryExists` as a defaulted fourth
    parameter (primer §33).
12. **`test/unit/stack.test.ts`** — the rules as a specification against the fake: bottom
    first whatever order git listed the refs in, counts as numbers, the parent chain by
    name and by SHA, two branches on one commit (E6 — the fake lists them backwards on
    purpose), the current marker on HEAD's layer and on a middle layer, detached HEAD (E3)
    and HEAD pointed outside `refs/heads/`, HEAD on trunk (E5, and no further git call),
    the exact command sequence (the `--merged HEAD --no-merged` argv is the whole of E16;
    every per-branch lookup by full ref), E17 not hidden, and a paused rebase (E12: either
    directory, neither, a worktree's absolute path left alone — E19; the check is a `run`)
    — every test hands `computeStack` a directory stand-in, so none touches the disk.
13. **`test/helpers/fixture.ts`** — the fixture builder (plan §9.3): a real, throwaway
    repository holding the plan Appendix A stack, and a handle whose methods put it into
    each §8 situation. Read the header for why the hermetic environment is built into the
    helper rather than the test runner, `buildStack` for the port of Appendix A line by
    line (each layer commits one distinct file, `a`, `b`, `c`, so M2's file lists are
    trivially assertable), and each method's comment for what the git operation does to
    the graph and which E-number it is for: `amend` (E14), `squashMergeBottomIntoTrunk`
    (E15), `addUnrelatedStack` (E16), `detach` (E3), `startConflictingRebase` (E12, used
    by item 15's rebase tests). The `directory` option is for the two callers outside Vitest: the
    extension-host workspace (item 41) and `npm run fixture` (item 48). The class at the
    bottom is the first one in the codebase whose methods carry real domain logic; the
    `Fixture` interface above it is all a test ever sees.
14. **`test/git/stack.git.test.ts`** — `computeStack` on real repositories: the Appendix A
    stack as built (order, counts, parents, SHAs against `git rev-parse`, the current
    marker), an unrelated branch that must never appear (E16), a linked worktree checked
    out on the middle layer (E19), and then one fresh fixture per situation: HEAD on trunk
    (E5), detached HEAD (E3), two branches on one commit (E6), the bottom layer amended
    (E14), the bottom layer squash-merged (E15), and a tag sharing a branch's name (the
    names, `head` and SHAs are the branches', not `heads/<name>` or the tag's). The E14
    and E15 blocks document what the tree shows in those states — git's answer, until
    git-spice restacks or syncs in M9 — rather than a fix.
15. **`test/git/rebase.git.test.ts`** — the first M4 item-13a file: `computeStack`'s rebase
    check against real paused rebases, one fresh fixture per block. No rebase; the fixture's
    own conflict stop (`startConflictingRebase`, and why that block does not assert the
    layers: the recipe's extra commit on local `main` makes `main` a member); after
    `rebase --abort`; `git am` stopped on a patch that does not apply (the `rebase-apply`
    directory, HEAD still attached); a rebase stopped by a failed `exec` (`-x false`: only
    the layer below the pause is listed, none current — what the view shows mid-rebase); a
    linked worktree mid-rebase (the directory lives under the main repository's
    `.git/worktrees/<name>/`, and the main working directory reports no rebase at the same
    moment — E19); and an interactive rebase paused at `break`, by way of a one-line
    `GIT_SEQUENCE_EDITOR` script. Every paused block proves its precondition in `beforeAll`
    — the directory exists, and for `git am`, the failed `exec` and `break` that git wrote
    no `REBASE_HEAD`, the file the built-in Git extension's `state.rebaseCommit` needs (plan
    §13.4 (c)) — so a case that stopped proving its point would fail loudly rather than pass
    for the wrong reason.
16. **`src/core/changes.ts`** — the first M2 file: the files one layer changes against the
    layer below it, and which of them are binary. Read the doc comment on
    `parseNameStatus` for the `-z` format (quoted from git 2.50, verified on a real
    repository): two fields per entry, three for a rename or copy, a NUL after every
    field, the score after `R`/`C` dropped; for why the paths are taken byte for byte —
    what git does to a path with a newline or `ü` in it *without* `-z` (E11); and for why
    an unknown status letter is an error naming it, never a guess. `toFileStatus` is the
    one place git's text becomes a `FileStatus` (primer §45); `requireField` is the honest
    way to read an array that may be short. Then `parseNumstat` for the second format,
    also quoted from real git: a tab-separated table under the same `-z` rule, `-` for
    both counts when git considers a file binary (E10), the rename shape — the counts, an
    *empty* path, then the old and new paths as two more pieces — that the empty path
    tells apart, and why the path column is everything after the second tab (`cut -f3-`)
    rather than a cut at every tab; `isBinary` is where a count that is neither digits
    nor `-` is refused. `NumstatEntry`, declared here and not in `model.ts`, is all
    numstat is asked for. Then `changedFiles` for the two commands: why two (name-status
    has no binary flag, numstat no status letter); the first piece by piece — two
    revisions as two arguments, a tree diff, the same comparison M3's diff editor will
    show, not the merge-base form; `-M` for renames (E7); `-z`; why the same `-M` and `-z`
    go on both (a user whose `diff.renames` is off would otherwise get one rename from one
    command and a delete plus an add from the other, and the paths would never pair); how
    the two lists are paired by path; and why it takes the SHAs from the `RepoState`
    rather than the branch names (the row's tooltip, PR 11's cache).
17. **`test/unit/changes.test.ts`** — the two formats as a specification against canned
    strings. `parseNameStatus`: one entry per status letter (A, M, D, T; `R100` and `R075`
    with both paths and the score dropped; `C075`), `binary` false on every entry, a
    ten-entry output copied byte for byte from git 2.50 (the comment on `REAL_OUTPUT` says
    how it was made), empty output, the trailing NUL, paths with spaces / unicode / `#` /
    `?` / a newline / a tab (E11), the three things the parser refuses. `parseNumstat`: a
    text file, a binary file (E10), the rename shape three ways — unchanged, edited, and a
    moved binary — each quoted from git, a whole eight-entry output (`PROBE_NUMSTAT`, with
    the matching `PROBE_NAME_STATUS` from the same two commits), empty output, the
    trailing NUL, a tab and a newline in a path, and the three things it refuses. Then
    `changedFiles`: its two commands in order with the same flags, the two probe outputs
    paired into one list, `binary` exactly where numstat printed `-`, a rename paired by
    its new path, a path numstat is silent about, a path only numstat knows, and E17 not
    hidden by either command.
18. **`test/git/changes.git.test.ts`** — `changedFiles` on real repositories, one fixture
    per situation: the Appendix A stack as built (the bottom layer's one addition, E8;
    each layer listing only its own file and never the ones below — M2's "done when";
    the empty list of a second branch on the same commit, E6; a `GitError` for a SHA
    that does not exist, E17); a four-layer stack whose top layer edits, moves, deletes
    and re-types one inherited file each (M; R with `oldPath`, E7; D, E9; T for a file
    turned into a symbolic link; and a copy, which is an `A` because `-C` is not passed
    — the comment says why); binary files added, moved and edited, with the text file
    beside them staying text (E10 — read `beforeAll` for how a `\0` in a string becomes
    the NUL byte git looks for); paths with spaces, `#`, `?`, `ü`, a newline and a tab
    coming back exactly (E11 — the tab-named file is binary on purpose: its flag is what
    proves numstat's third column is read whole rather than cut at every tab, and the
    comment on that test says why only a binary file can prove it); and a layer of 1500
    files, listed in full and in git's order (E18). `filesOfLayer` at the top is the
    helper to read first (two `rev-parse` calls stand in for the `RepoState` the tree
    would have handed over); `commitEverything` and `writeFile` are `git add -A && git
    commit` and `mkdir -p` + write.
19. **`src/core/uri.ts`** — the first M3 file: how one side of a diff is named, as the three
    parts of a `stackdiff:` URI. Read the doc comment on `StackDiffLocation` for why `ref`
    is a SHA and never a branch name (VS Code keeps a document's content by its URI, so a
    URI must name content that cannot change); `UriComponents` for why the file works on
    the *parts* of a URI rather than a `vscode.Uri` (the layering rule — and a real
    `vscode.Uri` still fits, having those three fields and more); `encodeStackDiff` for
    the layout (plan §7.4: the path with a leading `/` so VS Code picks the language from
    the extension, `root` and `ref` as JSON in the query because JSON already quotes
    anything a path can hold — the layout the built-in git extension's own `git:` URIs
    use) and for the note on encoding — these are *decoded* parts; percent-encoding is
    `vscode.Uri`'s job, in PR 15. Then `decodeStackDiff` for the checks, each an error
    naming the offending part, and `parseJsonQuery` for why `JSON.parse`'s answer is
    declared `unknown` before anything reads a field off it. `StackDiffQuery` at the top
    is the first utility type in `src/` (primer §49; §43's `Record` came first, in a test).
20. **`test/unit/uri.test.ts`** — the parts as a specification: the three parts of plan
    §7.4 compared as text; exactly `root` and `ref` in the query; the one leading `/`
    added and removed; a `vscode.Uri`-shaped object accepted; the six refusals — a
    `file:` scheme (plan §9.4), a path without `/`, a query that is not JSON, one that is
    JSON but `null` or a number, no `root`, a `ref` that is not a string — each checked
    by the text of its error; and the round trip of every awkward path (spaces,
    `ünïcode/日本語`, `#`, `?`, a `%` that must not be read as an escape, a newline, a
    leading `-`, a nested path), of a root with spaces and quotes, and of the ref (E11 —
    one test per path, made from a list, so a failure names the path).
21. **`src/core/debounce.ts`** — the first M4 item-12b file, and the smallest in `src/core`:
    a trailing debounce — `schedule()` any number of times and the action runs once, a
    quiet period after the last call; `cancel()` for shutdown. Read the header for what it
    is for (the built-in Git extension's "a git status completed" events come per
    repository and in bursts, and every one means "redraw"), the `Debounced` interface,
    and `debounce` itself: one pending timer as a queue of one (primer §64 —
    `clearTimeout` is "forget the earlier calls", a fresh `setTimeout` is "start the quiet
    period again"), the `NodeJS.Timeout | undefined` handle, and why the callback clears
    `pending` before it runs the action. Hand-rolled on purpose (plan §11.3).
22. **`test/unit/debounce.test.ts`** — the rule as a specification, on a faked clock
    (primer §65: `vi.useFakeTimers`, `vi.advanceTimersByTime`, `beforeEach` / `afterEach`):
    a burst of three calls runs the action once, after the quiet period; the period counts
    from the *last* call — a call one millisecond before the deadline moves it; a call
    after the action ran runs it again; `cancel()` withdraws a pending run; `cancel()` with
    nothing pending is harmless. Read each as a timeline: a call, so much time, a look at
    the count.
23. **`src/core/forge.ts`** — the first M5 file: which forge the remote points at. Read the
    header, then `RemoteRepository` and `parseRemoteUrl` for the three URL families and why
    the scp-like regular expression is tried *first* (`github.com:org/repo.git` is a valid
    URL to `new URL`, with the scheme `github.com:` — primer §69), why the host is kept exactly
    as the remote spells it with the port apart (`hostnameAsTyped` puts back the spelling the
    URL class lower-cases — git-spice compares hosts as text), and why `file:` is refused by
    scheme; `repositoryPath` for the order of its three strips; `ForgeConfig` and
    `parseForgeConfig` for the `spice.forge.*` keys as git prints them (and `toForgeId`, the §45
    chain that turns a string into a `ForgeKind` — `includes` on the list would not compile;
    `rejectedKind` for a value git-spice refuses); `Forge`, `classifyHost` and `gitSpiceMatches`
    for git-spice's matching rules, verified against 0.31.2 — a rejected `spice.forge.kind`
    disables every forge, a valid one wins outright, otherwise each forge has one base host (its
    url key, else its default) that the remote must equal or be a subdomain of, spelled the
    same, with the same port if the base names one — then `guessKind`, the extension's own idea
    for a host git-spice will not match (`*.ghe.com`, Azure, a default host in capitals), which
    is what `recognizedByGitSpice` records (E70's trigger); `ForgeDetection` and `detectForge`
    for the three answers E25, E21 and E60/E70/E75 need (the `forge` member carries the
    configuration that decided it, so a message can say why); `ghEnv` last, and why it is one key.
    Hand-rolled after measuring `hosted-git-info`, which fails §7.5's own URL list (plan D54).
24. **`test/unit/forge.test.ts`** — the URL forms as a table (one test per row, so a failure
    names the URL that broke), the texts that must be `null`, the configuration lines as git
    prints them, every E65 host with and without configuration, git-spice's rules one by one
    (subdomain, bare suffix, case, port, a url key displacing its kind's default host, the
    tie-breaks where git-spice itself is random, a rejected kind), `ghEnv`, and `detectForge`
    against the fake: the two commands and their order, where it stops after one (no remote, a
    local path), `prCascade.remote`, E17 not hidden.
25. **`test/git/remote.git.test.ts`** — the same against real repositories: no remote (E25);
    the fixture's bare origin, which is a local path and so `unparseable` (every extension-host
    test will see that until a fixture gains a forge remote); a second remote selected by name;
    a URL git rewrites through `url.<base>.insteadOf` before `remote get-url` prints it, and one
    it does not rewrite (`pushInsteadOf`); and the `spice.forge.*` keys stored by `git config`
    and read back through a real `--get-regexp` — a url key making its own host recognised and
    github.com unrecognised, a remote spelled in capitals, a `spice.forge.kind` git-spice
    rejects. Note the `vi.stubEnv` block at the top: the runner under test inherits the
    developer's environment, and without it a real `~/.gitconfig` could change the answers.
26. **`src/core/backend.ts`** — the second M5 file, and the first in the codebase made only
    of types: the `StackBackend` contract every stack operation will go through (plan §4.4),
    declared with the member the next PR implements and grown by each PR after it (D55), and
    `Readiness`, the probe's answer — a tagged union of ten members, `ready` and one per step of
    plan §7.13.1 that can fail, in probe order. Read the union's doc comment for why the forge step
    comes before the auth step (bare `gs auth status` cannot be read until the forge is known —
    verified against git-spice 0.31.2), the order of the checks inside the forge step, and the
    rule for what each member carries: what its one-click fix needs, nothing the caller already
    holds. `npm run typecheck` is this file's test.
27. **`src/core/gsLog.ts`** — the parser for `gs log short --json`, one JSON object per line.
    Read the header, the four small interfaces of an entry (what is kept — `name`, `down`,
    `change`, `push` — and what is dropped until something reads it), then `MalformedLine` and
    `GsLogParse` — the one-problem-per-line rule and the `{ entries, malformed }` answer — then
    `parseGsLog`: a counted loop because the index is the line number (primer §29),
    one `try` per line whose `catch` narrows to `Error` (§18). Then the four `…FromJson` helpers:
    the §51 ladder, one function per nested object so each stays one level deep, `Array.isArray`
    beside the `typeof`/`null` check, optional fields never assigned when absent, booleans that
    are only ever `true` or absent normalised to a required `false`. Hand-rolled after measuring
    zod (plan D55).
28. **`test/unit/gsLog.test.ts`** — the parser as a specification: three lines copied from this
    repository's own `git-spice log short --json` (a branch with a PR, the trunk, the current
    branch), the fields kept and dropped, `--cr-status`'s `status` kept as text, and every way a
    line can be malformed — not JSON, not an object, each field with the wrong type — reported
    once with its 1-based line number while the lines around it still parse (E57).
29. **`src/vscode/config.ts`** — the first file in `src/vscode/`: the four `prCascade.*`
    settings — three strings and the `statusBar` boolean (item 33) — read out of VS Code
    into a plain object (`PrCascadeSettings`). Read it for
    the boundary it draws — settings live in VS Code's configuration API, and nothing in
    `src/core` ever sees that API — and for what happened to `gitPath` in M4: its default
    is now the empty string, which is *not* turned into `git` here any more but means
    "the git the built-in Git extension found", resolved in `src/extension.ts` with the
    connection in hand (item 31, `gitExecutable`). All of them are taken as they come: a
    wrong string fails where it is used, with a message (E4, E17); the boolean is read by
    the status bar item on each refresh. (M1's two repository-scan settings
    and their checked readers lived here until M4; primer §41 keeps the lesson.)
30. **`src/vscode/git.d.ts`** — not ours: the built-in Git extension's public API,
    copied verbatim from VS Code's `release/1.85` tag (`extensions/git/src/api/git.d.ts`,
    MIT, Microsoft's header kept). Read only the header, `GitExtension` at the bottom
    (`enabled`, `onDidChangeEnablement`, `getAPI(1)`), `API` above it (`state`,
    `repositories`, the two repository events, `git.path`) and `Repository` / `RepositoryState`
    for a sense of what the extension deliberately does *not* read (plan §7.14). Why the
    1.85 file and why a `.d.ts` can only be imported with `import type`: primer §60.
31. **`src/vscode/gitApi.ts`** — the first M4 file, and the one M4 is built on: the
    connection to the built-in Git extension (plan §7.14). Read the header for the four
    things taken from it (plan §7.14 lists what stays a git spawn of ours), then the types
    top to bottom: `GitRepository` (the slice of a repository this extension reads — its
    root, `status()`, and `state.onDidChange`, the "a git status completed" event — where
    the real one has fifty-odd members), `GitApi` (a `Pick` of three members plus
    `repositories`, as `GitRepository`s, and the two events — and why those are
    `Event<unknown>`), `GitExtensionExports` and `GitExtensionHandle` (the shapes of what
    `getExtension` and `activate()` return, reduced to what is used), `GitExtensionHost`
    (the three seams into VS Code, and why they are one injected object: the E82 rows
    cannot be arranged in a VS Code whose Git extension works), `realGitExtensionHost`,
    `GitConnection` (a tagged union, primer §59: the API or one E82 row) and
    `GitUnavailableError`. Then the two pure functions: `gitExecutable` (which git runs
    when `prCascade.gitPath` is empty) and `sortRepositoryRoots` with its two helpers (the
    plan §6 order — by workspace folder, then path; why a root with no folder goes last;
    why `isEqualOrBelow` puts the separator on before the prefix test). Then
    `GitExtensionAdapter`: the class comment for what is memoised and the two recovery
    events; `connection()` (the first call starts the handshake — the constructor only
    wires listeners); `beginHandshake` / `reconnect` (primer §63 for the `.then`) and `isStale` /
    `keep` / `log` for how a handshake overtaken by a newer one, or by `dispose()`, leaves
    nothing behind; and `handshake` itself, plan §7.14.1 line by line — each way
    out one row, the `setTimeout(…, 0)` before the reconnect (and the VS Code 1.138 fact
    behind it), the wait for `initialized`, and the two event subscriptions that make a
    repository the Git extension opens or closes redraw the view — and rebuild the
    per-repository listeners (`watchRepositories`, `repositoriesChanged`) whose
    `state.onDidChange` the adapter relays as `onDidRunStatus`, one event per completed
    status, left for `extension.ts` to debounce (M4 item 12b).
32. **`src/vscode/tree.ts`** — the Stack view. Four small node classes first: `LayerNode`
    (the row is the branch name and nothing else — plan §7.1, E44 — with the count and
    the `· current` marker as the dimmer description, `$(target)` / `$(git-branch)` as the
    icon, and the SHAs only in the tooltip; since M2 it starts collapsed and carries its
    repository's `root`, and the comment says why), `FileNode` (the row under a layer,
    M2: `M  ingress.ts` — the status letter as a prefix, plan §12 item 3 — with the
    directory as the description, or `old → new` for a rename (E7); read the class
    comment for what `resourceUri` buys — VS Code's own file icon and decorations — and
    why, since M3, the node carries its `layer` as well as its file; and the body for
    `stackFile` / `stackFileBinary` and for `item.command`, the line that makes a click
    run `prCascade.openDiff` with the node itself as the argument, primer §52),
    `RepoNode` (one per repository, only when the workspace holds several — plan §6) and
    `MessageNode` (the sentences: no repository, no trunk (E4), not on a stack (E5), git
    failed (E17), the Git extension unusable (E82) — at the top, or under a layer — and,
    since M4 item 13b, the two that stand *above* the layers: "Rebase in progress — resolve
    it first" (E12, a warning) and "Detached HEAD" (E3)). Then
    `StackTreeProvider`, the `TreeDataProvider` VS Code asks for rows: read the class
    comment for why it is handed *functions* that load the states and the files rather
    than the data itself, the doc comment on `filesByCommitPair` for the cache — keyed on
    the two SHAs, so an entry can never be wrong, emptied on refresh anyway, for memory,
    and plain about who consults it today (VS Code keeps a row's children until the next
    refresh) — and how `refresh` (empty the cache, fire the event), `getChildren` (call the
    loader, list a repository's layers, or list a layer's files) and `getTreeItem` (each
    node draws itself) divide the work. Since M4 item 14 the class has a second event,
    `onDidLoadStates`, fired from `topLevelNodes` with the states it loaded (or `[]` when
    the load failed) for the status bar — and `loads`, the counter that lets only the newest
    of two overlapping loads speak. `topLevelNodes` is where a failed load becomes one
    row — an error row, or since M4 a *warning* row for a `GitUnavailableError` (E82: a
    state to fix, not a failure); `filesForLayer` is where a layer git cannot list becomes
    one error row under it instead of a broken tree. `nodesForRepo` at the bottom is where
    the layers are turned top-first, and where the one row above them is chosen: the rebase
    row when a rebase is paused, else the detached row when HEAD is on no branch — never
    both, since every rebase pause point but `git am` detaches HEAD, and the rebase row is
    the one that says what to do — then the E5 row or the layers; E4 alone
    when there is no trunk.
33. **`src/vscode/statusbar.ts`** — the status bar item (M4 item 14, plan §7.1.0).
    `stackStatusText` first: `$(layers) <branch> · n of N` — the current layer's name and
    its place counted from the bottom (`findIndex`, primer §25) — or `$(layers) not on a
    stack` when no layer is current (on trunk, E5; a detached HEAD, E3; no trunk, E4). Then
    `StackStatusBar`, the small class around VS Code's `StatusBarItem` (primer §66):
    `update(states)` shows the first repository's text with its root as the tooltip, or
    hides the item when there is no repository, the load failed, or `prCascade.statusBar`
    is off; `visible` is a getter (primer §61) the tests read, because the item itself
    cannot be asked whether it is shown. Read the two doc comments — `stackStatusText`'s for
    why `n` equals `N` in v0.1 except for two branches on one commit (E6), the class's for
    why the item describes the first repository (D52; M6 moves to the active editor's).
34. **`src/vscode/content.ts`** — the first of M3's two VS Code files, and the smaller:
    `StackDiffContentProvider`, the object VS Code asks for the text behind a
    `stackdiff:` URI. Read the class comment for what a content provider is and why the
    extension has a scheme of its own (plan §3 "Diff rendering": it was written to work
    with the built-in git extension switched off; that promise went in M4, the provider
    stays because it works), why it is handed a *reader function* rather
    than a git runner (the same injection as the tree's loaders — `src/extension.ts`
    owns git and settings, and a test hands in a fake), what the reader promises (`''`
    for a file the commit does not have, which is what makes E8 and E9 two empty panes
    and nothing more), and why there is no `onDidChange` (a SHA-addressed document never
    changes). The one method decodes the `vscode.Uri` with the core's `decodeStackDiff`
    — a Uri fits `UriComponents` by shape — and is `async` so a refused URI becomes a
    rejection VS Code shows in place of the document.
35. **`src/vscode/commands.ts`** — `openDiff`, what a click on a file row does (plan
    §7.2 row `prCascade.openDiff`). Read the doc comment for the four cases: no node
    (the Command Palette) → a message; a binary file (E10) → the file itself, opened
    with the built-in `vscode.open`, when its layer is checked out and the file is on
    disk, else a message naming the layer (the comment says why not more); otherwise
    two `stackdiff:` URIs — `vscode.Uri.from` over the parts `core/uri.ts` lays out,
    the layer's `parentSha` on the left and `sha` on the right, the *old* path on the
    left for a rename (E7) — and the built-in `vscode.diff` with the title `<file>
    (<parent> → <layer>)` in branch names, never SHAs. Added and deleted files (E8, E9)
    need nothing here: the provider's `''` is the empty pane. Then the body for the
    destructuring at the top (primer §54), the two toasts that are deliberately not
    awaited, and `??` picking the old path.
36. **`test/ext/activate.test.ts`** — inside a real VS Code: the extension is found by its
    id, activates, returns `{ provider, refresh }` (plan §9.1), and has its view and command
    registered — the view is checked by running the `prCascade.focus` command VS Code
    creates for every contributed view. Read it for the shape every extension-host test
    follows (arrange / act / assert, one idea per test, `describe`/`it` imported from
    `mocha`).
37. **`test/ext/tree.test.ts`** — the view over the fixture workspace, through the two
    calls VS Code itself makes (`getChildren`, `getTreeItem`): the workspace's two folders
    — a nested subfolder and the root — are one repository, found (E1b) and shown once (E2),
    so the layers sit at the top level; every label is a branch name, top first, with no
    SHA in any of them (E44); `3 commits · current`, `2 commits`, `1 commit`; the target
    icon and `stackBranchCurrent` on HEAD's layer; the SHAs in the tooltips, checked
    against `git rev-parse`; `refresh()` firing `onDidChangeTreeData` with `undefined`;
    and the view refreshing *by itself* after a commit made outside VS Code (E20, M4
    item 12b): the test subscribes to `onDidChangeTreeData` first, commits through `runGit`
    (a terminal's stand-in), runs `repository.status()` — what the Git extension would run
    once the window regains focus — and waits for that one event; it never calls `refresh`,
    so a missing status listener fails it by timeout. Then the files under each layer (M2):
    exactly the layer's own — `A  a`,
    `A  b`, and the top layer's `R  b2`, `A  c`, `D  f`, `A  logo.png` and
    `A  weird #1 ü?.txt` — never what the layers below it changed (M2 "done when"); layer
    rows collapsed; `stackFile` on a text file's row and `stackFileBinary` on the binary
    one (E10); `resourceUri` equal to the file's absolute path; an empty description and
    the path as tooltip for a root-level file; `R  b2` with `b → b2` (E7); the click's
    command — `prCascade.openDiff`, with the node itself as the one argument (M3) — and
    nothing underneath; a second `getChildren`
    for the same pair of commits answered from the cache — shown by breaking `gitPath`
    between the two asks with no refresh in between, so only the cache could have
    answered; and one error row under the layer
    when `gitPath` is wrong and there *was* a refresh (E17), its message naming the two
    SHAs the view hands git — read `layerNode` and `filesUnderLayer` at the top for how a
    row is opened from a test.
    Then the two rows above the layers (M4 item 13b), each test putting the repository into
    the state and undoing it in `finally`: HEAD detached by `checkout --detach` — "Detached
    HEAD" above the three layers, none of them current — and a rebase paused by
    `rebase -x false main` — "Rebase in progress — resolve it first" above the one layer git
    still finds below the pause, and no detached row; `rebase --abort` restores. Last, the
    one-row messages, each test putting the fixture or a setting into the state and undoing
    it in `finally`: HEAD on trunk (E5), a configured trunk that does not exist
    (E4), a `gitPath` that does not exist (E17 — the row carries `RealGitRunner`'s own
    message, and since M4 the command it names is trunk detection's, the first git command
    of ours now that the Git extension finds the repositories).
38. **`test/ext/statusbar.test.ts`** — the item live, through the handle `activate()`
    returns in test mode only (primer §68): `$(layers) retry-metrics · 3 of 3` as built,
    `add-retries · 2 of 2` on the middle layer (E44 — the layer above drops out under
    HEAD-only membership, plan §12 item 2), `api-refactor · 1 of 1`, `not on a stack` on
    trunk (E5), hidden while `prCascade.statusBar` is false and back at the next refresh,
    hidden when the load fails (E17), keeping up while the view is hidden (the one test
    that needs the `treeView` handle: the Explorer is brought up, HEAD moved, `refresh()`
    called — the load it runs itself is the only one that can fire `onDidLoadStates`), and
    its click command. Then `StackStatusBar` over a
    stand-in item (the `ext/gitApi` pattern): hidden on `[]`, hidden while off, the first of
    several repositories with its root as tooltip, `2 of 3` from a three-layer state, E6's
    `1 of 2`, `not on a stack` for E3 and E4, name and command set once, dispose.
39. **`test/ext/gitApi.test.ts`** — the built-in Git extension as the source of
    repositories, live (M4, plan §9.4 row `ext/gitApi.test.ts`). Against the *real* Git
    extension: the handshake connects and its one repository for the two-folder workspace
    is the fixture (E1b, E2 delegated); the git it names runs (`git --version`); a second
    repository appended to the workspace appears once the Git extension has opened it —
    and the tree refreshed exactly twice on the way, once for the folder and once for the
    open event, which is how the test proves the event is wired — its row opens onto its
    own stack, a reorder of the folders refreshes once with no repository event (the
    folder listener's reason to stay), and it drops out again when its folder is removed
    and the Git extension closes it. The real API comes through
    **`test/ext/helpers/gitApi.ts`** (`realGitApi`: the adapter and the real host, as
    `src/extension.ts` uses them); `nextEvent<T>` is primer §62. Then the two pure
    functions: `sortRepositoryRoots` (folder order; the lowest folder index and path
    order for ties; a root with no folder last; `/w/repo2` not "below" `/w/repo`) and
    `gitExecutable` (empty → the Git extension's git, set → the setting). Then, with
    stand-ins built from `fakeHost` / `fakeExports` / `fakeApi` (read those three first —
    primer §61 for the getters), every E82 row by its exact text: the Git extension
    disabled, failed to start, `git.enabled` off, no git found, `getAPI` throwing though
    enabled (row 2, exactly one attempt); the two recoveries (`onDidChangeEnablement(true)`
    with `getAPI` held back until the handler has returned — the VS Code 1.138 order — and
    `extensions.onDidChange`) and the two non-recoveries (the extensions event with still
    nothing to find, and with a connection already ready); a handshake overtaken by a
    second extensions event, and one still in flight at `dispose()`, both leaving nothing
    behind; the wait for `initialized`; a refresh per open/close event; and `dispose`.
    Then the status signal (M4 item 12b), with a fake repository per root
    (`fakeRepository`: a root, an emitter for "a status completed", a `status()` that does
    nothing): one `onDidRunStatus` per status in any open repository, no coalescing here; a
    repository opened later listened to and a closed one not (the fake's `setRepositories`
    sets the list *before* firing `opened` / `closed`, as the real Git extension does);
    nothing after `dispose`. Last, the tree drawing a `GitUnavailableError` as a warning
    row. E1 — a
    repository *below* the workspace folder — is next door in
    **`test/ext-parent/parentFolder.test.ts`**, in a VS Code launch of its own (item 41
    says why): the Git extension's own scan opens `parent/one` at its default depth and
    not `parent/deep/two`, with no setting of ours, and the view shows that stack.
40. **`test/ext/diff.test.ts`** — the diff on click, live (M3; plan §9.4 row
    `ext/diff.test.ts`): the command is registered; run with the bottom layer's `A  a`
    node it opens one tab whose input is a `TabInputTextDiff` with a `stackdiff:` URI on
    each side and the label `a (origin/main → api-refactor)`; each side decodes (with the
    core's own `decodeStackDiff`) to the root, the layer's SHA and the path; the text
    behind each side, read through the registered provider with `openTextDocument` —
    `''` on the left and `a\n` on the right for the added file (E8), `b\n` on both sides
    with `/b` left and `/b2` right for the rename (E7), `base\n` left and `''` right for
    the deleted `f` (E9); `weird #1 ü?.txt` percent-encoded in the URI's text
    (`%20%231%20%C3%BC%3F`) yet decoding to the exact name, and its content found (E11,
    through a real `vscode.Uri`); the binary `logo.png` on HEAD's layer opened as a file
    and not a diff, and a binary on a layer that is not checked out (a node built by
    hand) opening nothing (E10); no argument, no tab. Then the content provider built
    directly with a recording reader: the decoded location handed over, a `file:` URI
    refused by name, and — through VS Code this time — a `stackdiff:` URI with a query
    that is not JSON failing to open, and a git that cannot start (E17) still rejecting
    rather than showing an empty pane. Read `fileNodeUnder` at the top for the
    `instanceof` that hands the command a `FileNode` and not any row, `openDiffFor` and
    `nextTabsChange` for why a test waits on the tabs event, `settleTabs` for how a test
    that expects no tab waits instead (an event or a timer, whichever first),
    `onlyDiffInput` for the `instanceof` on a VS Code class, and `afterEach` for why every
    tab is closed between tests.
41. **`.vscode-test.mjs`** — where those workspaces come from: the fixture builder (item 13,
    its compiled copy under `out/`) makes the stack in a temporary directory, the top
    layer's commit is amended so it also moves `b` to `b2` (the comment says why it is
    that file — a rename only shows in a diff of two snapshots when the file exists at
    the parent — and why `--amend`), adds a small binary `logo.png` (E10; a NUL byte is
    what makes git say binary), adds a text file named `weird #1 ü?.txt` (E11 — the one
    place the name makes the whole trip from git through a `vscode.Uri` and back) and
    deletes trunk's `f` (E9); an empty `nested` folder is added inside the repository,
    and a `.code-workspace` file listing `nested` first and the root second is what the
    first test VS Code opens. Since M4 there is a second launch, for E1: a fresh parent
    folder with a fixture repository moved to `one/` below it and another to `deep/two/`,
    opened on its own — read the comment for why the layout must exist when the window
    opens and cannot be added at run time (the Git extension scans below a folder only
    once, at start), and why the parent's path is new every run. Both are cleaned up when
    the test process exits — a Ctrl+C during the run included, which the harness turns
    into a normal exit.

## The toolchain (read once, then only when something breaks)

42. **`tsconfig.json`** — how `tsc` type-checks `src/`, `test/` and `scripts/`. Emits nothing.
43. **`esbuild.mjs`** — how `src/extension.ts` becomes `dist/extension.js` (build, watch,
    analyze). The `target`/`external` lines explain the two constraints VS Code imposes.
44. **`eslint.config.mjs`** — lint rules, including the one that enforces the architecture:
    `src/core/**` must not import `vscode`.
45. **`vitest.config.mts`** — the Node-side runner: `unit` and `git` projects, coverage on
    `src/core`, and why only the `git` project gets a longer `hookTimeout` (every real git
    command is a separate process; a `beforeAll` that builds six repositories went past the
    default once, under load). (`.mts` = TypeScript as an ES module; the header explains
    why not `.ts`.)
46. **`tsconfig.ext.json`** — the extension-host tests (and `test/helpers`, which
    `.vscode-test.mjs` needs) compiled to `out/` for Mocha inside the downloaded VS Code.
47. **`.vscode/launch.json`**, **`.vscode/tasks.json`** — F5 (plan §11.2): build, then open a
    second VS Code with the extension loaded and `../fixture-repo/repo` open.
48. **`scripts/fixture.ts`** — `npm run fixture`: the fixture builder pointed at
    `../fixture-repo`, so F5 has a stack to show — with the same four changes to the top
    layer as item 41 (the `b` → `b2` move, the binary `logo.png`, the awkwardly named
    `weird #1 ü?.txt`, the deleted `f`), so F5 shows a rename, a binary file, an E11 name
    and a deletion too. The comment above its import explains
    how esbuild bundles the script into `out/` and node runs it from there (the same tool
    that builds the extension; `&&` so a bundling error is not mistaken for success) and
    why Node's own type stripping was not used.
49. **`.github/workflows/ci.yml`** — the same `npm test` and `npm run test:ext`, on Linux and
    macOS, on every pull request and on pushes to `main` — and, since M4 item 15, `npm run
    package` between them, so a packaging problem surfaces on a PR rather than on a tag.
50. **`.github/workflows/release.yml`** — what a pushed `v*` tag does (M4 item 15): the tag
    must equal `v` plus package.json's `version` and CHANGELOG.md must have that version's
    section, else it stops before building; then `npm test`, `npm run package`, and `gh
    release create` attaches the `.vsix` to a GitHub release whose notes are that CHANGELOG
    section. Read the header for why only `npm test` runs here, and the comment on `on:` for
    why a person pushes the tag. Plain YAML and shell, read for what it does (primer intro).
51. **`test/unit/release.test.ts`** — the release facts pinned on every `npm test` instead
    of discovered at tag time: a plain `major.minor.patch` version; CHANGELOG.md opening
    with that version's section and linking it to its release tag; the VS Code floor in
    `engines` equal to the `@types/vscode` version. The one test file that reads the
    repository's own files (`readFileSync`, primer §28) rather than importing from `src/`;
    `JSON.parse`'s answer is checked field by field (primer §51), never cast.
52. **`scripts/depcheck.mjs`** — prints the dependency card (plan §11.3) that every PR adding
    a runtime library must include. First run in M5 PRs 16 and 17 (plan §10.1 items 16–17):
    `hosted-git-info` and `zod`, measured and declined — plan D54, D55. Plain JavaScript that runs ahead of
    the primer: read it for what it does, not how (primer intro).
53. **`.vscodeignore`** — what is left out of the `.vsix`, so that exactly five files reach a
    user: `dist/extension.js`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`; the
    reason `node_modules` never does.

## Where the layers live

- `src/core/` — pure logic and the git runner. No VS Code imports. Fully testable under Node.
  `model.ts` (shared types, including the §4.3 data model), `git.ts` (the runner),
  `trunk.ts` (which branch is trunk), `stack.ts` (the layers under HEAD, and whether a
  rebase is paused there), `changes.ts`
  (the files a layer changes, and which of them are binary), `uri.ts` (the parts of
  the `stackdiff:` URI that names one side of a diff), `debounce.ts` (one run for a
  burst of calls — the refresh), `forge.ts` (which forge the remote points at, and
  whether git-spice will recognise it — M5), `backend.ts` (the `StackBackend` contract and
  the `Readiness` union, types only) and `gsLog.ts` (the parser for `gs log --json`).
  Finding the repositories was core's
  job in M1–M3 (`discovery.ts`); since M4 the built-in Git extension does it.
- `src/vscode/` — adapters: `gitApi.ts` (the built-in Git extension: repositories, its
  open/close events, each repository's "a git status completed" event relayed as one
  signal, the git executable, the E82 rows; `git.d.ts` beside it is that extension's own
  API declaration, copied), `config.ts` (settings → plain values),
  `tree.ts` (the Stack view: the layers, and under each the files it changes, cached per
  pair of commits; a click on a file runs `prCascade.openDiff`; the row above the layers
  when a rebase is paused or HEAD is detached), `content.ts` (the
  `stackdiff:` content provider: the text behind one side of a diff, through a reader it
  is handed) and `commands.ts` (`openDiff`: two `stackdiff:` URIs and the built-in
  `vscode.diff`, or the file itself for a binary) and `statusbar.ts` (`StackStatusBar`:
  `<branch> · n of N`, hidden with no repository or a failed load; a click opens the view).
  Later milestones add terminals.
- `src/extension.ts` — the wiring between the two: the Git extension's connection, the
  three pipelines as three functions (the stack per refresh, the files per opened layer,
  one file at one commit per side of a diff), the view, command and content-provider
  registrations, `{ provider, refresh }` for the tests — and `statusBar` and `treeView`, in test
  mode only.
- `test/unit/` (Vitest, no git), `test/git/` (Vitest, real git in temp repos),
  `test/ext/` (Mocha inside VS Code, over the two-folder fixture workspace
  `.vscode-test.mjs` builds; `test/ext/helpers/` reaches the real Git extension's API),
  `test/ext-parent/` (Mocha inside a second VS Code launch, over the parent-folder
  workspace the same file builds — E1), `test/helpers/` (the fake git runner and the
  fixture builder).
