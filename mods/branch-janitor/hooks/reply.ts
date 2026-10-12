// A plain-word answer is sent back as `prompt.submit` `{ drop: reason }`. The reason MUST be one line: a line
// break in it is drawn as a garbled "�" in the desktop app. So the first line becomes the reason, and any further
// lines go to the transcript as one dim, multi-line note (`ui.log`), which is never sent to the model.
const BREAKS = /[\r\n\u0085\u2028\u2029]+/
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const FALLBACK = 'Branches'

/** Splits `text` into trimmed, non-empty lines with control characters removed. */
export function linesOf(text: string): string[] {
  return text
    .split(BREAKS)
    .map(l => l.replace(CONTROL, ' ').trim())
    .filter(l => l !== '')
}

export function dropWith(ui: { log: (text: string) => void }, text: string): { drop: string } {
  const [first, ...rest] = linesOf(text)
  if (rest.length > 0) {
    try {
      ui.log(rest.join('\n'))
    } catch {
      // the note is a courtesy; the reason alone still says what happened
    }
  }
  return { drop: first ?? FALLBACK }
}
