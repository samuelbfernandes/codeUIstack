// The only code that changes anything, and it runs only after a confirmation click.
// Local: re-verify the branch has not moved, then `git branch -d` / `-D`. Remote: a separate step,
// only when the remote-tracking tip is exactly what we deleted (or already inside the default branch).
import type { Verdict } from './decide'
import { gitIn, isSafeName, lines } from './git'
import type { Run } from './git'

export type LocalResult = { ok: true; flag: '-d' | '-D'; note?: string } | { ok: false; why: string }

export const restoreCommand = (name: string, sha: string) => `git branch ${name} ${sha}`

export async function deleteLocal(run: Run, root: string, v: Verdict): Promise<LocalResult> {
  const git = gitIn(run, root)
  if (!isSafeName(v.name)) return { ok: false, why: 'unusual name, left alone' }
  // Re-check just before deleting: the branch may have moved or been checked out since the scan.
  const tip = lines((await git('rev-parse', '--verify', '--quiet', `refs/heads/${v.name}`)).stdout)[0]
  if (tip === undefined) return { ok: false, why: 'already gone' }
  if (tip !== v.sha) return { ok: false, why: 'new commits since the check, left alone' }
  const head = lines((await git('symbolic-ref', '--quiet', '--short', 'HEAD')).stdout)[0]
  if (head === v.name) return { ok: false, why: 'checked out now, left alone' }

  const first = await git('branch', v.deleteFlag, '--', v.name)
  if (first.exitCode === 0) return { ok: true, flag: v.deleteFlag }
  // `-d` judges "merged" against HEAD (or the upstream), not against the default branch we verified.
  // We proved the tip is inside the default branch, so the stronger delete is still safe, and the tip is recorded.
  const isMergeRefusal = /not fully merged/i.test(first.stderr)
  if (v.deleteFlag === '-d' && isMergeRefusal) {
    const retry = await git('branch', '-D', '--', v.name)
    if (retry.exitCode === 0) return { ok: true, flag: '-D', note: 'git checks "merged" against the branch you are on, not main; we had verified it against main' }
    return { ok: false, why: firstLine(retry.stderr) }
  }
  return { ok: false, why: firstLine(first.stderr) }
}

const firstLine = (s: string) => lines(s)[0] ?? 'git refused'

export type RemoteOffer = { remote: string; branch: string; tip: string }

/**
 * The remote copy to offer deleting, or undefined. Uses only local refs (no network): the remote-tracking
 * ref must exist, the upstream must not be `[gone]`, and its tip must equal the sha we deleted or already
 * be an ancestor of a base (the default branch).
 */
export async function remoteOffer(run: Run, root: string, v: Verdict, bases: string[]): Promise<RemoteOffer | undefined> {
  const git = gitIn(run, root)
  if (v.ref.isGone) return undefined
  const { remote, branch } = remoteTarget(v)
  if (remote === '' || !isSafeName(remote) || !isSafeName(branch)) return undefined
  const tip = lines((await git('rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${branch}^{commit}`)).stdout)[0]
  if (!tip) return undefined
  if (tip === v.sha) return { remote, branch, tip }
  for (const base of bases) {
    if ((await git('merge-base', '--is-ancestor', tip, base)).exitCode === 0) return { remote, branch, tip }
  }
  return undefined
}

/** Where the branch's remote copy lives: its upstream if it has one, else `origin/<same name>`. */
function remoteTarget(v: Verdict): { remote: string; branch: string } {
  const m = /^refs\/remotes\/([^/]+)\/(.+)$/.exec(v.ref.upstream)
  if (m) return { remote: m[1]!, branch: m[2]! }
  return v.ref.upstream === '' ? { remote: 'origin', branch: v.name } : { remote: '', branch: '' }
}

/** `git push <remote> --delete <branch>`, guarded by a lease on the tip we checked so a branch that moved is refused. */
export async function deleteRemote(run: Run, root: string, offer: RemoteOffer): Promise<{ ok: true } | { ok: false; why: string }> {
  const lease = `--force-with-lease=refs/heads/${offer.branch}:${offer.tip}`
  const r = await gitIn(run, root)('push', offer.remote, lease, '--delete', offer.branch)
  return r.exitCode === 0 ? { ok: true } : { ok: false, why: firstLine(r.stderr) }
}
