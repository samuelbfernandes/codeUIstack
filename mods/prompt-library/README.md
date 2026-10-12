# prompt-library

Install (Claude Code 2.1.295 or later): `/plugin install prompt-library --marketplace samuelbfernandes/moddeck`

## What it does
Keeps your saved prompts, per project, one click away. It has no pane of its own: the moddeck side bar reads the
list and draws it. Nothing is ever sent for you and no model is called.

## Use
- `/prompts` or `/prompts list`: numbered list, name and the first 60 characters.
- `/prompts add <name> | <prompt text>`: save one. The name is one word of lowercase letters, digits and hyphens
  (1 to 24 characters); the text is at most 4000 characters. A name already in use is refused.
- `/prompts use <name>`: puts the text in the prompt box. You press Enter. If the box cannot take it, it says so
  and you type it yourself.
- `/prompts rename <old> <new>` and `/prompts remove <name>`.
- The `/` is required.

## Starters
The first time a project has no saved list you get four: `explain`, `tests`, `review`, `eda`. Remove them and
they do not come back.

## Settings
- `enabled` (default on).
- `maxItems` (default 50): adding past this is refused.

## For other mods
The list is the state value `{ plugin: 'prompt-library', key: 'items' }`, an array of `{ name, text }`, loaded
at session start. Read it with `$.state.get`.

## Limits
- Saved in the plugin store under `items:<project folder>`; if the folder cannot be read, one shared list is used.
- Changes made to the store by hand are picked up the next time you type a `/prompts` command.
