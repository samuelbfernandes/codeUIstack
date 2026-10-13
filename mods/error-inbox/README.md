# error-inbox

Install: `/plugin install error-inbox --marketplace samuelbfernandes/moddeck`

One place for everything that went wrong in a session's tool calls, with a button to ask Claude about any of them.

## What it does
- Watches every tool call after it ran and keeps the last 30 that:
  - **failed**: the tool answered an error (a non-zero exit, a file not found, an edit that did not match);
  - **denied**: the error says the person or a permission rule turned the call down;
  - **refused**: a hook or plugin refused the call.
- For each it keeps the tool name, the command or file path only (never file contents or other inputs), the error as the
  model read it cut to 600 characters, and the time. Obvious secrets (`ghp_...`, `sk-...`, `AKIA...`, `Bearer x`,
  `password=...`, `--token x`, a password in a URL) are replaced by `***` first.
- `/error-inbox` opens a pane, newest first, with **Clear**. Each entry has an **Ask Claude** button that puts a draft
  in the prompt box ("Please explain this error from a Bash call and suggest a fix (do not change anything yet)", with
  the input and the error). The draft is never sent: you edit it or press Enter. If the box already holds text, the
  draft is added after it. Where the box cannot take it (a dialog is open), the draft is copied to the clipboard instead
  and a toast says so.
- Memory only: nothing is written to disk, and the list is gone when the session ends.
- Never blocks or changes a call: the model gets every result exactly as it came back.

## Use
    /error-inbox           open the pane and print a one-line summary
    /error-inbox status    the summary only
    /error-inbox clear     empty the list
    /error-inbox off       stop keeping errors (remembered across sessions);  /error-inbox on  resumes

## Turn off
`/error-inbox off`, or `/plugin disable error-inbox`.

## State for the moddeck side bar
`{ plugin: 'error-inbox', key: 'entries' }` (the last 30, oldest first: `tool`, `kind`, `input`, `error`, `at`) and
`{ plugin: 'error-inbox', key: 'isOff' }` (boolean). `$.store` holds only `off`.

## Limits
- "Denied" is told apart from "failed" by the words of the error, so a reworded message lands under "failed".
- A permission prompt the person answers "no" to is kept only if the engine reports it as the call's error result,
  which is how it reaches the model; this was checked against the API's types and a mocked engine, not in a live session.
- The pane draws about 9,000 characters, newest first; older entries are counted, not drawn.
- Secret scrubbing catches the common shapes only; it is a safety net, not a guarantee.
- Tested with a mocked engine (`claude plugin test`), on the terminal and desktop element tables.

## Credit
Adapted from error-inbox in [awesome-claude-code-mods](https://github.com/whyashthakker/awesome-claude-code-mods) (MIT,
© 2026 Yash Thakker and contributors). Rewritten for moddeck: TypeScript in the house style, failed, denied and refused
told apart, the command or path kept beside the error, secrets scrubbed, the list in `$.state`, an "Ask Claude" button
that drafts a prompt without sending it, an on/off switch, and tests. The upstream licence is in `LICENSE`.
