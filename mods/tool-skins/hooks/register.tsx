// tool-skins: recolours and redraws the tool-call rows and Edit/Write diff
// cards in one of seven themes. Draw-only: it hooks `ui.render`, never
// `tool.call`, and writes nothing the model reads except the one-line reply of
// its own /skin command. Anything it does not understand goes to `next(e)`.

import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderPropsOf } from 'claude-code'

import { diffCardOf, displayName, elapsedMs, formatMs, lookOf, summarize } from './rows'
import { DEFAULT_THEME, THEME_NAMES, isThemeName, matchTheme, paletteOf, titleOf } from './themes'
import type { Palette, ThemeName } from './themes'

const themeAtom = atom({ plugin: 'tool-skins', key: 'theme' } as const, DEFAULT_THEME as string)
const STORE_KEY = 'theme'

/** Only the elements both styled surfaces share; the others fall back to the engine. */
type Table = Elements['terminal'] | Elements['desktop']

function toolRow(t: Table, p: Palette, props: RenderPropsOf['ToolUse']) {
  const { Box, Text } = t
  const look = lookOf(props.tool)
  const summary = summarize(props.tool, props.input)
  const ms = elapsedMs(props.output)
  const [mark, markColor] = props.isInterrupted
    ? ['interrupted', p.yellow]
    : props.isErrored
      ? ['✗', p.red]
      : props.isRunning
        ? ['…', p.muted]
        : ['✓', p.green]

  return (
    <Box gap={1}>
      <Box flexShrink={0} gap={1}>
        <Text color={p[look.tone]}>{look.icon}</Text>
        <Text bold color={p[look.tone]}>{displayName(props.tool)}</Text>
      </Box>
      <Box flexShrink={1} overflow="hidden">
        <Text color={p.muted} wrap="truncate-end">{summary}</Text>
      </Box>
      <Box flexShrink={0} gap={1}>
        {ms !== undefined && <Text color={p.muted}>{formatMs(ms)}</Text>}
        <Text color={markColor}>{mark}</Text>
      </Box>
    </Box>
  )
}

function diffCard(t: Table, p: Palette, card: NonNullable<ReturnType<typeof diffCardOf>>) {
  const { Box, Text, Code } = t
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={p.border} paddingX={1}>
      <Box gap={1}>
        <Text bold color={p.accent}>{card.verb}</Text>
        <Text color={p.fg}>{card.filePath}</Text>
        <Text color={p.green}>{`+${card.additions}`}</Text>
        <Text color={p.red}>{`−${card.deletions}`}</Text>
      </Box>
      <Code source={card.source} format="diff" path={card.filePath} wrap="truncate-end" />
      {card.omitted > 0 && <Text color={p.muted}>{`${card.omitted} more lines`}</Text>}
    </Box>
  )
}

/** The headline for a theme, as a person reads it. */
const headline = (name: string): string => `Skin · ${isThemeName(name) ? titleOf(name) : name}`

/** The theme names, the current one marked. */
const choices = (current: string): string => THEME_NAMES.map(n => (n === current ? `● ${n}` : n)).join(' · ')

function listing(current: string): string {
  return `${headline(current)}\n${choices(current)}\nRun /skin followed by a name to switch.`
}

/** What `/skin <args>` does: list, or switch to a theme; the reply is one text. */
async function runSkin($: EngineInterface, args: string): Promise<{ text: string }> {
  const current = (await read($, themeAtom)) ?? DEFAULT_THEME
  const wanted = args.trim()
  if (wanted === '') return { text: listing(current) }

  const name: ThemeName | undefined = matchTheme(wanted)
  if (name === undefined) {
    return { text: `Skin · no match for “${wanted.slice(0, 40)}”\n${choices(current)}` }
  }
  await $.store.set(STORE_KEY, name)
  await update($, themeAtom, () => name)
  return { text: headline(name) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Fail-open: a store that cannot be read leaves the default skin.
    const saved = await $.store.get(STORE_KEY)
    if (isThemeName(saved)) await update($, themeAtom, () => saved)
    await $.command.register({
      name: 'skin',
      description: 'Change the colour theme of tool rows',
      argumentHint: '[theme]',
    })
    return next(e)
  })

  // Answers its own command and reads no `next`: a failure only skips /skin, with a short notice.
  on('command.run', { command: 'skin' }, ($, e) => runSkin($, e.args)).catch(() => ({ text: 'Skin · could not change it' }))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const p = paletteOf(await read($, themeAtom))
    return toolRow($.ui.resolve(e), p, e.props)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (e.props.isErrored) return next(e)
    const card = diffCardOf(e.props.tool, e.props.output)
    if (card === undefined) return next(e)
    const p = paletteOf(await read($, themeAtom))
    return diffCard($.ui.resolve(e), p, card)
  })
}
