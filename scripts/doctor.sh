#!/bin/sh
#
# Checks that every tool PR Cascade needs is installed and new enough, and prints the command
# that fixes whatever is missing. Shell rather than Node so it can report a missing Node.
# Exits 0 when nothing required is missing, 1 otherwise.

set -u

# Nothing calls git-spice or gh before milestone M5, and `npm test` downloads its own VS Code,
# so those are warnings until --strict turns every warning into a failure.
STRICT=0

usage() {
    cat <<'USAGE'
Usage: sh scripts/doctor.sh [--strict]

Checks that every tool PR Cascade needs is installed and new enough, and prints the exact
command that fixes whatever is missing.

  --strict     Treat warnings as failures: also require git-spice, gh and a local VS Code.
  -h, --help   Show this message.

Exit status: 0 when nothing required is missing, 1 otherwise.
USAGE
}

for argument in "$@"; do
    case "$argument" in
        --strict) STRICT=1 ;;
        -h|--help) usage; exit 0 ;;
        *) printf 'doctor: unknown option: %s\n\n' "$argument" >&2; usage >&2; exit 2 ;;
    esac
done

# Found from the script's own location, so it works from any directory.
SCRIPT_DIRECTORY=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIRECTORY/.." && pwd)

case "$(uname -s)" in
    Darwin) PLATFORM=macos ;;
    Linux)  PLATFORM=linux ;;
    *)      PLATFORM=other ;;
esac

# --- helpers ---------------------------------------------------------------

have() {
    command -v "$1" >/dev/null 2>&1
}

# $1 >= $2, comparing the first three dotted numbers. awk because `sort -V` is a GNU
# extension that macOS does not ship.
version_ge() {
    awk -v found="$1" -v wanted="$2" '
        function as_number(version,   parts, count, index_, total) {
            count = split(version, parts, ".")
            total = 0
            for (index_ = 1; index_ <= 3; index_++) {
                total = total * 1000 + (index_ <= count ? parts[index_] + 0 : 0)
            }
            return total
        }
        BEGIN { exit as_number(found) >= as_number(wanted) ? 0 : 1 }
    '
}

# Printed, never run: installing is the user's decision. Non-macOS gets a link because Linux
# has apt, dnf and pacman and guessing wrong is worse.
install_hint() {
    macos_command=$1
    documentation_url=$2
    case "$PLATFORM" in
        macos) printf '    %s\n' "$macos_command" ;;
        *)     printf '    see %s\n' "$documentation_url" ;;
    esac
}

OK_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
FIXES=''

# report <ok|warn|fail|skip> <label> <detail> [fix, already indented]
report() {
    status=$1
    label=$2
    detail=$3
    fix=${4:-}

    if [ "$status" = warn ] && [ "$STRICT" -eq 1 ]; then
        status=fail
    fi

    case "$status" in
        ok)   marker='[ ok ]'; OK_COUNT=$((OK_COUNT + 1)) ;;
        warn) marker='[warn]'; WARN_COUNT=$((WARN_COUNT + 1)) ;;
        fail) marker='[FAIL]'; FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
        *)    marker='[skip]' ;;
    esac

    printf '%s  %-20s %s\n' "$marker" "$label" "$detail"

    if [ -n "$fix" ] && [ "$status" != ok ] && [ "$status" != skip ]; then
        FIXES="${FIXES}
  ${label}:
${fix}"
    fi
}

# Host comes from the remote, never hardcoded: one machine may hold repositories from
# github.com and a GitHub Enterprise host at once.
remote_host() {
    url=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null) || return 1
    [ -n "$url" ] || return 1
    case "$url" in
        *://*) printf '%s\n' "$url" | sed -e 's|^[a-zA-Z0-9+.-]*://||' -e 's|^[^@/]*@||' -e 's|[:/].*$||' ;;
        *:*)   printf '%s\n' "$url" | sed -e 's|^[^@]*@||' -e 's|:.*$||' ;;
        *)     return 1 ;;
    esac
}

# --- build and test --------------------------------------------------------

