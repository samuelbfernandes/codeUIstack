import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On, RenderSurface } from 'claude-code'

import { FULLSCREEN, PANE_PROPS, runCommand, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const

/** `world` plus the command registration the plugin makes at session start. */
function setup(on: On, listing?: Record<string, FsEntry[]>) {
  const w = world(on, listing)
  on('command.register', () => ({ value: undefined as never }))

  return w
}

const start = ($: Engine, surface: RenderSurface | null = 'terminal', isInteractive = true) =>
  $.session.start({ cwd: '/proj', surface, isInteractive })

const paneProps = (placement: 'dock' | 'inline') => ({ ...PANE_PROPS, placement })

const mountPane = ($: Engine, surface: (typeof SURFACES)[number], placement: 'dock' | 'inline') =>
  $.ui.mount({
    plugin: 'filetree',
    surface,
    component: 'Pane',
    requestId: 'filetree',
    props: paneProps(placement),
    viewport: placement === 'dock' ? FULLSCREEN : { columns: 100, rows: 30, isFullscreen: false },
  } as never)

const typed = ($: Engine, text: string, extra: object = {}) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...extra } as never)

const names = (w: ReturnType<typeof world>) => w.panes.map(pane => pane.id)

// ---- automatic open ---------------------------------------------------------------------------

for (const surface of SURFACES) {
  test(`opens by itself at session start and shows the tree once docked (${surface})`, async ($, on) => {
    const w = setup(on)
    await start($, surface)
    expect(names(w)).toEqual([]) // session start itself never waits for it
    await w.clock.advance(1)
    expect(names(w)).toEqual(['filetree'])

    const ui = await mountPane($, surface, 'dock')
    await w.clock.advance(1) // the first drawing settles the open and scans
    expect(await ui.find({ key: 'dir:src' })).toBeDefined()
    expect(names(w)).toEqual(['filetree']) // still open: docked panes are kept
    await ui.unmount()
  })
}

test('on the main screen (placed inline) the automatic open closes itself and scans nothing', async ($, on) => {
  const scans: string[] = []
  const w = setup(on, new Proxy({}, { get: (_t, path) => (scans.push(String(path)), []) }) as Record<string, FsEntry[]>)
  await start($, 'terminal')
  await w.clock.advance(1)
  expect(names(w)).toEqual(['filetree'])

  const ui = await mountPane($, 'terminal', 'inline')
  await w.clock.advance(1)
  expect(names(w)).toEqual([])
  expect(scans).toEqual([])
  expect((await ui.find({ type: 'Text' }))?.text).toContain('/tui fullscreen')
  await ui.unmount()
})

test('where the engine has no room it waits undrawn: the pane is closed again, silently', async ($, on) => {
  const w = setup(on)
  w.open.isPlaced = false
  w.open.reason = 'terminal is 90 columns wide'
  await start($, 'terminal')
  await w.clock.advance(1)
  expect(names(w)).toEqual([])
  expect(w.runs).toEqual([]) // and nothing was run
})

test('autoOpen=false opens nothing', { options: { autoOpen: false } }, async ($, on) => {
  const w = setup(on)
  await start($)
  await w.clock.advance(1)
  expect(names(w)).toEqual([])
  expect((await runCommand($)).text).toBe('Filetree · open') // the command still works
})

test('no automatic open without a person, a surface that docks panes, or on a phone or editor panel', async ($, on) => {
  const w = setup(on)
  await start($, 'terminal', false)
  await start($, null)
  await start($, 'mobile')
  await start($, 'vscode')
  await w.clock.advance(1)
  expect(names(w)).toEqual([])
})

test('a pane the person closed is not opened again in the same session', async ($, on) => {
  const w = setup(on)
  await start($)
  await w.clock.advance(1)
  expect(names(w)).toEqual(['filetree'])
  const ui = await mountPane($, 'terminal', 'dock')
  await w.clock.advance(1)

  w.panes.splice(0) // the person closes it by hand
  await start($) // a second session.start, as after /clear
  await w.clock.advance(1)
  expect(names(w)).toEqual([])
  await ui.unmount()
})

