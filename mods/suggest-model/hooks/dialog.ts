// The question and its options. Pure text, so the dialog is the same on every surface
// (the engine draws `$.ui.ask` itself).
import { fmtRatio, nameOf } from './fit'
import type { Risk, Row } from './fit'
import { BIG_CONTEXT_TOKENS, fmtTokens } from './gate'
import type { Alias, Family } from './gate'
import { TIER_WORD } from './predict'
import type { Prediction } from './predict'

export type DialogInput = {
  prediction: Prediction
  current: Family
  /** 'self': a review by the model that would also have written the code; no model move is offered. */
  risk: Risk | 'self'
  /** The model to move to: the cheapest one predicted to handle the task. Absent for 'self'. */
  target?: Alias
  /** Per-model fit and rough relative cost, as shown in the question. */
  table: readonly Row[]
  /** "~40x cheaper" or ''. */
  cheaper: string
  contextTokens: number
  canSubagent: boolean
  /** Codex is offered (review work and `codex --version` worked). */
  hasCodex: boolean
}

export type Choice = 'keep' | 'switch' | 'subagent' | 'codex' | 'mute'
export type Dialog = { question: string; labels: Record<Choice, string>; order: Choice[] }

export function buildDialog(d: DialogInput): Dialog {
  const me = nameOf(d.current)
  const to = d.target === undefined ? '' : nameOf(d.target)
  const labels: Record<Choice, string> = {
    keep: `Keep ${me}`,
    switch: `Switch session to ${to}`,
    subagent: `Run this task as a subagent on ${to}`,
    codex: 'Ask Codex for a read-only review',
    mute: `Keep ${me} and don't suggest again this session`,
  }
  const isBig = d.contextTokens > BIG_CONTEXT_TOKENS
  const isReview = d.prediction.tier === 'review'
  // The ask dialog takes at most 4 options, so a review trades the subagent for Codex.
  const move: Choice[] = d.target === undefined ? ['codex'] : isReview ? ['switch', 'codex'] : isBig && d.canSubagent ? ['subagent', 'switch'] : ['switch', 'subagent']
  const order = ['keep' as const, ...move.filter(c => available(c, d)), 'mute' as const]
  return { question: questionText(d, isBig), labels, order }
}

function available(c: Choice, d: DialogInput): boolean {
  if (c === 'subagent') return d.canSubagent
  if (c === 'codex') return d.hasCodex
  return true
}

const taskWord = (p: Prediction): string => `${TIER_WORD[p.tier].charAt(0)}${TIER_WORD[p.tier].slice(1).toLowerCase()} task`

/** "Haiku 1x weak · Sonnet 20x weak · Opus 40x best": one quiet line instead of a sentence. */
export function compactTable(rows: readonly Row[]): string {
  return rows.map(r => `${nameOf(r.family)} ${r.cost === undefined ? '' : `${fmtRatio(r.cost)} `}${r.rating}`).join(' · ')
}

function questionText(d: DialogInput, isBig: boolean): string {
  const { prediction: p, current } = d
  const me = nameOf(current)
  if (d.risk === 'self' || d.target === undefined) return selfReviewText(d, me)
  const target = nameOf(d.target)
  const why = p.reasons.slice(0, 3).join(', ')
  const lines = [
    d.risk === 'under' ? `Don't use ${me} for this task` : `${me} is overkill for this`,
    `${taskWord(p)} · ${why}`,
    compactTable(d.table),
    d.risk === 'under'
      ? `${target} is the cheapest model that should handle it. Costlier and slower.`
      : `${target} would do${d.cheaper ? ` · ${d.cheaper}` : ''}.`,
  ]
  const notes: string[] = []
  if (isBig) notes.push(`Switching re-reads ~${fmtTokens(d.contextTokens)} tokens uncached; a subagent starts fresh.`)
  else if (d.canSubagent && p.tier !== 'review') notes.push('A subagent has no memory of this chat.')
  if (d.hasCodex) notes.push('Codex reviews read-only and uses Codex credit.')
  return [...lines, ...(notes.length > 0 ? ['', ...notes] : [])].join('\n')
}

function selfReviewText(d: DialogInput, me: string): string {
  return [
    `Get a second opinion on this`,
    `Review · ${d.prediction.reasons.slice(0, 3).join(', ')}`,
    `A different model (Codex) catches more than ${me} reviewing its own work.`,
    '',
    'Read-only · uses Codex credit.',
  ].join('\n')
}

/** Maps the exact label the person chose back to a choice; anything else (free text under Other) is undefined. */
export function choiceOf(dialog: Dialog, answer: string): Choice | undefined {
  return dialog.order.find(c => dialog.labels[c] === answer)
}
