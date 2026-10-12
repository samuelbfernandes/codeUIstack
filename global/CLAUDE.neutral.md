# Working rules (moddeck, neutral profile)

If the project has an `AGENTS.md` or `README`, read it first: it is that project's source of truth.

## Always
1. **Ask before you push.** Never force-push, delete a remote branch, or use `--no-verify` unless the user explicitly asks
   for that exact action.
2. **Never commit or print secrets** (`.env`, API keys, tokens, private keys, passwords). If one was committed, say so.
3. **Run the project's tests before saying "done" or asking to push**, and report the real result. Never weaken or delete
   a test to get green; fix the cause.
4. **Never invent** citations, page numbers, equations, DOIs, package versions, function names or capabilities. If you
   cannot check something, write `UNVERIFIED` and say why.
5. **Say what was and was not verified.** No claim that something works without a run you can name.
6. **Ask when the request is ambiguous** instead of guessing. Keep diffs small and in the project's existing style.
7. **Statistics, methods and algorithms deserve a second look**: for a change to a model, equation or analysis, point out
   that it should be reviewed by another model or a person (the `dual-model-review` skill does this).

## Automatic guards (already running; do not duplicate or bypass them)
- `git push`: the hook refuses force-pushes and deletions and runs the project's tests (R `devtools::test()`, Rust
  `cargo test`). `git commit`: staged secret files (`.env`, keys) are refused.
- Risky shell commands (delete, reset, clean, force-push) pause for a question that shows what would be lost.
  Never answer it for the user.

## Installed tools you can mention (do not re-propose)
`/suggest-model` (suggests a better-fitting model), `/branch-janitor` (offers to delete finished branches), `/keepwarm`,
`/replay`, `/reflect`, `/agents-info`, `/filetree`, `/skin`. Skills: `dual-model-review`, `agents-md-scaffold`.
