# toolbox

Install (Claude Code 2.1.295 or later): `/plugin install toolbox --marketplace samuelbfernandes/codeUIstack`

A side bar beside the chat with the toolkit's mods and skills.

## What is in it
- **Tools**: every mod, one boxed row each. A mod with an on/off switch (`aside`, `suggest`, `reflect`, `secret-guard`) is a
  green row when on and red when off; click it to flip it at once (it runs that mod's own `on` / `off` command and shows
  the reply as a toast). Only switches this side bar can read are coloured; a mod that is not installed does not appear.
  The **skin** row is a dropdown of the tool-skins themes (always listed; picking one switches at once with `/skin <name>`).
  Every other row is clickable and puts its command in the prompt box (for example `branch-janitor`, `usage`); rows
  for mods that run by themselves (`blast-radius`, `review-cost`) say when they appear.
- **Skills**: one boxed row each; a click puts the request in the prompt box.
- **Options**: below, under each mod's name and indented, the extra forms of its command (`reflect` → `status`,
  `cache-tax` → `/keepwarm 90m`, `branch-janitor` → `clean`, ...). A click puts it in the prompt box; nothing is sent
  until you press Enter.
- A `$` marks what spends model tokens (aside, reflect, `/keepwarm`).

## Use
It opens by itself at session start where the screen can dock it (fullscreen terminal, desktop app), once per session.
Type `toolbox` (or `tools`) alone to show or hide it; `/toolbox` does the same. The word is handled locally and never sent.

## Settings
`autoOpen` (default on).

## Limits
- It reads the other mods' switches from their own state; if Claude Code refuses that read, the switch is not drawn
  (the Tools items still work).
- Never verified live: the pane, the dropdown and filling the prompt box were tested against Claude Code's simulated engine only.
