// Per-model fit and cost: for a predicted tier, rate every candidate model, recommend the
// cheapest one rated at least "ok", and turn that into a verdict. Pure functions.
//
// Everything here is PREDICTED from keyword rules and ROUGH list-price ratios the person can edit.
// Nothing is measured: no real prices, no benchmark scores.
import type { Alias, Family } from './gate'
import { RANK } from './gate'
import type { Prediction, Tier } from './predict'

export type Rating = 'weak' | 'ok' | 'best'
export type Costs = Partial<Record<Family, number>>

export const CANDIDATES: readonly Alias[] = ['haiku', 'sonnet', 'opus']
export const DEFAULT_COSTS_TEXT = 'haiku=1,sonnet=20,opus=40'
const DEFAULT_COSTS: Costs = { haiku: 1, sonnet: 20, opus: 40 }

/** best = the most capable model; ok = predicted good enough; weak = likely to struggle. Review work is rated like deep work. */
const RATING: Record<Exclude<Tier, 'review'>, Record<Family, Rating>> = {
  light: { haiku: 'ok', sonnet: 'ok', opus: 'best', fable: 'best' },
  standard: { haiku: 'weak', sonnet: 'ok', opus: 'best', fable: 'best' },
  deep: { haiku: 'weak', sonnet: 'weak', opus: 'best', fable: 'best' },
}

export const ratingOf = (tier: Tier, family: Family): Rating => RATING[tier === 'review' ? 'deep' : tier][family]

export const nameOf = (f: Family): string => f.charAt(0).toUpperCase() + f.slice(1)

// ------------------------------------------------------------------------ cost config

const FAMILIES: readonly Family[] = ['haiku', 'sonnet', 'opus', 'fable']

/**
 * Parses "haiku=1,sonnet=20,opus=40" (fable optional; commas, semicolons or spaces; "3x" is fine).
 * Bad pieces are ignored, one by one, and reported in `problems`; a missing or bad model keeps its
 * default (fable has none: its cost is simply unknown).
 */
export function parseCosts(raw: unknown): { costs: Costs; problems: string[] } {
  const costs: Costs = { ...DEFAULT_COSTS }
  const problems: string[] = []
  if (typeof raw !== 'string' || raw.trim() === '') return { costs, problems }
  for (const piece of raw.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^([a-z]+)=(\d+(?:\.\d+)?)x?$/i.exec(piece)
    const family = FAMILIES.find(f => f === m?.[1]?.toLowerCase())
    const value = Number(m?.[2])
    if (m === null || family === undefined || !Number.isFinite(value) || value <= 0 || value > 10_000) {
      problems.push(piece.slice(0, 30))
      continue
    }
    costs[family] = value
  }
  return { costs, problems }
}

/** A model with no known cost (fable by default) counts as the most expensive. */
const costOf = (costs: Costs, f: Family): number => costs[f] ?? Number.POSITIVE_INFINITY

