# repro-log

Install (Claude Code 2.1.295 or later): `/plugin install repro-log --marketplace samuelbfernandes/moddeck`

## What it does
Keeps a reproducibility recipe for data work. It watches Bash commands that succeeded (exit 0) and look like analysis
runs (python, Rscript, make, quarto, ...), plus the names of files Claude edits or writes, and keeps them in order
(last 200 per project, kept across sessions). `/repro` turns that into a Markdown file you can keep with your results.
It does not call a model and it never changes or delays a tool call.

## Use
- `/repro` writes `.moddeck/repro/<YYYY-MM-DD-HHMM>.md` in the project and replies with the path and three lines.
  The file has: date, git commit and a dirty flag, versions (`python3 --version`, `R --version`, `node --version`, only
  for programs that appeared), package and lock files found (name and sha256), random seeds seen (literal numbers only,
  e.g. `--seed 42`, `set.seed(7)`), the commands as a runnable shell block, and the changed files.
- `/repro status` says how many steps are recorded. `/repro clear` forgets them.
- `/repro on` and `/repro off` switch recording. The choice is remembered across sessions, and the moddeck side bar can
  read it. The `/` is required.

## Secrets
A command containing KEY, TOKEN, SECRET, `PASSWORD=`, `Bearer`, a key-like string (sk-..., ghp_..., AKIA...) or a
`user:pass@` URL is dropped, not recorded. `--password x` style arguments are masked as `***`. Files named like
`.env`, `*.pem`, `id_rsa` or with KEY/TOKEN/SECRET in the name are not listed. This is pattern matching: it can miss an
unusual secret, so read the file before you share it.

## Settings
- `enabled` (default on).
- `programs` (comma list): commands that count as analysis runs. Default
  `python,python3,Rscript,R CMD,jupyter nbconvert,quarto,snakemake,make,dvc,pytest,node,cargo run,julia,uv run`.
  Two-word entries match the first two words.
- `maxSteps` (default 200): only the last this many steps are kept.

## Limits
- Only commands Claude runs through the Bash tool are seen, not what you run yourself or what a script runs inside.
- The command list is what was run, in order, not a cleaned pipeline; steps that depended on files outside the project
  or on the environment may not replay as is. Environment variables and working directory changes are not recorded.
- Edit and Write give file names only, no content. Files changed by a shell command are not listed.
- Not verified live: real git, `R` and `shasum` output, and the side bar reading `isOff`. Tested with a mocked engine.

## Related
`replay-theater` shows the diffs of the session's edits; `repro-log` records how to re-run the analysis.
