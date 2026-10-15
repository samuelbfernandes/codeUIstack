// tldr: while switched on, after each long reply a small model (Haiku) picks the sentences the reader must not skip and
// sums the reply up. The sentences are marked inside the reply (in bold) wherever the transcript draws them, and a
// box above the prompt shows Summary, Needs you and Next. One model call per long reply, run after the turn has ended,
// so nothing waits on it; nothing is added to the conversation. Off until `/tldr on` or the moddeck switch.
// FAIL OPEN: if anything here fails, the reply is drawn as it was and the box stays empty.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TldrDigest, TldrMode } from '../types'
import { HIGHLIGHT_COLORS, HIGHLIGHT_DEFAULT, SYSTEM, addMarks, isHighlightColor, markText, parseDigest, promptFor, splitBlocks, type HighlightColor } from './lib'

type Dollar = EngineInterface

const COMMAND = 'tldr'
const MODES: readonly TldrMode[] = ['highlight', 'summary']
const isOff = atom({ plugin: 'tldr', key: 'isOff' } as const, true)
const mode = atom({ plugin: 'tldr', key: 'mode' } as const, 'summary' as TldrMode)
const color = atom({ plugin: 'tldr', key: 'color' } as const, HIGHLIGHT_DEFAULT as HighlightColor)
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

/** The highlight colour the reader last chose (green by default). */
async function colorOf($: Dollar): Promise<HighlightColor> {
  try {
    const c = await $.store.get('color')
    return isHighlightColor(c) ? c : HIGHLIGHT_DEFAULT
  } catch {
    return HIGHLIGHT_DEFAULT
  }
}

/** `/tldr color <name>`: the tint of the paragraphs that hold a must-read sentence. */
async function setColor($: Dollar, word: string): Promise<string> {
  if (!isHighlightColor(word)) return `tldr · colour "${word.slice(0, 20)}" is not one of ${Object.keys(HIGHLIGHT_COLORS).join(', ')}`
  try {
    await $.store.set('color', word)
    await update($, color, () => word)
  } catch {
    return 'tldr · that did not work, nothing changed'
  }
  return `tldr · highlight colour · ${word}`
}

/** The mode the reader last chose (summary by default). */
async function modeOf($: Dollar): Promise<TldrMode> {
  try {
    const m = await $.store.get('mode')
    return MODES.find(x => x === m) ?? 'summary'
  } catch {
    return 'summary'
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
  return to ? `tldr · on · ${MODE_TEXT[await modeOf($)]}` : 'tldr · off'
}

/** `highlight` or `summary`: turns tldr on in that mode (the switch and the dropdown both use it). */
async function setMode($: Dollar, to: TldrMode): Promise<string> {
  try {
    await $.store.set('mode', to)
    await $.store.set('on', true)
    await update($, mode, () => to)
    await update($, isOff, () => false)
  } catch {
    return 'tldr · that did not work, nothing changed'
  }
  return `tldr · on · ${MODE_TEXT[to]}`
}

const MODE_TEXT: Record<TldrMode, string> = {
  highlight: 'highlight: must-read sentences are marked in the reply, no box',
  summary: 'summary: must-read sentences are marked, and a box above the prompt sums the reply up (one Haiku call each)',
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
      const isOnNow = await isOn($) // the switch and its mode outlive the session
      const modeNow = await modeOf($)
      const colorNow = await colorOf($)
      await update($, isOff, () => !isOnNow)
      await update($, mode, () => modeNow)
      await update($, color, () => colorNow)
    } catch {
      // reads as off
    }
    try {
      await $.command.register({ name: COMMAND, description: 'Mark what you must not skip in long replies: /tldr [highlight|summary|on|off]', argumentHint: '[highlight|summary|on|off]', immediate: true })
    } catch {
      // the side bar switch still works
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'on' || word === 'off') return { text: await flip($, word === 'on') }
    if (word === 'highlight' || word === 'summary') return { text: await setMode($, word) }
    if (word.startsWith('color')) return { text: await setColor($, word.slice('color'.length).trim()) }
    if (word === '' || word === 'status') return { text: ((await isOn($)) ? `tldr · on · ${MODE_TEXT[await modeOf($)]}` : 'tldr · off') + ` · colour ${await colorOf($)}` }
    return { text: `tldr · unknown word "${e.args.trim().slice(0, 30)}" · use /tldr highlight, /tldr summary, /tldr color <name>, /tldr on or /tldr off` }
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

  // The reply itself: each must-read sentence in bold, so it stands out while scrolling.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const list = await read($, marks)
    const marked = markText(e.props.text, list)
    if (marked === undefined) return next(e)
    // The terminal draws the rewritten markdown (in bold). The app also tints each paragraph holding a must-read
    // sentence pale yellow: the reply is drawn here paragraph by paragraph, the marked ones on the tint.
    if (e.surface !== 'desktop') return next({ ...e, props: { ...e.props, text: marked } })
    const { Box, Markdown } = $.ui.resolve(e)
    const tint = HIGHLIGHT_COLORS[await read($, color)]
    return (
      <Box key="tldr-reply" flexDirection="column" gap={1}>
        {splitBlocks(marked).map((block, i) =>
          list.some(m => block.includes(`**${m}**`)) ? (
            <Box key={`tldr-p${i}`} backgroundColor={tint}>
              <Markdown text={block} />
            </Box>
          ) : (
            <Markdown key={`tldr-p${i}`} text={block} />
          ),
        )}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // The box above the prompt: Summary, Needs you, Next; ▾ folds it to one line, ✕ puts it away until the next reply.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const d = await read($, digest)
    if (d === null || !(await isOn($)) || (await read($, mode)) !== 'summary' || e.props.hasSurvey) return next(e)
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
