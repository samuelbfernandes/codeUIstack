/**
 * A reply for a prompt the mod answered itself. The drop reason must be ONE line (the engine draws a
 * newline as a garbled character), so the first line is the reason and every further line goes to the
 * transcript as one dim note that is never sent to the model.
 */
export function dropWith(ui: { log: (text: string) => void }, text: string): { drop: string } {
  // eslint-disable-next-line no-control-regex
  const clean = (line: string): string => line.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/ {2,}/g, ' ').trim()
  const lines = text
    .split(/\r\n|\r|\n/)
    .map(clean)
    .filter(line => line !== '')
  const [first = '', ...rest] = lines
  if (rest.length > 0) {
    try {
      ui.log(rest.join('\n'))
    } catch {
      // the note is a courtesy: the reason alone still answers
    }
  }

  return { drop: first }
}
