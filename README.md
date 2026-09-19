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

## Development loop

Nothing gets installed during development. VS Code runs the extension straight from this
folder in a second window, the **Extension Development Host**.

1. `npm install` once.
2. Terminal 1: `npm run watch` — esbuild rebuilds `dist/extension.js` on every save.
3. Press **F5** ("Run Extension"). A second VS Code window opens with the extension loaded.
   The launch config also opens `../fixture-repo`; until a later PR adds `npm run fixture`
   to create it, VS Code treats the missing path as a new file and shows an empty editor
   tab named `fixture-repo` instead of a folder — close it.
4. Edit code → in the dev-host window run **Developer: Reload Window** to pick up the rebuild.
   The extension's own log is in that window's Output panel under "PR Cascade".

## Tests

| Command | What it runs |
|---|---|
| `npm test` | typecheck + lint + unit + git tests — run this before every push |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `test/` |
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
src/vscode/          adapters: tree view, diff content provider, commands, config
test/unit, test/git  Vitest (see vitest.config.mts)
test/helpers/        the fake git runner (and, later, the fixture builder)
test/ext             Mocha inside VS Code (see .vscode-test.mjs)
docs/                reading order and the TypeScript primer
scripts/             developer tooling (never shipped)
```

## License

MIT — see [LICENSE](LICENSE).
