// A scripted world beneath the plugin: the session, the process runner, the question
// dialog, the Bash tool itself. What the test hooks answer stands for the engine.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type Answer = string | 'REJECT'
export type Probe = (argv: string[], cwd?: string) => { exitCode?: number; stdout?: string; stderr?: string } | undefined

export function world(on: On, o: { answer?: Answer; probe?: Probe; cwd?: string; surfaces?: readonly ('terminal' | 'desktop')[] } = {}) {
  const w = {
    probes: [] as { argv: string[]; cwd?: string }[],
    asks: [] as { question: string; options: string[]; header: string }[],
    ran: [] as string[],
    toasts: [] as string[],
    status: [] as (string | undefined)[],
    clock: mock.clock(on),
    answer: o.answer ?? 'Cancel',
  }
  mock.env(on, { HOME: '/home/sam' })
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
