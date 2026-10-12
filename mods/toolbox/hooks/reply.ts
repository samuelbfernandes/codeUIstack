/**
 * A `prompt.submit` drop reason must be ONE line: the engine draws a "\n" in it as a stray "?" mark.
 * `dropWith` splits a multi-line text: the first line becomes the reason, the rest goes to the transcript
 * as one dim, multi-line note (`$.ui.log`, never sent to the model).
 */

// Control characters (tabs, carriage returns, escapes, ...) that would break a one-line reason.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g

/** A single line with control characters turned into spaces and the ends trimmed. */
export const oneLine = (text: string): string => text.replace(CONTROL, ' ').replace(/ {2,}/g, ' ').trim()

/** `log` is the caller's `(note) => $.ui.log(note)`: the engine refuses `$.ui` handed around as a value. */
export function dropWith(log: (text: string) => void, text: string): { drop: string } {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
  const drop = oneLine(lines[0] ?? '') || 'toolbox'
  const rest = lines.slice(1)
  if (rest.length > 0) {
    try {
      // A note is a courtesy: a failing log must never undo the drop.
      void Promise.resolve(log(rest.join('\n'))).catch(() => undefined)
    } catch {
      // keep the drop
    }
  }
  return { drop }
}
