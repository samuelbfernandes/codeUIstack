# reflect

Install (Claude Code 2.1.287 or later): `/plugin install reflect --marketplace samuelbfernandes/codeUIstack`
Turns your corrections ("no, use pnpm", "never do X", "from now on ...") into rules saved to `CLAUDE.md`.

## What it does
1. On each prompt a local regex pre-filter looks for corrections and standing preferences. Slash commands,
   very short prompts, long pastes (over 2000 chars or 20 lines) and fenced code blocks are ignored.
2. Only a prompt that passes triggers ONE small-model call (`haiku` by default) that answers with
   `{rule, scope}`. The prompt is never changed or delayed (dropped only for the plain words below); the call
   runs from a timer.
3. A band above the prompt offers the rule once, under `● Reflect · ./CLAUDE.md`, with `Save`, `Global`, `Edit`, `Skip`.
   Edit swaps in an Input prefilled with the rule (Enter saves to the project). If the model judged the rule
   personal, the band names `~/.claude/CLAUDE.md` and the second button reads `Project`.
4. Save appends `- <rule>` under `## Learned rules` in `./CLAUDE.md` (session cwd) or `~/.claude/CLAUDE.md`,
   creating the file or heading if needed, skipping near-duplicates, touching nothing else. A toast says `✓ Saved to ./CLAUDE.md`.
5. One proposal at a time: the newest wins, and the next prompt you submit hides the band.
## Privacy
**The text of a prompt that passes the pre-filter is sent to the small model**, plus (unless
`includeLastReply` is off) the last 800 characters of the assistant's previous message. Prompts that do not
pass are never sent. Turn it off with `/reflect off`, or set `enabled` to false in `/config`.

## Commands and settings
- `/reflect on|off|status`. `off` persists across sessions; `enabled = false` in settings always wins.
- Plain words, no `/`: type `reflect status`, `reflect on` or `reflect off` alone (any case, optional final `.`).
  Dropped before the model sees it, no tokens; a prompt that merely contains them is normal. The reply is a
  one-line headline (`Reflect · on`) with a short dim note under it.
- userConfig: `enabled` (true), `model` (`haiku`), `includeLastReply` (true). Off entirely: `/plugin disable reflect`.

## Guards
Rules are one line, at most 300 characters, saved as the model wrote them. A rule that asks for AI
attribution to be ADDED (co-author trailers, attribution footers) is discarded; one that forbids it is fine.
Everything fails open: any error means no band and the prompt goes through untouched (a plain word whose
command fails is still dropped, with a short notice).

## Limits
- Esc cannot be hooked: it only hands focus back to the prompt, so the edit Input stays until you press
  Cancel, Enter, or submit the next prompt. The `Cancel` button is the explicit way out.
- Duplicate detection is word-based (85% overlap); a reworded rule can still be saved twice.
- Prompts from a headless run (no surface) are not analysed. Never verified in a live session (plain words too).
