import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FULLSCREEN, PANE_PROPS, dir, file, runCommand, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const

const hasFile = async (ui: Awaited<ReturnType<typeof mountPane>>, name: string) =>
  (await ui.find({ type: 'Text', text: new RegExp(`(^|\\s)${name.replace(/[.]/g, '\\.')}$`) })) !== undefined

const mountPane = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'filetree', surface, component: 'Pane', requestId: 'filetree', props: PANE_PROPS, viewport: FULLSCREEN })

test('the tree is built from the listing, dirs first, collapsed, ignores hidden', async ($, on) => {
  world(on)
  await runCommand($)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ key: 'dir:src' })).toBeDefined()
    expect(await ui.find({ key: 'dir:docs' })).toBeDefined()
    expect(await hasFile(ui, 'README.md')).toBe(true)
    // collapsed: nothing below the top level
    expect(await hasFile(ui, 'x.md')).toBe(false)
    for (const name of ['.git', 'node_modules', 'target', 'renv', '.Rproj.user', '__pycache__', '.venv', 'dist', 'build']) {
      expect(await ui.find({ key: `dir:${name}` })).toBeUndefined()
    }
    // dirs come before files, each sorted
    const rows = (await ui.findAll({})).filter(el => el.type === 'Button' ? el.key?.startsWith('dir:') : el.type === 'Text' && /\.(R|md)$/.test(el.text))
    expect(rows.map(el => el.text.trim())).toEqual(['\u25b8 docs/', '\u25b8 src/', 'analysis.R', 'README.md'])
    await ui.unmount()
  }
})

test('a directory expands and collapses with its button', async ($, on) => {
  world(on)
  await runCommand($)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'dir:src' })
    expect(await hasFile(ui, 'a.R')).toBe(true)
    expect(await ui.find({ key: 'dir:src/deep' })).toBeDefined()
    await ui.press({ key: 'dir:src' })
    expect(await hasFile(ui, 'a.R')).toBe(false)
    await ui.unmount()
  }
})

test('the default depth of 4 reaches the fourth level', async ($, on) => {
  world(on)
  await runCommand($)
  const ui = await mountPane($, 'terminal')
  for (const dirKey of ['dir:src', 'dir:src/deep']) await ui.press({ key: dirKey })
  await ui.press({ key: 'dir:src/deep/deeper' })
  // default depth 4 reaches e.R; nothing here is cut
  expect(await hasFile(ui, 'e.R')).toBe(true)
  await ui.unmount()
})

test('maxDepth 2 leaves the third level unscanned', { options: { maxDepth: 2 } }, async ($, on) => {
  world(on)
  await runCommand($)
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'dir:src' })
  await ui.press({ key: 'dir:src/deep' })
  expect(await ui.find({ type: 'Text', text: /not scanned/ })).toBeDefined()
  expect(await hasFile(ui, 'd.R')).toBe(false)
  await ui.unmount()
})

test('maxEntries caps the tree and counts the rest', { options: { maxEntries: 3 } }, async ($, on) => {
  world(on, { '/proj': [dir('a'), file('b'), file('c'), file('d'), file('e')], '/proj/a': [file('x')] })
  await runCommand($)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: /\+2 more/ })).toBeDefined()
    expect(await hasFile(ui, 'd')).toBe(false)
    await ui.unmount()
  }
})

test('extraIgnore adds names to the ignore list', { options: { extraIgnore: 'docs, README.md' } }, async ($, on) => {
  world(on)
  await runCommand($)
  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ key: 'dir:docs' })).toBeUndefined()
  expect(await hasFile(ui, 'README.md')).toBe(false)
  expect(await ui.find({ key: 'dir:src' })).toBeDefined()
  await ui.unmount()
})
