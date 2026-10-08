# PR Cascade

A VS Code extension for **stacked pull requests**. Today, in v0.1, it shows the stack of
branches under your current branch beside the Source Control view, with the files each layer
changes and a one-click diff against the layer below. In the versions to come it creates,
restacks and syncs the stack's pull requests on GitHub and GitLab through
[git-spice](https://abhinav.github.io/git-spice/), with GitHub's native stacked-PR view
linked up automatically.

## Install

PR Cascade is not on the Marketplace yet. Download `vscode-pr-cascade-0.1.0.vsix` from the
repository's [Releases](https://github.com/eric-engberg/vscode-pr-cascade/releases) page and
install it from a terminal —

```
code --install-extension vscode-pr-cascade-0.1.0.vsix
```

— or from the Extensions view: the `…` menu › **Install from VSIX…**. VS Code prompts to
reload. To build the file yourself, see Development below.

## Requirements

- VS Code ≥ 1.85, with its built-in Git extension enabled (the default). With it disabled,
  the Stack view shows one row saying so and does nothing else.
- git ≥ 2.38. The Stack view needs nothing else: it reads your repository through git alone.
- git-spice ≥ 0.31 for **PR Cascade: Set Up git-spice**, and for the pull-request features
  the next versions build on it (`brew install git-spice` on macOS; the command offers that).
- In a remote window (SSH, a container, WSL) install the extension on the remote side, as
  with any extension that runs processes there.

## What you see

Open a repository and the **Stack** view appears in the Source Control side bar, listing the
branch you are on and the local branches below it down to trunk — each one reachable from
the commit you are on and not yet in trunk — your stack, top layer first, the way `git log`
reads. Each row is the branch name; the dimmer text beside it is the layer's distance from
trunk (`3 commits`), with `· current` on the branch you are on. A layer *above* the one you
are on is not listed in v0.1: check out the top of the stack to see all of it.

- **Expand a layer** to see the files it changes against the layer below it — only its own,
  never what the lower layers added — as `A  c` (added), `M  …` (modified), `D  f`
  (deleted), and `R  b2` with `b → b2` beside it for a rename. The icon is VS Code's own for
  the file type.
- **Click a file** and VS Code's diff editor opens on it, titled `<file> (<parent> → <layer>)`:
  the file as the layer below has it on the left, as this layer has it on the right. An added
  file has an empty left pane, a deleted one an empty right pane. A binary file has no text
  diff, so it opens as a file while that layer is checked out, and a message says so
  otherwise.
- **A row above the layers** reads **Rebase in progress — resolve it first** while a rebase is
  paused (`git am` too), or **Detached HEAD** when you are not on a branch; the layers follow,
  and while HEAD is detached — as it is at every rebase pause except `git am` — none of them
  is current. **Not on a stack** stands alone when you are on trunk, and **No trunk found —
  set prCascade.trunk** when no trunk could be found.
- **What git-spice knows** about each layer, once the repository is initialised for it (see
  git-spice setup below): `#12` (its pull request — the link is in the tooltip), `needs restack`
  (the layer below moved), `needs push` (local commits not on the remote), `not tracked`
  (git-spice does not know the branch yet). A layer git-spice tracks and has nothing to say
  about shows only its count; hover for `git-spice: tracked on <base>` — the base as git-spice
  names it, which for the bottom layer is your trunk's local branch — and, when the row is too
  narrow to show them, its `needs restack` / `needs push`. Without git-spice, or before
  `repo init`, the rows are as before and the Output panel says why.
- **The status bar** names the branch you are on and its place in the stack, counted from
  the bottom — `retry-metrics · 3 of 3` — or reads `not on a stack`; click it to open the
  Stack view.
- Several repositories in one workspace get one collapsible row each, in workspace-folder
  order; the status bar describes the first of them, with its path in the tooltip.

### Refresh

The view refreshes by itself whenever VS Code's Git extension runs a `git status` — after
git activity outside VS Code, once the window has focus again — and the status bar follows.
Two cases need the **Refresh** button in the view's title bar:

- A ref that moves without the working tree, the index or `HEAD` changing is seen by no
  one: `git branch -f`, `git update-ref`, `git tag`, a push of a branch other than the
  current one's upstream, `gs branch track` typed in a terminal (the view's own **Track Stack
  with git-spice** refreshes by itself). Press Refresh after one of those.
- With `git.autorefresh` off, or in a repository with more changes than `git.statusLimit`
  allows (10 000 by default), the Git extension stops reacting to changes on disk: git run
  outside VS Code is noticed by neither Source Control nor this view — press Refresh after
  it. The Git extension's own operations (stage, commit, fetch) still run a status and
  refresh both.

## git-spice setup

