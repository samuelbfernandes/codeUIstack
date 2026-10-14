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
  /** The current model's prompt cache is probably still warm: a switch would throw it away and re-cache the context. */
  isCacheWarm: boolean
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
  // Mid-session, a switch re-caches the whole conversation on the new model (and again on the way back), which costs more
  // than a cheaper model saves on a task or two. So for an overkill task with a warm cache and a big context the move is
  // a subagent (a fresh, small context) or nothing; a switch is offered when the cache is cold or the context small.
  const isCostlySwitch = isBig && d.isCacheWarm
  const noSwitch = isCostlySwitch && d.risk === 'over'
  // The ask dialog takes at most 4 options, so a review trades the subagent for Codex.
  const move: Choice[] =
    d.target === undefined ? ['codex'] : isReview ? (noSwitch ? ['codex'] : ['switch', 'codex']) : noSwitch ? ['subagent'] : isBig && d.canSubagent ? ['subagent', 'switch'] : ['switch', 'subagent']
  const order = ['keep' as const, ...move.filter(c => available(c, d)), 'mute' as const]
  return { question: questionText(d, isBig, noSwitch), labels, order }
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

function questionText(d: DialogInput, isBig: boolean, noSwitch: boolean): string {
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
  if (noSwitch) notes.push(`Not switching: the session would re-cache ~${fmtTokens(d.contextTokens)} tokens on ${target}, more than this task saves. A subagent starts fresh. Switch at a natural break (after /clear, or once the cache has gone cold).`)
  else if (isBig && d.isCacheWarm) notes.push(`Switching re-caches ~${fmtTokens(d.contextTokens)} tokens on ${target} (and again on the way back); a subagent starts fresh.`)
  else if (isBig) notes.push(`The cache has gone cold, so switching now costs little extra; a subagent starts fresh.`)
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

/** True when the dialog offers nothing but keeping the model: not worth asking. */
export const isKeepOnly = (dialog: Dialog): boolean => dialog.order.every(c => c === 'keep' || c === 'mute')

/** Maps the exact label the person chose back to a choice; anything else (free text under Other) is undefined. */
export function choiceOf(dialog: Dialog, answer: string): Choice | undefined {
  return dialog.order.find(c => dialog.labels[c] === answer)
}
