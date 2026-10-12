// Works out what the git pre-push hook WOULD review, using read-only `git` calls only
// (argv arrays through $.process.run: no shell, no Node fs, nothing but git is spawned).
import { parseUsage } from './estimate'
import type { Reviewer, Usage } from './estimate'

export type RunResult = { exitCode: number; stdout: string }
export type Run = (argv: readonly string[], cwd?: string) => Promise<RunResult>

/** Well-known id of git's empty tree: the base of a branch with nothing to compare to. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbd2d4f'
export const DEFAULT_PATHS = 'R src'
export const DEFAULT_MAX_BYTES = 120_000
export const THEORY_FILE = 'docs/THEORY_REVIEW.md'

// Diff size ESTIMATE: a unified diff costs about 60 bytes per changed line (the line plus its
// share of context and hunk headers) and about 200 bytes per file (diff/index/---/+++ headers).
// A rough rule of thumb, not a measurement; binary files count as headers only.
export const BYTES_PER_CHANGED_LINE = 60
export const BYTES_PER_FILE = 200

export type FileStat = { path: string; added: number; removed: number }
export type Plan = {
  root: string
  reviewer: Reviewer
  files: FileStat[]
  diffBytes: number // estimated, after the cap
  capped: boolean
  maxBytes: number
  history: Usage[]
}
export type Planned = { plan: Plan } | { why: string }

const git = (run: Run, cwd: string | undefined, ...args: string[]) => run(['git', ...args], cwd)
const first = (r: RunResult) => r.stdout.split('\n')[0]!.replace(/\r$/, '').trim()

/** `git config --get-regexp ^toolkit\.theory` as key -> values (git lowercases key names; last value wins for single keys). */
export function parseSettings(stdout: string): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const sp = line.search(/\s/)
    const key = (sp < 0 ? line : line.slice(0, sp)).toLowerCase()
    if (!key.startsWith('toolkit.theory')) continue
    const list = m.get(key) ?? []
    list.push(sp < 0 ? '' : line.slice(sp).trim())
    m.set(key, list)
  }
  return m
}

/** `git diff --numstat` lines: "<added>\t<removed>\t<path>"; binary files show "-". */
export function parseNumstat(stdout: string): FileStat[] {
  const out: FileStat[] = []
  for (const raw of stdout.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+?)\r?$/.exec(raw)
    if (m) out.push({ path: m[3]!, added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]) })
  }
  return out
}

export const changedLines = (f: FileStat) => f.added + f.removed
export const diffBytesOf = (files: readonly FileStat[]) =>
  files.reduce((sum, f) => sum + changedLines(f) * BYTES_PER_CHANGED_LINE + BYTES_PER_FILE, 0)

/** Merge base of HEAD and the upstream, else of HEAD and the default branch, else the empty tree. */
async function baseOf(run: Run, root: string): Promise<string> {
  const upstream = await git(run, root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
  const candidates: string[] = upstream.exitCode === 0 && first(upstream) ? [first(upstream)] : []
  if (candidates.length === 0) {
    const head = await git(run, root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
    if (head.exitCode === 0 && first(head)) candidates.push(first(head))
    candidates.push('origin/main', 'origin/master', 'main', 'master')
  }
  for (const ref of candidates) {
    const base = await git(run, root, 'merge-base', 'HEAD', ref)
    if (base.exitCode === 0 && first(base)) return first(base)
  }
  return EMPTY_TREE
}

/** Decides whether a review would run for this directory and, if so, what it would read. */
export async function planReview(run: Run, dir: string | undefined): Promise<Planned> {
  const top = await git(run, dir, 'rev-parse', '--show-toplevel')
  if (top.exitCode !== 0 || !first(top)) return { why: 'not a git repository' }
  const root = first(top)

  const cfg = parseSettings((await git(run, root, 'config', '--get-regexp', '^toolkit\\.theory')).stdout)
  const one = (key: string) => (cfg.get(key) ?? []).at(-1)?.trim() ?? ''
  if (one('toolkit.theoryreview').toLowerCase() === 'false') return { why: 'toolkit.theoryReview is false' }

  const configured = one('toolkit.theorypaths')
  if (configured === '') {
    const listed = await git(run, root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', THEORY_FILE)
    if (listed.exitCode !== 0 || listed.stdout.trim() === '') return { why: 'no docs/THEORY_REVIEW.md and no toolkit.theoryPaths' }
  }

  if ((await git(run, root, 'rev-parse', '--verify', '--quiet', 'HEAD')).exitCode !== 0) return { why: 'no commits yet' }
  const base = await baseOf(run, root)
  const paths = (configured || DEFAULT_PATHS).split(/\s+/).filter(Boolean)
  const diff = await git(run, root, 'diff', '--numstat', '--no-renames', base, 'HEAD', '--', ...paths)
  if (diff.exitCode !== 0) return { why: 'could not diff against the base' }
  const files = parseNumstat(diff.stdout)
  if (files.length === 0) return { why: 'nothing to review in the theory paths' }

  const limit = Number(one('toolkit.theorymaxbytes'))
  const maxBytes = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_MAX_BYTES
  const total = diffBytesOf(files)
  return {
    plan: {
      root,
      reviewer: one('toolkit.theoryreviewer').toLowerCase() === 'claude' ? 'claude' : 'codex',
      files,
      diffBytes: Math.min(total, maxBytes),
      capped: total > maxBytes,
      maxBytes,
      history: parseUsage(cfg.get('toolkit.theoryusage') ?? []),
    },
  }
}

/** Records the decision for the pre-push hook: `<review|skip>:<epochSeconds>`, in the repo's local config. */
export async function writeDecision(run: Run, root: string, choice: 'review' | 'skip', epochSeconds: number): Promise<boolean> {
  const r = await git(run, root, 'config', '--local', 'toolkit.theoryDecision', `${choice}:${epochSeconds}`)
  return r.exitCode === 0
}
