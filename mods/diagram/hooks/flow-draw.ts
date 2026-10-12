import { Canvas } from './canvas'
import type { LineStyle } from './canvas'
import type { Flow, FlowEdge, FlowNode } from './flow-parse'
import { TooBig, TooWide, truncate, widest, wrapText } from './text'

/**
 * Layered drawing of a flowchart. Nodes are ranked by longest path, ordered inside a rank to reduce crossings,
 * placed across the flow, and joined by lines routed in the gaps between ranks. A line that skips a rank passes
 * through a one-cell "dummy" in each rank it crosses. An edge that would point back up (a loop) is not drawn as a
 * line: it is listed under the drawing. "Along" is the flow's direction (down for TD, right for LR), "across" the other.
 */

type Item = {
  layer: number
  real: boolean
  /** Size along the flow and across it, in cells. */
  p: number
  c: number
  /** Position across the flow. */
  pos: number
  node?: FlowNode
  rows: string[]
  /** The edge a dummy carries. */
  edge?: FlowEdge
  /** Extra space wanted to the right (top-down charts): the label of the edge that enters from above sits there. */
  room: number
}

type Seg = {
  from: Item
  to: Item
  edge: FlowEdge
  first: boolean
  last: boolean
  /** The row of its gap in which it runs across, when it bends. */
  row: number
  /** Whose line the label sits beside (top-down charts): the source's stem or the target's last leg. */
  anchor: 'from' | 'to'
}

/** Wrap widths tried in turn until the drawing fits the pane. */
const TEXT_WIDTHS = [30, 24, 18, 14, 10, 8, 6]
const LABEL_MAX = 16
const TOP_ROWS = 40
/** Line pieces (an edge that skips ranks counts once per rank it crosses) beyond which a chart is left as source: layout cost grows with the square. */
const MAX_SEGMENTS = 300

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()
const labelOf = (edge: FlowEdge): string => oneLine(truncate(edge.label, LABEL_MAX))

type Analysis = { rank: Map<string, number>; forward: FlowEdge[]; loops: FlowEdge[] }

/** Splits the edges into those that go forward and those that close a loop (including self-loops), then ranks the nodes. */
function analyse(flow: Flow): Analysis {
  const outgoing = new Map<string, FlowEdge[]>()
  for (const edge of flow.edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge])
  const state = new Map<string, 1 | 2>()
  const forward = new Set<FlowEdge>()
  const loops = new Set<FlowEdge>()
  const visit = (id: string): void => {
    state.set(id, 1)
    for (const edge of outgoing.get(id) ?? []) {
      const next = state.get(edge.to)
      if (edge.from === edge.to || next === 1) loops.add(edge)
      else {
        forward.add(edge)
        if (next === undefined) visit(edge.to)
      }
    }
    state.set(id, 2)
  }
  for (const node of flow.nodes) if (!state.has(node.id)) visit(node.id)

  const kept = flow.edges.filter(edge => forward.has(edge))
  const rank = new Map<string, number>(flow.nodes.map(node => [node.id, 0]))
  const indegree = new Map<string, number>(flow.nodes.map(node => [node.id, 0]))
  for (const edge of kept) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  const queue = flow.nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id)
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head] as string
    for (const edge of outgoing.get(id) ?? []) {
      if (!forward.has(edge)) continue
      rank.set(edge.to, Math.max(rank.get(edge.to) ?? 0, (rank.get(id) ?? 0) + 1))
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) - 1)
      if (indegree.get(edge.to) === 0) queue.push(edge.to)
    }
  }

  return { rank, forward: kept, loops: flow.edges.filter(edge => loops.has(edge)) }
}

type Graph = { layers: Item[][]; segs: Seg[]; items: Map<string, Item>; preds: Map<Item, Item[]>; succs: Map<Item, Item[]> }

function boxItem(node: FlowNode, layer: number, textWidth: number, isDown: boolean): Item {
  const rows = wrapText(node.text, textWidth)
  const w = widest(rows) + 4
  const h = rows.length + 2

  return { layer, real: true, p: isDown ? h : w, c: isDown ? w : h, pos: 0, node, rows, room: 0 }
}

/**
 * Decides which line each label of a top-down chart sits beside, and reserves the room for it. Several edges merging
 * into one node each keep their label by their own source; a fan-out keeps its labels by the targets, where the
 * branches part. The anchor node gets extra space to its right so neighbours do not run into the text.
 */
