# budget-guard

A quiet usage line and an optional limit that asks first: on your plan's usage windows, or in dollars for API-key use. Everything runs locally: no model call, no tokens, no network.

## What it does
- **Usage line** above the prompt box (terminal and desktop). Hidden normally. It appears only when the context window reaches
  `contextWarnPct`, a plan window (5h / 7d) reaches 80% (or 90% of your limit), or cost reaches 90% of a dollar limit:
  `Session ~$1.20 · context 78% ! · 5h window 82/100 · limit 80 !!` (`!` = high, `!!` = very high; also coloured). It steps aside for
  surveys. With a dollar limit the cost reads `Session ~$9.50 · limit $10 !`.
- **Usage limit**, two ways. `limitPct` (default 0 = none) is in plan points out of 100: when ANY plan window is at or above it, the next
  prompt you type opens one dialog. `limitUsd` (default 0 = none) is in dollars, for API-key use where no plan window is reported: the
  dialog opens when the estimated session cost reaches it. Either (or both at once, in one dialog) triggers it. Choices: Continue
  (+10 points, max 100 / +50% of the dollar limit), Continue without limit, or Hold it. Esc holds: "budget-guard blocked
  your prompt · nothing was sent" and your text is echoed back. It never stops tool calls inside a running turn and never touches
  scheduled, queued or plugin prompts.

## Use
- `/budget-guard` prints a short report: cost, tokens in/out, cache hit ratio, context fill, last and longest turn, and each plan
  window as `5h window 62/100 · limit 80 · resets in 1h 12m`.
- `/budget-guard 80` sets the plan limit to 80 points, `/budget-guard $10` the dollar limit to $10, for this session only
  (`/budget-guard 0` or `/budget-guard off` clears both). Set `limitPct` / `limitUsd` in `/config` so every session has one. Typed words like `usage` are ordinary prompts; only the slash command counts.
- If your account reports no plan window (e.g. API-key use), the report says "API-key use: the limit is in dollars"; a percent limit
  cannot be enforced then. Prompts are never refused.

## Turn off
`/plugin disable budget-guard`, or set `enabled` to false.

## Settings
`enabled`, `limitPct` (0-100, plan points), `limitUsd` (USD per session), `contextWarnPct` (default 75), `showLine` (default true).

## Limits
- Cost is the engine's own session total when it reports one; otherwise it is estimated from token counts at rough built-in list prices
  and labelled "est." (cache writes at the 5-minute rate, unknown models priced like Sonnet). Prices drift.
- Tokens, cache ratio and turn times count from when the mod loaded, and restart after `/clear`. The `/budget-guard N` override is not saved.
- The limit is checked when you send a prompt, so one long turn can overshoot it. Plan windows only exist if your account reports them.
- If a check fails for any reason, your prompt is sent as typed.
- Verified against mocks only (54 tests, terminal and desktop). Not run in a live session, and nothing has been run on Windows.
