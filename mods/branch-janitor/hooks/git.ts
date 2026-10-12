// Thin, read-only-by-default git layer: argv builder, never-throwing runner, and the pure
// parsers for the handful of git outputs the mod reads. No shell is ever involved, so the same
// code runs on macOS, Windows and Linux; every parser tolerates CRLF line endings.

export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type RunOptions = { cwd?: string; timeoutMs?: number; stdin?: string }
/** `$.process.run` as the mod needs it: an argv ARRAY, never a shell string. */
export type Run = (argv: readonly string[], options?: RunOptions) => Promise<RunResult>

/** Global git flags for every call: no octal-escaped paths, no index lock, no pager, no pathspec magic. */
const GIT_PREFIX = ['git', '-c', 'core.quotepath=off', '--no-optional-locks', '--no-pager', '--literal-pathspecs']
const GIT_TIMEOUT_MS = 20_000

export type Git = (...args: string[]) => Promise<RunResult>

/** A git runner bound to a directory. It never throws: a spawn failure or timeout reads as exit code 127. */
export function gitIn(run: Run, cwd: string | undefined, timeoutMs: number = GIT_TIMEOUT_MS): Git {
  return async (...args) => {
    try {
      return await run([...GIT_PREFIX, ...args], { cwd, timeoutMs })
    } catch (error) {
      return { exitCode: 127, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
    }
  }
}

export const lines = (text: string): string[] => text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l !== '')

/** A branch or remote name that is safe to hand to git as an argument and to print in a dialog. */
export function isSafeName(name: string): boolean {
  if (name === '' || name.length > 255) return false
  if (name.startsWith('-')) return false // would read as an option
  if (/[\u0000- \u007f]/.test(name)) return false // control characters and spaces (spaces are illegal in refs anyway)
  return !name.includes('..') && !name.includes('@{') && !name.endsWith('/') && !name.endsWith('.lock')
}

/** `release/*` style patterns: `*` matches any run of characters, everything else is literal. */
export function matchesPattern(name: string, pattern: string): boolean {
  const re = pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${re}$`).test(name)
}

// ---------------------------------------------------------------- for-each-ref

export type BranchRef = {
  name: string
  sha: string
  isCurrent: boolean
  /** Full upstream ref (`refs/remotes/origin/x`), '' when none is configured. */
  upstream: string
  remote: string
  ahead: number
  behind: number
  /** The upstream is configured but no longer exists (`[gone]`). */
  isGone: boolean
  /** Committer date of the tip, seconds since the epoch (0 when unknown). */
  lastCommit: number
}

/** The `--format` for `git for-each-ref refs/heads` that `parseBranchRefs` reads (tab separated). */
export const BRANCH_FORMAT = '%(HEAD)%09%(refname)%09%(objectname)%09%(upstream)%09%(upstream:remotename)%09%(upstream:track)%09%(committerdate:unix)'

export function parseTrack(track: string): { isGone: boolean; ahead: number; behind: number } {
  const t = track.trim()
  return {
    isGone: t.includes('gone'),
    ahead: Number(/ahead (\d+)/.exec(t)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(t)?.[1] ?? 0),
  }
}

export function parseBranchRefs(out: string): BranchRef[] {
  const refs: BranchRef[] = []
  for (const line of lines(out)) {
    const [head = '', refname = '', sha = '', upstream = '', remote = '', track = '', date = ''] = line.split('\t')
    if (!refname.startsWith('refs/heads/')) continue
    refs.push({
      name: refname.slice('refs/heads/'.length),
      sha,
      isCurrent: head === '*',
      upstream,
      remote,
      ...parseTrack(track),
      lastCommit: Number(date) || 0,
    })
  }
  return refs
}

/** `for-each-ref --format=%(refname)%09%(objectname) refs/remotes` into name -> sha, keyed `origin/main`. */
export function parseRemoteTips(out: string): Map<string, string> {
  const tips = new Map<string, string>()
  for (const line of lines(out)) {
    const [ref = '', sha = ''] = line.split('\t')
    if (ref.startsWith('refs/remotes/') && sha) tips.set(ref.slice('refs/remotes/'.length), sha)
  }
  return tips
}

/**
 * `git reflog show --format=%gs -n 2 <branch>` (newest first): true when the branch's whole history is its
 * creation. A branch nobody has committed on or fast-forwarded since `git branch` / `git switch -c` has the
 * same tip as the branch it came from, so it looks "merged" while it is really work that has not started.
 * An empty reflog (reflogs off, or expired) says nothing, so it is not "just created".
 */
export function parseJustCreated(out: string): boolean {
  const entries = lines(out)
  return entries.length === 1 && /^branch: Created from /i.test(entries[0]!)
}

// ---------------------------------------------------------------- cherry / worktree / stash / gh

/** `git cherry <base> <branch>`: '+' = commit with no patch-equivalent on base, '-' = it has one. Empty = nothing ahead. */
export function parseCherry(out: string): { plus: number; minus: number } {
  let plus = 0
  let minus = 0
  for (const line of lines(out)) {
    if (line.startsWith('+ ')) plus++
    else if (line.startsWith('- ')) minus++
  }
  return { plus, minus }
}

export type Worktree = { path: string; branch?: string; isBare: boolean }

/** `git worktree list --porcelain`: blocks separated by blank lines; a path may hold spaces. */
export function parseWorktrees(out: string): Worktree[] {
  const trees: Worktree[] = []
  let cur: Worktree | undefined
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice('worktree '.length), isBare: false }
      trees.push(cur)
    } else if (cur && line.startsWith('branch refs/heads/')) cur.branch = line.slice('branch refs/heads/'.length)
    else if (cur && line === 'bare') cur.isBare = true
  }
  return trees
}

/** Branch names that have a stash: lines `stash@{0}: WIP on <branch>: ...` / `On <branch>: ...` (or bare `%gs`). */
export function parseStashBranches(out: string): Set<string> {
  const names = new Set<string>()
  for (const line of lines(out)) {
    const m = /^(?:stash@\{\d+\}: )?(?:WIP on|On) (.+?): /.exec(line)
    if (m?.[1]) names.add(m[1])
  }
  return names
}

export type MergedPr = { number: number; baseRefName: string; headRefOid: string }

/** `gh pr list --state merged --json number,mergedAt,baseRefName,headRefOid`; anything unexpected is no PR. */
export function parseMergedPr(out: string): MergedPr | undefined {
  try {
    const rows: unknown = JSON.parse(out)
    const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined
    if (!row || typeof row.number !== 'number' || !row.mergedAt) return undefined
    return { number: row.number, baseRefName: String(row.baseRefName ?? ''), headRefOid: String(row.headRefOid ?? '') }
  } catch {
    return undefined
  }
}
