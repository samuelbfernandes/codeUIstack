// Pure helpers: what a tool row says (icon, name, argument summary, timing)
// and how an Edit/Write result becomes a unified diff. Nothing here touches `$`.

import type { Palette } from './themes'

export type Tone = keyof Palette

type Look = { icon: string; tone: Tone }

const LOOKS: Record<string, Look> = {
  Bash: { icon: '❯', tone: 'yellow' },
  Read: { icon: '≡', tone: 'blue' },
  Edit: { icon: '✎', tone: 'green' },
  Write: { icon: '✚', tone: 'green' },
  NotebookEdit: { icon: '✎', tone: 'green' },
  Grep: { icon: '⊙', tone: 'magenta' },
  Glob: { icon: '✱', tone: 'magenta' },
  Agent: { icon: '◆', tone: 'accent' },
  WebFetch: { icon: '⇣', tone: 'cyan' },
  WebSearch: { icon: '⊕', tone: 'cyan' },
  TodoWrite: { icon: '☐', tone: 'blue' },
}
const MCP_LOOK: Look = { icon: '⬡', tone: 'cyan' }
const FALLBACK_LOOK: Look = { icon: '•', tone: 'fg' }

export function lookOf(tool: string): Look {
  return LOOKS[tool] ?? (tool.startsWith('mcp__') ? MCP_LOOK : FALLBACK_LOOK)
}

/** `mcp__server__tool` reads as `server:tool`; built-in names stay as they are. */
export function displayName(tool: string): string {
  const parts = tool.split('__')
  return tool.startsWith('mcp__') && parts.length >= 3 ? `${parts[1]}:${parts.slice(2).join('__')}` : tool
}

/** Text children and `Code` sources allow tab and newline only; drop other control characters. */
export function clean(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

function oneLine(text: string, max: number): string {
  const flat = clean(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Keeps the tail of a long path, the part that tells files apart. */
function shortPath(path: string, max: number): string {
  const flat = clean(path)
  return flat.length > max ? `…${flat.slice(flat.length - max + 1)}` : flat
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** A short, dim description of the call's arguments; empty when nothing fits. */
export function summarize(tool: string, input: unknown, max = 90): string {
  const i = asRecord(input) ?? {}
  switch (tool) {
    case 'Bash':
      return oneLine(str(i.command) ?? str(i.description) ?? '', max)
    case 'Read': {
      const range = typeof i.offset === 'number' ? ` :${i.offset}${typeof i.limit === 'number' ? `+${i.limit}` : ''}` : ''
      return shortPath(str(i.file_path) ?? '', max - range.length) + range
    }
    case 'Edit':
    case 'Write':
      return shortPath(str(i.file_path) ?? '', max)
    case 'NotebookEdit':
      return shortPath(str(i.notebook_path) ?? '', max)
    case 'Grep':
    case 'Glob': {
      const where = str(i.path) ?? str(i.glob)
      return oneLine(`${str(i.pattern) ?? ''}${where ? ` in ${where}` : ''}`, max)
    }
    case 'Agent':
      return oneLine(`${str(i.description) ?? ''}${str(i.subagent_type) ? ` (${str(i.subagent_type)})` : ''}`, max)
    case 'WebFetch':
      return oneLine(str(i.url) ?? '', max)
    case 'WebSearch':
      return oneLine(str(i.query) ?? '', max)
    default: {
      // Unknown or MCP tool: the first plain string argument is usually the subject.
      const first = Object.values(i).find(v => typeof v === 'string' && v !== '')
      return typeof first === 'string' ? oneLine(first, max) : ''
    }
  }
}

/** The tool's own reported time, when its result carries one (WebFetch, Grep, Agent, ...). */
export function elapsedMs(output: unknown): number | undefined {
  const o = asRecord(output)
  const ms = o?.durationMs ?? o?.totalDurationMs
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : undefined
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

// ---- Edit / Write result -> diff card -------------------------------------

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

export type DiffCard = {
  filePath: string
  verb: string
  additions: number
  deletions: number
  /** Unified-diff hunks for `Code format="diff"`. */
  source: string
  /** Diff lines left out to keep the card short. */
  omitted: number
}

function isHunk(v: unknown): v is Hunk {
  const h = asRecord(v)
  return (
    h !== undefined &&
    typeof h.oldStart === 'number' && typeof h.oldLines === 'number' &&
    typeof h.newStart === 'number' && typeof h.newLines === 'number' &&
    Array.isArray(h.lines) && h.lines.every(l => typeof l === 'string')
  )
}

/** Engine lines carry their ` `, `+` or `-` marker; anything else is taken as context. */
const marked = (line: string): string => (/^[ +\-\\]/.test(line) ? line : ` ${line}`)

function hunkText(h: Hunk, lines: string[]): string {
  const isCut = lines.length < h.lines.length
  // A cut hunk's header counts must match the lines kept or the diff does not parse.
  const oldLines = isCut ? lines.filter(l => l[0] === ' ' || l[0] === '-').length : h.oldLines
  const newLines = isCut ? lines.filter(l => l[0] === ' ' || l[0] === '+').length : h.newLines
  return [`@@ -${h.oldStart},${oldLines} +${h.newStart},${newLines} @@`, ...lines].join('\n')
}

function fromPatch(patch: Hunk[], maxLines: number) {
  const texts: string[] = []
  let additions = 0, deletions = 0, shown = 0, omitted = 0
  for (const h of patch) {
    const all = h.lines.map(l => marked(clean(l)))
    additions += all.filter(l => l[0] === '+').length
    deletions += all.filter(l => l[0] === '-').length
    const room = maxLines - shown
    if (room <= 0) { omitted += all.length; continue }
    const kept = all.slice(0, room)
    texts.push(hunkText(h, kept))
    shown += kept.length
    omitted += all.length - kept.length
  }
  return { source: texts.join('\n'), additions, deletions, omitted }
}

function fromNewFile(content: string, maxLines: number) {
  const all = clean(content).split('\n')
  if (all.at(-1) === '') all.pop()
  const kept = all.slice(0, maxLines)
  const source = kept.length === 0 ? '' : [`@@ -0,0 +1,${kept.length} @@`, ...kept.map(l => `+${l}`)].join('\n')
  return { source, additions: all.length, deletions: 0, omitted: all.length - kept.length }
}

/**
 * Builds the card for a successful Edit or Write result, or undefined when
 * there is nothing sensible to show (error shape, staged write, no change),
 * in which case the caller leaves the engine's own drawing alone.
 */
export function diffCardOf(tool: string, output: unknown, maxLines = 40): DiffCard | undefined {
  const o = asRecord(output)
  if (!o || (tool !== 'Edit' && tool !== 'Write') || o.staged === true) return undefined
  const filePath = str(o.filePath)
  if (!filePath) return undefined

  const patch = Array.isArray(o.structuredPatch) ? o.structuredPatch.filter(isHunk) : []
  const isCreate = tool === 'Write' && o.type === 'create'

  let body
  if (patch.length > 0) body = fromPatch(patch, maxLines)
  else if (isCreate && typeof o.content === 'string') body = fromNewFile(o.content, maxLines)
  else return undefined
  if (body.source === '') return undefined

  const verb = isCreate ? 'Created' : tool === 'Write' ? 'Wrote' : o.replaceAll === true ? 'Edited all' : 'Edited'
  return { filePath: clean(filePath), verb, ...body }
}
