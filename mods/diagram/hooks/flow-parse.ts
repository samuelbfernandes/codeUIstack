import type { LineStyle } from './canvas'

/** Parsing the small, common part of Mermaid's flowchart syntax. Anything it does not understand throws, and the caller shows the source. */

export type Shape = 'rect' | 'round' | 'diamond'
export type FlowNode = { id: string; text: string; shape: Shape }
export type FlowEdge = {
  from: string
  to: string
  label: string
  style: LineStyle
  /** An arrowhead at the `to` end. */
  head: boolean
  /** An arrowhead at the `from` end too (`<-->`). */
  both: boolean
}
export type Flow = {
  direction: 'TD' | 'LR'
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** Things that were left out or simplified, one short line each. */
  notes: string[]
}

/** Lines that only style or annotate; the drawing ignores them. */
const IGNORED = /^(classDef|class|style|linkStyle|click|accTitle|accDescr|direction)\b/
const ID = /^[A-Za-z0-9_\u00c0-\uffff]+/
/** Openers with their closers and the shape they draw; the longer openers come first. */
const SHAPES: readonly (readonly [string, string, Shape])[] = [
  ['((', '))', 'round'],
  ['([', '])', 'round'],
  ['[[', ']]', 'rect'],
  ['[(', ')]', 'rect'],
  ['{{', '}}', 'round'],
  ['[', ']', 'rect'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
]
const DOTTED = /^(<)?-\.+->?/
const THICK = /^(<)?={2,}>?/
const SOLID_HEAD = /^(<)?-{2,}>/
const SOLID_END = /^(<)?-{2,}[xo](?=[\s|]|$)/
const SOLID_OPEN = /^(<)?-{3,}/
/** The older spelling with the text inside the arrow: `A -- text --> B`. */
const INLINE_LABEL = /^(--|==|-\.)\s+(.+?)\s+(-{2,}>|-{3,}|={2,}>|={3,}|\.+->|\.+-)(?=\s|$)/

/** The statements of a line: split at ";" that is outside quotes and brackets; a `%%` comment is cut off. */
export function statementsOf(line: string): string[] {
  const out: string[] = []
  let current = ''
  let depth = 0
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i)
    if (!quoted && ch === '%' && line.charAt(i + 1) === '%') break
    if (ch === '"') quoted = !quoted
    if (!quoted && (ch === '[' || ch === '(' || ch === '{')) depth++
    if (!quoted && (ch === ']' || ch === ')' || ch === '}')) depth = Math.max(0, depth - 1)
    if (ch === ';' && !quoted && depth === 0) {
      out.push(current)
      current = ''
    } else current += ch
  }
  out.push(current)

  return out.map(s => s.trim()).filter(s => s !== '')
}

/** A node's text without quotes, backticks or line-break tags. */
function nodeText(raw: string): string {
  let text = raw.trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1)
  if (text.length >= 2 && text.startsWith('`') && text.endsWith('`')) text = text.slice(1, -1)

  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()
}

/** The index of `closer` in `s` from `from`, skipping quoted stretches; -1 when there is none. */
function findCloser(s: string, closer: string, from: number): number {
  let quoted = false
  for (let i = from; i < s.length; i++) {
    if (s.charAt(i) === '"') quoted = !quoted
    else if (!quoted && s.startsWith(closer, i)) return i
  }

  return -1
}

type Parsed<T> = { value: T; next: number }

function parseNodeRef(s: string, start: number): Parsed<{ id: string; text?: string; shape?: Shape }> {
  const rest = s.slice(start)
  const m = ID.exec(rest)
  if (m === null) throw new Error(`no node at "${rest.slice(0, 12)}"`)
  const id = m[0]
  let i = start + id.length
  for (const [open, close, shape] of SHAPES) {
    if (!s.startsWith(open, i)) continue
    const end = findCloser(s, close, i + open.length)
    if (end < 0) throw new Error(`unclosed ${open}`)
    const text = nodeText(s.slice(i + open.length, end))

    return { value: { id, text: text === '' ? id : text, shape }, next: skipClass(s, end + close.length) }
  }
  i = skipClass(s, i)

  return { value: { id }, next: i }
}

/** `A:::someClass` styles a node; the class is dropped. */
function skipClass(s: string, i: number): number {
  const m = /^:::[A-Za-z0-9_-]+/.exec(s.slice(i))

  return m === null ? i : i + m[0].length
}

function skipSpaces(s: string, i: number): number {
  let j = i
  while (j < s.length && /\s/.test(s.charAt(j))) j++

  return j
}

