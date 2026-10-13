// test-ledger: watches the Bash calls Claude makes and keeps the last 40 that are test, lint, build, format or check
// commands (pytest, R CMD check, devtools::test, cargo, npm/pnpm/yarn scripts, ruff, mypy, eslint, quarto, ...), with
// pass or fail, time and duration. `/test-ledger` shows them in a pane, newest first, with a Clear button.
// Memory only: secrets in a command are replaced by *** and the command cut to 200 characters before it is kept.
// FAIL OPEN: it never blocks or changes a call; if recording fails, the result goes back to the model untouched.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TestLedgerRun } from '../types'
import { classify, clockTime, cut, exitCodeOf, scrub, seconds } from './lib'

type Dollar = EngineInterface

const COMMAND = 'test-ledger'
const PANE = 'test-ledger'
const KEEP = 40

const runs = atom({ plugin: 'test-ledger', key: 'runs' } as const, [])
const isOff = atom({ plugin: 'test-ledger', key: 'isOff' } as const, false)

let counter = 0

async function setSwitch($: Dollar, off: boolean): Promise<void> {
  if (off) await $.store.set('off', true)
  else await $.store.delete('off')
  await update($, isOff, () => off)
}

async function isSwitchedOff($: Dollar): Promise<boolean> {
  try {
    return await read($, isOff)
  } catch {
    return false
  }
}

async function status($: Dollar): Promise<string> {
  const list = await read($, runs)
  const failed = list.filter(r => r.status === 'fail').length
  const last = list[list.length - 1]
  const lines = [`test-ledger · ${(await isSwitchedOff($)) ? 'off' : 'on'} · ${list.length} run${list.length === 1 ? '' : 's'} recorded, ${failed} failed`]
  if (last !== undefined) lines.push(`Last: ${last.status} · ${last.tool} · ${clockTime(last.at)}`)

  return lines.join('\n')
}

async function run($: Dollar, args: string): Promise<string> {
  const word = args.trim().toLowerCase()
  if (word === 'status') return status($)
  if (word === 'clear') {
    await update($, runs, () => [])

    return 'test-ledger · cleared'
  }
  if (word === 'on' || word === 'off') {
    try {
      await setSwitch($, word === 'off')
    } catch {
      return 'test-ledger · that did not work, nothing changed'
    }

    return word === 'on' ? 'test-ledger · on' : 'test-ledger · off · /test-ledger on records again'
  }
  if (word !== '') return `test-ledger · unknown option “${word.slice(0, 30)}”\nUse /test-ledger, or /test-ledger on, off, clear or status.`
  await $.ui.open({ id: PANE, title: 'Checks', columns: 70 })

  return status($)
}

async function record($: Dollar, command: string, ran: { isError?: true; text?: string; result?: unknown }, startedAt: number): Promise<void> {
  if (await isSwitchedOff($)) return
  const match = classify(command)
  if (match === undefined) return
  const at = await $.clock.now()
  const result = (ran.result ?? {}) as { interrupted?: unknown; backgroundTaskId?: unknown }
  const isBackground = ran.isError !== true && typeof result.backgroundTaskId === 'string' && result.backgroundTaskId !== ''
  const status: TestLedgerRun['status'] = ran.isError === true || result.interrupted === true ? 'fail' : isBackground ? 'background' : 'pass'
  const exitCode = status === 'fail' ? exitCodeOf(ran.text) : undefined
  counter += 1
  const entry: TestLedgerRun = {
    id: `${at}-${counter}`,
    kind: match.kind,
    tool: match.tool,
    command: cut(scrub(command).replace(/\s+/g, ' ').trim(), 200),
    status,
    ...(exitCode === undefined ? {} : { exitCode }),
    at,
    ms: Math.max(0, at - startedAt),
  }
  await update($, runs, list => [...list, entry].slice(-KEEP))
}

const MARK: Record<TestLedgerRun['status'], { glyph: string; color: string }> = {
  pass: { glyph: '✓', color: 'green' },
  fail: { glyph: '✗', color: 'red' },
  background: { glyph: '…', color: 'gray' },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const stored = (await $.store.get('off')) === true
      await update($, isOff, () => stored)
    } catch {
      // reads as on
    }
    try {
      await $.command.register({ name: COMMAND, description: 'Show the test, lint and build commands run this session', argumentHint: '[on|off|clear|status]' })
    } catch {
      // fail-open: the session goes on without the command
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, e.args) })).catch(() => ({
    text: 'test-ledger · could not read its own state',
  }))

  // Watches only: the call runs as the model made it and its result goes back unchanged.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const startedAt = await $.clock.now().catch(() => 0)
    const ran = await next(e)
    if (ran.deny !== undefined) return ran // never ran
    try {
      await record($, String(e.command ?? ''), ran, startedAt)
    } catch {
      // a ledger problem never reaches the model
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, runs)
    const off = await isSwitchedOff($)
    const failed = list.filter(r => r.status === 'fail').length
    // Newest first, as many as fit in about 9000 characters.
    let budget = 9000
    const shown: TestLedgerRun[] = []
    for (const r of [...list].reverse()) {
      budget -= r.command.length + r.tool.length + 60
      if (budget < 0) break
      shown.push(r)
    }
    const rows = shown.map(r => {
      const mark = MARK[r.status]
      const code = r.exitCode === undefined ? '' : ` (exit ${r.exitCode})`

      return (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={mark.color}>{mark.glyph} {r.status}</Text> {r.kind} · {r.tool} · {clockTime(r.at)} · {seconds(r.ms)}{code}
          </Text>
          <Text dimColor wrap="truncate-end">
            {'  '}{r.command}
          </Text>
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>
            {list.length} run{list.length === 1 ? '' : 's'} · {failed} failed{off ? ' · off' : ''}{' '}
          </Text>
          <Button key="clear" label="Clear" onPress={async () => void (await update($, runs, () => []))} />
        </Box>
        {list.length === 0 && <Text dimColor>No test, lint, build, format or check commands yet.</Text>}
        {rows}
        {shown.length < list.length && <Text dimColor>+{list.length - shown.length} older runs not shown</Text>}
      </Box>
    )
  })
}
