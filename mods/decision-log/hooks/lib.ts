// decision-log: pure helpers (no engine access) for the docs/DECISIONS.md table the agents-md-scaffold skill writes:
//   # Decisions log
//   | ID | Date | Decision | Rationale | Status |
//   |----|------|----------|-----------|--------|
import type { DecisionLogRow } from '../types'

export const RELATIVE_PATH = 'docs/DECISIONS.md'
export const HEADER_LINES = ['# Decisions log', '| ID | Date | Decision | Rationale | Status |', '|----|------|----------|-----------|--------|']
export const MAX_DECISION = 500
export const MAX_RATIONALE = 1000

export const isAbsolute = (path: string): boolean => /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path)

/** `docs/DECISIONS.md` under the session's folder, with that folder's own separator (Windows or POSIX). */
export function decisionsPath(cwd: string): string {
  const sep = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'

  return `${cwd.replace(/[\\/]+$/, '')}${sep}docs${sep}DECISIONS.md`
}

/** `text [-- rationale]`: the decision and the rationale, or why the input is refused. */
export function parseArgs(args: string): { decision: string; rationale: string } | { error: string } {
  const text = args.trim()
  const m = /(?:^|\s)--(?:\s|$)/.exec(text)
  const decision = (m ? text.slice(0, m.index) : text).trim()
  const rationale = m ? text.slice(m.index + m[0].length).trim() : ''
  if (decision === '') return { error: 'say what was decided' }
  if (decision.length > MAX_DECISION) return { error: `keep the decision under ${MAX_DECISION} characters (put the detail in the rationale)` }
  if (rationale.length > MAX_RATIONALE) return { error: `keep the rationale under ${MAX_RATIONALE} characters` }

  return { decision, rationale }
}

/** A table cell: `|` escaped, line breaks as <br>, control characters dropped. */
export function escapeCell(text: string): string {
  return text
    .replace(/\r\n?|\n/g, '<br>')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\|/g, '\\|')
    .trim()
}

export function unescapeCell(cell: string): string {
  return cell.replace(/\\\|/g, '|').replace(/<br>/g, ' ↵ ').trim()
}

/** The cells of a table line, split at `|` not escaped by a backslash. */
export function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')

  return inner.split(/(?<!\\)\|/).map(cell => cell.trim())
}

const isTableLine = (line: string): boolean => line.trim().startsWith('|')
const isRule = (line: string): boolean => /^\|[\s:|-]+$/.test(line.trim())

/** The rows of the decisions table whose ID is a number, in file order. */
export function parseRows(text: string): DecisionLogRow[] {
  const rows: DecisionLogRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!isTableLine(line) || isRule(line)) continue
    const cells = cellsOf(line)
    if (!/^\d+$/.test(cells[0] ?? '')) continue
    rows.push({
      id: cells[0]!,
      date: unescapeCell(cells[1] ?? ''),
      decision: unescapeCell(cells[2] ?? ''),
      rationale: unescapeCell(cells[3] ?? ''),
      status: unescapeCell(cells[4] ?? ''),
    })
  }

  return rows
}

/** The highest numeric ID + 1, zero-padded to 3 digits. */
export function nextId(text: string): string {
  const most = parseRows(text).reduce((max, row) => Math.max(max, Number(row.id)), 0)

  return String(most + 1).padStart(3, '0')
}

export function rowLine(id: string, date: string, decision: string, rationale: string): string {
  const why = escapeCell(rationale)

  return `| ${id} | ${date} | ${escapeCell(decision)} |${why === '' ? ' ' : ` ${why} `}| accepted |`
}

/**
 * The file with `line` added as the last row of the decisions table (the table whose header starts `| ID |`). With
 * no such table, the header and the row are added at the end; with no file at all (`undefined`), the template header.
 */
export function withRow(text: string | undefined, line: string): string {
  if (text === undefined || text.trim() === '') return [...HEADER_LINES, line, ''].join('\n')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const header = lines.findIndex(l => /^\|\s*ID\s*\|/i.test(l.trim()))
  if (header < 0) {
    const body = text.replace(/(\r?\n)*$/, '')

    return [body, '', ...HEADER_LINES.slice(1), line, ''].join(eol)
  }
  let last = header
  while (last + 1 < lines.length && isTableLine(lines[last + 1]!)) last++
  lines.splice(last + 1, 0, line)
  const joined = lines.join(eol)

  return joined.endsWith(eol) ? joined : joined + eol
}

/** The local date, YYYY-MM-DD. */
export function localDate(ms: number): string {
  const d = new Date(ms)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
