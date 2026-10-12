// Cheap, pure pre-filter: decides whether a prompt is worth one small-model
// call. It only has to be generous (a false positive costs one cheap call that
// answers `null`); it must be fast and must never throw.

/** Pastes longer than this are logs or files, not corrections. */
export const MAX_CHARS = 2000
/** Prompts with fewer prose characters than this are "ok", "yes", "thanks". */
export const MIN_CHARS = 12
/** A prompt of more lines than this is a pasted log, whatever it says. */
export const MAX_LINES = 20

const FENCE = /```[\s\S]*?(?:```|$)/g

// Each pattern is a signal of a correction or a standing preference.
const SIGNALS: readonly RegExp[] = [
  /^\s*(?:no|nope|wrong)\b\s*[,.:;!—-]/i, // "No, ..." at the start
  /\b(?:that'?s|that is|this is|it'?s|it is) (?:wrong|incorrect|not right)\b/i,
  /\bdon'?t\b/i,
  /\bdo not\b/i,
  /\bnever\b/i,
  /\balways\b/i,
  /\bstop\b/i,
  /\binstead\b/i,
  /\brather than\b/i,
  /\bi (?:already |have already )?told you\b/i,
  /\bwe (?:use|prefer|always|never|only|don'?t|do not)\b/i,
  /\bin this (?:repo|repository|project|codebase)\b/i,
  /\bfrom now on\b/i,
  /\b(?:going forward|from here on|next time)\b/i,
  /\bprefer\b/i,
  /\bnot\s+\S+(?:\s+\S+){0,3}\s*[,;]\s*\S+/i, // "not npm, pnpm"
  /[,;]\s*not\s+\S+/i, // "use pnpm, not npm"
]

/** The prompt without fenced code blocks (an unclosed fence runs to the end). */
export function proseOf(text: string): string {
  return text.replace(FENCE, ' ').trim()
}

/** True when `text` looks like a correction or a standing preference. */
export function looksLikeCorrection(text: string, maxChars: number = MAX_CHARS): boolean {
  try {
    const trimmed = text.trim()
    if (trimmed.startsWith('/')) return false // slash command
    if (trimmed.length > maxChars) return false // pasted log or file
    if (trimmed.split('\n').length > MAX_LINES) return false
    const prose = proseOf(trimmed)
    if (prose.length < MIN_CHARS) return false
    return SIGNALS.some(signal => signal.test(prose))
  } catch {
    return false
  }
}
