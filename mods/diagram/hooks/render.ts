import { drawFlow } from './flow-draw'
import { parseFlow } from './flow-parse'
import { drawPie, parsePie } from './pie'
import { drawSequence, parseSequence } from './sequence'
import { TooBig, TooWide, clean, codeBox, truncate, wrapText } from './text'

/**
 * The whole drawing: Mermaid source in, rows of text out. It never throws. Whatever it cannot draw (an unknown kind,
 * a parse it does not trust, too many nodes, too wide for the pane) comes back as a headline and the source in a box.
 */

export type Drawing = {
  /** What was drawn ('Flowchart', ...); empty when the source is shown instead. */
  title: string
  lines: string[]
  isDrawn: boolean
}

export type DrawOptions = { maxNodes?: number }

/** The most nodes (or participants) drawn; a bigger diagram is shown as source. */
export const MAX_NODES = 25
/** The most edges drawn. */
const MAX_EDGES = 60
/** The most message, note and block lines of a sequence diagram. */
const MAX_STEPS = 150

function shown(headline: string, source: string, columns: number): Drawing {
  return { title: '', isDrawn: false, lines: [...wrapText(headline, columns), '', ...codeBox(source, columns)] }
}

/** The source without a leading `---` front-matter block, as lines. */
function bodyOf(source: string): string[] {
  const lines = source.split('\n')
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
    if (end > 0) return lines.slice(end + 1)
  }

  return lines
}

const isNoise = (line: string): boolean => line.trim() === '' || line.trim().startsWith('%%')

/** The first word of the header line ("flowchart", "classDiagram"), as typed, made printable. */
function kindOf(header: string): string {
  const word = /^[A-Za-z][\w-]*/.exec(header.trim())?.[0] ?? header.trim().split(/\s+/)[0] ?? ''

  return truncate(word.replace(/[^\x20-\x7e -￿]/g, ''), 24)
}

function draw(source: string, columns: number, maxNodes: number): Drawing {
  const lines = bodyOf(source)
  const at = lines.findIndex(line => !isNoise(line))
  if (at < 0) return { title: '', isDrawn: false, lines: ['Diagram · nothing to draw'] }
  const header = (lines[at] as string).trim()
  const body = lines.slice(at + 1)
  const kind = kindOf(header)
  const lower = kind.toLowerCase()

  if (lower === 'flowchart' || lower === 'graph' || lower === 'flowchart-elk') {
    const flow = parseFlow(header, body)
    if (flow.nodes.length > maxNodes) return shown(`Diagram · ${flow.nodes.length} nodes is more than the ${maxNodes} drawn here`, source, columns)

    if (flow.edges.length > MAX_EDGES) return shown(`Diagram · ${flow.edges.length} connections is more than the ${MAX_EDGES} drawn here`, source, columns)

    return { title: 'Flowchart', isDrawn: true, lines: drawFlow(flow, columns) }
  }
  if (lower === 'sequencediagram') {
    const seq = parseSequence(body)
    if (seq.names.length > maxNodes) return shown(`Diagram · ${seq.names.length} participants is more than the ${maxNodes} drawn here`, source, columns)
    if (seq.events.length > MAX_STEPS) return shown(`Diagram · ${seq.events.length} steps is more than the ${MAX_STEPS} drawn here`, source, columns)

    return { title: 'Sequence diagram', isDrawn: true, lines: drawSequence(seq, columns) }
  }
  if (lower === 'pie') return { title: 'Pie chart', isDrawn: true, lines: drawPie(parsePie(header, body), columns) }

  return shown(`Diagram · ${kind === '' ? 'this kind' : kind} is not drawn here`, source, columns)
}

/** Mermaid source to rows of at most `columns` characters. Never throws. */
export function drawDiagram(raw: string, columns: number, options: DrawOptions = {}): Drawing {
  const width = Number.isFinite(columns) ? Math.max(12, Math.floor(columns)) : 60
  const source = clean(typeof raw === 'string' ? raw : '').replace(/\s+$/, '')
  try {
    return draw(source, width, options.maxNodes ?? MAX_NODES)
  } catch (error) {
    const why = error instanceof TooWide ? 'too wide for this pane' : error instanceof TooBig ? 'too many connections to draw here' : 'could not be drawn'

    return shown(`Diagram · ${why}`, source, width)
  }
}
