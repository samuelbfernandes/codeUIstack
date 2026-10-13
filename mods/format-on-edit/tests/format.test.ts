import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isSkipped, labelOf, langOf, relInside, stepsFor, webFormatter } from '../hooks/lib'

type World = {
  files: Record<string, string>
  found: Set<string>
  runs: string[][]
  store: Map<string, unknown>
  /** What a format run does to the file: by program name, the new text. */
  rewrite: Record<string, (text: string) => string>
  state: Map<string, unknown>
}

/** A pretend project at /proj: files, which programs are on PATH, and what each formatter does to a file. */
function world(on: On, o: { files?: Record<string, string>; found?: string[]; store?: Record<string, unknown>; rewrite?: World['rewrite']; root?: string[] } = {}): World {
  const w: World = {
    files: { ...(o.files ?? {}) },
    found: new Set(o.found ?? []),
    runs: [],
    store: new Map(Object.entries(o.store ?? {})),
    rewrite: o.rewrite ?? {},
    state: new Map(),
  }
  on('state.get', (_$, e) => ({ value: { value: w.state.get(`${e.plugin}.${e.key}`), version: w.state.has(`${e.plugin}.${e.key}`) ? 1 : 0 } as never }))
  on('state.set', (_$, e) => (w.state.set(`${e.plugin}.${e.key}`, e.value), { value: { isSet: true, version: 1 } as never }))
  current = w
  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => (w.store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (w.store.delete(e.key), { value: undefined }))
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.stat', (_$, e) => {
    const isDir = e.path === '/proj' || e.path === '/elsewhere'
    if (!isDir && !(e.path in w.files)) throw new Error('ENOENT')
    return { value: { kind: isDir ? 'dir' : 'file', size: 1, mtimeMs: 1, isLink: false, realPath: e.path } as never }
  })
  on('fs.read', (_$, e) => {
    const text = w.files[e.path]
    if (text === undefined) throw new Error('missing')
    return { value: text as never }
  })
  on('fs.exists', (_$, e) => ({ value: e.path in w.files }))
  on('fs.list', () => ({ value: (o.root ?? []).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 1, isLink: false })) as never }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    const name = argv[0]!.split('/').pop()!
    if (!w.found.has(name)) throw new Error(`spawn ${argv[0]} ENOENT`)
    if (argv[1] === '--version') return { value: { exitCode: 0, stdout: `${name} 1.2.3\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const file = argv[argv.length - 1] === '--fix' ? argv[argv.length - 2]! : argv[argv.length - 1]!
    const key = `${name} ${argv[1]}`
    const fn = w.rewrite[key] ?? w.rewrite[name]
    if (fn !== undefined && file in w.files) w.files[file] = fn(w.files[file]!)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', (_$, e) => {
    if ((e as Record<string, unknown>).fail === true) return { result: 'boom', isError: true, text: 'boom' } as never
    return { result: { ok: true } } as never
  })
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true } as never)
const slash = async ($: Engine, args = '') =>
  ((await $.command.run({ command: 'format-on-edit', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })) as { text?: string }).text ?? ''
const edit = ($: Engine, file_path: string, extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b', ...extra } as never) as Promise<Record<string, any>>
let current: World | undefined
const stateOf = async (_$: Engine, key: 'isOff' | 'formatted') => current!.state.get(`format-on-edit.${key}`) ?? (key === 'isOff' ? true : 0)

const ON = { store: { on: true } }
const NOTE = 'format-on-edit: air reformatted /proj/R/api.R. Read it again before editing it.'

// ------------------------------------------------------------------ pure parts

test('languages by extension', () => {
  expect(langOf('/p/a.R')).toBe('r')
  expect(langOf('/p/a.r')).toBe('r')
  expect(langOf('C:\\p\\a.pyi')).toBe('python')
  for (const ext of ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'html', 'vue', 'json']) expect(langOf(`/p/a.${ext}`)).toBe('web')
  expect(langOf('/p/a.md')).toBeUndefined()
  expect(langOf('/p/Makefile')).toBeUndefined()
})

test('inside the root, and skipped folders', () => {
  expect(relInside('/proj', '/proj/R/a.R')).toBe('R/a.R')
  expect(relInside('/proj/', '/proj/a.R')).toBe('a.R')
  expect(relInside('/proj', '/project/a.R')).toBeUndefined()
  expect(relInside('/proj', '/elsewhere/a.R')).toBeUndefined()
  expect(relInside('C:\\proj', 'C:\\proj\\src\\a.js')).toBe('src\\a.js')
  for (const d of ['node_modules', '.git', 'renv', '.venv', 'dist', 'build']) expect(isSkipped(`x/${d}/a.js`)).toBe(true)
  expect(isSkipped('src\\node_modules\\a.js')).toBe(true)
  expect(isSkipped('src/build.R')).toBe(false)
})

test('JS formatter: prettier config first, then biome, else none', () => {
  expect(webFormatter(['.prettierrc'], '')).toBe('prettier')
  expect(webFormatter(['.prettierrc.json', 'biome.json'], '')).toBe('prettier')
  expect(webFormatter(['prettier.config.mjs'], '')).toBe('prettier')
  expect(webFormatter(['package.json'], '{"prettier":{"semi":false}}')).toBe('prettier')
  expect(webFormatter(['biome.jsonc'], '{}')).toBe('biome')
  expect(webFormatter(['package.json'], '{"devDependencies":{"prettier":"3"}}')).toBeUndefined()
  expect(webFormatter([], 'not json')).toBeUndefined()
})

test('argv of each step', () => {
  expect(stepsFor('r', '/p/a.R', false, {}).map(s => s.argv)).toEqual([['air', 'format', '/p/a.R']])
  expect(stepsFor('r', '/p/a.R', true, {}).map(s => s.argv)).toEqual([['jarl', 'check', '/p/a.R', '--fix'], ['air', 'format', '/p/a.R']])
  expect(stepsFor('python', '/p/a.py', false, {}).map(s => s.argv)).toEqual([['ruff', 'format', '/p/a.py']])
  expect(stepsFor('python', '/p/a.py', true, {}).map(s => s.argv)).toEqual([['ruff', 'check', '--fix', '/p/a.py'], ['ruff', 'format', '/p/a.py']])
  expect(stepsFor('web', '/p/a.ts', false, { prettier: '/p/node_modules/.bin/prettier' }, 'prettier').map(s => s.argv)).toEqual([['/p/node_modules/.bin/prettier', '--write', '/p/a.ts']])
  expect(stepsFor('web', '/p/a.ts', false, {}, 'biome').map(s => s.argv)).toEqual([['biome', 'format', '--write', '/p/a.ts']])
  expect(stepsFor('web', '/p/a.ts', false, {})).toEqual([])
  expect(labelOf(stepsFor('r', '/p/a.R', true, {}))).toBe('jarl and air')
})

// ------------------------------------------------------------------ the switch

test('off by default: nothing runs and the atom says off', async ($, on) => {
  const w = world(on, { files: { '/proj/R/api.R': 'x<-1' }, found: ['air'], rewrite: { air: () => 'x <- 1\n' } })
  await start($)
  expect(await stateOf($, 'isOff')).toBe(true)
  const r = await edit($, '/proj/R/api.R')
  expect(w.runs).toHaveLength(0)
  expect(r.context).toBeUndefined()
  expect(await slash($)).toContain('format-on-edit · off')
})

test('on and off persist in the store and mirror into the atom', async ($, on) => {
  const w = world(on, { files: { '/proj/R/api.R': 'x<-1' }, found: ['air'], rewrite: { air: () => 'x <- 1\n' } })
  await start($)
  expect(await slash($, 'on')).toContain('format-on-edit · on')
  expect(w.store.get('on')).toBe(true)
  expect(await stateOf($, 'isOff')).toBe(false)
  expect((await edit($, '/proj/R/api.R')).context).toEqual([NOTE])
  expect(await slash($, 'off')).toBe('format-on-edit · off')
  expect(w.store.has('on')).toBe(false)
  expect(await stateOf($, 'isOff')).toBe(true)
  w.files['/proj/R/api.R'] = 'y<-2'
  expect((await edit($, '/proj/R/api.R')).context).toBeUndefined()
  expect(await slash($, 'maybe')).toContain('unknown option')
})

test('a stored on is loaded at session start', async ($, on) => {
  world(on, { ...ON })
  await start($)
  expect(await stateOf($, 'isOff')).toBe(false)
})

// ------------------------------------------------------------------ formatting and the note

test('R: air formats the file, the note is added, the count grows', async ($, on) => {
  const w = world(on, { ...ON, files: { '/proj/R/api.R': 'x<-1' }, found: ['air'], rewrite: { air: () => 'x <- 1\n' } })
  await start($)
  const r = await edit($, '/proj/R/api.R')
  expect(w.runs).toEqual([['air', '--version'], ['air', 'format', '/proj/R/api.R']])
  expect(r.result).toEqual({ ok: true })
  expect(r.context).toEqual([NOTE])
  expect(await stateOf($, 'formatted')).toBe(1)
  // probed once per session
  w.files['/proj/R/api.R'] = 'y<-2'
  await edit($, '/proj/R/api.R')
  expect(w.runs.filter(a => a[1] === '--version')).toHaveLength(1)
  expect(await stateOf($, 'formatted')).toBe(2)
})

test('no note when the formatter left the file as it was', async ($, on) => {
  const w = world(on, { ...ON, files: { '/proj/a.py': 'x = 1\n' }, found: ['ruff'], rewrite: { ruff: t => t } })
  await start($)
  const r = await edit($, '/proj/a.py')
  expect(w.runs.at(-1)).toEqual(['ruff', 'format', '/proj/a.py'])
  expect(r.context).toBeUndefined()
  expect(await stateOf($, 'formatted')).toBe(0)
})

test('lint setting: ruff check --fix then ruff format, named once', { options: { lint: true } }, async ($, on) => {
  const w = world(on, { ...ON, files: { '/proj/a.py': 'import os\nx=1' }, found: ['ruff'], rewrite: { 'ruff check': t => t.replace('import os\n', ''), 'ruff format': t => t.replace('x=1', 'x = 1\n') } })
  await start($)
  const r = await edit($, '/proj/a.py')
  expect(w.runs.slice(1)).toEqual([['ruff', 'check', '--fix', '/proj/a.py'], ['ruff', 'format', '/proj/a.py']])
  expect(r.context).toEqual(['format-on-edit: ruff reformatted /proj/a.py. Read it again before editing it.'])
  expect(w.files['/proj/a.py']).toBe('x = 1\n')
})

test('a missing formatter is skipped quietly', async ($, on) => {
  const w = world(on, { ...ON, files: { '/proj/a.R': 'x<-1' }, found: [] })
  await start($)
  const r = await edit($, '/proj/a.R')
  expect(w.runs).toEqual([['air', '--version']])
  expect(r.context).toBeUndefined()
  expect(r.result).toEqual({ ok: true })
})

test('JS: left alone without a project formatter; prettier from node_modules when configured', async ($, on) => {
  const files = { '/proj/src/app.js': 'let a=1', '/proj/node_modules/.bin/prettier': '#!' }
  const w = world(on, { ...ON, files, found: ['prettier'], root: ['package.json', 'src'], rewrite: { prettier: () => 'let a = 1;\n' } })
  await start($)
  expect((await edit($, '/proj/src/app.js')).context).toBeUndefined()
  expect(w.runs).toHaveLength(0)
  w.files['/proj/package.json'] = '{"prettier":{}}'
  const r = await edit($, '/proj/src/app.js')
  expect(w.runs.at(-1)).toEqual(['/proj/node_modules/.bin/prettier', '--write', '/proj/src/app.js'])
  expect(r.context?.[0]).toContain('prettier reformatted /proj/src/app.js')
})

test('JS: biome when biome.json exists and no prettier config', async ($, on) => {
  const w = world(on, { ...ON, files: { '/proj/a.ts': 'let a=1' }, found: ['biome'], root: ['biome.json'], rewrite: { biome: () => 'let a = 1;\n' } })
  await start($)
  const r = await edit($, '/proj/a.ts')
  expect(w.runs.at(-1)).toEqual(['biome', 'format', '--write', '/proj/a.ts'])
  expect(r.context?.[0]).toContain('biome reformatted')
})

test('never outside the session folder, never in node_modules/renv/.venv', async ($, on) => {
  const files = { '/elsewhere/a.R': 'x<-1', '/proj/renv/library/a.R': 'x<-1', '/proj/.venv/a.py': 'x=1' }
  const w = world(on, { ...ON, files, found: ['air', 'ruff'], rewrite: { air: () => 'changed', ruff: () => 'changed' } })
  await start($)
  for (const f of Object.keys(files)) expect((await edit($, f)).context).toBeUndefined()
  expect(w.runs).toHaveLength(0)
})

test('other tools, failed edits and unknown file types are untouched', async ($, on) => {
  const w = world(on, { ...ON, files: { '/proj/a.R': 'x<-1', '/proj/notes.md': '#' }, found: ['air'], rewrite: { air: () => 'x <- 1\n' } })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/proj/a.R' } as never)
  const failed = await edit($, '/proj/a.R', { fail: true })
  expect(failed.isError).toBe(true)
  expect(failed.context).toBeUndefined()
  await edit($, '/proj/notes.md')
  expect(w.runs).toHaveLength(0)
})

test('Write is formatted too', async ($, on) => {
  world(on, { ...ON, files: { '/proj/a.R': 'x<-1' }, found: ['air'], rewrite: { air: () => 'x <- 1\n' } })
  await start($)
  const r = (await $.tool.call({ tool: 'Write', file_path: '/proj/a.R', content: 'x<-1' } as never)) as Record<string, any>
  expect(r.context?.[0]).toContain('air reformatted /proj/a.R')
})

test('fail-open: a stat that fails leaves the result as it was', async ($, on) => {
  const w = world(on, { ...ON, files: {}, found: ['air'] })
  await start($)
  const r = await edit($, '/proj/gone.R')
  expect(r.result).toEqual({ ok: true })
  expect(r.context).toBeUndefined()
  expect(w.runs).toHaveLength(0)
})

test('status lists found and missing formatters with where to get them', async ($, on) => {
  world(on, { files: {}, found: ['air'], root: ['biome.json'] })
  await start($)
  const text = await slash($, 'status')
  expect(text).toContain('air: found (air 1.2.3)')
  expect(text).toContain('ruff: not found · get it from docs.astral.sh/ruff')
  expect(text).toContain('jarl: not found · get it from github.com/etiennebacher/jarl')
  expect(text).toContain("biome: not found · get it from the project's own devDependencies")
  expect(text).toContain('files reformatted this session: 0')
})