test('after the person toggled it, the automatic open does not run', async ($, on) => {
  const w = setup(on)
  await runCommand($)
  await runCommand($) // closed again
  await start($)
  await w.clock.advance(1)
  expect(names(w)).toEqual([])
})

test('an automatic open already running is not doubled when the pane is up', async ($, on) => {
  const w = setup(on)
  await runCommand($)
  await start($)
  await w.clock.advance(1)
  expect(names(w)).toEqual(['filetree'])
})

test('an unreadable directory after the automatic open leaves an empty tree, no error', async ($, on) => {
  const w = setup(on, new Proxy({}, { get: () => { throw new Error('unreadable') } }) as Record<string, FsEntry[]>)
  await start($)
  await w.clock.advance(1)
  const ui = await mountPane($, 'desktop', 'dock')
  await w.clock.advance(1)
  expect(names(w)).toEqual(['filetree'])
  expect(await ui.find({ key: 'dir:src' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /No tree yet/ })).toBeUndefined() // it was scanned, and found nothing
  await ui.unmount()
})

// ---- plain words ------------------------------------------------------------------------------

test('tree, file tree and filetree toggle the pane like /filetree and are dropped', async ($, on) => {
  const w = setup(on)
  const slashOpened = (await runCommand($)).text
  expect((await runCommand($)).text).toBe('Filetree · closed')

  for (const word of ['filetree', 'File Tree', ' TREE. ']) {
    const opened = await typed($, word)
    expect(opened.drop).toBe(slashOpened)
    expect(opened.text).toBeUndefined()
    expect(names(w)).toEqual(['filetree'])
    expect((await typed($, word)).drop).toBe('Filetree · closed')
    expect(names(w)).toEqual([])
  }
})

test('a typed word whose pane waits drops one line and logs the hint, like the command', async ($, on) => {
  const w = setup(on)
  w.open.isPlaced = false
  const out = await typed($, 'tree')
  expect(out.drop).toBe('Filetree · waiting for room')
  expect(w.logs).toEqual(['Try /tui fullscreen, or a wider window.'])
})

test('no drop reason has a newline; the overflow goes to ui.log once', async ($, on) => {
  const w = setup(on)
  w.open.isPlaced = false
  const waiting = await typed($, 'tree')
  expect(waiting.drop).not.toContain('\n')
  expect(w.logs.length).toBe(1)

  await typed($, 'tree') // the mock left the unplaced pane up: this closes it
  w.open.isPlaced = true
  w.logs.length = 0
  const opened = await typed($, 'tree') // a one-line reply logs nothing
  expect(opened.drop).toBe('Filetree · open')
  expect(opened.drop).not.toContain('\n')
  expect((await typed($, 'tree')).drop).toBe('Filetree · closed')
  expect(w.logs).toEqual([])
})

test('only the exact words are taken: sentences, other senders and attachments pass through', async ($, on) => {
  const w = setup(on)
  for (const text of ['show the tree', 'tree view please', 'trees', 'file  tree', 'filetree now', 'the file tree', '/filetree', 'tree?']) {
    const out = await typed($, text)
    expect(out.drop).toBeUndefined()
    expect(out.text).toBe(text)
  }
  expect((await typed($, 'tree', { origin: { kind: 'scheduled-trigger' } })).drop).toBeUndefined()
  expect((await typed($, 'tree', { attachments: [{ type: 'image', data: 'x' }] })).drop).toBeUndefined()
  expect(names(w)).toEqual([])
})

test('a pane that cannot be opened still drops the word, with the command notice', async ($, on) => {
  const w = setup(on)
  Object.defineProperty(w.open, 'isPlaced', { get: () => { throw new Error('boom') } })
  expect((await typed($, 'tree')).drop).toBe('Filetree · could not read this folder')
})
