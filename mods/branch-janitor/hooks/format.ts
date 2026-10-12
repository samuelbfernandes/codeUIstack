// Every sentence the person reads: the confirmation dialog, toasts, and the branch-janitor report.
// Calm and short: a one-line headline, then a few plain lines. Quiet symbols (✓ ✗ · →), no banners, and
// nothing relies on colour.
import type { Verdict } from './decide'
import { restoreCommand } from './remove'
import { prSection } from './prs'
import type { ScanResult } from './scan'

export const UNDO_OFF = 'Turn it on again: /branch-janitor on'
export const LOCAL_ONLY = 'Local branches only. Remote copies are asked separately.'

const branches = (n: number) => `${n} branch${n === 1 ? '' : 'es'}`
const finished = (n: number) => `${n} finished branch${n === 1 ? '' : 'es'}`
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** One branch: what proves it is done, what keeps it safe, how to get it back. Only an offered branch gets here. */
function branchBlock(v: Verdict): string {
  const proof = v.evidence.find(e => e.kind !== 'gone')
  const failed = v.checks.filter(c => !c.ok)
  return [
    v.name,
    ...(proof ? [`✓ ${upper(proof.text)}`] : []),
    ...failed.map(c => `✗ ${upper(c.detail)}`),
    ...(failed.length === 0 ? ['✓ Nothing unpushed · no stash'] : []),
    `→ Restore: ${restoreCommand(v.name, v.sha)}`,
    ...(v.deleteFlag === '-D' ? ["· Uses git branch -D, because git can't see squash merges"] : []),
  ].join('\n')
}

export function dialogText(offers: Verdict[], hiddenCount: number): string {
  const more = hiddenCount > 0 ? [`${hiddenCount} more next time.`] : []
  return [`Delete ${finished(offers.length)}?`, '', offers.map(branchBlock).join('\n\n'), '', ...more, LOCAL_ONLY].join('\n')
}

export function singleDialogText(v: Verdict): string {
  return [`Delete ${v.name}?`, '', branchBlock(v).split('\n').slice(1).join('\n')].join('\n')
}

export function remoteDialogText(remote: string, branch: string, tip: string): string {
  return [`Also delete ${remote}/${branch}?`, `✓ Server copy (${tip.slice(0, 12)}) holds nothing that is not merged or just deleted.`].join('\n')
}

export function neverAskText(): string {
  return ['Branches · off for this repository', UNDO_OFF].join('\n')
}

export function toastText(deleted: { v: Verdict; flag: string }[], failed: { name: string; why: string }[], remoteDone: string[]): string {
  const out: string[] = []
  if (deleted.length > 0) {
    out.push(`Deleted ${branches(deleted.length)} · restore with:`)
    for (const d of deleted) out.push(restoreCommand(d.v.name, d.v.sha))
  }
  for (const r of remoteDone) out.push(`✓ Deleted ${r} on the server`)
  for (const f of failed) out.push(`✗ ${f.name}: ${f.why}`)
  return out.join('\n')
}

// ---------------------------------------------------------------- the report

const symbol: Record<Verdict['status'], string> = { offer: '✓', keep: '·', maybe: '·', excluded: '·' }
const MAX_SKIPPED = 8

export function reportText(r: ScanResult, o: { isOff: boolean; staleDays: number }): string {
  const shown = r.verdicts.filter(v => v.status !== 'excluded')
  const offers = shown.filter(v => v.status === 'offer').length
  const keeps = shown.length - offers
  const parts = [offers > 0 ? `${offers} ready to delete` : 'nothing to delete', ...(keeps > 0 ? [`${keeps} to keep`] : [])]
  const out: string[] = [`Branches · ${parts.join(', ')}`]
  if (o.isOff) out.push(`Off for this repository. ${UNDO_OFF}`)
  for (const n of r.notes) out.push(n)
  for (const v of shown) out.push(`${symbol[v.status]} ${v.name} · ${v.reason}`)
  out.push(...prSection(r.openPrs ?? [], r.verdicts.map(v => v.name)))
  const skipped = r.verdicts.filter(v => v.status === 'excluded')
  if (skipped.length > 0) {
    const list = skipped.slice(0, MAX_SKIPPED).map(v => `${v.name} (${v.reason})`)
    const rest = skipped.length - list.length
    out.push(`Skipped: ${list.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`)
  }
  if (r.capped > 0) out.push(`Checked the ${shown.length} oldest; ${r.capped} more not checked.`)
  if (r.stale.length > 0) {
    out.push(`Quiet for over ${o.staleDays} days, never offered:`)
    for (const s of r.stale) out.push(`· ${s.name} · last commit ${s.days} days ago`)
  }
  if (r.defaultName) out.push(`Compared with ${r.bases.map(b => b.replace(/^refs\/(heads|remotes)\//, '')).join(', ') || r.defaultName}`)
  return out.join('\n')
}
