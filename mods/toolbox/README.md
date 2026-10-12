# toolbox

Install (Claude Code 2.1.295 or later): `/plugin install toolbox --marketplace samuelbfernandes/codeUIstack`

A side bar beside the chat with the toolkit's mods and skills.

## What is in it
- **Switches**: a pill per mod with an on/off switch, green when on and red when off (`aside`, `suggest`, `reflect`,
  `secret-guard`). Click a pill to flip it: it runs that mod's own `on` / `off` command at once and shows its reply as a toast.
  Only the switches this side bar can read are drawn; a mod that is not installed simply does not appear.
- **Skin**: a dropdown of the tool-skins themes. Picking one switches at once (`/skin <name>`). Shown when tool-skins is installed.
- **Tools** and **Skills**: click one to put its command in the prompt box (for example `branch-janitor`, `usage`, `/aside `).
  Nothing is sent until you press Enter.
- A `$` marks what spends model tokens (aside, reflect).

## Use
It opens by itself at session start where the screen can dock it (fullscreen terminal, desktop app), once per session.
Type `toolbox` (or `tools`) alone to show or hide it; `/toolbox` does the same. The word is handled locally and never sent.

## Settings
`autoOpen` (default on).

## Limits
- It reads the other mods' switches from their own state; if Claude Code refuses that read, the switch is not drawn
  (the Tools items still work).
- Never verified live: the pane, the dropdown and filling the prompt box were tested against Claude Code's simulated engine only.
