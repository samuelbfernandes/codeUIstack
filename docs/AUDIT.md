# What each part can do (generated)

Produced by `python scripts/audit.py --write` and checked by CI. It greps source text for network use, programs started,
file writes and model use. It is a tripwire and a summary, not a proof: read the code too.

## Mods

| Mod | Network | Starts these programs | Writes files | Spends model tokens | Hooks into |
|---|---|---|---|---|---|
| auto-test | no | Rscript, npm, python3, sh | no | no | command.run, session.start, tool.call, turn.complete |
| big-file-guard | no | none | no | no | command.run, session.start, tool.call |
| branch-janitor | no | gh, git | no | no | command.run, prompt.submit, session.start, tool.call |
| cache-guard | no | none | no | yes | classic.SessionStart, command.run, model.fork, prompt.submit, session.end, session.start, turn.complete, turn.start, turn.step |
| checkpoint | no | cmd, git, rm | no | no | command.run, prompt.submit, session.start |
| command-guard | no | du, find, git | no | no | command.run, session.start, tool.call |
| concise | no | none | no | no | command.run, prompt.submit, session.compact, session.start |
| contrast-check | no | none | no | no | command.run, session.start, ui.render |
| data-guard | no | git | yes | no | command.run, session.start, tool.call |
| decision-log | no | none | yes | no | command.run, session.start, ui.render |
| diagram | no | none | no | no | command.run, session.end, session.start, turn.complete, ui.render |
| edit-replay | no | none | no | no | command.run, prompt.submit, session.end, session.start, tool.call, turn.complete, turn.start, ui.render |
| error-inbox | no | none | no | no | command.run, session.start, tool.call, ui.render |
| filetree | no | git | no | no | command.run, session.start, tool.call, ui.render |
| format-on-edit | no | none | no | no | command.run, session.start, tool.call |
| long-run-ping | no | none | no | no | command.run, prompt.submit, session.start, tool.call, turn.complete |
| moddeck | yes | git, pipx, uvx | no | yes | command.run, session.compact, session.measure, session.start, tool.call, turn.complete, turn.step, ui.render, ui.scroll |
| model-picker | no | codex | no | yes | command.run, prompt.submit, session.end, session.start, tool.call, turn.complete, turn.step |
| progress | no | none | no | no | agent.spawn, command.run, session.start, tool.call, turn.complete, turn.step, ui.render |
| prompt-library | no | none | no | no | command.run, session.start |
| reflect | no | none | yes | yes | command.run, prompt.submit, session.start, ui.render |
| repro-log | no | R, git, node, python3 | yes | no | command.run, session.start, tool.call |
| review-cost | no | git | no | no | command.run, session.start, tool.call, ui.render |
| scope-watch | no | none | no | no | command.run, session.start, tool.call |
| secret-guard | no | none | no | no | command.run, prompt.submit, session.append, session.start, tool.call |
| staged-diff | no | git | no | no | command.run, session.start, ui.render |
| table-preview | no | none | no | no | command.run, session.start, ui.render |
| test-ledger | no | none | no | no | command.run, session.start, tool.call, ui.render |
| tldr | no | none | no | yes | command.run, session.end, session.start, turn.complete, ui.render |
| ui-preview | yes | Rscript, shiny, streamlit | yes | no | command.run, session.end, session.start, ui.render |
| usage-meter | no | none | no | no | command.run, prompt.submit, session.end, session.measure, session.start, turn.complete, turn.start, ui.render |

"Writes files" means the mod can write through Claude Code's file API (reflect does, only when you press Save).
"Spends model tokens" means the mod can ask a model something itself (reflect: a small model once per correction; cache-guard: optional keep-warm pings; model-picker: only if you pick the subagent option).

## Shell scripts (git guards)

Checked for: curl, wget, nc, ssh, scp, telnet, eval, base64 -d, piping into a shell, sudo. None present.

- `global/githooks/_estimate.sh`
- `global/githooks/_lib.sh`
- `global/githooks/commit-msg`
- `global/githooks/pre-commit`
- `global/githooks/pre-push`
- `global/githooks/theory-review.sh`

## Installer (Python, standard library only)

Checked for: network modules (urllib, http.client, socket, requests ...), shell=True, os.system, eval/exec, dynamic imports.
Programs are started only in `src/cctk/proc.py`, always as an argument list and with a timeout.

- `src/cctk/__init__.py`
- `src/cctk/__main__.py`
- `src/cctk/catalog.py`
- `src/cctk/claudecli.py`
- `src/cctk/cli.py`
- `src/cctk/errors.py`
- `src/cctk/gitcfg.py`
- `src/cctk/installer.py`
- `src/cctk/payload.py`
- `src/cctk/proc.py`
- `src/cctk/settingsfile.py`
- `src/cctk/ui.py`
