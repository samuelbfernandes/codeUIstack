# tool-skins

Install (Claude Code 2.1.287 or later): `/plugin install tool-skins --marketplace samuelbfernandes/moddeck`

Restyles what Claude Code draws for tool calls, live, in seven themes: `noir`, `tokyo-night`,
`dracula`, `catppuccin` (Mocha), `gruvbox` (dark), `nord`, `solarized-dark`.

- Tool rows: an icon per tool (Bash, Read, Edit, Write, Grep, Glob, Agent, WebFetch, WebSearch, MCP...),
  the tool name, a dim argument summary, the tool's own reported time when it has one, and a status mark.
- Edit/Write results: a bordered diff card (file, +/− counts, `Code` in diff format) framed in theme colours.
- Draw-only. It hooks `ui.render` (`ToolUse`, `ToolResult`), never `tool.call`: it cannot change what a
  tool does or what the model reads. It runs nothing, reads and writes no files, uses no network; the
  only thing it stores is your theme name in `$.store`.

## Commands
    /skin              list themes, mark the current one
    /skin dracula      switch now; also tokyonight, sol, any unique prefix
Replies are short: `Skin · Dracula`; the list adds the theme names and one hint line, as a dim note.

The choice persists across sessions and is applied at `session.start`. Default is `noir`.

Turn off: `/plugin disable tool-skins` restores the engine's own drawing.

## Limits (honest)

- Theme colours are hex. Colour on the terminal depends on its truecolor support.
- The lines inside the diff card are coloured by the engine's own highlighter and your Claude theme
  (`Code` offers no colour props); the mod themes the frame, header and counts only.
- Only `terminal` and `desktop` are styled; `mobile` and `vscode` get the engine's own rows.
- Timing appears only where the tool's result carries one (WebFetch, Grep, Agent...); Bash, Read and
  Edit show none, since the mod does not wrap `tool.call` to time them.
- Collapsed tool groups (`Read 3 files, ran 2 commands`) are the engine's; only their expanded rows are skinned.
- The `/skin` reply is a normal command output, so the model can read it.
- Not verified in a live session: how the icon glyphs align in your font, how the desktop app paints these
  rows (tested with the engine's test kit only). The kit tests trees, not pixels.
- Name: `claude-skins` is rejected by the validator (reserved `claude-` prefix), hence `tool-skins`.
