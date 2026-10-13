# color-lab

Install: `/plugin install color-lab --marketplace samuelbfernandes/moddeck`

Checks whether a text colour is readable on a background, by the WCAG 2.x contrast rules, and suggests a fix.

## What it does
- `/color-lab <fg> [bg]` reads each colour as `#rgb`, `#rrggbb` or `rgb(r, g, b)`. The background defaults to `#ffffff`.
- Shows both colours as hex, rgb and hsl, with a swatch of each and a line of sample text.
- Shows the contrast ratio (two decimals, rounded down, so a ratio shown as 4.50 really passes 4.5) and pass or fail for
  AA normal text (4.5:1), AA large text (3:1), AAA normal text (7:1) and AAA large text (4.5:1).
- When AA normal text fails, finds the nearest lighter or darker shade of the text colour (same hue and saturation,
  lightness moved in 0.5 % steps) that passes, and shows it with its ratio.
- The answer opens in a pane. Where nothing draws panes (a headless run), the whole answer comes back as text instead.
  Either way the command's one-line answer is what the model sees.
- Pure arithmetic: no files, no programs, no network. It hooks no tool call.

## Use
    /color-lab #777                     grey text on white
    /color-lab #1a2b3c #f5f5f5
    /color-lab rgb(200, 30, 30) #000

## Turn off
Close the pane, or `/plugin disable color-lab`. Nothing runs until you call it.

## State for the moddeck side bar
`{ plugin: 'color-lab', key: 'report' }`: the last answer (`fg`, `bg`, `ratio`, `ratioText`, `checks`, `fix`), or `null`.
Nothing is kept in `$.store`.

## Limits
- WCAG 2.x only (the relative-luminance formula with the 0.04045 sRGB threshold), not APCA or WCAG 3 drafts.
- No named colours (`red`), no alpha, no `hsl()` input.
- "Large text" is the WCAG size (18 pt, or 14 pt bold); the mod cannot know your font size.
- Swatches use the elements' background colour, which every surface takes; how a terminal paints a hex colour depends on
  its colour support. Tested with a mocked engine on all four element tables, not by eye in a live session.

## Credit
Adapted from color-lab in [awesome-claude-code-mods](https://github.com/whyashthakker/awesome-claude-code-mods) (MIT,
© 2026 Yash Thakker and contributors). Rewritten for moddeck: TypeScript in the house style, colours given as command arguments instead of
fields in the pane, rgb() and #rgb input besides #rrggbb, hsl
output, all four WCAG AA/AAA checks, ratios rounded down, swatches, the nearest passing shade, a text answer where no
pane is drawn, and tests. The upstream licence is in `LICENSE`.
