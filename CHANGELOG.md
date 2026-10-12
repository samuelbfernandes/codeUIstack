# Changelog

## [0.4.1] - unreleased
- New mod **toolbox**: a side bar with every mod and skill. Switches (green on, red off) flip at once, a dropdown picks the skin, other items fill the prompt box. aside's and suggest-model's on/off moved there from the band above the prompt (suggest-model no longer draws anything above it); reflect now mirrors its switch so the side bar can show it.
- blast-radius: the risk level carries a coloured dot (🔴 high and unknown, 🟠 medium, 🟢 low).
- blast-radius: new `askFrom` setting (low, medium, high). The default, medium, runs low-risk commands without a dialog; unknown and unchecked commands always ask.
- cache-tax: the cold-cache dialog suggests the cheapest way forward (compact, start fresh, or send) and can put /compact or /clear in the prompt box.
- Renamed the mod model-fit to suggest-model (plugin id, command, plain words `suggest-model` / `suggest model`, settings key). Reinstall with `codeuistack install`.
- aside: a green/red on/off chip above the prompt (click it), plus `aside on` / `aside off` and `/aside on|off`; the choice is remembered.
- `install --standard` and `install --all`: one-line, no-questions installs (the recommended set, or every mod, rule, skill and git guard). suggest-model: the green/red chip is itself the button; the separate Turn on/off button is gone.
- `update` now switches on, at their default, any item added since the install being updated.

## [0.4.0] - unreleased
- New mods: **secret-guard** (hides keys, tokens, passwords and private keys from tool output and asks before a typed prompt contains one), **budget-guard** (a quiet usage line, an optional spending limit that asks, a `usage` report with cache hits and turn times), **diagram** (mermaid flowcharts, sequence diagrams and pie charts as box art, offline), **aside** (a side question in a pane, kept out of the conversation; off by default because it spends credit).
- savvy-progress 0.4.0: a task progress bar, a nested helper tree (`agents tree`), per-helper tool counts.
- cache-tax 0.5.0: the report shows the real cache hit ratio, last-turn tokens and total cold-write spend; the cold-cache dialog mentions `/keepwarm` once per session.
- branch-janitor 0.4.0: with `gh`, the report lists open pull requests with checks and review state, and a branch with an open pull request is never offered for deletion.
- Installer: Context7 is offered as an optional official plugin; mods that spend credit (aside) start unchecked.
- Fixed: only one mod could draw in the band above the prompt, so the others' rows (the suggest-model chip, Reflect's Save buttons, the replay hint, the helper and task bar, the usage line) could hide each other. A mod that draws now keeps whatever the mods below it drew underneath its own row (suggest-model 0.3.3, reflect 0.3.1, replay-theater 0.3.1, savvy-progress 0.4.0, budget-guard). Checked in the test harness only; the live engine is unverified.
- docs/SUGGESTIONS.md: interface mods checked on 2026-10-12 and what became of each.

## [0.3.3] - unreleased
- When a mod holds your prompt, the reason line now names it: "suggest-model blocked your prompt · ..." or "cache-tax blocked your prompt · ...". Claude Code's own red title above it still reads "A hook blocked your prompt" (a mod cannot change that title), so the first words of the reason say which mod it was.

## [0.3.2] - unreleased
- Fewer interruptions. cache-tax now asks in place with one small dialog (Send anyway / Hold it) instead of dropping the message and making you send it again; it only asks when the cold write costs at least `minExtraUsd` (default $0.25) more, and `onCold` can be `ask`, `stop` (the old one-line stop) or `off`. Because it no longer ends the prompt, suggest-model's own check still runs on the same message. branch-janitor's "Watching branches" line is now a short toast only, with no box left in the transcript.
- suggest-model: the green/red chip is a plain coloured label beside a separate Turn on / Turn off button, so the colour does not depend on how a surface draws a button.
- Upgrading: run `sh install.sh status`; every mod must show 0.3.x or later, then `sh install.sh update` and restart Claude Code.

## [0.3.1] - unreleased
- Installer: an official plugin that Claude Code does not list as offered is now still tried (the list can be incomplete); only a real install failure skips it, and the message gives the reason.

## [0.3.0] - unreleased
- Every box shortened and restyled (headline first, quiet symbols, plain labels): blast-radius, review-cost, suggest-model, branch-janitor, cache-tax, reflect, filetree, replay-theater, tool-skins.
- Fixed the garbled "�" in "A hook blocked your prompt": a dropped prompt's reason must be one line. Plain-word replies and cache-tax's cold stop now put a one-line headline in that box and any detail in a dim transcript note.
- suggest-model: the on/off control is a coloured pill, green when on and red when off.
- savvy-progress: a Stop button on every running helper in the pane (uses Claude's TaskStop tool).
- blast-radius: `maxListed` default is now 5 (the dialog is shorter).

## [0.2.3] - unreleased
- suggest-model: the ON/OFF row no longer embeds what the engine draws in the band (a tree the engine refuses is dropped silently, which showed no button); it is now a plain self-contained row. While off, the status line says `suggest-model: OFF (type suggest-model on to resume)`, so the state is visible even where the band is not drawn. README gained a "No button?" checklist.

## [0.2.2] - unreleased
- suggest-model: an ON/OFF button in the band above the prompt box (the lowest slot under the chat; terminal and desktop). One press turns checking on or off; it shares one switch with `suggest-model on|off` and `/suggest-model`, remembers the choice across sessions, stacks under other bands instead of replacing them, and hides during a survey or dialog. Setting `showButton` (default true) removes it.

## [0.2.1] - unreleased
- suggest-model: a mismatch at or above the confidence bar now ALWAYS blocks the prompt and opens the dialog. Removed the cooldown, the "same situation as the previous question" skip and the raised bar after dismissals. Esc holds the prompt (not sent, echoed back in full) instead of sending it; `onDismiss = send` restores the old behaviour. New `askOnStandard` setting (off by default) makes ordinary-task hints block too. The status line still updates on every checked prompt.

## [0.2.0] - unreleased
- blast-radius: Folder risk report for every folder a held command would delete (what it is, content by kind, size, recency, what git could restore, "Recoverable: yes / partly / no"); a clean fully-pushed repository root is now LOW.
- suggest-model: checks every prompt; names the risk ("Don't use X for this task" / "X is overkill"); per-model fit and relative-cost table with a best-fit-per-cost recommendation; always-on status line; Codex still offered for review requests.
- branch-janitor: looks automatically after every prompt when the repository changed (including merges done outside Claude Code); declined branches are not re-offered until they move.
- Plain-word commands (no "/"): `branch-janitor`, `suggest-model`, `cache-tax`, `agents-info`, `replay`, `filetree`, `skins`, `reflect status`, handled locally and never sent to the model. `/keepwarm` stays slash-only because it costs tokens.
- filetree opens by itself where there is room; replay-theater hints after a turn that changed 3+ files.
- Installer: `update` re-applies recorded choices and upgrades installed mods.

## [0.1.0] - first draft
First public version.
- Ten mods: blast-radius, branch-janitor, cache-tax, filetree, suggest-model, reflect, replay-theater, review-cost, savvy-progress, tool-skins.
- Two skills: dual-model-review, agents-md-scaffold.
- Git guards: secret-file refusal, force-push and remote-delete refusal, tests before push, optional second-model review.
- Python installer (standard library only): everywhere or one project, plan mode, per-item checklists, Codex detection,
  hardened settings, sandbox, official plugins, exact uninstall, verify.
- Capability audit (`scripts/audit.py`, `docs/AUDIT.md`), release script with checksums, CI workflow (unconfirmed on a hosted runner).
