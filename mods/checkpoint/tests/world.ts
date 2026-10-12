// A scripted world beneath the plugin: a pretend git repository (working tree, index, stash, refs, trees and
// commits kept in memory) that answers exactly the plumbing commands the mod issues, the question dialog and the
// session. An unscripted command throws, so a probe the mod was never meant to make shows up as a failure.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type Opts = {
  answer?: string | 'REJECT'
  files?: Record<string, string>
  /** Paths git tracks (in the real index). */
  tracked?: string[]
  /** Paths that exist but are ignored by git (never in a snapshot). */
  ignored?: Record<string, string>
  notRepo?: boolean
  broken?: boolean
  surfaces?: readonly ('terminal' | 'desktop')[]
  startMs?: number
}

const hex = (n: number) => n.toString(16).padStart(40, '0')
const djb = (s: string) => {
  let h = 5381
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0
  return h
}

export function world(on: On, o: Opts = {}) {
  const start = o.startMs ?? 1_800_000_000_000
  const w = {
    files: new Map<string, string>(Object.entries(o.files ?? {})),
    ignored: new Map<string, string>(Object.entries(o.ignored ?? {})),
    tracked: new Set<string>(o.tracked ?? Object.keys(o.files ?? {})),
    trees: new Map<string, Record<string, string>>(),
    commits: new Map<string, { tree: string; msg: string; at: number; parent?: string }>(),
    refs: new Map<string, string>(),
    head: undefined as string | undefined,
    /** What must never change. */
    realIndex: 'INDEX-v1',
    branch: 'main',
    stashes: [] as string[],
    cmds: [] as { argv: string[]; env?: Record<string, string>; stdin?: string }[],
    asks: [] as { question: string; options: string[]; header: string }[],
    state: new Map<string, unknown>(),
    registered: [] as string[],
    nowMs: start,
    clock: mock.clock(on, { now: start }),
    answer: o.answer ?? 'Cancel',
    broken: o.broken ?? false,
    notRepo: o.notRepo ?? false,
    pending: undefined as Record<string, string> | undefined,
    /** Moves the pretend git clock and the engine clock together. */
    async tick(ms: number) {
      w.nowMs += ms
      await w.clock.advance(ms)
    },
    /** The argv with the git prefix stripped. */
    git: () => w.cmds.filter(c => c.argv[0] === 'git').map(c => c.argv.slice(6)),
    refNames: () => [...w.refs.keys()].map(r => r.replace('refs/moddeck/checkpoints/', '')).sort(),
    sha: (name: string) => w.refs.get(`refs/moddeck/checkpoints/${name}`)!,
    treeOf: (name: string) => w.trees.get(w.commits.get(w.sha(name))!.tree)!,
  }
  const treeIdOf = (m: Record<string, string>) => {
    const sorted = Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)))
    const id = hex(djb(JSON.stringify(sorted)))
    w.trees.set(id, sorted)
    return id
  }
  // The head commit: a clean repository with the tracked files as given.
  const headTreeId = treeIdOf(Object.fromEntries([...w.files].filter(([p]) => w.tracked.has(p))))
  w.head = hex(1)
  w.commits.set(w.head, { tree: headTreeId, msg: 'initial', at: Math.floor(start / 1000) - 86_400 })
  let n = 100

  on('state.get', (_$, e) => ({ value: { value: w.state.get(`${e.plugin}.${e.key}`), version: w.state.has(`${e.plugin}.${e.key}`) ? 1 : 0 } as never }))
  on('state.set', (_$, e) => (w.state.set(`${e.plugin}.${e.key}`, e.value), { value: { isSet: true, version: 1 } as never }))
  on('session.surfaces', () => ({ value: o.surfaces ?? ['terminal'] }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.register', (_, e) => (w.registered.push(e.name), { value: { command: e.name } }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0]!
    w.asks.push({ question: q.question, options: q.options.map(x => x.label), header: q.header })
    if (w.answer === 'REJECT') throw new Error('dialog dismissed')
    return { result: { questions: e.questions, answers: { [q.question]: w.answer } } } as never
  })

  /** A tree-ish: a tree id or a commit id. */
  const filesOf = (id: string): Record<string, string> | undefined => w.trees.get(id) ?? w.trees.get(w.commits.get(id)?.tree ?? '')
  const out = (stdout = '', exitCode = 0, stderr = '') => ({ exitCode, stdout, stderr })

  function git(a: string[], env: Record<string, string> | undefined, stdin: string | undefined) {
    const line = a.join(' ')
    if (line === 'rev-parse --show-toplevel') return w.notRepo ? out('', 128, 'fatal: not a git repository') : out('/work\n')
    if (w.notRepo) return out('', 128, 'fatal: not a git repository')
    if (line === 'rev-parse --absolute-git-dir') return out('/work/.git\n')
    if (line === 'rev-parse -q --verify HEAD') return w.head ? out(`${w.head}\n`) : out('', 1)
    if (line === 'rev-parse -q --verify HEAD^{tree}') return out(`${w.commits.get(w.head!)!.tree}\n`)
    let m = /^rev-parse -q --verify (refs\/\S+)\^\{commit\}$/.exec(line)
    if (m) return w.refs.has(m[1]!) ? out(`${w.refs.get(m[1]!)}\n`) : out('', 1)
    m = /^rev-parse -q --verify ([0-9a-f]+)\^\{tree\}$/.exec(line)
    if (m) return w.commits.has(m[1]!) ? out(`${w.commits.get(m[1]!)!.tree}\n`) : out('', 1)
    if (line === 'add -A') {
      if (!env?.GIT_INDEX_FILE) throw new Error('add -A without a temporary index: would touch the real index')
      w.pending = Object.fromEntries(w.files)
      return out()
    }
    if (line === 'write-tree') {
      if (!env?.GIT_INDEX_FILE) throw new Error('write-tree on the real index')
      return out(`${treeIdOf(w.pending ?? {})}\n`)
    }
    if (a[0] === 'commit-tree') {
      if (!env?.GIT_AUTHOR_NAME || !env?.GIT_COMMITTER_EMAIL) throw new Error('commit-tree without an identity')
      const p = a.indexOf('-p')
      const sha = hex(n++)
      w.commits.set(sha, { tree: a[1]!, msg: a[a.indexOf('-m') + 1]!, at: Math.floor(w.nowMs / 1000), ...(p > 0 ? { parent: a[p + 1]! } : {}) })
      return out(`${sha}\n`)
    }
    if (a[0] === 'update-ref' && a[1] === '-d') return w.refs.delete(a[2]!) ? out() : out('', 1, 'error: no such ref')
    if (a[0] === 'update-ref') {
      if (!a[1]!.startsWith('refs/moddeck/checkpoints/')) throw new Error(`update-ref outside the checkpoint namespace: ${a[1]}`)
      return (w.refs.set(a[1]!, a[2]!), out())
    }
    if (a[0] === 'for-each-ref') {
      const rows = [...w.refs].map(([ref, sha]) => ({ ref, sha, at: w.commits.get(sha)!.at }))
      rows.sort((x, y) => (x.ref < y.ref ? 1 : -1)) // --sort=-refname
      return out(rows.map(r => `${r.ref}\t${r.sha}\t${r.at}\n`).join(''))
    }
    if (a[0] === 'ls-tree') return out(Object.keys(filesOf(a[a.length - 1]!) ?? {}).map(p => `${p}\0`).join(''))
    if (a[0] === 'diff-tree' || a[0] === 'diff') {
      const [x, y] = [filesOf(a[a.length - 2]!) ?? {}, filesOf(a[a.length - 1]!) ?? {}]
      const rows: [string, string][] = []
      for (const p of new Set([...Object.keys(x), ...Object.keys(y)]).values()) {
        if (!(p in x)) rows.push(['A', p])
        else if (!(p in y)) rows.push(['D', p])
        else if (x[p] !== y[p]) rows.push(['M', p])
      }
      rows.sort(([, p], [, q]) => (p < q ? -1 : 1))
      if (a[0] === 'diff') return out(rows.length ? rows.map(([s, p]) => ` ${p} | 1 ${s}\n`).join('') + ` ${rows.length} files changed\n` : '')
      return out(a.includes('--name-status') ? rows.map(([s, p]) => `${s}\0${p}\0`).join('') : rows.map(([, p]) => `${p}\0`).join(''))
    }
    if (line === 'ls-files -z') return out([...w.tracked].map(p => `${p}\0`).join(''))
    if (a[0] === 'log') return out(`${w.commits.get(a[a.length - 1]!)?.msg ?? ''}\n`)
    if (a[0] === 'restore') {
      const src = filesOf(a[1]!.replace('--source=', ''))!
      for (const p of (stdin ?? '').split('\0').filter(Boolean)) {
        if (p in src) w.files.set(p, src[p]!)
        else w.files.delete(p)
      }
      return out()
    }
    return undefined
  }

  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    w.cmds.push({ argv, env: e.init?.env, stdin: e.init?.stdin })
    if (w.broken) throw new Error('spawn git ENOENT')
    let r: ReturnType<typeof out> | undefined
    if (argv[0] === 'rm') {
      w.files.delete(argv[argv.length - 1]!)
      r = out()
    } else if (argv[0] === 'git') r = git(argv.slice(6), e.init?.env, e.init?.stdin)
    if (!r) throw new Error(`unscripted command: ${argv.join(' ')}`)
    return { value: { isStdoutTruncated: false, isStderrTruncated: false, ...r } }
  })
  return w
}

export type World = ReturnType<typeof world>
export const slash = ($: any, args: string) =>
  $.command.run({ command: 'checkpoint', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
export const typed = ($: any, text = 'go on') => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
