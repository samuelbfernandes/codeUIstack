/** What a person typed, as far as a plain-word command needs to know. */
export type TypedPrompt = { text: string; origin: { kind: string }; attachments?: readonly unknown[] }

/**
 * The prompt as a plain word: trimmed, lower-cased, one trailing "." allowed, or undefined when it is
 * not the person's own text-only prompt (a notification, a scheduled run, a paste with attachments).
 * Callers compare the result with their words for an EXACT match; a prompt that merely contains a word is never one.
 */
export function plainWord(e: TypedPrompt): string | undefined {
  if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return undefined
  if (e.attachments !== undefined && e.attachments.length > 0) return undefined
  const text = e.text.trim().toLowerCase()

  return text.endsWith('.') ? text.slice(0, -1) : text
}
