// table-preview: `/table-preview <path>` previews a .csv, .tsv or .txt table in a pane: the delimiter (comma, semicolon or tab),
// the columns with a simple type each (number, text, share empty), the row count and the first 20 rows. It reads only
// the file named, refuses links, folders and files over `maxKb`, and writes nothing.
// FAIL OPEN: it hooks no tool call and refuses nothing of Claude's; any problem is a line of text in reply.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EXTENSIONS, PREVIEW_COLUMNS, analyse, extOf, reportText, resolveIn, summaryOf, unquote } from './lib'

type Dollar = EngineInterface

const COMMAND = 'table-preview'
const PANE = 'table-preview'
const USAGE = 'Use /table-preview <path to a .csv, .tsv or .txt file>.'

const report = atom({ plugin: 'table-preview', key: 'report' } as const, null)

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.min(max, Math.floor(v)) : fallback

async function run($: Dollar, maxKb: number, args: string): Promise<string> {
  const path = unquote(args)
  if (path === '') return `table-preview · ${USAGE}`
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'table-preview · a path may not hold control characters'
  if (!EXTENSIONS.has(extOf(path))) return `table-preview · only .csv, .tsv and .txt files are read.\n${USAGE}`
  const full = resolveIn(await $.session.cwd(), path)
  let size: number
  try {
    const stat = await $.fs.stat(full)
    if (stat.isLink) return 'table-preview · that path is a symbolic link; name the file it points to instead.'
    if (stat.kind !== 'file') return 'table-preview · that path is not a file.'
    size = stat.size
  } catch {
    return `table-preview · cannot find ${path.slice(0, 200)}`
  }
  if (size > maxKb * 1024) {
    return `table-preview · ${path.slice(0, 200)} is ${Math.round(size / 1024)} KB, over the ${maxKb} KB limit (the maxKb setting). Nothing was read.`
  }
  let text: string
  try {
    text = await $.fs.read(full)
  } catch {
    return `table-preview · could not read ${path.slice(0, 200)}`
  }
  const r = analyse(path, text, size)
  await update($, report, () => r)
  const surfaces = await $.session.surfaces().catch(() => [])
  if (surfaces.length === 0) return reportText(r)
  const opened = await $.ui.open({ id: PANE, title: r.name.slice(0, 40) || 'Table', columns: 100 })

  return opened.isPlaced ? summaryOf(r) : reportText(r)
}

export const register: Register = (on, options) => {
  const maxKb = num(options.maxKb, 2048, 1, 4096)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: COMMAND, description: 'Preview a csv, tsv or txt table: columns, types, row count, first rows', argumentHint: '<path>' })
    } catch {
      // fail-open: the session goes on without the command
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, maxKb, e.args) })).catch(() => ({
    text: 'table-preview · something went wrong reading that file',
  }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Code, Text } = $.ui.resolve(e)
    const r = await read($, report)
    if (r === null) return <Text dimColor>{USAGE}</Text>
    const shown = r.columnCount > PREVIEW_COLUMNS ? `the first ${PREVIEW_COLUMNS} of ${r.columnCount} columns` : 'all columns'

    return (
      <Box flexDirection="column">
        <Text bold>{summaryOf(r).replace(/^table-preview · /, '')}</Text>
        {r.warnings.map(w => (
          <Text color="yellow">{w}</Text>
        ))}
        {r.columns.map((c, i) => (
          <Text wrap="truncate-end">
            {String(i + 1).padStart(3)}. {c.name} <Text dimColor>· {c.type}{c.emptyPct > 0 ? ` · ${c.emptyPct}% empty` : ''}</Text>
          </Text>
        ))}
        {r.columnCount > r.columns.length && <Text dimColor>+{r.columnCount - r.columns.length} more columns</Text>}
        <Text dimColor>
          First {r.previewRows} rows, {shown}:
        </Text>
        <Code source={r.preview} wrap="truncate-end" />
        {r.isCut && <Text dimColor>The preview leaves part of the table out; cells are cut at 18 characters.</Text>}
      </Box>
    )
  })
}
