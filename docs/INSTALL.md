# Install

Pick a route. Whatever you pick, look first with `--plan`, and install a tagged version (replace `v0.1.0` with the release you want).

You need Claude Code 2.1.287 or newer (signed in), `git`, and for routes B to D Python 3.9 or newer.
On Windows install [Git for Windows](https://git-scm.com/download/win) (it runs the git guards).

## A. Mods only, with Claude Code's own plugin manager (no Python)

Inside Claude Code:

```
/plugin marketplace add samuelbfernandes/moddeck
/plugin install blast-radius@moddeck
```

Repeat the second line for each mod you want (`/plugin install` lists them). You get the mods; you do not get the rules,
git guards or the checklist of built-in features. Good for trying one tool.

## One line

No prior install, no questions (replace `v0.5.0` with the release you want):

```
pipx run --spec git+https://github.com/samuelbfernandes/moddeck@v0.5.0 moddeck install --standard
```

`--standard` is the recommended set; `--all` adds every mod and every rule, skill and git guard.
Built-in features and third-party plugins stay at their defaults in both. Add `--plan` to only look. With uv: `uvx --from git+https://github.com/samuelbfernandes/moddeck@v0.5.0 moddeck install --standard`.
Then start a new Claude Code session.

## B. Full installer with pipx or uv (recommended)

```
pipx install git+https://github.com/samuelbfernandes/moddeck@v0.1.0
moddeck install --plan      # look first
moddeck                     # then answer the questions
```

With uv: `uvx --from git+https://github.com/samuelbfernandes/moddeck@v0.1.0 moddeck install --plan`.
Once a release is on PyPI: `pipx install moddeck`.

## C. Plain pip, or conda

```
python -m venv ~/.moddeck-venv && ~/.moddeck-venv/bin/pip install git+https://github.com/samuelbfernandes/moddeck@v0.1.0
~/.moddeck-venv/bin/moddeck
```

Conda: `conda env create -f environment.yml && conda activate moddeck-installer && moddeck --plan`
(conda only supplies Python and pip; the installer has no dependencies).

## D. Download or clone, no installation of the installer

```
git clone --branch v0.1.0 https://github.com/samuelbfernandes/moddeck && cd moddeck
sh install.sh --plan            # macOS / Linux
install.cmd --plan              # Windows (double-clicking install.cmd also works)
```

## What it asks

1. **Where**: *everywhere* (every Claude Code session on this computer) or *one project* (only when Claude Code runs in that
   folder, on this computer, nothing added to the project's git history).
2. **Rule set**: neutral (default) or lab (strict).
3. Three checklists (mods; rules, skills and git guards; built-in features and official plugins). Each item shows what it does
   and what it costs in tokens. Items that need a program you do not have (Codex, rust-analyzer, Pyright) start unticked.
4. The plan, then a final yes or no.

Without questions: `moddeck install --yes` (defaults), plus any of `--scope project --project DIR`, `--profile lab`,
`--mods blast-radius,suggest-model`, `--with sandbox`, `--without filetree`, `--force-hooks`. `moddeck list` shows every id.

## Afterwards

Start a new Claude Code session, or run `/reload-plugins` in an open one.

| Command | What it does |
|---|---|
| `moddeck status` | what is installed, per scope |
| `moddeck verify` | installed files match the package? |
| `moddeck doctor` | which tools it can see (Claude Code, git, Codex ...) |
| `moddeck update` | re-apply your recorded choices after upgrading the package (`pipx upgrade moddeck`) |
| `moddeck uninstall [--scope project --project DIR]` | remove exactly what was installed there |
| `moddeck install` again | change your choices; what you un-tick is removed |

## Upgrading

Install the new version of the package (`pipx upgrade moddeck`, or unzip the new download), then run
`moddeck update` (from a download: `sh install.sh update`; for a one-project install add `--scope project --project DIR`).
It re-applies the choices you made last time and upgrades the installed mods. Start a new Claude Code session afterwards.

To remove everything: run `uninstall` for each scope you used, then remove the package (`pipx uninstall moddeck`).
