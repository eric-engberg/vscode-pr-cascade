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
   M3 — no menu entry: a click on a file row is what runs it, item 73; the right-click
   menu is a later milestone's, plan §7.2.1), the **Set Up git-spice** command
   (`prCascade.setUpGitSpice`, M5 item 19b — Command Palette only; it runs item 78's flow), the
   **Track Stack with git-spice** command (`prCascade.trackStack`, M5 item 20b — in the view's
   `…` menu, `2_stack@8`, shown only while `prCascade.hasUntracked` is true: a context key
   `src/extension.ts` sets after every load, primer §74), the **Push Whole Stack** command
   (`prCascade.pushStack`, M5 item 21b — `2_stack@1`, the first entry in that menu, always
   shown; `enablement: !prCascade.rebaseInProgress`, a second key from the same listener, greys
   it and Track Stack while a rebase is paused: primer §74, item 70), and the seven
   settings (`configuration`: `prCascade.trunk`, `prCascade.gitPath` — empty by default,
   meaning "the git the built-in Git extension found", item 72 — `prCascade.remote`,
   `prCascade.statusBar`, item 74, `prCascade.gsPath`, the git-spice executable, empty for
   "`git-spice`, then `gs`", item 35, and — both M5 item 23b — `prCascade.ghPath`, the gh
   executable, empty for `gh` (item 36), and `prCascade.gitProtocol`, an `enum` of `https` and
   `ssh` the Settings editor offers as a list (item 44, the login line)).
   There is deliberately no
   `extensionDependencies` entry for the Git extension (plan §7.14.1 says why). Everything
   declared here is given code in `src/extension.ts`. `version` is the release's tag without
   its `v` (item 101 checks that), and `publisher` — `local` until a Marketplace publisher
   exists — is the first half of the extension's id, `local.vscode-pr-cascade`, the name the
   extension-host tests look it up by. The `scripts` block is every command a developer
   runs; the `devDependencies` block is the toolchain, nothing here ships — except `@vscode/codicons`' stylesheet and
   font, which `esbuild.mjs` copies into `dist/webview/` at build time (item 106 is their notice); it is pinned to an
   exact version with no caret, because `latest` and every version since 0.0.45 are prereleases (`0.0.46-NN`), so a
   `^` range would follow `latest` the day Microsoft moves it — npm takes the `latest` tag whenever it satisfies the
   range, and only falls back to the highest satisfying version (`next`'s `0.0.46-45`) when it does not — with no
   lockfile to stop it.
2. **`src/extension.ts`** — the entry point and the wiring. Read it twice: now for the
   shape — `activate` builds the adapter for the built-in Git extension (item 72), builds
   the provider from two loader functions and the output channel, creates the view with
   `createTreeView` (primer §67) and the status bar item fed by the provider's
   `onDidLoadStates` (item 74) — the same listener keeps `lastStates` and sets the two context
   keys named in item 70 (M5 items 20b and 21b) — registers the five commands — the third, "Set
   Up git-spice", runs the setup flow of item 78; the fourth, "Track Stack with git-spice", is
   `trackStack` at the bottom; the fifth, "Push Whole Stack", is `pushStack` below it —
   refreshes on the adapter's
   open/close event and on workspace-folder
   changes directly and — through one debounce, `refreshSoon` (`core/debounce.ts`, item 21;
   250 ms) — on every completed `git status` the adapter relays and on the Refresh button,
   registers the `stackdiff:` content provider with a reader function, runs the load itself
   while the view is hidden and once at startup (plan §13.4, D52), returns
   `{ provider, refresh }` — plus `statusBar`, `treeView` and the setup flow's seams
   `readinessDeps` in test mode (primer §68) — and again after
   item 81, when `connectedGit` and
   `loadRepoStates` at the bottom read as the pipeline in a row: the Git extension's
   connection (awaited; an unusable Git extension is thrown as a `GitUnavailableError`,
   E82) → settings → `RealGitRunner` over `gitExecutable(setting, api.git.path)` → the
   Git extension's repositories, sorted by `sortRepositoryRoots` → `loadRepoState` per
   repository (M5 item 20b split it out): `detectTrunk` → `computeStack` → `backend.enrich`
   (item 35's local tier, through the window's one backend) → `logEnrichment`, the Output lines
   that say how many layers git-spice tracks and whether `gs log` ran or the memo answered;
   `loadChangedFiles` under it, run for one
   layer when its row is opened: the same connection → `changedFiles`; and `loadFileAtRef`
   last, run for one side of a diff when a file row is clicked: the connection → `git show
   <ref>:<path> --` through `tryRun`, so a file the commit does not have is `''` (E8, E9)
   — read its doc comment for why the `--`, why never trimmed, and why `tryRun`. M5 item 19b's
   wiring is in two places: above `activate`, `realTerminalHost`, `realReadinessHost` (VS Code
   itself as items 77 and 78 take it) and `readinessDeps` (the seams, handed to tests only);
   at the bottom, `backendFor` (one git-spice backend per window, rebuilt when the git, either
   executable setting or — in a test — the runner changes), `probeFor` and `setUpGitSpice`, the command.
   Then M5 item 20b's: `lastStates` and `hasUntracked`, `notEnrichedMessage` (the sentence for a
   repository `enrich` could not serve, with the setup command named only where it would help),
   and `trackStack` in three parts — `untrackedRepositories` (the refusals before a repository is
   chosen, each a sentence and no refresh), the pick, and `trackIn` (the fresh load, the refusals
   after it, `track`, one sentence) under a `finally` that refreshes exactly once (E83). Read the
   doc comment on `trackStack` for why it is not gated on the setup flow (D60). Then M5 item
   21b's: `NO_REPOSITORY_LOADED` (the sentence both commands share), `pushing` (the roots with a
   push in flight), and `pushStack` in Track Stack's three parts — `stackedRepositories`, the
   pick, the in-flight guard, `pushIn` (the fresh load, the refusals after it, `track` first for
   the `null` layers, `push`) and `reportPush` (git-spice's notes and the pushed names to the
   Output panel, one sentence — with a tail naming the panel when there were notes) under a
   `finally` that refreshes exactly once and releases the guard. Read `pushStack`'s doc comment
   for why it is not gated on the setup flow either (D62).
   Nothing else ever happens in this file (plan §4.1).
3. **`src/core/model.ts`** — the shapes every core module shares. First the `GitRunner`
   interface: the two ways core code runs git (`run`, `tryRun`) and what each does when git
   says no — read the doc comment on `tryRun` for the decision PR 2's body flags under
   "Deviations": two things become `null` (git exited non-zero; there is no usable
   directory to ask in) and one never does (git itself cannot run, E17). Then the data
   model the tree renders (plan §4.3): `StackLayer` (one branch of the stack, with the
   layer below it as `parent` — and, since M5 item 20a, `tracking?`, what git-spice knows
   about it: read its doc comment for the three states — no key, `null`, an entry — and for
   why an entry with no `down` is git-spice's trunk line), `RepoState` (everything about one
   repository: root, trunk, HEAD's branch or `null`, whether a rebase is paused, the layers
   bottom to top, and `enrichment?` — how item 35's `enrich` went, the `Enrichment` union
   above it, whose `enriched` member since M6 item 23b also carries the whole `gs log --all`
   answer by branch name, whether every line parsed, and which branch names have a
   remote-tracking branch: what item 61 reads for every stack, not only HEAD's), and `FileStatus` / `ChangedFile`, the row under a layer, built by
   `src/core/changes.ts` (item 16). The file's one import is `import type` from
   `src/core/gsLog.ts` (item 27): a layer carries the parser's own line.
4. **`src/core/git.ts`** — `RealGitRunner`, where git is spawned (`src/core/command.ts`, item 29,
   spawns the other tools and shares three helpers from here).
   Look for *why* an argument array and never a shell string, the two environment variables
   every git call carries (`LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`) and why, the 32 MB output
   buffer (E18), and how Node's `error.code` is turned into a `GitError`: `StartFailure`
   names the three ways git can fail to start, `describeDirectoryProblem` explains why the
   working directory is checked *before* git is asked to run in it, and
   `classifyStartFailure` is then free to blame git with the E17 message "git not found
   at <path>".
5. **`test/helpers/fakeGit.ts`** — the same interface answered from canned strings (the pattern
   `test/helpers/fakeCommand.ts`, item 30, copies for programs other than git). Every
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
   this file never touches VS Code — `src/vscode/config.ts` (item 69) is what builds it.
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
    stack HEAD is on is shown (E16; plan §12 item 2, HEAD-only in v0.1 — the M6 views read every
    stack through `core/graph.ts`, item 58, while this file still feeds the tree), and the two stale
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
    by item 15's rebase tests), and — since M5 item 22b, for the real-git-spice files, items
    50–52 — `commitOnTrunk` (a pushed trunk commit: a restack needed, or a conflict when it
    touches `a`) and `addHook` (an executable git hook). The `directory` option is for the two
    callers outside Vitest: the extension-host workspace (item 89) and `npm run fixture` (item 99). The class at the
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
    configuration that decided it, so a message can say why); `ghEnv` last, and why it is one key —
    the rest of gh's environment is item 36's `GH_ENV`.
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
    `Readiness`, the probe's answer — a tagged union of eleven members, `ready` and one per step of
    plan §7.13.1 that can fail, in probe order (M5 item 23a added `gh-not-logged-in`, and `GhFound`
    above the union, what `ready.gh` carries on GitHub). Read the union's doc comment for why the forge step
    comes before the auth step (bare `gs auth status` cannot be read until the forge is known —
    verified against git-spice 0.31.2), the order of the checks inside the forge step, and the
    rule for what each member carries: what its one-click fix needs, nothing the caller already
    holds. Two names after the union (M5 item 19a): `Ready`, the `ready` member alone, and
    `NotReady`, every member but it — the union cut in two by `Extract` and `Exclude` (primer
    §49), so the offers in item 44 cannot be handed `ready`. M5 item 20a grows the interface by
    two members, `enrich` and `track`, each with a doc comment that is the whole promise (what
    is never run, what is never changed, what a result means), and adds `TrackResult` — on
    purpose not a tagged union (primer §59). Its `TrunkBranch` import from item 44 is
    type-only, as item 44's import of `Ready`/`NotReady` from here is: two files naming each
    other's shapes, nothing running in a circle. M5 item 21a adds `push` and `PushResult` —
    `TrackResult`'s shape (`tracked` become `pushed`) plus `notes`, the lines git-spice printed
    beside `Pushed`; read `push`'s doc comment for what it refuses and why tracking is the caller's. `npm run typecheck` is
    this file's test; item 35 implements all four members.
