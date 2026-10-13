// decision-log: `/decision <text> [-- rationale]` adds one row to docs/DECISIONS.md under the session's folder, in the
// table the agents-md-scaffold skill writes (| ID | Date | Decision | Rationale | Status |): the next ID, today's local
// date, status "accepted". The file is created with the template header when missing. `/decision-log` shows the last
// 20 rows in a pane. It writes that one file only, and only on an explicit /decision.
// FAIL OPEN: it hooks no tool call and refuses nothing; when the file cannot be read it writes nothing and says why.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DecisionLogView } from '../types'
import { RELATIVE_PATH, decisionsPath, localDate, nextId, parseArgs, parseRows, rowLine, withRow } from './lib'

type Dollar = EngineInterface

const ADD = 'decision'
const SHOW = 'decision-log'
const PANE = 'decision-log'
const SHOWN = 20

const view = atom({ plugin: 'decision-log', key: 'view' } as const, null)

/** The file's text, undefined when it does not exist; throws when it exists and cannot be read. */
async function readFile($: Dollar, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path))) return undefined

  return $.fs.read(path)
}

async function refresh($: Dollar): Promise<DecisionLogView> {
  const path = decisionsPath(await $.session.cwd())
  let next: DecisionLogView
  try {
    const text = await readFile($, path)
    const rows = text === undefined ? [] : parseRows(text)
    next = { path, rows: rows.slice(-SHOWN), total: rows.length, isMissing: text === undefined, error: '' }
  } catch (error) {
    next = { path, rows: [], total: 0, isMissing: false, error: error instanceof Error ? error.message.slice(0, 300) : 'could not read it' }
  }
  await update($, view, () => next)

  return next
}

async function add($: Dollar, args: string): Promise<string> {
  const parsed = parseArgs(args)
  if ('error' in parsed) return `decision-log · ${parsed.error}.\nUse /decision <what was decided> -- <why>.`
  const path = decisionsPath(await $.session.cwd())
  let text: string | undefined
  try {
    text = await readFile($, path)
  } catch {
    return `decision-log · could not read ${RELATIVE_PATH}; nothing was written.`
  }
  const id = nextId(text ?? '')
  const line = rowLine(id, localDate(await $.clock.now()), parsed.decision, parsed.rationale)
  await $.fs.write(path, withRow(text, line))
  await refresh($)

  return `decision-log · added ${id} to ${RELATIVE_PATH}${text === undefined ? ' (new file)' : ''}`
}

async function show($: Dollar): Promise<string> {
  const v = await refresh($)
  await $.ui.open({ id: PANE, title: 'Decisions', columns: 80 })
  if (v.error !== '') return `decision-log · could not read ${RELATIVE_PATH}`
  if (v.isMissing) return `decision-log · no ${RELATIVE_PATH} yet\n/decision <text> -- <why> creates it.`

  return `decision-log · ${v.total} decision${v.total === 1 ? '' : 's'} in ${RELATIVE_PATH}`
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: ADD, description: 'Add a decision to docs/DECISIONS.md', argumentHint: '<decision> [-- rationale]' })
      await $.command.register({ name: SHOW, description: 'Show the last 20 decisions in docs/DECISIONS.md' })
    } catch {
      // fail-open: the session goes on without the commands
    }

    return next(e)
  })

  on('command.run', { command: ADD }, async ($, e) => ({ text: await add($, e.args) })).catch(() => ({
    text: `decision-log · could not write ${RELATIVE_PATH}`,
  }))

  on('command.run', { command: SHOW }, async $ => ({ text: await show($) })).catch(() => ({
    text: `decision-log · could not read ${RELATIVE_PATH}`,
  }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const v = await read($, view)
    const reload = <Button key="refresh" label="Refresh" hotkey="r" onPress={async () => void (await refresh($))} />
    if (v === null) return reload
    const rows = [...v.rows].reverse()

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>
            {v.total} decision{v.total === 1 ? '' : 's'}
            {v.total > v.rows.length ? ` · last ${v.rows.length}` : ''}{' '}
          </Text>
          {reload}
        </Box>
        {v.error !== '' && <Text color="yellow">Could not read {RELATIVE_PATH}: {v.error}</Text>}
        {v.isMissing && <Text dimColor>{`No ${RELATIVE_PATH} yet. /decision <text> -- <why> creates it.`}</Text>}
        {rows.map(row => (
          <Box flexDirection="column">
            <Text>
              <Text bold>{row.id}</Text> <Text dimColor>{row.date} · {row.status}</Text> {clip(row.decision, 200)}
            </Text>
            {row.rationale !== '' && <Text dimColor>    {clip(row.rationale, 200)}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
