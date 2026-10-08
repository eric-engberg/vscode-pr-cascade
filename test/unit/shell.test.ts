/**
 * test/unit/shell.test.ts — shell quoting as a specification: which words go to the shell as
 * they are, which are wrapped in single quotes, and how a quote inside a word survives. Every
 * command line a terminal of ours runs (item 19b: `gs repo init`, `gs auth login`, `brew
 * install`) is built by these two functions, so a path with a space, or a branch name with a `$`
 * or a quote, reaches git-spice as one argument, unexpanded.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no shell, no VS Code). Depends on:
 * src/core/shell.ts. Depended on by: nothing. Plan: §7.5 step 2, §7.6, §7.13.1, §10.1 item 19a,
 * §13.2 D57.
 */

// see primer §1 (import / export)
import { describe, expect, it } from 'vitest';
import { shellCommandLine, shellQuote } from '../../src/core/shell';

// see primer §5 (arrow functions)
describe('shellQuote', () => {
  describe('words the shell reads back as they are — left bare', () => {
    // see primer §25 (arrays) and §22 (for ... of): one test per word, named after it
    for (const word of ['main', '/opt/homebrew/bin/git-spice', 'feat/FWRK-1434', 'my_branch', 'origin/main', '--forge=github', 'a=b', 'v0.31.2', 'user@host:2222', '50%', 'a+b,c']) {
      // see primer §12 (template strings)
      it(`leaves ${word} unquoted`, () => {
        // act
        const quoted = shellQuote(word);

        // assert
        expect(quoted).toBe(word);
      });
    }
  });

  describe('words the shell would change — wrapped in single quotes', () => {
    it('quotes a word with a space, so it stays one argument — a path such as an app bundle\'s', () => {
      expect(shellQuote('/Applications/Dev Tools/git-spice')).toBe("'/Applications/Dev Tools/git-spice'");
    });

    // Characters a shell gives a meaning to that the bare list must never admit: home (`~`),
    // comments (`#`), globs (`?`, `[…]`), brace lists, escapes, subshells, redirection, `^`
    // (history in zsh with some options), and the two that would end or split the line typed into
    // a terminal — a tab (completion) and a newline (Enter).
    // see primer §44 (escape sequences: `\\`, `\t`, `\n`)
    for (const word of ['~', '~user', '#x', 'a?', '[a]', '{a,b}', 'a\\b', '(x)', 'a>b', '^x', 'a\tb', 'a\nb']) {
      // see primer §50 (`JSON.stringify`: the title shows a tab or a newline as \t or \n)
      it(`quotes ${JSON.stringify(word)}`, () => {
        expect(shellQuote(word)).toBe(`'${word}'`);
      });
    }

    it('quotes a `$`, so the shell does not expand a variable', () => {
      expect(shellQuote('$HOME')).toBe("'$HOME'");
    });

    it('quotes `!`, which bash and zsh read as history expansion in a terminal', () => {
      expect(shellQuote('!x')).toBe("'!x'");
    });

    it('quotes the characters that end or join commands: ; & | and the backquote', () => {
      expect(shellQuote('a;b')).toBe("'a;b'");
      expect(shellQuote('a&&b')).toBe("'a&&b'");
      expect(shellQuote('a|b')).toBe("'a|b'");
      expect(shellQuote('a`b')).toBe("'a`b'");
    });

    it('quotes a glob character, so the shell does not list files instead', () => {
      expect(shellQuote('*')).toBe("'*'");
    });

    it('quotes a double quote', () => {
      expect(shellQuote('a"b')).toBe("'a\"b'");
    });

    it('quotes a word starting with `=`, which zsh would replace with the path of a command of that name', () => {
      // `a=b` above stays bare: zsh's EQUALS expansion is about a leading `=` only
      expect(shellQuote('=x')).toBe("'=x'");
    });

    it('quotes a letter outside ASCII — the bare list is deliberately small', () => {
      expect(shellQuote('ü')).toBe("'ü'");
    });

    it('writes the empty string as two quotes, so it is still an argument', () => {
      expect(shellQuote('')).toBe("''");
    });
  });

  describe('a single quote inside the word', () => {
    it("closes the quotes, adds an escaped quote, and opens them again: it's → 'it'\\''s'", () => {
      // act
      const quoted = shellQuote("it's");

      // assert: four pieces the shell glues into one word — 'it' then \' then 's'
      expect(quoted).toBe("'it'\\''s'");
    });

    it('does so for every quote, not just the first', () => {
      expect(shellQuote("a'b'c")).toBe("'a'\\''b'\\''c'");
    });
  });
});

describe('shellCommandLine', () => {
  it('joins the words with one space, quoting only those that need it', () => {
    // act
    const line = shellCommandLine(['command', 'git-spice', 'repo', 'init', '--trunk', "it's", '--remote', 'origin']);

    // assert: git allows a quote in a branch name (not a space)
    expect(line).toBe("command git-spice repo init --trunk 'it'\\''s' --remote origin");
  });

  it('quotes an executable path with a space in it', () => {
    expect(shellCommandLine(['/Applications/Dev Tools/git-spice', 'auth', 'login'])).toBe("'/Applications/Dev Tools/git-spice' auth login");
  });

  it('is the empty string for no words', () => {
    expect(shellCommandLine([])).toBe('');
  });
});
