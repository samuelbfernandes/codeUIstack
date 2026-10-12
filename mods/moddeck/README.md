# moddeck

Install (Claude Code 2.1.295 or later): `/plugin install moddeck --marketplace samuelbfernandes/moddeck`

A side bar beside the chat with the toolkit's mods and skills.

## What is in it
- **Tools**: every mod, one boxed row each.
  - **suggest**, **reflect** and **secret-guard** are switches: green when on, red when off. They are the mods that work by
    themselves with no command, so their state is what matters. A click flips one at once (it runs `/<mod> on|off` and shows the
    reply as a toast). suggest's options (`status`, `explain a prompt`) sit right under it, indented, and show only while it is green.
  - **skin** is a dropdown of the tool-skins themes (always listed; picking one runs `/skin <name>` at once).
  - Every other row is a tool: a click runs its command at once (`/branch-janitor`, `/cache-tax`,
    `/budget-guard`, `/agents-info`, `/filetree`, `/replay`, `/diagram`; the first line of the reply is a
    toast, the whole reply goes in the transcript). Commands that need your text or change something (`/aside `,
    `/branch-janitor clean`, `/keepwarm 90m`) are put in the prompt box instead; nothing is sent until you press Enter.
  - A tool with only one task is just its row: no indented button repeats it. `branch-janitor` and `cache-tax` have two or
    more extra forms, so those sit under their rows. `blast-radius` and `review-cost` run by themselves and say when.
- A divider, then the **Skills**: one boxed row each; a click puts the request in the prompt box.
- A `$` marks what spends model tokens (aside, reflect, `/keepwarm`).

## Use
It opens by itself at session start where the screen can dock it (fullscreen terminal, desktop app), once per session.
`/moddeck` shows or hides it. Commands are always typed with their `/`; a bare word is an ordinary prompt.

## Settings
`autoOpen` (default on).

## Limits
- It reads the three switches and tool-skins' theme from the mods' own state; if Claude Code refuses that read, the switch
  is not drawn (the other rows still work).
- Never verified live: the pane, the dropdown and filling the prompt box were tested against Claude Code's simulated engine only.
