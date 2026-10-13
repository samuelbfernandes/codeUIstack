// error-inbox: keeps the last 30 tool calls of the session that failed (the tool answered an error), were denied (the
// person or a permission rule said no) or were refused (a hook turned them down), with the tool, the command or file
// path (never file contents) and the error cut to 600 characters, secrets replaced by ***. `/error-inbox` shows them in
// a pane, newest first, with Clear, and per entry an "Ask Claude" button that drafts a prompt (not sent) asking Claude
// to explain that error. Memory only.
// FAIL OPEN: it never blocks or changes a call; if recording fails, the result goes back to the model untouched.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface, Register } from 'claude-code'

import type { ErrorInboxEntry } from '../types'
import { clockTime, cut, draftFor, failureOf, inputSummary, scrub } from './lib'

type Dollar = EngineInterface

const COMMAND = 'error-inbox'
const PANE = 'error-inbox'
const KEEP = 30
/** About how many characters the pane draws, newest entries first. */
const BUDGET = 9000

const entries = atom({ plugin: 'error-inbox', key: 'entries' } as const, [])
const isOff = atom({ plugin: 'error-inbox', key: 'isOff' } as const, false)

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
  const list = await read($, entries)
  const last = list[list.length - 1]
  const lines = [`error-inbox · ${(await isSwitchedOff($)) ? 'off' : 'on'} · ${list.length} kept`]
  if (last !== undefined) lines.push(`Last: ${last.kind} · ${last.tool} · ${clockTime(last.at)}`)

  return lines.join('\n')
}

async function run($: Dollar, args: string): Promise<string> {
  const word = args.trim().toLowerCase()
  if (word === 'status') return status($)
  if (word === 'clear') {
    await update($, entries, () => [])

    return 'error-inbox · cleared'
  }
  if (word === 'on' || word === 'off') {
    try {
      await setSwitch($, word === 'off')
    } catch {
      return 'error-inbox · that did not work, nothing changed'
    }

    return word === 'on' ? 'error-inbox · on' : 'error-inbox · off · /error-inbox on keeps errors again'
  }
  if (word !== '') return `error-inbox · unknown option “${word.slice(0, 30)}”\nUse /error-inbox, or /error-inbox on, off, clear or status.`
  await $.ui.open({ id: PANE, title: 'Errors', columns: 80 })

  return status($)
}

async function record($: Dollar, tool: string, input: Record<string, unknown>, ran: Parameters<typeof failureOf>[0]): Promise<void> {
  const failure = failureOf(ran)
  if (failure === undefined || (await isSwitchedOff($))) return
  const at = await $.clock.now()
  counter += 1
  const entry: ErrorInboxEntry = {
    id: `${at}-${counter}`,
    tool: cut(tool, 80),
    kind: failure.kind,
    input: inputSummary(input),
    error: cut(scrub(failure.text).trim(), 600),
    at,
  }
  await update($, entries, list => [...list, entry].slice(-KEEP))
}

/** Puts the draft in the prompt box without sending it; where the box cannot take it, on the clipboard instead. */
async function ask($: Dollar, entry: ErrorInboxEntry, surface: RenderSurface): Promise<void> {
  const draft = draftFor(entry)
  let isFilled = false
  try {
    const box = await $.prompt.read()
    const isEmpty = box.text.trim() === ''
    isFilled = (await $.prompt.fill({ text: isEmpty ? draft : `\n\n${draft}`, mode: isEmpty ? 'replace' : 'append' })).isFilled
  } catch {
    isFilled = false
  }
  if (isFilled) {
    $.ui.toast('error-inbox: a draft is in the prompt box; edit it or press Enter to send')

    return
  }
  const copied = await $.ui.copy({ text: draft, surface }).catch(() => ({ isCopied: false as const }))
  $.ui.toast(copied.isCopied ? 'error-inbox: the prompt box was busy, so the draft is on the clipboard' : 'error-inbox: could not reach the prompt box or the clipboard')
}

const KIND_COLOR: Record<ErrorInboxEntry['kind'], string> = { failed: 'red', denied: 'yellow', refused: 'yellow' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const stored = (await $.store.get('off')) === true
      await update($, isOff, () => stored)
    } catch {
      // reads as on
    }
    try {
      await $.command.register({ name: COMMAND, description: 'Show the failed or refused tool calls of this session', argumentHint: '[on|off|clear|status]' })
    } catch {
      // fail-open: the session goes on without the command
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, e.args) })).catch(() => ({
    text: 'error-inbox · could not read its own state',
  }))

  // Watches only: the call runs as the model made it and its result goes back unchanged.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      await record($, String(e.tool), e as unknown as Record<string, unknown>, ran)
    } catch {
      // an inbox problem never reaches the model
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, entries)
    const off = await isSwitchedOff($)
    let budget = BUDGET
    const shown: ErrorInboxEntry[] = []
    for (const entry of [...list].reverse()) {
      budget -= entry.error.length + entry.input.length + 80
      if (budget < 0) break
      shown.push(entry)
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>
            {list.length} error{list.length === 1 ? '' : 's'}{off ? ' · off' : ''}{' '}
          </Text>
          <Button key="clear" label="Clear" onPress={async () => void (await update($, entries, () => []))} />
        </Box>
        {list.length === 0 && <Text dimColor>No failed or refused tool calls yet.</Text>}
        {shown.map(entry => (
          <Box flexDirection="column">
            <Box>
              <Text wrap="truncate-end">
                <Text color={KIND_COLOR[entry.kind]}>{entry.kind}</Text> · {entry.tool} · {clockTime(entry.at)}{' '}
              </Text>
              <Button key={`ask:${entry.id}`} label="Ask Claude" plain onPress={() => ask($, entry, e.surface)} />
            </Box>
            {entry.input !== '' && <Text wrap="truncate-end">  {entry.input}</Text>}
            <Text dimColor>  {entry.error}</Text>
          </Box>
        ))}
        {shown.length < list.length && <Text dimColor>+{list.length - shown.length} older not shown</Text>}
      </Box>
    )
  })
}
