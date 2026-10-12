import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry } from 'claude-code'

import { FULLSCREEN, PANE_PROPS, file, runCommand, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const
const HINT = 'Side panel · use /tui fullscreen'

const mountWith = ($: Engine, surface: (typeof SURFACES)[number], props: object, viewport?: object) =>
  $.ui.mount({
    plugin: 'filetree',
    surface,
    component: 'Pane',
    requestId: 'filetree',
    props: { ...PANE_PROPS, ...props },
    ...(viewport ? { viewport } : {}),
  } as never)

test('/filetree toggles the pane and registers at session start', async ($, on) => {
  const { panes } = world(on)
  const registered: string[] = []
  on('command.register', ($, e) => {
    registered.push(e.name)

    return { value: undefined as never }
  })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  expect(registered).toContain('filetree')
  expect((await runCommand($)).text).toBe('Filetree · open')
  expect(panes.map(pane => pane.id)).toEqual(['filetree'])
  expect((await runCommand($)).text).toBe('Filetree · closed')
  expect(panes).toEqual([])
})

test('an inline open and a pane that waits each say what to do, in a headline and one line', async ($, on) => {
  const world1 = world(on)
  expect((await runCommand($, false)).text).toBe('Filetree · open\nThe side panel needs /tui fullscreen.')
  await runCommand($)
  world1.open.isPlaced = false
  world1.open.reason = 'terminal is 90 columns wide'
  const waiting = (await runCommand($)).text
  expect(waiting).toBe('Filetree · waiting for room\nTry /tui fullscreen, or a wider window.')
  expect(waiting).not.toContain('90 columns') // the engine's reason is detail nobody needs
})

for (const surface of SURFACES) {
  test(`a narrow pane says so in one line instead of the tree (${surface})`, async ($, on) => {
    world(on)
    await runCommand($)
    const ui = await mountWith($, surface, { bodyColumns: 30 }, FULLSCREEN)
    expect((await ui.find({ type: 'Text' }))?.text).toBe('Too narrow · widen the pane')
    expect(await ui.find({ key: 'dir:src' })).toBeUndefined()
    await ui.unmount()
  })
}

test('the terminal outside fullscreen shows the hint; the desktop draws the tree', async ($, on) => {
  world(on)
  await runCommand($)
  const terminal = await mountWith($, 'terminal', { placement: 'inline' }, { columns: 100, rows: 30, isFullscreen: false })
  expect((await terminal.find({ type: 'Text' }))?.text).toBe(HINT)
  await terminal.unmount()
  const desktop = await mountWith($, 'desktop', {}, { columns: 100, rows: 30 })
  expect(await desktop.find({ key: 'dir:src' })).toBeDefined()
  await desktop.unmount()
})

test('Refresh scans the directory again', async ($, on) => {
  const listing: Record<string, FsEntry[]> = { '/proj': [file('one.R')] }
  world(on, listing)
  await runCommand($)
  const ui = await mountWith($, 'terminal', {}, FULLSCREEN)
  expect(await ui.find({ type: 'Text', text: /two\.R$/ })).toBeUndefined()
  listing['/proj'] = [file('one.R'), file('two.R')]
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /two\.R$/ })).toBeDefined()
  await ui.unmount()
})
