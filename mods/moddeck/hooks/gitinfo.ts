// Git state for the Session box: pure parsers of `git status --porcelain=v2 --branch` and `rev-parse` output. No engine access.

export type GitInfo = {
  /** The branch, or the short commit while detached. */
  branch: string
  isDetached: boolean
  /** Commits ahead of / behind the upstream; 0 without one. */
  ahead: number
  behind: number
  hasUpstream: boolean
  modified: number
  added: number
  deleted: number
  untracked: number
  conflicts: number
  /** The name of the linked worktree this is, when it is one. */
  worktree?: string
}

export const isDirty = (g: GitInfo): boolean => g.modified + g.added + g.deleted + g.untracked + g.conflicts > 0

/**
 * Reads `git status --porcelain=v2 --branch`. Each changed file counts once: deleted when either side is `D`, else added when
 * the index added it (`A`), else modified (any other change, a rename or a type change included). `u` rows are conflicts
 * (also counted as modified), `?` rows untracked; ignored rows (`!`) are left out. Undefined when it holds no branch header.
 */
export function parseStatusV2(text: string): GitInfo | undefined {
  let head: string | undefined
  let oid = ''
  let ahead = 0
  let behind = 0
  let hasUpstream = false
  const g = { modified: 0, added: 0, deleted: 0, untracked: 0, conflicts: 0 }
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice(14).trim()
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim()
    else if (line.startsWith('# branch.upstream ')) hasUpstream = true
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4)
      const [x, y] = [xy[0] ?? '.', xy[1] ?? '.']
      if (x === 'D' || y === 'D') g.deleted++
      else if (x === 'A') g.added++
      else if (x !== '.' || y !== '.') g.modified++
    } else if (line.startsWith('u ')) {
      g.conflicts++
      g.modified++
    } else if (line.startsWith('? ')) g.untracked++
  }
  if (head === undefined) return undefined
  const isDetached = head === '(detached)'
  const branch = isDetached ? (oid && oid !== '(initial)' ? oid.slice(0, 7) : 'detached') : head
  return { branch, isDetached, ahead, behind, hasUpstream, ...g }
}

/**
 * The linked worktree's name from `git rev-parse --git-dir` and `--git-common-dir` (two lines, in that order): the two differ
 * in a linked worktree, whose git dir is `<common>/worktrees/<name>`. Undefined in the main checkout or when unreadable.
 */
export function linkedWorktree(revParse: string): string | undefined {
  const [gitDir, commonDir] = revParse.split('\n').map(s => s.trim().replace(/\/+$/, ''))
  if (!gitDir || !commonDir || gitDir === commonDir) return undefined
  const m = /\/worktrees\/([^/]+)$/.exec(gitDir)
  return m ? m[1] : undefined
}
