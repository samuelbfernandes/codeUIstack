// A scripted world beneath the plugin: files of a pretend project, the process runner, the store, toasts and log.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type Run = { exitCode?: number; stdout?: string; stderr?: string; throws?: string; afterMs?: number }

export function world(on: On, o: { files?: Record<string, string>; run?: Run; store?: Record<string, unknown>; cwd?: string; storeThrows?: boolean } = {}) {
  const w = {
    files: o.files ?? {},
    run: o.run ?? ({ exitCode: 0 } as Run),
    /** While set, a run waits for it. */
    gate: undefined as Promise<void> | undefined,
    runs: [] as { argv: string[]; cwd?: string; timeoutMs?: number }[],
    toasts: [] as string[],
    logs: [] as string[],
    registered: [] as string[],
    clock: mock.clock(on, { now: 1_000_000 }),
    session: mock.session(on),
    store: new Map<string, unknown>(Object.entries(o.store ?? {})),
    state: new Map<string, unknown>(),
  }
  const cwd = o.cwd ?? '/proj'
  on('store.get', (_$, e) => {
    if (o.storeThrows) throw new Error('store down')
    return { value: w.store.get(e.key) }
  })
  on('store.set', (_$, e) => (w.store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (w.store.delete(e.key), { value: undefined }))
  on('state.get', (_$, e) => ({ value: { value: w.state.get(`${e.plugin}.${e.key}`), version: w.state.has(`${e.plugin}.${e.key}`) ? 1 : 0 } as never }))
  on('state.set', (_$, e) => (w.state.set(`${e.plugin}.${e.key}`, e.value), { value: { isSet: true, version: 1 } as never }))
  on('session.cwd', () => ({ value: cwd }))
  on('fs.exists', (_$, e) => ({ value: `${cwd}/${e.path.slice(cwd.length + 1)}` in prefixed(w.files, cwd) }))
  on('fs.read', (_$, e) => {
    const text = prefixed(w.files, cwd)[e.path]
    if (text === undefined) throw new Error('missing')
    return { value: text as never }
  })
  on('process.run', async (_$, e) => {
    w.runs.push({ argv: [...e.argv], cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs })
    if (w.gate) await w.gate
    if (w.run.afterMs) await w.clock.advance(w.run.afterMs)
    if (w.run.throws) throw new Error(w.run.throws)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...w.run } }
  })
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: undefined as never }))
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.log', (_$, e) => (w.logs.push(e.text), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} }) as never)
  on('tool.call', { tool: 'Write' }, () => ({ result: {} }) as never)
  on('tool.call', { tool: 'NotebookEdit' }, () => ({ result: {} }) as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: {} }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return w
}

const prefixed = (files: Record<string, string>, cwd: string) => Object.fromEntries(Object.entries(files).map(([k, v]) => [`${cwd}/${k}`, v]))
