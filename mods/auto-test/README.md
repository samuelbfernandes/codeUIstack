# auto-test

Install (Claude Code 2.1.295 or later): `/plugin install auto-test --marketplace samuelbfernandes/moddeck`

## What it does
Runs your project's tests once at the end of a turn in which Claude edited files (Edit, Write or NotebookEdit),
and shows the result: a toast `auto-test · passed (12s)` or `auto-test · FAILED`. On a failure the last 40 lines of
the output are also printed in the transcript, each on its own line so they can be copied. It is **off until you turn
it on**, because running tests costs time. Nothing is sent to the model, so it costs no tokens.

## Use
- `/auto-test on` / `/auto-test off`: the switch. It is remembered across sessions.
- `/auto-test run`: run the tests now (works while the switch is off).
- `/auto-test status`: on or off, the command in use and where it came from, the last result and when.
- `/auto-test command <cmd>`: use this command for the current project (remembered). `/auto-test command` shows it;
  `/auto-test command reset` goes back to detecting. Your command runs through `sh -c`.
- The `/` is required: a bare `auto-test` goes to the model like any prompt.

## Which command it runs
In order: the project command above, the `command` setting, then what the project root looks like:
- `pytest.ini`, `pyproject.toml`, or `tests/` beside `setup.py`, `setup.cfg` or `requirements.txt`: `python3 -m pytest -q`
- `package.json` with a real `test` script: `npm test`
- `Cargo.toml`: `cargo test`
- `DESCRIPTION`: `Rscript -e 'devtools::test()'`
- `go.mod`: `go test ./...`

If none matches it says so once and does nothing.

## Settings
- `enabled` (default on): off makes the command do nothing.
- `command` (default empty): a test command used instead of the detected one.
- `timeoutSec` (default 120, 5 to 600): a longer run is stopped.
- `tellModel` (default off): when on, a failed run also adds a short note with the output tail to the conversation, so
  Claude can fix it when you next write. The note is not sent by itself; it rides along with your next message.

## Never in the way
A missing runner, a timeout or any error shows `auto-test · could not run: <why>` once and the turn goes on. A pytest
run that finds no tests, and a "command not found", count as could not run, not as a failure. An interrupted turn
waits: its edits are tested when a later turn ends normally. Subagent turns do not start a run.

## For the moddeck side bar
Atoms `{ plugin: 'auto-test', key: 'isOff' }` (boolean, true while off, the default) and
`{ plugin: 'auto-test', key: 'last' }` (`'idle' | 'running' | 'pass' | 'fail'`).

## Limits
- One run at a time; a turn that ends during a run queues exactly one more.
- The output is the test runner's stdout then stderr; very long lines are cut at about 4000 characters in all.
- Not verified live: a real timeout (the test kit cannot make the engine reject `$.process.run`, so the wording
  `timed out after ...` is only unit tested), Windows (the override runs through `sh -c`), and how the failure
  note from `tellModel` reads to the model.
