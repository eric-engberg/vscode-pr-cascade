# Reading order

Which files to open first and why. Each PR updates this list so it always describes the
codebase as it is now, not as it was scaffolded. The TypeScript syntax you meet along the way
is explained, in this same order, in [`typescript-primer.md`](typescript-primer.md).

The plan every file header cites by section is [`pr-cascade-plan.md`](../pr-cascade-plan.md) at
the repository root; its §13 is the running log of decisions and deviations made while building.

## Start here

1. **`package.json`** — the extension manifest. VS Code reads it before any code runs:
   `main` (the one file it loads), `activationEvents` (when), `engines` (which VS Code), and
   `contributes`: the **Stack** view under Source Control (`views.scm`), the **Refresh
   Stack** command and the toolbar slot it sits in (`commands`, `menus` › `view/title`,
   `navigation@1` = an inline icon), the **Open Changes** command (`prCascade.openDiff`,
   M3 — no menu entry: a click on a file row is what runs it, item 24; the right-click
   menu is a later milestone's, plan §7.2.1), and the five settings (`configuration`:
   `prCascade.trunk`, `prCascade.gitPath`, `prCascade.remote`, and the two that shape the
   repository scan, `prCascade.repositoryScanMaxDepth` and
   `prCascade.repositoryScanIgnoredFolders`, whose `default`s must match
   `src/core/discovery.ts` — a test checks). Everything declared here is
   given code in `src/extension.ts`. The `scripts` block is every command a developer runs;
   the `devDependencies` block is the toolchain, nothing here ships.
