// A scripted world beneath the plugin: a tiny fake git, a file system, the question dialog, the Bash tool, store and state.
import type { On } from 'claude-code'

export type Answer = string | 'REJECT'
export type Staged = { status: string; path: string }
export type Status = { x: string; y: string; path: string }

export type Repo = {
  staged?: Staged[]
  unstaged?: Staged[]
  status?: Status[]
  /** path -> file text (worktree; also the staged blob unless `blobs` says otherwise) */
  files?: Record<string, string>
  blobs?: Record<string, string>
  /** path -> size in bytes, where it should differ from the text length */
  sizes?: Record<string, number>
  lfs?: string[]
  ignored?: string[]
  prefix?: string
}

export function world(on: On, o: { answer?: Answer; repo?: Repo; store?: Record<string, unknown>; failProcess?: boolean; notGit?: boolean; brokenWorkFile?: string; surfaces?: readonly ('terminal' | 'desktop')[] } = {}) {
  const repo = o.repo ?? {}
  const w = {
    argvs: [] as string[][],
    inits: [] as { timeoutMs?: number }[],
    asks: [] as { question: string; options: string[]; header: string }[],
    ran: [] as string[],
    logs: [] as string[],
    toasts: [] as string[],
    writes: new Map<string, string>(),
    added: [] as string[][],
    answer: o.answer ?? 'Hold it',
    store: new Map<string, unknown>(Object.entries(o.store ?? {})),
    state: new Map<string, unknown>(),
    registered: [] as string[],
    repo,
    failProcess: o.failProcess ?? false,
  }
  const text = (p: string) => w.writes.get(p) ?? repo.files?.[p]
  const sizeOf = (p: string) => repo.sizes?.[p] ?? text(p)?.length ?? repo.blobs?.[p]?.length

  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => (w.store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (w.store.delete(e.key), { value: undefined }))
  on('state.get', (_$, e) => ({ value: { value: w.state.get(`${e.plugin}.${e.key}`), version: w.state.has(`${e.plugin}.${e.key}`) ? 1 : 0 } as never }))
  on('state.set', (_$, e) => (w.state.set(`${e.plugin}.${e.key}`, e.value), { value: { isSet: true, version: 1 } as never }))
  on('session.surfaces', () => ({ value: o.surfaces ?? ['terminal'] }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: undefined as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.log', (_$, e) => (w.logs.push(e.text), { value: undefined }))
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))

  on('fs.stat', (_$, e) => {
    const p = e.path.replace(/^\/repo\//, '')
    const size = sizeOf(p)
    if (size === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', (_$, e) => {
    if (o.brokenWorkFile !== undefined) return { value: o.brokenWorkFile }
    const t = text(e.path.replace(/^\/repo\//, ''))
    if (t === undefined) throw new Error('ENOENT')
    return { value: t }
  })
  on('fs.write', (_$, e) => (w.writes.set(e.path.replace(/^\/repo\//, ''), e.text), { value: undefined }))

  on('process.run', (_$, e) => {
    if (w.failProcess) throw new Error('process blew up')
    const argv = [...e.argv]
    w.argvs.push(argv)
    w.inits.push({ ...(e.init as { timeoutMs?: number } | undefined) })
    const stdin = (e.init as { stdin?: string } | undefined)?.stdin ?? ''
    const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (o.notGit) return ok('', 128)
    const [git, sub, ...rest] = argv
    if (git !== 'git') throw new Error(`unscripted: ${argv.join(' ')}`)
    switch (sub) {
      case 'rev-parse':
        return ok(`/repo\n${repo.prefix ?? ''}\n`)
      case 'diff':
        return ok((rest.includes('--cached') ? repo.staged ?? [] : repo.unstaged ?? []).map(s => `${s.status}\0${s.path}\0`).join(''))
      case 'status':
        return ok((repo.status ?? []).map(s => `${s.x}${s.y} ${s.path}\0`).join(''))
      case 'check-attr':
        return ok(stdin.split('\0').filter(Boolean).map(p => `${p}\0filter\0${repo.lfs?.includes(p) ? 'lfs' : 'unspecified'}\0`).join(''))
      case 'check-ignore': {
        const hit = stdin.split('\0').filter(p => repo.ignored?.includes(p))
        return ok(hit.map(p => `${p}\0`).join(''), hit.length ? 0 : 1)
      }
      case 'cat-file':
        return ok(
          stdin.split('\n').filter(Boolean).map(l => {
            const p = l.slice(1)
            const b = repo.blobs?.[p] ?? repo.files?.[p]
            const size = repo.sizes?.[p] ?? b?.length
            return size === undefined ? `${l} missing` : `abc123 blob ${size}`
          }).join('\n') + '\n',
        )
      case 'show': {
        const b = repo.blobs?.[rest[0]!.slice(1)] ?? repo.files?.[rest[0]!.slice(1)]
        return b === undefined ? ok('', 128) : ok(b)
      }
      case 'add':
        w.added.push(rest.slice(1))
        return ok('')
      default:
        throw new Error(`unscripted: ${argv.join(' ')}`)
    }
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
  return w
}

/** An executed notebook, as nbformat writes it. */
export const dirtyNotebook = (): string =>
  `${JSON.stringify(
    {
      cells: [
        { cell_type: 'markdown', metadata: {}, source: ['# Title'] },
        { cell_type: 'code', execution_count: 3, metadata: {}, outputs: [{ name: 'stdout', output_type: 'stream', text: ['SECRETVALUE 42\n'] }], source: ['print(1)'] },
      ],
      metadata: { kernelspec: { name: 'python3' } },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  )}\n`

export const cleanNotebook = (): string =>
  `${JSON.stringify({ cells: [{ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: ['1'] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }, null, 1)}\n`
