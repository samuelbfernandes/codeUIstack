// tldr: while switched on, after each long reply a small model (Haiku) picks the sentences the reader must not skip and
// sums the reply up. The sentences are marked inside the reply (bold, with ⚑) wherever the transcript draws them, and a
// box above the prompt shows Summary, Needs you and Next. One model call per long reply, run after the turn has ended,
// so nothing waits on it; nothing is added to the conversation. Off until `/tldr on` or the moddeck switch.
// FAIL OPEN: if anything here fails, the reply is drawn as it was and the box stays empty.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TldrDigest } from '../types'
import { SYSTEM, addMarks, markText, parseDigest, promptFor } from './lib'

type Dollar = EngineInterface

const COMMAND = 'tldr'
const isOff = atom({ plugin: 'tldr', key: 'isOff' } as const, true)
const digest = atom({ plugin: 'tldr', key: 'digest' } as const, null as TldrDigest | null)
const marks = atom({ plugin: 'tldr', key: 'marks' } as const, [] as string[])
const isFolded = atom({ plugin: 'tldr', key: 'isFolded' } as const, false)

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
    if (!to) await update($, digest, () => null)
  } catch {
    return 'tldr · that did not work, nothing changed'
  }
  return to ? 'tldr · on · long replies get a summary above the prompt and ⚑ on what you must not skip (one Haiku call each)' : 'tldr · off'
}

/** One small-model call over the reply; the digest and its must-read sentences replace the last ones. */
async function digestReply($: Dollar, reply: string): Promise<void> {
  try {
    const r = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt: promptFor(reply), maxTokens: 700, timeoutMs: 60_000 })
    if (!r.isAnswered) return
    const d = parseDigest(r.text, reply)
    if (d === undefined) return
    await update($, digest, () => d)
    await update($, isFolded, () => false)
    if (d.mustRead.length > 0) await update($, marks, list => addMarks(list, d.mustRead))
  } catch {
    // fail open: no box this time
  }
}

export const register: Register = (on, options) => {
  const minChars = typeof options.minChars === 'number' && options.minChars >= 200 ? options.minChars : 800

  on('session.start', async ($, e, next) => {
    try {
      const isOnNow = await isOn($) // the switch outlives the session
      await update($, isOff, () => !isOnNow)
    } catch {
      // reads as off
    }
    try {
      await $.command.register({ name: COMMAND, description: 'Sum up long replies and flag what you must not skip: /tldr [on|off]', argumentHint: '[on|off]', immediate: true })
    } catch {
      // the side bar switch still works
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'on' || word === 'off') return { text: await flip($, word === 'on') }
    if (word === '' || word === 'status') return { text: (await isOn($)) ? 'tldr · on' : 'tldr · off' }
    return { text: `tldr · unknown word "${e.args.trim().slice(0, 30)}" · use /tldr on or /tldr off` }
  }).catch(() => ({ text: 'tldr · that did not work, nothing changed' }))

  // A long answer of the main conversation: digest it once the turn is over (a timer, so the turn never waits).
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      if (e.agentId === undefined && e.reason === 'answer' && !e.isAborted && e.answer.length >= minChars && (await isOn($))) {
        const reply = e.answer
        $.clock.after(1, () => void digestReply($, reply))
      }
    } catch {
      // fail open
    }
    return r
  })

  // /clear starts a new conversation: its marks and box go with the old one.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, digest, () => null).catch(() => undefined)
      await update($, marks, () => []).catch(() => undefined)
    }
    return next(e)
  })

  // The reply itself: each must-read sentence in bold with ⚑, so it stands out while scrolling.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const marked = markText(e.props.text, await read($, marks))
    return marked === undefined ? next(e) : next({ ...e, props: { ...e.props, text: marked } })
  }).catch(($, e, next) => next(e))

  // The box above the prompt: Summary, Needs you, Next; ▾ folds it to one line, ✕ puts it away until the next reply.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const d = await read($, digest)
    if (d === null || !(await isOn($)) || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const folded = await read($, isFolded)
    const head = (
      <Box key="tldr-head" columnGap={1}>
        <Button key="tldr:fold" plain onPress={() => void update($, isFolded, f => !f)}>
          <Text bold color="suggestion">{folded ? '▸ TL;DR' : '▾ TL;DR'}</Text>
        </Button>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap={folded ? 'truncate-end' : 'wrap'}>{d.summary}</Text>
        </Box>
        <Button key="tldr:close" plain onPress={() => void update($, digest, () => null)}>
          <Text dimColor>✕</Text>
        </Button>
      </Box>
    )
    const line = (key: string, label: string, items: string[], color?: string) =>
      items.length > 0 && (
        <Box key={key} columnGap={1}>
          <Text bold color={color}>{label}</Text>
          <Box flexShrink={1}>
            <Text wrap="wrap">{items.join(' · ')}</Text>
          </Box>
        </Box>
      )
    const box = (
      <Box key="tldr-box" flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
        {head}
        {!folded && (line('tldr-needs', '⚑ Needs you', d.needs, 'warning') as never)}
        {!folded && (line('tldr-next', '→ Next', d.next) as never)}
      </Box>
    )
    let below: unknown
    try {
      below = await next(e)
    } catch {
      below = undefined
    }
    return below !== null && typeof below === 'object' ? (
      <Box key="tldr-band" flexDirection="column">
        {box}
        {below as never}
      </Box>
    ) : (
      box
    )
  }).catch(($, e, next) => next(e))
}
