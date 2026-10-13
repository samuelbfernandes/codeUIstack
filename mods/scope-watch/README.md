# scope-watch

Install: `/plugin install scope-watch --marketplace samuelbfernandes/moddeck`

Tell Claude which folder you are working in; when it edits a file outside that folder, you see it at once and Claude
is asked to check the edit was intended.

## What it does
- `/scope-watch <folder>` sets the folder, relative to the session's folder (`./src/`, `src` and `src/` are the same).
  It is remembered per project: each session folder keeps its own.
- After every Edit, Write, MultiEdit or NotebookEdit call that succeeded, it compares the file's path with the folder.
  For a file outside it:
  - a toast: `scope-watch: R/other.R is outside src`;
  - a note the model reads after the result: `scope-watch: R/other.R is outside the folder the person is working in
    (src). Check this edit was intended.`
  Both come once per path per session, so a series of edits to one file is flagged once. Every outside edit is counted.
- Never blocks: the edit has already run when it looks, and its result goes back unchanged apart from that one note.
  A failed or refused edit, and every other tool, is left alone.

## Use
    /scope-watch src/analysis   watch this folder (remembered for this project)
    /scope-watch                the folder and the count of edits outside it this session
    /scope-watch off            stop watching (forgets the folder for this project)

A folder that does not exist yet is accepted, with a warning; a path that is a file is refused.

## Turn off
`/scope-watch off`, or `/plugin disable scope-watch`. With no folder set it does nothing.

## State for the moddeck side bar
`{ plugin: 'scope-watch', key: 'folder' }` (string or null), `{ plugin: 'scope-watch', key: 'outside' }` (number of
edits outside this session), `{ plugin: 'scope-watch', key: 'paths' }` (the distinct outside paths, at most 50) and
`{ plugin: 'scope-watch', key: 'root' }` (the session folder they belong to). `$.store` holds one key per project,
`folder:<session folder>`.

## Limits
- Only the four edit tools are watched. Files changed by a Bash command (`sed -i`, a script, `git checkout`) or an MCP
  tool are not seen.
- Paths are compared as text after folding `.` and `..`; links are not followed. Case is ignored for Windows paths
  only, so on a case-insensitive macOS disk `Src/` and `src/` count as different folders.
- The note costs a few tokens, once per outside path.
- Tested with a mocked engine (`claude plugin test`), POSIX and Windows-style paths; not yet checked by hand in a live
  session.

## Credit
Adapted from scope-watch in [awesome-claude-code-mods](https://github.com/whyashthakker/awesome-claude-code-mods) (MIT,
© 2026 Yash Thakker and contributors). Rewritten for moddeck: TypeScript in the house style, the folder set by command
and remembered per project instead of typed into a pane each session, paths normalised for POSIX and Windows, a toast
and a model note once per path, a count the side bar can read, and tests. The upstream licence is in `LICENSE`.
