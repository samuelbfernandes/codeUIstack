// color-lab: `/color-lab <fg> [bg]` shows both colours as hex, rgb and hsl, their WCAG 2.x contrast ratio, pass or fail
// for AA and AAA (normal and large text), swatches, and, when AA normal text fails, the nearest lighter or darker shade
// of the text colour that passes. Pure arithmetic: no files, no programs, no network.
// FAIL OPEN: it hooks no tool call and refuses nothing; a bad colour gets a usage line.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ColorLabReport } from '../types'
import { analyse, parseColor, reportText, splitArgs } from './lib'

type Dollar = EngineInterface

const COMMAND = 'color-lab'
const PANE = 'color-lab'
const USAGE = 'Use /color-lab <text colour> [background], each as #rgb, #rrggbb or rgb(r, g, b). The background defaults to #ffffff.'

const report = atom({ plugin: 'color-lab', key: 'report' } as const, null)

async function run($: Dollar, args: string): Promise<string> {
  const words = splitArgs(args)
  if (words.length === 0 || words.length > 2) return `color-lab · ${USAGE}`
  const fg = parseColor(words[0]!)
  const bg = parseColor(words[1] ?? '#ffffff')
  if (fg === undefined || bg === undefined) {
    const bad = (fg === undefined ? words[0] : words[1]) ?? ''

    return `color-lab · “${bad.slice(0, 40)}” is not a colour I can read.\n${USAGE}`
  }
  const r: ColorLabReport = analyse(fg, bg)
  await update($, report, () => r)
  const surfaces = await $.session.surfaces().catch(() => [])
  if (surfaces.length === 0) return reportText(r) // nothing draws a pane: the whole answer as text
  const opened = await $.ui.open({ id: PANE, title: 'Colour', columns: 56 })
  if (!opened.isPlaced) return reportText(r)
  const aa = r.checks[0]!

  return `color-lab · ${r.fg.hex} on ${r.bg.hex}: ${r.ratioText}:1 · AA normal text ${aa.isPass ? 'passes' : 'fails'}${r.fix ? ` · try ${r.fix.hex}` : ''}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: COMMAND, description: 'Contrast of a text colour on a background (WCAG AA/AAA)', argumentHint: '<fg> [bg]' })
    } catch {
      // fail-open: the session goes on without the command
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, e.args) })).catch(() => ({
    text: 'color-lab · something went wrong',
  }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, report)
    if (r === null) return <Text dimColor>{USAGE}</Text>
    const row = (label: string, c: { hex: string; rgb: string; hsl: string }, key: string) => (
      <Box key={key}>
        <Text backgroundColor={c.hex}>{'    '}</Text>
        <Text> {label} {c.hex} · {c.rgb} · {c.hsl}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {row('text      ', r.fg, 'fg')}
        {row('background', r.bg, 'bg')}
        <Text key="sample" color={r.fg.hex} backgroundColor={r.bg.hex}>
          {' The quick brown fox, 0123456789 '}
        </Text>
        <Text key="ratio" bold>Contrast {r.ratioText}:1</Text>
        {r.checks.map(c => (
          <Text key={`check:${c.name}`} color={c.isPass ? 'green' : 'red'}>
            {c.isPass ? '✓ pass' : '✗ fail'} {c.name} (needs {c.need}:1)
          </Text>
        ))}
        {r.fix !== null && (
          <Box key="fix">
            <Text backgroundColor={r.fix.hex}>{'    '}</Text>
            <Text> nearest {r.fix.direction} shade that passes AA normal: {r.fix.hex} ({r.fix.ratioText}:1)</Text>
          </Box>
        )}
        <Text dimColor>WCAG 2.x ratio, two decimals rounded down.</Text>
      </Box>
    )
  })
}
