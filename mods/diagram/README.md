# diagram

Install (Claude Code 2.1.287 or later): `/plugin install diagram --marketplace samuelbfernandes/codeUIstack`
Claude often answers with a ` ```mermaid ` block, which a terminal shows as raw text. This mod keeps the last one
and draws the simple cases as box art in a pane. Everything runs offline in the mod itself: no model tokens, no
network, no files read or written, no programs started.

## Use
- After an answer that contains a mermaid block, one short line appears: `Diagram · type diagram to see it`
  (at most once per turn; not while the pane is open). Nothing else happens by itself.
- Type `diagram` alone (any case, optional final `.`) or `/diagram` to open the pane; `diagram close` or `/diagram close` closes it.
  The words are handled locally and never sent to the model. A sentence that contains them is a normal prompt.
  Esc or the Close button also close it. An open pane redraws when a newer answer brings another diagram.
- Drawn: `flowchart` / `graph` (TD, TB, LR; boxes `A[..]`, `A(..)`, `A{..}`, circles drawn rounded; arrows `-->`, `---`,
  `-.->`, `==>`, `<-->`, labels `-->|text|` or `-- text -->`; `A & B --> C`), `sequenceDiagram` (participants, aliases,
  `->>` `-->>` `->` `-->` `-x` `-)`, notes, `autonumber`, loop/alt blocks as a marker row) and `pie` (bars with percentages).
- Wide drawings wrap their text to the pane. A left-to-right chart that is still too wide is drawn top-down.
- Anything else (class, gantt, ER, state ...), a diagram over 25 nodes or 60 connections, one it cannot read, or one
  too wide for the pane shows `Diagram · <reason>` and the source in a box. It never shows an error.

## Settings and turning off
`hint` (true): the one-line hint after an answer. `/plugin disable diagram` turns the mod off. Only the text of the
last diagram (cut at 20,000 characters) is kept, in memory for the session; `/clear` forgets it.

## Limits
- Simplified: subgraphs are drawn flat, BT and RL as TD and LR, styling lines are ignored, and a loop that points back up is
  listed under the drawing (`↺ B → A`) instead of being drawn as a line. In busy charts lines may cross at `┼`
  and two lines that meet can read as one. Each character counts as one column, so wide (CJK, emoji) text may misalign.
- Only a diagram in the final text of a turn is seen (not one in an earlier message of a long turn or in a subagent).
- Not verified in a live session: how the pane docks and scrolls tall drawings, colours in the desktop app, typing
  `diagram` in the real prompt box, the toast. Tests use a mocked engine. Not run on Windows.
