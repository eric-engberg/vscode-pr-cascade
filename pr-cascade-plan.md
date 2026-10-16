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
   reviews and merges. Don't start the next milestone's stack until the current one is merged (waived twice, by
   Ric: 2026-10-01, M5's first two PRs on the unmerged M4 stack; 2026-10-15, M6's first PR on the unmerged M5
   stack, confirmed by Ric 2026-10-16 — §13.4).
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

**Discovery and rendering need no tool at all** beyond git and VS Code's own Git extension (§7.14). The tree's membership is git ancestry (§5), the same
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
- Refresh button + automatic refresh whenever the built-in Git extension notices a change — for git run
  outside VS Code that is when the window regains focus (§7.14).
- Works when the repo is a nested subfolder of a workspace folder.
- Builds on the built-in Git extension (`vscode.git`, part of VS Code and on by default) for the list of
  repositories and the change signal; with it disabled the view says so and does nothing else (decided
  2026-09-20, recorded 2026-09-26, §7.14). Until M3 the extension worked without it; that promise is dropped.

### v0.2+ (milestones 5–9)
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
- Show **all stacks** in the repo, not just the one containing HEAD (the views below draw them all).
- **Two views over one model (decided 2026-09-20, §7.1):** a compact *smartlog* rail in the Explorer for
  daily use, and a detailed *graph* view in the extension's own container. Both are webviews rendering
  the same `StackViewModel`; the v0.1 native tree is deleted when the smartlog reaches parity (M6).

### Non-goals (do not build)
- Creating branches or commits (VS Code and git already do this).
- Conflict resolution UI.
- Any direct forge API calls. **Never** store or request a token. Everything goes through `gs`, plus `gh` for the GitHub stack link and status extras.
- Replacing the built-in Git extension. This is a *supplementary* view, and from M4 it takes its
  repositories and its change signal from that extension (§7.14).

---

## 3. Decisions already made (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Language | **TypeScript**, strict mode | An earlier draft said plain JS "no build step" for a throwaway. This is now a proper project with tests; type checking is the cheapest bug-catcher for AI-written code. |
| Bundler | **esbuild** → `dist/extension.js` | Fast, standard for extensions, one config line. `tsc --noEmit` for typecheck. |
| Git access | `child_process.execFile(gitPath, [args])` — **array args, never a shell string**. From M4 `gitPath` is the executable the built-in Git extension found (`api.git.path`, which honours the user's `git.path`) unless `prCascade.gitPath` is set (§7.14) | Branch names contain `/` and could contain anything; no quoting bugs. One binary for both extensions, so they agree on what a repository is. |
| Forge access | **git-spice (`gs`) via `execFile` with `--no-prompt`**; a **terminal only for `gs auth login`** and for operations that can stop on conflicts (restack, sync, onto, merge). `gh` is used for `gh stack link` and for GitHub-only status extras (draft/checks) when present. | One stacking tool for both forges, offline-capable locally, documented JSON read model. |
| Diff rendering | Own `TextDocumentContentProvider` on scheme `stackdiff:` backed by `git show <ref>:<path>` | Chosen when the extension was to work without the built-in Git extension. That promise was dropped 2026-09-26 (§7.14), but `stackdiff:` stays: M3 shipped it, and the Git extension's `api.toGitUri` would only replace working code. |
| View location | **v0.1:** the native tree in `contributes.views.scm`. **From M6:** two webview views — `prCascade.smartlog` (`type: "webview"`, contributed to `explorer`) and `prCascade.graph` (`type: "webview"`, in the extension's own `prCascade` activity-bar container) — §7.1 | Ric's daily view is the Explorer; the compact rail condenses to a narrow pane, the graph needs room of its own. Users can drag any view into any container and VS Code remembers it, so the defaults only decide first impressions. Decided 2026-09-20 from the view-lab mockups (`docs/view-lab.html`). |
| View technology | **Webview views** (`WebviewViewProvider`) rendering a **pure view model** (`core/viewmodel.ts`); native `webview/context` menus; no UI toolkit | A lane graph with curves, a fixed glyph tail and an in-view file panel cannot be drawn with `TreeItem`. The costs are listed in §7.1.3 and accepted. §7.9's "no webview" principle is about *text editing* and still stands. |
| Repo discovery | **The built-in Git extension's repositories** — `getAPI(1).repositories` plus `onDidOpenRepository` / `onDidCloseRepository`, sorted by workspace-folder order then path (§6, §7.14). No scan of our own from M4. | Whatever the user's `git.*` settings open is what the Source Control view shows, and the stack view should show the same repositories. M1–M3's own scan (D26, up and down) is deleted in M4 item 12a. |
| Forge and host | **Derived per repo from the remote URL** (`git remote get-url <remote>`, `core/forge.ts`); host passed to `gh` as `GH_HOST`; forge kind gates GitHub-only steps | Same code path for github.com and GitHub Enterprise hosts. Never hardcode a host, never assume github.com. |
| Auth | **None in the extension.** `gs auth login` (interactive, per forge) is the only mechanism; the extension detects state with `gs auth status` and opens the login terminal on demand. On GitHub hosts it recommends the **GitHub CLI** method (reuses `gh`'s OAuth token — no PAT) or OAuth device flow. | Tokens are stored by git-spice in the OS keychain; the extension never sees one. |
| Stack membership | Branches that are ancestors of HEAD and not merged into trunk | Linear by construction; matches the user's workflow. Multi-stack is v0.2. |
| Refresh | Each repository's `state.onDidChange` from the built-in Git extension, debounced by us; manual button; an explicit refresh after every command of our own (§7.14.2) | The Git extension already watches the working tree, the first level of `.git` and HEAD's upstream ref, runs `git status` once the window is focused (1 s debounce, 5 s cool-down) and fires the event after every run. Its watcher does not see a ref moving on its own (`refs/heads/*`, `refs/spice/*` — `gs branch track`, `git branch -f`), which is why our own commands refresh explicitly (E83). Replaces the focus/editor listeners and the `.git/HEAD` watcher idea (§13.4, 2026-09-26). |
| Built-in Git extension | **Required, acquired at runtime** — `extensions.getExtension('vscode.git')` → `activate()` → `getAPI(1)`; no `extensionDependencies` entry — for three things: the repository list, the change signal, the git executable. **Kept as our own git spawns:** stack membership and order, layer diffs, file content, trunk, the current branch and detached HEAD, rebase-in-progress (§5, §7.14) | Ric's rule: prefer VS Code's own APIs over re-implementing them. Verified 2026-09-26 against VS Code 1.85 (our `engines` floor) and 1.138 (§13.4): the API has no usable branch list (`state.refs` is deprecated and empty), `state.rebaseCommit` spells out `<root>/.git/` and is undefined in a linked worktree, `state.HEAD.name` becomes a *tag's* name when a tag points at a detached HEAD, and `onDidCommit` / `onDidCheckout` do not exist at 1.85. A dependency declared in package.json (`extensionDependencies`) would make PR Cascade vanish entirely when a user disables Git, while the message row for `git.enabled: false` is needed anyway (E82). |
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
src/vscode/    ← Adapters: view providers, content provider, commands, terminals, config.
src/webview/   ← M6: browser code for the two views. Renders a StackViewModel into DOM, posts messages
                 back. NO `vscode` import, NO node built-ins; only acquireVsCodeApi(). Bundled separately.
src/extension.ts ← activate(): wires core to vscode, returns { provider, refresh } for tests.
```

Enforce with an ESLint `no-restricted-imports` rule on `src/core/**` (forbid `vscode`) and, from M6, a
second one on `src/webview/**` (forbid `vscode` and node built-ins). `src/webview` may import **types**
from `src/core` (the view model) — types only, so the browser bundle carries no host code.

As built (M6 item 23c, D69): `@typescript-eslint/no-restricted-imports` on `src/webview/**/*.ts` — `paths` are
`vscode` and every name in `node:module`'s `builtinModules` in both spellings, built in the config so a new built-in
is covered the day Node ships it; `patterns` is `**/core/**` with `allowTypeImports: true` (ESLint's own rule has
the option too; the copy is used because the recommended TypeScript rules come from the same plugin) — plus
`no-restricted-globals` for `window`'s properties the DOM lib declares as bare globals. The compiler
holds the other half: `tsconfig.webview.json` (`lib` DOM, `types: []`) refuses a Node global in a view, and the
root `tsconfig.json`, which excludes `src/webview`, refuses a host file that imports a view file — `window` is
TS2304 there. A dynamic `import()` escapes the lint rule and is caught by `test/unit/build.test.ts` on the bundle
itself (a `require()` call escapes it too, and `@typescript-eslint/no-require-imports` and the compiler refuse it
first); `test/unit/lint.test.ts` pins both rules at the source.

### 4.2 Module map

```
src/core/git.ts          GitRunner interface + RealGitRunner (execFile). Env: LC_ALL=C, GIT_OPTIONAL_LOCKS=0.
src/core/discovery.ts    M1–M3 only: workspace folders → repo roots. Deleted in M4 (item 12a); the roots come from vscode/gitApi.ts.
src/core/trunk.ts        trunk detection (config → origin/HEAD → candidates).
src/core/stack.ts        computeStack(): layers, order, parents, current branch, rebase-in-progress.
src/core/changes.ts      changedFiles(parent, branch): name-status -z parsing, rename, binary detection.
src/core/uri.ts          encode/decode stackdiff: URIs (pure functions).
src/core/debounce.ts     tiny debounce (pure).
src/core/prdraft.ts      generate {title, body} drafts from commits + template (pure).
src/core/template.ts     PR template lookup in gh's order over a file list (pure).
src/core/prplan.ts       render/parse the editable plan document (pure, round-trip tested).
src/vscode/prplan.ts     prcascade-prplan document, CodeLens, keybinding, workspaceState drafts.
src/core/command.ts      CommandRunner interface + RealCommandRunner (spawn → a CommandResult, never a rejection; since item 22a a
                         timed-out program's whole process group is killed on macOS and Linux — D63) for
                         git-spice and, since item 23a, gh; each tool's module owns its flags and env. M5 item 18, D56;
                         the §11.3 execa question (item 21) is measured against it.
src/core/backend.ts      StackBackend interface (§4.4; declared with the members the next PR implements, grown per
                         implementing PR — D55) + the Readiness union (§7.13.1's answer). Types only. M5 item 17.
                         Item 20a adds enrich, track and TrackResult (D59).
src/core/digest.ts       M5 item 20a (D59, a module §4.2 did not list): DIGEST_ARGS, readRefDigest(git, root) (one for-each-ref over
                         refs/heads, refs/remotes, refs/spice — the §7.14.2 pre-filter's input, stdout verbatim), isInitialised(digest)
                         (the refs/spice/data line: the §7.6 fact read off text already in hand). M6 item 23b (D68):
                         remoteBranches(digest) — the branch names under refs/remotes/<remote>/, any remote, as bare names, a
                         second fact off the same text: ⛅'s source (the inventory's `rev-parse --verify refs/remotes/origin/<b>`
                         with no spawn; git-spice's remote is not in its output, so any remote counts).
src/core/version.ts      Version, parseVersion, isAtLeast, formatVersion — the hand-rolled floor compare (D56) shared by
                         gitspice.ts (0.31.0) and ghstatus.ts (2.90.0); a module §4.2 did not list, made in item 23a so
                         ghstatus.ts and the backend need not import each other (D65).
src/core/backends/gitspice.ts   the git-spice implementation (§7.13): GitSpiceBackend — readiness (item 18, D56:
                         `git-spice` then `gs` or prCascade.gsPath alone, identified by the `--version` banner, ≥ 0.31.0,
                         `refs/spice/data`, detectForge, `auth status --forge`, and on GitHub gh through core/ghstatus.ts —
                         item 23a, D65; `ready` memoized per root+remote);
                         enrich/track as built (item 20a, D59): `log short --all --json` behind the digest memo per root,
                         self-gated on `refs/spice/data`, locate-on-demand; `track` only `null` layers, base = the layer
                         below or the trunk's local branch, a result not a throw; push from item 21.
src/core/gsLog.ts        parse the `gs log short --all --json` line stream (pure; schema in §7.13.2) → entries + malformed
                         lines; hand-rolled §51 ladder (D55). M5 item 17. Its entry type is what StackLayer.tracking carries
                         (item 20a). M6 item 23b (D68): `change.comments { resolved, unresolved, total }` kept — 💬's source
                         field, so M7's `--cr-status` adds nothing to the parser.
src/core/forge.ts        parseRemoteUrl() → {host, owner, repo} | null from ssh / scp-like / https forms;
                         parseForgeConfig() + classifyHost() → kind (github/gitlab/bitbucket/gitea/forgejo/
                         azuredevops/unknown) + recognizedByGitSpice; detectForge(git, root, remote) →
                         ForgeDetection (no-remote | unparseable | forge); ghEnv(host) → {GH_HOST}. M5 item 16, D54.
src/core/shell.ts        shellQuote / shellCommandLine: a command's words as one sh/bash/zsh line for a terminal.
                         M5 item 19a, D57.
src/core/poll.ts         waitUntil(check, {intervalMs, timeoutMs}, signal?) → done | timeout | aborted: the §7.5 poll
                         for both tools, over the global timers (the polling half of the ghstatus line below,
                         generalised). M5 item 19a, D57.
src/core/readinessFix.ts offerFor(NotReady, facts) → Offer {severity, message, fix: {button, action, done} | null}: each
                         §7.13.1 offer's sentence and command; trunkBranchFor(git, root, trunk) → the local branch
                         `gs repo init --trunk` needs; readyMessage. M5 item 19a, D57.
src/core/ghstatus.ts     gh for the probe's step 5 (§7.5, §7.13.1), pure over a CommandRunner: gh by its `--version` banner (floor
                         2.90.0), gh-stack by `gh stack --version`'s banner, the login by `gh auth status --hostname <host>` exit 0;
                         GH_ENV + ghEnv on every spawn; runGh for M7's `gh stack link`. Its login poll is poll.ts's waitUntil over the
                         probe (D57). M5 item 23a, D65.
src/core/prs.ts          §7.7 planner: layers + status map → ordered operations (pure).
src/core/prstatus.ts     §7.8 status tiers: gs JSON + optional gh extras → per-layer status (pure).
src/core/nativeStack.ts  `gh stack link` after submit on GitHub repos — required there (§7.13.4).
src/core/model.ts        types below. M6 item 23b (D68): `Enrichment.enriched` gains `byName` (every line of the `gs log --all`
                         answer by branch name — the other stacks' indicators), `complete` (whether every line parsed) and
                         `remoteBranches` (digest.ts's set), set by `withTracking` on both the run and the memo path; `PrExtras`
                         (M7's gh tier: isDraft, reviewDecision, checks, baseRef, title) and `ReviewDecision` declared here for
                         core/viewmodel.ts to read and M7's core/prstatus.ts to fill.
src/core/graph.ts        M6 item 23a (D67): readGraphInput(git, root, trunk) — three read-only spawns, texts verbatim as
                         digest.ts returns its one: `for-each-ref --format='%(refname:lstrip=2) %(objectname) %(committerdate:unix)'
                         refs/heads` (every local branch, merged or not, with its commit's date), `rev-list --parents --branches
                         --not <trunk>` (every commit above trunk with its parents) and `rev-list -1 --no-commit-header
                         --format='%H %ct' '<trunk>^{commit}'` (trunk's tip and its date) — then the pure parseRefs / parseDag /
                         parseTrunkTip and layoutGraph(input, { trunk, head, dirty, onlyStackOf? }) → GraphLayout { rows, lanes }:
                         every stack in the repo in drawing order, each row with lane, node and joinsLane, plus the working-tree
                         and elided rows (§7.1.1, E78); `onlyStackOf` is §7.2.1's filter, git-spice's stack. `dirty` is an input
                         (23d reads the Git extension's change lists, §7.14). Consumed by viewmodel.ts (23b); nothing in src/
                         imports it until 23d, so the tree is untouched.
src/core/viewmodel.ts    M6 item 23b (D68): buildStackViewModel({ state, graph, workingTreeFiles, now, showOnlyThisStack,
                         behindTrunk, extras }) → StackViewModel { repo, rows, lanes, messages } — calls layoutGraph itself (the
                         §7.2.1 filter is `onlyStackOf: state.head`, before lanes, only while HEAD is on a stack), then dresses
                         every row: `indicators` in the tail's fixed order from their source fields (`enrichment.byName`,
                         `remoteBranches`, `extras` behind a `change`, the inputs), `age` from a fixed clock (formatAge), `dim`,
                         `tooltip` lines, `context` for `data-vscode-context`; the four message rows word for word from tree.ts.
                         Pure; no spawn; the views compute nothing (§7.1.3). Consumed by src/webview/protocol.ts (types) and
                         extension.ts (23d); nothing in src/ imports it until then.
src/webview/protocol.ts  M6 item 23b (D68): the message types between the extension host and the two webviews, types only —
                         host → view `ModelMessage { type: 'model', seq, repos: StackViewModel[], activeRepo, notices: HostNotice[] }`
                         (pending item 5's arrangement; one repository is an array of one; `notices` carries the §6/§7.14.3/E17 rows
                         that belong to no RepoState); view → host `CommandMessage { type: 'command', seq, command: CommandId, args }`
                         and `MoveOntoMessage { type: 'moveOnto', seq, repo, layer, target }` (E77); `CommandId` = `prCascade.${string}`
                         (E79's rule as a type; the host still checks the text it receives). `import type` from core only — the
                         first file under the §4.1 webview rule; its lint block and the webview tsconfig landed with 23c (D69).
src/webview/host.ts      M6 item 23c (D69): the view side of the bridge — `VsCodeApi { postMessage }` (`getState`/`setState`
                         declared when something reads them, D55), a module-scoped `declare function acquireVsCodeApi()`
                         (`@types/vscode-webview` is under the downloads floor), `connect()` → `HostConnection { onModel,
                         postCommand }`; `onModel` passes on what arrives from the page's own origin and a three-clause type predicate
                         accepts (`type`, a numeric `seq`, a `repos` array) and ignores the rest in silence; `postCommand` stamps the `seq` of the last
                         model delivered (E79's view half; the drop is the host's, 23d). The only file that names
                         `acquireVsCodeApi`.
src/webview/smartlog/    M6: the compact rail renderer (§7.1.1): render(model) → DOM, keyboard, drag and drop. Item 23c (D69):
                         render.ts's `render(root, message)` draws every row, message and notice as one line of plain text — §10.1 23d's "rows rendered
                         as plain text for now", built on the view side so 23d is host-only; 23e rewrites it in place. main.ts
                         is the esbuild entry → dist/webview/smartlog.js.
src/webview/graph/       M6: the detailed graph renderer (§7.1.2). Its main.ts and the second esbuild entry (one key in
                         esbuild.mjs's `entryPoints`) are 23i's.
src/vscode/views/base.ts M6: WebviewViewProvider base — HTML shell + CSP nonce, posts the model, routes messages to commands.
src/vscode/views/smartlog.ts, graph.ts   M6: the two providers (thin subclasses).
src/vscode/tree.ts       StackTreeProvider (TreeDataProvider<Node>), node classes. v0.1 only; deleted in M6 (item 23j).
src/vscode/gitApi.ts     M4: the built-in Git extension's API (§7.14) — takes what extension.ts got from getExtension('vscode.git'),
                         activate()s it, getAPI(1), waits for 'initialized', repositories → sorted roots, state.onDidChange →
                         refresh, gitExecutable(), the E82 rows. The one file that imports git.d.ts; the ext tests' helper
                         test/ext/helpers/gitApi.ts reaches the API through this adapter and its `GitApi` type.
src/vscode/git.d.ts      the Git extension's public API types, copied verbatim from VS Code `release/1.85`
                         `extensions/git/src/api/git.d.ts` (MIT, Microsoft header kept). The floor's file on purpose (§7.14.1).
src/vscode/content.ts    StackDiffContentProvider.
src/vscode/contextKeys.ts   M5 item 21b (D62, a module §4.2 did not list): the two context-key names extension.ts's load
                         listener sets and package.json's `when` / `enablement` read (`hasUntracked`, item 20b;
                         `rebaseInProgress`); the manifest test compares against them.
src/vscode/commands.ts   refresh / openDiff / createPR / pushStack / checkout. As built: `openDiff` alone (M3 item 11);
                         `refresh` is `refreshSoon.schedule` in extension.ts (M4 item 12b), and `trackStack` / `pushStack`
                         are functions in extension.ts (M5 items 20b/21b, D60/D62; reading order item 2). `createPR` and
                         `checkout` are unbuilt.
src/vscode/terminal.ts   run a command in a named terminal, reuse if exists. As built (M5 item 19b, D58): runInTerminal over a
                         TerminalHost (VS Code's three terminal calls, handed in), one `PR Cascade: <folder>` terminal per
                         repository, reused by name and directory while its shell lives.
src/vscode/login.ts      the two login flows (gs §7.6, gh §7.5): prompt → terminal → poll → re-run action. As built (M5 item
                         19b, D58): ReadinessFlows.ensureReady for every §7.13.1 offer, one fix in flight per repository,
                         over a ReadinessHost (notifications, quick pick, browser, terminals, disk); chooseRepository,
                         machineFacts. Since item 23a (D65) `progressOf` is a Record over every Readiness kind, so the two gh
                         members pass through the same flow; their offers' buttons, `brewGh`, the three steps inside
                         `gh-missing` and `installAppeared` landed with item 23b (D66).
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
  tracking?: GsLogEntry | null;   // M5 item 20a (D59): git-spice's own `gs log` line for this branch. Absent = not
                                  // enriched, or unlisted by an answer with a malformed line (unknown); null = untracked
                                  // (E56); an entry with no `down` is git-spice's trunk line (a local trunk ahead of its
                                  // remote-tracking ref is a layer here and the trunk there). Never assigned undefined.
}

// M5 item 20a (D59): how `enrich` went, for the Output channel — never a row (E57).
export type EnrichmentCause = 'not-initialised' | 'gs-missing' | 'gs-too-old' | 'gs-log-failed';
export type Enrichment =
  | { readonly kind: 'enriched'; readonly ranGsLog: boolean; readonly malformed: readonly MalformedLine[];
      readonly byName: ReadonlyMap<string, GsLogEntry>;   // M6 item 23b (D68): the whole `gs log --all` answer by branch name —
      readonly complete: boolean;                          // what every stack's rows read; `complete` = no malformed line, so
      readonly remoteBranches: ReadonlySet<string> }       // "absent" means untracked; the digest's refs/remotes branch names (⛅)
  | { readonly kind: 'not-enriched'; readonly cause: EnrichmentCause; readonly reason: string };

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
  enrichment?: Enrichment;      // item 20a: absent when enrich was not asked (no trunk, no layers); never assigned undefined
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
substitute a fake and so a second backend would be additive. *As built (M5 item 17, D55):* the block
below is the **target shape**; `src/core/backend.ts` declares each member with the PR that implements it —
`kind` and `readiness(root, remote)` in item 17/18, `enrich`, `track`, `push` in items 20–21, the rest with
M7–M9 — so no implementer or fake ever stubs a method that does not exist yet. `root` is added where the
block omits it (every core function is `(git, root, …)`), `remote` because the probe reads that setting.
*Item 19a (D57)* adds two aliases beside `Readiness` — `Ready` (`Extract`, the `ready` member) and `NotReady`
(`Exclude`, the rest) — and `GitSpiceBackend.forget(root, remote)`, which drops one remembered `ready` for the setup
command's fresh look; on the class only, not the interface, until a second implementer or caller needs it (D55's rule).
*Item 20a (D59)* adds `enrich(state): Promise<RepoState>` — `opts.network` waits for M7, which implements it — and
`track(root, layers, trunkBranch: TrunkBranch): Promise<TrackResult>` (`{ tracked, problem | null }`, not the block's
`void`: the backend never throws for anything git-spice says, as `readiness` promises, and the command's message needs
the count and git-spice's words); the trunk's *local* branch is the caller's question (`trunkBranchFor`, item 19a),
handed in through a type-only import of `readinessFix.ts`.
*Item 21a (D61)* adds `push(root, layers): Promise<PushResult>` (`{ pushed, notes, problem | null }`, `TrackResult`'s shape
plus the lines git-spice printed that are not `INF Pushed`, for D59's reasons — not the block's `void`); `layers` feed
three refusals — nothing to push, a layer the remote is ahead of (E76), a layer needing a restack — and nothing else,
because `gs stack submit` acts on HEAD's stack from any member, and from trunk on every stack (verified 0.31.2); `pushed`
comes from git-spice's `INF Pushed <branch>` lines. The `CommandSink` for "everything else" is `core/command.ts` (D56): `execFile` as a sink name in §3, §7.6, §7.7 and §7.13.3 means that runner, which since item 22a is `spawn` with `detached` and a process-group kill on macOS and Linux (D63); the terminal sink is unchanged.
`execa` measured and declined (D61).

```ts
export interface StackBackend {
  readonly kind: 'git-spice';
  /** gs installed + version ok + repo initialized + forge known + logged in to it (`gs auth status --forge <kind>`)? Never throws for anything git-spice-side; rejects only when git itself cannot run (E17) or the root cannot be used as a directory — faults the caller already draws, as detectForge's are. */
  readiness(root: string, remote: string): Promise<Readiness>;
  /** Add change (id/url/status), push state, needsRestack, tracked to layers. Degrades. `opts` from M7. */
  enrich(state: RepoState, opts: { network: boolean }): Promise<RepoState>;
  track(root: string, layers: StackLayer[]): Promise<void>;          // adopt detected branches
  push(root: string, layers: StackLayer[]): Promise<void>;           // gs stack submit --no-publish
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
`Readiness` (item 17) is a tagged union on `kind` — `ready` plus one member per step of §7.13.1 that can fail — in
probe order, first failure wins: `ready {gsPath, gsVersion, forge, gh}` · `gs-missing {tried}` · `gs-too-old {gsPath, found,
minimum}` · `not-initialized {gsPath}` · `no-remote {remote}` · `remote-unparseable {remote, url}` ·
`forge-unrecognized {forge, config}` (E60 for `unknown`, E70 for an unrecognised `github` or `gitlab`; `config` is the
`ForgeConfig` detectForge read, so the message can name a rejected `spice.forge.kind` or the url key that displaced
a default) · `forge-unsupported {forge}` (E75) · `not-logged-in {gsPath, forge}` · `gh-missing {forge, missing:
('gh' | 'gh-stack')[], ghVersion, ghMinimum, ghPath}` (E62b) · `gh-not-logged-in {forge, ghPath}` (E23; item 23a, D65) —
eleven members; `ready` gained `gh: GhFound | null` (`{ path, version }`, `null` on GitLab) in item 23a (D55's rule:
`readyMessage` reads it).
Each member carries what its one-click fix needs and nothing the caller already holds.

Long-running commands run through a `CommandSink`: anything that can stop on conflicts (restack,
sync, onto, merge) runs in a **terminal** so the user can resolve and `gs rebase continue`; everything
else via `execFile` with `--no-prompt`. The contract scenarios (§9.6) are written against the interface.

---

## 5. Git command reference (all of these were run and verified against a real repo)

| Purpose | Command | Notes |
|---|---|---|
| Repo root from any folder | `git rev-parse --show-toplevel` | Walks up. Fails (non-zero) outside a repo. **M1–M3 only** — from M4 the built-in Git extension supplies the roots (§7.14). |
| Trunk auto-detect | `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` → else first that verifies of `origin/main`, `origin/master`, `main`, `master` | `git rev-parse --verify --quiet <ref>` is the existence check. |
| Current branch | `git symbolic-ref --quiet --short HEAD` | Non-zero when detached → `head = null`. |
| Stack members | `git for-each-ref --format=%(refname:short) refs/heads --merged HEAD --no-merged <trunk>` | Ancestors of HEAD not in trunk. Includes the current branch. |
| Layer order | `git rev-list --count <trunk>..<branch>` per branch, sort ascending | Ties (two branches on one commit): stable-sort by name; treat as same layer. |
| Layer SHA | `git rev-parse <branch>` | |
| Files in a layer | `git diff --name-status -M -z <parent> <branch>` | **Use `-z`.** Entries are `STATUS\0path\0` or `R<n>\0old\0new\0`. Tree diff, not two-dot. |
| Binary detection | `git diff --numstat -z <parent> <branch>` | Lines with `-\t-\t` are binary. |
| File content at ref | `git show <ref>:<path>` | Non-zero when file absent at that ref (adds/deletes) → treat as empty string. |
| Rebase in progress | `git rev-parse --git-path rebase-merge --git-path rebase-apply` (one call, one line per name; relative to the working directory in an ordinary repository, absolute in a linked worktree), check each dir exists | `--git-path` is worktree-correct; don't hardcode `.git/`. Stays ours in M4: the built-in Git extension's `state.rebaseCommit` does hardcode `<root>/.git/` and is undefined in a linked worktree (§7.14, E19). |
| Every local branch (M6 graph) | `git for-each-ref --format='%(refname:lstrip=2) %(objectname) %(committerdate:unix)' refs/heads` | Name order; merged branches included — the DAG decides membership; the date is the row's age (23b), always present (a branch is always a commit). |
| Every commit above trunk, with parents (M6 graph) | `git rev-list --parents --branches --not <trunk>` | One line per commit: sha then parents; a parent that is no line is a trunk commit (the fork). Empty on a trunk-only repo, exit 0. |
| Trunk's tip and its date (M6 graph) | `git rev-list -1 --no-commit-header --format='%H %ct' '<trunk>^{commit}'` | The same SHA and failure as `rev-parse --verify`, plus the date; rev-list not log so `log.*` settings cannot add lines. |
| Push stack | `git push --force-with-lease origin <layer1> <layer2> ...` | Never `--force`. |
| Restack after trunk moved | from top layer: `git rebase --update-refs <trunk>` | |
| Restack after bottom squash-merged | from top layer: `git rebase --update-refs --onto <trunk> <merged-branch>` | `--onto` excludes the merged commits so squash produces no phantom conflicts. Needs the merged branch's local ref to still exist. |
| Restack after amending layer X | from top layer: `git rebase --update-refs --onto X X@{1}` | Reflog cut point. See Appendix B for the tested detection logic and its bugs. |

Rows from "Push stack" down are **reference only** — git-spice performs those operations (§7.13.3); the
extension itself runs only the read-only rows plus `git checkout`, `git status --porcelain` and
`git remote get-url`. They stay here because Appendix B and the README's "what gs is doing" explanation
rely on them.

Environment for every git call: `LC_ALL=C` (stable parsing), `GIT_OPTIONAL_LOCKS=0` (don't fight the
built-in git extension over the index lock), `maxBuffer` ≥ 32 MB. From M4 the executable is the built-in Git
extension's `api.git.path` unless `prCascade.gitPath` is set (§7.14.1).

---

## 6. Repo discovery (§3 decision, spelled out)

**From M4 (item 12a) the built-in Git extension does the discovering** — decided 2026-09-20, recorded
2026-09-26; what was verified about its behaviour is in §7.14.2 and §13.4. M1–M3 ran a scan of their own
(D26, walking up from each folder and down to `prCascade.repositoryScanMaxDepth`); that code and its two
settings are deleted.

```
api   = the Git extension's API (§7.14.1), once api.state === 'initialized'
roots = api.repositories.map(r => r.rootUri.fsPath)
        sorted by key = lowest index in workspace.workspaceFolders of a folder equal to, under or above the root
                  (none → after every keyed root), then by path in character-code order (as core/stack.ts sorts names)
one root  → tree top level = layers
many      → tree top level = RepoNode per root (label = basename(root)), children = layers
zero      → single informational node "No git repository in this workspace"
api.onDidOpenRepository / api.onDidCloseRepository / workspace.onDidChangeWorkspaceFolders → refresh
```
Which repositories exist is the user's `git.*` configuration, exactly as in the Source Control view:
workspace folders always; repositories *below* them when `git.autoRepositoryDetection` is `true` (default)
or `subFolders`, to `git.repositoryScanMaxDepth` (default 1 — the §1 parent-folder layout) and skipping
`git.repositoryScanIgnoredFolders` (E1); a workspace folder *inside* a repository whose root is not itself a
workspace folder is parked behind the Git extension's own Yes / Always / Never notification
(`git.openRepositoryInParentFolders`, default `prompt`) and is not a repository for us until it is answered
(E1b); a checked-out submodule is a repository of its own (`git.detectSubmodules`, default on) with its own row;
a repository closed from Source Control stays closed across reloads. A root with no folder is possible — the Git
extension keeps a removed folder's repository open while an editor in it is visible, and at 1.138 an empty window
opens the repository of a visible editor — so the rule places it last rather than leaving the comparator to
decide; and the folder listener stays because folder order is the sort key and a folder change need not open or
close a repository (§7.14.2). Identity is `rootUri.fsPath` — the API hands out a new `Repository` wrapper on
every access — and the array's order is not stable (the Git extension re-sorts it internally), hence the sort
above. Manual refresh re-reads `api.repositories`; nothing is cached.

---

## 7. UI spec

### 7.1 Views

**Decided 2026-09-20:** two views over one model, both webviews (§3). The v0.1 native tree (7.1.0) ships
first (M1–M4) and is deleted when the smartlog reaches parity (M6, item 23j). The visual spec is
`docs/view-lab.html` — three mockups of one scenario with every indicator drawn in, plus the inventory of
where each indicator's data comes from and which milestone can compute it. The text here is what a PR is
checked against; the page is what it should look like.

#### 7.1.0 The v0.1 native tree (M1–M4)

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
  found. Click → reveals/focuses the Stack view. Updates on the same refresh cycle as the tree. The branch
  name is our own `symbolic-ref` answer (§5), not the Git extension's `state.HEAD` (§7.14: that field turns
  into a tag's name when a tag points at a detached HEAD). `n` counts from the bottom; under v0.1's HEAD-only
  membership (§12 item 2) `n` equals `N` except for E6. With several repositories the item describes the
  first in §6 order and names its root in the tooltip (D52; M6 moves to the active editor's repository). VS
  Code asks a hidden tree view for nothing until it is shown again, so `refresh()` runs the pipeline itself
  while the view is hidden, and once at startup (D52).
- Current branch gets `$(target)` icon and "· current" in the description; others `$(git-branch)`.
- File nodes: label = basename, description = dirname, `resourceUri` set (so file icons + decorations
  work), status letter as a prefix in the label or via `iconPath` — pick one, keep it consistent.
- Special nodes: "No trunk found — set prCascade.trunk", "Rebase in progress — resolve it first",
  "Detached HEAD" (still shows layers), "Not on a stack" (zero layers).

#### 7.1.1 Smartlog rail — `prCascade.smartlog` (compact; Explorer by default)

Modelled on Graphite's VS Code smartlog; pane B of `docs/view-lab.html`.

```
PR CASCADE                                  [Sync ▾]              ⟳  ⛅  ⚙
 ○  feat/FWRK-1610-e-collector-ui                              ⛅        3m
 ○  feat/FWRK-1610-d-collector-api                             ⛅        3m
 ○  feat/FWRK-1610-a-collector-core                            ⛅        3m
 │ ○   feat/FWRK-1434-part4                   not tracked      ⛅       15m
 │ ◌   Uncommitted changes                               2 files       now
 │ ●   feat/FWRK-1434-part3               ⇈  ✕ 2/7   (#482 draft)      2d   ← checked out: filled node, blue row
 │ ○╮  feat/FWRK-1434-part2          💬2  ⇄  ↑1 ⛅   (#481 open)      40m
 ○  feat/FWRK-1434-part1                             (#480 merged)      3d
 │ ○╮  fix/FWRK-1500-retry-timeout                   (#479 open)        1w
 ┆
 ○  main                                            ↓5 · local ↓3     26h
 ────────────────────────────────────────────────────────────────────────
 ⌄ feat/FWRK-1434-part3                                               …
    ⌄ 🗀 src/collector
         ● ingress.ts             (M, orange)
         + ingress.test.ts        (A, green)
                          [ Submit ]  [ Check out ]
```

- **One row per branch, one line high** (VS Code's list row height, 22 px; §12 item 12). Columns: a 40 px
  rail cell, the branch name (ellipsised, never wrapped), then a right-aligned **tail**.
- **Rail.** Lane 0 is trunk's line. A stack whose bottom sits on lane *n* draws its layers in lane *n*; a
  second stack on the same parent opens lane *n+1*, and its lowest row **curves into the parent's lane**
  (the `╮` above). Nodes: hollow circle = layer; filled = the checked-out layer; yellow dashed = the working
  tree when dirty (a child of the checked-out layer, as Graphite draws it); a dashed segment = elided trunk
  history between the lowest stack and `main`. Lane assignment is `core/graph.ts` (pure, E78).
  *As built (M6 item 23a, D67):* `layoutGraph` draws depth-first, top first and the trunk row last — the child whose
  subtree has the most rows (usually the long stack) stays on its parent's lane, every other child takes `lane + 1` and
  its lowest row carries `joinsLane` — so a second stack on the same parent opens the next lane and curves into it,
  consecutive siblings share that lane, lanes never cross, and neither a checkout nor a fetch moves a lane; among
  trunk's side roots the ones on its tip sit above the ones behind it; the working-tree row sits directly above the
  checked-out row whatever that row's children; the elided history is one row for the repository.
- **Tail, fixed order, each glyph only when true:** ⇈ needs restack (amber) · 💬*n* unresolved comments
  (red) · ⇄ PR base drifted from the local parent (amber) · the push slot, one of ↑*n* unpushed commits (blue),
  ↓*n* the remote ahead (blue) and ⇅ diverged (red, E76) · ⊡ checked out in another worktree · ⛅ never pushed ·
  ✕ *f/n* failing checks (red; GitHub only) · **the PR mark** — codicons' `git-pull-request` /
  `git-pull-request-draft` / `git-merge` / `git-pull-request-closed` in the state colour (green open, grey draft,
  purple merged, red closed; number and title in the tooltip), last, so every row's mark sits in one column · age.
  (Ric, 2026-10-16: the order and the marks; the native-stack chip and a conflict ring on the mark follow with M7's
  data.) Untracked layers get a dim name and
  "not tracked"; merged layers a dim name; trunk shows `↓n` behind origin and `local ↓m` when the local
  trunk branch lags its remote.
  *As built (M6 item 23b, D68):* the order is the view model's, not the renderer's — `ViewRow.indicators` is built in this
  order with `untracked` first (the exclusive state, which only ⛅ may join), then the bullet's ten, each present only when
  true, so a renderer maps the list and never sorts (✕ before the PR mark and the mark last — decided 2026-10-16, Ric; the
  ASCII above and pane B had drawn it so); `dim` is on the row (untracked, or `pr.state === 'merged'`); the trunk
  row's `↓n · local ↓m` is one `behindTrunk` indicator from 23d's counts; ⛅ means "no remote-tracking branch of that name on
  any remote" (the digest's `refs/remotes`), shown for a tracked branch git-spice has not submitted and for an untracked one
  alike — a branch pushed with plain `git push -u` shows nothing, since `gs log` prints `push` only for branches git-spice
  submitted (0.31.2, measured) and ahead/behind would need a `rev-list`; the push slot reads the two counts (not
  `push.needsPush`, true for all three): `↑n` is `ahead` alone, `↓n` `behind` alone, ⇅ both (E76, M4b); ⊡ is `gs log`'s
  `worktree` when it is not the repository's root (Ric, 2026-10-16); ⇄ compares the forge's base with git-spice's
  `down.name`; the PR mark's tooltip title arrives with M7's `title`.
- **Condensing (E80).** Below 260 px the tail keeps only the PR mark and the age and the rest moves into
  the row tooltip; below 200 px the age goes too. Nothing ever overflows horizontally. This is why the view
  can live in the Explorer.
- **Focus vs checkout.** ↑/↓ move a focus outline; the checked-out row has the filled node and the
  `--vscode-list-activeSelectionBackground` background. Enter checks out the focused layer (after the E13
  dirty-tree refusal); the panel below always follows the *focused* row.
- **Lower panel** (Graphite's): the focused layer's name, its changed files as a folder tree (codicons;
  status colour from `--vscode-gitDecoration-*`; click → `openDiff`), and two buttons: **Submit** (`createPR`
  for that layer; label "Update PR" when one exists) and **Check out**. Collapsible; its state lives in
  `workspaceState`.
- **Title-bar actions** are the §7.2.1 `view/title` layout unchanged — VS Code draws them for webview views
  too. **Row context menu** is §7.2.1's layer menu contributed as `webview/context` items whose `when`
  clauses read the keys each row sets in `data-vscode-context` (`webviewSection: "layer"`, `layer`, `hasPR`,
  `isDraft`, `isCurrent`, `isTracked`): same command ids, same groups, no custom menu HTML. *As built (M6 item 23b,
  D68):* the keys are `core/viewmodel.ts`'s `LayerContext` — `webviewSection: 'layer'`, `repo`, `layer`, `isCurrent`,
  `isTracked`, `isUntracked`, `isTrunkLine`, `hasPR`, `isDraft` — and `TrunkContext { webviewSection: 'trunk', repo, trunk,
  isCurrent }`, `WorkingTreeContext { webviewSection: 'workingTree', repo, layer }`; `repo` because VS Code hands the whole
  object to the command and E77 refuses by it.
- **Drag and drop** is the E77 gesture inside the webview (HTML5 DnD): layer rows are draggable, layer rows
  and the trunk row are drop targets, a drop posts `{ type: "moveOnto", layer, target }` and the host runs
  the §7.2.1 confirmation and refusals. Graphite's inline "Move *L* onto *B*? ✕ ✓" row is optional polish;
  the native confirm dialog is the requirement.
- **Message rows** replace the v0.1 special nodes: "Rebase in progress — resolve it first" (with the M9
  banner actions), "Detached HEAD" (layers still drawn), "No trunk found — set prCascade.trunk", and "Not on
  a stack" only when the repo has no stack at all — otherwise the other stacks are simply drawn.
  *As built (M6 item 23b, D68):* `StackViewModel.messages`, the texts word for word from tree.ts and its co-occurrence: no
  trunk → the one warning and no rows (nothing can be laid out); else a paused rebase → its warning, which replaces the
  detached row (every pause point but `git am` detaches HEAD); else `Detached HEAD`; then `Not on a stack` when the layout has
  no layer row — the repository has no stack. Show Only This Stack never empties the rail: on trunk or with HEAD detached
  there is no stack of HEAD's to show alone and every stack is drawn (a paused `git am` keeps HEAD on its branch, and the
  filter with it). The E82 rows and the zero-repository row are the host's (no
  `RepoState` exists for them): `protocol.ts`'s `HostNotice`.

#### 7.1.2 Change graph — `prCascade.graph` (detailed; own container)

Modelled on VisualJJ's graph; pane C of `docs/view-lab.html`. Same model, different rendering:

- A thick rail; trunk commits are **diamonds** on lane 0 (the tip in the accent colour with a `main` chip),
  layers are **large filled circles** on the lanes to the right (the checked-out one in the accent colour);
  curves rejoin the trunk lane; a dotted segment is elided history; the bottom ends in a squiggle.
- Rows are **tall and wrap**: state **pills** first (Editing = checked out, Draft, Changes requested,
  Approved, Merged, Not tracked, Restack needed, `2/7 checks`, `2 unresolved`, `base: main`), then
  `<branch> · <first commit subject>`, then the age and `↑n unpushed` as plain text. The checked-out row
  lists its **uncommitted files** beneath the title (click → diff against HEAD) and every other row carries
  a check button = **Check out**.
- Between stacks it shows the trunk commits that separate them (subject + age from `git log --format`
  over the elided range, capped at 50 rows with "… n more").
- Same `webview/context` menu, same drag and drop, same keyboard rules as the smartlog. No lower panel:
  everything is a pill or a menu item; the PR pill opens the PR and its tooltip reads "Click to open Pull
  Request #482 in GitHub".

#### 7.1.3 What both views share, and what a webview costs

- **One model.** `core/viewmodel.ts` (pure) turns `RepoState` + the §7.8 enrichment + `core/graph.ts`
  lanes into a `StackViewModel`; both webviews render it and compute nothing themselves. *As built (M6 item 23b,
  D68)* — the shapes, every field with its §8 row (the doc comments are in `core/viewmodel.ts`):
  ```ts
  export interface ViewModelInput {
    readonly state: RepoState; readonly graph: GraphInput | null;      // null exactly when state.trunk is null (E4)
    readonly workingTreeFiles: number; readonly now: number;             // the Git extension's change lists; unix seconds
    readonly showOnlyThisStack: boolean;                                  // §7.2.1 — HEAD's stack while HEAD is on one
    readonly behindTrunk: BehindTrunk | null;                             // 23d's two rev-list counts; null until then
    readonly extras: ReadonlyMap<string, PrExtras>;                       // M7's gh tier by branch; empty until then
  }
  export interface StackViewModel { readonly repo: string; readonly rows: readonly ViewRow[]; readonly lanes: number; readonly messages: readonly MessageRow[]; }
  export type ViewRow = LayerViewRow | TrunkViewRow | WorkingTreeViewRow | ElidedViewRow;   // 23i adds its trunk-commit rows
  export interface LayerViewRow {
    readonly kind: 'layer'; readonly name: string; readonly sha: string; readonly parent: string; readonly parentSha: string;
    readonly forks: readonly string[]; readonly lane: number; readonly node: 'hollow' | 'filled'; readonly joinsLane?: number;
    readonly indicators: readonly Indicator[]; readonly age: string; readonly dim: boolean;
    readonly tooltip: readonly string[]; readonly context: LayerContext;
  }
  export interface TrunkViewRow { readonly kind: 'trunk'; readonly name: string; readonly sha: string; readonly lane: 0; readonly node: 'hollow' | 'filled'; readonly indicators: readonly Indicator[]; readonly age: string; readonly tooltip: readonly string[]; readonly context: TrunkContext; }
  export interface WorkingTreeViewRow { readonly kind: 'workingTree'; readonly parent: string; readonly lane: number; readonly node: 'dashed'; readonly indicators: readonly Indicator[]; readonly age: 'now'; readonly tooltip: readonly string[]; readonly context: WorkingTreeContext; }
  export interface ElidedViewRow { readonly kind: 'elided'; readonly lane: 0; }
  export type PrState = 'open' | 'draft' | 'merged' | 'closed' | 'unknown';
  export type Indicator =                                                 // a row's list is built in this order, never sorted
    | { kind: 'untracked' } | { kind: 'needsRestack' } | { kind: 'unresolved'; count: number }
    | { kind: 'baseDrift'; prBase: string; localParent: string } | { kind: 'needsPush'; ahead: number } | { kind: 'neverPushed' }
    | { kind: 'pr'; id: string; url: string; state: PrState; reviewDecision: ReviewDecision | null; title: string | null }
    | { kind: 'checks'; failing: number; total: number }
    | { kind: 'behindTrunk'; origin: number; local: number }              // the trunk row's
    | { kind: 'dirty'; files: number };                                   // the working-tree row's
  export interface LayerContext { webviewSection: 'layer'; repo: string; layer: string; isCurrent: boolean; isTracked: boolean; isUntracked: boolean; isTrunkLine: boolean; hasPR: boolean; isDraft: boolean; }
  export interface TrunkContext { webviewSection: 'trunk'; repo: string; trunk: string; isCurrent: boolean; }
  export interface WorkingTreeContext { webviewSection: 'workingTree'; repo: string; layer: string; }
  export type MessageKind = 'noTrunk' | 'rebaseInProgress' | 'detachedHead' | 'notOnStack';
  export interface MessageRow { kind: MessageKind; text: string; severity: 'warning' | 'information'; }
  ```
  What changed from the sketch and why: `id: string` not `number` — git-spice spells a GitLab change `!12`; `state` gains
  `unknown` — the local tier has no `change.status` until M7's `--cr-status`; `reviewDecision` and `title` are `null` until
  M7; `messages: MessageRow[]` not `message?` — E3 and E5 can co-occur; four row interfaces, not one with sentinels — the
  elided row is `{ kind, lane }` and nothing else; `kind` keeps 23a's four and `node` 23a's three — the `trunkCommit`/`diamond`
  rows are 23i's own row kind, added when that renderer exists (the `switch` in `viewRowFor` stops compiling until it has a
  case); `subject` and `files` wait for 23i and 23g, which have the sources; `sha`, `parent`, `parentSha`, `forks` ride along
  for the host (23g's diff, 23i's range); `dim`, `tooltip`, `context` added so the renderers derive nothing. Ages: under a
  minute (or a date in the future) `now`; minutes under an hour; hours under 48; days under a week; weeks under a mean month
  (30.4375 days); months under 365 days (so `12mo` never prints); years.
- **Protocol** (`src/webview/protocol.ts`): host → view `{ type: "model", seq, model }` on every refresh
  and whenever the view becomes visible; view → host `{ type: "command", seq, command: "prCascade.<id>",
  args }` for everything a click does — the webview has no logic of its own and every action is a registered
  command. A message whose `seq` is older than the last model sent is dropped (E79). *As built (M6 item 23b, D68):*
  `ModelMessage { type: 'model'; seq; repos: StackViewModel[]; activeRepo: string | null; notices: HostNotice[] }` — an
  array, one per repository in workspace order, so the pending multi-repo arrangement (`docs/pending-decisions.md` item 5)
  needs no second shape and one repository is an array of one; `notices` carries the rows that belong to no repository
  (§6, §7.14.3) or to one whose load failed (E17), texts the host's; `CommandMessage { type: 'command'; seq; command:
  CommandId; args: string[] }` with `CommandId = `prCascade.${string}`` and the repository root as every command's first
  argument; `MoveOntoMessage { type: 'moveOnto'; seq; repo; layer; target }` for E77, `target` the row's `name`;
  `HostMessage` / `ViewMessage` the two unions, which 23g grows. Types only, `import type` from core — no runtime value, so no
  bundle carries the file; the `seq` and prefix rules are the host's to enforce (23d). *As built, the view half (M6 item
  23c, D69):* `src/webview/host.ts`'s `connect()` stamps every command with the `seq` of the last model it delivered, 0
  before any, and passes on only a message from the page's own origin that is a `model` with a numeric `seq` and a
  `repos` array — the rest in silence, since VS Code relays nothing but the host's own posts into a webview's window,
  and relays them with the content frame's own origin. The `seq` moves before the
  renderer's handler runs: a renderer that draws inside the handler acts on the model it shows; one that defers drawing
  accepts a one-frame window in which a click on the old picture carries the new `seq`.
- **Theme** from `--vscode-*` variables only (the rail uses `--vscode-tree-indentGuidesStroke`, state
  colours the `--vscode-gitDecoration-*` and `--vscode-charts-*` sets); icons from `@vscode/codicons` copied
  into `dist/webview/`; `retainContextWhenHidden` **off** — the model is small and re-sent on visibility. *As built (M6
  item 23c, D69):* `dist/webview/codicon.css` (its `@font-face` names `./codicon.ttf?<hash>`, so the pair sits in one
  directory) and `codicon.ttf`, 188 KB of files (+83 KB in the `.vsix`), copied by `esbuild.mjs` after the builds, never
  imported — bundle delta 0; attribution in `THIRD-PARTY-NOTICES.md`, because the icons are CC-BY-4.0, admitted by §11.3's
  asset clause (Ric, 2026-10-16). `font-src ${cspSource}` is expected to admit the font the
  stylesheet names by a relative URL (VS Code's `cspSource` is `'self' https://*.vscode-cdn.net` and resources are
  served from a `*.vscode-resource.vscode-cdn.net` host at 1.85.0); 23d's extension-host run verifies it.
- **Security:** CSP `default-src 'none'; style-src ${cspSource} 'nonce-…'; script-src 'nonce-…'; font-src
  ${cspSource}`; one HTML template, all data arrives by message, nothing is interpolated into markup.
- **Accepted costs of leaving `TreeItem`:** file rows cannot use the user's file-icon theme (codicons
  instead) and get no `resourceUri` decorations; keyboard navigation, focus outline and screen-reader roles
  are ours to implement (rows are `role="row"` with `aria-selected`; the view declares
  `accessibilityHelpContent`); no `viewsWelcome`, no built-in tree filter; two more bundles to build and a
  browser test layer (§9.1). Kept from the native tree: `view/title` menus, the `<viewId>.focus` command the
  status bar uses, dragging the view between containers, native `webview/context` menus.
- **Both views are user-movable:** VS Code lets a user drag either view into any container and remembers
  it; the contributed containers are defaults, not constraints.

### 7.2 Commands and menus

The "Where" column is the primary placement; §7.2.1 is the authoritative menu layout and wins on
any conflict.

| Command id | Title | Where | Behavior |
|---|---|---|---|
| `prCascade.refresh` | Refresh Stack | view title | Recompute everything. |
| `prCascade.openDiff` | Open Changes | file node click | `vscode.diff(left, right, "<basename> (<parent> → <branch>)")`. Binary → open the file at `branch` instead. |
| `prCascade.createPR` | Create Pull Request | inline on branch node | §7.7 algorithm restricted to this one layer (still pushes it and verifies its parent exists on the remote). |
| `prCascade.createStackPRs` | Create PRs for Stack | view title `$(git-pull-request-create)` | §7.7: push all → create every missing PR bottom→top → re-assert bases → `gh stack link` on GitHub → refresh. Progress in `window.withProgress`, cancellable between steps. |
| `prCascade.pushStack` | Push Whole Stack | `…` › Stack `2_stack@1`; Command Palette | backend `push` = `gs stack submit --no-publish` (force-with-lease semantics). Disabled when rebase in progress. *As built (M5 item 21b, D62):* the stack of one repository (picked when several), re-loaded fresh; `null` layers tracked first (E56); refuses with a sentence during a paused rebase (E12), on a detached HEAD, when `enrich` could not serve (the setup command named), when a layer is behind its remote copy (E76 — core's sentence) and when a layer needs a restack (core's sentence, naming `gs stack restack`); "Pushed N branches with git-spice in <folder>." — with " — git-spice also left notes in the Output panel" when it said more than `Pushed` — or core's sentence; git-spice's other lines in the Output panel; one refresh (E83); `enablement: !prCascade.rebaseInProgress`; a second click while one runs is answered, not run; **not gated on the readiness flow** — `--no-publish` consults neither forge nor login (verified), so a forge-less repository pushes (D62); returns the `PushResult`. |
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
| `prCascade.setUpGitSpice` | Set Up git-spice | Command Palette only (no menu entry) | M5 item 19b (D58): the §7.13.1 offers for one repository (the only one, or picked) one fix at a time, ending in "git-spice <version> is ready for <repo> (<host>)."; returns the flow's outcome. |
| `prCascade.trackStack` | Track Stack with git-spice | `…` › Stack `2_stack@8`, when `prCascade.hasUntracked`; Command Palette | M5 item 20b (D60): the layers shown as `not tracked` in one repository (picked when several), re-loaded fresh, `gs branch track` bottom→top, one refresh (E83), "Tracked N branches with git-spice in <folder>." — or core's sentence when git-spice refused; not gated on the readiness flow (a local operation); refuses during a paused rebase with the E12 sentence; returns the `TrackResult`. |
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
   Push Whole Stack                     2_stack@1   (as built, item 21b, D62: `when: view == prCascade`,
                                                     `enablement: !prCascade.rebaseInProgress`)
   Restack onto Trunk                   2_stack@2   (M9)
   Restack After Merge…                 2_stack@3   (M9)
   Sync After Amend                     2_stack@4   (M9)
   Move Layer and Above Onto…           2_stack@5   (M9)
   Sync Stack                           2_stack@6   (M9)
   Merge Bottom PR…                     2_stack@7   (M9)
   Track Stack with git-spice           2_stack@8   (only when untracked layers exist — as built, item 20b, D60:
                                                     `when: view == prCascade && prCascade.hasUntracked`, a context key
                                                     set with `setContext` after every load, as §7.11's `hasStack`)
── 3_view ──────────────────────────────────────────
   Show Only This Stack       (toggle)  3_view@1   (M6: a view-model filter; the views draw every stack by default; as
                                                     built, M6 item 23a, D67: the filter is `layoutGraph`'s `onlyStackOf`
                                                     option — decided by the view model, applied before lanes are
                                                     assigned, because a filtered row list has stale lanes — and means
                                                     git-spice's stack, the layers below the branch and every layer above it;
                                                     23b (D68): `ViewModelInput.showOnlyThisStack` passes `onlyStackOf:
                                                     state.head` while HEAD is on a stack — HEAD's stack, the status bar's;
                                                     on trunk or detached every stack is drawn (a paused `git am` keeps
                                                     HEAD's branch and the filter); the focused row's
                                                     would be one field becoming a branch name — 23a's question 3)
   Collapse All                         3_view@2
── 9_settings ──────────────────────────────────────
   PR Cascade Settings…                 9_settings@1   → opens Settings filtered to `prCascade.`
```
Every `…` item that mutates state is disabled (`enablement`) while a rebase is in progress, and
`Create PRs…` / `Push` are disabled when `gs`/remote is unavailable — and on GitHub repos also when `gh` + gh-stack are missing (E62b) — with the reason in the tooltip.
*As built (item 21b, D62):* the key `prCascade.rebaseInProgress` (any loaded repository paused) is set beside
`hasUntracked` after every load — both names in `src/vscode/contextKeys.ts`, which the manifest test compares against;
Push Whole Stack **and Track Stack** carry `enablement: !prCascade.rebaseInProgress` (D60 deferred Track Stack's to this
item) and still refuse after their fresh load — `enablement` greys menus and keybindings but does not stop
`executeCommand` (VS Code's manifest reference), so the sentence is the behaviour. "The reason in the tooltip" is not
available for a `view/title` entry; the E12 row above the layers is the reason. "`Push` disabled when `gs`/remote is
unavailable" is a sentence from the command instead: the push itself discovers an unreachable remote in one
`ls-remote` and quotes git's line (D61).
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
   Insert Branch Below…         (M9)
   Move Layer and Above Onto…   (M9)
── 2_copy ──────────────────────────────────────────
   Copy Branch Name
   Copy PR URL                  (has PR)
   Open Compare on Forge        GitHub: <host>/<owner>/<repo>/compare/<parent>...<branch>
                                GitLab: <host>/<owner>/<repo>/-/compare/<parent>...<branch>
```
Pending-insert node: `contextValue = stackPendingInsert`, inline `Finish Insert` + `Cancel Insert`.

**Drag and drop (M9, added 2026-09-20 at Ric's request — the gesture Graphite and VisualJJ offer):**
HTML5 drag and drop inside the two webviews (§7.1.1; amended the same day when the views were decided —
a `TreeDragAndDropController` would only serve the native tree, which is gone by M9). Only **layer
rows** can be dragged; a layer can be dropped on another **layer row** or on the **trunk row**. A drop
posts `{ type: "moveOnto", layer, target }` to the host (§7.1.3 protocol), which
means `prCascade.moveOnto(L = dragged, B = target)`, i.e. `gs branch onto <B> --branch <L> --restack
upstack` (§7.12), **after** a confirmation `Move <L> and the N layer(s) above it onto <B>?` — a rebase
that can pause on conflicts must not fire on an accidental drop. Refusals, checked before the confirm:
B is L or a descendant of L (E53, cycle); rebase in progress (E12); dirty working tree; L and B in
different repositories. File rows, message rows and the pending-insert row are neither draggable nor
drop targets. Nothing else changes: the picker command stays for keyboard users.

Layer `contextValue` vocabulary: `stackBranch`, `stackBranchWithPR`, `stackBranchWithDraftPR`, with
`Current` appended when HEAD is on it (e.g. `stackBranchWithPRCurrent`) so "Check Out" hides on the
current layer. Tests assert the exact `contextValue` for each state (it's what drives every menu).
`stackBranchWithPR` is drawn from item 20b (a `change` on the layer's `gs log` line, D60); `stackBranchWithDraftPR`
from M7 (gh's `isDraft`).

**File node — right-click:** `Open Changes` (default click), `Open File`, `Open File at Parent`,
`Copy Path`.

**Status bar item click:** focus the view (no menu).

Additional commands introduced by this layout: `prCascade.copyBranchName`, `prCascade.copyPRUrl`,
`prCascade.openCompare`, `prCascade.collapseAll`, `prCascade.openSettings`, `prCascade.openFile`,
`prCascade.openFileAtParent`, `prCascade.toggleAllStacks` (M6). All trivial; each gets one test that
it is registered and does the obvious thing with a fake runner/env.

### 7.3 Settings

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `prCascade.trunk` | string | `""` | Trunk ref; empty = auto-detect (§5). |
| `prCascade.gitPath` | string | `""` | Executable path override. Empty (the default from M4) = the executable the built-in Git extension found — `api.git.path`, which honours the user's `git.path` — so both extensions run the same git. A non-empty value wins. M1–M3 default was `"git"`. |
| `prCascade.ghPath` | string | `"gh"` | Executable path override. As built (item 23a, D65): the backend's fourth constructor argument, default `""` = `gh` from VS Code's PATH, a set value the only one tried — `gsPath`'s rule (D56's "empty = auto"); the manifest entry landed with item 23b (D66). |
| `prCascade.remote` | string | `"origin"` | Remote passed to gs (`--remote`) and used for host/forge detection. |
| `prCascade.prDescriptionMode` | `"edit"` \| `"auto"` | `"edit"` | §7.7: open the plan document, or create straight from generated drafts. |
| `prCascade.prDraft` | boolean | `false` | Seeds the `Draft:` line per section (§7.9); applies to all in `auto` mode. |
| `prCascade.prTitleFrom` | `"first-commit"` \| `"last-commit"` \| `"branch-name"` | `"first-commit"` | §7.9 draft titles. |
| `prCascade.prTemplate` | string | `""` | Path override for the PR/MR template (§7.9.1); empty = discovery. |
| `prCascade.backend` | `"git-spice"` | `"git-spice"` | Reserved for future backends; only value today. |
| `prCascade.gsPath` | string | `""` | git-spice executable. Empty (the default from M5 item 18, D56) = try `git-spice` — the program's name since v0.24, and the only one official packages ship since v0.25 — then `gs`, the old name a `go install` build still has (on a Homebrew Mac `gs` is Ghostscript, §13.1), the first that answers `--version` as git-spice; a non-empty value is the only one tried. Was `"gs"` until item 18; the manifest entry landed with item 19b. |
| `prCascade.mergeMethod` | `"repo"` \| `"squash"` \| `"merge"` \| `"rebase"` | `"repo"` | For Merge Bottom PR (`gs branch merge --method`). |
| `prCascade.nativeStackLink` | `"auto"` \| `"never"` | `"auto"` | §7.13.4; on for GitHub repos. |
| `prCascade.navComment` | `"auto"` \| `"always"` \| `"never"` | `"auto"` | git-spice navigation comment on each CR. `auto` = off on GitHub and GitLab (both have native views), on elsewhere. Passed as `--nav-comment`. |
| `prCascade.statusBar` | boolean | `true` | Show the `<branch> · n of N` status bar item. |
| `prCascade.gitProtocol` | `""` \| `"https"` \| `"ssh"` | `""` | Passed to `gh auth login --git-protocol` in the login flow when it names a protocol; empty passes no flag and gh asks once. As built (item 23b, D66): an `enum` in the manifest, passed always with `"https"` the default — then, on Ric's answer (2026-10-16), the empty value as the default. |

Removed in M4 (item 12a; decided 2026-09-20, recorded 2026-09-26): `prCascade.repositoryScanMaxDepth`
(number, default `1`) and `prCascade.repositoryScanIgnoredFolders` (string[], default `["node_modules"]`),
both added by M1 PR 8 as mirrors of the built-in Git extension's settings. From M4 the Git extension's own
`git.autoRepositoryDetection`, `git.repositoryScanMaxDepth` and `git.repositoryScanIgnoredFolders` decide
which repositories exist (§6, §7.14.2), so there is nothing left for the mirrors to configure.

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
`parseRemoteUrl` must handle all of: `git@github.com:org/repo.git`, `github.com:org/repo.git`,
`ssh://git@ghes.corp.com:2222/org/repo.git`, `https://github.com/org/repo`,
`https://user@ghes.corp.com/org/repo.git`, trailing-slash and no-`.git` variants. Returns `{ host, owner, repo }`
or `null` (no remote / unparseable → PR features disabled with a clear node, everything else still works).
*As built (M5 item 16, D54):* `host` is the hostname exactly as the remote spells it — no user, and no port,
which is kept apart as `port` (git-spice compares it when a configured URL names one; GH_HOST wants a
hostname, and gh lower-cases it itself); the spelling is kept because git-spice compares hosts as text; `owner`
is the whole path between host and repository (`group/sub` on GitLab; Azure's raw path until M11); a local path
and any `file:` URL are `null`. The composed reader `detectForge(git,
root, remote)` tells no-remote (E25) from unparseable (E21) from a forge of unknown or unrecognised kind
(E60/E70) — the tagged union `ForgeDetection`, whose `forge` member also carries the `ForgeConfig` that decided
the kind, so item 17's `Readiness` can say *why* git-spice will not match (a rejected `spice.forge.kind`, a url key
that displaced a default). `git remote get-url` has already applied `url.<base>.insteadOf`.

**Invoking `gh`:** always `cwd = repo root` and `env.GH_HOST = host`. `gh` would usually infer the host
from the remote on its own, but setting `GH_HOST` makes multi-remote repos deterministic.
*As built (item 23a, D65): cwd = root and `GH_HOST` on every call, plus `--hostname <host>` on `auth status`, the same
host in both — gh matches the flag against its host list without normalising it, and `GH_HOST` is what puts a host gh
has no account for on that list (`--hostname ssh.github.com` alone reads "not logged in" while github.com is; with
`GH_HOST=ssh.github.com` beside it, logged in — measured); without the flag `GH_HOST` makes gh report every host; the
host lower-cased in both (gh folds neither); and `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`,
`GH_NO_EXTENSION_UPDATE_NOTIFIER=1`, `NO_COLOR=1`, `GH_TELEMETRY=false` (core/ghstatus.ts `GH_ENV`; without the last
every gh call writes a telemetry device id under the user's state directory — measured).*

**Auth preflight (M5+, cached per refresh):** `gh auth status --hostname <host>` — exit 0 means
authenticated. Non-zero → layer descriptions show `(gh: not logged in)`, and any `gh`-backed action
triggers the **login flow** below instead of failing. `gh` missing entirely → one informational node
with the install hint (`brew install gh`). Never block the tree view on `gh` state; M1–M4 must not
touch `gh` at all.
*As built (M5 item 23a, D65):* the preflight is step 5 of the readiness probe (§7.13.1), GitHub only, asked after gh and
gh-stack are found: `gh auth status --hostname <host lower-cased>` under `GH_HOST=<host>` — exit 0 is logged in and
nothing else is read, so a revoked token and no network read as "not logged in" (the offer's sentence is the plain one).
It is a network call even for a host with no account: `GH_HOST` puts the host on gh's list and gh validates what it then
finds for it — the OS keyring's entry, else an empty default token (exit 1, ~0.25 s; measured 2.102.0) — one bounded call
per probe. Of this paragraph's three promises none is built: "cached per refresh" and the `(gh: not logged in)` layer
description, because readiness is asked only by the setup command and, from M7, the gated actions — never on a refresh —
and M7's status tiers (§7.8) own the layer description; the informational node for a missing gh, because the setup
command's notification is the one surface for that sentence until then, and a node would be a second.

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

*As built (M5 item 19a, D57):* step 3's poll is `core/poll.ts`'s `waitUntil(check, {intervalMs, timeoutMs},
signal?)`, shared by both tools — the check is the readiness probe for git-spice (item 19b) and `gh auth status`
for gh (item 23). Time is counted in intervals waited, never read from the clock; the first question waits one
interval; an abort cuts a sleep short but lets a question already asked finish; a rejecting check rejects, and so
does an interval that is not a positive, finite number (it would ask without pause). The
offer texts drop the `PR Cascade:` prefix (VS Code names the extension on every notification) and the `Cancel`
button (closing the notification says the same), §7.13.1's offers included.
*As built for git-spice (M5 item 19b, D58, `vscode/login.ts`):* steps 1–4 as written, with five differences. One
fix in flight per **repository**, not per host — a repository owns a terminal and a directory, and a login done in
one repository's terminal is seen by every other on the host anyway (one keychain); the repository is claimed at the
**click**, never while a notification is open, so one left unanswered in the notification centre blocks nothing.
The terminal is `PR Cascade: <folder>` at the repository root, reused for the next step while its shell lives
(not after a wait in it timed out — it may still sit in that prompt), and each line starts `cd <root> &&`. The flow
looks again at the click, before running anything: a notification can be answered long after it was shown. Closing
the terminal stops the wait, after one last look. And on success the view refreshes (E83) before the done line; on
timeout or close the give-up is silent but for one Output line.
*As built for gh (M5 item 23a, D65):* one more member of the same flow, not a second flow — step 5 of the probe answers
`gh-not-logged-in` (and `gh-missing`) as `Readiness` members with a number each in `progressOf`, so the wait after a
git-spice login passes when the probe reaches them. In 23a the member's offer is a sentence naming `gh auth login
--hostname <host lower-cased> --web`, with no button; the terminal line is item 23b's (it needs `prCascade.gitProtocol`).
*As built (item 23b, D66):* the line is `env -u GH_TOKEN -u GITHUB_TOKEN <gh> auth login --hostname <host lower-cased>
--web --git-protocol <prCascade.gitProtocol>` (`GH_ENTERPRISE_TOKEN`/`GITHUB_ENTERPRISE_TOKEN` for a host that is not
github.com, *.github.com or *.ghe.com): gh refuses `auth login` while the pair for the host's class is set (measured
2.102.0) — E67's rule for gh. The poll is the readiness probe, whose step 5 is the check (D57); the done line is `gh is
logged in to <host>.`, because "Logged in to <host>." is git-spice's (D58) and a GitHub flow can show both in one run;
the terminal is `PR Cascade: <folder>` (D58), not "stack: gh login". Steps 1, 3 and 4 as D58 built them.

`prCascade.gitProtocol` setting: `"https" | "ssh"`, default `"https"` (fewest prompts; `gh` then
*Decided 2026-10-16 (Ric, D66): a third value, empty, that omits the flag and lets gh ask once, as the default — a
re-login must not move an `ssh` host to `https`.*
offers to act as the git credential helper). Add to §7.3. *As built (item 23b, D66): in package.json (an `enum`) and
config.ts, read when the setup command runs — like the remote and the trunk — and carried on `ReadyRequest` for the
whole flow (the probe's `prCascade.ghPath` alone is read afresh, through `probeFor`); the line carries it always — it sets gh's own protocol for
the host (its clones, its credential helper), nothing of PR Cascade's pushes, which go to the remote's URL as it is; gh
applies it to every account on the host, so a re-login with the default would move an `ssh` host to `https`.*

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

**Native stacked PRs on GitHub hosts:** the required `gh stack link` step, §7.13.4 (M7).

### 7.6 Forge detection and `gs auth` (all forges)

**Forge kind + host (`core/forge.ts`, pure over the remote URL):** `github` (github.com, `*.ghe.com`,
any host with `spice.forge.github.url` set), `gitlab`, `bitbucket` (one kind in v1; cloud vs DC is
`host === 'bitbucket.org'`, unread before M11), `gitea` (self-hosted only: git-spice 0.31.2 has no default
gitea host — `spice.forge.gitea.url`), `forgejo` (codeberg.org default), `azuredevops` (the extension's
classification for E75 only — git-spice 0.31.2 has no Azure forge; its ids are `bitbucket, forgejo, gitea,
github, gitlab`), or `unknown`. git-spice detects the forge itself from the same URL; the extension's copy
exists for messaging, auth guidance, and the native-link decision, and it mirrors git-spice's matching rules
(every one verified with 0.31.2, M5 item 16; `gitSpiceMatches` in core/forge.ts): a `spice.forge.kind` git-spice
rejects (anything but `bitbucket, forgejo, gitea, github, gitlab`, case-sensitively) stops it resolving *any*
forge; a valid one wins outright, even over github.com (its answer for ssh aliases), except that a remote must still
match that kind's own url key when one is set (`unsupported URL: … does not match configured forge URL`); otherwise each of its five
forges has one base host — the `spice.forge.<kind>.url` when set, **else** its default (github.com, gitlab.com,
bitbucket.org, codeberg.org; gitea has none), so a url key *replaces* that kind's default and a github.com
remote beside a company GHES url is "no forge found" — and the remote matches a forge when its host is that
base or a subdomain of it (`ssh.github.com`, `ghes.corp.com` under `corp.com`; not a bare suffix), spelled the
same (`GitHub.com` is no match), with the same port when the base names one; a url value that is not a URL
still displaces the default and matches nothing. git-spice walks its forges in
unspecified order, so where two match (two url keys on one host, a url key naming another forge's default) its
pick is random; the extension takes the first in id order and the host counts as recognised either way.
`*.ghe.com` → github is the extension's own guess — git-spice matches it only once `spice.forge.github.url`
names the host, spelled as the remote spells it, which is E70's offer; `Forge.recognizedByGitSpice` records
the difference. The overrides are read once per detection with `git config --get-regexp '^spice\.forge\.'`
(exit 1 and no output when none is set); the `GITHUB_URL`/… and `GIT_SPICE_FORGE_KIND` environment variables
git-spice also honours are not read (item 18 decides).
Non-standard hosts: the user sets `spice.forge.<kind>.url` (README documents it; the extension offers
to run `git config spice.forge.github.url https://<host>` when it sees a GitHub-looking host that `gs`
didn't recognize — E70).

**Auth state:** `gs auth status` (exit 0 = logged in for this repo's forge). Not logged in → any forge
action shows `"<name>: not logged in to <forge host>" [Log in] [Cancel]`; "Log in" opens a terminal
running `gs auth login`. `gs` prompts for the method; the README says what to pick:
| Forge | Pick (v1 supports GitHub and GitLab; the other rows are for M11) |
|---|---|
| GitHub (incl. `*.ghe.com`, Enterprise) | **GitHub CLI** if `gh` is logged in to that host (no PAT), else **OAuth** (device flow in the browser). Never PAT at work. |
| GitLab.com | OAuth. Self-hosted: `glab` token or PAT (OAuth needs an admin-registered app). |
| Bitbucket Cloud | Git Credential Manager (OAuth) or API token. |
| Bitbucket DC, Gitea, Forgejo | API token (only option). |
| Azure DevOps | Not a git-spice 0.31.2 forge (§13.4 2026-10-01 (d)); when M11 adds it: Azure CLI or PAT. |
The extension polls `gs auth status` every 3 s for up to 5 min after opening the terminal, then
refreshes and re-runs the pending action (same shape as §7.5's `gh` flow). Tokens live in the OS
keychain; the extension never reads them.

**Repo initialization:** the readiness probe (§7.13.1) detects an uninitialized repository and offers
`gs repo init --trunk <trunk> --remote <remote>` (terminal, so any prompt is visible). Trunk comes from §5
detection. *Corrected 2026-10-01 (measured while designing items 16–17, for item 18 — §13.4):* this used to say
`gs log short --json` fails until `gs repo init` has run; with git-spice 0.31.2 it is **not a check at all**:
with one remote or none it **initializes the repository itself** (stderr `INF Repository not initialized.
Initializing.` … `INF Initialized repository trunk=main`, exit 0, `refs/spice/data` created); with two or more
remotes under `--no-prompt` — or any non-tty stdin — it exits 1 (`auto-initialize: guess upstream remote: prompt
for remote: not allowed to prompt for input`) and initializes nothing, whatever `branch.<trunk>.remote` or
`spice.remote` say. Either way the probe must never run `gs log` as its initialization check; item 18 picks a side-effect-free check (the `refs/spice/data` ref's
*existence*, through `git rev-parse --verify`, is one — reading the ref's *contents* stays forbidden, §3).
*Corrected again 2026-10-08 (item 20a, D59):* re-measured with 0.31.2 under a hermetic HOME, `gs log short --all --json`
on an uninitialised repository with one remote — `origin/HEAD` set or not, HEAD on trunk or on a layer, `--no-prompt`
or a closed stdin — no longer initialises anything: `INF Repository not initialized. Initializing.` / `INF Using remote:
origin` / `FTL … auto-initialize: guess trunk: prompt for trunk branch: not allowed to prompt for input`, exit 1, no
`refs/spice/data`; `gs branch track` on such a repository does the same. The 2026-10-01 exit 0 could not be reproduced.
The rule is unchanged — `gs log` is never the initialised check and never runs before it (`enrich` reads the
`refs/spice/data` line off the §7.14.2 digest, `track` asks `rev-parse --verify`) — because either behaviour is wrong
for us: a silent init, or an FTL for an answer.

### 7.7 "Create PRs for Stack" algorithm (M7)

Inputs: `RepoState` (layers bottom→top), forge/host, CR status map from §7.8.
```
preflight:  rebase in progress → abort with message
            gs not ready (missing / not initialized / not logged in) → readiness flow (§7.13.1, §7.6),
              then continue automatically
              (push alone, as built in item 21b, D62: the flow is not run — --no-publish needs neither
              forge nor login; not initialised / git-spice missing or old is a sentence naming the setup
              command, as Track Stack's is; the flow runs here for the CR steps, which do need it)
            untracked layers → gs branch track --base <parent> for each, bottom→top (§7.13.3)
            any layer with commitCount == 0 vs its parent → skip it, warn
1. push     gs stack submit --no-publish          (pushes every tracked branch; no CRs created)
              (item 21a, D61: refuses first — not initialised, a layer behind its remote copy (E76),
              git-spice missing/old, a layer needing a restack — then --no-publish --no-update-only)
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

### 7.8 CR status per layer (M7, read-only)

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

*As built (item 20a, D59; the rows themselves are item 20b's):* the local tier is `gs log short --all --json` — `--all`
for every tracked branch whatever HEAD is on; without it a tracked HEAD prints only its own stack, so "absent = untracked"
above held only by accident — run only when the §7.14.2 digest changed and only on an initialised repository (§7.6).
A layer's line is `StackLayer.tracking`: absent = no information (not enriched, or unlisted by an answer with a malformed
line, which names no branch); `null` = untracked, i.e. absent from a *complete* answer; an entry = tracked; git-spice's
trunk line, which a local trunk ahead of its remote-tracking ref receives, has no `down`. `RepoState.enrichment` says
how it went (`enriched { ranGsLog, malformed }` / `not-enriched { cause, reason }`), for the Output channel; a failure
degrades to the rows as built with the reason there, never a row. *Item 20b (D60):* the description reads
`<n commits>[ · <id>][ · needs restack][ · needs push][ · not tracked][ · current]` — the id as git-spice spells it
(`open` / `unresolved` wait for M7's network tier), the to-dos in the order to do them, the exclusive state, `current`
last as before (§7.1.0); nothing added for a clean tracked layer or for git-spice's trunk line; `contextValue`
`stackBranchWithPR` when a `change` exists; the tooltip's third line `git-spice: tracked on <base>[ · needs restack][ ·
needs push]` / `git-spice: not tracked` / `git-spice: trunk`, then `<id> <url>` — the base as git-spice names it (the
trunk's local name for the bottom layer, beside line 2's `origin/main`: two spellings, not drift) and the to-dos again,
since a narrow side bar elides a long description from the right; one Output line per repository.

*As built (M6 item 23b, D68):* the consumer of both tiers is `core/viewmodel.ts`, for every stack — not only HEAD's.
`StackLayer.tracking` serves HEAD's layers; every row reads `Enrichment.enriched.byName` (the whole `--all` answer by
branch name) with the same three states: an entry → tracked; absent from a `complete` answer → `untracked` (E56); absent
from an incomplete one, or `not-enriched`, or no `enrichment` → unknown, no indicator at all, not even ⛅ (E57's degrade,
the tree's rule). The local tier's fields become indicators one to one: `down.needsRestack` → ⇈, `push.ahead > 0` →
`↑push.ahead` (`push.needsPush` is "the tips differ" and is also true strictly behind — measured, §13.4), `change` → the PR
circle with `change.status` or `unknown`, `change.comments.unresolved > 0` → 💬 (the field is kept by gsLog.ts from this
item); `push` is printed only for branches git-spice submitted (0.31.2), so ⛅ "never pushed" comes from the digest's
`refs/remotes` instead — `Enrichment.enriched.remoteBranches`, bare names from any remote. The `gh` extras (`isDraft`,
`checks`, `reviewDecision`, `title`, `baseRef` → ⇄ when it differs from git-spice's `down.name` — the base `gs branch
submit` would set, not the rail's `parent`, which differs for two names on one commit) have their fields from this item
and their values from M7, and are read only for a branch whose line carries a `change`.

### 7.9 PR descriptions: the editable plan document (M8)

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

### 7.10 Stack navigation on every CR (M7)

Both supported forges have a **native** stack view (GitHub: badge + popover + merge-box map, via
§7.13.4; GitLab: header dropdown, automatic). git-spice can additionally post a **navigation comment** on each CR showing the whole stack and the CR's position,
and keeps it in sync on every submit (`spice.submit.navigationComment=true`,
`spice.submit.navigationCommentSync`). It also remembers merged CRs and lists them for dependents.
It is **off by default on GitHub and GitLab** (`prCascade.navComment: auto`) to avoid duplicating the
native view; users can turn it on. The extension does not implement its own footer.
The command is `prCascade.refreshNavComments` (**Refresh Navigation Comments**) = `gs stack submit --update-only`.
On GitHub hosts with native stacks, the native stack map (via §7.13.4) sits alongside the comment.

### 7.12 Stack surgery: inserting a layer (M9)

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

### 7.13 The git-spice backend (M5–M9)

Source: https://github.com/abhinav/git-spice — `brew install git-spice` (also apt/scoop/binary/`go install`).
Facts verified 2026-09-17 from the docs (CLI reference, config, auth, limits, JSON, changelog v0.31.2):
- Global flags: `--[no-]prompt` (**always `--no-prompt` from the extension**), `-C <dir>` (**never from the
  extension**: 0.31.2 reads `spice.forge.*` from the directory it was started in, not from `<dir>` — a
  repository-local `spice.forge.github.url` is ignored under `-C` and honoured with `cwd` = the repository;
  verified 2026-10-01, §13.4), `-v`.
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
  documented — verify at implementation** *Verified (item 22b, D64): 0 and 1 only across every command measured — §12 item 7.* (contract test asserts whatever they are).
- Known limits: write access to the repo required; fork mode only submits trunk-based branches; some
  repos dismiss approvals on base change (repo setting); Bitbucket/Azure gaps for labels/assignees.
- Not provided: GitHub's native Stack object (§7.13.4 covers it).

#### 7.13.1 Readiness probe (`readiness(root, remote)`, memoized per root and remote, re-run on refresh after failure)
```
1. gs on PATH (or prCascade.gsPath) and its version ≥ 0.31              else "Install git-spice" offer
   (also try the `git-spice` name — §13.1; as built: `<exe> --no-prompt --version`, git-spice iff
   the banner starts `git-spice <token>`; floor 0.31.0 — D56)
   → terminal `brew install git-spice` (macOS) / link to install docs; decline remembered per workspace
2. repository initialized — a check with no side effects (item 18; **not** `gs log`, which on 0.31.2
   initializes an uninitialized repository itself with 0–1 remotes, or dies with "not allowed
   to prompt for input" with 2+ — §7.6, §13.4)                            else:
   → "Initialize git-spice for this repo?" → terminal `gs repo init --trunk <trunk> --remote <remote>`
3. forge from core/forge.ts `detectForge` (M5 item 16)                     else E25 (no remote) / E21 (unparseable URL) /
   is `github` or `gitlab` (v1) and recognised by git-spice (which       E60–E70 (unknown or unrecognised host: name the
   `Forge.recognizedByGitSpice` says — a rejected `spice.forge.kind`,     `spice.forge.*` key — or the rejected kind —
   a displaced default, a spelling git-spice will not match)             to set) / E75 (other forges: CR
                                                                          features disabled, tree works)
4. `gs auth status --forge <kind>` exit 0                                else login flow (§7.6)
   (forge before auth, and `--forge` given, because bare `gs auth status` exits 1 for "no remote set" and for
   "No Forge specified" before it ever reports login state — verified 0.31.2, 2026-10-01, §13.4)
5. on `github`: `gh` ≥ 2.90 + gh-stack extension present, then                else E62b's install offers / E23's login offer
   `gh auth status --hostname <host>` exit 0                                (as built, item 23a: the list had no gh login
                                                                            step; §7.5 and E23 want it)
```
Env for every `gs` call: `NO_COLOR=1`, `LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0` and, from item 21a (D61), `GIT_TERMINAL_PROMPT=0` (git's credential prompt opens the tty, not stdin). Setting `prCascade.gsPath`.
Every gh call (item 23a, GitHub only): `GH_HOST` lower-cased, `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`,
`GH_NO_EXTENSION_UPDATE_NOTIFIER=1`, `NO_COLOR=1`, `GH_TELEMETRY=false`; cwd = root; 15 s. Setting `prCascade.ghPath` (the
backend's fourth argument in 23a; the manifest entry landed with 23b, D66).
The answer is the `Readiness` union (`core/backend.ts`, §4.4): one member per failing step, first failure wins
(M5 item 17, D55). *As built (M5 item 18, D56, `core/backends/gitspice.ts`):* step 1 runs `<exe> --no-prompt
--version` for each candidate (`prCascade.gsPath` alone when set, else `git-spice` then `gs`) and takes it for
git-spice only when stdout starts `git-spice <token>` — identity by the program's own name, never by exit code:
Ghostscript's `gs --no-prompt --version` exits 0 and prints a bare `10.08.0`, so an exit code would take it for
git-spice, and
git-spice's `version` subcommand only exists since 0.12, so an old install would otherwise read as "missing"
rather than "too old"; `tried` lists every name asked. The token is read as `v?major.minor.patch` (a suffix
ignored — the floor is a feature floor), compared by hand against 0.31.0 (`semver` measured 27 KB, §11.3); a
token with no version (`dev`) is `gs-too-old` with the token as `found`. Step 2 is `git rev-parse --verify
--quiet refs/spice/data` (existence only — never `gs log`). Step 3 maps `detectForge`'s answer in
`core/backend.ts`'s order. Step 4 reads exit 0 of `auth status --forge <kind>` and nothing else. Step 5 (item 23a, D65,
`core/ghstatus.ts`) runs `gh --version` (identity by the banner `gh version X.Y.Z`, floor 2.90.0), `gh stack --version`
(present iff it prints `gh stack version X.Y.Z`; neither login nor network needed) and `gh auth status --hostname <host
lower-cased>` under `GH_HOST` (exit 0 = logged in, stderr unread; the one network call, for a host with no account too —
D65), in that order — the extension asked whatever gh's version, so `missing` names both when both are wrong, unasked when
gh itself did not answer; the login asked only once nothing is missing — GitHub only: a GitLab repository spawns no gh.
Every git-spice spawn: `--no-prompt` first, cwd = root, the env above, a 15 s timeout, stdin closed; the happy path is
exactly five commands on GitLab (two of git-spice, three of git) and eight on GitHub (the three of gh after them),
pinned by the tests; `ready.gh` records the gh found. `ready` is memoized per root and remote; a failing answer is never stored, so the
next refresh re-probes — which is what item 19's post-login poll relies on. The probe rejects only when git
itself cannot run (E17) or the root cannot be used as a directory.

*Offers (M5 item 19a, D57, `core/readinessFix.ts`):* `offerFor(member, facts)` returns the sentence, its severity
(`warning` when the user has something to do, `information` otherwise — D51's colours) and at most one button with
its command and the line shown once the step passed; no `Cancel`, no `PR Cascade:` prefix. Install: with
`prCascade.gsPath` set, only the setting was tried, so the sentence points at it and there is no button; when
Homebrew has a `git-spice` beside its `brew` and the probe still did not find one, VS Code's PATH does not reach
Homebrew's directory, and the sentence names the path to set (no button — installing again changes nothing);
otherwise `<brew> install git-spice` in a terminal, run by the full path of the `brew` found (item 19b looks in
Homebrew's three usual places), else the install page. Too old: `<brew> upgrade git-spice` only when the git-spice
that answered is Homebrew's — that path, or the bare `git-spice` while Homebrew has one; since v0.25 every official
package is named `git-spice`, so the name alone proves nothing — and the version was read; else the install page;
`dev` reads "could not be checked". Init: `command <gs> repo init --trunk <branch> --remote <remote>` (`command`
so an alias or shell function named like the program cannot take the line over — `alias gs='git stash'` exists in
some zsh setups) where `<branch>` is a **local** branch — 0.31.2 refuses `--trunk main` with only `origin/main`
present ("not a branch: main", verified 2026-10-06) and `--trunk origin/main` likewise — found by `trunkBranchFor`:
`git rev-parse --verify --quiet --symbolic-full-name --end-of-options <trunk>`, and for `refs/remotes/<r>/<b>` a
check that `refs/heads/<b>` exists; a remote-tracking trunk with no local branch (the sentence names `git branch <b>
<trunk>`, quoted for a shell), a trunk that names no single branch (tag, commit, ambiguous name) and no trunk at all
get a sentence and no button. Login: `env -u GITHUB_TOKEN <gs> auth login --forge github` (`GITLAB_TOKEN` for
GitLab) in a terminal — git-spice counts an environment token as a login and then refuses `auth login`,
`--refresh` included (verified for both forges). E70: `git config spice.forge.<kind>.url https://<host>` run with
git (no terminal), in the repository's own file, the host as the remote spells it and no port (a remote's port is
usually ssh's) — and `spice.forge.<kind>.apiUrl` beside it, under one button "Set GitHub URLs" (or GitLab). For
GitHub: `https://api.github.com` for github.com and its subdomains (whose url is then `https://github.com` — there
are no web pages at `ssh.github.com`), `https://api.<host>` for `*.ghe.com`, `https://<host>/api` otherwise (a
fallback: an Enterprise Server host is E60 until its url key names it). git-spice 0.31.2 sends every GitHub request
to `<apiUrl>/graphql`; with only the url set it uses `api.github.com` when the url is exactly `https://github.com`
and guesses `<url>/api` for any other (`internal/forge/github/forge.go`, `APIURL`, read 2026-10-08) — right for
Enterprise Server, wrong for `*.ghe.com` and for github.com spelled otherwise. For GitLab the API is the url itself,
git-spice's own default. For both, naming it keeps an `apiUrl` written for another host from applying. A rejected `spice.forge.kind`, E60, and an
explicit `spice.forge.kind` whose own url key the remote misses (often an ssh alias — no URL to offer) are sentences
only. gh (item 23b, D66): install — with `prCascade.ghPath` set, a sentence pointing at it; Homebrew's `gh` beside `brew`
that VS Code's PATH does not reach, a sentence naming it for the setting; else `<brew> install gh` in a terminal, else
gh's install page (`github.com/cli/cli#installation`); too old — `<brew> upgrade gh` for Homebrew's gh with a readable
version, else the page; gh-stack alone — `command <gh> extension install github/gh-stack` in a terminal (no login needed,
measured); not logged in — `env -u <pair> <gh> auth login --hostname <host lower-cased> --web --git-protocol
<prCascade.gitProtocol>`, the pair per host class (§7.5), done line `gh is logged in to <host>.`.

*The flow (M5 item 19b, D58, `vscode/login.ts`):* probe → the member's offer → on the click a look again (the step
may have been done meanwhile — and a second `gs repo init --trunk <other>` would quietly replace the trunk; when the
answer changed, the pass starts over) → the fix — a terminal line `cd <root> && …`, `git config` lines (no wait: the
next probe is the check), or a web page (one the user will not let VS Code open ends the fix) — then for a terminal
or a page a wait, asking the probe every 3 s for up to 5 min until it gets *further* than the member offered (a
probe timing out mid-login answers `gs-missing`, which is no login), or for an install until Homebrew's `git-spice`
appears beside its `brew`; stopped by the close of the fix's own terminal after one last look → refresh (E83) → the
done line → the next pass, until ready, when the action runs; at most ten passes. A notification with a button is
awaited; one without is shown and not awaited. The probe goes through `connectedGit` on every call, so
`prCascade.gitPath` and `prCascade.gsPath` are read afresh (the remote and the trunk are fixed when the flow
starts), and the window keeps one `GitSpiceBackend`, rebuilt when the git executable, `prCascade.gsPath` or (in a
test) the command runner changes; the by-hand command `forget`s the remembered `ready` before each probe. Where
Homebrew is (`brewPath`, `brewGitSpice`) is read from disk at each offer and in an install's wait. The first caller
is the Command Palette's "PR Cascade: Set Up git-spice" (§7.2); neither Track Stack (item 20b, D60) nor Push Whole Stack
(item 21b, D62) is gated on it — `--no-publish` never consults the forge or the keychain (measured, item 21a, D61) — so the
first gated action is M7's `createPRs`. gh (item 23b): `gh-missing`'s three offers and the login's line through the same
flow. `gh-missing` holds three steps — gh not found, gh too old, then its extension — so after `brew install gh` the
probe's `gh-missing` with a version, or with only `gh-stack` listed, counts as further, and the look-again at the click
compares the step too; an install's wait also ends on Homebrew's `gh` beside `brew` when gh itself was missing (`brewGh`,
read from disk as `brewGitSpice` is); `prCascade.ghPath` is read afresh with the other two and the backend rebuilt on it. Counted
as the chain has always been counted — an install and an upgrade of each tool — the longest is ten passes, the limit
itself (the loop acts on its last pass); no real chain has both for one tool, so eight is the most a user meets.

#### 7.13.2 `gs log --json` schema (documented; no stability guarantee stated, so parse defensively)
One JSON object per line, one per **tracked** branch **plus the trunk**, which has `ups` and no `down` (0.31.2,
verified 2026-10-01); the lines are sorted by branch name, trunk among them — not stack order (verified 0.31.2 and
0.32.0, item 22b), and production maps them by name (D59). `INF`/`WRN` lines go to stderr, never stdout:
```
name: string            current?: true          worktree?: string
down?: { name: string, needsRestack?: boolean }        // branch below
ups?:  [{ name: string }]                              // branches above
change?: { id: "#123"|"!123", url: string, status?: "open"|"closed"|"merged",
           comments?: { resolved, unresolved, total } }   // status/comments only with --cr-status
push?:  { ahead: number, behind: number, needsPush?: boolean }
commits?: [{ sha, subject }]                           // gs log long only
```
`core/gsLog.ts` parses the stream, tolerates unknown fields, isolates a malformed line (E57). *As built (M5
item 17, D55):* it keeps `name`, `down {name, needsRestack}`, `change {id, url, status?}` and `push {ahead, behind,
needsPush}` — the fields `enrich` reads — and drops `current`, `worktree`, `ups`, `commits` and `change.comments`
alike until something reads them; absent booleans become `false`; `status` stays a string (a value a later
git-spice adds must not make the line malformed); a documented field present with the wrong type makes its
whole line malformed, reported once as `{ line, problem }` with the 1-based line and a path-naming problem
(`push.ahead is not a number`); the result is `{ entries, malformed }` and the function never throws. *As built (M6 item
23b, D68):* `change.comments?: { resolved, unresolved, total }` is kept — the `unresolved` indicator's source field — with
the same rule as every field (present with a wrong type → the line is malformed, `change.comments.unresolved is not a
number`; absent stays absent), so the parser's surface widened by one object whose only producer is `--cr-status`;
`current`, `worktree`, `ups` and `commits` are still dropped.

#### 7.13.3 Operation mapping (`StackBackend` → gs)
| Method | Command(s) | Sink |
|---|---|---|
| `track(layers)` | for each detected-but-untracked layer bottom→top: `gs branch track <name> --base <parent>`. As built (item 20a, D59): for each layer whose `tracking` is `null`, `gs branch track <name> --base <below>` — `<below>` the layer below's name, or the trunk's **local** branch for the first (`--base origin/main` is refused); never a tracked layer (a second `track` moves its base silently — verified 0.31.2) nor the trunk line (`cannot track trunk branch`); refuses an uninitialised repository first (`branch track` would try to initialise it and die at the trunk prompt under `--no-prompt`); stops at the first non-zero exit, answering `TrackResult` | execFile |
| `enrich` | `gs log short --all --json` (local, item 20a — `--all`, D59) / `--cr-status` (network, cached, M7) | execFile |
| `push(root, layers)` | `gs stack submit --no-publish` (from the top layer; pushes all). *As built (item 21a, D61):* `--no-prompt stack submit --no-publish --no-update-only` (the second flag because a user's `spice.submit.updateOnly` would otherwise make it push nothing with exit 0 — verified), cwd root, `GS_ENV` (now with `GIT_TERMINAL_PROMPT=0`), 120 s — a budget against a hang, not a cancel: the kill reaches git-spice alone and a `git push` it started lands anyway, with no upstream recorded (verified; item 21b's README names the recovery; the process-group kill is item 22's). *As built (item 22a, D63):* 120 s is a cancel — the whole process group is killed (SIGTERM, SIGKILL after 2 s, the pipes destroyed after it), measured: the push in flight never lands and no upstream is written for it, branches pushed before the cut-off stay (`pushed` names them), the next push is clean; from wherever HEAD is — no `--branch` exists, git-spice pushes HEAD's whole stack from a middle layer and from trunk every tracked branch of every stack (verified); refuses first, with a sentence and no spawn that moves a ref: no layers, no `refs/spice/data` (auto-init would die at the trunk prompt), a layer with `push.behind > 0` (after a fetch the lease protects nobody and git-spice overwrites the remote's commits with exit 0 — verified; E76's refusal), git-spice missing/old, a layer with `down.needsRestack` (git-spice would push the layers below it and then refuse — a partial push; `--dry-run` refuses the same way; a `git pull` on trunk is the everyday trigger), naming `<gs> stack restack`; `pushed` = the `INF Pushed <name>` lines, `notes` = every other line (a remote `<name>` with no upstream here is pushed as `<name>-2` and only two `INF` lines say so — verified); a failure quotes the `FTL` line and git's own line after it (`! [rejected] … (stale info)`, `remote: error: cannot lock ref …`, `fatal: …`); tracking is the caller's (an untracked layer between tracked ones is skipped silently, an untracked HEAD is a `FTL`) | execFile |
| `restack(from?)` | `gs stack restack`; after amending layer X: `gs upstack restack --branch <X>` | terminal |
| `sync` | `git fetch <remote>` → **adopt any diverged branch (E76)** → `gs repo sync --restack upstack`. `gs repo sync` fetches only trunk and never notices a rewritten feature branch, so the fetch + adoption step is the extension's own, in plain git. | terminal |
| `moveOnto(L,B)` | `gs branch onto <B> --branch <L> --restack upstack`, then `gs stack submit --update-only` | terminal |
| `insertBelow` | §7.12 | terminal |
| `createPRs` | §7.7 (`gs branch submit --branch … --title … --body … --[no-]draft`) | execFile |
| `setDraft` | `gs branch submit --branch <L> --update-only --draft\|--no-draft` | execFile |
| `mergeBottom` | `gs branch merge --branch <bottom> --method <m>` (method: `prCascade.mergeMethod`; `repo` = forge default when known, else prompt) | terminal |
| `rebaseState` | git's `rebase-merge`/`rebase-apply` dirs — verified (item 22b, D64): git-spice's pause is git's own `rebase-merge/` with `head-name` = the branch being rebased; its record `refs/spice/data:rebase-continue` is internal and unread; the hint is `gs rebase continue` / `gs rebase abort` whenever `refs/spice/data` exists (they drive a plain git rebase too), then `gs stack restack` if a layer above still reads needs restack; M9 adds a `pausedRebaseBranch(git, root)` helper reading `head-name` through `--git-path`, no `RepoState` field until the banner reads one; `GIT_EDITOR=true` on the continue | — |

`…` › Stack gains **Sync Stack** (`gs repo sync --restack upstack`) — the one-button "make everything
right after merges" — and **Merge Bottom PR…**. "Track Stack with git-spice" appears when untracked.

#### 7.13.4 GitHub native stack link (`core/nativeStack.ts`, M7 — required on GitHub)
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
  "viewsContainers": { "activitybar": [ { "id": "prCascade", "title": "PR Cascade", "icon": "resources/pr-cascade.svg" } ] },
  "views": {
    "scm":       [ { "id": "prCascade", "name": "Stack", "icon": "$(layers)" } ],
    "explorer":  [ { "type": "webview", "id": "prCascade.smartlog", "name": "Stack", "icon": "$(layers)", "visibility": "visible" } ],
    "prCascade": [ { "type": "webview", "id": "prCascade.graph", "name": "Stack Graph", "visibility": "visible" } ]
  },
  "commands": [
    { "command": "prCascade.refresh",   "title": "Refresh Stack",        "icon": "$(refresh)" },
    { "command": "prCascade.openDiff",  "title": "Open Changes" },
    { "command": "prCascade.createPR",  "title": "Create Pull Request",  "icon": "$(git-pull-request)" },
    { "command": "prCascade.createStackPRs", "title": "Create PRs for Stack", "icon": "$(git-pull-request-create)" },
    { "command": "prCascade.pushStack", "title": "Push Whole Stack" },
    { "command": "prCascade.checkout",  "title": "Check Out Branch" },
    { "command": "prCascade.trackStack", "title": "Track Stack with git-spice" }
  ],
  "menus": {
    "view/title": [
      { "command": "prCascade.refresh",        "when": "view == prCascade", "group": "navigation@1" },
      { "command": "prCascade.createStackPRs", "when": "view == prCascade && prCascade.hasStack", "group": "navigation@2" },
      { "command": "prCascade.pushStack",      "when": "view == prCascade", "group": "2_stack@1" },
      { "command": "prCascade.trackStack",     "when": "view == prCascade && prCascade.hasUntracked", "group": "2_stack@8" }
    ],
    "view/item/context": [
      { "command": "prCascade.createPR", "when": "view == prCascade && viewItem == stackBranch", "group": "inline" },
      { "command": "prCascade.checkout", "when": "view == prCascade && viewItem == stackBranch", "group": "1_actions" }
    ]
  },
  "configuration": { "title": "PR Cascade", "properties": { "...": "see §7.3" } }
},
"activationEvents": ["onStartupFinished"],
"capabilities": { "untrustedWorkspaces": { "supported": false }, "virtualWorkspaces": false }
```
The `scm` tree entry is v0.1 (M1–M4) and is removed in M6; the two webview entries and the container
arrive with M6 (§7.1). A container icon must be an image file (VS Code's `viewsExtensionPoint.ts`, checked
2026-09-20, accepts no `$(codicon)` there); view icons may use `$(codicon)`. `webview/context` menu
entries mirror the `view/item/context` ones with `webviewId == 'prCascade.smartlog' || webviewId ==
'prCascade.graph'` and `webviewSection == 'layer'` in their `when`, plus the row's own keys (§7.1.1).
`capabilities` arrives with M4 item 14 (§13.4, "Activation and the empty window" — a rider, not part of §7.14). There is deliberately **no
`extensionDependencies` entry** for the built-in Git extension: it is acquired at runtime (§7.14.1), so a
user who disables it sees a message row instead of no PR Cascade at all.

### 7.14 The built-in Git extension — what we take from it, what we keep spawning (M4 onwards)

Decided 2026-09-20, recorded 2026-09-26; the verification is in §13.4. Ric's rule: **prefer VS Code's own
APIs over re-implementing what they already do.** VS Code ships a Git extension (`vscode.git`) that already
finds the repositories in a window, watches them and runs `git status`, and it exposes that through a small
API (`extensions/git/src/api/git.d.ts` in the VS Code repository). We use it for three things and nothing else (a fourth
comes with M6 item 23d: the change lists, for the working-tree row — `core/graph.ts` takes `dirty` as an input, D67):

| We take | From | Instead of |
|---|---|---|
| The repositories in the window, and when one opens or closes | `api.repositories`, `api.onDidOpenRepository`, `api.onDidCloseRepository` | our own scan (`core/discovery.ts`, deleted) and the two `prCascade.repositoryScan*` settings |
| "A `git status` just ran in this repository" | `repository.state.onDidChange` | window-focus and active-editor listeners, and a `.git/HEAD` watcher, of our own |
| Which `git` to run | `api.git.path` — the binary it found, honouring the user's `git.path` | the `"git"` default of `prCascade.gitPath` (now `""` = theirs; a non-empty value still overrides) |

Everything else stays a git spawn of ours (§5), because the API cannot express it: which branches form the
stack and in what order (`for-each-ref --merged / --no-merged`, `rev-list --count`), a layer's files and their
content, the trunk, the current branch and whether HEAD is detached, and whether a rebase is in progress. The
last two deserve a sentence each, because the API *looks* as if it had them. `state.HEAD` is not a safe
"which branch, and is it detached?" answer: the Git extension puts a **tag's** name there (type `Tag`) when a
tag points at a detached HEAD, gives an unborn branch (no commits yet, right after `git init`) a name with no
commit, and mid-rebase has no name — or a tag's, if one points at the commit git stopped on — so
`symbolic-ref --quiet HEAD` (D17) stays. `state.rebaseCommit` is built from `<root>/.git/REBASE_HEAD`
with `.git` spelled out rather than from `rev-parse --git-dir`, so in a linked worktree (E19) it is always
undefined (reproduced on git 2.50.1, both rebase backends); and even in the main worktree it is undefined at an
interactive `break`, after a failed `exec` and during `git am`, because git writes no `REBASE_HEAD` there while
the `rebase-merge` / `rebase-apply` directory exists — so our `--git-path rebase-merge` / `rebase-apply` check
(§5) stays, everywhere, not only in worktrees. It was present at every pause point probed; `rebaseCommit`
never gives a false positive, so a defined value may decorate the banner with the stuck commit's message, later.

#### 7.14.1 Getting the API (`src/vscode/gitApi.ts`)

```
ext = vscode.extensions.getExtension<GitExtension>('vscode.git')     // extension.ts does this line; gitApi.ts the rest
  undefined → the user disabled the Git extension → the §7.14.3 row 1; vscode.extensions.onDidChange → run this block again
              (VS Code enables an extension in place, no reload; the event fires for any extension change, so still
               undefined → keep the row)
exports = await ext.activate()      // its activation event is '*' — VS Code starts it with every window — so this
                                    // normally resolves at once
  rejects → the §7.14.3 row 2 (the Git extension rethrows anything but "git not found"); nothing else runs
  exports.enabled === false → one E82 row: the setting git.enabled, read window-level (§7.14.3), false → row 3,
                                          otherwise → row 4
  exports.onDidChangeEnablement(true) → from a setTimeout(…, 0), not inside the handler, take the API and refresh
                                          (recovers row 3 only)
api = exports.getAPI(1)             // throws 'Git model not found' in exactly the exports.enabled === false cases;
                                    // a throw with enabled === true after the one-tick retry → row 2, never a retry loop
api.state !== 'initialized' → wait for one onDidChangeState('initialized')   (its initial scan has settled)
```
The first line is the one `extension.ts` owns: it calls `getExtension` and hands the result — a
`vscode.Extension<GitExtension>` or `undefined` — to `gitApi.ts`, which does the rest and reports either the
API (roots, git path, events) or one E82 row, and reports again after `onDidChangeEnablement(true)` or
`extensions.onDidChange`. That hand-over is the test seam, as `extension.ts` handing the tree its loaders is:
`ext/gitApi.test.ts` imports `src/vscode/gitApi` directly (as `scanSettings.test.ts` imports `core/discovery`)
and passes `undefined` (row 1), an object whose `activate()` rejects (row 2), and objects whose `activate()`
resolves to a fake `GitExtension` (rows 3–4 and the recoveries); nothing else can reach rows 1–2, because the
Git extension is a built-in and present in every `test:ext` run (§13.4 (j)). Two more seams for the same reason:
the adapter reads the window-level `git.enabled` through an injected reader — default
`() => vscode.workspace.getConfiguration('git', null).get<boolean>('enabled', true)`, the call the Git extension
itself makes — so tests hand it `() => false` / `() => true` and never write the setting (writing it at runtime
would make the real Git extension dispose every open repository and reopen them asynchronously, racing every
later test); and `gitApi.ts` exports a pure `gitExecutable(setting: string, apiPath: string): string` — `''` →
`apiPath`, anything else → `setting` — which the three pipelines in `extension.ts` use, so `config.ts` stops
turning an empty `prCascade.gitPath` into `'git'` and hands the raw string through. Why the `setTimeout`: at 1.138
the Git extension fires `onDidChangeEnablement` one statement before `getAPI` can succeed, so a call made inside
the handler throws `Git model not found`.
Types come from `git.d.ts`, copied verbatim from VS Code `release/1.85` into `src/vscode/git.d.ts` (MIT; the
Microsoft header stays). 1.85 is our `engines` floor and its file is the smaller one: `Repository.onDidCommit`
/ `onDidCheckout`, `Repository.kind`, `state.worktrees` and `api.getRepositoryRoot` exist only in later
versions, and vendoring the floor's file makes the compiler refuse them. Import it with `import type` only:
a `.d.ts` has no runtime module, so `RefType.Tag` in code passes `tsc` (which inlines the `const enum`) and
breaks `npm run build` (esbuild cannot resolve it) — compare `ref.type` against a literal or a local constant
declared `satisfies typeof RefType`, the pattern VS Code itself moved to. **No `extensionDependencies` entry**
(§7.11): with one, a user who disables the Git extension loses PR Cascade silently (VS Code computes it
"disabled by dependency" and never loads it; only the Extensions view shows a warning), and the E82 row for
`git.enabled: false` is needed in either design — so acquiring the API at runtime costs one `undefined` check
and gains a message. `onDidChangeEnablement` fires at most once, on a false→true flip; the reverse flip is not
reported (the repositories simply close, §7.14.3 row 3); the disabled-extension case recovers through
`vscode.extensions.onDidChange` (row 1); only "git not found" never recovers without a reload — the row says so.
In a remote window (SSH, WSL, Codespaces) both extensions run in the remote host — each has a `main` and no
`extensionKind`, which makes both `workspace` extensions — so the lookup is the same there; PR Cascade has to be
installed on the remote, as any extension that spawns processes does.

#### 7.14.2 Repositories and the change signal

- **Roots** = `api.repositories.map(r => r.rootUri.fsPath)`, sorted by the workspace folder each belongs
  to, then by path (§6). The API re-sorts its array in place on every internal lookup (longest root first), so
  its order means nothing; every access returns a new wrapper object — two reads of the same repository are two
  different objects, so `===` between them is false; compare `rootUri.fsPath`; and `initialized` says the initial
  scan has settled, not that any repository's first `git status` has run — M4 reads neither `state.HEAD` nor the
  change lists, so that does not matter yet. M5's digest (below) does read `state.HEAD`, as a change-detection
  input only — never as the branch name, which stays our `symbolic-ref` answer (§7.1.0) — and must accept
  `undefined` (no status has completed yet for that repository; `git.d.ts` types it `Branch | undefined`) as one
  more digest value, so a first status that lands later changes the digest once — one extra `gs log`, accepted — **not
  built** (item 20a, D59): the digest is the `for-each-ref` text alone, `state.HEAD` is read nowhere, and 20b leaves
  `GitRepository` at its three members; see the As-built bullet below.
- **Which repositories exist is the user's `git.*` configuration** (§6 lists the settings), exactly as in the
  Source Control view. Three consequences accepted: a workspace folder *inside* a repository whose root is not
  a workspace folder waits for the Git extension's own Yes / Always / Never notification (E1b); a submodule is
  a repository of its own with its own row; and a linked worktree opened as a workspace folder is a repository
  of its own too — the right answer for a view of *the stack under HEAD*, since every worktree has its own HEAD
  (E19; the Git extension dedupes by root only, never by the shared `.git`, and neither do we; how M6's
  all-stacks views treat two worktrees of one repository is decided with the multi-repository layout then).
  `onDidOpenRepository` / `onDidCloseRepository` are added beside our `onDidChangeWorkspaceFolders → refresh`
  listener, which stays (one line): folder order drives the sort, and a folder change need not open or close a
  repository — a reorder fires no Git-extension event, a folder added inside an open repository opens nothing,
  and a removed folder keeps its repository while an editor in it is visible or another folder is at or above
  the root.
- **`state.onDidChange` means "a `git status` run just completed"**, not "something changed". It fires after
  every completed run — one where nothing moved, the Git extension's own operations (stage, fetch, commit …),
  the initial status of each repository — and not for a run that a newer one cancelled. For git run outside
  VS Code the chain is: its watcher (the working tree; the **first level** of `.git`: `HEAD`, `index`,
  `ORIG_HEAD`, `packed-refs`, …; and HEAD's upstream ref `refs/remotes/<remote>/<name>` while HEAD has one — a
  transient watcher rebuilt after every status) → 1 s trailing debounce → wait until no Git-extension operation is running
  **and the window is focused** → `git status` → the event → 5 s cool-down. That is E20 for free: alt-tab
  back, the status runs, the event fires, we refresh. Three things it does not give us: (1) a ref that moved
  without the working tree, the index or `HEAD` changing is below `.git`'s first level and not watched —
  probed 2026-09-26 (the table is in §13.4 (k)): `gs branch track` / `untrack` / `downstack track`, `gs repo init`,
  `git branch -f`, `git update-ref`, `git tag`, and `git push` of any branch but HEAD's upstream write only under
  `refs/`, `logs/` and `objects/`; a push of the current branch to its upstream rewrites the one watched ref file
  and *is* seen (so our own submit adds one event on top of the explicit refresh, absorbed like the rebase case
  below), as is every git-spice command that checks out, rebases, commits, creates, deletes, renames, folds or
  syncs (`HEAD`, `index`, `ORIG_HEAD`, `config` or `FETCH_HEAD`) — so **every command of ours refreshes
  explicitly afterwards**, and for a silent one typed in a terminal the manual button is the recovery (E83);
  (2) with `git.autorefresh: false`, or a repository over `git.statusLimit` (10 000 entries), the watcher
  path is off entirely — the same for Source Control itself; the README says so. Not on that list:
  `files.watcherExclude` — its default covers only `.git/objects` and `.git/subtree-cache`, and even a user's
  `**/.git/**` entry does not blind the Git extension, because VS Code turns excludes into a dedicated
  watcher for exactly such requests; (3) an event that lands while a Git-extension operation is running is
  dropped, not queued. (Newer VS Code can read the commands typed in its integrated terminal — its *shell
  integration* — and runs a status after a plain `git <subcommand>` exits 0; `gs …` never matches that, and 1.85
  has no such path.) Our own `gs` commands that rebase or check out
  (`gs upstack restack`, …) do touch `HEAD`, `index` and `ORIG_HEAD`, so they produce one event on top of our
  explicit refresh — a duplicate the debounce (and, from M5, the digest below) absorbs.
- **We debounce** (`core/debounce.ts`, hand-rolled, §11.3; 250 ms in M4 — `STATUS_REFRESH_DELAY_MS` in
  `extension.ts`): the events come per repository, and in bursts from the Git extension's own operations. The
  adapter relays every one as `onDidRunStatus` and re-listens per repository whenever the list changes;
  `extension.ts` debounces the relay and the Refresh button together. **M4: debounce only** — our refresh is a
  handful of short read-only spawns. **M5 (item 20, `enrich`) adds a digest pre-filter**, because `gs log short --json` costs ~1.1 s per
  call on this Mac regardless of repository size (measured 2026-09-26, git-spice 0.31.2) and would otherwise
  run after every stage click and autofetch tick: `state.HEAD?.{name, commit, upstream?.commit}` (free;
  `undefined` before the repository's first status is one more value; HEAD stays in the digest because a plain
  checkout moves HEAD without moving any `refs/heads/*` object name — **not built**, D59 and the next bullet) plus one
  `git for-each-ref --format='%(refname) %(objectname)' refs/heads refs/remotes refs/spice` (~60 ms) — the
  object names only, never the contents of `refs/spice/data` (§3 "Read model") — and `gs log` runs only when
  the digest changed. `refs/remotes` is in it because trunk is a remote-tracking ref and a fetch moves it
  without touching anything else; `refs/spice` because `gs branch track` moves nothing else. The input side has
  nothing cheaper (`state.refs` is deprecated and always `[]`). Verified the same day: `gs log short --json`
  spawns only read-only git children and writes nothing under `.git`, so an event-driven refresh cannot
  re-trigger the Git extension's status — M5 pins that with a test (offline for `gs log short --json`; the
  `--cr-status` forge path only in the opt-in e2e suite, §13.4 (k)).
- **As built (item 20a, D59):** the digest is the verbatim text of the one `for-each-ref` (`core/digest.ts`), compared
  by `===` against a memo per root on the backend (`logByRoot`); **`state.HEAD` is not in it** — with `--all` the
  lines `gs log` prints are the same from every HEAD and the parser drops `current` (D55), and `gs branch checkout`
  writes nothing under `refs/spice`, so HEAD would only add one `gs log` per checkout; the memo is applied to the
  layers as the checkout left them, by name. The `refs/spice/data` line in that text is the initialised check (§7.6),
  so `gs log` never runs without it and the refresh never probes; `locateGitSpice` runs only right before a `gs log`.
  `gs log` itself moves `refs/spice/data` when it prunes a branch deleted out of band (`INF tracked branch c was
  deleted out of band: removing...`, verified 2026-10-08), so the refresh after such a run asks once more and then hits
  the memo — it converges. "Writes nothing under `.git`" above holds for a repository whose tracked branches all exist;
  that prune is the one write. Measured 2026-10-08: 0.63 s per `gs log` on this 12-branch repository, 0.34 s in a
  3-branch one, `for-each-ref` 0.01 s (not ~1.1 s); the pre-filter stands.
- **`await repository.status()`** runs a status at once, without the focus wait, and the event has normally
  fired by the time it resolves (a call superseded by a newer status fires nothing — never wait on the event
  after `status()`, never count on one event per call). Tests use it as their synchronisation point after an
  external git command (§9.1). The manual Refresh button may fire it too, unawaited, so the Source Control view
  catches up in the same click; the button's own recompute goes through the same debounce, so the two collapse
  into one load, and it never waits for the event (E83's silent set never changes what `git status` shows).

#### 7.14.3 The E82 rows

| State | How we see it | Row | Recovery |
|---|---|---|---|
| 1. Git extension disabled by the user | `getExtension('vscode.git')` is `undefined` | "PR Cascade needs the built-in Git extension — enable it in the Extensions view" | none needed from VS Code: it enables an extension in place (no reload, 1.85 and 1.138) — `vscode.extensions.onDidChange` fires once the Git extension is back in the registry, `getExtension` returns it, and the adapter re-runs the §7.14.1 handshake (the event fires for any extension change; still `undefined` → keep the row). Disabling a *running* extension is the one case VS Code does make the user reload for, which is how this state is reached at all. |
| 2. The Git extension failed to start | `await ext.activate()` rejects (it rethrows anything but "git not found") | "The Git extension failed to start — reload the window" | reload (1.138 logs the cause in its output channel before rethrowing; 1.85 does not) |
| 3. `git.enabled: false` when the window opened | `exports.enabled === false` and the injected reader of `getConfiguration('git', null).get('enabled')` says false — the window-level value, the one the Git extension itself decides on at start-up (`null` = read with no folder in mind); a folder-level `false` is a different state: `exports.enabled` stays true and that folder simply has no repository | "Git is disabled in this workspace (git.enabled)" | `onDidChangeEnablement(true)` → `getAPI` one tick later → refresh. Turned off *while running*: `exports.enabled` stays true and no event fires — the Git extension closes the repositories (`onDidCloseRepository` → the §6 zero-repo row, not this one); turned back on, it re-opens only repositories whose root is a workspace folder (`onDidOpenRepository` → refresh); a repository *below* a folder (the §1 layout) returns on the next change its watcher sees under it, on a visible editor inside it, or on a reload. |
| 4. The Git extension found no git | `exports.enabled === false`, the reader says true | "The Git extension found no git — set git.path, then reload the window" | reload only; the Git extension never re-probes (and its own notification appears only when a workspace folder root holds a `.git` directory — not in the §1 layout) |
| 5. `prCascade.gitPath` set to something unrunnable | our own spawn fails (E17) | the E17 error row, as today | the next refresh after the setting is fixed |

The status bar item is hidden in all five states. The first four are one message row in an otherwise empty
view — no spawn of ours runs, so nothing can crash-loop. The row texts here are the single source: the E82
tests assert them exactly (pending item 7b's rule), so the §7.14.1 block only points at row numbers.

---

## 8. Behaviors and edge cases (each row must have a test)

| # | Situation | Required behavior |
|---|---|---|
| E1 | Repo is *below* a workspace folder (the §1 parent-folder layout) | Shown. **From M4 delegated (§7.14.2):** the built-in Git extension opens it when `git.autoRepositoryDetection` is `true` (default) or `subFolders` and the depth is within `git.repositoryScanMaxDepth` (default 1); it appears when `onDidOpenRepository` fires — in its initial scan only: a parent folder added to the workspace later is opened as a repository itself but not scanned below (`scanWorkspaceFolders` runs from `doInitialScan` alone, both versions), so the §1 layout must be in the workspace when the window opens. M1–M3: found by our own scan (D26). |
| E1b | Workspace folder is *inside* a repository (the root is above it) | Shown once when the root is also a workspace folder — the Git extension opens it silently and once. Root not a workspace folder: the Git extension parks it behind its own Yes / Always / Never notification (`git.openRepositoryInParentFolders`, default `prompt`) and until it is answered we show "No git repository in this workspace" — accepted 2026-09-26 (§7.14.2). The fixture lists the root too, so no prompt in tests. M1–M3: `--show-toplevel` walked up silently. |
| E2 | Two workspace folders resolve to the same repo | Shown once. **From M4 delegated:** one `Repository` per root; rows keyed by `rootUri.fsPath`. |
| E3 | Detached HEAD | Layers still computed (`--merged HEAD` works); header says "Detached HEAD"; no layer is `isCurrent`. Push Whole Stack refuses after its fresh load: "Detached HEAD in <repo> — check out a branch of the stack first." (`stack submit` acts on HEAD's branch; git-spice would say `in detached HEAD state`; item 21b, D62). As built (M6 item 23b, D68): the view model's `detachedHead` message row, `Detached HEAD`, information — the layers still drawn, nothing `filled`; replaced by the rebase row while a rebase is paused, as the tree does. |
| E4 | No trunk resolvable | Informational node; no crash; setting hint. As built (M6 item 23b, D68): the one `noTrunk` message row, `No trunk found — set prCascade.trunk`, warning, and no rows — `layoutGraph` is not run without a trunk (`ViewModelInput.graph` is `null`). |
| E5 | On trunk itself (zero layers) | "Not on a stack" node. Push Whole Stack (item 21b): "Nothing to push — the Stack view shows no layers." before the pick, "Not on a stack in <repo> — nothing to push." after the fresh load. As built (M6 item 23b, D68): the `notOnStack` message row, `Not on a stack`, only when the layout has no layer row — the repository has no stack; with other stacks present nothing is said and the trunk row is `filled` (§7.1.1), the toggle included. |
| E6 | Two branches point at the same commit | Both listed, adjacent, deterministic order (by name). Second has 0 files vs first. As built (M6 item 23a, D67): the graph chains the two in name order too — the second's parent is the first, depth equal (`unit/graph` L13, `git/graph.git` E6). |
| E7 | Renamed file | Left side of diff uses `oldPath`; label shows `old → new`. |
| E8 | Added file | Left pane empty, right pane content. No error surfaced. |
| E9 | Deleted file | Left pane content, right pane empty. |
| E10 | Binary file | Not opened in diff editor; opened as file (or informational message). |
| E11 | Path with spaces / unicode / `#` | URI round-trips; `git show` gets the exact path (`-z` parsing). |
| E12 | Rebase in progress | Banner node; `pushStack`/`checkout` refuse with a message. Detected by our own `--git-path` check (§5), never by the Git extension's `state.rebaseCommit` (§7.14, E19). As built (item 20b, D60): Track Stack refuses after its fresh load with "Rebase in progress in <repo> — resolve it first."; git-spice itself tracks during a paused rebase (verified 0.31.2). As built (item 21b, D62): `pushStack` refuses after its fresh load with the same sentence; `enablement: !prCascade.rebaseInProgress` greys both commands' entries; the key is set per load, true when any loaded repository is paused; `executeCommand` bypasses `enablement`, so the refusal is what `ext/commands` runs — "assert message, don't actually push". As measured (item 22b): during git-spice's own interrupted restack HEAD is detached at trunk's tip (the first pick stopped), so `computeStack` reports `layers: []`, `head: null`, `rebaseInProgress: true` and `backend.push` would answer the no-layers result — the command's refusal after its fresh load is the protection, not core. As built (M6 item 23b, D68): the `rebaseInProgress` message row, `Rebase in progress — resolve it first`, warning, in place of the detached row; the rows beneath are what the graph lays out for a detached HEAD (nothing filled). |
| E13 | Dirty working tree + checkout | Refused with message; nothing changed. |
| E14 | Bottom layer amended (descendants now stale) | After amending the bottom, the amended branch is *no longer* an ancestor of HEAD, so it drops out of the HEAD stack and the old commit shows as an unnamed layer. Render what git says; git-spice marks it `needsRestack` once tracked (M5) and M9's restack fixes it. Test documents the behavior. |
| E15 | Bottom PR squash-merged, local branch still exists | Its commits are not in trunk (squash rewrote them), so it still shows as a layer until `sync` (M9) removes it and restacks the rest. Test documents this. |
| E16 | Second, unrelated stack exists in the repo | Not shown (not ancestors of HEAD). Never mixed in. As built (M6 item 23a, D67): the tree keeps this until 23j; `layoutGraph` draws the second stack in its own lane, joining trunk's (`unit/graph` L2). |
| E17 | `git` missing / wrong path | One clear error node, not a crash loop. **From M4 (§7.14.3):** the built-in Git extension found no git → one message row naming *its* `git.path` setting and that a reload is needed (it never re-probes); `prCascade.gitPath` set to something unrunnable → the E17 error row as today, from our own spawn. |
| E18 | Large layer (1000+ files) | `-z` parsing handles it; tree renders (VS Code virtualizes). `maxBuffer` sufficient. |
| E19 | Worktree checkout (`.git` is a file) | `--git-path` used for rebase detection — **kept in M4**: the Git extension's `state.rebaseCommit` reads `<root>/.git/REBASE_HEAD` literally and is undefined in a linked worktree (verified 2026-09-26, §13.4). Discovery works: a worktree opened as a workspace folder is an ordinary `Repository` to the Git extension. |
| E20 | Window regains focus after external git activity | View refreshes within the debounce window. **Mechanism from M4 (§7.14.2):** the Git extension's watcher saw the change, waited for focus, ran `git status`, fired `state.onDidChange`; we debounce and recompute. Holds only with `git.autorefresh` on (default) and a repository under `git.statusLimit`; a ref-only change is not seen (E83). Test: subscribe to `provider.onDidChangeTreeData` (the event a tree provider fires to make VS Code re-ask `getChildren`; `vscode/tree.ts` already exposes it) before the external commit; commit; `await repository.status()` — the same event without the focus wait; await that one tree-change event (the debounced handler's `refresh()`); then `getChildren()`. The test never calls the exported `refresh` or `prCascade.refresh` itself, so a missing `state.onDidChange` subscription fails it by timeout — reading the tree straight after `status()` would prove nothing, since `getChildren()` re-runs the pipeline on every call. |
| E21 | Remote URL in each supported form (§7.5) | `parseRemoteUrl` returns the right host/owner/repo; unparseable → `null`, PR features disabled, tree still works. `detectForge` reports it as `unparseable` with the URL kept for the node (D54). |
| E22 | Workspace contains a github.com repo and a `*.ghe.com` (or other Enterprise) repo | Each repo's `gh` calls carry its own `GH_HOST`; auth status evaluated per host. As built (item 23a, D65): `GH_HOST` *and* `--hostname`, both lower-cased and the same host, on every `auth status` — gh matches the flag against its host list unnormalised, and only `GH_HOST` puts a host gh has no account for on it (a `*.github.com` remote reads as logged in only with both); `unit/ghstatus` pins the flag and the same-host rule, `unit/readiness` two roots with two hosts. |
| E23 | `gh` not authenticated for a repo's host | Tree renders fully; layer description shows the hint; any `gh` action shows the "Log in" prompt → terminal runs `gh auth login --hostname <host> --web …` → extension polls `gh auth status` and, on success, refreshes and re-runs the original action. Second click while pending only focuses the terminal. Timeout gives up silently. As built (item 23a, D65): the probe's step 5 reads exit 0 of `gh auth status --hostname <host>` under `GH_HOST` — a network call even for a host with no account; the offer is the sentence `gh is not logged in to <host>. Run gh auth login --hostname <host> --web in a terminal.` with no button until item 23b wires the line. The layer description's hint is M7's. Offline reads as not logged in (D65). As built (item 23b, D66): the prompt is `gh is not logged in to <host>.` → `Log in` → `env -u <pair> <gh> auth login --hostname <host lower-cased> --web --git-protocol <p>` in the repository's terminal → the probe polled every 3 s → refresh → `gh is logged in to <host>.` → the action (today the ready line). |
| E24 | `gh` not installed | Tree, diffs and push still work; on GitHub repos CR creation is disabled until installed (E62b); on GitLab nothing is affected. Verified item 21 (0.31.2): `stack submit --no-publish` runs no `auth` and no `gh`. As built (item 23a): nothing answering `gh --version` as gh → `gh-missing` listing `gh` and `gh-stack`, GitHub only; a GitLab repository never spawns gh (`unit/readiness`). The informational node this row and §7.5 mention is not built — the setup command's notification is the one surface (D65). |
| E25 | Repo has no remote | Layers/diffs work; trunk falls back to local `main`/`master`; PR + push disabled with a message. `detectForge` → `no-remote` (D54). As built (item 21): push is not disabled up front — git-spice's own `ls-remote` fails before any push and the sentence quotes git (`fatal: 'origin' does not appear to be a git repository`, D61). |
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
| E44 | HEAD on the middle layer | Status bar reads `$(layers) <middle branch> · 2 of 2` — the layer above HEAD is not an ancestor of HEAD and drops out (§3 "Stack membership", §12 item 2), so in v0.1 `n` equals `N` except for E6; tree marks that layer current and shows two layers; labels are branch names throughout. |
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
| E55 | gs installed, repo initialized, logged in | Readiness OK; actions enabled. Any missing piece → the matching one-click fix (install / `gs repo init` / `gs auth login`) and the action re-runs after. The probe is exactly five commands; `ready.gsPath` is the executable that answered (D56). As built (D58): one fix at a time, each followed by a refresh and the next probe, until ready; the by-hand command ends in "git-spice <version> is ready for <repo> (<host>)." Push Whole Stack (item 21b, D62) deviates as Track Stack does: `--no-publish` needs no forge and no login — except for a branch with an open CR, which git-spice updates through the forge (its help), and whose failure is git-spice's own sentence. |
| E56 | Detected stack has untracked layers | Tree shows "not tracked"; any mutating action runs `gs branch track --base` bottom→top first (a layer whose parent is also untracked is handled by the ordering). As built (item 20a, D59): `StackLayer.tracking === null` is "not tracked" — absent from a *complete* `gs log --all` answer; a layer not enriched, or unlisted by an answer with a malformed line, is unknown and left alone; `track` adopts exactly the `null` ones, bottom→top, each on the layer below or the trunk's local branch. Item 20b (D60): "Track Stack with git-spice" — in the `…` menu while any repository has a `null` layer, in the palette always — tracks exactly those, after re-loading the repository, and refreshes once. Item 21b (D62): Push Whole Stack tracks the `null` layers first, then pushes — the one mutating action built so far that runs the preflight. M6 item 23b (D68): the views ask `enrichment.byName` for every row — the `untracked` indicator and the dim name are "absent from a complete answer", the same `null` by another road; `context.isUntracked` is true for exactly those rows. |
| E57 | `gs log --json` with a malformed line / unknown fields / stderr noise | Good lines parsed, bad line reported once, unknown fields ignored; non-zero exit → enrich degrades to "no stack info", tree still renders. `parseGsLog` → one `MalformedLine { line, problem }` per bad line; stderr is never fed to it (D55). As built (item 20a, D59): `exitCode !== 0`, a timeout, a program that never started, git-spice missing or old → `enrichment.not-enriched { cause, reason }`, no `tracking` on any layer, nothing remembered; malformed lines in `enrichment.malformed`, reported by the run that met them — and because a bad line names no branch, the layers that answer does not list carry no `tracking` (unknown, drawn as built, never re-tracked) rather than `not tracked`. M6 item 23b (D68): the view model draws an unknown layer with no indicator at all — not `untracked`, not ⛅ — and a `not-enriched` repository with none anywhere; `context.isTracked` and `isUntracked` are both false, so no menu offers to track it; the Output line stays the only report. |
| E58 | gs restack/sync/onto pauses on conflicts | Banner "git-spice operation paused — resolve, `git add`, then `gs rebase continue`"; mutating actions disabled; cleared on next refresh after completion. |
| E59 | Repo not initialized for git-spice | Tree works (git ancestry); CR/stack actions show the init offer; `gs repo init --trunk <detected trunk>` runs in a terminal. `--trunk` takes the trunk's *local* branch (`main` for `origin/main`), which must exist; without one the offer is a sentence naming `git branch <b> <trunk>`, quoted for a shell (D57). The line starts with `command`, so an alias such as `gs='git stash'` cannot take it over. As built (item 20b): the local tier is simply absent (one Output line), nothing nags on refresh; **Track Stack deviates here (D60): a sentence naming the reason and the setup command, no offer, no re-run** — the readiness flow cannot pass for a forge-less repository (E21), and a local operation must not demand a login. Push Whole Stack (item 21b, D62): the same sentence as Track Stack's, after the fresh load. |
| E60 | Forge not supported by git-spice (unknown host, no `spice.forge.*.url`) | Tree and diffs work; CR features disabled with a node naming the config key to set. Detected as `forge.kind` `unknown` with `recognizedByGitSpice` false, the host known (D54); the node should already say "v1 supports GitHub and GitLab", since a configured bitbucket/gitea host lands in E75 next. A rejected `spice.forge.kind` (`ForgeConfig.rejectedKind`) also lands here, with its own remedy: unset the key or set one of git-spice's five ids. As built (D57): both are sentences with no button; E60's names `spice.forge.github.url`, `spice.forge.gitlab.url` and, for an ssh alias, `spice.forge.kind`. |
| E61 | Plan doc with mixed `Draft:` | Each `gs branch submit` carries its own `--draft`/`--no-draft`; final states match the plan; `markReady*` uses `--update-only --no-draft`. |
| E62 | git-spice not installed | One-time install offer; decline remembered; tree and diffs still work. `gs-missing.tried` lists every executable asked, in order, Ghostscript's `gs` included (D56). The offer (D57): Homebrew in a terminal when `brew` is found, run by its full path, else the install page; the sentence says *VS Code's* PATH and names `prCascade.gsPath`; with the setting set, a sentence pointing at it and no button; when Homebrew has a `git-spice` the probe could not reach, a sentence naming that path for the setting and no button. The decline is not remembered yet (D58): only the by-hand command shows the offer before item 20, and asking it by hand is asking again. |
| E62b | GitHub repo, `gs` present but `gh`/gh-stack missing | Readiness lists exactly what to install; CR actions disabled until then; tree and diffs work. As built (item 23a, D65): `missing` is `['gh', 'gh-stack']`, `['gh']` (with `ghVersion`) or `['gh-stack']`, with `ghPath` for the lines to come; the sentence is 19a's information text, no button, until item 23b; the ready line names gh. CR actions are M7's. As built (item 23b, D66): at most one button per pass — Homebrew's install or upgrade / the page / `gh extension install github/gh-stack` (D57); the two sentences that point at `prCascade.ghPath` (set, or Homebrew's gh outside VS Code's PATH) have none; every gh sentence a warning. |
| E63 | Trunk detected by §5 differs from git-spice's configured trunk | Warning node; offer `gs repo init --reset --trunk <detected>` (confirm). |
| E64 | First mutating stack operation with `rerere.enabled` unset | One-time offer to set it (global); decline remembered in `globalState`; never set silently. |
| E65 | Remote URL for each forge kind (github.com, `*.ghe.com`, gitlab.com, self-hosted GitLab, bitbucket.org, Bitbucket DC, gitea, codeberg.org, dev.azure.com) | `core/forge.ts` classifies correctly; unknown → `unknown`. Self-hosted GitLab, Bitbucket DC and gitea only through their `spice.forge.<kind>.url` (no default gitea host in 0.31.2); a subdomain of a default or configured host counts (`ssh.github.com`, `altssh.gitlab.com`); Azure classified by host but never recognised by git-spice 0.31.2 (D54). |
| E66 | GitLab repo | Submit produces MRs targeting parent branches; GitLab's native stack UI auto-detects (nothing extra to do); status shows `!123`. |
| E67 | Not logged in to gs for this forge | Login prompt → terminal `gs auth login`; README guidance per forge; poll → continue pending action. As built (D58): the README's "git-spice setup" names git-spice's main methods per forge (GitHub CLI or OAuth or a token; GitLab CLI or OAuth or a token). The line is `env -u GITHUB_TOKEN <gs> auth login --forge <kind>` (`GITLAB_TOKEN` for GitLab): an environment token counts as a login and makes git-spice refuse `auth login`, `--refresh` too (verified 0.31.2, D57). `gs stack submit --no-publish` succeeds logged out (verified 0.31.2, item 21a) — push needs no login (D62). Item 23a (D65) measured the same for gh: it refuses `auth login` while a token variable for the host's class is set — `GH_TOKEN`/`GITHUB_TOKEN` for github.com and *.ghe.com, `GH_ENTERPRISE_TOKEN`/`GITHUB_ENTERPRISE_TOKEN` for Enterprise Server — and not while the other pair is (`git/gh.git`); the login line that unsets a pair per host is item 23b's. |
| E68 | GitHub repo, createPRs | After the CRs exist, `gh stack link <branches bottom→top>` runs; every PR shows the native badge/map; stack number recorded. `gh` missing/old on GitHub → createPRs refuses up front with the install offer. Link failure after CRs were created → error naming the fix (`Relink Stack`). |
| E69 | PAT-only forge (Bitbucket DC / Gitea / Forgejo) | Login guidance says so plainly; the extension never requests or stores a token. |
| E70 | GitHub- or GitLab-looking host git-spice doesn't recognize | Offer `git config spice.forge.<kind>.url https://<host>` then re-probe. Detected as `forge.kind` `github` or `gitlab` with `recognizedByGitSpice` false — named after the GitHub case: the `*.ghe.com` rule is the extension's, not git-spice's; the same shape for github.com while a `spice.forge.github.url` names another host (the key replaces the default — offer `https://github.com`), or a subdomain of one, and for a spelling or port git-spice will not match. The offer must echo the remote's spelling: git-spice compares the text (D54). As built (D57): run with git, not in a terminal, into the repository's own config (which wins over a global value), with no port, and with the forge's `apiUrl` beside it (GitHub: `api.github.com`, `api.<host>` for `*.ghe.com`, `<host>/api` as a fallback — git-spice guesses `<url>/api` for any url but exactly `https://github.com`; GitLab: the url itself); with an explicit `spice.forge.kind` set, a sentence instead — its remote is often an ssh alias with no URL to offer. |
| E71 | Bottom CR merged on GitHub with native stacks | GitHub retargets natively; `gs repo sync --restack` retargets/restacks locally to the same base; nav comments and native map agree. |
| E72 | Insert below on GitHub, then Finish | CRs created/updated by gs, then the stack is re-linked with the new full order; the popover shows the new layer in position (verify no duplicate stack — §12 8b). |
| E73 | `Relink Stack on GitHub` on an already-linked stack | Idempotent: no new stack, bases untouched. |
| E74 | GitLab repo, createPRs | MRs target parent branches; GitLab's header dropdown shows the stack with no extra step; no `gh` involved anywhere. |
| E75 | Bitbucket/Gitea/Forgejo/Azure repo | Tree and diffs work; CR actions show "v1 supports GitHub and GitLab" (git-spice could do it, but there is no native stack view to show). |
| E77 | Drag a layer row and drop it | Onto another layer → confirm → `moveOnto(L, B)` exactly once with the dragged and target names; onto trunk → base is the trunk ref; onto its own descendant → refused before the confirm (E53), no git call; onto a file/message row, or across repositories → no drop target, nothing runs; during a rebase or with a dirty tree → refused with the E12/E13 message; cancelling the confirm → no call. |
| E78 | Lane layout (`core/graph.ts`) | One stack → one lane; a second stack on the same parent → lane +1 with `joinsLane` on its lowest row; a stack rooted on a middle layer of another stack → lane +1 from that layer; trunk-only repo → just the trunk row; the checked-out layer is `filled`; dirty tree → a `dashed` working-tree row directly above the checked-out row; elided trunk history between the lowest stack and `main` → one `elided` row; lanes never cross (a stack always sits right of everything drawn above it). Table-driven. As built (M6 item 23a, D67): `layoutGraph(input, { trunk, head, dirty, onlyStackOf? })` in `core/graph.ts` — a tagged union of four rows (`layer`, `trunk`, `workingTree`, `elided`) in drawing order, top first and the trunk row last, each with `lane`, `node` and `joinsLane?`; the continuing child is the subtree with the most rows (ties by name), side children take `lane + 1` and join below, so a stack's lane follows the repository's shape and never a checkout or a fetch; among trunk's side roots those on its tip are drawn above those behind it; the trunk row is `filled` when HEAD is on a branch trunk already contains (its local trunk at or behind the tip, a merged branch, a branch with no commits yet) and the working-tree row then names that branch; a merged branch is no stack (it starts no `rev-list --parents` line); after a merge of two named lines the deepest named ancestor is the parent whichever side it came from, so the other side's branch is a stack of its own (what git says, as E14/E15 — L20); an orphan branch is a stale stack with a permanent elided row; `dirty` is handed in — 23d reads the Git extension's change lists, this module spawns no `git status`; the table is `unit/graph`'s `it.each`, the shapes `git/graph.git` checks against real git. |
| E79 | Webview protocol | Every refresh posts a model with a rising `seq`; a command message carrying an older `seq` is dropped (a click on a row that no longer exists); a command from a view runs exactly the registered command with the row's `name` as argument; a hidden view receives the current model when it becomes visible; the host evaluates nothing the view sends except a command id that must start with `prCascade.` and its string arguments. As built (M6 item 23b, D68): the message shapes are `src/webview/protocol.ts`'s — `seq` on every message both ways, `command` typed `` `prCascade.${string}` `` so a renderer cannot send another extension's id by mistake, the repository root as the first argument; the drop-if-stale and the prefix check on the received text are the host's (23d). The view half as built (M6 item 23c, D69): `host.ts` stamps the last delivered model's `seq`, 0 before any, and never invents one; it passes on only a `model` with a numeric `seq` and a `repos` array, from the page's own origin. |
| E80 | Narrow smartlog | At 260 px the tail shows only the PR mark and the age, the rest is tooltip; at 200 px only the PR mark; the name is ellipsised and the row stays one line; nothing overflows horizontally. As built (M6 item 23b, D68): the model gives `tooltip` as the facts in lines (`<branch> @ <sha7>`, `base: <parent> @ <sha7>`, git-spice's line, the PR's id and url, its title); the condensed tail is the `pr` indicator, when the row has one, and the age — a renderer finds it by `kind`, never by position — and what condensing moves into the tooltip the renderer appends from the same `indicators` list, no second source. |
| E81 | Both views, one state | After any refresh the smartlog and the graph show the same rows, indicators and checked-out row (one model object is posted to both); a command run from either view refreshes both. As built (M6 item 23b, D68): one `ModelMessage` per refresh, the same `repos` array for both views; a `StackViewModel` is plain data, so posting it twice is posting one object. |
| E76 | A stack branch was rewritten on the remote by someone else (GitHub's "Rebase stack" button, `gh stack sync`, a co-worker's force-push) — with and without unpushed local commits | Sync Stack detects it after fetch (`push.ahead > 0 && push.behind > 0`, or neither tip an ancestor of the other) and **adopts** the remote before any restack: no unpushed work → `git branch -f <b> origin/<b>`; unpushed work → `git rebase --onto origin/<b> origin/<b>@{1} <b>` after confirming; then `gs stack restack` is a no-op. Restack/submit **refuse** while a branch is diverged and unadopted; the banner names the branch. Never force-push over a diverged remote (git-spice's lease only protects a clone that has not fetched). Procedure verified 2026-09-20, §13.4. **The refusal half, as built (item 21a, D61):** `push` refuses before any spawn a layer whose fresh `gs log` line says `push.behind > 0` — `Nothing was pushed: <b> has commits on the remote that are not here. Bring them in first — a push would drop them.` — because the lease protects an unfetched clone only: measured 2026-10-09, after `git fetch` `stack submit --no-publish` overwrote a remote branch another clone had advanced (exit 0, `INF Pushed`), a diverged one too; unfetched, the same push is `! [rejected] … (stale info)` and the sentence quotes it. The predicate is `behind > 0`, wider than this row's "diverged" (`ahead > 0 && behind > 0`), because the strictly-behind case was overwritten as well; a branch deleted on the remote is `(stale info)` unfetched and simply re-created after `fetch --prune`. Adoption (the two procedures above) stays M9's; until then item 21b's README names them. |
| E82 | The built-in Git extension is disabled, or its `activate()` rejected, or `git.enabled` was false when the window opened, or it found no git | One message row per case (§7.14.3), no spawn of ours, status bar hidden, no crash. Git extension re-enabled from the Extensions view → `vscode.extensions.onDidChange` → the handshake runs again and the row goes, no reload. `git.enabled` false at window start and flipped on → the Git extension fires `onDidChangeEnablement(true)` and we recover without a reload (taking the API one tick later, §7.14.1); flipped off and on *while running* → no event: the repositories close and re-open through `onDidCloseRepository` / `onDidOpenRepository` (§7.14.3 row 3). Git not found → the row says a reload is needed; nothing else recovers it. Test: the adapter fed `undefined`, an `Extension` whose `activate()` rejects, and `Extension`s resolving to a fake `GitExtension` — one per §7.14.3 row, the injected `git.enabled` reader returning false / true, a fake `extensions.onDidChange` that flips `getExtension` from `undefined` to the fake and fires; each case asserts the exact row text. M6 item 23b (D68): the rows travel as `ModelMessage.notices` (`HostNotice`, texts the host's — §7.14.3 the single source); the model itself has no slot for them, no `RepoState` exists. |
| E83 | A ref moves without the working tree, the index or `HEAD` changing — `gs branch track` / `untrack`, `gs repo init`, `git branch -f`, `git update-ref`, `git tag`, `git push` of a branch other than HEAD's upstream — by a command of ours or in a terminal | The Git extension watches the working tree, the first level of `.git` and HEAD's upstream ref only, so `state.onDidChange` does not fire (probed 2026-09-26, table in §13.4 (k); git-spice's checkout / onto / restack / commit / sync commands and a push of the current branch *are* seen, §7.14.2). Every command of ours refreshes explicitly afterwards (§3 "Refresh"); for a silent one typed in a terminal the manual button is the recovery, and the README says so. Test: from M5, the fake runner records a refresh after each command. As built (D58): the setup flow refreshes after every fix that took, before the done line — `gs repo init` writes only `refs/spice/data`, which no watcher sees. The first command instance (item 20b, D60): `trackStack` refreshes exactly once in a `finally` — success, failure or refusal — once a repository was chosen; `ext/commands` counts `onDidChangeTreeData`. The same fact is why it re-loads the repository before acting: a `gs branch track` typed in a terminal is seen by no watcher, so the last load may be stale. The second command instance (item 21b, D62): `pushStack` refreshes once in a `finally`; `gs stack submit` also writes `.git/config` (the upstreams) on every run and `objects/` on the first, which the Git extension's watcher *does* see — a second, automatic refresh in a real window (none in the fixture: `git.autorefresh` off); the explicit refresh is still the rule. Item 22b pins the write set of `gs log`'s prune: `refs/spice/data` and loose `objects/` only — nothing at `.git`'s first level, so the watcher does not see it; the explicit refresh stands. |

---

## 9. Testing strategy

### 9.1 Layers

1. **Pure unit tests (Vitest, no git, no vscode)** — parsing and pure functions:
   `changes.ts` parsers (name-status `-z`, numstat, rename/copy scores), `uri.ts` round-trips,
   `stack.ts` ordering/parent assignment given a `FakeGitRunner` with canned outputs, `debounce.ts`.
   Target: **≥ 95 % line coverage of `src/core`**.
1b. **Renderer tests (Vitest with a DOM, `test/webview`, M6)** — `render(root, message)` from `src/webview/*` run
   under `happy-dom` (item 23c's decision by §11.3's table, D69 — the `webview` Vitest project): row count and order, lane geometry classes,
   tail glyphs per indicator, the E80 condensing at a given width, keyboard handling, and drag-and-drop by
   dispatching `dragstart`/`drop` events and asserting the posted message. No VS Code, no git.
2. **Git integration tests (Vitest, real `git`, temp repos, no vscode)** — every row of §8 that is
   about git state. Uses the fixture builder (§9.3). Hermetic: each test gets `fs.mkdtemp`, and the
   runner env sets `HOME=<tmp>`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`,
   `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, `commit.gpgsign=false` via `-c`; the three real-git-spice files (item 22b) also stub
   `GIT_EDITOR=true` — git would open an editor from any git-spice commit made without a message; the real-gh file (item
   23a, `git/gh.git`) stubs `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` (gh keeps extensions under its data directory — the
   "no gh-stack" half), `XDG_STATE_HOME` and `GH_CONFIG_DIR` explicitly (an exported one would win over `XDG_CONFIG_HOME`),
   points `DBUS_SESSION_BUS_ADDRESS` at a socket that does not exist (Linux's keyring), deletes `GH_TOKEN`, `GITHUB_TOKEN`,
   `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GH_HOST`, `GH_DEBUG`, `CI` and `GITHUB_ACTIONS` (under `CI=true` gh
   installs an official extension it is asked about — a developer's gh is what the rows pin), and empties `no_proxy`/`NO_PROXY` beside its
   dead proxy, so every machine is "not logged in, no gh-stack", no token reaches a pin (the fresh `HOME` is what keeps
   macOS's keychain out: for a host its empty hosts.yml does not know gh looks in the keyring first — measured) and no row
   reaches a host. Never touches the developer's real config.
3. **Extension-host tests (Mocha via `@vscode/test-electron`)** — launch VS Code with
   `--extensionDevelopmentPath` and a workspace pointing at a fixture repo (built in a `globalSetup`).
   Assert: extension activates; `provider.getChildren()` yields the expected layers and files;
   executing `prCascade.openDiff` opens a tab whose input is a diff with `stackdiff:` URIs
   (`vscode.window.tabGroups`); refresh command updates after an external `git commit`; a two-folder
   workspace whose folders are one repository (E1b, E2) shows it once. Keep these few and slow-tolerant; the bulk of coverage is layers 1–2.
   From M6 the same tests read the last model each webview provider posted (a test-mode-only handle,
   §13.4) instead of `getChildren()`.
   **From M4 (§7.14):** the tests reach the built-in Git extension the way the code does —
   `extensions.getExtension('vscode.git')`, `activate()`, `getAPI(1)`, then `api.state === 'initialized'` or
   one `onDidChangeState` — through one helper (`test/ext/helpers/gitApi.ts`, `realGitApi`: the adapter of
   `src/vscode/gitApi.ts` with its real host, the same objects `extension.ts` uses, so no test redoes the
   handshake by hand). After an external git command
   a test calls `await repository.status()` (the Git extension runs the status without waiting for window
   focus, whose value in a headless run is unverified — §13.4) and then awaits one `provider.onDidChangeTreeData`
   — our `refresh()` recomputes nothing, it only tells VS Code to re-ask `getChildren()`, so that event is the
   only sign our debounced handler ran; it never waits on `state.onDidChange` after `status()` resolved, because
   the event has already fired. The
   harness launches with `--disable-workspace-trust` and without `--disable-extensions`, so the Git extension
   is present and no trust prompt appears; the fixture's `.code-workspace` pins `git.autorefresh: false`, so the
   Git extension never runs a watcher-driven status of its own during a launch — whatever the window's focus —
   and no debounced refresh can land inside a later test (D49); the fixture lists the repository root as a folder, so no
   parent-folder prompt appears either (E1b). `.vscode-test/user-data` persists between runs, so no test may
   answer a Git-extension prompt: *Always* / *Never* write `git.openRepositoryInParentFolders` into that
   profile's user settings and would change every later run (*Yes* writes no setting but records
   `parentRepository:<root>` in the Git extension's `globalState` — VS Code's per-extension key-value store,
   which it calls a *memento* — as does *Always* for each parked root; those entries are harmless only because
   the fixture root is a fresh `mkdtemp` each run, so the key never matches again — an invariant to keep). Pin
   any `git.*` value a test needs
   in the fixture's `.code-workspace` `settings` block, never at runtime: the Git extension's scan is already
   running when the tests start.

4. **Opt-in end-to-end tests against a real github.com scratch repo (Vitest, `test/e2e`)** — skipped
   unless `PRCASCADE_E2E_REPO=owner/repo` (GitHub) / `PRCASCADE_E2E_GITLAB=group/project` (GitLab) is
   set and `gs auth status` succeeds. Creates a throwaway branch stack, runs the real backend, asserts
   the PRs/MRs exist with the right bases (and, on GitHub, the native Stack), then closes them and
   deletes the branches. This is the only place real `gs`/`gh` mutations are allowed. Use a dedicated personal scratch repo, never a work repo. Run manually
   before tagging a release; not part of `npm test`.

`activate()` must **return** `{ provider, refresh }` so extension-host tests can reach the tree
without poking at private state. (M4 item 14 adds `statusBar` and `treeView` as members under `ExtensionMode.Test`
only — D52, the §13.4 mechanism's first use. M6, item 23d: the tree provider goes away; keep `refresh`, and
expose the webview providers' last posted model only under `ExtensionMode.Test` — §13.4.)

### 9.2 Tooling / scripts

```
npm run typecheck   tsc --noEmit && tsc --noEmit -p tsconfig.webview.json   (M6 item 23c: the Node world, then src/webview +
                                                 test/webview under the DOM lib with no Node types)
npm run lint        eslint (incl. the two layering rules: no vscode in src/core; no vscode, no Node built-in, no core code,
                                                 no bare window global in src/webview — M6 item 23c)
npm run test:unit   vitest run test/unit
npm run test:git    vitest run test/git        (requires git ≥ 2.38 on PATH; and real git-spice when one is on PATH — three
                                                 files skip otherwise; PRCASCADE_REQUIRE_GS=1 makes their absence a failure, as
                                                 CI does; PRCASCADE_TEST_GS=<path> points them at another build — item 22b; and
                                                 the real gh when one is on PATH — one file skips otherwise; PRCASCADE_REQUIRE_GH=1
                                                 makes its absence a failure, as CI does — item 23a)
npm run test:webview   vitest run test/webview  (M6 item 23c: the views' code under happy-dom — the bridge and the plain-text
                                                 renderer now, the two renderers from 23e/23i)
npm run test:ext    vscode-test               (downloads VS Code; slow; needs xvfb on Linux CI)
npm run test:e2e    PRCASCADE_E2E_REPO=you/scratch vitest run test/e2e/github   (manual, real github.com)
npm run test:e2e:gitlab   PRCASCADE_E2E_GITLAB=you/scratch vitest run test/e2e/gitlab   (manual, real gitlab.com)
npm test            typecheck + lint + test:unit + test:webview + test:git (M6 item 23c)
npm run build       esbuild: src/extension.ts → dist/extension.js (node); M6 adds src/webview/smartlog/main.ts →
                                                 dist/webview/smartlog.js (browser IIFE, chrome114; item 23c) and graph/main.ts →
                                                 graph.js (item 23i), then copies @vscode/codicons' codicon.css + codicon.ttf beside
                                                 them; `--dist <dir>` moves every output (unit/build's seam)
npm run package     vsce package
npm run watch       esbuild --watch, both bundles — two contexts (dev loop, §11.2)
npm run analyze     esbuild --metafile + analyze: what each file contributes to both bundles, one table, one dist/meta.json (§11.3)
npm run depcheck -- <pkg>   prints the §11.3 dependency card (downloads, dates, maintainers, deps, size, license)
npm run fixture     build a fixture repo at ../fixture-repo for the Extension Development Host
```
Vitest config: `test/unit`, `test/git` and (M6 item 23c) `test/webview` (environment happy-dom) projects; coverage via `@vitest/coverage-v8` on `src/core`.

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
  commitOnTrunk(file: string, content: string): void;  // item 22b: one pushed trunk commit — a restack needed, or a conflict on the bottom layer's file
  addHook(name: string, script: string): string;       // item 22b: an executable git hook, its path returned
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
| `unit/stack.test.ts` | ordering by count, tie-break by name (E6), parent chain, `isCurrent`, detached (E3), zero layers (E5), fake runner failures (E17); rebase in progress (E12: the one `rev-parse --git-path` call pinned in the sequence, either directory, neither, a worktree's absolute path left alone — E19; the check is a `run`) |
| `unit/trunk.test.ts` | config wins → origin/HEAD → candidates → null (E4) |
| `unit/discovery.test.ts` | M1–M3 only: dedupe (E2), nested folder resolves (E1, with fake runner). Deleted in M4 item 12a together with `core/discovery.ts`, `git/discovery.git.test.ts` and `ext/scanSettings.test.ts` — discovery is the Git extension's (§7.14); E1/E1b/E2 move to `ext/gitApi.test.ts` |
| `unit/debounce.test.ts` | coalescing, trailing call |
| `unit/digest.test.ts` | M5 item 20a (D59), 6 tests, as built: `readRefDigest`'s argv (the three namespaces, object names only, never the contents of `refs/spice/data`) and verbatim return, E17 let through; `isInitialised`'s table (the line first or last, none, empty, the trailing space, the line start). The compare is a plain `===` on the text, in `unit/enrich`; HEAD is not an input (D59); M6 item 23b (D68), +5: `remoteBranches` — empty digest, the fixture's `{ HEAD, main }` (origin's `HEAD` among them, harmless — no branch can be named `HEAD`), a slashed name whole and one name on two remotes collapsed, a `refs/heads` line of the same name not counted, the trailing newline immaterial |
| `git/digest.git.test.ts` | M5 item 20a, 5 tests: the real `for-each-ref` on the fixture — the six lines and their order; `update-ref refs/spice/data` adds a last line and makes it initialised; a commit moves one line; a push adds a `refs/remotes` line; a checkout changes nothing (D59) |
| `unit/enrich.test.ts` | M5 item 20a (D59), 27 tests, both fakes: each line → `tracking` (the trunk line, the later of two lines, `status` kept); exactly one git command and two programs with their env and timeout; `gsPath`; the input never changed; a detached HEAD and a paused rebase enriched alike; no trunk / no layers → the same object, nothing run; not initialised → not enriched with zero programs run (§7.6; a `refs/spice/database` line does not count); gs missing / too old in readinessFix.ts's words, with the setting set and not (pinned against `offerFor`); every failure shape → `gs-log-failed` with the first `FTL ` line past the `INF` lines (a line merely mentioning FTL does not count), else the timeout even after some output, else the first line, `exited N`, the start failure, Node's detail; stderr beside exit 0 ignored; an incomplete answer leaves unlisted layers without the key, as new objects; the memo — one `gs log` for two loads, applied to today's layers, incompleteness remembered, a changed branch / remote ref / `refs/spice/data` re-running it, a failure never stored and never dropping what was stored, one memo per root; E17; +1 row in the failure table (item 21a: the git line appended after the `FTL`); M6 item 23b (D68): the fourteen `enriched` literals gain `byName` (a `Map` of the parsed lines, the later of two lines winning), `complete` (false beside a malformed line) and `remoteBranches` (the digest's bare names); the memo path carries the remembered `byName`/`complete` and today's `remoteBranches`; +2 — a second remote's branch in the set, and `byName` on a memo hit the same object |
| `unit/track.test.ts` | M5 item 20a (D59), 13 tests: `branch track` argv bottom→top with the trunk's local branch then each layer below, env and timeout, the one git question; a tracked layer, the trunk line and a not-enriched layer skipped yet used as bases; nothing run when nothing is `null`; `gsPath`; the stop at the first failure with git-spice's `FTL` line (INF lines first; no FTL; empty stderr; timeout; start failure); not initialised → a sentence and no program; gs missing / too old; the three trunk sentences (`missing` quoting `git branch <b> <trunk>` through `shellCommandLine`, `not-a-branch`, `none`); +1 row in the failure table (item 21a: the git line appended after the `FTL`) |
| `unit/push.test.ts` | M5 item 21a (D61), 23 tests: the one git question and two programs with env and the two timeouts in one assertion; `pushed` and `notes` from stderr (order; a `WRN` block, a CRLF on a pushed line, stdout ignored; the rename's two `INF` lines; nothing recognisable → `[]`); the constants whole (`GIT_TERMINAL_PROMPT=0`, both `--no-` flags, both timeouts); `gsPath`; the five refusals before any spawn that moves a ref (no layers; not initialised; `push.behind > 0` in any position — one, two, three names, a diverged layer too, and what never counts: no `push`, ahead only, `null`/absent tracking; gs missing/old/`dev` in readinessFix.ts's words; `needsRestack` in any position — one, two, three names, the located executable spelled and quoted; `null`/absent/trunk-line tracking never counting; behind before restack); the stale-info, cannot-lock-ref, no-remote, https-prompt, ssh, partial-push (`pushed: ['api-refactor']`, the `ERR` lines in `notes`), detached, timeout (`120000 ms`, pushed-so-far kept — what git-spice reported, not what landed), empty-stderr and never-started phrases; the appended line's rules (`stderr:`, `To <url>`, blank skipped; first match only; a git line before the first FTL ignored; the first line quoted as it is); the input unchanged; E17 |
| `unit/ghstatus.test.ts` | M5 item 23a (D65), 44 tests, fake runner: the three questions in cost order and the exact request of each (the env literal, cwd, 15 s); the banner table (the floor, `v`, a suffix, `DEV`); not gh — ENOENT, EACCES, `true`, an echo, another program, a timeout → both missing, one spawn; CRLF; an unusable directory rejects; gh-stack present / the hint / an old gh's unknown command / another program / a timeout → absent, the login unasked; both wrong listed gh first, the extension asked though gh is old; auth 0 (whatever it printed) / 1 / 4 / never started / timed out — the offline shape and the empty-default-token shape the same member, stderr unread (D65); `GitHub.COM` lower-cased in the flag and `GH_HOST`; the same host in the flag and `GH_HOST` on every `auth status` (a `*.github.com` remote); a GHE host carried through (E22); `ghPath` empty, blank, set, set to something that is not gh; the two token readers; `runGh` with a caller's timeout. The poll is `unit/poll`'s (D57) |
| `unit/version.test.ts` | M5 item 23a, 15 tests: the version helpers moved from `unit/readiness` with core/version.ts — `parseVersion`'s table, `isAtLeast` as numbers against 0.31.0 and 2.90.0 (`2.102.0` above, `2.89.9` below), `formatVersion` |
| `unit/prs.test.ts` | §7.7 planner as a pure function: given layers + status map + forge kind → ordered list of `{track[], push, create[], reassertBases, link?}` operations; E26–E31 as table-driven cases; per-entry draft flags; `link` present only for `github`; never plans a create for a layer with an open PR |
| `unit/prstatus.test.ts` | §7.8 JSON parsing → map by head; missing fields; empty list; malformed JSON → "no PR info" |
| `git/surgery.git.test.ts` | real fixture **through the backend (real `gs`)**: `squashMergeBottomIntoTrunk()` → sync → insert below → finish; assert graph + `git patch-id` stability (E48); middle insert (E49); cycle refusal (E53); conflict path leaves gs paused and the record kept (E52) |
| `ext/insert.test.ts` | phase 1 creates branch + pending node + status bar text; Finish refuses without commits (E50); chains Restack After Merge when stale (E51, fake runner); after Finish the PR pipeline is invoked with the expected create/fix operations; cancel (E54) |
| `ext/dragdrop.test.ts` | host side of E77: a `moveOnto` message from a view → confirm → `moveOnto(L, B)` exactly once (fake backend records argv); every E77 refusal produces no call; the picker command and the drop share one code path (the view side is in `webview/*`) |
| `unit/graph.test.ts` | M6 item 23a (D67), 110 tests, as built: the parsers — `parseRefs` (empty; one line to `{ name, sha, committedAt }` with the date a number; two names on one SHA kept in git's order; a slash and a non-ASCII name whole; the trailing newline immaterial), `parseDag` (empty; one parent; a merge's two; the fork parent that is no line; an orphan's none; order-independent — F8; CRLF never, git prints `\n`), `parseTrunkTip` (the one line; anything else thrown); `readGraphInput`'s three argv spelled in full and its texts verbatim, E17 let through; then the E78 table as `it.each` over object rows (primer §78) with hand-written refs/dag texts and readable SHAs, 44 shapes: one stack; two siblings (the bigger continues, the other on lane 1 with `joinsLane` on its lowest row); three siblings (the lane reused, never +2); a side child's own side child (lane 2 joining 1); deep nesting; a stack off a middle layer (pane B of `docs/view-lab.html`, fourteen rows, `part1` behind and still lane 0); the bigger side stack continuing while the checked-out one-row tip curves; trunk-only; no branches at all; the checked-out layer `filled`; detached (`head: null`) → nothing filled, no working-tree row; HEAD on trunk's tip, on a local trunk behind it, on a merged branch, on a branch with no commits yet → the trunk row `filled` and the `dashed` row directly above it with `parent` the branch HEAD is on; HEAD on an unborn branch → nothing; dirty with a checked-out layer that has children → the dashed row between them; dirty on trunk → `elided, dashed, trunk`; the stale stack straight when it is the bigger (lane 0 does not move on a fetch), side roots on the tip above side roots behind, every root behind → one elided row; E6 two names on one commit → a chain in name order; a merge from trunk's tip and from an older commit (depth counts the merge only; the forks decide the elided row); a merged branch no row (F5); the local trunk ahead a row (F3, D59); the bottom layer amended (E14) and the middle layer amended; a branch merged into another's deeper line (where computeStack's chain would differ); an orphan branch drawn as a stale stack with the elided row; `onlyStackOf` a middle layer (git-spice's stack — the line below, the subtree above, one lane), a root, a non-member (the trunk row alone), a tip (a sibling of its middle layer dropped); and the review's twelve rows — the parent tie between two equal-depth candidates by code point (`'alpha' > 'Zeta'`, where a locale says the reverse), the same with the walk meeting the greater name second, first-parent order never consulted, the three siblings and E6's chain with the refs text reversed, two side children under a layer in code-point order, a wide bush beating a taller chain, a dirty HEAD on a tied sibling (the working tree not counted), a merge from the tip inside a side stack (the tip key under trunk only), a hand-typed cycle terminating, a trunk tip that does not sort first among the forks; the invariant pass over every shape (one trunk row last; `lanes` = max + 1; every `joinsLane` = lane − 1; a lane opens only when no greater lane is open and every lower lane is live; parents drawn below; at most one filled, the dashed row directly above it naming `head`; every member a row exactly once); and the fields the table leaves out — a whole straight row by `toStrictEqual` (no `joinsLane` key), `sha`, `committedAt`, `isTip`, `forks` (sorted — the walk meets them the other way round — and deduplicated), dirty adds exactly one row, a checkout moves no lane |
| `git/graph.git.test.ts` | M6 item 23a, 20 tests: the three commands on the fixture, pinned by output equality against `fixture.git` of the exported argv (against the real runner nothing records argv) — `for-each-ref`'s one `<name> <sha> <unix date>` per branch in name order with trunk's local branch among them and the date `show -s --format=%ct`'s, `rev-list --parents`'s one line per commit above trunk and none for trunk's own, `rev-list -1`'s one `<sha> <date>` line; a tag named like a branch changes nothing (F7); `layoutGraph` over the real texts: the rail of the Appendix A stack with `side-fix` off the middle layer and `other-work` beside it (two lanes, `forks` = trunk's tip), agreement with `computeStack` for HEAD's stack — names, order, parents, depth = `commitCount`, by the projection of the rows computeStack names, never a climb — before and after `commitOnTrunk` (the elided row appears, no layer row moves, the DAG text is the same); HEAD on trunk (E5) filled; detached (E3) the same texts, nothing filled; two names on one commit (E6) one lane; a merged branch listed, lineless, no row (F5), and HEAD on it dirty → the trunk row filled with the dashed row above it naming it; a local trunk ahead a one-row stack beside the others (F3); the bottom layer amended (E14) as the unit row; the bottom layer squash-merged (E15) with the history elided; and a merge of two named lines (`fixture.git(['merge', …])`) laid out by depth where computeStack's count order chains differently — the one shape the agreement does not cover, pinned |
| `unit/viewmodel.test.ts` | M6 item 23b (D68), 111 tests, pure (23a's `refs`/`dag` builders and SHA constants copied; a fixture `RepoState` with `enrichment.byName` and a fixed `now`): pane B of `docs/view-lab.html` as one fourteen-row model and the same with no gh extras; the rows' geometry is `layoutGraph`'s unchanged (same inputs → the model's `kind`/`name`/`lane`/`node`/`joinsLane` project to the graph's rows, five shapes); one `it` per indicator kind from its source field with its negative — `untracked` (absent from a complete `byName`), `needsRestack` (`down.needsRestack`), `unresolved` (`change.comments.unresolved > 0`; 0 and absent → none), `baseDrift` (`extras.baseRef ≠ down.name`; equal → none; a root's `main` → none; E6's second name changes the tooltip's base and not the drift), `needsPush` (`push.ahead > 0`; `{ 0, 0, false }` → none; `{ 0, 1, true }` — strictly behind — → none), `neverPushed` (no remote-tracking branch of the name; a plain-pushed branch → none; untracked and unpushed → both; the push field never consulted), `pr` (`change` with `status` open/closed/merged, absent or unknown text → `unknown`, `extras.isDraft` → `draft` over open and unknown, never merged; `!12` kept as text; `reviewDecision` as the union or `null`; `title` or `null`; extras ignored without a `change`), `checks` (`extras.checks.failing > 0`; 0 and null → none), `behindTrunk` (the input; both 0 or null → none), `dirty` (`workingTreeFiles > 0`; 0 → no row); the fixed order with every indicator on one row; ages as an `it.each` table from a fixed `now` — 0 s and a future date `now`, 59 s, 60 s `1m`, 47 h 59 min `47h`, 48 h `2d`, 7 d `1w`, 30 d `4w`, 31 d `1mo`, 60 d `1mo`, 61 d `2mo`, 364 d `11mo`, 365 d `1y`, 730 d `2y`; the working-tree row (`parent`, `now`, `dirty { files }`, `<n> files changed on <parent>`); the trunk row's three tooltip lines; message rows for E3/E4/E5/E12 and their co-occurrence (rebase replaces detached; E5 beside E3 or E12; no trunk → the one row, `rows []`, `lanes 0`; a non-HEAD stack present → no E5); `showOnlyThisStack` → `onlyStackOf: head` while on a stack (pane B on `part3`: five rows, one lane), every stack on trunk or detached; a non-HEAD stack's row indicators through `byName`; unknown vs untracked vs tracked, git-spice's trunk line (`isTrunkLine`), no `enrichment` and `not-enriched` → no indicator anywhere, an incomplete answer's unlisted row the same; `dim` (untracked, merged); `tooltip` lines word for word with the tree's, the title as a fifth line; `context` per section; the input never mutated (`structuredClone` before, `toStrictEqual` after — a `Map` survives it where `JSON.stringify` would not); `graph: null` beside a trunk throws. `protocol.ts` has no test file: `npm run typecheck` is its test (D55's rule for `backend.ts`) |
| `unit/lint.test.ts` | M6 item 23c (D69), 7 tests: the two §4.1 lint rules through ESLint's API over the real config on in-memory probes at virtual paths — a `vscode` import under `src/core` refused, a Node import there allowed; under `src/webview` a `vscode` import, `node:fs`, `path`, `_http_agent`, a value and a namespace import from core each refused by rule id (in a `.mts` file too), an `import type` and an inline `type` import from core allowed, and all seventeen of `window`'s bare names refused in one line; under `src/vscode` `vscode` and under `test/webview` a Node import allowed. The core rule's first test since M1 |
| `unit/build.test.ts` | M6 item 23c (D69), 5 tests: §4.1's "the browser bundle carries no host code" on the bundle itself — `node esbuild.mjs --dist <tmp>` run for real, then the listing (the host bundle, one IIFE per view, a map beside each, the two codicon files), the IIFE wrapper, `"use strict"` first in both bundles, every `// src/…` input comment under `src/webview/` and none of them protocol.ts, no `require(` in the view beside `require("vscode")` in the host, the stylesheet naming the font by its relative path |
| `unit/vsix.test.ts` | M6 item 23c (D69), 1 test: `vsce ls --no-dependencies` — exactly five root files (`package.json`, README, CHANGELOG, LICENSE, `THIRD-PARTY-NOTICES.md`), everything else under `dist/`, no `.map` (a half that holds only on a built tree, so the `**/*.map` and `dist/meta.json` lines are pinned in .vscodeignore's text as well); the pin for ".vscodeignore names root tooling files one by one, so a new root file ships unless named" |
| `webview/host.test.ts` | M6 item 23c (D69), 7 tests, happy-dom: `acquireVsCodeApi` called once; two models delivered in order; another `type` with every field a model has, no data, a string, `null`, a `model` without `seq` or `repos`, one whose `repos` is not an array ignored in silence — one probe per clause; `postCommand` posts `{ type: 'command', seq, command, args }` with the last model's `seq`, 0 before any (E79's view half), an unrecognised message moves it not at all, and a model posted from another origin is neither delivered nor counted (only the page's own origin carries the host's posts) |
| `webview/render.test.ts` | M6 item 23c (D69), 5 tests: one text line per row in the model's order (node glyph, name, indicator kinds, age; the working-tree and elided rows), each a `<div>`, notices then message rows then rows, a root line only for several repositories with the notices once before them all, a second render replacing the first, markup in a name arriving as text (§7.1.3 Security) |
| `webview/smartlog.test.ts` | From 23e (23c's `render.ts` is rewritten in place): `render(model)` → rows, lanes, tail glyphs; E80 at 260/200 px; ↑/↓/Enter; the `data-vscode-context` JSON per row; `dragstart`/`drop` posts `moveOnto` with (L, B) and nothing for the refusals decided in the view (file rows, trunk as source) |
| `webview/graph.test.ts` | `render(model)` → diamonds, circles, pills; files under the checked-out row; trunk-commit rows capped at 50; the same context and drag assertions |
| `ext/views.test.ts` | both providers resolve and receive the same model after `refresh` (E81); a posted command runs the registered command with the row name (fake runner records argv); a stale `seq` is ignored and a non-`prCascade.` command id is rejected (E79); hidden → visible re-posts the model |
| `unit/gsLog.test.ts` | §7.13.2 stream parsing: the real 0.31.2 lines (a branch with a PR, the trunk line with no `down`, the current branch), minimal objects, `--cr-status`'s `status` kept as text and, since M6 item 23b (D68), `comments { resolved, unresolved, total }` kept too (absent stays absent; a count that is not a number makes the line malformed), unknown fields tolerated, the documented fields nothing reads dropped (D55), malformed line isolated (E57) — not JSON, not an object (incl. `[]` and `null`), each field with the wrong type, one problem per line naming the path and the 1-based line, no entry kept for a bad line — CRLF, blank lines, empty output, never throws |
| `unit/readiness.test.ts` | every `Readiness` member of §7.13.1 in probe order (gs → initialised → forge → auth → gh on GitHub, item 23a) against FakeGitRunner and FakeCommandRunner (E17, E21, E22, E23, E24, E25, E55, E59, E60, E62, E62b, E67, E70, E75), 77 tests since item 23a: every way a candidate fails to answer as git-spice (ENOENT, EACCES, Ghostscript's two answers, an empty or echoing program, a timeout) moves to the next name; `prCascade.gsPath` set → only that name; the version table (floor, `v`, suffixes, `dev`, two numbers — the helpers' own rows moved to `unit/version` in item 23a); the exact argv/env/cwd/timeout of every spawn and the exact git commands, incl. the happy path's whole list — eight on GitHub, five on GitLab; the step-5 rows: a GitLab remote spawning no gh, gh missing / too old / the extension missing / both, not logged in and the offline shape, step 4 and the forge step before step 5, E22 with two roots and two hosts (github.com beside ssh.github.com, each root's `GH_HOST` and `--hostname` its own), a capitalised host lower-cased in the flag, `ghPath` as the fourth argument, an unusable directory; the memo (a `ready` remembered, a failure not — neither gh member either, and no gh spawned the second time — another remote and another root as new questions; `forget` drops exactly one remembered `ready` and the next question finds a logout, git-spice's or gh's — item 19a, 23a); E17 and an unusable root propagate |
| `unit/command.test.ts` | the FakeCommandRunner contract (as `unit/git` is FakeGitRunner's): records whole requests, answers canned results, `answerIn` per directory, throws naming the command and the canned keys; the three result builders |
| `git/command.git.test.ts` | RealCommandRunner over real processes: exit 0 and stdout, a non-zero exit resolved (never rejected), the request's env laid over the caller's, stdin closed (a program reading it does not wait), a timeout kills and says so, the three start failures (missing executable, a directory as executable, a missing or non-directory cwd). Item 22a, +10: a multi-byte character kept whole across a chunk boundary; the process-group kill — a Node grandchild gone after the timeout; SIGKILL after the grace for a program ignoring SIGTERM, the line it wrote on the signal kept; the one-pid control leaving the grandchild alive; exit 7 on SIGTERM kept beside `timedOut`; the 32 MB ceiling with the program stopped (`output exceeded 32 MB`); a foreign signal named (`killed by SIGINT`); a descendant that left the group but kept the pipes not holding the result (the pipes are destroyed after the SIGKILL, not before the SIGTERM — elapsed ≥ 1 200 ms); a SIGTERM-trapping grandchild of a program that died on the SIGTERM, reached by the SIGKILL timer that outlives `close`; no timer queued once a result is in |
| `git/readiness.git.test.ts` | the probe's git side on the fixture: `refs/spice/data` absent → `not-initialized`; `git update-ref refs/spice/data HEAD` (what `gs repo init` writes) → past step 2 to the real detectForge (`remote-unparseable` for the bare origin); the ref deleted → `not-initialized` again (a failure is not remembered); git-spice faked here; the real one runs in `git/gitspice.git` (item 22b) |
| `unit/shell.test.ts` | M5 item 19a (D57), 37 tests: `shellQuote` leaves `[A-Za-z0-9_./:=@%+,-]` words bare (11, `my_branch` among them) and quotes everything else — a space (a path), `$`, `!`, `;`/`&&`/`\|`/backquote, a glob, `"`, a leading `=` (zsh EQUALS; `a=b` stays bare), non-ASCII, the empty string as `''`, and a table of twelve the bare list must never admit (`~`, `#`, `?`, `[…]`, `{…}`, `\`, `(…)`, `>`, `^`, tab, newline); a single quote inside as `'\''`, every one; `shellCommandLine` joins with one space, quotes a path with a space, `[]` → `''`. Every expected line was also run through sh, bash and zsh by hand, and by a reviewer through dash and ksh and an interactive bash and zsh in a pty |
| `unit/poll.test.ts` | M5 item 19a, 20 tests: `waitUntil` on fake timers — `DEFAULT_POLL` 3 s / 5 min; no question before the first interval; done at the first yes and no question after it; exactly 100 questions in 5 min, the last at 5 min; a timeout shorter than an interval still asks once; an hour's jump of the clock (`vi.setSystemTime`) uses up nothing; intervals of 0, −1, `NaN` and `Infinity` refused before any question; aborted before it begins (nothing asked), mid-sleep (timer cleared), while a question is out (a yes still counts, a no stops it); a rejecting check rejects and nothing more is asked; no abort listener left on the signal after ten sleeps. `sleep`: on time, at once when already aborted, timer cleared on abort |
| `unit/readinessFix.test.ts` | M5 item 19a, 55 tests; the first case of each member compares the whole offer (messages are behaviour), the rest pin the field they are about — gs-missing ×7 (brew by its full path, an Intel brew, Homebrew's git-spice out of VS Code's PATH, no brew, setting set, setting blank, the install-page URL), gs-too-old ×7 (`brew upgrade` only for Homebrew's git-spice, by name or by path; another install, another path set by hand, a `gs`, no brew, `dev` → the install page), not-initialized ×6 (`command <gs> repo init`, a trunk with a slash, missing — with the command quoted for a shell — not-a-branch, none), no-remote, remote-unparseable, forge-unrecognized ×14 (E60; E70 for `*.ghe.com`, a displaced github.com, a port, the fallback for another GitHub host, a non-URL key, capitals, `ssh.github.com`, `SSH.GitHub.com`, GitLab's spelling — each with its `apiUrl`; an explicit kind ×2; the rejected kind first, before E70 and before E60), forge-unsupported ×4, not-logged-in ×3 (`env -u` per forge; a forge with no token variable), gh-missing ×13 (item 23b: Homebrew by its full path, the page, the setting, Homebrew's gh out of VS Code's PATH, a blank setting, upgrade by name and by path, a too-old gh by name while Homebrew has no gh — the page, another gh by hand, an unreadable version, the extension's install with the gh that answered, gh before its extension — item 23a had the three 19a rows with `ghPath`), gh-not-logged-in ×6 (item 23b: the whole offer, the protocol, the gh, the spelling kept, the pair per host class, `ghTokenVariables` as a table — item 23a had one interim row), `readyMessage` ×2 (with and without gh — item 23a); 72 tests since 23b; `trunkBranchFor` over FakeGitRunner — none (no git asked), local, remote-tracking with and without its local branch (both questions in the root), a fork's trunk on another remote, tag, commit, unknown name |
| `git/trunkBranch.git.test.ts` | M5 item 19a, 9 tests: `trunkBranchFor` on the fixture with real git — `main`, `origin/main` and `origin/HEAD` → local `main`; a tag, a commit, an ambiguous name (a local branch named `origin/main`), `--all` (refused under `--verify` either way — `--end-of-options` is defence in depth, pinned by the unit test's exact arguments) and an unknown name → not-a-branch; `origin/main` with the local `main` deleted → missing |
| `unit/forge.test.ts` | every URL form (E21, E65): ssh, scp-like (with and without a user, and the `github.com:org/repo.git` form `new URL` would misread), `git+ssh`, `git`, https, ports, `user@`, credentials, no `.git`, trailing slash, query/fragment, GitLab subgroups, Azure's three forms; `null` for a local path, `file:`, a Windows drive, a scp-like IPv6 literal, one segment, an empty segment, garbage; the host's spelling and port kept; `parseForgeConfig` (the `key value` lines as git prints them: `apiurl` and `bitbucket.kind` ignored, last value wins, a non-URL ignored, a mixed-case subsection ignored, `spice.forge.kind` of git-spice's five ids only with a rejected value reported, CRLF); `classifyHost` in its documented order (a rejected kind → kind, as git-spice does → each kind's base host, configured or default, matched as git-spice matches: subdomain yes, bare suffix no, case- and port-sensitive, a url key displacing its default → the extension's guesses → unknown), the tie-breaks pinned where git-spice itself is random, and `recognizedByGitSpice` (E60/E70's inputs); `ghEnv()` sets `GH_HOST` and nothing else (E22); `detectForge` with the fake: the two argv rows at the root, no-remote and unparseable stop after one command, `prCascade.remote` honoured, E17 rejects |
| `ext/nativeStack.test.ts` | fake runner: `gh stack link` argv is branch names bottom→top with `GH_HOST`; stack number parsed and recorded; re-link after insert uses the full new order (E72); relink idempotent (E73); refuses createPRs on GitHub when gh/gh-stack missing (E62b); never runs on GitLab (E74) |
| `ext/backend-gitspice.test.ts` | fake runner: exact argv + env for every §7.13.3 row; `--no-prompt` on every call; track-before-mutate ordering (E56); conflict pause → banner (E58); mixed drafts (E61); merge method selection; never reads `refs/spice/data`. As built (D56, D59): the backend is core, so the argv of each §7.13.3 row is pinned in the unit tests of the PR that implements it — `unit/readiness` (item 18), `unit/enrich` and `unit/track` (item 20a) — against `FakeCommandRunner`; this row names the live wiring checks that remain for the extension host (`ext/tree`, `ext/commands`, items 20b–21) |
| `git/gitspice.git.test.ts` | **real `gs` against the fixture, offline** (git-spice needs no network for local ops): `repo init`, `branch track`, `log short --json` schema, `upstack restack` after amending the bottom (patch-ids stable), `branch onto`, `branch create --below --no-commit` + commit + restack (E48/E49 graph assertions), conflict pause + `rebase continue`. Skipped with a clear message if `gs` is not installed; CI installs it. M5 item 22 adds the §13.4 (k) pin: `log short --json` (and `--cr-status`, which against a local bare origin takes the no-forge path) change no file under `.git` at any depth — mtime/inode snapshot before and after — **on a fixture whose tracked branches all exist**: `gs log` prunes a tracked branch deleted out of band and moves `refs/spice/data` doing so (D59, verified 2026-10-08), so that case is a second pin, not a failure of the first. **As built (item 22b, D64): three files.** This one, 16 tests through `GitSpiceBackend` on one fixture in story order: readiness before and after `repo init` (E21 after); enrich not-initialised with no spawn, then `[null, null, null]`; `gs log` on the uninitialised repository exits 1 and writes nothing; `repo init` adds exactly the data-ref line, idempotent; track ×3 with `main` as the first base, the raw lines by name (sorted — three exact objects), track again nothing; the (k) pin over `log short`, `--cr-status` and `log long` (snapshot `[]` and digest byte-identical); the memo; push ×3 (origin heads, upstreams, `pushed`, `notes: []`, again the same, `push {0,0,false}`); the detached push's sentence; a pushed trunk commit → `needsRestack`, the refusal with no spawn, `stack restack`'s three lines; the second (k) pin (`branch -D add-retries` while on `retry-metrics`: `refs/spice/data` + `objects/` only, the next run `[]`); HOME and XDG empty. `upstack restack`, `branch onto`, `create --below` and the conflict pause moved to `git/gitspiceOps.git`; the exit codes and the rename to `git/gitspiceFacts.git` M6 item 23b (D68): the two `enriched` literals gain `byName`, `complete` and `remoteBranches` (the fixture's `{ HEAD, main }`); +2 — the view model over the real answer and the real digest, after init (every layer `untracked` and ⛅, dim) and after the push (no indicator anywhere, the bases as git-spice names them). |
| `git/gitspiceFacts.git.test.ts` | M5 item 22b, 17 tests, git-spice run directly through `runGitSpice` (the spawn production makes): the `PRCASCADE_REQUIRE_GS=1` test (a missing git-spice is a named failure on CI, a skip elsewhere); an `it.each` table of eleven rows — unknown command and flag are exit 1, a missing branch, a missing base, the trunk, an idempotent re-track (0), continue/abort with nothing paused, restack with nothing to do (0), `--dry-run` (0), create with nothing staged — each asserting the exit, the stderr line and that the exit is 0 or 1 (§12 item 7); outside a repository (`FTL git-spice: exit status 128`); `init --trunk nope` (E59); the `<name>-2` fixture: no `push` field before any submit, then three pushed, exactly two notes, `branch.api-refactor.merge` = `refs/heads/api-refactor-2` (item 26's RED); the kill fixture: a pre-push hook running Node for 3 s and a 1.5 s limit through `GS_SUBMIT_ARGS` → `timedOut`, the origin without the branch at return and 3 s later, the hook never finishing, no upstream recorded, the next push clean (§9.6 (b)'s push row; D63) |
| `git/gitspiceOps.git.test.ts` | M5 item 22b, 10 tests, M9's facts: no `rebase-continue` before any pause; `stack restack` into a conflict — the five `ERR` lines and the FTL, git's `rebase-merge` with `head-name` = the layer being rebased (D50), `refs/spice/data:rebase-continue` naming the command and the branch (a fact, §3 forbids production reading it), no `.git/spice`, `computeStack` with no layers; during the pause `gs log` 0 with no `current`, `branch track` works, `push` sees no layers, continue unresolved 1 with git's `needs merge` on stdout; resolve + continue (`GIT_EDITOR=true`) → the upstack restacked, HEAD back, `continuations: null`; git-spice's own pause ended by `gs rebase abort` (exit 0, HEAD left on the layer git was rebasing — not where the restack began — `continuations: null`, a data commit "git-spice rebase abort"); a plain git pause on the bottom layer (`continuations` null — the discriminator) ended by `gs rebase abort` with no data commit; a plain pause resolved by `gs rebase continue` — HEAD back, no data commit of its own, the next `gs log` recording "restacked externally", the upstack *not* restacked until `upstack restack`; amend the bottom (E14: the stack from HEAD drops it, `needsRestack` above, `upstack restack` restores it with patch-ids stable); `branch create fix --below --no-commit` + commit + `upstack restack` (E49's graph, `a`'s sha untouched); `branch onto main` from the top and its two exit-1 lines |
| `git/gh.git.test.ts` | M5 item 23a (D65), 17 tests, the real gh hermetically (an empty config, data and state directory, the token variables and GH_HOST deleted; every `auth status` and `auth login` row through a dead proxy): the `PRCASCADE_REQUIRE_GH=1` test; the banner's two lines and `ghVersionToken`; the floor met on this machine (a runner image drifting below 2.90 fails by name); `stack --version` absent — exit 1, stdout empty, the three-line hint — and the reader; `ghReadiness` whole → `gh-missing` listing the extension; `extension list` exit 4 without a login and no GH_HOST, 0 with GH_HOST (the reason it is not asked); `auth status` exit 1 both ways for a host with no account — the generic sentence a bare call gets, the empty-default-token validation the probe's own GH_HOST provokes — for github.com and a GHE host; the offline shape with a bogus GH_TOKEN (exit 1, `X Failed to log in … The token in GH_TOKEN is invalid.` — D65's ambiguity as a fact); `auth login` refused with each of the four token variables for its host class, writing nothing, and not refused by the github.com pair for an Enterprise host — gh goes to that host's device-code URL (the reason for a pair per host); the three directories still empty. Skipped when gh is not on PATH; CI requires it; no install step (the runner images ship gh) |
| `e2e/gitspice.github.e2e.test.ts` | opt-in scratch repo on github.com: createPRs with mixed drafts → PRs with correct bases, titles/bodies from the plan → native link (E68: badge + map) → `markStackReady` → all ready → re-run createPRs → nothing created → `gs branch merge --method squash` bottom → `sync` → bases retargeted, native map agrees (E71) → insert below → finish → cleanup; plus a `.git` snapshot around one `gs log short --json --cr-status` against the scratch repo (the §13.4 (k) pin for the forge path) |
| `e2e/gitspice.gitlab.e2e.test.ts` | scratch project on gitlab.com (`PRCASCADE_E2E_GITLAB=group/project`): same flow minus native link; asserts GitLab's stack detection via the MR API (E66, E74). **Required before a release** — GitLab is a supported forge, so Ric needs a gitlab.com account for this. |
| `ext/markReady.test.ts` | fake runner: E45–E47; confirm dialog cancel → no calls; ordering asserted |
| `ext/createStackPRs.test.ts` | fake runner records argv sequence; asserts exact order (`track` → `submit --no-publish` → `branch submit` ×N → `gh stack link` on github only) and env (`--no-prompt`; `GH_HOST` on the link); mid-sequence failure stops and reports (E29); re-run is idempotent; cancel between steps; login flow then continue (E32) — never calls real `gs`/`gh` |
| `unit/prdraft.test.ts` | draft generation from commit lists: 1 commit vs N; title source setting; template appended; E33, E34, E38 |
| `unit/prplan.test.ts` | `Draft:` yes/no/true/false/missing/malformed (E42, E43); render → parse round-trip; user edits (extra blank lines, no `Title:`, deleted section, CRLF, unicode); existing sections ignored; unknown header → error; E35, E36, E39, E41 |
| `unit/template.test.ts` | mirrors git-spice's template discovery for *display* in the plan doc (`spice.submit.template`, `.github/PULL_REQUEST_TEMPLATE*`, GitLab `.gitlab/merge_request_templates/`); when unsure the doc says "git-spice will apply the repo template" rather than guessing |
| `ext/prplan.test.ts` | command opens a `prcascade-prplan` document with the expected sections; CodeLens present; running it calls the runner with parsed `--title` and a `--body` argument equal to the edited body; drafts persisted to `workspaceState` and restored (E40); cancel closes without calls |
| `ext/login.test.ts` | M5 item 19b (D58), 7 tests, through `executeCommand('prCascade.setUpGitSpice')` on the fixture with a FakeCommandRunner and a fake host put into the `readinessDeps` handle (`ExtensionMode.Test` only) and a 50 ms poll: registered; not initialised → `Initialise` → `cd <root> && command git-spice repo init --trunk main --remote origin` typed into `PR Cascade: repo` → the test writes `refs/spice/data` → one tree refresh → "git-spice initialised in repo." → the E21 sentence for the bare origin, `not-ready`; with a github.com remote and `prCascade.remote` set, not logged in → `Log in` → `cd <root> && env -u GITHUB_TOKEN git-spice auth login --forge github` → the fake flips to logged in → one refresh → "Logged in to github.com." → "git-spice 0.31.2 is ready for repo (github.com).", `acted`, `auth status` asked at least twice and `auth login` never run by us; a second click while the fix runs → `in-flight`, no second terminal or line; ready by hand, then after a fake logout the login offer (the memo forgotten); a changed `prCascade.gsPath` runs the program it names (a new backend); VS Code's real terminals reused by name and directory. Every case ends its flow before restoring the fixture. Since item 20b the fake cans `gs log` too: the refresh after the init fix enriches through it. Item 23a cans gh's three questions in the fake (every GitHub row reaches step 5, through the one runner the backend is built from) and the ready line names gh — "git-spice 0.31.2 and gh 2.102.0 are ready for repo (github.com)."; item 23b +5: gh-stack install then gh login in one terminal (two lines, two refreshes, five notifications, every gh spawn's cwd, GH_HOST, prompt variable and timeout); gh missing with Homebrew scripted, waiting for gh to answer, then the extension's offer; a changed `prCascade.ghPath` as a new backend; both settings on the login line; a GitLab repository spawning no gh. `test:ext` 130 → 135. |
| `unit/terminal.test.ts` | M5 item 19b, 12 tests: `terminalName`; `runInTerminal` makes a terminal at the root, types `cd <root> && <command>` as one quoted line with Enter and shows it taking the focus; the `cd` quoted for a root with a space; reuses a live terminal of that name and directory, the first of two; a new one when the old shell has exited or the caller says not to use it; not another name's, nor one with no directory; two repositories with one folder name kept apart; a directory held as a `Uri` read by its `fsPath` |
| `unit/login.test.ts` | M5 item 19b, 75 tests on fake timers (59 at 19b; items 20b and 23a added one each, 23b fourteen: a gh install counted done at the too-old step and at the extension step — the three steps inside `gh-missing` — a gh-stack install at gh's login, a gh login at ready; Homebrew's gh ending an install's wait and not an upgrade's nor the extension's; a step gone backwards; a stale Install with Homebrew running nothing once gh is there, the look-again telling the steps apart; the protocol on the login line, run by the gh that answered; `prCascade.ghPath` named when set, Homebrew's gh named when VS Code did not find gh; git-spice's login then gh's in one terminal; `machineFacts` with `brewGh`): ready → the action at once, and `acted` only once the action has finished; a closed offer → `not-ready`, nothing asked of git; a button-less offer shown in its colour and not awaited; the login flow step by step (a look again at the click, the line in `PR Cascade: repo`, no question before 3 s, one refresh, the done line, the action, the close listener let go); the 5-minute timeout (102 probes, one log line, asked afresh next time into a new terminal); the terminal closed with and without a login in its last seconds; another terminal's close ignored; what counts as passed (a stale click runs nothing; a stale Initialise never re-initialises; a step that went backwards is not a pass; Homebrew's git-spice appearing is); a second click → `in-flight`; a notification held open blocks nothing; two repositories; init then login in one terminal (two refreshes, the trunk asked of git once); a `git config` fix with no wait and the probe only after git returned; Homebrew install by its full path; the install page — waited for, declined (`gave-up` at once), opened again for a second click; how far the probe got (an upgrade, an install that finds it too old, an init reaching the forge step, a login reaching gh — and, item 23a, a git-spice login counted done when the probe reaches gh's login step — and a login falling back, and Homebrew's git-spice ending only an install's wait); ten passes allowed and a six-pass chain acts; the ten-pass guard; what the offer is told (the remote, the setting, Homebrew's git-spice, the machine read again); a rejecting probe before and during a wait, a browser that cannot open; the window closing during the first probe, at the click, during the look again, while the page opens, during a `git config`, during the last look, during a wait, and before any; a terminal set aside after a failed probe; the host and the poll read at every use; `chooseRepository` ×6; `machineFacts` ×6 |
| `git/remote.git.test.ts` | fixture with no remote (E25) → `no-remote`; the bare origin (a local path) → `unparseable` with its path; a second remote selected by `prCascade.remote`; `url.<base>.insteadOf` applied by `remote get-url`, `pushInsteadOf` not; `spice.forge.gitlab.url`, `spice.forge.github.url` and `spice.forge.kind` written by `git config` and read back through a real `--get-regexp`; `*.ghe.com` unrecognised until configured (E70), still unrecognised when the remote spells it in capitals, and github.com unrecognised while the url key names another host; a rejected `spice.forge.kind`; a remote name that does not exist → `no-remote`; the runner's environment made hermetic with `vi.stubEnv` |
| `git/stack.git.test.ts` | real 3-layer fixture: layers, order, parents, counts; E3, E5, E6, E14, E15, E16, E19 |
| `git/changes.git.test.ts` | real diffs: E7, E8, E9, E10, E11, E18 (generate 1500 files) |
| `git/rebase.git.test.ts` | E12 detection via `--git-path`; worktree variant (E19) — stays in M4: the Git extension cannot see a rebase in a linked worktree (§7.14); add the pause points its `REBASE_HEAD` misses even in the main worktree — interactive `break`, a failed `exec`, `git am` — so the directory check is shown to cover them |
| `git/trunk.git.test.ts` | origin/HEAD present/absent; master-only repo; no remote |
| `ext/activate.test.ts` | activates, view registered, provider returned |
| `ext/menus.test.ts` | `package.json` menus parsed: exactly two `navigation` items in `view/title`; every other title item has a group from §7.2.1; every `view/item/context` item's `when` references a known `contextValue`; every command in menus is registered on activation; layer `contextValue` matches spec for each state (no PR / PR / draft PR × current or not) |
| `ext/statusbar.test.ts` | live, through the `statusBar` handle `activate()` returns under `ExtensionMode.Test` (§13.4): text is `$(layers) <branch> · n of N` on each layer (E44 — `add-retries · 2 of 2` on the middle layer, the one above drops out under HEAD-only membership, §12 item 2); `$(layers) not on a stack` on trunk (E5); hidden while `prCascade.statusBar` is false and back at the next refresh; hidden when the load fails (E17); the item keeping up while the view is hidden (the Explorer brought up through `treeView.onDidChangeVisibility`, then `refresh()` and one `onDidLoadStates`); click = `prCascade.focus`. With a stand-in item, `src/vscode/statusbar.ts` imported directly (the `ext/gitApi` pattern): hidden with no repo (`[]`), hidden while off, the first repository with several (D52), `2 of 3` from a three-layer state, E6's `1 of 2`, `not on a stack` for E3/E4, tooltip = root, name and command set once, dispose |
| `ext/tree.test.ts` | every layer label equals its branch name, no SHA in any label (E44); children match fixture; nested-repo workspace (E1b); refresh after external commit (E20 — `await repository.status()`, then await one `provider.onDidChangeTreeData` — one, not a count, because the event also fires for the initial status of any repository the Git extension opens during the run — then `getChildren()`; never calls refresh itself; with a deadline so the `finally` that restores the fixture runs even when the wiring is missing); the E3 and E12 rows above the layers, by exact text and icon, the repository restored in `finally` (`checkout retry-metrics`, `rebase --abort`); the E56/E57 block (item 20b, 6): the texts in their order, the vocabulary with a pull request, the tooltips' extra lines, zero spawns while not initialised, nothing when git-spice is missing or `gs log` fails, the digest live (one `gs log` for two loads, one more after `refs/spice/data` moved, none for a checkout) — the fake runner installed before the ref is written, everything undone in `finally` |
| `ext/gitApi.test.ts` | M4 (§7.14). With the real Git extension: the handshake yields exactly the fixture repository — two folders, one root, no prompt (E1b, E2 delegated); a second repository folder appended at runtime sorts after `<repo>` (whose lowest folder index is 0) and a folder reorder → one refresh with no open/close event; `onDidOpenRepository` / `onDidCloseRepository` → refresh (the live `state.onDidChange` → refresh chain is asserted once, as E20 in `ext/tree` — D49; not repeated here). **E1 delegated** needs the §1 layout present at launch (the depth-1 scan runs in the initial scan only, §8 E1): a second `defineConfig` entry in `.vscode-test.mjs` (the CLI accepts an array, each with its own `files` and `workspaceFolder`) opens a workspace whose one folder is a plain `parent/` (fresh `mkdtemp`, not a repository) with a fixture repository one level below and another two levels below — after `initialized` the API holds exactly the one-level repository with no setting of ours and the tree shows its stack; the two-level one is absent at the default depth; removing the folder is not asserted to close it (the Git extension disposes only the repository that contains a removed folder). With fakes, importing `src/vscode/gitApi` directly (§7.14.1): the status relay — a fake `Repository`'s `state.onDidChange` → one `onDidRunStatus` each, for repositories open at the handshake and for one opened later, none for one closed, none after dispose (the coalescing itself is `unit/debounce`'s: the adapter relays, `extension.ts` debounces — D49); the E82 rows — `getExtension` result `undefined`, an `Extension` whose `activate()` rejects, `Extension`s resolving to a fake `GitExtension` with `enabled: false` and the injected `git.enabled` reader returning false / true (no setting written), `getAPI` throwing `Git model not found`, `onDidChangeEnablement(true)` → recovery, a fake `extensions.onDidChange` flipping `getExtension` from `undefined` to the fake → recovery — each asserting the exact §7.14.3 row text; `gitExecutable('', apiPath)` → `apiPath`, `gitExecutable(setting, apiPath)` → `setting` (the runner's own argv[0] is not observable through `{ provider, refresh }`; the non-empty branch is exercised end to end by `ext/tree`'s E17 tests, which keep passing) |
| `ext/diff.test.ts` | openDiff opens a diff tab with `stackdiff:` URIs; content provider returns file text; added file → empty left |
| `ext/commands.test.ts` | checkout refuses on dirty tree (E13 — with `prCascade.checkout`, which no M5 item builds); pushStack refuses during rebase (E12, item 21) — assert message, don't actually push; from M5 every command of ours is followed by exactly one explicit refresh (E83). As built (item 20b, D60), its first rows, 10: registered + the manifest entry word for word, bottom→top with one refresh and the sentence, the fresh load not the last one, nothing untracked, not initialised (a warning naming the setup command), a failure mid-way still refreshing once, not on a stack anywhere, nothing loaded, the stack emptied before the click, a paused rebase refused (E12's sentence); every case drains its own refresh through `onDidLoadStates` before its `finally`. Item 21b (D62), +17: registered + the entry with `enablement` compared against `contextKeys.ts` (and the 20b entry's new `enablement`); all tracked → one submit at 120 s with both `--no-` flags, nothing tracked, no `auth`, the bare origin unchanged (`ls-remote`); untracked → three tracks then the submit; a track failure → no submit; E12 refused with no submit; `needsRestack` refused; `push.behind` refused (E76); a rejected push's phrase with git's line; not initialised (one refresh — a root was chosen); nothing loaded / no layers (no refresh); emptied between load and click; a detached HEAD; one branch (the singular); git-spice's notes and the sentence's tail; a second click while pushing (`SlowRunner`, its gate opened in the `finally`); the pick with a second repository (no refresh before a root is chosen) |

Milestones 5–8: every `gs`/`gh` invocation is asserted by injecting a fake runner/terminal and checking
the exact argv and env; unit and extension-host tests never call the real tools. Only `git/gitspice.git`
(offline, local) and the e2e suites run real `gs`.

### 9.6 Backend contract tests

One scenario table written against the `StackBackend` interface, run two ways: (a) fake runner —
exact `gs` argv/env sequence; (b) real `gs` on the fixture, offline — git post-conditions (graph,
patch-ids, tracked bases via `gs log --json`). Scenarios: track; push (as built — (a) fake: `unit/push` (item 21a) pins
`--version` then `stack submit --no-publish --no-update-only`, tracking being the caller's; `ext/commands` (item 21b) the
tracks before it; (b) real
`gs` on the fixture in item 22: origin gains every layer, `branch.<n>.remote/merge` are set, the `INF Pushed` wording
`unit/push` only assumes is pinned, and the process-group kill is measured against a slow pre-push hook, since
`execFile`'s timeout leaves git's push running — D61); trunk moved; bottom
squash-merged (simulated locally; the forge-side `sync` path is e2e); amend bottom / middle; insert
below bottom / between; createPRs with mixed drafts (fake only); conflict pause + continue; **remote
rewritten by another clone (E76): nothing unpushed → adopted by `branch -f`; unpushed commit → replayed
by `rebase --onto`; a submit attempted before adoption is refused.** *As built in item 22b (D64)*: track; push (b) — the
origin's heads, the upstreams, the `INF Pushed` wording, the `-2` rename, and the kill against a slow pre-push hook (measured:
the branch never lands — D63); trunk moved; amend bottom; insert below (between — E49; below the bottom waits for E48's sync,
M9); conflict pause + continue; the plain-pause remedies (new); `branch onto`. Still open: amend middle, bottom squash-merged + sync,
E76 adoption (M9), createPRs (M7, fake only). CI installs git-spice so (b) always runs — and demands it (item 22b:
`PRCASCADE_REQUIRE_GS=1` in ci.yml; release.yml's `npm test` has no git-spice and skips the three files, by choice — the tag's
commit has been through ci.yml with them).

### 9.5 CI

The extension's own repo lives on **github.com** (personal), so GitHub Actions is the primary CI:
matrix `ubuntu-latest` + `macos-latest`; steps: checkout → node 24 (D2) → `npm ci --ignore-scripts` → `npm test` →
`npm run package` (M4 item 15) → `xvfb-run -a npm run test:ext` on Linux, plain on macOS. Cache the VS Code download. CI installs git-spice (`brew install git-spice` on macOS, release binary on Linux) so the real-`gs`
suites run. As built (item 22b, D64): the release tarball on both runners — `git-spice.<uname -s>-<uname -m>.tar.gz`, sha256
against the same release's `checksums.txt`, into `$RUNNER_TEMP`, PATH through `$GITHUB_PATH`, the version pinned once in the
job's `env` (`GIT_SPICE_VERSION: 0.32.0`), `PRCASCADE_REQUIRE_GS=1` so the suite fails rather than skips there; brew would be
unpinned and a second path. Item 23a: gh is preinstalled on both runner images, so no step; `PRCASCADE_REQUIRE_GH=1` beside
`PRCASCADE_REQUIRE_GS` so the real-gh file fails by name rather than skipping if an image ever stops shipping it. The e2e suites (GitHub and GitLab) are **not** run in CI (they need a logged-in `gs`); they are a manual pre-release step. Tag → build →
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

**M4 — Refresh + state nodes + status bar.** Built on the built-in Git extension's API (§7.14; decided
2026-09-20, recorded 2026-09-26): the repositories and the change signal come from it, our own scan and its two
settings go. Debounced refresh on each repository's `state.onDidChange`, manual button, rebase-in-progress /
detached / no-trunk / no-stack nodes, the E82 rows, and the `<branch> · n of N` status bar item (§7.1). Tests:
`ext/gitApi`, `unit/debounce`, `git/rebase`, `ext/tree` (E20, E44), `ext/statusbar`, `ext/commands` (E12).
*Done when:* `git commit` in a terminal → alt-tab back → tree updates without clicking refresh; the fixture's
two-folder workspace still shows one repository with the two scan settings gone.
**→ Ship v0.1 here.** (It said "use it for a week before continuing" until 2026-10-01, when Ric dropped the
pause: he will not use the extension until it is done, so M5 follows M4 directly — §13.4.)

**M5 — Backend interface + git-spice readiness + push + login flows.**
`core/forge.ts`, `core/gsLog.ts`, the `StackBackend` interface (§4.4), readiness
probe with install/init/login offers (§7.13.1, §7.6), `track`, `enrich` (local tier), `push`
(`gs stack submit --no-publish`), refuse during rebase, refresh after. `gh` login flow kept for the
GitHub extras/native link. Tests: E12, E21–E25, E55–E57, E59, E62, E65, E67, `unit/forge`,
`unit/gsLog`, `unit/readiness`, `ext/login`, first rows of `ext/backend-gitspice`,
`git/gitspice.git` (init/track/log). No CR creation yet. Also settle §12 item 9 here (exit codes,
paused-op detection).

**M6 — The two views.**
`core/graph.ts` lanes, `core/viewmodel.ts`, the webview build (second esbuild target, CSP shell), the
smartlog rail (§7.1.1) with its panel, keyboard, `webview/context` menu and drag-and-drop message, then
the graph view (§7.1.2); the native tree is deleted in the last PR once every §7.1.0 behaviour has a
smartlog equivalent. Indicators that need M7 data (PR state, checks, comments) light up when M7 lands —
the view model already has the fields. Tests: `unit/graph`, `unit/viewmodel`, `webview/*`, `ext/views`,
E78–E81; the `ext/tree` rows migrate to `ext/views`.
*Done when:* on a fixture with two stacks the Explorer view shows the Graphite-style rail with both lanes
and the working-tree row, condenses at 220 px without overflow, ↑/↓/Enter and right-click work, and the
graph view shows the same state in its own container.

**M7 — Change requests: status, create one, create the stack, GitHub native link.**
§7.8 status (both tiers), the §7.7 planner as a pure function, `createPR` / `createStackPRs` via
`gs branch submit` with progress and cancellation, `setDraft` / `markReady*`, then **`core/nativeStack.ts`**
(§7.13.4): `gh stack link` after createPRs on GitHub, `Relink Stack`, settle §12 items 8b/8c. Tests: `unit/prs`, `unit/prstatus`, `ext/createStackPRs`, `ext/markReady`, `ext/nativeStack`, E26–E32,
E45–E47, E61, E62b, E66, E68, E73, E74 (fake). Verify on the github.com scratch repo (e2e: PRs show the native badge and map) and on a gitlab.com
scratch project (e2e: header dropdown) **before** using it on the work repo.

**M8 — PR descriptions: the plan document.**
`core/prdraft.ts`, `core/template.ts`, `core/prplan.ts` (pure, unit-tested first), then the
`prcascade-prplan` document, CodeLens, keybinding, `workspaceState` drafts. Until this lands, M7 uses
`prDescriptionMode: "auto"`. Tests: `unit/prdraft`, `unit/prplan`, `unit/template`, `ext/prplan`,
E33–E36, E38–E43.
*Done when:* "Create PRs for Stack" opens one document with three editable sections, Cmd+Enter
creates all three with the edited text, and each CR shows git-spice's navigation comment.

**M9 — Restack, sync, stack surgery, merge.**
`restack`, `sync`, `moveOnto`, `insertBranchBelow` / `finishInsert` / `cancelInsert`, pending-insert
node, `mergeBottom`; rebase banner with `gs rebase continue`; **Sync Stack**, **Merge Bottom PR**.
Tests: `git/gitspice.git` surgery rows, `ext/insert`, E48–E54, E58, E63, contract table (§9.6) green.
*Done when:* the E48 scenario runs end-to-end against the fixture, and on the scratch repo the
resulting CR bases are `fix→main`, `b→fix`, `c→b`.

**M10 — Multi-stack.** Folded into M6: `core/graph.ts` computes every stack (tips = branches not merged
into trunk that no other such branch contains) because the views draw them all; what was a "Show All
Stacks" toggle is now the "Show Only This Stack" filter on the view model (§7.2.1). Nothing remains here. *As built (M6
item 23a, D67):* a tip is a layer no layer sits on in the one-parent tree `core/graph.ts` builds — the same thing except
after a merge of one stack into another, where the merged branch keeps a stack of its own; the filter is `layoutGraph`'s
`onlyStackOf`, applied before lanes, meaning git-spice's stack.

---

**M11 — Other forges (Bitbucket, Gitea, Forgejo, Azure DevOps) — only when they ship a native stack view.**
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

**M4 stack — "it stays fresh and tells you where you are"** (built on the Git extension's API, §7.14;
item 12 split 2026-09-26 into 12a/12b so every later item number stays true)
12a. `vscode/gitApi.ts` + `vscode/git.d.ts` (the `release/1.85` file, verbatim, in a commit of its own) + the
     wiring in `extension.ts`: the §7.14.1 handshake (including the `extensions.onDidChange` re-check for a
     re-enabled Git extension), `initialized`, `repositories` → sorted roots, open/close → refresh, the E82 rows,
     `gitExecutable()` with `prCascade.gitPath` default `""`. **Deletes** `core/discovery.ts`, the two
     `prCascade.repositoryScan*` settings (package.json, config.ts, README's settings table) and their tests
     (`unit/discovery`, `git/discovery.git`, `ext/scanSettings`), plus README's two "works without the built-in
     git extension" sentences (false from this PR on; the user-facing rewrite is item 15) and, in
     `docs/typescript-primer.md`, the eight sections anchored "First seen in `src/core/discovery.ts`" (§21–§23,
     §36–§40), §41's scan-reader quotes and §42–§43's `scanSettings` anchor — retargeted to a surviving first use
     or marked "Deleted in M4 (item 12a)", the §11.1 rule applied to the file that leaves; `docs/reading-order.md`
     follows its files as always. The core/vscode split rule is waived once, on purpose: the core side is a
     deletion with nothing to review, and the lesson is the boundary moving. Expected size: over the §0
     guideline on purpose — `git.d.ts` is 411 lines (317 of them code), copied not written, reviewed for
     provenance (the Microsoft MIT header, the `release/1.85` tag) rather than line by line; ours is `gitApi.ts`
     plus the `extension.ts` / `config.ts` / `package.json` edits, aim ≤ ~300 with comments; the overrun goes in
     the PR body and a §13.2 row — a different cause from D23's comments, so Ric rules on it separately. Tests:
     `ext/gitApi` (handshake, E82, `gitExecutable`, E1 / E1b / E2, open/close, folder reorder); `ext/activate`
     still passes with the Git extension present.
12b. `core/debounce` + refresh triggers: each repository's `state.onDidChange` (debounced), the manual button,
     an explicit refresh after every command of ours (none exist yet — the rule lands with M5's first one, E83);
     the `onDidChangeWorkspaceFolders` listener stays (folder order is the sort key; a reorder or a guarded
     add/remove fires no open/close event, §7.14.2). Tests: `unit/debounce` (the coalescing case: a burst → one
     run, counted from the last call); `ext/gitApi` (the status relay with a fake `Repository` — one
     `onDidRunStatus` per completed status, a repository opened later listened to, a closed one not, nothing
     after dispose; D49); `ext/tree` (E20 through `repository.status()` then one `provider.onDidChangeTreeData`,
     §8 E20).
13. state nodes: rebase-in-progress through our own `--git-path` check (E12, E19 — not `state.rebaseCommit`,
    §7.14), detached (E3), no trunk, not on a stack (the D20 rows, restyled if needed); `git/rebase`. Split
    2026-09-30 into 13a/13b by the core/vscode rule above; later numbers unchanged.
13a. core: `RepoState.rebaseInProgress`, computed in `computeStack` by one `rev-parse --git-path rebase-merge
     --git-path rebase-apply` and an existence check of each printed path (D50). Tests: `unit/stack` (the
     command pinned in the sequence, either directory, neither, a worktree's absolute path, the check is a
     `run`; a directory stand-in so the unit layer stays off the disk); `git/rebase` (no rebase, the conflict
     stop, after `--abort`, `git am`, a failed `exec`, a linked worktree, `break` — `git am`, the failed `exec`
     and `break` proving git wrote no `REBASE_HEAD`).
13b. vscode: one row above the layers — "Rebase in progress — resolve it first" when `rebaseInProgress`, else
     "Detached HEAD" when `head` is null — then the E5 row or the layers; E4 alone when there is no trunk
     (D51). Tests: `ext/tree` (both rows by exact text, the fixture restored in `finally`).
14. status bar item `<branch> · n of N`; `ext/statusbar`; E44. Rider: `capabilities` in package.json (§13.4
    2026-09-19 "Activation and the empty window" — the note that keeps `onStartupFinished` for this item); no test.
    (D52: the provider's `onDidLoadStates` feeds the item; `createTreeView` and a hidden-view run in `refresh()`;
    `statusBar` and `treeView` returned under `ExtensionMode.Test` only.)
15. `v0.1.0`: packaging (`vsce`), README for users (gains the `git.*` settings that decide which repositories
    appear, and the E83 note that a ref moved from a terminal needs the refresh button), CHANGELOG, release
    workflow attaching the `.vsix`. ~~*Use it for a week before M5.*~~ (pause dropped 2026-10-01, §13.4) (D53: version 0.1.0 in the PR, the tag is
    Ric's after merging; `release.yml` on a pushed `v*` tag, `npm test` only, the preinstalled `gh` attaches
    the `.vsix`; `npm run package` in ci.yml; no icon, publisher `local`; `unit/release` pins the facts.)

**M5 stack — "the backend exists and can push"**
16. `core/forge`: `parseRemoteUrl` + forge kind + `ghEnv`. First **library decision** (`hosted-git-info`
    vs regexes). Tests: `unit/forge` (E21, E65), `git/remote.git` (E25). (D54: hand-rolled over WHATWG `URL` plus
    one scp regex — `hosted-git-info` fails E21's and E65's own URLs; `detectForge(git, root, remote)` →
    `ForgeDetection` {no-remote | unparseable | forge}; `Forge.recognizedByGitSpice` for E60/E70, from a mirror
    of git-spice's matching (`gitSpiceMatches`: kind first, one base host per forge — url key else default —
    equal or subdomain, as spelled, same port if configured; a rejected `spice.forge.kind` disables all); `host`
    as the remote spells it with `port` apart; `ghEnv` = `{ GH_HOST }`; no src/vscode change — the messages land
    with items 19–20.)
17. `core/backend` interface + `Readiness` type + `core/gsLog` parser. Library decision (`zod` vs
    type guards). Tests: `unit/gsLog` (E57). (D55: `StackBackend` declared with `kind` and `readiness(root,
    remote)` only, grown per implementing PR; `Readiness` a ten-member tagged union in probe order gs → init →
    forge → auth → gh, E75 a member, forge before auth because bare `gs auth status` cannot be read until the
    forge is known; `core/gsLog.ts` hand-rolled after measuring zod — classic 454 KB minified, `zod/mini` 16 KB —
    keeping only the fields `enrich` reads; `backend.ts` has no test file, `npm run typecheck` is its test.)
18. `backends/gitspice` readiness: `gs version` (library decision: `semver`), init detection, `gs auth
    status`; memoization. Tests: `unit/readiness` (E55, E59, E62, E67). (D56: a new `core/command.ts` runner that
    answers with a result and never rejects — the §11.3 execFile wrapper item 21 measures execa against;
    `prCascade.gsPath` `''` = `git-spice` then `gs` (`gs` first until a follow-up commit), identified by the `--version` banner, never by exit code;
    `semver` measured 27 KB and hand-rolled, floor 0.31.0; init = `rev-parse --verify --quiet refs/spice/data`;
    `auth status --forge <kind>`; only `ready` memoized; E17 propagates; GitHub `ready` without gh until item 23;
    primer §70 (`?.`) new. Plus `unit/command`, `git/command.git`, `git/readiness.git`.)
19. `vscode`: install / `gs repo init` / `gs auth login` offers and the poll-then-continue login flow (the poll is
    `readiness()` itself — failures are never memoized; adds `prCascade.gsPath`, default `""`, to package.json)
    (`vscode/login.ts`, `core/ghstatus.ts` generalized to both tools — superseded: the generalised poll is `core/poll.ts`,
    and `ghstatus.ts` stays item 23's gh reader). Tests: `ext/login`. (D57: built as two PRs,
    as 13a/13b were, so core and vscode stay apart —
    **19a** `core`: the offers' texts and commands (`core/readinessFix.ts`: `offerFor`, `trunkBranchFor`,
    `readyMessage`), the poll for both tools (`core/poll.ts`, the generalised half of `ghstatus.ts`; gh's reader
    stays item 23's), terminal quoting (`core/shell.ts`), `Ready`/`NotReady`, `GitSpiceBackend.forget`. Tests:
    `unit/readinessFix`, `unit/poll`, `unit/shell`, `git/trunkBranch.git`, two `unit/readiness` cases.
    **19b** `vscode`: the rest of this item — `vscode/terminal.ts`, `vscode/login.ts`, the wiring and the setting;
    `ext/login`. As built (D58): plus the palette command `prCascade.setUpGitSpice`, so the flow can be used before
    M7's `createPRs`, the first action gated on it — neither Track Stack nor Push Whole Stack is (D60; D61 records the measurement, D62 the command); `unit/terminal`, `unit/login` (fake timers)
    and `ext/login`.)
20. `track` + `enrich` (local tier): tree gains CR ids, `needs push`, `needs restack`, `not tracked`,
    "Track Stack with git-spice"; plus the §7.14.2 digest pre-filter in front of `gs log short --json`
    (`state.HEAD?.{name, commit, upstream?.commit}` + one `for-each-ref --format='%(refname) %(objectname)'
    refs/heads refs/remotes refs/spice`; `gs log` runs only when it changed) and the first instance of the E83
    rule — an explicit refresh after `track`. Tests: `ext/backend-gitspice` rows, `ext/tree` additions (E56),
    `unit/digest`, `ext/commands` (a refresh recorded after `track`, E83).
    Built as **20a** core (`model.ts` `tracking?`/`enrichment?`, new `core/digest.ts`, `backend.ts` `enrich`/`track`/
    `TrackResult`, `gitspice.ts`; `unit/digest`, `git/digest.git`, `unit/enrich`, `unit/track`) and **20b** vscode
    (`tree.ts`, `extension.ts` — `loadRepoState`, the context key, `prCascade.trackStack` — `login.ts`'s placeholder,
    `package.json`; `ext/tree` +6, `ext/commands` new, `ext/login` cans `gs log`, `unit/login` +1; README/CHANGELOG), as
    13a/13b and 19a/19b (D59/D60). `state.HEAD` is not in the digest and `gs log` takes `--all` (D59 says why); the
    `ext/backend-gitspice` rows live in `unit/enrich`/`unit/track`; the trunk's local branch is handed to `track` by the
    caller.
21. `push` + **Push Whole Stack** + refuse during rebase. Library decision (`execa` vs `execFile`
    wrapper — measure the 12-dependency cost). Tests: `ext/commands` (E12), argv row.
    Built as **21a** core (D61: `backend.ts` `push`/`PushResult { pushed, notes, problem }`, `gitspice.ts` `push` with five
    refusals before the spawn, `GS_SUBMIT_ARGS` (`--no-publish --no-update-only`), `PUSH_TIMEOUT_MS`, `GIT_TERMINAL_PROMPT=0`
    in `GS_ENV`, `describeResult`'s appended git line in four functions; `unit/push` 23, +1 row in `unit/enrich`/`unit/track`,
    one `unit/readiness` literal; execa 120.8 KB minified, declined) and **21b** vscode on top of it (D62:
    `extension.ts` `pushStack` in three parts with an in-flight guard and git-spice's notes in the Output panel,
    `vscode/contextKeys.ts` with the two key names, `package.json` with `enablement` on both commands and `2_stack@1`;
    `ext/commands` +17, `test:ext` 113 → 130; primer §74, reading order item 70; README/CHANGELOG). Not gated on `ensureReady`: the login is not needed — D60's promise withdrawn
    by measurement (D61 records the fact, D62 the command); E76's refusal half built here from `push.behind`; `PushResult`
    not `void`; 120 s, a budget not a cancel (a cancel since item 22a, D63).
22. `git/gitspice.git` bootstrap: CI installs `gs`; init/track/log scenarios pass offline. Settle §12
    item 7 (exit codes, paused-op detection) and write the first §9.6 contract rows. Plus the §13.4 (k) pin:
    `log short --json` (and `--cr-status` against the bare origin) change nothing under `.git`.
    Built as **22a** core (D63: `core/command.ts` moves to `spawn` with `detached` and a process-group kill — the one
    production change of the item; `git/command.git` +10; primer §75–§77) and **22b** (D64: CI installs git-spice 0.32.0
    from the release tarball on both runners and requires it; `test/helpers/gitspice.ts` and three files —
    `git/gitspice.git` 16, `git/gitspiceFacts.git` 17, `git/gitspiceOps.git` 10; §12 item 7 decided; both (k) pins; the
    `<name>-2` guard deferred to item 26 with its facts pinned; nine commits, each green).
23. `gh` readiness on GitHub repos (E62b) + `gh` login flow. Tests: `unit/ghstatus`, `ext/login` rows.
    Built as **23a** core (D65: `core/version.ts`, `core/ghstatus.ts`, step 5 as `ghStep`, `gh-not-logged-in`,
    `gh-missing.ghPath`, `ready.gh`, `progressOf` as a table, `git/gh.git` hermetic, CI's `PRCASCADE_REQUIRE_GH`; nine
    commits, each green), as 19–22, and **23b** VS Code (D66: the gh offers with their buttons, `prCascade.ghPath` and
    `prCascade.gitProtocol`, `brewGh`, the gh-missing sub-step, `installAppeared`, `ext/login` +5; README/CHANGELOG).

**M6 stack — "the two views"** (numbered 23a–23j so every item number below stays true)
23a. `core/graph`: every stack in the repo (tips, parents), lane assignment, elision. Pure; the E78 table.
     Built as **23a** (D67: `readGraphInput` — `for-each-ref refs/heads` with the date column, `rev-list --parents --branches
     --not <trunk>`, `rev-list -1 … '<trunk>^{commit}'` — then `parseRefs`/`parseDag`/`parseTrunkTip`/`layoutGraph` →
     `GraphLayout { rows, lanes }`; membership by a DAG line, depth and forks by one walk per member, parent = the greatest
     ancestor by (depth, name), depth-first drawing with the biggest subtree straight and side children on `lane + 1` joining
     below, `filled`/`hollow`/`dashed`, `dirty` an input, one `elided` row, `onlyStackOf` as git-spice's stack; `unit/graph` 110,
     `git/graph.git` 20; primer §81; nine commits, each green — the seventh a four-lens review's fixes, the ninth SonarCloud's S3776). The first M6 PR, on the unmerged M5 stack (§0 waived a
     second time — §13.4).
23b. `core/viewmodel` + `src/webview/protocol.ts`: `StackViewModel`, every `Indicator` from its source
     field, message rows, ages. Pure; `unit/viewmodel`.
     Built as **23b** (D68: `buildStackViewModel(input)` → `StackViewModel { repo, rows, lanes, messages }`, the graph laid
     out inside it with `onlyStackOf: head` while HEAD is on a stack; `ViewRow` = 23a's row fields + `indicators` in the
     tail's order + `age` + `dim` + `tooltip` + `context`; ten indicator kinds from their source fields —
     `Enrichment.enriched.byName` for every stack, `remoteBranches` for ⛅, `extras` behind a `change` for M7's five; the
     four message rows word for word from tree.ts; `digest.ts` gains `remoteBranches`; `gsLog.ts` keeps `change.comments`;
     `src/webview/protocol.ts` types only, `CommandId` a template literal type, `HostNotice` for the rows without a
     repository; `unit/viewmodel` 111, `unit/enrich` 14 literals +2, `unit/digest` +5, `unit/gsLog` +2, `git/gitspice.git`
     2 literals +2; primer §82, §83; 9 commits, each green, the seventh a review's fixes, the ninth SonarCloud's).
23c. webview build: second esbuild target (`platform: "browser"`, one IIFE per view) → `dist/webview/`;
     `@vscode/codicons` copied in; the `test/webview` Vitest project; the ESLint rule for `src/webview/**`.
     **Library decision:** `happy-dom` vs `jsdom` for renderer tests (dev-only; pick by the §11.3 table).
     Built as **23c** (D69: two tsconfigs — the webview's with the DOM lib, `types: []`, `src/webview` + `test/webview`
     and its own `exclude: []`, the root excluding both, two one-line editor pointers inside the folders; `typecheck` two
     runs; the lint block from `builtinModules` ×2 with `allowTypeImports` plus `no-restricted-globals`; the `webview`
     Vitest project under happy-dom 21.0.3 — jsdom declined; `src/webview/host.ts` (`connect` → `onModel`/`postCommand`,
     the last model's `seq`, an origin check and a three-clause predicate), `smartlog/render.ts` (23d's plain-text rows, view side) and
     `smartlog/main.ts` → `dist/webview/smartlog.js`, one entry — `graph` is 23i's key; `@vscode/codicons` 0.0.46-24
     exact, copied, `THIRD-PARTY-NOTICES.md` — the licence floor gained its asset clause the same day, on Ric's answer; `webview/host` 7, `webview/render`
     5, `unit/lint` 7, `unit/build` 5, `unit/vsix` 1; 12 commits, each green — the seventh a four-lens review panel's 34 confirmed findings (37 found, two sceptics each, 3 refuted), the ninth SonarCloud's S2819 (the listener's origin check), the tenth its S7764 (`globalThis.location`), the eleventh §11.3's asset clause on Ric's answer, the twelfth SonarCloud's S3358 on that clause's script).
23d. `vscode/views/base` + `vscode/views/smartlog`: HTML shell with CSP nonce, posts the model on refresh
     and on visibility, routes `command` messages to registered commands (E79); `package.json` gains the
     `explorer` webview view; rows rendered as plain text for now (the view side of that is 23c's `render.ts`, D69 —
     this item shows it); `ext/views` first rows; the test-mode
     handle replacing `provider` (§9.1).
23e. smartlog renderer: rail, lanes, nodes (E78 geometry), tail glyphs, condensing (E80), theme variables;
     `webview/smartlog` tests. *This is the PR that makes it look like the mockup.*
23f. smartlog keyboard, focus, `data-vscode-context` and the `webview/context` menu entries (the §7.2.1
     command ids); `accessibilityHelpContent`.
23g. smartlog lower panel: the focused layer's files as a folder tree, click → `openDiff`, Submit /
     Check out buttons (Submit is disabled with a tooltip until M7).
23h. drag and drop in the webview → the `moveOnto` message; the host confirms and, until M9 implements
     `moveOnto`, reports that the command arrives in M9. Tests: `webview/*` drag rows, `ext/dragdrop`.
23i. graph view: `vscode/views/graph`, the `prCascade` container + SVG icon, the renderer (§7.1.2) with
     trunk-commit rows and the files under the checked-out row; `webview/graph` tests; E81 in `ext/views`.
23j. delete `vscode/tree.ts` and the `scm` view; migrate the remaining `ext/tree` assertions to
     `ext/views`; status bar click → `prCascade.smartlog.focus`; README screenshots. *Manual check: open the
     fixture and the work repo, drag the Stack view between containers, resize the sidebar to 200 px.*

**M7 stack — "create the PRs, natively stacked"**
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

**M8 stack — "descriptions you actually edit"**
31. `core/prdraft` (E33, E38). 32. `core/template` (E34, GitHub + GitLab paths). 33. `core/prplan`
    render/parse round-trip (E35, E36, E39, E41–E43). 34. `vscode/prplan`: document, CodeLens,
    keybinding. 35. drafts in `workspaceState` (E40). 36. wire `prDescriptionMode: edit` into
    `createStackPRs`; update the e2e to submit edited text.

**M9 stack — "restack, sync, surgery, merge"**
37. backend `restack` + `sync` + `rebaseState` → **Restack onto Trunk**, **Sync Stack**, rebase
    banner (E58, E63). Sync Stack is fetch → detect diverged remotes → adopt (E76, procedure in §13.4)
    → `gs repo sync --restack upstack` → submit; restack and submit refuse on an unadopted diverged
    branch. Tests: `git/sync.git.test.ts` with a second clone rewriting the remote, both E76 variants. 38. `moveOnto` + command + cycle check (E53). 38b. **drag-and-drop move**: wire the webviews' `moveOnto` message (item 23h) to the real `moveOnto` after the confirm; refusals per E77; tests `ext/dragdrop` (added 2026-09-20; moved from a `TreeDragAndDropController` to the webviews when the views were decided the same day). 39. `insertBranchBelow` /
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
├── .github/workflows/        ci.yml (every PR and main: test, package, test:ext), release.yml (a pushed v* tag → the .vsix on a GitHub release)
├── .vscodeignore
├── .gitignore                node_modules, dist, .vscode-test, coverage
├── CHANGELOG.md              Keep a Changelog; the newest `## [<version>]` section is the release's notes
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

`package.json` runtime dependencies: few, chosen per §11.3 (candidates: `execa`; `hosted-git-info`, `zod` and `semver` were measured in PRs 16–18 and hand-rolled instead — D54, D55, D56); everything else hand-rolled. Dev dependencies are not shipped — except `@vscode/codicons`' stylesheet and font, copied into `dist/webview/` at build time (M6 item 23c; their notice ships with them). Dev: `typescript`, `esbuild`, `vitest`,
`@vitest/coverage-v8`, `happy-dom` (the DOM under `test/webview`), `@types/vscode`, `@types/node`, `@vscode/test-cli`, `@vscode/test-electron`,
`mocha`, `@types/mocha`, `eslint`, `@typescript-eslint/*`, `@vscode/vsce`, `@vscode/codicons`.

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
7. (M6) The webviews are bundled by the same `esbuild.mjs` into `dist/webview/` and the watcher covers
   them (two esbuild contexts since item 23c: a save under `src/webview` rebuilds the view bundle alone). To iterate
   on a view: **Developer: Reload Webviews** in the dev host reloads them without a
   window reload; **Developer: Open Webview Developer Tools** opens Chrome's inspector on the view's DOM.

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
ships that file plus `package.json`, README, LICENSE, CHANGELOG and the icon — and, since M6 item 23c,
`dist/webview/` (the view bundle, and the codicon stylesheet and font: the one `node_modules` asset that ships, copied
out at build time) and `THIRD-PARTY-NOTICES.md` — `node_modules/` and
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
  | License | MIT, ISC, BSD or Apache-2.0; for an asset that ships as a file (icons, a font), CC-BY-4.0 with its attribution in `THIRD-PARTY-NOTICES.md` (D69, Ric 2026-10-16) | Publishable without a legal question; the asset clause asks one duty of a redistributor — the notice travels with the file |
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
| Spawn `git`/`gs`/`gh` with argv, env, cancellation, good errors | `execa` | raw `child_process.execFile` wrapper | ESM-only; esbuild bundles it into the CJS output — confirmed. **Declined 2026-10-09 (PR 21a, D61):** 10.1.0 bundles to 120.8 KB minified (esbuild 0.25, node18, cjs; `import { execa }` with `{ reject: false }`; 513 B baseline) beside a 103.5 KB unminified extension — for cancellation, streaming, `verbose` and templates nothing here uses; `core/command.ts`'s ~70 code lines (PR 18, D56) already give argv, env, cwd, timeout, a closed stdin and a result that never rejects, and share the directory/ENOENT classification with `git.ts`; the one thing it adds, cancellation, no caller needs (a push is awaited, not aborted) — and its kill is the one pid's too, so it would not stop git's push either |
| Parse remote URLs into host/owner/repo for GitHub/GitLab/Bitbucket (`core/forge.ts`) | `hosted-git-info` (npm's own) | hand-written regexes for ssh / scp-like / https forms | Exactly the edge-case-heavy case; keep our tests (E21, E65) as the acceptance bar. **Declined 2026-10-01 (PR 16, D54):** 10.1.1's `fromUrl()` knows only github.com / gitlab.com / bitbucket.org (plus gist and sourcehut) and returns `undefined` for E21's and E65's own URLs — `ssh://git@ghes.corp.com:2222/…`, `https://user@ghes.corp.com/…`, self-hosted GitLab, codeberg, dev.azure.com, even `github.com:org/repo.git`; 30 KB minified with its `lru-cache` dependency. Hand-rolled over Node's WHATWG `URL` class plus one scp regex, 3.3 KB minified (`esbuild --bundle --minify`). |
| Compare `gh` ≥ 2.90.0, `gs` ≥ 0.31 | `semver` | string splitting | Tiny, standard. **Declined 2026-10-06 (PR 18, D56):** 7.8.5's `gte` + `coerce` bundle to 27.3 KB minified (esbuild, node18, cjs) on a 48 KB extension — more than the 16 KB `zod/mini` D55 declined — for one three-number compare of a token one program prints; `coerce` would also invent a patch for `0.31`. `parseVersion` + `isAtLeast` are ~15 lines; item 23's gh floor reuses them (in `core/version.ts` since 23a, D65). |
| Validate `gs log --json` and `gh … --json` shapes (`core/gsLog.ts`, PR status) | `zod` | hand-written type guards | Schemas double as readable documentation of the JSON for the reader; `.passthrough()` implements "tolerate unknown fields" (E57). **Declined 2026-10-01 (PR 17, D55):** zod 4.6.5's default import `import { z } from 'zod'` bundles to **454 KB** minified (esbuild, node18, cjs) — 91 % of the budget on its own; `zod/mini` is 16 KB but a functional dialect (`z.optional(z.string())`) with `Invalid input` as every issue's message unless a locale is loaded, so the problem text would be built from `issue.path` by hand anyway. The §51 ladder is ~70 code lines, 0 KB, no new construct. Re-measure at M7's `gh … --json` parser; adopt `zod/mini` there if the ladders pass ~150 lines in total. `.passthrough()` is not wanted: fields nothing reads are dropped. |
| Debounce (`core/debounce.ts`) | — hand-roll | `lodash.debounce` | 10 lines |
| Markdown / diff rendering | — none | — | VS Code renders both natively |
| DOM for renderer tests (`test/webview`, M6) | `happy-dom` | `jsdom`; hand-written DOM stubs | **Decided 2026-10-16 (PR 23c, D69): happy-dom 21.0.3** — a typed built-in Vitest 5 environment, dev-only, no bundle cost. Both cards pass every row (happy-dom: 21.0M downloads/week, one maintainer under the ≥ 10M clause, 7 direct deps, MIT, types shipped, 9 packages / 21.9 MB installed alone; jsdom: 114.2M/week, 6 maintainers, 20 direct deps, MIT, types in `@types/jsdom`, 36 packages / 25.6 MB) — the direct dependencies of a dev dependency ship nowhere, and stars (21,712 to 4,706, the other way) were never reached as a tiebreak because the options were not otherwise equal: a 17-row DOM feature file under Vitest 5.0.1 passes 16 on happy-dom (318 ms) and 12 on jsdom (536 ms); jsdom has no `DataTransfer`, `DragEvent`, `ResizeObserver`, `matchMedia` or `scrollIntoView`, which 23h's drag and E80's width tests reach for; happy-dom has no `DragEvent` either (the global is an alias of `Event`) but a real `DataTransfer`. Neither lays out — every width and rect is 0, happy-dom's `ResizeObserver` never calls back — so E80's width is a stubbed `clientWidth` plus a `resize` event, and a drag test dispatches plain events while the renderer keeps the dragged row itself. Two happy-dom leniencies the tests may not lean on: `focus()` lands on a plain `<li>` (rows carry `tabindex` and tests assert it) and `draggable = true` does not write the attribute (`setAttribute`). |
| Icons in the webviews | `@vscode/codicons` (Microsoft) | hand-drawn glyphs under our MIT | The glyphs VS Code itself uses; `codicon.css` (38.9 KB, 752 rules) and `codicon.ttf` (149.5 KB) copied into `dist/webview/` at build time, never imported — bundle delta 0, +83 KB in the `.vsix`. **Adopted 2026-10-16 (PR 23c, D69); the licence floor gained its asset clause the same day, on Ric's answer:** the icons are CC-BY-4.0 (the stylesheet MIT), which was not on the floor's list — this row was written 2026-09-20 with no card, two days after the floor. Shipped with `THIRD-PARTY-NOTICES.md` (attribution where the icons are distributed — the `.vsix`; VS Code's own `ThirdPartyNotices.txt` carries the same package the same way), pinned to `0.0.46-24` exactly: `latest` and every version since 0.0.45 are `0.0.46-NN` prereleases, so `^0.0.46-24` would admit the `next` tag's `0.0.46-45`. "Inline SVG" was no alternative — the package's SVGs are the same CC-BY icons; the MIT alternative is glyphs drawn by hand, which are not VS Code's. Decided 2026-10-16 (Ric): accepted with attribution; `depcheck.mjs` prints the clause for CC-BY-4.0. |
| Lane layout (`core/graph.ts`) | — hand-roll | a graph-drawing library | ~80 lines and entirely our domain: branches, one parent each, no cycles |
| Webview UI toolkit | — none | `@vscode/webview-ui-toolkit` | Deprecated by Microsoft (archived January 2025); plain DOM styled with `--vscode-*` variables |

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
| `execa` | 10.1.0 (re-measured 2026-10-09; was 10.0.1) | 2026-10-06 | 171,597,264 | 7,615 | 2026-10-06 | False | 2 | 12 (18 installed) | none | 2 | MIT |
| `hosted-git-info` | 10.1.1 | 2026-05-18 | 93,283,164 | 239 | 2026-06-18 | False | 4 | 1 | none | 4 | ISC |
| `semver` | 7.8.5 | 2026-06-19 | 770,970,847 | 5,466 | 2026-09-10 | False | 61 | 0 | none | 4 | ISC |
| `zod` | 4.6.5 | 2026-09-13 | 264,439,481 | 43,968 | 2026-09-14 | False | 64 | 0 | none | 1 | MIT |
Notes: `zod` has one listed maintainer — accepted under the ≥ 10M downloads/week clause, record it
on the card. `execa` has 12 direct dependencies — they ship in the bundle, so its adopting PR must
show the measured delta and may reasonably conclude a 40-line `execFile` wrapper is the better deal
(it did: re-measured and declined in PR 21a — D61).
`semver` and `zod` have zero dependencies. Re-run the check when upgrading a major version. `hosted-git-info` and
`zod` were re-measured in their adopting PRs (16 and 17, 2026-10-01) and declined — D54, D55; `semver` likewise in PR 18
(2026-10-06) — D56.

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
no footer/nav comment by default on GitHub/GitLab (native views); **the built-in Git extension is the source
of repositories, change events and the git executable** (decided 2026-09-20, recorded 2026-09-26, §7.14) —
acquired at runtime rather than through `extensionDependencies` — of the four ★ points in §13.4 the one that is a
design choice rather than a correction the source forced (§13.4 (h) says why; say so in that PR's review if you
want the dependency declared in package.json instead).

**Open — ask, unless he has said "go with the recommendations":**
1. **Commits as an intermediate tree level?** Recommendation: no — branch → files. Squash merge
   flattens commits anyway.
2. **Only the stack containing HEAD, or all stacks?** **Resolved 2026-09-20:** the v0.1 tree is HEAD-only;
   the views (M6) draw every stack, with an optional "Show Only This Stack" filter.
3. **Status letters as label prefix vs icon?** Recommendation: prefix (`M  path`).
4. **PR description defaults:** title from first commit (vs branch name); template after the commit
   summary (vs before); `prDescriptionMode` default `edit`; `prDraft` default `false`. Recommend all four.
5. **"Draft with AI" CodeLens via `vscode.lm`?** Not in scope unless he asks; must degrade to nothing.
6. **`gh stack link` on PRs git-spice created** — the docs say it is designed for this; confirm on the
   scratch repo before PR 28: 2-layer `gs` stack → `gs stack submit` → `gh stack link a b` → badge on
   the PR page. 6b: re-running with the full list — updates the existing stack or creates a duplicate?
   (decides the insert flow). 6c: which `gh pr view --json` field exposes stack membership (tree's
   "linked" marker).
7. **git-spice exit codes and paused-operation detection** — **Decided 2026-10-14 (item 22b, D64):** every command
   measured exits 0 or 1 (36, on 0.31.2 and 0.32.0; usage errors are 1 — a statement about what was measured, not a
   universal: a Go panic would be 2 and a signal leaves none); no exit code tells "not initialised" from "conflict" from
   "nothing paused" — the backend reads the first `FTL` line and never a code beyond ≠ 0 (`git/gitspiceFacts.git` pins
   the table, each row's exit asserted 0 or 1). A paused operation is D50's directory check (`rebase-merge`/
   `rebase-apply`) for git-spice's pauses as for git's: git-spice keeps no `.git/spice`, HEAD is detached,
   `rebase-merge/head-name` names the branch being rebased. Its own record — which command to resume, from which
   branch — is `refs/spice/data:rebase-continue`, which §3 forbids reading and which is not adopted: `gs rebase
   continue` / `gs rebase abort` drive a plain git rebase too (measured), so M9 hints them whenever `refs/spice/data`
   exists, adding `gs stack restack` for an upstack a plain pause leaves behind; `GIT_EDITOR=true` on the continue.
   The `*.ghe.com` apiUrl half was settled by item 19a (E70, D57).
8. **Library decisions** (§11.3, §10.2): `hosted-git-info` (PR 16 — decided: hand-roll, D54), `zod` (PR 17 — decided: hand-roll, D55), `semver` (PR 18 — decided: hand-roll, D56),
   `execa` vs a hand-rolled `execFile` wrapper (PR 21 — measure the 12-dependency cost; **decided: hand-roll, D61**). Each decided
   in its adopting PR with the full library-decision section; hand-roll is a legitimate outcome.
9. **A gitlab.com scratch project** for the GitLab e2e — he needs an account; confirm before M7.
10. **Default container for the smartlog:** Explorer (Ric's stated daily use) or SCM (the original §3
    choice). Recommendation: Explorer; anyone can drag it elsewhere. Decide before item 23d.
11. **Keep the native tree behind a setting after M6?** Recommendation: no — delete it in item 23j; one
    model, two renderers, no third to keep in step.
12. **Smartlog row height:** VS Code's list height (22 px) or Graphite's 19 px. Recommendation: 22 px, the
    Explorer's own rhythm. Decide in item 23e by looking at both.

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

Bugs found while writing this, which the M8 tests must cover:
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
  `git-spice` as well as `gs`, and `prCascade.gsPath` should default to whichever is found — decided in PR 18 (D56):
  the setting defaults to `""`, which tries `git-spice` then `gs`; a set value is tried alone; (Correction,
  2026-10-08: it is not only Homebrew — git-spice itself renamed its binary to `git-spice` in v0.24.0 and dropped `gs`
  from GitHub Releases, Homebrew and the AUR in v0.25.0, per its CHANGELOG; only `go install` still makes `gs`. PR 18
  first tried `gs` first; a follow-up commit put `git-spice` first.) the probe tells
  Ghostscript apart by the `--version` banner, not by the exit code. `Readiness.gs-missing.tried` (item 17) lists what
  was probed, Ghostscript's `gs` included, and `ready.gsPath` which one answered.
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
| D5 | 1 | CI does not yet install git-spice (§9.5) | Nothing in M1 runs it; PR 22 adds the step with the first suite that needs it. **Closed in item 22b (D64)**: the step, before `npm ci`, on both runners. |
| D6 | 1 | Dev deps `@eslint/js`, `globals` beyond §11.1's list; `vscode:prepublish` script beyond §9.2 | Flat ESLint config needs both; prepublish keeps `npm run package` from shipping a stale `dist/`. |
| D7 | 1 | CI triggers: `pull_request` + pushes to `main` only | A push to a stacked branch would otherwise run the suite twice on two OSes with a VS Code download each. |
| D8 | 1 | `scripts/depcheck.mjs` prints two §11.3 floors as `CHECK BY HAND` (native `.node` files in the tarball; "org-owned" bus factor) | No registry field settles them; everything measurable is measured. |
| D9 | 2 | `tryRun` returns `null` for an **unusable working directory** (missing, a file, or not enterable) as well as for non-zero exit; `run` checks the directory with two `fs` calls before spawning. A missing/unrunnable git (E17), a signal, output overflow, or an argument list Node refuses still reject | Node reports a vanished cwd with the same `ENOENT` as a missing binary and a forbidden one with the same `EACCES` as a non-executable git; discovery must treat a deleted workspace folder as "not a repo", not fail the workspace. |
| D10 | 2 | `GitError` carries `gitPath`, `startFailure` (`'not-found' \| 'not-executable' \| …`) and `detail` beyond args/cwd/exitCode/stderr | The E17 node recognises the failure kind without parsing messages. |
| D11 | 2 | `run` returns stdout **untrimmed** | M2's `-z` parsing needs raw output; callers strip the one newline they expect. |
| D12 | 3 | `FakeGitRunner.answerIn(cwd, args, response)` added to the argv-join map | Discovery runs the same command in different folders and expects different answers. |
| D13 | 4 | The branch `origin/HEAD` names is verified before it is trusted (§5 takes `symbolic-ref`'s answer as-is); every existence check is `rev-parse --verify --quiet --end-of-options <ref>^{commit}` rather than §5's bare `<ref>`; trunk detection reads **`prCascade.remote`** instead of a literal `origin` | After a remote `master→main` rename plus `fetch --prune`, git < 2.48 leaves the pointer dangling (plan floor is 2.38). Plain `--verify` accepts any object (`main:` passes), so a non-commit would fail later with a plausible name in hand; `--end-of-options` stops a setting beginning with `-` being read as a flag. One remote setting instead of two (a fork measuring against `upstream/main`). |
| D14 | 4, 5 | `TrunkOptions` lives in `trunk.ts`; `MeasuredBranch` (un-exported) in `stack.ts`; not in `model.ts` | Kept next to the one function that uses each; `model.ts` holds shared shapes only. |
| D15 | 5 | `RepoState.rebaseInProgress` **not added** in M1 | Computed and rendered together in M4 (PR 13); an always-false field would be dead code for the reader. (Item 13 was split 2026-09-30: computed in 13a, drawn in 13b, one PR up the same stack — D50.) |
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
| D40 | M3 PR 14 | `core/uri.ts` works on plain URI *components* (`UriComponents { scheme; path; query }`, which a `vscode.Uri` satisfies structurally) rather than on `vscode.Uri`; the query is `JSON.stringify({ root, ref })`; `StackDiffQuery = Pick<StackDiffLocation, 'root' \| 'ref'>`; decode strips exactly one leading `/` and throws a named error for a foreign scheme, a path without `/`, non-JSON, or a missing/non-string `root`/`ref`. | §4.1: core never imports `vscode`. The real E11 proof (percent-encoding of `#`, `?`, spaces, unicode) is PR 15's extension-host test through a real `vscode.Uri`. |
| D41 | M3 PR 15 | Diff title renders the bottom layer's parent as the trunk ref detectTrunk found (`a (origin/main → api-refactor)`), the same name the row tooltip shows; §7.2's `<parent>` read literally. | Consistency between title and tooltip; Ric may prefer the short `main` (one line in `commands.ts` plus two label assertions). |
| D42 | M3 PR 15 | The content provider reads `git show <ref>:<relPath> --` via `tryRun`; absent-at-ref → `''` (E8 left pane, E9 right pane); a start failure (E17) propagates. The trailing `--` was verified on git 2.50.1 (accepted; bytes identical incl. NUL and no-trailing-newline content; resolves the "both revision and filename" case). Output is never trimmed. | §5 row "File content at ref"; D31's `--` rule applied to `git show` too. |
| D43 | M3 PR 15 | Binary files (E10): on the **current** layer (the file is on disk) `vscode.open` opens it; on any other layer, or when the layer deleted it, an information message names the file and layer. §7.2's "open the file at `branch`" is only possible when that branch is checked out. | Honest reading of §7.2; the message names the layer so the user knows why. |
| D44 | M3 PR 15 | `FileNode` gains `layer: StackLayer` and a `command` (`prCascade.openDiff`, `arguments: [this]`) so a single click opens the diff; no `view/item/context` menu entry yet (§7.2.1 menus are M4). The harness fixture and `scripts/fixture.ts` gained a deleted trunk file (`git rm f`, E9) and `weird #1 ü?.txt` (E11); the tree test's "exactly its own files" list for the top layer grew accordingly. | The click is the entry point §7.2 names; the fixture must exercise every §8 row the milestone claims. |
| D45 | M3 PRs 14–15 | Sizes against the brief's aims: PR 14 159 lines (aim ~90; 47 code), PR 15 265 added / 23 removed (aim ~220); both inside the plan's ≤ 300 guideline; the excess is doc comments. Primer grew §49–§58 (Pick, JSON, shape checks, TreeItem.command, TextDocumentContentProvider, destructuring, Uri.from and percent-encoding, executeCommand / vscode.diff / vscode.open, reading the editor from a test). | Same D23 question. |
| D46 | M4 PR 12a | The adapter (`src/vscode/gitApi.ts`) narrows the Git extension's API to a `GitApi` type of six members and declares its two repository events as `Event<unknown>` rather than git.d.ts's `Event<Repository>`; the handshake's three VS Code touch-points (`getExtension`, `extensions.onDidChange`, the window-level `git.enabled` read) are one `GitExtensionHost` object handed in by `extension.ts`, with `realGitExtensionHost` the real one. `GitUnavailableError` (an E82 row) is drawn by the tree as a **warning** row, where every other loader failure is an error row. | §7.14.1's test seam, made concrete: the E82 rows and the `initialized` wait can only be exercised with stand-ins, and stand-ins for `Event<Repository>` would need a whole fake `Repository` per event — the adapter reads nothing from the event, so it asks for nothing. A warning, not an error, because E82 is a state the user can change (§7.14.3), and the icon says so. |
| D47 | M4 PR 12a | `onDidChangeWorkspaceFolders → refresh` stays (§7.14.2 as recorded 2026-09-26), and the folder-reorder test §9.4 suggested is written for the workspace's second and third folders (`repo` and the appended `second`), never its first: replacing the first workspace folder restarts the extension host (VS Code's documented behaviour, primer §42), which is why `nested` leads the fixture workspace. It asserts one refresh and no open/close event; the labels do not move, because `repo` keeps the lowest folder index through `nested`. The open/close test asserts exactly two tree refreshes for a folder added at the end — one from the folder listener, one from the Git extension's open event — and, since 12b, then waits for the third: the debounced refresh from the new repository's first status, so it cannot land in the next test. The delegated E1 test lives in its own file, `test/ext-parent/parentFolder.test.ts`, not in `ext/gitApi.test.ts` as §9.4 wrote it: the second `defineConfig` launch needs a `files` glob of its own, and `tsconfig.ext.json` compiles `test/ext-parent` beside `test/ext`. | The two-refresh assertion proves the open-event wiring; the reorder test proves the folder listener's reason to exist. One folder per launch keeps each test file's `before` honest about which workspace it runs in. |
| D48 | M4 PR 12a | Size: over the §0 guideline, and over item 12a's own aim for our code (≤ ~300 with comments), on two counts. `src/vscode/git.d.ts` is 411 copied lines (317 code, MIT header kept, `release/1.85`, its own commit — not review material line by line). Ours: `gitApi.ts` 489 (239 comment, 216 code, 34 blank); edits `extension.ts` +96/−43, `config.ts` +26/−114, `tree.ts` +26/−10, `.vscode-test.mjs` +67/−23, `package.json` +2/−18, comment fixes in `core/git.ts`, `core/model.ts`, `core/trunk.ts` — about 720 added non-test lines besides `git.d.ts`, roughly half of them comments; deletions `core/discovery.ts` (317), `config.ts`'s scan half, three test files (1,245). Tests: `ext/gitApi.test.ts` 861, `ext/helpers/gitApi.ts` 39, `ext-parent/parentFolder.test.ts` 88. The primer's eight "First seen in `src/core/discovery.ts`" sections (§21–§23, §36–§40), §41 and §42–§43 keep their examples with a note that the file left, §9's `extends` example is retargeted; five sections are new (§59 tagged unions, §60 another extension's API and a vendored `.d.ts`, §61 getters in object literals, §62 declaring a type parameter on a function, §63 `.then`). | The D23 question on ours — the adapter carries the whole §7.14.1 handshake, both recoveries and the rule that a handshake overtaken by a newer one or by `dispose()` leaves nothing behind — and a new cause on `git.d.ts`: a copied third-party file. Kept as one PR because the lesson is the boundary moving (§10.1 item 12a). |
| D49 | M4 PR 12b | The adapter narrows a Git-extension `Repository` to `GitRepository` — `rootUri`, `status()`, `state.onDidChange` — and relays every completed status as one `onDidRunStatus` event, re-listening per repository whenever the Git extension opens or closes one; `extension.ts` debounces that relay and the Refresh button together (`core/debounce.ts`, 250 ms), while the open/close and folder events refresh directly. The fixture's `.code-workspace` pins `git.autorefresh: false` (the §9.1 rule for `git.*` values a test needs): with the relay in place, a watcher-driven status of the Git extension's own — after E20's commit, E5's checkouts — would become a debounced refresh landing at an unpredictable moment in a later test (the cache test in `ext/tree` fails on one); the tests synchronise through `repository.status()`, which still runs. The coalescing case §9.4 and §10.1 item 12b originally called for — two `state.onDidChange` events from a fake `Repository` inside the debounce window → one `onDidChangeTreeData` — is asserted instead as `unit/debounce` (a burst → one run, counted from the last call) plus the adapter's relay in `ext/gitApi` (one event per status; a repository opened later listened to, a closed one not; nothing after dispose) — not as "one `onDidChangeTreeData` from a fake `Repository`"; the chain end to end is E20 in `ext/tree`. The Refresh button does not call `repository.status()` (§7.14.2's "may"). | A fake of the full `Repository` would be fifty-odd members for three used. The relay and the debounce are two ideas, each tested where it lives, and E20 proves the wiring live. Direct refreshes for open/close and folders keep 12a's two-refresh assertion true and draw each discrete list change at once. `status()` from the button would let Source Control catch up on E83's silent set, but the view gains nothing from it and the button stays a refresh of ours. |
| D50 | M4 PR 13a | Rebase detection is one `rev-parse --git-path rebase-merge --git-path rebase-apply` inside `computeStack`, each printed path resolved against the root and tested with `existsSync`; `computeStack` takes `directoryExists` as a fourth, defaulted parameter so the unit tests stay off the disk; the E4 path (`trunk: null`) leaves `rebaseInProgress: false` unchecked, as it leaves `head: null`; a paused `git am` counts as a rebase. Item 13 is split into 13a (core) and 13b (vscode) by §10.1's own rule, where 12a's waiver was for a deletion. | One spawn per repository per refresh, and `--git-path` may be repeated; the fixture already resolves the same way (`startConflictingRebase`). `FakeGitRunner` cannot model a directory, and the injected check is the D46 seam pattern. Nothing draws the field while `trunk` is null. `am` uses the same `rebase-apply` machinery and is among the pause points §13.4 (c) says the check must cover. Verified for git-spice's own pauses (item 22b, D64): no `.git/spice`, git's `rebase-merge/` with `head-name` = the layer being rebased, so this check needs nothing more. |
| D51 | M4 PR 13b | Row precedence in `nodesForRepo`: one row above the layers — "Rebase in progress — resolve it first" (warning) while `rebaseInProgress`, else "Detached HEAD" (info) while `head` is null — then the E5 row or the layers; E4 alone when `trunk` is null. A paused `git am` reads "Rebase in progress" too. `MessageNode`'s `contextValue` stays empty. | §7.1.0 fixes the texts but names neither icons nor an order. Every rebase pause point but `git am` detaches HEAD (git rebases on a detached HEAD on both backends — probed on git 2.50.1; `test/git/rebase.git.test.ts` pins `head === null` at the merge backend's conflict stop, `exec` and `break`, and `head` still on its branch during `am`), so two rows would say one thing twice, and the rebase row is the one that says what to do. Warning / info per D46's vocabulary: a rebase is a state the user must resolve (and M5 disables mutating commands in it, E12); a detached HEAD breaks nothing and the view still does its job (E3). The `viewItem` context values of §7.2.1, and the context key M5's `enablement` rule needs for a paused rebase, come with the commands that need them. |
| D52 | M4 PR 14 | The status bar is fed by a second provider event, `onDidLoadStates` — the states `topLevelNodes` loaded, `[]` on a failed load or no repository — and hidden on `[]` or while `prCascade.statusBar` is false (read per refresh, like every setting; not live). With several repositories it describes the first in §6 order and carries that root in its tooltip; `name` is "PR Cascade Stack", the item id `prCascade.stack`, Left / 100. E44 reads `2 of 2`, not `2 of 3`. The view is created with `createTreeView`; `refresh()` runs `getChildren()` itself while `treeView.visible` is false, and `activate()` runs it once at startup unguarded — VS Code reports visibility asynchronously, so the property always reads false there (one duplicate load per window when the view is visible at startup). Two loads can overlap, so the provider numbers them (`loads`) and only the newest speaks to the status bar. `activate()` returns `statusBar` and `treeView` only under `ExtensionMode.Test`; the hidden-view run has a live test through `treeView`. | §7.1.0's "same refresh cycle" means the one place a refresh's states exist, `topLevelNodes`; §7.14.3's "hidden in all five states" is exactly "the load rejected", classified once in the catch that already draws the row. HEAD-only membership (`--merged HEAD`, §12 item 2) makes `2 of 3` unattainable in v0.1. Ric's layout is the many-repository case, so hiding the item there would hide the feature; the active-editor rule is M6's. VS Code asks a hidden view for nothing, so without the run of our own the item would go stale the moment the Source Control pane is collapsed, which contradicts §13.4's reason for `onStartupFinished`. The Test-mode hook is the §13.4 2026-09-19 note's own mechanism; an unconditional member would rewrite that decision. |
| D53 | M4 PR 15 | v0.1.0 ships with publisher `local` (id `local.vscode-pr-cascade`) and without an icon: §11.3 lists one, but the only icon the plan names is M6's container SVG (§7.11), which vsce refuses as a manifest `icon`. The version is bumped in the PR (package.json and both lock lines); the `v0.1.0` tag is Ric's, pushed after the stack merges. `release.yml` runs on a pushed `v*` tag: the tag must equal `v<version>` and CHANGELOG.md must have that section; `npm test` but not `test:ext`; `npm run package`; the preinstalled `gh` creates the release with the `.vsix` and the CHANGELOG section as notes — no third-party action. `npm run package` joins ci.yml. CHANGELOG.md in Keep a Changelog form, no E-numbers or PR numbers (vsce turns ` #N` into issue links). The README is rewritten for users, with the developer material under one `Development` heading at the end rather than in a separate file. `unit/release.test.ts` pins version / CHANGELOG / engines on every `npm test`. Size: about 90 added lines of code and config (release.yml, ci.yml, .vscodeignore, package.json, the lock) and about 180 of prose (README, CHANGELOG.md, plan, reading order, primer) — inside the §0 guideline on D45's count, and inside it even with prose counted. | Marketplace publishing is §11.2's "later", and a publisher change later would change the extension id. A tag pushed with the workflow token starts no run, so the tag is a human step; the tagged commit is a `main` commit CI already ran on both OSes, so the release job repeats only the cheap suite. One new file and no new action keep the PR one idea. §10.1 asks every PR for tests, and the two facts the workflow guards are worth failing a push over, not only a tag. §11's skeleton lists README.md and docs/ and no contributor file. |
| D54 | M5 PR 16 | `core/forge.ts` hand-rolled over the WHATWG `URL` class plus one scp regex (`SCP_LIKE`, tried first because `github.com:org/repo.git` is a valid URL with the scheme `github.com:`; its host class excludes `@`, `:`, `/` and `[`, so an IPv6 literal is refused rather than misread); `hosted-git-info` 10.1.1 declined on function, not cost — `fromUrl()` knows only github.com / gitlab.com / bitbucket.org and returns `undefined` for `ssh://git@ghes.corp.com:2222/…`, `https://user@ghes.corp.com/…`, self-hosted GitLab, codeberg, dev.azure.com and `github.com:org/repo.git`, E21's and E65's own examples. `host` is the hostname exactly as the remote spells it (the URL class lower-cases it for the special schemes; `hostnameAsTyped` puts the spelling back, because git-spice compares hosts as text), `port` is kept apart (git-spice compares it when a configured URL names one); three disagreements with git-spice are documented and left unmirrored, all outside §7.5's list — the URL class drops a scheme's default port, reads an upper-case scheme as a URL where git-spice reads scp-like text, and re-encodes an internationalised hostname; `owner` is every path segment before the last (`group/sub` on GitLab; Azure raw until M11); `file:` refused by scheme. `detectForge(git, root, remote)` returns the tagged union `ForgeDetection` — `no-remote` / `unparseable` (a local path, the fixture's bare origin) / `forge` — instead of `Forge \| null`, each member carrying `remote`; it reads the fetch URL (`insteadOf` applied, `pushInsteadOf` not — as git-spice does). Classification mirrors git-spice 0.31.2's matching as verified (`gitSpiceMatches`, after its `remoteURLMatches`): a rejected `spice.forge.kind` (`ForgeConfig.rejectedKind`) stops it resolving any forge; a valid one wins outright, though the remote must still match that kind's own url key when one is set; otherwise each of its five forges has one base host — the url key when set (a value that is not a URL counts, as an empty host that matches nothing), **else** the default (github.com, gitlab.com, bitbucket.org, codeberg.org → forgejo; none for gitea), so a url key replaces that kind's default — and the remote matches when its host equals the base or is a subdomain of it, spelled the same, with the base's port if it names one. git-spice's forge order is unspecified (a Go map), so where two forges match the extension's id order (bitbucket, forgejo, gitea, github, gitlab) is its own tie-break and the host counts as recognised either way. `guessKind` is the extension's word for a host git-spice will not match: the default hosts and their subdomains without regard to case, `*.ghe.com` → github, dev.azure.com / ssh.dev.azure.com / `*.visualstudio.com` → azuredevops, else `unknown`; `Forge.recognizedByGitSpice` records the difference (false is E70's trigger for github — `*.ghe.com`, github.com beside a GHES url, a spelling or port git-spice rejects, a rejected kind — and E60's for unknown; always false for azuredevops — 0.31.2 has no Azure forge even with its url key). One `bitbucket` kind. Overrides come from one `git config --get-regexp '^spice\.forge\.'` (`parseForgeConfig`; exact key compare, `apiurl` ignored, last value wins, a value's trailing space kept because git-spice rejects it; the `GITHUB_URL`/`GIT_SPICE_FORGE_KIND` environment variables git-spice also honours are not read). `ghEnv(host)` returns `{ GH_HOST }` only, lower-cased as gh does; the gh runner (item 23) owns the hygiene variables. No src/vscode change; bundle delta 0 (nothing imports the file until item 20). Primer §69 (`new URL`) new; §9, §14 (`ReadonlyMap`), §20 (`exec`, groups), §23 (`toLowerCase`, `indexOf`), §49, §59 edited. Also records the §0 waiver (M5 stacked on the unmerged M4 stack at Ric's request) and the dropped "use it for a week" pause. Size: `forge.ts` 523 lines — 195 code, 304 comment, 24 blank after the follow-up commit; `unit/forge` 822 lines (133 tests), `git/remote.git` 310 lines (13). | §7.5's own URL list is the acceptance bar and the library fails it (§11.3: the cost must be proportionate to what it replaces — here it replaces nothing); E25, E21 and E60 are three messages a `null` cannot tell apart; §7.6 says the extension's copy must agree with git-spice, and the adversarial review measured git-spice's rules against the first draft and found four it missed, then three more in a second round (D54 records the mirror, not a guess); §7.5 defines GH_HOST as the hostname; §10.1's core/vscode rule. |
| D55 | M5 PR 17 | `StackBackend` declared with `kind` and `readiness(root, remote)` only and grown per implementing PR — items 20–21 add `enrich`, `track`, `push`; M7–M9 the eight others and their types (`PRPlanEntry`, `CreatedPR`, `MergeMethod`); `root` added where §4.4 omitted it and `remote` because the probe reads that setting. `Readiness` is a ten-member tagged union in probe order, first failure wins — `ready {gsPath, gsVersion, forge}` / `gs-missing {tried}` / `gs-too-old {gsPath, found, minimum}` / `not-initialized {gsPath}` / `no-remote {remote}` / `remote-unparseable {remote, url}` / `forge-unrecognized {forge, config}` (E60 for `unknown`, E70 for an unrecognised `github` or `gitlab`; `config` is the `ForgeConfig` detectForge read — a follow-up commit on PR 16 puts it on `ForgeDetection`'s `forge` member — so the message can name a rejected `spice.forge.kind` or the url key that displaced a default) / `forge-unsupported {forge}` (E75, a member) / `not-logged-in {gsPath, forge}` / `gh-missing {forge, missing[], ghVersion, ghMinimum}` (E62b's list; produced from item 23, drawn from item 19). The probe order corrects §7.13.1: forge before auth, auth asked as `gs auth status --forge <kind>`, because bare `gs auth status` exits 1 for "no remote" and "no forge found" before it reports login state; inside the forge step unknown → unsupported → unrecognised, so an Azure or Bitbucket host is never offered `spice.forge.*`. `core/gsLog.ts` hand-rolled: zod 4.6.5 classic measured 454 KB minified (over the 500 KB budget alone), `zod/mini` 16 KB on a 48 KB bundle, a functional dialect with `Invalid input` messages unless a locale is loaded; the §51 ladder costs 0 KB and no new construct — revisit at M7's `gh … --json` parser. The parser keeps `name`, `down {name, needsRestack}`, `change {id, url, status?}`, `push {ahead, behind, needsPush}` and drops `current`, `worktree`, `ups`, `commits`, `change.comments` and unknown fields alike (strip, not passthrough — the §11.3 row's `.passthrough()` note withdrawn); absent booleans → `false`; `status` stays `string`; `id` unvalidated; result `{ entries: GsLogEntry[], malformed: { line, problem }[] }`, one problem per bad line naming the path (`push.ahead is not a number`), 1-based lines, `Array.isArray` beside the `typeof`/`null` check; no trunk marker (no `down` is the trunk). `backend.ts` has no runtime code and no test file — `npm run typecheck` is its test. Bundle delta 0 (not imported until item 20). No new primer section; §9, §11, §18, §29, §51, §59 edited. Size: `gsLog.ts` 234 lines — 128 code, 94 comment, 12 blank; `backend.ts` 112 lines — 16 code, 93 comment, 3 blank; `unit/gsLog` 319 lines, 30 tests. | Additive growth of an interface breaks only implementers, and none exists before item 18 (D15's "dead code for the reader"); §7.7/§7.9's types do not exist yet; E55 names one fix at a time and §7.13.1 is one `else` per step, E62b the one two-at-once case; `gs auth status` cannot be read before the forge is known (verified 0.31.2); no consumer for the dropped fields before M7; §11.3 "proportionate" and §10.2 "hand-roll is an acceptable outcome" decide the library question, not the <30-line clause. |
| D56 | M5 PR 18 | A new module §4.2 did not list: `core/command.ts` — `CommandRunner.run(request)` with `CommandRequest { executable, args, cwd, env?, timeoutMs? }` resolving to `CommandResult { exitCode, stdout, stderr, startFailure, timedOut, detail? }`, never a rejection, because for the probe an exit code is an answer (`auth status` exit 1 = not logged in, ENOENT = not installed); `RealCommandRunner` is execFile over a Promise as `RealGitRunner`, reusing the directory check, the ENOENT/EACCES classification and the 32 MB ceiling `git.ts` now exports, with the program's stdin closed at once (`child.stdin?.end()`) and the request's timeout (Node's `killed` without a string code = timed out); env laid over `process.env`. It is the §11.3 "execFile wrapper" item 21 measures `execa` against; the interface is the seam either way. `core/backends/gitspice.ts`: `GitSpiceBackend(git, commands, gsPath = '')` implements `kind` + `readiness`. Step 1 deviates from §7.13.1's `gs version --short`: each candidate (`prCascade.gsPath` alone when set, else `git-spice` then `gs` — `gs` first as submitted; a follow-up commit swapped them once git-spice's own v0.24.0 rename came to light, see §13.1) runs `--no-prompt --version` and is git-spice iff stdout starts `git-spice <token>` — identity by the program's own name, never by exit code (Ghostscript's `gs --no-prompt --version` exits 0 and prints a bare `10.08.0`; the `version` subcommand exists only since 0.12, so an old install would read as "missing" rather than "too old"); `tried` lists every name asked. The token is read as `v?major.minor.patch` by a hand-rolled `parseVersion`/`isAtLeast` (suffixes ignored — a feature floor; `dev` → `gs-too-old` with the token as `found`), floor `0.31.0`: `semver` 7.8.5 declined at 27.3 KB minified (`gte` + `coerce`) on a 48 KB bundle, more than the `zod/mini` D55 declined, for one three-number compare. `prCascade.gsPath` defaults to `''` (= auto) in §7.3, mirroring `gitPath`; the manifest entry is item 19's. Step 2 is `git rev-parse --verify --quiet refs/spice/data` through `tryRun` (existence only; never `gs log`, §7.6). Step 3 maps `ForgeDetection` in backend.ts's order (unknown → unsupported → unrecognised). Step 4 is `auth status --forge <kind>` at root, exit 0 only, stderr unread. Step 5 absent: a logged-in GitHub repository is `ready` until item 23. Every git-spice spawn carries `--no-prompt` first, cwd = root (never `-C`), `NO_COLOR=1 LC_ALL=C GIT_OPTIONAL_LOCKS=0`, a 15 s timeout; the happy path is exactly five commands, pinned. Memo: a `Map` keyed `${root}\0${remote}` holding `ready` only (a failure re-probes on the next call; no reset — a changed setting means a new backend, item 19). "Never throws" qualified in §4.4 and backend.ts: a `GitRunner` rejection (E17) and an unusable root propagate, as `detectForge`'s do. `GITHUB_URL`/`GIT_SPICE_FORGE_KIND` are not mirrored (they reach git-spice through `process.env`). Tests: `unit/readiness` (70), `unit/command` (13, the fake's contract), `git/command.git` (10, real processes), `git/readiness.git` (3, the ref check on real git via `update-ref`); no real-git-spice test (item 22, CI has no gs). Primer §70 (`?.`) new; §13, §15, §16, §20, §27, §30, §43, §44, §46, §59 edited. Reading order items 29–35 new, 29–53 → 36–60, items 4, 5 and 26 reworded. Bundle delta 0 (nothing imports the files until item 19). Size: `command.ts` 178 lines — 72 code, 101 comment, 5 blank; `gitspice.ts` 308 lines — 128 code, 157 comment, 23 blank (after the SonarCloud split); `fakeCommand.ts` 117 lines — 55 code, 52 comment, 10 blank; `git.ts` +3 `export`, a header line and a sentence on `classifyStartFailure`; `unit/readiness` 764 lines, `unit/command` 193, `git/command.git` 172, `git/readiness.git` 103. | §7.13.1 reads exit codes as answers and backend.ts forbids throwing, so a runner that rejects on non-zero (`GitRunner.run`) or discards the exit code (`tryRun`) is the wrong shape, and the probe tries two executables, so the executable must be per request; item 23 needs the same spawn with other variables, which §7.5/D54 already assigned to a gh runner, so the runner is tool-neutral. backend.ts (D55) and §13.1 already said to try both names with the setting winning; `git-spice` goes first because it is the program's own name since v0.24.0 and the only one its official packages ship since v0.25.0 (CHANGELOG), so `gs` — Ghostscript on a Homebrew Mac, a `go install` build's name otherwise — is only met when `git-spice` is not there, and §7.3's `gitPath` set the "empty = auto" precedent. `version --short` is 2025-vintage and parse-error exit codes are not an identity, while the `--version` banner has carried the name since the first release (v0.1.0-alpha1, 2024-05-22; before the rename in #47 it read `gs <version>`, never released). §11.3's measured-cost rule and D54/D55's precedent decide semver as they decided the others; `0.31` is a feature floor, so a pre-release prefix match is right. §7.6/§13.4 (a): `gs log` initialises, so only a side-effect-free git question can be step 2. `tryRun` rethrows E17 by contract (model.ts) and `detectForge` lets it through, so the probe cannot honestly promise more; a member for a vanished root would duplicate a row the tree already draws. §10.1's core/vscode rule keeps the setting, the offers and the terminals for item 19. |
| D57 | M5 PR 19a | Item 19 is two PRs, as 12a/12b and 13a/13b were: **19a** (this row) is core only, **19b** the VS Code side. Three new core modules. `core/shell.ts`: `shellQuote` leaves a word of `[A-Za-z0-9_./:=@%+,-]` bare unless it starts with `=` (zsh's EQUALS expands `=ls` to `/bin/ls`, verified; git allows a branch named `=x`), else single quotes with `'` as `'\''`, `''` for the empty string; `shellCommandLine` joins with one space; sh, bash and zsh on macOS and Linux (every test word round-tripped through all three, and — all but the tab — through dash, ksh and an interactive bash and zsh in a pty); fish reads `'\''` correctly but `\\` and `\'` inside quotes as escapes, so a word with a backslash in it may change there (no branch name can hold one); a tab cannot be typed into an interactive shell at all; Windows shells out of scope. `core/poll.ts`: `waitUntil(check, {intervalMs, timeoutMs}, signal?) → 'done' \| 'timeout' \| 'aborted'` and `sleep(ms, signal?)`, `DEFAULT_POLL` 3 s / 5 min — §4.2's `ghstatus.ts` "waitForLogin polling" generalised for both tools (gh's `auth status` reader stays item 23's); never asks before the first interval; time counted in intervals waited, never the clock (a sleeping laptop keeps its questions), so the whole wait is 5 min plus the probes' own time; an abort cuts a sleep short (timer cleared, listener removed) but lets a question in flight finish and a yes count; a rejecting check rejects, and so does an interval that is not a positive, finite number (zero would ask without pause); the global timers, not `node:timers/promises`, so fake timers drive it. `core/readinessFix.ts`: `offerFor(NotReady, OfferFacts) → Offer { severity, message, fix: { button, action: Fix, done } \| null }` with `Fix` = terminal `argv` \| git-config `entries: { key, value }[]` \| open-url; `OfferFacts { root, remote, trunkBranch, gsPathSetting, brewPath, brewGitSpice }`; `trunkBranchFor(git, root, trunk) → TrunkBranch` (`local` \| `missing` \| `not-a-branch` \| `none`); `readyMessage`; `INSTALL_DOCS_URL`. Texts: plain sentences, no `PR Cascade:` prefix (§7.5 step 1 and §7.13.1's `"<name>: not logged in …"` wording dropped), the extension's British spelling, `warning` exactly when the user has something to do (D51's colours), at most one button and never `Cancel`. Per member: gs-missing → a sentence pointing at `prCascade.gsPath` when it is set; a sentence naming Homebrew's `git-spice` for the setting when Homebrew has one VS Code's PATH does not reach; else `<brew> install git-spice` in a terminal by the full path of the `brew` found, else the install page; gs-too-old → `<brew> upgrade git-spice` only for Homebrew's git-spice (its path, or the bare name while Homebrew has one) with a readable version, else the install page, `dev` "could not be checked"; not-initialized → `command <gs> repo init --trunk <local branch> --remote <remote>` (`command` past any alias), the branch from `git rev-parse --verify --quiet --symbolic-full-name --end-of-options <trunk>` (+ `refs/heads/<b>` for a remote-tracking ref, the remote's segment taken from the ref, not `prCascade.remote`), sentences for a missing local branch (naming `git branch <b> <trunk>`, quoted), a trunk that names no single branch, and no trunk; no-remote (warning) and remote-unparseable (information) sentences; forge-unrecognized → a rejected `spice.forge.kind` first, E60, and an explicit kind whose url key the remote misses are sentences, else E70's `git config spice.forge.<kind>.url https://<host>` (git, local file, host as spelled, no port; `https://github.com` for a subdomain of github.com) with `spice.forge.<kind>.apiUrl` beside it under one button "Set GitHub URLs" / "Set GitLab URLs" (GitHub: `https://api.github.com`, `https://api.<host>` for `*.ghe.com`, `https://<host>/api` as a fallback detectForge does not reach today — git-spice guesses `<url>/api` for any url but exactly `https://github.com`, wrong for `*.ghe.com` and for github.com spelled otherwise; GitLab: the url itself, git-spice's default — written so a stale `apiUrl` cannot apply), in three wordings (unset, displaced — with the configured port when it has one, not a URL); forge-unsupported and gh-missing information sentences; not-logged-in → `env -u GITHUB_TOKEN\|GITLAB_TOKEN <gs> auth login --forge <kind>` in a terminal. `backend.ts` gains `Ready` / `NotReady` (`Extract` / `Exclude`); `GitSpiceBackend.forget(root, remote)` on the class only (D55). Cut from the design panel's synthesis: a "Set prCascade.gsPath" button fed by a list of known install paths (the Homebrew case is now a sentence naming the path), and the rejected kind's unset button with its `--show-scope` question. **Two commits:** the first was written by Claude Opus 5.5 (the session ran on it by mistake); the second is a review by Claude Fable 5.1 with three independent reviewers (docs, facts and edge cases, mutation testing — 234 mutants, 211 killed, 16 real gaps closed) — it made `Fix`'s middle kind `git-config` with entries (was `git` with one `args` list) for the forge's `apiUrl`, ran `brew` by its full path, told a Homebrew install apart by `brewGitSpice` rather than by the name `git-spice`, added `command` to the init line, refused a non-positive interval, quoted the command in the missing-branch sentence, and corrected the comments and docs listed in its message; and it put `git-spice` before `gs` in #32 (a follow-up commit there, §13.1). Libraries: `shell-quote` 1.12.0 passes every §11.3 floor but bundles to 5.9 KB minified (`quote` alone) on a 48 KB extension for ten lines, and writes `a\=b`, `\$HOME`, `--forge\=github` — backslashes in the line the user watches run; declined. `p-wait-for` 6.0.0 (2.2 KB) fails two floors — last release 2025-09-21, one maintainer at 3.1M downloads/week; declined. Tests: `unit/shell` (37), `unit/poll` (20), `unit/readinessFix` (55), `git/trunkBranch.git` (9), `unit/readiness` +2. Primer §71 (AbortController, AbortSignal, an abortable sleep, a loop counted in milliseconds) new; §15, §23 (`replaceAll`), §27 (`15_000` — a gap from M4), §41 (`Number.isFinite`), §43, §44, §46 (`delete`), §49 (`Extract`, `Exclude`), §59, §65 (`advanceTimersByTimeAsync`, `getTimerCount`) edited, three headings with them. Reading order items 36–42 new, 36–60 → 43–67, items 26, 33 and 34 reworded. Bundle delta 0 (nothing imports the files until 19b). Size: `shell.ts` 58 lines — 10 code, 45 comment, 3 blank; `poll.ts` 98 — 38, 55, 5; `readinessFix.ts` 474 — 263, 189, 22 (the sentences and the object literals around them, one field per line, are most of the code lines): 311 code lines in all, against §0's ~300 (D23 still open on comments); `backend.ts` +30/−12, `gitspice.ts` +21/−5, `forge.ts` +3/−2 (a stale header); `unit/shell` 118, `unit/poll` 337, `unit/readinessFix` 765, `git/trunkBranch.git` 128, `unit/readiness` +47/−1; one-line primer pointers in four older test files. | §10.1 keeps core and vscode in separate PRs and §0 aims at ~300 lines; the panel's one-PR design was ≈ 385 code lines across both layers, and items 16–18 already landed core that nothing called until later, so 19a is that shape. Verified 2026-10-06/08 with git-spice 0.31.2: `repo init` refuses `--trunk main` and `--trunk origin/main` while only `origin/main` exists ("not a branch") and succeeds once `git branch main origin/main` has run; `GITHUB_TOKEN=x` / `GITLAB_TOKEN=x` make `auth status --forge` exit 0 "currently logged in" and `auth login` refuse "already logged in", `--refresh` refusing too — `env -u` gets past it (present in BSD, GNU and BusyBox `env`); `rev-parse --symbolic-full-name` prints `refs/remotes/origin/main` for `origin/HEAD`, nothing for a commit or an ambiguous name, `refs/tags/v1` for a tag, and treats `--all` as a name after `--end-of-options`; git-spice's GitHub forge sends GraphQL to `<apiUrl>/graphql` and derives `apiUrl` as `<url>/api` from any url but exactly `https://github.com` (source at v0.31.2), while GHE.com's API is `api.<host>` (gh does the same), and its GitLab forge takes `apiUrl` or else the url; git-spice's CHANGELOG renames the binary to `git-spice` in v0.24.0 and drops `gs` from GitHub Releases, Homebrew and the AUR in v0.25.0, so the name `git-spice` no longer marks a Homebrew install; VS Code resolves the login shell's environment at startup when not launched from a terminal (the 1.140 bundle's "Unable to resolve your shell environment"), which is why the PATH button was cut — the sentences name VS Code's PATH and `prCascade.gsPath` instead; a `gs` alias is common in zsh frameworks (prezto: `alias gs='git stash'`), and an alias takes a typed `gs repo init` over (confirmed in a pty). A prefix repeats what VS Code's notification already shows; a `Cancel` is the close button twice; E55 asks for "the matching one-click fix", one per member. E70's URL has no port because a remote's port is usually ssh's; an explicit `spice.forge.kind` mostly serves an ssh alias, whose host is no URL to offer. §7.5's poll numbers, and D56's "a failure is never memoized" making the probe the poll; the plan wrote `signal` into the poll's signature. |
| D58 | M5 PR 19b | The VS Code side of item 19. `vscode/terminal.ts`: `runInTerminal(host, name, cwd, argv, usable?)` over a `TerminalHost` (`window.terminals`, `createTerminal`, `onDidCloseTerminal`, handed in by `extension.ts` as `GitExtensionHost` is), one terminal per repository named `PR Cascade: <folder>` at its root, reused while its shell lives by name **and** directory (two repositories of one folder name keep their own) and when `usable` says so, the line `cd <root> && <argv>` from `shellCommandLine` with Enter, then `show()` taking the focus. `vscode/login.ts`: `ReadinessFlows.ensureReady(request) → 'acted' \| 'not-ready' \| 'gave-up' \| 'in-flight'` — probe → offer (`offerFor`, 19a) → the click → **a look again** (when the probe's answer changed meanwhile the pass starts over: a notification can be answered long after it was shown, and a second `gs repo init --trunk <other>` silently replaces the trunk on 0.31.2) → the fix (terminal / `git config` entries / browser — a page the user will not let VS Code open ends it, `gave-up`) → for a terminal or a page `waitUntil` the probe gets **further** than the member offered (`progressOf`, §7.13.1's order: a probe timing out mid-login says `gs-missing`, which is no login), or for an install until Homebrew's `git-spice` appears beside `brew` (the next offer then names its path for `prCascade.gsPath` instead of the wait running out) — stopped by the close of the fix's own terminal and then one last look → `refresh()` (E83) → the done line → the next pass, until ready and `action(ready)`; at most `MAX_STEPS = 10` passes; a button-less notification is shown and not awaited; one fix in flight per **repository** (§7.5 step 4 says per host — a repository owns the terminal and directory, and one login serves every repository on its host), claimed at the click, never while a notification is open; a second click shows the running fix's terminal, or opens its page again (nothing is shown during the moment a `git config` fix or the look again takes); a terminal whose wait timed out is not reused (it may still sit in the prompt); `dispose()` stops every wait with no last look, log or notification, a fix still starting when it comes starts no wait, and an answer that arrives after it is `gave-up`; a terminal whose wait ended without passing — timed out, a probe that failed, the window closing — is not reused, and closed ones are forgotten. Everything VS Code does for it comes through one `ReadinessHost` (`prompt`, `pick`, `openExternal → boolean`, `terminals`, `machine`), read at every use. `machineFacts(exists)`: the first of `/opt/homebrew/bin/brew`, `/usr/local/bin/brew`, `/home/linuxbrew/.linuxbrew/bin/brew`, and the `git-spice` beside it. `chooseRepository`: none → "No git repository in this workspace."; one → it; several → a quick pick of folder names in §6 order (full paths when two names are the same). **A new command, `prCascade.setUpGitSpice` ("PR Cascade: Set Up git-spice"), Command Palette only** — §7.2's list is authoritative and has none: without it the flow would be reachable only through a test hook until items 20–21 (pending decision 7a: the extension-host layer reaches production through VS Code), and this repository reaches `not-logged-in` for real, so Ric can try it the day it lands. It probes with `fresh` (the backend `forget`s the remembered `ready` first — asked by hand, the user may just have logged out) and ends in "git-spice <version> is ready for <repo> (<host>)."; it returns the flow's outcome, which is what `executeCommand` hands the test. `extension.ts`: `backendFor` keeps one `GitSpiceBackend` per window, rebuilt when the git executable, `prCascade.gsPath` or the command runner changes (D56's "a new backend"); `probeFor` goes through `connectedGit` on every call (`gitPath` and `gsPath` read afresh; the remote and the trunk fixed when the flow starts); `repositoryRoots` split out of `loadRepoStates`. `readinessDeps { commands, host, poll }`, the seams the flow reads and from whose `commands` the backend is built, is handed out under `ExtensionMode.Test` only (§13.4's M5 design note), and the test assigns fakes to its fields. `prCascade.gsPath` in package.json (default `""`) and `readSettings`. Deferred: the "decline remembered per workspace" of §7.13.1 / E62 — the by-hand command is the only caller until item 20, and asking it is asking again, so a memento would change nothing before then. Libraries: none considered — every piece is VS Code API or the core of 19a. **Reviewed** before the commit by three independent reviewers (behaviour and VS Code API; docs against code; mutation testing — 131 mutants, 104 killed, 21 gaps closed with tests — and a fourth on the result, 100 more mutants and a dispose bug fixed): the look again at the click, the progress rule, the Homebrew wait rule, the declined page, the `cd`, the abandoned terminals and `gave-up` after `dispose` came from that review. Tests: `unit/terminal` (12), `unit/login` (59, fake timers), `ext/login` (7); `test/helpers/fakeReadinessHost.ts`. Primer §72 (terminals) and §73 (notifications with buttons, a constrained type parameter, the quick pick, the browser) new; §9, §13, §16 (spread into a call, a rest parameter, spreading a Set or a Map's keys), §19 (`keys`, `values`), §21 (`Set.size`), §25 (`indexOf`, `every`, `some`), §28, §33 (a function that returns one), §56, §60 (`Promise.resolve` of a Thenable), §63 (`.then`'s second function), §68 (a hook to change, not to read) edited. Reading order items 50–54 and 60 new, 50–54 → 55–59, 55–67 → 61–73, items 1, 2 and 43 reworded. README "git-spice setup" (the offers incl. Upgrade, the PATH note, the main login methods per forge, the token note), Requirements, Settings, What's next, Layout; CHANGELOG `[Unreleased]` Added. Bundle 47.3 KB → 85.0 KB unminified (esbuild's sizes), all our own code: the M5 core modules of items 16, 18 and 19a enter it for the first time (`readinessFix.ts` 9.7 KB of it, mostly sentences; `gitspice.ts` 5.9, `forge.ts` 5.2) with `login.ts` (10.4). Size: `terminal.ts` 90 lines — 37 code, 47 comment, 6 blank; `login.ts` 462 — 264, 173, 25 (after the SonarCloud S3776 follow-up split one pass of `ensureReady` into `onePass`); `extension.ts` +166/−22, `config.ts` +10/−2, `package.json` +10 — about 380 code lines in all, over §0's ~300: the review's seven rules are most of the growth, and splitting the flow from its wiring would leave a PR whose flow nothing calls (D23 still open on comments); `fakeReadinessHost.ts` 243; `unit/terminal` 172, `unit/login` 1217, `ext/login` 359. | §4.2 names `terminal.ts` and `login.ts`, §7.5 gives the steps and the numbers, §7.13.1 the offers, E55 "the action re-runs after", E83 the refresh. Per repository because the terminal and the directory are per repository; at the click because a notification can stay open indefinitely in the notification centre; a look again at the click for the same reason (verified with git-spice 0.31.2 that `repo init` on an initialised repository re-initialises it with the new trunk). "Further, not just different" because a failing probe can look like progress. The host object is `GitExtensionHost`'s pattern (D46) and what lets Vitest load the flow with fake timers — the only place 3 s / 5 min and an abort mid-sleep can be pinned in milliseconds; the extension-host test then proves the wiring with a 50 ms poll. VS Code asks before opening a site it does not trust (`abhinav.github.io` is not in the 1.141 `linkProtectionTrustedDomains`) and `openExternal` answers `false` on a no — hence the page rule. The command is a deviation recorded here rather than a test hook, because a hook reachable only in tests would leave the flow unused for two PRs. |
| D59 | M5 PR 20a | Item 20 is two PRs, as 13a/13b and 19a/19b: **20a** (this row) core only, **20b** the VS Code side. A new module §4.2 did not list: `core/digest.ts` — `DIGEST_ARGS`, `readRefDigest(git, root)` (one `for-each-ref --format='%(refname) %(objectname)' refs/heads refs/remotes refs/spice`, stdout verbatim through `run`) and `isInitialised(digest)` (a line `refs/spice/data <sha>`, matched at a line start with its trailing space — the probe's step-2 fact read off text already in hand). **The digest is that text alone; `state.HEAD` is not in it** (§7.14.2, §9.4 and §10.1 wrote `name`, `commit`, `upstream.commit` in): with `--all` the lines `gs log` prints are identical from an untracked, a tracked and a detached HEAD except `current`, which the parser drops (D55), and `gs branch checkout` writes nothing under `refs/spice` — so HEAD would only buy one 0.6 s `gs log` per checkout — and the memo is applied to the layers as the checkout left them, by name; 20b therefore leaves `GitRepository` at its three members. `core/model.ts`: `StackLayer.tracking?: GsLogEntry \| null` — the parser's own line, absent until `enrich` ran (never `undefined`-assigned, so computeStack's output and every existing test are unchanged), `null` when a complete answer did not list the branch, an entry when it did; no new layer type and nothing derived early (`ahead`/`behind`, an absent `push`, `down.name` stay for M6's `neverPushed`/`baseDrift`/`needsPush{ahead}`); an entry with no `down` is git-spice's trunk line, which the local trunk branch receives when it is ahead of the remote-tracking ref the stack is measured against (verified: `for-each-ref --merged HEAD --no-merged origin/main` lists it as a layer and `gs log` prints it as trunk; `gs branch track main --base main` → "cannot track trunk branch"); `RepoState.enrichment?: Enrichment` (`enriched {ranGsLog, malformed}` \| `not-enriched {cause: EnrichmentCause, reason}`, the cause one of `not-initialised` / `gs-missing` / `gs-too-old` / `gs-log-failed` so a command can tell what the setup flow would fix from what it would not) for the Output channel — core never logs; `model.ts` now imports two types from `gsLog.ts`, whose header and two doc comments name `gs log short --all --json` and `model.ts` as a dependant. `core/backend.ts` grows `enrich(state): Promise<RepoState>` (§4.4's shape; `opts.network` is not accepted until M7 implements it — D55) and `track(root, layers, trunkBranch: TrunkBranch): Promise<TrackResult>` (`{ tracked, problem \| null }` — not §4.4's `void`: the backend never throws for anything git-spice can be in, as `readiness` promises, and the command's message needs the count and git-spice's words; `TrunkBranch` handed in by the caller — `layers[0].parent` is `RepoState.trunk` — through a type-only import of `readinessFix.ts`, which imports `parseVersion` from `gitspice.ts` at runtime, so a runtime import the other way would be a cycle; `backend.ts` and `readinessFix.ts` now name each other's shapes, both as types). `GitSpiceBackend.enrich`: the same object back for no trunk or no layers; one `readRefDigest`; no `refs/spice/data` line → `not-enriched` with **zero git-spice spawns** (§7.6, enforced in core as a unit-tested invariant, so the refresh path never probes — a non-`ready` repository such as the E21 fixture would otherwise cost a five-command probe per refresh); an equal digest → the memo `logByRoot: Map<root, {digest, byName, complete}>` applied by name (`ranGsLog: false`, `malformed: []`); else `locateGitSpice` (the probe's own step 1, one 20 ms spawn, only right before a `gs log`; its return type narrowed to `LocatedGitSpice \| NotLocated`, the two members it can produce; `gs-missing`/`gs-too-old` → `not-enriched` in readinessFix.ts's own sentences, spelled a second time in gitspice.ts because the import would be the cycle above — `unit/enrich` pins that the two agree, for the setting set (`prCascade.gsPath is <path>, which did not answer as git-spice`) and not (`not found in VS Code's PATH (tried …)`); the offer's Homebrew-path sentence needs the disk and stays the VS Code side's; nothing stored) then `--no-prompt log short --all --json` (cwd root, GS_ENV, 15 s) — `--all` is not §7.13.3's bare command: from a tracked HEAD the bare command prints HEAD's stack only, so §7.8's "absent = untracked" held only by accident; same 0.63 s; a non-zero exit, a timeout or a program that never started → `not-enriched` with stderr's first `FTL ` line (git-spice prints `INF` lines before it on an auto-init failure — verified); else, for a run the timeout killed, `timed out after 15000 ms` (an `INF` line printed before the kill is not the reason); else its first non-empty line / `exited N` / `could not start (<why>)` / Node's detail — no `tracking`, the memo untouched; success → new state and layer objects, the later of two lines naming one branch winning, `tracking` = the entry, or `null` when the answer was complete, or **no key when a line was malformed** (a `MalformedLine` names no branch, so an unlisted layer is unknown — `null` would read `not tracked` and let Track Stack re-track a tracked branch, moving its base); the memo keeps `complete` with `byName`. `gs log` is not quite read-only: when it prunes a branch deleted out of band it moves `refs/spice/data` while printing (verified), so the next refresh runs it once more and then hits the memo — and item 22's "writes nothing under `.git`" pin must be written on a fixture whose tracked branches all exist. `GitSpiceBackend.track`: only `tracking === null` layers in the order given (a tracked layer — a second `track` silently moves its base, verified — the trunk line, a not-enriched and an unknown layer are left alone); nothing to do → `{ tracked: [], problem: null }` with no spawn; else `rev-parse --verify --quiet refs/spice/data` first (`gs branch track` on an uninitialised repository tries to initialise it and dies at the trunk prompt under `--no-prompt`, writing nothing — verified; a sentence instead) and `locateGitSpice` — two spawns a caller who just ran `enrich` has already paid for, kept because `track` is a backend member any caller may use and the invariant belongs beside the spawn — then per layer `--no-prompt branch track <name> --base <base>` — the layer below's name, or for the first layer `trunkBranch.branch` when `local` (`--base origin/main` is refused), else a sentence naming `git branch <b> <trunk>` (quoted by `shellCommandLine`) or `prCascade.trunk` and nothing run — stopping at the first non-zero exit with `git-spice could not track <name>: <stderr line>.` and the names tracked so far. Every `problem` is a full sentence (`Nothing was tracked: …` for the two guards), because 20b shows it as it is; `enrich`'s `reason` stays a phrase, because the Output line embeds it. Texts live in core beside the methods. The §9.4 argv rows for `track` and `enrich` are `unit/enrich` and `unit/track` (both fakes), not `ext/backend-gitspice` (D56's precedent: the backend is core); `unit/digest` has no HEAD cases. Libraries: none considered (a string compare; `createHash` declined as a construct for no gain). Tests: `unit/digest` (6), `git/digest.git` (5), `unit/enrich` (27), `unit/track` (13); `unit/readiness` untouched; `npm run test:ext` unchanged at 97 (nothing under `src/vscode` changed). Bundle: `extension.ts` already imports `gitspice.ts`, so the new code ships now — `npm run analyze`'s `dist/extension.js` 85.5 KB → 96.9 KB (+11.4 KB): `gitspice.ts` to 13.9 KB, `gsLog.ts` (3.0 KB) entering the bundle because `enrich` is `parseGsLog`'s first importer, `digest.ts` 317 B. Primer: no new section; §9, §11, §20 (the `m` flag), §46, §51, §54, §59, §70 edited. Reading order items 43–47 new, 43–73 → 48–78; items 3, 26, 27, 33 reworded. Size: `digest.ts` 60 lines — 9 code, 46 comment, 5 blank; `model.ts` +7 code, `backend.ts` +8, `gitspice.ts` +147 (now 615 lines — 278 code, 300 comment, 37 blank) — 171 code lines in all, comments on top (D23 open); `unit/enrich` 602 lines (27 tests), `unit/track` 319 (13), `unit/digest` 78 (6), `git/digest.git` 134 (5). | §10.1's core/vscode rule and §0's ~300 lines; §7.14.2 names `for-each-ref` as the input and says `gs log` runs only when it changed — observable only when the skip is in core behind a plain string; the same section's reason for keeping HEAD ("a plain checkout moves HEAD without moving any object name") existed because the bare `gs log short --json` prints HEAD's stack only (verified: from a tracked `c` it prints `a b c main`, from a tracked `x` only `main x`), a dependence `--all` removes — what remains HEAD-dependent is `current`, which the parser drops (D55); §7.6/§13.4 (a)/D56 forbid `gs log` on an uninitialised repository — today it would not initialise but die at the trunk prompt (the 2026-10-01 exit 0 did not reproduce; §7.6 corrected again), and either outcome is one to prevent — and the `branch track` measurement extends the rule to `track`; §4.4 "Degrades" and E57 "no stack info, tree still renders" decide the failure shape, E59 "tree works" that nothing nags; D55 "grow when read" decides the model (the parser's line is the local tier) and the absent `opts`; the brief's "re-running `track` with another base silently moves it" decides that an incomplete answer may not call a branch untracked; backend.ts's "never throws for anything git-spice can be in" decides a result over a throw; §7.8's rule with the `--all` measurement; §3 "Read model" — object names only; §11.3's proportionate rule for no hash and no library. |
| D60 | M5 PR 20b | The VS Code side of item 20. `vscode/tree.ts`: description `<n commits>[ · <id>][ · needs restack][ · needs push][ · not tracked][ · current]` — the CR id as git-spice spells it, then the to-dos in the order to do them, then the exclusive state, `current` last as before; nothing from git-spice while `tracking` is absent (E57: the rows as built), for a tracked layer with nothing to say, or for git-spice's trunk line; `contextValue` `stackBranchWithPR` (+`Current`) when a `change` exists, else `stackBranch` (`…WithDraftPR` waits for gh's `isDraft`, M7); the tooltip's third line `git-spice: tracked on <down.name>[ · needs restack][ · needs push]` / `git-spice: not tracked` / `git-spice: trunk`, then `<id> <url>` — the to-dos repeated because VS Code elides a long description from the right and hover must recover them; line 3 names git-spice's branch, which for the bottom layer is the trunk's local name (`main`) beside line 2's measured ref (`origin/main`): not drift, and no drift computation (M6's `baseDrift`); labels and icons unchanged (E44). `extension.ts`: one root's load split out as `loadRepoState` (trunk → stack → `backend.enrich` through the window's one backend → `logEnrichment`'s Output lines: `git-spice tracks K of N layer(s)`, `(unchanged — gs log not run)`, one line per malformed line plus `layers it did not list are left unknown`, or `no git-spice tracking info — <reason>`); `lastStates` and the context key `prCascade.hasUntracked` set with `executeCommand('setContext', …)` in the one `onDidLoadStates` listener (primer §74; the device §7.11 already uses for `prCascade.hasStack`). **A new command `prCascade.trackStack` ("Track Stack with git-spice")** in `view/title` `2_stack@8` under `when: view == prCascade && prCascade.hasUntracked` (§7.2.1 verbatim) and the palette, in three parts: `untrackedRepositories` — nothing loaded (`lastStates` `[]`: a failed load, no repository, or the first load in flight) → "The Stack view has no repository loaded — refresh it first." (warning, D57: an action is named); no layers anywhere → "Nothing to track — the Stack view shows no layers." (information); the candidates are the last load's repositories with a `null` layer; none → one sentence — a not-enriched repository's `No git-spice tracking info for <folder> — <reason>.`, with ` Run PR Cascade: Set Up git-spice.` as a warning when its `cause` is one the setup flow fixes (not initialised, git-spice missing or too old) and as information without the hint when `gs log` itself failed (the flow would report ready and fix nothing), else "Every layer in the Stack view is already tracked by git-spice." (information) — and no refresh in any of these; then `chooseRepository` with the placeholder "Track the stack of which repository with git-spice?" (a third, defaulted parameter); then `trackIn` under a `finally` that refreshes **exactly once** (E83's first command instance; success, failure or refusal): the chosen root **re-loaded fresh** (`loadRepoState`: a `gs branch track` typed in a terminal is seen by no watcher, so the last load may show `not tracked` for a branch already tracked, and re-tracking it would move its base silently), **refused during a paused rebase** with "Rebase in progress in <folder> — resolve it first." (E12's row text; git-spice itself tracks during one — verified 0.31.2), "Not on a stack in <folder> — nothing to track." when the fresh load has no layers (the one state with no `enrichment` key, so `reason` is never read undefined), the not-enriched sentence, "Every layer in <folder> is already tracked by git-spice.", else `track(root, layers, await trunkBranchFor(git, root, trunk))` and one sentence: "Tracked N branch(es) with git-spice in <folder>." or core's `problem` as a warning, verbatim (every `problem` is a sentence, D59). **Deviations recorded here:** (1) **not gated on `ensureReady`** — E59 says "CR/stack actions show the init offer", E55 "any missing piece → the matching one-click fix … and the action re-runs after", §7.7's preflight runs the readiness flow before `track`, and §10.1 item 19b, login.ts and extension.ts said "items 20–21 gate their actions on it"; for this one command it is a sentence naming the setup command, no button, no re-run, because `ensureReady` can never pass for a forge-less repository (the fixture's bare origin, E21 → `remote-unparseable`, which has no fix) and a local operation must not demand a login (`branch track` works against a bare local origin — verified), while a `goal: 'initialised'` would edit #34's `onePass` past S3776; the menu item exists only after `enrich` succeeded seconds earlier (git-spice located, new enough, initialised) and `track` re-checks all three itself; "items 20–21 gate on `ensureReady`" is kept for item 21 (`push` needs the login). (2) **no `enablement`** — §7.2.1 greys out every mutating `…` item during a rebase; the refusal is in the command (one `if` after the fresh load, which the last load might predate), and the `enablement` with its `prCascade.rebaseInProgress` key comes with item 21, whose §10.1 line owns "refuse during rebase" (D51: the key "comes with the commands that need them"). The command returns `TrackResult \| undefined`, which `executeCommand` hands the test. `ext/login`'s `fakeGitSpice()` cans `gs log` (after the init fix the E83 refresh enriches through the fake, which throws for a command nobody canned). `GitRepository`, `git.d.ts` and the gitApi fakes unchanged (no HEAD, D59). Deferred still: the decline memory (D58) — nothing nags on refresh. Libraries: none. Tests: `ext/tree` +6 (the texts, the vocabulary, the tooltips with the to-dos, nothing when not initialised with zero spawns, nothing when git-spice is missing or `gs log` fails, the digest live — one `gs log` for two loads, a second after `refs/spice/data` moved, none after a checkout), `ext/commands` (new, 10: registered + the manifest entry, bottom→top with one refresh and the sentence, the fresh load not the last one, nothing untracked, not initialised, a failure mid-way still refreshing once, not on a stack anywhere, nothing loaded, the stack emptied between load and click, a paused rebase refused), `unit/login` +1 (the placeholder); `test:ext` 97 → 113 (111 in the fixture launch, 2 in the parent one; +16), run twice in a row. Rules the ext tests keep: the fake runner is installed *before* `refs/spice/data` is written (`backendFor` reads `readinessDeps.commands` when a load reaches it, so a stray load in flight would otherwise run the real git-spice on the fixture); a case that refreshed awaits that refresh's `onDidLoadStates` before its `finally` touches anything (a VS Code-initiated load left in flight outranks the next case's `prime()` load and silences its states event); `prime()` waits for the states event, not just `getChildren()`; the drain's outcome is thrown away (a rejection inside a `finally` would skip the cleanup after it); every `refs/spice/data` written is deleted in that case's `finally` (a defensive `before` too; `update-ref -d` exits 0 on a missing ref), a new runner per case; `node:assert`'s `deepStrictEqual`, never identity, for `GS_ENV` (`out/`'s copy is not the bundle's). Primer §74 new, §68 edited. Reading order item 66 new, 66–78 → 67–79; items 1, 2, 51, 56, 61 reworded. README "What you see", "Refresh", "git-spice setup" (a "Tracking" paragraph); CHANGELOG `[Unreleased]`. Bundle (`npm run analyze`): 97.4 KB (#35 as committed — D59's 96.9 was measured before its review fixes) → 103.5 KB (+6.1 KB; `tree.ts` 12.7 KB, `extension.ts` 11.8 KB). Size: `tree.ts` +36 code (532 lines — 232 code, 275 comment, 25 blank), `extension.ts` +121 (741 — 318, 387, 36), `login.ts` +4, `package.json` +10 — 171 code lines in all, comments on top (D23 open); `ext/tree` +230 lines (29 tests), `ext/commands` 540 (10). | §7.8's texts and §7.2.1's vocabulary, group and condition are followed to the letter; §7.1.0 fixes `· current` as the suffix; §7.1.0 "updates on the same refresh cycle as the tree" / D52's `onDidLoadStates` for the status bar is the same rule for the context key and `lastStates` (and tree.ts fires `[]` on a failed load, which is why `[]` cannot mean "all tracked"); E83 "every command of ours refreshes explicitly afterwards" (`gs branch track` writes only `refs/spice/data`), and the same E83 fact is why the action cannot trust the last load; E12 "`pushStack`/`checkout` refuse with a message" and tree.ts's E12 row ("the one in which M5's commands will refuse to run") decide the rebase refusal, §10.1 item 21 where the `enablement` lands; E44 keeps labels as branch names; E57/§7.8 "without touching the tree" rule out a message row; D57's severity rule (warning when a command is named) decides the hint's colour, and the hint only where the flow would fix the cause; E59/E55/§7.7 are the lines deviated from, measured against E21 (no fix for an unparseable origin) and the `branch track` facts; pending decision 7a (the command reaches production through VS Code and the tests run it through `executeCommand`) and 7b (the notifications asserted word for word). |
| D61 | M5 PR 21a | Item 21 is two PRs, as 19a/b and 20a/b: **21a** (this row) core, **21b** the VS Code side. `backend.ts`: `PushResult { pushed, notes, problem \| null }` and `push(root, layers)` — `TrackResult`'s shape plus `notes` (every stderr line that is not `INF Pushed`, trimmed, in order: the `<name>-2` rename's two `INF` lines, a `WRN`, the `ERR` remedy lines — said there and nowhere else, written to the Output panel by 21b), D59's reasons, §4.4's two parameters kept (tracking is the caller's: §7.7's preflight, and `trunkBranch` is the caller's question). `gitspice.ts`: `push` — in order, each a sentence and no spawn that moves a ref: no layers → nothing run (from trunk git-spice would push every tracked branch of every stack, none of which the view shows — verified); no `refs/spice/data` → `Nothing was pushed: the repository is not initialised …` (`stack submit` auto-initialises and dies at the trunk prompt under `--no-prompt`, exit 1, nothing written — verified); **a layer with `tracking.push.behind > 0`** → `Nothing was pushed: <names> has/have commits on the remote that are not here. Bring them in first — a push would drop them.` — E76's refusal: the lease protects an unfetched clone only; after `git fetch`, `gs log` says `behind: 1` and `stack submit --no-publish` overwrites the remote's branch with exit 0, a diverged branch too (verified 2026-10-09); `behind > 0` rather than E76's "diverged" because the strictly-behind case is overwritten as well; before the banner, since it needs no executable; git-spice missing/old → track's sentences; a layer with `tracking.down.needsRestack` → `Nothing was pushed: <names> need(s) a restack. Run <gs> stack restack in a terminal first.` with the executable that answered spelled through `shellCommandLine` (git-spice pushes the layers below it and then refuses `refusing to submit outdated branch` — a partial push; `--dry-run` refuses the same way, verified; a `git pull` on trunk marks the bottom layer and is the everyday trigger — verified; **this guard does not read `spice.submit.skipRestackCheck`**: a user who set `always` has git-spice push with a `WRN`, and is still refused here — the terminal is the way round, item 21b's README says so); then `--no-prompt stack submit --no-publish --no-update-only`, cwd root, `GS_ENV`, `PUSH_TIMEOUT_MS = 120_000` through `gs()`'s new defaulted parameter — **`--no-update-only`** because `spice.submit.updateOnly = true` in a user's config would otherwise skip every branch without a CR, exit 0, and read as "Pushed 0 branches" (verified; the explicit flag overrides the config as `--no-publish` does `spice.submit.publish`); from wherever HEAD is (no `--branch`; from a middle layer the whole stack, from trunk every stack — verified); `pushed` from the `INF Pushed <name>` lines (printed again when nothing is new — no "up to date"), `notes` from the rest; exit ≠ 0 → `git-spice could not push the stack: <phrase>.` with `pushed` and `notes` beside it. **The timeout is a budget against a hang, not a cancel** (verified): `execFile`'s SIGTERM reaches git-spice alone, a `git push` it had started — and its pre-push hook — finish on their own, the branch lands on the remote with no upstream recorded here and `refs/spice/data` unmoved, and the next push renames that branch's upstream to `<name>-2`; the recovery is `git fetch origin` + `git branch --set-upstream-to=origin/<b> <b>` (verified), item 21b's README names it, and the process-group kill (`spawn` with `detached: true`, `process.kill(-pid)`) that would stop git's push too is item 22's, with a real remote measured — it changes the shared runner and behaves differently on Windows — **done in item 22a (D63)**. **The `<name>-2` rename** is surfaced, not guarded: when the remote already has `<name>` and no upstream is recorded for the local branch — an unrelated branch, our own commit pushed from another clone, a plain `git push origin <name>` without `-u` from this clone, a push cut off at the timeout — git-spice pushes to `<name>-2`, sets `branch.<name>.merge` to it and says so in two `INF` lines only (verified); a guard would need `ls-remote` or a per-layer comparison of `refs/remotes/<remote>/<name>` with the upstream, left for item 22 — **deferred to M7 item 26 (D64)**. `GS_ENV` gains `GIT_TERMINAL_PROMPT: '0'` (stdin closed since D56; git prompts on the tty, this makes it `fatal: could not read Username … terminal prompts disabled` at once; a working push unchanged — verified). `describeResult(result, timeoutMs)`, in four functions (`nonEmptyLines`, `isFtl`, `relayedGitLine`, itself — the one-loop form measured cognitive complexity 21 against SonarCloud's 15, these 7 and 4): the first `FTL` line plus ` — ` and the first later `FTL` line that is not `stderr:`, not empty and not git's `To <url>` header, blanks collapsed — push failures bury git's own words under that marker (`! [rejected] <sha> -> a (stale info)` for a remote moved by another clone and not fetched — force-with-lease, no `--force`; `remote: error: cannot lock ref … reference already exists` for two pushers at once; `fatal: 'origin' does not appear to be a git repository` for no remote, and the same shape for a github.com remote with no login: `--no-publish` never reaches the forge); `enrich`/`track` phrases unchanged (one FTL line each), one row each proves the rule reaches them; `timed out after <timeoutMs> ms`. An untracked layer is not guarded here: a caller that just ran `track` still holds `tracking: null` layers, and git-spice itself skips an untracked middle layer silently and refuses an untracked HEAD (verified) — the caller tracks first (§7.7). **execa declined** (card in the PR body): 10.1.0 = 120.8 KB minified against 513 B (esbuild 0.25, node18, cjs) on a 103.5 KB extension, for ~70 code lines `core/command.ts` already has; cancellation not needed, and its kill is the one pid's too. Tests: `unit/push` (23), `unit/enrich` +1 row, `unit/track` +1 row, `unit/readiness` one literal; `test:ext` unchanged. Primer §20 (the `g` flag's first use) and §23 edited. Reading order item 48 new, 48–79 → 49–80, items 26, 29, 33 and "Where the layers live" reworded. Bundle (`npm run analyze`): 103.5 KB → 108.3 KB (+4.8 KB; `gitspice.ts` 19.3 KB). Size: `backend.ts` +6 code (230 lines — 32 code, 191 comment, 7 blank), `gitspice.ts` +70 (790 — 348, 393, 49), `command.ts` comments only — 76 code lines in all, comments on top (D23 open); `unit/push` 566 lines (23 tests). **Reviewed** before the commit by four lenses (correctness against the design and the measured logs; 105 mutants, 92 killed; docs against code; test quality), each finding handed to a sceptic: the surviving mutants got cases (the `INF Pushed` regex's anchors, the `behind` rule's independence from `needsPush`, a bare `FTL` line in `notes`), a doubled full stop when git's line ends with one was fixed (`sentence`), `replace` with a `g` regex became `replaceAll` (SonarCloud S7781), `isFtl` lost a branch nothing could observe, and eight doc sentences were corrected (primer §20's "neither used here", §9.6 crediting 21a with 21b's tests, §7.13.1's env line and gate sentences, README claims marked as 21b's). | §10.1's core/vscode rule; §7.13.3's command and sink; D59's result-not-throw and "the caller's trunk question"; §7.7's preflight puts tracking before push and on the caller; E76's refusal rule and the after-fetch measurement decide guard 3; the partial-push, auto-init, from-anywhere and pull-on-trunk measurements decide the other guards and the absence of a checkout; the `updateOnly` measurement decides the second flag; the kill measurement decides what the timeout is called and what the README says; §11.3's proportionate rule decides execa; the no-remote, stale-info, race and ssh/https outputs decide the phrase rule; SonarCloud's S3776 decides the split. Design 21 (the session scratchpad's `design21/design-21.md`), attacked and repaired 2026-10-09. |
| D62 | M5 PR 21b | The VS Code side of item 21. `package.json`: `prCascade.pushStack` "Push Whole Stack", `view/title` `2_stack@1` under `when: view == prCascade` (§7.11 verbatim, always shown), `enablement: !prCascade.rebaseInProgress` on it **and on `prCascade.trackStack`** (§7.2.1: every mutating entry; D60 deferred Track Stack's to this item); the key set in the one `onDidLoadStates` listener as `states.some(rebaseInProgress)` — one window-wide key (a `when` cannot name a repository; the sentence does). **`src/vscode/contextKeys.ts`**, new: `HAS_UNTRACKED_KEY` and `REBASE_IN_PROGRESS_KEY`, the listener's and the manifest test's one source — a key cannot be read back, so comparing the manifest against the constant the listener writes is the one check there is; two literals would let a typo enable both commands for ever with every test green. `extension.ts`: `pushStack` in Track Stack's three parts — `stackedRepositories` (nothing loaded → the shared `NO_REPOSITORY_LOADED` "The Stack view has no repository loaded — refresh it first."; no layers anywhere → "Nothing to push — the Stack view shows no layers."; else the roots with layers — a not-enriched repository is a candidate, unlike Track Stack's, so the chosen folder's sentence names the setup command), `chooseRepository(…, 'Push the stack of which repository with git-spice?')`, **an in-flight guard** (`pushing`, a `Set` of roots; a second click → "Already pushing the stack in <folder>.", information, no refresh — two `stack submit` at once in one repository race on the remote's refs and on `.git/config`: one run leaves an upstream unset with `WRN Could not set upstream … could not lock config file`, another rejects a push `remote: error: cannot lock ref … (failed to update ref)`, verified), then `pushIn` under a `finally` that releases the guard and refreshes exactly once (E83): the root re-loaded fresh (E83's reason — and `push`'s `push.behind` guard reads this load); "Rebase in progress in <folder> — resolve it first." (E12); "Not on a stack in <folder> — nothing to push." (returns the empty result); "Detached HEAD in <folder> — check out a branch of the stack first." (`submit` acts on HEAD's branch; git-spice: `in detached HEAD state`); `notEnrichedMessage` (the setup command named where it would help); `track` for the `null` layers first (its `problem` shown, no push; an Output line naming them); `push`; `reportPush`: one Output line per `notes` entry (`<root>: git-spice: <line>` — the `<name>-2` rename, a `WRN`, the `ERR` remedy of a partial push), one naming the branches pushed, then "Pushed N branch(es) with git-spice in <folder>." — with " — git-spice also left notes in the Output panel" appended when `notes` is non-empty, the one honest pointer to a rename git-spice reports with exit 0 — or core's sentence as a warning; returns `PushResult \| undefined`. **Deviation: not gated on `ensureReady`** — against E55/E59/§7.7 and D60's own "item 21 gets the gate (push needs the login)". Measured 2026-10-09 (D61): `stack submit --no-publish` against a github.com remote while logged out fails exactly as with no remote, at `git ls-remote` — the forge and the keychain are never consulted — so the flow's forge and auth steps would refuse pushes that work (the E21 fixture, E60/E70/E75 hosts, a logged-out user) and demand a login a push never uses, while E24/E62b promise push works without gh — a promise the flow would break the day item 23 adds gh to the probe. git-spice's help names the one exception: `--no-publish` "has no effect if a branch already has an open CR" — such a branch is updated through the forge, and with an expired login that push fails with git-spice's own words, which the sentence quotes and the README answers with the setup command; a gate on exactly that case (a layer with a `change`) was considered and left for M7's e2e suite to measure (unmeasured here — no forge in a hermetic test). `enablement` does not stop `executeCommand` (VS Code's manifest reference) — the ext test's path — so the command keeps its refusal. Not done: `withProgress` (M7's `createStackPRs` brings it; push joins), a `hasStack` condition (M7's key), the decline memory (D58), the `(stale info)` translation (M9's Sync Stack owns E76's adoption; its refusal is core's, D61), a guard for the `<name>-2` rename (M7 item 26, D64), the F5 check of the palette (below). Tests: `ext/commands` +17 (listed in §9.4; a `SlowRunner extends FakeCommandRunner` for the guard, built from the Map the fake helper returns, its gate opened first thing in the `finally`; a nested `describe` that adds a second repository to the workspace, `ext/gitApi`'s way — folder change, "opened" event, the debounced status refresh waited for — to pin the pick's placeholder against `extension.ts`); the 20b manifest case gains `enablement` and compares its `when` against the constant; `unit/login` unchanged (its placeholder row would prove only that `chooseRepository` forwards a string); `test:ext` 113 → 130 (128 in the fixture launch, 2 in the parent one), run twice. A four-lens review with sceptics ran before the commit (21 findings confirmed, 4 refuted — comments and docs only: the palette sentence, two stale "item 21" comments, the primer's §13 gap for a method override and a local class, the `slowRunner` wait given a deadline, a P1 title promising more than it asserts, the README's "every layer" for the pull-on-trunk case); `src/core/backends/gitspice.ts`'s `forget` doc ("D62 when 21b lands") is left for item 22, a core file. Primer §74 and §13 edited. Reading order item 50 new, 50–80 → 51–81, items 1, 2, 58, 68 and "Where the layers live" reworded. README "Pushing", "Refresh", "What you see", "Requirements", "What's next"; CHANGELOG. Bundle (`npm run analyze`): 108.3 → 112.2 KB (+3.9 KB; `extension.ts` 15.5 KB, `contextKeys.ts` 109 B). Size: `extension.ts` +89 code (911 lines — 407 code, 462 comment, 42 blank), `contextKeys.ts` 32 (2 code, 27 comment), `login.ts` and `tree.ts` comments only, `package.json` +12 — comments on top (D23 open); `ext/commands` 540 → 1293 lines (27 tests). | §7.2/§7.2.1/§7.11 followed to the letter for placement, title, group and `enablement`; E12 and §9.4's row for the refusal and its test ("assert message, don't actually push"); E83 for the one refresh and the fresh load; E56/§7.7 for track-first; D57 for the colours; D60's three-part shape; E21/E24/E62b and the logged-out measurement for the deviation, which is D60's own argument applied to the operation D60 excepted; pending decisions 7a/7b (the placeholder pinned live, the key names pinned against one constant); the rename and race measurements for the Output lines, the tail and the guard. Design 21 (`scratchpad/design21/design-21.md`), attacked and repaired 2026-10-09. |
| D63 | M5 PR 22a | Item 22 is two PRs, as 19–21 were: **22a** (this row) core, **22b** the suite and CI (D64). `core/command.ts`: `RealCommandRunner` is `spawn` turned into a Promise, no longer `execFile` — `stdio: ['ignore','pipe','pipe']` (stdin `/dev/null` from the start; `child.stdin?.end()` gone), `detached: process.platform !== 'win32'` (a `setsid()`: the program leads its own process group, is still awaited and read, never `unref`'d), the request's `timeoutMs` as our own timer → `process.kill(-pid, 'SIGTERM')` to the group, then `SIGKILL` after `KILL_GRACE_MS = 2_000` (git drops its locks on SIGTERM; nothing survives SIGKILL) **and both pipes destroyed right after it** — `close` waits for both pipes, so a descendant that left the group (`setsid`) while keeping them would otherwise hold `run()` open (measured through the first draft: 5.2 s for a 0.5 s limit; for ever for a daemon), where `execFile`'s `kill()` had always destroyed them; after the SIGKILL and not before the SIGTERM because the `INF Pushed` lines written before the cut-off are read by `pushed`; the 32 MB overflow takes the same `stopGroup()` path, so it too escalates to SIGKILL; the timeout's timer is cleared on `close`, the SIGKILL timer deliberately not — the program may die on the SIGTERM (git-spice, a Go program, does) while a member of its group that ignored it holds neither pipe, so `close` fires at once and only a timer that outlives it reaches the survivor (measured: a grandchild trapping SIGTERM lived on when the timer was cleared with the result; the review's one correctness finding) — `unref()`'d so a settled run never holds the process, its late kill an ESRCH `killGroup` swallows, a group id reused inside the grace the residual; the 32 MB ceiling is this file's own (`spawn` has no `maxBuffer`), counted in decoded characters, the group killed when passed; `close` (not `exit`) settles the result, a remembered `error` event deciding a start failure (ENOENT/EACCES arrive as `error` then `close` −2/−13 — measured); ESRCH on the kill swallowed; `child.pid === undefined` guarded; `new RealCommandRunner(killGraceMs = KILL_GRACE_MS)` is a test seam. **Why not `execFile` with `detached`:** `ExecFileOptions` has no such key and Node's `execFile` forwards a fixed list (`cwd, env, uid, gid, shell, signal, windowsHide, windowsVerbatimArguments`) to `spawn` — measured: the child's pgid stayed the parent's. Result shape unchanged; two `detail` texts are ours now (`killed by <signal>`, `output exceeded 32 MB`). **Windows keeps 21a's semantics** (`child.kill`, the one pid): the floor is macOS and Linux (shell.ts, D57). §7.13.3's "a budget, not a cancel" is withdrawn: measured through this runner with git-spice 0.31.2 and 0.32.0, a `stack submit` with a 3 s pre-push hook and a 1.5 s limit returned at 1507 ms, the origin never received the branch (at return and 4 s later), the hook log stopped at `hook start`, no `branch.<n>.merge` was written, and the next push landed every branch under its own name — the timeout cause of the `<name>-2` rename is gone; the three other causes (D61) are the user's and the guard is M7 item 26's (D64 sketches it). `detached` means no controlling terminal for the child: a tool insisting on `/dev/tty` fails instead of hanging (wanted — `--no-prompt`, `GIT_TERMINAL_PROMPT=0`); item 23's gh must keep `GH_PROMPT_DISABLED=1`. `gitspice.ts` comments only (`PUSH_TIMEOUT_MS` — a cancel, up to 122 s to the notification; header; `forget`'s "(D62 when 21b lands)" → "(D62)"). Tests: `git/command.git` +10 (10 → 20): a multi-byte character kept whole across a chunk boundary (100 000 euro signs — `setEncoding`'s reason, pinned); then the process-group describe — Node child → Node grandchild gone after the timeout; SIGKILL after a 200 ms grace for a SIGTERM-ignorer, the line it wrote on SIGTERM kept (the pipes destroyed after the SIGKILL, not before the SIGTERM), elapsed between 1 100 and 2 500 ms; the pid-only control leaving the grandchild alive; exit 7 on SIGTERM kept with `timedOut`; the ceiling with the program stopped (it would live 20 s otherwise); a foreign signal named; an escaped descendant holding the pipes not holding the result, elapsed ≥ 1 200 and < 3 000 ms under a 10 s limit of its own; a SIGTERM-trapping grandchild of a program that died on the SIGTERM, reached by the SIGKILL timer that outlives `close`; no timer queued once a result is in (`vi.useFakeTimers({ toFake })`, `vi.getTimerCount()`) — ≈ 8 s for the file; `unit/*` untouched; `test:ext` run once, unchanged (128 + 2). Primer §75 new (`spawn`, the events, `destroy()`, `unref()`, and the codebase's first `NodeJS.ErrnoException` / `NodeJS.Signals`), §76 new (`describe.skipIf` / `it.skipIf`, with the pointer M1's `it.skipIf(runningAsRoot)` never had — the design placed §76 in 22b, which now extends it with `it.runIf`) and §77 new (a test's own time limit, the third argument to `it`; 22b's planned §77/§78 become §78/§79); §15, §32, §58, §65, §70 edited. Reading order items 29 and 32 reworded, nothing renumbered. README "Pushing" (the branch being pushed does not land, the ones before it stay pushed; on macOS and Linux), CHANGELOG (the Push Whole Stack entry). One `feat` commit, as 20a–21b; RED→GREEN in the working tree (tests 11, 12, 15, 16, 17 red on `execFile` — 17 because `execFile`'s `kill()` freed the pipes at the SIGTERM with no grace, the one row that pins the destroy's place; 18 red on the first draft of the new runner, which cleared the SIGKILL timer with the result; 13 and 14 green by design; the UTF-8 row and the timer-count row green from the start, guards against two mutants the review found surviving). A four-lens review with sceptics ran before the commit (17 findings confirmed, 7 refuted): the SIGKILL timer, test 15 not proving the kill, the destroy's place untested, test 17's red being a Vitest timeout, two pointer errors and six missing pointers, a false `↓ skipped` sentence, "and are listed" without naming the Output panel, five plan sentences still saying `execFile`. Bundle: 112.2 → 114.2 KB (`command.ts` 2.0 → 4.0 KB). Size: `command.ts` 181 → 326 lines (139 code, 172 comment, 15 blank; +67 code), `git/command.git` 173 → 502 (20 tests). | §7.13.3's "the process-group kill is item 22's" and D61's measurement; §0's one idea per PR; Node's documented `detached`/negative-pid semantics and the probe; §3's "never a shell"; D56's result-not-throw. |
| D64 | M5 PR 22b | The suite-and-CI half of item 22, on 22a. **Three test files, not §9.4's one** — `git/gitspice.git` (16: the §9.6 (b) rows through `GitSpiceBackend` + `RealGitRunner` + `RealCommandRunner` on one fixture, one story; both (k) pins), `git/gitspiceFacts.git` (17: git-spice run directly — the `PRCASCADE_REQUIRE_GS` test, the V1 exit-code table as `it.each`, outside a repository, `init --trunk nope`, the `<name>-2` rename with its predicate, the push killed at the timeout), `git/gitspiceOps.git` (10: the paused restack, both remedies on git-spice's pause and on a plain one, amend/insert/onto — M9's facts) — three stories, and Vitest runs files in parallel workers (`test:git` 11 → 24 s locally for 42 more tests). **`test/helpers/gitspice.ts`**: a synchronous test-side locator over `GS_CANDIDATES` + `gitSpiceVersion` (`describe.skipIf` needs its answer at collection time; `locateGitSpice` stays private — async over a runner), `PRCASCADE_TEST_GS=<path>` to run against another build, `GIT_SPICE_REQUIRED` from `PRCASCADE_REQUIRE_GS=1` (the require test names what was tried — `GS_TRIED`), `runGitSpice` shaped as production's `gs()`, every file's hermetic block pinning `GIT_EDITOR=true` beside HOME, XDG and the two `GIT_CONFIG_*` (git opens `vi` from any git-spice commit made without a message — `branch create` with nothing staged, `rebase continue` — when `TERM` is set and no editor variable is: measured, it hangs under the runner; this Mac leaked `GIT_EDITOR=true` into the facts and CI has no `TERM`, so without the pin a developer's run and CI's would pass or fail for different reasons), the `.git` snapshot (`size mtimeNs inode`, `BigInt` stats) with the ref digest as the second instrument, `loadState` = `detectTrunk` + `computeStack` (RepoState never hand-built), `initAndTrack` through `trunkBranchFor`/`enrich`/`track`. Fixture: `commitOnTrunk(file, content)` (pushes trunk — a local trunk ahead of `origin/main` is itself a layer, D59), `addHook(name, script): string`. `vitest.config.mts` `testTimeout: 30_000` on the `git` project (two tests measured 4.7 s locally against Vitest's 5 s). **CI (D5 closed)**: the release tarball on both runners — `git-spice.<uname -s>-<uname -m>.tar.gz`, sha256 against the same release's `checksums.txt`, the step under `pipefail` so the closing `--version | head -1` check counts, into `$RUNNER_TEMP`, PATH via `$GITHUB_PATH`, version pinned once as job `env` `GIT_SPICE_VERSION: 0.32.0` (not §9.5's brew on macOS: unpinned and a second path), `PRCASCADE_REQUIRE_GS: '1'` so the suite fails rather than skips there; bump = one line + the suite read on both runners + a line in the §13.4 bullet (the reading order names no version). `release.yml` unchanged, its header saying so: its `npm test` has no git-spice and skips the three files — a tag points at a `main` commit ci.yml has already run them on, and installing there would only repeat the verdict. **§12 item 7 decided**: every command measured (36, on 0.31.2 and 0.32.0) exits 0 or 1 (usage errors 1; not a universal — a Go panic would be 2, a signal leaves none; nothing but stderr tells the cases apart — the backend reads `FTL` lines, never a code beyond ≠ 0); a paused operation is D50's directory check for git-spice's pauses as for git's; git-spice's own record is `refs/spice/data:rebase-continue`, which §3 forbids the extension reading and which is **not adopted** — `gs rebase continue`/`abort` drive a plain git rebase too (measured), so M9 names them whenever the data ref exists, adding `stack restack` for the upstack; the shape is pinned as a fact. One fact the design had wrong and the tests corrected: after `gs rebase continue` finishes a *plain* git pause, git-spice writes no data commit of its own, but the next `gs log` records the moved branch (`<b>: branch was restacked externally`) — the one write a read-only command makes, as the prune is. No production code; `RepoState` unchanged. **The `<name>-2` guard deferred to M7 item 26** (the remote in hand after `detectForge`): the kill removed our trigger (D63); a correct guard needs git-spice's remote, recorded only in `refs/spice/data` — `prCascade.remote` need not agree, and a fork set-up would be a false refusal; M9's E76 adoption changes the predicate. Sketch for item 26: `push(root, layers, remote)`; one `for-each-ref --format='%(refname) %(upstream)'` over the layers' heads and `refs/remotes/<remote>/`; refuse a layer the remote has with an empty upstream, between `push.behind` and the banner: "Nothing was pushed: `<b>` already exists on `<remote>` and is not this branch's upstream, so git-spice would push it as `<b>-2`. If it is yours, run `git branch --set-upstream-to=<remote>/<b> <b>` first; if it is someone else's, rename the branch." Predicate pinned now: `tracking.push` absent ⇔ no upstream; `refs/remotes/<remote>/<name>` in the digest ⇔ the remote has it. Docs: §9.1 the `GIT_EDITOR` line, §9.2 two env lines, §9.3 the methods, §9.4 three rows, §9.5, §9.6 (b) as built, §7.13/§7.13.2/§7.13.3, (k) addendum, E12, E83; README Tests; doctor.sh, check-toolchain (git-spice needed for the *full* `test:git`, still a warning); primer §76 extended (`it.runIf`, `expect(value, message)` — 22a wrote §76 and §77, so the planned §77/§78 are §78/§79), §78–§79 new, §19/§28/§39/§43 edited (§43: the codebase's first index signature, `RawLogLine`); reading order 49–52 new, 49–81 → 53–85 (one perl pass — BSD sed has no `\\b` — headings and cross-references checked as a multiset against the old set shifted by four, `items 57 and 58` among them; §10.1 item 21's "reading order item 50" → 54, the dated §13.4 bullets keeping their day's numbers as the plan already says), items 13, 35, 77, 81, 82 reworded. D50 verified for git-spice's pauses; the 21b bullet's "(item 22)" pointer for the guard sent on to item 26. Built as nine commits, each green under `npm test` — unlike 20a–21b, each one `feat` commit, because here the commit order is the reading order (fixture → helper → config → CI → three files → the review's test fixes → docs); the review added a tenth ops test (git-spice's own pause ended by `gs rebase abort`: HEAD stays on the layer git was rebasing, a data commit "git-spice rebase abort") and an `initAndTrack` that proves every layer tracked. No CHANGELOG line. Tests 43 (one of them, the require test, skipped off CI); `test:git` ≈ 11 → 24 s locally; CI numbers in the §13.4 bullet after the first run. | §9.6's "CI installs git-spice so (b) always runs" and D5's "with the first suite that needs it"; §9.1's hermetic layer-2 env; §3/§7.13's "never read refs/spice/data" (why the discriminator is a fact, not a detector); §4.4/D55's "grow when read" (why the guard waits for the remote); Vitest's file-level parallelism; D56's identity-by-banner. Design 22 (`scratchpad/design22/design-22.md`), attacked and repaired 2026-10-14. |
| D65 | M5 PR 23a | Item 23 is two PRs, as 19–22 were: **23a** (this row) the probe, **23b** the setup flow (D66). **`core/version.ts`**, a module §4.2 did not list: `Version`, `parseVersion`, `isAtLeast`, `formatVersion` moved out of `backends/gitspice.ts` unchanged, so the gh reader can compare against its floor without importing the backend that imports it (both headers promise no runtime circle); `readinessFix.ts` now imports it too, and no longer runs the backend. **`core/ghstatus.ts`** is the gh reader §4.2 names, pure over a CommandRunner: identity by the banner (`gh version X.Y.Z (date)`, first line, `ghVersionToken` — `\S+`, so a `DEV` build reads as gh and then as "cannot be checked", git-spice's `dev` rule), never by exit code (D56); the floor `MINIMUM_GH_VERSION` 2.90.0 (§7.13.1, §11.3, doctor.sh); gh-stack presence by `gh stack --version`'s own banner (`ghStackVersionToken`) — not `gh extension list`, which exits 4 with no login when no `GH_HOST` is set and 0 with one (an answer that depends on the environment), while `stack --version` needs neither login nor network and prints the install line itself when absent (measured 2.102.0); no gh-stack floor (nothing of ours depends on one; the token is in hand for M7); login by `gh auth status --hostname <host lower-cased>` exit 0 — the flag and `GH_HOST` carrying the same host on purpose: gh matches the flag against its host list without normalising it and only `GH_HOST` puts a host gh has no account for on that list (`--hostname ssh.github.com` alone is "not logged into any accounts on ssh.github.com" while github.com is logged in; with `GH_HOST=ssh.github.com` beside it, exit 0 — measured; `unit/ghstatus` pins the invariant), without the flag `GH_HOST` makes gh report every host; lower-cased in both because gh folds neither (`--hostname GitHub.COM` is "not logged into any accounts on GitHub.COM" while github.com is, with `GH_HOST=github.com` too); stderr unread, as step 4 reads git-spice: gh exits 1 for no account, a revoked token and no network alike, the fix is the same login for the two that have one, and the probe's only callers — the setup command and M7's gated actions, never a refresh — need the network anyway. `GH_HOST` has a price here: for a host with no account gh does not answer locally (`You are not logged into any GitHub hosts…`, 65 ms, what a bare call gets) but looks the host up — in the OS keyring (`gh:<host>`) first, else as an empty default token — and validates what it found: `X Failed to log in to <host> using token (default)` / `The token in default is invalid.`, exit 1, ~0.25 s online — so every probe of a never-logged-in host is one bounded network call (up to `GH_TIMEOUT_MS` on a black-holed network); the facts file pins both shapes through a dead proxy, beside the offline shape with a bogus token (and keeps the keyring out: with the real `HOME` this logged-in Mac's keychain answered for a host the empty hosts.yml did not know, source `(keyring)` — measured by the review, so the fresh `HOME` is load-bearing there). `--json hosts` (always exit 0, structured; `state: "error"` with `login: ""` already tells offline from no-account) is the alternative, recorded beside D55's parser deferral for M7. Every gh spawn: `GH_ENV` = `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, `GH_NO_EXTENSION_UPDATE_NOTIFIER=1` (`gh stack --version` executes an extension), `NO_COLOR=1`, `GH_TELEMETRY=false` — without the last every gh call writes a telemetry `device-id` under `$XDG_STATE_HOME/gh` (measured; the facts file's "three directories empty" row needs it) — under `ghEnv(host)`'s `GH_HOST` (forge.ts's promise kept: the hygiene lives here); no `LC_ALL` (gh has no locale); cwd = root; `GH_TIMEOUT_MS` 15 s under its own name (this module cannot import the backend's). `runGh` exported: the facts file pins the spawn through it, and M7's `gh stack link` is the same spawn. **Step 5** is `ghStep` beside `probe` (SonarCloud's 15; `probe` 9 → 10), GitHub only — a GitLab repository spawns no gh (E24) — after the git-spice login: version → stack → auth, the extension asked whatever gh's version so `missing` lists both when both are wrong (E62b), unasked when gh itself did not answer, auth skipped while anything is missing; a timed-out or never-started program reads as missing / not logged in; `unusable-directory` on the first gh spawn rejects as locateGitSpice does. **`Readiness`**: `gh-not-logged-in { forge, ghPath }` after `gh-missing` (§7.13.1's step 5 line had no login; §7.5's preflight, E23, §9.4 and the item's "+ gh login flow" want it; one member — the fix is one login); `gh-missing` gains `ghPath: string | null` (the gh that answered, for the upgrade and `extension install` lines); `ready` gains `gh: GhFound | null` (`{ path, version }`; `readyMessage` reads it now — "git-spice 0.31.2 and gh 2.102.0 are ready for <repo> (<host>)." on GitHub — and M7's `gh stack link` reads `path`; `null` on GitLab). `GitSpiceBackend(git, commands, gsPath = '', ghPath = '')`: `prCascade.ghPath` as the fourth argument (the setting is 23b's), `gsPath`'s rule — empty runs `gh` from PATH, a set value is the only one tried. The happy path on GitHub is eight commands (two of git-spice, three of git, three of gh), on GitLab five. The memo unchanged (`ready` only), so a remembered `ready` freezes "gh logged in" until `forget` as it freezes git-spice's; each poll of a gh wait spawns three gh commands (two during a gh-stack install — `auth status` is not asked while anything is missing), the last one network call; a git-spice login wait spawns none, since step 5 runs only once step 4 passes (the wait counts intervals, D57). **`progressOf`** (`vscode/login.ts`, the one VS Code touch) becomes a `Record<Readiness['kind'], number>` — the `if` chain's `return 3` would have given the new member the forge step's number and a git-spice login's wait could never pass; the table makes a member without a number a compile error (primer §80). Offers: `gh-not-logged-in` a text-only warning until 23b wires the line (it needs `prCascade.gitProtocol`); `gh-missing`'s 19a sentence unchanged — an `information` text with no button and no command named, now produced for real: one PR of interim kept rather than reworded in 23a and replaced in 23b (D57's warning rule is met by 23b's offers). §7.5's per-refresh cached preflight, its `(gh: not logged in)` layer description and its informational node for a missing gh are not built: readiness is never asked on a refresh (one `.readiness(` call in `src`, the setup command's), the setup command's notifications are the one surface until M7's status tiers (§7.8) own the layer description — the node would be a second surface for the same sentence. Tests: `unit/version` (15: the moved describe + 2), `unit/ghstatus` (45), `unit/readiness` 72 → 77 (18 new — the happy path's eight pinned; a GitLab remote spawning no gh; two roots with two hosts, github.com beside ssh.github.com; the memo — and the 13 version rows moved out), `unit/readinessFix` 55 → 57 (three literals, a describe retitled, the interim sentence with a capitalised host, `readyMessage` with gh and on GitLab), `unit/login` 60 → 61 (a title reworded), `ext/login` (the fake cans gh; the ready line; 130 → 130), `git/gh.git` (17, real gh hermetic — HOME, XDG config/data/state, `GH_CONFIG_DIR` explicit, a dead D-Bus address, the four token variables, `GH_HOST`, `GH_DEBUG`, `CI` and `GITHUB_ACTIONS` deleted — under `CI=true` gh installs an official extension it is asked about instead of printing the hint, which is how the first CI run failed on both runners; every `auth status` and `auth login` row through a dead proxy with `no_proxy` emptied; the banner, the floor met, `stack --version` absent, `extension list` exit 4 without `GH_HOST` and 0 with it, `auth status` exit 1 both ways for a host with no account — the generic sentence bare, the empty-default-token validation under the probe's env — for github.com and a GHE host, the offline shape with a bogus token, `auth login` refused with each of the four token variables and not refused by the github.com pair for an Enterprise host (gh goes to that host: the device-code URL names it), the three directories empty; `PRCASCADE_REQUIRE_GH=1` in ci.yml with no install step — both runner images ship gh). Primer §80 new (`Readiness['kind']`), §20, §43, §49, §59 (eleven members), §65 (`vi.stubEnv(name, undefined)`), §76 edited. Reading order 33, 34, 36, 37, 57 new, 85 → 90 (one perl pass; headings and cross-references checked as a multiset). doctor.sh: the gh-stack check by `gh stack --version` (the `extension list` one reported "not installed" on any logged-out machine), the floor's text, the login hint with `--git-protocol https`. Nine commits, each green — the seventh the review's fixes, the ninth the CI fix (`CI` and `GITHUB_ACTIONS` deleted in the facts file). | §7.13.1's step 5 and §7.5's preflight/login steps; D56's identity-by-banner and exit-code-only rules; E62b's list; §11.3's "item 23's gh floor reuses parseVersion + isAtLeast"; D55's "a field is added when something reads it"; D57's "ghstatus.ts stays item 23's gh reader" and the hygiene forge.ts assigned to it; the facts of `design23/facts.md` and the three labs (gh 2.102.0, 2026-10-14). Design 23 (`scratchpad/design23/design-23.md`), attacked and repaired 2026-10-14. **Decided (Ric, 2026-10-16):** `GH_ENV` removes `CI` and `GITHUB_ACTIONS` (`undefined` in `CommandRequest.env` means remove; Node leaves such an entry out, `git/command` pins it), so the probe never installs gh-stack under an inherited `CI=true`. |
| D66 | M5 PR 23b | The setup flow's half of item 23, on 23a. `core/readinessFix.ts` (a core file in a VS Code PR, as the words are the flow's and testable without VS Code): `OfferFacts` gains `ghPathSetting`, `brewGh`, `gitProtocol`; `gh-missing` becomes three offers through one dispatcher — gh not found (the setting set → a sentence pointing at it; Homebrew's `gh` beside `brew` that VS Code's PATH does not reach → a sentence naming it for `prCascade.ghPath`; else `<brew> install gh` in a terminal, else the page `https://github.com/cli/cli#installation` — the README's installation section every package manager is in, where cli.github.com is one download button), gh too old (`gsTooOldOffer`'s rules: `<brew> upgrade gh` only for Homebrew's gh — the bare name while Homebrew has one, or its path — with a readable version, else the page; an unreadable token "could not be checked"), the extension alone (`command <gh> extension install github/gh-stack` in a terminal — it downloads and prints; no login needed, measured; no `--force`: the one case it would help is a corrupted install gh's own refusal names); `gh-not-logged-in` → `env -u <A> -u <B> <gh> auth login --hostname <host lower-cased> --web --git-protocol <prCascade.gitProtocol>`, the pair by host class (`ghTokenVariables`: github.com, *.github.com, *.ghe.com → `GH_TOKEN`/`GITHUB_TOKEN`, else the `*_ENTERPRISE_*` pair — gh refuses `auth login` while one of the host's pair is set, and the other pair changes nothing, so the line stays short), done line `gh is logged in to <host>.` (not §7.5's "Logged in to <host>", which is git-spice's). Every gh sentence `warning` (something to do); 19a's information text and 23a's interim sentence are gone. `vscode/login.ts`: `MachineFacts.brewGh` (the `gh` beside `brew`, read from disk at each offer and in a wait, as `brewGitSpice`), `ReadyRequest.ghPathSetting`/`gitProtocol`, `factsFor`; `progressOf`'s sub-steps — `gh-missing` with nothing answering as gh 5, with a too-old gh 6, with only the extension missing 7, `gh-not-logged-in` 8, `ready` 9 — because after `brew install gh` the probe answers the same kind with a version or a shorter list, and without the split every gh install's wait would time out silently with gh installed (the design had two steps; the review found the too-old one — `gs-missing` → `gs-too-old` is two members for git-spice); the look-again at the click compares the step as well as the `kind`, so a stale Install with Homebrew runs nothing for a second gh once the probe says only an upgrade or the extension is wanted; `installAppeared(failing, machine)` lifted out of the wait's closure: a `gs-missing` wait also passes on `brewGitSpice`, a `gh-missing` wait with `ghVersion === null` also passes on `brewGh` (a too-old Homebrew gh is already on disk and must not pass an upgrade's wait); `MAX_STEPS` stays 10 — counted with an install and an upgrade of each tool, as the comment has always counted, the longest chain is now exactly ten, and the loop acts on its last pass; no real chain has both for one tool. `package.json`/`config.ts`: `prCascade.ghPath` (default `""`, §7.3 said `"gh"` — `gsPath`'s "empty = auto" convention, D56) and `prCascade.gitProtocol` (`enum` `https`/`ssh`, default `https`, typed `string` in config.ts by its own rule); `extension.ts`: `backendFor`'s key and constructor gain `ghPath` (a changed setting is a new backend, D56), `setUpGitSpice` passes both settings. `--git-protocol` passed always, as §7.5 writes it: it governs gh's own git operations and credential helper, never PR Cascade's pushes; the named risk is that a re-login flips an `ssh` host to `https` for every account on it (gh's help; this Mac's gh is on `ssh`) — the alternative, a third value that omits the flag, is one line away (§13.4). Tests: `unit/readinessFix` 57 → 72 (the gh section 4 → 19 rows), `unit/enrich` and `unit/push` (their `OfferFacts` literals gain the three fields), `unit/login` 61 → 75 (`machineFacts` 5 → 6, three of its `toStrictEqual`s gain `brewGh`), `ext/login` +4 (+1 in commit 1) through `makeItGitHub`/`makeItGitLab` and the one fake runner (gh is spawned through `readinessDeps.commands`), `test:ext` 130 → 135. README "git-spice setup" (three gh bullets, the Log in sub-bullet, the offline sentence), Requirements, Settings (+2), What's next; CHANGELOG. No new primer section (`enum` is manifest JSON — reading order item 1); §25 gains a paragraph on tuple types (`readonly [string, string]`, the codebase's first written as an annotation); §49 names `GhMissing`. Reading order items 1, 2, 44, 45, 58, 67, 70, 76 reworded; nothing inserted; primer §8 and §59 reworded with the code. The plan's §7.3 (both rows), E23/E62b/§7.5/§7.13.1/§4.2/§9.4/§10.1 rows get this PR's own "item 23b" clauses appended (23a wrote its own state only). Six commits, each green — the fifth the review's fixes (33 findings, 30 taken). | §7.3's rows and §7.5's line for the setting and the protocol; D57's rules for the words and the one button; D58's flow built general in 19b, so gh is three offers and not a second flow; `brewGh` mirrors `brewGitSpice` (D57); E62b's "exactly what to install" decides one member with two steps rather than two members; the measurements of D65. Design 23. **Decided (Ric, 2026-10-16):** `gitProtocol` gains the empty value and it is the default — no `--git-protocol`, gh asks once, a host already set up keeps its protocol. |
| D67 | M6 PR 23a | The first M6 PR, core only, as 19a/20a/21a/22a/23a were; `core/viewmodel.ts` (23b) consumes it, `extension.ts` wires it in 23d, so nothing shows yet and the tree is untouched. **`core/graph.ts`** reads every stack in the repository and lays it out as the rows the two views draw. **Input** in digest.ts's shape (D59) — exported argv, texts returned verbatim: `readGraphInput(git, root, trunk)` → `{ refs, dag, trunkTip }` from three read-only spawns, all `run` (detectTrunk verified the trunk): `for-each-ref --format='%(refname:lstrip=2) %(objectname) %(committerdate:unix)' refs/heads` (every local branch in name order, merged or not, with its commit's committer date — the third column so 23b's ages need no spawn; a ref under `refs/heads` is always a commit, git refuses anything else, so the column is never absent; `lstrip=2` for stack.ts's tag reason), `rev-list --parents --branches --not <trunk>` (one line per commit reachable from a local branch and not from trunk — `<sha> <parent>…`, newest first; a parent that is not itself a line is a trunk commit, the fork; nothing for a trunk-only repository, exit 0 — F1, F2) and `rev-list -1 --no-commit-header --format='%H %ct' '<trunk>^{commit}'` (trunk's tip and its date in one line; the same SHA and the same exit-128 failure as the plan's `rev-parse --verify`, plus the date for the trunk row's age; rev-list not log so `log.*` cannot add lines). Not `--merged HEAD`: computeStack's question is HEAD's stack, this one is every stack (§12 item 2; M10 folded into M6). Three spawns for any number of branches where computeStack asks two questions per branch — the first of them alone, 101 `rev-list --count` spawns on a 10 000-commit line, measured 3.25 s against the 48 ms of the three commands here. **Pure** `parseRefs` → `RefEntry[]` (`name`, `sha`, `committedAt`; two names on one commit two entries), `parseDag` → `Map<sha, parents>` (order-independent — `--topo-order` not needed, F8), `parseTrunkTip` → `{ sha, committedAt }`, and `layoutGraph(input, { trunk, head, dirty, onlyStackOf? })` → `GraphLayout { rows: GraphRow[]; lanes }`. **Membership:** a branch is a layer iff its SHA is a DAG line — a merged branch is listed by `for-each-ref` and starts no line (F5); a branch with no commits of its own yet is no member; a local trunk ahead of its remote-tracking ref is a member like any other, usually a one-row stack, a layer under layers when a branch was built on it (F3 — D59's quirk, accepted as computeStack accepts it); a tag named like a branch is invisible to both commands (F7); a detached HEAD or a linked worktree changes neither text (F6). **Depth** = the DAG commits reachable from the member's SHA, walked with an explicit worklist and a visited set (computeStack's `rev-list --count <trunk>..<branch>`, read off the text; a merge from trunk counts the merge commit only — F4). **Forks** = the trunk commits the walk stopped at, kept on the row (`forks`, sorted): a root is on trunk's tip iff its forks include the trunk row's `sha`; item 23i's trunk-commit rows (§7.1.2) take their `git log <trunk> --not <forks>` range from them with no second walk. **Parent** = the greatest ancestor member by (depth, name) — E6's name-order chain for two names on one commit, as `compareByDistanceThenName`; none → trunk; the order is total, so one parent per member. After a merge of two named lines the deepest named ancestor wins whichever side of the merge it came from (first-parent order is never consulted — one parent per member needs a total order), so either the merged-in branch or the merging branch's own base is left a stack of its own: what git says, as E14/E15 (`unit/graph` L20; `git/graph.git` pins the shape on the fixture). A **tip** is a layer no layer sits on in that tree; §10 M10's "no other such branch contains it" is the same except after such a merge. **Agreement with computeStack** holds when HEAD's members are totally ordered by ancestry — a single line above trunk, every shape the fixture builds; for a merge of two named lines computeStack's count order chains differently (its own header disclaims the shape) and the graph is what git says. **Drawing order** depth-first, top first, the trunk row last: a node's continuing child — the child whose subtree has the most layer rows (usually the long stack), ties by name — on the node's own lane, then each side child's subtree on `lane + 1` with `joinsLane: lane` on its lowest row (§7.1.1's `╮`), then the node's row; every lane above the node's is free again when a side child starts, so lanes never cross, consecutive siblings reuse one lane (view-lab's `fix/…` and `chore/…` both on lane 1), every lane left of a row carries a line through it, and `lanes` = the highest lane + 1 (3 000 random shapes with merges and orphans, 0 failures). Size, not HEAD and not freshness, chooses the straight line: a HEAD-first rule would move lanes on every checkout, and the brief's "roots on the tip first" would push the main stack to lane 1 the moment `git fetch` moves trunk and any one-row fresh branch exists — pane B's lane-0 `part1` is "#480 merged", squash-merged, so behind. Among trunk's *side* roots only, roots on the tip above roots behind, then size, then name (pane B's `fix` above `chore`, no dates read); a size tie between two one-row roots goes to the name, stability over freshness. **Nodes:** the layer `head` names is `filled`, the rest `hollow`; `head` naming a branch in the refs text that is no member — HEAD on a branch trunk already contains: its local trunk at or behind the tip, a merged branch, a branch with no commits yet — fills the trunk row (the brief filled it only at trunk's tip, which left the everyday "on `main`, behind `origin/main`, dirty" with nothing filled and the changes drawn nowhere); `head` `null` (E3, a paused rebase E12) or an unborn branch → nothing filled. **`dirty`** is an input — 23d reads the Git extension's `state.mergeChanges` / `indexChanges` / `workingTreeChanges` (the vendored `git.d.ts` has no `untrackedChanges`; untracked files are `Status.UNTRACKED` entries of the last under the default `git.untrackedChanges`; the lists are `[]` before the first status, so the row appears on the refresh that status fires) — §7.14's rule, a fourth use of the API coming with 23d; the E13 refusal keeps its own `git status --porcelain` (§5). It makes one `workingTree` row, `node: 'dashed'`, on the filled row's lane directly above it (after that row's children, before the row — view-lab rows 6–8), its `parent` the branch HEAD is on (the filled layer's name; for a filled trunk row the local branch, not the trunk ref — the changes sit on its commit); none when no row is filled. One **`elided`** row on lane 0 directly above the trunk row (above the working-tree row when both are there) when any drawn root is behind trunk's tip — one row for the repository, not per stack: it says some root is behind, not which (23b's ⇈ does); the HTML mockup folds it into `main`'s cell, E78 and §7.1.1's ASCII give it a row, and 23e may draw it short. An orphan branch (`gh-pages`, a DAG line with no parent; every branch of a shallow clone cut inside a stack prints the same) is a root with no forks, drawn as a stale stack of its whole history with a permanent elided row standing for history that is not trunk's — kept because the rail should show every branch git-spice could track and computeStack lists it too. **`onlyStackOf`** (§7.2.1's "Show Only This Stack") is a `layoutGraph` option, not a filter over finished rows — dropped rows leave stale lanes, so the filter runs before lanes are assigned — and means git-spice's stack: the layers below the named branch and every layer above it, never a sibling subtree off an ancestor (pane B on `part3`: `part4, the working tree, part3, part2, part1`, one lane; the whole root tree only when the branch is a root); a name that is no layer leaves the trunk row alone; a dropped checked-out layer fills nothing; the view model decides whether and for which branch. **`GraphRow`** is a tagged union of four: `LayerRow` (`name`, `sha`, `committedAt`, `parent`, `depth`, `isTip`, `forks`, `lane`, `node: 'hollow' \| 'filled'`, `joinsLane?` — always `lane − 1`, absent not `undefined`), `TrunkRow` (`name` = the trunk ref as given, `sha`, `committedAt`, `lane: 0`, `node`), `WorkingTreeRow` (`parent`, `lane`, `node: 'dashed'`), `ElidedRow` (`lane: 0`). No `behind` flag (the elided row is the fact; 23b's `behindTrunk` counts are 23d's spawn), no indicators, ages, files (23b), no `trunkCommit`/`diamond` rows (23i); the other stacks' `tracking` needs `enrich`'s full `gs log --all` list beside `RepoState` — a 23b/23d change, not a graph field. `RepoState` and `computeStack` untouched. Tests: `unit/graph` (110, §9.4's row), `git/graph.git` (20). Lines: `graph.ts` 761, 327 of them code — against §0's ~300 before the comments are counted, as `gitspice.ts` and `readinessFix.ts` are (D23 still open on comment lines). Primer §81 new (recursion); §10, §14, §25, §54, §78 gain a paragraph or a sentence; §19, §31, §62 corrected in passing. Reading order 58–60 new, 90 → 93 (one perl pass; headings and every cross-reference checked as a multiset); §10.1 item 21's reading-order reference 59 → 62. No CHANGELOG line (as 19a/20a/21a: the half a user can see writes it); README unchanged. Bundle unchanged — nothing in `src/` imports the module until 23d. Nine commits, each green — the seventh a four-lens review's fixes (39 findings, none refuted, 38 taken: twelve table rows for orders no shape exercised, `compareByCodePoint` as the one comparator, false comments and missing primer pointers; one noted, the file headers past §11.1's 3–8 lines as most of the codebase's are); the ninth SonarCloud's S3776 on `measureMembers` (cognitive complexity 16 against 15): the candidate collection moved into `candidatesOf`, as `probe` was split in item 18. | E78 word for word and §7.1.1's rail bullet; §12 item 2 and §10's M10; §4.1's pure core, with `dirty` handed in by §7.14's rule; D59's quirk accepted rather than special-cased; stack.ts's E6 order and `lstrip=2` reason reused; digest.ts's reader shape (D59); `docs/view-lab.html` pane B reproduced row for row — its `part1` is "#480 merged", so behind, which is why size and not freshness picks lane 0. The facts of `design-m6-23a/facts.sh` (git 2.50.1, 2026-10-15, F1–F10) and the panel's labs: a merge of two named lines, a shallow clone, an orphan branch, a symbolic branch ref, a 10 000-commit repository, 3 000 random shapes. Design 23a (M6): three lenses, three sceptics, synthesised 2026-10-15. **Decided (Ric, 2026-10-16):** the second §0 waiver confirmed; the sibling order (subtree size, then name; trunk's tip-rooted side roots first) and "Show Only This Stack" meaning git-spice's stack (the layers below the branch and every layer above it) stay as built — #43's three questions closed, the tenth commit. |
| D68 | M6 PR 23b | The second M6 PR, core plus one types-only file in `src/webview/`, on 23a; `extension.ts` wires it in 23d, so nothing shows yet and the tree is untouched. **`core/viewmodel.ts`**: `buildStackViewModel(input: ViewModelInput): StackViewModel`, pure, no spawn. **Input** `{ state, graph, workingTreeFiles, now, showOnlyThisStack, behindTrunk, extras }`: `graph` is 23a's three texts or `null` exactly when there is no trunk (two of the three argv need one; `parseTrunkTip('')` would throw, so empty texts were no encoding of E4), and the model runs `layoutGraph` itself because §7.2.1's filter is `onlyStackOf` and must precede lanes — `showOnlyThisStack` becomes `onlyStackOf: state.head` while HEAD is on a stack (`state.layers` non-empty — computeStack's own test), and on trunk or with HEAD detached — every rebase pause point but `git am`, which keeps HEAD's branch and so the filter — every stack is drawn as if the toggle were off (an empty rail under a lit toggle reads as a fault; the focused row's stack would be the field becoming a name, 23a's question 3); `workingTreeFiles` is a count of distinct paths, not a boolean, so the working-tree row can say `2 files` (23d reads the Git extension's three change lists, §7.14); `now` in unix seconds, so a test's clock is a number; `behindTrunk` is `null` until 23d spawns its two `rev-list --count`s; `extras: ReadonlyMap<string, PrExtras>` (`isDraft`, `reviewDecision`, `checks { failing, total }`, `baseRef`, `title`) is M7's gh tier from this item, empty until then — the fields exist now, as §10 M6 promises, declared in `model.ts` for M7's `prstatus.ts` to fill, and read only for a branch whose line carries a `change` (gh keys by head branch and lists pull requests; an entry for a branch git-spice knows no PR for is stale or foreign and draws nothing — no ✕ beside no circle, no Mark Ready for no PR). **Every tracked branch, not only HEAD's stack.** `StackLayer.tracking` is computeStack's stack; the other stacks' rows need the whole `gs log --all` answer by name, so `Enrichment.enriched` gains the memo's own two facts, `byName: ReadonlyMap<string, GsLogEntry>` and `complete: boolean`, set by `withTracking` on the run and the memo path alike (the `ranGsLog: false` case carries the remembered map by reference) — one more field from a value already in hand, no backend method, no second spawn. The model's rule for any row is the tree's: an entry → tracked; absent and `complete` → `untracked` (E56); absent and incomplete, `not-enriched`, or no `enrichment` → unknown, no indicator at all, ⛅ included (E57's "degrade without touching the tree": every `not-enriched` cause also read the digest and shows no cloud, so one unknown row with a cloud would be the inconsistency). `enrich`'s `layers.length === 0` early return stays until 23d, so with HEAD on trunk the other stacks are unknown until then. **⛅'s source.** `gs log short --all --json` prints `push` only for branches git-spice itself submitted (0.31.2; `facts.out` F1/F2/F9/F12, lab M1/M2/M10 — `track` never adopts git's upstream): a branch pushed with plain `git push -u` has `refs/remotes/origin/<b>` and no `push`, a never-pushed branch has neither — so `push` absent means "not submitted by git-spice", not "never pushed". The inventory's fact is git's — does a remote-tracking branch of the name exist — and the digest `enrich` reads on every refresh already prints it, so `digest.ts` gains `remoteBranches(digest): ReadonlySet<string>` (the bare branch names under `refs/remotes/<remote>/`, any remote, one name however many remotes hold it; origin's `HEAD` is in the set, harmless) and `Enrichment.enriched` carries it as `remoteBranches`, from today's digest on both paths. Bare names and any remote, not `<prCascade.remote>/<b>`: the remote git-spice pushes to is not in its output, and `prCascade.remote` is D13's trunk remote (`upstream` in a fork), so a keyed set would cloud every submitted branch in exactly that layout; the bare set's one miss is a same-named branch on a remote nobody pushes to. `neverPushed` iff tracked or untracked and the name is not in the set (pane B's `part4`: `not tracked` and the cloud); a plain-pushed branch shows nothing, because ahead/behind for a branch git-spice never submitted would need a `rev-list` per branch, which §4.1's pure model does not spawn and 23a's three texts do not carry; `push` present implies the ref exists (M5/M6: delete the ref and `push` goes), so ⛅ and `↑n` never share a line in practice. **`↑n` is `push.ahead` when above 0**, not `push.needsPush`: measured (M4a), `needsPush` is "the two tips differ" and is `true` with `ahead: 0` for a branch strictly behind its remote — E76's state, M9's banner, no glyph in §7.1.1's tail; the tooltip's `· needs push` follows the same test (tree.ts's `needsPush === true` is a quirk 23j deletes). **⇄ compares gh's `baseRef` with git-spice's `down.name`**, not the rail's `parent`: both are local branch names (no trunk-ref spelling to strip), the next `gs branch submit` would set exactly `down.name` as the base (E71), and the rail's parent differs from it for two names on one commit (E6, lab M8: the rail chains through `api-refactor-backup`, git-spice and the PR through `api-refactor` — a false ⇄ on every backup branch) and after a plain-git rebase git-spice was not told about, where ⇈ already speaks. **`gsLog.ts` keeps `change.comments`** `{ resolved, unresolved, total }` under the same rule as every field (built in `0fed877`), so 💬's source field is parsed now and M7's `--cr-status` adds nothing to the parser (D55's "a field is added when something reads it": the model reads it). **Rows.** `ViewRow` is a tagged union of four — `LayerViewRow`, `TrunkViewRow`, `WorkingTreeViewRow`, `ElidedViewRow` — the graph row's drawn fields unchanged (the geometry is 23a's, pinned by projection), the facts the host reads back by name (`sha`, `parent`, `parentSha`, `forks` — 23g's diff and 23i's range without a `rev-parse`), and `indicators` + `age` + `dim` + `tooltip` + `context`; the elided row is `{ kind, lane }`. The §7.1.3 sketch's `number: number` becomes `id: string` (git-spice spells `!12`), `state` gains `unknown` (no `change.status` without `--cr-status`), `message?` becomes `messages: MessageRow[]` (E3 and E5 co-occur), `subject`/`files` wait for 23i/23g (no source yet — 23i's subject is `%(contents:subject)` as a fourth `for-each-ref` column), `trunkCommit`/`diamond` are 23i's own row kind and `NodeKind` member, added when that renderer exists; `dim`, `tooltip` (the tree's lines as lines — `<branch> @ <sha7>`, `base: <parent> @ <sha7>`, git-spice's line, `<id> <url>`, the title when gh knows it; the renderer concatenates; E80's condensing is "the `pr` indicator and the age", found by kind, never by position) and `context` (`LayerContext { webviewSection: 'layer', repo, layer, isCurrent, isTracked, isUntracked, isTrunkLine, hasPR, isDraft }` — `isTracked`/`isUntracked` both false for an unknown row, so no menu offers to track what nobody knows; `isTrunkLine` for git-spice's own trunk line, which `submit` refuses; `TrunkContext { repo, trunk, isCurrent }`; `WorkingTreeContext { repo, layer }`) are added because the views compute nothing. The trunk row's `name` is the ref as given (`origin/main`, the identity roots' `parent` and E77's `target` use; the mockup prints `main` — a question for Ric), the working-tree row carries `parent` and no label. No `folder`: a repository label serves pending item 5's header, undecided; one additive field then. **Indicators** in §7.1.1's bullet order with `untracked` first — the list is built in that order, a renderer never sorts: `untracked` · ⇈ `needsRestack` (`down.needsRestack`) · 💬 `unresolved { count }` (`change.comments.unresolved > 0`) · ⇄ `baseDrift { prBase, localParent }` · ↑ `needsPush { ahead }` · ⛅ `neverPushed` · `pr { id, url, state, reviewDecision, title }` (`change`; `draft` from `extras.isDraft` over open or unknown, never merged or closed) · ✕ `checks { failing, total }` (`extras.checks`, failing > 0); the trunk row's `behindTrunk { origin, local }` from the input when either is above 0; the working-tree row's `dirty { files }`; git-spice's trunk line (no `down`) and an unknown layer → none. The ASCII and pane B draw ✕ before the circle, pane C the circle first; the bullet's order is built (the circle's place buys E80 nothing either way). In hand or in M7's answer and drawn nowhere until §7.1.1 gives them a glyph: remote-ahead/diverged (`push.behind`, E76), the native-stack badge, mergeability, the worktree mark. **Ages** hand-rolled, `Math.floor` on `now − committedAt`: under 60 s, or a date in the future, `now`; minutes under an hour (`3m`); hours under 48 (`26h`); days under a week (`2d`); weeks under a mean month of 30.4375 days (`1w`–`4w`); mean months under 365 days (`2mo`, `11mo` — twelve mean months are 365.25 days, so `12mo` never prints and a year-old commit is `1y`); years; the working-tree row `now`; the elided row none. No `Intl`: the column is three characters wide and the words are ours. **Messages** word for word from tree.ts, co-occurrence as `nodesForRepo` decides: no trunk → `noTrunk` (warning) and no rows, `lanes` 0; else `rebaseInProgress` (warning) or, only when no rebase is paused, `detachedHead` (information); then `notOnStack` (information) when the layout has no layer row — the repository has no stack — never while another stack is drawn (§7.1.1). The four texts are exported constants for 23j's assertions. **`src/webview/protocol.ts`**, types only: `ModelMessage { type: 'model'; seq; repos: StackViewModel[]; activeRepo: string | null; notices: HostNotice[] }` — an array, compatible with `docs/pending-decisions.md` item 5 (undecided; one repository is an array of one, so Ric's decision changes the host, not the shape); `HostNotice { kind: noRepository | gitExtensionDisabled | gitExtensionFailed | gitDisabled | gitNotFound | repositoryError; repo; text; severity }` for the rows no `RepoState` exists for (§6, §7.14.3, E17), texts the host's; `CommandMessage { type: 'command'; seq; command: CommandId; args: string[] }` with the repository root first; `MoveOntoMessage { type: 'moveOnto'; seq; repo; layer; target }` (E77, `target` the row's `name`, the confirm the host's); `HostMessage` / `ViewMessage`, unions 23g grows. `CommandId` is the template literal type `` `prCascade.${string}` `` — E79's prefix rule as a type for what the view sends (measured: a wrong literal and a plain `string` are TS2322); the host still checks the received text, which arrives as data. No `COMMAND_PREFIX` constant: "types only" holds, nothing bundles the file, and the host's check is one string in 23d. The `src/webview/**` ESLint rule stays 23c's (§10.1): a types-only file with one `import type` cannot offend it, and the rule is whole only with 23c's webview tsconfig (`types: []` is what refuses a Node global; measured, `process.env` compiles under the root tsconfig). The per-row dispatch is a `switch` over `row.kind` with every case returning and no `default` (primer §82 — measured TS2366 when a fifth kind is added). **Tests:** `unit/viewmodel` (111, §9.4's row), `unit/enrich` (14 `enriched` literals + 2), `unit/digest` (+5), `unit/gsLog` (+2, `0fed877`), `git/gitspice.git` (2 literals + 2 — the model over real git-spice after init and after the push); `protocol.ts` has no test file — `npm run typecheck` is its test (D55). Lines: `viewmodel.ts` 771 (372 code), `protocol.ts` 108 (30 code) — about 1,070 added non-test lines with comments across eight files (two of them, `backend.ts` and `graph.ts`, comment-only), 467 of them code, against §0's ~300 before the comments are counted (D23's reading still open, as D67 recorded). Primer §82 new (`switch` over a tagged union — the completeness §34 promised to "the PR that first needs it"), §83 new (a template literal type); §9 (the type-only import across the layer boundary), §21 (`new Set(other)` copies), §27 (`Math.floor`), §50 (`structuredClone`), and from the review §5 (an arrow returning an object literal), §16 (a `Map` spread into `[ ]`), §22 (`entries()`) and §49 (`Partial`, in the heading too) gain a paragraph. Reading order 61–63 new, 61–93 → 64–96 (one perl pass; headings and every cross-reference checked as a multiset); items 3, 27, 28, 35, 47, 48, 50, 54, 58 reworded; "Where the layers live" gains `src/webview/`; §10.1 item 21's reading-order reference 62 → 65. No CHANGELOG line, README unchanged (nothing shows until 23d). Bundle unchanged — nothing in `src/` imports either file until 23d. 9 commits, each green — the seventh a review's fixes (four lenses, two sceptics per finding: 45 confirmed, none refuted — `LayerContext.isDraft` follows the circle's state, so a merged or closed PR never lights it; the change a row draws is derived once behind the trunk-line rule, so a stray `change` on git-spice's trunk line draws nothing; eight tests, 103 → 111; the headers, pointers and act/assert markers), the eighth the docs, the ninth SonarCloud's S3776 on `indicatorsFor` (cognitive complexity 20 over 15): `gitSpiceIndicators` (⇈ · 💬 · ⇄ · ↑n, taking the entry and its `GsLogDown`) and `changeIndicators` (the circle and ✕, taking the `GsLogChange`) split out, two `?.` chains for S6582, no test changed. | §7.1.3's "one model … both webviews render it and compute nothing themselves" and its sketch, with "every field has a §8 row"; §7.1.1's fixed tail and dim names; §7.8's two tiers and E56/E57's three states (D59), applied to every stack rather than HEAD's; E79's rules; §4.1's webview rule and "types only, so the browser bundle carries no host code"; D13's one remote setting (the trunk's, not git-spice's); D55's "a field is added when something reads it" (`comments`, `byName`, `remoteBranches`) and "`npm run typecheck` is its test"; D59's digest as the one text read on every refresh, so a second fact off it costs nothing (`isInitialised`'s precedent); D67's "the other stacks' `tracking` needs `enrich`'s full `gs log --all` list beside `RepoState` — a 23b/23d change, not a graph field"; `docs/view-lab.html` panes B and C and its inventory's ⛅ row (a git fact); the measured push field (`design-m6-23b/facts.sh` → `facts.out` F1–F13, and the panel's lab M1–M11, git-spice 0.31.2, 2026-10-15/16); pending item 5, kept open. Design 23b (M6): three lenses, three sceptics, synthesised 2026-10-16. |
| D69 | M6 PR 23c | The third M6 PR — tooling plus the thinnest slice of browser code — on 23b; nothing shows until 23d. **Four things the plan did not say, said here first.** (1) §10.1 23d's "rows rendered as plain text for now" is built in this PR, on the view side (`src/webview/smartlog/render.ts`), so 23d is host code only: §10.1's never-mix rule applied to the webview/vscode pair as 13a/13b applied it to core/vscode — the plan did not split 23d or 23i that way, so this is our choice; §7.1.3's "nothing is interpolated into markup" means those rows had to be browser code in any case. (2) One esbuild entry, `smartlog`, where §9.2 said `{smartlog,graph}` and 23c's text "one IIFE per view": the shape is the `entryPoints` object whose keys name the files, met with one view; `graph` is one key in 23i, whose text owns the graph view, and a `graph.js` nothing loads in every `.vsix` from 23c to 23h is dead code for the reader (D15's reasoning). (3) Two one-line `tsconfig.json` files inside `src/webview/` and `test/webview/`, each `{ "extends": "../../tsconfig.webview.json" }` — not in the plan: VS Code's TypeScript service takes the nearest `tsconfig.json` above a file, and with the root one excluding these folders every webview file sat in an inferred project with the DOM on and `strict` off, the editor silent on a `process.env` that `npm run typecheck` refuses (measured with tsserver 5.9.3); a `references` entry in the root fails `tsc --noEmit -p tsconfig.json` (TS6306/TS6310) and a solution-style root makes esbuild's `tsconfig` option load-bearing for both worlds and strips `"use strict"` until it is passed, so the pointers it is — the root run, `eslint .`, esbuild's auto-discovery and `vsce ls` unchanged; esbuild and Vitest take the nearest `tsconfig.json` for these files too (the view bundle's `"use strict"` is that chain's `strict`, measured by writing `strict: false` into the pointer), so the two stay at `extends` alone. (4) Unknown host messages are ignored in silence, a rule the plan does not have: VS Code's bootstrap (`pre/index.html` at 1.85.0) relays `webview.postMessage`'s object into the content frame and nothing else, so the check guards our own future members (23g) and malformed posts, not a foreign sender, and a `console.warn` reaches a Developer Tools pane nobody has open. **Two worlds for `tsc`.** `tsconfig.webview.json` extends the root with `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `types: []`, `include: ["src/webview", "test/webview"]` and its own `"exclude": []` — `exclude` is inherited through `extends`, and the root's new `"exclude": ["src/webview", "test/webview"]` would leave the project with no inputs (TS18003, measured); `npm run typecheck` is two runs (≈ 1.2 + 0.5 s). Measured and leaned on: with `types: []` a `process`, `__dirname`, `Buffer` or `require` is TS2591/TS2304 in a view *and* in a test under `test/webview` with `vitest` in the program — vitest's types reference nothing of Node's — so `test/webview` belongs to this config; a type import of `protocol.ts` from `src/vscode` is followed across the exclude (23d's host side checks it under Node's types too); a *value* import of `host.ts` there fails the root program on `window` — the host side of §4.1 for free; the four core files `protocol.ts` reaches through `import type` are in the webview program and compile under the DOM lib with no Node types — core is pure, said by the compiler, and a Node type entering the model's closure would fail this run naming a core file, the right failure since that closure is what crosses `postMessage`; one config with the DOM everywhere would let `src/core` name `document` (measured), so that was not done; the DOM lib declares `window`'s properties as bare globals, so `return name`, `parent`, `if (event)` compile against `window.*` in a view (measured) and `no-restricted-globals` refuses seventeen of them. **ESLint**: one block for `src/webview/**/*.{ts,mts,cts}` (a `.mts` is in the webview program and the bundle too) — typescript-eslint's `no-restricted-imports` (`allowTypeImports: true` on the `**/core/**` pattern — ESLint's own rule has the option as well; the copy is used because the recommended TypeScript rules come from the same plugin; `vscode`; every name of `node:module`'s `builtinModules` in both spellings, the `_`-prefixed internal modules included — a filter dropping them let `_http_agent` through, measured — built in the config so a new built-in is covered the day Node ships it and no count is written, since CI's Node 24 and a Mac's Node 26 differ) and `no-restricted-globals`; the core block keeps ESLint's own rule; no block for `test/webview` (none for `test/unit` or `test/git` either; `node_modules/vscode` does not exist, so such an import fails to resolve under Vitest anyway). The rule does not see a dynamic `import()` or a `require()` call (ESLint's rule has no `ImportExpression` handler; typescript-eslint's adds `import x = require()` only); esbuild inlines a dynamic import, so the bundle test is the one guard for that form, while a `require()` is refused first by `@typescript-eslint/no-require-imports` and by the compiler (no `require` under `types: []`). **esbuild**: a second options object — `entryPoints: { smartlog }`, `outdir: 'dist/webview'`, `platform: 'browser'` (an import of `vscode` or a built-in fails the build outright; a Node *global* it does not refuse — it rewrites `process.env.NODE_ENV` to a string — so `types: []` is that guard), `format: 'iife'` (IIFE over ESM by 143 bytes of wrapper and because one `<script nonce>` with no exports is what §7.1.3's CSP wants; 23d puts the tag at the end of `<body>`), `target: 'chrome114'` (VS Code 1.85.0 pins Electron 25.9.7, whose DEPS say Chromium 114.0.5735.289 and Node 18.15.0), `sourcemap`; no `tsconfig` option — esbuild reads `strict` from the nearest tsconfig (the nested pointer → the chain), which is where both bundles' `"use strict"` comes from, so the line is asserted as tsconfig's, not as the IIFE's; two watch contexts; one merged metafile and one `dist/meta.json` (the two worlds' inputs are disjoint, since the view takes only types from core); `copyFile` of `codicon.css` and `codicon.ttf` after the builds, before the first in watch mode; `--dist <dir>` moves every output and refuses to run without a directory (a bare flag wrote to `./undefined/`, which `vsce ls` listed) — the one seam, named for its one caller, `test/unit/build.test.ts`, which runs the real script into a temporary directory instead of writing `dist/` from inside `npm test` (a race with `npm run watch`, and a side effect a reader does not expect of a test). **Vitest**: a third project, `webview`, `environment: 'happy-dom'` — the §11.3 decision: happy-dom 21.0.3, a typed built-in Vitest 5 environment with no deprecation; both cards pass every row (happy-dom's one maintainer under the ≥ 10M/week clause); the direct dependencies of a dev dependency ship nowhere; stars were never reached because the options were not equal — happy-dom installs 9 packages to jsdom's 36 plus `@types/jsdom`, runs the 17-row DOM feature file in 318 ms to 536 and passes 16 rows to 12: jsdom has no `DataTransfer`, `DragEvent`, `ResizeObserver`, `matchMedia` or `scrollIntoView` (none in its source), happy-dom has a real `DataTransfer` and no `DragEvent` (the global is an alias of `Event`, one of some twenty); and the facts written down for 23e, 23f and 23h: every width and rect is 0 in both and happy-dom's `ResizeObserver` never fires, so a renderer reads `root.clientWidth` on `resize` and E80's 260/200 px tests stub it with `Object.defineProperty` and fire `resize`; a drag test dispatches `dragstart`/`dragover`/`drop` as plain events and the renderer keeps the dragged row itself, touching `dataTransfer` only behind `?.`; happy-dom's `focus()` checks no focusability (a plain `<li>` takes focus, Chromium and jsdom refuse) so rows carry `tabindex` and tests assert it; `draggable = true` is an expando there, so `setAttribute`. The document is shared across a file's tests: every renderer test resets `document.body` and mounts its own root. **The thin slice**: `src/webview/host.ts` — `VsCodeApi { postMessage }` only, a subset of VS Code's frozen object (`getState`, `setState` and `postMessage`'s `transfer` exist and nothing reads them; D55, with `retainContextWhenHidden` off the host re-posts on every show; 23f decides whether focus survives a hide), a module-scoped `declare function acquireVsCodeApi(): VsCodeApi` (hand-written — `@types/vscode-webview` 1.57.5 is 159,808 downloads/week, under the floor; module-scoped so only this file can name it and no renderer acquires the API twice — VS Code throws on the second call), `connect(): HostConnection` with `onModel` (a `window` `message` listener behind an origin check — only the page's own origin, which VS Code's bootstrap gives the host's posts by relaying them with `contentWindow.postMessage(message, window.origin)` into a content frame that shares that origin by construction; SonarCloud's S2819 asked for the check, and happy-dom has no `window.origin`, so the code compares `event.origin` with `globalThis.location.origin` (S7764 prefers `globalThis` to `window` outside the window-specific API) and the fake posts `window.location.origin` — and a three-clause type predicate — `type === 'model'`, `typeof seq === 'number'`, `Array.isArray(repos)` — so `lastSeq` can only ever hold a number; a tag-only check let `{ type: 'model' }` through and posted a command whose `seq` was `undefined`, which `JSON.stringify` drops, measured) and `postCommand` (stamped with the last delivered model's `seq`, 0 before any — E79's view half; the `seq` moves before the handler runs, so a renderer that defers drawing accepts a one-frame window); `src/webview/smartlog/render.ts` — `render(root, message)`, one `<div>` per line through `textContent` (a text node with newlines would collapse to one line under `white-space: normal`), a repository's root printed only when there are several (the tree's rule; pending item 5 undecided — `activeRepo` carried, not drawn), rewritten in place by 23e; `src/webview/smartlog/main.ts` — the entry, one line, no test of its own (a re-imported entry keeps its listener on the shared `window`, so a per-test import would pass by coincidence; the bundle test sees `acquireVsCodeApi()` and 23d's `ext/views` runs the real page). **`@vscode/codicons` failed §11.3's licence floor as written and ships attributed; Ric widened the floor for shipped assets the same day.** The icons are CC-BY-4.0 (`LICENSE`; the stylesheet MIT, `LICENSE-CODE`, its header kept in the copy) — not MIT/ISC/BSD/Apache-2.0. The floor is the plan's first commit (36d12b7, 2026-09-18, "publishable without a legal question"); the §11.3 row naming codicons came two days later (cf1d813, 2026-09-20) with no card. Shipped as `dist/webview/codicon.css` + `codicon.ttf` (188 KB of files, +83 KB in the `.vsix`, copied, never imported — bundle delta 0) with `THIRD-PARTY-NOTICES.md` at the root — Microsoft's copyright, the CC BY 4.0 name and URI, the warranty disclaimer, the link to the material, "no changes", and the MIT text for the stylesheet: CC-BY §3(a)(1)'s retained items, as VS Code's own `ThirdPartyNotices.txt` carries the same package — and README's licence line pointing at it; a root file `.vscodeignore` does not name is packed (measured with `vsce ls`), which is why `test/unit/vsix.test.ts` pins the five root files; pinned to the exact `0.0.46-24` with `npm i -E` — 27 plain releases exist but `latest` and every version since 0.0.45 are `0.0.46-NN` prereleases, and `^0.0.46-24` admits the `next` tag's `0.0.46-45`. "Inline SVG" is no MIT alternative (the SVGs are the same CC-BY icons); hand-drawn glyphs are, and are not VS Code's. **Decided (Ric, 2026-10-16):** CC-BY-4.0 accepted for a shipped asset with attribution — the floor row gained the clause "for an asset that ships as a file (icons, a font), CC-BY-4.0 with its attribution in `THIRD-PARTY-NOTICES.md`" in the eleventh commit, and `scripts/depcheck.mjs` prints that clause for a CC-BY-4.0 package in place of the FAIL (a third answer, since no registry field says whether a package is an asset). The attribution was checked clause by clause against CC BY 4.0 §3(a)(1) first: every retained item is in the notice, which ships with the font (`test/unit/vsix.test.ts`), and §3(a)(1)(C) accepts the licence's URI in place of its text. The clause admits no CC licence for code and no CC variant but BY 4.0 (SA, NC and ND each carry a term the plan could not accept; 3.0's attribution differs). **Tests** `webview/host` 7, `webview/render` 5 (happy-dom), `unit/lint` 7 (ESLint's API over the real config on in-memory probes — the `src/core` rule's first test since M1), `unit/build` 5, `unit/vsix` 1; unit 964 → 977, webview 12, git unchanged; `npm test` 36 s, 28 of them git. A four-lens review (tooling, mutation, comments, plan; two sceptics per finding) confirmed 34 of 37 findings, applied in the seventh commit: the tests pin what the comments claimed (the predicate's tag and array clauses, a `<div>` per line, the notices once before several repositories, all seventeen window globals, protocol.ts absent from the bundle, the two `.vscodeignore` lines where `vsce ls` cannot see them), a `node:` substring assertion that matched `ViewRow.node` is gone, the lint globs cover `.mts`, `--dist` refuses a bare flag, and the comments say what is true (ESLint's own rule has `allowTypeImports` too; a `require()` is refused before the bundle test; the pointers are esbuild's and Vitest's nearest tsconfig as well as the editor's). Lines: `host.ts` 106 (39 code), `render.ts` 67 (32), `main.ts` 15 (3), the tooling files +63/+63/+18/+10 lines, the notices file 46. Primer §84 (`declare`), §85 (the DOM lib and the browser's globals), §86 (a type predicate), §87 (the DOM as a tree) new; §9 two lines, §16, §25, §28 and §65 gain a paragraph. Reading order 64–68 new, 64–96 → 69–104 (one perl pass, the cross-references checked as a multiset), five toolchain items new (91, 93, 95, 105, 106), ten items and "Where the layers live" reworded; `.vscodeignore`'s comment count-free; `ci.yml`'s header gains "webview"; README's Loop, Tests, Layout and License. No CHANGELOG line. 12 commits, each green — the seventh a four-lens review panel's 34 confirmed findings (37 found, two sceptics each, 3 refuted), the ninth SonarCloud's S2819 (the listener's origin check), the tenth its S7764 (`globalThis.location`), the eleventh §11.3's asset clause on Ric's answer, the twelfth SonarCloud's S3358 on that clause's script. | §4.1's rule and "types only, so the browser bundle carries no host code", and its "from M6, a second [lint rule]"; §7.1.3 "Protocol" (the `seq` sentence), "Theme" (codicons copied into `dist/webview/`) and "Security" (nothing interpolated into markup — so plain-text rows are view code); §10.1's never-mix rule and its lesson, applied to the webview/vscode pair; §10.1 23c ("one IIFE per view", "pick by the §11.3 table") and 23i (the graph view's renderer and container); §9.1 1b; §11.3's "a session checks them, it doesn't judge" — a failed floor is recorded and asked, not waived or hidden — and its "stars only as a tiebreak between two otherwise-equal options"; D15 (dead code for the reader), D55 (declared when read; `npm run typecheck` as a types-only file's test), D1–D8's tooling-deviation shape; `tsconfig.json`'s own "no browser DOM" comment; VS Code 1.85.0's `pre/index.html`, `webview.ts` and `package.json`, Electron 25.9.7's DEPS, happy-dom 21.0.3's and jsdom 30.1.3's sources, ESLint's and typescript-eslint's rule sources, Vitest 5.0.1's types, CC-BY-4.0 §3(a)(1); the measurements in `design-m6-23c/facts.sh` → `facts.out` F0–F6, `cards.md`, and the panel's labs (`lab-tooling` T1–T20, `lab-tests` T1–T9, `lab-plan` P1–P4/M1–M3/X1–X4, `lab-attack-sources` S0–S10, `lab-attack-plan` A1, `lab-attack-api` A1–F7, `lab-synthesis` Y1–Y11; 2026-10-16). Design 23c (M6): three lenses, three sceptics, synthesised 2026-10-16. |

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
- **Drag-and-drop move added to M9 (2026-09-20, Ric's request):** he likes the visual stack views in Graphite
  and VisualJJ; the drag gesture is the first UI borrowed from them and rides on M9's `moveOnto` (§7.2.1, E77,
  §10.1 item 38b). Later the same day he chose the **views** (next bullet), so the gesture lives in the
  webviews rather than in a `TreeDragAndDropController`.
- **DECIDED 2026-09-20: two views, both webviews (§3, §7.1, new M6).** After the view-lab mockups
  (`docs/view-lab.html`: the plan's tree, a Graphite-style smartlog, a VisualJJ-style graph — one scenario,
  every indicator drawn) Ric chose *both* graph renderings: the compact smartlog is what he will keep in
  the Explorer for daily use because it condenses to a narrow pane; the detailed graph gets the
  extension's own container as the "elegant" view. Consequences taken: a new M6 (old M6–M10 renumbered
  M7–M11; §10.1 item numbers unchanged, the new PRs are 23a–23j); multi-stack (old M9) folds into M6; the
  native tree is deleted at the end of M6; item 38b's drag and drop moves into the webviews; §7.9's
  no-webview principle is unchanged (it is about text editing). The accepted costs are in §7.1.3 — the
  largest is losing the user's file-icon theme on file rows. The mockup page's third-party reference
  frames (Graphite's and VisualJJ's own demo GIFs) are linked from it, not committed. **Order is his
  call:** M6 sits before PR creation because the later tree items (20, 29, 39, 38b) would otherwise be
  built twice; if he would rather create PRs from the tree first, swap M6 and M7 — nothing in M7 depends
  on the views. Verified for this decision (VS Code source and docs, 2026-09-20): `contributes.views`
  entries take `type: "webview"` in `explorer`, `scm`, `debug`, `test`, `remote` and custom containers;
  `webview/context` menus with `data-vscode-context` give native context menus; container icons are image
  files, not codicons; `retainContextWhenHidden` is documented as high-memory and is not needed here.
- **DECIDED 2026-09-19: `ExtensionApi` stays as is** — a plain `{ provider, refresh }` test seam (§9.1), no
  rename, no `getAPI(version)` shell like the built-in git extension (no external consumers exist or are
  planned). **M5 design note:** the fake runner/terminal injection §9.4 needs for extension-host tests must
  not be reachable by other extensions; expose such hooks only when
  `context.extensionMode === vscode.ExtensionMode.Test`, keeping `{ provider, refresh }` unconditional. First
  use of that hook: item 14's `statusBar` and `treeView` (D52, 2026-09-30).
- **`gh stack link` changes the checked-out branch (found 2026-09-19).** After the 8-branch relink the
  working tree was left on `m1/01-scaffold` (reflog: "moving from m1/08-vscode-scan-settings to
  m1/01-scaffold"). For §7.13.4 / M7: `core/nativeStack.ts` must record HEAD before the link and restore it
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
- **M9 "Sync Stack" MUST handle a remote rewritten by someone else (verified by simulation 2026-09-20).**
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
- *(Superseded 2026-09-26 by the Git-extension decision below and §7.14 — the scan, its two settings and the
  silent up direction go in M4 item 12a; E1b now inherits the Git extension's parent-folder prompt, a consequence
  of the note's "no fallback path"; kept for the record.)* **RESOLVED 2026-09-19 and delivered as M1 PRs 7 and 8 (`m1/07-core-discovery-subfolders`,
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
  zero-repo case, needs a context key to avoid flashing, and duplicates the built-in SCM welcome. *(2026-09-30,
  item 14: `onStartupFinished` alone does not make the status bar exist — VS Code queues a hidden tree view's
  refresh until the view shows, and the adapter's first handshake starts only on the first load — so
  `refresh()` runs the pipeline for the status bar while the view is hidden, and `activate()` runs it once at
  startup; D52.)*
- *(Superseded 2026-09-26 by the DECIDED 2026-09-20 / RECORDED 2026-09-26 Git-extension bullet below and §7.14 —
  no watcher, focus listener or discovery cache of our own; and the `**/.git/HEAD` watcher it attributes to the Git
  extension does not exist — that extension watches the whole first level of `.git`; kept for the record.)*
  **§3 "Refresh" row premise is wrong.** `.git` is *not* in the default `files.watcherExclude`; only
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
- **M3 started 2026-09-20** as branches `m3/01-core-uri`, `m3/02-vscode-diff` (plan §10.1 items 10–11); #16 (idiomatic cleanup) merged the same day. (M2's GitHub numbers, promised above: PRs #11–#13, merged 2026-09-20; the §11.1 rule change was #15.)
- M3 stack built, reviewed and submitted 2026-09-20 (see D40–D45). After M3 merges, **M4** is next: refresh triggers, state nodes, status bar, v0.1.0 — with the activation and `capabilities` decisions already recorded above (the discovery-caching idea was superseded a week later, next bullets).
- **M3 merged 2026-09-20** (PRs #17, #18). The same day's Q&A produced the decision below; it was recorded on
  2026-09-26 as a docs PR off `main` (#22, merged the same day), before M4 starts.
- **M6 item 23c, 2026-10-16**, branch `m6/23c-webview-build` stacked on 23b (D69): `tsconfig.webview.json` (new),
  `src/webview/tsconfig.json` and `test/webview/tsconfig.json` (new, one line each — the editor's pointers),
  `tsconfig.json` (`exclude`), `eslint.config.mjs` (the `src/webview/**` block: imports and window globals),
  `vitest.config.mts` (the `webview` project, happy-dom), `esbuild.mjs` (the second world, the codicons copy, two watch
  contexts, one metafile, `--dist`), `package.json` (`typecheck`, `test:webview`, `test`; devDependencies `happy-dom`
  ^21.0.3 and `@vscode/codicons` 0.0.46-24 exact), `.vscodeignore` (comments), `.github/workflows/ci.yml` (one word),
  `THIRD-PARTY-NOTICES.md` (new, ships), `src/webview/host.ts` (new — `VsCodeApi`, `HostConnection`, `connect`),
  `src/webview/smartlog/render.ts` (new — `render`), `src/webview/smartlog/main.ts` (new), `src/webview/protocol.ts` and
  `src/core/viewmodel.ts` (headers); `webview/host` (new, 7), `webview/render` (new, 5), `unit/lint` (new, 7), `unit/build`
  (new, 5), `unit/vsix` (new, 1); unit 964 → 977, webview 12, git 210 + 2 skipped unchanged; `test:ext` run once, 135 passing (133 + 2) unchanged — no
  `src/vscode`, `extension.ts` or `contributes` change, and `npm run build` now writes `dist/webview/` too. Primer §84
  (`declare`: a name the page provides), §85 (the browser's globals and the DOM `lib`, and its price), §86 (a type
  predicate) and §87 (the DOM as a tree) new; §9 (two lines), §16 (method shorthand), §25 (`Array.from(list, fn)`), §28
  (`execFileSync(process.execPath, …)`) and §65 (`vi.stubGlobal`) gain a paragraph. Reading order 64–68 new (`host.ts`,
  `render.ts`, `main.ts`, the two `test/webview` files), five toolchain items new (`tsconfig.webview.json` 91, `unit/build`
  93, `unit/lint` 95, `unit/vsix` 105, `THIRD-PARTY-NOTICES.md` 106); 64–96 → 69–104 by one perl pass with a mapping
  table, headings and every cross-reference checked as a multiset (190 references, 27 of them ≥ 64 moved); item 62's stale
  `(item 84)` corrected to the eslint item first; items 1, 62, 90, 92, 94, 96, 100, 103, 104 and "Where the layers live"
  reworded; §10.1 item 21's reading-order reference 65 → 70 — the dated bullets below keep their day's numbers. The plan's
  §4.1 (as built), §4.2 (three lines), §7.1.3 (Protocol's view half, Theme), E79, §9.1 1b, §9.2 (eight lines), §9.4 (five
  rows), §10.1 (23c, 23d's clause), §11.1 (the dev list), §11.2 item 7, §11.3 (the packaging paragraph, two rows; the
  floor table's asset clause in the eleventh commit, on Ric's answer) and §13.2 D69. No CHANGELOG line (nothing shows until 23d); README's Loop,
  Tests, Layout and License. `.vsix` 50,293 → 133,174 bytes (7 → 11 entries; `vsce ls` nine files); `dist/extension.js`
  126,078 bytes unchanged; `dist/webview/smartlog.js` 1,985 bytes (no budget set — §11.3's 500 KB is the host bundle's;
  Ric asked). Measured 2026-10-16 (node 26.10.0, esbuild 0.28.2, vitest 5.0.1, typescript 5.9.3, eslint 10.11.0,
  typescript-eslint 8.70.0, happy-dom 21.0.3, jsdom 30.1.3, @vscode/codicons 0.0.46-24; `design-m6-23c/facts.sh` →
  `facts.out` F0–F6, `cards.md`, the panel's seven `lab.out` files): a type-only import from core adds nothing to a
  browser IIFE (411 B, one input) and a value import brings `graph.ts` and `viewmodel.ts` in (822 B) — what the lint
  rule stops; `node:fs` and `vscode` fail a `platform: 'browser'` build outright while `process.env.NODE_ENV` is
  rewritten, not refused; the root tsconfig refuses `window`/`document`/`MessageEvent<T>` (TS2304, TS2584, TS2315 —
  Node's `MessageEvent` is not generic) and a DOM-lib config with `types: []` refuses `process` (TS2591) and `node:fs`
  (TS2307), in the tests too; an extending tsconfig inherits `exclude` (TS18003 without its own); tsc follows `import
  type` past `exclude` and refuses a host file that imports view code; tsserver puts an excluded file in an inferred
  project (no diagnostic for `process.env`) until a nested `tsconfig.json` points it at the webview config; the DOM lib
  makes `name`, `parent`, `event`, `status`, `length` compile as bare names; `builtinModules` has 67 names on Node 26, 5
  `node:`-only, 8 internal and loadable; a tag-only message check let `{ type: 'model' }` poison `seq` with `undefined`;
  a re-imported entry keeps its listener on happy-dom's shared `window`; happy-dom has no `window.origin`, its
  `location.origin` is `http://localhost:3000` and a dispatched `MessageEvent`'s `origin` is `''` unless its init names
  one; VS Code's bootstrap relays the host's message with `contentWindow.postMessage(message, window.origin)` into a
  same-origin content frame; IIFE 1,978 v. ESM 1,835 bytes, `chrome114` and
  the `tsconfig` option inert today, `"use strict"` tsconfig's; the watcher's two contexts each rebuilding its own world;
  `vsce ls` nine files, no maps, no nested tsconfig, a stray root file listed; happy-dom's widths 0, `ResizeObserver`
  silent, `DragEvent` an alias of `Event`, a focusable plain `<li>`, an unreflected `draggable`; jsdom without
  `DataTransfer`, `DragEvent`, `ResizeObserver`, `matchMedia`, `scrollIntoView`; VS Code 1.85.0's bootstrap throws on a
  second `acquireVsCodeApi()`, freezes the three-member object and relays only the host's posts into the content frame;
  Electron 25.9.7 is Chromium 114.0.5735.289; codicons 0.0.46-24 is npm's `latest`, 27 plain releases then 64
  prereleases, CC-BY-4.0 icons / MIT code, 752 CSS rules, every glyph the plan names present, the licence floor two days
  older than the codicons row (36d12b7 / cf1d813). The codicons licence question (D69) was answered the same day — the floor's asset clause, the eleventh commit, and
  `depcheck.mjs`'s third answer for CC-BY-4.0; §12 item 10 (Explorer or SCM, before 23d) is open for Ric. 12 commits, each green — the seventh a four-lens review panel's 34 confirmed findings (37 found, two sceptics each, 3 refuted), the ninth SonarCloud's S2819 (the listener's origin check), the tenth its S7764 (`globalThis.location`), the eleventh §11.3's asset clause on Ric's answer, the twelfth SonarCloud's S3358 on that clause's script.
- **M6 item 23b, 2026-10-16**, branch `m6/23b-viewmodel` stacked on 23a (D68): `src/core/viewmodel.ts` (new — `ViewModelInput`,
  `BehindTrunk`, `PrState`, `Indicator`, `LayerViewRow`, `TrunkViewRow`, `WorkingTreeViewRow`, `ElidedViewRow`, `ViewRow`,
  `LayerContext`, `TrunkContext`, `WorkingTreeContext`, `MessageKind`, `MessageRow`, `StackViewModel`, `buildStackViewModel`,
  `formatAge`, the four `*_TEXT` constants), `src/webview/protocol.ts` (new, types only — `HostNotice`, `ModelMessage`,
  `CommandId`, `CommandMessage`, `MoveOntoMessage`, `HostMessage`, `ViewMessage`), `src/core/model.ts` (`Enrichment.enriched` +
  `byName`, `complete`, `remoteBranches`; `PrExtras`, `ReviewDecision`), `src/core/backends/gitspice.ts` (`withTracking` sets
  them), `src/core/digest.ts` (`remoteBranches`), `src/core/gsLog.ts` (`change.comments` kept — the branch's first commit);
  `unit/viewmodel` (new, 111), `unit/enrich` (14 literals, +2), `unit/digest` (+5), `unit/gsLog` (+2), `git/gitspice.git`
  (2 literals, +2); unit 844 → 964, git 208 + 2 skipped → 210 + 2 skipped; `test:ext` run twice, unchanged (135) — no `src/vscode`,
  `package.json`, `extension.ts` or `eslint.config.mjs` change (the `src/webview/**` rule stays 23c's), and nothing in `src/`
  imports either new file until 23d. Primer §82 (`switch` over a tagged union) and §83 (a template literal type) new; §9 (a
  type-only import across the layer boundary), §21 (`new Set(other)`), §27 (`Math.floor`), §50 (`structuredClone`) and,
  from the review, §5 (an arrow returning an object literal), §16 (a `Map` spread into `[ ]`), §22 (`entries()`) and §49
  (`Partial`, in the heading too) gain a paragraph. Reading order 61–63 new, 61–93 → 64–96 (one perl pass; headings and every cross-reference checked as a
  multiset — 25 numbers in 24 phrases moved); items 3, 27, 28, 35, 47, 48, 50, 54 and 58 reworded; "Where the layers live"
  gains `src/webview/`; §10.1 item 21's reading-order reference 62 → 65 — the dated bullets below keep their day's numbers.
  The plan's §4.2 (five lines), §4.3, §7.1.1 (two clauses), §7.1.3 (the sketch replaced by the shapes as built; the
  protocol), §7.2.1 (two clauses), §7.8, §7.13.2, E3, E4, E5, E12, E56, E57, E79, E80, E81, E82, §9.4 (five rows), §10.1
  (23b, item 21) and §13.2 D68. No CHANGELOG line, README unchanged (nothing shows until 23d). Lines: `viewmodel.ts` 771
  (372 code), `protocol.ts` 108 (30 code); bundle 121.8 → 121.8 KB. Measured 2026-10-15/16 (git-spice 0.31.2, hermetic HOME;
  `design-m6-23b/facts.sh` → `facts.out` F1–F13 and the panel's `lab-attack-sources/lab.sh` → `lab.out` M1–M11): `gs log
  short --all --json` prints `push` only for a branch git-spice itself submitted — nothing pushed → no `push` on any line
  (F1); two branches pushed with plain `git push -u` → still no `push`, though `refs/remotes/origin/<b>` exists for both (F2,
  F8), before or after `gs branch track` (M1, M2 — `track` never adopts git's upstream, `submit` does, M10); a `stack submit
  --no-publish` refused for `needsRestack` leaves every line as it was (F6); after `stack restack` the same submit pushes two
  and both lines gain `"push":{"ahead":0,"behind":0}` (F9); a commit on a submitted branch → `"push":{"ahead":1,"behind":0,
  "needsPush":true}` (F12); a commit pushed to the remote branch from elsewhere and fetched → `"push":{"ahead":0,"behind":1,
  "needsPush":true}` (M4a — `needsPush` is "the tips differ", so `↑n` reads `ahead`, not `needsPush`; diverged M4b `ahead 1,
  behind 1`); deleting the remote-tracking ref locally, or the branch on origin plus `fetch --prune`, removes `push` from the
  line (M5, M6 — so D64's "`push` absent ⇔ no upstream" reads "⇔ no git-spice upstream record, or its remote-tracking ref is
  missing"); the trunk line has no `push` even when the local `main` is ahead (M7); an untracked second name on a tracked
  commit is not listed and the layer above keeps its tracked `down` (M8), which is why ⇄ compares with `down.name` and not
  the rail's parent; so `push` absent means "not submitted by git-spice", not "never pushed", and ⛅'s source is the digest's
  `refs/remotes` lines (M9). `needsRestack` sits on `down` of the layer directly above the moved ref — every bottom layer
  after a pushed trunk commit (F3), the top layer after a commit on the middle one (F2). `current: true` is on exactly one
  line (F4). `gs log long --json` adds `commits: [{ sha, subject }]`, newest first (F5) — 23i's subject, still dropped by
  gsLog.ts. A relative remote URL (`../origin.git`) breaks `branch submit`'s `ls-remote` from a subdirectory (F13) — a lab
  artefact; the 22b suite uses absolute paths. The compile probes: `src/webview/protocol.ts` (types only, `import type` from
  core, a template literal type) compiles under the unchanged `tsconfig.json`; `document` is TS2584 there (no DOM lib until
  23c), `process.env` is not refused (`types: ["node"]` — 23c's webview tsconfig closes that); a `switch` over
  `GraphRow['kind']` with four returning cases compiles and fails TS2366 the moment a fifth member exists. 8 commits, each
  green — the seventh the review's fixes (four lenses, two sceptics per finding; 45 confirmed, none refuted):
  `LayerContext.isDraft` is `prState === 'draft'`, so a merged or closed pull request never lights the draft key however gh
  answers; the change a row draws is derived once, behind the trunk-line rule, so a stray `change` on git-spice's own trunk
  line gives no circle, no `hasPR`, no title line and no dim (and T6 leaves `main` out of the digest's names, so its empty
  tail can only come from that rule); `indicatorsFor` takes the digest's set, read once into `RowFacts`; the §7.2.1 comments
  say what the code does — every rebase pause point but `git am` detaches HEAD, and a paused `am` on a layer keeps the
  filter (one test); eight tests in all (103 → 111: diverged `ahead 1, behind 1` draws `↑1`; a closed PR is not dim; the
  behindTrunk table asserts its tooltip lines; `hasPR`, the id line and dim on every `status` row; `formatAge` at 90 s,
  59 min 59 s, 60 h and 6 d 23 h); `as const` dropped from the two test files for return-type annotations; the headers'
  "depended on by" lists, the primer pointers at first use, and act/assert markers in 25 tests — the eighth the docs, and the
  ninth SonarCloud's S3776 on `indicatorsFor` (cognitive complexity 20 over the 15 allowed, as 23a's `measureMembers` was):
  `gitSpiceIndicators` (⇈ · 💬 · ⇄ · ↑n, taking the entry and its `GsLogDown`) and `changeIndicators` (the circle and ✕,
  taking the `GsLogChange`) split out, two `?.` chains for S6582, no test changed.
  Decided 2026-10-16 (Ric; the tenth commit, recorded by the eleventh — the four questions above): HEAD's stack; the PR mark last,
  ✕ before it, as codicons' `git-pull-request` family in the state colour (23e draws it); the trunk label as given; glyphs for
  the four — `remoteAhead`, `diverged` and `worktree` built here (the push slot reads the two counts; `gsLog.ts` keeps
  `worktree`), the native-stack chip and the conflict ring with M7's data. `unit/viewmodel` +2, `unit/gsLog` +1 (966 → 969);
  §7.1.1's tail bullet and E80 reworded.
- **M6 item 23a, 2026-10-15**, branch `m6/23a-core-graph` stacked on M5's 23b (D67): `src/core/graph.ts` (new — `REFS_ARGS`,
  `dagArgs`, `trunkTipArgs`, `readGraphInput`, `parseRefs`, `parseDag`, `parseTrunkTip`, `layoutGraph`, the four-row `GraphRow`
  union, `GraphLayout`), `unit/graph` (new, 110), `git/graph.git` (new, 20); unit 734 → 844, git 188 + 2 skipped → 208 + 2 skipped;
  `test:ext` run once, unchanged (135) — no `src/vscode`, `package.json` or `extension.ts` change, and nothing in `src/` imports
  the module until 23d. Primer §81 new (recursion); §10 (a numeric literal type), §14 (`ReadonlySet`), §25 (`reverse`), §54 (a rest element;
  parameters destructured) and §78 (object rows) gain a paragraph or a sentence; §19, §31 and §62 corrected in passing (`held<T>` in `unit/login` has been a second declared type parameter since
  19b). Reading order 58–60 new, 58–90 → 61–93 (one perl pass; headings and every cross-reference checked as a multiset — 24
  numbers in 23 phrases moved); item 11 reworded; "Where the layers live"; §10.1 item 21's reading-order reference 59 → 62 —
  the dated bullets below keep their day's numbers. The plan's §0 (the second waiver), §4.2, §5 (three rows), §7.1.1, §7.2.1,
  §7.14, E6, E16, E78, §9.4, §10 M10, §10.1 and §13.2 D67. No CHANGELOG line, README unchanged (nothing shows until 23d).
  Lines: `graph.ts` 761 (327 code); bundle 121.8 → 121.8 KB (nothing in `src/` imports the module). Measured 2026-10-15 (git 2.50.1 Apple Git-155; `design-m6-23a/facts.sh` and the
  panel's labs in the session scratchpad): `for-each-ref --format='%(refname:lstrip=2) %(objectname) %(committerdate:unix)'
  refs/heads` lists every local branch by name with its SHA and date, merged or not (`main` and a `same-commit` sharing
  `api-refactor`'s SHA among them; a branch is always a commit — `update-ref` refuses a tag or a blob under `refs/heads`, so the
  date is never absent; a symbolic ref under `refs/heads` prints as a second name on its target); `rev-list --parents
  --branches --not <trunk>` prints one line per commit reachable from a local branch and not from trunk, `<sha> <parent1>
  [<parent2>…]`, newest first by commit date, nothing for trunk's own commits, exit 0 on a trunk-only repository; a parent that
  is no line is the fork commit (`base`, while trunk had moved on to `trunk moves`); a local `main` ahead of `origin/main` is in
  the DAG (D59's quirk); a merge from trunk into a feature branch is a line with two parents, the second a trunk commit; a
  branch whose tip is in trunk is listed by `for-each-ref` and starts no line; a detached HEAD and a linked worktree change
  neither output; a tag named like a branch is invisible to both (`refs/heads`, `--branches`); `--topo-order` exists and is not
  needed (the parse is order-independent); a 1000-commit branch is 1006 lines in 60 ms, a 10 000-commit line with 101 names
  48 ms (computeStack's `rev-list --count` per branch: 3.25 s); `rev-list -1 --no-commit-header --format='%H %ct'
  '<trunk>^{commit}'` prints `<sha> <date>`, unchanged by `log.showSignature`, peels an annotated tag, exits 128 on a missing
  ref; a shallow clone cut inside a stack prints the graft commit with no parents and `rev-list --count` is truncated the
  same way; an orphan branch's first commit prints with no parents; a merge of one named line into another (`b` merging `a`)
  gives `rev-list --count` a 1, b-base 1, b 4 while `for-each-ref --merged HEAD --no-merged origin/main` lists all three — the
  shape where computeStack's chain and the graph's parents differ; `rev-list --count <trunk> ^<bottom>` is the trunk commits
  since a bottom layer's fork (1 for the moved trunk, 0 for a root on the tip). Nine commits, each green — the seventh the
  review's fixes: a four-lens panel (algorithm, mutation, comments and primer, plan conformance) with two sceptics per finding
  over a scratch copy found 39 things, none refuted, 38 taken — twelve of them mutants the 105 tests then missed, every one
  about an order no shape exercised (every refs text was in name order; the tip's SHA `0000…` sorts first) — and one noted
  (the file headers past §11.1's 3–8 lines, as 63 of 82 `.ts` files are: a repository-wide follow-up); the ninth SonarCloud's
  S3776 on `measureMembers` (cognitive complexity 16 against 15; the candidate collection moved into `candidatesOf`). `test:ext`
  135, run once. CI's first run: Ubuntu 1 min 19 s, macOS 3 min 15 s, both green; SonarCloud's gate failed on that one issue.
- **M6 started 2026-10-15 on the unmerged M5 stack** (Ric: "do the next PR") — §0's "don't start the next milestone's
  stack until the current one is merged" waived a second time (the first: M5 on M4, 2026-10-01, below); item 23a sits
  on `m5/23b-gh-setup` (#42), so an amend to any of #30–#42 means `git-spice upstack restack` for it and a fresh
  `gh stack link` of the M6 stack onto M5's. The PR body asked Ric to confirm; **confirmed 2026-10-16**, and the
  sibling order and the meaning of "Show Only This Stack" stay as built — the tenth commit records the three (§0, D67).
- **M5 item 23b, 2026-10-15**, branch `m5/23b-gh-setup` stacked on 23a (D66): `package.json` (two settings),
  `src/vscode/config.ts`, `src/extension.ts` (`backendFor` with `ghPath`, the request), `src/core/readinessFix.ts` (the
  four gh offers — three for `gh-missing` behind one dispatcher, and the login — `ghTokenVariables`, `OfferFacts` +3),
  `src/vscode/login.ts` (`brewGh`, the three steps inside `gh-missing`, the look-again by step, `installAppeared`),
  `test/helpers/fakeReadinessHost.ts`, `unit/readinessFix` 57 → 72 (gh 4 → 19), `unit/enrich` and `unit/push` (the
  `OfferFacts` literals), `unit/login` 61 → 75, `ext/login` +5 (`test:ext` 130 → 135, run twice); README, CHANGELOG. No
  primer section; §25 edited (a tuple type), §49 (`GhMissing`), §8 (one guard, two values), §59 (`offerFor`'s last line);
  reading order items 1, 2, 44, 45, 58, 67, 70, 76 reworded; the plan's §7.3, E23, E62b, §4.2, §7.5, §7.13.1, §9.4 and
  §10.1 rows gain this PR's own clauses. Facts this PR rests on — from D65's measurements: `gh auth login` refused while
  the host's token pair is set and not by the other pair; `gh extension install github/gh-stack` with no login. From gh
  2.102.0's `auth login --help` (read 2026-10-14): `--git-protocol` "will take effect for all users on the host"; `ssh`
  detects and offers to upload a key. From Homebrew's layout: it links `gh` beside `brew` as it links `git-spice`. From
  github.com/cli/cli: `#installation` is the page with every package manager (cli.github.com a download button). From
  the review's pty run of `gh auth login --hostname github.com --web --git-protocol https` (2.102.0, dead proxy): its first
  question is `? Authenticate Git with your GitHub credentials? (Y/n)`, before the device code. Risks carried: offline,
  the login offer shows and the click's line fails in the terminal with gh's own words (the README says to close the
  notification); a bogus `GH_TOKEN` in VS Code's own environment makes the probe read "not logged in" after a real login
  in the terminal, so that wait times out (the README's gh bullet says to unset it and reload); a re-login with the
  default protocol moves an `ssh` host to `https` — the alternative, a third `gitProtocol` value that omits
  `--git-protocol` and lets gh ask in the terminal, is one `enum` entry and one line in `ghLoginOffer`; Ric's call (#42's
  body asks) — **decided 2026-10-16: the empty value, as the default** (the seventh commit: `enum` `["", "https", "ssh"]`,
  `config.ts`'s default `''`, the flag spread in only when set; `unit/readinessFix` +1, `ext/login`'s default line ends at
  `--web`; README, CHANGELOG). Lines: `readinessFix.ts` 491 → 609, `login.ts` 469 → 523, `config.ts` 74 → 89; bundle 117.4 → 121.4 KB (the
  sentences). Six commits, each green — the fifth the review's fixes: a four-lens panel with sceptics over a scratch copy
  found 33 things, 30 of them taken — two of behaviour (an install whose gh came up too old never passed its wait, since
  "not found" and "too old" shared one step; a stale Install with Homebrew ran `brew install gh` for a second gh, since
  the look-again compared `kind` alone), three unpinned rules caught by mutation (`ghTooOldOffer`'s Homebrew guard,
  `factsFor`'s `ghPathSetting`, ext row A's wait), the rest counts, pointers and sentences — and 3 refuted (D66's
  "+4 (+1 in commit 1)" reads as five; "the other pair changes nothing" measured both ways by a sceptic; test headers
  naming every E-row is not a convention the codebase keeps, though D66 was added to three).
- **M5 item 23a, 2026-10-14**, branch `m5/23a-gh-readiness` stacked on 22b (D65): `src/core/version.ts` (new — the helpers out
  of the backend), `src/core/ghstatus.ts` (new), `src/core/backend.ts` (`GhFound`, `ready.gh`, `gh-missing.ghPath`,
  `gh-not-logged-in`), `src/core/backends/gitspice.ts` (`ghPath`, `ghStep`), `src/core/readinessFix.ts` (the interim E23
  sentence, `readyMessage` with gh), `src/vscode/login.ts` (`progressOf` as a table), `src/core/forge.ts`,
  `src/core/command.ts` and `src/core/poll.ts` (comments), `.github/workflows/ci.yml` (`PRCASCADE_REQUIRE_GH`),
  `unit/version` (new, 15), `unit/ghstatus` (new, 45), `unit/readiness` 72 → 77, `unit/readinessFix` 55 → 57, `unit/login`
  60 → 61, `ext/login` (gh canned, the ready line; 130 → 130), `git/gh.git` (new, 17), `test/git/readiness.git.test.ts`
  (header), `scripts/doctor.sh`, the check-toolchain skill, README Tests, CHANGELOG. Primer §80 new; §20, §43, §49, §59,
  §65, §76 edited. Reading order 33, 34, 36, 37, 57 new, 33–85 → 35–90 (33 → 35, 34–52 → +4, 53–85 → +5; headings and
  every cross-reference checked); items 23, 26, 29, 30, 35, 38, 39, 44, 67, 76, 86 reworded; §10.1 item 21's
  reading-order reference 54 → 59 — the dated bullets below
  keep their day's numbers. Lines: `version.ts` 62, `ghstatus.ts` 164, `gitspice.ts` 793 → 803, `backend.ts` 230 → 256,
  `readinessFix.ts` 475 → 490, `login.ts` 471 → 469; bundle 114.2 → 117.4 KB. Measured 2026-10-14 (gh 2.102.0, gh-stack 0.1.1 here / 0.2.1 current; empty `GH_CONFIG_DIR`,
  `XDG_DATA_HOME` and `XDG_STATE_HOME`, prompts disabled; `design23/` in the session scratchpad): `gh --version` two lines,
  56 ms, exit 0 with a config dir that does not exist (not created); `gh help exit-codes` 0/1/2/4; `gh stack --version` prints
  `gh stack version X.Y.Z` with no login and no network (69–75 ms), exit 1 with stdout empty and the three-line install hint
  on stderr when absent; `gh extension list` exits 4 without a login when no `GH_HOST` is set, and 0 with empty stdout when
  `GH_HOST` names a host (gh counts it as configured); `gh extension install github/gh-stack` needs no login (installs the
  current release); `gh auth status --hostname <h>` 0.35–0.40 s and exit 0 logged in (it validates the token; the report on
  stdout); for a host with no account, exit 1 either way but two different answers — without `GH_HOST` the local generic
  sentence `You are not logged into any GitHub hosts. To log in, run: gh auth login` in 65 ms (the per-host `You are not
  logged into any accounts on <h>` whenever gh's host list is non-empty), and with `GH_HOST=<h>` — the probe's own env — a
  validation over the network of the empty default token gh then finds for the host: `<h>` / `X Failed to log in to <h>
  using token (default)` / `Active account: true` / `The token in default is invalid.` / the re-authenticate and logout
  hints, ~0.25 s online (`GET https://api.github.com/` → 401), 82 ms through a dead proxy with the same text; exit 1 with
  `X Failed to log in … The token in GH_TOKEN is invalid.` with a bad token, offline alike — one exit code for every case,
  only stderr differs; the `--hostname` flag is matched against gh's host list unnormalised while the token lookup
  normalises the host (`--hostname ssh.github.com` alone exit 1 "not logged into any accounts on ssh.github.com" while
  github.com is logged in; `GH_HOST=ssh.github.com` with or without the flag exit 0 — github.com's token found), so the
  probe carries the same host in both; the host-list entry keeps `GH_HOST`'s spelling (`GH_HOST=GitHub.COM` is reported as
  `GitHub.COM`, and `--hostname github.com` beside it is "not logged into any accounts on github.com" — the review measured
  it), which is why `ghEnv` lower-cases; without the flag `GH_HOST` reports every host; `--hostname GitHub.COM` is not
  folded (exit 1 while github.com is logged in, `GH_HOST=github.com` or not); for a host `GH_HOST` puts on the list but
  hosts.yml does not know, gh looks in the OS keyring (`gh:<host>`) before the empty default token — with the real `HOME`
  this logged-in Mac's keychain answered for github.com and the real token went to the dead proxy, source `(keyring)`;
  with a fresh `HOME` the `(default)` shape — so the facts file's `HOME` stub is load-bearing on macOS, and a shell's
  `no_proxy=*` would route gh past any proxy (measured: row g2 reached api.github.com with it), so the file empties
  `no_proxy`/`NO_PROXY` beside its dead proxy; `gh auth login --web` with prompts disabled prints the code and waits (never run by the
  runner); `gh auth login` refuses while `GH_TOKEN` or `GITHUB_TOKEN` is set for github.com and `*.ghe.com`, and while
  `GH_ENTERPRISE_TOKEN` or `GITHUB_ENTERPRISE_TOKEN` is set for an Enterprise Server host (exit 1, two lines, writes nothing;
  the other pair does not stop it — gh goes to that host: through a dead proxy an empty line then `failed to authenticate
  via web browser: Post "https://<h>/login/device/code": proxyconnect tcp: …`, the no-proxy offline wording unmeasured and
  quoted nowhere); an empty `GH_TOKEN=` reads as unset; gh ignores SIGALRM (the production runner's SIGTERM/SIGKILL is
  unaffected); `gh --version`, `gh stack --version` and `gh auth status` each write `$XDG_STATE_HOME/gh/device-id` unless
  `GH_TELEMETRY=false` (or `0`, or `DO_NOT_TRACK=1`), with which the config, data and state directories stay empty across
  the three probe commands; `GH_NO_EXTENSION_UPDATE_NOTIFIER` covers the check gh runs when an extension is executed; gh
  documents no locale variable; BSD `env -u A -u B` unsets both; Vitest 5.0.1's `vi.stubEnv(name, undefined)` deletes the
  variable. `src` has one `.readiness(` call (`extension.ts` `probeFor`, reached from the setup command only). GitHub's
  runner images ship gh (2.x) and not gh-stack; CI needs no install step — the require test tells if an image stops.
  `git/gh.git` runs in 1.0–1.6 s here; `test:git` 25 → 28 s locally (a fourteenth file in the parallel run). CI's first run
  (2026-10-15) failed on both runners on five rows of `git/gh.git`, and taught one more fact: under `CI=true` — set on
  every Actions job — gh treats itself as automation and **installs an official extension it is asked about** instead of
  printing the hint (`gh stack --version` downloaded gh-stack v0.2.1 into the hermetic data directory and exited 0;
  measured here with `CI=true` alone — `GITHUB_ACTIONS=true` alone still prints the hint), and under `GITHUB_ACTIONS=true`
  it words exit 4 as a workflow hint (`gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment
  variable. Example: …`; `…in automation…` under `CI` alone). The file deletes both now (a ninth commit) and pins a
  developer's gh. CI's second run (2026-10-15), with the fix: green on both runners — the job 1 min 17 s on
  Ubuntu, 2 min 3 s on macOS (`npm test` included; gh 2.102.0 on both images).
  Decided (Ric, 2026-10-16): the probe removes `CI` and `GITHUB_ACTIONS` from the environment it hands gh —
  `CommandRequest.env` admits `undefined` as "remove", which Node honours by leaving the entry out (measured;
  `git/command` pins it) — so a read-only step stays read-only wherever VS Code was started (the eleventh commit;
  the question had been: a `CI=true` inherited from an Actions job would make `gh stack --version` install the
  extension). Twelve commits — the seventh the review's fixes, the ninth the CI fix, the tenth the second run's
  numbers, the eleventh Ric's answer (red on two test literals it missed), the twelfth those literals: a four-lens panel with sceptics over a scratch copy found 37 things, 24 of
  them taken (several one defect seen by two lenses: `GhFound` had been placed between the union's doc and the union,
  orphaning it; poll.ts's header named a dependant that does not import it; the `unit/login` count was two short since
  20b; reading-order item 26 and primer §59 still said ten members; the §7.5 as-built text described 23b's poll and
  README sentence; the `readyMessage` no-gh row and the interim E23 row pinned shapes the probe never emits or could not
  tell apart; `auth status` never started had a header line and no row; and the two hermeticity holes above, found by
  sceptics a rate limit cut off and measured by hand) and 13 refuted (among them: "item 23" as the plan's umbrella name,
  `<host>` as a placeholder, the GHES root the ssh.github.com one replaced — no code path differs).
- **M5 item 22b, 2026-10-14**, branch `m5/22b-gitspice-suite` stacked on 22a (D64): `.github/workflows/ci.yml` (the install
  step, two job variables), `.github/workflows/release.yml` (header only: the three files skip there, on purpose),
  `vitest.config.mts` (`testTimeout`), `test/helpers/fixture.ts` (`commitOnTrunk`, `addHook`), `test/helpers/gitspice.ts`
  (new), `test/git/gitspice.git.test.ts` (16), `test/git/gitspiceFacts.git.test.ts` (17), `test/git/gitspiceOps.git.test.ts`
  (10), `test/git/readiness.git.test.ts` (header), `scripts/doctor.sh`, the check-toolchain skill, README Tests; `test:ext`
  unchanged. Primer §76 extended, §78–§79 new; §19, §28, §39, §43 edited. Reading order 49–52 new, 49–81 → 53–85 (headings
  and every cross-reference checked); items 13, 35, 77, 81, 82 reworded; §10.1 item 21's reading-order reference bumped —
  the dated bullets below keep their day's numbers. Measured 2026-10-14 with git-spice 0.31.2 and 0.32.0 (identical;
  hermetic HOME + XDG, bare origin; `design22/` in the session scratchpad): `gs log --json` lines sorted by name, trunk among
  them; no identity variables needed (the fixture's repo config serves git-spice's data commits); HOME and XDG empty after
  the whole suite; during git-spice's own pause `computeStack` sees `layers: []` (HEAD detached at trunk's tip) so `push`
  would answer the no-layers result — the E12 refusal protects; an unpushed trunk commit is a fourth layer against
  `origin/main`; a tracked branch has no `push` field before its first submit, `{0, 0, false}` after; the `<name>-2` push:
  three pushed, exactly two `INF` notes, `branch.<b>.merge` → `<b>-2`; the prune's write set is `refs/spice/data` + loose
  `objects/` only; `repo init` adds exactly the `refs/spice/data` line to the digest; `gs log` on an uninitialised
  repository writes zero files; E49/E14/`branch onto` graphs as §9.6 asks (patch-ids stable); on a *plain* git pause
  `gs rebase abort` exits 0 and ends it with no data commit, and `gs rebase continue` (`GIT_EDITOR=true`) finishes it
  without restacking the upstack and without a data commit — the next `gs log` then writes one (`<b>: branch was
  restacked externally`), which the design had not foreseen and the test now pins; a never-paused data tree has no
  `rebase-continue`; after `rebase abort` or a finished `continue` the file reads `{"continuations": null}`. `GIT_EDITOR`:
  with none set and `TERM` set, git opens `vi` from `branch create` with nothing staged and from `rebase continue` (the
  command hangs; `.viminfo` lands in HOME); with `TERM` unset it fails fast (`Terminal is dumb, but EDITOR unset`) — the
  `FTL` line is the same either way, and the files pin `GIT_EDITOR=true`. The kill row through the production runner, both
  versions: back at ≈ 1.5 s with `timedOut`, no branch on the origin at return or 3 s later, the hook's log one `start`
  line, no `branch.<b>.merge`, the next push clean. Timings (M1, under Vitest): readiness 44 ms, init 0.25 s, enrich
  0.42 s, track 0.45 s, `gs log` 0.38 s, push ×3 1.6 s, conflict restack 0.6 s, `rebase continue` 1.6 s, `upstack restack`
  1.2 s, `buildStack()` 1 s; `test:git` 11 → 24 s wall locally (171 + 1 skipped). Skip/require: `PRCASCADE_TEST_GS=/no/such`
  → all skipped, exit 0; with `PRCASCADE_REQUIRE_GS=1` one named failure (`git-spice not found (tried /no/such)`), exit 1.
  CI (first run, 2026-10-15, git-spice 0.32.0 from the tarball): the install step 2 s on both runners; `npm test` 23 s on
  ubuntu-latest and 51 s on macos-latest, of which the `git` project 16.4 s and 40.8 s (24 s on this Mac) — all three files
  ran and passed on both. Nine commits, each green; a
  four-lens review with sceptics (22 confirmed, 9 refuted) before the last two: `initAndTrack` now proves every layer
  tracked, git-spice's own pause ended by `gs rebase abort` is a tenth ops test, three assertions pinned exactly, and the
  rest words — `it.runIf` registers a skipped test rather than none, the SIGKILL-era `pipefail` reason, "never skipped"
  → one named failure, §79's millisecond maths, the first `as` in the codebase given its §50 paragraph.
- **M5 item 22a, 2026-10-14**, branch `m5/22a-group-kill` stacked on 21b (D63): `src/core/command.ts` (`spawn`, `watch`,
  `stopGroup`, `resultFor`, `killGroup`, `neverRan`, `KILL_GRACE_MS`, the constructor seam), `src/core/backends/gitspice.ts`
  (comments: `PUSH_TIMEOUT_MS`, header, `forget`); `git/command.git` +10 (10 → 20); `test/git/git.git.test.ts` (one pointer
  line); `test:ext` run once, unchanged (128 + 2). Primer §75 new (with `NodeJS.ErrnoException` / `NodeJS.Signals`), §76 new
  (`describe.skipIf` / `it.skipIf`) and §77 new (a test's own time limit); §15, §32, §58, §65, §70 edited. Reading order
  items 29, 32 reworded. README "Pushing", CHANGELOG. A four-lens review with sceptics (17 confirmed, 7 refuted) found
  the SIGKILL timer cleared with the result — a SIGTERM-trapping group member holding no pipe survived — which became
  test 18 and an `unref()`'d timer. Measured 2026-10-14 (Node 26.10, macOS; `design22/lab-core/probe.mjs`, `kill-lab.mjs`): `execFile({ detached:
  true })` leaves the child in the parent's group (pgid equal) — Node copies a fixed option list into `spawn`;
  `spawn({ detached: true })` → pgid = pid; `process.kill(-pid, SIGTERM)` ends a Node child and its Node grandchild where
  `execFile`'s timeout (`killed: true`) left the grandchild alive; a child ignoring SIGTERM survives while its grandchild
  dies, SIGKILL to the group ends it; a kill of a gone group throws ESRCH; ENOENT/EACCES fire `error` then `close` −2/−13
  with `pid` undefined; a descendant that left the group (`setsid`) but kept the pipes held `close` until it exited (5.2 s
  for a 0.5 s limit) — destroying both pipes after the SIGKILL settles the result at the limit plus the grace, the stderr
  written before the cut-off kept. Through the new runner with git-spice 0.31.2 and 0.32.0 (hermetic HOME, bare origin,
  `pre-push` sleeping 3 s, 1.5 s limit): back at 1507 ms, `timedOut`, no branch on the origin at return or 4 s later, hook
  log `hook start` only, no `branch.<n>.merge`, next push clean under the original names. Bundle 112.2 → 114.2 KB.
- **M5 item 21b, 2026-10-09**, branch `m5/21b-push-stack` stacked on 21a (D62): `package.json` (the command with
  `enablement`, `enablement` on Track Stack, `view/title` `2_stack@1`), `src/vscode/contextKeys.ts` (new: the two key
  names), `src/extension.ts` (the second context key, `NO_REPOSITORY_LOADED`, `pushing`,
  `pushStack`/`stackedRepositories`/`pushIn`/`reportPush`; the "item 21 will gate" sentences corrected to M7's
  `createPRs`), `src/vscode/login.ts` and `src/vscode/tree.ts` (comments); `ext/commands` +17 (one `SlowRunner`; one
  nested `describe` with a second repository, `ext/gitApi`'s shape); `test:ext` 113 → 130, run twice before and twice
  after the review (128 + 2, all green). A four-lens review with sceptics (correctness, tests as mutant-killers, docs,
  the learner's read) confirmed 21 findings and refuted 4, all comments and docs. Primer §74 and §13 edited;
  reading order item 50 new, 50–80 → 51–81, items 1, 2, 58, 68 and "Where the layers live" reworded; README "Pushing",
  "Refresh", "What you see", "Requirements", "What's next"; CHANGELOG `[Unreleased]`. Bundle 108.3 → 112.2 KB. **Not
  checked by hand at F5 in this session** (no window was driven): what VS Code's manifest reference promises —
  `enablement` greys the `…` entries and keybindings and does not stop `executeCommand` — is what the code and tests
  assume; what the Command Palette does with a disabled command (VS Code's palette filters its entries by `enabled`,
  so both commands should be absent from it while a rebase is paused) is for Ric's F5 on VS Code 1.141 — record here:
  <hidden / greyed / listed and refused>. Not done: `ensureReady` for push (D62 says why — the login is not needed;
  the first gated action is M7's `createPRs`), `withProgress` (M7), the decline memory (D58), the `<name>-2` guard
  (item 22 — deferred to M7 item 26 in 22b, D64).
- **M5 item 21a, 2026-10-09**, branch `m5/21a-push` stacked on 20b (D61): `src/core/backend.ts` (`PushResult`, `push`),
  `src/core/backends/gitspice.ts` (`push`, `refused`, `GS_SUBMIT_ARGS`, `PUSH_TIMEOUT_MS`, `GIT_TERMINAL_PROMPT` in `GS_ENV`,
  `gs()`'s timeout parameter, `pushedBranches`, `otherLines`, `listNames`, `nonEmptyLines`, `isFtl`, `relayedGitLine`,
  `describeResult`'s appended line), `src/core/command.ts` (header, the timeout's doc); `unit/push` (23), `unit/enrich` and
  `unit/track` +1 row each, `unit/readiness` one literal; `test:ext` unchanged. Primer §20 and §23 edited; reading order
  48 new, 48–79 → 49–80, items 26, 29, 33 and "Where the layers live" reworded. Measured with git-spice 0.31.2 (hermetic HOME, a local bare origin; the
  design's three experimenters, then two attackers and a repairer; re-verified by hand): `stack submit --no-publish` from
  the top pushes a, b, c — `INF Pushed <n>` per branch on stderr, LF, one space, exit 0, 1.47 s; ≈0.5 s per branch (12
  branches in 6 s) — and sets `branch.<n>.remote/merge`, `refs/remotes/origin/<n>`, moves `refs/spice/data`, writes
  `.git/config` on every run and `objects/` on the first (both seen by the Git extension's watcher); the same lines when
  nothing is new; **the same three from the middle layer, and from trunk every tracked branch of every stack** (no
  `--branch` exists); HEAD detached → `FTL … in detached HEAD state`, nothing pushed; an untracked HEAD → `FTL … lookup
  branch: does not exist in store`; an untracked branch above a tracked HEAD is left out silently, **and so is an untracked
  layer between two tracked ones**; a layer with `down.needsRestack` → git-spice pushes the layers below it, then `ERR
  Branch b needs to be restacked.` … `FTL … refusing to submit outdated branch`, exit 1 — a partial push; `--dry-run`
  refuses the same way; **a commit on local trunk (a `git pull` on main) marks the bottom layer `needsRestack` and the
  whole stack is refused with nothing pushed**; `spice.submit.skipRestackCheck = always` makes git-spice push and warn
  instead (the setting changes `submit`, not `gs log`); an uninitialised repository → the auto-init death of `gs log` and
  `branch track`; no remote → `FTL … git ls-remote: wait: exit status 128` / `FTL stderr:` / `FTL fatal: 'origin' does not
  appear to be a git repository` …, the block twice; **a github.com remote while logged out fails identically —
  `--no-publish` consults neither forge nor keychain**; the remote's a moved by another clone, **unfetched** → `FTL … push
  branch: push: exit status 1` / `FTL stderr:` / `FTL To <url>` / `FTL  ! [rejected] <sha> -> a (stale info)` — the lease
  holds; **after `git fetch`, `gs log` says `push {ahead:0, behind:1, needsPush:true}` and the same submit overwrites the
  remote's a with ours, exit 0 — the lease protects an unfetched clone only (E76); a diverged a is overwritten the same
  way; a branch deleted on the remote is `(stale info)` unfetched and re-created after `fetch --prune`** — hence the
  `push.behind` refusal; **a remote `<name>` with no upstream recorded here is pushed as `<name>-2`** (`INF a: Branch name
  already in use in remote 'origin'` / `INF a: Using upstream name 'a-2' instead` / `INF Pushed a`, exit 0;
  `branch.a.merge = refs/heads/a-2`; for an unrelated a, for our own sha, and after a plain `git push origin a` without
  `-u` from this clone; with the upstream set git-spice uses it); **`execFile`'s timeout kills git-spice alone**: with a
  pre-push hook sleeping 3 s and a 1.5 s timeout the callback fires with `killed=true` while `git push`, the hook and the
  sleep run on; 5 s later the remote has a, here no `branch.a.*`; the retry pushes to `a-2`; `git fetch` + `git branch
  --set-upstream-to=origin/a a` repairs it; **`spice.submit.updateOnly = true` makes `--no-publish` skip every branch
  without a CR, exit 0 — `--no-update-only` on the command line overrides it**; `GIT_TERMINAL_PROMPT=0` leaves a working
  push unchanged and makes an https remote with no credential helper fail at once with `fatal: could not read Username
  for '<host>': terminal prompts disabled`; **two submits at once in one repository race on the remote's refs and on
  `.git/config`**: one run left an upstream unset with `WRN Could not set upstream … could not lock config file`, others
  rejected one push `remote: error: cannot lock ref 'refs/heads/a': reference already exists`; `stack submit --help`:
  `--no-publish` "has no effect if a branch already has an open CR"; `--force` and `--no-verify` exist and are never
  passed. execa 10.1.0 re-measured: 120.8 KB minified for `{ reject: false }`, declined. SonarCloud: the appended-line
  rule written into one loop measures S3776 complexity 21 (eslint-plugin-sonarjs); split in four, 7 and 4 — written that
  way from the start.
- **M5 item 20b, 2026-10-08**, branch `m5/20b-track-stack` stacked on 20a (D60): `src/vscode/tree.ts` (the local tier's
  rows and tooltip lines), `src/extension.ts` (`loadRepoState`, `enrich` on every load with its Output lines, `lastStates`,
  the context key `prCascade.hasUntracked`, `prCascade.trackStack` in three parts), `src/vscode/login.ts`
  (`chooseRepository`'s placeholder), `package.json` (the command, `view/title` `2_stack@8`); `ext/tree` +6, `ext/commands`
  (new, 10), `ext/login` cans `gs log`, `unit/login` +1; `test:ext` 97 → 113 (111 + 2), run twice. Primer §74 new, §68 edited; reading
  order item 66 new, 66–78 → 67–79, items 1, 2, 51, 56, 61 reworded; README "What you see", "Refresh", "git-spice setup";
  CHANGELOG `[Unreleased]`. Measured with git-spice 0.31.2: `gs branch track` runs during a paused rebase (exit 0, the
  tracking survives `rebase --abort`) — the command refuses first. Not done: `ensureReady` for a local operation and the
  rebase `enablement` (D60 says why; the latter with item 21); the decline memory (D58).
- **M5 item 20a, 2026-10-08**, branch `m5/20a-enrich` stacked on 19b (D59): `src/core/digest.ts` (new), `src/core/model.ts`
  (`tracking?`, `Enrichment`, `EnrichmentCause`, `enrichment?`), `src/core/backend.ts` (`enrich`, `track`, `TrackResult`),
  `src/core/backends/gitspice.ts` (`enrich`, `track`, `logByRoot`, `GS_LOG_ARGS`, `SPICE_DATA_REF`; `locateGitSpice`'s
  return type narrowed to the two members it produces), `src/core/gsLog.ts` (header and two doc comments only);
  `unit/digest` (6), `git/digest.git` (5), `unit/enrich` (27), `unit/track` (13); `test:ext` unchanged at 97. Primer §9,
  §11, §20, §46, §51, §54, §59, §70 edited; reading order items 43–47 new, 43–73 → 48–78, items 3, 26, 27, 33 reworded.
  Measured with git-spice 0.31.2 (hermetic HOME, 2026-10-08): `gs log short --all --json` prints the same lines from an
  untracked, a tracked and a detached HEAD except `current` (so HEAD left the digest); without `--all` a tracked HEAD
  prints only its own stack; 0.63–0.64 s on this repository with or without `--all`, 0.34 s in a 3-branch one,
  `for-each-ref` 0.01 s, `--version` 0.02 s; `gs branch track` **and `gs log short --all --json`** on an uninitialised
  repository (one remote — `origin/HEAD` set or not — and none; `--no-prompt` or a closed stdin) → `INF Repository not
  initialized. Initializing.` / `INF Using remote: origin` then `FTL … auto-initialize: guess trunk: prompt for trunk
  branch: not allowed to prompt for input`, exit 1, nothing written — §13.4 (a)'s exit 0 of 2026-10-01 did not reproduce
  (§7.6 corrected again); a `refs/spice/data` pointing at a plain commit gets the same three lines and leaves the ref
  alone; `gs log` prunes a tracked branch deleted out of band (`INF tracked branch c was deleted out of band:
  removing...`) and moves `refs/spice/data` doing so — the one write it makes; a `track` failure's stderr is the `FTL`
  line alone; `track` works from another branch and during a paused rebase (exit 0; the tracking survives `rebase
  --abort`); re-running `track` with the same base is exit 0 and harmless, with another base silently moves it; `--base
  origin/main` → `branch origin/main is not tracked`; `branch track main --base main` → `cannot track trunk branch`; a
  local `main` one commit ahead of `origin/main` is listed by `for-each-ref refs/heads --merged HEAD --no-merged
  origin/main` (a layer) and printed by `gs log` as the trunk line (`ups`, no `down`); `push` appears only for a branch
  git-spice itself pushed; `track` writes only `refs/spice/data` (+ objects); `for-each-ref … refs/spice` lists
  `refs/spice/data <sha>` once initialised, and the fixture's `refs/remotes/origin/HEAD` symref line.
- **M5 item 19b, 2026-10-08**, branch `m5/19b-login` stacked on 19a (D58): `src/vscode/terminal.ts`,
  `src/vscode/login.ts`, the wiring in `src/extension.ts` (the real host, one backend per window, the probe, the
  command `prCascade.setUpGitSpice`, `readinessDeps` on the Test-mode handle), `prCascade.gsPath` in package.json and
  `config.ts`; `test/helpers/fakeReadinessHost.ts`, `unit/terminal` (12), `unit/login` (59), `ext/login` (7). Primer §72
  and §73 new, twelve sections edited; reading order items 50–54 and 60 new, 50–54 → 55–59, 55–67 → 61–73; README
  "git-spice setup", CHANGELOG `[Unreleased]`. Bundle 47.3 → 85.0 KB unminified (the M5 core modules enter it).
  Reviewed before commit by three independent reviewers, whose findings became seven rules of the flow (D58). The
  extension-host suite passed on VS Code 1.141.0 (`npm run test:ext` downloaded it). Measured or read: VS Code's
  `Terminal.creationOptions.cwd` is the string passed to `createTerminal`, so reuse by directory works with the real
  API (the ext test's last case); `onDidCloseTerminal` fires with the same object; extension subscriptions are disposed
  in order, the Output channel before the flows, and the flows' `disposed` guard keeps a late log line off the closed
  channel; VS Code asks before opening `abhinav.github.io`. Not done here: the per-workspace decline memory (item 20,
  when a gated action can nag); gh's flow (item 23).
- **M5 item 19a, 2026-10-06/08**, branch `m5/19a-offers` stacked on 18 (D57): item 19 split into 19a (core) and 19b
  (VS Code), as 13a/13b were, after a design panel (three designers, a synthesis, three attackers, a repair) produced a
  one-PR design of ≈ 385 code lines across both layers. 19a: `src/core/shell.ts`, `src/core/poll.ts`,
  `src/core/readinessFix.ts`; `Ready`/`NotReady` in `backend.ts`; `GitSpiceBackend.forget`. Tests: `unit/shell` (37),
  `unit/poll` (20), `unit/readinessFix` (55), `git/trunkBranch.git` (9), `unit/readiness` +2. Primer §71 new, §15,
  §23, §27, §41, §43, §44, §46, §49, §59, §65 edited; reading order items 36–42 new, 36–60 → 43–67; bundle delta 0.
  Facts measured on this Mac (git-spice 0.31.2, git 2.50, zsh): `repo init --trunk` wants an existing local branch; an
  environment token is a login to git-spice and blocks `auth login` for GitHub and GitLab alike, `--refresh` included;
  `rev-parse --symbolic-full-name` for `origin/HEAD`, a tag, a commit, an ambiguous name and `--all` (pinned in
  `git/trunkBranch.git`); zsh expands a leading `=word`; every quoted test word read back unchanged by sh, bash and
  zsh; VS Code (1.140) resolves the login shell's environment at startup, so the planned "Set prCascade.gsPath"
  button was cut. The first commit was written on Claude Opus 5.5 by mistake (2026-10-06); on 2026-10-08 Claude Fable
  5.1 reviewed it with three independent reviewers and a second commit — the forge's `apiUrl` beside the url in E70's
  fix (GHE.com's API is `api.<host>`, which git-spice does not derive), `brew` by its full path, a Homebrew install
  told apart by the `git-spice` beside `brew` (the upstream rename made the name prove nothing), `command` before the
  init line, a refused non-positive interval, sixteen mutation gaps closed, and the docs corrected — and a follow-up
  commit on #32 putting `git-spice` before `gs`. For 19b: the flow (probe → offer → fix → poll → refresh → next offer,
  or the action), one fix in flight per root, the terminal, `prCascade.gsPath` in package.json, `brewPath` and
  `brewGitSpice` read from disk, and a palette command to try it before a gated action arrives (M7's `createPRs`, as it turned out — D60, D61). Risks
  carried: a user who closes the terminal early (one last look, then give up), and `gs auth logout` going unnoticed by
  a gated action until an operation fails (`forget`, then ask again — the rule for the first gated action, M7's `createPRs`).
- **M5 item 18, 2026-10-06**, branch `m5/18-readiness` stacked on 17 (D56): `src/core/command.ts` (`CommandRunner`,
  `RealCommandRunner`), `src/core/backends/gitspice.ts` (`GitSpiceBackend.readiness`, the version helpers),
  `test/helpers/fakeCommand.ts`, `test/unit/command.test.ts` (13), `test/unit/readiness.test.ts` (70),
  `test/git/command.git.test.ts` (10), `test/git/readiness.git.test.ts` (3); `git.ts` exports its three spawn
  helpers (and says so in their comments). Facts measured 2026-10-05/06 on this Mac (git-spice 0.31.2, Ghostscript 10.08.0, Node 26): Ghostscript's
  `gs --no-prompt` alone prints `Unknown switch '--no-prompt'.` and exits 1, but the probe's own command,
  `gs --no-prompt --version`, prints a bare `10.08.0` and exits 0 — so neither the exit code nor "it printed a
  version" identifies git-spice, only the `git-spice <token>` banner does; `git-spice --no-prompt --version` → `git-spice 0.31.2\nCopyright …`, exit 0; the `version`
  subcommand exists only since 0.12.0 and `_version` defaults to `dev` in a `go install` build; `git-spice
  --no-prompt auth status --forge <kind>` works outside a repository too (exit 1 `not logged in`), and
  `auth_status.go` is a keychain read — no network; `--forge azuredevops` → `unknown forge`; an unknown
  subcommand exits 1; `git rev-parse
  --verify --quiet refs/spice/data` exits 1 silent before and 0 + sha after `git update-ref refs/spice/data HEAD`;
  `gs repo init --trunk main` succeeds with no remote (so `spice.remote` is not an init fact); execFile has no
  `stdio` option, so stdin is closed through the returned handle; a timeout kill arrives as `killed: true`,
  `code: null`, `signal: SIGTERM`; probe spawns cost 16–56 ms. `semver` 7.8.5: `gte` + `coerce` 27.3 KB minified on a 48 KB
  bundle — any named import pulls in the whole index — declined, D56. Primer §70 (`?.`) new, §13/§15/§16/§20/§27/§30/
  §43/§44/§46/§59 edited; reading order items 29–35 new, 29–53 → 36–60, items 4, 5 and 26 reworded; bundle delta 0. Risks noted for item 19:
  VS Code's own PATH may lack `/opt/homebrew/bin`, so `gs-missing` while a terminal has `git-spice` — the message
  should say "in VS Code's PATH" and point at `prCascade.gsPath`; a `found` that is not a version (`dev`) should
  read "could not be checked", not "below"; `gs auth logout` goes unnoticed until an operation fails (only
  `ready` is memoized, for the backend's life). SonarCloud on #32 (rule S3776, cognitive complexity 16 > 15) asked
  for `probe` to be split: step 1 is now `locateGitSpice`, returning a `LocatedGitSpice` or a `Readiness` member
  (`kind: 'located'` beside Readiness's kinds) — a follow-up commit, as the §13.4 rule for submitted PRs says.
  A second follow-up (2026-10-08), from the review of item 19a: `GS_CANDIDATES` is now `['git-spice', 'gs']`.
  git-spice renamed its own binary to `git-spice` in v0.24.0 (2026-02-22) and dropped `gs` from its official
  packages — GitHub Releases, Homebrew, the AUR — in v0.25.0 (CHANGELOG at v0.31.2); Homebrew's 0.31.2 installs only
  `git-spice` here. So every official install that passes the 0.31.0 floor is `git-spice`, only `go install` still
  makes `gs`, and asking `gs` first cost a Ghostscript spawn on every probe of a Homebrew Mac — up to a hundred per
  login wait in item 19b. The tests' happy path now answers as `git-spice`; `gs` is the second name (a `go install`
  build), and Ghostscript is met only when `git-spice` is absent. §7.3, §7.13.1, §13.1 and D56 corrected.
- **M5 item 17, 2026-10-01**, branch `m5/17-backend-gslog` stacked on 16 (D55): `src/core/backend.ts` (types only —
  `StackBackend` with `kind` and `readiness`, the ten-member `Readiness` union), `src/core/gsLog.ts` (`parseGsLog` and
  four `…FromJson` helpers), `test/unit/gsLog.test.ts` (30 tests, three of them on lines copied from this repository's
  own `git-spice log short --json`); zod 4.6.5 measured with `npm run depcheck` and a scratch esbuild entry (classic 454 KB
  minified, `zod/mini` 16 KB) and hand-rolled; §4.2, §4.4, §7.13.1, §7.13.2, E57, §9.4, §10.1, §11.1, §11.3, §12 and §13.1
  amended; the adversarial review found the primer's §51 and §59 edits had not reached disk (a write-order slip in the
  edit script) and that `Readiness.forge-unrecognized` needs the `ForgeConfig` detectForge read — both fixed, the latter
  with a follow-up commit on PR 16;
  primer §9/§11/§18/§29/§51/§59 edited, no new section; reading order items 26–28 new, 26–50 → 29–53; bundle delta 0.
- **M5 item 16, 2026-10-01**, branch `m5/16-core-forge` stacked on `m4/15-v0.1.0` (D54): `src/core/forge.ts`
  (`parseRemoteUrl`, `parseForgeConfig`, `classifyHost` with `gitSpiceMatches` and `guessKind`, `detectForge`, `ghEnv`),
  `test/unit/forge.test.ts` (133 tests — the URL table, the null table, the config lines, every E65 host, git-spice's
  rules one by one, `detectForge` against the fake), `test/git/remote.git.test.ts` (13, real git: no remote, the bare
  origin as a local path, `insteadOf` and `pushInsteadOf`, the `spice.forge.*` keys through a real `--get-regexp`);
  `hosted-git-info` 10.1.1 measured with `npm run depcheck` and a scratch probe and declined on function; primer §69
  new, §9/§14/§20/§23/§49/§59 edited; reading order items 23–25 new, 23–47 → 26–50; bundle delta 0. The adversarial
  review measured git-spice 0.31.2's matching against the first draft and found four disagreements, all fixed and
  pinned: a `spice.forge.<kind>.url` *replaces* that kind's default host (github.com beside a GHES url is "no forge
  found"); a subdomain of the base host matches (`ssh.github.com`); the compare is case- and port-sensitive text
  (`remoteURLMatches` in git-spice's `internal/forge/remote_url.go`); a rejected `spice.forge.kind` disables every
  forge rather than falling through. Separately, git-spice's forge order is unspecified (a Go map), so the id order
  is the extension's tie-break, not a mirror. A second round added three more rules, also measured: a url value that
  is not a URL still displaces its kind's default and matches nothing; a `spice.forge.kind` whose own url key the
  remote does not match is refused (`unsupported URL: … does not match configured forge URL`); a value with a
  trailing space (`gitlab `) is rejected, so only a CRLF's `\r` is stripped from the config lines. Earlier bullets
  below keep the reading-order item numbers of their day (23–47 are now 26–50). First M5 PR, so it also carries the §0 waiver, the dropped pause and the
  git-spice facts below.
- **M5 started 2026-10-01 on the unmerged M4 stack, at Ric's explicit request** ("do the next 2 PRs and throw them
  on the stack") — §0's "don't start the next milestone's stack until the current one is merged" waived this once;
  items 16 and 17 sit on `m4/15-v0.1.0`, so an amend to any of #23–#27 or #29 means `git-spice upstack restack` for them and a fresh
  `gh stack link` of the pair onto stack #28. **The "use it for a week" pause is dropped** (Ric, 2026-10-01: he will not
  use the extension until it is done) — §10's M4 line and §10.1 item 15 amended; M5 follows M4 directly.
- **git-spice 0.31.2 facts measured while designing items 16–17 (2026-10-01), for item 18:** (a) `gs log short --json`
  in an uninitialised repository **initialises it itself** — stderr `INF Repository not initialized. Initializing.`,
  trunk guessed, exit 0 *(2026-10-08, item 20a: not reproduced — the same command, with and without `--no-prompt`, now
  dies at the trunk prompt after those `INF` lines, exit 1, nothing written; §7.6's second correction. The rule it
  motivated stands.)* — so §7.6 and §7.13.1 step 2 are corrected: the probe's initialised check must have no side
  effect, e.g. the *existence* of `refs/spice/data` (`git rev-parse --verify --quiet refs/spice/data`; its contents stay
  unread, §3; the §7.14.2 digest already lists that ref's object name). Measured the same day: with `--no-prompt`
  (or any non-tty stdin) and two or more remotes it exits 1 — `auto-initialize: guess upstream remote: prompt for
  remote: not allowed to prompt for input` — and creates no `refs/spice/data`; neither `branch.<trunk>.remote` nor
  `spice.remote` lets it guess. (b) `gs auth status` exits 1 for three different reasons — `FTL git-spice: no remote set for
  repository`, `ERR No Forge specified, and could not guess one from the repository … please use the --forge flag`, and
  `FTL git-spice: <forge>: not logged in` — so the forge is settled with git first (`detectForge`) and auth is asked as
  `gs auth status --forge <kind>` (ids: `bitbucket, forgejo, gitea, github, gitlab`), which answers for any repository;
  §7.13.1's steps 3 and 4 swapped accordingly. (c) **`gs -C <dir>` reads `spice.forge.*` from the directory gs was
  started in, not the target**: a repository-local `spice.forge.github.url` is ignored under `-C` and honoured with
  `cwd` = the repository — spawn gs with `cwd`, never `-C` (§7.13 corrected). (d) Default hosts gs recognises:
  github.com, gitlab.com, bitbucket.org, codeberg.org (→ forgejo); not `*.ghe.com`, not gitea.com, not dev.azure.com
  even with `spice.forge.azuredevops.url` set — 0.31.2 has no Azure forge, and its `--forge` ids are the five above.
  `spice.forge.kind` wins over the host (`kind gitlab` with a github.com remote → "gitlab: not logged in"); a
  `spice.forge.github.url https://ghes.corp.com` makes an unknown host github (E70's offer works). (e) `gs version
  --short` prints `0.31.2`, exit 0; the trunk appears in `gs log --json` as a line with `ups` and no `down`; INF/WRN
  lines go to stderr, never stdout. (f) git lower-cases the first and last components of a config key and keeps
  everything between them — the subsection, `forge.github` in `spice.forge.github.url` — as typed, so
  `spice.forge.GitHub.url` or `spice.Forge.github.url` is a different key that neither `^spice\.forge\.` nor
  git-spice matches; (g) git-spice's matching rules — see the item 16 bullet above: one base host per forge (url
  key, else default), equal-or-subdomain, as spelled, port when configured; a rejected `spice.forge.kind` stops
  every forge; registry order unspecified; a url value that is not a URL (`ghes.corp.com`, `https://`) displaces the
  default and matches nothing ("not allowed to prompt for input: please use the --forge flag" under `--no-prompt`);
  `spice.forge.kind` plus that kind's url key makes git-spice validate the remote against the url (`construct forge
  "github": unsupported URL: remote URL … does not match configured forge URL`), a subdomain passing; `gitlab ` with
  a trailing space is `unknown forge: "gitlab "`; `git remote get-url` exits 2 for a missing remote
  and applies `url.<base>.insteadOf` (verified; `pushInsteadOf` is not applied — the fetch URL decides).
- **M4 item 15, 2026-10-01**, branch `m4/15-v0.1.0` stacked on 14 (D53): package.json and package-lock.json at
  0.1.0; CHANGELOG.md (Keep a Changelog); README rewritten for users — Install from the Releases page, What you
  see, Refresh (E83's list and §7.14.2's `git.autorefresh` / `git.statusLimit` note), the `git.*` settings with
  `git.detectSubmodules` and closed-stays-closed added, What's next, Development last; `.github/workflows/release.yml`;
  `npm run package` in ci.yml; `test/unit/release.test.ts`; primer §28 gains `readFileSync`; reading order items 44
  and 45 new, later items renumbered; §9.5's step list brought up to date (node 24, `--ignore-scripts`, `package`);
  §11's skeleton gains CHANGELOG.md and `.github/workflows/`. The tag and the release are Ric's, after the merge, with
  CHANGELOG.md's `## [0.1.0] - <date>` set to that day in a one-line commit on `main` first if it differs.
- **M4 item 14, 2026-09-30**, branch `m4/14-status-bar` stacked on 13b (D52): `src/vscode/statusbar.ts`
  (`StackStatusBar`, `stackStatusText`), the provider's `onDidLoadStates`, `createTreeView` and the hidden-view
  run in `refresh()`, `prCascade.statusBar`, the `capabilities` rider; `test/ext/statusbar.test.ts` live through
  the Test-mode handle and over a stand-in item; primer §66 (the status bar item), §67 (`createTreeView` /
  `visible`), §68 (`ExtensionMode.Test`), `findIndex` in §25, §35 and §61 edited; reading order items 27 and 32
  new, later items renumbered; E44 reworded (`2 of 2`). SonarCloud on #27 (rule S9383) asked for the two
  deliberately un-awaited loads to be marked: `void`, with its paragraph in primer §63.
- **M4 item 13a, 2026-09-30**, branch `m4/13a-core-rebase` stacked on 12b (D50): `RepoState.rebaseInProgress`
  from one `rev-parse --git-path` call inside `computeStack`; `test/git/rebase.git.test.ts` builds the cases §9.4
  names — the conflict stop, `git am`, a failed `exec`, `break`, a linked worktree (E19) — plus the state after
  `--abort`, and proves for `am`, `exec` and `break` that git wrote no `REBASE_HEAD`, the file `state.rebaseCommit`
  needs. Item 13 split into 13a/13b; 13b (`m4/13b-state-rows`, D51) draws one row above the layers — the rebase row
  (warning) or the detached row (info), never both — then the E5 row or the layers, with two `ext/tree` tests that
  restore the repository in `finally`. Built on Ric's new Apple-silicon MacBook (macOS 27): Homebrew node 26 works
  there, so §13.1's notes on the Intel chip and the broken Homebrew node are history; its other notes still hold
  (`gs` is still Ghostscript, git-spice is `git-spice`; git is still 2.50.1). `git-spice` 0.31.2 and `gh` 2.102.0
  were installed the same day.
- **M4 item 12b, 2026-09-26**, branch `m4/12b-status-refresh` stacked on 12a (D49): `core/debounce.ts` (hand-rolled,
  250 ms), the adapter's per-repository `state.onDidChange` listeners relayed as `onDidRunStatus`, the Refresh
  button through the same debounce, E20 live (`ext/tree`); primer §64 (debounce), §65 (fake timers). Same day, on
  12a after SonarCloud's run on #23: the adapter no longer starts its handshake in the constructor (rule S7059) —
  `connection()` starts it on its first call, the first refresh; none of the existing tests' behaviour changed.
- **M4 started 2026-09-26** as branch `m4/12a-vscode-git-api` (plan §10.1 item 12a; D46–D48). Built with Node
  24.21.0 fetched into the session's scratch directory: no working Node is on this Mac's PATH (the Homebrew
  bottle §13.1 records is still broken and unlinked), and the toolchain doctor says so.
- **DECIDED 2026-09-20, RECORDED 2026-09-26: use the built-in Git extension's API where it does the job
  (§7.14; touched: §1, §2, §3, §4.2, §5, §6, §7.1.0, §7.3, §7.11, §8 E1/E1b/E2/E12/E17/E19/E20/E82/E83, §9.1,
  §9.4, §10 M4, §10.1 items 12a–15, 20, 22, §12).** Ric's rule: prefer VS Code's own APIs over re-implementing them. Taken
  from `vscode.git`: the repository list with its open/close events, the change signal
  (`repository.state.onDidChange`), the git executable (`api.git.path`). Kept as our own spawns: everything the
  API cannot express — stack membership, layer order and diffs, file content, trunk, the current branch,
  rebase-in-progress. Accepted: `core/discovery.ts` and the two `prCascade.repositoryScan*` settings go in M4
  item 12a; the "works with `git.enabled: false`" promise (§2, §3 "Diff rendering", README) is dropped; E1b
  inherits the Git extension's parent-folder prompt. **Verified before recording** against the Git extension's
  source at VS Code `release/1.85` (our `engines` floor) and `release/1.138` (what the tests download and Ric
  runs), every material fact re-read by an independent second pass; the note's own wording was corrected in
  four places, marked ★:
  (a) ★ `Repository.onDidCommit` / `onDidCheckout` are not in 1.85's `git.d.ts` at all and, where they exist,
  fire only for the Git extension's own commit/checkout operations — never for a terminal or `gs`. Not used;
  `state.onDidChange` is the one signal (`api/api1.ts` maps it to the internal `onDidRunGitStatus`).
  (b) `state.onDidChange` fires after **every completed** `git status` run, changed or not, and not for a run a
  newer one cancelled. Watcher-driven runs: the working tree, the **first level** of `.git`
  (`RelativePattern(dotGit.path, '*')`, by design) and HEAD's upstream ref (`refs/remotes/<remote>/<name>`, a
  transient watcher rebuilt after every status while HEAD has an upstream) → 1 s trailing debounce →
  `whenIdleAndFocused` (no Git-extension operation running **and** `window.state.focused`) → status → 5 s
  cool-down. Events are dropped, not queued, while an operation runs, when `git.autorefresh` is off, or when the
  last status exceeded `git.statusLimit`. Ref-only writes are never seen (E83) — except a push of the current
  branch to its upstream, which rewrites the one watched ref file. `files.watcherExclude` is not a factor: its default
  excludes only `.git/objects/**` and `.git/subtree-cache/**` (both versions; the pattern spelling changed),
  and a user's `**/.git/**` exclude is inverted by VS Code into a dedicated watcher for the request, so the
  events still arrive. (The superseded bullet above got the default right and the `**/.git/HEAD` watcher wrong —
  the Git extension watches the whole first level of `.git`.)
  (c) ★ `getRebaseCommit` builds `path.join(root, '.git', 'REBASE_HEAD' | 'rebase-apply' | 'rebase-merge')` —
  not `dotGit.path` — so `state.rebaseCommit` is undefined in a linked worktree (reproduced on git 2.50.1 for
  both rebase backends), and it needs `REBASE_HEAD`, which git 2.50.1 does not write at an interactive `break`,
  after a failed `exec` or during `git am` — false negatives in the main worktree too; it never gives a false
  positive. Merge and cherry-pick state are not exposed at all. Our `--git-path` directory check was present at
  every pause point probed (conflict stops on both backends, `edit`, `break`, `exec`, `am`, `--update-refs`,
  `--onto`, `gs stack restack`) and absent after abort and completion; it stays primary everywhere (E12, E19);
  the note's "rebase in progress from `state.rebaseCommit`" is withdrawn.
  (d) ★ `state.HEAD` reads the `HEAD` file under `rev-parse --git-dir` (worktree-correct, no D17 hazard on the
  primary path), but `getHEADRef` then substitutes a **tag's** name (type `Tag`) when a tag points at a
  detached HEAD, leaves an unborn branch with a name and no commit, and has no name mid-rebase (or a tag's) — so
  `name === undefined` is neither necessary nor sufficient for "detached"; we keep `symbolic-ref --quiet HEAD`
  (D17); the note's "HEAD / detached from `state.HEAD`" for item 13 is withdrawn.
  (e) `state.refs` is deprecated and returns `[]` at both versions; `api.getRepositoryRoot`, `Repository.kind`
  and `state.worktrees` are absent from 1.85's `git.d.ts` and present at 1.138 (added somewhere between; only
  those two versions were read) — hence the vendored `git.d.ts` is the **1.85** file.
  (f) `api.repositories` is re-sorted in place by root length on every lookup (order unstable) and every access
  wraps a fresh `ApiRepository` (identity unstable): sort ourselves, key by `rootUri.fsPath`.
  (g) `git.enabled: false` and "git not found" both leave `exports.enabled === false` and make `getAPI(1)` throw
  `Git model not found`; only the former recovers (`onDidChangeEnablement(true)`, once), and at 1.138 the event
  fires one statement before the API is usable — call `getAPI` a tick later. The true→false flip is not reported.
  (h) ★ With `extensionDependencies: ["vscode.git"]` a user who disables the Git extension gets **no PR Cascade
  at all** — the enablement service computes `DisabledByExtensionDependency` and the extension is never loaded;
  only the Extensions view shows a warning — and the E82 row for (g) is needed regardless. So the API is
  acquired at runtime (`getExtension` → `activate()`), one `undefined` check more. Of the four ★ points this is
  the one design choice rather than a fact the source forced — (a), (c) and (d) record what the note had wrong;
  Ric confirms or overrules it in the docs PR review. (`@vscode/test-cli`
  would also run `code --install-extension vscode.git` for a manifest dependency; harmless on the 1.138 CLI,
  a marketplace miss on the 1.85 one.)
  (i) Discovery: `initialized` is set when the initial scan settles, independent of any repository's first
  `git status`; submodules (default on, ten at most) arrive later as repositories of their own; a repository
  closed from Source Control stays closed (`workspaceState`); a folder inside a repository whose root is not a
  folder is parked and prompted (`git.openRepositoryInParentFolders`, default `prompt`), and the API's
  `openRepository` cannot bypass that at 1.85 (it can at 1.138, behind a resource-trust request).
  (j) Harness: `@vscode/test-electron` 3.1.0 passes `--disable-workspace-trust` and **no** `--disable-extensions`
  (which spares built-ins anyway), so the Git extension is present in `test:ext`; the fixture's `[nested, root]`
  workspace yields exactly one repository and no prompt (`openRepository` is `@sequentialize`d, so no race
  either); `await repository.status()` runs the status without the focus wait and fires the event before it
  resolves — the tests' synchronisation point, since `window.state.focused` under CI/xvfb is unverified.
  Answering the Git extension's parent-folder prompt with *Always* / *Never* writes a **global** setting into
  the reused `.vscode-test/user-data`; the per-root `parentRepository:<root>` entries it keeps in its
  `globalState` (VS Code's per-extension key-value store) are harmless only while the fixture root is a fresh
  `mkdtemp` per run.
  (k) git-spice, measured with 0.31.2 on this Mac: `gs log short --json` and `log long --json` spawn only
  read-only git children (`config`, `rev-parse`, `cat-file`, `for-each-ref`, `ls-tree`, `merge-base`,
  `branch --show-current`) and write **nothing** under `.git` even with a stale index — so an event-driven
  refresh cannot loop — while every tracked branch exists: `gs log` prunes a tracked branch deleted out of band
  and moves `refs/spice/data` doing so (2026-10-08, item 20a), one extra `gs log` on the following refresh, then
  stable; item 22's pin is written on a clean fixture. `--cr-status` measured the same, but only where no forge matched the remote (no remote; a
  local bare origin takes the same path): the forge path that queries GitHub/GitLab did not run offline, so it is
  pinned in the e2e suite instead. It costs **~1.1 s per call**, a fixed floor independent of repository size
  (re-measured 2026-10-08, item 20a: 0.63 s on this 12-branch repository, 0.34 s in a 3-branch one, with or without
  `--all`), so M5's `enrich` needs the §7.14.2 digest pre-filter rather than running on every event — a stage click
  or an autofetch tick would otherwise cost one `gs log` per repository. What each command
  touches at `.git`'s first level (E83's evidence, from before/after snapshots of `.git`): **nothing** —
  `gs branch track` / `untrack` / `downstack track` (`refs/spice/data` + objects), `gs repo init`, `gs log …`,
  `git branch -f`, `git update-ref`, `git tag`, `git push` of a branch other than HEAD's upstream;
  **seen** — `gs branch checkout` / `onto` / `upstack onto` / `restack` with work to do (`HEAD`, `index`,
  `ORIG_HEAD`), `gs commit create` / `amend` (`COMMIT_EDITMSG`, `index`), `gs branch create` / `delete` /
  `rename` / `fold` (`HEAD`, `index`, `config`, `packed-refs`), `gs repo sync` (`FETCH_HEAD`), and `git push`
  of the current branch to its upstream (the watched ref file). Added 2026-10-08 (item 20a): `gs branch track` and
  `gs log` on an uninitialised repository attempt an auto-init and, under `--no-prompt` or a closed stdin, die at
  the trunk prompt writing nothing ((a)'s exit 0 of 2026-10-01 did not reproduce) — so `track` guards on
  `refs/spice/data` as `enrich` does; `--base` must be a tracked branch or the trunk's local name; a second `track`
  on a tracked branch moves its base silently; `branch track` runs during a paused rebase; `push` is printed only
  for a branch git-spice pushed. Added 2026-10-09 (item 21a): `gs stack submit --no-publish` writes `.git/config`
  (`branch.<n>.remote/merge`) on every run and `objects/` on the first — both **seen** by the watcher — plus
  `refs/remotes/origin/<n>` and `refs/spice/data`; from a middle layer it pushes the whole tracked stack, from trunk
  every tracked branch of every stack; HEAD detached → nothing pushed; after a `git fetch` its lease no longer protects
  a branch another clone advanced (overwritten, exit 0) — hence `push`'s `behind > 0` refusal. Remote windows: both extensions are
  `workspace`-kind (each has `main`, no `extensionKind`), so they share the remote host and `getExtension`
  works unchanged; PR Cascade must be installed on the remote.
  **Open:** probe `window.state.focused` from an ext test on CI before any test relies on the focus-gated path;
  re-measure the `gs log` floor on Linux CI before choosing M5's debounce and timeout values; pin "`gs log`
  writes nothing under `.git`" for the `--cr-status` forge path in the opt-in e2e suite, by snapshotting `.git`
  around one call against the scratch repo (the offline pin is done: item 22b, below), so a later git-spice cannot
  reintroduce a writer unnoticed.
  Added 2026-10-14 (item 22b): pinned by `git/gitspice.git.test.ts` tests 10 and 15 — `log short --all --json`, with
  `--cr-status`, and `log long --all --json` change no file under `.git` (size + mtime ns + inode of every file; the ref
  digest byte-identical) on 0.31.2 and 0.32.0, and the prune of a deleted branch writes `refs/spice/data` and loose
  `objects/` only. Also measured and pinned elsewhere in the three files: `gs log` after a plain git rebase that moved a
  tracked branch writes one data commit ("restacked externally" — `git/gitspiceOps.git`); `gs log` on an uninitialised
  repository writes nothing at all (`git/gitspice.git` test 3); git-spice writes nothing under HOME or the XDG
  directories (test 16); its data commits use the repository's `user.*` config. Item 22a: `execFile`'s timeout leaves git's push
  running; the group kill (D63) stops it — the branch never lands.
