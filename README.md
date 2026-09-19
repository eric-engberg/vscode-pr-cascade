# PR Cascade

A VS Code extension for **stacked pull requests**: see the stack of branches under your
current branch next to the Source Control view, click a layer to see exactly what it
changes against its parent, and create, restack and sync the PRs on GitHub and GitLab
through [git-spice](https://abhinav.github.io/git-spice/) — with GitHub's native stacked-PR
view linked up automatically.

## Status

**Pre-alpha, milestone 1 in progress.** Nothing is usable yet. This repo is being built as a
stack of small, heavily commented PRs meant to be read in order by someone learning
TypeScript along the way. Start with [`docs/reading-order.md`](docs/reading-order.md); the
language is explained as it appears in [`docs/typescript-primer.md`](docs/typescript-primer.md).

Milestones (each is one stack of PRs):

1. **Skeleton + layer list** — toolchain, git runner, repo discovery, trunk detection, the
   stack computed from git ancestry, a tree that shows the branch names. ← *now*
2. Files per layer.
3. Diff on click (parent vs layer, in VS Code's native diff editor).
4. Auto-refresh, state nodes, status bar → v0.1.
5. git-spice backend: readiness, login, push.
6. Create PRs for the whole stack, linked as a native GitHub stack.
7. Editable PR descriptions.
8. Restack, sync, insert-below, merge.

## Requirements

- VS Code ≥ 1.85
- git ≥ 2.38
- Node ≥ 22 for development (CI uses 24); no runtime dependencies so far.

## Settings

All under `prCascade.*` in the Settings editor (search "PR Cascade"). Every one is read
again on each refresh, so a change takes effect without reloading the window.

| Setting | Default | Meaning |
|---|---|---|
| `trunk` | `""` | The ref the stack is measured against. Empty = auto-detect: the remote's default branch (`origin/HEAD`), then `origin/main`, `origin/master`, `main`, `master`. |
| `gitPath` | `"git"` | The git executable; a full path when git lives somewhere unusual. |
| `remote` | `"origin"` | The remote whose default branch is consulted first — change it if you work on a fork. |
| `repositoryScanMaxDepth` | `1` | How many levels below each workspace folder to look for repositories: `0` the folders only, `1` their immediate subfolders too (a parent folder open with the repositories under it), `-1` no limit — one git process per directory, all at once. Same meaning as `git.repositoryScanMaxDepth`. |
| `repositoryScanIgnoredFolders` | `["node_modules"]` | Folder names never entered by that scan. Same meaning as `git.repositoryScanIgnoredFolders`. |

A value the last two cannot use (a depth that is not a whole number of -1 or more, an
ignore list that is not a list) is treated as the default.

## Development loop

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
   the three branches, top layer first.
5. Edit code → in the dev-host window run **Developer: Reload Window** to pick up the rebuild.
   The extension's own log is in that window's Output panel under "PR Cascade".

## Tests

| Command | What it runs |
|---|---|
| `npm test` | typecheck + lint + unit + git tests — run this before every push |
| `npm run typecheck` | `tsc --noEmit` over `src/`, `test/` and `scripts/` |
| `npm run lint` | ESLint, including the rule that `src/core` never imports `vscode` |
| `npm run test:unit` | Vitest, `test/unit` — pure logic, no git, no VS Code |
| `npm run test:git` | Vitest, `test/git` — real `git` in throwaway temp repos |
| `npm run test:ext` | Mocha inside a real VS Code, `test/ext` — downloads VS Code into `.vscode-test/` on first run (slow, once) |
| `npm run build` / `watch` / `analyze` | esbuild: one bundle / rebuild on save / bundle plus per-package size report |
| `npm run package` | `vsce package` → a `.vsix` you can install with `code --install-extension` |
| `npm run depcheck -- <pkg>` | the dependency card a PR must include before adding a runtime library |

CI (`.github/workflows/ci.yml`) runs `npm test` and `npm run test:ext` on Linux and macOS.

## Layout

```
src/extension.ts     entry point — wires core to VS Code
src/core/            pure logic + git runner; no VS Code imports (enforced by lint)
src/vscode/          adapters: config (settings → plain values) and the Stack tree view;
                     later milestones add the diff content provider and commands
test/unit, test/git  Vitest (see vitest.config.mts)
test/helpers/        the fake git runner and the fixture builder (a real throwaway stack)
test/ext             Mocha inside VS Code (see .vscode-test.mjs)
docs/                reading order and the TypeScript primer
scripts/             developer tooling (never shipped)
```

## License

MIT — see [LICENSE](LICENSE).