export function fmtRatio(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1).replace(/\.0$/, '')}x`
}

// ------------------------------------------------------------------ rating and choice

export type Row = { family: Family; rating: Rating; cost: number | undefined }

/** Haiku, Sonnet, Opus (and the current model if it is Fable), each with its predicted rating and cost. */
export function ratingTable(tier: Tier, current: Family | undefined, costs: Costs): Row[] {
  const families: Family[] = current === 'fable' ? [...CANDIDATES, 'fable'] : [...CANDIDATES]
  return families.map(family => ({ family, rating: ratingOf(tier, family), cost: costs[family] }))
}

export function tableText(rows: readonly Row[]): string {
  return rows.map(r => `${nameOf(r.family)}: ${r.rating}, ${r.cost === undefined ? 'cost not set' : fmtRatio(r.cost)}`).join('; ')
}

/** The cheapest candidate rated at least "ok" (ties go to the weaker model). Never fable. */
export function recommend(tier: Tier, costs: Costs): Alias {
  const fit = CANDIDATES.filter(a => ratingOf(tier, a) !== 'weak')
  return [...fit].sort((a, b) => costOf(costs, a) - costOf(costs, b) || RANK[a] - RANK[b])[0] ?? 'opus'
}

/** "~40x cheaper", or '' when it cannot be said (unknown cost, or not actually cheaper). */
export function cheaperBy(costs: Costs, from: Family, to: Family): string {
  const a = costOf(costs, from)
  const b = costOf(costs, to)
  return Number.isFinite(a) && b > 0 && a > b ? `~${fmtRatio(Math.round((a / b) * 10) / 10)} cheaper` : ''
}

// ------------------------------------------------------------------------- the verdict

export type Risk = 'under' | 'over'

export type Fit =
  | { kind: 'none'; why: string }
  /** The current model suits the task. */
  | { kind: 'fits' }
  /** Worth a word on the status line, never a dialog. */
  | { kind: 'hint'; recommended: Alias; why: 'borderline' | 'spare' }
  /**
   * A review-type task on a model that is strong enough: the point is that a DIFFERENT model reviews it,
   * not capability. Only a Codex offer makes sense; the caller turns this into `fits` when Codex is absent.
   */
  | { kind: 'review' }
  /** A mismatch: this is what may open the dialog. */
  | { kind: 'mismatch'; risk: Risk; recommended: Alias }

/** A standard task needs this much confidence before even a status-line hint is shown. */
export const STANDARD_MIN = 0.7

/**
 * `strict` turns the two standard-tier hints into mismatches (borderline = 'under', spare capacity = 'over'),
 * so ordinary tasks can block too. Off by default: a standard task is usually fine on Sonnet.
 */
export function judge(p: Prediction, current: Family | undefined, minConfidence: number, costs: Costs, strict = false): Fit {
  if (current === undefined) return { kind: 'none', why: 'current model not recognised' }
  const floor = p.tier === 'standard' ? Math.max(minConfidence, STANDARD_MIN) : minConfidence
  if (p.confidence < floor) return { kind: 'none', why: `confidence ${p.confidence.toFixed(2)} below ${floor.toFixed(2)}` }
  const recommended = recommend(p.tier, costs)
  const rating = ratingOf(p.tier, current)
  const isCheaper = costOf(costs, recommended) < costOf(costs, current)
  if (p.tier === 'deep' || p.tier === 'review') {
    if (rating === 'weak') return { kind: 'mismatch', risk: 'under', recommended }
    return p.tier === 'review' ? { kind: 'review' } : { kind: 'fits' }
  }
  if (p.tier === 'light') return isCheaper ? { kind: 'mismatch', risk: 'over', recommended } : { kind: 'fits' }
  if (rating === 'weak') return strict ? { kind: 'mismatch', risk: 'under', recommended } : { kind: 'hint', recommended, why: 'borderline' }
  if (!isCheaper) return { kind: 'fits' }
  return strict ? { kind: 'mismatch', risk: 'over', recommended } : { kind: 'hint', recommended, why: 'spare' }
}

// ------------------------------------------------------------------------- effort

/**
 * Effort-watch: a short note when the session's effort level does not match the task, or undefined. Advice only, on the status
 * line, never a dialog. On Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 changing effort keeps the prompt cache, so /effort is
 * a cheap move there; on older models it re-reads the conversation once. Anthropic's guidance is medium for most work, high or
 * xhigh when it matters, and max rarely (it "may show diminishing returns and is prone to overthinking").
 */
export function effortNote(tier: Tier, effort: unknown): string | undefined {
  if (typeof effort !== 'string') return undefined
  const level = effort.toLowerCase()
  if (level === 'max' && (tier === 'light' || tier === 'standard')) return 'effort max is more than this needs · /effort medium'
  if (level === 'xhigh' && tier === 'light') return 'effort xhigh is more than this needs · /effort medium'
  if (level === 'low' && (tier === 'deep' || tier === 'review')) return 'effort low may be too little for this · /effort high'
  return undefined
}

/** The same check as a few words for the moddeck's model row ("medium would do", "try high"), or undefined when the effort fits. */
export function effortAdvice(tier: Tier, effort: unknown): string | undefined {
  const note = effortNote(tier, effort)
  return note === undefined ? undefined : note.includes('/effort high') ? 'try high' : 'medium would do'
}

// ------------------------------------------------------------------------- status line

/** The always-on one-liner. Undefined clears the line (nothing placed, or the model is not recognised). */
export function statusText(fit: Fit, current: Family | undefined, costs: Costs): string | undefined {
  if (current === undefined || fit.kind === 'none') return undefined
  const me = nameOf(current)
  if (fit.kind === 'fits') return `suggest-model: ${me} fits`
  if (fit.kind === 'review') return 'suggest-model: review, Codex available'
  const rec = nameOf(fit.recommended)
  if (fit.kind === 'hint') {
    if (fit.why === 'borderline') return `suggest-model: ${me} is borderline for this, ${rec} is safer`
    const by = cheaperBy(costs, current, fit.recommended)
    return `suggest-model: ${rec} would do${by ? ` (${by})` : ''}`
  }
  if (fit.risk === 'under') return `suggest-model: weak for this, use ${rec}`
  const by = cheaperBy(costs, current, fit.recommended)
  return `suggest-model: overkill, ${rec} would do${by ? ` (${by})` : ''}`
}
