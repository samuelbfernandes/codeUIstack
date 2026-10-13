/**
 * A `prompt.submit` drop reason must be ONE line: the engine draws a "\n" in it as a stray "?" mark.
 * `dropWith` splits a multi-line text: the first line becomes the reason, the rest goes to the transcript
 * as dim notes (`$.ui.log`, never sent to the model), one call per line: `$.ui.log` draws one transcript line, where
 * a newline also shows as a stray glyph. The note is usually your held prompt, so each line keeps its indentation and
 * can be copied back.
 */

// Control characters (tabs, carriage returns, escapes, ...) that would break a one-line reason.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g

/** A single line with control characters turned into spaces and the ends trimmed. */
export const oneLine = (text: string): string => text.replace(CONTROL, ' ').replace(/ {2,}/g, ' ').trim()

/** One note line: indentation kept (a tab is two spaces), other control characters turned into a space, the end trimmed. */
const noteLine = (line: string): string => line.replace(/\t/g, '  ').replace(CONTROL, ' ').trimEnd()

/** `log` is the caller's `(note) => $.ui.log(note)`: the engine refuses `$.ui` handed around as a value. */
export function dropWith(log: (text: string) => void, text: string): { drop: string } {
  const lines = text.split(/\r\n|\r|\n/).filter(line => oneLine(line) !== '')
  const drop = oneLine(lines[0] ?? '') || 'budget-guard'
  // Called in order, without awaiting: the hook returns its drop at once.
  for (const line of lines.slice(1)) {
    try {
      // A note is a courtesy: a failing log must never undo the drop.
      void Promise.resolve(log(noteLine(line))).catch(() => undefined)
    } catch {
      // keep the drop
    }
  }
  return { drop }
}
