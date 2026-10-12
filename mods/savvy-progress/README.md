# savvy-progress

Install (Claude Code 2.1.287 or later): `/plugin install savvy-progress --marketplace samuelbfernandes/moddeck`

See Claude's plan progress and every helper (subagent) it runs, live, and roughly what it costs.

- **Band above the prompt**, one line when nothing runs: `◈ ▰▰▰▱▱ 3/5 tasks · helpers: 3 done · 41.2k tok · est. $0.38 · 1m12s [details] [hide]`.
  While helpers run it grows to a few rows: a bar of helpers finished (`▰▱▱ 1/3 helpers`), the task bar, and up to three
  running helpers with elapsed time and tool count, nested under the helper that started them. Quiet until there is a task list or a helper.
- **Tasks bar**: counts Claude's own task list (the TodoWrite, or TaskCreate/TaskUpdate tools) in the main conversation.
- **Pane** (`/agents-info`): each helper with type, model, status,
  context bar, tokens, est. cost, elapsed time and tool count; a helper started by another helper is indented under it.
  Every running helper has a `Stop` button (it calls Claude's own TaskStop tool, so permission rules still apply).
- **Tree as text**: `/agents-info tree` prints the same tree, one line per helper.
- `/agents-info band` shows or hides the band (remembered). Slash commands run locally and cost no tokens.

## How the numbers are made
- Tokens come from each helper's `turn.step` usage, replaced by its `turn.complete` total. "tok" = input + output + cache read + cache write.
- Cost is **an estimate**: tokens x a built-in price table (`PRICES` in `hooks/lib.ts`, matched by model-id substring); override with the
  `priceOverrides` setting, e.g. `sonnet=3/15,opus=5/25/0.5/6.25` (in/out[/cacheRead/cacheWrite]). Context bar = last request / assumed window (200k, 1M for `[1m]`).
- Tasks: the list comes from the tool call results (TodoWrite `newTodos`, TaskCreate `task.id`, TaskUpdate `status`, TaskList). No other source exists.
- Tree: `agent.spawn` says which agent started a helper (`parentAgentId`); the engine's agent list fills gaps. Helpers the main conversation started are top level.
- Tool count = tool calls whose event carries the helper's id. Elapsed is the engine's turn time.

## Turn it off
`/plugin disable savvy-progress` (or `/agents-info band` to hide just the band).

## Limits
- Only what this session saw; only the hidden flag is saved. A helper's own task list is not counted (only the main conversation's).
- Plan-mode steps that are not task tools are not tasks. Not verified live: that every helper kind raises step and tool events, the desktop look, price accuracy for new models.
- Tested with synthetic events on terminal and desktop; nothing has been run on Windows.
