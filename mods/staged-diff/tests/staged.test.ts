import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, UiPane } from 'claude-code'

import { LIMIT, checkPath } from '../hooks/lib'

const STAT = ' src/a.R | 3 ++-\n 1 file changed, 2 insertions(+), 1 deletion(-)\n'
const DIFF = 'diff --git a/src/a.R b/src/a.R\nindex 1..2 100644\n--- a/src/a.R\n+++ b/src/a.R\n@@ -1,2 +1,3 @@\n x <- 1\n-y <- 2\n+y <- 3\n+z <- 4\n'

function world(on: On, o: { stat?: string; diff?: string; exitCode?: number; stderr?: string; surfaces?: string[]; placed?: boolean } = {}) {
  const w = { runs: [] as string[][], registered: [] as string[], panes: [] as UiPane[], stat: o.stat ?? STAT, diff: o.diff ?? DIFF }
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: { command: e.name } as never }))
  on('session.surfaces', () => ({ value: (o.surfaces ?? ['terminal']) as never }))
  on('ui.open', (_$, e) => {
    w.panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true })
    return { value: o.placed === false ? { isPlaced: false as const, reason: 'narrow' } : { isPlaced: true as const } }
  })
  on('process.run', (_$, e) => {
    w.runs.push([...e.argv])
    const stdout = e.argv.includes('--stat') ? w.stat : w.diff
    return { value: { exitCode: o.exitCode ?? 0, stdout, stderr: o.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
const slash = async ($: Engine, args = '') =>
  ((await $.command.run({ command: 'staged-diff', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })) as { text?: string }).text ?? ''

const PANE_PROPS = { title: 'Staged', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const mount = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'staged-diff', surface, component: 'Pane', requestId: 'staged-diff', props: PANE_PROPS, viewport: { columns: 140, rows: 40, isFullscreen: true } } as never)

test('registers /staged-diff and runs only read-only git, stat first, as argv', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['staged-diff'])
  const text = await slash($)
  expect(text).toBe('staged-diff · 1 file changed, 2 insertions(+), 1 deletion(-)')
  expect(w.runs).toHaveLength(2)
  expect(w.runs[0]).toEqual(['git', '--no-pager', 'diff', '--cached', '--no-color', '--stat'])
  expect(w.runs[1]).toEqual(['git', '--no-pager', 'diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=2'])
  expect(w.panes.map(p => p.id)).toEqual(['staged-diff'])
})

test('a path is passed after --', async ($, on) => {
  const w = world(on)
  await start($)
  await slash($, ' src/a.R ')
  expect(w.runs[0]!.slice(-2)).toEqual(['--', 'src/a.R'])
  expect(w.runs[1]!.slice(-2)).toEqual(['--', 'src/a.R'])
})

test('a path that starts with - or holds control characters is refused and git is not run', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await slash($, '--output=/tmp/x')).toContain('may not start with')
  expect(await slash($, 'a\u0007b')).toContain('control characters')
  expect(w.runs).toHaveLength(0)
  expect(checkPath('')).toEqual({ path: '' })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane draws the stat, the diff and a Refresh button (${surface})`, async ($, on) => {
    const w = world(on)
    await start($)
    await slash($)
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /1 file changed/ })).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.text).toContain('+y <- 3')
    w.stat = ''
    await ui.press({ key: 'refresh' })
    expect(await ui.find({ type: 'Text', text: 'Nothing is staged.' })).toBeDefined()
    expect(w.runs).toHaveLength(3) // the refresh ran the stat only
    await ui.unmount()
  })
}

test('nothing staged says so and skips the diff', async ($, on) => {
  const w = world(on, { stat: '' })
  await start($)
  expect(await slash($)).toBe('staged-diff · Nothing is staged.')
  expect(w.runs).toHaveLength(1)
})

test('a long diff is cut to the limit with a note', async ($, on) => {
  const big = DIFF + Array.from({ length: 3000 }, (_, i) => `+line ${i} of a long change`).join('\n')
  world(on, { diff: big })
  await start($)
  await slash($)
  const ui = await mount($, 'terminal')
  const diff = (await ui.find({ type: 'Code' }))!.text
  expect(diff.length).toBeLessThanOrEqual(LIMIT)
  expect(await ui.find({ type: 'Text', text: /^Cut to 9000 characters/ })).toBeDefined()
  await ui.unmount()
})

test('a git error (not a repository) is shown, not thrown', async ($, on) => {
  world(on, { exitCode: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' })
  await start($)
  const text = await slash($)
  expect(text).toContain('git could not be read')
  expect(text).toContain('not a git repository')
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /not a git repository/ })).toBeDefined()
  await ui.unmount()
})

test('where no surface draws the pane, the stat comes back as text', async ($, on) => {
  world(on, { surfaces: [] })
  await start($)
  const text = await slash($)
  expect(text).toContain('src/a.R | 3 ++-')
})
