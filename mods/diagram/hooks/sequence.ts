import { Canvas } from './canvas'
import type { LineStyle } from './canvas'
import { statementsOf } from './flow-parse'
import { TooWide, padEnd, truncate, widest, wrapText } from './text'

/** The simple core of sequenceDiagram: participants, messages, notes, and block lines shown as a marker row. */

type Head = 'arrow' | 'none' | 'cross' | 'async'
type Event =
  | { type: 'message'; from: number; to: number; text: string; style: LineStyle; head: Head }
  | { type: 'note'; where: 'over' | 'left' | 'right'; a: number; b: number; text: string }
  | { type: 'marker'; text: string }

export type Sequence = { names: string[]; events: Event[] }

const HEADS: Record<string, { style: LineStyle; head: Head }> = {
  '->>': { style: 'solid', head: 'arrow' },
  '-->>': { style: 'dotted', head: 'arrow' },
  '->': { style: 'solid', head: 'none' },
  '-->': { style: 'dotted', head: 'none' },
  '-x': { style: 'solid', head: 'cross' },
  '--x': { style: 'dotted', head: 'cross' },
  '-)': { style: 'solid', head: 'async' },
  '--)': { style: 'dotted', head: 'async' },
  '<<->>': { style: 'solid', head: 'arrow' },
  '<<-->>': { style: 'dotted', head: 'arrow' },
}
const MESSAGE = /^(\S+?)(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)[+-]?([^\s:+<>)]+)\s*(?::\s*(.*))?$/
const DECLARE = /^(?:create\s+)?(?:participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/i
const NOTE = /^note\s+(left of|right of|over)\s+([^:,]+?)(?:\s*,\s*([^:]+?))?\s*:\s*(.*)$/i
const BLOCK = /^(loop|alt|opt|par|critical|break|rect|else|and|option)\b\s*(.*)$/i
const IGNORED = /^(activate|deactivate|destroy|title|box|accTitle|accDescr|link|links|end)\b/i
const AUTONUMBER = /^(autonumber)\b/i

const plain = (raw: string): string => raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim()

/** Parses the lines after a `sequenceDiagram` header. Throws on anything it cannot read. */
export function parseSequence(body: readonly string[]): Sequence {
  const ids: string[] = []
  const names: string[] = []
  const events: Event[] = []
  let numbered = false
  let count = 0
  const index = (id: string, name?: string): number => {
    let i = ids.indexOf(id)
    if (i < 0) {
      ids.push(id)
      names.push(id)
      i = ids.length - 1
    }
    if (name !== undefined && name !== '') names[i] = plain(name)

    return i
  }
  for (const line of body) {
    for (const stmt of statementsOf(line)) {
      let m: RegExpExecArray | null
      if (AUTONUMBER.test(stmt)) numbered = true
      else if (IGNORED.test(stmt)) continue
      else if ((m = DECLARE.exec(stmt)) !== null) index(m[1] as string, m[2])
      else if ((m = NOTE.exec(stmt)) !== null) {
        const where = (m[1] as string).toLowerCase().startsWith('over') ? 'over' : (m[1] as string).toLowerCase().startsWith('left') ? 'left' : 'right'
        const a = index((m[2] as string).trim())
        const b = m[3] === undefined ? a : index(m[3].trim())
        events.push({ type: 'note', where, a: Math.min(a, b), b: Math.max(a, b), text: plain(m[4] ?? '') })
      } else if ((m = MESSAGE.exec(stmt)) !== null) {
        const how = HEADS[m[2] as string] as { style: LineStyle; head: Head }
        count++
        const label = plain(m[4] ?? '')
        events.push({
          type: 'message',
          from: index(m[1] as string),
          to: index(m[3] as string),
          text: numbered ? `${count}. ${label}` : label,
          ...how,
        })
      } else if ((m = BLOCK.exec(stmt)) !== null) {
        events.push({ type: 'marker', text: `${(m[1] as string).toLowerCase()}${m[2] === '' ? '' : ` · ${plain(m[2] ?? '')}`}` })
      } else throw new Error(`cannot read "${stmt.slice(0, 20)}"`)
    }
  }
  if (names.length === 0) throw new Error('no participants')

  return { names, events }
}

const LABEL_WIDTHS = [34, 26, 20, 14, 10, 7]
const NOTE_MAX = 28
/** The head of a message, by whether it points right or left. */
function headOf(head: Head, isRight: boolean): string {
  if (head === 'arrow') return isRight ? '►' : '◄'
  if (head === 'async') return isRight ? '»' : '«'

  return head === 'cross' ? '×' : ''
}

type Need = { lo: number; hi: number; width: number }

/** Distances between neighbouring lifelines, grown until every message and note fits across the lifelines it spans. */
function spacing(boxes: number[], needs: Need[]): number[] {
  const gap = boxes.slice(0, -1).map((w, i) => Math.ceil((w + (boxes[i + 1] as number)) / 2) + 2)
  for (const need of [...needs].sort((a, b) => a.hi - a.lo - (b.hi - b.lo))) {
    let have = 0
    for (let i = need.lo; i < need.hi; i++) have += gap[i] as number
    if (have < need.width && need.hi > need.lo) gap[need.hi - 1] = (gap[need.hi - 1] as number) + need.width - have
  }

  return gap
}

type Row = { y: number; e: Event; label: string[]; box?: [number, number] }

/** Rows of the body: where each event sits and how far left and right everything reaches (relative to the first lifeline). */
function plan(seq: Sequence, xs: number[], boxes: number[], headHeight: number, labelWidth: number) {
  let y = headHeight
  let left = 0
  let right = 0
  const reach = (lo: number, hi: number): void => {
    left = Math.min(left, lo)
    right = Math.max(right, hi)
  }
  boxes.forEach((w, i) => reach((xs[i] as number) - Math.floor(w / 2), (xs[i] as number) - Math.floor(w / 2) + w - 1))
  const rows: Row[] = []
  for (const e of seq.events) {
    y += 1
    if (e.type === 'message') {
      const label = wrapText(e.text, labelWidth)
      rows.push({ y, e, label })
      if (e.from === e.to) {
        reach(xs[e.from] as number, (xs[e.from] as number) + 5 + widest(label))
        y += Math.max(2, label.length)
      } else y += label.length + 1
    } else if (e.type === 'note') {
      const label = noteRowsOf(e, labelWidth)
      const bw = widest(label) + 4
      const a = xs[e.a] as number
      const isSpan = e.where === 'over' && e.b > e.a
      const lo = e.where === 'over' ? (isSpan ? a - 2 : a - Math.floor(bw / 2)) : e.where === 'right' ? a + 2 : a - 2 - bw + 1
      const hi = isSpan ? Math.max((xs[e.b] as number) + 2, lo + bw - 1) : lo + bw - 1
      reach(lo, hi)
      rows.push({ y, e, label, box: [lo, hi] })
      y += label.length + 2
    } else {
      const label = truncate(e.text, labelWidth + 12)
      rows.push({ y, e, label: [label] })
      reach(0, label.length + 6)
      y += 1
    }
  }

  return { rows, left, right, height: y + 1 }
}

function noteRowsOf(e: Extract<Event, { type: 'note' }>, labelWidth: number): string[] {
  return wrapText(e.text, Math.min(labelWidth, NOTE_MAX))
}

function layout(seq: Sequence, labelWidth: number): string[] {
  const n = seq.names.length
  const headRows = seq.names.map(name => wrapText(name, labelWidth))
  const boxes = headRows.map(rows => widest(rows) + 4)
  const headHeight = Math.max(...headRows.map(rows => rows.length)) + 2
  const needs: Need[] = []
  for (const e of seq.events) {
    if (e.type === 'message') {
      const w = widest(wrapText(e.text, labelWidth))
      if (e.from !== e.to) needs.push({ lo: Math.min(e.from, e.to), hi: Math.max(e.from, e.to), width: w + 4 })
      else if (e.from + 1 < n) needs.push({ lo: e.from, hi: e.from + 1, width: w + 8 })
    } else if (e.type === 'note') {
      const w = widest(noteRowsOf(e, labelWidth)) + 4
      if (e.where === 'over' && e.b > e.a) needs.push({ lo: e.a, hi: e.b, width: w })
      if (e.where === 'right' && e.a + 1 < n) needs.push({ lo: e.a, hi: e.a + 1, width: w + 6 })
      if (e.where === 'left' && e.a > 0) needs.push({ lo: e.a - 1, hi: e.a, width: w + 6 })
    }
  }
  const gap = spacing(boxes, needs)
  const xs: number[] = []
  boxes.forEach((_, i) => xs.push(i === 0 ? 0 : (xs[i - 1] as number) + (gap[i - 1] as number)))
  const body = plan(seq, xs, boxes, headHeight, labelWidth)
  const shift = -body.left
  const canvas = new Canvas(body.right + shift + 1, body.height)
  const cx = (i: number): number => (xs[i] as number) + shift

  boxes.forEach((w, i) => {
    const x = cx(i) - Math.floor(w / 2)
    const rows = headRows[i] as string[]
    canvas.vline(cx(i), headHeight - 1, body.height - 1, 'dotted')
    canvas.box(x, 0, w, headHeight, ['┌', '┐', '┘', '└'])
    rows.forEach((row, j) => canvas.text(x + 2 + Math.floor((w - 4 - row.length) / 2), 1 + j, row))
    canvas.put(cx(i), headHeight - 1, '┬')
  })
  for (const row of body.rows) drawRow(canvas, row, cx, shift)

  return canvas.toLines()
}

function drawRow(canvas: Canvas, r: Row, cx: (i: number) => number, shift: number): void {
  const e = r.e
  if (e.type === 'marker') canvas.text(0, r.y, `── ${r.label[0] ?? ''} ──`)
  else if (e.type === 'note') drawNote(canvas, r, shift)
  else if (e.from === e.to) drawSelf(canvas, r, e, cx(e.from))
  else drawMessage(canvas, r, e, cx(e.from), cx(e.to))
}

function drawNote(canvas: Canvas, r: Row, shift: number): void {
  const [lo, hi] = r.box as [number, number]
  const x = lo + shift
  const w = hi - lo + 1
  canvas.box(x, r.y, w, r.label.length + 2, ['┌', '┐', '┘', '└'])
  r.label.forEach((row, j) => {
    // The box is cleared inside first, so a lifeline does not show through the note.
    canvas.text(x + 1, r.y + 1 + j, padEnd('', w - 2))
    canvas.text(x + 2 + Math.floor((w - 4 - row.length) / 2), r.y + 1 + j, row)
  })
}

/** A message to another participant: the label above a line with its head next to the target. */
function drawMessage(canvas: Canvas, r: Row, e: Extract<Event, { type: 'message' }>, from: number, to: number): void {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const arrowY = r.y + r.label.length
  r.label.forEach((row, j) => canvas.text(lo + 2, r.y + j, row))
  canvas.hline(lo, hi, arrowY, e.style)
  const head = headOf(e.head, to > from)
  if (head !== '') canvas.put(to > from ? hi - 1 : lo + 1, arrowY, head)
}

/** A message to itself: a small loop to the right of the lifeline, the label beside it. */
function drawSelf(canvas: Canvas, r: Row, e: Extract<Event, { type: 'message' }>, x: number): void {
  canvas.hline(x, x + 3, r.y, e.style)
  canvas.vline(x + 3, r.y, r.y + 1, e.style)
  canvas.hline(x, x + 3, r.y + 1, e.style)
  const head = headOf(e.head, false)
  if (head !== '') canvas.put(x + 1, r.y + 1, head)
  r.label.forEach((row, j) => canvas.text(x + 5, r.y + j, row))
}

/** Draws a sequence diagram in at most `columns` columns. Throws TooWide when no label width fits. */
export function drawSequence(seq: Sequence, columns: number): string[] {
  for (const width of LABEL_WIDTHS) {
    const lines = layout(seq, width)
    if (widest(lines) <= columns) return lines
  }
  throw new TooWide('no label width fits')
}
