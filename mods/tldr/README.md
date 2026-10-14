# tldr

Install (Claude Code 2.1.287 or later): `/plugin install tldr --marketplace samuelbfernandes/moddeck`

## What it does
Long replies are easy to skim past the one line that mattered. While tldr is on, each long reply (800 characters or more)
goes once to a small model (Haiku), which:

- picks the sentences you must not skip (a question asked of you, a decision made for you, a warning, a failure, a
  required action, a number you need), copied word for word. Those sentences are drawn **bold with ⚑** inside the reply,
  so they stand out while you scroll; in the desktop app the paragraph that holds one is also tinted (green by default, `/tldr color` to change it). Code is never touched.
- writes a box above the prompt: **TL;DR** (two or three sentences), **⚑ Needs you**, **→ Next**. ▾ folds it to one line,
  ✕ puts it away until the next long reply.

The call runs after the turn has ended, so nothing waits on it, and nothing is added to the conversation.

## Modes
- **highlight**: only the must-read sentences are marked in the reply. No box.
- **summary** (the default): the marks, plus the TL;DR box above the prompt.

## Colour
In the desktop app the paragraph holding a must-read sentence is tinted. `/tldr color <name>` picks the tint: red, yellow, olive, **green** (default), blue, purple or plum. The colours are estimated by eye from a screenshot; check them on your screen.

## Use
- `/tldr highlight` · `/tldr summary`: turn it on in that mode. `/tldr on` keeps the mode you last chose; `/tldr off` turns it off.
- `/tldr` (status) shows the mode. The moddeck side bar has the same choice as a dropdown (off, highlight, summary) under Prompt helpers.
- Setting `minChars` (default 800): shorter replies are left alone.

## Cost
One Haiku call per long reply: the reply (up to about 24,000 characters) in, at most 700 tokens out. Off by default.

## Limits
- A small model can miss a sentence or pick a dull one; a must-read sentence it paraphrased instead of copying is dropped
  (only exact sentences are marked).
- Marks cover the last 40 picked sentences of the session and go away after `/clear`.
- Not verified live: the marks and the box in a real session, and in the desktop app.

## Credit
The idea (a summary box with "you should know" and "what to do next") comes from claude-mod-tldr by alzerapradisa and
mystique by wellavelino; no code was copied.
