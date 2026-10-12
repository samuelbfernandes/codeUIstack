import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FULLSCREEN, PANE_PROPS, runCommand, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const mountPane = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: 'filetree', surface, component: 'Pane', requestId: 'filetree', props: PANE_PROPS, viewport: FULLSCREEN })

type Mounted = Awaited<ReturnType<typeof mountPane>>

const row = (ui: Mounted, name: string) =>
  ui.find({ type: 'Text', text: new RegExp(`(^|\\s)${name.replace(/[.]/g, '\\.')}$`) })

const read = ($: Engine, file_path: string) => $.tool.call({ tool: 'Read', file_path })
const edit = ($: Engine, file_path: string) =>
  $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })

for (const surface of SURFACES) {
  test(`a read lights the file and opens the folders above it (${surface})`, async ($, on) => {
    world(on)
    await runCommand($)
    const ui = await mountPane($, surface)
    expect(await row(ui, 'e.R')).toBeUndefined()
    await read($, '/proj/src/deep/deeper/e.R')
    const lit = await row(ui, 'e.R')
    expect(lit?.text).toMatch(/^\s+\u25cb e\.R$/)
    expect(lit?.props.color).toBe('cyan')
    await ui.unmount()
  })
}

test('edits, writes, multi-edits and notebooks light the file as edited', async ($, on) => {
  world(on)
  await runCommand($)
  const ui = await mountPane($, 'terminal')
  await edit($, '/proj/src/a.R')
  await $.tool.call({ tool: 'Write', file_path: '/proj/src/b.R', content: 'x' })
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/proj/docs/x.md', new_source: 'x' })
  for (const name of ['a.R', 'b.R', 'x.md']) {
    const lit = await row(ui, name)
    expect(lit?.text).toContain('●')
    expect(lit?.props.color).toBe('yellow')
  }
  await ui.unmount()
})

test('a recently touched file shimmers between two styles, then settles and the timer stops', async ($, on) => {
  const { clock } = world(on)
  let ticks = 0
  on('state.set', ($, e, next) => {
    if (e.key === 'tick') ticks += 1

    return next(e)
  })
  await runCommand($)
  const ui = await mountPane($, 'terminal')
  await edit($, '/proj/src/a.R')
  const styleNow = async () => {
    const props = (await row(ui, 'a.R'))?.props
    return { bold: props?.bold, dimColor: props?.dimColor }
  }
  expect(await styleNow()).toEqual({ bold: true, dimColor: undefined })
  await clock.advance(500)
  expect(await styleNow()).toEqual({ bold: undefined, dimColor: true })
  await clock.advance(500)
  expect(await styleNow()).toEqual({ bold: true, dimColor: undefined })
  await clock.advance(5500)
  expect(await styleNow()).toEqual({ bold: undefined, dimColor: undefined })
  // the tick that finds nothing left to shimmer is the last one: the timer is cancelled with it
  const settled = ticks
  expect(settled).toBeGreaterThan(0)
  await clock.advance(10000)
  expect(ticks).toBe(settled)
  await ui.unmount()
})

test('paths outside the directory or inside ignored folders are not tracked', async ($, on) => {
  const { clock } = world(on)
  let touches = 0
  on('state.set', ($, e, next) => {
    if (e.key === 'touched') touches += 1

    return next(e)
  })
  await runCommand($)
  const ui = await mountPane($, 'terminal')
  await edit($, '/etc/hosts')
  await edit($, '/proj/node_modules/left-pad.js')
  await read($, '/projection/src/a.R')
  await clock.advance(1000)
  expect(touches).toBe(0)
  await ui.unmount()
})

test('Grep and Glob results light the files they name', async ($, on) => {
  const { results } = world(on)
  results.Grep = { filenames: ['/proj/src/a.R', '/proj/docs/x.md', '/elsewhere/z.R'] }
  results.Glob = { filenames: ['/proj/analysis.R'] }
  await runCommand($)
  const ui = await mountPane($, 'terminal')
  await $.tool.call({ tool: 'Grep', pattern: 'x' })
  await $.tool.call({ tool: 'Glob', pattern: '*.R' })
  for (const name of ['a.R', 'x.md', 'analysis.R']) expect((await row(ui, name))?.text).toContain('○')
  await ui.unmount()
})

test('a collapsed folder shows a dot while something below it is lit', async ($, on) => {
  world(on)
  await runCommand($)
  const ui = await mountPane($, 'terminal')
  await edit($, '/proj/docs/x.md')
  await ui.press({ key: 'dir:docs' })
  expect((await ui.find({ key: 'dir:docs' }))?.text).toContain('•')
  await ui.unmount()
})

test('a failing watcher never touches the tool result', async ($, on) => {
  on('tool.call', () => ({ result: { filePath: 'x' } }))
  // session.cwd has no answer here, so the hook throws after the tool ran; the result must still arrive
  const ran = await read($, '/proj/a.R')
  expect(ran.result).toEqual({ filePath: 'x' })
})
