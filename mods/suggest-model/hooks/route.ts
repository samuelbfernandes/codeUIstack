// Model routing without a switch: pure helpers. Per request, a mod can name the model (turn.step), so a conversation can
// run on a cheaper model chosen from its FIRST prompt (nothing is cached yet, so it costs nothing), and a subagent started
// without a model can get one that fits its task. Never above the model you chose. Idea from laya-router (MIT); no code copied.
import { recommend } from './fit'
import type { Costs } from './fit'
import { RANK } from './gate'
import type { Alias, Family } from './gate'
import type { Prediction } from './predict'

/** The ids a request names (the current models; an alias is not accepted by turn.step). */
export const MODEL_ID: Record<Alias, string> = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }

/**
 * The cheaper model a confident prediction says will do, or undefined to keep the chosen one. Only ever down: a task that
 * needs more than you chose is left to the dialog, which asks.
 */
export function cheaperFit(p: Prediction, chosen: Family | undefined, costs: Costs, minConfidence: number): Alias | undefined {
  if (chosen === undefined || p.tier === 'review' || p.confidence < minConfidence) return undefined
  const fit = recommend(p.tier, costs)
  return RANK[fit] < RANK[chosen] ? fit : undefined
}
