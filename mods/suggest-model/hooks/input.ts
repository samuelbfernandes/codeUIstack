// What is NOT worth evaluating, and the plain-word commands. Pure functions, no I/O.

const CONFIRMATIONS = new Set([
  'y', 'yes', 'yep', 'yeah', 'yup', 'ok', 'okay', 'k', 'sure', 'no', 'n', 'nope', 'thanks', 'thank you', 'thx', 'ty',
  'go', 'go ahead', 'go on', 'continue', 'proceed', 'do it', 'please do', 'sounds good', 'looks good', 'lgtm', 'great',
  'perfect', 'cool', 'nice', 'done', 'stop', 'retry', 'again', 'next',
])

/** A bare yes/ok/thanks style reply: it answers the model, it is not a new task. */
export function isConfirmation(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!\s]+$/g, '').replace(/\s+/g, ' ')
  return t.length <= 24 && CONFIRMATIONS.has(t)
}

// Deliberately narrow: markdown bullets, numbered lists and quotes are what a real request looks like.
const OUTPUT_LINE =
  /^\s*(?:\$ |>>> |\d+\s*[:|]\s|-->\s|\|\s*$|\[\d+\]|at \S+ \(|at \S+:\d+|File ".*", line \d+|Traceback|Error:|error(?:\[E\d+\])?:|warning:|Warning message|Compiling \S+ v|Caused by:|[─┌└│]|\+\+\+ |--- |@@ |\|.*\||=+$|-{3,}$|\S+\.\w+:\d+(?::\d+)?:? )/

/**
 * Pasted terminal or tool output rather than a request: at least five lines and most of them look
 * like prompts, stack frames, numbered listings, diffs or tables. Also the wrapper tags the app
 * uses for local command output.
 */
export function looksLikeToolOutput(text: string): boolean {
  if (/^\s*<(local-command-std(out|err)|bash-std(out|err)|command-(name|message))>/.test(text)) return true
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length < 5) return false
  return lines.filter(l => OUTPUT_LINE.test(l)).length / lines.length >= 0.6
}

/** True for the prompts that are never judged: slash commands, confirmations, pasted output. */
export const isNotATask = (text: string): boolean => text.startsWith('/') || isConfirmation(text) || looksLikeToolOutput(text)

export type PlainWord = 'status' | 'on' | 'off'

/**
 * `suggest-model`, `suggest model`, `suggest-model on`, `suggest-model off` (and the spaced spellings), EXACTLY:
 * trimmed, any case, one optional trailing full stop. A prompt that merely contains the words is not one.
 */
export function plainWord(text: string): PlainWord | undefined {
  const t = text.trim().toLowerCase().replace(/\.$/, '').trim().replace(/\s+/g, ' ')
  const m = /^suggest[- ]model(?: (on|off))?$/.exec(t)
  if (m === null) return undefined
  return m[1] === 'on' ? 'on' : m[1] === 'off' ? 'off' : 'status'
}
