import type { PluginOptions } from 'claude-code'

import { FALLBACK_RISKY } from './classify'

export type AskFrom = 'low' | 'medium' | 'high'
/** The runtime choice: the three `askFrom` bars plus `off` (never ask). */
export type Level = AskFrom | 'off'
export const LEVELS: readonly Level[] = ['off', 'low', 'medium', 'high']

/** One line per level, for `/command-guard` with no argument. */
export const LEVEL_MEANING: Record<Level, string> = {
  off: 'never ask',
  low: 'ask for everything, even low risk',
  medium: 'ask from medium risk up',
  high: 'ask only for high risk',
}

/** A stored or typed word as a level, or undefined when it is none. */
export const asLevel = (v: unknown): Level | undefined => {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return (LEVELS as readonly string[]).includes(t) ? (t as Level) : undefined
}
export type BlastConfig = { maxListed: number; extraPatterns: RegExp[]; badPatterns: string[]; askFrom: AskFrom }

/** Rank of a risk level for the `askFrom` bar. Unknown (not checked) ranks with high: it is never skipped. */
export const RANK = { low: 0, medium: 1, high: 2, unknown: 2 } as const

/** True when nothing needs a dialog: every part is below the `askFrom` bar and none went unchecked (`unlisted`). */
export const isBelowBar = (levels: ('low' | 'medium' | 'high' | 'unknown')[], unlisted: number, askFrom: AskFrom): boolean =>
  unlisted === 0 && levels.every(l => RANK[l] < RANK[askFrom])

/** Options from plugin.json userConfig. A pattern that is not a valid regex is reported, never silently dropped. */
export function readConfig(options: PluginOptions): BlastConfig {
  const n = Number(options.maxListed)
  const maxListed = Number.isFinite(n) ? Math.min(200, Math.max(5, Math.round(n))) : 5
  const raw = Array.isArray(options.extraPatterns) ? (options.extraPatterns as string[]) : []
  const extraPatterns: RegExp[] = []
  const badPatterns: string[] = []
  for (const p of raw) {
    try {
      extraPatterns.push(new RegExp(p))
    } catch {
      badPatterns.push(p)
    }
  }
  const askFrom: AskFrom = options.askFrom === 'low' || options.askFrom === 'high' ? options.askFrom : 'medium'
  return { maxListed, extraPatterns, badPatterns, askFrom }
}

/**
 * The fail-closed rule, as a pure function: when the classifier, the measurer or the dialog
 * code throws, refuse only a command whose text looks destructive to the coarse fallback
 * regex (or to one of the user's own patterns). Returns the refusal, or undefined to let it run.
 */
export function failClosedReason(command: unknown, cfg: BlastConfig): string | undefined {
  const text = typeof command === 'string' ? command : ''
  const risky = FALLBACK_RISKY.test(text) || cfg.extraPatterns.some(re => re.test(text))
  return risky
    ? `Blocked by command-guard: could not analyse this command and it looks destructive. Not run: ${text.replace(/\s+/g, ' ').trim().slice(0, 200)}. Ask the user to confirm, then retry.`
    : undefined
}
