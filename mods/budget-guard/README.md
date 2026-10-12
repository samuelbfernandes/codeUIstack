# budget-guard

A quiet usage line and an optional spending limit that asks first. Everything runs locally: no model call, no tokens, no network.

## What it does
- **Usage line** above the prompt box (terminal and desktop). Hidden normally. It appears only when the session cost reaches 70% of
  your limit, the context window reaches `contextWarnPct`, or a plan window (5h / 7d) reaches 80%:
  `Session ~$1.20 of $5 · context 78% ! · 5h plan 82% !` (`!` = high, `!!` = very high; also coloured). It steps aside for surveys.
- **Spending limit** (`limitUsd`, default 0 = none). When the estimate reaches it, the next prompt you type opens one dialog:
  Continue (+50%), Continue without limit, or Hold it. Esc holds: "budget-guard blocked your prompt · nothing was sent" and your text
  is echoed back. It never stops tool calls inside a running turn and never touches scheduled, queued or plugin prompts.

## Use
- Type `usage`, `budget` or `budget-guard` (alone) for a short report: cost, tokens in/out, cache hit ratio, context fill, last and
  longest turn, plan windows with reset times. `/budget-guard` does the same.
- `budget 10` sets the limit to $10 for this session only (`budget 0` removes it). Only exactly "budget" plus a number counts;
  a sentence that contains these words is an ordinary prompt. Recommended: set `limitUsd` in `/config` so every session has one.

## Turn off
`/plugin disable budget-guard`, or set `enabled` to false.

## Settings
`enabled`, `limitUsd` (USD per session), `contextWarnPct` (default 75), `showLine` (default true).

## Limits
- Cost is the engine's own session total when it reports one; otherwise it is estimated from token counts at rough built-in list prices
  and labelled "est." (cache writes at the 5-minute rate, unknown models priced like Sonnet). Prices drift.
- Tokens, cache ratio and turn times count from when the mod loaded, and restart after `/clear`. The `budget N` override is not saved.
- The limit is checked when you send a prompt, so one long turn can overshoot it. Plan windows only show if your account reports them.
- If a check fails for any reason, your prompt is sent as typed.
- Verified against mocks only (41 tests, terminal and desktop). Not run in a live session, and nothing has been run on Windows.