27. **`src/core/gsLog.ts`** — the parser for `gs log short --all --json`, one JSON object per
    line, which item 35's `enrich` runs and whose entries item 3's `StackLayer.tracking` carries.
    Read the header, the four small interfaces of an entry (what is kept — `name`, `down`,
    `change` with its `comments` since M6 item 23b, `push` — and what is dropped until something
    reads it), then `MalformedLine` and
    `GsLogParse` — the one-problem-per-line rule and the `{ entries, malformed }` answer — then
    `parseGsLog`: a counted loop because the index is the line number (primer §29),
    one `try` per line whose `catch` narrows to `Error` (§18). Then the four `…FromJson` helpers:
    the §51 ladder, one function per nested object so each stays one level deep, `Array.isArray`
    beside the `typeof`/`null` check, optional fields never assigned when absent, booleans that
    are only ever `true` or absent normalised to a required `false`. Hand-rolled after measuring
    zod (plan D55).
28. **`test/unit/gsLog.test.ts`** — the parser as a specification: three lines copied from this
    repository's own `git-spice log short --json` (a branch with a PR, the trunk, the current
    branch), the fields kept and dropped, `--cr-status`'s `status` kept as text and its `comments` kept as counts (M6 item 23b), and
    every way a
    line can be malformed — not JSON, not an object, each field with the wrong type — reported
    once with its 1-based line number while the lines around it still parse (E57).
29. **`src/core/command.ts`** — the second runner, for programs other than git: git-spice and,
    since M5 item 23a, gh (item 36). Read the header for why it answers with a *result* and never rejects (an
    exit code is an answer to the readiness probe — `auth status` exit 1 is "not logged in",
    a missing executable is "not installed"), `CommandRequest` (one object for the executable,
    the arguments, the directory, the variables and the timeout — the executable is per request
    because the probe tries two names), `CommandResult` (the counterpart of `GitFailure` that
    also covers success), and `RealCommandRunner.run`: `spawn` turned into a Promise as
    `RealGitRunner` does with `execFile`, sharing its directory check and ENOENT/EACCES
    classification (exported from `git.ts`), the program's input `/dev/null` from the start, both
    outputs collected under the same 32 MB ceiling, and — since M5 item 22a — the program started
    as the leader of its own process group (`detached`, primer §75) so the request's timeout kills
    the group: git-spice, git's push and a pre-push hook together (`killGroup`, SIGTERM then
    SIGKILL after `KILL_GRACE_MS`). This is the "execFile wrapper" plan §11.3 weighed `execa`
    against in item 21a and kept (D61); read `watch` for why the result settles on `close`, and
    the class comment for why `execFile` with `detached` was not an option.
30. **`test/helpers/fakeCommand.ts`** — the same interface answered from canned results, the
    way `fakeGit.ts` (item 5) answers git: a Map keyed by the executable and its arguments,
    every request recorded whole, `answerIn` for one directory, and a loud throw for a command
    nobody canned. The three builders at the bottom — `exited`, `neverStarted`, `timedOut` —
    are how a test spells an answer. No vitest import, so the extension-host tests can use it —
    and, since M5 item 23a, the gh questions of item 36 are answered through it too.
31. **`test/unit/command.test.ts`** — the fake's contract as a specification, as
    `test/unit/git.test.ts` (item 6) is for `FakeGitRunner`: what it records, what it answers,
    where `answerIn` applies, how it fails on an unknown command, and the three builders' shapes.
32. **`test/git/command.git.test.ts`** — the real runner over real processes: git for the exit
    codes; Node itself for the environment, for a program that reads its input (it must not
    wait) and for one that outlives its timeout (it must be killed); and paths that are not
    programs for the three start failures. Every case resolves. Since item 22a, ten more: a
    multi-byte character kept whole across a chunk boundary; then the process-group describe — a
    Node child that spawns a Node grandchild, gone after the timeout; SIGKILL after the grace for
    a program that ignores SIGTERM, the line it wrote on the signal kept; the control that kills
    the one pid, as `execFile` did, and finds the grandchild alive; exit 7 on SIGTERM kept beside
    `timedOut`; the 32 MB ceiling, the program stopped and not only unread; a foreign signal
    named; a descendant that left the group but kept the program's pipes, which cannot hold the
    result open (the pipes are destroyed after the SIGKILL, not before the SIGTERM); a grandchild
    that ignores SIGTERM while the program dies on it, still reached by a SIGKILL timer that
    outlives `close`; and no timer left queued once a result is in.
