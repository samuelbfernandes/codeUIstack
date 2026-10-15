# branch-janitor

Install (Claude Code 2.1.287 or later): `/plugin install branch-janitor --marketplace samuelbfernandes/moddeck`

## What it does
Notices when the work a git branch was made for is finished, checks that deleting it loses nothing, and **offers** to
delete it. It never deletes without your click; the copy on the server is a separate, second question. "Finished" needs
proof: merged into the default branch, squash- or rebase-merged, or a merged GitHub pull request (needs `gh`). A branch
whose remote was deleted is only a "check first" note. An offered branch must also pass: not checked out anywhere, no
commits only it has, nothing unpushed, no stash made on it, tip recorded, not just created. A branch with an **open**
pull request is never offered: the list says `#42 still open`. Each question says how to get the branch back (`git branch <name> <sha>`). The first answer, Keep, is the safe one.

## Use
Nothing to type. Every prompt costs one quick `git for-each-ref`; only if your branches changed does it look properly,
so a merge done in a plain terminal is noticed on your next prompt. It also looks after Claude's own `git merge/pull/push/fetch` and `gh pr merge` at once (no waiting), `git checkout/switch` and `remote prune` at most every `minMinutes`, and at session start. To look on demand, run a slash command:
- `/branch-janitor` lists every branch and deletes nothing. With `gh`, it ends with one line per local branch that has an open pull request:
  `#42 open · checks passing · review approved · my-branch` (checks: passing, failing, pending, none; review: approved, changes requested, none).
- `/branch-janitor clean` scans now and offers. `/branch-janitor off` / `on` stops / resumes it in this repository.
`/plugin disable branch-janitor` turns it off everywhere.

## Settings and limits
`minMinutes` (30), `protectedBranches` (main, master, develop, dev, trunk, release/*, gh-pages; yours replaces it), `staleDays` (60).
Only `git`, and `gh` if installed (read-only `gh pr list`, 8 s each); no model calls. Pull request lines and protection need `gh`
installed **and** a `gh` command run by Claude in this repository (remembered); `gh` use in a plain terminal is not visible. It asks
`gh` for open PRs only for the report, `clean`, and just before a question would open, never for an unchanged repository.
No `gh`, not signed in or offline: the lines are silently left out. PRs match local branches by name only.
Not verified live: dialogs, `gh` against GitHub (field names follow gh's documented `--json` list), the desktop app. Nothing run on Windows.
`bun tests/real-git.integration.ts` runs the real-git scenarios.
