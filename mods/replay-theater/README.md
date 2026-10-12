# replay-theater

Install (Claude Code 2.1.287 or later): `/plugin install replay-theater --marketplace samuelbfernandes/codeUIstack`

Step through the file edits Claude made, one diff at a time.

- Records Claude's own Edit, Write, MultiEdit (where the build has it) and NotebookEdit calls, after they succeed.
  The call, its input and its result are never altered; any failure here is ignored (fail-open).
- When a turn made at least one edit, a band above the prompt says `● N edits in M files` with a `Replay` button.
  It goes away when you send the next prompt.
- `/replay` opens a pane on the last turn that recorded edits; `/replay all` covers everything held for this session.
  Typing `replay` alone (any case, optional final `.`) does the same as `/replay`: handled locally, never sent to the
  model, no tokens. `replay all` stays a slash command, and a sentence containing the word is a normal prompt.
  The reply is one line, `Replay · 4 edits in the last turn`; a second dim line appears only for a problem.
  The pane shows `Replay · i of N`, the path, the tool, and the diff (removed red, added green).
  Buttons: Prev (p), Next (n), Close (c). With the pane focused, Tab and the arrows move between buttons.
- The last 200 edits are kept in memory (each cut to about 20,000 characters) and cleared on `/clear`. Nothing is written to disk.

- Hint (setting `turnHint`, default on): when a turn changed 3 or more files, one toast says
  `3 files changed · type replay to review`. At most once per 10 minutes, never for a smaller turn, and
  only when a screen is attached (not in a plain `-p` run). Turn it off in `/config` (`turnHint` = false).

Turn it off: `/plugin disable replay-theater`.

## Limits

- Only Claude's file-edit tools are recorded. Shell edits (sed, mv, git, redirects) are not. When the turn also ran a
  Bash command that looks like it modifies files (a rough regex), the pane footer says `Shell edits are not replayed`.
- Line numbers in the diff count from the changed snippet, not from the file: the tool inputs do not say where it sat.
- A Write shows a real before/after only if the file was at most 200 KB and readable just before the write;
  otherwise the pane says the previous content was not captured. A new file is labelled "new file".
- NotebookEdit shows the new cell source only. Edits made by subagents are recorded with the turn that spawned them.
- The band's `r` hotkey works while the band holds the keyboard (click it or ctrl+x tab). A bare `r` typed at an empty
  prompt is not routed to a band button by the engine, so type `replay` (or `/replay`) at the prompt.
- N counts distinct files, not edits. The hint's 10-minute gap is per session and forgotten on restart.
- Not verified in a live session: only validate, type-check and the engine's test kit were run. The toast's look,
  typing `replay` in the real prompt box, pane placement and the diff colours were not seen.