/** `A & B` : the nodes of one side of an arrow. */
function parseGroup(s: string, start: number): Parsed<{ id: string; text?: string; shape?: Shape }[]> {
  const group: { id: string; text?: string; shape?: Shape }[] = []
  let i = start
  for (;;) {
    const ref = parseNodeRef(s, skipSpaces(s, i))
    group.push(ref.value)
    i = skipSpaces(s, ref.next)
    if (s.charAt(i) !== '&') return { value: group, next: i }
    i++
  }
}

type Link = Omit<FlowEdge, 'from' | 'to'>

function linkOf(op: string, label: string): Link {
  const style: LineStyle = op.includes('=') ? 'thick' : op.includes('.') ? 'dotted' : 'solid'
  const head = op.endsWith('>') || op.endsWith('x') || op.endsWith('o')

  return { label, style, head, both: op.startsWith('<') }
}

function parseLink(s: string, start: number): Parsed<Link> {
  const rest = s.slice(start)
  const inline = INLINE_LABEL.exec(rest)
  if (inline !== null) {
    const op = inline[3] ?? ''

    return { value: linkOf(op, (inline[2] ?? '').trim()), next: start + inline[0].length }
  }
  const m = DOTTED.exec(rest) ?? THICK.exec(rest) ?? SOLID_HEAD.exec(rest) ?? SOLID_END.exec(rest) ?? SOLID_OPEN.exec(rest)
  if (m === null) throw new Error(`no arrow at "${rest.slice(0, 12)}"`)
  let i = start + m[0].length
  let label = ''
  const piped = /^\s*\|([^|]*)\|/.exec(s.slice(i))
  if (piped !== null) {
    label = nodeText(piped[1] ?? '')
    i += piped[0].length
  }

  return { value: linkOf(m[0], label), next: i }
}

class Builder {
  readonly nodes = new Map<string, FlowNode>()
  readonly edges: FlowEdge[] = []

  node(ref: { id: string; text?: string; shape?: Shape }): void {
    const known = this.nodes.get(ref.id)
    if (known === undefined) this.nodes.set(ref.id, { id: ref.id, text: ref.text ?? ref.id, shape: ref.shape ?? 'rect' })
    else if (ref.shape !== undefined) {
      known.text = ref.text ?? known.text
      known.shape = ref.shape
    }
  }

  edge(from: string, to: string, link: Link): void {
    const dup = this.edges.some(e => e.from === from && e.to === to && e.label === link.label && e.style === link.style)
    if (!dup) this.edges.push({ from, to, ...link })
  }
}

function parseStatement(stmt: string, out: Builder, notes: Set<string>): void {
  if (IGNORED.test(stmt)) return
  if (/^subgraph\b/.test(stmt)) {
    notes.add('Subgraphs are drawn flat')

    return
  }
  if (/^end$/.test(stmt)) return
  let { value: previous, next: i } = parseGroup(stmt, 0)
  previous.forEach(ref => out.node(ref))
  for (;;) {
    i = skipSpaces(stmt, i)
    if (i >= stmt.length) return
    const link = parseLink(stmt, i)
    const group = parseGroup(stmt, link.next)
    group.value.forEach(ref => out.node(ref))
    for (const from of previous) for (const to of group.value) out.edge(from.id, to.id, link.value)
    previous = group.value
    i = group.next
  }
}

/** Parses the lines after a `flowchart` / `graph` header line. Throws on anything it cannot read. */
export function parseFlow(headerLine: string, body: readonly string[]): Flow {
  const dir = /^(?:flowchart|graph)(?:-elk)?\s+(TB|TD|BT|LR|RL)\b/i.exec(headerLine.trim())?.[1]?.toUpperCase()
  const out = new Builder()
  const notes = new Set<string>()
  // Statements may follow the header on its own line (`graph TD; A --> B`).
  const afterHeader = headerLine.trim().replace(/^(?:flowchart|graph)(?:-elk)?(?:\s+(?:TB|TD|BT|LR|RL)\b)?/i, '')
  for (const line of [afterHeader, ...body]) for (const stmt of statementsOf(line)) parseStatement(stmt, out, notes)
  if (out.nodes.size === 0) throw new Error('no nodes')
  if (dir === 'BT' || dir === 'RL') notes.add(`${dir} is drawn as ${dir === 'BT' ? 'TD' : 'LR'}`)

  return {
    direction: dir === 'LR' || dir === 'RL' ? 'LR' : 'TD',
    nodes: [...out.nodes.values()],
    edges: out.edges,
    notes: [...notes],
  }
}
