# moddeck

Install (Claude Code 2.1.295 or later): `/plugin install moddeck --marketplace samuelbfernandes/moddeck`

A side bar beside the chat with a live **Session** box on top, then the toolkit's mods and skills.

## The Session box (top of the side bar)
Like a status line, but inside the pane: it needs no status line and never touches `$.ui.status`. It is drawn only from
figures the engine gives; a figure that is missing is not drawn (never as zero), and with nothing known the box is simply
absent and the side bar is exactly the old one. Nothing here sends a prompt or calls a model. Each row can be hidden.

| row | what it shows | where it reads |
| --- | --- | --- |
| `model` | model name, provider (Bedrock, Vertex, Foundry, or a custom base-URL host), effort, session length (`1h 12m`) | `turn.step` (`model`, `effort`), else `$.config.list()` / `$.session.model()`; `$.env` / `$.settings.read().env`; `usage().startedAt` |
| `context` | bar, percent, `tokens/window`; green, yellow from 70%, red from 85%; from 85% also the three biggest categories | `session.measure` / `$.session.usage()`; the breakdown is `breakdown: 'summary'` (local estimate, never `'full'`) |
| `usage` | one bar per rate-limit window (`5h`, `7d`, other kinds by name) with percent and `resets in 1h 30m`; the 7d window only from `usageSevenDayAt` % | `rateLimits` |
| usage pace | a `▲` (amber, red) when, at the burn rate so far (percent used over the elapsed share of the window: 5h or 7d), the window reaches 90% (amber) or 100% (red) before it resets; under 10% used stays neutral | `hooks/pace.ts` |
| `cost` | session `$x.xx`, plus `Today $x` and `Week $x` | `usage().cost`; atom `budget-guard.ledger` `{ today, week }` (nothing drawn when absent) |
| `cache` | `Cache until 14:30` (a clock time: the pane does not repaint between turns), `Cache expired`, `hit 87%` | atom `cache-tax.cache` `{ expiresAt, hitRate }` (nothing drawn when absent) |
| `git` | branch with `*` when dirty, `↑2 ↓1`, `!3 +1 ✘0 ?2` (modified, added, deleted, untracked), `⎇ name` in a linked worktree; ahead turns to the warning colour from `pushWarn` | read-only `git status --porcelain=v2 --branch` and `rev-parse`, at session start and after each turn; not a repository: no row |
| `tokens` | session in / out / cache totals and the last turn's output speed | `turn.complete` `usage` and `durationMs` (speed is output over the whole turn's time, so tool time makes it read low) |
| `activity` | the last few tool calls (`✓ Read ×3 · ◐ Edit auth.ts`, running vs done), skills used, MCP servers used, `Compactions: 2` (after the first) | `tool.call` before and after `next`, `session.compact` |
| `environment` | counts of CLAUDE.md files (project up to home, plus `~/.claude/CLAUDE.md`), rules, MCP servers, hooks, plugins; shown when the total reaches `envThreshold` | `$.fs`, `$.tool.list()`, `$.settings.read()` |

`/moddeck rows list | hide <id> | show <id> | compact | expanded` changes what the box shows and keeps it between sessions
(in the plugin's store, keys `rows` and `layout`); an unknown word prints a short help and changes nothing. `/moddeck` alone
still shows or hides the pane. `expanded` is one row per line; `compact` joins rows with ` │ ` on as few lines as fit.

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
`/moddeck` shows or hides it; `/moddeck rows ...` sets the Session box. Commands are always typed with their `/`; a bare word is an ordinary prompt.

## Settings
`autoOpen` (default on), `skillRows` (4), `showSession` (true), `sessionLayout` (`expanded` or `compact`), `sessionRows` (comma list of
row ids in display order, default `model,context,usage,cost,cache,git,tokens,activity,environment`; ids left out are hidden),
`usageSevenDayAt` (80), `toolsMaxVisible` (4), `pushWarn` (5), `envThreshold` (0 = always). What `/moddeck rows` saved wins over
`sessionRows` and `sessionLayout`.

## Limits
- It reads the three switches and tool-skins' theme from the mods' own state; if Claude Code refuses that read, the switch
  is not drawn (the other rows still work).
- Every Session box figure comes from the engine's typed API, but none was seen in a live session: the hooks are only
  observers (they let each event through first and keep their books in `try/catch`), and each failing source drops only its row.
- The `cost` and `cache` rows need `budget-guard` and `cache-tax` to publish their atoms; without them those parts are not drawn.
- The session name is not given to mods by the engine, so the environment row does not show one.
- Never verified live: the pane, the dropdown and filling the prompt box were tested against Claude Code's simulated engine only.