printf 'PR Cascade toolchain check\n'
printf 'repository: %s\n\n' "$REPO_ROOT"
printf 'Build and test — needed for npm ci, npm test, npm run build\n'

GIT_MINIMUM=2.38
if have git; then
    git_version=$(git --version 2>/dev/null | awk '{print $3}')
    if [ -z "$git_version" ]; then
        report fail "git" "found at $(command -v git) but it does not run" \
            "$(install_hint 'xcode-select --install' https://git-scm.com/downloads)"
    elif version_ge "$git_version" "$GIT_MINIMUM"; then
        report ok "git" "$git_version"
    else
        report fail "git" "$git_version is older than $GIT_MINIMUM" \
            "$(install_hint 'brew install git' https://git-scm.com/downloads)"
    fi
else
    report fail "git" "not on PATH" \
        "$(install_hint 'xcode-select --install' https://git-scm.com/downloads)"
fi

# engines.node says >= 22, @vscode/vsce needs 22, CI runs 24.
NODE_MINIMUM=22
if have node; then
    # No output means the binary is there but cannot start, which is what a broken upgrade
    # looks like. Telling you "not installed" would send you to the wrong fix.
    node_version=$(node --version 2>/dev/null | sed 's/^v//')
    if [ -z "$node_version" ]; then
        # The literal newline is deliberate: command substitution eats a trailing one.
        report fail "node" "found at $(command -v node) but it does not run" \
            "    node --version   # read the error first; a broken upgrade looks like this
