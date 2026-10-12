/** The most characters of a diagram kept; the rest is cut (the drawing then shows the source). */
export const MAX_SOURCE = 20_000

/** An opening fence: up to three spaces, three or more backticks or tildes, then the language word. */
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/

/**
 * The last ```mermaid block of an answer: its text without the fences, or undefined when there is none. A block
 * the answer never closed (it was cut short) counts to the end of the answer, as Markdown reads it. Every fenced
 * block is walked to its end, so a mermaid example shown inside another code block is not taken for a diagram.
 */
export function lastMermaid(answer: string): string | undefined {
  const lines = answer.replace(/\r\n?/g, '\n').split('\n')
  let found: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i] as string)
    if (open === null) continue
    const fence = open[1] as string
    // A closing fence is the same character, at least as long, and nothing else on its line.
    const isClose = new RegExp(`^ {0,3}\\${fence.charAt(0)}{${fence.length},}\\s*$`)
    const body: string[] = []
    let j = i + 1
    while (j < lines.length && !isClose.test(lines[j] as string)) body.push(lines[j++] as string)
    if ((open[2] as string).toLowerCase() === 'mermaid') found = body.join('\n')
    i = j
  }

  return found === undefined ? undefined : found.slice(0, MAX_SOURCE)
}
