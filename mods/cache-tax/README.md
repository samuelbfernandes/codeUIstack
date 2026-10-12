# cache-tax

Install (Claude Code 2.1.287 or later): `/plugin install cache-tax --marketplace samuelbfernandes/moddeck`

## What it does
Claude's prompt cache goes cold after its TTL; the next message then re-writes the whole conversation at the
cache-write price. cache-tax asks you **once** before such a message and shows the price. When idle > TTL, the context
is above `minContextTokens` and the cold write costs at least `minExtraUsd` more than a warm read, one dialog appears
(no second send): `Cache went cold · this message ~$0.46 (warm: ~$0.02)`, idle time and tokens, then
a suggested way forward, listed first and marked: **Compact first** for a big context (≥100k tokens), **Start fresh** after 6 hours away, else **Send anyway**; **Hold it** is always there (Esc holds; the text is echoed back). Compact first and Start fresh hold the message and put `/compact` or `/clear` in the prompt box, so one Enter runs it. A plugin cannot delete or re-warm the cache itself; the thresholds are rules of thumb, not measured prices. Slash commands, mid-turn typing and scripted
prompts are never asked about; if the guard throws, the message goes through. The first such dialog of a session also
ends with `Keep it warm next time: /keepwarm 90m` (once; shown as plain text, the dialog cannot dim it). Nothing starts by itself: pings cost tokens.

## Use
- `/cache-tax`: a local report, never sent to the model, no tokens. At most six lines:
  ```
  Cache warm · ~58 min left · next message ~$0.02
  Context  ~77k tokens · last turn 46k (1.2k out)
  Cache hits  93% (est.) · 1.2M read · 85k written
  Keep-warm  off  (/keepwarm 90m to start)
  Cold writes this session  0 · ~$0.00
  Estimates · Sonnet · 60 min cache
  ```
  Hit ratio = cache-read tokens / (read + written) over this session's completed turns, from the usage each turn reports; the
  percentage and dollar figures are estimates. Last turn = its four token counts summed (a multi-step turn re-reads the cache each step).
- `/keepwarm [90m|2h|off]` (explicit only): a tiny model call every TTL minus 5 min keeps the cache warm. Default 6h, max 24h,
  no argument = status. None runs during a turn or onto an already cold cache; three failures stop it.
- `onCold = stop` gives the older one-line stop (send the same text again to pay); `off` never stops.

## Turn off
`/plugin disable cache-tax`
## Settings (`/config`)
`cacheTtlMinutes` (60; API-key sessions use 5 unless `promptCacheTtl` is changed), `minContextTokens` (20000),
`minExtraUsd` (0.25), `onCold` (`ask`, `stop`, `off`).

## Limits
- Prices are a built-in table (`hooks/lib.ts`), est. only; unknown models use Sonnet rates; the 1M-context surcharge is not modelled.
- Hit ratio and last-turn figures start at zero in a resumed session and ignore subagents and keep-warm pings.
- Keep-warm runs only while Claude Code is open and is not restored after a restart. Context size can be stale right after a compaction.
- Not verified live: dialogs, timers, pings and the report (mocks only). Nothing run on Windows.