33. **`src/core/version.ts`** — the smallest M5 file, and the one two readers share (M5 item 23a):
    a version as three numbers, `parseVersion` (`v` optional, a suffix ignored — a floor on
    features, so `0.31.0-rc1` has 0.31's commands; `dev` and a bare `0.31` are `null`),
    `isAtLeast` (numbers, never text — `0.9.99` is below `0.31.0`, `2.102.0` above `2.90.0`) and
    `formatVersion`. They lived in item 35 until the gh reader (item 36) needed them too; a shared
    module is how neither file imports the other.
34. **`test/unit/version.test.ts`** — the helpers as a table: every text `parseVersion` reads and
    refuses, `isAtLeast` against both floors, `formatVersion`.
35. **`src/core/backends/gitspice.ts`** — the first M5 file that talks to git-spice: the
    readiness probe (plan §7.13.1). Read the constants first — the two names tried, the
    variables every call gets, the timeout, the version floor (the version helpers are item 33's
    since M5 item 23a) — then `GitSpiceBackend` (the class holds the runners, the two settings
    and the memo of `ready` answers) and, beside it, `locateGitSpice` (step 1), `probe` (steps
    2–5) and `ghStep` (step 5, M5 item 23a: item 36's three questions on a GitHub repository only,
    after the git-spice login) — the five steps in order: find git-spice by
    what it calls itself in its `--version` banner (never by its exit code — Ghostscript's
    `gs --no-prompt --version` exits 0 and prints a bare `10.08.0`, so an exit code would take it
    for git-spice), check `refs/spice/data`
    exists (never `gs log`, which on an uninitialised repository would try to initialise it and
    die at the trunk prompt — plan §7.6), classify the forge with `detectForge`, ask
    `auth status --forge <kind>`, and on GitHub ask gh (item 36). Read the class comment for what the probe must never do,
    `forget` (M5 item 19a: drop one remembered `ready`, for the setup command's fresh look —
    primer §46 for `delete`), and `gs` at the bottom for the four things every git-spice call
    carries. Then the two members M5 item 20a adds. `enrich` — plan §7.8's local tier: read its
    doc comment for the order of its steps and stop at each: nothing to ask → the same object
    back; the digest (item 47); no `refs/spice/data` line → not enriched with no program run
    (the §7.6 rule, enforced where the spawn would be); the memo `logByRoot` (primer §46's third
    cache — a hit is an equal digest, applied to today's layers by name); `locateGitSpice` only
    right before a `gs log`; `gs log short --all --json` (`GS_LOG_ARGS`, with `--all` for a
    reason the constant's comment gives); then `withTracking` below the class for the three
    things a layer can receive — the entry, `null`, or no key when the answer had a malformed
    line, and why that last one is not `null`; since M6 item 23b the same function puts the answer
    whole on `enrichment` — `byName`, `complete` and the digest's `remoteBranches` — for item 61,
    which draws every stack and cannot reach them through HEAD's layers. `track` — plan §7.13.3: only `null` layers,
    bottom to top, its two guards before the first spawn and why it keeps them though `enrich`
    just paid for both, `baseFor` for the `--base` of each layer and the three sentences for a
    trunk that cannot be one. Then the member M5 item 21a adds — `push`: read its doc comment
    for the five refusals before the spawn and what the two that read the layers protect against
    (`push.behind` after a fetch, `down.needsRestack` after a pull on trunk — which is why the
    caller, item 21b, loads the repository afresh before calling), then
    `GS_SUBMIT_ARGS` with both `--no-` flags, `PUSH_TIMEOUT_MS` through `gs()`'s defaulted
    parameter, and `pushedBranches` / `otherLines` below the class. `describeResult` is the one
    phrase all three make of a failure: git-spice's first `FTL` line (it prints `INF` lines
    before it on an auto-init failure) and, since 21a, git's own line relayed after its `FTL
    stderr:` marker — `relayedGitLine`, in four small functions rather than one loop
    (SonarCloud's 15). `notLocatedReason` says why step 1's sentences are spelled here a second
    time rather than imported from item 44.
36. **`src/core/ghstatus.ts`** — the gh half of the probe's last step (M5 item 23a, plan §7.5,
    §7.13.1 step 5): three small questions over the CommandRunner of item 29, in cost order — gh
    found by what it calls itself in its `--version` banner (never by exit code, as item 35 does
    for git-spice) and read against the 2.90.0 floor with item 33's helpers; the gh-stack
    extension by `gh stack --version`'s own banner (`gh extension list` would exit 4 without a
    login — and 0 with `GH_HOST` set, an answer that depends on the environment; the comment says
    so, and the facts file of item 57 pins both); the login by `gh auth status --hostname <host>`,
    exit 0 and nothing else — the host lower-cased because gh folds neither the flag nor
    `GH_HOST`'s case, and the same host in both because gh matches the flag against its host list,
    which only `GH_HOST` puts a host with no account on (and a never-logged-in host is thereby a
    network call, not a local answer: `runGh`'s doc says why that is accepted). Read `GH_ENV` for
    the five variables every call gets beside item 23's `ghEnv` (the hygiene forge.ts promised
    would live here, telemetry off among them — the header says what gh writes without it), then
    `ghReadiness` for the order and why the extension is asked of a gh that is too old but not of
    one that is not there, then `runGh`, the one request builder (M7's `gh stack link` will go
    through it). Nothing here polls or words a sentence: the poll is item 42's over the probe, the
    words item 44's.
37. **`test/unit/ghstatus.test.ts`** — the three questions as a specification against the fake of
    item 30: the exact request of each spawn (the variables spelled out, not the constant); the
    banner table; a program that is not gh, six ways, one spawn each; the extension present,
    absent (gh's own hint), an old gh's unknown command, a timeout — the login never asked while
    anything is missing; auth 0 / 1 / 4 / never started / timed out, the offline shape and the
    empty-default-token shape read exactly as "not logged in" (the one rule the probe takes on
    faith, plan D65); `GitHub.COM` lower-cased in the flag and in `GH_HOST`, and the same host in
    both for a `*.github.com` remote (why: item 36's `runGh`); a GHE host carried through; the
    setting empty, blank, set, and set to something that is not gh.
38. **`test/unit/readiness.test.ts`** — the probe as a specification against both fakes: every
    `Readiness` member in probe order, the exact programs and git commands run — and the
    happy path's whole list, eight on GitHub and five on GitLab, so an extra or a misplaced spawn
    fails — the version table, the step-5 rows (M5 item 23a: a GitLab remote spawning no gh, each
    gh answer, two hosts in one window, the memo not remembering either gh member), the memo
    (a `ready` remembered, a failure not, two roots kept apart, `forget` dropping exactly one
    entry), and E17 let through.
39. **`test/git/readiness.git.test.ts`** — the probe's git side on the fixture: real git says
    `refs/spice/data` is not there, then is (`git update-ref` standing in for `gs repo init`),
    then is not again, and a failing answer is not remembered. git-spice is faked here; the real
    one runs in item 54, since M5 item 22b gave CI one. No gh is faked here: the bare origin is
    E21, so step 5 is never reached.
40. **`src/core/shell.ts`** — the first of M5 item 19a's three files, which decide what the
    user is told when the probe says "not ready" and what one click runs; M5 item 19b shows it.
    This one turns a command, as a list of words, into one line a terminal's shell reads back
    as exactly those words: `shellQuote` leaves a plain word bare and wraps anything else in
    single quotes, with a quote inside written `'\''` (`replaceAll`, primer §23). Read the doc
    comments for why a terminal at all (git-spice prompts there), why a leading `=` is quoted
    (zsh), and the shells it is for — sh, bash and zsh; Windows out of scope.
41. **`test/unit/shell.test.ts`** — which words stay bare and which are quoted, one `it` per
    case, and how a quote inside a word survives. Every expected line here was also run through
    sh, bash and zsh while the file was written, and each printed the word back unchanged.
42. **`src/core/poll.ts`** — plan §7.5 step 3's poll, generalised for both tools: `waitUntil`
    asks a question every interval until it says yes, until the timeout, or until an
    `AbortSignal` says stop (primer §71); `sleep` is the abortable wait inside it. Read
    `waitUntil`'s doc comment for its three rules — never ask before the first interval, count
    time in intervals rather than by the clock, let a question already being asked finish —
    and the header for why the global `setTimeout` and not `node:timers/promises` (the tests'
    fake clock replaces only the global).
43. **`test/unit/poll.test.ts`** — five minutes of polling in milliseconds, on Vitest's fake
    clock: exactly a hundred questions, the abort before, during and between them, a check that
    rejects, an hour's jump of the clock that uses up nothing, the intervals refused (zero, less,
    `NaN`, `Infinity`), and no listener left on the signal (primer §65 for
    `advanceTimersByTimeAsync` — the plain `advanceTimersByTime` cannot drive a loop that awaits
    between timers).
44. **`src/core/readinessFix.ts`** — the offers: for each way the probe says "not ready", the
    sentence, its colour, at most one button and what it runs (`offerFor`), plus the line shown
    once the step passed. Read the header for the rules every sentence follows (no "PR
    Cascade:" prefix, warning only when there is something to do, never a Cancel button),
    then the types — `TrunkBranch`, `OfferFacts` (what the sentences need beyond the probe's
    answer: the folder, the remote, the trunk's local branch, the two executable settings, where
    Homebrew is and whether it has git-spice and gh, the git protocol), `ConfigEntry`, `Fix` (a
    terminal command, some `git config` lines, or a web page), `OfferedFix`, `Offer` — then
    `offerFor`, which only picks (and why its chain of `if`s needs no final case: primer §59):
    three members are worded right there, the other seven have a helper below — since M5 item
    23b `ghMissingOffer` picks among three for gh (not found, too old, the extension alone) and
    `ghLoginOffer` builds the one terminal line that unsets a token pair chosen by host class
    (`ghTokenVariables`, a tuple type — primer §25). Three repay a slower read: `trunkBranchFor`, the one question asked of
    git before an init offer — `gs repo init --trunk` wants a *local* branch, and the trunk is
    usually `origin/main`; `gsTooOldOffer`, for how a Homebrew install is told from the others
    now that every official package is named `git-spice`; and `unrecognizedOffer` with
    `githubUrls` below it, which turn `forge-unrecognized`'s two fields into one of six
    sentences (E60, E70) — and name the forge's API as well as its URL, because git-spice
    guesses `<url>/api` for any GitHub url but exactly `https://github.com` (wrong for `*.ghe.com`)
    and a stale `apiUrl` from elsewhere would otherwise apply. `FORGE_NAMES` and
    `TOKEN_VARIABLE` are `Record`s over unions (primer §43).
45. **`test/unit/readinessFix.test.ts`** — the offers as a specification: the first case of each
    member compares the whole offer, so a changed word fails (messages are behaviour), and the
    cases after it pin the field they are about — each `Readiness` member and its variants, then
    `readyMessage`, then `trunkBranchFor` against the git fake — a local trunk, a remote-tracking
    one with and without its local branch, a fork's trunk on another remote, a tag, a commit, a
    name git does not know. Since M5 item 23b the gh offers too: the three install offers' every
    branch, the login line's pair and protocol, `ghTokenVariables` as a table.
46. **`test/git/trunkBranch.git.test.ts`** — the same question asked of real git, once per
    kind of trunk — `origin/HEAD`, an ambiguous name and one that looks like an option included —
    because what `--symbolic-full-name` prints for each is exactly the kind of detail another git
    version could change.
47. **`src/core/digest.ts`** — the first of M5 item 20a's files, and the smallest: the one git
    command whose text says whether anything `gs log` could answer has changed (plan §7.14.2's
    pre-filter), and the two facts read off it. Read the header for which three ref namespaces are
    in it and why — a commit, a fetch or push, any git-spice write, including the one `gs log`
    itself makes when it prunes a branch deleted out of band — and for why HEAD is *not* (D59: with
    `--all` git-spice prints the same lines from every HEAD but for the `current` flag, which the
    parser drops, so a checkout costs no `gs log`).
    Then `readRefDigest` (verbatim stdout, compared whole, never parsed; `run`, so a failing git is
    E17) and the two facts found in text already in hand: `isInitialised`, the probe's step 2 (the
    `m` flag on its pattern is primer §20's), and `remoteBranches` (M6 item 23b), the bare branch
    names under `refs/remotes/`, any remote — item 61's "never pushed", which the inventory in
    `docs/view-lab.html` had as one `rev-parse` per branch.
48. **`test/unit/digest.test.ts`** — the command spelled, the text handed back untouched, E17 let
    through, and `isInitialised`'s table: the line first or last, no line, an empty digest, and the
    three near-misses the line start and the trailing space exclude. Since M6 item 23b,
    `remoteBranches`'s table too: no line, origin's `HEAD` among the names, a slashed name whole and
    one name on two remotes once, a `refs/heads` line of the same name left out.
49. **`test/git/digest.git.test.ts`** — the real command on the fixture: the six lines it prints
    and their order, then what moves the text (a `refs/spice/data` written by `update-ref`, a
    commit, a push — each undone in `finally`) and what does not (a checkout — the D59 fact).
50. **`test/unit/enrich.test.ts`** — `GitSpiceBackend.enrich` (item 35's second half) as a
    specification against both fakes: what each `gs log` line becomes on its layer (E56 — the
    trunk's own line, the later of two lines, `change.status` kept), the exact one git command and
    two programs, the input never changed; nothing asked without a trunk or layers; the self-gate
    (no `refs/spice/data` line → not enriched with **zero** programs run, plan §7.6); git-spice
    missing or too old in the setup flow's own words (pinned against `offerFor`); every way `gs
    log` can fail turned into one phrase (E57 — the `FTL` line past the `INF` lines); an
    incomplete answer leaving unlisted layers *unknown*, not untracked; then the memo of plan
    §7.14.2 — one `gs log` for two loads, the answer applied to today's layers, a changed branch,
    remote ref or `refs/spice/data` re-running it, a failure never remembered, one memo per root.
    Since M6 item 23b every `enriched` literal also pins `byName`, `complete` and `remoteBranches`, a
    second remote's branch reaches the set, and a memo hit hands back the same map object.
51. **`test/unit/track.test.ts`** — `GitSpiceBackend.track` as a specification: the `gs branch
    track` commands bottom to top with their bases, the layers left alone (tracked, git-spice's
    trunk line, not enriched) while still serving as bases, nothing run when nothing is `null`,
    the stop at the first failure with git-spice's words, the two guards before the first spawn
    (`refs/spice/data`, step 1 of the probe), and the three sentences for a trunk that cannot be
    the base — the `missing` one quoting `git branch <b> <trunk>` through `shellCommandLine`.
52. **`test/unit/push.test.ts`** — `GitSpiceBackend.push` as a specification (M5 item 21a): the one
    `stack submit --no-publish --no-update-only` with its 120 s timeout after the one git question
    and the banner; `pushed` read from the `INF Pushed` lines and `notes` from every other (order; a
    `WRN` block, a CRLF on a pushed line and stdout; the `<name>-2` rename's two lines; nothing
    recognisable → `[]`); `GS_ENV` whole with `GIT_TERMINAL_PROMPT`; `gsPath`; the five refusals
    before the spawn — no layers, not initialised, a layer the remote is ahead of (`push.behind`, in
    any position, named, and what never counts: no `push`, ahead only, `null` or absent tracking),
    git-spice missing or old, a layer needing a restack (any position, named, the located executable
    spelled and quoted; `null`, absent and trunk-line `tracking` never counting; the remote checked
    before the restack); the stale-info, cannot-lock-ref, no-remote, partial-push (`pushed:
    ['api-refactor']`, the `ERR` remedy in `notes`), detached and timeout phrases; the appended git
    line's rules; the input unchanged; E17.
53. **`test/helpers/gitspice.ts`** — the real git-spice for the three files that follow (M5 item
    22b): found once, synchronously, by its `--version` banner (`spawnSync`, primer §28) so
    `describe.skipIf` can read the answer while Vitest collects a file (§76); `PRCASCADE_TEST_GS`
    to point the files at another build and `PRCASCADE_REQUIRE_GS` for CI's promise;
    `runGitSpice`, shaped as production's own spawn; the `.git` snapshot behind the plan §13.4 (k)
    pins (every file's size, modification time in nanoseconds and inode — `BigInt` stats, §79);
    `loadState` and `initAndTrack`, the extension's pipeline without VS Code, so no test builds a
    RepoState by hand. No vitest import, as the fixture.
54. **`test/git/gitspice.git.test.ts`** — the backend against the real thing, offline, on one
    fixture in story order: readiness before and after `repo init`, enrich on an uninitialised
    repository (no spawn) and after, track bottom to top and the raw `gs log` lines by name, the
    (k) pin (three `gs log` forms change nothing under `.git`), the memo, push (the origin's heads,
    the upstreams, `push {0, 0, false}`), a detached push, a pushed trunk commit and the restack
    refusal, the second (k) pin (a deleted branch pruned: `refs/spice/data` and objects only), and
    an empty HOME at the end — and, since M6 item 23b, item 61's `buildStackViewModel` at two of its
    points, after `init` (every layer untracked and never pushed) and after the push (no indicator
    anywhere): the one place the digest's `refs/remotes` lines and git-spice's `push` are real rather
    than typed. Read it beside items 50–52: the same promises, now against the
    git-spice CI pins (`GIT_SPICE_VERSION` in `.github/workflows/ci.yml`) — or your own, when one
    is on PATH.
55. **`test/git/gitspiceFacts.git.test.ts`** — git-spice run directly, pinned so a new version fails
    loudly: the CI test that makes a missing git-spice a failure rather than a skip (`it.runIf`,
    §76), the exit-code table as `it.each` (§78: 0 and 1 only — plan §12 item 7), outside a
    repository, `init --trunk nope`, the `<name>-2` rename and its predicate (M7 item 26's guard
    will read these), and the push killed at its timeout with a slow pre-push hook — item 22a's
    kill measured against git-spice: the branch never lands.
56. **`test/git/gitspiceOps.git.test.ts`** — what M9 will drive, as facts: a restack interrupted by
    a conflict (git's `rebase-merge`, the `ERR` remedy lines, git-spice's own record, what
    `computeStack` sees), `rebase continue` and `abort` on git-spice's pause and on a plain git
    pause (the same remedy for both; only the upstack differs — and where HEAD ends: continue
    returns to the branch the restack began on, abort stays on the layer git was rebasing; after a
    plain pause the next `gs log` records the external restack), amending the bottom and
    `upstack restack`, `branch create --below` (E49's
    graph), `branch onto`. Two fixtures; the pauses are made on the bottom layer and every trunk
    commit is pushed (the header says why).
57. **`test/git/gh.git.test.ts`** — the real GitHub CLI, read-only and hermetic (an empty config,
    data and state directory, every token variable deleted): the banner's shape and the floor met,
    `stack --version` absent with its three-line hint and the probe's whole gh step answering "the
    extension is missing", `extension list`'s exit 4 without a login and 0 under `GH_HOST` (why the
    probe asks `stack --version`), `auth status`'s exit 1 for a host with no account both as a
    terminal would ask it (the local sentence) and as the probe asks it (`GH_HOST` making gh
    validate an empty default token over the network — the proxy proves where it went), for two
    hosts, and the offline shape with a bogus token (the same exit 1 three times — why the probe
    reads no stderr), `auth login` refused while a token variable for the host is set and not by
    the other pair — gh then goes to that host's device-code URL (why the login line will unset a
    pair per host), and the three directories still empty (why `GH_ENV` turns telemetry off). Every
    `auth` row runs through a dead proxy, so the file is the same offline and on CI. Skipped without
    `gh`; CI requires it (`PRCASCADE_REQUIRE_GH`) and installs nothing — the runner images ship gh.
    Read it beside item 55, whose shape it borrows.
58. **`src/core/graph.ts`** — the first M6 file (item 23a), and the first core file since item 11 to ask git
    about branches: every stack in the repository, laid out as the rows the two views will draw. Read
    `computeStack` (item 11) first and keep it in mind: that file asks for HEAD's stack with `--merged HEAD`
    and measures each branch with its own `rev-list --count`; this one asks for all of them in three texts —
    `for-each-ref refs/heads` (every local branch with its commit and the commit's date, merged or not),
    `rev-list --parents --branches --not <trunk>` (every commit reachable from a local branch and not from
    trunk, each with its parents) and `rev-list -1` for trunk's own tip and date — and reads the stacks off
    them with no further spawn. The header says why those three commands and what a line means (a parent
    that is no line is a trunk commit: the fork), and states the one promise the file makes about item 11:
    for a history that is a single line above trunk the two name the same layers, parents and depths; after
    a merge of two named lines item 11's count order is a guess and this file is what git says. Then the
    reader, in item 47's shape — the argv exported for the tests, the texts handed back verbatim — and the
    three parsers (`parseDag` is the first rest element in `src/`, primer §54). Then `layoutGraph`, the whole
    of plan E78 as one pure function: a branch is a member when its commit starts a line (so a merged branch,
    listed by the first command, is not — and a local trunk ahead of its remote-tracking ref is, as item 11
    has it, D59); one walk per member gives its depth (item 11's `rev-list --count`, read off the text) and
    the trunk commits it forked from (`forks`); its parent is the deepest member it can reach, by name for two
    on one commit (E6, the order of item 11's `compareByDistanceThenName`); and the rows come out depth-first,
    top first and trunk last — read `draw`'s comment (primer §81) for why the child with the most rows goes
    straight on and every other child takes the next lane and curves into this one on its lowest row
    (`joinsLane`), which is what keeps lanes from crossing and a checkout or a fetch from moving them. Then
    the small rules at the end: the checked-out row `filled` (the trunk row, when HEAD is on a branch trunk
    already contains), the working tree a `dashed` row directly above it when the caller says the tree is
    dirty (the view provider, 23d, will know that from the built-in Git extension — item 72's connection;
    this file spawns no `git status`), one `elided` row when a stack's bottom is behind trunk's tip, and
    `onlyStackOf`, plan §7.2.1's filter, meaning what git-spice means by a stack. `GraphRow` and
    `GraphLayout` at the top are what items 59 and 60 assert on and what `core/viewmodel.ts` (item 61) dresses
    with indicators and ages; nothing here is shown until 23d.
59. **`test/unit/graph.test.ts`** — the parsers and the layout as a specification against hand-written
    texts (item 5's fake only for `readGraphInput`'s three commands and E17; the rest needs no runner): the
    parsers first — empty, one line, two names on one commit, a merge's two parents, a commit with none —
    then plan E78 as a table (`it.each` over object rows, primer §78) over the shapes the views must draw,
    each a few lines of refs and DAG with readable stand-in SHAs: one stack; two stacks off trunk (which lane
    each takes, where the curve is, which stays straight); three off trunk (the second lane reused, never a
    third); a stack off a middle layer — the shape of `docs/view-lab.html`'s pane B, whose lane-0 stack is
    squash-merged and behind; a repository with only trunk; the checked-out layer, a detached HEAD, HEAD on
    trunk's tip, on a stale local trunk, on a merged branch, on a branch with no commits yet; the working-tree
    row above a checked-out row with children above it, and on trunk; the elided row present and absent, a
    stale stack that keeps lane 0 because it is the bigger; two names on one commit (E6); a merge from trunk;
    a merge of one stack branch into another (the shape where item 11 would chain differently); a merged
    branch left out; the local trunk ahead of its remote (D59's row); an orphan branch; the filter; and then
    the same table run again through the rules every layout obeys — no lane ever crosses another, every curve
    moves one lane left, every parent is drawn below, one node is filled. Read a row of the table beside its
    picture in view-lab: the rows are the picture's, top to bottom.
60. **`test/git/graph.git.test.ts`** — the three commands on real repositories (item 13's fixture): what
    they print for the Appendix A stack and how each change moves the texts — an unrelated stack
    (`addUnrelatedStack`), a branch off the middle layer (`fixture.git`), a trunk commit (`commitOnTrunk`:
    trunk's line moves, the DAG stays, the elided row appears), a detached HEAD (nothing), a merged branch
    (listed, no line) — and then the one agreement that matters: `layoutGraph` over the real texts names
    HEAD's stack exactly as `computeStack` (item 11) does — the same layers, order, parents and depths — on
    the plain fixture, with a second stack beside it, after an amend and after a squash-merge; and the one
    shape where it does not, a merge of two named lines, pinned so the condition is a fact and not a
    sentence. The unit tests pin the rules; this file checks that real git's texts are what the rules
    assume, as item 14 does for item 11.
61. **`src/core/viewmodel.ts`** — the second M6 file (item 23b), and the last pure one before the views: item 58's
    rows dressed for the two webviews, so that neither of them computes anything (plan §7.1.3). Read the header for
    the one promise — the same `RepoState`, texts and clock always give the same `StackViewModel`, and nothing here
    asks git — then the types at the top, each field with the §8 row it serves: `ViewModelInput` (what 23d will hand
    in: the state, item 58's three texts or `null` when there is no trunk, the working tree's file count from the
    built-in Git extension, the clock as a number, the §7.2.1 toggle, the trunk's behind-counts and M7's gh extras —
    the last two empty until their items), `Indicator` (ten kinds, primer §59; read each member's comment for the
    field it comes from — `down.needsRestack`, `change.comments.unresolved`, `push.ahead`, the digest's remote
    branches, M7's extras — and for the one that is not a field: ⛅ means "no remote-tracking branch of that name",
    because git-spice prints `push` only for branches it submitted itself, and for the one that is not the flag it
    looks like: `↑n` reads `push.ahead`, because `needsPush` is also true for a branch strictly behind its remote),
    the four row interfaces behind `ViewRow` (item 58's `kind`, `lane`, `node`, `joinsLane` copied unchanged, the
    facts the host reads back by name, then `indicators`, `age`, `dim`, `tooltip`, `context`), the three context
    interfaces whose keys the §7.2.1 `webview/context` menus will read in 23f, `MessageRow` and `StackViewModel`.
    Then `buildStackViewModel`: the message rows first, in the order item 70's tree decides them (no trunk ends it; a
    paused rebase replaces a detached HEAD; "Not on a stack" only when no layer row came out of the layout), then
    `layoutGraph` with `onlyStackOf` set to HEAD's branch when the toggle is on and HEAD is on a stack — here and not
    after, because a filtered row list has stale lanes — then one `ViewRow` per graph row through a `switch` on its
    `kind` (primer §82: every case returns, so a fifth row kind, 23i's, stops the file compiling until it has a case).
    Read `indicatorsFor` beside pane B of `docs/view-lab.html`: a layer's line is looked up by name in
    `enrichment.byName` (item 3's `Enrichment`, grown here, so a stack that is not HEAD's gets the same answer as HEAD's
    layers do from `tracking`), gh's extras are consulted only for a line that carries a `change`, and the three states
    of item 35's `withTracking` — an entry, absent from a complete answer, unknown — become "indicators from the line",
    the one `untracked` indicator, and no indicator at all; the list is pushed in §7.1.1's fixed order so a renderer
    never sorts. Then `formatAge` (hand-rolled, `Math.floor` — primer §27 — on a difference in seconds; the thresholds
    are the comments' `3m`, `26h`, `2d`, `1w`, `2mo`, `1y`, and anything under a minute or in the future is `now`), the
    tooltip lines, which are item 70's word for word but for one test, and the `context` objects. Nothing here is shown
    until 23d.
62. **`src/webview/protocol.ts`** — the first file in `src/webview/`, and a file with no code in it: the messages the
    extension host and the two webviews exchange, as types (plan §7.1.3 "Protocol", E79). Read the header for the
    rule this directory lives under — browser code, so no `vscode`, no Node, and from `src/core` only types — and for
    how the rule is kept: `import type` (primer §9's new paragraph), and the second layering rule in
    `eslint.config.mjs` that landed with 23c (item 94). Then the shapes: host → view `ModelMessage` — a rising
    `seq`, `repos` (one `StackViewModel` per repository in workspace order, an array even for one repository, so the
    multi-repo arrangement `docs/pending-decisions.md` item 5 proposes needs no second shape), `activeRepo`, and
    `notices` (the rows that belong to no repository: no repository at all, the Git extension unusable, git failing
    for one — §6, §7.14.3, E17 — with the host's texts); view → host `CommandMessage` (`seq`, `command`, `args`, the
    repository root first) and `MoveOntoMessage` (E77's drop, the confirm the host's). `CommandId` is the file's one
    new construct: `` `prCascade.${string}` ``, a template literal *type* (primer §83) — every string that starts with
    our prefix and nothing else, so a renderer that posts another extension's command fails to compile. The rules a
    type cannot carry — drop a message whose `seq` is stale, check the prefix on the text the host actually receives —
    are the host's (23d) and the header says so. Like item 26, `npm run typecheck` is this file's test — both of its
    runs, since item 91 checks this file under the browser's types and the host's import (23d) will check it under
    Node's.
63. **`test/unit/viewmodel.test.ts`** — the model as a specification, with no git and no git-spice: a fixture
    `RepoState` whose `enrichment.byName` holds hand-written `gs log` lines, item 59's `refs`/`dag` builders and SHAs
    for the texts, and a fixed `now`. Read it in its order: pane B of `docs/view-lab.html` as one fourteen-row model,
    then the same with no gh extras (exactly four things change — §10's "the view model already has the fields" made
    testable); one test per indicator kind with its negative — the field present, the field absent, and for ⛅ and `↑n`
    the cases the measured `push` field forces (tracked and never submitted, plain-pushed, strictly behind, untracked);
    the fixed order with every indicator on one row; the ages as an `it.each` table (primer §78) over seconds since a
    fixed clock — each threshold from both sides, and `12mo` never; the message rows and their co-occurrence (E3, E4,
    E5, E12); the working-tree row; `showOnlyThisStack` on a stack and off one; the three states of a row, git-spice's
    own trunk line among them, and a stack that is not HEAD's getting its indicators through `byName`; `dim`, the
    tooltip lines and the title; the geometry, which is item 58's for five shapes; and the input never changed —
    copied with `structuredClone` (primer §50), not `JSON.stringify`, because the input holds a `Map`.
64. **`src/webview/host.ts`** — the first file in `src/webview/` with code in it (M6 item 23c), and the only one
    that knows VS Code's side of a webview exists: `acquireVsCodeApi()`, the one function VS Code puts into every
    webview page and we never define (primer §84 — a `declare` for something the page provides, module-scoped so no
    other file can call it), is called once by `connect()`, which hands back the two things a view does with the
    host. `onModel(handler)` is a `message` listener on `window` (primer §85: the browser's globals, which the root
    `tsconfig.json` does not know and `tsconfig.webview.json` — item 91 — does) that passes on a `ModelMessage` from the page's own
    origin and ignores anything else in silence — the host is ours, and VS Code's bootstrap relays nothing but what it
    posts, with the content frame's own origin, so the check is the origin and a type predicate over three fields
    (primer §86: the tag, a numeric `seq`, a `repos` array) and nothing more. `postCommand(command, args)` posts item 62's `CommandMessage` with the `seq` of the last model it saw —
    protocol.ts's "the model the view was showing when the user acted", 0 before any — so the host (23d) can drop a
    click on a row that no longer exists (E79). Read the header for the one-frame caveat (the `seq` moves before the
    handler runs), for why `VsCodeApi` names `postMessage` alone (`getState` and `setState` exist and nothing reads
    them yet — item 26's rule), and for the three-line `declare` in place of `@types/vscode-webview`, which is under
    plan §11.3's downloads floor.
65. **`src/webview/smartlog/render.ts`** — the rail before it is a rail: `render(root, message)` replaces whatever
    `root` holds with one line of plain text per row (the node, `name`, the indicator kinds, `age`), per message row
    and per notice — the DOM as a tree of elements, primer §87: `document.createElement`, `textContent`,
    `replaceChildren`. `textContent`, never `innerHTML`: plan §7.1.3's "nothing is interpolated into markup" is this
    one property, and the test puts `<b>` in a branch name to pin it. Two repositories get a line with their root
    each, one gets none — the file draws what `repos` carries and decides nothing of `docs/pending-decisions.md` item
    5 (`activeRepo` is carried, not drawn). Item 23d shows this; item 23e rewrites this file in place into §7.1.1's
    rail, so that diff reads "plain text becomes the picture".
66. **`src/webview/smartlog/main.ts`** — the entry `esbuild.mjs` (item 92) bundles into `dist/webview/smartlog.js`:
    one line — `connect().onModel((message) => render(document.body, message))`. Everything a view is starts here;
    everything it knows arrives by message. It is the one module with a top-level side effect, which is why it has no
    test file of its own: item 93 reads it in the bundle, and 23d's `ext/views` runs the real page.
67. **`test/webview/host.test.ts`** — the bridge as a specification, under a browser that is not one: happy-dom gives
    this project a `window` and a `document` inside Node (item 96), and `helpers/fakeVsCodeApi.ts` puts a fake
    `acquireVsCodeApi` on the page (`vi.stubGlobal`, primer §65) that records what the view posts and throws on a
    second call, as VS Code's does. Read: `connect()` calls the fake once; two models dispatched on `window` reach the
    handler in order; a message of another type, no data, a string, `null`, a `model` without a `seq` or `repos`, and
    one whose `repos` is not an array do not — one probe per clause of the check; `postCommand` posts `{ type: 'command', seq, command, args }` with the last model's `seq`, 0 before any,
    a message it did not recognise moves the `seq` not at all, and a model from another origin is neither delivered
    nor counted.
68. **`test/webview/render.test.ts`** — one line per row in the model's order (a hollow layer, the working-tree row,
    a filled layer with two indicator kinds, the elided row, trunk), each line a `<div>`; the notices before a
    repository's message rows before its rows, and once before several repositories, each with a root line; a
    second `render` leaving none of the first's lines,
    and `<b>` in a name arriving as text. The rows come from `helpers/models.ts` — `layer(name, overrides)`, `trunk`,
    `workingTree`, `elided` — hand-written literals (primer §49's `Partial` and §16's spread), so a test spells only the
    field it is about; the pattern — a root mounted per test on a reset `document.body`, assertions on `textContent`
    through `Array.from(root.children, …)` (primer §25) — is the one 23e's rail tests inherit.
69. **`src/vscode/config.ts`** — the first file in `src/vscode/`: the seven `prCascade.*`
    settings — six strings, `ghPath` and `gitProtocol` the newest (M5 item 23b), and the
    `statusBar` boolean (item 74) — read out of VS Code
    into a plain object (`PrCascadeSettings`). Read it for
    the boundary it draws — settings live in VS Code's configuration API, and nothing in
    `src/core` ever sees that API — and for what happened to `gitPath` in M4: its default
    is now the empty string, which is *not* turned into `git` here any more but means
    "the git the built-in Git extension found", resolved in `src/extension.ts` with the
    connection in hand (item 72, `gitExecutable`). All of them are taken as they come: a
    wrong string fails where it is used, with a message (E4, E17); the boolean is read by
    the status bar item on each refresh. (M1's two repository-scan settings
    and their checked readers lived here until M4; primer §41 keeps the lesson.)
70. **`src/vscode/contextKeys.ts`** — two exported strings and nothing else: the names of the
    context keys `src/extension.ts`'s load listener sets and `package.json`'s `when`/`enablement`
    clauses read (M5 item 21b). Read it for why a module this small exists: a key's value cannot
    be read back (primer §74), so `test/ext/commands.test.ts` compares the manifest against these
    constants — the one check possible — and a typo in either place becomes a failing test
    instead of two commands silently enabled for ever.
71. **`src/vscode/git.d.ts`** — not ours: the built-in Git extension's public API,
    copied verbatim from VS Code's `release/1.85` tag (`extensions/git/src/api/git.d.ts`,
    MIT, Microsoft's header kept). Read only the header, `GitExtension` at the bottom
    (`enabled`, `onDidChangeEnablement`, `getAPI(1)`), `API` above it (`state`,
    `repositories`, the two repository events, `git.path`) and `Repository` / `RepositoryState`
    for a sense of what the extension deliberately does *not* read (plan §7.14). Why the
    1.85 file and why a `.d.ts` can only be imported with `import type`: primer §60.
72. **`src/vscode/gitApi.ts`** — the first M4 file, and the one M4 is built on: the
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
73. **`src/vscode/tree.ts`** — the Stack view. Four small node classes first: `LayerNode`
    (the row is the branch name and nothing else — plan §7.1, E44 — with the count, since M5
    item 20b what git-spice knows (`#12`, `needs restack`, `needs push`, `not tracked` — read
    the comment on the parts for their order and for why nothing is added while `tracking` is
    absent) and the `· current` marker as the dimmer description, `$(target)` / `$(git-branch)`
    as the icon, `stackBranchWithPR` beside `stackBranch` in the `contextValue`, and the SHAs
    only in the tooltip, with git-spice's lines after them — `trackingLines` below the class:
    the base as git-spice names it, the to-dos again for a narrow row, the pull request's link;
    since M2 it starts collapsed and carries its repository's `root`, and the comment says why),
    `FileNode` (the row under a layer,
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
74. **`src/vscode/statusbar.ts`** — the status bar item (M4 item 14, plan §7.1.0).
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
75. **`src/vscode/content.ts`** — the first of M3's two VS Code files, and the smaller:
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
76. **`src/vscode/commands.ts`** — `openDiff`, what a click on a file row does (plan
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
77. **`src/vscode/terminal.ts`** — the first file of M5 item 19b, the VS Code side of the
    git-spice offers: `runInTerminal`, a command typed into the repository's own terminal
    (`PR Cascade: <folder>`, at its root) and found again for the next step while its shell
    lives — by name *and* directory, so two repositories with one folder name keep theirs
    apart — with `cd <root> &&` in front, since the user may have changed directory in it, and a
    `usable` test so the flow can pass over a terminal it gave up waiting on. Read `TerminalLike` and `TerminalHost` for why VS Code's three terminal calls come in
    as one object (primer §72) — the `GitExtensionHost` idea of item 72 — and what that buys:
    a test's fake terminals, and a file Vitest can load.
78. **`src/vscode/login.ts`** — the setup flow (plan §4.2: "prompt → terminal → poll → re-run
    action"). Read the header for the shape and its one rule — a single fix in flight per
    repository, claimed at the click and never while a notification is open — then
    `ReadinessHost` (everything asked of VS Code, as one object: notifications with buttons,
    the quick pick, the browser, terminals, the disk — primer §73), `ReadyRequest` and
    `ReadyOutcome`, then `ReadinessFlows.ensureReady` and its `onePass`: the loop of probe → offer (item 44) →
    click → a look again (`fixIfStillNeeded`: the step may have been done meanwhile, and a second
    `gs repo init` would replace the trunk) → fix → wait → refresh → done line, until ready and
    the action runs. `runFix` for the three kinds of fix (a page the user will not let VS Code
    open ends it), `waitForStep` for the wait — the poll of item 42 over the probe, passed only
    when the probe gets *further* (`progressOf`, a `Record` over every `Readiness` kind since M5
    item 23a — primer §80 — so a member without a number does not compile; since item 23b
    `gh-missing` holds three steps — gh not found, too old, then its extension — and the look
    again at the click tells them apart), or for an install when Homebrew's
    git-spice — or gh — appears (`installAppeared`, M5 item 23b); stopped by the close of the
    fix's own terminal, then one last look — and `dispose` for the window closing. At the bottom,
    `chooseRepository` (the setup command's pick, and since M5 item 20b Track Stack's too, since
    21b Push Whole Stack's — each asks its own question through the third parameter) and
    `machineFacts` (where Homebrew is, and whether it has git-spice and gh).
79. **`test/helpers/fakeReadinessHost.ts`** — the fakes for item 78's host: terminals that
    remember every line they were sent and every `show`, count their close listeners and take
    terminals that were there before (`addExisting`), and notifications
    answered from a script (a held answer keeps one open; a notification with no button never
    settles, so a flow that awaited one would hang). No Vitest or Mocha import, so both runners
    use it.
80. **`test/unit/terminal.test.ts`** — `runInTerminal` on the fake: made, reused, replaced
    when its shell has exited or the caller says not to use it, the `cd` in front, kept apart
    across two repositories of one folder name, and terminals made elsewhere with no directory or
    a `Uri` one.
81. **`test/unit/login.test.ts`** — the flow as a specification on fake timers: the login
    flow step by step (nothing asked before 3 s, the refresh, the done line, the action), the
    timeout, the terminal closed with and without a login in its last seconds, a second click,
    a notification held open, two repositories, the chain of init then login in one terminal,
    a `git config` fix with no wait, Homebrew and the install page (declined, and opened again
    for a second click), the loop guard, what counts as passed (a stale click, a step that went
    backwards, Homebrew's git-spice appearing, how far the probe got for each kind of fix), what
    the offer is told, a probe that rejects, the window closing at each point — and, since M5
    item 23b, the gh rows: an install counted done at the extension step, the extension's at gh's
    login, gh's login at ready, Homebrew's gh ending only an install's wait, both logins in one
    terminal; then
    `chooseRepository` and `machineFacts`.
82. **`test/ext/activate.test.ts`** — inside a real VS Code: the extension is found by its
    id, activates, returns `{ provider, refresh }` (plan §9.1), and has its view and command
    registered — the view is checked by running the `prCascade.focus` command VS Code
    creates for every contributed view. Read it for the shape every extension-host test
    follows (arrange / act / assert, one idea per test, `describe`/`it` imported from
    `mocha`).
83. **`test/ext/tree.test.ts`** — the view over the fixture workspace, through the two
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
    of ours now that the Git extension finds the repositories). Last, what git-spice knows
    about each layer (M5 item 20b, E56, E57), through a fake git-spice put into the seams
    `activate()` hands out in test mode (primer §68) and `refs/spice/data` written by
    `update-ref`: the texts in their order, the `contextValue` vocabulary with a pull request,
    the tooltips' extra lines, nothing — and zero spawns — while the repository is not
    initialised, nothing when git-spice is missing or `gs log` fails, and the digest live: one
    `gs log` for two loads, one more after the ref moved, none for a checkout. Read the block's
    comment for the two rules its cases keep (the fake before the ref; everything undone in
    `finally`).
84. **`test/ext/statusbar.test.ts`** — the item live, through the handle `activate()`
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
85. **`test/ext/gitApi.test.ts`** — the built-in Git extension as the source of
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
    **`test/ext-parent/parentFolder.test.ts`**, in a VS Code launch of its own (item 89
    says why): the Git extension's own scan opens `parent/one` at its default depth and
    not `parent/deep/two`, with no setting of ours, and the view shows that stack.
86. **`test/ext/diff.test.ts`** — the diff on click, live (M3; plan §9.4 row
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
87. **`test/ext/login.test.ts`** — the setup flow live, through the command a user runs
    ("PR Cascade: Set Up git-spice") on the fixture, with a fake git-spice and a fake host put
    into the seams `activate()` hands out in test mode only (primer §68): the init offer's line
    typed, then — once the ref is written — one refresh and the next offer; the login likewise,
    ending in "ready"; a second click; a logout noticed when asked again; a changed
    `prCascade.gsPath` making a new backend; VS Code's own terminals reused. Every case ends its
    flow before it restores the fixture. Since M5 item 23a the fake answers gh too — every GitHub
    row reaches step 5 — and the ready line names both tools. Since M5 item 23b five more rows:
    a changed `prCascade.ghPath` making a new backend, gh-stack then gh's login in one terminal,
    gh installed with Homebrew, the two gh settings on the line, a GitLab repository asking nothing
    of gh.
88. **`test/ext/commands.test.ts`** — "Track Stack with git-spice" live (M5 item 20b), through
    `executeCommand('prCascade.trackStack')` on the fixture with a fake git-spice and a fake host
    in the seams: registered, and the manifest's `…` entry word for word with its `when` (and,
    since item 21b, its `enablement`, compared against item 70's constants); the three
    untracked layers tracked bottom to top — the bottom one on the trunk's local branch, each other
    on the layer below — one refresh and one sentence (E56, E83); the repository re-loaded before
    anything runs, so a branch tracked in a terminal meanwhile is left alone; a failure mid-way that
    keeps the layers before it and still refreshes once; and the refusals, each with its sentence —
    every layer tracked, not initialised (the setup command named, as a warning), no stack anywhere,
    the last load failed, trunk checked out between the load and the click, a paused rebase (E12).
    Read the header for the two timing rules — `prime()` waits for the load's `onDidLoadStates`,
    and a case that refreshed drains that refresh first thing in its `finally`, its outcome thrown
    away — and why each is load-bearing. Then "Push Whole Stack" live (M5 item 21b), in a second
    `describe`: the manifest with `enablement`; one `stack submit --no-publish --no-update-only`
    with its env and 120 s timeout after the fresh load, and the fixture's bare origin unchanged
    afterwards (the fake answered, nothing was pushed); the untracked layers tracked first; a
    track failure that pushes nothing; the refusals — a paused rebase with no submit (E12), a
    layer needing a restack, a layer the remote is ahead of (E76), not initialised, nothing
    loaded, no layers, trunk checked out between the load and the click, a detached HEAD — a
    rejected push's sentence with git's own line; one branch (the singular); git-spice's notes
    and the sentence's tail; a second click while pushing — a `SlowRunner` that extends the fake
    to hold the submit's answer back (primer §13) and opens its gate first thing in the `finally`;
    and the pick, pinned live in a nested `describe` that adds a second repository to the
    workspace the way item 85 does.
89. **`.vscode-test.mjs`** — where those workspaces come from: the fixture builder (item 13,
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

90. **`tsconfig.json`** — how `tsc` type-checks `src/`, `test/` and `scripts/` under Node's types — all but
    `src/webview` and `test/webview`, which it excludes: those are the browser's and have their own config (item 91).
    Emits nothing.
91. **`tsconfig.webview.json`** — the browser's world (M6 item 23c): the same strictness as item 90, inherited, with
    the DOM's built-in types (`lib`) and no Node types at all (`types: []`), so `document` compiles and `process` does
    not — in the tests under `test/webview` too, since vitest's own types bring no Node global in. Read the comment on
    its `exclude: []` — `exclude` is inherited from the file a config extends, and item 90's would leave this one with
    nothing to check (measured, TS18003) — the one on the four `src/core` files `protocol.ts` reaches through `import
    type`, which are checked here a second time under the browser's types (a Node type in the model's closure fails this
    run, naming a core file), and the one on the two one-line `tsconfig.json` files inside `src/webview/` and
    `test/webview/` that do nothing but `extends` this one: VS Code's TypeScript service takes the nearest
    `tsconfig.json` above a file, and without them every webview file would sit in an inferred project with the DOM on
    and `strict` off — the editor silent on what `npm run typecheck` refuses. esbuild and Vitest take the nearest
    `tsconfig.json` too (the view bundle's `"use strict"` is that chain's `strict`), which is why the two stay at
    `extends` alone. `npm run typecheck` runs both configs; the
    compiler is the first half of plan §4.1's rule and item 94 the second.
92. **`esbuild.mjs`** — how `src/extension.ts` becomes `dist/extension.js` and, since M6 item 23c, how
    `src/webview/smartlog/main.ts` becomes `dist/webview/smartlog.js` (build, watch, analyze — both bundles in every
    mode, one metafile). The host options' `target`/`external` lines explain the two constraints VS Code imposes on
    it; the view options say `platform: 'browser'`, `format: 'iife'` (one function that runs when the script loads —
    nothing to `require`, one tag under 23d's nonce) and `target: 'chrome114'` (VS Code 1.85's Electron is Chromium
    114), spell `entryPoints` as an object whose keys name the output files so item 23i's `graph` is one line, and the
    comment on `format` says where the bundle's `"use strict"` comes from. After the builds the codicons stylesheet
    and font are copied beside the view with `fs.copyFile` — read the comment for why they are copied and never
    imported, and item 106 for whose they are. `--dist <dir>` is item 93's seam.
93. **`test/unit/build.test.ts`** — plan §4.1's promise at the level that ships: `node esbuild.mjs --dist <tmp>` run
    for real (primer §28: `execFileSync` with `process.execPath`), then what it wrote, read back — the host bundle and
    one IIFE per view with a map beside each, `"use strict"` first (tsconfig's, arriving through esbuild), the `// src/…`
    comments esbuild writes above each input all under `src/webview/` and none of them `protocol.ts` (so no core code
    came along — the one guard that sees a dynamic `import()` the lint rule cannot; a `require()` is refused by lint
    and by the compiler first), no `require(` in the view where the host bundle does `require("vscode")`, and the
    codicon files copied. Into a temporary directory, never `dist/`: a test
    must not race `npm run watch`, and a fresh clone's `npm test` passes before `npm run build`.
94. **`eslint.config.mjs`** — lint rules, including the two that enforce the architecture (plan §4.1): `src/core/**`
    must not import `vscode`; and since M6 item 23c `src/webview/**` must not import `vscode`, any Node built-in —
    every name in `node:module`'s `builtinModules`, in both spellings, built in the config so a built-in added tomorrow
    is covered — or anything but types from `src/core` (`allowTypeImports`, on typescript-eslint's copy of the rule;
    ESLint's own has it too, the copy is used because the recommended TypeScript rules come from the same plugin), nor
    name one of `window`'s properties as a bare global (`no-restricted-globals` — the
    DOM lib's price, primer §85). A dynamic `import()` is beyond the rule's sight; item 93 catches it in the bundle.
    Item 95 is the test of all this.
95. **`test/unit/lint.test.ts`** — the two layering rules as a specification, through ESLint's own API over the real
    `eslint.config.mjs` on probes written in the test (a few lines of text linted as if they were a file at a path under
    `src/core/`, `src/webview/`, `src/vscode/` or `test/webview/` — the path need not exist): a `vscode` import under
    `src/core`; under `src/webview` a `vscode` import, `node:fs`, `path` and `_http_agent`, a value and a namespace
    import from core (in a `.mts` file too) — each refused by rule id — an `import type` and an inline `type` import
    from core allowed, and all seventeen of `window`'s bare names refused in one line; under `src/vscode` a `vscode`
    import and under `test/webview` a Node import allowed. The `src/core` rule has guarded the architecture since M1 and had no test until this file.
96. **`vitest.config.mts`** — the Node-side runner: `unit` and `git` projects, coverage on
    `src/core`, and, since M6 item 23c, a third project `webview` (`test/webview`) whose `environment` is happy-dom —
    a `window` and a `document` inside Node, so a renderer is tested with no browser; read the comment for why
    happy-dom and not jsdom (plan §11.3's row: both pass the table, happy-dom installs a quarter of the packages and
    has the DOM pieces the drag and width tests will reach for) and for the two facts 23e and 23h build on (nothing
    is laid out, so a width is stubbed; there is no `DragEvent`) — and why only the `git` project gets a longer
    `hookTimeout` (every real git
    command is a separate process; a `beforeAll` that builds six repositories went past the
    default once, under load). (`.mts` = TypeScript as an ES module; the header explains
    why not `.ts`.) And, since M5 item 22b, a
    `testTimeout` of thirty seconds for the same project — three git-spice calls in one test measured
    4.7 s on an idle Mac against Vitest's 5 s default.
97. **`tsconfig.ext.json`** — the extension-host tests (and `test/helpers`, which
    `.vscode-test.mjs` needs) compiled to `out/` for Mocha inside the downloaded VS Code.
98. **`.vscode/launch.json`**, **`.vscode/tasks.json`** — F5 (plan §11.2): build, then open a
    second VS Code with the extension loaded and `../fixture-repo/repo` open.
99. **`scripts/fixture.ts`** — `npm run fixture`: the fixture builder pointed at
    `../fixture-repo`, so F5 has a stack to show — with the same four changes to the top
    layer as item 89 (the `b` → `b2` move, the binary `logo.png`, the awkwardly named
    `weird #1 ü?.txt`, the deleted `f`), so F5 shows a rename, a binary file, an E11 name
    and a deletion too. The comment above its import explains
    how esbuild bundles the script into `out/` and node runs it from there (the same tool
    that builds the extension; `&&` so a bundling error is not mistaken for success) and
    why Node's own type stripping was not used.
100. **`.github/workflows/ci.yml`** — the same `npm test` (five suites since M6 item 23c; the header's list gained
    "webview") and `npm run test:ext`, on Linux and
    macOS, on every pull request and on pushes to `main` — and, since M4 item 15, `npm run
    package` between them, so a packaging problem surfaces on a PR rather than on a tag — and,
    since M5 item 22b, an install step for git-spice between `setup-node` and `npm ci`: the
    release tarball for the runner's `uname`, checksum-verified, pinned to one version in the
    job's `env`, with `PRCASCADE_REQUIRE_GS=1` so a run where the step did not take fails (one
    named test) rather than passing with the files skipped — and, since M5 item 23a,
    `PRCASCADE_REQUIRE_GH=1` with no install step: the runner images ship gh, and the require test
    in item 57 says if one stops.
101. **`.github/workflows/release.yml`** — what a pushed `v*` tag does (M4 item 15): the tag
    must equal `v` plus package.json's `version` and CHANGELOG.md must have that version's
    section, else it stops before building; then `npm test`, `npm run package`, and `gh
    release create` attaches the `.vsix` to a GitHub release whose notes are that CHANGELOG
    section. Read the header for why only `npm test` runs here, and the comment on `on:` for
    why a person pushes the tag. Since M5 item 22b the three real-git-spice files
    (`test/git/gitspice*.git.test.ts`) skip here, on purpose: this workflow installs no git-spice
    and sets no `PRCASCADE_REQUIRE_GS`, because the tag's commit has already been through ci.yml
    with them — the header says so. Plain YAML and shell, read for what it does (primer intro).
102. **`test/unit/release.test.ts`** — the release facts pinned on every `npm test` instead
    of discovered at tag time: a plain `major.minor.patch` version; CHANGELOG.md opening
    with that version's section and linking it to its release tag; the VS Code floor in
    `engines` equal to the `@types/vscode` version. The one test file that reads the
    repository's own files (`readFileSync`, primer §28) rather than importing from `src/`;
    `JSON.parse`'s answer is checked field by field (primer §51), never cast.
103. **`scripts/depcheck.mjs`** — prints the dependency card (plan §11.3) that every PR adding
    a runtime library must include. First run in M5 PRs 16 and 17 (plan §10.1 items 16–17):
    `hosted-git-info` and `zod`, measured and declined — plan D54, D55. Run again in M6 item 23c for `happy-dom` and
    `jsdom` (the first cards for a dev dependency — the plan said the §11.3 table chooses the test DOM) and for
    `@vscode/codicons`, the first card to fail a row: the licence (plan D69). Plain JavaScript that runs ahead of
    the primer: read it for what it does, not how (primer intro).
104. **`.vscodeignore`** — what is left out of the `.vsix`, so that only five root files reach a user — `package.json`,
    `README.md`, `CHANGELOG.md`, `LICENSE` and, since M6 item 23c, `THIRD-PARTY-NOTICES.md` (item 106) — and `dist/`:
    the host bundle, and under `dist/webview/` one bundle per view beside the codicon stylesheet and font; the reason
    `node_modules` never does, and why both bundles' source maps stay behind (the F5 loop reads `dist/` from this
    folder, not from the `.vsix`). Root tooling files are named one by one, so a root file this list does not name
    ships — item 105 pins the five on every `npm test`.
105. **`test/unit/vsix.test.ts`** — what reaches a user, pinned on every `npm test`: `vsce ls --no-dependencies` run
    through `node_modules/@vscode/vsce` (the same `vsce` as `npm run package`), and the root entries compared with the
    five that are meant to ship, everything else under `dist/` and no `.map` — a half that holds only on a built tree,
    so the two exclusion lines for the maps and the analyze report are pinned in `.vscodeignore`'s text as well. It
    exists because `.vscodeignore` (item
    104) names root tooling files one by one, so a new root file ships unless named — measured in 23c's design: a stray
    config file at the root was listed — and because one root file, item 106, is meant to. Passes with no `dist/` built.
106. **`THIRD-PARTY-NOTICES.md`** — what ships that is not ours: Microsoft's codicons (the font under CC BY 4.0,
    which asks for this attribution wherever the icons are distributed — here, the `.vsix` — with the licence link, the
    warranty disclaimer, the link to the material and "no changes"; the stylesheet under MIT, whose text is reproduced).
    Read it beside plan §11.3's "Icons in the webviews" row and D69: the one dependency whose licence is not on the plan's
    list, shipped with the question open for Ric.

## Where the layers live

- `src/core/` — pure logic and the git runner. No VS Code imports. Fully testable under Node.
  `model.ts` (shared types, including the §4.3 data model), `git.ts` (the runner),
  `trunk.ts` (which branch is trunk), `stack.ts` (the layers under HEAD, and whether a
  rebase is paused there), `changes.ts`
  (the files a layer changes, and which of them are binary), `uri.ts` (the parts of
  the `stackdiff:` URI that names one side of a diff), `debounce.ts` (one run for a
  burst of calls — the refresh), `forge.ts` (which forge the remote points at, and
  whether git-spice will recognise it — M5), `backend.ts` (the `StackBackend` contract, the
  `Readiness` union, `TrackResult` and `PushResult`, types only), `gsLog.ts` (the parser for `gs log short
  --all --json`, whose entries the layers carry), `command.ts` (the runner for programs other
  than git: a result, never a rejection), `shell.ts` (a command's words as one terminal line),
  `poll.ts` (the wait for a fix to take), `readinessFix.ts` (what to say and run for each way
  the probe says "not ready"), `digest.ts` (the ref text that decides whether `gs log` runs,
  and the two facts read off it: initialised, and which branch names have a remote-tracking
  branch), `version.ts` (a version as three numbers against a
  floor), `ghstatus.ts` (gh for GitHub repositories: found, its extension, its login —
  read-only), `graph.ts` (every stack in the repository as the rows the M6 views will draw: lanes,
  joins, the checked-out, working-tree and elided rows), `viewmodel.ts` (those rows dressed for the
  views: indicators from git-spice's lines, the remote refs and M7's extras, ages, dim names, tooltip
  lines, the menu context, the message rows — read by nothing in `src/` until 23d) and
  `backends/gitspice.ts` (the git-spice backend: the readiness probe, `enrich`, `track` and `push`).
  Finding the repositories was core's
  job in M1–M3 (`discovery.ts`); since M4 the built-in Git extension does it.
- `src/vscode/` — adapters: `gitApi.ts` (the built-in Git extension: repositories, its
  open/close events, each repository's "a git status completed" event relayed as one
  signal, the git executable, the E82 rows; `git.d.ts` beside it is that extension's own
  API declaration, copied), `config.ts` (settings → plain values), `contextKeys.ts` (the
  names of the two context keys the manifest's `when` and `enablement` clauses read),
  `tree.ts` (the Stack view: the layers, and under each the files it changes, cached per
  pair of commits; a click on a file runs `prCascade.openDiff`; the row above the layers
  when a rebase is paused or HEAD is detached), `content.ts` (the
  `stackdiff:` content provider: the text behind one side of a diff, through a reader it
  is handed) and `commands.ts` (`openDiff`: two `stackdiff:` URIs and the built-in
  `vscode.diff`, or the file itself for a binary) and `statusbar.ts` (`StackStatusBar`:
  `<branch> · n of N`, hidden with no repository or a failed load; a click opens the view).
  Since M5 item 19b, `terminal.ts` (`runInTerminal`: a command typed into the repository's own
  terminal, found again for the next step) and `login.ts` (`ReadinessFlows`, the setup flow —
  probe → offer → fix → wait — and `chooseRepository`, the pick the setup, Track Stack and Push
  Whole Stack commands share).
- `src/webview/` — browser code (M6): what runs inside the two webviews. No `vscode`, no Node built-ins, and from
  `src/core` only types — `eslint.config.mjs`'s second layering block (item 94) and `tsconfig.webview.json` (item
  91) enforce it, from both sides. `protocol.ts` (item 62: the messages the host and the views exchange, as types),
  `host.ts` (item 64: `connect` — the model in, a command out with the model's `seq`), `smartlog/render.ts` (item 65:
  every row as a line of plain text until 23e draws the rail) and `smartlog/main.ts` (item 66: the entry, bundled to
  `dist/webview/smartlog.js`). Nothing here is shown until 23d puts a view up.
- `src/extension.ts` — the wiring between the two: the Git extension's connection, the
  three pipelines as three functions (the stack per refresh, the files per opened layer,
  one file at one commit per side of a diff), the view, command and content-provider
  registrations, `{ provider, refresh }` for the tests — and `statusBar` and `treeView`, in test
  mode only.
- `test/unit/` (Vitest, no git), `test/webview/` (Vitest under happy-dom — a DOM in Node; no VS Code, no git;
  `helpers/` holds the fake API and the model builders the renderer tests share), `test/git/` (Vitest, real git in
  temp repos),
  `test/ext/` (Mocha inside VS Code, over the two-folder fixture workspace
  `.vscode-test.mjs` builds; `test/ext/helpers/` reaches the real Git extension's API),
  `test/ext-parent/` (Mocha inside a second VS Code launch, over the parent-folder
  workspace the same file builds — E1), `test/helpers/` (the fake git runner, the fake command
  runner and the fixture builder).
