/**
 * core/shell.ts — a command, as a list of words, turned into one line a shell reads back as
 * exactly those words. The fixes item 19b offers run in a VS Code terminal — `gs repo init`,
 * `gs auth login`, `brew install` — because git-spice prompts there and the user must see it
 * (plan §7.5 step 2); a terminal takes text, so the words have to be written the way a shell
 * reads them. Everywhere else the extension runs programs with an argument list and no shell
 * at all (core/git.ts, core/command.ts), and nothing needs quoting.
 *
 * Layer: core (no VS Code imports; plan §4.1). Hand-rolled (plan §11.3: two functions are not
 * worth a dependency). Depends on: nothing. Depended on by: src/vscode/terminal.ts (item 19b),
 * test/unit/shell.test.ts. Plan: §4.2, §7.5 step 2, §7.6, §7.13.1, §10.1 item 19a, §13.2 D57.
 */

/**
 * The words that need no quoting: letters, digits and `_ . / : = @ % + , -`. Not one of
 * these means anything to sh, bash or zsh inside a word, so a branch name such as
 * `feat/FWRK-1434` or a path such as `/opt/homebrew/bin/git-spice` goes to the terminal as
 * it is, and reads as typed. The list is deliberately short: anything else — a space, `$`,
 * `!`, a quote, a glob, a letter outside ASCII — is quoted, which is always safe, only
 * noisier.
 */
// see primer §20 (regular expression literals: a character class, `^…$` for the whole text)
const BARE_WORD = /^[A-Za-z0-9_./:=@%+,-]+$/;

/**
 * `word` as one POSIX shell word. Unchanged when it is only BARE_WORD's characters and does
 * not start with `=` — zsh, the macOS default shell, replaces a leading `=name` with the path
 * of the command `name` (its EQUALS option, on by default; verified: `zsh -c 'echo =ls'`
 * prints `/bin/ls`), and git allows a branch named `=x`. Otherwise in single quotes, inside
 * which sh, bash and zsh change nothing at all — no `$`, no `!`, no backslash — so the one
 * character that needs care is the single quote itself: it is written `'\''` (close the
 * quotes, a backslash-escaped quote, open them again), which the shell glues back into the
 * one word. The empty string is `''`, so it still counts as an argument.
 *
 * For sh, bash and zsh on macOS and Linux, the platforms CI runs. fish also reads the `'\''`
 * form correctly, but inside its single quotes it treats `\\` and `\'` as escapes, so a word with
 * a backslash in it may arrive changed there — never a branch name (git forbids `\` in one),
 * possibly a path. A tab cannot be typed into an interactive shell
 * at all, quoted or not — its line editor takes it as completion — but no branch name can hold one
 * either. Windows shells quote differently again and are out of scope.
 */
// see primer §23 (string methods: `startsWith`, `replaceAll`) and §12 (template strings)
export function shellQuote(word: string): string {
  if (BARE_WORD.test(word) && !word.startsWith('=')) {
    return word;
  }
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/**
 * `argv` as one line for a terminal: each word through shellQuote, joined by one space —
 * `['/Applications/Dev Tools/git-spice', 'auth', 'login']` becomes `'/Applications/Dev
 * Tools/git-spice' auth login`.
 */
// see primer §25 (arrays: `map` and `join`) and §14 (`readonly` on an array type)
export function shellCommandLine(argv: readonly string[]): string {
  return argv.map(shellQuote).join(' ');
}
