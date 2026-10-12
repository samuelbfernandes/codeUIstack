// A scripted world beneath the plugin: the tools, the question dialog, the log, the store, the submitted prompt.
// What the test hooks answer stands for the engine.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type Surface = 'terminal' | 'desktop'
/** What the person picks in the dialog: a label, 'REJECT' (Esc) or any free text. */
export type Answer = string

type Tool = (e: Record<string, unknown>) => unknown

export function world(on: On, o: { surface?: Surface; answer?: Answer; store?: Record<string, unknown>; tools?: Record<string, Tool> } = {}) {
  const w = {
    logs: [] as string[],
    asks: [] as { question: string; options: string[]; header: string }[],
    submitted: [] as string[],
    submittedAttachments: [] as unknown[],
    registered: [] as string[],
    tools: { ...o.tools } as Record<string, Tool>,
    answer: o.answer ?? 'Send redacted',
    surface: o.surface ?? 'terminal',
    failLog: false,
    stored: [] as [string, unknown][],
    session: mock.session(on),
  }
  const store = new Map(Object.entries(o.store ?? {})) // the plugin's own store, kept in memory; `stored` lists the writes
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), w.stored.push([e.key, e.value]), { value: undefined }))
  on('session.surfaces', () => ({ value: [w.surface] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: { command: e.name } }))
  on('ui.log', (_$, e) => {
    if (w.failLog) throw new Error('log is down')
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('tool.call', (_$, e) => {
    if (e.tool === 'AskUserQuestion') {
      const q = (e as unknown as { questions: { question: string; header: string; options: { label: string }[] }[] }).questions[0]!
      w.asks.push({ question: q.question, options: q.options.map(x => x.label), header: q.header })
      if (w.answer === 'REJECT') throw new Error('dialog dismissed')
      return { result: { questions: (e as never as { questions: unknown[] }).questions, answers: { [q.question]: w.answer } } } as never
    }
    const tool = w.tools[e.tool]
    if (tool === undefined) throw new Error(`no scripted tool ${e.tool}`)
    return tool(e as never) as never
  })
  on('prompt.submit', (_$, e) => {
    w.submitted.push(e.text)
    w.submittedAttachments.push(e.attachments)
    return { text: e.text }
  })
  return w
}

export const SURFACES = ['terminal', 'desktop'] as const

/** An answered tool result as core hands it up: the record plus the `ref` and `text` core sets. */
export const answered = (result: unknown, extra: Record<string, unknown> = {}) => ({ result, ref: 7, text: 'what the model would read', ...extra })
