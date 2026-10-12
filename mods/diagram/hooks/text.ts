/** Plain-text helpers shared by the drawings. Every character counts as one column (no East Asian or emoji widths). */

/** Thrown when no wrap width makes a drawing fit the pane. */
export class TooWide extends Error {}

/** Thrown when a drawing would take too many line pieces to lay out in good time. */
export class TooBig extends Error {}

/** Tabs become two spaces and control characters (but not newlines) go, so a stray byte never breaks a row. */
export function clean(source: string): string {
  return source
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '')
}

/** Cuts a text to `width` characters, ending in an ellipsis when it was cut. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return '…'

  return `${text.slice(0, width - 1)}…`
}

export function padEnd(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

/** Splits a word longer than `width` into pieces of at most `width` characters. */
function breakWord(word: string, width: number): string[] {
  const pieces: string[] = []
  for (let i = 0; i < word.length; i += width) pieces.push(word.slice(i, i + width))

  return pieces
}

/** Wraps one paragraph (no newlines) greedily at word boundaries; a word too long for a row is broken. */
function wrapParagraph(text: string, width: number): string[] {
  const rows: string[] = []
  let row = ''
  for (const word of text.split(/\s+/).filter(w => w !== '')) {
    for (const piece of breakWord(word, width)) {
      if (row === '') row = piece
      else if (row.length + 1 + piece.length <= width) row = `${row} ${piece}`
      else {
        rows.push(row)
        row = piece
      }
    }
  }
  if (row !== '' || rows.length === 0) rows.push(row)

  return rows
}

/** Wraps a text to rows of at most `width` characters; a "\n" in the text always starts a new row. Never returns an empty list. */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width))

  return text.split('\n').flatMap(paragraph => wrapParagraph(paragraph, w))
}

/** The longest row of a list. */
export function widest(rows: readonly string[]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0)
}

const MAX_BOX_ROWS = 60

/**
 * The source in a box of its own, hard-wrapped to fit `columns`. Used wherever a diagram is not drawn,
 * so the person still sees exactly what Claude wrote.
 */
export function codeBox(source: string, columns: number): string[] {
  const inner = Math.max(4, columns - 4)
  const rows = source
    .replace(/\s+$/, '')
    .split('\n')
    .flatMap(line => (line.length <= inner ? [line] : breakWord(line, inner)))
  const shown = rows.slice(0, MAX_BOX_ROWS)
  if (rows.length > shown.length) shown.push(`… ${rows.length - shown.length} more lines`)
  const width = widest(shown)
  const bar = '─'.repeat(width + 2)

  return [`┌${bar}┐`, ...shown.map(row => `│ ${padEnd(row, width)} │`), `└${bar}┘`]
}