**PR Cascade: Set Up git-spice** in the Command Palette checks, in order, that git-spice is
installed and new enough, that the repository is initialised for it, that its remote is a
GitHub or GitLab repository git-spice recognises, and that you are logged in — and offers the
fix for the first thing missing. With several repositories open it asks which one. A fix that
needs you runs in a terminal named `PR Cascade: <folder>` at the repository root, so you can
answer git-spice's questions there; PR Cascade checks again every 3 seconds, for up to 5
minutes, and once the step has taken it refreshes the view, says so, and offers the next one.
Close the terminal to give up early. Before it runs a fix it looks once more, so a notification
answered long after it appeared does nothing when the step was done meanwhile. The offers:

- **Install** — with Homebrew in a terminal when `brew` is in one of its usual places
  (`/opt/homebrew`, `/usr/local`, Linuxbrew's), else git-spice's install page in your browser;
  PR Cascade then waits the same way, and a second click opens the page again. *If a terminal
  finds git-spice but PR Cascade does not,* VS Code's own PATH is missing its directory (it
  usually has your login shell's PATH): set `prCascade.gsPath` to its full path, such as
  `/opt/homebrew/bin/git-spice` — the message names it when Homebrew has one.
- **Upgrade** — git-spice older than 0.31: `brew upgrade git-spice` when the one found is
  Homebrew's, else the install page.
- **Initialise** — `git-spice repo init --trunk <branch> --remote <remote>`, with your trunk's
  local branch (`main` for `origin/main`; git-spice needs a local one, and the message says how
  to create it when there is none) and `prCascade.remote`.
- **Set GitHub URLs** — for a host git-spice does not match on its own, such as
  `<name>.ghe.com`: `git config spice.forge.github.url https://<host>` in this repository, and
  `spice.forge.github.apiUrl` beside it (`https://api.<host>` for GHE.com, whose API git-spice
  would otherwise look for in the wrong place). GitLab likewise.
- **Log in** — `git-spice auth login --forge github` (or `gitlab`) in the terminal. git-spice
  asks how; the main choices:
  - *GitHub:* **GitHub CLI** if `gh` is logged in — nothing more to do, and PR Cascade will want
    `gh` for GitHub's native stacks anyway; else **OAuth** (a code to paste in the browser), or a
    **Personal Access Token** where an organisation does not allow the git-spice OAuth app.
  - *GitLab:* **GitLab CLI** if `glab` is logged in, else **OAuth** (a self-hosted GitLab needs
    an administrator to set up the git-spice OAuth app first) or a **Personal Access Token**.

  A `GITHUB_TOKEN` (or `GITLAB_TOKEN`) in your shell's environment counts as a login to
  git-spice and makes `auth login` refuse, so the line unsets it for that one command and a
  real login is stored.

**Tracking.** When a layer reads `not tracked`, the view's `…` menu offers **Track Stack with
git-spice** (also in the Command Palette): it runs `git-spice branch track <branch> --base <layer
below>` for each such layer, bottom to top — the bottom one on your trunk's local branch — then
refreshes and says how many it tracked, or what git-spice said. It needs git-spice and an
initialised repository, not a login; it refuses while a rebase is paused (resolve it, then run
it again); with several repositories open it asks which. A branch git-spice already tracks is never tracked again (that
would move its base), so the command looks at the repository afresh before it runs.

Bitbucket, Gitea, Forgejo and Azure DevOps repositories keep the Stack view; their pull-request
features are not in v1.

## Settings

All under `prCascade.*` in the Settings editor (search "PR Cascade"). Every one is read
again on each refresh, so a change takes effect without reloading the window.

| Setting | Default | Meaning |
|---|---|---|
| `trunk` | `""` | The ref the stack is measured against. Empty = auto-detect: the remote's default branch (`origin/HEAD`), then `origin/main`, `origin/master`, `main`, `master`. |
| `gitPath` | `""` | The git executable. Empty = the one the built-in Git extension found (it honours `git.path`), so both run the same git; a full path only to override that. |
| `remote` | `"origin"` | The remote whose default branch is consulted first — change it if you work on a fork. |
| `statusBar` | `true` | Show the `<branch> · n of N` status bar item: the branch HEAD is on and its place in the stack, counted from the bottom. Click it to open the Stack view. |
| `gsPath` | `""` | The git-spice executable. Empty = `git-spice`, then `gs`, from VS Code's PATH; a full path when VS Code's PATH misses it (see "git-spice setup"). A set value is the only one tried. |

Which repositories the view shows is the built-in Git extension's decision, so its settings
apply, exactly as in the Source Control view: `git.autoRepositoryDetection`,
`git.repositoryScanMaxDepth` (a parent folder open with the repositories one level below it
works at the default), `git.repositoryScanIgnoredFolders`, `git.openRepositoryInParentFolders`
when a workspace folder sits inside a repository, and `git.detectSubmodules` (a checked-out
submodule is a repository of its own, with its own row). A repository closed from Source
Control stays closed here too, across reloads.

## What's next

v0.1 is the viewer. The milestones after it, each one stack of PRs, are laid out in
[`pr-cascade-plan.md`](pr-cascade-plan.md):

5. git-spice backend: readiness and setup (the command above), then tracking and push.
6. Two views of every stack in the repository: a compact smartlog rail in the Explorer and a
   detailed graph in the extension's own container; the v0.1 tree goes once the rail matches it.
7. Create PRs for the whole stack, linked as a native GitHub stack.
8. Editable PR descriptions.
9. Restack, sync, insert-below, merge.

## Development

This repository is built as a stack of small, heavily commented PRs meant to be read in
order by someone learning TypeScript along the way. Start with
[`docs/reading-order.md`](docs/reading-order.md); the language is explained as it appears
in [`docs/typescript-primer.md`](docs/typescript-primer.md). Node ≥ 22 (CI uses 24); no
runtime dependencies.

### Loop

Nothing gets installed during development. VS Code runs the extension straight from this
folder in a second window, the **Extension Development Host**.

1. `npm install` once.
2. `npm run fixture` once (and again whenever you want a clean slate): builds a throwaway
   three-layer stack at `../fixture-repo/repo`, with its bare origin beside it at
   `../fixture-repo/origin.git` so `origin/main` exists. That sibling folder is the only
   thing this project writes outside its own directory.
3. Terminal 1: `npm run watch` — esbuild rebuilds `dist/extension.js` on every save.
4. Press **F5** ("Run Extension"). A second VS Code window opens with the extension loaded
   and `../fixture-repo/repo` open. Its Source Control side bar has a **Stack** view listing
   the three branches, top layer first. Open a layer to see the files it changes against
   the layer below it — only its own, never the ones the lower layers added — as
   `A  c` (added), `M  …` (modified), `D  f` (deleted), and `R  b2` with `b → b2` beside it
   for a rename. **Click a file** and the diff editor opens on it, titled
   `<file> (<parent> → <layer>)`: the file at the layer below on the left, the file at the
   layer on the right — so `A  a` under `api-refactor` opens `a (origin/main → api-refactor)`
   with an empty left pane, `D  f` under `retry-metrics` has content on the left and nothing
   on the right, and `R  b2` shows `b` on the left. The fixture's top layer also adds a text
   file whose name holds a space, a `#`, a `ü` and a `?` (a name a URI has to encode; it
   opens like any other) and a small binary `logo.png`: git has no text diff for it, so a
   click opens the file itself while that layer is checked out, and shows a message on a
   layer that is not.
5. Edit code → in the dev-host window run **Developer: Reload Window** to pick up the rebuild.
   The extension's own log is in that window's Output panel under "PR Cascade".

To live with a build in your normal VS Code: `npm run package`, then
`code --install-extension vscode-pr-cascade-0.1.0.vsix` — the same `.vsix` a release attaches.

### Tests

| Command | What it runs |
|---|---|
| `npm test` | typecheck + lint + unit + git tests — run this before every push |
| `npm run typecheck` | `tsc --noEmit` over `src/`, `test/` and `scripts/` |
| `npm run lint` | ESLint, including the rule that `src/core` never imports `vscode` |
| `npm run test:unit` | Vitest, `test/unit` — pure logic, no git, no VS Code |
| `npm run test:git` | Vitest, `test/git` — real `git` in throwaway temp repos |
| `npm run test:ext` | Mocha inside a real VS Code, `test/ext` and `test/ext-parent` — two launches, one workspace each (see `.vscode-test.mjs`); downloads VS Code into `.vscode-test/` on first run (slow, once) |
| `npm run build` / `watch` / `analyze` | esbuild: one bundle / rebuild on save / bundle plus per-package size report |
| `npm run package` | `vsce package` → a `.vsix` you can install with `code --install-extension` |
| `npm run depcheck -- <pkg>` | the dependency card a PR must include before adding a runtime library |

CI (`.github/workflows/ci.yml`) runs `npm test`, `npm run package` and `npm run test:ext` on
Linux and macOS. A pushed `v*` tag runs `.github/workflows/release.yml`, which checks the tag
against `package.json` and `CHANGELOG.md`, packages, and attaches the `.vsix` to a GitHub
release.

### Layout

```
src/extension.ts     entry point — wires core to VS Code
src/core/            pure logic + git runner; no VS Code imports (enforced by lint)
src/vscode/          adapters: the built-in Git extension's API (gitApi: repositories, the status
                     signal, the git executable), config (settings → plain values), the Stack tree
                     view, the status bar item, the stackdiff: content provider, the commands,
                     terminals, and the git-spice setup flow (login)
test/unit, test/git  Vitest (see vitest.config.mts)
test/helpers/        the fake git and command runners, a fake for VS Code's terminals and
                     notifications, and the fixture builder (a real throwaway stack)
test/ext, test/ext-parent   Mocha inside VS Code, one launch per folder (see .vscode-test.mjs)
docs/                reading order and the TypeScript primer
scripts/             developer tooling (never shipped)
```

## License

MIT — see [LICENSE](LICENSE).
