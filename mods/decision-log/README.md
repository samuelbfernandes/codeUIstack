# decision-log

Install: `/plugin install decision-log --marketplace samuelbfernandes/moddeck`

Record a project decision in one line, in the project's own `docs/DECISIONS.md`, where people and agents will find it.

## What it does
- `/decision <what was decided> -- <why>` adds one row to `docs/DECISIONS.md` under the session's folder, in the table
  the `agents-md-scaffold` skill writes:

      | ID | Date | Decision | Rationale | Status |
      |----|------|----------|-----------|--------|
      | 004 | 2026-10-13 | Use renv for package versions | the lockfile makes installs reproducible | accepted |

  The ID is the highest numeric ID in the table plus one, zero-padded to three digits; the date is today's local date;
  the status is `accepted`. A `|` in your text is escaped and a line break becomes `<br>`, so the table stays intact.
  The rationale is optional. The decision is limited to 500 characters and the rationale to 1,000.
- The row goes at the end of the decisions table (so text below the table stays below it). The file's line endings
  (LF or CRLF) are kept. If the file has no such table, the table header and the row are added at the end; if there is
  no file, it is created with the template header (`# Decisions log` and the two table lines, without the template's
  TODO row).
- `/decision-log` opens a pane with the last 20 rows, newest first, and a **Refresh** button.
- **It writes one file, `docs/DECISIONS.md`, and only when you type `/decision`.** Nothing else on disk is touched;
  `/decision-log` only reads. It hooks no tool call and keeps nothing in `$.store`.
- The command's one-line answer (`added 004 to docs/DECISIONS.md`) is what the model sees.

## Use
    /decision Drop Python 3.9 support -- end of life, and it blocks the new typing syntax
    /decision Keep the raw data read-only
    /decision-log

## Turn off
`/plugin disable decision-log`. Nothing runs until you call it.

## State for the moddeck side bar
`{ plugin: 'decision-log', key: 'view' }`: the last reading of the file (`path`, `rows` (the last 20), `total`,
`isMissing`, `error`), or `null` before the first `/decision` or `/decision-log`.

## Limits
- One person at a time: two sessions adding a decision in the same second could pick the same ID.
- Rows whose first cell is not a number (the template's header) are ignored when counting.
- It does not commit the file; that stays your call.
- The date comes from the machine's clock and time zone.
- Tested with a mocked engine and file system (`claude plugin test`), on the terminal and desktop element tables; not
  yet checked by hand in a live session.

## Credit
Adapted from decision-log in [awesome-claude-code-mods](https://github.com/whyashthakker/awesome-claude-code-mods) (MIT,
© 2026 Yash Thakker and contributors). Rewritten for moddeck: upstream kept entries in the plugin's own store; this
version writes the project's own `docs/DECISIONS.md` in the agents-md-scaffold table format (numbered IDs, local
date, rationale, status), adds `/decision` for one-line entries, lists the last 20 in a pane, and has tests. The
upstream licence is in `LICENSE`.
