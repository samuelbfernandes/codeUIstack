// Pure helpers: turning a tool call's input into a stored edit, stepping,
// and the shell-command heuristic. No engine calls here.
import type { Change, Edit } from '../types'

export const MAX_EDITS = 200
/** Characters kept per stored edit (old and new text together). */
export const MAX_CHARS = 20_000
/** Largest file whose previous content a Write reads before overwriting it. */
export const MAX_PRIOR_BYTES = 200_000

/** What was found at a Write's path before the write. */
export type Prior = { created: boolean; text?: string }

export type NewEdit = Omit<Edit, 'id' | 'turn'>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Cuts `changes` to a character budget; says whether anything was lost. */
export function capChanges(changes: Change[], budget = MAX_CHARS): { changes: Change[]; truncated: boolean } {
  const kept: Change[] = []
  let left = budget
  let truncated = false
  for (const c of changes) {
    if (left <= 0) {
      truncated = true
      break
    }
    const old = c.old.slice(0, left)
    left -= old.length
    const next = c.new.slice(0, left)
    left -= next.length
    truncated ||= old.length < c.old.length || next.length < c.new.length
    kept.push({ old, new: next })
  }
  return { changes: kept, truncated }
}

/** Builds the stored form of an Edit, Write, MultiEdit or NotebookEdit call;
 *  null for any other tool or for an input without a path. `prior` is what a
 *  Write found at its path before overwriting it. */
export function editFromCall(tool: string, input: Record<string, unknown>, prior?: Prior): NewEdit | null {
  const base = (path: string, changes: Change[], extra: Partial<NewEdit> = {}): NewEdit | null => {
    if (path === '') return null
    const capped = capChanges(changes)
    return { path, tool, changes: capped.changes, ...(capped.truncated ? { truncated: true } : {}), ...extra }
  }
  switch (tool) {
    case 'Edit':
      return base(str(input.file_path), [{ old: str(input.old_string), new: str(input.new_string) }], {
        ...(input.replace_all === true ? { note: 'Replaced every match · shown once' } : {}),
      })
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : []
      return base(
        str(input.file_path),
        edits.map(x => ({ old: str(x?.old_string), new: str(x?.new_string) })),
      )
    }
    case 'Write': {
      const text = prior?.text
      return base(str(input.file_path), [{ old: text ?? '', new: str(input.content) }], {
        ...(prior?.created ? { created: true } : {}),
        ...(!prior?.created && text === undefined
          ? { note: 'Previous content not captured' }
          : {}),
      })
    }
    case 'NotebookEdit':
      return base(str(input.notebook_path), [{ old: '', new: str(input.new_source) }], {
        note: `Notebook cell (${str(input.edit_mode) || 'replace'}) · new source only`,
      })
    default:
      return null
  }
}

/** The index after moving `delta` steps in a list of `length`, kept in bounds. */
export function stepIndex(i: number, delta: number, length: number): number {
  return Math.min(Math.max(i + delta, 0), Math.max(length - 1, 0))
}

/** Distinct files among edits. */
export function fileCount(edits: readonly Edit[]): number {
  return new Set(edits.map(e => e.path)).size
}

// Rough, on purpose: sed -i, mv/cp/rm/tee/patch/truncate, git commands that
// rewrite the working tree, and output redirection (not 2>&1 or >/dev/null).
const SHELL_WRITE =
  /\bsed\s+(-[a-zA-Z]*i|--in-place)|\b(mv|cp|rm|tee|patch|truncate|rsync)\s|\bgit\s+(checkout|restore|reset|apply|merge|rebase|pull|stash|mv|rm|clean|cherry-pick|revert)\b|(^|[^0-9&>])>>?\s*(?!\/dev\/null|&)[\w./~$"']/

/** True when a Bash command looks like it modifies files. */
export function looksLikeShellWrite(command: string): boolean {
  return SHELL_WRITE.test(command)
}
