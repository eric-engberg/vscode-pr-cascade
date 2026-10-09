# Changelog

All notable changes to PR Cascade are recorded here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org/); the newest release section's version is the one
in `package.json`, and a release's tag is that version with a `v` in front.

## [Unreleased]

### Added

- **PR Cascade: Set Up git-spice** in the Command Palette: checks that git-spice is installed
  and new enough, that the repository is initialised for it, that its remote is a GitHub or
  GitLab repository git-spice recognises, and that you are logged in — and offers the fix for
  the first thing missing (install or upgrade with Homebrew or from git-spice's install page,
  `git-spice repo init`, the forge's `spice.forge.*` URLs, `git-spice auth login` in a
  terminal), waits for it to take, refreshes, and goes on to the next.
- Setting `prCascade.gsPath`: the git-spice executable, when VS Code's PATH does not find it.
- Each layer now shows what git-spice knows about it beside its count: its pull request's id
  (`#12`; the link is in the tooltip), `needs restack`, `needs push`, or `not tracked`. Nothing
  changes when git-spice is not set up; the Output panel says why.
- **Track Stack with git-spice** in the Stack view's `…` menu (shown while a layer reads
  `not tracked`) and in the Command Palette: adopts the untracked layers bottom to top and
  refreshes.
- **Push Whole Stack** in the Stack view's `…` menu and the Command Palette: pushes every
  branch of the stack with `git-spice stack submit --no-publish --no-update-only` —
  force-with-lease, no pull requests created, no login needed — tracking the untracked layers
  first; refuses, before anything moves, a layer whose remote copy has commits yours does not
  (after a fetch), a layer that needs a restack, a paused rebase and a detached HEAD; what
  git-spice says beside `Pushed` (an upstream renamed to `<branch>-2`, a warning) goes to the
  Output panel and the sentence says so. Both it and Track Stack are greyed out during a rebase.

## [0.1.0] - 2026-10-01

The first release: the stack is visible. Creating, restacking and syncing its pull requests
comes in later versions.

### Added

- A **Stack** view in the Source Control side bar: the branch you are on and the local
  branches below it that trunk does not yet contain, top layer first, each labelled with its
  branch name, its distance from trunk and a `· current` marker on the branch you are on.
  Works when the repository is a nested subfolder of a workspace folder, and lists several
  repositories one collapsible row each.
- Expanding a layer lists the files it changes against the layer below it — added, modified,
  deleted, and renames as `old → new`.
- Clicking a file opens VS Code's diff editor, the layer below on the left and the layer on
  the right; added, deleted and renamed files show what they should; a binary file opens as
  a file instead while its layer is checked out, and a message says so otherwise.
- The repositories come from VS Code's built-in Git extension, and the view refreshes itself
  after every `git status` that extension runs; a Refresh button covers what it cannot see.
- A row above the layers while a rebase is paused ("Rebase in progress — resolve it first")
  or when you are not on a branch ("Detached HEAD").
- A status bar item, `<branch> · n of N`, for the branch you are on and its place in the
  stack; click it to open the view.
- Settings: `prCascade.trunk`, `prCascade.gitPath`, `prCascade.remote`, `prCascade.statusBar`.

[Unreleased]: https://github.com/eric-engberg/vscode-pr-cascade/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/eric-engberg/vscode-pr-cascade/releases/tag/v0.1.0
