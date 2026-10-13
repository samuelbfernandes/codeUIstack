import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { absolute, isInside, normalize, relativeTo } from '../hooks/lib'

function world(on: On, o: { cwd?: string; store?: Record<string, unknown>; dirs?: string[] } = {}) {
  const store = new Map(Object.entries(o.store ?? {}))
  const w = { cwd: o.cwd ?? '/proj', store, toasts: [] as string[], registered: [] as string[], calls: 0, fail: false }
  const dirs = new Set(o.dirs ?? ['/proj/src', '/proj/docs', 'C:/proj/src'])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (store.delete(e.key), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: { command: e.name } as never }))
  on('fs.stat', (_$, e) => {
    const p = e.path.replace(/\\/g, '/')
    // On macOS the engine reads a Windows path as relative and puts its own folder in front: match the end.
    if ([...dirs].some(d => p === d || p.endsWith(`/${d}`))) return { value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: false } as never }
    if (p.endsWith('.R') || p.endsWith('.md')) return { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as never }
    throw new Error('ENOENT')
  })
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('tool.call', () => {
    w.calls++
    return w.fail ? ({ isError: true, text: 'old_string not found', result: 'old_string not found', ref: 1 } as never) : ({ result: { ok: true }, ref: 1, text: 'done' } as never)
  })
  return w
}

const start = ($: Engine, cwd = '/proj') => $.session.start({ cwd, surface: 'terminal', isInteractive: true } as never)
const slash = async ($: Engine, args = '') =>
  ((await $.command.run({ command: 'scope-watch', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })) as { text?: string }).text ?? ''
const edit = ($: Engine, file_path: string, tool = 'Edit') =>
  $.tool.call({ tool, file_path, old_string: 'a', new_string: 'b' } as never) as Promise<Record<string, any>>
const NOTE = 'scope-watch: R/other.R is outside the folder the person is working in (src). Check this edit was intended.'

test('paths: normalise, inside, relative, POSIX and Windows', () => {
  expect(normalize('./src//a/../b/')).toBe('src/b')
  expect(normalize('C:\\proj\\src\\..\\R')).toBe('C:/proj/R')
  expect(absolute('/proj', 'src/./x.R')).toBe('/proj/src/x.R')
  expect(isInside('/proj/src/x.R', '/proj/src')).toBe(true)
  expect(isInside('/proj/srcx/x.R', '/proj/src')).toBe(false)
  expect(isInside('/proj/src', '/proj/src')).toBe(true)
  expect(isInside('c:/Proj/SRC/x.R', 'C:/proj/src')).toBe(true) // Windows: case does not matter
  expect(isInside('/proj/SRC/x.R', '/proj/src')).toBe(false)
  expect(relativeTo('/proj', '/proj/R/a.R')).toBe('R/a.R')
  expect(relativeTo('/proj', '/elsewhere/a.R')).toBe('/elsewhere/a.R')
})

test('sets the folder per project, normalised, and reports status', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['scope-watch'])
  expect(await slash($)).toContain('no folder set')
  expect(await slash($, './src/')).toBe('scope-watch · watching src')
  expect(w.store.get('folder:/proj')).toBe('src')
  expect(await slash($, 'status')).toBe('scope-watch · watching src · 0 edits outside it this session')
})

test('an edit outside gets one toast and one note per path; inside edits get none; the count grows each time', async ($, on) => {
  const w = world(on)
  await start($)
  await slash($, 'src')
  const inside = await edit($, '/proj/src/model.R')
  expect(inside.context).toBeUndefined()
  const first = await edit($, '/proj/R/other.R')
  expect(first.text).toBe('done')
  expect(first.context).toEqual([NOTE])
  expect(w.toasts).toEqual(['scope-watch: R/other.R is outside src'])
  const again = await edit($, '/proj/R/other.R', 'Write')
  expect(again.context).toBeUndefined()
  expect(w.toasts).toHaveLength(1)
  const nb = (await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/proj/nb.ipynb', new_source: 'x' } as never)) as Record<string, any>
  expect(nb.context?.[0]).toContain('nb.ipynb is outside')
  const status = await slash($)
  expect(status).toContain('3 edits outside it')
  expect(status).toContain('Outside: R/other.R, nb.ipynb')
  expect(w.calls).toBe(4) // every edit ran
})

test('never blocks; a failed edit and other tools are left alone', async ($, on) => {
  const w = world(on)
  await start($)
  await slash($, 'src')
  w.fail = true
  const failed = await edit($, '/proj/R/x.R')
  expect(failed.isError).toBe(true)
  expect(failed.context).toBeUndefined()
  w.fail = false
  const read = (await $.tool.call({ tool: 'Read', file_path: '/proj/R/x.R' } as never)) as Record<string, any>
  expect(read.context).toBeUndefined()
  expect(w.toasts).toEqual([])
  expect(await slash($)).toContain('0 edits outside')
})

test('off clears the folder; nothing is flagged after', async ($, on) => {
  const w = world(on)
  await start($)
  await slash($, 'src')
  expect(await slash($, 'off')).toBe('scope-watch · off (no folder set)')
  expect(w.store.has('folder:/proj')).toBe(false)
  const r = await edit($, '/proj/R/x.R')
  expect(r.context).toBeUndefined()
})

test('the stored folder is loaded for this project only', async ($, on) => {
  const w = world(on, { store: { 'folder:/proj': 'docs', 'folder:/other': 'lib' } })
  await start($)
  expect(await slash($)).toContain('watching docs')
  w.cwd = '/other'
  expect(await slash($)).toContain('watching lib')
  w.cwd = '/third'
  expect(await slash($)).toContain('no folder set')
})

test('a file is refused as a folder; a missing folder is accepted with a warning; Windows paths work', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await slash($, 'src/model.R')).toContain('is not a folder')
  expect(await slash($, 'newdir')).toContain('does not exist yet')
  w.cwd = 'C:\\proj'
  expect(await slash($, 'src')).toBe('scope-watch · watching src')
  const inside = await edit($, 'C:\\proj\\src\\a.R')
  expect(inside.context).toBeUndefined()
  const out = await edit($, 'C:\\proj\\R\\a.R')
  expect(out.context?.[0]).toContain('R/a.R is outside')
})
