import type { PluginOptions } from 'claude-code'

import { FALLBACK_RISKY } from './classify'

export type BlastConfig = { maxListed: number; extraPatterns: RegExp[]; badPatterns: string[] }

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
  return { maxListed, extraPatterns, badPatterns }
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
    ? `Blocked by blast-radius: could not analyse this command and it looks destructive. Not run: ${text.replace(/\s+/g, ' ').trim().slice(0, 200)}. Ask the user to confirm, then retry.`
    : undefined
}