function placeLabelRooms(segs: Seg[]): void {
  const labelled = segs.filter(s => s.first && labelOf(s.edge) !== '')
  const outCount = new Map<Item, number>()
  const inCount = new Map<Item, number>()
  for (const s of segs) inCount.set(s.to, (inCount.get(s.to) ?? 0) + 1)
  for (const s of labelled) outCount.set(s.from, (outCount.get(s.from) ?? 0) + 1)
  for (const s of labelled) {
    s.anchor = outCount.get(s.from) === 1 && (inCount.get(s.to) ?? 0) > 1 ? 'from' : 'to'
    const item = s.anchor === 'from' ? s.from : s.to
    item.room = Math.max(item.room, labelOf(s.edge).length + 2 - (item.c - Math.floor(item.c / 2) - 1))
  }
}

/** Items per rank and the segments between neighbouring ranks, dummies included. */
function buildGraph(flow: Flow, analysis: Analysis, textWidth: number, isDown: boolean): Graph {
  const items = new Map<string, Item>()
  const layers: Item[][] = []
  const layerOf = (n: number): Item[] => (layers[n] ??= [])
  for (const node of flow.nodes) {
    const item = boxItem(node, analysis.rank.get(node.id) ?? 0, textWidth, isDown)
    items.set(node.id, item)
    layerOf(item.layer).push(item)
  }
  for (let n = 0; n < layers.length; n++) layerOf(n)
  const segs: Seg[] = []
  for (const edge of analysis.forward) {
    const from = items.get(edge.from) as Item
    const to = items.get(edge.to) as Item
    let previous = from
    for (let layer = from.layer + 1; layer <= to.layer; layer++) {
      const isLast = layer === to.layer
      const next: Item = isLast ? to : { layer, real: false, p: 1, c: 1, pos: 0, rows: [], edge, room: 0 }
      if (!isLast) layerOf(layer).push(next)
      segs.push({ from: previous, to: next, edge, first: previous === from, last: isLast, row: 0, anchor: 'to' })
      previous = next
    }
  }
  const preds = new Map<Item, Item[]>()
  const succs = new Map<Item, Item[]>()
  for (const s of segs) {
    preds.set(s.to, [...(preds.get(s.to) ?? []), s.from])
    succs.set(s.from, [...(succs.get(s.from) ?? []), s.to])
  }
  if (isDown) placeLabelRooms(segs)

  return { layers, segs, items, preds, succs }
}

// ---- ordering inside a rank ------------------------------------------------------------------------------------

function indexMap(layers: Item[][]): Map<Item, number> {
  const map = new Map<Item, number>()
  for (const layer of layers) layer.forEach((item, i) => map.set(item, i))

  return map
}

function crossings(layers: Item[][], segs: Seg[]): number {
  const at = indexMap(layers)
  const byGap = new Map<number, Seg[]>()
  for (const s of segs) byGap.set(s.from.layer, [...(byGap.get(s.from.layer) ?? []), s])
  let count = 0
  for (const gap of byGap.values()) {
    for (let i = 0; i < gap.length; i++) {
      for (let j = i + 1; j < gap.length; j++) {
        const a = gap[i] as Seg
        const b = gap[j] as Seg
        const d1 = (at.get(a.from) as number) - (at.get(b.from) as number)
        const d2 = (at.get(a.to) as number) - (at.get(b.to) as number)
        if (d1 * d2 < 0) count++
      }
    }
  }

  return count
}

/** Reorders one rank by the average index of each item's neighbours in the rank next to it. */
function reorder(layer: Item[], neighbours: (item: Item) => Item[], at: Map<Item, number>): Item[] {
  const keyed = layer.map((item, i) => {
    const near = neighbours(item).map(n => at.get(n) as number)

    return { item, i, key: near.length === 0 ? i : near.reduce((a, b) => a + b, 0) / near.length }
  })

  return keyed.sort((a, b) => a.key - b.key || a.i - b.i).map(k => k.item)
}

function orderLayers(graph: Graph): Item[][] {
  let best = graph.layers.map(layer => [...layer])
  let bestCrossings = crossings(best, graph.segs)
  let layers = best.map(layer => [...layer])
  for (let pass = 0; pass < 8 && bestCrossings > 0; pass++) {
    const down = pass % 2 === 0
    const order = down ? layers.map((_, l) => l).slice(1) : layers.map((_, l) => l).slice(0, -1).reverse()
    for (const l of order) {
      const at = indexMap(layers)
      const near = (item: Item): Item[] => (down ? graph.preds.get(item) : graph.succs.get(item)) ?? []
      layers[l] = reorder(layers[l] as Item[], near, at)
    }
    const x = crossings(layers, graph.segs)
    if (x < bestCrossings) {
      bestCrossings = x
      best = layers.map(layer => [...layer])
    }
    layers = layers.map(layer => [...layer])
  }

  return best
}

