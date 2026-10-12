import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { lastMermaid } from './extract'
import { drawDiagram } from './render'

const PANE = 'diagram'
const HINT = 'Diagram · /diagram to see it'
const FAILED = 'Diagram · could not open'

// The last mermaid block of a final answer, as text. A drawing reads it, so a new answer redraws an open pane.
const last = atom({ plugin: 'diagram', key: 'last' } as const, null)

async function isPaneOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

/** What `/diagram` does. The text is a headline and at most one dim detail line. */
async function openDiagram($: EngineInterface): Promise<string> {
  if ((await read($, last)) === null) return 'Diagram · nothing to show yet\nNo mermaid diagram in an answer so far.'
  const opened = await $.ui.open({ id: PANE, title: 'Diagram', focus: true, closeOnEscape: true })
  if (!opened.isPlaced) return 'Diagram · no room for the pane\nTry a wider window.'

  return 'Diagram · open'
}

async function closeDiagram($: EngineInterface): Promise<string> {
  if (!(await isPaneOpen($))) return 'Diagram · not open'
  await $.ui.close({ id: PANE })

  return 'Diagram · closed'
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'diagram',
      description: "Draw the last mermaid diagram from Claude's answer in a pane",
      argumentHint: '[close]',
    })

    return next(e)
  })

  // A /clear ends the conversation the diagram belongs to.
  on('session.end', async ($, e, next) => {
    await update($, last, () => null)

    return next(e)
  }).catch(($, e, next) => next(e)) // observational: never get in the way of ending

  on('command.run', { command: 'diagram' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === '') return { text: await openDiagram($) }
    if (arg === 'close') return { text: await closeDiagram($) }

    return { text: 'Diagram · /diagram opens it, /diagram close hides it' }
  }).catch(() => ({ text: FAILED }))

  // Remembers the last mermaid block of the answer and, at most once per turn, hints that it can be drawn. Nothing else:
  // no tokens, no pane. Fail-open and observational: an error here never touches the turn or its answer. Subagent
  // turns and turns that did not end in an answer are ignored.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') await remember($, e.answer, options.hint !== false).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const close = <Button key="close" label="Close" hotkey="c" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
    const source = await read($, last)
    if (source === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Nothing to show yet</Text>
          {close}
        </Box>
      )
    }
    const drawing = drawDiagram(source, e.props.bodyColumns)

    // One Text per row, never wrapped: a wrapped row would break the drawing.
    return (
      <Box flexDirection="column">
        {drawing.title !== '' && <Text bold>{`Diagram · ${drawing.title}`}</Text>}
        {drawing.lines.map((line, i) => (
          <Text key={`row${i}`} wrap="truncate-end">
            {line === '' ? ' ' : line}
          </Text>
        ))}
        <Box gap={1}>
          {drawing.isDrawn && <Text dimColor>Simple built-in drawing</Text>}
          {close}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}

async function remember($: EngineInterface, answer: string, isHintOn: boolean): Promise<void> {
  const source = lastMermaid(answer)
  if (source === undefined) return
  await update($, last, () => source)
  // A pane that is open redraws by itself; a plain `-p` run has nobody looking.
  if (!isHintOn || (await isPaneOpen($)) || (await $.session.surfaces()).length === 0) return
  $.ui.toast(HINT)
}
