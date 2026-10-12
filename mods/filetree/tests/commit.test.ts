import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { parseStatus } from '../hooks/model'
import { FULLSCREEN, PANE_PROPS, runCommand, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const

const mountPane = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'filetree', surface, component: 'Pane', requestId: 'filetree', props: PANE_PROPS, viewport: FULLSCREEN })

type Mounted = Awaited<ReturnType<typeof mountPane>>

const row = (ui: Mounted, name: string) =>
  ui.find({ type: 'Text', text: new RegExp(`(^|\\s)${name.replace(/[.]/g, '\\.')}$`) })

const edit = ($: Engine, file_path: string) =>
  $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })

for (const surface of SURFACES) {
  test(`a commit turns the files that are no longer modified green (${surface})`, async ($, on) => {
    const { clock, git } = world(on)
    await runCommand($)
    const ui = await mountPane($, surface)
    await edit($, '/proj/src/a.R')
    await edit($, '/proj/src/b.R')
    await $.tool.call({ tool: 'Read', file_path: '/proj/docs/x.md' })
    git.status = ' M src/a.R\0'
    await bash($, 'git add -A && git commit -m "wip"')
    await clock.advance(10)
    const committed = await row(ui, 'b.R')
    expect(committed?.text).toContain('✓')
    expect(committed?.props.color).toBe('green')
    // still modified: stays an uncommitted edit
    expect((await row(ui, 'a.R'))?.props.color).toBe('yellow')
    // a file that was only read is never "committed"
    expect((await row(ui, 'x.md'))?.props.color).toBe('cyan')
    await ui.unmount()
  })
}

test('an edit after a commit is an uncommitted edit again', async ($, on) => {
  const { clock } = world(on)
  await runCommand($)
  const ui = await mountPane($, 'terminal')
  await edit($, '/proj/src/a.R')
  await bash($, 'git commit -am x')
  await clock.advance(10)
  expect((await row(ui, 'a.R'))?.props.color).toBe('green')
  await edit($, '/proj/src/a.R')
  expect((await row(ui, 'a.R'))?.props.color).toBe('yellow')
  await ui.unmount()
})

test('only read-only git runs, and only after a commit or on the poll', async ($, on) => {
  const { clock, runs, git } = world(on)
  await runCommand($)
  await edit($, '/proj/src/a.R')
  git.status = ' M src/a.R\0'
  await bash($, 'ls -la')
  await bash($, 'git status')
  await clock.advance(1000)
  expect(runs).toEqual([])
  await bash($, 'git -C . commit -m x')
  await clock.advance(10)
  await clock.advance(5000)
  expect(runs.length).toBeGreaterThan(0)
  for (const argv of runs) {
    expect(argv.slice(0, 2)).toEqual(['git', '--no-optional-locks'])
    expect(['rev-parse', 'status']).toContain(argv[2])
    expect(argv).not.toContain('commit')
    expect(argv).not.toContain('add')
  }
})

test('the slow poll runs only while the pane is open and an edit waits for a commit', async ($, on) => {
  const { clock, runs, git } = world(on)
  git.status = ' M src/a.R\0'
  await runCommand($)
  await clock.advance(20000)
  expect(runs).toEqual([])
  await edit($, '/proj/src/a.R')
  await clock.advance(5000)
  const afterOne = runs.length
  expect(afterOne).toBe(2)
  await clock.advance(5000)
  expect(runs.length).toBe(4)
  // closing the pane ends the poll
  await runCommand($)
  await clock.advance(30000)
  expect(runs.length).toBe(4)
})

test('the poll ends once every edit is committed', async ($, on) => {
  const { clock, runs, git } = world(on)
  await runCommand($)
  await edit($, '/proj/src/a.R')
  git.status = ''
  await clock.advance(5000)
  const count = runs.length
  expect(count).toBe(2)
  await clock.advance(30000)
  expect(runs.length).toBe(count)
})

test('a failing git leaves everything as it was', async ($, on) => {
  const { clock, git } = world(on)
  await runCommand($)
  const ui = await mountPane($, 'terminal')
  await edit($, '/proj/src/a.R')
  git.exitCode = 128
  await bash($, 'git commit -m x')
  await clock.advance(5000)
  expect((await row(ui, 'a.R'))?.props.color).toBe('yellow')
  await ui.unmount()
})

test('status parsing: renames, untracked directories, a subdirectory prefix', () => {
  const isModified = parseStatus('R  new.R\0old.R\0?? fresh/\0 M sub/x.R\0', '')
  expect(isModified('new.R')).toBe(true)
  expect(isModified('old.R')).toBe(true)
  expect(isModified('fresh/deep/file.R')).toBe(true)
  expect(isModified('sub/x.R')).toBe(true)
  expect(isModified('sub/y.R')).toBe(false)
  const inSub = parseStatus(' M proj/a.R\0 M other/b.R\0', 'proj/')
  expect(inSub('a.R')).toBe(true)
  expect(inSub('b.R')).toBe(false)
  expect(parseStatus('?? proj/\0', 'proj/')('anything.R')).toBe(true)
})
