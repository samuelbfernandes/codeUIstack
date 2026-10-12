# checkpoint

Install (Claude Code 2.1.295 or later): `/plugin install checkpoint --marketplace samuelbfernandes/moddeck`

## What it does
One-click safety snapshots of your working tree, untracked files included, that never touch your branch, your
index or your stash list. A snapshot is a git commit kept under `refs/moddeck/checkpoints/<name>`, built with git
plumbing in a temporary index (`add -A`, `write-tree`, `commit-tree`, `update-ref`). It never runs stash, reset
--hard, clean or a checkout of your branch. No model is called.

## Use
- `/checkpoint [name]` saves a snapshot. The default name is `cp-YYYYmmdd-HHMMSS`. A name is lowercase letters,
  digits and hyphens (up to 60); `list`, `diff`, `restore`, `drop` and names starting `auto-` are reserved.
- `/checkpoint list`: name, age and how many files differ from the working tree now. Newest first, at most 20.
- `/checkpoint diff <name>`: `git diff --stat` between the snapshot and the working tree.
- `/checkpoint restore <name>`: asks first. The dialog lists the files that differ from the snapshot and would be
  lost (counts, and the first 8 names). Options: `Snapshot first, then restore` (the first, recommended; makes
  `before-restore-<time>` so you can undo), `Restore`, `Cancel`. Esc, a dismissed dialog or any other answer is a
  cancel and changes nothing.
- `/checkpoint drop <name>`: asks, then deletes the snapshot ref only.
- The `/` is required: a bare `checkpoint` goes to the model like any prompt.

## What restore touches
Only files named in the dialog. Files that differ are written back with `git restore --source=<snapshot>
--worktree` for exactly those paths; files that are untracked now and not in the snapshot are removed
(`rm`, one by one); ignored files are never looked at. Your index, branch and stash stay as they are, so a file you
had staged still shows as staged. Empty folders are left behind.

## Automatic snapshots
Setting `autoBeforePrompt` (off by default): at the first prompt of a turn that follows file changes, a snapshot
`auto-<time>` is made from a timer after the prompt has gone in, so it never blocks or delays you. Nothing is made
when the tree equals HEAD or the newest snapshot. Only the newest `maxAuto` (10) automatic snapshots are kept; your
own named snapshots and `before-restore-*` copies are never deleted automatically.

## Settings
- `enabled` (default on).
- `autoBeforePrompt` (default off).
- `maxAuto` (default 10).

## moddeck
The number of saved snapshots in the repository is mirrored into the atom `{ plugin: 'checkpoint', key: 'count' }`
(a number), set at session start and after every change.

## Limits
- Snapshots live in the repository's own object store (`.git`). Deleting the repository deletes them. They are not
  pushed anywhere unless you push `refs/moddeck/*` yourself.
- Ignored files (`.gitignore`) are not in a snapshot. Very large untracked files are hashed into `.git`.
- Not a git repository: it says so and does nothing. Any error becomes one plain message; nothing is blocked.
- Windows removal of untracked files uses `cmd /c del`; that path is untested.

## Tests
`claude plugin test .` runs the stubbed tests. `node tests/run-integration.mjs` (Node 22.15 or later, or
`bun tests/real-git.integration.ts`) runs the same code against real temporary git repositories; it is kept out of
the default test glob because the test sandbox has no process access.
