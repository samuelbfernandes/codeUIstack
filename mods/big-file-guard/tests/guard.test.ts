import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const KB = 1024
type Seen = Record<string, unknown>

function world(on: On, o: { sizes?: Record<string, number>; store?: Record<string, unknown>; failStat?: boolean; total?: number } = {}) {
  const store = new Map(Object.entries(o.store ?? {}))
  const w = { seen: [] as Seen[], registered: [] as string[], store }
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (store.delete(e.key), { value: undefined }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: { command: e.name } as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('fs.stat', (_$, e) => {
    if (o.failStat) throw new Error('stat is down')
    const size = o.sizes?.[e.path]
    if (size === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size, mtimeMs: 1, isLink: false } as never }
  })
  on('tool.call', (_$, e) => {
    w.seen.push(e as unknown as Seen)
    const lines = typeof e.limit === 'number' ? e.limit : (o.total ?? 5000)
    const content = Array.from({ length: lines }, (_, i) => `${i},a,b,c`).join('\n')
    return { result: { type: 'text', file: { filePath: e.file_path, content, numLines: lines, startLine: 1, totalLines: o.total ?? 5000 } }, ref: 3, text: content } as never
  })
  return w
}

const read = ($: Engine, args: Record<string, unknown>) => $.tool.call({ tool: 'Read', ...args } as never) as Promise<Record<string, any>>
const start = ($: Engine) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
const slash = async ($: Engine, args = '') =>
  ((await $.command.run({ command: 'big-file-guard', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })) as { text?: string }).text ?? ''

const BIG = { '/w/data.csv': 400 * KB, '/w/small.csv': 10 * KB, '/w/img.png': 900 * KB, '/w/a.log': 300 * KB }

test('a big csv is read with limit = headLines and the note is added', async ($, on) => {
  const w = world(on, { sizes: BIG })
  await start($)
  const r = await read($, { file_path: '/w/data.csv' })
  expect(w.seen[0]!.limit).toBe(200)
  expect(r.result.file.numLines).toBe(200)
  expect(r.context).toHaveLength(1)
  expect(r.context[0]).toContain('big-file-guard: showed the first 200 of 5000 lines (file is 400 KB)')
})

test('a small csv is not touched', async ($, on) => {
  const w = world(on, { sizes: BIG })
  await start($)
  const r = await read($, { file_path: '/w/small.csv' })
  expect(w.seen[0]!.limit).toBeUndefined()
  expect(r.context).toBeUndefined()
})

test('a call with limit or offset is not touched', async ($, on) => {
  const w = world(on, { sizes: BIG })
  await start($)
  await read($, { file_path: '/w/data.csv', limit: 50 })
  await read($, { file_path: '/w/data.csv', offset: 10 })
  expect(w.seen.map(s => [s.offset, s.limit])).toEqual([[undefined, 50], [10, undefined]])
})

test('other tools and other file types pass untouched', async ($, on) => {
  const w = world(on, { sizes: BIG })
  await start($)
  await $.tool.call({ tool: 'Grep', pattern: 'x', file_path: '/w/data.csv' } as never)
  const r = await read($, { file_path: '/w/img.png' })
  expect(w.seen.every(s => s.limit === undefined)).toBe(true)
  expect(r.context).toBeUndefined()
})

test('a log file is cut too, with the settings applied', async ($, on) => {
  const w = world(on, { sizes: BIG })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await read($, { file_path: '/w/a.log' })
  expect(w.seen[0]!.limit).toBe(200)
})

test('off passes through; on resumes; the choice is stored and mirrored', async ($, on) => {
  const w = world(on, { sizes: BIG })
  await start($)
  expect(await slash($, 'off')).toContain('off')
  expect(w.store.get('off')).toBe(true)
  const r = await read($, { file_path: '/w/data.csv' })
  expect(w.seen[0]!.limit).toBeUndefined()
  expect(r.context).toBeUndefined()
  expect(await slash($, 'on')).toBe('big-file-guard · on')
  expect(w.store.has('off')).toBe(false)
  await read($, { file_path: '/w/data.csv' })
  expect(w.seen[1]!.limit).toBe(200)
})

test('the stored off switch is loaded at session start', async ($, on) => {
  const w = world(on, { sizes: BIG, store: { off: true } })
  await start($)
  await read($, { file_path: '/w/data.csv' })
  expect(w.seen[0]!.limit).toBeUndefined()
  expect(await slash($)).toContain('big-file-guard · off')
})

test('fail-open: a stat that throws, or a file that is not there, leaves the call alone', async ($, on) => {
  const w = world(on, { sizes: BIG, failStat: true })
  await start($)
  const r = await read($, { file_path: '/w/data.csv' })
  expect(w.seen[0]!.limit).toBeUndefined()
  expect(r.result.file.numLines).toBe(5000)
  expect(r.context).toBeUndefined()
})

test('saved counter grows by bytes/4 minus shown, and /big-file-guard reports it', async ($, on) => {
  world(on, { sizes: BIG })
  await start($)
  await read($, { file_path: '/w/data.csv' })
  const first = await slash($)
  const m = /about (\d+) tokens/.exec(first)
  expect(m).not.toBeNull()
  const one = Number(m![1])
  expect(one).toBeGreaterThan(90_000) // 400 KB / 4 = 102400, minus a few hundred shown
  expect(one).toBeLessThan(102_400)
  await read($, { file_path: '/w/data.csv' })
  expect(Number(/about (\d+) tokens/.exec(await slash($))![1])).toBe(one * 2)
  expect(first).toContain('over 256 KB')
  expect(first).toContain('first 200 lines')
})

test('registers the command; an unknown option says so', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['big-file-guard'])
  expect(await slash($, 'maybe')).toContain('unknown option')
})
