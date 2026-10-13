// csv-table: pure parsing and layout (no engine access), so the tests can call it directly.
import type { CsvTableColumn, CsvTableReport } from '../types'

export type Delimiter = ',' | ';' | '\t'

export const DELIMITER_NAMES: Record<Delimiter, string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab' }
export const EXTENSIONS = new Set(['csv', 'tsv', 'txt'])
/** Rows shown in the preview table. */
export const PREVIEW_ROWS = 20
/** Columns shown in the preview table (all of them are listed with their types, up to MAX_LISTED). */
export const PREVIEW_COLUMNS = 10
export const MAX_LISTED = 60
/** Characters of one cell in the preview. */
export const CELL = 18
/** The most characters the pane shows of the preview table. */
export const LIMIT = 9000

export function extOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')

  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function nameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

export const isAbsolute = (path: string): boolean => /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path)

/** `path` against the session's folder when it is relative, with that folder's own separator (Windows or POSIX). */
export function resolveIn(cwd: string, path: string): string {
  if (isAbsolute(path)) return path
  const sep = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'

  return `${cwd.replace(/[\\/]+$/, '')}${sep}${path}`
}

/** The path as typed, without matching quotes around it. */
export function unquote(raw: string): string {
  const path = raw.trim()
  const m = /^(["'])(.*)\1$/.exec(path)

  return m ? m[2]! : path
}

/**
 * RFC 4180 style: fields split on `delimiter`, a field that starts with `"` runs to the closing quote (a doubled `""`
 * is one quote; delimiters and newlines inside are text). A quote inside an unquoted field is kept as text.
 * `isOpen` is true when the text ends inside a quoted field. Lines with no characters at all are skipped.
 */
export function parse(text: string, delimiter: Delimiter, maxRows = Infinity): { rows: string[][]; isOpen: boolean } {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let isQuoted = false
  let isAtStart = true // at the start of a field
  let isEmptyLine = true
  const endRow = () => {
    row.push(cell)
    if (!(isEmptyLine && row.length === 1 && cell === '')) rows.push(row)
    row = []
    cell = ''
    isAtStart = true
    isEmptyLine = true
  }
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i]!
    if (isQuoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else isQuoted = false
      } else cell += c
      continue
    }
    if (c === '"' && isAtStart) {
      isQuoted = true
      isAtStart = false
      isEmptyLine = false
    } else if (c === delimiter) {
      row.push(cell)
      cell = ''
      isAtStart = true
      isEmptyLine = false
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else {
      cell += c
      isAtStart = false
      isEmptyLine = false
    }
  }
  if (rows.length < maxRows && (cell !== '' || row.length > 0 || isQuoted)) endRow()

  return { rows, isOpen: isQuoted }
}

/** Comma, semicolon or tab: the one that splits the first rows into the most columns, the same number in each. */
export function detectDelimiter(text: string, ext = ''): Delimiter {
  const head = text.slice(0, 64 * 1024)
  const order: Delimiter[] = ext === 'tsv' ? ['\t', ',', ';'] : [',', ';', '\t']
  let best: Delimiter = order[0]!
  let bestScore = 0
  for (const d of order) {
    const { rows } = parse(head, d, 30)
    const sample = rows.length > 1 && head.length === 64 * 1024 ? rows.slice(0, -1) : rows // the last may be cut
    const width = sample[0]?.length ?? 0
    if (width < 2) continue
    const same = sample.filter(r => r.length === width).length / sample.length
    const score = width * same * same
    if (score > bestScore) {
      best = d
      bestScore = score
    }
  }

  return best
}

const NUMBER = /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][-+]?\d+)?%?$/
/** Cells counted as empty: nothing, or R's NA. */
export const isEmptyCell = (cell: string): boolean => {
  const t = cell.trim()

  return t === '' || t === 'NA'
}

export function columnsOf(header: string[], data: string[][]): CsvTableColumn[] {
  const width = data.reduce((most, r) => Math.max(most, r.length), header.length)

  return Array.from({ length: width }, (_, j) => {
    let empty = 0
    let numbers = 0
    for (const r of data) {
      const cell = r[j] ?? ''
      if (isEmptyCell(cell)) empty++
      else if (NUMBER.test(cell.trim())) numbers++
    }
    const filled = data.length - empty
    const type = filled === 0 ? 'empty' : numbers === filled ? 'number' : 'text'

    const name = (header[j] ?? '').replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80) || `(column ${j + 1})`

    return { name, type, emptyPct: data.length === 0 ? 0 : Math.round((100 * empty) / data.length) }
  })
}

const fit = (cell: string, width: number): string => {
  const flat = cell.replace(/\r?\n/g, '↵').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\t/g, ' ')

  return (flat.length > width ? `${flat.slice(0, width - 1)}…` : flat).padEnd(width)
}

/** The first rows as an aligned plain-text table, header first, cut to LIMIT characters. */
export function previewOf(header: string[], data: string[][]): { text: string; isCut: boolean } {
  const cols = Math.min(PREVIEW_COLUMNS, data.slice(0, PREVIEW_ROWS).reduce((most, r) => Math.max(most, r.length), header.length))
  const line = (r: string[]) => Array.from({ length: cols }, (_, j) => fit(r[j] ?? '', CELL)).join(' │ ').trimEnd()
  const rule = Array.from({ length: cols }, () => '─'.repeat(CELL)).join('─┼─')
  const text = [line(header), rule, ...data.slice(0, PREVIEW_ROWS).map(line)].join('\n')
  if (text.length <= LIMIT) return { text, isCut: false }

  return { text: text.slice(0, text.lastIndexOf('\n', LIMIT)), isCut: true }
}

/** Everything the pane shows for one file's text. */
export function analyse(path: string, text: string, sizeBytes: number): CsvTableReport {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const delimiter = detectDelimiter(body, extOf(path))
  const { rows, isOpen } = parse(body, delimiter)
  const header = rows[0] ?? []
  const data = rows.slice(1)
  const columns = columnsOf(header, data)
  const preview = previewOf(header, data)
  const ragged = data.filter(r => r.length !== header.length).length
  const warnings: string[] = []
  if (isOpen) warnings.push('The file ends inside a quoted field: a quote is probably missing.')
  if (ragged > 0) warnings.push(`${ragged} row${ragged === 1 ? ' has' : 's have'} a different number of fields than the header.`)

  return {
    path,
    name: nameOf(path),
    sizeBytes,
    delimiter: DELIMITER_NAMES[delimiter],
    rowCount: data.length,
    columns: columns.slice(0, MAX_LISTED),
    columnCount: columns.length,
    preview: preview.text,
    previewRows: Math.min(PREVIEW_ROWS, data.length),
    isCut: preview.isCut || columns.length > PREVIEW_COLUMNS,
    warnings,
  }
}

export const thousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export function summaryOf(r: CsvTableReport): string {
  return `csv-table · ${r.name}: ${thousands(r.rowCount)} rows × ${r.columnCount} columns (${r.delimiter}-separated)`
}

/** The whole report as text, for a session where nothing draws panes. */
export function reportText(r: CsvTableReport): string {
  const cols = r.columns.map((c, i) => `  ${i + 1}. ${c.name} · ${c.type}${c.emptyPct > 0 ? ` · ${c.emptyPct}% empty` : ''}`)

  return [summaryOf(r), ...r.warnings, 'Columns:', ...cols, '', r.preview].join('\n')
}
