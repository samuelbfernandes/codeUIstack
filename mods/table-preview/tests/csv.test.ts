import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { analyse, detectDelimiter, parse, previewOf, resolveIn, LIMIT } from '../hooks/lib'

type File = { text: string; size?: number; isLink?: boolean; kind?: 'file' | 'dir' }

function world(on: On, files: Record<string, File>, o: { surfaces?: string[] } = {}) {
  const w = { reads: [] as string[], registered: [] as string[], opened: [] as string[] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: { command: e.name } as never }))
  on('session.surfaces', () => ({ value: (o.surfaces ?? ['terminal']) as never }))
  on('ui.open', (_$, e) => (w.opened.push(e.id), { value: { isPlaced: true as const } }))
  on('fs.stat', (_$, e) => {
    const f = files[e.path.replace(/^\/w\//, '')]
    if (f === undefined) throw new Error('ENOENT ' + e.path)
    return { value: { kind: f.kind ?? 'file', size: f.size ?? f.text.length, mtimeMs: 1, isLink: f.isLink === true } as never }
  })
  on('fs.read', (_$, e) => {
    w.reads.push(e.path)
    const f = files[e.path.replace(/^\/w\//, '')]
    if (f === undefined) throw new Error('ENOENT')
    return { value: f.text as never }
  })
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
const slash = async ($: Engine, args = '') =>
  ((await $.command.run({ command: 'table-preview', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })) as { text?: string }).text ?? ''
const PANE_PROPS = { title: 'Table', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const mount = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'table-preview', surface, component: 'Pane', requestId: 'table-preview', props: PANE_PROPS, viewport: { columns: 140, rows: 40, isFullscreen: true } } as never)

const CSV = 'id,name,score,note\r\n1,"Smith, Jo",3.5,\r\n2,"say ""hi""",4,"two\nlines"\r\n3,Ann,NA,ok\r\n'

test('quoted fields: delimiters, doubled quotes and newlines inside quotes', () => {
  const { rows, isOpen } = parse(CSV, ',')
  expect(isOpen).toBe(false)
  expect(rows).toHaveLength(4)
  expect(rows[1]).toEqual(['1', 'Smith, Jo', '3.5', ''])
  expect(rows[2]).toEqual(['2', 'say "hi"', '4', 'two\nlines'])
  expect(parse('a,"b\n', ',').isOpen).toBe(true)
  expect(parse('a,b\n\n\nc,d\n', ',').rows).toEqual([['a', 'b'], ['c', 'd']])
})

test('detects comma, semicolon and tab', () => {
  expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(',')
  expect(detectDelimiter('a;b;c\n1,5;2,5;3\n')).toBe(';')
  expect(detectDelimiter('a\tb\n"x,y"\t2\n')).toBe('\t')
  expect(detectDelimiter('just one column\nmore\n')).toBe(',')
})

test('column types, empty share, row count and header', () => {
  const r = analyse('/w/data.csv', '﻿' + CSV, CSV.length)
  expect(r.delimiter).toBe('comma')
  expect(r.rowCount).toBe(3)
  expect(r.columnCount).toBe(4)
  expect(r.columns.map(c => c.name)).toEqual(['id', 'name', 'score', 'note'])
  expect(r.columns.map(c => c.type)).toEqual(['number', 'text', 'number', 'text'])
  expect(r.columns[2]!.emptyPct).toBe(33) // NA counts as empty
  expect(r.columns[3]!.emptyPct).toBe(33)
  expect(r.warnings).toEqual([])
  expect(r.preview.split('\n')[0]).toContain('id')
  expect(r.preview).toContain('two↵lines')
})

test('the preview shows at most 20 rows and is bounded', () => {
  const big = ['a,b'].concat(Array.from({ length: 500 }, (_, i) => `${i},x`)).join('\n')
  const r = analyse('big.csv', big, big.length)
  expect(r.rowCount).toBe(500)
  expect(r.previewRows).toBe(20)
  expect(r.preview.split('\n')).toHaveLength(22)
  const wide = previewOf(['h'], Array.from({ length: 20 }, () => ['y'.repeat(5000)]))
  expect(wide.text.length).toBeLessThanOrEqual(LIMIT)
})

test('relative paths join the session folder with its own separator', () => {
  expect(resolveIn('/w', 'a/b.csv')).toBe('/w/a/b.csv')
  expect(resolveIn('C:\\proj', 'b.csv')).toBe('C:\\proj\\b.csv')
  expect(resolveIn('/w', 'D:\\x.csv')).toBe('D:\\x.csv')
})

test('ragged rows and an unclosed quote are reported', () => {
  const r = analyse('x.csv', 'a,b\n1\n2,"open\n', 20)
  expect(r.warnings.join(' ')).toContain('quote is probably missing')
  expect(r.warnings.join(' ')).toContain('different number of fields')
})

test('the command reads the file, opens the pane and answers one line', async ($, on) => {
  const w = world(on, { 'data.csv': { text: CSV } })
  await start($)
  expect(w.registered).toEqual(['table-preview'])
  expect(await slash($, 'data.csv')).toBe('table-preview · data.csv: 3 rows × 4 columns (comma-separated)')
  expect(w.opened).toEqual(['table-preview'])
})

test('refuses links, folders, other extensions, missing files and big files without reading them', async ($, on) => {
  const w = world(on, {
    'link.csv': { text: CSV, isLink: true },
    'dir.csv': { text: '', kind: 'dir' },
    'big.csv': { text: '', size: 3000 * 1024 },
    'x.json': { text: '{}' },
  })
  await start($)
  expect(await slash($, 'link.csv')).toContain('symbolic link')
  expect(await slash($, 'dir.csv')).toContain('not a file')
  expect(await slash($, 'big.csv')).toContain('over the 2048 KB limit')
  expect(await slash($, 'x.json')).toContain('only .csv, .tsv and .txt')
  expect(await slash($, 'gone.csv')).toContain('cannot find')
  expect(await slash($, '')).toContain('Use /table-preview')
  expect(await slash($, '/w/link.csv')).toContain('symbolic link') // an absolute path is taken as is
  expect(w.reads).toEqual([])
})

test('maxKb comes from the settings', { options: { maxKb: 1 } }, async ($, on) => {
  world(on, { 'd.csv': { text: CSV, size: 2048 } })
  await start($)
  expect(await slash($, '"d.csv"')).toContain('over the 1 KB limit')
})

test('where nothing draws panes the whole report is text', async ($, on) => {
  world(on, { 'd.tsv': { text: 'a\tb\n1\t2\n' } }, { surfaces: [] })
  await start($)
  const text = await slash($, 'd.tsv')
  expect(text).toContain('tab-separated')
  expect(text).toContain('1. a · number')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane draws the summary, the columns and the table (${surface})`, async ($, on) => {
    world(on, { 'data.csv': { text: CSV } })
    await start($)
    await slash($, 'data.csv')
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: 'data.csv: 3 rows × 4 columns (comma-separated)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3\. score/ })).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.text).toContain('Smith, Jo')
    await ui.unmount()
  })
}
