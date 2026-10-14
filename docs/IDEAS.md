# New mod and skill ideas from "23 Claude Mistakes"

Source: the RoboNuggets guide "23 Claude Mistakes you're making" (facts checked by its author 9 October 2026; the Anthropic
pages it cites were re-read on 2026-10-12 for pricing and caching). Nothing here is built yet. Numbers are the guide's mistake numbers.

## Already covered by a mod
| # | Mistake | Mod |
|---|---|---|
| 12 | Walking away mid-session (cold cache) | `cache-guard` (guard + `/keepwarm`) |
| 14 | No safety net | `command-guard`, `secret-guard`, `data-guard` |
| 15 | No backup | `checkpoint` |
| 17 | Infinite exploration | `big-file-guard` (partly) |
| 18 | Never checking usage | `usage-meter`, moddeck Session box |
| 23 | No model routing | `suggest-model` |
| 4 | Side questions in the main chat | built-in `/btw`; moddeck's own `/btw` panel shows the answer in the side bar (`aside` was dropped) |

## Worth building (ranked)
1. **prompt-lint** (#6, #7, #11): a local, zero-token check on the typed prompt. One quiet line, never a block: "one short
   line with no reader or goal", "ALL-CAPS rule", "think carefully (set /effort instead)". Same engine as `suggest-model`'s cue rules.
2. **memory-lint** (#7, #11, #13): `/memory-lint` reads CLAUDE.md and skills: lines over 200, bare rules with no "because",
   shouting and old-model phrasing ("think step by step", "don't be lazy"), and a missing `# Compact instructions` section (#22). Read-only; shows rewrites, changes nothing.
3. **rewind-nudge** (#3, #10): after two correction prompts in a row (`reflect` already detects corrections), suggest
   `/rewind` or `/clear` plus one better prompt. Best as an option inside `reflect`, not a new mod.
4. **topic-shift** (#1): when context is large and the new prompt shares almost no words with the recent ones, suggest `/clear`.
   Needs a conservative threshold, or it will nag; off by default.
5. ~~effort-watch~~ (#5, #2): built, as part of `suggest-model`.
6. **compact-assist** (#22): at a natural break (a turn that ended with tests green, or a commit) and over about 60% context,
   offer `/compact` pre-filled with what to keep. The mod only fills the prompt box.
7. **mcp-audit** (#16, #21): lists enabled MCP servers and plugins with the per-turn context each adds and when each was last
   used (from the transcripts), and which have a CLI. Moddeck's Session box already counts them.
8. **retention-check** (#20): one notice when `cleanupPeriodDays` is the 30-day default, with a button that proposes the settings
   line. It changes a settings file, so it must ask first.

## Skills rather than mods (built: `align`, `burst`, `assess-plugin`)
- **align** (#19): interview with numbered questions and lettered choices, then write a spec and build in a fresh session.
- **burst** (#9): three independent versions, graded against the goal (costs 3x; use for hooks, titles and emails).
- **assess-plugin** (#21): given a repo link, say what it installs, what it costs every turn, whether it is safe and whether it is needed.

## Not worth building
- A second side-question tool: `/btw` exists.
- Auto-`/loop` pings beyond `cache-guard`'s `/keepwarm`: Anthropic lists scheduled tasks as a cost driver.
