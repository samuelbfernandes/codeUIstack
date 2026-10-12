import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register } from 'claude-code'

import type { AsideEntry } from '../types'
import {
  NO_ANSWER,
  addEntry,
  buildPrompt,
  cutAnswer,
  footer,
  headline,
  isRunning,
  maxCharsOf,
  nextId,
  patchEntry,
  tokensOf,
  whyNot,
} from './lib'
import { dropWith } from './reply'
import { plainWord } from './words'

type Dollar = EngineInterface

const PANE = 'aside'
const COMMAND = 'aside'
/** Typed alone, this shows how /aside works. It never asks anything: asking costs model credit, so it needs /aside + a question. */
const PLAIN_WORD = 'aside'
const OFF = 'Aside is off · turn it on in the plugin settings'
const HELP_FAILED = "Aside · couldn't show the help"

const asides = atom({ plugin: 'aside', key: 'asides' } as const, [])

type Cfg = { isEnabled: boolean; maxChars: number }

/** The pane opens for the person's own command, so it is placed at any width; focus and Esc are requests only. */
const openPane = ($: Dollar) => $.ui.open({ id: PANE, title: 'Aside', focus: true, closeOnEscape: true })

/** What a finished fork becomes in the pane: the answer (cut to the setting), or why there is none. */
function outcome(r: ModelForkResult, maxChars: number): Partial<AsideEntry> {
  if (!r.isAnswered) return { status: 'failed', note: whyNot(r) }
  if (r.text.trim() === '') return { status: 'failed', note: whyNot({ reason: 'empty-reply' }) }
  const { text, isCut } = cutAnswer(r.text, maxChars)
  return { status: 'done', answer: text, isCut, tokens: tokensOf(r.usage) }
}

/**
 * The side question itself, run from a timer so the command returns at once and the person can keep typing.
 * `$.model.fork` answers over the main thread's cached context with every tool denied, and what it says goes
 * to this pane only: nothing is appended to the conversation, so the main thread never reads it.
 */
async function ask($: Dollar, cfg: Cfg, id: number, question: string): Promise<void> {
  let patch: Partial<AsideEntry>
  try {
    patch = outcome(await $.model.fork({ prompt: buildPrompt(question) }), cfg.maxChars)
  } catch {
    patch = { status: 'failed', note: 'The request could not be sent' }
  }
  await update($, asides, list => patchEntry(list, id, patch))
  try {
    // The pane may have been closed while it thought: say once that the answer is waiting.
    if (!(await $.ui.panes()).some(p => p.id === PANE)) $.ui.toast('Aside · answer ready · /aside shows it')
  } catch {
    // a missing toast is harmless
  }
}

/** `/aside` with no question and the plain word: how it works (free, local); past asides come back into view. */
async function help($: Dollar, cfg: Cfg): Promise<string> {
  if (!cfg.isEnabled) return OFF
  const kept = (await read($, asides)).length
  if (kept > 0) await openPane($)
  return [
    kept > 0 ? `Aside · ${kept} kept in the pane` : 'Aside · ask a side question without touching this conversation',
    'Type /aside and your question · the answer opens in a pane · it uses a little model credit, never added to the conversation',
  ].join('\n')
}

/** What `/aside <question>` does: opens the pane, starts the fork, returns one short line. */
async function runAside($: Dollar, cfg: Cfg, args: string): Promise<string> {
  if (!cfg.isEnabled) return OFF
  const question = args.trim()
  if (question === '') return help($, cfg)

  const now = await $.clock.now()
  if (isRunning(await read($, asides), now)) return 'Aside · one is still thinking'
  // Open first: if there is no room to show the answer, no credit is spent.
  const opened = await openPane($)
  if (!opened.isPlaced) return 'Aside · no room for the pane\nTry a wider terminal, or /tui fullscreen.'

  const id = nextId(await read($, asides))
  await update($, asides, list => addEntry(list, { id, at: now, question, status: 'thinking', answer: '', isCut: false, tokens: null, note: '' }))
  $.clock.after(1, () => void ask($, cfg, id, question).catch(() => undefined))
  return 'Aside · thinking · the answer is in the pane'
}

export const register: Register = (on, options) => {
  const cfg: Cfg = { isEnabled: options.enabled !== false, maxChars: maxCharsOf(options.maxAnswerChars) }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Ask a quick side question; the answer opens in a pane and is not added to the conversation: /aside <question>',
        argumentHint: '<question>',
        immediate: true,
      })
    } catch {
      // fail-open: without the command the mod is simply quiet
    }
    return next(e)
  })

  // A /clear or a new conversation ends what the asides were about.
  on('session.end', async ($, e, next) => {
    try {
      await update($, asides, () => [])
    } catch {
      // observational: never get in the way of ending
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await runAside($, cfg, e.args) })).catch(() => ({
    text: NO_ANSWER,
  }))

  // The plain word only explains (local, free, dropped so the model never sees it). A prompt that merely contains
  // the word, or any other sender, is left alone. Asking has no plain word: it spends model credit, so it stays /aside.
  // Fail-open: if even the explanation throws, the prompt still passes untouched.
  on('prompt.submit', async ($, e, next) => {
    if (plainWord(e) !== PLAIN_WORD) return next(e)
    return dropWith(note => $.ui.log(note), await help($, cfg).catch(() => HELP_FAILED))
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const list = await read($, asides)
    const { Box, Button, Text } = $.ui.resolve(e)
    const close = <Button key="close" label="Close" hotkey="c" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No side questions yet · /aside your question</Text>
          {close}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {list.map(a => (
          <Box key={`aside:${a.id}`} flexDirection="column">
            <Text bold>{headline(a.question)}</Text>
            {a.status === 'thinking' && <Text dimColor>Thinking…</Text>}
            {a.status === 'done' && <Text>{a.answer}</Text>}
            {a.status === 'done' && a.isCut && <Text dimColor>Answer shortened to fit the setting</Text>}
            {a.status === 'done' && <Text dimColor>{footer(a.tokens)}</Text>}
            {a.status === 'failed' && <Text>{NO_ANSWER}</Text>}
            {a.status === 'failed' && a.note !== '' && <Text dimColor>{a.note}</Text>}
          </Box>
        ))}
        {close}
      </Box>
    )
  })
}
