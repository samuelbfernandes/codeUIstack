// The recoverability check: for paths that are about to be deleted, overwritten or emptied,
// say what can NOT be got back. READ-ONLY and argv-only like the rest of the measurer.
//
// Questions answered per path, using git where the path is inside a repository:
//   uncommitted change   tracked, but modified/staged: the edit exists only in the working tree
//   untracked            never committed: no history anywhere
//   ignored              git-ignored: data, builds, .Rdata ... not in history either
//   unpushed             committed, but on no remote branch: exists only on this machine
//   pushed and clean     recoverable (git restore, or clone) -- "as of your last fetch"
//   not in a repository  no history, no remote: gone for good
// and, for a repository that is deleted whole (its .git goes too): the local-only commits,
// stashes and uncommitted work that go with it.
//
// Contract: never throws, never says "safe" when a probe failed. A failed probe yields level
// 'unknown' with a note, and the command is held anyway (the caller already holds it).
import type { Group, Run } from './measure'

export const PUSHED_NOTE = 'Pushed means as of your last fetch'
export type RiskLevel = 'high' | 'medium' | 'low' | 'unknown'
export type Risk = { level: RiskLevel; headline: string }
export type Assessment = { risk: Risk; groups: Group[]; notes: string[] }

type Cfg = { maxListed: number }
type Tally = { changed: string[]; untracked: string[]; ignored: string[]; unpushed: string[]; trackedClean: number }

export const GIT = ['git', '--no-optional-locks', '--no-pager', '--literal-pathspecs']
const lines = (s: string) => s.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l !== '')
const n = (k: number) => k.toLocaleString('en-US')
const plural = (k: number, w: string, many = w + 's') => `${n(k)} ${k === 1 ? w : many}`
const dirname = (p: string) => (p.lastIndexOf('/') > 0 ? p.slice(0, p.lastIndexOf('/')) : '/')
const inside = (child: string, parent: string) => child === parent || child.startsWith(parent === '/' ? '/' : parent + '/')
const chunks = <T>(a: T[], size: number) => Array.from({ length: Math.ceil(a.length / size) }, (_, k) => a.slice(k * size, (k + 1) * size))
const cap = (title: string, rows: string[], max: number, flags: { subset?: boolean; extra?: boolean } = {}): Group => ({ title, rows: rows.slice(0, max), more: Math.max(0, rows.length - max), ...flags })

const LABELS: Record<string, string> = { ' M': 'modified', 'M ': 'staged', MM: 'staged+modified', 'A ': 'new (staged)', AM: 'new+modified', ' T': 'type changed', 'R ': 'renamed (staged)', UU: 'CONFLICT' }
const label = (xy: string) => LABELS[xy] ?? `changed (${xy.trim() || xy})`

/** `git status --porcelain=v1 -z` as raw entries: the two status letters and the path (repository-root relative). */
export function statusEntries(out: string): { xy: string; path: string }[] {
  const res: { xy: string; path: string }[] = []
  const toks = out.split('\0')
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!
    if (t.length < 4) continue
    const xy = t.slice(0, 2)
    if (xy[0] === 'R' || xy[0] === 'C') i++ // the next token is the rename's original path
    res.push({ xy, path: t.slice(3) })
  }
  return res
}

/** `git status --porcelain=v1 -z` into change classes. Paths are relative to the repository root. */
export function parseStatusZ(out: string): { changed: string[]; untracked: string[]; ignored: string[] } {
  const res = { changed: [] as string[], untracked: [] as string[], ignored: [] as string[] }
  for (const { xy, path } of statusEntries(out)) {
    if (xy === '??') res.untracked.push(path)
    else if (xy === '!!') res.ignored.push(path)
    else if (xy[1] === 'D' && xy[0] === ' ') continue // already gone from the working tree
    else if (xy[0] === 'D' && xy[1] === ' ') continue // staged removal, nothing left to lose
    else res.changed.push(`${label(xy)}  ${path}`)
  }
  return res
}

async function git(run: Run, cwd: string, ...argv: string[]) {
  return run([...GIT, ...argv], cwd)
}

async function dirsAmong(run: Run, paths: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (const part of chunks(paths, 60))
    for (const l of lines((await run(['find', ...part, '-maxdepth', '0', '-type', 'd', '-print'])).stdout)) found.add(l)
  return found
}

async function countFiles(run: Run, dir: string): Promise<number> {
  const res = await run(['find', dir, '!', '-type', 'd', '-print'])
  return lines(res.stdout).length
}

