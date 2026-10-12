// The scan: every probe is a read-only git call (plus an optional gh query), O(branches), no model
// calls and no network except gh. It gathers Facts for each local branch and hands them to decide().
import { decide } from './decide'
import type { Facts, Verdict } from './decide'
import {
  BRANCH_FORMAT, gitIn, isSafeName, lines, matchesPattern, parseBranchRefs, parseCherry, parseJustCreated, parseMergedPr,
  parseRemoteTips, parseStashBranches, parseWorktrees,
} from './git'
import type { BranchRef, Git, MergedPr, Run } from './git'
import type { OpenPr } from './prs'

export const MAX_BRANCHES = 60
const MAX_GH_QUERIES = 10
const GH_TIMEOUT_MS = 8_000
const CONTENT_MAX_PATHS = 400
const CONTENT_CHUNK = 50

export const DEFAULT_PROTECTED = ['main', 'master', 'develop', 'dev', 'trunk', 'release/*', 'gh-pages']

export type ScanConfig = { protectedBranches: string[]; staleDays: number }
/** none: git only. gone: ask gh about branches whose remote vanished. pushed: ask about every pushed, unproven branch. */
export type GhScope = 'none' | 'gone' | 'pushed'
/** Lets the caller keep `gh` from asking about the same branch tip twice (see janitor.ts). */
export type GhGate = { shouldAsk: (branch: string, sha: string) => boolean; asked: (branch: string, sha: string) => void }
export type ScanOptions = { ghScope: GhScope; hasGh: () => Promise<boolean>; now: number; ghGate?: GhGate }

export type ScanResult = {
  root: string
  /** The local default branch name (`main`), as origin/HEAD says or main/master/develop found locally. */
  defaultName: string
  /** The refs finished work is compared against (`refs/heads/main`, `refs/remotes/origin/main`), spelled short. */
  bases: string[]
  verdicts: Verdict[]
  /** Branches left unexamined because of the 60-branch cap. */
  capped: number
  /** Unmerged branches untouched for more than `staleDays` days (information only). */
  stale: { name: string; days: number }[]
  notes: string[]
  /** Open pull requests by local branch, set by janitor.ts when gh answered; absent = not asked or no answer. */
  openPrs?: OpenPr[]
}

/** The repository top level, or undefined outside a repository (or when git is missing). */
export async function repoRoot(run: Run, cwd: string | undefined): Promise<string | undefined> {
  const r = await gitIn(run, cwd)('rev-parse', '--show-toplevel')
  const root = lines(r.stdout)[0]
  return r.exitCode === 0 && root ? root : undefined
}

/** `git config --local toolkit.branchJanitor false` switches the mod off for one repository. */
export async function isDisabled(run: Run, cwd: string): Promise<boolean> {
  const r = await gitIn(run, cwd)('config', '--local', '--get', 'toolkit.branchJanitor')
  return r.exitCode === 0 && r.stdout.trim().toLowerCase() === 'false'
}

export async function scan(run: Run, root: string, cfg: ScanConfig, opts: ScanOptions): Promise<ScanResult | undefined> {
  const git = gitIn(run, root)
  const refsOut = await git('for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads')
  if (refsOut.exitCode !== 0) return undefined
  const refs = parseBranchRefs(refsOut.stdout)
  const remoteTips = parseRemoteTips((await git('for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/remotes')).stdout)
  const defaultName = await findDefaultName(git, refs)
  if (defaultName === undefined) {
    return { root, defaultName: '', bases: [], verdicts: [], capped: 0, stale: [], notes: ['No default branch found (main, master or develop), so nothing was compared.'] }
  }
  const bases = await chooseBases(git, refs, defaultName, remoteTips)
  const worktrees = parseWorktrees((await git('worktree', 'list', '--porcelain')).stdout)
  const stashed = parseStashBranches((await git('stash', 'list', '--format=%gs')).stdout)
  const checkedOut = new Map(worktrees.filter(w => w.branch).map(w => [w.branch!, w.path]))

  const excluded = (r: BranchRef): string | undefined => exclusionOf(r, defaultName, cfg.protectedBranches, checkedOut)
  const candidates = refs.filter(r => excluded(r) === undefined).sort((a, b) => a.lastCommit - b.lastCommit)
  const examined = candidates.slice(0, MAX_BRANCHES)
  const merged = await mergedSets(git, bases)

  const facts: Facts[] = []
  for (const ref of refs) {
    const exclusion = excluded(ref)
    const f: Facts = { ref, exclusion, hasStash: stashed.has(ref.name) }
    if (exclusion === undefined && examined.includes(ref)) await gatherEvidence(git, f, bases, merged)
    facts.push(f)
  }
  await askGh(run, root, facts, defaultName, opts)

  const verdicts = facts
    .filter(f => f.exclusion !== undefined || examined.includes(f.ref))
    .map(f => decide(f, { defaultName }))
  const hasProof = (v: Verdict) => v.evidence.some(e => e.kind !== 'gone')
  const stale = verdicts
    .filter(v => (v.status === 'keep' || v.status === 'maybe') && !hasProof(v))
    .map(v => ({ name: v.name, days: Math.floor((opts.now / 1000 - v.ref.lastCommit) / 86_400) }))
    .filter(s => s.days > cfg.staleDays)
  return { root, defaultName, bases, verdicts, capped: candidates.length - examined.length, stale, notes: [] }
}

