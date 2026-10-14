# staged-diff

Install: `/plugin install staged-diff --marketplace samuelbfernandes/moddeck`

Shows what is staged for your next commit, in a pane beside the chat, before you commit.

## What it does
- `/staged-diff` runs `git diff --cached --stat` and then `git diff --cached` (2 lines of context, no external diff
  tool, no text conversion, no colour) and shows both in a pane, with a **Refresh** button (hotkey `r`).
- `/staged-diff <path>` limits both to that file or folder (passed to git after `--`).
- Says "Nothing is staged." when the index is empty, and shows git's own message when the folder is not a repository.
- Read-only. It starts `git` and nothing else, only when you run the command or press Refresh. It hooks no tool call,
  so it never slows down or blocks Claude.
- The pane shows at most 9,000 characters of git's output and says so when it cut the rest.
- The command's one-line answer (for example `1 file changed, 2 insertions(+)`) is also what the model sees.

## Use
    /staged-diff              the whole index
    /staged-diff src/model.R  one file or folder

A path that starts with `-` or holds control characters is refused, so it can never be read as a git option.

## Turn off
Close the pane, or `/plugin disable staged-diff`. Nothing runs until you call it.

## State for the moddeck side bar
`{ plugin: 'staged-diff', key: 'report' }`: the last reading (`path`, `stat`, `diff`, `isEmpty`, `isCut`, `error`, `at`),
or `null` before the first one. Nothing is kept in `$.store`.

## Limits
- Tested with a mocked engine (`claude plugin test`), on the terminal and desktop element tables; not yet checked by
  hand in a live session.
- Long diffs are cut, not paged: run `git diff --cached` in a shell for the rest.
- Git must be on the PATH. The command waits up to 15 seconds for each git call.

## Credit
Adapted from staged-diff in [awesome-claude-code-mods](https://github.com/whyashthakker/awesome-claude-code-mods)
(MIT, © 2026 Yash Thakker and contributors). Rewritten for moddeck: TypeScript in the house style, the reading kept in
`$.state` instead of module variables, the path checked and passed after `--` to both git calls, "Nothing is staged."
and git errors shown plainly, output cut at a line end with a note, and tests for each case. The upstream licence is in
`LICENSE`.