// ---- positions across the flow ---------------------------------------------------------------------------------

const centre = (item: Item): number => item.pos + Math.floor(item.c / 2)

function separation(a: Item, b: Item, isDown: boolean): number {
  if (!isDown) return 1

  return (a.real && b.real ? 3 : 2) + a.room
}

/** Moves each item of a rank towards its target without overlap: the average of a left-to-right and a right-to-left packing. */
function settle(layer: Item[], target: Map<Item, number>, isDown: boolean): void {
  const left: number[] = []
  layer.forEach((item, i) => {
    const t = target.get(item) as number
    const prev = layer[i - 1]
    left.push(prev === undefined ? t : Math.max(t, (left[i - 1] as number) + prev.c + separation(prev, item, isDown)))
  })
  const right: number[] = new Array<number>(layer.length)
  for (let i = layer.length - 1; i >= 0; i--) {
    const item = layer[i] as Item
    const next = layer[i + 1]
    const t = target.get(item) as number
    right[i] = next === undefined ? t : Math.min(t, (right[i + 1] as number) - item.c - separation(item, next, isDown))
  }
  layer.forEach((item, i) => {
    item.pos = Math.floor(((left[i] as number) + (right[i] as number)) / 2)
  })
}

function position(layers: Item[][], graph: Graph, isDown: boolean): void {
  for (const layer of layers) {
    let at = 0
    for (const item of layer) {
      item.pos = at
      at += item.c + separation(item, item, isDown)
    }
  }
  for (let pass = 0; pass < 8; pass++) {
    const down = pass % 2 === 0
    const order = down ? layers.map((_, l) => l).slice(1) : layers.map((_, l) => l).slice(0, -1).reverse()
    for (const l of order) {
      const layer = layers[l] as Item[]
      const target = new Map<Item, number>()
      for (const item of layer) {
        const near = ((down ? graph.preds.get(item) : graph.succs.get(item)) ?? []).map(centre)
        const wanted = near.length === 0 ? item.pos : Math.round(near.reduce((a, b) => a + b, 0) / near.length) - Math.floor(item.c / 2)
        target.set(item, wanted)
      }
      settle(layer, target, isDown)
    }
  }
  const low = Math.min(...layers.flat().map(item => item.pos))
  for (const item of layers.flat()) item.pos -= low
}

// ---- lines in the gaps between ranks -----------------------------------------------------------------------------

/** Whether two segments of one gap may share a row: those that meet at a source or a target merge on purpose. */
function clash(a: Seg, b: Seg): boolean {
  if (a.from === b.from || a.to === b.to) return false
  const aLo = Math.min(centre(a.from), centre(a.to))
  const aHi = Math.max(centre(a.from), centre(a.to))
  const bLo = Math.min(centre(b.from), centre(b.to))
  const bHi = Math.max(centre(b.from), centre(b.to))

  return aLo <= bHi + 1 && bLo <= aHi + 1
}

/** Gives each bent segment of a gap a row so unrelated lines never run into each other; returns the rows used. */
function assignRows(gap: Seg[]): number {
  const bent = gap
    .filter(s => centre(s.from) !== centre(s.to))
    .sort((a, b) => Math.min(centre(a.from), centre(a.to)) - Math.min(centre(b.from), centre(b.to)) || centre(a.from) - centre(b.from))
  const placed: Seg[] = []
  for (const s of bent) {
    let row = 0
    const fits = (r: number): boolean =>
      placed.every(p => {
        if (p.row === r && clash(p, s)) return false
        // A stem must end above the row where another line's last leg starts in the same column, or they would read as one line.
        if (centre(s.from) === centre(p.to) && !(r < p.row)) return false
        if (centre(s.to) === centre(p.from) && !(p.row < r)) return false

        return true
      })
    while (row < TOP_ROWS && !fits(row)) row++
    s.row = row
    placed.push(s)
  }

  return placed.reduce((max, s) => Math.max(max, s.row + 1), 0)
}

type Gap = { segs: Seg[]; channels: number; labelRows: number; size: number }

const anchorOf = (s: Seg): Item => (s.anchor === 'from' ? s.from : s.to)

function gapOf(segs: Seg[], isDown: boolean): Gap {
  const channels = assignRows(segs)
  const labelled = segs.filter(s => s.first && labelOf(s.edge) !== '')
  // Top-down: as many rows as labels share one line; left-to-right: wide enough for the longest label.
  const sharing = new Map<Item, number>()
  for (const s of labelled) sharing.set(anchorOf(s), (sharing.get(anchorOf(s)) ?? 0) + 1)
  const labelRows = labelled.length === 0 ? 0 : isDown ? Math.max(...sharing.values()) : Math.max(...labelled.map(s => labelOf(s.edge).length)) + 1

  return { segs, channels, labelRows, size: 1 + channels + labelRows + 1 }
}