2. **`src/extension.ts`** — the entry point and the wiring. Read it twice: now for the
   shape — `activate` builds the provider from two loader functions and the output
   channel, registers the view and the two commands, subscribes to workspace-folder
   changes, registers the `stackdiff:` content provider with a reader function, returns
   `{ provider, refresh }` — and again after item 26, when `loadRepoStates` at the
   bottom reads as the four core functions in a row: settings → `RealGitRunner` →
   `discoverRepoRoots` → `detectTrunk` → `computeStack`, one `RepoState` per repository;
   `loadChangedFiles` under it as the fifth, run for one layer when its row is opened:
   settings → `RealGitRunner` → `changedFiles`; and `loadFileAtRef` last, run for one
   side of a diff when a file row is clicked: settings → `RealGitRunner` → `git show
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
   HEAD's branch or `null`, the layers bottom to top), and `FileStatus` / `ChangedFile`,
   the row under a layer, built by `src/core/changes.ts` (item 18).
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
8. **`src/core/discovery.ts`** — workspace folders in, repository roots out, looking in
   both directions (plan §13.4). Read the doc comment on `discoverRepoRoots` for the six
   *whys*: why the scan looks *down* as well as up (`rev-parse --show-toplevel` walks up
   from a subfolder, E1b, but never down — and Ric keeps a parent folder open with the
   repositories below it, E1); why the rules and the defaults are copied from VS Code's
   built-in git extension (`git.repositoryScanMaxDepth`, `git.repositoryScanIgnoredFolders`);
   why nothing here looks for a `.git` entry — every candidate directory is asked the same
   git question and git decides, which is what makes a linked worktree work for free
   (E19); why the probes run in parallel (`Promise.all`: twenty repositories under one
   parent are twenty processes); why a repository's own subdirectories are asked too and
   deduped; and why the depth is the safety valve. Then `DiscoveryOptions` and
   `DEFAULT_DISCOVERY_OPTIONS` at the top (the one place the defaults live;
   `src/vscode/config.ts`, item 23, reads them as its fallbacks), `listCandidates` (a
   queue, one level at a time, children sorted by name, `.git` / ignored names / symlinks
   / unreadable directories skipped, and why nothing is logged),
   why only the newline git prints is removed from a root (a directory name may end in a
   space), and how `normalizeRoot` makes two spellings of one directory compare equal —
   symlinks, the macOS `/tmp` → `/private/tmp` case, a trailing slash — so the `Set`
   counts them once (E2).
9. **`test/unit/discovery.test.ts`** — the rules as a specification against the fake, in
   two blocks. The first is the up direction on made-up paths: a folder inside a
   repository (E1b), one entry per repository (E2), skipped folders, workspace order, the
   trailing-slash, newline-only and realpath-fallback rules, an unreadable folder still
   asked about, and E17 not hidden. The second builds a small directory layout in a
   temporary directory (the scan needs something real to `readdir`) and asserts *which
   directories were asked* through `git.calls`: depth 0, 1, 2 and -1; the defaults; the
   ignore list; `.git`, a symbolic link and a file never entered; workspace order then
   name order; a repository's own subdirectories deduped (E2); a failing probe below the
   folder rejecting (E17).
10. **`test/git/discovery.git.test.ts`** — the same on a real filesystem. First the up
    direction: a repository built inline with `git init`, a folder nested in it (E1b), a
    symlink to it, a linked worktree whose `.git` is a file (E19), a plain folder beside
    it, and a second repository whose name ends in a space. Then Ric's layout (E1): a
    parent folder that is not a repository with two repositories below it, found in name
    order, and not found at depth 0; a repository under `node_modules` reached when nothing
    is ignored and not found with the default ignore list (the pair scans to `-1`, because
    at depth 1 it is out of reach either way); a linked worktree one level below a plain
    folder found (E19); a repository nested inside another, both found; and the parent
    plus one of its repositories open together, listed once (E2). It keeps its own
    three-command `git init` helper rather than using the
    fixture builder (item 16): the builder always names its repository `repo` inside the
    directory it is given, which would put Ric's repositories two levels down and give
    them all the same name; and the trailing-space case needs a name of its own.
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
    this file never touches VS Code — `src/vscode/config.ts` (item 23) is what builds it.
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
    from M4). The `directory` option is for the two callers outside Vitest: the
    extension-host workspace (item 31) and `npm run fixture` (item 38). The class at the
    bottom is the first one in the codebase whose methods carry real domain logic; the
    `Fixture` interface above it is all a test ever sees.
17. **`test/git/stack.git.test.ts`** — `computeStack` on real repositories: the Appendix A
    stack as built (order, counts, parents, SHAs against `git rev-parse`, the current
    marker), an unrelated branch that must never appear (E16), a linked worktree checked
    out on the middle layer (E19), and then one fresh fixture per situation: HEAD on trunk
    (E5), detached HEAD (E3), two branches on one commit (E6), the bottom layer amended
    (E14), the bottom layer squash-merged (E15), and a tag sharing a branch's name (the
    names, `head` and SHAs are the branches', not `heads/<name>` or the tag's). The E14
    and E15 blocks document what the tree shows in those states — git's answer, until
    git-spice restacks or syncs in M8 — rather than a fix.
18. **`src/core/changes.ts`** — the first M2 file: the files one layer changes against the
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
19. **`test/unit/changes.test.ts`** — the two formats as a specification against canned
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
20. **`test/git/changes.git.test.ts`** — `changedFiles` on real repositories, one fixture
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
21. **`src/core/uri.ts`** — the first M3 file: how one side of a diff is named, as the three
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
22. **`test/unit/uri.test.ts`** — the parts as a specification: the three parts of plan
    §7.4 compared as text; exactly `root` and `ref` in the query; the one leading `/`
    added and removed; a `vscode.Uri`-shaped object accepted; the six refusals — a
    `file:` scheme (plan §9.4), a path without `/`, a query that is not JSON, one that is
    JSON but `null` or a number, no `root`, a `ref` that is not a string — each checked
    by the text of its error; and the round trip of every awkward path (spaces,
    `ünïcode/日本語`, `#`, `?`, a `%` that must not be read as an escape, a newline, a
    leading `-`, a nested path), of a root with spaces and quotes, and of the ref (E11 —
    one test per path, made from a list, so a failure names the path).
23. **`src/vscode/config.ts`** — the first file in `src/vscode/`: the five `prCascade.*`
    settings read out of VS Code into a plain object (`PrCascadeSettings`). Read it for
    the boundary it draws — settings live in VS Code's configuration API, and nothing in
    `src/core` ever sees that API; the defaults for the scan, and the shape of the two scan
    settings (`DiscoveryOptions`, which `PrCascadeSettings` extends), cross the boundary the
    other way, imported from `core/discovery.ts` — and for the two kinds of setting it holds.
    The three strings are taken as they come (a wrong one fails where it is used, with a
    message; an empty `gitPath` becomes `git`). The two scan settings are checked first,
    in `readScanMaxDepth` and `readScanIgnoredFolders`, because settings.json is typed by
    hand and VS Code hands over whatever is in it: read the doc comments for what an
    unchecked `-5`, `1.5` or a string in place of the list would have quietly done to the
    scan, and the body for why the value is read as `unknown` rather than claimed to be a
    number.
