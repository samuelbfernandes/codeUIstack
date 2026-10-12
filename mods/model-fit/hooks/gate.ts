// Gating: whether a prediction is worth interrupting the person for. Pure functions.
import { namedFiles, refsPriorContext } from './predict'

export type Alias = 'haiku' | 'sonnet' | 'opus'
/** What a resolved model id can map to; `fable` is known but never a target. */
export type Family = Alias | 'fable'

export const RANK: Record<Family, number> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }

/** Maps a resolved model id (`claude-sonnet-4-5`, `opus`) to its family; undefined when unknown. */
export function familyOf(modelId: string): Family | undefined {
  const id = modelId.toLowerCase()
  return (['haiku', 'sonnet', 'opus', 'fable'] as const).find(f => id.includes(f))
}

/** Pushes an answer ('a' accepted, 'd' dismissed) onto the short history kept for the status report. */
export const HISTORY_WINDOW = 10

export const pushHistory = (history: readonly string[], item: 'a' | 'd'): string[] =>
  [...history, item].slice(-HISTORY_WINDOW)

// ------------------------------------------------------------------ subagent fitness

export { refsPriorContext }

/** A subagent starts with no conversation: fine for a self-contained prompt or one that names files. */
export const canRunAlone = (text: string): boolean => !refsPriorContext(text) || namedFiles(text).length > 0

// ----------------------------------------------------------------- display helpers

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

export const BIG_CONTEXT_TOKENS = 20_000

/** First few words of a prompt, for a subagent's task label. */
export function describeTask(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 6).join(' ')
  return words.length > 40 ? `${words.slice(0, 37)}...` : words
}

/** A short single-line snippet for the status list. */
export function snippet(text: string, max = 50): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 3)}...` : one
}