// ---- drawing ---------------------------------------------------------------------------------------------------

const CORNERS = {
  rect: ['┌', '┐', '┘', '└'],
  round: ['╭', '╮', '╯', '╰'],
  diamond: ['╱', '╲', '╱', '╲'],
} as const

function drawBox(canvas: Canvas, item: Item, x: number, y: number, isDown: boolean): void {
  const node = item.node as FlowNode
  const w = isDown ? item.c : item.p
  const h = isDown ? item.p : item.c
  canvas.box(x, y, w, h, CORNERS[node.shape])
  const inner = w - 4
  item.rows.forEach((row, j) => {
    const left = Math.floor((inner - row.length) / 2)
    canvas.text(x + 2 + left, y + 1 + j, row)
  })
  if (node.shape === 'diamond') {
    const mid = y + Math.floor(h / 2)
    canvas.put(x, mid, '<')
    canvas.put(x + w - 1, mid, '>')
  }
}

type Drawing = { lines: string[]; unplaced: FlowEdge[] }

/** Where everything sits along the flow, and how to draw in the flow's own terms (down for TD, right for LR). */
type Frame = {
  isDown: boolean
  canvas: Canvas
  /** First coordinate along the flow of each rank, and the size of each rank. */
  start: number[]
  size: number[]
}

const gapStartOf = (frame: Frame, layer: number): number => (frame.start[layer] as number) + (frame.size[layer] as number)

function alongLine(frame: Frame, c: number, p1: number, p2: number, style: LineStyle): void {
  if (frame.isDown) frame.canvas.vline(c, p1, p2, style)
  else frame.canvas.hline(p1, p2, c, style)
}

function acrossLine(frame: Frame, p: number, c1: number, c2: number, style: LineStyle): void {
  if (frame.isDown) frame.canvas.hline(c1, c2, p, style)
  else frame.canvas.vline(p, c1, c2, style)
}

function putAt(frame: Frame, p: number, c: number, ch: string): void {
  if (frame.isDown) frame.canvas.put(c, p, ch)
  else frame.canvas.put(p, c, ch)
}

/** One piece of an edge between two neighbouring ranks: out of the source, across in its row of the gap, into the target. */
function drawSegment(frame: Frame, s: Seg, gap: Gap): void {
  const l = s.from.layer
  const gapStart = gapStartOf(frame, l)
  const arrowAt = gapStart + gap.size - 1
  const fromEnd = s.from.real ? (frame.start[l] as number) + s.from.p - 1 : gapStart - 1
  const xs = centre(s.from)
  const xt = centre(s.to)
  const style = s.edge.style
  // The last leg always reaches the arrow's cell (an arrow drawn there replaces the line), so a bend gets its downward stroke.
  if (xs === xt) alongLine(frame, xs, fromEnd, arrowAt, style)
  else {
    const turn = gapStart + 1 + s.row
    alongLine(frame, xs, fromEnd, turn, style)
    acrossLine(frame, turn, xs, xt, style)
    alongLine(frame, xt, turn, arrowAt, style)
  }
  if (s.from.real) putAt(frame, fromEnd, xs, frame.isDown ? '┬' : '├')
  if (s.last && s.edge.head) putAt(frame, arrowAt, xt, frame.isDown ? '▼' : '►')
  if (s.first && s.edge.both && s.from.real) putAt(frame, gapStart, xs, frame.isDown ? '▲' : '◄')
}

/** Writes the label at `x` on the first of `rows` where it and one free cell either side fit; false when none does. */
function writeLabel(canvas: Canvas, label: string, x: number, rows: number[]): boolean {
  for (const row of rows) {
    if (canvas.isFree(x - 1, row, label.length + 2)) return (canvas.text(x, row, label), true)
  }

  return false
}

