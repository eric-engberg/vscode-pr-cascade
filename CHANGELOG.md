# Changelog

All notable changes to PR Cascade are recorded here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org/); the newest release section's version is the one
in `package.json`, and a release's tag is that version with a `v` in front.

## [Unreleased]

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
