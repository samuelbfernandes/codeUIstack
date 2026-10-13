import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cellsOf, decisionsPath, escapeCell, localDate, nextId, parseArgs, parseRows, withRow } from '../hooks/lib'

const NOW = Date.UTC(2026, 9, 13, 15, 0, 0)
const TODAY = localDate(NOW)
const FILE = '/proj/docs/DECISIONS.md'
const SCAFFOLD = '# Decisions log\n| ID | Date | Decision | Rationale | Status |\n|----|------|----------|-----------|--------|\n| 001 | TODO | TODO(maintainer) | | proposed |\n'

function world(on: On, files: Record<string, string> = {}, o: { cwd?: string } = {}) {
  mock.clock(on, { now: NOW })
  const fs = new Map(Object.entries(files))
  const w = { fs, writes: [] as string[], registered: [] as string[], opened: [] as string[], cwd: o.cwd ?? '/proj' }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: { command: e.name } as never }))
  on('ui.open', (_$, e) => (w.opened.push(e.id), { value: { isPlaced: true as const } }))
  on('fs.exists', (_$, e) => ({ value: fs.has(e.path) }))
  on('fs.read', (_$, e) => {
    const text = fs.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text as never }
  })
  on('fs.write', (_$, e) => (w.writes.push(e.path), fs.set(e.path, e.text), { value: undefined }))
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true } as never)
const run = async ($: Engine, command: string, args = '') =>
  ((await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })) as { text?: string }).text ?? ''
const PANE_PROPS = { title: 'Decisions', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const mount = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'decision-log', surface, component: 'Pane', requestId: 'decision-log', props: PANE_PROPS, viewport: { columns: 140, rows: 40, isFullscreen: true } } as never)

test('arguments: decision and optional rationale after --', () => {
  expect(parseArgs('Use renv -- reproducible installs')).toEqual({ decision: 'Use renv', rationale: 'reproducible installs' })
  expect(parseArgs('Drop Python 3.9')).toEqual({ decision: 'Drop Python 3.9', rationale: '' })
  expect(parseArgs('Use --vanilla for Rscript -- cleaner runs')).toEqual({ decision: 'Use --vanilla for Rscript', rationale: 'cleaner runs' })
  expect('error' in parseArgs('   ')).toBe(true)
  expect('error' in parseArgs('-- only a reason')).toBe(true)
})

test('cells escape | and line breaks; rows are parsed back; IDs count up from the highest', () => {
  expect(escapeCell('a | b\nc')).toBe('a \\| b<br>c')
  expect(cellsOf('| 007 | 2026-01-01 | a \\| b | why | accepted |')).toEqual(['007', '2026-01-01', 'a \\| b', 'why', 'accepted'])
  const rows = parseRows('| 007 | 2026-01-01 | a \\| b | why | accepted |\n| 012 | d | x | | proposed |')
  expect(rows.map(r => r.id)).toEqual(['007', '012'])
  expect(rows[0]!.decision).toBe('a | b')
  expect(nextId(SCAFFOLD)).toBe('002')
  expect(nextId('')).toBe('001')
  expect(nextId('| 099 | x | y | | accepted |\n| 3 | x | y | | accepted |')).toBe('100')
  expect(decisionsPath('C:\\proj')).toBe('C:\\proj\\docs\\DECISIONS.md')
  expect(decisionsPath('/proj/')).toBe('/proj/docs/DECISIONS.md')
})

test('a new row goes at the end of the table, before any text that follows it, keeping CRLF', () => {
  const text = '# Decisions log\r\n| ID | Date | Decision | Rationale | Status |\r\n|----|------|----------|-----------|--------|\r\n| 001 | d | x | | accepted |\r\n\r\nNotes below.\r\n'
  const out = withRow(text, '| 002 | d | y | | accepted |')
  expect(out).toBe('# Decisions log\r\n| ID | Date | Decision | Rationale | Status |\r\n|----|------|----------|-----------|--------|\r\n| 001 | d | x | | accepted |\r\n| 002 | d | y | | accepted |\r\n\r\nNotes below.\r\n')
  expect(withRow('Some notes', '| 001 | d | y | | accepted |')).toBe(
    'Some notes\n\n| ID | Date | Decision | Rationale | Status |\n|----|------|----------|-----------|--------|\n| 001 | d | y | | accepted |\n',
  )
})

test('/decision creates the file with the template header when missing', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['decision', 'decision-log'])
  expect(await run($, 'decision', 'Use renv for package versions -- lockfile makes installs reproducible')).toBe(
    'decision-log · added 001 to docs/DECISIONS.md (new file)',
  )
  expect(w.writes).toEqual([FILE])
  expect(w.fs.get(FILE)).toBe(
    `# Decisions log\n| ID | Date | Decision | Rationale | Status |\n|----|------|----------|-----------|--------|\n| 001 | ${TODAY} | Use renv for package versions | lockfile makes installs reproducible | accepted |\n`,
  )
})

test('/decision appends after the highest ID, escaping | in cells', async ($, on) => {
  const w = world(on, { [FILE]: SCAFFOLD })
  await start($)
  expect(await run($, 'decision', 'Model A | B comparison uses AIC')).toBe('decision-log · added 002 to docs/DECISIONS.md')
  const lines = w.fs.get(FILE)!.trimEnd().split('\n')
  expect(lines.at(-1)).toBe(`| 002 | ${TODAY} | Model A \\| B comparison uses AIC | | accepted |`)
  expect(lines[3]).toBe('| 001 | TODO | TODO(maintainer) | | proposed |') // the rest is left as it was
})

test('bad input writes nothing', async ($, on) => {
  const w = world(on, { [FILE]: SCAFFOLD })
  await start($)
  expect(await run($, 'decision', '')).toContain('say what was decided')
  expect(await run($, 'decision', 'x'.repeat(600))).toContain('under 500 characters')
  expect(w.writes).toEqual([])
})

test('only /decision writes, and only the one file', async ($, on) => {
  const w = world(on, { [FILE]: SCAFFOLD })
  await start($)
  await run($, 'decision-log')
  expect(w.writes).toEqual([])
  await run($, 'decision', 'One')
  await run($, 'decision', 'Two')
  expect(w.writes).toEqual([FILE, FILE])
  expect(nextId(w.fs.get(FILE)!)).toBe('004')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/decision-log lists the last 20 rows, newest first (${surface})`, async ($, on) => {
    const rows = Array.from({ length: 25 }, (_, i) => `| ${String(i + 1).padStart(3, '0')} | 2026-01-${String((i % 28) + 1).padStart(2, '0')} | decision ${i + 1} | because ${i + 1} | accepted |`)
    world(on, { [FILE]: [SCAFFOLD.split('\n').slice(0, 3).join('\n'), ...rows, ''].join('\n') })
    await start($)
    expect(await run($, 'decision-log')).toBe('decision-log · 25 decisions in docs/DECISIONS.md')
    const ui = await mount($, surface)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.some(t => t.includes('decision 25'))).toBe(true)
    expect(texts.some(t => t.endsWith('decision 5'))).toBe(false)
    expect(texts.findIndex(t => t.includes('decision 25'))).toBeLessThan(texts.findIndex(t => t.includes('decision 24')))
    expect(texts.some(t => t.includes('because 25'))).toBe(true)
    expect(texts.some(t => t.includes('25 decisions · last 20'))).toBe(true)
    await ui.unmount()
  })
}

test('/decision-log with no file says how to start one', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await run($, 'decision-log')).toContain('no docs/DECISIONS.md yet')
  expect(w.opened).toEqual(['decision-log'])
  expect(w.writes).toEqual([])
})
