# data-guard

Asks once before a `git commit` or `git add` takes in the wrong things for a data project. No model calls, no cost.

## What it checks

When a Bash command runs `git commit` or `git add` (also inside `&&` chains), data-guard looks at what would be committed: the staged files (`git diff --cached`), the modified tracked files for `commit -a`, and for `git add` the files it names, or `-A`, `.`, `-u` (`git status`). It flags:

1. **Large files**: over `maxFileMb` (default 5 MB).
2. **Data files**: csv, tsv, parquet, feather, rds, rdata, h5, hdf5, xlsx, xls, sav, dta, sqlite, db, pkl, npy, npz, zip, gz, unless `.gitignore` ignores them or `.gitattributes` sends them to git lfs.
3. **Personal-looking columns** in csv/tsv files up to 4 MB: column names like email, ssn, dob, birth, phone, address, patient, mrn, ip_address, or first/last/full name. Only the column names are shown, never a value.
4. **Notebooks** (.ipynb) staged with outputs or execution counts.

Nothing found: the command passes silently. Otherwise one dialog: **Hold it** (default; Esc also holds), **Commit anyway**, **Fix it** (holds and tells the model what to do), and, when notebooks are involved, **Strip outputs**. Strip outputs rewrites the working copy of those notebooks without outputs and execution counts (indent 1, trailing newline, as nbformat does), runs `git add` on them, and lets the command continue. If other findings remain it still holds the command. Note that `git add` stages the whole working file, including unstaged edits to it.

## Command

`/data-guard [on|off|status]` shows the settings and this session's counts (checked, asked, held, notebooks stripped). on/off is remembered, and mirrored in the state atom `data-guard.isOff` (boolean, default false) so the moddeck side bar can show it.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `enabled` | true | Master switch. When false, `/data-guard on` cannot override it. |
| `maxFileMb` | 5 | Large file limit in MB. |
| `checkNotebooks` | true | Check .ipynb outputs. |
| `checkColumns` | true | Check csv/tsv header names. |

## What it never does

- Never logs, stores or shows file contents. A first line (or a notebook's JSON shape) is read only to look at column names or outputs, then dropped. The dialog shows paths, sizes and column names.
- Never writes anything except the notebooks you choose to strip, and runs only read-only git commands (`rev-parse`, `diff`, `status`, `check-attr`, `check-ignore`, `cat-file`, `show`), with short timeouts, plus `git add` on stripped notebooks.
- Never blocks git because it broke: any error or timeout lets the command through untouched. A dialog with nobody to answer it (a `-p` run) holds.

Limits: it reads the command text, so `git -C other-dir commit` is checked against the session folder, and anything built by a script or alias is not seen.
