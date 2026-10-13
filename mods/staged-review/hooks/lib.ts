// staged-review: pure helpers (no engine access), so the tests can call them directly.

/** The most characters the pane shows of git's output, stat and diff together. */
export const LIMIT = 9000
/** The share of LIMIT the --stat summary may take; the diff gets the rest. */
export const STAT_LIMIT = 2000

/** Removes control characters a pane cannot draw (keeps newline and tab). */
export function clean(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
}

/** Cuts text to `limit` characters at a line end where it can. */
export function bound(text: string, limit: number): { text: string; isCut: boolean } {
  if (text.length <= limit) return { text, isCut: false }
  const head = text.slice(0, limit)
  const lineEnd = head.lastIndexOf('\n')

  return { text: lineEnd > limit / 2 ? head.slice(0, lineEnd) : head, isCut: true }
}

/** The path the person typed, or why it is refused. A path is optional ('' means the whole index). */
export function checkPath(raw: string): { path: string } | { error: string } {
  const path = raw.trim()
  if (path === '') return { path: '' }
  if (path.startsWith('-')) return { error: 'a path may not start with “-” (it would be read as an option)' }
  if (/[\u0000-\u001f\u007f]/.test(path)) return { error: 'a path may not hold control characters' }
  if (path.length > 1000) return { error: 'that path is too long' }

  return { path }
}

/** The argument vectors for `git diff --cached`, the stat first. `--` keeps a path from being read as an option. */
export function gitArgs(path: string): { stat: string[]; diff: string[] } {
  const tail = path === '' ? [] : ['--', path]

  return {
    stat: ['git', '--no-pager', 'diff', '--cached', '--no-color', '--stat', ...tail],
    diff: ['git', '--no-pager', 'diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=2', ...tail],
  }
}

/** The last line of `git diff --stat` (" 2 files changed, 5 insertions(+)"), or ''. */
export function summaryOf(stat: string): string {
  const lines = stat.trim().split('\n')

  return (lines[lines.length - 1] ?? '').trim()
}
