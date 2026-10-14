# table-preview

Install: `/plugin install table-preview --marketplace samuelbfernandes/moddeck`

A quick look at a data table without sending it to the model: columns, types, row count and the first rows, in a pane.

## What it does
- `/table-preview <path>` reads one `.csv`, `.tsv` or `.txt` file. A relative path is taken from the session's folder; an
  absolute path is taken as is. Quotes around the path are removed.
- Detects the delimiter (comma, semicolon or tab) from the first rows.
- Parses quoted fields properly: delimiters, doubled quotes (`""`) and line breaks inside quotes are part of the cell.
- Shows the column count, the header, a simple type per column (`number`, `text` or `empty`) with the share of empty
  cells, the exact number of data rows (the header not counted) and the first 20 rows as an aligned table (the first
  10 columns, cells cut at 18 characters).
- Warns when the file ends inside a quoted field or when rows have a different number of fields than the header.
- The pane holds the details; the command's one-line answer (`data.csv: 1,204 rows × 7 columns (comma-separated)`) is
  what the model sees. Where nothing draws panes (a headless run), the whole report comes back as text instead.
- Refuses symbolic links, folders, other file types and files bigger than `maxKb`, without reading them. It writes
  nothing and hooks no tool call.

## Use
    /table-preview data/raw/survey.csv
    /table-preview "C:\Users\me\My data\counts.tsv"

## Turn off
Close the pane, or `/plugin disable table-preview`. Nothing runs until you call it.

## Settings
`maxKb` (default 2048, at most 4096): the largest file it reads. The engine's file reader cannot read part of a file,
so the whole file is read, and a bigger file is refused with a message instead of being cut.

## State for the moddeck side bar
`{ plugin: 'table-preview', key: 'report' }`: the last file read (`name`, `delimiter`, `rowCount`, `columnCount`, `columns`,
`warnings`, ...), or `null`. Nothing is kept in `$.store`.

## Limits
- Types are a quick guess: a column is `number` when every non-empty cell looks like a number (a decimal comma counts);
  empty cells and `NA` count as empty. Dates, booleans and factors show as `text`.
- The first row is always taken as the header.
- Only the path itself is checked for being a link, not the folders above it.
- Wide characters (CJK, emoji) can misalign the preview columns.
- Tested with a mocked engine (`claude plugin test`), on the terminal and desktop element tables; not yet checked by
  hand in a live session.

## Credit
Adapted from table-preview in [awesome-claude-code-mods](https://github.com/whyashthakker/awesome-claude-code-mods) (MIT,
© 2026 Yash Thakker and contributors). Rewritten for moddeck: TypeScript in the house style, semicolon and tab files,
a lenient parser that reports an unclosed quote instead of failing, column types and empty shares, an exact row count,
a settable size limit, links and folders refused, a text answer where no pane is drawn, and tests. The upstream licence
is in `LICENSE`.
