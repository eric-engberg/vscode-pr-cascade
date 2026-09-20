# PR Cascade — VS Code extension implementation plan

> **How to use this file.** This is a self-contained handoff document. It was written at the end
> of a long conversation and the implementing session will NOT have that conversation. Everything
> needed is here: the user's constraints, decisions already made (and why), the tested git commands,
> the fixture script, the test matrix, and the milestones. Read the whole file before writing code.
> Work milestone by milestone; each has acceptance criteria and required tests. Do not skip the
> edge-case table in §8 — every row is derived from a bug that was actually hit.

## 0. Working agreement for the implementing session

**The reader does not know TypeScript.** Ric will read every PR to learn the codebase and the
language as it's built. That drives two hard rules:

1. **Small PRs, many of them, in a stack per milestone.** Each PR is one idea, reviewable in one
   sitting (guideline: ≤ 300 lines of non-test code). Build them with **git-spice** (`gs stack submit`) — the
   tool this extension wraps — so he reviews bottom-up with correct bases and learns the backend by
   using it (the extension's own GitHub flow: `gs stack submit` then `gh stack link`, §7.13.4). Never merge a PR yourself; he
   reviews and merges. Don't start the next milestone's stack until the current one is merged.
   The PR sequence is spelled out in §10.1; the PR body template is in §10.2.
2. **Comment for a reader, not a maintainer.** Style rules in §11.1. Every file starts with a
   header that says what it's for and where it sits in the architecture; every exported function
   says *why* it exists; TypeScript syntax is explained the first time it appears in the project,
   in `docs/typescript-primer.md`, and linked from file headers. Plain over clever, always.

Also: read this whole file before writing code; run `npm test` before every push; when a §12
decision comes up, ask him rather than assuming (unless he has already said "go with the
recommendations"); when you deviate from this plan, say so in the PR body and update the plan in
the same PR.

---

## 1. Background and constraints

**Who:** Ric. Works on macOS (Apple Silicon, Homebrew at `/opt/homebrew/bin`, zsh), lives in VS Code,
likes the Source Control panel embedded in the Explorer view. Comfortable on the CLI but strongly
prefers GUI buttons for daily git operations (branch indicator, sync, create PR). Wants to "vibe code"
this — i.e. an AI agent implements it, so the project needs strong automated feedback loops (types,
tests) to catch what the agent gets wrong.

**Work environment (hard constraints):**
- **GitHub Enterprise Cloud with data residency** — the work host is `<company>.ghe.com`. This is
  GitHub-hosted (not the self-hosted Enterprise *Server*); it was mis-identified as GHES for most of
  the conversation that produced this plan. Consequences: `gh` supports it (`gh auth login --hostname
  <company>.ghe.com`, always pass `--hostname`/`GH_HOST`); features arrive roughly with github.com,
  **except that "some preview-phase features" are excluded on data residency and stacked PRs are in
  preview.** **Verified 2026-09-17: native stacked PRs and `gh stack` WORK on the work host** — a two-layer
  test stack submitted with `gh stack submit --auto` produced linked PRs with the stack icon and map.
  Stacked PRs require `gh` ≥ 2.90.0 and git ≥ 2.20.
- **Personal access tokens are prohibited** by policy. The sanctioned auth path is the `gh` CLI's
  OAuth device flow (`gh auth login --hostname <company>.ghe.com`) — **confirmed working at work
  2026-09-17** (he logged in and submitted a test stack). git-spice reuses that token via its
  "GitHub CLI" auth method, so no PAT anywhere.
- **Squash merge** is the repo merge strategy. This matters for restacking (see §8).
- Branch naming looks like `feat/FWRK-1434-otel-collector-ingress` (slashes, digits, hyphens).
- **Multi-root VS Code workspace with nested repos.** He keeps a parent folder open for browsing
  and the actual repos live in subdirectories. A tool that only scans workspace-folder roots misses
  his repos (this is exactly why the jjk extension failed for him — see Appendix C).

**Development environment:** this will be built on Ric's **personal Mac against github.com**, not on
company resources. It must therefore work identically on **github.com, GitHub Enterprise Cloud (`*.ghe.com`) and
GitLab**, with no host-specific code paths beyond forge-kind detection (§7.6) and what `gs`/`gh`
resolve themselves. github.com is the primary test target; the work host is verified by pointing the
same build at the work repo; GitLab is verified on a gitlab.com scratch project.

**Backend decision (final, 2026-09-17, third revision — read this before touching §7.13):**
**Supported forges in v1: GitHub (github.com + Enterprise Cloud incl. `*.ghe.com`) and GitLab
(gitlab.com + self-managed).** Both have a *native* stack view on the PR/MR page, which Ric considers
a deal-breaker feature. Other forges are added only when they ship a native stack view.

**One backend: git-spice** (`gs`, https://abhinav.github.io/git-spice/, v0.31.2, MIT, single Go binary)
does every stack operation on both forges. **On GitHub, the extension additionally runs
`gh stack link <bottom> … <top>` after submitting** to create GitHub's native Stack object (the layer
badge, popover and merge-box map). `gh stack link` is documented as "designed for people who manage
branches with other tools locally", takes branch names or PR numbers bottom→top, reuses existing PRs,
corrects wrong bases, and can grow an existing stack by stack number — no local `gh stack` tracking.
On GitLab nothing extra is needed: GitLab detects a stack automatically when an MR targets another
open MR's source branch, which is exactly what git-spice submits.

How we got here: (1) `gh stack` alone — GitHub-only, verified on both his hosts, but its `submit` has
no title/body flags and its `modify` is TUI-only; (2) git-spice alone — multi-forge, better in every
local respect, but cannot create GitHub's Stack object; (3) gh-stack for GitHub + git-spice for GitLab
— two backend implementations to write and test; (4) **this**: git-spice + `gh stack link`, one
backend, both native views. Verified facts about git-spice that drove it:
- Forges: GitHub (github.com + Enterprise via `spice.forge.github.url`/`apiUrl`), GitLab (gitlab.com +
  self-hosted), plus Bitbucket/Gitea/Forgejo/Azure (not supported by us in v1 — no native stack view).
- Auth with **no PAT required on GitHub**: OAuth device flow, GitHub App, Git Credential Manager, or
  **the `gh` CLI's token** (the method to use on the work host). GitLab: OAuth on gitlab.com; PAT or
  `glab` token on self-managed. Tokens live in the OS keychain.
- Machine-readable read model: `gs log short --json` / `gs log long --json` (documented schema, §7.13.2).
- Submit has `--title`, `--body`, `--draft/--no-draft`, `--fill`, `--update-only`, `--no-publish`, templates.
- `gs repo sync --restack` detects merged CRs (squash included), deletes local branches, retargets and
  restacks. `gs branch onto`, `gs branch create --below/--insert` cover surgery. `gs stack merge`.
- Works fully offline for local operations → real integration tests against the fixture repo.

**What a user must install**
| Forge | Required | Why |
|---|---|---|
| GitHub | `git`, `gs`, `gh` ≥ 2.90 + `gh extension install github/gh-stack` | `gs` for stacking; `gh` for the native stack link, the `gh`-token auth method, and status extras (draft/checks) |
| GitLab | `git`, `gs` | `gs` for stacking; GitLab draws the stack itself |

**Discovery and rendering need no tool at all.** The tree's membership is git ancestry (§5), the same
on both forges and in a repo with no remote; M1–M4 have no backend. Tools only add enrichment (PR/MR
numbers, "needs restack") and actions (create, restack, sync, merge).

**What he actually wants (verbatim intent):** *"see a visual representation of the stack and click on
it to see what changes are in that stack."* Everything else is secondary.

**Why build it:** every existing tool is blocked by a different constraint (Appendix C). Graphite
needs an Enterprise contract for non-github.com hosts; VisualJJ paywalls stacking ($10/mo) and has no
documented Enterprise support; GitButler's Enterprise integration is PAT-only; GitHub's native stacked PRs (public preview
2026-07-30) are GitHub-only; jj/jjk break the VS Code git UI and jjk can't see nested repos.
Shelling out to `git`, `gs` and `gh` sidesteps auth entirely — that is the whole reason this is tractable.

---

## 2. Scope

### v0.1 — the MVP (milestones 1–4)
- A tree view in the **Source Control** panel titled "Stack".
- Shows the stack of local branches **containing HEAD**, ordered bottom (nearest trunk) → top.
- Expanding a branch lists the files it changed **relative to its parent layer** (not to trunk).
- Clicking a file opens VS Code's native diff editor: parent-layer version vs this-layer version.
- Refresh button + automatic refresh on window focus.
- Works when the repo is a nested subfolder of a workspace folder.
- Works regardless of whether the built-in git extension is enabled.

### v0.2+ (milestones 5–8)
- "Push stack" (`gs stack submit --no-publish`: every layer, force-with-lease semantics).
- **"Create PRs" for the whole stack in one click**: pushes, then creates a PR for every layer that
  doesn't have one, bottom → top, each with the correct base. Idempotent — re-running only fills
  gaps and re-asserts bases. Per-branch "Create PR" is the same code path for one layer.
- **PR descriptions you actually edit**: one document for the whole stack, prefilled from commits and
  the repo's PR template, Cmd+Enter to create. Reviewer context is the forge's native stack view.
- Show existing PR/MR number and state per layer (`gs log --json`; GitHub-only extras via `gh`).
- **git-spice as the backend** for every stack operation, behind a `StackBackend` interface.
  **v1 supports GitHub and GitLab** — the two forges with a native stack view. On GitHub the extension
  runs `gh stack link` after submit so the PRs get the native badge/popover/merge-box map. No
  git-native backend; other forges wait for native stack support.
- Restack after amend / after squash-merge.
- Optional: show all stacks in the repo, not just the one containing HEAD.

### Non-goals (do not build)
- Creating branches or commits (VS Code and git already do this).
- Conflict resolution UI.
- Any direct forge API calls. **Never** store or request a token. Everything goes through `gs`, plus `gh` for the GitHub stack link and status extras.
- Replacing the built-in git extension. This is a *supplementary* view.

---

## 3. Decisions already made (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Language | **TypeScript**, strict mode | An earlier draft said plain JS "no build step" for a throwaway. This is now a proper project with tests; type checking is the cheapest bug-catcher for AI-written code. |
| Bundler | **esbuild** → `dist/extension.js` | Fast, standard for extensions, one config line. `tsc --noEmit` for typecheck. |
| Git access | `child_process.execFile('git', [args])` — **array args, never a shell string** | Branch names contain `/` and could contain anything; no quoting bugs. |
| Forge access | **git-spice (`gs`) via `execFile` with `--no-prompt`**; a **terminal only for `gs auth login`** and for operations that can stop on conflicts (restack, sync, onto, merge). `gh` is used for `gh stack link` and for GitHub-only status extras (draft/checks) when present. | One stacking tool for both forges, offline-capable locally, documented JSON read model. |
| Diff rendering | Own `TextDocumentContentProvider` on scheme `stackdiff:` backed by `git show <ref>:<path>` | No dependency on the built-in git extension's API, so it works with `git.enabled: false`. |
| View location | `contributes.views.scm` | User wants it next to Source Control. |
| Repo discovery | `git rev-parse --show-toplevel` **from each workspace folder**, deduped | Walks *up*, so nested repos and ancestor folders both resolve correctly. |
| Forge and host | **Derived per repo from the remote URL** (`git remote get-url <remote>`, `core/forge.ts`); host passed to `gh` as `GH_HOST`; forge kind gates GitHub-only steps | Same code path for github.com and GitHub Enterprise hosts. Never hardcode a host, never assume github.com. |
| Auth | **None in the extension.** `gs auth login` (interactive, per forge) is the only mechanism; the extension detects state with `gs auth status` and opens the login terminal on demand. On GitHub hosts it recommends the **GitHub CLI** method (reuses `gh`'s OAuth token — no PAT) or OAuth device flow. | Tokens are stored by git-spice in the OS keychain; the extension never sees one. |
| Stack membership | Branches that are ancestors of HEAD and not merged into trunk | Linear by construction; matches the user's workflow. Multi-stack is v0.2. |
| Refresh | Focus + editor-change events, debounced; manual button; refresh after own commands | `.git` is in `files.watcherExclude` by default so `FileSystemWatcher` is unreliable. |
| Stack-operation backend | **`StackBackend` interface; one implementation: `git-spice`** (§4.4, §7.13) | Multi-forge, offline-capable, documented JSON, `--title/--body` submit, built-in nav comments, squash-safe sync, non-interactive surgery. The interface stays so a second backend is additive if ever needed. |
| Read model | **`gs log short --json` (fast, local) and `gs log short --json --cr-status` (network, per refresh)** — never read `refs/spice/data` | Documented schema; the ref is declared internal and unstable. Tree membership still comes from git ancestry (§5) so untracked branches render too. |
| `gh stack` | **Not a backend; a required post-submit step on GitHub.** `gh stack link <bottom>…<top>` creates/updates GitHub's Stack object for PRs git-spice created (§7.13.4). Nothing else from it is invoked. | Native stack view without a second backend implementation; the command is documented for exactly this use. |
| Dependencies | **Prefer a well-known library over hand-rolled code when it replaces non-trivial logic or edge cases we'd get wrong; hand-roll the small, domain-specific bits.** Policy and candidate list in §11.3; every dependency is its own PR with a measured bundle-size delta. | Popular libraries are better tested than anything we'd write in a weekend, and for a learner each one is documented behavior he can read about. Bloat is real but measurable — esbuild reports exactly what each package costs. |
| Min git version | **≥ 2.38** (conservative floor) | The extension's own git use (`for-each-ref --merged --no-merged`, `--git-path`, `diff -z`) needs only ≥ 2.24; git-spice's requirement governs the rest. 2.38 is kept so `rebase --update-refs` works for anyone following Appendix B by hand. |
| Test frameworks | **Vitest** for core + git-integration (runs under node); **Mocha via `@vscode/test-electron`** for extension-host tests | VS Code's test runner mandates Mocha; Vitest is zero-config TS for everything else. |

---

## 4. Architecture

### 4.1 Layering rule (this is what makes it testable)

```
src/core/      ← NO `import * as vscode`. Pure logic + git runner. Fully testable under node.
src/vscode/    ← Adapters: TreeDataProvider, content provider, commands, terminals, config.
src/extension.ts ← activate(): wires core to vscode, returns { provider, refresh } for tests.
```

Enforce with an ESLint `no-restricted-imports` rule on `src/core/**` (forbid `vscode`).

### 4.2 Module map

```
src/core/git.ts          GitRunner interface + RealGitRunner (execFile). Env: LC_ALL=C, GIT_OPTIONAL_LOCKS=0.
src/core/discovery.ts    workspace folders → unique repo roots.
src/core/trunk.ts        trunk detection (config → origin/HEAD → candidates).
src/core/stack.ts        computeStack(): layers, order, parents, current branch, rebase-in-progress.
src/core/changes.ts      changedFiles(parent, branch): name-status -z parsing, rename, binary detection.
src/core/uri.ts          encode/decode stackdiff: URIs (pure functions).
src/core/debounce.ts     tiny debounce (pure).
src/core/prdraft.ts      generate {title, body} drafts from commits + template (pure).
src/core/template.ts     PR template lookup in gh's order over a file list (pure).
src/core/prplan.ts       render/parse the editable plan document (pure, round-trip tested).
src/vscode/prplan.ts     prcascade-prplan document, CodeLens, keybinding, workspaceState drafts.
src/core/backend.ts      StackBackend interface (§4.4) + readiness probe (§7.13.1).
src/core/backends/gitspice.ts   the git-spice implementation (§7.13).
src/core/gsLog.ts        parse `gs log short/long --json` line stream (pure; schema in §7.13.2).
src/core/forge.ts        parseRemoteUrl() → {host, owner, repo} from ssh / scp-like / https forms, forge kind
                         (github/gitlab/bitbucket/gitea/forgejo/azure/unknown), ghEnv(host) (pure).
src/core/ghstatus.ts     gh auth status / waitForLogin polling (§7.5) (pure over a runner + timers).
src/core/prs.ts          §7.7 planner: layers + status map → ordered operations (pure).
src/core/prstatus.ts     §7.8 status tiers: gs JSON + optional gh extras → per-layer status (pure).
src/core/nativeStack.ts  `gh stack link` after submit on GitHub repos — required there (§7.13.4).
src/core/model.ts        types below.
src/vscode/tree.ts       StackTreeProvider (TreeDataProvider<Node>), node classes.
src/vscode/content.ts    StackDiffContentProvider.
src/vscode/commands.ts   refresh / openDiff / createPR / pushStack / checkout.
src/vscode/terminal.ts   run a command in a named terminal, reuse if exists.
src/vscode/login.ts      the two login flows (gs §7.6, gh §7.5): prompt → terminal → poll → re-run action.
src/vscode/statusbar.ts  `<branch> · n of N` item (§7.1).
src/extension.ts
```

### 4.3 Data model (`src/core/model.ts`)

```ts
export interface StackLayer {
  name: string;          // local branch name, e.g. "feat/FWRK-1434-otel-collector-ingress"
  sha: string;
  parent: string;        // previous layer's name, or the trunk ref for the bottom layer
  parentSha: string;
  commitCount: number;   // commits in trunk..name
  isCurrent: boolean;    // HEAD is on this branch
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';

export interface ChangedFile {
  status: FileStatus;
  path: string;          // path at `branch`
  oldPath?: string;      // path at `parent` for R/C
  binary: boolean;
}

export interface RepoState {
  root: string;
  trunk: string | null;         // null → show "no trunk found" node
  head: string | null;          // branch name, or null when detached
  rebaseInProgress: boolean;
  layers: StackLayer[];         // bottom → top
}

export interface GitRunner {
  run(args: string[], cwd: string): Promise<string>;           // rejects on non-zero exit
  tryRun(args: string[], cwd: string): Promise<string | null>; // null on non-zero exit
}
```

---

### 4.4 `StackBackend` interface (`src/core/backend.ts`)

Everything that *changes* a stack or talks to a forge about a stack goes through this. The tree's
read model (§5 ancestry detection) is backend-independent and always computed from git, so M1–M4
have no backend at all. There is one implementation (git-spice); the interface exists so tests can
substitute a fake and so a second backend would be additive.

```ts
export interface StackBackend {
  readonly kind: 'git-spice';
  /** gs installed + version ok + repo initialized + auth for this host? Never throws. */
  readiness(repo: string): Promise<Readiness>;
  /** Add change (id/url/status), push state, needsRestack, tracked to layers. Degrades. */
  enrich(state: RepoState, opts: { network: boolean }): Promise<RepoState>;
  track(layers: StackLayer[]): Promise<void>;                        // adopt detected branches
  push(layers: StackLayer[]): Promise<void>;                         // gs stack submit --no-publish
  restack(from?: string): Promise<void>;                             // gs stack restack / upstack restack
  sync(): Promise<void>;                                             // gs repo sync --restack (post-merge)
  moveOnto(layer: string, base: string): Promise<void>;              // gs branch onto (upstack follows)
  insertBelow(layer: string, newBranch: string): Promise<void>;      // gs branch create --below --no-commit
  createPRs(plan: PRPlanEntry[]): Promise<CreatedPR[]>;              // gs branch submit --title/--body per layer
  setDraft(layer: string, draft: boolean): Promise<void>;            // gs branch submit --[no-]draft --update-only
  mergeBottom(method?: MergeMethod): Promise<void>;                  // gs branch merge --method
  rebaseState(): Promise<{ active: boolean; continueHint: string }>; // "gs rebase continue"
}
```
Long-running commands run through a `CommandSink`: anything that can stop on conflicts (restack,
sync, onto, merge) runs in a **terminal** so the user can resolve and `gs rebase continue`; everything
else via `execFile` with `--no-prompt`. The contract scenarios (§9.6) are written against the interface.

---

## 5. Git command reference (all of these were run and verified against a real repo)

| Purpose | Command | Notes |
|---|---|---|
| Repo root from any folder | `git rev-parse --show-toplevel` | Walks up. Fails (non-zero) outside a repo. |
| Trunk auto-detect | `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` → else first that verifies of `origin/main`, `origin/master`, `main`, `master` | `git rev-parse --verify --quiet <ref>` is the existence check. |
| Current branch | `git symbolic-ref --quiet --short HEAD` | Non-zero when detached → `head = null`. |
| Stack members | `git for-each-ref --format=%(refname:short) refs/heads --merged HEAD --no-merged <trunk>` | Ancestors of HEAD not in trunk. Includes the current branch. |
| Layer order | `git rev-list --count <trunk>..<branch>` per branch, sort ascending | Ties (two branches on one commit): stable-sort by name; treat as same layer. |
| Layer SHA | `git rev-parse <branch>` | |
| Files in a layer | `git diff --name-status -M -z <parent> <branch>` | **Use `-z`.** Entries are `STATUS\0path\0` or `R<n>\0old\0new\0`. Tree diff, not two-dot. |
| Binary detection | `git diff --numstat -z <parent> <branch>` | Lines with `-\t-\t` are binary. |
| File content at ref | `git show <ref>:<path>` | Non-zero when file absent at that ref (adds/deletes) → treat as empty string. |
| Rebase in progress | `git rev-parse --git-path rebase-merge` and `--git-path rebase-apply`, check dir exists | `--git-path` is worktree-correct; don't hardcode `.git/`. |
| Push stack | `git push --force-with-lease origin <layer1> <layer2> ...` | Never `--force`. |
| Restack after trunk moved | from top layer: `git rebase --update-refs <trunk>` | |
| Restack after bottom squash-merged | from top layer: `git rebase --update-refs --onto <trunk> <merged-branch>` | `--onto` excludes the merged commits so squash produces no phantom conflicts. Needs the merged branch's local ref to still exist. |
| Restack after amending layer X | from top layer: `git rebase --update-refs --onto X X@{1}` | Reflog cut point. See Appendix B for the tested detection logic and its bugs. |

Rows from "Push stack" down are **reference only** — git-spice performs those operations (§7.13.3); the
extension itself runs only the read-only rows plus `git checkout`, `git status --porcelain` and
`git remote get-url`. They stay here because Appendix B and the README's "what gs is doing" explanation
rely on them.

Environment for every git call: `LC_ALL=C` (stable parsing), `GIT_OPTIONAL_LOCKS=0` (don't fight the
built-in git extension over the index lock), `maxBuffer` ≥ 32 MB.

---

## 6. Repo discovery (§3 decision, spelled out)

```
for each vscode.workspace.workspaceFolders[i]:
    root = tryRun(['rev-parse','--show-toplevel'], folder.fsPath)
    if root: add to Set (normalize: realpath, trailing slash stripped)
one root  → tree top level = layers
many      → tree top level = RepoNode per root (label = basename(root)), children = layers
zero      → single informational node "No git repository in this workspace"
```
Re-run discovery on `onDidChangeWorkspaceFolders` and on manual refresh.

---

## 7. UI spec

### 7.1 Tree

```
[Stack]                                    ⟳  ⎘   (view title: refresh, create PRs)
 ├─ ◎ feat/FWRK-1434-part3   3 commits · current        ← top (furthest from trunk)
 │    ├─ M  src/collector/ingress.ts
 │    └─ A  src/collector/ingress.test.ts
 ├─ ⎇ feat/FWRK-1434-part2   1 commit
 │    └─ R  src/old.ts → src/new.ts
 └─ ⎇ feat/FWRK-1434-part1   2 commits                  ← bottom (base: origin/main)
      └─ …
```
- **Labels are always branch names, never SHAs.** (jj's hash-only display was explicitly unhelpful.)
  SHAs appear only in tooltips (`<branch> @ <short sha>\nbase: <parent> @ <short sha>`). Test asserts
  `item.label === layer.name` for every layer.
- Layers rendered **top-first** (matches `git log` orientation); tooltip shows `base: <parent>`.
- **Status bar item** (`prCascade.statusBar`, default on): `$(layers) <current branch> · 2 of 3`
  when HEAD is on a stack layer; `$(layers) not on a stack` otherwise; hidden when the repo is not
  found. Click → reveals/focuses the Stack view. Updates on the same refresh cycle as the tree. This is
  the "what branch am I on" answer independent of whether the built-in git extension is enabled.
- Current branch gets `$(target)` icon and "· current" in the description; others `$(git-branch)`.
- File nodes: label = basename, description = dirname, `resourceUri` set (so file icons + decorations
  work), status letter as a prefix in the label or via `iconPath` — pick one, keep it consistent.
- Special nodes: "No trunk found — set prCascade.trunk", "Rebase in progress — resolve it first",
  "Detached HEAD" (still shows layers), "Not on a stack" (zero layers).

### 7.2 Commands and menus

The "Where" column is the primary placement; §7.2.1 is the authoritative menu layout and wins on
any conflict.

| Command id | Title | Where | Behavior |
|---|---|---|---|
| `prCascade.refresh` | Refresh Stack | view title | Recompute everything. |
| `prCascade.openDiff` | Open Changes | file node click | `vscode.diff(left, right, "<basename> (<parent> → <branch>)")`. Binary → open the file at `branch` instead. |
| `prCascade.createPR` | Create Pull Request | inline on branch node | §7.7 algorithm restricted to this one layer (still pushes it and verifies its parent exists on the remote). |
| `prCascade.createStackPRs` | Create PRs for Stack | view title `$(git-pull-request-create)` | §7.7: push all → create every missing PR bottom→top → re-assert bases → `gh stack link` on GitHub → refresh. Progress in `window.withProgress`, cancellable between steps. |
| `prCascade.pushStack` | Push Whole Stack | `…` › Stack | backend `push` = `gs stack submit --no-publish` (force-with-lease semantics). Disabled when rebase in progress. |
| `prCascade.openPR` | Open Pull Request | context menu on branch with a PR | `vscode.env.openExternal(url)`. |
| `prCascade.createPRsFromPlan` | Create pull requests | CodeLens on the plan document; `cmd+enter` in it | Parse §7.9 document → §7.7 steps 3–6. |
| `prCascade.cancelPRPlan` | Cancel | CodeLens on the plan document | Close without creating; drafts stay in `workspaceState`. |
| `prCascade.createStackPRsAsDrafts` | Create PRs for Stack (all as drafts) | view title overflow | §7.7 with every `Draft: yes`, still opens the plan document unless mode is `auto`. |
| `prCascade.markReadyForReview` | Mark Ready for Review | context menu on a draft PR layer | backend `setDraft(layer, false)` = `gs branch submit --branch <l> --update-only --no-draft` (both forges), then refresh. |
| `prCascade.markStackReady` | Mark All Drafts Ready | view title overflow; also inline on the top layer when any draft exists | Confirm `"Mark N draft pull requests ready for review?"` listing them → `setDraft(layer, false)` for each draft in the stack, **bottom → top**, stop on first failure and report which succeeded → refresh. No-op with a message when the stack has no drafts. |
| `prCascade.moveOnto` | Move Layer and Above Onto… | `…` › Stack; layer context; **drag and drop** (§7.2.1) | §7.12 primitive. |
| `prCascade.insertBranchBelow` | Insert Branch Below… | layer context | §7.12 phase 1. |
| `prCascade.finishInsert` | Finish Insert | inline on pending-insert node | §7.12 phase 2. |
| `prCascade.cancelInsert` | Cancel Insert | inline on pending-insert node | Clears the pending record only. |
| `prCascade.relinkStack` | Relink Stack on GitHub | `…` › Pull requests (GitHub) | §7.13.4 repair: `gh stack link` with the full ordered list. |
| `prCascade.refreshNavComments` | Refresh Navigation Comments | `…` › Pull requests | `gs stack submit --update-only` — re-asserts CR bases and refreshes git-spice's navigation comments; creates nothing. |
| `prCascade.checkout` | Check Out Branch | context menu on branch | `git checkout <name>` then refresh. Refuse if working tree dirty (`git status --porcelain` non-empty) with a clear message. |

#### 7.2.1 Menu layout (mirrors the built-in Git view: few inline icons, everything else under `…`)

VS Code rule: in `view/title`, items in group `navigation` render as **inline icons**; every other
group renders inside the **`…` dropdown**, separated by group and ordered by group name then `@n`.
Keep inline to the two things used many times a day. Everything destructive or occasional goes in `…`.

**View title — inline icons (`navigation`):**
```
⟳  Refresh Stack                      navigation@1
⎘  Create PRs for Stack               navigation@2   (hidden when stack empty)
```

**View title — `…` dropdown:**
```
── 1_pullrequests ──────────────────────────────────
   Create PRs for Stack…                1_pullrequests@1
   Create PRs for Stack (all as drafts) 1_pullrequests@2
   Mark All Drafts Ready                1_pullrequests@3   (enabled only when drafts exist)
   Relink Stack on GitHub               1_pullrequests@4   (GitHub repos only)
   Refresh Navigation Comments          1_pullrequests@5   (only when navComment ≠ never)
── 2_stack ─────────────────────────────────────────
   Push Whole Stack                     2_stack@1
   Restack onto Trunk                   2_stack@2   (M8)
   Restack After Merge…                 2_stack@3   (M8)
   Sync After Amend                     2_stack@4   (M8)
   Move Layer and Above Onto…           2_stack@5   (M8)
   Sync Stack                           2_stack@6   (M8)
   Merge Bottom PR…                     2_stack@7   (M8)
   Track Stack with git-spice           2_stack@8   (only when untracked layers exist)
── 3_view ──────────────────────────────────────────
   Show All Stacks            (toggle)  3_view@1   (M9)
   Collapse All                         3_view@2
── 9_settings ──────────────────────────────────────
   PR Cascade Settings…                 9_settings@1   → opens Settings filtered to `prCascade.`
```
Every `…` item that mutates state is disabled (`enablement`) while a rebase is in progress, and
`Create PRs…` / `Push` are disabled when `gs`/remote is unavailable — and on GitHub repos also when `gh` + gh-stack are missing (E62b) — with the reason in the tooltip.
The trailing `…` in a title means "opens something before acting" (the plan document, a picker).

**Layer node — right-click context menu (`view/item/context`, `viewItem =~ /^stackBranch/`):**
```
── inline ──────────────────────────────────────────
   ⎘ Create Pull Request        inline   (viewItem == stackBranch, i.e. no PR yet)
   ↗ Open Pull Request          inline   (viewItem == stackBranchWithPR)
── 1_actions ───────────────────────────────────────
   Check Out Branch
   Create Pull Request…         (no PR yet)
   Open Pull Request            (has PR)
   Mark Ready for Review        (has draft PR)
   Insert Branch Below…         (M8)
   Move Layer and Above Onto…   (M8)
── 2_copy ──────────────────────────────────────────
   Copy Branch Name
   Copy PR URL                  (has PR)
   Open Compare on Forge        GitHub: <host>/<owner>/<repo>/compare/<parent>...<branch>
                                GitLab: <host>/<owner>/<repo>/-/compare/<parent>...<branch>
```
Pending-insert node: `contextValue = stackPendingInsert`, inline `Finish Insert` + `Cancel Insert`.

**Drag and drop (M8, added 2026-09-20 at Ric's request — the gesture Graphite and VisualJJ offer):**
a `TreeDragAndDropController` on the Stack view (`dragMimeTypes` / `dropMimeTypes` =
`application/vnd.code.tree.prCascade`). Only **layer rows** can be dragged; a layer can be dropped on
another **layer row** or on the **trunk** (the repo row in a multi-root window, or an explicit
"trunk" drop zone in the single-repo tree — decide at implementation, the test names both). A drop
means `prCascade.moveOnto(L = dragged, B = target)`, i.e. `gs branch onto <B> --branch <L> --restack
upstack` (§7.12), **after** a confirmation `Move <L> and the N layer(s) above it onto <B>?` — a rebase
that can pause on conflicts must not fire on an accidental drop. Refusals, checked before the confirm:
B is L or a descendant of L (E53, cycle); rebase in progress (E12); dirty working tree; L and B in
different repositories. File rows, message rows and the pending-insert row are neither draggable nor
drop targets. Nothing else changes: the picker command stays for keyboard users.

Layer `contextValue` vocabulary: `stackBranch`, `stackBranchWithPR`, `stackBranchWithDraftPR`, with
`Current` appended when HEAD is on it (e.g. `stackBranchWithPRCurrent`) so "Check Out" hides on the
current layer. Tests assert the exact `contextValue` for each state (it's what drives every menu).

**File node — right-click:** `Open Changes` (default click), `Open File`, `Open File at Parent`,
`Copy Path`.

**Status bar item click:** focus the view (no menu).

Additional commands introduced by this layout: `prCascade.copyBranchName`, `prCascade.copyPRUrl`,
`prCascade.openCompare`, `prCascade.collapseAll`, `prCascade.openSettings`, `prCascade.openFile`,
`prCascade.openFileAtParent`, `prCascade.toggleAllStacks` (M9). All trivial; each gets one test that
it is registered and does the obvious thing with a fake runner/env.

### 7.3 Settings

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `prCascade.trunk` | string | `""` | Trunk ref; empty = auto-detect (§5). |
| `prCascade.gitPath` | string | `"git"` | Executable path override. |
| `prCascade.ghPath` | string | `"gh"` | Executable path override. |
| `prCascade.remote` | string | `"origin"` | Remote passed to gs (`--remote`) and used for host/forge detection. |
| `prCascade.prDescriptionMode` | `"edit"` \| `"auto"` | `"edit"` | §7.7: open the plan document, or create straight from generated drafts. |
| `prCascade.prDraft` | boolean | `false` | Seeds the `Draft:` line per section (§7.9); applies to all in `auto` mode. |
| `prCascade.prTitleFrom` | `"first-commit"` \| `"last-commit"` \| `"branch-name"` | `"first-commit"` | §7.9 draft titles. |
| `prCascade.prTemplate` | string | `""` | Path override for the PR/MR template (§7.9.1); empty = discovery. |
| `prCascade.backend` | `"git-spice"` | `"git-spice"` | Reserved for future backends; only value today. |
| `prCascade.gsPath` | string | `"gs"` | git-spice executable path override. |
| `prCascade.mergeMethod` | `"repo"` \| `"squash"` \| `"merge"` \| `"rebase"` | `"repo"` | For Merge Bottom PR (`gs branch merge --method`). |
| `prCascade.nativeStackLink` | `"auto"` \| `"never"` | `"auto"` | §7.13.4; on for GitHub repos. |
| `prCascade.navComment` | `"auto"` \| `"always"` \| `"never"` | `"auto"` | git-spice navigation comment on each CR. `auto` = off on GitHub and GitLab (both have native views), on elsewhere. Passed as `--nav-comment`. |
| `prCascade.statusBar` | boolean | `true` | Show the `<branch> · n of N` status bar item. |
| `prCascade.gitProtocol` | `"https"` \| `"ssh"` | `"https"` | Passed to `gh auth login --git-protocol` in the login flow. |
| `prCascade.repositoryScanMaxDepth` | number | `1` | How many levels below each workspace folder to look for repositories: `0` only the folders themselves, `1` their immediate subfolders (the §1 parent-folder layout), `-1` no limit (bounded only by the OS process limit). Same meaning as `git.repositoryScanMaxDepth`. Added 2026-09-19 (M1 PR 8). |
| `prCascade.repositoryScanIgnoredFolders` | string[] | `["node_modules"]` | Folder names skipped while scanning. Same meaning as `git.repositoryScanIgnoredFolders`; compared exactly (case-sensitive), unlike the built-in extension's `pathEquals`. Added 2026-09-19 (M1 PR 8). |

### 7.4 `stackdiff:` URIs

```
scheme: stackdiff
path:   "/" + relPath          (so language detection from extension works)
query:  JSON.stringify({ root, ref })
```
Build with `vscode.Uri.from({...})`, not string concatenation. `decode(uri)` is a pure function in
`core/uri.ts` and must round-trip paths with spaces, unicode, and `#`/`?` characters.

### 7.5 Host resolution and `gh` auth (GitHub only; used for the required native link and the status extras)

**Host resolution (per repo, on every refresh):**
```
url  = git remote get-url <prCascade.remote>          (default origin)
host = parseRemoteUrl(url).host                        pure function in core/forge.ts
```
`parseRemoteUrl` must handle all of: `git@github.com:org/repo.git`, `ssh://git@ghes.corp.com:2222/org/repo.git`,
`https://github.com/org/repo`, `https://user@ghes.corp.com/org/repo.git`, trailing-slash and no-`.git`
variants. Returns `{ host, owner, repo }` or `null` (no remote / unparseable → PR features disabled with
a clear node, everything else still works).

**Invoking `gh`:** always `cwd = repo root` and `env.GH_HOST = host`. `gh` would usually infer the host
from the remote on its own, but setting `GH_HOST` makes multi-remote repos deterministic.

**Auth preflight (M5+, cached per refresh):** `gh auth status --hostname <host>` — exit 0 means
authenticated. Non-zero → layer descriptions show `(gh: not logged in)`, and any `gh`-backed action
triggers the **login flow** below instead of failing. `gh` missing entirely → one informational node
with the install hint (`brew install gh`). Never block the tree view on `gh` state; M1–M4 must not
touch `gh` at all.

**Login flow (one click → browser):**
1. `vscode.window.showWarningMessage("PR Cascade: not logged in to gh for <host>", "Log in", "Cancel")`.
2. "Log in" → open (or reuse) a terminal named `stack: gh login` and run
   `gh auth login --hostname <host> --web --git-protocol <prCascade.gitProtocol>`.
   `--web` makes `gh` print a one-time code and open the system browser to the OAuth page; the user
   pastes the code. This is the device/browser flow — no PAT anywhere. One or two prompts remain in
   the terminal (`Press Enter to open …`, and for `ssh` possibly an SSH-key upload question), which
   is why it runs in a visible terminal rather than a hidden `execFile`.
3. Meanwhile the extension **polls** `gh auth status --hostname <host>` every 3 s for up to 5 min
   (`core/ghstatus.ts` `waitForLogin(host, {intervalMs, timeoutMs, signal})`). On success: dispose
   the poll, show `"Logged in to <host>"`, refresh the tree, and re-run the action the user originally
   clicked (e.g. the pending `createPR`). On timeout: silent give-up; the warning reappears next click.
4. Exactly one login flow per host at a time; a second click while one is running just focuses the
   terminal.

`prCascade.gitProtocol` setting: `"https" | "ssh"`, default `"https"` (fewest prompts; `gh` then
offers to act as the git credential helper). Add to §7.3.

**Why not VS Code's built-in GitHub auth provider** (`vscode.authentication.getSession('github', …)`)?
It pops a cleaner browser flow with no code to paste — but the resulting token is held by the
*extension*, which would then have to call the GitHub API itself: duplicate auth, direct API code to
write and test, and on GitHub Enterprise hosts it requires the separate `github-enterprise.uri` setup. `gh` already
owns auth for both hosts; keep a single path. Revisit only if the copy-the-code step proves annoying.

**Recommended auth, documented in the README (the extension never does this itself):**
| Host | `gh` auth | git push auth |
|---|---|---|
| github.com | `gh auth login` → OAuth in browser (best; fine-grained scopes, revocable, no token to leak). `GH_TOKEN` env is for CI only. | SSH key (`gh auth login` can upload one), or `gh auth setup-git` to use gh as the HTTPS credential helper. |
| GitHub Enterprise (incl. `*.ghe.com`) | `gh auth login --hostname <host>` → same OAuth device flow; PATs prohibited by policy anyway. | Whatever the company mandates (usually SSH). `gh auth setup-git --hostname <host>` if HTTPS. |

Both hosts can be logged in at once; `gh auth status` lists them. The extension must work with any
combination of repos from either host open in the same workspace (E22).

**Native stacked PRs on GitHub hosts:** the required `gh stack link` step, §7.13.4 (M6).

### 7.6 Forge detection and `gs auth` (all forges)

**Forge kind + host (`core/forge.ts`, pure over the remote URL):** `github` (github.com, `*.ghe.com`,
any host with `spice.forge.github.url` set), `gitlab`, `bitbucket` (cloud vs DC by host), `gitea`,
`forgejo` (codeberg.org default), `azuredevops`, or `unknown`. git-spice detects the forge itself from
the same URL; the extension's copy exists for messaging, auth guidance, and the native-link decision.
Non-standard hosts: the user sets `spice.forge.<kind>.url` (README documents it; the extension offers
to run `git config spice.forge.github.url https://<host>` when it sees a GitHub-looking host that `gs`
didn't recognize — E70).

**Auth state:** `gs auth status` (exit 0 = logged in for this repo's forge). Not logged in → any forge
action shows `"<name>: not logged in to <forge host>" [Log in] [Cancel]`; "Log in" opens a terminal
running `gs auth login`. `gs` prompts for the method; the README says what to pick:
| Forge | Pick (v1 supports GitHub and GitLab; the other rows are for M10) |
|---|---|
| GitHub (incl. `*.ghe.com`, Enterprise) | **GitHub CLI** if `gh` is logged in to that host (no PAT), else **OAuth** (device flow in the browser). Never PAT at work. |
| GitLab.com | OAuth. Self-hosted: `glab` token or PAT (OAuth needs an admin-registered app). |
| Bitbucket Cloud | Git Credential Manager (OAuth) or API token. |
| Bitbucket DC, Gitea, Forgejo | API token (only option). |
| Azure DevOps | Azure CLI or PAT. |
The extension polls `gs auth status` every 3 s for up to 5 min after opening the terminal, then
refreshes and re-runs the pending action (same shape as §7.5's `gh` flow). Tokens live in the OS
keychain; the extension never reads them.

**Repo initialization:** `gs log short --json` fails until `gs repo init` has run. The readiness probe
(§7.13.1) detects this and offers `gs repo init --trunk <trunk> --remote <remote>` (terminal, so any
prompt is visible). Trunk comes from §5 detection.

### 7.7 "Create PRs for Stack" algorithm (M6)

Inputs: `RepoState` (layers bottom→top), forge/host, CR status map from §7.8.
```
preflight:  rebase in progress → abort with message
            gs not ready (missing / not initialized / not logged in) → readiness flow (§7.13.1, §7.6),
              then continue automatically
            untracked layers → gs branch track --base <parent> for each, bottom→top (§7.13.3)
            any layer with commitCount == 0 vs its parent → skip it, warn
1. push     gs stack submit --no-publish          (pushes every tracked branch; no CRs created)
2. describe obtain {title, body, draft} per layer-to-create via §7.9 (plan document, or generated
              drafts when prCascade.prDescriptionMode == "auto")
3. create   for layer in layers bottom→top without an open CR:
              gs branch submit --branch <name> --title <t> --body <b> --draft|--no-draft --nav-comment=<navComment>
                 (navComment: prCascade.navComment → auto = false on GitHub/GitLab, §7.10)
                 (execFile, --no-prompt; --body is an argv string — fine for PR-sized text; unicode-safe)
              on non-zero exit: stop, report "created K of N; failed at <layer>: <stderr>",
                 offer "Retry in terminal". Re-running is idempotent (gs submit is idempotent by design).
4. bases    git-spice sets each CR's base to the tracked parent; wrong bases only arise from external
              edits. `gs stack submit --update-only` re-asserts bases and refreshes nav comments.
5. link     GitHub only: gh stack link <bottom> … <top>  (§7.13.4) — required; failure is an error,
              not a warning, because the native view is the point
6. refresh  re-query §7.8, refresh tree, notification "N pull requests created" with "Open all"
```
Settings: `prCascade.prDescriptionMode`: `"edit" | "auto"` (default `"edit"`); `prCascade.prDraft`
(default `false`, seeds the plan document's `Draft:` lines). Because we pass `--body` explicitly, git-spice's
own template discovery is bypassed — the extension puts the template text into the draft itself (§7.9.1). Single-layer `createPR` runs the same function with `layers = [thatLayer]`;
git-spice pushes the parent itself if needed.

Ordering still matters and is tested: bottom → top, so each CR's base branch exists on the remote.

### 7.8 CR status per layer (M6, read-only)

Two tiers, both from `gs log short --json` (one object per line, one per tracked branch):
- **Local, every refresh (no network):** `change.id`, `change.url`, `push.needsPush`,
  `down.needsRestack`, `current`. Layers absent from the output are **untracked**.
- **Network, at most once per refresh cycle (debounced, cached 60 s):** `--cr-status` adds
  `change.status` (`open | closed | merged`) and `change.comments {resolved, unresolved, total}`.

Rendered in the layer description: `#482 · open · 2 unresolved` / `#482 · merged` / `needs push` /
`needs restack` / `not tracked`. GitHub-only extras (`isDraft`, checks, review decision) come from
`gh pr list --json` when `gh` is installed and logged in for that host; other forges show without them
in v1. Failures degrade to "no CR info" without touching the tree. `contextValue` vocabulary as in
§7.2.1.

### 7.9 PR descriptions: the editable plan document (M7)

**Principle:** one editing surface for the whole stack, the `git rebase -i` pattern — a single
document opens, you edit titles/bodies, you run "Create" from it. No sequence of input boxes (they're
single-line and modal), no webview (too much UI to build and test for a text-editing job).

The document feeds `gs branch submit --title <t> --body <b> --draft|--no-draft` per layer. Because
git-spice submit is idempotent, re-running a plan only creates what's missing.

**Generating drafts (`core/prdraft.ts`, pure):** for each layer to create,
```
title = subject of the layer's first commit (trunk..layer, oldest first);
        if the branch has one commit that's the natural PR title; otherwise still the first subject
        (setting prCascade.prTitleFrom: "first-commit" | "last-commit" | "branch-name")
body  = [commit summary]        1 commit → its body verbatim
                                 N commits → "- <subject>" per commit, then each non-empty body indented
        [blank line]
        [PR template]           §7.9.1, if one exists
```
No footer or stack list is added to the body (§7.10) — the forge's native stack view is the reviewer's map.

**The document** — a virtual doc on scheme `prcascade-prplan:` (`TextDocumentContentProvider` for
initial content, then opened as an *untitled markdown* copy so it's editable and gets markdown
tooling). Layout:
```
<!-- PR Cascade · pull request plan for repo <name> · stack of 3
     Edit the Title: lines and bodies. Run "Create pull requests" (CodeLens at top, or Cmd+Enter)
     to create them bottom → top. Delete a section to skip that branch.
     Sections marked (existing) are shown for context and are not changed. -->

===== feat/FWRK-1434-part1 → main =====
Title: refactor: extract client interface
Draft: no

Extracts the HTTP client behind an interface so retries can be added without touching call sites.

## Testing
- [ ] …                                   ← from the PR template

===== feat/FWRK-1434-part2 → feat/FWRK-1434-part1 =====  (existing #482 — not changed)
Title: feat: retry on 5xx

===== feat/FWRK-1434-part3 → feat/FWRK-1434-part2 =====
Title: feat: emit retry counters
Draft: yes
…
```
**Draft vs regular is chosen per PR** on the `Draft:` line (`yes`/`no`, case-insensitive; `true`/`false`
also accepted). It is prefilled from `prCascade.prDraft` and the plan header explains it. Missing line →
the setting's value. In `prDescriptionMode: "auto"` the setting applies to every PR. The view-title
button also has a sibling in the overflow menu, `Create PRs for Stack (all as drafts)`, for the
no-editing case. A draft PR shows `· draft` in the tree on GitHub (from the `gh` extras, §7.8; GitLab shows no draft
badge in v1) and gets a context action `prCascade.markReadyForReview` → backend `setDraft` (both forges).

Parsing (`core/prplan.ts`, pure, round-trip tested): sections split on `^===== (.+?) → (.+?) =====`;
header lines are `Key: value` pairs until the first blank line (`Title` required, `Draft` optional,
unknown keys → validation error naming the line); everything after the first blank line is the body;
missing `Title:` → first non-empty line is the title; sections whose header carries `(existing …)`
are ignored; a branch present in the plan but no longer in the stack → error before anything runs;
a stack branch missing from the document → skipped (explicit opt-out), confirmed in the summary.
The header comment is stripped. Windows line endings normalized.

**Running it:** a `CodeLensProvider` on the document contributes `Create N pull requests` and
`Cancel` at line 1; keybinding `cmd+enter` (`when: resourceScheme == prcascade-prplan` or the doc
language id `prcascade-prplan`) runs the same command. On run: parse → validate (every title
non-empty; every section maps to a layer) → hand `{layer, title, body}[]` to §7.7 steps 3–6 →
close the document on success; on failure keep it open so nothing typed is lost.

**Drafts survive:** on every document change (debounced 500 ms) the parsed sections are saved to
`workspaceState` keyed by `<repo root>|<branch>|<layer sha>`; reopening the plan for the same stack
prefills from saved drafts instead of regenerating. Cleared when that layer's PR is created.

**Single-layer `createPR`** opens the same document with one section. Existing PRs: v1 does not edit
them from this document (shown read-only); `prCascade.editPR` can come later via `gs branch submit --update-only --title/--body`.

**Optional later (not planned in detail):** an "Draft with AI" CodeLens using `vscode.lm` if a
language-model provider is available (Copilot etc.) — commits + diff → suggested body. Nice, not
required; must degrade to nothing when no provider exists.

#### 7.9.1 PR/MR template lookup (`core/template.ts`, pure over a file list)
Needed because we pass `--body` to gs (§7.7), which bypasses gs's own discovery. By forge kind:
- **GitHub** — mirror `gh`'s order: `.github/PULL_REQUEST_TEMPLATE.md`, `PULL_REQUEST_TEMPLATE.md`,
  `docs/PULL_REQUEST_TEMPLATE.md` (case-insensitive), then any `.github/PULL_REQUEST_TEMPLATE/*.md`.
- **GitLab** — `.gitlab/merge_request_templates/Default.md` (GitLab applies it automatically), then any
  other `.gitlab/merge_request_templates/*.md`.
If several: setting `prCascade.prTemplate` picks, else the first alphabetically and the plan header says which. Read at the *layer's* tree (`git show
<layer>:<path>`), not the working copy, so a template added in a lower layer applies. None → body is
the commit summary alone.

### 7.10 Stack navigation on every CR (M6)

Both supported forges have a **native** stack view (GitHub: badge + popover + merge-box map, via
§7.13.4; GitLab: header dropdown, automatic). git-spice can additionally post a **navigation comment** on each CR showing the whole stack and the CR's position,
and keeps it in sync on every submit (`spice.submit.navigationComment=true`,
`spice.submit.navigationCommentSync`). It also remembers merged CRs and lists them for dependents.
It is **off by default on GitHub and GitLab** (`prCascade.navComment: auto`) to avoid duplicating the
native view; users can turn it on. The extension does not implement its own footer.
The command is `prCascade.refreshNavComments` (**Refresh Navigation Comments**) = `gs stack submit --update-only`.
On GitHub hosts with native stacks, the native stack map (via §7.13.4) sits alongside the comment.

### 7.12 Stack surgery: inserting a layer (M8)

**Scenario this exists for:** `main ← a ← b ← c`; `a` is squash-merged; a bug in `a` must be fixed
*before* `b` merges. `a` is gone (merged), so the fix is a new CR, and it must sit **below `b`** so
`b` is based on it and `b`'s CR diff stays clean:
```
main(A′) ← a-fix ← b ← c        merge order: a-fix → b → c
```
git-spice does each step in one command:

**Primitive — `prCascade.moveOnto` "Move Layer and Above Onto…"**: pick a layer L and a base B →
`gs branch onto <B> --branch <L> --restack upstack` (terminal; conflicts pause, `gs rebase continue`).
Refuse if B is L or a descendant of L (cycle) before running anything. Then `gs stack submit
--update-only` re-asserts CR bases and nav comments.

**Guided — `prCascade.insertBranchBelow` "Insert Branch Below…"** (layer context menu). Two-phase
because the fix commit is a human step:
```
phase 1  input: new branch name (validate with `git check-ref-format --branch`)
         preflight: clean tree; if the stack is stale after a merge, run sync first (with confirm)
         gs branch checkout <L>
         gs branch create <new> --below --no-commit        (inserts between L's base and L; L and
                                                            everything above are restacked onto it)
         record pending insert in workspaceState; tree shows <new> as "pending insert — commit
           your fix, then Finish Insert"; status bar "<new> · pending insert"
phase 2  `prCascade.finishInsert`: refuse if <new> has no commits ("nothing to insert — commit first");
         gs upstack restack --branch <new> → then the Create-PRs pipeline (creates <new>'s CR with
           base = L's old base; L's CR base is updated by gs to <new>; nav comments refresh)
         clear the pending record
cancel   `prCascade.cancelInsert`: clears the record only; never deletes user work.
```
Conflicts leave git-spice's operation paused; the banner (E12/E58) says `gs rebase continue`; after
completion the next refresh finishes the CR side and clears the record.

**README (not automated):** the trivial-fix alternative (amend into `b`, then `gs upstack restack`),
and never try to reopen or amend a merged CR.

### 7.13 The git-spice backend (M5–M8)

Source: https://github.com/abhinav/git-spice — `brew install git-spice` (also apt/scoop/binary/`go install`).
Facts verified 2026-09-17 from the docs (CLI reference, config, auth, limits, JSON, changelog v0.31.2):
- Global flags: `--[no-]prompt` (**always `--no-prompt` from the extension**), `-C <dir>`, `-v`.
- State in `refs/spice/data` (declared internal — **never read it**). Tracking: `gs repo init`, then
  `gs branch track --base <parent>`, `gs downstack track`, `gs branch untrack`.
- Read model: `gs log short --json`, `gs log long --json` (§7.13.2). Also `gs review list --json`.
- Submit: `gs branch submit` / `upstack` / `downstack` / `stack submit` with `--title`, `--body`,
  `--[no-]draft`, `--fill`, `--[no-]publish`, `--[no-]update-only`, `--nav-comment=true|false|multiple`,
  `--label`, `--reviewer`, `--assign`, `--dry-run`, `--web`. Idempotent.
- Restack: `gs branch restack`, `gs upstack restack [--skip-start]`, `gs stack restack`, `gs repo restack`.
- Sync: `gs repo sync [--restack none|aboves|upstack]` — forge API detects merged/closed CRs (squash
  included), deletes local branches, retargets survivors onto the next downstack branch or trunk.
- Surgery: `gs branch onto <base> [--restack upstack]`, `gs upstack onto`, `gs branch create
  [--below|--insert] [--target] [--no-commit]`, `gs branch fold/split/squash/edit`, `gs stack edit`.
- Merge: `gs branch merge` / `downstack merge` / `stack merge` with `--method merge|squash|rebase`,
  `--ready-timeout`, `--merge-timeout`; bottom-up with automatic restack + resubmit between merges.
- Conflicts pause the operation; `gs rebase continue` / `gs rebase abort`. **Exit codes are not
  documented — verify at implementation** (contract test asserts whatever they are).
- Known limits: write access to the repo required; fork mode only submits trunk-based branches; some
  repos dismiss approvals on base change (repo setting); Bitbucket/Azure gaps for labels/assignees.
- Not provided: GitHub's native Stack object (§7.13.4 covers it).

#### 7.13.1 Readiness probe (`readiness()`, memoized per repo, re-run on refresh after failure)
```
1. gs on PATH (or prCascade.gsPath) and `gs version --short` ≥ 0.31   else "Install git-spice" offer
   → terminal `brew install git-spice` (macOS) / link to install docs; decline remembered per workspace
2. `gs log short --json` exit 0                                          else, if not initialized:
   → "Initialize git-spice for this repo?" → terminal `gs repo init --trunk <trunk> --remote <remote>`
3. `gs auth status` exit 0                                               else login flow (§7.6)
4. forge kind from core/forge.ts is `github` or `gitlab` (v1)              else CR features disabled, tree works (E75)
5. on `github`: `gh` ≥ 2.90 + gh-stack extension present                  else CR creation disabled until installed (E62b)
```
Env for every `gs` call: `NO_COLOR=1`, `LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`. Setting `prCascade.gsPath`.

#### 7.13.2 `gs log --json` schema (documented; no stability guarantee stated, so parse defensively)
One JSON object per line, one per **tracked** branch:
```
name: string            current?: true          worktree?: string
down?: { name: string, needsRestack?: boolean }        // branch below
ups?:  [{ name: string }]                              // branches above
change?: { id: "#123"|"!123", url: string, status?: "open"|"closed"|"merged",
           comments?: { resolved, unresolved, total } }   // status/comments only with --cr-status
push?:  { ahead: number, behind: number, needsPush?: boolean }
commits?: [{ sha, subject }]                           // gs log long only
```
`core/gsLog.ts` parses the stream, tolerates unknown fields, isolates a malformed line (E57).

#### 7.13.3 Operation mapping (`StackBackend` → gs)
| Method | Command(s) | Sink |
|---|---|---|
| `track(layers)` | for each detected-but-untracked layer bottom→top: `gs branch track <name> --base <parent>` | execFile |
| `enrich` | `gs log short --json` (local) / `--cr-status` (network, cached) | execFile |
| `push` | `gs stack submit --no-publish` (from the top layer; pushes all) | execFile |
| `restack(from?)` | `gs stack restack`; after amending layer X: `gs upstack restack --branch <X>` | terminal |
| `sync` | `git fetch <remote>` → **adopt any diverged branch (E76)** → `gs repo sync --restack upstack`. `gs repo sync` fetches only trunk and never notices a rewritten feature branch, so the fetch + adoption step is the extension's own, in plain git. | terminal |
| `moveOnto(L,B)` | `gs branch onto <B> --branch <L> --restack upstack`, then `gs stack submit --update-only` | terminal |
| `insertBelow` | §7.12 | terminal |
| `createPRs` | §7.7 (`gs branch submit --branch … --title … --body … --[no-]draft`) | execFile |
| `setDraft` | `gs branch submit --branch <L> --update-only --draft|--no-draft` | execFile |
| `mergeBottom` | `gs branch merge --branch <bottom> --method <m>` (method: `prCascade.mergeMethod`; `repo` = forge default when known, else prompt) | terminal |
| `rebaseState` | git's `rebase-merge`/`rebase-apply` dirs, plus however gs records a paused op (**verify in M5**) → hint `gs rebase continue` | — |

`…` › Stack gains **Sync Stack** (`gs repo sync --restack upstack`) — the one-button "make everything
right after merges" — and **Merge Bottom PR…**. "Track Stack with git-spice" appears when untracked.

#### 7.13.4 GitHub native stack link (`core/nativeStack.ts`, M6 — required on GitHub)
Docs (GitHub, "Stacked pull requests CLI commands"): `gh stack link [flags] <stack-number | branch-or-pr>
<branch-or-pr> [...]` — "Link pull requests into a stack on GitHub without local tracking … designed for
people who manage branches with other tools locally." Arguments bottom→top; existing open PRs are used;
missing ones are created with correct base chaining; wrong bases are corrected; a new Stack is created
if none exists; passing a stack number appends the remaining arguments to the top of that stack.

Extension behavior (forge kind `github` only; readiness requires `gh` ≥ 2.90 and the extension):
```
after createPRs   gh stack link <layer1> <layer2> … <layerN>      (branch names, bottom→top; env GH_HOST)
                  → record the stack number from stdout in workspaceState keyed by repo+bottom layer
after insert      re-run with the FULL ordered list (verify at implementation whether that updates the
                  existing stack or creates a duplicate — §12 item 8b; if duplicate, use
                  `gh stack unstack <old>` first, or `<stack-number>` append when the insert is at the top)
after merge/sync  nothing — GitHub retargets natively and `gs repo sync` agrees locally (E71)
repair            `prCascade.relinkStack` "Relink Stack on GitHub": re-run with the full list
status            `gh stack view --json` is NOT used (no local tracking); the tree's "linked" marker comes
                  from `gh pr view <n> --json` … field TBD — verify which PR JSON field exposes stack
                  membership (§12 item 8c); until then infer "linked" from the recorded stack number
```
Setting `prCascade.nativeStackLink: "auto" | "never"` (default `auto` = on for GitHub). `gh` not
installed / too old / extension missing on a GitHub repo → readiness offers the install; createPRs
refuses to run without it on GitHub (native view is required, so a half-done stack is worse than none).

### 7.11 `package.json` `contributes` (starting point)

```json
"name": "vscode-pr-cascade",
"displayName": "PR Cascade",
"description": "Stacked pull requests in VS Code — see the stack, click a layer for its diff, create and restack PRs on GitHub and GitLab",
"keywords": ["stacked pull requests", "stacked PRs", "PR stack", "stack", "stacked diffs",
             "GitHub stacks", "GitLab stacked merge requests", "git-spice", "gh stack", "restack",
             "pull request", "merge request"],
"categories": ["SCM Providers"],
"contributes": {
  "views": { "scm": [ { "id": "prCascade", "name": "Stack", "icon": "$(layers)" } ] },
  "commands": [
    { "command": "prCascade.refresh",   "title": "Refresh Stack",        "icon": "$(refresh)" },
    { "command": "prCascade.openDiff",  "title": "Open Changes" },
    { "command": "prCascade.createPR",  "title": "Create Pull Request",  "icon": "$(git-pull-request)" },
    { "command": "prCascade.createStackPRs", "title": "Create PRs for Stack", "icon": "$(git-pull-request-create)" },
    { "command": "prCascade.pushStack", "title": "Push Whole Stack" },
    { "command": "prCascade.checkout",  "title": "Check Out Branch" }
  ],
  "menus": {
    "view/title": [
      { "command": "prCascade.refresh",        "when": "view == prCascade", "group": "navigation@1" },
      { "command": "prCascade.createStackPRs", "when": "view == prCascade && prCascade.hasStack", "group": "navigation@2" },
      { "command": "prCascade.pushStack",      "when": "view == prCascade", "group": "2_stack@1" }
    ],
    "view/item/context": [
      { "command": "prCascade.createPR", "when": "view == prCascade && viewItem == stackBranch", "group": "inline" },
      { "command": "prCascade.checkout", "when": "view == prCascade && viewItem == stackBranch", "group": "1_actions" }
    ]
  },
  "configuration": { "title": "PR Cascade", "properties": { "...": "see §7.3" } }
},
"activationEvents": ["onStartupFinished"]
```

---

## 8. Behaviors and edge cases (each row must have a test)

| # | Situation | Required behavior |
|---|---|---|
| E1 | Repo is a nested subfolder of a workspace folder | Discovered and shown (via `--show-toplevel` from the folder). |
| E2 | Two workspace folders resolve to the same repo | Shown once. |
| E3 | Detached HEAD | Layers still computed (`--merged HEAD` works); header says "Detached HEAD"; no layer is `isCurrent`. |
| E4 | No trunk resolvable | Informational node; no crash; setting hint. |
| E5 | On trunk itself (zero layers) | "Not on a stack" node. |
| E6 | Two branches point at the same commit | Both listed, adjacent, deterministic order (by name). Second has 0 files vs first. |
| E7 | Renamed file | Left side of diff uses `oldPath`; label shows `old → new`. |
| E8 | Added file | Left pane empty, right pane content. No error surfaced. |
| E9 | Deleted file | Left pane content, right pane empty. |
| E10 | Binary file | Not opened in diff editor; opened as file (or informational message). |
| E11 | Path with spaces / unicode / `#` | URI round-trips; `git show` gets the exact path (`-z` parsing). |
| E12 | Rebase in progress | Banner node; `pushStack`/`checkout` refuse with a message. |
| E13 | Dirty working tree + checkout | Refused with message; nothing changed. |
| E14 | Bottom layer amended (descendants now stale) | After amending the bottom, the amended branch is *no longer* an ancestor of HEAD, so it drops out of the HEAD stack and the old commit shows as an unnamed layer. Render what git says; git-spice marks it `needsRestack` once tracked (M5) and M8's restack fixes it. Test documents the behavior. |
| E15 | Bottom PR squash-merged, local branch still exists | Its commits are not in trunk (squash rewrote them), so it still shows as a layer until `sync` (M8) removes it and restacks the rest. Test documents this. |
| E16 | Second, unrelated stack exists in the repo | Not shown (not ancestors of HEAD). Never mixed in. |
| E17 | `git` missing / wrong path | One clear error node, not a crash loop. |
| E18 | Large layer (1000+ files) | `-z` parsing handles it; tree renders (VS Code virtualizes). `maxBuffer` sufficient. |
| E19 | Worktree checkout (`.git` is a file) | `--git-path` used for rebase detection; discovery works. |
| E20 | Window regains focus after external git activity | View refreshes within the debounce window. |
| E21 | Remote URL in each supported form (§7.5) | `parseRemoteUrl` returns the right host/owner/repo; unparseable → `null`, PR features disabled, tree still works. |
| E22 | Workspace contains a github.com repo and a `*.ghe.com` (or other Enterprise) repo | Each repo's `gh` calls carry its own `GH_HOST`; auth status evaluated per host. |
| E23 | `gh` not authenticated for a repo's host | Tree renders fully; layer description shows the hint; any `gh` action shows the "Log in" prompt → terminal runs `gh auth login --hostname <host> --web …` → extension polls `gh auth status` and, on success, refreshes and re-runs the original action. Second click while pending only focuses the terminal. Timeout gives up silently. |
| E24 | `gh` not installed | Tree, diffs and push still work; on GitHub repos CR creation is disabled until installed (E62b); on GitLab nothing is affected. |
| E25 | Repo has no remote | Layers/diffs work; trunk falls back to local `main`/`master`; PR + push disabled with a message. |
| E26 | Stack of 3, none have PRs, "Create PRs" | Push once; three `gs branch submit` calls in bottom→top order (bases `main`, `layer1`, `layer2` come from tracking); on GitHub one `gh stack link` with all three; notification "3 pull requests created". |
| E27 | Stack of 3, middle layer already has a PR | Only two creates; existing one untouched; order still bottom→top. |
| E28 | Existing PR has the wrong base (e.g. still targets a merged/deleted branch) | Not recreated; listed in the "Fix N bases?" confirm; `gs stack submit --update-only` re-asserts bases only after confirm. |
| E29 | `gs branch submit` fails on layer 2 of 3 | Layer 1's PR stays; error names layer 2 with stderr; re-running creates only layers 2–3. |
| E30 | A layer has zero commits vs its parent (E6) | Skipped with a warning; others proceed. |
| E31 | Single-layer "Create PR" on a middle layer whose parent isn't on the remote | Parent pushed first, then PR created with the right base. |
| E32 | Not logged in when clicking "Create PRs" | Login flow runs, then the bulk operation continues without another click. |
| E33 | No PR template in the repo | Body = commit summary only; header comment says "no template found". |
| E34 | PR template exists (any of the gh lookup locations, case-insensitive) | Appended after the commit summary in each draft; read from the layer's tree. |
| E35 | User deletes a section from the plan document | That branch is skipped; the summary notification lists it; nothing else affected. |
| E36 | User edits an `(existing …)` section | Ignored in v1; the header comment says so. |
| E38 | Multi-commit layer | Draft body lists each subject as a bullet, then the non-empty bodies; title from the first commit (or per setting). |
| E39 | Plan document parse errors (missing title, unknown branch header) | Validation message naming the section; nothing created; document stays open. |
| E40 | VS Code closed / document closed with unsaved edits | Drafts restored from `workspaceState` next time the plan opens for the same stack; cleared once that PR exists. |
| E41 | Body with unicode / very long body / CRLF | The `--body` argument round-trips exactly (argv, no shell); CRLF normalized to LF before parsing. |
| E42 | `Draft: yes` on one section, `no` on another | Only that section's `gs branch submit` carries `--draft`; on GitHub the tree shows `· draft` for it; `markReadyForReview` runs `setDraft(false)` for it only. |
| E43 | `Draft:` line missing / malformed (`Draft: maybe`) | Missing → setting value; malformed → validation error naming the section, nothing created. |
| E44 | HEAD on the middle layer | Status bar reads `<middle branch> · 2 of 3`; tree marks that layer current; labels are branch names throughout. |
| E45 | Stack has 2 drafts + 1 regular PR, "Mark All Drafts Ready" | Exactly two `setDraft(false)` calls (`gs branch submit --update-only --no-draft`), bottom→top; regular PR untouched; tree loses both `· draft` markers. |
| E46 | "Mark All Drafts Ready" with no drafts in the stack | Message "no draft pull requests in this stack"; no `gs`/`gh` calls. |
| E47 | `setDraft` fails on the second of three | First stays ready; error names the failing PR; re-run only touches the remaining drafts. |
| E48 | `a` squash-merged, restacked; Insert Branch Below `b` → commit → Finish | Graph `trunk ← fix ← b ← c`; `b`/`c` patch-ids unchanged; `fix` PR created with base `main`; `b`'s PR base changed to `fix`; on GitHub the Stack is re-linked and lists 3 PRs in the new order (E72). |
| E49 | Insert between `b` and `c` | Only `c` moves; `b` untouched; `c`'s PR base → new branch. |
| E50 | Finish Insert with no commits on the new branch | Refused: "nothing to insert — commit first"; pending record kept. |
| E51 | Insert when `b` still sits on the old, merged `a` commits (E15) | Restack After Merge is chained first (with confirm), then phase 1 proceeds. |
| E52 | gs restack conflicts during Finish Insert | Rebase left in progress; banner; pending record kept; after the user completes the rebase, next refresh finishes the PR side and clears the record. |
| E53 | moveOnto with base = a descendant of L | Refused (cycle) before any git command. |
| E54 | Cancel Insert | Record cleared; branch and commits untouched; tree shows the branch as an ordinary out-of-stack branch (not shown in HEAD-only mode). |
| E55 | gs installed, repo initialized, logged in | Readiness OK; actions enabled. Any missing piece → the matching one-click fix (install / `gs repo init` / `gs auth login`) and the action re-runs after. |
| E56 | Detected stack has untracked layers | Tree shows "not tracked"; any mutating action runs `gs branch track --base` bottom→top first (a layer whose parent is also untracked is handled by the ordering). |
| E57 | `gs log --json` with a malformed line / unknown fields / stderr noise | Good lines parsed, bad line reported once, unknown fields ignored; non-zero exit → enrich degrades to "no stack info", tree still renders. |
| E58 | gs restack/sync/onto pauses on conflicts | Banner "git-spice operation paused — resolve, `git add`, then `gs rebase continue`"; mutating actions disabled; cleared on next refresh after completion. |
| E59 | Repo not initialized for git-spice | Tree works (git ancestry); CR/stack actions show the init offer; `gs repo init --trunk <detected trunk>` runs in a terminal. |
| E60 | Forge not supported by git-spice (unknown host, no `spice.forge.*.url`) | Tree and diffs work; CR features disabled with a node naming the config key to set. |
| E61 | Plan doc with mixed `Draft:` | Each `gs branch submit` carries its own `--draft`/`--no-draft`; final states match the plan; `markReady*` uses `--update-only --no-draft`. |
| E62 | git-spice not installed | One-time install offer; decline remembered; tree and diffs still work. |
| E62b | GitHub repo, `gs` present but `gh`/gh-stack missing | Readiness lists exactly what to install; CR actions disabled until then; tree and diffs work. |
| E63 | Trunk detected by §5 differs from git-spice's configured trunk | Warning node; offer `gs repo init --reset --trunk <detected>` (confirm). |
| E64 | First mutating stack operation with `rerere.enabled` unset | One-time offer to set it (global); decline remembered in `globalState`; never set silently. |
| E65 | Remote URL for each forge kind (github.com, `*.ghe.com`, gitlab.com, self-hosted GitLab, bitbucket.org, Bitbucket DC, gitea, codeberg.org, dev.azure.com) | `core/forge.ts` classifies correctly; unknown → `unknown`. |
| E66 | GitLab repo | Submit produces MRs targeting parent branches; GitLab's native stack UI auto-detects (nothing extra to do); status shows `!123`. |
| E67 | Not logged in to gs for this forge | Login prompt → terminal `gs auth login`; README guidance per forge; poll → continue pending action. |
| E68 | GitHub repo, createPRs | After the CRs exist, `gh stack link <branches bottom→top>` runs; every PR shows the native badge/map; stack number recorded. `gh` missing/old on GitHub → createPRs refuses up front with the install offer. Link failure after CRs were created → error naming the fix (`Relink Stack`). |
| E69 | PAT-only forge (Bitbucket DC / Gitea / Forgejo) | Login guidance says so plainly; the extension never requests or stores a token. |
| E70 | GitHub-looking host git-spice doesn't recognize | Offer `git config spice.forge.github.url https://<host>` then re-probe. |
| E71 | Bottom CR merged on GitHub with native stacks | GitHub retargets natively; `gs repo sync --restack` retargets/restacks locally to the same base; nav comments and native map agree. |
| E72 | Insert below on GitHub, then Finish | CRs created/updated by gs, then the stack is re-linked with the new full order; the popover shows the new layer in position (verify no duplicate stack — §12 8b). |
| E73 | `Relink Stack on GitHub` on an already-linked stack | Idempotent: no new stack, bases untouched. |
| E74 | GitLab repo, createPRs | MRs target parent branches; GitLab's header dropdown shows the stack with no extra step; no `gh` involved anywhere. |
| E75 | Bitbucket/Gitea/Forgejo/Azure repo | Tree and diffs work; CR actions show "v1 supports GitHub and GitLab" (git-spice could do it, but there is no native stack view to show). |
| E77 | Drag a layer row and drop it | Onto another layer → confirm → `moveOnto(L, B)` exactly once with the dragged and target names; onto trunk → base is the trunk ref; onto its own descendant → refused before the confirm (E53), no git call; onto a file/message row, or across repositories → no drop target, nothing runs; during a rebase or with a dirty tree → refused with the E12/E13 message; cancelling the confirm → no call. |
| E76 | A stack branch was rewritten on the remote by someone else (GitHub's "Rebase stack" button, `gh stack sync`, a co-worker's force-push) — with and without unpushed local commits | Sync Stack detects it after fetch (`push.ahead > 0 && push.behind > 0`, or neither tip an ancestor of the other) and **adopts** the remote before any restack: no unpushed work → `git branch -f <b> origin/<b>`; unpushed work → `git rebase --onto origin/<b> origin/<b>@{1} <b>` after confirming; then `gs stack restack` is a no-op. Restack/submit **refuse** while a branch is diverged and unadopted; the banner names the branch. Never force-push over a diverged remote (git-spice's lease only protects a clone that has not fetched). Procedure verified 2026-09-20, §13.4. |

---

## 9. Testing strategy

### 9.1 Layers

1. **Pure unit tests (Vitest, no git, no vscode)** — parsing and pure functions:
   `changes.ts` parsers (name-status `-z`, numstat, rename/copy scores), `uri.ts` round-trips,
   `stack.ts` ordering/parent assignment given a `FakeGitRunner` with canned outputs, `debounce.ts`.
   Target: **≥ 95 % line coverage of `src/core`**.
2. **Git integration tests (Vitest, real `git`, temp repos, no vscode)** — every row of §8 that is
   about git state. Uses the fixture builder (§9.3). Hermetic: each test gets `fs.mkdtemp`, and the
   runner env sets `HOME=<tmp>`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`,
   `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, `commit.gpgsign=false` via `-c`. Never touches the developer's
   real config.
3. **Extension-host tests (Mocha via `@vscode/test-electron`)** — launch VS Code with
   `--extensionDevelopmentPath` and a workspace pointing at a fixture repo (built in a `globalSetup`).
   Assert: extension activates; `provider.getChildren()` yields the expected layers and files;
   executing `prCascade.openDiff` opens a tab whose input is a diff with `stackdiff:` URIs
   (`vscode.window.tabGroups`); refresh command updates after an external `git commit`; nested-repo
   workspace (E1) shows the repo. Keep these few and slow-tolerant; the bulk of coverage is layers 1–2.

4. **Opt-in end-to-end tests against a real github.com scratch repo (Vitest, `test/e2e`)** — skipped
   unless `PRCASCADE_E2E_REPO=owner/repo` (GitHub) / `PRCASCADE_E2E_GITLAB=group/project` (GitLab) is
   set and `gs auth status` succeeds. Creates a throwaway branch stack, runs the real backend, asserts
   the PRs/MRs exist with the right bases (and, on GitHub, the native Stack), then closes them and
   deletes the branches. This is the only place real `gs`/`gh` mutations are allowed. Use a dedicated personal scratch repo, never a work repo. Run manually
   before tagging a release; not part of `npm test`.

`activate()` must **return** `{ provider, refresh }` so extension-host tests can reach the tree
without poking at private state.

### 9.2 Tooling / scripts

```
npm run typecheck   tsc --noEmit
npm run lint        eslint (incl. the no-vscode-in-core rule)
npm run test:unit   vitest run test/unit
npm run test:git    vitest run test/git        (requires git ≥ 2.38 on PATH)
npm run test:ext    vscode-test               (downloads VS Code; slow; needs xvfb on Linux CI)
npm run test:e2e    PRCASCADE_E2E_REPO=you/scratch vitest run test/e2e/github   (manual, real github.com)
npm run test:e2e:gitlab   PRCASCADE_E2E_GITLAB=you/scratch vitest run test/e2e/gitlab   (manual, real gitlab.com)
npm test            typecheck + lint + test:unit + test:git
npm run build       esbuild src/extension.ts --bundle --external:vscode --platform=node --outfile=dist/extension.js
npm run package     vsce package
npm run watch       esbuild --watch (dev loop, §11.2)
npm run analyze     esbuild --metafile + analyze: what each package contributes to dist/extension.js (§11.3)
npm run depcheck -- <pkg>   prints the §11.3 dependency card (downloads, dates, maintainers, deps, size, license)
npm run fixture     build a fixture repo at ../fixture-repo for the Extension Development Host
```
Vitest config: `test/unit` and `test/git` projects; coverage via `@vitest/coverage-v8` on `src/core`.

### 9.3 Fixture builder (`test/helpers/fixture.ts`)

TypeScript port of the bash script in Appendix A. API:

```ts
interface FixtureOptions {
  trunk?: 'main' | 'master';           // default main
  layers?: string[];                   // default ['api-refactor','add-retries','retry-metrics']
  remote?: boolean;                    // default true: creates a bare "origin" and fetches so origin/main exists
}
interface Fixture {
  dir: string;                         // repo root
  git(args: string[]): string;         // sync helper, hermetic env
  amend(branch: string, file: string, content: string): void;   // checkout, edit, commit --amend
  squashMergeBottomIntoTrunk(): void;  // simulates GitHub squash merge: trunk gets one new commit with the bottom layer's tree; local branch left in place
  addUnrelatedStack(name?: string): void;
  detach(): void;
  startConflictingRebase(): void;      // leaves rebase-merge dir present
  cleanup(): void;
}
export function buildStack(opts?: FixtureOptions): Fixture;
```
Every layer commits one distinct file (`a`, `b`, `c`, …) so file lists are trivially assertable.

### 9.4 Test matrix (IDs map to §8; each becomes at least one test)

| Test file | Covers |
|---|---|
| `unit/changes.test.ts` | name-status `-z` parsing: A/M/D/T, `R100`, `C075`, paths with spaces/unicode/`#`/`?`, empty output, trailing NUL; numstat binary detection (E7, E8, E9, E10, E11) |
| `unit/uri.test.ts` | encode/decode round-trip incl. E11 chars; rejects foreign schemes |
| `unit/stack.test.ts` | ordering by count, tie-break by name (E6), parent chain, `isCurrent`, detached (E3), zero layers (E5), fake runner failures (E17) |
| `unit/trunk.test.ts` | config wins → origin/HEAD → candidates → null (E4) |
| `unit/discovery.test.ts` | dedupe (E2), nested folder resolves (E1, with fake runner) |
| `unit/debounce.test.ts` | coalescing, trailing call |
| `unit/ghstatus.test.ts` | fake runner: exit 0 / non-zero / ENOENT → authenticated / not-logged-in / not-installed (E23, E24); `waitForLogin` with fake timers: resolves on first success, rejects on timeout, stops polling when aborted, one in-flight poll per host |
| `unit/prs.test.ts` | §7.7 planner as a pure function: given layers + status map + forge kind → ordered list of `{track[], push, create[], reassertBases, link?}` operations; E26–E31 as table-driven cases; per-entry draft flags; `link` present only for `github`; never plans a create for a layer with an open PR |
| `unit/prstatus.test.ts` | §7.8 JSON parsing → map by head; missing fields; empty list; malformed JSON → "no PR info" |
| `git/surgery.git.test.ts` | real fixture **through the backend (real `gs`)**: `squashMergeBottomIntoTrunk()` → sync → insert below → finish; assert graph + `git patch-id` stability (E48); middle insert (E49); cycle refusal (E53); conflict path leaves gs paused and the record kept (E52) |
| `ext/insert.test.ts` | phase 1 creates branch + pending node + status bar text; Finish refuses without commits (E50); chains Restack After Merge when stale (E51, fake runner); after Finish the PR pipeline is invoked with the expected create/fix operations; cancel (E54) |
| `ext/dragdrop.test.ts` | the controller's `handleDrag` puts the layer in the data transfer under the view's MIME type; `handleDrop` on a layer/trunk target calls `moveOnto` with (L, B) after the confirm (fake backend records argv); every E77 refusal produces no call; file/message rows are not drop targets; the picker command and the drop share one code path |
| `unit/gsLog.test.ts` | §7.13.2 stream parsing: full objects, minimal objects, `--cr-status` fields, unknown fields tolerated, malformed line isolated (E57), CRLF, empty output |
| `unit/readiness.test.ts` | every branch of §7.13.1 with a fake runner (E55, E59, E62, E67); memoization; version parsing |
| `unit/forge.test.ts` | every URL form (E21, E65): ssh, scp-like, https, ports, `user@`, no `.git`, trailing slash, garbage → null; forge kind per host; `spice.forge.*.url` override; `ghEnv()` sets `GH_HOST` |
| `ext/nativeStack.test.ts` | fake runner: `gh stack link` argv is branch names bottom→top with `GH_HOST`; stack number parsed and recorded; re-link after insert uses the full new order (E72); relink idempotent (E73); refuses createPRs on GitHub when gh/gh-stack missing (E62b); never runs on GitLab (E74) |
| `ext/backend-gitspice.test.ts` | fake runner: exact argv + env for every §7.13.3 row; `--no-prompt` on every call; track-before-mutate ordering (E56); conflict pause → banner (E58); mixed drafts (E61); merge method selection; never reads `refs/spice/data` |
| `git/gitspice.git.test.ts` | **real `gs` against the fixture, offline** (git-spice needs no network for local ops): `repo init`, `branch track`, `log short --json` schema, `upstack restack` after amending the bottom (patch-ids stable), `branch onto`, `branch create --below --no-commit` + commit + restack (E48/E49 graph assertions), conflict pause + `rebase continue`. Skipped with a clear message if `gs` is not installed; CI installs it. |
| `e2e/gitspice.github.e2e.test.ts` | opt-in scratch repo on github.com: createPRs with mixed drafts → PRs with correct bases, titles/bodies from the plan → native link (E68: badge + map) → `markStackReady` → all ready → re-run createPRs → nothing created → `gs branch merge --method squash` bottom → `sync` → bases retargeted, native map agrees (E71) → insert below → finish → cleanup |
| `e2e/gitspice.gitlab.e2e.test.ts` | scratch project on gitlab.com (`PRCASCADE_E2E_GITLAB=group/project`): same flow minus native link; asserts GitLab's stack detection via the MR API (E66, E74). **Required before a release** — GitLab is a supported forge, so Ric needs a gitlab.com account for this. |
| `ext/markReady.test.ts` | fake runner: E45–E47; confirm dialog cancel → no calls; ordering asserted |
| `ext/createStackPRs.test.ts` | fake runner records argv sequence; asserts exact order (`track` → `submit --no-publish` → `branch submit` ×N → `gh stack link` on github only) and env (`--no-prompt`; `GH_HOST` on the link); mid-sequence failure stops and reports (E29); re-run is idempotent; cancel between steps; login flow then continue (E32) — never calls real `gs`/`gh` |
| `unit/prdraft.test.ts` | draft generation from commit lists: 1 commit vs N; title source setting; template appended; E33, E34, E38 |
| `unit/prplan.test.ts` | `Draft:` yes/no/true/false/missing/malformed (E42, E43); render → parse round-trip; user edits (extra blank lines, no `Title:`, deleted section, CRLF, unicode); existing sections ignored; unknown header → error; E35, E36, E39, E41 |
| `unit/template.test.ts` | mirrors git-spice's template discovery for *display* in the plan doc (`spice.submit.template`, `.github/PULL_REQUEST_TEMPLATE*`, GitLab `.gitlab/merge_request_templates/`); when unsure the doc says "git-spice will apply the repo template" rather than guessing |
| `ext/prplan.test.ts` | command opens a `prcascade-prplan` document with the expected sections; CodeLens present; running it calls the runner with parsed `--title` and a `--body` argument equal to the edited body; drafts persisted to `workspaceState` and restored (E40); cancel closes without calls |
| `ext/login.test.ts` | fake terminal + fake runner: "Log in" runs `gs auth login` (and `gh auth login --hostname` for the native-link/extras path); pending action re-runs after status flips to 0; second click focuses existing terminal; never calls real `gs`/`gh` |
| `git/remote.git.test.ts` | fixture with no remote (E25); with bare origin; two remotes with `prCascade.remote` selecting the second |
| `git/stack.git.test.ts` | real 3-layer fixture: layers, order, parents, counts; E3, E5, E6, E14, E15, E16, E19 |
| `git/changes.git.test.ts` | real diffs: E7, E8, E9, E10, E11, E18 (generate 1500 files) |
| `git/rebase.git.test.ts` | E12 detection via `--git-path`; worktree variant (E19) |
| `git/trunk.git.test.ts` | origin/HEAD present/absent; master-only repo; no remote |
| `ext/activate.test.ts` | activates, view registered, provider returned |
| `ext/menus.test.ts` | `package.json` menus parsed: exactly two `navigation` items in `view/title`; every other title item has a group from §7.2.1; every `view/item/context` item's `when` references a known `contextValue`; every command in menus is registered on activation; layer `contextValue` matches spec for each state (no PR / PR / draft PR × current or not) |
| `ext/statusbar.test.ts` | text is `<branch> · n of N` on each layer (E44); "not on a stack" on trunk; hidden with no repo; click focuses the view |
| `ext/tree.test.ts` | every layer label equals its branch name, no SHA in any label (E44); children match fixture; nested-repo workspace (E1); refresh after external commit (E20) |
| `ext/diff.test.ts` | openDiff opens a diff tab with `stackdiff:` URIs; content provider returns file text; added file → empty left |
| `ext/commands.test.ts` | checkout refuses on dirty tree (E13); pushStack refuses during rebase (E12) — assert message, don't actually push |

Milestones 5–8: every `gs`/`gh` invocation is asserted by injecting a fake runner/terminal and checking
the exact argv and env; unit and extension-host tests never call the real tools. Only `git/gitspice.git`
(offline, local) and the e2e suites run real `gs`.

### 9.6 Backend contract tests

One scenario table written against the `StackBackend` interface, run two ways: (a) fake runner —
exact `gs` argv/env sequence; (b) real `gs` on the fixture, offline — git post-conditions (graph,
patch-ids, tracked bases via `gs log --json`). Scenarios: track; push; trunk moved; bottom
squash-merged (simulated locally; the forge-side `sync` path is e2e); amend bottom / middle; insert
below bottom / between; createPRs with mixed drafts (fake only); conflict pause + continue; **remote
rewritten by another clone (E76): nothing unpushed → adopted by `branch -f`; unpushed commit → replayed
by `rebase --onto`; a submit attempted before adoption is refused.** CI installs git-spice so (b) always
runs.

### 9.5 CI

The extension's own repo lives on **github.com** (personal), so GitHub Actions is the primary CI:
matrix `ubuntu-latest` + `macos-latest`; steps: checkout → node 20 → `npm ci` → `npm test` →
`xvfb-run -a npm run test:ext` on Linux, plain on macOS. Cache the VS Code download. CI installs git-spice (`brew install git-spice` on macOS, release binary on Linux) so the real-`gs`
suites run. The e2e suites (GitHub and GitLab) are **not** run in CI (they need a logged-in `gs`); they are a manual pre-release step. Tag → build →
`vsce package` → attach the `.vsix` to a GitHub release so it can be installed on the work Mac with
`code --install-extension`.

---

## 10. Milestones with acceptance criteria

Each milestone is one git-spice stack of small PRs (§10.1): implement → tests listed → `npm test`
green → manual check in the Extension Development Host (F5) against the fixture repo → PR.

**M1 — Skeleton + layer list.**
Project scaffold (§11), `GitRunner`, discovery, trunk, `computeStack`. Tree shows layer names
in order with commit counts and the current marker. Tests: `unit/stack`, `unit/trunk`,
`unit/discovery`, `git/stack`, `git/trunk`, `ext/activate`.
*Done when:* the fixture stack renders top-first with correct counts; nested-repo workspace shows it.

**M2 — Files per layer.**
`changedFiles` with `-z` parsing, rename and binary detection, per-layer cache keyed on
`(parentSha, sha)`. Tests: `unit/changes`, `git/changes`, `ext/tree`.
*Done when:* expanding each layer shows exactly its own files (not cumulative), renames show `old → new`.

**M3 — Diff on click.** ← the milestone the user actually asked for
`stackdiff:` content provider, `uri.ts`, `openDiff`. Tests: `unit/uri`, `ext/diff`.
*Done when:* clicking a file opens native diff, parent vs layer; adds/deletes/renames/binary all behave per §8.

**M4 — Refresh + state nodes + status bar.**
Debounced focus/editor refresh, manual button, rebase-in-progress / detached / no-trunk / no-stack
nodes, and the `<branch> · n of N` status bar item (§7.1). Tests: `unit/debounce`, `git/rebase`, `ext/tree` (E20, E44), `ext/statusbar`, `ext/commands` (E12).
*Done when:* `git commit` in a terminal → alt-tab back → tree updates without clicking refresh.
**→ Ship v0.1 here. Use it for a week before continuing.**

**M5 — Backend interface + git-spice readiness + push + login flows.**
`core/forge.ts`, `core/gsLog.ts`, the `StackBackend` interface (§4.4), readiness
probe with install/init/login offers (§7.13.1, §7.6), `track`, `enrich` (local tier), `push`
(`gs stack submit --no-publish`), refuse during rebase, refresh after. `gh` login flow kept for the
GitHub extras/native link. Tests: E12, E21–E25, E55–E57, E59, E62, E65, E67, `unit/forge`,
`unit/gsLog`, `unit/readiness`, `ext/login`, first rows of `ext/backend-gitspice`,
`git/gitspice.git` (init/track/log). No CR creation yet. Also settle §12 item 9 here (exit codes,
paused-op detection).

**M6 — Change requests: status, create one, create the stack, GitHub native link.**
§7.8 status (both tiers), the §7.7 planner as a pure function, `createPR` / `createStackPRs` via
`gs branch submit` with progress and cancellation, `setDraft` / `markReady*`, then **`core/nativeStack.ts`**
(§7.13.4): `gh stack link` after createPRs on GitHub, `Relink Stack`, settle §12 items 8b/8c. Tests: `unit/prs`, `unit/prstatus`, `ext/createStackPRs`, `ext/markReady`, `ext/nativeStack`, E26–E32,
E45–E47, E61, E62b, E66, E68, E73, E74 (fake). Verify on the github.com scratch repo (e2e: PRs show the native badge and map) and on a gitlab.com
scratch project (e2e: header dropdown) **before** using it on the work repo.

**M7 — PR descriptions: the plan document.**
`core/prdraft.ts`, `core/template.ts`, `core/prplan.ts` (pure, unit-tested first), then the
`prcascade-prplan` document, CodeLens, keybinding, `workspaceState` drafts. Until this lands, M6 uses
`prDescriptionMode: "auto"`. Tests: `unit/prdraft`, `unit/prplan`, `unit/template`, `ext/prplan`,
E33–E36, E38–E43.
*Done when:* "Create PRs for Stack" opens one document with three editable sections, Cmd+Enter
creates all three with the edited text, and each CR shows git-spice's navigation comment.

**M8 — Restack, sync, stack surgery, merge.**
`restack`, `sync`, `moveOnto`, `insertBranchBelow` / `finishInsert` / `cancelInsert`, pending-insert
node, `mergeBottom`; rebase banner with `gs rebase continue`; **Sync Stack**, **Merge Bottom PR**.
Tests: `git/gitspice.git` surgery rows, `ext/insert`, E48–E54, E58, E63, contract table (§9.6) green.
*Done when:* the E48 scenario runs end-to-end against the fixture, and on the scratch repo the
resulting CR bases are `fix→main`, `b→fix`, `c→b`.

**M9 — Multi-stack (optional).**
Tip detection: branches not merged into trunk that no other such branch contains; one tree section
per tip. Only if M1–M8 prove useful.

---

**M10 — Other forges (Bitbucket, Gitea, Forgejo, Azure DevOps) — only when they ship a native stack view.**
git-spice already supports them; the work is the forge-kind gate (E75), auth guidance, and an e2e.
Not planned.

### 10.1 PR breakdown (one git-spice stack per milestone — `gs stack submit`; he reviews bottom → top)

Each PR includes its own tests. Never mix a pure `src/core` change with a `src/vscode` change in
one PR — the split is itself the lesson in how the layers relate.

**M1 stack — "the tree shows branch names"**
1. `scaffold`: package.json, tsconfig, esbuild, eslint (incl. the no-`vscode`-in-core rule), vitest,
   `@vscode/test-cli`, CI workflow, an extension that activates and logs "PR Cascade active".
   Plus `docs/typescript-primer.md` (§11.1) and README skeleton. *Read first: package.json, then
   src/extension.ts.*
2. `core/git`: `GitRunner` interface, `RealGitRunner` (execFile, env, maxBuffer), `FakeGitRunner`
   test helper. Tests: unit (fake) + one real `git --version` smoke.
3. `core/discovery`: workspace folders → repo roots. Tests: E1, E2 with fake; real nested fixture.
4. `core/trunk`: trunk detection order. Tests: E4 and the candidate order.
5. `core/stack`: `computeStack` — members, order, parents, current, counts. Tests: E3, E5, E6, E16
   unit + `git/stack.git.test.ts` on the real fixture (this PR also adds `test/helpers/fixture.ts`).
6. `vscode/tree` + `extension.ts` wiring: layer nodes with branch-name labels, tooltips, current
   marker; `activate()` returns `{ provider, refresh }`. Tests: `ext/activate`, first `ext/tree`.
   *Manual check: F5, open the fixture, see three branch names.*

**M2 stack — "expand a layer, see its files"**
7. `core/changes` name-status `-z` parsing (A/M/D/T/R/C, odd paths). Unit tests only.
8. binary detection via numstat + rename `oldPath`; `git/changes.git.test.ts` (E7–E11, E18).
9. file nodes + per-layer cache + `ext/tree` file assertions.

**M3 stack — "click a file, see the diff"**
10. `core/uri` encode/decode + tests (E11 characters).
11. `stackdiff:` content provider + `openDiff` command + binary fallback; `ext/diff` tests.
    *This is the PR that makes it a usable tool.*

**M4 stack — "it stays fresh and tells you where you are"**
12. `core/debounce` + refresh triggers (focus, editor change, manual, post-command); E20 test.
13. state nodes: rebase-in-progress (`--git-path`), detached, no trunk, not on a stack; `git/rebase`.
14. status bar item `<branch> · n of N`; `ext/statusbar`; E44.
15. `v0.1.0`: packaging (`vsce`), README for users, CHANGELOG, release workflow attaching the
    `.vsix`. *Use it for a week before M5.*

**M5 stack — "the backend exists and can push"**
16. `core/forge`: `parseRemoteUrl` + forge kind + `ghEnv`. First **library decision** (`hosted-git-info`
    vs regexes). Tests: `unit/forge` (E21, E65), `git/remote.git` (E25).
17. `core/backend` interface + `Readiness` type + `core/gsLog` parser. Library decision (`zod` vs
    type guards). Tests: `unit/gsLog` (E57).
18. `backends/gitspice` readiness: `gs version` (library decision: `semver`), init detection, `gs auth
    status`; memoization. Tests: `unit/readiness` (E55, E59, E62, E67).
19. `vscode`: install / `gs repo init` / `gs auth login` offers and the poll-then-continue login flow
    (`vscode/login.ts`, `core/ghstatus.ts` generalized to both tools). Tests: `ext/login`.
20. `track` + `enrich` (local tier): tree gains CR ids, `needs push`, `needs restack`, `not tracked`,
    "Track Stack with git-spice". Tests: `ext/backend-gitspice` rows, `ext/tree` additions (E56).
21. `push` + **Push Whole Stack** + refuse during rebase. Library decision (`execa` vs `execFile`
    wrapper — measure the 12-dependency cost). Tests: `ext/commands` (E12), argv row.
22. `git/gitspice.git` bootstrap: CI installs `gs`; init/track/log scenarios pass offline. Settle §12
    item 7 (exit codes, paused-op detection) and write the first §9.6 contract rows.
23. `gh` readiness on GitHub repos (E62b) + `gh` login flow. Tests: `unit/ghstatus`, `ext/login` rows.

**M6 stack — "create the PRs, natively stacked"**
24. `core/prs` planner (pure). Tests: `unit/prs` (E26–E31).
25. `core/prstatus`: `--cr-status` tier + `gh` extras merge. Tests: `unit/prstatus`.
26. backend `createPRs` (`gs branch submit …` per layer) + `setDraft`. Tests: argv rows (E61).
27. `vscode`: `createStackPRs` / `createPR` with progress + cancellation (`auto` description mode
    for now). Tests: `ext/createStackPRs` (E29, E32).
28. `core/nativeStack` + `Relink Stack on GitHub`; **verify §12 item 6 on the scratch repo first**.
    Tests: `ext/nativeStack` (E68, E72, E73, E62b, E74).
29. `markReadyForReview` / `markStackReady` + `openPR`, copy/compare commands. Tests: `ext/markReady`
    (E45–E47), `ext/menus`.
30. e2e PR: `e2e/gitspice.github` and `e2e/gitspice.gitlab`; run both by hand; record results in
    the PR body. Milestone done only when both pass.

**M7 stack — "descriptions you actually edit"**
31. `core/prdraft` (E33, E38). 32. `core/template` (E34, GitHub + GitLab paths). 33. `core/prplan`
    render/parse round-trip (E35, E36, E39, E41–E43). 34. `vscode/prplan`: document, CodeLens,
    keybinding. 35. drafts in `workspaceState` (E40). 36. wire `prDescriptionMode: edit` into
    `createStackPRs`; update the e2e to submit edited text.

**M8 stack — "restack, sync, surgery, merge"**
37. backend `restack` + `sync` + `rebaseState` → **Restack onto Trunk**, **Sync Stack**, rebase
    banner (E58, E63). Sync Stack is fetch → detect diverged remotes → adopt (E76, procedure in §13.4)
    → `gs repo sync --restack upstack` → submit; restack and submit refuse on an unadopted diverged
    branch. Tests: `git/sync.git.test.ts` with a second clone rewriting the remote, both E76 variants. 38. `moveOnto` + command + cycle check (E53). 38b. **drag-and-drop move**: `TreeDragAndDropController` on the view → the same `moveOnto` after a confirm; refusals per E77; tests `ext/dragdrop` (added 2026-09-20). 39. `insertBranchBelow` /
    `finishInsert` / `cancelInsert` + pending node + status bar text (E48–E52, E54, E72).
40. `mergeBottom` + **Merge Bottom PR…** + `mergeMethod`. 41. `git/surgery.git` + remaining §9.6
    contract rows; e2e surgery pass on the scratch repo.

Each of these is one idea, ≤ ~300 lines of non-test code; split further if a PR outgrows that.

### 10.2 PR body template (every PR, no exceptions)

```
## What
One paragraph: what this PR adds, in plain language.

## Why
What problem it solves / which plan section it implements (link §).

## How to read it
Ordered list of files to open, with one line each on what to look for.

## TypeScript / VS Code things to notice
Bullet list of any syntax or API that's new in this PR, each with a one-line explanation
and a link to the primer section. Empty is fine if nothing is new.

## How to try it
Exact steps (F5 → open fixture → click X) and what you should see.

## Tests
Which test files, what cases (reference E-numbers). `npm test` output summary.

## Dependencies & bundle
"unchanged", or — for every package added, removed or upgraded — a **library decision** in this fixed shape:
1. **Why a library here at all**: the problem, and why it is non-trivial / edge-case heavy (§11.3).
2. **Why this one**: the 2–3 alternatives considered (other libraries *and* hand-rolling) and the reason
   this one won. Name the specific API(s) we use — usually one or two functions.
3. **The dependency card** (§11.3): every check with its measured value and pass/fail, from `npm run depcheck`.
4. **Size**: unpacked package size, direct dependency count, and `dist/extension.js` before → after
   from `npm run analyze` (KB and %).
5. **Hand-roll judgment**: what the hand-rolled version would be — approximate lines, the edge cases it
   would have to handle, what it would likely get wrong — and a one-sentence verdict: *library* or
   *hand-roll*. This is a real decision, not a formality: "hand-roll" is an acceptable outcome, and if
   the verdict is hand-roll the PR does that instead and says so.
Ric reads this section to learn how the choice was made, so write it for him, not for a reviewer who
already agrees.

## Deviations from the plan
None / what and why (and the plan is updated in this PR).
```

## 11. Project skeleton

```
vscode-pr-cascade/            (GitHub repo: <you>/vscode-pr-cascade)
├── package.json              name "vscode-pr-cascade", publisher = your Marketplace publisher id (§11.2; "local" until then), engines.vscode ^1.85
├── tsconfig.json             strict, target ES2022, module commonjs, rootDir src, noEmit for typecheck
├── esbuild.mjs               bundle src/extension.ts → dist/extension.js, external: vscode
├── scripts/depcheck.mjs      prints the §11.3 dependency card for a package
├── vitest.config.ts          projects: unit, git; coverage on src/core
├── .vscode-test.mjs          @vscode/test-cli config → test/ext, workspaceFolder from globalSetup
├── .eslintrc.cjs             @typescript-eslint + no-restricted-imports(vscode) for src/core/**
├── .vscode/launch.json      "Run Extension" config (§11.2)
├── .vscode/tasks.json       npm: build / npm: watch
├── .vscodeignore
├── .gitignore                node_modules, dist, .vscode-test, coverage
├── README.md                 what it is, install (Marketplace or the `.vsix`, §11.2), per-forge setup (`gs`, `gh`), settings
├── docs/typescript-primer.md the TS constructs used here, in order of appearance (§11.1)
├── docs/reading-order.md     which files to read first and why (kept current per milestone)
├── src/                      §4.2
└── test/
    ├── helpers/fixture.ts    §9.3
    ├── helpers/fakeGit.ts    FakeGitRunner: map of argv-join → stdout | Error
    ├── unit/
    ├── git/
    └── ext/  (+ runTest.ts / globalSetup building a fixture workspace)
```

### 11.1 Code style for a reader who doesn't know TypeScript

**Goal:** someone fluent in shell and git, new to TypeScript, can read any file top to bottom and
understand both what it does and why it's shaped that way. Optimize for that reader, not for brevity.

**Write idiomatic TypeScript — the code must look like what a working TypeScript developer would
write (revised 2026-09-20).** The reader learns the language from this codebase, so it must teach the
language as it is actually used, not a simplified dialect that avoids its conventions. The teaching
happens in *comments and the primer*, never by picking a longer or less conventional spelling of the
code. Concretely: use the construct the language provides for the job — constructor parameter
properties (`constructor(private readonly git: GitRunner) {}`) instead of a field plus a parameter
plus an assignment; `??` and `?.` instead of `if (x !== undefined)` ladders; destructuring where it
names things; `readonly` arrays and `as const` where they say something; utility types (`Pick`,
`Partial`, `Record`, `ReturnType`) when they express a relationship the alternative would duplicate;
`satisfies` where a literal must match a type without being widened to it; the ESLint/TypeScript
community defaults for the rest. When a construct appears for the first time, add its primer section
in the same PR and link it at first use — that is the accommodation for the reader, and the only one.
The old rule "explain the syntax by writing it the long way" is withdrawn; M1 and M2 were written
under it (e.g. every constructor in `src/` copies fields by hand), and the next milestone that
touches a file may modernise it in passing, noting the primer section.

Rules:
- **File header** (every file): 3–8 lines — purpose, which layer (§4.1), what it depends on, what
  depends on it, and a pointer to the plan section. Example:
  ```ts
  /**
   * core/stack.ts — figures out which local branches form the stack under HEAD.
   *
   * Layer: core (no VS Code imports; see §4.1). Uses GitRunner to run git commands
   * and turns their output into a RepoState (see core/model.ts). The tree view in
   * vscode/tree.ts renders whatever this returns. Plan: §5 "Stack members".
   */
  ```
- **Every exported function/class/interface** gets a doc comment answering *why it exists* and any
  non-obvious *why it's done this way* (e.g. "`-z` because paths can contain tabs"). Parameter
  descriptions only when the name isn't enough.
- **Inline comments explain intent and domain, not syntax.** Git/GitHub behavior gets commented
  generously ("after a squash merge the branch's commits are not ancestors of main, so…").
- **TypeScript syntax is explained once, in `docs/typescript-primer.md`**, organized by the order
  it appears in the codebase (interfaces, `async/await`, `Promise`, optional `?` fields, `?.` and
  `??`, union types `'a' | 'b'`, generics only where unavoidable, `readonly`, `Map`/`Set`,
  destructuring, arrow functions, `import`/`export`). The first use in each file links the section:
  `// see primer §3 (async/await)`. Keep the primer updated in the same PR that introduces a construct.
- **Annotate what convention annotates, infer the rest.** Return types on exported functions;
  parameter types always; local `const`s inferred unless the type is the point. Name an intermediate
  value when the name carries meaning, not to avoid a chain — a three-call chain that reads as a
  sentence stays a chain.
- **Avoid what a code reviewer at a good TypeScript shop would also avoid**: `any` (use `unknown` +
  narrowing and explain it), decorators, function overloads where a union parameter does, hand-rolled
  types that a built-in utility type expresses, conditional types unless they remove real duplication,
  abbreviations in names, single-letter variables outside tiny loops, "helper" utilities that hide
  what a line does. Generics are fine wherever they are the natural tool (`Map<string, T>`,
  `Promise<T>`, a typed `EventEmitter<T>`); explain them in the primer, do not avoid them.
- **Tests read as specifications.** `describe('computeStack')` / `it('orders layers by distance from
  trunk (E6 tie-break by name)')`. Each test: arrange / act / assert with a blank line between.
  Fixture builders over inline setup. One assertion idea per test.
- **Names** say what, in domain words: `layersBottomToTop`, `mergedBranch`, `pullRequestByHead`.
- Comment density target: roughly one comment line per 3–5 code lines in `core`, denser around git
  semantics; less in boilerplate (`package.json` contributions, obvious adapters).

`package.json` runtime dependencies: few, chosen per §11.3 (expected: `execa`, `hosted-git-info`, `semver`, `zod`); everything else hand-rolled. Dev dependencies are not shipped. Dev: `typescript`, `esbuild`, `vitest`,
`@vitest/coverage-v8`, `@types/vscode`, `@types/node`, `@vscode/test-cli`, `@vscode/test-electron`,
`mocha`, `@types/mocha`, `eslint`, `@typescript-eslint/*`, `@vscode/vsce`.

Install for daily use without publishing: `npm run build && npm run package` → `code --install-extension vscode-pr-cascade-0.1.0.vsix`.

### 11.2 Local development loop (how you run the thing while building it)

Nothing gets "installed" during development. VS Code runs an extension straight from its source
folder in a second window called the **Extension Development Host**.

**Day-to-day loop**
1. Open the `vscode-pr-cascade/` folder in VS Code.
2. Terminal 1: `npm run watch` — esbuild rebuilds `dist/extension.js` on every save (sub-second).
3. Press **F5** (Run → Start Debugging, config "Run Extension"). A second VS Code window opens with
   the title suffix **[Extension Development Host]** and PR Cascade loaded from `dist/`.
4. In that window, open a repo — the fixture repo for most work, a real repo when it's time.
5. Edit code → in the dev-host window run **Developer: Reload Window** (Cmd+R there) to pick up the
   rebuild. Breakpoints set in the first window hit in extension code; `console.log` goes to the
   first window's Debug Console; the extension's own output channel is in the dev host's Output panel.
6. `npm test` in Terminal 2 whenever a PR is ready (`test:ext` launches its own headless VS Code and
   does not need the dev host).

**`.vscode/launch.json` (part of the M1 scaffold PR)**
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}", "${workspaceFolder}/../fixture-repo"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```
The second `args` entry opens a folder in the dev host automatically; point it at a checked-out
fixture (`npm run fixture` writes one to `../fixture-repo` using the §9.3 builder) or drop it to open
folders by hand. `preLaunchTask` runs a one-off build so F5 works even without the watcher.

**Using it for real (dogfooding, outside the debugger)** — build a `.vsix` and install it into your
normal VS Code:
```
npm run build && npm run package          # → vscode-pr-cascade-0.1.0.vsix
code --install-extension vscode-pr-cascade-0.1.0.vsix
```
Re-run both lines after each build you want to live with; VS Code prompts to reload. This is exactly
the artifact that a release attaches and that the Marketplace distributes, so what you dogfood is what
you ship. (Symlinking the source folder into `~/.vscode/extensions/` also works but is fragile
across VS Code updates — use the `.vsix`.)

**Publishing (later)**: `vsce publish` under a Marketplace publisher account (created at
marketplace.visualstudio.com/manage — this needs an Azure DevOps token for *your personal* publisher,
unrelated to the work policy), and optionally `ovsx publish` for Open VSX / VSCodium users. Tag →
CI builds the `.vsix` → attach to the GitHub release → `vsce publish` from the same artifact.

### 11.3 Library policy — use popular libraries, measure the cost

**How packaging actually works (so the bloat question has a real answer).** esbuild bundles
`src/extension.ts` *and every dependency it imports* into one file, `dist/extension.js`. The `.vsix`
ships that file plus `package.json`, README, LICENSE, CHANGELOG and the icon — `node_modules/` and
`src/` are excluded by `.vscodeignore` and never reach the user. So "how much of a library gets
packaged" is decided at bundle time:
- **ES-module libraries** with no import-time side effects (`"sideEffects": false` in their
  package.json) are **tree-shaken**: only the functions actually reachable from our code are kept.
- **CommonJS libraries** cannot be tree-shaken reliably: whatever module we `require` comes in whole,
  with everything it requires. (Classic example: importing one function from CommonJS `lodash` pulls
  ~70 KB; `lodash-es` or the single-function package `lodash.debounce` does not.)
- **Native modules** (anything with a `.node` binary) cannot be bundled and must be avoided outright —
  the extension has to run on macOS, Windows and Linux from one `.vsix`.
`npm run analyze` (esbuild `--metafile` + `--analyze`) prints the contribution of every package to the
bundle. **Budget: `dist/extension.js` ≤ 500 KB minified; CI warns above it.** For scale: the whole
extension without libraries is expected to be ~150 KB.

**When to use a library**
- It replaces logic that is *non-trivial* or *edge-case heavy* — URL parsing, version comparison,
  process spawning with cancellation, schema validation. These are exactly where hand-rolled code is
  subtly wrong for months.
- It is **well-known, by these numbers** (all must hold; a session checks them, it doesn't judge):
  | Check | Floor | Why |
  |---|---|---|
  | npm downloads, last week | **≥ 500,000** | The one number that can't be gamed cheaply; it means thousands of projects would notice breakage before we do |
  | Last release | **≤ 12 months ago** | Alive |
  | Last commit to the default branch | **≤ 6 months ago** | Alive and being maintained, not just re-published |
  | Repo archived / package deprecated | **neither** | Explicitly abandoned |
  | License | MIT, ISC, BSD or Apache-2.0 | Publishable without a legal question |
  | Install scripts (`preinstall`/`install`/`postinstall`) | **none** | Supply-chain hygiene; nothing runs on `npm ci` |
  | Native code (`.node` binaries, `node-gyp`) | **none** | One `.vsix` must run on macOS, Windows, Linux |
  | TypeScript types | shipped by the package (or `@types/*` with comparable downloads) | The reader gets autocomplete and docs |
  | Bus factor | ≥ 2 maintainers, **or** org-owned (npm, Microsoft, GitHub, …), **or** ≥ 10M downloads/week | A single maintainer is a risk unless the package is too big to disappear quietly |
  | Direct dependencies | count them; each one is subject to the same rules in the adopting PR | They all ship in the bundle |
  GitHub stars are **not** a criterion — `hosted-git-info` has ~240 stars and ~93M downloads/week
  because it is npm's own internals. Use stars only as a tiebreak between two otherwise-equal options.
- **Abandonment red flags** — any one blocks adoption, and if it appears later, the next PR plans a
  replacement: repo archived; package deprecated; no release in 24 months; no commit in 12 months;
  issues open > 6 months with no maintainer reply; the community has moved to a fork.
- Its cost, measured by `npm run analyze`, is proportionate to what it replaces.

**When to hand-roll**
- The logic is short (< ~30 lines) and specific to us: debounce, `git diff --name-status -z` parsing,
  the plan-document format, `gs log --json` line splitting. A library import here is bloat *and* a
  concept the reader has to learn for no gain.

**Candidates already identified (adopt in the PR that first needs each; measure the delta)**
| Need | Library | Instead of | Notes |
|---|---|---|---|
| Spawn `git`/`gs`/`gh` with argv, env, cancellation, good errors | `execa` | raw `child_process.execFile` wrapper | ESM-only; esbuild bundles it into the CJS output — confirm in the adopting PR |
| Parse remote URLs into host/owner/repo for GitHub/GitLab/Bitbucket (`core/forge.ts`) | `hosted-git-info` (npm's own) | hand-written regexes for ssh / scp-like / https forms | Exactly the edge-case-heavy case; keep our tests (E21, E65) as the acceptance bar |
| Compare `gh` ≥ 2.90.0, `gs` ≥ 0.31 | `semver` | string splitting | Tiny, standard |
| Validate `gs log --json` and `gh … --json` shapes (`core/gsLog.ts`, PR status) | `zod` | hand-written type guards | Schemas double as readable documentation of the JSON for the reader; `.passthrough()` implements "tolerate unknown fields" (E57) |
| Debounce (`core/debounce.ts`) | — hand-roll | `lodash.debounce` | 10 lines |
| Markdown / diff rendering | — none | — | VS Code renders both natively |

**The dependency card** — pasted into the PR body's *Dependencies* section for every package added:
```
package@version · downloads/week · last release · last commit · archived? · deprecated? · license
maintainers (or org) · direct deps (n) · install scripts? · types? · bundle delta (KB before → after)
```
Produce it mechanically; `scripts/depcheck.mjs` (part of the M1 scaffold) prints the card from these:
```
npm view <pkg> version time.modified license maintainers dependencies scripts deprecated types
curl -s https://api.npmjs.org/downloads/point/last-week/<pkg>
gh api repos/<owner>/<repo> --jq '{stars:.stargazers_count, pushed:.pushed_at, archived:.archived, issues:.open_issues_count}'
npm run analyze            # bundle delta
```

**Measured 2026-09-17 for the four candidates** (all pass every floor):
| Package | Version | Published | Downloads/week | Stars | Last push | Archived | Open issues | Direct deps | Install scripts | Maintainers | License |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `execa` | 10.0.1 | 2026-07-31 | 152,728,782 | 7,605 | 2026-07-31 | False | 2 | 12 | none | 2 | MIT |
| `hosted-git-info` | 10.1.1 | 2026-05-18 | 93,283,164 | 239 | 2026-06-18 | False | 4 | 1 | none | 4 | ISC |
| `semver` | 7.8.5 | 2026-06-19 | 770,970,847 | 5,466 | 2026-09-10 | False | 61 | 0 | none | 4 | ISC |
| `zod` | 4.6.5 | 2026-09-13 | 264,439,481 | 43,968 | 2026-09-14 | False | 64 | 0 | none | 1 | MIT |
Notes: `zod` has one listed maintainer — accepted under the ≥ 10M downloads/week clause, record it
on the card. `execa` has 12 direct dependencies — they ship in the bundle, so its adopting PR must
show the measured delta and may reasonably conclude a 40-line `execFile` wrapper is the better deal.
`semver` and `zod` have zero dependencies. Re-run the check when upgrading a major version.

**Rule for every dependency PR:** the PR body's *Dependencies & bundle* section carries the full
**library decision** (§10.2: why a library, why this one vs. alternatives, the card, the size, and an
explicit hand-roll judgment), and the "TypeScript things to notice" section links the library's docs
and explains the one API we use. Removing a dependency later is a normal PR, not a failure.

---

## 12. Decisions to confirm at implementation time (ask the user, then proceed)

**Resolved — do not re-ask:** backend = git-spice, with `gh stack link` as a required step on GitHub
(§1, §7.13); v1 forges = GitHub + GitLab; name = **PR Cascade** — display name "PR Cascade", repo/folder/package `vscode-pr-cascade` (extension id
`<publisher>.vscode-pr-cascade`, the convention of `vscode-eslint` and `vscode-pull-request-github`), command
and setting prefix `prCascade.*`, panel
titled "Stack"); native stacks verified on the work host; `gh` OAuth login is permitted at work (used
2026-09-17); restacking is git-spice's (`gs upstack restack`, `gs repo sync`), not `--update-refs`;
no footer/nav comment by default on GitHub/GitLab (native views).

**Open — ask, unless he has said "go with the recommendations":**
1. **Commits as an intermediate tree level?** Recommendation: no — branch → files. Squash merge
   flattens commits anyway.
2. **Only the stack containing HEAD, or all stacks?** Recommendation: HEAD-only for v0.1; M9 adds all.
3. **Status letters as label prefix vs icon?** Recommendation: prefix (`M  path`).
4. **PR description defaults:** title from first commit (vs branch name); template after the commit
   summary (vs before); `prDescriptionMode` default `edit`; `prDraft` default `false`. Recommend all four.
5. **"Draft with AI" CodeLens via `vscode.lm`?** Not in scope unless he asks; must degrade to nothing.
6. **`gh stack link` on PRs git-spice created** — the docs say it is designed for this; confirm on the
   scratch repo before PR 28: 2-layer `gs` stack → `gs stack submit` → `gh stack link a b` → badge on
   the PR page. 6b: re-running with the full list — updates the existing stack or creates a duplicate?
   (decides the insert flow). 6c: which `gh pr view --json` field exposes stack membership (tree's
   "linked" marker).
7. **git-spice exit codes and paused-operation detection** — undocumented; determine empirically in
   PR 22 and encode in the contract tests. Also verify `spice.forge.github.url=https://<company>.ghe.com`
   resolves the data-residency API URL (else set `apiUrl`).
8. **Library decisions** (§11.3, §10.2): `hosted-git-info` (PR 16), `zod` (PR 17), `semver` (PR 18),
   `execa` vs a hand-rolled `execFile` wrapper (PR 21 — measure the 12-dependency cost). Each decided
   in its adopting PR with the full library-decision section; hand-roll is a legitimate outcome.
9. **A gitlab.com scratch project** for the GitLab e2e — he needs an account; confirm before M6.

---

## Appendix A — fixture repo script (bash, tested on Linux git; the TS fixture ports this)

```sh
#!/bin/sh
# Builds a 3-layer stack with a bare origin so origin/main exists.
set -e
d=$(mktemp -d); cd "$d"
git init -q -b main .
git config user.email t@t; git config user.name t; git config rebase.updateRefs true
echo base > f; git add f; git commit -qm base
git clone -q --bare . ../origin.git; git remote add origin ../origin.git; git fetch -q origin
git checkout -qb api-refactor;  echo a > a; git add a; git commit -qm "A: refactor"
git checkout -qb add-retries;   echo b > b; git add b; git commit -qm "B: retries"
git checkout -qb retry-metrics; echo c > c; git add c; git commit -qm "C: metrics"
echo "$d"
# Variants used in the conversation's tests:
#   amend bottom:      git checkout api-refactor; echo a-fix > a; git commit -qam "A fixed" --amend
#   unrelated stack:   git checkout main; git checkout -b other-work; echo d>d; git add d; git commit -qm D
#   squash-merge sim:  git checkout main; git merge --squash api-refactor; git commit -qm "A (squashed)"; git push -q origin main; git checkout retry-metrics
```

Expected `git log --oneline --decorate main..retry-metrics` for the base fixture:
```
<sha> (HEAD -> retry-metrics) C: metrics
<sha> (add-retries) B: retries
<sha> (api-refactor) A: refactor
```

---

## Appendix B — `git-sync` reference implementation (tested; **reference only** — `gs upstack restack` replaces it)

Bugs found while writing this, which the M7 tests must cover:
1. **Reflog walk matched branch-creation entries at trunk**, making an *unrelated* branch look like it
   had "left the stack" — the first version grafted a whole stack onto an unrelated branch. Fix: stop
   the walk as soon as a reflog entry is an ancestor of trunk.
2. **The amended branch looks like its own one-branch stack** (nothing contains it anymore). Fix:
   prefer the candidate tip that actually has moved branches.
3. **Amending twice without syncing** breaks `@{1}`-only detection. Fix: walk up to 50 reflog entries.
4. Two moved branches is genuinely ambiguous → refuse with a message, never guess.

```sh
#!/bin/sh
# git sync [trunk]  -- run from ANY branch in a stack.
set -e
trunk=${1:-origin/main}
git rev-parse --verify --quiet "$trunk" >/dev/null || { echo "git sync: no such ref: $trunk" >&2; exit 1; }
orig=$(git symbolic-ref --quiet --short HEAD) || { echo "git sync: detached HEAD" >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "git sync: working tree has uncommitted changes" >&2; exit 1; }
branches() { git for-each-ref --format='%(refname:short)' refs/heads --no-merged "$trunk"; }
tips=''
for b in $(branches); do
    maximal=1
    for c in $(branches); do
        [ "$c" = "$b" ] && continue
        git merge-base --is-ancestor "$b" "$c" 2>/dev/null && { maximal=0; break; }
    done
    [ $maximal -eq 1 ] && tips="$tips $b"
done
moved_for() {
    _top=$1; _out=''
    for b in $(branches); do
        [ "$b" = "$_top" ] && continue
        git merge-base --is-ancestor "$b" "$_top" 2>/dev/null && continue
        n=1; prev=''
        while [ $n -le 50 ]; do
            p=$(git rev-parse --quiet --verify "$b@{$n}" 2>/dev/null) || break
            git merge-base --is-ancestor "$p" "$trunk" 2>/dev/null && break      # bug 1 fix
            if git merge-base --is-ancestor "$p" "$_top" 2>/dev/null; then prev=$p; break; fi
            n=$((n+1))
        done
        [ -n "$prev" ] && _out="$_out $b:$prev"
    done
    echo "$_out"
}
top=''; moved=''; insync=0
for t in $tips; do
    m=$(moved_for "$t")
    mine=0
    [ "$t" = "$orig" ] && mine=1
    git merge-base --is-ancestor "$orig" "$t" 2>/dev/null && mine=1
    for e in $m; do [ "${e%%:*}" = "$orig" ] && mine=1; done
    [ $mine -eq 1 ] || continue
    if [ -z "$m" ]; then insync=1; continue; fi                                  # bug 2 fix
    if [ -n "$top" ]; then echo "git sync: '$orig' belongs to more than one out-of-sync stack ($top, $t)" >&2; exit 1; fi
    top=$t; moved=$m
done
if [ -z "$top" ]; then
    [ $insync -eq 1 ] && { echo "git sync: stack is already in sync"; exit 0; }
    echo "git sync: no stack found containing '$orig'" >&2; exit 1
fi
set -- $moved
branch=${1%%:*}; prev=${1#*:}
if [ $# -gt 1 ]; then
    echo "git sync: ambiguous -- more than one branch in '$top' moved:" >&2
    for e in "$@"; do echo "  ${e%%:*}" >&2; done; exit 1
fi
echo "git sync: replaying $top onto $branch (was $(git rev-parse --short "$prev"))"
[ "$top" = "$orig" ] || git checkout --quiet "$top"
git rebase --update-refs --onto "$branch" "$prev"
[ "$top" = "$orig" ] || git checkout --quiet "$orig"
```

Verified scenarios (all passed): run from bottom/middle/top; three amends with no sync between;
already in sync → no-op; second unrelated stack present → untouched; run from an unrelated branch →
does not touch the stack; dirty tree / detached HEAD → refused; idempotent re-run.
Known limitation: a *multi-branch* amend (edit A, then B, then sync) is refused — the correct fix is
bottom-up iterative, or the user does one `git rebase -i --update-refs <trunk>` from the top and
marks several commits `edit` (verified to work; note the todo list contains `update-ref` lines).

---

## Appendix C — tools evaluated and why they were rejected (so nobody re-evaluates them)

| Tool | Verdict | Reason |
|---|---|---|
| Graphite (CLI + VS Code ext) | ✗ | Its activation flow authenticates against github.com only and couldn't attach the work org (which lives on `ghe.com`); no self-serve path for non-github.com hosts was found, and the extension gates its UI behind that auth. (Originally attributed to "GHES"; the host is actually data-residency GHEC — the outcome was the same in practice.) |
| VisualJJ | ✗ | Stacked-PR workflow is Pro ($10/user/mo); no documented Enterprise-host support; silently ran `jj git init` in every open repo. |
| jj (Jujutsu) + jjk | ✗ for him | jj's model is excellent (auto-rebase of descendants) but the working copy is never on a branch → VS Code git UI shows a hash, PR extension can't create PRs. jjk has no nested-repo detection and no init/PR/push features. |
| GitButler | ✗ | GUI with an "Enterprise" forge option, but that path is PAT-only; PATs are prohibited by policy. |
| ejoffe/spr | ✗ | Has `githubHost` for Enterprise hosts but open nil-pointer crash on that path (issue #402, open since 2024-04). |
| git-branchless | ✗ | `git restack` is good and local, but single-purpose; git-spice covers it plus forges. |
| GitHub native stacked PRs / `gh stack` | ✓ **`gh stack link` only — required step on GitHub** | Public preview since 2026-07-30; verified on both of his hosts. `link` is documented for branches managed by other tools; creates/updates the Stack object, corrects bases, grows by stack number. The rest of `gh stack` (`init/add/submit/sync/modify`) is not used — its `submit` lacks title/body flags and `modify` is TUI-only. |
| **git-spice** (`gs`) | ✓ **the backend (GitHub + GitLab)** | Multi-forge, no-PAT auth on GitHub via `gh` token or OAuth, documented `--json` read model, `--title/--body/--draft` submit, squash-safe `repo sync`, non-interactive surgery, bottom-up merge, offline for local ops, MIT, v0.31.2. Cannot create GitHub's Stack object — `gh stack link` covers that. GitLab's native stack view appears automatically from its MR targets. |
| Plain git + `rebase.updateRefs` + `gh` | △ was the baseline | Works by hand and keeps every VS Code button; superseded as the extension's engine by git-spice. §5 and Appendix B keep the commands as reference. |

---

## 13. Implementation log (each entry is also in its PR body)

> This file was gitignored until 2026-09-20 and then committed in PR 1 at Ric's request, so the plan and
> its log travel with a clone. It contains no employer hostname — `<company>.ghe.com` is a placeholder and
> `ghes.corp.com` a documentation example — and no credentials. It is excluded from the `.vsix`.

### 13.1 Environment facts discovered 2026-09-18/19 (personal Mac)

- This Mac is **Intel** (`/usr/local` Homebrew), not the Apple Silicon machine §1 describes; nothing in the
  code assumes either.
- **`gs` on this Mac is Ghostscript.** Homebrew installs git-spice as `git-spice` (the formula renames the
  binary and suggests `alias gs='git-spice'`). Consequence for M5 (§7.13.1): the readiness probe must try
  `git-spice` as well as `gs`, and `prCascade.gsPath` should default to whichever is found — decide in PR 18.
- Homebrew's node was broken (bottle linked against a removed `ada-url` dylib); the M1 stack was built and
  tested with Node **24.21.0 LTS** (npm 11.19). npm 11's install-scripts allowlist skipped esbuild's
  `postinstall`; esbuild works regardless (platform binary is an optional dependency).
- `gh` 2.100.0 with `gh-stack` v0.1.1 installed and logged in to github.com; git-spice authenticates through
  `GITHUB_TOKEN=$(gh auth token)` for the submit step (no token stored anywhere).
- git 2.50.1 here. git ≥ 2.48 creates/repairs `refs/remotes/<remote>/HEAD` on fetch
  (`remote.<name>.followRemoteHEAD`, default `create`); older git (Debian 12, Ubuntu 24.04) does not. Tests
  therefore set or delete `origin/HEAD` explicitly and never rely on what `fetch` does to it.

### 13.2 Deviations taken in the M1 stack (PRs 1–6, branches `m1/01-scaffold` … `m1/06-vscode-tree`)

| # | PR | Deviation | Why |
|---|---|---|---|
| D1 | 1 | `eslint.config.mjs` (flat config) instead of `.eslintrc.cjs` (§11) | ESLint 10 removed eslintrc. |
| D2 | 1 | CI on Node **24** instead of Node 20 (§9.5) | Node 20 reached end of life April 2026. |
| D3 | 1 | TypeScript **5.9**, not 6/7 | typescript-eslint 8.70 supports TS < 6.1; TS 7 is the Go port. |
| D4 | 1 | `vitest.config.mts` instead of `vitest.config.ts` | Vite warns that a `.ts` config with ESM syntax in a CommonJS package will be refused by its next loader. |
| D5 | 1 | CI does not yet install git-spice (§9.5) | Nothing in M1 runs it; PR 22 adds the step with the first suite that needs it. |
| D6 | 1 | Dev deps `@eslint/js`, `globals` beyond §11.1's list; `vscode:prepublish` script beyond §9.2 | Flat ESLint config needs both; prepublish keeps `npm run package` from shipping a stale `dist/`. |
| D7 | 1 | CI triggers: `pull_request` + pushes to `main` only | A push to a stacked branch would otherwise run the suite twice on two OSes with a VS Code download each. |
| D8 | 1 | `scripts/depcheck.mjs` prints two §11.3 floors as `CHECK BY HAND` (native `.node` files in the tarball; "org-owned" bus factor) | No registry field settles them; everything measurable is measured. |
| D9 | 2 | `tryRun` returns `null` for an **unusable working directory** (missing, a file, or not enterable) as well as for non-zero exit; `run` checks the directory with two `fs` calls before spawning. A missing/unrunnable git (E17), a signal, output overflow, or an argument list Node refuses still reject | Node reports a vanished cwd with the same `ENOENT` as a missing binary and a forbidden one with the same `EACCES` as a non-executable git; discovery must treat a deleted workspace folder as "not a repo", not fail the workspace. |
| D10 | 2 | `GitError` carries `gitPath`, `startFailure` (`'not-found' \| 'not-executable' \| …`) and `detail` beyond args/cwd/exitCode/stderr | The E17 node recognises the failure kind without parsing messages. |
| D11 | 2 | `run` returns stdout **untrimmed** | M2's `-z` parsing needs raw output; callers strip the one newline they expect. |
| D12 | 3 | `FakeGitRunner.answerIn(cwd, args, response)` added to the argv-join map | Discovery runs the same command in different folders and expects different answers. |
| D13 | 4 | The branch `origin/HEAD` names is verified before it is trusted (§5 takes `symbolic-ref`'s answer as-is); every existence check is `rev-parse --verify --quiet --end-of-options <ref>^{commit}` rather than §5's bare `<ref>`; trunk detection reads **`prCascade.remote`** instead of a literal `origin` | After a remote `master→main` rename plus `fetch --prune`, git < 2.48 leaves the pointer dangling (plan floor is 2.38). Plain `--verify` accepts any object (`main:` passes), so a non-commit would fail later with a plausible name in hand; `--end-of-options` stops a setting beginning with `-` being read as a flag. One remote setting instead of two (a fork measuring against `upstream/main`). |
| D14 | 4, 5 | `TrunkOptions` lives in `trunk.ts`; `MeasuredBranch` (un-exported) in `stack.ts`; not in `model.ts` | Kept next to the one function that uses each; `model.ts` holds shared shapes only. |
| D15 | 5 | `RepoState.rebaseInProgress` **not added** in M1 | Computed and rendered together in M4 (PR 13); an always-false field would be dead code for the reader. |
| D16 | 5 | §12 items 1–2 taken as recommended: **no commit-level nodes**, **HEAD-only stack** | Ric can override in review of PR 5/6. Consequence: E14's "unnamed layer" cannot exist; the amended bottom's old commit is counted in the next layer's `commitCount` (test asserts it) and shows in that layer's diff in M2. |
| D17 | 5 | Branch names are resolved as full refs: `symbolic-ref --quiet HEAD` (strip `refs/heads/` ourselves), `for-each-ref --format=%(refname:lstrip=2)`, and `refs/heads/<name>` in `rev-list`/`rev-parse` — instead of §5's `--short` / `%(refname:short)` / bare names | A **tag with the same name as a stack branch** makes `--short` print `heads/<name>` and makes bare names resolve to the tag (git prefers tags, warns only on stderr): wrong label, wrong SHA, wrong count. Found in review, reproduced, tested. §5 rows "Current branch", "Stack members", "Layer order", "Layer SHA" should be read with this correction. |
| D18 | 5 | Fixture writes identity + `commit.gpgsign=false` into the fixture repo's config at init (in addition to the §9.1 env) and sets `origin/HEAD` explicitly (Appendix A does not) | Committing by hand in `../fixture-repo` also works; git 2.48 changed what `fetch` does to `origin/HEAD`. |
| D19 | 6 | `.vscode/launch.json` opens `../fixture-repo/repo` (§11.2 says `../fixture-repo`); `FixtureOptions.directory` added | The bare origin must live beside the repo, and `../fixture-repo` is the one permitted write outside the project. |
| D20 | 6 | Three state rows rendered in M1 although §10.1 assigns state nodes to M4/PR 13: "No trunk found — set prCascade.trunk" (E4), "Not on a stack" (E5), and the E17 error row | A null trunk would otherwise crash the provider or drop the repo silently; each row has an extension-host test. PR 13 owns the rest (rebase, detached) and may restyle. |
| D21 | 6 | Extension-host fixture workspace is built when `.vscode-test.mjs` loads (cleanup on `process.on('exit')`), not in a `globalSetup` | `@vscode/test-cli` has no such hook. |
| D22 | 6 | `npm run fixture` = esbuild bundle → `out/scripts/fixture.js` → node (Node's type stripping rejected) | Type stripping needs `.ts` extensions on imports, which the tsconfig forbids. |
| D24 | 2 | Primer §5's claim that arrow functions and `function` are interchangeable withdrawn; §4 gains the `let x: T;` declare-then-assign form | `RealGitRunner.run` is the first code that relies on an arrow keeping its enclosing `this`. |
| D25 | 5 | Fixture's private `currentBranch()` also uses `symbolic-ref --quiet HEAD` + strip, not `--short` | Same tag-shadowing hazard as D17; caught by the cross-stack review. |
| D23 | 1, 2, 5, 6 | Size over the ~300 non-test-line guideline after review fix-ups: PR 1 611 (12 config files + extension.ts, 196 comment lines), PR 2 388 (164 comment lines in git.ts), PR 4 176, PR 5 335 (~two thirds comments), PR 6 578 (268 comment lines, 59 JSON, ~209 code) | Comment density is §11.1's requirement; each body explains. Not split — flagged for Ric to say whether the guideline should count comments. |
| D26 | 7 | **Discovery scans down as well as up** (supersedes §3 row "Repo discovery" and §6): candidates = each workspace folder plus its subdirectories to `scanMaxDepth`, skipping `.git`, symlinks and `scanIgnoredFolders`; `rev-parse --show-toplevel` in every candidate, concurrently (`Promise.all`); no `.git` sniffing. `discoverRepoRoots(folders, git, options = DEFAULT_DISCOVERY_OPTIONS)`. **§8 E1 split**: E1 = repository below a workspace folder (§1's layout), E1b = workspace folder inside a repository. | Ric's actual layout (§1) yielded zero roots with walk-up only. Mirrors the built-in git extension (`traverseWorkspaceFolder` + `openRepository`). |
| D27 | 7 | Ignored-folder names compared exactly with `includes`, not the built-in extension's case-insensitive `pathEquals`; `-1` depth is bounded only by the OS process limit (one spawn per directory); one intentionally unreachable `break` after `queue.shift()` (documented in primer §38). | Plain over clever; a Windows CI leg would be the trigger to revisit case-insensitivity. |
| D28 | 8 | Setting values are validated in `config.ts` (non-integer or `< -1` → default; non-list → default; non-string list entries dropped) because `configuration.update()` accepts values that break the declared schema and `get()` returns them raw (verified live). README gained a Settings section. The extension-host test builds the parent layout with `buildStack()` then renames the repo folder, since the builder always writes `<directory>/repo` (two levels down, invisible at depth 1). | Verified behaviour of VS Code's configuration API; §11 lists settings among README contents. |
| D29 | 7, 8 | Size: PR 7 +219/−34 non-test (138 comment lines, ~68 code); PR 8 +123/−13 (72 comment, 33 code, 16 JSON). | Same D23 question. |
| D30 | 2, 4, 8 | `implements` added wherever a class mirrored an interface by hand, and a type annotation (primer §3) wherever an object literal did: src/core/git.ts `GitError extends Error implements GitFailure` and `const options: ExecFileOptionsWithStringEncoding` (the `execFile` options — bare `ExecFileOptions` would flip `execFile` to its `string \| Buffer` overload and break `resolve(stdout)`); src/vscode/config.ts `PrCascadeSettings extends DiscoveryOptions` (the two scan fields are no longer redeclared, and src/extension.ts hands `settings` straight to `discoverRepoRoots`); test/unit/trunk.test.ts and test/git/trunk.git.test.ts `AUTO_DETECT` against `TrunkOptions`; test/ext/scanSettings.test.ts `declared` against `DiscoveryOptions`. Primer §13 and §16 amended in place (no new section, no `satisfies`). | Found by Ric reviewing PR 2 (GitError/GitFailure): without `implements`, a field added to the interface and forgotten in the class compiled silently; without the annotation, a misspelled option key (`maxBufer`) compiled and Node silently ignored it. No behaviour change. |
| D31 | M2 PR 9 | Both `git diff` invocations end with `--` after the two SHAs (`--name-status -M -z <parentSha> <sha> --`; `--numstat` likewise). Plan §5 rows "Files in a layer" and "Binary detection" should be read with `--` appended. | A root-level file named exactly like one of the SHAs otherwise makes git exit 128 with "ambiguous argument … both revision and filename"; with `--` the output is byte-identical. Found by a review probe on git 2.50.1; applied under Ric's rule (solves a problem, causes none). |
| D32 | M2 PR 9 | `changedFiles(git, root, parentSha, sha)` takes the two SHAs, not branch names, and diffs the two trees (`parentSha sha`, which for `git diff` equals `..`; the form avoided is the merge-base `...`). The parser accepts `C` entries but git never produces them because `-C` is not passed (§9.4's `C075` stays a canned unit case). Paths are taken byte-for-byte from `-z` output; the one lossy case is a path that is not valid UTF-8, a limit of `core/git.ts` returning text. | The tree's cache (D35) and M3's diff editor show the same comparison; SHAs cannot drift. |
| D33 | M2 PR 10 | `changedFiles` runs name-status and then numstat, both `-M -z`, pairing entries by path; numstat's rename shape under `-z` was verified empirically and is `<added>\t<deleted>\t\0<old>\0<new>\0`; a binary file prints `-\t-\t`. Copies are tested as "not `C`". The two commands run sequentially (two short commands on a click). | name-status has no binary flag and numstat has no status letter; both flags on both commands so their file lists agree. |
| D34 | M2 PR 11 | The extension-host fixture and `scripts/fixture.ts` carry a rename (`b` → `b2`, amended into the top layer's commit) and a binary `logo.png`, so the top layer lists `R  b2`, `A  c`, `A  logo.png`. The brief's `git mv c c2` cannot show as `R`: a tree diff reports a rename only when the file exists at the parent, and `c` is the top layer's own addition. | The M2 acceptance ("renames show old → new") needs a rename that survives the diff model; verified on git 2.50 before writing the test. |
| D35 | M2 PR 11 | `StackTreeProvider(loadStates, loadFiles, output)`; `loadFiles` is built in `extension.ts` and rebuilds the runner per call from `prCascade.gitPath` (so a corrected path takes effect on the next click, as the E17 tests require); a failing per-layer load shows one `MessageNode` under the layer and logs to the output channel. The cache `filesByCommitPair` is keyed `${parentSha}:${sha}` and cleared on `refresh()`. **Verified: VS Code 1.138 does not re-ask a provider for a closed-and-reopened row's children**, so today no VS Code-issued call hits the cache — only a same-cycle second `getChildren` (the ext test proves that one). **Open for Ric:** keep entries across `refresh()` bounded by size (a refresh after a commit would re-list only layers whose SHAs changed), or a partial refresh (`fire(node)`) once M4 adds automatic triggers. | Plan §10 M2 asks for the cache; its value depends on M4's refresh design. |
| D36 | M2 PR 11 | §12 item 3 applied as recommended: status letter as the label prefix (`M  ingress.ts`); the icon slot is left to VS Code's file icon via `resourceUri`; `contextValue` is `stackFile` / `stackFileBinary`; file rows have no command until M3's `openDiff`. §12 item 1 is now visible: a layer's rows are its files, no commit-level rows. | Both are one-place changes if Ric prefers otherwise (`FileNode.toTreeItem`; a node class between `LayerNode` and `FileNode`). |
| D37 | M2 PRs 9–11 | Sizes against the brief's aims: PR 9 213 added (aim ~150), PR 10 ~200 (aim ~120), PR 11 245 added / 213 net (aim ~200); all inside the plan's ≤ 300 guideline; the excess is doc comments. | Same D23 question. |
| D38 | M2 PR 10 | `Fixture.cleanup()` (an M1 helper) retries its recursive delete: `rmSync(dir, { recursive, force, maxRetries: 10, retryDelay: 100 })`. | First CI run: all 87 real-git tests passed on both runners, then macOS failed tearing down the 1500-file E18 fixture with ENOTEMPTY — a race between the delete and something still touching the tree (Spotlight or git). Node retries EBUSY/ENOTEMPTY/EPERM with linear backoff. Ubuntu never hit it. |
| D39 | `refactor/idiomatic-typescript` | Parameter properties in all eight classes (`RealGitRunner`, `LayerNode`, `FileNode`, `RepoNode`, `MessageNode`, `StackTreeProvider`, `FakeGitRunner`, `StackFixture`), `??` in `describeFailure`, conditional expressions in `run()`; primer §47/§48. Zero behaviour change — suites identical (127/87/35). `GitError` keeps its long form (it copies seven fields out of one `GitFailure` argument; not a parameter-property case); `StackFixture`'s second parameter is named `dir`, the `Fixture` interface's name for it. | The §11.1 rule revised 2026-09-20 (PR #15): the code must look like what a TypeScript developer writes, with the primer as the reader's accommodation. One dedicated pass over the M1/M2 code, so everything after it teaches one dialect; from here the rule applies in passing. |

### 13.3 Test coverage delivered in M1 (all green on `m1/06-vscode-tree`, 2026-09-19)

74 unit (Vitest, fake runner) · 63 real-git (Vitest, hermetic temp repos) · 17 extension-host (Mocha in
VS Code 1.138). Every PR was reviewed twice (plan-conformance and correctness lenses), fixed, and independently
verified; then the whole stack got a body-vs-diff truth check, a learner read-through per PR, and a
consistency pass (104 findings, 92 applied, the rest skipped with a cited reason in the PR body). E-numbers covered: E1, E2, E3, E4, E5, E6, E14, E15, E16, E17, E18 (maxBuffer ceiling), E19,
E44; plus the tag-shadowing case (no E-number in §8 — consider adding one as E76).

### 13.4 Open for Ric at M1 review (§12)

- Items 1–2 (commit nodes; HEAD-only) — applied as recommended in PR 5/6; say if you want otherwise.
- Whether the ≤ 300-line guideline should exclude comment lines (D23).
- Whether E14's wording should change to match D16, and whether to add the tag case as E76.
- M5 heads-up: the `gs` vs `git-spice` binary name (13.1).
- **Drag-and-drop move added to M8 (2026-09-20, Ric's request):** he likes the visual stack views in Graphite
  and VisualJJ; the drag gesture is the first UI borrowed from them and rides on M8's `moveOnto` (§7.2.1, E77,
  §10.1 item 38b). Deliberate limit: the tree remains the v1 view; a richer graph view is **not** planned
  unless he asks — it would be a webview, which §7.9's principle avoids for anything that is not a picture.
- **DECIDED 2026-09-19: `ExtensionApi` stays as is** — a plain `{ provider, refresh }` test seam (§9.1), no
  rename, no `getAPI(version)` shell like the built-in git extension (no external consumers exist or are
  planned). **M5 design note:** the fake runner/terminal injection §9.4 needs for extension-host tests must
  not be reachable by other extensions; expose such hooks only when
  `context.extensionMode === vscode.ExtensionMode.Test`, keeping `{ provider, refresh }` unconditional.
- **`gh stack link` changes the checked-out branch (found 2026-09-19).** After the 8-branch relink the
  working tree was left on `m1/01-scaffold` (reflog: "moving from m1/08-vscode-scan-settings to
  m1/01-scaffold"). For §7.13.4 / M6: `core/nativeStack.ts` must record HEAD before the link and restore it
  after (`git checkout -` or by name), and refuse to run with a dirty tree.
- **SonarQube Cloud (connected by Ric 2026-09-19).** Automatic analysis; default "Sonar way" gate (new
  reliability/security/maintainability A, duplication ≤ 3 %, hotspots 100 % reviewed — no coverage
  condition). So far only PR #1 (targets `main`) has been analysed; PRs targeting branches inside the stack
  and PR #8 (opened before the connection) show no analysis yet. First result: gate failed on
  `new_security_rating` C — four findings, all in PR 1's toolchain files (`ci.yml` `npm ci` without
  `--ignore-scripts`, `curl -L` without `--proto '=https'`; `depcheck.mjs` a backtracking regex and an
  unsanitised `console.log`). Verified: `npm ci --ignore-scripts` + build + all suites + `vsce package` pass.
  **Fixed 2026-09-19 by amending PR 1** (`npm ci --ignore-scripts`; `curl --proto '=https' --tlsv1.2`;
  maintainer regex → `replace(/<[^>]*>$/, '').trimEnd()`; a `printable()` helper stripping `\p{Cc}` around
  every `console.log` of registry text) and restacking PRs 2–8. Lesson: ESLint's `no-control-regex`
  (in `recommended`) rejects `\x00`/`` escapes in regexes — use the Unicode property `\p{Cc}` with
  the `u` flag instead.
  **Second round, same day, after Sonar analysed every PR in the stack** (it analyses each PR against its
  real base on every push; on import it had covered only PR 1): PRs 3/4/9 failed on duplicated lines that
  were entirely in `test/unit/*.test.ts` arrange blocks, PR 5 on `execFileSync('git', …)` in the test fixture
  (rule S4036, `PATH`), PR 9 on `childNames.sort()` without a comparator (S2871, critical), PR 6 carried a
  no-assertion smell (S2699), PR 1 a leftover S8786 on `<[^>]*>$`. Ric set **Test File Inclusions =
  `test/**`** in the SonarCloud UI (Administration → Analysis Scope) so test code gets test rules and is
  excluded from duplication; the code items were fixed by amending PR 1 (`<[^<>]*>$`, linear), PR 6
  (`assert.doesNotReject(async () => …)` — `executeCommand` returns a `Thenable`, not a `Promise`), and PR 9
  (`compareByName`, the same `<`/`>` character-code order as `stack.ts`; `localeCompare` was rejected as
  locale-dependent; primer §26 corrected), then restacking. **Result 2026-09-20: all eight PRs green on CI
  and on the Sonar gate, zero open new-code issues.** Open question for Ric after reading the unit tests:
  keep the repeated arrange blocks (tests as self-contained specifications) or fold them into small builders.
- **M8 "Sync Stack" MUST handle a remote rewritten by someone else (verified by simulation 2026-09-20).**
  GitHub's "Rebase stack" button does a server-side cascading rebase and force-pushes every branch; a
  co-worker (or `gh stack sync`) can do the same. git-spice does not notice: `gs repo sync` fetches only
  trunk, `gs stack restack` then builds a *third* lineage, and `gs stack submit` uses
  `--force-with-lease=<branch>:<origin/branch as last fetched>` (submit/handler.go) — so it is rejected
  ("stale info") only while the clone has not fetched; after any fetch the lease matches and the push
  **silently overwrites** the server's rebase (harmless when the content is identical, lossy when they
  resolved a conflict or trunk moved again). Detection: `gs log short --json` → `push.ahead > 0 && push.behind > 0`
  (or after fetch, neither tip is an ancestor of the other). **Adoption procedure, verified including an
  unpushed local commit:** `git fetch`; per branch bottom→top: nothing unpushed (local tip is an ancestor of
  `origin/<b>@{1}`, the pre-fetch remote) → `git branch -f <b> origin/<b>`; unpushed commits →
  `git rebase --onto origin/<b> origin/<b>@{1} <b>`; then `gs stack restack` is a no-op that refreshes
  git-spice's stored bases (reports "does not need to be restacked", `needsRestack` clear). The extension's
  Sync Stack = fetch → detect → adopt (automatic when nothing unpushed, confirm when there is) → restack →
  submit; never restack or submit a diverged branch without adopting first. Sources: docs.github.com
  "Managing stacked pull requests"; abhinav/git-spice internal/handler/submit/handler.go.
- **§12 item 6b SETTLED empirically 2026-09-19:** re-running `gh stack link` with the full ordered list on an
  already-linked stack **updates the existing stack in place** ("Updated stack to 8 PRs (stack #7)"), no
  duplicate. Done twice on this repo: the original 6-PR link, then the 8-branch relink after PRs 9/10 were
  added on top. So `prCascade.relinkStack` and the post-insert relink (§7.13.4) can always pass the full list;
  the stack-number append form is an optimisation, not a necessity. (§12 6c, the PR JSON field for stack
  membership, is still open.)
- **RESOLVED 2026-09-19 and delivered as M1 PRs 7 and 8 (`m1/07-core-discovery-subfolders`,
  `m1/08-vscode-scan-settings`; see D26–D29) — discovery must work in both directions.** Ric confirmed: the extension must find a
  repo whether it *is* a workspace folder, a workspace folder is *inside* it, or it sits *below* a workspace
  folder (§1's "parent open for browsing, repos in subdirectories"). M1 as submitted handles only the first two
  (`rev-parse --show-toplevel` walks up); §3's rationale "walks up, so nested repos resolve" is wrong for the
  third, and E1's wording ("repo is a nested subfolder of a workspace folder") describes the case the E1 test
  does not exercise. **Corrected §6 algorithm, mirroring the built-in git extension (verified from
  `extensions/git/src/model.ts`):** candidates = every workspace folder plus its subdirectories to depth
  `prCascade.repositoryScanMaxDepth` (default 1, `-1` = unlimited), skipping `.git` and
  `prCascade.repositoryScanIgnoredFolders` (default `["node_modules"]`); do **not** look for `.git` in the
  filesystem — run `rev-parse --show-toplevel` in every candidate and let git decide (handles E19's `.git` file
  for free); realpath + dedupe as now; run candidates in parallel (`Promise.all`), not the PR 3 loop, since a
  parent with twenty repos is twenty spawns. The built-in extension is *eager* about the down direction and
  *prompts* for the up direction (`git.openRepositoryInParentFolders: prompt`); we keep the up direction silent
  since §6/E1 want it shown. Delivery: two PRs on top of the M1 stack, per the core/vscode split rule —
  `m1/07-core-discovery-subfolders` (pure: scan options as parameters, unit + real-git tests with a repo
  *below* a folder, depth 0/1/2, ignored folder, `.git` file below) and `m1/08-vscode-scan-settings` (the two
  settings in §7.3 and config.ts, an ext test whose workspace is a parent folder with two repos below it).
  Update §3 row, §6, E1 (split into E1 = repo below folder, E1b = folder inside repo) in the PR that lands it.
- **Activation and the empty window (found 2026-09-19, not in §12).** Keep `onStartupFinished` because the M4
  status bar must exist without the view being opened; the implicit `onView:prCascade` (VS Code ≥ 1.74) already
  activates the extension when the Stack pane renders, which on Ric's setup is at startup, and that first
  render runs discovery (one sequential `rev-parse` per folder, ~25 ms each). `workspaceContains` is not an
  option: the non-glob form checks only folder roots; `**/.git` never fires under default `files.exclude`
  (which contains `**/.git`) and `rg --files` never lists a `.git` directory anyway. Add `capabilities`:
  `untrustedWorkspaces: { supported: false }` and `virtualWorkspaces: false` (the only correct declarative
  "do not load where there cannot be a repo"). Keep the §6 message row; `viewsWelcome` would cover only the
  zero-repo case, needs a context key to avoid flashing, and duplicates the built-in SCM welcome.
- **§3 "Refresh" row premise is wrong.** `.git` is *not* in the default `files.watcherExclude`; only
  `.git/objects/**` and `.git/subtree-cache/**` are (VS Code `files.contribution.ts`). A create-only
  `createFileSystemWatcher('**/.git/HEAD')` is allowed and is what the built-in git extension relies on. For M4:
  cache discovered roots; re-run on `onDidChangeWorkspaceFolders`, manual refresh, and that watcher; gate the
  status bar and the focus/editor listeners on the latest discovery result; never treat an E17 rejection as
  "zero roots". Focus/editor-change refresh should not re-run discovery in a repo-less window.
- **M1 merged 2026-09-20** (PRs #1–#6, #9, #10, merge commits). M2 started the same day as branches `m2/01…03`.
- M2 stack built and submitted 2026-09-20 as branches `m2/01-core-changes`, `m2/02-changes-binary-and-git-tests`, `m2/03-vscode-file-nodes` (see D31–D37; GitHub numbers recorded in M3's first PR).
- **§11.1's "the next milestone that touches a file may modernise it in passing" — DONE for all of M1 and
  M2 in one pass, 2026-09-20 (`refactor/idiomatic-typescript`, D39), rather than file by file over M3–M4.**
  Every constructor written under the withdrawn "explain by writing it the long way" rule now uses parameter
  properties (primer §47), `describeFailure` uses `??` (§30), `run()` uses conditional expressions (§48);
  the suites are byte-for-byte unchanged and their counts identical (127 unit / 87 git / 35 ext). From here
  the rule applies as written: a PR that touches a file modernises the lines it touches and adds the primer
  section.
- **Tooling follow-up (seen 2026-09-20 while building M2):** the real-git Vitest project occasionally fails one test
  with a 5 s timeout when the machine is under load (a single git spawn stalling 45–90 s, a different test each
  time; reruns pass; CI has never hit it). Consider a longer `testTimeout` for the `git` project, or find the stall,
  before M4 adds more real-git suites.