24. **`src/vscode/tree.ts`** — the Stack view. Four small node classes first: `LayerNode`
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
    failed (E17) — at the top, or under a layer). Then `StackTreeProvider`, the
    `TreeDataProvider` VS Code asks for rows: read the class comment for why it is handed
    *functions* that load the states and the files rather than the data itself, the doc
    comment on `filesByCommitPair` for the cache — keyed on the two SHAs, so an entry can
    never be wrong, emptied on refresh anyway, for memory, and plain about who consults it
    today (VS Code keeps a row's children until the next refresh) — and how `refresh` (empty
    the cache, fire the event), `getChildren` (call the loader, list a repository's
    layers, or list a layer's files) and `getTreeItem` (each node draws itself) divide the
    work. `filesForLayer` is where a layer git cannot list becomes one error row under it
    instead of a broken tree. `nodesForRepo` at the bottom is where the layers are turned
    top-first.
25. **`src/vscode/content.ts`** — the first of M3's two VS Code files, and the smaller:
    `StackDiffContentProvider`, the object VS Code asks for the text behind a
    `stackdiff:` URI. Read the class comment for what a content provider is and why the
    extension has a scheme of its own (plan §3 "Diff rendering": it works with the
    built-in git extension switched off), why it is handed a *reader function* rather
    than a git runner (the same injection as the tree's loaders — `src/extension.ts`
    owns git and settings, and a test hands in a fake), what the reader promises (`''`
    for a file the commit does not have, which is what makes E8 and E9 two empty panes
    and nothing more), and why there is no `onDidChange` (a SHA-addressed document never
    changes). The one method decodes the `vscode.Uri` with the core's `decodeStackDiff`
    — a Uri fits `UriComponents` by shape — and is `async` so a refused URI becomes a
    rejection VS Code shows in place of the document.
26. **`src/vscode/commands.ts`** — `openDiff`, what a click on a file row does (plan
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
27. **`test/ext/activate.test.ts`** — inside a real VS Code: the extension is found by its
    id, activates, returns `{ provider, refresh }` (plan §9.1), and has its view and command
    registered — the view is checked by running the `prCascade.focus` command VS Code
    creates for every contributed view. Read it for the shape every extension-host test
    follows (arrange / act / assert, one idea per test, `describe`/`it` imported from
    `mocha`).
28. **`test/ext/tree.test.ts`** — the view over the fixture workspace, through the two
    calls VS Code itself makes (`getChildren`, `getTreeItem`): the workspace's two folders
    — a nested subfolder and the root — are one repository, found (E1b) and shown once (E2),
    so the layers sit at the top level; every label is a branch name, top first, with no
    SHA in any of them (E44); `3 commits · current`, `2 commits`, `1 commit`; the target
    icon and `stackBranchCurrent` on HEAD's layer; the SHAs in the tooltips, checked
    against `git rev-parse`; and `refresh()` firing `onDidChangeTreeData` with
    `undefined`. Then the files under each layer (M2): exactly the layer's own — `A  a`,
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
    Last, the one-row messages, each test putting the fixture or a setting into the state
    and undoing it in `finally`: HEAD on trunk (E5), a configured trunk that does not exist
    (E4), a `gitPath` that does not exist (E17 — the row carries `RealGitRunner`'s own
    message).
29. **`test/ext/scanSettings.test.ts`** — the two scan settings, live: `before` builds
    Ric's layout in a temporary directory (a parent that is not a repository, the
    Appendix A stack in `alpha` and `beta` below it, a third in `group/gamma` two levels
    down) and adds the parent to the running workspace with `updateWorkspaceFolders`,
    waiting for `onDidChangeWorkspaceFolders` the way the API requires. Then: a row per
    repository, `repo`, `alpha`, `beta` (E1, E2 — workspace order, then name order);
    alpha's layers under its row; depth 0 hides the scanned ones and depth 2 reaches
    `gamma`; an ignore list is honoured; and the three fallbacks — `-5`, `1.5`, a string
    where the list belongs — each shown to give the default by an assertion that the
    unchecked value would fail (the comments say which test shows the other outcome).
    Last, the defaults in `package.json` compared with `DEFAULT_DISCOVERY_OPTIONS`. Read
    `buildRepositoryUnder` for why the fixtures are moved after being built, `withSetting`
    for the try / finally every setting test shares, and `after` for the cleanup that
    leaves the workspace as built for whichever file Mocha runs next (item 28 asserts the
    folder list).
30. **`test/ext/diff.test.ts`** — the diff on click, live (M3; plan §9.4 row
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
31. **`.vscode-test.mjs`** — where that workspace comes from: the fixture builder (item 16,
    its compiled copy under `out/`) makes the stack in a temporary directory, the top
    layer's commit is amended so it also moves `b` to `b2` (the comment says why it is
    that file — a rename only shows in a diff of two snapshots when the file exists at
    the parent — and why `--amend`), adds a small binary `logo.png` (E10; a NUL byte is
    what makes git say binary), adds a text file named `weird #1 ü?.txt` (E11 — the one
    place the name makes the whole trip from git through a `vscode.Uri` and back) and
    deletes trunk's `f` (E9); an empty `nested` folder is added inside the repository,
    and a `.code-workspace` file listing `nested` first and the root second is what the
    test VS Code opens. Cleaned up when the test process exits — a Ctrl+C during the run
    included, which the harness turns into a normal exit.

## The toolchain (read once, then only when something breaks)

32. **`tsconfig.json`** — how `tsc` type-checks `src/`, `test/` and `scripts/`. Emits nothing.
33. **`esbuild.mjs`** — how `src/extension.ts` becomes `dist/extension.js` (build, watch,
    analyze). The `target`/`external` lines explain the two constraints VS Code imposes.
34. **`eslint.config.mjs`** — lint rules, including the one that enforces the architecture:
    `src/core/**` must not import `vscode`.
35. **`vitest.config.mts`** — the Node-side runner: `unit` and `git` projects, coverage on
    `src/core`, and why only the `git` project gets a longer `hookTimeout` (every real git
    command is a separate process; a `beforeAll` that builds six repositories went past the
    default once, under load). (`.mts` = TypeScript as an ES module; the header explains
    why not `.ts`.)
36. **`tsconfig.ext.json`** — the extension-host tests (and `test/helpers`, which
    `.vscode-test.mjs` needs) compiled to `out/` for Mocha inside the downloaded VS Code.
37. **`.vscode/launch.json`**, **`.vscode/tasks.json`** — F5 (plan §11.2): build, then open a
    second VS Code with the extension loaded and `../fixture-repo/repo` open.
38. **`scripts/fixture.ts`** — `npm run fixture`: the fixture builder pointed at
    `../fixture-repo`, so F5 has a stack to show — with the same four changes to the top
    layer as item 31 (the `b` → `b2` move, the binary `logo.png`, the awkwardly named
    `weird #1 ü?.txt`, the deleted `f`), so F5 shows a rename, a binary file, an E11 name
    and a deletion too. The comment above its import explains
    how esbuild bundles the script into `out/` and node runs it from there (the same tool
    that builds the extension; `&&` so a bundling error is not mistaken for success) and
    why Node's own type stripping was not used.
39. **`.github/workflows/ci.yml`** — the same `npm test` and `npm run test:ext`, on Linux and
    macOS, on every pull request and on pushes to `main`.
40. **`scripts/depcheck.mjs`** — prints the dependency card (plan §11.3) that every PR adding
    a runtime library must include. Not used until M5. Plain JavaScript that runs ahead of
    the primer: read it for what it does, not how (primer intro).
41. **`.vscodeignore`** — what is left out of the `.vsix`; the reason `node_modules` never
    reaches a user.

## Where the layers live

- `src/core/` — pure logic and the git runner. No VS Code imports. Fully testable under Node.
  `model.ts` (shared types, including the §4.3 data model), `git.ts` (the runner),
  `discovery.ts` (workspace folders, and the directories below them → repository roots),
  `trunk.ts` (which branch is trunk), `stack.ts` (the layers under HEAD), `changes.ts`
  (the files a layer changes, and which of them are binary) and `uri.ts` (the parts of
  the `stackdiff:` URI that names one side of a diff).
- `src/vscode/` — adapters: `config.ts` (settings → plain values, checked), `tree.ts`
  (the Stack view: the layers, and under each the files it changes, cached per pair of
  commits; a click on a file runs `prCascade.openDiff`), `content.ts` (the `stackdiff:`
  content provider: the text behind one side of a diff, through a reader it is handed)
  and `commands.ts` (`openDiff`: two `stackdiff:` URIs and the built-in `vscode.diff`,
  or the file itself for a binary). Later milestones add terminals and the status bar.
- `src/extension.ts` — the wiring between the two: the three pipelines as three
  functions (the stack per refresh, the files per opened layer, one file at one commit
  per side of a diff), the view, command and content-provider registrations,
  `{ provider, refresh }` for the tests.
- `test/unit/` (Vitest, no git), `test/git/` (Vitest, real git in temp repos),
  `test/ext/` (Mocha inside VS Code, over a fixture workspace `.vscode-test.mjs` builds),
  `test/helpers/` (the fake git runner and the fixture builder).