/** Writes an edge's label where it has room, one free cell around it; false when there is none. */
function placeLabel(frame: Frame, s: Seg, gap: Gap): boolean {
  const { canvas } = frame
  const label = labelOf(s.edge)
  const gapStart = gapStartOf(frame, s.from.layer)
  const xs = centre(s.from)
  const xt = centre(s.to)
  const arrowAt = gapStart + gap.size - 1
  if (!frame.isDown) {
    // Left to right: just before the arrow, on the row above or below the line.
    return writeLabel(canvas, label, arrowAt - label.length, [xt - 1, xt + 1])
  }
  const turn = gapStart + 1 + s.row
  const isStraight = xs === xt
  // By the target: beside the last leg, nearest the arrow first. By the source: beside its stem, nearest the box first.
  const legRows = Array.from({ length: arrowAt - (isStraight ? gapStart : turn) }, (_, k) => arrowAt - 1 - k)
  const stemRows = Array.from({ length: (isStraight ? arrowAt : turn) - gapStart }, (_, k) => gapStart + k)
  const spots: [number, number[]][] = [[xt, [...legRows, arrowAt]], [xs, stemRows]]
  if (s.anchor === 'from') spots.reverse()
  // Right of the line first, then left of it.
  return spots.some(([x, rows]) => writeLabel(canvas, label, x + 2, rows) || writeLabel(canvas, label, x - label.length - 1, rows))
}

function drawLayout(flow: Flow, graph: Graph, layers: Item[][]): Drawing {
  const isDown = flow.direction === 'TD'
  const size = layers.map(layer => Math.max(1, ...layer.filter(i => i.real).map(i => i.p)))
  const gaps = layers.slice(0, -1).map((_, l) => gapOf(graph.segs.filter(s => s.from.layer === l), isDown))
  const start: number[] = []
  layers.forEach((_, l) => start.push(l === 0 ? 0 : (start[l - 1] as number) + (size[l - 1] as number) + (gaps[l - 1] as Gap).size))
  const along = (start[start.length - 1] as number) + (size[size.length - 1] as number)
  const across = Math.max(...layers.flat().map(i => i.pos + i.c + i.room))
  const frame: Frame = { isDown, canvas: isDown ? new Canvas(across, along) : new Canvas(along, across), start, size }

  layers.forEach((layer, l) => {
    const p = start[l] as number
    for (const item of layer) {
      if (item.real) drawBox(frame.canvas, item, isDown ? item.pos : p, isDown ? p : item.pos, isDown)
      else alongLine(frame, centre(item), p, p + (size[l] as number) - 1, (item.edge as FlowEdge).style)
    }
  })
  for (const gap of gaps) for (const s of gap.segs) drawSegment(frame, s, gap)
  // Labels last, so they only take cells no line needs.
  const unplaced = gaps.flatMap(gap => gap.segs.filter(s => s.first && s.edge.label !== '' && !placeLabel(frame, s, gap)).map(s => s.edge))

  return { lines: frame.canvas.toLines(), unplaced }
}

function notesOf(flow: Flow, analysis: Analysis, unplaced: FlowEdge[], columns: number): string[] {
  const names = new Map(flow.nodes.map(n => [n.id, truncate(oneLine(n.text), 24)]))
  const name = (id: string): string => names.get(id) ?? id
  const lines = [
    ...analysis.loops.map(e => `↺ ${name(e.from)} → ${name(e.to)}${e.label === '' ? '' : ` · ${oneLine(e.label)}`}`),
    ...unplaced.map(e => `${name(e.from)} → ${name(e.to)} · ${oneLine(e.label)}`),
    ...flow.notes,
  ]

  return lines.length === 0 ? [] : ['', ...lines.map(line => truncate(line, columns))]
}

/** One try at every wrap width for a direction; undefined when none fits. */
function drawIn(flow: Flow, analysis: Analysis, columns: number): string[] | undefined {
  const isDown = flow.direction === 'TD'
  for (const textWidth of TEXT_WIDTHS) {
    const graph = buildGraph(flow, analysis, textWidth, isDown)
    if (graph.segs.length > MAX_SEGMENTS) throw new TooBig('too many connections')
    const layers = orderLayers(graph)
    position(layers, graph, isDown)
    const drawn = drawLayout(flow, graph, layers)
    if (widest(drawn.lines) <= columns) return [...drawn.lines, ...notesOf(flow, analysis, drawn.unplaced, columns)]
  }

  return undefined
}

/**
 * Draws a flowchart in at most `columns` columns. A left-to-right chart that is too wide even with the smallest
 * boxes is drawn top to bottom instead (and says so). Throws TooWide when nothing fits.
 */
export function drawFlow(flow: Flow, columns: number): string[] {
  const analysis = analyse(flow)
  const drawn = drawIn(flow, analysis, columns)
  if (drawn !== undefined) return drawn
  if (flow.direction === 'LR') {
    const down = drawIn({ ...flow, direction: 'TD' }, analysis, columns)
    if (down !== undefined) return [...down, ...(down.includes('') ? [] : ['']), truncate('Drawn top to bottom to fit', columns)]
  }
  throw new TooWide('no wrap width fits')
}