/** Repositories wholly inside a deleted directory (their .git goes too). */
async function nestedRepos(run: Run, dirs: string[]): Promise<string[]> {
  const roots = new Set<string>()
  for (const d of dirs.slice(0, 20)) {
    const res = await run(['find', d, '-maxdepth', '6', '-name', '.git', '-prune', '-print'])
    for (const l of lines(res.stdout)) if (l.endsWith('/.git')) roots.add(l.slice(0, -5))
  }
  return [...roots].slice(0, 20)
}

export async function assessLoss(run: Run, paths: string[], cfg: Cfg): Promise<Assessment> {
  const out: Assessment = { risk: { level: 'unknown', headline: '' }, groups: [], notes: [] }
  try {
    return await assess(run, [...new Set(paths)].slice(0, 500), cfg)
  } catch (err) {
    out.risk.headline = 'could not check what git could restore: assume nothing is recoverable'
    out.notes.push(`risk check failed: ${(err as Error).message || 'probe failed'}`)
    return out
  }
}

async function assess(run: Run, paths: string[], cfg: Cfg): Promise<Assessment> {
  const notes: string[] = []
  const dirs = await dirsAmong(run, paths)
  const dirList = [...dirs]

  // 1. which repository (if any) holds each path; repos that are deleted whole count as scopes of their own
  const scopes = new Map<string, string[]>() // repo root -> paths inside it
  const outside: string[] = []
  const rootOf = new Map<string, string | null>()
  for (const p of paths) {
    const probe = dirs.has(p) ? p : dirname(p)
    if (!rootOf.has(probe)) {
      const res = await git(run, probe, 'rev-parse', '--show-toplevel')
      rootOf.set(probe, res.exitCode === 0 ? res.stdout.trim() : null)
    }
    const root = rootOf.get(probe)
    if (root) scopes.set(root, [...(scopes.get(root) ?? []), p])
    else outside.push(p)
  }
  const whole = new Set<string>()
  for (const root of scopes.keys()) if (dirs.has(root) && paths.includes(root)) whole.add(root)
  for (const r of await nestedRepos(run, dirList)) {
    whole.add(r)
    if (!scopes.has(r)) scopes.set(r, [r])
  }

  // 2. per repository: uncommitted, untracked, ignored, unpushed
  const total: Tally = { changed: [], untracked: [], ignored: [], unpushed: [], trackedClean: 0 }
  const wholeFacts: string[] = []
  let wholeAtStake = 0
  let noRemote = false
  for (const [root, inRepo] of scopes) {
    const remotes = lines((await git(run, root, 'remote')).stdout)
    const t = await tally(run, root, inRepo, cfg, notes, remotes.length > 0)
    total.changed.push(...t.changed)
    total.untracked.push(...t.untracked)
    total.ignored.push(...t.ignored)
    total.unpushed.push(...t.unpushed)
    total.trackedClean += t.trackedClean
    if (remotes.length === 0) noRemote = true
    if (whole.has(root)) {
      const fact = await wholeRepoFact(run, root, remotes.length === 0)
      wholeFacts.push(fact.text)
      if (fact.atStake) wholeAtStake++
    }
  }

  // 3. words
  const groups: Group[] = []
  const max = cfg.maxListed
  if (wholeFacts.length) groups.push(cap('Whole repositories inside (their history goes too)', wholeFacts, max, { extra: true }))
  if (total.changed.length) groups.push(cap('Uncommitted changes (gone for good)', total.changed, max))
  if (total.untracked.length) groups.push(cap('Untracked, never committed (gone for good)', total.untracked, max, { subset: true }))
  if (total.ignored.length) groups.push(cap('Git-ignored (gone unless you can regenerate them)', total.ignored, max, { subset: true }))
  if (total.unpushed.length)
    groups.push(cap('Committed, not pushed (only in this .git)', total.unpushed, max))
  if (outside.length) groups.push(cap('Outside git, no history or remote (gone for good)', outside, max, { subset: true }))

  const lostForever = total.changed.length + total.untracked.length + total.ignored.length + outside.length
  const bits: string[] = []
  if (total.changed.length) bits.push(`${plural(total.changed.length, 'file')} with uncommitted changes`)
  if (total.untracked.length) bits.push(`${plural(total.untracked.length, 'untracked path')}`)
  if (total.ignored.length) bits.push(`${plural(total.ignored.length, 'git-ignored path')}`)
  if (outside.length) bits.push(`${plural(outside.length, 'path')} outside any repository`)
  if (total.unpushed.length) bits.push(`${plural(total.unpushed.length, 'unpushed commit')} touching these paths`)
  if (wholeFacts.length) bits.push(`${plural(wholeFacts.length, 'whole repository', 'whole repositories')}`)

  let risk: Risk
  // a repository deleted whole is only a hard loss when something exists nowhere else: commits on no remote, stashes,
  // linked worktrees, or no remote at all. A clean, fully pushed one comes back with a fresh clone.
  const hardLoss = total.changed.length + total.untracked.length + outside.length + total.unpushed.length + wholeAtStake
  if (hardLoss > 0) risk = { level: 'high', headline: `${bits.join(', ')}: none of it is on a remote` }
  else if (total.ignored.length > 0) risk = { level: 'medium', headline: `${bits.join(', ')}: not in version control` }
  else if (scopes.size > 0)
    risk = {
      level: 'low',
      headline: noRemote
        ? `${plural(total.trackedClean, 'tracked file')} committed locally (no remote): git restore works while .git stays`
        : `${plural(total.trackedClean, 'tracked file')} pushed (as of your last fetch): git restore or a fresh clone brings them back${wholeFacts.length ? ', no local-only commits or stashes' : ''}`,
    }
  else risk = { level: 'unknown', headline: 'nothing to assess' }

  if (noRemote && scopes.size > 0) notes.push('No remote: every commit exists only on this machine')
  if (lostForever === 0 && total.unpushed.length === 0 && wholeFacts.length === 0) notes.push(PUSHED_NOTE)
  return { risk, groups, notes }
}

