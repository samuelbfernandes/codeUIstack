// A scripted world beneath the plugin: a pretend git repository (answers exactly the commands the mod
// issues, and records the ones that change something), the question dialog, the session and the store.
// An unscripted command throws, so a probe the mod was never meant to make shows up as a failure.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type FakeBranch = {
  sha: string
  upstream?: string // refs/remotes/origin/x
  track?: string // '[gone]', '[ahead 1]'
  ts?: number
  /** Ancestor of the base (`--merged`). */
  merged?: boolean
  /** `git cherry` output lines. */
  cherry?: string
  /** `git diff --quiet branch base -- paths` exits 0. */
  sameContent?: boolean
  stash?: boolean
  /** The branch was only just created: its reflog holds nothing but `branch: Created from`. */
  fresh?: boolean
  remoteTip?: string // refs/remotes/<upstream>^{commit}
  remoteAncestorOfBase?: boolean
  /** `git branch -d` fails with this stderr. */
  deleteFails?: string
}

export type Model = {
  root?: string
  current?: string
  defaultBranch?: string | null
  branches: Record<string, FakeBranch>
  worktrees?: Record<string, string> // branch -> path
  disabled?: boolean
  gh?: {
    installed: boolean
    prs?: Record<string, unknown[]>
    /** Rows `gh pr list --state open` answers with. */
    open?: unknown[]
    /** `gh pr list --state open` fails: 'exit' (not signed in) or 'throw' (timeout / killed). */
    openFails?: 'exit' | 'throw'
  }
  pushFails?: string
  /** Every git/gh command throws (git not installed). */
  broken?: boolean
  /** Only the per-prompt probe fails (exit code 128), as in a corrupt repository or a timeout. */
  probeFails?: boolean
  /** The Bash command itself failed (non-zero exit). */
  bashFails?: boolean
}

export const SHA = (c: string) => c.repeat(40)
const NOW = 1_800_000_000_000

export type Answer = string | ((question: string, options: string[], header: string) => string | Promise<string>) | 'REJECT'

export function world(on: On, model: Model, o: { answer?: Answer; surfaces?: readonly ('terminal' | 'desktop')[]; cwd?: string } = {}) {
  const w = {
    cmds: [] as string[][],
    asks: [] as { question: string; options: string[]; header: string }[],
    toasts: [] as string[],
    logs: [] as string[],
    /** The one-per-session "watching branches" line (toast and log), kept apart from the deletion toasts. */
    notices: { toasts: [] as string[], logs: [] as string[] },
    registered: [] as { name: string; description?: string; argumentHint?: string }[],
    deleted: [] as { flag: string; name: string }[],
    pushed: [] as string[][],
    config: [] as string[][],
    answer: o.answer ?? 'Keep',
    store: new Map<string, unknown>(),
    remoteRefs: {} as Record<string, FakeBranch>,
    clock: mock.clock(on, { now: NOW }),
    model,
  }
  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => (w.store.set(e.key, e.value), { value: undefined }))
  on('session.surfaces', () => ({ value: o.surfaces ?? ['terminal'] }))
  on('session.cwd', () => ({ value: o.cwd ?? '/work' }))
  on('command.register', (_, e) => (w.registered.push(e), { value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    w.cmds.push(argv)
    if (model.broken) throw new Error('spawn git ENOENT')
    const r = answerCommand(w, argv)
    if (!r) throw new Error(`unscripted command: ${argv.join(' ')}`)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions[0]!
    const options = q.options.map(x => x.label)
    w.asks.push({ question: q.question, options, header: q.header })
    const a = w.answer
    if (a === 'REJECT') throw new Error('dialog dismissed')
    const text = typeof a === 'function' ? await a(q.question, options, q.header) : a
    return { result: { questions: e.questions, answers: { [q.question]: text } } } as never
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) =>
    ({ result: { stdout: `ran ${e.command}`, stderr: '', interrupted: false }, ...(model.bashFails ? { isError: true } : {}) }) as never,
  )
  const isNotice = (text: string) => text.startsWith('Watching branches')
  on('ui.toast', (_$, e) => ((isNotice(e.text) ? w.notices.toasts : w.toasts).push(e.text), { value: undefined }))
  on('ui.log', (_$, e) => ((isNotice(e.text) ? w.notices.logs : w.logs).push(e.text), { value: undefined }))
  return w
}

