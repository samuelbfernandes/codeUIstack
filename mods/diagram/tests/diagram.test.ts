import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FENCE, FLOW, answer, mountPane, slash, start, typed, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const
const HINT = 'Diagram · type diagram to see it'
const PIE = `${FENCE}mermaid\npie\n  "Dogs" : 3\n  "Cats" : 1\n${FENCE}`

const names = (w: ReturnType<typeof world>) => w.panes.map(pane => pane.id)

/** The text rows of a mounted pane, in order. */
async function rows(ui: { findAll: (q: { type: 'Text' }) => Promise<{ text?: string }[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Text' })).map(found => found.text ?? '')
}

// ---- remembering and the hint ----------------------------------------------------------------------------------

test('registers /diagram at session start', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toContain('diagram')
})

test('an answer with a diagram earns one hint and opens nothing', async ($, on) => {
  const w = world(on)
  await start($)
  expect((await answer($, `Here it is:\n${FLOW}`)).text).toContain('Here it is')
  expect(w.toasts).toEqual([HINT])
  expect(names(w)).toEqual([])
  expect(w.opens).toEqual([])
})

test('an answer without a diagram is left alone: no hint, nothing remembered', async ($, on) => {
  const w = world(on)
  await start($)
  await answer($, 'Just words, and `code`.')
  expect(w.toasts).toEqual([])
  expect((await typed($, 'diagram')).drop).toBe('Diagram · nothing to show yet')
})

test('the hint is once per turn, however many diagrams the answer holds', async ($, on) => {
  const w = world(on)
  await start($)
  await answer($, `${FLOW}\nand\n${PIE}`)
  expect(w.toasts).toEqual([HINT])
  await answer($, FLOW)
  expect(w.toasts).toEqual([HINT, HINT])
})

test('the setting hint = false silences the hint but still remembers the diagram', { options: { hint: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await answer($, FLOW)
  expect(w.toasts).toEqual([])
  expect((await typed($, 'diagram')).drop).toBe('Diagram · open')
})

test('no hint while the pane is open, where nobody looks, and for subagents or turns that did not answer', async ($, on) => {
  const w = world(on)
  await start($)
  await answer($, FLOW)
  await typed($, 'diagram')
  w.toasts.length = 0
  await answer($, PIE) // the open pane redraws by itself
  expect(w.toasts).toEqual([])
  await typed($, 'diagram close')

  w.surfaces.list = []
  await answer($, FLOW) // a plain -p run
  expect(w.toasts).toEqual([])
  w.surfaces.list = ['terminal']

  await answer($, FLOW, { agentId: 'sub-1' })
  await answer($, FLOW, { reason: 'aborted', isAborted: true })
  expect(w.toasts).toEqual([])
})

test('a subagent answer or an aborted turn does not replace the remembered diagram', async ($, on) => {
  const w = world(on)
  await start($)
  await answer($, FLOW)
  await answer($, PIE, { agentId: 'sub-1' })
  await typed($, 'diagram')
  const ui = await mountPane($, 'terminal')
  expect((await rows(ui)).join('\n')).toContain('Start')
  expect((await rows(ui)).join('\n')).not.toContain('Dogs')
  await ui.unmount()
  expect(names(w)).toEqual(['diagram'])
})

test('a failing toast or surfaces read never touches the turn', async ($, on) => {
  const w = world(on)
  await start($)
  w.surfaces.list = null as never // the surfaces read throws inside the hint
  expect((await answer($, `ok\n${FLOW}`)).text).toContain('ok')
  expect(w.toasts).toEqual([])
  w.surfaces.list = ['terminal']
  expect((await typed($, 'diagram')).drop).toBe('Diagram · open') // the diagram was remembered before the hint failed
})

test('a /clear forgets the diagram', async ($, on) => {
  world(on)
  await start($)
  await answer($, FLOW)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
  expect((await typed($, 'diagram')).drop).toBe('Diagram · nothing to show yet')
})

// ---- the words and the command ---------------------------------------------------------------------------------

test('diagram before any diagram says so, in one line plus a dim note, and opens nothing', async ($, on) => {
  const w = world(on)
  await start($)
  const out = await typed($, 'diagram')
  expect(out.drop).toBe('Diagram · nothing to show yet')
  expect(out.text).toBeUndefined()
  expect(w.logs).toEqual(['No mermaid diagram in an answer so far.'])
  expect(names(w)).toEqual([])
})

test('diagram opens the pane and diagram close closes it, both dropped before the model', async ($, on) => {
  const w = world(on)
  await start($)
  await answer($, FLOW)
  const opened = await typed($, 'diagram')
  expect(opened.drop).toBe('Diagram · open')
  expect(opened.text).toBeUndefined()
  expect(names(w)).toEqual(['diagram'])
  expect(w.opens).toEqual([{ id: 'diagram', title: 'Diagram', focus: true, closeOnEscape: true }])
  expect((await typed($, 'diagram close')).drop).toBe('Diagram · closed')
  expect(names(w)).toEqual([])
  expect((await typed($, 'diagram close')).drop).toBe('Diagram · not open')
})

test('the words ignore case, spaces around them, one final full stop and doubled spaces', async ($, on) => {
  const w = world(on)
  await start($)
  await answer($, FLOW)
  for (const text of ['Diagram', '  DIAGRAM.  ', 'diagram.']) expect((await typed($, text)).drop).toBe('Diagram · open')
  for (const text of ['Diagram Close', 'diagram  close.']) {
    await typed($, 'diagram')
    expect((await typed($, text)).drop).toBe('Diagram · closed')
  }
  expect(names(w)).toEqual([])
})

test('only the exact words are taken: sentences, other senders and attachments pass through', async ($, on) => {
  const w = world(on)
  await start($)
  await answer($, FLOW)
  for (const text of ['draw the diagram', 'diagram please', 'diagrams', 'diagram closed', 'close diagram', 'diagram?', '/diagram now', 'show diagram close']) {
    const out = await typed($, text)
    expect(out.drop).toBeUndefined()
    expect(out.text).toBe(text)
  }
  expect((await typed($, 'diagram', { origin: { kind: 'scheduled-trigger' } })).drop).toBeUndefined()
  expect((await typed($, 'diagram', { attachments: [{ type: 'image', data: 'x' }] })).drop).toBeUndefined()
  expect(names(w)).toEqual([])
})

test('/diagram does what the word does', async ($, on) => {
  const w = world(on)
  await start($)
  expect((await slash($)).text).toBe('Diagram · nothing to show yet\nNo mermaid diagram in an answer so far.')
  await answer($, FLOW)
  expect((await slash($)).text).toBe('Diagram · open')
  expect(names(w)).toEqual(['diagram'])
  expect((await slash($, ' CLOSE ')).text).toBe('Diagram · closed')
  expect(names(w)).toEqual([])
  expect((await slash($, 'sideways')).text).toBe('Diagram · /diagram opens it, /diagram close hides it')
})

test('a pane that has no room says so', async ($, on) => {
  const w = world(on)
  await start($)
  await answer($, FLOW)
  w.open.isPlaced = false
  const out = await typed($, 'diagram')
  expect(out.drop).toBe('Diagram · no room for the pane')
  expect(w.logs).toEqual(['Try a wider window.'])
})

test('a pane that cannot be opened still drops the word, with a notice', async ($, on) => {
  const w = world(on)
  await start($)
  await answer($, FLOW)
  Object.defineProperty(w.open, 'isPlaced', {
    get: () => {
      throw new Error('boom')
    },
  })
  expect((await typed($, 'diagram')).drop).toBe('Diagram · could not open')
  expect((await slash($)).text).toBe('Diagram · could not open')
})

test('no drop reason has a newline', async ($, on) => {
  const w = world(on)
  await start($)
  for (const text of ['diagram', 'diagram close']) expect((await typed($, text)).drop).not.toContain('\n')
  await answer($, FLOW)
  w.open.isPlaced = false
  expect((await typed($, 'diagram')).drop).not.toContain('\n')
})

// ---- the pane ---------------------------------------------------------------------------------------------------

for (const surface of SURFACES) {
  test(`the pane draws the last diagram as box art (${surface})`, async ($, on) => {
    world(on)
    await start($, surface)
    await answer($, FLOW)
    await typed($, 'diagram')
    const ui = await mountPane($, surface)
    expect(await rows(ui)).toEqual([
      'Diagram · Flowchart',
      '┌───────┐',
      '│ Start │',
      '└───┬───┘',
      '    │',
      '    ▼',
      ' ┌─────┐',
      ' │ End │',
      ' └─────┘',
      'Simple built-in drawing',
    ])
    expect(await ui.find({ type: 'Button', key: 'close' })).toBeDefined()
    await ui.unmount()
  })

  test(`a new answer redraws an open pane, and one without a diagram keeps the old one (${surface})`, async ($, on) => {
    world(on)
    await start($, surface)
    await answer($, FLOW)
    await typed($, 'diagram')
    const ui = await mountPane($, surface)
    expect((await rows(ui))[0]).toBe('Diagram · Flowchart')
    await answer($, PIE)
    expect((await rows(ui))[0]).toBe('Diagram · Pie chart')
    await answer($, 'no diagram this time')
    expect((await rows(ui))[0]).toBe('Diagram · Pie chart')
    await ui.unmount()
  })

  test(`a narrow pane wraps the boxes to its width (${surface})`, async ($, on) => {
    world(on)
    await start($, surface)
    await answer($, `${FENCE}mermaid\nflowchart TD\n  A[A fairly long sentence in a box] --> B[Short]\n${FENCE}`)
    const ui = await mountPane($, surface, { bodyColumns: 20 })
    const drawn = await rows(ui)
    expect(drawn).toContain('│ A fairly long │')
    const art = drawn.filter(row => /[┌│└]/.test(row))
    expect(Math.max(...art.map(row => row.length))).toBeLessThanOrEqual(20)
    await ui.unmount()
  })

  test(`a kind that is not drawn shows the headline and the source in a box (${surface})`, async ($, on) => {
    world(on)
    await start($, surface)
    await answer($, `${FENCE}mermaid\nclassDiagram\n  A <|-- B\n${FENCE}`)
    const ui = await mountPane($, surface)
    expect(await rows(ui)).toEqual([
      'Diagram · classDiagram is not drawn here',
      ' ',
      '┌──────────────┐',
      '│ classDiagram │',
      '│   A <|-- B   │',
      '└──────────────┘',
    ])
    await ui.unmount()
  })

  test(`with nothing remembered the pane says so and still closes (${surface})`, async ($, on) => {
    const w = world(on)
    await start($, surface)
    const ui = await mountPane($, surface)
    expect(await rows(ui)).toEqual(['Nothing to show yet'])
    w.panes.push({ id: 'diagram', title: 'Diagram', isShown: true, isFocused: false, isPlaced: true })
    await ui.press({ key: 'close' })
    expect(names(w)).toEqual([])
    await ui.unmount()
  })

  test(`the Close button closes the pane (${surface})`, async ($, on) => {
    const w = world(on)
    await start($, surface)
    await answer($, FLOW)
    await typed($, 'diagram')
    const ui = await mountPane($, surface)
    await ui.press({ key: 'close' })
    expect(names(w)).toEqual([])
    await ui.unmount()
  })
}

test('a huge diagram in the pane is cut to the size cap and still shows something', async ($, on) => {
  world(on)
  await start($)
  await answer($, `${FENCE}mermaid\nflowchart TD\n${'  A --> B\n'.repeat(5000)}${FENCE}`)
  const ui = await mountPane($, 'terminal')
  expect((await rows(ui)).length).toBeGreaterThan(1)
  await ui.unmount()
})

test('without the hint or the pane the plugin spends nothing: no ui.open on answers', async ($: Engine, on) => {
  const w = world(on)
  await start($)
  for (let i = 0; i < 3; i++) await answer($, FLOW)
  expect(w.opens).toEqual([])
})
