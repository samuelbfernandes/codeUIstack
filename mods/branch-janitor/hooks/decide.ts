// The decision table, as pure functions of facts already gathered by scan.ts: for one local
// branch, what proves its work is done (evidence), which safety checks hold, and therefore whether
// it may be OFFERED for deletion. A branch with no strong evidence is never offered, and any
// failing check removes an otherwise finished branch from the offer.
import type { BranchRef, MergedPr } from './git'

export type EvidenceKind = 'merged' | 'patch' | 'content' | 'pr' | 'gone'
export type Evidence = { kind: EvidenceKind; text: string }
export type Check = { id: 'a' | 'b' | 'c' | 'd' | 'e'; label: string; ok: boolean; detail: string }
/** offer: finished and safe. keep: not offered (reason says why). maybe: remote gone, unproven. excluded: never considered. */
export type Status = 'offer' | 'keep' | 'maybe' | 'excluded'

export type Facts = {
  ref: BranchRef
  /** Why this branch is never considered (current, default, protected, worktree, unsafe name). */
  exclusion?: string
  /** The base (`main` or `origin/main`) the tip is an ancestor of. */
  mergedInto?: string
  /** `git cherry` against the best base: how many commits have / lack a patch-equivalent there. */
  cherry?: { base: string; plus: number; minus: number }
  /** Base on which every file the branch changed already has the branch's content. */
  contentBase?: string
  pr?: MergedPr
  hasStash: boolean
  /** The branch has never moved since it was created (see parseJustCreated): "merged" only because it starts at the base. */
  justCreated?: boolean
}

export type Context = { defaultName: string }

export type Verdict = {
  name: string
  sha: string
  ref: BranchRef
  status: Status
  evidence: Evidence[]
  checks: Check[]
  /** One plain sentence: why it is offered, or why it is not. */
  reason: string
  /** `-d` is git's own safe delete; `-D` only where git cannot see the merge (squash / rebase / PR). */
  deleteFlag: '-d' | '-D'
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function evidenceOf(f: Facts, ctx: Context): Evidence[] {
  const out: Evidence[] = []
  if (f.mergedInto) out.push({ kind: 'merged', text: `merged into ${f.mergedInto}` })
  else if (f.cherry && f.cherry.plus === 0 && f.cherry.minus > 0)
    out.push({ kind: 'patch', text: `all ${plural(f.cherry.minus, 'commit')} already in ${f.cherry.base} (squash/rebase merge)` })
  if (!f.mergedInto && f.contentBase)
    out.push({ kind: 'content', text: `its files already match ${f.contentBase} (squash merge)` })
  if (f.pr && f.pr.baseRefName === ctx.defaultName) out.push({ kind: 'pr', text: `PR #${f.pr.number} merged into ${ctx.defaultName}` })
  if (f.ref.isGone) out.push({ kind: 'gone', text: 'its remote branch was deleted' })
  return out
}

/** Check b: nothing on the branch is missing from the default branch. */
function checkUnique(f: Facts, ev: Evidence[]): Check {
  const label = 'No commits that exist only on this branch'
  const has = (k: EvidenceKind) => ev.some(e => e.kind === k)
  const prAtTip = f.pr !== undefined && f.pr.headRefOid !== '' && f.pr.headRefOid === f.ref.sha && has('pr')
  if (has('merged')) return { id: 'b', label, ok: true, detail: 'every commit is already inside the default branch' }
  if (has('patch')) return { id: 'b', label, ok: true, detail: 'every commit has an identical change in the default branch' }
  if (has('content')) return { id: 'b', label, ok: true, detail: 'every changed file already has this content in the default branch' }
  if (prAtTip) return { id: 'b', label, ok: true, detail: `the merged PR #${f.pr!.number} ended at exactly this commit` }
  if (f.cherry && f.cherry.plus > 0)
    return { id: 'b', label, ok: false, detail: `${plural(f.cherry.plus, 'commit')} not found in ${f.cherry.base}${has('pr') ? ' (added after the PR merged?)' : ''}` }
  if (has('pr')) return { id: 'b', label, ok: false, detail: `commits added after PR #${f.pr!.number} merged` }
  return { id: 'b', label, ok: false, detail: "couldn't compare it with the default branch" }
}

function checkPushed(f: Facts, unique: Check): Check {
  const label = 'Nothing waiting to be pushed'
  if (f.ref.upstream === '') return { id: 'c', label, ok: true, detail: 'never pushed, no remote copy to lose' }
  if (f.ref.isGone)
    return unique.ok
      ? { id: 'c', label, ok: true, detail: 'remote copy is already gone and nothing is unique to this branch' }
      : { id: 'c', label, ok: false, detail: 'remote copy is gone and some commits are not in the default branch' }
  if (f.ref.ahead > 0) return { id: 'c', label, ok: false, detail: `${plural(f.ref.ahead, 'commit')} not pushed to ${f.ref.upstream.replace('refs/remotes/', '')}` }
  return { id: 'c', label, ok: true, detail: 'everything is on the remote' }
}

export function decide(f: Facts, ctx: Context): Verdict {
  const base = { name: f.ref.name, sha: f.ref.sha, ref: f.ref }
  if (f.exclusion) return { ...base, status: 'excluded', evidence: [], checks: [], reason: f.exclusion, deleteFlag: '-d' }

  const evidence = evidenceOf(f, ctx)
  const strong = evidence.filter(e => e.kind !== 'gone')
  const unique = checkUnique(f, evidence)
  const checks: Check[] = [
    { id: 'a', label: 'Not checked out anywhere', ok: true, detail: 'not the current branch, not open in another worktree' },
    unique,
    checkPushed(f, unique),
    f.hasStash
      ? { id: 'd', label: 'No stash saved on this branch', ok: false, detail: 'a stash was saved on it' }
      : { id: 'd', label: 'No stash saved on this branch', ok: true, detail: 'no stash entries' },
    /^[0-9a-f]{40,64}$/.test(f.ref.sha)
      ? { id: 'e', label: 'Tip recorded so it can be restored', ok: true, detail: `git branch ${f.ref.name} ${f.ref.sha}` }
      : { id: 'e', label: 'Tip recorded so it can be restored', ok: false, detail: 'could not read the branch tip' },
  ]
  const deleteFlag = evidence.some(e => e.kind === 'merged') ? '-d' : '-D'

  if (strong.length === 0) {
    if (f.ref.isGone)
      return { ...base, status: 'maybe', evidence, checks, deleteFlag, reason: 'remote branch is gone, but no merge found: check before deleting' }
    return { ...base, status: 'keep', evidence, checks, deleteFlag, reason: 'not merged yet' }
  }
  if (f.justCreated)
    return { ...base, status: 'keep', evidence, checks, deleteFlag, reason: 'just created, no commits yet' }
  const failed = checks.filter(c => !c.ok)
  if (failed.length > 0)
    return { ...base, status: 'keep', evidence, checks, deleteFlag, reason: `${strong[0]!.text}, but ${failed.map(c => c.detail).join('; ')}` }
  return { ...base, status: 'offer', evidence, checks, deleteFlag, reason: strong[0]!.text }
}
