// Open pull requests, read-only: ONE `gh pr list` (argv array, 8 s timeout) answers for every local branch.
// Used for the plain-word report and to keep a branch with an open PR out of the "finished" offers.
// Fails soft everywhere: no gh, not signed in, no network, odd output -> undefined, and the caller says nothing.
import type { Verdict } from './decide'
import type { Run } from './git'

const GH_TIMEOUT_MS = 8_000
const MAX_LINES = 8

export type Checks = 'passing' | 'failing' | 'pending' | 'none'
export type Review = 'approved' | 'changes requested' | 'none'
export type OpenPr = { number: number; branch: string; checks: Checks; review: Review }

/** The documented `gh pr list --json` fields used here (all exist in gh's JSON field list). */
export const PR_FIELDS = 'number,headRefName,statusCheckRollup,reviewDecision,state'

/**
 * statusCheckRollup is a list of two kinds of entry: a CheckRun (status + conclusion) or a StatusContext (state).
 * Any failure wins, then anything unfinished or unknown; an empty list means no checks are configured.
 */
export function checksOf(rollup: unknown): Checks {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none'
  let pending = false
  for (const item of rollup as Record<string, unknown>[]) {
    const word = String(item?.conclusion || item?.state || item?.status || '').toUpperCase()
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].includes(word)) return 'failing'
    if (!['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(word)) pending = true // QUEUED, IN_PROGRESS, PENDING, EXPECTED, unknown
  }
  return pending ? 'pending' : 'passing'
}

export function reviewOf(decision: unknown): Review {
  return decision === 'APPROVED' ? 'approved' : decision === 'CHANGES_REQUESTED' ? 'changes requested' : 'none'
}

/** `gh pr list --json ...` output into open PRs by branch name (the highest number wins); anything unexpected is none. */
export function parseOpenPrs(out: string): OpenPr[] {
  let rows: unknown
  try {
    rows = JSON.parse(out)
  } catch {
    return []
  }
  if (!Array.isArray(rows)) return []
  const byBranch = new Map<string, OpenPr>()
  for (const row of rows as Record<string, unknown>[]) {
    if (typeof row?.number !== 'number' || typeof row.headRefName !== 'string' || row.headRefName === '') continue
    if (row.state !== undefined && row.state !== 'OPEN') continue
    const known = byBranch.get(row.headRefName)
    if (known && known.number > row.number) continue
    byBranch.set(row.headRefName, { number: row.number, branch: row.headRefName, checks: checksOf(row.statusCheckRollup), review: reviewOf(row.reviewDecision) })
  }
  return [...byBranch.values()]
}

/** Open PRs of the repository at `root`, or undefined when gh could not answer (never throws). */
export async function fetchOpenPrs(run: Run, root: string): Promise<OpenPr[] | undefined> {
  try {
    const r = await run(['gh', 'pr', 'list', '--state', 'open', '--limit', '100', '--json', PR_FIELDS], { cwd: root, timeoutMs: GH_TIMEOUT_MS })
    return r.exitCode === 0 ? parseOpenPrs(r.stdout) : undefined
  } catch {
    return undefined
  }
}

/** '#42 open · checks passing · review approved' */
export const prLine = (p: OpenPr): string => `#${p.number} open · checks ${p.checks} · review ${p.review}`

/** A branch with an open PR is not finished: an offer becomes a keep that says why. Other verdicts stay as they are. */
export function protectOpen(verdicts: Verdict[], prs: OpenPr[]): Verdict[] {
  const open = new Map(prs.map(p => [p.branch, p]))
  return verdicts.map(v => {
    const pr = open.get(v.name)
    return pr && v.status === 'offer' ? { ...v, status: 'keep', reason: `#${pr.number} still open` } : v
  })
}

/** The report section: one line per local branch that has an open PR (only branches that exist locally). */
export function prSection(prs: OpenPr[], localBranches: string[]): string[] {
  const local = new Set(localBranches)
  const mine = prs.filter(p => local.has(p.branch)).sort((a, b) => a.number - b.number)
  if (mine.length === 0) return []
  const shown = mine.slice(0, MAX_LINES).map(p => `${prLine(p)} · ${p.branch}`)
  const rest = mine.length - shown.length
  return ['Open pull requests', ...shown, ...(rest > 0 ? [`and ${rest} more`] : [])]
}