$(install_hint 'brew reinstall node' https://nodejs.org/en/download)"
    elif version_ge "$node_version" "$NODE_MINIMUM"; then
        report ok "node" "$node_version"
    else
        report fail "node" "$node_version is older than $NODE_MINIMUM" \
            "$(install_hint 'brew install node' https://nodejs.org/en/download)"
    fi
else
    report fail "node" "not on PATH" \
        "$(install_hint 'brew install node' https://nodejs.org/en/download)"
fi

if have npm; then
    npm_version=$(npm --version 2>/dev/null)
    if [ -n "$npm_version" ]; then
        report ok "npm" "$npm_version"
    else
        report fail "npm" "found at $(command -v npm) but it does not run" \
            "    Reinstall Node; npm ships with it."
    fi
else
    report fail "npm" "not on PATH (it ships with Node)" \
        "$(install_hint 'brew install node' https://nodejs.org/en/download)"
fi

# package.json only exists once the scaffold PR is merged.
if [ -f "$REPO_ROOT/package.json" ]; then
    if [ -d "$REPO_ROOT/node_modules" ]; then
        report ok "dependencies" "node_modules present"
    else
        report warn "dependencies" "node_modules missing" "    npm ci"
    fi
else
    report skip "dependencies" "no package.json on this branch yet"
fi

# --- VS Code ---------------------------------------------------------------

printf '\nRun it in VS Code — needed for F5 and for installing the .vsix\n'

# `npm run test:ext` downloads its own copy, so only the F5 loop needs a local one.
VSCODE_MINIMUM=1.85
vscode_version=''
vscode_detail=''
if have code; then
    vscode_version=$(code --version 2>/dev/null | head -1)
    vscode_detail="$vscode_version"
else
    for candidate in \
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
        "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
        "/usr/share/code/bin/code" \
        "/snap/bin/code"
    do
        if [ -x "$candidate" ]; then
            vscode_version=$("$candidate" --version 2>/dev/null | head -1)
            vscode_detail="$vscode_version, but the 'code' command is not on PATH"
            break
        fi
    done
fi

if [ -z "$vscode_version" ]; then
    report warn "VS Code" "not found (npm test still works without it)" \
        "$(install_hint 'brew install --cask visual-studio-code' https://code.visualstudio.com/download)"
elif version_ge "$vscode_version" "$VSCODE_MINIMUM"; then
    if have code; then
        report ok "VS Code" "$vscode_detail"
    else
        # Only `code --install-extension` needs the command; F5 does not.
        report warn "VS Code" "$vscode_detail" \
            "    In VS Code: Cmd+Shift+P, \"Shell Command: Install 'code' command in PATH\""
    fi
else
    report fail "VS Code" "$vscode_version is older than $VSCODE_MINIMUM" \
        "$(install_hint 'brew upgrade --cask visual-studio-code' https://code.visualstudio.com/download)"
fi

# --- stacked pull requests -------------------------------------------------

printf '\nStacked pull requests — used by the extension from M5 on, and to submit its own PRs\n'

# Homebrew installs the binary as `git-spice`, because Ghostscript owns `gs` on most machines.
GIT_SPICE_MINIMUM=0.31
spice_command=''
if have git-spice; then
    spice_command=git-spice
elif have gs && gs --version 2>&1 | head -1 | grep -q 'git-spice'; then
    spice_command=gs
fi

if [ -n "$spice_command" ]; then
    spice_version=$("$spice_command" --version 2>/dev/null | head -1 | awk '{print $2}')
    if [ -z "$spice_version" ]; then
        report warn "git-spice" "found but it does not run" \
            "$(install_hint 'brew reinstall git-spice' https://abhinav.github.io/git-spice/start/install/)"
    elif version_ge "$spice_version" "$GIT_SPICE_MINIMUM"; then
        report ok "git-spice" "$spice_version (run it as '$spice_command')"
    else
        report warn "git-spice" "$spice_version is older than $GIT_SPICE_MINIMUM" \
            "$(install_hint 'brew upgrade git-spice' https://abhinav.github.io/git-spice/start/install/)"
    fi
else
    report warn "git-spice" "not found" \
        "$(install_hint 'brew install git-spice' https://abhinav.github.io/git-spice/start/install/)"
fi

if have gs && ! gs --version 2>&1 | head -1 | grep -q 'git-spice'; then
    report warn "gs on PATH" "'gs' here is not git-spice (Ghostscript owns that name)" \
        "    Nothing to install: the tool answers to 'git-spice' on this machine.
    Add \"alias gs='git-spice'\" to your shell profile if you want the short name."
fi

# gh is what creates the native stack badge and map on GitHub (gh stack link). GitLab needs none.
GH_MINIMUM=2.90
if have gh; then
    gh_version=$(gh --version 2>/dev/null | head -1 | awk '{print $3}')
    if [ -z "$gh_version" ]; then
        report warn "gh" "found but it does not run" \
            "$(install_hint 'brew reinstall gh' https://github.com/cli/cli#installation)"
    elif version_ge "$gh_version" "$GH_MINIMUM"; then
        report ok "gh" "$gh_version"
    else
        report warn "gh" "$gh_version is older than $GH_MINIMUM (gh stack needs $GH_MINIMUM)" \
            "$(install_hint 'brew upgrade gh' https://github.com/cli/cli#installation)"
    fi

    if gh extension list 2>/dev/null | grep -q 'gh-stack'; then
        report ok "gh-stack extension" "installed"
    else
        report warn "gh-stack extension" "not installed" "    gh extension install github/gh-stack"
    fi

    host=$(remote_host)
    if [ -n "${host:-}" ]; then
        if gh auth status --hostname "$host" >/dev/null 2>&1; then
            report ok "gh login" "logged in to $host"
        else
            report warn "gh login" "not logged in to $host" \
                "    gh auth login --hostname $host --web"
        fi
    else
        report skip "gh login" "no 'origin' remote to take a host from"
    fi
else
    report warn "gh" "not found" \
        "$(install_hint 'brew install gh' https://github.com/cli/cli#installation)"
fi

if [ -n "$spice_command" ]; then
    if "$spice_command" -C "$REPO_ROOT" auth status >/dev/null 2>&1; then
        report ok "git-spice login" "logged in"
    else
        report warn "git-spice login" "not logged in" \
            "    $spice_command auth login          # choose \"GitHub CLI\" to reuse gh's token, no PAT"
    fi
fi

# --- summary ---------------------------------------------------------------

printf '\n%s ok, %s warning(s), %s missing\n' "$OK_COUNT" "$WARN_COUNT" "$FAIL_COUNT"

if [ -n "$FIXES" ]; then
    printf '\nTo fix:%s\n' "$FIXES"
fi

if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
fi
exit 0
