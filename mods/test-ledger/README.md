# test-ledger

Install: `/plugin install test-ledger --marketplace samuelbfernandes/moddeck`

A running list of the checks Claude ran this session (tests, linters, builds, formatters, type checks), with pass or
fail, so you can see at a glance whether "the tests pass" was ever actually run.

## What it does
- Watches the Bash tool only. After a command finishes, it records it when it is a test, lint, build, format or check
  command: kind, the tool recognised, pass or fail (with the exit code when the result names one), the time it ended
  and how long it took.
- Recognises, among others: `pytest`, `python -m pytest`, `tox`, `nox`, `ruff check` / `ruff format`, `mypy`,
  `pyright`; `Rscript -e` with `devtools::test()`, `testthat::test_*()`, `devtools::check()`, `rcmdcheck`, `lintr`,
  `R CMD check`, `air format`, `jarl`; `cargo test` / `clippy` / `build` / `fmt` / `check`; `npm`, `pnpm`, `yarn`
  and `bun` test, build and lint scripts, `vitest`, `jest`, `eslint`, `prettier`, `biome`, `tsc`; `make test`;
  `quarto render` / `check`; `go test` / `vet` / `build`. Wrappers such as `uv run`, `poetry run`, `npx`,
  `FOO=1 cmd` and `cd dir && cmd` are seen through.
- Keeps the last 40 in memory for this session only. Before a command is kept, obvious secrets in it (`ghp_...`,
  `sk-...`, `AKIA...`, `Bearer x`, `password=...`, `--token x`, a password in a URL) are replaced by `***`, and it is
  cut to 200 characters.
- Never blocks or changes a call: the model gets every result exactly as it came back. A call that was refused is not
  recorded (it never ran).

## Use
    /test-ledger           open the pane (newest first, with a Clear button) and print a one-line summary
    /test-ledger status    the summary only
    /test-ledger clear     empty the list
    /test-ledger off       stop recording (remembered across sessions);  /test-ledger on  resumes

## Turn off
`/test-ledger off`, or `/plugin disable test-ledger`.

## State for the moddeck side bar
`{ plugin: 'test-ledger', key: 'runs' }` (the last 40 runs, oldest first: `kind`, `tool`, `command`, `status`
'pass' | 'fail' | 'background', `exitCode`, `at`, `ms`) and `{ plugin: 'test-ledger', key: 'isOff' }` (boolean).
`$.store` holds only `off`.

## Limits
- Pass and fail are the Bash call's own: "fail" means the engine marked the result as an error (a non-zero exit) or the
  command was interrupted. A pipe hides the exit code (`pytest | tail` passes when `tail` does), and a test runner that
  exits 0 with failures counts as a pass.
- A command moved to the background is recorded as `background`; its outcome is not followed.
- Recognition reads the command text; a check hidden in a script (`./run-tests.sh`) is not seen. Commands run outside
  Claude's Bash tool (in your own terminal, say) are not seen; a subagent's Bash calls are.
- Secret scrubbing catches the common shapes only; it is a safety net, not a guarantee.
- Tested with a mocked engine (`claude plugin test`); not yet checked by hand in a live session.

## Credit
Adapted from test-ledger in [awesome-claude-code-mods](https://github.com/whyashthakker/awesome-claude-code-mods) (MIT,
© 2026 Yash Thakker and contributors). Rewritten for moddeck: upstream only recognised pytest, jest and vitest (and a
bare word match); this version knows the Python, R, Rust, JavaScript, make and Quarto tools listed above, records pass
or fail with exit code, time and duration, scrubs secrets, keeps the list in `$.state`, adds Clear and an on/off
switch, and has tests. The upstream licence is in `LICENSE`.
