// A scripted world beneath the plugin: the session, the process runner, the question
// dialog, the Bash tool itself. What the test hooks answer stands for the engine.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type Answer = string | 'REJECT'
export type Probe = (argv: string[], cwd?: string) => { exitCode?: number; stdout?: string; stderr?: string } | undefined

export function world(on: On, o: { answer?: Answer; probe?: Probe; cwd?: string; surfaces?: readonly ('terminal' | 'desktop')[]; store?: Record<string, unknown> } = {}) {
  const w = {
    probes: [] as { argv: string[]; cwd?: string }[],
    asks: [] as { question: string; options: string[]; header: string }[],
    ran: [] as string[],
    toasts: [] as string[],
    status: [] as (string | undefined)[],
    clock: mock.clock(on),
    answer: o.answer ?? 'Cancel',
    store: new Map<string, unknown>(Object.entries(o.store ?? {})),
    state: new Map<string, unknown>(),
  }
  mock.env(on, { HOME: '/home/sam' })
  // The plugin's own store and state, in memory and readable by the test (`state` holds what the atom mirrors).
  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => (w.store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (w.store.delete(e.key), { value: undefined }))
  on('state.get', (_$, e) => ({ value: { value: w.state.get(`${e.plugin}.${e.key}`), version: w.state.has(`${e.plugin}.${e.key}`) ? 1 : 0 } as never }))
  on('state.set', (_$, e) => (w.state.set(`${e.plugin}.${e.key}`, e.value), { value: { isSet: true, version: 1 } as never }))
  on('session.surfaces', () => ({ value: o.surfaces ?? ['terminal'] }))
  on('session.cwd', () => ({ value: o.cwd ?? '/work' }))
  on('process.run', (_$, e) => {
    w.probes.push({ argv: [...e.argv], cwd: e.init?.cwd })
    const r = o.probe?.([...e.argv], e.init?.cwd)
    if (!r) throw new Error(`unscripted probe: ${e.argv.join(' ')}`)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0]!
    w.asks.push({ question: q.question, options: q.options.map(x => x.label), header: q.header })
    if (w.answer === 'REJECT') throw new Error('dialog dismissed')
    return { result: { questions: e.questions, answers: { [q.question]: w.answer } } } as never
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    w.ran.push(e.command)
    return { result: { stdout: 'ran', stderr: '', interrupted: false } } as never
  })
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.status', (_$, e) => (w.status.push(e.text), { value: undefined }))
  return w
}

/** Probes for a project where `build/` is a 3-file, 38 MB directory and nothing else exists. */
export const buildDir: Probe = argv => {
  const line = argv.join(' ')
  if (/^find \/work\/build -maxdepth 0 (-type d )?-print$/.test(line)) return { stdout: '/work/build\n' }
  if (/^du -sk \/work\/build$/.test(line)) return { stdout: '39100\t/work/build\n' }
  if (/^find \/work\/build ! -type d -print$/.test(line)) return { stdout: '/work/build/a.o\n/work/build/b.o\n/work/build/c.o\n' }
  if (/^find \/work\/build -mindepth 1 -maxdepth 1$/.test(line)) return { stdout: '' }
  if (/^du -sk$/.test(line) || /^find -maxdepth 0 -type d -print$/.test(line)) return { stdout: '' }
  return undefined
}
