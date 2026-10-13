// The side bar's layout arithmetic, kept pure so it can be tested: how the tool cards share a line when the pane is wide,
// the scroll bar of a long list, and which list a mouse wheel tick is over. Every row the pane draws is one line (text that
// does not fit is cut with "…", never wrapped), so heights are exact counts of rows.

/** Cells a card's border and padding take: a round border (2) and one cell of padding on each side (2). */
export const CARD_CHROME = 4
/** The fewest cells of description a card keeps when it shares a line; below that it takes a line of its own. */
export const DESC_MIN = 8
/** Cells between two cards on one line. */
export const CARD_GAP = 1

/**
 * Packs cards, in order, onto lines of `columns` cells: a card joins the line while every card on it still gets its
 * minimum; the spare cells are then shared out in proportion. A card alone on its line takes the whole width.
 */
export function packCards(mins: readonly number[], columns: number, gap = CARD_GAP): { index: number; width: number }[][] {
  const lines: number[][] = []
  let line: number[] = []
  let used = 0
  mins.forEach((m, i) => {
    const need = line.length === 0 ? m : used + gap + m
    if (line.length > 0 && need > columns) {
      lines.push(line)
      line = [i]
      used = m
    } else {
      line.push(i)
      used = need
    }
  })
  if (line.length > 0) lines.push(line)
  return lines.map(l => {
    if (l.length === 1) return [{ index: l[0]!, width: columns }]
    const total = l.reduce((n, i) => n + mins[i]!, 0)
    const spare = columns - total - gap * (l.length - 1)
    let given = 0
    return l.map((i, k) => {
      const extra = k === l.length - 1 ? spare - given : Math.floor((spare * mins[i]!) / total)
      given += extra
      return { index: i, width: mins[i]! + extra }
    })
  })
}

/** Each cell of a list's scroll bar, top to bottom: the thumb (where the window is) or the track. */
export function scrollBar(top: number, shown: number, total: number): ('thumb' | 'track')[] {
  if (shown <= 0) return []
  if (total <= shown) return Array.from({ length: shown }, () => 'thumb')
  const size = Math.max(1, Math.round((shown * shown) / total))
  const maxTop = total - shown
  const at = Math.round((Math.max(0, Math.min(top, maxTop)) / maxTop) * (shown - size))
  return Array.from({ length: shown }, (_, i) => (i >= at && i < at + size ? 'thumb' : 'track'))
}

/** Where a click on the scroll bar's cell `cell` moves the window: a page toward it; on the thumb, a page toward the half it is in. */
export function barTarget(top: number, shown: number, total: number, cell: number): number {
  const bar = scrollBar(top, shown, total)
  const first = bar.indexOf('thumb')
  const last = bar.lastIndexOf('thumb')
  const maxTop = Math.max(0, total - shown)
  if (cell < first) return Math.max(0, top - shown)
  if (cell > last || cell >= shown / 2) return Math.min(maxTop, top + shown)
  return Math.max(0, top - shown)
}

/** A scrolling list near the bottom of the pane: its id and how many rows it shows now. */
export type BottomList = { id: string; shown: number }

/**
 * Which list a tree row is over. The lists are given bottom-up (the last one drawn first) and sit directly above
 * `below` rows (the footer and the gap above it); each is a title row, a bordered box of `shown` rows, and a gap.
 */
export function listAt(lists: readonly BottomList[], contentRows: number, row: number, below = 2): { id: string; index: number } | undefined {
  const fromBottom = contentRows - 1 - row
  let cursor = below // the bottom border of the lowest list's box
  for (const l of lists) {
    const lowest = cursor + 1
    const highest = cursor + l.shown
    if (fromBottom >= lowest && fromBottom <= highest) return { id: l.id, index: highest - fromBottom }
    cursor += l.shown + 3 + 1 // two borders, the title, and the gap above it
  }
  return undefined
}

/** A name padded to `width` cells, with a cell of air each side: the text of a name pill. */
export const pillText = (name: string, width: number): string => ` ${name.padEnd(width)} `
