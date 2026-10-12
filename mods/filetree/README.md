# filetree

Install (Claude Code 2.1.287 or later): `/plugin install filetree --marketplace samuelbfernandes/codeUIstack`
The project's file tree in a pane beside the chat, lit up as Claude works. Read-only: it never writes a file
and never runs a git command that writes.

## Use
- It opens by itself at session start (setting `autoOpen`, default on) where the screen can dock a pane: the
  fullscreen terminal (`/tui fullscreen`, at least 144 columns) or the desktop app. Elsewhere it does nothing and
  says nothing. It opens once per session: after you close it, it stays closed.
- Toggle it any time: type `filetree`, `file tree` or `tree` alone (any case, optional final `.`), or `/filetree`.
  The typed words are handled locally, never sent to the model, no tokens. A sentence containing them is a normal prompt.
  The reply is one line (`Filetree · open`, `Filetree · closed`); a second dim line appears only when it needs one.
- It lists the working directory, 4 levels deep, at most 400 entries, folders collapsed (press a folder to open it).
  Hidden: `.git`, `node_modules`, `target`, `renv`, `.Rproj.user`, `__pycache__`, `.venv`, `dist`, `build`.
  Past the cap it says `+N more`. `Refresh` scans again; it also rescans (at most every 3 s) after
  Edit, Write, NotebookEdit or Bash calls while the pane is open.
- Files Claude used light up: `○` cyan read (Read, and files named by Grep/Glob, up to 50 per call),
  `●` yellow edited. A fresh one shimmers for 6 s, then keeps a steady colour. Folders above a lit file open once.
- After a Bash call containing `git commit`, and every 5 s while the pane is open and an edit still waits, it runs
  `git --no-optional-locks status --porcelain -z` (and `rev-parse --show-prefix`). An edited file git no longer
  lists turns green `✓`. Files only read never turn green.

## Width
Best at 110 columns or more under `/tui fullscreen`. On the main screen, or under 40 columns of pane, it shows one
line: `Side panel · use /tui fullscreen` (or `Too narrow · widen the pane`). The automatic open closes itself again there (and when the engine
has no room for an unasked pane); a pane you open yourself with `/filetree` or `tree` stays.

## Settings and turning off
`autoOpen` (true), `maxDepth` (4), `maxEntries` (400), `extraIgnore` (comma-separated names to hide too).
`/plugin disable filetree` turns it off; `autoOpen` = false keeps the manual toggle only. Nothing is stored.

## Caveats
- It shows real file names: close it before screen-sharing. "Committed" means "not in `git status` any more", so
  a gitignored or discarded file turns green too. Outside a git repository nothing turns green.
- Not verified in a live session: **auto-open** (tests use a mocked engine: whether the real engine docks the pane at
  session start, and the inline close on the main screen), the 500 ms shimmer and 5 s poll timers, how the dock
  scrolls 400 rows, the colours in the desktop app, and typing `tree` in the real prompt box. Not run on Windows.
- Symbolic links are listed, never followed. Directories at the depth limit show `(not scanned)`.
