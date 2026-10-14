// concise: while switched on, every prompt carries rules that shape Claude's reply so the reader can act on it (the next
// action first, numbered steps, state restated, no tangents, specific time estimates, visible wins). The full rules go
// with the first prompt of a session, the first after switching on and the first after a compaction; later prompts
// carry one reminder line, so the rules sit in the conversation once. Off until `/concise on` or the side bar switch.
// A prompt that is just "stop concise mode" or "normal mode" switches it off.
// FAIL OPEN: if anything here fails, the prompt goes through unchanged.
import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { OFF_NOTE, REMINDER, RULES, isStopPhrase } from './rules'

type Dollar = EngineInterface

const COMMAND = 'concise'

/** True while off (it ships off). The persisted switch is `$.store` 'on'. */
const isOff = atom({ plugin: 'concise', key: 'isOff' } as const, true)

// Whether the full rules are already in this conversation: cleared by a session start, a compaction and switching on.
let hasRules = false

async function isOn($: Dollar): Promise<boolean> {
  try {
    return (await $.store.get('on')) === true
  } catch {
    return false
  }
}

async function flip($: Dollar, to: boolean): Promise<string> {
  try {
    if (to) await $.store.set('on', true)
    else await $.store.delete('on')
    await update($, isOff, () => !to)
  } catch {
    return 'concise · that did not work, nothing changed'
  }
  if (to) hasRules = false
  return to ? 'concise · on · replies lead with the next action' : 'concise · off'
}

async function runCommand($: Dollar, args: string): Promise<string> {
  const word = args.trim().toLowerCase().replace(/\.$/, '').trim()
  if (word === '' || word === 'status') return (await isOn($)) ? 'concise · on' : 'concise · off'
  if (word === 'on' || word === 'off') return flip($, word === 'on')
  return `concise · unknown word "${args.trim().slice(0, 30)}" · use /concise on or /concise off, nothing changed`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    hasRules = false
    try {
      const stored = (await $.store.get('on')) === true // the switch outlives the session
      await update($, isOff, () => !stored)
    } catch {
      // the switch then reads as off
    }
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Action-first replies: the next action first, numbered steps, no tangents: /concise [on|off]',
        argumentHint: '[on|off]',
        immediate: true,
      })
    } catch {
      // fail-open: without the command the side bar switch still works
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await runCommand($, e.args) })).catch(() => ({
    text: 'concise · that did not work, nothing changed',
  }))

  on('prompt.submit', async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    if (isStopPhrase(e.text)) {
      const said = await flip($, false)
      return next(said === 'concise · off' ? { ...e, context: [...(e.context ?? []), OFF_NOTE] } : e)
    }
    const note = hasRules ? REMINDER : RULES
    hasRules = true
    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e)) // fail open; if `next` already ran this replays its result

  // A compaction summarises the rules away: the next prompt carries them in full again.
  on('session.compact', async ($, e, next) => {
    const out = await next(e)
    const done = e.agentId === undefined && e.trigger !== 'precompute' && typeof (out as { skip?: unknown } | undefined)?.skip !== 'string'
    if (done) hasRules = false
    return out
  }).catch(($, e, next) => next(e))
}
