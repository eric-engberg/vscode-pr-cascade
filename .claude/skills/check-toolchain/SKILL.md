---
name: check-toolchain
description: Verify that every tool PR Cascade needs to build, test and run is installed and new enough — git, Node, npm, VS Code, git-spice, gh and its gh-stack extension, plus login state. Use when setting up on a new machine or a fresh clone, before starting a milestone that adds a new tool, or when npm ci / npm test / npm run test:ext / F5 fails in a way that looks like a missing, broken or outdated tool rather than a bug in the code.
---

# Check the toolchain

`scripts/doctor.sh` answers one question: does this machine have everything the project
needs? It is a POSIX shell script with no dependencies, on purpose — the first thing it has
to be able to say is "Node is not installed", which a Node script cannot say. Run it before
concluding that a failure is a bug in the code.

## Run it

```sh
sh scripts/doctor.sh            # what is needed right now
sh scripts/doctor.sh --strict   # also require the M5 tools and a local VS Code
```

It only reads. It never installs anything, and it never writes to the repository.

Exit status is 0 when nothing required is missing and 1 when something is, so it is safe to
use as a gate in a script.

## Read the output

Checks are grouped by when you actually need them, and that grouping is the point:

1. **Build and test** — git, Node, npm, and whether `npm ci` has been run. A `[FAIL]` here
   stops all work.
2. **Run it in VS Code** — only the F5 loop and `code --install-extension` need a local
   VS Code. `npm run test:ext` downloads its own copy, so this is a warning, not a failure.
3. **Stacked pull requests** — git-spice, gh, the gh-stack extension and both logins. No
   code calls these before milestone M5, so they are warnings until then. Use `--strict`
   when you are about to start M5, or when setting a machine up properly.

A `[FAIL]` means required and absent or too old. A `[warn]` means you can work today but
something is missing. A `[skip]` means the check did not apply, for example `package.json`
not existing yet on an early branch. The summary lists the exact fix command for every
non-ok line, chosen for the detected platform.

## When something is missing

Report what the doctor found and what it suggests, then **ask before installing anything**.
Installing packages changes the user's machine and is their call, not yours. Once they say
yes, run the command the doctor printed rather than improvising a different one.

Two specific rules on this project:

- **Never run `brew` while another `brew` process is running.** Homebrew takes a lock per
  formula and the second process fails partway through, which is how a half-upgraded Node
  gets left behind. Check with `ps aux | grep [b]rew` first.
- **Never store a token anywhere.** The sanctioned logins are `gh auth login --hostname
  <host> --web` and `git-spice auth login` choosing the "GitHub CLI" method, which reuses
  gh's OAuth token. Personal access tokens are prohibited by the user's work policy, and the
  extension itself never handles one (plan §3, §7.6).

## Traps this project has already hit

- **`gs` is Ghostscript, not git-spice.** Homebrew installs the binary as `git-spice`
  because Ghostscript owns the short name. The plan calls the tool `gs` throughout; on a
  machine where `gs --version` does not say "git-spice", run `git-spice` instead. The doctor
  says so explicitly when it sees this.
- **A binary that exists but does not run.** A Homebrew Node linked against a library that a
  later upgrade removed still appears on PATH and still fails. The doctor tells these apart:
  "found at ... but it does not run" is a different problem from "not on PATH", and the fix
  is a reinstall, not an install.
- **`code` is often not on PATH** even when VS Code is installed. That only matters for
  `code --install-extension`; F5 works without it.

## What it does not check

Network access, disk space, the VS Code download the extension-host tests fetch on first
run, and anything about the code itself. It checks tools, not correctness — `npm test` is
still what tells you whether the project works.
