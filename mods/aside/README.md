# aside

Install (Claude Code 2.1.295 or later): `/plugin install aside --marketplace samuelbfernandes/codeUIstack`

## What it does
Ask a quick side question without disturbing the main conversation. The question is answered over your current
context (the prompt cache makes that cheap), shown in a pane, and never added to the conversation, so Claude's
main thread does not read it and your context does not grow.

## Use
- `/aside <question>`: opens the pane with "Thinking…", then the question as a headline, the answer below it and a dim
  line `Side question · not added to the conversation · ~12k tokens est.`. A failed or empty answer shows
  `Aside · no answer, nothing changed`. The pane keeps the last 5 asides (newest first) for the session.
- Type `aside` alone (any case, optional final `.`) for a short how-to; it is local, free and never sent to the model.
  If asides are kept, it also brings the pane back. `/aside` with no question does the same.
- `Close` closes the pane. It works while Claude is busy with a turn.
- Asking costs model credit, so there is deliberately no plain-word way to ask: only `/aside <question>`.

## Turn off
`/plugin disable aside`, or set `enabled` to off in the plugin settings.

## Settings
- `enabled` (default on).
- `maxAnswerChars` (default 4000): a longer answer is cut and says so.
- There is no model setting: Claude Code's side-question call always uses the session's own model and cache, and
  offers no way to pick another one.

## Limits
- The answer is plain text: no tools are available to it (the engine denies them), so it cannot read files or run code.
  It knows only what is already in the conversation.
- The token figure is the call's reported total including cached tokens, labelled est.; cached tokens cost much less
  than fresh ones, and a cold cache (idle for a while) makes the first aside cost like a full message.
- Your own `/aside ...` line and a one-line status stay in the transcript; the answer itself does not.
- Needs a first reply in the session (nothing to ask about before it, or after `/clear`). Only one aside runs at a time.
- Asides are kept in memory for the session only. If the pane has no room (a narrow window), nothing is asked.
- Not verified live: how the engine treats a side question sent mid-turn, how the pane looks on the desktop app,
  and anything on Windows. Tested with a mocked fork on the terminal and desktop surfaces.
