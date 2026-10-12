import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

type Run = (argv: string[]) => { exitCode?: number; stdout?: string; stderr?: string } | undefined

/** A scripted world beneath the plugin: store, state, files, processes and the Bash tool. */
export function world(on: On, o: { storeDown?: boolean; store?: Record<string, unknown>; run?: Run; bash?: (c: string) => Record<string, unknown> } = {}) {
  const w = {
    store: new Map(Object.entries(o.store ?? {})),
    state: new Map<string, unknown>(),
    files: new Map<string, string>(),
    present: new Set<string>(),
    registered: [] as string[],
    runs: [] as string[],
    session: mock.session(on),
    clock: mock.clock(on, { now: 1_000_000 }),
  }
  on('store.get', (_$, e) => {
    if (o.storeDown) throw new Error('store down')
    return { value: w.store.get(e.key) }
  })
  on('store.set', (_$, e) => (w.store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (w.store.delete(e.key), { value: undefined }))
  on('state.get', (_$, e) => ({ value: { value: w.state.get(`${e.plugin}.${e.key}`), version: w.state.has(`${e.plugin}.${e.key}`) ? 1 : 0 } as never }))
  on('state.set', (_$, e) => (w.state.set(`${e.plugin}.${e.key}`, e.value), { value: { isSet: true, version: 1 } as never }))
  on('session.cwd', () => ({ value: '/work/proj' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: { command: e.name } as never }))
  on('fs.exists', (_$, e) => ({ value: [...w.present].some(p => e.path === p || e.path.endsWith(`/${p}`)) }))
  on('fs.write', (_$, e) => (w.files.set(e.path, e.text), { value: undefined }))
  on('process.run', (_$, e) => {
    w.runs.push(e.argv.join(' '))
    const r = o.run?.([...e.argv]) ?? { exitCode: 1 }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r } }
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const r = o.bash?.(e.command) ?? {}
    return { result: { stdout: 'ok', stderr: '', interrupted: false }, ...r } as never
  })
  on('tool.call', { tool: /^(Edit|Write)$/ }, () => ({ result: {} }) as never)
  return w
}

export const slash = ($: any, args: string) =>
  $.command.run({ command: 'repro', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
