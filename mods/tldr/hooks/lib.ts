// tldr: pure helpers. The prompt to the small model, reading its answer, and marking the must-read sentences in a reply.
import type { TldrDigest } from '../types'

export const MAX_MARKS = 40 // sentences kept for marking, across recent replies
export const MAX_REPLY_CHARS = 24_000 // what the small model is shown of a very long reply
export const MARK = '⚑'
/**
 * The tint behind a paragraph that holds a must-read sentence, in the app. The colours are the ones of the highlighter
 * sample (estimated by eye from the screenshot); green is the default. As #RRGGBBAA, at 30% opacity.
 */
export const HIGHLIGHT_COLORS = {
  red: '#FF5C5C4D',
  yellow: '#FFE0664D',
  olive: '#A8A82A4D',
  green: '#66BB6A4D',
  blue: '#6F7CFF4D',
  purple: '#9C6BD64D',
  plum: '#5C1F5C4D',
} as const
export type HighlightColor = keyof typeof HIGHLIGHT_COLORS
export const HIGHLIGHT_DEFAULT: HighlightColor = 'green'
export const HIGHLIGHT = HIGHLIGHT_COLORS[HIGHLIGHT_DEFAULT]
export const isHighlightColor = (v: unknown): v is HighlightColor => typeof v === 'string' && v in HIGHLIGHT_COLORS

export const SYSTEM = [
  'You help a busy reader skim a coding assistant\'s reply.',
  'Answer with JSON only: {"summary": string, "needs": string[], "next": string[], "mustRead": string[]}.',
  'summary: two or three plain sentences on what was done or found.',
  'needs: decisions, questions, warnings or failures that need the reader (empty if none). Short, concrete.',
  'next: what happens next or what the reader should do (at most 3).',
  'mustRead: at most 5 sentences the reader must not skip, COPIED WORD FOR WORD from the reply (a question asked of them, a decision made for them, a warning, a failure, a required action, a number they need). No paraphrase.',
].join('\n')

export const promptFor = (reply: string): string =>
  `The reply:\n\n${reply.length > MAX_REPLY_CHARS ? `${reply.slice(0, MAX_REPLY_CHARS)}\n[cut]` : reply}`

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()).slice(0, max) : []

/** The model's JSON (it may wrap it in a fence); mustRead keeps only sentences found in the reply as written. */
export function parseDigest(raw: string, reply: string): TldrDigest | undefined {
  const body = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  let v: Record<string, unknown>
  try {
    v = JSON.parse(body) as Record<string, unknown>
  } catch {
    return undefined
  }
  const summary = typeof v.summary === 'string' ? v.summary.trim() : ''
  if (summary === '') return undefined
  const mustRead = strings(v.mustRead, 5)
    .map(s => s.replace(/^[-*>\s]+/, '').replace(/\*\*/g, ''))
    .filter(s => s.length >= 12 && reply.includes(s))
  return { summary, needs: strings(v.needs, 5), next: strings(v.next, 3), mustRead }
}

/** Newest first, no repeats, at most MAX_MARKS. */
export const addMarks = (list: readonly string[], fresh: readonly string[]): string[] =>
  [...fresh, ...list.filter(s => !fresh.includes(s))].slice(0, MAX_MARKS)

/**
 * The block's markdown with each must-read sentence bolded. A sentence inside a code fence or inline code is
 * left alone, so code stays exact; so is one already bold. Undefined when nothing changes.
 */
export function markText(text: string, marks: readonly string[]): string | undefined {
  if (marks.length === 0) return undefined
  let out = text
  let changed = false
  for (const m of marks) {
    let from = 0
    for (;;) {
      const at = out.indexOf(m, from)
      if (at < 0) break
      const isMarked = out.slice(Math.max(0, at - 2), at) === '**'
      if (isInCode(out, at) || isMarked) {
        from = at + m.length
        continue
      }
      const wrapped = `**${m}**`
      out = out.slice(0, at) + wrapped + out.slice(at + m.length)
      from = at + wrapped.length
      changed = true
    }
  }
  return changed ? out : undefined
}

/** Inside a ``` fence or a `span` on its line. */
function isInCode(text: string, at: number): boolean {
  const before = text.slice(0, at)
  if ((before.match(/^```/gm) ?? []).length % 2 === 1) return true
  const line = before.slice(before.lastIndexOf('\n') + 1)
  return (line.match(/`/g) ?? []).length % 2 === 1
}

/** The reply cut at blank lines into paragraphs, never inside a ``` fence, so each can be drawn (and tinted) on its own. */
export function splitBlocks(text: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence
    if (!inFence && line.trim() === '' && cur.length > 0) {
      out.push(cur.join('\n'))
      cur = []
      continue
    }
    if (!(line.trim() === '' && cur.length === 0)) cur.push(line)
  }
  if (cur.length > 0) out.push(cur.join('\n'))
  return out
}
