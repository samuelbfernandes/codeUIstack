// A scripted world beneath ui-preview: a pretend project's files, which local ports answer, a child process, the
// browser and the prompt box.
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, UiPane } from 'claude-code'

export const ROOT = '/proj'

export const OPENAPI = JSON.stringify({
  openapi: '3.0.3',
  paths: {
    '/echo': { get: { summary: 'Echo back the input' } },
    '/sum': { post: { summary: 'Add two numbers' } },
    '/items/{id}': { get: { summary: '' }, delete: { description: 'Remove an item' } },
  },
})

export type World = ReturnType<typeof world>

export function world(on: On, files: Record<string, string> = {}) {
  const w = {
    files: { ...files } as Record<string, string>,
    mtimes: {} as Record<string, number>,
    /** Origins (http://127.0.0.1:N) that answer. */
    up: new Set<string>(),
    fetched: [] as string[],
    spawned: [] as { argv: string[]; cwd?: string }[],
    runs: [] as string[][],
    output: [] as string[],
    killed: 0,
    exit: undefined as undefined | (() => void),
    fills: [] as string[],
    isFillRefused: false,
    /** The status the app's root answers (plumber with no @assets: 404). */
    rootStatus: 200,
    copies: [] as string[],
    panes: [] as UiPane[],
    onPath: new Set<string>(),
    clock: mock.clock(on, { now: 1_000_000 }),
  }
  const under = (path: string) => (path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path === ROOT ? '' : undefined)
  const isDir = (rel: string) => rel === '' || Object.keys(w.files).some(f => f.startsWith(`${rel}/`))

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({}) as never)
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', () => ({ value: undefined as never }))
  on('fs.list', (_$, e) => {
    const rel = under(e.path ?? ROOT) ?? ''
    const prefix = rel === '' ? '' : `${rel}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const f of Object.keys(w.files)) {
      if (!f.startsWith(prefix)) continue
      const rest = f.slice(prefix.length)
      const [head, ...tail] = rest.split('/')
      names.set(head!, tail.length > 0 ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 1, isLink: false })) }
  })
  on('fs.read', (_$, e) => {
    const rel = under(e.path)
    const text = rel === undefined ? undefined : w.files[rel]
    if (text === undefined) throw new Error('missing')
    return { value: text as never }
  })
  on('fs.stat', (_$, e) => {
    const rel = under(e.path)
    if (rel === undefined) throw new Error('ENOENT')
    if (rel in w.files) return { value: { kind: 'file', size: 1, mtimeMs: w.mtimes[rel] ?? 1, isLink: false } as never }
    if (isDir(rel)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } as never }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_$, e) => ({ value: w.onPath.has(e.path) }))
  on('fs.write', (_$, e) => {
    const rel = under(e.path)
    if (rel !== undefined) w.files[rel] = e.text
    return { value: undefined }
  })
  on('env.get', () => ({ value: undefined }))
  on('http.fetch', (_$, e) => {
    w.fetched.push(e.url)
    const m = /^(http:\/\/[^/]+)(\/.*)?$/.exec(e.url)
    if (m === null || !w.up.has(m[1]!)) throw new Error('ECONNREFUSED')
    if (m[2] === undefined || m[2] === '/') return { value: { status: w.rootStatus, ok: w.rootStatus < 300, headers: {}, text: '' } }
    const text = m[2] === '/openapi.json' ? OPENAPI : '<html></html>'
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('process.spawn', async function* (_$, e, next) {
    w.spawned.push({ argv: [...e.argv], cwd: e.cwd })
    try {
      for (const text of w.output) yield { stream: 'stdout' as const, text }
      // A child that runs until it exits on its own (w.exit) or is killed: the plugin ending its loop aborts this.
      await new Promise<void>(resolve => {
        w.exit = resolve
        next.signal.addEventListener('abort', () => resolve())
        if (next.signal.aborted) resolve()
      })
      return { value: { code: 0, signal: null } } as never
    } finally {
      w.killed++
    }
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    if (argv[1] === '--version') {
      if (!w.onPath.has(argv[0]!)) throw new Error('ENOENT')
      return { value: { exitCode: 0, stdout: 'Chromium 1', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const shot = argv.find(a => a.startsWith('--screenshot='))
    if (shot !== undefined) {
      const rel = under(shot.slice('--screenshot='.length))!
      w.files[rel] = 'PNG'
      w.mtimes[rel] = (w.mtimes[rel] ?? 1) + 1000
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.fill', (_$, e) => {
    if (w.isFillRefused) return { isFilled: false } as never
    w.fills.push(e.text)
    return { isFilled: true } as never
  })
  on('ui.copy', (_$, e) => (w.copies.push(e.text), { value: { isCopied: true } }) as never)
  on('ui.panes', () => ({ value: [...w.panes] }))
  on('ui.open', (_$, e) => {
    if (!w.panes.some(p => p.id === e.id)) w.panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true })
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    w.panes.splice(0, w.panes.length, ...w.panes.filter(p => p.id !== e.id))
    return { value: undefined }
  })
  return w
}

export const start = ($: Engine) => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)

export async function slash($: Engine, args = ''): Promise<string> {
  const r = await $.command.run({ command: 'ui-preview', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  return (r as { text?: string }).text ?? ''
}

/** Lets the detached loop and timers run as far as they can. */
export async function settle(w: World, ms = 0): Promise<void> {
  await w.clock.advance(ms)
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
}

export const PANE_PROPS = {
  title: 'UI preview',
  isFocused: false,
  bodyColumns: 70,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

export const mountPane = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'ui-preview', surface, component: 'Pane', requestId: 'ui-preview', props: PANE_PROPS, viewport: { columns: 160, rows: 50, isFullscreen: true } } as never)
