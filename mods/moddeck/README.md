# moddeck

Install (Claude Code 2.1.295 or later): `/plugin install moddeck --marketplace samuelbfernandes/moddeck`

A side bar beside the chat with a live **Session** box on top, then the toolkit's mods and skills.

## The Session box (top of the side bar)
Like a status line, but inside the pane: it needs no status line and never touches `$.ui.status`. It is drawn only from
figures the engine gives; a figure that is missing is not drawn (never as zero), and with nothing known the box is simply
absent and the side bar is exactly the old one. Nothing here sends a prompt or calls a model. Each row can be hidden.

| row | what it shows | where it reads |
| --- | --- | --- |
| `model` | model name, provider (Bedrock, Vertex, Foundry, or a custom base-URL host), effort (with a yellow `⚠ medium would do` / `⚠ try high` when suggest-model's effort-watch says it does not fit the last task), session length (`1h 12m`) | `turn.step` (`model`, `effort`), else `$.config.list()` / `$.session.model()`; `$.env` / `$.settings.read().env`; `usage().startedAt` |
| `mode` | the configured permission mode in plain words, only when it is not the ordinary one (`plan mode`, `auto mode`, `accepts edits`, red `permissions bypassed !`). The mode Shift+Tab switches to mid-session is not readable by a mod, so this is the one in the settings (or a config row) | `$.settings.read()`, `$.config.list()` |
| `backup` | time since the newest commit or checkpoint, and files unsaved: green when the tree is clean or the save is recent, amber from 2 h with files unsaved, red from 8 h (`/rewind` covers only Claude's own edits); `none · 3 unsaved` when nothing was ever saved | read-only `git log -1`, `git for-each-ref refs/moddeck/checkpoints`, at start and after each turn |
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
One column at every width: a top bar (title and an expand button that reopens the pane wider, and again narrower), the Session
card, then **Tools** in grouped cards. Each plugin is one row: icon, name and a short description on the left, its control on
the right, and its action buttons (blue, `[like this]`, wrapping inside the row) underneath. The descriptions, icons and groups
are presentation only (`hooks/catalog.ts`); no command or state changed.
- **Prompt helpers**: **suggest** and **reflect** are switches (a pill: green `on ●`, gray `● off`). A click runs
  `/<mod> on|off` at once and shows the reply as a toast. suggest's actions (`status`, `explain a prompt`) show while it is on;
- **Guards**: secret-guard, data-guard, big-file-guard, repro-log (its `write the recipe` and `status` show while on).
- **Automation**: auto-test (`run the tests now`, `status` while on), long-run-ping.
- **Model controls**: blast-radius (`off|low|medium|high`) and review-cost
  (`on|off`) as dropdowns that read the mod's own level.
- **Workspace utilities**: checkpoint, branch-janitor, cache-tax, budget-guard, savvy-progress, filetree, replay-theater,
  diagram. Clicking the name runs the command (`/checkpoint`, `/cache-tax`, `/budget-guard`, ...; the first line of the reply
  is a toast, the whole reply goes in the transcript). Commands that need your text or change something (`/branch-janitor clean`,
  `/keepwarm 90m`, `/checkpoint restore `) are put in the prompt box; nothing is sent until you press Enter.
  budget-guard keeps its old behaviour (a click shows its report); it is not a switch.
- A card with no readable row is not drawn (a mod that is not installed has no row). **Skills** and **Prompts** are cards too.
- A `$` marks what spends model tokens (reflect, `/btw`, `/keepwarm`).

## Use
It opens by itself at session start where the screen can dock it (fullscreen terminal, desktop app), once per session.
`/moddeck` shows or hides it; `/moddeck rows ...` sets the Session box. Commands are always typed with their `/`; a bare word is an ordinary prompt.

## Settings
`autoOpen` (default on), `skillRows` (4), `showSession` (true), `sessionLayout` (`expanded` or `compact`), `sessionRows` (comma list of
row ids in display order, default `model,context,usage,cost,cache,git,tokens,activity,environment`; ids left out are hidden),
`usageSevenDayAt` (80), `toolsMaxVisible` (4), `pushWarn` (5), `envThreshold` (0 = always). What `/moddeck rows` saved wins over
`sessionRows` and `sessionLayout`.

## Limits
- The pane is a terminal/desktop pane (boxes, text, buttons, dropdowns), not HTML: the switch is a coloured pill button, the
  switch has no `role="switch"` (the pane has no such property; the button carries a label such as `secret-guard switch, on`),
  and keyboard focus is the engine's own. The expand button's resize is a close and reopen at another width; if there is no
  room it puts the pane back.
- It reads the switches from the mods' own state; if Claude Code refuses that read, the switch
  is not drawn (the other rows still work).
- Every Session box figure comes from the engine's typed API, but none was seen in a live session: the hooks are only
  observers (they let each event through first and keep their books in `try/catch`), and each failing source drops only its row.
- The `cost` and `cache` rows need `budget-guard` and `cache-tax` to publish their atoms; without them those parts are not drawn.
- The session name is not given to mods by the engine, so the environment row does not show one.
- Never verified live: the pane, the dropdown and filling the prompt box were tested against Claude Code's simulated engine only.

## Side Question
A `▸ Side Question` button at the bottom; clicking it expands the chat panel (`▾`), which shows the last two answers and a field. Enter asks; `/btw <question>` does the same and expands the panel; `/btw` alone expands it. The answer is made over the main thread's cached context with every tool denied, shown only here and never added to the conversation, and costs a little credit (a cold cache costs like a full message). It needs a first reply in the session. If Claude Code's own built-in `/btw` takes priority over a mod's command of that name, use the field instead. Not verified live.

## Updates
Every time the side bar is turned on (session start, or opened again), moddeck runs `git ls-remote --tags` against its GitHub repository (at most every 6 hours; `updateCheck` turns it off) and, if a newer release exists, asks Update now / Later / Skip this version. Update now runs the installer's own one-liner (`pipx run --spec git+https://github.com/samuelbfernandes/moddeck@vX.Y.Z moddeck update --scope user -y`, else `uvx`; `-y` because there is no terminal to answer questions); restart Claude Code afterwards. `/moddeck update` checks at once. Nothing is installed without your yes. Not verified live.