async function tally(run: Run, root: string, inRepo: string[], cfg: Cfg, notes: string[], hasRemote: boolean): Promise<Tally> {
  const t: Tally = { changed: [], untracked: [], ignored: [], unpushed: [], trackedClean: 0 }
  const specs = inRepo.slice(0, 200)
  const st = await git(run, root, 'status', '--porcelain=v1', '-z', '--ignored', '--', ...specs)
  if (st.exitCode !== 0) throw new Error(`git status failed in ${root}: ${st.stderr.trim().split('\n')[0] || `exit ${st.exitCode}`}`)
  if (st.isStdoutTruncated) notes.push(`${root}: git status output was truncated, counts are lower bounds`)
  const parsed = parseStatusZ(st.stdout)
  t.changed = parsed.changed
  // a collapsed directory ("build/") stands for many files: say how many
  const expand = async (entries: string[]) => {
    const rows: string[] = []
    let looked = 0
    for (const e of entries) {
      if (e.endsWith('/') && looked < 10) {
        looked++
        const count = await countFiles(run, `${root}/${e.replace(/\/$/, '')}`)
        rows.push(`${e}  (${plural(count, 'file')})`)
      } else rows.push(e)
    }
    return rows
  }
  t.untracked = await expand(parsed.untracked)
  t.ignored = await expand(parsed.ignored)

  const ls = await git(run, root, 'ls-files', '-z', '--', ...specs)
  const tracked = ls.stdout.split('\0').filter(Boolean).length
  t.trackedClean = Math.max(0, tracked - parsed.changed.length)

  // without any remote every commit is "unpushed": that says nothing about these paths, so it is a note instead
  if (hasRemote) {
    const unpushed = await git(run, root, 'log', '--format=%h %s', '-n', String(cfg.maxListed + 1), 'HEAD', '--not', '--remotes', '--', ...specs)
    if (unpushed.exitCode === 0) t.unpushed = lines(unpushed.stdout)
  }
  // an empty repository (no HEAD yet) makes `git log HEAD` fail: that is not an error worth stopping for
  return t
}

/** What a whole repository would take with it. `atStake` is true when any of it exists nowhere else. */
export async function wholeRepoFact(run: Run, root: string, noRemote: boolean): Promise<{ text: string; atStake: boolean }> {
  const local = await git(run, root, 'rev-list', '--count', '--branches', '--tags', '--not', '--remotes')
  const stash = await git(run, root, 'stash', 'list')
  const wt = await git(run, root, 'worktree', 'list')
  const localCommits = local.exitCode === 0 ? Number(local.stdout.trim()) || 0 : undefined
  const stashes = lines(stash.stdout).length
  const worktrees = lines(wt.stdout).length - 1
  const bits = [
    localCommits !== undefined ? `${plural(localCommits, 'commit')} on no remote` : 'local-only commits unknown',
    `${plural(stashes, 'stash', 'stashes')}`,
  ]
  if (worktrees > 0) bits.push(`${plural(worktrees, 'linked worktree')}`)
  if (noRemote) bits.push('no remote')
  return {
    text: `${root}/  ${bits.join(', ')}`,
    atStake: localCommits === undefined || localCommits > 0 || stashes > 0 || worktrees > 0 || noRemote,
  }
}
