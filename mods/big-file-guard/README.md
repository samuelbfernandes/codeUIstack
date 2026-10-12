# big-file-guard

Install: `/plugin install big-file-guard --marketplace samuelbfernandes/moddeck`

Saves tokens. When the model reads a large data or log file whole, it gets the first lines and a note instead.

## What it does
- Watches the Read tool only. If the file is a csv, tsv, json, jsonl, ndjson, log or txt file bigger than `maxKb`
  and the call names no `offset` or `limit`, the read is cut to the first `headLines` lines.
- Adds a note the model reads after the result: `big-file-guard: showed the first 200 of ~N lines (file is X KB). Ask for a range...`
- Never blocks. A call that already names `offset` or `limit`, other tools, small files, and other or unknown file types pass untouched.
- Fail-open: if anything goes wrong, the call goes through as the model made it.
- Counts approximate tokens saved (file bytes / 4, minus what was shown).

## Use
    /big-file-guard          settings and tokens saved this session
    /big-file-guard off      pause it (remembered across sessions);  /big-file-guard on  resumes

The `/` is required: a bare `big-file-guard` goes to the model like any prompt.

## Turn off
`/big-file-guard off`, the `enabled` setting, or `/plugin disable big-file-guard`.

## Settings
`enabled` (default on), `maxKb` (default 256), `headLines` (default 200).

## State for the moddeck side bar
`{ plugin: 'big-file-guard', key: 'isOff' }` (boolean) and `{ plugin: 'big-file-guard', key: 'saved' }` (number).

## Limits
- The line total comes from the Read result when it reports one, otherwise it is estimated from the file size.
- The note is sent as extra context beside the result; tested with a mocked engine, not checked in a live session.
- The saving is an estimate (4 bytes per token), not a measured count.
