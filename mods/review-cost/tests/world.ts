// A scripted world beneath the plugin: a fake git, the session, the question dialog, the Bash tool.
// What the test hooks answer stands for the engine.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type Surface = 'terminal' | 'desktop'
export type Answer = string | 'REJECT'

export type Repo = {
  root: string
  config: string[] // `git config --get-regexp` lines, e.g. 'toolkit.theorypaths R src'
  tracked: string[] // files `git ls-files --cached --others` would list
  head: boolean
  upstream?: string // abbrev-ref of @{u}; undefined = no upstream
  mergeBases?: string[] // refs `git merge-base HEAD <ref>` succeeds for (default: origin/main)
  numstat: string // what `git diff --numstat` prints
  failConfigWrite?: boolean
  failDiff?: boolean
}

/** A repo with a theory file and one changed file of `lines` added lines. */
export const repo = (lines: number, extra: Partial<Repo> = {}): Repo => ({
  root: '/work/proj',
  config: [],
  tracked: ['docs/THEORY_REVIEW.md'],
  head: true,
  upstream: 'origin/main',
  numstat: `${lines}\t0\tR/model.R\n`,
  ...extra,
})

export function world(
  on: On,
  o: { repo?: Repo; answer?: Answer; surfaces?: readonly Surface[]; cwd?: string; skipEnv?: string; throwOn?: string } = {},
) {
  const r = o.repo ?? repo(580)
  const w = {
    runs: [] as { argv: string[]; cwd?: string }[],
    asks: [] as { question: string; options: string[]; header: string }[],
    ran: [] as string[],
    toasts: [] as string[],
    decisions: [] as string[],
    clock: mock.clock(on),
    answer: o.answer ?? 'Review (default)',
    repo: r,
  }
  mock.env(on, o.skipEnv === undefined ? {} : { SKIP_THEORY_REVIEW: o.skipEnv })
  on('session.surfaces', () => ({ value: o.surfaces ?? ['terminal'] }))
  on('session.cwd', () => ({ value: o.cwd ?? '/work' }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    w.runs.push({ argv, cwd: e.init?.cwd })
    const line = argv.slice(1).join(' ')
    if (o.throwOn !== undefined && line.startsWith(o.throwOn)) throw new Error('git exploded')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...git(w.repo, line, w.decisions) } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0]!
    w.asks.push({ question: q.question, options: q.options.map(x => x.label), header: q.header })
    if (w.answer === 'REJECT') throw new Error('dialog dismissed')
    return { result: { questions: e.questions, answers: { [q.question]: w.answer } } } as never
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    w.ran.push(e.command)
    return { result: { stdout: 'pushed', stderr: '', interrupted: false } } as never
  })
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  return w
}

function git(r: Repo, line: string, decisions: string[]): { exitCode?: number; stdout?: string } {
  const out = (stdout: string) => ({ stdout })
  if (line === 'rev-parse --show-toplevel') return out(`${r.root}\n`)
  if (line.startsWith('config --get-regexp')) return r.config.length ? out(r.config.join('\n') + '\n') : { exitCode: 1 }
  if (line.startsWith('ls-files')) return out(r.tracked.join('\n'))
  if (line === 'rev-parse --verify --quiet HEAD') return r.head ? out('abc\n') : { exitCode: 1 }
  if (line === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') return r.upstream ? out(`${r.upstream}\n`) : { exitCode: 128 }
  if (line.startsWith('symbolic-ref')) return { exitCode: 128 }
  if (line.startsWith('merge-base HEAD ')) return (r.mergeBases ?? ['origin/main']).includes(line.slice('merge-base HEAD '.length)) ? out('base123\n') : { exitCode: 1 }
  if (line.startsWith('diff --numstat')) return r.failDiff ? { exitCode: 128 } : out(r.numstat)
  if (line.startsWith('config --local toolkit.theoryDecision ')) {
    if (r.failConfigWrite) return { exitCode: 1 }
    decisions.push(line.slice('config --local toolkit.theoryDecision '.length))
    return {}
  }
  throw new Error(`unscripted git: ${line}`)
}
