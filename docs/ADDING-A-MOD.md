# Adding a mod

A mod is a Claude Code plugin made of function hooks. The repository is built so a new one needs no change to the installer.

## Files

```
mods/<name>/
  .claude-plugin/plugin.json    {"name": "<name>", "version": "0.1.0", "description": "...", "author": {"name": "..."}, "userConfig": {...}}
  hooks/hooks.json              {"modules": ["./register.tsx"]}
  hooks/register.tsx            export const register: Register = (on, options) => { ... }
  tests/*.test.ts(x)            import { test, expect } from 'claude-code/testing'
  README.md                     what it does, commands, how to turn it off, honest limits; one install line (see any other mod)
```

The folder name must equal the plugin name. Claude Code writes the API's type declarations next to a mod each time it loads it;
do not commit them (they are in `.gitignore`). Claude Code ships a `plugin-authoring` skill that explains the hook API.

## Steps

1. Create the folder and the files above. Run `claude plugin validate mods/<name>` often.
2. Write tests and run `claude plugin test mods/<name>`.
3. `python scripts/build_marketplace.py` adds it to `.claude-plugin/marketplace.json` (the installer's checklist reads that file).
4. `python scripts/audit.py --write`. If it fails, you started a program or used the network: see below.
5. Optional: add a row to `MOD_META` in `src/cctk/catalog.py` (token note, "needs codex", "start here"), a row in `docs/TOOLS.md`, an entry in `CHANGELOG.md`.
6. `bash scripts/check-all.sh` must end with `ALL CHECKS PASSED`.

## House rules

- **No network.** If a mod really needs it, say why in the pull request and add it to `ALLOW_NETWORK` in `scripts/audit.py`.
- **Start programs only as argument arrays** (`$.process.run(['git', ...])`), never as a shell string, and list each program in `ALLOW_PROGRAMS`.
- **Decide fail-open or fail-closed for every hook that can refuse something** and write the choice in a comment. Convenience features fail open.
- **Say what costs tokens.** A mod that asks a model something must say so in its README and in `MOD_META`.
- **Work on Windows and macOS**: no POSIX-only tools, no hard-coded paths.
- **Be honest in the README** about what was tested and what was not.
