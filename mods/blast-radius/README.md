# blast-radius

Install (Claude Code 2.1.287 or later): `/plugin install blast-radius --marketplace samuelbfernandes/codeUIstack`

## What it does
Holds risky Bash commands and shows what they would destroy before they run. The question opens with one line, the risk as a plain word and what is about to happen, then the command, a few short rows and two answers: **Cancel** (first, so Enter means no) and **Proceed**. Cancel, Esc, free text, a dismissed dialog or a headless run all refuse, and the model is told why. **A safety net, not a permission system:** it only adds a question and never approves anything; keep your normal permissions on.

```
🔴 High risk · deletes data/
rm -rf data

Where        Inside repository /Users/sam/thesis
Contains     2 data files (211 MB) · 1 likely secret file (4 KB) · 1 source file
Size         212 MB · 4 files · last edit within 6 hours · likely active work
Git          4 untracked files
At stake     raw.csv (207 MB), fit.rds (3.9 MB), .env (4 KB)
Recoverable  No · untracked files cannot be restored

Estimated from file names and your last fetch.

Run this command?
```

Other commands read the same way:

```
🔴 High risk · discards uncommitted changes in 3 files
git reset --hard origin/main

Impact       Uncommitted changes to 3 tracked files, gone for good (not in the reflog)
Changes lost
  M  R/a.R
  D  b.R
  M  c.R
Total        3 files changed, 10 insertions(+), 4 deletions(-)
Note         Untracked files are not touched

Run this command?
```

The level is **High**, **Medium**, **Low** or **Unknown** (Unknown: something could not be checked, and the row says what). Lists show a few rows and "+N more". A line with several risky commands gets one short section each.

Held: `rm -r/-f` (also `rm *.csv`, `xargs rm`), `find -delete|-exec rm`, `git clean -f`, `reset --hard`, `checkout .`/`restore .`, force `push`, `branch -D`, `stash drop|clear`, `truncate`, `shred`, `dd of=`, `mkfs`, `chmod|chown -R`, `cargo clean`, `mv|cp -f` onto existing files or folders, `> file` over a non-empty file, SQL `DROP`/`TRUNCATE`/`DELETE` without `WHERE`, and `R -e` `unlink(recursive=TRUE)`. It sees through `sudo`, quoting, `;` `&&` pipes, `bash -c`, `$(...)` and `cd /abs && ...`.

## Folder rows
For a folder a held command would delete, overwrite or change recursively, the dialog adds these rows (up to 3 folders, the most dangerous first; with several folders each gets its own short block):
- **Target:** only for the places that are never routine: `/`, your home, Desktop/Documents/Downloads, the working directory or a parent of it. Those are always High.
- **Where:** the root of a git repository (its history goes too), a folder inside one, or outside git. **Local only** adds commits on no remote, stashes and linked worktrees when a repository root would go.
- **Contains**, guessed from file names only: build/cache output (`node_modules`, `target`, `build`, `dist`, `__pycache__`, `.venv`, `renv/library`, `*.Rcheck`, `.Rproj.user` ...), source, data that is hard to regenerate (csv, rds, vcf, bam, parquet, xlsx, pdf, tex ...), likely secrets (`.env`, `*.pem`, `id_*`).
- **Size:** bytes, file count and the last edit ("within 6 hours" is flagged as likely active work).
- **Git:** pushed, not pushed, modified, untracked, ignored. **At stake** names the biggest hard-to-regenerate files.
- **Note:** synced folders (iCloud Drive, Dropbox, OneDrive, Google Drive), symlinks (rm removes the link, not its target), another filesystem inside.
- **Recoverable:** `Yes`, `Partly`, `No` or `Unknown`, with the reason. It sets the level: only build output or a fully pushed folder is Low; irreplaceable data or unpushed work is High.

## Settings and turning off
`/plugin` > blast-radius: `maxListed` (rows shown under a list, default 5), `extraPatterns` (regexes; a matching command is held, nothing measured). Turn off: `/plugin disable blast-radius`.

The level carries a coloured dot, since the dialog takes plain text only: 🔴 high, 🟠 medium, 🟢 low, and 🔴 unknown (a folder that could not be checked counts as red).

## Limits
- Read-only probes (`git`, `find`, `du`; no shell, no network), each with a timeout; a folder scan classifies at most 3,000 files ("sampled" is said) and stops at the first timeout. If a probe fails the command is still held and a **Not checked** row says why.
- The folder rows are a name-based guess: it cannot know about Time Machine or other backups, what a sync service or a remote still holds, or whether a "build" folder really is disposable. "Pushed" is as of your last fetch. A mount point is only noticed when it sits inside the folder.
- Not seen: `make clean`, scripts (`Rscript x.R`), `rsync --delete`, `ssh host rm`, SQL files, aliases. Relative paths use the session directory; an earlier `cd` may be missed.
- Native Windows: nothing is measured (the probes are Unix `find`/`du`); a risky command is held with a note to check the path yourself, and there are no folder rows. Nothing has been run on Windows.
- Not verified live: how the question dialog wraps a long listing; macOS `find`/`du` were not run (only GNU ones, `bun tests/real-folder.integration.ts`).