type R = { exitCode?: number; stdout?: string; stderr?: string } | undefined

function answerCommand(w: ReturnType<typeof world>, argvIn: string[]): R {
  const m = w.model
  if (argvIn[0] === 'gh') return answerGh(m, argvIn)
  // strip: git -c core.quotepath=off --no-optional-locks --no-pager --literal-pathspecs
  const a = argvIn.slice(6)
  const line = a.join(' ')
  const names = Object.keys(m.branches)
  const def = m.defaultBranch === undefined ? 'main' : m.defaultBranch
  if (argvIn[0] !== 'git' || argvIn[1] !== '-c' || argvIn[3] !== '--no-optional-locks' || argvIn[4] !== '--no-pager') return undefined

  if (line === 'rev-parse --show-toplevel') return m.root === null ? { exitCode: 128 } : { stdout: `${m.root ?? '/work'}\n` }
  if (line === 'config --local --get toolkit.branchJanitor') return m.disabled ? { stdout: 'false\n' } : { exitCode: 1 }
  if (line === 'config --local toolkit.branchJanitor false') return (w.config.push(a), m.disabled = true, {})
  if (line === 'config --local --unset toolkit.branchJanitor') return (w.config.push(a), m.disabled = false, {})
  if (a[0] === 'for-each-ref' && a[a.length - 1] === 'refs/heads' && a[1]!.startsWith('--format=%(HEAD)')) {
    return {
      stdout: names.map(n => {
        const b = m.branches[n]!
        return [n === m.current ? '*' : ' ', `refs/heads/${n}`, b.sha, b.upstream ?? '', b.upstream ? 'origin' : '', b.track ?? '', String(b.ts ?? NOW / 1000 - 86_400)].join('\t')
      }).join('\n') + '\n',
    }
  }
  if (a[0] === 'for-each-ref' && a[1]!.startsWith('--format=%(HEAD)%(refname) ')) {
    // The per-prompt probe: every ref with its tip and tracking state, so any ref change changes the output.
    if (m.probeFails || m.root === null) return { exitCode: 128, stderr: 'fatal: not a git repository' }
    const heads = names.map(n => `${n === m.current ? '*' : ' '}refs/heads/${n} ${m.branches[n]!.sha} ${m.branches[n]!.track ?? ''}`)
    const remotes = def ? [` refs/remotes/origin/${def} ${m.branches[def]?.sha ?? SHA('0')} `] : []
    return { stdout: [...heads, ...remotes].join('\n') + '\n' }
  }
  if (a[0] === 'reflog' && a[1] === 'show') {
    const b = m.branches[a[a.length - 1]!.replace('refs/heads/', '')]
    return { stdout: b?.fresh ? 'branch: Created from main\n' : 'commit: work\nbranch: Created from main\n' }
  }
  if (line === 'for-each-ref --format=%(refname)%09%(objectname) refs/remotes') {
    const tips = def ? [`refs/remotes/origin/${def}\t${m.branches[def]?.sha ?? SHA('0')}`] : []
    return { stdout: tips.join('\n') + '\n' }
  }
  if (line === 'symbolic-ref --quiet refs/remotes/origin/HEAD') return def ? { stdout: `refs/remotes/origin/${def}\n` } : { exitCode: 1 }
  if (line === 'symbolic-ref --quiet --short HEAD') return { stdout: `${m.current ?? def}\n` }
  if (line === 'worktree list --porcelain') {
    const trees = [`worktree ${m.root ?? '/work'}\nHEAD ${SHA('0')}\nbranch refs/heads/${m.current ?? def}\n`]
    for (const [b, p] of Object.entries(m.worktrees ?? {})) trees.push(`worktree ${p}\nHEAD ${SHA('0')}\nbranch refs/heads/${b}\n`)
    return { stdout: trees.join('\n') }
  }
  if (line === 'stash list --format=%gs') return { stdout: names.filter(n => m.branches[n]!.stash).map(n => `WIP on ${n}: abc1234 msg\n`).join('') }
  if (a[0] === 'merge-base' && a[1] === '--is-ancestor') {
    const owner = [...names.map(n => m.branches[n]!), ...Object.values(w.remoteRefs)].find(b => b.remoteTip === a[2])
    return { exitCode: owner && !owner.remoteAncestorOfBase ? 1 : 0 }
  }
  if (a[0] === 'for-each-ref' && a[1]!.startsWith('--merged=')) return { stdout: names.filter(n => m.branches[n]!.merged).map(n => `refs/heads/${n}\n`).join('') }
  if (a[0] === 'cherry') return { stdout: m.branches[a[2]!.replace('refs/heads/', '')]?.cherry ?? '' }
  if (a[0] === 'merge-base') return { stdout: `${SHA('b')}\n` }
  if (a[0] === 'diff' && a[1] === '--name-only') return { stdout: 'a.txt\0b.txt\0' }
  if (a[0] === 'diff' && a[1] === '--quiet') return { exitCode: m.branches[a[2]!.replace('refs/heads/', '')]?.sameContent ? 0 : 1 }
  if (a[0] === 'rev-parse' && a[1] === '--verify' && a[3]?.startsWith('refs/heads/')) {
    const b = m.branches[a[3].replace('refs/heads/', '')]
    return b ? { stdout: `${b.sha}\n` } : { exitCode: 1 }
  }
  if (a[0] === 'rev-parse' && a[1] === '--verify' && a[3]?.startsWith('refs/remotes/')) {
    const name = a[3].replace('refs/remotes/origin/', '').replace('^{commit}', '')
    const b = m.branches[name] ?? w.remoteRefs[name]
    return b?.remoteTip ? { stdout: `${b.remoteTip}\n` } : { exitCode: 1 }
  }
  if (a[0] === 'branch' && (a[1] === '-d' || a[1] === '-D') && a[2] === '--') {
    const b = m.branches[a[3]!]
    if (b?.deleteFails && a[1] === '-d') return { exitCode: 1, stderr: b.deleteFails }
    w.deleted.push({ flag: a[1]!, name: a[3]! })
    if (b) w.remoteRefs[a[3]!] = b // the remote-tracking ref outlives the local branch
    delete m.branches[a[3]!]
    return {}
  }
  if (a[0] === 'push') {
    w.pushed.push(a)
    return m.pushFails ? { exitCode: 1, stderr: m.pushFails } : {}
  }
  return undefined
}

function answerGh(m: Model, argv: string[]): R {
  if (!m.gh?.installed) throw new Error('gh: command not found')
  if (argv[1] === '--version') return { stdout: 'gh version 2.0.0\n' }
  if (argv[1] === 'pr' && argv[2] === 'list' && argv.includes('--state') && argv[argv.indexOf('--state') + 1] === 'open') {
    if (m.gh.openFails === 'throw') throw new Error('timed out')
    if (m.gh.openFails === 'exit') return { exitCode: 4, stderr: 'To get started with GitHub CLI, please run: gh auth login' }
    return { stdout: JSON.stringify(m.gh.open ?? []) }
  }
  if (argv[1] === 'pr' && argv[2] === 'list') {
    const head = argv[argv.indexOf('--head') + 1]!
    return { stdout: JSON.stringify(m.gh.prs?.[head] ?? []) }
  }
  return undefined
}