function exclusionOf(r: BranchRef, defaultName: string, patterns: string[], checkedOut: Map<string, string>): string | undefined {
  if (!isSafeName(r.name)) return 'unusual name, never touched'
  if (r.isCurrent) return 'current branch'
  if (r.name === defaultName) return 'default branch'
  const pattern = patterns.find(p => matchesPattern(r.name, p))
  if (pattern !== undefined) return `protected by ${pattern}`
  const tree = checkedOut.get(r.name)
  if (tree !== undefined) return `open in worktree ${tree}`
  return undefined
}

async function findDefaultName(git: Git, refs: BranchRef[]): Promise<string | undefined> {
  const head = await git('symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD')
  const ref = lines(head.stdout)[0]
  if (head.exitCode === 0 && ref?.startsWith('refs/remotes/origin/')) return ref.slice('refs/remotes/origin/'.length)
  return ['main', 'master', 'develop'].find(n => refs.some(r => r.name === n))
}

/**
 * What finished work is compared against. The local default branch can be stale (a PR merged on the
 * server, `git fetch` run, `git pull` not yet), so `origin/<default>` counts too; when one contains the
 * other only the newer is kept, so the usual case costs one comparison per branch.
 */
async function chooseBases(git: Git, refs: BranchRef[], name: string, remoteTips: Map<string, string>): Promise<string[]> {
  const local = refs.find(r => r.name === name)?.sha
  const remote = remoteTips.get(`origin/${name}`)
  const localRef = `refs/heads/${name}`
  const remoteRef = `refs/remotes/origin/${name}`
  if (local && remote && local !== remote) {
    if ((await git('merge-base', '--is-ancestor', localRef, remoteRef)).exitCode === 0) return [remoteRef]
    if ((await git('merge-base', '--is-ancestor', remoteRef, localRef)).exitCode === 0) return [localRef]
    return [localRef, remoteRef]
  }
  return local ? [localRef] : remote ? [remoteRef] : []
}

/** For each base, the set of local branches whose tip is an ancestor: one call per base. */
async function mergedSets(git: Git, bases: string[]): Promise<Map<string, Set<string>>> {
  const sets = new Map<string, Set<string>>()
  for (const base of bases) {
    const out = await git('for-each-ref', `--merged=${base}`, '--format=%(refname)', 'refs/heads')
    sets.set(base, new Set(lines(out.stdout).map(l => l.slice('refs/heads/'.length))))
  }
  return sets
}

const short = (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, '')

async function gatherEvidence(git: Git, f: Facts, bases: string[], merged: Map<string, Set<string>>): Promise<void> {
  const full = `refs/heads/${f.ref.name}`
  const hit = bases.find(b => merged.get(b)?.has(f.ref.name))
  if (hit) {
    f.mergedInto = short(hit)
    // Only an ancestor can be a branch that was never worked on, so only these pay for the reflog probe.
    f.justCreated = parseJustCreated((await git('reflog', 'show', '--format=%gs', '-n', '2', full)).stdout)
    return
  }
  for (const base of bases) {
    const r = await git('cherry', base, full)
    if (r.exitCode !== 0) continue
    const c = { base: short(base), ...parseCherry(r.stdout) }
    if (!f.cherry || c.plus < f.cherry.plus) f.cherry = c
    if (c.plus === 0) return
  }
  for (const base of bases) {
    if (await contentIsInBase(git, base, full)) {
      f.contentBase = short(base)
      return
    }
  }
}

/**
 * A squash merge of several commits has a patch that matches none of them, so `git cherry` still shows
 * '+'. The test that does hold: every file the branch changed (since it left the base) already has the
 * branch's exact content in the base. Read-only: `git diff --name-only` then `git diff --quiet` on those paths.
 */
async function contentIsInBase(git: Git, base: string, branch: string): Promise<boolean> {
  const mb = lines((await git('merge-base', base, branch)).stdout)[0]
  if (!mb) return false
  const names = await git('diff', '--name-only', '--no-renames', '-z', mb, branch)
  if (names.exitCode !== 0) return false
  const paths = names.stdout.split('\0').filter(p => p !== '')
  if (paths.length === 0 || paths.length > CONTENT_MAX_PATHS) return false
  for (let i = 0; i < paths.length; i += CONTENT_CHUNK) {
    const same = await git('diff', '--quiet', branch, base, '--', ...paths.slice(i, i + CONTENT_CHUNK))
    if (same.exitCode !== 0) return false
  }
  return true
}

/** Optional pull-request evidence: silent on any failure, at most 10 queries of 8 s each. */
async function askGh(run: Run, root: string, facts: Facts[], defaultName: string, opts: ScanOptions): Promise<void> {
  if (opts.ghScope === 'none') return
  const wanted = facts.filter(f => {
    if (f.exclusion !== undefined || f.mergedInto || f.contentBase) return false
    if (f.cherry && f.cherry.plus === 0 && f.cherry.minus > 0) return false
    if (opts.ghGate && !opts.ghGate.shouldAsk(f.ref.name, f.ref.sha)) return false
    return f.ref.isGone || (opts.ghScope === 'pushed' && f.ref.upstream !== '')
  }).slice(0, MAX_GH_QUERIES)
  if (wanted.length === 0 || !(await opts.hasGh())) return
  for (const f of wanted) {
    opts.ghGate?.asked(f.ref.name, f.ref.sha)
    const pr = await queryPr(run, root, f.ref.name)
    if (pr && pr.baseRefName === defaultName) f.pr = pr
  }
}

async function queryPr(run: Run, root: string, branch: string): Promise<MergedPr | undefined> {
  try {
    const r = await run(
      ['gh', 'pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number,mergedAt,baseRefName,headRefOid', '--limit', '1'],
      { cwd: root, timeoutMs: GH_TIMEOUT_MS },
    )
    return r.exitCode === 0 ? parseMergedPr(r.stdout) : undefined
  } catch {
    return undefined
  }
}
